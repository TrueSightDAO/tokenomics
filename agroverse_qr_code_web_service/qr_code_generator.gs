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

// ===== Helper Functions =====

// Helper to convert column letter(s) to number
function letterToColumn(letter) {
  var col = 0;
  for (var i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return col;
}

// Get inventory ledger configurations (simplified version)
function getInventoryLedgerConfigs() {
  // For now, return a basic configuration for the main inventory sheet
  // This can be expanded to fetch from Wix like the inventory management system
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

// ===== Main Web App Function =====
function doGet(e) {
  try {
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

// ===== Webhook Endpoint for Python Script =====
function doPost(e) {
  try {
    // Parse JSON payload
    var payload = JSON.parse(e.postData.contents);
    
    // Check if this is a batch QR code request
    if (payload.request_type === 'batch_qr_generation') {
      return handleBatchQRRequest(payload);
    }
    
    // Legacy single QR code request
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
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
  
  // First pass: collect all currencies from the Currencies sheet
  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    var currentProductName = row[0] ? row[0].toString().trim() : '';
    
    if (currentProductName) {
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
  ledgerConfigs.forEach(function(config) {
    try {
      if (!config.ledger_url || !config.ledger_url.includes('docs.google.com/spreadsheets')) {
        Logger.log('Skipping invalid or non-spreadsheet URL: ' + config.ledger_url);
        return;
      }
      
      var ledgerSpreadsheet = SpreadsheetApp.openByUrl(config.ledger_url);
      var ledgerSheet = ledgerSpreadsheet.getSheetByName(config.sheet_name);
      if (!ledgerSheet) return;
      
      var startRow = config.record_start_row;
      var lastLedgerRow = ledgerSheet.getLastRow();
      var numRows = Math.max(0, lastLedgerRow - startRow + 1);
      if (numRows < 1) return;
      
      var nameCol = letterToColumn(config.manager_names_column);
      var assetCol = letterToColumn(config.asset_name_column);
      var qtyCol = letterToColumn(config.asset_quantity_column);
      
      var names = ledgerSheet.getRange(startRow, nameCol, numRows, 1).getValues();
      var assets = ledgerSheet.getRange(startRow, assetCol, numRows, 1).getValues();
      var qtys = ledgerSheet.getRange(startRow, qtyCol, numRows, 1).getValues();
      
      for (var i = 0; i < names.length; i++) {
        var assetName = assets[i][0];
        var quantity = parseFloat(qtys[i][0]) || 0;
        
        // Check if this asset matches any currency in our list
        if (assetName && currencyQuantities[assetName]) {
          currencyQuantities[assetName].total_quantity += quantity;
          currencyQuantities[assetName].ledger_quantities[config.ledger_name] = 
            (currencyQuantities[assetName].ledger_quantities[config.ledger_name] || 0) + quantity;
        }
      }
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
    total_matches: matchingProducts.length
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
function generateBatchQRCodes(currencyName, quantity, digitalSignature, requestorEmail, requestTransactionId, submissionSource) {
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
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
      github_url: GITHUB_REPO_URL + qrCodeValue + '.png'
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
    zip_file_url: GITHUB_REPO_URL.replace('/blob/', '/raw/') + 'batch_files/' + zipFileName,
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
