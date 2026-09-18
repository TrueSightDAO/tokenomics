/** Credentials.js -- secret-free accessor for the Grok scoring project.
 *  GAS scriptId 1BHAGZd_T1I5mQnqnAFqUJKX2x_N8Uv05n1O2OohRA908Ja8wVwVxaR7K
 *
 *  SECRETS LIVE IN SCRIPT PROPERTIES, NOT HERE. This file is secret-free and is
 *  TRACKED + PUSHED on purpose. `clasp push` = projects.updateContent, which
 *  REPLACES the project's remote file set: any file that is NOT pushed is DELETED
 *  live. So the accessor must be part of the pushed set -- do NOT add this file to
 *  .claspignore or .gitignore. (Before 2026-09-18 this project had no accessor on
 *  @HEAD at all, so `setApiKeys() is not defined` broke every entry point.)
 *
 *  Set values: Project Settings (gear) -> Script properties -> add:
 *    SECRETS:  GITHUB_API_TOKEN, TELEGRAM_API_TOKEN, OPENAI_API_KEY, XAI_API_KEY
 *    CONFIG:   EXISTING_SHEET_URL, FILE_LOG_SHEET_URL, OUTPUT_SHEET_URL,
 *              TELEGRAM_SHEET_URL, INTERMEDIATE_FOLDER_ID, WHATSAPP_FOLDER_ID,
 *              OPENAI_API_URL, XAI_API_URL, TELEGRAM_TOKEN
 *
 *  Usage (called at the top of grok_scoring_..._logs.js):
 *    setApiKeys();
 *    const creds = getCredentials();
 */
function setApiKeys() {
  // No-op guard: secrets live in Script Properties, never in source.
}

function getCredentials() {
  var sp = PropertiesService.getScriptProperties();
  function g(k) { return sp.getProperty(k) || ''; }
  return {
    // secrets
    GITHUB_API_TOKEN: g('GITHUB_API_TOKEN'),
    TELEGRAM_API_TOKEN: g('TELEGRAM_API_TOKEN'),
    OPENAI_API_KEY: g('OPENAI_API_KEY'),
    XAI_API_KEY: g('XAI_API_KEY'),
    // config (not secrets)
    TELEGRAM_TOKEN: g('TELEGRAM_TOKEN'),
    EXISTING_SHEET_URL: g('EXISTING_SHEET_URL'),
    FILE_LOG_SHEET_URL: g('FILE_LOG_SHEET_URL'),
    OUTPUT_SHEET_URL: g('OUTPUT_SHEET_URL'),
    TELEGRAM_SHEET_URL: g('TELEGRAM_SHEET_URL'),
    INTERMEDIATE_FOLDER_ID: g('INTERMEDIATE_FOLDER_ID'),
    WHATSAPP_FOLDER_ID: g('WHATSAPP_FOLDER_ID'),
    OPENAI_API_URL: g('OPENAI_API_URL'),
    XAI_API_URL: g('XAI_API_URL')
  };
}
