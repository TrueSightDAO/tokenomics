# GAS orphan mirror dispositions

_Triage-and-act companion to [`docs/gas_orphan_mirror_audit.md`](gas_orphan_mirror_audit.md). Started 2026-05-29 (PR-1e)._

Each row in the original orphan-mirror audit needs an operator-confirmed disposition. This doc tracks the decision per orphan and the action taken (or recommended) — so the restructure roadmap (`TOKENOMICS_GAS_RESTRUCTURE_PLAN.md` §4) can close out the "orphan-mirror disposition" pre-flight item one row at a time.

## Actions taken in PR-1f (2026-05-29) — mint the missing mirrors

| scriptId | Owner | Action |
|---|---|---|
| `1MnAsIQAxcSfZO_hAL…` | **admin@truesight.me** (QR + tree-pledge notification) | ✅ Minted via `clasp clone` — 5 files (`appsscript.json`, `Credentials.js`, `process_donation_mint_telegram_logs.js`, `qr_code_web_service.js`, `Version.js`). |
| `1gi4YKh2ikLWmp6qEL…` | garyjob@agroverse.shop | ✅ Minted via `clasp clone` — 2 files (`Code.js`, `appsscript.json`). The redundant `google_app_scripts/seacoast_freight_quotation_ingest/.clasp.json` was `git rm`'d (the convention is one clasp project per mirror folder, not per thematic source folder). |
| `1zKgMwd6KJFjoWkRH6…` | **admin@truesight.me** (Gmail-based digital-signature ingestion) | ✅ **Minted 2026-05-29 (PR-1h).** Gary shared the GAS project from the admin@truesight.me UI with `garyjob@agroverse.shop` at Editor level, then `clasp clone` succeeded under gary@'s clasp identity. Mirror at `clasp_mirrors/1zKgMwd6KJFjoWkRH6OobgFvtVzrXVuEKfxVbgixgnfcp4TZTjrsfNKq0/`. Note: PR-1g's identity-pinning check still refuses `--push` for this scriptId under gary@'s identity — `owner_email: admin@truesight.me` enforced. Future pushes require operator to load admin@'s clasprc (Path B per-account workflow in `docs/gas_deploy_workflow.md`) or pass `--allow-identity-mismatch`. |

After this PR: audit moves from 34 healthy / 13 orphans / 3 unmirrored → **36 healthy / 13 orphans / 1 unmirrored**.

---

## Actions taken in PR-1e (2026-05-29)

| # | scriptId | Disposition | Action |
|---|---|---|---|
| 1 | `17KSH5GQW1TINr…` | **delete** — empty default GAS project (`myFunction` only, 0 KB Code.js) | `git rm clasp_mirrors/17KSH5GQ…/.clasp.json`. Operator: optionally remove the GAS project itself from `script.google.com`. |
| 6 | `1IBrXqW_uTsFkb…` | **route to source** — `agroverse_qr_codes/subscription_notification.gs`. The Code.js header pointed at this exact path; the source file was missing. | Extracted `Code.js` (82 LOC) into `google_app_scripts/agroverse_qr_codes/subscription_notification.gs` with full scriptId header. |
| 8 | `1KreecWzQ1ZRXc…` | **delete** — empty default GAS project (`myFunction` only, 0 KB Code.js) | `git rm clasp_mirrors/1Krecc…/.clasp.json`. Operator: optionally remove the GAS project itself. |
| 14 | `1o2lzpdTZBYTTF…` | **delete** — no `Code.js`, no tracked files | Local directory removed via `rm -rf`. Nothing to git-rm. |
| 16 | `1slQVojn5P2wC7…` | **delete** — no `Code.js` | `git rm clasp_mirrors/1slQVojn…/.clasp.json`. |

**Net effect:** orphan count drops 18 → 13. One new source file lands under `agroverse_qr_codes/`.

## Operator-decision-required (not actioned in PR-1e)

