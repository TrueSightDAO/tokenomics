/**
 * File: google_app_scripts/agroverse_qr_codes/process_donation_mint_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1slQVojn5P2wC7l5LdFesFT243afkZ2HQ9no9mciExl574VeOe3Wom2rW/edit
 *
 * Description: Async scanner for `[DONATION MINT EVENT]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   Edgar (`sentiment_importer/app/controllers/dao_controller.rb#submit_contribution`)
 *   writes the signed payload into Telegram Chat Logs col G, then enqueues a
 *   webhook to this script (`?action=processDonationMintsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose **Telegram Update ID** (col A) is not yet
 *   present on the **Donation Mints** dedup-log tab (col B), this scanner
 *   enforces three gates before minting a serialized QR code on the Agroverse QR
 *   codes sheet:
 *
 *     1. **Currency allowlist** — `Currency` field must exact-match an entry in
 *        `DONATION_MINT_ALLOWED_CURRENCIES`. V1 ships with one entry:
 *        `SunMint Tree Planting Pledge - QR Code`. Random currencies (Tom's
 *        Crypto Pledge, etc.) are rejected at the schema level.
 *
 *     2. **Governor authorization (Pattern A)** — signer's public key must
 *        resolve to a contributor name in `Contributors Digital Signatures`,
 *        AND that name must appear in the `Governors` tab. Mirrors the same
 *        Pattern A check used by `dapp_permission_change_handler.gs`. Edgar's
 *        upstream `governor_authority` stamp on Telegram Chat Logs col S is
 *        NOT trusted as authoritative — the scanner verifies independently.
 *
 *     3. **Visual proof attached** — `Destination Contribution File Location`
 *        field must be non-empty AND point to `github.com/TrueSightDAO/...`.
 *        The dao_client `mint_donation.py` module enforces this client-side by
 *        requiring `--attached-filename`; Edgar uploads the file and stamps
 *        the URL into the event payload before appending to Telegram Chat
 *        Logs. Same domain restriction the AI-agent contribution flow already
 *        uses to prevent arbitrary off-platform proof URLs.
 *
 *   Failures keep the Telegram Chat Logs row in place for audit (Edgar's append
 *   was already idempotent on Telegram Update ID), but write a `REJECTED_*` row
 *   to **Donation Mints** so future runs skip the row, and *do not* create an
 *   `Agroverse QR codes` row.
 *
 *   The QR code identifier itself is **client-generated** in `mint_donation.py`
 *   (e.g., `PLEDGE_<YYYYMMDD>_<8hex>`) and passed in the event payload's
 *   `QR Code` field. The client knows the QR id immediately and can fire the
 *   subsequent `[SALES EVENT]` (which flips MINTED→SOLD via the existing sales
 *   pipeline) without polling. If the sales scanner runs first, it'll fail to
 *   find the QR row and retry on the next cron firing — eventually consistent.
 *
 * Sister docs:
 *   - `agentic_ai_context/notes/claude_serialized_qr_sales_2026-04-29.md` —
 *     cash sale pattern + ledger-vs-physical-possession primer.
 *   - `process_store_adds_telegram_logs.gs` — closest precedent for the
 *     Telegram-Chat-Logs-driven dedup pattern.
 *   - `dapp_permission_change_handler.gs` — Pattern A governor-lookup precedent.
 */

/** Allowed currencies for `[DONATION MINT EVENT]`. V1: single entry. */
var DONATION_MINT_ALLOWED_CURRENCIES = [
  'SunMint Tree Planting Pledge - QR Code'
];

/** Donation Mints dedup tab on the Telegram compilation workbook (sibling to Telegram Chat Logs). */
var DONATION_MINTS_SHEET = 'Donation Mints';

/** Per-fire scan window. Matches the store-adds scanner. */
var DONATION_MINT_SCAN_BATCH = 200;

/** Governors tab — same workbook as Agroverse QR codes (Main Ledger / Contributors). */
var DONATION_MINT_GOVERNORS_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var DONATION_MINT_GOVERNORS_SHEET_NAME = 'Governors';
var DONATION_MINT_GOVERNORS_FIRST_ROW = 2;
var DONATION_MINT_SIGS_SHEET_NAME = 'Contributors Digital Signatures';

/** Visual proof must point at the TrueSightDAO org GitHub. */
var DONATION_MINT_PROOF_URL_REGEX = /^https?:\/\/(www\.)?github\.com\/TrueSightDAO\//i;

/** Telegram Chat Logs cols (zero-based) — re-declared here so this file is self-contained
 *  in case the helper from the find_nearby_stores project isn't reachable in this script. */
