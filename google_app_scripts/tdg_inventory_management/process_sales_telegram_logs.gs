/**
 * File: google_app_scripts/tdg_inventory_management/process_sales_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1dsWecVwbN0dOvilIz9r8DNt7LD3Ay13V8G9qliow4tZtF5LHsvQOFpF7/edit
 * 
 * Description: Parses and validates sales transactions from Telegram, extracts QR code and price information, and prepares them for ledger updates.
 */

// Deployment URL: https://script.google.com/macros/s/AKfycbzc15gptNmn8Pm726cfeXDnBxbxZ1L31MN6bkfBH7ziiz4gxl87vJXEhAAJJhZ5uAxq/exec

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
const DESTINATION_SHEET_URL = 'docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=1003674539#gid=1003674539';
const DESTINATION_SHEET_NAME = 'QR Code Sales';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const AGROVERSE_QR_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=472328231#gid=472328231';
const AGROVERSE_QR_SHEET_NAME = 'Agroverse QR codes';
/** Main ledger tab: Session ID column C, Shipping Provider column M, Tracking column N, Agroverse QR column P */
const STRIPE_CHECKOUT_SHEET_NAME = 'Stripe Social Media Checkout ID';
const STRIPE_COL_SESSION = 3; // C
const STRIPE_COL_SHIPPING = 13; // M
const STRIPE_COL_TRACKING = 14; // N
const STRIPE_COL_QR = 16; // P
const AGROVERSE_OWNER_EMAIL_COL = 12; // L (1-based for getRange)
const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';

// Column indices for source sheet
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B (Telegram Chat ID)
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E (must match Contributors Column H)
const MESSAGE_COL = 6; // Column G
const SALES_DATE_COL = 11; // Column L

// Column indices for destination sheet (QR Code Sales).
// Column D: legacy “reporter / cash” cell (still populated). L–R: DApp / shipment / attribution (see header row).
const DEST_MESSAGE_ID_COL = 1; // Column B (for duplicate checking)
const DEST_QR_CODE_COL = 4; // Column E (for QR code duplicate checking)
// A–I: written on ingest; J–K reserved for ledger scripts (Status, Ledger lines); L–R extracted fields + remarks.
const DEST_OWNER_EMAIL_COL_INDEX = 11; // Column L
const DEST_STRIPE_SESSION_COL_INDEX = 12; // Column M
const DEST_SHIPPING_PROVIDER_COL_INDEX = 13; // Column N
const DEST_TRACKING_NUM_COL_INDEX = 14; // Column O — tracking number
const DEST_SOLD_BY_COL_INDEX = 15; // Column P — sold by (inventory line for ledger scripts)
const DEST_CASH_PROCEEDS_COL_INDEX = 16; // Column Q — cash collected by (cash line for ledger scripts)
/** Column R — remarks (parser audit, Stripe note, etc.) */
const DEST_REMARKS_COL_INDEX = 17;
/** A–I (9) + J–R (9) when appending to QR Code Sales */
const QR_SALES_APPEND_COL_COUNT = 18;
/** Column J: ledger scripts use empty J for “pending”; IGNORED = parsed, not a sale (skip Grok on rerun). */
const STATUS_IGNORED = 'IGNORED';

/**
 * If row 1 columns L–Q are empty, set headers for extracted [SALES EVENT] fields (report_sales / dapp / Stripe).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureQrSalesExtractedFieldsHeaders_(sheet) {
  if (!sheet) return;
  const rng = sheet.getRange(1, DEST_OWNER_EMAIL_COL_INDEX + 1, 1, DEST_CASH_PROCEEDS_COL_INDEX + 1);
  const existing = rng.getValues()[0];
  var allBlank = true;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i] != null && String(existing[i]).trim() !== '') {
      allBlank = false;
      break;
    }
  }
  if (!allBlank) return;
  rng.setValues([[
    'Owner email',
    'Stripe Session ID',
    'Shipping Provider',
    'Tracking Number',
    'Sold by',
    'Cash Collected By'
  ]]);
  rng.setFontWeight('bold');
}

/** Column J header when blank (tokenization / parser status). */
function ensureQrSalesStatusHeader_(sheet) {
  if (!sheet) return;
  const col = 10; // J (1-based)
  const v = sheet.getRange(1, col).getValue();
  if (v != null && String(v).trim() !== '') return;
  sheet.getRange(1, col).setValue('Status');
  sheet.getRange(1, col).setFontWeight('bold');
}

/** Column R header when blank */
function ensureQrSalesRemarksHeader_(sheet) {
  if (!sheet) return;
  const v = sheet.getRange(1, DEST_REMARKS_COL_INDEX + 1).getValue();
  if (v != null && String(v).trim() !== '') return;
  sheet.getRange(1, DEST_REMARKS_COL_INDEX + 1).setValue('Remarks');
  sheet.getRange(1, DEST_REMARKS_COL_INDEX + 1).setFontWeight('bold');
}

function ensureQrSalesAppendHeaders_(sheet) {
  ensureQrSalesExtractedFieldsHeaders_(sheet);
  ensureQrSalesStatusHeader_(sheet);
  ensureQrSalesRemarksHeader_(sheet);
}

/**
 * Columns J–R after A–I: J = status (blank for new sales; IGNORED when parser records a non-sale),
 * K blank, L–Q DApp / attribution (O tracking, P sold by, Q cash), R remarks.
 */
function buildQrSalesRowTail_(statusJ, ownerEmail, stripeSessionId, shippingProvider, trackingNumber, soldBy, cashProceedsCollectedBy, remarksR) {
  return [
    (statusJ || '').toString(),
    '',
    (ownerEmail || '').toString(),
    (stripeSessionId || '').toString(),
    (shippingProvider || '').toString(),
    (trackingNumber || '').toString(),
    (soldBy || '').toString(),
    (cashProceedsCollectedBy || '').toString(),
    (remarksR || '').toString()
  ];
}

