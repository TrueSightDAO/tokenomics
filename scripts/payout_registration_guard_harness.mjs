import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');

// ---- minimal GAS stubs -----------------------------------------------------
// Two workbooks: the intake workbook (Telegram Chat Logs tab + the SS11.3-bis
// MIRROR tab) and the PRIVATE `cfr program` sheet. The harness records every write
// per tab so a test can prove the `Telegram Chat Logs` TAB is never written to,
// while the mirror tab IS (that is the SS11.3-bis decision, Gary 2026-09-25).
let tcTabWrites = 0;      // writes to the read-only `Telegram Chat Logs` tab
let mirrorWrites = 0;     // writes to the mirror tab on the intake workbook
function makeSheet(name, data, onWrite) {
  let grid = data ? data.map(r => r.slice()) : [];
  const hook = typeof onWrite === 'function' ? onWrite : function(){};
  return {
    _name: name, _grid: grid,
    getName(){return name;},
    getLastRow(){return grid.length;},
    getLastColumn(){return grid.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){return {getValues(){return grid.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){return {getValues(){const out=[];for(let i=0;i<nr;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nc));}return out;},setValues(v){hook();for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}}};},
    appendRow(a){ hook(); grid.push(a.slice()); },
    insertSheet(){ return this; }
  };
}
let tcGrid = [];
let cfrSheets = {};               // name -> sheet (the private cfr program workbook)
let intakeSheets = {};            // name -> sheet (mirror tabs on the intake workbook)
const INTAKE_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const CFR_ID = 'CFR_PRIVATE_SHEET_ID';
globalThis.SpreadsheetApp = {
  openById(id){
    if (id === INTAKE_ID) {
      return {
        getSheetByName(n){
          if (n === 'Telegram Chat Logs') return makeSheet(n, tcGrid, ()=>{ tcTabWrites++; });
          return intakeSheets[n] || null;
        },
        insertSheet(n){ intakeSheets[n] = makeSheet(n, null, ()=>{ mirrorWrites++; }); return intakeSheets[n]; }
      };
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
function reset(){ tcGrid=[]; cfrSheets={}; intakeSheets={}; tcTabWrites=0; mirrorWrites=0; }
function payoutRows(){ const s=cfrSheets['payout registrations']; return s ? s.getDataRange().getValues() : []; }
function mirrorRows(){ const s=intakeSheets['payout registrations']; return s ? s.getDataRange().getValues() : []; }

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
// ---- SS11.3-bis: the `Telegram Chat Logs` TAB stays read-only; the MIRROR tab is written
t('e2e Telegram Chat Logs tab is never written to', ()=>{ eq(tcTabWrites,0,'Telegram Chat Logs tab writes'); });
t('e2e SS11.3-bis mirror tab IS written', ()=>{ if(mirrorWrites<1) throw new Error('mirror tab not written'); });
t('e2e mirror tab carries the raw PIX (parity with the private tab)', ()=>{
  const all = mirrorRows().flat().join('|');
  if(!all.includes('111.444.777-35')) throw new Error('raw PIX missing from mirror tab');
});
t('e2e mirror tab schema matches the private tab', ()=>{
  eq(mirrorRows()[0].join(','), payoutRows()[0].join(','), 'mirror header');
});
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

// ---- ACTIVE/SUPERSEDED lifecycle (col I holds ONE ACTIVE row per pk_hash) ----
reset();
tcGrid = [['A','B','C','D','E','F','G'],
  ['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload.replace('111.444.777-35','222.555.888-44')],
  ['Edgar_2','-','EDGAR','msg2','Edgar','',''+payload.replace('111.444.777-35','333.666.999-55')]];
t('e2e LIFECYCLE: one ACTIVE row, prior row SUPERSEDED (same pk_hash)', ()=>{
  processPayoutRegistrationsFromTelegramChatLogs();
  const rows = payoutRows(); const h = rows[0]; const si = h.indexOf('status');
  const st = rows.slice(1).map(r=>String(r[si]));
  eq(st.filter(s=>s==='ACTIVE').length, 1, 'ACTIVE rows');
  eq(st.filter(s=>s==='SUPERSEDED').length, 1, 'SUPERSEDED rows');
});
t('e2e MIRROR LIFECYCLE: mirror tab also holds one ACTIVE per pk_hash', ()=>{
  const rows = mirrorRows(); const h = rows[0]; const si = h.indexOf('status');
  const st = rows.slice(1).map(r=>String(r[si]));
  eq(st.filter(s=>s==='ACTIVE').length, 1, 'mirror ACTIVE rows');
  eq(st.filter(s=>s==='SUPERSEDED').length, 1, 'mirror SUPERSEDED rows');
});
reset();
tcGrid = [['A','B','C','D','E','F','G'],['Edgar_1','-','EDGAR','msg1','Edgar','',''+payload]];
t('e2e LIFECYCLE: first submission is ACTIVE (not RECORDED)', ()=>{
  processPayoutRegistrationsFromTelegramChatLogs();
  const rows = payoutRows(); const si = rows[0].indexOf('status');
  eq(String(rows[1][si]), 'ACTIVE');
});
t('source no longer emits legacy RECORDED/UPDATED statuses', ()=>{
  if(/'UPDATED'|"UPDATED"|'RECORDED'|"RECORDED"/.test(src)) throw new Error('legacy status literals still present');
});
t('supersede flips ALL prior rows for the hash, not just the last', ()=>{
  reset();
  let g = [['A','B','C','D','E','F','G']];
  for(const [id,pix] of [['Edgar_1','222.555.888-44'],['Edgar_2','333.666.999-55'],['Edgar_3','444.777.111-66']])
    g.push([id,'-','EDGAR','m'+id,'Edgar','',''+payload.replace('111.444.777-35',pix)]);
  tcGrid = g;
  processPayoutRegistrationsFromTelegramChatLogs();
  const rows = payoutRows(); const si = rows[0].indexOf('status');
  const st = rows.slice(1).map(r=>String(r[si]));
  eq(st.filter(s=>s==='ACTIVE').length, 1, 'ACTIVE rows');
  eq(st.filter(s=>s==='SUPERSEDED').length, 2, 'SUPERSEDED rows');
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

// ---- SS11.3 + SS11.3-bis BACKFILL lever (legacy RECORDED/UPDATED -> ACTIVE/SUPERSEDED) ----
const LEGACY_H = ['created_at_utc','telegram_update_id','pk_hash','program_slug','pix_key_type','pix_key','pix_key_masked','submission_source','status','supersedes_row','error_message'];
function seedLegacyPayoutTab(rows){
  cfrSheets['payout registrations'] = makeSheet('payout registrations', [LEGACY_H].concat(rows||[]));
}
const legacy4 = [
  ['2026-09-24T16:05:00.000Z','Edgar_1','pk-abc','crf-anapu','CPF','111.444.777-35','***.***.***-35','src','RECORDED','',''],
  ['2026-09-24T16:06:00.000Z','Edgar_2','pk-abc','crf-anapu','CPF','222.555.888-44','***.***.***-44','src','UPDATED','2',''],
  ['2026-09-24T16:07:00.000Z','Edgar_3','pk-abc','crf-anapu','CPF','333.666.999-55','***.***.***-55','src','UPDATED','3',''],
  ['2026-09-24T16:07:21.290Z','Edgar_4','pk-abc','crf-anapu','CPF','444.777.111-66','***.***.***-66','src','UPDATED','4','']
];

reset(); seedLegacyPayoutTab(legacy4);
t('backfill: legacy 4-row pk_hash collapses to 1 ACTIVE + 3 SUPERSEDED', ()=>{
  const r = backfillPayoutRegistrations();
  eq(r.success, true); eq(r.active, 1, 'active'); eq(r.superseded, 3, 'superseded');
  const rows = payoutRows(); const si = rows[0].indexOf('status');
  const st = rows.slice(1).map(x=>String(x[si]));
  eq(st.filter(s=>s==='ACTIVE').length, 1, 'ACTIVE rows');
  eq(st.filter(s=>s==='SUPERSEDED').length, 3, 'SUPERSEDED rows');
  if(st.indexOf('RECORDED')>=0 || st.indexOf('UPDATED')>=0) throw new Error('legacy statuses survived');
});
t('backfill: latest row (by created_at_utc) is the ACTIVE one', ()=>{
  const rows = payoutRows(); const si = rows[0].indexOf('status'); const ui = rows[0].indexOf('telegram_update_id');
  const winner = rows.slice(1).find(r=>String(r[si])==='ACTIVE');
  eq(String(winner[ui]), 'Edgar_4');
});
t('backfill: mirror tab created, schema-identical, one ACTIVE row', ()=>{
  const rows = mirrorRows();
  if(!rows.length) throw new Error('mirror tab not created');
  eq(rows[0].join(','), LEGACY_H.join(','), 'mirror header');
  const si = rows[0].indexOf('status');
  eq(rows.slice(1).filter(r=>String(r[si])==='ACTIVE').length, 1, 'mirror ACTIVE rows');
});
t('backfill: winning row raw PIX is mirrored (parity with private tab)', ()=>{
  const all = mirrorRows().flat().join('|');
  if(!all.includes('444.777.111-66')) throw new Error('winning raw PIX not mirrored');
});
t('backfill: idempotent (second run changes nothing)', ()=>{
  const before = JSON.stringify(payoutRows());
  const r = backfillPayoutRegistrations();
  eq(r.success, true); eq(r.changed, 0, 'second-run writes');
  eq(JSON.stringify(payoutRows()), before, 'payout tab unchanged');
});
t('backfill: REJECTED_* / no-pk_hash rows are left untouched', ()=>{
  reset();
  seedLegacyPayoutTab(legacy4.concat([
    ['2026-09-24T16:08:00.000Z','Edgar_5','','','','','','src','REJECTED_MISSING_PK_HASH','','no pk'],
    ['2026-09-24T16:09:00.000Z','Edgar_6','pk-zzz','crf-anapu','CPF','999.888.777-66','***.***.***-66','src','ACTIVE','','']
  ]));
  const r = backfillPayoutRegistrations();
  eq(r.success, true); eq(r.active, 2, 'ACTIVE (pk-abc + pk-zzz)');
  const rows = payoutRows(); const si = rows[0].indexOf('status'); const pi = rows[0].indexOf('pk_hash');
  const rej = rows.slice(1).find(x=>String(x[pi]).trim()==='');
  eq(String(rej[si]), 'REJECTED_MISSING_PK_HASH', 'terminal row untouched');
});
t('backfill: never writes the Telegram Chat Logs tab', ()=>{ eq(tcTabWrites, 0, 'Telegram Chat Logs tab writes'); });

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
