/**
 * File: google_app_scripts/<scriptId>/process_payout_registration_telegram_logs.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script project: 1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT
 *
 * Description: Async scanner for `[PAYOUT REGISTRATION]` rows on the canonical
 *   Telegram Chat Logs intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   The self-serve form (dapp payout_registration.html, vendored into the CFR Anapu
 *   site) submits a signed `[PAYOUT REGISTRATION]` event to Edgar (RSA route), which
 *   writes the payload into Telegram Chat Logs col G and enqueues a webhook to this
 *   script (`?action=processPayoutRegistrationsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose Telegram Update ID (col A) is not yet present on
 *   the payout tab, this scanner appends a row to the PRIVATE `cfr program`
 *   spreadsheet (SS11.3). That tab is BOTH the dedup ledger and the review surface:
 *   a row is written at most once per Telegram update id, and at most once per
 *   pk_hash (a later correction for the same planter supersedes rather than
 *   duplicates).
 *
 *   PRIVACY POSTURE -- privacy by LOCATION, not encryption (SS11.2, Gary 2026-09-17):
 *
 *     * The raw PIX key is stored PLAINTEXT, but ONLY in the private, governor-only
 *       `cfr program` spreadsheet, which is never link-shared and never republished.
 *       There is no RSA-OAEP cipher and no governor-private-key decrypt step (the
 *       `pix_key_cipher` column is DROPPED).
 *     * The Telegram Chat Logs intake workbook IS publicly republished
 *       (ADVISORY_SNAPSHOT + the `truesight.me/notarizations` redirect), so this
 *       scanner NEVER writes back to it -- it is strictly read-only.
 *     * The PUBLIC JSON-cache generators must never emit `[PAYOUT REGISTRATION]`
 *       (SS11.4; enforced upstream in sync_sunmint_signatures.py / ledger_emit.py /
 *       generate_advisory_snapshot.py).
 *     * `pix_key_masked` is derived here as the display-safe echo for any surface
 *       that must render *something* without exposing the key.
 *
 *   Access to the private tab is restricted to governors + the
 *   `agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com` service account
 *   (governor-gated provisioning; see plans/CRF_ANAPU_SUNMINT_COHORT_PROPOSAL.md SS11).
 *
 *   Idempotent: dedup is keyed on Telegram Update ID. Serialized via LockService.
 *   A self-installing hourly safety-net cron catches anything the webhook missed.
 *
 *   Mirrors process_program_registration_telegram_logs.gs (same Apps Script project).
 */

/** Canonical Telegram intake workbook -- READ ONLY (it is publicly republished). */
var PAYOUT_REG_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var PAYOUT_REG_TELEGRAM_SHEET = 'Telegram Chat Logs';

/**
 * Governor-gated provisioning (SS11.8): the standalone, private, governor-only
 * `cfr program` spreadsheet. Prefer setting the Script Property (no code change);
 * the const below is a fallback for a fixed deployment.
 */
var PAYOUT_REG_CFR_PROGRAM_PROPERTY = 'CFR_PROGRAM_SPREADSHEET_ID';
var PAYOUT_REG_CFR_PROGRAM_SPREADSHEET_ID = '';

/**
 * SS11.3 canonical four-tab schema. Lowercase tab name -> header row.
 * SS11.2: the payout tab carries a PLAINTEXT `pix_key` (private sheet only) and
 * no `pix_key_cipher`.
 */
var PAYOUT_REG_TABS = {
  'payout registrations': [
    'created_at_utc',
    'telegram_update_id',
    'pk_hash',
    'program_slug',
    'pix_key_type',
    'pix_key',
    'pix_key_masked',
    'submission_source',
    'status',
    'supersedes_row',
    'error_message'
  ],
  'tree planting': [
    'created_at_utc',
    'telegram_update_id',
    'pk_hash',
    'tree_id',
    'species',
    'lat',
    'lng',
    'photo_url',
    'capture_source',
    'status'
  ],
  'tree monitoring': [
    'created_at_utc',
    'telegram_update_id',
    'tree_id_qr',
    'species',
    'dbh_cm',
    'co2e_kg',
    'measured_at',
    'photo_url',
    'status'
  ],
  'plot registrations': [
    'created_at_utc',
    'telegram_update_id',
    'pk_hash',
    'plot_ref',
    'geometry_ref',
    'captured_at',
    'status'
  ]
};

/** The tab this scanner writes (the payout-registration review surface). */
var PAYOUT_REG_SHEET = 'payout registrations';
var PAYOUT_REG_HEADERS = PAYOUT_REG_TABS[PAYOUT_REG_SHEET];

/** Per-fire scan window. Matches the program-registration / donation-mint scanners. */
var PAYOUT_REG_SCAN_BATCH = 200;

/** Telegram Chat Logs cols (zero-based) - re-declared here so this file is self-contained. */
var PAYOUT_REG_TC_UPDATE_ID_COL = 0;
var PAYOUT_REG_TC_MESSAGE_ID_COL = 3;
var PAYOUT_REG_TC_MESSAGE_COL = 6;

