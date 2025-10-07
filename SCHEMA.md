# TrueSight DAO - Google Sheets Schema Documentation

> **Last Updated:** 2025-10-07
> 
> This document provides a consolidated reference for all Google Sheets used across TrueSight DAO's Google Apps Scripts. Use this as a central schema reference when making code changes.

## 🧪 Schema Validation

**Test Script:** `google_app_scripts/test_schema_validation.gs`

To verify this documentation is accurate, run:
```javascript
runSchemaValidationTests()
```

This validates:
- ✅ All spreadsheet IDs and sheet names
- ✅ Column structures where possible
- ✅ Wix collection accessibility
- ✅ ExchangeRate data item IDs
- 📊 Generates comprehensive test report

**Quick Tests:**
```javascript
testSpreadsheetId('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ', 'Telegram Logs')
testWixCollection('AgroverseShipments')
```

---

## 📊 Main Spreadsheets

### 1. TrueSight DAO Telegram & Submissions Spreadsheet
**Spreadsheet ID:** `1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`

**URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit

**Purpose:** Stores Telegram chat logs, scored submissions, sales data, and various event submissions

#### Sheets:

##### Sheet: `Telegram Chat Logs`
**Purpose:** Raw Telegram chat messages and events

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Unique Telegram update identifier |
| B | Chat ID | Number | Telegram chat/group ID |
| C | Chat Name | String | Telegram chatroom name |
| D | Telegram Message ID | Number | Unique message identifier |
| E | Contributor Name | String | Telegram username/handle |
| F | *(varies)* | - | Additional data |
| G | Message/Contribution | String | Full message content or contribution description |
| H-K | *(varies)* | - | Additional fields |
| L | Status Date | Date | Date of message/status |
| M | *(varies)* | - | - |
| N | Scoring Hash Key | String | SHA-256 hash for deduplication |
| O | Telegram File ID | String | Comma-separated file IDs from Telegram |

**Used by:**
- `tdg_expenses_processing.gs`
- `process_sales_telegram_logs.gs`
- `process_movement_telegram_logs.gs`
- `importer_telegram_chatlogs_to_google_sheet.gs`

---

##### Sheet: `Scored Expense Submissions`
**Purpose:** Processed and validated expense submissions

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Chat ID | Number | Source chat ID |
| C | Chat Name | String | Source chatroom name |
| D | Message ID | Number | Source message ID |
| E | Reporter Name | String | Actual contributor name (from digital signature) |
| F | Expense Reported | String | Full expense message |
| G | Status Date | Date | Date of expense |
| H | Contributor Name | String | DAO member who incurred expense |
| I | Currency/Inventory Type | String | Type of inventory |
| J | Amount | Number | Quantity (negative for expenses) |
| K | Hash Key | String | Unique identifier for deduplication |
| L | Transaction Line | Number | Row number in destination ledger |

**Used by:**
- `tdg_expenses_processing.gs`

---

##### Sheet: `QR Code Sales`
**Purpose:** Sales transactions from QR code scans

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Message ID | Number | Source message ID |
| C | Message | String | Full sale message |
| D | Contributor Name | String | Person who made the sale |
| E | QR Code | String | Scanned QR code |
| F | Sale Price | Number | Amount of sale |
| G | Agroverse Value | String | URL to ledger |
| H | Sales Date | Date | Date of sale |
| I | Inventory Type | String | Product sold |
| J | Tokenized Status | String | "PROCESSING", "ACCOUNTED", empty |
| K | Offchain Row Numbers | String | Comma-separated row numbers |

**Used by:**
- `process_sales_telegram_logs.gs`
- `sales_update_managed_agl_ledgers.gs`
- `sales_update_main_dao_offchain_ledger.gs`

---

##### Sheet: `Inventory Movement`
**Purpose:** Inventory transfers between contributors

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source update ID |
| B | Telegram Chatroom ID | Number | Source chat ID |
| C | Telegram Chatroom Name | String | Source chatroom |
| D | Telegram Message ID | Number | Source message ID |
| E | Contributor Name | String | Person reporting movement |
| F | Contribution Made | String | Full movement message |
| G | Status Date | Date | Date of movement |
| H | Sender Name | String | Person sending inventory |
| I | Recipient Name | String | Person receiving inventory |
| J | Currency | String | Inventory type (without ledger prefix) |
| K | Amount | Number | Quantity transferred |
| L | Ledger Name | String | Source ledger name (e.g., "AGL#25" or "offchain") |
| M | Ledger URL | String | Resolved spreadsheet URL |
| N | Status | String | "NEW" or "PROCESSED" |
| O | Row Numbers | String | Comma-separated destination row numbers |

