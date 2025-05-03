/**
 * Google Apps Script Web Service for Cacao Bag QR Code lookup.
 */

// ===== Configuration =====
// Full URL of your Google Spreadsheet (e.g. https://docs.google.com/spreadsheets/d/.../edit)
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231';
// Name of the sheet/tab within the spreadsheet
var SHEET_NAME = 'Agroverse QR codes';
// Query parameter name for QR code lookups
var QR_CODE_PARAM = 'qr_code';
// Spreadsheet header row number (where column names appear)
var HEADER_ROW = 2;
// First data row number (where QR code values begin)
var DATA_START_ROW = 3;
// Deployed URL of this web app (replace {SCRIPT_ID} with actual ID)
var DEPLOYMENT_URL = 'https://script.google.com/macros/s/{SCRIPT_ID}/exec';
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
    var instructions = 'Send a GET request with the ' + QR_CODE_PARAM + ' query parameter.\n'
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
    var html = '<!DOCTYPE html><html><head>'
      + '<meta http-equiv="refresh" content="0;url=' + dest + '"/>'
      + '</head><body>Redirecting to <a href="' + dest + '">' + dest + '</a></body></html>';
    return HtmlService.createHtmlOutput(html)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // Otherwise return JSON result
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Looks up cacao bag details by QR code from a Google Sheet.
 *
 * @param {string} qrCode QR code string identifying the bag.
 * @return {Object} Details of the bag or an error object.
 */
function lookupBagByQRCode(qrCode) {
  // Open spreadsheet and select sheet
  var spreadsheet = SpreadsheetApp.openByUrl(SHEET_URL);
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return { error: 'Sheet "' + SHEET_NAME + '" not found' };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  // Read header row for column names
  var headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  // Read data rows starting at DATA_START_ROW
  var data = [];
  if (lastRow >= DATA_START_ROW) {
    data = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, lastCol).getValues();
  }
  // Locate QR code column index
  var idx = headers.indexOf(QR_CODE_PARAM);
  if (idx === -1) {
    return { error: 'Column "' + QR_CODE_PARAM + '" not found' };
  }
  // Iterate over data rows to find matching QR code
  for (var i = 0; i < data.length; i++) {
    if (data[i][idx] == qrCode) {
      var record = {};
      headers.forEach(function(header, j) {
        record[header] = data[i][j];
      });
      return record;
    }
  }
  return { error: QR_CODE_PARAM + ' not found' };
}