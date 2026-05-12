/**
 * Read-only API powering dapp/warmup_review.html.
 *
 * Returns the queue of warm-up Gmail drafts pending operator review,
 * joined with Hit List signals (Hosts Circles, City/State, Notes) and
 * DApp Remarks history count, so the DApp can render a tiered triage
 * view (red flags / Hosts Circles=Yes badge / clean cohort) without
 * round-tripping multiple GAS calls.
 *
 * Mirrors the local script `market_research/scripts/preview_warmup_drafts.py`
 * but driven by the 500-char `body_preview` column rather than a full
 * Gmail draft fetch — same ~12 lint rules apply since most fire on the
 * first 500 chars (subject, generic_inbox, fallback shop name, body
 * length, foreign script, generic salutation, placeholder).
 *
 * Schema reference: ensure_email_agent_suggestions_sheet.py defines
 * the canonical Email Agent Drafts header. The `gmail_message_id`
 * column was added 2026-05-03 and powers the
 * `https://mail.google.com/.../drafts/<message_id>` deep-link the
 * DApp uses to jump straight to a draft from mobile.
 *
 * Action: ?action=getWarmupReviewQueue (registered in Code.js doGet).
 */

var WARMUP_DRAFTS_PENDING_STATUS = 'pending_review';
var WARMUP_DEFAULT_LABEL = 'AI/Warm-up';
var WARMUP_FOLLOWUP_LABEL = 'AI/Follow-up';
var WARMUP_PROSPECT_LABEL = 'AI/Prospect Replied';
var WARMUP_PARTNER_POKE_LABEL = 'AI/Partner Poke';  // Existing-partner pokes from partner_poke_drafts.gs
var WARMUP_ALLOWED_LABELS = [WARMUP_DEFAULT_LABEL, WARMUP_FOLLOWUP_LABEL, WARMUP_PROSPECT_LABEL, WARMUP_PARTNER_POKE_LABEL];
var WARMUP_HOSTS_CIRCLES_HEADER = 'Hosts Circles';

/**
 * Read-only triage queue for all outbound drafts across every cohort.
 * Returns drafts grouped by label so the DApp can render tabs without
 * multiple API calls. One bulk read, one GmailApp.getDrafts() call.
 */
