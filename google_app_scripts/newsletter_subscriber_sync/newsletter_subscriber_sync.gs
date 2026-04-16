/**
 * File: google_app_scripts/newsletter_subscriber_sync/newsletter_subscriber_sync.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1XIz0hs7lH4DgjamUwQZeO4DwVTG8tqKjGElL9XB2StrkPXbHYeETOWBx/edit
 *
 * Description: Consolidates newsletter subscriber emails into the ledger tab
 * "Agroverse News Letter Subscribers" from:
 *   - Holistic workbook -> "Email Agent Suggestions" (column to_email)
 *   - Ledger -> "Agroverse QR codes" (Owner Email / column L, or header-based)
 *   - Holistic workbook -> "Hit List" -> Email only when Status is exactly "Partnered"
 *
 * Dedupe: normalized email (trim + lowercase) + Source. Same person may appear once per source.
 *
 * ============================================================================
 * DAILY SYNC - TIME-DRIVEN TRIGGER
 * ============================================================================
 * In Apps Script: Triggers -> Add trigger -> Choose function:
 *   runDailyNewsletterSubscriberSync
 * Select event source: Time-driven -> Day timer -> pick hour.
 * Do not use a different function name for production schedule unless you know why.
 * ============================================================================
 */

// --- Ledger (TrueSight DAO asset spreadsheet) ---
var LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var SUBSCRIBERS_SHEET_NAME = 'Agroverse News Letter Subscribers';
var QR_CODES_SHEET_NAME = 'Agroverse QR codes';

// --- Holistic wellness hit list workbook ---
var HOLISTIC_SPREADSHEET_ID = '1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc';
var SHEET_EMAIL_SUGGESTIONS = 'Email Agent Suggestions';
var SHEET_HIT_LIST = 'Hit List';

/** Values written to the Source column for new rows (stable strings for dedupe). */
var SOURCE_EMAIL_AGENT = 'Email Agent Suggestions';
var SOURCE_QR_CODES = 'Agroverse QR codes';
var SOURCE_HIT_LIST_PARTNERED = 'Hit List (Partnered)';

/** New rows added by this sync use this Status unless you change the constant. */
var DEFAULT_NEW_ROW_STATUS = 'PENDING';

/** Hit List: only rows whose Status cell equals this exact string are synced. */
var HIT_LIST_PARTNERED_STATUS = 'Partnered';

/** If header row has no recognizable email column on Agroverse QR codes, use this 0-based column index (L = Owner Email). */
var QR_EMAIL_COLUMN_FALLBACK_INDEX = 11;

// ============================================================================
// ENTRY POINT FOR TIME-DRIVEN (DAILY) TRIGGER
// ============================================================================

/**
 * Bind your daily time-driven trigger to this function.
 * Runs a full pull from all sources and appends missing (email, Source) pairs.
 *
 * @return {Object} Summary counts per source and total appended
 */
function runDailyNewsletterSubscriberSync() {
  var summary = syncNewsletterSubscribersFromAllSources_();
  Logger.log(
    'Newsletter sync done. Appended: ' +
      summary.appended +
      ' (email_agent=' +
      summary.fromEmailAgent +
      ', qr=' +
      summary.fromQrCodes +
      ', hit_list_partnered=' +
      summary.fromHitList +
      ')'
  );
  return summary;
}

/**
 * Manual test hook (same logic as daily run).
 */
function testRunNewsletterSubscriberSyncOnce() {
  return runDailyNewsletterSubscriberSync();
}

// ============================================================================
// Core sync
// ============================================================================

