/**
 * File: google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Processes QR code status and email updates from Telegram Chat Logs.
 * Reads from "Telegram Chat Logs" sheet where Column G contains [QR CODE UPDATE EVENT],
 * extracts QR code, status, and email information, then updates the "Agroverse QR codes" sheet.
 * 
 * Security: This script only reads from "Telegram Chat Logs" (not from URL parameters)
 * to prevent unauthorized updates. The doGet handler does not accept parameters.
 * 
 * Deployment URL: https://script.google.com/a/macros/agroverse.shop/s/AKfycbxMz8cAkJ-MT3FhxRc9SxLZZzm7J83-EZPnv5M7V_9QHKywC3aKUeaR2tqELheq3e7X/exec
 */

// Deployment URL: https://script.google.com/a/macros/agroverse.shop/s/AKfycbxMz8cAkJ-MT3FhxRc9SxLZZzm7J83-EZPnv5M7V_9QHKywC3aKUeaR2tqELheq3e7X/exec

// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const DESTINATION_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231';
const DESTINATION_SHEET_NAME = 'Agroverse QR codes';

// Column indices for source sheet (Telegram Chat Logs)
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B
const CHAT_NAME_COL = 2; // Column C
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E
const PROJECT_NAME_COL = 5; // Column F
const MESSAGE_COL = 6; // Column G (Contribution Made)
const STATUS_COL = 9; // Column J (Status)

// Column indices for destination sheet (Agroverse QR codes)
const QR_CODE_COL = 0; // Column A (qr_code)
const STATUS_COL_DEST = 3; // Column D (status)
const EMAIL_COL_DEST = 11; // Column L (Owner Email)
const MANAGER_COL_DEST = 20; // Column U (Manager Name)

// Event marker
const EVENT_MARKER = '[QR CODE UPDATE EVENT]';

/**
 * doGet handler for webhook triggers
 * Security: No parameters accepted - reads only from Telegram Chat Logs sheet
 * @param {Object} e Event object (parameters ignored for security)
 * @return {ContentService.TextOutput} Response indicating processing status
 */
