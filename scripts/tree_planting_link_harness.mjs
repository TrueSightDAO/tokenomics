// Behavioral harness for process_tree_planting_link.js (PR5, plan 1.3/1.4).
// Stubs the Apps Script globals so the link handler's real leg logic runs under node.
// Usage: node scripts/tree_planting_link_harness.mjs <path-to-link-handler.js>
import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');

// ---- minimal GAS stubs -----------------------------------------------------
let mainSheets = {}, managedSheets = {}, sourceSheets = {};
const MAIN_URL = 'https://docs.google.com/spreadsheets/d/1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU/edit';
const MANAGED_URL = 'https://docs.google.com/spreadsheets/d/MANAGED_LEDGER_XYZ/edit';
const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ/edit?gid=0#gid=0';

function makeSheet(name, grid) {
  let g = grid ? grid.map(r => r.slice()) : [];
  return {
    getName(){ return name; },
    getLastRow(){ return g.length; },
    getLastColumn(){ return g.reduce((m,r)=>Math.max(m,r.length),0); },
    getDataRange(){ return { getValues(){ return g.map(r=>r.slice()); } }; },
    getRange(r,c,nr,nc){
      if (nr === undefined) nr = 1;
      if (nc === undefined) nc = 1;
      return {
        getValues(){ const out=[]; for(let i=0;i<nr;i++){ const rr=g[r-1+i]||[]; out.push(rr.slice(c-1,c-1+nc)); } return out; },
        getValue(){ const rr=g[r-1]||[]; return rr[c-1]===undefined?'':rr[c-1]; },
        setValue(v){ const ri=r-1; g[ri]=g[ri]||[]; g[ri][c-1]=v; },
        setValues(v){ for(let i=0;i<v.length;i++){ const ri=r-1+i; g[ri]=g[ri]||[]; for(let j=0;j<v[i].length;j++) g[ri][c-1+j]=v[i][j]; } }
      };
    },
    appendRow(a){ g.push(a.slice()); },
    insertSheet(){ return this; }
  };
}

globalThis.SpreadsheetApp = {
  openByUrl(url){
    const u = String(url||'');
    if (u.indexOf('1GE7PUq-UT6x2rBN') >= 0) {
      return { getSheetByName(n){ return mainSheets[n] || null; } };
    }
    if (u.indexOf('MANAGED_LEDGER_XYZ') >= 0) {
      return { getSheetByName(n){ return managedSheets[n] || null; } };
    }
    if (u.indexOf('1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ') >= 0) {
      return { getSheetByName(n){ return sourceSheets[n] || null; } };
    }
    throw new Error('unexpected spreadsheet url: ' + u);
  },
  openById(id){ return this.openByUrl(id); }
};
globalThis.Logger = { log(){} };
globalThis.Sheet = {};
// ---------------------------------------------------------------------------

// The link handler reuses process_qr_code_updates.js's SOURCE_SHEET_URL (shared GAS scope); expose it.
globalThis.SOURCE_SHEET_URL = SOURCE_URL;
// UrlFetchApp stub for the plot-media fetch (PR6) - overridden per-test via setMediaJson/.
let __mediaResp = { code: 200, text: JSON.stringify({ plots: {} }) };
globalThis.UrlFetchApp = { fetch(){ return { getResponseCode(){ return __mediaResp.code; }, getContentText(){ return __mediaResp.text; } }; } };

// eval source + export in the SAME indirect eval, so the source's top-level consts are in scope
const EXPORTS = ['tplComputeLegs_','tplResolveSource_','tplWriteLegs_','appendTreePlantingLedgerFulfillment_',
  'TPL_MAIN_DAO_LEDGER_URL','TPL_MAIN_DAO_OFFCHAIN_TAB','TPL_TRANSACTIONS_TAB','TPL_POOL_LITERAL',
  'TPL_CUSTOMER_LIABILITY_LITERAL','TPL_TRANSFER_CURRENCY','TPL_MAIN_LEDGER_LEDGER_URLS',
  'tplResolvePlotContributor_','tplPickPlotImage_','tplResolvePlotImage_',
  'TPL_PLOTS_TAB','TPL_PLOTS_CONTRIBUTOR_NAME_COL','TPL_LINKED_PLOT_ID_COL'];
