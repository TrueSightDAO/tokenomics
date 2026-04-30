/**
 * Daily auto-flip: Hit List rows with Status = "Deferred / Revisit later"
 * AND Follow Up Date <= today get flipped to Status = "Manager Follow-up"
 * with a DApp Remarks row attributing the change to this scheduler.
 *
 * Why: a Deferred row without an automatic resurface mechanism rots — the
 * operator marks "circle back in 6 weeks" and the row sits there indefinitely.
 * The DApp editor (`dapp/store_interaction_history.html`) requires Follow Up
 * Date when Status = Deferred / Revisit later, so every Deferred row carries
 * a date to compare against.
 *
 * Companion DApp validation: TrueSightDAO/dapp#198.
 *
 * Setup (run ONCE, manually, from the Apps Script editor for this project):
 *
 *   1. Open the Apps Script project at
 *      https://script.google.com/home (the find_nearby_stores web app
 *      script — same project that hosts updateStoreStatus / addNewStore).
 *   2. Pull the latest reference files via clasp (this file lands as
 *      process_deferred_auto_flip.gs alongside Code.js).
 *   3. Run `installDeferredAutoFlipTrigger` from the function dropdown.
 *      Approves the time-driven trigger; runs nightly thereafter.
 *
 * To dry-run / debug:
 *
 *   - Run `processDeferredAutoFlip` directly from the function dropdown;
 *     it logs every candidate + action without prompting and is safe to
 *     re-run (already-flipped rows no longer match the Status filter).
 *
 * No rate limit (per Gary 2026-04-30): if a row is re-deferred and the
 * date passes again, it will flip again. Each flip writes a new DApp
 * Remarks row so the timeline carries the full history.
 */

/**
 * Spreadsheet + sheet identifiers. These mirror the constants Code.js uses.
 * Kept local so the scanner is self-contained and runs even if the deployed
 * Code.js is mid-refactor.
 */
var DEFERRED_AUTO_FLIP_SPREADSHEET_ID = '1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc';
var DEFERRED_AUTO_FLIP_HIT_LIST_SHEET = 'Hit List';
var DEFERRED_AUTO_FLIP_DAPP_REMARKS_SHEET = 'DApp Remarks';

var DEFERRED_AUTO_FLIP_FROM_STATUS = 'Deferred / Revisit later';
var DEFERRED_AUTO_FLIP_TO_STATUS = 'Manager Follow-up';

/** Identifier written to DApp Remarks `Submitted By` so operators can
 *  filter "what did the cron do?" via a simple sheet filter. */
var DEFERRED_AUTO_FLIP_SUBMITTED_BY = 'auto-flip-deferred';

/** Identifier written to `Status Updated By` so the existing column carries
 *  consistent provenance for both human edits and this cron. */
var DEFERRED_AUTO_FLIP_STATUS_UPDATED_BY = 'system:deferred-auto-flip';


/**
 * Public entry point — find Deferred-and-due rows on Hit List, flip them
 * to Manager Follow-up, log a DApp Remarks row per flip. Logs counts to the
 * Apps Script execution log.
 *
 * @returns {{scanned: number, flipped: number, skipped_no_date: number, skipped_future: number, errors: number}}
 */
