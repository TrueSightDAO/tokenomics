/**
 * Credentials.js - 1y6JVYwqdr
 *   "Api.TrueSight.me - QR code reader web service"
 * TRACKED IN GIT - safe to commit: this file contains NO secrets.
 *
 * WHY THIS FILE IS TRACKED
 * ------------------------
 * `clasp push` = projects.updateContent = REPLACES the project's remote file set: any file
 * NOT in the pushed set is DELETED from the live project. The LIVE project had a
 * Credentials.js that HARDCODED a Wix token and a QuickNode key, while this repo folder had
 * NO Credentials.js at all - so a push from here deleted the live accessor, and the live
 * file was the ONLY place those two secrets lived.
 *
 * The accessor is therefore TRACKED (via a .gitignore negation for this path only) and
 * PUSHED like any other source - never .claspignore'd. Secrets live in Script Properties
 * (Project Settings > Script Properties), which a push never touches.
 *
 * STATUS (2026-09-18): NOTHING calls getCredentials() any more - the live file was dead
 * code that only held secrets. Wix and QuickNode are both RETIRED, so WIX_API_KEY and
 * QUICKNODE_API_KEY are read from Script Properties and are empty by default. If you have
 * set either as a Script Property, delete it.
 *
 * Usage in GAS code:
 *   setApiKeys();
 *   const creds = getCredentials();
 */

/**
 * No-op by design (see GAS_SCRIPT_PROPERTIES.md section 1).
 * Secrets are set by a human in Script Properties and are NEVER written by code, so this
 * can never overwrite a real live value.
 */
function setApiKeys() {
  // Intentionally empty - do not seed secrets here.
}

/**
 * Reads this project's configuration from Script Properties.
 * @returns {{WIX_API_KEY: string, QUICKNODE_API_KEY: string}}
 */
function getCredentials() {
  var props = PropertiesService.getScriptProperties();
  return {
    // Both services are RETIRED (2026-09-18). Kept as environment lookups so any caller
    // referencing these fields does not break; empty when the Script Properties are unset.
    WIX_API_KEY: props.getProperty('WIX_API_KEY') || '',
    QUICKNODE_API_KEY: props.getProperty('QUICKNODE_API_KEY') || '',
  };
}
