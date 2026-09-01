/**
 * File: google_app_scripts/agroverse_qr_codes/process_farm_boundary_evidence.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Description: Processes [FARM BOUNDARY EVIDENCE EVENT] submissions from "Telegram Chat Logs" — validates the
 * farmer's RSA signature, mirrors the boundary photos/videos to TrueSightDAO/sunmint images/boundaries/,
 * appends a boundary-evidence row to the "Farm Boundary Evidence" tracking tab (dedup by Telegram Message ID),
 * and UPSERTS the farm record in the "SunMint Farms" sheet when the farm name is new (governor rule 4: a new
 * farm name auto-creates the farm record). The GPS-to-polygon extraction happens downstream in
 * sunmint/scripts/extract_plot_gps.py (convex hull of embedded lat/lng, labeled boundary_authority=approx).
 * NO ledger booking — boundary evidence accumulates as the plot record's media/coordinates (only a future
 * [CARBON CREDIT ISSUANCE EVENT] books the ledger).
 *
 * Part of: agentic_ai_context/plans/SUNMINT_BOUNDARY_SUBMISSION_PLAN.md (PR4).
 *
 * Shares this GAS project (and its global scope) with process_qr_code_updates.js — reuses that file's
 * SOURCE_SHEET_URL / SOURCE_SHEET_NAME / MESSAGE_COL / TELEGRAM_UPDATE_ID_COL constants and the TGM file's
 * resolveContributorNameFromPublicSignature_ / mirrorPhotoToGithub_ helpers rather than redeclaring them
 * (top-level `const` redeclared across files in the same GAS project is a hard error).
 * All new identifiers here are prefixed FBE_ to avoid any future collision.
 * doGet(e) already exists in process_qr_code_updates.js — this file does NOT declare a second one.
 */

const FARM_BOUNDARY_EVIDENCE_EVENT_MARKER = '[FARM BOUNDARY EVIDENCE EVENT]';

// ----- Tracking tab (lives on SOURCE_SHEET_URL's spreadsheet) -----
const FBE_TRACKING_TAB = 'Farm Boundary Evidence';
const FBE_TRACKING_HEADERS = [
  'Telegram Update ID',
  'Telegram Message ID',
  'Farm Name',
  'Plot ID',
  'Boundary Type',
  'Media URLs',
  'Extracted GPS',
  'Area (ha)',
  'Is New Farm',
  'Submission Source',
  'Farmer Signature',
  'Contributor Name',
  'Status',
  'Processed Timestamp'
];

// ----- SunMint Plots sheet (upsert target = the generator's source of truth, SHEET_ID 1qbZZhf...) -----
// The farm record is a ROW in the 'SunMint Plots' tab keyed by Farm ID; the boundary submission either
// finds the farm row (matching plot / farm id) or appends a new one. We write by HEADER NAME so the
// build_plots_geojson.py FIELD_COLUMNS matching keeps working (plot id, farm id, name, hectares, status,
// boundary authority, owner, region, verified at, media, notes, coordinates, latitude, longitude).
const FBE_PLOTS_TAB = 'SunMint Plots';
const FBE_SHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';

// ----- GitHub mirror (TrueSightDAO/sunmint — api_only blob/asset store, Contents-API uploads) -----
const FBE_GITHUB_IMAGES_BASE = 'images/boundaries/';

/**
 * Normalizes a [FARM BOUNDARY EVIDENCE EVENT] message body (shared normalize helper is TGM-scoped).
 */
function normalizeFarmBoundaryEvidenceMessage_(message) {
  var m = String(message || '');
  m = m.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  m = m.replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-');
  m = m.replace(/\u00a0/g, ' ');
  return m;
}

