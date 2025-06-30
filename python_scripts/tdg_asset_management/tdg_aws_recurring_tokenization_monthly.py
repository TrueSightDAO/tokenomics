import boto3
import json
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build
import base64
import argparse
from dateutil import relativedelta

# Load environment variables from .env file (for local execution)
load_dotenv()

# Google Sheets configuration
# SANDBOX
# SPREADSHEET_ID = '1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo'

# PRODUCTION
# SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'


RECURRING_SHEET_NAME = 'Recurring Transactions'
LEDGER_SHEET_NAME = 'Ledger history'
RECURRING_RANGE_NAME = f'{RECURRING_SHEET_NAME}!A:Z'  # Adjust range as needed
LEDGER_RANGE_NAME = f'{LEDGER_SHEET_NAME}!A:H'  # Adjust range for Ledger history
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']  # Updated for read/write access

def get_google_sheets_service():
    # Load Google service account credentials
    google_credentials_base64 = os.getenv('GOOGLE_CREDENTIALS')
    if not google_credentials_base64:
        raise ValueError("GOOGLE_CREDENTIALS not found in environment variables")

    # Decode base64-encoded credentials (used in GitHub Secrets)
    try:
        credentials_json = base64.b64decode(google_credentials_base64).decode('utf-8')
        credentials_dict = json.loads(credentials_json)
    except (base64.binascii.Error, json.JSONDecodeError):
        # Fallback for local .env file (non-base64 JSON string)
        credentials_dict = json.loads(google_credentials_base64)

    credentials = service_account.Credentials.from_service_account_info(
        credentials_dict, scopes=SCOPES)
    service = build('sheets', 'v4', credentials=credentials)
    return service

def get_recurring_records_from_ledger():
    try:
        service = get_google_sheets_service()
        sheet = service.spreadsheets()
        result = sheet.values().get(spreadsheetId=SPREADSHEET_ID, range=RECURRING_RANGE_NAME).execute()
        values = result.get('values', [])
        
        if not values:
            print("No data found in Recurring Transactions sheet.")
            return []

        # Filter rows where Column A (index 0) contains "Edgar AWS"
        edgar_records = []
        for row in values:
            if row and 'Edgar AWS' in row[0].strip():
                start_date = None
                signature = None
                contributor_name = None
                # Get start date from Column F (index 5)
                if len(row) > 5 and row[5].strip():
                    try:
                        start_date = datetime.strptime(row[5].strip(), '%Y%m%d')
                    except ValueError:
                        print(f"Invalid date format in Column F for row: {row}. Using default start date.")
                # Get signature from Column H (index 7)
                if len(row) > 7 and row[7].strip():
                    signature = row[7].strip()
                # Get contributor_name from Column B (index 1)
                if len(row) > 1 and row[1].strip():
                    contributor_name = row[1].strip()
                edgar_records.append({
                    'row': row,
                    'start_date': start_date,
                    'signature': signature,
                    'contributor_name': contributor_name
                })
        
        print("\nRecords with Edgar AWS in Column A:")
        for i, record in enumerate(edgar_records, 1):
            start_date_str = record['start_date'].strftime('%Y%m%d') if record['start_date'] else 'None'
            print(f"Record {i}: {record['row']}, Start Date: {start_date_str}, Signature: {record['signature'] or 'None'}, contributor_name: {record['contributor_name'] or 'None'}")
        
        # Save to file
        with open('edgar_records.json', 'w') as f:
            json.dump([record['row'] for record in edgar_records], f, indent=2)
        
        return edgar_records
    except Exception as e:
        print(f"Error reading Recurring Transactions sheet: {e}")
        return []

def transactionRecordExist(service, contributor_name, description, end_date_str):
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=LEDGER_RANGE_NAME
        ).execute()
        values = result.get('values', [])
        
        if not values:
            print("No data found in Ledger history sheet.")
            return False

        # Check for matching record
        for row in values:
            if len(row) < 8:
                continue
            ledger_contributor_name = row[0].strip() if row[0] else ''
            ledger_description = row[2].strip() if row[2] else ''
            ledger_date = row[7].strip() if row[7] else ''
            if (ledger_contributor_name == contributor_name and
                ledger_description == description and
                ledger_date == end_date_str):
                print(f"Matching transaction found in Ledger history for contributor_name: {contributor_name}, description: {ledger_description}, date: {end_date_str}")
                return True
        return False
    except Exception as e:
        print(f"Error checking Ledger history: {e}")
        return False

