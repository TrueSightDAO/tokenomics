/**
 * Email Agent drafts — Hit List → Gmail drafts + Email Agent Suggestions
 *
 * Mirrors the Python workflows in market_research (repo: TrueSightDAO/content_schedule):
 *   - suggest_manager_followup_drafts.py  → Status "Manager Follow-up" (plain draft, no PDF)
 *   - suggest_bulk_info_drafts.py           → Status "Bulk Info Requested" (draft + wholesale PDF)
 *
 * Install: add this file to the Apps Script project that already has access to the Hit List
 * spreadsheet and runs as the mailbox that should own the drafts (e.g. garyjob@agroverse.shop).
 * Enable advanced service "Gmail API" only if you later need features beyond GmailApp; GmailApp
 * is enough for createDraft + attachments.
 *
 * Script properties (Project settings → Script properties), all optional except PDF URL if not public:
 *   BULK_PDF_RAW_URL — Full HTTPS URL to the PDF bytes (default: content_schedule main path below).
 *   MIN_DAYS_SINCE_SENT — Default 7 (matches Python cadence).
 *   MAX_DRAFTS_PER_RUN — Cap per invocation (default 20; 0 = no cap).
 *   EXPECTED_MAILBOX — Abort if Session.getActiveUser().getEmail() does not match (lowercase).
 *
 * Menu: Reload spreadsheet → “Email Agent drafts” → run Manager, Bulk, or both.
 */

var HIT_LIST_SPREADSHEET_ID = '1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc';
var SHEET_HIT_LIST = 'Hit List';
var SHEET_LOG = 'Email Agent Follow Up';
var SHEET_SUGG = 'Email Agent Suggestions';

var STATUS_MANAGER = 'Manager Follow-up';
var STATUS_BULK = 'Bulk Info Requested';

var LABEL_NAME = 'Email Agent suggestions';
var PROTOCOL_MANAGER = 'PARTNER_OUTREACH_PROTOCOL v0.1 (Apps Script)';
var PROTOCOL_BULK = 'BULK_INFO_PDF v0.1 (Apps Script)';

/** Default: PDF committed under market_research → retail_price_list/ on GitHub (repo content_schedule). */
var DEFAULT_BULK_PDF_RAW_URL =
  'https://raw.githubusercontent.com/TrueSightDAO/content_schedule/main/retail_price_list/agroverse_wholesale_retail_overview_2026.pdf';

var SUGG_HEADERS = [
  'suggestion_id',
  'created_at_utc',
  'store_key',
  'shop_name',
  'to_email',
  'hit_list_row',
  'gmail_draft_id',
  'subject',
  'body_preview',
  'status',
  'gmail_label',
  'protocol_version',
  'notes',
];

/**
 * Optional menu when this script is **container-bound** to the Hit List spreadsheet.
 * For standalone projects, run `runManagerFollowupDrafts` / `runBulkInfoDraftsWithPdf` from the IDE.
 */
function onOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  ss.addMenu('Email Agent drafts', [
    { name: 'Run Manager Follow-up drafts (no PDF)', functionName: 'runManagerFollowupDrafts' },
    { name: 'Run Bulk Info Requested drafts (with PDF)', functionName: 'runBulkInfoDraftsWithPdf' },
    { name: 'Run both (Manager then Bulk)', functionName: 'runAllEmailAgentDrafts' },
  ]);
}

function runAllEmailAgentDrafts() {
  runManagerFollowupDrafts();
  runBulkInfoDraftsWithPdf();
}

function runManagerFollowupDrafts() {
  runDraftsForStatus_(STATUS_MANAGER, /* attachPdf */ false, PROTOCOL_MANAGER);
}

function runBulkInfoDraftsWithPdf() {
  runDraftsForStatus_(STATUS_BULK, /* attachPdf */ true, PROTOCOL_BULK);
}

/** --- core --- */

