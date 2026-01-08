# Agroverse QR Code System

This system provides three main components for managing QR codes in the cacao supply chain:

1. **QR Code Generation**: Automated workflow for creating batch QR codes from user requests
2. **QR Code Verification API**: Smart endpoint to verify cacao bags when QR codes are scanned
3. **QR Code Update Processing**: Automated workflow for updating QR code status and email addresses

## QR Code Generation

The QR code generation system processes batch requests from users and creates QR code images through an automated workflow.

### Overview

Instead of handling direct POST requests, this system follows the established pattern used by other DAO tools:
1. **Reads** from the consolidated "Telegram Chat Logs" tab
2. **Processes** QR code generation requests
3. **Writes** results to the "QR Code Generation" tab
4. **Creates QR code records** in the [Agroverse QR codes spreadsheet](https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit?gid=472328231)
5. **Triggers GitHub Actions webhooks** to generate QR code images and zip files
6. **Sends** Telegram notifications for tracking

### Generation Architecture

- **Google Apps Script** (`process_qr_code_generation_telegram_logs.gs`)
  - Monitors the "Telegram Chat Logs" tab for new requests
  - Extracts structured data from `[BATCH QR CODE REQUEST]` messages
  - Creates/updates records in the "QR Code Generation" tab
  - Sends Telegram notifications for tracking

- **Data Flow**
  - User submits request via `batch_qr_generator.html` → Edgar → Telegram
  - Script processes telegram logs → Updates "QR Code Generation" tab
  - Backend processes requests → Updates status in the tab
  - Users can track progress through the spreadsheet

### Generation Workflow

1. **User submits request** via the HTML form
2. **Request goes to Edgar** → Telegram chat
3. **Script processes logs** → Creates record in "QR Code Generation" tab
4. **Script creates QR code records** in Agroverse QR codes spreadsheet
5. **Script triggers GitHub Actions webhook** → Generates QR code images
6. **GitHub Actions creates zip file** → Uploads to repository
7. **Status updated** → COMPLETED with zip file location
8. **User notified** → Can download from GitHub

### Generation Setup

1. **Copy the script** to your Google Apps Script project
2. **Set up Script Properties** (Project Settings > Script Properties):
   - `TELEGRAM_API_TOKEN`: Your Telegram bot token
   - `GITHUB_TOKEN`: Your GitHub personal access token
3. **Set up triggers** to run `processQRCodeGenerationTelegramLogs()` periodically
4. **Verify the "QR Code Generation" tab** exists in your spreadsheet

## QR Code Verification API

This service provides a smart endpoint to verify cacao bags in the supply chain. When someone scans the QR code on a bag, the embedded value is sent to this API, which looks up the bag details in a Google Sheet and returns JSON data or redirects the visitor to the correct resource.

## Architecture

- **Google Apps Script** (`web_app.gs`)
  - Exposes `doGet(e)` to handle GET requests.
  - Reads `qr_code` from query parameters.
  - Looks up the record in a Google Sheet (`Agroverse QR codes`).
  - Returns bag metadata as JSON, or an error/instructions object.

- **NGINX** (`api_truesight_me.conf`)
  - Listens on `api.truesight.me` (HTTP→HTTPS redirect).
  - Namespaces API endpoints under `/v1/` and proxies them to the Apps Script URL.
  - Redirects all other paths to the documentation repo.

## Usage

### Query Parameters
- `qr_code` (required): the serialized bag identifier embedded in the QR code.
- `format` (optional): if set to `json`, the API returns the full record as JSON (columns A–D: `qr_code`, `landing_page`, `ledger`, `status`), bypassing any redirect.

1. Scan the QR code on a cacao bag.
2. Your client opens:
   ```
   http://api.truesight.me/v1/?qr_code=HAPPY_BAG
   ```
3. Possible responses:
   - **200 OK** with JSON bag details if `qr_code` is found.
   - **200 OK** with `{ error, instructions }` if `qr_code` is missing or unknown.
   - **302 Redirect** to documentation for paths outside `/v1/`.
   - **200 OK** with full JSON record (columns A–D: `qr_code`, `landing_page`, `ledger`, `status`) if `format=json` is supplied as a query parameter (overrides any redirect).

## Configuration

- **DNS**: Create a CNAME `api.truesight.me` pointing to your NGINX server.
- **SSL**: Place certificates at:
  - `/etc/ssl/certs/api.truesight.me.crt`
  - `/etc/ssl/private/api.truesight.me.key`
