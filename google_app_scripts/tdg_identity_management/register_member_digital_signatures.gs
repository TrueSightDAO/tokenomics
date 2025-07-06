/**
 * Google Apps Script to process digital signature events from Telegram logs
 * and register them in the Contributors Digital Signatures sheet.
 */

// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const DIGITAL_SIGNATURES_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=577022511#gid=577022511';
const DIGITAL_SIGNATURES_SHEET_NAME = 'Contributors Digital Signatures';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';

// Telegram API configuration
const TELEGRAM_BOT_TOKEN = creds.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = creds.TELEGRAM_CHAT_ID; // Channel/group ID for notifications

// Column indices for source sheet (Telegram Chat Logs)
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B (Telegram Chat ID)
const CHAT_NAME_COL = 2; // Column C (Telegram Chatroom Name)
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E (Reporter Name)
const MESSAGE_COL = 6; // Column G (Message Content)

// Column indices for Digital Signatures sheet
const DS_CONTRIBUTOR_NAME_COL = 0; // Column A
const DS_CREATED_DATE_COL = 1; // Column B
const DS_LAST_ACTIVE_COL = 2; // Column C
const DS_STATUS_COL = 3; // Column D
const DS_SIGNATURE_COL = 4; // Column E

// Column indices for Contributors sheet
const TELEGRAM_HANDLE_COL_CONTRIBUTORS = 7; // Column H (Telegram Handle)
const FULL_NAME_COL_CONTRIBUTORS = 0; // Column A (Full Name)

/**
 * Main function to parse and process Telegram logs for digital signature events
 */
function processDigitalSignatureEvents() {
  try {
    // Get source and digital signatures spreadsheets
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const digitalSignaturesSpreadsheet = SpreadsheetApp.openByUrl(DIGITAL_SIGNATURES_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    const digitalSignaturesSheet = digitalSignaturesSpreadsheet.getSheetByName(DIGITAL_SIGNATURES_SHEET_NAME);
    
    // Get data from source and digital signatures sheets
    const sourceData = sourceSheet.getDataRange().getValues();
    const digitalSignaturesData = digitalSignaturesSheet.getDataRange().getValues();
    
    // Get existing signatures to check for duplicates
    const existingSignatures = digitalSignaturesData.slice(1).map(row => row[DS_SIGNATURE_COL]).filter(sig => sig);
    
    let newEntries = 0;
    
    // Pattern for Digital Signature Event
    const signaturePattern = /\[DIGITAL SIGNATURE EVENT\][\s\S]*?DIGITAL SIGNATURE: ([^\s]+)/i;
    
    // Process source data, skipping header row
    for (let i = 1; i < sourceData.length; i++) {
      const message = sourceData[i][MESSAGE_COL];
      
      // Check if message matches the signature pattern
      const signatureMatch = message.match(signaturePattern);
      if (!signatureMatch) {
        continue; // Skip if not a signature event
      }
      
      const signature = signatureMatch[1];
      
      // Skip if signature already exists
      if (existingSignatures.includes(signature)) {
        Logger.log(`Skipping row ${i + 1} - signature already exists`);
        continue;
      }
      
      // Resolve contributor name from Telegram handle
      const telegramHandle = sourceData[i][CONTRIBUTOR_NAME_COL];
      const contributorName = resolveContributorName(telegramHandle);
      
      if (!contributorName) {
        Logger.log(`Skipping row ${i + 1} - could not resolve contributor name for handle: ${telegramHandle}`);
        continue;
      }
      
      // Get current timestamp
      const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      
      // Prepare row for Digital Signatures sheet
      const rowToAppend = [
        contributorName, // Column A: Contributor Name
        timestamp,       // Column B: Created Date
        timestamp,       // Column C: Last Active
        "ACTIVE",        // Column D: Status
        signature        // Column E: Digital Signature
      ];
      
      // Append to Digital Signatures sheet
      const lastRow = digitalSignaturesSheet.getLastRow();
      digitalSignaturesSheet.getRange(lastRow + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
      
      // Send Telegram notification
      sendTelegramNotification(
        sourceData[i][CHAT_ID_COL],
        `✅ Digital signature registered for ${contributorName}\n\n` +
        `Signature: ${signature.substring(0, 20)}...\n` +
        `Registered by: @${telegramHandle.replace(/^@/, '')}`
      );
      
      // Update existing signatures and increment counter
      existingSignatures.push(signature);
      newEntries++;
      
      Logger.log(`Processed row ${i + 1} - added signature for ${contributorName}`);
    }
    
    Logger.log(`Processed ${sourceData.length - 1} rows, added ${newEntries} new digital signatures.`);
  } catch (e) {
    Logger.log(`Error in processDigitalSignatureEvents: ${e.message}`);
  }
}

/**
 * Resolves Telegram handle to contributor full name
 * @param {string} telegramHandle - The Telegram handle to resolve
 * @return {string|null} The contributor's full name or null if not found
 */
function resolveContributorName(telegramHandle) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    // Normalize telegram handle for comparison
    const normalizedHandle = telegramHandle.toLowerCase().replace(/^@/, '');
    
    // Skip header row
    for (let i = 1; i < contributorsData.length; i++) {
      const handle = contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS];
      if (handle) {
        // Normalize stored handle for comparison
        const normalizedStoredHandle = handle.toLowerCase().replace(/^@/, '');
        if (normalizedStoredHandle === normalizedHandle) {
          return contributorsData[i][FULL_NAME_COL_CONTRIBUTORS]; // Return full name
        }
      }
    }
    
    Logger.log(`Could not resolve contributor name for handle: ${telegramHandle}`);
    return null;
  } catch (e) {
    Logger.log(`Error resolving contributor name: ${e.message}`);
    return null;
  }
}

/**
 * Sends a notification to Telegram
 * @param {string} chatId - The Telegram chat ID to send to
 * @param {string} message - The message to send
 */
function sendTelegramNotification(chatId, message) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !chatId) {
      Logger.log("Telegram bot token or chat ID not configured - skipping notification");
      return;
    }
    
    const payload = {
      method: "sendMessage",
      chat_id: chatId,
      text: message,
      parse_mode: "HTML"
    };
    
    const options = {
      method: "post",
      payload: payload,
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (!responseData.ok) {
      Logger.log(`Telegram API error: ${responseData.description}`);
    }
  } catch (e) {
    Logger.log(`Error sending Telegram notification: ${e.message}`);
  }
}