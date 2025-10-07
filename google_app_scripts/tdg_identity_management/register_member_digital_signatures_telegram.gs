/**
 * File: google_app_scripts/tdg_identity_management/register_member_digital_signatures_telegram.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Registers new contributor digital signatures submitted via Telegram.
 */

/**
 * TDG Identity Management System
 * Processes digital signature events from Telegram logs and maintains a registry
 */

// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Configuration Constants
const CONFIG = {
  SOURCE: {
    URL: 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0',
    SHEET_NAME: 'Telegram Chat Logs',
    COLUMNS: {
      UPDATE_ID: 0,    // A
      CHAT_ID: 1,      // B
      CHAT_NAME: 2,    // C
      MESSAGE_ID: 3,   // D
      CONTRIBUTOR: 4,  // E
      MESSAGE: 6       // G
    }
  },
  SIGNATURES: {
    URL: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=577022511#gid=577022511',
    SHEET_NAME: 'Contributors Digital Signatures',
    COLUMNS: {
      NAME: 0,         // A
      CREATED: 1,      // B
      LAST_ACTIVE: 2,  // C
      STATUS: 3,       // D
      SIGNATURE: 4     // E
    }
  },
  CONTRIBUTORS: {
    URL: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618',
    SHEET_NAME: 'Contributors contact information',
    COLUMNS: {
      FULL_NAME: 0,    // A
      TELEGRAM: 7      // H
    }
  },
  TELEGRAM: {
    TOKEN: creds.TELEGRAM_API_TOKEN,
    CHAT_ID: '-1002190388985' // Fixed chat ID for all notifications
  }
};

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'processDigitalSignatureEvents') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      processDigitalSignatureEvents();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}


/**
 * Main function to process digital signature events
 */
function processDigitalSignatureEvents() {
  try {
    // Initialize and load data
    const {sourceData, signaturesSheet} = loadSheets();
    const existingSignatures = getExistingSignatures(signaturesSheet);
    
    // Process all rows
    const processedCount = processRows({
      sourceData,
      existingSignatures,
      signaturesSheet
    });
    
    Logger.log(`Process complete. ${processedCount} new signatures registered.`);
    return processedCount;
  } catch (error) {
    Logger.log(`❌ Process failed: ${error.message}\n${error.stack}`);
    return 0;
  }
}

/**
 * Load required sheets and data
 */
function loadSheets() {
  const sourceSheet = SpreadsheetApp
    .openByUrl(CONFIG.SOURCE.URL)
    .getSheetByName(CONFIG.SOURCE.SHEET_NAME);
    
  const signaturesSheet = SpreadsheetApp
    .openByUrl(CONFIG.SIGNATURES.URL)
    .getSheetByName(CONFIG.SIGNATURES.SHEET_NAME);
    
  return {
    sourceData: sourceSheet.getDataRange().getValues(),
    signaturesSheet: signaturesSheet
  };
}

/**
 * Get existing signatures from registry
 */
function getExistingSignatures(sheet) {
  return sheet.getDataRange()
    .getValues()
    .slice(1) // Skip header
    .map(row => row[CONFIG.SIGNATURES.COLUMNS.SIGNATURE])
    .filter(Boolean);
}

/**
 * Process all source rows
 */
function processRows({sourceData, existingSignatures, signaturesSheet}) {
  let registeredCount = 0;
  
  for (let i = 1; i < sourceData.length; i++) {
    const row = sourceData[i];
    const processResult = processSignatureRow(row, existingSignatures);
    
    if (processResult?.valid) {
      registerSignature(signaturesSheet, processResult);
      sendTelegramNotification(processResult);
      existingSignatures.push(processResult.signature);
      registeredCount++;
    }
  }
  
  return registeredCount;
}

/**
 * Process a single signature row
 */
function processSignatureRow(rowData, existingSignatures) {
  // Extract and validate signature
  const signature = extractSignature(rowData[CONFIG.SOURCE.COLUMNS.MESSAGE]);
  if (!signature) return null;
  
  // Check for duplicates
  if (existingSignatures.includes(signature)) {
    Logger.log(`⏩ Duplicate signature: ${signature.substring(0, 10)}...`);
    return null;
  }
  
  // Resolve contributor name
  const contributorName = resolveContributorName(
    rowData[CONFIG.SOURCE.COLUMNS.CONTRIBUTOR]
  );
  if (!contributorName) return null;
  
  return {
    valid: true,
    signature: signature,
    contributorName: contributorName,
    telegramHandle: rowData[CONFIG.SOURCE.COLUMNS.CONTRIBUTOR],
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
  };
}

/**
 * Extract signature from message
 */
function extractSignature(message) {
  const pattern = /\[DIGITAL SIGNATURE EVENT\][\s\S]*?DIGITAL SIGNATURE: ([A-Za-z0-9+/=]+)/i;
  const match = message?.match(pattern);
  return match?.[1] || null;
}

/**
 * Register new signature in sheet
 */
function registerSignature(sheet, {contributorName, timestamp, signature}) {
  const rowData = [
    contributorName, // A: Contributor Name
    timestamp,       // B: Created Date
    timestamp,       // C: Last Active
    "ACTIVE",        // D: Status
    signature        // E: Signature
  ];
  
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowData.length)
    .setValues([rowData]);
}

