# TDG Asset Management Scripts

This folder contains Python scripts for managing TDG assets, statistics, and ledger data.

## Scripts

### AWS Recurring Expense Tokenizer
- `tdg_aws_recurring_tokenization_monthly.py` - Automates monthly tokenization of AWS recurring expenses

### Monthly Statistics
- `backfill_monthly_statistics.py` - One-time backfill script to calculate monthly sales volume from all ledgers and populate the "Monthly Statistics" sheet

### Ledger URL Resolution
- `resolve_ledger_urls.py` - Parses legacy-redirects.js and matches with Shipment Ledger Listing to create resolved URL mappings
- `update_resolved_urls.py` - Updates column AB in "Shipment Ledger Listing" with resolved URLs from legacy-redirects.js

## Prerequisites

- Python 3.x
- Install dependencies (from the local requirements file):
  ```bash
  pip install -r requirements.txt
  ```

Save your Google API credential file to 
- `edgar_aws_billing_automation_google_cloud_key.json` (for AWS tokenization)
- Or use the credentials from `../schema_validation/gdrive_schema_credentials.json` (for monthly statistics and ledger scripts)

For AWS tokenization, run the following command:
```
python3 generate_base64_credentials_for_environment.py
```

Set the output from `edgar_aws_billing_automation_google_cloud_key_base64.txt` to environment variable `GOOGLE_CREDENTIALS`

## Usage

### Monthly Statistics Backfill
```bash
python3 backfill_monthly_statistics.py
```

### Resolve Ledger URLs
```bash
python3 resolve_ledger_urls.py
```

### Update Resolved URLs in Sheet
```bash
python3 update_resolved_urls.py
```

## Deployment for GitHub Action
Set the following variables as repository secrets:

  - AWS_ACCESS_KEY_ID_GARYJOB
  - AWS_ACCESS_KEY_ID_GARYJOB
  - AWS_ACCESS_KEY_ID_NELAN
  - AWS_SECRET_ACCESS_KEY_NELAN
  - GOOGLE_CREDENTIALS

Make sure not to mistake repository variables for environmental variables as the later does not get picked up by Github