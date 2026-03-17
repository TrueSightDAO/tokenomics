#!/usr/bin/env python3
"""
Fetch formulas from the 'off chain asset balance' sheet, especially column D.
Run from tokenomics root: python python_scripts/schema_validation/fetch_balance_formulas.py
"""

import os
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
SHEET_NAME = 'off chain asset balance'

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    creds_path = os.path.join(script_dir, 'gdrive_schema_credentials.json')
    if not os.path.exists(creds_path):
        print(f"Credentials not found: {creds_path}")
        sys.exit(1)

    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    service = build('sheets', 'v4', credentials=creds)

    # Fetch formulas (first 20 rows, columns A-D)
    range_name = f"'{SHEET_NAME}'!A1:D20"
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=range_name,
        valueRenderOption='FORMULA'
    ).execute()

    values = result.get('values', [])
    print(f"=== Formulas in '{SHEET_NAME}' (A1:D20) ===\n")
    for i, row in enumerate(values):
        # Pad row to 4 columns for display
        padded = (row + [''] * 4)[:4]
        print(f"Row {i+1}: A={padded[0]!r} | B={padded[1]!r} | C={padded[2]!r} | D={padded[3]!r}")

    # Also fetch D column specifically for more rows to see the pattern
    range_d = f"'{SHEET_NAME}'!D1:D75"
    result_d = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=range_d,
        valueRenderOption='FORMULA'
    ).execute()
    d_values = result_d.get('values', [])
    print(f"\n=== Column D formulas (D1:D75) ===\n")
    for i, row in enumerate(d_values):
        val = row[0] if row else ''
        if val and (val.startswith('=') or i < 5):
            print(f"D{i+1}: {val}")

if __name__ == '__main__':
    main()
