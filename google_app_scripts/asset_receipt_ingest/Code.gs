/**
 * Asset receipt ingest — Apps Script web app (doGet).
 *
 * Processes [ASSET RECEIPT EVENT] rows from Telegram Chat Logs:
 * 1) Scan Telegram Chat Logs col G for unprocessed [ASSET RECEIPT EVENT] rows
 * 2) Dedup against "Asset Receipts" tab on ops spreadsheet (update_id = key)
 * 3) Parse Currency, Amount, Description, Fund Handler from text
 * 4) Create a new Currencies row (col A = Currency name, col B = Price in USD)
 * 5) Sort Currencies tab by col A ascending
 * 6) Create a positive inventory leg on offchain transactions
 * 7) Append audit row to "Asset Receipts" tab (dedup log)
 *
 * Triggered by Edgar's WebhookTriggerWorker with ?action=processAssetReceiptsFromTelegramChatLogs.
 *
 * Script properties:
 * - AGROVERSE_INVENTORY_PUBLISH_SECRET (required — shared with repackaging)
 * Optional overrides:
 * - ASSET_RECEIPT_OPS_SPREADSHEET_ID (default 1qbZZhf-…)
 * - ASSET_RECEIPT_MAIN_SPREADSHEET_ID (default 1GE7PUq-…)
 * - SHEET_TELEGRAM_CHAT_LOGS (default Telegram Chat Logs)
 * - SHEET_ASSET_RECEIPTS (default Asset Receipts)
 * - SHEET_CURRENCIES (default Currencies)
 * - SHEET_OFFCHAIN_TRANSACTIONS (default offchain transactions)
 */

var SCRIPT_PROP_PUBLISH_SECRET = 'AGROVERSE_INVENTORY_PUBLISH_SECRET';

var SCRIPT_PROP_OPS_SS = 'ASSET_RECEIPT_OPS_SPREADSHEET_ID';
var SCRIPT_PROP_MAIN_SS = 'ASSET_RECEIPT_MAIN_SPREADSHEET_ID';
var SCRIPT_PROP_SHEET_LOGS = 'SHEET_TELEGRAM_CHAT_LOGS';
var SCRIPT_PROP_SHEET_AUDIT = 'SHEET_ASSET_RECEIPTS';
var SCRIPT_PROP_SHEET_CUR = 'SHEET_CURRENCIES';
var SCRIPT_PROP_SHEET_OFFCHAIN = 'SHEET_OFFCHAIN_TRANSACTIONS';

var DEFAULT_OPS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var DEFAULT_MAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var DEFAULT_SHEET_LOGS = 'Telegram Chat Logs';
var DEFAULT_SHEET_AUDIT = 'Asset Receipts';
var DEFAULT_SHEET_CUR = 'Currencies';
var DEFAULT_SHEET_OFFCHAIN = 'offchain transactions';

function getProp_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v && String(v).trim()) ? String(v).trim() : fallback;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e && e.parameter ? String(e.parameter.action || '') : '').trim();
  if (action === 'processAssetReceiptsFromTelegramChatLogs') {
    return processAssetReceiptsFromTelegramChatLogs_();
  }
  return jsonResponse_({
    ok: true,
    service: 'asset-receipt-ingest',
    message: 'Use ?action=processAssetReceiptsFromTelegramChatLogs to process [ASSET RECEIPT EVENT] rows.'
  });
}

function doPost(e) {
  return doGet(e);
}

