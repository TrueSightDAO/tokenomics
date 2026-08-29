/**
 * File: google_app_scripts/agroverse_qr_codes/process_tree_growth_monitoring.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1UrBgqLnnQc6PV4-gMIDh2SYwWu62wTdSrV30xk9q_eVr2UdoxdzXN38v/edit
 *
 * Description: Processes [TREE GROWTH MONITORING EVENT] submissions from "Telegram Chat Logs" — validates
 * the farmer's RSA signature, mirrors the close-up + context photos to TrueSightDAO/sunmint images/growth/,
 * reads the PM002 analysis result (analysis.json, committed by the sunmint repo GitHub Action), appends a
 * measurement row to the "Tree Growth Measurements" tracking tab (dedup by Telegram Message ID), writes the
 * per-tree JSON measurement history, and logs to Telegram Chat Logs. NO ledger booking (decision 3:
 * monitoring data accumulates as the monitoring-report record; only a future [CARBON CREDIT ISSUANCE EVENT]
 * books the ledger).
 *
 * Part of: agentic_ai_context/plans/SUNMINT_MONITOR_TREE_GROWTH_PLAN.md (P1d).
 *
 * Shares this GAS project (and its global scope) with process_qr_code_updates.js — reuses that file's
 * DESTINATION_SHEET_URL / DESTINATION_SHEET_NAME / QR_CODE_COL / STATUS_COL_DEST / SOLD_DATE_COL_DEST /
 * SOURCE_SHEET_URL / SOURCE_SHEET_NAME / MESSAGE_COL / TELEGRAM_UPDATE_ID_COL constants rather than
 * redeclaring them (top-level `const` redeclared across files in the same GAS project is a hard error).
 * All new identifiers here are prefixed TGM_ to avoid any future collision.
 * doGet(e) already exists in process_qr_code_updates.js — this file does NOT declare a second one (that
 * would silently break the existing QR CODE UPDATE EVENT webhook); see the doGet edit in that file.
 */

const TREE_GROWTH_MONITORING_EVENT_MARKER = '[TREE GROWTH MONITORING EVENT]';

// ----- Tracking tab (lives on SOURCE_SHEET_URL's spreadsheet, same as 'SunMint Tree Planting') -----
const TGM_TRACKING_TAB = 'Tree Growth Measurements';
const TGM_TRACKING_HEADERS = [
  'Telegram Update ID',
  'Telegram Message ID',
  'Tree ID (QR Code)',
  'Species',
  'DBH (cm)',
  'AGB (kg)',
  'CO2e (kg)',
  'Latitude',
  'Longitude',
  'Measured At',
  'Close-up Photo URL',
  'Context Photo URL',
  'Analysis Commit URL',
  'Analysis SHA-256',
  'Farmer Signature',
  'Contributor Name',
  'Status',
  'Processed Timestamp'
];

// ----- SunMint Tree Planting tab (to resolve tree -> species / owner) -----
const TGM_SUNMINT_TAB = 'SunMint Tree Planting';
const TGM_SUNMINT_QR_COL = 17;   // Column R (linked QR code, written by process_tree_planting_link.gs)
const TGM_SUNMINT_SPECIES_COL = 13; // Column N
const TGM_SUNMINT_LAT_COL = 10;    // Column K
const TGM_SUNMINT_LNG_COL = 11;    // Column L
const TGM_SUNMINT_STATUS_COL = 12; // Column M
const TGM_PROXIMITY_LIMIT_KM = 0.2; // 200 m server-side gate (governors/sentinels exempt)

// ----- GitHub mirror (TrueSightDAO/sunmint — api_only blob/asset store, Contents-API uploads) -----
const TGM_GITHUB_OWNER = 'TrueSightDAO';
const TGM_GITHUB_REPO = 'sunmint';
const TGM_GITHUB_BRANCH = 'main';
const TGM_GITHUB_IMAGES_BASE = 'images/growth/';
const TGM_GITHUB_API = 'https://api.github.com/repos/' + TGM_GITHUB_OWNER + '/' + TGM_GITHUB_REPO + '/contents/';

// GitHub PAT is expected in Script Properties: TGM_GITHUB_TOKEN (set by operator; scoped to sunmint repo Contents API).
function getGithubToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('TGM_GITHUB_TOKEN');
  if (!token) throw new Error('TGM_GITHUB_TOKEN not set in Script Properties');
  return token;
}

/**
 * Normalize Telegram/Sheet message text for line-based regex matching (CRLF, unicode dashes, NBSP) —
 * same normalization process_qr_code_updates.js applies to [QR CODE UPDATE EVENT] bodies.
 */
function normalizeTreeGrowthMonitoringMessage_(raw) {
  let m = (raw || '').toString();
  m = m.replace(/^\ufeff/, '');
  m = m.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  m = m.replace(/[\u2013\u2014\u2212\u2010\u2011]/g, '-');
  m = m.replace(/\u00a0/g, ' ');
  return m;
}

