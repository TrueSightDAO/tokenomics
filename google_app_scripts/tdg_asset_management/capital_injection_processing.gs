/**
 * File: google_app_scripts/tdg_asset_management/capital_injection_processing.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Processes capital injection submissions from Telegram, validates them against
 * contributor signatures, and inserts double-entry transactions into appropriate managed AGL
 * ledgers (both Assets and Equity entries).
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const creds = getCredentials();

const MAX_REDIRECTS = 10;
const WIX_ACCESS_TOKEN = creds.WIX_API_KEY; // Wix API key for fetching ledger configurations

// Spreadsheet URLs
const TELEGRAM_LOGS_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit';

// Sheet names
const TELEGRAM_LOGS_SHEET = 'Telegram Chat Logs';
const CAPITAL_INJECTION_SHEET = 'Capital Injection';
const SHIPMENT_LEDGER_SHEET_NAME = 'Shipment Ledger Listing';
const CONTRIBUTORS_SIGNATURES_SHEET = 'Contributors Digital Signatures';

// Column indices for Telegram Chat Logs (0-based)
const TELEGRAM_UPDATE_ID_COL = 0;
const TELEGRAM_CHATROOM_ID_COL = 1;
const TELEGRAM_CHATROOM_NAME_COL = 2;
const TELEGRAM_MESSAGE_ID_COL = 3;
const TELEGRAM_CONTRIBUTOR_NAME_COL = 4;
const TELEGRAM_MESSAGE_COL = 6;
const TELEGRAM_STATUS_COL = 9;

// Column indices for Capital Injection sheet (0-based)
const CI_TELEGRAM_UPDATE_ID_COL = 0;      // A
const CI_TELEGRAM_MESSAGE_ID_COL = 1;     // B
const CI_LOG_MESSAGE_COL = 2;             // C
const CI_REPORTER_NAME_COL = 3;           // D
const CI_LEDGER_NAME_COL = 4;             // E
const CI_AMOUNT_COL = 5;                  // F
const CI_LEDGER_URL_COL = 6;              // G
const CI_INJECTION_DATE_COL = 7;          // H
const CI_DESCRIPTION_COL = 8;             // I
const CI_STATUS_COL = 9;                  // J
const CI_LEDGER_LINES_COL = 10;           // K

// ============================================================================
// UTILITY FUNCTIONS (Reused from tdg_expenses_processing.gs)
// ============================================================================

/**
 * Resolves URL redirects to get the final destination URL
 */
function resolveRedirect(url) {
  try {
    let currentUrl = url;
    let redirectCount = 0;
    
    while (redirectCount < MAX_REDIRECTS) {
      const response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });
      
      const responseCode = response.getResponseCode();
      
      if (responseCode < 300 || responseCode >= 400) {
        return currentUrl;
      }
      
      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      
      if (!location) {
        Logger.log(`No Location header for redirect at ${currentUrl}`);
        return '';
      }
      
      currentUrl = location;
      redirectCount++;
    }
    
    Logger.log(`Exceeded maximum redirects (${MAX_REDIRECTS}) for URL ${url}`);
    return '';
  } catch (e) {
    Logger.log(`Error resolving redirect for URL ${url}: ${e.message}`);
    return '';
  }
}

/**
 * Fetches ledger configurations from Google Sheets "Shipment Ledger Listing".
 * Migrated from Wix API to Google Sheets for cost savings.
 * @return {Array} Array of ledger configuration objects.
 */
