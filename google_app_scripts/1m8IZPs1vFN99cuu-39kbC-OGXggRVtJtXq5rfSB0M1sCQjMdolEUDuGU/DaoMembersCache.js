/**
 * File: google_app_scripts/tdg_identity_management/dao_members_cache_publisher.gs
 * Repository: https://github.com/TrueSightDAO/tokenomics
 *
 * Summary:
 * - Publishes `dao_members.json` to `TrueSightDAO/treasury-cache` (branch: main)
 *   so `dao_client/cache/contributors.py` can flip from GAS to GitHub-raw.
 * - Contributor-aggregated shape (a contributor can have N active public keys):
 *     {
 *       generated_at, schema_version: 3,
 *       contributors: [
 *         { name, email, roles, voting_rights, public_keys: [{ public_key, status,
 *           created_at, last_active_at }] }
 *       ]
 *     }
 *
 * Schema v3 (current):
 *   - `email` — first non-empty `Contributor Email Address` (col F) seen across
 *     the contributor's ACTIVE rows on `Contributors Digital Signatures`. May be
 *     `null` if no row has an email yet (older legacy contributors).
 *   - `roles` — string array; always includes "member"; includes "governor" if
 *     the contributor's name appears on the `Governors` tab (auto-derived 4×/year
 *     from the trailing 180-day contribution leaderboard).
 *   These two fields back the dapp permission model: `permissions.js` resolves
 *   the signed-in RSA → contributor → roles, and gates governor-only UI/actions
 *   (add-contributor, governor chat, act-on-behalf-of-other) accordingly. The
 *   email is also used by the dedup pre-flight on the new add-contributor flow.
 *
 * Triggers:
 * - Edgar → doGet(?action=refresh_dao_members_cache&secret=...) on every
 *   successful [EMAIL VERIFICATION EVENT] activation.
 * - Daily safety-net time trigger (installDaoMembersCacheDailyTrigger()) so
 *   the cache self-heals if Edgar's ping ever drops.
 *
 * Script properties required (Project Settings → Script properties):
 * - CONTRIBUTORS_CACHE_GITHUB_PAT — GitHub PAT with `contents:write` on
 *   TrueSightDAO/treasury-cache. Scope the token to that single repo.
 * - EMAIL_VERIFICATION_SECRET — reused from edgar_send_email_verification.gs;
 *   doGet routing requires the same shared secret.
 *
 * Manual smoke test:
 * - Run `publishDaoMembersCacheNow()` from the Apps Script editor once to
 *   confirm PAT + repo access. Check treasury-cache git history for the commit.
 */

const DAO_MEMBERS_CACHE_SPREADSHEET_ID =
    '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';
const DAO_MEMBERS_CACHE_SIGS_SHEET = 'Contributors Digital Signatures';
const DAO_MEMBERS_CACHE_VOTING_SHEET = 'Contributors voting weight';
const DAO_MEMBERS_CACHE_GOVERNORS_SHEET = 'Governors';
// Governor names live in column A starting at row 11 (rows 1–10 are header /
// configuration / equinox-rotation copy). The cell list is auto-populated by
// formulas elsewhere in the workbook based on the trailing contribution
// leaderboard; we just read the resolved name strings here.
const DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW = 11;
const DAO_MEMBERS_CACHE_REPO_OWNER = 'TrueSightDAO';
const DAO_MEMBERS_CACHE_REPO_NAME = 'treasury-cache';
const DAO_MEMBERS_CACHE_REPO_PATH = 'dao_members.json';
const DAO_MEMBERS_CACHE_BRANCH = 'main';
const DAO_MEMBERS_CACHE_SCHEMA_VERSION = 3;

// assetVerify web app in tdg_asset_management — source of DAO-wide aggregates
// (voting_rights_circulated, total_assets, asset_per_circulated_voting_right,
// usd_provisions_for_cash_out). We call it once per publish with any active
// signature to avoid duplicating the off-chain + USDT vault + AGL holdings
// helpers into this project.
const DAO_MEMBERS_CACHE_ASSET_VERIFY_URL =
    'https://script.google.com/macros/s/AKfycbygmwRbyqse-dpCYMco0rb93NSgg-Jc1QIw7kUiBM7CZK6jnWnMB5DEjdoX_eCsvVs7/exec';

/**
 * doGet-routed entry (see Code.js).
 * body = { secret, force }
 */
