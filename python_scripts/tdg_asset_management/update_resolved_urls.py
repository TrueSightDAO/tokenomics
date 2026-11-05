#!/usr/bin/env python3
"""
Script to update column AB in "Shipment Ledger Listing" with resolved URLs
from legacy-redirects.js.

This script:
1. Parses legacy-redirects.js to get URL mappings
2. Reads "Shipment Ledger Listing" sheet
3. Matches shipment IDs and updates column AB with resolved URLs
"""

import re
import json
from pathlib import Path
import gspread
from google.oauth2.service_account import Credentials

# Configuration
SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
SHEET_NAME = 'Shipment Ledger Listing'
SHIPMENT_ID_COL = 1  # Column A (1-indexed)
RESOLVED_URL_COL = 28  # Column AB (1-indexed = 28)

# Path to legacy-redirects.js
LEGACY_REDIRECTS_FILE = Path('/Users/garyjob/Applications/agroverse_shop/js/legacy-redirects.js')

def parse_legacy_redirects():
    """Parse legacy-redirects.js file and extract the LEGACY_REDIRECTS mapping."""
    redirects = {}
    
    if not LEGACY_REDIRECTS_FILE.exists():
        print(f"Error: {LEGACY_REDIRECTS_FILE} not found")
        return redirects
    
    with open(LEGACY_REDIRECTS_FILE, 'r') as f:
        content = f.read()
    
    # Extract AGL redirects: '/agl1': 'https://...'
    pattern = r"['\"]/(agl\d+)['\"]:\s*['\"]([^'\"]+)['\"]"
    matches = re.findall(pattern, content)
    
    for path, url in matches:
        # Convert path to shipment ID (e.g., 'agl6' -> 'AGL6')
        shipment_id = path.upper()
        redirects[shipment_id] = url
    
    return redirects

def shipment_id_to_path(shipment_id):
    """Convert shipment ID (e.g., 'AGL6') to redirect path (e.g., '/agl6')."""
    if not shipment_id:
        return None
    shipment_id = str(shipment_id).strip().upper()
    if shipment_id.startswith('AGL'):
        return '/' + shipment_id.lower()
    return None

def get_google_sheets_client():
    """Get authenticated Google Sheets client."""
    # Try to find credentials file (checking common locations from other scripts)
    creds_paths = [
        Path(__file__).parent.parent / 'python_scripts' / 'schema_validation' / 'gdrive_schema_credentials.json',
        Path(__file__).parent.parent / 'python_scripts' / 'agroverse_qr_code_generator' / 'gdrive_schema_credentials.json',
        Path.home() / '.config' / 'gspread' / 'service_account.json',
        Path('/Users/garyjob/.config/gspread/service_account.json'),
    ]
    
    creds_file = None
    for path in creds_paths:
        if path.exists():
            creds_file = path
            break
    
    if not creds_file:
        print("Error: Could not find Google Sheets service account credentials")
        print("Please place service_account.json in one of these locations:")
        for path in creds_paths:
            print(f"  - {path}")
        return None
    
    try:
        scope = ['https://spreadsheets.google.com/feeds',
                 'https://www.googleapis.com/auth/drive']
        creds = Credentials.from_service_account_file(str(creds_file), scopes=scope)
        client = gspread.authorize(creds)
        print(f"✅ Using credentials from: {creds_file}")
        return client
    except Exception as e:
        print(f"Error authenticating with Google Sheets: {e}")
        return None

def update_resolved_urls():
    """Update column AB with resolved URLs."""
    print("=" * 80)
    print("Updating Resolved URLs in Shipment Ledger Listing")
    print("=" * 80)
    print()
    
    # Parse redirects
    print("📖 Parsing legacy-redirects.js...")
    redirects = parse_legacy_redirects()
    print(f"✅ Found {len(redirects)} AGL redirect mappings")
    print()
    
    # Get Google Sheets client
    print("🔐 Authenticating with Google Sheets...")
    client = get_google_sheets_client()
    if not client:
        return
    
    try:
        # Open spreadsheet
        print(f"📊 Opening spreadsheet {SPREADSHEET_ID}...")
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        sheet = spreadsheet.worksheet(SHEET_NAME)
        print(f"✅ Opened sheet: {SHEET_NAME}")
        print()
        
        # Get all data
        print("📖 Reading data from sheet...")
        all_values = sheet.get_all_values()
        
        if len(all_values) < 2:
            print("⚠️  No data rows found in sheet")
            return
        
        # Find header row
        header_row = 0
        shipment_id_header = None
        for i, row in enumerate(all_values):
            if row and row[0] and 'Shipment ID' in str(row[0]):
                header_row = i
                shipment_id_header = row[0]
                break
        
        if header_row == 0 and not shipment_id_header:
            print("⚠️  Could not find header row, assuming row 1 is header")
            header_row = 0
        
        print(f"✅ Found header at row {header_row + 1}")
        print()
        
        # Prepare updates
        updates = []
        updated_count = 0
        not_found_count = 0
        
        print("🔄 Processing rows...")
        for i, row in enumerate(all_values[header_row + 1:], start=header_row + 2):
            if not row or len(row) < SHIPMENT_ID_COL:
                continue
            
            shipment_id = row[SHIPMENT_ID_COL - 1].strip() if len(row) > SHIPMENT_ID_COL - 1 else ''
            
            if not shipment_id or shipment_id.upper() == '0':
                continue
            
            # Get resolved URL
            resolved_url = redirects.get(shipment_id.upper())
            
            if resolved_url:
                # Column AB is index 28 (1-indexed)
                cell_address = f'AB{i}'
                updates.append({
                    'range': cell_address,
                    'values': [[resolved_url]]
                })
                print(f"  ✅ Row {i} ({shipment_id}): {resolved_url[:60]}...")
                updated_count += 1
            else:
                print(f"  ⚠️  Row {i} ({shipment_id}): No redirect found")
                not_found_count += 1
        
        print()
        print(f"📊 Summary: {updated_count} to update, {not_found_count} not found")
        print()
        
        if updates:
            print("💾 Updating sheet...")
            # Batch update (Google Sheets API allows up to 1000 updates per batch)
            batch_size = 100
            for i in range(0, len(updates), batch_size):
                batch = updates[i:i + batch_size]
                sheet.batch_update(batch)
                print(f"  ✅ Updated batch {i // batch_size + 1} ({len(batch)} cells)")
            
            print()
            print("✅ Successfully updated column AB with resolved URLs!")
        else:
            print("⚠️  No updates to make")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    update_resolved_urls()

