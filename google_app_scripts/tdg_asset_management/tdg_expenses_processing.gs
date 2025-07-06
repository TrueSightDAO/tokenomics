// Load API keys and configuration settings
setApiKeys();
const creds = getCredentials();

// Configuration Variables
const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';
const SOURCE_SHEET_NAME = 'Telegram Chat Logs';
const SCORED_EXPENSE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/15co4NYVdlhOFK7y2EfyajXJ0aSj7OfezUndYoY6BNrY/edit?gid=0#gid=0';
const SCORED_EXPENSE_SHEET_NAME = 'Scored Expense Submissions';
const OFFCHAIN_TRANSACTIONS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo/edit?usp=drive_web&ouid=115975718038592349436';
const OFFCHAIN_TRANSACTIONS_SHEET_NAME = 'offchain transactions';
const CONTRIBUTORS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit?gid=1460794618#gid=1460794618';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';

// Column indices for source sheet (Telegram Chat Logs)
const TELEGRAM_UPDATE_ID_COL = 0; // Column A
const CHAT_ID_COL = 1; // Column B (Telegram Chat ID)
const CHAT_NAME_COL = 2; // Column C (Telegram Chatroom Name)
const TELEGRAM_MESSAGE_ID_COL = 3; // Column D
const CONTRIBUTOR_NAME_COL = 4; // Column E (Reporter Name)
const MESSAGE_COL = 6; // Column G (Expense Reported)
const SALES_DATE_COL = 11; // Column L (Status Date)
const HASH_KEY_COL = 13; // Column N (Scoring Hash Key)

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
      // Convert signed byte to unsigned hex
      const hex = (byte & 0xFF).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    // Return first 16 characters for brevity
    return hash.substring(0, 16);
  } catch (e) {
    Logger.log(`Error generating hash key: ${e.message}`);
    return '';
  }
}

