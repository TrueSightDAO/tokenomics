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


def test_pr5_call_site_passes_farmer_and_resolved_charge():
    src = _src()
    assert "sunmintRow[TPL_SUNMINT_CONTRIBUTOR_NAME_COL], treeCharge)" in src
    assert "const TPL_SUNMINT_CONTRIBUTOR_NAME_COL = 9;" in src


def test_pr53a_charge_source_is_currencies_col_u_not_retail_or_farm_cost():
    """Q7v5: the infra charge is a DEDICATED Currencies column U - not col B (retail/AUM) nor col P."""
    src = _src()
    assert "const TPL_TREE_CHARGE_COL = 20;" in src
    assert "const TPL_CURRENCIES_TAB = 'Currencies';" in src
    body = src.split("function tplResolveTreeCharge_", 1)[1].split(
        "function tplResolveSource_", 1
    )[0]
    assert "TPL_MAIN_DAO_LEDGER_URL" in body, (
        "charge must come from the MAIN ledger's Currencies tab"
    )
    assert "TPL_TREE_CHARGE_COL" in body, "must read the dedicated charge column (U)"


def test_pr53a_charge_normalizes_and_fails_closed():
    """The fail-OPEN defect PR5 shipped (Number('1.5 BRL')===NaN) must be gone: normalize + fail closed."""
    src = _src()
    assert "function tplNormalizeAmount_" in src
    assert "Number(opts.amount)" not in src, "must normalize, not blindly Number()"
    body = src.split("function tplComputeLegs_", 1)[1].split(
        "function tplResolveSource_", 1
    )[0]
    assert "return [];" in body, "an unbookable charge must fail closed (no legs)"
    i = src.index("TPL_MAIN_LEDGER_LEDGER_URLS.includes(ledgerUrl)")
    j = src.index("tplResolveTreeCharge_(TPL_CUSTOMER_LIABILITY_LITERAL)")
    k = src.index("const ledgerBooked = appendTreePlantingLedgerFulfillment_")
    assert i < j < k, "charge resolved up front, before the QR/SunMint writes"


def test_pr5_managed_ledger_upfront_resolution_still_before_writes():
    """The pre-write ledger resolution guard must remain (no partial link)."""
    src = _src()
    i = src.index("resolveManagedLedgerSpreadsheetUrl_(ledgerUrl)")
    j = src.index("appendTreePlantingLedgerFulfillment_(")
    assert i < j, "ledger must be resolved before any write"


def test_pr6_plot_registry_is_the_farmer_source():
    """PR6: farmer identity must come from the plot registry, never the payload (Envoy 2026-09-20)."""
    src = _src()
    assert "function tplResolvePlotContributor_" in src
    assert "const TPL_PLOTS_CONTRIBUTOR_NAME_COL = 19;" in src
    body = src.split("function tplResolvePlotContributor_", 1)[1].split(
        "\nfunction ", 1
    )[0]
    assert "TPL_PLOTS_TAB" in body, "must read the SunMint Plots registry"


def test_pr6_fails_closed_without_registered_contributor():
    body = (
        _src()
        .split("function tplResolvePlotContributor_", 1)[1]
        .split("\nfunction ", 1)[0]
    )
    assert "catch" in body, "must never throw (fail closed)"
    assert "return null" in body, "must fail closed (null) on unknown/unattributed plot"


def test_pr6_linked_plot_id_column_is_ac():
    src = _src()
    assert "const TPL_LINKED_PLOT_ID_COL = 28;" in src


def test_pr6_image_selection_is_pure_and_has_video_fallback():
    src = _src()
    body = src.split("function tplPickPlotImage_", 1)[1].split("\nfunction ", 1)[0]
    assert "SpreadsheetApp" not in body and "UrlFetchApp" not in body, (
        "tplPickPlotImage_ must stay I/O-free"
    )
    assert "thumbnail" in body, (
        "must fall back to a video thumbnail when a plot has no stills"
    )


def test_pr6_plot_branch_uses_pr5_booker_and_skips_transfer_amount():
    """A plot has no per-tree cost, so the pool-source transfer amount is unbookable (no cash legs)."""
    src = _src()
    branch = src.split("if (!parsed.sunmintMessageId && parsed.plotId)", 1)[1]
    branch = branch.split("continue;\n      }", 1)[0]
    assert "appendTreePlantingLedgerFulfillment_(" in branch
    assert "plot.contributorName, plotCharge)" in branch, (
        "PR6.2: a plot link books the resolved col-U charge, same as a tree-level link"
    )
    assert (
        "plotCharge = tplResolveTreeCharge_(TPL_CUSTOMER_LIABILITY_LITERAL)" in branch
    ), "PR6.2: the plot charge is resolved via the SAME col-U helper"
    assert "TPL_LINKED_PLOT_ID_COL" in branch


def test_pr6_guard_allows_plot_id_without_sunmint_id():
    src = _src()
    assert "(!parsed.sunmintMessageId && !parsed.plotId)" in src, (
        "the early guard must accept a Plot ID in place of a SunMint submission id"
    )


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


def test_pr62_plot_eligibility_filter_excludes_invalidated():
    """Q6: a plot is linkable ONLY while not invalidated - the resolver must reject Status='invalid'."""
    src = _src()
    assert "const TPL_PLOTS_STATUS_COL = 4;" in src
    assert "function tplIsPlotStatusInvalid_" in src
    body = src.split("function tplResolvePlotContributor_", 1)[1].split(
        "function tplIsPlotStatusInvalid_", 1
    )[0]
    assert "tplIsPlotStatusInvalid_(data[i][TPL_PLOTS_STATUS_COL])" in body, (
        "the registry lookup must filter invalidated plots"
    )
    assert "return null;" in body, "an invalidated plot fails closed"


def test_pr62_bad_target_hard_rejected_not_just_flagged():
    """Q3: a non-linkable plot is HARD-rejected (REJECTED outcome, result.rejected++), not booked."""
    src = _src()
    branch = src.split("if (!parsed.sunmintMessageId && parsed.plotId)", 1)[1].split(
        "const plotImage = tplResolvePlotImage_", 1
    )[0]
    assert "result.rejected++" in branch, "a bad plot target must hard-reject"
    assert "continue;" in branch
    assert "invalidated" in branch, "the reject reason must name the invalidated case"
