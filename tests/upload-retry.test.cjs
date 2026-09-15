/* AppSheet upload-availability race: bounded in-call wait + Outbox-backed bounded retry (DEV only). */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const schema=require('../schema/tables.json'),seed=require('../schema/config-seed.json');
const retry=require('../r1-appsheet/upload-retry.js'),core=require('../r1-appsheet/adapter.js');
const DEV=core.R1A_BOUND_DEV_SHEET_ID;
const T0=Date.parse('2026-09-13T16:52:10.000Z');
const PATH='DEVTaskEvidenceAttachRequests_Images/bc50e7af.evidence_path.165204.png';

function memStore(sheetId=DEV){
  const tables={Outbox:[],CommitJournal:[]};
  const copy=x=>structuredClone(x);
  return{tables,getSheetId:()=>sheetId,getEnvironment:()=> 'DEV',list:n=>copy(tables[n]||[]),get:(n,id)=>copy((tables[n]||[]).find(x=>x.id===id)||null),
    insert(n,r){if((tables[n]||[]).some(x=>x.id===r.id))throw Error('duplicate '+r.id);const t=schema.tables.find(t=>t.name===n);for(const k of Object.keys(r))assert.ok(t.columns.some(c=>c.name===k),n+'.'+k);for(const c of t.columns)if(c.required)assert.ok(r[c.name]!==undefined&&r[c.name]!==null,n+'.'+c.name+' required');(tables[n]||(tables[n]=[])).push(copy(r));},
    update(n,id,p){const row=(tables[n]||[]).find(x=>x.id===id);if(!row)throw Error('missing '+id);Object.assign(row,copy(p));},withLock:fn=>fn()};
}
function attachRow(extra={}){return{id:'bc50e7af',command_id:'bc50e7af',task_id:'TASK-mtzl08pa-vpsvdn',expected_version:2,evidence_path:PATH,submitted_by:'tanya@example.test',submitted_at:'2026-09-13T16:52:04.000Z',status:'Ready',result_status:'',result_message:'',...extra};}
function harness(rowsByTable,opts={}){
  const store=memStore(opts.sheetId);let now=T0;const calls=[],results=[];let outcome=opts.outcome||(()=>{const e=new Error('R1C_UPLOAD_PENDING');e.code='R1C_UPLOAD_PENDING';e.retryable=true;throw e;});
  const deps={store,now:()=>new Date(now),readRows:t=>rowsByTable[t]===undefined?null:rowsByTable[t],writeResult:(t,id,s,m,x)=>{results.push({t,id,s,m,x});const r=(rowsByTable[t]||[]).find(r=>r.id===id);if(!r||!('result_status' in r))return false;r.result_status=s;r.result_message=m;return true;},command:(type,id,actor)=>{calls.push({type,id,actor});return outcome(type,id,actor);}};
  return{store,deps,calls,results,advance:ms=>{now+=ms;},setOutcome:fn=>{outcome=fn;},outbox:()=>store.tables.Outbox};
}
const ok=status=>()=>({ok:true,command_type:'TASK_EVIDENCE_ATTACH',actor_id:'P-tanya',result:{status,external_calls:0}});
const fail=code=>()=>{const e=new Error(code);e.code=code;throw e;};

test('UR 01: bot path schedules exactly one bounded retry per request row, preserving identity, without touching the request inputs',()=>{
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
  const err=Object.assign(new Error('R1C_UPLOAD_PENDING'),{code:'R1C_UPLOAD_PENDING',retryable:true,attempts:4});
  const r=retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','Tanya@Example.test',err,h.deps);
  assert.equal(r.scheduled,true);assert.equal(r.attempt,1);assert.equal(r.max_attempts,5);assert.equal(r.next_attempt,new Date(T0+60000).toISOString());
  assert.equal(h.outbox().length,1);const o=h.outbox()[0];
  assert.equal(o.id,'OUT-R1U-bc50e7af');assert.equal(o.idempotency_key,'R1U:DEVTaskEvidenceAttachRequests:bc50e7af');assert.equal(o.action_type,retry.R1U_ACTION);assert.equal(o.status,'RetryDue');assert.equal(o.attempt_count,1);assert.equal(o.correlation_id,'bc50e7af');assert.equal(o.target,'DEVTaskEvidenceAttachRequests/bc50e7af');assert.equal(o.payload_hash,retry._r1uFingerprint('DEVTaskEvidenceAttachRequests',row));
  assert.equal(row.result_status,'UploadPending');assert.match(row.result_message,/retry 2 of 5/);
  /* identity/inputs untouched */
  assert.equal(row.task_id,'TASK-mtzl08pa-vpsvdn');assert.equal(row.expected_version,2);assert.equal(row.evidence_path,PATH);assert.equal(row.submitted_by,'tanya@example.test');assert.equal(row.status,'Ready');
  /* the bot firing again for the same row is idempotent */
  const again=retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',err,h.deps);
  assert.equal(again.scheduled,true);assert.equal(again.outbox_id,'OUT-R1U-bc50e7af');assert.equal(h.outbox().length,1);
  assert.equal(h.calls.length,0,'scheduling never executes the command');
});

