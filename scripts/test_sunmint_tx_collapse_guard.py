"""Guard tests for the SunMint tree-planting duplicate-COLLAPSE lever.

Run: python3 -m pytest scripts/test_sunmint_tx_collapse_guard.py -q

Why this exists
---------------
Gary, thread 35944 (2026-09-29): the live `SunMint Tree Planting` tab carried 254
rows but only 174 distinct `request_transaction_id` (col V) values -- 75 extra rows,
re-ingestion replays of the same signed submission. The going-forward txid dedup
(shipped #568, 2026-09-26) stops NEW duplicates but cannot remove rows already
written before it existed. This lever COLLAPSES pre-existing duplicates -- and
CRUCIALLY must never dedup a QR-linked tree away (Gary: "make sure the trees
already associated with QR code don't get dedup away").

These tests are derived from the source (grep-style invariants) plus a behavioral
run of scripts/sunmint_tx_collapse_harness.mjs under node, so the guarantees FAIL
LOUDLY if the lever is refactored to drop them.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROJECT = (
    REPO
    / "google_app_scripts"
    / "1Jp8qNIBCZaRTlmOmbJoJmYnSFyXtQkUHP2Qv5uqKZpt0Ugo-e25nhASF"
)
SINK = PROJECT / "process_tree_planting_telegram_logs.js"
CREDS = PROJECT / "Credentials.js"
HARNESS = REPO / "scripts" / "sunmint_tx_collapse_harness.mjs"

ACTION = "collapseSunMintTreeTxDuplicates"


def _src() -> str:
    return SINK.read_text(encoding="utf-8")


def _fn_body(name: str) -> str:
    src = _src()
    assert f"function {name}(" in src, f"missing function {name}"
    return src.split(f"function {name}(", 1)[1].split("\nfunction ", 1)[0]


def test_sink_file_exists():
    assert SINK.is_file(), f"missing sink: {SINK}"


def test_collapse_lever_exists():
    assert f"function {ACTION}(" in _src(), "the one-shot collapse lever must exist"


def test_collapse_dedups_on_request_transaction_id_not_transport_id():
    """The dedup key is the signed Request Transaction ID (col V), never the transport id."""
    body = _fn_body(ACTION)
    assert "SUNMINT_REQUEST_TX_HEADER" in body, (
        "must read the request_transaction_id column"
    )
    assert "Telegram Message ID" not in body, (
        "must NOT key the collapse on a transport id"
    )
    assert "Telegram Update ID" not in body, (
        "must NOT key the collapse on a transport id"
    )


def test_collapse_keeps_first_occurrence():
    body = _fn_body(ACTION)
    assert "seen[k] = r + 1; distinct++" in body, (
        "the FIRST occurrence of a txid must survive"
    )


def test_un_txid_rows_are_never_collapsed():
    body = _fn_body(ACTION)
    assert "if (!k) { untx++; continue; }" in body, (
        "rows without a txid must never be collapsed"
    )


def test_linked_row_guard_exists_and_covers_qr_columns():
    body = _fn_body("sunmintIsLinkedRow_")
    assert "/linked/i.test(name)" in body, (
        "any /linked/i column with a value marks a row linked"
    )
    assert "/^status$/i.test(name)" in body and "assigned_to_tree" in body, (
        "a linked Status value (LINKED / ASSIGNED_TO_TREE) must also mark a row linked"
    )


def test_collapse_grafts_linkage_onto_survivor_before_deleting():
    """A duplicate carrying a link that the survivor lacks is GRAFTED, never dropped."""
    body = _fn_body(ACTION)
    assert "grafts.push({ target: keptRow, source: r + 1 })" in body, (
        "a linked duplicate must be grafted onto the survivor"
    )
    assert "linkedProtected++" in body
    # graft happens BEFORE the delete loop
    i_graft = body.index("Graft linkage onto the survivor FIRST")
    i_del = body.index("deleteRow(toDelete[d])")
    assert i_graft < i_del, (
        "the linkage must be grafted BEFORE the duplicate is deleted"
    )


def test_both_linked_is_ambiguous_and_keeps_both():
    body = _fn_body(ACTION)
    assert "if (dupLinked && keptLinked) { linkedProtected++; continue; }" in body, (
        "if BOTH rows carry a link the duplicate is left in place (never silently drop a linkage)"
    )


def test_destructive_path_is_preview_by_default():
    body = _fn_body(ACTION)
    assert "const apply = !dryRun;" in body, "apply must be opt-in (dryRun default)"


def test_collapse_returns_counts_only():
    body = _fn_body(ACTION)
    for field in (
        "collapsed",
        "distinctTxIds",
        "grafted",
        "linkedProtected",
        "untxRow",
    ):
        assert field in body, f"summary must report {field}"
    # never echo a txid string back
    assert "requestTxId:" not in body, "must not return txid strings"


def test_collapse_takes_the_script_lock():
    body = _fn_body(ACTION)
    assert "LockService.getScriptLock()" in body, (
        "the destructive lever must serialize via the script lock"
    )


def test_router_exposes_collapse_governor_gated():
    src = _src()
    assert f"action === '{ACTION}'" in src, (
        "the doGet router must expose the collapse action"
    )
    branch = src.split(f"action === '{ACTION}'", 1)[1].split(
        "return ContentService", 1
    )[0]
    assert "isAuthorizedGovernorReadRequest_" in branch, (
        "the destructive action must be governor-key gated"
    )
    assert "collapseSunMintTreeTxDuplicates(" in src


def test_behavioral_harness():
    node = shutil.which("node")
    if node is None:
        import pytest

        pytest.skip("node not available")
    proc = subprocess.run(
        [node, str(HARNESS), str(SINK), str(CREDS)],
        capture_output=True,
        text=True,
        cwd=str(REPO),
        check=False,
    )
    assert proc.returncode == 0, (
        f"collapse harness failed:\n{proc.stdout}\n{proc.stderr}"
    )
    assert "0 failed" in proc.stdout
