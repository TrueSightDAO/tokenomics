import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');

// ---- minimal GAS stubs -----------------------------------------------------
const rows = [];
function makeSheet(name, data) {
  let grid = data ? data.map(r => r.slice()) : [];
  return {
    _name: name,
    getName(){return name;},
    getLastRow(){return grid.length;},
    getLastColumn(){return grid.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){return {getValues(){return grid.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){return {getValues(){const out=[];for(let i=0;i<nr;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nc));}return out;},setValues(v){for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}}};},
    appendRow(a){grid.push(a.slice());},
    insertSheet(){return this;}
  };
}
let tcGrid = [], prSheet = null;
globalThis.SpreadsheetApp = {
  openById(){ return {
    getSheetByName(n){ if(n==='Telegram Chat Logs') return makeSheet(n, tcGrid);
      if(n==='Payout Registrations') return prSheet; return null; },
    insertSheet(n){ prSheet = makeSheet(n); return prSheet; }
  }; }
};
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
const payload = [
  '[PAYOUT REGISTRATION]',
  '- Student Name: Maria Silva',
  '- Student Email: Maria@Example.com',
  '- Program: crf-anapu',
  '- PIX Key Type: CPF',
  '- PIX Key Masked: ***.***.***-35',
  '- PIX Key Cipher: ' + 'QWxr'.repeat(30),
  '- Account Holder: Maria Silva',
  '- Relationship: self',
  '- Submission Source: https://cfr.truesight.me/payout_registration.html',
  '--------'
].join('\n');
t('isPayoutRegistrationEvent_ true on tag-first', ()=>eq(isPayoutRegistrationEvent_(payload),true));
t('isPayoutRegistrationEvent_ false when tag only mentioned', ()=>eq(isPayoutRegistrationEvent_('Some event\n[PAYOUT REGISTRATION] mentioned'),false));
t('parse extracts fields', ()=>{ const f=parsePayoutRegistrationEventText_(payload); eq(f.student_name,'Maria Silva'); eq(f.student_email,'Maria@Example.com'); eq(f.pix_key_type,'CPF'); eq(f.pix_key_masked,'***.***.***-35'); eq(f.pix_key_cipher && f.pix_key_cipher.length>=32, true); });

// ---- the privacy guard (the security-critical bit) -------------------------
t('mask guard: real mask ok', ()=>eq(payoutRegIsSafeMaskValue_('***.***.***-35'), true));
t('mask guard: raw CPF REFUSED', ()=>eq(payoutRegIsSafeMaskValue_('111.444.777-35'), false));
t('mask guard: raw CPF digits REFUSED', ()=>eq(payoutRegIsSafeMaskValue_('11144477735'), false));
t('mask guard: email mask ok', ()=>eq(payoutRegIsSafeMaskValue_('m***@example.com'), true));
t('mask guard: empty ok', ()=>eq(payoutRegIsSafeMaskValue_(''), true));
t('mask guard: placeholder ok', ()=>eq(payoutRegIsSafeMaskValue_('(none - guardian bank transfer)'), true));
t('cipher guard: long blob ok', ()=>eq(payoutRegIsSafeCipherValue_('A'.repeat(120)), true));
t('cipher guard: empty ok (no-key)', ()=>eq(payoutRegIsSafeCipherValue_(''), true));
t('cipher guard: short REFUSED', ()=>eq(payoutRegIsSafeCipherValue_('abc'), false));
t('cipher guard: raw key REFUSED', ()=>eq(payoutRegIsSafeCipherValue_('111.444.777-35'), false));
t('cipher guard: raw email REFUSED', ()=>eq(payoutRegIsSafeCipherValue_('maria@example.com'), false));

// ---- end-to-end: record, dedup, upsert, unsafe-refusal ---------------------
function reset(){ tcGrid=[]; prSheet=null; }
reset();
tcGrid = [
  ['created_at_utc','B','C','D','E','F','G'],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload],                    // row 2 -> record
  ['Edgar_2','-','EDGAR','msg2','Edgar','',''+payload.replace('***.***.***-35','***.***.***-35')], // row 3 -> same update? no, different update id, same pk none
];
t('e2e records one row', ()=>{ const r=processPayoutRegistrationsFromTelegramChatLogs(); eq(r.success,true); eq(r.recorded,2); });
t('e2e tab created with headers', ()=>eq(prSheet.getRange(1,1,1,1).getValues()[0][0],'created_at_utc'));

reset();
tcGrid = [
  ['A','B','C','D','E','F','G'],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload],   // duplicate update id
];
t('e2e DEDUP: same update id processed once', ()=>{ const r=processPayoutRegistrationsFromTelegramChatLogs(); eq(r.recorded,1); });

reset();
const withHash = payload.replace('- Relationship: self','- Relationship: self\n- PK Hash: abc123');
tcGrid = [
  ['A','B','C','D','E','F','G'],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+withHash],
  ['Edgar_2','-','EDGAR','msg2','Edgar','',''+withHash.replace('***.***.***-35','***.***.***-99')],
];
t('e2e UPSERT: same pk_hash supersedes', ()=>{ const r=processPayoutRegistrationsFromTelegramChatLogs(); eq(r.recorded,1); eq(r.updated,1); });

reset();
const unsafe = payload.replace('- PIX Key Masked: ***.***.***-35','- PIX Key: 111.444.777-35');
tcGrid = [
  ['A','B','C','D','E','F','G'],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+unsafe],
];
t('e2e REFUSES raw key and stores no PII', ()=>{
  const r=processPayoutRegistrationsFromTelegramChatLogs();
  eq(r.rejected,1);
  const all = prSheet.getDataRange().getValues().flat().join('|');
  if(all.includes('111.444.777-35')) throw new Error('RAW PII persisted!');
  if(!all.includes('REJECTED_UNSAFE_KEY')) throw new Error('missing refusal status');
});

// ---- read endpoint must NOT leak the key value -----------------------------
reset();
tcGrid = [['A','B','C','D','E','F','G'],['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload]];
processPayoutRegistrationsFromTelegramChatLogs();
t('read endpoint omits pix_key_value', ()=>{
  const out = getPendingPayoutRegistrations('ALL');
  const s = JSON.stringify(out);
  if(s.includes('pix_key_value')) throw new Error('read endpoint exposes pix_key_value!');
  if(s.includes('CCCC')) throw new Error('leaked ciphertext');
  eq(out.data.items[0].pix_key_masked,'***.***.***-35');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