test('UR 02: scheduling enforces request-row security and only upload-bearing request types',()=>{
  const h=harness({DEVTaskEvidenceAttachRequests:[attachRow()],DEVNewJobSoldRequests:[{id:'S1',command_id:'S1',submitted_by:'tanya@example.test',status:'Ready'}]});
  const err=fail('R1C_UPLOAD_PENDING');let e;try{err();}catch(x){e=x;}
  assert.throws(()=>retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','ben@example.test',e,h.deps),/R1U_ACTOR_MISMATCH/);
  assert.throws(()=>retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','',e,h.deps),/AUTHENTICATED_EMAIL_REQUIRED/);
  assert.throws(()=>retry._r1uScheduleRetry('SOLD_INTAKE','S1','tanya@example.test',e,h.deps),/R1U_NOT_RETRYABLE/);
  assert.throws(()=>retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','nope','tanya@example.test',e,h.deps),/R1U_REQUEST_NOT_FOUND/);
  assert.throws(()=>retry._r1uScheduleRetry('TASK_COMPLETE','bc50e7af','tanya@example.test',e,h.deps),/R1U_REQUEST_NOT_FOUND/);
  const h2=harness({DEVTaskEvidenceAttachRequests:[attachRow({status:'Draft'})]});
  assert.throws(()=>retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',e,h2.deps),/R1U_REQUEST_NOT_READY/);
  const h3=harness({DEVTaskEvidenceAttachRequests:[attachRow()]},{sheetId:'1-other-sheet'});
  assert.throws(()=>retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',e,h3.deps),/R1U_DEV_ONLY/);
  assert.equal(h.outbox().length,0);assert.equal(h2.outbox().length,0);
});

test('UR 03: first attempt pending then upload visible -> exactly one execution as row.submitted_by, no further attempts',()=>{
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
  retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',null,h.deps);
  let t=retry._r1uTick(h.deps);assert.equal(t.processed.length,0,'not due yet');assert.equal(h.calls.length,0);
  h.advance(60000);h.setOutcome(ok('Attached'));
  t=retry._r1uTick(h.deps);assert.equal(t.processed.length,1);assert.equal(t.processed[0].outcome,'Succeeded');assert.equal(t.processed[0].attempt,2);
  assert.deepEqual(h.calls,[{type:'TASK_EVIDENCE_ATTACH',id:'bc50e7af',actor:'tanya@example.test'}]);
  assert.equal(h.outbox()[0].status,'Succeeded');assert.equal(h.outbox()[0].next_attempt,null);assert.equal(row.result_status,'Succeeded');
  h.advance(3600000);t=retry._r1uTick(h.deps);assert.equal(t.processed.length,0);assert.equal(t.swept.length,0);assert.equal(h.calls.length,1);
});

test('UR 04: bounded repeated pending -> backoff 1/2/4/8/16 min, five attempts total, then explicit R1C_UPLOAD_MISSING NeedsReview',()=>{
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
  retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',null,h.deps);
  const expectedNext=[2,4,8,16];
  for(let attempt=2;attempt<=5;attempt++){
    h.advance(retry.R1U_BACKOFF_MINUTES[attempt-2]*60000);
    const t=retry._r1uTick(h.deps);assert.equal(t.processed.length,1,'attempt '+attempt);assert.equal(t.processed[0].attempt,attempt);
    if(attempt<5){assert.equal(t.processed[0].outcome,'RetryDue');assert.equal(t.processed[0].next_attempt,new Date(T0+(1+expectedNext.slice(0,attempt-1).reduce((a,b)=>a+b,0)-expectedNext[attempt-2]+expectedNext[attempt-2])*60000).toISOString());assert.equal(row.result_status,'UploadPending');}
  }
  const o=h.outbox()[0];assert.equal(o.status,'NeedsReview');assert.equal(o.attempt_count,5);assert.match(o.response_summary,/R1C_UPLOAD_MISSING/);assert.equal(row.result_status,'ActionRequired');assert.equal(row.result_message,'Your uploaded file never arrived. Start a new request and upload the file again.');assert.doesNotMatch(row.result_message,/R1[ACU]_/);assert.equal(h.results.at(-1).x.code,'R1C_UPLOAD_MISSING');assert.equal(h.results.at(-1).x.actorEmail,'tanya@example.test');
  assert.equal(h.calls.length,4,'bot attempt 1 + four backend attempts');
  h.advance(24*3600000);assert.equal(retry._r1uTick(h.deps).processed.length,0);assert.equal(h.calls.length,4,'exhausted item is never retried again');
  assert.equal(retry._r1uStatus(h.deps).by_status.NeedsReview,1);
});

test('UR 05: sweep recovers an existing Ready upload request with no journal and no outbox row (the bc50e7af case) through the normal path',()=>{
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row],DEVTaskCompleteRequests:[
    {id:'TC-journaled',command_id:'CMD-J',task_id:'T',expected_version:1,completion_note:'x',evidence_path:'p/a.png',evidence_id:'',submitted_by:'tanya@example.test',submitted_at:'2026-09-13T10:00:00.000Z',status:'Ready',result_status:'',result_message:''},
    {id:'TC-noupload',command_id:'CMD-N',task_id:'T',expected_version:1,completion_note:'x',evidence_path:'',evidence_id:'',submitted_by:'tanya@example.test',submitted_at:'2026-09-13T10:00:00.000Z',status:'Ready',result_status:'',result_message:''},
    {id:'TC-draft',command_id:'CMD-D',task_id:'T',expected_version:1,completion_note:'x',evidence_path:'p/b.png',evidence_id:'',submitted_by:'tanya@example.test',submitted_at:'2026-09-13T10:00:00.000Z',status:'Draft',result_status:'',result_message:''},
    {id:'TC-noemail',command_id:'CMD-E',task_id:'T',expected_version:1,completion_note:'x',evidence_path:'p/c.png',evidence_id:'',submitted_by:'P-tanya',submitted_at:'2026-09-13T10:00:00.000Z',status:'Ready',result_status:'',result_message:''}
  ]});
  h.store.insert('CommitJournal',{id:'CJ-R1A-CMD-J',commit_id:'R1A-CMD-J',state:'Committed',command_id:'CMD-J',entity_type:'Tasks',entity_id:'T',expected_version:1,changes_json:'{}',prepared_at:'2026-09-13T10:00:01.000Z',committed_at:'2026-09-13T10:00:02.000Z',created_at:'2026-09-13T10:00:01.000Z'});
  h.setOutcome(ok('Attached'));
  const t=retry._r1uTick(h.deps);
  assert.deepEqual(t.swept.map(s=>s.row_id),['bc50e7af']);assert.equal(t.processed.length,1);assert.equal(t.processed[0].outcome,'Succeeded');assert.equal(t.processed[0].attempt,1);
  assert.deepEqual(h.calls,[{type:'TASK_EVIDENCE_ATTACH',id:'bc50e7af',actor:'tanya@example.test'}]);
  assert.equal(h.outbox().length,1);assert.equal(row.result_status,'Succeeded');
  assert.equal(retry._r1uTick(h.deps).swept.length,0,'sweep is idempotent');
});

test('UR 06: request row edited after scheduling (inputs or submitter) is refused, never executed',()=>{
  for(const edit of [{evidence_path:'other/file.png'},{submitted_by:'ben@example.test'},{expected_version:3},{task_id:'TASK-other'}]){
    const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
    retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',null,h.deps);
    Object.assign(row,edit);h.advance(60000);h.setOutcome(ok('Attached'));
    const t=retry._r1uTick(h.deps);assert.equal(t.processed[0].outcome,'NeedsReview');assert.match(t.processed[0].summary,/R1U_REQUEST_CHANGED/);assert.equal(h.calls.length,0,JSON.stringify(edit));
  }
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
  retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',null,h.deps);
  row.status='Cancelled';h.advance(60000);const t=retry._r1uTick(h.deps);assert.match(t.processed[0].summary,/R1U_REQUEST_NOT_READY/);assert.equal(h.calls.length,0);
});

test('UR 07: non-pending errors are final (no retry loop); replay of an already committed command counts as success',()=>{
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
  retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',null,h.deps);
  h.advance(60000);h.setOutcome(fail('R1A_STALE_VERSION'));
  let t=retry._r1uTick(h.deps);assert.equal(t.processed[0].outcome,'NeedsReview');assert.match(t.processed[0].summary,/R1A_STALE_VERSION/);assert.equal(row.result_status,'ActionRequired');assert.doesNotMatch(row.result_message,/R1[ACU]_/);
  h.advance(3600000);assert.equal(retry._r1uTick(h.deps).processed.length,0);assert.equal(h.calls.length,1);
  const row2=attachRow({id:'r2',command_id:'r2'}),h2=harness({DEVTaskEvidenceAttachRequests:[row2]});
  retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','r2','tanya@example.test',null,h2.deps);h2.advance(60000);h2.setOutcome(ok('Replayed'));
  t=retry._r1uTick(h2.deps);assert.equal(t.processed[0].outcome,'Succeeded');assert.match(t.processed[0].summary,/replay/);
});

test('UR 08: a stalled Processing claim is reclaimed after the stall window; a fresh claim is not',()=>{
  const row=attachRow(),h=harness({DEVTaskEvidenceAttachRequests:[row]});
  retry._r1uScheduleRetry('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test',null,h.deps);
  h.store.update('Outbox','OUT-R1U-bc50e7af',{status:'Processing',attempt_count:2,next_attempt:new Date(T0+retry.R1U_STALLED_MS).toISOString()});
  h.advance(60000);assert.equal(retry._r1uTick(h.deps).processed.length,0);
  h.advance(retry.R1U_STALLED_MS);h.setOutcome(ok('Attached'));const t=retry._r1uTick(h.deps);assert.equal(t.processed.length,1);assert.equal(t.processed[0].attempt,3);assert.equal(t.processed[0].outcome,'Succeeded');
});

test('UR 09: installer and goods-in rows map to their command types; invalid discriminators are ineligible',()=>{
  const inst={id:'I1',command_id:'CI1',command_type:'IW_PROGRESS',job_id:'J',work_package_id:'WP',expected_version:1,submitted_by:'installer@example.test',status:'Ready',evidence_path:'DEVInstallerCommandRequests_Images/I1.png'};
  const goods={id:'G1',command_id:'CG1',job_id:'JM',delivery_id:'DEL',expected_version:1,submitted_by:'store@example.test',status:'Ready',line_count:1,delivery_note_reference:'DN',delivery_note_path:'DEVGoodsInRequests_Files/G1.pdf'};
  const bad={...inst,id:'I2',command_id:'CI2',command_type:'GOODS_IN_RECEIVE'};
  const h=harness({DEVInstallerCommandRequests:[inst,bad],DEVGoodsInRequests:[goods]});h.setOutcome(ok('InProgress'));
  const t=retry._r1uTick(h.deps);
  assert.deepEqual(t.swept.map(s=>s.command_type).sort(),['GOODS_IN_RECEIVE','IW_PROGRESS']);
  assert.deepEqual(h.calls.map(c=>c.type+':'+c.id+':'+c.actor).sort(),['GOODS_IN_RECEIVE:G1:store@example.test','IW_PROGRESS:I1:installer@example.test']);
  assert.equal(retry._r1uEligibility('DEVInstallerCommandRequests',bad),'R1U_COMMAND_TYPE_INVALID');
  assert.equal(retry._r1uEligibility('DEVStockCommandRequests',{id:'x',status:'Ready'}),'R1U_TABLE_NOT_RETRYABLE');
  assert.equal(retry._r1uScheduleRetry('IW_PROGRESS','I1','installer@example.test',null,h.deps).scheduled,false,'already succeeded: nothing new scheduled');
});

/* ---- generated standalone bundle: resolver wait + end-to-end bot -> retry -> PRE02 attach ---- */
function bundleFixture(){
  const c=vm.createContext({console:{log(){}},Intl,Date,JSON,Number,Object,Array,String,Math,RegExp,Error});
  vm.runInContext(fs.readFileSync('standalone-bridge/AppSheetBridge.js','utf8'),c);
  const tables=Object.fromEntries(schema.tables.map(t=>[t.name,[]]));
  for(const n of ['Settings','TaskTemplates','ReleaseModes','People','PersonRoles'])for(const r of seed[n]||[])tables[n].push({...r,version:1});
  const fn01=tables.ReleaseModes.find(r=>r.function_code==='FN-01'||r.id==='RM-FN01');fn01.mode='Automated';fn01.authorised_job_scope='Pilot';
  tables.People.push({id:'P-tanya',email:'tanya@example.test',active:true,display_name:'Tanya',role:'Office',version:1});
  tables.PersonRoles.push({id:'role-tanya',person_id:'P-tanya',role:'Office',active:true,version:1});
  tables.Jobs.push({id:'J-TONY',job_id:'SS-TONY',display_name:'Tony',pilot_job:true,release_scope:'R1',workflow_stage:'Booked',contract_status:'NotSent',contract_id:'SIGNABLE-TONY-UR',contract_evidence_id:'',contract_signed_at:'',original_gross_pence:500000,version:3});
  tables.Tasks.push({id:'TASK-mtzl08pa-vpsvdn',job_id:'J-TONY',template_code:'PRE02',owner_id:'P-tanya',backup_id:'',status:'Complete',completed_at:'2026-09-12T09:00:00.000Z',completed_by:'P-tanya',completion_note:'Signed before evidence path existed',evidence_id:'',revision_required:false,version:2});
  const grids=Object.fromEntries(schema.tables.map(t=>{const h=t.columns.map(c=>c.name);return[t.name,[h,...tables[t.name].map(r=>h.map(k=>r[k]??''))]];}));
  grids.DEVTaskEvidenceAttachRequests=[['id','command_id','task_id','expected_version','evidence_path','submitted_by','submitted_at','status','result_status','result_message'],['bc50e7af','bc50e7af','TASK-mtzl08pa-vpsvdn',2,PATH,'tanya@example.test','2026-09-13T16:52:04.000Z','Ready','','']];
  let held=false,available=false,lookups=0;const sleeps=[];
  const sheets={};
  function sheet(n){return sheets[n]||(sheets[n]={getName:()=>n,getLastColumn:()=>grids[n][0]?.length||0,getLastRow:()=>grids[n].length,getMaxRows:()=>1000,getMaxColumns:()=>100,getRange(row,col,height=1,width=1){return{getValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>grids[n][row-1+i]?.[col-1+j]??''));},setValues(v){v.forEach((r,i)=>{grids[n][row-1+i]=grids[n][row-1+i]||[];r.forEach((x,j)=>grids[n][row-1+i][col-1+j]=x);});},setValue(x){grids[n][row-1]=grids[n][row-1]||[];grids[n][row-1][col-1]=x;}};}});}
  const ss={getId:()=>DEV,getSheets:()=>Object.keys(grids).map(sheet)};
  c.SpreadsheetApp={openById:id=>{assert.equal(id,DEV);return ss;},getActiveSpreadsheet:()=>ss,flush(){}};
  c.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify({environment:'DEV',sheetId:DEV,evidenceFolderId:'DEV-UPLOADS'})})};
  c.Session={getActiveUser:()=>({getEmail:()=> ''}),getEffectiveUser:()=>({getEmail:()=> 'owner@test.invalid'})};
  c.LockService={getScriptLock:()=>({waitLock(){assert.equal(held,false,'ScriptLock re-entered');held=true;},releaseLock(){assert.equal(held,true);held=false;}})};
  c.Utilities={sleep:ms=>sleeps.push(ms)};
  c.Logger={log(){}};
  const iter=values=>{let i=0;return{hasNext:()=>i<values.length,next:()=>values[i++]};};
  const file={getId:()=> 'DRIVE-bc50e7af',getName:()=> 'bc50e7af.evidence_path.165204.png',getMimeType:()=> 'image/png',isTrashed:()=>false};
  c.DriveApp={getFolderById(id){assert.equal(id,'DEV-UPLOADS');lookups++;return{getFoldersByName:name=>iter(name==='DEVTaskEvidenceAttachRequests_Images'&&available?[{getFilesByName:name=>iter(name==='bc50e7af.evidence_path.165204.png'?[file]:[])}]:[]),getFilesByName:()=>iter([])};}};
  for(const service of ['CalendarApp','UrlFetchApp','MailApp','GmailApp'])c[service]=new Proxy({},{get(){throw Error('EXTERNAL FORBIDDEN '+service);}});
  const rows=n=>{const [h,...body]=grids[n];return body.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));};
  return{c,grids,rows,sleeps,lookups:()=>lookups,resetLookups:()=>{lookups=0;sleeps.length=0;},setAvailable:v=>{available=v;}};
}

