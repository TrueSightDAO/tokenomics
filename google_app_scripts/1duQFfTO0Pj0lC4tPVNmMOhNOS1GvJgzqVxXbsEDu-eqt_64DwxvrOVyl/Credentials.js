/**
 * Credentials.js - 1duQFfTO (TDG inventory mgmt: sales_update_managed_agl_ledgers)
 * TRACKED IN GIT - safe to commit: this file contains NO secrets.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Both entry-point files call these functions at the TOP of the file:
 *   sales_update_managed_agl_ledgers.js -> setApiKeys(); const creds = getCredentials();
 *   telegram_webhook_listener.js        -> setApiKeys(); const webhookCreds = getCredentials();
 *
 * Before 2026-09-18 this project had NO Credentials.js at all (neither tracked nor
 * live), so every entry point failed with `ReferenceError: setApiKeys is not defined`.
 *
 * `clasp push` = projects.updateContent = REPLACES the project's remote file set:
 * any file NOT in the pushed set is DELETED from the live project. So this accessor is
 * TRACKED (via a .gitignore negation for this path only) and PUSHED like any other
 * source - never .claspignore'd. Secrets live in Script Properties
 * (Project Settings > Script Properties), which a push never touches.
 *
 * Usage in GAS code:
 *   setApiKeys();
 *   const creds = getCredentials();
 *   const token = creds.TELEGRAM_API_TOKEN;
 */

/**
 * No-op by design (see GAS_SCRIPT_PROPERTIES.md section 1).
 * Secrets are set by a human in Script Properties and are NEVER written by code, so
 * this can never overwrite a real live value. It exists because the entry-point files
 * call it at load time.
 */
function setApiKeys() {
  // Intentionally empty - do not seed placeholder secrets here.
}

/**
 * Reads this project's configuration from Script Properties.
 * @returns {{TELEGRAM_API_TOKEN: string}}
 */
function getCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    // Telegram Bot API token (from @BotFather). Property name is TELEGRAM_API_TOKEN
    // (see GAS_SCRIPT_PROPERTIES.md). Returns '' when unset so callers log a clear
    // "missing" message rather than crashing with a ReferenceError.
    TELEGRAM_API_TOKEN: props.getProperty('TELEGRAM_API_TOKEN') || '',
  };
}
