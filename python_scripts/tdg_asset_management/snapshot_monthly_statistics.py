#!/usr/bin/env python3
"""Snapshot the Main Ledger's "Monthly Statistics" sheet to treasury-cache.

The tokenomics Monthly Statistics chart (docs/MONTHLY_STATISTICS_CHART_EXAMPLE.html
and the pages that embed it) currently loads by calling a Google Apps Script
endpoint on *every* page load:

    https://script.google.com/macros/s/<DEPLOYMENT>/exec?type=monthly

Every visitor therefore pays a full Apps Script execution (openById -> read the
sheet -> sort -> serialise JSON) just to draw a chart, and the chart breaks
outright whenever the script is redeployed, rate-limited, or over quota.

This script removes Apps Script from the read path: it reads the same sheet via
the Sheets API and publishes a byte-compatible snapshot to

    treasury-cache/monthly-statistics.json

The payload shape is exactly what the GAS `readMonthlyStatistics()` returns and
what the chart consumes:

    {"timestamp": "<ISO8601 UTC>",
     "data": [{"month": "YYYY-MM", "monthlySales": float,
               "cumulativeSales": float, "aum": float|null,
               "usdTreasuryBalance": float|null,
               "lastUpdated": "<ISO8601 UTC>"|null}, ...]}

Field nullability and "" -> 0 handling mirror the GAS reader so downstream
consumers need no changes at all.

Usage
-----
    python3 snapshot_monthly_statistics.py [--dry-run]

Environment
-----------
    MONTHLY_STATS_OUT_DIR     output directory      (default: ./treasury-cache)
    MONTHLY_STATS_CREDS_PATH  service-account JSON  (default: see below)
    TREASURY_CACHE_TOKEN      PAT with Contents:write on TrueSightDAO/treasury-cache
                              (falls back to GITHUB_TOKEN; absent -> local only)

Exit codes: 0 success (including "unchanged"), 1 hard failure.
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

MAIN_LEDGER_ID = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU"
MONTHLY_SHEET = "Monthly Statistics"

# Column layout of the "Monthly Statistics" sheet (0-based, header on row 1):
#   A month | B monthly sales | C cumulative sales | D last updated
#   E AUM   | F USD treasury balance
COL_MONTH = 0
COL_MONTHLY_SALES = 1
COL_CUMULATIVE_SALES = 2
COL_LAST_UPDATED = 3
COL_AUM = 4
COL_USD_TREASURY = 5
COL_COUNT = 6

READ_RANGE = "A2:F1005"
OUT_DIR = os.path.expanduser(
    os.environ.get(
        "MONTHLY_STATS_OUT_DIR",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "treasury-cache"),
    )
)
SERVICE_ACCOUNT_PATH = os.path.expanduser(
    os.environ.get(
        "MONTHLY_STATS_CREDS_PATH",
        "~/Applications/sentiment_importer/config/cypher_defense_gdrive_key.json",
    )
)

TREASURY_CACHE_REPO = "TrueSightDAO/treasury-cache"
TREASURY_CACHE_BRANCH = "main"
CACHE_REL_PATH = "monthly-statistics.json"


# --- pure helpers -------------------------------------------------------------


def _num_or_zero(raw):
    """GAS: `v !== "" ? parseFloat(v) : 0` -- blanks become 0, not null."""
    if raw is None or raw == "":
        return 0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0


def _num_or_none(raw):
    """GAS: `v !== "" && v != null ? parseFloat(v) : null` for columns E/F."""
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


# Google Sheets serial-date epoch: serial 1 == 1899-12-31, so day 0 is 1899-12-30.
SHEETS_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)
# Plausible range for a date serial (1970-01-01 .. 2173-10-17). Used to tell a
# real DATE cell (serial) apart from a genuine string in column D.
SERIAL_MIN, SERIAL_MAX = 25569, 100000


def _serial_to_dt(raw, sheet_tz=None):
    """Convert a Sheets date serial (float) to an aware UTC datetime, else None.

    A serial encodes a *wall-clock* time in the spreadsheet's display timezone,
    not UTC. Resolving it with ZoneInfo (which honours DST) is what reproduces
    the instant GAS reports from `Date.toISOString()`. Getting this wrong shifts
    every lastUpdated by the zone offset.
    """
    try:
        num = float(raw)
    except (TypeError, ValueError):
        return None
    if not (SERIAL_MIN <= num <= SERIAL_MAX):
        return None
    wall = (SHEETS_EPOCH + timedelta(days=num)).replace(tzinfo=None)
    if not sheet_tz:
        return wall.replace(tzinfo=timezone.utc)
    try:
        from zoneinfo import ZoneInfo

        return wall.replace(tzinfo=ZoneInfo(sheet_tz)).astimezone(timezone.utc)
    except (KeyError, ValueError, OSError, TypeError):
        return wall.replace(tzinfo=timezone.utc)


def _iso_or_none(raw, sheet_tz=None):
    """GAS: `lastUpdated instanceof Date ? .toISOString() : (lastUpdated || null)`.

    Reading with UNFORMATTED_VALUE yields a numeric serial for a DATE cell --
    GAS getValues() would have handed us a real Date. Converting the serial is
    what makes this payload byte-compatible with the Apps Script reader.
    """
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        dt = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
        utc = dt.astimezone(timezone.utc)
        return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"
    if isinstance(raw, (int, float)):
        dt = _serial_to_dt(raw, sheet_tz)
        if dt is not None:
            return _iso_or_none(dt)
    return str(raw)


def _month_key(raw, sheet_tz=None):
    """Normalise column A to a "YYYY-MM" key.

    The sheet is *supposed* to hold text like "2026-10", but it has repeatedly
    been written with a real Date -- the very bug that stranded rows at row 1000
    in the Apps Script writer. GAS only does String(v).trim(), so it emits
    "2026-10-20 01:00:00" for those rows; normalising here keeps the cache a
    drop-in for consumers that parse `month` as YYYY-MM.
    """
    if raw is None:
        return ""
    if isinstance(raw, datetime):
        return raw.strftime("%Y-%m")
    if isinstance(raw, (int, float)):
        dt = _serial_to_dt(raw, sheet_tz)
        if dt is not None:
            return dt.strftime("%Y-%m")
    text = str(raw).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    m = re.match(r"^(\d{4})/(\d{1,2})", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    return text


def build_payload(rows, now=None, sheet_tz=None):
    """Turn raw sheet rows into the chart payload, matching GAS semantics.

    `rows` are the data rows below the header (row 2 onwards).
    """
    stats = []
    for row in rows:
        if not row:
            continue
        padded = list(row) + [None] * (COL_COUNT - len(row))
        month = _month_key(padded[COL_MONTH], sheet_tz)
        if month == "":
            continue  # GAS: `if (month)`
        stats.append(
            {
                "month": month,
                "monthlySales": _num_or_zero(padded[COL_MONTHLY_SALES]),
                "cumulativeSales": _num_or_zero(padded[COL_CUMULATIVE_SALES]),
                "aum": _num_or_none(padded[COL_AUM]),
                "usdTreasuryBalance": _num_or_none(padded[COL_USD_TREASURY]),
                "lastUpdated": _iso_or_none(padded[COL_LAST_UPDATED], sheet_tz),
            }
        )
    stats.sort(key=lambda r: r["month"])
    stamp = _iso_or_none(now or datetime.now(timezone.utc))
    return {"timestamp": stamp, "data": stats}


# --- publication --------------------------------------------------------------


def _github_token():
    return (
        os.environ.get("TREASURY_CACHE_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    ).strip()


def _stable_text(text):
    """Ignore the volatile top-level timestamp so unchanged data never commits."""
    try:
        obj = json.loads(text)
    except ValueError:
        return text
    obj.pop("timestamp", None)
    return json.dumps(obj, sort_keys=True)


def publish_via_contents_api(local_path, dry_run=False):
    """PUT the snapshot to treasury-cache, skipping when content is unchanged."""
    import base64
    import urllib.error
    import urllib.request

    token = _github_token()
    if not token:
        print(
            "  No TREASURY_CACHE_TOKEN/GITHUB_TOKEN -- local write only, not published"
        )
        return False

    api = f"https://api.github.com/repos/{TREASURY_CACHE_REPO}/contents"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    with open(local_path, encoding="utf-8") as fh:
        new_text = fh.read()

    sha, existing = None, None
    try:
        req = urllib.request.Request(
            f"{api}/{CACHE_REL_PATH}?ref={TREASURY_CACHE_BRANCH}", headers=headers
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            info = json.load(resp)
        sha = info.get("sha")
        existing = base64.b64decode(info.get("content", "")).decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError):
        pass

    if existing is not None and _stable_text(existing) == _stable_text(new_text):
        print(f"  Unchanged {CACHE_REL_PATH} -- skipping")
        return True

    if dry_run:
        print(f"  [dry-run] Would PUT {CACHE_REL_PATH} via Contents API")
        return True

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    payload = {
        "message": f"chore: snapshot monthly-statistics {stamp}",
        "content": base64.b64encode(new_text.encode("utf-8")).decode("ascii"),
        "branch": TREASURY_CACHE_BRANCH,
    }
    if sha:
        payload["sha"] = sha
    req = urllib.request.Request(
        f"{api}/{CACHE_REL_PATH}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  Published {CACHE_REL_PATH} (HTTP {resp.status})")
        return True
    except (urllib.error.URLError, OSError) as e:
        print(f"  ERROR publishing {CACHE_REL_PATH}: {e}")
        return False


# --- main ---------------------------------------------------------------------


def read_sheet_rows():
    import gspread

    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"Service account key not found: {SERVICE_ACCOUNT_PATH}")
        sys.exit(1)
    gc = gspread.service_account(SERVICE_ACCOUNT_PATH)
    book = gc.open_by_key(MAIN_LEDGER_ID)
    ws = book.worksheet(MONTHLY_SHEET)
    rows = ws.get(READ_RANGE, value_render_option="UNFORMATTED_VALUE")
    tz = None
    try:
        tz = book.timezone
    except (AttributeError, KeyError, TypeError):
        try:
            tz = book._properties.get("timeZone")
        except (AttributeError, KeyError, TypeError):
            tz = None
    return rows, tz


def main():
    dry_run = "--dry-run" in sys.argv
    rows, sheet_tz = read_sheet_rows()
    print(f"Spreadsheet display timezone: {sheet_tz}")
    payload = build_payload(rows, sheet_tz=sheet_tz)
    print(f"Read {len(rows)} rows -> {len(payload['data'])} monthly entries")

    months = [r["month"] for r in payload["data"]]
    if not months:
        print(
            "ERROR: no monthly entries produced -- refusing to publish an empty snapshot"
        )
        return 1
    dupes = sorted({m for m in months if months.count(m) > 1})
    if dupes:
        print(f"WARNING: duplicate month keys: {dupes}")

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, CACHE_REL_PATH)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote {out_path}")
    last = payload["data"][-1]
    print(
        f"  first={payload['data'][0]['month']} last={last['month']} "
        f"lastSales={last['monthlySales']}"
    )

    ok = publish_via_contents_api(out_path, dry_run=dry_run)
    return 0 if ok or dry_run else 1


if __name__ == "__main__":
    sys.exit(main())