(0, eval)(src + "\n;Object.assign(globalThis, {" + EXPORTS.join(',') + "});");

const tplComputeLegs_ = globalThis.tplComputeLegs_;
const tplResolveSource_ = globalThis.tplResolveSource_;
const tplWriteLegs_ = globalThis.tplWriteLegs_;
const appendTreePlantingLedgerFulfillment_ = globalThis.appendTreePlantingLedgerFulfillment_;
const TPL_POOL_LITERAL = globalThis.TPL_POOL_LITERAL;
const TPL_CUSTOMER_LIABILITY_LITERAL = globalThis.TPL_CUSTOMER_LIABILITY_LITERAL;
const tplResolvePlotContributor_ = globalThis.tplResolvePlotContributor_;
const tplPickPlotImage_ = globalThis.tplPickPlotImage_;
const tplResolvePlotImage_ = globalThis.tplResolvePlotImage_;
const TPL_PLOTS_CONTRIBUTOR_NAME_COL = globalThis.TPL_PLOTS_CONTRIBUTOR_NAME_COL;
const TPL_LINKED_PLOT_ID_COL = globalThis.TPL_LINKED_PLOT_ID_COL;

let pass=0, fail=0;
function t(name, fn){ try{ fn(); pass++; console.log('  ok  '+name); }catch(e){ fail++; console.log('FAIL  '+name+'\n      '+e.message); } }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }

function reset(){ mainSheets={}; managedSheets={}; sourceSheets={}; __mediaResp={ code:200, text: JSON.stringify({ plots:{} }) }; }
function setSource(n,g){ sourceSheets[n]=makeSheet(n,g); }
function setMedia(m){ __mediaResp={ code:200, text: JSON.stringify(m) }; }
function setMediaCode(c){ __mediaResp={ code:c, text:'{}' }; }
function plotsGrid(){ return [['Plot ID','Farm ID','Plot Name','Hectares','Status','Boundary Authority','Plot Type','Owner','Region','Verified At','Media','Notes','Coordinates','Latitude','Longitude','Invalidated By','','Invalidated At','Invalidated Reason','Contributor Name']]; }
function setMain(n,g){ mainSheets[n]=makeSheet(n,g); }
function setManaged(n,g){ managedSheets[n]=makeSheet(n,g); }
function mainRows(){ return mainSheets['offchain transactions'] ? mainSheets['offchain transactions'].getDataRange().getValues() : []; }
function managedRows(){ return managedSheets['Transactions'] ? managedSheets['Transactions'].getDataRange().getValues() : []; }
function poolGrid(farmer, amt){ return [['Date','Desc','Fund Handler','Amount','Currency'],
  ['', '', farmer, amt, TPL_POOL_LITERAL]]; }