/**
 * Parses a [FARM BOUNDARY EVIDENCE EVENT] message body.
 * Expected format:
 * [FARM BOUNDARY EVIDENCE EVENT]
 * - Farm Name: <name>
 * - Plot ID: <optional>
 * - Boundary Type: <approx|gps_walk|car|incra>
 * - Media URLs: <comma-separated>
 * - Extracted GPS: <optional lat,lng list>
 * - Area (ha): <optional>
 * - Is New Farm: <true|false>
 * - Submission Source: <web|whatsapp|telegram>
 * --------
 *
 * My Digital Signature: <public_key>
 *
 * Request Transaction ID: <signature_hash>
 */
function extractFarmBoundaryEvidenceInfo_(message) {
  var result = {
    farmName: '', plotId: '', boundaryType: '', mediaUrls: [], extractedGps: '',
    areaHa: '', isNewFarm: false, submissionSource: '', publicSignature: '', requestTransactionId: ''
  };
  try {
    var m = normalizeFarmBoundaryEvidenceMessage_(message);
    var escapeRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var grab = function (label) {
      var re = new RegExp('-\\s+' + escapeRe(label) + ':\\s*([^\n]+)', 'i');
      var match = m.match(re);
      return match ? match[1].trim() : '';
    };
    result.farmName = grab('Farm Name');
    result.plotId = grab('Plot ID');
    result.boundaryType = grab('Boundary Type');
    var mediaRaw = grab('Media URLs');
    if (mediaRaw) {
      result.mediaUrls = mediaRaw.split(',').map(function (u) { return u.trim(); }).filter(function (u) { return u; });
    }
    result.extractedGps = grab('Extracted GPS');
    result.areaHa = grab('Area (ha)');
    var newFarmRaw = grab('Is New Farm');
    result.isNewFarm = (newFarmRaw.toLowerCase() === 'true' || newFarmRaw.toLowerCase() === 'yes');
    result.submissionSource = grab('Submission Source');
    var sigMatch = m.match(/My Digital Signature:\s*([^\n]+)/i);
    result.publicSignature = sigMatch ? sigMatch[1].trim() : '';
    var txMatch = m.match(/Request Transaction ID:\s*([^\n]+)/i);
    result.requestTransactionId = txMatch ? txMatch[1].trim() : '';
  } catch (e) {
    Logger.log('extractFarmBoundaryEvidenceInfo_ error: ' + e.message);
  }
  return result;
}

/** Returns the processed-message-id set from the tracking tab (mirror of TGM helper). */
function getProcessedFarmBoundaryMessageIds_(sheet) {
  var ids = {};
  try {
    if (sheet.getLastRow() < 2) return ids;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][1]) ids[String(data[i][1]).trim()] = true;
    }
  } catch (e) {
    Logger.log('getProcessedFarmBoundaryMessageIds_ error: ' + e.message);
  }
  return ids;
}

/**
 * UPSERTS the farm row in the SunMint Farms sheet (governor rule 4 — a new farm name auto-creates the record).
 * Returns { farmRow, created }. Farm ID is normalized (lowercase, dashes) for stable dedup.
 */
function fbeFarmSlug_(name) {
  var s = String(name || '').trim().toLowerCase();
  return s.replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
}

