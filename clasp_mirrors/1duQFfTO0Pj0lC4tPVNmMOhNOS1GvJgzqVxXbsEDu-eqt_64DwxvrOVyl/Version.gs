/**
 * @fileoverview Deploy metadata for tdg_inventory_management Apps Script projects.
 *
 * After every `clasp push` from a clasp mirror folder:
 * 1. Set TDG_INVENTORY_LAST_CLASP_PUSH_UTC to the current UTC time (ISO-8601).
 * 2. Prepend one line to TDG_INVENTORY_CHANGELOG with date + what changed.
 * 3. Copy this file into each clasp mirror you push, then push again if needed.
 *
 * Run `getTdgInventoryDeployInfo()` in the Apps Script editor to print the active log.
 */

/** ISO UTC timestamp of the last clasp push for mirrors that include this file */
var TDG_INVENTORY_LAST_CLASP_PUSH_UTC = '2026-04-12T20:10:00Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var TDG_INVENTORY_CHANGELOG =
  '2026-04-12 — Version.gs: deploy metadata (last clasp push UTC + changelog) added to Parse Telegram, offchain ledger, and managed AGL clasp projects; source in tokenomics google_app_scripts/tdg_inventory_management (dfc39c3).\n' +
  '2026-04-12 — process_sales_telegram_logs: skip Grok when any known QR token appears in message; normalize Unicode dashes/NBSP; normalize Telegram message ids; discard Grok result if QR already on QR Code Sales (tokenomics df9dd4c).\n' +
  '2026-04-12 — process_sales_telegram_logs: first-pass heuristic duplicate skip + extractQrCodeAndPrice(lookup) (tokenomics 8bd3dda).\n' +
  '2026-04-12 — QR Code Sales: columns O/P (cash collector / sold-by), Q tracking; sales_update_main_dao_offchain_ledger + sales_update_managed_agl_ledgers use O for cash line and P for inventory line; sentiment_importer Stripe row padded through Q (tokenomics ff43236 + sentiment_importer).\n';

/**
 * @returns {{lastClaspPushUtc: string, changelog: string}}
 */
function getTdgInventoryDeployInfo() {
  return {
    lastClaspPushUtc: TDG_INVENTORY_LAST_CLASP_PUSH_UTC,
    changelog: TDG_INVENTORY_CHANGELOG
  };
}
