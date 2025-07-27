// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, URLs, IDs) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// Telegram Bot API token for sending notifications
// - Used to authenticate requests to the Telegram Bot API for sending messages.
// - Example: "7095843169:AAFscsdjnj-AOCV1fhmUp5RN5SliLbQpZaU".
// - Set your own token in Credentials.gs or Script Properties to enable notifications.
// - Obtain this from BotFather on Telegram (https://t.me/BotFather).
const TELEGRAM_TOKEN = creds.TELEGRAM_API_TOKEN;

// Configuration Variables
const SOURCE_SHEET_URL = 'docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=1003674539#gid=1003674539';
const SOURCE_SHEET_NAME = 'QR Code Sales';
const OFFCHAIN_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=995916231#gid=995916231';
const OFFCHAIN_SHEET_NAME = 'offchain transactions';
const DEST_SHEET_NAME = 'Transactions';

// Column indices for source sheet (Scored Chatlogs)
const AGROVERSE_VALUE_COL = 6; // Column G
const SALES_DATE_COL = 7; // Column H
const INVENTORY_TYPE_COL = 8; // Column I
const TOKENIZED_STATUS_COL = 9; // Column J
const OFFCHAIN_ROW_NUMS_COL = 10; // Column K
const MESSAGE_COL = 2; // Column C
const CONTRIBUTOR_NAME_COL = 3; // Column D
const QR_CODE_COL = 4; // Column E
const SALE_PRICE_COL = 5; // Column F

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'processNonAgl4Transactions') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      processNonAgl4Transactions();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}


// Function to resolve redirect URL
function resolveRedirect(url) {
  try {
    let currentUrl = url;
    let redirectCount = 0;
    const maxRedirects = 10;

    while (redirectCount < maxRedirects) {
      const response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();

      // If not a redirect (2xx or other), return the current URL
      if (responseCode < 300 || responseCode >= 400) {
        return currentUrl;
      }

      // Get the Location header for the redirect
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        Logger.log(`No Location header for redirect at ${currentUrl}`);
        return '';
      }

      // Update the current URL and increment redirect count
      currentUrl = location;
      redirectCount++;
    }

    Logger.log(`Exceeded maximum redirects (${maxRedirects}) for URL ${url}`);
    return '';
  } catch (e) {
    Logger.log(`Error resolving redirect for URL ${url}: ${e.message}`);
    return '';
  }
}

// Function to extract AGL contract name from URL
function extractAglContractName(url) {
  const prefix_type_1 = 'https://www.agroverse.shop/';
  const prefix_type_2 = 'https://truesight.me/sunmint/';
  if (url.startsWith(prefix_type_1)) {
    return url.slice(prefix_type_1.length);

  } else if(url.startsWith(prefix_type_2)) {
    return url.slice(prefix_type_2.length);
  }
  return '';
}

