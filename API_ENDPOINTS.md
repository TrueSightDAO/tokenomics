# TrueSight DAO API Endpoints & Webhooks Documentation

> **Last Updated:** 2025-01-XX
> 
> This document provides a consolidated reference for all API endpoints, webhook URLs, and Google Apps Script functions used across TrueSight DAO systems.

## 📋 Table of Contents

- [Edgar API Endpoints](#edgar-api-endpoints)
- [Google Apps Script Webhooks](#google-apps-script-webhooks)
- [Cron-Triggered Functions](#cron-triggered-functions)
- [Webhook Deployment URLs](#webhook-deployment-urls)

---

## Edgar API Endpoints

### Base URL
**Production:** `https://edgar.truesight.me`

### Endpoints

#### 1. Submit Contribution
**Endpoint:** `POST /dao/submit_contribution`

**Description:** Main endpoint for submitting contributions, events, and updates to the TrueSight DAO system. All submissions are logged to "Telegram Chat Logs" Google Sheet.

**Request Format:**
```http
POST /dao/submit_contribution
Content-Type: multipart/form-data

text: <signed_payload_string>
attachment: <file> (optional)
```

**Payload Format:**
```
[EVENT_NAME]
- Field 1: Value 1
- Field 2: Value 2
--------

My Digital Signature: <base64_public_key>

Request Transaction ID: <base64_signature>

This submission was generated using <source_url>

Verify submission here: https://dapp.truesight.me/verify_request.html
```

**Supported Event Types:**
- `[SALES EVENT]` - Sales transactions
- `[INVENTORY MOVEMENT]` - Inventory transfers
- `[DAO Inventory Expense Event]` - DAO expense submissions
- `[QR CODE UPDATE EVENT]` - QR code status/email updates (NEW)
- `[CONTRIBUTION EVENT]` - General contributions
- `[TREE PLANTING EVENT]` - Tree planting submissions
- `[FARM REGISTRATION EVENT]` - Farm registrations
- `[NOTARIZATION EVENT]` - Document notarizations

**Response:**
```json
{
  "status": "success",
  "fileUploadedToGithub": false,
  "googleSheetLogged": true,
  "signature_verification": "success"
}
```

**GitHub Location:**
- [`app/controllers/dao_controller.rb`](https://github.com/TrueSightDAO/tokenomics/blob/main/sentiment_importer/app/controllers/dao_controller.rb)

---

#### 2. Verify Signature
**Endpoint:** `GET /dao/verify_signature?signature=<base64_public_key>`

**Description:** Verifies if a digital signature is registered and returns contributor information.

**Response:**
```json
{
  "valid": true,
  "name": "Contributor Name",
  "message": "Signature verification successful"
}
```

---

#### 3. Link UPC
**Endpoint:** `POST /dao/link_upc`

**Description:** Links a UPC code to a product ID.

**Request:**
```json
{
  "product_id": "PROD123",
  "upc_code": "123456789012"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "UPC code updated successfully",
  "product_id": "PROD123",
  "upc_code": "123456789012"
}
```

---

#### 4. Express Submit Contribution
**Endpoint:** `POST /dao/express_submit_contribution`

**Description:** Express submission endpoint for invoice contributions and UPC linking.

**Request:**
```json
{
  "text": "<signed_payload>",
  "contribution_type": "invoice_contribution" | "upc_linking_contribution"
}
```

**GitHub Location:**
- [`app/controllers/dao_controller.rb`](https://github.com/TrueSightDAO/tokenomics/blob/main/sentiment_importer/app/controllers/dao_controller.rb)

---

## Google Apps Script Webhooks

All webhooks are triggered via Sidekiq background jobs from Edgar after submissions are logged to "Telegram Chat Logs". The webhooks process records from "Telegram Chat Logs" and update corresponding sheets.

### Webhook Security

**Important:** All webhook handlers read from "Telegram Chat Logs" sheet only (not from URL parameters) to prevent unauthorized updates. The `doGet` handlers accept an `action` parameter to specify which processing function to run, but all data is read from the Google Sheet.

---

### 1. Sales Processing Webhook

**Webhook URL:** `https://script.google.com/macros/s/AKfycbzc15gptNmn8Pm726cfeXDnBxbxZ1L31MN6bkfBH7ziiz4gxl87vJXEhAAJJhZ5uAxq/exec`

**Action:** `parseTelegramChatLogs`

**Triggered by:** `[SALES EVENT]` submissions

**Function:** Processes sales from "Telegram Chat Logs" → "QR Code Sales" sheet

**GitHub Location:**
- [`google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs)

**Configuration:**
- Set in `config/application.rb` as `sales_processing_webhook_url`

---

### 2. Inventory Movement Processing Webhook

**Webhook URL:** `https://script.google.com/macros/s/AKfycbzECOd1Y3mH7L0zU8hOC4AxQctYICX0Ws8j2-Md1dWg0k3GFGQx_4Cf7n-CM0usmSJ1/exec`

**Action:** `processTelegramChatLogs`

**Triggered by:** `[INVENTORY MOVEMENT]` submissions

**Function:** Processes inventory movements from "Telegram Chat Logs" → "Inventory Movement" → Ledgers

**GitHub Location:**
- [`google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs)

**Configuration:**
- Set in `config/application.rb` as `inventory_processing_webhook_url`

---

### 3. Expense Processing Webhook

**Webhook URL:** `https://script.google.com/macros/s/AKfycbwYBlFigSSPJKkI-F2T3dSsdLnvvBi2SCGF1z2y1k95YzA5HBrJVyMo6InTA9Fud2bOEw/exec`

**Action:** `parseAndProcessTelegramLogs`

**Triggered by:** `[DAO Inventory Expense Event]` submissions

**Function:** Processes expenses from "Telegram Chat Logs" → "Scored Expense Submissions" → Ledgers

**Key Features:**
- **30-Day Filtering**: Only processes rows from the last 30 days (based on Status Date column) to prevent timeouts
- **Target Ledger Support**: Records Target Ledger in Column M of "Scored Expense Submissions" sheet. Ledger resolution priority:
  1. Column M (Target Ledger) - explicitly set in expense form
  2. Extracted Target Ledger from expense message
  3. Ledger prefix in inventory type format `[ledger name] inventoryType`
  4. Default to "offchain" transactions sheet
- **Ledger Configuration**: Reads ledger configurations from "Shipment Ledger Listing" Google Sheet (Column A: name, Column L: URL) instead of Wix API

**GitHub Location:**
- [`google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs)

**Configuration:**
- Set in `config/application.rb` as `expense_processing_webhook_url`

---

### 4. QR Code Update Processing Webhook (NEW)

**Webhook URL:** `YOUR_QR_CODE_UPDATE_WEBHOOK_URL` *(To be set after deployment)*

**Action:** `processQrCodeUpdatesFromTelegramChatLogs`

**Triggered by:** `[QR CODE UPDATE EVENT]` submissions

**Function:** Processes QR code status/email/member updates from "Telegram Chat Logs" → "Agroverse QR codes" sheet

**GitHub Location:**
- [`google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs)

**Configuration:**
- Set in `config/application.rb` as `qr_code_update_webhook_url`

**Usage:**
- Updates Column D (status) in "Agroverse QR codes" sheet
- Updates Column L (email) in "Agroverse QR codes" sheet
- Updates Column U (manager name) in "Agroverse QR codes" sheet for member association

---

### 5. Sales AGL4 Processing Webhook

**Webhook URL:** `https://script.google.com/macros/s/AKfycbyVeNZdBngZodsyDzPQS1yUGYaaaDUd3DwbFx05KsOs9vwAtAFQoV1I5qf_B6IgMggWGA/exec`

**Action:** `processTokenizedTransactions`

**Triggered by:** `[SALES EVENT]` submissions (after Level 2 processing)

**Function:** Processes AGL4 sales from "QR Code Sales" → offchain transactions

**GitHub Location:**
- *(To be documented)*

**Configuration:**
- Set in `config/application.rb` as `sales_agl4_webhook_url`

---

### 6. Sales Non-AGL4 Processing Webhook

**Webhook URL:** `https://script.google.com/a/macros/agroverse.shop/s/AKfycbwh35n5hOLCTPFseDqfnbV93vCpdnCqdlQ2iHFZWw9YenJN0cPpc-EIoIDOnoqtdGUohg/exec`

**Action:** `processNonAgl4Transactions`

**Triggered by:** `[SALES EVENT]` submissions (after Level 2 processing)

**Function:** Processes non-AGL4 sales from "QR Code Sales" → Managed AGL Ledgers

**GitHub Location:**
- *(To be documented)*

**Configuration:**
- Set in `config/application.rb` as `sales_non_agl4_webhook_url`

---

## Cron-Triggered Functions

These functions run on a schedule (via Google Apps Script time-driven triggers) as a backup to webhook processing. They process any unprocessed records from "Telegram Chat Logs".

### Setup Instructions

1. Open the Google Apps Script file in the Apps Script editor
2. Click on "Triggers" (clock icon) in the left sidebar
3. Click "+ Add Trigger"
4. Select the function name (e.g., `processQrCodeUpdatesCron`)
5. Select event source: "Time-driven"
6. Select type of time based trigger: "Minutes timer" or "Hour timer"
7. Select interval: e.g., "Every 5 minutes" or "Every hour"
8. Click "Save"

---

### 1. Sales Processing Cron

**Function:** `parseTelegramChatLogs()` (in `process_sales_telegram_logs.gs`)

**Schedule:** *(To be documented - typically every 5-15 minutes)*

**Purpose:** Backup processing for `[SALES EVENT]` submissions

**GitHub Location:**
- [`google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs)

---

### 2. Inventory Movement Processing Cron

**Function:** `processTelegramChatLogsToInventoryMovement()` (in `process_movement_telegram_logs.gs`)

**Schedule:** *(To be documented)*

**Purpose:** Backup processing for `[INVENTORY MOVEMENT]` submissions

**GitHub Location:**
- [`google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_inventory_management/process_movement_telegram_logs.gs)

---

### 3. Expense Processing Cron

**Function:** `parseAndProcessTelegramLogs()` (in `tdg_expenses_processing.gs`)

**Schedule:** *(To be documented - recommended: every 15-30 minutes)*

**Purpose:** Backup processing for `[DAO Inventory Expense Event]` submissions

**Performance Optimization:**
- Processes only rows from the last 30 days (based on Status Date column) to prevent timeouts
- Skips rows older than 30 days automatically

**GitHub Location:**
- [`google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs)

---

### 4. QR Code Update Processing Cron (NEW)

**Function:** `processQrCodeUpdatesCron()` (in `process_qr_code_updates.gs`)

**Schedule:** *(To be set - recommended: every 5-15 minutes)*

**Purpose:** Backup processing for `[QR CODE UPDATE EVENT]` submissions

**GitHub Location:**
- [`google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs)

**Setup:**
1. Deploy the script as a web app
2. Set up a time-driven trigger for `processQrCodeUpdatesCron`
3. Recommended interval: Every 5-15 minutes

---

### 5. Telegram Chat Log Processing Cron

**Function:** `processTelegramChatLogs()` (in `grok_scoring_for_telegram_and_whatsapp_logs.gs`)

**Schedule:** *(To be documented)*

**Purpose:** AI scoring of general Telegram contributions

**GitHub Location:**
- [`google_app_scripts/tdg_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_scoring/grok_scoring_for_telegram_and_whatsapp_logs.gs)

---

### 6. Capital Injection Processing Cron

**Function:** `processCapitalInjectionCron()` (if exists)

**Schedule:** *(To be documented)*

**Purpose:** Processing capital injection submissions

**GitHub Location:**
- [`google_app_scripts/tdg_asset_management/capital_injection_processing.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/capital_injection_processing.gs)

---

## Webhook Deployment URLs

### How to Deploy a Google Apps Script as a Web App

1. Open the `.gs` file in Google Apps Script editor
2. Click "Deploy" → "New deployment"
3. Select type: "Web app"
4. Set execute as: "Me"
5. Set who has access: "Anyone" (or "Anyone with Google account" if needed)
6. Click "Deploy"
7. Copy the web app URL
8. Update the URL in `config/application.rb`
9. Redeploy Rails app

### URL Format
```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
```

---

## DApp Modules

### QR Code Update Module (NEW)

**File:** [`dapp/update_qr_code.html`](https://github.com/TrueSightDAO/dapp/blob/main/update_qr_code.html)

**Description:** Web interface for updating QR code status, email addresses, and member associations

**Features:**
- QR code input
- Member selection dropdown (associates QR code with a member)
- Status dropdown (ACTIVE, SOLD, MINTED, CONSIGNMENT)
- Email address input
- Digital signature authentication
- Offline fallback support
- Logo and navigation menu following DApp conventions

**Endpoint Used:** `POST /dao/submit_contribution`

**Event Type:** `[QR CODE UPDATE EVENT]`

---

## Notes

- All webhooks are triggered asynchronously via Sidekiq to avoid blocking user requests
- Webhook triggers include race condition prevention (5-minute deduplication cache)
- Cron jobs serve as backup processing in case webhooks fail
- All processing reads from "Telegram Chat Logs" sheet (security: no direct parameter injection)

---

**Maintained by:** TrueSight DAO Development Team  
**Questions?** Check the corresponding `.gs` files or `dao_controller.rb` for implementation details

