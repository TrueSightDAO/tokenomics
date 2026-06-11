/**
 * File: google_app_scripts/agroverse_qr_codes/register_single_qr_code.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1N6o00N9VtRK_L3e0NQXEsmC6QME1KObZdmdbJgo0Tbgj_7P-ElNL5THn/edit
 *
 * Description: Single QR code registration endpoint. Called by dao_client via Edgar
 * (or directly via curl) to register one QR code in the Agroverse QR codes sheet
 * and trigger GitHub Actions for branded PNG generation.
 *
 * Usage:
 *   GET ?action=registerSingleQRCode
 *       &qr_code=SFTF_FR_20260612_1
 *       &landing_page=https://agroverse.shop/friends-of-the-rainforest
 *       &farm_name=SF+Tech+Fest
 *       &state=CA
 *       &country=USA
 *       &year=2026
 *       &currency=Friends+of+the+Rainforest
 *       &status=SAMPLE
 *       &manager=Gary+Teh
 *       &creation_date=20260612
 *
 * Returns JSON: { status: "success"|"error", message: "...", qr_code: "..." }
 */

/** Agroverse QR codes spreadsheet (production) */
var AGROVERSE_QR_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231';
var AGROVERSE_QR_SHEET_NAME = 'Agroverse QR codes';

/** GitHub repo for QR code generation webhook */
var GITHUB_REPO = 'TrueSightDAO/tokenomics';

/** Valid status values */
var VALID_STATUSES = ['MINTED', 'SAMPLE', 'SOLD', 'ON CONSIGNMENT', 'EXPENSED', 'ACTIVE'];

/**
 * doGet handler — routes ?action=registerSingleQRCode
 */
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action ? String(e.parameter.action).trim() : '';
    
    if (action === 'registerSingleQRCode') {
      return handleRegisterSingleQRCode(e.parameter);
    }
    
    return jsonResponse_({ status: 'error', message: 'Unknown action. Use ?action=registerSingleQRCode' }, 400);
    
  } catch (err) {
    return jsonResponse_({ status: 'error', message: err && err.message ? err.message : String(err) }, 500);
  }
}

/**
 * Handle single QR code registration
 */