// Function to send Telegram notification for completed non-agl4 transactions
function sendNonAgl4TransactionNotification(qrCode, contributorName, aglContractName, destSheetUrl) {
  const token = creds.TELEGRAM_API_TOKEN;
  const chatId = '-1002190388985'; // Fixed chat ID as specified
  if (!token) {
    Logger.log(`sendNonAgl4TransactionNotification: Error: TELEGRAM_API_TOKEN not set in Credentials`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const timestamp = new Date().getTime();
  const outputSheetLink = `${destSheetUrl}&ts=${timestamp}`;

  const messageText = `${qrCode} \n\nTransactions for QR code (${aglContractName}) by ${contributorName} have been completed and recorded in the managed ledger. \n\nReview here: ${outputSheetLink}`;

  const payload = {
    chat_id: chatId,
    text: messageText
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`sendNonAgl4TransactionNotification: Sending notification for QR code ${qrCode} to chat ${chatId}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendNonAgl4TransactionNotification: Successfully sent notification for QR code ${qrCode} to chat ${chatId}`);
    } else {
      Logger.log(`sendNonAgl4TransactionNotification: Failed to send notification for QR code ${qrCode}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendNonAgl4TransactionNotification: Error sending Telegram notification for QR code ${qrCode}: ${e.message}`);
  }
}

// Function to process Scored Chatlogs for non-agl4 transactions
function processNonAgl4Transactions() {
  // Get source and offchain spreadsheets
  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const offchainSpreadsheet = SpreadsheetApp.openByUrl(OFFCHAIN_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  const offchainSheet = offchainSpreadsheet.getSheetByName(OFFCHAIN_SHEET_NAME);
  
  // Get data from source sheet
  const sourceData = sourceSheet.getDataRange().getValues();
  
  // Counter for processed rows
  let processedRows = 0;
  
  // Process source data, skipping header row
  for (let i = 1; i < sourceData.length; i++) {
    const agroverseValue = sourceData[i][AGROVERSE_VALUE_COL];
    const tokenizedStatus = sourceData[i][TOKENIZED_STATUS_COL];
    
    // Check if Column G is not "https://www.agroverse.shop/agl4" and Column J is empty
    if (agroverseValue !== 'https://www.agroverse.shop/agl4' && agroverseValue && (!tokenizedStatus || tokenizedStatus === '')) {
      // Extract AGL contract name
      const aglContractName = extractAglContractName(agroverseValue);
      if (!aglContractName) {
        Logger.log(`Skipping row ${i + 1}: Invalid AGL contract name in ${agroverseValue}`);
        continue;
      }
      
      // Resolve redirect to get destination spreadsheet URL
      const destSheetUrl = resolveRedirect(agroverseValue);
      if (!destSheetUrl || !destSheetUrl.includes('docs.google.com/spreadsheets')) {
        Logger.log(`Skipping row ${i + 1}: Invalid or non-spreadsheet redirect URL ${destSheetUrl}`);
        continue;
      }
      
      // Update Column J to "PROCESSING"
      sourceSheet.getRange(i + 1, TOKENIZED_STATUS_COL + 1).setValue('PROCESSING');
      
      // Get values for transactions
      const salesDate = sourceData[i][SALES_DATE_COL] || '';
      const message = sourceData[i][MESSAGE_COL] || '';
      const contributorName = sourceData[i][CONTRIBUTOR_NAME_COL] || '';
      const salePrice = sourceData[i][SALE_PRICE_COL] || 0;
      const inventoryType = sourceData[i][INVENTORY_TYPE_COL] || '';
      const qrCode = sourceData[i][QR_CODE_COL] || '';
      
      // Open destination spreadsheet and sheet
      let destSheet;
      try {
        const destSpreadsheet = SpreadsheetApp.openByUrl(destSheetUrl);
        destSheet = destSpreadsheet.getSheetByName(DEST_SHEET_NAME);
        if (!destSheet) {
          Logger.log(`Skipping row ${i + 1}: Transactions sheet not found in ${destSheetUrl}`);
          continue;
        }
      } catch (e) {
        Logger.log(`Error accessing destination spreadsheet ${destSheetUrl}: ${e.message}`);
        continue;
      }
      
      // Append two rows to destination Transactions sheet
      const destLastRow = destSheet.getLastRow();
      const destInsertRow = destLastRow + 1;
      
      const destRowsToInsert = [
        // First row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Value
          contributorName, // Column C: Contributor
          -1, // Column D: -1
          inventoryType, // Column E: Inventory Type
          'Assets' // Column F: Assets
        ],
        // Second row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Value
          contributorName, // Column C: Contributor
          salePrice, // Column D: Sale Price
          'USD', // Column E: USD
          'Assets' // Column F: Assets
        ],
        // Third row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Value
          `SunMint Tree Planting Contract - ${aglContractName}`, // Column C
          1, // Column D: 1
          'Cacao Tree To Be Planted', // Column E: Cacao Tree To Be Planted
          'Liability' // Column F: Liability
        ]
      ];
      
      destSheet.getRange(destInsertRow, 1, 3, destRowsToInsert[0].length).setValues(destRowsToInsert);
      
      // Get row numbers (1-based) for the inserted rows
      const rowNumbers = [destInsertRow, destInsertRow + 1, destInsertRow + 2].join(',');
      
      // Update Column K in source sheet with row numbers
      sourceSheet.getRange(i + 1, OFFCHAIN_ROW_NUMS_COL + 1).setValue(rowNumbers);
      
      // Update Column J to "ACCOUNTED"
      sourceSheet.getRange(i + 1, TOKENIZED_STATUS_COL + 1).setValue('ACCOUNTED');
      
      // Send Telegram notification for completed non-agl4 transaction
      if (qrCode) {
        sendNonAgl4TransactionNotification(qrCode, contributorName, aglContractName, destSheetUrl);
      } else {
        Logger.log(`No QR code found for row ${i + 1}, skipping notification`);
      }
      
      processedRows++;
      Logger.log(`Processed row ${i + 1}: Updated ACCOUNTED status and appended rows ${rowNumbers} in managed ledger transactions`);
    }
  }
  
  Logger.log(`Processed ${sourceData.length - 1} rows, updated ${processedRows} records.`);
}

// Function to run the script manually or set up a trigger
function setupTrigger() {
  ScriptApp.newTrigger('processNonAgl4Transactions')
    .timeBased()
    .everyHours(1)
    .create();
}