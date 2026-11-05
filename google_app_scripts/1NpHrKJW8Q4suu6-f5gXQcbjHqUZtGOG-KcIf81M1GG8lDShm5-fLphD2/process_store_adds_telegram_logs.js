/**
 * File: google_app_scripts/find_nearby_stores/process_store_adds_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/edit
 *
 * Description: Async scanner for `[STORE ADD EVENT]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   Edgar (`sentiment_importer/app/controllers/dao_controller.rb#submit_contribution`)
 *   writes the signed payload into Telegram Chat Logs col G, then enqueues a
 *   webhook to this script (`?action=processStoreAddsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose **Telegram Update ID** (col A) is not yet
 *   present on the **Store Adds** dedup-log tab (col B), this scanner:
 *     1. Parses the signed event body for shop_name / address / city / state /
 *        shop_type / website / instagram / phone / email / referred_by / notes /
 *        status (default `Research`) and the contributor's public key.
 *     2. Calls existing `addNewStore(...)` on the Hit List workbook
 *        (`1eiqZr3LW-…`). GAS already dedups case-insensitively on
 *        `(shop_name + address + city + state)` and returns
 *        `{success: false, duplicate: true, existing_store: …}` when the
 *        store already exists — that response is preserved as `status:
 *        duplicate` on Store Adds.
 *     3. Appends one audit row A–O to **Store Adds**
 *        (`1qbZZhf-…`, gid 1208101506) regardless of outcome (added /
 *        duplicate / error / skipped). The append is what guarantees
 *        idempotency: future runs see the Telegram Update ID in col B and
 *        skip it.
 *
 *   Browsers cannot reliably issue cross-origin POSTs to GAS web apps, so AI
 *   agents and signed contributors only POST to Edgar. Everything sheet-side
 *   happens here. The existing `dapp/stores_nearby.html` Add Store form still
 *   talks directly to the GAS `add_store` action (small GET payload, no
 *   cross-origin failure) and is intentionally untouched in this slice — a
 *   separate follow-up migrates that form onto the Edgar path.
 *
 * Mirror canonicalization status (2026-04-28):
 *   Same partial-canonical state as `process_retail_field_reports_telegram_logs.gs`
 *   (sibling file). The dependency this scanner has on `addNewStore()` lives only
 *   in the gitignored mirror `clasp_mirrors/1NpHrKJW…/Code.js`. Clasp combines
 *   all `.js` / `.gs` in the mirror at deploy time so the dependency resolves.
 *   The shared helper `extractMyDigitalSignatureFromText_` is declared in the
 *   sibling retail field report scanner (do not redeclare here — clasp would
 *   reject duplicate function definitions).
 *
 *   Sync command (run from `tokenomics/`):
 *     cp google_app_scripts/find_nearby_stores/process_store_adds_telegram_logs.gs \
 *        clasp_mirrors/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/process_store_adds_telegram_logs.js
 */

/** Telegram Chat Logs col A (zero-based 0) — Telegram update id (string), used as dedup key. */
var TELEGRAM_CHAT_LOGS_UPDATE_ID_COL = 0;
/** Telegram Chat Logs col D (zero-based 3) — Telegram message id, kept as a cross-reference. */
var TELEGRAM_CHAT_LOGS_MESSAGE_ID_COL = 3;
/** Same workbook as Telegram Chat Logs — Store Adds tab is a sibling, not on the Hit List workbook. */
var STORE_ADDS_SHEET = 'Store Adds';
/** Per-fire scan window for store-add events. Cron safety-net picks up older rows if it ever falls behind. */
var STORE_ADD_SCAN_BATCH = 200;

