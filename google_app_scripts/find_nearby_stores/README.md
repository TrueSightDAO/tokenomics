# find_nearby_stores — Google Apps Script (partial canonical)

Apps Script project: **Agroverse - Stores Nearby**
Script ID: `1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2`
Editor: https://script.google.com/home/projects/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/edit
Deployed `/exec`: see `clasp_mirrors/1NpHrKJW…/.clasp.json` and `dapp/routes.js` (`Routes.gas.stores`).

## What this folder canonicalizes (and what it does not)

| File | Canonical here? | Notes |
|------|-----------------|-------|
| `process_retail_field_reports_telegram_logs.gs` | **Yes** | Async scanner + helpers. Triggered by Edgar (`?action=processRetailFieldReportsFromTelegramChatLogs`) after every `[RETAIL FIELD REPORT EVENT]` is logged to `Telegram Chat Logs`. |
| `Code.js` (everything else: `doGet`, `findNearbyStores`, `updateStoreStatus`, `add_store`, `log_field_report_attachment`, `ensureStoresVisitsFieldReportsSheet_`, `appendStoresVisitsFieldReportRow_`, `linkFieldReportUrlsToDappRemarks_`, …) | **No** — only in `clasp_mirrors/1NpHrKJW…/Code.js` (gitignored) | Migration to this folder is a separate task. |

The async scanner depends on `updateStoreStatus`, `appendStoresVisitsFieldReportRow_`, `ensureStoresVisitsFieldReportsSheet_`, and `linkFieldReportUrlsToDappRemarks_` from the legacy `Code.js`. Clasp combines all `.js` / `.gs` files in the mirror into one script project, so the dependency resolves at deploy time.

## Sync to mirror (manual, until full canonicalization)

From `tokenomics/` root, after editing this folder:

```bash
cp google_app_scripts/find_nearby_stores/process_retail_field_reports_telegram_logs.gs \
   clasp_mirrors/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/process_retail_field_reports_telegram_logs.js

cp google_app_scripts/_clasp_default/Version.gs \
   clasp_mirrors/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/Version.gs

cd clasp_mirrors/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/
clasp push
clasp deploy --deploymentId <existing-deployment-id> --description "<changelog>"
```

Then in `Code.js` (mirror only — gitignored), add a branch to the existing `doGet`:

```javascript
// Async retail field report scanner (Telegram Chat Logs → Hit List + DApp Remarks
// + Stores Visits Field Reports). Triggered by Edgar `submit_contribution`.
if (e.parameter.action === 'processRetailFieldReportsFromTelegramChatLogs') {
  var out = processRetailFieldReportsFromTelegramChatLogs();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
```

Place it next to `if (e.parameter.action === 'log_field_report_attachment') { … }`.

## Cron safety net (optional, recommended)

In the Apps Script editor → **Triggers** → add a time-driven trigger:

- Function: `processRetailFieldReportsFromTelegramChatLogs`
- Type: Time-driven
- Frequency: Every 30 minutes (mirrors `processRepackagingBatchesFromTelegramChatLogs` / `parseTelegramChatLogs`)

Idempotent (dedup on `update_id` in **Stores Visits Field Reports** col G), so concurrent fires are safe.

## Why a scanner (and not a direct Edgar→GAS call)?

`Edgar` cannot reliably issue a synchronous server-to-server call to GAS for every event:
GAS web app responses can take 30+ seconds, and `WebhookTriggerWorker` (Sidekiq) is the
canonical async path. The same pattern is used by:

- `processSalesTelegramLogs` / `parseTelegramChatLogs` (sales)
- `processQRCodeGenerationTelegramLogs` (QR code generation)
- `processRepackagingBatchesFromTelegramChatLogs` (repackaging)

Edgar's only synchronous job for `[RETAIL FIELD REPORT EVENT]` is:
1. Verify signature.
2. Append to `Telegram Chat Logs` (col G).
3. Upload the attachment to GitHub at the deterministic blob URL embedded in the payload.
4. Enqueue this scanner via `WebhookTriggerWorker` (`?action=processRetailFieldReportsFromTelegramChatLogs`).

Everything else — Hit List Status, DApp Remarks, Stores Visits Field Reports — happens here.
