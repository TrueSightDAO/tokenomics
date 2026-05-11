/**
 * File: google_app_scripts/pipeline_metrics_snapshot/sync_pipeline_metrics.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor: (set after first `clasp push` / manual create)
 *
 * Purpose: Mirror the Holistic Hit List "Pipeline Dashboard" tab into
 *   TrueSightDAO/ecosystem_change_logs as `metrics/weekly.json` + `metrics/weekly.md`.
 *
 *   The advisory snapshot generator (market_research/scripts/generate_advisory_snapshot.py)
 *   reads `metrics/weekly.md` into the "Operator metrics" section of ADVISORY_SNAPSHOT.md.
 *   Previously that section pointed at agentic_ai_context/METRICS_WEEKLY.md which was an
 *   operator-edited stub that went stale and surfaced as TODO comments in the oracle
 *   context. Auto-syncing from the Pipeline Dashboard removes the manual step.
 *
 * Source: Pipeline Dashboard tab of the Holistic Hit List workbook
 *   https://docs.google.com/spreadsheets/d/1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc/edit#gid=1606881029
 *
 *   Layout (col C = pipeline order, col D = status label, col E = store count),
 *   rows 2..N. Column pair A/B is an alphabetized mirror; ignored because the
 *   oracle benefits from the curated funnel order in cols C–E.
 *
 * Outputs (committed to TrueSightDAO/ecosystem_change_logs main via Contents API):
 *   - metrics/weekly.json  — machine feed (schema described in weekly.md header). Includes
 *     **outreach_visibility**: Email Agent Follow Up send counts + distinct recipients
 *     (warmup / follow_up / bulk), and Hit List cohort rollups for warm-up vs follow-up
 *     pipeline statuses using AU/AV (logged send counts per store).
 *   - metrics/weekly.md    — human mirror; embedded verbatim into ADVISORY_SNAPSHOT.md
 *
 * Setup:
 *   1. Deployed project: https://script.google.com/home/projects/11fA8NXSOwKyddXDZmmx3BRCDU1Y38GVidENCj0mujH0pT-AqIoOyaetj/edit
 *   2. Script Properties:
 *      - ORACLE_ADVISORY_PUSH_TOKEN — same fine-grained PAT used by the advisory-snapshot-refresh
 *        CI secret (Contents: Read+Write on TrueSightDAO/agentic_ai_context and
 *        TrueSightDAO/ecosystem_change_logs). Reused here so one token covers both publishers
 *        of the oracle context instead of proliferating PATs.
 *   3. Run `runOneSetup()` once from the editor to grant SpreadsheetApp + UrlFetch
 *      permissions and verify the push token works.
 *   4. Run `installDailyTrigger()` once to schedule syncPipelineMetrics() daily.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

var HIT_LIST_SPREADSHEET_ID = '1eiqZr3LW-qEI6Hmy0Vrur_8flbRwxwA7jXVrbUnHbvc';
var PIPELINE_TAB = 'Pipeline Dashboard';
var PIPELINE_TAB_GID = 1606881029;
var PIPELINE_TAB_URL =
  'https://docs.google.com/spreadsheets/d/' + HIT_LIST_SPREADSHEET_ID +
  '/edit#gid=' + PIPELINE_TAB_GID;

/** Additional tabs read for oracle / operator email-pipeline visibility. */
var HIT_LIST_TAB = 'Hit List';
var EMAIL_AGENT_FOLLOW_UP_TAB = 'Email Agent Follow Up';

/** Hit List Status values used for warm-up vs follow-up cohort summaries. */
var COHORT_STATUS_WARMUP = 'AI: Warm up prospect';
var COHORT_STATUSES_FOLLOW_UP_PIPELINE = [
  'Manager Follow-up',
  'Bulk Info Requested',
  'AI: Prospect replied'
];

// Ordered funnel lives in cols C (order), D (status label), E (store count).
var ORDER_COL = 3;   // C
var STATUS_COL = 4;  // D
var COUNT_COL = 5;   // E
var DATA_START_ROW = 2;

