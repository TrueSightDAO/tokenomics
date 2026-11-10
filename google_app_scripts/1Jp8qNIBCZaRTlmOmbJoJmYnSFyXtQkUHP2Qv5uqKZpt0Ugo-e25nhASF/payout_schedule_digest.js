/**
 * payout_schedule_digest.js
 *
 * Daily "Payout Schedule" (PS) auto-attachment.
 *
 * Named per agentic_ai_context/sops/PAYOUT_REPORT_SOP.md §0.1: document class is
 * "Payout Schedule" (abbrev PS), filename PS_<program-slug>_<YYYY-MM-DD>_<count>trees.pdf.
 *
 * WHAT THIS DOES
 *   Reads the ledger sheet (source of truth for paid-vs-unpaid), computes trees that are
 *   PIX-registered but have no BOOKED payout event, renders a PS as a Google Doc, exports
 *   it to PDF (real link annotations, not dead text), and emails it as an attachment.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not pay anything, submit payout events, or move money. It produces a schedule.
 *   Payment remains gated on an explicit governor go.
 *
 * Executing account: garyjob@agroverse.shop (appsscript.json executeAs=USER_DEPLOYING),
 * which is OWNER of both the SunMint sheet and ledger sheet 17KwmxY... — no share grant needed.
 */

/* ------------------------------------------------------------------ constants */

const PS_LEDGER_SHEET_ID = '17KwmxYOpTVR89ybRlOkDXoN9PF3UcaNu3REg2wNa83w';
const PS_TAB_TREES = 'tree planting';
const PS_TAB_REGISTRATIONS = 'payout registrations';
const PS_TAB_EVENTS = 'payout events';

const PS_PROGRAM_SLUG = 'crf-anapu';
const PS_UNIT_BRL = 5;

const PS_RECIPIENTS_PROPERTY = 'TREE_PS_RECIPIENTS';
const PS_LAST_SIGNATURE_PROPERTY = 'TREE_PS_LAST_SIGNATURE';
const PS_DROP_IDS_PROPERTY = 'TREE_PS_DROP_TREE_IDS';
const PS_DEFAULT_RECIPIENTS = 'garyjob@agroverse.shop';

const PS_TZ = 'America/Los_Angeles';
const PS_MAX_ORPHANS_LISTED = 25;
const PS_DRAFT_BANNER = 'DRAFT — UNRECONCILED. Not a payout authorization.';

/** Known duplicate captures from the 86-tree CRF Anapu payout (never pay twice). */
const PS_SEED_DROP_IDS = [
  'Edgar_20261012113108_257',
  'Edgar_20261012113720_289',
  'Edgar_20261012114137_319',
  'Edgar_20261015021935_103',
  'Edgar_20261015021946_105'
];

const PS_LINK_TREE = 'https://cfr.truesight.me/my-trees/?tree=';
const PS_LINK_EXPLORER = 'https://beta.truesight.me/ledger/explorer/?event=';

/* ------------------------------------------------------------------ helpers */

function psToday_() {
  return Utilities.formatDate(new Date(), PS_TZ, 'yyyy-MM-dd');
}

function psReadTab_(sheetId, tabName) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" not found in ' + sheetId);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { header: [], rows: [] };
  const header = values[0].map(function (h) {
    return String(h).trim();
  });
  return { header: header, rows: values.slice(1) };
}

function psCol_(header, name, tabName) {
  const i = header.indexOf(name);
  if (i < 0) throw new Error('Column "' + name + '" missing from tab "' + tabName + '"');
  return i;
}

function psCell_(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  const v = row[idx];
  return v === null || v === undefined ? '' : String(v).trim();
}

function psRecipients_() {
  const props = PropertiesService.getScriptProperties();
  const raw = String(props.getProperty(PS_RECIPIENTS_PROPERTY) || PS_DEFAULT_RECIPIENTS);
  return raw.split(',').map(function (s) {
    return s.trim();
  }).filter(String);
}

