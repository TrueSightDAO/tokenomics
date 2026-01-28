# Quick Start Guide

## 🚀 Fast Setup (3 Steps)

### Step 1: Run Setup Script
```bash
cd /Users/garyjob/Applications/tokenomics/irs_tax_compilation
./setup.sh
```

### Step 2: Verify Credentials
The `credentials.json` file should already be in place. If not, copy it:
```bash
cp ~/Downloads/get-data-io-f6d04fa45a1c.json credentials.json
```

### Step 3: Run the Script
```bash
./run.sh
```

Or manually:
```bash
source venv/bin/activate
python3 irs_tax_compiler.py
```

## ✅ What It Does

1. Reads existing Sales and Expenses tabs to prevent duplicates
2. Processes Main Ledger (`offchain transactions` sheet) for 2025 USD transactions
3. Processes all Managed AGL Ledgers (from `Shipment Ledger Listing`)
4. Writes new transactions to:
   - **Sales Tab**: Positive USD transactions
   - **Expenses Tab**: Negative USD transactions

## 📊 Output Location

[20260128 - 2025 IRS tax compilation](https://docs.google.com/spreadsheets/d/1B3R7626-I5Ql26Rsv4F6xoM_X8f0Hqx9vANqRoavxNA/edit)

## 🔍 Verification

After running, check:
- Sales tab has new 2025 revenue transactions
- Expenses tab has new 2025 expense transactions
- Each row includes source ledger name and URL
- No duplicate entries

## ⚠️ Troubleshooting

**"Permission denied"**: Share spreadsheets with `irs-tax-filing@get-data-io.iam.gserviceaccount.com`

**"No transactions found"**: Verify transactions exist for 2025 in USD

**"Module not found"**: Run `pip install -r requirements.txt` in activated venv
