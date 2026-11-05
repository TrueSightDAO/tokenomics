/**
 * File: Reservation Telegram Logs.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Project : 1dsWecVwbN0dOvilIz9r8DNt7LD3Ay13V8G9qliow4tZtF5LHsvQOFpF7
 *
 * Unit 3 of agentic_ai_context/RESERVATION_EVENT_SPEC.md - the GAS booking side.
 *
 * EVENT 1 - [RESERVATION EVENT] (money in, goods held):
 *   QR status -> RESERVED. Books the CASH leg ONLY (+sale price in USD to the
 *   `Payment Collected By` custodian). That is the revenue-carrying row (spec Ruled #3).
 *   NO inventory row, NO liability row (spec Ruled #1/#2). The goods legs are booked
 *   by `Reservation Settlement Telegram Logs.js`.
 *
 * Edgar routing (dao_protocol server/dispatch.py ROUTING):
 *   '[RESERVATION EVENT]' -> ("RESERVATION_PROCESSING", "processReservationTelegramLogs")
 *   invoked as GET <project>/exec?action=processReservationTelegramLogs
 *
 * MODULE SCOPE WARNING: every file in an Apps Script project shares ONE global scope.
 *   All top-level identifiers here are RSV_-prefixed consts / rsv...() functions so they
 *   can never collide with the sales parser's own top-level consts (a duplicate
 *   top-level const is a project-wide SyntaxError and would take the LIVE sales pipeline
 *   down). Parser helpers are REUSED, never redeclared: normalizeTelegramMessageId_,
 *   ensureQrSalesAppendHeaders_, normalizeSalesEventOptionalField,
 *   notifyTreasuryCachePublisher_, getAgroverseValue, updateAgroverseQrOwnerEmail.
 *
 * LEDGER SHAPE (verified against sales_update_managed_agl_ledgers.js):
 *   A = Sales Date | B = Value(message) | C = Contributor | D = Amount
 *   | E = Inventory Type / Currency | F = Category
 */

// ---------------------------------------------------------------- configuration
const RSV_SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const RSV_SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const RSV_DEST_SHEET_URL = 'docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=1003674539#gid=1003674539';
const RSV_DEST_SHEET_NAME = 'QR Code Sales';
const RSV_OFFCHAIN_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=995916231#gid=995916231';
const RSV_MAIN_LEDGER_SHEET_NAME = 'offchain transactions';
const RSV_AGL_TX_SHEET_NAME = 'Transactions';
/** QRs whose `ledger` column (C) is this land revenue on the main DAO offchain ledger. */
const RSV_MAIN_LEDGER_KEY = 'https://agroverse.shop/agl4';

const RSV_STATUS_RESERVED = 'RESERVED';
const RSV_STATUS_IGNORED = 'IGNORED';
const RSV_CURRENCY_USD = 'USD';
const RSV_CATEGORY_ASSETS = 'Assets';

// source sheet columns
const RSV_SOURCE_UPDATE_ID_COL = 0;  // A
const RSV_SOURCE_MSG_ID_COL = 3;     // D
const RSV_SOURCE_MESSAGE_COL = 6;    // G
const RSV_SOURCE_DATE_COL = 11;      // L
// QR Code Sales destination columns
const RSV_DEST_MSG_ID_COL = 1;       // B (dedupe)
const RSV_DEST_QR_COL = 4;           // E
const RSV_DEST_STATUS_COL = 9;       // J (ledger writers require this empty)
const RSV_DEST_REMARKS_COL = 17;     // R
const RSV_DEST_APPEND_COLS = 18;     // A..R
// Agroverse QR codes sheet columns
const RSV_QR_CODE_COL = 0;           // A
const RSV_QR_MANAGER_COL = 20;       // U Manager Name = holder
const RSV_QR_OWNER_EMAIL_COL_IDX = 11; // L (0-based) Owner Email

// ---------------------------------------------------------------- parsing
/** Extract "- Label: value" from an event payload; '' when absent. */
function rsvParseField_(message, label) {
  const re = new RegExp('-\\s*' + label + '\\s*:\\s*([^\\n]+)', 'i');
  const m = (message || '').match(re);
  return m ? m[1].trim() : '';
}

