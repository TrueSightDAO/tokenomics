/**
 * [PLOT FINANCING EVENT] sink (PR10b, plan SUNMINT_FARMER_SETTLEMENT_AND_BATCH_LINK_PLAN.md).
 *
 * A cash ADVANCE from the DAO that finances N trees on a SunMint plot. OPPOSITE DIRECTION to a
 * [PAYOUT EVENT]: an advance leaves main BEFORE any sale exists, whereas a payout settles a
 * liability AFTER one. It books exactly TWO legs on the MAIN ledger:
 *   1. cash OUT  : -amount          (the advance leaves main; Is Revenue BLANK)
 *   2. pool mint : +N 'Cacao Tree Planted - Unassigned'  (Is Revenue 'N')
 *
 * It also SEEDS the `SunMint Plots` registry (col T `Contributor Name`) with the farmer, which is
 * what makes downstream plot links bookable - PR6's plot link fails closed while col T is blank.
 *
 * FAIL-CLOSED: if the plot row cannot be positively resolved, or the amount/tree-count are not
 * strictly positive, or a leg write does not land, NOTHING is booked and the tracking row is
 * flagged. A wrong booking is worse than no booking.
 *
 * The per-tree INFRASTRUCTURE CHARGE that [TREE PLANTING LINK EVENT] transfers off a managed
 * ledger is a SEPARATE number (Currencies 'Tree Charge') - never conflated with this advance.
 *
 * GAS source-only: no clasp deploy, no ledger event is executed by this file's presence.
 */

var PF_OPS_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ'; // Ops workbook (hosts Telegram Chat Logs, SunMint Plots, SunMint Tree Planting)
var PF_TELEGRAM_SHEET = 'Telegram Chat Logs';
var PF_MAIN_LEDGER_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
var PF_MAIN_OFFCHAIN_TAB = 'offchain transactions';
var PF_PLOTS_TAB = 'SunMint Plots';
var PF_PLOTS_PLOT_ID_COL = 0;                 // Column A - Plot ID
var PF_PLOTS_CONTRIBUTOR_NAME_COL = 19;       // Column T - Contributor Name (registry-held farmer)
var PF_TRACKING_TAB = 'Plot Financing';

var PF_TAG = '[PLOT FINANCING EVENT]';
var PF_TC_UPDATE_ID_COL = 0;
var PF_TC_MESSAGE_ID_COL = 3;
var PF_TC_MESSAGE_COL = 6;
var PF_TC_DEDUP_COL = 17;                     // column R - shared intake dedup lane
var PF_PROCESSED_MARKER = 'PROCESSED:PLOT_FINANCING_EVENT';
var PF_SCAN_BATCH = 200;

var PF_PLANTED_UNASSIGNED_LITERAL = 'Cacao Tree Planted - Unassigned';
// Is-Revenue per leg kind: an advance is NOT revenue -> blank (matches PR4's cash-out convention);
// the pool-mint inventory leg matches PR3's settlement rows ('N').
var PF_CASH_IS_REVENUE = '';
var PF_INVENTORY_IS_REVENUE = 'N';

var PF_TRACKING_HEADERS = [
  'Submitted At', 'Telegram Update ID', 'Telegram Message ID', 'Plot ID', 'Farmer',
  'Tree Count', 'Amount', 'Currency', 'Bank Ref', 'Receipt URL', 'Status', 'Error Message'
];

/** Tag-first detection: the tag must OPEN the message, not merely be mentioned. */
function isPlotFinancingEvent_(message) {
  if (message === null || message === undefined) return false;
  return String(message).replace(/^\s+/, '').indexOf(PF_TAG) === 0;
}

/** Parse a canonical tag-first payload into its fields. Never throws. */
function pfParseText_(body) {
  var out = { plotId: '', farmer: '', treeCount: '', amount: '', currency: '', date: '',
              bankRef: '', receiptUrl: '', notes: '', submissionSource: '' };
  if (!body) return out;
  var map = {
    'plot id': 'plotId', 'farmer': 'farmer', 'tree count': 'treeCount', 'amount': 'amount',
    'currency': 'currency', 'date': 'date', 'bank ref': 'bankRef', 'receipt url': 'receiptUrl',
    'notes': 'notes', 'submission source': 'submissionSource'
  };
  String(body).split('\n').forEach(function (line) {
    var m = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
    if (!m) return;
    var key = m[1].trim().toLowerCase();
    if (map[key]) out[map[key]] = m[2].trim();
  });
  return out;
}

/** Strict numeric coercion: strips currency/thousands decoration; '' when not a clean number. */
function pfNum_(v) {
  var s = String(v === null || v === undefined ? '' : v).replace(/,/g, '').trim();
  var m = s.match(/-?\d+(\.\d+)?/);
  return m ? m[0] : '';
}

