/**
 * practice_event_processing.gs — Edgar event processor for [PRACTICE EVENT]
 *
 * Mirrors the pattern in tdg_asset_management/currency_conversion_processing.gs
 * (which is the most recently hardened of the Edgar GAS processors — see the
 * 2026-05-11 Kirsten incident write-up baked into its defensive guards).
 *
 * Pipeline:
 *   sentiment_importer → Telegram Chat Logs row appended with a
 *   [PRACTICE EVENT] payload
 *       ↓ webhook (Edgar's trigger_immediate_processing) → doGet() here
 *   1. parsePracticeEvent() — line-anchored regex per field. Tab/space-tolerant.
 *   2. derivePkSlug() — SHA-256 of the base64-decoded public key, base64url,
 *      first 12 chars, prefixed pk-. MUST match the browser's slug derivation
 *      in capoeira/assets/js/practice-event-submit.js (publicKeyToSlug).
 *   3. fetchProgramManifest() — pulls programs/<program>/manifest.json from
 *      lineage-credentials raw.githubusercontent.com (no auth needed; public).
 *   4. Validate practice_type is declared in manifest.practice_types.
 *   5. Append an intake row to the 'Credentialing Events' tab on the
 *      Telegram & Submissions sheet (1qbZZhf-...). Same shape as the
 *      Currency Conversion intake tab.
 *   6. PUT the event JSON to lineage-credentials via GitHub Contents API
 *      at programs/<program>/<slug>/practice/<ts>.json. The commit SHA goes
 *      into the audit row so the chain Telegram → Sheet → repo is traceable.
 *   7. Defensive guards: appendRow + flush + assert getLastRow grew (silent
 *      noop → throw to FAILED). GitHub Contents API errors → FAILED. Status
 *      is only ever set to PROCESSED after the commit succeeds.
 *
 * Required Script Property:
 *   TRUESIGHT_CREDENTIALING_PAT — a PAT with 'contents:write' on TrueSightDAO/lineage-credentials.
 *                  Set via Apps Script project → Project Settings → Script Properties.
 *
 * Edgar config (sentiment_importer/config/application.rb):
 *   config.credentialing_processing_webhook_url =
 *     'https://script.google.com/macros/s/<deployment>/exec?action=parseAndProcessCredentialingLogs'
 *
 * Design doc: agentic_ai_context/CREDENTIALING_PLATFORM.md
 */

// ============================================================================
// CONFIG
// ============================================================================

// Telegram & Submissions spreadsheet (same one the other Edgar processors read).
const CRED_TELEGRAM_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit';
const CRED_TELEGRAM_TAB = 'Telegram Chat Logs';

// New intake tab — auto-created on first run if missing.
const CRED_INTAKE_TAB = 'Credentialing Events';
const CRED_INTAKE_HEADERS = [
  'Telegram Update ID',          // A
  'Telegram Message ID',         // B
  'Raw Message',                 // C
  'Reporter Name',               // D
  'Event Type',                  // E  e.g. PRACTICE
  'Program',                     // F
  'Practice Type',               // G
  'Practitioner Public Key',     // H
  'Practitioner Name',           // I  (optional)
  'Slug',                        // J  pk-<hash>
  'Captured At',                 // K
  'Source URL',                  // L
  'Payload JSON',                // M
  'Status',                      // N
  'GitHub Commit SHA',           // O
  'GitHub Commit URL',           // P
  'Processed At',                // Q
];

// Telegram Chat Logs columns we read. Layout matches the canonical
// constants used in tdg_asset_management/capital_injection_processing.gs:
//   col 0  Update ID
//   col 1  Chatroom ID
//   col 2  Chatroom Name
//   col 3  Message ID
//   col 4  Reporter / Contributor Name
//   col 5  (reserved)
//   col 6  Message body  ← we were reading col 2 here, which is the chatroom
//                          name ("Edgar Direct"), so [PRACTICE EVENT] never
//                          matched and processing silently no-op'd.
const TCL_UPDATE_ID_COL  = 0;
const TCL_MESSAGE_ID_COL = 3;
const TCL_MESSAGE_COL    = 6;
const TCL_REPORTER_COL   = 4;