**Used by:**
- `process_movement_telegram_logs.gs`

---

##### Sheet: `QR Code Generation Requests`
**Purpose:** Tracks QR code generation requests from Telegram

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source update ID |
| B | Chat ID | Number | Telegram chat ID |
| C | Contributor Name | String | Requester name |
| D | Currency Name | String | Asset type for QR codes |
| E | Quantity | Number | Number of QR codes to generate |
| F | Status | String | "NEW", "PROCESSING", "COMPLETED" |
| G | Batch ID | String | Generated batch identifier |
| H | ZIP File URL | String | Google Drive link to ZIP file |

**Used by:**
- `process_qr_code_generation_telegram_logs.gs`

---

### 2. Main TrueSight DAO Ledger & Operations Spreadsheet
**Spreadsheet ID:** `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`

**URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit

**Purpose:** Main ledger for financial transactions, assets, contributors, and voting rights

#### Sheets:

##### Sheet: `offchain transactions`
**Purpose:** Default ledger for all offchain financial transactions

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Transaction date |
| B | Description | String | Transaction description |
| C | Fund Handler | String | Person handling funds |
| D | Amount | Number | Transaction amount (negative for debits) |
| E | Inventory Type | String | Asset/currency type |

**Used by:**
- `tdg_expenses_processing.gs`
- `process_movement_telegram_logs.gs`
- All ledger update scripts

---

##### Sheet: `offchain asset location`
**Purpose:** Tracks physical inventory locations and managers

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Asset Name | String | Name of asset/inventory |
| B | Manager Names | String | Person managing the asset |
| C | Asset Quantity | Number | Quantity available |
| D+ | *(varies)* | - | Additional metadata |

**Used by:**
- `web_app.gs` (inventory management)
- `process_movement_telegram_logs.gs`

---

##### Sheet: `Contributors contact information`
**Purpose:** Master list of DAO contributors

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Full Name | String | Contributor's full name |
| B-F | *(contact info)* | - | Email, phone, address, etc. |
| G | *(varies)* | - | - |
| H | Telegram Handle | String | Telegram username (with or without @) |
| I-Q | *(varies)* | - | Additional info |
| R | Digital Signature | String | Public key (legacy location) |

**Used by:**
- All scripts for contributor validation
- `grok_scoring_for_telegram_and_whatsapp_logs.gs`
- `process_sales_telegram_logs.gs`

---

##### Sheet: `Contributors Digital Signatures`
**Purpose:** Active digital signatures for authentication

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Full name of contributor |
| B | Email Address | String | Email (optional) |
| C | Last Used Timestamp | String | Format: "YYYYMMDD HH:MM:SS" |
| D | Status | String | "ACTIVE", "INACTIVE", etc. |
| E | Digital Signature | String | Public key for authentication |
| F | *(varies)* | - | Additional metadata |

**Used by:**
- `tdg_expenses_processing.gs`
- `process_qr_code_generation_telegram_logs.gs`
- `register_member_digital_signatures_telegram.gs`
- `register_member_digital_signatures_email.gs`

---

##### Sheet: `Contributors voting weight`
**Purpose:** Tracks voting rights for DAO governance

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A-B | *(varies)* | - | - |
| C | Contributor Name | String | Full name |
| D-G | *(varies)* | - | - |
| H | Voting Rights | Number | Total voting weight |

**Used by:**
- `web_app.gs` (voting rights API)

---

##### Sheet: `Ledger history`
**Purpose:** Historical ledger transactions

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Transaction date |
| B | Description | String | Transaction description |
| C | Contributor | String | Person involved |
| D | Amount | Number | Transaction amount |
| E | Asset Type | String | Currency/asset |

**Cell E1:** Contains `voting_rights_circulated` total

**Used by:**
- `grok_scoring_for_telegram_and_whatsapp_logs.gs`
- `transfer_scored_contributions_to_main_ledger.gs`

---

##### Sheet: `off chain asset balance`
**Purpose:** Summary of offchain asset valuations

**Cell D1:** Total USD value of all offchain assets

**Used by:**
- `web_app.gs` (asset valuation API)

---

##### Sheet: `Agroverse QR codes`
**Purpose:** Master list of all generated QR codes

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | QR Code | String | QR code identifier |
| B | *(varies)* | - | - |
| C | Value | String | Associated value/URL |
| D | Status | String | "ACTIVE", "USED", etc. |
| E-H | *(varies)* | - | - |
| I | Inventory Type | String | Product type for QR |

