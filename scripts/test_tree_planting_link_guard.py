"""PR5 guards for process_tree_planting_link.js (plan 1.3/1.4).

Grep-style source invariants plus a behavioral run of
`scripts/tree_planting_link_harness.mjs` under node when available.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROJECT = (
    REPO
    / "google_app_scripts"
    / "1UrBgqLnnQc6PV4-gMIDh2SYwWu62wTdSrV30xk9q_eVr2UdoxdzXN38v"
)
HANDLER = PROJECT / "process_tree_planting_link.js"
HARNESS = REPO / "scripts" / "tree_planting_link_harness.mjs"


def _src() -> str:
    return HANDLER.read_text(encoding="utf-8")


def test_handler_exists():
    assert HANDLER.is_file(), f"missing handler: {HANDLER}"


def test_pr5_pure_leg_computation_present_and_io_free():
    src = _src()
    assert "function tplComputeLegs_" in src
    body = src.split("function tplComputeLegs_", 1)[1].split("\nfunction ", 1)[0]
    assert "SpreadsheetApp" not in body, "tplComputeLegs_ must stay I/O-free"
    for literal in (
        "Cacao Tree To Be Planted",
        "Cacao Tree Planted - Unassigned",
    ):
        assert literal in src


def test_pr5_old_pair_removed():
    """The old fixed +1 'Cacao Tree Planted' asset write must be gone (plan 1.3)."""
    assert "'Cacao Tree Planted'" not in _src(), (
        "old +1 Cacao Tree Planted write still present"
    )


def test_pr5_source_discriminator_is_balance_derived():
    src = _src()
    assert "function tplResolveSource_" in src
    body = src.split("function tplResolveSource_", 1)[1].split("\nfunction ", 1)[0]
    assert "TPL_POOL_LITERAL" in body, "discriminator must read the pool literal"
    assert "'committed'" in body and "'pool'" in body


def test_pr5_transfer_only_when_ledgers_differ():
    """Plan 1.4: the reimbursement transfer fires ONLY when the QR routes to a non-main ledger."""
    body = _src().split("function tplComputeLegs_", 1)[1].split("\nfunction ", 1)[0]
    assert "qrRoutesToMain" in body
    # the cash legs are guarded by !qrRoutesToMain
    assert "!opts.qrRoutesToMain" in body


def test_pr5_never_throws_and_fails_closed():
    body = (
        _src()
        .split("function appendTreePlantingLedgerFulfillment_", 1)[1]
        .split("\nfunction ", 1)[0]
    )
    assert "catch" in body, "must never throw (fail closed)"
    assert "return false" in body


def test_pr5_writer_flags_partial_write_without_rollback():
    src = _src()
    assert "function tplWriteLegs_" in src
    body = src.split("function tplWriteLegs_", 1)[1].split("\nfunction ", 1)[0]
    assert "written" in body and "error" in body


def test_pr5_call_site_passes_farmer_and_cost():
    src = _src()
    assert (
        "sunmintRow[TPL_SUNMINT_CONTRIBUTOR_NAME_COL], sunmintRow[TPL_SUNMINT_COST_OF_TREE_COL])"
        in src
    )
    assert "const TPL_SUNMINT_CONTRIBUTOR_NAME_COL = 9;" in src
    assert "const TPL_SUNMINT_COST_OF_TREE_COL = 15;" in src


def test_pr5_managed_ledger_upfront_resolution_still_before_writes():
    """The pre-write ledger resolution guard must remain (no partial link)."""
    src = _src()
    i = src.index("resolveManagedLedgerSpreadsheetUrl_(ledgerUrl)")
    j = src.index("appendTreePlantingLedgerFulfillment_(")
    assert i < j, "ledger must be resolved before any write"


def test_behavioral_harness():
    node = shutil.which("node")
    if node is None:
        import pytest

        pytest.skip("node not available")
    proc = subprocess.run(
        [node, str(HARNESS), str(HANDLER)],
        capture_output=True,
        text=True,
        cwd=str(REPO),
        check=False,
    )
    assert proc.returncode == 0, f"link harness failed:\n{proc.stdout}\n{proc.stderr}"
    assert "0 failed" in proc.stdout
