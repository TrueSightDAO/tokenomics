/**
 * File: google_app_scripts/holistic_hit_list_store_history/store_interaction_history_api.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Description: Read-only REST-style GET API for the DApp "Store Interaction History".
 *   Autocomplete against Hit List; return one Hit List row plus matching rows from
 *   DApp Remarks, Email Agent Follow Up, and Email Agent Suggestions (human-in-the-loop
 *   context before sending partner email). History arrays are sorted newest-first when
 *   date/timestamp columns are present; otherwise row order is reversed (sheet old→new).
 *
 * Deployment URL: https://script.google.com/macros/s/AKfycbwoBqZnDS4JRRdFkxSXdlGt-qIn-RauMcORuDHeWs29oQ2CpJ3L4A10uM8se9anL108/exec
 *
 * Deployment: Deploy as web app — Execute as: Me; Who has access: Anyone (or org policy).
 *   If access is too restricted, fetch() from the DApp shows a CORS error (browser gets HTML without
 *   Access-Control-Allow-Origin). This is a deployment setting issue, not a missing JSONP wrapper.
 *
 * DApp consumer: https://truesightdao.github.io/dapp/store_interaction_history.html
 *   (source: dapp/store_interaction_history.html — constant API_BASE_URL must match Deployment URL above after redeploys)
 */

// ============================================================================
// SCRIPT PROPERTIES (Project Settings → Script properties)
// ============================================================================
/**
 * OPTIONAL:
 *   STORE_HISTORY_API_TOKEN — If set, every request must include &token=... matching this value.
 */

// ============================================================================
// SPREADSHEET AND TAB NAMES (holistic wellness hit list)
// ============================================================================

var HIT_LIST_SPREADSHEET_ID = '1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc';
/** Source: https://docs.google.com/spreadsheets/d/1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc/edit */

var SHEET_HIT_LIST = 'Hit List';
var SHEET_DAPP_REMARKS = 'DApp Remarks';
var SHEET_EMAIL_FOLLOW_UP = 'Email Agent Follow Up';
var SHEET_EMAIL_SUGGESTIONS = 'Email Agent Suggestions';

/** Max autocomplete results per suggestStores request. */
var SUGGEST_LIMIT = 30;
/** Cap per section to keep getStoreHistory payloads bounded. */
var MAX_HISTORY_ROWS_PER_SECTION = 200;

function createJsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function success_(data) {
  return createJsonOutput_({ status: 'success', data: data });
}

function error_(message, code) {
  return createJsonOutput_({
    status: 'error',
    message: message || 'Error',
    code: code || 400,
  });
}

function verifyToken_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('STORE_HISTORY_API_TOKEN');
  if (!expected) return true;
  var t = (e.parameter.token || '').toString();
  return t === expected;
}

function headerMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = (headerRow[i] || '').toString().trim();
    if (h) map[h] = i;
  }
  return map;
}

function rowToObj_(headers, row) {
  var o = {};
  for (var i = 0; i < headers.length; i++) {
    var key = (headers[i] || '').toString().trim();
    if (!key) continue;
    o[key] = row[i] !== undefined && row[i] !== null ? String(row[i]) : '';
  }
  return o;
}

function normalizeKey_(s) {
  return (s || '').toString().trim().toLowerCase();
}

function getSheetSafe_(ss, name) {
  try {
    return ss.getSheetByName(name);
  } catch (err) {
    return null;
  }
}

function getStoreSuggestions_(q) {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sh = getSheetSafe_(ss, SHEET_HIT_LIST);
  if (!sh) return [];

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var hdr = headerMap_(headers);
  var shopIdx = hdr['Shop Name'];
  var keyIdx = hdr['Store Key'];
  var emailIdx = hdr['Email'];
  if (shopIdx === undefined) return [];

  var needle = normalizeKey_(q);
  var out = [];
  var seen = {};

  for (var r = 1; r < values.length && out.length < SUGGEST_LIMIT; r++) {
    var row = values[r];
    var shop = row[shopIdx] !== undefined ? String(row[shopIdx]) : '';
    var sk = keyIdx !== undefined && row[keyIdx] !== undefined ? String(row[keyIdx]) : '';
    var em = emailIdx !== undefined && row[emailIdx] !== undefined ? String(row[emailIdx]) : '';

    if (!needle) {
      /* empty query: return nothing to avoid huge payloads */
      continue;
    }
    var hay = normalizeKey_(shop + ' ' + sk);
    if (hay.indexOf(needle) === -1) continue;

    var id = sk || shop + '|' + r;
    if (seen[id]) continue;
    seen[id] = true;

    out.push({
      shop_name: shop.trim(),
      store_key: sk.trim(),
      email: em.trim(),
      hit_list_row: r + 1,
    });
  }

  return out;
}

