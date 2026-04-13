/**
 * File: google_app_scripts/agroverse_qr_codes/qr_code_web_service.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Consolidated web service for the batch QR / Agroverse QR HTTP project (clasp script 1slQVojn…).
 * Merges former web_app.gs + qr_code_generator.gs + subscription_notification.gs into one global scope
 * so duplicate identifiers and competing doGet handlers are avoided.
 *
 * Deployments:
 * - Batch / DApp: https://script.google.com/macros/s/AKfycbySJ86OcVsk5gETTiJ-CY-zBZGHAQoZ8yVW-buxXMjOI9eEc3HP7AicHhtNICHoJo1z/exec
 * - Standalone ledger web (historical): see DEPLOYMENT_URL in web ledger section
 *
 * Edgar / Sidekiq batch QR: set Script property QR_CODE_TELEGRAM_PROCESSOR_EXEC_BASE to the 1N6o00… web app
 * base URL (…/exec without query). doGet forwards GET ?action=processQRCodeGenerationTelegramLogs there.
 */


// ========== Web ledger / lookup (formerly web_app.gs) ==========

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
/** GET list_contributor_names=true — unique names from Contributors Digital Signatures (column A, row has public key in E) for batch QR DApp */
var LIST_CONTRIBUTOR_NAMES_PARAM = 'list_contributor_names';
var CONTRIBUTORS_LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var CONTRIBUTORS_DIGITAL_SIGNATURES_TAB = 'Contributors Digital Signatures';
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
function doOptionsWebLedger_(e) {
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
 * - 'list_contributor_names=true' returns { status, names: string[] } from **Contributors Digital Signatures** (batch QR manager dropdown).
 *
 * @param {Object} e Event object containing parameters.
 * @return {ContentService.TextOutput} JSON response with results or error.
 */
function doGetWebLedger_(e) {
  try {
    if (isTruthyQueryParam_(getQueryParam_(e, LIST_CONTRIBUTOR_NAMES_PARAM))) {
      return listContributorNamesForBatchQr_();
    }

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

/**
 * Unique contributor display names (column A) where column E has a non-empty public key.
 * Used by DApp batch QR generator for Manager Name dropdown.
 */
function listContributorNamesForBatchQr_() {
  try {
    var sh = SpreadsheetApp.openById(CONTRIBUTORS_LEDGER_SPREADSHEET_ID).getSheetByName(CONTRIBUTORS_DIGITAL_SIGNATURES_TAB);
    if (!sh) {
      return createCORSResponse({ status: 'error', message: 'Sheet not found: ' + CONTRIBUTORS_DIGITAL_SIGNATURES_TAB });
    }
    var lastRow = sh.getLastRow();
    if (lastRow < 2) {
      return createCORSResponse({ status: 'success', names: [] });
    }
    var rows = sh.getRange(2, 1, lastRow, 5).getValues();
    var seen = {};
    var names = [];
    for (var i = 0; i < rows.length; i++) {
      var name = (rows[i][0] || '').toString().trim();
      var pub = (rows[i][4] || '').toString().trim();
      if (!name || !pub) continue;
      var key = name.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      names.push(name);
    }
    names.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return createCORSResponse({ status: 'success', names: names });
  } catch (err) {
    return createCORSResponse({ status: 'error', message: err.message || String(err) });
  }
}

// ========== QR batch generation (formerly qr_code_generator.gs) ==========

/**
 * Google Apps Script for QR Code Generation and Management
 * const API_ENDPOINT = 'https://script.google.com/macros/s/AKfycbySJ86OcVsk5gETTiJ-CY-zBZGHAQoZ8yVW-buxXMjOI9eEc3HP7AicHhtNICHoJo1z/exec';
 * 
 * This script provides a web service to:
 * 1. Search for products in the "Currencies" sheet
 * 2. Generate QR codes and add them to the "Agroverse QR codes" sheet
 * 3. Trigger GitHub Actions to generate QR code images
 * 4. Handle the complete workflow from product search to QR code generation
 * 
 * SETUP INSTRUCTIONS:
 * 1. Deploy this script as a web app in Google Apps Script
 * 2. Set up GitHub token in Script Properties:
 *    - Go to Project Settings > Script Properties
 *    - Add property: GITHUB_TOKEN = your_github_personal_access_token
 *    - Token needs 'repo' scope to trigger workflows
 * 3. Test the setup using testGitHubToken() function
 * 
 * USAGE:
 * - GET request: ?product_name=ProductName&action=search|generate
 * - POST request: JSON payload with product_name field
 * 
 * WORKFLOW:
 * 1. doGet/doPost receives product name
 * 2. Searches for product in Currencies sheet
 * 3. Creates new row in Agroverse QR codes sheet
 * 4. Triggers GitHub Actions webhook to generate QR code image
 * 5. Returns success/error response
 */

// ===== Configuration =====

// Sandbox
// var QR_GEN_CURRENCIES_WORKBOOK_URL = 'https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit?gid=0#gid=0';

// Production (Currencies / batch QR product sheet — distinct global name from process_qr_code_generation_telegram_logs.gs)
var QR_GEN_CURRENCIES_WORKBOOK_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1552160318#gid=1552160318';

var CURRENCIES_SHEET_NAME = 'Currencies';
var QR_CODES_SHEET_NAME = 'Agroverse QR codes';
var SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing';
/** Blob base for qr_codes PNGs / batch paths (unique name vs process_qr_code_generation_telegram_logs.gs). */
var QR_CODE_GEN_GITHUB_BLOB_BASE_URL = 'https://github.com/TrueSightDAO/qr_codes/blob/main/';

// ===== Helper Functions =====

// Helper to convert column letter(s) to number
function letterToColumn(letter) {
  var col = 0;
  for (var i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return col;
}

// Get inventory ledger configurations
function getInventoryLedgerConfigs() {
  // Try to fetch ledger configurations from Wix first
  var dynamicConfigs = getLedgerConfigsFromWix();
  if (dynamicConfigs && dynamicConfigs.length > 0) {
    return dynamicConfigs;
  }
  
  // Fallback to hardcoded configuration if Wix fetch fails
  Logger.log('Using fallback hardcoded ledger configuration');
  return [
    {
      ledger_name: 'MAIN',
      ledger_url: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit',
      sheet_name: 'offchain asset location',
      manager_names_column: 'B',
      asset_name_column: 'A',
      asset_quantity_column: 'C',
      record_start_row: 5
    }
  ];
}

// Function to fetch ledger configurations from Google Sheets "Shipment Ledger Listing"
// Migrated from Wix API to Google Sheets for cost savings
function getLedgerConfigsFromWix() {
  try {
    var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
    var shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
    
    if (!shipmentSheet) {
      Logger.log('Error: ' + SHIPMENT_LEDGER_SHEET_NAME + ' sheet not found');
      return [];
    }

    // Get all data from the sheet (skip header row)
    var lastRow = shipmentSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('No data in ' + SHIPMENT_LEDGER_SHEET_NAME + ' sheet');
      return [];
    }

    // Read data starting from row 2 (row 1 is header), columns A to L
    var dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 12);
    var data = dataRange.getValues();

    // Construct LEDGER_CONFIGS from sheet data
    var ledgerConfigs = [];
    var seenUrls = {}; // Track unique URLs to avoid duplicates

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var shipmentId = row[0] ? row[0].toString().trim() : ''; // Column A - Shipment ID
      var ledgerUrl = row[11] ? row[11].toString().trim() : ''; // Column L - Ledger URL
      
      // Skip if no URL or no shipment ID
      if (!ledgerUrl || !shipmentId) {
        continue;
      }
      
      // Skip if we've already processed this URL (avoid duplicates)
      if (seenUrls[ledgerUrl]) {
        continue;
      }
      seenUrls[ledgerUrl] = true;

      try {
        var resolvedUrl = resolveRedirect(ledgerUrl);
        if (resolvedUrl) {
          ledgerConfigs.push({
            ledger_name: shipmentId,
            ledger_url: resolvedUrl,
            sheet_name: 'Balance',
            manager_names_column: 'H',
            asset_name_column: 'J',
            asset_quantity_column: 'I',
            record_start_row: 6
          });
          Logger.log('Resolved URL: ' + ledgerUrl + ' -> ' + resolvedUrl);
          Logger.log('Using shipment ID as ledger name: ' + shipmentId + ' for URL: ' + ledgerUrl);
        } else {
          Logger.log('Warning: Could not resolve URL for ' + shipmentId + ': ' + ledgerUrl);
        }
      } catch (e) {
        Logger.log('Error resolving URL for ' + shipmentId + ': ' + e.message);
      }
    }
    
    // Add the main inventory sheet
    ledgerConfigs.unshift({
      ledger_name: 'MAIN',
      ledger_url: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit',
      sheet_name: 'offchain asset location',
      manager_names_column: 'B',
      asset_name_column: 'A',
      asset_quantity_column: 'C',
      record_start_row: 5
    });
    
    Logger.log('Ledger configs fetched from ' + SHIPMENT_LEDGER_SHEET_NAME + ': ' + JSON.stringify(ledgerConfigs));
    return ledgerConfigs;
    
  } catch (e) {
    Logger.log('Error fetching ledger configs from ' + SHIPMENT_LEDGER_SHEET_NAME + ': ' + e.message);
    return [];
  }
}

// Helper function to resolve redirect URLs
// First checks "Shipment Ledger Listing" sheet (Column L -> Column AB lookup)
// Falls back to HTTP resolution if not found in sheet
function resolveRedirect(url) {
  try {
    // First, try to look up the URL in "Shipment Ledger Listing" sheet
    // Column L (index 11) = unresolved URL, Column AB (index 27) = resolved URL
    try {
      var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
      var shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
      
      if (shipmentSheet) {
        var lastRow = shipmentSheet.getLastRow();
        if (lastRow >= 2) {
          // Read columns A to AB (28 columns) to get both Column L and Column AB
          var dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 28);
          var data = dataRange.getValues();
          
          for (var i = 0; i < data.length; i++) {
            var row = data[i];
            var ledgerUrl = row[11] ? row[11].toString().trim() : ''; // Column L (index 11)
            
            // Check if this row's Column L matches the input URL
            if (ledgerUrl === url || ledgerUrl === url.trim()) {
              var resolvedUrl = row[27] ? row[27].toString().trim() : ''; // Column AB (index 27)
              if (resolvedUrl) {
                Logger.log('Found resolved URL in sheet: ' + url + ' -> ' + resolvedUrl);
                return resolvedUrl;
              }
            }
          }
        }
      }
    } catch (sheetError) {
      Logger.log('Could not lookup URL in sheet, falling back to HTTP resolution: ' + sheetError.message);
    }
    
    // Fallback to HTTP resolution if not found in sheet
    var currentUrl = url;
    var redirectCount = 0;
    var maxRedirects = 10;
    
    while (redirectCount < maxRedirects) {
      var response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });
      var responseCode = response.getResponseCode();
      
      // If not a redirect (2xx or other), check for JavaScript redirects
      if (responseCode < 300 || responseCode >= 400) {
        // Check if the response contains JavaScript redirects
        var content = response.getContentText();
        var jsRedirectMatch = content.match(/window\.location\.(replace|href)\s*=\s*['"]([^'"]+)['"]/i) ||
                            content.match(/window\.location\.replace\(['"]([^'"]+)['"]\)/i) ||
                            content.match(/<meta\s+http-equiv=['"]refresh['"]\s+content=['"]\d+;url=([^'"]+)['"]/i);
        
        if (jsRedirectMatch) {
          var redirectUrl = jsRedirectMatch[1] || jsRedirectMatch[2];
          if (redirectUrl) {
            // Resolve relative URLs to absolute
            if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
              currentUrl = redirectUrl;
              redirectCount++;
              Logger.log('Found JavaScript redirect to: ' + currentUrl);
              continue;
            } else {
              // Relative URL - construct absolute URL
              try {
                var baseUrl = new URL(currentUrl);
                var resolvedUrl = new URL(redirectUrl, baseUrl).toString();
                currentUrl = resolvedUrl;
                redirectCount++;
                Logger.log('Resolved relative JavaScript redirect to: ' + currentUrl);
                continue;
              } catch (e) {
                Logger.log('Error resolving relative JavaScript redirect: ' + e.message);
        return currentUrl;
              }
            }
          }
      }
      
        // No JavaScript redirect found, return current URL
        return currentUrl;
      }
      
      // Get the Location header for HTTP redirect
      var headers = response.getHeaders();
      var location = headers['Location'] || headers['location'];
      if (!location) {
        Logger.log('No Location header for redirect at ' + currentUrl);
        // Try to check for JavaScript redirect in response body
        var content = response.getContentText();
        var jsRedirectMatch = content.match(/window\.location\.(replace|href)\s*=\s*['"]([^'"]+)['"]/i) ||
                            content.match(/window\.location\.replace\(['"]([^'"]+)['"]\)/i) ||
                            content.match(/<meta\s+http-equiv=['"]refresh['"]\s+content=['"]\d+;url=([^'"]+)['"]/i);
        
        if (jsRedirectMatch) {
          var redirectUrl = jsRedirectMatch[1] || jsRedirectMatch[2];
          if (redirectUrl) {
            if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
              currentUrl = redirectUrl;
            } else {
              try {
                var baseUrl = new URL(currentUrl);
                currentUrl = new URL(redirectUrl, baseUrl).toString();
              } catch (e) {
                Logger.log('Error resolving relative JavaScript redirect: ' + e.message);
                return '';
              }
            }
            redirectCount++;
            Logger.log('Found JavaScript redirect to: ' + currentUrl);
            continue;
          }
        }
        return '';
      }
      
      // Update the current URL and increment redirect count
      currentUrl = location;
      redirectCount++;
    }
    
    Logger.log('Exceeded maximum redirects (' + maxRedirects + ') for URL ' + url);
    return '';
  } catch (e) {
    Logger.log('Error resolving redirect for URL ' + url + ': ' + e.message);
    return '';
  }
}

// ===== Main Web App Function =====
function doGetQrGenerator_(e) {
  try {
    // list_contributor_names / processQRCodeGenerationTelegramLogs are handled by unified doGet() above.

    // Parse parameters
    var action = e.parameter.action || 'generate';
    var productName = e.parameter.product_name;
    var quantity = parseInt(e.parameter.quantity) || 1; // Number of QR codes to generate
    var digitalSignature = e.parameter.digital_signature; // Digital signature for identification
    var requestorEmail = e.parameter.email; // Optional email for notification
    
    switch (action) {
      case 'list':
        return listAllCurrencies();
      case 'search':
        if (!productName) {
          return createErrorResponse('Missing required parameter: product_name for search action');
        }
        return searchProduct(productName);
      case 'generate':
        if (!productName) {
          return createErrorResponse('Missing required parameter: product_name for generate action');
        }
        // Validate quantity
        if (quantity < 1 || quantity > 100) {
          return createErrorResponse('Quantity must be between 1 and 100');
        }
        return generateBatchQRCodes(productName, quantity, digitalSignature, requestorEmail);
      case 'generate_single':
        if (!productName) {
          return createErrorResponse('Missing required parameter: product_name for generate_single action');
        }
        return generateQRCode(productName);
      default:
        return createErrorResponse('Invalid action. Use "list", "search", "generate", or "generate_single"');
    }
    
  } catch (error) {
    return createErrorResponse('Error processing request: ' + error.message);
  }
}

// Handle POST requests (for batch QR code generation)
function doPostQr_(e) {
  try {
    // Parse the POST data
    var postData = e.postData.contents;
    var payload = JSON.parse(postData);
    
    // Check if this is a batch QR generation request
    if (payload.request_type === 'batch_qr_generation') {
      var result = handleBatchQRRequest(payload);
    } else {
      var result = createErrorResponse('Invalid request type. Use "batch_qr_generation"');
    }
    
    // Return the result with CORS headers
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400'
      });
    
  } catch (error) {
    var errorResult = createErrorResponse('Error processing POST request: ' + error.message);
    return ContentService
      .createTextOutput(JSON.stringify(errorResult))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400'
      });
  }
}

