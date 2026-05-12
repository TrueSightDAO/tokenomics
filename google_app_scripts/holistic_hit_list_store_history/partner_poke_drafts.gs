/**
 * Apps Script editor:
 * https://script.google.com/home/projects/14gKJ0VW49RsSn4S03pgxKXy0sp4Z7Z3Wm1Wj8jQiWW5dj1sFuPnp95sh/edit
 *
 * Partner Poke Drafts — Stage 1 of the AI-first supply chain scheduler.
 *
 * Plan and rationale: agentic_ai_context/PARTNER_POKE_SCHEDULER_v0.md
 *
 * What this file does
 * -------------------
 * 1. Reads partners-velocity.json + partners-inventory.json (the same JSONs
 *    the DApp notification bell's "Partner Stock" source consumes).
 * 2. Reads the operator-driven Partner Check-ins tab on Main Ledger for the
 *    last-check-in date + method per partner.
 * 3. Identifies partners flagged by stock/velocity signals (out of stock,
 *    running low, dormant) — same scoring rules as the bell.
 * 4. Applies a dynamic re-poke cadence:
 *      daily_rate          = sum(units_sold_last_90d)/90 (per-partner)
 *                              fallback: network average across retail partners
 *      days_until_stockout = current_inventory / daily_rate
 *      poke_trigger        = days_until_stockout < POKE_THRESHOLD_DAYS (default 21)
 *      re_poke_gate        = days_since_last_poke >= max(3, days_until_stockout/2)
 *    So a partner about to run out tomorrow gets re-poked sooner than one
 *    with two months of stock left.
 * 5. For each qualifying partner, calls Grok-3 via xAI (same LLM the existing
 *    suggest_warmup_prospect_drafts.py Python pipeline uses) to draft a short,
 *    2-3 sentence poke message in Gary's voice. Falls back to a static
 *    template if Grok errors out.
 * 6. Creates a Gmail draft under label "AI/Partner Poke":
 *      - If the partner has an email on file (joined via
 *        Agroverse Partners!E -> Contributors contact information!A -> !D),
 *        the draft is addressed to the partner.
 *      - Otherwise, the draft is addressed to OPERATOR_EMAIL as a reminder
 *        to poke the partner via their last-successful channel (Text, Phone,
 *        In Person, Email, Other).
 * 7. Logs every attempted draft to the Partner Poke Drafts tab on the Hit
 *    List spreadsheet for cadence enforcement on subsequent runs.
 *
 * Human-in-the-loop is enforced architecturally
 * --------------------------------------------
 * - No GmailApp.send() call anywhere in this file. createDraft only.
 * - DRY_RUN script property skips Gmail draft creation entirely and logs the
 *   intended drafts to Stackdriver. Use this for trust calibration in the
 *   first week of running.
 * - MAX_DRAFTS_PER_RUN caps each invocation (default 5) so a misconfigured
 *   threshold can't flood the inbox.
 * - MIN_DAYS_FLOOR (default 3) prevents same-day re-poking even for fast-
 *   depleting stores.
 *
 * Script Properties (Project settings -> Script properties), all optional:
 *   GROK_API_KEY          — required when LLM_PROVIDER=grok (default).
 *   GROK_MODEL            — default 'grok-3'.
 *   LLM_PROVIDER          — 'grok' (default) or 'template' to skip LLM.
 *   OPERATOR_EMAIL        — Gary's mailbox; default Session.getActiveUser().getEmail().
 *   POKE_THRESHOLD_DAYS   — default 21.
 *   MIN_DAYS_FLOOR        — default 3 (re-poke gate absolute floor).
 *   MAX_DRAFTS_PER_RUN    — default 5; 0 disables the cap.
 *   DRY_RUN               — 'true' to log without creating Gmail drafts.
 *   POKE_DRAFT_LOG_SHEET  — default 'Partner Poke Drafts' (created if missing).
 *   EXPECTED_MAILBOX      — abort if Session.getActiveUser().getEmail() differs.
 *
 * Manual setup checklist (one-time)
 * ---------------------------------
 * 1. Add this file to the Apps Script project at the URL above.
 * 2. Set GROK_API_KEY in Script Properties (reuse the same value the Python
 *    pipeline uses).
 * 3. Run runPartnerPokeDrafts() from the IDE Run button with DRY_RUN=true
 *    for the first invocation; check Stackdriver to confirm sensible output.
 * 4. Flip DRY_RUN=false, run again, confirm Gmail drafts appear under
 *    AI/Partner Poke and rows appear in Partner Poke Drafts.
 * 5. Gary reviews drafts in Gmail (or in the new tab on warmup_review.html
 *    once the DApp side ships), sends or skips.
 * 6. v0.1 (deferred): time-based trigger for daily auto-run.
 */

