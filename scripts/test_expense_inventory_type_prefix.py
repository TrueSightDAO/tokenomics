"""Guard: the expense processor must never write a `[ledger]` routing prefix into
a target ledger's Column E (Inventory Type / Type).

Incident (reported by Gary, Telegram thread 23408, 2026-09-14): every expense
filed with an explicit `- Target Ledger: AGL16` line landed in the AGL16
Transactions tab with Column E reading the RAW routing string
`[AGL16] Brazilian Reis` instead of the clean `Brazilian Reis` (the value the
`Currencies!A` lookup and the connector expect). Gary had to hand-clean the
column repeatedly.

Root cause: in `InsertExpenseRecords()` the local `cleanInventoryType` starts as
the raw `expenseDetails.inventoryType`, and the `[ledger]` prefix was stripped
ONLY inside the `else` fallback branch (taken when neither Column M nor the
message carries a ledger). The normal path -- ledger resolved from Column M or
`- Target Ledger:` -- skipped that branch, so the prefixed string was written
verbatim to Column E.

This test is a *source-level* invariant (GAS can't be unit-executed here): after
the ledger-resolution if/else, the prefix strip must run UNCONDITIONALLY, i.e.
`cleanInventoryType` must be assigned from the prefix-strip regex outside any
`else`-only branch. It fails loudly if the strip regresses to a conditional.
"""

from __future__ import annotations

import re
from pathlib import Path

PROJECT = (
    Path(__file__).resolve().parent.parent
    / "google_app_scripts"
    / "19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC"
)
CODE = PROJECT / "Code.js"

STRIP_ASSIGN = (
    "cleanInventoryType = invTypePrefixMatch ? invTypePrefixMatch[2].trim()"
    " : cleanInventoryType"
)


def _src() -> str:
    assert CODE.is_file(), f"missing {CODE}"
    return CODE.read_text(encoding="utf-8", errors="replace")


def _function_body(src: str, name: str) -> str | None:
    m = re.search(r"function\s+" + re.escape(name) + r"\s*\(", src)
    if not m:
        return None
    i = src.find("{", m.end())
    if i < 0:
        return None
    depth = 0
    for j in range(i, len(src)):
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[m.start() : j + 1]
    return None


def test_insert_expense_records_strips_prefix_unconditionally() -> None:
    src = _src()
    body = _function_body(src, "InsertExpenseRecords")
    assert body is not None, "could not parse InsertExpenseRecords()"

    assert STRIP_ASSIGN in body, (
        "InsertExpenseRecords() no longer strips the `[ledger]` routing prefix "
        "from cleanInventoryType via an UNCONDITIONAL assignment. If the strip "
        "moved back inside the `else` fallback, a ledger resolved from Column M "
        "or `- Target Ledger:` will write the raw '[AGL16] Brazilian Reis' into "
        "the ledger's Column E again (see thread 23408)."
    )


def test_strip_happens_before_column_e_write() -> None:
    src = _src()
    body = _function_body(src, "InsertExpenseRecords")
    assert body is not None

    strip_at = body.find(STRIP_ASSIGN)
    assert strip_at != -1, "prefix strip assignment absent"

    # The two Column E write sites (managed ledger + offchain) both use
    # cleanInventoryType and must run AFTER the strip.
    e_write_managed = body.find("cleanInventoryType, // Column E: Type")
    e_write_offchain = body.find("cleanInventoryType // Column E: Inventory Type")
    for name, pos in (("managed", e_write_managed), ("offchain", e_write_offchain)):
        assert pos != -1, f"{name} Column E write site not found"
        assert strip_at < pos, (
            f"the prefix strip must run BEFORE the {name} Column E write, "
            "else the raw prefixed value is persisted"
        )
