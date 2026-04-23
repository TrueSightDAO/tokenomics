/**
 * File: google_app_scripts/holistic_hit_list_store_history/store_interaction_history_api.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/14gKJ0VW49RsSn4S03pgxKXy0sp4Z7Z3Wm1Wj8jQiWW5dj1sFuPnp95sh/edit
 *
 * Description: Read-only REST-style GET API for the DApp "Store Interaction History".
 *   Autocomplete against Hit List; return one Hit List row plus matching rows from
 *   DApp Remarks, Email Agent Follow Up, and Email Agent Drafts (human-in-the-loop
 *   context before sending partner email). History arrays are sorted newest-first when
 *   date/timestamp columns are present; otherwise row order is reversed (sheet old→new).
 *
 * Deployment URL: https://script.google.com/macros/s/AKfycbwoBqZnDS4JRRdFkxSXdlGt-qIn-RauMcORuDHeWs29oQ2CpJ3L4A10uM8se9anL108/exec
 *
 * Deployment: Deploy as web app — Execute as: Me; Who has access: Anyone (or org policy).
 *   If access is too restricted, fetch() from the DApp shows a CORS error (browser gets HTML without
 *   Access-Control-Allow-Origin). This is a deployment setting issue, not a missing JSONP wrapper.
 *
 * DApp consumers: store_interaction_history.html, stores_by_status.html (same API_BASE_URL / token).
 *   stores_by_status.html also calls listStatusSummary for a Pipeline-style count overview.
 *   GitHub Pages: https://truesightdao.github.io/dapp/ — constants must match this deployment URL after redeploys.
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
var SHEET_EMAIL_DRAFTS = 'Email Agent Drafts';

/** Max autocomplete results per suggestStores request. */
var SUGGEST_LIMIT = 30;
/** Cap per section to keep getStoreHistory payloads bounded. */
var MAX_HISTORY_ROWS_PER_SECTION = 200;
/** Max rows returned by listStoresByFilter (hard cap). */
var LIST_FILTER_MAX_LIMIT = 500;

/**
 * Send-depth buckets for AU / AV (aligned with Pipeline Dashboard columns F:M):
 * index 0 = 0 sends, 1..6 = exactly that many, 7 = {TOUCH_BUCKET_TAIL_MIN}+ sends.
 */
var TOUCH_BUCKET_MAX_EXACT = 6;
var TOUCH_BUCKET_TAIL_MIN = 7;
var TOUCH_BUCKET_LEN = 1 + TOUCH_BUCKET_MAX_EXACT + 1;

/** Map raw sent count (AU or AV) to bucket index 0..TOUCH_BUCKET_LEN-1. */
function hitListTouchBucketIndex_(n) {
  var x = typeof n === 'number' ? n : parseFloat(String(n || '').trim().replace(/,/g, ''));
  if (isNaN(x) || x < 0) x = 0;
  x = Math.floor(x);
  if (x <= 0) return 0;
  if (x >= TOUCH_BUCKET_TAIL_MIN) return TOUCH_BUCKET_LEN - 1;
  return Math.min(x, TOUCH_BUCKET_MAX_EXACT);
}

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

/**
 * Repeated query params (e.g. ?status=a&status=b) become arrays on e.parameters in web apps.
 * Single value is a string.
 */
function getParamList_(e, key) {
  var p = e.parameters[key];
  if (!p) return [];
  if (Object.prototype.toString.call(p) === '[object Array]') {
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var s = String(p[i] || '').trim();
      if (s) out.push(s);
    }
    return out;
  }
  var single = String(p).trim();
  if (!single) return [];
  return [single];
}