function runDraftsForStatus_(hitStatus, attachPdf, protocolVersion) {
  var props = PropertiesService.getScriptProperties();
  var minDays = parseFloat(props.getProperty('MIN_DAYS_SINCE_SENT') || '7') || 7;
  var maxDrafts = parseInt(props.getProperty('MAX_DRAFTS_PER_RUN') || '20', 10);
  if (isNaN(maxDrafts)) maxDrafts = 20;

  var expected = (props.getProperty('EXPECTED_MAILBOX') || 'garyjob@agroverse.shop').toLowerCase();
  var me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (expected && me && me !== expected) {
    throw new Error('Active user is ' + me + ', expected ' + expected + ' (set EXPECTED_MAILBOX or sign in as the ops mail).');
  }

  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var hitSh = ss.getSheetByName(SHEET_HIT_LIST);
  var logSh = ss.getSheetByName(SHEET_LOG);
  var suggSh = ss.getSheetByName(SHEET_SUGG);
  if (!hitSh || !suggSh) throw new Error('Hit List or Email Agent Suggestions sheet missing.');

  var pending = pendingToEmails_(suggSh);
  var lastSent = lastSentByToEmail_(logSh);
  var now = new Date();

  var targets = loadHitListTargets_(hitSh, hitStatus);
  if (!targets.length) {
    Logger.log('No Hit List rows for status=' + hitStatus + ' with Email.');
    return;
  }

  var byEmail = groupByEmail_(targets);
  var candidates = [];
  Object.keys(byEmail)
    .sort()
    .forEach(function (em) {
      if (pending[em]) {
        Logger.log('skip (pending_review): ' + em);
        return;
      }
      var prev = lastSent[em];
      if (prev) {
        var days = (now.getTime() - prev.getTime()) / 86400000;
        if (days < minDays) {
          Logger.log('skip (cadence ' + days.toFixed(1) + 'd): ' + em);
          return;
        }
      }
      candidates.push(em);
    });

  if (!candidates.length) {
    Logger.log('No eligible recipients for ' + hitStatus);
    return;
  }

  var pdfBlob = null;
  if (attachPdf) {
    pdfBlob = fetchWholesalePdfBlob_();
  }

  var label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  var created = 0;

  for (var i = 0; i < candidates.length; i++) {
    if (maxDrafts > 0 && created >= maxDrafts) break;
    var toAddr = candidates[i];
    var pick = pickPrimary_(byEmail[toAddr]);
    var shop = pick.shop_name || 'there';
    var rowNum = String(pick.hit_list_row);
    var storeKey = pick.store_key || '';

    var subj =
      hitStatus === STATUS_BULK
        ? shop + ' — Agroverse wholesale overview (PDF attached)'
        : 'Following up — ' + shop + ' & Agroverse cacao';

    var body =
      hitStatus === STATUS_BULK ? bodyTemplateBulk_(shop) : bodyTemplateManager_(shop);

    var draft;
    if (attachPdf && pdfBlob) {
      draft = GmailApp.createDraft(toAddr, subj, body, { attachments: [pdfBlob] });
    } else {
      draft = GmailApp.createDraft(toAddr, subj, body);
    }

    var draftId = '';
    try {
      draftId = draft.getId();
    } catch (e) {
      draftId = '';
    }

    var msg = draft.getMessage();
    try {
      label.addToThread(msg.getThread());
    } catch (e2) {
      Logger.log('Label add warning: ' + e2);
    }

    var preview = body.replace(/\n/g, ' ').substring(0, 500);
    var notes =
      'Apps Script draft; status=' +
      hitStatus +
      '; attachPdf=' +
      attachPdf +
      '; min_days=' +
      minDays +
      '. Edit in Gmail before Send.';

    var row = [
      Utilities.getUuid(),
      new Date().toISOString(),
      storeKey,
      shop,
      toAddr,
      rowNum,
      draftId,
      subj,
      preview,
      'pending_review',
      LABEL_NAME,
      protocolVersion,
      notes,
    ];
    suggSh.appendRow(row);
    created++;
    Logger.log('Created draft ' + draftId + ' -> ' + toAddr + ' (' + shop + ')');
  }

  Logger.log('Done. Created ' + created + ' draft(s) for ' + hitStatus);
}

