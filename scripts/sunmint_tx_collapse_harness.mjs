import fs from 'fs';

// argv: [sunmintSrc]
const src = fs.readFileSync(process.argv[2], 'utf8');

// ---- minimal GAS stubs -----------------------------------------------------
const SHEET_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
let grid = [];
function makeSheet(name, data) {
  grid = data ? data.map(r => r.slice()) : [];
  return {
    getName(){return name;},
    getLastRow(){return grid.length;},
    getLastColumn(){return grid.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){return {getValues(){return grid.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){
      return {
        getValues(){const out=[];for(let i=0;i<nr;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nc));}return out;},
        setValues(v){for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}},
        setValue(v){grid[r-1]=grid[r-1]||[];grid[r-1][c-1]=v;}
      };
    },
    appendRow(a){ grid.push(a.slice()); },
    deleteRow(r){ grid.splice(r-1,1); },
    insertSheet(){ return this; }
  };
}
const sheets = {};
globalThis.SpreadsheetApp = {
  openById(id){
    if (id !== SHEET_ID) throw new Error('unexpected spreadsheet id: '+id);
    return { getSheetByName(n){ return sheets[n] || null; }, insertSheet(n){ sheets[n]=makeSheet(n); return sheets[n]; } };
  }
};
const props = { SHEET_ID: SHEET_ID, GITHUB_API_TOKEN: '', GOVERNOR_READ_KEY: 'gk' };
globalThis.PropertiesService = { getScriptProperties(){ return { getProperty(k){ return props[k] || null; }, setProperty(k,v){ props[k]=v; }, deleteProperty(k){ delete props[k]; } }; } };
globalThis.LockService = { getScriptLock(){ return { tryLock(){return true;}, releaseLock(){} }; } };
globalThis.Logger = { log(){} };
globalThis.Utilities = { DigestAlgorithm:{SHA_256:'SHA_256'}, base64Decode(s){return Array.from(Buffer.from(String(s),'base64'));}, computeDigest(){return [];}, base64EncodeWebSafe(){return '';} };
globalThis.UrlFetchApp = { fetch(){ return { getResponseCode(){return 200;}, getContentText(){return '{}';} }; } };
globalThis.ContentService = { MimeType:{JSON:'application/json'}, createTextOutput(s){ return { setMimeType(){ return this; }, getContent(){ return s; }, _s:s }; } };
globalThis.ScriptApp = { getProjectTriggers(){ return []; }, newTrigger(){ return { timeBased(){ return { everyHours(){ return { create(){} }; } }; } }; } };
// ---------------------------------------------------------------------------

// argv[3] = the sibling Credentials.js (defines setApiKeys/getCredentials)
const credSrc = fs.readFileSync(process.argv[3], 'utf8');
(0, eval)(credSrc);  // Credentials.js
(0, eval)(src);      // the scanner under test

let pass=0, fail=0;
function t(name, fn){ try{ fn(); pass++; console.log('  ok  '+name); }catch(e){ fail++; console.log('FAIL  '+name+'\n      '+e.message); } }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }

function reset(){ for (const k in sheets) delete sheets[k]; }
function setTab(name, data){ sheets[name]=makeSheet(name, data); grid = sheets[name].getDataRange().getValues(); return sheets[name]; }

// Header mirroring the LIVE SunMint Tree Planting tab (A..W).
const H = ['Telegram Update ID','Telegram Chatroom ID','Telegram Chatroom Name','Telegram Message ID',
  'Contributor Name','Contribution Made','Status date','Telegram File IDs','Photo of Tree Planted',
  'Submitted Name','Latitude','Longitude','Status','Specie','GitHub Commit URL','Cost of Tree',
  'Tree Planting Time','Linked QR Code','Linked At','Plot ID','Submission Source',
  'request_transaction_id','my digital signature'];
const TXI = H.indexOf('request_transaction_id');
const QI  = H.indexOf('Linked QR Code');
function row(upd, status, tx, qr, at){
  const r = H.map(()=> '');
  r[0]=upd; r[12]=status; r[TXI]=tx; r[QI]=qr||''; r[18]=at||'';
  return r;
}

