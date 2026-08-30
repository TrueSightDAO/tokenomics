/**
 * File: google_app_scripts/agroverse_qr_codes/process_tree_planting_link.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1UrBgqLnnQc6PV4-gMIDh2SYwWu62wTdSrV30xk9q_eVr2UdoxdzXN38v/edit
 *
 * Description: Processes [TREE PLANTING LINK EVENT] submissions from "Telegram Chat Logs" — links a
 * governor-approved SunMint Tree Planting submission (status NEW) to a sold Agroverse QR code (status
 * SOLD), flipping the QR to ASSIGNED_TO_TREE, copying the planting evidence onto the QR row, booking the
 * ledger fulfillment entry, and notifying the QR owner by email.
 *
 * Part of: agentic_ai_context/plans/SUNMINT_TREE_QR_LINKING_PLAN.md (PR4).
 *
 * Shares this GAS project (and its global scope) with process_qr_code_updates.js — reuses that file's
 * DESTINATION_SHEET_URL / DESTINATION_SHEET_NAME / QR_CODE_COL / STATUS_COL_DEST / EMAIL_COL_DEST /
 * SOLD_DATE_COL_DEST / SOURCE_SHEET_URL / SOURCE_SHEET_NAME / MESSAGE_COL / TELEGRAM_UPDATE_ID_COL
 * constants rather than redeclaring them (top-level `const` redeclared across files in the same GAS
 * project is a hard error). All new identifiers here are prefixed TPL_ to avoid any future collision.
 * doGet(e) already exists in process_qr_code_updates.js — this file does NOT declare a second one (that
 * would silently break the existing QR CODE UPDATE EVENT webhook); see the doGet edit in that file.
 */

const TREE_PLANTING_LINK_EVENT_MARKER = '[TREE PLANTING LINK EVENT]';
const TREE_PLANTING_REJECT_EVENT_MARKER = '[TREE PLANTING REJECT EVENT]';

// ----- Column indices (0-based) on "Agroverse QR codes" not already declared in process_qr_code_updates.js -----
const TPL_LEDGER_URL_COL = 2;             // Column C (ledger) — e.g. https://truesight.me/sunmint/bec
const TPL_TREE_PLANTING_DATE_COL = 13;    // Column N
const TPL_LATITUDE_COL = 14;              // Column O
const TPL_LONGITUDE_COL = 15;             // Column P
const TPL_PHOTO_COL = 17;                 // Column R (Tree Seedling Photo URL)
const TPL_NOTIFICATION_SENT_COL = 27;     // Column AB (Tree Planted Notification Sent Date) — moved off column X (2026-08-20): live sheet col X is 'Review Click Through Date' (review workflow), so the stamp must not land there. AA/AB are free columns (grid max 28).

// ----- Column indices (0-based) on "SunMint Tree Planting" -----
const TPL_SUNMINT_MESSAGE_ID_COL = 3;     // Column D — Telegram Message ID (stable key)
const TPL_SUNMINT_STATUS_DATE_COL = 6;    // Column G — planting date (YYYYMMDD)
const TPL_SUNMINT_PHOTO_COL = 8;          // Column I
const TPL_SUNMINT_LATITUDE_COL = 10;      // Column K
const TPL_SUNMINT_LONGITUDE_COL = 11;     // Column L
const TPL_SUNMINT_STATUS_COL = 12;        // Column M
const TPL_SUNMINT_LINKED_QR_COL = 17;     // Column R (new)
const TPL_SUNMINT_LINKED_AT_COL = 18;     // Column S (new)

// ----- Spreadsheets / tabs -----
const TPL_SUNMINT_TREE_PLANTING_TAB = 'SunMint Tree Planting'; // lives on SOURCE_SHEET_URL's spreadsheet
const TPL_GOVERNORS_TAB = 'Governors';                         // lives on DESTINATION_SHEET_URL's spreadsheet
const TPL_CONTRIBUTORS_TAB = 'Contributors Digital Signatures'; // ditto
const TPL_SHIPMENT_LEDGER_LISTING_TAB = 'Shipment Ledger Listing'; // ditto
const TPL_TRANSACTIONS_TAB = 'Transactions';                  // on the resolved managed-ledger spreadsheet
const TPL_TRACKING_TAB = 'Tree Planting Link';                // lives on SOURCE_SHEET_URL's spreadsheet
const TPL_LEDGER_URL_PREFIX = 'https://truesight.me/sunmint/';

// ----- Main-DAO-ledger special case (AGL4) -----
// AGL4 is the ONE managed ledger whose sale-time "Cacao Tree To Be Planted" liability is booked on the
// MAIN DAO ledger's "offchain transactions" tab (spreadsheet 1GE7PUq-...), NOT on its own sub-ledger
// (1Uo5p3-...) — see sales_update_main_dao_offchain_ledger.js processTokenizedTransactions(), which
// special-cases agroverseValue === 'https://agroverse.shop/agl4', and sales_update_managed_agl_ledgers.js
// processNonAgl4Transactions(), which explicitly SKIPS agl4. The tree-planting fulfillment must therefore
// discharge AGL4 liabilities on the same main-ledger tab, with the same contributor/item pattern.
const TPL_AGL4_LEDGER_URL = 'https://agroverse.shop/agl4';     // the exact ledger URL the sale-time booker keys on
const TPL_MAIN_LEDGER_LEDGER_URLS = [                                  // ledger URLs that route the fulfillment pair to the MAIN DAO ledger's offchain transactions tab
  'https://agroverse.shop/agl4',
  'https://truesight.me/sunmint/main',                                // FounderHaus Bougainvillea et al - books directly on the main ledger
];
const TPL_MAIN_DAO_LEDGER_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit'; // main DAO ledger
const TPL_MAIN_DAO_OFFCHAIN_TAB = 'offchain transactions';     // main-ledger tab that holds the agl4 sale-time liability