function getWarmupReviewQueue_(optLabel) {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var draftsSh = getSheetSafe_(ss, SHEET_EMAIL_DRAFTS);
  if (!draftsSh) {
    return emptyQueueResponse_();
  }

  var draftsValues = draftsSh.getDataRange().getValues();
  if (draftsValues.length < 2) {
    return emptyQueueResponse_();
  }
  var draftsHdr = headerMap_(draftsValues[0]);
  var iStatus = draftsHdr['status'];
  var iLabel = draftsHdr['gmail_label'];
  var iEmail = draftsHdr['to_email'];
  var iShop = draftsHdr['shop_name'];
  var iStoreKey = draftsHdr['store_key'];
  var iSubject = draftsHdr['subject'];
  var iPreview = draftsHdr['body_preview'];
  var iDraftId = draftsHdr['gmail_draft_id'];
  var iMsgId = draftsHdr['gmail_message_id'];
  var iHitRow = draftsHdr['hit_list_row'];
  var iCreated = draftsHdr['created_at_utc'];
  var required = ['status', 'gmail_label', 'to_email', 'shop_name', 'subject',
                  'body_preview', 'gmail_draft_id'];
  for (var k = 0; k < required.length; k++) {
    if (draftsHdr[required[k]] === undefined) {
      throw new Error('Email Agent Drafts missing column: ' + required[k]);
    }
  }

  var hitIndex = warmupBuildHitListIndex_(ss);
  var dappCounts = warmupBuildDappRemarksCounts_(ss);
  var liveDraftIds = warmupGetLiveDraftIdSet_();
  var sentDraftIds = warmupReadSentDraftIds_();
  var sentMessageIds = warmupReadSentMessageIds_(ss);
  var hasLiveDrafts = Object.keys(liveDraftIds).length > 0;

  // Build full-body lookup from live Gmail drafts (keyed by draft id).
  var fullBodyByDraftId = hasLiveDrafts ? warmupBuildFullBodyMap_() : {};
  // Build prospect reply lookup from DApp Remarks (keyed by shop name lower).
  var prospectReplies = warmupBuildProspectReplyMap_(ss);

  // Group pending drafts by label
  var byLabel = {};
  for (var li = 0; li < WARMUP_ALLOWED_LABELS.length; li++) {
    byLabel[WARMUP_ALLOWED_LABELS[li]] = [];
  }

  var skipped = { notInGmail: 0, sentDApp: 0, sentManual: 0 };

  for (var r = 1; r < draftsValues.length; r++) {
    var row = draftsValues[r];
    var status = (row[iStatus] || '').toString().trim();
    if (status !== WARMUP_DRAFTS_PENDING_STATUS) continue;
    var rowLabel = (row[iLabel] || '').toString().trim();
    if (WARMUP_ALLOWED_LABELS.indexOf(rowLabel) === -1) continue;

    var em = ((row[iEmail] || '').toString().trim() || '').toLowerCase();
    var shop = (row[iShop] || '').toString().trim();
    var sk = iStoreKey === undefined ? '' : (row[iStoreKey] || '').toString().trim();
    var subj = (row[iSubject] || '').toString();
    var preview = (row[iPreview] || '').toString();
    var draftId = (row[iDraftId] || '').toString().trim();
    var msgId = iMsgId === undefined ? '' : (row[iMsgId] || '').toString().trim();
    var hitRow = iHitRow === undefined ? '' : (row[iHitRow] || '').toString().trim();
    var createdAt = iCreated === undefined ? '' : (row[iCreated] || '').toString();

    if (draftId && hasLiveDrafts && !liveDraftIds[draftId]) {
      skipped.notInGmail++;
      continue;
    }
    if (draftId && sentDraftIds[draftId]) {
      skipped.sentDApp++;
      continue;
    }
    if (msgId && sentMessageIds[msgId]) {
      skipped.sentManual++;
      continue;
    }

    var hit = (em && hitIndex.byEmail[em])
        || (sk && hitIndex.byStoreKey[sk])
        || null;
    var hostsCircles = !!(hit && hit.hostsCircles);
    var cityState = hit ? hit.cityState : '';
    var notes = hit ? hit.notes : '';
    var hasDappHistory = !!dappCounts[shop.toLowerCase()];

    var draftObj = {
      sheet_row: r + 1,
      to_email: em,
      shop_name: shop,
      store_key: sk,
      city_state: cityState,
      hit_list_row: hitRow,
      hit_list_notes_present: !!(notes && notes.length),
      hosts_circles: hostsCircles,
      has_dapp_history: hasDappHistory,
      subject: subj,
      body_preview: preview,
      body_full: (draftId && fullBodyByDraftId[draftId]) || '',
      prospect_reply_body: (rowLabel === WARMUP_PROSPECT_LABEL ? (prospectReplies[shop.toLowerCase()] || '') : ''),
      gmail_draft_id: draftId,
      gmail_message_id: msgId,
      created_at_utc: createdAt,
    };
    byLabel[rowLabel].push(draftObj);
  }

  var total = 0;
  var counts = {};
  for (var li = 0; li < WARMUP_ALLOWED_LABELS.length; li++) {
    var lbl = WARMUP_ALLOWED_LABELS[li];
    counts[lbl] = byLabel[lbl].length;
    total += byLabel[lbl].length;
  }

  return {
    drafts_by_label: byLabel,
    counts: counts,
    total_pending: total,
    skipped: skipped,
    live_gmail_drafts: Object.keys(liveDraftIds).length,
    sent_audit_indexed: Object.keys(sentDraftIds).length,
    followup_log_indexed: Object.keys(sentMessageIds).length,
    hit_list_indexed_email: Object.keys(hitIndex.byEmail).length,
    hit_list_indexed_store: Object.keys(hitIndex.byStoreKey).length,
    dapp_remarks_indexed: Object.keys(dappCounts).length,
    generated_at_utc: new Date().toISOString(),
  };
}

function emptyQueueResponse_() {
  var empty = {};
  for (var li = 0; li < WARMUP_ALLOWED_LABELS.length; li++) {
    empty[WARMUP_ALLOWED_LABELS[li]] = [];
  }
  return { drafts_by_label: empty, counts: {}, total_pending: 0, skipped: {} };
}

