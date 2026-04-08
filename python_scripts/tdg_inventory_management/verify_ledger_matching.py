#!/usr/bin/env python3
"""
Verify ledger matching logic for inventory movement processing.

This script verifies that QR code ledger shortcuts can be correctly matched
to ledger configurations in the Shipment Ledger Listing sheet.

Usage:
    python verify_ledger_matching.py [QR_CODE]
    
Example:
    python verify_ledger_matching.py 2025CAPELAVELHA_20250809_7
"""

import json
import os
import re
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
except ImportError:
    print("Error: google-auth and google-api-python-client packages required")
    print("Install with: pip install google-auth google-api-python-client")
    sys.exit(1)

SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']

# Spreadsheet IDs
AGROVERSE_QR_SHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
AGROVERSE_QR_SHEET_NAME = 'Agroverse QR codes'
SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing'

# Column indices (0-based)
QR_CODE_COL = 0  # Column A
LEDGER_COL = 2   # Column C - ledger shortcut
CURRENCY_COL = 8 # Column I - Currency/Inventory Type

SHIPMENT_ID_COL = 0  # Column A - Shipment ID (ledger name)
LEDGER_URL_COL = 11  # Column L - Ledger URL


def setup_google_sheets():
    """Initialize Google Sheets API service"""
    try:
        # Try to find credentials file
        creds_paths = [
            os.path.join(os.path.dirname(__file__), '..', 'schema_validation', 'gdrive_schema_credentials.json'),
            os.path.join(os.path.dirname(__file__), 'gdrive_schema_credentials.json'),
            os.path.expanduser('~/.config/gdrive_schema_credentials.json'),
        ]
        
        creds_path = None
        for path in creds_paths:
            if os.path.exists(path):
                creds_path = path
                break
        
        if not creds_path:
            print("Error: Could not find Google Sheets credentials file")
            print("Please place gdrive_schema_credentials.json in one of:")
            for path in creds_paths:
                print(f"  - {path}")
            return None
        
        creds = service_account.Credentials.from_service_account_file(
            creds_path, scopes=SCOPES)
        service = build('sheets', 'v4', credentials=creds)
        return service
    except Exception as e:
        print(f"Error setting up Google Sheets API: {e}")
        return None


