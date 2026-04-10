/**
 * File: google_app_scripts/agroverse_qr_codes/web_app.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: REST API endpoints for inventory management, QR code queries, voting rights, and asset valuation. Provides data access for the TrueSight DAO DApp.
 */

/**
 * Google Apps Script Web Service for Cacao Bag QR Code lookup.
 * Deployment URL: https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec
 */

// ===== Configuration =====
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231';
var QR_CODE_SHEET_NAME = 'Agroverse QR codes';
var STRIPE_CHECKOUT_SHEET_NAME = 'Stripe Social Media Checkout ID';
/** Stripe checkout: Session ID column C, Tracking Number column N, Agroverse QR code column P */
var QR_CODE_PARAM = 'qr_code';
var EMAIL_ADDRESS_PARAM = 'email_address';
var LIST_PARAM = 'list';
var LIST_ALL_PARAM = 'list_all';
var LIST_WITH_MEMBERS_PARAM = 'list_with_members';
var LOOKUP_PARAM = 'lookup';
/** GET list_unassigned_stripe_sessions=true — Stripe Session IDs (column C) where P is blank; optional for_qr_code also includes rows where P equals that QR */
var LIST_UNASSIGNED_STRIPE_SESSIONS_PARAM = 'list_unassigned_stripe_sessions';
var FOR_QR_CODE_PARAM = 'for_qr_code';
var HEADER_ROW = 2;
var DATA_START_ROW = 2;
var DEPLOYMENT_URL = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec';
var DEPLOYMENT_EXAMPLE = 'https://script.google.com/macros/s/AKfycbxigq4-J0izShubqIC5k6Z7fgNRyVJLakfQ34HPuENiSpxuCG-wSq0g-wOAedZzzgaL/exec?qr_code=2025BF_20250521_PROPANE_1&email_address=something@garyteh.com';

/**
 * Helper function to create a JSON response.
 * Note: CORS headers are automatically handled by Google Apps Script when deployed as a web app.
 * @param {Object} data - The data object to return as JSON.
 * @return {ContentService.TextOutput} JSON response.
 */
function createCORSResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Web app query helpers — GAS may pass boolean true or string variants */
function isTruthyQueryParam_(raw) {
  if (raw === true) return true;
  if (raw == null || raw === '') return false;
  if (Object.prototype.toString.call(raw) === '[object Array]') {
    raw = raw.length ? raw[0] : '';
  }
  var s = String(raw).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

function getQueryParam_(e, key) {
  if (!e) return '';
  if (e.parameter && e.parameter[key] !== undefined && e.parameter[key] !== null && e.parameter[key] !== '') {
    return e.parameter[key];
  }
  if (e.parameters && e.parameters[key]) {
    var arr = e.parameters[key];
    return Object.prototype.toString.call(arr) === '[object Array]' ? arr[0] : arr;
  }
  return '';
}

/**
 * Handles OPTIONS requests (CORS preflight).
 * Note: CORS headers are automatically handled by Google Apps Script when deployed as a web app.
 * @param {Object} e Event object.
 * @return {ContentService.TextOutput} Empty response.
 */
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Handles GET requests to this web app.
 *
 * Expects either:
 * - 'qr_code' and 'email_address' query parameters for updating email.
 * - 'list=true' query parameter to return QR codes where column D is NOT 'SOLD' (includes MINTED, CONSIGNMENT, etc.).
 * - 'list_all=true' query parameter to return ALL QR codes including SOLD status.
 * - 'list_with_members=true' query parameter to return QR codes with details where column D is NOT 'SOLD'.
 * - 'lookup=true&qr_code=...' returns ledger details plus stripe_session_id and tracking_number when a row
 *   in 'Stripe Social Media Checkout ID' has column P equal to the QR code (Session in C, Shipping M, Tracking N; newest row wins).
 * - 'list_unassigned_stripe_sessions=true' returns { items: [{ stripe_session_id }] } for rows with Session in C
 *   and column P blank; optional 'for_qr_code' also returns sessions already linked to that QR in P (for DApp prefill).
 *
 * @param {Object} e Event object containing parameters.
 * @return {ContentService.TextOutput} JSON response with results or error.
 */
function doGet(e) {
  try {
    // Open the spreadsheet (several endpoints use multiple tabs)
    var spreadsheet = SpreadsheetApp.openByUrl(SHEET_URL);

    if (isTruthyQueryParam_(getQueryParam_(e, LIST_UNASSIGNED_STRIPE_SESSIONS_PARAM))) {
      var forQr = getQueryParam_(e, FOR_QR_CODE_PARAM);
      return listUnassignedStripeSessions_(spreadsheet, forQr);
    }

    var sheet = spreadsheet.getSheetByName(QR_CODE_SHEET_NAME);
    if (!sheet) {
      return createCORSResponse({
        status: 'error',
        message: 'Sheet not found: ' + QR_CODE_SHEET_NAME
      });
    }

    // Check if the request is for listing all QR codes (including SOLD)
    if (e.parameter[LIST_ALL_PARAM] === 'true') {
      var lastRow = sheet.getLastRow();
      if (lastRow < DATA_START_ROW) {
        return createCORSResponse({
          status: 'error',
          message: 'No data found in sheet starting from row ' + DATA_START_ROW
        });
      }

      // Get QR codes (column A) - include ALL statuses including SOLD
      var dataRange = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
      var allQrCodes = [];

      for (var i = 0; i < dataRange.length; i++) {
        if (dataRange[i][0]) {
          allQrCodes.push(dataRange[i][0]); // QR code from column A
        }
      }

      return createCORSResponse({
        status: 'success',
        qr_codes: allQrCodes
      });
    }

    // Check if the request is for listing QR codes (excluding SOLD)
    if (e.parameter[LIST_PARAM] === 'true') {
      var lastRow = sheet.getLastRow();
      if (lastRow < DATA_START_ROW) {
        return createCORSResponse({
          status: 'error',
          message: 'No data found in sheet starting from row ' + DATA_START_ROW
        });
      }

      // Get QR codes (column A) and status (column D)
      var dataRange = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 4).getValues();
      var availableQrCodes = [];

      // Filter rows where column D (index 3) is NOT 'SOLD' (include MINTED, CONSIGNMENT, and all other statuses)
      for (var i = 0; i < dataRange.length; i++) {
        var status = (dataRange[i][3] || '').toString().toUpperCase().trim();
        if (status !== 'SOLD') {
          availableQrCodes.push(dataRange[i][0]); // QR code from column A
        }
      }

      return createCORSResponse({
        status: 'success',
        qr_codes: availableQrCodes
      });
    }

    // Check if the request is for listing QR codes with member names (excluding SOLD)
    if (e.parameter[LIST_WITH_MEMBERS_PARAM] === 'true') {
      var lastRow = sheet.getLastRow();
      if (lastRow < DATA_START_ROW) {
        return createCORSResponse({
          status: 'error',
          message: 'No data found in sheet starting from row ' + DATA_START_ROW
        });
      }

      // Get QR codes (column A), status (column D), ledger (column C, index 2), currency (column I, index 8), and manager names (column U, index 20)
      var dataRange = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 21).getValues();
      var availableQrCodesWithMembers = [];

      // Filter rows where column D (index 3) is NOT 'SOLD' (include MINTED, CONSIGNMENT, and all other statuses)
      for (var i = 0; i < dataRange.length; i++) {
        var status = (dataRange[i][3] || '').toString().toUpperCase().trim();
        if (status !== 'SOLD') {
          var qrCode = dataRange[i][0]; // Column A
          var ledgerShortcut = dataRange[i][2] || ''; // Column C (index 2)
          var currency = dataRange[i][8] || ''; // Column I (index 8)
          var managerName = dataRange[i][20] || ''; // Column U (index 20)
          
          availableQrCodesWithMembers.push({
            qr_code: qrCode,
            status: status, // Include status in response for frontend filtering
            currency: currency,
            ledger_shortcut: ledgerShortcut,
            contributor_name: managerName
          });
        }
      }

      return createCORSResponse({
        status: 'success',
        items: availableQrCodesWithMembers
      });
    }

    // Check if the request is for looking up QR code details (currency, ledger, manager)
    if (e.parameter[LOOKUP_PARAM] === 'true') {
      var qrCode = e.parameter[QR_CODE_PARAM];
      if (!qrCode) {
        return createCORSResponse({
          status: 'error',
          message: 'Missing required parameter: qr_code'
        });
      }

      var lastRow = sheet.getLastRow();
      if (lastRow < DATA_START_ROW) {
        return createCORSResponse({
          status: 'error',
          message: 'No data found in sheet starting from row ' + DATA_START_ROW
        });
      }

      // Get QR codes (column A), ledger (column C, index 2), currency (column I, index 8), status (column D, index 3), email (column L, index 11), and manager (column U, index 20)
      var dataRange = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 21).getValues();
      
      // Search for the QR code
      for (var i = 0; i < dataRange.length; i++) {
        if (dataRange[i][0] === qrCode) {
          var currency = dataRange[i][8] || ''; // Column I (index 8)
          var ledgerShortcut = dataRange[i][2] || ''; // Column C (index 2)
          var status = dataRange[i][3] || ''; // Column D (index 3)
          var email = dataRange[i][11] || ''; // Column L (index 11)
          var managerName = dataRange[i][20] || ''; // Column U (index 20)
          var stripeInfo = lookupStripeCheckoutByQrCode_(spreadsheet, qrCode);

          return createCORSResponse({
            status: 'success',
            qr_code: qrCode,
            currency: currency,
            ledger_shortcut: ledgerShortcut,
            qr_status: status,
            email: email,
            manager_name: managerName,
            stripe_session_id: stripeInfo.stripe_session_id,
            shipping_provider: stripeInfo.shipping_provider,
            tracking_number: stripeInfo.tracking_number
          });
        }
      }

      return createCORSResponse({
        status: 'error',
        message: 'QR code not found: ' + qrCode
      });
    }

    // Existing logic for QR code and email update
    var qrCode = e.parameter[QR_CODE_PARAM];
    var emailAddress = e.parameter[EMAIL_ADDRESS_PARAM];

    if (!qrCode || !emailAddress) {
      return createCORSResponse({
        status: 'error',
        message: 'Missing required parameters: qr_code and email_address',
        example: DEPLOYMENT_EXAMPLE
      });
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < DATA_START_ROW) {
      return createCORSResponse({
        status: 'error',
        message: 'No data found in sheet starting from row ' + DATA_START_ROW
      });
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
      return createCORSResponse({
        status: 'error',
        message: 'QR code not found: ' + qrCode
      });
    }

    // Update email address in Column L (12th column) of the matching row
    sheet.getRange(rowIndex, 12).setValue(emailAddress);
    SpreadsheetApp.flush(); // Ensure the write is committed

    // Return success response
    return createCORSResponse({
      status: 'success',
      message: 'Email address updated for QR code: ' + qrCode,
      email: emailAddress,
      row: rowIndex
    });

  } catch (error) {
    return createCORSResponse({
      status: 'error',
      message: 'Error processing request: ' + error.message
    });
  }
}