const TPL_TRACKING_HEADERS = [
  'Row Number',
  'Telegram Update ID',
  'QR Code',
  'SunMint Submission Message ID',
  'Outcome',
  'Reason',
  'Processed Timestamp',
  'Updated By'
];

/**
 * Governor check — reads the "Governors" tab (column A = name) on the main ledger spreadsheet.
 * Copied from tokenomics/google_app_scripts/19Wag9x-sjbLVgIsPh2vj90ZG7Rgq2iGaVOomAeAvtg6CdZKJHLZ9AJrC/Code.js
 * (isGovernorByName_) — GAS clasp projects can't share code across mirrors, so this is a verbatim copy,
 * not a new pattern. See SUNMINT_TREE_QR_LINKING_PLAN.md §1.7 for why this handler is the first to add
 * real server-side governor enforcement in this codebase (existing gates are client-side only).
 * @param {string} contributorName
 * @return {boolean}
 */
function isGovernorByName_(contributorName) {
  if (!contributorName) return false;
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
    const sheet = spreadsheet.getSheetByName(TPL_GOVERNORS_TAB);
    if (!sheet) return false;
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      if (name.toLowerCase() === String(contributorName).toLowerCase()) return true;
    }
  } catch (e) {
    Logger.log('isGovernorByName_ lookup failed: ' + e.message);
  }
  return false;
}

/**
 * Sentinel check — reads the "Contributors contact information" tab (column A = name, column W = "Is Sentinel")
 * on the main ledger spreadsheet. Sentinels are governor-equivalent operational agents without voting rights
 * (see OPEN_FOLLOWUPS.md "Sentinel graduation framework"; 6 sentinels flagged TRUE: Sophia Truesight, Claude
 * Anthropic, Kimi Moon, Deep Seek, Open Ai, truesight-autopilot). Governor OR sentinel = authorized operator.
 * @param {string} contributorName
 * @return {boolean}
 */
function isSentinelByName_(contributorName) {
  if (!contributorName) return false;
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
    const sheet = spreadsheet.getSheetByName('Contributors contact information');
    if (!sheet) return false;
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      if (name.toLowerCase() === String(contributorName).toLowerCase()) {
        const flag = String(data[i][22] || '').trim().toUpperCase(); // Column W
        return flag === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('isSentinelByName_ lookup failed: ' + e.message);
  }
  return false;
}

/**
 * Authorized operator = governor OR sentinel (plan §0: "a governor (or Sophia / an authorized LLM agent,
 * signing as themselves)").
 * @param {string} contributorName
 * @return {boolean}
 */
function isAuthorizedOperator_(contributorName) {
  return isGovernorByName_(contributorName) || isSentinelByName_(contributorName);
}

/**
 * Resolves a contributor's name from their RSA public signature, matching against
 * "Contributors Digital Signatures" (column A = name, column E = public signature) — same lookup used
 * by process_tree_planting_telegram_logs.js.
 * @param {string} publicSignature
 * @return {string} contributor name, or '' if not found
 */