var DONATION_MINT_TC_UPDATE_ID_COL = 0;
var DONATION_MINT_TC_MESSAGE_ID_COL = 3;
var DONATION_MINT_TC_MESSAGE_COL = 6;

var DONATION_MINTS_HEADERS = [
  'created_at_utc',
  'telegram_update_id',
  'telegram_message_id',
  'status',                 // minted | REJECTED_INVALID_CURRENCY | REJECTED_NOT_GOVERNOR | REJECTED_NO_VISUAL_PROOF | REJECTED_INVALID_PROOF_URL | REJECTED_MISSING_QR_ID | error
  'qr_code',
  'currency',
  'donor_name',
  'donor_email',
  'donation_amount',
  'submitted_by',
  'governor_name',
  'visual_proof_url',
  'agroverse_qr_row',       // row number on Agroverse QR codes when minted
  'error_message'
];

function ensureDonationMintsSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(DONATION_MINTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(DONATION_MINTS_SHEET);
    sheet.appendRow(DONATION_MINTS_HEADERS);
    return sheet;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), DONATION_MINTS_HEADERS.length);
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row1Blank = firstRow.every(function (cell) {
    return String(cell || '').trim() === '';
  });
  if (lastRow === 0 || row1Blank) {
    sheet.getRange(1, 1, 1, DONATION_MINTS_HEADERS.length).setValues([DONATION_MINTS_HEADERS]);
    return sheet;
  }
  var matches = DONATION_MINTS_HEADERS.every(function (h, i) {
    return String(firstRow[i] || '').trim() === h;
  });
  if (matches) return sheet;
  if (lastRow <= 1) {
    sheet.getRange(1, 1, 1, DONATION_MINTS_HEADERS.length).setValues([DONATION_MINTS_HEADERS]);
    return sheet;
  }
  throw new Error(
    'Sheet "' + DONATION_MINTS_SHEET + '" row 1 must be exactly: ' +
    DONATION_MINTS_HEADERS.join(', ') +
    '. Fix row 1 in the spreadsheet, or move existing data so row 1 can be replaced.'
  );
}

function appendDonationMintRow_(sheet, params) {
  var row = [
    new Date().toISOString(),
    String(params.telegram_update_id || ''),
    String(params.telegram_message_id || ''),
    String(params.status || ''),
    String(params.qr_code || ''),
    String(params.currency || ''),
    String(params.donor_name || ''),
    String(params.donor_email || ''),
    params.donation_amount != null ? String(params.donation_amount) : '',
    String(params.submitted_by || ''),
    String(params.governor_name || ''),
    String(params.visual_proof_url || ''),
    params.agroverse_qr_row != null ? String(params.agroverse_qr_row) : '',
    String(params.error_message || '')
  ];
  sheet.appendRow(row);
}

/** Parse a `[DONATION MINT EVENT]` body into a key→value map.
 *  Same shape as `parseStoreAddEventText_`. */
function parseDonationMintEventText_(text) {
  var result = {};
  if (!text) return result;
  var body = String(text).split('--------', 1)[0] || String(text);
  var lines = body.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = (lines[i] || '').trim();
    if (!line) continue;
    if (line.indexOf('[DONATION MINT EVENT]') === 0) continue;
    if (line.charAt(0) === '-') line = line.substring(1).trim();
    var m = line.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (!m) continue;
    var key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    result[key] = m[2].trim();
  }
  return result;
}

/** Lower-cased map of governor display names from the Governors tab (col A). */
function readDonationMintGovernors_() {
  var ss = SpreadsheetApp.openById(DONATION_MINT_GOVERNORS_SPREADSHEET_ID);
  var ws = ss.getSheetByName(DONATION_MINT_GOVERNORS_SHEET_NAME);
  if (!ws) return {};
  var last = ws.getLastRow();
  if (last < DONATION_MINT_GOVERNORS_FIRST_ROW) return {};
  var rows = ws.getRange(
    DONATION_MINT_GOVERNORS_FIRST_ROW, 1,
    last - DONATION_MINT_GOVERNORS_FIRST_ROW + 1, 1
  ).getValues();
  var out = {};
  rows.forEach(function (row) {
    var name = String(row[0] || '').trim();
    if (name) out[name.toLowerCase()] = name; // preserve casing for audit
  });
  return out;
}

/** Map of normalized public key → contributor display name from
 *  Contributors Digital Signatures (col A name, col E public key). */