// Lineage-credentials repo coordinates.
const LC_OWNER = 'TrueSightDAO';
const LC_REPO  = 'lineage-credentials';
const LC_BRANCH = 'main';
const LC_MANIFEST_URL_FMT = 'https://raw.githubusercontent.com/' + LC_OWNER + '/' + LC_REPO + '/' + LC_BRANCH + '/programs/{program}/manifest.json';
const LC_CONTENTS_API_FMT = 'https://api.github.com/repos/' + LC_OWNER + '/' + LC_REPO + '/contents/{path}';

// ============================================================================
// PARSER — [PRACTICE EVENT] payload
// ============================================================================

/**
 * Parse a [PRACTICE EVENT] body. Field regexes use [ \t]* (not \s*) so empty
 * values don't slurp the newline + the following line — same defensive
 * pattern as the post-2026-05-11 currency_conversion_processing.gs fix.
 *
 * Returns null if this isn't a [PRACTICE EVENT] payload.
 */
function parsePracticeEvent(message) {
  if (!message || message.indexOf('[PRACTICE EVENT]') < 0) return null;

  function field(name, pattern) {
    var re = new RegExp('- ' + name + ':' + (pattern || '[ \\t]*([^\\n]*)'), 'i');
    var m = message.match(re);
    return m ? m[1].trim() : '';
  }

  // Payload JSON is multi-line. Primary path: match between '- Payload JSON:'
  // and the '\n--------' end-of-event sentinel. Tolerant of CRLF + 3+ dashes
  // (some Edgar forwarders normalize the separator differently).
  var payloadJson = '';
  var payloadMatch = message.match(/- Payload JSON:[ \t]*\r?\n([\s\S]*?)\r?\n-{3,}/);
  if (payloadMatch) payloadJson = payloadMatch[1].trim();

  // Fallback: if the separator regex misses (the production failure mode
  // observed on capoeira-tribo-mirim pk-4LBWHX9DJ_wH on 2026-05-16: col M
  // landed empty despite col C having the full payload), parse a balanced
  // JSON object starting at the first '{' after '- Payload JSON:'. This
  // doesn't depend on the trailing sentinel format at all — survives any
  // future change to how Edgar appends signature blocks.
  if (!payloadJson) {
    var headerIdx = message.indexOf('- Payload JSON:');
    if (headerIdx >= 0) {
      var jsonStart = message.indexOf('{', headerIdx);
      if (jsonStart >= 0) {
        var depth = 0;
        var inString = false;
        var escape = false;
        var jsonEnd = -1;
        for (var i = jsonStart; i < message.length; i++) {
          var ch = message.charAt(i);
          if (escape) { escape = false; continue; }
          if (ch === '\\') { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) { jsonEnd = i + 1; break; }
          }
        }
        if (jsonEnd > jsonStart) {
          payloadJson = message.substring(jsonStart, jsonEnd).trim();
          Logger.log('[parsePracticeEvent] payload extracted via balanced-brace fallback (len=' + payloadJson.length + ')');
        }
      }
    }
  }

  if (!payloadJson) {
    Logger.log('[parsePracticeEvent] could not extract Payload JSON; message head: ' + message.substring(0, 240).replace(/\n/g, '\\n'));
  }

  var sigMatch    = message.match(/My Digital Signature:[ \t]*([^\n]*)/i);
  var txIdMatch   = message.match(/Request Transaction ID:[ \t]*([^\n]*)/i);

  return {
    program: field('Program'),
    practiceType: field('Practice Type'),
    practitionerPublicKey: field('Practitioner Public Key'),
    practitionerName: field('Practitioner Name'),
    capturedAt: field('Captured At'),
    sourceUrl: field('Source URL'),
    payloadJson: payloadJson,
    digitalSignature: sigMatch ? sigMatch[1].trim() : '',
    requestTransactionId: txIdMatch ? txIdMatch[1].trim() : '',
  };
}

// ============================================================================
// SLUG — must match capoeira/assets/js/practice-event-submit.js
// ============================================================================

/**
 * slug = "pk-" + base64url(SHA-256(base64-decoded public-key bytes)).slice(0, 12)
 * 12 base64url chars = 72 bits of collision resistance, ample for the
 * practitioner population.
 */
