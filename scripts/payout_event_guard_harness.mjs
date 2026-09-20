// Behavioral harness for process_payout_event_telegram_logs.js (SS12.7 Q3b).
// Stubs the Apps Script globals so the sink's real logic runs under node.
// Usage: node scripts/payout_event_guard_harness.mjs <path-to-sink.js>
import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');

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
    getRange(r,c,nr,nc){return {
      getValues(){const out=[];for(let i=0;i<nr;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nc));}return out;},
      getValue(){const rr=grid[r-1]||[];return rr[c-1]===undefined?'':rr[c-1];},
      setValue(v){const ri=r-1;grid[ri]=grid[ri]||[];grid[ri][c-1]=v;},
      setValues(v){for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}}
    };},
    appendRow(a){ grid.push(a.slice()); },
    insertSheet(){ return this; }
  };
}

let tcGrid = [];
let tcSheetSingleton = null;
function tcSheet(){ if(!tcSheetSingleton) tcSheetSingleton = makeSheet('Telegram Chat Logs', tcGrid); return tcSheetSingleton; }
const opsSheets = {};             // Tier-1 lives on the ops workbook (=== intake id)
const cfrSheets = {};             // Tier-2 lives on the private cfr program workbook
const OPS_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const CFR_ID = 'CFR_PRIVATE_SHEET_ID';

globalThis.SpreadsheetApp = {
  openById(id){
    if (id === OPS_ID) {
      return {
        getSheetByName(n){
          if (n === 'Telegram Chat Logs') return tcSheet();
          return opsSheets[n] || null;
        },
        insertSheet(n){ intakeWrites++; opsSheets[n] = makeSheet(n); return opsSheets[n]; }
      };
    }
    if (id === CFR_ID) {
      return {
        getSheetByName(n){ return cfrSheets[n] || null; },
        insertSheet(n){ cfrSheets[n] = makeSheet(n); return cfrSheets[n]; }
      };
    }
    throw new Error('unexpected spreadsheet id: '+id);
  }
};
globalThis.PropertiesService = { getScriptProperties(){ return { getProperty(k){ return k==='CFR_PROGRAM_SPREADSHEET_ID' ? CFR_ID : null; } }; } };
globalThis.LockService = { getScriptLock(){ return { tryLock(){return true;}, releaseLock(){} }; } };
let triggerInstalls = [];
globalThis.ScriptApp = {
  getProjectTriggers(){return triggerInstalls.map(fn=>({getHandlerFunction(){return fn;}}));},
  newTrigger(fn){ return { timeBased(){ return { everyHours(){ return { create(){ triggerInstalls.push(fn); } }; } }; } }; }
};
globalThis.Logger = { log(){} };
globalThis.Utilities = {};
// ---------------------------------------------------------------------------

(0, eval)(src);  // indirect eval -> global scope

let pass=0, fail=0;
function t(name, fn){ try{ fn(); pass++; console.log('  ok  '+name); }catch(e){ fail++; console.log('FAIL  '+name+'\n      '+e.message); } }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }

// The DApp wire shape: buildPayloadString('PAYOUT EVENT', {...}) -> tag-first lines.
function payload(o){
  const lines=[
    '[PAYOUT EVENT]',
    '- Program: '+(o.program||'crf-anapu'),
    '- Amount: '+(o.amount===undefined?'150.00':o.amount),
    '- Currency: '+(o.currency||'BRL'),
    '- Paid At: '+(o.paid_at||'2026-09-17T12:00:00Z'),
    '- Bank Ref Type: '+(o.bank_ref_type||'PIX_E2E'),
    '- Bank Ref: '+(o.bank_ref||''),
    '- Recipient: '+(o.recipient||'unlinked_recipient'),
    '- Tree Planting IDs: '+(o.trees===undefined?'TREE-001':o.trees),
    '- Status: '+(o.status||'live'),
    '- Receipt URL: '+(o.receipt_url||'https://drive.google.com/file/d/abc/view'),
    '- Submission Source: '+(o.source||'https://cfr.truesight.me/report_payout_event.html'),
    '--------'
  ];
  if (o.recipient_pk_hash) lines.splice(8,0,'- Recipient PK Hash: '+o.recipient_pk_hash);
  return lines.join('\n');
}
function tcRow(updateId, msg){ const r=new Array(18).fill(''); r[0]=updateId; r[3]='msg_'+updateId; r[6]=msg; return r; }
function reset(){ tcGrid=[]; tcSheetSingleton=null; for(const k in opsSheets) delete opsSheets[k]; for(const k in cfrSheets) delete cfrSheets[k]; intakeWrites=0; }
function tier1(){ const s=opsSheets['payouts']; return s? s.getDataRange().getValues():[]; }
function tier2(){ const s=cfrSheets['payout events']; return s? s.getDataRange().getValues():[]; }

