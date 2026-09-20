/**
 * File: google_app_scripts/1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT/process_payout_event_telegram_logs.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script project: 1MnAsIQAxcSfZO_hALOtMFJ4y1k4OnqeXKMwYs6xev600rPNUYepqcXsT
 *
 * Async scanner for `[PAYOUT EVENT]` rows (SS12 of
 * plans/CRF_ANAPU_SUNMINT_COHORT_PROPOSAL.md) on the canonical Telegram Chat
 * Logs intake (1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ).
 *
 * A `[PAYOUT REGISTRATION]` (SS11) is a planter DECLARING where to be paid. A
 * `[PAYOUT EVENT]` (this file) is the RECEIPT of an outbound transfer - a PIX
 * disbursement that actually occurred. The governor submits it from the DApp
 * module report_payout_event.html; the signed event routes via Edgar, which
 * writes the payload into Telegram Chat Logs col G and fires this scanner
 * (?action=processPayoutEventsFromTelegramChatLogs - the action name is the
 * contract fixed by dao_protocol dispatch SS12.7 Q3a).
 *
 * DUAL WRITE (SS12.2):
 *   Tier-1 (universal, ANY source) -> `payouts` tab, on the Ops workbook
 *                                     (=== this intake workbook, sibling tab).
 *   Tier-2 (CFR only)              -> `payout events` tab, on the PRIVATE,
 *                                     governor-only `cfr program` spreadsheet.
 * CFR source = program_slug === 'crf-anapu' OR Submission Source host is
 * cfr.truesight.me.
 *
 * PII (SS12.1): a `[PAYOUT EVENT]` carries NO raw PII - it references the
 * recipient by recipient_pk_hash (or the literal unlinked_recipient) and the
 * transfer by bank_ref. Because no raw key is present, writing the col R marker
 * on the publicly-republished intake workbook is safe, and this event is NOT
 * added to excluded_pii_events.
 *
 * DEDUP (SS12.3) - TWO layers, BOTH required:
 *   (1) intake-row gate: col R marker `PROCESSED:PAYOUT_EVENT` (the canonical
 *       Telegram Chat Logs convention), so one intake row is handled once.
 *   (2) business key `bank_ref` (the PIX E2E id / TXID - the reconciliation
 *       anchor). Edgar mints a FRESH telegram_update_id on every POST, so the
 *       DApp's submitWithRetry(attempts:3) can produce TWO intake rows for ONE
 *       transfer when a delivery confirmation is lost. Layer (1) cannot catch
 *       that (two distinct update ids); a bank_ref already present on the target
 *       tab is therefore treated as a duplicate and NOT re-booked. This is the
 *       acceptance criterion that makes the 3x retry safe.
 *
 * status domain: for a booked transfer the col carries the event's own Status
 * (`live` = captured live, `backfill` = reconstructed) so an auditor can tell
 * the two apart. An audit row that could not be booked carries REJECTED_* / error.
 *
 * Idempotent. Serialized via LockService. A self-installing hourly safety-net
 * cron catches anything the webhook missed.
 *
 * Mirrors process_payout_registration_telegram_logs.js (same Apps Script project).
 */

/** Canonical intake workbook; ALSO the Ops workbook that hosts Tier-1 `payouts`. */
var PAYOUT_EVENT_OPS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var PAYOUT_EVENT_TELEGRAM_SHEET = 'Telegram Chat Logs';

/** Governor-gated provisioning (SS11.8): the private `cfr program` spreadsheet. */
var PAYOUT_EVENT_CFR_PROGRAM_PROPERTY = 'CFR_PROGRAM_SPREADSHEET_ID';
var PAYOUT_EVENT_CFR_PROGRAM_SPREADSHEET_ID = '';

/** SS12.3 schemas - MUST match scripts/provision_cfr_program_sheet.py exactly. */
var PAYOUT_EVENT_TIER1_HEADERS = [
  'created_at_utc',
  'telegram_update_id',
  'program_slug',
  'submission_source',
  'recipient_pk_hash',
  'amount',
  'currency',
  'tree_planting_id',
  'bank_ref_type',
  'bank_ref',
  'paid_at',
  'receipt_url',
  'status',
  'supersedes_row',
  'error_message'
];
var PAYOUT_EVENT_TIER2_HEADERS = PAYOUT_EVENT_TIER1_HEADERS.concat(['cohort', 'student_ref']);