/** Human-readable remark for QR Code Sales column R when Status = IGNORED */
function remarkForIgnoredNoSale_(parseMethod) {
  const m = (parseMethod || '').toString();
  if (m === 'SKIPPED_DUPLICATE_QR') {
    return 'IGNORED: QR in message already on QR Code Sales; structured parse had no sale (Grok skipped).';
  }
  if (m === 'SKIPPED_DUPLICATE_AFTER_GROK') {
    return 'IGNORED: Grok returned a QR already on QR Code Sales.';
  }
  if (m === 'GROK_API') {
    return 'IGNORED: Grok did not return a usable QR + price.';
  }
  if (m === 'GROK_ERROR') {
    return 'IGNORED: Grok API error.';
  }
  if (m === 'SALES_EVENT' || m === 'FAILED') {
    return 'IGNORED: [SALES EVENT] present but QR or price missing after parse.';
  }
  if (m === 'QR_CODE_EVENT') {
    return 'IGNORED: [QR CODE EVENT] present but QR or price missing after parse.';
  }
  if (m === 'NONE') {
    return 'IGNORED: Matched keyword filter; no structured sale and no Grok extraction.';
  }
  if (m === 'ERROR') {
    return 'IGNORED: Structured parse error.';
  }
  return 'IGNORED: No sale extracted (parseMethod=' + m + ').';
}

/**
 * Append a row so Telegram message id (column B) dedupes future runs; Status J = IGNORED; R = remark.
 */
function appendIgnoredQrSalesRow_(destinationSheet, telegramUpdateId, telegramMessageId, message, salesDate, remark) {
  ensureQrSalesAppendHeaders_(destinationSheet);
  const rowToAppend = [
    telegramUpdateId,
    telegramMessageId,
    message,
    '',
    '',
    '',
    '',
    salesDate || '',
    ''
  ].concat(buildQrSalesRowTail_(STATUS_IGNORED, '', '', '', '', '', '', remark));
  if (rowToAppend.length !== QR_SALES_APPEND_COL_COUNT) {
    throw new Error('appendIgnoredQrSalesRow_: expected ' + QR_SALES_APPEND_COL_COUNT + ' columns, got ' + rowToAppend.length);
  }
  destinationSheet.getRange(destinationSheet.getLastRow() + 1, 1, 1, QR_SALES_APPEND_COL_COUNT).setValues([rowToAppend]);
}

// Column indices for contributors sheet
const CONTRIBUTOR_NAME_COL_CONTRIBUTORS = 0; // Column A (Reporter Name)
const TELEGRAM_HANDLE_COL_CONTRIBUTORS = 7; // Column H (Telegram Handle)

