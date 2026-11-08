/**
 * File: google_app_scripts/sunmint_tree_planting/tree_planting_digest.js
 * Repository: https://github.com/TrueSightDAO/tokenomics
 * Apps Script editor:
 * https://script.google.com/home/projects/1Jp8qNIBCZaRTlmOmbJoJmYnSFyXtQkUHP2Qv5uqKZpt0Ugo-e25nhASF/edit
 *
 * Daily email digest of NEW tree planting submissions.
 *
 * GATE: an email is sent ONLY when at least one new submission landed inside the
 * window. Zero new trees => no email, and the watermark does NOT advance.
 *
 * Window = (last successful digest date, today] in America/Los_Angeles. If no
 * digest has ever run, the window falls back to the last DEFAULT_LOOKBACK_DAYS
 * days so a first install reports something real instead of a silent no-op.
 *
 * Counts are reported TWICE: raw submission rows AND distinct captures keyed on
 * the photo's 14-digit timemark code. These differ a lot (observed 2026-10:
 * 1,309 rows -> 304 distinct captures), so a raw-only figure overstates actual
 * planting by roughly 4x. Surfacing both keeps the email honest.
 *
 * Configuration is via Script Properties -- no code change needed to retarget:
 *   TREE_DIGEST_RECIPIENTS     comma-separated list. Default: garyjob@agroverse.shop
 *   TREE_DIGEST_LAST_RUN_DATE  managed automatically (yyyyMMdd watermark)
 */

const TREE_DIGEST_RECIPIENTS_PROPERTY = 'TREE_DIGEST_RECIPIENTS';
const TREE_DIGEST_LAST_RUN_PROPERTY = 'TREE_DIGEST_LAST_RUN_DATE';
const TREE_DIGEST_DEFAULT_RECIPIENTS = 'garyjob@agroverse.shop';
const TREE_DIGEST_TZ = 'America/Los_Angeles';
const TREE_DIGEST_MAX_LISTED = 50;
const TREE_DIGEST_DEFAULT_LOOKBACK_DAYS = 1;

/** Today as yyyyMMdd in the DAO's operating timezone. */
function treeDigestToday_() {
  return Utilities.formatDate(new Date(), TREE_DIGEST_TZ, 'yyyyMMdd');
}

/** Shift a yyyyMMdd string by delta days (UTC arithmetic on the date parts only). */
function treeDigestAddDays_(yyyymmdd, delta) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return Utilities.formatDate(dt, 'UTC', 'yyyyMMdd');
}

/**
 * Capture key for a photo URL: the 14-digit timemark code in the filename
 * (Agroverse convention, e.g. 20261022213237_MIIBIjANBgkqhkiG9w0B.jpg).
 * Falls back to the bare filename when the code is missing.
 */
function treeDigestTimemark_(photoUrl) {
  const s = String(photoUrl || '');
  const m = s.match(/\/(\d{14})_[^\/]*$/);
  if (m) return m[1];
  return s.split('/').pop() || '';
}

function treeDigestRecipients_() {
  const raw = PropertiesService.getScriptProperties().getProperty(TREE_DIGEST_RECIPIENTS_PROPERTY);
  const list = String(raw || TREE_DIGEST_DEFAULT_RECIPIENTS)
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  return list.length ? list : [TREE_DIGEST_DEFAULT_RECIPIENTS];
}

/**
 * Read `SunMint Tree Planting` rows whose Status date falls in [fromDate, toDate].
 * Returns null when the tab is missing.
 */
function treeDigestScan_(fromDate, toDate) {
  const sheet = SpreadsheetApp.openById(creds.SHEET_ID);
  const tab = sheet.getSheetByName(sunMintTabName);
  if (!tab) return null;
  const lastRow = tab.getLastRow();
  if (lastRow < 2) return { rows: [], lastRow: lastRow };
  const width = Math.max(21, tab.getLastColumn());
  const data = tab.getRange(2, 1, lastRow - 1, width).getValues();
  const rows = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const statusDate = String(r[SUNMINT_STATUS_DATE_COL] || '').trim();
    if (!/^\d{8}$/.test(statusDate)) continue;          // header/blank/marker rows
    if (statusDate < fromDate || statusDate > toDate) continue;
    rows.push({
      sheetRow: i + 2,
      messageId: String(r[SUNMINT_STATUS_MESSAGE_ID_COL] || '').trim(),
      statusDate: statusDate,
      photoUrl: String(r[SUNMINT_PHOTO_URL_COL] || '').trim(),
      submittedName: String(r[SUNMINT_SUBMITTED_NAME_COL] || '').trim(),
      latitude: String(r[SUNMINT_LATITUDE_COL] || '').trim(),
      longitude: String(r[SUNMINT_LONGITUDE_COL] || '').trim(),
      status: String(r[SUNMINT_STATUS_COL] || '').trim().toUpperCase(),
      species: String(r[SUNMINT_SPECIES_COL] || '').trim(),
      plotId: String(r[SUNMINT_PLOT_ID_COL] || '').trim()
    });
  }
  return { rows: rows, lastRow: lastRow };
}

