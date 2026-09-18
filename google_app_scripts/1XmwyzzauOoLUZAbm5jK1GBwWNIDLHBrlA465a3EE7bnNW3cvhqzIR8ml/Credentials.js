/** Credentials.js -- Telegram webhook relay project. SECRET-FREE, TRACKED, PUSHED.
 *
 *  Single source of config for this project. Values live in Project Settings ->
 *  Script properties (set 2026-09-18):
 *    TELEGRAM_API_TOKEN   (the bot token)
 *    TELEGRAM_CHAT_ID     (destination chat; defaults to the group id below if unset)
 *  Script Properties are stored SEPARATELY from source files, so a `clasp push` never
 *  touches them. Only this accessor file was at risk of being deleted by a push, which
 *  is why it is TRACKED in git: `clasp push` REPLACES the remote file set, so anything
 *  not pushed is DELETED live. A secret-free accessor must be TRACKED and PUSHED --
 *  never .claspignore'd.
 *
 *  Code.js consumes this via:  const creds = getCredentials();
 *
 *  DO NOT hardcode real key values here. This file is committed to a public repo.
 */

function getCredentials() {
  const scriptProperties = PropertiesService.getScriptProperties();

  return {
    // Bot token: read from Script Properties. Empty string if unset -- callers must
    // treat a missing token as a configuration error, never fall back to a literal.
    TELEGRAM_API_TOKEN: scriptProperties.getProperty('TELEGRAM_API_TOKEN') || '',

    // Destination chat id (not a secret; non-privileged default kept for convenience).
    TELEGRAM_CHAT_ID:
      scriptProperties.getProperty('TELEGRAM_CHAT_ID') || '-1002190388985'
  };
}

/**
 * Seeds a REPLACE_ME placeholder ONLY when a property is genuinely absent, so a
 * misconfigured project fails loudly instead of silently using a placeholder.
 * Never overwrites an existing real value.
 */
function setApiKeys() {
  const scriptProperties = PropertiesService.getScriptProperties();
  if (!scriptProperties.getProperty('TELEGRAM_API_TOKEN')) {
    scriptProperties.setProperty('TELEGRAM_API_TOKEN', 'REPLACE_ME');
  }
}