/**
 * Send Telegram notification to fixed chat ID
 */
function sendTelegramNotification(result) {
  if (!CONFIG.TELEGRAM.TOKEN) {
    Logger.log("⏩ Skipping notification - Missing Telegram token");
    return false;
  }
  
  const message = `✅ Digital signature registered\n\n` +
    `Contributor: ${result.contributorName}\n` +
    `Signature: ${result.signature.substring(0, 20)}...\n` +
    `Registered by: @${result.telegramHandle.replace(/^@/, '')}\n\n` +
    `Digital Signature Registry: https://truesight.me/digital-signatures` ;
  
  const payload = {
    method: "sendMessage",
    chat_id: CONFIG.TELEGRAM.CHAT_ID, // Using fixed chat ID
    text: message,
    parse_mode: "HTML"
  };
  
  Logger.log(`Sending to fixed chat ${CONFIG.TELEGRAM.CHAT_ID}: ${message.substring(0, 50)}...`);
  
  try {
    const response = UrlFetchApp.fetch(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM.TOKEN}/sendMessage`,
      {
        method: "post",
        payload: payload,
        muteHttpExceptions: true
      }
    );
    
    const responseData = JSON.parse(response.getContentText());
    if (!responseData.ok) {
      Logger.log(`❌ Telegram error: ${responseData.description}`);
      return false;
    }
    return true;
  } catch (error) {
    Logger.log(`❌ Telegram send failed: ${error.message}`);
    return false;
  }
}

/**
 * Resolve Telegram handle to contributor name
 */
function resolveContributorName(telegramHandle) {
  try {
    const sheet = SpreadsheetApp
      .openByUrl(CONFIG.CONTRIBUTORS.URL)
      .getSheetByName(CONFIG.CONTRIBUTORS.SHEET_NAME);
      
    const data = sheet.getDataRange().getValues();
    const normalizedHandle = telegramHandle.toLowerCase().replace(/^@/, '');
    
    for (let i = 1; i < data.length; i++) {
      const handle = data[i][CONFIG.CONTRIBUTORS.COLUMNS.TELEGRAM];
      if (handle?.toLowerCase().replace(/^@/, '') === normalizedHandle) {
        return data[i][CONFIG.CONTRIBUTORS.COLUMNS.FULL_NAME];
      }
    }
    
    Logger.log(`🔍 Contributor not found for handle: ${telegramHandle}`);
    return null;
  } catch (error) {
    Logger.log(`❌ Contributor resolution failed: ${error.message}`);
    return null;
  }
}

/***********************/
/* TESTING FUNCTIONS   */
/***********************/

function testTelegramNotification() {
  const testResult = {
    valid: true,
    signature: "TEST_" + Math.random().toString(36).substring(2, 10),
    contributorName: "Test User",
    telegramHandle: "testuser",
    timestamp: new Date().toISOString()
  };
  
  Logger.log("Testing Telegram notification to fixed chat ID...");
  const success = sendTelegramNotification(testResult);
  
  if (success) {
    Logger.log("✅ Telegram notification test passed");
  } else {
    Logger.log("❌ Telegram notification test failed - check logs");
  }
}

function testSignatureProcessing() {
  const testData = [
    // Valid test case
    [
      1, -100123456789, "Test Chat", 101, "valid_user", "",
      "[DIGITAL SIGNATURE EVENT]\nTest\nDIGITAL SIGNATURE: TEST1234567890"
    ],
    // Invalid message format
    [
      2, -100123456789, "Test Chat", 102, "valid_user", "",
      "Invalid message format"
    ],
    // Unknown user
    [
      3, -100123456789, "Test Chat", 103, "unknown_user", "",
      "[DIGITAL SIGNATURE EVENT]\nTest\nDIGITAL SIGNATURE: TEST9876543210"
    ]
  ];
  
  // Mock sheets
  const mockSheets = {
    signaturesSheet: {
      getDataRange: () => ({
        getValues: () => [["Header"], ["Existing", "", "", "", "TEST0000000000"]]
      }),
      getLastRow: () => 1,
      getRange: (row, col, numRows, numCols) => ({
        setValues: (data) => Logger.log(`Mock setValues: ${JSON.stringify(data)}`)
      })
    }
  };
  
  // Run tests
  testData.forEach((row, i) => {
    Logger.log(`\nTest ${i + 1}: ${row[CONFIG.SOURCE.COLUMNS.MESSAGE].substring(0, 20)}...`);
    const result = processSignatureRow(row, ["TEST0000000000"]);
    
    if (result?.valid) {
      Logger.log(`✅ Should PASS - Valid signature processed`);
      Logger.log(`Contributor: ${result.contributorName}`);
      Logger.log(`Signature: ${result.signature.substring(0, 10)}...`);
      
      // Test registration
      registerSignature(mockSheets.signaturesSheet, result);
      
      // Test notification
      sendTelegramNotification(result);
    } else {
      Logger.log(`❌ Should FAIL - Invalid test case`);
    }
  });
}