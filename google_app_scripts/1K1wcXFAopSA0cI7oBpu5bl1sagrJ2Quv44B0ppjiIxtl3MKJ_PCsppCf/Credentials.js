/** Credentials.js -- TDG Email Identity Management. SECRET-FREE, TRACKED, PUSHED.
 *
 *  Secrets live in Project Settings -> Script properties (set 2026-09-18):
 *    OPENAI_API_KEY, XAI_API_KEY, TELEGRAM_API_TOKEN
 *  Script Properties are stored SEPARATELY from source files, so a `clasp push` never
 *  touches them. Only this accessor file was at risk of being deleted by a push, which
 *  is why it is tracked in git: `clasp push` REPLACES the remote file set, so anything
 *  not pushed is DELETED live. A secret-free accessor must therefore be TRACKED and
 *  PUSHED -- never .claspignore'd.
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
