/**
 * One-time script to add the Pinky Blau warehousing row to the
 * 'Recurring Transactions' sheet.
 *
 * Context: Governor (Gary Teh) instruction 2026-11-23 — Pinky Blau offers her
 * place in Palo Verde, California, USA as an Agroverse warehousing location,
 * compensated at 160 TDG / month.
 *
 * She is already registered in the 'Contributors contact information' tab
 * (row 1222) with no email on file; that tab is NOT used by the tokenization
 * automation, so the email is irrelevant on this payout path.
 *
 * Run this ONCE from the Apps Script editor as the script owner
 * (garyjob@agroverse.shop) — the target sheet is owner-protected, so no
 * service account can write it. The monthly automation
 * (tdg_recurring_tokenization_monthly.js) will then pick the row up.
 *
 * Re-running is safe: there is an explicit duplicate guard.
 */

function addPinkyBlauRow() {
  const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU'; // PRODUCTION
  const SHEET_NAME = 'Recurring Transactions';

  const CONTRIBUTOR = 'Pinky Blau';
  const START_DATE = 20261123; // YYYYMMDD — first payout cycle is December 2026
  const AMOUNT = 160; // MUST be a number: automation filters on typeof 'number'
  const AUTOMATION_URL =
    'https://script.google.com/home/projects/' +
    '1LxWu9hOs56JZ6Mbxra3eDv74xjpjgkJQW40xjpQBIHObsqiv1D5jr5fK/edit';

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('Sheet not found: ' + SHEET_NAME);
    return;
  }

  // --- Duplicate guard: check BOTH the description (col A) and the
  // --- contributor (col B), since the automation joins on column B exactly.
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    const desc = data[i][0] ? data[i][0].toString() : '';
    const src = data[i][1] ? data[i][1].toString() : '';
    if (desc.indexOf(CONTRIBUTOR) !== -1 || src === CONTRIBUTOR) {
      Logger.log(
        'Pinky Blau row already exists at row ' +
          (i + 1) +
          ' (col A=' +
          JSON.stringify(desc) +
          ', col B=' +
          JSON.stringify(src) +
          ') — nothing written.'
      );
      return;
    }
  }

  // --- Append the new row (columns A-I)
  sheet.appendRow([
    CONTRIBUTOR + ' - Palo Verde California USA Warehousing\n\nStart Date: ' + START_DATE, // A: Description
    CONTRIBUTOR, // B: Source — must match Ledger history col A exactly
    'Tokenization', // C: Transaction Type
    AMOUNT, // D: Amount (USD) — numeric on purpose
    'Monthly', // E: Billing Period
    START_DATE, // F: Most Recent Tokenization Date
    START_DATE, // G: Start Date
    '', // H: (blank)
    'Automation Location\n\n' + AUTOMATION_URL // I: Automation Location (documentation only)
  ]);

  Logger.log('Pinky Blau recurring row added successfully.');
  Logger.log(
    '  ' +
      CONTRIBUTOR +
      ' | Tokenization | ' +
      AMOUNT +
      ' | Monthly | F=' +
      START_DATE +
      ' | G=' +
      START_DATE
  );
}

/**
 * Read back the row(s) for Pinky Blau and log them, so the operator can
 * confirm the write landed with the correct types and column positions.
 */
function verifyPinkyBlauRow() {
  const SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
  const SHEET_NAME = 'Recurring Transactions';
  const CONTRIBUTOR = 'Pinky Blau';

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  let found = 0;

  for (let i = 0; i < data.length; i++) {
    const src = data[i][1] ? data[i][1].toString() : '';
    if (src !== CONTRIBUTOR) continue;
    found++;
    Logger.log('Found at sheet row ' + (i + 1) + ' (0-based index ' + i + '):');
    Logger.log('  A description      : ' + JSON.stringify(data[i][0]));
    Logger.log('  B source           : ' + JSON.stringify(data[i][1]));
    Logger.log('  C type             : ' + JSON.stringify(data[i][2]));
    Logger.log(
      '  D amount           : ' +
        JSON.stringify(data[i][3]) +
        '  typeof=' +
        typeof data[i][3] +
        (typeof data[i][3] === 'number' ? '  ✅ numeric' : '  ❌ NOT numeric — row will be SKIPPED')
    );
    Logger.log('  E frequency        : ' + JSON.stringify(data[i][4]));
    Logger.log('  F last tokenized   : ' + JSON.stringify(data[i][5]));
    Logger.log('  G start date       : ' + JSON.stringify(data[i][6]));
    Logger.log('  I automation       : ' + JSON.stringify(data[i][8]));
  }

  if (found === 0) {
    Logger.log('No row found for contributor ' + JSON.stringify(CONTRIBUTOR) + '.');
  } else {
    Logger.log('Total matching rows: ' + found + ' (expected exactly 1).');
  }
}