test('UR 10: shared resolver waits in-call (bounded), retries only pending, never path/ambiguity errors',()=>{
  const f=bundleFixture();
  f.setAvailable(true);assert.equal(f.c._r1cResolveUpload(PATH).drive_file_id,'DRIVE-bc50e7af');assert.equal(f.lookups(),1);assert.deepEqual(f.sleeps,[]);
  f.resetLookups();f.setAvailable(false);let n=0;const flip={sleep:ms=>{f.sleeps.push(ms);if(++n===1)f.setAvailable(true);}};
  assert.equal(f.c._r1cResolveUpload(PATH,flip).drive_file_id,'DRIVE-bc50e7af');assert.equal(f.lookups(),2);assert.deepEqual(f.sleeps,[2000]);
  f.resetLookups();f.setAvailable(false);
  try{f.c._r1cResolveUpload(PATH);assert.fail('expected pending');}catch(e){assert.equal(e.code,'R1C_UPLOAD_PENDING');assert.equal(e.retryable,true);assert.equal(e.attempts,4);}
  assert.equal(f.lookups(),4);assert.deepEqual(f.sleeps,[2000,4000,6000]);
  f.resetLookups();assert.throws(()=>f.c._r1cResolveUpload(PATH,{wait:false}),/UPLOAD_PENDING/);assert.equal(f.lookups(),1);assert.deepEqual(f.sleeps,[]);
  f.resetLookups();for(const p of ['../secret','/root/file','https://drive.google.com/file','a/%2e%2e/f','a\\f'])assert.throws(()=>f.c._r1cResolveUpload(p),/PATH_INVALID/);assert.equal(f.lookups(),0);assert.deepEqual(f.sleeps,[]);
});