/** Roll scanned rows up into raw counts + capture-level (deduplicated) counts. */
function treeDigestSummarize_(rows) {
  const byCapture = {};
  const species = {};
  let noCoords = 0, statusNew = 0, linked = 0;
  rows.forEach(function (r) {
    const key = treeDigestTimemark_(r.photoUrl) || ('sheetRow-' + r.sheetRow);
    if (!byCapture[key]) byCapture[key] = { species: r.species || 'Unknown', count: 0, first: r };
    byCapture[key].count += 1;
    const sp = r.species || 'Unknown';
    species[sp] = (species[sp] || 0) + 1;
    if (!r.latitude || !r.longitude) noCoords += 1;
    if (r.status === 'NEW') statusNew += 1;
    if (r.status === 'LINKED' || r.status === 'ASSIGNED_TO_TREE') linked += 1;
  });
  const captures = Object.keys(byCapture);
  return {
    rawRows: rows.length,
    distinctCaptures: captures.length,
    duplicateRows: rows.length - captures.length,
    noCoords: noCoords,
    statusNew: statusNew,
    linked: linked,
    species: species,
    byCapture: byCapture,
    captureKeys: captures
  };
}

function treeDigestRenderBody_(summary, fromDate, toDate, sheetLink) {
  const L = [];
  L.push('SunMint / CFR tree planting -- new submissions digest');
  L.push('');
  L.push('Window: ' + fromDate + ' to ' + toDate + ' (Status date, ' + TREE_DIGEST_TZ + ')');
  L.push('');
  L.push('  Submissions received : ' + summary.rawRows);
  L.push('  Distinct trees       : ' + summary.distinctCaptures);
  L.push('  Duplicate re-ingests : ' + summary.duplicateRows +
         (summary.rawRows ? '  (' + Math.round(100 * summary.duplicateRows / summary.rawRows) + '% of rows)' : ''));
  L.push('  Missing coordinates  : ' + summary.noCoords);
  L.push('  Status NEW (unlinked): ' + summary.statusNew);
  L.push('  Already linked to QR : ' + summary.linked);
  L.push('');
  L.push('By species (rows):');
  Object.keys(summary.species).sort(function (a, b) { return summary.species[b] - summary.species[a]; })
    .forEach(function (k) { L.push('  - ' + k + ': ' + summary.species[k]); });
  L.push('');
  L.push('What landed (one line per distinct photo):');
  const keys = summary.captureKeys.slice(0, TREE_DIGEST_MAX_LISTED);
  keys.forEach(function (k) {
    const c = summary.byCapture[k];
    const r = c.first;
    const flags = [];
    if (!r.latitude || !r.longitude) flags.push('NO GPS');
    if (c.count > 1) flags.push('x' + c.count);
    if (r.plotId) flags.push('plot ' + r.plotId);
    L.push('  ' + k + '  ' + (c.species || 'Unknown') +
           '  row ' + r.sheetRow +
           (flags.length ? '  [' + flags.join(', ') + ']' : ''));
  });
  if (summary.captureKeys.length > keys.length) {
    L.push('  ... and ' + (summary.captureKeys.length - keys.length) + ' more');
  }
  if (summary.rawRows !== summary.distinctCaptures) {
    L.push('');
    L.push('NOTE: raw submissions exceed distinct photos. Repeated submissions of the same');
    L.push('photo are counted as separate rows by the intake scanner. The DAO payout');
    L.push('precedent is one capture = one tree, so treat "Distinct trees" as the');
    L.push('payable figure and verify any batch photo before paying the raw count.');
  }
  L.push('');
  L.push('Sheet: ' + sheetLink);
  L.push('');
  L.push('-- Sophia (TrueSight DAO autopilot), automated daily digest');
  return L.join('\n');
}

