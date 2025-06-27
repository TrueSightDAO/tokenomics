// Load API keys and configuration settings from Credentials.gs
// - setApiKeys(): Stores sensitive API keys in Google Apps Script’s Script Properties for security.
// - getCredentials(): Retrieves all configuration details (API keys, URLs, IDs) as an object.
// - These steps ensure keys and settings are centralized and not hardcoded here.
setApiKeys();
const creds = getCredentials();

// API key for xAI’s API (e.g., for Grok model access)
// - Used to authenticate requests to xAI’s services.
// - Retrieved from Credentials.gs or Script Properties.
const XAI_API_KEY = creds.XAI_API_KEY;

// Telegram Bot API token for sending notifications
// - Used to authenticate requests to the Telegram Bot API for sending messages.
// - Example: "7095843169:AAFscsdjnj-AOCV1fhmUp5RN5SliLbQpZaU".
// - Set your own token in Credentials.gs or Script Properties to enable notifications.
// - Obtain this from BotFather on Telegram (https://t.me/BotFather).
const TELEGRAM_TOKEN = creds.TELEGRAM_API_TOKEN;

// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const DESTINATION_SHEET_URL = 'https://docs.google.com/spreadsheets/d/18bAVJfV-u57LBUgnCKB4kg65YOzvTfR3PZJ5WS9IVos/edit?gid=0#gid=0';
const DESTINATION_SHEET_NAME = 'Scored Chatlogs';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const AGROVERSE_QR_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231';
const AGROVERSE_QR_SHEET_NAME = 'Agroverse QR codes';
const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';

// Column indices for source sheet
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B (Telegram Chat ID)
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E (must match Contributors Column H)
const MESSAGE_COL = 6; // Column G
const SALES_DATE_COL = 11; // Column L

// Column indices for destination sheet
const DEST_MESSAGE_ID_COL = 1; // Column B (for duplicate checking)
const DEST_QR_CODE_COL = 4; // Column E (for QR code duplicate checking)

// Column indices for contributors sheet
const CONTRIBUTOR_NAME_COL_CONTRIBUTORS = 0; // Column A (Reporter Name)
const TELEGRAM_HANDLE_COL_CONTRIBUTORS = 7; // Column H (Telegram Handle)

// Column indices for Agroverse QR codes sheet
const QR_CODE_COL = 0; // Column A
const VALUE_COL = 2; // Column C
const STATUS_COL = 3; // Column D
const INVENTORY_TYPE_COL = 8; // Column I

// Function to check if contributorName is valid (matches Column H in Contributors sheet)
function isValidContributor(contributorName) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < contributorsData.length; i++) {
      const telegramHandle = contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS];
      // Check contributorName as-is and with @ prepended
      if (telegramHandle === contributorName || telegramHandle === `@${contributorName}`) {
        return true;
      }
    }
    Logger.log(`Invalid contributor: ${contributorName} not found in Contributors sheet Column H`);
    return false;
  } catch (e) {
    Logger.log(`Error accessing Contributors sheet for validation: ${e.message}`);
    return false;
  }
}

// Function to get reporter name from Contributors sheet
function getReporterName(telegramHandle, contributorName) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < contributorsData.length; i++) {
      // First, try matching the Telegram handle (if provided) in Column H
      if (telegramHandle && contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS] === telegramHandle) {
        return contributorsData[i][CONTRIBUTOR_NAME_COL_CONTRIBUTORS] || contributorName;
      }
      // If no Telegram handle, try matching contributorName in Column A
      if (!telegramHandle && contributorsData[i][CONTRIBUTOR_NAME_COL_CONTRIBUTORS] === contributorName) {
        return contributorsData[i][CONTRIBUTOR_NAME_COL_CONTRIBUTORS] || contributorName;
      }
    }
    
    // If no match in Column A and no Telegram handle, try @contributorName in Column H
    if (!telegramHandle) {
      const handleWithAt = `@${contributorName}`;
      for (let i = 1; i < contributorsData.length; i++) {
        if (contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS] === handleWithAt) {
          return contributorsData[i][CONTRIBUTOR_NAME_COL_CONTRIBUTORS] || contributorName;
        }
      }
    }
    
    // Default to original contributorName if no match found
    return contributorName;
  } catch (e) {
    Logger.log(`Error accessing Contributors sheet: ${e.message}`);
    return contributorName;
  }
}

// Function to get value from Agroverse QR codes sheet based on QR code
function getAgroverseValue(qrCode) {
  try {
    const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
    const agroverseData = agroverseSheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < agroverseData.length; i++) {
      if (agroverseData[i][QR_CODE_COL] === qrCode) {
        return agroverseData[i][VALUE_COL] || '';
      }
    }
    return ''; // Return empty string if no match found
  } catch (e) {
    Logger.log(`Error accessing Agroverse QR codes sheet: ${e.message}`);
    return '';
  }
}

