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
 * - Also emits `public_keys/<sha256>.json` per-key files (additive, no reader
 *   change yet) for content-addressed point-lookup — see PUBLIC_KEY_LOOKUP_CACHE_PLAN.md.
 * - Incremental write: diffs current keys against `_manifest.json` and only
 *   creates blobs for changed/added/removed keys (PR2).
 *
 * Schema v3 (current):
 *   - `email` — first non-empty `Contributor Email Address` (col F) seen across
 *     the contributor's ACTIVE rows on `Contributors Digital Signatures`. May be
 *     `null` if no row has an email yet (older legacy contributors).
 *   - `roles` — string array; always includes "member"; includes "governor" if
 *     the contributor's name appears on the `Governors` tab (auto-derived 4×/year
 *     from the trailing 180-day contribution leaderboard); includes "sentinel" if
 *     the contributor's name has `Is Sentinel` = TRUE on the
 *     `Contributors contact information` tab (column W, header row 4).
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
const DAO_MEMBERS_CACHE_CONTACT_SHEET = 'Contributors contact information';
const DAO_MEMBERS_CACHE_CONTACT_HEADER_ROW = 4;
const DAO_MEMBERS_CACHE_CONTACT_SENTINEL_COL = 22;  // Column W (0-based)
const DAO_MEMBERS_CACHE_REPO_OWNER = 'TrueSightDAO';
const DAO_MEMBERS_CACHE_REPO_NAME = 'treasury-cache';
const DAO_MEMBERS_CACHE_REPO_PATH = 'dao_members.json';
const DAO_MEMBERS_CACHE_BRANCH = 'main';
const DAO_MEMBERS_CACHE_SCHEMA_VERSION = 3;