function getLedgerConfigsFromWix() {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const shipmentSheet = spreadsheet.getSheetByName(SHIPMENT_LEDGER_SHEET_NAME);
    
    if (!shipmentSheet) {
      Logger.log(`Error: ${SHIPMENT_LEDGER_SHEET_NAME} sheet not found`);
      return [];
    }

    // Get all data from the sheet (skip header row)
    const lastRow = shipmentSheet.getLastRow();
    if (lastRow < 2) {
      Logger.log(`No data in ${SHIPMENT_LEDGER_SHEET_NAME} sheet`);
      return [];
    }

    // Read data starting from row 2 (row 1 is header), columns A to L
    const dataRange = shipmentSheet.getRange(2, 1, lastRow - 1, 12);
    const data = dataRange.getValues();

    // Construct LEDGER_CONFIGS from sheet data
    const ledgerConfigs = [];
    const seenUrls = new Set(); // Track unique URLs to avoid duplicates

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const shipmentId = row[0] ? row[0].toString().trim() : ''; // Column A - Shipment ID
      const ledgerUrl = row[11] ? row[11].toString().trim() : ''; // Column L - Ledger URL
      
      // Skip if no URL or no shipment ID
      if (!ledgerUrl || !shipmentId) {
        continue;
      }
      
      // Skip if we've already processed this URL (avoid duplicates)
      if (seenUrls.has(ledgerUrl)) {
        continue;
      }
      seenUrls.add(ledgerUrl);

      try {
        const resolvedUrl = resolveRedirect(ledgerUrl);
        if (resolvedUrl) {
          ledgerConfigs.push({
            ledger_name: shipmentId,
            ledger_url: resolvedUrl,
            sheet_name: 'Transactions',
            is_managed_ledger: true
          });
        } else {
          Logger.log(`Warning: Could not resolve URL for ${shipmentId}: ${ledgerUrl}`);
        }
      } catch (e) {
        Logger.log(`Error resolving URL for ${shipmentId}: ${e.message}`);
      }
    }

    Logger.log(`Fetched ${ledgerConfigs.length} ledger configs from ${SHIPMENT_LEDGER_SHEET_NAME}`);
    return ledgerConfigs;
  } catch (e) {
    Logger.log(`Error fetching ledger configs from ${SHIPMENT_LEDGER_SHEET_NAME}: ${e.message}`);
    return [];
  }
}

/**
 * Finds contributor by digital signature
 */
function findContributorByDigitalSignature(digitalSignature) {
  try {
    if (!digitalSignature) {
      return { contributorName: null, error: 'No digital signature provided' };
    }
    
    Logger.log(`Looking up contributor for signature: ${digitalSignature.substring(0, 50)}...`);
    
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const digitalSignaturesSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SIGNATURES_SHEET);
    
    if (!digitalSignaturesSheet) {
      return { contributorName: null, error: 'Contributors Digital Signatures sheet not found' };
    }
    
    const signatureData = digitalSignaturesSheet.getDataRange().getValues();
    
    for (let i = 1; i < signatureData.length; i++) {
      const contributorName = signatureData[i][0]; // Column A
      const signature = signatureData[i][4]; // Column E
      const status = signatureData[i][3]; // Column D
      
      if (signature && signature.trim() === digitalSignature.trim()) {
        Logger.log(`Found contributor: ${contributorName} for signature`);
        
        if (status === 'ACTIVE') {
          return { contributorName: contributorName, error: null };
        } else {
          return { 
            contributorName: null, 
            error: `Signature found for ${contributorName} but status is ${status}, not ACTIVE` 
          };
        }
      }
    }
    
    Logger.log(`No active contributor found for signature`);
    return { contributorName: null, error: 'No matching active digital signature found' };
  } catch (e) {
    Logger.log(`Error looking up contributor by digital signature: ${e.message}`);
    return { contributorName: null, error: e.message };
  }
}

// ============================================================================
// CAPITAL INJECTION SPECIFIC FUNCTIONS
// ============================================================================

/**
 * Parses capital injection message to extract details
 */