/** Parse a [RESERVATION EVENT] payload. Returns null when the tag is absent. */
function rsvParseReservationEvent_(message) {
  const msg = (message || '').toString();
  if (!/\[RESERVATION EVENT\]/i.test(msg)) return null;
  const priceRaw = rsvParseField_(msg, 'Sale Price');
  const price = parseFloat(String(priceRaw).replace(/[^0-9.]/g, ''));
  const currency = (rsvParseField_(msg, 'Currency') || RSV_CURRENCY_USD).toUpperCase();
  return {
    buyer: rsvParseField_(msg, 'Buyer'),
    buyerEmail: normalizeSalesEventOptionalField(rsvParseField_(msg, 'Buyer Email')),
    qrCode: rsvParseField_(msg, 'QR Code'),
    paymentCollectedBy: rsvParseField_(msg, 'Payment Collected By'),
    currency: currency,
    salePrice: isNaN(price) ? '' : price,
    note: normalizeSalesEventOptionalField(rsvParseField_(msg, 'Note')),
    attachedFilename: normalizeSalesEventOptionalField(rsvParseField_(msg, 'Attached Filename')),
    submissionSource: normalizeSalesEventOptionalField(rsvParseField_(msg, 'Submission Source'))
  };
}

/** Read the QR row from the Agroverse QR codes sheet. Returns null when absent. */
function rsvFindQrRow_(qrCode) {
  const want = String(qrCode || '').trim();
  if (!want) return null;
  const ss = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
  const sheet = ss.getSheetByName(AGROVERSE_QR_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][RSV_QR_CODE_COL]).trim() === want) {
      return { sheet: sheet, rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

/**
 * Set the QR status (Agroverse QR codes column D). `stampSoldDate` also writes today
 * into the Sold Date column (same column the sales parser stamps).
 */
function rsvSetQrStatus_(qrCode, status, stampSoldDate) {
  const hit = rsvFindQrRow_(qrCode);
  if (!hit) {
    Logger.log('rsvSetQrStatus_: QR not found: ' + qrCode);
    return false;
  }
  const s = String(status || '').toUpperCase();
  hit.sheet.getRange(hit.rowIndex, STATUS_COL + 1).setValue(s);
  if (stampSoldDate && s === RSV_STATUS_SOLD) {
    hit.sheet.getRange(hit.rowIndex, SOLD_DATE_COL + 1).setValue(new Date());
  }
  Logger.log('rsvSetQrStatus_: ' + qrCode + ' -> ' + s);
  return true;
}

/**
 * Resolve the ledger destination URL for a QR code from the Agroverse QR codes sheet.
 * Column C holds the ledger shortcut/URL (same source the movement processor reads).
 * Returns '' when the QR is unknown.
 */
function rsvResolveQrLedgerUrl_(qrCode) {
  const hit = rsvFindQrRow_(qrCode);
  if (!hit) return '';
  // Column C (index 2) = ledger shortcut/URL; column L (index 11) is a resolved URL on
  // some rows. Prefer an already-resolved docs.google.com URL, else resolve the shortcut
  // ('https://agroverse.shop/agl4') through the Shipment Ledger Listing map.
  const c = (hit.row[2] || '').toString().trim();
  const l = (hit.row[11] || '').toString().trim();
  if (/docs\.google\.com\/spreadsheets/.test(c)) return c;
  if (/docs\.google\.com\/spreadsheets/.test(l)) return l;
  return rsvResolveRedirect_(c || l);
}

/**
 * Resolve a public ledger shortcut (e.g. https://agroverse.shop/agl4) to its Google Sheet.
 * Inlined from sales_update_managed_agl_ledgers.js resolveRedirect() — GAS projects are
 * self-contained (the helper is duplicated per project by convention), so it must live here.
 * 1) look the shortcut up in 'Shipment Ledger Listing' (col L -> col AB), else
 * 2) follow HTTP/JS redirects up to 10 hops.
 */
function rsvResolveRedirect_(url) {
  const want = (url || '').toString().trim();
  if (!want) return '';
  try {
    const ss = SpreadsheetApp.openByUrl(RSV_OFFCHAIN_SHEET_URL);
    const sh = ss.getSheetByName(RSV_SHIPMENT_LISTING_SHEET_NAME);
    if (sh && sh.getLastRow() >= 2) {
      const data = sh.getRange(2, 1, sh.getLastRow() - 1, 28).getValues();
      for (let i = 0; i < data.length; i++) {
        const ledgerUrl = data[i][11] ? data[i][11].toString().trim() : ''; // Column L
        if (ledgerUrl === want) {
          const resolved = data[i][27] ? data[i][27].toString().trim() : ''; // Column AB
          if (resolved) return resolved;
        }
      }
    }
  } catch (e) {
    Logger.log('rsvResolveRedirect_ sheet lookup failed: ' + e.message);
  }
  try {
    let cur = want;
    for (let n = 0; n < 10; n++) {
      const resp = UrlFetchApp.fetch(cur, { followRedirects: false, muteHttpExceptions: true });
      const code = resp.getResponseCode();
      if (code < 300 || code >= 400) return cur;
      const h = resp.getHeaders();
      const loc = h['Location'] || h['location'];
      if (!loc) return '';
      cur = loc;
    }
  } catch (e) {
    Logger.log('rsvResolveRedirect_ http failed: ' + e.message);
  }
  return '';
}

/**
 * Append one ledger row to the destination sheet.
 * Row shape mirrors sales_update_managed_agl_ledgers.js:
 *   A date | B message/value | C contributor | D amount | E inventory type/currency | F category
 */
function rsvAppendLedgerRow_(destSheet, salesDate, message, contributor, amount, inventoryType, category) {
  const row = [
    salesDate || '',
    message || '',
    contributor || '',
    amount,
    inventoryType || '',
    category || RSV_CATEGORY_ASSETS
  ];
  destSheet.getRange(destSheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

/**
 * Book the reservation cash leg (spec Ruled #3 - the revenue-carrying row).
 * +salePrice in USD to the `Payment Collected By` custodian on the QR's ledger.
 * Returns the 1-based row number written, or '' on failure.
 */
function rsvBookCashLeg_(qrCode, salePrice, currency, custodian, salesDate, message) {
  const ledgerUrl = rsvResolveQrLedgerUrl_(qrCode);
  if (!ledgerUrl) {
    Logger.log('rsvBookCashLeg_: no ledger URL for QR ' + qrCode);
    return '';
  }
  const ss = SpreadsheetApp.openByUrl(ledgerUrl);
  const sheet = ss.getSheetByName(RSV_AGL_TX_SHEET_NAME) || ss.getSheetByName(RSV_MAIN_LEDGER_SHEET_NAME);
  if (!sheet) {
    Logger.log('rsvBookCashLeg_: no Transactions/offchain sheet in ' + ledgerUrl);
    return '';
  }
  const insertRow = sheet.getLastRow() + 1;
  rsvAppendLedgerRow_(sheet, salesDate, message, custodian, salePrice, currency || RSV_CURRENCY_USD, RSV_CATEGORY_ASSETS);
  Logger.log('rsvBookCashLeg_: +' + salePrice + ' ' + currency + ' to ' + custodian + ' @ ' + ledgerUrl + ' row ' + insertRow);
  return insertRow;
}

/** Append a QR Code Sales row so the message id dedupes later runs (status in col J). */
function rsvAppendQrSalesRow_(destSheet, updateId, msgId, message, salesDate, status, ownerEmail, extraRemarks) {
  ensureQrSalesAppendHeaders_(destSheet);
  const row = [
    updateId,                       // A
    msgId,                          // B dedupe
    message,                        // C
    '',                             // D
    '',                             // E QR (filled later by the sales parser on settlement)
    '',                             // F
    '',                             // G
    salesDate || '',                // H
    '',                             // I
    status || '',                   // J
    '',                             // K
    ownerEmail || '',               // L
    '', '', '', '', '',             // M..Q
    extraRemarks || ''              // R
  ];
  if (row.length !== RSV_DEST_APPEND_COLS) {
    throw new Error('rsvAppendQrSalesRow_: expected ' + RSV_DEST_APPEND_COLS + ' cols, got ' + row.length);
  }
  destSheet.getRange(destSheet.getLastRow() + 1, 1, 1, RSV_DEST_APPEND_COLS).setValues([row]);
}

// ---------------------------------------------------------------- main entrypoint
/**
 * Scan Telegram Chat Logs for unprocessed [RESERVATION EVENT] rows, verify them, book the
 * cash leg, and set the QR to RESERVED. Idempotent: dedupes on Telegram message id
 * (QR Code Sales column B). Never writes an inventory or liability row (spec Ruled #1/#2).
 *
 * @return {{processed:number, ignored:number, bookings:Array<string>}}
 */
function processReservationTelegramLogs() {
  const lock = LockService.getScriptLock();
  const LOCK_WAIT_MS = 300000;
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    Logger.log('processReservationTelegramLogs: script lock not acquired; another run in progress');
    return { processed: 0, ignored: 0, bookings: [] };
  }
  try {
    const src = SpreadsheetApp.openByUrl(RSV_SOURCE_SHEET_URL).getSheetByName(RSV_SOURCE_SHEET_NAME);
    const dst = SpreadsheetApp.openByUrl(RSV_DEST_SHEET_URL).getSheetByName(RSV_DEST_SHEET_NAME);
    ensureQrSalesAppendHeaders_(dst);
    const srcData = src.getDataRange().getValues();
    const dstData = dst.getDataRange().getValues();
    const seenMsgIds = {};
    for (let i = 1; i < dstData.length; i++) {
      seenMsgIds[normalizeTelegramMessageId_(dstData[i][RSV_DEST_MSG_ID_COL])] = true;
    }

    let processed = 0, ignored = 0;
    const bookings = [];

    for (let i = 1; i < srcData.length; i++) {
      const message = srcData[i][RSV_SOURCE_MESSAGE_COL];
      if (!message || !/\[RESERVATION EVENT\]/i.test(String(message))) continue;

      const msgId = normalizeTelegramMessageId_(srcData[i][RSV_SOURCE_MSG_ID_COL]);
      if (seenMsgIds[msgId]) continue; // already handled by a prior run
      const salesDate = srcData[i][RSV_SOURCE_DATE_COL] || '';

      const ev = rsvParseReservationEvent_(message);
      if (!ev || !ev.qrCode || ev.salePrice === '') {
        rsvAppendQrSalesRow_(dst, srcData[i][RSV_SOURCE_UPDATE_ID_COL], msgId, message, salesDate,
          RSV_STATUS_IGNORED, '', 'IGNORED: [RESERVATION EVENT] missing QR Code or Sale Price after parse.');
        seenMsgIds[msgId] = true;
        ignored++;
        continue;
      }

      // QR must already exist (spec Prerequisites #1).
      const qrHit = rsvFindQrRow_(ev.qrCode);
      if (!qrHit) {
        rsvAppendQrSalesRow_(dst, srcData[i][RSV_SOURCE_UPDATE_ID_COL], msgId, message, salesDate,
          RSV_STATUS_IGNORED, '', 'IGNORED: QR ' + ev.qrCode + ' not found in Agroverse QR codes (mint first).');
        seenMsgIds[msgId] = true;
        ignored++;
        continue;
      }

      const custodian = ev.paymentCollectedBy || '';
      const rowNo = rsvBookCashLeg_(ev.qrCode, ev.salePrice, ev.currency, custodian, salesDate, message);
      rsvSetQrStatus_(ev.qrCode, RSV_STATUS_RESERVED, false);
      if (ev.buyerEmail) {
        try { updateAgroverseQrOwnerEmail(ev.qrCode, ev.buyerEmail); } catch (e) { Logger.log('owner email: ' + e.message); }
      }

      const remarks = 'RESERVATION: cash leg ' + (rowNo ? ('row ' + rowNo) : 'NOT BOOKED')
        + '; ' + ev.currency + ' ' + ev.salePrice + ' collected by ' + custodian
        + (ev.note ? ('; note: ' + ev.note) : '')
        + '; inventory + liability legs deferred to settlement.';
      rsvAppendQrSalesRow_(dst, srcData[i][RSV_SOURCE_UPDATE_ID_COL], msgId, message, salesDate,
        RSV_STATUS_RESERVED, ev.buyerEmail, remarks);

      seenMsgIds[msgId] = true;
      processed++;
      bookings.push(ev.qrCode + ':' + rowNo);
      Logger.log('processReservationTelegramLogs: reserved ' + ev.qrCode + ' (row ' + rowNo + ')');
    }

    try { notifyTreasuryCachePublisher_('process_reservation'); } catch (e) { Logger.log('treasury notify: ' + e.message); }
    Logger.log('processReservationTelegramLogs: processed=' + processed + ' ignored=' + ignored);
    return { processed: processed, ignored: ignored, bookings: bookings };
  } finally {
    lock.releaseLock();
  }
}