function derivePkSlug(publicKeyBase64) {
  if (!publicKeyBase64) throw new Error('derivePkSlug: empty public key');
  var keyBytes = Utilities.base64Decode(publicKeyBase64);
  var hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, keyBytes);
  var b64 = Utilities.base64Encode(hashBytes);
  var b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'pk-' + b64url.slice(0, 12);
}

// ============================================================================
// MANIFEST FETCH — lineage-credentials/programs/<program>/manifest.json
// ============================================================================

function fetchProgramManifest(program) {
  var url = LC_MANIFEST_URL_FMT.replace('{program}', encodeURIComponent(program));
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = resp.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) {
    throw new Error('Manifest fetch failed (' + code + '): ' + resp.getContentText().slice(0, 200));
  }
  return JSON.parse(resp.getContentText());
}

// ============================================================================
// INTAKE SHEET — Credentialing Events tab
// ============================================================================

function getIntakeSheet() {
  var ss = SpreadsheetApp.openByUrl(CRED_TELEGRAM_SHEET_URL);
  var sheet = ss.getSheetByName(CRED_INTAKE_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CRED_INTAKE_TAB);
    sheet.appendRow(CRED_INTAKE_HEADERS);
    sheet.setFrozenRows(1);
  } else {
    // Ensure headers in case the tab was created manually.
    var firstRow = sheet.getRange(1, 1, 1, CRED_INTAKE_HEADERS.length).getValues()[0];
    var needs = false;
    for (var i = 0; i < CRED_INTAKE_HEADERS.length; i++) {
      if (firstRow[i] !== CRED_INTAKE_HEADERS[i]) { needs = true; break; }
    }
    if (needs) sheet.getRange(1, 1, 1, CRED_INTAKE_HEADERS.length).setValues([CRED_INTAKE_HEADERS]);
  }
  return sheet;
}

/**
 * Defensive append — captures lastRow before/after to guarantee the row
 * actually landed before we declare PROCESSED.
 */
function appendIntakeRow(sheet, row) {
  var before = sheet.getLastRow();
  sheet.appendRow(row);
  SpreadsheetApp.flush();
  var after = sheet.getLastRow();
  if (after <= before) {
    throw new Error('appendRow did not grow ' + CRED_INTAKE_TAB + ' — lastRow stayed at ' + before + '.');
  }
  return after;
}

function setIntakeRowStatus(sheet, rowNumber, status, commitSha, commitUrl) {
  var statusCol = CRED_INTAKE_HEADERS.indexOf('Status') + 1;
  var shaCol = CRED_INTAKE_HEADERS.indexOf('GitHub Commit SHA') + 1;
  var urlCol = CRED_INTAKE_HEADERS.indexOf('GitHub Commit URL') + 1;
  var procCol = CRED_INTAKE_HEADERS.indexOf('Processed At') + 1;
  sheet.getRange(rowNumber, statusCol).setValue(status);
  if (commitSha) sheet.getRange(rowNumber, shaCol).setValue(commitSha);
  if (commitUrl) sheet.getRange(rowNumber, urlCol).setValue(commitUrl);
  sheet.getRange(rowNumber, procCol).setValue(new Date().toISOString());
}

// ============================================================================
// LINEAGE-CREDENTIALS COMMIT
// ============================================================================

function getGithubToken() {
  var token = PropertiesService.getScriptProperties().getProperty('TRUESIGHT_CREDENTIALING_PAT');
  if (!token) {
    throw new Error('TRUESIGHT_CREDENTIALING_PAT script property is not set. Add a PAT with contents:write on TrueSightDAO/lineage-credentials.');
  }
  return token;
}

/**
 * Build a stable event filename: <isoDateZ>-<requestHashFirst10>.json. The
 * request hash makes the path collision-resistant even if two sessions land
 * with the same captured_at, and using the same hash everywhere keeps the
 * audit row → repo file linkage tight.
 */
