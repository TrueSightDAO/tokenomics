/**
 * Google Apps Script for QR Code Generation and Management
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
var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit?gid=0#gid=0';

// Production
// var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1552160318#gid=1552160318';

var CURRENCIES_SHEET_NAME = 'Currencies';
var QR_CODES_SHEET_NAME = 'Agroverse QR codes';
var GITHUB_REPO_URL = 'https://github.com/TrueSightDAO/qr_codes/blob/main/';

// ===== Main Web App Function =====
function doGet(e) {
  try {
    // Parse parameters
    var productName = e.parameter.product_name;
    var action = e.parameter.action || 'generate';
    var quantity = parseInt(e.parameter.quantity) || 1; // Number of QR codes to generate
    var digitalSignature = e.parameter.digital_signature; // Digital signature for identification
    var requestorEmail = e.parameter.email; // Optional email for notification
    
    if (!productName) {
      return createErrorResponse('Missing required parameter: product_name');
    }
    
    // Validate quantity
    if (quantity < 1 || quantity > 100) {
      return createErrorResponse('Quantity must be between 1 and 100');
    }
    
    switch (action) {
      case 'search':
        return searchProduct(productName);
      case 'generate':
        return generateBatchQRCodes(productName, quantity, digitalSignature, requestorEmail);
      case 'generate_single':
        return generateQRCode(productName);
      default:
        return createErrorResponse('Invalid action. Use "search", "generate", or "generate_single"');
    }
    
  } catch (error) {
    return createErrorResponse('Error processing request: ' + error.message);
  }
}

// ===== Webhook Endpoint for Python Script =====
function doPost(e) {
  try {
    // Parse JSON payload
    var payload = JSON.parse(e.postData.contents);
    var productName = payload.product_name;
    
    if (!productName) {
      return createErrorResponse('Missing required parameter: product_name');
    }
    
    // Generate QR code record in Google Sheets
    var result = generateQRCode(productName);
    var resultData = JSON.parse(result.getContent());
    
    if (resultData.status === 'success') {
      return createSuccessResponse({
        action: 'webhook_generate',
        product_name: productName,
        qr_code: resultData.data.qr_code,
        row_added: resultData.data.row_added,
        github_url: resultData.data.github_url,
        landing_page: resultData.data.landing_page || '',
        message: 'QR code record created successfully. Python script should now generate the image.'
      });
    } else {
      return result; // Return the error response
    }
    
  } catch (error) {
    return createErrorResponse('Error processing webhook request: ' + error.message);
  }
}

// ===== Product Search Function =====
function searchProduct(productName) {
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
    
    if (currentProductName.toLowerCase().includes(productName.toLowerCase())) {
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
    count: matchingProducts.length
  });
}

// ===== QR Code Generation Function =====
function generateQRCode(productName) {
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
    github_url: GITHUB_REPO_URL + qrCodeValue + '.png',
    webhook_triggered: webhookResult.success,
    webhook_message: webhookResult.message
  });
}

// ===== Batch QR Code Generation Function =====
function generateBatchQRCodes(productName, quantity, digitalSignature, requestorEmail) {
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
  
  // Generate batch information
  var batchId = generateBatchId();
  var zipFileName = generateZipFileName(productName, batchId);
  var generatedRows = [];
  var startRow = findLastNonEmptyRowInColumnA(qrCodesSheet) + 1;
  
  // Generate multiple QR codes
  for (var i = 0; i < quantity; i++) {
    var qrCodeValue = generateQRCodeValue(productData.year);
    var newRowData = createQRCodeRow(qrCodeValue, productData);
    var insertRow = startRow + i;
    
    // Add batch information to the row
    newRowData.push(batchId); // Column U: Batch ID
    newRowData.push(zipFileName); // Column V: Zip file name
    newRowData.push(digitalSignature || ''); // Column W: Digital signature
    newRowData.push(requestorEmail || ''); // Column X: Requestor email
    
    qrCodesSheet.getRange(insertRow, 1, 1, newRowData.length).setValues([newRowData]);
    generatedRows.push({
      qr_code: qrCodeValue,
      row: insertRow,
      github_url: GITHUB_REPO_URL + qrCodeValue + '.png'
    });
  }
  
  // Commit changes
  SpreadsheetApp.flush();
  
  // Trigger GitHub Actions webhook for batch processing
  var webhookResult = triggerBatchGitHubWebhook(startRow, startRow + quantity - 1, zipFileName, digitalSignature, requestorEmail);
  
  return createSuccessResponse({
    action: 'generate_batch',
    product_name: productName,
    quantity: quantity,
    batch_id: batchId,
    zip_file_name: zipFileName,
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
    
    if (currentProductName.toLowerCase() === productName.toLowerCase()) {
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
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
    GITHUB_REPO_URL + qrCodeValue + '.png', // Column K: GitHub URL
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
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