// Handle OPTIONS requests (CORS preflight)
function doOptionsQr_(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
}

// ===== Handle Batch QR Code Request =====
function handleBatchQRRequest(payload) {
  try {
    // Validate required fields
    var requiredFields = ['currency_name', 'quantity', 'digital_signature', 'request_transaction_id', 'submission_source'];
    for (var i = 0; i < requiredFields.length; i++) {
      if (!payload[requiredFields[i]]) {
        return createErrorResponse('Missing required field: ' + requiredFields[i]);
      }
    }
    
    // Validate quantity
    var quantity = parseInt(payload.quantity);
    if (isNaN(quantity) || quantity < 1 || quantity > 100) {
      return createErrorResponse('Quantity must be between 1 and 100');
    }
    
    // Verify digital signature and get user info
    var userInfo = verifyDigitalSignature(payload.digital_signature);
    if (!userInfo.success) {
      return createErrorResponse('Invalid digital signature: ' + userInfo.message);
    }
    
    // Generate batch QR codes
    var result = generateBatchQRCodes(
      payload.currency_name, 
      quantity, 
      payload.digital_signature, 
      userInfo.email,
      payload.request_transaction_id,
      payload.submission_source
    );
    
    var resultData = JSON.parse(result.getContent());
    
    if (resultData.status === 'success') {
      // Send email notification
      var emailResult = sendEmailNotification(
        userInfo.email,
        resultData.data.zip_file_name,
        resultData.data.zip_file_url,
        quantity,
        payload.currency_name
      );
      
      return createSuccessResponse({
        action: 'batch_qr_generation',
        currency_name: payload.currency_name,
        quantity: quantity,
        batch_id: resultData.data.batch_id,
        zip_file_name: resultData.data.zip_file_name,
        zip_file_url: resultData.data.zip_file_url,
        email_sent: emailResult.success,
        email_message: emailResult.message,
        message: 'Batch QR codes generated successfully. Check your email for download link.'
      });
    } else {
      return result; // Return the error response
    }
    
  } catch (error) {
    return createErrorResponse('Error processing batch QR request: ' + error.message);
  }
}

