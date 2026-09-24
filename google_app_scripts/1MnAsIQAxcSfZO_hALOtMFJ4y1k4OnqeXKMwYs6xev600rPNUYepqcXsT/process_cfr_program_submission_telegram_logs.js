/**
 * File: google_app_scripts/<scriptId>/process_cfr_program_submission_telegram_logs.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script project: 1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT
 *
 * Description: Async scanner that mirrors CFR-origin (Submission Source host
 *   `cfr.truesight.me`) tree-planting / growth-monitoring / plot-boundary
 *   submissions from the canonical Telegram Chat Logs intake into the PRIVATE,
 *   governor-only `cfr program` spreadsheet (CRF_ANAPU_SUNMINT_COHORT_PROPOSAL.md
 *   SS11.3 / SS11.5).
 *
 *   SS11.5 (Gary 2026-09-17): "CFR submissions should still follow the same route
 *   as SunMint.truesight submission routes. It is just that the DoGet triggered
 *   needs to also populate the private governor's accessible only sheet."
 *
 *   The PAYOUT half of SS11 was shipped (process_payout_registration_telegram_logs.js
 *   writes `payout registrations`). The tree-planting / monitoring / plot half of the
 *   four-tab schema was PROVISIONED (headers only, by provision_cfr_program_sheet.py)
 *   but had NO writer -- so `tree planting`, `tree monitoring`, `plot registrations`
 *   stayed permanently empty. This file is that writer (gap closed 2026-09-24).
 *
 *   Tabs written (SS11.3):
 *     [TREE PLANTING EVENT]           -> `tree planting`
 *     [TREE GROWTH MONITORING EVENT]  -> `tree monitoring`
 *     [FARM BOUNDARY EVIDENCE EVENT]  -> `plot registrations`
 *   The `payout registrations` tab is written ONLY by the sibling scanner; this
 *   file never touches it (and never touches `payout events`).
 *
 *   PRIVACY POSTURE -- privacy by LOCATION, not encryption (SS11.2): these events
 *   carry no raw PII. The only identity column is a DERIVED pk_hash (a one-way hash
 *   of the signer's public key, same derivation as the payout scanner and the
 *   credentialing endpoint), which is what lets a tree submission join to the
 *   student's later `[PAYOUT REGISTRATION]` row (SS11.1). The public intake workbook
 *   is READ ONLY -- it is publicly republished, so this scanner never writes back.
 *
 *   Idempotent: dedup keyed on Telegram Update ID (SS11.3). Serialized via
 *   LockService. A self-installing hourly safety-net cron catches anything a webhook
 *   missed. Sharing the global scope of its project, it REUSES
 *   payoutRegCfrProgramSpreadsheet_() / ensurePayoutRegistrationsSheet_ /
 *   ensurePayoutRegTab_ / PAYOUT_REG_TABS from
 *   process_payout_registration_telegram_logs.js rather than redeclaring them
 *   (a top-level `const` redeclared across files in one GAS project is a hard error).
 *
 *   Source-only: no clasp deploy, no live effect from this file merely existing.
 */

/** Canonical Telegram intake workbook -- READ ONLY (it is publicly republished). */
var CFRSUB_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var CFRSUB_TELEGRAM_SHEET = 'Telegram Chat Logs';

/** Telegram Chat Logs cols (zero-based) -- declared here so this file is self-contained. */
var CFRSUB_TC_UPDATE_ID_COL = 0;
var CFRSUB_TC_MESSAGE_ID_COL = 3;
var CFRSUB_TC_MESSAGE_COL = 6;

/** Per-fire scan window. Matches the payout-registration / program-registration scanners. */
var CFRSUB_SCAN_BATCH = 200;

/** Only submissions whose Submission Source host is THIS are mirrored (SS11.5 attribution). */
var CFRSUB_ORIGIN_HOST = 'cfr.truesight.me';

var CFRSUB_TREE_TAG = '[TREE PLANTING EVENT]';
var CFRSUB_MON_TAG = '[TREE GROWTH MONITORING EVENT]';
var CFRSUB_PLOT_TAG = '[FARM BOUNDARY EVIDENCE EVENT]';

/** The three private `cfr program` tabs this scanner writes (SS11.3). */
var CFRSUB_TREE_TAB = 'tree planting';
var CFRSUB_MON_TAB = 'tree monitoring';
var CFRSUB_PLOT_TAB = 'plot registrations';

