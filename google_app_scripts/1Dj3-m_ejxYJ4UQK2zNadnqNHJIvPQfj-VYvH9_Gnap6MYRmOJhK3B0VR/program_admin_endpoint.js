/**
 * program_admin_endpoint.gs — central credentialing endpoint for ALL programs.
 *
 * Two responsibilities:
 *
 *   1. HTTP API (doGet) — serves the admin panels of every program.
 *      ?action=list_sheet_editors&sheet_url=<URL>
 *           → returns editor emails for any sheet the tokenomics SA can read.
 *           Used by program admin panels (butterfly-effect-club.truesight.me, etc.)
 *           for runtime trust resolution. Trust circle = sheet editors.
 *
 *      ?action=list_pending_rows&sheet_url=<URL>&tab=<tab>
 *           → returns rows where 'status' column ∉ {processed, certificate_issued}.
 *           Used by panels to render the attestation queue.
 *
 *      ?action=resolve_admin&sheet_url=<URL>&email=<email>
 *           → boolean check: is this email among the sheet's editors?
 *
 *   2. Edgar webhook handler — processes [CREDENTIALING ATTESTATION EVENT]
 *      from Telegram Chat Logs for every Tier-1 cohort-credentialing program.
 *      ?action=process_attestation_events
 *           Called by Edgar after a signed event lands on Telegram Chat Logs.
 *           Scans the trailing N rows for matches, dedups via Telegram Update ID,
 *           verifies attestor authority (signer in roster editor list),
 *           commits identity.json + attestations/<ts>.json to lineage-credentials,
 *           back-fills the source sheet (audit columns) + appends Audit Trail row.
 *
 * Design doc: github.com/TrueSightDAO/butterfly-effect-club/blob/main/PROPOSAL.md (v4 architecture)
 *
 * Required Script Property:
 *   TRUESIGHT_CREDENTIALING_PAT — GitHub PAT with contents:write on TrueSightDAO/lineage-credentials.
 *
 * Edgar config (sentiment_importer/config/application.rb):
 *   config.credentialing_attestation_webhook_url =
 *     'https://script.google.com/macros/s/<deployment>/exec?action=process_attestation_events'
 *
 * Pattern mirrors practice_event_processing.gs (same project) with the v4
 * adjustments: handler resolves trust via list_sheet_editors instead of a
 * static program manifest list.
 */

// ============================================================================
// CONFIG
// ============================================================================

const PA_TELEGRAM_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit';
const PA_TELEGRAM_TAB = 'Telegram Chat Logs';

const PA_INTAKE_TAB = 'Credentialing Attestation Events';
const PA_INTAKE_HEADERS = [
  'Telegram Update ID',     // A
  'Telegram Message ID',    // B
  'Raw Message',            // C
  'Program',                // D
  'Attestation Type',       // E
  'Attestor Public Key',    // F
  'Attestor Name',          // G
  'Attestor Email',         // H (resolved at processing time)
  'Attestee Public Key',    // I
  'Attestee Name',          // J
  'Attestee Slug',          // K — pk-<hash>
  'Captured At',            // L
  'Program Year',           // M
  'Roster Source URL',      // N
  'Roster Source Row',      // O
  'Config URL',             // P
  'Source URL',             // Q
  'Payload JSON',           // R
  'Status',                 // S — PENDING / PROCESSED / FAILED / REJECTED
  'GitHub Commit SHA',      // T
  'Error',                  // U
  'Processed At',           // V
];

const PA_LINEAGE_REPO_OWNER = 'TrueSightDAO';
const PA_LINEAGE_REPO_NAME = 'lineage-credentials';
const PA_GITHUB_API_BASE = 'https://api.github.com';
const PA_SCAN_LOOKBACK_ROWS = 200;

// ============================================================================
// PAYLOAD PARSING
// ============================================================================

/**
 * Parse a [CREDENTIALING ATTESTATION EVENT] message body into a structured object.
 * Returns null if the message doesn't look like an attestation event.
 *
 * Tab/space-tolerant regex; line-anchored per field. Same defensive pattern
 * as practice_event_processing.gs.
 */
