"""Guard tests for the CFR-program submission sink (SS11.5, gap closed 2026-09-24).

Run: python3 -m pytest scripts/test_cfr_program_submission_guard.py -q

Why this exists
---------------
CRF_ANAPU_SUNMINT_COHORT_PROPOSAL.md SS11.5 (Gary, 2026-09-17) says the SAME GAS
doGet that ingests SunMint tree/monitoring/plot submissions must ALSO populate the
private, governor-only `cfr program` sheet (SS11.3 tabs `tree planting` /
`tree monitoring` / `plot registrations`).

The PAYOUT half of SS11 shipped, but the tree/monitoring/plot half was only
PROVISIONED (headers by scripts/provision_cfr_program_sheet.py) -- there was no
writer, so those three tabs stayed permanently empty (reported by Gary 2026-09-24).

These tests are derived from the sources (grep-style invariants) plus a behavioral
run of scripts/cfr_program_submission_guard_harness.mjs under node, so the
guarantees fail loudly if the scanner is refactored to drop them.
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
SINK = PROJECT / "process_cfr_program_submission_telegram_logs.js"
PAYOUT = PROJECT / "process_payout_registration_telegram_logs.js"
ROUTER = PROJECT / "qr_code_web_service.js"
HARNESS = REPO / "scripts" / "cfr_program_submission_guard_harness.mjs"

ACTION = "processCfrProgramSubmissionsFromTelegramChatLogs"
INTAKE_ID = "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ"
ORIGIN = "cfr.truesight.me"


def _src() -> str:
    return SINK.read_text(encoding="utf-8")


def test_sink_file_exists():
    assert SINK.is_file(), f"missing sink: {SINK}"


def test_scans_the_three_event_families():
    src = _src()
    for tag in (
        "[TREE PLANTING EVENT]",
        "[TREE GROWTH MONITORING EVENT]",
        "[FARM BOUNDARY EVIDENCE EVENT]",
    ):
        assert tag in src, f"missing event tag {tag}"


def test_writes_the_three_ss113_tabs():
    src = _src()
    for tab in ("tree planting", "tree monitoring", "plot registrations"):
        assert f"'{tab}'" in src, f"missing tab {tab}"


def test_never_touches_the_payout_tab():
    """The payout tab is owned solely by the sibling scanner (no double-write)."""
    src = _src()
    assert "'payout registrations'" not in src
    assert "'payout events'" not in src


def test_canonical_intake_workbook_identified():
    src = _src()
    assert INTAKE_ID in src
    assert "Telegram Chat Logs" in src


def test_attribution_gate_on_cfr_origin_host():
    """SS11.5: only submissions that came through cfr.truesight.me are mirrored."""
    src = _src()
    assert ORIGIN in src
    assert "cfrSubIsCfrOrigin_" in src
    assert "submission_source" in src


def test_private_cfr_program_sheet_is_resolved_by_script_property():
    """Reuses the payout scanner's resolver (single source for the private sheet id)."""
    src = _src()
    assert "payoutRegCfrProgramSpreadsheet_" in src


def test_dedup_keyed_on_telegram_update_id():
    src = _src()
    assert "cfrSubSeenUpdateIds_" in src
    assert re.search(r"seen\[tab\]\[updateId\]", src), "no per-update-id skip"


def test_lock_serialises_entry_point():
    src = _src()
    assert "LockService.getScriptLock" in src
    assert ".tryLock(" in src and "releaseLock" in src


def test_public_intake_is_read_only_not_a_write_target():
    """Reads the public intake; writes only to the private `cfr` handle."""
    src = _src()
    assert not re.search(r"\bintake\.insertSheet\b", src)
    assert not re.search(r"\btcSheet\.appendRow\b", src)
    assert "payoutRegCfrProgramSpreadsheet_()" in src


def test_pk_hash_is_derived_not_raw_signature():
    """Only a one-way pk-hash is stored -- never the raw public key (privacy)."""
    src = _src()
    assert "cfrSubDerivePkHash_" in src
    assert "base64EncodeWebSafe" in src
    # the raw public_signature must never be written to a column
    assert not re.search(r"p\.public_signature", src)


def test_terminator_stops_field_accumulation():
    """Regression: the `--------` terminator must reset lastKey so the trailing
    My Digital Signature / footer prose is not folded into the last real field."""
    src = _src()
    assert re.search(r"line === '--------'\)\s*\{\s*lastKey = null", src)
    payout = PAYOUT.read_text(encoding="utf-8")
    assert re.search(r"line === '--------'\)\s*\{\s*lastKey = null", payout), (
        "the sibling payout scanner has the same bug (submission_source polluted live)"
    )


def test_router_wires_the_action():
    src = ROUTER.read_text(encoding="utf-8")
    assert ACTION in src


def test_behavioral_harness():
    node = shutil.which("node")
    if node is None:
        import pytest

        pytest.skip("node not available")
    proc = subprocess.run(
        [node, str(HARNESS), str(PAYOUT), str(SINK)],
        capture_output=True,
        text=True,
        cwd=str(REPO),
        check=False,
    )
    assert proc.returncode == 0, f"guard harness failed:\n{proc.stdout}\n{proc.stderr}"
    assert "0 failed" in proc.stdout