// ===== List All Currencies with Quantities Function =====
function listAllCurrencies() {
  var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
  var sheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
  
  if (!sheet) {
    return createErrorResponse('Currencies sheet not found');
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return createErrorResponse('No data found in Currencies sheet');
  }
  
  // Get all data from the Currencies sheet (skip header row)
  var dataRange = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // A to J
  var currencyQuantities = {}; // Track total quantities for each currency
  
  // First pass: collect only serializable currencies from the Currencies sheet
  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    var currentProductName = row[0] ? row[0].toString().trim() : '';
    Logger.log(currentProductName)
    var isSerializable = row[2] === true || row[2] === 'TRUE' || row[2] === 'True'; // Column C
    
    // Only include currencies that are marked as serializable
    if (currentProductName && isSerializable) {
      currencyQuantities[currentProductName] = {
        product_name: currentProductName,
        product_image: row[3] || '', // Column D
        landing_page: row[4] || '', // Column E
        ledger: row[5] || '', // Column F
        farm_name: row[6] || '', // Column G
        state: row[7] || '', // Column H
        country: row[8] || '', // Column I
        year: row[9] || '', // Column J
        total_quantity: 0,
        ledger_quantities: {} // Track quantities per ledger
      };
    }
  }
  
  // Second pass: fetch quantities from inventory ledgers
  var ledgerConfigs = getInventoryLedgerConfigs();
  Logger.log('Processing ' + ledgerConfigs.length + ' ledgers for quantities');
  
  ledgerConfigs.forEach(function(config) {
    try {
      Logger.log('Processing ledger: ' + config.ledger_name + ' - ' + config.ledger_url);
      
      if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
        Logger.log('Skipping invalid or non-spreadsheet URL: ' + config.ledger_url);
        return;
      }
      
      var ledgerSpreadsheet = SpreadsheetApp.openByUrl(config.ledger_url);
      var ledgerSheet = ledgerSpreadsheet.getSheetByName(config.sheet_name);
      if (!ledgerSheet) {
        Logger.log('Sheet not found: ' + config.sheet_name + ' in ledger ' + config.ledger_name);
        return;
      }
      
      var startRow = config.record_start_row;
      var lastLedgerRow = ledgerSheet.getLastRow();
      var numRows = Math.max(0, lastLedgerRow - startRow + 1);
      if (numRows < 1) {
        Logger.log('No data rows found in ledger ' + config.ledger_name);
        return;
      }
      
      Logger.log('Processing ' + numRows + ' rows in ledger ' + config.ledger_name);
      
      var nameCol = letterToColumn(config.manager_names_column);
      var assetCol = letterToColumn(config.asset_name_column);
      var qtyCol = letterToColumn(config.asset_quantity_column);
      
      var names = ledgerSheet.getRange(startRow, nameCol, numRows, 1).getValues();
      var assets = ledgerSheet.getRange(startRow, assetCol, numRows, 1).getValues();
      var qtys = ledgerSheet.getRange(startRow, qtyCol, numRows, 1).getValues();
      
      var matchesFound = 0;
      for (var i = 0; i < names.length; i++) {
        var assetName = assets[i][0];
        var quantity = parseFloat(qtys[i][0]) || 0;
        
        // Check if this asset matches any currency in our list
        if (assetName && currencyQuantities[assetName]) {
          currencyQuantities[assetName].total_quantity += quantity;
          currencyQuantities[assetName].ledger_quantities[config.ledger_name] = 
            (currencyQuantities[assetName].ledger_quantities[config.ledger_name] || 0) + quantity;
          matchesFound++;
          Logger.log('Found match in ' + config.ledger_name + ': ' + assetName + ' = ' + quantity);
        }
      }
      
      Logger.log('Found ' + matchesFound + ' matches in ledger ' + config.ledger_name);
      
    } catch (err) {
      Logger.log('Error processing ledger ' + config.ledger_name + ': ' + err);
    }
  });
  
  // Convert to array and filter out currencies with zero quantity
  var allCurrencies = [];
  for (var currencyName in currencyQuantities) {
    var currency = currencyQuantities[currencyName];
    if (currency.total_quantity > 0) {
      allCurrencies.push(currency);
    }
  }
  
  // Sort by total quantity (descending)
  allCurrencies.sort(function(a, b) {
    return b.total_quantity - a.total_quantity;
  });
  
  return createSuccessResponse({
    action: 'list',
    currencies: allCurrencies,
    total_currencies: allCurrencies.length
  });
}