// ====================================================================
// CONSTANTS
// ====================================================================

var MAIN_SPREADSHEET_ID    = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var HIT_LIST_SPREADSHEET_ID = '1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc';

var VELOCITY_URL  = 'https://raw.githubusercontent.com/TrueSightDAO/agroverse-inventory/main/partners-velocity.json';
var INVENTORY_URL = 'https://raw.githubusercontent.com/TrueSightDAO/agroverse-inventory/main/partners-inventory.json';

var PARTNER_CHECK_INS_SHEET   = 'Partner Check-ins';                  // on MAIN_SPREADSHEET_ID
var AGROVERSE_PARTNERS_SHEET  = 'Agroverse Partners';                  // on MAIN_SPREADSHEET_ID
var CONTACT_SHEET             = 'Contributors contact information';   // on MAIN_SPREADSHEET_ID
var POKE_DRAFT_LOG_DEFAULT    = 'Partner Poke Drafts';                 // on HIT_LIST_SPREADSHEET_ID

var LABEL_NAME = 'AI/Partner Poke';

var GROK_ENDPOINT      = 'https://api.x.ai/v1/chat/completions';
var DEFAULT_GROK_MODEL = 'grok-3';

var RETAIL_PARTNER_TYPES = { 'Consignment': true, 'Wholesale': true };

var POKE_THRESHOLD_DAYS_DEFAULT = 21;
var MIN_DAYS_FLOOR_DEFAULT      = 3;
var MAX_DRAFTS_PER_RUN_DEFAULT  = 5;

var PROTOCOL_VERSION = 'PARTNER_POKE_SCHEDULER v0';

var LOG_HEADERS = [
  'suggestion_id',
  'created_at_utc',
  'partner_id',
  'partner_name',
  'to_email',
  'is_self_poke',
  'gmail_draft_id',
  'subject',
  'body_preview',
  'llm_provider',
  'llm_model',
  'signal_reason',
  'days_until_stockout',
  'status',
  'notes'
];

// ====================================================================
// MENU
// ====================================================================

function onOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  ss.addMenu('Partner Poke Drafts', [
    { name: 'Run Partner Poke Drafts', functionName: 'runPartnerPokeDrafts' },
    { name: 'Run (DRY_RUN preview)',   functionName: 'runPartnerPokeDraftsDryRun' }
  ]);
}

function runPartnerPokeDraftsDryRun() {
  var prevDryRun = PropertiesService.getScriptProperties().getProperty('DRY_RUN');
  PropertiesService.getScriptProperties().setProperty('DRY_RUN', 'true');
  try { runPartnerPokeDrafts(); }
  finally {
    if (prevDryRun === null) PropertiesService.getScriptProperties().deleteProperty('DRY_RUN');
    else PropertiesService.getScriptProperties().setProperty('DRY_RUN', prevDryRun);
  }
}

// ====================================================================
// MAIN ENTRY POINT
// ====================================================================