console.log('== tplComputeLegs_ (pure) ==');
t('committed / managed: 1 leg, customer liability, category Liability', () => {
  const legs = tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'F1', source:'committed', amount:0.01, qrRoutesToMain:false });
  eq(legs.length, 1, 'legs');
  eq(legs[0].target, 'qr'); eq(legs[0].amount, -1);
  eq(legs[0].literal, TPL_CUSTOMER_LIABILITY_LITERAL); eq(legs[0].category, 'Liability');
});
t('committed / main: 1 leg, category blank (7-col Is Revenue N)', () => {
  const legs = tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'F1', source:'committed', amount:0.01, qrRoutesToMain:true });
  eq(legs.length, 1); eq(legs[0].target, 'main'); eq(legs[0].category, '');
});
t('pool / same-ledger-as-main: 2 legs, NO transfer', () => {
  const legs = tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'F1', source:'pool', amount:5, qrRoutesToMain:true });
  eq(legs.length, 2); eq(legs[0].target,'main'); eq(legs[1].target,'main');
  eq(legs[1].literal, TPL_POOL_LITERAL); eq(legs[1].amount, -1);
  eq(legs.filter(l=>l.kind==='cash').length, 0, 'no cash leg');
});
t('pool / cross-ledger: 4 legs incl. reimbursement transfer', () => {
  const legs = tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'F1', source:'pool', amount:0.01, qrRoutesToMain:false });
  eq(legs.length, 4);
  const cash = legs.filter(l=>l.kind==='cash');
  eq(cash.length, 2);
  eq(cash[0].target,'qr'); eq(cash[0].amount,-0.01); eq(cash[0].literal, globalThis.TPL_TRANSFER_CURRENCY);
  eq(cash[1].target,'main'); eq(cash[1].amount,0.01);
});
t('pool / cross-ledger but amount unbookable (NaN) -> 2 legs, no transfer (fail closed)', () => {
  const legs = tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'F1', source:'pool', amount:'', qrRoutesToMain:false });
  eq(legs.length, 2); eq(legs.filter(l=>l.kind==='cash').length, 0);
});
t('missing contributors -> [] (fail closed)', () => {
  eq(tplComputeLegs_({ customerContributor:'', farmerContributor:'F1', source:'pool', amount:1, qrRoutesToMain:false }).length, 0);
  eq(tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'', source:'pool', amount:1, qrRoutesToMain:false }).length, 0);
});

console.log('== tplResolveSource_ ==');
t('open pool unit (>=1) -> pool', () => {
  reset(); setMain('offchain transactions', poolGrid('F1', 1));
  eq(tplResolveSource_('F1'), 'pool');
});
t('zero balance -> committed', () => {
  reset(); setMain('offchain transactions', poolGrid('F1', 0));
  eq(tplResolveSource_('F1'), 'committed');
});
t('unknown farmer -> committed', () => {
  reset(); setMain('offchain transactions', poolGrid('F1', 3));
  eq(tplResolveSource_('Other'), 'committed');
});
t('missing tab -> committed (never throws)', () => {
  reset();
  eq(tplResolveSource_('F1'), 'committed');
});

console.log('== tplWriteLegs_ ==');
t('partial: main tab missing -> written 0, error NO_MAIN_TAB', () => {
  reset();
  const legs = tplComputeLegs_({ customerContributor:'Gov', farmerContributor:'F1', source:'pool', amount:1, qrRoutesToMain:true });
  const res = tplWriteLegs_(legs, { description:'d', transactionsSpreadsheetUrl:MANAGED_URL });
  eq(res.written, 0); eq(res.error, 'NO_MAIN_TAB');
});

console.log('== appendTreePlantingLedgerFulfillment_ (end to end) ==');
t('pool cross-ledger: books 2 managed + 2 main rows, returns true', () => {
  reset();
  setMain('offchain transactions', poolGrid('F1', 1));
  setManaged('Transactions', [['Date','Desc','Contributor','Amount','Currency','Type']]);
  const ok = appendTreePlantingLedgerFulfillment_(MANAGED_URL, 'msg', 'Gov', 'https://truesight.me/sunmint/bec', 'F1', 0.01);
  eq(ok, true);
  const m = managedRows(), mn = mainRows();
  eq(m.length, 3, 'managed rows');   // header + customer leg + cash leg
  eq(mn.length, 4, 'main rows');     // header + setup pool row + pool leg + cash leg
  eq(m[1][4], TPL_CUSTOMER_LIABILITY_LITERAL); eq(m[1][3], -1);
  eq(m[2][4], globalThis.TPL_TRANSFER_CURRENCY); eq(m[2][3], -0.01);
  eq(mn[2][4], TPL_POOL_LITERAL); eq(mn[2][3], -1);   // the new pool-consumption leg
  eq(mn[3][3], 0.01);                                  // the new reimbursement cash leg
});
t('committed on a main-routed ledger: books 1 main row, returns true', () => {
  reset();
  setMain('offchain transactions', [['Date','Desc','Fund Handler','Amount','Currency','a','b']]);
  const ok = appendTreePlantingLedgerFulfillment_(MAIN_URL, 'msg', 'Gov', 'https://agroverse.shop/agl4', 'F1', 0.01);
  eq(ok, true);
  const mn = mainRows(); eq(mn.length, 2);
  eq(mn[1][2], 'SunMint Tree Planting Contract - agl4');
  eq(mn[1][4], TPL_CUSTOMER_LIABILITY_LITERAL); eq(mn[1][3], -1);
});
t('farmer name falls back to governor when SunMint col J is blank', () => {
  reset();
  setMain('offchain transactions', poolGrid('Gov', 1));
  setManaged('Transactions', [['Date','Desc','Contributor','Amount','Currency','Type']]);
  const ok = appendTreePlantingLedgerFulfillment_(MANAGED_URL, 'msg', 'Gov', 'https://truesight.me/sunmint/bec', '', 0.01);
  eq(ok, true);
  eq(managedRows()[1][4], TPL_CUSTOMER_LIABILITY_LITERAL);
});