function paParseAttestationEvent(message) {
  if (!message || typeof message !== 'string') return null;
  if (message.indexOf('[CREDENTIALING ATTESTATION EVENT]') === -1) return null;

  function extract(label) {
    const re = new RegExp('^-\\s*' + label + ':[ \\t]*([^\\n]*)', 'mi');
    const m = message.match(re);
    return m ? m[1].trim() : '';
  }

  function extractBlock(label) {
    // Multi-line block (e.g., "Payload JSON: { ... }") — capture until next "- " line or end.
    const re = new RegExp('^-\\s*' + label + ':[ \\t]*([\\s\\S]*?)(?=\\n-\\s|\\n\\n|$)', 'mi');
    const m = message.match(re);
    return m ? m[1].trim() : '';
  }

  const program = extract('Program');
  const attestationType = extract('Attestation Type');
  const attestorPubKey = extract('Attestor Public Key');
  const attestorName = extract('Attestor Name');
  const attesteePubKey = extract('Attestee Public Key');
  const attesteeName = extract('Attestee Name');
  const capturedAt = extract('Captured At');
  const programYear = extract('Program Year');
  const rosterUrl = extract('Roster Source URL');
  const rosterRow = extract('Roster Source Row');
  const configUrl = extract('Config URL');
  const schemaUrl = extract('Schema URL');
  const sourceUrl = extract('Source URL');
  const payloadJson = extractBlock('Payload JSON');

  // Extract the trailing signature + transaction ID lines that Edgar appended.
  const sigMatch = message.match(/My Digital Signature:\s*([^\n]+)/);
  const txIdMatch = message.match(/Request Transaction ID:\s*([^\n]+)/);

  if (!program || !attestorPubKey || !attesteePubKey || !attesteeName) {
    return null;
  }

  return {
    program: program,
    attestationType: attestationType || 'program-completion',
    attestorPubKey: attestorPubKey,
    attestorName: attestorName,
    attesteePubKey: attesteePubKey,
    attesteeName: attesteeName,
    capturedAt: capturedAt,
    programYear: programYear,
    rosterUrl: rosterUrl,
    rosterRow: parseInt(rosterRow || '0', 10) || 0,
    configUrl: configUrl,
    schemaUrl: schemaUrl,
    sourceUrl: sourceUrl,
    payloadJson: payloadJson,
    signature: sigMatch ? sigMatch[1].trim() : '',
    txId: txIdMatch ? txIdMatch[1].trim() : '',
  };
}

/**
 * Canonical pk-hash derivation — MUST match the browser + Python implementations.
 *   pk-<hash> = 'pk-' + first 12 chars of base64url(SHA-256(base64-decoded pubkey bytes))
 */
function paDerivePkHash(publicKeyB64) {
  const decoded = Utilities.base64Decode(publicKeyB64);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, decoded);
  const b64 = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
  return 'pk-' + b64.substring(0, 12);
}

// ============================================================================
// SHEET HELPERS
// ============================================================================

