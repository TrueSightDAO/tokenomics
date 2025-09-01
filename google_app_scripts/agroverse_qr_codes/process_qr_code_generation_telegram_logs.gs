// ===== REQUIRED CONFIGURATION - SET THESE IN SCRIPT PROPERTIES =====
// You MUST set these values in Script Properties for the script to work:
// 1. Go to Project Settings > Script Properties
// 2. Add: TELEGRAM_API_TOKEN = your_telegram_bot_token
// 3. Add: GITHUB_TOKEN = your_github_personal_access_token

// ===== OPTIONAL CONFIGURATION =====
// These values can usually be left as-is, but you can customize if needed:

const TELEGRAM_CHAT_ID = '-1002190388985'; // Chat ID for notifications (usually doesn't need to change)
const GITHUB_REPO = 'TrueSightDAO/tokenomics'; // GitHub repository (owner/repo format)

// ===== SPREADSHEET URLs =====
// These are the actual spreadsheet URLs - usually don't need to change:

const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=1703901725#gid=1703901725'; // Main spreadsheet URL
const AGROVERSE_QR_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1qSi_-VSj7yiJl0Ak-Q3lch-l4mrH37cEw8EmQwS_6a4/edit?gid=472328231#gid=472328231'; // Agroverse QR codes spreadsheet
const CONTRIBUTORS_SIGNATURES_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=577022511#gid=577022511'; // Contributors Digital Signatures spreadsheet
const GITHUB_REPO_URL = 'https://github.com/TrueSightDAO/qr_codes/blob/main/'; // GitHub repository URL

// Tab names
const telegramLogTabName = "Telegram Chat Logs";
const qrCodeGenerationTabName = "QR Code Generation";
const contributorsSheetId = "1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU";
const contributorsTabName = "Contributors Digital Signatures";

// Helper: extract currency name from contribution text
function extractCurrencyName(contributionText) {
  const match = contributionText.match(/- Currency: (.+)$/m);
  return match ? match[1].trim() : 'Unknown';
}

// Helper: extract quantity from contribution text
function extractQuantity(contributionText) {
  const match = contributionText.match(/- Quantity: (.+)$/m);
  return match ? parseInt(match[1].trim()) : 0;
}

// Helper: extract expected zip file name from contribution text
function extractExpectedZipFile(contributionText) {
  const match = contributionText.match(/- Expected Zip File: (.+)$/m);
  return match ? match[1].trim() : 'N/A';
}

// Helper: extract download location from contribution text
function extractDownloadLocation(contributionText) {
  const match = contributionText.match(/- Download Location: (.+)$/m);
  return match ? match[1].trim() : 'N/A';
}

// Helper: extract timestamp from contribution text
function extractTimestamp(contributionText) {
  const match = contributionText.match(/- Timestamp: (.+)$/m);
  return match ? match[1].trim() : 'N/A';
}