/** Ensure the tracking tab exists on the ops workbook. */
function pfEnsureTrackingTab_(spreadsheet) {
  var sh = spreadsheet.getSheetByName(PF_TRACKING_TAB);
  if (!sh) sh = spreadsheet.insertSheet(PF_TRACKING_TAB);
  if (sh.getLastRow() < 1) sh.appendRow(PF_TRACKING_HEADERS);
  return sh;
}

/**
 * Resolve a plot's registry row from `SunMint Plots`. Returns null when the plot is absent
 * (fail closed). Never throws.
 */
function pfResolvePlotRow_(plotId) {
  try {
    var want = String(plotId || '').trim();
    if (!want) return null;
    var ss = SpreadsheetApp.openById(PF_OPS_SPREADSHEET_ID);
    var sh = ss.getSheetByName(PF_PLOTS_TAB);
    if (!sh || sh.getLastRow() < 2) return null;
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][PF_PLOTS_PLOT_ID_COL] || '').trim() === want) {
        return { rowNumber: i + 1, contributorName: String(data[i][PF_PLOTS_CONTRIBUTOR_NAME_COL] || '').trim() };
      }
    }
    return null;
  } catch (e) {
    Logger.log('pfResolvePlotRow_ failed: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * Pure leg model (no I/O) - mirrors PR4's fpeComputeLegs_. Two legs, both on main.
 * @return {Array} [] when the inputs are not strictly positive / currencies is blank.
 */
function pfComputeLegs_(opts) {
  opts = opts || {};
  var amount = Number(pfNum_(opts.amount));
  var n = Number(pfNum_(opts.treeCount));
  var currency = String(opts.currency || '').trim();
  var contributor = String(opts.contributor || '').trim();
  if (!currency) return [];
  if (isNaN(amount) || amount <= 0) return [];
  if (isNaN(n) || n <= 0) return [];
  return [
    { target: 'main', amount: -amount, literal: currency, kind: 'cash',
      isRevenue: PF_CASH_IS_REVENUE, contributor: contributor },
    { target: 'main', amount: n, literal: PF_PLANTED_UNASSIGNED_LITERAL, kind: 'inventory',
      isRevenue: PF_INVENTORY_IS_REVENUE, contributor: contributor }
  ];
}

/** Append one leg to the main ledger's offchain transactions tab (7-col row shape). */
function pfWriteLeg_(leg, ctx) {
  try {
    var ss = SpreadsheetApp.openById(PF_MAIN_LEDGER_SPREADSHEET_ID);
    var sh = ss.getSheetByName(PF_MAIN_OFFCHAIN_TAB);
    if (!sh) return false;
    // Date | Description | Fund Handler | Amount | Currency | Ledger Line | Is Revenue
    sh.appendRow([new Date(), (ctx && ctx.description) || '', leg.contributor, leg.amount,
                  leg.literal, '', leg.isRevenue]);
    return true;
  } catch (e) {
    Logger.log('pfWriteLeg_ failed: ' + (e && e.message ? e.message : e));
    return false;
  }
}

/** Seed the plot registry (col T) with the farmer. Never overwrites a non-blank value. */
function pfSeedPlotContributor_(plotRow, farmer) {
  var name = String(farmer || '').trim();
  if (!name) return { seeded: false, reason: 'NO_FARMER_IN_EVENT' };
  if (plotRow.contributorName) {
    return { seeded: false, reason: plotRow.contributorName === name ? 'ALREADY_SET' : 'MISMATCH_EXISTING' };
  }
  try {
    var ss = SpreadsheetApp.openById(PF_OPS_SPREADSHEET_ID);
    var sh = ss.getSheetByName(PF_PLOTS_TAB);
    if (!sh) return { seeded: false, reason: 'PLOTS_TAB_MISSING' };
    sh.getRange(plotRow.rowNumber, PF_PLOTS_CONTRIBUTOR_NAME_COL + 1).setValue(name);
    return { seeded: true };
  } catch (e) {
    Logger.log('pfSeedPlotContributor_ failed: ' + (e && e.message ? e.message : e));
    return { seeded: false, reason: 'SEED_ERROR' };
  }
}

/**
 * Book the advance. Fail-closed: returns {booked:false, reason} and writes NOTHING when the plot
 * cannot be resolved or the legs cannot all land. Never throws.
 * @return {{booked:boolean, reason:(string|undefined), legs:(number|undefined)}}
 */
function pfBookLedger_(base) {
  try {
    var plot = pfResolvePlotRow_(base.plotId);
    if (!plot) return { booked: false, reason: 'PLOT_NOT_FOUND' };

    var legs = pfComputeLegs_({
      amount: base.amount, treeCount: base.treeCount, currency: base.currency,
      contributor: String(base.farmer || '')
    });
    if (!legs.length) return { booked: false, reason: 'BAD_AMOUNT_TREE_COUNT_OR_CURRENCY' };

    var ctx = { description: PF_TAG + ' ' + String(base.bankRef || '') + ' - plot ' + String(base.plotId || '') };
    var written = 0;
    for (var i = 0; i < legs.length; i++) {
      if (pfWriteLeg_(legs[i], ctx)) written++;
    }
    if (written !== legs.length) {
      return { booked: false, reason: 'PARTIAL_WRITE_' + written + '_OF_' + legs.length };
    }
    var seed = pfSeedPlotContributor_(plot, base.farmer);
    return { booked: true, legs: written, seeded: seed.seeded, seedReason: seed.reason };
  } catch (e) {
    Logger.log('pfBookLedger_ failed: ' + (e && e.message ? e.message : e));
    return { booked: false, reason: 'ERROR_' + (e && e.message ? e.message : String(e)) };
  }
}

/** Install the hourly safety-net scan, mirroring the payout sink. Never aborts the scan. */
function ensurePlotFinancingHourlyTriggerInstalled_() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processPlotFinancingEventsFromTelegramChatLogs') return 'present';
    }
    ScriptApp.newTrigger('processPlotFinancingEventsFromTelegramChatLogs').timeBased().everyHours(1).create();
    return 'installed';
  } catch (e) {
    return 'error:' + (e && e.message ? e.message : e);
  }
}