// Function to get inventory type from Agroverse QR codes sheet based on QR code
function getAgroverseInventoryType(qrCode) {
  try {
    const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
    const agroverseData = agroverseSheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < agroverseData.length; i++) {
      if (agroverseData[i][QR_CODE_COL] === qrCode) {
        return agroverseData[i][INVENTORY_TYPE_COL] || '';
      }
    }
    return ''; // Return empty string if no match found
  } catch (e) {
    Logger.log(`Error accessing Agroverse QR codes sheet for inventory type: ${e.message}`);
    return '';
  }
}

// Function to update Agroverse QR codes sheet Column D to "SOLD" for a given QR code
function updateAgroverseQrStatus(qrCode) {
  try {
    const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
    const agroverseData = agroverseSheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < agroverseData.length; i++) {
      if (agroverseData[i][QR_CODE_COL] === qrCode) {
        // Update Column D (index 3) to "SOLD"
        agroverseSheet.getRange(i + 1, STATUS_COL + 1).setValue('SOLD');
        Logger.log(`Updated QR code ${qrCode} to SOLD in Agroverse QR codes sheet`);
        return true;
      }
    }
    Logger.log(`QR code ${qrCode} not found in Agroverse QR codes sheet`);
    return false;
  } catch (e) {
    Logger.log(`Error updating Agroverse QR codes sheet: ${e.message}`);
    return false;
  }
}

// Function to call Grok API to extract QR code and sale price
function callGrokApi(message) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('XAI_API_KEY');
    if (!apiKey) {
      Logger.log('Error: XAI_API_KEY not set in Script Properties');
      return { qrCode: '', salePrice: '' };
    }

    const prompt = `Extract the QR code and sale price from the following message. Return a JSON object with "qr_code" and "sale_price" fields. If not found, return empty strings. 

Examples of QR codes: "2024SJ_20250508_8", "2024SJ_20250515_NIBS_3", "2024PF_20250505_20".
Examples of sale prices: "$25", "$10.50".
QR codes typically appear in patterns like "[QR CODE EVENT] 2024SJ_20250508_8", "qr_code=2024SJ_20250515_NIBS_3", or standalone like "2024PF_20250505_20".
Sale prices appear after "sold for" or "sold by", e.g., "sold for $25" or "sold by @kikiscocoa for $10.50".

Message: "${message}"`;
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'grok-3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200
      })
    };
    
    const response = UrlFetchApp.fetch(XAI_API_URL, options);
    const data = JSON.parse(response.getContentText());
    const extractedData = JSON.parse(data.choices[0].message.content);
    
    return {
      qrCode: extractedData.qr_code || '',
      salePrice: extractedData.sale_price ? parseFloat(extractedData.sale_price.replace('$', '')) : ''
    };
  } catch (e) {
    Logger.log(`Grok API error: ${e.message}`);
    return { qrCode: '', salePrice: '' };
  }
}

