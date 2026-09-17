"""Privacy-guard tests for the payout-registration sink.

Run: python3 -m pytest scripts/test_payout_registration_privacy_guard.py -q

Why this exists
---------------
A PIX key in Brazil is frequently a CPF (national ID) and the CRF Anapu cohort
includes minors, so a plaintext PIX key must never reach a publicly-republished
surface. Edgar writes every signed payload into `Telegram Chat Logs` col G, and
that workbook is republished by ADVISORY_SNAPSHOT and the public
`truesight.me/notarizations` redirect. This sink is therefore the choke point
that must (a) never persist a raw key, and (b) never process the same Telegram
record twice.

These tests are *derived from the sources* (grep-style invariants) plus one
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
PROJECT = REPO / "google_app_scripts" / "1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT"
SINK = PROJECT / "process_payout_registration_telegram_logs.js"
ROUTER = PROJECT / "qr_code_web_service.js"
HARNESS = REPO / "scripts" / "payout_registration_guard_harness.mjs"

EVENT_TAG = "[PAYOUT REGISTRATION]"
SA = "agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com"


def _src() -> str:
    return SINK.read_text(encoding="utf-8")


def test_sink_file_exists():
    assert SINK.is_file(), f"missing sink: {SINK}"


def test_event_tag_declared():
    assert EVENT_TAG in _src()


def test_canonical_intake_workbook():
    assert "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ" in _src()
    assert "Telegram Chat Logs" in _src()


def test_dedup_keyed_on_telegram_update_id():
    src = _src()
    # dedup reads the existing set from the tab and skips seen update ids
    assert "seenUpdateId" in src
    assert re.search(r"seenUpdateId\[updateId\]", src), "no per-update-id skip"


def test_lock_serialises_entry_point():
    src = _src()
    assert "LockService.getScriptLock" in src
    assert ".tryLock(" in src and "releaseLock" in src


def test_headers_carry_masked_and_cipher_but_never_raw_key_column():
    src = _src()
    assert "'pix_key_masked'" in src
    assert "'pix_key_cipher'" in src
    # a bare `pix_key` column would be the raw-key home we are forbidding
    assert "'pix_key'," not in src, "a raw pix_key column must not exist"


def test_refusal_status_present_and_clears_key_fields():
    src = _src()
    assert "REJECTED_UNSAFE_KEY" in src
    assert re.search(r"base\.pix_key_cipher = ''", src), "refusal must blank the cipher"


def test_shared_service_account_recorded():
    assert SA in _src()


def test_read_endpoint_does_not_return_the_cipher():
    src = _src()
    fn = src[src.index("function getPendingPayoutRegistrations") :]
    # the mapper must not expose pix_key_cipher (comment noting the omission is fine)
    assert not re.search(r"pix_key_cipher:\s*String\(", fn), "read endpoint leaks cipher"


def test_router_wires_both_actions():
    src = ROUTER.read_text(encoding="utf-8")
    assert "processPayoutRegistrationsFromTelegramChatLogs" in src
    assert "getPendingPayoutRegistrations" in src


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
    )
    assert proc.returncode == 0, f"guard harness failed:\n{proc.stdout}\n{proc.stderr}"
    assert "0 failed" in proc.stdout