/**
 * One bulk GmailApp.getDrafts() call → set of currently-alive draft ids.
 * Returns an object keyed by draft id (used as a Set surrogate). Empty
 * object on error so callers don't blow up — they fall through to the
 * sheet-based filters below. Runs as the GAS script owner so the
 * Gmail-side draft list reflects whatever account that owner is.
 */
function warmupGetLiveDraftIdSet_() {
  try {
    var drafts = GmailApp.getDrafts();
    var out = {};
    for (var i = 0; i < drafts.length; i++) {
      var id = drafts[i].getId();
      if (id) out[id] = true;
    }
    return out;
  } catch (err) {
    Logger.log('warmupGetLiveDraftIdSet_ failed: ' + err);
    return {};
  }
}

/**
 * Set of draft ids that the WarmupSendHandler has successfully shipped.
 * Lives on the "Warmup Sends" audit tab of the Telegram-compilation
 * spreadsheet (1qbZZhf-…). Status column = col 9 (1-based); only 'sent'
 * rows count as terminal-sent. Returns an object keyed by draft id
 * (used as a Set surrogate) — empty object on error / sheet missing.
 */
function warmupReadSentDraftIds_() {
  try {
    var ss = SpreadsheetApp.openById('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ');
    var ws = ss.getSheetByName('Warmup Sends');
    if (!ws) return {};
    var last = ws.getLastRow();
    if (last < 2) return {};
    // Columns A..L per WARMUP_AUDIT_HEADERS (warmup_send_handler.gs).
    var data = ws.getRange(2, 1, last - 1, 12).getValues();
    var out = {};
    for (var i = 0; i < data.length; i++) {
      var draftId = String(data[i][5] || '').trim();   // col F (1-based 6) — Draft ID
      var status = String(data[i][8] || '').trim().toLowerCase();  // col I — Status
      if (draftId && status === 'sent') out[draftId] = true;
    }
    return out;
  } catch (err) {
    Logger.log('warmupReadSentDraftIds_ failed: ' + err);
    return {};
  }
}

/**
 * Set of message ids that have been logged as sent in the "Email Agent
 * Follow Up" tab on the Hit List spreadsheet — populated by
 * sync_email_agent_followup.py (cron / manual). Catches manual Gmail
 * sends after the operator runs sync. Joins on gmail_message_id, which
 * is stable across the draft → sent label flip.
 */
function warmupReadSentMessageIds_(ss) {
  try {
    var ws = ss.getSheetByName('Email Agent Follow Up');
    if (!ws) return {};
    var values = ws.getDataRange().getValues();
    if (values.length < 2) return {};
    var hdr = headerMap_(values[0]);
    // Column name varies across schema generations — check both.
    var idx = hdr['message_id'];
    if (idx === undefined) idx = hdr['gmail_message_id'];
    if (idx === undefined) return {};
    var out = {};
    for (var i = 1; i < values.length; i++) {
      var mid = String(values[i][idx] || '').trim();
      if (mid) out[mid] = true;
    }
    return out;
  } catch (err) {
    Logger.log('warmupReadSentMessageIds_ failed: ' + err);
    return {};
  }
}


function warmupBuildHitListIndex_(ss) {
  var sh = getSheetSafe_(ss, SHEET_HIT_LIST);
  if (!sh) return { byEmail: {}, byStoreKey: {} };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { byEmail: {}, byStoreKey: {} };
  var hdr = headerMap_(values[0]);
  var iEmail = hdr['Email'];
  var iStoreKey = hdr['Store Key'];
  var iCity = hdr['City'];
  var iState = hdr['State'];
  var iNotes = hdr['Notes'];
  var iAW = hdr[WARMUP_HOSTS_CIRCLES_HEADER];

  var byEmail = {};
  var byStoreKey = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var em = iEmail === undefined ? '' : (row[iEmail] || '').toString().trim().toLowerCase();
    var sk = iStoreKey === undefined ? '' : (row[iStoreKey] || '').toString().trim();
    var city = iCity === undefined ? '' : (row[iCity] || '').toString().trim();
    var state = iState === undefined ? '' : (row[iState] || '').toString().trim();
    var notes = iNotes === undefined ? '' : (row[iNotes] || '').toString();
    var aw = iAW === undefined ? '' : (row[iAW] || '').toString().trim();
    var locale = [city, state].filter(function (x) { return !!x; }).join(', ');
    var payload = {
      hostsCircles: warmupYes_(aw),
      cityState: locale,
      notes: notes,
    };
    if (em && !byEmail[em]) byEmail[em] = payload;
    if (sk && !byStoreKey[sk]) byStoreKey[sk] = payload;
  }
  return { byEmail: byEmail, byStoreKey: byStoreKey };
}