function readDonationMintActiveSignatures_() {
  var ss = SpreadsheetApp.openById(DONATION_MINT_GOVERNORS_SPREADSHEET_ID);
  var ws = ss.getSheetByName(DONATION_MINT_SIGS_SHEET_NAME);
  if (!ws) return {};
  var last = ws.getLastRow();
  if (last < 2) return {};
  var data = ws.getRange(2, 1, last - 1, 8).getValues();
  var out = {};
  data.forEach(function (row) {
    var name = String(row[0] || '').trim();
    var pk = String(row[4] || '').replace(/\s+/g, '').trim();
    if (name && pk) out[pk] = name;
  });
  return out;
}

/** Look up donor's signer name by signature, then check if name is a governor.
 *  Returns { isGovernor: bool, signerName: string }. */
function resolveDonationMintGovernor_(publicSignature) {
  var pk = String(publicSignature || '').replace(/\s+/g, '').trim();
  if (!pk) return { isGovernor: false, signerName: '' };
  var sigs = readDonationMintActiveSignatures_();
  var signerName = sigs[pk] || '';
  if (!signerName) return { isGovernor: false, signerName: '' };
  var governors = readDonationMintGovernors_();
  return {
    isGovernor: !!governors[signerName.toLowerCase()],
    signerName: signerName
  };
}

/** Validate a parsed event and decide a pre-mint disposition.
 *  Returns { ok: bool, status: 'minted'|'REJECTED_*', error_message?: string,
 *            governor_name?, qr_code, currency, donor_name, donor_email,
 *            donation_amount, visual_proof_url, submitted_by }. */
function validateDonationMintEvent_(fields, fullMessage) {
  var qrCode = String(fields.qr_code || '').trim();
  var currency = String(fields.currency || '').trim();
  var donorName = String(fields.donor_name || '').trim();
  var donorEmail = String(fields.donor_email || '').trim();
  var donationAmount = String(fields.donation_amount || '').trim();
  var visualProofUrl = String(fields.destination_contribution_file_location || '').trim();
  var submittedBy = '';
  var sigMatch = (fullMessage || '').match(/My Digital Signature:\s*([^\n]+)/);
  if (sigMatch) submittedBy = sigMatch[1].trim();

  var base = {
    qr_code: qrCode,
    currency: currency,
    donor_name: donorName,
    donor_email: donorEmail,
    donation_amount: donationAmount,
    visual_proof_url: visualProofUrl,
    submitted_by: submittedBy
  };

  if (!qrCode) {
    return Object.assign({}, base, {
      ok: false,
      status: 'REJECTED_MISSING_QR_ID',
      error_message: 'QR Code field is required (client-generated, e.g. PLEDGE_YYYYMMDD_8hex)'
    });
  }

  if (DONATION_MINT_ALLOWED_CURRENCIES.indexOf(currency) === -1) {
    return Object.assign({}, base, {
      ok: false,
      status: 'REJECTED_INVALID_CURRENCY',
      error_message: 'Currency not in donation-eligible allowlist: ' + currency
    });
  }

  if (!visualProofUrl) {
    return Object.assign({}, base, {
      ok: false,
      status: 'REJECTED_NO_VISUAL_PROOF',
      error_message: 'Destination Contribution File Location is required (visual proof URL)'
    });
  }
  if (!DONATION_MINT_PROOF_URL_REGEX.test(visualProofUrl)) {
    return Object.assign({}, base, {
      ok: false,
      status: 'REJECTED_INVALID_PROOF_URL',
      error_message: 'Visual proof URL must point to github.com/TrueSightDAO/...: ' + visualProofUrl
    });
  }

  var gov = resolveDonationMintGovernor_(submittedBy);
  if (!gov.isGovernor) {
    return Object.assign({}, base, {
      ok: false,
      status: 'REJECTED_NOT_GOVERNOR',
      governor_name: gov.signerName,
      error_message: 'Signer is not in Governors tab (signer=' + (gov.signerName || '<unresolved>') + ')'
    });
  }

  return Object.assign({}, base, {
    ok: true,
    status: 'minted',
    governor_name: gov.signerName
  });
}

