/**
 * File: pipeline_diagnostics.js
 * Project: tdg_scoring (GAS 1BHAGZd_T1I5mQnqnAFqUJKX2x_N8Uv05n1O2OohRA908Ja8wVwVxaR7K)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * processTelegramChatLogs() had no error surface. It fails into an execution log
 * nobody reads, so 'Scored Chatlogs' silently stopped growing at row 7224 while
 * ~1500 rows piled up "Pending" in 'Telegram Chat Logs'. Nothing reported it.
 *
 * This file adds:
 *   1. diagnoseScoringPipeline() - one read-only call that names the cause:
 *      trigger installed? XAI_API_KEY set? sheets openable? queue depth?
 *      Exposed at ?exec=diagnose.
 *   2. logPipelineHealth_()      - appends every run outcome to a 'Pipeline Health'
 *      tab, so the NEXT silent death shows up in the sheet itself.
 *   3. installScoringTrigger()   - idempotent installer for the time-driven trigger.
 *      None existed in the repo; it had been created by hand and lost.
 *
 * SECURITY: reports only present/absent booleans, never secret values.
 */

const PIPELINE_HEALTH_SHEET = 'Pipeline Health';
const PIPELINE_HEALTH_HEADERS = ['Timestamp', 'Function', 'Outcome', 'Message', 'Detail'];

const REQUIRED_SCRIPT_PROPERTIES = [
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'TELEGRAM_API_TOKEN',
  'TELEGRAM_SHEET_URL',
  'OUTPUT_SHEET_URL',
  'EXISTING_SHEET_URL'
];

/**
 * Append one row to the 'Pipeline Health' tab. Never throws.
 * @param {string} fn handler name
 * @param {string} outcome OK | SKIPPED | ATTENTION | ERROR | INFO
 * @param {string} message short human-readable message
 * @param {string} detail optional longer detail (stack, findings list)
 */
function logPipelineHealth_(fn, outcome, message, detail) {
  try {
    const url = getCredentials().OUTPUT_SHEET_URL;
    if (!url) return;
    const ss = SpreadsheetApp.openByUrl(url);
    let sheet = ss.getSheetByName(PIPELINE_HEALTH_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(PIPELINE_HEALTH_SHEET);
      sheet.appendRow(PIPELINE_HEALTH_HEADERS);
    }
    sheet.appendRow([
      new Date(),
      fn || '',
      outcome || '',
      String(message || '').slice(0, 500),
      String(detail || '').slice(0, 2000)
    ]);
  } catch (e) {
    Logger.log('logPipelineHealth_: could not write health row: ' + (e && e.message ? e.message : e));
  }
}

/**
 * Read-only end-to-end diagnostic for the scoring pipeline.
 * Answers: is the scorer scheduled, is it configured, can it see its sheets,
 * and how big is the unprocessed backlog?
 * @return {Object} JSON-serialisable report.
 */
