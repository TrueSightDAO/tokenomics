#!/usr/bin/env python3
"""
publish_monthly_statistics_cache.py

Publishes the Monthly Statistics sheet as a static JSON cache to
TrueSightDAO/treasury-cache/monthly-statistics.json, so the monthly chart stops
calling the Google Apps Script web app on every page load.

Why this exists
---------------
?type=monthly on the tdg_wix_dashboard web app reads the "Monthly Statistics"
tab and rebuilds the payload on every request. That makes the public chart
dependent on a live Apps Script execution (slow, quota-bound, and it silently
returned $0 for October 2026 when the sheet's DATE-formatted cells broke the
offchain coercion -- see tokenomics #588/#589/#590/#592). Serving a cached
snapshot from raw.githubusercontent.com removes Apps Script from the read path
entirely.

Payload contract (byte-compatible with ?type=monthly)
------------------------------------------------------
    {
      "schema_version": 1,
      "generated_at": "<ISO-8601 Z>",
      "source": "publish_monthly_statistics_cache.py",
      "upstream": "<the Apps Script URL this mirrors>",
      "timestamp": "<ISO-8601 Z>",      # mirrors GAS `timestamp`
      "data": [
        {"month": "2026-10", "monthlySales": 137.0, "cumulativeSales": 18621.34,
         "aum": 35152.64, "usdTreasuryBalance": 15499.60,
         "lastUpdated": "2026-10-21T01:07:46.309Z"},
        ...
      ]
    }

`timestamp` and `data` are deliberately identical in name and shape to the live
Apps Script response, so a consumer can point at either URL without a code
change; the extra keys (schema_version, generated_at, source, upstream) are
additive.

Row semantics mirror readMonthlyStatistics() in tdg_wix_dashboard.js exactly:
  A -> month              (str, stripped; the row is skipped when blank)
  B -> monthlySales       (float; 0 when blank)
  C -> cumulativeSales    (float; 0 when blank)
  D -> lastUpdated        (ISO-8601 when a date, else passed through verbatim)
  E -> aum                (float, or null when blank)
  F -> usdTreasuryBalance (float, or null when blank)
Rows are sorted by month ascending (localeCompare equivalent).

Column A arrives as text, but column D arrives as a *bare serial number*; a
serial is only an instant relative to a timezone, so it is interpreted in the
spreadsheet's own timeZone (fetched, not assumed) and emitted as UTC ISO-8601.
That reproduces Apps Script's `Date.toISOString()` byte for byte.

Safety
------
`validate()` runs before anything is published and refuses on any defect, so a
sheet edit that leaves a half-written row can never corrupt the public cache.

Credentials / publishing
------------------------
Reuses the publish layer in sibling snapshot_managed_ledgers.py: the GitHub
Contents API when TREASURY_CACHE_TOKEN / GITHUB_TOKEN is set (CI), else nothing
(the runner has no clone, so a missing token is a hard failure rather than a
silent no-op).
"""

import argparse
import datetime as _dt
import json
import os
import re
import sys

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - py<3.9
    ZoneInfo = None

MAIN_LEDGER_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'
SHEET_NAME = 'Monthly Statistics'

#: Repo-relative path of the published cache inside TrueSightDAO/treasury-cache.
CACHE_PATH = 'monthly-statistics.json'

#: The Apps Script deployment this cache mirrors (v26, the fixed build).
UPSTREAM_URL = (
    'https://script.google.com/macros/s/'
    'AKfycbzlfOBo9UqKOh7jIqGcmbPAMM1RxCbsJHb-UV_vM6VbvK_HSdT44KyGbbXIeo-_Ovfy'
    '/exec?type=monthly'
)

SCHEMA_VERSION = 1

SERVICE_ACCOUNT_PATH = os.path.expanduser(os.environ.get(
    'MONTHLY_STATS_CREDS_PATH',
    os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or
    '~/Applications/sentiment_importer/config/cypher_defense_gdrive_key.json'
))

MONTH_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')

#: Google Sheets epoch: serial 0 == 1899-12-30.
_SHEETS_EPOCH = _dt.datetime(1899, 12, 30, tzinfo=_dt.timezone.utc)

ROW_KEYS = ('month', 'monthlySales', 'cumulativeSales', 'aum',
            'usdTreasuryBalance', 'lastUpdated')


class ValidationError(Exception):
    """Raised when the sheet cannot be published safely."""


# --- Value coercion -------------------------------------------------------

def _is_blank(v):
    return v is None or (isinstance(v, str) and v.strip() == '')


def _num(v, default=None):
    """Coerce a sheet cell to float, or `default` when blank/unparseable."""
    if _is_blank(v):
        return default
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip().replace(',', ''))
    except (TypeError, ValueError):
        return default


