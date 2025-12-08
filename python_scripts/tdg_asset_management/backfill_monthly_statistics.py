#!/usr/bin/env python3
"""
One-time backfill script to calculate monthly sales volume from all ledgers.

This script:
1. Reads all ledgers from "Shipment Ledger Listing" (Column AB = resolved URLs)
2. Extracts sales transactions from each ledger
3. Groups by month and calculates totals
4. Writes to "Monthly Statistics" sheet with:
   - Monthly sales volume per month
   - Cumulative sales volume (running total)
"""

import re
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import gspread
from google.oauth2.service_account import Credentials

# Configuration
SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing'
MONTHLY_STATISTICS_SHEET_NAME = 'Monthly Statistics'

# Sales identification keywords (case-insensitive)
SALES_KEYWORDS = ['sale', 'sales', 'sold', 'purchase', 'payment']

def get_google_sheets_client():
    """Get authenticated Google Sheets client."""
    creds_paths = [
        Path(__file__).parent.parent / 'python_scripts' / 'schema_validation' / 'gdrive_schema_credentials.json',
        Path(__file__).parent.parent / 'python_scripts' / 'agroverse_qr_code_generator' / 'gdrive_schema_credentials.json',
        Path.home() / '.config' / 'gspread' / 'service_account.json',
    ]
    
    creds_file = None
    for path in creds_paths:
        if path.exists():
            creds_file = path
            break
    
    if not creds_file:
        print("Error: Could not find Google Sheets service account credentials")
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

def is_sale_transaction(description, has_equity_match=False, has_liability_match=False):
    """
    Determine if a transaction is a sale based on description and context.
    
    Args:
        description: Transaction description (Column B)
        has_equity_match: Whether there's a matching Equity transaction (capital injection)
        has_liability_match: Whether this is part of a 3-transaction group with Liability
    
    Returns:
        bool: True if this is a sale transaction
    """
    if not description:
        return False
    
    description_lower = str(description).lower()
    
    # Exclude if it's a capital injection (has matching Equity transaction)
    if has_equity_match:
        return False
    
    # Include if description contains sale keywords
    for keyword in SALES_KEYWORDS:
        if keyword in description_lower:
            return True
    
    # Include if it's part of a sales transaction group (has Liability match)
    if has_liability_match:
        return True
    
    return False

def extract_sales_from_offchain_transactions(sheet, shipment_id):
    """
    Extract sales from 'offchain transactions' sheet (for AGL4).
    
    Filter: Currency = 'USD' AND Column G (Is Revenue) = TRUE
    """
    sales = []
    
    try:
        # Get all data starting from row 4 (header row)
        all_values = sheet.get_all_values()
        
        if len(all_values) < 4:
            print(f"  ⚠️  {shipment_id}: Not enough rows in offchain transactions")
            return sales
        
        # Process rows starting from row 4 (index 3)
        for i, row in enumerate(all_values[3:], start=4):
            if len(row) < 7:
                continue
            
            try:
                # Column A: Transaction Date (YYYYMMDD)
                date_str = str(row[0]).strip()
                if not date_str or len(date_str) < 8:
                    continue
                
                # Column D: Amount
                amount = row[3] if len(row) > 3 else ''
                try:
                    amount = float(amount) if amount else 0
                except (ValueError, TypeError):
                    continue
                
                # Column E: Currency
                currency = row[4] if len(row) > 4 else ''
                
                # Column G: Is Revenue (flag) - may be empty, TRUE, or other values
                is_revenue = row[6] if len(row) > 6 else ''
                
                # Column B: Description (for additional filtering)
                description = row[1] if len(row) > 1 else ''
                
                # Filter: USD currency, positive amount, and either:
                # 1. Is Revenue = TRUE (explicitly marked as revenue)
                # 2. Description contains sale keywords (if Is Revenue is empty)
                is_revenue_flag = (is_revenue == 'TRUE' or is_revenue == True or 
                                 str(is_revenue).upper() == 'TRUE' or 
                                 str(is_revenue).strip() == '1')
                
                description_lower = str(description).lower()
                has_sale_keyword = any(keyword in description_lower for keyword in SALES_KEYWORDS)
                
                # Include if: USD currency, positive amount, and (Is Revenue = TRUE OR has sale keyword)
                if currency == 'USD' and amount > 0 and (is_revenue_flag or has_sale_keyword):
                    # Parse date
                    try:
                        date_obj = datetime.strptime(date_str[:8], '%Y%m%d')
                        month_key = date_obj.strftime('%Y-%m')
                        
                        sales.append({
                            'date': date_obj,
                            'month': month_key,
                            'amount': amount,
                            'description': row[1] if len(row) > 1 else '',
                            'shipment_id': shipment_id
                        })
                    except ValueError:
                        print(f"  ⚠️  {shipment_id}: Invalid date format: {date_str}")
                        continue
            except Exception as e:
                print(f"  ⚠️  {shipment_id}: Error processing row {i}: {e}")
                continue
        
        print(f"  ✅ {shipment_id}: Found {len(sales)} sales in offchain transactions")
        return sales
        
    except Exception as e:
        print(f"  ❌ {shipment_id}: Error reading offchain transactions: {e}")
        return sales

