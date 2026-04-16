/**
 * SeaCoast / Omega freight quotation ingestion (Gmail → Grok → GitHub PR) + Sheet log.
 *
 * Script properties (Project Settings → Script properties):
 * - AGROVERSE_FREIGHT_QUOTATIONS_UPDATE_GITHUB_PAT (repo write + PR)
 * - XAI_API_KEY
 * - FREIGHT_QUOTE_LOG_SPREADSHEET_ID (default below if unset)
 * - FREIGHT_QUOTE_LOG_SHEET_NAME (default: SeaCoast Logistic Email Message Log)
 * - GITHUB_OWNER (default: TrueSightDAO)
 * - GITHUB_REPO (default: agroverse-freight-audit)
 * - GMAIL_QUOTE_QUERY (optional; default Graziela + recent)
 * - GROK_MODEL (optional; default grok-2-latest)
 * - GITHUB_AUTO_MERGE (optional; default false)
 * - MAX_MESSAGES_PER_RUN (optional; default 20)
 */

var DEFAULT_LOG_SPREADSHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
var DEFAULT_LOG_SHEET_NAME = 'SeaCoast Logistic Email Message Log';
var DEFAULT_GITHUB_OWNER = 'TrueSightDAO';
var DEFAULT_GITHUB_REPO = 'agroverse-freight-audit';
var DEFAULT_GMAIL_QUERY = 'from:(Graziela@5cl.rs OR graziela@5cl.rs) newer_than:180d';
var DEFAULT_GROK_MODEL = 'grok-2-latest';

var LABEL_PROCESSED = 'freight/seacoast-processed';
var LABEL_IGNORED = 'freight/seacoast-ignored';
var LABEL_REVIEW = 'freight/seacoast-review-needed';

var HEADER_ROW = [
  'message_id',
  'thread_id',
  'internal_date_iso',
  'from',
  'to',
  'subject',
  'snippet',
  'grok_is_quote',
  'grok_confidence',
  'lane_id',
  'snapshot_path',
  'pr_url',
  'status',
  'error',
  'processed_at_iso',
  'content_hash'
];

function getProp_(key, defaultValue) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v != null && String(v).trim() !== '' ? String(v).trim() : defaultValue;
}

function getConfig_() {
  return {
    githubPat: PropertiesService.getScriptProperties().getProperty('AGROVERSE_FREIGHT_QUOTATIONS_UPDATE_GITHUB_PAT'),
    xaiKey: PropertiesService.getScriptProperties().getProperty('XAI_API_KEY'),
    logSpreadsheetId: getProp_('FREIGHT_QUOTE_LOG_SPREADSHEET_ID', DEFAULT_LOG_SPREADSHEET_ID),
    logSheetName: getProp_('FREIGHT_QUOTE_LOG_SHEET_NAME', DEFAULT_LOG_SHEET_NAME),
    githubOwner: getProp_('GITHUB_OWNER', DEFAULT_GITHUB_OWNER),
    githubRepo: getProp_('GITHUB_REPO', DEFAULT_GITHUB_REPO),
    gmailQuery: getProp_('GMAIL_QUOTE_QUERY', DEFAULT_GMAIL_QUERY),
    grokModel: getProp_('GROK_MODEL', DEFAULT_GROK_MODEL),
    autoMerge: String(getProp_('GITHUB_AUTO_MERGE', 'false')).toLowerCase() === 'true',
    maxMessages: parseInt(getProp_('MAX_MESSAGES_PER_RUN', '20'), 10) || 20
  };
}

function assertConfigured_() {
  var cfg = getConfig_();
  if (!cfg.githubPat) throw new Error('Missing Script Property: AGROVERSE_FREIGHT_QUOTATIONS_UPDATE_GITHUB_PAT');
  if (!cfg.xaiKey) throw new Error('Missing Script Property: XAI_API_KEY');
  return cfg;
}

function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (label) return label;
  return GmailApp.createLabel(name);
}

function sha256Hex_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    var v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function stripCodeFences_(text) {
  text = String(text || '').trim();
  if (text.indexOf('```') === 0) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/m, '').trim();
  }
  return text;
}