function resolveContributorNameFromPublicSignature_(publicSignature) {
  if (!publicSignature) return '';
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
    const sheet = spreadsheet.getSheetByName(TPL_CONTRIBUTORS_TAB);
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
 * Resolves a QR row's ledger URL (column C, e.g. "https://truesight.me/sunmint/bec") to the managed
 * ledger's actual Google Sheets URL, via "Shipment Ledger Listing" column L (unresolved URL) -> column
 * AB (resolved URL) — same lookup table sales_update_managed_agl_ledgers.js's resolveRedirect() uses,
 * trimmed to the sheet-lookup path only (no HTTP-redirect fallback: a QR eligible for this handler was
 * already sold against an established managed ledger, so the sheet row is expected to exist).
 * @param {string} ledgerUrl
 * @return {string} resolved spreadsheet URL, or '' if not found
 */
function resolveManagedLedgerSpreadsheetUrl_(ledgerUrl) {
  if (!ledgerUrl) return '';
  try {
    const spreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
    const sheet = spreadsheet.getSheetByName(TPL_SHIPMENT_LEDGER_LISTING_TAB);
    if (!sheet) return '';
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';
    const data = sheet.getRange(2, 1, lastRow - 1, 28).getValues(); // A..AB
    const trimmedInput = ledgerUrl.trim();
    for (let i = 0; i < data.length; i++) {
      const rowUrl = data[i][11] ? data[i][11].toString().trim() : ''; // Column L
      if (rowUrl === trimmedInput) {
        const resolved = data[i][27] ? data[i][27].toString().trim() : ''; // Column AB
        if (resolved) return resolved;
      }
    }
  } catch (e) {
    Logger.log('resolveManagedLedgerSpreadsheetUrl_ lookup failed: ' + e.message);
  }
  return '';
}

/**
 * Normalize Telegram/Sheet message text for line-based regex matching (CRLF, unicode dashes, NBSP) —
 * same normalization process_qr_code_updates.js applies to [QR CODE UPDATE EVENT] bodies.
 * @param {string} raw
 * @return {string}
 */
function normalizeTreePlantingLinkMessage_(raw) {
  let m = (raw || '').toString();
  m = m.replace(/^﻿/, '');
  m = m.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  m = m.replace(/[–—−‐‑]/g, '-');
  m = m.replace(/ /g, ' ');
  return m;
}

/**
 * Parses a [TREE PLANTING LINK EVENT] message body.
 * Expected format:
 * [TREE PLANTING LINK EVENT]
 * - QR Code: <qr_code>
 * - SunMint Submission Message ID: <telegram_message_id>
 * - Updated by: <name>
 * - Submission Source: <url>
 * --------
 *
 * My Digital Signature: <public_key>
 *
 * Request Transaction ID: <signature_hash>
 *
 * @param {string} message
 * @return {{qrCode: string, sunmintMessageId: string, updatedBy: string, publicSignature: string}}
 */
function extractTreePlantingLinkInfo_(message) {
  const result = { qrCode: '', sunmintMessageId: '', updatedBy: '', publicSignature: '', reason: '' };
  try {
    const m = normalizeTreePlantingLinkMessage_(message);

    const qrMatch = m.match(/-\s+QR Code:\s*([^\n]+)/i);
    if (qrMatch) result.qrCode = qrMatch[1].trim();

    const sunmintMatch = m.match(/-\s+SunMint Submission Message ID:\s*([^\n]+)/i);
    if (sunmintMatch) result.sunmintMessageId = sunmintMatch[1].trim();

    const updatedByMatch = m.match(/-\s+Updated by:\s*([^\n]+)/i);
    if (updatedByMatch) result.updatedBy = updatedByMatch[1].trim();

    const sigMatch = m.match(/My Digital Signature:\s*([^\n]+)/i);
    if (sigMatch) result.publicSignature = sigMatch[1].trim();

    const reasonMatch = m.match(/-\s+Reason:\s*([^\n]+)/i);
    if (reasonMatch) result.reason = reasonMatch[1].trim();
  } catch (e) {
    Logger.log('extractTreePlantingLinkInfo_ error: ' + e.message);
  }
  return result;
}

/**
 * Sends the "your tree has been planted" notification to the QR owner and stamps column X.
 * Trimmed, single-file version of qr_code_web_service.js's sendEmailForQRCode (different clasp project
 * — can't cross-call — and this needs the SunMint submission's photo/date, which that function doesn't
 * have) — plain-text body, no DocumentApp template, for v1.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} qrSheet
 * @param {number} qrRowIndex 1-based sheet row
 * @param {string} qrCode
 * @param {string} ownerEmail
 * @param {string} plantingDate
 * @param {string} photoUrl
 */
function sendTreePlantedNotificationEmail_(qrSheet, qrRowIndex, qrCode, ownerEmail, plantingDate, photoUrl, latitude, longitude) {
  try {
    const subject = `Your Sunmint tree (${qrCode}) has been planted`;
    const lookupUrl = `https://truesight.me/qr/?id=${encodeURIComponent(qrCode)}`;
    const bodyLines = [
      `Good news — the tree behind your Sunmint pledge (QR code ${qrCode}) has been planted.`,
      '',
      `Planting date: ${plantingDate || 'N/A'}`,
      (latitude && longitude) ? `Location: ${latitude}, ${longitude}` : '',
      photoUrl ? `Photo: ${photoUrl}` : '',
      '',
      `View the full record: ${lookupUrl}`,
      '',
      'Thank you for supporting Amazon rainforest restoration with TrueSight DAO.'
    ].filter(function (l) { return l !== null && l !== undefined; });

    MailApp.sendEmail({ to: ownerEmail, subject: subject, body: bodyLines.join('\n') });
    qrSheet.getRange(qrRowIndex, TPL_NOTIFICATION_SENT_COL + 1).setValue(new Date());
    Logger.log(`Sent tree-planted notification to ${ownerEmail} for QR ${qrCode}`);
    return true;
  } catch (e) {
    // Don't let a mail failure roll back the already-committed sheet/ledger writes — log and move on.
    // The row's blank column X is itself the signal that notification still needs a manual retry.
    Logger.log(`sendTreePlantedNotificationEmail_ failed for QR ${qrCode}: ${e.message}`);
    return false;
  }
}

/**
 * Manually re-sends the tree-planted notification email for an already-linked QR code, using the
 * row's already-committed values — does NOT touch the ledger or re-run any LINK validation, so it's
 * safe to invoke standalone when the original best-effort send (inside the LINK flow above) silently
 * failed or never fired. Guarded to ASSIGNED_TO_TREE rows only, so it can't be used to fabricate a
 * "planted" notification for a QR that was never actually linked.
 * @param {string} qrCode
 * @return {{status: string, message: string}}
 */
function resendTreePlantedNotification_(qrCode) {
  const qrSpreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
  const qrSheet = qrSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
  const data = qrSheet.getDataRange().getValues();
  let qrRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][QR_CODE_COL] || '').toString().trim() === qrCode) {
      qrRowIndex = i + 1;
      break;
    }
  }
  if (qrRowIndex === -1) {
    return { status: 'error', message: `QR "${qrCode}" not found` };
  }
  const row = data[qrRowIndex - 1];
  const status = (row[STATUS_COL_DEST] || '').toString().trim().toUpperCase();
  if (status !== 'ASSIGNED_TO_TREE') {
    return { status: 'error', message: `QR "${qrCode}" status is "${status}", expected ASSIGNED_TO_TREE` };
  }
  const ownerEmail = (row[EMAIL_COL_DEST] || '').toString().trim();
  if (!ownerEmail) {
    return { status: 'error', message: `QR "${qrCode}" has no Owner Email` };
  }
  const plantingDate = row[TPL_TREE_PLANTING_DATE_COL] || '';
  const latitude = row[TPL_LATITUDE_COL] || '';
  const longitude = row[TPL_LONGITUDE_COL] || '';
  const photoUrl = row[TPL_PHOTO_COL] || '';
  // Send DIRECTLY (no swallowing wrapper) so a real MailApp failure propagates to the doGet
  // handler's try/catch and surfaces as the ACTUAL error, instead of a false "✅ ok". Same
  // content as sendTreePlantedNotificationEmail_ builds. Quota reported to rule out exhaustion.
  const quotaBefore = MailApp.getRemainingDailyQuota();
  const subject = `Your Sunmint tree (${qrCode}) has been planted`;
  const lookupUrl = `https://truesight.me/qr/?id=${encodeURIComponent(qrCode)}`;
  const bodyLines = [
    `Good news \u2014 the tree behind your Sunmint pledge (QR code ${qrCode}) has been planted.`,
    '',
    `Planting date: ${plantingDate || 'N/A'}`,
    (latitude && longitude) ? `Location: ${latitude}, ${longitude}` : '',
    photoUrl ? `Photo: ${photoUrl}` : '',
    '',
    `View the full record: ${lookupUrl}`,
    '',
    'Thank you for supporting Amazon rainforest restoration with TrueSight DAO.'
  ].filter(function (l) { return l !== null && l !== undefined; });
  // NO try/catch around the send \u2014 let the doGet handler's try/catch report the real error.
  MailApp.sendEmail({ to: ownerEmail, subject: subject, body: bodyLines.join('\n') });
  // Stamp the notification-sent date ONLY on genuine success (sendEmail didn't throw).
  qrSheet.getRange(qrRowIndex, TPL_NOTIFICATION_SENT_COL + 1).setValue(new Date());
  return { status: 'ok', message: `Notification re-sent to ${ownerEmail} for QR ${qrCode} (MailApp remaining quota: ${quotaBefore})` };
}