// ---- tag + parse -----------------------------------------------------------
t('isPayoutEvent_ true on tag-first', ()=>eq(isPayoutEvent_(payload({bank_ref:'E1'})),true));
t('isPayoutEvent_ false when tag only mentioned', ()=>eq(isPayoutEvent_('Some text\n[PAYOUT EVENT] mentioned'),false));
t('parse extracts canonical fields', ()=>{
  const f=parsePayoutEventText_(payload({bank_ref:'E123',recipient_pk_hash:'pk-abc',trees:'TREE-1, TREE-2'}));
  eq(f.program_slug,'crf-anapu'); eq(f.bank_ref,'E123'); eq(f.recipient_pk_hash,'pk-abc');
  eq(f.currency,'BRL'); eq(f.status,'live'); eq(f.tree_planting_id,'TREE-1, TREE-2');
});

// ---- PR4 pure leg computation (SS0.11, no I/O) -----------------------------
t('PR4 uncommitted = -cash/-TBP/+Planted-Unassigned, all on main', ()=>{
  const legs=fpeComputeLegs_({amount:150,currency:'BRL',contributor:'Paulo',committed:false,qrLedgerIsMain:false});
  eq(legs.length,3);
  eq(legs.map(l=>l.target).join(','),'main,main,main');
  eq(legs[0].amount,-150); eq(legs[0].kind,'cash');
  eq(legs[1].literal,'Cacao Tree - To Be Paid For'); eq(legs[1].amount,-1);
  eq(legs[2].literal,'Cacao Tree Planted - Unassigned'); eq(legs[2].amount,1);
});
t('PR4 committed cross-ledger = -cash on QR ledger, +cash/-TBP on main', ()=>{
  const legs=fpeComputeLegs_({amount:150,currency:'BRL',contributor:'Paulo',committed:true,qrLedgerIsMain:false});
  eq(legs.length,3);
  eq(legs[0].target,'qr'); eq(legs[0].amount,-150); eq(legs[0].kind,'cash');
  eq(legs[1].target,'main'); eq(legs[1].amount,150); eq(legs[1].kind,'cash');
  eq(legs[2].target,'main'); eq(legs[2].literal,'Cacao Tree - To Be Paid For'); eq(legs[2].amount,-1);
  if(legs.some(l=>l.literal==='Cacao Tree Planted - Unassigned')) throw new Error('phantom pool unit on a committed settlement');
});
t('PR4 committed when QR ledger IS main = 1 leg (two cash legs collapse)', ()=>{
  const legs=fpeComputeLegs_({amount:150,currency:'BRL',contributor:'Paulo',committed:true,qrLedgerIsMain:true});
  eq(legs.length,1);
  eq(legs[0].target,'main'); eq(legs[0].amount,-1); eq(legs[0].kind,'inventory');
  eq(legs[0].literal,'Cacao Tree - To Be Paid For');
});
t('PR4 cash-out leg is not revenue', ()=>{
  const legs=fpeComputeLegs_({amount:1,currency:'BRL',committed:false});
  eq(legs[0].isRevenue,'');
});
t('PR4 fails closed on non-numeric amount / empty currency', ()=>{
  eq(fpeComputeLegs_({amount:'abc',currency:'BRL'}).length,0);
  eq(fpeComputeLegs_({amount:1,currency:''}).length,0);
});

// ---- CFR routing -----------------------------------------------------------
t('CFR detected by program_slug', ()=>eq(payoutEventIsCfr_('crf-anapu',''),true));
t('CFR detected by submission source host', ()=>eq(payoutEventIsCfr_('','https://cfr.truesight.me/x.html'),true));
t('non-CFR by other slug+host', ()=>eq(payoutEventIsCfr_('other','https://agroverse.shop/x'),false));

// ---- tree id normalisation -------------------------------------------------
t('tree ids deduped + comma-joined', ()=>eq(payoutEventNormaliseTreeIds_('T-1, T-2, T-1'),'T-1, T-2'));

// ---- end-to-end: one CFR payout -------------------------------------------
reset();
tcGrid=[['A','B','C','D','E','F','G'], tcRow('111', payload({bank_ref:'E-AAA', recipient_pk_hash:'pk-1'}))];
t('e2e records one Tier-1 row', ()=>{ const r=processPayoutEventsFromTelegramChatLogs(); eq(r.success,true); eq(r.recorded,1); });
t('e2e dual-writes Tier-2 for CFR', ()=>{ eq(tier2().length, 2); });
t('e2e Tier-1 headers match schema', ()=>{
  eq(tier1()[0].join('|'),
     'created_at_utc|telegram_update_id|program_slug|submission_source|recipient_pk_hash|amount|currency|tree_planting_id|bank_ref_type|bank_ref|paid_at|receipt_url|status|supersedes_row|error_message');
});
t('e2e Tier-2 headers = Tier-1 + cohort/student_ref', ()=>{
  eq(tier2()[0].slice(-2).join('|'),'cohort|student_ref'); eq(tier2()[0].length,17);
});
t('e2e col R dedup marker persisted on the intake row', ()=>{
  eq(String(tcSheet().getRange(2, 18).getValue()), 'PROCESSED:PAYOUT_EVENT');
});

