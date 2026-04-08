#!/usr/bin/env python3
"""
Schema Change Analysis Script

Compares the documented schema in SCHEMA.md with actual Google Sheets structure
and outputs a detailed analysis of structural changes.
"""

import json
import os
import sys
from typing import Dict, List, Optional, Tuple
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Google Sheets API configuration
SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
SPREADSHEET_SERVICE = None

# Schema definitions from SCHEMA.md
SCHEMA_DEFINITIONS = {
    '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ': {
        'Telegram Chat Logs': {
            'header_row': 2,
            'columns': [
                ('A', 'Telegram Update ID', 'Number'),
                ('B', 'Telegram Chatroom ID', 'Number'),
                ('C', 'Telegram Chatroom Name', 'String'),
                ('D', 'Telegram Message ID', 'Number'),
                ('E', 'Contributor Name', 'String'),
                ('F', 'Project Name', 'String'),
                ('G', 'Contribution Made', 'String'),
                ('H', 'Rubric classification', 'String'),
                ('I', 'TDGs Provisioned', 'Number'),
                ('J', 'Status', 'String'),
                ('K', 'TDGs Issued (reviewed by Governor)', 'String'),
                ('L', 'Status date', 'Date'),
                ('M', 'Main Ledger Line Number', 'Number'),
                ('N', 'Scoring Hash Key', 'String'),
                ('O', 'Telegram File IDs', 'String'),
                ('P', 'Edgar Signature Verification', 'String'),
                ('Q', 'External API call status', 'String'),
                ('R', 'External API call response', 'String'),
            ]
        },
        'Scored Expense Submissions': {
            'header_row': 1,
            'columns': [
                ('A', 'Telegram Update ID', 'Number'),
                ('B', 'Telegram Chatroom ID', 'Number'),
                ('C', 'Telegram Chatroom Name', 'String'),
                ('D', 'Telegram Message ID', 'Number'),
                ('E', 'Reporter Name', 'String'),
                ('F', 'Expense Reported', 'String'),
                ('G', 'Status date', 'Date'),
                ('H', 'Contributor Name', 'String'),
                ('I', 'Currency ', 'String'),
                ('J', 'Amount', 'Number'),
                ('K', 'Scoring Hash Key', 'String'),
                ('L', 'Ledger Lines Number', 'String'),
            ]
        },
        'Capital Injection': {
            'header_row': 1,
            'columns': [
                ('A', 'Telegram Update ID', 'Number'),
                ('B', 'Telegram Message ID', 'Number'),
                ('C', 'Capital Injection Log Message', 'String'),
                ('D', 'Reporter Name', 'String'),
                ('E', 'Ledger Name', 'String'),
                ('F', 'Amount', 'Number'),
                ('G', 'Ledger URL', 'String'),
                ('H', 'Injection Date', 'Date'),
                ('I', 'Description', 'String'),
                ('J', 'Status', 'String'),
                ('K', 'Ledger Lines Number', 'String'),
            ]
        },
        'QR Code Sales': {
            'header_row': 1,
            'columns': [
                ('A', 'Telegram Update ID', 'Number'),
                ('B', 'Telegram Message ID', 'Number'),
                ('C', 'Sales Report Log Message', 'String'),
                ('D', 'Reporter Name', 'String'),
                ('E', 'QR Code value', 'String'),
                ('F', 'Sale Price', 'Number'),
                ('G', 'AGL Ledger URL', 'String'),
                ('H', 'Sales Date', 'Date'),
                ('I', 'Currency', 'String'),
                ('J', 'Status', 'String'),
                ('K', 'Ledger Lines Number', 'String'),
            ]
        },
        'Inventory Movement': {
            'header_row': 1,
            'columns': [
                ('A', 'Telegram Update ID', 'Number'),
                ('B', 'Telegram Chatroom ID', 'Number'),
                ('C', 'Telegram Chatroom Name', 'String'),
                ('D', 'Telegram Message ID', 'Number'),
                ('E', 'Contributor Name', 'String'),
                ('F', 'Contribution Made', 'String'),
                ('G', 'Status Date', 'Date'),
                ('H', 'Sender Name', 'String'),
                ('I', 'Recipient Name', 'String'),
                ('J', 'Currency', 'String'),
                ('K', 'Amount', 'Number'),
                ('L', 'Ledger Name', 'String'),
                ('M', 'Ledger URL', 'String'),
                ('N', 'Status', 'String'),
                ('O', 'Row Numbers', 'String'),
            ]
        },
        'QR Code Generation Requests': {
            'header_row': 1,
            'columns': [
                ('A', 'Telegram Update ID', 'Number'),
                ('B', 'Chat ID', 'Number'),
                ('C', 'Contributor Name', 'String'),
                ('D', 'Currency Name', 'String'),
                ('E', 'Quantity', 'Number'),
                ('F', 'Status', 'String'),
                ('G', 'Batch ID', 'String'),
                ('H', 'ZIP File URL', 'String'),
            ]
        },
    },
    '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU': {
        'offchain transactions': {
            'header_row': 4,
            'columns': [
                ('A', 'Transaction Date', 'Date'),
                ('B', 'Description', 'String'),
                ('C', 'Fund Handler', 'String'),
                ('D', 'Amount', 'Number'),
                ('E', 'Currency', 'String'),
                ('F', 'Ledger Line', 'Number'),
                ('G', 'Is Revenue', 'String'),
            ]
        },
        'offchain asset location': {
            'header_row': 1,
            'columns': [
                ('A', 'Asset Name', 'String'),
                ('B', 'Manager Names', 'String'),
                ('C', 'Asset Quantity', 'Number'),
            ]
        },
        'Contributors contact information': {
            'header_row': 4,
            'columns': [
                ('A', 'Name', 'String'),
                ('B', 'TRUESIGHT Wallet Address (Solana)', 'String'),
                ('C', 'Ethereum Wallet Address', 'String'),
                ('D', 'Email', 'String'),
                ('E', 'Address', 'String'),
                ('F', 'Phone / WhatsApp', 'String'),
                ('G', 'Discord ID', 'String'),
                ('H', 'Telegram ID', 'String'),
                ('I', 'Twitter', 'String'),
                ('J', 'Projects ', 'String'),
                ('K', 'LinkedIn', 'String'),
                ('L', 'Facebook', 'String'),
                ('M', 'Github', 'String'),
                ('N', 'Instagram', 'String'),
                ('O', 'Website', 'String'),
                ('P', 'Taxation ID', 'String'),
                ('Q', 'WhatsApp Chat Log ID', 'String'),
                ('R', 'Digital Signature', 'String'),
            ]
        },
        'Contributors Digital Signatures': {
            'header_row': 1,
            'columns': [
                ('A', 'Contributor Name', 'String'),
                ('B', 'Created Time Stamp', 'String'),
                ('C', 'Last Active Time Stamp', 'String'),
                ('D', 'Status', 'String'),
                ('E', 'Digital Signature', 'String'),
                ('F', 'Contributor Email Address', 'String'),
            ]
        },
        'Contributors voting weight': {
            'header_row': 4,
            'columns': [
                ('A', 'Ownership Rank - Controlled', 'Number'),
                ('B', 'Voting Weightage Rank', 'Number'),
                ('C', 'Contributors', 'String'),
                ('D', 'Solana Wallet Address', 'String'),
                ('E', 'Quadratic Voting Power', 'String'),
                ('F', 'Total TDG in registered wallet', 'String'),
                ('G', 'Total TDG unissued', 'Number'),
                ('H', 'Total TDG controlled (legacy)', 'Number'),
                ('I', 'Total TDG controlled', 'Number'),
                ('J', 'Total Percentage Controlled', 'String'),
                ('K', 'Total Voting Power', 'String'),
                ('L', 'Ranking', 'Number'),
                ('M', 'Quadratic Votes', 'Number'),
                ('N', 'Sold', 'Number'),
            ]
        },
        'Ledger history': {
            'header_row': 4,
            'columns': [
                ('A', 'Contributor Name', 'String'),
                ('B', 'Project Name', 'String'),
                ('C', 'Contribution Made', 'String'),
                ('D', 'Rubric classification', 'String'),
                ('E', 'TDGs Provisioned', 'Number'),
                ('F', 'Status', 'String'),
                ('G', 'TDGs Issued', 'Number'),
                ('H', 'Status date', 'Date'),
                ('I', 'Solana Transfer Hash', 'String'),
                ('J', 'TDGs yet Air Dropped', 'Number'),
                ('K', 'Discord ID', 'String'),
                ('L', 'Within past 90 days', 'String'),
                ('M', 'Within past 90 days vesting', 'String'),
                ('N', 'Within past 180 days', 'String'),
                ('O', 'Within past 180 days vesting', 'Number'),
            ]
        },
        'off chain asset balance': {
            'header_row': 4,
            'columns': [
                ('A', 'Asset Type', 'String'),
                ('B', 'Balance', 'Number'),
                ('C', 'Unit Value', 'Number'),
                ('D', 'Value (USD)', 'Number'),
            ]
        },
        'Agroverse QR codes': {
            'header_row': 1,
            'columns': [
                ('A', 'qr_code', 'String'),
                ('B', 'landing_page', 'String'),
                ('C', 'ledger', 'String'),
                ('D', 'status', 'String'),
                ('E', 'farm name', 'String'),
                ('F', 'state', 'String'),
                ('G', 'country', 'String'),
                ('H', 'Year', 'String'),
                ('I', 'Currency', 'String'),
                ('J', 'QR code creation date (YYYYMMDD)', 'String'),
                ('K', 'QR code location', 'String'),
                ('L', 'Owner Email', 'String'),
                ('M', 'Onboarding Email Sent Date', 'String'),
                ('N', 'Tree Planting Date (YYYYMMDD)', 'String'),
                ('O', 'Latitude', 'String'),
                ('P', 'Longitude', 'String'),
                ('Q', 'Planting Video URL', 'String'),
                ('R', 'Tree Seedling Photo URL', 'String'),
                ('S', 'Product Image', 'String'),
                ('T', 'Price', 'Number'),
                ('U', 'Manager Name', 'String'),
            ]
        },
    },
    '1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo': {
        'Scored Chatlogs': {
            'header_row': 3,
            'columns': [
                ('A', 'Contributor Name', 'String'),
                ('B', 'Project Name', 'String'),
                ('C', 'Contribution Made', 'String'),
                ('D', 'Rubric classification', 'String'),
                ('E', 'TDGs Provisioned', 'Number'),
                ('F', 'Status', 'String'),
                ('G', 'TDGs Issued', 'Number'),
                ('H', 'Status date', 'Date'),
                ('I', 'Existing Contributor', 'Boolean'),
                ('J', 'Reporter Name', 'String'),
                ('K', 'Scoring Hash Key', 'String'),
                ('L', 'Main Ledger Row Number', 'Number'),
                ('M', 'Reviewer Email', 'String'),
            ]
        },
    },
}

