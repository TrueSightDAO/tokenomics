"""Guard tests for the `[PAYOUT EVENT]` sink (SS12.7 Q3b, 2026-09).

Run: python3 -m pytest scripts/test_payout_event_guard.py -q

Why this exists
---------------
A `[PAYOUT REGISTRATION]` is a planter declaring where to be paid; a
`[PAYOUT EVENT]` is the RECEIPT of an outbound PIX transfer that actually
occurred. Both land on the canonical (publicly republished) Telegram Chat Logs
intake, so the sink's guarantees are the load-bearing safety properties:

  (a) Tier-1 `payouts` is written on the Ops workbook for ANY source;
  (b) Tier-2 `payout events` is written on the PRIVATE `cfr program` sheet only
      for CFR events (program_slug == 'crf-anapu' or host == cfr.truesight.me);
  (c) a transfer with no `bank_ref` is refused (nothing to reconcile);
  (d) DEDUP layer 1: the col R gate `PROCESSED:PAYOUT_EVENT`; and
  (e) DEDUP layer 2: a retried POST reusing the same `bank_ref` under a NEW
      `telegram_update_id` (Edgar mints a fresh id per POST, so the DApp's
      submitWithRetry(attempts:3) can do exactly this on a lost confirmation)
      is NOT booked twice. (e) is the criterion that makes the 3x retry safe.

These are grep-style source invariants plus a behavioral run of
`scripts/payout_event_guard_harness.mjs` under node when available.
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
SINK = PROJECT / "process_payout_event_telegram_logs.js"
ROUTER = PROJECT / "qr_code_web_service.js"
HARNESS = REPO / "scripts" / "payout_event_guard_harness.mjs"

ACTION = "processPayoutEventsFromTelegramChatLogs"
EVENT_TAG = "[PAYOUT EVENT]"
INTAKE_ID = "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ"


def _src() -> str:
    return SINK.read_text(encoding="utf-8")


def test_sink_file_exists():
    assert SINK.is_file(), f"missing sink: {SINK}"


def test_event_tag_declared():
    assert EVENT_TAG in _src()


def test_action_name_matches_edgar_dispatch_contract():
    # dao_protocol dispatch SS12.7 Q3a maps [PAYOUT EVENT] -> this GAS action.
    assert ACTION in _src()
    assert ACTION in ROUTER.read_text(encoding="utf-8")


def test_ops_workbook_is_the_intake_workbook():
    assert INTAKE_ID in _src()
    assert "Telegram Chat Logs" in _src()


def test_private_cfr_program_sheet_resolved_by_script_property():
    src = _src()
    assert "CFR_PROGRAM_SPREADSHEET_ID" in src
    assert "PropertiesService.getScriptProperties" in src
    assert "payoutEventCfrProgramSpreadsheet_" in src


def test_tier_headers_match_provisioner():
    """SS12.3: the sink's headers MUST equal scripts/provision_cfr_program_sheet.py."""
    src = _src()
    for col in (
        "created_at_utc",
        "telegram_update_id",
        "program_slug",
        "submission_source",
        "recipient_pk_hash",
        "amount",
        "currency",
        "tree_planting_id",
        "bank_ref_type",
        "bank_ref",
        "paid_at",
        "receipt_url",
        "status",
        "supersedes_row",
        "error_message",
    ):
        assert f"'{col}'" in src, f"missing Tier-1 column {col}"
    assert "PAYOUT_EVENT_TIER1_HEADERS.concat(['cohort', 'student_ref'])" in src
    for tab in ("'payouts'", "'payout events'"):
        assert tab in src, f"missing tab {tab}"


def test_dedup_layer1_col_r_gate():
    src = _src()
    assert "PROCESSED:PAYOUT_EVENT" in src
    assert "PAYOUT_EVENT_TC_DEDUP_COL" in src
    assert "markPayoutEventProcessed_" in src


def test_dedup_layer2_business_key_bank_ref():
    """The retry guard: a bank_ref already booked must not be re-booked."""
    src = _src()
    assert "payoutEventCollectBankRefs_" in src
    assert "seenBankRefs" in src
    assert "DUPLICATE_BANK_REF" in src
    assert re.search(r"if \(seenBankRefs\[base\.bank_ref\]\)", src), (
        "no bank_ref dedup branch"
    )


def test_refuses_missing_bank_ref():
    src = _src()
    assert "REJECTED_MISSING_BANK_REF" in src


def test_cfr_routing_by_slug_and_host():
    src = _src()
    assert "payoutEventIsCfr_" in src
    assert "'crf-anapu'" in src
    assert "cfr.truesight.me" in src


