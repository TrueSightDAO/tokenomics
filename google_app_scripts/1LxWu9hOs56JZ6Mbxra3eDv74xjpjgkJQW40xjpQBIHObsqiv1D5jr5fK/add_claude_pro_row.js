/**
 * One-time script to add Claude Pro subscription to Recurring Transactions sheet.
 * Run this once to add the row, then the monthly automation picks it up.
 */

function addClaudeProRow() {
  const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
  const SHEET_NAME = 'Recurring Transactions';
  
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('Sheet not found');
    return;
  }
  
  // Check if already exists to avoid duplicates
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().includes('Claude Pro')) {
      Logger.log('Claude Pro row already exists at row ' + (i + 1));
      return;
    }
  }
  
  // Append the new row
  sheet.appendRow([
    'Anthropic Claude Pro — garyjob@truesight.me',  // A: Description
    'Gary Teh',                                       // B: Source
    'Tokenization',                                   // C: Transaction Type
    20,                                               // D: Amount (USD)
    'Monthly',                                        // E: Billing Period
    20260723,                                         // F: Most Recent Tokenization Date
    20260723                                          // G: Start Date
  ]);
  
  Logger.log('Claude Pro row added successfully');
}
