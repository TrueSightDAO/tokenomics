/**
 * File: google_app_scripts/tdg_identity_management/dapp_permission_change_handler.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Processes [DAPP PERMISSION CHANGE EVENT] rows from "Telegram Chat Logs"
 *   (TrueSight DAO Telegram compilation, 1qbZZhf-…). For each pending row:
 *     1. Verify the signer's public key resolves to a contributor whose
 *        display name appears on the Governors tab. (Independent check —
 *        does NOT trust Edgar's pass-through alone.)
 *     2. Optimistic-concurrency check: the event's claimed "Required Roles
 *        (before)" must equal the current value in permissions.json.
 *     3. Apply the change in-memory and PUT the new permissions.json to
 *        TrueSightDAO/treasury-cache via the GitHub Contents API. Reuses
 *        commitJsonToGithub_(...) from dao_members_cache_publisher.gs.
 *     4. Append a row to "Dapp Permission Changes" tab on the same
 *        Telegram-compilation spreadsheet (gid 1054656840) with status,
 *        commit SHA, and any error message.
 *
 * Design / security: see agentic_ai_context/DAPP_PERMISSION_CHANGE_FLOW.md.
 *
 * Triggers:
 * - Edgar → doGet(?action=apply_permission_change) after every successful
 *   [DAPP PERMISSION CHANGE EVENT] persist on Telegram Chat Logs. Edgar's
 *   WebhookTriggerWorker only forwards `action` (no secret), matching the
 *   convention of every other dispatch handler (processTelegramChatLogs,
 *   parseAndProcessTelegramLogs, etc.). The Apps Script deployment URL
 *   itself is the access token (functionally unguessable); real
 *   authorization is the per-event RSA signature + Governors-tab membership
 *   check inside applyPendingPermissionChanges_. Even if the URL leaks, an
 *   attacker can only force-process events that are already on Telegram
 *   Chat Logs with valid governor signatures, and processing is idempotent
 *   on Telegram Update IDs.
 * - Manual: applyDapPermissionChangeNow() from the Apps Script editor.
 *
 * Script properties required:
 * - CONTRIBUTORS_CACHE_GITHUB_PAT — already present (used by
 *   dao_members_cache_publisher.gs). Same scope (`contents:write` on
 *   treasury-cache) covers permissions.json.
 */

const PERMISSIONS_TELEGRAM_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const PERMISSIONS_TELEGRAM_SHEET_NAME = 'Telegram Chat Logs';
const PERMISSIONS_LOG_SHEET_NAME = 'Dapp Permission Changes';
const PERMISSIONS_OFFCHAIN_SPREADSHEET_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const PERMISSIONS_GOVERNORS_SHEET_NAME = 'Governors';
const PERMISSIONS_GOVERNORS_FIRST_ROW = 11;
const PERMISSIONS_SIGS_SHEET_NAME = 'Contributors Digital Signatures';
const PERMISSIONS_REPO_OWNER = 'TrueSightDAO';
const PERMISSIONS_REPO_NAME = 'treasury-cache';
const PERMISSIONS_REPO_PATH = 'permissions.json';
const PERMISSIONS_BRANCH = 'main';
const PERMISSIONS_EVENT_TAG = '[DAPP PERMISSION CHANGE EVENT]';

// "Telegram Chat Logs" column G holds the contribution text (matches
// process_movement_telegram_logs.gs and other event handlers).
const PERMISSIONS_TELEGRAM_TEXT_COL_INDEX = 6;          // 0-based
const PERMISSIONS_TELEGRAM_UPDATE_ID_COL_INDEX = 0;

// "Dapp Permission Changes" column layout — see
// agentic_ai_context/DAPP_PERMISSION_CHANGE_FLOW.md §3.
const PERMISSIONS_LOG_HEADERS = [
  'Telegram Update ID',
  'Submitted At UTC',
  'Actor Public Key',
  'Actor Name',
  'Is Governor',
  'Action',
  'Roles Before (claimed)',
  'Roles Before (actual)',
  'Roles After',
  'Status',
  'GitHub Commit SHA',
  'GitHub Commit URL',
  'Notes',
  'Processed At UTC',
];