def test_hourly_trigger_installer_is_called_from_entry_point():
    """The hourly cron is the fallback when Edgar's webhook URL is unset.

    deploy regression 2026-09-18: ensurePayoutEventHourlyTriggerInstalled_() was
    defined but never CALLED, so with DAO_PROTOCOL_WEBHOOK_PAYOUT_PROCESSING unset
    (its state at merge time) events would never be processed at all.
    """
    src = _src()
    body = src.split("function processPayoutEventsFromTelegramChatLogs()", 1)[1]
    body = body.split("function markPayoutEventProcessed_", 1)[0]
    assert "ensurePayoutEventHourlyTriggerInstalled_()" in body, (
        "trigger installer not called from entry point"
    )


def test_lock_serialises_entry_point():
    src = _src()
    assert "LockService.getScriptLock" in src
    assert ".tryLock(" in src and "releaseLock" in src


def test_read_endpoint_is_exposed_for_review():
    assert "getPayoutEvents" in ROUTER.read_text(encoding="utf-8")


def test_pr4_pure_leg_computation_present():
    """PR4 (step 1): the SS0.11 leg arithmetic is a pure, I/O-free function so the
    money logic is unit-testable before any sheet write is wired in."""
    src = _src()
    assert "function fpeComputeLegs_" in src
    body = src.split("function fpeComputeLegs_", 1)[1].split("\nfunction ", 1)[0]
    assert "SpreadsheetApp" not in body, "fpeComputeLegs_ must stay I/O-free"
    for literal in (
        "Cacao Tree - To Be Paid For",
        "Cacao Tree Planted - Unassigned",
    ):
        assert literal in src
    assert "FPE_MAIN_LEDGER_SPREADSHEET_ID" in src
    assert "'qr'" in src  # committed cross-ledger transfer targets the QR's own ledger


def test_pr4_ledger_booking_wired_and_fail_closed():
    """PR4 (step 2): the SunMint settlement booking is wired into the payout sink,
    runs before the Tier-1 tracking write, and fails closed."""
    src = _src()
    for fn in (
        "function fpeBookLedger_",
        "function fpeWriteLeg_",
        "function fpeFindSunMintRow_",
        "function fpeResolveQrLedgerUrl_",
        "function fpeResolveLedgerSpreadsheetUrl_",
    ):
        assert fn in src, f"missing {fn}"
    assert "LEDGER_NOT_BOOKED" in src
    assert "'BOOKED'" in src
    # the booking runs immediately before the Tier-1 tracking write
    i = src.index("fpeBookLedger_(base)")
    j = src.index("appendPayoutEventRow_(tier1Sheet, base, false)")
    assert i < j, "booking must precede the Tier-1 tracking write"
    body = src.split("function fpeBookLedger_", 1)[1].split("\nfunction ", 1)[0]
    assert "catch" in body, "fpeBookLedger_ must never throw (fail closed to LEDGER_NOT_BOOKED)"


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


def test_manifest_declares_trigger_scope():
    """Regression: the installer calls ScriptApp.getProjectTriggers(), which the
    live webapp was DENIED ("You do not have permission to call
    ScriptApp.getProjectTriggers ... /auth/script.scriptapp") because the
    manifest declared no oauthScopes. Without this scope #513's hourly-cron
    fallback silently never installs."""
    import json

    manifest = json.loads((PROJECT / "appsscript.json").read_text())
    scopes = manifest.get("oauthScopes")
    assert scopes, "appsscript.json must declare oauthScopes explicitly"
    for required in (
        "https://www.googleapis.com/auth/script.scriptapp",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/script.external_request",
    ):
        assert required in scopes, f"missing scope {required}"


def test_manifest_declares_documents_scope():
    """Regression (2026-09-24): processBatch calls DocumentApp.openById, but the
    manifest omitted the `documents` scope, so every live run failed with
    "Specified permissions are not sufficient to call DocumentApp.openById"."""
    import json

    manifest = json.loads((PROJECT / "appsscript.json").read_text())
    scopes = manifest.get("oauthScopes") or []
    assert "https://www.googleapis.com/auth/documents" in scopes, (
        "appsscript.json must declare the documents scope (processBatch uses DocumentApp)"
    )


def test_trigger_installer_reports_status():
    """The installer must report its outcome so the hourly-cron fallback is
    verifiable from the action's own JSON response (no log access needed)."""
    src = SINK.read_text()
    m = re.search(
        r"function ensurePayoutEventHourlyTriggerInstalled_\(\) \{(.*?)\n\}", src, re.S
    )
    assert m, "installer not found"
    body = m.group(1)
    assert "'present'" in body, "installer must return 'present' when already installed"
    assert "'installed'" in body, "installer must return 'installed' on create"
    assert "catch" in body, "installer must not throw (report error status instead)"


def test_trigger_status_surfaced_in_response():
    """Both the early (empty-intake) and main returns must include `trigger:`."""
    src = SINK.read_text()
    n = len(re.findall(r"trigger:\s*triggerStatus", src))
    assert n >= 2, f"expected trigger status surfaced in both returns, found {n}"
