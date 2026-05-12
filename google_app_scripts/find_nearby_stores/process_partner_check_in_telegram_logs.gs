/**
 * File: google_app_scripts/find_nearby_stores/process_partner_check_in_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Description: Async scanner for `[PARTNER CHECK-IN EVENT]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   Edgar writes the signed payload into Telegram Chat Logs col G, then enqueues a
 *   webhook to this script (`?action=processPartnerCheckInsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose `Update ID` (PCI_…) is not yet present in
 *   **Partner Check-ins** col K on the Main Ledger, this scanner appends one row A–M.
 *
 *   The append also serves as the dedup log for future runs (idempotent).
 *
 * Mirror canonicalization status:
 *   This file is canonical. Copy to the clasp mirror as `.js` before pushing.
 *   Also add a `?action=processPartnerCheckInsFromTelegramChatLogs` branch to
 *   the mirror's `doGet` (Code.js).
 *
 *   Sync command (run from `tokenomics/`):
 *     cp google_app_scripts/find_nearby_stores/process_partner_check_in_telegram_logs.gs \
 *        clasp_mirrors/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/process_partner_check_in_telegram_logs.js
 */

/** Telegram Chat Logs intake spreadsheet (Edgar writes col G of every signed event here). */
var TELEGRAM_CHAT_LOGS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var TELEGRAM_CHAT_LOGS_SHEET = 'Telegram Chat Logs';
/** Telegram Chat Logs col G (zero-based 6) — signed event text Edgar wrote. */
var TELEGRAM_CHAT_LOGS_MESSAGE_COL = 6;
/** Per-fire scan window. */
var PARTNER_CHECK_IN_SCAN_BATCH = 200;

/** Main Ledger spreadsheet where Partner Check-ins tab lives. */
var MAIN_LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var PARTNER_CHECK_INS_SHEET = 'Partner Check-ins';

/**
 * Parse a `[PARTNER CHECK-IN EVENT]` body into a key→value map.
 * @param {string} text
 * @return {Object<string,string>}
 */
function parsePartnerCheckInText_(text) {
  var result = {};
  if (!text) return result;
  var body = String(text).split('--------', 1)[0] || String(text);
  var lines = body.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = (lines[i] || '').trim();
    if (!line) continue;
    if (line.indexOf('[PARTNER CHECK-IN EVENT]') === 0) continue;
    if (line.charAt(0) === '-') line = line.substring(1).trim();
    var m = line.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (!m) continue;
    var key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    result[key] = m[2].trim();
  }
  return result;
}

/**
 * Pull the contributor public key from the signed payload.
 * @param {string} text
 * @return {string}
 */
function extractMyDigitalSignatureFromText_(text) {
  if (!text) return '';
  var m = String(text).match(/My Digital Signature:\s*([^\n\r]+)/);
  return m ? m[1].trim() : '';
}

/**
 * Ensure the Partner Check-ins sheet exists on the Main Ledger.
 * @param {Spreadsheet} ss
 * @return {Sheet}
 */