function processAssetReceiptsFromTelegramChatLogs_() {
  var opsSsId = getProp_(SCRIPT_PROP_OPS_SS, DEFAULT_OPS_SPREADSHEET_ID);
  var mainSsId = getProp_(SCRIPT_PROP_MAIN_SS, DEFAULT_MAIN_SPREADSHEET_ID);
  var sheetLogsName = getProp_(SCRIPT_PROP_SHEET_LOGS, DEFAULT_SHEET_LOGS);
  var sheetAuditName = getProp_(SCRIPT_PROP_SHEET_AUDIT, DEFAULT_SHEET_AUDIT);
  var sheetCurName = getProp_(SCRIPT_PROP_SHEET_CUR, DEFAULT_SHEET_CUR);
  var sheetOffchainName = getProp_(SCRIPT_PROP_SHEET_OFFCHAIN, DEFAULT_SHEET_OFFCHAIN);

  var opsSs = SpreadsheetApp.openById(opsSsId);
  var mainSs = SpreadsheetApp.openById(mainSsId);

  var logsSheet = opsSs.getSheetByName(sheetLogsName);
  if (!logsSheet) {
    return jsonResponse_({ status: 'error', error: 'Sheet not found: ' + sheetLogsName });
  }

  var auditSheet = opsSs.getSheetByName(sheetAuditName);
  if (!auditSheet) {
    // Auto-create the audit tab on first run
    auditSheet = opsSs.insertSheet(sheetAuditName);
    auditSheet.appendRow(['Telegram Update ID', 'Processed At (ISO)', 'Currency Name', 'Amount', 'Fund Handler', 'Offchain Row', 'Status']);
    Logger.log('[AssetReceipt] Created audit tab: ' + sheetAuditName);
  }

  var currenciesSheet = mainSs.getSheetByName(sheetCurName);
  if (!currenciesSheet) {
    return jsonResponse_({ status: 'error', error: 'Sheet not found: ' + sheetCurName });
  }

  var offchainSheet = mainSs.getSheetByName(sheetOffchainName);
  if (!offchainSheet) {
    return jsonResponse_({ status: 'error', error: 'Sheet not found: ' + sheetOffchainName });
  }

  // Load known update_ids from audit tab for dedup
  var knownIds = loadKnownIds_(auditSheet);

  var lastRow = logsSheet.getLastRow();
  if (lastRow < 2) {
    return jsonResponse_({ status: 'ok', message: 'No data rows in Telegram Chat Logs', processed: 0 });
  }

  var logData = logsSheet.getRange(1, 1, lastRow, logsSheet.getLastColumn()).getValues();
  var processed = 0;
  var errors = [];
  var currencyNamesAdded = [];

  for (var i = 1; i < logData.length; i++) { // skip header
    var updateId = String(logData[i][0] || '').trim(); // col A = update_id
    var colG = String(logData[i][6] || ''); // col G = signed text

    if (!updateId) continue;

    // Dedup: skip if already in audit tab
    if (knownIds[updateId]) continue;

    // Only process [ASSET RECEIPT EVENT]
    if (colG.indexOf('[ASSET RECEIPT EVENT]') === -1) continue;

    try {
      var fields = parseAssetReceiptFields_(colG);

      if (!fields.currency || !fields.amount || !fields.fund_handler) {
        errors.push('Row ' + (i + 1) + ' (update_id=' + updateId + '): Missing required fields (Currency, Amount, Fund Handler)');
        // Still log to audit to prevent re-processing
        auditSheet.appendRow([updateId, new Date().toISOString(), fields.currency || '', fields.amount || '', fields.fund_handler || '', '', 'SKIPPED: missing fields']);
        knownIds[updateId] = true;
        continue;
      }

      var amount = parseFloat(fields.amount);
      if (isNaN(amount) || amount <= 0) {
        errors.push('Row ' + (i + 1) + ' (update_id=' + updateId + '): Invalid Amount: ' + fields.amount);
        auditSheet.appendRow([updateId, new Date().toISOString(), fields.currency, fields.amount, fields.fund_handler, '', 'SKIPPED: invalid amount']);
        knownIds[updateId] = true;
        continue;
      }

      var currencyName = fields.currency.trim();

      // 1) Add Currencies row if not already present
      if (!findCurrencyRow_(currenciesSheet, currencyName)) {
        var currenciesLastRow = currenciesSheet.getLastRow();
        currenciesSheet.getRange(currenciesLastRow + 1, 1).setValue(currencyName);
        currenciesSheet.getRange(currenciesLastRow + 1, 2).setValue(amount); // col B = Price in USD
        currencyNamesAdded.push(currencyName);
        sortCurrencies_(currenciesSheet);
        Logger.log('[AssetReceipt] Added Currencies row: ' + currencyName + ' at USD ' + amount);
      }

      // 2) Add positive inventory leg on offchain transactions
      var offchainLastRow = offchainSheet.getLastRow();
      var newOffchainRow = offchainLastRow + 1;

      offchainSheet.getRange(newOffchainRow, 1).setValue(new Date());          // A: Date
      offchainSheet.getRange(newOffchainRow, 2).setValue(fields.description || 'Asset receipt: ' + currencyName); // B: Description
      offchainSheet.getRange(newOffchainRow, 3).setValue(fields.fund_handler); // C: Fund Handler
      offchainSheet.getRange(newOffchainRow, 4).setValue(1);                    // D: Amount (1 unit)
      offchainSheet.getRange(newOffchainRow, 5).setValue(currencyName);         // E: Currency
      offchainSheet.getRange(newOffchainRow, 7).setValue('N');                  // G: Is Revenue = N

      Logger.log('[AssetReceipt] Added offchain row ' + newOffchainRow + ': ' + currencyName + ' under ' + fields.fund_handler);

      // 3) Log to audit tab (dedup + audit trail)
      auditSheet.appendRow([updateId, new Date().toISOString(), currencyName, amount, fields.fund_handler, newOffchainRow, 'OK']);
      knownIds[updateId] = true;
      processed++;

    } catch (err) {
      errors.push('Row ' + (i + 1) + ' (update_id=' + updateId + '): ' + err.message);
      auditSheet.appendRow([updateId, new Date().toISOString(), fields.currency || '', fields.amount || '', fields.fund_handler || '', '', 'ERROR: ' + err.message]);
      knownIds[updateId] = true;
    }
  }

  return jsonResponse_({
    status: 'ok',
    processed: processed,
    currencies_added: currencyNamesAdded,
    errors: errors.length > 0 ? errors : undefined
  });
}

