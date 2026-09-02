/**
 * File: google_app_scripts/1UrBgqLnnQc6PV4-.../process_plot_invalidation.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Description: Processes [PLOT INVALIDATION EVENT] submissions from "Telegram Chat Logs" - marks a
 * SunMint Plots row as Status='invalid' so the plot stops appearing in the farmSelect dropdown and
 * the impact map (build_plots_geojson.py skips status=='invalid' rows when generating plots/index.geojson).
 *
 * REAL PERMISSION BOUNDARY (unlike the free-for-all media retraction): only DAO governors and
 * sentinels may invalidate a plot. Enforcement is SERVER-SIDE here, in the GAS handler, so a forged
 * client request is rejected even if the client hides the button. The allowlist is the GAS Script
 * Property PI_GOVERNOR_SENTINEL_EMAILS (comma-separated emails), same pattern as FBE_GH_PAT.
 *
 * Soft-invalidate, never delete: the row keeps Plot ID / Plot Name / Notes / audit trail; Status is
 * flipped to 'invalid' + Invalidated By / Reason / At columns are recorded. A governor can restore by
 * setting Status back (manual sheet edit or future revert event).
 *
 * Shares this GAS project (and its global scope) with process_qr_code_updates.js - reuses SOURCE_SHEET_URL /
 * SOURCE_SHEET_NAME / MESSAGE_COL / TELEGRAM_UPDATE_ID_COL constants, resolveContributorNameFromPublicSignature_,
 * and pingPlotsIndexRebuild_ (from process_farm_boundary_evidence.gs). All new identifiers are prefixed PI_.
 * doGet(e) already exists in process_qr_code_updates.js - this file does NOT declare a second one.
 */

const PLOT_INVALIDATION_EVENT_MARKER = '[PLOT INVALIDATION EVENT]';

// ----- Tracking tab (lives on SOURCE_SHEET_URL's spreadsheet) -----
const PI_TRACKING_TAB = 'Plot Invalidation';
const PI_TRACKING_HEADERS = [
  'Telegram Update ID',
  'Telegram Message ID',
  'Plot ID',
  'Reason',
  'Retractor Email',
  'Status',
  'Processed Timestamp'
];

// ----- SunMint Plots sheet (target = the generator's source of truth, SHEET_ID 1qbZZhf...) -----
const PI_PLOTS_TAB = 'SunMint Plots';
const PI_SHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';

// Script Property holding the comma-separated governor+sentinel email allowlist (set in Project Settings).
const PI_ALLOWLIST_PROP = 'PI_GOVERNOR_SENTINEL_EMAILS';

/** Normalizes a [PLOT INVALIDATION EVENT] message body. */
function normalizePlotInvalidationMessage_(message) {
  return String(message || '').replace(/\r\n/g, '\n');
}

/** Extracts plot-invalidation fields from a message body. */
function extractPlotInvalidationInfo_(message) {
  var result = { plotId: '', reason: '', retractorEmail: '', publicSignature: '' };
  try {
    var m = String(message || '');
    function grab(label) {
      var re = new RegExp(label + ':\\s*([^\n]+)', 'i');
      var mm = m.match(re);
      return mm ? String(mm[1]).trim() : '';
    }
    result.plotId = grab('Plot ID');
    result.reason = grab('Reason');
    result.retractorEmail = grab('Retractor Email');
    var sigMatch = m.match(/My Digital Signature:\s*([^\n]+)/i);
    if (sigMatch) result.publicSignature = String(sigMatch[1]).trim();
  } catch (e) {
    Logger.log('extractPlotInvalidationInfo_ error: ' + e.message);
  }
  return result;
}

/** Returns the processed-message-id set from the tracking tab (mirror of TGM helper). */
function getProcessedPlotInvalidationMessageIds_(sheet) {
  var ids = {};
  try {
    if (sheet.getLastRow() < 2) return ids;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][1]) ids[String(data[i][1]).trim()] = true;
    }
  } catch (e) {
    Logger.log('getProcessedPlotInvalidationMessageIds_ error: ' + e.message);
  }
  return ids;
}

