// Configuration variables
const CONFIG = {
  // PRODUCTION
  // SPREADSHEET_ID: '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU',
  // SANDBOX
  SPREADSHEET_ID: '1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo',
  RECURRING_SHEET_NAME: 'Recurring Transactions',
  LEDGER_SHEET_NAME: 'Ledger history',
  CURRENT_DATE: '2025-06-29', // Hardcoded per context
  RECURRING_COLUMNS: {
    START_DATE: 6, // Column G
    DESCRIPTION: 0, // Column A
    CONTRIBUTOR: 1, // Column B
    TYPE: 2, // Column C
    AMOUNT: 3, // Column D
    FREQUENCY: 4, // Column E
    LAST_CHECK: 5 // Column F
  },
  LEDGER_COLUMNS: {
    CONTRIBUTOR: 0, // Column A
    START_DATE: 2, // Column C
    DESCRIPTION: 3, // Column D
    AMOUNT: 4, // Column E
    STATUS: 5, // Column F
    TOKEN_AMOUNT: 6, // Column G
    DATE: 7 // Column H
  },
  // Note: For Ledger history, the last row is considered the last row where Column A (contributor) is not empty
  LAST_ROW_COLUMN: 'A'
};

function isValidYYYYMMDD(dateStr) {
  // Ensure dateStr is a string or number, convert to string, and check if it matches YYYYMMDD format
  const str = String(dateStr).trim();
  if (!/^\d{8}$/.test(str)) return false;
  
  const year = parseInt(str.substring(0, 4), 10);
  const month = parseInt(str.substring(4, 6), 10) - 1; // JavaScript months are 0-based
  const day = parseInt(str.substring(6, 8), 10);
  
  // Create a date object to validate
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

function findFirstEightDigitString(inputString) {
  // Split the string into an array of lines
  const lines = inputString.split('\n');
  
  // Regular expression to match exactly 8 consecutive digits
  const regex = /\b\d{8}\b/;
  
  // Iterate through each line
  for (let line of lines) {
    // Trim whitespace and test for 8 consecutive digits
    if (regex.test(line.trim())) {
      // Return the first matching line
      return line.trim();
    }
  }
  
  // Return null if no match is found
  return null;
}

function fetchRecurringTransactions() {
  try {
    // Open the Google Sheet
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.RECURRING_SHEET_NAME);
    if (!sheet) {
      Logger.log(`Error: Sheet "${CONFIG.RECURRING_SHEET_NAME}" not found.`);
      return [];
    }
    
    // Get all data from the sheet
    const data = sheet.getDataRange().getValues();
    const headers = data[0]; // Assuming first row is headers
    const records = data.slice(1); // Skip header row
    
    // Array to store matching records
    const matchingRecords = [];
    
    // Iterate through records
    records.forEach((row, index) => {
      const startDate = row[CONFIG.RECURRING_COLUMNS.START_DATE];
      const description = row[CONFIG.RECURRING_COLUMNS.DESCRIPTION];
      const contributor = row[CONFIG.RECURRING_COLUMNS.CONTRIBUTOR];
      const type = row[CONFIG.RECURRING_COLUMNS.TYPE];
      const amount = row[CONFIG.RECURRING_COLUMNS.AMOUNT];
      const frequency = row[CONFIG.RECURRING_COLUMNS.FREQUENCY];
      const lastCheck = row[CONFIG.RECURRING_COLUMNS.LAST_CHECK];
      
      // Extract YYYYMMDD for startDate and description (both from Column A)
      const startDateStr = String(startDate);
      const descriptionStr = description;
      const lastCheckStr = lastCheck && isValidYYYYMMDD(lastCheck) ? String(lastCheck).padStart(8, '0') : 'N/A';

      // Check if the row matches the criteria
      if (
        type === 'Tokenization' && // Column C
        typeof amount === 'number' && !isNaN(amount) && // Column D is numerical
        frequency === 'Monthly' && // Column E
        startDateStr !== 'N/A' // Valid startDate/description
      ) {
        // Store matching record
        matchingRecords.push({
          row: index + 2, // 1-based row number (add 2 for header and 0-based index)
          startDate: startDateStr,
          description: descriptionStr,
          contributor: contributor || 'N/A',
          amount: amount,
          lastCheck: lastCheckStr
        });
      }
    });
    Logger.log(matchingRecords)
    
    return matchingRecords;
    
  } catch (e) {
    Logger.log('Error in fetchRecurringTransactions: ' + e.message);
    return [];
  }
}