function buildEventFilename(capturedAt, requestTransactionId) {
  var safeIso = (capturedAt || new Date().toISOString()).replace(/[:.]/g, '');
  // request_transaction_id is base64 — sanitize for filesystem use.
  var shortSig = (requestTransactionId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'nosig';
  return safeIso + '-' + shortSig + '.json';
}

/**
 * Commit a single event JSON to lineage-credentials via the GitHub Contents API.
 * Returns { sha, html_url } on success; throws on any non-2xx.
 */
function commitPracticeEvent(program, slug, filename, content) {
  var path = 'programs/' + program + '/' + slug + '/practice/' + filename;
  var url = LC_CONTENTS_API_FMT.replace('{path}', path);
  var body = {
    message: 'practice event: ' + program + ' ' + slug + ' ' + filename,
    branch: LC_BRANCH,
    content: Utilities.base64Encode(content),
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + getGithubToken(),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tdg-credentialing-processing/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var txt = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub Contents API ' + code + ': ' + txt.slice(0, 300));
  }
  var json = JSON.parse(txt);
  return {
    sha: json.commit && json.commit.sha,
    html_url: json.content && json.content.html_url,
  };
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

/**
 * Scan the Telegram Chat Logs tab for [PRACTICE EVENT] rows that haven't
 * been ingested into the Credentialing Events intake tab yet, and process
 * each one. Idempotent — the dedup key is (Telegram Update ID,
 * Telegram Message ID), which we look up against the intake tab.
 */
function parseAndProcessCredentialingLogs() {
  var telegramSheet = SpreadsheetApp.openByUrl(CRED_TELEGRAM_SHEET_URL).getSheetByName(CRED_TELEGRAM_TAB);
  if (!telegramSheet) {
    Logger.log('❌ Telegram Chat Logs tab not found on ' + CRED_TELEGRAM_SHEET_URL);
    return;
  }
  var intake = getIntakeSheet();

  var alreadyIngested = {};
  if (intake.getLastRow() > 1) {
    var keys = intake.getRange(2, 1, intake.getLastRow() - 1, 2).getValues();
    keys.forEach(function (r) { alreadyIngested[r[0] + '|' + r[1]] = true; });
  }

  var data = telegramSheet.getDataRange().getValues();
  var newRows = 0;
  var failedRows = 0;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var message = (row[TCL_MESSAGE_COL] || '').toString();
    if (message.indexOf('[PRACTICE EVENT]') < 0) continue;
    var key = row[TCL_UPDATE_ID_COL] + '|' + row[TCL_MESSAGE_ID_COL];
    if (alreadyIngested[key]) continue;

    try {
      processOnePracticeEvent(intake, row, message);
      newRows++;
    } catch (e) {
      Logger.log('❌ Error processing row ' + (i + 1) + ': ' + e.message);
      // Still register the row with FAILED status so we don't loop forever.
      try {
        var rn = appendIntakeRow(intake, [
          row[TCL_UPDATE_ID_COL], row[TCL_MESSAGE_ID_COL], message,
          row[TCL_REPORTER_COL] || '', 'PRACTICE', '', '', '', '', '', '', '', '', '', '', '', '',
        ]);
        setIntakeRowStatus(intake, rn, 'FAILED: ' + e.message.slice(0, 150), '', '');
      } catch (e2) {
        Logger.log('   (also failed to write FAILED row: ' + e2.message + ')');
      }
      failedRows++;
    }
  }
  Logger.log('📊 Credentialing parse: ' + newRows + ' new, ' + failedRows + ' failed');
}

function processOnePracticeEvent(intake, telegramRow, message) {
  var parsed = parsePracticeEvent(message);
  if (!parsed) throw new Error('Could not parse [PRACTICE EVENT] body');
  if (!parsed.program) throw new Error('Missing Program field');
  if (!parsed.practiceType) throw new Error('Missing Practice Type field');
  if (!parsed.practitionerPublicKey) throw new Error('Missing Practitioner Public Key');

  var manifest = fetchProgramManifest(parsed.program);
  if (!manifest) throw new Error('Unknown program: ' + parsed.program);
  if (!manifest.practice_types || !manifest.practice_types[parsed.practiceType]) {
    throw new Error('Practice Type "' + parsed.practiceType + '" not declared in manifest for program ' + parsed.program);
  }

  var slug = derivePkSlug(parsed.practitionerPublicKey);

  // Write the intake row first (PENDING), then commit to repo, then flip to PROCESSED.
  var rowValues = [
    telegramRow[TCL_UPDATE_ID_COL],
    telegramRow[TCL_MESSAGE_ID_COL],
    message,
    telegramRow[TCL_REPORTER_COL] || parsed.practitionerName || '',
    'PRACTICE',
    parsed.program,
    parsed.practiceType,
    parsed.practitionerPublicKey,
    parsed.practitionerName,
    slug,
    parsed.capturedAt,
    parsed.sourceUrl,
    parsed.payloadJson,
    'PENDING',
    '', '', '',
  ];
  var rowNumber = appendIntakeRow(intake, rowValues);

  // Build the event-file content. Stored verbatim — readers can verify the
  // signature against the raw text + Request Transaction ID.
  var eventFile = {
    program: parsed.program,
    practice_type: parsed.practiceType,
    practitioner_public_key: parsed.practitionerPublicKey,
    practitioner_name: parsed.practitionerName,
    slug: slug,
    captured_at: parsed.capturedAt,
    source_url: parsed.sourceUrl,
    payload: tryParseJson(parsed.payloadJson),
    raw_payload_json: parsed.payloadJson,
    digital_signature: parsed.digitalSignature,
    request_transaction_id: parsed.requestTransactionId,
    intake: {
      telegram_update_id: String(telegramRow[TCL_UPDATE_ID_COL] || ''),
      telegram_message_id: String(telegramRow[TCL_MESSAGE_ID_COL] || ''),
      processed_at: new Date().toISOString(),
    },
  };
  var filename = buildEventFilename(parsed.capturedAt, parsed.requestTransactionId);
  var commit = commitPracticeEvent(parsed.program, slug, filename, JSON.stringify(eventFile, null, 2));

  setIntakeRowStatus(intake, rowNumber, 'PROCESSED', commit.sha || '', commit.html_url || '');
  Logger.log('✅ Processed practice event for slug ' + slug + ' commit ' + (commit.sha || '(no sha)'));
}

function tryParseJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ============================================================================
// TRIGGERS + WEBHOOK
// ============================================================================

function installTimeTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'parseAndProcessCredentialingLogs') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  ScriptApp.newTrigger('parseAndProcessCredentialingLogs')
    .timeBased()
    .everyMinutes(10)
    .create();
  return { removed_existing: removed, installed: 1, cadence_minutes: 10 };
}