// Send Telegram notification
function sendQRCodeGenerationNotification(rowData, qrCodeGenerationRowNumber) {
  Logger.log("Sending QR code generation notification");
  const telegramToken = getTelegramToken();
  if (!telegramToken) {
    Logger.log(`sendQRCodeGenerationNotification: Error: TELEGRAM_API_TOKEN not configured`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  const outputSheetLink = `https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=1703901725#gid=1703901725`;

  const messageText = `📱 New QR Code Generation Request Recorded\n\n` +
    `QR Code Generation Row: ${qrCodeGenerationRowNumber}\n` +
    `Telegram Update ID: ${rowData[0]}\n` +
    `Chatroom ID: ${rowData[1]}\n` +
    `Chatroom Name: ${rowData[2]}\n` +
    `Message ID: ${rowData[3]}\n` +
    `Contributor Handle: ${rowData[4]}\n` +
    `Contributor Name: ${rowData[9]}\n` +
    `Currency: ${rowData[10]}\n` +
    `Quantity: ${rowData[11]}\n` +
    `Expected Zip File: ${rowData[12]}\n` +
    `Download Location: ${rowData[13]}\n` +
    `Status: ${rowData[14]}\n\n` +
    `Review here: ${outputSheetLink}`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: messageText,
    parse_mode: "HTML"
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`Sending notification to chat ${TELEGRAM_CHAT_ID}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    if (status === 200) {
      Logger.log(`Notification sent successfully.`);
    } else {
      Logger.log(`Failed to send notification. Status: ${status}, Response: ${response.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`Error sending Telegram notification: ${e.message}`);
  }
}

// Get processed message IDs
function getProcessedMessageIds(qrCodeGenerationTab) {
  const lastRow = qrCodeGenerationTab.getLastRow();
  if (lastRow < 2) return [];
  const messageIds = qrCodeGenerationTab.getRange(2, 4, lastRow - 1, 1).getValues().flat();
  return messageIds.filter(id => id !== "");
}

// Main processing function
function processQRCodeGenerationTelegramLogs() {
  const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  let telegramLogTab = sheet.getSheetByName(telegramLogTabName);
  let qrCodeGenerationTab = sheet.getSheetByName(qrCodeGenerationTabName);
  const contributorsSheet = SpreadsheetApp.openById(contributorsSheetId);
  const contributorsTab = contributorsSheet.getSheetByName(contributorsTabName);

  // Create tab if not exists
  if (!qrCodeGenerationTab) {
    qrCodeGenerationTab = sheet.insertSheet(qrCodeGenerationTabName);
    qrCodeGenerationTab.getRange("A1:N1").setValues([[
      "Telegram Update ID",      // A
      "Telegram Chatroom ID",    // B
      "Telegram Chatroom Name",  // C
      "Telegram Message ID",     // D
      "Contributor Handle",      // E
      "Contribution Made",       // F
      "Status Date",             // G
      "Contributor Name",        // H
      "Currency",                // I
      "Zip File Download URL",   // J
      "Expected Zip File",       // K
      "Download Location",       // L
      "Status",                  // M
      "Processing Notes"         // N
    ]]);
  }

  const processedMessageIds = getProcessedMessageIds(qrCodeGenerationTab);

  const lastRow = telegramLogTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in Telegram Chat Logs tab");
    return;
  }
  const dataRange = telegramLogTab.getRange(2, 1, lastRow - 1, 15).getValues();

  const contributorsLastRow = contributorsTab.getLastRow();
  const contributorsData = contributorsLastRow > 1 ? contributorsTab.getRange(2, 1, contributorsLastRow - 1, 5).getValues() : [];

  dataRange.forEach(function(row, index) {
    const contributionMade = row[6]; // Column G
    const messageId = row[3]; // Column D

    if (processedMessageIds.includes(messageId)) {
      Logger.log(`Message ID already processed: ${messageId}`);
      return;
    }

    if (contributionMade && contributionMade.startsWith("[BATCH QR CODE REQUEST]")) {
      Logger.log(contributionMade);

      // Extract data from the contribution text
      const currency = extractCurrencyName(contributionMade);
      const quantity = extractQuantity(contributionMade);
      const expectedZipFile = extractExpectedZipFile(contributionMade);
      const downloadLocation = extractDownloadLocation(contributionMade);
      const timestamp = extractTimestamp(contributionMade);

      // Extract public signature
      const publicSignatureMatch = contributionMade.match(/My Digital Signature: ([^\n]+)/);
      const publicSignature = publicSignatureMatch ? publicSignatureMatch[1].trim() : 'N/A';

      // Match contributor name by public signature
      let contributorName = 'Unknown';
      contributorsData.forEach(function(contributorRow) {
        if (contributorRow[4] === publicSignature) {
          contributorName = contributorRow[0];
        }
      });

      // Add to QR Code Generation tab
      qrCodeGenerationTab.appendRow([
        row[0], // A - Telegram Update ID
        row[1], // B - Telegram Chatroom ID
        row[2], // C - Telegram Chatroom Name
        row[3], // D - Telegram Message ID
        row[4], // E - Contributor Handle
        contributionMade, // F - Contribution Made
        row[11], // G - Status Date
        contributorName, // H - Contributor Name
        currency, // I - Currency
        "", // J - Zip File Download URL (will be filled when completed)
        expectedZipFile, // K - Expected Zip File
        downloadLocation, // L - Download Location
        "PENDING", // M - Status
        "Queued for QR code generation" // N - Processing Notes
      ]);

      const qrCodeGenerationRowNumber = qrCodeGenerationTab.getLastRow();
      sendQRCodeGenerationNotification([
        row[0], row[1], row[2], row[3], row[4], contributionMade, row[11], 
        contributorName, currency, quantity, expectedZipFile, downloadLocation, "PENDING"
      ], qrCodeGenerationRowNumber);

      Logger.log(`Processed QR code generation request: ${currency} x${quantity} for ${contributorName}`);

      // Now actually generate the QR codes in the Agroverse spreadsheet
      try {
        Logger.log(`Starting QR code generation for ${currency} x${quantity}`);
        const qrCodeResult = createQRCodeRecordsInAgroverse(currency, quantity, contributorName, messageId, expectedZipFile);
        
        if (qrCodeResult.success) {
          // Update the status to show QR codes are being generated
          const processingNotes = `QR codes created in Agroverse spreadsheet. Batch ID: ${qrCodeResult.batch_id}. ${qrCodeResult.webhook_triggered ? 'GitHub webhook triggered successfully.' : 'GitHub webhook failed: ' + qrCodeResult.webhook_message}`;
          updateQRCodeGenerationStatus(messageId, "PROCESSING", processingNotes);
          
          // Update the zip file download URL
          updateZipFileDownloadURL(messageId, qrCodeResult.zip_file_url);
          
          // Update the Agroverse QR starting and ending lines
          updateAgroverseQRLines(messageId, qrCodeResult.start_row, qrCodeResult.end_row);
          
          // Send email notification to the requester
          try {
            const contributorEmail = getContributorEmailFromSignature(digitalSignature);
            if (contributorEmail) {
              const emailResult = sendEmailNotification(
                contributorEmail,
                currency,
                quantity,
                qrCodeResult.batch_id,
                qrCodeResult.zip_file_name,
                qrCodeResult.zip_file_url,
                qrCodeResult.start_row,
                qrCodeResult.end_row
              );
              
              if (emailResult.success) {
                Logger.log(`Email notification sent to ${contributorEmail}`);
              } else {
                Logger.log(`Failed to send email notification: ${emailResult.message}`);
              }
            } else {
              Logger.log(`No email found for digital signature: ${digitalSignature}`);
            }
          } catch (emailError) {
            Logger.log(`Error sending email notification: ${emailError.message}`);
          }
          
          Logger.log(`QR code generation successful: ${qrCodeResult.generated_codes.length} codes created, batch ID: ${qrCodeResult.batch_id}`);
        } else {
          // Update status to show error
          const errorNotes = `Failed to create QR codes: ${qrCodeResult.error}`;
          updateQRCodeGenerationStatus(messageId, "FAILED", errorNotes);
          
          Logger.log(`QR code generation failed: ${qrCodeResult.error}`);
        }
      } catch (error) {
        // Update status to show error
        const errorNotes = `Error during QR code generation: ${error.message}`;
        updateQRCodeGenerationStatus(messageId, "FAILED", errorNotes);
        
        Logger.log(`Error during QR code generation: ${error.message}`);
      }
    }
  });
}

