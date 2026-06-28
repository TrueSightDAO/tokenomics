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

function doGet(e) {
  const limit = parseInt(e?.parameter?.limit || '0') || 0;
  const schedule = e?.parameter?.schedule || '';

  // Schedule a one-shot trigger to run the transfer asynchronously.
  // Web requests timeout before large transfers finish.
  if (schedule === '1') {
    ScriptApp.newTrigger('transferBatch_')
      .timeBased()
      .after(30 * 1000) // fire in 30 seconds
      .create();
    return ContentService.createTextOutput(JSON.stringify({
      status: 'scheduled', message: 'Transfer trigger set — will fire in ~30s'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (e?.parameter?.ping) {
    return ContentService.createTextOutput(JSON.stringify({status:'ok'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify(processAllReviewedRows(limit)))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Trigger wrapper — processes a batch then re-schedules if more remain. */
function transferBatch_() {
  const result = processAllReviewedRows(25);
  Logger.log('Transfer batch: ' + JSON.stringify(result));
  if (result && result.processed > 0) {
    ScriptApp.newTrigger('transferBatch_')
      .timeBased()
      .after(30 * 1000)
      .create();
  } else {
    Logger.log('Transfer complete — no more Reviewed rows.');
  }
}

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

    // Read status directly from sheet to avoid stale cached data
    const statusFromSheet = originSheet.getRange(rowIndex, 6).getValue().toString().trim();
    const valueG = rowData[6]; // Column G (index 6)
    
    // If status already says "Transferred to Main Ledger", just ignore the row
    if (statusFromSheet === TRANSFERRED_STATUS) {
      Logger.log(`Row ${rowIndex} with hash_key ${hash_key} already has status "${TRANSFERRED_STATUS}". Skipping.`);
      return;
    }
    
    // If Column G is 0 and status is "Reviewed", mark as "Ignored" immediately
    if (statusFromSheet === REVIEWED_STATUS && valueG === 0) {
      Logger.log(`Row ${rowIndex} with hash_key ${hash_key} has Column G = 0. Updating status to "${IGNORED_STATUS}".`);
      originSheet.getRange(rowIndex, 6).setValue(IGNORED_STATUS);
      SpreadsheetApp.flush();
      return;
    }
    
    const mainLedgerLineNumberFromSheet = originSheet.getRange(rowIndex, 12).getValue(); // Column M (index 12, 1-based)
    
    // Get contributor name for matching
    let columnAValue = rowData[0];
    const contributorsData = contributorsSheet.getDataRange().getValues();
    let found = false;
    
    // Validate Column A against Contributors contact information
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
    
    // Get destination data to check for existing records
    const destData = destinationSheet.getDataRange().getValues();
    const contributionMade = rowData[2]; // Column C
    const tdgIssued = rowData[6]; // Column G
    const statusDate = rowData[7]; // Column H
    
    // Check if this record already exists in the main ledger
    let existingMainLedgerRow = null;
    for (let j = 1; j < destData.length; j++) {
      const destRow = destData[j];
      const destContributor = destRow[0]; // Column A
      const destContribution = destRow[2]; // Column C
      const destTdgIssued = destRow[6]; // Column G (TDGs Issued)
      const destStatusDate = destRow[7]; // Column H (Status date)
      
      // Match if contributor, contribution, TDG amount, and date match
      if (destContributor === columnAValue &&
          destContribution === contributionMade &&
          destTdgIssued === tdgIssued &&
          destStatusDate === statusDate) {
        existingMainLedgerRow = j + 1; // 1-based row number
        break;
      }
    }
    
    // If record exists in main ledger, ensure Column F and Column M are updated
    if (existingMainLedgerRow) {
      let needsUpdate = false;
      
      // Check if Column F needs updating
      if (statusFromSheet !== TRANSFERRED_STATUS) {
        Logger.log(`Row with hash_key ${hash_key} exists in main ledger at row ${existingMainLedgerRow} but Column F shows "${statusFromSheet}". Updating to ${TRANSFERRED_STATUS}.`);
        originSheet.getRange(rowIndex, 6).setValue(TRANSFERRED_STATUS);
        needsUpdate = true;
      }
      
      // Check if Column M needs updating
      if (mainLedgerLineNumberFromSheet !== existingMainLedgerRow) {
        Logger.log(`Row with hash_key ${hash_key} exists in main ledger at row ${existingMainLedgerRow} but Column M shows "${mainLedgerLineNumberFromSheet}". Updating to ${existingMainLedgerRow}.`);
        originSheet.getRange(rowIndex, 12).setValue(existingMainLedgerRow);
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        SpreadsheetApp.flush();
        Logger.log(`Updated row with hash_key ${hash_key}: Column F = ${TRANSFERRED_STATUS}, Column M = ${existingMainLedgerRow}`);
      } else {
        Logger.log(`Row with hash_key ${hash_key} already correctly marked as transferred (Column F = ${TRANSFERRED_STATUS}, Column M = ${existingMainLedgerRow}). Skipping.`);
      }
      return; // Exit early since record already transferred
    }
    
    // If Column M has a value but record doesn't exist in main ledger, clear Column M
    if (mainLedgerLineNumberFromSheet && mainLedgerLineNumberFromSheet !== '' && mainLedgerLineNumberFromSheet !== 0) {
      Logger.log(`Row with hash_key ${hash_key} has Column M value ${mainLedgerLineNumberFromSheet} but record not found in main ledger. Clearing Column M.`);
      originSheet.getRange(rowIndex, 12).setValue('');
      SpreadsheetApp.flush();
    }
    
    // If status says "Transferred" but record doesn't exist, reset status to "Reviewed" if conditions are met
    if (statusFromSheet === TRANSFERRED_STATUS && !existingMainLedgerRow) {
      if (valueG !== 0) {
        Logger.log(`Row with hash_key ${hash_key} has status "${TRANSFERRED_STATUS}" but record not found in main ledger. Resetting status to "${REVIEWED_STATUS}".`);
        originSheet.getRange(rowIndex, 6).setValue(REVIEWED_STATUS);
        SpreadsheetApp.flush();
      }
    }

    // Use status from sheet (not cached) for the condition check
    if (statusFromSheet === REVIEWED_STATUS && valueG !== 0) {
      // Contributor validation already done above, check if found
      if (!found) {
        originSheet.getRange(rowIndex, 6).setValue(ERROR_CONTRIBUTOR_NOT_FOUND);
        Logger.log(`Contributor not found for hash_key ${hash_key}: ${rowData[0]}`);
        return;
      }
      
      // Record doesn't exist in main ledger (already checked above), proceed with transfer

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

      // Find the last non-empty row in Column A of destination sheet (using destData we already fetched)
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
        // Use flush() to ensure changes are saved before continuing
        const statusRange = originSheet.getRange(rowIndex, 6);
        statusRange.setValue(TRANSFERRED_STATUS);
        SpreadsheetApp.flush(); // Force save the status update
        
        // Update origin sheet Column M (index 12, 1-based) with destination row number
        const lineNumberRange = originSheet.getRange(rowIndex, 12);
        lineNumberRange.setValue(newRowNumber);
        SpreadsheetApp.flush(); // Force save the line number update
        
        Logger.log(`Row with hash_key ${hash_key} transferred successfully to row ${newRowNumber}. Status updated to ${TRANSFERRED_STATUS} at row ${rowIndex}, column 6.`);
      } catch (e) {
        // Update origin sheet Column F to "Entry Error"
        try {
          originSheet.getRange(rowIndex, 6).setValue(ERROR_STATUS);
          SpreadsheetApp.flush();
        } catch (updateError) {
          Logger.log(`Failed to update error status: ${updateError.message}`);
        }
        Logger.log(`Error transferring row with hash_key ${hash_key}: ${e.message}`);
        Logger.log(`Stack trace: ${e.stack}`);
      }
    } else {
      Logger.log(`Row with hash_key ${hash_key} does not meet transfer conditions. Status: ${statusFromSheet}, Value G: ${valueG}`);
    }
  } catch (e) {
    Logger.log(`Unexpected error processing hash_key ${hash_key}: ${e.message}`);
  }
}

/**
 * Fetches all rows from the origin sheet where Column F is "Reviewed" and processes each row individually.
 * Processes by row index instead of hash key to handle duplicate hash keys correctly.
 */
function processAllReviewedRows(limit = 0) {
  Logger.log('Starting to process all rows with "Reviewed" status in Column F' + (limit > 0 ? ' (limit: ' + limit + ')' : '') + '.');
  try {
    // Open ALL spreadsheets once
    const originSpreadsheet = SpreadsheetApp.openById(ORIGIN_SPREADSHEET_ID);
    const originSheet = originSpreadsheet.getSheetByName(ORIGIN_SHEET_NAME);
    const destinationSpreadsheet = SpreadsheetApp.openById(DESTINATION_SPREADSHEET_ID);
    const destinationSheet = destinationSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
    const contributorsSheet = destinationSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);

    // Pre-load all data ONCE
    const originData = originSheet.getDataRange().getValues();
    const contributorsData = contributorsSheet.getDataRange().getValues();
    const destData = destinationSheet.getDataRange().getValues();
    const destLastRow = destData.length + 1; // 1-based row for appending

    // Build contributor lookup maps once
    const contributorsByName = {};
    const contributorsByHandle = {};
    for (let c = 1; c < contributorsData.length; c++) {
      const name = contributorsData[c][0];
      if (!name) continue;
      contributorsByName[name] = true;
      const handle = contributorsData[c][7];
      if (handle) contributorsByHandle[handle] = name;
    }

    // Build destination dedup map (hash_key -> exists)
    const destExists = {};
    for (let d = 1; d < destData.length; d++) {
      const hk = String(destData[d][8] || '').trim();
      if (hk) destExists[hk] = true;
    }

    let processedCount = 0;
    let nextDestRow = destLastRow;

    for (let i = 1; i < originData.length; i++) {
      const status = String(originData[i][5] || '').trim(); // Col F
      const hash_key = String(originData[i][10] || '').trim(); // Col K
      const columnI = String(originData[i][8] || '').trim(); // Col I
      
      if (columnI === 'RESOLVE FAILED' && status !== REVIEWED_STATUS) continue;
      if (status !== REVIEWED_STATUS || !hash_key) continue;

      // Already transferred?
      const statusFresh = String(originSheet.getRange(i + 1, 6).getValue()).trim();
      if (statusFresh === TRANSFERRED_STATUS || statusFresh === IGNORED_STATUS) continue;

      // Get row data
      const rowData = originData[i];
      const tdgIssued = rowData[6]; // Col G
      const valueG = parseFloat(tdgIssued) || 0;

      // If TDG = 0, mark as Ignored
      if (valueG === 0) {
        originSheet.getRange(i + 1, 6).setValue(IGNORED_STATUS);
        continue;
      }

      // Prevent duplicate ledger entries
      if (destExists[hash_key]) {
        Logger.log('Skipping row ' + (i + 1) + ': hash_key ' + hash_key + ' already in destination ledger');
        originSheet.getRange(i + 1, 6).setValue(TRANSFERRED_STATUS);
        continue;
      }

      // Resolve contributor name
      let contributorName = rowData[0];
      if (!contributorsByName[contributorName]) {
        const handle = contributorName.startsWith('@') ? contributorName.slice(1) : contributorName;
        const handleWithAt = '@' + handle;
        if (contributorsByHandle[handle]) contributorName = contributorsByHandle[handle];
        else if (contributorsByHandle[handleWithAt]) contributorName = contributorsByHandle[handleWithAt];
        else {
          Logger.log('Skipping row ' + (i + 1) + ': contributor not found for ' + contributorName);
          originSheet.getRange(i + 1, 6).setValue(ERROR_CONTRIBUTOR_NOT_FOUND);
          continue;
        }
      }

      // Write to destination ledger
      const contributionDate = String(rowData[8] || '').trim(); // Col I (date)
      const contributionMade = rowData[2]; // Col C
      const reporterName = rowData[9]; // Col J
      const projectName = rowData[1]; // Col B

      destinationSheet.getRange(nextDestRow, 1, 1, 9).setValues([[
        contributionDate,
        contributorName,
        contributionMade,
        '', // blank
        tdgIssued,
        'Scored Chatlogs',
        reporterName,
        projectName,
        hash_key,
      ]]);
      destExists[hash_key] = true;
      nextDestRow++;

      // Mark origin as transferred
      originSheet.getRange(i + 1, 6).setValue(TRANSFERRED_STATUS);
      // Write destination row number to Col M (Main Ledger Row Number)
      originSheet.getRange(i + 1, 13).setValue(nextDestRow - 1);

      processedCount++;
      if (limit > 0 && processedCount >= limit) break;
    }

    Logger.log('Transferred ' + processedCount + ' rows to main ledger.');
    return { status: 'ok', processed: processedCount };
  } catch (e) {
    Logger.log('Error in processAllReviewedRows: ' + e.message);
    Logger.log('Stack trace: ' + e.stack);
    return { status: 'error', error: e.message };
  }
}

/**
 * Transfers a row from the origin sheet to the destination sheet based on row index.
 * This function handles duplicate hash keys correctly by processing each row individually.
 * @param {number} rowIndex - The 1-based row index in the origin sheet.
 */
function transferRowByIndex(rowIndex) {
  try {
    // Open the origin and destination spreadsheets
    const originSpreadsheet = SpreadsheetApp.openById(ORIGIN_SPREADSHEET_ID);
    const originSheet = originSpreadsheet.getSheetByName(ORIGIN_SHEET_NAME);
    const destinationSpreadsheet = SpreadsheetApp.openById(DESTINATION_SPREADSHEET_ID);
    const destinationSheet = destinationSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
    const contributorsSheet = destinationSpreadsheet.getSheetByName(CONTRIBUTORS_SHEET_NAME);

    // Get the row data directly by row index
    const rowData = originSheet.getRange(rowIndex, 1, 1, originSheet.getLastColumn()).getValues()[0];
    const hash_key = rowData[10]; // Column K (index 10, 0-based)

    if (!hash_key) {
      Logger.log(`Row ${rowIndex} has no hash key. Skipping.`);
      return;
    }

    Logger.log(`Processing row ${rowIndex} with hash_key: ${hash_key}`);
    
    // Use the same logic as transferRowByHashKey but with known row index
    // Read status directly from sheet to avoid stale cached data
    const statusFromSheet = originSheet.getRange(rowIndex, 6).getValue().toString().trim();
    const valueG = rowData[6]; // Column G (index 6)
    
    // If status already says "Transferred to Main Ledger", just ignore the row
    if (statusFromSheet === TRANSFERRED_STATUS) {
      Logger.log(`Row ${rowIndex} with hash_key ${hash_key} already has status "${TRANSFERRED_STATUS}". Skipping.`);
      return;
    }
    
    // If Column G is 0 and status is "Reviewed", mark as "Ignored" immediately
    if (statusFromSheet === REVIEWED_STATUS && valueG === 0) {
      Logger.log(`Row ${rowIndex} with hash_key ${hash_key} has Column G = 0. Updating status to "${IGNORED_STATUS}".`);
      originSheet.getRange(rowIndex, 6).setValue(IGNORED_STATUS);
      SpreadsheetApp.flush();
      return;
    }
    
    const mainLedgerLineNumberFromSheet = originSheet.getRange(rowIndex, 12).getValue(); // Column M (index 12, 1-based)
    
    // Get contributor name for matching
    let columnAValue = rowData[0];
    const contributorsData = contributorsSheet.getDataRange().getValues();
    let found = false;
    
    // Validate Column A against Contributors contact information
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
    
    // Get destination data to check for existing records
    const destData = destinationSheet.getDataRange().getValues();
    const contributionMade = rowData[2]; // Column C
    const tdgIssued = rowData[6]; // Column G
    const statusDate = rowData[7]; // Column H
    
    // Check if this record already exists in the main ledger
    let existingMainLedgerRow = null;
    for (let j = 1; j < destData.length; j++) {
      const destRow = destData[j];
      const destContributor = destRow[0]; // Column A
      const destContribution = destRow[2]; // Column C
      const destTdgIssued = destRow[6]; // Column G (TDGs Issued)
      const destStatusDate = destRow[7]; // Column H (Status date)
      
      // Match if contributor, contribution, TDG amount, and date match
      if (destContributor === columnAValue &&
          destContribution === contributionMade &&
          destTdgIssued === tdgIssued &&
          destStatusDate === statusDate) {
        existingMainLedgerRow = j + 1; // 1-based row number
        break;
      }
    }
    
    // If record exists in main ledger, ensure Column F and Column M are updated
    if (existingMainLedgerRow) {
      let needsUpdate = false;
      
      // Check if Column F needs updating
      if (statusFromSheet !== TRANSFERRED_STATUS) {
        Logger.log(`Row ${rowIndex} with hash_key ${hash_key} exists in main ledger at row ${existingMainLedgerRow} but Column F shows "${statusFromSheet}". Updating to ${TRANSFERRED_STATUS}.`);
        originSheet.getRange(rowIndex, 6).setValue(TRANSFERRED_STATUS);
        needsUpdate = true;
      }
      
      // Check if Column M needs updating
      if (mainLedgerLineNumberFromSheet !== existingMainLedgerRow) {
        Logger.log(`Row ${rowIndex} with hash_key ${hash_key} exists in main ledger at row ${existingMainLedgerRow} but Column M shows "${mainLedgerLineNumberFromSheet}". Updating to ${existingMainLedgerRow}.`);
        originSheet.getRange(rowIndex, 12).setValue(existingMainLedgerRow);
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        SpreadsheetApp.flush();
        Logger.log(`Updated row ${rowIndex} with hash_key ${hash_key}: Column F = ${TRANSFERRED_STATUS}, Column M = ${existingMainLedgerRow}`);
      } else {
        Logger.log(`Row ${rowIndex} with hash_key ${hash_key} already correctly marked as transferred (Column F = ${TRANSFERRED_STATUS}, Column M = ${existingMainLedgerRow}). Skipping.`);
      }
      return; // Exit early since record already transferred
    }
    
    // If Column M has a value but record doesn't exist in main ledger, clear Column M
    if (mainLedgerLineNumberFromSheet && mainLedgerLineNumberFromSheet !== '' && mainLedgerLineNumberFromSheet !== 0) {
      Logger.log(`Row ${rowIndex} with hash_key ${hash_key} has Column M value ${mainLedgerLineNumberFromSheet} but record not found in main ledger. Clearing Column M.`);
      originSheet.getRange(rowIndex, 12).setValue('');
      SpreadsheetApp.flush();
    }
    
    // If status says "Transferred" but record doesn't exist, reset status to "Reviewed" if conditions are met
    if (statusFromSheet === TRANSFERRED_STATUS && !existingMainLedgerRow) {
      if (valueG !== 0) {
        Logger.log(`Row ${rowIndex} with hash_key ${hash_key} has status "${TRANSFERRED_STATUS}" but record not found in main ledger. Resetting status to "${REVIEWED_STATUS}".`);
        originSheet.getRange(rowIndex, 6).setValue(REVIEWED_STATUS);
        SpreadsheetApp.flush();
      }
    }

    // Use status from sheet (not cached) for the condition check
    if (statusFromSheet === REVIEWED_STATUS && valueG !== 0) {
      // Contributor validation already done above, check if found
      if (!found) {
        originSheet.getRange(rowIndex, 6).setValue(ERROR_CONTRIBUTOR_NOT_FOUND);
        Logger.log(`Contributor not found for row ${rowIndex} with hash_key ${hash_key}: ${rowData[0]}`);
        return;
      }
      
      // Record doesn't exist in main ledger (already checked above), proceed with transfer
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

      // Find the last non-empty row in Column A of destination sheet (using destData we already fetched)
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
        // Use flush() to ensure changes are saved before continuing
        const statusRange = originSheet.getRange(rowIndex, 6);
        statusRange.setValue(TRANSFERRED_STATUS);
        SpreadsheetApp.flush(); // Force save the status update
        
        // Update origin sheet Column M (index 12, 1-based) with destination row number
        const lineNumberRange = originSheet.getRange(rowIndex, 12);
        lineNumberRange.setValue(newRowNumber);
        SpreadsheetApp.flush(); // Force save the line number update
        
        Logger.log(`Row ${rowIndex} with hash_key ${hash_key} transferred successfully to row ${newRowNumber}. Status updated to ${TRANSFERRED_STATUS} at row ${rowIndex}, column 6.`);
      } catch (e) {
        // Update origin sheet Column F to "Entry Error"
        try {
          originSheet.getRange(rowIndex, 6).setValue(ERROR_STATUS);
          SpreadsheetApp.flush();
        } catch (updateError) {
          Logger.log(`Failed to update error status: ${updateError.message}`);
        }
        Logger.log(`Error transferring row ${rowIndex} with hash_key ${hash_key}: ${e.message}`);
        Logger.log(`Stack trace: ${e.stack}`);
      }
    } else {
      Logger.log(`Row ${rowIndex} with hash_key ${hash_key} does not meet transfer conditions. Status: ${statusFromSheet}, Value G: ${valueG}`);
    }
  } catch (e) {
    Logger.log(`Unexpected error processing row ${rowIndex}: ${e.message}`);
    Logger.log(`Stack trace: ${e.stack}`);
  }
}

/**
 * Test function to trigger the transfer for a specific hash_key.
 */
function testTransfer() {
  transferRowByHashKey('D7YN9GVH4TLUS/yF/6Fz_A');
}