def setup_google_sheets():
    """Initialize Google Sheets API service"""
    global SPREADSHEET_SERVICE
    
    try:
        creds_path = os.path.join(os.path.dirname(__file__), 'gdrive_schema_credentials.json')
        
        if not os.path.exists(creds_path):
            print(f"❌ Credentials file not found: {creds_path}")
            return False
        
        creds = service_account.Credentials.from_service_account_file(
            creds_path, scopes=SCOPES)
        
        SPREADSHEET_SERVICE = build('sheets', 'v4', credentials=creds)
        print("✅ Google Sheets API initialized")
        return True
        
    except Exception as e:
        print(f"❌ Failed to initialize Google Sheets API: {str(e)}")
        return False

def get_header_row(spreadsheet_id: str, sheet_name: str, header_row_num: int) -> List[str]:
    """Get the header row from a specific row number"""
    try:
        if not SPREADSHEET_SERVICE:
            return []
        
        range_name = f"{sheet_name}!{header_row_num}:{header_row_num}"
        result = SPREADSHEET_SERVICE.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        if not values:
            return []
        
        return values[0] if values else []
    except Exception as e:
        print(f"    ⚠️  Error getting header row {header_row_num}: {str(e)}")
        return []

def column_index_to_letter(index: int) -> str:
    """Convert 0-based column index to letter (A, B, C, ...)"""
    result = ""
    while index >= 0:
        result = chr(65 + (index % 26)) + result
        index = index // 26 - 1
    return result

