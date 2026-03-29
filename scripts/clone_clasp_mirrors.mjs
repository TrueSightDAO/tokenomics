#!/usr/bin/env node
/**
 * 1) Clone every Apps Script project from `clasp list --noShorten` into
 *    tokenomics/clasp_mirrors/<scriptId>/  (one folder per scriptId).
 *    That tree is the canonical clasp working copy for push/pull; google_app_scripts/
 *    is reference layout only (see clasp_mirrors/README.md).
 * 2) Write clasp_mirrors/MIGRATION_CHECKLIST.tsv comparing all .gs under
 *    google_app_scripts/ to mirrored files (hash, basename, then full-text
 *    embedding in a mirror file — e.g. monolithic Code.js vs split repo .gs).
 *
 * Usage:
 *   node scripts/clone_clasp_mirrors.mjs              # clone (skip if .clasp.json exists) + pull + checklist
 *   node scripts/clone_clasp_mirrors.mjs --dry-run    # print planned clones only
 *   node scripts/clone_clasp_mirrors.mjs --force-clone # remove target dir and re-clone (destructive)
 *   node scripts/clone_clasp_mirrors.mjs --skip-clone # only regenerate checklist + manifest
 *
 * Requires: clasp logged in, Apps Script API enabled, network.
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENOMICS_ROOT = path.resolve(__dirname, '..');
const MIRROR_ROOT = path.join(TOKENOMICS_ROOT, 'clasp_mirrors');
const GOOGLE_APP_SCRIPTS = path.join(TOKENOMICS_ROOT, 'google_app_scripts');

const SCRIPT_EXT = new Set(['.gs', '.js']);

function parseClaspList(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = [];
  const header = /^Found \d+ scripts\.?$/i;
  for (const line of lines) {
    if (header.test(line)) continue;
    const marker = ' - https://script.google.com/d/';
    const i = line.lastIndexOf(marker);
    if (i === -1) continue;
    const title = line.slice(0, i).trim();
    const rest = line.slice(i + marker.length);
    const scriptId = rest.replace(/\/edit\s*$/i, '').trim();
    if (title && scriptId) out.push({ title, scriptId });
  }
  return out;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function isScriptFile(name) {
  const ext = path.extname(name).toLowerCase();
  return SCRIPT_EXT.has(ext);
}

function rmRf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** All .gs files under google_app_scripts (includes deprecated). */
function listLocalGsFiles() {
  const out = [];
  if (!fs.existsSync(GOOGLE_APP_SCRIPTS)) return out;
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.gs')) out.push(full);
    }
  }
  walk(GOOGLE_APP_SCRIPTS);
  return out.sort();
}

function listMirrorProjectDirs() {
  if (!fs.existsSync(MIRROR_ROOT)) return [];
  return fs
    .readdirSync(MIRROR_ROOT)
    .map((name) => path.join(MIRROR_ROOT, name))
    .filter((p) => {
      if (!fs.statSync(p).isDirectory()) return false;
      if (path.basename(p).startsWith('.')) return false;
      return fs.existsSync(path.join(p, '.clasp.json'));
    });
}

/** scriptId -> { relPath -> fullPath } for script files only, non-recursive (Apps Script flat). */
function indexMirrorFiles() {
  const byScript = {};
  for (const projDir of listMirrorProjectDirs()) {
    const scriptId = path.basename(projDir);
    const files = {};
    for (const name of fs.readdirSync(projDir)) {
      if (name.startsWith('.') && name !== '.clasp.json') continue;
      if (!isScriptFile(name)) continue;
      files[name] = path.join(projDir, name);
    }
    byScript[scriptId] = files;
  }
  return byScript;
}