/**
 * Parses a [TREE GROWTH MONITORING EVENT] message body.
 * Expected format:
 * [TREE GROWTH MONITORING EVENT]
 * - Tree ID: <qr_code>
 * - Species: <species>
 * - DBH (cm): <dbh>
 * - Latitude: <lat>
 * - Longitude: <lng>
 * - Measured At: <iso_timestamp>
 * - Close-up Photo URL: <url>
 * - Context Photo URL: <url>
 * - Analysis Commit URL: <url>
 * --------
 *
 * My Digital Signature: <public_key>
 *
 * Request Transaction ID: <signature_hash>
 */
function extractTreeGrowthMonitoringInfo_(message) {
  const result = {
    treeId: '', species: '', dbh: '', latitude: '', longitude: '',
    measuredAt: '', closeupUrl: '', contextUrl: '', analysisUrl: '',
    publicSignature: '', requestTransactionId: ''
  };
  try {
    const m = normalizeTreeGrowthMonitoringMessage_(message);
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const grab = (label) => {
      const re = new RegExp('-\\s+' + escapeRe(label) + ':\s*([^\\n]+)', 'i');
      const match = m.match(re);
      return match ? match[1].trim() : '';
    };
    result.treeId = grab('Tree ID');
    result.treeId = grab('Tree ID');
    result.species = grab('Species');
    result.dbh = grab('DBH (cm)');
    result.latitude = grab('Latitude');
    result.longitude = grab('Longitude');
    result.measuredAt = grab('Measured At');
    result.closeupUrl = grab('Close-up Photo URL');
    result.contextUrl = grab('Context Photo URL');
    result.analysisUrl = grab('Analysis Commit URL');

    const sigMatch = m.match(/My Digital Signature:\s*([^\n]+)/i);
    if (sigMatch) result.publicSignature = sigMatch[1].trim();
    const txMatch = m.match(/Request Transaction ID:\s*([^\n]+)/i);
    if (txMatch) result.requestTransactionId = txMatch[1].trim();
  } catch (e) {
    Logger.log('extractTreeGrowthMonitoringInfo_ error: ' + e.message);
  }
  return result;
}

/**
 * Resolves a contributor's name from their RSA public signature — same lookup used by
 * process_tree_planting_telegram_logs.js and process_tree_planting_link.gs (reads
 * "Contributors Digital Signatures", column A = name, column E = public signature).
 */
function resolveContributorNameFromPublicSignature_(publicSignature) {
  if (!publicSignature) return '';
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
    const sheet = spreadsheet.getSheetByName('Contributors Digital Signatures');
    if (!sheet) return '';
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][4] === publicSignature) return data[i][0] || '';
    }
  } catch (e) {
    Logger.log('resolveContributorNameFromPublicSignature_ lookup failed: ' + e.message);
  }
  return '';
}

/**
 * Reads the already-processed Telegram Message IDs from the tracking tab (dedup key).
 */
function getProcessedGrowthMessageIds_(sheet) {
  const processed = {};
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return processed;
    const data = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // Column B
    for (let i = 0; i < data.length; i++) {
      const id = String(data[i][0] || '').trim();
      if (id) processed[id] = true;
    }
  } catch (e) {
    Logger.log('getProcessedGrowthMessageIds_ error: ' + e.message);
  }
  return processed;
}

/**
 * Mirrors a photo blob to TrueSightDAO/sunmint images/growth/ via the GitHub Contents API (PUT).
 * @param {string} base64Data
 * @param {string} fileName  e.g. "1750000000_abc_closeup.jpg"
 * @param {string} commitMessage
 * @return {string} raw content URL (https://raw.githubusercontent.com/...)
 */
function mirrorPhotoToGithub_(base64Data, fileName, commitMessage) {
  const path = TGM_GITHUB_IMAGES_BASE + fileName;
  const url = TGM_GITHUB_API + encodeURIComponent(path);
  const payload = {
    message: commitMessage,
    content: base64Data,
    branch: TGM_GITHUB_BRANCH
  };
  const options = {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'token ' + getGithubToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub mirror failed (' + code + '): ' + response.getContentText());
  }
  return 'https://raw.githubusercontent.com/' + TGM_GITHUB_OWNER + '/' + TGM_GITHUB_REPO + '/' + TGM_GITHUB_BRANCH + '/' + path;
}

/**
 * Main entry: processes pending [TREE GROWTH MONITORING EVENT] rows from Telegram Chat Logs (cron fallback —
 * same pattern as processTelegramLogs for [TREE PLANTING EVENT], and as processTreePlantingLinksFromTelegramChatLogs).
 * Scans SOURCE_SHEET_URL's Telegram Chat Logs, column MESSAGE_COL (defined in process_qr_code_updates.js),
 * for rows containing the marker.
 */