function parseCapitalInjectionMessage(message) {
  const details = {
    ledgerName: null,
    ledgerUrl: null,
    amount: null,
    description: null,
    attachedFilename: null,
    fileLocation: null,
    digitalSignature: null,
    requestTransactionId: null
  };
  
  try {
    // Extract ledger name: "- Ledger: AGL1"
    const ledgerNameMatch = message.match(/- Ledger:\s*([^\n]+)/i);
    if (ledgerNameMatch) {
      details.ledgerName = ledgerNameMatch[1].trim();
    }
    
    // Extract ledger URL: "- Ledger URL: https://..."
    const ledgerUrlMatch = message.match(/- Ledger URL:\s*([^\n]+)/i);
    if (ledgerUrlMatch) {
      details.ledgerUrl = ledgerUrlMatch[1].trim();
    }
    
    // Extract amount: "- Amount: $5000.00 USD" or "- Amount: $0 USD"
    const amountMatch = message.match(/- Amount:\s*\$?([0-9,]*\.?[0-9]+)\s*USD?/i);
    if (amountMatch) {
      details.amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    }
    
    // Extract description: "- Description: ..."
    const descriptionMatch = message.match(/- Description:\s*([^\n]+)/i);
    if (descriptionMatch) {
      details.description = descriptionMatch[1].trim();
    }
    
    // Extract attached filename: "- Attached Filename: ..."
    const filenameMatch = message.match(/- Attached Filename:\s*([^\n]+)/i);
    if (filenameMatch) {
      details.attachedFilename = filenameMatch[1].trim();
    }
    
    // Extract file location: "- Destination Capital Injection File Location: ..."
    const fileLocationMatch = message.match(/- Destination Capital Injection File Location:\s*([^\n]+)/i);
    if (fileLocationMatch) {
      details.fileLocation = fileLocationMatch[1].trim();
    }
    
    // Extract digital signature
    const sigPattern = /My Digital Signature:\s*([\s\S]*?)(?:\n\s*Request Transaction ID:|$)/i;
    const sigMatch = message.match(sigPattern);
    if (sigMatch) {
      details.digitalSignature = sigMatch[1].trim();
    }
    
    // Extract request transaction ID
    const requestIdMatch = message.match(/Request Transaction ID:\s*([^\n]+)/i);
    if (requestIdMatch) {
      details.requestTransactionId = requestIdMatch[1].trim();
    }
    
    Logger.log(`Parsed capital injection: Ledger=${details.ledgerName}, Amount=${details.amount}`);
    
  } catch (e) {
    Logger.log(`Error parsing capital injection message: ${e.message}`);
  }
  
  return details;
}

/**
 * Validates that the ledger URL matches a managed ledger from Wix
 */
function validateManagedLedger(ledgerUrl, ledgerConfigs) {
  for (let config of ledgerConfigs) {
    if (config.ledger_url === ledgerUrl) {
      return { valid: true, config: config };
    }
  }
  return { valid: false, config: null };
}

/**
 * Checks if a capital injection record already exists
 */
function capitalInjectionRecordExists(telegramUpdateId, telegramMessageId) {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_LOGS_URL);
    const capitalInjectionSheet = spreadsheet.getSheetByName(CAPITAL_INJECTION_SHEET);
    
    if (!capitalInjectionSheet) {
      return false;
    }
    
    const data = capitalInjectionSheet.getDataRange().getValues();
    const headerRow = 1;
    
    for (let i = headerRow; i < data.length; i++) {
      const row = data[i];
      const existingUpdateId = row[CI_TELEGRAM_UPDATE_ID_COL];
      const existingMessageId = row[CI_TELEGRAM_MESSAGE_ID_COL];
      
      if (existingUpdateId == telegramUpdateId && existingMessageId == telegramMessageId) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    Logger.log(`Error checking for duplicate: ${e.message}`);
    return false;
  }
}

/**
 * Inserts capital injection record into Capital Injection sheet
 */
