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


# ---------------------------------------------------------------------------
# SS12.3 payout tabs (Tier 1 `payouts` on Ops; Tier 2 `payout events` on CFR)
# ---------------------------------------------------------------------------


def test_cfr_program_group_adds_tier2_payout_events():
    mod = _mod()
    assert list(mod.CFR_PROGRAM_TABS) == [*EXPECTED_TABS, "payout events"]
    # TABS itself is unchanged -- the SS11.3 group stays a clean 4-tab group
    assert list(mod.TABS) == EXPECTED_TABS


def test_ops_workbook_group_is_just_the_tier1_payouts_tab():
    mod = _mod()
    assert list(mod.OPS_WORKBOOK_TABS) == ["payouts"]


def test_tier2_is_tier1_plus_cfr_scoping_columns():
    mod = _mod()
    assert mod.TIER2_PAYOUT_COLUMNS == mod.TIER1_PAYOUT_COLUMNS + [
        "cohort",
        "student_ref",
    ]


def test_payout_columns_follow_the_dedup_and_shape_conventions():
    mod = _mod()
    for cols in (mod.TIER1_PAYOUT_COLUMNS, mod.TIER2_PAYOUT_COLUMNS):
        assert cols[0] == "created_at_utc"
        assert "telegram_update_id" in cols  # SS11.3 dedup key
        # SS12.4 -- tree linkage is a LIST in one cell, one row per transfer
        assert "tree_planting_id" in cols
        # a payout carries NO raw PII (SS12.1), so no pix_key / masked pair here
        assert "pix_key" not in cols
        assert "pix_key_masked" not in cols


def test_ops_workbook_id_is_the_canonical_ops_workbook():
    assert _mod().OPS_WORKBOOK_ID == "1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ"


def test_plan_for_is_group_aware():
    mod = _mod()
    created = {tab: act for act, tab in mod.plan_for(mod.OPS_WORKBOOK_TABS, ["Sheet1"])}
    assert created == {"payouts": "create"}
    present = {
        tab: act for act, tab in mod.plan_for(mod.OPS_WORKBOOK_TABS, ["payouts"])
    }
    assert present == {"payouts": "exists"}


# ---------------------------------------------------------------------------
# Regression: a SINGLE --execute run must provision BOTH the tabs AND their
# header rows. 2026-09-17 bug: `existing` was computed BEFORE the addSheet
# batchUpdate, so the header-write loop skipped every freshly-created tab,
# forcing a second run. This test fails on the unpatched script.
# ---------------------------------------------------------------------------


class _FakeSheet:
    """Minimal stand-in for the googleapiclient sheets() resource chain."""

    def __init__(self):
        self.titles = ["Sheet1"]  # a brand-new Google Sheet
        self.headers: dict[str, list] = {}  # tab -> row-1 values

    # --- spreadsheets().get() ---
    def _get(self, spreadsheetId=None, fields=None):
        rows = [{"properties": {"title": t}} for t in self.titles]
        return _Resp(
            {
                "properties": {"title": "fake"},
                "sheets": rows,
            }
        )

    # --- spreadsheets().batchUpdate() ---
    def _batch_update(self, spreadsheetId=None, body=None):
        for req in body["requests"]:
            self.titles.append(req["addSheet"]["properties"]["title"])
        return _Resp({})

    # --- spreadsheets().values() ---
    def _values(self):
        return _FakeValues(self)

    def spreadsheets(self):
        outer = self

        class _Spreadsheets:
            def get(self, **kw):
                return outer._get(**kw)

            def batchUpdate(self, **kw):
                return outer._batch_update(**kw)

            def values(self):
                return outer._values()

        return _Spreadsheets()


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def execute(self):
        return self._payload


class _FakeValues:
    def __init__(self, sheet: _FakeSheet):
        self.sheet = sheet

    def get(self, spreadsheetId=None, range=None):
        tab = range.split("!")[0].strip("'")
        row = self.sheet.headers.get(tab, [])
        return _Resp({"values": [row] if row else []})

    def update(self, spreadsheetId=None, range=None, valueInputOption=None, body=None):
        tab = range.split("!")[0].strip("'")
        self.sheet.headers[tab] = list(body["values"][0])
        return _Resp({})


def test_single_execute_run_writes_headers_for_created_tabs():
    mod = _mod()
    svc = _FakeSheet()
    rc = mod._ensure(svc, "fake-id", mod.OPS_WORKBOOK_TABS, execute=True)
    assert rc == 0
    # the tab was created AND its headers were written in the SAME pass
    assert "payouts" in svc.titles
    assert svc.headers.get("payouts") == mod.TIER1_PAYOUT_COLUMNS


def test_single_execute_run_provisions_all_cfr_tabs_and_headers():
    mod = _mod()
    svc = _FakeSheet()
    mod._ensure(svc, "fake-id", mod.CFR_PROGRAM_TABS, execute=True)
    for tab in mod.CFR_PROGRAM_TABS:
        assert tab in svc.titles, f"{tab} not created"
        assert svc.headers.get(tab) == mod.CFR_PROGRAM_TABS[tab], (
            f"{tab} headers not written"
        )


def test_dry_run_creates_nothing_and_writes_no_headers():
    mod = _mod()
    svc = _FakeSheet()
    mod._ensure(svc, "fake-id", mod.OPS_WORKBOOK_TABS, execute=False)
    assert svc.titles == ["Sheet1"]  # nothing created
    assert svc.headers == {}  # nothing written