// Column indices for Agroverse QR codes sheet
const QR_CODE_COL = 0; // Column A
const VALUE_COL = 2; // Column C
const STATUS_COL = 3; // Column D
const INVENTORY_TYPE_COL = 8; // Column I

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'parseTelegramChatLogs') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      parseTelegramChatLogs();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  } else if (action === 'processSpecificRow') {
    const rowIndex = parseInt(e.parameter?.rowIndex, 10);
    if (isNaN(rowIndex) || rowIndex < 2) {
      Logger.log(`Invalid rowIndex: ${e.parameter?.rowIndex}`);
      return ContentService.createTextOutput("❌ Error: Invalid or missing rowIndex (must be >= 2)");
    }
    try {
      Logger.log(`Processing specific row: ${rowIndex}`);
      processSpecificRow(rowIndex);
      return ContentService.createTextOutput(`✅ Row ${rowIndex} processed`);
    } catch (err) {
      Logger.log(`Error processing row ${rowIndex}: ${err.message}`);
      return ContentService.createTextOutput(`❌ Error processing row ${rowIndex}: ${err.message}`);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}

// Function to check if contributorName is valid (matches Column H in Contributors sheet)
function isValidContributor(contributorName) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < contributorsData.length; i++) {
      const telegramHandle = contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS];
      const currentContributorName = contributorsData[i][CONTRIBUTOR_NAME_COL_CONTRIBUTORS];

      // Check contributorName as-is and with @ prepended
      if (telegramHandle === contributorName || telegramHandle === `@${contributorName}`) {
        return true;

      } else if (currentContributorName === contributorName) {

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

/** Normalize optional [SALES EVENT] lines; treat blank and "(none)" as empty */
function normalizeSalesEventOptionalField(raw) {
  const t = (raw || '').toString().trim();
  if (!t || /^(\(none\)|none)$/i.test(t)) return '';
  return t;
}

/** Update Agroverse QR codes column L (owner email) when the sale payload includes it */
function updateAgroverseQrOwnerEmail(qrCode, email) {
  if (!qrCode || !email) return false;
  try {
    const agroverseSpreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const agroverseSheet = agroverseSpreadsheet.getSheetByName(AGROVERSE_QR_SHEET_NAME);
    const agroverseData = agroverseSheet.getDataRange().getValues();
    for (let i = 1; i < agroverseData.length; i++) {
      if (agroverseData[i][QR_CODE_COL] === qrCode) {
        agroverseSheet.getRange(i + 1, AGROVERSE_OWNER_EMAIL_COL).setValue(email);
        Logger.log(`Updated owner email for QR ${qrCode} in Agroverse QR codes`);
        return true;
      }
    }
    Logger.log(`QR code ${qrCode} not found for owner email update`);
    return false;
  } catch (e) {
    Logger.log(`Error updating Agroverse owner email: ${e.message}`);
    return false;
  }
}

/** Match Stripe checkout row by Session ID (column C); set Shipping (M), Tracking (N), and QR (P) when provided */
function updateStripeCheckoutMetadata(sessionId, trackingNumber, qrCode, shippingProvider) {
  if (!sessionId) {
    Logger.log('Stripe checkout update skipped: no Stripe Session ID in payload');
    return false;
  }
  try {
    const ss = SpreadsheetApp.openByUrl(AGROVERSE_QR_SHEET_URL);
    const sheet = ss.getSheetByName(STRIPE_CHECKOUT_SHEET_NAME);
    if (!sheet) {
      Logger.log(`Sheet not found: ${STRIPE_CHECKOUT_SHEET_NAME}`);
      return false;
    }
    const want = sessionId.toString().trim();
    const lastRow = sheet.getLastRow();
    for (let r = lastRow; r >= 2; r--) {
      const cell = sheet.getRange(r, STRIPE_COL_SESSION).getValue();
      if ((cell || '').toString().trim() === want) {
        if (shippingProvider) {
          sheet.getRange(r, STRIPE_COL_SHIPPING).setValue(shippingProvider);
        }
        if (trackingNumber) {
          sheet.getRange(r, STRIPE_COL_TRACKING).setValue(trackingNumber);
        }
        if (qrCode) {
          sheet.getRange(r, STRIPE_COL_QR).setValue(qrCode);
        }
        Logger.log(`Updated Stripe checkout row ${r} for session ${want} (shipping / tracking / column P)`);
        return true;
      }
    }
    Logger.log(`No Stripe row found for session ${want}`);
    return false;
  } catch (e) {
    Logger.log(`Error updating Stripe checkout sheet: ${e.message}`);
    return false;
  }
}

/** After a verified [SALES EVENT] row is accepted, sync optional DApp fields to the main ledger */
function applySalesEventLedgerFields(qrCode, parseMethod, ownerEmail, stripeSessionId, trackingNumber, shippingProvider) {
  if (parseMethod !== 'SALES_EVENT' || !qrCode) return;
  if (ownerEmail) {
    updateAgroverseQrOwnerEmail(qrCode, ownerEmail);
  }
  if (stripeSessionId) {
    updateStripeCheckoutMetadata(stripeSessionId, trackingNumber, qrCode, shippingProvider);
  }
}

// Function to parse [SALES EVENT] structured format
function parseSalesEvent(message) {
  try {
    Logger.log('Attempting to parse [SALES EVENT] format');
    
    // Extract Item (QR code) - pattern: "- Item: XXXX"
    const itemMatch = message.match(/- Item:\s*([^\n]+)/i);
    const qrCode = itemMatch ? itemMatch[1].trim() : '';
    
    // Extract Sales price - pattern: "- Sales price: $XX" or "- Sales price: XX"
    const priceMatch = message.match(/- Sales price:\s*\$?([0-9]+\.?[0-9]*)/i);
    const salePrice = priceMatch ? parseFloat(priceMatch[1]) : '';

    const ownerLine = message.match(/- Owner email:\s*([^\n]+)/i);
    const stripeLine = message.match(/- Stripe Session ID:\s*([^\n]+)/i);
    const shipProvLine = message.match(/- Shipping Provider:\s*([^\n]+)/i);
    const trackLine = message.match(/- Tracking number:\s*([^\n]+)/i);
    const soldByLine = message.match(/- Sold by:\s*([^\n]+)/i);
    const cashProceedsLine = message.match(/- Cash proceeds collected by:\s*([^\n]+)/i);
    const ownerEmail = normalizeSalesEventOptionalField(ownerLine ? ownerLine[1] : '');
    const stripeSessionId = normalizeSalesEventOptionalField(stripeLine ? stripeLine[1] : '');
    const shippingProvider = normalizeSalesEventOptionalField(shipProvLine ? shipProvLine[1] : '');
    const trackingNumber = normalizeSalesEventOptionalField(trackLine ? trackLine[1] : '');
    const soldBy = (soldByLine ? soldByLine[1] : '').toString().trim();
    const cashProceedsCollectedBy = (cashProceedsLine ? cashProceedsLine[1] : '').toString().trim();
    
    if (qrCode && salePrice) {
      Logger.log(`[SALES EVENT] parsed successfully: QR=${qrCode}, Price=${salePrice}`);
      return {
        qrCode,
        salePrice,
        parseMethod: 'SALES_EVENT',
        ownerEmail,
        stripeSessionId,
        shippingProvider,
        trackingNumber,
        soldBy,
        cashProceedsCollectedBy
      };
    }
    
    Logger.log('[SALES EVENT] parsing failed: missing QR code or price');
    return {
      qrCode: '',
      salePrice: '',
      parseMethod: 'FAILED',
      ownerEmail: '',
      stripeSessionId: '',
      shippingProvider: '',
      trackingNumber: '',
      soldBy: '',
      cashProceedsCollectedBy: ''
    };
  } catch (e) {
    Logger.log(`[SALES EVENT] parsing error: ${e.message}`);
    return {
      qrCode: '',
      salePrice: '',
      parseMethod: 'ERROR',
      ownerEmail: '',
      stripeSessionId: '',
      shippingProvider: '',
      trackingNumber: '',
      soldBy: '',
      cashProceedsCollectedBy: ''
    };
  }
}

// Function to parse [QR CODE EVENT] structured format
function parseQrCodeEvent(message) {
  try {
    Logger.log('Attempting to parse [QR CODE EVENT] format');
    
    // Pattern: [QR CODE EVENT] QR_CODE - ... sold ... for $XX
    // Example: "[QR CODE EVENT] 2024OSCAR_20250702_5 - this bag of cacao just sold by me for $25."
    
    // Extract QR code - immediately after [QR CODE EVENT]
    const qrMatch = message.match(/\[QR CODE EVENT\]\s*([A-Za-z0-9_]+)/i);
    const qrCode = qrMatch ? qrMatch[1].trim() : '';
    
    // Extract price - pattern: "for $XX" or "for XX"
    const priceMatch = message.match(/for\s+\$?([0-9]+\.?[0-9]*)/i);
    const salePrice = priceMatch ? parseFloat(priceMatch[1]) : '';
    
    if (qrCode && salePrice) {
      Logger.log(`[QR CODE EVENT] parsed successfully: QR=${qrCode}, Price=${salePrice}`);
      return {
        qrCode,
        salePrice,
        parseMethod: 'QR_CODE_EVENT',
        ownerEmail: '',
        stripeSessionId: '',
        shippingProvider: '',
        trackingNumber: '',
        soldBy: '',
        cashProceedsCollectedBy: ''
      };
    }
    
    Logger.log('[QR CODE EVENT] parsing failed: missing QR code or price');
    return {
      qrCode: '',
      salePrice: '',
      parseMethod: 'FAILED',
      ownerEmail: '',
      stripeSessionId: '',
      shippingProvider: '',
      trackingNumber: '',
      soldBy: '',
      cashProceedsCollectedBy: ''
    };
  } catch (e) {
    Logger.log(`[QR CODE EVENT] parsing error: ${e.message}`);
    return {
      qrCode: '',
      salePrice: '',
      parseMethod: 'ERROR',
      ownerEmail: '',
      stripeSessionId: '',
      shippingProvider: '',
      trackingNumber: '',
      soldBy: '',
      cashProceedsCollectedBy: ''
    };
  }
}

// Function to parse structured messages (dispatcher)
function parseStructuredMessage(message) {
  // Check for [SALES EVENT] format
  if (message.match(/\[SALES EVENT\]/i)) {
    return parseSalesEvent(message);
  }
  
  // Check for [QR CODE EVENT] format
  if (message.match(/\[QR CODE EVENT\]/i)) {
    return parseQrCodeEvent(message);
  }
  
  // Not a recognized structured format
  Logger.log('Message does not match any structured format');
  return {
    qrCode: '',
    salePrice: '',
    parseMethod: 'NONE',
    ownerEmail: '',
    stripeSessionId: '',
    shippingProvider: '',
    trackingNumber: '',
    soldBy: '',
    cashProceedsCollectedBy: ''
  };
}

/** Normalize Telegram message id / sheet cell so 12345 and "12345" dedupe the same row */
function normalizeTelegramMessageId_(id) {
  if (id === null || id === undefined) return '';
  return String(id).trim();
}

/** Object map: trimmed QR string -> true (built from QR Code Sales column E) */
function buildQrOnSheetLookup_(codes) {
  const out = {};
  if (!codes) return out;
  for (var i = 0; i < codes.length; i++) {
    var k = String(codes[i] || '').trim();
    if (k) out[k] = true;
  }
  return out;
}

/** NBSP and unicode dashes break "- Item:" regex; normalize before structured parse */
function normalizeMessageForParsing_(message) {
  if (message == null) return '';
  return String(message)
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2028|\u2029/g, '\n');
}

