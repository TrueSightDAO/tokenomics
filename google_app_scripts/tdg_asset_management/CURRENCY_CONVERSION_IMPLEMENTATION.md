# Currency Conversion Processing Implementation

**Created:** May 10, 2026
**Script:** `currency_conversion_processing.gs`
**Location:** `google_app_scripts/tdg_asset_management/`
**Front-end:** `dapp/currency_conversion.html`

---

## 📋 Overview

Implements automated processing of `[CURRENCY CONVERSION EVENT]` submissions for managed AGL ledgers (e.g. AGL16, TRIBO_MIRIM_BAHIA, …). Each submission represents a single off-platform conversion (Wise USD→BRL, SEPA EUR transfer, etc.) and is booked as a double-entry pair (source debit + target credit) on the target ledger's `Transactions` sheet, so multi-currency `Balance` aggregates resolve correctly.

This is the multi-currency sibling of `capital_injection_processing.gs`. Where Capital Injection always books +USD Assets / +USD Equity, Currency Conversion books `-source / +target` across two different currencies in the same Asset class.

---

## 🎯 Key Features

### 1. Double-Entry Accounting (multi-currency)
Each conversion creates TWO transactions in the target managed ledger's `Transactions` sheet:
- **Source debit:** `-source_amount` with Type=source_currency, Category="Assets" (asset reduction in the spent currency)
- **Target credit:** `+target_amount` with Type=target_currency, Category="Assets" (asset increase in the received currency)

The signed-amount convention matches `tdg_expenses_processing.gs` (negative = asset reduction). `Balance` totals computed as `SUM(amount) GROUP BY currency` remain correct.

### 2. Digital Signature Validation
- **Required:** no fallback to Telegram names
- **Validates:** against the `Contributors Digital Signatures` sheet (status must be `ACTIVE`)
- Reuses `findContributorByDigitalSignature()` from `capital_injection_processing.gs`

### 3. Managed Ledgers Only
- Only processes conversions for managed AGL ledgers (validated against `Shipment Ledger Listing`)
- Reuses `getLedgerConfigsFromWix()` and `validateManagedLedger()` from `capital_injection_processing.gs`

