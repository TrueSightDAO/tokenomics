#!/usr/bin/env python3
"""
snapshot_managed_ledgers.py

Reads the Shipment Ledger Listing from the Main Ledger Google Sheet,
exports every active ledger's Transactions tab to:

  treasury-cache/managed-ledgers/<Ledger ID>.json

Skips ledgers with Status = COMPLETED or SUSPENDED.

Usage:
  python3 snapshot_managed_ledgers.py [--dry-run] [--ledger TBM]

  --dry-run   Print what would be written, don't commit or push.
  --ledger ID Export only a single ledger (e.g. TBM).
"""

import json, os, re, subprocess, sys
from datetime import datetime, timezone
from collections import defaultdict

import gspread

# --- Config ---

MAIN_LEDGER_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
LISTING_SHEET = 'Shipment Ledger Listing'
OUTPUT_DIR = os.path.expanduser('~/Applications/treasury-cache/managed-ledgers')
REPO_DIR = os.path.expanduser('~/Applications/treasury-cache')

SERVICE_ACCOUNT_PATH = os.path.expanduser(
    '~/Applications/sentiment_importer/config/cypher_defense_gdrive_key.json'
)

SKIP_STATUSES = {'COMPLETED', 'SUSPENDED'}

# Column indices in Shipment Ledger Listing (0-based)
COL_LEDGER_ID = 0
COL_STATUS = 2
COL_DESCRIPTION = 3
COL_TRANSACTION_TYPE = 7
COL_LEDGER_URL = 11
COL_RESOLVED_URL = 27
COL_PROGRAM = 28  # AC — program family rollup for truesight.me page topology
                  # (agroverse / sunmint / fundraiser); higher-level bucket
                  # than Transaction Type. Backfilled 2026-05-10 via Sheets API
                  # (14 agroverse, 2 sunmint, 1 fundraiser).

# Column indices in Transactions tab (0-based)
TX_COL_DATE = 0
TX_COL_DESCRIPTION = 1
TX_COL_ENTITY = 2
TX_COL_AMOUNT = 3
TX_COL_CURRENCY = 4
TX_COL_TYPE = 5


def find_row_by_header(worksheet, target_headers):
    """Find the data-start row by matching header keywords."""
    rows = worksheet.get_all_values()
    for i, row in enumerate(rows):
        row_text = ' '.join(str(c).lower() for c in row)
        if all(h.lower() in row_text for h in target_headers):
            return i  # 0-indexed
    return 0


def extract_transactions(worksheet):
    """Extract transaction rows from a ledger's Transactions tab."""
    header_row = find_row_by_header(worksheet, ['date', 'description', 'amount', 'currency'])
    if header_row == 0:
        return []

    all_rows = worksheet.get_all_values()
    txs = []

    for row in all_rows[header_row + 1:]:
        if len(row) <= max(TX_COL_DATE, TX_COL_AMOUNT):
            continue
        date_val = row[TX_COL_DATE].strip() if len(row) > TX_COL_DATE else ''
        amount_val = row[TX_COL_AMOUNT].strip() if len(row) > TX_COL_AMOUNT else ''
        if not date_val or not amount_val:
            continue

        try:
            amount = float(amount_val.replace(',', '').replace('$', '').replace('R$', '').strip())
        except ValueError:
            amount = 0

        currency = (row[TX_COL_CURRENCY].strip() or 'USD').upper() if len(row) > TX_COL_CURRENCY else 'USD'
        tx_type = row[TX_COL_TYPE].strip() if len(row) > TX_COL_TYPE else ''

        txs.append({
            'date': date_val,
            'description': row[TX_COL_DESCRIPTION].strip() if len(row) > TX_COL_DESCRIPTION else '',
            'entity': row[TX_COL_ENTITY].strip() if len(row) > TX_COL_ENTITY else '',
            'amount': amount,
            'currency': currency,
            'type': tx_type,
        })

    return txs