/**
 * Scan whole message for Agroverse-style QR tokens; return first that already exists on QR Code Sales.
 * Catches legacy bodies where the first heuristic token is not the sold QR.
 * @param {string} message
 * @param {Object} qrLookup map from buildQrOnSheetLookup_
 * @returns {string} matched known QR or ''
 */
function findAnyKnownQrInMessage_(message, qrLookup) {
  if (!message || !qrLookup) return '';
  const text = String(message);
  // Tokens like 2024OSCAR_20250812_3, 2025CAPELAVELHA_20250809_10, 2024SJ_20250515_NIBS_3
  const re = /\b(20\d{2}[A-Za-z0-9][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b/g;
  var m;
  var seen = {};
  while ((m = re.exec(text)) !== null) {
    var tok = m[1];
    if (seen[tok]) continue;
    seen[tok] = true;
    if (qrLookup[tok]) return tok;
  }
  return '';
}

/**
 * Best-effort QR id from message text (no LLM). Used to skip Grok when that QR is already on QR Code Sales.
 * @param {string} message
 * @returns {string} trimmed code or ''
 */
function tryExtractQrCodeForDuplicateCheck_(message) {
  if (message == null || message === '') return '';
  const m = String(message);
  var match;
  match = m.match(/qr_code=([A-Za-z0-9_]+)/i);
  if (match && match[1]) return match[1].trim();
  match = m.match(/\[QR CODE EVENT\]\s*([A-Za-z0-9_]+)/i);
  if (match && match[1]) return match[1].trim();
  match = m.match(/-\s*Item:\s*([^\n\r]+)/i);
  if (match && match[1]) return match[1].trim();
  // Typical Agroverse-style ids, e.g. 2024OSCAR_20260330_37
  match = m.match(/\b(20\d{2}[A-Za-z][A-Za-z0-9]*_\d{8}_[A-Za-z0-9_]+)\b/);
  if (match && match[1]) return match[1].trim();
  return '';
}

// Function to call Grok API to extract QR code and sale price (fallback for unstructured messages)
function callGrokApi(message) {
  try {
    Logger.log('Calling Grok API for unstructured message parsing');
    const apiKey = PropertiesService.getScriptProperties().getProperty('XAI_API_KEY');
    if (!apiKey) {
      Logger.log('Error: XAI_API_KEY not set in Script Properties');
      return {
        qrCode: '',
        salePrice: '',
        parseMethod: 'GROK_ERROR',
        ownerEmail: '',
        stripeSessionId: '',
        shippingProvider: '',
        trackingNumber: '',
        soldBy: '',
        cashProceedsCollectedBy: ''
      };
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
      }),
      muteHttpExceptions: true // To inspect full response
    };
    
    const response = UrlFetchApp.fetch(XAI_API_URL, options);
    const data = JSON.parse(response.getContentText());
    const extractedData = JSON.parse(data.choices[0].message.content);
    
    Logger.log('Grok API parsed successfully');
    return {
      qrCode: extractedData.qr_code || '',
      salePrice: extractedData.sale_price ? parseFloat(extractedData.sale_price.replace('$', '')) : '',
      parseMethod: 'GROK_API',
      ownerEmail: '',
      stripeSessionId: '',
      shippingProvider: '',
      trackingNumber: '',
      soldBy: '',
      cashProceedsCollectedBy: ''
    };
  } catch (e) {
    Logger.log(`Grok API error: ${e.message}`);
    return {
      qrCode: '',
      salePrice: '',
      parseMethod: 'GROK_ERROR',
      ownerEmail: '',
      stripeSessionId: '',
      shippingProvider: '',
      trackingNumber: '',
      soldBy: '',
      cashProceedsCollectedBy: ''
    };
  }
}