/** Integer sent-touch count from Hit List formula cells (AU / AV). */
function hitListTouchCountFromCell_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = parseFloat(String(v).trim().replace(/,/g, ''));
  if (isNaN(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Locate **Warm-up email sent** (AU) and **Follow-up emails sent** (AV) columns (0-based indices).
 * Falls back to columns 47 / 48 when headers exist but names differ.
 */
function hitListFindTouchColumns_(hdr, headerRow) {
  var au = hdr['Warm-up email sent'];
  var av = hdr['Follow-up emails sent'];
  var i;
  var h;
  if (au === undefined) {
    for (i = 0; i < headerRow.length; i++) {
      h = String(headerRow[i] || '')
        .trim()
        .toLowerCase();
      if (h.indexOf('warm') !== -1 && h.indexOf('email') !== -1) {
        au = i;
        break;
      }
    }
  }
  if (av === undefined) {
    for (i = 0; i < headerRow.length; i++) {
      h = String(headerRow[i] || '')
        .trim()
        .toLowerCase();
      if (h.indexOf('follow') !== -1 && h.indexOf('email') !== -1) {
        av = i;
        break;
      }
    }
  }
  if (au === undefined && headerRow.length >= 47) au = 46;
  if (av === undefined && headerRow.length >= 48) av = 47;
  return { au: au, av: av };
}

function hitListMakeEmptyTouchAgg_() {
  var wu = [];
  var fu = [];
  var i;
  for (i = 0; i < TOUCH_BUCKET_LEN; i++) {
    wu.push(0);
    fu.push(0);
  }
  return { count: 0, wu: wu, fu: fu };
}

function hitListBumpTouchAgg_(agg, wu, fu) {
  agg.count++;
  var wi = hitListTouchBucketIndex_(wu);
  var fi = hitListTouchBucketIndex_(fu);
  agg.wu[wi]++;
  agg.fu[fi]++;
}

/** Eight bucket counts for warm-up (AU); same order as Pipeline Dashboard F:M. */
function hitListTouchAggToBuckets_(agg) {
  return agg.wu.slice();
}

/** Eight bucket counts for follow-up (AV). */
function hitListTouchAggToBucketsFu_(agg) {
  return agg.fu.slice();
}

/**
 * Filter Hit List rows by Status / Shop Type (exact match to sheet cell values).
 * Empty statusList = no status filter (all). Empty shopTypeList = no shop-type filter (all).
 */
function listHitListByFilter_(statusList, shopTypeList, limit, offset) {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sh = getSheetSafe_(ss, SHEET_HIT_LIST);
  if (!sh) {
    return { rows: [], total: 0, offset: offset, limit: limit };
  }

  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return { rows: [], total: 0, offset: offset, limit: limit };
  }

  var headers = values[0];

  var wantStatus = statusList && statusList.length > 0;
  var wantShopType = shopTypeList && shopTypeList.length > 0;

  var wuB = null;
  var fuB = null;
  if (warmupBucket !== null && warmupBucket !== undefined) {
    var t1 = parseInt(warmupBucket, 10);
    if (!isNaN(t1) && t1 >= 0 && t1 < TOUCH_BUCKET_LEN) wuB = t1;
  }
  if (followupBucket !== null && followupBucket !== undefined) {
    var t2 = parseInt(followupBucket, 10);
    if (!isNaN(t2) && t2 >= 0 && t2 < TOUCH_BUCKET_LEN) fuB = t2;
  }

  var hdr = headerMap_(headers);
  var touchCols = hitListFindTouchColumns_(hdr, headers);

  var matched = [];
  var r;
  for (r = 1; r < values.length; r++) {
    var row = values[r];
    var rowObj = rowToObj_(headers, row);
    var st = (rowObj['Status'] || '').trim();
    var stt = (rowObj['Shop Type'] || '').trim();

    if (wantStatus) {
      var ok = false;
      var si;
      for (si = 0; si < statusList.length; si++) {
        if (statusList[si] === st) {
          ok = true;
          break;
        }
      }
      if (!ok) continue;
    }
    if (wantShopType) {
      var ok2 = false;
      var ti;
      for (ti = 0; ti < shopTypeList.length; ti++) {
        if (shopTypeList[ti] === stt) {
          ok2 = true;
          break;
        }
      }
      if (!ok2) continue;
    }

    var wu = touchCols.au !== undefined ? hitListTouchCountFromCell_(row[touchCols.au]) : 0;
    var fu = touchCols.av !== undefined ? hitListTouchCountFromCell_(row[touchCols.av]) : 0;

    if (wuB !== null && hitListTouchBucketIndex_(wu) !== wuB) continue;
    if (fuB !== null && hitListTouchBucketIndex_(fu) !== fuB) continue;

    matched.push({
      store_key: (rowObj['Store Key'] || '').trim(),
      shop_name: (rowObj['Shop Name'] || '').trim(),
      status: st,
      shop_type: stt,
      city: (rowObj['City'] || '').trim(),
      state: (rowObj['State'] || '').trim(),
      email: (rowObj['Email'] || '').trim(),
      status_updated:
        (rowObj['Status Updated Date'] || rowObj['Status Updated At'] || rowObj['Status Updated'] || '').trim(),
      hit_list_row: r + 1,
      warmup_sent: wu,
      followup_sent: fu,
    });
  }

  var total = matched.length;
  var start = Math.max(0, offset);
  var lim = Math.min(Math.max(1, limit), LIST_FILTER_MAX_LIMIT);
  var end = Math.min(start + lim, total);
  var page = matched.slice(start, end);

  return { rows: page, total: total, offset: start, limit: lim, returned: page.length };
}

/**
 * One-pass counts for Pipeline-style overview (mirrors Hit List, not the "Pipeline Dashboard" sheet formulas).
 * Each bucket includes **warmup** / **followup** counts from Hit List columns AU / AV grouped into
 * eight depth buckets (0 sends, 1…6 sends, then 7+), matching the Pipeline Dashboard.
 */
function hitListPipelineSummary_() {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sh = getSheetSafe_(ss, SHEET_HIT_LIST);
  if (!sh) {
    return {
      by_status: [],
      by_shop_type: [],
      total_data_rows: 0,
      blank_status: 0,
      blank_shop_type: 0,
      touch_metrics_available: false,
    };
  }

  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return {
      by_status: [],
      by_shop_type: [],
      total_data_rows: 0,
      blank_status: 0,
      blank_shop_type: 0,
      touch_metrics_available: false,
    };
  }

  var headers = values[0];
  var hdr = headerMap_(headers);
  var statusIdx = hdr['Status'];
  var shopTypeIdx = hdr['Shop Type'];
  if (statusIdx === undefined && shopTypeIdx === undefined) {
    return {
      by_status: [],
      by_shop_type: [],
      total_data_rows: values.length - 1,
      blank_status: 0,
      blank_shop_type: 0,
      touch_metrics_available: false,
    };
  }

  var touchCols = hitListFindTouchColumns_(hdr, headers);
  var touchOk = touchCols.au !== undefined && touchCols.av !== undefined;

  var statusAggs = {};
  var shopAggs = {};
  var blankSt = 0;
  var blankShop = 0;
  var r;

  for (r = 1; r < values.length; r++) {
    var row = values[r];
    var wu = touchOk ? hitListTouchCountFromCell_(row[touchCols.au]) : 0;
    var fu = touchOk ? hitListTouchCountFromCell_(row[touchCols.av]) : 0;

    if (statusIdx !== undefined) {
      var st = row[statusIdx] !== undefined && row[statusIdx] !== null ? String(row[statusIdx]).trim() : '';
      if (!st) blankSt++;
      else {
        if (!statusAggs[st]) statusAggs[st] = hitListMakeEmptyTouchAgg_();
        hitListBumpTouchAgg_(statusAggs[st], wu, fu);
      }
    }
    if (shopTypeIdx !== undefined) {
      var stt = row[shopTypeIdx] !== undefined && row[shopTypeIdx] !== null ? String(row[shopTypeIdx]).trim() : '';
      if (!stt) blankShop++;
      else {
        if (!shopAggs[stt]) shopAggs[stt] = hitListMakeEmptyTouchAgg_();
        hitListBumpTouchAgg_(shopAggs[stt], wu, fu);
      }
    }
  }

  function sortKeysByCountDesc_(aggsMap) {
    var keys = [];
    for (var k in aggsMap) {
      if (Object.prototype.hasOwnProperty.call(aggsMap, k)) keys.push(k);
    }
    keys.sort(function (a, b) {
      return aggsMap[b].count - aggsMap[a].count;
    });
    return keys;
  }

  var byStatus = [];
  var stKeys = sortKeysByCountDesc_(statusAggs);
  var si;
  for (si = 0; si < stKeys.length; si++) {
    var stk = stKeys[si];
    var sa = statusAggs[stk];
    var rowObj = { status: stk, count: sa.count };
    if (touchOk) {
      rowObj.warmup = hitListTouchAggToBuckets_(sa);
      rowObj.followup = hitListTouchAggToBucketsFu_(sa);
    }
    byStatus.push(rowObj);
  }

  var byShop = [];
  var shKeys = sortKeysByCountDesc_(shopAggs);
  var ti;
  for (ti = 0; ti < shKeys.length; ti++) {
    var shk = shKeys[ti];
    var ga = shopAggs[shk];
    var rowShop = { shop_type: shk, count: ga.count };
    if (touchOk) {
      rowShop.warmup = hitListTouchAggToBuckets_(ga);
      rowShop.followup = hitListTouchAggToBucketsFu_(ga);
    }
    byShop.push(rowShop);
  }

  return {
    by_status: byStatus,
    by_shop_type: byShop,
    total_data_rows: values.length - 1,
    blank_status: blankSt,
    blank_shop_type: blankShop,
    touch_metrics_available: touchOk,
  };
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
      email_agent_drafts: [],
      message: 'Store not found for store_key/shop. Pick from suggestions.',
    };
  }

  var hl = hit.row_obj;
  var sk = hl['Store Key'] || storeKey || '';
  var shop = hl['Shop Name'] || shopName || '';
  var email = hl['Email'] || '';

  var remarks = filterRowsForStore_(SHEET_DAPP_REMARKS, ss, sk, '', shop);
  var follow = filterRowsForStore_(SHEET_EMAIL_FOLLOW_UP, ss, sk, email, shop);
  var sugg = filterRowsForStore_(SHEET_EMAIL_DRAFTS, ss, sk, email, shop);

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
    email_agent_drafts: suggRows,
  };
}