/**
 * Append a fully-formed row to `Agroverse QR codes` for a validated donation mint.
 * Reuses canonical `createQRCodeRow(qrCodeValue, productData)` from qr_code_web_service.gs
 * and then patches the donation-specific overrides.
 *
 * **Server-locked fields (NOT trusted from client payload — derived here):**
 *   - col B `landing_page` ← Currencies col E (already via createQRCodeRow / currencyData)
 *   - col C `ledger`       ← Currencies col F (already via createQRCodeRow / currencyData)
 *   - col U `Manager Name` ← validated governor display name
 *   - col V `Ledger Name`  ← parsed from Currencies col F URL (e.g. `…/agl4` → `AGL4`)
 *
 * If the dao_client (or any other caller) attempts to set any of these in the
 * `[DONATION MINT EVENT]` payload, those values are ignored. This is the
 * integrity boundary — only governors can mint, but even a governor cannot
 * misroute funds by spoofing `Ledger Name` or the public-facing `landing_page`.
 *
 * Returns the row number that was appended.
 */
function appendDonationMintToAgroverseQrCodes_(eventData, currencyData) {
  var ss = SpreadsheetApp.openById(SHEET_URL_TO_ID_(SHEET_URL));
  var ws = ss.getSheetByName(QR_CODE_SHEET_NAME);
  if (!ws) throw new Error('Agroverse QR codes sheet not found');

  // Canonical row builder from qr_code_web_service.gs returns the 20-col row.
  var row = createQRCodeRow(eventData.qr_code, currencyData);

  // Donation-specific overrides:
  //   col L (index 11) — Owner Email = donor email at mint time
  //   col T (index 19) — Price = donation amount (createQRCodeRow defaults to 25)
  //   col U (index 20) — Manager Name = governor's display name (server-validated)
  //   col V (index 21) — Ledger Name = derived from Currencies `ledger` URL
  if (eventData.donor_email) row[11] = eventData.donor_email;
  var amount = parseFloat(eventData.donation_amount);
  if (!isNaN(amount) && amount > 0) row[19] = amount;
  // createQRCodeRow's row may be shorter than V; pad to length 22.
  while (row.length < 22) row.push('');
  row[20] = eventData.governor_name || '';
  row[21] = ledgerNameFromCurrencies_(currencyData);

  ws.appendRow(row);
  return ws.getLastRow();
}

/** Derive the `Ledger Name` (e.g. "AGL4") from the Currencies tab's `ledger` URL.
 *  Single source of truth: Currencies col F. If the Pledge currency moves to a
 *  different AGL ledger later, only one cell needs to change.
 *  Returns '' if the URL doesn't contain an `agl<N>` segment — operator can
 *  back-fill the cell manually in that edge case. */
function ledgerNameFromCurrencies_(currencyData) {
  var url = String(currencyData && currencyData.ledger || '').trim();
  var m = url.match(/\/(agl\d+)\b/i);
  return m ? m[1].toUpperCase() : '';
}

