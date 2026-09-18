"""Unit tests for deploy_gas_project.py's remote-only-file guard.

Run: python3 -m pytest scripts/test_remote_only_guard.py -q

Covers the 2026-09-18 directive: `clasp push` = projects.updateContent, which
the Apps Script API documents as clearing ALL existing files before writing the
pushed set. A live file with no local counterpart is therefore DELETED -- and a
`.claspignore` entry does NOT protect it (ignored files are merely omitted from
the upload, so they are removed too).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_gas_project as dgp  # noqa: E402

CODE = "function doGet(e) { return ContentService.createTextOutput('ok'); }\n"
CLASPIGNORE = "Credentials.gs\nCredentials.js\nCredentials.sample.js\n"


def _mk_project(tmp_path: Path, files: dict[str, str]) -> Path:
    for name, content in files.items():
        (tmp_path / name).write_text(content, encoding="utf-8")
    return tmp_path


def test_local_upload_names_maps_stems_and_manifest(tmp_path):
    _mk_project(
        tmp_path,
        {
            "Code.js": CODE,
            "appsscript.json": "{}",
            ".clasp.json": "{}",
            ".claspignore": "",
            "notes.txt": "not a source file",
        },
    )
    names = dgp._local_upload_names(tmp_path)
    assert names == {"Code", "appsscript"}


def test_local_upload_names_excludes_claspignored(tmp_path):
    _mk_project(
        tmp_path,
        {"Code.js": CODE, "Credentials.js": CODE, ".claspignore": CLASPIGNORE},
    )
    names = dgp._local_upload_names(tmp_path)
    assert "Credentials" not in names and "Code" in names


def test_guard_passes_when_local_covers_live(tmp_path, monkeypatch):
    _mk_project(tmp_path, {"Code.js": CODE, "appsscript.json": "{}"})
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Code"}, {"name": "appsscript"}], ""),
    )
    errors, note = dgp.validate_no_remote_only_deletions(tmp_path, "SID")
    assert errors == [] and note == ""


def test_guard_flags_remote_only_file(tmp_path, monkeypatch):
    # live has a helper the folder does not -> push would delete it
    _mk_project(tmp_path, {"Code.js": CODE})
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Code"}, {"name": "LegacyHelper"}], ""),
    )
    errors, _ = dgp.validate_no_remote_only_deletions(tmp_path, "SID")
    assert errors and "LegacyHelper" in errors[0]
    assert "DELETED" in errors[0]


def test_guard_flags_ignored_live_file(tmp_path, monkeypatch):
    # a .claspignore'd file that is live but absent locally is STILL deleted
    _mk_project(tmp_path, {"Code.js": CODE, ".claspignore": "Credentials.js\n"})
    monkeypatch.setattr(
        dgp,
        "fetch_live_project_files",
        lambda sid: ([{"name": "Code"}, {"name": "Credentials"}], ""),
    )
    errors, _ = dgp.validate_no_remote_only_deletions(tmp_path, "SID")
    assert errors and "Credentials" in errors[0]


def test_guard_fails_open_on_live_fetch_error(tmp_path, monkeypatch):
    _mk_project(tmp_path, {"Code.js": CODE})
    monkeypatch.setattr(
        dgp, "fetch_live_project_files", lambda sid: (None, "network down")
    )
    errors, note = dgp.validate_no_remote_only_deletions(tmp_path, "SID")
    assert errors == [] and "fail-open" in note
