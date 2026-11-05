#!/usr/bin/env python3
"""
Get all sheets and their structures from the main spreadsheets
"""

import json
import os
from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
SPREADSHEET_SERVICE = None

SPREADSHEET_IDS = {
    '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ': 'Telegram & Submissions',
    '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU': 'Main Ledger & Contributors',
    '1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo': 'Grok Scored Contributions'
}

def setup_google_sheets():
    """Initialize Google Sheets API service"""
    global SPREADSHEET_SERVICE
    
    try:
        creds_path = os.path.join(os.path.dirname(__file__), 'gdrive_schema_credentials.json')
        creds = service_account.Credentials.from_service_account_file(
            creds_path, scopes=SCOPES)
        SPREADSHEET_SERVICE = build('sheets', 'v4', credentials=creds)
        return True
    except Exception as e:
        print(f"Error: {str(e)}")
        return False

def get_all_sheets(spreadsheet_id):
    """Get all sheet names and their gids"""
    try:
        spreadsheet = SPREADSHEET_SERVICE.spreadsheets().get(
            spreadsheetId=spreadsheet_id
        ).execute()
        
        sheets = []
        for sheet in spreadsheet.get('sheets', []):
            props = sheet['properties']
            sheets.append({
                'name': props['title'],
                'gid': props['sheetId'],
                'index': props['index']
            })
        return sheets
    except Exception as e:
        print(f"Error getting sheets: {str(e)}")
        return []

def get_header_row(spreadsheet_id, sheet_name, row_num=1, max_rows=10):
    """Get header row and try to identify the actual header row"""
    try:
        # Try to get multiple rows to find the header
        range_name = f"{sheet_name}!1:{max_rows}"
        result = SPREADSHEET_SERVICE.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=range_name
        ).execute()
        
        values = result.get('values', [])
        return values
    except Exception as e:
        return []

def find_header_row(rows):
    """Try to identify which row is the header row"""
    if not rows:
        return None, []
    
    # Look for row with most non-empty cells and text-like content
    best_row = 0
    best_score = 0
    
    for i, row in enumerate(rows[:10]):  # Check first 10 rows
        if not row:
            continue
        # Score: number of non-empty cells with text (not numbers/dates)
        score = sum(1 for cell in row if cell and isinstance(cell, str) and len(cell.strip()) > 0)
        if score > best_score:
            best_score = score
            best_row = i
    
    # If we found a good row, return it (1-indexed)
    if best_score > 0:
        return best_row + 1, rows[best_row] if best_row < len(rows) else []
    
    # Fallback to first row
    return 1, rows[0] if rows else []

def analyze_all_sheets():
    """Analyze all sheets in all spreadsheets"""
    all_data = {}
    
    for spreadsheet_id, spreadsheet_name in SPREADSHEET_IDS.items():
        print(f"\n📊 Analyzing: {spreadsheet_name} ({spreadsheet_id})")
        sheets = get_all_sheets(spreadsheet_id)
        
        spreadsheet_data = {
            'name': spreadsheet_name,
            'id': spreadsheet_id,
            'sheets': {}
        }
        
        for sheet in sheets:
            sheet_name = sheet['name']
            print(f"   📄 {sheet_name}...", end=' ')
            
            # Get rows to find header
            rows = get_header_row(spreadsheet_id, sheet_name, max_rows=10)
            header_row_num, headers = find_header_row(rows)
            
            # Clean headers (remove empty trailing cells)
            while headers and not headers[-1]:
                headers.pop()
            
            sheet_data = {
                'name': sheet_name,
                'gid': sheet['gid'],
                'header_row': header_row_num,
                'columns': headers,
                'column_count': len(headers),
                'url': f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit#gid={sheet['gid']}"
            }
            
            spreadsheet_data['sheets'][sheet_name] = sheet_data
            print(f"✅ {len(headers)} columns (header row {header_row_num})")
        
        all_data[spreadsheet_id] = spreadsheet_data
    
    # Save to JSON
    output_file = os.path.join(os.path.dirname(__file__), 'all_sheets_structure.json')
    with open(output_file, 'w') as f:
        json.dump(all_data, f, indent=2)
    
    print(f"\n💾 Full data saved to: {output_file}")
    return all_data

if __name__ == "__main__":
    if setup_google_sheets():
        analyze_all_sheets()
    else:
        print("Failed to initialize Google Sheets API")