function calculateTokenizationDates(start_date, recent_check_date) {
  // Current date from config
  const currentDate = new Date(CONFIG.CURRENT_DATE);
  
  // Initialize array for tokenization dates
  const tokenizationDates = [];
  
  // Validate input dates
  if (!start_date || !recent_check_date || start_date === 'N/A' || recent_check_date === 'N/A') {
    return tokenizationDates; // Return empty array if inputs are invalid
  }
  
  // Parse start_date (YYYYMMDD) to extract the day of the month
  const year = parseInt(start_date.substring(0, 4), 10);
  const month = parseInt(start_date.substring(4, 6), 10) - 1; // JavaScript months are 0-based
  const day = parseInt(start_date.substring(6, 8), 10);
  
  // Parse recent_check_date (YYYYMMDD)
  const lastCheckYear = parseInt(recent_check_date.substring(0, 4), 10);
  const lastCheckMonth = parseInt(recent_check_date.substring(4, 6), 10) - 1;
  const lastCheckDay = parseInt(recent_check_date.substring(6, 8), 10);
  const lastCheckDate = new Date(lastCheckYear, lastCheckMonth, lastCheckDay);
  
  // Start from the month after recent_check_date
  let currentTokenizationDate = new Date(lastCheckDate);
  currentTokenizationDate.setMonth(currentTokenizationDate.getMonth() + 1);
  currentTokenizationDate.setDate(day); // Set to the same day as start_date
  
  // Generate tokenization dates until current date
  while (currentTokenizationDate <= currentDate) {
    // Adjust for invalid dates (e.g., Feb 30 -> Feb 28)
    const year = currentTokenizationDate.getFullYear();
    const month = currentTokenizationDate.getMonth();
    const maxDay = new Date(year, month + 1, 0).getDate(); // Last day of the month
    const adjustedDay = Math.min(day, maxDay);
    currentTokenizationDate.setDate(adjustedDay);
    
    // Format date as YYYYMMDD
    const formattedDate = Utilities.formatDate(currentTokenizationDate, 'GMT', 'yyyyMMdd');
    tokenizationDates.push(formattedDate);
    
    // Move to next month
    currentTokenizationDate.setMonth(currentTokenizationDate.getMonth() + 1);
  }
  
  return tokenizationDates;
}

function tokenizedAlready(contributor, description, expected_date) {
  try {
    // Open the Ledger history sheet
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.LEDGER_SHEET_NAME);
    if (!sheet) {
      Logger.log(`Error: Sheet "${CONFIG.LEDGER_SHEET_NAME}" not found.`);
      return false;
    }
    
    // Get all data from the sheet
    const data = sheet.getDataRange().getValues();
    const records = data.slice(1); // Skip header row
    
    // Check if the record exists
    return records.some(row => {
      const ledgerContributor = row[CONFIG.LEDGER_COLUMNS.CONTRIBUTOR] || 'N/A'; // Column A
      const ledgerStartDate = row[CONFIG.LEDGER_COLUMNS.START_DATE] ? String(row[CONFIG.LEDGER_COLUMNS.START_DATE]).padStart(8, '0') : 'N/A'; // Column C
      const ledgerDate = row[CONFIG.LEDGER_COLUMNS.DATE] ? String(row[CONFIG.LEDGER_COLUMNS.DATE]).padStart(8, '0') : 'N/A'; // Column H
      return ledgerContributor === contributor && ledgerStartDate === description && ledgerDate === expected_date;
    });
    
  } catch (e) {
    Logger.log('Error in tokenizedAlready: ' + e.message);
    return false;
  }
}