function insertCapitalInjectionRecord(telegramUpdateId, telegramMessageId, logMessage, reporterName, 
                                     ledgerName, amount, ledgerUrl, injectionDate, description) {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_LOGS_URL);
    const capitalInjectionSheet = spreadsheet.getSheetByName(CAPITAL_INJECTION_SHEET);
    
    if (!capitalInjectionSheet) {
      Logger.log(`ERROR: ${CAPITAL_INJECTION_SHEET} sheet not found`);
      return false;
    }
    
    // Check for duplicate
    if (capitalInjectionRecordExists(telegramUpdateId, telegramMessageId)) {
      Logger.log(`⚠️ Capital injection record already exists for Update ID ${telegramUpdateId}, Message ID ${telegramMessageId}`);
      return false;
    }
    
    const rowToAppend = [
      telegramUpdateId,      // A: Telegram Update ID
      telegramMessageId,     // B: Telegram Message ID
      logMessage,            // C: Capital Injection Log Message
      reporterName,          // D: Reporter Name
      ledgerName,            // E: Ledger Name
      amount,                // F: Amount
      ledgerUrl,             // G: Ledger URL
      injectionDate,         // H: Injection Date
      description,           // I: Description
      'NEW',                 // J: Status
      ''                     // K: Ledger Lines Number (empty initially)
    ];
    
    capitalInjectionSheet.appendRow(rowToAppend);
    const rowNumber = capitalInjectionSheet.getLastRow();
    
    Logger.log(`✅ Inserted capital injection record at row ${rowNumber}`);
    return true;
    
  } catch (e) {
    Logger.log(`ERROR inserting capital injection record: ${e.message}`);
    return false;
  }
}

/**
 * Processes NEW capital injection records and inserts transactions into ledgers
 */
function processNewCapitalInjections() {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_LOGS_URL);
    const capitalInjectionSheet = spreadsheet.getSheetByName(CAPITAL_INJECTION_SHEET);
    
    if (!capitalInjectionSheet) {
      Logger.log(`ERROR: ${CAPITAL_INJECTION_SHEET} sheet not found`);
      return;
    }
    
    const data = capitalInjectionSheet.getDataRange().getValues();
    const headerRow = 1; // Assuming header is in row 1
    
    // Fetch ledger configs once
    const ledgerConfigs = getLedgerConfigsFromWix();
    
    let processedCount = 0;
    let failedCount = 0;
    
    for (let i = headerRow; i < data.length; i++) {
      const row = data[i];
      const status = row[CI_STATUS_COL];
      
      if (status !== 'NEW') {
        continue;
      }
      
      const rowNumber = i + 1;
      Logger.log(`\n📝 Processing capital injection at row ${rowNumber}`);
      
      const ledgerUrl = row[CI_LEDGER_URL_COL];
      const injectionDate = row[CI_INJECTION_DATE_COL];
      const logMessage = row[CI_LOG_MESSAGE_COL];
      const reporterName = row[CI_REPORTER_NAME_COL];
      const amount = row[CI_AMOUNT_COL];
      
      // Validate ledger
      const validation = validateManagedLedger(ledgerUrl, ledgerConfigs);
      if (!validation.valid) {
        Logger.log(`❌ Invalid ledger URL: ${ledgerUrl}`);
        capitalInjectionSheet.getRange(rowNumber, CI_STATUS_COL + 1).setValue('FAILED');
        failedCount++;
        continue;
      }
      
      try {
        // Open target ledger
        const targetSpreadsheet = SpreadsheetApp.openByUrl(ledgerUrl);
        const transactionsSheet = targetSpreadsheet.getSheetByName('Transactions');
        
        if (!transactionsSheet) {
          Logger.log(`❌ Transactions sheet not found in ledger: ${ledgerUrl}`);
          capitalInjectionSheet.getRange(rowNumber, CI_STATUS_COL + 1).setValue('FAILED');
          failedCount++;
          continue;
        }
        
        // Insert Transaction 1: Asset (Cash) Increase
        const assetRow = [
          injectionDate,     // A: Date
          logMessage,        // B: Description (full log message)
          reporterName,      // C: Entity
          amount,            // D: Amount (positive)
          'USD',             // E: Type/Currency
          'Assets'           // F: Category
        ];
        
        transactionsSheet.appendRow(assetRow);
        const assetRowNumber = transactionsSheet.getLastRow();
        Logger.log(`✅ Inserted Asset transaction at row ${assetRowNumber}`);
        
        // Insert Transaction 2: Equity (Capital) Increase
        const equityRow = [
          injectionDate,     // A: Date
          logMessage,        // B: Description (full log message)
          reporterName,      // C: Entity
          amount,            // D: Amount (positive)
          'USD',             // E: Type/Currency
          'Equity'           // F: Category
        ];
        
        transactionsSheet.appendRow(equityRow);
        const equityRowNumber = transactionsSheet.getLastRow();
        Logger.log(`✅ Inserted Equity transaction at row ${equityRowNumber}`);
        
        // Update Capital Injection sheet
        const ledgerLines = `${assetRowNumber},${equityRowNumber}`;
        capitalInjectionSheet.getRange(rowNumber, CI_STATUS_COL + 1).setValue('PROCESSED');
        capitalInjectionSheet.getRange(rowNumber, CI_LEDGER_LINES_COL + 1).setValue(ledgerLines);
        
        Logger.log(`✅ Successfully processed capital injection - Ledger lines: ${ledgerLines}`);
        processedCount++;
        
      } catch (e) {
        Logger.log(`❌ Error inserting transactions: ${e.message}`);
        capitalInjectionSheet.getRange(rowNumber, CI_STATUS_COL + 1).setValue('FAILED');
        failedCount++;
      }
    }
    
    Logger.log(`\n📊 Processing complete: ${processedCount} processed, ${failedCount} failed`);
    
  } catch (e) {
    Logger.log(`ERROR in processNewCapitalInjections: ${e.message}`);
  }
}