function piHeaderIndex_(header, names) {
  var hl = header.map(function (h) { return String(h || '').trim().toLowerCase(); });
  for (var i = 0; i < names.length; i++) {
    var exact = hl.indexOf(names[i]);
    if (exact !== -1) return exact; // 0-based column index
  }
  for (var i = 0; i < names.length; i++) {
    for (var c = 0; c < hl.length; c++) {
      if (hl[c] && hl[c].indexOf(names[i]) === 0) return c;
    }
  }
  return -1;
}

/**
 * SERVER-SIDE role gate. Returns true iff the given email is in the PI_GOVERNOR_SENTINEL_EMAILS
 * allowlist script property. If the property is unset, this deliberately FAILS CLOSED (no one may
 * invalidate) rather than opening the gate - the governor must configure the property first.
 */
function piIsGovernorOrSentinel_(email) {
  if (!email) return false;
  var allowRaw = PropertiesService.getScriptProperties().getProperty(PI_ALLOWLIST_PROP);
  if (!allowRaw) {
    Logger.log('PI gate: allowlist property ' + PI_ALLOWLIST_PROP + ' is NOT set - failing closed.');
    return false;
  }
  var needle = String(email).trim().toLowerCase();
  var allow = String(allowRaw).split(',').map(function (s) { return String(s).trim().toLowerCase(); })
    .filter(function (s) { return s.length > 0; });
  return allow.indexOf(needle) !== -1;
}

/**
 * Marks the plot row Status='invalid' + records Invalidated By / Reason / At (columns created if
 * missing). Returns { rowFound, statusSet, matchingRow }.
 */
function piMarkPlotInvalid_(plotId, reason, retractorEmail) {
  if (!plotId) return { rowFound: false, statusSet: false };
  try {
    var spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    var sheet = spreadsheet.getSheetByName(PI_PLOTS_TAB);
    if (!sheet) return { rowFound: false, statusSet: false };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { rowFound: false, statusSet: false };
    var header = data[0];
    var plotCol = piHeaderIndex_(header, ['plot id', 'plot']);
    if (plotCol === -1) return { rowFound: false, statusSet: false };

    var key = String(plotId).trim().toLowerCase();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      var rowPlot = String(data[i][plotCol] || '').trim().toLowerCase();
      if (rowPlot === key) { rowIndex = i + 1; break; } // 1-based
    }
    if (rowIndex === -1) return { rowFound: false, statusSet: false };

    // Status -> invalid
    var statusCol = piHeaderIndex_(header, ['status']);
    if (statusCol === -1) return { rowFound: false, statusSet: false };
    sheet.getRange(rowIndex, statusCol + 1).setValue('invalid');

    // Ensure audit columns exist.
    var byCol = piHeaderIndex_(header, ['invalidated by', 'invalidated_by']);
    var reasonCol = piHeaderIndex_(header, ['invalidated reason', 'invalidated_reason', 'reason']);
    var atCol = piHeaderIndex_(header, ['invalidated at', 'invalidated_at']);
    var lastHeader = header.length;
    if (byCol === -1) { sheet.getRange(1, lastHeader + 1).setValue('Invalidated By'); byCol = lastHeader; lastHeader++; }
    if (reasonCol === -1) { sheet.getRange(1, lastHeader + 1).setValue('Invalidated Reason'); reasonCol = lastHeader; lastHeader++; }
    if (atCol === -1) { sheet.getRange(1, lastHeader + 1).setValue('Invalidated At'); atCol = lastHeader; }

    sheet.getRange(rowIndex, byCol + 1).setValue(String(retractorEmail || 'unknown'));
    sheet.getRange(rowIndex, reasonCol + 1).setValue(String(reason || ''));
    sheet.getRange(rowIndex, atCol + 1).setValue(new Date().toISOString());

    Logger.log('PI marked plot ' + plotId + ' invalid by ' + retractorEmail);
    return { rowFound: true, statusSet: true };
  } catch (e) {
    Logger.log('piMarkPlotInvalid_ error: ' + e.message);
    return { rowFound: false, statusSet: false };
  }
}