def analyze_sheet_changes(spreadsheet_id: str, sheet_name: str, schema_def: Dict) -> Dict:
    """Analyze changes between documented schema and actual sheet"""
    changes = {
        'sheet_name': sheet_name,
        'spreadsheet_id': spreadsheet_id,
        'header_row': schema_def['header_row'],
        'documented_columns': len(schema_def['columns']),
        'actual_columns': 0,
        'missing_columns': [],
        'extra_columns': [],
        'column_name_changes': [],
        'column_order_changes': [],
        'status': 'unknown'
    }
    
    # Get actual header row
    actual_headers = get_header_row(spreadsheet_id, sheet_name, schema_def['header_row'])
    
    if not actual_headers:
        changes['status'] = 'error'
        changes['error'] = 'Could not read header row'
        return changes
    
    changes['actual_columns'] = len(actual_headers)
    changes['actual_headers'] = actual_headers
    
    # Build maps for comparison
    documented_col_map = {col[1]: (col[0], col[2]) for col in schema_def['columns']}
    actual_col_map = {header: idx for idx, header in enumerate(actual_headers) if header}
    
    # Find missing columns (in schema but not in actual)
    for doc_name, (doc_col, doc_type) in documented_col_map.items():
        if doc_name not in actual_col_map:
            changes['missing_columns'].append({
                'column': doc_col,
                'name': doc_name,
                'type': doc_type
            })
    
    # Find extra columns (in actual but not in schema)
    for actual_name, actual_idx in actual_col_map.items():
        if actual_name not in documented_col_map:
            actual_col_letter = column_index_to_letter(actual_idx)
            changes['extra_columns'].append({
                'column': actual_col_letter,
                'name': actual_name,
                'index': actual_idx
            })
    
    # Find column name changes (similar names but different)
    for doc_name, (doc_col, doc_type) in documented_col_map.items():
        # Check for similar names (fuzzy matching)
        for actual_name, actual_idx in actual_col_map.items():
            if doc_name.lower().strip() == actual_name.lower().strip():
                if doc_name != actual_name:
                    actual_col_letter = column_index_to_letter(actual_idx)
                    changes['column_name_changes'].append({
                        'column': doc_col,
                        'documented_name': doc_name,
                        'actual_name': actual_name,
                        'type': doc_type
                    })
                break
    
    # Check column order
    for idx, (doc_col, doc_name, doc_type) in enumerate(schema_def['columns']):
        if doc_name in actual_col_map:
            actual_idx = actual_col_map[doc_name]
            if actual_idx != idx:
                changes['column_order_changes'].append({
                    'column': doc_col,
                    'name': doc_name,
                    'documented_position': idx,
                    'actual_position': actual_idx
                })
    
    # Determine status
    if changes['missing_columns'] or changes['extra_columns'] or changes['column_name_changes']:
        changes['status'] = 'changed'
    elif changes['column_order_changes']:
        changes['status'] = 'reordered'
    else:
        changes['status'] = 'match'
    
    return changes