function runPartnerPokeDrafts() {
  var startedAt = new Date();
  var props     = PropertiesService.getScriptProperties();
  var dryRun    = (props.getProperty('DRY_RUN') || '').toLowerCase() === 'true';
  var cap       = parseInt(props.getProperty('MAX_DRAFTS_PER_RUN') || String(MAX_DRAFTS_PER_RUN_DEFAULT), 10);
  var threshold = parseInt(props.getProperty('POKE_THRESHOLD_DAYS') || String(POKE_THRESHOLD_DAYS_DEFAULT), 10);
  var floor     = parseInt(props.getProperty('MIN_DAYS_FLOOR')      || String(MIN_DAYS_FLOOR_DEFAULT),      10);
  var operator  = props.getProperty('OPERATOR_EMAIL') || Session.getActiveUser().getEmail();

  var expected = (props.getProperty('EXPECTED_MAILBOX') || '').toLowerCase();
  var actualMb = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (expected && expected !== actualMb) {
    throw new Error('Mailbox guard tripped: expected ' + expected + ', running as ' + actualMb);
  }

  Logger.log('[partner-poke] start dry_run=%s cap=%s threshold=%s floor=%s operator=%s',
             dryRun, cap, threshold, floor, operator);

  var velocity   = fetchJson_(VELOCITY_URL);
  var inventory  = fetchJson_(INVENTORY_URL);
  if (!velocity || !velocity.partners) {
    throw new Error('Could not load partners-velocity.json');
  }

  var contributorEmailById = loadContributorsContacts_();
  var contributorByPartner = loadAgroversePartners_();
  var lastCheckInByPartner = loadPartnerCheckIns_();
  var lastPokeByPartner    = loadPartnerPokeLog_();
  var networkDailyRate     = computeNetworkAverageRate_(velocity);

  Logger.log('[partner-poke] loaded velocity=%s inventory=%s contacts=%s partner_map=%s checkins=%s prior_pokes=%s networkRate=%s',
             Object.keys(velocity.partners).length,
             inventory && inventory.partners ? Object.keys(inventory.partners).length : 0,
             Object.keys(contributorEmailById).length,
             Object.keys(contributorByPartner).length,
             Object.keys(lastCheckInByPartner).length,
             Object.keys(lastPokeByPartner).length,
             networkDailyRate);

  var candidates = [];
  Object.keys(velocity.partners).forEach(function (slug) {
    if (slug.indexOf('/') !== -1) return;  // skip cooperative-style slugs
    var vel = velocity.partners[slug];
    var ptype = (vel && vel.partner_type) || 'Consignment';
    if (RETAIL_PARTNER_TYPES[ptype] !== true) return;

    var inv = inventory && inventory.partners && inventory.partners[slug];
    var attention = computeAttention_(vel, inv);
    if (!attention) return;  // not flagged

    var dailyRate = computeDailyRateForPartner_(vel) || networkDailyRate;
    var daysUntilStockout = (attention.totalInv > 0 && dailyRate > 0)
      ? attention.totalInv / dailyRate
      : 0;  // out of stock or no rate data => 0 days

    var lastPoke = lastPokeByPartner[slug];
    var daysSincePoke = lastPoke ? daysBetween_(lastPoke, new Date()) : Infinity;
    var gate = Math.max(floor, daysUntilStockout / 2);

    // Trigger: stockout horizon under threshold OR already out of stock.
    var triggered = (daysUntilStockout < threshold) || (attention.totalInv === 0);
    if (!triggered) return;
    if (daysSincePoke < gate) {
      Logger.log('[partner-poke] skip %s — last poke %sd ago, gate=%sd', slug, daysSincePoke, gate);
      return;
    }

    candidates.push({
      slug: slug,
      partner_name: (vel && vel.partner_name) || slugDisplayName_(slug),
      location:     (vel && vel.location)     || '',
      partner_type: ptype,
      items:        (vel && vel.items)        || {},
      attention:    attention,
      daily_rate:   dailyRate,
      days_until_stockout: daysUntilStockout,
      last_check_in: lastCheckInByPartner[slug] || null
    });
  });

  // Sort: out-of-stock first (urgency), then by days_until_stockout asc
  candidates.sort(function (a, b) {
    var aOut = a.attention.totalInv === 0 ? 1 : 0;
    var bOut = b.attention.totalInv === 0 ? 1 : 0;
    if (aOut !== bOut) return bOut - aOut;
    return a.days_until_stockout - b.days_until_stockout;
  });

  if (cap > 0) candidates = candidates.slice(0, cap);

  Logger.log('[partner-poke] %s candidates after filter+cap', candidates.length);
  if (!candidates.length) {
    Logger.log('[partner-poke] no candidates — exiting cleanly');
    return;
  }

  var logSheetName = props.getProperty('POKE_DRAFT_LOG_SHEET') || POKE_DRAFT_LOG_DEFAULT;
  var logSheet = ensurePokeLogSheet_(logSheetName);

  candidates.forEach(function (c) {
    try {
      processCandidate_(c, {
        operator: operator,
        contributorEmailById: contributorEmailById,
        contributorByPartner: contributorByPartner,
        dryRun: dryRun,
        logSheet: logSheet
      });
    } catch (err) {
      Logger.log('[partner-poke] %s ERROR: %s', c.slug, err);
      appendLogRow_(logSheet, {
        partner_id: c.slug,
        partner_name: c.partner_name,
        status: 'error',
        notes: String(err).slice(0, 480)
      });
    }
  });

  Logger.log('[partner-poke] done in %sms', new Date().getTime() - startedAt.getTime());
}

