#!/usr/bin/env python3
"""
TrueSight DAO Schema Validation Script

This script validates the accuracy of SCHEMA.md by testing:
- Google Sheets accessibility and structure
- Wix data collections and items
- Column headers and data types

Usage:
    python python_scripts/schema_validation/test_schema_validation.py

Requirements:
    pip install -r ../requirements.txt
"""

import json
import os
import sys
from typing import Dict, List, Optional, Tuple
import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google.oauth2 import service_account
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Google Sheets API configuration
SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
SPREADSHEET_SERVICE = None

# Wix API configuration
WIX_ACCESS_TOKEN = os.getenv('WIX_ACCESS_TOKEN')
WIX_ACCOUNT_ID = '0e2cde5f-b353-468b-9f4e-36835fc60a0e'
WIX_SITE_ID = 'd45a189f-d0cc-48de-95ee-30635a95385f'
WIX_BASE_URL = 'https://www.wixapis.com/wix-data/v2'

# Test results tracking
test_results = {
    'passed': 0,
    'failed': 0,
    'errors': []
}

# Store discovered column headers
discovered_headers = {}

def log_test(test_name: str, passed: bool, message: str = ""):
    """Log test results"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} {test_name}")
    if message:
        print(f"    {message}")
    
    if passed:
        test_results['passed'] += 1
    else:
        test_results['failed'] += 1
        test_results['errors'].append(f"{test_name}: {message}")

def setup_google_sheets():
    """Initialize Google Sheets API service"""
    global SPREADSHEET_SERVICE
    
    try:
        creds_path = os.path.join(os.path.dirname(__file__), 'gdrive_schema_credentials.json')
        
        if not os.path.exists(creds_path):
            log_test("Google Sheets API Setup", False, f"Credentials file not found: {creds_path}")
            return False
        
        # Use service account authentication
        creds = service_account.Credentials.from_service_account_file(
            creds_path, scopes=SCOPES)
        
        SPREADSHEET_SERVICE = build('sheets', 'v4', credentials=creds)
        print("✅ Google Sheets API initialized with service account")
        return True
        
    except Exception as e:
        log_test("Google Sheets API Setup", False, f"Failed to initialize: {str(e)}")
        return False

def get_first_rows(spreadsheet_id: str, sheet_name: str, num_rows: int = 5) -> List[List[str]]:
    """Get the first N rows from a sheet to identify header row"""
    try:
        if not SPREADSHEET_SERVICE:
            return []
        
        range_name = f"{sheet_name}!1:{num_rows}"
        result = SPREADSHEET_SERVICE.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        return values
    except Exception as e:
        print(f"    Error getting first rows: {str(e)}")
        return []

def get_all_column_headers(spreadsheet_id: str, sheet_name: str) -> List[str]:
    """Get all column headers from a sheet"""
    try:
        if not SPREADSHEET_SERVICE:
            return []
        
        range_name = f"{sheet_name}!1:1"
        result = SPREADSHEET_SERVICE.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values:
            return []
        
        return values[0]
    except Exception as e:
        print(f"    Error getting headers: {str(e)}")
        return []

def test_spreadsheet_access(spreadsheet_id: str, description: str) -> bool:
    """Test if a spreadsheet is accessible"""
    try:
        if not SPREADSHEET_SERVICE:
            log_test(f"Spreadsheet Access: {description}", False, "Google Sheets service not initialized")
            return False
        
        # Try to get spreadsheet metadata
        spreadsheet = SPREADSHEET_SERVICE.spreadsheets().get(
            spreadsheetId=spreadsheet_id
        ).execute()
        
        title = spreadsheet.get('properties', {}).get('title', 'Unknown')
        log_test(f"Spreadsheet Access: {description}", True, f"Title: {title}")
        return True
        
    except HttpError as e:
        log_test(f"Spreadsheet Access: {description}", False, f"HTTP Error: {e}")
        return False
    except Exception as e:
        log_test(f"Spreadsheet Access: {description}", False, f"Error: {str(e)}")
        return False

def test_sheet_exists(spreadsheet_id: str, sheet_name: str, description: str) -> bool:
    """Test if a specific sheet exists in a spreadsheet"""
    try:
        if not SPREADSHEET_SERVICE:
            log_test(f"Sheet Exists: {description}", False, "Google Sheets service not initialized")
            return False
        
        spreadsheet = SPREADSHEET_SERVICE.spreadsheets().get(
            spreadsheetId=spreadsheet_id
        ).execute()
        
        sheets = spreadsheet.get('sheets', [])
        sheet_names = [sheet['properties']['title'] for sheet in sheets]
        
        # Find the matching sheet and get its gid
        sheet_gid = None
        for sheet in sheets:
            if sheet['properties']['title'] == sheet_name:
                sheet_gid = sheet['properties']['sheetId']
                break
        
        if sheet_name in sheet_names:
            # Get first rows to help identify header row
            first_rows = get_first_rows(spreadsheet_id, sheet_name, 5)
            headers = get_all_column_headers(spreadsheet_id, sheet_name)
            key = f"{spreadsheet_id}|{sheet_name}"
            discovered_headers[key] = {
                'headers': headers,
                'first_rows': first_rows,
                'description': description,
                'gid': sheet_gid,
                'url': f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit#gid={sheet_gid}"
            }
            
            log_test(f"Sheet Exists: {description}", True, f"Found sheet '{sheet_name}' (gid={sheet_gid}) with {len(headers)} columns")
            return True
        else:
            log_test(f"Sheet Exists: {description}", False, 
                    f"Sheet '{sheet_name}' not found. Available sheets: {sheet_names}")
            return False
            
    except Exception as e:
        log_test(f"Sheet Exists: {description}", False, f"Error: {str(e)}")
        return False

def test_column_headers(spreadsheet_id: str, sheet_name: str, expected_columns: List[str], description: str) -> bool:
    """Test if a sheet has the expected column headers"""
    try:
        if not SPREADSHEET_SERVICE:
            log_test(f"Column Headers: {description}", False, "Google Sheets service not initialized")
            return False
        
        # Get the first row (headers)
        range_name = f"{sheet_name}!1:1"
        result = SPREADSHEET_SERVICE.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values:
            log_test(f"Column Headers: {description}", False, "No data found in first row")
            return False
        
        actual_headers = values[0]
        
        # Check if all expected columns are present
        missing_columns = []
        for expected_col in expected_columns:
            if expected_col not in actual_headers:
                missing_columns.append(expected_col)
        
        if missing_columns:
            log_test(f"Column Headers: {description}", False, 
                    f"Missing columns: {missing_columns}. Found: {actual_headers}")
            return False
        else:
            log_test(f"Column Headers: {description}", True, 
                    f"All expected columns found: {expected_columns}")
            return True
            
    except Exception as e:
        log_test(f"Column Headers: {description}", False, f"Error: {str(e)}")
        return False

def test_wix_collection(collection_name: str) -> bool:
    """Test if a Wix collection is accessible"""
    try:
        if not WIX_ACCESS_TOKEN:
            log_test(f"Wix Collection: {collection_name}", False, "WIX_ACCESS_TOKEN not set")
            return False
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': WIX_ACCESS_TOKEN,
            'wix-account-id': WIX_ACCOUNT_ID,
            'wix-site-id': WIX_SITE_ID
        }
        
        url = f"{WIX_BASE_URL}/items/query?dataCollectionId={collection_name}"
        response = requests.post(url, headers=headers, json={})
        
        if response.status_code == 200:
            data = response.json()
            item_count = len(data.get('dataItems', []))
            log_test(f"Wix Collection: {collection_name}", True, f"Found {item_count} items")
            return True
        else:
            log_test(f"Wix Collection: {collection_name}", False, 
                    f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test(f"Wix Collection: {collection_name}", False, f"Error: {str(e)}")
        return False

def test_wix_data_item(collection_id: str, data_item_id: str, expected_description: str, expected_currency: str) -> bool:
    """Test if a specific Wix data item exists and has expected values"""
    try:
        if not WIX_ACCESS_TOKEN:
            log_test(f"Wix Data Item: {data_item_id}", False, "WIX_ACCESS_TOKEN not set")
            return False
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': WIX_ACCESS_TOKEN,
            'wix-account-id': WIX_ACCOUNT_ID,
            'wix-site-id': WIX_SITE_ID
        }
        
        url = f"{WIX_BASE_URL}/items/{data_item_id}?dataCollectionId={collection_id}"
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            item_data = data.get('dataItem', {}).get('data', {})
            
            description = item_data.get('description', '')
            currency = item_data.get('currency', '')
            
            if description == expected_description and currency == expected_currency:
                log_test(f"Wix Data Item: {data_item_id}", True, 
                        f"Description: {description}, Currency: {currency}")
                return True
            else:
                log_test(f"Wix Data Item: {data_item_id}", False, 
                        f"Expected description='{expected_description}', currency='{expected_currency}'. "
                        f"Found description='{description}', currency='{currency}'")
                return False
        else:
            log_test(f"Wix Data Item: {data_item_id}", False, 
                    f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test(f"Wix Data Item: {data_item_id}", False, f"Error: {str(e)}")
        return False

def run_schema_validation_tests():
    """Run all schema validation tests"""
    print("🧪 TrueSight DAO Schema Validation Tests")
    print("=" * 50)
    
    # Setup Google Sheets API
    if not setup_google_sheets():
        print("❌ Cannot proceed without Google Sheets API access")
        return
    
    print("\n📊 Testing Google Sheets...")
    
    # Test main spreadsheets
    main_spreadsheets = [
        ('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ', 'Telegram & Submissions'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'Main Ledger & Contributors')
    ]
    
    for spreadsheet_id, description in main_spreadsheets:
        test_spreadsheet_access(spreadsheet_id, description)
    
    # Test specific sheets
    sheets_to_test = [
        ('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ', 'Telegram Chat Logs', 'Telegram Logs'),
        ('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ', 'Scored Expense Submissions', 'Scored Expenses'),
        ('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ', 'QR Code Sales', 'QR Code Sales'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'offchain transactions', 'Offchain Transactions'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'Contributors contact information', 'Contributors Contact'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'Contributors Digital Signatures', 'Digital Signatures'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'Agroverse QR codes', 'QR Codes'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'Ledger history', 'Ledger History'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'off chain asset balance', 'Asset Balance'),
        ('1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU', 'Contributors voting weight', 'Voting Weight')
    ]
    
    for spreadsheet_id, sheet_name, description in sheets_to_test:
        test_sheet_exists(spreadsheet_id, sheet_name, description)
    
    print("\n🔄 Testing Wix Collections...")
    
    # Test Wix collections (skip if WIX_ACCESS_TOKEN not set)
    if WIX_ACCESS_TOKEN:
        wix_collections = ['AgroverseShipments', 'ExchangeRate', 'Statistics']
        for collection in wix_collections:
            test_wix_collection(collection)
        
        # Test specific ExchangeRate data items
        exchange_rate_items = [
            ('ExchangeRate', 'a0e7364c-716d-49f3-a795-647d2686a22b', 'USD_TREASURY_BALANCE', 'USD'),
            ('ExchangeRate', '4088e994-2c06-42a8-a1cf-8cd77ee73203', 'TDG_ISSUED', 'TDG'),
            ('ExchangeRate', '9b04879b-f06a-419a-9ad3-520ad60ea972', 'ASSET_PER_TDG_ISSUED', 'USD'),
            ('ExchangeRate', '956fdb46-bc8d-4c71-8e67-79813effbab3', '30_DAYS_SALES', 'USD'),
            ('ExchangeRate', '8edde502-ac79-4e66-ab2d-8ebb99108665', 'TDG_USDC_PRICE', 'USDC')
        ]
        
        for collection_id, data_item_id, expected_description, expected_currency in exchange_rate_items:
            test_wix_data_item(collection_id, data_item_id, expected_description, expected_currency)
    else:
        print("⚠️  WIX_ACCESS_TOKEN not set, skipping Wix tests")
    
    # Print summary
    print("\n" + "=" * 50)
    print("📊 Test Summary")
    print(f"✅ Passed: {test_results['passed']}")
    print(f"❌ Failed: {test_results['failed']}")
    
    if test_results['errors']:
        print("\n❌ Errors:")
        for error in test_results['errors']:
            print(f"  - {error}")
    
    if test_results['passed'] + test_results['failed'] > 0:
        success_rate = (test_results['passed'] / (test_results['passed'] + test_results['failed'])) * 100
        print(f"\n🎯 Success Rate: {success_rate:.1f}%")
    
    if test_results['failed'] == 0:
        print("🎉 All tests passed! SCHEMA.md is accurate.")
    else:
        print("⚠️  Some tests failed. Please update SCHEMA.md accordingly.")
    
    # Print discovered column headers
    print("\n" + "=" * 80)
    print("📋 DISCOVERED SHEET STRUCTURES")
    print("=" * 80)
    
    for key, data in discovered_headers.items():
        spreadsheet_id, sheet_name = key.split('|')
        description = data.get('description', sheet_name)
        headers = data.get('headers', [])
        first_rows = data.get('first_rows', [])
        gid = data.get('gid', 'unknown')
        url = data.get('url', f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit")
        
        print(f"\n{'─' * 80}")
        print(f"📄 {description}: {sheet_name}")
        print(f"   Spreadsheet ID: {spreadsheet_id}")
        print(f"   Sheet GID: {gid}")
        print(f"   Direct URL: {url}")
        print(f"   Total Columns: {len(headers)}")
        print(f"\n   First 5 Rows:")
        
        for i, row in enumerate(first_rows, 1):
            # Truncate long values for display
            display_row = [str(val)[:30] + '...' if len(str(val)) > 30 else str(val) for val in row]
            print(f"   Row {i}: {display_row}")
        
        print(f"\n   Full Header Row 1:")
        for i, col in enumerate(headers, 1):
            print(f"      [{i}] {col}")
    
    print("\n" + "=" * 80)
    
    # Save to JSON file for programmatic access
    output_file = os.path.join(os.path.dirname(__file__), 'discovered_headers.json')
    with open(output_file, 'w') as f:
        json.dump(discovered_headers, f, indent=2)
    print(f"\n💾 Full data saved to: {output_file}")

if __name__ == "__main__":
    run_schema_validation_tests()