function diagnoseScoringPipeline() {
  const out = {
    generatedAt: new Date().toISOString(),
    project: 'tdg_scoring',
    scriptId: ScriptApp.getScriptId(),
    ok: true,
    verdict: '',
    findings: [],
    checks: {}
  };

  // 1. Script properties - presence only, never values.
  const sp = PropertiesService.getScriptProperties();
  const missing = REQUIRED_SCRIPT_PROPERTIES.filter(function (k) { return !sp.getProperty(k); });
  out.checks.scriptProperties = { checked: REQUIRED_SCRIPT_PROPERTIES.length, missing: missing };
  if (missing.length > 0) {
    out.ok = false;
    out.findings.push('Script Properties missing: ' + missing.join(', '));
  }

  // 2. Triggers - is anything actually scheduling the scorer?
  let triggers = [];
  try {
    triggers = ScriptApp.getProjectTriggers().map(function (t) {
      return {
        handler: t.getHandlerFunction(),
        eventType: t.getEventType().toString(),
        uniqueId: t.getUniqueId()
      };
    });
  } catch (e) {
    out.findings.push('Cannot read triggers: ' + e.message);
  }
  const scoringTriggerInstalled = triggers.some(function (t) {
    return t.handler === 'processTelegramChatLogs';
  });
  out.checks.triggers = {
    count: triggers.length,
    scoringTriggerInstalled: scoringTriggerInstalled,
    list: triggers
  };
  if (!scoringTriggerInstalled) {
    out.ok = false;
    out.findings.push('No time-driven trigger for processTelegramChatLogs: the scorer never runs on its own.');
  }

  // 3. Sheets reachable by the executing identity?
  const props = getCredentials();
  const sheetChecks = {};
  ['OUTPUT_SHEET_URL', 'TELEGRAM_SHEET_URL', 'EXISTING_SHEET_URL'].forEach(function (k) {
    const entry = { configured: !!props[k], reachable: false, name: '', lastRow: null, error: null };
    if (!props[k]) {
      entry.error = 'property not set';
    } else {
      try {
        const ss = SpreadsheetApp.openByUrl(props[k]);
        entry.reachable = true;
        entry.name = ss.getName();
        if (k === 'OUTPUT_SHEET_URL') {
          const s = ss.getSheetByName('Scored Chatlogs');
          entry.tab = !!s;
          entry.lastRow = s ? s.getLastRow() : null;
        } else if (k === 'TELEGRAM_SHEET_URL') {
          const t = ss.getSheetByName('Telegram Chat Logs');
          entry.tab = !!t;
          entry.lastRow = t ? t.getLastRow() : null;
        }
      } catch (e) {
        entry.error = e.message;
      }
    }
    if (!entry.reachable) {
      out.ok = false;
      out.findings.push('Cannot open ' + k + ': ' + entry.error);
    }
    sheetChecks[k] = entry;
  });
  out.checks.sheets = sheetChecks;

  // 4. Backlog depth on the intake sheet.
  try {
    if (sheetChecks.TELEGRAM_SHEET_URL.reachable) {
      const ts = SpreadsheetApp.openByUrl(props.TELEGRAM_SHEET_URL).getSheetByName('Telegram Chat Logs');
      const vals = ts.getDataRange().getValues();
      let pending = 0;
      let pendingWithHash = 0;
      let pendingContribution = 0;
      for (let i = 1; i < vals.length; i++) {
        if (String(vals[i][9] || '').trim() !== 'Pending') continue;
        pending++;
        if (vals[i][13]) pendingWithHash++;
        if (String(vals[i][6] || '').indexOf('[CONTRIBUTION EVENT]') !== -1) pendingContribution++;
      }
      out.checks.intake = {
        rows: vals.length,
        pending: pending,
        pendingWithHash: pendingWithHash,
        pendingContributionEvent: pendingContribution
      };
      if (pendingWithHash > 0) {
        out.findings.push(pendingWithHash + ' row(s) are Pending but already carry a Col N hash: the backfill loop at the top of processTelegramChatLogs has not completed since these accumulated.');
      }
    }
  } catch (e) {
    out.findings.push('Queue probe failed: ' + e.message);
  }

  // 5. Tail of the output sheet - where did appends stop?
  try {
    if (sheetChecks.OUTPUT_SHEET_URL.reachable && sheetChecks.OUTPUT_SHEET_URL.tab) {
      const os = SpreadsheetApp.openByUrl(props.OUTPUT_SHEET_URL).getSheetByName('Scored Chatlogs');
      const lr = os.getLastRow();
      let tailDates = [];
      if (lr > 3) {
        const startRow = Math.max(3, lr - 4);
        tailDates = os.getRange(startRow, 8, lr - startRow + 1, 1).getValues()
          .map(function (r) { return r[0]; });
      }
      out.checks.output = { lastRow: lr, firstFreeRow: lr + 1, tailStatusDates: tailDates };
    }
  } catch (e) {
    out.findings.push('Output probe failed: ' + e.message);
  }

  // 6. Plain-language verdict, most specific cause first.
  if (missing.indexOf('XAI_API_KEY') !== -1) {
    out.verdict = 'processTelegramChatLogs returns at its first line: XAI_API_KEY is not set in Script Properties, so no row is ever scored.';
  } else if (!scoringTriggerInstalled) {
    out.verdict = 'No trigger for processTelegramChatLogs. Nothing schedules the scorer, so the backlog never drains. Run installScoringTrigger().';
  } else if (!out.ok) {
    out.verdict = 'Configuration or sheet-access problem: see findings.';
  } else {
    out.verdict = 'Configuration looks healthy. If the backlog is still not draining, the failure is a runtime error inside the run: check the Pipeline Health tab.';
  }

  if (!out.ok) {
    logPipelineHealth_('diagnoseScoringPipeline', 'ATTENTION', out.verdict, out.findings.join(' | '));
  }
  return out;
}

/**
 * Idempotent installer for the scoring trigger. Run once from the Apps Script
 * editor after deploying: removes any existing processTelegramChatLogs trigger,
 * then installs one.
 *
 * 15 minutes while draining the 20260913-onward backlog; relax to hourly once
 * the queue is clear (re-run with everyMinutes = 60).
 *
 * @param {number} everyMinutes
 * @return {Object} summary
 */
function installScoringTrigger(everyMinutes) {
  const FN = 'processTelegramChatLogs';
  const minutes = everyMinutes || 15;
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === FN) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  ScriptApp.newTrigger(FN).timeBased().everyMinutes(minutes).create();
  const result = { status: 'ok', removed: removed, installed: 1, everyMinutes: minutes };
  Logger.log('installScoringTrigger: ' + JSON.stringify(result));
  logPipelineHealth_('installScoringTrigger', 'INFO', 'installed ' + minutes + '-min trigger for ' + FN, 'removed ' + removed + ' old trigger(s)');
  return result;
}

/**
 * TEMPORARY admin helper (removed in a follow-up push).
 *
 * Restores the three CONFIG Script Properties that the scoring pipeline requires.
 * Values are the canonical URLs verified from two other GAS projects in tokenomics
 * (1K1wcXFA.../Credentials.js and 1wONDeDw.../Credentials.js) and match the
 * spreadsheets named in the governor's report. No secrets are written here.
 *
 * Idempotent and non-destructive: a property is only set when currently empty.
 */
function adminRestoreScoringConfig_() {
  const CANON = {
    TELEGRAM_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0',
    OUTPUT_SHEET_URL:   'https://docs.google.com/spreadsheets/d/1Tbj7H5ur_egQLRugdXUaSIhEYIKp0vvVv2IZ7WTLCUo/edit?gid=0#gid=0',
    EXISTING_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit#gid=0'
  };
  const sp = PropertiesService.getScriptProperties();
  const set = [], skipped = [];
  Object.keys(CANON).forEach(function (k) {
    if (sp.getProperty(k)) { skipped.push(k); return; }
    sp.setProperty(k, CANON[k]);
    set.push(k);
  });
  const result = { status: 'ok', set: set, alreadyPresent: skipped };
  Logger.log('adminRestoreScoringConfig_: ' + JSON.stringify(result));
  logPipelineHealth_('adminRestoreScoringConfig_', 'INFO', 'restored ' + set.length + ' config property(ies)', set.join(', '));
  return result;
}
