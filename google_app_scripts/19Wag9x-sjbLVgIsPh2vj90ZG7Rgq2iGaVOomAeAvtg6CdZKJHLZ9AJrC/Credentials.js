/** Credentials.js -- secret accessor for the AGL expense processor.
 *  GAS scriptId 19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC
 *
 *  SECRETS LIVE IN SCRIPT PROPERTIES, NOT HERE. This file is secret-free and is
 *  TRACKED + PUSHED on purpose. clasp push REPLACES the remote file set, so any file
 *  that is not pushed is DELETED live -- in 2026-09-06 an editor-only Credentials.gs
 *  was deleted by a push, breaking @HEAD with `ReferenceError: setApiKeys is not
 *  defined`. Keeping this accessor in source, and pushing it, is what makes it
 *  undeletable. Do NOT add this file to .claspignore.
 *
 *  Set values: Project Settings (gear) -> Script properties -> add:
 *    GITHUB_API_TOKEN, TELEGRAM_API_TOKEN, WIX_API_KEY
 *
 *  Usage in GAS code (called at the top of Code.js / telegram_webhook_listener.js):
 *    setApiKeys();
 *    var creds = getCredentials();
 */
function setApiKeys() {
  // No-op guard: secrets live in Script Properties, never in source.
}

function getCredentials() {
  var sp = PropertiesService.getScriptProperties();
  return {
    GITHUB_API_TOKEN: sp.getProperty('GITHUB_API_TOKEN') || '',
    TELEGRAM_API_TOKEN: sp.getProperty('TELEGRAM_API_TOKEN') || '',
    WIX_API_KEY: sp.getProperty('WIX_API_KEY') || ''
  };
}