// North-star: stages that count as a closed partnership win. Keep as a set
// so funnel label changes don't silently break the "partnered" total.
var NORTH_STAR_STATUSES = ['Partnered'];

// Stages surfaced in the summary block above the full funnel breakdown —
// "where's the action this week". Ordered intentionally (north-star first,
// then stages close to conversion). A stage not present in the Pipeline
// Dashboard is quietly skipped so the summary never shows phantom zeroes.
var HIGHLIGHT_STATUSES = [
  'Partnered',          // north-star win
  'Meeting Scheduled',  // one step from Partnered
  'Shortlisted'         // warm candidates; one personal email away
];

var TARGET_REPO_OWNER = 'TrueSightDAO';
var TARGET_REPO = 'ecosystem_change_logs';
var TARGET_BRANCH = 'main';
var WEEKLY_JSON_PATH = 'metrics/weekly.json';
var WEEKLY_MD_PATH = 'metrics/weekly.md';

// ============================================================================
// ENTRY POINTS
// ============================================================================

/**
 * Main sync. Reads the Pipeline Dashboard, builds JSON + MD artifacts, and
 * commits both to TrueSightDAO/ecosystem_change_logs@main.
 *
 * Idempotent: if neither artifact's bytes changed, the GitHub API returns 200
 * on the GET-sha check and we skip the PUT to avoid empty commits.
 */
function syncPipelineMetrics() {
  var token = _requireGithubToken_();
  var funnel = _readPipelineFunnel_();
  var artifacts = _buildArtifacts_(funnel);

  var jsonResult = _upsertFile_(
    token,
    WEEKLY_JSON_PATH,
    artifacts.json,
    'chore(metrics): refresh pipeline funnel weekly.json'
  );
  var mdResult = _upsertFile_(
    token,
    WEEKLY_MD_PATH,
    artifacts.md,
    'chore(metrics): refresh pipeline funnel weekly.md'
  );

  Logger.log('json: ' + jsonResult.status + ' | md: ' + mdResult.status);
  return { json: jsonResult, md: mdResult, funnel: funnel };
}

/**
 * One-time authorization + smoke test. Run from the editor after first paste.
 * Does NOT write to GitHub — just reads the sheet and pings the contents API
 * so any auth failures surface immediately.
 */
function runOneSetup() {
  var props = PropertiesService.getScriptProperties();
  var token = (props.getProperty('ORACLE_ADVISORY_PUSH_TOKEN') || '').trim();
  var status = {
    now_utc: new Date().toISOString(),
    github_token_present: Boolean(token),
    sheet_read: null,
    github_ping: null
  };

  try {
    var funnel = _readPipelineFunnel_();
    status.sheet_read = {
      ok: true,
      stages: funnel.rows.length,
      total_stores: funnel.total_stores,
      partnered: funnel.partnered
    };
  } catch (err) {
    status.sheet_read = { ok: false, error: String(err && err.message || err) };
  }

  if (token) {
    try {
      var url = 'https://api.github.com/repos/' + TARGET_REPO_OWNER + '/' + TARGET_REPO;
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        headers: {
          Authorization: 'token ' + token,
          Accept: 'application/vnd.github.v3+json'
        }
      });
      status.github_ping = {
        response_code: res.getResponseCode(),
        ok: res.getResponseCode() === 200
      };
    } catch (err) {
      status.github_ping = { ok: false, error: String(err && err.message || err) };
    }
  }

  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

/**
 * Install a time-driven trigger that runs syncPipelineMetrics() daily.
 * Runs at 06:00 in the script's timezone (set in GAS project settings) so the
 * artifact is fresh before the first advisory-snapshot-refresh CI run of the
 * day (which currently fires at :27 every 6 hours). Safe to re-run; it
 * removes any existing syncPipelineMetrics triggers before creating the new one.
 */
function installDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncPipelineMetrics') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncPipelineMetrics')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  Logger.log('Daily trigger installed: syncPipelineMetrics @ 06:00 project TZ');
}

// ============================================================================
// SHEET READ
// ============================================================================

