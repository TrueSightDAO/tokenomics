#!/usr/bin/env node
/**
 * Suggest (or write) .clasp.json for each folder under google_app_scripts/
 * by fuzzy-matching:
 *   - folder name, and
 *   - header text from the first ~50 lines of each .gs (Description: + file preamble)
 * to `clasp list --noShorten` project titles.
 *
 * Usage:
 *   node scripts/map_clasp_dirs.mjs                # print table to stdout
 *   node scripts/map_clasp_dirs.mjs --verbose              # stderr: header signal preview per folder
 *   node scripts/map_clasp_dirs.mjs --prefer-description   # weight Description:/filenames over folder slug (multi-script folders)
 *   node scripts/map_clasp_dirs.mjs --write                  # write .clasp.json when confident
 *   node scripts/map_clasp_dirs.mjs --min 0.5             # minimum dice score (0–1)
 *
 * Requires: clasp logged in (~/.clasprc.json), `clasp` on PATH.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENOMICS_ROOT = path.resolve(__dirname, '..');
const GOOGLE_APP_SCRIPTS = path.join(TOKENOMICS_ROOT, 'google_app_scripts');

const HEADER_LINES_PER_FILE = 52;
const HEADER_MAX_GS_FILES = 5;

/** Boost matching when these phrases appear in the remote title (lowercase). */
const ALIAS_PHRASES = {
  holistic_hit_list_store_history: ['store interaction history'],
  newsletter_subscriber_sync: ['newsletter subscriber'],
  tdg_asset_management: ['asset management web app'],
  tdg_inventory_management: ['tdg_inventory_management', 'inventory management web_app'],
  /** Prefer the proposals project, not TDG - Notarization */
  tdg_proposal: ['tdg - proposals'],
  tdg_shipping_planner: ['shipping planner'],
  /** Repo `tdg_scoring` is Grok/Telegram scoring — not the “transfer scored …” ledger script */
  tdg_scoring: ['grok telegram', 'whatsapp combined scoring'],
  webhooks: ['telegram webhook listener'],
  tdg_identity_management: ['email identity management'],
  /** Primary Agroverse QR batch/generation tooling lives in `agroverse_qr_codes` */
  agroverse_qr_codes: ['qr code creation web service'],
  agroverse_notarizations: ['edgar - submissions', 'submissions listener'],
  agroverse_site_statistics: ['site statistics'],
  sunmint_tree_planting: ['sunmint', 'tree planting submission'],
  wix_workflows: ['luma to wix'],
  deprecated: [], // never auto-map
};

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.gs\b/g, ' ')
    /** Helps “Updates the … sheet” align with remote titles like “update … inventory”. */
    .replace(/\b(updates|updated|updating)\b/g, 'update')
    /** Match “inventory movement” in headers to “Inventory Movements” in project titles. */
    .replace(/\bmovements\b/g, 'movement')
    .replace(/\bledgers\b/g, 'ledger')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'from',
  'with',
  'this',
  'that',
  'are',
  'was',
  'via',
  'into',
  'per',
  'them',
  'both',
  'each',
  'new',
  'all',
  'any',
]);

function tokenSet(s) {
  const t = new Set();
  for (const w of normalize(s).split(' ')) {
    if (w.length > 1) t.add(w);
  }
  return t;
}

/** Same as tokenSet but drops frequent glue words so `Description:` paragraphs don’t dilute Dice. */
function tokenSetForDescription(s) {
  const t = tokenSet(s);
  TOKEN_STOPWORDS.forEach((w) => t.delete(w));
  return t;
}

function diceSimilarity(a, b) {
  const A = a instanceof Set ? a : tokenSet(a);
  const B = b instanceof Set ? b : tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
  }
  return (2 * inter) / (A.size + B.size);
}

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

function listLocalClaspDirs(root) {
  const dirs = [];
  if (!fs.existsSync(root)) return dirs;
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith('.')) continue;
    const full = path.join(root, name);
    if (!fs.statSync(full).isDirectory()) continue;
    const hasGs = fs.readdirSync(full).some>((f) => f.endsWith('.gs'));
    if (hasGs) dirs.push({ name, full });
  }
  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Prefer likely “main” script filenames so headers aren’t dominated by helpers (e.g. capital_injection*.gs before web_app.gs). */