/**
 * Normalise a `- Field: value` label into a canonical snake_case key, folding the
 * human-readable aliases a payload may use into the canonical names.
 */
function cfrSubNormKey_(key) {
  var k = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  var alias = {
    'measurement_time': 'measured_at',
    'measured_at': 'measured_at',
    'plot_id': 'plot_ref',
    'farm_name': 'farm_name',
    'extracted_gps': 'geometry_ref',
    'close_up_photo_url': 'photo_url',
    'photo_url': 'photo_url'
  };
  return alias[k] || k;
}

/**
 * Parse `- Field: value` lines plus the trailing `My Digital Signature:` /
 * `Request Transaction ID:` lines from a signed payload. Generic over field names;
 * mirrors parsePayoutRegistrationEventText_ in the sibling scanner.
 */
function cfrSubParseFields_(body) {
  var result = {};
  var lines = String(body || '').split(/\r?\n/);
  var lastKey = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] == null) continue;
    var line = lines[i].trim();
    if (!line) continue;
    // The payload terminator: STOP accumulating the previous field here, so the
    // trailing `My Digital Signature:` / `Request Transaction ID:` / footer prose
    // (which are NOT `- Field:` lines) are never folded into the last real field.
    if (line === '--------') { lastKey = null; continue; }
    var isField = line.charAt(0) === '-';
    var probe = isField ? line.substring(1).trim() : line;
    var m = probe.match(/^([A-Za-z][A-Za-z0-9_\s\/\-()]*):\s*(.*)$/);
    if (m && isField) {
      var key = cfrSubNormKey_(m[1]);
      result[key] = m[2].trim();
      lastKey = key;
    } else if (lastKey && !isField) {
      result[lastKey] = (result[lastKey] ? result[lastKey] + ' ' : '') + line;
    }
  }
  var sigMatch = String(body || '').match(/My Digital Signature:\s*([^\n]+)/i);
  result.public_signature = sigMatch ? sigMatch[1].trim() : '';
  var txMatch = String(body || '').match(/Request Transaction ID:\s*([^\n]+)/i);
  result.request_transaction_id = txMatch ? txMatch[1].trim() : '';
  return result;
}

/** The event tag: the first non-empty line's bracketed token, or '' when none. */
function cfrSubTag_(message) {
  var lines = String(message || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    if (t.charAt(0) !== '[') return '';
    var close = t.indexOf(']');
    return close > 0 ? t.substring(0, close + 1) : '';
  }
  return '';
}

/** Extract the host from a Submission Source value; '' when absent. */
function cfrSubOriginHost_(submissionSource) {
  var s = String(submissionSource || '').trim();
  if (!s) return '';
  var m = s.match(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/([^\/\s]+)/);
  if (!m) return s.split('/')[0].toLowerCase();
  return String(m[1]).toLowerCase().replace(/:\d+$/, '');
}

/** True only when this event is a CFR-origin submission (SS11.5 attribution). */
function cfrSubIsCfrOrigin_(fields) {
  return cfrSubOriginHost_(fields.submission_source) === CFRSUB_ORIGIN_HOST;
}

/** Trim, and treat the "(pending …)" / "N/A" placeholders as empty. */
function cfrSubCleanValue_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\(pending[^)]*\)$/i.test(s) || /^n\/a$/i.test(s)) return '';
  return s;
}

/**
 * Canonical pk-hash derivation -- MUST match the browser + Python + credentialing
 * implementations (paDerivePkHash in program_admin_endpoint.gs):
 *   pk-<hash> = 'pk-' + first 12 chars of base64url(SHA-256(base64-decoded pubkey bytes))
 * Returns '' on any error (never throws) so a malformed signature cannot break ingest.
 */
function cfrSubDerivePkHash_(publicKeyB64) {
  try {
    var key = String(publicKeyB64 || '').trim();
    if (!key) return '';
    var decoded = Utilities.base64Decode(key);
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, decoded);
    var b64 = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
    return 'pk-' + b64.substring(0, 12);
  } catch (e) {
    Logger.log('cfrSubDerivePkHash_ failed: ' + (e && e.message ? e.message : e));
    return '';
  }
}

