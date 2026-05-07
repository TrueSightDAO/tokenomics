/**
 * Asset receipt ingest — Apps Script web app (doGet).
 *
 * Processes [ASSET RECEIPT EVENT] rows from Telegram Chat Logs:
 * 1) Scan Telegram Chat Logs col G for unprocessed [ASSET RECEIPT EVENT] rows
 * 2) For each row, parse Currency, Amount, Description, Fund Handler from text
 * 3) Create a new Currencies row (col A = Currency name, col B = Price in USD / landed unit cost)
 * 4) Sort Currencies tab by col A ascending
 * 5) Create a positive inventory leg on offchain transactions
 *    - Currency = exact Currencies!A string
 *    - Amount = positive (units received)
 *    - Fund Handler = from event
 *    - Description = from event (with PDF/blob URL link)
 * 6) Mark Telegram Chat Log row as processed
 *
 * Triggered by Edgar's WebhookTriggerWorker with ?action=processAssetReceiptsFromTelegramChatLogs.
 * Deduplication via Telegram Chat Logs col A (update_id) — rows already processed are skipped.
 *
 * Script properties:
 * - AGROVERSE_INVENTORY_PUBLISH_SECRET (required — shared with repackaging)
 * - OFFCHAIN_TRANSACTIONS_PROCESSED_PREFIX (default: DEFAULT_OFFCHAIN_PROCESSED_PREFIX)
 * Optional overrides:
 * - ASSET_RECEIPT_OPS_SPREADSHEET_ID (default 1qbZZhf-…)
 * - ASSET_RECEIPT_MAIN_SPREADSHEET_ID (default 1GE7PUq-…)
 * - SHEET_TELEGRAM_CHAT_LOGS (default Telegram Chat Logs)
 * - SHEET_CURRENCIES (default Currencies)
 * - SHEET_OFFCHAIN_TRANSACTIONS (default offchain transactions)
 */

var SCRIPT_PROP_PUBLISH_SECRET = 'AGROVERSE_INVENTORY_PUBLISH_SECRET';

var SCRIPT_PROP_OPS_SS = 'ASSET_RECEIPT_OPS_SPREADSHEET_ID';
var SCRIPT_PROP_MAIN_SS = 'ASSET_RECEIPT_MAIN_SPREADSHEET_ID';
var SCRIPT_PROP_SHEET_LOGS = 'SHEET_TELEGRAM_CHAT_LOGS';
var SCRIPT_PROP_SHEET_CUR = 'SHEET_CURRENCIES';
var SCRIPT_PROP_SHEET_OFFCHAIN = 'SHEET_OFFCHAIN_TRANSACTIONS';

var DEFAULT_OPS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var DEFAULT_MAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var DEFAULT_SHEET_LOGS = 'Telegram Chat Logs';
var DEFAULT_SHEET_CUR = 'Currencies';
var DEFAULT_SHEET_OFFCHAIN = 'offchain transactions';