/**
 * Canonical headers for the **Store Adds** tab. The tab lives on the Telegram
 * compilation workbook (sibling to Telegram Chat Logs) so the dedup record sits
 * next to the source data — the inverse of where Stores Visits Field Reports
 * lives (Hit List workbook), but the same dual-purpose pattern: data sink AND
 * "this Telegram row has been processed" marker.
 *
 * Schema (15 cols):
 *   A: created_at_utc           ISO 8601 timestamp the scanner ran.
 *   B: telegram_update_id       Dedup key (col A on Telegram Chat Logs).
 *   C: telegram_message_id      Cross-reference (col D on Telegram Chat Logs).
 *   D: status                   `added` / `duplicate` / `error` / `skipped_no_update_id`.
 *   E: shop_name                Parsed from `[STORE ADD EVENT]` body.
 *   F: address
 *   G: city
 *   H: state
 *   I: shop_type
 *   J: hit_list_row             Row number on the Hit List sheet for `added`;
 *                               existing row number for `duplicate`.
 *   K: existing_store_shop_name Filled when `status = duplicate` so the audit
 *                               trail captures *which* row collided.
 *   L: submitted_by             Public key (SPKI b64) from `My Digital Signature:`.
 *   M: referred_by              Provenance — warm-lead chain (e.g. "Psychic Sister").
 *   N: notes                    Free-form remark from the event body.
 *   O: error_message            When `status = error`, what blew up.
 */
var STORE_ADDS_HEADERS = [
  'created_at_utc',
  'telegram_update_id',
  'telegram_message_id',
  'status',
  'shop_name',
  'address',
  'city',
  'state',
  'shop_type',
  'hit_list_row',
  'existing_store_shop_name',
  'submitted_by',
  'referred_by',
  'notes',
  'error_message'
];

/** Telegram-compilation-workbook handle on the Store Adds tab; create + header on first use. */
function ensureStoreAddsSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(STORE_ADDS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(STORE_ADDS_SHEET);
    sheet.appendRow(STORE_ADDS_HEADERS);
    return sheet;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), STORE_ADDS_HEADERS.length);
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row1Blank = firstRow.every(function (cell) {
    return String(cell || '').trim() === '';
  });
  if (lastRow === 0 || row1Blank) {
    sheet.getRange(1, 1, 1, STORE_ADDS_HEADERS.length).setValues([STORE_ADDS_HEADERS]);
    return sheet;
  }
  var matches = STORE_ADDS_HEADERS.every(function (h, i) {
    return String(firstRow[i] || '').trim() === h;
  });
  if (matches) return sheet;
  if (lastRow <= 1) {
    sheet.getRange(1, 1, 1, STORE_ADDS_HEADERS.length).setValues([STORE_ADDS_HEADERS]);
    return sheet;
  }
  // Headers don't match and there's data below — refuse to silently corrupt.
  // Operator must reconcile manually before the next run will succeed.
  throw new Error(
    'Sheet "' + STORE_ADDS_SHEET + '" row 1 must be exactly: ' +
    STORE_ADDS_HEADERS.join(', ') +
    '. Fix row 1 in the spreadsheet, or move existing data so row 1 can be replaced.'
  );
}

/**
 * Parse a `[STORE ADD EVENT]` body into a key→value map. Same shape as
 * `parseRetailFieldReportText_`: stops at the `--------` signature separator,
 * lowercases + snake-cases the label.
 * @param {string} text
 * @return {Object<string,string>}
 */
function parseStoreAddEventText_(text) {
  var result = {};
  if (!text) return result;
  var body = String(text).split('--------', 1)[0] || String(text);
  var lines = body.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = (lines[i] || '').trim();
    if (!line) continue;
    if (line.indexOf('[STORE ADD EVENT]') === 0) continue;
    // Bullet prefix from build_share_text — `- Label: Value`
    if (line.charAt(0) === '-') line = line.substring(1).trim();
    var m = line.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (!m) continue;
    var key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    result[key] = m[2].trim();
  }
  return result;
}

/**
 * Build the full Hit List Notes string by concatenating `referred_by` provenance
 * and free-form `notes`. Mirrors `addNewStore`'s expectation that `remarks` is a
 * single field; we collapse the two so warm-lead chains are searchable on Hit
 * List `Notes`.
 * @param {Object} fields
 * @return {string}
 */
function buildHitListRemarks_(fields) {
  var out = [];
  var referred = (fields.referred_by || '').trim();
  var notes = (fields.notes || '').trim();
  if (referred) out.push('Referred by ' + referred);
  if (notes) out.push(notes);
  return out.join(' — ');
}

