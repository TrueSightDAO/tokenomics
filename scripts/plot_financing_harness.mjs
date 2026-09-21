// Behavioral harness for process_plot_financing_event_telegram_logs.js (PR10b).
// Stubs the Apps Script globals so the sink's real logic runs under node.
// Usage: node scripts/plot_financing_harness.mjs <path-to-sink.js>
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
    getRange(r,c,nr,nc){
      const self=this;
      const nR=(nr===undefined?1:nr), nC=(nc===undefined?1:nc);
      return {
        getValues(){const out=[];for(let i=0;i<nR;i++){const rr=grid[r-1+i]||[];out.push(rr.slice(c-1,c-1+nC));}return out;},
        getValue(){const rr=grid[r-1]||[];return rr[c-1]===undefined?'':rr[c-1];},
        setValue(v){const ri=r-1;grid[ri]=grid[ri]||[];grid[ri][c-1]=v;return self;},
        setValues(v){for(let i=0;i<v.length;i++){const ri=r-1+i;grid[ri]=grid[ri]||[];for(let j=0;j<v[i].length;j++)grid[ri][c-1+j]=v[i][j];}return self;}
      };
    },
    appendRow(a){ grid.push(a.slice()); },
    insertSheet(){ return this; }
  };
}

let tcGrid = [];
let tcSheetSingleton = null;
function tcSheet(){ if(!tcSheetSingleton) tcSheetSingleton = makeSheet('Telegram Chat Logs', tcGrid); return tcSheetSingleton; }
const opsSheets = {};
const mainSheets = {};
const OPS_ID = '1qbZZhf-_7xzmDTriaJVWj6OZshyQsFkdsAV8-pyzASQ';
const MAIN_ID = '1GE7PUq-UT6x2rBN-Q2ksogbWpgyuh2SaxJyG_uEK6PU';

globalThis.SpreadsheetApp = {
  openById(id){
    if (id === OPS_ID) {
      return {
        getSheetByName(n){ if (n === 'Telegram Chat Logs') return tcSheet(); return opsSheets[n] || null; },
        insertSheet(n){ intakeWrites++; opsSheets[n] = makeSheet(n); return opsSheets[n]; }
      };
    }
    if (id === MAIN_ID) {
      return {
        getSheetByName(n){ return mainSheets[n] || null; },
        insertSheet(n){ mainSheets[n] = makeSheet(n); return mainSheets[n]; }
      };
    }
    throw new Error('unexpected spreadsheet id: '+id);
  }
};
globalThis.LockService = { getScriptLock(){ return { tryLock(){return true;}, releaseLock(){} }; } };
let triggerInstalls = [];
globalThis.ScriptApp = {
  getProjectTriggers(){return triggerInstalls.map(fn=>({getHandlerFunction(){return fn;}}));},
  newTrigger(fn){ return { timeBased(){ return { everyHours(){ return { create(){ triggerInstalls.push(fn); } }; } }; } }; }
};
globalThis.Logger = { log(){} };
// ---------------------------------------------------------------------------

(0, eval)(src);  // indirect eval -> global scope

let pass=0, fail=0;
function t(name, fn){ try{ fn(); pass++; console.log('  ok  '+name); }catch(e){ fail++; console.log('FAIL  '+name+'\n      '+e.message); } }
function eq(a,b,m){ if(a!==b) throw new Error((m||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a)); }

// The DApp wire shape: tag-first lines.
function payload(o){
  const lines=[
    '[PLOT FINANCING EVENT]',
    '- Plot ID: '+(o.plot||'RM-P1'),
    '- Farmer: '+(o.farmer===undefined?'Maria Silva':o.farmer),
    '- Tree Count: '+(o.trees===undefined?'500':o.trees),
    '- Amount: '+(o.amount===undefined?'750.00':o.amount),
    '- Currency: '+(o.currency||'USD'),
    '- Date: '+(o.date||'2026-09-20'),
    '- Bank Ref: '+(o.bank_ref===undefined?'ADV-001':o.bank_ref),
    '- Receipt URL: '+(o.receipt||'https://drive.google.com/file/d/abc/view'),
    '--------'
  ];
  return lines.join('\n');
}
function tcRow(updateId, msg){ const r=new Array(18).fill(''); r[0]=updateId; r[3]='msg_'+updateId; r[6]=msg; return r; }
function reset(){ tcGrid=[]; tcSheetSingleton=null; for(const k in opsSheets) delete opsSheets[k]; for(const k in mainSheets) delete mainSheets[k]; intakeWrites=0; }
function setOps(n,g){ opsSheets[n]=makeSheet(n,g); }
function setMain(n,g){ mainSheets[n]=makeSheet(n,g); }
function plotsGrid(rows){ const g=[['Plot ID','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','Contributor Name']]; (rows||[]).forEach(r=>g.push(r)); return g; }
function offchain(){ const s=mainSheets['offchain transactions']; return s? s.getDataRange().getValues():[]; }
function tracking(){ const s=opsSheets['Plot Financing']; return s? s.getDataRange().getValues():[]; }

// ---- tag + parse ----------------------------------------------------------
t('isPlotFinancingEvent_ true on tag-first', ()=>eq(isPlotFinancingEvent_(payload({})),true));
t('isPlotFinancingEvent_ false when tag merely mentioned', ()=>eq(isPlotFinancingEvent_('Some text\n[PLOT FINANCING EVENT] mentioned'),false));
t('parse extracts canonical fields', ()=>{
  const f=pfParseText_(payload({plot:'RM-P9',farmer:'Ana',trees:'120',amount:'300.50',currency:'USD',bank_ref:'ADV-9'}));
  eq(f.plotId,'RM-P9'); eq(f.farmer,'Ana'); eq(f.treeCount,'120'); eq(f.amount,'300.50'); eq(f.currency,'USD'); eq(f.bankRef,'ADV-9');
});
t('pfNum_ strips currency decoration, blanks garbage', ()=>{
  eq(pfNum_('1,250.75'),'1250.75'); eq(pfNum_('300 USD'),'300'); eq(pfNum_('N/A'),'');
});

