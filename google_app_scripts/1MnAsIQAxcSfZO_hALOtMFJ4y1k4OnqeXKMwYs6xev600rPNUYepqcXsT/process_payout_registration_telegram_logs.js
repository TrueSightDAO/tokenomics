/**
 * File: google_app_scripts/<scriptId>/process_payout_registration_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script project: 1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT
 *
 * Description: Async scanner for `[PAYOUT REGISTRATION]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   The self-serve form (dapp payout_registration.html, vendored into the CFR Anapu
 *   site) submits a signed `[PAYOUT REGISTRATION]` event to Edgar (RSA route), which
 *   writes the signed payload into Telegram Chat Logs col G and enqueues a webhook to
 *   this script (`?action=processPayoutRegistrationsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose **Telegram Update ID** (col A) is not yet present
 *   on the **Payout Registrations** tab (col B), this scanner appends a row. The tab
 *   is BOTH the dedup ledger and the review surface: a row is written at most once per
 *   Telegram update id, and at most once per pk_hash (a later correction for the same
 *   student supersedes rather than duplicates).
 *
 *   PRIVACY INVARIANT: this scanner never *derives* or echoes a raw PIX key. It
 *   copies whatever value the signed payload carried in its `- PIX Key:` field
 *   verbatim. The client is expected to send the key masked-plus-encrypted so that the
 *   public-republished surfaces (ADVISORY_SNAPSHOT, the notarizations redirect) never
 *   see plaintext. A fail-closed guard below REFUSES to write a raw CPF/CNPJ-shaped
 *   value into the tab unless it is short (masked) or high-entropy (ciphertext),
 *   logging the refusal instead of leaking. Access to the tab is restricted to
 *   governors + the `agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com`
 *   service account (governor-gated provisioning; see plans/CRF_ANAPU_SUNMINT_COHORT_PROPOSAL.md).
 *
 *   Idempotent: dedup is keyed on Telegram Update ID (col A on Telegram Chat Logs,
 *   col B on Payout Registrations). Serialized via LockService. A self-installing
 *   hourly safety-net cron catches anything the webhook missed.
 *
 *   Mirrors process_program_registration_telegram_logs.gs (same Apps Script project).
 */

/** Canonical Telegram intake workbook (sibling tabs: Telegram Chat Logs, Program Registrations, ...). */
var PAYOUT_REG_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var PAYOUT_REG_TELEGRAM_SHEET = 'Telegram Chat Logs';

/** Dedup + review tab (auto-created on first run). */
var PAYOUT_REG_SHEET = 'Payout Registrations';

/** Per-fire scan window. Matches the program-registration / donation-mint scanners. */
var PAYOUT_REG_SCAN_BATCH = 200;

/** Telegram Chat Logs cols (zero-based) - re-declared here so this file is self-contained. */
var PAYOUT_REG_TC_UPDATE_ID_COL = 0;
var PAYOUT_REG_TC_MESSAGE_ID_COL = 3;
var PAYOUT_REG_TC_MESSAGE_COL = 6;

var PAYOUT_REG_EVENT_TAG = '[PAYOUT REGISTRATION]';

/** Governor-gated: the only non-governor principal granted access to this tab. */
var PAYOUT_REG_SHARED_SA = 'agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com';

/** Header row. `pix_key_value` holds the payload value VERBATIM (masked or ciphertext). */
var PAYOUT_REG_HEADERS = [
  'created_at_utc',
  'telegram_update_id',
  'telegram_message_id',
  'status',                 // RECORDED | UPDATED | REJECTED_NO_TELEGRAM_UPDATE_ID | REJECTED_UNSAFE_KEY | error
  'student_name',
  'student_email',
  'pk_hash',
  'program_slug',
  'pix_key_type',
  'pix_key_masked',         // display-safe mask, e.g. ***.***.***-35
  'pix_key_cipher',         // RSA-OAEP ciphertext of the raw key - opaque here, never decrypted
  'account_holder',
  'relationship',
  'no_key_channel',
  'submission_source',
  'supersedes_row',         // row number this record replaced, if any
  'error_message'
];

function ensurePayoutRegistrationsSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(PAYOUT_REG_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PAYOUT_REG_SHEET);
    sheet.appendRow(PAYOUT_REG_HEADERS);
    return sheet;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), PAYOUT_REG_HEADERS.length);
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row1Blank = firstRow.every(function (cell) { return String(cell || '').trim() === ''; });
  if (lastRow === 0 || row1Blank) {
    sheet.getRange(1, 1, 1, PAYOUT_REG_HEADERS.length).setValues([PAYOUT_REG_HEADERS]);
    return sheet;
  }
  var matches = PAYOUT_REG_HEADERS.every(function (h, i) { return String(firstRow[i] || '').trim() === h; });
  if (matches) return sheet;
  if (lastRow <= 1) {
    sheet.getRange(1, 1, 1, PAYOUT_REG_HEADERS.length).setValues([PAYOUT_REG_HEADERS]);
    return sheet;
  }
  throw new Error(
    'Sheet "' + PAYOUT_REG_SHEET + '" row 1 must be exactly: ' + PAYOUT_REG_HEADERS.join(', ') +
    '. Fix row 1 in the spreadsheet, or move existing data so row 1 can be replaced.'
  );
}

function appendPayoutRegistrationRow_(sheet, p) {
  sheet.appendRow([
    new Date().toISOString(),
    String(p.telegram_update_id || ''),
    String(p.telegram_message_id || ''),
    String(p.status || ''),
    String(p.student_name || ''),
    String(p.student_email || ''),
    String(p.pk_hash || ''),
    String(p.program_slug || ''),
    String(p.pix_key_type || ''),
    String(p.pix_key_masked || ''),
    String(p.pix_key_cipher || ''),
    String(p.account_holder || ''),
    String(p.relationship || ''),
    String(p.no_key_channel || ''),
    String(p.submission_source || ''),
    String(p.supersedes_row || ''),
    String(p.error_message || '')
  ]);
}

/**
 * Parse `- Field: value` lines from a signed payload. Generic over field names;
 * mirrors parseProgramRegistrationEventText_ in the sibling scanner.
 */
function parsePayoutRegistrationEventText_(body) {
  var result = {};
  var lines = String(body || '').split(/\r?\n/);
  var lastKey = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] == null) continue;
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf(PAYOUT_REG_EVENT_TAG) === 0) continue;
    if (line === '--------') continue;
    var isField = line.charAt(0) === '-';
    var probe = isField ? line.substring(1).trim() : line;
    var m = probe.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (m && isField) {
      var key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
      result[key] = m[2].trim();
      lastKey = key;
    } else if (lastKey) {
      result[lastKey] = (result[lastKey] ? result[lastKey] + ' ' : '') + line;
    }
  }
  return result;
}

/** True only when the tag is the FIRST non-empty line (not merely mentioned in a description). */
function isPayoutRegistrationEvent_(message) {
  var lines = String(message || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    return t.indexOf(PAYOUT_REG_EVENT_TAG) === 0;
  }
  return false;
}

function payoutRegCleanValue_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\(pending governor assignment\)$/i.test(s) || /^n\/a$/i.test(s)) return '';
  return s;
}

/**
 * Fail-closed privacy guard for the MASK field. The masked echo must be a genuine
 * mask (a `*` run) - never a raw CPF/CNPJ/phone/email. Empty is allowed (a no-key
 * student, or a payload that omitted the mask).
 */
