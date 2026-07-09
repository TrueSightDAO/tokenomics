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
var CLASP_MIRROR_LAST_CLASP_PUSH_UTC = '2026-07-09T00:00:00Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var CLASP_MIRROR_CHANGELOG =
  '2026-07-09 — Decouple daily buy-back budget from Wix: getDailyTdgBuyBackBudget() + syncAllPerformanceStatistics now compute locally (30d sales/30 * min(assetPerTdg, 1-yield)). Fixes [DAILY BUYBACK PROVISION] halt since 2026-06-16. Removed stray Code.js/Credentials.js.\n' +
  '2026-05-20 — Refactored calculateAUM to read Balance Asset section (cols A-B) instead of Equity sum. Added doGet?type=aum_breakdown + PropertiesService cache.\n' +
  '2026-05-20 — Added ledger_urls dict to treasury_breakdown payload for /treasury and /aum click-through to source sheets.\n' +
  '2026-05-20 — Cached treasury_breakdown via PropertiesService — /treasury endpoint now serves in ~3s instead of ~22s. updateUSD_TREASURY_BALANCE refreshes the cache as a side effect of every cron run.\n' +
  '2026-05-20 — Added doGet?type=treasury_breakdown + per-AGL DAO equity helpers for truesight.me /treasury page.\n' +
  '2026-04-12 — Added default Version.gs for clasp deploy audit trail (tokenomics).\n';

/**
 * @returns {{lastClaspPushUtc: string, changelog: string}}
 */
function getClaspMirrorDeployInfo() {
  return {
    lastClaspPushUtc: CLASP_MIRROR_LAST_CLASP_PUSH_UTC,
    changelog: CLASP_MIRROR_CHANGELOG
  };
}
