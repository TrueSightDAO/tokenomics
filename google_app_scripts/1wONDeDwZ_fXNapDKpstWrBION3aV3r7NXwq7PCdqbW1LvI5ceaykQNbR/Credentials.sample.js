// Credentials.sample.js
// ---------------------------------------------------------------------------
// Copy this file to Credentials.js in this folder BEFORE running `clasp push`.
//
// Credentials.js is gitignored (repo .gitignore: google_app_scripts/**/Credentials.js)
// and exists only on the live project / local deploy folders. `clasp push --force`
// mirrors the folder onto the live project: if Credentials.js is absent from the
// folder, it is DELETED from the live project and the next trigger run fails with
// `ReferenceError: setApiKeys is not defined` (top-of-file `setApiKeys();`).
//
// This exact failure hit production 2026-08-24 (see PR #426).
// NEVER commit real keys here — keep real values in Script Properties or in the
// untracked local Credentials.js only.
// ---------------------------------------------------------------------------
function getCredentials() {
  const scriptProperties = PropertiesService.getScriptProperties();

  return {
    // API Keys: Sensitive — set via Script Properties or replace placeholders locally
    XAI_API_KEY: scriptProperties.getProperty("XAI_API_KEY") || "YOUR_XAI_API_KEY_HERE",
    OPENAI_API_KEY: scriptProperties.getProperty("OPENAI_API_KEY") || "YOUR_OPENAI_API_KEY_HERE",
    GITHUB_API_TOKEN: scriptProperties.getProperty("GITHUB_API_TOKEN") || "YOUR_GITHUB_API_TOKEN_HERE",

    // Google Sheets URLs and Folder IDs (defaults, editable by users)
    TELEGRAM_SHEET_URL: "<YOUR_TELEGRAM_SHEET_URL>",
    TELEGRAM_API_TOKEN: "<YOUR_TELEGRAM_BOT_TOKEN>",
    WHATSAPP_FOLDER_ID: "<YOUR_WHATSAPP_FOLDER_ID>",
    INTERMEDIATE_FOLDER_ID: "<YOUR_INTERMEDIATE_FOLDER_ID>",
    OUTPUT_SHEET_URL: "<YOUR_OUTPUT_SHEET_URL>",
    EXISTING_SHEET_URL: "<YOUR_EXISTING_SHEET_URL>",
    FILE_LOG_SHEET_URL: "<YOUR_FILE_LOG_SHEET_URL>",
    WIX_API_KEY: "<YOUR_WIX_API_KEY>",

    // Public API Endpoints
    XAI_API_URL: "https://api.x.ai/v1/chat/completions",
    OPENAI_API_URL: "https://api.openai.com/v1/chat/completions"
  };
}

// Optional: Utility function to set API keys in Script Properties
function setApiKeys() {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty("XAI_API_KEY", "<YOUR_XAI_API_KEY>");
  scriptProperties.setProperty("OPENAI_API_KEY", "<YOUR_OPENAI_API_KEY>");
  scriptProperties.setProperty("GITHUB_API_TOKEN", "<YOUR_GITHUB_API_TOKEN>");
  Logger.log("API keys set in Script Properties. Replace placeholders with your own keys.");
}
