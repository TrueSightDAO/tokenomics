/**
 * File: google_app_scripts/agroverse_qr_codes/process_qr_code_updates.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1UrBgqLnnQc6PV4-gMIDh2SYwWu62wTdSrV30xk9q_eVr2UdoxdzXN38v/edit
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
const TRACKING_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=408450426#gid=408450426';
const TRACKING_SHEET_NAME = 'QR Code Update';
const DESTINATION_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231';
const DESTINATION_SHEET_NAME = 'Agroverse QR codes';
/** Stripe checkout tab (same title as web_app.gs; distinct const so multi-file GAS projects do not clash). */
const QR_CODE_UPDATE_STRIPE_CHECKOUT_TAB = 'Stripe Social Media Checkout ID';
const STRIPE_COL_SESSION = 3;
const STRIPE_COL_SHIPPING = 13;
const STRIPE_COL_TRACKING = 14;
const STRIPE_COL_QR = 16;

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
 * "QR Code Update" tracker tab — full header row (A–K). Legacy 8-column sheets get I–K appended on first run.
 */
const QR_UPDATE_TRACKING_HEADERS = [
  'Row Number',
  'Telegram Update ID',
  'QR Code',
  'Status Updated',
  'Email Updated',
  'Member Updated',
  'Processed Timestamp',
  'Processed By',
  'Stripe Session ID',
  'Shipping Provider',
  'Tracking Number'
];

/**
 * Ensures row 1 of the tracking sheet includes Stripe columns (appends I–K if missing).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureQrUpdateTrackingHeaders_(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  const width = Math.max(lastCol, QR_UPDATE_TRACKING_HEADERS.length);
  const row1 = sheet.getRange(1, 1, 1, width).getValues()[0];
  const labels = row1.map((c) => (c || '').toString().trim());
  const hasStripe = labels.some((h) => h === 'Stripe Session ID');
  if (hasStripe) return;
  // If row 1 is empty, write full header row; else append last 3 column titles after existing cells.
  const allEmpty = labels.every((h) => !h);
  if (allEmpty && sheet.getLastRow() <= 1) {
    sheet.getRange(1, 1, 1, QR_UPDATE_TRACKING_HEADERS.length).setValues([QR_UPDATE_TRACKING_HEADERS]);
    sheet.getRange(1, 1, 1, QR_UPDATE_TRACKING_HEADERS.length).setFontWeight('bold');
    return;
  }
  const stripeTitles = ['Stripe Session ID', 'Shipping Provider', 'Tracking Number'];
  const appendAt = Math.max(lastCol + 1, 9);
  // getRange(row, column, numRows, numColumns) — 3rd/4th args are sizes, not end row/column.
  const nc = stripeTitles.length;
  sheet.getRange(1, appendAt, 1, nc).setValues([stripeTitles]);
  sheet.getRange(1, appendAt, 1, nc).setFontWeight('bold');
}

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

    // Open tracking spreadsheet (QR Code Update)
    const trackingSpreadsheet = SpreadsheetApp.openByUrl(TRACKING_SHEET_URL);
    let trackingSheet = trackingSpreadsheet.getSheetByName(TRACKING_SHEET_NAME);
    
    // Create tracking sheet if it doesn't exist
    if (!trackingSheet) {
      trackingSheet = trackingSpreadsheet.insertSheet(TRACKING_SHEET_NAME);
      trackingSheet.getRange(1, 1, 1, QR_UPDATE_TRACKING_HEADERS.length).setValues([QR_UPDATE_TRACKING_HEADERS]);
      trackingSheet.getRange(1, 1, 1, QR_UPDATE_TRACKING_HEADERS.length).setFontWeight('bold');
    } else {
      ensureQrUpdateTrackingHeaders_(trackingSheet);
    }

    // Get processed row numbers from tracking sheet
    const trackingData = trackingSheet.getDataRange().getValues();
    const processedRowNumbers = new Set();
    const processedTelegramUpdateIds = new Set();
    
    // Skip header row (index 0)
    for (let t = 1; t < trackingData.length; t++) {
      const rowNum = trackingData[t][0]; // Column A: Row Number
      const telegramUpdateId = trackingData[t][1]; // Column B: Telegram Update ID
      if (rowNum) {
        processedRowNumbers.add(Number(rowNum));
      }
      if (telegramUpdateId) {
        processedTelegramUpdateIds.add(telegramUpdateId.toString());
      }
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
      const telegramUpdateId = (row[TELEGRAM_UPDATE_ID_COL] || '').toString();

      try {
        const message = (row[MESSAGE_COL] || '').toString();
        const status = (row[STATUS_COL] || '').toString().trim().toUpperCase();

        // Skip rows that don't contain the event marker
        if (!message.includes(EVENT_MARKER)) {
          continue;
        }

        // Skip rows that are already processed (check tracking sheet)
        if (processedRowNumbers.has(rowNumber) || (telegramUpdateId && processedTelegramUpdateIds.has(telegramUpdateId))) {
          Logger.log(`Row ${rowNumber}: Skipping - already processed in tracking sheet`);
          result.skipped++;
          continue;
        }

        // Also skip rows that are marked as processed in Telegram Chat Logs (backward compatibility)
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

        // Update the destination sheet (Stripe first so bad Session ID fails before Agroverse writes)
        let updatesMade = false;

        if (extracted.hasStripeUpdate) {
          applyStripeCheckoutLinkForQrCode_(
            destSpreadsheet,
            extracted.qrCode,
            extracted.stripeSessionId,
            extracted.shippingProvider,
            extracted.trackingNumber
          );
          Logger.log(`Row ${rowNumber}: Updated Stripe checkout link for QR code "${extracted.qrCode}"`);
          updatesMade = true;
        }

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
          // Mark the source row as processed in Telegram Chat Logs (backward compatibility)
          sourceSheet.getRange(rowNumber, STATUS_COL + 1).setValue('PROCESSED');
          
          // Record in tracking sheet
          const timestamp = new Date();
          const trackingRow = [
            rowNumber,
            telegramUpdateId,
            extracted.qrCode,
            extracted.status || '',
            extracted.email || '',
            extracted.member || '',
            timestamp.toISOString(),
            'QR Code Update Processor',
            extracted.stripeSessionId || '',
            extracted.shippingProvider || '',
            extracted.trackingNumber || ''
          ];
          trackingSheet.appendRow(trackingRow);
          
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
          const snip = (message || '').substring(0, 550).replace(/\n/g, ' | ');
          Logger.log(`Row ${rowNumber}: No updates made for QR "${extracted.qrCode}" (hasStripe=${extracted.hasStripeUpdate}, status=${!!extracted.status}, email=${!!extracted.email}, member=${!!extracted.member}). Snippet: ${snip}`);
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
 * - Stripe Session ID: <session or empty to unlink> (optional block — include all three lines below to apply)
 * - Shipping Provider: <text> (optional, same block)
 * - Tracking Number: <text> (optional, same block)
 * - Updated by: <name>
 * - Submission Source: <url>
 * --------
 * 
 * @param {string} message The message text from Telegram Chat Logs
 * @return {Object} Extracted information {qrCode, member, status, email, hasStripeUpdate, stripeSessionId, shippingProvider, trackingNumber}
 */