// ====================================================================
// PER-CANDIDATE PROCESSING
// ====================================================================

function processCandidate_(c, ctx) {
  var contributorId = ctx.contributorByPartner[c.slug] || null;
  var email = (contributorId && ctx.contributorEmailById[contributorId]) || '';
  var isSelfPoke = !email;

  var grokRes = null;
  var llmProvider = 'template';
  var llmModel = '';
  var props = PropertiesService.getScriptProperties();
  var preferGrok = ((props.getProperty('LLM_PROVIDER') || 'grok').toLowerCase() === 'grok');
  if (preferGrok && props.getProperty('GROK_API_KEY')) {
    try {
      grokRes = generateGrokDraft_(c, isSelfPoke);
      if (grokRes && grokRes.body) {
        llmProvider = 'grok';
        llmModel = grokRes.model || (props.getProperty('GROK_MODEL') || DEFAULT_GROK_MODEL);
      }
    } catch (err) {
      Logger.log('[partner-poke] %s Grok failed, falling back to template: %s', c.slug, err);
    }
  }

  var draft;
  if (isSelfPoke) draft = buildSelfPokeDraft_(c, grokRes);
  else draft = buildPartnerEmailDraft_(c, grokRes);

  var toAddr = isSelfPoke ? ctx.operator : email;
  if (!toAddr) {
    appendLogRow_(ctx.logSheet, {
      partner_id: c.slug, partner_name: c.partner_name,
      status: 'skipped_no_recipient',
      signal_reason: c.attention.reasons.join('; '),
      notes: 'No partner email and no OPERATOR_EMAIL configured'
    });
    return;
  }

  if (ctx.dryRun) {
    Logger.log('[partner-poke] DRY_RUN draft to=%s subject=%s body=%s',
               toAddr, draft.subject, draft.body.slice(0, 240));
    appendLogRow_(ctx.logSheet, {
      partner_id: c.slug,
      partner_name: c.partner_name,
      to_email: toAddr,
      is_self_poke: isSelfPoke,
      subject: draft.subject,
      body_preview: draft.body.slice(0, 240),
      llm_provider: llmProvider,
      llm_model: llmModel,
      signal_reason: c.attention.reasons.join('; '),
      days_until_stockout: Math.round(c.days_until_stockout * 10) / 10,
      status: 'dry_run'
    });
    return;
  }

  var htmlBody = renderHtmlBody_(draft.body, c, draft.suggestionId);
  var gmailDraft = GmailApp.createDraft(toAddr, draft.subject, draft.body, { htmlBody: htmlBody });
  applyLabel_(gmailDraft, LABEL_NAME);

  appendLogRow_(ctx.logSheet, {
    partner_id: c.slug,
    partner_name: c.partner_name,
    to_email: toAddr,
    is_self_poke: isSelfPoke,
    gmail_draft_id: gmailDraft.getId(),
    subject: draft.subject,
    body_preview: draft.body.slice(0, 240),
    llm_provider: llmProvider,
    llm_model: llmModel,
    signal_reason: c.attention.reasons.join('; '),
    days_until_stockout: Math.round(c.days_until_stockout * 10) / 10,
    status: 'draft_created'
  });

  Logger.log('[partner-poke] draft created for %s -> %s (self_poke=%s)', c.slug, toAddr, isSelfPoke);
}