function tokenizeRecord(record, expected_date) {
  try {
    // Open both sheets
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const recurringSheet = spreadsheet.getSheetByName(CONFIG.RECURRING_SHEET_NAME);
    const ledgerSheet = spreadsheet.getSheetByName(CONFIG.LEDGER_SHEET_NAME);
    
    if (!recurringSheet || !ledgerSheet) {
      Logger.log('Error: One or both sheets not found.');
      return;
    }
    
    // Find the last row where Column A is not empty in Ledger history
    const lastRow = ledgerSheet.getLastRow();
    let targetRow = 2; // Start after header
    for (let i = 2; i <= lastRow; i++) {
      const cellValue = ledgerSheet.getRange(`${CONFIG.LAST_ROW_COLUMN}${i}`).getValue();
      if (cellValue !== '') {
        targetRow = i + 1; // Next row after the last non-empty Column A
      }
    }
    
    // Add new record to Ledger history at targetRow
    ledgerSheet.getRange(targetRow, 1, 1, 8).setValues([[
      record.contributor, // Column A: Contributor from Recurring Transactions
      '', // Column B: Empty as not specified
      record.startDate, // Column C: Start Date from Recurring Transactions
      '1TDG For every 1 USD of liquidity injected', // Column D: Hardcoded
      record.amount, // Column E: Amount from Recurring Transactions
      'Successfully Completed / Full Provision Awarded', // Column F: Hardcoded
      record.amount, // Column G: Amount from Recurring Transactions
      expected_date // Column H: Expected tokenization date
    ]]);
    
    // Update Last Check (Column F) in Recurring Transactions to current date
    const currentDate = Utilities.formatDate(new Date(CONFIG.CURRENT_DATE), 'GMT', 'yyyyMMdd');
    recurringSheet.getRange(record.row, CONFIG.RECURRING_COLUMNS.LAST_CHECK + 1).setValue(currentDate); // Column F is 1-based
    
    Logger.log(`Row ${record.row} (Contributor: ${record.contributor}): Tokenized for ${expected_date} at Ledger history row ${targetRow}`);
    
  } catch (e) {
    Logger.log('Error in tokenizeRecord: ' + e.message);
  }
}

function processRecurringTransactions() {
  // Step 1: Fetch matching recurring transactions
  const matchingRecords = fetchRecurringTransactions();
  
  // Step 2: Process each record
  if (matchingRecords.length > 0) {
    Logger.log('Processing Recurring Transactions:');
    matchingRecords.forEach(record => {
      Logger.log(record);
      // Step 2: Get expected tokenization dates
      const tokenizationDates = calculateTokenizationDates(record.startDate, record.lastCheck);
      Logger.log(tokenizationDates);

      // Step 3 & 4: Check each date and tokenize if not already done
      tokenizationDates.forEach(expected_date => {
        Logger.log("checking " + expected_date);
        if (!tokenizedAlready(record.contributor, record.description, expected_date)) {
          Logger.log("Tokenizing " + expected_date);
          tokenizeRecord(record, expected_date);
        } else {
          Logger.log(`Row ${record.row} (Contributor: ${record.contributor}): Already tokenized for ${expected_date}`);
        }
      });
    });
  } else {
    Logger.log('No matching recurring transactions found.');
  }
}

function testCalculateTokenizationDates() {
  Logger.log(calculateTokenizationDates("20250104", "20250405"));
}

function testRegex(){
  startDate = "Aga Marecka - Poland Warehousing\n Start Date: 20250404";
  const match = startDate ? String(startDate).trim().match(/\d{8}/) : null;
  Logger.log(match);
}