function listTriggers() {
  return ScriptApp.getProjectTriggers().map(function (t) {
    return { handler: t.getHandlerFunction(), eventType: String(t.getEventType()), uniqueId: t.getUniqueId() };
  });
}

/**
 * doGet — webhook entry. Triggered by Edgar's trigger_immediate_processing
 * branch for [PRACTICE EVENT] submissions, so processing happens in seconds
 * instead of waiting for the 10-min cron.
 *
 * URL shape:
 *   https://script.google.com/macros/s/<deployment>/exec?action=parseAndProcessCredentialingLogs
 *   https://script.google.com/macros/s/<deployment>/exec?action=installTimeTrigger
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  Logger.log('doGet called with action: ' + (action || 'none'));

  if (action === 'parseAndProcessCredentialingLogs') {
    try {
      parseAndProcessCredentialingLogs();
      return ContentService.createTextOutput('✅ Credentialing logs processed.').setMimeType(ContentService.MimeType.TEXT);
    } catch (err) {
      Logger.log('❌ ' + err.message);
      return ContentService.createTextOutput('❌ Error: ' + err.message).setMimeType(ContentService.MimeType.TEXT);
    }
  }

  if (action === 'installTimeTrigger') {
    return ContentService.createTextOutput(JSON.stringify(installTimeTrigger(), null, 2)).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput('practice_event_processing.gs — ready. Actions: parseAndProcessCredentialingLogs, installTimeTrigger').setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================================
// BACKFILL — re-parse + re-commit existing PROCESSED rows that have empty
// Payload JSON (col M). Required after fixing the parser bug observed on
// 2026-05-16 where capoeira-tribo-mirim rows landed with col M empty AND
// committed-to-repo `payload: null` — which made the cache builder report
// total_practice_minutes = 0 on the CV.
// ============================================================================

/**
 * Backfill a single row by row number (1-indexed including the header row).
 * Re-parses col C, fills col M, and re-commits the event file in
 * lineage-credentials with the corrected `payload` + `raw_payload_json`.
 *
 * Operator usage from the IDE:
 *   reprocessCredentialingRow(5);   // row 5 (first practice for pk-4LBWHX9DJ_wH)
 *   reprocessCredentialingRow(6);   // row 6 (second practice)
 *
 * Idempotent: re-running for the same row just overwrites the existing
 * event file with the same content + advances Processed At.
 */
