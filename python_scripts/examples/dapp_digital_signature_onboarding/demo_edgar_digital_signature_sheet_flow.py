#!/usr/bin/env python3
"""Demo: Contributors Digital Signatures sheet flow (mirrors Ruby Gdrive::ContributorsDigitalSignatures)."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import requests
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from google.oauth2 import service_account
from googleapiclient.discovery import build

# ---------------------------------------------------------------------------
# Constants (match sentiment_importer Gdrive::ContributorsDigitalSignatures)
# ---------------------------------------------------------------------------
SPREADSHEET_ID = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU"
SHEET_TITLE = "Contributors Digital Signatures"
CONTACT_INFO_SHEET_TITLE = "Contributors contact information"

COL_NAME = 1
COL_CREATED = 2
COL_LAST_ACTIVE = 3
COL_STATUS = 4
COL_SIGNATURE = 5
COL_EMAIL = 6
COL_VERIFICATION_KEY = 7

SCOPES = ("https://www.googleapis.com/auth/spreadsheets",)


def spreadsheet_id() -> str:
    return os.environ.get("DEMO_SPREADSHEET_ID", SPREADSHEET_ID).strip() or SPREADSHEET_ID


def quote_sheet_prefix(title: str) -> str:
    escaped = title.replace("'", "''")
    return f"'{escaped}'"


def sheets_service():
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not cred_path or not os.path.isfile(cred_path):
        sys.exit("Set GOOGLE_APPLICATION_CREDENTIALS to a readable service-account JSON file path.")
    creds = service_account.Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def normalize_public_key(value: Any) -> str:
    """PEM RSA/SPKI or raw base64 SPKI → strict base64 DER SPKI (matches Ruby normalize_public_key)."""
    raw_in = str(value or "").replace("\u200b", "").replace("\ufeff", "").strip()
    if not raw_in:
        return ""
    pemish = raw_in.replace("\r\n", "\n").replace("\r", "\n")
    if "BEGIN" in pemish and "PUBLIC KEY" in pemish:
        try:
            key = serialization.load_pem_public_key(pemish.encode("utf-8"), backend=default_backend())
            der = key.public_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            return base64.b64encode(der).decode("ascii")
        except Exception:
            pass
    return "".join(raw_in.split())


def normalize_verification_key(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return s
    if "%" in s:
        return urllib.parse.unquote_plus(s)
    return s


def _get_values(svc, sid: str, a1: str) -> List[List[Any]]:
    resp = svc.spreadsheets().values().get(spreadsheetId=sid, range=a1).execute()
    return resp.get("values") or []


def lookup_contributor_name_in_contact_sheet(svc, sid: str, email: str) -> str:
    em = email.lower().strip()
    if not em or "@" not in em:
        return ""
    cprefix = quote_sheet_prefix(CONTACT_INFO_SHEET_TITLE)
    col = _get_values(svc, sid, f"{cprefix}!D2:D")
    for idx, row in enumerate(col):
        if not row or row[0] is None:
            continue
        if str(row[0]).lower().strip() != em:
            continue
        sheet_row = idx + 2
        a_cell = _get_values(svc, sid, f"{cprefix}!A{sheet_row}:A{sheet_row}")
        cell = (a_cell[0][0] if a_cell and a_cell[0] else "") or ""
        return str(cell).strip()
    return ""


def fetch_row_a_g(svc, sid: str, sheet_row: int) -> Optional[List[Any]]:
    prefix = quote_sheet_prefix(SHEET_TITLE)
    rows = _get_values(svc, sid, f"{prefix}!A{sheet_row}:G{sheet_row}")
    if not rows:
        return None
    return rows[0]


def sheet_rows_matching_public_key(svc, sid: str, public_key_b64: str) -> List[int]:
    pk = normalize_public_key(public_key_b64)
    if not pk:
        return []
    prefix = quote_sheet_prefix(SHEET_TITLE)
    col = _get_values(svc, sid, f"{prefix}!E2:E")
    out: List[int] = []
    for idx, row in enumerate(col or []):
        if not row:
            continue
        sig = normalize_public_key(row[0])
        if sig and sig == pk:
            out.append(idx + 2)
    return out


def sheet_rows_matching_email_vk_and_public_key(
    svc, sid: str, *, email: str, verification_key: str, public_key_b64: str
) -> List[int]:
    em = email.lower().strip()
    vk = normalize_verification_key(verification_key)
    pk = normalize_public_key(public_key_b64)
    if not em or not vk or not pk:
        return []
    prefix = quote_sheet_prefix(SHEET_TITLE)
    fg = _get_values(svc, sid, f"{prefix}!F2:G")
    out: List[int] = []
    for idx, pair in enumerate(fg or []):
        if not pair:
            continue
        row_email = str(pair[0]).lower().strip() if len(pair) > 0 else ""
        row_vk = normalize_verification_key(pair[1] if len(pair) > 1 else "")
        if row_email != em or row_vk != vk:
            continue
        sheet_row = idx + 2
        row = fetch_row_a_g(svc, sid, sheet_row)
        if not row:
            continue
        status = str(row[COL_STATUS - 1]).strip().upper()
        if status != "VERIFYING":
            continue
        sig = normalize_public_key(row[COL_SIGNATURE - 1])
        if sig == pk:
            out.append(sheet_row)
    return out


def activate_row_verify(svc, sid: str, sheet_row: int, vk: str) -> bool:
    row = fetch_row_a_g(svc, sid, sheet_row) or []
    status = str(row[COL_STATUS - 1]).strip().upper() if len(row) >= COL_STATUS else ""
    row_vk = normalize_verification_key(row[COL_VERIFICATION_KEY - 1] if len(row) >= COL_VERIFICATION_KEY else "")
    if status != "VERIFYING" or row_vk != vk:
        return False
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    full = list(row)
    while len(full) < COL_VERIFICATION_KEY:
        full.append("")
    full[COL_LAST_ACTIVE - 1] = now
    full[COL_STATUS - 1] = "ACTIVE"
    prefix = quote_sheet_prefix(SHEET_TITLE)
    svc.spreadsheets().values().update(
        spreadsheetId=sid,
        range=f"{prefix}!A{sheet_row}:G{sheet_row}",
        valueInputOption="USER_ENTERED",
        body={"values": [full]},
    ).execute()
    return True


def activate_pending(
    svc, sid: str, *, public_key_b64: str, verification_key: str, email: Optional[str] = None
) -> bool:
    pk = normalize_public_key(public_key_b64)
    vk = normalize_verification_key(verification_key)
    if not pk or not vk:
        return False
    candidates = sheet_rows_matching_public_key(svc, sid, pk)
    for sheet_row in reversed(candidates):
        if activate_row_verify(svc, sid, sheet_row, vk):
            return True
    if email:
        em = email.lower().strip()
        fallback = sheet_rows_matching_email_vk_and_public_key(svc, sid, email=em, verification_key=vk, public_key_b64=pk)
        for sheet_row in reversed(fallback):
            if activate_row_verify(svc, sid, sheet_row, vk):
                return True
    return False


def build_verifying_row(email: str, public_key: str, verification_key: str, svc, sid: str) -> List[str]:
    contributor_name = lookup_contributor_name_in_contact_sheet(svc, sid, email)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    return [
        contributor_name,
        now,
        now,
        "VERIFYING",
        normalize_public_key(public_key),
        email.lower().strip(),
        str(verification_key or ""),
    ]


def writes_allowed() -> bool:
    return os.environ.get("DEMO_ALLOW_SHEET_WRITES", "").strip() == "1"


def redact_secret(secret: str) -> str:
    if not secret:
        return ""
    if len(secret) <= 8:
        return "***"
    return secret[:4] + "…" + secret[-4:]


def cmd_probe(svc, sid: str) -> None:
    prefix = quote_sheet_prefix(SHEET_TITLE)
    header = _get_values(svc, sid, f"{prefix}!A1:G1")
    print("A1:G1 header row:")
    print(json.dumps(header, indent=2))
    col_a = _get_values(svc, sid, f"{prefix}!A2:A")
    n = len(col_a)
    print(f"Data rows (non-empty column A from row 2 downward, as returned by API): {n}")


def cmd_lookup_name(svc, sid: str, email: str) -> None:
    name = lookup_contributor_name_in_contact_sheet(svc, sid, email)
    print(name or "(no match)")


def cmd_print_append(svc, sid: str, email: str, public_key: str, verification_key: str) -> None:
    row = build_verifying_row(email, public_key, verification_key, svc, sid)
    print("VERIFYING row (A–G) that append_pending_row! would write:")
    print(json.dumps([row], indent=2))


def cmd_append_pending(svc, sid: str, email: str, public_key: str, verification_key: str, apply: bool) -> None:
    row = build_verifying_row(email, public_key, verification_key, svc, sid)
    if not apply:
        print("Dry run (no --apply). Row:")
        print(json.dumps([row], indent=2))
        return
    if not writes_allowed():
        sys.exit("Refusing to write: set DEMO_ALLOW_SHEET_WRITES=1 and pass --apply.")
    prefix = quote_sheet_prefix(SHEET_TITLE)
    body = {"values": [row]}
    resp = (
        svc.spreadsheets()
        .values()
        .append(
            spreadsheetId=sid,
            range=f"{prefix}!A:G",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        )
        .execute()
    )
    print(json.dumps(resp, indent=2))


def cmd_matching_rows(svc, sid: str, email: str, verification_key: str, public_key: str) -> None:
    rows = sheet_rows_matching_email_vk_and_public_key(
        svc, sid, email=email, verification_key=verification_key, public_key_b64=public_key
    )
    print(json.dumps({"sheet_rows": rows}, indent=2))


def cmd_activate_pending(
    svc, sid: str, public_key: str, verification_key: str, email: Optional[str], apply: bool
) -> None:
    if not apply:
        pk = normalize_public_key(public_key)
        vk = normalize_verification_key(verification_key)
        print("Dry run: candidate public-key rows (E match):", sheet_rows_matching_public_key(svc, sid, pk))
        if email:
            print(
                "Dry run: email+vk+pk VERIFYING rows:",
                sheet_rows_matching_email_vk_and_public_key(
                    svc, sid, email=email, verification_key=vk, public_key_b64=pk
                ),
            )
        print("Pass --apply to perform activate_pending (requires DEMO_ALLOW_SHEET_WRITES=1).")
        return
    if not writes_allowed():
        sys.exit("Refusing to write: set DEMO_ALLOW_SHEET_WRITES=1 and pass --apply.")
    ok = activate_pending(svc, sid, public_key_b64=public_key, verification_key=verification_key, email=email)
    print(json.dumps({"activated": ok}, indent=2))


def cmd_print_gas(email: str, verification_key: str, return_url: str, do_call: bool) -> None:
    url = os.environ.get("EMAIL_VERIFICATION_GAS_WEBHOOK_URL", "").strip()
    secret = os.environ.get("EMAIL_VERIFICATION_GAS_SECRET", "").strip()
    if not url:
        sys.exit("Set EMAIL_VERIFICATION_GAS_WEBHOOK_URL to the GAS /exec base URL.")
    if not secret:
        sys.exit("Set EMAIL_VERIFICATION_GAS_SECRET (must match Apps Script EMAIL_VERIFICATION_SECRET).")
    base = url.rstrip("/")
    show_raw = os.environ.get("GAS_PRINT_SECRETS", "").strip() == "1"
    sec_display = secret if show_raw else redact_secret(secret)
    q = {
        "action": "sendEmailVerification",
        "secret": secret,
        "email": email,
        "verification_key": verification_key,
        "return_url": return_url,
    }
    get_params = dict(q)
    get_params_display = dict(q)
    get_params_display["secret"] = sec_display
    get_line = f"GET {base}?{urllib.parse.urlencode(get_params_display)}"
    print("--- GET (secret redacted unless GAS_PRINT_SECRETS=1 in display only; query uses real secret) ---")
    print(get_line)
    post_body = {
        "secret": secret,
        "email": email,
        "verification_key": verification_key,
        "return_url": return_url,
    }
    post_display = dict(post_body)
    post_display["secret"] = sec_display
    print("--- POST JSON (display) ---")
    print(json.dumps(post_display, indent=2))
    if not do_call:
        print("(Omit --call to skip HTTP.)")
        return
    headers = {"User-Agent": "TrueSight-demo-edgar-digital-signature-sheet-flow/1.0"}
    r_get = requests.get(base, params=q, headers=headers, timeout=30)
    print("--- GET response ---", r_get.status_code, r_get.text[:2000])
    r_post = requests.post(
        base,
        data=json.dumps(post_body),
        headers={**headers, "Content-Type": "application/json"},
        timeout=30,
    )
    print("--- POST response ---", r_post.status_code, r_post.text[:2000])


def main(argv: Optional[Sequence[str]] = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="Edgar / Sheets digital signature onboarding demo")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("probe", help="Read A1:G1 and count A2:A rows returned")

    p_ln = sub.add_parser("lookup-name", help="Resolve contributor name from contact sheet (D→A)")
    p_ln.add_argument("--email", required=True)

    def add_key_args(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--email", required=True)
        sp.add_argument("--public-key", required=True)
        sp.add_argument("--verification-key", required=True)

    p_pa = sub.add_parser("print-append", help="Print VERIFYING row (no write)")
    add_key_args(p_pa)

    p_ap = sub.add_parser("append-pending", help="Append VERIFYING row (--apply + DEMO_ALLOW_SHEET_WRITES=1)")
    add_key_args(p_ap)
    p_ap.add_argument("--apply", action="store_true")

    p_mr = sub.add_parser("matching-rows", help="sheet_rows_matching_email_vk_and_public_key")
    add_key_args(p_mr)

    p_ac = sub.add_parser("activate-pending", help="Port of activate_pending! (optional --apply)")
    p_ac.add_argument("--public-key", required=True)
    p_ac.add_argument("--verification-key", required=True)
    p_ac.add_argument("--email", default="")
    p_ac.add_argument("--apply", action="store_true")

    p_gas = sub.add_parser("print-gas", help="Show GAS GET/POST for edgar_send_email_verification")
    p_gas.add_argument("--email", required=True)
    p_gas.add_argument("--verification-key", required=True)
    p_gas.add_argument(
        "--return-url",
        default="https://truesightdao.github.io/dapp/create_signature.html",
    )
    p_gas.add_argument("--call", action="store_true", help="Perform GET then POST via requests")

    args = parser.parse_args(argv)
    sid = spreadsheet_id()
    svc = sheets_service()

    if args.cmd == "probe":
        cmd_probe(svc, sid)
    elif args.cmd == "lookup-name":
        cmd_lookup_name(svc, sid, args.email)
    elif args.cmd == "print-append":
        cmd_print_append(svc, sid, args.email, args.public_key, args.verification_key)
    elif args.cmd == "append-pending":
        cmd_append_pending(svc, sid, args.email, args.public_key, args.verification_key, args.apply)
    elif args.cmd == "matching-rows":
        cmd_matching_rows(svc, sid, args.email, args.verification_key, args.public_key)
    elif args.cmd == "activate-pending":
        cmd_activate_pending(
            svc, sid, args.public_key, args.verification_key, args.email or None, args.apply
        )
    elif args.cmd == "print-gas":
        cmd_print_gas(args.email, args.verification_key, args.return_url, args.call)
    else:
        parser.error("unknown command")


if __name__ == "__main__":
    main()
