/**
 * Process [WARMUP SEND EVENT] rows from "Telegram Chat Logs" and send the
 * matching Gmail draft. Same dispatch shape as DappPermissionChangeHandler
 * (1m8IZPs1…) but lives in the holistic_hit_list_store_history project
 * because GmailApp.send() runs as the script owner and that's where
 * EmailAgentDrafts.gs already creates drafts via GmailApp.
 *
 * Triggers:
 * - Edgar /submit_contribution dispatcher fires
 *   doGet(?action=apply_warmup_send) on the storesHitList deployment URL
 *   after every successful [WARMUP SEND EVENT] persist on Telegram Chat
 *   Logs. Edgar's WebhookTriggerWorker only forwards `action` (no secret),
 *   matching the convention of every other dispatch handler. The Apps
 *   Script deployment URL itself is the access token (functionally
 *   unguessable); real authorization is the per-event RSA signature
 *   verified by Edgar before logging + the active-membership check in
 *   applyPendingWarmupSends_. Even if the URL leaks, an attacker can
 *   only force-process events that are already on Telegram Chat Logs
 *   with valid signatures, and processing is idempotent because Gmail
 *   only sends a draft once (the second attempt finds no draft).
 * - Manual: applyWarmupSendNow() from the Apps Script editor.
 */

var WARMUP_SEND_EVENT_TAG = '[WARMUP SEND EVENT]';
var WARMUP_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var WARMUP_TELEGRAM_SHEET_NAME = 'Telegram Chat Logs';
var WARMUP_AUDIT_SHEET_NAME = 'Warmup Sends';
var WARMUP_OFFCHAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var WARMUP_SIGS_SHEET_NAME = 'Contributors Digital Signatures';

// Telegram Chat Logs column layout (matches DappPermissionChangeHandler).
var WARMUP_TELEGRAM_TEXT_COL_INDEX = 6;       // 0-based — col G holds the event text
var WARMUP_TELEGRAM_UPDATE_ID_COL_INDEX = 0;  // 0-based — col A is Telegram Update ID

var WARMUP_AUDIT_HEADERS = [
  'Telegram Update ID',
  'Submitted At UTC',
  'Actor Public Key',
  'Actor Name',
  'Is Active Member',
  'Draft ID',
  'Recipient',
  'Subject',
  'Status',
  'Sent Message ID',
  'Notes',
  'Processed At UTC',
];

