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

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * HTTP entrypoint (web app, ANYONE_ANONYMOUS). GAS web apps 302-redirect to
 * script.googleusercontent.com, so callers MUST follow redirects (curl -L).
 *   ?ping=1 -> liveness; ?limit=N -> transfer up to N; ?schedule=1 -> arm 30s trigger.
 * Always returns JSON, including on error.
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const limit = parseInt(p.limit || '0', 10) || 0;
    const schedule = p.schedule || '';

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

    if (p.ping) return _json({ status: 'ok', ts: new Date().toISOString() });

    const result = processAllReviewedRows(limit);
    return _json(result && typeof result === 'object'
      ? result
      : { status: 'error', error: 'processAllReviewedRows returned no result' });
  } catch (err) {
    return _json({ status: 'error', error: String((err && err.message) || err) });
  }
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
// NOTE: origin col F has STRICT data validation (=States!$A$2:$A$1009) and the
// States list offers 'Entry Error' -- NOT this longer descriptive string. Writing
// an out-of-list value THROWS; with no per-row catch that single row aborted the
// ENTIRE transfer run (root cause of the partial ~66-row drains). Keep this a
// valid state; the descriptive reason stays visible via col I ('RESOLVE FAILED').
const ERROR_CONTRIBUTOR_NOT_FOUND = ERROR_STATUS;
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
  Logger.log('Starting transfer' + (limit > 0 ? ' (limit: ' + limit + ')' : '') + '.');
  // Serialize concurrent runs: the 30s re-arm, a cron, and a manual drain can
  // otherwise overlap and each append against its own pre-append snapshot.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Could not obtain script lock - another transfer run is in progress. Aborting.');
    return { status: 'locked', processed: 0 };
  }
  try {
    const originSS = SpreadsheetApp.openById(ORIGIN_SPREADSHEET_ID);
    const originSheet = originSS.getSheetByName(ORIGIN_SHEET_NAME);
    const destSS = SpreadsheetApp.openById(DESTINATION_SPREADSHEET_ID);
    const destSheet = destSS.getSheetByName(DESTINATION_SHEET_NAME);
    const contribSheet = destSS.getSheetByName(CONTRIBUTORS_SHEET_NAME);

    // --- Pre-load everything in 3 batch reads ---
    const originData = originSheet.getDataRange().getValues();
    const contribData = contribSheet.getDataRange().getValues();
    const destData = destSheet.getDataRange().getValues();

    // --- Build lookups in-memory ---
    const contribByName = {};
    const contribByHandle = {};
    for (let c = 1; c < contribData.length; c++) {
      const nm = contribData[c][0]; if (!nm) continue;
      contribByName[nm] = true;
      const h = contribData[c][7]; if (h) contribByHandle[h] = nm;
    }
    // Duplicate guard. The signed Request Transaction ID embedded in the
    // contribution body (Column C) is the strongest de-dup key: a re-appended
    // copy of the SAME submission carries a byte-identical ID. Fall back to
    // (contributor || normalized body || TDG || date) for legacy unsigned rows.
    // NOTE: this map was previously BUILT AND WRITTEN BUT NEVER READ, so no
    // duplicate was ever skipped. It is now enforced in the row loop below.
    const txnIdOf_ = (body) => {
      const m = String(body || '').match(/Request Transaction ID:\s*([A-Za-z0-9+/=]{16,})/);
      return m ? m[1] : '';
    };
    const destSeen = {};
    const destTxnSeen = {};
    // Column P = Scoring Hash Key: the durable dedup key (never overwritten by
    // airdrop processing, unlike Column I 'Solana Transfer Hash').
    const destHashKeySeen = {};
    const dupKey_ = (a, c, e, h) => String(a || '').trim().toLowerCase() + '||' +
      String(c || '').trim().toLowerCase().replace(/\s+/g, ' ') + '||' +
      String(e || '').trim() + '||' + String(h || '').trim();
    for (let d = 1; d < destData.length; d++) {
      if (destData[d][0]) destSeen[dupKey_(destData[d][0], destData[d][2], destData[d][4], destData[d][7])] = d + 1;
      const t0 = txnIdOf_(destData[d][2]);
      if (t0) destTxnSeen[t0] = d + 1;
      const h0 = String(destData[d][15] || '').trim();
      if (h0) destHashKeySeen[h0] = d + 1;
    }

    // --- Single pass: compute everything in-memory ---
    // Process newest-first. Commit origin status + destination row immediately
    // per row: if interrupted, the next run skips already-transferred rows.
    let processedCount = 0;
    let skippedResolveFailed = 0;
    let destAppendRow = destData.length + 1;

    let rowErrors = 0;
    let duplicatesSkipped = 0;
    for (let i = originData.length - 1; i >= 1; i--) {
      try {
      const status = String(originData[i][5] || '').trim();
      const hash_key = String(originData[i][10] || '').trim();
      const colI = String(originData[i][8] || '').trim();

      // Fail closed on unresolved contributor identity. A row the scorer
      // flagged RESOLVE FAILED (could not verify the contributor) must NEVER
      // auto-pay, even if it was later stamped Reviewed with G>0. The previous
      // guard here was dead code: its condition was always false for Reviewed
      // rows, and every non-Reviewed row is skipped by the next line anyway.
      if (colI === 'RESOLVE FAILED') {
        skippedResolveFailed++;
        Logger.log('Row ' + (i + 1) + ' skipped: RESOLVE FAILED (contributor unresolved).');
        continue;
      }
      if (status !== REVIEWED_STATUS || !hash_key) continue;

      const tdg = parseFloat(originData[i][6]) || 0;

      if (tdg === 0) {
        originSheet.getRange(i + 1, 6).setValue(IGNORED_STATUS);
        continue;
      }

      // Resolve contributor name FIRST (Column A exact, then Column H handle).
      let contribName = originData[i][0];
      if (!contribByName[contribName]) {
        const h = String(contribName || '').startsWith('@') ? contribName.slice(1) : contribName;
        if (contribByHandle[h]) contribName = contribByHandle[h];
        else if (contribByHandle['@' + h]) contribName = contribByHandle['@' + h];
        else {
          originSheet.getRange(i + 1, 6).setValue(ERROR_CONTRIBUTOR_NOT_FOUND);
          continue;
        }
      }

      // DUPLICATE GUARD (the previously-missing READ). Skip a row whose
      // submission is already in the Ledger - matched by signed txn ID first,
      // then by (contributor, body, TDG, date). Fail closed: never re-append.
      const bodyC = originData[i][2];
      const txnId = txnIdOf_(bodyC);
      const tdgC = Math.round((parseFloat(originData[i][6]) || 0) * 100) / 100;
      const dKey = dupKey_(contribName, bodyC, tdgC, originData[i][7]);
      const existingLedgerRow = (hash_key && destHashKeySeen[hash_key]) ||
        (txnId && destTxnSeen[txnId]) || destSeen[dKey] || 0;
      if (existingLedgerRow) {
        duplicatesSkipped++;
        originSheet.getRange(i + 1, 6).setValue(TRANSFERRED_STATUS);
        originSheet.getRange(i + 1, 12).setValue(existingLedgerRow);
        Logger.log('Row ' + (i + 1) + ' skipped: already in Ledger at row ' + existingLedgerRow + '.');
        continue;
      }

      const tdgRounded = Math.round((parseFloat(originData[i][6]) || 0) * 100) / 100;
      const destRow = new Array(16).fill('');
      destRow[0] = contribName;        // A: Contributor Name (validated)
      destRow[1] = originData[i][1];   // B: Project Name
      destRow[2] = originData[i][2];   // C: Contribution Made
      destRow[3] = originData[i][3];   // D: Rubric classification
      destRow[4] = tdgRounded;         // E: TDGs Provisioned
      destRow[5] = COMPLETED_STATUS;   // F: Status
      destRow[6] = tdgRounded;         // G: TDGs Issued
      destRow[7] = originData[i][7];   // H: Status date
      destRow[15] = hash_key;          // P: Scoring Hash Key (durable dedup key)
      destSheet.getRange(destAppendRow, 1, 1, 16).setValues([destRow]);
      destSeen[dKey] = destAppendRow;
      if (txnId) destTxnSeen[txnId] = destAppendRow;
      if (hash_key) destHashKeySeen[hash_key] = destAppendRow;
      originSheet.getRange(i + 1, 6).setValue(TRANSFERRED_STATUS);
      originSheet.getRange(i + 1, 12).setValue(destAppendRow); // col L: Main Ledger Row Number
      destAppendRow++;
      processedCount++;

      if (limit > 0 && processedCount >= limit) break;
      } catch (rowErr) {
        // One bad row must never abort the whole run: log, count, continue.
        rowErrors++;
        Logger.log('Row ' + (i + 1) + ' skipped (write error): ' + rowErr.message);
      }
    }

    Logger.log('Transferred ' + processedCount + ' rows.');
    return { status: 'ok', processed: processedCount, skippedResolveFailed: skippedResolveFailed, duplicatesSkipped: duplicatesSkipped, rowErrors: rowErrors };
  } catch (e) {
    Logger.log('Error: ' + e.message + ' stack: ' + e.stack);
    return { status: 'error', error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
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