var PAYOUT_EVENT_TIER1_TAB = 'payouts';
var PAYOUT_EVENT_TIER2_TAB = 'payout events';

var PAYOUT_EVENT_TAG = '[PAYOUT EVENT]';

/** Telegram Chat Logs cols (zero-based). Col R (index 17) is the dedup gate. */
var PAYOUT_EVENT_TC_UPDATE_ID_COL = 0;
var PAYOUT_EVENT_TC_MESSAGE_ID_COL = 3;
var PAYOUT_EVENT_TC_MESSAGE_COL = 6;
var PAYOUT_EVENT_TC_DEDUP_COL = 17;                 // column R
var PAYOUT_EVENT_PROCESSED_MARKER = 'PROCESSED:PAYOUT_EVENT';

/** CFR-source detection (SS12.2). */
var PAYOUT_EVENT_CFR_SLUG = 'crf-anapu';
var PAYOUT_EVENT_CFR_HOST = 'cfr.truesight.me';

var PAYOUT_EVENT_SCAN_BATCH = 200;
var PAYOUT_EVENT_DEFAULT_CURRENCY = 'BRL';
var PAYOUT_EVENT_UNLINKED_RECIPIENT = 'unlinked_recipient';
var PAYOUT_EVENT_UNLINKED_TREES = 'unlinked';

/**
 * PR4 - SunMint farmer settlement ([FARMER PAYMENT EVENT]) ledger legs.
 * Spec: agentic_ai_context/plans/SUNMINT_FARMER_SETTLEMENT_AND_BATCH_LINK_PLAN.md SS1.2 / SS1.4 / SS0.11.
 * A `[PAYOUT EVENT]` that carries a `tree_planting_id` settles a SunMint unit (SS0.10) - no new
 * event or tag is introduced. The three tree-planting literals are plain string line-items
 * (tokenomics/SCHEMA.md -> Tree-Planting Ledger Literals), never `Currencies` rows.
 */
var FPE_TO_BE_PAID_LITERAL = 'Cacao Tree - To Be Paid For';
var FPE_PLANTED_UNASSIGNED_LITERAL = 'Cacao Tree Planted - Unassigned';
var FPE_MAIN_LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var FPE_MAIN_OFFCHAIN_TAB = 'offchain transactions';
var FPE_MANAGED_TRANSACTIONS_TAB = 'Transactions';
var FPE_QR_CODES_SHEET = 'Agroverse QR codes';
var FPE_QR_LEDGER_URL_COL = 2;                  // Column C (0-based) -> the QR's own ledger URL
var FPE_SHIPMENT_LEDGER_LISTING_TAB = 'Shipment Ledger Listing';
var FPE_SUNMINT_TAB = 'SunMint Tree Planting';
var FPE_SUNMINT_LINKED_QR_COL = 17;             // Column R (0-based) -> Linked QR Code
var FPE_MAIN_LEDGER_LEDGER_URLS = [             // ledger URLs whose fulfilment routes to the MAIN ledger
  'https://agroverse.shop/agl4',
  'https://truesight.me/sunmint/main'
];
// Is-Revenue flag per leg kind on the main `offchain transactions` tab: a cash-out (payout) leg is
// NOT revenue -> blank (Envoy, 2026-09-20); the inventory legs match PR3's settlement rows ('N').
var FPE_CASH_IS_REVENUE = '';
var FPE_INVENTORY_IS_REVENUE = 'N';

/** Resolve the private `cfr program` spreadsheet (SS11.8). */
function payoutEventCfrProgramSpreadsheet_() {
  var id = '';
  try {
    var props = PropertiesService.getScriptProperties();
    if (props) id = String(props.getProperty(PAYOUT_EVENT_CFR_PROGRAM_PROPERTY) || '').trim();
  } catch (e) {}
  if (!id) id = String(PAYOUT_EVENT_CFR_PROGRAM_SPREADSHEET_ID || '').trim();
  if (!id) {
    throw new Error(
      'The private `cfr program` spreadsheet id is not set (SS11.8). Set the script ' +
      'property "' + PAYOUT_EVENT_CFR_PROGRAM_PROPERTY + '" to the governor-created sheet id.'
    );
  }
  return SpreadsheetApp.openById(id);
}

