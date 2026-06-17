/**
 * File: google_app_scripts/find_nearby_stores/process_retail_field_reports_telegram_logs.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/edit
 *
 * Description: Async scanner for `[RETAIL FIELD REPORT EVENT]` rows on the canonical
 *   **Telegram Chat Logs** intake (`1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ`).
 *
 *   Edgar (`sentiment_importer/app/controllers/dao_controller.rb#submit_contribution`)
 *   writes the signed payload into Telegram Chat Logs col G, uploads the attachment
 *   to GitHub at the deterministic blob URL embedded in the payload, then enqueues a
 *   webhook to this script (`?action=processRetailFieldReportsFromTelegramChatLogs`).
 *
 *   For each Telegram log row whose `Update ID` (SFR_…) is not yet present in
 *   **Stores Visits Field Reports** col G on the Hit List workbook, this scanner:
 *     1. Calls `updateStoreStatus(...)` (Hit List Status / DApp Remarks).
 *     2. Appends one row A–N to **Stores Visits Field Reports** — col L `github_blob_url`
 *        and col M `github_raw_url` are the addresses of the blob Edgar uploaded.
 *     3. Copies the URLs onto the matching DApp Remarks row via
 *        `linkFieldReportUrlsToDappRemarks_`.
 *
 *   The append in step 2 also serves as the dedup log for future runs (idempotent).
 *
 *   Browsers cannot reliably issue cross-origin POSTs to GAS web apps, so the DApp
 *   only POSTs the signed event to Edgar. Everything sheet-side happens here.
 *
 * Mirror canonicalization status (2026-04-27):
 *   No thematic folder exists for the rest of `find_nearby_stores`. The other
 *   functions (`updateStoreStatus`, `appendStoresVisitsFieldReportRow_`,
 *   `linkFieldReportUrlsToDappRemarks_`, `ensureStoresVisitsFieldReportsSheet_`,
 *   `doGet`) currently live only in the local mirror
 *   `tokenomics/clasp_mirrors/1NpHrKJW…/Code.js` (gitignored). When this file is
 *   `cp`ed into that mirror alongside Code.js, clasp pushes both. Adding a
 *   `?action=processRetailFieldReportsFromTelegramChatLogs` branch to the mirror's
 *   `doGet` is a one-time edit — see the README in this folder.
 *
 *   Sync command (run from `tokenomics/`):
 *     cp google_app_scripts/find_nearby_stores/process_retail_field_reports_telegram_logs.gs \
 *        clasp_mirrors/1NpHrKJW8Q4suu6-f5gXQcbjHqUZtGOG-KcIf81M1GG8lDShm5-fLphD2/process_retail_field_reports_telegram_logs.js
 */

/** Telegram Chat Logs intake spreadsheet (Edgar writes col G of every signed event here). */
var TELEGRAM_CHAT_LOGS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var TELEGRAM_CHAT_LOGS_SHEET = 'Telegram Chat Logs';
/** Telegram Chat Logs col G (zero-based 6) — signed event text Edgar wrote. */
var TELEGRAM_CHAT_LOGS_MESSAGE_COL = 6;
/** Per-fire scan window. Cron safety-net picks up older rows if it ever falls behind. */
var RETAIL_FIELD_REPORT_SCAN_BATCH = 200;

/**
 * Parse a `[RETAIL FIELD REPORT EVENT]` body into a key→value map. Mirrors the Ruby
 * parser in `dao_controller.rb#parse_retail_field_report` (stops at the `--------`
 * signature separator; lowercases + snake-cases the label). Use this only for the
 * fields **before** the separator; `My Digital Signature:` lives after.
 * @param {string} text
 * @return {Object<string,string>}
 */
function parseRetailFieldReportText_(text) {
  var result = {};
  if (!text) return result;
  var body = String(text).split('--------', 1)[0] || String(text);
  var lines = body.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = (lines[i] || '').trim();
    if (!line) continue;
    if (line.indexOf('[RETAIL FIELD REPORT EVENT]') === 0) continue;
    // Bullet prefix from dao_client's `build_share_text` — `- Label: Value`.
    // The DApp's older `buildRetailFieldReportText` builds without the bullet,
    // so we strip defensively to support both clients. (Patched 2026-04-28
    // when the new dao_client `update_store` module landed and surfaced the
    // gap — same logic the sibling store-add parser already had.)
    if (line.charAt(0) === '-') line = line.substring(1).trim();
    var m = line.match(/^([A-Za-z][A-Za-z0-9_\s\/\-]*):\s*(.*)$/);
    if (!m) continue;
    var key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    result[key] = m[2].trim();
  }
  return result;
}

/**
 * Pull the contributor public key from the signed payload. Lives after `--------`
 * so the body parser intentionally skips it.
 * @param {string} text
 * @return {string}
 */
function extractMyDigitalSignatureFromText_(text) {
  if (!text) return '';
  var m = String(text).match(/My Digital Signature:\s*([^\n\r]+)/);
  return m ? m[1].trim() : '';
}

/**
 * Strip the GitHub blob prefix to recover the repo-relative path
 * (`store_visits_field_reports/<store-key>/<update_id>/01_<filename>`).
 * @param {string} blobUrl
 * @return {string}
 */
function deriveGithubPathFromBlobUrl_(blobUrl) {
  if (!blobUrl) return '';
  return String(blobUrl).replace(
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\//,
    ''
  );
}