var PROCESSED_PREFIX = '[ASSET_RECEIPT_PROCESSED]';

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
  var sheetCurName = getProp_(SCRIPT_PROP_SHEET_CUR, DEFAULT_SHEET_CUR);
  var sheetOffchainName = getProp_(SCRIPT_PROP_SHEET_OFFCHAIN, DEFAULT_SHEET_OFFCHAIN);

  var opsSs = SpreadsheetApp.openById(opsSsId);
  var mainSs = SpreadsheetApp.openById(mainSsId);

  var logsSheet = opsSs.getSheetByName(sheetLogsName);
  if (!logsSheet) {
    return jsonResponse_({ status: 'error', error: 'Telegram Chat Logs sheet not found: ' + sheetLogsName });
  }

  var currenciesSheet = mainSs.getSheetByName(sheetCurName);
  if (!currenciesSheet) {
    return jsonResponse_({ status: 'error', error: 'Currencies sheet not found: ' + sheetCurName });
  }

  var offchainSheet = mainSs.getSheetByName(sheetOffchainName);
  if (!offchainSheet) {
    return jsonResponse_({ status: 'error', error: 'offchain transactions sheet not found: ' + sheetOffchainName });
  }

  var lastRow = logsSheet.getLastRow();
  if (lastRow < 2) {
    return jsonResponse_({ status: 'ok', message: 'No data rows in Telegram Chat Logs', processed: 0 });
  }

  // Read full sheet in one call
  var logData = logsSheet.getRange(1, 1, lastRow, logsSheet.getLastColumn()).getValues();
  var processed = 0;
  var errors = [];
  var currencyNamesAdded = [];

  // Column G is index 6 (0-indexed). Column A (update_id) is index 0.
  for (var i = 1; i < logData.length; i++) { // skip header
    var colA = String(logData[i][0] || ''); // update_id
    var colG = String(logData[i][6] || ''); // signed text

    // Skip already-processed rows
    if (colA.indexOf(PROCESSED_PREFIX) === 0) continue;

    // Only process [ASSET RECEIPT EVENT]
    if (colG.indexOf('[ASSET RECEIPT EVENT]') === -1) continue;

    try {
      var fields = parseAssetReceiptFields_(colG);

      if (!fields.currency || !fields.amount || !fields.fund_handler) {
        errors.push('Row ' + (i + 1) + ': Missing required fields (Currency, Amount, Fund Handler)');
        continue;
      }

      var amount = parseFloat(fields.amount);
      if (isNaN(amount) || amount <= 0) {
        errors.push('Row ' + (i + 1) + ': Invalid Amount: ' + fields.amount);
        continue;
      }

      // 1) Add Currencies row: col A = Currency name, col B = Price in USD
      var currencyName = fields.currency.trim();
      var existingCurrencyRow = findCurrencyRow_(currenciesSheet, currencyName);

      if (!existingCurrencyRow) {
        // Append new row
        var currenciesLastRow = currenciesSheet.getLastRow();
        var newCurRow = currenciesLastRow + 1;
        currenciesSheet.getRange(newCurRow, 1).setValue(currencyName);
        currenciesSheet.getRange(newCurRow, 2).setValue(amount); // col B = Price in USD
        currencyNamesAdded.push(currencyName);

        // 2) Sort Currencies by col A ascending (header in row 1, data rows 2..last)
        sortCurrencies_(currenciesSheet);
        existingCurrencyRow = findCurrencyRow_(currenciesSheet, currencyName);
        Logger.log('[AssetReceipt] Added Currencies row for: ' + currencyName + ' at USD ' + amount);
      } else {
        Logger.log('[AssetReceipt] Currency already exists: ' + currencyName + ' (row ' + existingCurrencyRow + ')');
      }

      // 3) Add positive inventory leg on offchain transactions
      var offchainLastRow = offchainSheet.getLastRow();
      var newOffchainRow = offchainLastRow + 1;

      // Date column (col A)
      var today = new Date();
      offchainSheet.getRange(newOffchainRow, 1).setValue(today);
      // Description column (col B) — include PDF URL link from event description
      offchainSheet.getRange(newOffchainRow, 2).setValue(fields.description || 'Asset receipt: ' + currencyName);
      // Fund Handler column (col C)
      offchainSheet.getRange(newOffchainRow, 3).setValue(fields.fund_handler);
      // Amount column (col D) — positive integer for inventory received
      offchainSheet.getRange(newOffchainRow, 4).setValue(1); // 1 unit received
      // Currency column (col E) — must match Currencies!A exactly
      offchainSheet.getRange(newOffchainRow, 5).setValue(currencyName);
      // Is Revenue column (col G) — blank or N for non-revenue
      offchainSheet.getRange(newOffchainRow, 7).setValue('N');

      Logger.log('[AssetReceipt] Added offchain transaction row ' + newOffchainRow + ' for: ' + currencyName);

      // 4) Mark Telegram Chat Log row as processed (prefix col A)
      logsSheet.getRange(i + 1, 1).setValue(PROCESSED_PREFIX + colA);
      processed++;

    } catch (err) {
      errors.push('Row ' + (i + 1) + ': ' + err.message);
      Logger.log('[AssetReceipt] Error processing row ' + (i + 1) + ': ' + err);
    }
  }

  return jsonResponse_({
    status: 'ok',
    processed: processed,
    currencies_added: currencyNamesAdded,
    errors: errors.length > 0 ? errors : undefined
  });
}

function parseAssetReceiptFields_(text) {
  var fields = {
    currency: null,
    amount: null,
    description: null,
    fund_handler: null
  };

  // Split before the signature block
  var body = text.split('--------')[0] || text;

  var lines = body.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.indexOf('[ASSET RECEIPT EVENT]') !== -1) continue;

    // Match "- Label: value" or "- Label: value" pattern
    var match = line.match(/^-\s*([A-Za-z][A-Za-z0-9_\s()\/-]*):\s*(.*)$/);
    if (!match) continue;

    var label = match[1].trim().toLowerCase();
    var value = match[2].trim();

    if (label === 'currency') {
      fields.currency = value;
    } else if (label === 'amount') {
      // Parse number — strip non-numeric except decimal
      var numMatch = value.match(/[\d.]+/);
      fields.amount = numMatch ? numMatch[0] : value;
    } else if (label === 'description') {
      // Preserve multi-line descriptions
      fields.description = value;
      // Check next lines for continuation (indented)
      while (i + 1 < lines.length && lines[i + 1].match(/^\s{2,}\S/)) {
        i++;
        fields.description += '\n' + lines[i].trim();
      }
    } else if (label === 'fund handler') {
      fields.fund_handler = value;
    }
  }

  return fields;
}

function findCurrencyRow_(currenciesSheet, currencyName) {
  var lastRow = currenciesSheet.getLastRow();
  if (lastRow < 2) return null;
  var colA = currenciesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim() === currencyName) {
      return i + 2; // 1-indexed row number
    }
  }
  return null;
}

function sortCurrencies_(currenciesSheet) {
  var lastRow = currenciesSheet.getLastRow();
  if (lastRow < 2) return;
  var lastCol = currenciesSheet.getLastColumn();
  // Sort data rows (2..last) by column A ascending
  var range = currenciesSheet.getRange(2, 1, lastRow - 1, lastCol);
  range.sort(1); // column 1 = A, ascending by default
  Logger.log('[AssetReceipt] Sorted Currencies A→Z (' + (lastRow - 1) + ' data rows)');
}