function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'processQrCodeUpdatesFromTelegramChatLogs') {
    try {
      Logger.log("Webhook triggered: processing QR code updates from Telegram Chat Logs");
      const result = processQrCodeUpdatesFromTelegramChatLogs();
      return ContentService.createTextOutput(`✅ QR code updates processed: ${result.processed} updated, ${result.skipped} skipped, ${result.errors} errors`);
    } catch (err) {
      Logger.log("Error in processQrCodeUpdatesFromTelegramChatLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified. Use ?action=processQrCodeUpdatesFromTelegramChatLogs");
}

/**
 * Main processing function that reads from Telegram Chat Logs and updates Agroverse QR codes
 * Only processes rows where:
 * - Column G contains [QR CODE UPDATE EVENT]
 * - Column J (Status) is "Pending", "NEW", or empty
 * 
 * @return {Object} Processing result with counts
 */
function processQrCodeUpdatesFromTelegramChatLogs() {
  const result = {
    processed: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  try {
    // Open source spreadsheet (Telegram Chat Logs)
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    
    if (!sourceSheet) {
      throw new Error(`Sheet "${SOURCE_SHEET_NAME}" not found in ${SOURCE_SHEET_URL}`);
    }

    // Open destination spreadsheet (Agroverse QR codes)
    const destSpreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
    const destSheet = destSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
    
    if (!destSheet) {
      throw new Error(`Sheet "${DESTINATION_SHEET_NAME}" not found in ${DESTINATION_SHEET_URL}`);
    }

    // Get all data from source sheet (starting from row 2, which is the header row)
    const sourceData = sourceSheet.getDataRange().getValues();
    if (sourceData.length < 2) {
      Logger.log("No data rows found in Telegram Chat Logs");
      return result;
    }

    // Get destination sheet data for QR code lookup
    const destData = destSheet.getDataRange().getValues();
    if (destData.length < 2) {
      Logger.log("No data rows found in Agroverse QR codes sheet");
      return result;
    }

    Logger.log(`Processing ${sourceData.length - 1} rows from Telegram Chat Logs`);

    // Process each row (skip header row at index 0)
    for (let i = 1; i < sourceData.length; i++) {
      const row = sourceData[i];
      const rowNumber = i + 1; // Actual row number in spreadsheet (1-based)

      try {
        const message = (row[MESSAGE_COL] || '').toString();
        const status = (row[STATUS_COL] || '').toString().trim().toUpperCase();

        // Skip rows that don't contain the event marker
        if (!message.includes(EVENT_MARKER)) {
          continue;
        }

        // Skip rows that are already processed
        if (status !== '' && status !== 'PENDING' && status !== 'NEW') {
          Logger.log(`Row ${rowNumber}: Skipping - already processed (status: ${status})`);
          result.skipped++;
          continue;
        }

        // Extract QR code, status, and email from the message
        const extracted = extractQrCodeUpdateInfo(message);
        
        if (!extracted.qrCode) {
          Logger.log(`Row ${rowNumber}: Skipping - no QR code found in message`);
          result.skipped++;
          continue;
        }

        // Find the QR code in the destination sheet
        let qrCodeRowIndex = -1;
        for (let j = 1; j < destData.length; j++) {
          if ((destData[j][QR_CODE_COL] || '').toString().trim() === extracted.qrCode) {
            qrCodeRowIndex = j + 1; // Actual row number (1-based)
            break;
          }
        }

        if (qrCodeRowIndex === -1) {
          Logger.log(`Row ${rowNumber}: Error - QR code "${extracted.qrCode}" not found in Agroverse QR codes sheet`);
          result.errors++;
          result.details.push({
            row: rowNumber,
            qrCode: extracted.qrCode,
            error: 'QR code not found in Agroverse QR codes sheet'
          });
          continue;
        }

        // Update the destination sheet
        let updatesMade = false;

        if (extracted.status) {
          // Update status (Column D, index 3)
          destSheet.getRange(qrCodeRowIndex, STATUS_COL_DEST + 1).setValue(extracted.status);
          Logger.log(`Row ${rowNumber}: Updated status for QR code "${extracted.qrCode}" to "${extracted.status}"`);
          updatesMade = true;
        }

        if (extracted.email) {
          // Update email (Column L, index 11)
          destSheet.getRange(qrCodeRowIndex, EMAIL_COL_DEST + 1).setValue(extracted.email);
          Logger.log(`Row ${rowNumber}: Updated email for QR code "${extracted.qrCode}" to "${extracted.email}"`);
          updatesMade = true;
        }

        if (extracted.member) {
          // Update manager name (Column U, index 20)
          destSheet.getRange(qrCodeRowIndex, MANAGER_COL_DEST + 1).setValue(extracted.member);
          Logger.log(`Row ${rowNumber}: Updated manager name for QR code "${extracted.qrCode}" to "${extracted.member}"`);
          updatesMade = true;
        }

        if (updatesMade) {
          // Mark the source row as processed
          sourceSheet.getRange(rowNumber, STATUS_COL + 1).setValue('PROCESSED');
          result.processed++;
          result.details.push({
            row: rowNumber,
            qrCode: extracted.qrCode,
            status: extracted.status || '(no change)',
            email: extracted.email || '(no change)',
            member: extracted.member || '(no change)',
            success: true
          });
        } else {
          Logger.log(`Row ${rowNumber}: No updates made for QR code "${extracted.qrCode}" (no status, email, or member provided)`);
          result.skipped++;
        }

      } catch (err) {
        Logger.log(`Row ${rowNumber}: Error processing - ${err.message}`);
        result.errors++;
        result.details.push({
          row: rowNumber,
          error: err.message
        });
      }
    }

    // Save changes to both sheets
    SpreadsheetApp.flush();

    Logger.log(`Processing complete: ${result.processed} updated, ${result.skipped} skipped, ${result.errors} errors`);
    return result;

  } catch (error) {
    Logger.log(`Error in processQrCodeUpdatesFromTelegramChatLogs: ${error.message}`);
    throw error;
  }
}

/**
 * Extracts QR code, status, email, and member from a message containing [QR CODE UPDATE EVENT]
 * Expected format:
 * [QR CODE UPDATE EVENT]
 * - QR Code: <qr_code>
 * - Associated Member: <member> (optional)
 * - New Status: <status> (optional)
 * - New Email: <email> (optional)
 * - Updated by: <name>
 * - Submission Source: <url>
 * --------
 * 
 * @param {string} message The message text from Telegram Chat Logs
 * @return {Object} Extracted information {qrCode, member, status, email}
 */
function extractQrCodeUpdateInfo(message) {
  const result = {
    qrCode: null,
    member: null,
    status: null,
    email: null
  };

  try {
    // Extract QR Code
    const qrCodeMatch = message.match(/- QR Code:\s*([^\n]+)/i);
    if (qrCodeMatch) {
      result.qrCode = qrCodeMatch[1].trim();
    }

    // Extract Associated Member (optional)
    const memberMatch = message.match(/- Associated Member:\s*([^\n]+)/i);
    if (memberMatch) {
      result.member = memberMatch[1].trim();
    }

    // Extract New Status (optional)
    const statusMatch = message.match(/- New Status:\s*([^\n]+)/i);
    if (statusMatch) {
      const statusValue = statusMatch[1].trim().toUpperCase();
      // Validate status values
      const validStatuses = ['ACTIVE', 'SOLD', 'MINTED', 'CONSIGNMENT'];
      if (validStatuses.includes(statusValue)) {
        result.status = statusValue;
      } else {
        Logger.log(`Warning: Invalid status value "${statusValue}" - skipping status update`);
      }
    }

    // Extract New Email (optional)
    const emailMatch = message.match(/- New Email:\s*([^\n@]+@[^\n@]+\.[^\n@]+)/i);
    if (emailMatch) {
      result.email = emailMatch[1].trim();
    }

  } catch (err) {
    Logger.log(`Error extracting QR code update info: ${err.message}`);
  }

  return result;
}

/**
 * Cron-triggered function for periodic processing
 * Set up a time-driven trigger in Apps Script to run this function periodically
 * (e.g., every 5 minutes or hourly)
 */
function processQrCodeUpdatesCron() {
  Logger.log(`Cron-triggered QR code update processing started at ${new Date().toISOString()}`);
  try {
    const result = processQrCodeUpdatesFromTelegramChatLogs();
    Logger.log(`Cron processing complete: ${result.processed} updated, ${result.skipped} skipped, ${result.errors} errors`);
    return result;
  } catch (error) {
    Logger.log(`Cron processing error: ${error.message}`);
    throw error;
  }
}

