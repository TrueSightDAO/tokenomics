#!/usr/bin/env python3
"""
IRS Tax Compilation Script

Extracts sales and expenses transactions from TrueSight DAO ledgers for 2025 tax year.
Reads from:
- Main Ledger (offchain transactions sheet)
- Managed AGL Ledgers (from Shipment Ledger Listing)

Writes to:
- Google Sheet: 20260128 - 2025 IRS tax compilation
  - Tab: Sales (all positive USD transactions)
  - Tab: Expenses (all negative USD transactions)

Each row includes:
- Transaction Date
- Description
- Fund Handler/Contributor Name
- Amount
- Currency
- Source Ledger Name
- Ledger URL
"""

import os
import sys
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import json

try:
    import gspread
    import gspread.exceptions
    from google.oauth2.service_account import Credentials
except ImportError:
    print("Error: Required packages not installed.")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)


# Configuration
SCRIPT_DIR = Path(__file__).parent
CREDENTIALS_FILE = SCRIPT_DIR / "credentials.json"
TARGET_YEAR = 2025

# Rate limiting configuration
API_DELAY_SECONDS = 0.5  # Delay between API calls (seconds)
MAX_RETRIES = 5  # Maximum retry attempts for rate limit errors
RETRY_BASE_DELAY = 60  # Base delay for exponential backoff (seconds)

# Tax Filing Information
EIN_NUMBER = "88-3411514"  # Employer Identification Number
FILE_NUMBER = "006913393"  # IRS File Number

# Spreadsheet IDs
MAIN_LEDGER_ID = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU"
MAIN_LEDGER_OFFCHAIN_GID = "995916231"  # offchain transactions sheet
MAIN_LEDGER_LEDGER_HISTORY_GID = "0"  # Ledger History sheet (for sales)

TAX_COMPILATION_SPREADSHEET_ID = "1B3R7626-I5Ql26Rsv4F6xoM_X8f0Hqx9vANqRoavxNA"

# Column indices (0-based)
# offchain transactions sheet (Header Row: 4, so data starts at row 5)
OFFCHAIN_DATE_COL = 0  # Column A: Transaction Date
OFFCHAIN_DESC_COL = 1  # Column B: Description
OFFCHAIN_HANDLER_COL = 2  # Column C: Fund Handler
OFFCHAIN_AMOUNT_COL = 3  # Column D: Amount
OFFCHAIN_CURRENCY_COL = 4  # Column E: Currency
OFFCHAIN_IS_REVENUE_COL = 6  # Column G: Is Revenue

# Ledger History sheet (Header Row: 4, so data starts at row 5)
LEDGER_HISTORY_DATE_COL = 6  # Column G: Status date
LEDGER_HISTORY_DESC_COL = 1  # Column B: Project Name / Contribution Made
LEDGER_HISTORY_CONTRIBUTOR_COL = 0  # Column A: Contributor Name
LEDGER_HISTORY_AMOUNT_COL = 3  # Column D: TDGs Provisioned (not USD, but we'll check)
LEDGER_HISTORY_STATUS_COL = 5  # Column F: Status

# Output columns
OUTPUT_COLS = [
    "Transaction Date",
    "Description",
    "Fund Handler/Contributor",
    "Amount (USD)",
    "Currency",
    "Source Ledger",
    "Ledger URL",
    "Row Number"
]


def get_google_client():
    """Initialize Google Sheets client with service account credentials."""
    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError(
            f"Credentials file not found: {CREDENTIALS_FILE}\n"
            f"Please ensure credentials.json is in the script directory."
        )
    
    creds = Credentials.from_service_account_file(
        str(CREDENTIALS_FILE),
        scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    )
    return gspread.authorize(creds)


def retry_with_backoff(func, *args, **kwargs):
    """
    Retry a function call with exponential backoff on rate limit errors.
    
    Args:
        func: Function or lambda to call
        *args, **kwargs: Arguments to pass to function
    
    Returns:
        Result of function call
    """
    for attempt in range(MAX_RETRIES):
        try:
            time.sleep(API_DELAY_SECONDS)  # Add delay before each API call
            return func(*args, **kwargs)
        except gspread.exceptions.APIError as e:
            # Check if it's a rate limit error (429)
            error_status = getattr(e.response, 'status_code', None)
            if error_status == 429:  # Rate limit error
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_BASE_DELAY * (2 ** attempt)  # Exponential backoff
                    print(f"⚠️  Rate limit hit. Waiting {wait_time} seconds before retry {attempt + 1}/{MAX_RETRIES}...")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"❌ Rate limit error after {MAX_RETRIES} attempts. Skipping...")
                    raise
            else:
                # Non-rate-limit error, re-raise immediately
                raise
        except Exception as e:
            # Check if error message contains rate limit info
            error_str = str(e).lower()
            if '429' in error_str or 'quota exceeded' in error_str or 'rate limit' in error_str:
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_BASE_DELAY * (2 ** attempt)
                    print(f"⚠️  Rate limit detected. Waiting {wait_time} seconds before retry {attempt + 1}/{MAX_RETRIES}...")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"❌ Rate limit error after {MAX_RETRIES} attempts. Skipping...")
                    raise
            else:
                # Other errors, re-raise immediately
                raise
    
    # Should never reach here, but just in case
    raise Exception(f"Failed after {MAX_RETRIES} retries")