/** Manual entry point for editor smoke testing. */
function applyWarmupSendNow() {
  var result = applyPendingWarmupSends_({ trigger: 'manual' });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * doGet-routed entry. Registered in Code.js as
 * action === 'apply_warmup_send'. Returns JSON envelope to the caller
 * (Edgar's WebhookTriggerWorker, or operator curl).
 */
function handleApplyWarmupSendRequest_() {
  try {
    var result = applyPendingWarmupSends_({ trigger: 'edgar_webhook' });
    return ContentService
        .createTextOutput(JSON.stringify({ ok: true, data: result }))
        .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('handleApplyWarmupSendRequest_ failed: ' + err);
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Core: scan Telegram Chat Logs for unprocessed [WARMUP SEND EVENT]
 * rows, verify signer is an active contributor, send the matching Gmail
 * draft, append outcome to the Warmup Sends audit tab.
 */
function applyPendingWarmupSends_(opts) {
  var o = opts || {};
  var telegramSs = SpreadsheetApp.openById(WARMUP_TELEGRAM_SPREADSHEET_ID);
  var telegramWs = telegramSs.getSheetByName(WARMUP_TELEGRAM_SHEET_NAME);
  if (!telegramWs) {
    throw new Error('Missing sheet: ' + WARMUP_TELEGRAM_SHEET_NAME);
  }
  var auditWs = ensureWarmupAuditSheet_(telegramSs);
  var seenUpdateIds = warmupReadProcessedUpdateIds_(auditWs);

  var lastRow = telegramWs.getLastRow();
  if (lastRow < 2) {
    return { trigger: o.trigger, processed: 0, skipped: 0, reason: 'empty_log' };
  }
  var lastCol = Math.max(
      WARMUP_TELEGRAM_TEXT_COL_INDEX,
      WARMUP_TELEGRAM_UPDATE_ID_COL_INDEX) + 1;
  var data = telegramWs.getRange(2, 1, lastRow - 1, lastCol).getValues();

  var offchainSs = SpreadsheetApp.openById(WARMUP_OFFCHAIN_SPREADSHEET_ID);
  var sigByPublicKey = warmupReadActiveSignaturesByPublicKey_(offchainSs);

  var processed = 0;
  var skipped = 0;
  var newRows = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var text = String(row[WARMUP_TELEGRAM_TEXT_COL_INDEX] || '');
    if (!text || text.indexOf(WARMUP_SEND_EVENT_TAG) < 0) continue;

    var updateId = String(row[WARMUP_TELEGRAM_UPDATE_ID_COL_INDEX] || '').trim();
    if (!updateId) continue;
    var prior = seenUpdateIds[updateId];
    // Terminal statuses — never reprocess.
    if (prior === 'sent' || prior === 'unauthorized' ||
        prior === 'invalid_payload' || prior === 'not_found_in_gmail') {
      skipped++;
      continue;
    }

    var parsed = parseWarmupSendEvent_(text);
    var publicKey = parsed.publicKey || '';
    var sigEntry = sigByPublicKey[publicKey] || null;
    var actorName = sigEntry ? sigEntry.name : '(unknown)';
    var isActive = !!sigEntry;

    var rowOut = {
      updateId: updateId,
      submittedAt: parsed.submittedAt || '',
      publicKey: warmupTruncateKey_(publicKey),
      actorName: actorName,
      isActive: isActive ? 'YES' : 'NO',
      draftId: parsed.draftId || '',
      recipient: parsed.toEmail || '',
      subject: parsed.subject || '',
      status: '',
      sentMessageId: '',
      notes: '',
      processedAt: new Date().toISOString(),
    };

    if (parsed.error) {
      rowOut.status = 'invalid_payload';
      rowOut.notes = parsed.error;
      newRows.push(warmupAuditRowFromObject_(rowOut));
      continue;
    }
    if (!isActive) {
      rowOut.status = 'unauthorized';
      rowOut.notes = 'Public key not ACTIVE in Contributors Digital Signatures.';
      newRows.push(warmupAuditRowFromObject_(rowOut));
      continue;
    }

    var sendResult = warmupSendDraftById_(parsed.draftId);
    rowOut.status = sendResult.status;
    rowOut.sentMessageId = sendResult.messageId || '';
    rowOut.notes = sendResult.notes || '';
    newRows.push(warmupAuditRowFromObject_(rowOut));
    if (sendResult.status === 'sent') {
      processed++;
    }
  }

  if (newRows.length) {
    auditWs.getRange(auditWs.getLastRow() + 1, 1, newRows.length, WARMUP_AUDIT_HEADERS.length)
        .setValues(newRows);
  }

  return {
    trigger: o.trigger,
    processed: processed,
    skipped: skipped,
    appended_rows: newRows.length,
  };
}

function warmupSendDraftById_(draftId) {
  if (!draftId) {
    return { status: 'invalid_payload', notes: 'Missing draft_id' };
  }
  try {
    var draft = GmailApp.getDraft(draftId);
    if (!draft) {
      return { status: 'not_found_in_gmail',
               notes: 'GmailApp.getDraft returned null — already sent or discarded.' };
    }
    var sentMsg = draft.send();
    var msgId = sentMsg && sentMsg.getId ? sentMsg.getId() : '';
    return { status: 'sent', messageId: msgId };
  } catch (err) {
    var msg = String(err && err.message || err);
    if (msg.indexOf('not found') !== -1 || msg.indexOf('Invalid') !== -1) {
      return { status: 'not_found_in_gmail', notes: msg };
    }
    return { status: 'failed_send', notes: msg };
  }
}

function ensureWarmupAuditSheet_(ss) {
  var ws = ss.getSheetByName(WARMUP_AUDIT_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(WARMUP_AUDIT_SHEET_NAME);
    ws.getRange(1, 1, 1, WARMUP_AUDIT_HEADERS.length).setValues([WARMUP_AUDIT_HEADERS]);
    ws.getRange(1, 1, 1, WARMUP_AUDIT_HEADERS.length).setFontWeight('bold');
    ws.setFrozenRows(1);
    return ws;
  }
  var lastCol = Math.max(1, ws.getLastColumn());
  var existing = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  if (existing.length < WARMUP_AUDIT_HEADERS.length) {
    var startCol = existing.length + 1;
    var missing = WARMUP_AUDIT_HEADERS.slice(existing.length);
    ws.getRange(1, startCol, 1, missing.length).setValues([missing]);
    ws.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
  }
  return ws;
}

function warmupReadProcessedUpdateIds_(auditWs) {
  var last = auditWs.getLastRow();
  if (last < 2) return {};
  var data = auditWs.getRange(2, 1, last - 1, WARMUP_AUDIT_HEADERS.length).getValues();
  var out = {};
  data.forEach(function (r) {
    var u = String(r[0] || '').trim();
    var status = String(r[8] || '').trim().toLowerCase();
    if (u) out[u] = status;
  });
  return out;
}

function warmupReadActiveSignaturesByPublicKey_(ss) {
  var ws = ss.getSheetByName(WARMUP_SIGS_SHEET_NAME);
  if (!ws) return {};
  var last = ws.getLastRow();
  if (last < 2) return {};
  var data = ws.getRange(2, 1, last - 1, 8).getValues();
  var out = {};
  data.forEach(function (r) {
    var name = String(r[0] || '').trim();
    var status = String(r[3] || '').trim().toUpperCase();
    var key = String(r[4] || '').trim();
    if (!name || !key || status !== 'ACTIVE') return;
    out[key] = { name: name };
  });
  return out;
}

function parseWarmupSendEvent_(text) {
  var lines = String(text).split('\n').map(function (s) { return s.trim(); });
  if (!lines.length || lines[0].indexOf(WARMUP_SEND_EVENT_TAG) < 0) {
    return { error: 'Missing event tag.' };
  }
  function pluck(prefix) {
    var m = lines.find(function (l) { return l.indexOf(prefix) === 0; });
    return m ? m.substring(prefix.length).trim() : '';
  }
  var draftId = pluck('- Draft ID:');
  var toEmail = pluck('- Recipient:');
  var subject = pluck('- Subject:');
  var submittedAt = pluck('- Submitted At:');

  var pkMatch = text.match(/My Digital Signature:\s*([\s\S]*?)(?:\n\s*Request Transaction ID:|This submission was generated using|$)/i);
  var publicKey = pkMatch ? pkMatch[1].trim() : '';

  if (!draftId) return { error: 'Missing - Draft ID: line.' };
  if (!submittedAt) return { error: 'Missing - Submitted At: line.' };
  if (!publicKey) return { error: 'Missing My Digital Signature: footer.' };

  return {
    draftId: draftId,
    toEmail: toEmail,
    subject: subject,
    submittedAt: submittedAt,
    publicKey: publicKey,
  };
}

function warmupTruncateKey_(k) {
  var s = String(k || '');
  if (s.length <= 60) return s;
  return s.substring(0, 60) + '…';
}

function warmupAuditRowFromObject_(o) {
  return [
    o.updateId, o.submittedAt, o.publicKey, o.actorName, o.isActive,
    o.draftId, o.recipient, o.subject,
    o.status, o.sentMessageId, o.notes, o.processedAt,
  ];
}
