/**
 * Credentials.sample.js — Template for Credentials.js (project: sunmint_tree_planting)
 * =======================================================================================
 *
 * Copy this file to Credentials.js (or Credentials.gs) directly in the Apps Script editor
 * at https://script.google.com/home/projects/1Jp8qNIBCZaRTlmOmbJoJmYnSFyXtQkUHP2Qv5uqKZpt0Ugo-e25nhASF/edit
 * and fill in the actual values. Credentials.js is gitignored
 * (google_app_scripts/**​/Credentials.js) — never commit real secrets, and never `clasp push`
 * this file into git history.
 *
 * Reverse-engineered from every `creds.X` reference in process_tree_planting_telegram_logs.js
 * (2026-08-19) — this project needs exactly three fields, not the generic repo-wide template's four.
 *
 * setApiKeys() is called unconditionally at the top of process_tree_planting_telegram_logs.js
 * (line 11) on every script load, so it must exist. Written here as idempotent seeding (only
 * writes a Script Property if unset) rather than the "run once, then comment out" pattern used
 * elsewhere in this repo, since this file can't safely be hand-edited after each deploy.
 *
 * PREFERRED (per the workspace convention in the sibling agroverse_wix_site_updates sample):
 * set these three values directly in the Apps Script editor under Project Settings → Script
 * Properties instead of editing this file at all — then this file (and setApiKeys()) becomes a
 * no-op fallback, and the real values never live in any source file, gitignored or not.
 *
 * Usage in GAS code:
 *   setApiKeys();
 *   const creds = getCredentials();
 *   const token = creds.TELEGRAM_API_TOKEN;
 */

function setApiKeys() {
  var props = PropertiesService.getScriptProperties();

  // Telegram Bot API token (from @BotFather). Used by getTelegramFileUrl() to resolve the
  // photo file a farmer attached to their [TREE PLANTING EVENT] Telegram submission.
  // Cross-check: may already exist as TELEGRAM_BOT_API_KEY in truesight_autopilot/.env on this
  // box, or as a project-dedicated bot — confirm with Gary before reusing the org-wide one.
  if (!props.getProperty('TELEGRAM_API_TOKEN')) {
    props.setProperty('TELEGRAM_API_TOKEN', 'REPLACE_ME');
  }

  // GitHub Personal Access Token — contents:write scope on TrueSightDAO/sunmint. Used by
  // uploadToGitHub() to mirror each tree-planting photo into that repo's images/ folder.
  if (!props.getProperty('GITHUB_API_TOKEN')) {
    props.setProperty('GITHUB_API_TOKEN', 'REPLACE_ME');
  }

  // Telegram & Submissions Google Sheet ID — holds "Telegram Chat Logs" and "SunMint Tree
  // Planting" tabs. NOT a secret in the same sense as the two tokens above (access is via
  // Sheets sharing permissions, not this ID); pre-filled with high confidence — this exact ID
  // is used consistently across every other GAS project in this repo that touches the same
  // sheet (tokenomics/SCHEMA.md, process_qr_code_updates.js's SOURCE_SHEET_URL, etc.). Confirm
  // it's still correct rather than treating it as a guess.
  if (!props.getProperty('SHEET_ID')) {
    props.setProperty('SHEET_ID', '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ');
  }
}

function getCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    TELEGRAM_API_TOKEN: props.getProperty('TELEGRAM_API_TOKEN') || '',
    GITHUB_API_TOKEN: props.getProperty('GITHUB_API_TOKEN') || '',
    SHEET_ID: props.getProperty('SHEET_ID') || '',
  };
}
