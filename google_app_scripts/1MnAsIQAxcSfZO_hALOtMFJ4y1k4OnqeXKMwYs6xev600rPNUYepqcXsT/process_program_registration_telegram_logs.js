/**
 * File: google_app_scripts/agroverse_qr_codes/process_program_registration_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor (live project; 1slQVojn… is the DEPRECATED predecessor):
 * https://script.google.com/home/projects/1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT/edit
 *
 * Description: Async scanner for `[PROGRAM REGISTRATION REQUEST]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   The public self-serve form (truesight.me/lineage-register.html →
 *   truesight_me/js/lineage-register.js) submits a signed `[PROGRAM REGISTRATION REQUEST]`
 *   to Edgar, which writes the payload into Telegram Chat Logs col G and enqueues a
 *   webhook to this script (`?action=processProgramRegistrationsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose **Telegram Update ID** (col A) is not yet present on
 *   the **Program Registrations** dedup/review tab (col B), this scanner appends a
 *   `PENDING` row for a DAO governor to review. NO provisioning happens here — resource
 *   creation (subdomain, ledger, currency, SA access) is governor-gated and handled by a
 *   separate approval flow. This handler only collects requests into a reviewable surface.
 *
 *   The DApp review page reads PENDING rows via `?action=getPendingProgramRegistrations`.
 *
 *   Idempotent: dedup is keyed on Telegram Update ID (col A on Telegram Chat Logs, col B
 *   on Program Registrations). Re-runs skip already-recorded update ids. Serialized via
 *   LockService. A self-installing hourly safety-net cron catches anything the webhook
 *   missed (Edgar offline, webhook timeout, etc.).
 *
 *   Spec: agentic_ai_context/PROGRAM_PARTNER_ONBOARDING.md (two-step registration flow).
 *   Mirrors process_donation_mint_telegram_logs.gs (same Apps Script project).
 */

/** Canonical Telegram intake workbook (sibling tabs: Telegram Chat Logs, Donation Pledge, …). */
var PROGRAM_REG_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var PROGRAM_REG_TELEGRAM_SHEET = 'Telegram Chat Logs';

/** Review/dedup tab on the Telegram compilation workbook (auto-created on first run). */
var PROGRAM_REG_SHEET = 'Program Registrations';

/** Per-fire scan window. Matches the donation-mint / store-adds scanners. */
var PROGRAM_REG_SCAN_BATCH = 200;

/** Telegram Chat Logs cols (zero-based) — re-declared here so this file is self-contained. */
var PROGRAM_REG_TC_UPDATE_ID_COL = 0;
var PROGRAM_REG_TC_MESSAGE_ID_COL = 3;
var PROGRAM_REG_TC_MESSAGE_COL = 6;

var PROGRAM_REG_EVENT_TAG = '[PROGRAM REGISTRATION REQUEST]';

var PROGRAM_REG_HEADERS = [
  'created_at_utc',
  'telegram_update_id',
  'telegram_message_id',
  'status',                 // PENDING | APPROVED | REJECTED | REJECTED_MISSING_NAME | REJECTED_NO_TELEGRAM_UPDATE_ID | error
  'program_slug',
  'display_name',
  'description',
  'capabilities',
  'partner_organization',
  'website',
  'logo_url',
  'roster_sheet_url',
  'admin_subdomain',
  'currency',
  'ledger_codename',
  'price',
  'origin_identity',        // requester's base64 SPKI public key (their DAO identity)
  'submission_source',
  'error_message'
];

function ensureProgramRegistrationsSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(PROGRAM_REG_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PROGRAM_REG_SHEET);
    sheet.appendRow(PROGRAM_REG_HEADERS);
    return sheet;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), PROGRAM_REG_HEADERS.length);
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row1Blank = firstRow.every(function (cell) { return String(cell || '').trim() === ''; });
  if (lastRow === 0 || row1Blank) {
    sheet.getRange(1, 1, 1, PROGRAM_REG_HEADERS.length).setValues([PROGRAM_REG_HEADERS]);
    return sheet;
  }
  var matches = PROGRAM_REG_HEADERS.every(function (h, i) { return String(firstRow[i] || '').trim() === h; });
  if (matches) return sheet;
  if (lastRow <= 1) {
    sheet.getRange(1, 1, 1, PROGRAM_REG_HEADERS.length).setValues([PROGRAM_REG_HEADERS]);
    return sheet;
  }
  throw new Error(
    'Sheet "' + PROGRAM_REG_SHEET + '" row 1 must be exactly: ' + PROGRAM_REG_HEADERS.join(', ') +
    '. Fix row 1 in the spreadsheet, or move existing data so row 1 can be replaced.'
  );
}

