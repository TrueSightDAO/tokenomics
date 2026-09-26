import fs from 'fs';
import crypto from 'crypto';

// argv: [payoutScannerSrc, cfrSubSrc]
const payoutSrc = fs.readFileSync(process.argv[2], 'utf8');
const cfrSubSrc = fs.readFileSync(process.argv[3], 'utf8');

// ---- minimal GAS stubs -----------------------------------------------------
let intakeWrites = 0;
function makeSheet(name, data) {
  let grid = data ? data.map(r => r.slice()) : [];
  return {
    _name: name, _grid: grid,
    getName(){return name;},
    getLastRow(){return grid.length;},
    getLastColumn(){return grid.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){return {getValues(){return grid.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){return {getValues(){const out=[];for(let i=0;i<nr;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nc));}return out;},setValues(v){for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}},setValue(v){grid[r-1]=grid[r-1]||[];grid[r-1][c-1]=v;}};},
    appendRow(a){ grid.push(a.slice()); },
    insertSheet(){ return this; }
  };
}
let tcGrid = [];
let cfrSheets = {};
const INTAKE_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const CFR_ID = 'CFR_PRIVATE_SHEET_ID';
globalThis.SpreadsheetApp = {
  openById(id){
    if (id === INTAKE_ID) {
      return { getSheetByName(n){ return n==='Telegram Chat Logs' ? makeSheet(n, tcGrid) : null; },
               insertSheet(n){ intakeWrites++; return makeSheet(n); } };
    }
    if (id === CFR_ID) {
      return { getSheetByName(n){ return cfrSheets[n] || null; },
               insertSheet(n){ cfrSheets[n] = makeSheet(n); return cfrSheets[n]; } };
    }
    throw new Error('unexpected spreadsheet id: '+id);
  }
};
globalThis.PropertiesService = { getScriptProperties(){ return { getProperty(k){ return k==='CFR_PROGRAM_SPREADSHEET_ID' ? CFR_ID : null; } }; } };
globalThis.LockService = { getScriptLock(){ return { tryLock(){return true;}, releaseLock(){} }; } };
globalThis.ScriptApp = {
  getProjectTriggers(){ return [
    {getHandlerFunction(){return 'processPayoutRegistrationsFromTelegramChatLogs';}},
    {getHandlerFunction(){return 'processCfrProgramSubmissionsFromTelegramChatLogs';}}
  ]; },
  newTrigger(){return {timeBased(){return {everyHours(){return {create(){}};}};}};}
};
globalThis.Logger = { log(){} };
globalThis.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  base64Decode(s){ return Array.from(Buffer.from(String(s), 'base64')); },
  computeDigest(_algo, bytes){ return Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest()); },
  base64EncodeWebSafe(bytes){ return Buffer.from(bytes).toString('base64url'); }
};
// ---------------------------------------------------------------------------

(0, eval)(payoutSrc);   // shared helpers + PAYOUT_REG_TABS
(0, eval)(cfrSubSrc);   // the scanner under test

let pass=0, fail=0;
function t(name, fn){ try{ fn(); pass++; console.log('  ok  '+name); }catch(e){ fail++; console.log('FAIL  '+name+'\n      '+e.message); } }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }
function ok(v,m){ if(!v) throw new Error(m||'expected truthy'); }

function reset(){ tcGrid=[]; cfrSheets={}; intakeWrites=0; }
function tab(name){ const s=cfrSheets[name]; return s ? s.getDataRange().getValues() : []; }
function rows(name){ const v=tab(name); return v.length>1 ? v.slice(1) : []; }

// A real base64 SPKI-looking blob isn't needed for parse tests; pk-hash just needs
// deterministic base64 input.
const SIG = Buffer.from('fake-public-key-bytes-for-hashing').toString('base64');

const treePayload = [
  '[TREE PLANTING EVENT]',
  '- Latitude: -3.5229189',
  '- Longitude: -51.5749705',
  '- Species: Cacao - Forestero',
  '- Planting Time: 2026-09-24T13:28:47.742Z',
  '- Photo URL: https://github.com/TrueSightDAO/sunmint/tree/main/images/20260924102847_MIIBIjANBgkqhkiG9w0B.jpg',
  '- Submission Source: https://cfr.truesight.me/',
  '--------',
  '',
  'My Digital Signature: '+SIG,
  '',
  'Request Transaction ID: ABC123'
].join('\n');