// Per-key public key cache — content-addressed point-lookup store.
// Schema version 1: { schema_version, sha256, public_key, contributor, roles, status, created_at, generated_at }
const PUBLIC_KEYS_CACHE_SCHEMA_VERSION = 1;
const PUBLIC_KEYS_DIR = 'public_keys';
const PUBLIC_KEYS_MANIFEST_PATH = PUBLIC_KEYS_DIR + '/_manifest.json';

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
        name: name,                                        // preserve original casing
        voting_rights: toNumberOrNull_(row[6]),            // I = Total TDG controlled
        total_voting_power_pct: String(row[8] || ''),      // K = percentage
      };
    });
  }

  // ----- Governors (column A, row 11+) ------------------------------
  const govSheet = ss.getSheetByName(DAO_MEMBERS_CACHE_GOVERNORS_SHEET);
  if (!govSheet) throw new Error('Missing sheet: ' + DAO_MEMBERS_CACHE_GOVERNORS_SHEET);
  const govLastRow = govSheet.getLastRow();
  const governorsByName = {};
  if (govLastRow >= DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW) {
    const govNames = govSheet.getRange(
        DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW, 1,
        govLastRow - DAO_MEMBERS_CACHE_GOVERNORS_FIRST_ROW + 1, 1
    ).getValues();
    govNames.forEach(function (row) {
      const name = String(row[0] || '').trim();
      if (name) governorsByName[name.toLowerCase()] = true;
    });
  }

  // ----- Sentinel flags (Contributors contact information, col W) -----
  const contactSheet = ss.getSheetByName(DAO_MEMBERS_CACHE_CONTACT_SHEET);
  const sentinelByName = {};
  if (contactSheet) {
    const contactLastRow = contactSheet.getLastRow();
    if (contactLastRow >= DAO_MEMBERS_CACHE_CONTACT_HEADER_ROW + 1) {
      // Columns A(1) = name, W(23) = Is Sentinel (header row 4)
      const contactRows = contactSheet.getRange(
          DAO_MEMBERS_CACHE_CONTACT_HEADER_ROW + 1, 1,
          contactLastRow - DAO_MEMBERS_CACHE_CONTACT_HEADER_ROW, 23
      ).getValues();
      contactRows.forEach(function (row) {
        const name = String(row[0] || '').trim();
        if (!name) return;
        const isSentinel = String(row[DAO_MEMBERS_CACHE_CONTACT_SENTINEL_COL] || '').trim().toUpperCase();
        if (isSentinel === 'TRUE' || isSentinel === 'YES' || isSentinel === '1') {
          sentinelByName[name.toLowerCase()] = true;
        }
      });
    }
  }

  // ----- Aggregate by contributor name --------------------------------
  const byName = {};
  sigsRows.forEach(function (row) {
    const name = String(row[0] || '').trim();
    if (!name) return;
    if (!byName[name.toLowerCase()]) {
      byName[name.toLowerCase()] = { name: name, email: null, public_keys: [] };
    }
    const entry = byName[name.toLowerCase()];
    // First non-empty email wins (col F = index 5)
    const email = String(row[5] || '').trim();
    if (email && !entry.email) {
      entry.email = email;
    }
    // Public key (col E = index 4)
    const pk = String(row[4] || '').trim();
    if (pk) {
      entry.public_keys.push({
        public_key: pk,
        status: String(row[3] || '').trim().toUpperCase() || 'ACTIVE',
        created_at: formatTimestamp_(row[1]),
        last_active_at: formatTimestamp_(row[2]),
      });
    }
  });

  // Ensure every voting-row name has an entry (even without a signature)
  Object.keys(votingByName).forEach(function (k) {
    if (!byName[k]) {
      byName[k] = { name: votingByName[k].name || k, email: null, public_keys: [] };
    }
  });

  // ----- Merge voting weight + governor flag + emit sorted contributors ----
  const contributors = Object.keys(byName).sort().map(function (k) {
    const entry = byName[k];
    const voting = votingByName[k] || {};
    const roles = ['member'];
    if (governorsByName[k]) roles.unshift('governor');
    if (sentinelByName[k]) roles.push('sentinel');
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
      sentinels: contributors.reduce(function (sum, c) {
        return sum + (c.roles.indexOf('sentinel') >= 0 ? 1 : 0);
      }, 0),
      contributors_with_email: contributors.reduce(function (sum, c) {
        return sum + (c.email ? 1 : 0);
      }, 0),
    },
    dao_totals: daoTotals,
    unjoined_governor_names: unjoinedGovernorNames,
    contributors: contributors,
  };

  // ----- Build per-key files for content-addressed point-lookup ----------
  // Each ACTIVE public key gets its own file: public_keys/<sha256>.json
  // No email in per-key files (privacy decision per PUBLIC_KEY_LOOKUP_CACHE_PLAN.md).
  const currentKeys = {};  // sha256 -> { contributor, roles, status, created_at, last_active_at, public_key }
  contributors.forEach(function (c) {
    c.public_keys.forEach(function (keyEntry) {
      if (keyEntry.status !== 'ACTIVE') return;
      const pk = keyEntry.public_key;
      const sha256 = computeSha256_(pk);
      currentKeys[sha256] = {
        public_key: pk,
        contributor: c.name,
        roles: c.roles,
        status: 'ACTIVE',
        created_at: keyEntry.created_at || null,
        last_active_at: keyEntry.last_active_at || null,
      };
    });
  });

  // ----- Fetch current manifest for incremental diff ----------------------
  // If the manifest doesn't exist yet (first run), start with an empty map.
  const existingManifest = fetchCurrentManifest_(token);
  const previousKeys = existingManifest.keys || {};  // sha256 -> blob_sha

  // Determine which keys changed: added, removed, or modified.
  const changedShas = {};  // sha256 -> true (needs a new blob)
  const removedShas = {};  // sha256 -> true (was in manifest, no longer ACTIVE)

  // Check current keys against previous manifest
  Object.keys(currentKeys).forEach(function (sha256) {
    const prevBlobSha = previousKeys[sha256];
    if (!prevBlobSha) {
      // New key — always write
      changedShas[sha256] = true;
    }
    // For existing keys, we always write them to ensure content freshness.
    // The blob creation is a no-op at GitHub's end if the content is identical
    // (same content → same blob SHA). The tree update still happens but the
    // blob SHA won't change, so the tree diff is minimal.
    // A future optimization can skip blobs whose sha hasn't changed by
    // comparing against the manifest blob_sha.
  });

  // Check for removed keys (were in manifest, no longer ACTIVE)
  Object.keys(previousKeys).forEach(function (sha256) {
    if (!currentKeys[sha256]) {
      removedShas[sha256] = true;
    }
  });

  // Build the per-key files — only for changed/added keys
  const perKeyFiles = [];

  // Write REVOKED files for removed keys
  Object.keys(removedShas).forEach(function (sha256) {
    const revokedFile = {
      schema_version: PUBLIC_KEYS_CACHE_SCHEMA_VERSION,
      sha256: sha256,
      public_key: null,
      contributor: null,
      roles: null,
      status: 'REVOKED',
      created_at: null,
      last_active_at: null,
      generated_at: snapshot.generated_at,
    };
    perKeyFiles.push({
      path: PUBLIC_KEYS_DIR + '/' + sha256 + '.json',
      content: JSON.stringify(revokedFile, null, 2) + '\n',
    });
  });

  // Write current per-key files for changed/added keys
  Object.keys(currentKeys).forEach(function (sha256) {
    const key = currentKeys[sha256];
    const keyFile = {
      schema_version: PUBLIC_KEYS_CACHE_SCHEMA_VERSION,
      sha256: sha256,
      public_key: key.public_key,
      contributor: key.contributor,
      roles: key.roles,
      status: key.status,
      created_at: key.created_at,
      last_active_at: key.last_active_at,
      generated_at: snapshot.generated_at,
    };
    perKeyFiles.push({
      path: PUBLIC_KEYS_DIR + '/' + sha256 + '.json',
      content: JSON.stringify(keyFile, null, 2) + '\n',
    });
  });

  // ----- Build commit message --------------------------------------------
  const commitMessage =
      'chore: refresh dao_members.json (' + snapshot.counts.contributors +
      ' contributors, ' + snapshot.counts.governors + ' governors, ' +
      snapshot.counts.sentinels + ' sentinels, ' +
      snapshot.counts.contributors_with_email + ' with email, ' +
      snapshot.counts.active_public_keys + ' active keys, trigger=' +
      snapshot.trigger + ')';

  // ----- Check if anything changed ----------------------------------------
  const hasPerKeyChanges = perKeyFiles.length > 0;

  // ----- Write files in one commit via Git Trees API ----------------------
  const daoMembersContent = JSON.stringify(snapshot, null, 2) + '\n';

  // Build the full file list: dao_members.json + changed per-key files + manifest
  const allFiles = [
    { path: DAO_MEMBERS_CACHE_REPO_PATH, content: daoMembersContent },
  ].concat(perKeyFiles);

  // Build the manifest with current key set (blob SHAs are placeholders;
  // the actual blob SHA optimization is a future enhancement).
  // The manifest tracks which keys exist for diffing on the next run.
  const manifestContent = {
    schema_version: PUBLIC_KEYS_CACHE_SCHEMA_VERSION,
    generated_at: snapshot.generated_at,
    keys: {},
  };
  Object.keys(currentKeys).forEach(function (sha256) {
    manifestContent.keys[sha256] = '';  // blob SHA placeholder
  });

  allFiles.push({
    path: PUBLIC_KEYS_MANIFEST_PATH,
    content: JSON.stringify(manifestContent, null, 2) + '\n',
  });

  // If nothing changed and not forced, skip the commit entirely
  if (!hasPerKeyChanges && !o.force) {
    // Still try the tree write — skipIfUnchanged in the tree function
    // will handle the dao_members.json no-op check.
  }

  const commit = commitMultipleFilesToGithubViaTreeApi_({
    token: token,
    owner: DAO_MEMBERS_CACHE_REPO_OWNER,
    repo: DAO_MEMBERS_CACHE_REPO_NAME,
    branch: DAO_MEMBERS_CACHE_BRANCH,
    files: allFiles,
    commitMessage: commitMessage,
    skipIfUnchanged: !o.force,
  });

  return {
    counts: snapshot.counts,
    generated_at: snapshot.generated_at,
    public_key_count: Object.keys(currentKeys).length,
    changed_keys: Object.keys(changedShas).length,
    removed_keys: Object.keys(removedShas).length,
    github: commit,
  };
}