def _serial_to_iso(serial, tz):
    """Convert a Sheets serial number to an ISO-8601 UTC string.

    A serial is a bare count of days since 1899-12-30 with no timezone of its
    own; Sheets renders it in the spreadsheet's timezone, and Apps Script's
    getValues() yields a Date for that same wall-clock instant. Interpreting in
    `tz` and converting to UTC reproduces `Date.toISOString()` exactly.
    """
    moment = _SHEETS_EPOCH + _dt.timedelta(days=float(serial))
    if tz is not None:
        # Re-anchor: the serial denotes wall-clock time in `tz`, not UTC.
        moment = moment.replace(tzinfo=None).replace(tzinfo=tz).astimezone(
            _dt.timezone.utc)
    return moment.strftime('%Y-%m-%dT%H:%M:%S.') + \
        '%03dZ' % (moment.microsecond // 1000)


def _last_updated_iso(cell, tz):
    """Mirror GAS: a date becomes ISO-8601, anything else passes through."""
    if _is_blank(cell):
        return None
    if isinstance(cell, (int, float)) and not isinstance(cell, bool):
        return _serial_to_iso(cell, tz)
    return str(cell).strip()


def build_rows(values, tz=None):
    """Turn raw A:F sheet rows into cache rows, mirroring readMonthlyStatistics."""
    rows = []
    for raw in values:
        if not raw:
            continue
        padded = list(raw) + [None] * (6 - len(raw))
        month_cell = padded[0]
        if _is_blank(month_cell):
            continue  # GAS: `if (month)`
        rows.append({
            'month': str(month_cell).strip(),
            'monthlySales': _num(padded[1], 0.0),
            'cumulativeSales': _num(padded[2], 0.0),
            'aum': _num(padded[4], None),
            'usdTreasuryBalance': _num(padded[5], None),
            'lastUpdated': _last_updated_iso(padded[3], tz),
        })
    rows.sort(key=lambda r: r['month'])
    return rows


# --- Validation -----------------------------------------------------------

def validate(rows):
    """Refuse to publish a cache that a consumer could not render."""
    if not rows:
        raise ValidationError('no data rows found in %r' % SHEET_NAME)

    seen = set()
    for i, row in enumerate(rows):
        where = 'row %d (month=%r)' % (i + 2, row.get('month'))
        missing = [k for k in ROW_KEYS if k not in row]
        if missing:
            raise ValidationError('%s: missing keys %s' % (where, missing))
        if not MONTH_RE.match(str(row['month'])):
            raise ValidationError(
                '%s: month is not YYYY-MM' % where)
        if row['month'] in seen:
            raise ValidationError('%s: duplicate month' % where)
        seen.add(row['month'])
        for key in ('monthlySales', 'cumulativeSales'):
            if not isinstance(row[key], (int, float)) or isinstance(row[key], bool):
                raise ValidationError('%s: %s is not numeric' % (where, key))
        for key in ('aum', 'usdTreasuryBalance'):
            if row[key] is not None and not isinstance(row[key], (int, float)):
                raise ValidationError('%s: %s is not numeric/null' % (where, key))
    return rows


# --- Payload --------------------------------------------------------------

def build_payload(rows, generated_at=None):
    now = generated_at or _dt.datetime.now(_dt.timezone.utc)
    stamp = now.strftime('%Y-%m-%dT%H:%M:%S.') + \
        '%03dZ' % (now.microsecond // 1000)
    return {
        'schema_version': SCHEMA_VERSION,
        'generated_at': stamp,
        'source': 'publish_monthly_statistics_cache.py',
        'upstream': UPSTREAM_URL,
        'timestamp': stamp,   # mirrors the GAS response key
        'data': rows,
    }


# --- Sheet read -----------------------------------------------------------

def read_sheet(creds_path=None):
    """Read Monthly Statistics A:F raw, returning (values, spreadsheet_tz)."""
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    path = os.path.expanduser(creds_path or SERVICE_ACCOUNT_PATH)
    creds = Credentials.from_service_account_file(
        path, scopes=['https://www.googleapis.com/auth/spreadsheets'])
    svc = build('sheets', 'v4', credentials=creds)

    meta = svc.spreadsheets().get(
        spreadsheetId=MAIN_LEDGER_ID,
        fields='properties(timeZone)').execute()
    tz_name = (meta.get('properties') or {}).get('timeZone') or 'UTC'
    tz = ZoneInfo(tz_name) if ZoneInfo else _dt.timezone.utc

    values = svc.spreadsheets().values().get(
        spreadsheetId=MAIN_LEDGER_ID,
        range='%s!A2:F' % SHEET_NAME,
        valueRenderOption='UNFORMATTED_VALUE',
    ).execute().get('values', [])
    return values, tz


# --- Entry point ----------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dry-run', action='store_true',
                    help='build + validate and print, publish nothing')
    ap.add_argument('--out', default=None,
                    help='write the payload here instead of publishing')
    ap.add_argument('--creds', default=None, help='service-account JSON path')
    args = ap.parse_args(argv)

    values, tz = read_sheet(args.creds)
    rows = validate(build_rows(values, tz))
    payload = build_payload(rows)
    text = json.dumps(payload, indent=2, ensure_ascii=False) + '\n'

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text)
        print('Wrote %s (%d rows)' % (args.out, len(rows)))
        return 0

    print('Built %d rows; latest month %s (monthlySales=%s)'
          % (len(rows), rows[-1]['month'], rows[-1]['monthlySales']))

    if args.dry_run:
        print('[dry-run] would publish %s' % CACHE_PATH)
        print(text[:400] + ('...' if len(text) > 400 else ''))
        return 0

    tmp = '/tmp/monthly-statistics.json'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import snapshot_managed_ledgers as sml  # local sibling; no network at import

    if not sml._github_token():
        print('ERROR: TREASURY_CACHE_TOKEN / GITHUB_TOKEN not set - cannot '
              'publish to treasury-cache.', file=sys.stderr)
        return 2

    ok = sml.publish({CACHE_PATH: tmp})
    print('Published' if ok else 'Publish FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