console.log('== PR6 tplPickPlotImage_ ==');
t('image preferred over video', () => {
  const mj = { plots: { 'P1': { media: [ {kind:'video',url:'v',thumbnail:'t'}, {kind:'image',url:'img'} ] } } };
  eq(tplPickPlotImage_(mj,'P1'), 'img');
});
t('video thumbnail fallback when no stills', () => {
  const mj = { plots: { 'V-06-29': { media: [ {kind:'video',url:'v',thumbnail:'thumb.jpg'} ] } } };
  eq(tplPickPlotImage_(mj,'V-06-29'), 'thumb.jpg');
});
t('unknown plot -> empty', () => { eq(tplPickPlotImage_({plots:{}}, 'ZZ'), ''); });
t('no media -> empty', () => { eq(tplPickPlotImage_({plots:{'P1':{media:[]}}}, 'P1'), ''); });
t('malformed -> empty (never throws)', () => { eq(tplPickPlotImage_(null, 'P1'), ''); });

console.log('== PR6 tplResolvePlotContributor_ ==');
t('registered contributor name -> resolved', () => {
  reset();
  const g = plotsGrid(); g.push(['FC-P1','fazenda-clara-bahia','', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Fernando Soller Gimenez']);
  setSource(TPL_PLOTS_TAB, g);
  const r = tplResolvePlotContributor_('FC-P1');
  eq(r.contributorName, 'Fernando Soller Gimenez'); eq(r.plotId, 'FC-P1');
});
t('blank contributor name -> null (fail closed)', () => {
  reset();
  const g = plotsGrid(); g.push(['PL-002','fazenda-bom-sucesso']);
  setSource(TPL_PLOTS_TAB, g);
  eq(tplResolvePlotContributor_('PL-002'), null);
});
t('unknown plot -> null', () => {
  reset(); setSource(TPL_PLOTS_TAB, plotsGrid());
  eq(tplResolvePlotContributor_('NOPE'), null);
});
t('missing registry tab -> null (never throws)', () => {
  reset(); eq(tplResolvePlotContributor_('FC-P1'), null);
});
t('empty plot id -> null', () => { eq(tplResolvePlotContributor_(''), null); });

console.log('== PR6 tplResolvePlotImage_ ==');
t('fetch 200 -> picks image url', () => {
  setMedia({ plots: { 'FC-P1': { media: [ {kind:'image',url:'https://x/a.jpg'} ] } } });
  eq(tplResolvePlotImage_('FC-P1'), 'https://x/a.jpg');
});
t('fetch non-200 -> empty (fail closed)', () => {
  setMediaCode(500); eq(tplResolvePlotImage_('FC-P1'), '');
});

console.log('== PR6 constants ==');
t('Linked Plot ID is column AC (index 28)', () => { eq(TPL_LINKED_PLOT_ID_COL, 28); });
t('plot contributor name is column T (index 19)', () => { eq(TPL_PLOTS_CONTRIBUTOR_NAME_COL, 19); });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