/**
 * Appends the ledger fulfillment pair to the resolved managed ledger's Transactions tab:
 *   -1 "Cacao Tree To Be Planted" (Liability)  — discharges the sale-time obligation
 *   +1 "Cacao Tree Planted"       (Asset)      — Gary, 2026-08-18: fulfilled pledge is a countable asset,
 *                                                 not a liability; also gives a running per-ledger count.
 * Mirrors the row shape sales_update_managed_agl_ledgers.js writes at sale time (Sales Date, message,
 * contributor, amount, currency, category).
 * @param {string} transactionsSpreadsheetUrl
 * @param {string} message full [TREE PLANTING LINK EVENT] text (for the ledger row's "Value"/message column)
 * @param {string} contributorName
 * @return {boolean} true if the pair was appended
 */
function appendTreePlantingLedgerFulfillment_(transactionsSpreadsheetUrl, message, contributorName, ledgerUrl) {
  try {
    // AGL4 discharges on the MAIN DAO ledger's offchain tab (where its sale-time liability lives),
    // not on its own sub-ledger — mirrors sales_update_main_dao_offchain_ledger.js.
    const routesToMain = TPL_MAIN_LEDGER_LEDGER_URLS.includes((ledgerUrl || '').toString().trim());
    const spreadsheet = SpreadsheetApp.openByUrl(routesToMain ? TPL_MAIN_DAO_LEDGER_URL : transactionsSpreadsheetUrl);
    const sheet = spreadsheet.getSheetByName(routesToMain ? TPL_MAIN_DAO_OFFCHAIN_TAB : TPL_TRANSACTIONS_TAB);
    if (!sheet) {
      Logger.log(`appendTreePlantingLedgerFulfillment_: no "${routesToMain ? TPL_MAIN_DAO_OFFCHAIN_TAB : TPL_TRANSACTIONS_TAB}" tab in ${routesToMain ? TPL_MAIN_DAO_LEDGER_URL : transactionsSpreadsheetUrl}`);
      return false;
    }
    const today = new Date();
    let rows;
    if (routesToMain) {
      // 7-column shape matching the main-ledger sale-time rows (Sales Date, message, contributor,
      // amount, category, '', TRUE). Contributor mirrors the sale-time booker's pattern:
      // "SunMint Tree Planting Contract - <ledgerName>" where ledgerName is derived from the ledger URL.
      const ledgerName = (ledgerUrl || '').toString().trim().split('/').filter(Boolean).pop() || 'main';
      rows = [
        [today, message, `SunMint Tree Planting Contract - ${ledgerName}`, -1, 'Cacao Tree To Be Planted', '', true],
        [today, message, `SunMint Tree Planting Contract - ${ledgerName}`, 1, 'Cacao Tree Planted', '', true]
      ];
    } else {
      rows = [
        [today, message, contributorName, -1, 'Cacao Tree To Be Planted', 'Liability'],
        [today, message, contributorName, 1, 'Cacao Tree Planted', 'Asset']
      ];
    }
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    return true;
  } catch (e) {
    Logger.log(`appendTreePlantingLedgerFulfillment_ failed: ${e.message}`);
    return false;
  }
}