/** Ensure the three tabs exist (idempotent, header-only) and return { tabName: sheet }. */
function cfrSubEnsureTabs_(cfr) {
  var map = {};
  var names = [CFRSUB_TREE_TAB, CFRSUB_MON_TAB, CFRSUB_PLOT_TAB];
  for (var i = 0; i < names.length; i++) {
    var headers = PAYOUT_REG_TABS[names[i]];
    map[names[i]] = ensurePayoutRegTab_(cfr, names[i], headers);
  }
  return map;
}

/** Read the processed Telegram update ids for one tab (dedup ledger). */
function cfrSubSeenUpdateIds_(sheet) {
  var seen = {};
  try {
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return seen;
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var col = header.indexOf('telegram_update_id');
    if (col < 0) return seen;
    for (var r = 1; r < values.length; r++) {
      var id = String(values[r][col] || '').trim();
      if (id) seen[id] = true;
    }
  } catch (e) {
    Logger.log('cfrSubSeenUpdateIds_ error: ' + (e && e.message ? e.message : e));
  }
  return seen;
}

/** Append a row in the exact SS11.3 `tree planting` column order. */
function appendCfrSubTreeRow_(sheet, p) {
  sheet.appendRow([
    new Date().toISOString(),
    String(p.telegram_update_id || ''),
    String(p.pk_hash || ''),
    String(p.tree_id || ''),
    String(p.species || ''),
    String(p.lat || ''),
    String(p.lng || ''),
    String(p.photo_url || ''),
    String(p.capture_source || ''),
    String(p.status || '')
  ]);
}

/** Append a row in the exact SS11.3 `tree monitoring` column order. */
function appendCfrSubMonRow_(sheet, p) {
  sheet.appendRow([
    new Date().toISOString(),
    String(p.telegram_update_id || ''),
    String(p.tree_id_qr || ''),
    String(p.species || ''),
    String(p.dbh_cm || ''),
    String(p.co2e_kg || ''),
    String(p.measured_at || ''),
    String(p.photo_url || ''),
    String(p.status || '')
  ]);
}

/** Append a row in the exact SS11.3 `plot registrations` column order. */
function appendCfrSubPlotRow_(sheet, p) {
  sheet.appendRow([
    new Date().toISOString(),
    String(p.telegram_update_id || ''),
    String(p.pk_hash || ''),
    String(p.plot_ref || ''),
    String(p.geometry_ref || ''),
    String(p.captured_at || ''),
    String(p.status || '')
  ]);
}

/**
 * Build the tab-specific row payload from the parsed fields. Returns null when the
 * event does not map to one of the three CFR tabs.
 */
function cfrSubBuildRow_(tab, updateId, fields) {
  var pkHash = cfrSubDerivePkHash_(fields.public_signature);
  if (tab === CFRSUB_TREE_TAB) {
    return {
      tab: tab, updateId: updateId, append: appendCfrSubTreeRow_,
      data: {
        telegram_update_id: updateId,
        pk_hash: pkHash,
        // tree_id: SSR today the per-tree identity IS the intake Telegram update id
        // (build_tree_geojson.py keys the public index on the same value).
        tree_id: updateId,
        species: cfrSubCleanValue_(fields.species),
        lat: cfrSubCleanValue_(fields.latitude),
        lng: cfrSubCleanValue_(fields.longitude),
        photo_url: cfrSubCleanValue_(fields.photo_url),
        capture_source: cfrSubCleanValue_(fields.submission_source),
        status: 'RECORDED'
      }
    };
  }
  if (tab === CFRSUB_MON_TAB) {
    return {
      tab: tab, updateId: updateId, append: appendCfrSubMonRow_,
      data: {
        telegram_update_id: updateId,
        tree_id_qr: cfrSubCleanValue_(fields.tree_id),
        species: cfrSubCleanValue_(fields.species),
        dbh_cm: cfrSubCleanValue_(fields.dbh_cm),
        // co2e_kg is not in the submission payload (derived later from DBH); left blank.
        co2e_kg: cfrSubCleanValue_(fields.co2e_kg),
        measured_at: cfrSubCleanValue_(fields.measured_at),
        photo_url: cfrSubCleanValue_(fields.photo_url || fields.close_up_photo_url),
        status: 'RECORDED'
      }
    };
  }
  if (tab === CFRSUB_PLOT_TAB) {
    return {
      tab: tab, updateId: updateId, append: appendCfrSubPlotRow_,
      data: {
        telegram_update_id: updateId,
        pk_hash: pkHash,
        plot_ref: cfrSubCleanValue_(fields.plot_ref || fields.farm_name),
        geometry_ref: cfrSubCleanValue_(fields.geometry_ref),
        captured_at: cfrSubCleanValue_(fields.captured_at),
        status: 'RECORDED'
      }
    };
  }
  return null;
}