function reprocessCredentialingRow(rowNumber) {
  var intake = getIntakeSheet();
  if (!intake) throw new Error('Credentialing Events sheet not found');
  if (rowNumber < 2) throw new Error('rowNumber must be >= 2 (row 1 is the header)');

  var lastCol = CRED_INTAKE_HEADERS.length;
  var rowValues = intake.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
  var message = String(rowValues[2] || '');  // col C = Raw Message
  if (!message) throw new Error('Row ' + rowNumber + ' has empty Raw Message (col C)');

  var parsed = parsePracticeEvent(message);
  if (!parsed) throw new Error('Row ' + rowNumber + ' is not a [PRACTICE EVENT] payload');

  // Always update col M (Payload JSON) — this is the fix the parser missed before.
  intake.getRange(rowNumber, CRED_INTAKE_HEADERS.indexOf('Payload JSON') + 1).setValue(parsed.payloadJson || '');

  // Re-build + re-commit the event file with the proper payload populated.
  var slug = derivePkSlug(parsed.practitionerPublicKey);
  var eventFile = {
    program: parsed.program,
    practice_type: parsed.practiceType,
    practitioner_public_key: parsed.practitionerPublicKey,
    practitioner_name: parsed.practitionerName,
    slug: slug,
    captured_at: parsed.capturedAt,
    source_url: parsed.sourceUrl,
    payload: tryParseJson(parsed.payloadJson),
    raw_payload_json: parsed.payloadJson,
    digital_signature: parsed.digitalSignature,
    request_transaction_id: parsed.requestTransactionId,
    intake: {
      telegram_update_id: String(rowValues[0] || ''),
      telegram_message_id: String(rowValues[1] || ''),
      processed_at: new Date().toISOString(),
      reprocessed: true,
    },
  };
  var filename = buildEventFilename(parsed.capturedAt, parsed.requestTransactionId);
  var commit = commitPracticeEvent(parsed.program, slug, filename, JSON.stringify(eventFile, null, 2));

  setIntakeRowStatus(intake, rowNumber, 'PROCESSED', commit.sha || '', commit.html_url || '');
  Logger.log('🔁 Reprocessed row ' + rowNumber + ' → slug=' + slug + ' commit=' + (commit.sha || '(no sha)'));
  return { ok: true, rowNumber: rowNumber, slug: slug, commit_sha: commit.sha, payload_len: (parsed.payloadJson || '').length };
}

/**
 * Backfill every PROCESSED row that has an empty Payload JSON column. Use
 * this once after pulling the parser fix to retroactively fill in missed
 * payloads from any pre-fix events.
 */
function reprocessAllRowsWithEmptyPayload() {
  var intake = getIntakeSheet();
  if (!intake) throw new Error('Credentialing Events sheet not found');
  var lastRow = intake.getLastRow();
  if (lastRow < 2) { Logger.log('No data rows to reprocess.'); return; }

  var lastCol = CRED_INTAKE_HEADERS.length;
  var values = intake.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var payloadColIdx = CRED_INTAKE_HEADERS.indexOf('Payload JSON');
  var statusColIdx = CRED_INTAKE_HEADERS.indexOf('Status');

  var reprocessed = 0, skipped = 0, errors = 0;
  for (var i = 0; i < values.length; i++) {
    var rowNumber = i + 2;
    var status = String(values[i][statusColIdx] || '');
    var payload = String(values[i][payloadColIdx] || '');
    if (status.indexOf('PROCESSED') !== 0) { skipped++; continue; }
    if (payload) { skipped++; continue; }
    try {
      reprocessCredentialingRow(rowNumber);
      reprocessed++;
    } catch (e) {
      Logger.log('Row ' + rowNumber + ' reprocess error: ' + e.message);
      errors++;
    }
  }
  Logger.log('🔁 Backfill done: reprocessed=' + reprocessed + ' skipped=' + skipped + ' errors=' + errors);
  return { reprocessed: reprocessed, skipped: skipped, errors: errors };
}
