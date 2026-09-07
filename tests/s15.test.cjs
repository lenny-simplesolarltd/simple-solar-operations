const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=require('../schema/tables.json'),seed=require('../schema/config-seed.json');
const core=require('../s15/cancellation.js'),fixture=require('../s15/fixture.js');
const {_s15Execute:execute,_s15SetModes:setModes,_s15Date:date}=core;
const copy=x=>structuredClone(x);
function store(){
 const tables=Object.fromEntries(schema.tables.map(t=>[t.name,[]]));let held=false;
 const s={tables,getSheetId:()=>core.S15_DEV_SHEET_ID,getEnvironment:()=>'DEV',list:n=>copy(tables[n]||[]),get:(n,id)=>copy((tables[n]||[]).find(r=>r.id===id)||null),
 insert(n,r){assert.ok(tables[n],n);assert.ok(!this.get(n,r.id),'duplicate '+r.id);const headers=schema.tables.find(t=>t.name===n).columns.map(c=>c.name);for(const k of Object.keys(r))assert.ok(headers.includes(k),'unknown '+n+'.'+k);tables[n].push(copy(r));},
 update(n,id,p){const r=tables[n].find(r=>r.id===id);assert.ok(r,n+'/'+id);Object.assign(r,copy(p));},
 withLock(fn){assert.equal(held,false,'lock contention');held=true;try{return fn();}finally{held=false;}}};
 for(const r of seed.ReleaseModes)s.insert('ReleaseModes',{...r,version:1});fixture._s15Seed(s);setModes(s,true);return s;
}
function input(s,command_id='NEXT',extra={}){return{job_id:'J-s15-clean',actor:'PERSON-s15-office',command_id,reason:'Synthetic review',expected_version:s.get('Jobs','J-s15-clean').version,...extra};}
function cancel(s,extra={}){return execute('Cancel',{...fixture._s15CancelInput(),...extra},s);}
function close(s){return execute('Close',input(s,'CLOSE',{tracked_obligations:s.list('Tasks').filter(t=>t.group==='Cancellation'&&t.status!=='Complete').map(t=>({task_id:t.id,reference:'test-tracked',reason:'Retained owned obligation'}))}),s);}
function reopen(s,extra={}){return execute('Reinstate',input(s,'REOPEN',{new_date:'2026-11-25',commitment_review:'All commitments reviewed; fresh planning only',finance_review:'Invoice reuse reviewed; no new invoice',evidence_reference:'synthetic-review',...extra}),s);}
function add(s,t,r){s.insert(t,{...r});}
function cloud(){
 const ctx=vm.createContext({console:{log(){}},Intl,Date}),grids={};vm.runInContext(fs.readFileSync('apps-script/s15/S15Cancellation.js','utf8'),ctx);
 for(const [n,h] of Object.entries(ctx.S15_HEADERS))grids[n]=[Array.from(h)];
 for(const r of seed.ReleaseModes)grids.ReleaseModes.push(grids.ReleaseModes[0].map(k=>r[k]??(k==='version'?1:'')));
 let busy=false;
 const sheets=Object.keys(grids).map(n=>({getName:()=>n,getLastColumn:()=>grids[n][0].length,getLastRow:()=>grids[n].length,getMaxRows:()=>2000,getRange(row,col,height=1,width=1){return{getValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>(grids[n][row+i-1]||[])[col+j-1]??''));},setValues(values){values.forEach((r,i)=>r.forEach((v,j)=>{grids[n][row+i-1]??=[];grids[n][row+i-1][col+j-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;}));}};}}));
 ctx.SpreadsheetApp={getActiveSpreadsheet:()=>({getId:()=>core.S15_DEV_SHEET_ID,getSheets:()=>sheets}),flush(){}};
 ctx.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify({environment:'DEV'})})};
 ctx.LockService={getScriptLock:()=>({tryLock(){if(busy)return false;busy=true;return true;},releaseLock(){busy=false;}})};
 for(const api of ['CalendarApp','UrlFetchApp','GmailApp','MailApp'])ctx[api]=new Proxy({},{get(){throw new Error('EXTERNAL API FORBIDDEN');}});
 return{ctx,grids};
}