function parseJsonStrict_(text) {
  return JSON.parse(stripCodeFences_(text));
}

function getLogSheet_() {
  var cfg = assertConfigured_();
  var ss = SpreadsheetApp.openById(cfg.logSpreadsheetId);
  var sh = ss.getSheetByName(cfg.logSheetName);
  if (!sh) {
    sh = ss.insertSheet(cfg.logSheetName);
  }
  return sh;
}

function ensureHeaders_() {
  var sh = getLogSheet_();
  var first = sh.getRange(1, 1, 1, HEADER_ROW.length).getValues()[0];
  if (String(first[0] || '').trim() !== HEADER_ROW[0]) {
    sh.clear();
    sh.getRange(1, 1, 1, HEADER_ROW.length).setValues([HEADER_ROW]);
    sh.setFrozenRows(1);
  }
}

function loadProcessedMessageIds_() {
  var sh = getLogSheet_();
  var last = sh.getLastRow();
  if (last < 2) return {};
  var values = sh.getRange(2, 1, last, 1).getValues();
  var map = {};
  for (var i = 0; i < values.length; i++) {
    var id = values[i][0] ? String(values[i][0]).trim() : '';
    if (id) map[id] = true;
  }
  return map;
}

function appendLogRow_(row) {
  var sh = getLogSheet_();
  sh.appendRow(row);
}

function isQuoteCandidateHeuristic_(plainBody) {
  var b = String(plainBody || '').toLowerCase();
  if (!b) return false;
  if (b.indexOf('usd') === -1 && b.indexOf(' usd') === -1 && b.indexOf('$') === -1) return false;
  if (b.indexOf('kg') === -1 && b.indexOf('kgs') === -1) return false;
  var keywords = ['air freight', 'freight', 'inland', 'airport', 'customs', 'terminal', 'handling', 'delivery'];
  for (var i = 0; i < keywords.length; i++) {
    if (b.indexOf(keywords[i]) !== -1) return true;
  }
  return false;
}

function callXaiJson_(systemPrompt, userPrompt, cfg) {
  var url = 'https://api.x.ai/v1/chat/completions';
  var payload = {
    model: cfg.grokModel,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + cfg.xaiKey },
    payload: JSON.stringify(payload)
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('xAI HTTP ' + code + ': ' + text.slice(0, 500));
  }
  var data = JSON.parse(text);
  var content = (((data.choices || [])[0] || {}).message || {}).content;
  if (!content) throw new Error('xAI response missing choices[0].message.content');
  return String(content);
}

function classifyQuote_(emailBundle, cfg) {
  var system =
    'You classify whether an email is a freight quotation with actionable pricing lines.\n' +
    'Return ONLY valid JSON with keys: is_quote (boolean), confidence (number 0-1), reason (string).\n' +
    'A filler/status email is NOT a quote even if it mentions shipping generally.';
  var user =
    'From: ' + emailBundle.from + '\n' +
    'Subject: ' + emailBundle.subject + '\n' +
    'Date: ' + emailBundle.internalDateIso + '\n\n' +
    'Body:\n' +
    emailBundle.plainBody.slice(0, 20000);
  var raw = callXaiJson_(system, user, cfg);
  return parseJsonStrict_(raw);
}

function extractQuote_(emailBundle, cfg) {
  var system =
    'You extract structured freight quotation data from an email body.\n' +
    'Return ONLY valid JSON with keys:\n' +
    '- lane_id (string, snake_case)\n' +
    '- lane_title (string)\n' +
    '- calculator (string) one of: tiered_per_kg_plus_line_items | lump_sum_air_freight_scaled_by_weight\n' +
    '- file_slug (string, ascii slug for filenames)\n' +
    '- snapshot (object) compatible with agroverse-freight-audit snapshot JSON style:\n' +
    '  snapshot_id, effective_timestamp_local, timezone, timestamp_source_text, source_vendor,\n' +
    '  source_quote_file (expected repo path), source_quote_original_filename,\n' +
    '  operator_shipment_context, geographic_scope,\n' +
    '  air_freight_rates_usd_per_kg + weight_tiers_kg OR air_freight lump fields,\n' +
    '  cost_components, module_defaults, notes (array of strings)\n' +
    'Use conservative defaults when unknown. If email time is present, use it for effective_timestamp_local.\n';
  var user =
    'From: ' + emailBundle.from + '\n' +
    'Subject: ' + emailBundle.subject + '\n' +
    'Date: ' + emailBundle.internalDateIso + '\n\n' +
    'Body:\n' +
    emailBundle.plainBody.slice(0, 25000);
  var raw = callXaiJson_(system, user, cfg);
  return parseJsonStrict_(raw);
}