// Function to parse and process Telegram chat logs
function parseTelegramChatLogs() {
  // Get source and destination spreadsheets
  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const destinationSpreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  const destinationSheet = destinationSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
  
  // Get data from source and destination sheets
  const sourceData = sourceSheet.getDataRange().getValues();
  const destData = destinationSheet.getDataRange().getValues();
  
  // Get existing Telegram Message IDs from destination sheet to check for duplicates
  const existingMessageIds = destData.slice(1).map(row => row[DEST_MESSAGE_ID_COL]); // Column B
  
  // Initialize existing QR codes from destination sheet
  let existingQrCodes = destData.slice(1).map(row => row[DEST_QR_CODE_COL]).filter(qr => qr); // Column E, filter out empty
  
  // Counter for new entries
  let newEntries = 0;
  
  // Simple patterns for initial matching
  const patterns = [
    /sold for/i,
    /sold by/i,
    /\[QR CODE EVENT\]/i,
    /qr_code=/i
  ];
  
  // Pattern for extracting Telegram handle
  const telegramHandlePattern = /@([A-Za-z0-9_]+)/;
  
  // Parse source data, skipping header row
  for (let i = 1; i < sourceData.length; i++) {
    const message = sourceData[i][MESSAGE_COL];
    const telegramMessageId = sourceData[i][TELEGRAM_MESSAGE_ID_COL];
    
    // Check if message matches any pattern and hasn't been processed
    if (patterns.some(pattern => pattern.test(message)) && !existingMessageIds.includes(telegramMessageId)) {
      // Validate contributorName against Contributors sheet Column H
      const contributorName = sourceData[i][CONTRIBUTOR_NAME_COL];
      if (!isValidContributor(contributorName)) {
        Logger.log(`Skipping row ${i + 1} due to invalid contributor: ${contributorName}`);
        continue;
      }
      
      // Call Grok API to extract QR code and sale price
      const { qrCode, salePrice } = callGrokApi(message);
      
      // If valid data returned, prepare row
      if (qrCode && salePrice) {
        // Check if QR code already exists
        if (existingQrCodes.includes(qrCode)) {
          Logger.log(`Skipping row ${i + 1} due to duplicate QR code: ${qrCode}`);
          continue;
        }
        
        // Extract Telegram handle from message
        const handleMatch = message.match(telegramHandlePattern);
        let telegramHandle = handleMatch ? handleMatch[0] : null; // e.g., "@kikiscocoa" or null
        
        // Get reporter name from Contributors sheet
        const finalContributorName = getReporterName(telegramHandle, contributorName);
        
        // Get sales date from source sheet
        const salesDate = sourceData[i][SALES_DATE_COL] || '';
        
        // Update Agroverse QR codes sheet status to SOLD
        updateAgroverseQrStatus(qrCode);
        
        // Get value from Agroverse QR codes sheet
        const agroverseValue = getAgroverseValue(qrCode);
        
        // Get inventory type from Agroverse QR codes sheet
        const inventoryType = getAgroverseInventoryType(qrCode);
        
        // Prepare row to append
        const rowToAppend = [
          sourceData[i][TELEGRAM_UPDATE_ID_COL], // Column A: Telegram Update ID
          telegramMessageId, // Column B: Telegram Message ID
          message, // Column C: Message
          finalContributorName, // Column D: Contributor Name (from Contributors sheet or fallback)
          qrCode, // Column E: QR Code
          salePrice, // Column F: Sale Price
          agroverseValue, // Column G: Value from Agroverse QR codes Column C
          salesDate, // Column H: Sales Date from source Column L
          inventoryType // Column I: Inventory Type from Agroverse QR codes Column I
        ];
        
        // Append the row to the destination sheet
        destinationSheet.getRange(destinationSheet.getLastRow() + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
        
        // Update existingQrCodes with the new QR code
        existingQrCodes.push(qrCode);
        newEntries++;
        
        // Send Telegram notification for the new QR code
        const chatId = sourceData[i][CHAT_ID_COL] ? sourceData[i][CHAT_ID_COL].toString().trim() : null;
        if (chatId) {
          sendQrCodeNotification(qrCode, finalContributorName, chatId);
        } else {
          Logger.log(`No chat ID found for row ${i + 1}, skipping notification for QR code ${qrCode}`);
        }
        
        Logger.log(`Added row ${i + 1} with QR code: ${qrCode}`);
      }
    }
  }
  
  Logger.log(`Processed ${sourceData.length - 1} rows, added ${newEntries} new entries.`);
}

function sendQrCodeNotification(qrCode, contributorName, chatId) {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log(`sendQrCodeNotification: Error: TELEGRAM_API_TOKEN not set in Credentials`);
    return;
  }

  if (!chatId) {
    Logger.log(`sendQrCodeNotification: Error: chatId not provided for QR code ${qrCode}`);
    return;
  }

  // Get inventory type from Agroverse QR codes sheet
  const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
  const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
  const agroverseData = agroverseSheet.getDataRange().getValues();
  
  let inventoryType = 'Unknown';
  for (let i = 1; i < agroverseData.length; i++) {
    if (agroverseData[i][QR_CODE_COL] === qrCode) {
      inventoryType = agroverseData[i][INVENTORY_TYPE_COL] || 'Unknown';
      break;
    }
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const baseOutputSheetLink = "https://truesight.me/submissions/scored-and-to-be-tokenized";
  const timestamp = new Date().getTime();
  const outputSheetLink = `${baseOutputSheetLink}?ts=${timestamp}`;

  const messageText = `New QR code detected: ${qrCode} (${inventoryType}) by ${contributorName}. Recorded in the Google Sheet. Review here: ${outputSheetLink}`;

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
    Logger.log(`sendQrCodeNotification: Sending notification for QR code ${qrCode} to chat ${chatId}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendQrCodeNotification: Successfully sent notification for QR code ${qrCode} to chat ${chatId}`);
    } else {
      Logger.log(`sendQrCodeNotification: Failed to send notification for QR code ${qrCode}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendQrCodeNotification: Error sending Telegram notification for QR code ${qrCode}: ${e.message}`);
  }
}