function sortGsFilesForHeader(files) {
  function priority(name) {
    const n = name.toLowerCase();
    if (n === 'code.gs') return 0;
    if (n.includes('web_app')) return 1;
    if (n.includes('_api') || n.endsWith('api.gs')) return 2;
    if (n.includes('main')) return 3;
    return 10;
  }
  return [...files].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

/** Pull comments from the first N files + every `Description:` line from ALL .gs files in the folder. */
function extractHeaderSignals(dirPath) {
  const files = sortGsFilesForHeader(fs.readdirSync(dirPath).filter((f) => f.endsWith('.gs')));
  const descriptionParts = [];
  const blobParts = [];

  files.forEach((file, index) => {
    const fp = path.join(dirPath, file);
    let raw;
    try {
      raw = fs.readFileSync(fp, 'utf8');
    } catch {
      return;
    }
    const lines = raw.split(/\r?\n/).slice(0, HEADER_LINES_PER_FILE);
    const head = lines.join('\n');

    let m;
    const descRe = /Description:\s*([^\n*]+)/gi;
    while ((m = descRe.exec(head)) !== null) {
      const bit = (m[1] || '').trim();
      if (bit) descriptionParts.push(bit);
    }

    if (index < HEADER_MAX_GS_FILES) {
      const flat = head
        .split('\n')
        .map((ln) =>
          ln
            .replace(/^\s*\/\*\*?/, '')
            .replace(/^\s*\*?\s?/, '')
            .replace(/\*\/\s*$/, '')
            .trim()
        )
        .filter((ln) => ln && !ln.startsWith('//'))
        .join(' ');
      if (flat) blobParts.push(flat);
    }
  });

  const fileStemPhrase = files
    .filter((f) => !/^web_app\.gs$/i.test(f) && !/^code\.gs$/i.test(f))
    .map((f) => f.replace(/\.gs$/i, '').replace(/_/g, ' '))
    .join(' ');
  if (fileStemPhrase) descriptionParts.push(fileStemPhrase);

  function scrub(t) {
    let s = t.replace(/https?:\/\/[^\s)]+/gi, ' ');
    s = s.replace(/\bAKfycb[a-zA-Z0-9_-]+\b/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  return {
    /** Full preamble from the first few scripts (web_app first). */
    fullText: scrub(blobParts.join(' ')),
    /** Every `Description:` line from every .gs file — strongest hint for clasp project titles. */
    descriptionText: scrub(descriptionParts.join(' ')),
  };
}

/** When --prefer-description, reward titles whose core nouns also appear in merged descriptions. */
function keywordAgreementBoost(tnorm, descNorm, preferDescription) {
  if (!preferDescription || !descNorm || !tnorm) return 0;
  const keys = ['process', 'inventory', 'movement', 'ledger', 'telegram', 'sales', 'shipment'];
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (tnorm.includes(k) && descNorm.includes(k)) n++;
  }
  if (n >= 3) return 0.64;
  if (n >= 2) return 0.4;
  return 0;
}

function exactTitleBoost(localName, title) {
  const t = String(title || '')
    .trim()
    .toLowerCase();
  if (localName === 'tdg_proposal' && t === 'tdg - proposals') return 0.96;
  if (localName === 'tdg_scoring' && t.includes('grok telegram') && t.includes('whatsapp')) return 0.92;
  if (localName === 'agroverse_qr_codes' && t.includes('qr code creation web service')) return 0.9;
  return null;
}

function bestMatches(localName, remoteProjects, headerSignals, options) {
  const preferDescription = options && options.preferDescription;
  const folderNorm = normalize(localName.replace(/_/g, ' '));
  const folderTokens = tokenSet(localName.replace(/_/g, ' '));
  const fullText =
    !headerSignals ? '' : typeof headerSignals === 'string' ? headerSignals : headerSignals.fullText || '';
  const descriptionText =
    !headerSignals || typeof headerSignals === 'string'
      ? ''
      : headerSignals.descriptionText || '';
  const headerTokens = fullText ? tokenSet(fullText) : null;
  const descTokens = descriptionText ? tokenSetForDescription(descriptionText) : null;
  const headerNorm = fullText ? normalize(fullText) : '';
  const descNorm = descriptionText ? normalize(descriptionText) : '';
  const aliases = ALIAS_PHRASES[localName] || [];

  const scored = remoteProjects.map((p) => {
    const titleTokens = tokenSet(p.title);
    const folderDice = diceSimilarity(folderTokens, titleTokens);
    const descDice = descTokens && descTokens.size ? diceSimilarity(descTokens, titleTokens) : 0;
    let score = folderDice;
    if (preferDescription && descTokens && descTokens.size >= 5) {
      score = 0.22 * folderDice + 0.78 * descDice;
    }
    if (!preferDescription && headerTokens && headerTokens.size) {
      score = Math.max(score, diceSimilarity(headerTokens, titleTokens));
    }
    if (descTokens && descTokens.size) {
      score = Math.max(score, descDice);
    }
    const tnorm = normalize(p.title);
    if (descNorm.length > 12 && (tnorm.includes(descNorm.slice(0, 28)) || descNorm.includes(tnorm.slice(0, 28)))) {
      score = Math.max(score, 0.45);
    }
    if (!preferDescription && headerNorm && (tnorm.includes(headerNorm.slice(0, 24)) || headerNorm.includes(tnorm.slice(0, 24)))) {
      score = Math.max(score, 0.4);
    }
    score = Math.max(score, keywordAgreementBoost(tnorm, descNorm, preferDescription));
    if (
      !preferDescription &&
      (tnorm.includes(folderNorm) || folderNorm.includes(tnorm.split(' ').slice(0, 3).join(' ')))
    ) {
      score = Math.max(score, 0.35);
    }
    if (!preferDescription) {
      for (const ph of aliases) {
        if (tnorm.includes(normalize(ph))) score = Math.max(score, 0.55);
      }
    }
    const ex = exactTitleBoost(localName, p.title);
    if (ex != null) score = Math.max(score, ex);
    return { ...p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const preferDescription = args.includes('--prefer-description');
  const doWrite = args.includes('--write');
  let minScore = 0.42;
  const minEq = args.find((a) => a.startsWith('--min='));
  if (minEq) minScore = parseFloat(minEq.slice('--min='.length)) || minScore;
  else {
    const i = args.indexOf('--min');
    if (i !== -1 && args[i + 1]) minScore = parseFloat(args[i + 1]) || minScore;
  }

  let listText;
  try {
    listText = execSync('clasp list --noShorten', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    console.error('Failed to run `clasp list --noShorten`. Is clasp installed and logged in?');
    process.exit(1);
  }

  const remote = parseClaspList(listText);
  const locals = listLocalClaspDirs(GOOGLE_APP_SCRIPTS);

  const rows = [];
  const usedIds = new Map();

  for (const { name, full } of locals) {
    if (name === 'deprecated' && !args.includes('--include-deprecated')) {
      rows.push({ folder: name, scriptId: '', title: '', score: 0, note: 'skipped (deprecated)' });
      continue;
    }
    const headerSignals = extractHeaderSignals(full);
    if (verbose) {
      const desc = headerSignals.descriptionText || '';
      const preview =
        (desc.length > 120 ? desc.slice(0, 120) + '…' : desc) ||
        (headerSignals.fullText.length > 120 ? headerSignals.fullText.slice(0, 120) + '…' : headerSignals.fullText);
      console.error(`[header ${name}] ${preview || '(empty)'}`);
    }
    const ranked = bestMatches(name, remote, headerSignals, { preferDescription });
    const top = ranked[0];
    const second = ranked[1];
    let note = '';
    if (!top || top.score < minScore) {
      note = 'no confident match — pick manually';
      rows.push({
        folder: name,
        scriptId: '',
        title: top && top.score >= 0.25 ? `${top.title} (weak: ${top.score.toFixed(2)})` : '',
        score: top?.score || 0,
        note,
      });
      continue;
    }
    if (
      second &&
      top.score < 0.82 &&
      second.score >= top.score - 0.08 &&
      second.score >= minScore
    ) {
      note = `ambiguous (also: "${second.title.slice(0, 50)}…")`;
    }
    rows.push({ folder: name, scriptId: top.scriptId, title: top.title, score: top.score, note });

    if (doWrite && top.score >= minScore && !note.startsWith('ambiguous')) {
      const claspPath = path.join(full, '.clasp.json');
      const exists = fs.existsSync(claspPath);
      if (exists && !args.includes('--force')) {
        note && rows[rows.length - 1].note && (rows[rows.length - 1].note += '; .clasp.json exists, use --force');
      } else {
        const body = JSON.stringify({ scriptId: top.scriptId, rootDir: '.' }, null, 2) + '\n';
        fs.writeFileSync(claspPath, body, 'utf8');
        usedIds.set(top.scriptId, (usedIds.get(top.scriptId) || []).concat(name));
        rows[rows.length - 1].note = (rows[rows.length - 1].note || '') + ' wrote .clasp.json';
      }
    } else if (doWrite && top.score >= minScore && note.startsWith('ambiguous')) {
      rows[rows.length - 1].note += '; not writing (ambiguous)';
    }
  }

  // Tab-separated for easy paste into Sheets
  console.log(['local_folder', 'suggested_scriptId', 'dice_score', 'remote_title', 'notes'].join('\t'));
  for (const r of rows) {
    console.log(
      [r.folder, r.scriptId, r.score.toFixed(3), r.title.replace(/\t/g, ' '), r.note || ''].join('\t')
    );
  }

  const dupes = [...usedIds.entries()].filter(([, v]) => v.length > 1);
  if (dupes.length) {
    console.error('\nWarning: same scriptId assigned to multiple folders:', dupes);
  }

  if (!doWrite) {
    console.error('\nDry run. To write .clasp.json files: node scripts/map_clasp_dirs.mjs --write');
    console.error('Tune threshold: --min=0.5   Re-write existing: --force');
  }
}

main();