/**
 * Finds Stripe checkout row where column P matches the Agroverse QR code.
 * Returns Session ID (column C) and Tracking Number (column N). If multiple rows match, the bottom-most row wins.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} qrCode
 * @return {{stripe_session_id: string, tracking_number: string, shipping_provider: string}}
 */
/**
 * Stripe sessions where column P is unassigned, optionally including rows already tied to forQrCode (column P match).
 * Iterates from bottom so newer sheet rows appear first; dedupes by session id.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string=} forQrCodeRaw
 * @return {ContentService.TextOutput}
 */
function listUnassignedStripeSessions_(spreadsheet, forQrCodeRaw) {
  var stripeSheet = spreadsheet.getSheetByName(STRIPE_CHECKOUT_SHEET_NAME);
  if (!stripeSheet) {
    return createCORSResponse({
      status: 'error',
      message: 'Sheet not found: ' + STRIPE_CHECKOUT_SHEET_NAME
    });
  }

  var lastRow = stripeSheet.getLastRow();
  if (lastRow < DATA_START_ROW) {
    return createCORSResponse({ status: 'success', items: [] });
  }

  var wantQr = (forQrCodeRaw || '').toString().trim();
  var range = stripeSheet.getRange(DATA_START_ROW, 3, lastRow, 16).getValues();
  var seen = {};
  var items = [];

  for (var r = range.length - 1; r >= 0; r--) {
    var session = (range[r][0] || '').toString().trim();
    if (!session) continue;

    var pVal = (range[r][13] || '').toString().trim();
    var pEmpty = !pVal;
    var pMatches = wantQr !== '' && pVal === wantQr;

    if (!pEmpty && !pMatches) continue;
    if (seen[session]) continue;

    seen[session] = true;
    items.push({ stripe_session_id: session });
  }

  return createCORSResponse({
    status: 'success',
    items: items
  });
}

function lookupStripeCheckoutByQrCode_(spreadsheet, qrCode) {
  var empty = { stripe_session_id: '', tracking_number: '', shipping_provider: '' };
  if (!qrCode) return empty;

  var sheet = spreadsheet.getSheetByName(STRIPE_CHECKOUT_SHEET_NAME);
  if (!sheet) return empty;

  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return empty;

  var wanted = qrCode.toString().trim();
  // Range columns 3..16: idx 0=C session, idx 10=M shipping provider, idx 11=N tracking, idx 13=P QR
  var range = sheet.getRange(DATA_START_ROW, 3, lastRow, 16).getValues();

  for (var r = range.length - 1; r >= 0; r--) {
    var pVal = (range[r][13] || '').toString().trim();
    if (pVal === wanted) {
      return {
        stripe_session_id: (range[r][0] || '').toString().trim(),
        shipping_provider: (range[r][10] || '').toString().trim(),
        tracking_number: (range[r][11] || '').toString().trim()
      };
    }
  }
  return empty;
}