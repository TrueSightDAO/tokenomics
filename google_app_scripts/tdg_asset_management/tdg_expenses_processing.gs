// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const SCORED_EXPENSE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/15co4NYVdlhOFK7y2EfyajXJ0aSj7OfezUndYoY6BNrY/edit?gid=0#gid=0';
const SCORED_EXPENSE_SHEET_NAME = 'Scored Expense Submissions';


// Sandbox
const OFFCHAIN_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo/edit?usp=drive_web&ouid=115975718038592349436';

// Production
// const OFFCHAIN_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0';

const OFFCHAIN_TRANSACTIONS_SHEET_NAME = 'offchain transactions';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const TELEGRAM_CHAT_ID = '-1002190388985'; // Fixed chat ID from reference code

// Column indices for source sheet (Telegram Chat Logs)
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B (Telegram Chat ID)
const CHAT_NAME_COL = 2; // Column C (Telegram Chatroom Name)
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E (Reporter Name)
const MESSAGE_COL = 6; // Column G (Expense Reported)
const SALES_DATE_COL = 11; // Column L (Status Date)
const HASH_KEY_COL = 13; // Column N (Scoring Hash Key)
const TELEGRAM_FILE_ID_COL = 14; // Column O (Telegram File ID)

// Column indices for Scored Expense Submissions sheet
const DEST_UPDATE_ID_COL = 0; // Column A
const DEST_CHAT_ID_COL = 1; // Column B
const DEST_CHAT_NAME_COL = 2; // Column C
const DEST_MESSAGE_ID_COL = 3; // Column D
const DEST_REPORTER_NAME_COL = 4; // Column E
const DEST_EXPENSE_REPORTED_COL = 5; // Column F
const DEST_STATUS_DATE_COL = 6; // Column G
const DEST_CONTRIBUTOR_NAME = 7; // Column H
const DEST_CURRENCY = 8; // Column I
const DEST_AMOUNT = 9; // Column J
const DEST_HASH_KEY_COL = 10; // Column K
const DEST_TRANSACTION_LINE_COL = 11; // Column L

// Column indices for Contributors sheet
const TELEGRAM_HANDLE_COL_CONTRIBUTORS = 7; // Column H (Telegram Handle)

// Column indices for offchain transactions sheet
const TRANSACTION_STATUS_DATE_COL = 0; // Column A
const TRANSACTION_DESCRIPTION_COL = 1; // Column B
const TRANSACTION_FUND_HANDLER_COL = 2; // Column C
const TRANSACTION_AMOUNT_COL = 3; // Column D
const TRANSACTION_INVENTORY_TYPE_COL = 4; // Column E

// Function to generate a SHA-256 hash key
function generateHashKey(messageId, daoMemberName, salesDate) {
  try {
    const input = `${messageId}-${daoMemberName}-${salesDate}`;
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
    // Convert byte array to hex string
    const hash = digest.map(byte => {
      const hex = (byte & 0xFF).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    return hash.substring(0, 16);
  } catch (e) {
    Logger.log(`Error generating hash key: ${e.message}`);
    return '';
  }
}

// Function to check if reporterName exists in Contributors sheet Column H
function ReporterExist(reporterName) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    const normalizedReporterName = reporterName.toLowerCase().replace(/^@/, '');
    
    for (let i = 1; i < contributorsData.length; i++) {
      const telegramHandle = contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS];
      if (telegramHandle) {
        const normalizedHandle = telegramHandle.toLowerCase().replace(/^@/, '');
        Logger.log(normalizedHandle + " versus " + normalizedReporterName);
        if (normalizedHandle === normalizedReporterName) {
          return true;
        }
      }
    }
    Logger.log(`Invalid contributor: ${reporterName} not found in Contributors sheet Column H`);
    return false;
  } catch (e) {
    Logger.log(`Error accessing Contributors sheet for validation: ${e.message}`);
    return false;
  }
}