function fetchWholesalePdfBlob_() {
  var url =
    PropertiesService.getScriptProperties().getProperty('BULK_PDF_RAW_URL') ||
    DEFAULT_BULK_PDF_RAW_URL;
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error(
      'PDF fetch failed HTTP ' +
        resp.getResponseCode() +
        ' from ' +
        url +
        ' — set BULK_PDF_RAW_URL to your branch raw URL after push, or fix main.'
    );
  }
  return resp.getBlob().setName('Agroverse_wholesale_retail_overview_2026.pdf');
}

function loadHitListTargets_(sheet, wantStatus) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var hdr = headerMap_(values[0]);
  var si = hdr['Status'];
  var ei = hdr['Email'];
  var ski = hdr['Store Key'];
  var ni = hdr['Shop Name'];
  if (si === undefined || ei === undefined) throw new Error('Hit List must have Status and Email columns.');

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[si] || '').trim() !== wantStatus) continue;
    var em = normalizeEmail_(row[ei]);
    if (!em) continue;
    out.push({
      hit_list_row: r + 1,
      store_key: ski !== undefined ? String(row[ski] || '').trim() : '',
      shop_name: ni !== undefined ? String(row[ni] || '').trim() : '',
      to_email: em,
    });
  }
  return out;
}

function groupByEmail_(targets) {
  var m = {};
  targets.forEach(function (t) {
    if (!m[t.to_email]) m[t.to_email] = [];
    m[t.to_email].push(t);
  });
  return m;
}

function pickPrimary_(rows) {
  rows.sort(function (a, b) {
    return a.hit_list_row - b.hit_list_row;
  });
  return rows[0];
}

function pendingToEmails_(suggSh) {
  var values = suggSh.getDataRange().getValues();
  if (values.length < 2) return {};
  var hdr = headerMap_(values[0]);
  var st = hdr['status'];
  var te = hdr['to_email'];
  if (st === undefined || te === undefined) return {};
  var block = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (String(row[st] || '').toLowerCase().trim() !== 'pending_review') continue;
    var em = normalizeEmail_(row[te]);
    if (em) block[em] = true;
  }
  return block;
}

function lastSentByToEmail_(logSh) {
  var out = {};
  if (!logSh) return out;
  var values = logSh.getDataRange().getValues();
  if (values.length < 2) return out;
  var hdr = headerMap_(values[0]);
  var ti = hdr['to_email'];
  var si = hdr['sent_at'];
  if (ti === undefined || si === undefined) return out;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var em = normalizeEmail_(row[ti]);
    if (!em) continue;
    var raw = row[si];
    var dt = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(dt.getTime())) continue;
    if (!out[em] || dt.getTime() > out[em].getTime()) out[em] = dt;
  }
  return out;
}

function bodyTemplateManager_(shop) {
  return (
    'Hi —\n\n' +
    'Following up on Agroverse ceremonial cacao and next steps for ' +
    shop +
    ' (consignment-friendly terms). I’m happy to answer questions by email or on a quick call — ' +
    'and to line up samples or simple paperwork — without needing another in-person meeting on my side.\n\n' +
    'Thanks,\n' +
    'Gary\n' +
    'Agroverse | ceremonial cacao for retail\n' +
    'garyjob@agroverse.shop\n'
  );
}

function bodyTemplateBulk_(shop) {
  return (
    'Hi —\n\n' +
    'Following up on the wholesale / bulk pricing overview for ' +
    shop +
    ". I've attached a brief two-page PDF: pricing and retail-pack terms on page 1, " +
    'farm taste profiles on page 2 (including cacao tea bulk pricing and traceability links).\n\n' +
    "I'm happy to answer questions by email or on a quick call — no need for another in-person stop on my side.\n\n" +
    'Thanks,\n' +
    'Gary\n' +
    'Agroverse | ceremonial cacao for retail\n' +
    'garyjob@agroverse.shop\n'
  );
}

function headerMap_(headerRow) {
  var m = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || '').trim();
    if (h) m[h] = i;
  }
  return m;
}

function normalizeEmail_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (!s || s.indexOf('@') === -1) return '';
  return s;
}