function _readPipelineFunnel_() {
  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sh = ss.getSheetByName(PIPELINE_TAB);
  if (!sh) {
    throw new Error('Pipeline Dashboard tab not found in workbook');
  }
  var lastRow = sh.getLastRow();
  if (lastRow < DATA_START_ROW) {
    return { rows: [], total_stores: 0, partnered: 0 };
  }

  // Pull C..E in one call for the full data range.
  var numRows = lastRow - DATA_START_ROW + 1;
  var values = sh.getRange(DATA_START_ROW, ORDER_COL, numRows, 3).getValues();

  var rows = [];
  var totalStores = 0;
  var partnered = 0;
  var northStarSet = {};
  for (var p = 0; p < NORTH_STAR_STATUSES.length; p++) {
    northStarSet[NORTH_STAR_STATUSES[p]] = true;
  }
  var countsByStatus = {};

  for (var i = 0; i < values.length; i++) {
    var orderVal = values[i][0];
    var statusVal = values[i][1];
    var countVal = values[i][2];

    var status = String(statusVal || '').trim();
    if (!status) continue; // skip blank rows (footers, spacers)

    var order = (orderVal === '' || orderVal === null) ? null : Number(orderVal);
    if (order !== null && !isFinite(order)) order = null;

    var count = (countVal === '' || countVal === null) ? 0 : Number(countVal);
    if (!isFinite(count)) count = 0;

    rows.push({ order: order, status: status, stores: count });
    totalStores += count;
    if (northStarSet[status]) partnered += count;
    countsByStatus[status] = count;
  }

  // Sort by curated order; rows without an order number trail, stable by position.
  rows.sort(function (a, b) {
    if (a.order === null && b.order === null) return 0;
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return a.order - b.order;
  });

  // Resolve highlights in the order declared by HIGHLIGHT_STATUSES. Missing
  // labels are quietly dropped so a sheet relabel doesn't render phantom zeroes
  // (they still appear in the full funnel below).
  var highlights = [];
  for (var h = 0; h < HIGHLIGHT_STATUSES.length; h++) {
    var label = HIGHLIGHT_STATUSES[h];
    if (Object.prototype.hasOwnProperty.call(countsByStatus, label)) {
      highlights.push({
        status: label,
        stores: countsByStatus[label],
        north_star: Boolean(northStarSet[label])
      });
    }
  }

  return {
    rows: rows,
    total_stores: totalStores,
    partnered: partnered,
    highlights: highlights
  };
}

// ============================================================================
// OUTREACH VISIBILITY (Email Agent Follow Up + Hit List AU / AV)
// ============================================================================

function _headerMapPipeline_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || '').trim();
    if (h) map[h] = i;
  }
  return map;
}