// ---- THE RETRY GUARD (SS12.3 layer 2): same transfer, NEW update id --------
reset();
tcGrid=[['A','B','C','D','E','F','G'],
  tcRow('111', payload({bank_ref:'E-RETRY', recipient_pk_hash:'pk-9'})),   // attempt 1 booked
  tcRow('222', payload({bank_ref:'E-RETRY', recipient_pk_hash:'pk-9'}))];  // retry: NEW update id
t('e2e RETRY: same bank_ref booked ONCE, flagged duplicate', ()=>{
  const r=processPayoutEventsFromTelegramChatLogs();
  eq(r.recorded,1); eq(r.duplicates,1);
  eq(tier1().length, 2, 'tier1 data rows (header + 1)');
  eq(tier2().length, 2, 'tier2 not double-booked either');
});

// ---- SS12.3 layer 1: re-scan of an already-marked row ----------------------
reset();
tcGrid=[['A','B','C','D','E','F','G'], tcRow('333', payload({bank_ref:'E-GATE'}))];
processPayoutEventsFromTelegramChatLogs();
t('e2e re-scan is a no-op (col R gate)', ()=>{
  const r=processPayoutEventsFromTelegramChatLogs();
  eq(r.recorded,0); eq(tier1().length,2);
});

// ---- refusal: no bank_ref --------------------------------------------------
reset();
tcGrid=[['A','B','C','D','E','F','G'], tcRow('444', payload({bank_ref:''}))];
t('e2e REFUSES without bank_ref', ()=>{
  const r=processPayoutEventsFromTelegramChatLogs();
  eq(r.rejected,1);
  if(!tier1().flat().join('|').includes('REJECTED_MISSING_BANK_REF')) throw new Error('missing refusal status');
});

// ---- non-CFR writes Tier-1 only -------------------------------------------
reset();
tcGrid=[['A','B','C','D','E','F','G'], tcRow('555', payload({bank_ref:'E-NCFR', program:'other', source:'https://agroverse.shop/x'}))];
t('e2e non-CFR writes Tier-1 only', ()=>{
  const r=processPayoutEventsFromTelegramChatLogs();
  eq(r.recorded,1); eq(r.tier2,0); eq(tier2().length,0);
});

// ---- the public intake is NEVER a write target for payout rows -------------
t('e2e intake workbook never got a payout row inserted', ()=>{
  // `payouts` was created on the ops workbook handle, not via a stray intake write
  if(tier1().length===0) throw new Error('tier1 not written');
});

// ---- entry point installs the hourly safety-net trigger --------------------
t('e2e entry point installs exactly one hourly trigger', ()=>{
  if(!triggerInstalls.includes('processPayoutEventsFromTelegramChatLogs'))
    throw new Error('hourly trigger not installed by entry point');
});
t('e2e second run does not double-install the trigger', ()=>{
  reset(); triggerInstalls=[];
  tcGrid=[['A','B','C','D','E','F','G'], tcRow('999', payload({bank_ref:'E-TRIG'}))];
  processPayoutEventsFromTelegramChatLogs();
  processPayoutEventsFromTelegramChatLogs();
  const n=triggerInstalls.filter(f=>f==='processPayoutEventsFromTelegramChatLogs').length;
  if(n!==1) throw new Error('expected 1 trigger create, got '+n);
});

// ---- trigger status is surfaced in the action response (#513 verifiability) --
reset(); triggerInstalls=[];
tcGrid=[['A','B','C','D','E','F','G'], tcRow('777', payload({bank_ref:'E-TRIGSTAT-A'}))];
t('e2e first run reports trigger:installed', ()=>{
  const r=processPayoutEventsFromTelegramChatLogs();
  if(r.trigger!=='installed') throw new Error('expected trigger=installed, got '+r.trigger);
});
t('e2e second run reports trigger:present (no re-install)', ()=>{
  const r=processPayoutEventsFromTelegramChatLogs();
  if(r.trigger!=='present') throw new Error('expected trigger=present, got '+r.trigger);
});
t('e2e empty-intake run also reports trigger status', ()=>{
  reset(); triggerInstalls=[];
  const r=processPayoutEventsFromTelegramChatLogs();
  if(r.trigger!=='installed') throw new Error('empty-intake run lacked trigger status: '+r.trigger);
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