/**
 * Load known update_ids from the audit tab into a lookup object.
 * Column A = update_id. Only "OK" status rows block re-processing.
 */
function loadKnownIds_(auditSheet) {
  var lastRow = auditSheet.getLastRow();
  var ids = {};
  if (lastRow < 2) return ids;
  // Read col A (update_id) and col G (status)
  var data = auditSheet.getRange(1, 1, lastRow, 7).getValues();
  for (var i = 1; i < data.length; i++) {
    var uid = String(data[i][0] || '').trim();
    if (uid) ids[uid] = true;
  }
  return ids;
}

function parseAssetReceiptFields_(text) {
  var fields = { currency: null, amount: null, description: null, fund_handler: null };
  var body = text.split('--------')[0] || text;
  var lines = body.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.indexOf('[ASSET RECEIPT EVENT]') !== -1) continue;

    var match = line.match(/^-\s*([A-Za-z][A-Za-z0-9_\s()\/-]*):\s*(.*)$/);
    if (!match) continue;

    var label = match[1].trim().toLowerCase();
    var value = match[2].trim();

    switch (label) {
      case 'currency':
        fields.currency = value;
        break;
      case 'amount':
        fields.amount = (value.match(/[\d.]+/) || [value])[0];
        break;
      case 'description':
        fields.description = value;
        while (i + 1 < lines.length && lines[i + 1].match(/^\s{2,}\S/)) {
          i++;
          fields.description += '\n' + lines[i].trim();
        }
        break;
      case 'fund handler':
        fields.fund_handler = value;
        break;
    }
  }
  return fields;
}

function findCurrencyRow_(currenciesSheet, currencyName) {
  var lastRow = currenciesSheet.getLastRow();
  if (lastRow < 2) return null;
  var colA = currenciesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim() === currencyName) return i + 2;
  }
  return null;
}

function sortCurrencies_(currenciesSheet) {
  var lastRow = currenciesSheet.getLastRow();
  if (lastRow < 2) return;
  var lastCol = currenciesSheet.getLastColumn();
  currenciesSheet.getRange(2, 1, lastRow - 1, lastCol).sort(1);
}