/**
 * @param {string} message raw cell text
 * @param {Object=} existingQrLookup map trimmed QR -> true from QR Code Sales column E; skips Grok when any known QR appears in the body
 */
function extractQrCodeAndPrice(message, existingQrLookup) {
  const normalized = normalizeMessageForParsing_(message);

  // Try structured parsing first (normalized text fixes unicode "-" before "Item:")
  let result = parseStructuredMessage(normalized);
  
  // If structured parsing succeeded, return result
  if (result.qrCode && result.salePrice) {
    Logger.log(`Message parsed using ${result.parseMethod} method`);
    return result;
  }

  // Legacy / partial payloads: avoid Grok if any QR token in the body is already on QR Code Sales
  if (existingQrLookup && Object.keys(existingQrLookup).length) {
    const anyKnown = findAnyKnownQrInMessage_(normalized, existingQrLookup);
    if (anyKnown) {
      Logger.log(`Skipping Grok: message contains QR "${anyKnown}" already on QR Code Sales (structured parse was ${result.parseMethod})`);
      return {
        qrCode: '',
        salePrice: '',
        parseMethod: 'SKIPPED_DUPLICATE_QR',
        ownerEmail: '',
        stripeSessionId: '',
        shippingProvider: '',
        trackingNumber: '',
        soldBy: '',
        cashProceedsCollectedBy: ''
      };
    }
    const hintedQr = tryExtractQrCodeForDuplicateCheck_(normalized);
    if (hintedQr && existingQrLookup[hintedQr]) {
      Logger.log(`Skipping Grok: heuristic QR "${hintedQr}" already exists on QR Code Sales (structured parse was ${result.parseMethod})`);
      return {
        qrCode: '',
        salePrice: '',
        parseMethod: 'SKIPPED_DUPLICATE_QR',
        ownerEmail: '',
        stripeSessionId: '',
        shippingProvider: '',
        trackingNumber: '',
        soldBy: '',
        cashProceedsCollectedBy: ''
      };
    }
  }
  
  // Fallback to Grok API for unstructured messages
  Logger.log('Structured parsing failed, falling back to Grok API');
  result = callGrokApi(normalized);

  if (existingQrLookup && result.qrCode) {
    const qc = String(result.qrCode).trim();
    if (qc && existingQrLookup[qc]) {
      Logger.log(`Discarding Grok parse: QR "${qc}" already on QR Code Sales (duplicate; avoided second write)`);
      return {
        qrCode: '',
        salePrice: '',
        parseMethod: 'SKIPPED_DUPLICATE_AFTER_GROK',
        ownerEmail: '',
        stripeSessionId: '',
        shippingProvider: '',
        trackingNumber: '',
        soldBy: '',
        cashProceedsCollectedBy: ''
      };
    }
  }

  return result;
}