def insertTransaction(service, contributor_name, description, amount, end_date_str):
    try:
        values = [[
            contributor_name,  # Column A: Recurring Transactions Column B
            'Recurring Tokenizations',  # Column B
            description,  # Column C: Recurring Transactions Column A
            '1TDG For every 1 USD of liquidity injected',  # Column D
            f"{amount:.2f}",  # Column E: Amount billed
            'Successfully Completed / Full Provision Awarded',  # Column F
            f"{amount:.2f}",  # Column G: Amount billed
            end_date_str  # Column H: Billing period end date
        ]]
        body = {'values': values}
        result = service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range=LEDGER_RANGE_NAME,
            valueInputOption='RAW',
            insertDataOption='INSERT_ROWS',
            body=body
        ).execute()
        print(f"Inserted transaction for contributor_name: {contributor_name}, contribution_description: {description}, amount: {amount:.2f}, end date: {end_date_str}")
        return True
    except Exception as e:
        print(f"Error inserting transaction to Ledger history: {e}")
        return False

def update_start_date(service, row_index):
    try:
        today_str = datetime.utcnow().strftime('%Y%m%d')
        body = {
            'range': f'{RECURRING_SHEET_NAME}!F{row_index + 1}',
            'values': [[today_str]]
        }
        service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=body['range'],
            valueInputOption='RAW',
            body=body
        ).execute()
        print(f"Updated Column F of row {row_index + 1} with current date {today_str}")
    except Exception as e:
        print(f"Error updating start date: {e}")


def get_latest_aws_charges(access_key, secret_key, account_name, start_date):
    # Initialize Cost Explorer client with specific credentials
    client = boto3.client(
        'ce',
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name='us-east-1'
    )

    # Determine billing cycle
    current_date = datetime.utcnow().date()
    # Most recent completed billing cycle (last day of previous month)
    last_completed_month = current_date.replace(day=1) - timedelta(days=1)
    default_start_date = last_completed_month.replace(day=1)

    # Validate and adjust start_date to the first day of the month
    if start_date:
        try:
            # Convert start_date to date for comparison
            start_date = start_date.date()
            # Ensure start_date is not in the future or current month
            if start_date > current_date:
                print(f"Skipping {account_name}: Start date {start_date.strftime('%Y%m%d')} is in the future.")
                return None
            if start_date.year == current_date.year and start_date.month == current_date.month:
                print(f"Skipping {account_name}: Start date {start_date.strftime('%Y%m%d')} is in the current incomplete month.")
                return None
            # Adjust start_date to the first day of its month
            start_date = start_date.replace(day=1)
        except ValueError:
            print(f"Invalid start date for {account_name}. Using default start date.")
            start_date = default_start_date
    else:
        start_date = default_start_date

    # Generate list of complete months to query
    months_to_query = []
    current_month = start_date
    while current_month <= last_completed_month:
        end_date = (current_month + relativedelta.relativedelta(months=1, days=-1))
        if end_date > last_completed_month:
            end_date = last_completed_month
        months_to_query.append((current_month, end_date))
        current_month = current_month + relativedelta.relativedelta(months=1)

    if not months_to_query:
        print(f"No complete months to query for {account_name}.")
        return None

    # Query Cost Explorer for each month
    all_results = []
    total_cost_all_months = 0.0
    for month_start, month_end in months_to_query:
        try:
            response = client.get_cost_and_usage(
                TimePeriod={
                    'Start': month_start.strftime('%Y-%m-%d'),
                    'End': month_end.strftime('%Y-%m-%d')
                },
                Granularity='MONTHLY',
                Metrics=['UnblendedCost'],
                GroupBy=[
                    {
                        'Type': 'DIMENSION',
                        'Key': 'SERVICE'
                    }
                ]
            )

            # Process results for the month
            results = response.get('ResultsByTime', [])
            if not results:
                print(f"No cost data found for {account_name} (Period: {month_start.strftime('%Y%m%d')} to {month_end.strftime('%Y%m%d')}).")
                continue

            # Calculate total cost for the period
            total_cost = 0.0
            print(f"\n\n")
            for result in results:
                for group in result['Groups']:
                    service_name = group['Keys'][0]
                    cost = float(group['Metrics']['UnblendedCost']['Amount'])
                    print(f"  Service: {service_name}, Cost: {cost:.2f} USD")  # <-- Debug line
                    total_cost += cost
                total_cost_all_months += total_cost

            print(f"Costs for {account_name} (Period: {month_start.strftime('%Y%m%d')} to {month_end.strftime('%Y%m%d')}): {total_cost:.2f} USD")
            
            all_results.append({
                'period': {
                    'start': month_start.strftime('%Y%m%d'),
                    'end': month_end.strftime('%Y%m%d')
                },
                'total_cost': total_cost
            })

        except client.exceptions.ClientError as e:
            print(f"Error querying {account_name} for period {month_start.strftime('%Y%m%d')} to {month_end.strftime('%Y%m%d')}: {e}")
            continue

    if not all_results:
        print(f"No valid cost data retrieved for {account_name}.")
        return None

    print(f"\n\nGrand Total Cost for {account_name} across all periods: {total_cost_all_months:.2f} USD\n\n\n\n")

    # Save results to a file with period info
    output_data = {
        'account_name': account_name,
        'periods': all_results,
        'grand_total_cost': total_cost_all_months
    }
    with open(f'aws_costs_{account_name}.json', 'w') as f:
        json.dump(output_data, f, indent=2)

    return all_results

