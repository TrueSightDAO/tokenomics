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
  
  // Add new row to QR codes sheet
  var newRowData = createQRCodeRow(qrCodeValue, productData);
  var lastRow = qrCodesSheet.getLastRow();
  qrCodesSheet.getRange(lastRow + 1, 1, 1, newRowData.length).setValues([newRowData]);
  
  // Commit changes
  SpreadsheetApp.flush();
  
  return createSuccessResponse({
    action: 'generate',
    product_name: productName,
    qr_code: qrCodeValue,
    row_added: lastRow + 1,
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

function findNextRunningNumber(yearPrefix, dateStr) {
  var spreadsheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var qrCodesSheet = spreadsheet.getSheetByName(QR_CODES_SHEET_NAME);
  
  var lastRow = qrCodesSheet.getLastRow();
  if (lastRow < 2) return 1;
  
  var qrCodeColumn = qrCodesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
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
    GITHUB_REPO_URL + qrCodeValue + '.png' // Column K: GitHub URL
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