function _touchCountPipeline_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  // Hit List columns AU/AV are integer COUNTIFS results, but a stale TIME
  // number-format leaked from neighbouring weekday-hours columns can survive
  // on rows appended before that bug was fixed. SpreadsheetApp.getValues()
  // surfaces TIME-formatted cells as JS Date objects, so parseFloat(String(v))
  // would silently yield NaN and the count would collapse to 0 — which is how
  // 32 stores were previously miscounted as "never warmed-up" in
  // ADVISORY_SNAPSHOT.md. Detect Dates here and recover the underlying serial.
  if (v instanceof Date) {
    var ms = v.getTime();
    if (!isFinite(ms)) return 0;
    var sheetEpoch = Date.UTC(1899, 11, 30); // Sheets day 0
    var n = Math.round((ms - sheetEpoch) / 86400000);
    if (!isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }
  var n = parseFloat(String(v).trim().replace(/,/g, ''));
  if (isNaN(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Locate **Warm-up email sent** (AU) and **Follow-up emails sent** (AV) columns (0-based indices).
 * Mirrors holistic_hit_list_store_history logic.
 */
function _findTouchColsPipeline_(hdr, headerRow) {
  var au = hdr['Warm-up email sent'];
  var av = hdr['Follow-up emails sent'];
  var i;
  var h;
  if (au === undefined) {
    for (i = 0; i < headerRow.length; i++) {
      h = String(headerRow[i] || '')
        .trim()
        .toLowerCase();
      if (h.indexOf('warm') !== -1 && h.indexOf('email') !== -1) {
        au = i;
        break;
      }
    }
  }
  if (av === undefined) {
    for (i = 0; i < headerRow.length; i++) {
      h = String(headerRow[i] || '')
        .trim()
        .toLowerCase();
      if (h.indexOf('follow') !== -1 && h.indexOf('email') !== -1) {
        av = i;
        break;
      }
    }
  }
  if (au === undefined && headerRow.length >= 47) au = 46;
  if (av === undefined && headerRow.length >= 48) av = 47;
  return { au: au, av: av };
}

function _makeEmptyCohortAgg_() {
  return {
    stores: 0,
    sum_warmup_sends_au: 0,
    sum_follow_up_sends_av: 0,
    warmup_send_depth: { none: 0, once: 0, repeat: 0 },
    follow_up_send_depth: { none: 0, once: 0, repeat: 0 }
  };
}

function _bumpCohortAgg_(agg, au, av) {
  agg.stores++;
  agg.sum_warmup_sends_au += au;
  agg.sum_follow_up_sends_av += av;
  if (au <= 0) agg.warmup_send_depth.none++;
  else if (au === 1) agg.warmup_send_depth.once++;
  else agg.warmup_send_depth.repeat++;
  if (av <= 0) agg.follow_up_send_depth.none++;
  else if (av === 1) agg.follow_up_send_depth.once++;
  else agg.follow_up_send_depth.repeat++;
}

function _mergeCohortAggs_(dst, src) {
  dst.stores += src.stores;
  dst.sum_warmup_sends_au += src.sum_warmup_sends_au;
  dst.sum_follow_up_sends_av += src.sum_follow_up_sends_av;
  dst.warmup_send_depth.none += src.warmup_send_depth.none;
  dst.warmup_send_depth.once += src.warmup_send_depth.once;
  dst.warmup_send_depth.repeat += src.warmup_send_depth.repeat;
  dst.follow_up_send_depth.none += src.follow_up_send_depth.none;
  dst.follow_up_send_depth.once += src.follow_up_send_depth.once;
  dst.follow_up_send_depth.repeat += src.follow_up_send_depth.repeat;
}

/**
 * Logged Gmail **Sent** rows from **Email Agent Follow Up** (`status` = warmup | follow_up | bulk | …).
 */
function _readEmailAgentFollowUpLog_() {
  var base = {
    ok: false,
    tab: EMAIL_AGENT_FOLLOW_UP_TAB,
    sends_logged: { warmup: 0, follow_up: 0, bulk: 0, unknown: 0, total_rows: 0 },
    distinct_recipients: { warmup: 0, follow_up: 0, bulk: 0, unknown: 0 }
  };

  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sh = ss.getSheetByName(EMAIL_AGENT_FOLLOW_UP_TAB);
  if (!sh) return base;

  var values = sh.getDataRange().getValues();
  if (values.length < 2) {
    base.ok = true;
    return base;
  }

  var hdr = _headerMapPipeline_(values[0]);
  var stI = hdr['status'];
  var emI = hdr['to_email'];
  if (stI === undefined || emI === undefined) {
    base.error = 'missing column "status" or "to_email" on Email Agent Follow Up';
    return base;
  }

  var setsWarm = {};
  var setsFu = {};
  var setsBulk = {};
  var setsUnk = {};

  var r;
  for (r = 1; r < values.length; r++) {
    var row = values[r];
    var st = String(row[stI] || '').trim().toLowerCase();
    var em = String(row[emI] || '').trim().toLowerCase();

    base.sends_logged.total_rows++;
    if (st === 'warmup') base.sends_logged.warmup++;
    else if (st === 'follow_up') base.sends_logged.follow_up++;
    else if (st === 'bulk') base.sends_logged.bulk++;
    else base.sends_logged.unknown++;

    if (!em) continue;
    if (st === 'warmup') setsWarm[em] = true;
    else if (st === 'follow_up') setsFu[em] = true;
    else if (st === 'bulk') setsBulk[em] = true;
    else setsUnk[em] = true;
  }

  function countKeys_(obj) {
    var n = 0;
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) n++;
    }
    return n;
  }

  base.distinct_recipients.warmup = countKeys_(setsWarm);
  base.distinct_recipients.follow_up = countKeys_(setsFu);
  base.distinct_recipients.bulk = countKeys_(setsBulk);
  base.distinct_recipients.unknown = countKeys_(setsUnk);
  base.ok = true;
  return base;
}

/**
 * Per Hit List **Status** cohort: store counts + AU/AV sums and depth buckets (none / once / repeat sends).
 */
function _readHitListOutreachDepth_() {
  var out = {
    touch_columns_resolved: false,
    cohorts: {},
    follow_up_pipeline_combined: null
  };

  var ss = SpreadsheetApp.openById(HIT_LIST_SPREADSHEET_ID);
  var sh = ss.getSheetByName(HIT_LIST_TAB);
  if (!sh) return out;

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return out;

  var headers = values[0];
  var hdr = _headerMapPipeline_(headers);
  var statusIdx = hdr['Status'];
  if (statusIdx === undefined) return out;

  var touchCols = _findTouchColsPipeline_(hdr, headers);
  var touchOk = touchCols.au !== undefined && touchCols.av !== undefined;
  out.touch_columns_resolved = Boolean(touchOk);

  var want = {};
  want[COHORT_STATUS_WARMUP] = true;
  for (var wi = 0; wi < COHORT_STATUSES_FOLLOW_UP_PIPELINE.length; wi++) {
    want[COHORT_STATUSES_FOLLOW_UP_PIPELINE[wi]] = true;
  }

  for (var k in want) {
    if (Object.prototype.hasOwnProperty.call(want, k)) {
      out.cohorts[k] = _makeEmptyCohortAgg_();
    }
  }

  var rr;
  for (rr = 1; rr < values.length; rr++) {
    var row = values[rr];
    var st = String(row[statusIdx] || '').trim();
    if (!want[st]) continue;

    var au = touchOk ? _touchCountPipeline_(row[touchCols.au]) : 0;
    var av = touchOk ? _touchCountPipeline_(row[touchCols.av]) : 0;
    _bumpCohortAgg_(out.cohorts[st], au, av);
  }

  var combined = _makeEmptyCohortAgg_();
  combined.note =
    'Union of Hit List rows in statuses: ' + COHORT_STATUSES_FOLLOW_UP_PIPELINE.join(', ');
  for (var ci = 0; ci < COHORT_STATUSES_FOLLOW_UP_PIPELINE.length; ci++) {
    var label = COHORT_STATUSES_FOLLOW_UP_PIPELINE[ci];
    if (out.cohorts[label]) {
      _mergeCohortAggs_(combined, out.cohorts[label]);
    }
  }
  out.follow_up_pipeline_combined = combined;

  return out;
}

function _appendCohortMarkdown_(mdLines, title, agg) {
  if (!agg || !agg.stores) {
    mdLines.push('- **' + title + '**: _(no rows in this status)_');
    return;
  }
  mdLines.push(
    '- **' +
      title +
      '**: **' +
      agg.stores +
      '** stores — sum logged **warmup** sends (AU): **' +
      agg.sum_warmup_sends_au +
      '**, sum logged **follow-up** sends (AV): **' +
      agg.sum_follow_up_sends_av +
      '**; warmup depth (none / once / ≥2): **' +
      agg.warmup_send_depth.none +
      '** / **' +
      agg.warmup_send_depth.once +
      '** / **' +
      agg.warmup_send_depth.repeat +
      '**; follow-up depth (none / once / ≥2): **' +
      agg.follow_up_send_depth.none +
      '** / **' +
      agg.follow_up_send_depth.once +
      '** / **' +
      agg.follow_up_send_depth.repeat +
      '**'
  );
}

// ============================================================================
// ARTIFACT BUILDERS
// ============================================================================

function _buildArtifacts_(funnel) {
  var now = new Date();
  var generatedAt = now.toISOString();

  var outreach = {
    email_agent_follow_up: _readEmailAgentFollowUpLog_(),
    hit_list: _readHitListOutreachDepth_()
  };

  var jsonObj = {
    generated_at: generatedAt,
    source: {
      workbook_id: HIT_LIST_SPREADSHEET_ID,
      tab: PIPELINE_TAB,
      gid: PIPELINE_TAB_GID,
      url: PIPELINE_TAB_URL
    },
    totals: {
      all_stores: funnel.total_stores,
      partnered: funnel.partnered,
      highlights: funnel.highlights
    },
    funnel: funnel.rows,
    outreach_visibility: outreach
  };

  var jsonText = JSON.stringify(jsonObj, null, 2) + '\n';

  var northStarSet = {};
  for (var ns = 0; ns < NORTH_STAR_STATUSES.length; ns++) {
    northStarSet[NORTH_STAR_STATUSES[ns]] = true;
  }

  // Markdown ordered from highest-signal (closest to conversion) down. The
  // advisory snapshot embeds this verbatim under "## Operator metrics ...".
  var mdLines = [];
  mdLines.push('# Operator metrics — pipeline funnel');
  mdLines.push('');
  mdLines.push('_Auto-synced from the Pipeline Dashboard tab of the Holistic Hit List workbook._');
  mdLines.push('_Do not edit by hand — see `google_app_scripts/pipeline_metrics_snapshot/` in tokenomics._');
  mdLines.push('');
  mdLines.push('- Generated (UTC): `' + generatedAt + '`');
  mdLines.push('- Source: [Pipeline Dashboard](' + PIPELINE_TAB_URL + ')');
  mdLines.push('- Total stores tracked: **' + funnel.total_stores + '**');
  for (var hi = 0; hi < funnel.highlights.length; hi++) {
    var hl = funnel.highlights[hi];
    var suffix = hl.north_star ? ' (north-star)' : '';
    mdLines.push('- ' + hl.status + suffix + ': **' + hl.stores + '**');
  }
  mdLines.push('');
  mdLines.push('## Funnel by status (curated order)');
  mdLines.push('');

  if (!funnel.rows.length) {
    mdLines.push('_(no stages — Pipeline Dashboard is empty)_');
  } else {
    for (var i = 0; i < funnel.rows.length; i++) {
      var r = funnel.rows[i];
      var orderTag = (r.order === null || r.order === undefined) ? '—' : ('#' + r.order);
      var label = northStarSet[r.status]
        ? ('**' + r.status + ': ' + r.stores + '**')
        : (r.status + ': ' + r.stores);
      mdLines.push('- ' + label + '  (' + orderTag + ')');
    }
  }

  mdLines.push('');
  mdLines.push('## Email outreach visibility (logged sends + Hit List AU/AV)');
  mdLines.push('');

  var logR = outreach.email_agent_follow_up;
  if (!logR.ok) {
    mdLines.push('_(Email Agent Follow Up tab missing or columns incomplete — no log summary.)_');
    if (logR.error) mdLines.push('- _Error: ' + logR.error + '_');
  } else {
    mdLines.push(
      '- **Email Agent Follow Up** — logged sends: warmup **' +
        logR.sends_logged.warmup +
        '**, follow_up **' +
        logR.sends_logged.follow_up +
        '**, bulk **' +
        logR.sends_logged.bulk +
        '**, unknown **' +
        logR.sends_logged.unknown +
        '** (data rows: **' +
        logR.sends_logged.total_rows +
        '**)'
    );
    mdLines.push(
      '- Distinct recipient addresses (`to_email`, by log `status`): warmup **' +
        logR.distinct_recipients.warmup +
        '**, follow_up **' +
        logR.distinct_recipients.follow_up +
        '**, bulk **' +
        logR.distinct_recipients.bulk +
        '**, unknown **' +
        logR.distinct_recipients.unknown +
        '**'
    );
  }

  mdLines.push('');
  mdLines.push('### Hit List cohorts (stores in stage × AU/AV send counts)');
  mdLines.push('');

  var hl = outreach.hit_list;
  if (!hl.touch_columns_resolved) {
    mdLines.push(
      '_Warm-up / follow-up **depth** buckets need Hit List columns AU/AV (**Warm-up email sent**, **Follow-up emails sent**). Sums may read as 0 until headers exist._'
    );
    mdLines.push('');
  }

  _appendCohortMarkdown_(mdLines, COHORT_STATUS_WARMUP, hl.cohorts[COHORT_STATUS_WARMUP]);
  for (var fxi = 0; fxi < COHORT_STATUSES_FOLLOW_UP_PIPELINE.length; fxi++) {
    var flab = COHORT_STATUSES_FOLLOW_UP_PIPELINE[fxi];
    _appendCohortMarkdown_(mdLines, flab, hl.cohorts[flab]);
  }
  if (hl.follow_up_pipeline_combined && hl.follow_up_pipeline_combined.stores) {
    _appendCohortMarkdown_(mdLines, 'Follow-up pipeline (combined)', hl.follow_up_pipeline_combined);
  }

  mdLines.push('');
  return { json: jsonText, md: mdLines.join('\n') };
}

// ============================================================================
// GITHUB CONTENTS API
// ============================================================================

function _requireGithubToken_() {
  var token = (PropertiesService.getScriptProperties().getProperty('ORACLE_ADVISORY_PUSH_TOKEN') || '').trim();
  if (!token) {
    throw new Error('Missing script property ORACLE_ADVISORY_PUSH_TOKEN — fine-grained PAT with Contents:Read+Write on ' + TARGET_REPO_OWNER + '/' + TARGET_REPO);
  }
  return token;
}

/**
 * Create-or-update a single file in the target repo/branch. Skips the PUT if
 * the remote file's content already matches, which keeps commit history clean
 * when the dashboard hasn't moved.
 */
function _upsertFile_(token, path, content, commitMessage) {
  var contentsUrl =
    'https://api.github.com/repos/' + TARGET_REPO_OWNER + '/' + TARGET_REPO +
    '/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(TARGET_BRANCH);

  var existing = UrlFetchApp.fetch(contentsUrl, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github.v3+json'
    }
  });

  var existingSha = null;
  var existingBytes = null;
  var code = existing.getResponseCode();
  if (code === 200) {
    var parsed = JSON.parse(existing.getContentText());
    existingSha = parsed.sha || null;
    if (parsed.content && parsed.encoding === 'base64') {
      existingBytes = Utilities.base64Decode(parsed.content.replace(/\n/g, ''));
    }
  } else if (code !== 404) {
    throw new Error('GitHub GET ' + path + ' failed (' + code + '): ' +
      existing.getContentText().slice(0, 400));
  }

  var newBytes = Utilities.newBlob(content, 'text/plain', path).getBytes();

  if (existingBytes && _bytesEqual_(existingBytes, newBytes)) {
    return { path: path, status: 'unchanged', sha: existingSha };
  }

  var payload = {
    message: commitMessage,
    branch: TARGET_BRANCH,
    content: Utilities.base64Encode(newBytes)
  };
  if (existingSha) payload.sha = existingSha;

  var putUrl =
    'https://api.github.com/repos/' + TARGET_REPO_OWNER + '/' + TARGET_REPO +
    '/contents/' + encodeURI(path);
  var res = UrlFetchApp.fetch(putUrl, {
    method: 'put',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github.v3+json'
    },
    payload: JSON.stringify(payload)
  });

  var putCode = res.getResponseCode();
  if (putCode !== 200 && putCode !== 201) {
    throw new Error('GitHub PUT ' + path + ' failed (' + putCode + '): ' +
      res.getContentText().slice(0, 400));
  }
  var body = JSON.parse(res.getContentText());
  return {
    path: path,
    status: existingSha ? 'updated' : 'created',
    commit_url: body && body.commit && body.commit.html_url || null,
    sha: body && body.content && body.content.sha || null
  };
}

function _bytesEqual_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
