/**
 * File: google_app_scripts/tdg_identity_management/GovernorSheetPermissionSync.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Syncs the Main Ledger spreadsheet's editor list to the current governor roster.
 * - Reads governor names from the "Governors" tab, resolves emails from
 *   "Contributors contact information", and adds/removes editors accordingly.
 * - NEVER removes editors unless they were previously ADDED by this very script
 *   AND are no longer governors. This is safe against unknown SA accounts,
 *   GitHub Actions bots, GCP service accounts, or manually-shared humans.
 *
 * Safety philosophy:
 *   - ADD:   any governor email not already an editor  → addEditor()
 *   - REMOVE: only editors previously added BY THIS SCRIPT (tracked in
 *             Governor Sync Log) who are no longer governors → removeEditor()
 *   - NEVER remove: the spreadsheet owner, any SA/gserviceaccount, or any
 *     editor we didn't add ourselves.
 *
 * Sources:
 *   - Governors tab: col A, rows 11+ (gid=842148543)
 *   - Contributors contact information: col A=name, col D=email (gid=1460794618)
 *
 * Triggers:
 *   - Edgar → doGet(?action=sync_governor_editors&secret=...)  (after governor rotation)
 *   - Daily cron: installGovernorSyncTrigger()                   (safety net at 04:00 UTC)
 *   - Manual: syncGovernorEditorsNow()                           (editor smoke-test)
 */

// ---------- Constants ----------

const SYNC_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const SYNC_GOVERNORS_SHEET = 'Governors';
const SYNC_CONTACT_SHEET = 'Contributors contact information';
const SYNC_LOG_SHEET = 'Governor Sync Log';

// Governors tab: names in column A starting at row 11
const SYNC_GOVERNORS_FIRST_ROW = 11;

// Contact sheet: Name=col A, Email=col D (0-based)
const SYNC_CONTACT_NAME_COL = 0;  // A
const SYNC_CONTACT_EMAIL_COL = 3; // D

const SYNC_LOCK_TIMEOUT_MS = 60000;

/** Patterns that identify an email as a non-human service/automation account.
 *  These are NEVER removed regardless of governor status. */
const SA_EMAIL_PATTERNS = [
  /@.+.iam.gserviceaccount\.com$/i,          // GCP IAM service accounts
  /@.+.gserviceaccount\.com$/i,              // older GCP service accounts
  /admin\+/i,                                 // admin+*@truesight.me (agent aliases)
  /^admin@truesight\.me$/i,                   // master autopilot
];


// ---------- Web app handler ----------

/**
 * Called by doGet in Code.js when ?action=sync_governor_editors&secret=...
 */
function handleSyncGovernorEditorsRequest_(body) {
  try {
    var expected = PropertiesService.getScriptProperties()
        .getProperty('EMAIL_VERIFICATION_SECRET');
    if (!expected || String(body.secret || '') !== String(expected)) {
      return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
          .setMimeType(ContentService.MimeType.JSON);
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(SYNC_LOCK_TIMEOUT_MS)) {
      return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'busy' }))
          .setMimeType(ContentService.MimeType.JSON);
    }
    try {
      var result = syncGovernorEditors_({ trigger: 'edgar_webhook' });
      return ContentService
          .createTextOutput(JSON.stringify({ ok: true, result: result }))
          .setMimeType(ContentService.MimeType.JSON);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}


// ---------- Manual / cron entry points ----------

/** Run from the Apps Script editor for smoke-testing. */
function syncGovernorEditorsNow() {
  var result = syncGovernorEditors_({ trigger: 'manual' });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** Daily cron wrapper. Install once via installGovernorSyncTrigger(). */
function syncGovernorEditorsCron_() {
  return syncGovernorEditors_({ trigger: 'cron' });
}

/** One-time setup. Creates a daily trigger at 04:00 UTC. */
function installGovernorSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'syncGovernorEditorsCron_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncGovernorEditorsCron_')
      .timeBased()
      .everyDays(1)
      .atHour(4)
      .inTimezone('UTC')
      .create();
  Logger.log('Installed daily UTC 04:00 governor-sync trigger.');
}


// ---------- Core sync logic ----------

