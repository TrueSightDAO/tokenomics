"""Tests for the `cfr program` sheet provisioner (CRF plan SS11.3 / SS11.8).

The tabs must match SS11.3 exactly -- this pins the schema so a refactor cannot
silently drop a column the sink or a governor query depends on.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "provision_cfr_program_sheet.py"

EXPECTED_TABS = [
    "payout registrations",
    "tree planting",
    "tree monitoring",
    "plot registrations",
]


def _mod():
    spec = importlib.util.spec_from_file_location("provision_cfr", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_four_canonical_tabs_in_order():
    assert list(_mod().TABS) == EXPECTED_TABS


def test_every_intake_tab_has_the_dedup_key():
    tabs = _mod().TABS
    for tab in EXPECTED_TABS:
        assert "telegram_update_id" in tabs[tab], f"{tab} missing dedup key"
        assert tabs[tab][0] == "created_at_utc", f"{tab} must start with created_at_utc"


def test_payout_tab_carries_plaintext_pix_and_mask():
    headers = _mod().TABS["payout registrations"]
    assert "pix_key" in headers  # plaintext, private sheet only (SS11.2)
    assert "pix_key_masked" in headers  # display-safe echo
    assert "pk_hash" in headers  # the public-key linkage (SS11.1)
    assert "pix_key_cipher" not in headers  # SS11.2 dropped the RSA cipher


def test_plan_creates_only_missing_tabs():
    module = _mod()
    result = {
        tab: action for action, tab in module.plan(["payout registrations", "Sheet1"])
    }
    assert result["payout registrations"] == "exists"
    assert result["tree planting"] == "create"
    assert result["tree monitoring"] == "create"
    assert result["plot registrations"] == "create"


def test_plan_all_present_is_noop():
    module = _mod()
    assert all(action == "exists" for action, _ in module.plan(list(module.TABS)))


def test_col_letter_conversion():
    module = _mod()
    assert module._col(1) == "A"
    assert module._col(11) == "K"
    assert module._col(26) == "Z"
    assert module._col(27) == "AA"
    assert module._col(28) == "AB"