def extract_sales_from_transactions_sheet(sheet, shipment_id):
    """
    Extract sales from 'Transactions' sheet (for other AGL ledgers).
    
    Filter: Type = 'USD' AND Category = 'Assets' AND Amount > 0
    Exclude: Transactions with matching Equity transactions (capital injections)
    Include: Transactions with sale keywords in description or Liability matches
    """
    sales = []
    
    try:
        all_values = sheet.get_all_values()
        
        if len(all_values) < 2:
            print(f"  ⚠️  {shipment_id}: Not enough rows in Transactions sheet")
            return sales
        
        # Find header row
        header_row = 0
        for i, row in enumerate(all_values):
            if row and len(row) > 0:
                first_col = str(row[0]).strip().lower()
                if 'date' in first_col or first_col == '':
                    header_row = i
                    break
        
        # Process data rows
        transactions = []
        for i, row in enumerate(all_values[header_row + 1:], start=header_row + 2):
            if len(row) < 6:
                continue
            
            try:
                # Column A: Date
                date_str = str(row[0]).strip()
                if not date_str:
                    continue
                
                # Column B: Description
                description = row[1] if len(row) > 1 else ''
                
                # Column C: Entity
                entity = row[2] if len(row) > 2 else ''
                
                # Column D: Amount
                try:
                    amount = float(row[3]) if len(row) > 3 and row[3] else 0
                except (ValueError, TypeError):
                    continue
                
                # Column E: Type/Currency
                currency = row[4] if len(row) > 4 else ''
                
                # Column F: Category
                category = row[5] if len(row) > 5 else ''
                
                transactions.append({
                    'row': i,
                    'date_str': date_str,
                    'description': description,
                    'entity': entity,
                    'amount': amount,
                    'currency': currency,
                    'category': category
                })
            except Exception as e:
                continue
        
        # Now identify sales transactions
        # First, identify potential capital injections (USD/Assets with matching Equity)
        equity_matches = set()
        for i, trans in enumerate(transactions):
            if (trans['currency'] == 'USD' and 
                trans['category'] == 'Assets' and 
                trans['amount'] > 0):
                
                # Check if there's a matching Equity transaction
                for j, other_trans in enumerate(transactions):
                    if (i != j and
                        other_trans['date_str'] == trans['date_str'] and
                        other_trans['description'] == trans['description'] and
                        abs(other_trans['amount'] - trans['amount']) < 0.01 and
                        other_trans['currency'] == 'USD' and
                        other_trans['category'] == 'Equity'):
                        equity_matches.add(i)
                        break
        
        # Identify sales transactions (USD/Assets with Liability match or sale keywords)
        liability_matches = set()
        for i, trans in enumerate(transactions):
            if (trans['currency'] == 'USD' and 
                trans['category'] == 'Assets' and 
                trans['amount'] > 0):
                
                # Check if there's a Liability transaction nearby (sales pattern)
                for j, other_trans in enumerate(transactions):
                    if (i != j and
                        abs(i - j) <= 2 and  # Within 2 rows
                        other_trans['date_str'] == trans['date_str'] and
                        other_trans['category'] == 'Liability'):
                        liability_matches.add(i)
                        break
        
        # Extract sales
        for i, trans in enumerate(transactions):
            if (trans['currency'] == 'USD' and 
                trans['category'] == 'Assets' and 
                trans['amount'] > 0):
                
                has_equity = i in equity_matches
                has_liability = i in liability_matches
                
                if is_sale_transaction(trans['description'], has_equity, has_liability):
                    # Parse date
                    try:
                        # Try YYYYMMDD format first
                        if len(trans['date_str']) >= 8 and trans['date_str'][:8].isdigit():
                            date_obj = datetime.strptime(trans['date_str'][:8], '%Y%m%d')
                        else:
                            # Try other date formats
                            date_obj = datetime.strptime(trans['date_str'].split()[0], '%Y-%m-%d')
                        
                        month_key = date_obj.strftime('%Y-%m')
                        
                        sales.append({
                            'date': date_obj,
                            'month': month_key,
                            'amount': trans['amount'],
                            'description': trans['description'],
                            'shipment_id': shipment_id
                        })
                    except ValueError:
                        print(f"  ⚠️  {shipment_id}: Could not parse date: {trans['date_str']}")
                        continue
        
        print(f"  ✅ {shipment_id}: Found {len(sales)} sales in Transactions sheet")
        return sales
        
    except Exception as e:
        print(f"  ❌ {shipment_id}: Error reading Transactions sheet: {e}")
        import traceback
        traceback.print_exc()
        return sales

