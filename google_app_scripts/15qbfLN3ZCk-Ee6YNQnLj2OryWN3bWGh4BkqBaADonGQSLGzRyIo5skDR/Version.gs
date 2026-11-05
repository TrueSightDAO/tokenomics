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
var CLASP_MIRROR_LAST_CLASP_PUSH_UTC = '2026-05-11T05:45:00Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var CLASP_MIRROR_CHANGELOG =
  '2026-05-11 — routeStripeCheckoutPurchasesToLedgers: Description leads with cs_…  session id (prominent dedup + viewer-recognizable). Write fee as a second negative-amount row (Type=Assets) when col L (Stripe Transaction Fee) has a positive value; mirrors Flow 3 SaaS pattern.\n' +
  '2026-05-11 — routeStripeCheckoutPurchasesToLedgers: Type=Assets (accounting category, matches managed-ledger Sheet convention). Stripe-event sub-type now lives in Description via session id; explorer detects Stripe via cs_(test|live)_ regex.\n' +
  '2026-05-11 — routeStripeCheckoutPurchasesToLedgers: Type=stripe_donation (was Sale) so tribomirimbahia.truesight.me explorer counts as Inflow; matches the keyword filter in index.html#renderSummary.\n' +
  '2026-05-11 — routeStripeCheckoutPurchasesToLedgers: write ISO-8601 (yyyy-MM-dd) dates so tribomirimbahia.truesight.me explorer parses them; was yyyyMMdd which rendered as "Invalid Date".\n' +
  '2026-05-11 — routeStripeCheckoutPurchasesToLedgers: Entity = FUND_HANDLER ("Gary Teh", validation-friendly); session id embedded in Description + dedup pre-check scans destination Transactions tab so a row cant double-write even if audit-tab col P got cleared.\n' +
  '2026-05-11 — routeStripeCheckoutPurchasesToLedgers: Entity = fixed "Stripe Customer" (donor name stays in Description) to avoid managed-ledger validation dropdown rejection.\n' +
  '2026-05-11 — Ship routeStripeCheckoutPurchasesToLedgers (regex /^\\[([A-Z0-9]+)\\]/ on Items Purchased, lookup via Shipment Ledger Listing, append to <Ledger>!Transactions, mark col P; only acts on [LEDGER_ID]-prefixed rows). See agentic_ai_context/STRIPE_LEDGER_ROUTING.md Flow 4.\n' +
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
