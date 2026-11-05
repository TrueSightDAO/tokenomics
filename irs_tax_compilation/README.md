# IRS Tax Compilation - 2025 Tax Year

This codebase extracts sales and expenses transactions from TrueSight DAO ledgers for IRS tax filing purposes.

## 📋 Overview

### Tax Filing Information

- **EIN Number**: `88-3411514` (Employer Identification Number)
- **File Number**: `006913393` (IRS File Number)
- **Tax Year**: 2025

> 📄 See [TAX_FILING_INFO.md](TAX_FILING_INFO.md) for detailed tax filing information.

This script reads financial transactions from:
- **Main Ledger** (`offchain transactions` sheet)
- **Managed AGL Ledgers** (from `Shipment Ledger Listing`)

And writes them to:
- **Tax Compilation Spreadsheet**: [20260128 - 2025 IRS tax compilation](https://docs.google.com/spreadsheets/d/1B3R7626-I5Ql26Rsv4F6xoM_X8f0Hqx9vANqRoavxNA/edit)
  - **Sales Tab**: All positive USD transactions (revenue)
  - **Expenses Tab**: All negative USD transactions (expenses)

## 🎯 Key Features

- ✅ **Year Filtering**: Only processes transactions from 2025
- ✅ **Duplicate Prevention**: Checks existing rows before inserting
- ✅ **Incremental Updates**: Only adds new transactions, doesn't regenerate entire sheet
- ✅ **Multi-Ledger Support**: Processes main ledger and all managed AGL ledgers
- ✅ **Source Tracking**: Each row includes source ledger name and URL

## 📚 Context & Schema Reference

This codebase references the **SCHEMA.md** document in the parent `tokenomics` repository for understanding:
- Ledger structure and column mappings
- Sheet names and GIDs
- Data formats and conventions

**Key Schema References:**
- [offchain transactions sheet](https://github.com/TrueSightDAO/tokenomics/blob/main/SCHEMA.md#sheet-offchain-transactions)
- [Shipment Ledger Listing](https://github.com/TrueSightDAO/tokenomics/blob/main/SCHEMA.md#sheet-shipment-ledger-listing)
- [Managed AGL Ledgers](https://github.com/TrueSightDAO/tokenomics/blob/main/SCHEMA.md#-managed-agl-ledgers-dynamic)

## 🔐 Authentication

Uses Google Service Account credentials:
- **Service Account Email**: `irs-tax-filing@get-data-io.iam.gserviceaccount.com`
- **Credentials File**: `credentials.json` (must be placed in this directory)

**⚠️ Important**: The `credentials.json` file is gitignored for security. You must obtain it separately and place it in this directory.

## 🚀 Setup

### 1. Create Virtual Environment

```bash
cd /Users/garyjob/Applications/tokenomics/irs_tax_compilation
python3 -m venv venv
source venv/bin/activate  # On macOS/Linux
# or
venv\Scripts\activate  # On Windows
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Add Credentials

Copy the service account JSON file to this directory:

```bash
cp /path/to/get-data-io-f6d04fa45a1c.json credentials.json
```

Or manually place `credentials.json` in this directory.

### 4. Verify Access

Ensure the service account has been granted access to:
- Main Ledger: `1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU`
- Tax Compilation Spreadsheet: `1B3R7626-I5Ql26Rsv4F6xoM_X8f0Hqx9vANqRoavxNA`
- All managed AGL ledgers (via Shipment Ledger Listing)

## 📊 Usage

### Run the Script

```bash
python3 irs_tax_compiler.py
```

### What It Does

1. **Reads existing data** from Sales and Expenses tabs to prevent duplicates
2. **Processes Main Ledger** (`offchain transactions` sheet):
   - Filters for 2025 transactions
   - Identifies sales (positive USD or Is Revenue = TRUE)
   - Identifies expenses (negative USD and Is Revenue != TRUE)
3. **Fetches Managed Ledgers** from `Shipment Ledger Listing` sheet
4. **Processes each Managed Ledger**:
   - Finds transaction sheet (auto-detects header row)
   - Extracts 2025 USD transactions
   - Categorizes as sales or expenses
5. **Writes new transactions** to tax compilation spreadsheet:
   - Appends to Sales tab (if not duplicate)
   - Appends to Expenses tab (if not duplicate)

## 📝 Output Format

Each row in the output includes:

| Column | Description |
|--------|-------------|
| Transaction Date | Date in YYYYMMDD format |
| Description | Transaction description |
| Fund Handler/Contributor | Person who handled the funds |
| Amount (USD) | Transaction amount (positive for sales, negative for expenses) |
| Currency | Always "USD" |
| Source Ledger | Name of the ledger (e.g., "Main Ledger (offchain transactions)", "AGL2") |
| Ledger URL | Direct link to the source ledger |
| Row Number | Row number in the source sheet |

## 🔍 Transaction Classification

### Sales (Revenue)
- Positive USD amount, OR
- `Is Revenue` column = TRUE/YES/1

### Expenses
- Negative USD amount, AND
- `Is Revenue` column != TRUE/YES/1

## ⚙️ Configuration

Key constants in `irs_tax_compiler.py`:

```python
TARGET_YEAR = 2025  # Tax year to process
MAIN_LEDGER_ID = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU"
MAIN_LEDGER_OFFCHAIN_GID = "995916231"  # offchain transactions sheet
TAX_COMPILATION_SPREADSHEET_ID = "1B3R7626-I5Ql26Rsv4F6xoM_X8f0Hqx9vANqRoavxNA"
```

## 🛡️ Duplicate Prevention

The script uses a hash-based duplicate detection system:
- Creates hash from: `Transaction Date | Description | Amount | Source Ledger`
- Checks against existing rows before inserting
- Prevents duplicate entries even if script is run multiple times

## 📋 Data Sources

### Main Ledger Sheets Processed

1. **offchain transactions** (GID: 995916231)
   - Header Row: 4
   - Columns: Transaction Date, Description, Fund Handler, Amount, Currency, Is Revenue
   - Source: [Main Ledger - offchain transactions](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=995916231)
   - **Primary source for USD expenses and sales**

2. **Ledger History** (GID: 0)
   - Header Row: 4
   - **Note**: This sheet primarily tracks TDG token awards, not USD transactions
   - Source: [Main Ledger - Ledger History](https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0)
   - Currently not processed as it doesn't contain USD transactions

### Managed Ledgers

- Automatically discovered from `Shipment Ledger Listing` sheet
- Each ledger's transaction sheet is auto-detected
- Column headers are dynamically identified

## 🐛 Troubleshooting

### "Credentials file not found"
- Ensure `credentials.json` is in the script directory
- Check file permissions

### "Permission denied" errors
- Verify service account has access to all spreadsheets
- Share spreadsheets with: `irs-tax-filing@get-data-io.iam.gserviceaccount.com`

### "No transactions found"
- Check that transactions exist for 2025
- Verify date format is YYYYMMDD
- Ensure transactions are in USD

### "Column not found" warnings
- Managed ledgers may have different column structures
- Script will skip ledgers with missing required columns

## 📖 Related Documentation

- [SCHEMA.md](../SCHEMA.md) - Complete schema reference for all Google Sheets
- [API.md](../API.md) - API endpoints and integrations
- [README.md](../README.md) - Main tokenomics repository documentation

## 🔄 Maintenance

### Updating for New Tax Year

1. Update `TARGET_YEAR` constant
2. Update tax compilation spreadsheet ID if needed
3. Run script to extract new year's transactions

### Adding New Data Sources

1. Add new spreadsheet ID to configuration
2. Implement processing function similar to `process_managed_ledger()`
3. Call from `main()` function

## 📞 Support

For issues or questions:
1. Check SCHEMA.md for ledger structure
2. Verify service account permissions
3. Review error messages for specific issues

---

**Last Updated**: 2025-01-28  
**Tax Year**: 2025  
**Service Account**: irs-tax-filing@get-data-io.iam.gserviceaccount.com