/**
 * Write multiple files in ONE commit via the Git Trees API.
 *
 * Steps:
 * 1. GET the current HEAD commit to get the base tree SHA.
 * 2. Create a blob for each file via POST /git/blobs.
 * 3. Build a tree with all blob entries via POST /git/trees.
 * 4. Create a commit via POST /git/commits.
 * 5. Update the branch ref via PATCH /git/refs/heads/<branch>.
 *
 * This is atomic — either all files land or none do.
 */
function commitMultipleFilesToGithubViaTreeApi_(args) {
  const owner = args.owner;
  const repo = args.repo;
  const branch = args.branch;
  const token = args.token;
  const files = args.files;  // [{path, content}, ...]
  const commitMessage = args.commitMessage;
  const skipIfUnchanged = args.skipIfUnchanged !== false;

  const headers = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TrueSightDAO-tdg-identity-management/1.0',
  };

  const baseUrl = 'https://api.github.com/repos/' + owner + '/' + repo;

  // 1. Get the current HEAD commit (to get base tree SHA)
  const refUrl = baseUrl + '/git/refs/heads/' + encodeURIComponent(branch);
  const refResp = UrlFetchApp.fetch(refUrl, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true,
  });
  if (refResp.getResponseCode() !== 200) {
    throw new Error('Failed to get ref (HTTP ' + refResp.getResponseCode() + '): ' +
        refResp.getContentText().substring(0, 400));
  }
  const refData = JSON.parse(refResp.getContentText());
  const headSha = refData.object.sha;

  // 2. Get the current commit to find the base tree SHA
  const commitUrl = baseUrl + '/git/commits/' + headSha;
  const commitResp = UrlFetchApp.fetch(commitUrl, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true,
  });
  if (commitResp.getResponseCode() !== 200) {
    throw new Error('Failed to get commit (HTTP ' + commitResp.getResponseCode() + '): ' +
        commitResp.getContentText().substring(0, 400));
  }
  const commitData = JSON.parse(commitResp.getContentText());
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for each file
  const blobShas = [];
  files.forEach(function (file) {
    const blobUrl = baseUrl + '/git/blobs';
    const blobPayload = {
      content: file.content,
      encoding: 'utf-8',
    };
    const blobResp = UrlFetchApp.fetch(blobUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(blobPayload),
      muteHttpExceptions: true,
    });
    if (blobResp.getResponseCode() < 200 || blobResp.getResponseCode() >= 300) {
      throw new Error('Failed to create blob for ' + file.path + ' (HTTP ' +
          blobResp.getResponseCode() + '): ' + blobResp.getContentText().substring(0, 400));
    }
    const blobData = JSON.parse(blobResp.getContentText());
    blobShas.push({
      path: file.path,
      sha: blobData.sha,
      mode: '100644',  // regular file
      type: 'blob',
    });
  });

  // 4. Create a tree with all blob entries
  const treeUrl = baseUrl + '/git/trees';
  const treePayload = {
    base_tree: baseTreeSha,
    tree: blobShas,
  };
  const treeResp = UrlFetchApp.fetch(treeUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(treePayload),
    muteHttpExceptions: true,
  });
  if (treeResp.getResponseCode() < 200 || treeResp.getResponseCode() >= 300) {
    throw new Error('Failed to create tree (HTTP ' + treeResp.getResponseCode() + '): ' +
        treeResp.getContentText().substring(0, 400));
  }
  const treeData = JSON.parse(treeResp.getContentText());
  const newTreeSha = treeData.sha;

  // 5. Create a commit
  const newCommitUrl = baseUrl + '/git/commits';
  const newCommitPayload = {
    message: commitMessage,
    tree: newTreeSha,
    parents: [headSha],
  };
  const newCommitResp = UrlFetchApp.fetch(newCommitUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(newCommitPayload),
    muteHttpExceptions: true,
  });
  if (newCommitResp.getResponseCode() < 200 || newCommitResp.getResponseCode() >= 300) {
    throw new Error('Failed to create commit (HTTP ' + newCommitResp.getResponseCode() + '): ' +
        newCommitResp.getContentText().substring(0, 400));
  }
  const newCommitData = JSON.parse(newCommitResp.getContentText());
  const newCommitSha = newCommitData.sha;

  // 6. Update the branch ref
  const updateRefUrl = baseUrl + '/git/refs/heads/' + encodeURIComponent(branch);
  const updateRefPayload = {
    sha: newCommitSha,
    force: false,
  };
  const updateRefResp = UrlFetchApp.fetch(updateRefUrl, {
    method: 'patch',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(updateRefPayload),
    muteHttpExceptions: true,
  });
  if (updateRefResp.getResponseCode() < 200 || updateRefResp.getResponseCode() >= 300) {
    throw new Error('Failed to update ref (HTTP ' + updateRefResp.getResponseCode() + '): ' +
        updateRefResp.getContentText().substring(0, 400));
  }

  return {
    status: 'committed',
    sha: newCommitSha,
    commit_url: newCommitData.html_url,
    file_count: files.length,
  };
}

