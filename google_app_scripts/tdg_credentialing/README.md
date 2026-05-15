# tdg_credentialing

Google Apps Script for the TrueSight DAO credentialing platform. Consumes signed `[PRACTICE EVENT]` payloads from Edgar's Telegram Chat Logs intake, parses + validates them, writes an audit row to the new **Credentialing Events** tab, and commits the event JSON into the [lineage-credentials](https://github.com/TrueSightDAO/lineage-credentials) repo.

Design doc: [`agentic_ai_context/CREDENTIALING_PLATFORM.md`](https://github.com/TrueSightDAO/agentic_ai_context/blob/main/CREDENTIALING_PLATFORM.md).

## One-time setup (Gary)

This script needs a **GitHub Personal Access Token** with `contents:write` scope on `TrueSightDAO/lineage-credentials`. The token lives only in the Apps Script project's Script Properties — never commit it.

1. Push this folder to its Apps Script project (clasp).
2. In the Apps Script editor: **Project Settings → Script Properties → Add property**:
   - Name: `GITHUB_TOKEN`
   - Value: `ghp_…` (a fine-grained PAT with `Contents: read & write` on `TrueSightDAO/lineage-credentials`)
3. Deploy the script as a Web App (executes as: USER_DEPLOYING, who has access: Anyone).
4. From the live deployment URL run `?action=installTimeTrigger` once to install the 10-min cron fallback.
5. Wire the deployment URL into Edgar (sentiment_importer):
   ```
   config.credentialing_processing_webhook_url =
     'https://script.google.com/macros/s/<deployment>/exec?action=parseAndProcessCredentialingLogs'
   ```
6. Add `[PRACTICE EVENT]` to Edgar's `trigger_immediate_processing` event-substring map so submissions get processed in seconds, not minutes.

## What it does

For each new row in the **Telegram Chat Logs** tab on `1qbZZhf-…` that contains `[PRACTICE EVENT]`:

1. Parses the payload (line-anchored regex per field, same defensive pattern as the post-2026-05-11 `currency_conversion_processing.gs` fix).
2. Derives the practitioner slug: `pk-` + first 12 chars of base64url(SHA-256(decoded public key)). Must match the browser's derivation in `capoeira/assets/js/practice-event-submit.js`.
3. Fetches `programs/<program>/manifest.json` from `lineage-credentials` and validates that the declared Practice Type exists.
4. Appends an intake row to the **Credentialing Events** tab on the same spreadsheet (auto-creates if missing).
5. `PUT`s the event JSON to `lineage-credentials/programs/<program>/<slug>/practice/<isoStamp>-<shortSig>.json` via the GitHub Contents API.
6. Marks the intake row PROCESSED with the commit SHA + URL.

Failures land as FAILED rows with the error message, so the cron doesn't loop on bad payloads.

## Hardening

Defensive guards baked in from day one (lessons from the 2026-05-11 currency-conversion incident):

- `[ \t]*` (not `\s*`) in field regexes so empty values don't slurp the next line.
- `appendRow` + `SpreadsheetApp.flush()` + assert `getLastRow` grew — silent noops throw to FAILED rather than landing a false PROCESSED.
- Status is only PROCESSED after the GitHub commit succeeds.
- Dedup by `(Telegram Update ID, Telegram Message ID)` so re-running is safe.