// ====================================================================
// DATA LOADERS
// ====================================================================

function fetchJson_(url) {
  try {
    var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('[partner-poke] fetch %s -> HTTP %s', url, resp.getResponseCode());
      return null;
    }
    return JSON.parse(resp.getContentText());
  } catch (err) {
    Logger.log('[partner-poke] fetchJson_ %s error: %s', url, err);
    return null;
  }
}

function loadContributorsContacts_() {
  // Returns map: contributor_name (Col A) -> email (Col D), filtered to non-empty emails.
  var out = {};
  try {
    var ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CONTACT_SHEET);
    if (!sheet) return out;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return out;
    var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();  // A..D
    rows.forEach(function (row) {
      var name = String(row[0] || '').trim();
      var email = String(row[3] || '').trim();
      if (name && email) out[name] = email;
    });
  } catch (err) {
    Logger.log('[partner-poke] loadContributorsContacts_ error: %s', err);
  }
  return out;
}

function loadAgroversePartners_() {
  // Returns map: partner_id (slug, Col A) -> contributor_contact_id (Col E).
  var out = {};
  try {
    var ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(AGROVERSE_PARTNERS_SHEET);
    if (!sheet) {
      Logger.log('[partner-poke] %s sheet not found', AGROVERSE_PARTNERS_SHEET);
      return out;
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return out;
    var rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();  // A..E
    rows.forEach(function (row) {
      var partnerId = String(row[0] || '').trim();
      var contributorId = String(row[4] || '').trim();
      if (partnerId && contributorId) out[partnerId] = contributorId;
    });
  } catch (err) {
    Logger.log('[partner-poke] loadAgroversePartners_ error: %s', err);
  }
  return out;
}

function loadPartnerCheckIns_() {
  // Returns map: partner_id -> { check_in_date, method, notes } (most recent only).
  var out = {};
  try {
    var ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PARTNER_CHECK_INS_SHEET);
    if (!sheet) return out;
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return out;
    var headers = values[0].map(function (h) { return String(h || '').trim(); });
    var idxPartner = headers.indexOf('Partner ID');
    var idxDate    = headers.indexOf('Check-in Date');
    var idxMethod  = headers.indexOf('Method');
    var idxNotes   = headers.indexOf('Notes');
    if (idxPartner < 0) return out;
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var pid = String(row[idxPartner] || '').trim();
      if (!pid) continue;
      var dateStr = idxDate >= 0 ? String(row[idxDate] || '').trim() : '';
      var prior = out[pid];
      if (!prior || (dateStr && dateStr > (prior.check_in_date || ''))) {
        out[pid] = {
          check_in_date: dateStr,
          method:        idxMethod >= 0 ? String(row[idxMethod] || '').trim() : '',
          notes:         idxNotes  >= 0 ? String(row[idxNotes]  || '').trim() : ''
        };
      }
    }
  } catch (err) {
    Logger.log('[partner-poke] loadPartnerCheckIns_ error: %s', err);
  }
  return out;
}