test('S15 01: valid cancellation preview is read-only; removes future demand and preserves internal Job ID',()=>{
 const s=store(),before=copy(s.tables);const p=core._s15Preview(fixture._s15CancelInput(),s);assert.deepEqual(s.tables,before);assert.equal(p.job.id,'J-s15-clean');
 const r=cancel(s);assert.equal(r.status,'CancellationInProgress');assert.equal(s.get('Jobs','J-s15-clean').job_id,'SS-S15C-LEAN');assert.equal(s.get('WorkPackages','WP-s15-roof').status,'Cancelled');assert.equal(s.get('Allocations','ALLOC-s15-roof').active,false);assert.equal(s.get('Tasks','TASK-s15-booking').status,'Cancelled');assert.equal(r.external_calls,0);
});
test('S15 02: reason, effective date, impact fields, actor and optimistic revision fail closed',()=>{
 for(const patch of [{reason:' '},{effective_date:'2026-02-30'},{material_state:null},{work_performed:''},{scaffold_state:null},{finance_review:''},{legacy_state:''},{actor:'unknown'},{expected_version:9}]){const s=store(),before=copy(s.tables);assert.throws(()=>cancel(s,patch),/S15_/);assert.deepEqual(s.tables,before);}
});
test('S15 03: identical replay is a no-op; conflicting replay and second cancellation refused',()=>{
 const s=store();cancel(s);const before=copy(s.tables);assert.equal(cancel(s).replay,true);assert.deepEqual(s.tables,before);assert.throws(()=>cancel(s,{reason:'different'}),/conflicting/);assert.throws(()=>cancel(s,{command_id:'different',expected_version:2}),/already started/);
});
test('S15 04: completed tasks, complaints, remedials and performed work remain attributed',()=>{
 const s=store();add(s,'Tasks',{id:'DONE',job_id:'J-s15-clean',status:'Complete',template_code:'BKG04',group:'Booking',completed_by:'Original',evidence_id:'E1'});add(s,'Tasks',{id:'ISSUE-TASK',job_id:'J-s15-clean',status:'Open',template_code:'BKG04',group:'Install',related_entity_type:'Issues'});add(s,'Issues',{id:'ISSUE',job_id:'J-s15-clean',status:'Open',blocks_strip:true});add(s,'WorkPackages',{id:'DONE-WP',job_id:'J-s15-clean',status:'ConfirmedComplete',actual_end:'2026-10-01',installer_confirmation_by:'Original'});
 const before=['Tasks','Issues','WorkPackages'].map(t=>s.list(t));cancel(s);assert.deepEqual(s.get('Tasks','DONE'),before[0].find(t=>t.id==='DONE'));assert.equal(s.get('Tasks','ISSUE-TASK').status,'Open');assert.deepEqual(s.list('Issues'),before[1]);assert.deepEqual(s.get('WorkPackages','DONE-WP'),before[2].find(w=>w.id==='DONE-WP'));
});
test('S15 05: material demand/reservations released without physical stock rollback',()=>{
 const s=store();add(s,'Materials',{id:'M',job_id:'J-s15-clean',required_quantity:12,cancelled_quantity:0,revision:1,version:1});add(s,'Reservations',{id:'R',material_id:'M',status:'Active',picked_quantity:0,version:1});add(s,'Reservations',{id:'PICKED',material_id:'M',status:'Issued',picked_quantity:4,version:1});add(s,'StockMovements',{id:'MOV',job_id:'J-s15-clean',movement_type:'Issue',quantity:4});const physical=s.list('StockMovements');cancel(s);assert.equal(s.get('Materials','M').cancelled_quantity,12);assert.equal(s.get('Reservations','R').status,'Released');assert.equal(s.get('Reservations','PICKED').status,'Issued');assert.deepEqual(s.list('StockMovements'),physical);assert.ok(s.list('Tasks').some(t=>t.template_code==='S15-CAN-STOCK'));
});
test('S15 06: sent/received orders require latest acknowledgement; draft history retained',()=>{
 const s=store();add(s,'Orders',{id:'DRAFT',job_id:'J-s15-clean',status:'Draft',revision:1,version:1});add(s,'Orders',{id:'SENT',job_id:'J-s15-clean',status:'PartReceived',supplier_reference:'REF',revision:4,version:1});add(s,'OrderLines',{id:'LINE',order_id:'SENT',quantity:3});cancel(s);assert.equal(s.get('Orders','DRAFT').status,'Cancelled');assert.equal(s.get('Orders','SENT').status,'Review');assert.equal(s.list('OrderLines').length,1);assert.throws(()=>close(s),/confirmation outstanding/);
 const t=s.list('Tasks').find(t=>t.template_code==='S15-CAN-MERCHANT'),x=input(s,'ACK',{task_id:t.id,task_version:t.version,evidence_reference:'merchant-reply',confirmed_revision:4,outcome:'Confirmed'});
 assert.throws(()=>execute('Resolve',x,s),/latest revision/);x.confirmed_revision=5;x.outcome='Sent';assert.throws(()=>execute('Resolve',x,s),/sent is not confirmed/);x.outcome='Confirmed';execute('Resolve',x,s);assert.equal(s.get('Orders','SENT').status,'Cancelled');assert.equal(s.get('Orders','SENT').supplier_reference,'REF');close(s);
});
test('S15 07: erected scaffold retains removal obligation and complaints',()=>{
 const s=store();add(s,'ScaffoldBookings',{id:'SCA',job_id:'J-s15-clean',status:'Erected',erect_actual_at:new Date('2026-11-01T10:00:00Z'),revision:1,version:1});cancel(s);assert.equal(s.get('ScaffoldBookings','SCA').status,'Erected');assert.equal(s.get('ScaffoldBookings','SCA').revision,2);assert.ok(s.list('Tasks').some(t=>t.template_code==='S15-CAN-STRIP'));assert.throws(()=>close(s),/confirmation outstanding/);
 const t=s.list('Tasks').find(t=>t.template_code==='S15-CAN-STRIP');execute('Resolve',input(s,'STRIP',{task_id:t.id,task_version:1,confirmed_revision:2,outcome:'Confirmed',evidence_reference:'actual-removal-proof',actual_date:'2026-11-05'}),s);assert.equal(s.get('ScaffoldBookings','SCA').strip_actual_at,'2026-11-05');
});
test('S15 08: Calendar IDs retained, unsent actions suppressed, uncertain sends not declared cancelled',()=>{
 const s=store();add(s,'CalendarLinks',{id:'CL',job_id:'J-s15-clean',allocation_id:'ALLOC-s15-roof',calendar_id:'CAL',external_event_id:'EVENT',status:'Active',entity_revision:1,outbox_id:'OLD',version:1});add(s,'Outbox',{id:'OLD',status:'Pending',attempt_count:0,external_id:null});add(s,'Communications',{id:'COM',job_id:'J-s15-clean',status:'Queued',outbox_id:'UNKNOWN',version:1});add(s,'Outbox',{id:'UNKNOWN',status:'Processing',attempt_count:1});cancel(s);assert.equal(s.get('Outbox','OLD').status,'Cancelled');assert.equal(s.get('Outbox','UNKNOWN').status,'NeedsReview');assert.equal(s.get('CalendarLinks','CL').external_event_id,'EVENT');assert.equal(s.get('CalendarLinks','CL').status,'Error');assert.ok(s.list('Outbox').some(o=>o.action_type==='CalendarCancel'&&o.status==='NeedsReview'));assert.throws(()=>close(s),/confirmation outstanding/);
});
test('S15 09: paid invoice, final invoice, commissioning and handover stay immutable; late cancellation needs review',()=>{
 const s=store();s.update('Jobs','J-s15-clean',{operational_complete_at:'2026-10-01'});for(const [t,r]of [['InvoiceStages',{id:'INV',job_id:'J-s15-clean',stage:'final',source_status:'AUTHORISED',xero_invoice_id:'XERO',gross_pence:123}],['Payments',{id:'PAY',invoice_stage_id:'INV',amount_pence:123}],['CommissioningSubmissions',{id:'CS',job_id:'J-s15-clean',status:'Accepted'}],['Handover',{id:'HO',job_id:'J-s15-clean',sent_at:'2026-10-01'}]])add(s,t,r);
 const names=['InvoiceStages','Payments','CommissioningSubmissions','Handover'],before=names.map(t=>s.list(t));assert.equal(cancel(s).review,true);names.forEach((t,i)=>assert.deepEqual(s.list(t),before[i]));assert.ok(s.list('Tasks').some(t=>t.template_code==='S15-CAN-XERO'&&t.status==='Blocked'));close(s);assert.throws(()=>reopen(s),/risk review/);reopen(s,{risk_review:'Explicit review of historical performed work; no reversal'});names.forEach((t,i)=>assert.deepEqual(s.list(t),before[i]));
});
test('S15 10: closure requires explicit owned tracking; reinstatement creates fresh revision and retains cancellation audit',()=>{
 const s=store();assert.throws(()=>reopen(s),/only Cancelled/);cancel(s);assert.throws(()=>execute('Close',input(s,'BAD-CLOSE'),s),/explicitly tracked/);close(s);reopen(s);const job=s.get('Jobs','J-s15-clean');assert.equal(job.workflow_stage,'Prebooking');assert.equal(job.job_id,'SS-S15C-LEAN');assert.equal(job.cancellation_at,null);assert.equal(s.get('WorkPackages','WP-s15-roof').status,'Cancelled');const fresh=s.list('WorkPackages').find(w=>w.id!=='WP-s15-roof');assert.equal(fresh.status,'Unscheduled');assert.equal(fresh.parent_package_id,'WP-s15-roof');assert.equal(s.list('Allocations').length,1);assert.ok(s.list('AuditEvents').some(a=>a.action==='S15Cancel'&&JSON.parse(a.after_json).cancellation_reason));const before=copy(s.tables);const plan=JSON.parse(s.get('CommitJournal','CJ-S15-REOPEN').changes_json);assert.equal(execute('Reinstate',plan.input,s).replay,true);assert.deepEqual(s.tables,before);
});
test('S15 11: interrupted writes recover every operation once and block interleaving commands',()=>{
 for(const stop of [1,3,7,13,22]){const s=store(),ins=s.insert.bind(s),upd=s.update.bind(s);let writes=0,failed=false;function fail(){if(++writes===stop){failed=true;throw new Error('injected failure');}}s.insert=(...a)=>{fail();return ins(...a);};s.update=(...a)=>{fail();return upd(...a);};try{cancel(s);}catch(e){assert.match(e.message,/injected/);}s.insert=ins;s.update=upd;if(failed&&s.list('CommitJournal').length)assert.throws(()=>execute('Close',input(s,'INTERLEAVE'),s),/pending job journal/);cancel(s);assert.equal(s.get('Jobs','J-s15-clean').workflow_stage,'CancellationInProgress');assert.equal(s.list('CommitJournal')[0].state,'Committed');assert.equal(new Set(s.list('AuditEvents').map(a=>a.id)).size,s.list('AuditEvents').length);}
});
test('S15 12: recovery refuses concurrent entity edits; no silent overwrite',()=>{
 const s=store(),ins=s.insert.bind(s);let injected=false;s.insert=(t,r)=>{if(t==='AuditEvents'&&!injected){injected=true;throw new Error('interrupt');}return ins(t,r);};assert.throws(()=>cancel(s),/interrupt/);s.insert=ins;s.update('Jobs','J-s15-clean',{version:99,cancellation_reason:'intervening change'});assert.throws(()=>cancel(s),/RECOVERY_REQUIRED/);assert.equal(s.get('Jobs','J-s15-clean').version,99);
});
test('S15 13: all modes preflight; restore refuses unexpected state and is rerunnable',()=>{
 const s=store();setModes(s,false);s.update('ReleaseModes','RM-FN20',{target_release:'R2'});const before=copy(s.tables);assert.throws(()=>setModes(s,true),/unexpected/);assert.deepEqual(s.tables,before);assert.throws(()=>setModes(s,false),/unexpected/);s.update('ReleaseModes','RM-FN20',{target_release:'R1'});setModes(s,true);cancel(s);setModes(s,false);setModes(s,false);for(const id of core.S15_ENABLED){const r=s.list('ReleaseModes').find(r=>r.function_id===id);assert.equal(r.mode,'Disabled');assert.equal(r.authorised_job_scope,'None');assert.equal(r.target_release,'R1');}assert.throws(()=>cancel(s),/pilot mode/);
});
test('S15 14: exact DEV, synthetic job, role and downstream release refusal',()=>{
 for(const alter of [s=>s.getSheetId=()=>'wrong',s=>s.getEnvironment=()=>'TEST',s=>s.update('Jobs','J-s15-clean',{pilot_job:false}),s=>s.update('Jobs','J-s15-clean',{source_system:'S13'}),s=>s.update('People','PERSON-s15-office',{role:'Installer'}),s=>s.update('ReleaseModes','RM-FN09',{target_release:'R1'})]){const s=store();alter(s);const before=copy(s.tables);assert.throws(()=>cancel(s),/S15_REFUSED/);assert.deepEqual(s.tables,before);}
 for(const release of ['R1','R2','R3','R4']){const s=store();s.update('Jobs','J-s15-clean',{release_scope:release});assert.equal(cancel(s).ok,true);}
});
test('S15 15: London dates cover date-only, ISO, Date and BST rollover',()=>{
 assert.equal(date('2026-11-01'),'2026-11-01');assert.equal(date(new Date('2026-07-01T23:30:00Z')),'2026-07-02');assert.equal(date('2026-07-01T23:30:00Z'),'2026-07-02');assert.throws(()=>date(new Date('invalid')),/DATE_INVALID/);assert.throws(()=>date('2026-02-30'),/DATE_INVALID/);
});
test('S15 16: S06–S13 normal work cannot restart cancellation or bypass reopen review',()=>{
 const s=store();cancel(s);const calls=[()=>require('../s06/gates').createTasksForJob(s.get('Jobs','J-s15-clean'),{},s),()=>require('../s07/ordering').createOrderForJob('J-s15-clean',s),()=>require('../s08/picking').executePick('J-s15-clean',s),()=>require('../s09/scaffold').createScaffoldBooking('J-s15-clean',s),()=>require('../s10/operations').approveOperationalCompletion('J-s15-clean','PERSON-s15-office',s),()=>require('../s11/planner').planWorkPackage({job_id:'J-s15-clean'},s),()=>require('../s12/commissioning').createHandover(s,'J-s15-clean'),()=>require('../s13/payments').processJobPayments('J-s15-clean',s),()=>require('../s13/payments').createGHLTask(s,'J-s15-clean')];
 const before=copy(s.tables);for(const fn of calls)assert.throws(fn,/S15_REVIEW/);assert.deepEqual(s.tables,before);close(s);reopen(s);for(const fn of calls)assert.throws(fn,/S15_REVIEW/);
});
test('S15 17: all S01–S15 bundles parse together; S15 globals namespaced and no outbound/delete capability',()=>{
 const files=fs.readdirSync('apps-script',{recursive:true}).filter(f=>/\.(gs|js)$/.test(f));const prior=files.filter(f=>!f.startsWith('s15/')).map(f=>fs.readFileSync('apps-script/'+f,'utf8')).join('\n');const s15=fs.readFileSync('apps-script/s15/S15Cancellation.js','utf8');new vm.Script(prior+'\n'+s15);
 for(const m of s15.matchAll(/^(?:function|const|let|var)\s+([\w$]+)/gm))assert.match(m[1],/^(?:S15_|_s15|restoreS15|runS15)/);
 assert.doesNotMatch(s15,/CalendarApp|UrlFetchApp|fetch\(|deleteRow|deleteSheet|GmailApp|MailApp|https:\/\//);
});
test('S15 18: zero-arg DEV smoke with real header adapter reruns; unknown header and environment refused',()=>{
 const {ctx,grids}=cloud();for(const fn of ['restoreS15SafeState','runS15FixtureDryRun','runS15FixtureApply','runS15FixtureValidate','runS15EnableFunctionsForSyntheticTest','runS15HappyPathTest','runS15HappyPathTest','restoreS15SafeState']){const r=ctx[fn]();assert.equal(r.pass,true,fn+': '+JSON.stringify(r));}
 grids.Jobs[0][1]='bad';assert.equal(ctx.runS15FixtureApply().pass,false);ctx.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify({environment:'TEST'})})};assert.equal(ctx.restoreS15SafeState().pass,false);
});