def print_analysis_report(all_changes: List[Dict]):
    """Print a comprehensive analysis report"""
    print("\n" + "=" * 80)
    print("📊 SCHEMA CHANGE ANALYSIS REPORT")
    print("=" * 80)
    
    total_sheets = len(all_changes)
    matching_sheets = sum(1 for c in all_changes if c['status'] == 'match')
    changed_sheets = sum(1 for c in all_changes if c['status'] == 'changed')
    reordered_sheets = sum(1 for c in all_changes if c['status'] == 'reordered')
    error_sheets = sum(1 for c in all_changes if c['status'] == 'error')
    
    print(f"\n📈 Summary:")
    print(f"   Total Sheets Analyzed: {total_sheets}")
    print(f"   ✅ Matching: {matching_sheets}")
    print(f"   ⚠️  Changed: {changed_sheets}")
    print(f"   🔄 Reordered: {reordered_sheets}")
    print(f"   ❌ Errors: {error_sheets}")
    
    # Group by status
    for status_group in [('changed', '⚠️  CHANGED SHEETS'), ('reordered', '🔄 REORDERED SHEETS'), ('error', '❌ ERROR SHEETS')]:
        status, title = status_group
        sheets_with_status = [c for c in all_changes if c['status'] == status]
        
        if sheets_with_status:
            print(f"\n{title}")
            print("-" * 80)
            
            for change in sheets_with_status:
                print(f"\n📄 {change['sheet_name']}")
                print(f"   Spreadsheet: {change['spreadsheet_id']}")
                print(f"   Header Row: {change['header_row']}")
                print(f"   Documented Columns: {change['documented_columns']}")
                print(f"   Actual Columns: {change['actual_columns']}")
                
                if change.get('missing_columns'):
                    print(f"\n   ❌ Missing Columns ({len(change['missing_columns'])}):")
                    for col in change['missing_columns']:
                        print(f"      - {col['column']}: {col['name']} ({col['type']})")
                
                if change.get('extra_columns'):
                    print(f"\n   ➕ Extra Columns ({len(change['extra_columns'])}):")
                    for col in change['extra_columns']:
                        print(f"      - {col['column']}: {col['name']} (at index {col['index']})")
                
                if change.get('column_name_changes'):
                    print(f"\n   🔤 Column Name Changes ({len(change['column_name_changes'])}):")
                    for col in change['column_name_changes']:
                        print(f"      - {col['column']}: '{col['documented_name']}' → '{col['actual_name']}'")
                
                if change.get('column_order_changes'):
                    print(f"\n   🔄 Column Order Changes ({len(change['column_order_changes'])}):")
                    for col in change['column_order_changes']:
                        print(f"      - {col['column']} ({col['name']}): position {col['documented_position']} → {col['actual_position']}")
                
                if change.get('error'):
                    print(f"\n   ❌ Error: {change['error']}")
                
                print(f"\n   Actual Headers:")
                for idx, header in enumerate(change.get('actual_headers', [])):
                    col_letter = column_index_to_letter(idx)
                    print(f"      [{col_letter}] {header}")

