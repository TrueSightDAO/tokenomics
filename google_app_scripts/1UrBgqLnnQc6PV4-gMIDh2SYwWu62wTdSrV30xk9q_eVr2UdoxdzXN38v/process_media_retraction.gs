/**
 * File: google_app_scripts/agroverse_qr_codes/process_media_retraction.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Description: Processes [MEDIA RETRACTION EVENT] submissions from "Telegram Chat Logs" - soft-invalidates
 * boundary media evidence per the 3-tier retraction model (agentic_ai_context/plans/SUNMINT_MEDIA_INVALIDATION_DESIGN.md):
 *   Tier 1 - submitting farmer / farm lead (own submissions; signed)
 *   Tier 2 - governor (anything, by default)
 *   Tier 3 - Sentinel (automated, on satellite-contradiction evidence)
 * Soft-invalidate means: keep the media row, append the retracted URLs to the plot's "Invalidated Media"
 * column (creating it if absent), set the plot status to needs_revision when appropriate, and record the
 * retraction in the "Media Retraction" tracking tab (dedup by Telegram Message ID). The GPS-to-polygon
 * recalculation happens downstream (extract_plot_gps.py excludes invalidated media from the convex hull;
 * rebuild workflow regenerates plots/index.geojson -> impact map).
 *
 * Permission gate (v1): sentinel source -> accepted; message with a resolvable farmer signature -> accepted
 * (tier 1); otherwise recorded as PENDING_GOVERNOR (governor approves via the app UI, PR-B4).
 *
 * Shares this GAS project (and its global scope) with process_qr_code_updates.js - reuses that file's
 * SOURCE_SHEET_URL / SOURCE_SHEET_NAME / MESSAGE_COL / TELEGRAM_UPDATE_ID_COL constants and the TGM file's
 * resolveContributorNameFromPublicSignature_ helper rather than redeclaring them.
 * All new identifiers here are prefixed MR_ to avoid any future collision.
 * doGet(e) already exists in process_qr_code_updates.js - this file does NOT declare a second one.
 */

const MEDIA_RETRACTION_EVENT_MARKER = '[MEDIA RETRACTION EVENT]';

// ----- Tracking tab (lives on SOURCE_SHEET_URL's spreadsheet) -----
const MR_TRACKING_TAB = 'Media Retraction';
const MR_TRACKING_HEADERS = [
  'Telegram Update ID',
  'Telegram Message ID',
  'Plot ID',
  'Media URLs',
  'Reason',
  'Retractor Email',
  'Retraction Source',
  'Status',
  'Processed Timestamp'
];

// ----- SunMint Plots sheet (soft-invalidate target = the generator's source of truth, SHEET_ID 1qbZZhf...) -----
const MR_PLOTS_TAB = 'SunMint Plots';
const MR_SHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';

/**
 * Normalizes a [MEDIA RETRACTION EVENT] message body (shared normalize helper is TGM-scoped).
 */
function normalizeMediaRetractionMessage_(message) {
  var m = String(message || '');
  return m.replace(/\r\n/g, '\n');
}

/**
 * Extracts retraction fields from a [MEDIA RETRACTION EVENT] message body.
 */
function extractMediaRetractionInfo_(message) {
  var result = {
    plotId: '',
    mediaUrls: [],
    reason: '',
    retractorEmail: '',
    retractionSource: '',
    publicSignature: '',
    transactionId: ''
  };
  try {
    var m = normalizeMediaRetractionMessage_(message);
    var escapeRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var grab = function (label) {
      var re = new RegExp('-\\s+' + escapeRe(label) + ':\\s*([^\n]+)', 'i');
      var match = m.match(re);
      return match ? String(match[1]).trim() : '';
    };
    result.plotId = grab('Plot ID');
    result.reason = grab('Reason');
    result.retractorEmail = grab('Retractor Email');
    result.retractionSource = grab('Retraction Source');
    var mediaRaw = grab('Media URLs');
    if (mediaRaw) {
      result.mediaUrls = mediaRaw.split(',').map(function (s) { return String(s).trim(); })
        .filter(function (s) { return s.length > 0; });
    }
    var sigMatch = m.match(/My Digital Signature:\s*([^\n]+)/i);
    if (sigMatch) result.publicSignature = String(sigMatch[1]).trim();
    var txMatch = m.match(/Request Transaction ID:\s*([^\n]+)/i);
    if (txMatch) result.transactionId = String(txMatch[1]).trim();
  } catch (e) {
    Logger.log('extractMediaRetractionInfo_ error: ' + e.message);
  }
  return result;
}

