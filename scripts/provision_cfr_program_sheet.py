#!/usr/bin/env python3
"""Provision the standalone `cfr program` governor-only spreadsheet (CRF plan SS11.3 / SS11.8).

Why a human must create the sheet
---------------------------------
The CRF Anapu x SunMint payout sink (plan SS11) writes a **raw PIX key** into a
private, governor-only spreadsheet named `cfr program`. Per SS11.3 that sheet is
created by a human governor and then shared with the provisioning service account
`agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com` (writer).

That split is not a policy choice -- it is forced by the platform: the
`agroverse-ledger-manager` SA lives on a Workspace whose service accounts have
`storageQuota.limit == 0` and no Shared Drive, so **it cannot create (own) any
Drive file** (verified 2026-09-17: `spreadsheets.create` -> 403 "The caller does
not have permission"; `files.create` -> 403 "The user's Drive storage quota has
been exceeded"). It *can* edit sheets owned by a human who shared them with it
(verified: `canEdit=True` on the two existing DAO workbooks). Hence: human creates,
SA edits.

What this script does
---------------------
Given a spreadsheet id that a governor has already created and shared with the SA,
it **idempotently** ensures the four canonical tabs exist with the exact SS11.3
header rows. Safe to re-run: it never deletes, reorders, or overwrites non-header
data, and it is a **dry-run by default** (pass --execute to apply).

Usage (from the repo root)::

    python3 scripts/provision_cfr_program_sheet.py --spreadsheet-id <ID>              # dry-run
    python3 scripts/provision_cfr_program_sheet.py --spreadsheet-id <ID> --execute    # apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Canonical SS11.3 schema. The first data column of every intake tab is the dedup
# key (`telegram_update_id`): at most one row per Telegram update.
TABS: dict[str, list[str]] = {
    "payout registrations": [
        "created_at_utc",
        "telegram_update_id",
        "pk_hash",
        "program_slug",
        "pix_key_type",
        "pix_key",
        "pix_key_masked",
        "submission_source",
        "status",
        "supersedes_row",
        "error_message",
    ],
    "tree planting": [
        "created_at_utc",
        "telegram_update_id",
        "pk_hash",
        "tree_id",
        "species",
        "lat",
        "lng",
        "photo_url",
        "capture_source",
        "status",
    ],
    "tree monitoring": [
        "created_at_utc",
        "telegram_update_id",
        "tree_id_qr",
        "species",
        "dbh_cm",
        "co2e_kg",
        "measured_at",
        "photo_url",
        "status",
    ],
    "plot registrations": [
        "created_at_utc",
        "telegram_update_id",
        "pk_hash",
        "plot_ref",
        "geometry_ref",
        "captured_at",
        "status",
    ],
}

# The single tab a brand-new Google Sheet ships with -- none of ours are this.
DEFAULT_TAB = "Sheet1"

DEFAULT_CREDS = Path(
    "/home/ubuntu/creds/agroverse-ledger-manager-google-credentials.json"
)
SA_EMAIL = "agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def plan(existing_titles: list[str]) -> list[tuple[str, str]]:
    """Return ``[(action, tab), ...]`` where action is ``create`` or ``exists``.

    Pure function -- no network -- so the provisioning intent is unit-testable.
    """
    return [("exists" if t in existing_titles else "create", t) for t in TABS]


def _col(n: int) -> str:
    """1-based column number -> A1 letter(s): 1->A, 26->Z, 27->AA."""
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def _build_service(creds_path: Path):
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    creds = Credentials.from_service_account_file(str(creds_path), scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)


def _ensure(service, spreadsheet_id: str, *, execute: bool) -> int:
    meta = (
        service.spreadsheets()
        .get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties.title,properties.title",
        )
        .execute()
    )
    existing = [s["properties"]["title"] for s in meta.get("sheets", [])]
    print(f"spreadsheet: {meta.get('properties', {}).get('title')!r}")
    print(f"existing tabs: {existing}")

    to_create = [t for act, t in plan(existing) if act == "create"]
    if to_create:
        if execute:
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={
                    "requests": [
                        {"addSheet": {"properties": {"title": t}}} for t in to_create
                    ]
                },
            ).execute()
            print(f"created {len(to_create)} tab(s): {to_create}")
        else:
            print(f"[dry-run] would create {len(to_create)} tab(s): {to_create}")
    else:
        print("all four tabs already present")

    rc = 0
    for tab, headers in TABS.items():
        rng = f"'{tab}'!A1:{_col(len(headers))}1"
        got = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=rng)
            .execute()
            .get("values", [[]])
        )
        got = got[0] if got else []
        if got == headers:
            print(f"  {tab}: headers OK ({len(headers)} cols)")
            continue
        if execute:
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=rng,
                valueInputOption="RAW",
                body={"values": [headers]},
            ).execute()
            print(f"  {tab}: headers written ({len(headers)} cols)")
        else:
            print(
                f"  {tab}: [dry-run] would write {len(headers)} header cols (currently {len(got)})"
            )
            rc = 0
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--spreadsheet-id",
        required=True,
        help="id of the governor-created `cfr program` sheet",
    )
    ap.add_argument(
        "--credentials",
        default=str(DEFAULT_CREDS),
        help=f"service-account json (default: {DEFAULT_CREDS})",
    )
    ap.add_argument(
        "--execute", action="store_true", help="apply changes (default: dry-run)"
    )
    args = ap.parse_args(argv)

    creds_path = Path(args.credentials)
    if not creds_path.is_file():
        print(f"ERROR: credentials not found: {creds_path}", file=sys.stderr)
        return 2

    try:
        service = _build_service(creds_path)
    except Exception as exc:  # pragma: no cover - env dependent
        print(f"ERROR: could not build Sheets client: {exc}", file=sys.stderr)
        return 2

    print(f"mode: {'EXECUTE' if args.execute else 'DRY-RUN'}  sa: {SA_EMAIL}")
    try:
        return _ensure(service, args.spreadsheet_id, execute=args.execute)
    except Exception as exc:  # pragma: no cover - network dependent
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        print(
            f"hint: confirm the sheet is shared with {SA_EMAIL} as an Editor.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
