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
 *   - metrics/weekly.json  — machine feed (schema described in weekly.md header)
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

// Ordered funnel lives in cols C (order), D (status label), E (store count).
var ORDER_COL = 3;   // C
var STATUS_COL = 4;  // D
var COUNT_COL = 5;   // E
var DATA_START_ROW = 2;

// Stages classified as "partnered success" — the north-star metric the oracle
// cares about most. Keep as a set so funnel label changes elsewhere don't
// silently break the total.
var PARTNERED_STATUSES = ['Partnered'];

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
  var partneredSet = {};
  for (var p = 0; p < PARTNERED_STATUSES.length; p++) {
    partneredSet[PARTNERED_STATUSES[p]] = true;
  }

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
    if (partneredSet[status]) partnered += count;
  }

  // Sort by curated order; rows without an order number trail, stable by position.
  rows.sort(function (a, b) {
    if (a.order === null && b.order === null) return 0;
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return a.order - b.order;
  });

  return {
    rows: rows,
    total_stores: totalStores,
    partnered: partnered
  };
}

// ============================================================================
// ARTIFACT BUILDERS
// ============================================================================

function _buildArtifacts_(funnel) {
  var now = new Date();
  var generatedAt = now.toISOString();

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
      partnered: funnel.partnered
    },
    funnel: funnel.rows
  };

  var jsonText = JSON.stringify(jsonObj, null, 2) + '\n';

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
  mdLines.push('- Partnered (north-star): **' + funnel.partnered + '**');
  mdLines.push('');
  mdLines.push('## Funnel by status (curated order)');
  mdLines.push('');

  if (!funnel.rows.length) {
    mdLines.push('_(no stages — Pipeline Dashboard is empty)_');
  } else {
    for (var i = 0; i < funnel.rows.length; i++) {
      var r = funnel.rows[i];
      var orderTag = (r.order === null || r.order === undefined) ? '—' : ('#' + r.order);
      var isPartnered = false;
      for (var p = 0; p < PARTNERED_STATUSES.length; p++) {
        if (PARTNERED_STATUSES[p] === r.status) { isPartnered = true; break; }
      }
      var label = isPartnered ? ('**' + r.status + ': ' + r.stores + '**') : (r.status + ': ' + r.stores);
      mdLines.push('- ' + label + '  (' + orderTag + ')');
    }
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