// Function to parse and process Telegram chat logs
function parseTelegramChatLogs() {
  // Get source and destination spreadsheets
  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const destinationSpreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  const destinationSheet = destinationSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
  ensureQrSalesAppendHeaders_(destinationSheet);

  // Get data from source and destination sheets
  const sourceData = sourceSheet.getDataRange().getValues();
  const destData = destinationSheet.getDataRange().getValues();
  
  // Get existing Telegram Message IDs from destination sheet to check for duplicates (string-normalized)
  const existingMessageIds = destData.slice(1).map(function (row) {
    return normalizeTelegramMessageId_(row[DEST_MESSAGE_ID_COL]);
  }); // Column B
  
  // Initialize existing QR codes from destination sheet + O(1) lookup for Grok skip
  let existingQrCodes = destData.slice(1).map(row => row[DEST_QR_CODE_COL]).filter(qr => qr); // Column E, filter out empty
  let existingQrLookup = buildQrOnSheetLookup_(existingQrCodes);
  
  // Counter for new entries
  let newEntries = 0;
  
  // Simple patterns for initial matching
  const patterns = [
    /sold for/i,
    /sold by/i,
    /\[QR CODE EVENT\]/i,
    /\[SALES EVENT\]/i,
    /qr_code=/i
  ];
  
  // Pattern for extracting Telegram handle
  const telegramHandlePattern = /@([A-Za-z0-9_]+)/;
  
  // Pattern for extracting reporter name from [SALES EVENT] "Sold by" line
  const salesEventReporterPattern = /\[SALES EVENT\][\s\S]*?- Sold by: ([^\n]+)/i;
  
  // Parse source data, skipping header row
  for (let i = 1; i < sourceData.length; i++) {
    const message = sourceData[i][MESSAGE_COL];
    const telegramMessageId = normalizeTelegramMessageId_(sourceData[i][TELEGRAM_MESSAGE_ID_COL]);
    
    // Check if message matches any pattern and hasn't been processed
    if (patterns.some(pattern => pattern.test(message)) && existingMessageIds.indexOf(telegramMessageId) === -1) {
      const {
        qrCode,
        salePrice,
        parseMethod,
        ownerEmail,
        stripeSessionId,
        shippingProvider,
        trackingNumber,
        soldBy: parsedSoldBy,
        cashProceedsCollectedBy: parsedCashProceeds
      } = extractQrCodeAndPrice(message, existingQrLookup);
      Logger.log(`Row ${i + 1}: Parsed using method: ${parseMethod}`);

      if (!qrCode || !salePrice) {
        appendIgnoredQrSalesRow_(
          destinationSheet,
          sourceData[i][TELEGRAM_UPDATE_ID_COL],
          telegramMessageId,
          message,
          sourceData[i][SALES_DATE_COL] || '',
          remarkForIgnoredNoSale_(parseMethod)
        );
        existingMessageIds.push(telegramMessageId);
        continue;
      }

      const qrNorm = String(qrCode || '').trim();
      if (existingQrLookup[qrNorm]) {
        Logger.log(`Skipping row ${i + 1} due to duplicate QR code: ${qrNorm}`);
        appendIgnoredQrSalesRow_(
          destinationSheet,
          sourceData[i][TELEGRAM_UPDATE_ID_COL],
          telegramMessageId,
          message,
          sourceData[i][SALES_DATE_COL] || '',
          'IGNORED: Duplicate QR code already on QR Code Sales when this message was processed.'
        );
        existingMessageIds.push(telegramMessageId);
        continue;
      }

      let finalSoldBy;
      /** Column D in QR Code Sales: cash proceeds collector (for ledger / payout attribution). */
      let finalCashCollector;

      if (message.match(/\[SALES EVENT\]/i)) {
        const reporterMatch = message.match(salesEventReporterPattern);
        const sourceContributor = sourceData[i][CONTRIBUTOR_NAME_COL];
        const soldByRaw = (parsedSoldBy || '').trim()
          || (reporterMatch && reporterMatch[1] ? reporterMatch[1].trim() : '')
          || sourceContributor;
        const cashRaw = (parsedCashProceeds || '').trim() || soldByRaw;
        if (!isValidContributor(soldByRaw) || !isValidContributor(cashRaw)) {
          Logger.log(`Skipping row ${i + 1} due to invalid contributor (sold by: ${soldByRaw}, cash proceeds: ${cashRaw})`);
          appendIgnoredQrSalesRow_(
            destinationSheet,
            sourceData[i][TELEGRAM_UPDATE_ID_COL],
            telegramMessageId,
            message,
            sourceData[i][SALES_DATE_COL] || '',
            'IGNORED: [SALES EVENT] with QR/price but sold-by or cash proceeds not in Contributors sheet.'
          );
          existingMessageIds.push(telegramMessageId);
          continue;
        }
        finalSoldBy = getReporterName(null, soldByRaw);
        finalCashCollector = getReporterName(null, cashRaw);
      } else {
        let contributorName = sourceData[i][CONTRIBUTOR_NAME_COL];
        let telegramHandle = null;
        const handleMatch = message.match(telegramHandlePattern);
        telegramHandle = handleMatch ? handleMatch[0] : null;
        if (!isValidContributor(contributorName)) {
          Logger.log(`Skipping row ${i + 1} due to invalid contributor: ${contributorName}`);
          appendIgnoredQrSalesRow_(
            destinationSheet,
            sourceData[i][TELEGRAM_UPDATE_ID_COL],
            telegramMessageId,
            message,
            sourceData[i][SALES_DATE_COL] || '',
            'IGNORED: QR/price parsed but reporter not in Contributors sheet.'
          );
          existingMessageIds.push(telegramMessageId);
          continue;
        }
        finalSoldBy = getReporterName(telegramHandle, contributorName);
        finalCashCollector = finalSoldBy;
      }

      const salesDate = sourceData[i][SALES_DATE_COL] || '';

      updateAgroverseQrStatus(qrCode);
      applySalesEventLedgerFields(qrCode, parseMethod, ownerEmail, stripeSessionId, trackingNumber, shippingProvider);

      const agroverseValue = getAgroverseValue(qrCode);
      const inventoryType = getAgroverseInventoryType(qrCode);

      const rowToAppend = [
        sourceData[i][TELEGRAM_UPDATE_ID_COL],
        telegramMessageId,
        message,
        finalCashCollector,
        qrCode,
        salePrice,
        agroverseValue,
        salesDate,
        inventoryType
      ].concat(buildQrSalesRowTail_('', ownerEmail, stripeSessionId, shippingProvider, trackingNumber, finalSoldBy, finalCashCollector, ''));

      destinationSheet.getRange(destinationSheet.getLastRow() + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);

      existingQrCodes.push(qrNorm);
      existingQrLookup[qrNorm] = true;
      existingMessageIds.push(telegramMessageId);
      newEntries++;

      const chatId = sourceData[i][CHAT_ID_COL] ? sourceData[i][CHAT_ID_COL].toString().trim() : null;
      if (chatId) {
        sendQrCodeNotification(qrCode, finalSoldBy, chatId);
      } else {
        Logger.log(`No chat ID found for row ${i + 1}, skipping notification for QR code ${qrCode}`);
      }

      Logger.log(`Added row ${i + 1} with QR code: ${qrCode}`);
    }
  }
  
  Logger.log(`Processed ${sourceData.length - 1} rows, added ${newEntries} new entries.`);
}

