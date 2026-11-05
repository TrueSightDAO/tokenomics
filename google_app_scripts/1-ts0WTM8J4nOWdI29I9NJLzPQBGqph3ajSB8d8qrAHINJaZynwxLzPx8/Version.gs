/**
 * @fileoverview Default deploy metadata for tokenomics clasp mirrors that do not
 * use a domain-specific Version.gs (e.g. tdg_inventory_management/Version.gs).
 *
 * After every `clasp push` from this mirror folder:
 * 1. Set CLASP_MIRROR_LAST_CLASP_PUSH_UTC to the current UTC time (ISO-8601).
 * 2. Prepend one line to CLASP_MIRROR_CHANGELOG with date + what changed.
 * 3. Copy this file into the mirror (from `google_app_scripts/_clasp_default/Version.gs`), then push.
 *
 * Run `getClaspMirrorDeployInfo()` in the Apps Script editor to inspect.
 */

/** ISO UTC timestamp of the last clasp push for this mirror */
var CLASP_MIRROR_LAST_CLASP_PUSH_UTC = '2026-09-22T14:00:00Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var CLASP_MIRROR_CHANGELOG =
  '2026-09-22 - Fix transfer DUPLICATES: the (contributor, contribution) dedup map was built but never READ, so re-appends created duplicate Ledger rows. Now enforced: skip a row whose signed Request Transaction ID (or contributor+body+TDG+date) already exists in the Ledger; new duplicatesSkipped counter; origin row marked Transferred + col L -> existing Ledger row.\n' +
  '2026-09-21 - Fix transfer ABORT: ERROR_CONTRIBUTOR_NOT_FOUND wrote an out-of-list value to strictly-validated col F -> setValue threw and aborted the whole run (root cause of partial ~66-row drains). Now writes valid ERROR_STATUS + per-row try/catch (new rowErrors counter) so one bad row can never abort a pass.\n' +
  '2026-09-21 - Fix transfer: remove duplicate legacy fns (stale processAllReviewedRows ignored limit -> 68-89s web timeout), robust doGet (always JSON, error-safe), canonical 8-col A-H Ledger write, ledger row# -> col L, dedup on (contributor, contribution).\n' +
  '2026-04-12 - Added default Version.gs for clasp deploy audit trail (tokenomics).\n';

/**
 * @returns {{lastClaspPushUtc: string, changelog: string}}
 */
function getClaspMirrorDeployInfo() {
  return {
    lastClaspPushUtc: CLASP_MIRROR_LAST_CLASP_PUSH_UTC,
    changelog: CLASP_MIRROR_CHANGELOG
  };
}
