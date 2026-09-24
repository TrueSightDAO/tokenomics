# AGENTS.md — TrueSight DAO tokenomics (Google Apps Script conventions)

Standing conventions for AI agents (and humans) editing the Apps Script projects under
`google_app_scripts/`. These are **rules**, not suggestions: a PR that violates them should
be sent back.

## 1. Every scanner MUST be exposed via `doGet` (STANDING CONVENTION)

A **scanner** is a top-level, zero-argument function that reads the Telegram Chat Logs intake
and mirrors rows into a ledger / private sheet — e.g.
`processSomethingFromTelegramChatLogs()` or `processBatch()`.

In any Apps Script project that hosts **more than one** scanner, **every** scanner MUST:

1. **Be reachable via a `doGet` `?action=<FunctionName>` branch.** The project's unified
   router (`qr_code_web_service.js` → `doGet(e)`) dispatches on `?action=`. This gives each
   scanner two fire paths — Edgar's post-verify webhook **and** an operator HTTP call — so a
   scanner can be re-armed, back-filled, or smoke-tested without opening the editor.
   *Why this rule exists (2026-09-24):* `processPlotFinancingEvents…` and `processBatch` were
   unreachable over HTTP; when an operator deleted all project triggers there was no way to
   re-arm them remotely. This convention closes that silent-failure class.
2. **Carry an idempotent, in-run hourly self-installer** — `ensure<X>HourlyTriggerInstalled_()`,
   called from inside the scanner and guarded by `ScriptApp.getProjectTriggers()` so re-runs are
   no-ops. The trigger is created by the web app's executing identity (the script
   `owner_email`), so it inherits that account's sheet access; the owner must therefore be an
   account with access to the private target sheet.
3. **Register its name** in the router's scanner registry — `scannerFunctions_()` and
   `scannerTriggerInstallers_()` in `qr_code_web_service.js`. The registry also powers the
   one-shot `?action=installAllScannerHourlyTriggers` lever.

**Guard.** `scripts/test_gas_scanner_exposure.py` locks the convention: it derives the scanner
set from source and fails if any scanner lacks a `doGet` branch, a self-installer, or a
registry entry.

## 2. Deploying a project — manifest-driven; the DEPLOY identity IS the RUNTIME identity

Use `scripts/deploy_gas_project.py <scriptId> [--push] [--with-hooks]` (dry-run by default).
It syncs tracked source → `clasp_mirrors/<scriptId>/`, runs `clasp push --force`, and refuses on
a **clasp-identity mismatch** (active clasp account ≠ manifest `owner_email`).

- ⚠ **The deploy identity IS the runtime identity.** `appsscript.json` sets
  `webapp.executeAs = USER_DEPLOYING`, so the deployed web app executes as the account that
  *deployed* it (the clasp account) — **NOT** necessarily the script `owner_email`. Deploy as
  an account that can open **every** target sheet the web app touches, including private
  sheets. (2026-09-24 incident: repointing `1MnAsIQA…` as `admin@truesight.me` — which then
  lacked access to the private `cfr program` sheet — turned both private CFR sinks into
  `PERMISSION_DENIED` for anonymous `/exec` calls; healed by granting `admin` sheet access.)
- clasp reads **`~/.clasprc.json` only**. To push as a given account, swap that file in:
  `cp ~/.clasprc.json ~/.clasprc.json.bak && cp ~/.clasprc-admin.json ~/.clasprc.json` →
  deploy → restore.
- ⚠ The `1MnAsIQAx…` mirror historically carried stale `.js` duplicates alongside the synced
  `.gs` (→ "Conflicting files found"). The manifest deployer strips manifest-unclaimed files;
  verify the mirror's file set before pushing.
- New scripts should be created via `clasp create` so the manifest entry (`owner_email`,
  `deployments`) is populated — do not hand-author a scriptId.

## 3. Source ↔ production reconciliation (CORRECTED 2026-09-24)

An earlier note warned that `qr_code_web_service.gs` (this project) was **behind** production.
**That is now FALSE.** As of 2026-09-24 the tracked source is a **strict superset** of the live
`/exec` — verified: prod has **0** unique lines vs `google_app_scripts/` source for both
`qr_code_web_service.js` and `process_payout_event_telegram_logs.js`. Corollaries:

- A manifest deploy of this project is a **safe upgrade**, not a regression — provided the
  deploy identity can open **every** target sheet (see §2 — the deploy identity is the
  runtime identity) and the mirror is clean. For `1MnAsIQA…` the canonical deploy identity is
  `admin@truesight.me` (script owner; granted access to the private `cfr program` sheet
  2026-09-24).
- **Standing practice:** treat any *prod-only* line (present live, absent in source) as a
  blocker — back-port it into `google_app_scripts/` before deploying. Absence of prod-only
  lines = go.