**Used by:**
- `process_sales_telegram_logs.gs`
- `web_app.gs` (QR code management)
- `process_qr_code_generation_telegram_logs.gs`

---

##### Sheet: `Scored Chatlogs`
**Purpose:** Grok AI scored contributions from chat logs

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Chatlog Number | Number | Sequential ID |
| B | Date | Date | Contribution date |
| C | Contributor | String | Person who contributed |
| D | Contribution | String | What was contributed |
| E | Score | Number | AI-assigned score |
| F | Platform | String | "Telegram" or "WhatsApp" |

**Used by:**
- `grok_scoring_for_telegram_and_whatsapp_logs.gs`
- `transfer_scored_contributions_to_main_ledger.gs`

---

##### Sheet: `Recurring Tokenization`
**Purpose:** Monthly recurring token distributions

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Person receiving tokens |
| B | Description | String | Reason for recurring payment |
| C | Amount | Number | Monthly amount |
| D | End Date | Date | When recurring payment ends |
| E | Currency | String | Token/currency type |

**Used by:**
- `tdg_recurring_tokenization_monthly.gs`

---

## 🔗 Managed AGL Ledgers (Dynamic)

### Structure: Individual Shipment/Contract Ledgers
**Source:** Fetched dynamically from Wix AgroverseShipments collection

**Naming Convention:** e.g., "AGL#1", "AGL#25", "Sacred Earth Farms", etc.

**Purpose:** Track inventory and transactions for specific shipments/contracts

#### Sheet: `Transactions`
**Purpose:** All financial transactions for the specific ledger

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Date | Date | Transaction date |
| B | Description | String | Transaction description |
| C | Entity | String | Person/organization involved |
| D | Amount | Number | Transaction amount |
| E | Type/Currency | String | Asset or currency type |
| F | Category | String | "Assets" or "Liability" |

**Used by:**
- `tdg_expenses_processing.gs`
- `sales_update_managed_agl_ledgers.gs`
- `process_movement_telegram_logs.gs`

---

#### Sheet: `Balance`
**Purpose:** Current balance/inventory status for ledger

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A-G | *(varies)* | - | - |
| H | Manager Names | String | Inventory manager |
| I | Asset Quantity | Number | Current quantity |
| J | Asset Name | String | Name of asset |

**Row 6+:** Data starts at row 6

**Used by:**
- `web_app.gs` (inventory queries)
- Ledger balance calculations

---

## 📋 Additional Reference Spreadsheets

### 3. Grok Scored Contributions Origin
**Spreadsheet ID:** `1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo`

**Purpose:** Origin spreadsheet for scored contributions before transfer

**Used by:**
- `transfer_scored_contributions_to_main_ledger.gs`

---

## 🔍 Common Patterns & Constants

### Column Index Patterns (0-based)
```javascript
// Telegram Chat Logs
TELEGRAM_UPDATE_ID_COL = 0    // Column A
CHAT_ID_COL = 1               // Column B
CHAT_NAME_COL = 2             // Column C
TELEGRAM_MESSAGE_ID_COL = 3   // Column D
CONTRIBUTOR_NAME_COL = 4      // Column E
MESSAGE_COL = 6               // Column G
SALES_DATE_COL = 11           // Column L
HASH_KEY_COL = 13             // Column N
TELEGRAM_FILE_ID_COL = 14     // Column O
```

### Status Values
- **NEW** - Newly created, pending processing
- **PROCESSING** - Currently being processed
- **PROCESSED** - Successfully processed
- **ACCOUNTED** - Recorded in final ledger
- **ACTIVE** - Active/enabled (for signatures, QR codes)
- **INACTIVE** - Disabled/archived
- **COMPLETED** - Finished processing

### Ledger Types
1. **offchain** - Default main DAO ledger (5 columns)
2. **Managed AGL** - Individual shipment ledgers (6 columns)
3. **Balance sheets** - Inventory tracking for AGL ledgers

---

## 🔐 Access & Authentication

### Digital Signature Validation
- Primary authentication method
- Stored in: `Contributors Digital Signatures` sheet, Column E
- Status must be "ACTIVE" (Column D)
- Matched contributor from Column A

### Telegram Handle Validation
- Fallback authentication method
- Stored in: `Contributors contact information` sheet, Column H
- With or without "@" prefix

### Hash Key Deduplication
- Format: SHA-256 hash (16 characters)
- Input: `{messageId}-{contributorName}-{date}`
- Prevents duplicate processing

---

## 📝 Usage Notes

