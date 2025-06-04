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
// Query parameter name for Email lookup
var EMAIL_ADDRESS_PARAM = 'email_address';
// Spreadsheet header row number (where column names appear)
var HEADER_ROW = 2;
// First data row number (where QR code values begin)
var DATA_START_ROW = 2;
// Deployed URL of this web app (replace {SCRIPT_ID} with actual ID)
var DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec';
// Example URL for usage instructions
var DEPLOYMENT_EXAMPLE = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?qr_code=2025BF_20250521_PROPANE_1&email_address=something@garyteh.com';

/**
 * Handles GET requests to this web app.
 *
 * Expects a 'qr_code' and 'email_address' query parameter.
 *
 * @param {Object} e Event object containing parameters.
 * @return {ContentService.TextOutput|HtmlService.HtmlOutput} JSON response or HTML-based redirect.
 */
function doGet(e) {
  try {
    // Validate query parameters
    var qrCode = e.parameter[QR_CODE_PARAM];
    var emailAddress = e.parameter[EMAIL_ADDRESS_PARAM];

    if (!qrCode || !emailAddress) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'Missing required parameters: qr_code and email_address',
          example: DEPLOYMENT_EXAMPLE + '&' + EMAIL_ADDRESS_PARAM + '=user@example.com'
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Open the spreadsheet and sheet
    var spreadsheet = SpreadsheetApp.openByUrl(SHEET_URL);
    var sheet = spreadsheet.getSheetByName(QR_CODE_SHEET_NAME);
    if (!sheet) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'Sheet not found: ' + QR_CODE_SHEET_NAME
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Get all data in Column A (QR codes) starting from DATA_START_ROW
    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START_ROW) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'No data found in sheet starting from row ' + DATA_START_ROW
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var qrCodeColumn = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
    var rowIndex = -1;

    // Search for the QR code in Column A
    for (var i = 0; i < qrCodeColumn.length; i++) {
      if (qrCodeColumn[i][0] === qrCode) {
        rowIndex = i + DATA_START_ROW; // Convert to spreadsheet row number
        break;
      }
    }

    if (rowIndex === -1) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'QR code not found: ' + qrCode
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Update email address in Column L (12th column) of the matching row
    sheet.getRange(rowIndex, 12).setValue(emailAddress);
    SpreadsheetApp.flush(); // Ensure the write is committed

    // Return success response
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'success',
        message: 'Email address updated for QR code: ' + qrCode,
        email: emailAddress,
        row: rowIndex
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: 'error',
        message: 'Error processing request: ' + error.message
      })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}