// ===== Product Search Function =====
function searchProduct(productName) {
  var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
  var sheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
  
  if (!sheet) {
    return createErrorResponse('Currencies sheet not found');
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return createErrorResponse('No data found in Currencies sheet');
  }
  
  // Search in column A (Product names)
  var dataRange = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // A to J
  var matchingProducts = [];
  
  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    var currentProductName = row[0] ? row[0].toString().trim() : '';
    var isSerializable = row[2] === true || row[2] === 'TRUE' || row[2] === 'True'; // Column C
    
    // Only include currencies that are marked as serializable and match the search term
    if (currentProductName && isSerializable && currentProductName.toLowerCase().includes(productName.toLowerCase())) {
      matchingProducts.push({
        product_name: currentProductName,
        product_image: row[3] || '', // Column D
        landing_page: row[4] || '', // Column E
        ledger: row[5] || '', // Column F
        farm_name: row[6] || '', // Column G
        state: row[7] || '', // Column H
        country: row[8] || '', // Column I
        year: row[9] || '' // Column J
      });
    }
  }
  
  return createSuccessResponse({
    action: 'search',
    product_name: productName,
    matches: matchingProducts,
    total_matches: matchingProducts.length
  });
}

// ===== QR Code Generation Function =====
function generateQRCode(productName) {
  var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
  var currenciesSheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
  var qrCodesSheet = spreadsheet.getSheetByName(QR_CODES_SHEET_NAME);
  
  if (!currenciesSheet || !qrCodesSheet) {
    return createErrorResponse('Required sheets not found');
  }
  
  // Find the product in Currencies sheet
  var productData = findProductInCurrencies(currenciesSheet, productName);
  if (!productData) {
    return createErrorResponse('Product not found: ' + productName);
  }
  
  // Generate QR code value
  var qrCodeValue = generateQRCodeValue(productData.year);
  
  // Add new row to QR codes sheet after the last non-empty row in column A
  var newRowData = createQRCodeRow(qrCodeValue, productData);
  var insertRow = findLastNonEmptyRowInColumnA(qrCodesSheet) + 1;
  qrCodesSheet.getRange(insertRow, 1, 1, newRowData.length).setValues([newRowData]);
  
  // Commit changes
  SpreadsheetApp.flush();
  
  // Trigger GitHub Actions webhook to generate QR code image
  var webhookResult = triggerGitHubWebhook(insertRow);
  
  return createSuccessResponse({
    action: 'generate',
    product_name: productName,
    qr_code: qrCodeValue,
    row_added: insertRow,
    github_url: QR_CODE_GEN_GITHUB_BLOB_BASE_URL + qrCodeValue + '.png',
    webhook_triggered: webhookResult.success,
    webhook_message: webhookResult.message
  });
}