function syncGovernorEditors_(opts) {
  var o = opts || {};
  var ss = SpreadsheetApp.openById(SYNC_SPREADSHEET_ID);

  // 1. Read governor names from the Governors tab
  var govSheet = ss.getSheetByName(SYNC_GOVERNORS_SHEET);
  if (!govSheet) {
    throw new Error('Missing sheet: ' + SYNC_GOVERNORS_SHEET);
  }
  var govLastRow = govSheet.getLastRow();
  var governorNames = [];
  if (govLastRow >= SYNC_GOVERNORS_FIRST_ROW) {
    var govRows = govSheet
        .getRange(SYNC_GOVERNORS_FIRST_ROW, 1, govLastRow - SYNC_GOVERNORS_FIRST_ROW + 1, 1)
        .getValues();
    govRows.forEach(function (row) {
      var name = String(row[0] || '').trim();
      if (name) governorNames.push(name);
    });
  }

  if (!governorNames.length) {
    logSync_(ss, 'SKIP', '', '', 'Governors tab is empty — no changes applied');
    return { ok: true, governors: 0, added: 0, removed: 0 };
  }

  // 2. Read contact sheet → name→email map
  var contactSheet = ss.getSheetByName(SYNC_CONTACT_SHEET);
  var nameToEmail = {};
  if (contactSheet) {
    var contactLastRow = contactSheet.getLastRow();
    if (contactLastRow >= 4) {
      var contactRows = contactSheet.getRange(4, 1, contactLastRow - 3, 23).getValues();
      contactRows.forEach(function (row) {
        var name = String(row[SYNC_CONTACT_NAME_COL] || '').trim();
        var email = String(row[SYNC_CONTACT_EMAIL_COL] || '').trim().toLowerCase();
        if (name && email) {
          nameToEmail[name.toLowerCase()] = email;
        }
      });
    }
  }

  // 3. Resolve governor emails
  var governorEmails = {}; // lowercase email → original governor name
  var skippedNoEmail = [];
  governorNames.forEach(function (name) {
    var key = name.toLowerCase();
    var email = nameToEmail[key];
    if (email) {
      governorEmails[email] = name;
    } else {
      skippedNoEmail.push(name);
    }
  });

  // 4. Get current editors
  var currentEditors = {};
  var ownerEmail = '';
  try {
    var owner = ss.getOwner();
    if (owner) ownerEmail = owner.getEmail().toLowerCase();
  } catch (_) { /* non-fatal */ }

  try {
    var editors = ss.getEditors();
    editors.forEach(function (user) {
      currentEditors[user.getEmail().toLowerCase()] = user.getEmail();
    });
  } catch (e) {
    throw new Error('Failed to read current editors: ' + e);
  }

  // 5. Read log to find which editors were previously added BY THIS SCRIPT.
  //    Only these are eligible for removal. Everything else is hands-off.
  var previouslyAdded = readPreviouslyAddedEmails_(ss);

  // 6. Determine who is a service account (never touched)
  function isServiceAccount(email) {
    return SA_EMAIL_PATTERNS.some(function (pat) { return pat.test(email); });
  }

  // 7. Compute diffs
  var toAdd = [];
  var toRemove = [];

  // Add: governor emails not currently editors
  Object.keys(governorEmails).forEach(function (email) {
    if (!currentEditors.hasOwnProperty(email)) {
      toAdd.push({ email: email, name: governorEmails[email] });
    }
  });

  // Remove: previously-added-by-us editors who are no longer governors
  previouslyAdded.forEach(function (email) {
    if (!governorEmails.hasOwnProperty(email) &&
        currentEditors.hasOwnProperty(email)) {
      // Extra safety: double-check not SA, not owner
      if (!isServiceAccount(email) && email !== ownerEmail) {
        toRemove.push({ email: email });
      }
    }
  });

  // 8. Apply changes
  var added = 0;
  var removed = 0;

  toAdd.forEach(function (entry) {
    try {
      ss.addEditor(entry.email);
      logSync_(ss, 'ADD', entry.email, entry.name, 'joined governor roster');
      added++;
    } catch (e) {
      logSync_(ss, 'SKIP', entry.email, entry.name, 'addEditor failed: ' + e);
    }
  });

  toRemove.forEach(function (entry) {
    try {
      ss.removeEditor(entry.email);
      logSync_(ss, 'REMOVE', entry.email, '', 'no longer on governor roster (was added by this script on ' +
          formatPreviouslyAddedDate_(ss, entry.email) + ')');
      removed++;
    } catch (e) {
      logSync_(ss, 'SKIP', entry.email, '', 'removeEditor failed: ' + e);
    }
  });

  // Log warnings for governors without emails
  skippedNoEmail.forEach(function (name) {
    logSync_(ss, 'SKIP', '', name, 'no email found in contact sheet');
  });

  // 9. Report
  var saCount = Object.keys(currentEditors).filter(isServiceAccount).length;
  var manualEditors = Object.keys(currentEditors).filter(function (e) {
    return !isServiceAccount(e) && e !== ownerEmail && !governorEmails.hasOwnProperty(e);
  });

  Logger.log(
    'Governor sync: ' + governorNames.length + ' governors, ' +
    added + ' added, ' + removed + ' removed, ' +
    Object.keys(governorEmails).length + ' with email, ' +
    skippedNoEmail.length + ' no-email skipped, ' +
    saCount + ' service accounts (untouched), ' +
    manualEditors.length + ' manual editors (untouched)'
  );

  return {
    ok: true,
    trigger: o.trigger,
    governors: governorNames.length,
    with_email: Object.keys(governorEmails).length,
    added: added,
    removed: removed,
    skipped_no_email: skippedNoEmail.length,
    skipped_names: skippedNoEmail,
    service_accounts_untouched: saCount,
    manual_editors_untouched: manualEditors.length,
  };
}