function normalizeStripeUpdateField_(raw) {
  const v = (raw || '').toString().trim();
  if (/^\(none\)$/i.test(v)) return '';
  return v;
}

/**
 * Normalize Telegram/Sheet message text so line-based regexes match (CRLF, unicode dashes, NBSP).
 * @param {string} raw
 * @return {string}
 */
function normalizeQrUpdateMessageForParsing_(raw) {
  let m = (raw || '').toString();
  m = m.replace(/^\uFEFF/, '');
  m = m.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  m = m.replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-');
  m = m.replace(/\u00A0/g, ' ');
  // If the row has no real newlines but JSON-style "\\n", expand so Stripe lines match.
  if (m.indexOf('\n') === -1 && /\\n/.test(m)) {
    m = m.replace(/\\n/g, '\n');
  }
  return m;
}

/**
 * True if the payload includes a Stripe Session ID line (Edgar uses "- Stripe Session ID: …").
 * Allows variable whitespace after the list hyphen and before ":".
 * @param {string} message
 * @return {boolean}
 */
function messageHasStripeSessionLine_(message) {
  return /(?:^|\n)\s*-\s*Stripe Session ID\s*:/i.test(message) ||
    /(?:^|\n)\s*Stripe Session ID\s*:/i.test(message);
}

/**
 * Normalize Stripe Checkout Session IDs for row lookup. Sheet cells may contain only `cs_live_…`,
 * or a formula/URL where the id is embedded; strict string equality often fails otherwise.
 * @param {string} raw
 * @return {string} Canonical id or trimmed original if no match.
 */