function appendProgramRegistrationRow_(sheet, p) {
  sheet.appendRow([
    new Date().toISOString(),
    String(p.telegram_update_id || ''),
    String(p.telegram_message_id || ''),
    String(p.status || ''),
    String(p.program_slug || ''),
    String(p.display_name || ''),
    String(p.description || ''),
    String(p.capabilities || ''),
    String(p.partner_organization || ''),
    String(p.website || ''),
    String(p.logo_url || ''),
    String(p.roster_sheet_url || ''),
    String(p.admin_subdomain || ''),
    String(p.currency || ''),
    String(p.ledger_codename || ''),
    String(p.price || ''),
    String(p.origin_identity || ''),
    String(p.submission_source || ''),
    String(p.error_message || '')
  ]);
}

/** Parse a `[PROGRAM REGISTRATION REQUEST]` body into a key→value map.
 *  Like parseDonationMintEventText_ but also folds indented continuation lines into the
 *  previous field, so multi-line values (e.g. Description) are preserved. */
function parseProgramRegistrationEventText_(text) {
  var result = {};
  if (!text) return result;
  var body = String(text).split('--------', 1)[0] || String(text);
  var lines = body.split(/\r?\n/);
  var lastKey = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] == null) continue;
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf(PROGRAM_REG_EVENT_TAG) === 0) continue;
    var isField = line.charAt(0) === '-';
    var probe = isField ? line.substring(1).trim() : line;
    var m = probe.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (m && isField) {
      var key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
      result[key] = m[2].trim();
      lastKey = key;
    } else if (lastKey) {
      // continuation of a multi-line value
      result[lastKey] = (result[lastKey] ? result[lastKey] + ' ' : '') + line;
    }
  }
  return result;
}

/** True only when the tag is the FIRST non-empty line of the message — i.e. a genuine
 *  `[PROGRAM REGISTRATION REQUEST]` event, not a contribution/other event that merely
 *  MENTIONS the tag in its description (Edgar routes by substring, so descriptions can
 *  legitimately contain bracketed tags). */
function isProgramRegistrationEvent_(message) {
  var lines = String(message || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    return t.indexOf(PROGRAM_REG_EVENT_TAG) === 0;
  }
  return false;
}

/** Treat the "(pending governor assignment)" placeholder as empty for storage. */
function programRegCleanValue_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\(pending governor assignment\)$/i.test(s) || /^n\/a$/i.test(s)) return '';
  return s;
}

/**
 * HTTP / time-driven entry point. Triggered by Edgar after every
 * `[PROGRAM REGISTRATION REQUEST]` submission, plus an hourly safety-net cron.
 */
function processProgramRegistrationsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processProgramRegistrationsFromTelegramChatLogs: another run in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    try {
      ensureProgramRegHourlyTriggerInstalled_();
    } catch (triggerErr) {
      Logger.log('ensureProgramRegHourlyTriggerInstalled_: ' +
        (triggerErr && triggerErr.message ? triggerErr.message : triggerErr) +
        ' — proceeding with scan; next run can retry.');
    }

    var ss = SpreadsheetApp.openById(PROGRAM_REG_TELEGRAM_SPREADSHEET_ID);
    var tcSheet = ss.getSheetByName(PROGRAM_REG_TELEGRAM_SHEET);
    if (!tcSheet) throw new Error('Telegram Chat Logs sheet not found');
    var prSheet = ensureProgramRegistrationsSheet_(ss);

    var prValues = prSheet.getDataRange().getValues();
    var seen = {};
    for (var r = 1; r < prValues.length; r++) {
      var existing = String(prValues[r][1] || '').trim();
      if (existing) seen[existing] = true;
    }

    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) return { success: true, recorded: 0, rejected: 0, errors: 0 };
    var startRow = Math.max(2, lastRow - PROGRAM_REG_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), PROGRAM_REG_TC_MESSAGE_COL + 1);
    var rows = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var recorded = 0, rejected = 0, errors = 0;

    for (var i = 0; i < rows.length; i++) {
      var message = String(rows[i][PROGRAM_REG_TC_MESSAGE_COL] || '');
      if (!isProgramRegistrationEvent_(message)) continue;

      var updateId = String(rows[i][PROGRAM_REG_TC_UPDATE_ID_COL] || '').trim();
      var messageId = String(rows[i][PROGRAM_REG_TC_MESSAGE_ID_COL] || '').trim();

      if (!updateId) {
        var subKey = 'NO_UPDATE_ID_ROW_' + (startRow + i);
        if (seen[subKey]) continue;
        appendProgramRegistrationRow_(prSheet, {
          telegram_update_id: subKey, telegram_message_id: messageId,
          status: 'REJECTED_NO_TELEGRAM_UPDATE_ID',
          error_message: 'Telegram Chat Logs row ' + (startRow + i) + ' has no Update ID column A'
        });
        seen[subKey] = true; rejected++; continue;
      }
      if (seen[updateId]) continue;

      try {
        var f = parseProgramRegistrationEventText_(message);
        var displayName = programRegCleanValue_(f.display_name);
        var base = {
          telegram_update_id: updateId,
          telegram_message_id: messageId,
          program_slug: programRegCleanValue_(f.program_slug),
          display_name: displayName,
          description: programRegCleanValue_(f.description),
          capabilities: programRegCleanValue_(f.capabilities),
          partner_organization: programRegCleanValue_(f.partner_organization),
          website: programRegCleanValue_(f.website),
          logo_url: programRegCleanValue_(f.logo_url),
          roster_sheet_url: programRegCleanValue_(f.roster_sheet_url),
          admin_subdomain: programRegCleanValue_(f.admin_subdomain),
          currency: programRegCleanValue_(f.currency),
          ledger_codename: programRegCleanValue_(f.ledger_codename),
          price: programRegCleanValue_(f.price),
          origin_identity: programRegCleanValue_(f.origin_identity),
          submission_source: programRegCleanValue_(f.submission_source)
        };

        if (!displayName) {
          base.status = 'REJECTED_MISSING_NAME';
          base.error_message = 'No Display Name in the [PROGRAM REGISTRATION REQUEST] payload.';
          appendProgramRegistrationRow_(prSheet, base);
          seen[updateId] = true; rejected++; continue;
        }

        base.status = 'PENDING';
        appendProgramRegistrationRow_(prSheet, base);
        seen[updateId] = true; recorded++;
      } catch (rowErr) {
        appendProgramRegistrationRow_(prSheet, {
          telegram_update_id: updateId, telegram_message_id: messageId,
          status: 'error',
          error_message: (rowErr && rowErr.message ? rowErr.message : String(rowErr))
        });
        seen[updateId] = true; errors++;
      }
    }

    return { success: true, recorded: recorded, rejected: rejected, errors: errors };
  } catch (err) {
    Logger.log('processProgramRegistrationsFromTelegramChatLogs error: ' + (err && err.message ? err.message : err));
    return { success: false, error: (err && err.message ? err.message : String(err)) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Read endpoint for the DApp review page + notification bell.
 * Returns { status:'success', data:{ pending_count, items:[…] } }.
 * `status` query param optionally filters (default PENDING).
 */
function getPendingProgramRegistrations(statusFilter) {
  try {
    var wanted = String(statusFilter || 'PENDING').trim().toUpperCase();
    var ss = SpreadsheetApp.openById(PROGRAM_REG_TELEGRAM_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PROGRAM_REG_SHEET);
    if (!sheet) return { status: 'success', data: { pending_count: 0, items: [] } };
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { status: 'success', data: { pending_count: 0, items: [] } };

    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });

    var items = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var st = String(row[idx['status']] || '').trim().toUpperCase();
      if (wanted !== 'ALL' && st !== wanted) continue;
      var name = String(row[idx['display_name']] || '').trim();
      items.push({
        registration_id: String(row[idx['telegram_update_id']] || ''),
        row: r + 1,
        status: String(row[idx['status']] || ''),
        submitted_date: String(row[idx['created_at_utc']] || ''),
        program_slug: String(row[idx['program_slug']] || ''),
        display_name: name,
        program_name: name, // alias for the notification source
        description: String(row[idx['description']] || ''),
        capabilities: String(row[idx['capabilities']] || ''),
        partner_organization: String(row[idx['partner_organization']] || ''),
        website: String(row[idx['website']] || ''),
        logo_url: String(row[idx['logo_url']] || ''),
        roster_sheet_url: String(row[idx['roster_sheet_url']] || ''),
        origin_identity: String(row[idx['origin_identity']] || ''),
        submission_source: String(row[idx['submission_source']] || '')
      });
    }
    // newest first
    items.sort(function (a, b) { return (a.submitted_date < b.submitted_date) ? 1 : -1; });
    return { status: 'success', data: { pending_count: items.length, items: items } };
  } catch (err) {
    return { status: 'error', message: (err && err.message ? err.message : String(err)) };
  }
}

/** Router shim — mirrors dispatchDonationMintAction_. */
function dispatchProgramRegistrationAction_(action) {
  if (action === 'processProgramRegistrationsFromTelegramChatLogs') {
    return processProgramRegistrationsFromTelegramChatLogs();
  }
  if (action === 'getPendingProgramRegistrations') {
    return getPendingProgramRegistrations();
  }
  return null;
}

/** Hourly safety-net cron — idempotent self-installer (mirrors donation-mint). */
function ensureProgramRegHourlyTriggerInstalled_() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'processProgramRegistrationsFromTelegramChatLogs') {
      return;
    }
  }
  ScriptApp.newTrigger('processProgramRegistrationsFromTelegramChatLogs')
    .timeBased().everyHours(1).create();
}