/**
 * Idempotently ensure one tab exists with `headers` on row 1. Never deletes,
 * reorders, or overwrites non-header data; throws rather than clobber a tab whose
 * row 1 holds different headers. Mirrors ensurePayoutRegTab_.
 */
function payoutEventEnsureTab_(spreadsheet, tabName, headers) {
  var sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(tabName);
    sheet.appendRow(headers);
    return sheet;
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var row1Blank = true;
  for (var b = 0; b < firstRow.length; b++) {
    if (String(firstRow[b] || '').trim() !== '') { row1Blank = false; break; }
  }
  if (lastRow === 0 || row1Blank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  var matches = true;
  for (var i = 0; i < headers.length; i++) {
    if (String(firstRow[i] || '').trim() !== headers[i]) { matches = false; break; }
  }
  if (matches) return sheet;
  if (lastRow <= 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  throw new Error(
    'Sheet "' + tabName + '" row 1 must be exactly: ' + headers.join(', ') +
    '. Fix row 1 in the spreadsheet, or move existing data so row 1 can be replaced.'
  );
}

/**
 * Normalise a `- Field: value` label into a canonical snake_case key, folding the
 * human-readable aliases the DApp summary uses into the SS12.3 column names.
 */
function payoutEventNormKey_(key) {
  var k = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  var alias = {
    'program': 'program_slug',
    'program_slug': 'program_slug',
    'amount': 'amount',
    'currency': 'currency',
    'paid_at': 'paid_at',
    'bank_ref_type': 'bank_ref_type',
    'bank_ref': 'bank_ref',
    'recipient': 'recipient',
    'recipient_pk_hash': 'recipient_pk_hash',
    'planting_identity_pk_hash': 'recipient_pk_hash',
    'tree_planting_id': 'tree_planting_id',
    'tree_planting_ids': 'tree_planting_id',
    'trees': 'tree_planting_id',
    'status': 'status',
    'receipt_url': 'receipt_url',
    'submission_source': 'submission_source',
    'cohort': 'cohort',
    'student_ref': 'student_ref'
  };
  return alias[k] || k;
}

/**
 * Parse `- Field: value` lines from a signed payload. Generic over field names;
 * mirrors parsePayoutRegistrationEventText_ in the sibling scanner. Handles the
 * label aliases via payoutEventNormKey_ and the snake_case forms as-is.
 */
function parsePayoutEventText_(body) {
  var result = {};
  var lines = String(body || '').split(/\r?\n/);
  var lastKey = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] == null) continue;
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf(PAYOUT_EVENT_TAG) === 0) continue;
    if (line === '--------') continue;
    var isField = line.charAt(0) === '-';
    var probe = isField ? line.substring(1).trim() : line;
    var m = probe.match(/^([A-Za-z][A-Za-z0-9_\s\/\-()]*):\s*(.*)$/);
    if (m && isField) {
      var key = payoutEventNormKey_(m[1]);
      result[key] = m[2].trim();
      lastKey = key;
    } else if (lastKey) {
      result[lastKey] = (result[lastKey] ? result[lastKey] + ' ' : '') + line;
    }
  }
  return result;
}

/** True only when the tag is the FIRST non-empty line (not merely mentioned in text). */
function isPayoutEvent_(message) {
  var lines = String(message || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (!t) continue;
    return t.indexOf(PAYOUT_EVENT_TAG) === 0;
  }
  return false;
}

function payoutEventCleanValue_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\(pending governor assignment\)$/i.test(s) || /^n\/a$/i.test(s)) return '';
  return s;
}

/** Comma/space-joined tree id list -> canonical, de-duplicated, comma-joined string. */
function payoutEventNormaliseTreeIds_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var parts = s.split(/[,\n;]+/);
  var out = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!p) continue;
    if (seen[p]) continue;
    seen[p] = true;
    out.push(p);
  }
  return out.join(', ');
}