### 4. Fee / FX Loss Handling
By default, the difference between `source_amount` and `target_amount` (at the receipt's implied rate) silently absorbs any provider fee, FX spread, or rounding. Books stay internally consistent within each currency, but cross-currency equity drift is not booked separately. If you need explicit fee accounting, append a third row by hand against an `Expenses` category.

---

## 📊 Sheet Structure: `Currency Conversion`

**Spreadsheet:** TrueSight DAO Telegram & Submissions (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`)
**Sheet name:** `Currency Conversion` — must be created manually before first run (header row 1).
**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Message ID | Number | Source message ID |
| C | Currency Conversion Log Message | String | Full submission message |
| D | Reporter Name | String | Validated via digital signature |
| E | Warehouse Manager | String | **Entity for both Tx rows.** Whose source-currency balance is debited and target-currency balance is credited. Defaults to Reporter Name if missing. |
| F | Ledger Name | String | Target ledger (e.g., "AGL16") |
| G | Ledger URL | String | Resolved ledger URL |
| H | Source Currency | String | e.g. "USD" |
| I | Source Amount | Number | Positive (amount that LEFT the source account) |
| J | Target Currency | String | e.g. "BRL" |
| K | Target Amount | Number | Positive (amount that ARRIVED in the target account) |
| L | Conversion Date | Date | YYYYMMDD |
| M | Description | String | Free-text description |
| N | Status | String | "NEW", "PROCESSED", "FAILED" |
| O | Ledger Lines Number | String | "row1,row2" (debit row, credit row) |

---

## 🔄 Processing Flow

```
1. User submits via dapp/currency_conversion.html
   ↓
2. Submission POSTed to Edgar /dao/submit_contribution → Telegram Chat Logs col G
   ↓
3a. (Immediate) Edgar dao_controller#trigger_immediate_processing matches
    [CURRENCY CONVERSION EVENT] → enqueues WebhookTriggerWorker against
    config.currency_conversion_processing_webhook_url with action=parseAndProcessCurrencyConversionLogs
3b. (Cron fallback) Time-driven Apps Script trigger fires the same function every ~10 min
   ↓
4. parseAndProcessCurrencyConversionLogs() detects [CURRENCY CONVERSION EVENT]
   ↓
5. Parse: Ledger, Warehouse Manager, Source/Target Currency+Amount, Date, Description, Digital Signature
   ↓
6. Validate: Digital signature → get Reporter Name (Warehouse Manager defaults to Reporter if missing)
   ↓
7. Insert: record into "Currency Conversion" sheet (Status: "NEW")
   ↓
8. processNewCurrencyConversions() finds Status="NEW" records
   ↓
9. Validate: Ledger URL matches managed ledgers (Shipment Ledger Listing)
   ↓
10. Insert: source-debit row into target ledger "Transactions" sheet (Entity = Warehouse Manager)
    ↓
11. Insert: target-credit row into target ledger "Transactions" sheet (Entity = Warehouse Manager)
    ↓
12. Update: Status="PROCESSED", Ledger Lines="row1,row2"
    ↓
13. Notify treasury-cache publisher (best-effort)
```

---

## 📝 Submission Format

Generated by `dapp/currency_conversion.html`:

```
[CURRENCY CONVERSION EVENT]
- Ledger: AGL16
- Ledger URL: https://docs.google.com/spreadsheets/d/.../edit
- Warehouse Manager: Gary Teh
- Source Currency: USD
- Source Amount: 1000
- Target Currency: BRL
- Target Amount: 4985
- Implied Rate: 1 USD = 4.985 BRL
- Conversion Date: 20260510
- Description: Wise transfer USD->BRL to Rendimento for May payout
- Attached Filename: wise_receipt.pdf
- Destination Currency Conversion File Location: https://github.com/TrueSightDAO/.github/tree/main/assets/currency_conversion_1234567890_wise_receipt.pdf
--------

My Digital Signature: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8...

Request Transaction ID: abc123xyz...

This submission was generated using https://dapp.truesight.me/currency_conversion.html

Verify submission here: https://dapp.truesight.me/verify_request.html
```

---

## 💾 Ledger Transaction Format

Both transactions inserted into target ledger's `Transactions` sheet:

### Transaction 1: Source debit (asset reduction)
| Column | Value |
|--------|-------|
| A (Date) | Conversion Date (YYYYMMDD) |
| B (Description) | Full Currency Conversion Log Message |
| C (Entity) | **Warehouse Manager** (defaults to Reporter Name if missing) |
| D (Amount) | **Negative** source_amount |
| E (Type/Currency) | Source currency code (e.g. "USD") |
| F (Category) | **"Assets"** |

### Transaction 2: Target credit (asset increase)
| Column | Value |
|--------|-------|
| A (Date) | Conversion Date (YYYYMMDD) |
| B (Description) | Full Currency Conversion Log Message |
| C (Entity) | **Warehouse Manager** (defaults to Reporter Name if missing) |
| D (Amount) | **Positive** target_amount |
| E (Type/Currency) | Target currency code (e.g. "BRL") |
| F (Category) | **"Assets"** |

---

## 🔧 Main Functions

### Core Processing
- `parseAndProcessCurrencyConversionLogs()` — main entry point, scans Telegram logs for `[CURRENCY CONVERSION EVENT]`, validates, inserts intake row.
- `processNewCurrencyConversions()` — finds Status="NEW" rows in `Currency Conversion`, validates managed ledger, writes the double-entry pair.
- `parseCurrencyConversionMessage(message)` — extracts all fields from a submission message.
- `insertCurrencyConversionRecord(...)` — writes one row to the `Currency Conversion` intake sheet (with dedup check).
- `currencyConversionRecordExists(updateId, messageId)` — dedup probe.

### Reused (live in `capital_injection_processing.gs` — same Apps Script project, shared globals)
- `resolveRedirect(url)`
- `getLedgerConfigsFromWix()`
- `findContributorByDigitalSignature(signature)`
- `validateManagedLedger(url, configs)`
- `notifyTreasuryCachePublisher_(trigger)`
- Constants: `TELEGRAM_LOGS_URL`, `TELEGRAM_LOGS_SHEET`, `TELEGRAM_MESSAGE_COL`, `TELEGRAM_UPDATE_ID_COL`, `TELEGRAM_MESSAGE_ID_COL`, `TELEGRAM_STATUS_COL`

### Test Functions
- `testParseCurrencyConversionMessage()`
- `testProcessNewCurrencyConversions()`

### Trigger management (run once from the Apps Script editor; no underscore so they show up in the Run dropdown)
- `installTimeTrigger()` — idempotently installs the 10-min time-driven trigger for `parseAndProcessCurrencyConversionLogs`. First run pops the OAuth consent dialog for the `script.scriptapp` scope (in the manifest below).
- `listTriggers()` — returns the project's active triggers as JSON (handler / eventType / uniqueId). Useful for quick sanity checks without opening the Triggers UI.

### Edgar Webhook Entry Point
- `doGet(e)` — dispatches three actions; the first is what Edgar fires, the other two let you manage the cron from anywhere with the `/exec` URL once the manifest scope has been granted:
  - `?action=parseAndProcessCurrencyConversionLogs` (Edgar's immediate-trigger path)
  - `?action=installTimeTrigger`
  - `?action=listTriggers`

---

## ⚙️ Deployment Steps (one-time, all done as of 2026-05-10)

The following are done in production. Re-run any of them when standing up an analogous flow on a new project.

1. **Intake sheet — done.** `Currency Conversion` tab on spreadsheet `1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ` (gid `1286252879`) with the 15-column header (A–O) per the schema above. Created via Sheets API using `market_research/google_credentials.json` (the `agroverse-market-research@get-data-io...` service account; the `tokenomics-schema@...` SA is read-only on this sheet).
2. **GAS in same Apps Script project as `capital_injection_processing.gs` — done.** Pushed via `clasp push` from `tokenomics/clasp_mirrors/1orWgdGckts55owiYOysR_y4sde52T_eUmrtDGAEkb4YV5DlUfJ0JZC5J/CurrencyConversion.js`. The mirror's `appsscript.json` had to be expanded with a `webapp` block AND `oauthScopes` (see "Manifest" below) — without those, deployment as Web App returns 404 / trigger management hits "permission denied".
3. **Time-driven trigger — done.** Installed by running the new `installTimeTrigger()` function once from the Apps Script editor (not from the Run-button dropdown if it ends in `_` — Apps Script hides trailing-underscore "private" functions from the editor list). First run pops the OAuth consent dialog for the `script.scriptapp` scope; after grant, the trigger persists. Verify any time with `?action=listTriggers`.
4. **Edgar immediate-trigger webhook — done.** Web App `/exec` URL is deployment ID `AKfycby8bOb0iEfJh-Io90fK-NQRpC6BlLC66e6MCr3JvyOEi-UDH-TkwYSsdeXKuhkpsU4` (use `clasp deploy -i <id>` to update in place — keeps the URL stable so Edgar config doesn't need re-syncing). On Edgar (`seni_ror_new`), the URL is set via systemd drop-in `/etc/systemd/system/seni_ror.service.d/override.conf`:
   ```
   [Service]
   Environment="CURRENCY_CONVERSION_WEBHOOK_URL=https://script.google.com/macros/s/AKfycby8.../exec"
   ```
   followed by `sudo systemctl daemon-reload && sudo systemctl restart seni_ror`. Drop-in over override-the-main-unit is intentional — the AMI-baked unit gets re-pulled on every boot and would otherwise lose this setting.
5. **Per-managed-ledger Transactions tab.** Each managed ledger that's a valid target (e.g. `TRIBO_MIRIM_BAHIA`) must have a `Transactions` sheet with the standard 6-column shape (A: Date, B: Description, C: Entity, D: Amount, E: Type/Currency, F: Category). The processor will fail-fast on the intake row (Status="FAILED") if the tab is missing.
6. **Smoke test:** submit a real conversion via `dapp/currency_conversion.html` against a sandbox managed ledger and confirm both rows appear in the target's `Transactions` tab with the **Warehouse Manager** as the Entity.

### Manifest (`appsscript.json` in the clasp mirror — gitignored, lives only in the deployed project)

```json
{
  "timeZone": "America/Sao_Paulo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp"
  ],
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

The `script.scriptapp` scope is what gates `installTimeTrigger()` / `listTriggers()`. `script.external_request` covers `notifyTreasuryCachePublisher_`'s outbound `UrlFetchApp.fetch`. `spreadsheets` covers all the sheet reads / writes.

---

## 🔐 Security

1. **Digital Signature Required:** no processing without valid `ACTIVE` signature.
2. **Managed Ledgers Only:** validates against `Shipment Ledger Listing` registry.
3. **Currencies must differ:** `source !== target` enforced at parse-time and processing-time.
4. **Audit Trail:** full log message preserved in column C of `Currency Conversion` AND in column B of both ledger transactions.

---

## 📚 Documentation

- **SCHEMA.md:** Currency Conversion section added under the Telegram & Submissions spreadsheet.
- **Script Header:** repository link + canonical submission format embedded.
- **Test Functions:** parsing + processing covered.

---

## 🔭 Open follow-up: managed-ledger explorer JSON

A new explorer pattern landed at `agentic_ai_context/MANAGED_LEDGER_EXPLORER_PATTERN.md` that publishes a per-ledger transactions snapshot to **`treasury-cache/managed-ledgers/<ledger_name>.json`** for a public read-only explorer (e.g. `mirim-bahia.truesight.me` consuming `treasury-cache/managed-ledgers/tribomirimbahia.json`).

This processor currently writes to the Google Sheet `Transactions` tab and (best-effort) calls `notifyTreasuryCachePublisher_('currency_conversion')` for the offchain treasury cache. It does **not** yet refresh the per-managed-ledger JSON. To close the loop:

- Either: extend `notifyTreasuryCachePublisher_` (or add a sibling `notifyManagedLedgerSnapshotPublisher_(ledgerName)`) to PUT the per-ledger snapshot to `treasury-cache/managed-ledgers/<ledger_name>.json` via the GitHub Contents API after each successful processing run.
- Or: have an independent publisher GAS / cron read the ledger's Transactions tab on a schedule and rebuild the JSON.

Schema and naming convention live in `agentic_ai_context/MANAGED_LEDGER_EXPLORER_PATTERN.md`; bootstrap example in `treasury-cache/managed-ledgers/tribomirimbahia.json`.

---

## 🔗 Related Files

- **Frontend:** [`dapp/currency_conversion.html`](https://github.com/TrueSightDAO/dapp/blob/main/currency_conversion.html)
- **Backend:** [`google_app_scripts/tdg_asset_management/currency_conversion_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/currency_conversion_processing.gs)
- **Schema:** `SCHEMA.md` (Currency Conversion section)
- **Sibling:** `CAPITAL_INJECTION_IMPLEMENTATION.md` (USD-only single-account analog)
- **Helper source:** `capital_injection_processing.gs` (shared constants + helpers)

---

## ✅ Implementation Checklist

- [x] Created `currency_conversion_processing.gs`
- [x] Implemented multi-currency double-entry (source debit + target credit)
- [x] Digital signature validation (required, no fallback) — reused helper
- [x] Managed ledger validation — reused helper
- [x] Message parsing with strict required-field check
- [x] Status tracking (NEW → PROCESSED/FAILED)
- [x] Ledger lines tracking (comma-separated)
- [x] Dedup on `Telegram Update ID + Message ID`
- [x] Same/different currency guardrails
- [x] Test functions
- [x] Documentation in SCHEMA.md
- [x] Front-end page (`dapp/currency_conversion.html`) wired into `menu.js`
- [x] Warehouse Manager column (E) added; written to Entity column of both Tx rows
- [x] doGet(?action=parseAndProcessCurrencyConversionLogs) for Edgar immediate-trigger
- [x] Edgar branch + config in sentiment_importer for `[CURRENCY CONVERSION EVENT]`
- [x] **Done 2026-05-10:** `Currency Conversion` tab created (gid 1286252879) with 15 columns A–O
- [x] **Done 2026-05-10:** Script pushed via `clasp push` to project `1orWgdGckts...UfJ0JZC5J`
- [x] **Done 2026-05-10:** Web App deployed (deployment ID `AKfycby8bOb0iEfJh-Io90fK-NQRpC6BlLC66e6MCr3JvyOEi-UDH-TkwYSsdeXKuhkpsU4`); `CURRENCY_CONVERSION_WEBHOOK_URL` set on `seni_ror_new` via systemd drop-in
- [x] **Done 2026-05-10:** Time trigger installed via `installTimeTrigger()` (verified via `?action=listTriggers` — handler `parseAndProcessCurrencyConversionLogs`, eventType `CLOCK`)
- [ ] **Pending operator action:** smoke test against a real managed ledger by submitting from `dapp/currency_conversion.html`

---

**Status:** ✅ Code complete; pending one-time operator deployment steps above.
