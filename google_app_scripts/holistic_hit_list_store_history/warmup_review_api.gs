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
var WARMUP_DRAFTS_LABEL = 'AI/Warm-up';
var WARMUP_HOSTS_CIRCLES_HEADER = 'Hosts Circles';

function getWarmupReviewQueue_() {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var draftsSh = getSheetSafe_(ss, SHEET_EMAIL_DRAFTS);
  if (!draftsSh) {
    return { drafts: [], counts: { total: 0, with_message_id: 0 } };
  }

  var draftsValues = draftsSh.getDataRange().getValues();
  if (draftsValues.length < 2) {
    return { drafts: [], counts: { total: 0, with_message_id: 0 } };
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

  var pending = [];
  var withMsgId = 0;
  for (var r = 1; r < draftsValues.length; r++) {
    var row = draftsValues[r];
    var status = (row[iStatus] || '').toString().trim();
    if (status !== WARMUP_DRAFTS_PENDING_STATUS) continue;
    var label = (row[iLabel] || '').toString().trim();
    if (label !== WARMUP_DRAFTS_LABEL) continue;

    var em = ((row[iEmail] || '').toString().trim() || '').toLowerCase();
    var shop = (row[iShop] || '').toString().trim();
    var sk = iStoreKey === undefined ? '' : (row[iStoreKey] || '').toString().trim();
    var subj = (row[iSubject] || '').toString();
    var preview = (row[iPreview] || '').toString();
    var draftId = (row[iDraftId] || '').toString().trim();
    var msgId = iMsgId === undefined ? '' : (row[iMsgId] || '').toString().trim();
    var hitRow = iHitRow === undefined ? '' : (row[iHitRow] || '').toString().trim();
    var createdAt = iCreated === undefined ? '' : (row[iCreated] || '').toString();

    var hit = (em && hitIndex.byEmail[em])
        || (sk && hitIndex.byStoreKey[sk])
        || null;
    var hostsCircles = !!(hit && hit.hostsCircles);
    var cityState = hit ? hit.cityState : '';
    var notes = hit ? hit.notes : '';
    var hasDappHistory = !!dappCounts[shop.toLowerCase()];
    if (msgId) withMsgId++;

    pending.push({
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
      gmail_draft_id: draftId,
      gmail_message_id: msgId,
      created_at_utc: createdAt,
    });
  }

  return {
    drafts: pending,
    counts: {
      total: pending.length,
      with_message_id: withMsgId,
      hit_list_indexed_email: Object.keys(hitIndex.byEmail).length,
      hit_list_indexed_store: Object.keys(hitIndex.byStoreKey).length,
      dapp_remarks_indexed: Object.keys(dappCounts).length,
    },
    generated_at_utc: new Date().toISOString(),
  };
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
