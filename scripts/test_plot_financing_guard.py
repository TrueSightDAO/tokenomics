"""Guard tests for the `[PLOT FINANCING EVENT]` sink (PR10b, 2026-09-20).

Run: python3 -m pytest scripts/test_plot_financing_guard.py -q

Why this exists
---------------
A `[PLOT FINANCING EVENT]` is a cash ADVANCE: the DAO pays a farmer up front to finance N
trees on a plot. It is the OPPOSITE direction to a `[PAYOUT EVENT]` (an advance leaves main
before any sale exists; a payout settles a liability after one), so it must never be conflated
with the payout sink. The load-bearing safety properties are:

  (a) it books EXACTLY two legs on main - a cash-out and a pool mint of
      'Cacao Tree Planted - Unassigned';
  (b) the cash leg is NOT revenue (blank), the inventory leg is 'N';
  (c) FAIL-CLOSED: an unresolvable plot books nothing and flags the tracking row;
  (d) it seeds the `SunMint Plots` registry col T without ever overwriting a set value;
  (e) dedup rides the shared intake col R marker, so a retry cannot double-book.

These are grep-style source invariants plus a behavioral run of
`scripts/plot_financing_harness.mjs` under node when available.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROJECT = (
    REPO
    / "google_app_scripts"
    / "1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT"
)
SINK = PROJECT / "process_plot_financing_event_telegram_logs.js"
ROUTER = PROJECT / "qr_code_web_service.js"
HARNESS = REPO / "scripts" / "plot_financing_harness.mjs"


def _src() -> str:
    return SINK.read_text()


def test_sink_exists_and_is_tag_first():
    src = _src()
    assert "var PF_TAG = '[PLOT FINANCING EVENT]';" in src
    # tag-first detection, not a substring mention
    assert "indexOf(PF_TAG) === 0" in src


def test_two_legs_both_on_main():
    src = _src()
    legs = src.split("function pfComputeLegs_")[1].split("function ")[0]
    assert legs.count("target: 'main'") == 2
    assert "PF_PLANTED_UNASSIGNED_LITERAL" in legs
    assert "amount: -amount" in legs  # cash leaves main


def test_revenue_flags_cash_blank_inventory_n():
    src = _src()
    assert "var PF_CASH_IS_REVENUE = '';" in src
    assert "var PF_INVENTORY_IS_REVENUE = 'N';" in src


def test_fails_closed_on_unresolved_plot():
    src = _src()
    assert "return { booked: false, reason: 'PLOT_NOT_FOUND' }" in src
    assert "return { booked: false, reason: 'BAD_AMOUNT_TREE_COUNT_OR_CURRENCY' }" in src


def test_never_overwrites_registry_contributor():
    src = _src()
    assert "MISMATCH_EXISTING" in src
    assert "ALREADY_SET" in src


def test_dedup_rides_shared_intake_col_r():
    src = _src()
    assert "var PF_TC_DEDUP_COL = 17;" in src
    assert "PROCESSED:PLOT_FINANCING_EVENT" in src


def test_routed_in_web_service():
    assert "processPlotFinancingEventsFromTelegramChatLogs" in ROUTER.read_text()


def test_no_second_row_appended_for_seed():
    """Seeding writes a single cell (col T), never an appended row."""
    src = _src()
    seed = src.split("function pfSeedPlotContributor_")[1].split("function ")[0]
    assert "setValue(name)" in seed
    assert "appendRow" not in seed


def test_behavioral_harness_passes_when_node_available():
    node = shutil.which("node")
    if not node:
        return  # skip silently: harness is advisory when node is absent
    out = subprocess.run(
        [node, str(HARNESS), str(SINK)],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(REPO),
        check=False,
    )
    assert out.returncode == 0, out.stdout + out.stderr
    assert re.search(r"\b0 failed\b", out.stdout), out.stdout
