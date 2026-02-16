#!/usr/bin/env python3
"""
Append rows from processing_cost_candidates.csv to the "Agroverse Cacao Processing Cost"
Google Sheet. Requires Google Sheets API credentials with write access.

Credentials: uses service account file from schema_validation:
  tokenomics/python_scripts/schema_validation/gdrive_schema_credentials.json
The spreadsheet must be shared with the service account email (e.g. xxx@project.iam.gserviceaccount.com).

Usage:
  cd tokenomics && python3 python_scripts/agroverse_cacao_processing/append_to_processing_cost_sheet.py
  # Or pass CSV path:
  python3 append_to_processing_cost_sheet.py /path/to/candidates.csv
"""

import csv
import os
import sys
from pathlib import Path

# Sheet config
SPREADSHEET_ID = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU"
SHEET_NAME = "Agroverse Cacao Processing Cost"


def get_credentials():
    """Load service account credentials (same path as schema_validation)."""
    from google.oauth2 import service_account

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent  # tokenomics
    creds_path = repo_root / "python_scripts" / "schema_validation" / "gdrive_schema_credentials.json"
    if not creds_path.exists():
        raise FileNotFoundError(
            f"Credentials not found: {creds_path}\n"
            "Add a Google Cloud service account JSON key there (see schema_validation README). "
            "Share the spreadsheet with the service account email."
        )
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    return service_account.Credentials.from_service_account_file(str(creds_path), scopes=scopes)


def read_csv_rows(csv_path: Path) -> list[list]:
    """Read CSV and return data rows only (no header) as list of lists for Sheets API."""
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            return rows
        for row in reader:
            if row and any(cell.strip() for cell in row):
                rows.append(row)
    return rows


def append_to_sheet(rows: list[list]) -> None:
    from googleapiclient.discovery import build

    creds = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    body = {"values": rows}
    result = (
        service.spreadsheets()
        .values()
        .append(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{SHEET_NAME}'!A:G",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        )
        .execute()
    )
    updated = result.get("updates", {})
    print(f"Appended {updated.get('updatedRows', len(rows))} row(s) to {SHEET_NAME}.")


def update_sheet_rows(rows: list[list], start_row: int) -> None:
    """Update existing rows (e.g. fix column B in place). start_row is 1-based."""
    from googleapiclient.discovery import build

    creds = get_credentials()
    service = build("sheets", "v4", credentials=creds)
    range_str = f"'{SHEET_NAME}'!A{start_row}:G{start_row + len(rows) - 1}"
    body = {"values": rows}
    (
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=SPREADSHEET_ID,
            range=range_str,
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    print(f"Updated {len(rows)} row(s) in {SHEET_NAME} (rows {start_row}-{start_row + len(rows) - 1}).")


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Append or update Agroverse Cacao Processing Cost sheet.")
    ap.add_argument("csv", nargs="?", default=None, help="Path to CSV (default: processing_cost_candidates.csv)")
    ap.add_argument("--update", metavar="START_ROW", type=int, default=None, help="Update existing rows starting at 1-based row (e.g. 25) instead of appending")
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    csv_path = Path(args.csv) if args.csv else script_dir / "processing_cost_candidates.csv"
    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    rows = read_csv_rows(csv_path)
    if not rows:
        print("No data rows in CSV.", file=sys.stderr)
        sys.exit(1)

    try:
        if args.update is not None:
            update_sheet_rows(rows, args.update)
        else:
            append_to_sheet(rows)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Failed: {e}", file=sys.stderr)
        if "403" in str(e) or "Permission" in str(e):
            print("Ensure the spreadsheet is shared with the service account email.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
