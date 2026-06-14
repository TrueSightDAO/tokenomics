/**
 * File: google_app_scripts/find_nearby_stores/process_partner_add_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Description: Async scanner for `[PARTNER ADD EVENT]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   Edgar writes the signed payload into Telegram Chat Logs col G, then enqueues a
 *   webhook to this script (`?action=processPartnerAddsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose Partner Name + Email is not yet present in
 *   **DAO Partners** sheet on the Main Ledger, this scanner appends one row.
 *
 *   The append also serves as the dedup log for future runs (idempotent).
 *
 * Mirror canonicalization status:
 *   This file is canonical. Copy to the clasp mirror as `.js` before pushing.
 *   Also add a `?action=processPartnerAddsFromTelegramChatLogs` branch to
 *   the mirror's `doGet` (Code.js).
 *
 *   Sync command (run from `tokenomics/`):
 *     cp google_app_scripts/find_nearby_stores/process_partner_add_telegram_logs.gs \
 *        clasp_mirrors/<SCRIPT_ID>/process_partner_add_telegram_logs.js
 */

/** Telegram Chat Logs intake spreadsheet (Edgar writes col G of every signed event here). */
var TELEGRAM_CHAT_LOGS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var TELEGRAM_CHAT_LOGS_SHEET = 'Telegram Chat Logs';
/** Telegram Chat Logs col G (zero-based 6) — signed event text Edgar wrote. */
var TELEGRAM_CHAT_LOGS_MESSAGE_COL = 6;
/** Per-fire scan window. */
var PARTNER_ADD_SCAN_BATCH = 200;

/** Main Ledger spreadsheet where DAO Partners tab lives. */
var MAIN_LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var DAO_PARTNERS_SHEET = 'DAO Partners';

/**
 * Parse a `[PARTNER ADD EVENT]` body into a key→value map.
 * @param {string} text
 * @return {Object<string,string>}
 */
function parsePartnerAddText_(text) {
  var result = {};
  if (!text) return result;
  var body = String(text).split('--------', 1)[0] || String(text);
  var lines = body.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = (lines[i] || '').trim();
    if (!line) continue;
    if (line.indexOf('[PARTNER ADD EVENT]') === 0) continue;
    if (line.charAt(0) === '-') line = line.substring(1).trim();
    var m = line.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (!m) continue;
    var key = m[1].trim().toLowerCase().replace(/[\s\-]+/g, '_');
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
 * Ensure the DAO Partners sheet exists on the Main Ledger.
 * @param {Spreadsheet} ss
 * @return {Sheet}
 */
function ensureDAOPartnersSheet_(ss) {
  var sheet = ss.getSheetByName(DAO_PARTNERS_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(DAO_PARTNERS_SHEET);
  var headers = [
    'Partner Name',
    'Email',
    'Address',
    'Type',
    'Website',
    'About',
    'Status',
    'Governor Name',
    'Submitted At',
    'Digital Signature'
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

/**
 * Append one row to DAO Partners.
 * @param {Object} fields
 */
function appendPartnerAddRow_(fields) {
  var ss = SpreadsheetApp.openById(MAIN_LEDGER_SPREADSHEET_ID);
  var sheet = ensureDAOPartnersSheet_(ss);
  var now = new Date().toISOString();
  sheet.appendRow([
    fields.partner_name || '',
    fields.email || '',
    fields.address || '',
    fields.type || '',
    fields.website || '',
    fields.about || '',
    'active',
    fields.governor_name || '',
    now,
    fields.digital_signature || ''
  ]);
}

/**
 * HTTP / time-driven entry point.
 * Idempotent: dedup is keyed on Partner Name + Email of **DAO Partners**.
 * @return {{success:boolean, processed?:number, skipped?:number, errors?:number, error?:string}}
 */
function processPartnerAddsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processPartnerAddsFromTelegramChatLogs: another run is in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    var tcSpreadsheet = SpreadsheetApp.openById(TELEGRAM_CHAT_LOGS_SPREADSHEET_ID);
    var tcSheet = tcSpreadsheet.getSheetByName(TELEGRAM_CHAT_LOGS_SHEET);
    if (!tcSheet) {
      throw new Error('Telegram Chat Logs sheet "' + TELEGRAM_CHAT_LOGS_SHEET + '" not found');
    }

    var ledgerSpreadsheet = SpreadsheetApp.openById(MAIN_LEDGER_SPREADSHEET_ID);
    var partnersSheet = ensureDAOPartnersSheet_(ledgerSpreadsheet);

    // Build dedup set from existing DAO Partners rows.
    // Dedup key = partner_name|email (lowercased).
    var partnersValues = partnersSheet.getDataRange().getValues();
    var seenPartners = {};
    for (var r = 1; r < partnersValues.length; r++) {
      var existingName = String(partnersValues[r][0] || '').trim().toLowerCase();
      var existingEmail = String(partnersValues[r][1] || '').trim().toLowerCase();
      if (existingName && existingEmail) {
        seenPartners[existingName + '|' + existingEmail] = true;
      }
    }

    // Scan Telegram Chat Logs.
    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, processed: 0, skipped: 0, errors: 0 };
    }
    var startRow = Math.max(2, lastRow - PARTNER_ADD_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), TELEGRAM_CHAT_LOGS_MESSAGE_COL + 1);
    var tcRange = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var processed = 0;
    var skipped = 0;
    var errors = 0;

    for (var i = 0; i < tcRange.length; i++) {
      var message = String(tcRange[i][TELEGRAM_CHAT_LOGS_MESSAGE_COL] || '');
      if (message.indexOf('[PARTNER ADD EVENT]') === -1) continue;

      var fields = parsePartnerAddText_(message);
      var partnerName = String(fields.partner_name || '').trim();
      var email = String(fields.email || '').trim();

      if (!partnerName || !email) {
        Logger.log('Skipping partner add at Telegram row ' + (startRow + i) + ': missing Partner Name or Email.');
        skipped++;
        continue;
      }

      var dedupKey = partnerName.toLowerCase() + '|' + email.toLowerCase();
      if (seenPartners[dedupKey]) {
        skipped++;
        continue;
      }

      var digitalSignature = extractMyDigitalSignatureFromText_(message);
      fields.digital_signature = digitalSignature;

      appendPartnerAddRow_(fields);
      seenPartners[dedupKey] = true;  // prevent duplicate within same batch
      processed++;
    }

    return { success: true, processed: processed, skipped: skipped, errors: errors };
  } catch (e) {
    Logger.log('processPartnerAddsFromTelegramChatLogs error: ' + e.message);
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}
