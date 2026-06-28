/**
 * File: google_app_scripts/tdg_identity_management/GovernorSheetPermissionSync.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Syncs the Main Ledger spreadsheet's editor list to the current governor roster.
 * - Only non-sentinel contributors (real humans) with emails can be editors.
 * - Governors are added; non-governors and sentinels are removed.
 * - The spreadsheet owner is never touched.
 *
 * Rule:
 *   Eligible editor = in Contributors contact information, has email,
 *                     AND is EITHER a governor OR a sentinel.
 *   ADD:    eligible contributors not currently editors
 *   REMOVE: current editors who are NOT eligible (neither governor nor sentinel)
 *   NEVER:  the spreadsheet owner and sentinels
 *
 * Sources:
 *   - Governors tab: col A, rows 11+ (gid=842148543)
 *   - Contributors contact information: col A=name, col D=email, col W=Is Sentinel
 *
 * Triggers:
 *   - Edgar → doGet(?action=sync_governor_editors&secret=...)
 *   - Daily cron: installGovernorSyncTrigger()  (04:00 UTC)
 *   - Manual: syncGovernorEditorsNow()
 */

// ---------- Constants ----------

var SYNC_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var SYNC_GOVERNORS_SHEET = 'Governors';
var SYNC_CONTACT_SHEET = 'Contributors contact information';
var SYNC_LOG_SHEET = 'Governor Sync Log';
var SYNC_GOVERNORS_FIRST_ROW = 11;
var SYNC_LOCK_TIMEOUT_MS = 60000;


// ---------- Web app handler ----------

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

function syncGovernorEditorsNow() {
  var result = syncGovernorEditors_({ trigger: 'manual' });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function syncGovernorEditorsCron_() {
  return syncGovernorEditors_({ trigger: 'cron' });
}

function installGovernorSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'syncGovernorEditorsCron_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncGovernorEditorsCron_')
      .timeBased().everyDays(1).atHour(4).inTimezone('UTC').create();
  Logger.log('Installed daily UTC 04:00 governor-sync trigger.');
}


// ---------- Core sync logic ----------