const monPayload = [
  '[TREE GROWTH MONITORING EVENT]',
  '- Tree ID: Edgar_20260924132231_092',
  '- Species: Cacao',
  '- DBH (cm): 12.5',
  '- Latitude: -3.5229189',
  '- Longitude: -51.5749705',
  '- Measurement Time: 2026-09-24T13:30:00.000Z',
  '- Close-up Photo URL: https://github.com/TrueSightDAO/sunmint/tree/main/images/growth/20260924103000_closeup.jpg',
  '- Submission Source: https://cfr.truesight.me/monitor-tree-growth/?tree=Edgar_20260924132231_092',
  '--------',
  '',
  'My Digital Signature: '+SIG
].join('\n');

const plotPayload = [
  '[FARM BOUNDARY EVIDENCE EVENT]',
  '- Farm Name: Sítio CFR Teste',
  '- Plot ID: N-06-99',
  '- Boundary Type: approx',
  '- Plot Type: restoration',
  '- Media URLs: https://raw.githubusercontent.com/TrueSightDAO/sunmint/main/images/boundaries/x.jpg',
  '- Captured At: 2026-09-24T10:00:00-03:00',
  '- Extracted GPS: {"points": [[-51.1,-3.5],[-51.2,-3.6]]}',
  '- Submission Source: https://cfr.truesight.me/',
  '--------',
  '',
  'My Digital Signature: '+SIG
].join('\n');

function tcRow(updateId, body, messageId){ return [updateId,'-100','EDGAR',(messageId===undefined?'171':messageId),'Edgar','',body]; }

// ---- tag / host / parse ----------------------------------------------------
t('cfrSubTag_ extracts bracketed tag', ()=>eq(cfrSubTag_(treePayload), '[TREE PLANTING EVENT]'));
t('cfrSubOriginHost_ parses host', ()=>eq(cfrSubOriginHost_('https://cfr.truesight.me/x'), 'cfr.truesight.me'));
t('cfrSubOriginHost_ strips port', ()=>eq(cfrSubOriginHost_('http://cfr.truesight.me:443/x'), 'cfr.truesight.me'));
t('parse extracts tree fields', ()=>{
  const f=cfrSubParseFields_(treePayload);
  eq(f.latitude,'-3.5229189'); eq(f.species,'Cacao - Forestero');
  eq(f.submission_source,'https://cfr.truesight.me/');
});
t('parse folds Measurement Time -> measured_at', ()=>{
  const f=cfrSubParseFields_(monPayload); eq(f.measured_at,'2026-09-24T13:30:00.000Z');
});
t('parse folds Close-up Photo URL -> photo_url', ()=>{
  const f=cfrSubParseFields_(monPayload);
  ok(String(f.photo_url).includes('_closeup.jpg'), 'closeup not folded');
});
t('parse folds Plot ID -> plot_ref', ()=>{
  const f=cfrSubParseFields_(plotPayload); eq(f.plot_ref,'N-06-99');
});
t('parse folds Extracted GPS -> geometry_ref', ()=>{
  const f=cfrSubParseFields_(plotPayload); ok(String(f.geometry_ref).includes('points'));
});
t('pk-hash is derived from the signature (pk- prefix, 12 chars)', ()=>{
  const h = cfrSubDerivePkHash_(SIG); ok(/^pk-.{12}$/.test(h), 'bad pk-hash: '+h);
});
t('pk-hash empty on blank signature', ()=>eq(cfrSubDerivePkHash_(''), ''));

// ---- e2e: three tabs get one row each --------------------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'],
  tcRow('Edgar_T1', treePayload),
  tcRow('Edgar_M1', monPayload),
  tcRow('Edgar_P1', plotPayload)];