// ---------- Helpers ----------

/** Read the log tab to find emails previously ADD-ed by this script.
 *  Returns a Set of lowercase emails. */
function readPreviouslyAddedEmails_(ss) {
  var logSheet = ss.getSheetByName(SYNC_LOG_SHEET);
  if (!logSheet) return [];

  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return []; // header only

  // Read all ADD rows (col B = Action, col C = Email)
  var data = logSheet.getRange(2, 2, lastRow - 1, 2).getValues();
  var added = {};
  var removed = {};

  // Walk chronologically: ADD adds to set, REMOVE removes from set
  // This handles re-adds (governor leaves and comes back)
  data.forEach(function (row) {
    var action = String(row[0] || '').trim().toUpperCase();
    var email = String(row[1] || '').trim().toLowerCase();
    if (!email) return;
    if (action === 'ADD') {
      added[email] = true;
      delete removed[email];
    } else if (action === 'REMOVE') {
      delete added[email];
      removed[email] = true;
    }
  });

  return Object.keys(added).sort();
}

/** Find the most recent ADD date for an email from the log. */
function formatPreviouslyAddedDate_(ss, email) {
  var logSheet = ss.getSheetByName(SYNC_LOG_SHEET);
  if (!logSheet) return 'unknown date';

  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return 'unknown date';

  // Read backwards to find the most recent ADD
  var timestamps = logSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var actions = logSheet.getRange(2, 2, lastRow - 1, 1).getValues();
  var emails = logSheet.getRange(2, 3, lastRow - 1, 1).getValues();

  for (var i = emails.length - 1; i >= 0; i--) {
    var storedEmail = String(emails[i][0] || '').toLowerCase();
    var action = String(actions[i][0] || '').toUpperCase();
    if (storedEmail === email.toLowerCase() && action === 'ADD') {
      return String(timestamps[i][0] || '');
    }
  }
  return 'unknown date';
}

/** Append a row to the "Governor Sync Log" tab. Creates the tab if absent. */
function logSync_(ss, action, email, name, reason) {
  var logSheet = ss.getSheetByName(SYNC_LOG_SHEET);
  if (!logSheet) {
    logSheet = ss.insertSheet(SYNC_LOG_SHEET);
    logSheet.appendRow(['Timestamp', 'Action', 'Email', 'Governor Name', 'Reason']);
    logSheet.setFrozenRows(1);
  }
  logSheet.appendRow([
    new Date().toISOString(),
    action,
    email,
    name,
    reason,
  ]);
}