/** Manual entry point for editor smoke testing. */
function applyDapPermissionChangeNow() {
  const result = applyPendingPermissionChanges_({ trigger: 'manual' });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * doGet-routed entry. body = { secret, force }.
 *
 * NOTE on auth: this handler does NOT gate on `secret`. Edgar's
 * WebhookTriggerWorker only forwards `action` as a query param (matches
 * processTelegramChatLogs / parseAndProcessTelegramLogs / etc.) — the
 * Apps Script deployment URL itself is the access token (functionally
 * unguessable). Real authorization happens INSIDE applyPendingPermissionChanges_:
 * each event must be RSA-signed and the signer must be on the Governors
 * tab. Even if the deployment URL leaks, an attacker can only force-process
 * events that are already on Telegram Chat Logs with valid governor
 * signatures, and processing is idempotent on Telegram Update IDs.
 */
function handleApplyPermissionChangeRequest_(body) {
  try {
    const result = applyPendingPermissionChanges_({ trigger: 'edgar_webhook' });
    return ContentService
        .createTextOutput(JSON.stringify({ ok: true, ...result }))
        .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('handleApplyPermissionChangeRequest_ failed: ' + err);
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Core: scan Telegram Chat Logs for unprocessed permission-change events,
 * verify + apply each, log to the Dapp Permission Changes tab.
 */
function applyPendingPermissionChanges_(opts) {
  const o = opts || {};
  const token = PropertiesService.getScriptProperties()
      .getProperty('CONTRIBUTORS_CACHE_GITHUB_PAT');
  if (!token) {
    throw new Error('Script property CONTRIBUTORS_CACHE_GITHUB_PAT is not set.');
  }

  const telegramSs = SpreadsheetApp.openById(PERMISSIONS_TELEGRAM_SPREADSHEET_ID);
  const telegramWs = telegramSs.getSheetByName(PERMISSIONS_TELEGRAM_SHEET_NAME);
  if (!telegramWs) {
    throw new Error('Missing sheet: ' + PERMISSIONS_TELEGRAM_SHEET_NAME);
  }
  const logWs = ensureDappPermissionChangesSheet_(telegramSs);
  const seenUpdateIds = readProcessedUpdateIds_(logWs);

  const lastRow = telegramWs.getLastRow();
  if (lastRow < 2) {
    return { trigger: o.trigger, processed: 0, skipped: 0, reason: 'empty_log' };
  }
  const lastCol = Math.max(
      PERMISSIONS_TELEGRAM_TEXT_COL_INDEX,
      PERMISSIONS_TELEGRAM_UPDATE_ID_COL_INDEX) + 1;
  const data = telegramWs.getRange(2, 1, lastRow - 1, lastCol).getValues();

  let processed = 0;
  let skipped = 0;
  const newLogRows = [];
  const offchainSs = SpreadsheetApp.openById(PERMISSIONS_OFFCHAIN_SPREADSHEET_ID);
  const governors = readGovernorNamesLowercase_(offchainSs);
  const sigByPublicKey = readActiveSignaturesByPublicKey_(offchainSs);

  // Pull permissions.json once per webhook fire — successive events in the
  // same batch must each re-check the SHA after a prior commit, so we
  // refresh on each successful apply.
  let cachedManifest = fetchPermissionsManifest_(token);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const text = String(row[PERMISSIONS_TELEGRAM_TEXT_COL_INDEX] || '');
    if (!text || text.indexOf(PERMISSIONS_EVENT_TAG) < 0) continue;

    const updateId = String(row[PERMISSIONS_TELEGRAM_UPDATE_ID_COL_INDEX] || '').trim();
    if (!updateId) continue;
    const priorStatus = seenUpdateIds[updateId];
    if (priorStatus &&
        (priorStatus === 'applied' ||
         priorStatus === 'unauthorized' ||
         priorStatus === 'unknown_action')) {
      skipped++;
      continue;
    }

    const parsed = parsePermissionChangeEvent_(text);
    const publicKey = parsed.publicKey || '';
    const sigEntry = sigByPublicKey[publicKey] || null;
    const actorName = sigEntry ? sigEntry.name : '(unknown)';
    const isGovernor = sigEntry &&
        governors[String(actorName).trim().toLowerCase()] ? true : false;

    const baseRow = {
      updateId: updateId,
      submittedAt: parsed.submittedAt || '',
      publicKey: truncateKey_(publicKey),
      actorName: actorName,
      isGovernor: isGovernor ? 'YES' : 'NO',
      action: parsed.action || '',
      rolesBeforeClaimed: parsed.rolesBeforeClaimed || '',
      rolesBeforeActual: '',
      rolesAfter: parsed.rolesAfter || '',
      status: '',
      commitSha: '',
      commitUrl: '',
      notes: '',
      processedAt: new Date().toISOString(),
    };

    if (parsed.error) {
      baseRow.status = 'invalid_payload';
      baseRow.notes = parsed.error;
      newLogRows.push(logRowFromObject_(baseRow));
      continue;
    }

    if (!isGovernor) {
      baseRow.status = 'unauthorized';
      baseRow.notes = 'Signer is not currently a governor.';
      newLogRows.push(logRowFromObject_(baseRow));
      continue;
    }

    if (!cachedManifest) cachedManifest = fetchPermissionsManifest_(token);
    if (!cachedManifest) {
      baseRow.status = 'github_failed';
      baseRow.notes = 'Could not fetch permissions.json baseline.';
      newLogRows.push(logRowFromObject_(baseRow));
      continue;
    }

    if (Number(parsed.schemaVersion) !==
        Number(cachedManifest.json.schema_version)) {
      baseRow.status = 'concurrency_conflict';
      baseRow.notes = 'Schema version mismatch (expected ' +
          cachedManifest.json.schema_version + ', got ' + parsed.schemaVersion + ').';
      newLogRows.push(logRowFromObject_(baseRow));
      continue;
    }

    const actions = cachedManifest.json.actions || {};
    const deferred = cachedManifest.json.deferred_actions || {};
    let bucket = null;
    if (actions[parsed.action]) bucket = 'actions';
    else if (deferred[parsed.action] && parsed.action !== 'comment') bucket = 'deferred_actions';
    if (!bucket) {
      baseRow.status = 'unknown_action';
      baseRow.notes = 'Action key not found in permissions.json.';
      newLogRows.push(logRowFromObject_(baseRow));
      continue;
    }

    const target = cachedManifest.json[bucket][parsed.action];
    const actualBefore = (target.required_roles || []).slice();
    baseRow.rolesBeforeActual = actualBefore.join(', ');
    if (!rolesEqual_(actualBefore, parsed.rolesBeforeArr)) {
      baseRow.status = 'concurrency_conflict';
      baseRow.notes = 'required_roles changed since the dapp loaded — claimed [' +
          parsed.rolesBeforeArr.join(', ') + '] vs actual [' + actualBefore.join(', ') + ']';
      newLogRows.push(logRowFromObject_(baseRow));
      continue;
    }

    target.required_roles = parsed.rolesAfterArr.slice();
    const newContent = JSON.stringify(cachedManifest.json, null, 2) + '\n';
    const commitMessage =
        'chore(permissions): ' + parsed.action +
        ' [' + actualBefore.join(',') + '] → [' + parsed.rolesAfterArr.join(',') + ']' +
        ' (governor: ' + actorName + ')';
    let commitResult;
    try {
      commitResult = commitJsonToGithub_({
        token: token,
        owner: PERMISSIONS_REPO_OWNER,
        repo: PERMISSIONS_REPO_NAME,
        path: PERMISSIONS_REPO_PATH,
        branch: PERMISSIONS_BRANCH,
        content: newContent,
        commitMessage: commitMessage,
        skipIfUnchanged: false,
      });
    } catch (err) {
      // Common case: 409 (stale SHA — someone else committed in the
      // interim). Refresh and retry once.
      try {
        cachedManifest = fetchPermissionsManifest_(token);
        if (cachedManifest) {
          const target2 = (cachedManifest.json[bucket] || {})[parsed.action];
          if (target2) {
            const actualBefore2 = (target2.required_roles || []).slice();
            if (rolesEqual_(actualBefore2, parsed.rolesBeforeArr)) {
              target2.required_roles = parsed.rolesAfterArr.slice();
              const newContent2 = JSON.stringify(cachedManifest.json, null, 2) + '\n';
              commitResult = commitJsonToGithub_({
                token: token,
                owner: PERMISSIONS_REPO_OWNER,
                repo: PERMISSIONS_REPO_NAME,
                path: PERMISSIONS_REPO_PATH,
                branch: PERMISSIONS_BRANCH,
                content: newContent2,
                commitMessage: commitMessage,
                skipIfUnchanged: false,
              });
            } else {
              baseRow.status = 'concurrency_conflict';
              baseRow.notes = 'Roles drifted between fetch and PUT.';
              newLogRows.push(logRowFromObject_(baseRow));
              continue;
            }
          }
        }
      } catch (err2) {
        baseRow.status = 'github_failed';
        baseRow.notes = String(err2).substring(0, 400);
        newLogRows.push(logRowFromObject_(baseRow));
        continue;
      }
    }

    baseRow.status = 'applied';
    baseRow.commitSha = commitResult && commitResult.sha ? commitResult.sha : '';
    baseRow.commitUrl = commitResult && commitResult.commit_url ? commitResult.commit_url : '';
    baseRow.notes = 'OK.';
    newLogRows.push(logRowFromObject_(baseRow));
    processed++;

    // Refresh local manifest cache so the next event in the same batch
    // sees the latest state.
    cachedManifest = fetchPermissionsManifest_(token);
  }

  if (newLogRows.length) {
    logWs.getRange(logWs.getLastRow() + 1, 1, newLogRows.length, PERMISSIONS_LOG_HEADERS.length)
         .setValues(newLogRows);
  }

  return {
    trigger: o.trigger,
    processed: processed,
    appended_rows: newLogRows.length,
    skipped_seen: skipped,
  };
}

/** Ensures the "Dapp Permission Changes" tab has the canonical header row. */
function ensureDappPermissionChangesSheet_(ss) {
  let ws = ss.getSheetByName(PERMISSIONS_LOG_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(PERMISSIONS_LOG_SHEET_NAME);
  }
  const lastCol = ws.getLastColumn();
  const lastRow = ws.getLastRow();
  if (lastRow === 0 || lastCol === 0) {
    ws.getRange(1, 1, 1, PERMISSIONS_LOG_HEADERS.length)
      .setValues([PERMISSIONS_LOG_HEADERS]);
    ws.getRange(1, 1, 1, PERMISSIONS_LOG_HEADERS.length)
      .setFontWeight('bold');
    ws.setFrozenRows(1);
    return ws;
  }
  // Header row exists but might be a prefix — extend if so.
  const existing = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  if (existing.length < PERMISSIONS_LOG_HEADERS.length) {
    const startCol = existing.length + 1;
    const missing = PERMISSIONS_LOG_HEADERS.slice(existing.length);
    ws.getRange(1, startCol, 1, missing.length).setValues([missing]);
    ws.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
  }
  return ws;
}

/** Read existing rows on the Dapp Permission Changes tab → updateId → status. */
function readProcessedUpdateIds_(logWs) {
  const last = logWs.getLastRow();
  if (last < 2) return {};
  const data = logWs.getRange(2, 1, last - 1, PERMISSIONS_LOG_HEADERS.length).getValues();
  const out = {};
  data.forEach(function (r) {
    const u = String(r[0] || '').trim();
    const status = String(r[9] || '').trim().toLowerCase();
    if (u) out[u] = status;
  });
  return out;
}

/** Lower-cased Set of governor display names from the Governors tab. */
function readGovernorNamesLowercase_(ss) {
  const ws = ss.getSheetByName(PERMISSIONS_GOVERNORS_SHEET_NAME);
  if (!ws) return {};
  const last = ws.getLastRow();
  if (last < PERMISSIONS_GOVERNORS_FIRST_ROW) return {};
  const rows = ws.getRange(
      PERMISSIONS_GOVERNORS_FIRST_ROW, 1,
      last - PERMISSIONS_GOVERNORS_FIRST_ROW + 1, 1).getValues();
  const out = {};
  rows.forEach(function (row) {
    const name = String(row[0] || '').trim();
    if (name) out[name.toLowerCase()] = true;
  });
  return out;
}

/** Map of normalized public key → { name } from Contributors Digital Signatures. */
function readActiveSignaturesByPublicKey_(ss) {
  const ws = ss.getSheetByName(PERMISSIONS_SIGS_SHEET_NAME);
  if (!ws) return {};
  const last = ws.getLastRow();
  if (last < 2) return {};
  const data = ws.getRange(2, 1, last - 1, 8).getValues();
  const out = {};
  data.forEach(function (r) {
    const name = String(r[0] || '').trim();
    const status = String(r[3] || '').trim().toUpperCase();
    const key = String(r[4] || '').trim();
    if (!name || !key || status !== 'ACTIVE') return;
    out[key] = { name: name };
  });
  return out;
}

/** Fetch + parse permissions.json from raw GitHub via the Contents API
 *  (returns the {sha, json} envelope). The PAT is required only for the
 *  PUT; we use it on GET too to keep auth consistent and avoid rate limits. */
function fetchPermissionsManifest_(token) {
  const url = 'https://api.github.com/repos/' + PERMISSIONS_REPO_OWNER + '/' +
      PERMISSIONS_REPO_NAME + '/contents/' + PERMISSIONS_REPO_PATH +
      '?ref=' + encodeURIComponent(PERMISSIONS_BRANCH);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'TrueSightDAO-tdg-identity-management/1.0',
    },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('fetchPermissionsManifest_ HTTP ' + resp.getResponseCode() + ': ' +
        resp.getContentText().substring(0, 400));
    return null;
  }
  const body = JSON.parse(resp.getContentText());
  const decoded = Utilities.newBlob(
      Utilities.base64Decode(body.content.replace(/\n/g, ''))
  ).getDataAsString();
  return { sha: body.sha, json: JSON.parse(decoded) };
}