/** Helper — extract spreadsheet ID from the canonical SHEET_URL constant. */
function SHEET_URL_TO_ID_(url) {
  var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

/**
 * HTTP / time-driven entry point. Triggered from Edgar after every
 * `[DONATION MINT EVENT]` submission, plus a safety-net cron for retries.
 *
 * Idempotent: dedup is keyed on Telegram Update ID (col A on Telegram Chat
 * Logs, col B on Donation Mints). Re-runs over the same Telegram rows skip
 * already-recorded update ids. Serialized via `LockService.getScriptLock()`.
 */
function processDonationMintsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processDonationMintsFromTelegramChatLogs: another run is in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    var telegramSpreadsheet = SpreadsheetApp.openById('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ');
    var tcSheet = telegramSpreadsheet.getSheetByName('Telegram Chat Logs');
    if (!tcSheet) {
      throw new Error('Telegram Chat Logs sheet not found');
    }
    var dmSheet = ensureDonationMintsSheet_(telegramSpreadsheet);

    var dmValues = dmSheet.getDataRange().getValues();
    var seenUpdateIds = {};
    for (var r = 1; r < dmValues.length; r++) {
      var existing = String(dmValues[r][1] || '').trim();
      if (existing) seenUpdateIds[existing] = true;
    }

    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, minted: 0, rejected: 0, errors: 0 };
    }
    var startRow = Math.max(2, lastRow - DONATION_MINT_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), DONATION_MINT_TC_MESSAGE_COL + 1);
    var tcRange = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var minted = 0;
    var rejected = 0;
    var errors = 0;

    for (var i = 0; i < tcRange.length; i++) {
      var message = String(tcRange[i][DONATION_MINT_TC_MESSAGE_COL] || '');
      if (message.indexOf('[DONATION MINT EVENT]') === -1) continue;

      var telegramUpdateId = String(tcRange[i][DONATION_MINT_TC_UPDATE_ID_COL] || '').trim();
      var telegramMessageId = String(tcRange[i][DONATION_MINT_TC_MESSAGE_ID_COL] || '').trim();

      if (!telegramUpdateId) {
        var rowSubstituteKey = 'NO_UPDATE_ID_ROW_' + (startRow + i);
        if (seenUpdateIds[rowSubstituteKey]) continue;
        appendDonationMintRow_(dmSheet, {
          telegram_update_id: rowSubstituteKey,
          telegram_message_id: telegramMessageId,
          status: 'REJECTED_NO_TELEGRAM_UPDATE_ID',
          error_message: 'Telegram Chat Logs row ' + (startRow + i) + ' has no Update ID column A'
        });
        seenUpdateIds[rowSubstituteKey] = true;
        rejected++;
        continue;
      }
      if (seenUpdateIds[telegramUpdateId]) continue;

      var fields = parseDonationMintEventText_(message);
      var eventData = validateDonationMintEvent_(fields, message);

      if (!eventData.ok) {
        appendDonationMintRow_(dmSheet, {
          telegram_update_id: telegramUpdateId,
          telegram_message_id: telegramMessageId,
          status: eventData.status,
          qr_code: eventData.qr_code,
          currency: eventData.currency,
          donor_name: eventData.donor_name,
          donor_email: eventData.donor_email,
          donation_amount: eventData.donation_amount,
          submitted_by: eventData.submitted_by,
          governor_name: eventData.governor_name || '',
          visual_proof_url: eventData.visual_proof_url,
          error_message: eventData.error_message
        });
        seenUpdateIds[telegramUpdateId] = true;
        rejected++;
        continue;
      }

      try {
        var currencyData = getCurrencyData(eventData.currency);
        if (!currencyData) {
          appendDonationMintRow_(dmSheet, {
            telegram_update_id: telegramUpdateId,
            telegram_message_id: telegramMessageId,
            status: 'error',
            qr_code: eventData.qr_code,
            currency: eventData.currency,
            donor_name: eventData.donor_name,
            donor_email: eventData.donor_email,
            donation_amount: eventData.donation_amount,
            submitted_by: eventData.submitted_by,
            governor_name: eventData.governor_name,
            visual_proof_url: eventData.visual_proof_url,
            error_message: 'Currency not configured in Currencies tab (Serializable=TRUE, landing_page set): ' + eventData.currency
          });
          seenUpdateIds[telegramUpdateId] = true;
          errors++;
          continue;
        }

        var aqrRow = appendDonationMintToAgroverseQrCodes_(eventData, currencyData);

        appendDonationMintRow_(dmSheet, {
          telegram_update_id: telegramUpdateId,
          telegram_message_id: telegramMessageId,
          status: 'minted',
          qr_code: eventData.qr_code,
          currency: eventData.currency,
          donor_name: eventData.donor_name,
          donor_email: eventData.donor_email,
          donation_amount: eventData.donation_amount,
          submitted_by: eventData.submitted_by,
          governor_name: eventData.governor_name,
          visual_proof_url: eventData.visual_proof_url,
          agroverse_qr_row: aqrRow
        });
        seenUpdateIds[telegramUpdateId] = true;
        minted++;
      } catch (rowErr) {
        appendDonationMintRow_(dmSheet, {
          telegram_update_id: telegramUpdateId,
          telegram_message_id: telegramMessageId,
          status: 'error',
          qr_code: eventData.qr_code,
          currency: eventData.currency,
          donor_name: eventData.donor_name,
          donor_email: eventData.donor_email,
          donation_amount: eventData.donation_amount,
          submitted_by: eventData.submitted_by,
          governor_name: eventData.governor_name,
          visual_proof_url: eventData.visual_proof_url,
          error_message: String(rowErr && (rowErr.message || rowErr))
        });
        seenUpdateIds[telegramUpdateId] = true;
        errors++;
      }
    }

    Logger.log(
      'processDonationMintsFromTelegramChatLogs: minted=' + minted +
      ' rejected=' + rejected + ' errors=' + errors +
      ' window=' + startRow + '-' + lastRow
    );
    return {
      success: true,
      minted: minted,
      rejected: rejected,
      errors: errors
    };
  } finally {
    lock.releaseLock();
  }
}

/** doGet shim so the GAS web app can be triggered as
 *  `?action=processDonationMintsFromTelegramChatLogs`. The umbrella project
 *  router (qr_code_web_service.gs) routes by action name. */
function dispatchDonationMintAction_(action) {
  if (action === 'processDonationMintsFromTelegramChatLogs') {
    return processDonationMintsFromTelegramChatLogs();
  }
  return null;
}
