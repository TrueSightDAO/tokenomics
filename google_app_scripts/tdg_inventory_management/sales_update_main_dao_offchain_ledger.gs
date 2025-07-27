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
const DEST_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=995916231#gid=995916231';
const DEST_SHEET_NAME = 'offchain transactions';

// Column indices for source sheet (Scored Chatlogs)
const DEST_QR_CODE_COL = 4; // Column E (QR Code)
const AGROVERSE_VALUE_COL = 6; // Column G
const SALES_DATE_COL = 7; // Column H
const INVENTORY_TYPE_COL = 8; // Column I
const TOKENIZED_STATUS_COL = 9; // Column J
const OFFCHAIN_ROW_NUMS_COL = 10; // Column K
const MESSAGE_COL = 2; // Column C
const CONTRIBUTOR_NAME_COL = 3; // Column D
const SALE_PRICE_COL = 5; // Column F

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'processTokenizedTransactions') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      processTokenizedTransactions();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}


// Function to send Telegram notification for completed transactions
function sendTransactionCompletionNotification(qrCode, contributorName) {
  const token = creds.TELEGRAM_API_TOKEN;
  const chatId = '-1002190388985'; // Fixed chat ID as specified
  if (!token) {
    Logger.log(`sendTransactionCompletionNotification: Error: TELEGRAM_API_TOKEN not set in Credentials`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const baseOutputSheetLink = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=995916231#gid=995916231';
  const timestamp = new Date().getTime();
  const outputSheetLink = `${baseOutputSheetLink}&ts=${timestamp}`;

  const messageText = `${qrCode}\n\n Transactions for QR code by ${contributorName} have been completed and recorded in the offchain transactions sheet. \n\nReview here: http://truesight.me/physical-assets/`;

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
    Logger.log(`sendTransactionCompletionNotification: Sending notification for QR code ${qrCode} to chat ${chatId}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendTransactionCompletionNotification: Successfully sent notification for QR code ${qrCode} to chat ${chatId}`);
    } else {
      Logger.log(`sendTransactionCompletionNotification: Failed to send notification for QR code ${qrCode}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendTransactionCompletionNotification: Error sending Telegram notification for QR code ${qrCode}: ${e.message}`);
  }
}

// Function to process Scored Chatlogs and update offchain transactions
function processTokenizedTransactions() {
  // Get source and destination spreadsheets
  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const destSpreadsheet = SpreadsheetApp.openByUrl(DEST_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  const destSheet = destSpreadsheet.getSheetByName(DEST_SHEET_NAME);
  
  // Get data from source sheet
  const sourceData = sourceSheet.getDataRange().getValues();
  
  // Counter for processed rows
  let processedRows = 0;
  
  // Process source data, skipping header row
  for (let i = 1; i < sourceData.length; i++) {
    const agroverseValue = sourceData[i][AGROVERSE_VALUE_COL];
    const tokenizedStatus = sourceData[i][TOKENIZED_STATUS_COL];
    
    // Check if Column G is "https://www.agroverse.shop/agl4" and Column J is empty
    if (agroverseValue === 'https://www.agroverse.shop/agl4' && (!tokenizedStatus || tokenizedStatus === '')) {
      // Update Column J to "PROCESSING"
      sourceSheet.getRange(i + 1, TOKENIZED_STATUS_COL + 1).setValue('PROCESSING');
      
      // Get values for offchain transactions
      const qrCode = sourceData[i][DEST_QR_CODE_COL] || '';
      const salesDate = sourceData[i][SALES_DATE_COL] || '';
      const message = sourceData[i][MESSAGE_COL] || '';
      const contributorName = sourceData[i][CONTRIBUTOR_NAME_COL] || '';
      const salePrice = sourceData[i][SALE_PRICE_COL] || 0;
      const inventoryType = sourceData[i][INVENTORY_TYPE_COL] || '';
      
      // Get the current last row in destination sheet
      const destLastRow = destSheet.getLastRow();
      const insertRow = destLastRow + 1; // Append after last row
      
      // Prepare three rows to insert
      const rowsToInsert = [
        // First row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Message
          contributorName, // Column C: Contributor Name
          -1, // Column D: -1
          inventoryType, // Column E: Inventory Type
          '', // Column F: Empty
          true // Column G: TRUE
        ],
        // Second row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Message
          contributorName, // Column C: Contributor Name
          salePrice, // Column D: Sale Price
          'USD', // Column E: USD
          '', // Column F: Empty
          true // Column G: TRUE
        ],
        // Third row
        [
          salesDate, // Column A: Sales Date
          message, // Column B: Message
          'SunMint Tree Planting Contract - agl4', // Column C: Fixed value
          1, // Column D: 1
          'Cacao Tree To Be Planted', // Column E: Fixed value
          '', // Column F: Empty
          true // Column G: TRUE
        ]
      ];
      
      // Append the three rows at the end of the destination sheet
      destSheet.getRange(insertRow, 1, 3, rowsToInsert[0].length).setValues(rowsToInsert);
      
      // Get row numbers (1-based) for the inserted rows
      const rowNumbers = [insertRow, insertRow + 1, insertRow + 2].join(',');
      
      // Update Column K in source sheet with row numbers
      sourceSheet.getRange(i + 1, OFFCHAIN_ROW_NUMS_COL + 1).setValue(rowNumbers);
      
      // Update Column J to "TOKENIZED"
      sourceSheet.getRange(i + 1, TOKENIZED_STATUS_COL + 1).setValue('TOKENIZED');
      
      // Send Telegram notification for completed transaction
      if (qrCode) {
        sendTransactionCompletionNotification(qrCode, contributorName);
      } else {
        Logger.log(`No QR code found for row ${i + 1}, skipping notification`);
      }
      
      processedRows++;
      Logger.log(`Processed row ${i + 1}: Updated TOKENIZED status and appended rows ${rowNumbers} in offchain transactions`);
    }
  }
  
  Logger.log(`Processed ${sourceData.length - 1} rows, updated ${processedRows} records.`);
}

// Function to run the script manually or set up a trigger
function setupTrigger() {
  ScriptApp.newTrigger('processTokenizedTransactions')
    .timeBased()
    .everyHours(1)
    .create();
}