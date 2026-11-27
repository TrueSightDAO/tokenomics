// Run: node tests/gas/agl_contract_name_test.js
//
// Guards extractAglContractName() in
// google_app_scripts/1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl/sales_update_managed_agl_ledgers.js
//
// The bug this exists to prevent: a "strip the prefix" parser turns the
// deep-link form of column G (https://agroverse.shop/shipments/agl13/index.html)
// into "shipments/agl13/index.html", which flowed into the managed ledger as
// "SunMint Tree Planting Contract - shipments/agl13/index.html" -- a corrupted
// liability row. The same string also broke the agl4 *exclusion* compare, which
// risks double-booking a sale into two ledgers.
//
// The sample list is taken from the live 'QR Code Sales' column G so the parser
// is tested against what actually appears there, not an idealised subset.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', '..',
  'google_app_scripts',
  '1duQFfTO0Pj0lC4tPVNmMOhNOS1GvJgzqVxXbsEDu-eqt_64DwxvrOVyl',
  'sales_update_managed_agl_ledgers.js');

const src = fs.readFileSync(SRC, 'utf8');
const sandbox = {
  Logger: { log: () => {} },
  console: console,
  SpreadsheetApp: { openByUrl: () => ({}) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => '' }) },
  MailApp: { sendEmail: () => {} },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({}) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  getCredentials: () => ({}),
  setApiKeys: () => {},
  getApiKeys: () => ({}),
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: SRC });

const extract = sandbox.extractAglContractName;
if (typeof extract !== 'function') {
  console.error('FAILED: extractAglContractName not defined in source');
  process.exit(1);
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`  FAIL ${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

// --- canonical form (what column G held historically) ---
eq(extract('https://agroverse.shop/agl4'), 'agl4', 'canonical agl4');
eq(extract('https://agroverse.shop/agl6'), 'agl6', 'canonical agl6');
eq(extract('https://agroverse.shop/agl8'), 'agl8', 'canonical agl8');
eq(extract('https://agroverse.shop/agl10'), 'agl10', 'canonical agl10');
eq(extract('https://truesight.me/sunmint/pp1'), 'pp1', 'canonical sunmint pp1');
eq(extract('https://truesight.me/sunmint/sef1'), 'sef1', 'canonical sunmint sef1');

// --- deep-link form (the regression) ---
eq(extract('https://agroverse.shop/shipments/agl13/index.html'), 'agl13', 'deep link agl13 -> contract not path');
eq(extract('https://agroverse.shop/shipments/agl4/index.html'), 'agl4', 'deep link agl4 (must parse to agl4 so the exclusion still works)');
eq(extract('https://agroverse.shop/shipments/agl4'), 'agl4', 'deep link without index.html');
eq(extract('https://agroverse.shop/shipments/agl13/index.html/'), 'agl13', 'deep link trailing slash');

// --- no garbage ever reaches the ledger ---
['https://agroverse.shop/shipments/agl13/index.html',
 'https://agroverse.shop/shipments/agl4/index.html',
 'https://agroverse.shop/agl4'].forEach(function (u) {
  const n = extract(u);
  if (n.indexOf('/') !== -1 || n.indexOf('.') !== -1) {
    fail++;
    console.error(`  FAIL parser leaked a path/filename for ${u}: ${JSON.stringify(n)}`);
  } else { pass++; }
});

// --- non-contract / unparseable inputs must return '' (caller skips loudly) ---
eq(extract('NA'), '', 'NA is not a contract');
eq(extract(''), '', 'empty string');
eq(extract('   '), '', 'whitespace');
eq(extract('https://agroverse.shop/'), '', 'bare origin');
eq(extract('https://agroverse.shop'), '', 'origin without trailing slash');
eq(extract('https://example.com/agl4'), '', 'foreign origin');
eq(extract(null), '', 'null');
eq(extract(undefined), '', 'undefined');
eq(extract('https://agroverse.shop/index.html'), '', 'index.html alone is not a contract');

// --- url hygiene ---
eq(extract('https://agroverse.shop/agl4?ref=x'), 'agl4', 'query string stripped');
eq(extract('https://agroverse.shop/agl4#top'), 'agl4', 'fragment stripped');
eq(extract('https://agroverse.shop/agl4/'), 'agl4', 'trailing slash');

// --- the exact corruption must be impossible ---
if (extract('https://agroverse.shop/shipments/agl13/index.html') === 'shipments/agl13/index.html') {
  fail++;
  console.error('  FAIL regression: deep link still returns the raw path fragment');
} else { pass++; }

console.log(`\nagl_contract_name_test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
