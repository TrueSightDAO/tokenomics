/**
 * File: google_app_scripts/tdg_scoring/transfer_scored_contributions_to_main_ledger.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * 
 * Description: Transfers approved scored contributions from the Grok spreadsheet to the main ledger history.
 */

/**
 * Google Apps Script to transfer records from "Scored Chatlogs" sheet to "Ledger history" sheet
 * based on hash_key matching and specific conditions.
 */

// Variable declarations
const ORIGIN_SPREADSHEET_ID = '1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo';
const ORIGIN_SHEET_NAME = 'Scored Chatlogs';


// Sandbox
// const DESTINATION_SPREADSHEET_ID = '1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo';

// Production
const DESTINATION_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';

const DESTINATION_SHEET_NAME = 'Ledger history';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const REVIEWED_STATUS = 'Reviewed';
const COMPLETED_STATUS = 'Successfully Completed / Full Provision Awarded';
const TRANSFERRED_STATUS = 'Transferred to Main Ledger';
const ERROR_STATUS = 'Entry Error';
const ERROR_CONTRIBUTOR_NOT_FOUND = 'Entry Error - Contributor Not Found';
const IGNORED_STATUS = 'Ignored';

/**
 * Transfers a row from the origin sheet to the destination sheet based on hash_key.
 * @param {string} hash_key - The hash key to match in Column K of the origin sheet.
 */
function transferRowByHashKey(hash_key) {
  Logger.log(`Processing hash_key: ${hash_key}`);
  try {
    // Open the origin and destination spreadsheets
    const originSpreadsheet = SpreadsheetApp.openById(ORIGIN_SPREADSHEET_ID);
    const originSheet = originSpreadsheet.getSheetByName(ORIGIN_SHEET_NAME);
    const destinationSpreadsheet = SpreadsheetApp.openById(DESTINATION_SPREADSHEET_ID);
    const destinationSheet = destinationSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
    const contributorsSheet = destinationSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);

    // Get data from origin sheet
    const originData = originSheet.getDataRange().getValues();
    let rowIndex = -1;

    // Find the row with matching hash_key in Column K (index 10)
    for (let i = 1; i < originData.length; i++) {
      if (originData[i][10] === hash_key) { // Column K is index 10 (0-based)
        rowIndex = i + 1; // 1-based row index for sheet operations
        break;
      }
    }

    // If no matching hash_key found, log and exit
    if (rowIndex === -1) {
      Logger.log(`No row found with hash_key: ${hash_key}`);
      return;
    }

    // Get the row data
    const rowData = originData[rowIndex - 1]; // 0-based index for array

    // Check Column F (index 5) for "Reviewed" and Column G (index 6) for non-zero
    const status = rowData[5];
    const valueG = rowData[6];

    if (status === REVIEWED_STATUS && valueG !== 0) {
      // Validate Column A against Contributors contact information
      let columnAValue = rowData[0];
      const contributorsData = contributorsSheet.getDataRange().getValues();
      let found = false;

      // Check if Column A value exists in Contributors Column A
      for (let i = 1; i < contributorsData.length; i++) {
        if (contributorsData[i][0] === columnAValue) {
          found = true;
          break;
        }
      }

      // If not found, check Column H for matching handle (with or without @)
      if (!found) {
        const handle = columnAValue.startsWith('@') ? columnAValue.slice(1) : columnAValue;
        const handleWithAt = '@' + handle;
        for (let i = 1; i < contributorsData.length; i++) {
          if (contributorsData[i][7] === handle || contributorsData[i][7] === handleWithAt) {
            columnAValue = contributorsData[i][0]; // Use corresponding Column A value
            found = true;
            break;
          }
        }
      }

      // If contributor not found, mark as error and exit
      if (!found) {
        originSheet.getRange(rowIndex, 6).setValue(ERROR_CONTRIBUTOR_NOT_FOUND);
        Logger.log(`Contributor not found for hash_key ${hash_key}: ${rowData[0]}`);
        return;
      }

      // Prepare data for destination sheet
      const destinationRow = [
        columnAValue, // Column A (validated)
        rowData[1], // Column B
        rowData[2], // Column C
        rowData[3], // Column D
        rowData[4], // Column E
        COMPLETED_STATUS, // Column F
        rowData[6], // Column G
        rowData[7]  // Column H
      ];

      // Find the last non-empty row in Column A of destination sheet
      const destData = destinationSheet.getDataRange().getValues();
      let lastNonEmptyRow = 1;
      for (let i = 1; i < destData.length; i++) {
        if (destData[i][0] !== '') {
          lastNonEmptyRow = i + 1;
        }
      }

      // Append to destination sheet at the correct row
      try {
        destinationSheet.insertRowAfter(lastNonEmptyRow);
        destinationSheet.getRange(lastNonEmptyRow + 1, 1, 1, destinationRow.length).setValues([destinationRow]);
        const newRowNumber = lastNonEmptyRow + 1; // New row number in destination sheet

        // Update origin sheet Column F to "Transferred to Main Ledger"
        originSheet.getRange(rowIndex, 6).setValue(TRANSFERRED_STATUS);
        // Update origin sheet Column L (index 11, 0-based) with destination row number
        originSheet.getRange(rowIndex, 12).setValue(newRowNumber);
        Logger.log(`Row with hash_key ${hash_key} transferred successfully to row ${newRowNumber}.`);
      } catch (e) {
        // Update origin sheet Column F to "Entry Error"
        originSheet.getRange(rowIndex, 6).setValue(ERROR_STATUS);
        Logger.log(`Error transferring row with hash_key ${hash_key}: ${e.message}`);
      }
    } else if (status === REVIEWED_STATUS && valueG === 0) {
      // Update origin sheet Column F to "Ignored"
      originSheet.getRange(rowIndex, 6).setValue(IGNORED_STATUS);
      Logger.log(`Row with hash_key ${hash_key} ignored (Column G is 0).`);
    } else {
      Logger.log(`Row with hash_key ${hash_key} does not meet transfer conditions. Status: ${status}, Value G: ${valueG}`);
    }
  } catch (e) {
    Logger.log(`Unexpected error processing hash_key ${hash_key}: ${e.message}`);
  }
}

