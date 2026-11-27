#!/usr/bin/env python3
"""Populate the `Recipient Name` column (AD) on the `Agroverse QR codes` tab.

WHY THIS IS NOT A NAIVE JOIN
----------------------------
The QR tab records a bag's *owner email* (col L) but never a *name*. Names live in
five separate registries with INCONSISTENT schemas -- note `Contributors Digital
Signatures` has its email at col F while `Contributors contact information` has it
at col D, and the QR tab itself has positionally-shifted rows. Any fixed-column
parse silently loses rows. So emails are located by PATTERN anywhere in the row,
and names are taken from per-source priority columns with a guarded fallback.

Poisoning is the main risk: a naive fallback happily picks up RSA verification
keys (``MII...``), Stripe object ids (``in_``/``cs_``) and hex invitation tokens as
if they were people's names. ``is_name()`` rejects those explicitly.

USAGE
-----
    python3 populate_recipient_name.py --dry-run     # report only (default)
    python3 populate_recipient_name.py --commit      # write AD1:AD<n>

Requires a service-account JSON with Sheets scope, path in SA_KEY.
"""

import argparse
import re
import sys
from collections import Counter

from google.oauth2 import service_account
from googleapiclient.discovery import build

SPREADSHEET_ID = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU"
SA_KEY = (
    "/opt/truesight_autopilot/config/google/agroverse_qr_code_manager_gdrive_key.json"
)
QR_TAB = "'Agroverse QR codes'"

# QR tab column indices (0-based): L=Owner Email, Z=Stripe Session ID, AD=Recipient Name
COL_OWNER_EMAIL = 11
COL_STRIPE_SESSION = 25
COL_RECIPIENT_NAME = 29

# (tab, candidate-name-columns by priority, tier, provenance-label)
SOURCES = [
    ("Contributors contact information", [0], 1, "contact"),
    ("Contributors Digital Signatures", [0], 2, "signature"),
    ("Contribution submission", [1], 3, "contribution"),
    ("Consignments", [7], 4, "consignment"),
    ("Stripe Social Media Checkout ID", [1], 5, "stripe-cust"),
]

# Reviewed human-confirmed email -> name overrides (tier 0, highest precedence).
# Each entry needs an evidence comment; never add one on a guess.
REVIEWED_ALIASES = {
    # Partner "SOHA - Sanctuary of Healing Arts" (DAO Partners) is registered to
    # "SOHA - David Campbell" (Contributors contact information, r384); the email's
    # local part agrees ("david"). 40 bags hang off this single mapping.
    "david@soha.center": "David Campbell",
}

EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$", re.IGNORECASE)
DATE_RE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}|^\d{8}$|^\d{1,2}/\d{1,2}/\d{4}")
ONEWORD_RE = re.compile(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'’-]{1,19}$")
BAD_VALUES = {
    "true",
    "false",
    "active",
    "pending",
    "confirmed",
    "unsubscribed",
    "none",
    "n/a",
    "na",
    "-",
    "",
    "usd",
    "guest",
    "owner",
    "sold",
    "minted",
}
_STRIPE_IDS = r"^(in_|cs_|ch_|pi_|cus_|sub_|evt_|price_|prod_|pm_|seti_|tok_|ba_|txn_|re_)[A-Za-z0-9]{6,}$"
KEY_PATTERNS = [
    re.compile(_STRIPE_IDS),
    re.compile(r"^MII[A-Za-z0-9+/=]{15,}$"),
    re.compile(r"^b-[A-Za-z0-9_-]{10,}$"),
    re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
    re.compile(r"^[A-Za-z0-9+/=_\-]{24,}$"),
]


def norm(value):
    return str(value).strip().lower()


def is_email(value):
    return bool(EMAIL_RE.match(str(value).strip()))


def is_key(value):
    return any(p.match(str(value).strip()) for p in KEY_PATTERNS)


def is_name(value):
    """True only if `value` plausibly is a human/organisation name."""
    value = str(value).strip()
    if not value or not 2 <= len(value) <= 70:
        return False
    if is_email(value) or DATE_RE.match(value) or value.lower() in BAD_VALUES:
        return False
    if is_key(value):
        return False
    if re.fullmatch(r"[\d.,%\s]+", value):
        return False
    if len(re.findall(r"[A-Za-zÀ-ÿ]", value)) < 2:
        return False
    if "://" in value or "http" in value.lower():
        return False
    if " " not in value:
        return bool(ONEWORD_RE.match(value))
    return True


def build_name_map(svc):
    """Return (email -> name, email -> tier, email -> provenance)."""
    name_by_email, tier, prov = {}, {}, {}

    def add(email, name, t, source):
        email, name = norm(email), str(name).strip()
        if not is_email(email) or not is_name(name):
            return
        if email not in name_by_email or t < tier[email]:
            name_by_email[email] = name
            tier[email] = t
            prov[email] = source

    for tab, name_cols, t, source in SOURCES:
        try:
            rows = (
                svc.spreadsheets()
                .values()
                .get(spreadsheetId=SPREADSHEET_ID, range=f"'{tab}'!A1:Z3000")
                .execute()
                .get("values", [])
            )
        except Exception as exc:  # noqa: BLE001 - a missing tab must not abort the run
            print(f"  ! skipping {tab!r}: {str(exc)[:80]}")
            continue
        for row in rows:
            emails = [c for c in row if is_email(c)]
            if not emails:
                continue
            name = ""
            for idx in name_cols:
                if idx < len(row) and is_name(row[idx]):
                    name = str(row[idx]).strip()
                    break
            if not name:
                for cell in row:
                    if is_name(cell) and not is_email(cell):
                        name = str(cell).strip()
                        break
            for email in emails:
                add(email, name, t, source)

    for email, name in REVIEWED_ALIASES.items():
        add(email, name, 0, "alias-reviewed")

    return name_by_email, tier, prov


def build_stripe_map(svc):
    """Stripe session id -> customer name (col Z of the QR tab is a session id)."""
    out = {}
    rows = (
        svc.spreadsheets()
        .values()
        .get(
            spreadsheetId=SPREADSHEET_ID,
            range="'Stripe Social Media Checkout ID'!A1:N2000",
        )
        .execute()
        .get("values", [])
    )
    for row in rows[1:]:
        if (
            len(row) > 2
            and is_name(row[1])
            and str(row[2]).strip()
            and not is_email(row[1])
        ):
            out.setdefault(str(row[2]).strip(), str(row[1]).strip())
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--commit", action="store_true", help="write AD (default: dry run)"
    )
    args = parser.parse_args()

    creds = service_account.Credentials.from_service_account_file(
        SA_KEY, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    svc = build("sheets", "v4", credentials=creds)

    name_by_email, _, prov = build_name_map(svc)
    stripe = build_stripe_map(svc)
    print(f"email->name pairs: {len(name_by_email)} by {dict(Counter(prov.values()))}")
    print(f"stripe session->customer: {len(stripe)}")

    rows = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"{QR_TAB}!A:AD")
        .execute()
        .get("values", [])
    )
    if not rows:
        sys.exit("QR tab is empty - refusing to run")
    header = rows[0]
    if len(header) <= COL_RECIPIENT_NAME or "Recipient Name" not in str(
        header[COL_RECIPIENT_NAME]
    ):
        sys.exit(
            f"refusing: col AD header is {header[COL_RECIPIENT_NAME : COL_RECIPIENT_NAME + 1]!r}, "
            "expected 'Recipient Name'"
        )

    values, stats = [], Counter()
    for row in rows[1:]:
        email = norm(row[COL_OWNER_EMAIL]) if len(row) > COL_OWNER_EMAIL else ""
        session = (
            str(row[COL_STRIPE_SESSION]).strip()
            if len(row) > COL_STRIPE_SESSION
            else ""
        )
        name, source = "", ""
        if is_email(email) and email in name_by_email:
            name, source = name_by_email[email], prov[email]
        elif session and session in stripe:
            name, source = stripe[session], "stripe-session"
        values.append(name)
        stats[source or ("email-no-name" if is_email(email) else "no-email")] += 1

    print("\nresolution:")
    for key, count in stats.most_common():
        print(f"  {key:16s} {count}")
    total = sum(1 for v in values if v)
    print(f"  ---> resolved {total}/{len(values)}")

    print("\ndistinct recipients:")
    for name, count in Counter(v for v in values if v).most_common():
        print(f"  {count:4d}  {name}")

    if not args.commit:
        print("\n*** DRY RUN - nothing written. Pass --commit to write. ***")
        return

    result = (
        svc.spreadsheets()
        .values()
        .update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{QR_TAB}!AD1:AD{len(values) + 1}",
            valueInputOption="RAW",
            body={"values": [["Recipient Name"]] + [[v] for v in values]},
        )
        .execute()
    )
    check = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=f"{QR_TAB}!A:AD")
        .execute()
        .get("values", [])
    )
    written = sum(
        1
        for r in check[1:]
        if len(r) > COL_RECIPIENT_NAME and str(r[COL_RECIPIENT_NAME]).strip()
    )
    print(
        f"\nWROTE {result.get('updatedCells')} cells; verified non-blank AD = {written}"
    )
    if written != total:
        sys.exit(f"MISMATCH: expected {total}, verified {written}")


if __name__ == "__main__":
    main()
