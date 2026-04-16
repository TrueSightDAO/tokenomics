#!/usr/bin/env node
/**
 * Ensure every `clasp_mirrors/<scriptId>/` folder that has `.clasp.json` also has `Version.gs`.
 *
 * - Mirrors that already contain `Version.gs` are left unchanged.
 * - `1N6o00N9VtRK_L3e0NQXEsmC6QME1KObZdmdbJgo0Tbgj_7P-ElNL5THn` gets
 *   `google_app_scripts/agroverse_qr_codes/Version.gs` (QR Code Generation).
 * - TDG inventory management clasp mirrors get
 *   `google_app_scripts/tdg_inventory_management/Version.gs`.
 * - All other missing mirrors get `google_app_scripts/_clasp_default/Version.gs`.
 *
 * Usage (from tokenomics repo root):
 *   node scripts/ensure_clasp_version_gs.mjs
 *   node scripts/ensure_clasp_version_gs.mjs --dry-run
 *
 * After running, bump timestamps/changelogs in the canonical source files as needed,
 * re-copy specific mirrors, then `clasp push` per project.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIRRORS = path.join(ROOT, 'clasp_mirrors');
const QR_GEN_SCRIPT_ID = '1N6o00N9VtRK_L3e0NQXEsmC6QME1KObZdmdbJgo0Tbgj_7P-ElNL5THn';
const QR_GEN_VERSION_SRC = path.join(ROOT, 'google_app_scripts', 'agroverse_qr_codes', 'Version.gs');
const DEFAULT_VERSION_SRC = path.join(ROOT, 'google_app_scripts', '_clasp_default', 'Version.gs');
const TDG_INVENTORY_VERSION_SRC = path.join(ROOT, 'google_app_scripts', 'tdg_inventory_management', 'Version.gs');
/** Script IDs for clasp mirrors that ship TDG inventory / sales GAS (same canonical Version.gs). */
const TDG_INVENTORY_SCRIPT_IDS = new Set([
  '1dsWecVwbN0dOvilIz9r8DNt7LD3Ay13V8G9qliow4tZtF5LHsvQOFpF7',
  '1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl',
  '1wmgYPwfRDxpiboa8OH-C6Ndovklf8HaJY305n7dhRzs7BmUBQg7fL_sZ',
]);

const dryRun = process.argv.includes('--dry-run');

function main() {
  if (!fs.existsSync(QR_GEN_VERSION_SRC)) {
    console.error('Missing:', QR_GEN_VERSION_SRC);
    process.exit(1);
  }
  if (!fs.existsSync(DEFAULT_VERSION_SRC)) {
    console.error('Missing:', DEFAULT_VERSION_SRC);
    process.exit(1);
  }
  if (!fs.existsSync(TDG_INVENTORY_VERSION_SRC)) {
    console.error('Missing:', TDG_INVENTORY_VERSION_SRC);
    process.exit(1);
  }
  const qrGenBody = fs.readFileSync(QR_GEN_VERSION_SRC, 'utf8');
  const defaultBody = fs.readFileSync(DEFAULT_VERSION_SRC, 'utf8');
  const tdgInventoryBody = fs.readFileSync(TDG_INVENTORY_VERSION_SRC, 'utf8');

  const entries = fs.readdirSync(MIRRORS, { withFileTypes: true }).filter((d) => d.isDirectory());
  let added = 0;
  let skipped = 0;
  for (const ent of entries) {
    const scriptId = ent.name;
    const dir = path.join(MIRRORS, scriptId);
    const claspJson = path.join(dir, '.clasp.json');
    const versionGs = path.join(dir, 'Version.gs');
    if (!fs.existsSync(claspJson)) continue;
    if (fs.existsSync(versionGs)) {
      skipped++;
      continue;
    }
    let body;
    let label;
    if (scriptId === QR_GEN_SCRIPT_ID) {
      body = qrGenBody;
      label = 'agroverse_qr_codes/Version.gs';
    } else if (TDG_INVENTORY_SCRIPT_IDS.has(scriptId)) {
      body = tdgInventoryBody;
      label = 'tdg_inventory_management/Version.gs';
    } else {
      body = defaultBody;
      label = '_clasp_default/Version.gs';
    }
    if (dryRun) {
      console.log('[dry-run] would add Version.gs from', label, '→', versionGs);
    } else {
      fs.writeFileSync(versionGs, body, 'utf8');
      console.log('Added Version.gs from', label, '→', scriptId);
    }
    added++;
  }
  console.log(
    dryRun ? `Dry run: ${added} mirror(s) would get Version.gs; ${skipped} already had it.` : `Done: ${added} added, ${skipped} already had Version.gs.`
  );
}

main();