function canonicalStripeSessionId_(raw) {
  const s = (raw || '').toString().trim().replace(/^['"]+|['"]+$/g, '');
  if (!s) return '';
  const m = s.match(/\b(cs_(?:live|test)_[A-Za-z0-9_]+)/);
  if (m) return m[1];
  return s;
}

/**
 * Link or update Stripe checkout row (by Session ID) for this QR: sets M, N, P.
 * If session id empty: clears column P on all rows that reference this QR (unlink).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} qrCode
 * @param {string} sessionId
 * @param {string} shippingProvider
 * @param {string} trackingNumber
 */
function applyStripeCheckoutLinkForQrCode_(spreadsheet, qrCode, sessionId, shippingProvider, trackingNumber) {
  const sheet = spreadsheet.getSheetByName(QR_CODE_UPDATE_STRIPE_CHECKOUT_TAB);
  if (!sheet) {
    throw new Error(`Sheet not found: ${QR_CODE_UPDATE_STRIPE_CHECKOUT_TAB}`);
  }
  const qr = (qrCode || '').toString().trim();
  const sessRaw = (sessionId || '').toString().trim();
  const sess = canonicalStripeSessionId_(sessRaw);
  const ship = (shippingProvider || '').toString().trim();
  const track = (trackingNumber || '').toString().trim();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    if (sess) throw new Error('Stripe sheet has no data rows');
    return;
  }

  if (!sess) {
    for (let r = lastRow; r >= 2; r--) {
      const pVal = (sheet.getRange(r, STRIPE_COL_QR).getValue() || '').toString().trim();
      if (pVal === qr) {
        sheet.getRange(r, STRIPE_COL_QR).setValue('');
      }
    }
    return;
  }

  for (let r = lastRow; r >= 2; r--) {
    const pVal = (sheet.getRange(r, STRIPE_COL_QR).getValue() || '').toString().trim();
    const cVal = (sheet.getRange(r, STRIPE_COL_SESSION).getValue() || '').toString().trim();
    const cSess = canonicalStripeSessionId_(cVal);
    if (pVal === qr && cSess !== sess) {
      sheet.getRange(r, STRIPE_COL_QR).setValue('');
    }
  }

  for (let r = lastRow; r >= 2; r--) {
    const cVal = (sheet.getRange(r, STRIPE_COL_SESSION).getValue() || '').toString().trim();
    const cSess = canonicalStripeSessionId_(cVal);
    if (cSess === sess) {
      sheet.getRange(r, STRIPE_COL_SHIPPING).setValue(ship);
      sheet.getRange(r, STRIPE_COL_TRACKING).setValue(track);
      sheet.getRange(r, STRIPE_COL_QR).setValue(qr);
      return;
    }
  }
  throw new Error(`Stripe Session ID not found in ${QR_CODE_UPDATE_STRIPE_CHECKOUT_TAB}: ${sess} (lookup uses canonical cs_live/cs_test id from column C)`);
}

function extractQrCodeUpdateInfo(message) {
  const result = {
    qrCode: null,
    member: null,
    status: null,
    email: null,
    hasStripeUpdate: false,
    stripeSessionId: null,
    shippingProvider: null,
    trackingNumber: null
  };

  try {
    message = normalizeQrUpdateMessageForParsing_(message);

    // Extract QR Code (allow one or more spaces after the list hyphen)
    const qrCodeMatch = message.match(/-\s+QR Code:\s*([^\n]+)/i);
    if (qrCodeMatch) {
      result.qrCode = qrCodeMatch[1].trim();
    }

    // Extract Associated Member (optional)
    const memberMatch = message.match(/-\s+Associated Member:\s*([^\n]+)/i);
    if (memberMatch) {
      result.member = memberMatch[1].trim();
    }

      // Extract New Status (optional)
      const statusMatch = message.match(/-\s+New Status:\s*([^\n]+)/i);
      if (statusMatch) {
        const statusValue = statusMatch[1].trim();
        // Validate status values (preserve original case for statuses with spaces)
        const validStatuses = [
          'SCHEDULED_FOR_MINTING',
          'MINTED',
          'WAREHOUSED',
          'ON CONSIGNMENT',
          'CACAO CIRCLE',
          'LOST',
          'SOLD',
          'EXPENSED',
          'ASSIGNED_TO_TREE',
          'GIFT'
        ];
        const statusValueUpper = statusValue.toUpperCase();
        // Check if status matches (case-insensitive)
        const matchedStatus = validStatuses.find(s => s.toUpperCase() === statusValueUpper);
        if (matchedStatus) {
          result.status = matchedStatus; // Use the canonical form from validStatuses
        } else {
          Logger.log(`Warning: Invalid status value "${statusValue}" - skipping status update`);
        }
      }

    // Extract New Email (optional)
    const emailMatch = message.match(/-\s+New Email:\s*([^\n@]+@[^\n@]+\.[^\n@]+)/i);
    if (emailMatch) {
      result.email = emailMatch[1].trim();
    }

    // Stripe block: session line is required; shipping/tracking may be omitted in some ingest paths.
    if (messageHasStripeSessionLine_(message)) {
      result.hasStripeUpdate = true;
      const sm = message.match(/(?:^|\n)\s*-\s*Stripe Session ID\s*:\s*([^\n]*)/i) ||
        message.match(/(?:^|\n)\s*Stripe Session ID\s*:\s*([^\n]*)/i);
      const hm = message.match(/(?:^|\n)\s*-\s*Shipping Provider\s*:\s*([^\n]*)/i);
      const tm = message.match(/(?:^|\n)\s*-\s*Tracking Number\s*:\s*([^\n]*)/i);
      result.stripeSessionId = normalizeStripeUpdateField_(sm ? sm[1] : '');
      result.shippingProvider = normalizeStripeUpdateField_(hm ? hm[1] : '');
      result.trackingNumber = normalizeStripeUpdateField_(tm ? tm[1] : '');
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