/**
 * Web app entrypoint (GET only). JSON body: { status: 'success'|'error', data?: object, message?: string }.
 *
 * Actions:
 *   - suggestStores — e.parameter.q (min length 2); data.suggestions[]: shop_name, store_key, email, hit_list_row
 *   - getStoreHistory — e.parameter.store_key and/or shop; data includes hit_list, dapp_remarks[], email_agent_follow_up[], email_agent_drafts[]
 *   - listStoresByFilter — optional repeated status=, shop_type=; optional warmup_bucket=, followup_bucket=
 *       (each 0..7: send-depth bucket for AU / AV). limit (default 200, max 500), offset (default 0).
 *       Empty status list = all statuses; empty shop_type = all shop types. Each row may include **warmup_sent**,
 *       **followup_sent** (from Hit List AU / AV when present).
 *   - listStatusSummary — no extra params; data.by_status[] / by_shop_type[] include **count** plus optional
 *       **warmup** / **followup** — each an array of eight integers (bucket counts); **touch_metrics_available** when resolved.
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

    if (action === 'listStoresByFilter') {
      var statusList = getParamList_(e, 'status');
      var shopTypeList = getParamList_(e, 'shop_type');
      var limRaw = parseInt((e.parameter.limit || '200').toString(), 10);
      var offRaw = parseInt((e.parameter.offset || '0').toString(), 10);
      var lim = isNaN(limRaw) ? 200 : limRaw;
      var off = isNaN(offRaw) ? 0 : offRaw;
      var wbRaw = (e.parameter.warmup_bucket || '').toString().trim();
      var fbRaw = (e.parameter.followup_bucket || '').toString().trim();
      var warmupB = wbRaw === '' ? null : parseInt(wbRaw, 10);
      var followB = fbRaw === '' ? null : parseInt(fbRaw, 10);
      if (warmupB !== null && isNaN(warmupB)) warmupB = null;
      if (followB !== null && isNaN(followB)) followB = null;
      return success_(
        listHitListByFilter_(statusList, shopTypeList, lim, off, warmupB, followB)
      );
    }

    if (action === 'listStatusSummary') {
      return success_(hitListPipelineSummary_());
    }

    return error_(
      'Unknown action. Use suggestStores, getStoreHistory, listStoresByFilter, or listStatusSummary.',
      400
    );
  } catch (err) {
    return error_(String(err.message || err), 500);
  }
}
