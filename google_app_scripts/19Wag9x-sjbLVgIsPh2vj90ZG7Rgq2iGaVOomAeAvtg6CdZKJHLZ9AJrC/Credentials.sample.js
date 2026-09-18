/**
 * Credentials.sample.js — Template for Credentials.js
 * Project: AGL expense processor (GAS scriptId 19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC)
 *
 * Copy this file to Credentials.js in the LIVE Apps Script project and store the real
 * values in Script Properties (Project Settings → Script Properties), keys:
 *   GITHUB_API_TOKEN, TELEGRAM_API_TOKEN, WIX_API_KEY
 *
 * Credentials.js is SECRET-FREE and therefore TRACKED in git and PUSHED — it is NOT
 * in .claspignore. clasp push REPLACES the remote file set, so an ignored/absent
 * accessor gets DELETED live (see the 2026-09-06 incident below). Never put real
 * secrets in source; they belong in Script Properties.
 *
 * Incident 2026-09-06: an editor-only Credentials.gs in this project was deleted by a
 * clasp push (folder-mirror sync removed files not present locally), breaking @HEAD/@9
 * with `ReferenceError: setApiKeys is not defined`. Production @7 was unaffected.
 * The accessor below is secret-free — it reads Script Properties — and defines a
 * guarded no-op setApiKeys() so Code.js's top-of-file setApiKeys() call stays valid
 * without embedding secrets in source.
 *
 * Usage in GAS code:
 *   const creds = getCredentials();
 *   const wix = creds.WIX_API_KEY;
 */

function setApiKeys() {
  // No-op guard: keys live in Script Properties, not in source.
}

function getCredentials() {
  var sp = PropertiesService.getScriptProperties();
  return {
    GITHUB_API_TOKEN: sp.getProperty('GITHUB_API_TOKEN') || '',
    TELEGRAM_API_TOKEN: sp.getProperty('TELEGRAM_API_TOKEN') || '',
    WIX_API_KEY: sp.getProperty('WIX_API_KEY') || ''
  };
}