def main():
    """Main function"""
    print("🔍 TrueSight DAO Schema Change Analysis")
    print("=" * 80)
    
    if not setup_google_sheets():
        print("❌ Cannot proceed without Google Sheets API access")
        return
    
    all_changes = []
    
    # Analyze each spreadsheet and sheet
    for spreadsheet_id, sheets in SCHEMA_DEFINITIONS.items():
        print(f"\n📊 Analyzing spreadsheet: {spreadsheet_id}")
        
        for sheet_name, schema_def in sheets.items():
            print(f"   Analyzing sheet: {sheet_name}...", end=' ')
            changes = analyze_sheet_changes(spreadsheet_id, sheet_name, schema_def)
            all_changes.append(changes)
            
            status_icon = {
                'match': '✅',
                'changed': '⚠️',
                'reordered': '🔄',
                'error': '❌',
                'unknown': '❓'
            }.get(changes['status'], '❓')
            
            print(f"{status_icon} {changes['status'].upper()}")
    
    # Print comprehensive report
    print_analysis_report(all_changes)
    
    # Save to JSON
    output_file = os.path.join(os.path.dirname(__file__), 'schema_changes.json')
    with open(output_file, 'w') as f:
        json.dump(all_changes, f, indent=2)
    print(f"\n💾 Full analysis saved to: {output_file}")

if __name__ == "__main__":
    main()