/** Parse the [DAPP PERMISSION CHANGE EVENT] body. */
function parsePermissionChangeEvent_(text) {
  const lines = String(text).split('\n').map(function (s) { return s.trim(); });
  if (!lines.length || lines[0].indexOf(PERMISSIONS_EVENT_TAG) < 0) {
    return { error: 'Missing event tag.' };
  }
  function pluck(prefix) {
    const m = lines.find(function (l) { return l.indexOf(prefix) === 0; });
    return m ? m.substring(prefix.length).trim() : '';
  }
  const action = pluck('- Action:');
  const rolesBeforeClaimed = pluck('- Required Roles (before):');
  const rolesAfter = pluck('- Required Roles (after):');
  const schemaVersion = pluck('- Manifest Schema Version:');
  const submittedAt = pluck('- Submitted At:');

  // Public key + signature block follow the divider line.
  const pkMatch = text.match(/My Digital Signature:\s*([\s\S]*?)(?:\n\s*Request Transaction ID:|This submission was generated using|$)/i);
  const publicKey = pkMatch ? pkMatch[1].trim() : '';

  if (!action) return { error: 'Missing - Action: line.' };
  if (!schemaVersion) return { error: 'Missing - Manifest Schema Version: line.' };
  if (!submittedAt) return { error: 'Missing - Submitted At: line.' };
  if (!publicKey) return { error: 'Missing My Digital Signature: footer.' };

  return {
    action: action,
    rolesBeforeClaimed: rolesBeforeClaimed,
    rolesAfter: rolesAfter,
    rolesBeforeArr: parseRolesList_(rolesBeforeClaimed),
    rolesAfterArr: parseRolesList_(rolesAfter),
    schemaVersion: schemaVersion,
    submittedAt: submittedAt,
    publicKey: publicKey,
  };
}

function parseRolesList_(s) {
  if (!s) return [];
  return String(s)
      .split(',')
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x; });
}

function rolesEqual_(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const aa = a.slice().sort();
  const bb = b.slice().sort();
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function truncateKey_(k) {
  const s = String(k || '');
  if (s.length <= 60) return s;
  return s.substring(0, 60) + '…';
}

function logRowFromObject_(o) {
  return [
    o.updateId, o.submittedAt, o.publicKey, o.actorName, o.isGovernor,
    o.action, o.rolesBeforeClaimed, o.rolesBeforeActual, o.rolesAfter,
    o.status, o.commitSha, o.commitUrl, o.notes, o.processedAt,
  ];
}