/** True when this event concerns the CFR cohort (SS12.2). */
function payoutEventIsCfr_(programSlug, submissionSource) {
  var slug = String(programSlug || '').trim().toLowerCase();
  if (slug === PAYOUT_EVENT_CFR_SLUG) return true;
  var src = String(submissionSource || '').trim().toLowerCase();
  if (!src) return false;
  var host = '';
  var m = src.match(/^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/);
  if (m) host = m[1].toLowerCase();
  else host = src.replace(/[\/?#].*$/, '').toLowerCase();
  host = host.replace(/:\d+$/, '');
  return host === PAYOUT_EVENT_CFR_HOST;
}

/** Build one Tier-1/Tier-2 row (aligned to PAYOUT_EVENT_TIER1/2_HEADERS order). */
function payoutEventBuildRow_(p, tier2) {
  var row = [
    String(p.created_at_utc || ''),        // created_at_utc
    String(p.telegram_update_id || ''),    // telegram_update_id
    String(p.program_slug || ''),          // program_slug
    String(p.submission_source || ''),     // submission_source
    String(p.recipient_pk_hash || ''),     // recipient_pk_hash
    String(p.amount == null ? '' : p.amount),       // amount
    String(p.currency || ''),              // currency
    String(p.tree_planting_id || ''),      // tree_planting_id
    String(p.bank_ref_type || ''),         // bank_ref_type
    String(p.bank_ref || ''),              // bank_ref
    String(p.paid_at || ''),               // paid_at
    String(p.receipt_url || ''),           // receipt_url
    String(p.status || ''),                // status
    String(p.supersedes_row || ''),        // supersedes_row
    String(p.error_message || '')          // error_message
  ];
  if (tier2) { row.push(String(p.cohort || ''), String(p.student_ref || '')); }
  return row;
}

/** Append a row to a tier tab. */
function appendPayoutEventRow_(sheet, p, tier2) {
  sheet.appendRow(payoutEventBuildRow_(p, tier2));
}

/**
 * Scan the `bank_ref` column of an already-loaded grid -> set of seen values.
 * Used for the SS12.3 layer-(2) business-key dedup.
 */
function payoutEventCollectBankRefs_(values) {
  var seen = {};
  if (!values || values.length < 2) return seen;
  var header = values[0].map(function (h) { return String(h || '').trim(); });
  var idx = {};
  header.forEach(function (h, i) { if (h) idx[h] = i; });
  var bIdx = idx['bank_ref'];
  if (bIdx == null) return seen;
  for (var r = 1; r < values.length; r++) {
    var v = String(values[r][bIdx] || '').trim();
    if (v) seen[v] = true;
  }
  return seen;
}

/**
 * PR4 - pure SS0.11 leg computation for a settled SunMint unit. NO I/O (unit-testable).
 * Returns the ledger legs a `[FARMER PAYMENT EVENT]` must write, as an ordered list of
 * { target:'main'|'qr', amount:Number, literal:String, kind:'cash'|'inventory', isRevenue:String,
 *   contributor:String }. An empty array means "refuse" (bad amount / no currency).
 *
 *   committed + QR ledger != main -> cross-ledger TRANSFER (SS0.11): -cash on the QR's own ledger,
 *                                    +cash on main, -1 "Cacao Tree - To Be Paid For" on main.
 *   committed + QR ledger  = main -> the two cash legs collapse; only -1 To Be Paid For remains.
 *   uncommitted                   -> -cash, -1 To Be Paid For, +1 "Cacao Tree Planted - Unassigned",
 *                                    all on main.
 *
 * @param {Object} opts
 * @param {string|number} opts.amount     positive payout amount
 * @param {string} opts.currency          line-item literal for the cash leg (e.g. 'BRL')
 * @param {string} opts.contributor      row 'Fund Handler'
 * @param {boolean} opts.committed        the SunMint row already carries a Linked QR Code
 * @param {boolean} opts.qrLedgerIsMain   the linked QR's OWN ledger is the main ledger
 * @return {Array<Object>}
 */
function fpeComputeLegs_(opts) {
  opts = opts || {};
  var amount = Number(opts.amount);
  var currency = String(opts.currency || '').trim();
  var contributor = String(opts.contributor || '').trim();
  if (isNaN(amount) || !currency) return [];
  function cash(target, amt) {
    return { target: target, amount: amt, literal: currency, kind: 'cash',
             isRevenue: FPE_CASH_IS_REVENUE, contributor: contributor };
  }
  function inv(target, amt, literal) {
    return { target: target, amount: amt, literal: literal, kind: 'inventory',
             isRevenue: FPE_INVENTORY_IS_REVENUE, contributor: contributor };
  }
  if (opts.committed) {
    if (opts.qrLedgerIsMain) {
      return [inv('main', -1, FPE_TO_BE_PAID_LITERAL)];
    }
    return [
      cash('qr', -amount),
      cash('main', amount),
      inv('main', -1, FPE_TO_BE_PAID_LITERAL)
    ];
  }
  return [
    cash('main', -amount),
    inv('main', -1, FPE_TO_BE_PAID_LITERAL),
    inv('main', 1, FPE_PLANTED_UNASSIGNED_LITERAL)
  ];
}

/**
 * HTTP / time-driven entry point. Triggered by Edgar after every `[PAYOUT EVENT]`
 * submission (?action=processPayoutEventsFromTelegramChatLogs), plus an hourly
 * safety-net cron.
 */
function processPayoutEventsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, error: 'Could not obtain script lock; another run is in progress.' };
  }
  try {
    // Safety-net fallback: if Edgar's webhook URL is unset (dispatch.py logs
    // "no webhook URL ... GAS cron will process"), this hourly trigger is the ONLY
    // path that processes events. Mirror the registration sink; never let a trigger
    // error abort the scan.
    var triggerStatus = ensurePayoutEventHourlyTriggerInstalled_();
    if (triggerStatus !== 'present' && triggerStatus !== 'installed') {
      Logger.log('ensurePayoutEventHourlyTriggerInstalled_: ' + triggerStatus + ' - proceeding with scan.');
    }

    // Intake: canonical Telegram Chat Logs (read here; col R marker written below).
    var intake = SpreadsheetApp.openById(PAYOUT_EVENT_OPS_SPREADSHEET_ID);
    var tcSheet = intake.getSheetByName(PAYOUT_EVENT_TELEGRAM_SHEET);
    if (!tcSheet) throw new Error('Telegram Chat Logs sheet not found');

    // Tier-1 output: `payouts` on the Ops workbook (=== the intake workbook).
    var tier1Sheet = payoutEventEnsureTab_(intake, PAYOUT_EVENT_TIER1_TAB, PAYOUT_EVENT_TIER1_HEADERS);

    // Tier-2 output (CFR only): `payout events` on the private `cfr program` sheet.
    // Resolved lazily so a non-CFR-only deployment still books Tier-1.
    var cfrSs = null, tier2Sheet = null;
    function tier2() {
      if (tier2Sheet) return tier2Sheet;
      if (!cfrSs) {
        cfrSs = payoutEventCfrProgramSpreadsheet_();
        tier2Sheet = payoutEventEnsureTab_(cfrSs, PAYOUT_EVENT_TIER2_TAB, PAYOUT_EVENT_TIER2_HEADERS);
      }
      return tier2Sheet;
    }

    var tier1Values = tier1Sheet.getDataRange().getValues();
    var seenBankRefs = payoutEventCollectBankRefs_(tier1Values);
    var seenUpdateId = {};
    for (var r = 1; r < tier1Values.length; r++) {
      var upd = String(tier1Values[r][1] || '').trim();
      if (upd) seenUpdateId[upd] = true;
    }

    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) return { success: true, recorded: 0, tier2: 0, rejected: 0, duplicates: 0, errors: 0, trigger: triggerStatus };
    var startRow = Math.max(2, lastRow - PAYOUT_EVENT_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), PAYOUT_EVENT_TC_DEDUP_COL + 1);
    var rows = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var recorded = 0, tier2Count = 0, rejected = 0, duplicates = 0, errors = 0;

    for (var i = 0; i < rows.length; i++) {
      var message = String(rows[i][PAYOUT_EVENT_TC_MESSAGE_COL] || '');
      if (!isPayoutEvent_(message)) continue;

      var updateId = String(rows[i][PAYOUT_EVENT_TC_UPDATE_ID_COL] || '').trim();
      var messageId = String(rows[i][PAYOUT_EVENT_TC_MESSAGE_ID_COL] || '').trim();
      var marker = String(rows[i][PAYOUT_EVENT_TC_DEDUP_COL] || '').trim();

      // Layer (1): intake-row gate. Skip a row this scanner already handled.
      if (marker === PAYOUT_EVENT_PROCESSED_MARKER) continue;

      var physicalRow = startRow + i;

      if (!updateId) {
        var subKey = 'NO_UPDATE_ID_ROW_' + physicalRow;
        if (seenUpdateId[subKey]) { continue; }
        appendPayoutEventRow_(tier1Sheet, {
          created_at_utc: new Date().toISOString(),
          telegram_update_id: subKey,
          status: 'REJECTED_NO_TELEGRAM_UPDATE_ID',
          error_message: 'Telegram Chat Logs row ' + physicalRow + ' has no Update ID column A'
        }, false);
        seenUpdateId[subKey] = true;
        markPayoutEventProcessed_(tcSheet, physicalRow);
        rejected++;
        continue;
      }
      if (seenUpdateId[updateId]) {
        // Already booked by update id (e.g. re-scan of a row whose marker failed to persist).
        markPayoutEventProcessed_(tcSheet, physicalRow);
        continue;
      }

      try {
        var f = parsePayoutEventText_(message);
        var programSlug = payoutEventCleanValue_(f.program_slug || f.program);
        var submissionSource = payoutEventCleanValue_(f.submission_source);
        var bankRef = payoutEventCleanValue_(f.bank_ref);
        var recipientHash = payoutEventCleanValue_(f.recipient_pk_hash) ||
          payoutEventCleanValue_(f.recipient) || PAYOUT_EVENT_UNLINKED_RECIPIENT;
        var treeIds = payoutEventNormaliseTreeIds_(f.tree_planting_id) || PAYOUT_EVENT_UNLINKED_TREES;

        var base = {
          created_at_utc: new Date().toISOString(),
          telegram_update_id: updateId,
          telegram_message_id: messageId,
          program_slug: programSlug,
          submission_source: submissionSource,
          recipient_pk_hash: recipientHash,
          amount: payoutEventCleanValue_(f.amount),
          currency: payoutEventCleanValue_(f.currency) || PAYOUT_EVENT_DEFAULT_CURRENCY,
          tree_planting_id: treeIds,
          bank_ref_type: payoutEventCleanValue_(f.bank_ref_type),
          bank_ref: bankRef,
          paid_at: payoutEventCleanValue_(f.paid_at),
          receipt_url: payoutEventCleanValue_(f.receipt_url),
          status: payoutEventCleanValue_(f.status) || 'live',
          supersedes_row: '',
          error_message: '',
          cohort: payoutEventCleanValue_(f.cohort),
          student_ref: payoutEventCleanValue_(f.student_ref)
        };

        // Refuse to book a transfer with no reconciliation anchor (bank_ref).
        if (!base.bank_ref) {
          base.status = 'REJECTED_MISSING_BANK_REF';
          base.error_message = 'No bank_ref (PIX E2E id / TXID) in the [PAYOUT EVENT]; cannot reconcile the transfer.';
          appendPayoutEventRow_(tier1Sheet, base, false);
          seenUpdateId[updateId] = true;
          markPayoutEventProcessed_(tcSheet, physicalRow);
          rejected++;
          continue;
        }

        // Layer (2): business-key dedup. A retried POST (same transfer, NEW
        // telegram_update_id) must not book a second row.
        if (seenBankRefs[base.bank_ref]) {
          duplicates++;
          base.status = 'DUPLICATE_BANK_REF';
          base.error_message = 'bank_ref ' + base.bank_ref + ' already booked; treated as a retry of the same transfer.';
          // NOTE: not appended to the ledger - it is the same money movement.
          seenUpdateId[updateId] = true;
          markPayoutEventProcessed_(tcSheet, physicalRow);
          continue;
        }

        appendPayoutEventRow_(tier1Sheet, base, false);
        seenBankRefs[base.bank_ref] = true;
        seenUpdateId[updateId] = true;
        recorded++;

        if (payoutEventIsCfr_(programSlug, submissionSource)) {
          appendPayoutEventRow_(tier2(), base, true);
          tier2Count++;
        }

        markPayoutEventProcessed_(tcSheet, physicalRow);
      } catch (rowErr) {
        try {
          appendPayoutEventRow_(tier1Sheet, {
            created_at_utc: new Date().toISOString(),
            telegram_update_id: updateId,
            status: 'error',
            error_message: (rowErr && rowErr.message ? rowErr.message : String(rowErr))
          }, false);
        } catch (e2) {}
        seenUpdateId[updateId] = true;
        markPayoutEventProcessed_(tcSheet, physicalRow);
        errors++;
      }
    }

    return {
      success: true,
      recorded: recorded,
      tier2: tier2Count,
      rejected: rejected,
      duplicates: duplicates,
      errors: errors,
      trigger: triggerStatus
    };
  } catch (err) {
    Logger.log('processPayoutEventsFromTelegramChatLogs error: ' + (err && err.message ? err.message : err));
    return { success: false, error: (err && err.message ? err.message : String(err)) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Write the col R dedup marker on an intake row. Guarded: if the sheet has no
 * column R yet, extend it; never clobber an existing marker for another event.
 */
function markPayoutEventProcessed_(tcSheet, physicalRow) {
  try {
    var cell = tcSheet.getRange(physicalRow, PAYOUT_EVENT_TC_DEDUP_COL + 1);
    var cur = String(cell.getValue() || '').trim();
    if (!cur) { cell.setValue(PAYOUT_EVENT_PROCESSED_MARKER); return; }
    if (cur === PAYOUT_EVENT_PROCESSED_MARKER) return;
    // Do not stomp another processor's marker; append ours comma-separated.
    if (cur.indexOf(PAYOUT_EVENT_PROCESSED_MARKER) < 0) {
      cell.setValue(cur + ',' + PAYOUT_EVENT_PROCESSED_MARKER);
    }
  } catch (e) {}
}

function ensurePayoutEventHourlyTriggerInstalled_() {
  var fn = 'processPayoutEventsFromTelegramChatLogs';
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === fn) return 'present';
    }
    ScriptApp.newTrigger(fn).timeBased().everyHours(1).create();
    return 'installed';
  } catch (e) {
    return 'error: ' + (e && e.message ? e.message : String(e));
  }
}

