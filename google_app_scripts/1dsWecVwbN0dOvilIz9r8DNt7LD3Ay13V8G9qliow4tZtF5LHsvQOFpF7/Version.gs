/**
 * Apps Script editor:
 * https://script.google.com/home/projects/1QtK-InsHH6SBtxoxc33-y4vQvuNkbhlkUi_9S1X-AaEgIlSlygM1iZtP/edit
 * (Inventory automation uses multiple clasp mirrors; primary web app scriptId above.)
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
var TDG_INVENTORY_LAST_CLASP_PUSH_UTC = '2026-09-13T17:36:39Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var TDG_INVENTORY_CHANGELOG =
  '2026-09-13 - RESERVATION feature (unit 3 of RESERVATION_EVENT_SPEC): added "Reservation Telegram Logs.js" (processReservationTelegramLogs - QR -> RESERVED, books the +USD cash leg only, no inventory/liability rows) and "Reservation Settlement Telegram Logs.js" (processReservationSettlementTelegramLogs - books legs 1+3: -1 inventory off holder, +1 Cacao Tree To Be Planted Liability to SunMint Tree Planting Contract - <agl>; QR -> SOLD + Sold Date; notifies via inlined sendTransactionCompletionNotification per Ruled #6). Extended doGet with both actions; resolver resolves agroverse.shop shortcuts via inlined resolveRedirect (thread 26819).\n' +
  '2026-09-13 - REPAIR: renamed repo file process_sales_telegram_logs.js -> \'Parse Telegram ChatLogs.js\' to match the live remote name, synced SOLD_DATE_COL 22->26 (Column AA) from live v14, and removed the parser from .claspignore. Root cause of the 2026-08-21 HEAD deletion: clasp push replaces the whole remote file list, and the name mismatch + ignore rule meant the parser could never ship and got dropped from HEAD (still served by pinned deployment v14). A push from this folder now yields exactly the live 4-file set (thread 26819).\n' +
  '2026-09-13 - Tracked Credentials.js in git (secret-free: seeds REPLACE_ME placeholders + reads Script Properties only) via a targeted .gitignore negation, so a clasp push from this folder can never again delete the live accessor (2026-08-21 incident); bumped Version (thread 26819).\n' +
  '2026-04-30 — updateStripeCheckoutMetadata: validate Stripe session ID format (cs_live_* or cs_test_*) before searching checkout sheet; skips cash/manual sales silently instead of logging "No Stripe row found" (tokenomics).\n' +
  '2026-04-21 — process_sales_telegram_logs + sales_update_main_dao_offchain_ledger + sales_update_managed_agl_ledgers: notify treasury-cache-publisher at write-completion (each needs TREASURY_CACHE_PUBLISH_SECRET script prop on its own mirror).\n' +
  '2026-04-21 — process_movement_telegram_logs: notify treasury-cache-publisher after each INVENTORY MOVEMENT batch lands (fire-and-forget; requires TREASURY_CACHE_PUBLISH_SECRET script prop on mirror 1wONDeDwZ_…).\n' +
  '2026-04-12 — QR Code Sales L–R column order: L Owner email, M Stripe Session, N Shipping, O Tracking, P Sold by, Q Cash Collected By, R Remarks; process_sales row tail + ledger scripts + sentiment_importer Stripe append aligned.\n' +
  '2026-04-12 — process_sales_telegram_logs: append QR Code Sales row with Status=IGNORED + Remarks (col R) when no sale or blocked; 18-col append (J–R); dedupe Telegram id stops repeat Grok.\n' +
  '2026-04-12 — Version.gs: deploy metadata (last clasp push UTC + changelog) added to Parse Telegram, offchain ledger, and managed AGL clasp projects; source in tokenomics google_app_scripts/tdg_inventory_management (dfc39c3).\n' +
  '2026-04-12 — process_sales_telegram_logs: skip Grok when any known QR token appears in message; normalize Unicode dashes/NBSP; normalize Telegram message ids; discard Grok result if QR already on QR Code Sales (tokenomics df9dd4c).\n' +
  '2026-04-12 — process_sales_telegram_logs: first-pass heuristic duplicate skip + extractQrCodeAndPrice(lookup) (tokenomics 8bd3dda).\n' +
  '2026-04-12 — Earlier O/P/Q attribution work (ff43236 era): intent was explicit cash vs sold-by columns; layout later standardized to O=Tracking, P=Sold by, Q=Cash (see newest changelog line).\n';

/**
 * @returns {{lastClaspPushUtc: string, changelog: string}}
 */
function getTdgInventoryDeployInfo() {
  return {
    lastClaspPushUtc: TDG_INVENTORY_LAST_CLASP_PUSH_UTC,
    changelog: TDG_INVENTORY_CHANGELOG
  };
}