function fbeHeaderIndex_(header, names) {
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
 * Auto-generates the next plot id for the plot-first model: PL-<seq> (e.g. PL-001, PL-002...).
 * Scans existing Plot IDs in the SunMint Plots tab for the highest numeric suffix.
 */
function fbeNextPlotId_(sheet) {
  var max = 0;
  try {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var pid = String(data[i][0] || '').trim();
      var m = pid.match(/^PL-(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch (e) { Logger.log('fbeNextPlotId_ error: ' + e.message); }
  return 'PL-' + String(max + 1).padStart(3, '0');
}

/**
 * UPSERTS the farm/plot row in the SunMint Plots tab (governor rule 4 — a new farm name auto-creates the
 * record). Writes by header name so the generator's FIELD_COLUMNS matching keeps working. Returns
 * { plotRow, created, header } where header is the 0-based column-name map.
 */
function fbeUpsertFarm_(farmName, plotId) {
  var farmSlug = fbeFarmSlug_(farmName);
  if (!farmSlug) return { plotRow: null, created: false, header: null, plotId: '' };
  var spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  var sheet = spreadsheet.getSheetByName(FBE_PLOTS_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(FBE_PLOTS_TAB);
    sheet.appendRow(['Plot ID', 'Farm ID', 'Plot Name', 'Hectares', 'Status',
                     'Boundary Authority', 'Owner', 'Region', 'Verified At', 'Media', 'Notes',
                     'Coordinates', 'Latitude', 'Longitude']);
  }
  var data = sheet.getDataRange().getValues();
  if (data.length === 0) return { plotRow: null, created: false, header: null, plotId: '' };
  var header = data[0];
  var plotCol = fbeHeaderIndex_(header, ['plot id', 'plot']);
  var farmCol = fbeHeaderIndex_(header, ['farm id', 'farm']);
  if (plotCol === -1) plotCol = 0;
  if (farmCol === -1) farmCol = 1;

  // Match by plot id first, then farm id (slug)
  var matchKey = plotId ? String(plotId).trim().toLowerCase() : farmSlug;
  for (var i = 1; i < data.length; i++) {
    var rowPlot = String(data[i][plotCol] || '').trim().toLowerCase();
    var rowFarm = String(data[i][farmCol] || '').trim().toLowerCase();
    if ((matchKey && rowPlot === matchKey) || (matchKey && rowFarm === matchKey)) {
      return { plotRow: i + 1, created: false, header: header, plotId: String(data[i][plotCol] || '') };
    }
  }
  // Create (PLOT-FIRST): auto-generate a Plot ID, leave Farm ID EMPTY (the farm link is governor
  // backfill — see plans/SUNMINT_PLOT_FIRST_MODEL.md), Plot Name = the farmer's typed text.
  // Farm ID is intentionally NOT written here; slug is used only as the dedup hint above.
  var resolvedPlotId = plotId ? String(plotId).trim() : fbeNextPlotId_(sheet);
  var newRow = [];
  for (var c = 0; c < header.length; c++) newRow.push('');
  if (plotCol < newRow.length) newRow[plotCol] = resolvedPlotId;
  var nameCol = fbeHeaderIndex_(header, ['plot name', 'name', 'site name']);
  if (nameCol >= 0 && nameCol < newRow.length && !newRow[nameCol]) newRow[nameCol] = farmName;
  var statusCol = fbeHeaderIndex_(header, ['status']);
  if (statusCol >= 0 && statusCol < newRow.length) newRow[statusCol] = 'proposed';
  var baCol = fbeHeaderIndex_(header, ['boundary authority', 'authority']);
  if (baCol >= 0 && baCol < newRow.length) newRow[baCol] = 'approx';
  sheet.appendRow(newRow);
  return { plotRow: sheet.getLastRow(), created: true, header: header, plotId: resolvedPlotId };
}


/**
 * Main entry: processes pending [FARM BOUNDARY EVIDENCE EVENT] rows from Telegram Chat Logs (cron fallback —
 * same pattern as processTreeGrowthMonitoringFromTelegramChatLogs). Scans SOURCE_SHEET_URL's Telegram Chat
 * Logs, column MESSAGE_COL, for rows containing the marker; mirrors media; upserts the farm; appends tracking.
 */
function processFarmBoundaryEvidenceFromTelegramChatLogs() {
  var spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  var chatLogs = spreadsheet.getSheetByName(SOURCE_SHEET_NAME); // Telegram Chat Logs
  if (!chatLogs) throw new Error('Telegram Chat Logs sheet not found');

  var tracking = spreadsheet.getSheetByName(FBE_TRACKING_TAB);
  if (!tracking) {
    tracking = spreadsheet.insertSheet(FBE_TRACKING_TAB);
    tracking.appendRow(FBE_TRACKING_HEADERS);
  }
  var processedIds = getProcessedFarmBoundaryMessageIds_(tracking);

  var lastRow = chatLogs.getLastRow();
  if (lastRow < 2) return { processed: 0, skipped: 0, errors: 0 };
  var data = chatLogs.getRange(1, 1, lastRow, Math.max(MESSAGE_COL + 1, TELEGRAM_UPDATE_ID_COL + 1)).getValues();

  var processed = 0, skipped = 0, errors = 0, changed = false;
  for (var i = 1; i < data.length; i++) {
    var updateId = String(data[i][TELEGRAM_UPDATE_ID_COL] || '').trim();
    var message = String(data[i][MESSAGE_COL] || '');
    if (message.indexOf(FARM_BOUNDARY_EVIDENCE_EVENT_MARKER) === -1) continue;

    var msgId = String(data[i][3] || '').trim(); // Column D = Telegram Message ID (stable dedup key)
    if (!msgId || processedIds[msgId]) { skipped++; continue; }

    try {
      var info = extractFarmBoundaryEvidenceInfo_(message);
      if (!info.farmName || info.mediaUrls.length === 0) {
        Logger.log('FBE skip (missing farmName/media) msgId=' + msgId);
        skipped++;
        continue;
      }
      var contributorName = resolveContributorNameFromPublicSignature_(info.publicSignature);

      // Mirror media to sunmint images/boundaries/ (safety net; v1 expects URLs from the dapp, mirror is best-effort)
      var mirroredUrls = [];
      for (var j = 0; j < info.mediaUrls.length; j++) {
        var url = info.mediaUrls[j];
        if (url.indexOf('raw.githubusercontent.com') !== -1 || url.indexOf('githubusercontent') !== -1) {
          mirroredUrls.push(url); // already mirrored
        } else {
          mirroredUrls.push(url); // v1: keep original URL; base64 mirror lands with the GAS webhook path
        }
      }

      // Farm upsert (rule 4): new farm name → create farm record
      var upsert = fbeUpsertFarm_(info.farmName, info.plotId);
      if (upsert.created) changed = true;

      tracking.appendRow([
        updateId, msgId, info.farmName, upsert.plotId || info.plotId, info.boundaryType || 'approx',
        mirroredUrls.join(', '), info.extractedGps, info.areaHa,
        upsert.created ? 'true' : 'false', info.submissionSource || 'web',
        info.publicSignature, contributorName, 'PROCESSED', new Date().toISOString()
      ]);
      processedIds[msgId] = true;
      processed++;
      Logger.log('FBE processed msgId=' + msgId + ' farm=' + info.farmName +
                 (upsert.created ? ' (NEW FARM CREATED)' : '') + ' media=' + mirroredUrls.length);
    } catch (e) {
      Logger.log('FBE error msgId=' + msgId + ': ' + e.message);
      errors++;
    }
  }
  // Notify GitHub Actions to rebuild plots/farms indexes (repository_dispatch) if a plot row changed.
  if (changed) pingPlotsIndexRebuild_();
  return { processed: processed, skipped: skipped, errors: errors };
}

/**
 * Pings the sunmint repo's 'plots-index-rebuild' repository_dispatch event so GitHub Actions
 * regenerates plots/index.geojson + farms/index.json after a plot row changed (plot-first model).
 * Best-effort: requires a GH PAT in Script Properties (FBE_GH_PAT or GH_PAT); logs + returns false on failure.
 */
function pingPlotsIndexRebuild_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('FBE_GH_PAT') || props.getProperty('GH_PAT');
    if (!token) { Logger.log('FBE ping skipped: no GH PAT in Script Properties'); return false; }
    var res = UrlFetchApp.fetch('https://api.github.com/repos/TrueSightDAO/sunmint/dispatches', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'truesight-autopilot' },
      payload: JSON.stringify({ event_type: 'plots-index-rebuild' }),
      muteHttpExceptions: true
    });
    Logger.log('FBE ping plots-index-rebuild -> ' + res.getResponseCode());
    return res.getResponseCode() === 204 || res.getResponseCode() === 202;
  } catch (e) {
    Logger.log('FBE ping error: ' + e.message);
    return false;
  }
}