def build_ledger_json(ledger_id, ledger_info, transactions):
    """Build the JSON object for a single ledger."""
    total_amount = sum(tx['amount'] for tx in transactions if tx['amount'] > 0)

    # Group by currency
    by_currency = defaultdict(lambda: {'count': 0, 'total': 0})
    for tx in transactions:
        c = tx['currency']
        by_currency[c]['count'] += 1
        by_currency[c]['total'] += tx['amount']

    return {
        'ledger_name': ledger_id,
        'program_name': ledger_info.get('description', ''),
        'description': ledger_info.get('description', ''),
        # `program` is the program-family rollup (agroverse / sunmint / fundraiser)
        # from Shipment Ledger Listing col AC. Lets downstream pages
        # (truesight.me/fundraisers.html etc.) filter without needing the
        # underlying Transaction Type taxonomy.
        'program': ledger_info.get('program', ''),
        'schema_version': 1,
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'snapshot_managed_ledgers.py',
        'status': ledger_info.get('status', ''),
        'summary': {
            'total_transactions': len(transactions),
            'total_amount': round(total_amount, 2),
            'by_currency': {c: {'count': d['count'], 'total': round(d['total'], 2)}
                           for c, d in sorted(by_currency.items())},
        },
        'transactions': transactions,
    }


def load_ledger_listing(gc):
    """Load all active ledgers from Shipment Ledger Listing."""
    main = gc.open_by_key(MAIN_LEDGER_ID)
    listing = main.worksheet(LISTING_SHEET)
    rows = listing.get_all_values()

    ledgers = []
    for row in rows[1:]:  # skip header
        ledger_id = (row[COL_LEDGER_ID] if len(row) > COL_LEDGER_ID else '').strip()
        if not ledger_id:
            break  # first empty Ledger ID = end of list

        status = (row[COL_STATUS] if len(row) > COL_STATUS else '').strip().upper()
        if not status:
            status = 'ACTIVE'

        resolved_url = (row[COL_RESOLVED_URL] if len(row) > COL_RESOLVED_URL else '').strip()

        ledgers.append({
            'id': ledger_id,
            'status': status,
            'description': (row[COL_DESCRIPTION] if len(row) > COL_DESCRIPTION else '').strip(),
            'ledger_url': (row[COL_LEDGER_URL] if len(row) > COL_LEDGER_URL else '').strip(),
            'resolved_url': resolved_url,
            'program': (row[COL_PROGRAM] if len(row) > COL_PROGRAM else '').strip().lower(),
        })

    return ledgers


def resolve_ledger(spreadsheet_url_or_id):
    """Extract spreadsheet ID from various URL formats."""
    if not spreadsheet_url_or_id:
        return None
    m = re.search(r'/d/([a-zA-Z0-9_-]+)', spreadsheet_url_or_id)
    if m:
        return m.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{20,}$', spreadsheet_url_or_id):
        return spreadsheet_url_or_id
    return None