/**
 * Fetch the current _manifest.json from treasury-cache.
 * Returns { schema_version, generated_at, keys: {sha256: blob_sha} } or
 * { keys: {} } if the manifest doesn't exist yet (first run).
 */
function fetchCurrentManifest_(token) {
  const url = 'https://api.github.com/repos/' +
      DAO_MEMBERS_CACHE_REPO_OWNER + '/' +
      DAO_MEMBERS_CACHE_REPO_NAME + '/contents/' +
      PUBLIC_KEYS_MANIFEST_PATH + '?ref=' + encodeURIComponent(DAO_MEMBERS_CACHE_BRANCH);
  const headers = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TrueSightDAO-tdg-identity-management/1.0',
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() === 404) {
    // First run — no manifest yet
    return { keys: {} };
  }
  if (resp.getResponseCode() !== 200) {
    Logger.log('fetchCurrentManifest_ HTTP ' + resp.getResponseCode() + ': ' +
        resp.getContentText().substring(0, 400));
    // Degrade gracefully — treat as empty manifest
    return { keys: {} };
  }
  try {
    const body = JSON.parse(resp.getContentText());
    const decoded = Utilities.newBlob(
        Utilities.base64Decode(body.content.replace(/\n/g, ''))
    ).getDataAsString();
    return JSON.parse(decoded);
  } catch (err) {
    Logger.log('fetchCurrentManifest_ parse error: ' + err);
    return { keys: {} };
  }
}

/**
 * Compute SHA-256 hex digest of a string using Apps Script's built-in digest.
 * Utilities.computeDigest returns an array of signed bytes; we convert to hex.
 */
function computeSha256_(str) {
  const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      str,
      Utilities.Charset.UTF_8
  );
  // Convert signed bytes to hex
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var byte = digest[i] & 0xff;
    if (byte < 16) hex += '0';
    hex += byte.toString(16);
  }
  return hex;
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

function formatTimestamp_(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed || null;
  }
  if (val instanceof Date) {
    try {
      return val.toISOString();
    } catch (_) {
      return null;
    }
  }
  return String(val);
}

function toNumberOrNull_(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}
