# TrueSight DAO - Google Sheets Schema Documentation

> **Last Updated:** 2025-12-26
> 
> This document provides a consolidated reference for all Google Sheets used across TrueSight DAO's Google Apps Scripts. Use this as a central schema reference when making code changes.

## 📝 Recent Changes (2025-12-26)

### Structural Changes Identified

**Column Header Formatting Issues:**
- Several columns contain line breaks (`\n`) in their headers, which can cause issues with exact string matching in code:
  - `Telegram Chat Logs`: Column K (`TDGs Issued\n(reviewed by Governor)`) and Column M (`Main Ledger \nLine Number`)
  - `Contributors Digital Signatures`: Column B (`Created \nTime Stamp`) and Column C (`Last Active \nTime Stamp`)
  - `Agroverse QR codes`: Column M (`Onboarding Email \nSent Date`), Column N (`Tree Planting Date\n(YYYYMMDD)`), and Column U (`Manager \nName`)
- `Capital Injection`: Column F header contains tab character and type annotation (`Amount\tNumber`)
- `Inventory Movement`: All columns H-O are now uppercase (e.g., `SENDER NAME`, `RECIPIENT NAME`, `CURRENCY`, `AMOUNT`, etc.)

**New Columns Added:**
- `Contributors contact information`: 
  - Column S: `TikTok` (NEW)
  - Column T: `Is Store Manager` (NEW)
- `Agroverse QR codes`: 
  - Column V: `Ledger Name` (NEW)

**Column Name Updates:**
- `Contributors contact information`: Column B updated from `TRUESIGHT Wallet Address (Solana)` to `TRUESIGHT Wallet Address (Solana mainnet)`
- `Inventory Movement`: Column O renamed from `Row Numbers` to `RECORD ROWS`
- `offchain asset location`: Structure completely changed - now tracks currency, location, amount managed, unit cost, and total value (previously tracked asset name, manager, and quantity)

**New Sheets Documented:**
- **Telegram & Submissions Spreadsheet:**
  - `Proposal Submissions` - DAO proposal tracking
  - `SunMint Tree Planting` - Tree planting submissions
  - `SunMint Registered Farms` - Farm registrations
  - `Document Notarizations` - Document notarization tracking
  - `States` - Status reference values

- **Main Ledger & Contributors Spreadsheet:**
  - `Outstanding Airdrops` - Pending TDG airdrops
  - `Recurring Transactions` - Recurring transaction tokenization
  - `offchain assets in transit` - Shipping and logistics tracking
  - `Consignments` - Retail consignment inventory
  - `Contribution submission` - Web form submissions
  - `Governors` - DAO governor tracking
  - `Intiatives Scoring Rubric` - Contribution scoring rubric
  - `TRUESIGHT token details` - Token wallet management
  - `Agroverse Active Contributors` - Active contributor tracking
  - `States` - Comprehensive status reference
  - `Currencies` - Currency and product metadata
  - `Contributor Staking` - TDG staking tracking
  - `Recent Contributions - 180` - 180-day contribution summary
  - `Commodity Prices Exchange Rate` - Commodity price tracking
  - `Agroverse Price Components` - Price component breakdown
  - `Agroverse Cacao Category Pricing` - Category pricing multipliers
  - `Agroverse Cacao Processing Cost` - Processing cost tracking
  - `Stripe Social Media Checkout ID` - Stripe order tracking
  - `Shipment Ledger Listing` - Shipment and ledger master list
  - `Agroverse SKUs` - Product SKU management
  - `Agroverse News Letter Subscribers` - Newsletter subscribers
  - `Performance Statistics` - Performance metrics
  - `Monthly Statistics` - Monthly sales statistics

**Recommendations for Code Updates:**
1. Use case-insensitive and whitespace-normalized matching for column headers
2. Handle line breaks in headers by normalizing whitespace before comparison
3. Update any hardcoded column references to use the new column names
4. Consider using column indices instead of names for critical operations