function psDropIds_() {
  const props = PropertiesService.getScriptProperties();
  const raw = String(props.getProperty(PS_DROP_IDS_PROPERTY) || '').trim();
  const extra = raw ? raw.split(',').map(function (s) { return s.trim(); }).filter(String) : [];
  const seen = {};
  return PS_SEED_DROP_IDS.concat(extra).filter(function (id) {
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function psMoney_(n) {
  // One currency convention only (avoids R$ 1.085,00 vs R$ 1,085.00 in the same doc).
  return 'R$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ core compute */

/**
 * Compute the unpaid, de-duplicated, PIX-registered tree set.
 *
 * Returns:
 *   rows       payable tree rows (deduped): {tree_id, species, created_at_utc, lat, lng, pk_hash, pix_key, is_pseudo, link}
 *   dupes      rows dropped as duplicate captures
 *   orphans    tree rows whose pk_hash has no ACTIVE PIX registration (unpayable)
 *   paidCount  distinct tree ids with a BOOKED payout event
 *   totalBrl   rows.length * PS_UNIT_BRL
 */
function psComputeSchedule_() {
  const trees = psReadTab_(PS_LEDGER_SHEET_ID, PS_TAB_TREES);
  const regs = psReadTab_(PS_LEDGER_SHEET_ID, PS_TAB_REGISTRATIONS);
  const events = psReadTab_(PS_LEDGER_SHEET_ID, PS_TAB_EVENTS);

  const tCreated = psCol_(trees.header, 'created_at_utc', PS_TAB_TREES);
  const tPk = psCol_(trees.header, 'pk_hash', PS_TAB_TREES);
  const tTreeId = psCol_(trees.header, 'tree_id', PS_TAB_TREES);
  const tSpecies = psCol_(trees.header, 'species', PS_TAB_TREES);
  const tLat = psCol_(trees.header, 'lat', PS_TAB_TREES);
  const tLng = psCol_(trees.header, 'lng', PS_TAB_TREES);
  const tReq = psCol_(trees.header, 'request_transaction_id', PS_TAB_TREES);

  const rPk = psCol_(regs.header, 'pk_hash', PS_TAB_REGISTRATIONS);
  const rStatus = psCol_(regs.header, 'status', PS_TAB_REGISTRATIONS);
  const rPix = psCol_(regs.header, 'pix_key', PS_TAB_REGISTRATIONS);

  const eTree = psCol_(events.header, 'tree_planting_id', PS_TAB_EVENTS);
  const eStatus = psCol_(events.header, 'status', PS_TAB_EVENTS);

  // --- ACTIVE PIX registrations: pk_hash -> pix_key
  const activePix = {};
  regs.rows.forEach(function (r) {
    if (psCell_(r, rStatus).toUpperCase() !== 'ACTIVE') return;
    const pk = psCell_(r, rPk);
    if (pk) activePix[pk] = psCell_(r, rPix);
  });

  // --- paid set: tree ids carrying at least one BOOKED payout event.
  //     BOOKED only: LEDGER_NOT_BOOKED means the legs never booked, i.e. NOT paid.
  const paid = {};
  events.rows.forEach(function (r) {
    if (psCell_(r, eStatus).toUpperCase() !== 'BOOKED') return;
    const ids = psCell_(r, eTree).match(/Edgar_\d+_\d+/g) || [];
    ids.forEach(function (id) {
      paid[id] = true;
    });
  });

  // --- explicit drop list (financial safety net, independent of the dedup heuristic)
  const dropIds = {};
  psDropIds_().forEach(function (id) {
    dropIds[id] = true;
  });

  const payable = [];
  const dupes = [];
  const orphans = [];
  const seenCapture = {};

  // Oldest-first so "keep the earliest capture" is deterministic.
  const sorted = trees.rows.slice().sort(function (a, b) {
    return psCell_(a, tCreated).localeCompare(psCell_(b, tCreated));
  });

  sorted.forEach(function (r) {
    const treeId = psCell_(r, tTreeId);
    const pk = psCell_(r, tPk);
    if (!treeId) return;
    if (paid[treeId]) return; // already settled

    const row = {
      tree_id: treeId,
      species: psCell_(r, tSpecies),
      created_at_utc: psCell_(r, tCreated),
      lat: psCell_(r, tLat),
      lng: psCell_(r, tLng),
      pk_hash: pk
    };

    // Orphans: no ACTIVE PIX key => cannot be paid yet. Surface, never silently pay.
    if (!activePix[pk]) {
      row.pix_key = '';
      row.reason = 'no ACTIVE PIX registration for pk_hash';
      orphans.push(row);
      return;
    }
    row.pix_key = activePix[pk];

    if (dropIds[treeId]) {
      row.reason = 'on drop list';
      dupes.push(row);
      return;
    }

    // Dedup by capture key (request_transaction_id). Keep earliest.
    const captureKey = psCell_(r, tReq) || treeId;
    if (seenCapture[captureKey]) {
      row.reason = 'duplicate capture of ' + seenCapture[captureKey];
      dupes.push(row);
      return;
    }
    seenCapture[captureKey] = treeId;

    // Pseudo tree (blank coords) => Ledger Explorer fallback; real tree => provenance page.
    const isPseudo = !row.lat || !row.lng;
    row.is_pseudo = isPseudo;
    row.link = isPseudo ? PS_LINK_EXPLORER + treeId : PS_LINK_TREE + treeId;
    payable.push(row);
  });

  return {
    rows: payable,
    dupes: dupes,
    orphans: orphans,
    paidCount: Object.keys(paid).length,
    totalBrl: payable.length * PS_UNIT_BRL,
    pixKeys: (function () {
      const by = {};
      payable.forEach(function (r) {
        by[r.pix_key] = (by[r.pix_key] || 0) + 1;
      });
      return by;
    })()
  };
}

/* ------------------------------------------------------------------ PDF build */

function psBuildDoc_(sched, dateStr) {
  const name = 'PS_' + PS_PROGRAM_SLUG + '_' + dateStr + '_' + sched.rows.length + 'trees';
  const doc = DocumentApp.create(name);
  const body = doc.getBody();

  body.appendParagraph('Payout Schedule (' + PS_PROGRAM_SLUG + ')')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(PS_DRAFT_BANNER).setBold(true);
  body.appendParagraph('Generated ' + dateStr + ' · ' + sched.rows.length + ' trees · ' +
    psMoney_(sched.totalBrl) + ' · STATUS: NOT PAID');

  // --- summary
  body.appendParagraph('1. Summary').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Trees payable: ' + sched.rows.length);
  body.appendParagraph('Unit amount: ' + psMoney_(PS_UNIT_BRL) + ' per tree');
  body.appendParagraph('Total to transfer: ' + psMoney_(sched.totalBrl));
  body.appendParagraph('Duplicate captures excluded: ' + sched.dupes.length);
  body.appendParagraph('Orphan trees (no PIX key): ' + sched.orphans.length);
  body.appendParagraph('Already paid (BOOKED payout events): ' + sched.paidCount);

  // --- per-key block
  body.appendParagraph('2. Pay-to PIX account(s)').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const keys = Object.keys(sched.pixKeys).sort();
  keys.forEach(function (k) {
    body.appendParagraph(k + ' — ' + sched.pixKeys[k] + ' trees');
  });

  // --- per-item schedule with real hyperlinks
  body.appendParagraph('3. Per-item schedule').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  let expectedLinks = 0;
  sched.rows.forEach(function (r, i) {
    const p = body.appendParagraph(
      (i + 1) + '. ' + r.tree_id + ' · ' + (r.species || 'n/a') + ' · ' +
      psMoney_(PS_UNIT_BRL) + ' · ' + (r.is_pseudo ? 'pseudo tree' : r.lat + ',' + r.lng) + ' · '
    );
    if (r.link) {
      const t = p.appendText('view tree');
      t.setLinkUrl(r.link);
      t.setUnderline(true);
      expectedLinks++;
    }
  });

  // --- excluded
  body.appendParagraph('4. Excluded').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (!sched.dupes.length && !sched.orphans.length) {
    body.appendParagraph('None.');
  }
  sched.dupes.forEach(function (r) {
    body.appendParagraph('duplicate — ' + r.tree_id + ' (' + r.reason + ')');
  });
  sched.orphans.slice(0, PS_MAX_ORPHANS_LISTED).forEach(function (r) {
    body.appendParagraph('orphan — ' + r.tree_id + ' (pk_hash ' + r.pk_hash + ' has no ACTIVE PIX key)');
  });
  if (sched.orphans.length > PS_MAX_ORPHANS_LISTED) {
    body.appendParagraph('… and ' + (sched.orphans.length - PS_MAX_ORPHANS_LISTED) + ' more orphans');
  }

  // --- footer / definitions
  body.appendParagraph('5. Definitions').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Tree ID = canonical tree_planting_id from the ledger.');
  body.appendParagraph('Pseudo tree = row with blank lat/lng; provenance resolves via Ledger Explorer.');
  body.appendParagraph('Status NOT PAID. This schedule authorizes nothing; payment requires an explicit governor go.');

  doc.saveAndClose();
  return { docId: doc.getId(), expectedLinks: expectedLinks, name: name };
}

function psExportPdf_(docId) {
  const file = DriveApp.getFileById(docId);
  const blob = file.getAs('application/pdf');
  const bytes = blob.getBytes();
  // Verify real link annotations survived the export (SOP §4).
  let uriCount = 0;
  try {
    const raw = Utilities.newBlob(bytes).getDataAsString('ISO-8859-1');
    const m = raw.match(/\/URI/g);
    uriCount = m ? m.length : 0;
  } catch (e) {
    uriCount = -1; // unverifiable — report it, never assume it passed
  }
  return { blob: blob, bytes: bytes.length, uriCount: uriCount };
}

function psSignature_(sched) {
  const ids = sched.rows.map(function (r) { return r.tree_id; }).sort();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ids.join('\n'));
  return ids.length + ':' + digest.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('').slice(0, 16);
}

/* ------------------------------------------------------------------ entrypoint */

/**
 * Build and (optionally) email the daily Payout Schedule.
 *
 * opts.dryRun     compute + report only (no Doc, no mail, no watermark advance)
 * opts.force      send even when the unpaid set is unchanged
 * opts.skipEmail  render the PDF but do not send
 */
function sendDailyPayoutSchedule(opts) {
  const options = opts || {};
  const props = PropertiesService.getScriptProperties();
  const today = psToday_();

  const sched = psComputeSchedule_();

  if (!sched.rows.length) {
    return {
      status: 'success',
      sent: false,
      reason: 'no unpaid PIX-registered trees',
      date: today,
      paidCount: sched.paidCount,
      orphans: sched.orphans.length
    };
  }

  const signature = psSignature_(sched);
  const lastSig = String(props.getProperty(PS_LAST_SIGNATURE_PROPERTY) || '');

  const base = {
    status: 'success',
    date: today,
    trees: sched.rows.length,
    totalBrl: sched.totalBrl,
    dupesExcluded: sched.dupes.length,
    orphans: sched.orphans.length,
    alreadyPaid: sched.paidCount,
    signature: signature,
    signatureChanged: signature !== lastSig,
    fileName: 'PS_' + PS_PROGRAM_SLUG + '_' + today + '_' + sched.rows.length + 'trees.pdf'
  };

  if (options.dryRun) {
    base.dryRun = true;
    base.sent = false;
    base.preview = sched.rows.slice(0, 10).map(function (r) { return r.tree_id; });
    base.pixKeys = sched.pixKeys;
    return base;
  }

  // Change-only gate: identical unpaid set => do not send a byte-identical attachment.
  if (!options.force && signature === lastSig) {
    base.sent = false;
    base.reason = 'unpaid set unchanged since last send (use force to override)';
    return base;
  }

  const built = psBuildDoc_(sched, today);
  let pdf;
  try {
    pdf = psExportPdf_(built.docId);
  } finally {
    try { DriveApp.getFileById(built.docId).setTrashed(true); } catch (e) { /* leave it */ }
  }

  base.expectedLinkCount = built.expectedLinks;
  base.pdfLinkCount = pdf.uriCount;
  base.pdfBytes = pdf.bytes;
  base.linksVerified = built.expectedLinks > 0 && pdf.uriCount === built.expectedLinks;

  const recipients = psRecipients_();
  base.recipients = recipients;

  const subject = 'Payout Schedule: ' + sched.rows.length + ' trees, ' +
    psMoney_(sched.totalBrl) + ' — NOT PAID (' + today + ')';
  const bodyText = [
    'Daily Payout Schedule for ' + PS_PROGRAM_SLUG + ' — ' + today,
    '',
    'Trees payable: ' + sched.rows.length,
    'Total: ' + psMoney_(sched.totalBrl) + ' at ' + psMoney_(PS_UNIT_BRL) + '/tree',
    'Duplicate captures excluded: ' + sched.dupes.length,
    'Orphan trees with no PIX key: ' + sched.orphans.length,
    'Already paid (BOOKED): ' + sched.paidCount,
    '',
    'STATUS: NOT PAID. The attached schedule authorizes nothing;',
    'payment requires an explicit governor go.',
    '',
    'Link annotations verified in PDF: ' + pdf.uriCount + ' / ' + built.expectedLinks
  ].join('\n');

  if (options.skipEmail) {
    base.sent = false;
    base.subject = subject;
    return base;
  }

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subject,
    body: bodyText,
    name: 'TrueSight DAO — Payout Schedule',
    attachments: [pdf.blob]
  });

  props.setProperty(PS_LAST_SIGNATURE_PROPERTY, signature);
  base.sent = true;
  base.subject = subject;
  return base;
}

/* ------------------------------------------------------------------ triggers */

/** Install the daily PS trigger. Idempotent — removes only PS triggers, never the digest's. */
function installPayoutScheduleTrigger(hour) {
  removePayoutScheduleTrigger();
  const h = typeof hour === 'number' ? hour : 8;
  ScriptApp.newTrigger('sendDailyPayoutSchedule')
    .timeBased()
    .atHour(h)
    .everyDays(1)
    .inTimezone(PS_TZ)
    .create();
  return { status: 'success', installed: true, hour: h, timezone: PS_TZ };
}

function removePayoutScheduleTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyPayoutSchedule') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return { status: 'success', removed: removed };
}

function getPayoutScheduleStatus() {
  const props = PropertiesService.getScriptProperties();
  return {
    ledgerSheetId: PS_LEDGER_SHEET_ID,
    programSlug: PS_PROGRAM_SLUG,
    unitBrl: PS_UNIT_BRL,
    recipients: psRecipients_(),
    dropIds: psDropIds_(),
    lastSignature: String(props.getProperty(PS_LAST_SIGNATURE_PROPERTY) || ''),
    triggers: ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === 'sendDailyPayoutSchedule';
    }).length
  };
}