| # | scriptId | Hint | Recommended next action |
|---|---|---|---|
| 2 | `1CpAVMPR2mAHln…` | `duplicateAndModifyDoc`, 3.3 KB, 6 funcs | Generic doc-routing utility. Operator: confirm in use; if yes, extract source into a new thematic folder (e.g. `doc_utilities/`); if no, delete. |
| 3 | `1DYSZKFYM-PsQu…` | `fetchHelloCashArticles`, 17.4 KB, 5 funcs | News fetcher for "HelloCash". Operator: confirm if still relevant to DAO ops; route or delete accordingly. |
| 4 | `1E6XFs1X7GMqAE…` | `setEcosystemGasFees`, 9.9 KB, 14 funcs | Ecosystem-fee management. Operator: confirm live; likely belongs near `tdg_asset_management/` or its own folder. |
| 5 | `1EBoewfPK3hkHA…` | `processRecords`, 10.3 KB, 12 funcs | Generic name; operator must inspect Code.js to decide. |
| 7 | `1K1wcXFAopSA0c…` | "Gmail-based TDG Identity Management System", 12.5 KB, 12 funcs. **Code is near-identical to the source already at `tdg_identity_management/register_member_digital_signatures_email.gs`** (scriptId `1zKgMwd6K…`, owned by admin@truesight.me). | **Likely duplicate** of `1zKgMwd6K…`. Operator: confirm whether this is (a) the deprecated predecessor (delete), (b) a backup/test instance (delete or relabel), or (c) a separately live deployment (route into `tdg_identity_management/` with a distinguishing filename). |
| 9 | `1P0Mg33i_dD9x9…` | `getInventoryGitHubTarget_`, 36.1 KB, 17 funcs. **Code.js header says `File: google-app-script/update_store_inventory.gs / Repository: https://github.com/TrueSightDAO/agroverse_shop`.** | **Cross-repo source.** The canonical source already lives at `agroverse_shop/google-app-script/update_store_inventory.gs`. Leave the mirror; no action needed in tokenomics. Decide later whether to move the source into `tokenomics/google_app_scripts/tdg_inventory_management/` or leave it in `agroverse_shop` (analogous to how `voice_feedback_capture.gs` lives in `market_research`). |
| 10 | `1Uq1EHReKpXtf3…` | `File: market_research/google_apps_scripts/voice_feedback_capture.gs`, 9.0 KB, 6 funcs | **Cross-repo source** (`market_research`). Leave mirror; decide later about consolidation. |
| 11 | `1Xmwyzzauooluz…` | "Web app POST handler", 8.6 KB, 6 funcs | Operator inspect — could be a generic webhook receiver. |
| 12 | `1YpJCLtmSEFLiY…` | `placeLatokenOrder`, 3.6 KB, 3 funcs | Latoken exchange order routing. Likely belongs with `sentiment_importer` (Edgar trading-platform) work, not the DAO ops tier. Operator: deprecate-and-remove or document the link. |
| 13 | `1_jTHZZI033E0y…` | "Apps Script editor:" (header preamble — likely has full header further down), 20.8 KB, 20 funcs | Operator: inspect first ~50 lines of `Code.js` to find the canonical source path. Probably ALREADY belongs to a known thematic folder via a header comment further down. |
| 15 | `1ovx-Hq5L5MgzF…` | `getConfig`, **122.7 KB**, 33 funcs. **Biggest unrouted project.** Mail-call sweep confirmed it sends to `'garyjob@agroverse.shop'` (hardcoded). | Operator: high-priority to inspect — this is a substantial live project but completely unrouted in the source tree. |
| 17 | `1yDOuOZgfbzOll…` | `processWhatsappChatlogsToSheets`, 6.3 KB, 7 funcs | WhatsApp chat ingest. Operator: confirm live; route to a `whatsapp_workflows/` folder or deprecate. |
| 18 | `1zAXSdLe_vigsy…` | `updateWixLandingPagePrice`, 3.5 KB, 7 funcs. **Has a hardcoded Wix access token in `Code.js`** + actively calls Latoken API to sync TDG/USDT exchange rate to a Wix property. | **NOT dead** despite the `reference_truesight_me_no_wix` memory (which refers to truesight.me blog content, not all Wix usage). Operator: (a) confirm the TDG-rate-on-Wix flow is still desired; (b) if yes, rotate the embedded access token (it's been on disk in the gitignored `Code.js` since at least mid-2024); (c) route source into a new thematic folder (e.g. `wix_tdg_rate_sync/`). |

## Future automation

When operator decisions land, this doc is the durable record. As each row's disposition completes, mark it done above and re-run `scripts/audit_orphan_clasp_mirrors.py` to confirm the audit reflects reality.
