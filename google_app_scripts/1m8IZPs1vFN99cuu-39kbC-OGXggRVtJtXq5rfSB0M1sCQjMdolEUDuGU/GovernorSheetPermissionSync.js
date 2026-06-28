/**
 * File: google_app_scripts/tdg_identity_management/GovernorSheetPermissionSync.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Syncs the Main Ledger spreadsheet's editor list to the current governor roster.
 * - Reads governor names from the "Governors" tab, resolves emails from
 *   "Contributors contact information", and adds/removes editors accordingly.
 * - NEVER removes SA (service account) emails or the spreadsheet owner.
 *
 * Sources:
 *   - Governors tab: col A, rows 11+ (gid=842148543)
 *   - Contributors contact information: col A=name, col D=email (gid=1460794618)
 *
 * Triggers:
 *   - Edgar → doGet(?action=sync_governor_editors)  (after governor rotation)
 *   - Daily cron: installGovernorSyncTrigger()         (safety net at 04:00 UTC)
 *   - Manual: syncGovernorEditorsNow()                 (editor smoke-test)
 */

// ---------- Constants ----------

const SYNC_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const SYNC_GOVERNORS_SHEET = 'Governors';
const SYNC_CONTACT_SHEET = 'Contributors contact information';
const SYNC_LOG_SHEET = 'Governor Sync Log';

// Governors tab: names in column A starting at row 11
const SYNC_GOVERNORS_FIRST_ROW = 11;
const SYNC_GOVERNORS_NAME_COL = 0; // A

// Contact sheet: Name=col A, Email=col D (0-based)
const SYNC_CONTACT_NAME_COL = 0;  // A
const SYNC_CONTACT_EMAIL_COL = 3; // D

// Log tab columns (0-based)
const SYNC_LOG_TIMESTAMP_COL = 0;
const SYNC_LOG_ACTION_COL = 1;
const SYNC_LOG_EMAIL_COL = 2;
const SYNC_LOG_NAME_COL = 3;
const SYNC_LOG_REASON_COL = 4;

const SYNC_LOCK_TIMEOUT_MS = 60000;

// SA emails script property key (comma-separated list in Project Settings)
const SYNC_SA_EMAILS_KEY = 'GOVERNOR_SYNC_SA_EMAILS';

// Hard-coded fallback SA emails if script property is not set
const SYNC_SA_EMAILS_FALLBACK = [
  'admin@truesight.me',
  'admin+sophia@truesight.me',
  'admin+claude@truesight.me',
  'admin+deepseek@truesight.me',
  'admin+kimi@truesight.me',
  'garyjob@gmail.com',
].join(',');


// ---------- Web app handler ----------

/**
 * Called by doGet in Code.js when ?action=sync_governor_editors.
 * body = { secret } — validated by the caller (Code.js) before routing here.
 */
function handleSyncGovernorEditorsRequest_(body) {
  try {
    // Require the same secret as other actions on this web app
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

  // 4. Build protected-accounts set
  var saProp = PropertiesService.getScriptProperties()
      .getProperty(SYNC_SA_EMAILS_KEY) || SYNC_SA_EMAILS_FALLBACK;
  var protectedEmails = {};
  saProp.split(',').forEach(function (e) {
    var email = e.trim().toLowerCase();
    if (email) protectedEmails[email] = true;
  });

  // Owner is always protected
  try {
    var owner = ss.getOwner();
    if (owner) protectedEmails[owner.getEmail().toLowerCase()] = true;
  } catch (_) { /* non-fatal */ }

  // 5. Get current editors
  var currentEditors = {};
  try {
    var editors = ss.getEditors();
    editors.forEach(function (user) {
      currentEditors[user.getEmail().toLowerCase()] = user.getEmail();
    });
  } catch (e) {
    throw new Error('Failed to read current editors: ' + e);
  }

  // 6. Compute diffs
  var toAdd = [];
  var toRemove = [];

  // Add: governor emails not currently editors
  Object.keys(governorEmails).forEach(function (email) {
    if (!currentEditors.hasOwnProperty(email)) {
      toAdd.push({ email: email, name: governorEmails[email] });
    }
  });

  // Remove: current editors not governors, not SA, not owner
  Object.keys(currentEditors).forEach(function (email) {
    if (!governorEmails.hasOwnProperty(email) && !protectedEmails.hasOwnProperty(email)) {
      toRemove.push({ email: currentEditors[email] });
    }
  });

  // 7. Apply changes
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
      logSync_(ss, 'REMOVE', entry.email, '', 'no longer on governor roster');
      removed++;
    } catch (e) {
      logSync_(ss, 'SKIP', entry.email, '', 'removeEditor failed: ' + e);
    }
  });

  // Log warnings for governors without emails
  skippedNoEmail.forEach(function (name) {
    logSync_(ss, 'SKIP', '', name, 'no email found in contact sheet');
  });

  Logger.log(
    'Governor sync: ' + governorNames.length + ' governors, ' +
    added + ' added, ' + removed + ' removed, ' +
    Object.keys(governorEmails).length + ' with email, ' +
    skippedNoEmail.length + ' no-email skipped'
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
  };
}


// ---------- Helpers ----------

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