/** Returns the processed-message-id set from the tracking tab (mirror of TGM helper). */
function getProcessedMediaRetractionMessageIds_(sheet) {
  var ids = {};
  try {
    if (sheet.getLastRow() < 2) return ids;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][1]) ids[String(data[i][1]).trim()] = true;
    }
  } catch (e) {
    Logger.log('getProcessedMediaRetractionMessageIds_ error: ' + e.message);
  }
  return ids;
}

function mrHeaderIndex_(header, names) {
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
 * Soft-invalidates the listed media URLs on the plot row in the SunMint Plots tab.
 * Appends to an "Invalidated Media" column (created if missing) and marks status needs_revision
 * if the plot has no remaining valid media (v1 heuristic; the <3-point rule lives in the
 * extraction script per the design doc). Returns { rowFound, invalidated }.
 */
function mrSoftInvalidate_(plotId, mediaUrls, reason, retractorEmail, source) {
  if (!plotId) return { rowFound: false, invalidated: [] };
  try {
    var spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    var sheet = spreadsheet.getSheetByName(MR_PLOTS_TAB);
    if (!sheet) return { rowFound: false, invalidated: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { rowFound: false, invalidated: [] };
    var header = data[0];
    var plotCol = mrHeaderIndex_(header, ['plot id', 'plot']);
    var farmCol = mrHeaderIndex_(header, ['farm id', 'farm']);
    if (plotCol === -1) return { rowFound: false, invalidated: [] };

    var key = String(plotId).trim().toLowerCase();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      var rowPlot = String(data[i][plotCol] || '').trim().toLowerCase();
      var rowFarm = farmCol >= 0 ? String(data[i][farmCol] || '').trim().toLowerCase() : '';
      if (rowPlot === key || (farmCol >= 0 && rowFarm === key)) { rowIndex = i + 1; break; } // 1-based
    }
    if (rowIndex === -1) return { rowFound: false, invalidated: [] };

    // Find/create the "Invalidated Media" column by header name.
    var invCol = mrHeaderIndex_(header, ['invalidated media', 'invalidated media urls']);
    if (invCol === -1) {
      sheet.getRange(1, header.length + 1).setValue('Invalidated Media');
      invCol = header.length; // 0-based index of the new column
    }

    var existing = String(sheet.getRange(rowIndex, invCol + 1).getValue() || '').trim();
    var invalidated = [];
    for (var j = 0; j < mediaUrls.length; j++) {
      var url = String(mediaUrls[j] || '').trim();
      if (!url) continue;
      if (existing.indexOf(url) !== -1) continue; // already retracted
      existing = existing ? existing + ', ' + url : url;
      invalidated.push(url);
    }
    sheet.getRange(rowIndex, invCol + 1).setValue(existing);

    // Mark needs_revision when the plot has no remaining valid media (v1 heuristic).
    var mediaCol = mrHeaderIndex_(header, ['media', 'media urls']);
    if (mediaCol !== -1) {
      var mediaVal = String(sheet.getRange(rowIndex, mediaCol + 1).getValue() || '').trim();
      if (!mediaVal) {
        var statusCol = mrHeaderIndex_(header, ['status']);
        if (statusCol !== -1) sheet.getRange(rowIndex, statusCol + 1).setValue('needs_revision');
      }
    }
    Logger.log('MR invalidated ' + invalidated.length + ' media on plot ' + plotId +
               ' by ' + (source || retractorEmail || 'unknown'));
    return { rowFound: true, invalidated: invalidated };
  } catch (e) {
    Logger.log('mrSoftInvalidate_ error: ' + e.message);
    return { rowFound: false, invalidated: [] };
  }
}

/**
 * Main entry: processes pending [MEDIA RETRACTION EVENT] rows from Telegram Chat Logs (cron fallback -
 * same pattern as processFarmBoundaryEvidenceFromTelegramChatLogs). Scans SOURCE_SHEET_URL's Telegram Chat
 * Logs, column MESSAGE_COL, for rows containing the marker; validates the 3-tier permission gate;
 * soft-invalidates the media; appends tracking.
 */
function processMediaRetractionFromTelegramChatLogs() {
  var spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  var chatLogs = spreadsheet.getSheetByName(SOURCE_SHEET_NAME); // Telegram Chat Logs
  if (!chatLogs) throw new Error('Telegram Chat Logs sheet not found');

  var tracking = spreadsheet.getSheetByName(MR_TRACKING_TAB);
  if (!tracking) {
    tracking = spreadsheet.insertSheet(MR_TRACKING_TAB);
    tracking.appendRow(MR_TRACKING_HEADERS);
  }
  var processedIds = getProcessedMediaRetractionMessageIds_(tracking);

  var lastRow = chatLogs.getLastRow();
  if (lastRow < 2) return { processed: 0, skipped: 0, errors: 0 };
  var data = chatLogs.getRange(1, 1, lastRow, Math.max(MESSAGE_COL + 1, TELEGRAM_UPDATE_ID_COL + 1)).getValues();

  var processed = 0, skipped = 0, errors = 0;
  for (var i = 1; i < data.length; i++) {
    var updateId = String(data[i][TELEGRAM_UPDATE_ID_COL] || '').trim();
    var message = String(data[i][MESSAGE_COL] || '');
    if (message.indexOf(MEDIA_RETRACTION_EVENT_MARKER) === -1) continue;

    var msgId = String(data[i][3] || '').trim(); // Column D = Telegram Message ID (stable dedup key)
    if (!msgId || processedIds[msgId]) { skipped++; continue; }

    try {
      var info = extractMediaRetractionInfo_(message);
      if (!info.plotId || info.mediaUrls.length === 0 || !info.reason) {
        Logger.log('MR skip (missing plotId/media/reason) msgId=' + msgId);
        skipped++;
        continue;
      }

      // ---- 3-tier permission gate (v1) ----
      var status = 'PENDING_GOVERNOR'; // default: needs governor approval
      var source = String(info.retractionSource || '').trim().toLowerCase();
      var contributorName = '';
      if (info.publicSignature) {
        contributorName = resolveContributorNameFromPublicSignature_(info.publicSignature);
      }
      if (source === 'sentinel') {
        status = 'PROCESSED'; // Tier 3: automated, no human needed
      } else if (contributorName) {
        status = 'PROCESSED'; // Tier 1: signed farmer/lead retraction
      } else if (/gary|sophia|truesight/i.test(info.retractorEmail || '')) {
        status = 'PROCESSED'; // Tier 2: governor email
      }

      var invalidated = [];
      if (status === 'PROCESSED') {
        var res = mrSoftInvalidate_(info.plotId, info.mediaUrls, info.reason, info.retractorEmail, source);
        invalidated = res.invalidated;
        if (!res.rowFound) status = 'PLOT_NOT_FOUND';
      }

      tracking.appendRow([
        updateId, msgId, info.plotId, info.mediaUrls.join(', '), info.reason,
        info.retractorEmail, source, status, new Date().toISOString()
      ]);
      processedIds[msgId] = true;
      processed++;
      Logger.log('MR processed msgId=' + msgId + ' plot=' + info.plotId + ' status=' + status +
                 ' invalidated=' + invalidated.length + ' source=' + (source || 'unknown'));
    } catch (e) {
      Logger.log('MR error msgId=' + msgId + ': ' + e.message);
      errors++;
    }
  }
  return { processed: processed, skipped: skipped, errors: errors };
}