/**
 * Main function to parse Telegram logs and create capital injection records
 */
function parseAndProcessCapitalInjectionLogs() {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_LOGS_URL);
    const telegramLogsSheet = spreadsheet.getSheetByName(TELEGRAM_LOGS_SHEET);
    
    if (!telegramLogsSheet) {
      Logger.log(`ERROR: ${TELEGRAM_LOGS_SHEET} sheet not found`);
      return;
    }
    
    const sourceData = telegramLogsSheet.getDataRange().getValues();
    const headerRow = 2; // Header is in row 2
    
    let processedCount = 0;
    let skippedCount = 0;
    
    for (let i = headerRow; i < sourceData.length; i++) {
      const row = sourceData[i];
      const message = row[TELEGRAM_MESSAGE_COL];
      
      // Check if this is a capital injection event
      if (!message || !message.includes('[CAPITAL INJECTION EVENT]')) {
        continue;
      }
      
      Logger.log(`\n📝 Found capital injection message at row ${i + 1}`);
      
      // Parse the message
      const details = parseCapitalInjectionMessage(message);
      
      // Validate required fields
      if (!details.ledgerName || details.amount === null || !details.ledgerUrl) {
        Logger.log(`❌ Skipping: Missing required fields (ledger, amount, or URL)`);
        Logger.log(`   Ledger Name: ${details.ledgerName}`);
        Logger.log(`   Amount: ${details.amount}`);
        Logger.log(`   Ledger URL: ${details.ledgerUrl}`);
        skippedCount++;
        continue;
      }
      
      // Validate digital signature
      if (!details.digitalSignature) {
        Logger.log(`❌ Skipping: No digital signature found`);
        skippedCount++;
        continue;
      }
      
      const result = findContributorByDigitalSignature(details.digitalSignature);
      if (!result.contributorName) {
        Logger.log(`❌ Skipping: ${result.error}`);
        skippedCount++;
        continue;
      }
      
      const reporterName = result.contributorName;
      
      // Check if already processed
      if (capitalInjectionRecordExists(row[TELEGRAM_UPDATE_ID_COL], row[TELEGRAM_MESSAGE_ID_COL])) {
        Logger.log(`⏭️ Skipping row ${i + 1}: Already processed (exists in Capital Injection sheet)`);
        skippedCount++;
        continue;
      }
      
      // Get injection date (use status date from Telegram log, or current date)
      const statusDate = row[TELEGRAM_STATUS_COL] || new Date();
      const injectionDate = Utilities.formatDate(new Date(statusDate), 'GMT', 'yyyyMMdd');
      
      // Insert into Capital Injection sheet
      const success = insertCapitalInjectionRecord(
        row[TELEGRAM_UPDATE_ID_COL],
        row[TELEGRAM_MESSAGE_ID_COL],
        message,
        reporterName,
        details.ledgerName,
        details.amount,
        details.ledgerUrl,
        injectionDate,
        details.description || ''
      );
      
      if (success) {
        processedCount++;
      } else {
        skippedCount++;
      }
    }
    
    Logger.log(`\n📊 Parsing complete: ${processedCount} capital injections recorded, ${skippedCount} skipped`);
    
    // Now process the NEW records
    Logger.log(`\n🔄 Processing NEW capital injection records...`);
    processNewCapitalInjections();
    
  } catch (e) {
    Logger.log(`ERROR in parseAndProcessCapitalInjectionLogs: ${e.message}`);
  }
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * Test function to parse a single capital injection message
 */