/**
 * HTTP / time-driven entry point. Triggered by Edgar after every `[PLOT FINANCING EVENT]`
 * submission (?action=processPlotFinancingEventsFromTelegramChatLogs), plus an hourly
 * safety-net cron.
 */
function processPlotFinancingEventsFromTelegramChatLogs() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, error: 'Could not obtain script lock; another run is in progress.' };
  }
  try {
    var triggerStatus = ensurePlotFinancingHourlyTriggerInstalled_();
    if (triggerStatus !== 'present' && triggerStatus !== 'installed') {
      Logger.log('ensurePlotFinancingHourlyTriggerInstalled_: ' + triggerStatus + ' - proceeding with scan.');
    }

    var intake = SpreadsheetApp.openById(PF_OPS_SPREADSHEET_ID);
    var tcSheet = intake.getSheetByName(PF_TELEGRAM_SHEET);
    if (!tcSheet) throw new Error('Telegram Chat Logs sheet not found');
    var tracking = pfEnsureTrackingTab_(intake);

    var lastRow = tcSheet.getLastRow();
    if (lastRow < 2) return { success: true, recorded: 0, booked: 0, flagged: 0, duplicates: 0, errors: 0 };
    var startRow = Math.max(2, lastRow - PF_SCAN_BATCH + 1);
    var numRows = lastRow - startRow + 1;
    var lastCol = Math.max(tcSheet.getLastColumn(), PF_TC_DEDUP_COL + 1);
    var rows = tcSheet.getRange(startRow, 1, numRows, lastCol).getValues();

    var recorded = 0, booked = 0, flagged = 0, duplicates = 0, errors = 0;

    for (var i = 0; i < rows.length; i++) {
      var message = String(rows[i][PF_TC_MESSAGE_COL] || '');
      if (!isPlotFinancingEvent_(message)) continue;

      var updateId = String(rows[i][PF_TC_UPDATE_ID_COL] || '').trim();
      var messageId = String(rows[i][PF_TC_MESSAGE_ID_COL] || '').trim();
      var marker = String(rows[i][PF_TC_DEDUP_COL] || '').trim();

      // Dedup layer 1: the intake-row gate. Already handled -> skip.
      if (marker === PF_PROCESSED_MARKER) { duplicates++; continue; }

      var f = pfParseText_(message);
      var result = { booked: false, reason: 'PLOT_NOT_FOUND' };
      try {
        result = pfBookLedger_(f);
      } catch (e) {
        errors++;
        result = { booked: false, reason: 'ERROR_' + (e && e.message ? e.message : String(e)) };
      }

      var status = result.booked ? 'BOOKED' : 'LEDGER_NOT_BOOKED';
      if (result.booked) booked++; else flagged++;

      tracking.appendRow([
        new Date(), updateId, messageId, f.plotId, f.farmer, pfNum_(f.treeCount),
        pfNum_(f.amount), f.currency, f.bankRef, f.receiptUrl, status,
        result.booked ? '' : String(result.reason || '')
      ]);

      // Mark handled on the intake row (col R) so a retry cannot double-book.
      tcSheet.getRange(startRow + i, PF_TC_DEDUP_COL + 1).setValue(PF_PROCESSED_MARKER);
      recorded++;
    }

    return { success: true, recorded: recorded, booked: booked, flagged: flagged,
             duplicates: duplicates, errors: errors, trigger: triggerStatus };
  } catch (err) {
    return { success: false, error: (err && err.message ? err.message : String(err)) };
  } finally {
    lock.releaseLock();
  }
}