// Function to process a specific row from the source sheet
function processSpecificRow(rowIndex) {
  // Get source and destination spreadsheets
  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const destinationSpreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  const destinationSheet = destinationSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
  ensureQrSalesAppendHeaders_(destinationSheet);

  // Validate rowIndex
  if (rowIndex < 2) {
    Logger.log(`Invalid rowIndex: ${rowIndex}. Must be >= 2 (header row is 1).`);
    throw new Error(`Invalid rowIndex: ${rowIndex}. Must be >= 2.`);
  }
  
  // Get total rows in source sheet
  const lastRow = sourceSheet.getLastRow();
  if (rowIndex > lastRow) {
    Logger.log(`Row ${rowIndex} does not exist. Sheet has ${lastRow} rows.`);
    throw new Error(`Row ${rowIndex} does not exist. Sheet has ${lastRow} rows.`);
  }
  
  // Get data for the specific row (1-based index, adjust to 0-based for array)
  const sourceData = sourceSheet.getRange(rowIndex, 1, 1, sourceSheet.getLastColumn()).getValues();
  const destData = destinationSheet.getDataRange().getValues();
  
  // Get existing Telegram Message IDs and QR codes from destination sheet
  const existingMessageIds = destData.slice(1).map(function (row) {
    return normalizeTelegramMessageId_(row[DEST_MESSAGE_ID_COL]);
  }); // Column B
  const existingQrCodes = destData.slice(1).map(row => row[DEST_QR_CODE_COL]).filter(qr => qr); // Column E
  const existingQrLookup = buildQrOnSheetLookup_(existingQrCodes);
  
  // Simple patterns for initial matching
  const patterns = [
    /sold for/i,
    /sold by/i,
    /\[QR CODE EVENT\]/i,
    /\[SALES EVENT\]/i,
    /qr_code=/i
  ];
  
  // Pattern for extracting Telegram handle
  const telegramHandlePattern = /@([A-Za-z0-9_]+)/;
  
  // Pattern for extracting reporter name from [SALES EVENT] "Sold by" line
  const salesEventReporterPattern = /\[SALES EVENT\][\s\S]*?- Sold by: ([^\n]+)/i;
  
  // Process the specific row
  const message = sourceData[0][MESSAGE_COL];
  const telegramMessageId = normalizeTelegramMessageId_(sourceData[0][TELEGRAM_MESSAGE_ID_COL]);
  
  // Check if message matches any pattern and hasn't been processed
  if (patterns.some(pattern => pattern.test(message)) && existingMessageIds.indexOf(telegramMessageId) === -1) {
    const {
      qrCode,
      salePrice,
      parseMethod,
      ownerEmail,
      stripeSessionId,
      shippingProvider,
      trackingNumber,
      soldBy: parsedSoldBy,
      cashProceedsCollectedBy: parsedCashProceeds
    } = extractQrCodeAndPrice(message, existingQrLookup);
    Logger.log(`Row ${rowIndex}: Parsed using method: ${parseMethod}`);

    if (!qrCode || !salePrice) {
      Logger.log(`No valid QR code or sale price found in row ${rowIndex}`);
      appendIgnoredQrSalesRow_(
        destinationSheet,
        sourceData[0][TELEGRAM_UPDATE_ID_COL],
        telegramMessageId,
        message,
        sourceData[0][SALES_DATE_COL] || '',
        remarkForIgnoredNoSale_(parseMethod)
      );
      return;
    }

    const qrNorm = String(qrCode || '').trim();
    if (existingQrLookup[qrNorm]) {
      Logger.log(`Skipping row ${rowIndex} due to duplicate QR code: ${qrNorm}`);
      appendIgnoredQrSalesRow_(
        destinationSheet,
        sourceData[0][TELEGRAM_UPDATE_ID_COL],
        telegramMessageId,
        message,
        sourceData[0][SALES_DATE_COL] || '',
        'IGNORED: Duplicate QR code already on QR Code Sales when this message was processed.'
      );
      return;
    }

    let finalSoldBy;
    let finalCashCollector;

    if (message.match(/\[SALES EVENT\]/i)) {
      const reporterMatch = message.match(salesEventReporterPattern);
      const sourceContributor = sourceData[0][CONTRIBUTOR_NAME_COL];
      const soldByRaw = (parsedSoldBy || '').trim()
        || (reporterMatch && reporterMatch[1] ? reporterMatch[1].trim() : '')
        || sourceContributor;
      const cashRaw = (parsedCashProceeds || '').trim() || soldByRaw;
      if (!isValidContributor(soldByRaw) || !isValidContributor(cashRaw)) {
        Logger.log(`Skipping row ${rowIndex} due to invalid contributor (sold by: ${soldByRaw}, cash proceeds: ${cashRaw})`);
        appendIgnoredQrSalesRow_(
          destinationSheet,
          sourceData[0][TELEGRAM_UPDATE_ID_COL],
          telegramMessageId,
          message,
          sourceData[0][SALES_DATE_COL] || '',
          'IGNORED: [SALES EVENT] with QR/price but sold-by or cash proceeds not in Contributors sheet.'
        );
        return;
      }
      finalSoldBy = getReporterName(null, soldByRaw);
      finalCashCollector = getReporterName(null, cashRaw);
    } else {
      let contributorName = sourceData[0][CONTRIBUTOR_NAME_COL];
      let telegramHandle = null;
      const handleMatch = message.match(telegramHandlePattern);
      telegramHandle = handleMatch ? handleMatch[0] : null;
      if (!isValidContributor(contributorName)) {
        Logger.log(`Skipping row ${rowIndex} due to invalid contributor: ${contributorName}`);
        appendIgnoredQrSalesRow_(
          destinationSheet,
          sourceData[0][TELEGRAM_UPDATE_ID_COL],
          telegramMessageId,
          message,
          sourceData[0][SALES_DATE_COL] || '',
          'IGNORED: QR/price parsed but reporter not in Contributors sheet.'
        );
        return;
      }
      finalSoldBy = getReporterName(telegramHandle, contributorName);
      finalCashCollector = finalSoldBy;
    }

    const salesDate = sourceData[0][SALES_DATE_COL] || '';

    updateAgroverseQrStatus(qrCode);
    applySalesEventLedgerFields(qrCode, parseMethod, ownerEmail, stripeSessionId, trackingNumber, shippingProvider);

    const agroverseValue = getAgroverseValue(qrCode);
    const inventoryType = getAgroverseInventoryType(qrCode);

    const rowToAppend = [
      sourceData[0][TELEGRAM_UPDATE_ID_COL],
      telegramMessageId,
      message,
      finalCashCollector,
      qrCode,
      salePrice,
      agroverseValue,
      salesDate,
      inventoryType
    ].concat(buildQrSalesRowTail_('', ownerEmail, stripeSessionId, shippingProvider, trackingNumber, finalSoldBy, finalCashCollector, ''));

    destinationSheet.getRange(destinationSheet.getLastRow() + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);

    const chatId = sourceData[0][CHAT_ID_COL] ? sourceData[0][CHAT_ID_COL].toString().trim() : null;
    if (chatId) {
      sendQrCodeNotification(qrCode, finalSoldBy, chatId);
    } else {
      Logger.log(`No chat ID found for row ${rowIndex}, skipping notification for QR code ${qrCode}`);
    }

    Logger.log(`Processed row ${rowIndex} with QR code: ${qrCode}`);
  } else {
    Logger.log(`Row ${rowIndex} skipped: Message does not match patterns or already processed`);
  }
}