function paExtractSheetId(sheetUrl) {
  if (!sheetUrl) return '';
  const m = String(sheetUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function paListSheetEditors(sheetUrl) {
  const id = paExtractSheetId(sheetUrl);
  if (!id) throw new Error('Could not extract sheet ID from URL: ' + sheetUrl);
  const file = DriveApp.getFileById(id);
  const editors = file.getEditors().map(function (u) { return u.getEmail(); });
  const owner = file.getOwner();
  const ownerEmail = owner ? owner.getEmail() : null;
  const all = ownerEmail ? [ownerEmail].concat(editors) : editors;
  // dedup + drop blanks
  const seen = {};
  const out = [];
  all.forEach(function (e) {
    const key = String(e || '').toLowerCase();
    if (key && !seen[key]) { seen[key] = 1; out.push(e); }
  });
  return out;
}

function paIsEditor(sheetUrl, email) {
  if (!email) return false;
  const editors = paListSheetEditors(sheetUrl);
  const target = String(email).toLowerCase();
  return editors.some(function (e) { return String(e).toLowerCase() === target; });
}

function paGetSheet(sheetUrl, tabName) {
  const id = paExtractSheetId(sheetUrl);
  if (!id) throw new Error('Could not extract sheet ID: ' + sheetUrl);
  const book = SpreadsheetApp.openById(id);
  const sheet = book.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab not found: ' + tabName + ' on sheet ' + id);
  return sheet;
}

/**
 * Returns array of objects keyed by header label (case-insensitive).
 * Includes the 1-indexed sheet row number under `_row`.
 */
function paReadSheetAsObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { headers: values[0] || [], rows: [] };
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = { _row: i + 1 };
    headers.forEach(function (h, j) {
      obj[h] = values[i][j];
    });
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function paListPendingRows(sheetUrl, tabName) {
  const sheet = paGetSheet(sheetUrl, tabName || 'Cohort Roster');
  const { headers, rows } = paReadSheetAsObjects(sheet);
  const pending = rows.filter(function (r) {
    const status = String(r.status || r.Status || '').toLowerCase();
    return status !== 'processed' && status !== 'certificate_issued';
  });
  return { headers: headers, rows: pending };
}

// ============================================================================
// HTTP API — combined dispatcher for ALL actions from both files
// ============================================================================

/**
 * Combined doGet — routes actions from both practice_event_processing.gs and
 * program_admin_endpoint.gs. This is the single entry point for the web app.
 *
 * Actions from practice_event_processing.gs:
 *   ?action=parseAndProcessCredentialingLogs
 *   ?action=installTimeTrigger
 *   ?action=reprocessAllRowsWithEmptyPayload[&force=1]
 *   ?action=reprocessCredentialingRow&row=N
 *
 * Actions from program_admin_endpoint.gs:
 *   ?action=list_sheet_editors&sheet_url=<URL>
 *   ?action=list_pending_rows&sheet_url=<URL>&tab=<tab>
 *   ?action=resolve_admin&sheet_url=<URL>&email=<email>
 *   ?action=process_attestation_events
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  Logger.log('doGet called with action: ' + (action || 'none'));

  try {
    // --- practice_event_processing.gs actions ---
    if (action === 'parseAndProcessCredentialingLogs') {
      parseAndProcessCredentialingLogs();
      return ContentService.createTextOutput('✅ Credentialing logs processed.').setMimeType(ContentService.MimeType.TEXT);
    }

    if (action === 'installTimeTrigger') {
      return ContentService.createTextOutput(JSON.stringify(installTimeTrigger(), null, 2)).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'reprocessAllRowsWithEmptyPayload') {
      const force = String((e && e.parameter && e.parameter.force) || '') === '1';
      const summary = reprocessAllRowsWithEmptyPayload({ force: force });
      return ContentService.createTextOutput(JSON.stringify(summary, null, 2)).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'reprocessCredentialingRow') {
      const rowParam = (e && e.parameter && e.parameter.row) || '';
      const rowNumber = parseInt(rowParam, 10);
      if (!rowNumber || rowNumber < 2) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Missing or invalid &row=N (N must be >= 2)' })).setMimeType(ContentService.MimeType.JSON);
      }
      const result = reprocessCredentialingRow(rowNumber);
      return ContentService.createTextOutput(JSON.stringify(result, null, 2)).setMimeType(ContentService.MimeType.JSON);
    }

    // --- program_admin_endpoint.gs actions ---
    if (action === 'list_sheet_editors') {
      const sheetUrl = e.parameter.sheet_url;
      const editors = paListSheetEditors(sheetUrl);
      return paJson({ status: 'ok', editors: editors });
    }
    if (action === 'list_pending_rows') {
      const sheetUrl = e.parameter.sheet_url;
      const tab = e.parameter.tab || 'Cohort Roster';
      const result = paListPendingRows(sheetUrl, tab);
      return paJson({ status: 'ok', headers: result.headers, rows: result.rows });
    }
    if (action === 'resolve_admin') {
      const sheetUrl = e.parameter.sheet_url;
      const email = e.parameter.email;
      const isAdmin = paIsEditor(sheetUrl, email);
      return paJson({ status: 'ok', is_admin: isAdmin, email: email });
    }
    if (action === 'process_attestation_events') {
      const summary = paProcessAttestationEvents();
      return paJson({ status: 'ok', summary: summary });
    }

    return paJson({ status: 'error', message: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return paJson({ status: 'error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

function paJson(obj, statusCode) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// EDGAR WEBHOOK — process [CREDENTIALING ATTESTATION EVENT] rows
// ============================================================================

function paProcessAttestationEvents() {
  const lock = LockService.getScriptLock();
  const got = lock.tryLock(30000);
  if (!got) throw new Error('Could not acquire script lock — another run in progress');

  try {
    const tcl = paGetSheet(PA_TELEGRAM_SHEET_URL, PA_TELEGRAM_TAB);
    const intake = paEnsureIntakeTab();

    const lastTcl = tcl.getLastRow();
    if (lastTcl < 2) return { rows_scanned: 0, processed: 0 };

    const startRow = Math.max(2, lastTcl - PA_SCAN_LOOKBACK_ROWS + 1);
    const numRows = lastTcl - startRow + 1;
    const tclValues = tcl.getRange(startRow, 1, numRows, tcl.getLastColumn()).getValues();
    const tclHeaders = tcl.getRange(1, 1, 1, tcl.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h || '').trim(); });

    const colIdx = function (label) {
      const lower = String(label).toLowerCase();
      for (let i = 0; i < tclHeaders.length; i++) {
        if (String(tclHeaders[i]).toLowerCase() === lower) return i;
      }
      return -1;
    };

    const idxUpdateId = colIdx('Telegram Update ID');
    const idxMsgId = colIdx('Telegram Message ID');
    const idxBody = colIdx('Message');

    if (idxUpdateId < 0 || idxBody < 0) {
      throw new Error('Telegram Chat Logs missing required columns');
    }

    // Pull already-processed update IDs from intake tab
    const processedIds = paLoadProcessedUpdateIds(intake);

    let scanned = 0;
    let processed = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < tclValues.length; i++) {
      const row = tclValues[i];
      const updateId = String(row[idxUpdateId] || '').trim();
      const body = String(row[idxBody] || '');
      if (!updateId || !body) continue;
      if (body.indexOf('[CREDENTIALING ATTESTATION EVENT]') === -1) continue;
      scanned++;
      if (processedIds[updateId]) continue;

      const messageId = idxMsgId >= 0 ? String(row[idxMsgId] || '') : '';

      try {
        const result = paProcessOneEvent(updateId, messageId, body, intake);
        if (result.status === 'PROCESSED') processed++;
        else failed++;
      } catch (err) {
        failed++;
        errors.push(updateId + ': ' + (err && err.message ? err.message : err));
        paAppendIntakeRow(intake, {
          updateId: updateId,
          messageId: messageId,
          rawMessage: body,
          parsed: null,
          status: 'FAILED',
          error: String(err && err.message ? err.message : err),
        });
      }
    }

    return {
      rows_scanned: scanned,
      processed: processed,
      failed: failed,
      errors: errors,
    };
  } finally {
    lock.releaseLock();
  }
}

function paProcessOneEvent(updateId, messageId, body, intake) {
  const parsed = paParseAttestationEvent(body);
  if (!parsed) {
    paAppendIntakeRow(intake, {
      updateId: updateId, messageId: messageId, rawMessage: body, parsed: null,
      status: 'FAILED', error: 'Could not parse [CREDENTIALING ATTESTATION EVENT]',
    });
    return { status: 'FAILED' };
  }

  // 1. Trust check — attestor's pubkey resolves to an email on the roster sheet's editor list.
  const attestorEmail = paResolveEmailForPubKey(parsed.attestorPubKey);
  if (!parsed.rosterUrl) {
    paAppendIntakeRow(intake, {
      updateId: updateId, messageId: messageId, rawMessage: body, parsed: parsed,
      attestorEmail: attestorEmail,
      status: 'REJECTED', error: 'Event missing Roster Source URL',
    });
    return { status: 'REJECTED' };
  }
  const editors = paListSheetEditors(parsed.rosterUrl);
  const isAuthorized = editors.some(function (e) {
    return String(e).toLowerCase() === String(attestorEmail || '').toLowerCase();
  });
  if (!isAuthorized) {
    paAppendIntakeRow(intake, {
      updateId: updateId, messageId: messageId, rawMessage: body, parsed: parsed,
      attestorEmail: attestorEmail,
      status: 'REJECTED',
      error: 'Attestor ' + (attestorEmail || '<unknown>') + ' is not in the roster editor list',
    });
    return { status: 'REJECTED' };
  }

  // 2. Derive attestee slug
  const attesteeSlug = paDerivePkHash(parsed.attesteePubKey);

  // 3. Commit identity.json + attestations/<ts>.json to lineage-credentials
  const isoNow = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = 'programs/' + parsed.program + '/' + attesteeSlug;

  let payloadObj = {};
  try {
    if (parsed.payloadJson) payloadObj = JSON.parse(parsed.payloadJson);
  } catch (jsonErr) { /* tolerate bad JSON; payload becomes empty object */ }

  const identity = {
    primary_public_key: parsed.attesteePubKey,
    names: [parsed.attesteeName],
    emails: [],
    linked_at: parsed.capturedAt || new Date().toISOString(),
    metadata: Object.assign({
      program_year: parsed.programYear || null,
      attestor_name: parsed.attestorName,
      attestor_email: attestorEmail,
    }, payloadObj),
    alternate_public_keys: [],
    former_pk_hashes: [],
    public_listable: true,
  };

  const attestation = {
    attestation_type: parsed.attestationType,
    program: parsed.program,
    attestor_public_key: parsed.attestorPubKey,
    attestor_name: parsed.attestorName,
    attestor_email: attestorEmail,
    attestee_public_key: parsed.attesteePubKey,
    attestee_name: parsed.attesteeName,
    captured_at: parsed.capturedAt,
    program_year: parsed.programYear,
    source_url: parsed.sourceUrl,
    payload: payloadObj,
    edgar_request_transaction_id: parsed.txId,
    telegram_update_id: updateId,
  };

  const identityCommit = paCommitJsonToGithub(
    baseDir + '/identity.json',
    JSON.stringify(identity, null, 2),
    'attestation: identity.json for ' + parsed.attesteeName + ' (' + attesteeSlug + ')'
  );

  const attestationPath = baseDir + '/attestations/' + isoNow + '-' + parsed.attestationType + '.json';
  const attestationCommit = paCommitJsonToGithub(
    attestationPath,
    JSON.stringify(attestation, null, 2),
    'attestation: ' + parsed.attestationType + ' for ' + parsed.attesteeName
  );

  // 4. Back-fill source roster row + append Audit Trail
  const profileUrl = 'https://truesight.me/programs/' + parsed.program + '/credentials/#' + attesteeSlug;
  if (parsed.rosterRow > 0) {
    paBackFillRosterRow(parsed.rosterUrl, parsed.rosterRow, {
      public_key: parsed.attesteePubKey,
      pk_hash: attesteeSlug,
      attestation_tx_id: parsed.txId,
      profile_url: profileUrl,
      status: 'processed',
      processed_at: new Date().toISOString(),
      github_commit_sha: attestationCommit.sha || '',
    });
  }
  paAppendAuditTrail(parsed.rosterUrl, {
    processed_at: new Date().toISOString(),
    name: parsed.attesteeName,
    action: 'profile_created',
    github_commit_sha: attestationCommit.sha || '',
    profile_url: profileUrl,
    credential_pdf_url: '',
    certificate_url: '',
    error_message: '',
    triggered_by: parsed.attestorPubKey ? paDerivePkHash(parsed.attestorPubKey) : '',
  });

  paAppendIntakeRow(intake, {
    updateId: updateId, messageId: messageId, rawMessage: body, parsed: parsed,
    attestorEmail: attestorEmail, attesteeSlug: attesteeSlug,
    status: 'PROCESSED',
    githubCommitSha: attestationCommit.sha || '',
  });

  return { status: 'PROCESSED', sha: attestationCommit.sha };
}