function testParseCapitalInjectionMessage() {
  const testMessage = `[CAPITAL INJECTION EVENT]
- Ledger: AGL1
- Ledger URL: https://docs.google.com/spreadsheets/d/abc123/edit
- Amount: $5000.00 USD
- Description: Initial capital for operations
- Attached Filename: invoice.pdf
- Destination Capital Injection File Location: https://github.com/TrueSightDAO/.github/tree/main/assets/capital_injection_1234567890_invoice.pdf
--------

My Digital Signature: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1y5wLWcmZJ9qWdvJl7yoGj1wxR8fjxZVezo9IkwodBEZ6q2tIyKIpk8XyEokycPQ/M9ZocYr57manzU53Zh+V1DnvUnvHZpgSvPSw/wnBKuXNxg+1uy8h10X+2iBXsJBoK5cM20q1RxsGH4GBsDvPzLervRQVZPe12ht/VPVd0PbYPUBVVfs8q2KlaWrq7ZH4cJ0FHB1Km0cjgYs2rps0AgsyKseb8jCkQ788VFZwePZZzMRA6OXHCIuVFxbnAPZlNvckCFz+b2oM132aYaqgbkk2IgAbShxUuEwuv6yb2mQapsavUUShxMK8AHmyJ39v5lQ2xiTQTougTwTG5MzYwIDAQAB

Request Transaction ID: abc123xyz

This submission was generated using https://dapp.truesight.me/report_capital_injection.html

Verify submission here: https://dapp.truesight.me/verify_request.html`;
  
  const details = parseCapitalInjectionMessage(testMessage);
  
  Logger.log('=== Parsed Capital Injection Details ===');
  Logger.log(`Ledger Name: ${details.ledgerName}`);
  Logger.log(`Ledger URL: ${details.ledgerUrl}`);
  Logger.log(`Amount: ${details.amount}`);
  Logger.log(`Description: ${details.description}`);
  Logger.log(`Attached Filename: ${details.attachedFilename}`);
  Logger.log(`File Location: ${details.fileLocation}`);
  Logger.log(`Digital Signature: ${details.digitalSignature ? details.digitalSignature.substring(0, 50) + '...' : 'None'}`);
  Logger.log(`Request Transaction ID: ${details.requestTransactionId}`);
}

/**
 * Test function to fetch ledger configs
 */
function testGetLedgerConfigs() {
  Logger.log('=== Testing Ledger Config Fetch ===');
  const configs = getLedgerConfigsFromWix();
  Logger.log(`Found ${configs.length} managed ledgers:`);
  configs.forEach(config => {
    Logger.log(`  - ${config.ledger_name}: ${config.ledger_url}`);
  });
}

/**
 * Test function to process NEW capital injections
 */
function testProcessNewCapitalInjections() {
  Logger.log('=== Testing Process NEW Capital Injections ===');
  processNewCapitalInjections();
}

/**
 * Debug function to test a specific row in Telegram Chat Logs
 */
