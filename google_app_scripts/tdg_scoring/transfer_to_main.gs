/**
 * Google Apps Script to transfer records from "Scored Chatlogs" sheet to "Ledger history" sheet
 * based on hash_key matching and specific conditions.
 */

// Variable declarations
const ORIGIN_SPREADSHEET_ID = '1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo';
const ORIGIN_SHEET_NAME = 'Scored Chatlogs';
const DESTINATION_SPREADSHEET_ID = '1F90Sq6jSfj8io0RmiUwdydzuWXOZA9siXHWDsj9ItTo';
const DESTINATION_SHEET_NAME = 'Ledger history';
const CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const REVIEWED_STATUS = 'Reviewed';
const COMPLETED_STATUS = 'Successfully Completed / Full Provision Awarded';
const TRANSFERRED_STATUS = 'Transferred to Main Ledger';
const ERROR_STATUS = 'Entry Error';
const IGNORED_STATUS = 'Ignored';

/**
 * Validates and retrieves the correct Contributor ID from the Contributors contact information sheet.
 * @param {string} contributorId - The contributor ID from Origin Column A.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} contributorsSheet - The Contributors contact information sheet.
 * @return {string} The validated Contributor ID.
 */
function validateContributorId(contributorId, contributorsSheet) {
  const contributorsData = contributorsSheet.getDataRange().getValues();
  // Check if contributorId exists in Column A
  for (let i = 1; i < contributorsData.length; i++) {
    if (contributorsData[i][0] === contributorId) {
      return contributorId; // ID is valid
    }
  }
  
  // If not found in Column A, check Column H (index 7) for matching ID or @ID
  const searchId = contributorId.startsWith('@') ? contributorId.substring(1) : contributorId;
  const altSearchId = contributorId.startsWith('@') ? contributorId : '@' + contributorId;
  
  for (let i = 1; i < contributorsData.length; i++) {
    const colHValue = contributorsData[i][7] || '';
    if (colHValue === searchId || colHValue === altSearchId) {
      return contributorsData[i][0]; // Return corresponding Column A value
    }
  }
  
  // If no match found, return original ID and log error
  Logger.log(`No matching Contributor ID found for ${contributorId}`);
  return contributorId;
}

/**
 * Transfers a row from the origin sheet to the destination sheet based on hash_key.
 * @param {string} hash_key - The hash key to match in Column K of the origin sheet.
 */
function transferRowByHashKey(hash_key) {
  Logger.log("Processing " + hash_key);
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
      // Validate Contributor ID from Column A
      const validatedContributorId = validateContributorId(rowData[0], contributorsSheet);

      // Prepare data for destination sheet
      const destinationRow = [
        validatedContributorId, // Column A (validated)
        rowData[1], // Column B
        rowData[2], // Column C
        rowData[3], // Column D
        rowData[4], // Column E
        COMPLETED_STATUS, // Column F
        rowData[6], // Column G
        rowData[7]  // Column H
      ];

      // Append to destination sheet and get the new row number
      try {
        const lastRow = destinationSheet.getLastRow();
        destinationSheet.appendRow(destinationRow);
        const newRowNumber = lastRow + 1; // New row number in destination sheet

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

function testTransfer() {
  transferRowByHashKey('D7YN9GVH4TLUS/yF/6Fz_A');
}