// ===== Batch QR Code Generation Function =====
function generateBatchQRCodes(currencyName, quantity, digitalSignature, requestorEmail, requestTransactionId, submissionSource) {
  var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
  var currenciesSheet = spreadsheet.getSheetByName(CURRENCIES_SHEET_NAME);
  var qrCodesSheet = spreadsheet.getSheetByName(QR_CODES_SHEET_NAME);
  
  if (!currenciesSheet || !qrCodesSheet) {
    return createErrorResponse('Required sheets not found');
  }
  
  // Find the currency in Currencies sheet
  var currencyData = findProductInCurrencies(currenciesSheet, currencyName);
  if (!currencyData) {
    return createErrorResponse('Currency not found: ' + currencyName);
  }
  
  // Generate batch information
  var batchId = generateBatchId();
  var zipFileName = generateZipFileName(currencyName, batchId);
  var generatedRows = [];
  var startRow = findLastNonEmptyRowInColumnA(qrCodesSheet) + 1;
  
  // Generate multiple QR codes
  for (var i = 0; i < quantity; i++) {
    var qrCodeValue = generateQRCodeValue(currencyData.year);
    var newRowData = createQRCodeRow(qrCodeValue, currencyData);
    var insertRow = startRow + i;
    
    // Add batch information to the row
    newRowData.push(batchId); // Column U: Batch ID
    newRowData.push(zipFileName); // Column V: Zip file name
    newRowData.push(digitalSignature || ''); // Column W: Digital signature
    newRowData.push(requestorEmail || ''); // Column X: Requestor email
    newRowData.push(requestTransactionId || ''); // Column Y: Request transaction ID
    newRowData.push(submissionSource || ''); // Column Z: Submission source
    
    qrCodesSheet.getRange(insertRow, 1, 1, newRowData.length).setValues([newRowData]);
    generatedRows.push({
      qr_code: qrCodeValue,
      row: insertRow,
      github_url: QR_CODE_GEN_GITHUB_BLOB_BASE_URL + qrCodeValue + '.png'
    });
  }
  
  // Commit changes
  SpreadsheetApp.flush();
  
  // Trigger GitHub Actions webhook for batch processing
  var webhookResult = triggerBatchGitHubWebhook(startRow, startRow + quantity - 1, zipFileName, digitalSignature, requestorEmail);
  
  return createSuccessResponse({
    action: 'generate_batch',
    currency_name: currencyName,
    quantity: quantity,
    batch_id: batchId,
    zip_file_name: zipFileName,
    zip_file_url: QR_CODE_GEN_GITHUB_BLOB_BASE_URL.replace('/blob/', '/raw/') + 'batch_files/' + zipFileName,
    start_row: startRow,
    end_row: startRow + quantity - 1,
    generated_codes: generatedRows,
    webhook_triggered: webhookResult.success,
    webhook_message: webhookResult.message
  });
}

// ===== Helper Functions =====

function findProductInCurrencies(sheet, productName) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  
  var dataRange = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // A to J
  
  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    var currentProductName = row[0] ? row[0].toString().trim() : '';
    var isSerializable = row[2] === true || row[2] === 'TRUE' || row[2] === 'True'; // Column C
    
    // Only return products that are marked as serializable
    if (currentProductName && isSerializable && currentProductName.toLowerCase() === productName.toLowerCase()) {
      return {
        product_name: currentProductName,
        product_image: row[3] || '', // Column D
        landing_page: row[4] || '', // Column E
        ledger: row[5] || '', // Column F
        farm_name: row[6] || '', // Column G
        state: row[7] || '', // Column H
        country: row[8] || '', // Column I
        year: row[9] || '' // Column J
      };
    }
  }
  return null;
}

function generateQRCodeValue(year) {
  var today = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  var yearPrefix = year || today.getFullYear().toString();
  
  // Find the next available running number
  var runningNumber = findNextRunningNumber(yearPrefix, dateStr);
  
  return yearPrefix + '_' + dateStr + '_' + runningNumber;
}