// Function to check if reporterName exists in Contributors sheet Column H (case-insensitive, with or without @)
function ReporterExist(reporterName) {
  try {
    const contributorsSpreadsheet = SpreadsheetApp.openByUrl(CONTRIBUTORS_SHEET_URL);
    const contributorsSheet = contributorsSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);
    const contributorsData = contributorsSheet.getDataRange().getValues();
    
    // Normalize reporterName for comparison
    const normalizedReporterName = reporterName.toLowerCase().replace(/^@/, '');
    
    // Skip header row
    for (let i = 1; i < contributorsData.length; i++) {
      const telegramHandle = contributorsData[i][TELEGRAM_HANDLE_COL_CONTRIBUTORS];
      if (telegramHandle) {
        // Normalize telegram handle for comparison
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
  const pattern = /\[DAO Inventory Expense Event\]\n- DAO Member Name: (.*?)\n- Inventory Type: (.*?)\n- Inventory Quantity: (\d+)\n- Expense Description: (.*)/i;
  const match = message.match(pattern);
  if (match) {
    return {
      daoMemberName: match[1],
      inventoryType: match[2],
      quantity: parseInt(match[3], 10),
      description: match[4]
    };
  }
  return null;
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
      scoredRow[DEST_STATUS_DATE_COL], // Column A: Status date
      `${scoredRow[DEST_EXPENSE_REPORTED_COL]} reported by ${scoredRow[DEST_CHAT_NAME_COL]} Scoring Hash Key: ${scoredRow[DEST_HASH_KEY_COL]}`, // Column B: Description
      expenseDetails.daoMemberName, // Column C: Fund Handler (DAO Member Name)
      expenseDetails.quantity, // Column D: Amount (Inventory Quantity)
      expenseDetails.inventoryType // Column E: Inventory Type
    ];

    const lastRow = offchainSheet.getLastRow();
    offchainSheet.getRange(lastRow + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
    Logger.log(`Inserted transaction record at row ${lastRow + 1} for hash key ${scoredRow[DEST_HASH_KEY_COL]}`);
    return lastRow + 1; // Return the 1-based row number
  } catch (e) {
    Logger.log(`Error inserting into offchain transactions sheet: ${e.message}`);
    return null;
  }
}

// Main function to parse and process Telegram logs for DAO expense events
function parseAndProcessTelegramLogs() {
  try {
    // Get source and destination spreadsheets
    const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const scoredExpenseSpreadsheet = SpreadsheetApp.openByUrl(SCORED_EXPENSE_SHEET_URL);
    const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    const scoredExpenseSheet = scoredExpenseSpreadsheet.getSheetByName(SCORED_EXPENSE_SHEET_NAME);
    
    // Get data from source and destination sheets
    const sourceData = sourceSheet.getDataRange().getValues();
    const scoredData = scoredExpenseSheet.getDataRange().getValues();
    
    // Get existing hash keys from Scored Expense Submissions sheet to check for duplicates
    const existingHashKeys = scoredData.slice(1).map(row => row[DEST_HASH_KEY_COL]).filter(key => key);
    
    let newEntries = 0;
    
    // Pattern for DAO Inventory Expense Event
    const expensePattern = /\[DAO Inventory Expense Event\]/i;
    
    // Process source data, skipping header row
    for (let i = 1; i < sourceData.length; i++) {
      const message = sourceData[i][MESSAGE_COL];
      
      // Extract expense details early to use for hash key generation
      const expenseDetails = extractExpenseDetails(message);
      if (!expenseDetails) {
        Logger.log(`Skipping row ${i + 1} due to invalid expense details`);
        continue;
      }
      
      // Generate hash key
      const hashKey = generateHashKey(
        sourceData[i][TELEGRAM_MESSAGE_ID_COL],
        expenseDetails.daoMemberName,
        sourceData[i][SALES_DATE_COL]
      );
      
      Logger.log(message + " \npattern match: " + expensePattern.test(message) + " \nprocessed: " + existingHashKeys.includes(hashKey));
      Logger.log("To process: " + (expensePattern.test(message) && !existingHashKeys.includes(hashKey)));
      
      // Check if message matches the expense pattern and hash key is not already processed
      if (expensePattern.test(message) && !existingHashKeys.includes(hashKey)) {
        Logger.log("Line 148: new line detected");
        // Validate reporter name against Contributors sheet
        const reporterName = sourceData[i][CONTRIBUTOR_NAME_COL];
        if (!ReporterExist(reporterName)) {
          Logger.log(`Skipping row ${i + 1} due to invalid reporter: ${reporterName}`);
          continue;
        }
        
        // Prepare row for Scored Expense Submissions
        const rowToAppend = [
          sourceData[i][TELEGRAM_UPDATE_ID_COL], // Column A: Telegram Update ID
          sourceData[i][CHAT_ID_COL], // Column B: Telegram Chatroom ID
          sourceData[i][CHAT_NAME_COL], // Column C: Telegram Chatroom Name
          sourceData[i][TELEGRAM_MESSAGE_ID_COL], // Column D: Telegram Message ID
          reporterName, // Column E: Reporter Name
          message, // Column F: Expense Reported
          sourceData[i][SALES_DATE_COL], // Column G: Status Date
          expenseDetails.daoMemberName, // Column H: Contributor Name
          expenseDetails.inventoryType, // Column I: Currency (Inventory Type)
          expenseDetails.quantity, // Column J: Amount
          hashKey, // Column K: Scoring Hash Key
          '' // Column L: Transaction Line (to be updated)
        ];
        
        // Append to Scored Expense Submissions
        const lastRow = scoredExpenseSheet.getLastRow();
        scoredExpenseSheet.getRange(lastRow + 1, 1, 1, rowToAppend.length).setValues([rowToAppend]);
        
        // Insert into offchain transactions and get the transaction row number
        const transactionRowNumber = InsertExpenseRecords(rowToAppend, i);
        
        // Update Column L in Scored Expense Submissions with the transaction row number
        if (transactionRowNumber) {
          scoredExpenseSheet.getRange(lastRow + 1, DEST_TRANSACTION_LINE_COL + 1).setValue(transactionRowNumber);
        }
        
        // Update existing hash keys and increment counter
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