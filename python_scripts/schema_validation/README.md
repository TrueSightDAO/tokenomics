# Schema Validation for TrueSight DAO

This tool validates the accuracy of `SCHEMA.md` by testing Google Sheets and Wix data collections, and extracts actual column headers from all sheets.

## Setup

### 1. Install Python dependencies

The parent `python_scripts` folder already has all required dependencies:
```bash
cd /Users/garyjob/Applications/tokenomics/python_scripts
pip install -r requirements.txt
```

### 2. Set up Google Sheets API credentials

- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a new project or select existing one
- Enable the Google Sheets API
- Create credentials (OAuth 2.0 Client ID)
  - Application type: Desktop app
- Download the credentials file and save as `credentials.json` in this `schema_validation` directory:
  ```
  /Users/garyjob/Applications/tokenomics/python_scripts/schema_validation/credentials.json
  ```

### 3. Set up Wix API access (Optional)

If you want to validate Wix collections:
```bash
export WIX_ACCESS_TOKEN="your_wix_access_token_here"
```

If not set, the script will skip Wix tests and only validate Google Sheets.

## Running the Tests

From the tokenomics root:
```bash
cd /Users/garyjob/Applications/tokenomics
python python_scripts/schema_validation/test_schema_validation.py
```

Or from this directory:
```bash
cd /Users/garyjob/Applications/tokenomics/python_scripts/schema_validation
python test_schema_validation.py
```

## What the Script Does

1. **Tests Google Sheets Access:**
   - Validates all spreadsheet IDs are accessible
   - Checks all sheet names exist
   - Extracts actual column headers from each sheet

2. **Tests Wix Collections (if token provided):**
   - Validates collection accessibility
   - Checks specific data item IDs
   - Verifies expected descriptions and currencies

3. **Generates Output:**
   - Displays pass/fail status for each test
   - Shows discovered column headers for all sheets
   - Saves column headers to `discovered_headers.json`
   - Provides detailed error messages for failures

## Output

### Console Output
```
🧪 TrueSight DAO Schema Validation Tests
==================================================

📊 Testing Google Sheets...
✅ PASS Spreadsheet Access: Telegram & Submissions
    Title: TrueSight DAO Telegram & Submissions
✅ PASS Sheet Exists: Telegram Logs
    Found sheet 'Telegram Chat Logs' with 15 columns

🔄 Testing Wix Collections...
✅ PASS Wix Collection: AgroverseShipments
    Found 15 items

==================================================
📊 Test Summary
✅ Passed: 12
❌ Failed: 0
🎯 Success Rate: 100.0%
🎉 All tests passed! SCHEMA.md is accurate.

==================================================
📋 Discovered Column Headers
==================================================

📄 Telegram Chat Logs (1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ)
   Columns: Date, Chat Name, Message, ...

💾 Column headers saved to: discovered_headers.json
```

### JSON Output

The script saves all discovered headers to `discovered_headers.json`:
```json
{
  "spreadsheet_id|sheet_name": ["Column1", "Column2", ...],
  ...
}
```

This file can be used to programmatically update `SCHEMA.md`.

## First Run

On first run, you'll be prompted to authenticate with Google:
1. A browser window will open
2. Log in with your Google account
3. Grant access to read spreadsheets
4. The credentials will be saved to `token.json` for future runs

## Troubleshooting

### Google Sheets API Issues
- Ensure `credentials.json` is in the `schema_validation` directory
- Check that Google Sheets API is enabled in your Google Cloud project
- Verify you have access to the spreadsheets being tested

### Wix API Issues
- Verify `WIX_ACCESS_TOKEN` is set correctly
- Check that the token has access to the required collections
- Ensure account ID and site ID are correct

### Common Errors
- **"credentials.json not found"** → Download OAuth 2.0 credentials from Google Cloud Console
- **"Access denied"** → Check Google account has access to the spreadsheets
- **"WIX_ACCESS_TOKEN not set"** → This is optional, Wix tests will be skipped

## Files

- `test_schema_validation.py` - Main validation script
- `credentials.json` - Google OAuth credentials (you create this)
- `token.json` - Cached authentication token (auto-generated)
- `discovered_headers.json` - Extracted column headers (auto-generated)
- `README.md` - This file