**NGINX** (`api_truesight_me.conf`):
  This repository provides two main setups:

  A) Full SSL-proxy (production-ready):
     ```nginx
     upstream google_app_web_service {
         server script.google.com:443 max_fails=0;
     }
     server {
         listen 443 ssl;
         server_name api.truesight.me;

         ssl_certificate     /etc/ssl/certs/api.truesight.me.crt;
         ssl_certificate_key /etc/ssl/private/api.truesight.me.key;

         add_header Strict-Transport-Security max-age=31536000;

         location /v1/ {
             proxy_pass https://google_app_web_service/macros/s/YOUR_SCRIPT_ID/exec$is_args$args;
             proxy_set_header Host              script.google.com;
             proxy_set_header X-Real-IP         $remote_addr;
             proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
             proxy_set_header X-Forwarded-Proto https;
         }
     }
     ```

  B) Temporary HTTP-only redirect (V1 hack):
     ```nginx
     server {
         listen 80;
         server_name api.truesight.me;

         # Redirect /v1/ calls to Apps Script endpoint
         location /v1/ {
             return 302 https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec$is_args$args;
         }

         # Redirect all other requests to documentation
         location / {
             return 302 https://github.com/TrueSightDAO/tokenomics/tree/main/google_app_scripts/agroverse_qr_code_checking;
         }
     }
     ```

  After editing your config, reload NGINX:
  ```bash
  nginx -t && systemctl reload nginx
  ```
  2. Reload NGINX:
-  ```bash
  nginx -t && systemctl reload nginx
  ```
- **Web App URL**:
  - `https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec`
- - **Google Apps Script** (`web_app.gs`):
  - `SHEET_URL`: URL of the Google Sheet.
    For example:
    https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231
  - `SHEET_NAME`: `Agroverse QR codes`.
  - `HEADER_ROW`: 2 (where column names live).
  - `DATA_START_ROW`: 3 (where data begins).
  - `QR_CODE_PARAM`: `qr_code` (header name).

## Extending and Redirects

By default, if your spreadsheet includes a column named `landing_page` (in the header row) and a column named `status`, the API will automatically:

1. Look up the `qr_code` in your sheet.
2. Extract `redirect_url` and `status` for that row.
3. Send back an HTML‐based redirect to the URL in `redirect_url`.
4. Append a `status` query parameter: `?status=<encoded status>` (or `&status=…` if the URL already has parameters).

Example:

  Sheet header row (row 2):
    | qr_code | landing_page               | status    |
    |---------|----------------------------|-----------|
    | ABC123  | https://shop.example.com/a | delivered |

  Request:
    https://api.truesight.me/v1/?qr_code=ABC123

  Result: immediate HTML redirect →
    https://shop.example.com/a?status=delivered

If there’s no `redirect_url` column or the row’s value is empty, the API continues returning JSON as before.

## QR Code Generation Details

### Spreadsheet Structure

#### Input: "Telegram Chat Logs" Tab
- **Column G**: Contains the full contribution text including `[BATCH QR CODE REQUEST]` messages
- **Column D**: Message ID for deduplication
- **Other columns**: Standard telegram log data

#### Output: "QR Code Generation" Tab
| Column | Header | Description |
|--------|--------|-------------|
| A | Telegram Update ID | Unique identifier from telegram |
| B | Telegram Chatroom ID | Chatroom where request was made |
| C | Telegram Chatroom Name | Name of the chatroom |
| D | Telegram Message ID | Message ID for deduplication |
| E | Contributor Handle | Telegram handle of contributor |
| F | Contribution Made | Full request text |
| G | Status Date | Date when request was processed |
| H | Contributor Name | Resolved contributor name from digital signature |
| I | Currency | Currency/product name requested |
| J | Zip File Download URL | Direct download link when completed |
| K | Expected Zip File | Predicted zip file name |
| L | Status | PENDING/COMPLETED/FAILED (includes processing notes) |
| M | Status | Empty (status moved to Column L) |
| N | Processing Notes | Empty (notes are combined with status in Column L) |

### Message Format

The script looks for messages starting with `[BATCH QR CODE REQUEST]` and extracts:

```
[BATCH QR CODE REQUEST]
- Currency: [currency_name]
- Quantity: [quantity]
- Contributor: [contributor_name]
- Timestamp: [ISO_timestamp]
- Expected Zip File: [zip_filename]
- Download Location: [github_url]
--------

My Digital Signature: [public_key]
Request Transaction ID: [signed_hash]
...
```

### Key Generation Functions