function handleRegisterSingleQRCode(params) {
  // --- Validate required fields ---
  var qrCode = params.qr_code ? String(params.qr_code).trim() : '';
  if (!qrCode) {
    return jsonResponse_({ status: 'error', message: 'Missing required parameter: qr_code' }, 400);
  }
  
  var landingPage = params.landing_page ? String(params.landing_page).trim() : '';
  if (!landingPage) {
    return jsonResponse_({ status: 'error', message: 'Missing required parameter: landing_page' }, 400);
  }
  
  var farmName = params.farm_name ? String(params.farm_name).trim() : '';
  if (!farmName) {
    return jsonResponse_({ status: 'error', message: 'Missing required parameter: farm_name' }, 400);
  }
  
  var state = params.state ? String(params.state).trim() : '';
  var country = params.country ? String(params.country).trim() : '';
  var year = params.year ? String(params.year).trim() : '';
  var currency = params.currency ? String(params.currency).trim() : '';
  var manager = params.manager ? String(params.manager).trim() : '';
  var creationDate = params.creation_date ? String(params.creation_date).trim() : '';
  
  // Validate status
  var status = params.status ? String(params.status).trim().toUpperCase() : 'SAMPLE';
  if (VALID_STATUSES.indexOf(status) === -1) {
    return jsonResponse_({ 
      status: 'error', 
      message: 'Invalid status: ' + status + '. Valid values: ' + VALID_STATUSES.join(', ') 
    }, 400);
  }
  
  // --- Open sheet ---
  var spreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: 'error', message: 'Sheet not found: ' + AGROVERSE_QR_SHEET_NAME }, 500);
  }
  
  // --- Check for duplicate QR code ---
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var existingCodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < existingCodes.length; i++) {
      var existing = existingCodes[i][0] ? String(existingCodes[i][0]).trim() : '';
      if (existing === qrCode) {
        return jsonResponse_({ 
          status: 'error', 
          message: 'QR code already exists: ' + qrCode,
          qr_code: qrCode,
          existing_row: i + 2
        }, 409);
      }
    }
  }
  
  // --- Build row data (columns A-V matching Agroverse QR codes schema) ---
  var today = creationDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var qrCodeLocation = 'https://github.com/TrueSightDAO/tokenomics/tree/main/python_scripts/agroverse_qr_code_generator/package_qr_codes/compiled_' + 
    sanitizeFilename_(farmName) + '_' + qrCode + '.png';
  
  var newRow = [
    qrCode,                    // A: qr_code
    landingPage,               // B: landing_page
    landingPage,               // C: ledger (same as landing page for single QR)
    status,                    // D: status
    farmName,                  // E: farm name
    state,                     // F: state
    country,                   // G: country
    year,                      // H: Year
    currency,                  // I: Currency
    today,                     // J: QR code creation date (YYYYMMDD)
    qrCodeLocation,            // K: QR code location (GitHub URL)
    '',                        // L: Owner Email (empty — filled later)
    '',                        // M: Onboarding Email Sent Date
    '',                        // N: Tree Planting Date
    '',                        // O: Latitude
    '',                        // P: Longitude
    '',                        // Q: Planting Video URL
    '',                        // R: Tree Seedling Photo URL
    '',                        // S: Product Image
    '25',                      // T: Price (default)
    manager,                   // U: Manager Name
    ''                         // V: Ledger Name
  ];
  
  // --- Append row ---
  var insertRow = sheet.getLastRow() + 1;
  sheet.getRange(insertRow, 1, 1, newRow.length).setValues([newRow]);
  SpreadsheetApp.flush();
  
  // --- Trigger GitHub Actions webhook for single QR generation ---
  var webhookResult = triggerSingleQRGitHubWebhook_(qrCode, farmName, status, manager);
  
  Logger.log('Registered QR code: ' + qrCode + ' at row ' + insertRow + 
             ' (webhook: ' + (webhookResult.success ? 'OK' : 'FAILED: ' + webhookResult.message) + ')');
  
  return jsonResponse_({ 
    status: 'success', 
    message: 'QR code registered successfully',
    qr_code: qrCode,
    row: insertRow,
    webhook_triggered: webhookResult.success,
    webhook_message: webhookResult.message
  }, 200);
}

/**
 * Trigger GitHub Actions repository_dispatch for single QR generation
 */
function triggerSingleQRGitHubWebhook_(qrCode, farmName, status, manager) {
  try {
    var githubToken = getGitHubToken_();
    if (!githubToken) {
      return { success: false, message: 'GitHub token not configured' };
    }
    
    var payload = {
      event_type: 'qr-code-single-generation',
      client_payload: {
        qr_code: qrCode,
        farm_name: farmName || '',
        status: status || 'SAMPLE',
        manager: manager || '',
        timestamp: new Date().toISOString()
      }
    };
    
    var url = 'https://api.github.com/repos/' + GITHUB_REPO + '/dispatches';
    var options = {
      method: 'post',
      headers: {
        'Authorization': 'token ' + githubToken,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GoogleAppsScript-SingleQRGenerator'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode === 204) {
      return { success: true, message: 'GitHub webhook triggered for QR: ' + qrCode };
    } else {
      return { success: false, message: 'HTTP ' + responseCode + ': ' + response.getContentText().substring(0, 200) };
    }
    
  } catch (err) {
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}

/**
 * Get GitHub token from Script Properties
 */
function getGitHubToken_() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var token = scriptProperties.getProperty('GITHUB_TOKEN');
  return token || null;
}

/**
 * Sanitize a string for use in filenames
 */
function sanitizeFilename_(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Return a JSON response with proper content type
 */
function jsonResponse_(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