/**
 * Fetches all rows from the origin sheet where Column F is "Reviewed" and processes each with transferRowByHashKey.
 */
function processAllReviewedRows() {
  Logger.log('Starting to process all rows with "Reviewed" status in Column F.');
  try {
    // Open the origin spreadsheet
    const originSpreadsheet = SpreadsheetApp.openById(ORIGIN_SPREADSHEET_ID);
    const originSheet = originSpreadsheet.getSheetByName(ORIGIN_SHEET_NAME);

    // Get data from origin sheet
    const originData = originSheet.getDataRange().getValues();
    let processedCount = 0;

    // Iterate through rows, starting from index 1 to skip header
    for (let i = 1; i < originData.length; i++) {
      const status = originData[i][5]; // Column F (index 5)
      const hash_key = originData[i][10]; // Column K (index 10)
      if (status === REVIEWED_STATUS && hash_key) {
        Logger.log(`Found reviewed row with hash_key: ${hash_key}`);
        transferRowByHashKey(hash_key);
        processedCount++;
      }
    }

    Logger.log(`Processed ${processedCount} rows with "Reviewed" status.`);
    if (processedCount === 0) {
      Logger.log('No rows found with "Reviewed" status.');
    }
  } catch (e) {
    Logger.log(`Error in processAllReviewedRows: ${e.message}`);
  }
}

/**
 * Test function to trigger the transfer for a specific hash_key.
 */
function testTransfer() {
  transferRowByHashKey('D7YN9GVH4TLUS/yF/6Fz_A');
}