def get_all_ledger_sales(client):
    """Get all sales from all ledgers in Shipment Ledger Listing."""
    print("=" * 80)
    print("Extracting Sales from All Ledgers")
    print("=" * 80)
    print()
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        shipment_sheet = spreadsheet.worksheet(SHIPMENT_LEDGER_SHEET_NAME)
        
        if not shipment_sheet:
            print(f"❌ Sheet '{SHIPMENT_LEDGER_SHEET_NAME}' not found")
            return []
        
        # Get all data
        all_values = shipment_sheet.get_all_values()
        
        if len(all_values) < 2:
            print("⚠️  No data in Shipment Ledger Listing")
            return []
        
        # Find header row
        header_row = 0
        for i, row in enumerate(all_values):
            if row and 'Shipment ID' in str(row[0]):
                header_row = i
                break
        
        print(f"📖 Reading from Shipment Ledger Listing (header at row {header_row + 1})...")
        print()
        
        all_sales = []
        
        # Process each shipment
        for i, row in enumerate(all_values[header_row + 1:], start=header_row + 2):
            if len(row) < 28:
                continue
            
            shipment_id = row[0].strip() if len(row) > 0 else ''
            resolved_url = row[27].strip() if len(row) > 27 else ''  # Column AB (index 27)
            
            if not shipment_id or not resolved_url or shipment_id == '0':
                continue
            
            if not resolved_url.startswith('https://docs.google.com/spreadsheets'):
                continue
            
            print(f"Processing {shipment_id}...")
            
            try:
                # Check if it's AGL4 (use main ledger's offchain transactions)
                if shipment_id.upper() == 'AGL4':
                    # AGL4 sales are in the main ledger's "offchain transactions" sheet
                    main_spreadsheet = client.open_by_key(SPREADSHEET_ID)
                    offchain_sheet = main_spreadsheet.worksheet('offchain transactions')
                    if offchain_sheet:
                        sales = extract_sales_from_offchain_transactions(offchain_sheet, shipment_id)
                        all_sales.extend(sales)
                    else:
                        print(f"  ⚠️  {shipment_id}: 'offchain transactions' sheet not found in main ledger")
                else:
                    # Open the ledger spreadsheet
                    ledger_spreadsheet = client.open_by_url(resolved_url)
                    # Use Transactions sheet
                    transactions_sheet = ledger_spreadsheet.worksheet('Transactions')
                    if transactions_sheet:
                        sales = extract_sales_from_transactions_sheet(transactions_sheet, shipment_id)
                        all_sales.extend(sales)
                    else:
                        print(f"  ⚠️  {shipment_id}: 'Transactions' sheet not found")
                        
            except Exception as e:
                print(f"  ❌ {shipment_id}: Error accessing ledger: {e}")
                import traceback
                traceback.print_exc()
                continue
        
        print()
        print(f"✅ Total sales transactions found: {len(all_sales)}")
        return all_sales
        
    except Exception as e:
        print(f"❌ Error reading Shipment Ledger Listing: {e}")
        import traceback
        traceback.print_exc()
        return []