/** Append one row to Store Adds. Schema-aligned with STORE_ADDS_HEADERS. */
function appendStoreAddRow_(sheet, params) {
  var row = [
    new Date().toISOString(),
    String(params.telegram_update_id || ''),
    String(params.telegram_message_id || ''),
    String(params.status || ''),
    String(params.shop_name || ''),
    String(params.address || ''),
    String(params.city || ''),
    String(params.state || ''),
    String(params.shop_type || ''),
    params.hit_list_row != null ? String(params.hit_list_row) : '',
    String(params.existing_store_shop_name || ''),
    String(params.submitted_by || ''),
    String(params.referred_by || ''),
    String(params.notes || ''),
    String(params.error_message || '')
  ];
  sheet.appendRow(row);
}

/**
 * HTTP / time-driven entry point. Triggered from Edgar after every
 * `[STORE ADD EVENT]` submission, plus a safety-net cron for retries.
 *
 * Idempotent: dedup is keyed on Telegram Update ID (col A on Telegram Chat
 * Logs, col B on Store Adds). Re-runs over the same Telegram rows skip
 * already-recorded update ids. Serialized via `LockService.getScriptLock()`
 * so concurrent webhook fires cannot race when reading/writing the dedup set.
 *
 * @return {{success:boolean, processed?:number, duplicates?:number, errors?:number, skipped?:number, error?:string}}
 */
function processStoreAddsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processStoreAddsFromTelegramChatLogs: another run is in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    var telegramSpreadsheet = SpreadsheetApp.openById(TELEGRAM_CHAT_LOGS_SPREADSHEET_ID);
    var tcSheet = telegramSpreadsheet.getSheetByName(TELEGRAM_CHAT_LOGS_SHEET);
    if (!tcSheet) {
      throw new Error('Telegram Chat Logs sheet "' + TELEGRAM_CHAT_LOGS_SHEET + '" not found');
    }
    var storeAddsSheet = ensureStoreAddsSheet_(telegramSpreadsheet);

    // Build dedup set from existing Store Adds col B (telegram_update_id).
    var addsValues = storeAddsSheet.getDataRange().getValues();
    var seenUpdateIds = {};
    for (var r = 1; r < addsValues.length; r++) {
      var existing = String(addsValues[r][1] || '').trim();
      if (existing) seenUpdateIds[existing] = true;
    }

    // Scan trailing window of Telegram Chat Logs for new STORE ADD events.
    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, processed: 0, duplicates: 0, errors: 0, skipped: 0 };
    }
    var startRow = Math.max(2, lastRow - STORE_ADD_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), TELEGRAM_CHAT_LOGS_MESSAGE_COL + 1);
    var tcRange = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var processed = 0;
    var duplicates = 0;
    var errors = 0;
    var skipped = 0;

    for (var i = 0; i < tcRange.length; i++) {
      var message = String(tcRange[i][TELEGRAM_CHAT_LOGS_MESSAGE_COL] || '');
      if (message.indexOf('[STORE ADD EVENT]') === -1) continue;

      var telegramUpdateId = String(tcRange[i][TELEGRAM_CHAT_LOGS_UPDATE_ID_COL] || '').trim();
      var telegramMessageId = String(tcRange[i][TELEGRAM_CHAT_LOGS_MESSAGE_ID_COL] || '').trim();

      if (!telegramUpdateId) {
        // No update id on this row — record an audit line so future runs don't
        // keep parsing the same row, but mark it skipped. Use the row index as
        // a stable substitute key so the dedup set still recognises it next time.
        var rowSubstituteKey = 'NO_UPDATE_ID_ROW_' + (startRow + i);
        if (seenUpdateIds[rowSubstituteKey]) continue;
        appendStoreAddRow_(storeAddsSheet, {
          telegram_update_id: rowSubstituteKey,
          telegram_message_id: telegramMessageId,
          status: 'skipped_no_update_id',
          error_message: 'Telegram Chat Logs row ' + (startRow + i) + ' has no Update ID column A'
        });
        seenUpdateIds[rowSubstituteKey] = true;
        skipped++;
        continue;
      }

      if (seenUpdateIds[telegramUpdateId]) continue;

      var fields = parseStoreAddEventText_(message);
      var shopName = String(fields.shop_name || '').trim();
      var address = String(fields.address || '').trim();
      var city = String(fields.city || '').trim();
      var state = String(fields.state || '').trim();
      var shopType = String(fields.shop_type || '').trim();
      var status = String(fields.status || '').trim() || 'Research';
      var submittedBy = extractMyDigitalSignatureFromText_(message);

      if (!shopName) {
        appendStoreAddRow_(storeAddsSheet, {
          telegram_update_id: telegramUpdateId,
          telegram_message_id: telegramMessageId,
          status: 'error',
          submitted_by: submittedBy,
          error_message: 'Missing required field: shop_name'
        });
        seenUpdateIds[telegramUpdateId] = true;
        errors++;
        continue;
      }
      if (!address && !city && !state) {
        // GAS createStoreKey_ refuses without one of these; record + skip.
        appendStoreAddRow_(storeAddsSheet, {
          telegram_update_id: telegramUpdateId,
          telegram_message_id: telegramMessageId,
          status: 'error',
          shop_name: shopName,
          submitted_by: submittedBy,
          error_message: 'At least one of address / city / state is required (createStoreKey_ rejects otherwise)'
        });
        seenUpdateIds[telegramUpdateId] = true;
        errors++;
        continue;
      }

      try {
        var storeData = {
          shopName: shopName,
          address: address,
          city: city,
          state: state,
          shopType: shopType,
          status: status,
          phone: String(fields.phone || '').trim(),
          email: String(fields.email || '').trim(),
          website: String(fields.website || '').trim(),
          instagram: String(fields.instagram || '').trim(),
          contactDate: '',
          contactMethod: '',
          remarks: buildHitListRemarks_(fields),
          submittedBy: submittedBy
        };
        var result = addNewStore(storeData);

        if (result && result.success) {
          appendStoreAddRow_(storeAddsSheet, {
            telegram_update_id: telegramUpdateId,
            telegram_message_id: telegramMessageId,
            status: 'added',
            shop_name: shopName,
            address: address,
            city: city,
            state: state,
            shop_type: shopType,
            // addNewStore doesn't currently return the row number; leave blank.
            // The Hit List has the new row at the bottom and `submission_id`
            // (returned by addNewStore) is on `DApp Remarks` if needed.
            hit_list_row: '',
            submitted_by: submittedBy,
            referred_by: String(fields.referred_by || '').trim(),
            notes: String(fields.notes || '').trim()
          });
          seenUpdateIds[telegramUpdateId] = true;
          processed++;
        } else if (result && result.duplicate) {
          var existing = result.existingStore || {};
          appendStoreAddRow_(storeAddsSheet, {
            telegram_update_id: telegramUpdateId,
            telegram_message_id: telegramMessageId,
            status: 'duplicate',
            shop_name: shopName,
            address: address,
            city: city,
            state: state,
            shop_type: shopType,
            hit_list_row: existing.rowNumber || '',
            existing_store_shop_name: existing.shopName || '',
            submitted_by: submittedBy,
            referred_by: String(fields.referred_by || '').trim(),
            notes: String(fields.notes || '').trim()
          });
          seenUpdateIds[telegramUpdateId] = true;
          duplicates++;
        } else {
          var msg = (result && (result.error || result.message)) || 'addNewStore returned non-success';
          appendStoreAddRow_(storeAddsSheet, {
            telegram_update_id: telegramUpdateId,
            telegram_message_id: telegramMessageId,
            status: 'error',
            shop_name: shopName,
            address: address,
            city: city,
            state: state,
            shop_type: shopType,
            submitted_by: submittedBy,
            referred_by: String(fields.referred_by || '').trim(),
            notes: String(fields.notes || '').trim(),
            error_message: msg
          });
          seenUpdateIds[telegramUpdateId] = true;
          errors++;
        }
      } catch (rowErr) {
        appendStoreAddRow_(storeAddsSheet, {
          telegram_update_id: telegramUpdateId,
          telegram_message_id: telegramMessageId,
          status: 'error',
          shop_name: shopName,
          submitted_by: submittedBy,
          error_message: String(rowErr && (rowErr.message || rowErr))
        });
        seenUpdateIds[telegramUpdateId] = true;
        errors++;
      }
    }

    Logger.log(
      'processStoreAddsFromTelegramChatLogs: processed=' + processed +
      ' duplicates=' + duplicates + ' errors=' + errors + ' skipped=' + skipped +
      ' window=' + startRow + '-' + lastRow
    );
    return {
      success: true,
      processed: processed,
      duplicates: duplicates,
      errors: errors,
      skipped: skipped
    };
  } finally {
    lock.releaseLock();
  }
}