function handleDaoMembersCacheRefreshRequest_(body) {
  try {
    const expected = PropertiesService.getScriptProperties()
        .getProperty('EMAIL_VERIFICATION_SECRET');
    if (!expected || String(body.secret || '') !== String(expected)) {
      return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: 'Unauthorized' }))
          .setMimeType(ContentService.MimeType.JSON);
    }
    const result = publishDaoMembersCacheToGithub_({
      trigger: 'edgar_webhook',
      force: body.force === '1' || body.force === 'true' || body.force === true,
    });
    return ContentService
        .createTextOutput(JSON.stringify({ ok: true, ...result }))
        .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('handleDaoMembersCacheRefreshRequest_ failed: ' + err);
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}

/** Manual trigger for Apps Script editor smoke-testing. */
function publishDaoMembersCacheNow() {
  const result = publishDaoMembersCacheToGithub_({ trigger: 'manual', force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** Time-based trigger entry. Install once via installDaoMembersCacheDailyTrigger(). */
function refreshDaoMembersCacheFromTrigger_() {
  try {
    return publishDaoMembersCacheToGithub_({ trigger: 'cron', force: false });
  } catch (err) {
    Logger.log('refreshDaoMembersCacheFromTrigger_ failed: ' + err);
    throw err;
  }
}

/** One-time setup. Creates a daily time trigger at ~03:00 UTC. */
function installDaoMembersCacheDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshDaoMembersCacheFromTrigger_') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('refreshDaoMembersCacheFromTrigger_')
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .inTimezone('UTC')
      .create();
  Logger.log('Installed daily UTC 03:00 refresh trigger.');
}

/**
 * Core: read the two contributor tabs, build the JSON, PUT to GitHub.
 * Returns a summary dict for logging / HTTP response.
 */
function publishDaoMembersCacheToGithub_(opts) {
  const o = opts || {};
  const token = PropertiesService.getScriptProperties()
      .getProperty('CONTRIBUTORS_CACHE_GITHUB_PAT');
  if (!token) {
    throw new Error('Script property CONTRIBUTORS_CACHE_GITHUB_PAT is not set.');
  }

  const ss = SpreadsheetApp.openById(DAO_MEMBERS_CACHE_SPREADSHEET_ID);

  // ----- Contributors Digital Signatures (header row 1; A-H) ---------------
  const sigsSheet = ss.getSheetByName(DAO_MEMBERS_CACHE_SIGS_SHEET);
  if (!sigsSheet) throw new Error('Missing sheet: ' + DAO_MEMBERS_CACHE_SIGS_SHEET);
  const sigsLastRow = sigsSheet.getLastRow();
  const sigsRows = sigsLastRow >= 2
      ? sigsSheet.getRange(2, 1, sigsLastRow - 1, 8).getValues()
      : [];

  // ----- Contributors voting weight (header row 4; C = name, I = total TDG) -
  const votingSheet = ss.getSheetByName(DAO_MEMBERS_CACHE_VOTING_SHEET);
  if (!votingSheet) throw new Error('Missing sheet: ' + DAO_MEMBERS_CACHE_VOTING_SHEET);
  const votingLastRow = votingSheet.getLastRow();
  const votingByName = {};
  if (votingLastRow >= 5) {
    // Columns C(3)..K(11): name, wallet, quadratic, TDG in wallet, unissued,
    // legacy controlled, total controlled, percentage, voting power.
    const votingRows = votingSheet.getRange(5, 3, votingLastRow - 4, 9).getValues();
    votingRows.forEach(function (row) {
      const name = String(row[0] || '').trim();
      if (!name) return;
      votingByName[name.toLowerCase()] = {
        voting_rights: toNumberOrNull_(row[6]),          // I = Total TDG controlled
        total_voting_power_pct: String(row[8] || ''),     // K = Total Voting Power
      };
    });
  }

  // ----- Governors tab — names of currently-elected governors --------------
  // Read column A from row 11 to last-row, lowercase, stash in a Set-like map.
  // The leaderboard is recomputed quarterly (equinoxes / solstices) by the
  // workbook itself; we just take a snapshot of the current resolved names.
  const governorsSheet = ss.getSheetByName(DAO_MEMBERS_CACHE_GOVERNORS_SHEET);
  const governorsByName = {};
  if (governorsSheet) {
    const govLastRow = governorsSheet.getLastRow();
    if (govLastRow >= DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW) {
      const govRows = governorsSheet
          .getRange(DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW, 1,
                    govLastRow - DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW + 1, 1)
          .getValues();
      govRows.forEach(function (row) {
        const name = String(row[0] || '').trim();
        if (!name) return;
        governorsByName[name.toLowerCase()] = true;
      });
    }
  } else {
    Logger.log(
        'Warning: ' + DAO_MEMBERS_CACHE_GOVERNORS_SHEET + ' tab not found; ' +
        'all contributors will be emitted with roles=["member"] only.');
  }

  // ----- Aggregate signatures by contributor name --------------------------
  // Email lives on col F (`Contributor Email Address`); per-key in the sheet
  // but we hoist the first non-empty email to the contributor record because
  // the dedup pre-flight on the new add-contributor flow checks "email seen
  // for any active key of any contributor."
  const byName = {};
  sigsRows.forEach(function (row) {
    const name = String(row[0] || '').trim();
    const status = String(row[3] || '').trim().toUpperCase();
    const publicKey = String(row[4] || '').trim();
    const email = String(row[5] || '').trim().toLowerCase();
    if (!name || !publicKey || status !== 'ACTIVE') return;
    const key = name.toLowerCase();
    if (!byName[key]) byName[key] = { name: name, email: null, public_keys: [] };
    if (!byName[key].email && email) byName[key].email = email;
    byName[key].public_keys.push({
      public_key: publicKey,
      status: status,
      created_at: formatTimestamp_(row[1]),
      last_active_at: formatTimestamp_(row[2]),
    });
  });

  // ----- Merge voting weight + governor flag + emit sorted contributors ----
  const contributors = Object.keys(byName).sort().map(function (k) {
    const entry = byName[k];
    const voting = votingByName[k] || {};
    const roles = ['member'];
    if (governorsByName[k]) roles.unshift('governor');
    return {
      name: entry.name,
      email: entry.email,                                  // may be null
      roles: roles,                                        // ["governor","member"] or ["member"]
      voting_rights: voting.voting_rights,                 // may be null
      total_voting_power_pct: voting.total_voting_power_pct || null,
      public_keys: entry.public_keys,
    };
  });

  // DAO-wide totals. Fetched via assetVerify (which already aggregates
  // off-chain + USDT vault + AGL holdings) using any active public key as a
  // probe. Emitted at snapshot root so consumers like dapp/tdg_balance.js can
  // render USD values without hitting GAS on every page load.
  const probeKey = (contributors[0] && contributors[0].public_keys[0] &&
      contributors[0].public_keys[0].public_key) || null;
  const daoTotals = probeKey ? fetchDaoTotalsViaAssetVerify_(probeKey) : null;

  // Surface the raw governor snapshot so ops can spot governor-tab names that
  // don't join cleanly to a contributor (e.g. typos, ledger codes like
  // "AGL15", or recently-added governors who haven't yet registered a
  // signature). These names get no roles flag in `contributors[]` because
  // there's no contributor record to attach to.
  const matchedGovernorNames = {};
  contributors.forEach(function (c) {
    if (c.roles.indexOf('governor') >= 0) matchedGovernorNames[c.name.toLowerCase()] = true;
  });
  const unjoinedGovernorNames = Object.keys(governorsByName)
      .filter(function (k) { return !matchedGovernorNames[k]; })
      .sort();

  const snapshot = {
    generated_at: new Date().toISOString(),
    schema_version: DAO_MEMBERS_CACHE_SCHEMA_VERSION,
    source: 'dao_members_cache_publisher',
    trigger: o.trigger || 'unknown',
    counts: {
      contributors: contributors.length,
      active_public_keys: contributors.reduce(function (sum, c) {
        return sum + c.public_keys.length;
      }, 0),
      governors: contributors.reduce(function (sum, c) {
        return sum + (c.roles.indexOf('governor') >= 0 ? 1 : 0);
      }, 0),
      contributors_with_email: contributors.reduce(function (sum, c) {
        return sum + (c.email ? 1 : 0);
      }, 0),
    },
    dao_totals: daoTotals,
    unjoined_governor_names: unjoinedGovernorNames,
    contributors: contributors,
  };

  const content = JSON.stringify(snapshot, null, 2) + '\n';
  const commitMessage =
      'chore: refresh dao_members.json (' + snapshot.counts.contributors +
      ' contributors, ' + snapshot.counts.governors + ' governors, ' +
      snapshot.counts.contributors_with_email + ' with email, ' +
      snapshot.counts.active_public_keys + ' active keys, trigger=' +
      snapshot.trigger + ')';

  const commit = commitJsonToGithub_({
    token: token,
    owner: DAO_MEMBERS_CACHE_REPO_OWNER,
    repo: DAO_MEMBERS_CACHE_REPO_NAME,
    path: DAO_MEMBERS_CACHE_REPO_PATH,
    branch: DAO_MEMBERS_CACHE_BRANCH,
    content: content,
    commitMessage: commitMessage,
    skipIfUnchanged: !o.force,
  });

  return {
    counts: snapshot.counts,
    generated_at: snapshot.generated_at,
    github: commit,
  };
}

function commitJsonToGithub_(args) {
  const baseUrl = 'https://api.github.com/repos/' + args.owner + '/' + args.repo +
      '/contents/' + args.path;
  const headers = {
    'Authorization': 'token ' + args.token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TrueSightDAO-tdg-identity-management/1.0',
  };

  // GET current file to capture sha + detect no-op writes.
  const existing = UrlFetchApp.fetch(baseUrl + '?ref=' + encodeURIComponent(args.branch), {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true,
  });
  let sha = null;
  if (existing.getResponseCode() === 200) {
    const existingJson = JSON.parse(existing.getContentText());
    sha = existingJson.sha;
    if (args.skipIfUnchanged && existingJson.content) {
      const existingContent = Utilities.newBlob(
          Utilities.base64Decode(existingJson.content.replace(/\n/g, ''))
      ).getDataAsString();
      // Compare everything except `generated_at` / `trigger` so cron reruns
      // don't create empty commits.
      if (stripVolatileFields_(existingContent) === stripVolatileFields_(args.content)) {
        return { status: 'unchanged', sha: sha };
      }
    }
  } else if (existing.getResponseCode() !== 404) {
    throw new Error(
        'GitHub GET failed (HTTP ' + existing.getResponseCode() + '): ' +
        existing.getContentText().substring(0, 400));
  }

  const payload = {
    message: args.commitMessage,
    content: Utilities.base64Encode(args.content),
    branch: args.branch,
  };
  if (sha) payload.sha = sha;

  const resp = UrlFetchApp.fetch(baseUrl, {
    method: 'put',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    throw new Error(
        'GitHub PUT failed (HTTP ' + resp.getResponseCode() + '): ' +
        resp.getContentText().substring(0, 400));
  }
  const body = JSON.parse(resp.getContentText());
  return {
    status: sha ? 'updated' : 'created',
    sha: body.content && body.content.sha,
    commit_url: body.commit && body.commit.html_url,
  };
}

/**
 * Fetches DAO-wide aggregates from the assetVerify web app. Returns null on
 * any error so a degraded snapshot still publishes (dapp falls back to the
 * GAS path in that case — same as the pre-cache world).
 */
function fetchDaoTotalsViaAssetVerify_(anyActivePublicKey) {
  try {
    const url = DAO_MEMBERS_CACHE_ASSET_VERIFY_URL +
        '?signature=' + encodeURIComponent(anyActivePublicKey) + '&full=true';
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('assetVerify probe HTTP ' + resp.getResponseCode() + ': ' +
          resp.getContentText().substring(0, 400));
      return null;
    }
    const body = JSON.parse(resp.getContentText());
    if (!body || body.error) {
      Logger.log('assetVerify probe returned error: ' + JSON.stringify(body));
      return null;
    }
    // Keep only DAO-wide fields; drop the probe's per-contributor voting_rights.
    return {
      voting_rights_circulated: body.voting_rights_circulated || null,
      total_assets: body.total_assets || null,
      asset_per_circulated_voting_right: body.asset_per_circulated_voting_right || null,
      usd_provisions_for_cash_out: body.usd_provisions_for_cash_out || null,
    };
  } catch (err) {
    Logger.log('fetchDaoTotalsViaAssetVerify_ failed: ' + err);
    return null;
  }
}

function stripVolatileFields_(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    delete parsed.generated_at;
    delete parsed.trigger;
    return JSON.stringify(parsed);
  } catch (_) {
    return jsonStr;
  }
}

function formatTimestamp_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString();
  }
  return String(value);
}

function toNumberOrNull_(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}