function loadPartnerPokeLog_() {
  // Returns map: partner_id -> Date of most recent log entry where status='draft_created' or 'dry_run'.
  var out = {};
  var sheetName = PropertiesService.getScriptProperties().getProperty('POKE_DRAFT_LOG_SHEET') || POKE_DRAFT_LOG_DEFAULT;
  try {
    var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return out;
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return out;
    var headers = values[0].map(function (h) { return String(h || '').trim(); });
    var iCreated = headers.indexOf('created_at_utc');
    var iPartner = headers.indexOf('partner_id');
    var iStatus  = headers.indexOf('status');
    if (iCreated < 0 || iPartner < 0) return out;
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var status = iStatus >= 0 ? String(row[iStatus] || '').trim() : '';
      if (status !== 'draft_created' && status !== 'dry_run') continue;
      var pid = String(row[iPartner] || '').trim();
      var when = new Date(String(row[iCreated] || ''));
      if (!pid || isNaN(when.getTime())) continue;
      if (!out[pid] || when > out[pid]) out[pid] = when;
    }
  } catch (err) {
    Logger.log('[partner-poke] loadPartnerPokeLog_ error: %s', err);
  }
  return out;
}

// ====================================================================
// SCORING / FILTERING
// ====================================================================

function computeAttention_(vel, inv) {
  // Mirrors dapp/partner_check_in.html computeAttentionList() severity rules.
  var totalInv = 0;
  var reasons = [];
  var severity = null;

  if (inv && inv.items) {
    inv.items.forEach(function (it) { totalInv += (it.venueInventory || 0); });
    if (totalInv === 0) {
      reasons.push('out of stock');
      severity = 'critical';
    } else if (totalInv <= 3) {
      reasons.push('running low (' + totalInv + ' left)');
      severity = 'warning';
    }
  }

  if (vel && vel.items) {
    Object.keys(vel.items).forEach(function (sku) {
      var it = vel.items[sku];
      if (it.last_sale_date) {
        var ds = daysSinceIso_(it.last_sale_date);
        if (ds !== null && ds > 45) {
          reasons.push('last sale ' + relativeAge_(it.last_sale_date));
          if (!severity) severity = 'info';
        }
      }
    });
  }

  if (!reasons.length) return null;
  return { severity: severity, reasons: reasons, totalInv: totalInv };
}

function computeDailyRateForPartner_(vel) {
  // Sum units sold across all SKUs in the last 90 days, divide by 90.
  if (!vel || !vel.items) return 0;
  var total = 0;
  Object.keys(vel.items).forEach(function (sku) {
    var it = vel.items[sku];
    var u90 = Number(it.units_last_90_days || it.units_90d || 0);
    if (isFinite(u90)) total += u90;
  });
  return total > 0 ? (total / 90) : 0;
}

function computeNetworkAverageRate_(velocity) {
  if (!velocity || !velocity.partners) return 0;
  var rates = [];
  Object.keys(velocity.partners).forEach(function (slug) {
    if (slug.indexOf('/') !== -1) return;
    var vel = velocity.partners[slug];
    var ptype = (vel && vel.partner_type) || 'Consignment';
    if (RETAIL_PARTNER_TYPES[ptype] !== true) return;
    var r = computeDailyRateForPartner_(vel);
    if (r > 0) rates.push(r);
  });
  if (!rates.length) return 0;
  var sum = 0; rates.forEach(function (x) { sum += x; });
  return sum / rates.length;
}

// ====================================================================
// GROK CALL
// ====================================================================