function findLastNonEmptyRowInColumnA(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1; // Return row 1 if sheet is empty or only has header
  
  // Get all values in column A from row 2 to last row
  var columnAValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  
  // Find the last non-empty row
  for (var i = columnAValues.length - 1; i >= 0; i--) {
    var value = columnAValues[i][0];
    if (value && value.toString().trim() !== '') {
      return i + 2; // +2 because we started from row 2 and i is 0-based
    }
  }
  
  return 1; // Return row 1 if no non-empty values found
}

function findNextRunningNumber(yearPrefix, dateStr) {
  var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
  var qrCodesSheet = spreadsheet.getSheetByName(QR_CODES_SHEET_NAME);
  
  var lastNonEmptyRow = findLastNonEmptyRowInColumnA(qrCodesSheet);
  if (lastNonEmptyRow < 2) return 1;
  
  var qrCodeColumn = qrCodesSheet.getRange(2, 1, lastNonEmptyRow - 1, 1).getValues();
  var maxNumber = 0;
  var pattern = new RegExp('^' + yearPrefix + '_' + dateStr + '_(\\d+)$');
  
  for (var i = 0; i < qrCodeColumn.length; i++) {
    var qrCode = qrCodeColumn[i][0] ? qrCodeColumn[i][0].toString() : '';
    var match = qrCode.match(pattern);
    if (match) {
      var number = parseInt(match[1]);
      if (number > maxNumber) {
        maxNumber = number;
      }
    }
  }
  
  return maxNumber + 1;
}

function createQRCodeRow(qrCodeValue, productData) {
  var today = new Date();
  var dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  
  return [
    qrCodeValue, // Column A: QR Code value
    productData.landing_page, // Column B: Landing page
    productData.ledger, // Column C: Ledger
    'MINTED', // Column D: Status
    productData.farm_name, // Column E: Farm name
    productData.state, // Column F: State
    productData.country, // Column G: Country
    productData.year, // Column H: Year
    productData.product_name, // Column I: Product name
    dateStr, // Column J: Current date
    QR_CODE_GEN_GITHUB_BLOB_BASE_URL + qrCodeValue + '.png', // Column K: GitHub URL
    '', // Column L: Email (placeholder)
    '', // Column M: (placeholder)
    '', // Column N: (placeholder)
    '', // Column O: (placeholder)
    '', // Column P: (placeholder)
    '', // Column Q: (placeholder)
    '', // Column R: (placeholder)
    productData.product_image, // Column S: Product image from column D
    25 // Column T: Price (default value)
  ];
}

// ===== Batch Processing Helper Functions =====

function generateBatchId() {
  var today = new Date();
  var timestamp = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  return 'BATCH_' + timestamp + '_' + randomId;
}

function generateZipFileName(productName, batchId) {
  // Clean product name for filename
  var cleanName = productName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
  return cleanName + '_' + batchId + '.zip';
}

function createSuccessResponse(data) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'success',
    data: data
  })).setMimeType(ContentService.MimeType.JSON);
}

function createErrorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'error',
    message: message
  })).setMimeType(ContentService.MimeType.JSON);
}

// ===== GitHub Actions Webhook Trigger =====
function triggerGitHubWebhook(sheetRow) {
  try {
    // GitHub repository configuration
    var githubRepo = 'TrueSightDAO/tokenomics';
    var githubToken = getGitHubToken(); // You'll need to set this up
    
    if (!githubToken) {
      return {
        success: false,
        message: 'GitHub token not configured. Please set GITHUB_TOKEN in Script Properties.'
      };
    }
    
    // Prepare the repository_dispatch payload
    var payload = {
      event_type: 'qr-code-generation',
      client_payload: {
        sheet_row: sheetRow.toString(),
        no_commit: 'false',
        timestamp: new Date().toISOString()
      }
    };
    
    // Make the API call to trigger repository_dispatch
    var url = 'https://api.github.com/repos/' + githubRepo + '/dispatches';
    var options = {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + githubToken,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GoogleAppsScript-QRCodeGenerator'
      },
      payload: JSON.stringify(payload)
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode === 204) {
      return {
        success: true,
        message: 'GitHub Actions webhook triggered successfully for row ' + sheetRow + '. Workflow will generate QR code image.'
      };
    } else {
      var responseText = response.getContentText();
      return {
        success: false,
        message: 'Failed to trigger webhook. Response: ' + responseCode + ' - ' + responseText
      };
    }
    
  } catch (error) {
    return {
      success: false,
      message: 'Error triggering webhook: ' + error.message
    };
  }
}

// ===== Batch GitHub Actions Webhook Trigger =====
function triggerBatchGitHubWebhook(startRow, endRow, zipFileName, digitalSignature, requestorEmail) {
  try {
    // GitHub repository configuration
    var githubRepo = 'TrueSightDAO/tokenomics';
    var githubToken = getGitHubToken();
    
    if (!githubToken) {
      return {
        success: false,
        message: 'GitHub token not configured. Please set GITHUB_TOKEN in Script Properties.'
      };
    }
    
    // Prepare the repository_dispatch payload for batch processing
    var payload = {
      event_type: 'qr-code-batch-generation',
      client_payload: {
        start_row: startRow.toString(),
        end_row: endRow.toString(),
        zip_file_name: zipFileName,
        digital_signature: digitalSignature || '',
        requestor_email: requestorEmail || '',
        timestamp: new Date().toISOString()
      }
    };
    
    // Make the API call to trigger repository_dispatch
    var url = 'https://api.github.com/repos/' + githubRepo + '/dispatches';
    var options = {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + githubToken,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GoogleAppsScript-QRCodeGenerator'
      },
      payload: JSON.stringify(payload)
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode === 204) {
      return {
        success: true,
        message: 'Batch GitHub Actions webhook triggered successfully for rows ' + startRow + '-' + endRow + '. Workflow will generate QR codes and create zip file.'
      };
    } else {
      var responseText = response.getContentText();
      return {
        success: false,
        message: 'Failed to trigger batch webhook. Response: ' + responseCode + ' - ' + responseText
      };
    }
    
  } catch (error) {
    return {
      success: false,
      message: 'Error triggering batch webhook: ' + error.message
    };
  }
}

