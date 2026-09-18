"""Unit tests for deploy_gas_project.py's live-accessor survivability guard.

Run: python3 -m pytest scripts/test_accessor_guard.py -q

Covers the 2026-09-10 incident class: a gitignored, .claspignore'd secret
accessor (Credentials.js) missing from the live project => every GAS entry
point dies at load with `ReferenceError: setApiKeys is not defined`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_gas_project as dgp  # noqa: E402

SAMPLE = """\
function setApiKeys() {
  // no-op guard: keys live in Script Properties, not in source.
}

function getCredentials() {
  var sp = PropertiesService.getScriptProperties();
  return { GITHUB_API_TOKEN: sp.getProperty('GITHUB_API_TOKEN') || '' };
}
"""

CALLER = """\
setApiKeys();
var creds = getCredentials();
function doGet(e) { return ContentService.createTextOutput('ok'); }
"""

CLASPIGNORE = "Credentials.gs\nCredentials.js\nCredentials.sample.js\n"


def _mk_project(tmp_path: Path, files: dict[str, str]) -> Path:
    for name, content in files.items():
        (tmp_path / name).write_text(content, encoding="utf-8")
    return tmp_path


def test_top_level_function_names_counts_only_globals():
    text = "function a() {\n  function inner() {}\n}\nfunction b() {}\n"
    assert dgp._top_level_function_names(text) == ["a", "b"]


def test_basename_ignored_matches_live_stem():
    pats = ["Credentials.gs", "Credentials.js", "Credentials.sample.js"]
    # live project stores it extension-less as 'Credentials'
    assert dgp._basename_ignored("Credentials", pats) is True
    assert dgp._basename_ignored("Code", pats) is False


def test_guard_passes_when_live_accessor_present(tmp_path, monkeypatch):
    _mk_project(
        tmp_path,
        {
            "Credentials.sample.js": SAMPLE,
            "Code.js": CALLER,
            ".claspignore": CLASPIGNORE,
        },
    )
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Credentials", "source": SAMPLE}], ""),
    )
    errors, note = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors == []
    assert note == ""


def test_guard_fails_when_live_accessor_missing(tmp_path, monkeypatch):
    _mk_project(
        tmp_path,
        {
            "Credentials.sample.js": SAMPLE,
            "Code.js": CALLER,
            ".claspignore": CLASPIGNORE,
        },
    )
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Code", "source": CALLER}], ""),
    )
    errors, note = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors and "ReferenceError" in errors[0]
    assert "setApiKeys" in errors[0] and "getCredentials" in errors[0]


def test_guard_fails_when_live_accessor_not_ignored(tmp_path, monkeypatch):
    # present live but NOT .claspignore-protected => push --force deletes it
    _mk_project(tmp_path, {"Credentials.sample.js": SAMPLE, "Code.js": CALLER})
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Credentials", "source": SAMPLE}], ""),
    )
    errors, _ = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors


def test_guard_noop_when_locally_defined(tmp_path, monkeypatch):
    _mk_project(
        tmp_path,
        {"Credentials.sample.js": SAMPLE, "Credentials.js": SAMPLE, "Code.js": CALLER},
    )

    def _boom(sid):
        raise AssertionError("live fetch must be skipped when defined locally")

    monkeypatch.setattr(dgp, "fetch_live_project_files", _boom)
    errors, note = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors == [] and note == ""


def test_guard_fails_open_on_live_fetch_error(tmp_path, monkeypatch):
    _mk_project(tmp_path, {"Credentials.sample.js": SAMPLE, "Code.js": CALLER})
    monkeypatch.setattr(
        dgp, "fetch_live_project_files", lambda sid: (None, "network down")
    )
    errors, note = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors == []
    assert "fail-open" in note


def test_guard_noop_without_sample(tmp_path):
    _mk_project(tmp_path, {"Code.js": CALLER})
    errors, note = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors == [] and note == ""


# ── fail-closed variants (2026-09-18, thread 31220) ──────────────────────────


def test_accessor_fail_closed_blocks_on_live_fetch_error(tmp_path, monkeypatch):
    """A real --push (fail_closed=True) must REFUSE when the live set is unknown."""
    _mk_project(tmp_path, {"Credentials.sample.js": SAMPLE, "Code.js": CALLER})
    monkeypatch.setattr(
        dgp, "fetch_live_project_files", lambda sid: (None, "network down")
    )
    errors, note = dgp.validate_accessor_survivability(
        tmp_path, "SID", fail_closed=True
    )
    assert errors and "fail-closed" in errors[0]
    assert note == ""


def test_accessor_fail_open_default_unchanged(tmp_path, monkeypatch):
    """Dry-run default (fail_closed=False) stays a note, never an error."""
    _mk_project(tmp_path, {"Credentials.sample.js": SAMPLE, "Code.js": CALLER})
    monkeypatch.setattr(
        dgp, "fetch_live_project_files", lambda sid: (None, "network down")
    )
    errors, note = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors == []
    assert "fail-open" in note


def test_accessor_error_text_no_longer_says_gitignored(tmp_path, monkeypatch):
    """The tracked template is not gitignored; the message must not claim it is."""
    _mk_project(
        tmp_path,
        {
            "Credentials.sample.js": SAMPLE,
            "Code.js": CALLER,
            ".claspignore": CLASPIGNORE,
        },
    )
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Code", "source": CALLER}], ""),
    )
    errors, _ = dgp.validate_accessor_survivability(tmp_path, "SID")
    assert errors and "gitignored" not in errors[0]
    assert "tracked template" in errors[0]


def test_remote_only_fail_closed_blocks_on_live_fetch_error(tmp_path, monkeypatch):
    _mk_project(tmp_path, {"Code.js": CALLER})
    monkeypatch.setattr(
        dgp, "fetch_live_project_files", lambda sid: (None, "auth expired")
    )
    errors, note = dgp.validate_no_remote_only_deletions(
        tmp_path, "SID", fail_closed=True
    )
    assert errors and "fail-closed" in errors[0]
    assert note == ""


def test_remote_only_fail_open_default_unchanged(tmp_path, monkeypatch):
    _mk_project(tmp_path, {"Code.js": CALLER})
    monkeypatch.setattr(
        dgp, "fetch_live_project_files", lambda sid: (None, "auth expired")
    )
    errors, note = dgp.validate_no_remote_only_deletions(tmp_path, "SID")
    assert errors == []
    assert "fail-open" in note


def test_remote_only_flags_live_file_with_no_local_counterpart(tmp_path, monkeypatch):
    """The 1_3D4o2R shape: live has a Credentials file, local does not -> REFUSE."""
    _mk_project(tmp_path, {"Code.js": CALLER})
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: (
            [
                {"name": "Code", "source": CALLER},
                {"name": "Credentials", "source": "x"},
            ],
            "",
        ),
    )
    errors, _ = dgp.validate_no_remote_only_deletions(tmp_path, "SID", fail_closed=True)
    assert errors and "Credentials" in errors[0]