t('e2e records 3 (one per family)', ()=>{
  const r = processCfrProgramSubmissionsFromTelegramChatLogs();
  eq(r.success, true); eq(r.recorded, 3);
});
t('e2e writes tree planting row', ()=>{
  const r = rows('tree planting'); eq(r.length, 1);
  const h = tab('tree planting')[0];
  eq(r[0][h.indexOf('species')], 'Cacao - Forestero');
  eq(r[0][h.indexOf('capture_source')], 'https://cfr.truesight.me/');
  ok(/^pk-/.test(String(r[0][h.indexOf('pk_hash')])), 'pk_hash missing');
});
t('e2e writes tree monitoring row', ()=>{
  const r = rows('tree monitoring'); eq(r.length, 1);
  const h = tab('tree monitoring')[0];
  eq(r[0][h.indexOf('dbh_cm')], '12.5');
  eq(r[0][h.indexOf('tree_id_qr')], 'Edgar_20260924132231_092');
});
t('e2e writes plot registrations row', ()=>{
  const r = rows('plot registrations'); eq(r.length, 1);
  const h = tab('plot registrations')[0];
  eq(r[0][h.indexOf('plot_ref')], 'N-06-99');
});
t('e2e PUBLIC intake is never written to', ()=>eq(intakeWrites, 0, 'intake writes'));

// ---- attribution gate: non-CFR origin is skipped ---------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'],
  tcRow('Edgar_S1', treePayload.replace('https://cfr.truesight.me/','https://sunmint.truesight.me/'))];
t('e2e non-CFR origin skipped (not mirrored)', ()=>{
  const r = processCfrProgramSubmissionsFromTelegramChatLogs();
  eq(r.recorded, 0); eq(r.skipped, 1); eq(rows('tree planting').length, 0);
});

// ---- dedup: same update id processed once ----------------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'], tcRow('Edgar_T1', treePayload), tcRow('Edgar_T1', treePayload)];
t('e2e DEDUP: same update id processed once', ()=>{
  const r = processCfrProgramSubmissionsFromTelegramChatLogs(); eq(r.recorded, 1);
});

// ---- idempotency across two fires ------------------------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'], tcRow('Edgar_T1', treePayload)];
processCfrProgramSubmissionsFromTelegramChatLogs();
t('e2e IDEMPOTENT across two fires', ()=>{
  const r = processCfrProgramSubmissionsFromTelegramChatLogs();
  eq(r.recorded, 0); eq(rows('tree planting').length, 1);
});

// ---- a non-CFR-family event is ignored entirely ----------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'],
  tcRow('Edgar_SALE', '[SALES EVENT]\n- Item: x\n- Submission Source: https://cfr.truesight.me/')];
t('e2e unrelated event is not mirrored', ()=>{
  const r = processCfrProgramSubmissionsFromTelegramChatLogs();
  eq(r.recorded, 0); eq(rows('tree planting').length, 0);
});

// ---- canonical tree id: intake col D, not the +1 col A (Gary thread 35944) ------
t('cfrSubCanonicalTreeId_: prefers col D over col A when both are Edgar_', ()=>
  eq(cfrSubCanonicalTreeId_('Edgar_20260924132440_104','Edgar_20260924132440_103'),'Edgar_20260924132440_103'));
t('cfrSubCanonicalTreeId_: falls back to col A when col D is not Edgar_', ()=>
  eq(cfrSubCanonicalTreeId_('Edgar_A_003','171'),'Edgar_A_003'));
t('cfrSubCanonicalTreeId_: legacy numeric rows keep col A', ()=>
  eq(cfrSubCanonicalTreeId_('469027268','171'),'469027268'));
t('cfrSubCanonicalTreeId_: blank both -> empty', ()=>eq(cfrSubCanonicalTreeId_('',''),''));

reset();
tcGrid=[['A','B','C','D','E','F','G'],
  tcRow('Edgar_20260924132440_104', treePayload, 'Edgar_20260924132440_103')];
t('e2e tree_id stored as the CANONICAL col D id (off-by-one fixed)', ()=>{
  processCfrProgramSubmissionsFromTelegramChatLogs();
  const h=tab('tree planting')[0];
  eq(rows('tree planting')[0][h.indexOf('tree_id')], 'Edgar_20260924132440_103');
});

// ---- backfill rewrites a legacy (col A) tree_id to the canonical col D id -------
reset();
tcGrid=[['A','B','C','D','E','F','G'],
  tcRow('Edgar_20260924132440_104', treePayload, 'Edgar_20260924132440_103')];