test('UR 11: generated bridge end-to-end — bot receives pending once, backend retry attaches evidence exactly once, replay safe, no lock re-entry',()=>{
  const f=bundleFixture();
  let r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test'));
  assert.equal(r.ok,false);assert.equal(r.error,'R1C_UPLOAD_PENDING');assert.equal(r.retryable,true);assert.equal(r.retry.scheduled,true);assert.equal(r.retry.outbox_id,'OUT-R1U-bc50e7af');assert.equal(r.retry.attempt,1);
  assert.equal(f.lookups(),4);assert.deepEqual(f.sleeps,[2000,4000,6000]);
  assert.equal(f.rows('Outbox').length,1);assert.equal(f.rows('Outbox')[0].status,'RetryDue');
  assert.equal(f.rows('Evidence').length,0);assert.equal(f.rows('CommitJournal').length,0);assert.equal(f.rows('TaskEvents').length,0);assert.equal(f.rows('AuditEvents').length,0);
  const req=()=>f.rows('DEVTaskEvidenceAttachRequests')[0];
  assert.equal(req().result_status,'UploadPending');assert.equal(req().evidence_path,PATH);assert.equal(req().submitted_by,'tanya@example.test');assert.equal(req().expected_version,2);
  /* bot fires again before the retry is due: still pending, still one outbox row */
  r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test'));assert.equal(r.error,'R1C_UPLOAD_PENDING');assert.equal(f.rows('Outbox').length,1);
  /* not yet due -> tick does nothing */
  let t=f.c.runR1URetryUploadRequests();assert.equal(t.ok,true);assert.equal(t.processed.length,0);assert.equal(t.swept.length,0);
  /* time passes (simulated by the schedule reaching its next_attempt); the file has landed */
  f.grids.Outbox[1][f.grids.Outbox[0].indexOf('next_attempt')]='2026-09-13T16:53:10.000Z';f.setAvailable(true);f.resetLookups();
  t=f.c.runR1URetryUploadRequests();
  assert.equal(t.processed.length,1,JSON.stringify(t));assert.equal(t.processed[0].outcome,'Succeeded');assert.equal(t.processed[0].attempt,2);assert.equal(f.lookups(),1);assert.deepEqual(f.sleeps,[]);
  const ev=f.rows('Evidence');assert.equal(ev.length,1);assert.equal(ev[0].drive_file_id,'DRIVE-bc50e7af');assert.equal(ev[0].category,'Contract');assert.equal(ev[0].job_id,'J-TONY');
  const task=f.rows('Tasks').find(x=>x.id==='TASK-mtzl08pa-vpsvdn');assert.equal(task.evidence_id,ev[0].id);assert.equal(task.status,'Complete');assert.equal(task.completed_at,'2026-09-12T09:00:00.000Z');assert.equal(task.version,3);
  const job=f.rows('Jobs').find(x=>x.id==='J-TONY');assert.equal(job.contract_status,'Signed');assert.equal(job.contract_evidence_id,ev[0].id);assert.equal(job.original_gross_pence,500000);
  assert.equal(f.rows('CommitJournal').filter(j=>j.id==='CJ-R1A-bc50e7af'&&j.state==='Committed').length,1);
  assert.equal(f.rows('TaskEvents').filter(e=>e.action==='EvidenceAttach').length,1);assert.equal(f.rows('AuditEvents').filter(a=>a.id==='AE-R1A-bc50e7af').length,1);
  assert.equal(req().result_status,'Succeeded');assert.equal(f.rows('Outbox')[0].status,'Succeeded');
  /* replay from the bot and from the tick: no duplicate Evidence, TaskEvents, audit or contract side effects */
  const snapshot=JSON.stringify([f.grids.Evidence,f.grids.TaskEvents,f.grids.AuditEvents,f.grids.Jobs,f.grids.Tasks,f.grids.CommitJournal]);
  r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test'));assert.equal(r.ok,true);assert.equal(r.result.status,'Replayed');
  t=f.c.runR1URetryUploadRequests();assert.equal(t.processed.length,0);assert.equal(t.swept.length,0);
  assert.equal(JSON.stringify([f.grids.Evidence,f.grids.TaskEvents,f.grids.AuditEvents,f.grids.Jobs,f.grids.Tasks,f.grids.CommitJournal]),snapshot);
  /* security: a different actor cannot use the same row; status report is available */
  r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','ben@example.test'));assert.equal(r.ok,false);assert.match(r.error,/ACTOR_MISMATCH/);assert.equal(r.retry,undefined);
  assert.equal(f.c.runR1UUploadRetryStatus().by_status.Succeeded,1);
});