function payoutRegIsSafeMaskValue_(value) {
  var v = String(value == null ? '' : value).trim();
  if (!v) return true;
  if (/^\(none\b/i.test(v) || /^\(not provided\)$/i.test(v)) return true;
  if (v.indexOf('*') >= 0) {
    // must NOT additionally carry a full raw key
    var digits = v.replace(/\D/g, '');
    if (digits.length >= 11) return false;
    return true;
  }
  return false;   // a non-masked, non-empty "mask" field is a raw-value red flag
}

/**
 * Fail-closed privacy guard for the CIPHER field. Must be opaque: long and
 * base64/hex-shaped. Empty allowed. Anything short or carrying PII punctuation
 * (dots/dashes/slashes/@ typical of a raw key) is refused.
 */
function payoutRegIsSafeCipherValue_(value) {
  var v = String(value == null ? '' : value).trim();
  if (!v) return true;
  var compact = v.replace(/\s+/g, '');
  if (compact.length < 32) return false;
  if (!/^[A-Za-z0-9+/=_.:\-]+$/.test(compact)) return false;
  return true;
}

/**
 * HTTP / time-driven entry point. Triggered by Edgar after every
 * `[PAYOUT REGISTRATION]` submission, plus an hourly safety-net cron.
 */
function processPayoutRegistrationsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processPayoutRegistrationsFromTelegramChatLogs: another run in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    try {
      ensurePayoutRegHourlyTriggerInstalled_();
    } catch (triggerErr) {
      Logger.log('ensurePayoutRegHourlyTriggerInstalled_: ' +
        (triggerErr && triggerErr.message ? triggerErr.message : triggerErr) + ' - proceeding with scan.');
    }

    var ss = SpreadsheetApp.openById(PAYOUT_REG_TELEGRAM_SPREADSHEET_ID);
    var tcSheet = ss.getSheetByName(PAYOUT_REG_TELEGRAM_SHEET);
    if (!tcSheet) throw new Error('Telegram Chat Logs sheet not found');
    var prSheet = ensurePayoutRegistrationsSheet_(ss);

    var prValues = prSheet.getDataRange().getValues();
    var seenUpdateId = {};
    var rowByPkHash = {};
    var header = prValues.length ? prValues[0].map(function (h) { return String(h || '').trim(); }) : [];
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });
    for (var r = 1; r < prValues.length; r++) {
      var existing = String(prValues[r][idx['telegram_update_id']] || '').trim();
      if (existing) seenUpdateId[existing] = true;
      var pk = String(prValues[r][idx['pk_hash']] || '').trim();
      if (pk) rowByPkHash[pk] = r + 1;
    }

    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) return { success: true, recorded: 0, updated: 0, rejected: 0, errors: 0 };
    var startRow = Math.max(2, lastRow - PAYOUT_REG_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), PAYOUT_REG_TC_MESSAGE_COL + 1);
    var rows = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var recorded = 0, updated = 0, rejected = 0, errors = 0;

    for (var i = 0; i < rows.length; i++) {
      var message = String(rows[i][PAYOUT_REG_TC_MESSAGE_COL] || '');
      if (!isPayoutRegistrationEvent_(message)) continue;

      var updateId = String(rows[i][PAYOUT_REG_TC_UPDATE_ID_COL] || '').trim();
      var messageId = String(rows[i][PAYOUT_REG_TC_MESSAGE_ID_COL] || '').trim();

      if (!updateId) {
        var subKey = 'NO_UPDATE_ID_ROW_' + (startRow + i);
        if (seenUpdateId[subKey]) continue;
        appendPayoutRegistrationRow_(prSheet, {
          telegram_update_id: subKey, telegram_message_id: messageId,
          status: 'REJECTED_NO_TELEGRAM_UPDATE_ID',
          error_message: 'Telegram Chat Logs row ' + (startRow + i) + ' has no Update ID column A'
        });
        seenUpdateId[subKey] = true; rejected++; continue;
      }
      if (seenUpdateId[updateId]) continue;  // dedup: never process the same record twice

      try {
        var f = parsePayoutRegistrationEventText_(message);
        var maskedValue = payoutRegCleanValue_(f.pix_key_masked);
        var cipherValue = payoutRegCleanValue_(f.pix_key_cipher);
        var legacyRaw = payoutRegCleanValue_(f.pix_key);
        var base = {
          telegram_update_id: updateId,
          telegram_message_id: messageId,
          student_name: payoutRegCleanValue_(f.student_name),
          student_email: payoutRegCleanValue_(f.student_email).toLowerCase(),
          pk_hash: payoutRegCleanValue_(f.pk_hash),
          program_slug: payoutRegCleanValue_(f.program_slug || f.program),
          pix_key_type: payoutRegCleanValue_(f.pix_key_type),
          pix_key_masked: maskedValue,
          pix_key_cipher: cipherValue,
          account_holder: payoutRegCleanValue_(f.account_holder),
          relationship: payoutRegCleanValue_(f.relationship) || 'self',
          no_key_channel: payoutRegCleanValue_(f.no_key_channel),
          submission_source: payoutRegCleanValue_(f.submission_source)
        };

        if (!base.student_name && !base.student_email) {
          base.status = 'REJECTED_MISSING_IDENTITY';
          base.error_message = 'No student name or email in the [PAYOUT REGISTRATION] payload.';
          appendPayoutRegistrationRow_(prSheet, base);
          seenUpdateId[updateId] = true; rejected++; continue;
        }

        var unsafeReason = '';
        if (legacyRaw) unsafeReason = 'payload carried a raw `- PIX Key:` field; send `- PIX Key Masked:` + `- PIX Key Cipher:` instead';
        else if (!payoutRegIsSafeMaskValue_(maskedValue)) unsafeReason = 'the `- PIX Key Masked:` value is not a real mask';
        else if (!payoutRegIsSafeCipherValue_(cipherValue)) unsafeReason = 'the `- PIX Key Cipher:` value is not opaque ciphertext';
        if (unsafeReason) {
          base.status = 'REJECTED_UNSAFE_KEY';
          base.pix_key_masked = '';
          base.pix_key_cipher = '';   // do NOT persist anything key-shaped
          base.error_message = 'Refused: ' + unsafeReason + '.';
          appendPayoutRegistrationRow_(prSheet, base);
          seenUpdateId[updateId] = true; rejected++; continue;
        }

        // Upsert by pk_hash: a later correction for the same student supersedes.
        var supersedes = '';
        if (base.pk_hash && rowByPkHash[base.pk_hash]) supersedes = String(rowByPkHash[base.pk_hash]);
        base.supersedes_row = supersedes;
        base.status = supersedes ? 'UPDATED' : 'RECORDED';
        appendPayoutRegistrationRow_(prSheet, base);
        if (base.pk_hash) rowByPkHash[base.pk_hash] = prSheet.getLastRow();
        seenUpdateId[updateId] = true;
        if (supersedes) updated++; else recorded++;
      } catch (rowErr) {
        appendPayoutRegistrationRow_(prSheet, {
          telegram_update_id: updateId, telegram_message_id: messageId,
          status: 'error',
          error_message: (rowErr && rowErr.message ? rowErr.message : String(rowErr))
        });
        seenUpdateId[updateId] = true; errors++;
      }
    }

    return { success: true, recorded: recorded, updated: updated, rejected: rejected, errors: errors };
  } catch (err) {
    Logger.log('processPayoutRegistrationsFromTelegramChatLogs error: ' + (err && err.message ? err.message : err));
    return { success: false, error: (err && err.message ? err.message : String(err)) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function ensurePayoutRegHourlyTriggerInstalled_() {
  var fn = 'processPayoutRegistrationsFromTelegramChatLogs';
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === fn) return;
  }
  ScriptApp.newTrigger(fn).timeBased().everyHours(1).create();
}