#### `processQRCodeGenerationTelegramLogs()`
- Main processing function that runs periodically
- Scans telegram logs for new requests
- Creates records in the QR Code Generation tab
- Sends notifications

#### `updateQRCodeGenerationStatus(messageId, status, notes)`
- Updates the status of a specific request
- Used by backend processes to mark progress

#### `markQRCodeGenerationCompleted(messageId, zipFileUrl, notes)`
- Marks a request as completed
- Includes the final zip file location

#### `markQRCodeGenerationFailed(messageId, errorMessage)`
- Marks a request as failed
- Includes error details for debugging

### Required Token Setup

The generation system requires two tokens to function properly:

#### 1. Telegram Bot Token
- Create a bot via [@BotFather](https://t.me/botfather) on Telegram
- Copy the bot token
- Add to Script Properties: `TELEGRAM_API_TOKEN = your_telegram_bot_token`

#### 2. GitHub Personal Access Token
- Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
- Click "Generate new token (classic)"
- Give it a descriptive name (e.g., "TrueSight DAO QR Code Generator")
- Select scopes: `repo` (to trigger repository_dispatch events)
- Copy the generated token
- Add to Script Properties: `GITHUB_TOKEN = your_github_personal_access_token`

#### 3. Verify Configuration
- Run the `checkRequiredConfiguration()` function to verify both tokens
- This will check both Telegram and GitHub token setup

### Complete QR Code Generation Process

#### 1. Telegram Log Processing
- Monitors "Telegram Chat Logs" tab for `[BATCH QR CODE REQUEST]` messages
- Extracts structured data (currency, quantity, contributor, etc.)
- Creates tracking record in "QR Code Generation" tab

#### 2. Agroverse Spreadsheet Integration
- Creates individual QR code records in the [Agroverse QR codes spreadsheet](https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit?gid=472328231)
- Generates unique QR code values (e.g., `2024_20241215_001`)
- Sets status to "MINTED" for each generated code
- Includes batch information and contributor details

#### 3. GitHub Actions Webhook
- Triggers `qr-code-batch-generation` event in TrueSightDAO/tokenomics repository
- Sends batch information (start row, end row, zip file name)
- GitHub Actions workflow generates QR code images
- Creates zip file with all generated QR codes
- Uploads to `qr_codes` repository

#### 4. Status Tracking
- **PENDING**: Request received and queued
- **PROCESSING**: QR codes created, GitHub webhook triggered
- **COMPLETED**: Zip file generated and available for download
- **FAILED**: Error occurred during processing

#### 5. Email Notifications
- Automatically sends email notifications to requesters when QR codes are generated
- Looks up requester email using digital signature from [Contributors Digital Signatures spreadsheet](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=577022511#gid=577022511)
- Includes complete request details, batch information, and download links

### Testing and Debugging

The generation system includes several test functions to help verify functionality:

#### `checkRequiredConfiguration()`
- Verifies that all required tokens are properly configured
- Returns status of both Telegram and GitHub token setup
- Run this first to ensure all functionality will work

#### `testGitHubToken()`
- Verifies that the GitHub token is properly configured
- Returns status of token setup
- Run this first to ensure webhook triggering will work

#### `testProcessSpecificRow(rowNumber)`
- Tests processing of a specific row from the "Telegram Chat Logs" tab
- **⚠️ IMPORTANT**: Will NOT process records that have already been processed
- Checks QR Code Generation tab for existing message IDs and skips duplicates
- Useful for debugging individual requests
- Example: `testProcessSpecificRow(150)` to test row 150

#### `testProcessMultipleRows(startRow, endRow)`
- Tests processing of a range of rows
- Provides summary of successful/failed processing
- Example: `testProcessMultipleRows(100, 200)` to test rows 100-200

#### `testCompleteWorkflow(messageId)`
- Tests the complete workflow for a specific message ID
- Verifies status updates and spreadsheet operations
- Useful for end-to-end testing

### Testing Workflow

1. **Start with configuration check**: Run `checkRequiredConfiguration()` to verify all tokens
2. **Test single row processing**: Use `testProcessSpecificRow()` on a known batch QR request
3. **Test multiple rows**: Use `testProcessMultipleRows()` to process a range
4. **Verify complete workflow**: Use `testCompleteWorkflow()` to test end-to-end functionality

## QR Code Update Processing

The QR code update system processes status and email updates from the DApp and applies them to the Agroverse QR codes sheet.

### Overview

Following the established pattern used by other DAO tools:
1. **Reads** from the "Telegram Chat Logs" sheet (security: no direct parameter injection)
2. **Processes** QR code update requests containing `[QR CODE UPDATE EVENT]`
3. **Updates** the "Agroverse QR codes" sheet:
   - Column D (status) if provided
   - Column L (email) if provided
   - Column U (manager name) if member association provided
4. **Marks** source row in "Telegram Chat Logs" as "PROCESSED"

### Update Architecture

- **Google Apps Script** (`process_qr_code_updates.gs`)
  - Monitors the "Telegram Chat Logs" sheet for new update requests
  - Extracts QR code, status, and email from `[QR CODE UPDATE EVENT]` messages
  - Updates corresponding records in the "Agroverse QR codes" sheet
  - Marks processed rows in "Telegram Chat Logs"

- **Data Flow**
  - User submits update via `update_qr_code.html` → Edgar → Telegram Chat Logs
  - Script processes telegram logs → Updates "Agroverse QR codes" sheet
  - Status updated in "Telegram Chat Logs" → "PROCESSED"

### Update Workflow

1. **User submits update** via the HTML form (`update_qr_code.html`)
2. **Request goes to Edgar** → Logged to "Telegram Chat Logs" sheet
3. **Webhook triggered** (via Sidekiq) → Calls Google Apps Script `doGet` with action `processQrCodeUpdatesFromTelegramChatLogs`
4. **Script processes logs** → Extracts QR code, status, email
5. **Script updates Agroverse QR codes** sheet
6. **Status updated** → "PROCESSED" in "Telegram Chat Logs"

### Update Setup

1. **Copy the script** (`process_qr_code_updates.gs`) to your Google Apps Script project
2. **Deploy as web app** (Deploy > New deployment > Web app)
3. **Copy the web app URL** and update `config/application.rb`:
   ```ruby
   config.qr_code_update_webhook_url = "YOUR_WEBHOOK_URL/exec"
   ```
4. **Set up time-driven trigger** for `processQrCodeUpdatesCron()`:
   - Click "Triggers" (clock icon) in left sidebar
   - Click "+ Add Trigger"
   - Function: `processQrCodeUpdatesCron`
   - Event source: "Time-driven"
   - Type: "Minutes timer" or "Hour timer"
   - Interval: Every 5-15 minutes (recommended)
5. **Verify** the "Agroverse QR codes" sheet exists and is accessible

### Update Message Format

The script processes messages starting with `[QR CODE UPDATE EVENT]` and extracts:

```
[QR CODE UPDATE EVENT]
- QR Code: <qr_code>
- Associated Member: <member_name> (optional)
- New Status: <status> (optional)
- New Email: <email> (optional)
- Updated by: <contributor_name>
- Submission Source: <source_url>
--------

My Digital Signature: <public_key>
Request Transaction ID: <signed_hash>
...
```

### Valid Status Values

- `ACTIVE` - QR code is active and available
- `SOLD` - QR code has been sold
- `MINTED` - QR code has been minted/generated
- `CONSIGNMENT` - QR code is on consignment

### Update Processing Functions

#### `processQrCodeUpdatesFromTelegramChatLogs()`
- Main processing function
- Reads from "Telegram Chat Logs" sheet
- Updates "Agroverse QR codes" sheet
- Marks processed rows
- Returns processing result with counts

#### `processQrCodeUpdatesCron()`
- Cron-triggered function for backup processing
- Processes any unprocessed records
- Runs on a schedule (e.g., every 5-15 minutes)

#### `extractQrCodeUpdateInfo(message)`
- Extracts QR code, member, status, and email from message text
- Validates status values
- Returns structured data object

### Security Features

- **No parameter injection**: Webhook handler does not accept parameters - all data read from "Telegram Chat Logs" sheet
- **Status validation**: Only valid status values are accepted
- **Email validation**: Email format is validated before updating
- **Deduplication**: Processes only rows with status "PENDING", "NEW", or empty

### GitHub Location

- Script: [`google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs`](https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs)
- DApp Module: [`dapp/update_qr_code.html`](https://github.com/TrueSightDAO/dapp/blob/main/update_qr_code.html)
- Edgar Endpoint: [`sentiment_importer/app/controllers/dao_controller.rb`](https://github.com/TrueSightDAO/tokenomics/blob/main/sentiment_importer/app/controllers/dao_controller.rb)
- Documentation: [`API_ENDPOINTS.md`](https://github.com/TrueSightDAO/tokenomics/blob/main/API_ENDPOINTS.md)

## License

This project is released under the MIT License. See LICENSE for details.