function debugSpecificRow() {
  const ROW_NUMBER = 6731; // The row to test
  
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(TELEGRAM_LOGS_URL);
    const telegramLogsSheet = spreadsheet.getSheetByName(TELEGRAM_LOGS_SHEET);
    
    if (!telegramLogsSheet) {
      Logger.log(`ERROR: ${TELEGRAM_LOGS_SHEET} sheet not found`);
      return;
    }
    
    Logger.log(`=== Testing Row ${ROW_NUMBER} ===`);
    
    // Get the specific row (1-based row number)
    const row = telegramLogsSheet.getRange(ROW_NUMBER, 1, 1, 18).getValues()[0];
    
    Logger.log(`\n📋 Row Data:`);
    Logger.log(`   Telegram Update ID (A): ${row[TELEGRAM_UPDATE_ID_COL]}`);
    Logger.log(`   Telegram Chatroom ID (B): ${row[TELEGRAM_CHATROOM_ID_COL]}`);
    Logger.log(`   Telegram Chatroom Name (C): ${row[TELEGRAM_CHATROOM_NAME_COL]}`);
    Logger.log(`   Telegram Message ID (D): ${row[TELEGRAM_MESSAGE_ID_COL]}`);
    Logger.log(`   Contributor Name (E): ${row[TELEGRAM_CONTRIBUTOR_NAME_COL]}`);
    Logger.log(`   Status (J): ${row[TELEGRAM_STATUS_COL]}`);
    
    const message = row[TELEGRAM_MESSAGE_COL];
    Logger.log(`\n📝 Message (Column G):`);
    Logger.log(`   Length: ${message ? message.length : 0} characters`);
    Logger.log(`   Type: ${typeof message}`);
    Logger.log(`   Contains [CAPITAL INJECTION EVENT]: ${message && message.includes('[CAPITAL INJECTION EVENT]')}`);
    Logger.log(`   First 200 chars: ${message ? message.substring(0, 200) : 'EMPTY'}`);
    
    if (!message || !message.includes('[CAPITAL INJECTION EVENT]')) {
      Logger.log(`\n❌ This row does NOT contain [CAPITAL INJECTION EVENT]`);
      return;
    }
    
    Logger.log(`\n✅ Found capital injection message!`);
    
    // Parse the message
    const details = parseCapitalInjectionMessage(message);
    
    Logger.log(`\n🔍 Parsed Details:`);
    Logger.log(`   Ledger Name: ${details.ledgerName}`);
    Logger.log(`   Ledger URL: ${details.ledgerUrl}`);
    Logger.log(`   Amount: ${details.amount}`);
    Logger.log(`   Description: ${details.description}`);
    Logger.log(`   Attached Filename: ${details.attachedFilename}`);
    Logger.log(`   File Location: ${details.fileLocation}`);
    Logger.log(`   Has Digital Signature: ${details.digitalSignature ? 'Yes (' + details.digitalSignature.substring(0, 50) + '...)' : 'No'}`);
    Logger.log(`   Request Transaction ID: ${details.requestTransactionId ? details.requestTransactionId.substring(0, 50) + '...' : 'None'}`);
    
    // Validate digital signature
    if (details.digitalSignature) {
      Logger.log(`\n🔐 Validating Digital Signature...`);
      const result = findContributorByDigitalSignature(details.digitalSignature);
      if (result.contributorName) {
        Logger.log(`   ✅ Valid signature for: ${result.contributorName}`);
      } else {
        Logger.log(`   ❌ Invalid signature: ${result.error}`);
      }
    }
    
    // Check required fields
    Logger.log(`\n✅ Validation:`);
    Logger.log(`   Has Ledger Name: ${details.ledgerName ? 'Yes' : 'No'} (${details.ledgerName})`);
    Logger.log(`   Has Amount: ${details.amount !== null ? 'Yes' : 'No'} (${details.amount})`);
    Logger.log(`   Has Ledger URL: ${details.ledgerUrl ? 'Yes' : 'No'} (${details.ledgerUrl ? details.ledgerUrl.substring(0, 60) + '...' : 'null'})`);
    Logger.log(`   Has Digital Signature: ${details.digitalSignature ? 'Yes' : 'No'}`);
    
    if (details.ledgerName && details.amount !== null && details.ledgerUrl && details.digitalSignature) {
      Logger.log(`\n✅ All required fields present - would be processed`);
    } else {
      Logger.log(`\n❌ Missing required fields - would be skipped`);
    }
    
  } catch (e) {
    Logger.log(`ERROR in debugSpecificRow: ${e.message}`);
    Logger.log(`Stack trace: ${e.stack}`);
  }
}
