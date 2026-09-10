"""Unit tests for the Telegram-log processor LockService guard.

Run: python3 -m pytest scripts/test_telegram_log_processor_lock.py -q

Covers the 2026-09-10 incident class fixed in tokenomics #469/#471/#472: a
Telegram-log processor that reads its dedup set ("process this Message ID?")
from a tracking tab and *then* appends to it, with no mutual exclusion. Two
concurrent fires (webhook + hourly cron, or webhook + webhook) both observe an
empty set and each append a tracking row for the SAME Telegram Message ID --
observed in production in `process_plot_invalidation.gs` (two rows 0.39 s
apart, identical msgId).

The fix is a `LockService.getScriptLock()` wrapper around each such entry
point. These tests assert that invariant holds, and FAIL LOUDLY if a future
processor grows the read-then-append shape without taking the lock.

Design note: the expectations are *derived from the sources*, not a hardcoded
file list, so adding a new racy processor trips the guard automatically.
"""

from __future__ import annotations

import re
from pathlib import Path

PROJECT = (
    Path(__file__).resolve().parent.parent
    / "google_app_scripts"
    / "1UrBgqLnnQc6PV4-gMIDh2SYwWu62wTdSrV30xk9q_eVr2UdoxdzXN38v"
)

# Files whose entry point dispenses child calls (the doGet router) or which
# have no dedup state at all. They must NOT take the script lock -- a router
# that held the lock would deadlock its own children (GAS locks are not
# reentrant). Kept as an explicit allowlist so the reason is reviewable.
INTENTIONALLY_UNLOCKED = {"process_qr_code_updates.js", "process_tree_planting_link.js"}

# The read-then-append shape: a per-processor "which Message IDs have I already
# seen?" reader plus an append of the tracking row.
DEDUP_HELPER_RE = re.compile(r"function\s+(getProcessed[A-Za-z]*MessageIds_)\s*\(")
ENTRY_RE = re.compile(r"function\s+(process[A-Za-z]*FromTelegramChatLogs)\s*\(")
LOCK_CALL = "LockService.getScriptLock"


def _project_files() -> list[Path]:
    if not PROJECT.is_dir():
        return []
    return sorted(PROJECT.glob("*.gs")) + sorted(PROJECT.glob("*.js"))


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _function_body(src: str, name: str) -> str | None:
    """Return the full body of `function <name>(...) {...}` via brace matching.

    Returns None when the function is absent. GAS sources are brace-balanced
    (there are no brace-bearing string literals in these handlers), so a simple
    depth counter is sufficient and avoids pulling in a JS parser.
    """
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


def _all_text() -> dict[str, str]:
    return {p.name: _read(p) for p in _project_files()}


def _racy_processors() -> dict[str, str]:
    """name -> filename for every entry point that owns a read-then-append dedup.

    A processor is "racy" when the file defines a `getProcessed*MessageIds_`
    helper AND appends rows -- i.e. the exact window the lock closes.
    """
    out: dict[str, str] = {}
    for fname, src in _all_text().items():
        if not DEDUP_HELPER_RE.search(src):
            continue
        if "appendRow(" not in src:
            continue
        for name in ENTRY_RE.findall(src):
            out[name] = fname
    return out


# ── the guard ──────────────────────────────────────────────────────────────────────────


def test_project_dir_exists() -> None:
    files = _project_files()
    assert files, f"no GAS sources found at {PROJECT}"
    assert any(f.name == "process_plot_invalidation.gs" for f in files)


def test_every_racy_processor_takes_the_script_lock() -> None:
    """Each read-then-append entry point must serialize via LockService."""
    racy = _racy_processors()
    assert racy, "expected to find the read-then-append processors; discovery broke"

    unlocked = []
    for name, fname in sorted(racy.items()):
        body = _function_body(_all_text()[fname], name)
        assert body is not None, f"{fname}: could not parse body of {name}"
        if LOCK_CALL not in body:
            unlocked.append(f"{fname}:{name}")

    assert not unlocked, (
        "Telegram-log processor(s) read-then-append their dedup set WITHOUT "
        "taking LockService.getScriptLock() -> concurrent webhook/cron fires "
        "can append duplicate tracking rows for the same Message ID. "
        "Wrap the entry point the same way as the #469/#471/#472 family. "
        f"Unlocked: {unlocked}"
    )


def test_lock_wrapper_is_released_in_finally() -> None:
    """A tryLock without a finally release wedges the script until TTL expiry."""
    problems: list[str] = []
    for fname, src in sorted(_all_text().items()):
        for name in ENTRY_RE.findall(src):
            body = _function_body(src, name)
            if not body or LOCK_CALL not in body:
                continue
            if "tryLock(" not in body:
                problems.append(f"{fname}:{name} takes the lock without tryLock()")
            if "releaseLock()" not in body:
                problems.append(f"{fname}:{name} never calls releaseLock()")
            if "finally" not in body:
                problems.append(f"{fname}:{name} has no finally block around the lock")
    assert not problems, "unsafe lock wrapper(s): " + "; ".join(problems)


def test_intentionally_unlocked_files_have_no_dedup_state() -> None:
    """The allowlisted files must stay lock-free *because* they hold no dedup set.

    If one of them ever grows a `getProcessed*MessageIds_` helper, it becomes
    racy and this fails -- forcing the author to add the lock (and to re-review
    the deadlock note: a router must not hold the script lock).
    """
    offenders: list[str] = []
    for fname, src in sorted(_all_text().items()):
        if fname not in INTENTIONALLY_UNLOCKED:
            continue
        if DEDUP_HELPER_RE.search(src):
            offenders.append(fname)
    assert not offenders, (
        "file(s) allowlisted as intentionally lock-free now define a "
        "read-then-append dedup helper -> they must take the script lock, or "
        f"the allowlist must be re-justified: {offenders}"
    )


def test_known_family_is_covered() -> None:
    """Regression pin: the four processors fixed 2026-09-10 stay covered."""
    expected = {
        "process_plot_invalidation.gs": "processPlotInvalidationFromTelegramChatLogs",
        "process_farm_boundary_evidence.gs": "processFarmBoundaryEvidenceFromTelegramChatLogs",
        "process_media_retraction.gs": "processMediaRetractionFromTelegramChatLogs",
        "process_tree_growth_monitoring.gs": "processTreeGrowthMonitoringFromTelegramChatLogs",
    }
    text = _all_text()
    missing = []
    for fname, fn in expected.items():
        if fname not in text:
            missing.append(f"file absent: {fname}")
            continue
        body = _function_body(text[fname], fn)
        if body is None:
            missing.append(f"function absent: {fname}:{fn}")
        elif LOCK_CALL not in body:
            missing.append(f"lock absent: {fname}:{fn}")
    assert not missing, "expected lock coverage regressed: " + "; ".join(missing)