/**
 * Scan, gate, and (unless dryRun) email the digest.
 *
 * @param {Object} opts  { dryRun:boolean, force:boolean, lookbackDays:number }
 * @return {Object} result summary -- safe to log/return as JSON (no PII in logs).
 */
function sendDailyTreePlantingDigest(opts) {
  const options = opts || {};
  const props = PropertiesService.getScriptProperties();
  const today = treeDigestToday_();
  const lastRun = String(props.getProperty(TREE_DIGEST_LAST_RUN_PROPERTY) || '').trim();

  let fromDate;
  if (/^\d{8}$/.test(lastRun)) {
    fromDate = treeDigestAddDays_(lastRun, 1);           // exclusive of last run
  } else {
    const lb = Number(options.lookbackDays || TREE_DIGEST_DEFAULT_LOOKBACK_DAYS);
    fromDate = treeDigestAddDays_(today, -Math.max(1, lb));
  }
  if (fromDate > today) fromDate = today;                // clock skew / same-day rerun

  const scan = treeDigestScan_(fromDate, today);
  if (!scan) {
    return { status: 'error', message: 'tab "' + sunMintTabName + '" not found', sent: false };
  }

  const summary = treeDigestSummarize_(scan.rows);
  const recipients = treeDigestRecipients_();
  const sheetLink = 'https://docs.google.com/spreadsheets/d/' + creds.SHEET_ID + '/edit';

  // THE GATE: nothing new => no email, and do not advance the watermark.
  if (summary.rawRows === 0 && !options.force) {
    return {
      status: 'success',
      sent: false,
      reason: 'no new tree submissions in window',
      window: { from: fromDate, to: today },
      recipients: recipients
    };
  }

  const subject = 'SunMint trees: ' + summary.distinctCaptures + ' new (' +
                  summary.rawRows + ' submissions) ' + fromDate + '-' + today;
  const body = treeDigestRenderBody_(summary, fromDate, today, sheetLink);

  let sent = false;
  if (!options.dryRun) {
    MailApp.sendEmail({
      to: recipients.join(','),
      subject: subject,
      body: body,
      name: 'TrueSight DAO - SunMint Trees'
    });
    sent = true;
    props.setProperty(TREE_DIGEST_LAST_RUN_PROPERTY, today);
  }

  return {
    status: 'success',
    sent: sent,
    dryRun: !!options.dryRun,
    window: { from: fromDate, to: today },
    rawRows: summary.rawRows,
    distinctCaptures: summary.distinctCaptures,
    duplicateRows: summary.duplicateRows,
    noCoords: summary.noCoords,
    statusNew: summary.statusNew,
    linked: summary.linked,
    recipients: recipients,
    subject: subject,
    bodyPreview: body.slice(0, 1200)
  };
}

/** Install the daily trigger (idempotent -- removes any prior identical trigger first). */
function installTreePlantingDigestTrigger(hour) {
  const HOUR = (hour === undefined || hour === null) ? 20 : Number(hour); // 8pm PT default
  treePlantingDigestRemoveTriggers_();
  ScriptApp.newTrigger('sendDailyTreePlantingDigest')
    .timeBased()
    .atHour(HOUR)
    .everyDays(1)
    .inTimezone(TREE_DIGEST_TZ)
    .create();
  return { status: 'success', installed: true, hour: HOUR, timezone: TREE_DIGEST_TZ };
}

function treePlantingDigestRemoveTriggers_() {
  const all = ScriptApp.getProjectTriggers();
  let removed = 0;
  all.forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyTreePlantingDigest') {
      ScriptApp.deleteTrigger(t);
      removed += 1;
    }
  });
  return removed;
}

function removeTreePlantingDigestTrigger() {
  const removed = treePlantingDigestRemoveTriggers_();
  return { status: 'success', removed: removed };
}

function getTreePlantingDigestStatus() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'sendDailyTreePlantingDigest';
  }).map(function (t) {
    return { handler: t.getHandlerFunction(), type: String(t.getEventType()) };
  });
  return {
    status: 'success',
    lastRunDate: props.getProperty(TREE_DIGEST_LAST_RUN_PROPERTY) || null,
    recipients: treeDigestRecipients_(),
    recipientsFromProperty: !!props.getProperty(TREE_DIGEST_RECIPIENTS_PROPERTY),
    today: treeDigestToday_(),
    triggers: triggers
  };
}
