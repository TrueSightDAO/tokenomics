"""Unit tests for publish_monthly_statistics_cache.py.

No network: every case drives the pure coercion/validation helpers.

The anchor cases use REAL cell values read from the live Monthly Statistics
sheet, so the assertions pin the exact Apps Script semantics this cache mirrors.
"""

import datetime as dt
import importlib.util
import os

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPEC = importlib.util.spec_from_file_location(
    'monthly_cache', os.path.join(_HERE, 'publish_monthly_statistics_cache.py'))
m = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(m)

LA = dt.timezone(dt.timedelta(hours=-7))   # America/Los_Angeles, PDT


# --- serial -> ISO --------------------------------------------------------

def test_serial_matches_live_apps_script_value():
    """Row 31 col D serial 46315.75539709491 -> '2026-10-21T01:07:46.309Z'.

    This exact string is what ?type=monthly returns for 2026-10, so a cache
    that reproduces it is byte-compatible with the live endpoint.
    """
    assert m._serial_to_iso(46315.75539709491, LA) == '2026-10-21T01:07:46.309Z'


def test_serial_prev_month_matches_live_value():
    """Row 30 col D -> 2026-10-01T02:51:15.644Z (matches live 2026-09 row)."""
    assert m._serial_to_iso(46295.82726439815, LA) == '2026-10-01T02:51:15.644Z'


def test_serial_without_timezone_treated_as_utc():
    assert m._serial_to_iso(46315.0, None) == '2026-10-20T00:00:00.000Z'


# --- build_rows -----------------------------------------------------------

def test_blank_month_rows_are_skipped():
    """GAS: `if (month)` - a blank col A means the row is not emitted."""
    rows = m.build_rows([
        [None] * 6,
        ['  '] + [1] * 5,
        ['2026-10', 1, 2, None, None, None],
    ])
    assert [r['month'] for r in rows] == ['2026-10']


def test_blanks_become_zero_for_sales_and_null_for_balances():
    rows = m.build_rows([['2026-10', '', '', '', '', '']])
    r = rows[0]
    assert r['monthlySales'] == 0.0
    assert r['cumulativeSales'] == 0.0
    assert r['aum'] is None
    assert r['usdTreasuryBalance'] is None


def test_zero_balance_is_preserved_not_nulled():
    """A real 0 must not be confused with blank."""
    rows = m.build_rows([['2026-10', 1, 2, 3, 0, 0]])
    assert rows[0]['aum'] == 0.0
    assert rows[0]['usdTreasuryBalance'] == 0.0


def test_rows_sorted_ascending_by_month():
    rows = m.build_rows([
        ['2026-10', 1, 2, None, None, None],
        ['2023-11', 1, 2, None, None, None],
        ['2024-06', 1, 2, None, None, None],
    ])
    assert [r['month'] for r in rows] == ['2023-11', '2024-06', '2026-10']


def test_month_whitespace_stripped():
    assert m.build_rows([
        ['  2026-10  ', 1, 2, None, None, None]])[0]['month'] == '2026-10'


def test_short_rows_are_padded_not_crashed():
    rows = m.build_rows([['2026-10']])
    assert rows[0]['monthlySales'] == 0.0 and rows[0]['aum'] is None


def test_numeric_strings_are_coerced():
    rows = m.build_rows([['2026-10', '137', '18,621.34', None, None, None]])
    assert rows[0]['monthlySales'] == 137.0
    assert rows[0]['cumulativeSales'] == 18621.34


# --- validate -------------------------------------------------------------

def test_validate_accepts_a_normal_table():
    rows = m.build_rows([
        ['2026-09', 1, 2, None, None, None],
        ['2026-10', 3, 4, None, None, None],
    ])
    assert m.validate(rows) is rows


def test_validate_rejects_empty():
    with pytest.raises(m.ValidationError, match='no data rows'):
        m.validate([])


def test_validate_rejects_malformed_month():
    with pytest.raises(m.ValidationError, match='not YYYY-MM'):
        m.validate([{'month': 'Oct 2026', 'monthlySales': 1.0,
                     'cumulativeSales': 2.0, 'aum': None,
                     'usdTreasuryBalance': None, 'lastUpdated': None}])


def test_validate_rejects_duplicate_month():
    row = {'month': '2026-10', 'monthlySales': 1.0, 'cumulativeSales': 2.0,
           'aum': None, 'usdTreasuryBalance': None, 'lastUpdated': None}
    with pytest.raises(m.ValidationError, match='duplicate month'):
        m.validate([dict(row), dict(row)])


def test_validate_rejects_non_numeric_sales():
    with pytest.raises(m.ValidationError, match='not numeric'):
        m.validate([{'month': '2026-10', 'monthlySales': 'n/a',
                     'cumulativeSales': 2.0, 'aum': None,
                     'usdTreasuryBalance': None, 'lastUpdated': None}])


def test_validate_rejects_missing_key():
    with pytest.raises(m.ValidationError, match='missing keys'):
        m.validate([{'month': '2026-10', 'monthlySales': 1.0}])


# --- payload --------------------------------------------------------------

def test_payload_mirrors_gas_response_shape():
    rows = [{'month': '2026-10', 'monthlySales': 137.0, 'cumulativeSales': 2.0,
             'aum': None, 'usdTreasuryBalance': None, 'lastUpdated': None}]
    gen = dt.datetime(2026, 10, 21, 1, 7, 46, 309000, tzinfo=dt.timezone.utc)
    p = m.build_payload(rows, generated_at=gen)
    # Consumers read .timestamp and .data, exactly as they do from Apps Script.
    assert p['timestamp'] == '2026-10-21T01:07:46.309Z'
    assert p['generated_at'] == p['timestamp']
    assert p['data'] == rows
    assert p['schema_version'] == 1
    assert 'type=monthly' in p['upstream']


def test_payload_is_json_serialisable():
    import json
    p = m.build_payload(m.build_rows([['2026-10', 1, 2, None, None, None]]))
    assert json.loads(json.dumps(p))['data'][0]['month'] == '2026-10'