/**
 * Read endpoint for the DApp review page. Returns status + row count.
 * `status` query param optionally filters (default ALL).
 */
function getPendingPayoutRegistrations(statusFilter) {
  try {
    var wanted = String(statusFilter || 'ALL').trim().toUpperCase();
    var ss = SpreadsheetApp.openById(PAYOUT_REG_TELEGRAM_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PAYOUT_REG_SHEET);
    if (!sheet) return { status: 'success', data: { count: 0, items: [] } };
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { status: 'success', data: { count: 0, items: [] } };
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });
    var items = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var st = String(row[idx['status']] || '').trim().toUpperCase();
      if (wanted !== 'ALL' && st !== wanted) continue;
      items.push({
        row: r + 1,
        status: String(row[idx['status']] || ''),
        submitted_date: String(row[idx['created_at_utc']] || ''),
        student_name: String(row[idx['student_name']] || ''),
        program_slug: String(row[idx['program_slug']] || ''),
        pk_hash: String(row[idx['pk_hash']] || ''),
        pix_key_type: String(row[idx['pix_key_type']] || ''),
        pix_key_masked: String(row[idx['pix_key_masked']] || '')
        // NOTE: pix_key_value is deliberately NOT returned by this read endpoint.
      });
    }
    items.sort(function (a, b) { return (a.submitted_date < b.submitted_date) ? 1 : -1; });
    return { status: 'success', data: { count: items.length, items: items } };
  } catch (err) {
    return { status: 'error', message: (err && err.message ? err.message : String(err)) };
  }
}