---

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
- [Capital Injection](#sheet-capital-injection)
- [QR Code Sales](#sheet-qr-code-sales)
- [Inventory Movement](#sheet-inventory-movement)
- [QR Code Generation](#sheet-qr-code-generation)
- [Proposal Submissions](#sheet-proposal-submissions)
- [SunMint Tree Planting](#sheet-sunmint-tree-planting)
- [SunMint Registered Farms](#sheet-sunmint-registered-farms)
- [Document Notarizations](#sheet-document-notarizations)
- [States](#sheet-states-telegram)

**Main Ledger & Contributors (1GE7P...)**
- [Ledger history](#sheet-ledger-history)
- [Contributors voting weight](#sheet-contributors-voting-weight)
- [Outstanding Airdrops](#sheet-outstanding-airdrops)
- [Contributors contact information](#sheet-contributors-contact-information)
- [Contributors Digital Signatures](#sheet-contributors-digital-signatures)
- [offchain transactions](#sheet-offchain-transactions)
- [offchain asset location](#sheet-offchain-asset-location)
- [Recurring Transactions](#sheet-recurring-transactions)
- [offchain assets in transit](#sheet-offchain-assets-in-transit)
- [off chain asset balance](#sheet-off-chain-asset-balance)
- [Consignments](#sheet-consignments)
- [Contribution submission](#sheet-contribution-submission)
- [Governors](#sheet-governors)
- [Intiatives Scoring Rubric](#sheet-intiatives-scoring-rubric)
- [TRUESIGHT token details](#sheet-truesight-token-details)
- [Agroverse Active Contributors](#sheet-agroverse-active-contributors)
- [States](#sheet-states-main-ledger)
- [Currencies](#sheet-currencies)
- [Contributor Staking](#sheet-contributor-staking)
- [Recent Contributions - 180](#sheet-recent-contributions-180)
- [Commodity Prices Exchange Rate](#sheet-commodity-prices-exchange-rate)
- [Agroverse Price Components](#sheet-agroverse-price-components)
- [Agroverse Cacao Category Pricing](#sheet-agroverse-cacao-category-pricing)
- [Agroverse Cacao Processing Cost](#sheet-agroverse-cacao-processing-cost)
- [Agroverse QR codes](#sheet-agroverse-qr-codes)
- [Stripe Social Media Checkout ID](#sheet-stripe-social-media-checkout-id)
- [Shipment Ledger Listing](#sheet-shipment-ledger-listing)
- [Agroverse SKUs](#sheet-agroverse-skus)
- [Agroverse News Letter Subscribers](#sheet-agroverse-news-letter-subscribers)
- [Performance Statistics](#sheet-performance-statistics)
- [Monthly Statistics](#sheet-monthly-statistics)

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
| K | TDGs Issued\n(reviewed by Governor) | String | Issued TDG tokens (note: header contains line break) |
| L | Status date | Date | Date of message/status (YYYYMMDD) |
| M | Main Ledger \nLine Number | Number | Reference to main ledger (note: header contains line break) |
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
| M | Target Ledger | String | Target ledger name (e.g., "AGL10", "offchain") - explicitly set in expense form (NEW - added 2025-01-XX) |

**Used by:**
- [`tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs) - Inserts scored expenses into ledgers. Reads ledger configurations from "Shipment Ledger Listing" sheet (Column A: name, Column L: URL) instead of Wix API. Processes only rows from the last 30 days to prevent timeouts.

---

##### Sheet: `Capital Injection`
**Purpose:** Capital injection submissions for managed AGL ledgers. Records equity investments that increase both assets (cash) and equity through double-entry accounting.

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=1159222428

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Message ID | Number | Source message ID |
| C | Capital Injection Log Message | String | Full submission message including all details |
| D | Reporter Name | String | Person who reported (validated via digital signature) |
| E | Ledger Name | String | Target managed ledger (e.g., "AGL1", "SEF1") |
| F | Amount\tNumber | Number | Capital injection amount (positive, always USD) (note: header contains tab character and type annotation) |
| G | Ledger URL | String | Resolved URL to target managed ledger |
| H | Injection Date | Date | Date of capital injection (YYYYMMDD) |
| I | Description | String | Description of capital injection |
| J | Status | String | Processing status: "NEW", "PROCESSED", "FAILED" |
| K | Ledger Lines Number | String | Comma-separated row numbers (e.g., "245,246" for Assets & Equity) |

**Key Features:**
- **Double-Entry Accounting:** Each capital injection creates TWO transactions in the target ledger:
  1. **Assets transaction** (Category: "Assets") - increases cash
  2. **Equity transaction** (Category: "Equity") - increases owner's equity
- **Managed Ledgers Only:** Only processes capital injections for managed AGL ledgers (not offchain)
- **Digital Signature Required:** No fallback - reporter must have valid ACTIVE digital signature
- **Currency:** Always USD (no currency column needed)
- **Supporting Documentation:** File attachments stored in GitHub, referenced in log message

**Used by:**
- [`capital_injection_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/capital_injection_processing.gs) - Parses submissions and inserts double-entry transactions into managed ledgers

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
| H | SENDER NAME | String | Person sending inventory (note: header is uppercase) |
| I | RECIPIENT NAME | String | Person receiving inventory (note: header is uppercase) |
| J | CURRENCY | String | Inventory type (without ledger prefix) (note: header is uppercase) |
| K | AMOUNT | Number | Quantity transferred (note: header is uppercase) |
| L | LEDGER_NAME | String | Source ledger name (e.g., "AGL#25" or "offchain") (note: header is uppercase with underscore) |
| M | LEDGER_URL | String | Resolved spreadsheet URL (note: header is uppercase) |
| N | STATUS | String | "NEW" or "PROCESSED" (note: header is uppercase) |
| O | RECORD ROWS | String | Comma-separated destination row numbers (note: renamed from "Row Numbers") |

**Used by:**
- [`process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs) - Processes inventory transfers between contributors

---

##### Sheet: `QR Code Generation`
**Purpose:** Tracks QR code generation requests from Telegram

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=1703901725

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source update ID |
| B | Telegram Chatroom ID | Number | Telegram chat ID |
| C | Telegram Chatroom Name | String | Telegram chatroom name |
| D | Telegram Message ID | Number | Telegram message ID |
| E | Contributor Name | String | Requester name |
| F | Contribution Made | String | Full request message |
| G | Status date | Date | Date of request (YYYYMMDD) |
| H | Agroverse QR starting line | Number | Starting line number for QR codes |
| I | Agroverse QR ending line | Number | Ending line number for QR codes |
| J | Zip file download URL | String | Google Drive link to ZIP file |
| K | Zip file name | String | Name of the ZIP file |
| L | status | String | Processing status |

**Used by:**
- [`process_qr_code_generation_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_qr_code_generation_telegram_logs.gs) - Processes QR code generation requests from Telegram

---

##### Sheet: `Proposal Submissions`
**Purpose:** Tracks DAO proposal submissions from Telegram

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=837974573

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Message ID | Number | Telegram message ID |
| B | Timestamp | String | Submission timestamp |
| C | Username | String | Telegram username |
| D | Message Text | String | Full proposal message |
| E | Processed | String | Processing status |
| F | Proposal Title | String | Extracted proposal title |
| G | Proposal Content | String | Full proposal content |
| H | Digital Signature | String | Digital signature for authentication |
| I | Transaction ID | String | Blockchain transaction ID (if applicable) |
| J | Pull Request Number | String | GitHub PR number (if applicable) |
| K | Status | String | Proposal status |
| L | Created Date | Date | Creation date |
| M | Updated Date | Date | Last update date |
| N | Submission Type | String | Type of submission |

**Used by:**
- [`proposal_manager.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_proposal/proposal_manager.gs) - Manages proposal submissions

---

##### Sheet: `SunMint Tree Planting`
**Purpose:** Tracks tree planting submissions for SunMint program

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=176124122

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Chatroom ID | Number | Telegram chat ID |
| C | Telegram Chatroom Name | String | Telegram chatroom name |
| D | Telegram Message ID | Number | Telegram message ID |
| E | Contributor Name | String | Person who planted the tree |
| F | Contribution Made | String | Full submission message |
| G | Status date | Date | Date of planting (YYYYMMDD) |
| H | Telegram File IDs | String | Comma-separated file IDs |
| I | Photo of Tree Planted | String | Photo URL |
| J | Submitted Name | String | Name submitted for the tree |
| K | Latitude | String | GPS latitude |
| L | Longitude | String | GPS longitude |
| M | Status | String | Processing status |
| N | Specie | String | Tree species |
| O | Notarization URL | String | Notarization document URL |
| P | Cost of Tree | Number | Cost per tree |
| Q | Tree Planting Time | String | Time of planting |

**Used by:**
- [`process_tree_planting_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/sunmint_tree_planting/process_tree_planting_telegram_logs.gs) - Processes tree planting submissions

---

##### Sheet: `SunMint Registered Farms`
**Purpose:** Tracks registered farms for SunMint program

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=2011737890

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Chatroom ID | Number | Telegram chat ID |
| C | Telegram Chatroom Name | String | Telegram chatroom name |
| D | Telegram Message ID | Number | Telegram message ID |
| E | Contributor Name | String | Farm owner/manager |
| F | Contribution Made | String | Full registration message |
| G | Status date | Date | Registration date (YYYYMMDD) |
| H | Telegram File IDs | String | Comma-separated file IDs |

**Used by:**
- SunMint farm registration processes

---

##### Sheet: `Document Notarizations`
**Purpose:** Tracks document notarization submissions

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=520413576

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Telegram Update ID | Number | Source Telegram update ID |
| B | Telegram Chatroom ID | Number | Telegram chat ID |
| C | Telegram Chatroom Name | String | Telegram chatroom name |
| D | Telegram Message ID | Number | Telegram message ID |
| E | Contributor Name | String | Person submitting document |
| F | Contribution Made | String | Full submission message |
| G | Status date | Date | Submission date (YYYYMMDD) |
| H | Telegram File IDs | String | Comma-separated file IDs |
| I | GitHub RAW url | String | GitHub raw file URL |
| J | Submitter Name | String | Name of submitter |
| K | Latitude | String | GPS latitude |
| L | Longitude | String | GPS longitude |
| M | Document Type | String | Type of document |
| N | Description | String | Document description |
| O | Git Commit Hash | String | GitHub commit hash |
| P | Status | String | Processing status |

**Used by:**
- [`process_notarization_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/agroverse_notarizations/process_notarization_telegram_logs.gs) - Processes document notarizations

---

##### Sheet: `States`
**Purpose:** Reference sheet for status values

**Sheet URL:** https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit#gid=225494713

**Header Row:** 2

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | TOKENIZED | String | Status value |
| B | When the sales record is updated directly on our main ledger | String | Description |

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
| A | Currency | String | Asset/currency type |
| B | Location | String | Physical location of asset |
| C | Amount Managed | Number | Quantity managed at this location |
| D | Unit Cost | Number | Cost per unit |
| E | Total Value | Number | Total value (Amount Managed × Unit Cost) |

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
| B | TRUESIGHT Wallet Address (Solana mainnet) | String | Solana wallet address (note: updated to specify "mainnet") |
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
| S | TikTok | String | TikTok handle (NEW - added 2025-12-26) |
| T | Is Store Manager | String | Store manager flag (NEW - added 2025-12-26) |

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
| B | Created \nTime Stamp | String | Format: "YYYY-MM-DD HH:MM:SS" (note: header contains line break) |
| C | Last Active \nTime Stamp | String | Format: "YYYYMMDD HH:MM:SS" (note: header contains line break) |
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
**Purpose:** Complete historical record of all DAO member contributions and TDG token awards. This sheet serves as the authoritative source for contribution tracking, governance token distribution, and member reference/testimonial generation.

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | DAO member name (matches Contributors contact information) |
| B | Project Name | String | Associated project or initiative |
| C | Contribution Made | String | Detailed description of contribution |
| D | Rubric classification | String | Classification category with TDG award formula |
| E | TDGs Provisioned | Number | Provisioned TDG amount (proposed award) |
| F | Status | String | Contribution status (e.g., "Successfully Completed / Full Provision Awarded") |
| G | TDGs Issued | Number | Actual TDG tokens issued to member |
| H | Status date | Date | Completion/status date (YYYYMMDD format) |
| I | Solana Transfer Hash | String | Blockchain transaction hash (if airdropped) |
| J | TDGs yet Air Dropped | Number | TDG tokens pending airdrop |
| K | Discord ID | String | Discord identifier for member |
| L | Within past 90 days | String | Recent 90-day activity indicator |
| M | Within past 90 days vesting | String | 90-day vesting status |
| N | Within past 180 days | String | Recent 180-day activity indicator |
| O | Within past 180 days vesting | Number | 180-day vesting amount |

**Special Cells:**
- **Cell E1:** Contains `voting_rights_circulated` total (sum of all TDG tokens issued)
- **Cell B1:** "Total TDG tokens Issued" label
- **Row 2:** Description of the ledger's purpose and submission methods

**Key Features:**
- **Comprehensive History:** Records contributions from 2017 to present (10,000+ entries)
- **Merit-Based Recognition:** TDG awards based on contribution rubric classifications
- **Verifiable Record:** All contributions timestamped and categorized
- **Multi-Project Tracking:** Covers TrueSight DAO, Agroverse, MoonShot, FORK, and other initiatives
- **Reference Source:** Primary data source for generating member references and testimonials

**Used by:**
- [`grok_scoring_for_telegram_and_whatsapp_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs) - Scores contributions and prepares for ledger entry
- [`transfer_scored_contributions_to_main_ledger.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_grok_scoring/transfer_scored_contributions_to_main_ledger.gs) - Transfers scored contributions to this historical ledger
- [`fetch_contributions.py`](https://github.com/TrueSightDAO/tokenomics/blob/main/python_scripts/reference_and_testimonials/fetch_contributions.py) - Retrieves member contribution history for references and testimonials

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
| M | Onboarding Email \nSent Date | String | Onboarding date (note: header contains line break) |
| N | Tree Planting Date\n(YYYYMMDD) | String | Planting date (note: header contains line break) |
| O | Latitude | String | GPS latitude |
| P | Longitude | String | GPS longitude |
| Q | Planting Video URL | String | Video URL |
| R | Tree Seedling Photo URL | String | Photo URL |
| S | Product Image | String | Product image URL |
| T | Price | Number | Price |
| U | Manager \nName | String | Manager name (note: header contains line break) |
| V | Ledger Name | String | Associated ledger name (NEW - added 2025-12-26) |

**Used by:**
- [`process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs) - Validates QR codes during sales processing
- [`web_app.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/web_app.gs) - API for QR code queries and management
- [`process_qr_code_generation_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_qr_code_generation_telegram_logs.gs) - Creates and registers new QR codes

---

##### Sheet: `Outstanding Airdrops`
**Purpose:** Tracks TDG tokens pending airdrop to contributors

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1569170936

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Full name of contributor |
| B | TDG Amount | Number | Amount of TDG tokens to airdrop |
| C | Solana Wallet Address | String | Recipient wallet address |
| D | Status | String | Airdrop status |

**Used by:**
- Airdrop processing scripts

---

##### Sheet: `Recurring Transactions`
**Purpose:** Tracks recurring financial transactions for tokenization

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=33812003

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Description | String | Transaction description |
| B | Source | String | Source of transaction |
| C | Transaction Type | String | Type of recurring transaction |
| D | Amount (USD) | Number | Transaction amount in USD |
| E | Billing Period | String | Billing frequency |
| F | Most Recent Tokenization Date | Date | Last tokenization date |
| G | Start Date | Date | Transaction start date |
| H | Edgar AWS \nBilling Automation \nSecurity Key Identifier | String | Security key for automation (note: header contains line breaks) |
| I | Automation Remarks | String | Automation notes |

**Used by:**
- Recurring tokenization scripts

---

##### Sheet: `offchain assets in transit`
**Purpose:** Tracks physical assets being shipped between locations

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1888711771

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Destination DAO member | String | Recipient member name |
| B | Origin Asset Name | String | Asset being shipped |
| C | Unit Value | Number | Value per unit |
| D | Destination Address | String | Shipping destination |
| E | Origin DAO member | String | Sender member name |
| F | Origin Address | String | Shipping origin |
| G | Recipient Tax ID | String | Tax ID of recipient |
| H | Phone Number | String | Contact phone number |
| I | *(empty)* | - | Reserved column |
| J | Courier Service | String | Shipping company |
| K | Tracking Number | String | Package tracking number |
| L | Expected Arrival Date\n(YYYYMMDD) | Date | Expected delivery date (note: header contains line break) |
| M | Destination Asset Name | String | Asset name at destination |
| N | Ledger Location | String | Ledger reference |
| O | Ledger Line Number | Number | Ledger row number |
| P | Status | String | Shipping status |

**Used by:**
- Shipping and logistics tracking

---

##### Sheet: `Consignments`
**Purpose:** Tracks consignment inventory at retail locations

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1401078120

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Store Name | String | Retail store name |
| B | Status Date | Date | Last status update |
| C | Last Visit | Date | Last visit date |
| D | Units | Number | Units on consignment |
| E | Asset Type | String | Product type |
| F | Retail Price | Number | Retail price per unit |
| G | Settlement Price | Number | Settlement price per unit |
| H | Person In Charge | String | Store contact person |
| I | Job Title | String | Contact person's title |
| J | Email | String | Contact email |
| K | Physical Address | String | Store physical address |
| L | USPS Mailing Address | String | Mailing address |
| M | Phone | String | Contact phone |
| N | Remarks | String | Additional notes |

**Used by:**
- Consignment management

---

##### Sheet: `Contribution submission`
**Purpose:** Web form submissions for contributions

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=322675155

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Timestamp | String | Submission timestamp |
| B | Contributor Name \nMember whom you observed made a valuable contribution to our DAO. | String | Contributor name (note: header contains line break and description) |
| C | Description of the Contribution\nMore details on the contribution made? Provide links to resources that were contributed if applicable. \n\nThis might include links to tweets, google docs or artwork that were uploaded | String | Contribution description (note: header contains line breaks and instructions) |
| D | What kind of contribution it is \nnumber on the left shows the amount of governance tokens it should be worth | String | Contribution category (note: header contains line break and instructions) |
| E | Email Address | String | Submitter email |
| F | Project Name\nWhich project did you observed received a contribution? | String | Associated project (note: header contains line break) |
| G | Governance tokens to be awarded\nThe amount should be informed by the amount associated with the category selected above | Number | TDG tokens to award (note: header contains line breaks and instructions) |
| H | *(empty)* | - | Reserved column |
| I | Notarizing Governor | String | Governor who notarized |
| J | Notarization Status | String | Notarization status |
| K | Ledger Line Number | Number | Reference to ledger |

**Used by:**
- Contribution submission web forms

---

##### Sheet: `Governors`
**Purpose:** Tracks DAO governors and their terms

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=842148543

**Header Row:** 7

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | End Period | String | Period end date |
| B | 20251229 | String | Specific date value |
| C | *(empty)* | - | Reserved column |
| D | Vernal Equinox | String | Seasonal marker |
| E | 20th March | String | Date value |

**Note:** This sheet appears to be a calendar/reference sheet with specific formatting.

---

##### Sheet: `Intiatives Scoring Rubric`
**Purpose:** Scoring rubric for contribution categories

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=129025382

**Header Row:** 4

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Category of Contributions | String | Contribution category |
| B | Type of contribution | String | Contribution type |
| C | TDG Tokens Awarded | Number | TDG tokens for this category |
| D | *(empty)* | - | Reserved column |
| E | *(empty)* | - | Reserved column |
| F | States | String | Status values |

**Used by:**
- Scoring and tokenization scripts

---

##### Sheet: `TRUESIGHT token details`
**Purpose:** Master list of TRUESIGHT token wallets

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=257194538

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Wallet Type | String | Type of wallet |
| B | Wallet Address | String | Wallet address |
| C | Managers | String | Wallet managers |
| D | Total TDG | Number | Total TDG in wallet |

**Used by:**
- Wallet management scripts

---

##### Sheet: `Agroverse Active Contributors`
**Purpose:** Tracks active contributors in Agroverse project

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1053818602

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Contributor name |
| B | Total Contributions - past 90 days | Number | Contribution count |

**Used by:**
- Contributor activity tracking

---

##### Sheet: `States`
**Purpose:** Reference sheet for all status values and enums

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1250222719

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Initiative States | String | Initiative status values |
| B | *(empty)* | - | Reserved column |
| C | Proposal States | String | Proposal status values |
| D | *(empty)* | - | Reserved column |
| E | Betting Pool States | String | Betting pool status |
| F | Betting Direction | String | Betting direction values |
| G | *(empty)* | - | Reserved column |
| H | Contribution Submission States | String | Contribution submission status |
| I | *(empty)* | - | Reserved column |
| J | Scope | String | Scope values |
| K | Project Tokenization Status | String | Tokenization status |
| L | Project Activity Status | String | Activity status |
| M | *(empty)* | - | Reserved column |
| N | Currencies | String | Currency names |
| O | Price in USD | Number | Currency prices |
| P | *(empty)* | - | Reserved column |
| Q | Recurring Transaction Type | String | Transaction types |
| R | *(empty)* | - | Reserved column |
| S | Physica Asset Transition Status | String | Asset transition status (note: typo in header "Physica") |
| T | *(empty)* | - | Reserved column |
| U | QR code states | String | QR code status values |
| V | *(empty)* | - | Reserved column |
| W | Digital Signature Status | String | Signature status values |

**Used by:**
- All scripts for status validation

---

##### Sheet: `Currencies`
**Purpose:** Master list of currencies and product metadata

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1552160318

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Currencies | String | Currency/product name |
| B | Price in USD | Number | Price per unit |
| C | Serializable | String | Whether product is serialized |
| D | Product Image | String | Product image URL |
| E | landing_page | String | Landing page URL |
| F | ledger | String | Associated ledger URL |
| G | farm name | String | Farm name |
| H | state | String | State/region |
| I | country | String | Country |
| J | Year | String | Year |
| K | Unit Weight (grams) | Number | Weight in grams |
| L | Unit Weight (ounces) | Number | Weight in ounces |
| M | SKU Product ID | String | SKU identifier |

**Used by:**
- Product and pricing management

---

##### Sheet: `Contributor Staking`
**Purpose:** Tracks TDG staking by contributors

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=734074565

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Contributor Name | String | Contributor name |
| B | Milestones achieved | String | Milestones completed |
| C | Status | String | Staking status |
| D | TDGs staked | Number | Amount of TDG staked |
| E | Status date | Date | Status update date |

**Used by:**
- Staking management

---

##### Sheet: `Recent Contributions - 180`
**Purpose:** Summary of contributions in the last 180 days

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=2001293596

**Header Row:** 6

**Note:** This appears to be a summary/report sheet with dynamic data.

---

##### Sheet: `Commodity Prices Exchange Rate`
**Purpose:** Tracks commodity prices and exchange rates

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=398142035

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | company symbol | String | Company/ticker symbol |
| B | company name | String | Company name |
| C | company page | String | Company page URL |
| D | close | Number | Closing price |
| E | high | Number | High price |
| F | low | Number | Low price |
| G | volume | Number | Trading volume |
| H | origin_pattern | String | Data source pattern |
| I | origin_url | String | Data source URL |
| J | createdAt | Date | Creation timestamp |
| K | updatedAt | Date | Update timestamp |
| L | pingedAt | Date | Last ping timestamp |

**Used by:**
- Price tracking and exchange rate calculations

---

##### Sheet: `Agroverse Price Components`
**Purpose:** Price component breakdown for Agroverse products

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1311453882

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Description | String | Price component description |
| B | Amount | Number | Component amount |

**Used by:**
- Pricing calculations

---

##### Sheet: `Agroverse Cacao Category Pricing`
**Purpose:** Pricing multipliers by cacao category

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1760569208

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Type | String | Cacao category type |
| B | Multiplier | Number | Price multiplier |

**Used by:**
- Category-based pricing

---

##### Sheet: `Agroverse Cacao Processing Cost`
**Purpose:** Tracks processing costs for cacao

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=603759787

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Facility Name | String | Processing facility |
| B | Process name | String | Process type |
| C | Cost | Number | Processing cost |
| D | Currency | String | Cost currency |
| E | Status Date | Date | Status update date |
| F | Contact Information / Whats App | String | Contact details |
| G | Alibaba | String | Alibaba reference |

**Used by:**
- Cost tracking and pricing

---

##### Sheet: `Stripe Social Media Checkout ID`
**Purpose:** Tracks Stripe checkout sessions and orders

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1787371190

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Timestamp | String | Order timestamp |
| B | Customer Name | String | Customer name |
| C | Stripe Session ID | String | Stripe checkout session ID |
| D | Wix Order Number | String | Wix order number |
| E | Wix Order ID | String | Wix order ID |
| F | Items Purchased | String | Purchased items |
| G | Total Quantity | Number | Total item quantity |
| H | Amount | Number | Order amount |
| I | Currency | String | Order currency |
| J | Shipping Address | String | Shipping destination |
| K | Shipping Cost | Number | Shipping cost |
| L | Stripe Transaction Fee | Number | Stripe processing fee |
| M | Shipping Provider | String | Shipping carrier |
| N | Tracking Number | String | Package tracking number |
| O | Tracking Notification Sent | String | Email notification status |

**Used by:**
- Stripe order processing and tracking

---

##### Sheet: `Shipment Ledger Listing`
**Purpose:** Master list of all shipments and their associated ledgers

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=483234653

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | *(empty)* | - | Reserved column |
| B | Shipment Date | Date | Shipment date |
| C | Status | String | Shipment status |
| D | Description | String | Shipment description |
| E | Shipment Image | String | Image URL |
| F | Cargo Size | String | Cargo size |
| G | Cacao (kg) | Number | Cacao weight in kg |
| H | Transaction Type | String | Transaction type |
| I | Investment ROI | Number | Return on investment |
| J | Capital Injection | Number | Capital injection amount |
| K | Total Revenue | Number | Total revenue |
| L | Ledger URL | String | Ledger spreadsheet URL |
| M | Contract URL | String | Contract document URL |
| N | FDA Prior Notice | String | FDA notice URL |
| O | Invoice URL | String | Invoice document URL |
| P | Purchase Order URL | String | PO document URL |
| Q | Lab Report | String | Lab report URL |
| R | Video Reel | String | Video URL |
| S | TrueSight DAO URL | String | DAO page URL |
| T | Trees to be Planted | Number | Tree planting commitment |
| U | Google Maps URL | String | Location map URL |
| V | Latitude | String | GPS latitude |
| W | Longitude | String | GPS longitude |
| X | Is Cacao Shipment | String | Cacao shipment flag |
| Y | Serialized | String | Serialization status |
| Z | Created Date | Date | Creation date |
| AA | Updated Date | Date | Last update date |
| AB | Resolved URL | String | Resolved ledger URL |

**Used by:**
- Shipment and ledger management

---

##### Sheet: `Agroverse SKUs`
**Purpose:** Master list of product SKUs

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=98293503

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Product ID | String | Product identifier |
| B | Product Name | String | Product name |
| C | Price (USD) | Number | Product price |
| D | Weight (oz) | Number | Product weight |
| E | Category | String | Product category |
| F | Shipment | String | Associated shipment |
| G | Farm | String | Source farm |
| H | Image Path | String | Product image URL |
| I | Store inventory | Number | Store inventory count |

**Used by:**
- Product and inventory management

---

##### Sheet: `Agroverse News Letter Subscribers`
**Purpose:** Newsletter subscriber list

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1078776582

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Email | String | Subscriber email |
| B | Status | String | Subscription status |
| C | Created Date | Date | Subscription date |
| D | Imported Date | Date | Import date |

**Used by:**
- Newsletter management

---

##### Sheet: `Performance Statistics`
**Purpose:** Performance metrics and statistics

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=560310588

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | 12/7/2025 | Date | Date column (format varies) |
| B | Description | String | Metric description |
| C | Exchange Rate / Value | Number | Metric value |
| D | Currency | String | Currency code |
| E | Updated Date | Date | Last update date |

**Used by:**
- Performance tracking

---

##### Sheet: `Monthly Statistics`
**Purpose:** Monthly sales and revenue statistics

**Sheet URL:** https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=1026348250

**Header Row:** 1

| Column | Name | Type | Description |
|--------|------|------|-------------|
| A | Year-Month | String | Year and month (YYYY-MM) |
| B | Monthly Sales Volume (USD) | Number | Monthly sales amount |
| C | Cumulative Sales Volume (USD) | Number | Cumulative sales total |
| D | Last Updated | Date | Last update timestamp |

**Used by:**
- Sales reporting and analytics

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
- `tdg_expenses_processing.gs` - `getLedgerConfigsFromSheet()` (reads from "Shipment Ledger Listing" Google Sheet instead of Wix API - updated 2025-01-XX)
- `process_movement_telegram_logs.gs` - `getLedgerConfigsFromWix()`
- `web_app.gs` - Multiple inventory functions
- `tdg_wix_dashboard.gs` - Dashboard updates

---

### Collection: `ExchangeRate`
**Purpose:** Stores financial metrics and exchange rates for TrueSight DAO dashboard

**API Endpoint:** [`https://www.wixapis.com/wix-data/v2/items/{dataItemId}?dataCollectionId=ExchangeRate`](https://www.wixapis.com/wix-data/v2/items/)

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

**API Endpoint:** [`https://www.wixapis.com/wix-data/v2/items/{dataItemId}?dataCollectionId=Statistics`](https://www.wixapis.com/wix-data/v2/items/)

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
- GET: Read item - [`/wix-data/v2/items/{dataItemId}`](https://dev.wix.com/docs/rest/api-reference/wix-data/wix-data/items/get-data-item)
- POST: Query collection - [`/wix-data/v2/items/query`](https://dev.wix.com/docs/rest/api-reference/wix-data/wix-data/items/query-data-items)
- PUT: Update item - [`/wix-data/v2/items/{dataItemId}`](https://dev.wix.com/docs/rest/api-reference/wix-data/wix-data/items/update-data-item)
- POST: Trigger event - [`/events/v1/events`](https://dev.wix.com/docs/rest/api-reference/wix-events/wix-events/events/create-event)

---

**Maintained by:** TrueSight DAO Development Team  
**Questions?** Check the corresponding `.gs` files for implementation details

