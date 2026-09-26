"""Privacy-guard tests for the payout-registration sink (SS11 rewrite, 2026-09).

Run: python3 -m pytest scripts/test_payout_registration_privacy_guard.py -q

Why this exists
---------------
A PIX key in Brazil is frequently a CPF (national ID) and the CRF Anapu cohort
includes minors, so a plaintext PIX key must never reach a publicly-republished
surface. Edgar writes every signed payload into `Telegram Chat Logs` col G. That
workbook WAS republished by ADVISORY_SNAPSHOT and the
`truesight.me/notarizations` redirect, but was ACL-privatised 2026-09-18 (no
anyone/link/domain grant; anonymous gviz/edit/export = 401). On that basis Gary
approved SS11.3-bis (2026-09-25): a raw-PIX MIRROR tab on that same workbook, so
that farmers OUTSIDE the CFR cohort (CFR is a subset of SunMint) are payable from
one navigable surface. If the workbook is ever republished again, the mirror tab
must be excluded from the projection.

SS11.2 (Gary, 2026-09-17) changed the posture from **encryption** to **privacy by
location**: the raw PIX is stored *plaintext*, but ONLY in the private,
governor-only `cfr program` spreadsheet, which is never link-shared and never
republished. There is no RSA-OAEP cipher and no governor-private-key step (the
`pix_key_cipher` column is dropped).

So the guard is no longer "refuse a raw key" -- it is:

    (a) a raw key is written to the private `cfr program` sheet AND, on Gary's
        2026-09-25 decision (SS11.3-bis), to the schema-identical MIRROR tab on the
        intake workbook -- which is safe ONLY because that workbook is private-by-ACL;
    (b) the `Telegram Chat Logs` TAB itself is NEVER written to (read-only); the
        mirror tab is a dedicated, separate tab;
    (c) the derived display-safe mask never echoes the raw value;
    (d) the read endpoint never returns the plaintext key; and
    (e) the same Telegram record is never processed twice.

These tests are *derived from the sources* (grep-style invariants) plus a
behavioral run of `scripts/payout_registration_guard_harness.mjs` under node when
a node binary is available, so the guarantees fail loudly if the sink is ever
refactored to drop them.
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
SINK = PROJECT / "process_payout_registration_telegram_logs.js"
ROUTER = PROJECT / "qr_code_web_service.js"
HARNESS = REPO / "scripts" / "payout_registration_guard_harness.mjs"

EVENT_TAG = "[PAYOUT REGISTRATION]"
SA = "agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com"
INTAKE_ID = "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ"


def _src() -> str:
    return SINK.read_text(encoding="utf-8")


def test_sink_file_exists():
    assert SINK.is_file(), f"missing sink: {SINK}"


def test_event_tag_declared():
    assert EVENT_TAG in _src()


def test_canonical_intake_workbook_identified():
    src = _src()
    assert INTAKE_ID in src
    assert "Telegram Chat Logs" in src


def test_private_cfr_program_sheet_is_resolved_by_script_property():
    src = _src()
    # SS11.8: the private sheet id is a governor-gated provisioning value.
    assert "CFR_PROGRAM_SPREADSHEET_ID" in src
    assert "PropertiesService.getScriptProperties" in src
    assert "payoutRegCfrProgramSpreadsheet_" in src


def test_four_canonical_tabs_declared():
    src = _src()
    for tab in (
        "payout registrations",
        "tree planting",
        "tree monitoring",
        "plot registrations",
    ):
        assert f"'{tab}':" in src, f"missing tab {tab}"


def test_dedup_keyed_on_telegram_update_id():
    src = _src()
    assert "seenUpdateId" in src
    assert re.search(r"seenUpdateId\[updateId\]", src), "no per-update-id skip"


def test_lock_serialises_entry_point():
    src = _src()
    assert "LockService.getScriptLock" in src
    assert ".tryLock(" in src and "releaseLock" in src


def test_telegram_chat_logs_tab_is_read_only():
    """The sink writes to the PRIVATE sheet, and NEVER to the `Telegram Chat Logs` TAB."""
    src = _src()
    # Canonical writes go through the private-sheet handle (`cfr`).
    assert "var cfr = payoutRegCfrProgramSpreadsheet_()" in src
    assert "ensurePayoutRegistrationsSheet_(cfr)" in src
    assert not re.search(r"ensurePayoutRegistrationsSheet_\(intake\)", src)
    assert not re.search(r"\bintake\.insertSheet\b", src)
    assert not re.search(r"\btcSheet\.appendRow\b", src)


def test_ss113bis_mirror_tab_is_written_on_the_intake_workbook():
    """SS11.3-bis (Gary 2026-09-25): the schema-identical MIRROR tab is written too."""
    src = _src()
    assert "PAYOUT_REG_MIRROR_SHEET" in src
    assert "appendPayoutRegistrationMirrorRow_" in src
    # the mirror is passed the intake handle, and reuses the shared upsert helper
    assert re.search(r"appendPayoutRegistrationMirrorRow_\(intake,", src)
    assert "upsertPayoutRegistrationRow_" in src
    # a mirror failure must never block the canonical private write (defensive try)
    assert re.search(
        r"try \{\s*appendPayoutRegistrationMirrorRow_\(intake, base\);", src
    )


def test_payout_tab_carries_plaintext_pix_and_drops_the_cipher():
    src = _src()
    assert "'pix_key'," in src  # plaintext column, private sheet only (SS11.2)
    assert "'pix_key_masked'," in src  # display-safe echo
    assert "'pix_key_cipher'" not in src, "SS11.2 dropped the RSA cipher column"
    assert "REJECTED_UNSAFE_KEY" not in src, "the refuse-a-raw-key guard is superseded"


def test_mask_is_derived_and_never_echoes_the_raw_value():
    src = _src()
    assert "payoutRegMaskKey_" in src
    # the mask helper must not be a passthrough of the raw key
    fn = src[
        src.index("function payoutRegMaskKey_") : src.index(
            "function processPayoutRegistrations"
        )
    ]
    assert "slice(-2)" in fn or "slice(-4)" in fn


def test_shared_service_account_recorded():
    assert SA in _src()


def test_read_endpoint_does_not_return_the_plaintext_key():
    src = _src()
    fn = src[src.index("function getPendingPayoutRegistrations") :]
    assert not re.search(r"pix_key:\s*String\(", fn), "read endpoint leaks the raw key"


def test_router_wires_both_actions():
    src = ROUTER.read_text(encoding="utf-8")
    assert "processPayoutRegistrationsFromTelegramChatLogs" in src
    assert "getPendingPayoutRegistrations" in src


def test_backfill_lever_defined_and_routed():
    """SS11.3 + SS11.3-bis normalisation lever exists and is reachable over HTTP."""
    assert "function backfillPayoutRegistrations(" in _src()
    assert "backfillPayoutRegistrations" in ROUTER.read_text(encoding="utf-8")
    # the lever must reuse the shared mirror upsert (never a bespoke writer)
    assert "appendPayoutRegistrationMirrorRow_(intake, p)" in _src()


def test_behavioral_harness():
    node = shutil.which("node")
    if node is None:
        import pytest

        pytest.skip("node not available")
    proc = subprocess.run(
        [node, str(HARNESS), str(SINK)],
        capture_output=True,
        text=True,
        cwd=str(REPO),
        check=False,
    )
    assert proc.returncode == 0, f"guard harness failed:\n{proc.stdout}\n{proc.stderr}"
    assert "0 failed" in proc.stdout