function encodeGithubPath_(path) {
  return String(path)
    .split('/')
    .map(function(part) {
      return encodeURIComponent(part);
    })
    .join('/');
}

function githubApi_(method, path, body, cfg) {
  var url = 'https://api.github.com' + path;
  var options = {
    method: String(method || 'get').toUpperCase(),
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.githubPat,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TrueSightDAO-seacoast-freight-ingest'
    }
  };
  if (body != null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub API ' + method + ' ' + path + ' HTTP ' + code + ': ' + text.slice(0, 800));
  }
  return text ? JSON.parse(text) : {};
}

function getMainHeadSha_(cfg) {
  var ref = githubApi_('GET', '/repos/' + cfg.githubOwner + '/' + cfg.githubRepo + '/git/ref/heads/main', null, cfg);
  return ref.object.sha;
}

function createBranch_(branchName, sha, cfg) {
  githubApi_(
    'POST',
    '/repos/' + cfg.githubOwner + '/' + cfg.githubRepo + '/git/refs',
    { ref: 'refs/heads/' + branchName, sha: sha },
    cfg
  );
}

function githubPutFile_(branch, path, contentText, message, cfg) {
  var b64 = Utilities.base64Encode(contentText, Utilities.Charset.UTF_8);
  var body = {
    message: message,
    content: b64,
    branch: branch
  };
  return githubApi_(
    'PUT',
    '/repos/' + cfg.githubOwner + '/' + cfg.githubRepo + '/contents/' + encodeGithubPath_(path),
    body,
    cfg
  );
}

function createPullRequest_(head, title, body, cfg) {
  return githubApi_(
    'POST',
    '/repos/' + cfg.githubOwner + '/' + cfg.githubRepo + '/pulls',
    { title: title, head: head, base: 'main', body: body },
    cfg
  );
}

function mergePullRequest_(number, cfg) {
  return githubApi_(
    'PUT',
    '/repos/' + cfg.githubOwner + '/' + cfg.githubRepo + '/pulls/' + number + '/merge',
    { merge_method: 'merge' },
    cfg
  );
}

function buildEmailBundle_(message) {
  return {
    messageId: message.getId(),
    threadId: message.getThread().getId(),
    internalDateIso: message.getDate() ? message.getDate().toISOString() : '',
    from: message.getFrom(),
    to: message.getTo(),
    subject: message.getSubject(),
    snippet: message.getPlainBody().slice(0, 500),
    plainBody: message.getPlainBody()
  };
}

function sanitizeSlug_(slug) {
  var s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = 'lane';
  return s.slice(0, 96);
}