// ===== Digital Signature Verification =====
function verifyDigitalSignature(digitalSignature) {
  try {
    // Call the Asset Management API to verify signature and get user info
    var assetManagementApi = 'https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec';
    
    var params = {
      'digital_signature': digitalSignature,
      'action': 'get_contributor_info'
    };
    
    var response = UrlFetchApp.fetch(assetManagementApi + '?' + Object.keys(params).map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&'));
    
    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText());
      if (data.status === 'success' && data.data) {
        return {
          success: true,
          name: data.data.name || 'Unknown',
          email: data.data.email || '',
          voting_rights: data.data.voting_rights || 0
        };
      } else {
        return {
          success: false,
          message: data.message || 'Invalid digital signature'
        };
      }
    } else {
      return {
        success: false,
        message: 'Failed to verify digital signature'
      };
    }
    
  } catch (error) {
    return {
      success: false,
      message: 'Error verifying digital signature: ' + error.message
    };
  }
}

// ===== Email Notification Function =====
function sendEmailNotification(email, zipFileName, zipFileUrl, quantity, currencyName) {
  try {
    // This would integrate with an email service
    // For now, we'll just log the email details
    
    var subject = "QR Code Batch Generation Complete - TrueSight DAO";
    var body = "Your QR code batch has been generated successfully!\n\n" +
               "📦 Zip File: " + zipFileName + "\n" +
               "🔗 Download Link: " + zipFileUrl + "\n" +
               "📊 Quantity: " + quantity + " QR codes\n" +
               "💰 Currency: " + currencyName + "\n" +
               "📅 Generated: " + new Date().toISOString() + "\n\n" +
               "You can download the zip file containing all QR code images from the link above.\n\n" +
               "Best regards,\nTrueSight DAO QR Code System";
    
    Logger.log('Email notification prepared:');
    Logger.log('To: ' + email);
    Logger.log('Subject: ' + subject);
    Logger.log('Body: ' + body);
    
    // TODO: Implement actual email sending
    // Example with Gmail:
    // GmailApp.sendEmail(email, subject, body);
    
    return {
      success: true,
      message: 'Email notification prepared for ' + email
    };
    
  } catch (error) {
    return {
      success: false,
      message: 'Error sending email: ' + error.message
    };
  }
}

// ===== GitHub Token Management =====
function getGitHubToken() {
  // Option 1: Get from Script Properties (recommended for production)
  var scriptProperties = PropertiesService.getScriptProperties();
  var token = scriptProperties.getProperty('GITHUB_TOKEN');
  
  if (token) {
    return token;
  }
  
  // Option 2: Get from environment variable (for development)
  // Note: This might not work in Google Apps Script environment
  try {
    var envToken = process.env.GITHUB_TOKEN;
    if (envToken) {
      return envToken;
    }
  } catch (e) {
    // Environment variable access not available
  }
  
  // Option 3: Hardcoded token (not recommended for production)
  // return 'your_github_token_here';
  
  return null;
}

// ===== Setup GitHub Token =====
function setupGitHubToken() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var currentToken = scriptProperties.getProperty('GITHUB_TOKEN');
  
  if (currentToken) {
    Logger.log('GitHub token is already configured');
    return 'GitHub token is already configured';
  } else {
    Logger.log('GitHub token not configured. Please set it up manually.');
    return 'GitHub token not configured. Please set GITHUB_TOKEN in Script Properties.';
  }
}

// ===== Utility Functions for Manual Testing =====

function testSearchProduct() {
  var testEvent = {
    parameter: {
      product_name: '8 Ounce Package Kraft Pouch - Ilheus, Brazil 2024',
      action: 'search'
    }
  };
  var result = doGet(testEvent);
  Logger.log(result.getContent());
}

function testGenerateQRCode() {
  var testEvent = {
    parameter: {
      product_name: '8 Ounce Package Kraft Pouch - Ilheus, Brazil 2024',
      action: 'generate'
    }
  };
  var result = doGet(testEvent);
  Logger.log(result.getContent());
}

function testFindLastNonEmptyRow() {
  var spreadsheet = SpreadsheetApp.openByUrl(QR_GEN_CURRENCIES_WORKBOOK_URL);
  var qrCodesSheet = spreadsheet.getSheetByName(QR_CODES_SHEET_NAME);
  var lastNonEmptyRow = findLastNonEmptyRowInColumnA(qrCodesSheet);
  Logger.log('Last non-empty row in column A: ' + lastNonEmptyRow);
  Logger.log('Next row to insert: ' + (lastNonEmptyRow + 1));
}

function testWebhookTrigger() {
  // Test webhook trigger for row 708
  var result = triggerGitHubWebhook(708);
  Logger.log('Webhook trigger result: ' + JSON.stringify(result));
}

function testGitHubToken() {
  var token = getGitHubToken();
  if (token) {
    Logger.log('GitHub token is configured');
    return 'GitHub token is configured';
  } else {
    Logger.log('GitHub token is NOT configured');
    return 'GitHub token is NOT configured. Please set GITHUB_TOKEN in Script Properties.';
  }
}

// Test function to debug ledger fetching
function testLedgerFetching() {
  Logger.log('=== Testing Ledger Fetching ===');
  
  try {
    var creds = getCredentials();
    Logger.log('Credentials loaded: ' + (creds ? 'YES' : 'NO'));
    Logger.log('Wix API Key: ' + (creds.WIX_API_KEY ? 'PRESENT' : 'MISSING'));
    
    var ledgerConfigs = getInventoryLedgerConfigs();
    Logger.log('Total ledger configs: ' + ledgerConfigs.length);
    
    for (var i = 0; i < ledgerConfigs.length; i++) {
      var config = ledgerConfigs[i];
      Logger.log('Ledger ' + (i + 1) + ': ' + config.ledger_name + ' - ' + config.ledger_url);
    }
    
    return 'Ledger fetching test completed. Check logs for details.';
    
  } catch (error) {
    Logger.log('Error in testLedgerFetching: ' + error.message);
    return 'Error: ' + error.message;
  }
}