// ============================================================================
// LINEAGE-CREDENTIALS GITHUB API
// ============================================================================

function paCommitJsonToGithub(repoPath, content, message) {
  const token = PropertiesService.getScriptProperties().getProperty('TRUESIGHT_CREDENTIALING_PAT');
  if (!token) throw new Error('Script Property TRUESIGHT_CREDENTIALING_PAT not set');

  const url = PA_GITHUB_API_BASE + '/repos/' + PA_LINEAGE_REPO_OWNER + '/' + PA_LINEAGE_REPO_NAME +
    '/contents/' + encodeURI(repoPath);

  // Fetch existing SHA (if file already exists) so we can overwrite cleanly.
  let existingSha = null;
  try {
    const getResp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
      muteHttpExceptions: true,
    });
    if (getResp.getResponseCode() === 200) {
      existingSha = JSON.parse(getResp.getContentText()).sha;
    }
  } catch (_) { /* tolerate */ }

  const body = {
    message: message,
    content: Utilities.base64Encode(content),
    branch: 'main',
  };
  if (existingSha) body.sha = existingSha;

  const resp = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub PUT failed: ' + code + ' ' + resp.getContentText().substring(0, 300));
  }
  const parsed = JSON.parse(resp.getContentText());
  return { sha: parsed.commit ? parsed.commit.sha : '' };
}