function syncNewsletterSubscribersFromAllSources_() {
  var out = {
    appended: 0,
    fromEmailAgent: 0,
    fromQrCodes: 0,
    fromHitList: 0,
    errors: [],
  };

  var ledger = SpreadsheetApp.openById(LEDGER_SPREADSHEET_ID);
  var subSheet = ledger.getSheetByName(SUBSCRIBERS_SHEET_NAME);
  if (!subSheet) {
    throw new Error('Subscribers sheet not found: "' + SUBSCRIBERS_SHEET_NAME + '"');
  }

  ensureSubscriberHeaders_(subSheet);

  var colMap = getHeaderMap_(subSheet.getRange(1, 1, 1, subSheet.getLastColumn()).getValues()[0]);
  var emailCol = colMap['Email'];
  var sourceCol = colMap['Source'];
  if (emailCol === undefined || sourceCol === undefined) {
    throw new Error('Subscribers sheet must have "Email" and "Source" headers in row 1.');
  }

  var statusCol = colMap['Status'];
  var createdCol = colMap['Created Date'];
  var importedCol = colMap['Imported Date'];
  var detailCol = colMap['Detail'];

  var existingKeys = loadExistingDedupeKeys_(subSheet, emailCol, sourceCol);

  var holistic = SpreadsheetApp.openById(HOLISTIC_SPREADSHEET_ID);
  var toAppend = [];

  collectFromEmailAgentSuggestions_(holistic, existingKeys, toAppend, out);
  collectFromAgroverseQrCodes_(ledger, existingKeys, toAppend, out);
  collectFromHitListPartnered_(holistic, existingKeys, toAppend, out);

  if (toAppend.length === 0) {
    return out;
  }

  var now = new Date();
  var startRow = subSheet.getLastRow() + 1;
  var width = subSheet.getLastColumn();
  var grid = [];
  var r;
  var row;
  var arr;

  for (r = 0; r < toAppend.length; r++) {
    row = toAppend[r];
    arr = new Array(width);
    var c;
    for (c = 0; c < width; c++) {
      arr[c] = '';
    }
    arr[emailCol] = row.emailDisplay;
    arr[sourceCol] = row.source;
    if (statusCol !== undefined) {
      arr[statusCol] = DEFAULT_NEW_ROW_STATUS;
    }
    if (createdCol !== undefined) {
      arr[createdCol] = now;
    }
    if (importedCol !== undefined) {
      arr[importedCol] = now;
    }
    if (detailCol !== undefined && row.detail) {
      arr[detailCol] = row.detail;
    }
    grid.push(arr);
  }

  /** getRange(row, col, numRows, numColumns) — 3rd/4th args are COUNTS, not end row/column */
  subSheet.getRange(startRow, 1, grid.length, width).setValues(grid);
  out.appended = grid.length;
  return out;
}

function ensureSubscriberHeaders_(sheet) {
  var need = ['Email', 'Source', 'Status', 'Created Date', 'Imported Date'];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    lastCol = 1;
  }
  /** Width of row 1 to scan: avoid reading only col A while data exists in B:E */
  var scanWidth = Math.max(lastCol, need.length);
  var headerRow = sheet.getRange(1, 1, 1, scanWidth).getValues()[0];
  var map = getHeaderMap_(headerRow);
  var missing = [];
  var i;
  for (i = 0; i < need.length; i++) {
    if (map[need[i]] === undefined) {
      missing.push(need[i]);
    }
  }
  if (missing.length === 0) {
    return;
  }

  var rowEmpty = true;
  var j;
  for (j = 0; j < headerRow.length; j++) {
    if ((headerRow[j] || '').toString().trim()) {
      rowEmpty = false;
      break;
    }
  }
  if (rowEmpty) {
    sheet.getRange(1, 1, 1, need.length).setValues([need.concat()]);
    return;
  }

  /** Fill missing labels into blank cells left-to-right, then append any remainder */
  var updates = [];
  for (j = 0; j < headerRow.length; j++) {
    updates.push(headerRow[j]);
  }
  var mi = 0;
  for (var k = 0; k < updates.length && mi < missing.length; k++) {
    if (!(updates[k] || '').toString().trim()) {
      updates[k] = missing[mi++];
    }
  }
  while (mi < missing.length) {
    updates.push(missing[mi++]);
  }
  sheet.getRange(1, 1, 1, updates.length).setValues([updates]);
}

function collectFromEmailAgentSuggestions_(holistic, existingKeys, toAppend, out) {
  var sh = holistic.getSheetByName(SHEET_EMAIL_SUGGESTIONS);
  if (!sh) {
    out.errors.push('Missing sheet: ' + SHEET_EMAIL_SUGGESTIONS);
    return;
  }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return;
  }

  var hdr = getHeaderMap_(values[0]);
  var emailIdx =
    hdr['to_email'] !== undefined
      ? hdr['to_email']
      : hdr['To'] !== undefined
        ? hdr['To']
        : hdr['Email'];
  if (emailIdx === undefined) {
    return;
  }

  var shopIdx = hdr['shop_name'] !== undefined ? hdr['shop_name'] : hdr['Shop Name'];

  var r;
  for (r = 1; r < values.length; r++) {
    var raw = values[r][emailIdx];
    var norm = normalizeEmail_(raw);
    if (!norm) {
      continue;
    }

    var key = dedupeKey_(norm, SOURCE_EMAIL_AGENT);
    if (existingKeys[key]) {
      continue;
    }
    existingKeys[key] = true;

    var detail = '';
    if (shopIdx !== undefined && values[r][shopIdx]) {
      detail = 'shop: ' + String(values[r][shopIdx]).trim();
    }

    toAppend.push({
      emailDisplay: String(raw).trim(),
      source: SOURCE_EMAIL_AGENT,
      detail: detail,
    });
    out.fromEmailAgent++;
  }
}

