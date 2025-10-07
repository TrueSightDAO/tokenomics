# TrueSight DAO - Google Sheets Schema Documentation

> **Last Updated:** 2025-10-07
> 
> This document provides a consolidated reference for all Google Sheets used across TrueSight DAO's Google Apps Scripts. Use this as a central schema reference when making code changes.

## 📑 Table of Contents

### Quick Navigation
- [🧪 Schema Validation](#-schema-validation)
- [📊 Main Spreadsheets](#-main-spreadsheets)
  - [Telegram & Submissions Spreadsheet](#1-truesight-dao-telegram--submissions-spreadsheet)
  - [Main Ledger & Contributors Spreadsheet](#2-main-truesight-dao-ledger--operations-spreadsheet)
- [📋 Additional Reference Spreadsheets](#-additional-reference-spreadsheets)
- [🔍 Common Patterns & Constants](#-common-patterns--constants)
- [🔐 Access & Authentication](#-access--authentication)
- [🔄 Wix Data Collections](#-wix-data-collections)
- [📝 Usage Notes](#-usage-notes)

### Sheet-by-Sheet Index

**Telegram & Submissions (1qbZZ...)**
- [Telegram Chat Logs](#sheet-telegram-chat-logs)
- [Scored Expense Submissions](#sheet-scored-expense-submissions)
- [QR Code Sales](#sheet-qr-code-sales)
- [Inventory Movement](#sheet-inventory-movement)
- [QR Code Generation Requests](#sheet-qr-code-generation-requests)

**Main Ledger & Contributors (1GE7P...)**
- [offchain transactions](#sheet-offchain-transactions)
- [offchain asset location](#sheet-offchain-asset-location)
- [Contributors contact information](#sheet-contributors-contact-information)
- [Contributors Digital Signatures](#sheet-contributors-digital-signatures)
- [Contributors voting weight](#sheet-contributors-voting-weight)
- [Ledger history](#sheet-ledger-history)
- [off chain asset balance](#sheet-off-chain-asset-balance)
- [Agroverse QR codes](#sheet-agroverse-qr-codes)

**Managed AGL Ledgers**
- [Overview & Active Ledgers List](#-managed-agl-ledgers-dynamic)
- [Transactions Sheet Structure](#sheet-transactions)
- [Balance Sheet Structure](#sheet-balance)

**Additional Spreadsheets**
- [Grok Scored Contributions](#3-grok-scored-contributions-origin)

---

## 🧪 Schema Validation

**Test Script:** `python_scripts/schema_validation/test_schema_validation.py`

To verify this documentation is accurate, run:
```bash
python python_scripts/schema_validation/test_schema_validation.py
```

This validates:
- ✅ All spreadsheet IDs and sheet names
- ✅ Column structures and extracts actual headers
- ✅ Wix collection accessibility (optional)
- ✅ ExchangeRate data item IDs
- 📊 Generates comprehensive test report
- 💾 Saves discovered headers to JSON

**Setup Requirements:**
- Install dependencies: `pip install -r python_scripts/requirements.txt`
- Set up [Google Sheets API credentials](https://console.cloud.google.com/) (save as `python_scripts/schema_validation/credentials.json`)
- Set `WIX_ACCESS_TOKEN` environment variable (optional)

See [`python_scripts/schema_validation/README.md`](./python_scripts/schema_validation/README.md) for detailed setup instructions.

---

## 📊 Main Spreadsheets

### 1. TrueSight DAO Telegram & Submissions Spreadsheet
**Spreadsheet ID:** `1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`

**URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit

**Purpose:** Stores Telegram chat logs, scored submissions, sales data, and various event submissions

#### Sheets:

##### Sheet: `Telegram Chat Logs`
**Purpose:** Raw Telegram chat messages and events

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=0

**Header Row:** 2

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Unique Telegram update identifier |
| B | Telegram Chatroom ID | Number | Telegram chat/group ID |
| C | Telegram Chatroom Name | String | Telegram chatroom name |
| D | Telegram Message ID | Number | Unique message identifier |
| E | Contributor Name | String | Telegram username/handle |
| F | Project Name | String | Associated project |
| G | Contribution Made | String | Full message content or contribution description |
| H | Rubric classification | String | Classification category |
| I | TDGs Provisioned | Number | TDG tokens provisioned |
| J | Status | String | Status of the contribution |
| K | TDGs Issued (reviewed by Governor) | String | Issued TDG tokens |
| L | Status date | Date | Date of message/status (YYYYMMDD) |
| M | Main Ledger Line Number | Number | Reference to main ledger |
| N | Scoring Hash Key | String | SHA-256 hash for deduplication |
| O | Telegram File IDs | String | Comma-separated file IDs from Telegram |
| P | Edgar Signature Verification | String | Signature verification status |
| Q | External API call status | String | Status of external API calls |
| R | External API call response | String | Response from external API |

**Used by:**
- [`tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Processes expense submissions
- [`process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs) - Processes sales from Telegram
- [`process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Processes inventory movements
- [`importer_telegram_chatlogs_to_google_sheet.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_telegram_chatlog_importer/importer_telegram_chatlogs_to_google_sheet.gs) - Imports raw Telegram logs

---

##### Sheet: `Scored Expense Submissions`
**Purpose:** Processed and validated expense submissions

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=452226667

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Chatroom ID | Number | Source chat ID |
| C | Telegram Chatroom Name | String | Source chatroom name |
| D | Telegram Message ID | Number | Source message ID |
| E | Reporter Name | String | Actual contributor name (from digital signature) |
| F | Expense Reported | String | Full expense message |
| G | Status date | Date | Date of expense (YYYYMMDD) |
| H | Contributor Name | String | DAO member who incurred expense |
| I | Currency  | String | Type of inventory (note trailing space) |
| J | Amount | Number | Quantity (negative for expenses) |
| K | Scoring Hash Key | String | Unique identifier for deduplication |
| L | Ledger Lines Number | String | Row number in destination ledger |

**Used by:**
- [`tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Inserts scored expenses into ledgers

---

##### Sheet: `QR Code Sales`
**Purpose:** Sales transactions from QR code scans

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=1003674539

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Message ID | Number | Source message ID |
| C | Sales Report Log Message | String | Full sale message |
| D | Reporter Name | String | Person who made the sale |
| E | QR Code value | String | Scanned QR code |
| F | Sale Price | Number | Amount of sale |
| G | AGL Ledger URL | String | URL to ledger |
| H | Sales Date | Date | Date of sale (YYYYMMDD) |
| I | Currency | String | Product sold |
| J | Status | String | "PROCESSING", "ACCOUNTED", "TOKENIZED", empty |
| K | Ledger Lines Number | String | Comma-separated row numbers |

**Used by:**
- [`process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs) - Parses and validates sales from Telegram
- [`sales_update_managed_agl_ledgers.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/sales_update_managed_agl_ledgers.gs) - Updates AGL ledgers with sales
- [`sales_update_main_dao_offchain_ledger.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/sales_update_main_dao_offchain_ledger.gs) - Updates main DAO ledger

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
- [`process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Processes inventory transfers between contributors

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
- [`process_qr_code_generation_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_qr_code_generation_telegram_logs.gs) - Processes QR code generation requests from Telegram

---

### 2. Main TrueSight DAO Ledger & Operations Spreadsheet
**Spreadsheet ID:** `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`

**URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit

**Purpose:** Main ledger for financial transactions, assets, contributors, and voting rights

#### Sheets:

##### Sheet: `offchain transactions`
**Purpose:** Default ledger for all offchain financial transactions

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=995916231

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Transaction Date | Date | Transaction date (YYYYMMDD) |
| B | Description | String | Transaction description |
| C | Fund Handler | String | Person handling funds |
| D | Amount | Number | Transaction amount (negative for debits) |
| E | Currency | String | Asset/currency type |
| F | Ledger Line | Number | Row number (auto-populated) |
| G | Is Revenue | String | Revenue flag (optional) |

**Used by:**
- [`tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Records expense transactions
- [`process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Records inventory movements
- [`sales_update_main_dao_offchain_ledger.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/sales_update_main_dao_offchain_ledger.gs) - Records sales revenue

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
- [`web_app.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/web_app.gs) - API for inventory queries and management
- [`process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Updates location after movements

---

##### Sheet: `Contributors contact information`
**Purpose:** Master list of DAO contributors

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1460794618

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Name | String | Contributor's full name |
| B | TRUESIGHT Wallet Address (Solana) | String | Solana wallet address |
| C | Ethereum Wallet Address | String | Ethereum wallet address |
| D | Email | String | Email address |
| E | Address | String | Physical address |
| F | Phone / WhatsApp | String | Phone number |
| G | Discord ID | String | Discord username |
| H | Telegram ID | String | Telegram username |
| I | Twitter | String | Twitter handle |
| J | Projects  | String | Associated projects (note trailing space) |
| K | LinkedIn | String | LinkedIn profile |
| L | Facebook | String | Facebook profile |
| M | Github | String | GitHub username |
| N | Instagram | String | Instagram handle |
| O | Website | String | Personal website |
| P | Taxation ID | String | Tax ID |
| Q | WhatsApp Chat Log ID | String | WhatsApp log ID |
| R | Digital Signature | String | Public key (legacy location) |

**Used by:**
- [`grok_scoring_for_telegram_and_whatsapp_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs) - Validates contributors when scoring
- [`process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs) - Validates sales reporters
- [`tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Validates expense reporters
- All scripts - For contributor name validation

---

##### Sheet: `Contributors Digital Signatures`
**Purpose:** Active digital signatures for authentication

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=577022511

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Full name of contributor |
| B | Created Time Stamp | String | Format: "YYYY-MM-DD HH:MM:SS" |
| C | Last Active Time Stamp | String | Format: "YYYYMMDD HH:MM:SS" |
| D | Status | String | "ACTIVE", "INACTIVE", etc. |
| E | Digital Signature | String | Public key for authentication |
| F | Contributor Email Address | String | Email address |

**Used by:**
- [`tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Authenticates expense submitters via signature
- [`process_qr_code_generation_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_qr_code_generation_telegram_logs.gs) - Authenticates QR generation requests
- [`register_member_digital_signatures_telegram.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_proposal/register_member_digital_signatures_telegram.gs) - Registers new signatures from Telegram
- [`register_member_digital_signatures_email.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_proposal/register_member_digital_signatures_email.gs) - Registers new signatures from email

---

##### Sheet: `Contributors voting weight`
**Purpose:** Tracks voting rights for DAO governance

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=950541536

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Ownership Rank - Controlled | Number | Ownership ranking |
| B | Voting Weightage Rank | Number | Voting ranking |
| C | Contributors | String | Full name |
| D | Solana Wallet Address | String | Wallet address |
| E | Quadratic Voting Power | String | Quadratic voting percentage |
| F | Total TDG in registered wallet | String | TDG in wallet |
| G | Total TDG unissued | Number | Unissued TDG |
| H | Total TDG controlled (legacy) | Number | Legacy controlled TDG |
| I | Total TDG controlled | Number | Total controlled TDG |
| J | Total Percentage Controlled | String | Percentage controlled |
| K | Total Voting Power | String | Total voting percentage |
| L | Ranking | Number | Overall ranking |
| M | Quadratic Votes | Number | Quadratic vote count |
| N | Sold | Number | TDG sold |

**Used by:**
- [`web_app.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/web_app.gs) - API endpoint for querying voting rights and governance data

---

##### Sheet: `Ledger history`
**Purpose:** Historical ledger transactions

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Person involved |
| B | Project Name | String | Associated project |
| C | Contribution Made | String | Description of contribution |
| D | Rubric classification | String | Classification category |
| E | TDGs Provisioned | Number | Provisioned TDG amount |
| F | Status | String | Status of contribution |
| G | TDGs Issued | Number | Issued TDG amount |
| H | Status date | Date | Date (YYYYMMDD) |
| I | Solana Transfer Hash | String | Blockchain transaction hash |
| J | TDGs yet Air Dropped | Number | Pending airdrops |
| K | Discord ID | String | Discord identifier |
| L | Within past 90 days | String | 90-day activity |
| M | Within past 90 days vesting | String | 90-day vesting |
| N | Within past 180 days | String | 180-day activity |
| O | Within past 180 days vesting | Number | 180-day vesting |

**Cell E1:** Contains `voting_rights_circulated` total

**Used by:**
- [`grok_scoring_for_telegram_and_whatsapp_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs) - Scores contributions and prepares for ledger entry
- [`transfer_scored_contributions_to_main_ledger.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/transfer_scored_contributions_to_main_ledger.gs) - Transfers scored contributions to this historical ledger

---

##### Sheet: `off chain asset balance`
**Purpose:** Summary of offchain asset valuations

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=2083442561

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Asset Type | String | Type of physical asset |
| B | Balance | Number | Quantity of asset |
| C | Unit Value | Number | Value per unit |
| D | Value (USD) | Number | Total USD value |

**Cell D1:** Total USD value of all offchain assets

**Used by:**
- [`web_app.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/web_app.gs) - API endpoint for asset valuation queries and dashboard metrics

---

##### Sheet: `Agroverse QR codes`
**Purpose:** Master list of all generated QR codes

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=472328231

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | qr_code | String | QR code identifier |
| B | landing_page | String | Landing page URL |
| C | ledger | String | Associated ledger URL |
| D | status | String | "ACTIVE", "SOLD", etc. |
| E | farm name | String | Name of farm |
| F | state | String | State/region |
| G | country | String | Country |
| H | Year | String | Year |
| I | Currency | String | Product type/currency |
| J | QR code creation date (YYYYMMDD) | String | Creation date |
| K | QR code location | String | Storage location URL |
| L | Owner Email | String | Owner email |
| M | Onboarding Email Sent Date | String | Onboarding date |
| N | Tree Planting Date (YYYYMMDD) | String | Planting date |
| O | Latitude | String | GPS latitude |
| P | Longitude | String | GPS longitude |
| Q | Planting Video URL | String | Video URL |
| R | Tree Seedling Photo URL | String | Photo URL |
| S | Product Image | String | Product image URL |
| T | Price | Number | Price |
| U | Manager Name | String | Manager name |

**Used by:**
- [`process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs) - Validates QR codes during sales processing
- [`web_app.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/web_app.gs) - API for QR code queries and management
- [`process_qr_code_generation_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_qr_code_generation_telegram_logs.gs) - Creates and registers new QR codes

---

## 🔗 Managed AGL Ledgers (Dynamic)

### Structure: Individual Shipment/Contract Ledgers
**Source:** Fetched dynamically from Wix AgroverseShipments collection

**Naming Convention:** e.g., "AGL#1", "AGL#25", "Sacred Earth Farms", etc.

**Purpose:** Track inventory and transactions for specific shipments/contracts

---

### 📋 Active Managed Ledgers

> **Note:** This list is dynamically managed via Wix and may change. To get the current list, query the `AgroverseShipments` collection or run the schema validation script.

**Agroverse Ledgers:**
- **[AGL1](https://agroverse.shop/agl1)** - Agroverse Ledger #1
- **[AGL2](https://agroverse.shop/agl2)** - Agroverse Ledger #2
- **[AGL3](https://agroverse.shop/agl3)** - Agroverse Ledger #3
- **[AGL4](https://agroverse.shop/agl4)** - Agroverse Ledger #4
- **[AGL5](https://agroverse.shop/agl5)** - Agroverse Ledger #5
- **[AGL6](https://agroverse.shop/agl6)** - Agroverse Ledger #6
- **[AGL7](https://agroverse.shop/agl7)** - Agroverse Ledger #7
- **[AGL8](https://agroverse.shop/agl8)** - Agroverse Ledger #8
- **[AGL10](https://agroverse.shop/agl10)** - Agroverse Ledger #10
- **[AGL13](https://agroverse.shop/agl13)** - Agroverse Ledger #13
- **[AGL14](https://agroverse.shop/agl14)** - Agroverse Ledger #14

**Partner Program Ledgers:**
- **[SEF1](https://truesight.me/sunmint/sef1)** - Sacred Earth Farms
- **[PP1](https://truesight.me/sunmint/pp1)** - Partner Program

**How to Query Current Ledgers:**
```javascript
// In Google Apps Script
function getLedgerConfigsFromWix() {
  const response = UrlFetchApp.fetch(
    'https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId=AgroverseShipments',
    { /* headers */ }
  );
  return JSON.parse(response.getContentText()).dataItems;
}
```

---

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
- [`web_app.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/web_app.gs) - API for querying ledger balances
- [`sales_update_managed_agl_ledgers.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/sales_update_managed_agl_ledgers.gs) - Updates balance after sales
- [`process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Updates balance after movements

---

## 📋 Additional Reference Spreadsheets

### 3. Grok Scored Contributions Origin
**Spreadsheet ID:** `1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo`

**URL:** https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit

**Purpose:** Origin spreadsheet for AI-scored contributions from Telegram and WhatsApp before transfer to main ledger

#### Sheets:

##### Sheet: `Scored Chatlogs`
**Purpose:** Grok AI scored contributions from chat logs

**Sheet URL:** https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit#gid=0

**Header Row:** 3

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Person who contributed |
| B | Project Name | String | Associated project (e.g., "telegram_chatlog") |
| C | Contribution Made | String | Full description of contribution |
| D | Rubric classification | String | Scoring category or "Unknown" |
| E | TDGs Provisioned | Number | Amount of TDG tokens provisioned |
| F | Status | String | Processing status |
| G | TDGs Issued | Number | Amount of TDG tokens issued |
| H | Status date | Date | Date processed (YYYYMMDD) |
| I | Existing Contributor | Boolean | TRUE/FALSE if contributor exists |
| J | Reporter Name | String | Person who reported this contribution |
| K | Scoring Hash Key | String | Unique hash for deduplication |
| L | Main Ledger Row Number | Number | Reference to main ledger |
| M | Reviewer Email | String | Email of reviewer (if any) |

**Cell A1:** Contains total TDG contributions to be tokenized  
**Cell E1:** Contains submissions left to score count

**Used by:**
- [`grok_scoring_for_telegram_and_whatsapp_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs) - AI scoring of chat contributions from Telegram/WhatsApp
- [`transfer_scored_contributions_to_main_ledger.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/transfer_scored_contributions_to_main_ledger.gs) - Transfers approved scores to main ledger history

---

##### Other Sheets Available

**Additional Sheets in This Spreadsheet:**
- **Dashboard** - Overview and summary metrics
- **WhatsApp Chatlog status** - Status tracking for WhatsApp logs
- **To Be Airdropped** - Pending token distributions
- **Unregistered Contributors** - Contributors not yet registered
- **Registered Contributors** - Registered contributor list
- **States** - State/status tracking
- **Initiatives Scoring Rubric** - Scoring guidelines and rubric

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
- [TrueSight DAO](https://truesight.me): `d45a189f-d0cc-48de-95ee-30635a95385f`
- [Agroverse](https://agroverse.shop): *(varies by site)*

**API Base URL:** `https://www.wixapis.com/wix-data/v2`  
**API Documentation:** [Wix Data API Docs](https://dev.wix.com/docs/rest/api-reference/wix-data/wix-data)

---

### Collection: `AgroverseShipments`
**Purpose:** Tracks shipment contracts and their ledger URLs

**API Endpoint:** [`https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId=AgroverseShipments`](https://www.wixapis.com/wix-data/v2/items/query?dataCollectionId=AgroverseShipments)

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