// ============================================================================
// INTAKE TAB + AUDIT TRAIL BACK-FILL
// ============================================================================

function paEnsureIntakeTab() {
  const book = SpreadsheetApp.openByUrl(PA_TELEGRAM_SHEET_URL);
  let sheet = book.getSheetByName(PA_INTAKE_TAB);
  if (!sheet) {
    sheet = book.insertSheet(PA_INTAKE_TAB);
    sheet.getRange(1, 1, 1, PA_INTAKE_HEADERS.length).setValues([PA_INTAKE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function paLoadProcessedUpdateIds(intake) {
  const last = intake.getLastRow();
  if (last < 2) return {};
  const values = intake.getRange(2, 1, last - 1, 1).getValues();
  const out = {};
  values.forEach(function (r) {
    const id = String(r[0] || '').trim();
    if (id) out[id] = 1;
  });
  return out;
}

function paAppendIntakeRow(intake, info) {
  const p = info.parsed || {};
  const row = [
    info.updateId,
    info.messageId || '',
    info.rawMessage || '',
    p.program || '',
    p.attestationType || '',
    p.attestorPubKey || '',
    p.attestorName || '',
    info.attestorEmail || '',
    p.attesteePubKey || '',
    p.attesteeName || '',
    info.attesteeSlug || (p.attesteePubKey ? paDerivePkHash(p.attesteePubKey) : ''),
    p.capturedAt || '',
    p.programYear || '',
    p.rosterUrl || '',
    p.rosterRow || '',
    p.configUrl || '',
    p.sourceUrl || '',
    p.payloadJson || '',
    info.status || 'PENDING',
    info.githubCommitSha || '',
    info.error || '',
    new Date().toISOString(),
  ];
  intake.appendRow(row);
  SpreadsheetApp.flush();
}

function paBackFillRosterRow(rosterUrl, rowNumber, updates) {
  const sheet = paGetSheet(rosterUrl, 'Cohort Roster');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim().toLowerCase(); });
  Object.keys(updates).forEach(function (key) {
    const colIndex = headers.indexOf(String(key).toLowerCase());
    if (colIndex < 0) return; // skip unknown columns
    sheet.getRange(rowNumber, colIndex + 1).setValue(updates[key]);
  });
  SpreadsheetApp.flush();
}

function paAppendAuditTrail(rosterUrl, entry) {
  const sheet = paGetSheet(rosterUrl, 'Audit Trail');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim().toLowerCase(); });
  const row = headers.map(function (h) { return entry[h] !== undefined ? entry[h] : ''; });
  sheet.appendRow(row);
  SpreadsheetApp.flush();
}

// ============================================================================
// MAIN-LEDGER LOOKUP — resolve pubkey → email
// ============================================================================

const PA_MAIN_LEDGER_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit';
const PA_CONTRIB_DS_TAB = 'Contributors Digital Signatures';

function paResolveEmailForPubKey(pubKey) {
  try {
    const sheet = paGetSheet(PA_MAIN_LEDGER_URL, PA_CONTRIB_DS_TAB);
    const { headers, rows } = paReadSheetAsObjects(sheet);
    // Find pubkey + email columns by header name (case-insensitive).
    const lower = headers.map(function (h) { return String(h || '').toLowerCase(); });
    const pubCol = lower.findIndex(function (h) { return h.indexOf('signature') !== -1 || h.indexOf('public key') !== -1; });
    const emailCol = lower.findIndex(function (h) { return h.indexOf('email') !== -1; });
    if (pubCol < 0 || emailCol < 0) return null;
    for (let i = 0; i < rows.length; i++) {
      const candidate = String(rows[i][headers[pubCol]] || '').trim();
      if (candidate === pubKey.trim()) {
        return String(rows[i][headers[emailCol]] || '').trim();
      }
    }
  } catch (err) {
    // Network/permission issue — tolerate, return null
  }
  return null;
}
