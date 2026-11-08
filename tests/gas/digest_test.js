// Run: node tests/gas/digest_test.js   (plain node, no deps, no network)
// Regression tests for tree_planting_digest.js. Plain `node`, no deps.
// Lives OUTSIDE the GAS project dir so `clasp push` never deploys it.
//
// Guards the no-new-trees GATE: zero new rows must send NO email AND leave the
// watermark untouched, so the next real submission is not skipped.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'google_app_scripts',
  '1Jp8qNIBCZaRTlmOmbJoJmYnSFyXtQkUHP2Qv5uqKZpt0Ugo-e25nhASF',
  'tree_planting_digest.js');

let fails = 0, passes = 0;
function ok(cond, name, extra) {
  if (cond) { passes++; console.log('  PASS  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

function makeCtx(props) {
  const store = Object.assign({}, props || {});
  const sent = [], writes = [];
  const ctx = {
    console,
    creds: { SHEET_ID: 'SHEET' },
    sunMintTabName: 'SunMint Tree Planting',
    Utilities: {
      formatDate(d, tz, fmt) {
        const p = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(d);
        const g = (t) => p.find((x) => x.type === t).value;
        return g('year') + g('month') + g('day');
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty: (k) => (k in store ? store[k] : null),
          setProperty: (k, v) => { store[k] = String(v); writes.push([k, String(v)]); }
        };
      }
    },
    MailApp: { sendEmail: (o) => sent.push(o) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({}) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
    _sent: sent, _writes: writes, _store: store
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'tree_planting_digest.js' });
  return ctx;
}

console.log('\n-- treeDigestTimemark_ --');
{
  const c = makeCtx();
  ok(c.treeDigestTimemark_('https://x/y/20261022213237_MIIBIjANBgkqhkiG9w0B.jpg') === '20261022213237', 'extracts 14-digit code');
  ok(c.treeDigestTimemark_('https://x/y/bomsucesso_tree12.jpg') === 'bomsucesso_tree12.jpg', 'falls back to filename (legacy)');
  ok(c.treeDigestTimemark_('') === '', 'empty -> empty');
}

console.log('\n-- treeDigestAddDays_ --');
{
  const c = makeCtx();
  ok(c.treeDigestAddDays_('20261031', 1) === '20261101', 'month rollover');
  ok(c.treeDigestAddDays_('20261231', 1) === '20270101', 'year rollover');
  ok(c.treeDigestAddDays_('20260301', -1) === '20260228', 'back one day');
}

console.log('\n-- treeDigestSummarize_ (dedup + the empty-photo fallback) --');
{
  const c = makeCtx();
  const rows = [
    { sheetRow: 2, photoUrl: 'u/20261022213237_a.jpg', latitude: '-3', longitude: '-52', status: 'NEW', species: 'Forestero' },
    { sheetRow: 3, photoUrl: 'u/20261022213237_a.jpg', latitude: '-3', longitude: '-52', status: 'NEW', species: 'Forestero' },
    { sheetRow: 4, photoUrl: 'u/20261022214000_b.jpg', latitude: '', longitude: '', status: 'LINKED', species: 'Criolla' }
  ];
  const s = c.treeDigestSummarize_(rows);
  ok(s.rawRows === 3, 'rawRows counts every row', s.rawRows);
  ok(s.distinctCaptures === 2, 'duplicate timemark collapses', s.distinctCaptures);
  ok(s.duplicateRows === 1, 'duplicateRows = raw - distinct', s.duplicateRows);
  ok(s.noCoords === 1, 'missing coords counted', s.noCoords);
  ok(s.statusNew === 2 && s.linked === 1, 'status tallies', [s.statusNew, s.linked]);
}
{
  const c = makeCtx();
  const rows = [
    { sheetRow: 2, photoUrl: '', latitude: '1', longitude: '2', status: 'NEW', species: 'X' },
    { sheetRow: 3, photoUrl: '', latitude: '1', longitude: '2', status: 'NEW', species: 'X' }
  ];
  const s = c.treeDigestSummarize_(rows);
  ok(s.photoMissing === 2, 'photoMissing tallied', s.photoMissing);
  ok(s.distinctCaptures === 2, 'REGRESSION: rows with no photo stay DISTINCT (not collapsed into 1)', s.distinctCaptures);
}

console.log('\n-- treeDigestRecipients_ --');
{
  ok(makeCtx().treeDigestRecipients_()[0] === 'garyjob@agroverse.shop', 'default recipient');
  const m = makeCtx({ TREE_DIGEST_RECIPIENTS: ' a@b.com , c@d.com ' });
  ok(JSON.stringify(m.treeDigestRecipients_()) === JSON.stringify(['a@b.com', 'c@d.com']), 'property override trims + splits');
}

console.log('\n-- THE GATE: no new trees => no email, watermark frozen --');
{
  const c = makeCtx();
  c.treeDigestToday_ = () => '20261109';
  c.treeDigestScan_ = () => ({ rows: [], lastRow: 1 });
  const r = c.sendDailyTreePlantingDigest({});
  ok(r.sent === false, 'sent=false');
  ok(r.reason === 'no new tree submissions in window', 'reason explains why', r.reason);
  ok(c._sent.length === 0, 'MailApp NOT called');
  ok(c._writes.length === 0, 'watermark NOT advanced', c._store);
  ok(!('TREE_DIGEST_LAST_RUN_DATE' in c._store), 'no watermark key created at all');
}

console.log('\n-- dry run with rows: still no email, no watermark --');
{
  const c = makeCtx();
  c.treeDigestToday_ = () => '20261109';
  c.treeDigestScan_ = () => ({ rows: [
    { sheetRow: 2, photoUrl: 'u/20261107120000_a.jpg', latitude: '1', longitude: '2', status: 'NEW', species: 'X' }
  ], lastRow: 2 });
  const r = c.sendDailyTreePlantingDigest({ dryRun: true });
  ok(r.sent === false && r.dryRun === true, 'sent=false, dryRun=true');
  ok(r.rawRows === 1 && r.distinctCaptures === 1, 'reports counts', [r.rawRows, r.distinctCaptures]);
  ok(c._sent.length === 0, 'MailApp NOT called on dry run');
  ok(c._writes.length === 0, 'watermark NOT advanced on dry run');
}

console.log('\n-- live run with rows: sends once, advances watermark --');
{
  const c = makeCtx();
  c.treeDigestToday_ = () => '20261109';
  c.treeDigestScan_ = () => ({ rows: [
    { sheetRow: 2, photoUrl: 'u/20261107120000_a.jpg', latitude: '1', longitude: '2', status: 'NEW', species: 'X' },
    { sheetRow: 3, photoUrl: 'u/20261107120000_a.jpg', latitude: '1', longitude: '2', status: 'NEW', species: 'X' }
  ], lastRow: 3 });
  const r = c.sendDailyTreePlantingDigest({});
  ok(r.sent === true, 'sent=true');
  ok(c._sent.length === 1, 'exactly one email');
  ok(/^SunMint trees: 1 new \(2 submissions\)/.test(c._sent[0].subject),
     'subject LEADS with distinct captures, discloses raw', c._sent[0].subject);
  ok(c._store.TREE_DIGEST_LAST_RUN_DATE === '20261109', 'watermark advanced to today', c._store);
}
{
  const c = makeCtx({ TREE_DIGEST_LAST_RUN_DATE: '20261105' });
  c.treeDigestToday_ = () => '20261109';
  let seen = null;
  c.treeDigestScan_ = (f, t) => { seen = [f, t]; return { rows: [], lastRow: 1 }; };
  c.sendDailyTreePlantingDigest({});
  ok(seen[0] === '20261106', 'window starts day AFTER last run (exclusive)', seen);
  ok(seen[1] === '20261109', 'window ends today', seen);
}

console.log('\n' + (fails === 0 ? 'ALL ' + passes + ' PASSED' : fails + ' FAILED, ' + passes + ' passed'));
process.exit(fails === 0 ? 0 : 1);