function normalizeForEmbedding(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/** Strip leading `/** ... *\/` blocks (typical repo file headers); cloud Code.js often omits them. */
function stripLeadingJsDocBlocks(s) {
  let t = s;
  while (true) {
    const m = t.match(/^\s*\/\*[\s\S]*?\*\/\s*/);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  return t;
}

/** Preload mirror script sources for substring (embed) detection — e.g. multi-file git vs single Code.js in cloud. */
function loadMirrorContentsForEmbed(byScript) {
  const list = [];
  for (const scriptId of Object.keys(byScript)) {
    for (const fileName of Object.keys(byScript[scriptId])) {
      const fullPath = byScript[scriptId][fileName];
      let raw;
      try {
        raw = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      list.push({
        scriptId,
        fileName,
        norm: normalizeForEmbedding(raw),
      });
    }
  }
  return list;
}

/**
 * If a local .gs body is contained verbatim in a mirror file, cloud likely stores a bundle in Code.js.
 * minLocalChars avoids trivial false positives.
 */
function findEmbeddingHits(localNorm, mirrorList, minLocalChars) {
  if (localNorm.length < minLocalChars) return [];
  const hits = [];
  for (let i = 0; i < mirrorList.length; i++) {
    const m = mirrorList[i];
    if (m.norm.includes(localNorm)) hits.push(`${m.scriptId}:${m.fileName}`);
  }
  return hits;
}

function buildContentHashIndex(byScript) {
  /** hash -> [{ scriptId, fileName }] */
  const map = new Map();
  for (const scriptId of Object.keys(byScript)) {
    const files = byScript[scriptId];
    for (const fileName of Object.keys(files)) {
      const full = files[fileName];
      let buf;
      try {
        buf = fs.readFileSync(full);
      } catch {
        continue;
      }
      const h = sha256Hex(buf);
      if (!map.has(h)) map.set(h, []);
      map.get(h).push({ scriptId, fileName });
    }
  }
  return map;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const forceClone = argv.includes('--force-clone');
  const skipClone = argv.includes('--skip-clone');

  let listText;
  try {
    listText = execSync('clasp list --noShorten', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    console.error('clasp list failed. Log in with `clasp login` and enable the Apps Script API.');
    process.exit(1);
  }

  const projects = parseClaspList(listText);
  if (projects.length === 0) {
    console.error('No projects parsed from clasp list.');
    process.exit(1);
  }

  fs.mkdirSync(MIRROR_ROOT, { recursive: true });

  const cloneLog = [];

  if (!skipClone) {
    for (const { title, scriptId } of projects) {
      const dir = path.join(MIRROR_ROOT, scriptId);
      const hasClasp = fs.existsSync(path.join(dir, '.clasp.json'));

      if (dryRun) {
        console.log(`${dryRun ? '[dry-run] ' : ''}${scriptId}\t${title}`);
        continue;
      }

      if (forceClone && fs.existsSync(dir)) {
        rmRf(dir);
      }

      if (!fs.existsSync(path.join(dir, '.clasp.json'))) {
        fs.mkdirSync(dir, { recursive: true });
        try {
          execSync(`clasp clone ${scriptId}`, {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          cloneLog.push({ scriptId, title, actionClone: true });
        } catch (e) {
          console.error(`clone failed ${scriptId}: ${e.stderr || e.message}`);
          cloneLog.push({ scriptId, title, actionClone: false, error: String(e.stderr || e.message) });
        }
      } else {
        try {
          execSync('clasp pull', {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          cloneLog.push({ scriptId, title, actionPull: true });
        } catch (e) {
          console.error(`pull failed ${scriptId}: ${e.stderr || e.message}`);
          cloneLog.push({ scriptId, title, actionPull: false, error: String(e.stderr || e.message) });
        }
      }
    }
  }

  if (dryRun) {
    console.error(`\nDry run: ${projects.length} projects. Run without --dry-run to clone into clasp_mirrors/<scriptId>/`);
    return;
  }

  const byScript = indexMirrorFiles();
  const hashIndex = buildContentHashIndex(byScript);
  const basenameIndex = new Map();
  for (const scriptId of Object.keys(byScript)) {
    for (const fileName of Object.keys(byScript[scriptId])) {
      if (!basenameIndex.has(fileName)) basenameIndex.set(fileName, []);
      basenameIndex.get(fileName).push(scriptId);
    }
  }

  const localPaths = listLocalGsFiles();
  const rows = [];
  for (const full of localPaths) {
    const rel = path.relative(TOKENOMICS_ROOT, full);
    const base = path.basename(full);
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      rows.push([rel, base, '', '', 'READ_ERROR', '']);
      continue;
    }
    const h = sha256Hex(buf);
    const hp = h.slice(0, 12);

    const hashHits = hashIndex.get(h) || [];
    const baseHits = basenameIndex.get(base) || [];

    let status = 'UNMAPPED';
    if (hashHits.length === 1) {
      status = `HASH_MATCH:${hashHits[0].scriptId}:${hashHits[0].fileName}`;
    } else if (hashHits.length > 1) {
      status = `HASH_COLLISION:${hashHits.map((x) => x.scriptId).join('|')}`;
    } else if (baseHits.length === 1) {
      status = `BASENAME_ONLY:${baseHits[0]} (content differs — compare manually)`;
    } else if (baseHits.length > 1) {
      status = `BASENAME_AMBIG:${baseHits.join('|')}`;
    } else if (base === 'Code.js' || base === 'Code.gs') {
      status = 'UNMAPPED';
    }

    rows.push([rel, base, hp, hashHits.map((x) => `${x.scriptId}:${x.fileName}`).join(';') || '', status, '']);
  }

  const mirrorEmbedList = loadMirrorContentsForEmbed(byScript);
  const MIN_EMBED_CHARS = 200;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const st = String(row[4]);
    if (
      !st.startsWith('UNMAPPED') &&
      !st.startsWith('BASENAME_ONLY') &&
      !st.startsWith('BASENAME_AMBIG')
    ) {
      continue;
    }

    const full = path.join(TOKENOMICS_ROOT, row[0]);
    let localRaw;
    try {
      localRaw = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const localNorm = normalizeForEmbedding(localRaw);
    let hits = findEmbeddingHits(localNorm, mirrorEmbedList, MIN_EMBED_CHARS);
    if (hits.length === 0) {
      const trimmed = localNorm.trim();
      if (trimmed.length >= MIN_EMBED_CHARS) hits = findEmbeddingHits(trimmed, mirrorEmbedList, MIN_EMBED_CHARS);
    }
    if (hits.length === 0) {
      const stripped = stripLeadingJsDocBlocks(localNorm).trim();
      if (stripped.length >= MIN_EMBED_CHARS) hits = findEmbeddingHits(stripped, mirrorEmbedList, MIN_EMBED_CHARS);
    }

    if (hits.length === 1) {
      row[5] = hits[0];
      row[4] = `EMBEDDED_IN:${hits[0]}`;
    } else if (hits.length > 1) {
      const show = hits.slice(0, 6);
      row[5] = show.join(';');
      row[4] = `EMBEDDED_AMBIG:${show.join(';')}${hits.length > 6 ? `;+${hits.length - 6}more` : ''}`;
    }
  }

  const tsvPath = path.join(MIRROR_ROOT, 'MIGRATION_CHECKLIST.tsv');
  const tsvLines = [
    ['local_path', 'basename', 'sha256_12', 'hash_match_mirror', 'status', 'embedded_hit'].join('\t'),
    ...rows.map((r) => r.map((c) => String(c).replace(/\t/g, ' ')).join('\t')),
  ];
  fs.writeFileSync(tsvPath, tsvLines.join('\n') + '\n', 'utf8');

  const manifestPath = path.join(MIRROR_ROOT, 'MANIFEST.json');
  const manifest = {
    generatedAt: new Date().toISOString(),
    mirrorRoot: path.relative(TOKENOMICS_ROOT, MIRROR_ROOT),
    projectCount: projects.length,
    mirrorDirs: listMirrorProjectDirs().length,
    cloneLog,
    checklistRows: rows.length,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const needsAttention = rows.filter((r) => {
    const s = String(r[4]);
    return (
      s.startsWith('UNMAPPED') ||
      s.startsWith('BASENAME_ONLY') ||
      s.startsWith('BASENAME_AMBIG') ||
      s.startsWith('HASH_COLLISION')
    );
  });
  const embedded = rows.filter((r) => String(r[4]).startsWith('EMBEDDED_')).length;
  console.error(`\nWrote ${path.relative(TOKENOMICS_ROOT, tsvPath)} (${rows.length} local .gs rows)`);
  console.error(`Wrote ${path.relative(TOKENOMICS_ROOT, manifestPath)}`);
  console.error(`\nContent embedded in a mirror (likely Code.js bundle): ${embedded}`);
  console.error(`Needs attention (no hash/embed resolve): ${needsAttention.length}`);
  for (const r of needsAttention.slice(0, 40)) {
    console.error(`  ${r[0]} -> ${r[4]}`);
  }
  if (needsAttention.length > 40) console.error(`  … and ${needsAttention.length - 40} more (see TSV)`);
}

main();