function warmupBuildDappRemarksCounts_(ss) {
  var sh = getSheetSafe_(ss, SHEET_DAPP_REMARKS);
  if (!sh) return {};
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return {};
  var hdr = headerMap_(values[0]);
  var iShop = hdr['Shop Name'];
  if (iShop === undefined) return {};
  var counts = {};
  for (var r = 1; r < values.length; r++) {
    var sn = (values[r][iShop] || '').toString().trim().toLowerCase();
    if (!sn) continue;
    counts[sn] = (counts[sn] || 0) + 1;
  }
  return counts;
}

/**
 * Fetch full plain-text body for every live Gmail draft on the user's
 * GmailApp scope and build a draft-id → body map. Called once per
 * getWarmupReviewQueue_ request so the DApp can offer an "Expand full
 * body" button without extra API roundtrips.
 */
function warmupBuildFullBodyMap_() {
  try {
    var drafts = GmailApp.getDrafts();
    var out = {};
    for (var i = 0; i < drafts.length; i++) {
      var d = drafts[i];
      var id = d.getId();
      if (!id) continue;
      try {
        var body = d.getMessage().getPlainBody();
        out[id] = (body || '').toString();
      } catch (e2) {
        // Draft present but message body not readable — leave empty.
      }
    }
    return out;
  } catch (err) {
    Logger.log('warmupBuildFullBodyMap_ failed: ' + err);
    return {};
  }
}

/**
 * Build a shop-name → most-recent-reply-text map from DApp Remarks rows
 * submitted by the warmup_reply_promotion process. Used by the DApp to
 * show the prospect's original reply alongside the reply draft.
 */
function warmupBuildProspectReplyMap_(ss) {
  try {
    var sh = getSheetSafe_(ss, SHEET_DAPP_REMARKS);
    if (!sh) return {};
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return {};
    var hdr = headerMap_(values[0]);
    var iShop = hdr['Shop Name'];
    var iBy = hdr['Submitted By'];
    var iRemarks = hdr['Remarks'];
    var iAt = hdr['Submitted At'];
    if (iShop === undefined || iBy === undefined || iRemarks === undefined) return {};

    // We want the most recent reply per shop. Iterate top-down (oldest
    // first), overwrite so the last (newest) wins below.
    var out = {};
    for (var r = 1; r < values.length; r++) {
      var by = (values[r][iBy] || '').toString().trim();
      if (by !== 'warmup_reply_promotion') continue;
      var sn = (values[r][iShop] || '').toString().trim().toLowerCase();
      if (!sn) continue;
      var remarks = (values[r][iRemarks] || '').toString();
      if (!remarks) continue;
      out[sn] = remarks;
    }
    return out;
  } catch (err) {
    Logger.log('warmupBuildProspectReplyMap_ failed: ' + err);
    return {};
  }
}

/**
 * Hit List Hosts Circles column stores descriptive variants like
 * 'Yes (sound bath)' / 'Yes (sound healing, breathwork)' alongside
 * 'Not detected' / blank. Treat any value whose first token (or
 * pre-paren token) is 'yes' as a positive signal.
 */
function warmupYes_(s) {
  var v = (s || '').toString().trim().toLowerCase();
  if (!v) return false;
  if (v === 'y' || v === 'true' || v === '1') return true;
  var firstWord = v.split(/\s+/)[0];
  if (firstWord === 'yes') return true;
  var beforeParen = v.split('(')[0].replace(/\s+$/, '');
  return beforeParen === 'yes';
}