def write_json(ledger_id, data, dry_run=False):
    """Write a single ledger's JSON to file."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filepath = os.path.join(OUTPUT_DIR, f'{ledger_id}.json')

    if dry_run:
        print(f'  [dry-run] Would write {filepath} ({len(data["transactions"])} txs)')
        return

    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'  Wrote {filepath} ({len(data["transactions"])} txs)')


def write_index(all_ledgers, dry_run=False):
    """Write the registry index — one fetch lets a consumer (e.g.
    truesight.me/fundraisers.html, agroverse.html, sunmint.html) discover
    every active ledger and filter by program without N round-trips.

    Schema:
      {
        "schema_version": 1,
        "generated_at": "<ISO timestamp>",
        "source": "snapshot_managed_ledgers.py",
        "ledgers": [
          {
            "ledger_id": "TBM",
            "program": "fundraiser",
            "status": "ACTIVE",
            "description": "<from Shipment Ledger Listing col D>",
            "ledger_url": "<from col L (raw, may be a redirect)>",
            "snapshot_url": "https://raw.githubusercontent.com/TrueSightDAO/treasury-cache/main/managed-ledgers/TBM.json",
            "summary": { ... }  // mirrors the per-ledger summary
          },
          ...
        ]
      }
    """
    index_path = os.path.join(OUTPUT_DIR, '_index.json')

    SNAPSHOT_BASE = 'https://raw.githubusercontent.com/TrueSightDAO/treasury-cache/main/managed-ledgers'
    entries = []
    for entry in all_ledgers:
        entries.append({
            'ledger_id': entry['ledger_id'],
            'program': entry.get('program', ''),
            'status': entry.get('status', ''),
            'description': entry.get('description', ''),
            'ledger_url': entry.get('ledger_url', ''),
            'snapshot_url': f"{SNAPSHOT_BASE}/{entry['ledger_id']}.json",
            'summary': entry.get('summary', {}),
        })

    payload = {
        'schema_version': 1,
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'snapshot_managed_ledgers.py',
        'ledgers': entries,
    }

    if dry_run:
        print(f'  [dry-run] Would write {index_path} ({len(entries)} ledgers)')
        return

    with open(index_path, 'w') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f'  Wrote {index_path} ({len(entries)} ledgers)')


def git_commit_and_push(dry_run=False):
    """Commit and push changes to the treasury-cache repo."""
    if dry_run:
        print('[dry-run] Would git add/commit/push')
        return

    import subprocess
    try:
        subprocess.run(['git', '-C', REPO_DIR, 'add', 'managed-ledgers/'], check=True)
        status = subprocess.run(
            ['git', '-C', REPO_DIR, 'diff', '--cached', '--quiet'],
            capture_output=True
        )
        if status.returncode == 0:
            print('No changes to commit.')
            return

        subprocess.run(
            ['git', '-C', REPO_DIR, 'commit', '-m',
             f'chore: snapshot managed ledgers {datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")}'],
            check=True
        )
        subprocess.run(['git', '-C', REPO_DIR, 'push', 'origin', 'main'], check=True)
        print('Pushed to origin/main.')
    except subprocess.CalledProcessError as e:
        print(f'Git error: {e}')


def main():
    dry_run = '--dry-run' in sys.argv
    single_ledger = None
    for i, arg in enumerate(sys.argv):
        if arg == '--ledger' and i + 1 < len(sys.argv):
            single_ledger = sys.argv[i + 1].upper()

    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f'Service account key not found: {SERVICE_ACCOUNT_PATH}')
        sys.exit(1)

    gc = gspread.service_account(SERVICE_ACCOUNT_PATH)
    ledgers = load_ledger_listing(gc)

    print(f'Found {len(ledgers)} ledgers in Shipment Ledger Listing')
    exported = 0
    index_entries = []

    for ledger in ledgers:
        lid = ledger['id']
        status = ledger['status']
        resolved = ledger['resolved_url']

        if single_ledger and lid != single_ledger:
            continue

        if status.upper() in SKIP_STATUSES:
            print(f'  {lid}: SKIP (status={status})')
            continue

        sheet_id = resolve_ledger(resolved)
        if not sheet_id:
            print(f'  {lid}: SKIP (no resolved URL)')
            continue

        try:
            sheet = gc.open_by_key(sheet_id)
            # Find Transactions tab
            tx_tab = None
            for t in sheet.worksheets():
                if t.title == 'Transactions':
                    tx_tab = t
                    break

            if not tx_tab:
                print(f'  {lid}: SKIP (no Transactions tab)')
                continue

            transactions = extract_transactions(tx_tab)
            data = build_ledger_json(lid, ledger, transactions)
            write_json(lid, data, dry_run=dry_run)
            exported += 1

            # Track for the registry index — one row per successfully-snapshotted
            # ledger so consumers can do "GET _index.json | filter program=fundraiser"
            # without N round-trips.
            index_entries.append({
                'ledger_id': lid,
                'program': ledger.get('program', ''),
                'status': ledger.get('status', ''),
                'description': ledger.get('description', ''),
                'ledger_url': ledger.get('ledger_url', ''),
                'summary': data.get('summary', {}),
            })

        except Exception as e:
            print(f'  {lid}: ERROR — {e}')

    if exported > 0:
        # Skip --ledger single-runs from index regeneration (would shrink the
        # index to a single entry and lose the others).
        if not single_ledger:
            write_index(index_entries, dry_run=dry_run)
        else:
            print(f'  (skipping _index.json regen — single-ledger run for {single_ledger})')
        git_commit_and_push(dry_run=dry_run)
    else:
        print('No ledgers exported.')


if __name__ == '__main__':
    main()