// Function to extract expense details from message using regex
function extractExpenseDetails(message) {
  const pattern = /\[DAO Inventory Expense Event\]\n- DAO Member Name: (.*?)\n- (?:Latitude: (.*?)\n- Longitude: (.*?)\n- )?Inventory Type: (.*?)\n- Inventory Quantity: (\d+\.?\d*)\n- Description: (.*?)(?:\n- Attached Filename: (.*?))?(?:\n- Destination Expense File Location: (.*?))?(?:\n- Submission Source: (.*?))?(?:\n-+\nMy Digital Signature:.*)?$/i;
  const match = message.match(pattern);
  if (match) {
    return {
      daoMemberName: match[1],
      latitude: match[2] || null,
      longitude: match[3] || null,
      inventoryType: match[4],
      quantity: parseFloat(match[5]),
      description: match[6],
      attachedFilename: match[7] || null,
      destinationFileLocation: match[8] || null,
      submissionSource: match[9] || null
    };
  }
  return null;
}

// Function to check Telegram file ID and get from previous row if needed
function getTelegramFileId(sourceSheet, currentRowIndex, sourceData) {
  try {
    // Check current row's Column O
    let fileId = sourceData[currentRowIndex][TELEGRAM_FILE_ID_COL];
    if (fileId) {
      return fileId;
    }
    
    // If not found, check previous row
    if (currentRowIndex > 1) {
      fileId = sourceData[currentRowIndex - 1][TELEGRAM_FILE_ID_COL];
      return fileId || null;
    }
    
    return null;
  } catch (e) {
    Logger.log(`Error checking Telegram file ID: ${e.message}`);
    return null;
  }
}