function ensurePartnerCheckInsSheet_(ss) {
  var sheet = ss.getSheetByName(PARTNER_CHECK_INS_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(PARTNER_CHECK_INS_SHEET);
  var headers = [
    'Submitted At',
    'Partner ID',
    'Contributor Name',
    'Check-in Date',
    'Method',
    'Stock Status',
    'Restock Needed',
    'Restock Quantity',
    'Next Check-in Date',
    'Notes',
    'Update ID',
    'Digital Signature',
    'Submitted By',
    'Restock SKU'
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

/**
 * Append one row to Partner Check-ins.
 * @param {Object} fields
 */
function appendPartnerCheckInRow_(fields) {
  var ss = SpreadsheetApp.openById(MAIN_LEDGER_SPREADSHEET_ID);
  var sheet = ensurePartnerCheckInsSheet_(ss);
  var now = new Date().toISOString();
  sheet.appendRow([
    now,
    fields.partner_id || '',
    fields.contributor_name || '',
    fields.check_in_date || '',
    fields.method || '',
    fields.stock_status || '',
    fields.restock_needed || '',
    fields.restock_quantity || '',
    fields.next_check_in_date || '',
    fields.notes || '',
    fields.update_id || '',
    fields.digital_signature || '',
    fields.submitted_by || '',
    fields.restock_sku || ''
  ]);
}

/**
 * HTTP / time-driven entry point.
 * Idempotent: dedup is keyed on `Update ID` (col K) of **Partner Check-ins**.
 * @return {{success:boolean, processed?:number, skipped?:number, errors?:number, error?:string}}
 */
function processPartnerCheckInsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processPartnerCheckInsFromTelegramChatLogs: another run is in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    var tcSpreadsheet = SpreadsheetApp.openById(TELEGRAM_CHAT_LOGS_SPREADSHEET_ID);
    var tcSheet = tcSpreadsheet.getSheetByName(TELEGRAM_CHAT_LOGS_SHEET);
    if (!tcSheet) {
      throw new Error('Telegram Chat Logs sheet "' + TELEGRAM_CHAT_LOGS_SHEET + '" not found');
    }

    var ledgerSpreadsheet = SpreadsheetApp.openById(MAIN_LEDGER_SPREADSHEET_ID);
    var checkInsSheet = ensurePartnerCheckInsSheet_(ledgerSpreadsheet);

    // Build dedup set from existing Partner Check-ins col K (zero-based 10).
    var checkInsValues = checkInsSheet.getDataRange().getValues();
    var seenUpdateIds = {};
    for (var r = 1; r < checkInsValues.length; r++) {
      var existingId = String(checkInsValues[r][10] || '').trim();
      if (existingId) seenUpdateIds[existingId] = true;
    }

    // Scan Telegram Chat Logs.
    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, processed: 0, skipped: 0, errors: 0 };
    }
    var startRow = Math.max(2, lastRow - PARTNER_CHECK_IN_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), TELEGRAM_CHAT_LOGS_MESSAGE_COL + 1);
    var tcRange = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var processed = 0;
    var skipped = 0;
    var errors = 0;

    for (var i = 0; i < tcRange.length; i++) {
      var message = String(tcRange[i][TELEGRAM_CHAT_LOGS_MESSAGE_COL] || '');
      if (message.indexOf('[PARTNER CHECK-IN EVENT]') === -1) continue;

      var fields = parsePartnerCheckInText_(message);
      var updateId = String(fields.update_id || '').trim();
      if (!updateId) {
        Logger.log('Skipping partner check-in at Telegram row ' + (startRow + i) + ': no Update ID.');
        skipped++;
        continue;
      }
      if (seenUpdateIds[updateId]) {
        skipped++;
        continue;
      }

      var partnerId = String(fields.partner_id || '').trim();
      if (!partnerId) {
        Logger.log('Partner check-in ' + updateId + ': missing partner_id; skipping.');
        skipped++;
        continue;
      }

      var digitalSignature = extractMyDigitalSignatureFromText_(message);
      var submittedBy = digitalSignature || String(fields.my_digital_signature || '').trim();

      try {
        appendPartnerCheckInRow_({
          partner_id: partnerId,
          contributor_name: String(fields.contributor_name || ''),
          check_in_date: String(fields.check_in_date || ''),
          method: String(fields.method || ''),
          stock_status: String(fields.stock_status || ''),
          restock_needed: String(fields.restock_needed || ''),
          restock_quantity: String(fields.restock_quantity || ''),
          next_check_in_date: String(fields.next_check_in_date || ''),
          notes: String(fields.notes || '').slice(0, 2000),
          update_id: updateId,
          digital_signature: submittedBy,
          submitted_by: submittedBy,
          restock_sku: String(fields.restock_sku || '')
        });

        seenUpdateIds[updateId] = true;
        processed++;
      } catch (rowErr) {
        errors++;
        Logger.log('Partner check-in ' + updateId + ' failed: ' + rowErr);
      }
    }

    Logger.log(
      'processPartnerCheckInsFromTelegramChatLogs: processed=' +
        processed +
        ' skipped=' +
        skipped +
        ' errors=' +
        errors +
        ' window=' +
        startRow +
        '-' +
        lastRow
    );
    return { success: true, processed: processed, skipped: skipped, errors: errors };
  } finally {
    lock.releaseLock();
  }
}
