/** Credentials.js -- TDG - Email Identity Management (canonical Gmail ingestion project).
 *
 *  Script ID: 1zKgMwd6KJFjoWkRH6OobgFvtVzrXVuEKfxVbgixgnfcp4TZTjrsfNKq0
 *  Runs as admin@truesight.me; owns the /exec web app documented in
 *  register_member_digital_signatures_email.js.
 *
 *  WHY THIS FILE EXISTS (do not delete, do not .claspignore it):
 *  register_member_digital_signatures_email.js calls setApiKeys() and getCredentials()
 *  at global scope. `clasp push` REPLACES the remote file set, so any remote file not
 *  present in this mirror folder is DELETED live. This accessor was absent from BOTH
 *  git (blocked by the blanket Credentials.js ignore rule under google_app_scripts) and
 *  the remote, which made every 5-minute trigger run of processEmailSignatureEvents fail
 *  with "ReferenceError: setApiKeys is not defined" (271 failures on the 2026-11-07
 *  report, ongoing since 2026-10-26). A secret-free accessor must be TRACKED and PUSHED
 *  -- never .claspignore'd.
 *
 *  NOTE ON THE HEADER: do not write a glob containing a star-star-slash sequence
 *  inside this block comment. The glob that originally appeared here closed the
 *  comment early and broke parsing outright (node --check reported a SyntaxError on
 *  the word clasp). Keep globs and path patterns out of block comments in this file.
 *
 *  Secrets live in Project Settings -> Script properties (set 2026-09-18):
 *    OPENAI_API_KEY, XAI_API_KEY, TELEGRAM_API_TOKEN
 *  Script Properties are stored SEPARATELY from source files, so a `clasp push` never
 *  touches them.
 *
 *  Usage in GAS code:
 *    setApiKeys();                  // no-op for anything already set
 *    const creds = getCredentials();
 *    const token = creds.TELEGRAM_API_TOKEN;
 *
 *  DO NOT hardcode real key values here. This file is committed to a public repo.
 */

function getCredentials() {
  const scriptProperties = PropertiesService.getScriptProperties();

  return {
    // API Keys: read from Script Properties. Empty string if unset -- callers must
    // treat a missing key as a configuration error, never fall back to a literal.
    XAI_API_KEY: scriptProperties.getProperty('XAI_API_KEY') || '',
    OPENAI_API_KEY: scriptProperties.getProperty('OPENAI_API_KEY') || '',
    TELEGRAM_API_TOKEN: scriptProperties.getProperty('TELEGRAM_API_TOKEN') || '',

    // Public Google Sheets URLs and folder ids (not secrets; access is via sharing).
    TELEGRAM_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0',
    WHATSAPP_FOLDER_ID: '1X8fGb-kzf5WIjrsd1uO8seXnHZZkiitk',
    INTERMEDIATE_FOLDER_ID: '1UxxDWh5yOeLIUDyTcCgAiMZztp5_8PLU',
    OUTPUT_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit?gid=0#gid=0',
    EXISTING_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0',
    FILE_LOG_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit?gid=712609557#gid=712609557',

    // Public API endpoints.
    XAI_API_URL: 'https://api.x.ai/v1/chat/completions',
    OPENAI_API_URL: 'https://api.openai.com/v1/chat/completions'
  };
}

/**
 * Ensures the three secret keys EXIST as Script Properties WITHOUT overwriting a real
 * value. Historically this function wrote the real key values inline (a leak); it now
 * only seeds a REPLACE_ME placeholder when a property is genuinely absent, so the first
 * run fails loudly instead of silently using a placeholder.
 */
function setApiKeys() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const seed = {
    XAI_API_KEY: 'REPLACE_ME',
    OPENAI_API_KEY: 'REPLACE_ME',
    TELEGRAM_API_TOKEN: 'REPLACE_ME'
  };
  Object.keys(seed).forEach(function (k) {
    if (!scriptProperties.getProperty(k)) {
      scriptProperties.setProperty(k, seed[k]);
    }
  });
}