function findHitListRow_(ss, storeKey, shopName) {
  var sh = getSheetSafe_(ss, SHEET_HIT_LIST);
  if (!sh) return { hit_list: null, headers: [], row_index: null, row_obj: null };

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { hit_list: sh, headers: values[0] || [], row_index: null, row_obj: null };

  var headers = values[0];
  var hdr = headerMap_(headers);
  var shopIdx = hdr['Shop Name'];
  var keyIdx = hdr['Store Key'];

  var wantKey = normalizeKey_(storeKey);
  var wantShop = normalizeKey_(shopName);

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var sk = keyIdx !== undefined ? String(row[keyIdx] || '') : '';
    var sn = shopIdx !== undefined ? String(row[shopIdx] || '') : '';

    if (wantKey && normalizeKey_(sk) === wantKey) {
      return { hit_list: sh, headers: headers, row_index: r + 1, row_obj: rowToObj_(headers, row) };
    }
    if (!wantKey && wantShop && normalizeKey_(sn) === wantShop) {
      return { hit_list: sh, headers: headers, row_index: r + 1, row_obj: rowToObj_(headers, row) };
    }
  }

  return { hit_list: sh, headers: headers, row_index: null, row_obj: null };
}

function filterRowsForStore_(
  sheetName,
  ss,
  matchStoreKey,
  matchEmail,
  matchShopName
) {
  var sh = getSheetSafe_(ss, sheetName);
  if (!sh) return { sheet: sheetName, found: false, rows: [] };

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { sheet: sheetName, found: true, rows: [] };

  var headers = values[0];
  var hdr = headerMap_(headers);
  var skI = hdr['store_key'] !== undefined ? hdr['store_key'] : hdr['Store Key'];
  var emailI = hdr['to_email'] !== undefined ? hdr['to_email'] : hdr['To'] !== undefined ? hdr['To'] : hdr['Email'];
  var shopI = hdr['shop_name'] !== undefined ? hdr['shop_name'] : hdr['Shop Name'];

  var wantKey = normalizeKey_(matchStoreKey);
  var wantEmail = normalizeKey_(matchEmail);
  var wantShop = normalizeKey_(matchShopName);

  var rows = [];
  for (var r = 1; r < values.length && rows.length < MAX_HISTORY_ROWS_PER_SECTION; r++) {
    var row = values[r];
    var sk = skI !== undefined ? String(row[skI] || '') : '';
    var em = emailI !== undefined ? String(row[emailI] || '') : '';
    var shp = shopI !== undefined ? String(row[shopI] || '') : '';

    var ok = false;
    if (wantKey && normalizeKey_(sk) === wantKey) ok = true;
    else if (wantEmail && normalizeKey_(em) === wantEmail) ok = true;
    else if (wantShop && normalizeKey_(shp) === wantShop) ok = true;

    if (ok) rows.push(rowToObj_(headers, row));
  }

  return { sheet: sheetName, found: true, rows: rows };
}

/** Column / field names often used for recency (checked first). */
var HISTORY_TIME_KEYS_PRIORITY = [
  'created_at_utc',
  'Created At',
  'created_at',
  'Created',
  'Submitted At',
  'submitted_at',
  'date_sent',
  'Date Sent',
  'sent_at',
  'Sent At',
  'updated_at',
  'Updated At',
  'timestamp',
  'Timestamp',
  'contact_date',
  'Contact Date',
  'follow_up_date',
  'Follow Up Date',
  'visit_date',
  'Visit Date',
];

function parseDateStringMs_(v) {
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).trim();
  if (!s) return 0;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  return 0;
}

/**
 * Best-effort ms since epoch from a row object (string values from Sheets).
 * Falls back to any property whose name looks like a date/time field.
 */