// ---- pure leg model -------------------------------------------------------
t('legs: two legs, both main - cash out + pool mint', ()=>{
  const l=pfComputeLegs_({amount:'750',treeCount:'500',currency:'USD',contributor:'Maria Silva'});
  eq(l.length,2);
  eq(l[0].target,'main'); eq(l[0].amount,-750); eq(l[0].kind,'cash'); eq(l[0].isRevenue,'');
  eq(l[1].target,'main'); eq(l[1].amount,500); eq(l[1].literal,'Cacao Tree Planted - Unassigned'); eq(l[1].isRevenue,'N');
});
t('legs fail closed on non-positive amount / count / blank currency', ()=>{
  eq(pfComputeLegs_({amount:'0',treeCount:'5',currency:'USD'}).length,0);
  eq(pfComputeLegs_({amount:'-5',treeCount:'5',currency:'USD'}).length,0);
  eq(pfComputeLegs_({amount:'5',treeCount:'0',currency:'USD'}).length,0);
  eq(pfComputeLegs_({amount:'5',treeCount:'5',currency:''}).length,0);
});

// ---- fail-closed ledger booking -------------------------------------------
reset();
setMain('offchain transactions',[]);
t('unresolvable plot => NOT booked, nothing written', ()=>{
  const r=pfBookLedger_({plotId:'NO-SUCH',farmer:'X',treeCount:'5',amount:'10',currency:'USD'});
  eq(r.booked,false); eq(r.reason,'PLOT_NOT_FOUND'); eq(offchain().length,0);
});

reset();
setOps('SunMint Plots', plotsGrid([['RM-P1','','','','','','','','','','','','','','','','','','','Maria Silva']]));
setMain('offchain transactions',[]);
t('resolved plot => 2 legs booked on main', ()=>{
  const r=pfBookLedger_({plotId:'RM-P1',farmer:'Maria Silva',treeCount:'500',amount:'750',currency:'USD'});
  eq(r.booked,true); eq(r.legs,2);
  const tx=offchain(); eq(tx.length,2);
  eq(tx[0][3],-750); eq(tx[1][3],500); eq(tx[1][4],'Cacao Tree Planted - Unassigned');
});

// ---- end-to-end scan: booking + dedup + seeding ---------------------------
reset();
setOps('SunMint Plots', plotsGrid([['RM-P2','','','','','','','','','','','','','','','','','','','']]));
setOps('Plot Financing',[]);
setMain('offchain transactions',[]);
tcGrid=[['A','B','C','D','E','F','G'], tcRow('9001', payload({plot:'RM-P2',farmer:'Joao',trees:'10',amount:'15',bank_ref:'ADV-2'}))];
t('e2e: books 2 legs, status BOOKED, seeds registry col T, marks intake col R', ()=>{
  const r=processPlotFinancingEventsFromTelegramChatLogs();
  eq(r.recorded,1); eq(r.booked,1); eq(r.flagged,0);
  eq(offchain().length,2);
  const st=tracking().map(x=>x[10]); if(st.indexOf('BOOKED')<0) throw new Error('tracking not BOOKED: '+st.join(','));
  const seeded=opsSheets['SunMint Plots'].getDataRange().getValues();
  eq(seeded[1][19],'Joao','registry col T seeded');
  eq(tcSheet().getDataRange().getValues()[1][17],'PROCESSED:PLOT_FINANCING_EVENT','intake col R marked');
});
t('e2e: retry is a no-op (col R dedup gate)', ()=>{
  const r=processPlotFinancingEventsFromTelegramChatLogs();
  eq(r.recorded,0); eq(r.duplicates,1); eq(offchain().length,2);
});
t('e2e: bad-target plot flagged LEDGER_NOT_BOOKED + reason', ()=>{
  reset();
  setOps('SunMint Plots', plotsGrid([['RM-P2','','','','','','','','','','','','','','','','','','','']]));
  setMain('offchain transactions',[]);
  tcGrid=[['A','B','C','D','E','F','G'], tcRow('9002', payload({plot:'GHOST',farmer:'X',trees:'10',amount:'15'}))];
  const r=processPlotFinancingEventsFromTelegramChatLogs();
  eq(r.recorded,1); eq(r.flagged,1);
  eq(offchain().length,0);
  const st=tracking().map(x=>x[10]); if(st.indexOf('LEDGER_NOT_BOOKED')<0) throw new Error('not flagged: '+st.join(','));
  const em=tracking().map(x=>x[11]).join(' '); if(em.indexOf('PLOT_NOT_FOUND')<0) throw new Error('reason missing: '+em);
});
t('e2e: existing registry name is never overwritten', ()=>{
  reset();
  setOps('SunMint Plots', plotsGrid([['RM-P3','','','','','','','','','','','','','','','','','','','Already Set']]));
  setMain('offchain transactions',[]);
  const seed=pfSeedPlotContributor_({rowNumber:2, contributorName:'Already Set'}, 'Someone Else');
  eq(seed.seeded,false); eq(seed.reason,'MISMATCH_EXISTING');
  eq(opsSheets['SunMint Plots'].getDataRange().getValues()[1][19],'Already Set');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