function processSeacoastFreightQuoteInbox() {
  var cfg = assertConfigured_();
  ensureHeaders_();
  var processed = loadProcessedMessageIds_();

  var threads = GmailApp.search(cfg.gmailQuery, 0, cfg.maxMessages);
  var labelProcessed = getOrCreateLabel_(LABEL_PROCESSED);
  var labelIgnored = getOrCreateLabel_(LABEL_IGNORED);
  var labelReview = getOrCreateLabel_(LABEL_REVIEW);

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      var id = message.getId();
      if (processed[id]) continue;

      var bundle = buildEmailBundle_(message);
      var hash = sha256Hex_(bundle.plainBody || '');
      var nowIso = new Date().toISOString();

      try {
        if (!isQuoteCandidateHeuristic_(bundle.plainBody)) {
          appendLogRow_([
            id,
            bundle.threadId,
            bundle.internalDateIso,
            bundle.from,
            bundle.to,
            bundle.subject,
            bundle.snippet,
            '',
            '',
            '',
            '',
            '',
            'ignored_heuristic',
            '',
            nowIso,
            hash
          ]);
          thread.addLabel(labelIgnored);
          processed[id] = true;
          continue;
        }

        var classification = classifyQuote_(bundle, cfg);
        var isQuote = !!classification.is_quote;
        var conf = typeof classification.confidence === 'number' ? classification.confidence : 0;
        if (!isQuote || conf < 0.65) {
          appendLogRow_([
            id,
            bundle.threadId,
            bundle.internalDateIso,
            bundle.from,
            bundle.to,
            bundle.subject,
            bundle.snippet,
            isQuote,
            conf,
            '',
            '',
            '',
            'ignored_grok',
            classification.reason || '',
            nowIso,
            hash
          ]);
          thread.addLabel(labelIgnored);
          processed[id] = true;
          continue;
        }

        var extracted = extractQuote_(bundle, cfg);
        if (!extracted || !extracted.snapshot || !extracted.file_slug) {
          throw new Error('Grok extract missing snapshot/file_slug');
        }

        var fileSlug = sanitizeSlug_(extracted.file_slug);
        var snapshotJson = JSON.stringify(extracted.snapshot, null, 2);
        var branch =
          'freight/auto-quote-' +
          id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) +
          '-' +
          String(Date.now());
        var headSha = getMainHeadSha_(cfg);
        createBranch_(branch, headSha, cfg);

        var snapshotPath = 'snapshots/' + fileSlug + '_omega-services_freight-pricing.json';
        githubPutFile_(branch, snapshotPath, snapshotJson, 'Add freight snapshot from Gmail ' + id, cfg);

        var emailPath = 'quotations/email/' + fileSlug + '_omega-services_quote.md';
        var emailMd =
          '# Quotation email archive\n\n' +
          '- Gmail message id: `' + id + '`\n' +
          '- Thread id: `' + bundle.threadId + '`\n' +
          '- Internal date: `' + bundle.internalDateIso + '`\n\n' +
          '## Subject\n\n' +
          bundle.subject +
          '\n\n## Body\n\n' +
          bundle.plainBody.slice(0, 200000);
        githubPutFile_(branch, emailPath, emailMd, 'Archive quotation email body for ' + id, cfg);

        var pr = createPullRequest_(
          branch,
          'Freight quote ingest: ' + (extracted.lane_title || extracted.lane_id || extracted.file_slug),
          'Automated PR from SeaCoast freight ingest.\n\n- Snapshot: `' + snapshotPath + '`\n- Email archive: `' + emailPath + '`\n\nGmail message id: `' + id + '`',
          cfg
        );

        var prUrl = pr.html_url || '';
        var prNumber = pr.number;

        if (cfg.autoMerge && prNumber) {
          try {
            mergePullRequest_(prNumber, cfg);
          } catch (mergeErr) {
            // PRs may not be immediately mergeable; leave PR open for manual merge.
          }
        }

        appendLogRow_([
          id,
          bundle.threadId,
          bundle.internalDateIso,
          bundle.from,
          bundle.to,
          bundle.subject,
          bundle.snippet,
          true,
          conf,
          extracted.lane_id || '',
          snapshotPath,
          prUrl,
          cfg.autoMerge ? 'processed_auto_merged' : 'processed_pr_opened',
          '',
          nowIso,
          hash
        ]);
        thread.addLabel(cfg.autoMerge ? labelProcessed : labelReview);
        processed[id] = true;
      } catch (err) {
        appendLogRow_([
          id,
          bundle.threadId,
          bundle.internalDateIso,
          bundle.from,
          bundle.to,
          bundle.subject,
          bundle.snippet,
          '',
          '',
          '',
          '',
          '',
          'error',
          String(err && err.message ? err.message : err),
          nowIso,
          hash
        ]);
        thread.addLabel(labelReview);
        processed[id] = true;
      }
    }
  }
}

/**
 * Manual test entrypoint from Apps Script editor.
 */
function runOnce_processSeacoastFreightQuoteInbox() {
  processSeacoastFreightQuoteInbox();
}