def main():
    parser = argparse.ArgumentParser(description='Fetch AWS costs or Google Sheet records.')
    subparsers = parser.add_subparsers(dest='command', help='Command to execute')

    # Subparser for AWS charges
    aws_parser = subparsers.add_parser('aws', help='Fetch AWS Cost Explorer charges')

    # Subparser for Google Sheets
    sheets_parser = subparsers.add_parser('sheets', help='Fetch Edgar records from Google Sheet')

    # Subparser for processing AWS charges and inserting transactions
    aws_process_parser = subparsers.add_parser('aws_process', help='Fetch AWS charges and insert transactions into Ledger history')

    args = parser.parse_args()

    if args.command == 'aws':
        # Fetch Google Sheet records
        edgar_records = get_recurring_records_from_ledger()
        if not edgar_records:
            print("No Edgar AWS records found. Exiting.")
            exit(1)

        # Process each record with a valid signature
        for record in edgar_records:
            signature = record['signature']
            start_date = record['start_date']
            if not signature:
                print(f"Skipping record with missing signature: {record['row']}")
                continue

            # Get AWS credentials for the signature
            access_key = os.getenv(f'AWS_ACCESS_KEY_ID_{signature}')
            secret_key = os.getenv(f'AWS_SECRET_ACCESS_KEY_{signature}')
            if not all([access_key, secret_key]):
                print(f"Error: Missing AWS credentials for signature {signature}")
                continue

            # Query AWS costs with the start date from Column F
            get_latest_aws_charges(access_key, secret_key, signature, start_date)

    elif args.command == 'sheets':
        get_recurring_records_from_ledger()

    elif args.command == 'aws_process':
        # Fetch Google Sheet service
        service = get_google_sheets_service()
        
        # Fetch Google Sheet records
        edgar_records = get_recurring_records_from_ledger()
        if not edgar_records:
            print("No Edgar AWS records found. Exiting.")
            exit(1)

        # Process each record with a valid signature
        for record in edgar_records:
            signature = record['signature']
            start_date = record['start_date']
            contributor_name = record['contributor_name']
            name = record['row'][0].strip() if record['row'][0] else 'Edgar AWS'
            if not signature:
                print(f"Skipping record with missing signature: {record['row']}")
                continue
            if not contributor_name:
                print(f"Skipping record with missing contributor_name: {record['row']}")
                continue

            # Get AWS credentials for the signature
            access_key = os.getenv(f'AWS_ACCESS_KEY_ID_{signature}')
            secret_key = os.getenv(f'AWS_SECRET_ACCESS_KEY_{signature}')
            if not all([access_key, secret_key]):
                print(f"Error: Missing AWS credentials for signature {signature}")
                continue

            # Query AWS costs
            results = get_latest_aws_charges(access_key, secret_key, signature, start_date)
            if not results:
                print(f"No valid cost data for {signature}. Skipping transaction insertion.")
                continue

            # Check and insert transactions
            for result in results:
                start_date_str = result['period']['start']
                end_date_str = result['period']['end']
                total_cost = result['total_cost']
                description = name + "\n\nperiod " + start_date_str + " - " + end_date_str
                # Check if transaction exists in Ledger history
                if not transactionRecordExist(service, contributor_name, description, end_date_str):
                    # Insert new transaction
                    insertTransaction(service, contributor_name, description, total_cost, end_date_str)
                    row_index = edgar_records.index(record) + 4
                    update_start_date(service, row_index)
                else:
                    print(f"Transaction already exists for {signature} for period ending {end_date_str}. Skipping insertion.")

    else:
        parser.print_help()
        exit(1)

if __name__ == '__main__':
    main()