function parseRowTimeMs_(rowObj) {
  if (!rowObj) return 0;
  var i;
  var k;
  var t;
  for (i = 0; i < HISTORY_TIME_KEYS_PRIORITY.length; i++) {
    k = HISTORY_TIME_KEYS_PRIORITY[i];
    if (Object.prototype.hasOwnProperty.call(rowObj, k) && rowObj[k]) {
      t = parseDateStringMs_(rowObj[k]);
      if (t > 0) return t;
    }
  }
  for (k in rowObj) {
    if (!Object.prototype.hasOwnProperty.call(rowObj, k)) continue;
    var lk = k.toLowerCase();
    var looksTemporal =
      lk.indexOf('date') !== -1 ||
      lk.indexOf('time') !== -1 ||
      lk.indexOf('_at') !== -1 ||
      lk.indexOf('at_') !== -1 ||
      / at$/.test(lk);
    if (!looksTemporal) continue;
    t = parseDateStringMs_(rowObj[k]);
    if (t > 0) return t;
  }
  return 0;
}

/**
 * Newest first. Uses timestamps when present; otherwise reverses row order
 * (assumes sheet rows are roughly old → new).
 */
function sortHistoryRowsNewestFirst_(rows) {
  if (!rows || rows.length < 2) return rows;
  var times = rows.map(function (r) {
    return parseRowTimeMs_(r);
  });
  var any = times.some(function (x) {
    return x > 0;
  });
  if (any) {
    rows.sort(function (a, b) {
      return parseRowTimeMs_(b) - parseRowTimeMs_(a);
    });
    return rows;
  }
  rows.reverse();
  return rows;
}

function getStoreHistory_(storeKey, shopName) {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var hit = findHitListRow_(ss, storeKey, shopName);

  if (!hit.row_obj) {
    return {
      hit_list_row: null,
      hit_list: null,
      store_key: storeKey || '',
      shop_query: shopName || '',
      dapp_remarks: [],
      email_agent_follow_up: [],
      email_agent_suggestions: [],
      message: 'Store not found for store_key/shop. Pick from suggestions.',
    };
  }

  var hl = hit.row_obj;
  var sk = hl['Store Key'] || storeKey || '';
  var shop = hl['Shop Name'] || shopName || '';
  var email = hl['Email'] || '';

  var remarks = filterRowsForStore_(SHEET_DAPP_REMARKS, ss, sk, '', shop);
  var follow = filterRowsForStore_(SHEET_EMAIL_FOLLOW_UP, ss, sk, email, shop);
  var sugg = filterRowsForStore_(SHEET_EMAIL_SUGGESTIONS, ss, sk, email, shop);

  var dappRows = remarks.rows.slice();
  var followRows = follow.rows.slice();
  var suggRows = sugg.rows.slice();
  sortHistoryRowsNewestFirst_(dappRows);
  sortHistoryRowsNewestFirst_(followRows);
  sortHistoryRowsNewestFirst_(suggRows);

  return {
    hit_list_row: hit.row_index,
    hit_list: hl,
    store_key: sk,
    shop_name: shop,
    primary_email: email,
    dapp_remarks: dappRows,
    email_agent_follow_up: followRows,
    email_agent_suggestions: suggRows,
  };
}

/**
 * Web app entrypoint (GET only). JSON body: { status: 'success'|'error', data?: object, message?: string }.
 *
 * Actions:
 *   - suggestStores — e.parameter.q (min length 2); data.suggestions[]: shop_name, store_key, email, hit_list_row
 *   - getStoreHistory — e.parameter.store_key and/or shop; data includes hit_list, dapp_remarks[], email_agent_*[]
 *
 * Auth: e.parameter.token when STORE_HISTORY_API_TOKEN is set (Script Properties).
 */
function doGet(e) {
  if (!verifyToken_(e)) {
    return error_('Invalid or missing token', 401);
  }

  try {
    var action = (e.parameter.action || '').toString();

    if (action === 'suggestStores') {
      var q = (e.parameter.q || '').toString();
      if (normalizeKey_(q).length < 2) {
        return success_({ suggestions: [], hint: 'Type at least 2 characters.' });
      }
      return success_({ suggestions: getStoreSuggestions_(q) });
    }

    if (action === 'getStoreHistory') {
      var storeKey = (e.parameter.store_key || '').toString().trim();
      var shop = (e.parameter.shop || '').toString().trim();
      if (!storeKey && !shop) {
        return error_('Provide store_key or shop', 400);
      }
      return success_(getStoreHistory_(storeKey, shop));
    }

    return error_('Unknown action. Use suggestStores or getStoreHistory.', 400);
  } catch (err) {
    return error_(String(err.message || err), 500);
  }
}