test('UR 12: generated bridge sweep recovers a pre-existing pending row that the bot already gave up on, and a truly missing upload ends in review',()=>{
  const f=bundleFixture();
  /* the row exists, no outbox row, no journal: the bot ran before this module existed */
  f.setAvailable(true);
  let t=f.c.runR1URetryUploadRequests();
  assert.equal(JSON.stringify(t.swept.map(s=>s.row_id)),'["bc50e7af"]');assert.equal(t.processed.length,1);assert.equal(t.processed[0].outcome,'Succeeded');assert.equal(t.processed[0].attempt,1);
  assert.equal(f.rows('Evidence').length,1);assert.equal(f.rows('DEVTaskEvidenceAttachRequests')[0].result_status,'Succeeded');
  const g=bundleFixture();const nextCol=g.grids.Outbox[0]?.indexOf('next_attempt');
  for(let attempt=1;attempt<=5;attempt++){
    if(attempt>1)g.grids.Outbox[1][nextCol]='2026-09-13T16:53:10.000Z';
    t=g.c.runR1URetryUploadRequests();assert.equal(t.processed.length,1);assert.equal(t.processed[0].attempt,attempt);
    assert.equal(t.processed[0].outcome,attempt<5?'RetryDue':'NeedsReview');
  }
  assert.match(g.rows('Outbox')[0].response_summary,/R1C_UPLOAD_MISSING/);assert.equal(g.rows('DEVTaskEvidenceAttachRequests')[0].result_status,'ActionRequired');
  assert.equal(g.rows('Evidence').length,0);assert.equal(g.rows('CommitJournal').length,0);
  g.grids.Outbox[1][nextCol]='2026-09-13T16:53:10.000Z';assert.equal(g.c.runR1URetryUploadRequests().processed.length,0,'exhausted item stays in review');
});