function processDeferredAutoFlip() {
  var ss = SpreadsheetApp.openById(DEFERRED_AUTO_FLIP_SPREADSHEET_ID);
  var hitSheet = ss.getSheetByName(DEFERRED_AUTO_FLIP_HIT_LIST_SHEET);
  if (!hitSheet) {
    throw new Error('Hit List sheet not found on ' + DEFERRED_AUTO_FLIP_SPREADSHEET_ID);
  }

  var lastRow = hitSheet.getLastRow();
  var lastCol = hitSheet.getLastColumn();
  if (lastRow < 2) {
    Logger.log('Hit List has no data rows; nothing to flip.');
    return { scanned: 0, flipped: 0, skipped_no_date: 0, skipped_future: 0, errors: 0 };
  }

  var values = hitSheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h || '').trim(); });

  var idxStatus = headers.indexOf('Status');
  var idxShop = headers.indexOf('Shop Name');
  var idxFollowUp = headers.indexOf('Follow Up Date');
  if (idxStatus === -1 || idxShop === -1 || idxFollowUp === -1) {
    throw new Error('Hit List missing one of: Status / Shop Name / Follow Up Date');
  }
  var idxStatusUpdatedBy = headers.indexOf('Status Updated By');
  var idxStatusUpdatedDate = headers.indexOf('Status Updated Date');

  var todayStartMs = (function () {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  })();

  var stats = { scanned: 0, flipped: 0, skipped_no_date: 0, skipped_future: 0, errors: 0 };

  for (var r = 1; r < values.length; r++) {
    var status = String(values[r][idxStatus] || '').trim();
    if (status !== DEFERRED_AUTO_FLIP_FROM_STATUS) continue;
    stats.scanned++;

    var shopName = String(values[r][idxShop] || '').trim();
    if (!shopName) {
      Logger.log('Skip row ' + (r + 1) + ': blank shop name on Deferred row');
      stats.errors++;
      continue;
    }

    var fuRaw = values[r][idxFollowUp];
    var fuDate = parseDeferredFollowUpDate_(fuRaw);
    if (!fuDate) {
      Logger.log('Skip ' + shopName + ': Deferred row has unparseable Follow Up Date "' + fuRaw + '"');
      stats.skipped_no_date++;
      continue;
    }
    if (fuDate.getTime() > todayStartMs) {
      stats.skipped_future++;
      continue;
    }

    try {
      // Flip Status cell.
      hitSheet.getRange(r + 1, idxStatus + 1).setValue(DEFERRED_AUTO_FLIP_TO_STATUS);

      // Stamp provenance columns when present (they're created lazily by
      // updateStoreStatus the first time a human saves an edit; not always
      // there yet for older sheets).
      var nowDate = new Date();
      if (idxStatusUpdatedBy !== -1) {
        hitSheet.getRange(r + 1, idxStatusUpdatedBy + 1).setValue(DEFERRED_AUTO_FLIP_STATUS_UPDATED_BY);
      }
      if (idxStatusUpdatedDate !== -1) {
        hitSheet.getRange(r + 1, idxStatusUpdatedDate + 1).setValue(nowDate);
      }

      var remark = 'Auto-resurfaced from "' + DEFERRED_AUTO_FLIP_FROM_STATUS +
        '" — Follow Up Date ' + Utilities.formatDate(fuDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
        ' has arrived; Status flipped to "' + DEFERRED_AUTO_FLIP_TO_STATUS + '".';
      appendDeferredAutoFlipRemark_(ss, shopName, DEFERRED_AUTO_FLIP_TO_STATUS, remark);

      stats.flipped++;
      Logger.log('Flipped: ' + shopName + ' (Follow Up was ' +
        Utilities.formatDate(fuDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') + ')');
    } catch (err) {
      Logger.log('Error flipping ' + shopName + ': ' + (err && err.message ? err.message : err));
      stats.errors++;
    }
  }

  Logger.log('processDeferredAutoFlip done: ' + JSON.stringify(stats));
  return stats;
}


/**
 * Best-effort parse for the Follow Up Date cell. Sheets returns Date objects
 * for date-formatted cells and strings for plain-text cells; both are normalized
 * to a Date at midnight (no time-of-day). Returns null when unparseable.
 *
 * @param {*} value Raw cell value.
 * @returns {Date|null}
 */
function parseDeferredFollowUpDate_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  var s = String(value).trim();
  if (!s) return null;
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}


/**
 * Append a row to DApp Remarks reflecting the auto-flip. Uses the same
 * column layout as `logDappSubmission_` in Code.js (Submission ID / Shop
 * Name / Status / Remarks / Submitted By / Submitted At / Processed /
 * Processed At / Update ID / Attachment Raw URL / Attachment GitHub URL).
 *
 * Self-contained so the cron survives Code.js refactors.
 */
function appendDeferredAutoFlipRemark_(spreadsheet, shopName, statusAfter, remarks) {
  var sheet = spreadsheet.getSheetByName(DEFERRED_AUTO_FLIP_DAPP_REMARKS_SHEET);
  if (!sheet) {
    throw new Error('DApp Remarks sheet not found');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    throw new Error('DApp Remarks has no header row');
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });

  var submissionId = Utilities.getUuid();
  var submittedAt = new Date();

  var colMap = {};
  colMap['Submission ID'] = submissionId;
  colMap['Shop Name'] = shopName || '';
  colMap['Status'] = statusAfter || '';
  colMap['Remarks'] = remarks || '';
  colMap['Submitted By'] = DEFERRED_AUTO_FLIP_SUBMITTED_BY;
  colMap['Submitted At'] = submittedAt;
  // 'Status Applied' matches the value Code.js writes when an edit-with-status
  // change has already taken effect (vs 'Yes' for done / 'No' for pending).
  colMap['Processed'] = 'Status Applied';
  colMap['Processed At'] = '';
  colMap['Update ID'] = '';
  colMap['Attachment Raw URL'] = '';
  colMap['Attachment GitHub URL'] = '';

  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var hn = headers[c];
    row[c] = Object.prototype.hasOwnProperty.call(colMap, hn) ? colMap[hn] : '';
  }
  sheet.appendRow(row);
  return submissionId;
}


/**
 * Idempotent installer for the daily time-trigger. Run once from the
 * Apps Script editor function dropdown. Skips creation if an equivalent
 * trigger already exists.
 *
 * Schedule: nightly at 03:00 in the script's timezone (low-traffic window
 * before any operator touches the sheet in the morning).
 */
function installDeferredAutoFlipTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'processDeferredAutoFlip') {
      Logger.log('Trigger already installed (id=' + existing[i].getUniqueId() + ').');
      return existing[i].getUniqueId();
    }
  }
  var t = ScriptApp.newTrigger('processDeferredAutoFlip')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  Logger.log('Installed daily processDeferredAutoFlip trigger (id=' + t.getUniqueId() + ').');
  return t.getUniqueId();
}


/**
 * Inverse of installDeferredAutoFlipTrigger — useful when migrating the
 * scheduler to a different Apps Script project or temporarily disabling
 * the auto-flip during a Hit List restructure.
 */
function uninstallDeferredAutoFlipTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'processDeferredAutoFlip') {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  Logger.log('Removed ' + removed + ' processDeferredAutoFlip trigger(s).');
  return removed;
}