// Function to check if file exists in GitHub
function checkFileExistsInGitHub(fileUrl) {
  try {
    const options = {
      method: 'get',
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(fileUrl, options);
    return response.getResponseCode() === 200;
  } catch (e) {
    Logger.log(`Error checking file existence in GitHub: ${e.message}`);
    return false;
  }
}

// Function to upload file to GitHub
function uploadFileToGitHub(fileId, destinationUrl, commitMessage) {
  try {
    const token = creds.GITHUB_API_TOKEN;
    if (!token) {
      Logger.log(`uploadFileToGitHub: Error: GITHUB_API_TOKEN not set in Credentials`);
      return false;
    }

    // Get file content from Telegram
    const telegramApiUrl = `https://api.telegram.org/bot${creds.TELEGRAM_API_TOKEN}/getFile?file_id=${fileId}`;
    const fileResponse = UrlFetchApp.fetch(telegramApiUrl);
    const fileData = JSON.parse(fileResponse.getContentText());
    
    if (!fileData.ok) {
      Logger.log(`Failed to get file info from Telegram: ${fileData.description}`);
      return false;
    }

    const filePath = fileData.result.file_path;
    const fileContentResponse = UrlFetchApp.fetch(`https://api.telegram.org/file/bot${creds.TELEGRAM_API_TOKEN}/${filePath}`);
    const fileContent = Utilities.base64Encode(fileContentResponse.getBlob().getBytes());

    // Parse GitHub URL to get repo details
    const urlPattern = /github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/i;
    const match = destinationUrl.match(urlPattern);
    if (!match) {
      Logger.log(`Invalid GitHub URL format: ${destinationUrl}`);
      return false;
    }

    const [, owner, repo, branch, path] = match;
    
    // GitHub API request to create/update file
    const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const payload = {
      message: commitMessage,
      content: fileContent,
      branch: branch
    };

    const options = {
      method: 'put',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(githubApiUrl, options);
    const status = response.getResponseCode();
    if (status === 200 || status === 201) {
      Logger.log(`Successfully uploaded file to GitHub: ${destinationUrl}`);
      return true;
    } else {
      Logger.log(`Failed to upload file to GitHub. Status: ${status}, Response: ${response.getContentText()}`);
      return false;
    }
  } catch (e) {
    Logger.log(`Error uploading file to GitHub: ${e.message}`);
    return false;
  }
}

// Function to insert records into offchain transactions sheet
function InsertExpenseRecords(scoredRow, rowIndex) {
  try {
    const offchainSpreadsheet = SpreadsheetApp.openByUrl(OFFCHAIN_TRANSACTIONS_SHEET_URL);
    const offchainSheet = offchainSpreadsheet.getSheetByName(OFFCHAIN_TRANSACTIONS_SHEET_NAME);
    
    const expenseDetails = extractExpenseDetails(scoredRow[DEST_EXPENSE_REPORTED_COL]);
    if (!expenseDetails) {
      Logger.log(`Failed to extract expense details for row ${rowIndex + 1}`);
      return null;
    }

    const rowToAppend = [
      scoredRow[DEST_STATUS_DATE_COL],
      `${scoredRow[DEST_EXPENSE_REPORTED_COL]} reported by ${scoredRow[DEST_CHAT_NAME_COL]} \n\n\nAutomated processing by Edgar via script: https://github.com/TrueSightDAO/tokenomics/blob/main/google_app_scripts/tdg_asset_management/tdg_expenses_processing.gs\n\nEdgar Scoring Hash Key: ${scoredRow[DEST_HASH_KEY_COL]}`,
      expenseDetails.daoMemberName,
      expenseDetails.quantity * -1,
      expenseDetails.inventoryType
    ];

    const lastRow = offchainSheet.getLastRow();
    offchainSheet.getRange(lastRow + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
    Logger.log(`Inserted transaction record at row ${lastRow + 1} for hash key ${scoredRow[DEST_HASH_KEY_COL]}`);
    return lastRow + 1;
  } catch (e) {
    Logger.log(`Error inserting into offchain transactions sheet: ${e.message}`);
    return null;
  }
}

// Function to send Telegram notification for expense submission
function sendExpenseNotification(rowData, scoredRowNumber, transactionRowNumber) {
  const token = creds.TELEGRAM_API_TOKEN;
  if (!token) {
    Logger.log(`sendExpenseNotification: Error: TELEGRAM_API_TOKEN not set in Credentials`);
    return;
  }

  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const outputSheetLink = `https://truesight.me/physical-transactions/expenses`;

  const messageText = `New DAO Inventory Expense Recorded\n\n` +
    `Scored Expense Submissions Row: ${scoredRowNumber}\n` +
    `Telegram Update ID: ${rowData[DEST_UPDATE_ID_COL]}\n` +
    `Chatroom ID: ${rowData[DEST_CHAT_ID_COL]}\n` +
    `Chatroom Name: ${rowData[DEST_CHAT_NAME_COL]}\n` +
    `Message ID: ${rowData[DEST_MESSAGE_ID_COL]}\n` +
    `Reporter Name: ${rowData[DEST_REPORTER_NAME_COL]}\n` +
    `Expense Reported:\n${rowData[DEST_EXPENSE_REPORTED_COL]}\n` +
    `Status Date: ${rowData[DEST_STATUS_DATE_COL]}\n` +
    `Contributor Name: ${rowData[DEST_CONTRIBUTOR_NAME]}\n` +
    `Currency: ${rowData[DEST_CURRENCY]}\n` +
    `Amount: ${rowData[DEST_AMOUNT]}\n` +
    `Hash Key: ${rowData[DEST_HASH_KEY_COL]}\n` +
    `Offchain Transaction Row: ${transactionRowNumber || 'Not recorded'}\n\n` +
    `Review here: ${outputSheetLink}`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: messageText
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    Logger.log(`sendExpenseNotification: Sending notification for hash key ${rowData[DEST_HASH_KEY_COL]} to chat ${TELEGRAM_CHAT_ID}`);
    const response = UrlFetchApp.fetch(apiUrl, options);
    const status = response.getResponseCode();
    const responseText = response.getContentText();
    if (status === 200) {
      Logger.log(`sendExpenseNotification: Successfully sent notification for hash key ${rowData[DEST_HASH_KEY_COL]} to chat ${TELEGRAM_CHAT_ID}`);
    } else {
      Logger.log(`sendExpenseNotification: Failed to send notification for hash key ${rowData[DEST_HASH_KEY_COL]}. Status: ${status}, Response: ${responseText}`);
    }
  } catch (e) {
    Logger.log(`sendExpenseNotification: Error sending Telegram notification for hash key ${rowData[DEST_HASH_KEY_COL]}: ${e.message}`);
  }
}

// Main function to parse and process Telegram logs for DAO expense events
function parseAndProcessTelegramLogs() {
  try {
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const scoredExpenseSpreadsheet = SpreadsheetApp.openByUrl(SCORED_EXPENSE_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    const scoredExpenseSheet = scoredExpenseSpreadsheet.getSheetByName(SCORED_EXPENSE_SHEET_NAME);
    
    const sourceData = sourceSheet.getDataRange().getValues();
    const scoredData = scoredExpenseSheet.getDataRange().getValues();
    
    const existingHashKeys = scoredData.slice(1).map(row => row[DEST_HASH_KEY_COL]).filter(key => key);
    
    let newEntries = 0;
    const expensePattern = /\[DAO Inventory Expense Event\]/i;
    
    for (let i = 1; i < sourceData.length; i++) {
      const message = sourceData[i][MESSAGE_COL];
      
      const expenseDetails = extractExpenseDetails(message);
      Logger.log(message);
      Logger.log(expenseDetails);
      if (!expenseDetails) {
        Logger.log(`Skipping row ${i + 1} due to invalid expense details`);
        continue;
      }
      
      const hashKey = generateHashKey(
        sourceData[i][TELEGRAM_MESSAGE_ID_COL],
        expenseDetails.daoMemberName,
        sourceData[i][SALES_DATE_COL]
      );
      
      Logger.log(message + " \npattern match: " + expensePattern.test(message) + " \nprocessed: " + existingHashKeys.includes(hashKey));
      Logger.log("To process: " + (expensePattern.test(message) && !existingHashKeys.includes(hashKey)));
      
      if (expensePattern.test(message) && !existingHashKeys.includes(hashKey)) {
        Logger.log("Line 148: new line detected");
        const reporterName = sourceData[i][CONTRIBUTOR_NAME_COL];
        if (!ReporterExist(reporterName)) {
          Logger.log(`Skipping row ${i + 1} due to invalid reporter: ${reporterName}`);
          continue;
        }
        
        // Check for Telegram file ID and upload if needed
        if (expenseDetails.attachedFilename && expenseDetails.destinationFileLocation) {
          const fileId = getTelegramFileId(sourceSheet, i, sourceData);
          if (fileId && !checkFileExistsInGitHub(expenseDetails.destinationFileLocation)) {
            const uploaded = uploadFileToGitHub(fileId, expenseDetails.destinationFileLocation, message);
            if (uploaded) {
              Logger.log(`Successfully uploaded file ${expenseDetails.attachedFilename} for row ${i + 1}`);
            } else {
              Logger.log(`Failed to upload file ${expenseDetails.attachedFilename} for row ${i + 1}`);
            }
          } else if (!fileId) {
            Logger.log(`No Telegram file ID found for row ${i + 1}`);
          } else {
            Logger.log(`File already exists at ${expenseDetails.destinationFileLocation}, skipping upload`);
          }
        }
        
        const rowToAppend = [
          sourceData[i][TELEGRAM_UPDATE_ID_COL],
          sourceData[i][CHAT_ID_COL],
          sourceData[i][CHAT_NAME_COL],
          sourceData[i][TELEGRAM_MESSAGE_ID_COL],
          reporterName,
          message,
          sourceData[i][SALES_DATE_COL],
          expenseDetails.daoMemberName,
          expenseDetails.inventoryType,
          expenseDetails.quantity * -1,
          hashKey,
          ''
        ];
        
        const lastRow = scoredExpenseSheet.getLastRow();
        const scoredRowNumber = lastRow + 1;
        scoredExpenseSheet.getRange(scoredRowNumber, 1, 1, rowToAppend.length).setValues([rowToAppend]);
        
        const transactionRowNumber = InsertExpenseRecords(rowToAppend, i);
        
        if (transactionRowNumber) {
          scoredExpenseSheet.getRange(scoredRowNumber, DEST_TRANSACTION_LINE_COL + 1).setValue(transactionRowNumber);
        }
        
        sendExpenseNotification(rowToAppend, scoredRowNumber, transactionRowNumber);
        
        existingHashKeys.push(hashKey);
        newEntries++;
        
        Logger.log(`Processed row ${i + 1} with hash key: ${hashKey}`);
      }
    }
    
    Logger.log(`Processed ${sourceData.length - 1} rows, added ${newEntries} new expense entries.`);
  } catch (e) {
    Logger.log(`Error in parseAndProcessTelegramLogs: ${e.message}`);
  }
}

function doGet(e) {
  const action = e.parameter?.action;
  if (action === 'parseAndProcessTelegramLogs') {
    try {
      Logger.log("Webhook triggered: processing Telegram logs");
      parseAndProcessTelegramLogs();
      return ContentService.createTextOutput("✅ Telegram logs processed");
    } catch (err) {
      Logger.log("Error in processTelegramLogs: " + err.message);
      return ContentService.createTextOutput("❌ Error: " + err.message);
    }
  }

  return ContentService.createTextOutput("ℹ️ No valid action specified");
}