// ============================================
// TEST METHODS FOR PARSING FUNCTIONS
// ============================================

/**
 * Test method for parseSalesEvent function
 * Call this function from Google Apps Script editor to test [SALES EVENT] parsing
 */
function testParseSalesEvent() {
  const testMessage = `[SALES EVENT]
- Item: 2025ANA_20251021_MOLASSES
- Sales price: $14
- Sold by: Gary Teh
- Attached Filename: None
- Submission Source: https://dapp.truesight.me/report_sales.html
--------

My Digital Signature: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA54jNZdN4xkaPDI9TB/RwuicbbUMvttOWSTVRfvZxiHWeIoqTHRz2WJdoGsuW9rz9QPbpz6T9zQZu3RNzsSF216U3aCd89R2g7qhOMh9VC+7+sNJnI6H4qPPKFbndxQD8262Q+zqYQR6r0k89mud1sYbla/DCtKAcGZsALihVyl8tF2v1rUzfPU9FHpi5ow2kOEpVxnhe6xEY1HDU/zuFRt707WzkG1zit4AWEBXyBd3YLyinPNAb2aBA6dSPnPAQ4aB46Dtis3p5DgkLeO7E4gh/E0BqViDkkB1tLy1dgy9Kjv+5zxo1yTxkBKACjqqo69Q0VrUfkXgegWmXBAu04wIDAQAB

Request Transaction ID: wXvcGm2r6wk2Owr/To8rGL+u5uXi896/fRpXt5WxThLpHVVO1YaeF63+qG7SzRFaj5lZLky1F1uOi0aRx0oEDgD3mv1oSKAGmRFRU4h0ioDDG1iQGSm0dutpll7hkgBmgMTQuz+HtyCH1daHiWxhi0txHmlC0Qy74YVGtlP9eEplZBMg5OPng4cEm01gyhaqUAVb4ClEr9v5Fu+4FZGtOt6PBEqlQaQsk3mgp+x0flXPvpvDsr/hjdsRWEWcdp+OqucAhg77tqws3DJaMi0d0LKx7JWd/aFfj4qJQL42I2h2N2wh7f3pVy4GYtwXtXI5pl2XShOtcLQ2TmnGkNhf0Q==

This submission was generated using https://dapp.truesight.me/report_sales.html

Verify submission here: https://dapp.truesight.me/verify_request.html`;

  Logger.log('===== Testing parseSalesEvent =====');
  const result = parseSalesEvent(testMessage);
  Logger.log(`Result: ${JSON.stringify(result)}`);
  Logger.log(`Expected QR Code: 2025ANA_20251021_MOLASSES`);
  Logger.log(`Expected Price: 14`);
  
  if (result.qrCode === '2025ANA_20251021_MOLASSES' && result.salePrice === 14) {
    Logger.log('✅ TEST PASSED');
  } else {
    Logger.log('❌ TEST FAILED');
  }
}

/**
 * Test method for parseQrCodeEvent function
 * Call this function from Google Apps Script editor to test [QR CODE EVENT] parsing
 */
function testParseQrCodeEvent() {
  const testMessage = `[QR CODE EVENT] 2024OSCAR_20250702_5 - this bag of cacao just sold by me for $25.`;

  Logger.log('===== Testing parseQrCodeEvent =====');
  const result = parseQrCodeEvent(testMessage);
  Logger.log(`Result: ${JSON.stringify(result)}`);
  Logger.log(`Expected QR Code: 2024OSCAR_20250702_5`);
  Logger.log(`Expected Price: 25`);
  
  if (result.qrCode === '2024OSCAR_20250702_5' && result.salePrice === 25) {
    Logger.log('✅ TEST PASSED');
  } else {
    Logger.log('❌ TEST FAILED');
  }
}

/**
 * Test method for extractQrCodeAndPrice function with structured messages
 * Call this function from Google Apps Script editor to test the full extraction flow
 */
function testExtractQrCodeAndPrice() {
  const testMessages = [
    {
      name: 'SALES EVENT',
      message: `[SALES EVENT]
- Item: 2025ANA_20251021_MOLASSES
- Sales price: $14
- Sold by: Gary Teh`,
      expectedQr: '2025ANA_20251021_MOLASSES',
      expectedPrice: 14,
      expectedMethod: 'SALES_EVENT'
    },
    {
      name: 'QR CODE EVENT',
      message: `[QR CODE EVENT] 2024OSCAR_20250702_5 - this bag of cacao just sold by me for $25.`,
      expectedQr: '2024OSCAR_20250702_5',
      expectedPrice: 25,
      expectedMethod: 'QR_CODE_EVENT'
    }
  ];

  Logger.log('===== Testing extractQrCodeAndPrice =====');
  let passedTests = 0;
  let totalTests = testMessages.length;
  
  testMessages.forEach((test, index) => {
    Logger.log(`\n--- Test ${index + 1}: ${test.name} ---`);
    const result = extractQrCodeAndPrice(test.message);
    Logger.log(`Result: ${JSON.stringify(result)}`);
    Logger.log(`Expected: QR=${test.expectedQr}, Price=${test.expectedPrice}, Method=${test.expectedMethod}`);
    
    if (result.qrCode === test.expectedQr && 
        result.salePrice === test.expectedPrice && 
        result.parseMethod === test.expectedMethod) {
      Logger.log('✅ TEST PASSED');
      passedTests++;
    } else {
      Logger.log('❌ TEST FAILED');
    }
  });
  
  Logger.log(`\n===== SUMMARY: ${passedTests}/${totalTests} tests passed =====`);
}

// ============================================
// END OF TEST METHODS
// ============================================

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

  const messageText = `${qrCode}\n\n New QR code detected ${inventoryType} by ${contributorName}. Recorded in the Google Sheet. \n\nReview here: https://truesight.me/physical-assets/serialized/sold`;

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