var PAYOUT_REG_EVENT_TAG = '[PAYOUT REGISTRATION]';

/** Governor-gated: the only non-governor principal granted access to the private sheet. */
var PAYOUT_REG_SHARED_SA = 'agroverse-ledger-manager@get-data-io.iam.gserviceaccount.com';

/** Resolve the private `cfr program` spreadsheet (SS11.8). */
function payoutRegCfrProgramSpreadsheet_() {
  var id = '';
  try {
    var props = PropertiesService.getScriptProperties();
    if (props) id = String(props.getProperty(PAYOUT_REG_CFR_PROGRAM_PROPERTY) || '').trim();
  } catch (e) {}
  if (!id) id = String(PAYOUT_REG_CFR_PROGRAM_SPREADSHEET_ID || '').trim();
  if (!id) {
    throw new Error(
      'The private `cfr program` spreadsheet id is not set (SS11.8). Set the script ' +
      'property "' + PAYOUT_REG_CFR_PROGRAM_PROPERTY + '" to the governor-created sheet id.'
    );
  }
  return SpreadsheetApp.openById(id);
}

/**
 * Idempotently ensure one tab exists with `headers` on row 1. Never deletes,
 * reorders, or overwrites non-header data; throws rather than clobber a sheet
 * whose row 1 is occupied by different headers.
 */
