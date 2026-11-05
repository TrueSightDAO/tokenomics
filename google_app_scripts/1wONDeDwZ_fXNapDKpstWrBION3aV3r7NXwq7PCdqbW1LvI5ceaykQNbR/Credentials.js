/**
 * Credentials.js - 1wONDeDwZ (TDG inventory mgmt: process_movement_telegram_logs)
 * TRACKED IN GIT - safe to commit: this file contains NO secrets.
 *
 * SECRETS COME FROM SCRIPT PROPERTIES (Project Settings > Script Properties):
 *   XAI_API_KEY, OPENAI_API_KEY, GITHUB_API_TOKEN, WIX_API_KEY, TELEGRAM_API_TOKEN
 * The identifiers/URLs below are NOT secrets and stay as literals.
 *
 * WHY setApiKeys() IS A NO-OP
 * ---------------------------
 * Until 2026-09-18 this file hardcoded real API keys and setApiKeys() wrote them
 * UNCONDITIONALLY on every single execution, so a human's Script Property values were
 * overwritten by whatever was in here. It also meant the live file was the de-facto
 * secret store. It is now a no-op; Script Properties are authoritative.
 *
 * WHY THIS FILE IS TRACKED
 * ------------------------
 * `clasp push` = projects.updateContent = REPLACES the project's remote file set: any
 * file NOT in the pushed set is DELETED from the live project. So the accessor is
 * TRACKED (via a .gitignore negation for this path only) and PUSHED like any other
 * source - never .claspignore'd. This project previously had NO tracked Credentials.js,
 * so a push from the repo folder would have DELETED the live accessor and broken every
 * entry point with `ReferenceError: setApiKeys is not defined`.
 *
 * Usage in GAS code:
 *   setApiKeys();
 *   const creds = getCredentials();
 *   const token = creds.TELEGRAM_API_TOKEN;
 */

// Credentials.gs
function getCredentials() {
  const scriptProperties = PropertiesService.getScriptProperties();

  return {
    // API Keys: Sensitive - read from Script Properties only, never hardcoded here.
    XAI_API_KEY: scriptProperties.getProperty("XAI_API_KEY") || "",
    OPENAI_API_KEY: scriptProperties.getProperty("OPENAI_API_KEY") || "",
    GITHUB_API_TOKEN: scriptProperties.getProperty("GITHUB_API_TOKEN") || "",

    // Public Google Sheets URLs and Folder ID (defaults, NOT secret)
    TELEGRAM_SHEET_URL: "https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0",
    TELEGRAM_API_TOKEN: scriptProperties.getProperty("TELEGRAM_API_TOKEN") || "",
    WHATSAPP_FOLDER_ID: "1X8fGb-kzf5WIjrsd1uO8seXnHZZkiitk",
    INTERMEDIATE_FOLDER_ID: "1UxxDWh5yOeLIUDyTcCgAiMZztp5_8PLU",
    OUTPUT_SHEET_URL: "https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit?gid=0#gid=0",
    EXISTING_SHEET_URL: "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0",
    FILE_LOG_SHEET_URL: "https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit?gid=712609557#gid=712609557",
    WIX_API_KEY: scriptProperties.getProperty("WIX_API_KEY") || "",

    // Public API Endpoints
    XAI_API_URL: "https://api.x.ai/v1/chat/completions",
    OPENAI_API_URL: "https://api.openai.com/v1/chat/completions"
  };
}

/**
 * No-op by design (GAS_SCRIPT_PROPERTIES.md section 1).
 * Secrets are set by a human in Script Properties and are NEVER written by code, so
 * this can never overwrite a real live value. It exists because the entry points call
 * it at load time.
 */
function setApiKeys() {
  // Intentionally empty - do not seed or write secrets here.
}
