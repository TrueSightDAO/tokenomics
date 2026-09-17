import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');

// ---- minimal GAS stubs -----------------------------------------------------
// Two distinct workbooks: the PUBLIC intake (Telegram Chat Logs) and the PRIVATE
// `cfr program` sheet. The harness records every write so a test can prove the
// public intake is never written to.
let intakeWrites = 0;
function makeSheet(name, data) {
  let grid = data ? data.map(r => r.slice()) : [];
  return {
    _name: name, _grid: grid,
    getName(){return name;},
    getLastRow(){return grid.length;},
    getLastColumn(){return grid.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){return {getValues(){return grid.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){return {getValues(){const out=[];for(let i=0;i<nr;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nc));}return out;},setValues(v){for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}}};},
    appendRow(a){ grid.push(a.slice()); },
    insertSheet(){ return this; }
  };
}
let tcGrid = [];
let cfrSheets = {};               // name -> sheet (the private cfr program workbook)
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
globalThis.ScriptApp = { getProjectTriggers(){return [{getHandlerFunction(){return 'processPayoutRegistrationsFromTelegramChatLogs';}}];}, newTrigger(){return {timeBased(){return {everyHours(){return {create(){}};}};}};} };
globalThis.Logger = { log(){} };
globalThis.Utilities = {};
// ---------------------------------------------------------------------------

(0, eval)(src);  // indirect eval -> global scope

let pass=0, fail=0;
function t(name, fn){ try{ fn(); pass++; console.log('  ok  '+name); }catch(e){ fail++; console.log('FAIL  '+name+'\n      '+e.message); } }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }

// ---- parse + tag -----------------------------------------------------------
// The page's redacted-summary shape: pk_hash + PIX key (here RAW, to prove the
// private sheet keeps it plaintext while the mask is display-safe).
const payload = [
  '[PAYOUT REGISTRATION]',
  '- Planting identity (pk_hash): pk-abcdefghijkl',
  '- Program: crf-anapu',
  '- PIX key type: CPF',
  '- PIX key: 111.444.777-35',
  '- Submission Source: https://cfr.truesight.me/payout_registration.html',
  '--------'
].join('\n');
t('isPayoutRegistrationEvent_ true on tag-first', ()=>eq(isPayoutRegistrationEvent_(payload),true));
t('isPayoutRegistrationEvent_ false when tag only mentioned', ()=>eq(isPayoutRegistrationEvent_('Some event\n[PAYOUT REGISTRATION] mentioned'),false));
t('parse extracts + aliases fields', ()=>{
  const f=parsePayoutRegistrationEventText_(payload);
  eq(f.pk_hash,'pk-abcdefghijkl'); eq(f.program_slug,'crf-anapu');
  eq(f.pix_key_type,'CPF'); eq(f.pix_key,'111.444.777-35');
  eq(f.submission_source,'https://cfr.truesight.me/payout_registration.html');
});

// ---- mask derivation (the display-safe echo) -------------------------------
t('mask: CPF hides all but last 2', ()=>eq(payoutRegMaskKey_('111.444.777-35','CPF'),'***.***.***-35'));
t('mask: raw digits CPF', ()=>eq(payoutRegMaskKey_('11144477735','CPF'),'***.***.***-35'));
t('mask: email', ()=>eq(payoutRegMaskKey_('maria@example.com','EMAIL'),'m***@example.com'));
t('mask: never returns the raw key', ()=>{ if(payoutRegMaskKey_('111.444.777-35','CPF').includes('111.444')) throw new Error('mask leaked raw'); });

// ---- end-to-end ------------------------------------------------------------
function reset(){ tcGrid=[]; cfrSheets={}; intakeWrites=0; }
function payoutRows(){ const s=cfrSheets['payout registrations']; return s ? s.getDataRange().getValues() : []; }

reset();
tcGrid = [['A','B','C','D','E','F','G'],['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload]];
t('e2e records one row', ()=>{ const r=processPayoutRegistrationsFromTelegramChatLogs(); eq(r.success,true); eq(r.recorded,1); });
t('e2e creates all four SS11.3 tabs', ()=>{
  ['payout registrations','tree planting','tree monitoring','plot registrations'].forEach(n=>{ if(!cfrSheets[n]) throw new Error('missing tab '+n); });
});

// ---- THE FLIPPED INVARIANT: raw PII allowed, but ONLY in the private sheet --
t('e2e RAW PIX is persisted in the PRIVATE sheet', ()=>{
  const all = payoutRows().flat().join('|');
  if(!all.includes('111.444.777-35')) throw new Error('raw PIX not persisted in private sheet');
});
t('e2e PUBLIC intake is never written to', ()=>{ eq(intakeWrites,0,'intake writes'); });
t('e2e masked echo is derived and display-safe', ()=>{
  const rows = payoutRows();
  const header = rows[0];
  const mi = header.indexOf('pix_key_masked');
  const vals = rows.slice(1).map(r=>String(r[mi]));
  if(!vals.includes('***.***.***-35')) throw new Error('mask column missing/derived wrong: '+JSON.stringify(vals));
});
t('e2e NO cipher column exists (SS11.2 dropped it)', ()=>{
  const header = payoutRows()[0];
  if(header.indexOf('pix_key_cipher') >= 0) throw new Error('pix_key_cipher must be gone');
});

reset();
tcGrid = [['A','B','C','D','E','F','G'],['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload],['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload]];
t('e2e DEDUP: same update id processed once', ()=>{ const r=processPayoutRegistrationsFromTelegramChatLogs(); eq(r.recorded,1); });

reset();
tcGrid = [['A','B','C','D','E','F','G'],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload.replace('111.444.777-35','222.555.888-44')],
  ['Edgar_2','-','EDGAR','msg2','Edgar','',''+payload.replace('111.444.777-35','333.666.999-55')]];
t('e2e UPSERT: same pk_hash supersedes (2 updates, 1 row linked)', ()=>{
  const r=processPayoutRegistrationsFromTelegramChatLogs();
  eq(r.recorded,1); eq(r.updated,1);
});

reset();
const noHash = payload.replace('- Planting identity (pk_hash): pk-abcdefghijkl\n','');
tcGrid = [['A','B','C','D','E','F','G'],['Edgar_1','-','EDGAR','msg1','Edgar','',''+noHash]];
t('e2e REFUSES when pk_hash absent (nothing to pay)', ()=>{
  const r=processPayoutRegistrationsFromTelegramChatLogs();
  eq(r.rejected,1);
  const all = payoutRows().flat().join('|');
  if(!all.includes('REJECTED_MISSING_PK_HASH')) throw new Error('missing refusal status');
});

// ---- read endpoint must NOT leak the raw key -------------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'],['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload]];
processPayoutRegistrationsFromTelegramChatLogs();
t('read endpoint omits the plaintext pix_key', ()=>{
  const out = getPendingPayoutRegistrations('ALL');
  const s = JSON.stringify(out);
  if(s.includes('111.444.777-35')) throw new Error('read endpoint leaked raw PIX!');
  eq(out.data.items[0].pix_key_masked,'***.***.***-35');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