function generateGrokDraft_(c, isSelfPoke) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('GROK_API_KEY');
  if (!apiKey) throw new Error('GROK_API_KEY not set in Script Properties');
  var model = props.getProperty('GROK_MODEL') || DEFAULT_GROK_MODEL;

  var systemPrompt = isSelfPoke ? grokSystemPromptSelfPoke_() : grokSystemPromptPartner_();
  var userPrompt   = grokUserPrompt_(c, isSelfPoke);

  var payload = {
    model: model,
    temperature: 0.4,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ]
  };

  var resp = UrlFetchApp.fetch(GROK_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Grok HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 400));
  }
  var data = JSON.parse(resp.getContentText());
  var choices = data && data.choices ? data.choices : [];
  if (!choices.length) throw new Error('Grok returned no choices');
  var content = String((choices[0].message || {}).content || '').trim();

  // Strip code fences if present.
  if (content.indexOf('```json') !== -1) {
    var a = content.indexOf('```json') + 7;
    var b = content.indexOf('```', a);
    if (b > a) content = content.slice(a, b).trim();
  } else if (content.indexOf('```') === 0) {
    var a2 = content.indexOf('```') + 3;
    var b2 = content.indexOf('```', a2);
    if (b2 > a2) content = content.slice(a2, b2).trim();
  }

  var parsed;
  try { parsed = JSON.parse(content); }
  catch (e) { throw new Error('Grok response not valid JSON: ' + content.slice(0, 200)); }

  var subj = String(parsed.subject || '').trim();
  var body = String(parsed.body    || '').trim();
  if (!subj || !body) throw new Error('Grok JSON missing subject or body');
  return { subject: subj, body: body, model: model };
}

function grokSystemPromptPartner_() {
  return (
    'You are drafting a short, warm message from Gary at Agroverse to an existing retail partner who ' +
    'carries our regenerative cacao. Your draft will be reviewed and edited by Gary before sending. ' +
    'Constraints: 2-3 sentences maximum. Conversational, not corporate. Do not say "I noticed..." or ' +
    '"I am reaching out..." — those sound auto-generated. Suggest ONE specific next step (restock check, ' +
    'quick call, visit if Gary is in the area). Do not include a signature or greeting Gary would add ' +
    'himself. Output strict JSON {"subject": "...", "body": "..."} with no commentary.'
  );
}

function grokSystemPromptSelfPoke_() {
  return (
    'You are drafting a SHORT reminder note from Gary to HIMSELF about poking an existing Agroverse ' +
    'retail partner who does not have an email on file. The body is a self-reminder, not a message to ' +
    'the partner. Mention: partner name, location, the signal flag (out of stock / running low / ' +
    'dormant), the last successful contact channel if any, and a one-line suggested next step. ' +
    '2-3 sentences max. Output strict JSON {"subject": "...", "body": "..."} with no commentary.'
  );
}

function grokUserPrompt_(c, isSelfPoke) {
  var lci = c.last_check_in || {};
  var lciStr = lci.check_in_date
    ? (lci.check_in_date + (lci.method ? ' via ' + lci.method : '') + (lci.notes ? '. Notes: ' + lci.notes : ''))
    : 'no prior check-in on file';
  var skuList = Object.keys(c.items || {}).slice(0, 4).join(', ') || 'unknown';
  var lines = [
    'Partner: ' + c.partner_name + (c.location ? ' (' + c.location + ')' : ''),
    'Partner type: ' + c.partner_type,
    'Carries SKUs: ' + skuList,
    'Current signal: ' + c.attention.reasons.join('; '),
    'Days until stockout (estimate): ' + (Math.round(c.days_until_stockout * 10) / 10),
    'Last check-in: ' + lciStr
  ];
  if (isSelfPoke) {
    lines.push('NOTE: this partner does not have an email on file. Draft body is a reminder to Gary, not a message to the partner.');
  }
  return lines.join('\n');
}

// ====================================================================
// TEMPLATE FALLBACK
// ====================================================================

