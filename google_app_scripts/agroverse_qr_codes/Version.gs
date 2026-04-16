/**
 * @fileoverview Deploy metadata for the QR Code Generation Apps Script
 * (`processQRCodeGenerationTelegramLogs`, Telegram → Agroverse → GitHub).
 *
 * After every `clasp push` from `clasp_mirrors/1N6o00N9VtRK_L3e0NQXEsmC6QME1KObZdmdbJgo0Tbgj_7P-ElNL5THn/`:
 * 1. Set AGROVERSE_QR_GENERATION_LAST_CLASP_PUSH_UTC to the current UTC time (ISO-8601).
 * 2. Prepend one line to AGROVERSE_QR_GENERATION_CHANGELOG with date + what changed.
 * 3. Copy this file into that clasp mirror, then push.
 *
 * Run `getAgroverseQRGenerationDeployInfo()` in the Apps Script editor to inspect.
 */

/** ISO UTC timestamp of the last clasp push for this mirror */
var AGROVERSE_QR_GENERATION_LAST_CLASP_PUSH_UTC = '2026-04-12T23:15:00Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var AGROVERSE_QR_GENERATION_CHANGELOG =
  '2026-04-12 — QR Code Generation sheet A–O truth: E contributor, H/I Agroverse lines, K zip name, O Manager Name; extractManagerName; Agroverse QR col U = manager.\n' +
  '2026-04-12 — Replaced version.js with Version.gs (align with sales / inventory clasp mirrors).\n' +
  '2026-04-12 — GitHub PROCESSED sync: L/M/N + syncProcessingQRCodeGenerationFromGitHub; version.js build stamp.\n';

/**
 * @returns {{lastClaspPushUtc: string, changelog: string}}
 */
function getAgroverseQRGenerationDeployInfo() {
  return {
    lastClaspPushUtc: AGROVERSE_QR_GENERATION_LAST_CLASP_PUSH_UTC,
    changelog: AGROVERSE_QR_GENERATION_CHANGELOG
  };
}