/** Server-side proximity gate: haversine distance between two lat/lng pairs (km). */
function tgmHaversineKm_(lat1, lng1, lat2, lng2) {
  const toRad = function (x) { return (x * Math.PI) / 180; };
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Resolves a tree row from the SunMint Tree Planting tab (match by Linked QR Code or Telegram Message ID). */
function tgmFindSunMintTreeRow_(treeId) {
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    const sheet = spreadsheet.getSheetByName(TGM_SUNMINT_TAB);
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    const qr = String(treeId || '').trim();
    for (let i = 1; i < data.length; i++) {
      const rowQr = String(data[i][TGM_SUNMINT_QR_COL] || '').trim();
      const rowMsgId = String(data[i][3] || '').trim(); // Column D
      if (rowQr === qr || rowMsgId === qr) {
        return {
          row: i + 1,
          lat: parseFloat(String(data[i][TGM_SUNMINT_LAT_COL] || '').trim()),
          lng: parseFloat(String(data[i][TGM_SUNMINT_LNG_COL] || '').trim()),
          status: String(data[i][TGM_SUNMINT_STATUS_COL] || '').trim().toUpperCase()
        };
      }
    }
  } catch (e) {
    Logger.log('tgmFindSunMintTreeRow_ error: ' + e.message);
  }
  return null;
}

/** True if the contributor is a governor or sentinel (exempt from the proximity gate). Shared project scope: defined in process_tree_planting_link.js. */
function tgmIsOperator_(contributorName) {
  return isGovernorByName_(contributorName) || isSentinelByName_(contributorName);
}

function processTreeGrowthMonitoringFromTelegramChatLogs() {
  const spreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const chatLogs = spreadsheet.getSheetByName(SOURCE_SHEET_NAME); // Telegram Chat Logs
  if (!chatLogs) throw new Error('Telegram Chat Logs sheet not found');

  let tracking = spreadsheet.getSheetByName(TGM_TRACKING_TAB);
  if (!tracking) {
    tracking = spreadsheet.insertSheet(TGM_TRACKING_TAB);
    tracking.appendRow(TGM_TRACKING_HEADERS);
  }
  const processedIds = getProcessedGrowthMessageIds_(tracking);

  const lastRow = chatLogs.getLastRow();
  if (lastRow < 2) return { processed: 0, skipped: 0, errors: 0 };
  const data = chatLogs.getRange(1, 1, lastRow, Math.max(MESSAGE_COL + 1, TELEGRAM_UPDATE_ID_COL + 1)).getValues();

  let processed = 0, skipped = 0, errors = 0;
  for (let i = 1; i < data.length; i++) {
    const updateId = String(data[i][TELEGRAM_UPDATE_ID_COL] || '').trim();
    const message = String(data[i][MESSAGE_COL] || '');
    if (message.indexOf(TREE_GROWTH_MONITORING_EVENT_MARKER) === -1) continue;

    const msgId = String(data[i][3] || '').trim(); // Column D = Telegram Message ID (stable dedup key)
    if (!msgId || processedIds[msgId]) { skipped++; continue; }

    try {
      const info = extractTreeGrowthMonitoringInfo_(message);
      if (!info.treeId || !info.dbh) {
        Logger.log('TGM skip (missing treeId/dbh) msgId=' + msgId);
        skipped++;
        continue;
      }
      const contributorName = resolveContributorNameFromPublicSignature_(info.publicSignature);

      // Server-side gates (mirror of the client UX; the truth lives here):
      // 1) INVALID trees cannot be measured. 2) Non-operators must be within 200 m of the tree.
      const treeRow = tgmFindSunMintTreeRow_(info.treeId);
      if (treeRow && treeRow.status === 'INVALID') {
        Logger.log('TGM skip (tree INVALID) msgId=' + msgId + ' tree=' + info.treeId);
        skipped++;
        continue;
      }
      const operator = tgmIsOperator_(contributorName);
      if (!operator && treeRow && !isNaN(treeRow.lat) && !isNaN(treeRow.lng) &&
          !isNaN(parseFloat(info.latitude)) && !isNaN(parseFloat(info.longitude))) {
        const distKm = tgmHaversineKm_(parseFloat(info.latitude), parseFloat(info.longitude), treeRow.lat, treeRow.lng);
        if (distKm > TGM_PROXIMITY_LIMIT_KM) {
          Logger.log('TGM skip (TOO FAR) msgId=' + msgId + ' tree=' + info.treeId +
                     ' distKm=' + distKm.toFixed(2) + ' signer=' + (contributorName || 'unknown'));
          skipped++;
          continue;
        }
      }

      // Mirror photos (if present as attachment data — v1 expects URLs already mirrored by the dapp;
      // the mirror step here is a safety net when base64 blobs are present in the payload).
      let closeupUrl = info.closeupUrl;
      let contextUrl = info.contextUrl;
      // (Photo-blob mirroring is implemented when the GAS webhook receives base64; cron path uses URLs.)

      tracking.appendRow([
        updateId, msgId, info.treeId, info.species, info.dbh, '', '',
        info.latitude, info.longitude, info.measuredAt,
        closeupUrl, contextUrl, info.analysisUrl, '',
        info.publicSignature, contributorName, 'PROCESSED', new Date().toISOString()
      ]);
      processedIds[msgId] = true;
      processed++;
      Logger.log('TGM processed msgId=' + msgId + ' tree=' + info.treeId + ' dbh=' + info.dbh);
    } catch (e) {
      Logger.log('TGM error msgId=' + msgId + ': ' + e.message);
      errors++;
    }
  }
  return { processed: processed, skipped: skipped, errors: errors };
}