function collectFromAgroverseQrCodes_(ledger, existingKeys, toAppend, out) {
  var sh = ledger.getSheetByName(QR_CODES_SHEET_NAME);
  if (!sh) {
    out.errors.push('Missing sheet: ' + QR_CODES_SHEET_NAME);
    return;
  }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return;
  }

  var hdr = getHeaderMap_(values[0]);
  var emailIdx = findQrEmailColumnIndex_(hdr);
  if (emailIdx === undefined) {
    emailIdx = QR_EMAIL_COLUMN_FALLBACK_INDEX;
  }

  var qrIdx = hdr['qr_code'] !== undefined ? hdr['qr_code'] : 0;

  var r;
  for (r = 1; r < values.length; r++) {
    var row = values[r];
    var raw = row[emailIdx];
    var norm = normalizeEmail_(raw);
    if (!norm) {
      continue;
    }

    var key = dedupeKey_(norm, SOURCE_QR_CODES);
    if (existingKeys[key]) {
      continue;
    }
    existingKeys[key] = true;

    var detail = '';
    if (row[qrIdx]) {
      detail = 'qr_code: ' + String(row[qrIdx]).trim();
    }

    toAppend.push({
      emailDisplay: String(raw).trim(),
      source: SOURCE_QR_CODES,
      detail: detail,
    });
    out.fromQrCodes++;
  }
}

function findQrEmailColumnIndex_(hdr) {
  var names = ['Owner Email', 'owner_email', 'Email', 'email', 'Buyer Email', 'Customer Email', 'customer_email'];
  var i;
  for (i = 0; i < names.length; i++) {
    if (hdr[names[i]] !== undefined) {
      return hdr[names[i]];
    }
  }
  return undefined;
}

function collectFromHitListPartnered_(holistic, existingKeys, toAppend, out) {
  var sh = holistic.getSheetByName(SHEET_HIT_LIST);
  if (!sh) {
    out.errors.push('Missing sheet: ' + SHEET_HIT_LIST);
    return;
  }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return;
  }

  var hdr = getHeaderMap_(values[0]);
  var emailIdx = hdr['Email'];
  var statusIdx = hdr['Status'];
  var shopIdx = hdr['Shop Name'];

  if (emailIdx === undefined || statusIdx === undefined) {
    return;
  }

  var r;
  for (r = 1; r < values.length; r++) {
    var row = values[r];
    var status = row[statusIdx] !== undefined && row[statusIdx] !== null ? String(row[statusIdx]).trim() : '';
    if (status !== HIT_LIST_PARTNERED_STATUS) {
      continue;
    }

    var raw = row[emailIdx];
    var norm = normalizeEmail_(raw);
    if (!norm) {
      continue;
    }

    var key = dedupeKey_(norm, SOURCE_HIT_LIST_PARTNERED);
    if (existingKeys[key]) {
      continue;
    }
    existingKeys[key] = true;

    var detail = '';
    if (shopIdx !== undefined && row[shopIdx]) {
      detail = 'shop: ' + String(row[shopIdx]).trim();
    }

    toAppend.push({
      emailDisplay: String(raw).trim(),
      source: SOURCE_HIT_LIST_PARTNERED,
      detail: detail,
    });
    out.fromHitList++;
  }
}

function loadExistingDedupeKeys_(sheet, emailCol, sourceCol) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return keys;
  }

  var width = sheet.getLastColumn();
  /** Rows 2..lastRow inclusive => numRows = lastRow - 1 */
  var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  var i;
  for (i = 0; i < data.length; i++) {
    var em = data[i][emailCol];
    var src = data[i][sourceCol];
    var norm = normalizeEmail_(em);
    if (!norm) {
      continue;
    }
    var srcStr = src !== undefined && src !== null ? String(src).trim() : '';
    if (!srcStr) {
      continue;
    }
    keys[dedupeKey_(norm, srcStr)] = true;
  }
  return keys;
}

function dedupeKey_(normalizedEmail, sourceLabel) {
  return normalizedEmail + '\n' + sourceLabel;
}

function normalizeEmail_(v) {
  if (v === null || v === undefined) {
    return '';
  }
  var s = String(v).trim().toLowerCase();
  if (!s || s.indexOf('@') === -1) {
    return '';
  }
  return s;
}

function getHeaderMap_(headerRow) {
  var map = {};
  var i;
  for (i = 0; i < headerRow.length; i++) {
    var h = (headerRow[i] || '').toString().trim();
    if (h) {
      map[h] = i;
    }
  }
  return map;
}