// ========== Subscription email (formerly subscription_notification.gs) ==========

/**
 * File: google_app_scripts/agroverse_qr_codes/subscription_notification.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Google Apps Script for TrueSight DAO automation.
 */

/* Configurable Variables */
const SUBSCRIPTION_NOTIFICATION_WORKBOOK_URL = "https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit"; // Google Sheet URL
const SHEET_NAME = "Agroverse QR codes"; // Sheet name
const GOOGLE_DOC_ID = "1VDPblYlWIpirqH9o3eoiL8pKHv8E3oea99c6DJQGA3k"; // Replace with your Google Doc ID
const TEST_QR_CODE = "2025BF_20250521_PROPANE_1"; // QR code for testing
const EMAIL_COLUMN = 12; // Column L (1-based index)
const TIMESTAMP_COLUMN = 13; // Column M (1-based index)
const QR_CODE_COLUMN = 1; // Column A (1-based index)

/**
 * Tester method to manually test email sending with a sample QR code
 */
function testSendEmail() {
  sendEmailForQRCode(TEST_QR_CODE);
}

/**
 * Processes all records with valid email in column L and no sent date in column M
 */
function processBatch() {
  const sheet = SpreadsheetApp.openByUrl(SUBSCRIPTION_NOTIFICATION_WORKBOOK_URL).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Iterate through rows, starting at 1 to skip header
  for (let i = 1; i < data.length; i++) {
    const email = data[i][EMAIL_COLUMN - 1]; // Column L
    const notificationDate = data[i][TIMESTAMP_COLUMN - 1]; // Column M
    const qrCode = data[i][QR_CODE_COLUMN - 1]; // Column A

    // Check if email is valid and no notification date exists
    if (emailRegex.test(email) && !notificationDate) {
      sendEmailForQRCode(qrCode);
    }
  }
}

/**
 * Sends an email for a given QR code if conditions are met
 * @param {string} qrCode - The QR code to match in column A
 */
function sendEmailForQRCode(qrCode) {
  const sheet = SpreadsheetApp.openByUrl(SUBSCRIPTION_NOTIFICATION_WORKBOOK_URL).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Find row where QR code matches column A
  for (let i = 1; i < data.length; i++) { // Start at 1 to skip header
    if (data[i][QR_CODE_COLUMN - 1] === qrCode) { // Column A (0-based index)
      const email = data[i][EMAIL_COLUMN - 1]; // Column L
      const notificationDate = data[i][TIMESTAMP_COLUMN - 1]; // Column M

      if (emailRegex.test(email) && !notificationDate) {
        const doc = DocumentApp.openById(GOOGLE_DOC_ID);
        const subject = doc.getName(); // Get document title as email subject
        let body = doc.getBody().getText();
        const trackingLink = `${data[i][1]}?qr_code=${encodeURIComponent(qrCode)}`; // Use column B (index 1) for base URL
        body = body.replace("{{TRACKING_LINK}}", trackingLink);

        // Convert plain text to HTML to preserve formatting
        const htmlBody = HtmlService.createHtmlOutput(body.replace(/\n/g, "<br>")).getContent();

        // Send email with HTML content
        MailApp.sendEmail({
          to: email,
          subject: subject,
          htmlBody: htmlBody
        });

        // Update column M with timestamp
        sheet.getRange(i + 1, TIMESTAMP_COLUMN).setValue(new Date());
        break; // Exit loop after processing
      }
    }
  }
}

// ========== Unified router ==========

// ----- Unified HTTP entry (single doGet / doPost / doOptions for this project) -----

function shouldRouteToWebLedger_(e) {
  var p = e && e.parameter ? e.parameter : {};
  if (isTruthyQueryParam_(getQueryParam_(e, LIST_CONTRIBUTOR_NAMES_PARAM))) return true;
  if (isTruthyQueryParam_(getQueryParam_(e, LIST_UNASSIGNED_STRIPE_SESSIONS_PARAM))) return true;
  if (p[LIST_ALL_PARAM] === 'true' || p[LIST_PARAM] === 'true' || p[LIST_WITH_MEMBERS_PARAM] === 'true') return true;
  if (p[LOOKUP_PARAM] === 'true') return true;
  if (p[QR_CODE_PARAM] && p[EMAIL_ADDRESS_PARAM]) return true;
  return false;
}

function forwardProcessQrGenerationTelegramLogs_() {
  var base = PropertiesService.getScriptProperties().getProperty('QR_CODE_TELEGRAM_PROCESSOR_EXEC_BASE');
  if (!base || !String(base).trim()) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: 'Set Script property QR_CODE_TELEGRAM_PROCESSOR_EXEC_BASE to the 1N6o00 web app /exec URL (Telegram QR generation project).'
    })).setMimeType(ContentService.MimeType.JSON);
  }
  var b = String(base).trim().replace(/\?$/, '');
  var url = b + (b.indexOf('?') === -1 ? '?' : '&') + 'action=processQRCodeGenerationTelegramLogs';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  return ContentService.createTextOutput(resp.getContentText())
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var actionRaw = getQueryParam_(e, 'action');
    if (String(actionRaw).trim() === 'processQRCodeGenerationTelegramLogs') {
      return forwardProcessQrGenerationTelegramLogs_();
    }
    if (shouldRouteToWebLedger_(e)) {
      return doGetWebLedger_(e);
    }
    return doGetQrGenerator_(e);
  } catch (err) {
    if (typeof createCORSResponse === 'function') {
      return createCORSResponse({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  return doPostQr_(e);
}

function doOptions(e) {
  return doOptionsQr_(e);
}

