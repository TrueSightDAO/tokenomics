"""Unit tests for deploy_gas_project.py's clasp-credential alignment fix.

Run: python3 -m pytest scripts/test_clasp_credentials_env.py -q

``clasp`` reads ONLY ``$HOME/.clasprc.json`` and ignores ``CLASPRC_PATH`` -- which
``resolve_clasp_identity`` points the guard at. Left unaligned, the guard verifies
one account while ``clasp push|version|deploy`` execute as another: a fail-OPEN
mismatch that silently swaps the deployment's RUNTIME identity
(``webapp.executeAs = USER_DEPLOYING``) and its per-executing-identity trigger set
(observed live 2026-09-25/26, thread 35944: trigger count 7 -> 4 after a repoint
run as the wrong clasp account).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_gas_project as dgp


def test_unset_clasprc_path_returns_none(monkeypatch):
    """No CLASPRC_PATH -> default clasprc IS $HOME/.clasprc.json, so inherit ambient env."""
    monkeypatch.delenv("CLASPRC_PATH", raising=False)
    assert dgp.clasp_credentials_env() is None


def test_set_clasprc_path_overrides_home_to_that_credential(monkeypatch, tmp_path):
    cred = tmp_path / ".clasprc-admin.json"
    cred.write_text('{"tokens": {"default": {}}}', encoding="utf-8")
    monkeypatch.setenv("CLASPRC_PATH", str(cred))

    env = dgp.clasp_credentials_env()
    assert env is not None
    home = Path(env["HOME"])
    assert home != Path(os.path.expanduser("~"))
    # clasp must find its credential as <HOME>/.clasprc.json
    served = home / ".clasprc.json"
    assert served.is_file()
    assert served.read_text(encoding="utf-8") == cred.read_text(encoding="utf-8")
    # env must carry the rest of the process environment through
    assert "PATH" in env


def test_missing_clasprc_path_file_returns_none(monkeypatch, tmp_path):
    monkeypatch.setenv("CLASPRC_PATH", str(tmp_path / "does-not-exist.json"))
    assert dgp.clasp_credentials_env() is None


def test_subprocess_calls_pass_env(monkeypatch):
    """Guard: every clasp subprocess.run in the module must forward env= so the
    write runs as the identity the guard verified."""
    import inspect

    src = inspect.getsource(dgp)
    # push + version + deploy are the three clasp invocations
    assert src.count("env=clasp_credentials_env()") >= 3