test('UR 13: generated bridge persists staff-facing feedback on the request row; an Apps Script return is not business success',()=>{
  const f=bundleFixture(),g=f.grids.DEVTaskEvidenceAttachRequests,col=k=>g[0].indexOf(k),row=()=>f.rows('DEVTaskEvidenceAttachRequests')[0];
  g[0].push('result_code','result','result_at');g[1].push('','','');
  g[1][col('expected_version')]=1;
  const raw=f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test');
  assert.equal(typeof raw,'string','the Apps Script function returns normally (execution Success) even though the command was refused');
  let r=JSON.parse(raw);
  assert.equal(r.ok,false);assert.equal(r.error,'R1A_STALE_VERSION');
  assert.deepEqual(JSON.parse(JSON.stringify(r.feedback)),{status:'ActionRequired',heading:'ACTION REQUIRED',message:'This record changed after you opened the form. Go back, refresh, and try again.',code:'R1A_STALE_VERSION'});
  assert.equal(r.request_result.written,true);
  assert.equal(row().result_status,'ActionRequired');assert.equal(row().result_message,r.feedback.message);assert.doesNotMatch(row().result_message,/R1[ACU]_/);
  assert.equal(row().result_code,'R1A_STALE_VERSION');assert.equal(JSON.parse(row().result).ok,false);assert.equal(Object.prototype.toString.call(row().result_at),'[object Date]');
  assert.equal(row().status,'Ready','submission status is an input and is never rewritten');assert.equal(row().evidence_path,PATH);assert.equal(row().expected_version,1);
  assert.equal(f.lookups(),0);assert.equal(f.rows('CommitJournal').length,0);assert.equal(f.rows('Outbox').length,0);assert.equal(f.rows('Evidence').length,0);
  /* another user firing the bot for Tanya's row cannot overwrite her result */
  r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','ben@example.test'));
  assert.match(r.error,/ACTOR_MISMATCH/);assert.equal(r.request_result.written,false);assert.equal(r.request_result.reason,'NOT_ROW_OWNER');assert.equal(row().result_code,'R1A_STALE_VERSION');
  /* corrected and fired again: success replaces the non-final result */
  g[1][col('expected_version')]=2;f.setAvailable(true);
  r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test'));
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.result.status,'Attached');assert.equal(r.feedback.status,'Succeeded');assert.equal(r.request_result.written,true);
  assert.equal(row().result_status,'Succeeded');assert.equal(row().result_message,'Contract evidence added.');assert.equal(row().result_code,'');
  const at=row().result_at.getTime();
  /* exact replay keeps the recorded success and causes no duplicate effects */
  r=JSON.parse(f.c.appSheetR1CommandFromRequestRow('TASK_EVIDENCE_ATTACH','bc50e7af','tanya@example.test'));
  assert.equal(r.result.status,'Replayed');assert.equal(r.feedback.status,'Succeeded');assert.equal(r.request_result.written,false);assert.equal(r.request_result.reason,'FINAL_RESULT_PRESERVED');
  assert.equal(row().result_at.getTime(),at);assert.equal(row().result_message,'Contract evidence added.');
  assert.equal(f.rows('Evidence').length,1);assert.equal(f.rows('CommitJournal').filter(j=>j.state==='Committed').length,1);assert.equal(f.rows('TaskEvents').filter(e=>e.action==='EvidenceAttach').length,1);
  /* JSON command path returns the same feedback vocabulary */
  const j=JSON.parse(f.c.appSheetR1Command(JSON.stringify({command_id:'JSON-1',command_type:'TASK_COMPLETE',task_id:'TASK-mtzl08pa-vpsvdn',expected_version:3,payload:{completion_note:'x'}})));
  assert.equal(j.ok,false);assert.equal(j.feedback.status,'Failed');assert.equal(j.feedback.code,j.error);assert.doesNotMatch(j.feedback.message,/R1[ACU]_/);
});