/**
 * Main entry: processes pending [PLOT INVALIDATION EVENT] rows from Telegram Chat Logs (cron fallback -
 * same pattern as processFarmBoundaryEvidenceFromTelegramChatLogs). Scans SOURCE_SHEET_URL's Telegram Chat
 * Logs for the marker; enforces the governor/sentinel allowlist gate SERVER-SIDE; marks the plot invalid;
 * pings the plots-index rebuild; appends tracking.
 */
function processPlotInvalidationFromTelegramChatLogs() {
  var spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  var chatLogs = spreadsheet.getSheetByName(SOURCE_SHEET_NAME); // Telegram Chat Logs
  if (!chatLogs) throw new Error('Telegram Chat Logs sheet not found');

  var tracking = spreadsheet.getSheetByName(PI_TRACKING_TAB);
  if (!tracking) {
    tracking = spreadsheet.insertSheet(PI_TRACKING_TAB);
    tracking.appendRow(PI_TRACKING_HEADERS);
  }
  var processedIds = getProcessedPlotInvalidationMessageIds_(tracking);

  var lastRow = chatLogs.getLastRow();
  if (lastRow < 2) return { processed: 0, skipped: 0, errors: 0 };
  var data = chatLogs.getRange(1, 1, lastRow, Math.max(MESSAGE_COL + 1, TELEGRAM_UPDATE_ID_COL + 1)).getValues();

  var processed = 0, skipped = 0, errors = 0;
  var anyInvalidated = false;
  for (var i = 1; i < data.length; i++) {
    var updateId = String(data[i][TELEGRAM_UPDATE_ID_COL] || '').trim();
    var message = String(data[i][MESSAGE_COL] || '');
    if (message.indexOf(PLOT_INVALIDATION_EVENT_MARKER) === -1) continue;

    var msgId = String(data[i][3] || '').trim(); // Column D = Telegram Message ID (stable dedup key)
    if (!msgId || processedIds[msgId]) { skipped++; continue; }

    try {
      var info = extractPlotInvalidationInfo_(message);
      if (!info.plotId || !info.reason) {
        Logger.log('PI skip (missing plotId/reason) msgId=' + msgId);
        skipped++;
        continue;
      }

      // ---- SERVER-SIDE role gate (governor + sentinel only, allowlist) ----
      var status = 'REJECTED_ROLE';
      if (piIsGovernorOrSentinel_(info.retractorEmail)) {
        status = 'PROCESSED';
      }

      var invalidated = false;
      if (status === 'PROCESSED') {
        var res = piMarkPlotInvalid_(info.plotId, info.reason, info.retractorEmail);
        invalidated = res.statusSet;
        if (!res.rowFound) status = 'PLOT_NOT_FOUND';
        if (invalidated) anyInvalidated = true;
      }

      tracking.appendRow([
        updateId, msgId, info.plotId, info.reason,
        info.retractorEmail, status, new Date().toISOString()
      ]);
      processedIds[msgId] = true;
      processed++;
      Logger.log('PI msgId=' + msgId + ' plot=' + info.plotId + ' status=' + status);
    } catch (e) {
      Logger.log('PI error msgId=' + msgId + ': ' + e.message);
      errors++;
    }
  }

  // Only ping a rebuild if at least one plot actually flipped to invalid.
  if (anyInvalidated) {
    try { pingPlotsIndexRebuild_(); } catch (e) { Logger.log('PI pingPlotsIndexRebuild_ error: ' + e.message); }
  }
  return { processed: processed, skipped: skipped, errors: errors };
}
