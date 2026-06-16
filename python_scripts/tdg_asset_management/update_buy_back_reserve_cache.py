#!/usr/bin/env python3
"""
update_buy_back_reserve_cache.py

Reads the Accumulated Buy-Back Reserve from the GAS Performance Statistics
endpoint and the offchain transactions sheet, then writes a structured JSON
cache to:

  treasury-cache/buy-back-reserve.json

This cache powers the detail page at truesight.me/buy-back-reserve/.

Usage:
  python3 update_buy_back_reserve_cache.py [--dry-run]

  --dry-run   Print what would be written, don't commit or push.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

import gspread
import requests

# --- Config ---

MAIN_LEDGER_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
OFFCHAIN_BALANCE_SHEET = 'off chain asset balance'
OFFCHAIN_TX_SHEET = 'offchain transactions'

GAS_PERF_STATS_URL = (
    'https://script.google.com/macros/s/'
    'AKfycbyf6DfLvGuVK-Mcw1DBIt37rePnHZTwJjhzqcNZUAvpNpVP3SW32EfTJWgzHygafwT4/exec'
    '?action=getPerformanceStatistics'
)

OUTPUT_DIR = os.path.expanduser('~/Applications/treasury-cache')
REPO_DIR = os.path.expanduser('~/Applications/treasury-cache')

SERVICE_ACCOUNT_PATH = os.path.expanduser(
    '~/Applications/sentiment_importer/config/cypher_defense_gdrive_key.json'
)

# Row label for the buy-back provision in off chain asset balance
PROVISION_LABEL = 'USD - provisions for voting rights cash out'

# Column indices in off chain asset balance (0-based)
BAL_COL_ASSET = 0
BAL_COL_BALANCE = 1
BAL_COL_VALUE = 3

# Column indices in offchain transactions (0-based)
TX_COL_DATE = 0
TX_COL_DESC = 1
TX_COL_HANDLER = 2
TX_COL_AMOUNT = 3
TX_COL_CURRENCY = 4


def find_header_row(worksheet, keywords):
    """Find the data-start row by matching header keywords."""
    rows = worksheet.get_all_values()
    for i, row in enumerate(rows):
        row_text = ' '.join(str(c).lower() for c in row)
        if all(k.lower() in row_text for k in keywords):
            return i
    return 0


def get_reserve_from_gas():
    """Fetch the current buy-back reserve from the GAS Performance Statistics endpoint."""
    try:
        resp = requests.get(GAS_PERF_STATS_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        # The endpoint returns an object with stat keys
        if isinstance(data, dict):
            reserve = data.get('BUY_BACK_RESERVE')
            if reserve is not None:
                return float(reserve)
        return None
    except (requests.RequestException, ValueError, TypeError) as e:
        print(f'Warning: Could not fetch from GAS endpoint: {e}', file=sys.stderr)
        return None


def get_reserve_from_sheet(gc):
    """Fallback: read the buy-back provision directly from the off chain asset balance sheet."""
    main = gc.open_by_key(MAIN_LEDGER_ID)
    ws = main.worksheet(OFFCHAIN_BALANCE_SHEET)
    rows = ws.get_all_values()

    header_row = find_header_row(ws, ['asset', 'balance', 'value'])
    if header_row == 0:
        header_row = 3  # known header row for this sheet

    for row in rows[header_row + 1:]:
        if len(row) <= max(BAL_COL_ASSET, BAL_COL_VALUE):
            continue
        asset_name = row[BAL_COL_ASSET].strip() if len(row) > BAL_COL_ASSET else ''
        if asset_name == PROVISION_LABEL:
            value_str = row[BAL_COL_VALUE].strip() if len(row) > BAL_COL_VALUE else '0'
            try:
                return float(value_str.replace(',', '').replace('$', '').strip())
            except ValueError:
                return 0.0

    return 0.0


def get_daily_provisions(gc):
    """Extract daily buy-back provision transactions from the offchain transactions sheet.
    
    Looks for transactions with description containing 'buy-back' or 'provision'
    and currency = 'USD'.
    """
    main = gc.open_by_key(MAIN_LEDGER_ID)
    ws = main.worksheet(OFFCHAIN_TX_SHEET)
    rows = ws.get_all_values()

    header_row = find_header_row(ws, ['transaction date', 'description', 'amount'])
    if header_row == 0:
        header_row = 3  # known header row

    provisions = []
    for row in rows[header_row + 1:]:
        if len(row) <= max(TX_COL_DATE, TX_COL_CURRENCY):
            continue

        date_val = row[TX_COL_DATE].strip() if len(row) > TX_COL_DATE else ''
        desc = row[TX_COL_DESC].strip() if len(row) > TX_COL_DESC else ''
        amount_str = row[TX_COL_AMOUNT].strip() if len(row) > TX_COL_AMOUNT else ''
        currency = row[TX_COL_CURRENCY].strip().upper() if len(row) > TX_COL_CURRENCY else ''

        if not date_val or not amount_str:
            continue
        if currency and currency != 'USD':
            continue

        # Check if this is a buy-back provision entry
        desc_lower = desc.lower()
        if 'buy-back' in desc_lower or 'buyback' in desc_lower or 'provision' in desc_lower:
            try:
                amount = float(amount_str.replace(',', '').replace('$', '').strip())
            except ValueError:
                continue

            provisions.append({
                'date': date_val,
                'description': desc.split('\n')[0],  # first line only
                'amount': round(amount, 2),
            })

    # Sort by date ascending
    provisions.sort(key=lambda x: x['date'])
    return provisions


def build_cache_json(reserve_total, daily_provisions, dry_run=False):
    """Build the structured cache JSON."""
    total_from_provisions = sum(p['amount'] for p in daily_provisions if p['amount'] > 0)

    return {
        'schema_version': 1,
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'update_buy_back_reserve_cache.py',
        'reserve': {
            'total_usd': round(reserve_total, 2),
            'label': 'Accumulated Buy-Back Reserve',
            'description': (
                'Total USD provisions set aside for buy-back and voting rights cash-out. '
                'Funded by daily allocations from DAO treasury revenue.'
            ),
        },
        'daily_buy_back_budget': None,  # populated from GAS endpoint
        'summary': {
            'total_provisions_count': len(daily_provisions),
            'total_provisions_amount': round(total_from_provisions, 2),
        },
        'provisions': daily_provisions,
    }


def write_cache(data, dry_run=False):
    """Write the cache JSON to file."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filepath = os.path.join(OUTPUT_DIR, 'buy-back-reserve.json')

    if dry_run:
        print(f'  [dry-run] Would write {filepath}')
        print(f'  Reserve: ${data["reserve"]["total_usd"]} USD')
        print(f'  Provisions: {len(data["provisions"])} entries')
        return

    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'  Wrote {filepath}')
    print(f'  Reserve: ${data["reserve"]["total_usd"]} USD')
    print(f'  Provisions: {len(data["provisions"])} entries')