def calculate_monthly_statistics(sales):
    """Calculate monthly and cumulative sales statistics."""
    print()
    print("=" * 80)
    print("Calculating Monthly Statistics")
    print("=" * 80)
    print()
    
    # Group by month
    monthly_totals = defaultdict(float)
    
    for sale in sales:
        month_key = sale['month']
        monthly_totals[month_key] += sale['amount']
    
    # Sort by month
    sorted_months = sorted(monthly_totals.keys())
    
    # Calculate cumulative totals
    cumulative = 0.0
    statistics = []
    
    for month in sorted_months:
        monthly_amount = monthly_totals[month]
        cumulative += monthly_amount
        statistics.append({
            'month': month,
            'monthly_sales': monthly_amount,
            'cumulative_sales': cumulative
        })
        print(f"  {month}: ${monthly_amount:,.2f} (Cumulative: ${cumulative:,.2f})")
    
    print()
    print(f"✅ Calculated statistics for {len(statistics)} months")
    print(f"📊 Total cumulative sales: ${cumulative:,.2f}")
    
    return statistics

def write_to_monthly_statistics_sheet(client, statistics):
    """Write monthly statistics to the Monthly Statistics sheet."""
    print()
    print("=" * 80)
    print("Writing to Monthly Statistics Sheet")
    print("=" * 80)
    print()
    
    try:
        spreadsheet = client.open_by_key(SPREADSHEET_ID)
        
        # Get or create the sheet
        try:
            monthly_sheet = spreadsheet.worksheet(MONTHLY_STATISTICS_SHEET_NAME)
            print(f"✅ Found existing sheet: {MONTHLY_STATISTICS_SHEET_NAME}")
        except gspread.exceptions.WorksheetNotFound:
            print(f"📝 Creating new sheet: {MONTHLY_STATISTICS_SHEET_NAME}")
            monthly_sheet = spreadsheet.add_worksheet(
                title=MONTHLY_STATISTICS_SHEET_NAME,
                rows=1000,
                cols=10
            )
        
        # Clear existing data (except header)
        monthly_sheet.clear()
        
        # Set up headers
        headers = [
            'Year-Month',
            'Monthly Sales Volume (USD)',
            'Cumulative Sales Volume (USD)',
            'Last Updated'
        ]
        monthly_sheet.append_row(headers)
        
        # Format header row
        header_range = monthly_sheet.range(1, 1, 1, len(headers))
        for i, cell in enumerate(header_range):
            cell.value = headers[i]
        monthly_sheet.update_cells(header_range)
        
        # Write data
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        for stat in statistics:
            row = [
                stat['month'],
                stat['monthly_sales'],
                stat['cumulative_sales'],
                now
            ]
            monthly_sheet.append_row(row)
        
        print(f"✅ Wrote {len(statistics)} months of data to Monthly Statistics sheet")
        print()
        print("Sheet structure:")
        print("  Column A: Year-Month (YYYY-MM)")
        print("  Column B: Monthly Sales Volume (USD)")
        print("  Column C: Cumulative Sales Volume (USD)")
        print("  Column D: Last Updated (timestamp)")
        
    except Exception as e:
        print(f"❌ Error writing to Monthly Statistics sheet: {e}")
        import traceback
        traceback.print_exc()

def main():
    print("=" * 80)
    print("Monthly Statistics Backfill Script")
    print("=" * 80)
    print()
    
    # Authenticate
    client = get_google_sheets_client()
    if not client:
        return
    
    # Extract sales from all ledgers
    all_sales = get_all_ledger_sales(client)
    
    if not all_sales:
        print("⚠️  No sales found. Exiting.")
        return
    
    # Calculate monthly statistics
    statistics = calculate_monthly_statistics(all_sales)
    
    # Write to Monthly Statistics sheet
    write_to_monthly_statistics_sheet(client, statistics)
    
    print()
    print("=" * 80)
    print("✅ Backfill Complete!")
    print("=" * 80)

if __name__ == "__main__":
    main()