function buildPartnerEmailDraft_(c, grokRes) {
  var suggestionId = newSuggestionId_();
  if (grokRes && grokRes.body) {
    return { suggestionId: suggestionId, subject: grokRes.subject, body: grokRes.body };
  }
  var subj = 'Quick check-in — ' + c.partner_name;
  var firstName = (c.partner_name || '').split(/\s|—/)[0] || 'there';
  var reason = c.attention.reasons[0] || 'thinking of you';
  var body = (
    'Hey ' + firstName + ',\n\n' +
    'Quick check — looks like ' + reason + ' on the Agroverse side. ' +
    'Want me to get a restock out to you this week, or would a quick call be easier?\n\n' +
    '— Gary'
  );
  return { suggestionId: suggestionId, subject: subj, body: body };
}

function buildSelfPokeDraft_(c, grokRes) {
  var suggestionId = newSuggestionId_();
  if (grokRes && grokRes.body) {
    return { suggestionId: suggestionId, subject: grokRes.subject, body: grokRes.body };
  }
  var lci = c.last_check_in || {};
  var channel = lci.method || 'their usual channel';
  var subj = 'Poke ' + c.partner_name + ' — ' + (c.attention.reasons[0] || 'check in');
  var body = (
    'Reminder to poke ' + c.partner_name +
    (c.location ? ' (' + c.location + ')' : '') + ' today.\n\n' +
    'Signal: ' + c.attention.reasons.join('; ') + '\n' +
    'Last check-in: ' + (lci.check_in_date || 'no prior check-in') +
    (lci.method ? ' via ' + lci.method : '') + '.\n' +
    'Suggested channel: ' + channel + ' (they do not have an email on file).\n'
  );
  return { suggestionId: suggestionId, subject: subj, body: body };
}

function renderHtmlBody_(plainBody, c, suggestionId) {
  var safeBody = escapeHtml_(plainBody).replace(/\n/g, '<br>');
  var footer = (
    '<div style="margin-top:1.5em;padding-top:0.6em;border-top:1px solid #eee;font-size:11px;color:#888;">' +
    'Drafted by ' + escapeHtml_(PROTOCOL_VERSION) +
    ' · partner: <code>' + escapeHtml_(c.slug) + '</code>' +
    ' · suggestion: <code>' + escapeHtml_(suggestionId) + '</code>' +
    '</div>'
  );
  return (
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.45;">' +
    safeBody + footer + '</div>'
  );
}

// ====================================================================
// GMAIL DRAFT HELPERS
// ====================================================================

function applyLabel_(draft, labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);
  draft.getMessage().getThread().addLabel(label);
}

// ====================================================================
// LOGGING
// ====================================================================

function ensurePokeLogSheet_(sheetName) {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLogRow_(sheet, row) {
  var values = LOG_HEADERS.map(function (h) {
    if (row[h] !== undefined) return row[h];
    if (h === 'suggestion_id')  return newSuggestionId_();
    if (h === 'created_at_utc') return new Date().toISOString();
    return '';
  });
  sheet.appendRow(values);
}

// ====================================================================
// HELPERS
// ====================================================================

function daysSinceIso_(isoDate) {
  if (!isoDate) return null;
  var d = new Date(isoDate + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function daysBetween_(d1, d2) {
  if (!(d1 instanceof Date)) d1 = new Date(d1);
  if (!(d2 instanceof Date)) d2 = new Date(d2);
  return Math.floor((d2.getTime() - d1.getTime()) / 86400000);
}

function relativeAge_(isoDate) {
  var days = daysSinceIso_(isoDate);
  if (days === null) return 'unknown';
  if (days < 14)  return days + ' days ago';
  if (days < 60)  return Math.round(days / 7) + ' weeks ago';
  if (days < 365) return Math.round(days / 30) + ' months ago';
  return Math.round(days / 365 * 10) / 10 + ' years ago';
}

function slugDisplayName_(slug) {
  return String(slug || '').split('/').pop().split('-').map(function (w) {
    if (!w) return '';
    if (w.length <= 2) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ').trim();
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function newSuggestionId_() {
  return Utilities.getUuid().slice(0, 8);
}