def parse_date(date_str: str) -> Optional[datetime]:
    """Parse date string in YYYYMMDD format."""
    if not date_str or date_str == "":
        return None
    try:
        # Handle YYYYMMDD format
        if len(str(date_str)) == 8 and str(date_str).isdigit():
            return datetime.strptime(str(date_str), "%Y%m%d")
        # Handle other date formats
        return datetime.strptime(str(date_str), "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def is_2025_transaction(date_str: str) -> bool:
    """Check if transaction date is in 2025."""
    date_obj = parse_date(date_str)
    if not date_obj:
        return False
    return date_obj.year == TARGET_YEAR


def get_managed_ledgers(client) -> List[Dict[str, str]]:
    """
    Get list of managed AGL ledgers from Shipment Ledger Listing sheet.
    Returns list of dicts with 'name' and 'url' keys.
    """
    try:
        main_spreadsheet = retry_with_backoff(client.open_by_key, MAIN_LEDGER_ID)
        
        # Find Shipment Ledger Listing sheet
        try:
            shipment_ledger_sheet = retry_with_backoff(main_spreadsheet.worksheet, "Shipment Ledger Listing")
        except gspread.exceptions.WorksheetNotFound:
            print("Warning: Shipment Ledger Listing sheet not found. Only processing main ledger.")
            return []
        
        # Read ledger list
        # Column A (index 0): Shipment ID / Ledger Name
        # Column AB (index 27): Resolved URL (Google Sheets URL)
        rows = retry_with_backoff(shipment_ledger_sheet.get_all_values)
        if len(rows) < 2:
            return []
        
        # Find header row
        header_row_idx = 0
        for idx, row in enumerate(rows[:10]):
            if len(row) > 0 and ("Shipment ID" in str(row[0]) or "Shipment" in str(row[0])):
                header_row_idx = idx
                break
        
        ledgers = []
        for row in rows[header_row_idx + 1:]:  # Skip header
            if len(row) < 28:  # Need at least column AB (index 27)
                continue
            
            ledger_name = str(row[0]).strip() if len(row) > 0 else ""
            resolved_url = str(row[27]).strip() if len(row) > 27 else ""  # Column AB
            
            # Only process if we have a Google Sheets URL
            if ledger_name and resolved_url and resolved_url.startswith("https://docs.google.com/spreadsheets"):
                ledgers.append({
                    "name": ledger_name,
                    "url": resolved_url
                })
        
        print(f"Found {len(ledgers)} managed ledgers")
        return ledgers
    
    except Exception as e:
        print(f"Error fetching managed ledgers: {e}")
        return []


def extract_spreadsheet_id_from_url(url: str) -> Optional[str]:
    """Extract spreadsheet ID from Google Sheets URL."""
    try:
        # Format: https://docs.google.com/spreadsheets/d/{ID}/edit...
        parts = url.split("/d/")
        if len(parts) > 1:
            spreadsheet_id = parts[1].split("/")[0]
            return spreadsheet_id
    except Exception:
        pass
    return None


def get_existing_rows_hash(worksheet) -> set:
    """
    Get hash set of existing rows to avoid duplicates.
    Creates hash from: Transaction Date + Description + Amount + Source Ledger
    """
    existing = set()
    try:
        if worksheet is None:
            return existing
        rows = retry_with_backoff(worksheet.get_all_values)
        if len(rows) <= 1:  # Only header or empty
            return existing
        
        for row in rows[1:]:  # Skip header
            if len(row) >= 7:
                # Create hash from key fields
                date = str(row[0]).strip()
                desc = str(row[1]).strip()
                amount = str(row[3]).strip()
                ledger = str(row[5]).strip()
                hash_key = f"{date}|{desc}|{amount}|{ledger}"
                existing.add(hash_key)
    except Exception as e:
        print(f"Warning: Error reading existing rows: {e}")
    
    return existing


def process_offchain_transactions(client, existing_sales: set, existing_expenses: set) -> Tuple[List[List], List[List]]:
    """
    Process offchain transactions sheet from main ledger.
    Returns (sales_rows, expenses_rows)
    """
    sales_rows = []
    expenses_rows = []
    
    try:
        main_spreadsheet = retry_with_backoff(client.open_by_key, MAIN_LEDGER_ID)
        # Find worksheet by name (gspread doesn't support GID directly)
        offchain_sheet = None
        worksheets = retry_with_backoff(lambda: main_spreadsheet.worksheets())
        for sheet in worksheets:
            if "offchain transaction" in sheet.title.lower():
                offchain_sheet = sheet
                break
        
        if not offchain_sheet:
            print("Warning: 'offchain transactions' sheet not found in main ledger")
            return sales_rows, expenses_rows
        
        rows = retry_with_backoff(offchain_sheet.get_all_values)
        if len(rows) <= 4:  # Header row is 4, so need at least 5 rows
            return sales_rows, expenses_rows
        
        # Data starts at row 5 (index 4)
        for idx, row in enumerate(rows[4:], start=5):
            if len(row) < 5:
                continue
            
            date_str = str(row[OFFCHAIN_DATE_COL]).strip()
            if not is_2025_transaction(date_str):
                continue
            
            description = str(row[OFFCHAIN_DESC_COL]).strip()
            fund_handler = str(row[OFFCHAIN_HANDLER_COL]).strip()
            amount_str = str(row[OFFCHAIN_AMOUNT_COL]).strip()
            currency = str(row[OFFCHAIN_CURRENCY_COL]).strip()
            
            # Skip if not USD
            if currency.upper() != "USD":
                continue
            
            try:
                amount = float(amount_str)
            except (ValueError, TypeError):
                continue
            
            # Check Is Revenue column if available
            is_revenue = False
            if len(row) > OFFCHAIN_IS_REVENUE_COL:
                is_revenue_str = str(row[OFFCHAIN_IS_REVENUE_COL]).strip().upper()
                is_revenue = is_revenue_str in ["TRUE", "YES", "1"]
            
            # Check for sale keywords in description (matching Monthly Statistics logic)
            description_lower = description.lower()
            has_sale_keyword = any(keyword in description_lower for keyword in ['sale', 'sales', 'sold', 'purchase', 'payment'])
            
            # Determine if sales or expense
            # Sales: positive amount AND (Is Revenue = TRUE OR has sale keyword) - matching Monthly Statistics
            # Expenses: negative amount (Column D < 0) AND Currency is USD (already checked above)
            is_sale = amount > 0 and (is_revenue or has_sale_keyword)
            is_expense = amount < 0  # Expenses: Column D < 0 and Column E = USD
            
            ledger_name = "Main Ledger (offchain transactions)"
            ledger_url = f"https://docs.google.com/spreadsheets/d/{MAIN_LEDGER_ID}/edit#gid={MAIN_LEDGER_OFFCHAIN_GID}"
            
            output_row = [
                date_str,
                description,
                fund_handler,
                amount,
                currency,
                ledger_name,
                ledger_url,
                idx  # Row number in source sheet
            ]
            
            # Create hash for duplicate detection
            hash_key = f"{date_str}|{description}|{amount}|{ledger_name}"
            
            if is_sale and hash_key not in existing_sales:
                sales_rows.append(output_row)
                existing_sales.add(hash_key)
            elif is_expense and hash_key not in existing_expenses:
                expenses_rows.append(output_row)
                existing_expenses.add(hash_key)
        
        print(f"Processed offchain transactions: {len(sales_rows)} sales, {len(expenses_rows)} expenses")
    
    except Exception as e:
        print(f"Error processing offchain transactions: {e}")
        import traceback
        traceback.print_exc()
    
    return sales_rows, expenses_rows


def process_ledger_history_liquidity_injections(client, existing_sales: set, existing_expenses: set) -> Tuple[List[List], List[List]]:
    """
    Process Ledger History sheet for liquidity injection transactions.
    Filters for rows where Rubric classification contains "1TDG For every 1 USD of liquidity injected".
    
    Returns (sales_rows, expenses_rows)
    Note: Liquidity injections are capital contributions, not revenue. They will be included
    as expenses (negative) since they represent capital, not sales revenue.
    """
    sales_rows = []
    expenses_rows = []
    
    try:
        main_spreadsheet = client.open_by_key(MAIN_LEDGER_ID)
        
        # Ledger History is the first sheet (gid=0), which is typically sheet1
        ledger_history_sheet = None
        try:
            # Try to find by name first
            ledger_history_sheet = retry_with_backoff(main_spreadsheet.worksheet, "Ledger History")
        except gspread.exceptions.WorksheetNotFound:
            # Try first sheet (gid=0)
            ledger_history_sheet = retry_with_backoff(lambda: main_spreadsheet.sheet1)
        
        if not ledger_history_sheet:
            print("Warning: Ledger History sheet not found")
            return sales_rows, expenses_rows
        
        rows = retry_with_backoff(ledger_history_sheet.get_all_values)
        if len(rows) < 5:  # Header is at row 4 (index 3), need at least row 5 for data
            return sales_rows, expenses_rows
        
        # Header row is at index 3 (row 4)
        # Column indices: A=0 (Contributor Name), B=1 (Project Name), C=2 (Contribution Made/USD amount),
        # D=3 (Rubric classification), H=7 (Status date)
        HEADER_ROW = 3  # Row 4 (0-indexed)
        
        print("Processing Ledger History - liquidity injections...")
        
        # Initialize counters
        liquidity_injection_count = 0
        processed_count = 0
        
        # Process data rows starting from row 5 (index 4)
        for idx, row in enumerate(rows[HEADER_ROW + 1:], start=HEADER_ROW + 2):
            if len(row) < 8:  # Need at least column H (index 7)
                continue
            
            rubric_classification = str(row[3]).strip() if len(row) > 3 else ""
            
            # Filter for liquidity injection transactions
            # Column D must exactly equal "1TDG For every 1 USD of liquidity injected"
            if rubric_classification != "1TDG For every 1 USD of liquidity injected":
                continue
            
            liquidity_injection_count += 1
            
            # For liquidity injections with "1TDG For every 1 USD", the USD amount equals the TDG amount
            # Column E (index 4): TDGs Provisioned = USD amount (1:1 ratio)
            # Column E must be > 0
            tdgs_provisioned_str = str(row[4]).strip() if len(row) > 4 else ""
            if not tdgs_provisioned_str:
                continue
            
            # Parse TDG amount (which equals USD amount for liquidity injections)
            try:
                # Remove commas and convert to float
                amount = float(tdgs_provisioned_str.replace(",", "").replace("$", "").strip())
            except (ValueError, TypeError):
                continue
            
            # Skip if amount is 0 or invalid (Column E must be > 0)
            if amount <= 0:
                continue
            
            # Extract date from Column H (Status date) - format: YYYYMMDD
            status_date_str = str(row[7]).strip() if len(row) > 7 else ""
            if not status_date_str or len(status_date_str) < 8:
                continue
            
            # Check if it's a 2025 transaction
            if not is_2025_transaction(status_date_str):
                continue
            
            # Extract other fields
            contributor_name = str(row[0]).strip() if len(row) > 0 else ""
            project_name = str(row[1]).strip() if len(row) > 1 else ""
            description = f"Liquidity injection - {project_name}" if project_name else "Liquidity injection"
            
            # Format date for output (YYYYMMDD -> YYYY-MM-DD or keep as is)
            date_str = status_date_str[:8]  # Take first 8 characters
            
            ledger_name = "Main Ledger - Ledger History"
            ledger_url = f"https://docs.google.com/spreadsheets/d/{MAIN_LEDGER_ID}/edit?gid=0"
            
            # Liquidity injections are capital contributions (money coming in)
            # For tax purposes, capital contributions are not revenue, but they represent USD received
            # Including as positive amount in expenses tab (since they're capital, not sales revenue)
            # Note: These are capital contributions, not operational revenue or expenses
            amount_as_expense = abs(amount)  # Positive amount (money received)
            
            output_row = [
                date_str,
                description,
                contributor_name,  # Contributor name as the entity
                amount_as_expense,  # Negative amount for expenses
                "USD",
                ledger_name,
                ledger_url,
                idx  # Row number in source sheet
            ]
            
            # Create hash for duplicate detection
            hash_key = f"{date_str}|{description}|{amount_as_expense}|{ledger_name}|{contributor_name}"
            
            if hash_key not in existing_expenses:
                expenses_rows.append(output_row)
                existing_expenses.add(hash_key)
                processed_count += 1
        
        print(f"Processed Ledger History liquidity injections: {processed_count} transactions")
        print(f"  Found {liquidity_injection_count} rows matching liquidity injection criteria")
    
    except Exception as e:
        print(f"Error processing Ledger History liquidity injections: {e}")
        import traceback
        traceback.print_exc()
    
    return sales_rows, expenses_rows


def process_managed_ledger(client, ledger_info: Dict[str, str], existing_sales: set, existing_expenses: set) -> Tuple[List[List], List[List]]:
    """
    Process a managed AGL ledger.
    Returns (sales_rows, expenses_rows)
    """
    sales_rows = []
    expenses_rows = []
    
    try:
        # Use open_by_url for Google Sheets URLs
        ledger_spreadsheet = retry_with_backoff(client.open_by_url, ledger_info["url"])
        
        # Find the Transactions sheet (standard name for managed ledgers)
        transaction_sheet = None
        try:
            transaction_sheet = retry_with_backoff(ledger_spreadsheet.worksheet, "Transactions")
        except gspread.exceptions.WorksheetNotFound:
            # Try alternative names
            worksheets = retry_with_backoff(lambda: ledger_spreadsheet.worksheets())
            for sheet in worksheets:
                sheet_title_lower = sheet.title.lower()
                if "transaction" in sheet_title_lower:
                    transaction_sheet = sheet
                    break
        
        if not transaction_sheet:
            print(f"Warning: Could not find Transactions sheet in {ledger_info['name']}")
            return sales_rows, expenses_rows
        
        rows = retry_with_backoff(transaction_sheet.get_all_values)
        if len(rows) < 2:
            return sales_rows, expenses_rows
        
        # Find header row (Transactions sheet structure: Date, Description, Entity, Amount, Type/Currency, Category)
        header_row_idx = 0
        for idx, row in enumerate(rows[:10]):
            if len(row) > 0:
                first_col = str(row[0]).strip().lower()
                if "date" in first_col:
                    header_row_idx = idx
                    break
        
        # Column indices for Transactions sheet (0-based)
        # A: Date (0), B: Description (1), C: Entity (2), D: Amount (3), E: Type/Currency (4), F: Category (5)
        DATE_COL = 0
        DESC_COL = 1
        ENTITY_COL = 2
        AMOUNT_COL = 3
        CURRENCY_COL = 4
        CATEGORY_COL = 5
        
        # Process data rows
        for idx, row in enumerate(rows[header_row_idx + 1:], start=header_row_idx + 2):
            if len(row) < 4:  # Need at least Date and Amount
                continue
            
            date_str = str(row[DATE_COL]).strip()
            if not is_2025_transaction(date_str):
                continue
            
            description = str(row[DESC_COL]).strip() if len(row) > DESC_COL else ""
            entity = str(row[ENTITY_COL]).strip() if len(row) > ENTITY_COL else ""
            amount_str = str(row[AMOUNT_COL]).strip()
            currency = str(row[CURRENCY_COL]).strip() if len(row) > CURRENCY_COL else ""
            category = str(row[CATEGORY_COL]).strip() if len(row) > CATEGORY_COL else ""
            
            # Skip if not USD
            if currency.upper() != "USD":
                continue
            
            try:
                amount = float(amount_str)
            except (ValueError, TypeError):
                continue
            
            # Check for sale keywords in description (matching Monthly Statistics logic)
            description_lower = description.lower()
            has_sale_keyword = any(keyword in description_lower for keyword in ['sale', 'sales', 'sold', 'purchase', 'payment'])
            
            # Sales: positive USD amounts, Category = "Assets", and (has sale keyword OR positive amount)
            # Monthly Statistics checks: Category = "Assets", positive amount, USD, and uses isSaleTransaction()
            # For simplicity, we'll check: Category = "Assets" AND positive amount (matching Monthly Statistics basic criteria)
            # Note: Full Monthly Statistics logic also excludes equity matches and checks for liability matches,
            # but that requires analyzing transaction pairs which is complex. This should capture most sales.
            is_sale = amount > 0 and category.upper() == "ASSETS"
            
            # Expenses: negative USD amounts
            is_expense = amount < 0
            
            ledger_name = ledger_info["name"]
            ledger_url = ledger_info["url"]
            
            output_row = [
                date_str,
                description,
                entity,  # Entity for managed ledgers
                amount,
                currency,
                ledger_name,
                ledger_url,
                idx  # Row number in source sheet
            ]
            
            # Create hash for duplicate detection
            hash_key = f"{date_str}|{description}|{amount}|{ledger_name}"
            
            if is_sale and hash_key not in existing_sales:
                sales_rows.append(output_row)
                existing_sales.add(hash_key)
            elif is_expense and hash_key not in existing_expenses:
                expenses_rows.append(output_row)
                existing_expenses.add(hash_key)
        
        print(f"Processed {ledger_info['name']}: {len(sales_rows)} sales, {len(expenses_rows)} expenses")
    
    except Exception as e:
        print(f"Error processing {ledger_info.get('name', 'unknown')}: {e}")
        import traceback
        traceback.print_exc()
    
    return sales_rows, expenses_rows


def get_2025_sales_from_monthly_statistics(client) -> float:
    """
    Get 2025 total sales from Monthly Statistics sheet to match truesight.me reporting.
    Sums all monthly sales for months starting with "2025-".
    Returns 0 if sheet not found or error occurs.
    """
    try:
        main_spreadsheet = retry_with_backoff(client.open_by_key, MAIN_LEDGER_ID)
        monthly_stats_sheet = retry_with_backoff(main_spreadsheet.worksheet, "Monthly Statistics")
        
        rows = retry_with_backoff(monthly_stats_sheet.get_all_values)
        if len(rows) < 2:
            return 0
        
        total_2025_sales = 0.0
        # Column A: Year-Month (e.g., "2025-01"), Column B: Monthly Sales Volume (USD)
        for row in rows[1:]:  # Skip header row
            if len(row) < 2:
                continue
            
            year_month = str(row[0]).strip()
            monthly_sales_str = str(row[1]).strip()
            
            # Check if it's a 2025 month
            if year_month.startswith("2025-"):
                try:
                    monthly_sales = float(monthly_sales_str.replace(",", "").replace("$", "").strip())
                    total_2025_sales += monthly_sales
                except (ValueError, TypeError):
                    continue
        
        return total_2025_sales
    except Exception as e:
        print(f"Warning: Could not read Monthly Statistics: {e}")
        return 0


def compile_irs_filing_summary(client, main_ledger_sales: List[List], main_ledger_expenses: List[List], liquidity_injections: List[List], all_sales: List[List] = None, all_expenses: List[List] = None) -> List[List]:
    """
    Compile IRS filing summary.
    Returns a list of rows for the IRS Filing Summary tab.
    
    Note: Sales and expenses include all ledgers (main + managed) from Shipment Ledger Listing.
    Assets are main ledger only (DAO assets).
    """
    summary_rows = []
    
    try:
        # Get sales total from Monthly Statistics sheet to ensure exact match
        total_sales_from_monthly_stats = get_2025_sales_from_monthly_statistics(client)
        
        # Calculate totals from transactions as fallback/validation
        if all_sales:
            calculated_total_sales = sum(row[3] for row in all_sales if isinstance(row[3], (int, float)) and row[3] > 0)
        else:
            calculated_total_sales = sum(row[3] for row in main_ledger_sales if isinstance(row[3], (int, float)) and row[3] > 0)
        
        # Use Monthly Statistics value if available (ensures exact match with truesight.me)
        # Otherwise use calculated value
        if total_sales_from_monthly_stats > 0:
            total_sales = total_sales_from_monthly_stats
            print(f"📊 Using Monthly Statistics total: ${total_sales:,.2f} (calculated: ${calculated_total_sales:,.2f})")
        else:
            total_sales = calculated_total_sales
            print(f"⚠️  Monthly Statistics not available, using calculated total: ${total_sales:,.2f}")
        
        # Expenses: negative USD amounts from all ledgers (exclude liquidity injections which are positive capital contributions)
        # Use all_expenses if provided (includes all ledgers), otherwise fall back to main_ledger_expenses
        expenses_to_use = all_expenses if all_expenses else main_ledger_expenses
        
        # Filter out liquidity injections by checking if they're from Ledger History
        # Liquidity injections are positive amounts, so we exclude them
        operational_expenses = [
            row for row in expenses_to_use 
            if isinstance(row[3], (int, float)) and row[3] < 0 
            and "Ledger History" not in str(row[5])  # Exclude liquidity injections
        ]
        total_expenses = sum(abs(row[3]) for row in operational_expenses)
        
        # Liquidity injections: positive amounts from Ledger History
        total_liquidity_injections = sum(
            row[3] for row in liquidity_injections 
            if isinstance(row[3], (int, float)) and row[3] > 0
        )
        
        # Calculate sales breakdown by ledger
        sales_by_ledger = {}
        if all_sales:
            for row in all_sales:
                if isinstance(row[3], (int, float)) and row[3] > 0:
                    ledger_name = str(row[5]).strip() if len(row) > 5 else "Unknown"
                    if ledger_name not in sales_by_ledger:
                        sales_by_ledger[ledger_name] = 0.0
                    sales_by_ledger[ledger_name] += row[3]
        
        # Calculate expenses breakdown by ledger
        expenses_by_ledger = {}
        for row in operational_expenses:
            ledger_name = str(row[5]).strip() if len(row) > 5 else "Unknown"
            if ledger_name not in expenses_by_ledger:
                expenses_by_ledger[ledger_name] = 0.0
            expenses_by_ledger[ledger_name] += abs(row[3])  # Expenses are negative, so use abs
        
        # Sort ledgers alphabetically for consistent display
        sorted_sales_ledgers = sorted(sales_by_ledger.items(), key=lambda x: x[0])
        sorted_expenses_ledgers = sorted(expenses_by_ledger.items(), key=lambda x: x[0])
        
        # Net income/loss
        net_income_loss = total_sales - total_expenses
        
        # Get asset balance from main ledger
        main_spreadsheet = retry_with_backoff(client.open_by_key, MAIN_LEDGER_ID)
        total_assets = 0
        
        try:
            asset_balance_sheet = retry_with_backoff(main_spreadsheet.worksheet, "off chain asset balance")
            # Cell D1 contains total USD value of all offchain assets
            total_assets_cell = retry_with_backoff(asset_balance_sheet.acell, "D1")
            if total_assets_cell and hasattr(total_assets_cell, 'value'):
                try:
                    total_assets = float(str(total_assets_cell.value).replace(",", "").replace("$", "").strip())
                except (ValueError, TypeError):
                    pass
        except Exception as e:
            print(f"Warning: Could not read asset balance: {e}")
        
        # Build summary rows
        summary_rows = [
            ["IRS Filing Summary - 2025 Tax Year"],
            ["Entity Information"],
            ["EIN Number", EIN_NUMBER],
            ["File Number", FILE_NUMBER],
            ["Tax Year", TARGET_YEAR],
            [""],  # Blank row
            ["Income Statement"],
            ["Total Sales (Revenue)", f"${total_sales:,.2f}"],
        ]
        
        # Add sales breakdown by ledger
        if sorted_sales_ledgers:
            for ledger_name, ledger_total in sorted_sales_ledgers:
                summary_rows.append([f"  - {ledger_name}", f"${ledger_total:,.2f}"])
        
        summary_rows.append([""])  # Blank row
        summary_rows.append(["Total Expenses", f"${total_expenses:,.2f}"])
        
        # Add expenses breakdown by ledger
        if sorted_expenses_ledgers:
            for ledger_name, ledger_total in sorted_expenses_ledgers:
                summary_rows.append([f"  - {ledger_name}", f"${ledger_total:,.2f}"])
        
        summary_rows.extend([
            [""],  # Blank row
            ["Net Income (Loss)", f"${net_income_loss:,.2f}"],
            [""],  # Blank row
            ["Balance Sheet (Main Ledger Only)"],
            ["Total Assets (Off-chain Assets)", f"${total_assets:,.2f}"],
            [""],  # Blank row
            ["Transaction Counts"],
            ["Number of Sales Transactions", len(all_sales) if all_sales else len(main_ledger_sales)],
            ["Number of Expense Transactions", len(all_expenses) if all_expenses else len(main_ledger_expenses)],
            ["Number of Liquidity Injections", len(liquidity_injections)],
            [""],  # Blank row
            ["Notes"],
            ["- All amounts are in USD"],
            ["- Sales include all ledgers (matches Monthly Statistics)"],
            ["- Expenses include all ledgers (negative USD transactions from Shipment Ledger Listing)"],
            ["- Assets are main ledger only (DAO assets)"],
            ["- Assets represent off-chain physical assets from main ledger"],
            ["- Liquidity injections are capital contributions, not revenue"],
        ])
        
    except Exception as e:
        print(f"Error compiling IRS filing summary: {e}")
        import traceback
        traceback.print_exc()
        summary_rows = [["Error compiling summary", str(e)]]
    
    return summary_rows


def write_to_sheet(client, sales_rows: List[List], expenses_rows: List[List], main_ledger_sales: List[List] = None, main_ledger_expenses: List[List] = None, liquidity_injections: List[List] = None, all_sales: List[List] = None, all_expenses: List[List] = None):
    """Write sales and expenses to the tax compilation spreadsheet."""
    try:
        tax_spreadsheet = retry_with_backoff(client.open_by_key, TAX_COMPILATION_SPREADSHEET_ID)
        
        # Get or create Sales sheet
        sales_sheet = None
        worksheets = retry_with_backoff(lambda: tax_spreadsheet.worksheets())
        for sheet in worksheets:
            if sheet.title.lower() == "sales":
                sales_sheet = sheet
                break
        
        if not sales_sheet:
            sales_sheet = retry_with_backoff(tax_spreadsheet.add_worksheet, title="Sales", rows=1000, cols=10)
            # Add header
            retry_with_backoff(sales_sheet.append_row, OUTPUT_COLS)
        
        # Get or create Expenses sheet
        expenses_sheet = None
        worksheets = retry_with_backoff(lambda: tax_spreadsheet.worksheets())
        for sheet in worksheets:
            if sheet.title.lower() == "expenses":
                expenses_sheet = sheet
                break
        
        if not expenses_sheet:
            expenses_sheet = retry_with_backoff(tax_spreadsheet.add_worksheet, title="Expenses", rows=1000, cols=10)
            # Add header
            retry_with_backoff(expenses_sheet.append_row, OUTPUT_COLS)
        
        # Ensure headers exist
        row_count_sales = retry_with_backoff(lambda: sales_sheet.row_count)
        row_count_expenses = retry_with_backoff(lambda: expenses_sheet.row_count)
        if row_count_sales == 0 or row_count_sales == 1:
            retry_with_backoff(sales_sheet.append_row, OUTPUT_COLS)
        if row_count_expenses == 0 or row_count_expenses == 1:
            retry_with_backoff(expenses_sheet.append_row, OUTPUT_COLS)
        
        # Append new rows
        if sales_rows:
            print(f"Writing {len(sales_rows)} sales transactions...")
            retry_with_backoff(sales_sheet.append_rows, sales_rows)
        
        if expenses_rows:
            print(f"Writing {len(expenses_rows)} expense transactions...")
            retry_with_backoff(expenses_sheet.append_rows, expenses_rows)
        
        # Create or update IRS Filing Summary tab
        if main_ledger_sales is not None and main_ledger_expenses is not None:
            print("Compiling IRS Filing Summary...")
            summary_rows = compile_irs_filing_summary(
                client, 
                main_ledger_sales, 
                main_ledger_expenses, 
                liquidity_injections or [],
                all_sales=sales_rows,  # Include all sales to match Monthly Statistics
                all_expenses=expenses_rows  # Include all expenses from all ledgers
            )
            
            # Get or create IRS Filing Summary sheet
            summary_sheet = None
            worksheets = retry_with_backoff(lambda: tax_spreadsheet.worksheets())
            for sheet in worksheets:
                if sheet.title.lower() in ["irs filing summary", "irs summary", "filing summary"]:
                    summary_sheet = sheet
                    break
            
            if not summary_sheet:
                summary_sheet = retry_with_backoff(tax_spreadsheet.add_worksheet, title="IRS Filing Summary", rows=100, cols=5)
            
            # Clear existing content and write new summary
            retry_with_backoff(summary_sheet.clear)
            if summary_rows:
                retry_with_backoff(summary_sheet.append_rows, summary_rows)
            print("✅ IRS Filing Summary updated")
        
        print(f"✅ Successfully wrote data to tax compilation spreadsheet")
        print(f"   Sales: {len(sales_rows)} new rows")
        print(f"   Expenses: {len(expenses_rows)} new rows")
    
    except Exception as e:
        print(f"Error writing to spreadsheet: {e}")
        import traceback
        traceback.print_exc()
        raise


def main():
    """Main execution function."""
    print("=" * 70)
    print("IRS Tax Compilation Script - 2025 Tax Year")
    print("=" * 70)
    print(f"Target Year: {TARGET_YEAR}")
    print(f"EIN Number: {EIN_NUMBER}")
    print(f"File Number: {FILE_NUMBER}")
    print(f"Main Ledger ID: {MAIN_LEDGER_ID}")
    print(f"Tax Compilation Spreadsheet ID: {TAX_COMPILATION_SPREADSHEET_ID}")
    print("=" * 70)
    print()
    
    # Initialize client
    print("Initializing Google Sheets client...")
    client = get_google_client()
    print("✅ Client initialized")
    print()
    
    # Get existing rows to avoid duplicates
    print("Reading existing data from tax compilation spreadsheet...")
    try:
        tax_spreadsheet = retry_with_backoff(client.open_by_key, TAX_COMPILATION_SPREADSHEET_ID)
        
        # Get existing sales
        sales_sheet = None
        worksheets = retry_with_backoff(lambda: tax_spreadsheet.worksheets())
        for sheet in worksheets:
            if sheet.title.lower() == "sales":
                sales_sheet = sheet
                break
        
        existing_sales = get_existing_rows_hash(sales_sheet) if sales_sheet else set()
        
        # Get existing expenses
        expenses_sheet = None
        worksheets = retry_with_backoff(lambda: tax_spreadsheet.worksheets())
        for sheet in worksheets:
            if sheet.title.lower() == "expenses":
                expenses_sheet = sheet
                break
        
        existing_expenses = get_existing_rows_hash(expenses_sheet) if expenses_sheet else set()
        
        print(f"Found {len(existing_sales)} existing sales rows, {len(existing_expenses)} existing expense rows")
    except Exception as e:
        print(f"Warning: Could not read existing data: {e}")
        existing_sales = set()
        existing_expenses = set()
    
    print()
    
    # Collect all transactions
    all_sales = []
    all_expenses = []
    
    # Track main ledger transactions separately for IRS filing summary
    main_ledger_sales = []
    main_ledger_expenses = []
    liquidity_injections = []
    
    # Process main ledger - offchain transactions
    print("Processing Main Ledger - offchain transactions...")
    sales, expenses = process_offchain_transactions(client, existing_sales, existing_expenses)
    all_sales.extend(sales)
    all_expenses.extend(expenses)
    main_ledger_sales.extend(sales)  # Track for IRS summary
    main_ledger_expenses.extend(expenses)  # Track for IRS summary
    print()
    
    # Process main ledger - Ledger History liquidity injections
    print("Processing Main Ledger - Ledger History liquidity injections...")
    sales, expenses = process_ledger_history_liquidity_injections(client, existing_sales, existing_expenses)
    # Note: Liquidity injections are stored as expenses (positive amounts) but are capital contributions
    # We track them separately for the IRS summary
    liquidity_injections.extend(expenses)  # These are capital contributions, not operational expenses
    # Don't add liquidity injections to all_expenses for the summary (they're capital, not expenses)
    # But we still add them to the Expenses tab for record-keeping
    all_expenses.extend(expenses)
    print()
    
    # Process managed ledgers
    print("Fetching managed ledgers...")
    managed_ledgers = get_managed_ledgers(client)
    print()
    
    for ledger_info in managed_ledgers:
        print(f"Processing {ledger_info['name']}...")
        sales, expenses = process_managed_ledger(client, ledger_info, existing_sales, existing_expenses)
        all_sales.extend(sales)
        all_expenses.extend(expenses)
        # Note: Managed ledger transactions are NOT included in IRS filing summary
        print()
    
    # Write to spreadsheet
    if all_sales or all_expenses:
        print("Writing transactions to tax compilation spreadsheet...")
        write_to_sheet(
            client, 
            all_sales, 
            all_expenses,
            main_ledger_sales=main_ledger_sales,
            main_ledger_expenses=main_ledger_expenses,
            liquidity_injections=liquidity_injections,
            all_sales=all_sales,  # Pass all_sales for summary calculation
            all_expenses=all_expenses  # Pass all_expenses for summary calculation
        )
    else:
        print("No new transactions found for 2025.")
    
    print()
    print("=" * 70)
    print("✅ Tax compilation complete!")
    print(f"   Total Sales Transactions: {len(all_sales)}")
    print(f"   Total Expense Transactions: {len(all_expenses)}")
    print("=" * 70)


if __name__ == "__main__":
    main()