function ensurePayoutRegTab_(spreadsheet, tabName, headers) {
  var sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(tabName);
    sheet.appendRow(headers);
    return sheet;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row1Blank = true;
  for (var b = 0; b < firstRow.length; b++) {
    if (String(firstRow[b] || '').trim() !== '') { row1Blank = false; break; }
  }
  if (lastRow === 0 || row1Blank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  var matches = true;
  for (var i = 0; i < headers.length; i++) {
    if (String(firstRow[i] || '').trim() !== headers[i]) { matches = false; break; }
  }
  if (matches) return sheet;
  if (lastRow <= 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  throw new Error(
    'Sheet "' + tabName + '" row 1 must be exactly: ' + headers.join(', ') +
    '. Fix row 1 in the spreadsheet, or move existing data so row 1 can be replaced.'
  );
}

/** Ensure all four SS11.3 tabs. Returns the tab this scanner writes. */
function ensurePayoutRegistrationsSheet_(spreadsheet) {
  var payoutSheet = null;
  for (var name in PAYOUT_REG_TABS) {
    if (!PAYOUT_REG_TABS.hasOwnProperty(name)) continue;
    var s = ensurePayoutRegTab_(spreadsheet, name, PAYOUT_REG_TABS[name]);
    if (name === PAYOUT_REG_SHEET) payoutSheet = s;
  }
  return payoutSheet;
}

function appendPayoutRegistrationRow_(sheet, p) {
  sheet.appendRow([
    new Date().toISOString(),
    String(p.telegram_update_id || ''),
    String(p.pk_hash || ''),
    String(p.program_slug || ''),
    String(p.pix_key_type || ''),
    String(p.pix_key || ''),
    String(p.pix_key_masked || ''),
    String(p.submission_source || ''),
    String(p.status || ''),
    String(p.supersedes_row || ''),
    String(p.error_message || '')
  ]);
}

/**
 * Normalise a `- Field: value` label into a canonical snake_case key, folding the
 * human-readable aliases used by the redacted summary into the canonical names.
 */
function payoutRegNormKey_(key) {
  var k = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  var alias = {
    'planting_identity_pk_hash': 'pk_hash',
    'planting_identity': 'pk_hash',
    'program': 'program_slug',
    'pix_key_type': 'pix_key_type',
    'pix_key': 'pix_key',
    'pix_key_masked': 'pix_key_masked',
    'submission_source': 'submission_source'
  };
  return alias[k] || k;
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
    var m = probe.match(/^([A-Za-z][A-Za-z0-9_\s\/\-()]*):\s*(.*)$/);
    if (m && isField) {
      var key = payoutRegNormKey_(m[1]);
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
 * Derive a display-safe mask from a raw key. NEVER returns the raw value.
 *   CPF  111.444.777-35      -> ***.***.***-35
 *   CNPJ 11.222.333/0001-99  -> **.***.***_****-99  (slashes rendered as _ in this doc)
 *   email a@example.com      -> a***@example.com
 *   phone +55 11 99999-8888  -> *****8888
 *   EVP (uuid)               -> ****...last4
 *   anything else            -> ****last4 (or **** when too short)
 */
function payoutRegMaskKey_(key, type) {
  var v = String(key == null ? '' : key).trim();
  if (!v) return '';
  var t = String(type || '').toUpperCase();
  var digits = v.replace(/\D/g, '');
  if (t === 'CPF' || digits.length === 11) {
    return '***.***.***-' + digits.slice(-2);
  }
  if (t === 'CNPJ' || digits.length === 14) {
    return '**.***.***/****-' + digits.slice(-2);
  }
  if (t === 'EMAIL' || v.indexOf('@') >= 0) {
    var at = v.indexOf('@');
    return v.charAt(0) + '***' + v.slice(at);
  }
  if (t === 'PHONE' || (v.charAt(0) === '+' && digits.length >= 10)) {
    return '*****' + digits.slice(-4);
  }
  if (t === 'EVP' || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v)) {
    return '****...' + v.slice(-4);
  }
  return v.length > 4 ? '****' + v.slice(-4) : '****';
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

    // Intake: canonical Telegram Chat Logs (read-only; publicly republished).
    var intake = SpreadsheetApp.openById(PAYOUT_REG_TELEGRAM_SPREADSHEET_ID);
    var tcSheet = intake.getSheetByName(PAYOUT_REG_TELEGRAM_SHEET);
    if (!tcSheet) throw new Error('Telegram Chat Logs sheet not found');

    // Output: the private, governor-only `cfr program` spreadsheet (SS11.2/SS11.3).
    var cfr = payoutRegCfrProgramSpreadsheet_();
    var prSheet = ensurePayoutRegistrationsSheet_(cfr);
    if (!prSheet) throw new Error('Could not ensure the payout registrations tab.');

    var prValues = prSheet.getDataRange().getValues();
    var seenUpdateId = {};
    var rowByPkHash = {};
    var header = prValues.length ? prValues[0].map(function (h) { return String(h || '').trim(); }) : [];
    var idx = {};
    header.forEach(function (h, i) { if (h) idx[h] = i; });
    for (var r = 1; r < prValues.length; r++) {
      var upd = String(prValues[r][idx['telegram_update_id']] || '').trim();
      if (upd) seenUpdateId[upd] = true;
      var ph = String(prValues[r][idx['pk_hash']] || '').trim();
      if (ph) rowByPkHash[ph] = r + 1;
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
          telegram_update_id: subKey,
          status: 'REJECTED_NO_TELEGRAM_UPDATE_ID',
          error_message: 'Telegram Chat Logs row ' + (startRow + i) + ' has no Update ID column A'
        });
        seenUpdateId[subKey] = true; rejected++; continue;
      }
      if (seenUpdateId[updateId]) continue;  // dedup: never process the same record twice

      try {
        var f = parsePayoutRegistrationEventText_(message);
        var pixKey = payoutRegCleanValue_(f.pix_key);
        var pixType = payoutRegCleanValue_(f.pix_key_type);
        var base = {
          telegram_update_id: updateId,
          telegram_message_id: messageId,
          pk_hash: payoutRegCleanValue_(f.pk_hash),
          program_slug: payoutRegCleanValue_(f.program_slug || f.program),
          pix_key_type: pixType,
          pix_key: pixKey,                                  // PLAINTEXT - private sheet only (SS11.2)
          pix_key_masked: payoutRegCleanValue_(f.pix_key_masked) || payoutRegMaskKey_(pixKey, pixType),
          submission_source: payoutRegCleanValue_(f.submission_source)
        };

        if (!base.pk_hash) {
          // The public key IS the identity (SS11.1) - without it there is nothing to pay.
          base.status = 'REJECTED_MISSING_PK_HASH';
          base.error_message = 'No pk_hash in the [PAYOUT REGISTRATION] payload; nothing to link the PIX key to.';
          appendPayoutRegistrationRow_(prSheet, base);
          seenUpdateId[updateId] = true; rejected++; continue;
        }

        // Upsert by pk_hash: a later correction for the same planter supersedes.
        var supersedes = '';
        if (rowByPkHash[base.pk_hash]) supersedes = String(rowByPkHash[base.pk_hash]);
        base.supersedes_row = supersedes;
        base.status = supersedes ? 'UPDATED' : 'RECORDED';
        appendPayoutRegistrationRow_(prSheet, base);
        rowByPkHash[base.pk_hash] = prSheet.getLastRow();
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
 * `status` query param optionally filters (default ALL). Never returns the raw key.
 */
function getPendingPayoutRegistrations(statusFilter) {
  try {
    var wanted = String(statusFilter || 'ALL').trim().toUpperCase();
    var ss = payoutRegCfrProgramSpreadsheet_();
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
        program_slug: String(row[idx['program_slug']] || ''),
        pk_hash: String(row[idx['pk_hash']] || ''),
        pix_key_type: String(row[idx['pix_key_type']] || ''),
        pix_key_masked: String(row[idx['pix_key_masked']] || '')
        // NOTE: `pix_key` (plaintext) is deliberately NOT returned by this read endpoint.
      });
    }
    items.sort(function (a, b) { return (a.submitted_date < b.submitted_date) ? 1 : -1; });
    return { status: 'success', data: { count: items.length, items: items } };
  } catch (err) {
    return { status: 'error', message: (err && err.message ? err.message : String(err)) };
  }
}