def commit_and_push(dry_run=False):
    """Commit and push the updated cache to the treasury-cache repo."""
    if dry_run:
        print('  [dry-run] Would commit and push to treasury-cache')
        return

    os.chdir(REPO_DIR)

    # Check if there are changes
    result = subprocess.run(
        ['git', 'status', '--porcelain'],
        capture_output=True, text=True
    )
    if not result.stdout.strip():
        print('  No changes to commit.')
        return

    subprocess.run(['git', 'add', 'buy-back-reserve.json'], check=True)
    subprocess.run(
        ['git', 'commit', '-m', f'Update buy-back-reserve cache [{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}]'],
        check=True
    )
    subprocess.run(['git', 'push'], check=True)
    print('  Committed and pushed to treasury-cache.')


def main():
    dry_run = '--dry-run' in sys.argv

    print('Updating buy-back reserve cache...')
    if dry_run:
        print('  [DRY RUN MODE]')

    # Try GAS endpoint first, fall back to sheet
    reserve = get_reserve_from_gas()

    if reserve is None:
        print('  GAS endpoint unavailable, reading from sheet directly...')
        gc = gspread.service_account(filename=SERVICE_ACCOUNT_PATH)
        reserve = get_reserve_from_sheet(gc)
    else:
        print(f'  Fetched reserve from GAS: ${reserve:.2f}')
        gc = gspread.service_account(filename=SERVICE_ACCOUNT_PATH)

    # Get daily provisions from sheet
    print('  Reading daily provisions from offchain transactions...')
    provisions = get_daily_provisions(gc)
    print(f'  Found {len(provisions)} provision entries')

    # Build and write cache
    cache = build_cache_json(reserve, provisions, dry_run)

    # Also fetch the daily buy-back budget from GAS
    try:
        resp = requests.get(GAS_PERF_STATS_URL, timeout=30)
        if resp.ok:
            data = resp.json()
            if isinstance(data, dict):
                budget = data.get('TDG_DAILY_BUY_BACK_BUDGET')
                if budget is not None:
                    cache['daily_buy_back_budget'] = float(budget)
    except (requests.RequestException, ValueError):
        pass

    write_cache(cache, dry_run)

    if not dry_run:
        commit_and_push()

    print('Done.')


if __name__ == '__main__':
    main()
