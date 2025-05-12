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
2. Add a new script file named `manage.gs`.
3. Copy the contents of `manage.gs` into the script editor.

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
- To use a different spreadsheet or sheet name, update the constants at the top of `manage.gs`:
  ```js
  var SPREADSHEET_ID = 'your-spreadsheet-id';
  var SHEET_NAME     = 'your-sheet-name';
  ```

- To use a different contacts sheet for recipients, update `CONTACT_SHEET_NAME` in `manage.gs`:
  ```js
  var CONTACT_SHEET_NAME = 'your-contacts-sheet-name';
  ```

Feel free to modify or extend this script to fit your needs.