def lookup_qr_code(service, qr_code):
    """Look up QR code information from Agroverse QR codes sheet"""
    try:
        range_name = f"'{AGROVERSE_QR_SHEET_NAME}'!A:I"
        result = service.spreadsheets().values().get(
            spreadsheetId=AGROVERSE_QR_SHEET_ID,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values:
            return None
        
        # Skip header row
        for i, row in enumerate(values[1:], start=2):
            if len(row) > QR_CODE_COL and row[QR_CODE_COL].strip() == qr_code.strip():
                currency = row[CURRENCY_COL].strip() if len(row) > CURRENCY_COL else ''
                ledger_shortcut = row[LEDGER_COL].strip() if len(row) > LEDGER_COL else ''
                
                return {
                    'qr_code': qr_code,
                    'currency': currency,
                    'ledger_shortcut': ledger_shortcut,
                    'row': i
                }
        
        return None
    except Exception as e:
        print(f"Error looking up QR code: {e}")
        return None


def get_ledger_configs(service):
    """Fetch ledger configurations from Shipment Ledger Listing sheet"""
    try:
        range_name = f"'{SHIPMENT_LEDGER_SHEET_NAME}'!A:M"
        result = service.spreadsheets().values().get(
            spreadsheetId=AGROVERSE_QR_SHEET_ID,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values or len(values) < 2:
            return []
        
        ledger_configs = []
        seen_urls = set()
        
        # Skip header row
        for row in values[1:]:
            if len(row) <= max(SHIPMENT_ID_COL, LEDGER_URL_COL):
                continue
            
            shipment_id = row[SHIPMENT_ID_COL].strip() if len(row) > SHIPMENT_ID_COL else ''
            ledger_url = row[LEDGER_URL_COL].strip() if len(row) > LEDGER_URL_COL else ''
            
            if not shipment_id or not ledger_url:
                continue
            
            # Skip duplicates
            if ledger_url in seen_urls:
                continue
            seen_urls.add(ledger_url)
            
            ledger_configs.append({
                'ledger_name': shipment_id,
                'ledger_url': ledger_url
            })
        
        return ledger_configs
    except Exception as e:
        print(f"Error fetching ledger configs: {e}")
        return []


def match_ledger(ledger_shortcut, ledger_configs):
    """
    Match ledger shortcut to ledger config using multiple strategies.
    This replicates the improved matching logic from the .gs file.
    """
    if not ledger_shortcut:
        return None, None
    
    shortcut_lower = ledger_shortcut.lower().strip()
    
    for config in ledger_configs:
        config_name = config['ledger_name'].lower().strip()
        config_url = config['ledger_url'].lower()
        
        # Strategy 1: Exact match of ledger name
        if config_name == shortcut_lower:
            return config, 'exact_name'
        
        # Strategy 2: URL contains the shortcut
        if shortcut_lower in config_url:
            return config, 'url_contains'
        
        # Strategy 3: Remove spaces/dashes and match
        config_name_normalized = re.sub(r'[\s\-_]', '', config_name)
        shortcut_normalized = re.sub(r'[\s\-_]', '', shortcut_lower)
        if config_name_normalized == shortcut_normalized:
            return config, 'normalized'
        
        # Strategy 4: Extract number from AGL format and match
        agl_number_match = re.search(r'agl\s*(\d+)', shortcut_lower, re.IGNORECASE)
        if agl_number_match:
            number = agl_number_match.group(1)
            config_number_match = re.search(r'agl\s*(\d+)', config_name, re.IGNORECASE)
            if config_number_match and config_number_match.group(1) == number:
                return config, 'agl_number'
        
        # Strategy 5: Extract ledger identifier from URL (e.g., "https://agroverse.shop/agl10" -> "agl10")
        # and match to ledger name (e.g., "AGL10")
        url_match = re.search(r'/(agl\d+|sef\d+|pp\d+)', shortcut_lower, re.IGNORECASE)
        if url_match:
            url_ledger_id = url_match.group(1).lower()
            config_ledger_match = re.search(r'(agl\d+|sef\d+|pp\d+)', config_name, re.IGNORECASE)
            if config_ledger_match and config_ledger_match.group(1).lower() == url_ledger_id:
                return config, 'url_identifier_extraction'
    
    return None, None


def main():
    """Main verification function"""
    qr_code = sys.argv[1] if len(sys.argv) > 1 else '2025CAPELAVELHA_20250809_7'
    
    print("=" * 80)
    print("Ledger Matching Verification")
    print("=" * 80)
    print()
    
    # Setup Google Sheets API
    print("Setting up Google Sheets API...")
    service = setup_google_sheets()
    if not service:
        sys.exit(1)
    print("✓ Connected to Google Sheets")
    print()
    
    # Look up QR code
    print(f"Looking up QR code: {qr_code}")
    qr_info = lookup_qr_code(service, qr_code)
    if not qr_info:
        print(f"✗ QR code '{qr_code}' not found in Agroverse QR codes sheet")
        sys.exit(1)
    
    print(f"✓ Found QR code in row {qr_info['row']}")
    print(f"  Currency: {qr_info['currency']}")
    print(f"  Ledger Shortcut: {qr_info['ledger_shortcut']}")
    print()
    
    # Get ledger configs
    print("Fetching ledger configurations from Shipment Ledger Listing...")
    ledger_configs = get_ledger_configs(service)
    print(f"✓ Found {len(ledger_configs)} ledger configurations")
    print()
    
    # Show available ledgers
    print("Available ledgers in Shipment Ledger Listing:")
    for config in sorted(ledger_configs, key=lambda x: x['ledger_name']):
        print(f"  - {config['ledger_name']}")
    print()
    
    # Test matching
    print(f"Testing matching for ledger shortcut: '{qr_info['ledger_shortcut']}'")
    matched_config, strategy = match_ledger(qr_info['ledger_shortcut'], ledger_configs)
    
    if matched_config:
        print(f"✓ MATCH FOUND using strategy: {strategy}")
        print(f"  Ledger Name: {matched_config['ledger_name']}")
        print(f"  Ledger URL: {matched_config['ledger_url']}")
        print()
        print("✓ Verification PASSED - The matching logic should work correctly")
        return 0
    else:
        print(f"✗ NO MATCH FOUND")
        print()
        print("✗ Verification FAILED - The ledger shortcut could not be matched")
        print()
        print("This means the transaction would fall back to 'offchain'.")
        print("Possible reasons:")
        print("  1. The ledger name in Shipment Ledger Listing doesn't match the shortcut")
        print("  2. The ledger URL doesn't contain the shortcut")
        print("  3. The shortcut format is different than expected")
        return 1


if __name__ == '__main__':
    sys.exit(main())

