/**
 * Google Apps Script for QR Code Generation and Management
 * 
 * This script provides a web service to:
 * 1. Search for products in the "Currencies" sheet
 * 2. Generate QR codes and add them to the "Agroverse QR codes" sheet
 * 3. Handle the complete workflow from product search to QR code generation
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
    
    if (!productName) {
      return createErrorResponse('Missing required parameter: product_name');
    }
    
    switch (action) {
      case 'search':
        return searchProduct(productName);
      case 'generate':
        return generateQRCode(productName);
      default:
        return createErrorResponse('Invalid action. Use "search" or "generate"');
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
  
  return createSuccessResponse({
    action: 'generate',
    product_name: productName,
    qr_code: qrCodeValue,
    row_added: insertRow,
    github_url: GITHUB_REPO_URL + qrCodeValue + '.png'
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
    productData.product_image, // Column P: Product image from column D
    '', // Column Q: (placeholder)
    '', // Column R: (placeholder)
    '', // Column S: (placeholder)
    25 // Column T: Price (default value)
  ];
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