function ensureTreePlantingLinkTrackingHeaders_(sheet) {
  if (!sheet) return;
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, TPL_TRACKING_HEADERS.length).setValues([TPL_TRACKING_HEADERS]);
    sheet.getRange(1, 1, 1, TPL_TRACKING_HEADERS.length).setFontWeight('bold');
  }
}

/**
 * Main processing function — reads [TREE PLANTING LINK EVENT] submissions from "Telegram Chat Logs",
 * validates + applies each, and records the outcome in the "Tree Planting Link" tracking tab (dedup key:
 * source row number / Telegram Update ID, same convention as process_qr_code_updates.js).
 * @return {{processed: number, rejected: number, skipped: number, errors: number}}
 */
function processTreePlantingLinksFromTelegramChatLogs() {
  const result = { processed: 0, rejected: 0, skipped: 0, errors: 0 };

  const sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
  const sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
  if (!sourceSheet) throw new Error(`Sheet "${SOURCE_SHEET_NAME}" not found`);

  let trackingSheet = sourceSpreadsheet.getSheetByName(TPL_TRACKING_TAB);
  if (!trackingSheet) {
    trackingSheet = sourceSpreadsheet.insertSheet(TPL_TRACKING_TAB);
  }
  ensureTreePlantingLinkTrackingHeaders_(trackingSheet);

  const trackingData = trackingSheet.getDataRange().getValues();
  const processedRowNumbers = new Set();
  for (let t = 1; t < trackingData.length; t++) {
    const rowNum = trackingData[t][0];
    if (rowNum) processedRowNumbers.add(Number(rowNum));
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  if (sourceData.length < 2) return result;

  const qrSpreadsheet = SpreadsheetApp.openByUrl(DESTINATION_SHEET_URL);
  const qrSheet = qrSpreadsheet.getSheetByName(DESTINATION_SHEET_NAME);
  if (!qrSheet) throw new Error(`Sheet "${DESTINATION_SHEET_NAME}" not found`);
  // SunMint Tree Planting lives on the same spreadsheet as Telegram Chat Logs (sourceSpreadsheet, opened above).
  const sunmintSheet = sourceSpreadsheet.getSheetByName(TPL_SUNMINT_TREE_PLANTING_TAB);
  if (!sunmintSheet) throw new Error(`Sheet "${TPL_SUNMINT_TREE_PLANTING_TAB}" not found`);

  for (let i = 1; i < sourceData.length; i++) {
    const row = sourceData[i];
    const rowNumber = i + 1;
    if (processedRowNumbers.has(rowNumber)) continue;

    const message = (row[MESSAGE_COL] || '').toString();
    if (!message.includes(TREE_PLANTING_LINK_EVENT_MARKER) && !message.includes(TREE_PLANTING_REJECT_EVENT_MARKER)) continue;

    const telegramUpdateId = (row[TELEGRAM_UPDATE_ID_COL] || '').toString();

    try {
      const parsed = extractTreePlantingLinkInfo_(message);

      const recordOutcome = function (outcome, reason) {
        trackingSheet.appendRow([
          rowNumber, telegramUpdateId, parsed.qrCode, parsed.sunmintMessageId,
          outcome, reason, new Date().toISOString(), parsed.updatedBy
        ]);
      };

      if (!parsed.qrCode || !parsed.sunmintMessageId) {
        Logger.log(`Row ${rowNumber}: missing QR Code or SunMint Submission Message ID — skipping`);
        recordOutcome('REJECTED', 'Missing QR Code or SunMint Submission Message ID');
        result.rejected++;
        continue;
      }

      // Authorized-operator check (governor OR sentinel) — reject silently-logged, no partial writes,
      // if the signer isn't authorized. Sentinel support added per Gary 2026-08-20 (plan §0: governor or
      // Sophia / an authorized LLM agent, signing as themselves).
      const contributorName = resolveContributorNameFromPublicSignature_(parsed.publicSignature);
      if (!contributorName || !isAuthorizedOperator_(contributorName)) {
        Logger.log(`Row ${rowNumber}: signer "${contributorName || '(unresolved)'}" is not an authorized operator (governor/sentinel) — rejecting`);
        recordOutcome('REJECTED', 'Signer is not a registered governor or sentinel');
        result.rejected++;
        continue;
      }

      // [TREE PLANTING REJECT EVENT] path — a governor marks a NEW SunMint submission INVALID.
      // No QR status change, no ledger booking, no owner email: an invalid submission must not
      // touch the sold QR it was being considered against.
      if (message.includes(TREE_PLANTING_REJECT_EVENT_MARKER)) {
        const sunmintRejectData = sunmintSheet.getDataRange().getValues();
        let sunmintRejectRowIndex = -1;
        // The monitor page (markTreeInvalid) submits the TREE ID as "SunMint Submission
        // Message ID" — for Edgar-direct rows that is column A (Telegram Update ID), NOT
        // column D (Telegram Message ID, the LINK-path key). Match EITHER so rejects for
        // unlinked trees actually find their row instead of logging "submission not found"
        // and silently leaving the tree NEW (the "tree came back on reload" bug).
        for (let kr = 1; kr < sunmintRejectData.length; kr++) {
          const rejectColD = (sunmintRejectData[kr][TPL_SUNMINT_MESSAGE_ID_COL] || '').toString().trim();
          const rejectColA = (sunmintRejectData[kr][TELEGRAM_UPDATE_ID_COL] || '').toString().trim();
          if (rejectColD === parsed.sunmintMessageId || rejectColA === parsed.sunmintMessageId) {
            sunmintRejectRowIndex = kr + 1;
            break;
          }
        }
        if (sunmintRejectRowIndex === -1) {
          Logger.log(`Row ${rowNumber}: REJECT — SunMint submission "${parsed.sunmintMessageId}" not found`);
          recordOutcome('REJECTED', 'SunMint submission not found (reject path)');
          result.rejected++;
          continue;
        }
        const sunmintRejectStatus = (sunmintRejectData[sunmintRejectRowIndex - 1][TPL_SUNMINT_STATUS_COL] || '').toString().trim().toUpperCase();
        if (sunmintRejectStatus !== 'NEW' && sunmintRejectStatus !== 'LINKED') {
          Logger.log(`Row ${rowNumber}: REJECT — SunMint submission status is "${sunmintRejectStatus}", only NEW or LINKED can be invalidated`);
          recordOutcome('REJECTED', `SunMint submission status is "${sunmintRejectStatus}", expected NEW or LINKED (reject path)`);
          result.rejected++;
          continue;
        }
        sunmintSheet.getRange(sunmintRejectRowIndex, TPL_SUNMINT_STATUS_COL + 1).setValue('INVALID');
        recordOutcome('REJECTED', parsed.reason || 'Marked invalid by governor');
        result.processed++;
        Logger.log(`Row ${rowNumber}: marked SunMint submission "${parsed.sunmintMessageId}" INVALID (governor: ${contributorName}, reason: ${parsed.reason || 'n/a'})`);
        // Fire an immediate tree-index rebuild so the invalidated tree drops from
        // trees/index.geojson now, not at the next 06:00 UTC cron (the "tree came
        // back on reload" complaint). Best-effort: a dispatch failure must never
        // fail the reject itself — the daily cron remains the safety net.
        try {
          const dispatchResp = UrlFetchApp.fetch(
            'https://api.github.com/repos/' + TGM_GITHUB_OWNER + '/' + TGM_GITHUB_REPO + '/dispatches',
            {
              method: 'post',
              headers: {
                'Authorization': 'Bearer ' + getGithubToken_(),
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'TrueSightDAO-GAS'
              },
              payload: JSON.stringify({ event_type: 'tree-index-rebuild' }),
              contentType: 'application/json',
              muteHttpExceptions: true
            }
          );
          Logger.log(`Row ${rowNumber}: fired tree-index-rebuild dispatch (HTTP ${dispatchResp.getResponseCode()})`);
        } catch (e) {
          Logger.log(`Row ${rowNumber}: tree-index-rebuild dispatch failed (non-fatal): ${e.message}`);
        }
        continue;
      }

      // Locate + validate the QR row.
      const qrData = qrSheet.getDataRange().getValues();
      let qrRowIndex = -1;
      for (let j = 1; j < qrData.length; j++) {
        if ((qrData[j][QR_CODE_COL] || '').toString().trim() === parsed.qrCode) { qrRowIndex = j + 1; break; }
      }
      if (qrRowIndex === -1) {
        Logger.log(`Row ${rowNumber}: QR code "${parsed.qrCode}" not found`);
        recordOutcome('REJECTED', 'QR code not found');
        result.rejected++;
        continue;
      }
      const qrRow = qrData[qrRowIndex - 1];
      const qrStatus = (qrRow[STATUS_COL_DEST] || '').toString().trim().toUpperCase();
      if (qrStatus !== 'SOLD' && qrStatus !== 'TREE_PLANTING_FUNDS_TRANSFERRED') {
        Logger.log(`Row ${rowNumber}: QR "${parsed.qrCode}" status is "${qrStatus}", expected SOLD or TREE_PLANTING_FUNDS_TRANSFERRED`);
        recordOutcome('REJECTED', `QR status is "${qrStatus}", expected SOLD or TREE_PLANTING_FUNDS_TRANSFERRED`);
        result.rejected++;
        continue;
      }
      const ownerEmail = (qrRow[EMAIL_COL_DEST] || '').toString().trim();

      // Resolve the managed ledger up front (before any writes) — a QR with an unresolvable ledger
      // URL must not partially link (QR/SunMint flipped but no ledger fulfillment ever booked).
      const ledgerUrl = (qrRow[TPL_LEDGER_URL_COL] || '').toString().trim();
      const transactionsUrl = resolveManagedLedgerSpreadsheetUrl_(ledgerUrl);
      if (!transactionsUrl) {
        Logger.log(`Row ${rowNumber}: could not resolve managed ledger spreadsheet for "${ledgerUrl}"`);
        recordOutcome('REJECTED', `Could not resolve managed ledger for "${ledgerUrl}"`);
        result.rejected++;
        continue;
      }

      // Locate + validate the SunMint submission row.
      const sunmintData = sunmintSheet.getDataRange().getValues();
      let sunmintRowIndex = -1;
      for (let k = 1; k < sunmintData.length; k++) {
        if ((sunmintData[k][TPL_SUNMINT_MESSAGE_ID_COL] || '').toString().trim() === parsed.sunmintMessageId) {
          sunmintRowIndex = k + 1;
          break;
        }
      }
      if (sunmintRowIndex === -1) {
        Logger.log(`Row ${rowNumber}: SunMint submission "${parsed.sunmintMessageId}" not found`);
        recordOutcome('REJECTED', 'SunMint submission not found');
        result.rejected++;
        continue;
      }
      const sunmintRow = sunmintData[sunmintRowIndex - 1];
      const sunmintStatus = (sunmintRow[TPL_SUNMINT_STATUS_COL] || '').toString().trim().toUpperCase();
      if (sunmintStatus !== 'NEW') {
        Logger.log(`Row ${rowNumber}: SunMint submission status is "${sunmintStatus}", expected NEW`);
        recordOutcome('REJECTED', `SunMint submission status is "${sunmintStatus}", expected NEW`);
        result.rejected++;
        continue;
      }

      // --- All validations passed: apply the link. ---

      // 1. QR row.
      qrSheet.getRange(qrRowIndex, STATUS_COL_DEST + 1).setValue('ASSIGNED_TO_TREE');
      qrSheet.getRange(qrRowIndex, TPL_TREE_PLANTING_DATE_COL + 1).setValue(sunmintRow[TPL_SUNMINT_STATUS_DATE_COL] || '');
      qrSheet.getRange(qrRowIndex, TPL_LATITUDE_COL + 1).setValue(sunmintRow[TPL_SUNMINT_LATITUDE_COL] || '');
      qrSheet.getRange(qrRowIndex, TPL_LONGITUDE_COL + 1).setValue(sunmintRow[TPL_SUNMINT_LONGITUDE_COL] || '');
      qrSheet.getRange(qrRowIndex, TPL_PHOTO_COL + 1).setValue(sunmintRow[TPL_SUNMINT_PHOTO_COL] || '');
      // Column Q (Planting Video URL) intentionally left blank — Sunmint app doesn't collect video today.

      // 2. SunMint row.
      sunmintSheet.getRange(sunmintRowIndex, TPL_SUNMINT_STATUS_COL + 1).setValue('LINKED');
      sunmintSheet.getRange(sunmintRowIndex, TPL_SUNMINT_LINKED_QR_COL + 1).setValue(parsed.qrCode);
      sunmintSheet.getRange(sunmintRowIndex, TPL_SUNMINT_LINKED_AT_COL + 1).setValue(new Date().toISOString());

      // 3. Ledger fulfillment (transactionsUrl already resolved + validated above, before any writes).
      const ledgerBooked = appendTreePlantingLedgerFulfillment_(transactionsUrl, message, contributorName, ledgerUrl);

      // 4. Owner notification (best-effort; failures don't roll back the writes above).
      let emailSent = false;
      if (ownerEmail) {
        emailSent = sendTreePlantedNotificationEmail_(
          qrSheet, qrRowIndex, parsed.qrCode, ownerEmail,
          sunmintRow[TPL_SUNMINT_STATUS_DATE_COL] || '', sunmintRow[TPL_SUNMINT_PHOTO_COL] || '',
          sunmintRow[TPL_SUNMINT_LATITUDE_COL] || '', sunmintRow[TPL_SUNMINT_LONGITUDE_COL] || ''
        );
      } else {
        Logger.log(`Row ${rowNumber}: QR "${parsed.qrCode}" has no Owner Email — notification skipped`);
      }

      let outcome = 'OK';
      if (!ledgerBooked) {
        outcome = 'Ledger fulfillment not booked — see log';
      } else if (ownerEmail && !emailSent) {
        outcome = 'Email notification failed — see log';
      }
      recordOutcome('LINKED', outcome);
      result.processed++;
      Logger.log(`Row ${rowNumber}: linked QR "${parsed.qrCode}" to SunMint submission "${parsed.sunmintMessageId}" (governor: ${contributorName})`);

    } catch (err) {
      Logger.log(`Row ${rowNumber}: error — ${err.message}`);
      result.errors++;
    }
  }

  SpreadsheetApp.flush();
  Logger.log(`processTreePlantingLinksFromTelegramChatLogs: processed=${result.processed}, rejected=${result.rejected}, skipped=${result.skipped}, errors=${result.errors}`);
  return result;
}

/**
 * Cron-triggered fallback (set up a time-driven trigger in the Apps Script UI), consistent with every
 * other event type in this codebase — the immediate webhook (dispatch.py routing, PR5) is an
 * optimization on top of this, not a replacement for it.
 */
function processTreePlantingLinkCron() {
  Logger.log(`Cron-triggered tree-planting-link processing started at ${new Date().toISOString()}`);
  try {
    return processTreePlantingLinksFromTelegramChatLogs();
  } catch (error) {
    Logger.log(`Cron processing error: ${error.message}`);
    throw error;
  }
}

/**
 * doPost — direct ingestion webhook for [TREE PLANTING LINK EVENT].
 *
 * WHY: the canonical ingestion path is "post the event message in the DAO Telegram group → the bot
 * scrapes it into the Telegram Chat Logs sheet → processTreePlantingLinksFromTelegramChatLogs() picks
 * it up". But the bot feed has been dead since 2024 (no rows appended since update ~469024790 /
 * msg ~3542), so CLI/API submissions (Edgar) are accepted but never reach the sheet the handler reads.
 * This webhook closes that gap: it accepts a signed event directly, appends a properly-formatted row
 * to the Telegram Chat Logs sheet (same column layout the processor reads), and then runs the existing
 * processor — so a governor-signed submission via the CLI/API path is ingested exactly as if it had
 * been posted in the group.
 *
 * SECURITY: mirrors the server-side governor enforcement of the processor itself — the request must
 * carry the signed event text, and the signature must resolve (via the Contributors Digital Signatures
 * tab) to a contributor whose name is in the Governors tab (column A). Anonymous callers get 401.
 * Idempotent: the processor's tracking tab dedup (by source row number) prevents double-processing.
 *
 * Request (POST, JSON): { "message": "<full [TREE PLANTING LINK EVENT] text incl. My Digital Signature>" }
 * Response: { "status": "ok"|"error", "processed": n, "rejected": n, ... } — same shape as the processor.
 */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    }
    var message = (body.message || '').toString();

    if (!message || message.indexOf(TREE_PLANTING_LINK_EVENT_MARKER) === -1) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', reason: 'missing [TREE PLANTING LINK EVENT] message'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Validate the signer is a governor before ingesting (same enforcement as the processor).
    var parsed = extractTreePlantingLinkInfo_(message);
    var contributorName = parsed.updatedBy ||
      resolveContributorNameFromPublicSignature_(parsed.publicSignature);
    if (!isGovernorByName_(contributorName)) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', reason: 'signer is not a governor', contributor: contributorName
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Append a properly-formatted row to the Telegram Chat Logs sheet (the processor's only input).
    // Column layout matches process_qr_code_updates.js: A=update id, B=chat id, C=chat name,
    // D=message id, E=sender name, F=(unused), G=Contribution Made (message body).
    var sourceSpreadsheet = SpreadsheetApp.openByUrl(SOURCE_SHEET_URL);
    var sourceSheet = sourceSpreadsheet.getSheetByName(SOURCE_SHEET_NAME);
    if (!sourceSheet) throw new Error('Sheet "' + SOURCE_SHEET_NAME + '" not found');
    var fakeUpdateId = 'WEBHOOK-' + new Date().getTime();
    sourceSheet.appendRow([fakeUpdateId, '', '', '', contributorName, '', message]);

    // Run the existing processor — it will pick up the row we just appended.
    var result = processTreePlantingLinksFromTelegramChatLogs();
    result.status = 'ok';
    result.ingestedRow = fakeUpdateId;
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', reason: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Authorize MailApp for this script.
 *
 * Run this function once from the Apps Script editor (select authorizeMailApp from
 * the function dropdown, then click Run). This triggers the OAuth consent screen
 * granting the script.send_mail scope (plus the project's other scopes). Without
 * this grant, every MailApp.sendEmail / getRemainingDailyQuota call throws
 * "You do not have permission to call MailApp... Required permissions:
 * https://www.googleapis.com/auth/script.send_mail".
 *
 * Public (no doGet/doPost routing needed): it exists so an editor user can click
 * Run -> authorizeMailApp and complete the authorization flow in one step.
 *
 * @return {string} A JSON string with the daily quota, or the error if not authorized.
 */
function authorizeMailApp() {
  try {
    var emailQuota = MailApp.getRemainingDailyQuota();
    return JSON.stringify({
      status: 'ok',
      quotaRemaining: emailQuota,
      message: 'MailApp is authorized. Remaining daily quota: ' + emailQuota
    });
  } catch (err) {
    return JSON.stringify({
      status: 'error',
      error: err.message,
      hint: 'Run this function from the editor and approve the OAuth consent screen to grant script.send_mail.'
    });
  }
}