/**
 * Read endpoint for the DApp review surface. Returns booked non-duplicate payout
 * events (status filter optional, default ALL). A `[PAYOUT EVENT]` carries no raw
 * PII, so nothing here needs masking.
 */
function getPayoutEvents(statusFilter) {
  try {
    var wanted = String(statusFilter || 'ALL').trim().toUpperCase();
    var ss = SpreadsheetApp.openById(PAYOUT_EVENT_OPS_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(PAYOUT_EVENT_TIER1_TAB);
    if (!sheet) return { status: 'success', data: { count: 0, items: [] } };
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { status: 'success', data: { count: 0, items: [] } };
    var header = values[0].map(function (h) { return String(h || '').trim(); });
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });
    var items = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var st = String(row[idx['status']] || '').trim().toUpperCase();
      if (wanted !== 'ALL' && st !== wanted) continue;
      items.push({
        row: r + 1,
        created_at_utc: String(row[idx['created_at_utc']] || ''),
        program_slug: String(row[idx['program_slug']] || ''),
        recipient_pk_hash: String(row[idx['recipient_pk_hash']] || ''),
        amount: String(row[idx['amount']] || ''),
        currency: String(row[idx['currency']] || ''),
        tree_planting_id: String(row[idx['tree_planting_id']] || ''),
        bank_ref_type: String(row[idx['bank_ref_type']] || ''),
        bank_ref: String(row[idx['bank_ref']] || ''),
        paid_at: String(row[idx['paid_at']] || ''),
        receipt_url: String(row[idx['receipt_url']] || ''),
        status: String(row[idx['status']] || '')
      });
    }
    items.sort(function (a, b) { return (a.created_at_utc < b.created_at_utc) ? 1 : -1; });
    return { status: 'success', data: { count: items.length, items: items } };
  } catch (err) {
    return { status: 'error', message: (err && err.message ? err.message : String(err)) };
  }
}