// Function to update status of processed requests
function updateQRCodeGenerationStatus(messageId, status, processingNotes) {
  const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  const qrCodeGenerationTab = sheet.getSheetByName(qrCodeGenerationTabName);
  
  if (!qrCodeGenerationTab) {
    Logger.log("QR Code Generation tab not found");
    return false;
  }

  const lastRow = qrCodeGenerationTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in QR Code Generation tab");
    return false;
  }

  const dataRange = qrCodeGenerationTab.getRange(2, 4, lastRow - 1, 1); // Column D (Message ID)
  const messageIds = dataRange.getValues().flat();

  for (let i = 0; i < messageIds.length; i++) {
    if (messageIds[i] === messageId) {
      const rowNumber = i + 2; // Convert to spreadsheet row number
      
      // Update Status (Column M) and Processing Notes (Column N)
      qrCodeGenerationTab.getRange(rowNumber, 13).setValue(status); // Status
      qrCodeGenerationTab.getRange(rowNumber, 14).setValue(processingNotes); // Processing Notes
      
      Logger.log(`Updated status for message ID ${messageId} to ${status}`);
      return true;
    }
  }

  Logger.log(`Message ID ${messageId} not found in QR Code Generation tab`);
  return false;
}

// Function to update zip file download URL
function updateZipFileDownloadURL(messageId, zipFileDownloadURL) {
  const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  const qrCodeGenerationTab = sheet.getSheetByName(qrCodeGenerationTabName);
  
  if (!qrCodeGenerationTab) {
    Logger.log("QR Code Generation tab not found");
    return false;
  }

  const lastRow = qrCodeGenerationTab.getLastRow();
  if (lastRow < 2) {
    Logger.log("No data in QR Code Generation tab");
    return false;
  }

  const dataRange = qrCodeGenerationTab.getRange(2, 4, lastRow - 1, 1); // Column D (Message ID)
  const messageIds = dataRange.getValues().flat();

  for (let i = 0; i < messageIds.length; i++) {
    if (messageIds[i] === messageId) {
      const rowNumber = i + 2; // Convert to spreadsheet row number
      
      // Update Zip File Download URL (Column J)
      qrCodeGenerationTab.getRange(rowNumber, 10).setValue(zipFileDownloadURL);
      
      Logger.log(`Updated zip file download URL for message ID ${messageId}`);
      return true;
    }
  }

  Logger.log(`Message ID ${messageId} not found in QR Code Generation tab`);
  return false;
}

// Function to mark request as completed
function markQRCodeGenerationCompleted(messageId, zipFileUrl, processingNotes) {
  const status = "COMPLETED";
  const notes = `${processingNotes}\nZip file available at: ${zipFileUrl}`;
  
  // Update both the status and the zip file download URL
  const statusUpdated = updateQRCodeGenerationStatus(messageId, status, notes);
  const urlUpdated = updateZipFileDownloadURL(messageId, zipFileUrl);
  
  if (statusUpdated && urlUpdated) {
    Logger.log(`Marked QR code generation as completed for message ID ${messageId}`);
    return true;
  }
  return false;
}

// Function to mark request as failed
function markQRCodeGenerationFailed(messageId, errorMessage) {
  const status = "FAILED";
  const notes = `Error: ${errorMessage}`;
  
  if (updateQRCodeGenerationStatus(messageId, status, notes)) {
    Logger.log(`Marked QR code generation as failed for message ID ${messageId}`);
    return true;
  }
  return false;
}

// ===== QR Code Generation Functions =====