cfrSheets['tree planting']=makeSheet('tree planting',[
  ['created_at_utc','telegram_update_id','pk_hash','tree_id','species','lat','lng','photo_url','capture_source','status'],
  ['2026-09-24T00:00:00Z','Edgar_20260924132440_104','pk-x000000000000','Edgar_20260924132440_104','Cacao','-3.5','-51.5','http://x/o.jpg','https://cfr.truesight.me/','RECORDED']]);
t('backfill rewrites a legacy tree_id to the canonical col D id', ()=>{
  const r = backfillCfrTreeIds();
  eq(r.success, true); eq(r.changed, 1);
  const h=tab('tree planting')[0];
  eq(rows('tree planting')[0][h.indexOf('tree_id')], 'Edgar_20260924132440_103');
});
t('backfill is idempotent (second run changes nothing)', ()=>{
  eq(backfillCfrTreeIds().changed, 0);
});


// ---- transaction-level dedup (Gary thread 35944) --------------------------------
t('cfrSubTreeTxKey_ trims the txid; blanks on empty', ()=>{
  eq(cfrSubTreeTxKey_('  ABC123 '), 'ABC123');
  eq(cfrSubTreeTxKey_(''), '');
  eq(cfrSubTreeTxKey_(undefined), '');
});

// THE FIX: the same txid re-posted under a NEW update id was double-counted; now once.
reset();
tcGrid=[['A','B','C','D','E','F','G'],
  tcRow('Edgar_TX1', treePayload),
  tcRow('Edgar_TX2', treePayload)];
t('e2e TXDEDUP: same txid under a NEW update id records ONCE', ()=>{
  const r = processCfrProgramSubmissionsFromTelegramChatLogs();
  eq(r.recorded, 1); eq(rows('tree planting').length, 1);
});

// distinct txids are distinct trees -> two rows
reset();
tcGrid=[['A','B','C','D','E','F','G'],
  tcRow('Edgar_TX3', treePayload),
  tcRow('Edgar_TX4', treePayload.replace('ABC123','XYZ789'))];
t('e2e distinct txids record TWO rows', ()=>{
  eq(processCfrProgramSubmissionsFromTelegramChatLogs().recorded, 2);
});

// the txid is STORED on the row (so future fires can dedupe on it)
reset();
tcGrid=[['A','B','C','D','E','F','G'], tcRow('Edgar_TX5', treePayload)];
t('e2e tree row stores request_transaction_id', ()=>{
  processCfrProgramSubmissionsFromTelegramChatLogs();
  const h=tab('tree planting')[0];
  eq(rows('tree planting')[0][h.indexOf('request_transaction_id')], 'ABC123');
});

// a blank txid (older rows) must still dedup on the update id
reset();
const noTx = treePayload.replace('\n\nRequest Transaction ID: ABC123','');
tcGrid=[['A','B','C','D','E','F','G'], tcRow('Edgar_TXB', noTx), tcRow('Edgar_TXB', noTx)];
t('e2e blank txid still dedups on the update id', ()=>{
  eq(processCfrProgramSubmissionsFromTelegramChatLogs().recorded, 1);
});

// ---- backfillCfrTreeTxIds populates legacy rows + is idempotent ----------------
reset();
tcGrid=[['A','B','C','D','E','F','G'], tcRow('Edgar_TX6', treePayload)];
cfrSheets['tree planting']=makeSheet('tree planting',[
  ['created_at_utc','telegram_update_id','pk_hash','tree_id','species','lat','lng','photo_url','capture_source','status','request_transaction_id'],
  ['2026-09-24T00:00:00Z','Edgar_TX6','pk-x000000000000','Edgar_TX6','Cacao','-3.5','-51.5','http://x/o.jpg','https://cfr.truesight.me/','RECORDED','']]);
t('backfillCfrTreeTxIds populates the txid from the intake message', ()=>{
  const r = backfillCfrTreeTxIds();
  eq(r.success, true); eq(r.changed, 1);
  const h=tab('tree planting')[0];
  eq(rows('tree planting')[0][h.indexOf('request_transaction_id')], 'ABC123');
});
t('backfillCfrTreeTxIds is idempotent (second run changes nothing)', ()=>{
  eq(backfillCfrTreeTxIds().changed, 0);
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
