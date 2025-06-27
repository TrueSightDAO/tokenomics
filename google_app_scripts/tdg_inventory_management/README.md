# Inventory Managers List Web App

This Google Apps Script provides a simple web API to:
- List all unique inventory managers from a Google Sheet.
- Fetch asset data (currency and amount) for a specified inventory manager.
- List all possible recipients from the Contributors contact information sheet.

## Spreadsheet Requirements
- Spreadsheet ID: `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`
- Sheet name: `offchain asset location`
- Data range starts at row 5 (row 4 is assumed to be headers)
  - Column A: `currency`
  - Column B: `inventory manager name`
  - Column C: `amount`
- Recipients sheet name: `Contributors contact information`
- Recipients data range starts at row 5 (row 4 is assumed to be headers)
  - Column A: `recipient name`
- Example Reference: https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1487841772#gid=1487841772

## Installation
1. Go to [Google Apps Script](https://script.google.com/) and create a new project.
2. Add a new script file named `web_app.gs`.
3. Copy the contents of `web_app.gs` into the script editor.

## Deployment
1. In the Apps Script editor, click **Deploy > New deployment**.
2. Select **Web app** as the deployment type.
3. Under **Description**, enter an optional description (e.g., _Inventory Managers API_).
4. For **Execute as**, choose **Me** (so the script runs under your credentials).
5. For **Who has access**, select **Anyone** (or **Anyone with link**).
6. Click **Deploy**, then authorize the script if prompted.
7. Copy the **Web app URL** shown after deployment.

## Usage

### 1. List all inventory managers
```http
GET https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec?list=true
```
**Response**
```json
[
  { "key": "Manager Key 1", "name": "Manager A" },
  { "key": "Manager Key 2", "name": "Manager B" },
  ...
]
```
Each item includes:
- `key`: URL-encoded manager name (use this value for the `manager` parameter)
- `name`: display name of the inventory manager

### 2. Get assets for a specific manager
```http
GET https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec?manager=[[manager key]]
```
(Where `Manager%20A` is the `key` value from the list output)
**Response**
```json
[
  { "currency": "USD", "amount": 1200 },
  { "currency": "EUR", "amount": 800 },
  ...
]
```

### 3. List all possible recipients
```http
GET https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec?recipients=true
```
**Response**
```json
[
  { "key": "Alice%20Smith", "name": "Alice Smith" },
  { "key": "Bob%20Johnson", "name": "Bob Johnson" },
  ...
]
```
**Note**: Values are sourced from column A (rows 5 onward) of the `Contributors contact information` sheet in the same spreadsheet.

### 4. Error or help prompt
```http
GET https://script.google.com/macros/s/AKfycbztpV3TUIRn3ftNW1aGHAKw32OBJrp_p1Pr9mMAttoyWFZyQgBRPU2T6eGhkmJtz7xV/exec
```
**Response**
```json
{ "error": "Please specify ?list=true to list managers, ?manager=<key> to get assets, or ?recipients=true to list recipients." }
```

## Customization
- To use a different spreadsheet or sheet name, update the constants at the top of `web_app.gs`:
  ```js
  var SPREADSHEET_ID = 'your-spreadsheet-id';
  var SHEET_NAME     = 'your-sheet-name';
  ```

- To use a different contacts sheet for recipients, update `CONTACT_SHEET_NAME` in `web_app.gs`:
  ```js
  var CONTACT_SHEET_NAME = 'your-contacts-sheet-name';
  ```

Feel free to modify or extend this script to fit your needs.

## Telegram Chat Logs Parser

This Google Apps Script (`process_telegram_logs.gs`) parses Telegram chat logs stored in a Google Sheet and updates another Google Sheet with the sales states of serialized cacao bags. It uses xAI’s Grok model to extract QR codes and sale prices, validates contributors, and marks sold status in the Agroverse QR codes sheet.

### Spreadsheet & Script Requirements
- **Source Sheet** (`Telegram Chat Logs`): Holds raw Telegram chat data. Configure `SOURCE_SHEET_URL` and `SOURCE_SHEET_NAME` in `process_telegram_logs.gs`.
- **Destination Sheet** (`Scored Chatlogs`): Receives parsed output. Configure `DESTINATION_SHEET_URL` and `DESTINATION_SHEET_NAME`.
- **Contributors Sheet** (`Contributors contact information`): Validates contributors (Column H for Telegram handle).
- **Agroverse QR Codes Sheet** (`Agroverse QR codes`): Stores QR codes and their statuses.

### Installation & Setup
1. In your Apps Script project, add a new script file named `process_telegram_logs.gs` and paste the contents of the provided script.
2. Create a `Credentials.gs` file with two functions:
   ```js
   function setApiKeys() {
     // Store your XAI_API_KEY and any other properties:
     PropertiesService.getScriptProperties()
       .setProperty('XAI_API_KEY', 'your_xai_api_key');
   }
   function getCredentials() {
     return {
       XAI_API_KEY: PropertiesService.getScriptProperties().getProperty('XAI_API_KEY'),
       SOURCE_SHEET_URL: 'https://...',
       SOURCE_SHEET_NAME: 'Telegram Chat Logs',
       DESTINATION_SHEET_URL: 'https://...',
       DESTINATION_SHEET_NAME: 'Scored Chatlogs',
       CONTRIBUTORS_SHEET_URL: 'https://...',
       CONTRIBUTORS_SHEET_NAME: 'Contributors contact information',
       AGROVERSE_QR_SHEET_URL: 'https://...',
       AGROVERSE_QR_SHEET_NAME: 'Agroverse QR codes'
     };
   }
   ```
3. Run `setApiKeys()` once to initialize your script properties.
4. Authorize the script when prompted.

### Execution
- **Manual Run**: In the Apps Script editor, select the function `parseTelegramChatLogs` and click **Run**.
- **Automated Trigger**: Set up a time-driven trigger:
  1. In Apps Script, go to **Triggers**.
  2. Click **Add Trigger**, choose `parseTelegramChatLogs`, select a schedule (e.g., hourly or daily).
  3. Save and authorize.

Parsed log entries will appear in your destination sheet, and sold statuses will be updated in the Agroverse QR codes sheet.

## Setting Up a New Ledger for Management by Edgar (agl9)

This section outlines the steps to create and configure a new ledger named `agl9` for management by Edgar within the Agroverse system.

### Steps to Create and Configure the Ledger

1. **Create a New Ledger**
   - Copy an existing ledger template from [https://agroverse.shop/agl9](https://agroverse.shop/agl9).
   - Ensure the new ledger is named `agl9` and adheres to the structure of existing ledgers for consistency.

2. **Create a New Tree Planting Entity**
   - Navigate to [https://truesight.me/members-directory](https://truesight.me/members-directory).
   - Create a new entity named `Agroverse Tree Planting Contract - agl9`, following the naming convention of existing entities.

3. **Create New Currency Types**
   - Visit [https://truesight.me/currencies](https://truesight.me/currencies).
   - Define any new currency types to be tracked for the `agl9` ledger. Ensure currency names match those used in the `offchain asset location` sheet (Column A).

4. **Create Serialized Inventory Items**
   - Go to [https://truesight.me/physical-assets/serialized](https://truesight.me/physical-assets/serialized).
   - Create serialized inventory items specific to the `agl9` ledger, ensuring they are linked to the appropriate currency types and inventory manager (Edgar).

### Notes
- Update the `offchain asset location` sheet in the spreadsheet (`1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`) to include entries for the `agl9` ledger, listing Edgar as the inventory manager in Column B.
- Ensure the `Contributors contact information` sheet includes any new contributors or recipients associated with the `agl9` ledger, if applicable.
- If the new ledger requires integration with the Telegram Chat Logs Parser, update the `Agroverse QR codes` sheet with any new QR codes for serialized inventory items in `agl9`.