test('UR 14: sweep never re-runs a row whose bot call already recorded a refusal (live PRE02 attach row 1296b8b1 before the fix)',()=>{
  const rows=[
    attachRow({id:'1296b8b1',command_id:'1296b8b1',result_status:'ActionRequired',result_message:'Contract evidence can only be added to a completed contract task.'}),
    attachRow({id:'failed-row',command_id:'failed-row',result_status:'Failed'}),
    attachRow({id:'never-reached',command_id:'never-reached'}),
    attachRow({id:'pending-no-outbox',command_id:'pending-no-outbox',result_status:'UploadPending'})
  ];
  const h=harness({DEVTaskEvidenceAttachRequests:rows});h.setOutcome(ok('Attached'));
  const t=retry._r1uTick(h.deps);
  assert.deepEqual(t.swept.map(x=>x.row_id).sort(),['never-reached','pending-no-outbox']);
  assert.deepEqual(h.calls.map(c=>c.id).sort(),['never-reached','pending-no-outbox']);
  assert.equal(h.outbox().some(o=>o.target.endsWith('/1296b8b1')||o.target.endsWith('/failed-row')),false);
  assert.equal(rows[0].result_status,'ActionRequired');assert.equal(rows[1].result_status,'Failed');
  assert.equal(retry._r1uTick(h.deps).swept.length,0,'second tick sweeps nothing new');
});