/**
 * HTTP / time-driven entry point. Triggered by Edgar after a CFR-origin tree /
 * monitoring / plot submission lands on Telegram Chat Logs, plus an hourly
 * safety-net cron. Mirrors processPayoutRegistrationsFromTelegramChatLogs().
 */
function processCfrProgramSubmissionsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processCfrProgramSubmissionsFromTelegramChatLogs: another run in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    try {
      ensureCfrSubHourlyTriggerInstalled_();
    } catch (triggerErr) {
      Logger.log('ensureCfrSubHourlyTriggerInstalled_: ' +
        (triggerErr && triggerErr.message ? triggerErr.message : triggerErr) + ' - proceeding with scan.');
    }

    // Intake: canonical Telegram Chat Logs (read-only; publicly republished).
    var intake = SpreadsheetApp.openById(CFRSUB_TELEGRAM_SPREADSHEET_ID);
    var tcSheet = intake.getSheetByName(CFRSUB_TELEGRAM_SHEET);
    if (!tcSheet) throw new Error('Telegram Chat Logs sheet not found');

    // Output: the private, governor-only `cfr program` spreadsheet (SS11.2/SS11.3).
    var cfr = payoutRegCfrProgramSpreadsheet_();
    var tabs = cfrSubEnsureTabs_(cfr);

    var seen = {};
    seen[CFRSUB_TREE_TAB] = cfrSubSeenUpdateIds_(tabs[CFRSUB_TREE_TAB]);
    seen[CFRSUB_MON_TAB] = cfrSubSeenUpdateIds_(tabs[CFRSUB_MON_TAB]);
    seen[CFRSUB_PLOT_TAB] = cfrSubSeenUpdateIds_(tabs[CFRSUB_PLOT_TAB]);

    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) return { success: true, recorded: 0, skipped: 0, errors: 0 };
    var startRow = Math.max(2, lastRow - CFRSUB_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), CFRSUB_TC_MESSAGE_COL + 1);
    var rows = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var recorded = 0, skipped = 0, errors = 0;

    for (var i = 0; i < rows.length; i++) {
      var message = String(rows[i][CFRSUB_TC_MESSAGE_COL] || '');
      var tag = cfrSubTag_(message);
      var tab = '';
      if (tag === CFRSUB_TREE_TAG) tab = CFRSUB_TREE_TAB;
      else if (tag === CFRSUB_MON_TAG) tab = CFRSUB_MON_TAB;
      else if (tag === CFRSUB_PLOT_TAG) tab = CFRSUB_PLOT_TAB;
      if (!tab) continue;  // not one of the three CFR event families

      var updateId = String(rows[i][CFRSUB_TC_UPDATE_ID_COL] || '').trim();
      if (!updateId) { skipped++; continue; }
      if (seen[tab][updateId]) continue;  // dedup: never process the same record twice

      try {
        var fields = cfrSubParseFields_(message);
        // Attribution gate (SS11.5): only submissions that came through cfr.truesight.me.
        if (!cfrSubIsCfrOrigin_(fields)) { seen[tab][updateId] = true; skipped++; continue; }

        var built = cfrSubBuildRow_(tab, updateId, fields);
        if (!built) { skipped++; continue; }
        built.append(tabs[tab], built.data);
        seen[tab][updateId] = true;
        recorded++;
      } catch (rowErr) {
        Logger.log('processCfrProgramSubmissionsFromTelegramChatLogs row error: ' +
          (rowErr && rowErr.message ? rowErr.message : rowErr));
        errors++;
      }
    }

    return { success: true, recorded: recorded, skipped: skipped, errors: errors };
  } catch (err) {
    Logger.log('processCfrProgramSubmissionsFromTelegramChatLogs error: ' +
      (err && err.message ? err.message : err));
    return { success: false, error: (err && err.message ? err.message : String(err)) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function ensureCfrSubHourlyTriggerInstalled_() {
  var fn = 'processCfrProgramSubmissionsFromTelegramChatLogs';
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === fn) return;
  }
  ScriptApp.newTrigger(fn).timeBased().everyHours(1).create();
}
