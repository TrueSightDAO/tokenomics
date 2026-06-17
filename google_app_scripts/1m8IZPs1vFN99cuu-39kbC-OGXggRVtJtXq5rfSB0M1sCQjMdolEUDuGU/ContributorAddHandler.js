/**
 * File: google_app_scripts/tdg_identity_management/process_contributor_add_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Processes [CONTRIBUTOR ADD EVENT] rows from "Telegram Chat Logs"
 *   (TrueSight DAO Telegram compilation, 1qbZZhf-…). For each pending row:
 *     1. Dedup against the "New Contributor" tab (update ID as key).
 *     2. Extract Contributor Name and Contributor Email from the event text.
 *     3. Check if the contributor already exists in "Contributors contact information"
 *        (by name or email, case-insensitive).
 *     4. Append a new row to "Contributors contact information" (Col A = Name, Col D = Email).
 *     5. Append an audit row to "New Contributor" tab with status.
 *
 * See also agentic_ai_context/README.md §19 and RETAILER_TECHNICAL_ONBOARDING.md §3.1.
 *
 * Triggers:
 * - Edgar → doGet(?action=processContributorAddsFromTelegramChatLogs) after every
 *   successful [CONTRIBUTOR ADD EVENT] persist on Telegram Chat Logs.
 * - Manual: processContributorAddNow() from the Apps Script editor.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CA_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const CA_TELEGRAM_SHEET_NAME = 'Telegram Chat Logs';
const CA_DEDUP_SHEET_NAME = 'New Contributor';

// "Telegram Chat Logs" column indices (0-based).
const CA_TELEGRAM_UPDATE_ID_COL = 0;   // A
const CA_TELEGRAM_TEXT_COL = 6;        // G

// "Contributors contact information" lives on the Main Ledger.
const CA_OFFCHAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const CA_CONTRIBUTORS_SHEET_NAME = 'Contributors contact information';
const CA_CONTRIBUTORS_NAME_COL = 0;   // A
const CA_CONTRIBUTORS_EMAIL_COL = 3;  // D

// "New Contributor" dedup tab column indices (0-based).
const CA_DEDUP_UPDATE_ID_COL = 0;
const CA_DEDUP_SUBMITTED_AT_COL = 1;
const CA_DEDUP_NAME_COL = 2;
const CA_DEDUP_EMAIL_COL = 3;
const CA_DEDUP_STATUS_COL = 4;
const CA_DEDUP_NOTES_COL = 5;
const CA_DEDUP_PROCESSED_AT_COL = 6;

const CA_DEDUP_HEADERS = [
  'Telegram Update ID',
  'Submitted At UTC',
  'Contributor Name',
  'Contributor Email',
  'Status',
  'Notes',
  'Processed At UTC'
];

const CA_EVENT_TAG = '[CONTRIBUTOR ADD EVENT]';

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Manual entry point for editor smoke testing. */
function processContributorAddNow() {
  const result = processPendingContributorAdds_({ trigger: 'manual' });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * doGet-routed entry from Edgar webhook.
 * body = { secret (ignored — URL is the access token) }.
 */
function handleContributorAddRequest_(body) {
  try {
    const result = processPendingContributorAdds_({ trigger: 'edgar_webhook' });
    return ContentService
        .createTextOutput(JSON.stringify({ ok: true, ...result }))
        .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('handleContributorAddRequest_ failed: ' + err);
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

/**
 * Scan Telegram Chat Logs for unprocessed [CONTRIBUTOR ADD EVENT] rows,
 * extract name/email, write new contributors to the Contributors sheet,
 * and log each outcome to the New Contributor dedup tab.
 */
function processPendingContributorAdds_(opts) {
  const o = opts || {};

  // --- Open sheets ---
  const telegramSs = SpreadsheetApp.openById(CA_TELEGRAM_SPREADSHEET_ID);
  const telegramWs = telegramSs.getSheetByName(CA_TELEGRAM_SHEET_NAME);
  if (!telegramWs) {
    throw new Error('Missing sheet: ' + CA_TELEGRAM_SHEET_NAME);
  }

  const dedupWs = ensureContributorAddDedupSheet_(telegramSs);
  const offchainSs = SpreadsheetApp.openById(CA_OFFCHAIN_SPREADSHEET_ID);
  const contributorsWs = offchainSs.getSheetByName(CA_CONTRIBUTORS_SHEET_NAME);
  if (!contributorsWs) {
    throw new Error('Missing sheet: ' + CA_CONTRIBUTORS_SHEET_NAME);
  }

  // --- Read processed update IDs from dedup tab ---
  const seenUpdateIds = readProcessedContributorUpdateIds_(dedupWs);

  // --- Load existing contributor names/emails for duplicate check ---
  const existingNames = getExistingContributorNames_(contributorsWs);
  const existingEmails = getExistingContributorEmails_(contributorsWs);

  // --- Scan Telegram Chat Logs ---
  const lastRow = telegramWs.getLastRow();
  if (lastRow < 2) {
    return { trigger: o.trigger, processed: 0, skipped: 0, reason: 'empty_log' };
  }
  const lastCol = Math.max(CA_TELEGRAM_TEXT_COL, CA_TELEGRAM_UPDATE_ID_COL) + 1;
  const data = telegramWs.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let processed = 0;
  let skipped = 0;
  const newDedupRows = [];
  const newContributorRows = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const text = String(row[CA_TELEGRAM_TEXT_COL] || '');
    if (!text || text.indexOf(CA_EVENT_TAG) < 0) continue;

    const updateId = String(row[CA_TELEGRAM_UPDATE_ID_COL] || '').trim();
    if (!updateId) continue;

    // Already processed — skip.
    if (seenUpdateIds[updateId]) {
      skipped++;
      continue;
    }

    // Parse name and email from event text.
    const parsed = parseContributorAddEvent_(text);
    const dedupRowBase = {
      updateId: updateId,
      submittedAt: parsed.submittedAt || '',
      name: parsed.name || '',
      email: parsed.email || '',
      status: '',
      notes: '',
      processedAt: new Date().toISOString(),
    };

    if (parsed.error) {
      dedupRowBase.status = 'parse_error';
      dedupRowBase.notes = parsed.error;
      newDedupRows.push(dedupRowToArray_(dedupRowBase));
      continue;
    }

    // Check for duplicate name or email in existing contributors.
    const nameLower = String(parsed.name).trim().toLowerCase();
    const emailLower = String(parsed.email).trim().toLowerCase();
    if (nameLower && existingNames[nameLower]) {
      dedupRowBase.status = 'duplicate';
      dedupRowBase.notes = 'Contributor name "' + parsed.name + '" already exists at row ' + existingNames[nameLower] + '.';
      newDedupRows.push(dedupRowToArray_(dedupRowBase));
      continue;
    }
    if (emailLower && existingEmails[emailLower]) {
      dedupRowBase.status = 'duplicate';
      dedupRowBase.notes = 'Contributor email "' + parsed.email + '" already exists at row ' + existingEmails[emailLower] + '.';
      newDedupRows.push(dedupRowToArray_(dedupRowBase));
      continue;
    }

    // Append to Contributors contact information (Col A = Name, Col D = Email).
    // Use the first empty row in Column A, not getLastRow(), because the sheet
    // may have residual data in non-A columns from prior misplaced writes.
    const nextContributorRow = findFirstEmptyContributorRow_(contributorsWs);
    contributorsWs.getRange(nextContributorRow, CA_CONTRIBUTORS_NAME_COL + 1)
        .setValue(parsed.name);
    contributorsWs.getRange(nextContributorRow, CA_CONTRIBUTORS_EMAIL_COL + 1)
        .setValue(parsed.email);
    // Update local sets so duplicate checks within the same batch work.
    if (nameLower) existingNames[nameLower] = nextContributorRow;
    if (emailLower) existingEmails[emailLower] = nextContributorRow;

    dedupRowBase.status = 'added';
    dedupRowBase.notes = 'Added to Contributors contact information row ' + nextContributorRow + '.';
    newDedupRows.push(dedupRowToArray_(dedupRowBase));
    processed++;
  }

  // --- Write dedup rows ---
  if (newDedupRows.length) {
    dedupWs.getRange(dedupWs.getLastRow() + 1, 1, newDedupRows.length, CA_DEDUP_HEADERS.length)
        .setValues(newDedupRows);
  }

  // --- Refresh dao_members.json cache if we added any contributors ---
  if (processed > 0) {
    try {
      Logger.log('Refreshing dao_members.json cache after ' + processed + ' new contributor adds.');
      publishDaoMembersCacheToGithub_({ trigger: 'contributor_add', force: false });
    } catch (cacheErr) {
      Logger.log('Warning: dao_members.json cache refresh failed: ' + cacheErr + '. Contributors sheet was updated; cache will catch up on next scheduled run.');
    }
  }

  return {
    trigger: o.trigger,
    processed: processed,
    skipped_seen: skipped,
    dedup_rows_appended: newDedupRows.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure the "New Contributor" dedup tab exists with canonical headers. */
function ensureContributorAddDedupSheet_(ss) {
  let ws = ss.getSheetByName(CA_DEDUP_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(CA_DEDUP_SHEET_NAME);
  }
  const lastRow = ws.getLastRow();
  if (lastRow === 0) {
    ws.getRange(1, 1, 1, CA_DEDUP_HEADERS.length)
      .setValues([CA_DEDUP_HEADERS]);
    ws.getRange(1, 1, 1, CA_DEDUP_HEADERS.length)
      .setFontWeight('bold');
    ws.setFrozenRows(1);
  }
  return ws;
}

/** Read existing dedup rows → { updateId → status } for skip logic. */
function readProcessedContributorUpdateIds_(dedupWs) {
  const last = dedupWs.getLastRow();
  if (last < 2) return {};
  const data = dedupWs.getRange(2, 1, last - 1, CA_DEDUP_HEADERS.length).getValues();
  const out = {};
  data.forEach(function (r) {
    const u = String(r[CA_DEDUP_UPDATE_ID_COL] || '').trim();
    const status = String(r[CA_DEDUP_STATUS_COL] || '').trim().toLowerCase();
    if (u) out[u] = status;
  });
  return out;
}

/** Return a set of lowercase contributor names → row number from the Contributors sheet. */
function getExistingContributorNames_(ws) {
  const last = ws.getLastRow();
  if (last < 2) return {};
  const data = ws.getRange(2, CA_CONTRIBUTORS_NAME_COL + 1, last - 1, 1).getValues();
  const out = {};
  for (let i = 0; i < data.length; i++) {
    const name = String(data[i][0] || '').trim().toLowerCase();
    if (name) out[name] = i + 2; // 1-indexed sheet row (row 1 = header)
  }
  return out;
}

/** Return a set of lowercase emails → row number from the Contributors sheet. */
function getExistingContributorEmails_(ws) {
  const last = ws.getLastRow();
  if (last < 2) return {};
  const data = ws.getRange(2, CA_CONTRIBUTORS_EMAIL_COL + 1, last - 1, 1).getValues();
  const out = {};
  for (let i = 0; i < data.length; i++) {
    const email = String(data[i][0] || '').trim().toLowerCase();
    if (email) out[email] = i + 2; // 1-indexed sheet row
  }
  return out;
}

/**
 * Find the first empty row in Column A of the Contributors sheet.
 * Uses Column A (the name column) rather than getLastRow() because the sheet
 * may have residual data in other columns from prior misplaced writes.
 * Returns a 1-indexed row number suitable for writing the next contributor.
 */
function findFirstEmptyContributorRow_(ws) {
  // Read Column A from row 2 onward to find the first empty cell.
  // Read in batches of 500 to handle large sheets efficiently.
  const BATCH_SIZE = 500;
  let startRow = 2; // Skip header row
  while (true) {
    const range = ws.getRange(startRow, CA_CONTRIBUTORS_NAME_COL + 1, BATCH_SIZE, 1);
    const values = range.getValues();
    let found = false;
    for (let i = 0; i < values.length; i++) {
      const val = String(values[i][0] || '').trim();
      if (!val) {
        return startRow + i;
      }
    }
    // If we read fewer than BATCH_SIZE, we're past the data; append at end.
    if (values.length < BATCH_SIZE) {
      return startRow + values.length;
    }
    startRow += BATCH_SIZE;
  }
}

/**
 * Parse [CONTRIBUTOR ADD EVENT] text → { name, email, submittedAt, error }.
 * Expected format:
 *   [CONTRIBUTOR ADD EVENT]
 *   - Contributor Name: <name>
 *   - Contributor Email: <email>
 *   - Submitted At: <ISO 8601>
 */
function parseContributorAddEvent_(text) {
  const lines = String(text).split('\n').map(function (s) { return s.trim(); });
  if (!lines.length || lines[0].indexOf(CA_EVENT_TAG) < 0) {
    return { error: 'Missing event tag.' };
  }
  function pluck(prefix) {
    const m = lines.find(function (l) { return l.indexOf(prefix) === 0; });
    return m ? m.substring(prefix.length).trim() : '';
  }
  const name = pluck('- Contributor Name:');
  const email = pluck('- Contributor Email:');
  const submittedAt = pluck('- Submitted At:');

  if (!name) return { error: 'Missing - Contributor Name: line.', name: '', email: '', submittedAt: '' };
  if (!email) return { error: 'Missing - Contributor Email: line.', name: name, email: '', submittedAt: '' };

  // Email validity light check.
  if (email.indexOf('@') < 0) {
    return { error: 'Contributor Email does not contain "@".', name: name, email: email, submittedAt: submittedAt };
  }

  return { name: name, email: email, submittedAt: submittedAt };
}

/** Convert a dedup row object to an array matching CA_DEDUP_HEADERS. */
function dedupRowToArray_(o) {
  return [
    o.updateId,
    o.submittedAt,
    o.name,
    o.email,
    o.status,
    o.notes,
    o.processedAt,
  ];
}
