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

### Edgar Webhook Entry Point
- `doGet(e)` — dispatches `?action=parseAndProcessCurrencyConversionLogs`. Lets Edgar's `trigger_immediate_processing` branch fire processing in seconds instead of waiting for the 10-min cron.

---

## ⚙️ Deployment Steps (one-time)

1. **Create the intake sheet:** add a new tab named **`Currency Conversion`** to spreadsheet `1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ` with the **15-column** header (A–O) per the schema above.
2. **Add the script to the existing Apps Script project** that already hosts `capital_injection_processing.gs` (`https://script.google.com/home/projects/1orWgdGckts55owiYOysR_y4sde52T_eUmrtDGAEkb4YV5DlUfJ0JZC5J/edit`). The new file must live in the same project so it can reuse the constants and helpers from the capital-injection script.
3. **Add a time-driven trigger** for `parseAndProcessCurrencyConversionLogs` (suggested: every 10 minutes, matching Capital Injection's cadence — confirm exact cadence in the Apps Script project's existing trigger list). This stays as the cron fallback even when the Edgar webhook is wired.
4. **(Optional but recommended) Wire the Edgar immediate-trigger webhook:**
   a. In the Apps Script editor: **Deploy → New deployment → Web app**, set "Execute as: Me" and "Who has access: Anyone" — copy the resulting `/exec` URL.
   b. In `sentiment_importer/config/application.rb`: confirm the `config.currency_conversion_processing_webhook_url` block is present (added in `sentiment_importer` PR for this feature). The default reads `ENV['CURRENCY_CONVERSION_WEBHOOK_URL']`; set that env var on Edgar's host (or paste the URL inline) to the `/exec` URL from step (a).
   c. Restart Edgar via `./deploy.sh` (Edgar does NOT auto-deploy on merge; see `agentic_ai_context/NOTES_sentiment_importer.md`).
   d. Sanity check: submit a conversion from `dapp/currency_conversion.html`; the ledger should reflect it within seconds (check Edgar logs for `Currency conversion processing (Telegram Chat Logs → Currency Conversion → Managed AGL Transactions)` and the GAS logs for `Webhook triggered: parseAndProcessCurrencyConversionLogs`).
5. **Verify each managed ledger** that you intend to use has a `Transactions` sheet with the standard 6-column shape (A: Date, B: Description, C: Entity, D: Amount, E: Type/Currency, F: Category). New ledgers (e.g. `TRIBO_MIRIM_BAHIA`) will need this tab created before the processor can write to them.
6. **Smoke test:** call `testParseCurrencyConversionMessage()` from the Apps Script editor, then submit a real conversion via `dapp/currency_conversion.html` against a sandbox managed ledger and confirm both rows appear in `Transactions` with the Warehouse Manager as the Entity.

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
- [ ] **Pending operator action:** create `Currency Conversion` tab on Telegram & Submissions spreadsheet (15 columns A–O per schema)
- [ ] **Pending operator action:** paste script into Apps Script project + add time trigger
- [ ] **Pending operator action:** deploy GAS as Web App + set CURRENCY_CONVERSION_WEBHOOK_URL env on Edgar host + `./deploy.sh`
- [ ] **Pending operator action:** smoke test against sandbox managed ledger

---

**Status:** ✅ Code complete; pending one-time operator deployment steps above.
