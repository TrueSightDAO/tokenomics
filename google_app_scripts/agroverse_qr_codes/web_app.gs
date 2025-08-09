/**
 * Google Apps Script Web Service for Cacao Bag QR Code lookup.
 */

// ===== Configuration =====
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231';
var QR_CODE_SHEET_NAME = 'Agroverse QR codes';
var QR_CODE_PARAM = 'qr_code';
var EMAIL_ADDRESS_PARAM = 'email_address';
var LIST_PARAM = 'list';
var HEADER_ROW = 2;
var DATA_START_ROW = 2;
var DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec';
var DEPLOYMENT_EXAMPLE = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?qr_code=2025BF_20250521_PROPANE_1&email_address=something@garyteh.com';

/**
 * Handles GET requests to this web app.
 *
 * Expects either:
 * - 'qr_code' and 'email_address' query parameters for updating email.
 * - 'list=true' query parameter to return QR codes where column D = 'MINTED'.
 *
 * @param {Object} e Event object containing parameters.
 * @return {ContentService.TextOutput} JSON response with results or error.
 */
function doGet(e) {
  try {
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

    // Check if the request is for listing minted QR codes
    if (e.parameter[LIST_PARAM] === 'true') {
      var lastRow = sheet.getLastRow();
      if (lastRow < DATA_START_ROW) {
        return ContentService.createTextOutput(
          JSON.stringify({
            status: 'error',
            message: 'No data found in sheet starting from row ' + DATA_START_ROW
          })
        ).setMimeType(ContentService.MimeType.JSON);
      }

      // Get QR codes (column A) and status (column D)
      var dataRange = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 4).getValues();
      var mintedQrCodes = [];

      // Filter rows where column D (index 3) is 'MINTED'
      for (var i = 0; i < dataRange.length; i++) {
        if (dataRange[i][3] === 'MINTED') {
          mintedQrCodes.push(dataRange[i][0]); // QR code from column A
        }
      }

      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'success',
          qr_codes: mintedQrCodes
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // Existing logic for QR code and email update
    var qrCode = e.parameter[QR_CODE_PARAM];
    var emailAddress = e.parameter[EMAIL_ADDRESS_PARAM];

    if (!qrCode || !emailAddress) {
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'error',
          message: 'Missing required parameters: qr_code and email_address',
          example: DEPLOYMENT_EXAMPLE
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

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