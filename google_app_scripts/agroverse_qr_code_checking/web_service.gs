/**
 * Google Apps Script Web Service for Cacao Bag QR Code lookup.
 */

// ===== Configuration =====
// Full URL of your Google Spreadsheet (e.g. https://docs.google.com/spreadsheets/d/.../edit)
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231';
// Name of the sheet/tab within the spreadsheet
var QR_CODE_SHEET_NAME = 'Agroverse QR codes';
// Query parameter name for QR code lookups
var QR_CODE_PARAM = 'qr_code';
// Spreadsheet header row number (where column names appear)
var HEADER_ROW = 2;
// First data row number (where QR code values begin)
var DATA_START_ROW = 2;
// Deployed URL of this web app (replace {SCRIPT_ID} with actual ID)
var DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec';
// Example URL for usage instructions
var DEPLOYMENT_EXAMPLE = DEPLOYMENT_URL + '?' + QR_CODE_PARAM + '=ABC123';

/**
 * Handles GET requests to this web app.
 *
 * Expects a 'qr_code' query parameter.
 *
 * @param {Object} e Event object containing parameters.
 * @return {ContentService.TextOutput|HtmlService.HtmlOutput} JSON response or HTML-based redirect.
 */
function doGet(e) {
  var qrCode = e.parameter[QR_CODE_PARAM];
  if (!qrCode) {
    // Return usage instructions if missing parameter
    var instructions = 'Send a GET request with the ' + QR_CODE_PARAM + ' query parameter or something.\n'
      + 'Example: ' + DEPLOYMENT_EXAMPLE;
    return ContentService.createTextOutput(JSON.stringify({
      error: 'Missing ' + QR_CODE_PARAM + ' parameter',
      instructions: instructions
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  var result = lookupBagByQRCode(qrCode);
  // If client explicitly requests JSON format, always return JSON data
  var fmt = e.parameter.format;
  if (fmt && fmt.toLowerCase() === 'json') {
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // If record has a landing page, perform an HTML redirect
  if (!result.error && result.landing_page) {
    var dest = result.landing_page;
    // Build query string: include qr_code and optional status
    var params = [];
    params.push(QR_CODE_PARAM + '=' + encodeURIComponent(qrCode));
    if (result.status) {
      params.push('status=' + encodeURIComponent(result.status));
    }
    dest += (dest.indexOf('?') > -1 ? '&' : '?') + params.join('&');
    // Browser-level redirect via JavaScript instead of meta-refresh
    var html = '<!DOCTYPE html><html><head>'
      + '<script>window.location.replace("' + dest + '");</script>'
      + '</head><body>Redirecting to <a href="' + dest + '">' + dest + '</a></body></html>';
    return HtmlService.createHtmlOutput(html)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // Otherwise return JSON result
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test helper for manual script execution.
 * Replace 'TEST_QR_CODE' with a real code, then run via the Apps Script editor.
 */
function testGetRecord() {
  var code = 'TEST_QR_CODE';
  var result = getRecordByQRCode(code);
  Logger.log(JSON.stringify(result));
}

/**
 * Returns the full record for a given QR code from the sheet as an object.
 *
 * @param {string} qrCode The QR code to look up.
 * @return {Object} Record object mapping column names to values, or error object.
 */
function getRecordByQRCode(qrCode) {
  var spreadsheet = SpreadsheetApp.openByUrl(SHEET_URL);
  var sheet = spreadsheet.getSheetByName(QR_CODE_SHEET_NAME);
  if (!sheet) {
    return { error: 'Sheet "' + QR_CODE_SHEET_NAME + '" not found for QR code ' + qrCode, qr_code: qrCode };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  // Determine header row (use frozen rows if set, else HEADER_ROW)
  var headerRow = sheet.getFrozenRows() > 0 ? sheet.getFrozenRows() : HEADER_ROW;
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  Logger.log(headers);
  // Read data rows starting at DATA_START_ROW
  var dataCount = lastRow - DATA_START_ROW + 1;
  Logger.log(DATA_START_ROW);
  Logger.log(dataCount);
  if (dataCount < 1) {
    return { error: 'No data rows starting at ' + DATA_START_ROW, qr_code: qrCode };
  }
  var data = sheet.getRange(DATA_START_ROW, 1, dataCount, lastCol).getValues();
  // Assuming QR code is in the first column
  var idx = 0;
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    // Uncomment next line to debug each row
    // Logger.log('Row ' + (DATA_START_ROW + i) + ': ' + JSON.stringify(row));
    if (row[idx] == qrCode) {
      var record = { qr_code: qrCode };
      for (var j = 0; j < headers.length; j++) {
        record[headers[j]] = row[j];
      }
      return record;
    }
  }
  return { error: 'QR code ' + qrCode + ' not found', qr_code: qrCode };
}

/**
 * Looks up cacao bag details by QR code from a Google Sheet.
 *
 * @param {string} qrCode QR code string identifying the bag.
 * @return {Object} Details of the bag or an error object.
 */
/**
 * Wrapper that retrieves the record by QR code.
 * @param {string} qrCode
 * @return {Object} See getRecordByQRCode
 */
function lookupBagByQRCode(qrCode) {
  return getRecordByQRCode(qrCode);
}