function syncGovernorEditors_(opts) {
  var o = opts || {};
  var ss = SpreadsheetApp.openById(SYNC_SPREADSHEET_ID);

  // 1. Read governor names from the Governors tab (col A, rows 11+)
  var govSheet = ss.getSheetByName(SYNC_GOVERNORS_SHEET);
  if (!govSheet) throw new Error('Missing sheet: ' + SYNC_GOVERNORS_SHEET);

  var governorNamesLower = {};
  var govLastRow = govSheet.getLastRow();
  if (govLastRow >= SYNC_GOVERNORS_FIRST_ROW) {
    var govRows = govSheet.getRange(SYNC_GOVERNORS_FIRST_ROW, 1,
        govLastRow - SYNC_GOVERNORS_FIRST_ROW + 1, 1).getValues();
    govRows.forEach(function (row) {
      var name = String(row[0] || '').trim();
      if (name) governorNamesLower[name.toLowerCase()] = name;
    });
  }

  if (Object.keys(governorNamesLower).length === 0) {
    logSync_(ss, 'SKIP', '', '', 'Governors tab is empty — no changes applied');
    return { ok: true, governors: 0, added: 0, removed: 0 };
  }

  // 2. Read Contact sheet: name (A), email (D), Is Sentinel (W, index 22)
  //    Eligible = (governor OR sentinel) AND has email
  var contactSheet = ss.getSheetByName(SYNC_CONTACT_SHEET);
  var eligibleEmails = {}; // lowercase email → { name, sentinel }
  var allContactEmails = {}; // ALL emails with names (for logging removed entries)

  if (contactSheet) {
    var contactLastRow = contactSheet.getLastRow();
    if (contactLastRow >= 4) {
      var contactRows = contactSheet.getRange(4, 1, contactLastRow - 3, 23).getValues();
      contactRows.forEach(function (row) {
        var name = String(row[0] || '').trim();         // col A
        var email = String(row[3] || '').trim().toLowerCase(); // col D
        var isSentinel = String(row[22] || '').trim().toUpperCase() === 'TRUE'; // col W

        if (!name || !email) return;

        allContactEmails[email] = name;

        var isGovernor = governorNamesLower.hasOwnProperty(name.toLowerCase());

        if (isGovernor || isSentinel) {
          eligibleEmails[email] = { name: name, sentinel: isSentinel };
        }
      });
    }
  }

  // 3. Get current editors and owner
  var currentEditors = {}; // lowercase email → display email
  var ownerEmail = '';

  try {
    var owner = ss.getOwner();
    if (owner) ownerEmail = owner.getEmail().toLowerCase();
  } catch (_) {}

  try {
    var editors = ss.getEditors();
    editors.forEach(function (user) {
      currentEditors[user.getEmail().toLowerCase()] = user.getEmail();
    });
  } catch (e) {
    throw new Error('Failed to read current editors: ' + e);
  }

  // 4. Compute diffs
  var toAdd = [];
  var toRemove = [];

  // ADD: eligible governor/sentinel emails not currently editors
  Object.keys(eligibleEmails).forEach(function (email) {
    if (!currentEditors.hasOwnProperty(email)) {
      var entry = eligibleEmails[email];
      var label = entry.sentinel ? 'sentinel' : 'governor';
      toAdd.push({ email: email, name: entry.name, label: label });
    }
  });

  // REMOVE: current editors who are NOT eligible AND NOT sentinel AND NOT owner
  Object.keys(currentEditors).forEach(function (email) {
    if (email === ownerEmail) return; // never touch owner

    // Check if this email belongs to a sentinel — always keep
    if (eligibleEmails.hasOwnProperty(email) && eligibleEmails[email].sentinel) return;

    if (!eligibleEmails.hasOwnProperty(email)) {
      var displayName = allContactEmails[email] || '';
      var reasonParts = [];

      if (!allContactEmails.hasOwnProperty(email)) {
        reasonParts.push('not in Contact sheet');
      } else {
        reasonParts.push('neither governor nor sentinel');
      }

      toRemove.push({
        email: email,
        name: displayName,
        reason: reasonParts.join(', ') || 'not an eligible editor',
      });
    }
  });

  // 5. Apply changes
  var added = 0;
  var removed = 0;

  toAdd.forEach(function (entry) {
    try {
      ss.addEditor(entry.email);
      logSync_(ss, 'ADD', entry.email, entry.name, entry.label + ' — added as editor');
      added++;
    } catch (e) {
      logSync_(ss, 'SKIP', entry.email, entry.name, 'addEditor failed: ' + e);
    }
  });

  toRemove.forEach(function (entry) {
    try {
      ss.removeEditor(entry.email);
      logSync_(ss, 'REMOVE', entry.email, entry.name, entry.reason);
      removed++;
    } catch (e) {
      logSync_(ss, 'SKIP', entry.email, entry.name, 'removeEditor failed: ' + e);
    }
  });

  // Log governors without email in Contact sheet
  Object.keys(governorNamesLower).forEach(function (key) {
    var name = governorNamesLower[key];
    var hasEligible = Object.keys(eligibleEmails).some(function (email) {
      return eligibleEmails[email].name.toLowerCase() === key;
    });
    if (!hasEligible) {
      // Check if they're in contact sheet at all
      var inContact = false;
      Object.keys(allContactEmails).forEach(function (email) {
        if (allContactEmails[email].toLowerCase() === key) inContact = true;
      });
      if (!inContact) {
        logSync_(ss, 'SKIP', '', name, 'governor not found in Contact sheet');
      } else {
        logSync_(ss, 'SKIP', '', name, 'governor has no email or is sentinel');
      }
    }
  });

  Logger.log(
    'Governor sync: ' + Object.keys(governorNamesLower).length + ' governors, ' +
    Object.keys(eligibleEmails).length + ' eligible, ' +
    added + ' added, ' + removed + ' removed'
  );

  return {
    ok: true,
    trigger: o.trigger,
    governors: Object.keys(governorNamesLower).length,
    eligible: Object.keys(eligibleEmails).length,
    added: added,
    removed: removed,
    owner_untouched: ownerEmail,
  };
}


// ---------- Helpers ----------

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
