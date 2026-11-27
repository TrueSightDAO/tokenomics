#!/usr/bin/env python3
"""RETIRED 2026-11-27 -- DO NOT RUN. This script no longer does anything.

Governor decision: the `Recipient Name` (AD) column on the `Agroverse QR codes`
tab is HAND-WRITTEN ONLY. It must never be populated by automation.

WHY THIS WAS RETIRED
--------------------
This script derived a recipient name by joining a bag's `Owner Email` (col L)
against five name registries. That is INFERENCE, and inference here is wrong for
three concrete reasons observed on the live sheet:

1. It contradicts the issued certificates. The SunMint "Certificate of Tree
   Guardianship" PDFs name the recipient explicitly in the artwork. This script
   produced different names for the same bags:

       certificate says                     script wrote                row
       ---------------                      ------------                ---
       Green Gulch Farm Zen Center     ->   "Milena - green gulch"      980
       Nora Haron                      ->   "Nora - Kopi Bar & Bakery"  176
       Will Chen                       ->   (blank, no match)          1261

2. An account email is not a person. `ewong@gogreatop.com` is the account
   holder for THREE distinct certificate recipients (Elizabeth Wong, Gaia Lu,
   Aria Lu). Collapsing them to one name destroys exactly the distinction this
   column exists to preserve. The script wrote "Elizabeth Wong" across 82 rows
   and "David Campbell" across 40 on this basis.

3. It silently overwrote hand-entered data. A `--commit` run replaced 14
   certificate-backed names with 172 inferred ones. That had to be undone twice.

So this is not a bug to fix -- the approach itself was rejected. Leaving a
fixable version here would invite someone to "improve" the join and re-run it.

THE RULE THAT REPLACES IT
-------------------------
`Recipient Name` may be populated ONLY from a source document that explicitly
names the recipient -- currently the printed SunMint certificate. Never from
Owner Email, never from a registry join, never from a Stripe customer name.

If no certificate (or equivalent explicit naming) exists, LEAVE THE CELL BLANK.
A blank means "no named recipient on record", which is a true statement. A
plausible-but-wrong name is a false record that looks authoritative.

The write path for future certificates lives in
`process_qr_code_updates.js` (`[QR CODE UPDATE EVENT]` + `Recipient Name:`),
which records the name at issue time from the source document.

HISTORY
-------
Original implementation and its five-registry join remains in git history.
Retired by governor instruction on 2026-11-27.
"""

import sys

RETIRED_MESSAGE = """
populate_recipient_name.py is RETIRED -- it does nothing and will not write.

The `Recipient Name` (AD) column on `Agroverse QR codes` is HAND-WRITTEN ONLY,
by governor decision (2026-11-27). Names may only come from a document that
explicitly names the recipient (the SunMint certificate). Deriving them from
`Owner Email` is not permitted: one account email can cover several people, and
the inferred name contradicts the certificate in at least three known cases.

If you need to record a recipient name, either:
  * edit column AD by hand, or
  * submit a [QR CODE UPDATE EVENT] carrying a `Recipient Name:` line, which
    process_qr_code_updates.js records at issue time.

Leaving the cell blank is CORRECT when no certificate names a recipient.
"""


def main():
    sys.stderr.write(RETIRED_MESSAGE)
    return 2


if __name__ == "__main__":
    sys.exit(main())