/**
 * HTTP / time-driven entry point. Triggered from Edgar after every
 * `[RETAIL FIELD REPORT EVENT]` submission, plus a safety-net cron for retries.
 *
 * Idempotent: dedup is keyed on `Update ID` (col G) of **Stores Visits Field Reports**.
 * Re-runs over the same Telegram log rows skip already-recorded `update_id`s.
 *
 * Serialized via `LockService.getScriptLock()` so concurrent webhook fires cannot
 * race when reading/writing the dedup set.
 *
 * @return {{success:boolean, processed?:number, skipped?:number, errors?:number, error?:string}}
 */
function processRetailFieldReportsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(180000)) {
    Logger.log('processRetailFieldReportsFromTelegramChatLogs: another run is in progress; skipping.');
    return { success: false, error: 'busy' };
  }
  try {
    var tcSpreadsheet = SpreadsheetApp.openById(TELEGRAM_CHAT_LOGS_SPREADSHEET_ID);
    var tcSheet = tcSpreadsheet.getSheetByName(TELEGRAM_CHAT_LOGS_SHEET);
    if (!tcSheet) {
      throw new Error('Telegram Chat Logs sheet "' + TELEGRAM_CHAT_LOGS_SHEET + '" not found');
    }

    var hitListSpreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    var reportsSheet = ensureStoresVisitsFieldReportsSheet_(hitListSpreadsheet);

    // Build dedup set from existing **Stores Visits Field Reports** col G (`update_id`).
    var reportsValues = reportsSheet.getDataRange().getValues();
    var seenUpdateIds = {};
    for (var r = 1; r < reportsValues.length; r++) {
      var existingId = String(reportsValues[r][6] || '').trim();
      if (existingId) seenUpdateIds[existingId] = true;
    }

    // Scan the trailing window of Telegram Chat Logs for new RETAIL FIELD REPORT events.
    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, processed: 0, skipped: 0, errors: 0 };
    }
    var startRow = Math.max(2, lastRow - RETAIL_FIELD_REPORT_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), TELEGRAM_CHAT_LOGS_MESSAGE_COL + 1);
    var tcRange = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var processed = 0;
    var skipped = 0;
    var errors = 0;
    for (var i = 0; i < tcRange.length; i++) {
      var message = String(tcRange[i][TELEGRAM_CHAT_LOGS_MESSAGE_COL] || '');
      if (message.indexOf('[RETAIL FIELD REPORT EVENT]') === -1) continue;

      var fields = parseRetailFieldReportText_(message);
      var updateId = String(fields.update_id || '').trim();
      if (!updateId) {
        Logger.log('Skipping retail field report at Telegram row ' + (startRow + i) + ': no Update ID.');
        skipped++;
        continue;
      }
      if (seenUpdateIds[updateId]) {
        skipped++;
        continue;
      }

      var shopName = String(fields.shop_name || '').trim();
      var newStatus = String(fields.new_status || '').trim();
      if (!shopName || !newStatus) {
        Logger.log('Retail field report ' + updateId + ': missing shop_name or new_status; skipping.');
        skipped++;
        continue;
      }

      var digitalSignature = extractMyDigitalSignatureFromText_(message);
      var submittedBy =
        digitalSignature ||
        String(fields.my_digital_signature || fields.digital_signature || '').trim();

      try {
        // 1. Hit List Status + DApp Remarks (existing function in find_nearby_stores Code.js).
        updateStoreStatus(
          shopName,
          newStatus,
          digitalSignature,
          String(fields.remarks || ''),
          submittedBy,
          String(fields.shop_type || ''),
          String(fields.instagram || ''),
          String(fields.owner_name || ''),
          String(fields.contact_person || ''),
          String(fields.email || ''),
          String(fields.cell_phone || ''),
          String(fields.phone || ''),
          String(fields.website || ''),
          String(fields.follow_up_date || ''),
          String(fields.visit_date || ''),
          String(fields.contact_date || ''),
          String(fields.contact_method || ''),
          updateId,
          String(fields.deferred_until || '')
        );

        // 2. Stores Visits Field Reports A–N — also the dedup record for future runs.
        var blobUrl = String(fields.attachment_github_url || '').trim();
        var rawUrl = String(fields.attachment_raw_url || '').trim();
        var githubPath = deriveGithubPathFromBlobUrl_(blobUrl);
        appendStoresVisitsFieldReportRow_({
          shop_name: shopName,
          store_key: String(fields.store_key || ''),
          email: String(fields.email || ''),
          hit_list_row: '',
          update_id: updateId,
          digital_signature: submittedBy,
          filename_original: String(fields.attachment_filename || ''),
          mime_type: String(fields.attachment_mime_type || ''),
          github_path: githubPath,
          github_blob_url: blobUrl,
          github_raw_url: rawUrl || blobUrl,
          remarks: String(fields.remarks || '').slice(0, 2000)
        });

        // 3. Copy URLs onto the matching DApp Remarks row (no-op when no match).
        linkFieldReportUrlsToDappRemarks_(
          hitListSpreadsheet,
          updateId,
          submittedBy,
          rawUrl || blobUrl,
          blobUrl || rawUrl
        );

        seenUpdateIds[updateId] = true;
        processed++;
      } catch (rowErr) {
        errors++;
        Logger.log('Retail field report ' + updateId + ' failed: ' + rowErr);
      }
    }

    Logger.log(
      'processRetailFieldReportsFromTelegramChatLogs: processed=' +
        processed +
        ' skipped=' +
        skipped +
        ' errors=' +
        errors +
        ' window=' +
        startRow +
        '-' +
        lastRow
    );
    return { success: true, processed: processed, skipped: skipped, errors: errors };
  } finally {
    lock.releaseLock();
  }
}
