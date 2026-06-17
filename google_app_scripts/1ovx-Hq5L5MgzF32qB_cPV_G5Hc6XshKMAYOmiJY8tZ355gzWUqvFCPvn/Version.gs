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
var CLASP_MIRROR_LAST_CLASP_PUSH_UTC = '2026-05-11T03:30:00Z';

/**
 * Newest first. Keep lines short; link PRs/commits in git instead of pasting secrets.
 */
var CLASP_MIRROR_CHANGELOG =
  '2026-05-11 — Added createLedgerCheckoutSession (generic [LEDGER_ID]-prefixed Stripe Checkout for any managed ledger; first user: capoeira.agroverse.shop → TBM). See agentic_ai_context/STRIPE_LEDGER_ROUTING.md Flow 4.\n' +
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