### When Adding New Scripts:
1. **Declare sheet constants** at the top of your script
2. **Use column constants** instead of hardcoded numbers
3. **Document new columns** in this SCHEMA.md
4. **Follow naming conventions** (e.g., `SHEET_NAME`, `SHEET_URL`, `COL`)

### When Modifying Schemas:
1. **Update this documentation** immediately
2. **Check all dependent scripts** (use search)
3. **Test with existing data** before deploying
4. **Maintain backward compatibility** when possible

### For Future Reference:
- Always reference this SCHEMA.md instead of asking about column structures
- Keep this file updated when adding/removing sheets
- Document special cells (like E1 for voting_rights_circulated)
- Note any calculated columns or formulas

---

## 🔄 Wix Data Collections

### Wix Account & Site Information
**Account ID:** `0e2cde5f-b353-468b-9f4e-36835fc60a0e`  
**Site IDs:**
- TrueSight DAO: `d45a189f-d0cc-48de-95ee-30635a95385f`
- Agroverse: *(varies by site)*

**API Base URL:** `https://www.wixapis.com/wix-data/v2`

---

### Collection: `AgroverseShipments`
**Purpose:** Tracks shipment contracts and their ledger URLs

**API Endpoint:** `https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId=AgroverseShipments`

**Fields:**
- `title` - Ledger name (e.g., "AGL#25", "Sacred Earth Farms")
- `contract_url` - URL to ledger spreadsheet (may redirect)

**Used by:**
- `tdg_expenses_processing.gs` - `getLedgerConfigsFromWix()`
- `process_movement_telegram_logs.gs` - `getLedgerConfigsFromWix()`
- `web_app.gs` - Multiple inventory functions
- `tdg_wix_dashboard.gs` - Dashboard updates

---

### Collection: `ExchangeRate`
**Purpose:** Stores financial metrics and exchange rates for TrueSight DAO dashboard

**API Endpoint:** `https://www.wixapis.com/wix-data/v2/items/{dataItemId}?dataCollectionId=ExchangeRate`

**Data Structure:**
```javascript
{
  "dataCollectionId": "ExchangeRate",
  "dataItem": {
    "data": {
      "_id": "{dataItemId}",
      "description": "{METRIC_NAME}",
      "exchangeRate": {value},
      "currency": "{CURRENCY_CODE}"
    }
  }
}
```

**Data Items:**

| Description | Data Item ID | Currency | Purpose |
|-------------|--------------|----------|---------|
| `USD_TREASURY_BALANCE` | `a0e7364c-716d-49f3-a795-647d2686a22b` | USD | Total DAO asset balance |
| `TDG_ISSUED` | `4088e994-2c06-42a8-a1cf-8cd77ee73203` | TDG | Total TDG tokens issued |
| `ASSET_PER_TDG_ISSUED` | `9b04879b-f06a-419a-9ad3-520ad60ea972` | USD | USD value per TDG token |
| `30_DAYS_SALES` | `956fdb46-bc8d-4c71-8e67-79813effbab3` | USD | Rolling 30-day sales total |
| `TDG_USDC_PRICE` | `8edde502-ac79-4e66-ab2d-8ebb99108665` | USDC | TDG to USDC exchange rate |

**Used by:**
- `tdg_wix_dashboard.gs` - Updates all metrics
- `buyback_sol_to_tdg.ts` - Reads buyback budget
- Market making scripts

---

### Collection: `Statistics`
**Purpose:** Tracks website statistics for Agroverse and TrueSight sites

**API Endpoint:** `https://www.wixapis.com/wix-data/v2/items/{dataItemId}?dataCollectionId=Statistics`

**Used by:**
- `agroverse_wix_site_updates.gs` - Updates site statistics

---

## 🔑 Wix Authentication

All Wix API requests require these headers:

```javascript
{
  'Content-Type': 'application/json',
  'Authorization': WIX_ACCESS_TOKEN,  // From credentials
  'wix-account-id': '0e2cde5f-b353-468b-9f4e-36835fc60a0e',
  'wix-site-id': 'd45a189f-d0cc-48de-95ee-30635a95385f'
}
```

**Common Operations:**
- GET: Read item - `https://www.wixapis.com/wix-data/v2/items/{dataItemId}?dataCollectionId={collectionId}`
- POST: Query collection - `https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId={collectionId}`
- PUT: Update item - `https://www.wixapis.com/wix-data/v2/items/{dataItemId}`

---

**Maintained by:** TrueSight DAO Development Team  
**Questions?** Check the corresponding `.gs` files for implementation details