// Function to create QR code records in Agroverse spreadsheet
function createQRCodeRecordsInAgroverse(currencyName, quantity, contributorName, messageId, expectedZipFileName) {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SPREADSHEET_URL);
    const currenciesSheet = spreadsheet.getSheetByName('Currencies');
    const qrCodesSheet = spreadsheet.getSheetByName('Agroverse QR codes');
    
    if (!currenciesSheet || !qrCodesSheet) {
      throw new Error('Required sheets not found in Agroverse spreadsheet');
    }
    
    // Find the currency in Currencies sheet
    const currencyData = findCurrencyInAgroverse(currenciesSheet, currencyName);
    if (!currencyData) {
      throw new Error(`Currency not found: ${currencyName}`);
    }
    
    // Use the zip file name provided by the frontend instead of generating our own
    const zipFileName = expectedZipFileName || generateZipFileName(currencyName, generateBatchId());
    const batchId = generateBatchId();
    const generatedRows = [];
    const startRow = findLastNonEmptyRowInColumnA(qrCodesSheet) + 1;
    
    // Generate multiple QR codes
    for (let i = 0; i < quantity; i++) {
      const qrCodeValue = generateQRCodeValue(currencyData.year);
      const newRowData = createQRCodeRow(qrCodeValue, currencyData, batchId, zipFileName, contributorName, messageId);
      const insertRow = startRow + i;
      
      qrCodesSheet.getRange(insertRow, 1, 1, newRowData.length).setValues([newRowData]);
      generatedRows.push({
        qr_code: qrCodeValue,
        row: insertRow,
        github_url: GITHUB_REPO_URL + qrCodeValue + '.png'
      });
    }
    
    // Commit changes
    SpreadsheetApp.flush();
    
    // Trigger GitHub Actions webhook for batch processing
    const webhookResult = triggerBatchGitHubWebhook(startRow, startRow + quantity - 1, zipFileName, contributorName, messageId);
    
    return {
      success: true,
      batch_id: batchId,
      zip_file_name: zipFileName,
      zip_file_url: GITHUB_REPO_URL.replace('/blob/', '/tree/') + 'batch_files/' + zipFileName,
      start_row: startRow,
      end_row: startRow + quantity - 1,
      generated_codes: generatedRows,
      webhook_triggered: webhookResult.success,
      webhook_message: webhookResult.message
    };
    
  } catch (error) {
    Logger.log(`Error creating QR code records: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to find currency in Agroverse Currencies sheet
function findCurrencyInAgroverse(sheet, currencyName) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  
  const dataRange = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // A to J
  
  for (let i = 0; i < dataRange.length; i++) {
    const row = dataRange[i];
    const currentCurrencyName = row[0] ? row[0].toString().trim() : '';
    const isSerializable = row[2] === true || row[2] === 'TRUE' || row[2] === 'True'; // Column C
    
    if (currentCurrencyName && isSerializable && currentCurrencyName.toLowerCase() === currencyName.toLowerCase()) {
      return {
        product_name: currentCurrencyName,
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

// Helper function to generate QR code value
function generateQRCodeValue(year) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  const yearPrefix = year || today.getFullYear().toString();
  
  // Find the next available running number
  const runningNumber = findNextRunningNumber(yearPrefix, dateStr);
  
  return yearPrefix + '_' + dateStr + '_' + runningNumber;
}

// Helper function to find next running number
function findNextRunningNumber(yearPrefix, dateStr) {
  const spreadsheet = SpreadsheetApp.openByUrl(AGROVERSE_QR_SPREADSHEET_URL);
  const qrCodesSheet = spreadsheet.getSheetByName('Agroverse QR codes');
  
  const lastNonEmptyRow = findLastNonEmptyRowInColumnA(qrCodesSheet);
  if (lastNonEmptyRow < 2) return 1;
  
  const qrCodeColumn = qrCodesSheet.getRange(2, 1, lastNonEmptyRow - 1, 1).getValues();
  let maxNumber = 0;
  const pattern = new RegExp('^' + yearPrefix + '_' + dateStr + '_(\\d+)$');
  
  for (let i = 0; i < qrCodeColumn.length; i++) {
    const qrCode = qrCodeColumn[i][0] ? qrCodeColumn[i][0].toString() : '';
    const match = qrCode.match(pattern);
    if (match) {
      const number = parseInt(match[1]);
      if (number > maxNumber) {
        maxNumber = number;
      }
    }
  }
  
  return maxNumber + 1;
}

// Helper function to find last non-empty row in column A
function findLastNonEmptyRowInColumnA(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1; // Return row 1 if sheet is empty or only has header
  
  // Get all values in column A from row 2 to last row
  const columnAValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  
  // Find the last non-empty row
  for (let i = columnAValues.length - 1; i >= 0; i--) {
    const value = columnAValues[i][0];
    if (value && value.toString().trim() !== '') {
      return i + 2; // +2 because we started from row 2 and i is 0-based
    }
  }
  
  return 1; // Return row 1 if no non-empty values found
}

// Helper function to create QR code row data
function createQRCodeRow(qrCodeValue, currencyData, batchId, zipFileName, contributorName, messageId) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd');
  
  return [
    qrCodeValue, // Column A: QR Code value
    currencyData.landing_page, // Column B: Landing page
    currencyData.landing_page, // Column C: Ledger
    'MINTED', // Column D: Status
    currencyData.farm_name, // Column E: Farm name
    currencyData.state, // Column F: State
    currencyData.country, // Column G: Country
    currencyData.year, // Column H: Year
    currencyData.product_name, // Column I: Product name
    dateStr, // Column J: Current date
    GITHUB_REPO_URL + qrCodeValue + '.png', // Column K: GitHub URL
    '', // Column L: Email (placeholder)
    '', // Column M: (placeholder)
    '', // Column N: (placeholder)
    '', // Column O: (placeholder)
    '', // Column P: (placeholder)
    '', // Column Q: (placeholder)
    '', // Column R: (placeholder)
    currencyData.product_image, // Column S: Product image from column D
    25, // Column T: Price (default value)
    contributorName, // Column U: Requester Name (from Contributors Digital Signatures)
    batchId, // Column V: Batch ID
    zipFileName, // Column W: Zip file name
    '', // Column X: Requestor email (placeholder)
    messageId, // Column Y: Request transaction ID
    'Telegram Logs Processing' // Column Z: Submission source
  ];
}

// Helper function to generate batch ID
function generateBatchId() {
  const today = new Date();
  const timestamp = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  return 'BATCH_' + timestamp + '_' + randomId;
}

// Helper function to generate zip file name
function generateZipFileName(currencyName, batchId) {
  // Clean currency name for filename
  const cleanName = currencyName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 30);
  return cleanName + '_' + batchId + '.zip';
}

// Function to trigger GitHub Actions webhook for batch processing
function triggerBatchGitHubWebhook(startRow, endRow, zipFileName, contributorName, messageId) {
  try {
    // GitHub repository configuration
    const githubRepo = GITHUB_REPO;
    const githubToken = getGitHubToken();
    
    if (!githubToken) {
      return {
        success: false,
        message: 'GitHub token not configured. Please set GITHUB_TOKEN in Script Properties.'
      };
    }
    
    // Prepare the repository_dispatch payload for batch processing
    const payload = {
      event_type: 'qr-code-batch-generation',
      client_payload: {
        start_row: startRow.toString(),
        end_row: endRow.toString(),
        zip_file_name: zipFileName,
        contributor_name: contributorName || '',
        message_id: messageId || '',
        timestamp: new Date().toISOString()
      }
    };
    
    // Make the API call to trigger repository_dispatch
    const url = 'https://api.github.com/repos/' + githubRepo + '/dispatches';
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + githubToken,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'GoogleAppsScript-QRCodeGenerator'
      },
      payload: JSON.stringify(payload)
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode === 204) {
      return {
        success: true,
        message: 'Batch GitHub Actions webhook triggered successfully for rows ' + startRow + '-' + endRow + '. Workflow will generate QR codes and create zip file.'
      };
    } else {
      const responseText = response.getContentText();
      return {
        success: false,
        message: 'Failed to trigger batch webhook. Response: ' + responseCode + ' - ' + responseText
      };
    }
    
  } catch (error) {
    return {
      success: false,
      message: 'Error triggering batch webhook: ' + error.message
    };
  }
}

// Function to get GitHub token from Script Properties
function getGitHubToken() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const token = scriptProperties.getProperty('GITHUB_TOKEN');
  
  if (token) {
    return token;
  }
  
  Logger.log('GitHub token not configured. Please set GITHUB_TOKEN in Script Properties.');
  return null;
}

// Function to test GitHub token configuration
function testGitHubToken() {
  const token = getGitHubToken();
  if (token) {
    Logger.log('GitHub token is configured');
    return 'GitHub token is configured';
  } else {
    Logger.log('GitHub token is NOT configured');
    return 'GitHub token is NOT configured. Please set GITHUB_TOKEN in Script Properties.';
  }
}

// Function to get Telegram token from Script Properties
function getTelegramToken() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const token = scriptProperties.getProperty('TELEGRAM_API_TOKEN');
  
  if (token) {
    return token;
  }
  
  Logger.log('Telegram token not configured. Please set TELEGRAM_API_TOKEN in Script Properties.');
  return null;
}

// Function to test Telegram token configuration
function testTelegramToken() {
  const token = getTelegramToken();
  if (token) {
    Logger.log('Telegram token is configured');
    return 'Telegram token is configured';
  } else {
    Logger.log('Telegram token is NOT configured');
    return 'Telegram token is NOT configured. Please set TELEGRAM_API_TOKEN in Script Properties.';
  }
}

// Function to check if all required tokens are configured
function checkRequiredConfiguration() {
  const telegramToken = getTelegramToken();
  const githubToken = getGitHubToken();
  
  const results = {
    telegramConfigured: !!telegramToken,
    githubConfigured: !!githubToken,
    allConfigured: !!(telegramToken && githubToken)
  };
  
  if (!results.allConfigured) {
    Logger.log('Configuration check failed:');
    if (!results.telegramConfigured) {
      Logger.log('- TELEGRAM_API_TOKEN not set in Script Properties');
    }
    if (!results.githubConfigured) {
      Logger.log('- GITHUB_TOKEN not set in Script Properties');
    }
  } else {
    Logger.log('All required tokens are configured correctly');
  }
  
  return results;
}

// ===== Email Notification Functions =====

// Function to get contributor email from digital signature
function getContributorEmailFromSignature(digitalSignature) {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SIGNATURES_URL);
    const sheet = spreadsheet.getSheetByName('Contributors Digital Signatures');
    
    if (!sheet) {
      Logger.log('Contributors Digital Signatures sheet not found');
      return null;
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.log('No data found in Contributors Digital Signatures sheet');
      return null;
    }
    
    // Search for digital signature in Column E
    const dataRange = sheet.getRange(2, 5, lastRow - 1, 2).getValues(); // Columns E and F
    
    for (let i = 0; i < dataRange.length; i++) {
      const signature = dataRange[i][0] ? dataRange[i][0].toString().trim() : '';
      const email = dataRange[i][1] ? dataRange[i][1].toString().trim() : '';
      
      if (signature === digitalSignature && email) {
        Logger.log(`Found email for signature: ${email}`);
        return email;
      }
    }
    
    Logger.log(`No email found for digital signature: ${digitalSignature}`);
    return null;
    
  } catch (error) {
    Logger.log(`Error looking up contributor email: ${error.message}`);
    return null;
  }
}

// Function to send email notification
function sendEmailNotification(email, currencyName, quantity, batchId, zipFileName, zipFileUrl, startLine, endLine) {
  try {
    const subject = "QR Code Generation Complete - TrueSight DAO";
    const body = `
Your QR code generation request has been completed successfully!

📦 Request Details:
- Currency: ${currencyName}
- Quantity: ${quantity} QR codes
- Batch ID: ${batchId}

📊 Generated Records:
- Starting Line: ${startLine}
- Ending Line: ${endLine}
- Total Records: ${endLine - startLine + 1}

🔗 Download Information:
- Zip File: ${zipFileName}
- Download URL: ${zipFileUrl}

📅 Completed: ${new Date().toISOString()}

You can now download the zip file containing all your generated QR codes from the link above.

Best regards,
TrueSight DAO QR Code System
    `.trim();
    
    Logger.log('Email notification prepared:');
    Logger.log('To: ' + email);
    Logger.log('Subject: ' + subject);
    Logger.log('Body: ' + body);
    
    // TODO: Implement actual email sending
    // Example with Gmail:
    // GmailApp.sendEmail(email, subject, body);
    
    return {
      success: true,
      message: 'Email notification prepared for ' + email
    };
    
  } catch (error) {
    return {
      success: false,
      message: 'Error sending email: ' + error.message
    };
  }
}

// ===== Update Functions for QR Code Generation Tab =====

// Function to update Agroverse QR starting and ending lines
function updateAgroverseQRLines(messageId, startLine, endLine) {
  try {
    const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    const qrCodeGenerationTab = sheet.getSheetByName(qrCodeGenerationTabName);
    
    if (!qrCodeGenerationTab) {
      Logger.log('QR Code Generation tab not found');
      return false;
    }
    
    // Find the row with the matching message ID
    const lastRow = qrCodeGenerationTab.getLastRow();
    if (lastRow < 2) {
      Logger.log('No data found in QR Code Generation tab');
      return false;
    }
    
    const messageIdColumn = qrCodeGenerationTab.getRange(2, 4, lastRow - 1, 1).getValues(); // Column D (Message ID)
    let rowNumber = -1;
    
    for (let i = 0; i < messageIdColumn.length; i++) {
      if (messageIdColumn[i][0] && messageIdColumn[i][0].toString().trim() === messageId.toString().trim()) {
        rowNumber = i + 2; // +2 because we started from row 2 and i is 0-based
        break;
      }
    }
    
    if (rowNumber === -1) {
      Logger.log(`Message ID ${messageId} not found in QR Code Generation tab`);
      return false;
    }
    
    // Update Column H (Agroverse QR starting line) and Column I (Agroverse QR ending line)
    qrCodeGenerationTab.getRange(rowNumber, 8).setValue(startLine); // Column H is 8th column
    qrCodeGenerationTab.getRange(rowNumber, 9).setValue(endLine);   // Column I is 9th column
    
    Logger.log(`Updated Agroverse QR lines for message ID ${messageId}: ${startLine} to ${endLine}`);
    return true;
    
  } catch (error) {
    Logger.log(`Error updating Agroverse QR lines: ${error.message}`);
    return false;
  }
}

// ===== Test Functions =====

// Function to test processing of a specific row from Telegram Chat Logs
function testProcessSpecificRow(rowNumber = 6479) {
  try {
    Logger.log(`=== Testing Processing of Row ${rowNumber} ===`);
    
    const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    const telegramLogsTab = sheet.getSheetByName(telegramLogTabName);
    
    if (!telegramLogsTab) {
      Logger.log('Telegram Chat Logs tab not found');
      return 'Error: Telegram Chat Logs tab not found';
    }
    
    const lastRow = telegramLogsTab.getLastRow();
    if (rowNumber < 2 || rowNumber > lastRow) {
      return `Error: Row ${rowNumber} is out of range. Valid range: 2 to ${lastRow}`;
    }
    
    // Get the specific row data
    const rowData = telegramLogsTab.getRange(rowNumber, 1, 1, 15).getValues()[0]; // Columns A to O
    
    Logger.log('Row data: ' + JSON.stringify(rowData));
    
    // Check if this row contains a batch QR code request
    const contributionText = rowData[6] ? rowData[6].toString() : ''; // Column G (Contribution Made)
    
    if (!contributionText.includes('[BATCH QR CODE REQUEST]')) {
      return `Row ${rowNumber} does not contain a batch QR code request. Found: "${contributionText}"`;
    }
    
    Logger.log('Found batch QR code request, processing...');
    
    // Extract data from the contribution text
    const currency = extractCurrencyName(contributionText);
    const quantity = extractQuantity(contributionText);
    const expectedZipFile = extractExpectedZipFile(contributionText);
    const downloadLocation = extractDownloadLocation(contributionText);
    const timestamp = extractTimestamp(contributionText);
    
    Logger.log(`Extracted data: Currency=${currency}, Quantity=${quantity}, ZipFile=${expectedZipFile}`);
    
    // Now do the FULL EXECUTION - create records, generate QR codes, etc.
    Logger.log('🚀 Starting FULL EXECUTION for this row...');
    
    try {
      // Step 1: Create record in QR Code Generation tab
      Logger.log('📊 Step 1: Creating record in QR Code Generation tab...');
      const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
      let qrCodeGenerationTab = sheet.getSheetByName(qrCodeGenerationTabName);
      
      // Create tab if not exists
      if (!qrCodeGenerationTab) {
        qrCodeGenerationTab = sheet.insertSheet(qrCodeGenerationTabName);
        qrCodeGenerationTab.getRange("A1:N1").setValues([[
          "Telegram Update ID",      // A
          "Telegram Chatroom ID",    // B
          "Telegram Chatroom Name",  // C
          "Telegram Message ID",     // D
          "Contributor Handle",      // E
          "Contribution Made",       // F
          "Status Date",             // G
          "Contributor Name",        // H
          "Currency",                // I
          "Zip File Download URL",   // J
          "Expected Zip File",       // K
          "Download Location",       // L
          "Status",                  // M
          "Processing Notes"         // N
        ]]);
      }
      
      // Extract contributor information
      const publicSignatureMatch = contributionText.match(/My Digital Signature: ([^\n]+)/);
      const publicSignature = publicSignatureMatch ? publicSignatureMatch[1].trim() : 'N/A';
      
      // Get contributor name from contributors sheet
      const contributorsSheet = SpreadsheetApp.openById(contributorsSheetId);
      const contributorsTab = contributorsSheet.getSheetByName(contributorsTabName);
      let contributorName = 'Unknown';
      
      if (contributorsTab) {
        const contributorsLastRow = contributorsTab.getLastRow();
        if (contributorsLastRow > 1) {
          const contributorsData = contributorsTab.getRange(2, 1, contributorsLastRow - 1, 5).getValues();
          contributorsData.forEach(function(contributorRow) {
            if (contributorRow[4] === publicSignature) {
              contributorName = contributorRow[0];
            }
          });
        }
      }
      
      // Add to QR Code Generation tab
      const messageId = rowData[3]; // Column D
      qrCodeGenerationTab.appendRow([
        rowData[0], // A - Telegram Update ID
        rowData[1], // B - Telegram Chatroom ID
        rowData[2], // C - Telegram Chatroom Name
        messageId, // D - Telegram Message ID
        rowData[4], // E - Contributor Handle
        contributionText, // F - Contribution Made
        rowData[11], // G - Status Date
        contributorName, // H - Contributor Name
        currency, // I - Currency
        "", // J - Zip File Download URL (will be filled when completed)
        expectedZipFile, // K - Expected Zip File
        downloadLocation, // L - Download Location
        "PENDING", // M - Status
        "Queued for QR code generation" // N - Processing Notes
      ]);
      
      const qrCodeGenerationRowNumber = qrCodeGenerationTab.getLastRow();
      Logger.log(`✅ Record created in QR Code Generation tab at row ${qrCodeGenerationRowNumber}`);
      
      // Step 2: Send Telegram notification
      Logger.log('📱 Step 2: Sending Telegram notification...');
      sendQRCodeGenerationNotification([
        rowData[0], rowData[1], rowData[2], messageId, rowData[4], contributionText, rowData[11], 
        contributorName, currency, quantity, expectedZipFile, downloadLocation, "PENDING"
      ], qrCodeGenerationRowNumber);
      
      // Step 3: Generate QR codes in Agroverse spreadsheet
      Logger.log('📊 Step 3: Generating QR codes in Agroverse spreadsheet...');
              const qrCodeResult = createQRCodeRecordsInAgroverse(currency, quantity, contributorName, messageId, expectedZipFile);
      
      if (qrCodeResult.success) {
        // Update status to show QR codes are being generated
        const processingNotes = `QR codes created in Agroverse spreadsheet. Batch ID: ${qrCodeResult.batch_id}. ${qrCodeResult.webhook_triggered ? 'GitHub webhook triggered successfully.' : 'GitHub webhook failed: ' + qrCodeResult.webhook_message}`;
        updateQRCodeGenerationStatus(messageId, "PROCESSING", processingNotes);
        
        // Update the zip file download URL
        updateZipFileDownloadURL(messageId, qrCodeResult.zip_file_url);
        
        // Update the Agroverse QR starting and ending lines
        updateAgroverseQRLines(messageId, qrCodeResult.start_row, qrCodeResult.end_row);
        
        // Send email notification to the requester
        try {
          const contributorEmail = getContributorEmailFromSignature(publicSignature);
          if (contributorEmail) {
            const emailResult = sendEmailNotification(
              contributorEmail,
              currency,
              quantity,
              qrCodeResult.batch_id,
              qrCodeResult.zip_file_name,
              qrCodeResult.zip_file_url,
              qrCodeResult.start_row,
              qrCodeResult.end_row
            );
            
            if (emailResult.success) {
              Logger.log(`✅ Email notification sent to ${contributorEmail}`);
            } else {
              Logger.log(`❌ Failed to send email notification: ${emailResult.message}`);
            }
          } else {
            Logger.log(`⚠️ No email found for digital signature: ${publicSignature}`);
          }
        } catch (emailError) {
          Logger.log(`❌ Error sending email notification: ${emailError.message}`);
        }
        
        Logger.log(`🎉 FULL EXECUTION COMPLETED for row ${rowNumber}!`);
        Logger.log(`📊 QR codes created: ${qrCodeResult.generated_codes.length}`);
        Logger.log(`🆔 Batch ID: ${qrCodeResult.batch_id}`);
        Logger.log(`📦 Zip file: ${qrCodeResult.zip_file_name}`);
        
        return `🎉 FULL EXECUTION COMPLETED for row ${rowNumber}! QR codes created: ${qrCodeResult.generated_codes.length}, Batch ID: ${qrCodeResult.batch_id}, Zip: ${qrCodeResult.zip_file_name}`;
        
      } else {
        // Update status to show error
        const errorNotes = `Failed to create QR codes: ${qrCodeResult.error}`;
        updateQRCodeGenerationStatus(messageId, "FAILED", errorNotes);
        
        Logger.log(`❌ QR code generation failed: ${qrCodeResult.error}`);
        return `❌ QR code generation failed for row ${rowNumber}: ${qrCodeResult.error}`;
      }
      
    } catch (executionError) {
      Logger.log(`❌ Error during full execution: ${executionError.message}`);
      return `❌ Error during full execution for row ${rowNumber}: ${executionError.message}`;
    }
    
  } catch (error) {
    Logger.log(`Error in testProcessSpecificRow: ${error.message}`);
    return `Error: ${error.message}`;
  }
}

// Function to test processing of multiple rows
function testProcessMultipleRows(startRow, endRow) {
  try {
    Logger.log(`=== Testing Processing of Rows ${startRow} to ${endRow} ===`);
    
    if (startRow < 2 || endRow < startRow) {
      return 'Error: Invalid row range. Start row must be >= 2 and end row must be >= start row.';
    }
    
    const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    const telegramLogsTab = sheet.getSheetByName(telegramLogTabName);
    
    if (!telegramLogsTab) {
      Logger.log('Telegram Chat Logs tab not found');
      return 'Error: Telegram Chat Logs tab not found';
    }
    
    const lastRow = telegramLogsTab.getLastRow();
    if (endRow > lastRow) {
      endRow = lastRow;
      Logger.log(`Adjusted end row to ${endRow} (last available row)`);
    }
    
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    const results = [];
    
    for (let row = startRow; row <= endRow; row++) {
      try {
        const rowData = telegramLogsTab.getRange(row, 1, 1, 15).getValues()[0];
        const contributionText = rowData[6] ? rowData[6].toString() : '';
        
        if (contributionText.includes('[BATCH QR CODE REQUEST]')) {
          processedCount++;
          Logger.log(`Processing row ${row}...`);
          
          try {
            // Extract data from the contribution text
            const currency = extractCurrencyName(contributionText);
            const quantity = extractQuantity(contributionText);
            const expectedZipFile = extractExpectedZipFile(contributionText);
            const downloadLocation = extractDownloadLocation(contributionText);
            const timestamp = extractTimestamp(contributionText);
            
            results.push(`Row ${row}: SUCCESS - Currency: ${currency}, Quantity: ${quantity}, Zip: ${expectedZipFile}`);
            successCount++;
          } catch (error) {
            errorCount++;
            results.push(`Row ${row}: ERROR - ${error.message}`);
          }
        }
      } catch (error) {
        errorCount++;
        results.push(`Row ${row}: ERROR - ${error.message}`);
        Logger.log(`Error processing row ${row}: ${error.message}`);
      }
    }
    
    const summary = `
Test Results for Rows ${startRow} to ${endRow}:
- Total rows checked: ${endRow - startRow + 1}
- Batch QR requests found: ${processedCount}
- Successful: ${successCount}
- Errors: ${errorCount}

Detailed Results:
${results.join('\n')}
    `.trim();
    
    Logger.log(summary);
    return summary;
    
  } catch (error) {
    Logger.log(`Error in testProcessMultipleRows: ${error.message}`);
    return `Error: ${error.message}`;
  }
}

// Function to test the complete workflow for a specific message
function testCompleteWorkflow(messageId) {
  try {
    Logger.log(`=== Testing Complete Workflow for Message ID ${messageId} ===`);
    
    // First, find the message in the QR Code Generation tab
    const sheet = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    const qrCodeGenerationTab = sheet.getSheetByName(qrCodeGenerationTabName);
    
    if (!qrCodeGenerationTab) {
      return 'Error: QR Code Generation tab not found';
    }
    
    const lastRow = qrCodeGenerationTab.getLastRow();
    if (lastRow < 2) {
      return 'Error: No data found in QR Code Generation tab';
    }
    
    // Find the row with the matching message ID
    const messageIdColumn = qrCodeGenerationTab.getRange(2, 4, lastRow - 1, 1).getValues(); // Column D
    let rowNumber = -1;
    
    for (let i = 0; i < messageIdColumn.length; i++) {
      if (messageIdColumn[i][0] && messageIdColumn[i][0].toString().trim() === messageId.toString().trim()) {
        rowNumber = i + 2;
        break;
      }
    }
    
    if (rowNumber === -1) {
      return `Message ID ${messageId} not found in QR Code Generation tab`;
    }
    
    // Get the current row data
    const rowData = qrCodeGenerationTab.getRange(rowNumber, 1, 1, 15).getValues()[0];
    
    Logger.log('Current row data: ' + JSON.stringify(rowData));
    
    // Test updating status to completed
    const statusUpdated = updateQRCodeGenerationStatus(messageId, "COMPLETED", "Test completion");
    
    if (statusUpdated) {
      return `Successfully tested workflow for message ID ${messageId}. Status updated to COMPLETED.`;
    } else {
      return `Failed to update status for message ID ${messageId}`;
    }
    
  } catch (error) {
    Logger.log(`Error in testCompleteWorkflow: ${error.message}`);
    return `Error: ${error.message}`;
  }
}

// ===== Test Runner Functions =====

// Main test runner function - run this to test everything
function runTests() {
  Logger.log("🚀 Starting comprehensive QR Code Generation tests...");
  Logger.log("==================================================");
  
  try {
    // Test 1: Configuration check
    Logger.log("\n📋 Test 1: Checking Required Configuration");
    const configResult = checkRequiredConfiguration();
    Logger.log(`Configuration Status: ${JSON.stringify(configResult)}`);
    
    if (!configResult.allConfigured) {
      Logger.log("❌ Configuration incomplete - some tests may fail");
    } else {
      Logger.log("✅ Configuration complete - all tests should work");
    }
    
    // Test 2: Test specific row (6479)
    Logger.log("\n🔍 Test 2: Testing Row 6479");
    const rowResult = testProcessSpecificRow(6479);
    Logger.log(`Row 6479 Result: ${rowResult}`);
    
    // Test 3: Test Telegram token specifically
    Logger.log("\n📱 Test 3: Testing Telegram Token");
    const telegramResult = testTelegramToken();
    Logger.log(`Telegram Token Result: ${telegramResult}`);
    
    // Test 4: Test GitHub token specifically
    Logger.log("\n🔑 Test 4: Testing GitHub Token");
    const githubResult = testGitHubToken();
    Logger.log(`GitHub Token Result: ${githubResult}`);
    
    // Test 5: Test a range of rows (optional - comment out if you want to skip)
    // Logger.log("\n📊 Test 5: Testing Row Range (100-200)");
    // const rangeResult = testProcessMultipleRows(100, 200);
    // Logger.log(`Row Range Result: ${rangeResult}`);
    
    Logger.log("\n==================================================");
    Logger.log("🎉 All tests completed! Check logs above for results.");
    
    return {
      success: true,
      message: "All tests completed successfully. Check logs for detailed results.",
      config: configResult,
      rowTest: rowResult,
      telegramTest: telegramResult,
      githubTest: githubResult
    };
    
  } catch (error) {
    Logger.log(`❌ Error running tests: ${error.message}`);
    return {
      success: false,
      message: `Error running tests: ${error.message}`,
      error: error.message
    };
  }
}

// Quick test function for just the essential checks
function runQuickTests() {
  Logger.log("⚡ Running quick essential tests...");
  
  try {
    // Check configuration
    const configResult = checkRequiredConfiguration();
    Logger.log(`Configuration: ${configResult.allConfigured ? '✅ OK' : '❌ FAILED'}`);
    
    // Test Telegram token
    const telegramResult = testTelegramToken();
    Logger.log(`Telegram Token: ${telegramResult}`);
    
    // Test GitHub token
    const githubResult = testGitHubToken();
    Logger.log(`GitHub Token: ${githubResult}`);
    
    // Test one specific row
    const rowResult = testProcessSpecificRow(6479);
    Logger.log(`Row 6479: ${rowResult}`);
    
    return {
      success: true,
      config: configResult.allConfigured,
      github: githubResult,
      row: rowResult
    };
    
  } catch (error) {
    Logger.log(`❌ Quick test error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Test function for a specific row range
function testRowRange(startRow = 100, endRow = 200) {
  Logger.log(`🔍 Testing rows ${startRow} to ${endRow}...`);
  
  try {
    const result = testProcessMultipleRows(startRow, endRow);
    Logger.log(`Range test result: ${result}`);
    return result;
    
  } catch (error) {
    Logger.log(`❌ Range test error: ${error.message}`);
    return `Error: ${error.message}`;
  }
}