t('plain txid dedup: keeps FIRST, deletes later dups, no links -> no grafts', ()=>{
  reset();
  setTab('SunMint Tree Planting', [H,
    row('U1','RECORDED','TX_A'), row('U2','RECORDED','TX_A'),
    row('U3','RECORDED','TX_A'), row('U4','RECORDED','TX_B')]);
  const r = collapseSunMintTreeTxDuplicates();
  eq(r.dryRun,false); eq(r.collapsed,2); eq(r.distinctTxIds,2); eq(r.grafted,0); eq(r.linkedProtected,0);
  const rows = sheets['SunMint Tree Planting'].getDataRange().getValues().slice(1);
  eq(rows.length,2); eq(rows[0][0],'U1'); eq(rows[1][0],'U4');
});

t('un-txid\'d rows are NEVER collapsed (blank txid)', ()=>{
  reset();
  setTab('SunMint Tree Planting', [H, row('U1','RECORDED',''), row('U2','RECORDED',''), row('U3','RECORDED','TX_A')]);
  const r = collapseSunMintTreeTxDuplicates();
  eq(r.collapsed,0); eq(r.untxRow,2);
  eq(sheets['SunMint Tree Planting'].getDataRange().getValues().slice(1).length,3);
});

t('LINK SURVIVES: dup carries QR, survivor does not -> graft onto survivor then delete', ()=>{
  reset();
  setTab('SunMint Tree Planting', [H,
    row('U1','INVALID','TX_A'),                 // survivor, unlinked
    row('U2','LINKED','TX_A','2024PAULO_20250804_20','2026-09-20T00:00:00Z')]); // dup, linked
  const r = collapseSunMintTreeTxDuplicates();
  eq(r.collapsed,1); eq(r.grafted,1); eq(r.linkedProtected,1);
  const rows = sheets['SunMint Tree Planting'].getDataRange().getValues().slice(1);
  eq(rows.length,1);
  eq(rows[0][QI], '2024PAULO_20250804_20');   // QR grafted to survivor
  eq(rows[0][12], 'LINKED');                  // status follows the link (self-consistent)
  eq(rows[0][0], 'U1');                       // the FIRST occurrence survives
});

t('BOTH rows carry a link -> ambiguous, keep BOTH (never silently drop a linkage)', ()=>{
  reset();
  setTab('SunMint Tree Planting', [H,
    row('U1','LINKED','TX_A','QR_1','t'), row('U2','LINKED','TX_A','QR_2','t')]);
  const r = collapseSunMintTreeTxDuplicates();
  eq(r.collapsed,0); eq(r.linkedProtected,1);
  eq(sheets['SunMint Tree Planting'].getDataRange().getValues().slice(1).length,2);
});

t('dryRun grafts NOTHING and deletes NOTHING (preview is read-only)', ()=>{
  reset();
  setTab('SunMint Tree Planting', [H,
    row('U1','INVALID','TX_A'), row('U2','LINKED','TX_A','QR_X','t')]);
  const r = collapseSunMintTreeTxDuplicates(true);
  eq(r.dryRun,true); eq(r.collapsed,1); eq(r.grafted,1);
  const rows = sheets['SunMint Tree Planting'].getDataRange().getValues().slice(1);
  eq(rows.length,2);                          // untouched
  eq(rows[0][QI],'');                         // no graft on dryRun
});

t('missing tab fails closed (no throw)', ()=>{
  reset();
  const r = collapseSunMintTreeTxDuplicates();
  eq(r.success,false);
});

t('counts only -- no txid strings or PII leak in the result object', ()=>{
  reset();
  setTab('SunMint Tree Planting', [H, row('U1','RECORDED','SECRET_TX'), row('U2','RECORDED','SECRET_TX')]);
  const r = collapseSunMintTreeTxDuplicates();
  const blob = JSON.stringify(r);
  eq(blob.indexOf('SECRET_TX'), -1, 'txid must not appear in output');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
