const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../r1-appsheet/adapter.js'),serviceCore=require('../r1-appsheet/services.js');
const payments=require('../s13/payments.js');
global.processJobPayments=payments.processJobPayments;
global.confirmDeposit=payments.confirmDeposit;
const copy=x=>structuredClone(x);
function fixture(email='tanya@example.test'){
 const tables={People:[{id:'P-tanya',email:'tanya@example.test',active:true},{id:'P-hannah',email:'hannah@example.test',active:true},{id:'P-ben',email:'ben@example.test',active:true},{id:'P-installer',email:'installer@example.test',active:true},{id:'P-var',email:'var@example.test',active:true}],PersonRoles:[{person_id:'P-tanya',role:'Office',active:true},{person_id:'P-hannah',role:'Office',active:true},{person_id:'P-ben',role:'Admin',active:true},{person_id:'P-installer',role:'Installer',active:true},{person_id:'P-var',role:'VariationApprover',active:true}],Jobs:[{id:'J-1',pilot_job:true,release_scope:'R1',version:1,salesperson_id:null,workflow_stage:'Booked'},{id:'J-2',pilot_job:true,release_scope:'R1',version:1,salesperson_id:null},{id:'J-N',pilot_job:false,release_scope:'R1',version:1},{id:'J-OPC',pilot_job:true,release_scope:'R1',version:3,salesperson_id:null,workflow_stage:'Aftercare',operational_complete_at:null,archived_at:null},{id:'J-BKG',pilot_job:true,release_scope:'R1',version:2,salesperson_id:null,workflow_stage:'BookingInProgress',archived_at:null},{id:'J-DEP',pilot_job:true,release_scope:'R1',version:4,salesperson_id:null,workflow_stage:'Booked',deposit_bank_confirmed_at:null,archived_at:null}],Tasks:[{id:'T-1',job_id:'J-1',owner_id:'P-tanya',backup_id:null,version:2,status:'Open',revision_required:false,due_at:'2026-09-08'},{id:'T-H',job_id:'J-2',owner_id:'P-hannah',backup_id:null,version:1,status:'Open'},{id:'T-OPC',job_id:'J-OPC',owner_id:'P-tanya',backup_id:null,version:1,status:'Open'},{id:'T-BKG',job_id:'J-BKG',owner_id:'P-tanya',backup_id:null,version:1,status:'Open'},{id:'T-DEP',job_id:'J-DEP',owner_id:'P-tanya',backup_id:null,version:1,status:'Open'}],Issues:[{id:'I-1',job_id:'J-1',office_owner_id:'P-tanya',responsible_person_id:null,responsible_company_id:'CO-1',status:'Open',version:1}],WorkPackages:[{id:'WP-1',job_id:'J-1',planned_start:'2026-09-10',planned_end:'2026-09-11',revision:1,version:1}],InvoiceStages:[{id:'IS-J-DEP-deposit',job_id:'J-DEP',stage:'deposit',status:'Pending',gross_pence:120000,version:1}],ReleaseModes:[{function_id:'FN-01',target_release:'R1',authorised_job_scope:'Pilot',mode:'Automated'},{function_id:'FN-11',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-15',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-17',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-19',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-20',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'}],AuditEvents:[],TaskEvents:[],IssueEvents:[],CommitJournal:[],Calls:[],GHLTasks:[]};
 const store={getSheetId:()=>core.R1A_BOUND_DEV_SHEET_ID,getEnvironment:()=> 'DEV',list:n=>copy(tables[n]||[]),get:(n,id)=>copy((tables[n]||[]).find(x=>x.id===id)||null),insert:(n,r)=>{if((tables[n]||[]).some(x=>x.id===r.id))throw Error('duplicate');(tables[n]||(tables[n]=[])).push(copy(r));},update:(n,id,p)=>{const row=(tables[n]||[]).find(x=>x.id===id);if(!row)throw Error('missing');Object.assign(row,copy(p));},withLock:fn=>fn()};
 const reads={officeHome:()=>({overdue:copy(tables.Tasks),due_today:[],due_soon:[],booking_review:[],unresolved_issues:[],health_alerts:[]}),jobSearch:(s,q)=>{const qq=String(q).toLowerCase();return tables.Jobs.filter(j=>(j.id||'').toLowerCase().indexOf(qq)>=0||(j.job_id||'').toLowerCase().indexOf(qq)>=0).map(j=>({id:j.id,job_id:j.job_id||j.id,display_name:j.display_name||j.id,workflow_stage:j.workflow_stage,release_scope:j.release_scope}));},jobOverview:(s,id)=>({job_id:id}),operationalQueue:(s,q)=>({queue:q,count:2,tasks:copy(tables.Tasks)}),releaseModes:()=>copy(tables.ReleaseModes),systemStatus:()=>({ok:true}),auditHistory:(s,id)=>({job_id:id,events:copy(tables.AuditEvents)}),actionAvailability:(s,id)=>({job_id:id}),taskActionAvailability:(s,id)=>{const t=(tables.Tasks||[]).find(x=>x.id===id);const status=t&&t.status||'Open';return{task_id:id,actions:{complete:{available:['Open','Waiting','InProgress'].includes(status)},reopen:{available:status==='Complete'||status==='NotRequired'}}};}};
 const options={store,config:{environment:'DEV',sheetId:core.R1A_BOUND_DEV_SHEET_ID},actorEmail:()=>email,effectiveUserEmail:()=>'owner@example.test',reads,services:{}};
 return{tables,store,options,adapter:()=>core._r1aCreate(options)};
}
const cmd=(extra={})=>({command_id:'C-1',command_type:'TASK_COMPLETE',task_id:'T-1',expected_version:2,payload:{completion_note:'done'},...extra});
test('unknown command refused',()=>assert.throws(()=>fixture().adapter().command(cmd({command_type:'NOPE'})),/R1A_UNKNOWN_COMMAND/));
test('identity probe reports authoritative Session-derived active/effective identities',()=>{const f=fixture();const r=f.adapter().read({read_type:'IDENTITY_PROBE'});assert.deepEqual(r.data,{environment:'DEV',spreadsheet_id:core.R1A_BOUND_DEV_SHEET_ID,session_active_user_email:'tanya@example.test',session_effective_user_email:'owner@example.test',active_user_maps_to_active_people:true,resolved_person_roles:['Office'],authenticated:true})});
test('identity probe reports blank active identity without authenticating',()=>{const f=fixture('');const r=f.adapter().read({read_type:'IDENTITY_PROBE'});assert.equal(r.data.session_active_user_email,null);assert.equal(r.data.active_user_maps_to_active_people,false);assert.equal(r.data.authenticated,false);assert.deepEqual(r.data.resolved_person_roles,[])});
test('identity probe remains exact-DEV guarded and accepts no client identity field',()=>{const f=fixture();assert.throws(()=>f.adapter().read({read_type:'IDENTITY_PROBE',email:'spoof@example.test'}),/INVALID_FIELDS/);f.options.config.environment='PROD';assert.throws(()=>f.adapter().read({read_type:'IDENTITY_PROBE'}),/DEV_ONLY/)});
test('identity probe refuses unknown People with active email',()=>{const f=fixture('unknown@example.test');const r=f.adapter().read({read_type:'IDENTITY_PROBE'});assert.equal(r.data.session_active_user_email,'unknown@example.test');assert.equal(r.data.active_user_maps_to_active_people,false);assert.equal(r.data.authenticated,false);assert.deepEqual(r.data.resolved_person_roles,[])});
test('identity probe refuses inactive People record',()=>{const f=fixture('tanya@example.test');f.tables.People[0].active=false;const r=f.adapter().read({read_type:'IDENTITY_PROBE'});assert.equal(r.data.session_active_user_email,'tanya@example.test');assert.equal(r.data.active_user_maps_to_active_people,false);assert.equal(r.data.authenticated,false);assert.deepEqual(r.data.resolved_person_roles,[])});
test('identity probe refuses DEV spreadsheet mismatch',()=>{const f=fixture();f.options.config.sheetId='1-wrong-spreadsheet-id';assert.throws(()=>f.adapter().read({read_type:'IDENTITY_PROBE'}),/DEV_ONLY/)});
test('identity probe causes no writes to any operational table',()=>{const f=fixture();const before=JSON.stringify(f.tables);f.adapter().read({read_type:'IDENTITY_PROBE'});const after=JSON.stringify(f.tables);assert.equal(before,after)});
test('unauthenticated command refused',()=>assert.throws(()=>fixture('').adapter().command(cmd()),/AUTHENTICATED_EMAIL_REQUIRED/));
test('unknown actor refused',()=>assert.throws(()=>fixture('nobody@example.test').adapter().command(cmd()),/UNKNOWN_OR_DUPLICATE_ACTOR/));
test('unauthorized role refused',()=>assert.throws(()=>fixture('installer@example.test').adapter().command(cmd()),/ROLE_DENIED/));
test('non-Pilot scope refused',()=>{const f=fixture();f.options.services.TASK_COMPLETE=()=>({});f.tables.Jobs[0].pilot_job=false;assert.throws(()=>f.adapter().command(cmd()),/OUTSIDE_PILOT/)});
test('wrong ReleaseMode refused',()=>{const f=fixture();f.options.services.TASK_COMPLETE=()=>({});f.tables.ReleaseModes[0].mode='Disabled';assert.throws(()=>f.adapter().command(cmd()),/MODE_DENIED/)});
test('task completion is versioned, journalled, audited and idempotent',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();const r=f.adapter().command(cmd()),retry=f.adapter().command(cmd());assert.equal(r.result.status,'Completed');assert.equal(retry.result.status,'Replayed');assert.equal(f.tables.Tasks[0].version,3);assert.equal(f.tables.TaskEvents.length,1);assert.equal(f.tables.AuditEvents.length,1);assert.equal(f.tables.AuditEvents[0].initiating_actor,'P-tanya')});
test('Dan sees and completes one Ben-owned director task as assigned backup with actor audit',()=>{const f=fixture('dan@example.test');f.tables.People.push({id:'P-dan',email:'dan@example.test',active:true});f.tables.PersonRoles.push({person_id:'P-dan',role:'Director',active:true});f.tables.Tasks[0].owner_id='P-ben';f.tables.Tasks[0].backup_id='P-dan';f.options.services=serviceCore._r1sServices();const mine=f.adapter().read({read_type:'MY_TASKS'});assert.ok(mine.data.tasks.some(t=>t.id==='T-1'));const r=f.adapter().command(cmd()),retry=f.adapter().command(cmd());assert.equal(r.result.status,'Completed');assert.equal(retry.result.status,'Replayed');assert.equal(f.tables.Tasks.filter(t=>t.id==='T-1').length,1);assert.equal(f.tables.Tasks[0].completed_by,'P-dan');assert.equal(f.tables.TaskEvents.length,1);assert.equal(f.tables.AuditEvents[0].initiating_actor,'P-dan')});
test('stale revision refused by workflow service',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command(cmd({expected_version:1})),/STALE_VERSION/)});
test('direct arbitrary field updates impossible',()=>{const f=fixture();f.options.services.TASK_COMPLETE=()=>({});assert.throws(()=>f.adapter().command({...cmd(),table:'Jobs',changes:{workflow_stage:'Done'}}),/INVALID_FIELDS/)});
test('forbidden payload fields refused and history remains unchanged',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command(cmd({payload:{completion_note:'x',status:'Complete'}})),/INVALID_FIELDS/);assert.equal(f.tables.TaskEvents.length,0);assert.equal(f.tables.AuditEvents.length,0)});
test('read adapters require authentication and role',()=>{assert.throws(()=>fixture('').adapter().read({read_type:'SYSTEM_STATUS'}),/AUTHENTICATED/);assert.throws(()=>fixture('installer@example.test').adapter().read({read_type:'SYSTEM_STATUS'}),/ROLE_DENIED/)});
test('Hannah cannot see unrelated jobs',()=>{const f=fixture('hannah@example.test');assert.throws(()=>f.adapter().read({read_type:'JOB_OVERVIEW',job_id:'J-1'}),/JOB_ACCESS_DENIED/);assert.equal(f.adapter().read({read_type:'JOB_OVERVIEW',job_id:'J-2'}).ok,true)});
test('Tanya receives assigned office access and filtered home',()=>{const f=fixture();const r=f.adapter().read({read_type:'OFFICE_HOME'});assert.ok(r.data.overdue.map(x=>x.id).includes('T-1'));assert.equal(r.data.overdue.every(t=>t.owner_id==='P-tanya'||t.backup_id==='P-tanya'),true);assert.equal(r.data.overdue_count,r.data.overdue.length)});
test('Ben management reads work',()=>{const f=fixture('ben@example.test');assert.equal(f.adapter().read({read_type:'RELEASE_MODE_STATUS'}).ok,true);assert.equal(f.adapter().read({read_type:'JOB_OVERVIEW',job_id:'J-2'}).ok,true)});
test('Lenny DEV seed Admin is authorized through PersonRoles without email special-casing',()=>{
  const seed=require('../schema/config-seed.json');
  const person=seed.People.find(p=>p.id==='PERSON-lenny-dev');
  const role=seed.PersonRoles.find(r=>r.id==='PROLE-lenny-admin');
  assert.equal(person.email,'lenny@simplesolarltd.co.uk');
  assert.equal(person.role,'Admin');
  assert.equal(person.active,true);
  assert.equal(role.person_id,'PERSON-lenny-dev');
  assert.equal(role.role,'Admin');
  assert.equal(role.active,true);
  const f=fixture(person.email);
  f.tables.People.push({id:person.id,email:person.email,active:true,role:person.role});
  f.tables.PersonRoles.push({id:role.id,person_id:role.person_id,role:role.role,active:true});
  const probe=f.adapter().read({read_type:'IDENTITY_PROBE'});
  assert.equal(probe.data.active_user_maps_to_active_people,true);
  assert.deepEqual(probe.data.resolved_person_roles,['Admin']);
  assert.equal(probe.data.authenticated,true);
  assert.equal(f.adapter().read({read_type:'RELEASE_MODE_STATUS'}).ok,true);
  assert.equal(f.adapter().read({read_type:'JOB_OVERVIEW',job_id:'J-2'}).ok,true);
  const officeOnly=fixture(person.email);
  officeOnly.tables.People.push({id:person.id,email:person.email,active:true,role:'Office'});
  officeOnly.tables.PersonRoles.push({id:'PROLE-lenny-office-only',person_id:person.id,role:'Office',active:true});
  assert.throws(()=>officeOnly.adapter().read({read_type:'RELEASE_MODE_STATUS'}),/ROLE_DENIED/);
});
test('sold intake refuses a forged service that is not the canonical handler and refuses extra envelope fields',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command({command_id:'C-I',command_type:'SOLD_INTAKE',job_id:'J-1',payload:{customer_first_name:'A'}}),/INVALID_FIELDS/);assert.throws(()=>f.adapter().command({command_id:'C-I2',command_type:'SOLD_INTAKE',payload:{customer_first_name:'A',workflow_stage:'Booked'}}),/INVALID_FIELDS/);});
test('unsupported fixture-scoped command fails closed',()=>assert.throws(()=>fixture().adapter().command(cmd()),/COMMAND_UNSUPPORTED/));
test('unrelated job command refused',()=>{const f=fixture('hannah@example.test');f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command(cmd()),/JOB_ACCESS_DENIED/)});
test('action reads expose staff commands but keep BOOKING_GATES out of staff UI',()=>{const f=fixture();let a=f.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-1'}),t=f.adapter().read({read_type:'TASK_ACTION_AVAILABILITY',task_id:'T-1'});assert.deepEqual(Object.keys(a.data.appsheet_commands),['call_record','issue_update','issue_create','planner_update','move_job','change_installer','cancel_job','reinstate_job','deposit_confirm','operational_complete','sold_intake','booking_intake']);assert.equal(a.data.appsheet_commands.booking_gates,undefined);assert.equal(a.data.appsheet_commands.call_record.available,true);assert.equal(a.data.appsheet_commands.issue_create.available,true);assert.equal(a.data.appsheet_commands.cancel_job.available,true);assert.equal(a.data.appsheet_commands.move_job.available,true);assert.equal(a.data.appsheet_commands.deposit_confirm.available,false);assert.equal(a.data.appsheet_commands.deposit_confirm.reason,'DIRECTOR_REQUIRED');assert.equal(a.data.appsheet_commands.sold_intake.available,true);assert.equal(a.data.appsheet_commands.booking_intake.available,false);assert.equal(a.data.appsheet_commands.booking_intake.reason,'STAGE_NOT_ELIGIBLE');assert.equal(t.data.appsheet_commands.task_complete.available,true);assert.equal(t.data.appsheet_commands.task_reopen.available,false);assert.equal(t.data.appsheet_commands.task_reopen.reason,'REOPEN_NOT_AVAILABLE');assert.equal(t.data.appsheet_commands.task_evidence_attach.available,false);assert.equal(t.data.appsheet_commands.task_evidence_attach.reason,'ATTACH_NOT_AVAILABLE')});
test('ReadyToBook exposes Continue Booking through the existing booking intake action',()=>{const f=fixture();f.tables.Jobs[0].workflow_stage='ReadyToBook';const action=f.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-1'}).data.appsheet_commands.booking_intake;assert.equal(action.available,true);assert.equal(action.command_type,'BOOKING_INTAKE');assert.equal(action.expected_version_entity,'Jobs')});
test('job search filters to assigned R1 pilot jobs and refuses blank query',()=>{const f=fixture();assert.throws(()=>f.adapter().read({read_type:'JOB_SEARCH',query:''}),/QUERY_REQUIRED/);const r=f.adapter().read({read_type:'JOB_SEARCH',query:'J-1'});assert.equal(r.data.count,1);assert.equal(r.data.results[0].id,'J-1');const h=fixture('hannah@example.test').adapter().read({read_type:'JOB_SEARCH',query:'J-1'});assert.equal(h.data.count,0);const nonPilot=f.adapter().read({read_type:'JOB_SEARCH',query:'J-N'});assert.equal(nonPilot.data.count,0)});
test('operational queue allowlists R1 queues only and filters task visibility',()=>{const f=fixture();assert.throws(()=>f.adapter().read({read_type:'OPERATIONAL_QUEUE',queue:'materials'}),/QUEUE_NOT_IN_R1/);assert.throws(()=>f.adapter().read({read_type:'OPERATIONAL_QUEUE',queue:'archive'}),/QUEUE_NOT_IN_R1/);const r=f.adapter().read({read_type:'OPERATIONAL_QUEUE',queue:'booking'});assert.equal(r.data.queue,'booking');assert.equal(r.data.tasks.every(t=>t.owner_id==='P-tanya'||t.backup_id==='P-tanya'),true);assert.deepEqual(core.R1A_BOUND_QUEUES,['booking','calls','issues','payments','ghl','cancellation','intake_review'])});
test('call command delegates canonical S10 shape and suppresses external effects',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s10RecordCall=(x,s)=>{s.insert('Calls',{id:x.id,job_id:x.job_id,task_id:x.task_id,attempted_at:'2026-09-07T00:00:00Z',attempted_by:x.attempted_by,outcome:x.outcome});return{created:true,call:s.get('Calls',x.id)}};const r=f.adapter().command({command_id:'CALL-1',command_type:'CALL_RECORD',job_id:'J-1',task_id:'T-1',expected_version:2,payload:{type:'Customer',outcome:'NoAnswer',notes:'No reply'}});assert.equal(r.result.status,'Recorded');assert.equal(r.result.external_calls,0);assert.equal(f.tables.Calls[0].attempted_by,'P-tanya')});
test('issue and planner commands delegate only allowlisted lifecycle fields',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s10ReassignIssue=(id,owner,actor,s)=>{s.update('Issues',id,{office_owner_id:owner,updated_by:actor,version:2});return s.get('Issues',id)};global._s11UpdatePlannedDates=(x,s)=>({status:'Updated',input:x,external_calls:0});let i=f.adapter().command({command_id:'ISS-1',command_type:'ISSUE_UPDATE',job_id:'J-1',issue_id:'I-1',expected_version:1,payload:{action:'REASSIGN',owner_id:'P-hannah'}}),p=f.adapter().command({command_id:'PLAN-1',command_type:'PLANNER_UPDATE',job_id:'J-1',work_package_id:'WP-1',expected_version:1,payload:{planned_start:'2026-09-12',planned_end:'2026-09-13'}});assert.equal(i.result.issue.responsible_company_id,'CO-1');assert.equal(p.result.input.actor,'P-tanya')});
test('cancel and reinstate delegate S15 durable commands, never transports',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s15Execute=(kind,input)=>({ok:true,kind,input,external_calls:0});let c=f.adapter().command({command_id:'CAN-1',command_type:'CANCEL_JOB',job_id:'J-1',expected_version:1,payload:{reason:'Customer request',effective_date:'2026-09-08',work_performed:'None',material_state:'None',scaffold_state:'None',finance_review:'Reviewed',legacy_state:'None'}});f.tables.Jobs[0].workflow_stage='Cancelled';let r=f.adapter().command({command_id:'REIN-1',command_type:'REINSTATE_JOB',job_id:'J-1',expected_version:1,payload:{reason:'Customer resumed',new_date:'2026-09-10',commitment_review:'Reviewed',finance_review:'Reviewed',evidence_reference:'EV-1'}});assert.equal(c.result.kind,'Cancel');assert.equal(r.result.kind,'Reinstate');assert.equal(c.result.external_calls+r.result.external_calls,0)});
test('legacy DEPOSIT_CONFIRM requires the same manual bank facts as PRE03, never calls S13 confirmDeposit, and records ManualBankChecks',()=>{const f=fixture('ben@example.test');f.options.services=serviceCore._r1sServices();let legacyCalls=0;global.confirmDeposit=()=>{legacyCalls++;return{ok:true,confirmed:true};};
  const before=JSON.stringify(f.tables);
  assert.throws(()=>f.adapter().command({command_id:'DEP-1',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'BANK-REF-1'}}),/REQUIRED_DEPOSIT_BANK_CONFIRMED/);
  assert.throws(()=>f.adapter().command({command_id:'DEP-1',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'BANK-REF-1',deposit_bank_confirmed:'No',deposit_amount:1200,deposit_received_date:'2026-09-07'}}),/DEPOSIT_NOT_CONFIRMED/);
  assert.throws(()=>f.adapter().command({command_id:'DEP-1',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'BANK-REF-1',deposit_bank_confirmed:'Yes',deposit_amount:1199.99,deposit_received_date:'2026-09-07'}}),/DEPOSIT_AMOUNT_MISMATCH/);
  assert.equal(JSON.stringify(f.tables),before);
  const r=f.adapter().command({command_id:'DEP-1',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'BANK-REF-1',deposit_bank_confirmed:'Yes',deposit_amount:'1,200.00',deposit_received_date:'2026-09-07'}});
  assert.equal(r.result.status,'Confirmed');assert.equal(r.result.external_calls,0);assert.equal(legacyCalls,0);
  const job=f.tables.Jobs.find(j=>j.id==='J-DEP');assert.equal(job.deposit_bank_reference,'BANK-REF-1');assert.equal(job.deposit_bank_confirmed_by,'P-ben');assert.equal(job.deposit_bank_confirmed_at,'2026-09-07T12:00:00.000Z');
  const mbc=f.tables.ManualBankChecks;assert.equal(mbc.length,1);assert.equal(mbc[0].amount_pence,120000);assert.equal(mbc[0].outcome,'Confirmed');assert.equal(mbc[0].checked_by,'P-ben');assert.equal(mbc[0].evidence_reference,'BANK-REF-1');assert.equal(r.result.deposit.bank_check_id,mbc[0].id);
  assert.equal(f.tables.InvoiceStages[0].status,'Confirmed');assert.equal(f.tables.InvoiceStages[0].reference,'BANK-REF-1');assert.equal(f.tables.InvoiceStages[0].gross_pence,120000);
  assert.equal(require('../s06/gates.js').bankConfirmationEvidence(f.store,'J-DEP').pass,true);
  assert.equal(f.tables.AuditEvents.length,1);
  assert.equal(f.adapter().command({command_id:'DEP-1B',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:job.version,payload:{reference:'BANK-REF-1',deposit_bank_confirmed:'Yes',deposit_amount:1200,deposit_received_date:'2026-09-07'}}).result.status,'AlreadyConfirmed');
  assert.equal(f.tables.ManualBankChecks.length,1)});
test('deposit confirm refuses Office, wrong mode, stale version, invalid fields, bad amount and future date',()=>{const full={reference:'X',deposit_bank_confirmed:'Yes',deposit_amount:1200,deposit_received_date:'2026-09-07'};const f=fixture();f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command({command_id:'DEP-2',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:full}),/ROLE_DENIED/);const b=fixture('ben@example.test');b.options.services=serviceCore._r1sServices();b.tables.ReleaseModes.find(m=>m.function_id==='FN-15').mode='Disabled';assert.throws(()=>b.adapter().command({command_id:'DEP-3',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:full}),/MODE_DENIED/);const s=fixture('ben@example.test');s.options.services=serviceCore._r1sServices();assert.throws(()=>s.adapter().command({command_id:'DEP-4',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:1,payload:full}),/STALE_VERSION/);assert.throws(()=>s.adapter().command({command_id:'DEP-5',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:Object.assign({},full,{xero_id:'NOPE'})}),/INVALID_FIELDS/);assert.throws(()=>s.adapter().command({command_id:'DEP-6',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{}}),/REQUIRED_REFERENCE/);assert.throws(()=>s.adapter().command({command_id:'DEP-7',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:Object.assign({},full,{deposit_received_date:'2099-01-01'})}),/INVALID_DEPOSIT_RECEIVED_DATE/);assert.throws(()=>s.adapter().command({command_id:'DEP-8',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:Object.assign({},full,{deposit_amount:'12.345'})}),/INVALID_DEPOSIT_AMOUNT/);assert.equal((s.tables.ManualBankChecks||[]).length,0);assert.equal(s.tables.Jobs.find(j=>j.id==='J-DEP').deposit_bank_confirmed_at,null)});
test('operational complete wraps approveOperationalCompletion under FN-19/FN-11 with empty payload',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s10ApproveOperationalCompletion=(jobId,actor,s)=>{assert.equal(actor,'P-tanya');s.update('Jobs',jobId,{workflow_stage:'OperationallyComplete',operational_complete_at:'2026-09-07T00:00:00Z',operational_complete_by:actor,version:4});return{status:'Completed',created:true,gate:{ready:true},ghl_task:{id:'T-GHL'}};};const r=f.adapter().command({command_id:'OPC-1',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{}});assert.equal(r.result.status,'Completed');assert.equal(r.result.external_calls,0);assert.equal(f.tables.Jobs.find(j=>j.id==='J-OPC').workflow_stage,'OperationallyComplete')});
test('operational complete refuses VariationApprover-only, wrong mode, stale version and payload extras',()=>{const f=fixture('var@example.test');f.options.services=serviceCore._r1sServices();global._s10ApproveOperationalCompletion=()=>({status:'Completed'});assert.throws(()=>f.adapter().command({command_id:'OPC-2',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{}}),/ROLE_DENIED/);const w=fixture();w.options.services=serviceCore._r1sServices();w.tables.ReleaseModes.find(m=>m.function_id==='FN-19').mode='Disabled';assert.throws(()=>w.adapter().command({command_id:'OPC-3',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{}}),/MODE_DENIED/);const s=fixture();s.options.services=serviceCore._r1sServices();global._s10ApproveOperationalCompletion=()=>({status:'Completed'});assert.throws(()=>s.adapter().command({command_id:'OPC-4',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:1,payload:{}}),/STALE_VERSION/);assert.throws(()=>s.adapter().command({command_id:'OPC-5',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{note:'no'}}),/INVALID_FIELDS/)});
test('booking gates wraps processBookingGates under FN-01 and reports committed stage',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global.processBookingGates=(jobId,s,options)=>{assert.equal(options.actor,'P-tanya');s.update('Jobs',jobId,{workflow_stage:'Booked',booking_approved_at:'2026-09-07T00:00:00Z',booking_approved_by:options.actor,version:3});return{success:true,readiness:{ready:true},gates:{ready:true,blocked:false,summary:'Ready',workflow_stage:'Booked'},tasks:{created:[]}}};const r=f.adapter().command({command_id:'BKG-1',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}});assert.equal(r.result.status,'Booked');assert.equal(r.result.external_calls,0)});
test('booking gates refuses unauthorized, wrong mode, stale version and does not bypass blocked gates',()=>{const f=fixture('installer@example.test');f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command({command_id:'BKG-2',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}}),/ROLE_DENIED/);const w=fixture();w.options.services=serviceCore._r1sServices();w.tables.ReleaseModes.find(m=>m.function_id==='FN-01').mode='Manual';assert.throws(()=>w.adapter().command({command_id:'BKG-3',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}}),/MODE_DENIED/);const s=fixture();s.options.services=serviceCore._r1sServices();global.processBookingGates=()=>({success:false,gates:{ready:false,blocked:true,summary:'Blocked'}});assert.throws(()=>s.adapter().command({command_id:'BKG-4',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:99,payload:{}}),/STALE_VERSION/);const b=fixture();b.options.services=serviceCore._r1sServices();global.processBookingGates=()=>({success:false,gates:{ready:false,blocked:true,summary:'Blocked'},tasks:{created:[]}});const blocked=b.adapter().command({command_id:'BKG-5',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}});assert.equal(blocked.result.status,'Blocked');assert.equal(blocked.result.success,false);assert.throws(()=>b.adapter().command({command_id:'BKG-6',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{force:true}}),/INVALID_FIELDS/)});
test('deposit and operational availability flags require Admin/Office modes correctly',()=>{const f=fixture('ben@example.test');let d=f.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-DEP'});assert.equal(d.data.appsheet_commands.deposit_confirm.available,true);const o=fixture();assert.equal(o.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-OPC'}).data.appsheet_commands.operational_complete.available,true);assert.equal(o.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-BKG'}).data.appsheet_commands.booking_gates,undefined)});
test('wrong environment and sheet refuse; no external API source',()=>{const f=fixture();f.options.config.environment='PROD';assert.throws(()=>f.adapter().read({read_type:'SYSTEM_STATUS'}),/DEV_ONLY/);const src=fs.readFileSync('r1-appsheet/adapter.js','utf8')+fs.readFileSync('r1-appsheet/cloud-adapter.js','utf8')+fs.readFileSync('r1-appsheet/services.js','utf8');assert.doesNotMatch(src,/UrlFetchApp|MailApp|GmailApp|CalendarApp|DriveApp/)});
test('generated Apps Script parses and exposes only narrow entry points',()=>{const src=fs.readFileSync('apps-script/r1-appsheet/R1AppSheetAdapter.js','utf8');new vm.Script(src);assert.match(src,/function appSheetR1Read/);assert.match(src,/function appSheetR1Command/);assert.match(src,/JOB_SEARCH/);assert.match(src,/jobSearch:pick\('_s17JobSearch'\)/);assert.match(src,/reads:_r1aDefaultReads\(\)/);assert.match(src,/planner:function\(s,asOf,weeks\)/);assert.match(src,/DEPOSIT_CONFIRM/);assert.match(src,/OPERATIONAL_COMPLETE/);assert.match(src,/BOOKING_GATES/);assert.match(src,/function _r1sSoldIntake/);assert.match(src,/function _r1sBookingIntake/);assert.match(src,/function _r1sIssueCreate/);assert.match(src,/function appSheetR1CommandFromRequestRow/);assert.doesNotMatch(src,/R1A_INTAKE_POLICY_NOT_APPROVED/);assert.match(src,/runR1APrepareDepositConfirmFixture/);assert.match(src,/_r1aPrepareOperationalCompleteFixture/);assert.match(src,/_r1aPrepareBookingGatesFixture/);assert.match(src,/TPL-GHL01/);assert.doesNotMatch(src,/insert\([^)]*TPL-R1A-GHL01|_r1aFixtureIns\([^)]*TPL-R1A-GHL01|_r1aFixtureUpsert\([^)]*TPL-R1A-GHL01/);assert.doesNotMatch(src,/updateRow|genericUpdate|activateProduction/)});

function opcFixtureStore(){
  const tables={
    Jobs:[],Tasks:[],TaskTemplates:[{id:'TPL-GHL01',template_code:'GHL01',title:'Move GHL opportunity',group:'Aftercare',active:true,template_version:'1.0'}],
    WorkPackages:[],Allocations:[],CommissioningSubmissions:[],GHLTasks:[],AuditEvents:[],CommitJournal:[],TaskEvents:[],Outbox:[]
  };
  const copy=x=>structuredClone(x);
  return{tables,store:{
    list:n=>copy((tables[n]||[]).filter(r=>r&&r.id)),
    get:(n,id)=>copy((tables[n]||[]).find(x=>x&&x.id===id)||null),
    insert:(n,r)=>{if((tables[n]||[]).some(x=>x.id===r.id))throw Error('duplicate');(tables[n]||(tables[n]=[])).push(copy(r));},
    update:(n,id,p)=>{const row=(tables[n]||[]).find(x=>x.id===id);if(!row)throw Error('missing '+n+' '+id);Object.assign(row,copy(p));}
  }};
}
test('operational-complete fixture resets mutated J-r1a-opcomplete state to clean expected_version 1 twice',()=>{
  const cloud=require('../r1-appsheet/cloud-adapter.js');
  const cycle=()=>{
    const env=opcFixtureStore();
    let a=cloud._r1aPrepareOperationalCompleteFixture(env.store);
    assert.equal(a.pass,true);assert.equal(a.detail.job_id,'J-r1a-opcomplete');assert.equal(a.detail.expected_version,1);
    /* Simulate successful OPERATIONAL_COMPLETE side-effects */
    env.store.update('Jobs','J-r1a-opcomplete',{workflow_stage:'OperationallyComplete',operational_complete_at:'2026-11-12T12:00:00.000Z',operational_complete_by:'PERSON-tanya',version:2});
    env.store.insert('Tasks',{id:'TASK-GHL01-J-r1a-opcomplete-OPCOMPLETE',job_id:'J-r1a-opcomplete',template_code:'GHL01',instance_key:'GHL01-J-r1a-opcomplete-OPCOMPLETE',status:'Open',version:1});
    env.store.insert('GHLTasks',{id:'GHL-J-r1a-opcomplete-OPCOMPLETE',job_id:'J-r1a-opcomplete',task_id:'TASK-GHL01-J-r1a-opcomplete-OPCOMPLETE'});
    env.store.insert('AuditEvents',{id:'AE-R1A-OPC-TEST',entity_type:'Jobs',entity_id:'J-r1a-opcomplete',action:'OperationalComplete',executing_service:'R1 AppSheet/S10',commit_id:'R1A-OPC-TEST'});
    env.store.insert('TaskTemplates',{id:'TPL-R1A-GHL01',template_code:'GHL01',title:'duplicate',active:true,template_version:'R1A'});
    /* Partial mutate path: version bumped without clearing GHL */
    let b=cloud._r1aPrepareOperationalCompleteFixture(env.store);
    assert.equal(b.pass,true);assert.equal(b.detail.expected_version,1);
    assert.equal(env.store.get('Jobs','J-r1a-opcomplete').operational_complete_at,null);
    assert.equal(env.store.get('Jobs','J-r1a-opcomplete').workflow_stage,'Aftercare');
    assert.equal(env.store.list('Tasks').filter(t=>t.job_id==='J-r1a-opcomplete'&&t.template_code==='GHL01').length,0);
    assert.equal(env.store.list('GHLTasks').filter(g=>g.job_id==='J-r1a-opcomplete').length,0);
    assert.equal(env.store.get('TaskTemplates','TPL-R1A-GHL01'),null);
    assert.equal(env.store.list('TaskTemplates').filter(t=>t.template_code==='GHL01'&&t.active===true).map(t=>t.id).join(','),'TPL-GHL01');
    /* Second mutate + prepare */
    env.store.update('Jobs','J-r1a-opcomplete',{workflow_stage:'OperationallyComplete',operational_complete_at:'2026-11-13T12:00:00.000Z',version:5});
    env.store.insert('Tasks',{id:'TASK-GHL01-J-r1a-opcomplete-OPCOMPLETE',job_id:'J-r1a-opcomplete',template_code:'GHL01',instance_key:'GHL01-J-r1a-opcomplete-OPCOMPLETE',status:'Open'});
    env.store.insert('GHLTasks',{id:'GHL-J-r1a-opcomplete-OPCOMPLETE',job_id:'J-r1a-opcomplete',task_id:'TASK-GHL01-J-r1a-opcomplete-OPCOMPLETE'});
    let c=cloud._r1aPrepareOperationalCompleteFixture(env.store);
    assert.equal(c.pass,true);assert.equal(c.detail.expected_version,1);
    assert.equal(Number(env.store.get('Jobs','J-r1a-opcomplete').version),1);
  };
  cycle();cycle();
});

function bkgFixtureStore(){
  const tables={Jobs:[],Tasks:[],Customers:[],AuditEvents:[],CommitJournal:[],TaskEvents:[],Outbox:[]};
  const copy=x=>structuredClone(x);
  return{tables,store:{
    list:n=>copy((tables[n]||[]).filter(r=>r&&r.id)),
    get:(n,id)=>copy((tables[n]||[]).find(x=>x&&x.id===id)||null),
    insert:(n,r)=>{if((tables[n]||[]).some(x=>x.id===r.id))throw Error('duplicate');(tables[n]||(tables[n]=[])).push(copy(r));},
    update:(n,id,p)=>{const row=(tables[n]||[]).find(x=>x.id===id);if(!row)throw Error('missing '+n+' '+id);Object.assign(row,copy(p));}
  }};
}
test('booking-gates fixture resets mutated J-r1a-booking state to clean expected_version 1 twice',()=>{
  const cloud=require('../r1-appsheet/cloud-adapter.js');
  const cycle=()=>{
    const env=bkgFixtureStore();
    let a=cloud._r1aPrepareBookingGatesFixture(env.store);
    assert.equal(a.pass,true);assert.equal(a.detail.job_id,'J-r1a-booking');assert.equal(a.detail.expected_version,1);
    assert.equal(env.store.get('Jobs','J-r1a-booking').workflow_stage,'BookingInProgress');
    /* Simulate successful BOOKING_GATES side-effects (S06 cloud + R1 audit) */
    env.store.update('Jobs','J-r1a-booking',{workflow_stage:'Booked',booking_approved_at:'2026-09-07T00:00:00.000Z',booking_approved_by:'S06-gates',version:2});
    env.store.insert('Tasks',{id:'TASK-bkg-pre01',job_id:'J-r1a-booking',template_code:'PRE01',instance_key:'PRE01-J-r1a-booking-ROOT-nodue',status:'Open',source_system:'S06-gates'});
    env.store.insert('Tasks',{id:'TASK-bkg-bkg04',job_id:'J-r1a-booking',template_code:'BKG04',instance_key:'BKG04-J-r1a-booking-ROOT-nodue',status:'Open',source_system:'S06-gates'});
    env.store.insert('AuditEvents',{id:'AE-R1A-BKG-TEST',entity_type:'Jobs',entity_id:'J-r1a-booking',action:'BookingGates',executing_service:'R1 AppSheet/S06',commit_id:'R1A-BKG-TEST'});
    let b=cloud._r1aPrepareBookingGatesFixture(env.store);
    assert.equal(b.pass,true);assert.equal(b.detail.expected_version,1);
    const job=env.store.get('Jobs','J-r1a-booking');
    assert.equal(job.workflow_stage,'BookingInProgress');
    assert.equal(job.booking_approved_at,null);
    assert.equal(Number(job.version),1);
    assert.equal(job.pilot_job,true);
    assert.equal(env.store.list('Tasks').filter(t=>t.job_id==='J-r1a-booking'&&t.id!=='TASK-r1a-bkg-access').length,0);
    assert.ok(env.store.get('Tasks','TASK-r1a-bkg-access'));
    assert.equal(env.store.get('AuditEvents','AE-R1A-BKG-TEST'),null);
    /* Second mutate + prepare */
    env.store.update('Jobs','J-r1a-booking',{workflow_stage:'Booked',booking_approved_at:'2026-09-08T00:00:00.000Z',version:7});
    env.store.insert('Tasks',{id:'TASK-bkg-bkg01',job_id:'J-r1a-booking',template_code:'BKG01',instance_key:'BKG01-J-r1a-booking-ROOT-nodue',status:'Open',source_system:'S06-gates'});
    let c=cloud._r1aPrepareBookingGatesFixture(env.store);
    assert.equal(c.pass,true);assert.equal(c.detail.expected_version,1);
    assert.equal(Number(env.store.get('Jobs','J-r1a-booking').version),1);
    assert.equal(env.store.get('Jobs','J-r1a-booking').workflow_stage,'BookingInProgress');
  };
  cycle();cycle();
});

function installIntake(f){
  ['Intake','Customers','CustomerChanges','MappingRules','TaskTemplates','TechnicalDetails','WorkPackages','Allocations','Materials','JobEquipment','ScaffoldBookings','Companies','Tasks','CommitJournal','AuditEvents','InvoiceStages','Payments','GHLTasks','Outbox'].forEach(n=>{if(!f.tables[n])f.tables[n]=[];});
  if(!f.tables.People.some(p=>p.id==='PERSON-ben'))f.tables.People.push({id:'PERSON-ben',email:'ben@simplesolarltd.co.uk',display_name:'Ben',role:'Director',active:true});
  if(!f.tables.People.some(p=>p.id==='PERSON-dan'))f.tables.People.push({id:'PERSON-dan',email:'dan@simplesolarltd.co.uk',display_name:'Dan',role:'Director',active:true});
  if(!f.tables.PersonRoles.some(r=>r.person_id==='PERSON-ben'&&r.role==='Director'))f.tables.PersonRoles.push({id:'PROLE-ben-director',person_id:'PERSON-ben',role:'Director',active:true});
  if(!f.tables.PersonRoles.some(r=>r.person_id==='PERSON-dan'&&r.role==='Director'))f.tables.PersonRoles.push({id:'PROLE-dan-director',person_id:'PERSON-dan',role:'Director',active:true});
  f.tables.People.forEach(p=>{if(!p.display_name)p.display_name=p.id;});
  [
    ['PRE01','Send deposit invoice'],['PRE02','Check contract sent/signed'],['PRE03','Confirm bank deposit'],
    ['PRE04','Check customer details and sold/presale amount'],['PRE05','Check finance agreement approval']
  ].forEach(([code,title])=>{if(!f.tables.TaskTemplates.some(t=>t.template_code===code))f.tables.TaskTemplates.push({id:'TPL-'+code,template_code:code,title:title,group:'Prebooking',active:true,template_version:'1.0'});});
  if(!f.tables.Companies.some(c=>c.id==='CO-scaffold-a'))f.tables.Companies.push({id:'CO-scaffold-a',name:'ScaffoldA',type:'Scaffolder',active:true});
  f.options.services=serviceCore._r1sServices();
}
function soldPayload(extra){
  return Object.assign({
    customer_first_name:'Alice',customer_last_name:'Synthetic',street_address:'1 Test Street',city:'Testville',
    postcode:'TS1 1AA',phone:'07123456789',email:'alice@s05.example.invalid',salesperson_id:'P-tanya',
    lead_source:'Website',quote_reference:'Q-1',presale_file_id:'FILE-1',finance_route:'Standard',
    gross_amount:5000,roof_required:true,electrical_required:true,scaffold_required:true,
    roof_notes:'South facing',electrical_notes:'Consumer unit left',submitted_by:'tanya@example.test'
  },extra||{});
}
test('SOLD_INTAKE creates one customer, one pilot job, one human id and PRE tasks',()=>{
  const f=fixture();installIntake(f);
  const r=f.adapter().command({command_id:'SOLD1',command_type:'SOLD_INTAKE',payload:soldPayload()});
  assert.equal(r.result.status,'Processed');
  assert.equal(r.result.external_calls,0);
  assert.match(r.result.job_id_human,/^SS-[A-Z]{4}-\d{4}$/);
  assert.equal(f.tables.Jobs.filter(j=>j.source_system==='R1-AppSheet').length,1);
  assert.equal(f.tables.Customers.length,1);
  const job=f.tables.Jobs.find(j=>j.id===r.result.job_id);
  assert.equal(job.pilot_job,true);
  assert.equal(job.release_scope,'R1');
  assert.equal(job.workflow_stage,'Prebooking');
  assert.equal(job.salesperson_id,'P-tanya');
  assert.equal(job.original_gross_pence,500000);
  assert.equal(job.presale_file_id,'FILE-1');
  const stages=f.tables.InvoiceStages.filter(s=>s.job_id===job.id);
  assert.deepEqual(stages.map(s=>s.id).sort(),['IS-'+job.id+'-deposit','IS-'+job.id+'-interim']);
  assert.deepEqual(stages.map(s=>s.gross_pence).sort((a,b)=>a-b),[125000,175000]);
  assert.equal(stages.find(s=>s.stage==='deposit').amount_net_pence,104167);
  assert.equal(stages.find(s=>s.stage==='deposit').vat_pence,20833);
  assert.equal(f.tables.TechnicalDetails[0].roof_notes,'South facing');
  const codes=f.tables.Tasks.filter(t=>t.job_id===job.id).map(t=>t.template_code);
  assert.ok(codes.includes('PRE-COPY-JOBID'));
  assert.ok(codes.includes('PRE01'));
  assert.deepEqual(codes.filter(c=>/^PRE0[1-4]$/.test(c)).sort(),['PRE01','PRE02','PRE03','PRE04']);
  const replay=f.adapter().command({command_id:'SOLD1',command_type:'SOLD_INTAKE',payload:soldPayload()});
  assert.equal(replay.result.status,'Replayed');
  assert.equal(replay.result.job_id,r.result.job_id);
  assert.equal(f.tables.Jobs.filter(j=>j.source_system==='R1-AppSheet').length,1);
  assert.equal(f.tables.Customers.length,1);
  assert.equal(f.tables.InvoiceStages.filter(s=>s.job_id===job.id).length,2);
});
test('SOLD_INTAKE assigns PRE03 to Director Ben when Lenny is also Admin',()=>{
  const f=fixture();installIntake(f);
  f.tables.People.push({id:'PERSON-lenny-dev',email:'lenny@simplesolarltd.co.uk',display_name:'Lenny DEV',role:'Admin',active:true});
  f.tables.PersonRoles.unshift({id:'PROLE-lenny-admin',person_id:'PERSON-lenny-dev',role:'Admin',active:true});
  const r=f.adapter().command({command_id:'SOLD-PRE03-OWNER',command_type:'SOLD_INTAKE',payload:soldPayload()});
  const tasks=f.tables.Tasks.filter(t=>t.job_id===r.result.job_id);
  const byCode=code=>tasks.find(t=>t.template_code===code);
  assert.equal(byCode('PRE03').owner_id,'PERSON-ben');
  assert.equal(byCode('PRE03').backup_id,'PERSON-dan');
  assert.equal(f.tables.People.find(p=>p.id==='PERSON-ben').role,'Director');
  assert.equal(f.tables.People.find(p=>p.id==='PERSON-dan').role,'Director');
  assert.equal(f.tables.PersonRoles.some(r=>r.person_id==='PERSON-ben'&&r.role==='Admin'&&r.active===true),false);
  ['PRE01','PRE02','PRE04'].forEach(code=>assert.equal(byCode(code).owner_id,'P-tanya'));
});
test('PRE01 TASK_COMPLETE requires invoice ID and sent status; note-only and partial payloads refuse', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  const f = fixture();
  installIntake(f);
  const sold = f.adapter().command({ command_id: 'SOLD-PRE01', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const jobId = sold.result.job_id;
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');
  const deposit = f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit');
  assert.ok(pre01 && deposit);
  assert.equal(deposit.invoice_number, null);
  assert.equal(deposit.sent_at, null);

  assert.throws(() => f.adapter().command({
    command_id: 'PRE01-NOTE-ONLY', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'Deposit invoice sent to customer' }
  }), /REQUIRED_INVOICE_NUMBER/);
  assert.throws(() => f.adapter().command({
    command_id: 'PRE01-ID-ONLY', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'created', invoice_number: 'INV-1' }
  }), /REQUIRED_INVOICE_SENT/);
  assert.throws(() => f.adapter().command({
    command_id: 'PRE01-SENT-ONLY', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'sent', invoice_sent: 'Yes' }
  }), /REQUIRED_INVOICE_NUMBER/);
  assert.equal(f.tables.Tasks.find(t => t.id === pre01.id).status, 'Open');
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, false);

  const ok = f.adapter().command({
    command_id: 'PRE01-OK', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'Deposit invoice sent to customer', invoice_number: 'INV-SS-SHHC', invoice_sent: 'Yes' }
  });
  assert.equal(ok.result.status, 'Completed');
  assert.equal(ok.result.external_calls, 0);
  const stage = f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit');
  assert.equal(stage.invoice_number, 'INV-SS-SHHC');
  assert.ok(stage.sent_at);
  assert.equal(stage.status, 'Sent');
  assert.equal(f.tables.Tasks.find(t => t.id === pre01.id).status, 'Complete');
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, true);
  const replay = f.adapter().command({
    command_id: 'PRE01-OK', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'Deposit invoice sent to customer', invoice_number: 'INV-SS-SHHC', invoice_sent: 'Yes' }
  });
  assert.equal(replay.result.status, 'Replayed');
});

test('PRE01 failure outcome keeps task open for follow-up and does not satisfy PRE01', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  const f = fixture();
  installIntake(f);
  const sold = f.adapter().command({ command_id: 'SOLD-PRE01-FAIL', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const jobId = sold.result.job_id;
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');
  const failed = f.adapter().command({
    command_id: 'PRE01-FAIL', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'Xero refused — chase tomorrow', outcome: 'Failed' }
  });
  assert.equal(failed.result.status, 'FollowUpRequired');
  const task = f.tables.Tasks.find(t => t.id === pre01.id);
  assert.equal(task.status, 'Waiting');
  assert.equal(task.blocking_reason, 'PRE01_INVOICE_SEND_FAILED');
  assert.ok(task.next_followup_at);
  assert.equal(task.completed_at, null);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, false);
  const deposit = f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit');
  assert.equal(deposit.invoice_number, null);
  assert.equal(deposit.sent_at, null);
  assert.ok(f.tables.TaskEvents.some(e => e.task_id === pre01.id && e.action === 'FollowUp'));
  assert.ok(f.tables.AuditEvents.some(a => a.entity_id === pre01.id && a.action === 'FollowUp'));
});

test('New Job Sold documentation returns to My Requests without weakening identity checks',()=>{
  const doc=fs.readFileSync('docs/R1-office-appsheet-configuration.md','utf8');
  assert.match(doc,/\[submitted_by\] = USEREMAIL\(\)/);
  assert.match(doc,/LINKTOVIEW\("My Requests"\)/);
  assert.match(doc,/result_job_id_human/);
  assert.match(doc,/actually signed in as the intended staff Google account/);
  assert.match(doc,/salesperson_id.*never be treated as the authenticated actor/);
});
test('SOLD_INTAKE never matches an existing customer by name or address',()=>{
  const f=fixture();installIntake(f);
  f.adapter().command({command_id:'SOLD-A',command_type:'SOLD_INTAKE',payload:soldPayload()});
  const second=f.adapter().command({command_id:'SOLD-B',command_type:'SOLD_INTAKE',payload:soldPayload()});
  assert.equal(second.result.status,'Processed');
  assert.equal(f.tables.Customers.length,2);
  assert.equal(f.tables.Jobs.filter(j=>j.source_system==='R1-AppSheet').length,2);
  assert.notEqual(f.tables.Jobs.filter(j=>j.source_system==='R1-AppSheet')[0].job_id,f.tables.Jobs.filter(j=>j.source_system==='R1-AppSheet')[1].job_id);
  assert.throws(()=>f.adapter().command({command_id:'SOLD-A',command_type:'SOLD_INTAKE',payload:soldPayload({customer_last_name:'Other'})}),/COMMAND_CONFLICT/);
});
test('SOLD_INTAKE denies Installer, Store and Scaffolder; allows Office, Admin and Director',()=>{
  [['installer@example.test','Installer','P-installer'],['store@example.test','Store','P-store'],['scaffolder@example.test','Scaffolder','P-scaffold']].forEach(([email,role,id])=>{
    const f=fixture(email);
    if(!f.tables.People.some(p=>p.email===email)){
      f.tables.People.push({id:id,email:email,active:true,display_name:role});
      f.tables.PersonRoles.push({person_id:id,role:role,active:true});
    }
    f.options.services=serviceCore._r1sServices();
    assert.throws(()=>f.adapter().command({command_id:'DENY-'+role,command_type:'SOLD_INTAKE',payload:soldPayload()}),/ROLE_DENIED/);
  });
  const d=fixture('dan@example.test');installIntake(d);
  d.tables.People.push({id:'P-dan',email:'dan@example.test',active:true,display_name:'Dan'});
  d.tables.PersonRoles.push({person_id:'P-dan',role:'Director',active:true});
  const r=d.adapter().command({command_id:'SOLD-DAN',command_type:'SOLD_INTAKE',payload:soldPayload({submitted_by:'dan@example.test',salesperson_id:'P-dan'})});
  assert.equal(r.result.status,'Processed');
  assert.equal(d.tables.Jobs.find(j=>j.id===r.result.job_id).salesperson_id,'P-dan');
});
test('BOOKING_INTAKE updates the exact job and does not create a second job',()=>{
  const f=fixture();installIntake(f);
  f.tables.People.push({id:'P-roofer',email:'roofer@example.test',active:true,display_name:'RooferA',role:'Installer'},{id:'P-sparky',email:'sparky@example.test',active:true,display_name:'ElectricianA',role:'Installer'});
  const sold=f.adapter().command({command_id:'SOLD-BK',command_type:'SOLD_INTAKE',payload:soldPayload()});
  const job=f.tables.Jobs.find(j=>j.id===sold.result.job_id);
  const payload={customer_first_name:'Alice',customer_last_name:'Synthetic',street_address:'1 Test Street',city:'Testville',postcode:'TS1 1AA',email:'alice@s05.example.invalid',phone:'07123456789',cost:'5000.00',date_roofer:'2026-10-06',date_sparky:'2026-10-08',date_scaffold:'2026-10-03',roofer:'RooferA',sparky:'P-sparky',scaffold_company:'ScaffoldA',mat_r420181_total:20,mat_panel_515:12,inverter:'Fox 5.0',battery:'PowerVault',battery_qty:1,submitted_by:'tanya@example.test'};
  const before=f.tables.Jobs.length;
  const r=f.adapter().command({command_id:'BOOK-1',command_type:'BOOKING_INTAKE',job_id:job.id,expected_version:job.version,payload:payload});
  assert.equal(r.result.status,'Processed');
  assert.equal(r.result.job_id,job.id);
  assert.equal(r.result.job_id_human,job.job_id);
  assert.equal(r.result.workflow_stage,'Prebooking');
  assert.equal(f.tables.Jobs.length,before);
  assert.equal(f.tables.Customers.length,1);
  assert.equal(f.tables.Customers[0].last_name,'Synthetic');
  assert.ok(f.tables.WorkPackages.some(w=>w.job_id===job.id&&w.trade==='Roof'));
  assert.ok(f.tables.WorkPackages.some(w=>w.job_id===job.id&&w.trade==='Electrical'));
  assert.ok(f.tables.ScaffoldBookings.some(b=>b.job_id===job.id));
  assert.ok(f.tables.Materials.some(m=>String(m.description).includes('515 Panels')));
  assert.ok(f.tables.JobEquipment.some(e=>e.equipment_type==='Inverter'));
  assert.ok(f.tables.Allocations.filter(a=>a.active).length>=1);
  assert.equal(f.tables.InvoiceStages.filter(s=>s.job_id===job.id).length,2);
  const replay=f.adapter().command({command_id:'BOOK-1',command_type:'BOOKING_INTAKE',job_id:job.id,expected_version:1,payload:payload});
  assert.equal(replay.result.status,'Replayed');
  assert.equal(f.tables.Jobs.length,before);
  const row=f.tables.Jobs.find(j=>j.id===job.id);
  row.workflow_stage='ReadyToBook';
  const advanced=f.adapter().command({command_id:'BOOK-READY',command_type:'BOOKING_INTAKE',job_id:job.id,expected_version:row.version,payload:payload});
  assert.equal(advanced.result.workflow_stage,'BookingInProgress');
  assert.equal(f.tables.Jobs.length,before);
  assert.throws(()=>f.adapter().command({command_id:'BOOK-STALE',command_type:'BOOKING_INTAKE',job_id:job.id,expected_version:1,payload:payload}),/STALE_VERSION/);
  assert.throws(()=>f.adapter().command({command_id:'BOOK-MISS',command_type:'BOOKING_INTAKE',job_id:'J-missing',expected_version:1,payload:payload}),/JOB_NOT_FOUND/);
  assert.throws(()=>f.adapter().command({command_id:'BOOK-EXTRA',command_type:'BOOKING_INTAKE',job_id:job.id,expected_version:advanced.result.version,payload:Object.assign({},payload,{surname_match:'Synthetic'})}),/INVALID_FIELDS/);
});
test('BOOKING_INTAKE mismatch writes CustomerChanges and does not overwrite the customer',()=>{
  const f=fixture();installIntake(f);
  const sold=f.adapter().command({command_id:'SOLD-MM',command_type:'SOLD_INTAKE',payload:soldPayload()});
  const job=f.tables.Jobs.find(j=>j.id===sold.result.job_id);
  const r=f.adapter().command({command_id:'BOOK-MM',command_type:'BOOKING_INTAKE',job_id:job.id,expected_version:job.version,payload:{customer_last_name:'Different',cost:'4000.00',submitted_by:'P-tanya'}});
  assert.equal(r.result.status,'Review');
  assert.equal(f.tables.Customers[0].last_name,'Synthetic');
  assert.ok(f.tables.CustomerChanges.some(c=>c.job_id===job.id&&c.field_name==='last_name'&&c.incoming_value==='Different'));
  assert.equal(f.tables.Jobs.filter(j=>j.customer_id===job.customer_id).length,1);
});
test('intake contracts and AppSheet JSON expressions stay exact',()=>{
  assert.deepEqual(serviceCore.R1A_SOLD_REQUEST_COLUMNS,['id','command_id','submitted_by','customer_first_name','customer_last_name','street_address','city','postcode','phone','email','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','gross_amount','roof_required','electrical_required','scaffold_required','roof_notes','electrical_notes','submitted_by','result_status','result_job_id','result_job_id_human','result_version','result_message']);
  assert.equal(serviceCore.R1A_BOOKING_REQUEST_COLUMNS[0],'id');
  assert.equal(serviceCore.R1A_BOOKING_REQUEST_COLUMNS[3],'job_id');
  assert.equal(serviceCore.R1A_BOOKING_REQUEST_COLUMNS[4],'job_id_human');
  assert.equal(serviceCore.R1A_BOOKING_REQUEST_COLUMNS[5],'expected_version');
  assert.ok(serviceCore.R1A_BOOKING_REQUEST_COLUMNS.includes('date_roofer'));
  assert.ok(serviceCore.R1A_BOOKING_REQUEST_COLUMNS.includes('mat_panel_515'));
  assert.equal(serviceCore.R1A_BOOKING_REQUEST_COLUMNS.at(-1),'result_message');
  const soldExpr=serviceCore._r1sSoldExpression(),bookExpr=serviceCore._r1sBookingExpression();
  assert.match(soldExpr,/command_type\\":\\"SOLD_INTAKE/);
  assert.match(bookExpr,/command_type\\":\\"BOOKING_INTAKE/);
  assert.match(bookExpr,/job_id/);
  assert.match(bookExpr,/expected_version/);
  assert.doesNotMatch(bookExpr,/job_id_human/);
  serviceCore.R1A_SOLD_FIELDS.forEach(f=>assert.match(soldExpr,new RegExp(f.key)));
  serviceCore.R1A_BOOKING_FIELDS.forEach(f=>assert.match(bookExpr,new RegExp(f.key)));
  const bridge=fs.readFileSync('standalone-bridge/AppSheetBridge.js','utf8');
  assert.match(bridge,/function appSheetR1Command/);
  assert.match(bridge,/function appSheetR1CommandFromRequestRow/);
  assert.match(bridge,/function _r1sSoldIntake/);
  assert.match(bridge,/function _r1sBookingIntake/);
  assert.match(bridge,/S05Core/);
  assert.doesNotMatch(bridge,/R1A_INTAKE_POLICY_NOT_APPROVED/);
  assert.doesNotMatch(bridge,/CalendarApp|MailApp|GmailApp|UrlFetchApp/);
});

const requestRow = require('../r1-appsheet/request-row.js');
function fakeRequestSheet(table, headers, rows, sheetId) {
  const values = [headers].concat(rows);
  return {
    getId: () => sheetId || requestRow.R1A_REQUEST_DEV_SHEET,
    getSheets: () => [{
      getName: () => table,
      getLastColumn: () => headers.length,
      getLastRow: () => values.length,
      getRange: (r, c, numRows, numCols) => ({
        getValues: () => values.slice(r - 1, r - 1 + numRows).map(row => row.slice(c - 1, c - 1 + numCols))
      })
    }]
  };
}
test('request-row SOLD_INTAKE reads the helper row and reuses the canonical command path', () => {
  const f = fixture();
  installIntake(f);
  const row = { id: 'ROW-SOLD', command_id: 'SOLD-ROW', submitted_by: 'tanya@example.test', customer_first_name: 'Alice', customer_last_name: 'Synthetic', street_address: '1 Test Street', city: 'Testville', postcode: 'TS1 1AA', phone: '07123456789', email: 'alice@s05.example.invalid', salesperson_id: 'P-tanya', finance_route: 'Standard', gross_amount: 5000, scaffold_required: true, roof_notes: 'South facing', workflow_stage: 'Booked', job_id_human: 'SS-FAKE-0001' };
  const seen = [];
  const result = requestRow._r1aCommandFromRequestRow('SOLD_INTAKE', 'ROW-SOLD', 'tanya@example.test', {
    sessionEmail: 'tanya@example.test',
    readRow: () => row,
    dispatch: (request, actorEmail) => { seen.push({ request, actorEmail }); return f.adapter().command(request); }
  });
  assert.equal(seen[0].actorEmail, 'tanya@example.test');
  assert.equal(seen[0].request.command_type, 'SOLD_INTAKE');
  assert.equal(seen[0].request.command_id, 'SOLD-ROW');
  assert.equal(seen[0].request.job_id, undefined);
  assert.equal(seen[0].request.payload.workflow_stage, undefined);
  assert.equal(seen[0].request.payload.job_id_human, undefined);
  assert.equal(result.result.status, 'Processed');
  assert.match(result.result.job_id_human, /^SS-[A-Z]{4}-\d{4}$/);
  const replay = requestRow._r1aCommandFromRequestRow('SOLD_INTAKE', 'ROW-SOLD', 'Tanya@Example.Test', {
    sessionEmail: '',
    readRow: () => row,
    dispatch: (request) => f.adapter().command(request)
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(replay.result.job_id, result.result.job_id);
  assert.equal(f.tables.Customers.length, 1);
});
test('request-row BOOKING_INTAKE uses internal job_id and expected_version, ignores human id, and does not authorize from submitted_by', () => {
  const f = fixture();
  installIntake(f);
  const sold = f.adapter().command({ command_id: 'SOLD-REQ', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const job = f.tables.Jobs.find(j => j.id === sold.result.job_id);
  let dispatched = 0;
  const mismatch = () => requestRow._r1aCommandFromRequestRow('BOOKING_INTAKE', 'ROW-BK', 'ben@example.test', {
    sessionEmail: 'ben@example.test',
    readRow: () => ({ id: 'ROW-BK', command_id: 'BOOK-ROW', submitted_by: 'tanya@example.test', job_id: job.id, job_id_human: 'SS-WRONG-0001', expected_version: job.version }),
    dispatch: () => { dispatched += 1; }
  });
  assert.throws(mismatch, /ACTOR_MISMATCH/);
  assert.equal(dispatched, 0);
  const result = requestRow._r1aCommandFromRequestRow('BOOKING_INTAKE', 'ROW-BK', 'tanya@example.test', {
    sessionEmail: 'tanya@example.test',
    readRow: () => ({ id: 'ROW-BK', command_id: 'BOOK-ROW', submitted_by: 'tanya@example.test', job_id: job.id, job_id_human: 'SS-WRONG-0001', expected_version: job.version, cost: '5000.00', date_roofer: new Date(2026, 9, 6) }),
    dispatch: (request) => {
      assert.equal(request.job_id, job.id);
      assert.equal(request.expected_version, job.version);
      assert.equal(request.payload.job_id, undefined);
      assert.equal(request.payload.job_id_human, undefined);
      assert.equal(request.payload.date_roofer, '2026-10-06');
      return f.adapter().command(request);
    }
  });
  assert.equal(result.result.job_id, job.id);
  assert.equal(result.result.workflow_stage, 'Prebooking');
  assert.equal(f.tables.Jobs.filter(j => j.source_system === 'R1-AppSheet').length, 1);
  assert.throws(() => requestRow._r1aCommandFromRequestRow('BOOKING_INTAKE', 'ROW-BK', 'installer@example.test', {
    sessionEmail: 'installer@example.test',
    readRow: () => ({ id: 'ROW-BK', command_id: 'BOOK-INST', submitted_by: 'installer@example.test', job_id: job.id, expected_version: job.version }),
    dispatch: (request) => fixture('installer@example.test').adapter().command(request)
  }), /ROLE_DENIED/);
});
test('request-row DEPOSIT_CONFIRM uses the submitted AppSheet actor and normal authorization', () => {
  global.confirmDeposit = payments.confirmDeposit;
  const f = fixture('ben@example.test');
  f.options.services = serviceCore._r1sServices();
  const weakRow = {id:'ROW-DEP',command_id:'DEP-ROW',job_id:'J-DEP',expected_version:4,reference:'TONY-SMITH-DEV-DEPOSIT-001',submitted_by:'ben@example.test',submitted_at:'2026-09-13T12:00:00Z',status:'Ready',result_status:'',result_message:''};
  // Reference-only legacy rows no longer confirm anything.
  assert.throws(()=>requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-DEP','ben@example.test',{sessionEmail:'lenny@example.test',readRow:()=>weakRow,dispatch:(request)=>f.adapter().command(request)}),/REQUIRED_DEPOSIT_BANK_CONFIRMED/);
  assert.equal(f.tables.Jobs.find(j=>j.id==='J-DEP').deposit_bank_confirmed_at,null);
  const row = Object.assign({},weakRow,{deposit_bank_confirmed:'Yes',deposit_amount:1200,deposit_received_date:new Date(2026,8,7)});
  const built=[];
  const result = requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-DEP','ben@example.test',{sessionEmail:'lenny@example.test',readRow:()=>row,dispatch:(request)=>{built.push(request);return f.adapter().command(request);}});
  assert.deepEqual(built[0].payload,{reference:'TONY-SMITH-DEV-DEPOSIT-001',deposit_bank_confirmed:'Yes',deposit_amount:1200,deposit_received_date:'2026-09-07'});
  assert.equal(result.result.status,'Confirmed');
  assert.equal(f.tables.InvoiceStages.find(s=>s.id==='IS-J-DEP-deposit').reference,'TONY-SMITH-DEV-DEPOSIT-001');
  assert.equal(f.tables.ManualBankChecks.length,1);assert.equal(f.tables.ManualBankChecks[0].amount_pence,120000);
  assert.equal(requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-DEP','ben@example.test',{sessionEmail:'lenny@example.test',readRow:()=>row,dispatch:(request)=>f.adapter().command(request)}).result.status,'AlreadyConfirmed');
  assert.throws(()=>requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-DEP','ben@example.test',{sessionEmail:'lenny@example.test',readRow:()=>Object.assign({},row,{submitted_by:'tanya@example.test'}),dispatch:()=>null}),/ACTOR_MISMATCH/);

  const dan = fixture('dan@example.test');
  dan.tables.People.push({id:'P-dan',email:'dan@example.test',active:true});
  dan.tables.PersonRoles.push({person_id:'P-dan',role:'Director',active:true});
  dan.tables.Tasks.find(t=>t.id==='T-DEP').backup_id='P-dan';
  dan.options.services=serviceCore._r1sServices();
  const danRow=Object.assign({},row,{id:'ROW-DAN',command_id:'DEP-DAN',submitted_by:'dan@example.test',reference:'DAN-REF'});
  assert.equal(requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-DAN','dan@example.test',{sessionEmail:'lenny@example.test',readRow:()=>danRow,dispatch:(request)=>dan.adapter().command(request)}).result.status,'Confirmed');
  const unassigned=fixture('dan@example.test');
  unassigned.tables.People.push({id:'P-dan',email:'dan@example.test',active:true});
  unassigned.tables.PersonRoles.push({person_id:'P-dan',role:'Director',active:true});
  unassigned.options.services=serviceCore._r1sServices();
  assert.throws(()=>requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-DAN','dan@example.test',{sessionEmail:'lenny@example.test',readRow:()=>danRow,dispatch:(request)=>unassigned.adapter().command(request)}),/JOB_ACCESS_DENIED/);
  const manual=fixture('ben@example.test');manual.options.services=serviceCore._r1sServices();manual.tables.ReleaseModes.find(m=>m.function_id==='FN-15').mode='Disabled';
  assert.throws(()=>requestRow._r1aCommandFromRequestRow('DEPOSIT_CONFIRM','ROW-MODE','ben@example.test',{sessionEmail:'lenny@example.test',readRow:()=>Object.assign({},row,{id:'ROW-MODE',command_id:'DEP-MODE'}),dispatch:(request)=>manual.adapter().command(request)}),/MODE_DENIED/);
});
test('PRE02/PRE04 TASK_COMPLETE stamp Job fields with evidence; unrelated tasks and missing evidence do not', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  const f = fixture();
  installIntake(f);
  f.tables.Evidence = [{
    id: 'EVID-CONTRACT-TONY', job_id: null, drive_file_id: 'DRIVE-TONY', category: 'Contract',
    filename: 'contract.pdf', upload_status: 'Uploaded', customer_shareable: false, version: 1
  }];
  const sold = f.adapter().command({command_id:'SOLD-PRE',command_type:'SOLD_INTAKE',payload:soldPayload()});
  const jobId = sold.result.job_id;
  f.tables.Evidence[0].job_id = jobId;
  let job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'NotSent');
  assert.equal(job.customer_details_verified_at, null);
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE02');
  const pre04 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE04');
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');
  assert.ok(pre02 && pre04 && pre01);

  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-NOEV', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'signed without evidence' }
  }), /REQUIRED_CONTRACT_ID/);
  job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'NotSent');

  const signed = f.adapter().command({
    command_id: 'PRE02-OK', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'Contract signed', contract_id: 'SIGNABLE-TONY', contract_signed: 'Yes', evidence_id: 'EVID-CONTRACT-TONY' }
  });
  assert.equal(signed.result.status, 'Completed');
  assert.equal(signed.result.external_calls, 0);
  job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'Signed');
  assert.equal(job.contract_id, 'SIGNABLE-TONY');
  assert.equal(job.contract_evidence_id, 'EVID-CONTRACT-TONY');
  assert.ok(job.contract_signed_at);
  const jobVersionAfterPre02 = job.version;

  const replayPre02 = f.adapter().command({
    command_id: 'PRE02-OK', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'Contract signed', contract_id: 'SIGNABLE-TONY', contract_signed: 'Yes', evidence_id: 'EVID-CONTRACT-TONY' }
  });
  assert.equal(replayPre02.result.status, 'Replayed');
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).version, jobVersionAfterPre02);

  f.tables.Evidence.push({ id: 'EV-OTHER', job_id: 'J-OTHER', drive_file_id: 'DRIVE-X', category: 'Contract', filename: 'x.pdf', upload_status: 'Received', customer_shareable: false, version: 1 });
  const pre04Fresh = f.tables.Tasks.find(t => t.id === pre04.id);
  assert.throws(() => f.adapter().command({
    command_id: 'PRE04-XJOB', command_type: 'TASK_COMPLETE', task_id: pre04Fresh.id, expected_version: pre04Fresh.version,
    payload: { completion_note: 'checked', customer_details_verified: 'Yes', sold_value_verified: 'Yes', verified_gross_amount: 5000, evidence_id: 'EV-OTHER' }
  }), /CROSS_JOB_EVIDENCE|REQUIRED_EVIDENCE/);

  // Cross-job Evidence id used on PRE02 path already completed; for PRE04 use structured verification
  const verified = f.adapter().command({
    command_id: 'PRE04-OK', command_type: 'TASK_COMPLETE', task_id: pre04Fresh.id, expected_version: pre04Fresh.version,
    payload: {
      completion_note: 'Customer/value checked',
      customer_details_verified: 'Yes',
      sold_value_verified: 'Yes',
      verified_gross_amount: 5000
    }
  });
  assert.equal(verified.result.status, 'Completed');
  job = f.tables.Jobs.find(j => j.id === jobId);
  assert.ok(job.customer_details_verified_at);
  assert.equal(job.customer_details_verified_by, 'P-tanya');
  assert.equal(job.sold_booking_match_status, 'Match');
  assert.equal(job.valuation_basis, 'Standard');
  assert.equal(job.original_gross_pence, 500000);

  const pre01Before = f.tables.Jobs.find(j => j.id === jobId);
  assert.throws(() => f.adapter().command({
    command_id: 'PRE01-NOTE', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'invoice sent' }
  }), /REQUIRED_INVOICE/);
  const pre01Cmd = f.adapter().command({
    command_id: 'PRE01-OK', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'Deposit invoice sent to customer', invoice_number: 'INV-DEP-1', invoice_sent: 'Yes' }
  });
  assert.equal(pre01Cmd.result.status, 'Completed');
  assert.equal(f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit').invoice_number, 'INV-DEP-1');
  assert.ok(f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit').sent_at);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, true);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).customer_details_verified_at, pre01Before.customer_details_verified_at);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).contract_evidence_id, 'EVID-CONTRACT-TONY');

  // Structured manual bank verification + PRE03 completion automatically advances readiness.
  const pre03 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE03');
  assert.equal(gates.evaluateReadyToBook(f.tables.Jobs.find(j => j.id === jobId), f.store).ready, false);
  f.options.actorEmail = () => 'ben@example.test';
  const beforeJournals = f.tables.CommitJournal.length;
  const beforeTasks = f.tables.Tasks.length;
  const completed = f.adapter().command({
    command_id: 'PRE03-FINAL', command_type: 'TASK_COMPLETE', task_id: pre03.id, expected_version: pre03.version,
    payload: { completion_note: 'Deposit verified in bank', deposit_bank_confirmed: 'Yes', deposit_amount: 1250, deposit_received_date: '2026-09-13', deposit_bank_reference: 'TONY-DEP' }
  });
  assert.equal(completed.result.status, 'Completed');
  assert.equal(completed.result.readiness.stage_advanced, true);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).workflow_stage, 'ReadyToBook');
  assert.equal(f.tables.AuditEvents.filter(a => a.action === 'WorkflowStage:ReadyToBook').length, 1);
  const replay = f.adapter().command({
    command_id: 'PRE03-FINAL', command_type: 'TASK_COMPLETE', task_id: pre03.id, expected_version: pre03.version,
    payload: { completion_note: 'Deposit verified in bank', deposit_bank_confirmed: 'Yes', deposit_amount: 1250, deposit_received_date: '2026-09-13', deposit_bank_reference: 'TONY-DEP' }
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(f.tables.CommitJournal.length, beforeJournals + 1);
  assert.equal(f.tables.Tasks.length, beforeTasks);
  assert.equal(f.tables.AuditEvents.filter(a => a.action === 'WorkflowStage:ReadyToBook').length, 1);
});

test('PRE04 requires structured customer/value reconciliation and preserves canonical gross value', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;

  let setupSequence = 0;
  function setup(email = 'tanya@example.test') {
    const f = fixture(email);
    installIntake(f);
    setupSequence += 1;
    const sold = f.adapter().command({ command_id: 'SOLD-PRE04-' + setupSequence, command_type: 'SOLD_INTAKE', payload: soldPayload() });
    const job = f.tables.Jobs.find(j => j.id === sold.result.job_id);
    job.original_gross_pence = 1045178;
    job.current_contract_gross_pence = 1045178;
    job.sold_booking_match_status = 'Pending';
    job.customer_details_verified_at = null;
    job.customer_details_verified_by = null;
    job.valuation_basis = null;
    const task = f.tables.Tasks.find(t => t.job_id === job.id && t.template_code === 'PRE04');
    return { f, job, task };
  }

  function complete(x, commandId, payload) {
    return x.f.adapter().command({
      command_id: commandId,
      command_type: 'TASK_COMPLETE',
      task_id: x.task.id,
      expected_version: x.task.version,
      payload
    });
  }

  for (const c of [
    ['note only', { completion_note: 'Checked' }, /REQUIRED_CUSTOMER_DETAILS_VERIFIED/],
    ['customer only', { completion_note: 'Checked', customer_details_verified: 'Yes' }, /REQUIRED_SOLD_VALUE_VERIFIED/],
    ['value only', { completion_note: 'Checked', sold_value_verified: 'Yes', verified_gross_amount: 10451.78 }, /REQUIRED_CUSTOMER_DETAILS_VERIFIED/]
  ]) {
    const x = setup();
    assert.throws(() => complete(x, 'PRE04-' + c[0].replaceAll(' ', '-'), c[1]), c[2]);
    assert.equal(x.f.tables.Tasks.find(t => t.id === x.task.id).status, 'Open');
    assert.equal(x.f.tables.Jobs.find(j => j.id === x.job.id).customer_details_verified_at, null);
  }

  for (const c of [
    ['AMOUNT', { completion_note: 'Source amount differs', customer_details_verified: 'Yes', sold_value_verified: 'Yes', verified_gross_amount: 10451.77 }, 'PRE04_VALUE_MISMATCH'],
    ['CUSTOMER-NO', { completion_note: 'Customer details differ', customer_details_verified: 'No', sold_value_verified: 'Yes', verified_gross_amount: 10451.78 }, 'PRE04_CUSTOMER_DETAILS_MISMATCH'],
    ['VALUE-NO', { completion_note: 'Sold value differs', customer_details_verified: 'Yes', sold_value_verified: 'No', verified_gross_amount: 10451.78 }, 'PRE04_SOLD_VALUE_MISMATCH']
  ]) {
    const x = setup();
    const beforeOriginal = x.job.original_gross_pence;
    const beforeCurrent = x.job.current_contract_gross_pence;
    const result = complete(x, 'PRE04-' + c[0], c[1]);
    const task = x.f.tables.Tasks.find(t => t.id === x.task.id);
    const job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(result.result.status, 'FollowUpRequired');
    assert.equal(task.status, 'Waiting');
    assert.equal(task.blocking_reason, c[2]);
    assert.ok(task.next_followup_at);
    assert.equal(task.completed_at, null);
    assert.equal(job.sold_booking_match_status, 'Review');
    assert.equal(job.original_gross_pence, beforeOriginal);
    assert.equal(job.current_contract_gross_pence, beforeCurrent);
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE04').pass, false);
    assert.equal(gates.evaluateReadyToBook(job, x.f.store).ready, false);
    assert.equal(x.f.tables.CommitJournal.at(-1).state, 'Committed');
    assert.equal(x.f.tables.TaskEvents.at(-1).action, 'FollowUp');
    assert.equal(x.f.tables.AuditEvents.at(-1).initiating_actor, 'P-tanya');
  }

  const unauthorized = setup();
  unauthorized.f.options.actorEmail = () => 'hannah@example.test';
  assert.throws(() => complete(unauthorized, 'PRE04-UNAUTHORIZED', {
    completion_note: 'Checked', customer_details_verified: 'Yes', sold_value_verified: 'Yes', verified_gross_amount: 10451.78
  }), /JOB_ACCESS_DENIED|TASK_ACCESS_DENIED/);

  const x = setup();
  const payload = {
    completion_note: 'Customer and sold value reconciled to source',
    customer_details_verified: 'Yes',
    sold_value_verified: 'Yes',
    verified_gross_amount: 10451.78
  };
  const result = complete(x, 'PRE04-SUCCESS', payload);
  const task = x.f.tables.Tasks.find(t => t.id === x.task.id);
  const job = x.f.tables.Jobs.find(j => j.id === x.job.id);
  assert.equal(result.result.status, 'Completed');
  assert.equal(task.status, 'Complete');
  assert.ok(job.customer_details_verified_at);
  assert.equal(job.customer_details_verified_by, 'P-tanya');
  assert.equal(job.sold_booking_match_status, 'Match');
  assert.equal(job.valuation_basis, 'Standard');
  assert.equal(job.original_gross_pence, 1045178);
  assert.equal(job.current_contract_gross_pence, 1045178);
  assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE04').pass, true);
  const readiness = gates.evaluateReadyToBook(job, x.f.store);
  assert.ok(readiness.gates.some(g => g.name === 'PRE04_satisfied' && g.pass));
  assert.ok(readiness.gates.some(g => g.name === 'customer_value_verified' && g.pass));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.gates.some(g => g.name === 'PRE03_satisfied' && !g.pass));
  assert.equal(x.f.tables.Tasks.find(t => t.job_id === job.id && t.template_code === 'PRE03').status, 'Open');
  const version = job.version;
  const replay = complete(x, 'PRE04-SUCCESS', payload);
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(x.f.tables.Jobs.find(j => j.id === job.id).version, version);
  assert.equal(x.f.tables.TaskEvents.filter(e => e.task_id === task.id && e.action === 'Complete').length, 1);
});

test('PRE02 requires signed contract reference + evidence; sent/awaiting does not Complete', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const f = fixture();
  installIntake(f);
  f.tables.Evidence = [];
  f.options.resolveUpload = (path) => {
    if (path === 'uploads/signed-contract.pdf') {
      return { drive_file_id: 'DRIVE-SIGNED-1', filename: 'signed-contract.pdf', mime_type: 'application/pdf' };
    }
    const e = new Error('R1C_UPLOAD_PATH_INVALID');
    e.code = 'R1C_UPLOAD_PATH_INVALID';
    throw e;
  };
  const sold = f.adapter().command({ command_id: 'SOLD-PRE02-HARD', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const jobId = sold.result.job_id;
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE02');
  const pre03 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE03');
  const pre04 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE04');
  assert.ok(pre02);

  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-NOTE', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'Contract sent to customer' }
  }), /REQUIRED_CONTRACT_ID/);

  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-REF-ONLY', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'ref only', contract_id: 'SIGNABLE-8091' }
  }), /REQUIRED_CONTRACT_SIGNED/);

  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-SIGNED-NOEV', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'signed', contract_id: 'SIGNABLE-8091', contract_signed: 'Yes' }
  }), /REQUIRED_EVIDENCE_ID/);

  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-OPAQUE', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'signed', contract_id: 'SIGNABLE-8091', contract_signed: 'Yes', evidence_id: 'EV-DOES-NOT-EXIST' }
  }), /REQUIRED_CONTRACT_EVIDENCE/);

  const awaiting = f.adapter().command({
    command_id: 'PRE02-SENT', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'Contract sent via Signable — awaiting signature', contract_id: 'SIGNABLE-8091', contract_signed: 'No' }
  });
  assert.equal(awaiting.result.status, 'FollowUpRequired');
  let task = f.tables.Tasks.find(t => t.id === pre02.id);
  assert.equal(task.status, 'Waiting');
  assert.equal(task.blocking_reason, 'PRE02_AWAITING_SIGNATURE');
  assert.ok(task.next_followup_at);
  assert.equal(task.completed_at, null);
  let job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'Sent');
  assert.equal(job.contract_id, 'SIGNABLE-8091');
  assert.equal(job.contract_evidence_id, null);
  assert.equal(job.contract_signed_at, null);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE02').pass, false);
  assert.equal(gates.evaluateReadyToBook(job, f.store).gates.find(g => g.name === 'signed_contract_evidence').pass, false);

  const priorEmail = f.options.actorEmail;
  f.options.actorEmail = () => 'hannah@example.test';
  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-UNAUTH', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: task.version,
    payload: { completion_note: 'x', contract_id: 'SIGNABLE-8091', contract_signed: 'Yes', evidence_path: 'uploads/signed-contract.pdf' }
  }), /JOB_ACCESS_DENIED|TASK_ACCESS_DENIED/);
  f.options.actorEmail = priorEmail;

  const ok = f.adapter().command({
    command_id: 'PRE02-SIGNED-OK', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: task.version,
    payload: {
      completion_note: 'Signed contract received',
      contract_id: 'SIGNABLE-8091',
      contract_signed: 'Yes',
      evidence_path: 'uploads/signed-contract.pdf'
    }
  });
  assert.equal(ok.result.status, 'Completed');
  assert.equal(ok.result.external_calls, 0);
  task = f.tables.Tasks.find(t => t.id === pre02.id);
  assert.equal(task.status, 'Complete');
  job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'Signed');
  assert.equal(job.contract_id, 'SIGNABLE-8091');
  assert.ok(job.contract_signed_at);
  assert.ok(job.contract_evidence_id);
  assert.equal(f.tables.Evidence.filter(e => e.job_id === jobId && e.category === 'Contract').length, 1);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE02').pass, true);
  assert.equal(gates.evaluateReadyToBook(job, f.store).gates.find(g => g.name === 'signed_contract_evidence').pass, true);
  assert.equal(gates.evaluateReadyToBook(job, f.store).ready, false);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE03').pass, false);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE04').pass, false);
  assert.equal(pre03.status, 'Open');
  assert.equal(pre04.status, 'Open');

  const replay = f.adapter().command({
    command_id: 'PRE02-SIGNED-OK', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: task.version,
    payload: {
      completion_note: 'Signed contract received',
      contract_id: 'SIGNABLE-8091',
      contract_signed: 'Yes',
      evidence_path: 'uploads/signed-contract.pdf'
    }
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(f.tables.Evidence.filter(e => e.job_id === jobId && e.category === 'Contract').length, 1);
});
test('PRE02/PRE04 evidence_path creates Evidence, stamps Jobs, replays idempotently, and refuses bad uploads', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  const f = fixture();
  installIntake(f);
  f.tables.Evidence = [];
  f.options.resolveUpload = (path) => {
    if (path === 'missing/contract.pdf') {
      const e = new Error('R1C_UPLOAD_PENDING');
      e.code = 'R1C_UPLOAD_PENDING';
      throw e;
    }
    if (path === 'uploads/contract-tony.pdf') {
      return { drive_file_id: 'DRIVE-CONTRACT-1', filename: 'contract-tony.pdf', mime_type: 'application/pdf' };
    }
    if (path === 'uploads/customer-tony.pdf') {
      return { drive_file_id: 'DRIVE-CUSTOMER-1', filename: 'customer-tony.pdf', mime_type: 'application/pdf' };
    }
    const e = new Error('R1C_UPLOAD_PATH_INVALID');
    e.code = 'R1C_UPLOAD_PATH_INVALID';
    throw e;
  };
  const sold = f.adapter().command({ command_id: 'SOLD-PATH', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const jobId = sold.result.job_id;
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE02');
  const pre04 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE04');
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');

  assert.throws(() => f.adapter().command({
    command_id: 'PRE02-MISS', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'missing file', contract_id: 'SIGNABLE-PATH', contract_signed: 'Yes', evidence_path: 'missing/contract.pdf' }
  }), /UPLOAD_PENDING/);
  assert.equal(f.tables.Evidence.length, 0);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).contract_status, 'NotSent');

  const signed = f.adapter().command({
    command_id: 'PRE02-PATH', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'Contract signed via upload', contract_id: 'SIGNABLE-PATH', contract_signed: 'Yes', evidence_path: 'uploads/contract-tony.pdf' }
  });
  assert.equal(signed.result.status, 'Completed');
  assert.equal(signed.result.external_calls, 0);
  assert.equal(f.tables.Evidence.length, 1);
  const contractEv = f.tables.Evidence[0];
  assert.equal(contractEv.job_id, jobId);
  assert.equal(contractEv.drive_file_id, 'DRIVE-CONTRACT-1');
  assert.equal(contractEv.category, 'Contract');
  assert.equal(contractEv.id, 'EV-R1A-' + jobId + '-' + serviceCore._r1sHashDrive('DRIVE-CONTRACT-1'));
  let job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'Signed');
  assert.equal(job.contract_id, 'SIGNABLE-PATH');
  assert.equal(job.contract_evidence_id, contractEv.id);
  assert.ok(job.contract_signed_at);
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).evidence_id, contractEv.id);
  const completedAt = f.tables.Tasks.find(t => t.id === pre02.id).completed_at;
  const jobVersion = job.version;

  const replay = f.adapter().command({
    command_id: 'PRE02-PATH', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: pre02.version,
    payload: { completion_note: 'Contract signed via upload', contract_id: 'SIGNABLE-PATH', contract_signed: 'Yes', evidence_path: 'uploads/contract-tony.pdf' }
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(replay.result.external_calls, 0);
  assert.equal(f.tables.Evidence.length, 1);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).version, jobVersion);
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).completed_at, completedAt);

  f.tables.Evidence.push({
    id: 'EV-OTHER-JOB', job_id: 'J-OTHER', drive_file_id: 'DRIVE-OTHER', category: 'Contract',
    filename: 'x.pdf', upload_status: 'Uploaded', customer_shareable: false, version: 1
  });
  assert.throws(() => f.adapter().command({
    command_id: 'PRE04-XJOB', command_type: 'TASK_COMPLETE', task_id: pre04.id, expected_version: pre04.version,
    payload: {
      completion_note: 'bad',
      customer_details_verified: 'Yes',
      sold_value_verified: 'Yes',
      verified_gross_amount: 5000,
      evidence_id: 'EV-OTHER-JOB'
    }
  }), /CROSS_JOB_EVIDENCE/);

  const verified = f.adapter().command({
    command_id: 'PRE04-PATH', command_type: 'TASK_COMPLETE', task_id: pre04.id, expected_version: pre04.version,
    payload: {
      completion_note: 'Details checked',
      customer_details_verified: 'Yes',
      sold_value_verified: 'Yes',
      verified_gross_amount: 5000,
      evidence_path: 'uploads/customer-tony.pdf'
    }
  });
  assert.equal(verified.result.status, 'Completed');
  assert.equal(verified.result.external_calls, 0);
  const customerEv = f.tables.Evidence.find(e => e.drive_file_id === 'DRIVE-CUSTOMER-1');
  assert.ok(customerEv);
  assert.equal(customerEv.category, 'CustomerDetails');
  assert.equal(customerEv.job_id, jobId);
  job = f.tables.Jobs.find(j => j.id === jobId);
  assert.ok(job.customer_details_verified_at);
  assert.equal(job.customer_details_verified_by, 'P-tanya');
  assert.equal(job.sold_booking_match_status, 'Match');
  assert.equal(job.valuation_basis, 'Standard');
  assert.equal(job.original_gross_pence, 500000);
  assert.equal(f.tables.Tasks.find(t => t.id === pre04.id).evidence_id, customerEv.id);

  const evidenceCount = f.tables.Evidence.length;
  const pre01Cmd = f.adapter().command({
    command_id: 'PRE01-PATH', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'invoice sent', invoice_number: 'INV-PATH-1', invoice_sent: true }
  });
  assert.equal(pre01Cmd.result.status, 'Completed');
  assert.equal(f.tables.Evidence.length, evidenceCount);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).contract_evidence_id, contractEv.id);

  const requestRow = require('../r1-appsheet/request-row.js');
  const built = requestRow._r1aBuildTaskCompleteRequest({
    id: 'REQ-TC-1', command_id: 'TC-REQ-1', task_id: pre01.id, expected_version: 1,
    completion_note: 'note', evidence_path: 'uploads/x.pdf', evidence_id: '',
    submitted_by: 'tanya@example.test', submitted_at: '2026-09-13T10:00:00.000Z', status: 'Ready'
  }, 'tanya@example.test');
  assert.equal(built.command_type, 'TASK_COMPLETE');
  assert.equal(built.payload.evidence_path, 'uploads/x.pdf');
  assert.equal(built.payload.completion_note, 'note');
});
test('Tony PRE02 recovery attaches evidence_path without changing completed_at', () => {
  const requestRow = require('../r1-appsheet/request-row.js');
  const completedAt = '2026-09-12T09:00:00.000Z';
  const tables = {
    People: [{ id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', active: true }],
    PersonRoles: [{ id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true }],
    Jobs: [{
      id: 'J-mtzl04hw-bdpt6i', original_gross_pence: 1040643, pilot_job: true, release_scope: 'R1', version: 3,
      contract_status: 'NotSent', contract_id: 'SIGNABLE-TONY-LEGACY', contract_evidence_id: null, contract_signed_at: null
    }],
    Tasks: [{
      id: 'TASK-mtzl08pa-vpsvdn', job_id: 'J-mtzl04hw-bdpt6i', template_code: 'PRE02', status: 'Complete',
      evidence_id: null, completed_at: completedAt, completed_by: 'P-tanya', version: 2
    }],
    Evidence: []
  };
  const store = {
    getSheetId: () => requestRow.R1A_REQUEST_DEV_SHEET,
    getEnvironment: () => 'DEV',
    list: (n) => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find((x) => x.id === id) || null),
    insert: (n, r) => { (tables[n] || (tables[n] = [])).push(copy(r)); },
    update: (n, id, p) => { const row = (tables[n] || []).find((x) => x.id === id); Object.assign(row, copy(p)); },
    withLock: (fn) => fn()
  };
  const out = JSON.parse(requestRow.runR1AApplyTonyPre02ContractSideEffect('lenny@simplesolarltd.co.uk', 'uploads/contract.pdf', {
    cloudOptions: () => ({ store, config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET } }),
    resolveUpload: () => ({ drive_file_id: 'DRIVE-TONY-C', filename: 'contract.pdf', mime_type: 'application/pdf' }),
    ensureEvidence: serviceCore._r1sEnsureOfficeTaskEvidence,
    applyPre02: serviceCore._r1sApplyPre02Contract
  }));
  assert.equal(out.ok, true);
  assert.equal(out.external_calls, 0);
  assert.equal(out.evidence_created, true);
  assert.equal(out.after.task_completed_at, completedAt);
  assert.equal(out.after.contract_status, 'Signed');
  assert.equal(out.after.contract_evidence_id, out.evidence_id);
  assert.equal(tables.Evidence.length, 1);
  assert.equal(tables.Evidence[0].category, 'Contract');
  assert.equal(tables.Tasks[0].evidence_id, out.evidence_id);
  assert.equal(tables.Tasks[0].completed_at, completedAt);
  const again = JSON.parse(requestRow.runR1AApplyTonyPre02ContractSideEffect('lenny@simplesolarltd.co.uk', 'uploads/contract.pdf', {
    cloudOptions: () => ({ store, config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET } }),
    resolveUpload: () => ({ drive_file_id: 'DRIVE-TONY-C', filename: 'contract.pdf', mime_type: 'application/pdf' }),
    ensureEvidence: serviceCore._r1sEnsureOfficeTaskEvidence,
    applyPre02: serviceCore._r1sApplyPre02Contract
  }));
  assert.equal(again.ok, true);
  assert.equal(again.evidence_created, false);
  assert.equal(tables.Evidence.length, 1);
  assert.equal(again.after.task_completed_at, completedAt);
});
test('TASK_EVIDENCE_ATTACH repairs completed PRE02 via normal AppSheet request-row flow', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  const f = fixture();
  installIntake(f);
  f.tables.Evidence = [];
  f.options.resolveUpload = (path) => {
    if (path === 'missing/contract.pdf') {
      const e = new Error('R1C_UPLOAD_PENDING');
      e.code = 'R1C_UPLOAD_PENDING';
      throw e;
    }
    if (path === 'uploads/legacy-contract.pdf') {
      return { drive_file_id: 'DRIVE-LEGACY-1', filename: 'legacy-contract.pdf', mime_type: 'application/pdf' };
    }
    const e = new Error('R1C_UPLOAD_PATH_INVALID');
    e.code = 'R1C_UPLOAD_PATH_INVALID';
    throw e;
  };
  const sold = f.adapter().command({ command_id: 'SOLD-ATTACH', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const jobId = sold.result.job_id;
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE02');
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');
  const completedAt = '2026-09-12T09:00:00.000Z';
  const completionNote = 'Completed before evidence path existed';
  Object.assign(pre02, {
    status: 'Complete',
    completed_at: completedAt,
    completed_by: 'PERSON-lenny-dev',
    completion_note: completionNote,
    evidence_id: null,
    owner_id: 'P-tanya',
    version: 4
  });
  f.tables.Jobs.find(j => j.id === jobId).contract_status = 'NotSent';
  f.tables.Jobs.find(j => j.id === jobId).contract_id = 'SIGNABLE-LEGACY';
  f.tables.Jobs.find(j => j.id === jobId).contract_evidence_id = null;
  f.tables.Jobs.find(j => j.id === jobId).contract_signed_at = null;
  const gross = f.tables.Jobs.find(j => j.id === jobId).original_gross_pence;
  f.options.reads.taskActionAvailability = (s, id) => {
    const t = f.tables.Tasks.find(x => x.id === id);
    const complete = t && ['Open', 'Waiting', 'InProgress'].indexOf(t.status) >= 0 && t.revision_required !== true;
    return { task_id: id, actions: { complete: { available: !!complete } } };
  };

  assert.throws(() => f.adapter().command({
    command_id: 'TC-LEGACY', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: 4,
    payload: { completion_note: 'retry', evidence_path: 'uploads/legacy-contract.pdf' }
  }), /TASK_NOT_COMPLETABLE/);

  const avail = f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre02.id });
  assert.equal(avail.data.appsheet_commands.task_complete.available, false);
  assert.equal(avail.data.appsheet_commands.task_evidence_attach.available, true);

  assert.throws(() => f.adapter().command({
    command_id: 'ATTACH-MISS', command_type: 'TASK_EVIDENCE_ATTACH', task_id: pre02.id, expected_version: 4,
    payload: { evidence_path: 'missing/contract.pdf' }
  }), /UPLOAD_PENDING/);

  // An Open PRE02 is now attachable (see the deadlock-fix test); PRE02 in states that cannot complete still is not.
  const evidenceBefore = f.tables.Evidence.length;
  for (const [suffix, extra] of [['REVISION', { status: 'Open', revision_required: true }], ['CANCELLED', { status: 'Cancelled' }], ['NOTREQ', { status: 'NotRequired' }], ['BLOCKED', { status: 'Blocked' }]]) {
    const blockedPre02 = Object.assign({}, pre02, { id: 'T-PRE02-' + suffix, evidence_id: null, version: 1 }, extra);
    f.tables.Tasks.push(blockedPre02);
    assert.throws(() => f.adapter().command({
      command_id: 'ATTACH-' + suffix, command_type: 'TASK_EVIDENCE_ATTACH', task_id: blockedPre02.id, expected_version: 1,
      payload: { evidence_path: 'uploads/legacy-contract.pdf' }
    }), /TASK_NOT_ATTACHABLE/, suffix);
  }
  assert.equal(f.tables.Evidence.length, evidenceBefore);

  Object.assign(pre01, { status: 'Complete', completed_at: completedAt, completed_by: 'P-tanya', evidence_id: null, version: 2 });
  assert.throws(() => f.adapter().command({
    command_id: 'ATTACH-PRE01', command_type: 'TASK_EVIDENCE_ATTACH', task_id: pre01.id, expected_version: 2,
    payload: { evidence_path: 'uploads/legacy-contract.pdf' }
  }), /TASK_NOT_ATTACHABLE/);

  const priorEmail = f.options.actorEmail;
  f.options.actorEmail = () => 'hannah@example.test';
  assert.throws(() => f.adapter().command({
    command_id: 'ATTACH-HAN', command_type: 'TASK_EVIDENCE_ATTACH', task_id: pre02.id, expected_version: 4,
    payload: { evidence_path: 'uploads/legacy-contract.pdf' }
  }), /JOB_ACCESS_DENIED|TASK_ACCESS_DENIED/);
  f.options.actorEmail = priorEmail;
  const row = {
    id: 'REQ-ATTACH-1', command_id: 'ATTACH-OK', task_id: pre02.id, expected_version: 4,
    evidence_path: 'uploads/legacy-contract.pdf', submitted_by: 'tanya@example.test',
    submitted_at: '2026-09-13T12:00:00.000Z', status: 'Ready', result_status: '', result_message: ''
  };
  assert.throws(() => requestRow._r1aCommandFromRequestRow('TASK_EVIDENCE_ATTACH', 'REQ-ATTACH-1', 'ben@example.test', {
    readRow: () => row, dispatch: () => null
  }), /ACTOR_MISMATCH/);

  const attached = requestRow._r1aCommandFromRequestRow('TASK_EVIDENCE_ATTACH', 'REQ-ATTACH-1', 'tanya@example.test', {
    readRow: () => row,
    dispatch: (request) => f.adapter().command(request)
  });
  assert.equal(attached.result.status, 'Attached');
  assert.equal(attached.result.external_calls, 0);
  const evidence = f.tables.Evidence.find(e => e.drive_file_id === 'DRIVE-LEGACY-1');
  assert.ok(evidence);
  assert.equal(evidence.category, 'Contract');
  assert.equal(evidence.job_id, jobId);
  const taskAfter = f.tables.Tasks.find(t => t.id === pre02.id);
  assert.equal(taskAfter.evidence_id, evidence.id);
  assert.equal(taskAfter.status, 'Complete');
  assert.equal(taskAfter.completed_at, completedAt);
  assert.equal(taskAfter.completed_by, 'PERSON-lenny-dev');
  assert.equal(taskAfter.completion_note, completionNote);
  const job = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(job.contract_status, 'Signed');
  assert.equal(job.contract_evidence_id, evidence.id);
  assert.ok(job.contract_signed_at);
  assert.equal(job.original_gross_pence, gross);

  const replay = requestRow._r1aCommandFromRequestRow('TASK_EVIDENCE_ATTACH', 'REQ-ATTACH-1', 'tanya@example.test', {
    readRow: () => row,
    dispatch: (request) => f.adapter().command(request)
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(replay.result.external_calls, 0);
  assert.equal(f.tables.Evidence.filter(e => e.drive_file_id === 'DRIVE-LEGACY-1').length, 1);
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).completed_at, completedAt);

  assert.throws(() => f.adapter().command({
    command_id: 'ATTACH-AGAIN', command_type: 'TASK_EVIDENCE_ATTACH', task_id: pre02.id, expected_version: taskAfter.version,
    payload: { evidence_path: 'uploads/legacy-contract.pdf' }
  }), /EVIDENCE_ALREADY_ATTACHED/);

  f.tables.Evidence.push({
    id: 'EV-OTHER-ATTACH', job_id: 'J-OTHER', drive_file_id: 'DRIVE-X', category: 'Contract',
    filename: 'x.pdf', upload_status: 'Uploaded', customer_shareable: false, version: 1
  });
  // Cross-job: completing PRE04 with foreign Evidence id still refused on TASK_COMPLETE path
  const pre04 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE04');
  assert.throws(() => f.adapter().command({
    command_id: 'PRE04-X', command_type: 'TASK_COMPLETE', task_id: pre04.id, expected_version: pre04.version,
    payload: { completion_note: 'x', customer_details_verified: 'Yes', sold_value_verified: 'Yes', verified_gross_amount: 5000, evidence_id: 'EV-OTHER-ATTACH' }
  }), /CROSS_JOB_EVIDENCE/);
});

test('PRE02 evidence attachment automatically reevaluates Prebooking readiness once', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  const f = fixture();
  installIntake(f);
  f.tables.Evidence = [];
  f.options.resolveUpload = () => ({ drive_file_id: 'DRIVE-AUTO-PRE02', filename: 'contract.pdf', mime_type: 'application/pdf' });
  const sold = f.adapter().command({ command_id: 'SOLD-AUTO-ATTACH', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const job = f.tables.Jobs.find(j => j.id === sold.result.job_id);
  Object.assign(job, {
    contract_status: 'NotSent', contract_id: 'SIGNABLE-AUTO', contract_evidence_id: null, contract_signed_at: null,
    customer_details_verified_at: '2026-09-13T10:00:00.000Z', customer_details_verified_by: 'P-tanya',
    sold_booking_match_status: 'Match', valuation_basis: 'Standard',
    deposit_bank_confirmed_at: '2026-09-13T11:00:00.000Z', deposit_bank_confirmed_by: 'P-ben', deposit_bank_reference: 'DEP-AUTO'
  });
  ['PRE01', 'PRE03', 'PRE04'].forEach(code => {
    const task = f.tables.Tasks.find(t => t.job_id === job.id && t.template_code === code);
    Object.assign(task, { status: 'Complete', completed_at: '2026-09-13T11:30:00.000Z', completed_by: task.owner_id, completion_note: 'Verified', evidence_id: 'EV-' + code, version: 2 });
  });
  const deposit = f.tables.InvoiceStages.find(s => s.job_id === job.id && s.stage === 'deposit');
  Object.assign(deposit, { invoice_number: 'INV-AUTO-1', sent_at: '2026-09-13T11:20:00.000Z', status: 'Confirmed', reference: 'DEP-AUTO', version: 2 });
  f.tables.ManualBankChecks = [{
    id: 'MBC-AUTO', job_id: job.id, stage: 'deposit', checked_at: '2026-09-13T11:00:00.000Z', checked_by: 'P-ben',
    amount_pence: deposit.gross_pence, outcome: 'Confirmed', evidence_reference: 'DEP-AUTO', created_at: '2026-09-13T11:00:00.000Z', commit_id: 'MBC-AUTO'
  }];
  const pre02 = f.tables.Tasks.find(t => t.job_id === job.id && t.template_code === 'PRE02');
  Object.assign(pre02, { status: 'Complete', completed_at: '2026-09-13T11:45:00.000Z', completed_by: 'P-tanya', completion_note: 'Signed', evidence_id: null, version: 2 });
  assert.equal(gates.evaluateReadyToBook(job, f.store).ready, false);
  const request = { command_id: 'ATTACH-AUTO', command_type: 'TASK_EVIDENCE_ATTACH', task_id: pre02.id, expected_version: 2, payload: { evidence_path: 'DEVTaskEvidenceAttachRequests_Images/contract.pdf' } };
  const first = f.adapter().command(request);
  const replay = f.adapter().command(request);
  assert.equal(first.result.job.workflow_stage, 'ReadyToBook');
  assert.equal(first.result.readiness.stage_advanced, true);
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(f.tables.AuditEvents.filter(a => a.action === 'WorkflowStage:ReadyToBook').length, 1);
  assert.equal(f.tables.Evidence.filter(e => e.drive_file_id === 'DRIVE-AUTO-PRE02').length, 1);
});
test('Tony reconcile allows Admin email when Session is blank and denies Office/unknown/inactive', () => {
  function tonyStore(people, roles) {
    const tables = {
      People: people,
      PersonRoles: roles,
      Jobs: [{ id: 'J-mtzl04hw-bdpt6i', original_gross_pence: 1040643, pilot_job: true, release_scope: 'R1', version: 1 }],
      InvoiceStages: []
    };
    return {
      getSheetId: () => requestRow.R1A_REQUEST_DEV_SHEET,
      getEnvironment: () => 'DEV',
      list: (n) => copy(tables[n] || []),
      get: (n, id) => copy((tables[n] || []).find((x) => x.id === id) || null),
      withLock: (fn) => fn(),
      tables
    };
  }
  const adminPeople = [{ id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', active: true }];
  const adminRoles = [{ id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true }];
  const processStub = (jobId, store) => {
    assert.equal(jobId, 'J-mtzl04hw-bdpt6i');
    return { stages_created: 2 };
  };
  const ok = JSON.parse(requestRow.runR1AReconcileTonyPaymentStages('lenny@simplesolarltd.co.uk', {
    cloudOptions: () => ({ store: tonyStore(adminPeople, adminRoles), config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET } }),
    processJobPayments: processStub
  }));
  assert.equal(ok.ok, true);
  assert.equal(ok.job_id, 'J-mtzl04hw-bdpt6i');
  assert.equal(ok.deposit_stage_id, 'IS-J-mtzl04hw-bdpt6i-deposit');
  assert.equal(ok.stages_created, 2);

  const office = JSON.parse(requestRow.runR1AReconcileTonyPaymentStages('tanya@example.test', {
    cloudOptions: () => ({
      store: tonyStore([{ id: 'P-tanya', email: 'tanya@example.test', active: true }], [{ person_id: 'P-tanya', role: 'Office', active: true }]),
      config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET }
    }),
    processJobPayments: processStub
  }));
  assert.deepEqual(office, { ok: false, error: 'R1A_ROLE_DENIED' });

  const unknown = JSON.parse(requestRow.runR1AReconcileTonyPaymentStages('nobody@example.test', {
    cloudOptions: () => ({ store: tonyStore(adminPeople, adminRoles), config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET } }),
    processJobPayments: processStub
  }));
  assert.deepEqual(unknown, { ok: false, error: 'R1A_UNKNOWN_OR_DUPLICATE_ACTOR' });

  const inactive = JSON.parse(requestRow.runR1AReconcileTonyPaymentStages('lenny@simplesolarltd.co.uk', {
    cloudOptions: () => ({
      store: tonyStore([{ id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', active: false }], adminRoles),
      config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET }
    }),
    processJobPayments: processStub
  }));
  assert.deepEqual(inactive, { ok: false, error: 'R1A_INACTIVE_ACTOR' });

  const missing = JSON.parse(requestRow.runR1AReconcileTonyPaymentStages('', {
    cloudOptions: () => ({ store: tonyStore(adminPeople, adminRoles), config: { environment: 'DEV', sheetId: requestRow.R1A_REQUEST_DEV_SHEET } }),
    processJobPayments: processStub
  }));
  assert.deepEqual(missing, { ok: false, error: 'R1A_AUTHENTICATED_EMAIL_REQUIRED' });
});
test('request-row reader is exact-id, DEV-only, and never writes the helper sheet', () => {
  const headers = ['id', 'command_id', 'submitted_by', 'customer_first_name'];
  const ss = fakeRequestSheet('DEVNewJobSoldRequests', headers, [['ROW-1', 'C-1', 'tanya@example.test', 'Alice'], ['ROW-1', 'C-2', 'tanya@example.test', 'Bob']]);
  assert.throws(() => requestRow._r1aReadRequestRowFromSpreadsheet(ss, 'DEVNewJobSoldRequests', 'ROW-1', requestRow.R1A_REQUEST_DEV_SHEET), /REQUEST_AMBIGUOUS/);
  const one = fakeRequestSheet('DEVNewJobSoldRequests', headers, [['ROW-9', 'C-9', 'tanya@example.test', 'Alice']]);
  assert.equal(requestRow._r1aReadRequestRowFromSpreadsheet(one, 'DEVNewJobSoldRequests', 'ROW-9', requestRow.R1A_REQUEST_DEV_SHEET).command_id, 'C-9');
  assert.throws(() => requestRow._r1aReadRequestRowFromSpreadsheet(one, 'DEVNewJobSoldRequests', 'ROW-9', 'other-sheet'), /DEV_ONLY/);
  assert.throws(() => requestRow._r1aCommandFromRequestRow('SOLD_INTAKE', 'ROW-9', '', { sessionEmail: '', readRow: () => ({}) }), /AUTHENTICATED_EMAIL_REQUIRED/);
  assert.throws(() => requestRow._r1aCommandFromRequestRow('NOPE', 'ROW-9', 'tanya@example.test', { sessionEmail: 'tanya@example.test', readRow: () => ({}) }), /UNKNOWN_COMMAND/);
  assert.equal(JSON.parse(requestRow.appSheetR1CommandFromRequestRow('SOLD_INTAKE', 'missing', 'tanya@example.test')).ok, false);
});

test('ISSUE_CREATE creates one Issues row via S10, journals and audits, and does not mutate Jobs', () => {
  const ops = require('../s10/operations.js');
  global._s10CreateIssue = ops.createIssue;
  const f = fixture();
  f.tables.PersonRoles = f.tables.PersonRoles.filter(r => !(r.person_id === 'P-hannah' && r.role === 'Office'));
  f.tables.IssueEvents = f.tables.IssueEvents || [];
  f.tables.TaskTemplates = f.tables.TaskTemplates || [];
  f.tables.Holidays = f.tables.Holidays || [];
  f.tables.CommitJournal = f.tables.CommitJournal || [];
  f.options.services = serviceCore._r1sServices();
  const beforeJobs = JSON.stringify(f.tables.Jobs);
  const r = f.adapter().command({
    command_id: 'ISS-CREATE-1',
    command_type: 'ISSUE_CREATE',
    job_id: 'J-1',
    expected_version: 1,
    payload: {
      issue_type: 'Complaint',
      title: 'Customer unhappy',
      description: 'Panels noisy after install',
      severity: 'Medium',
      owner_id: 'P-tanya',
      customer_impact: true,
      requested_by: 'tanya@example.test'
    }
  });
  assert.equal(r.result.status, 'Created');
  assert.equal(r.result.external_calls, 0);
  assert.equal(r.result.issue_id, 'ISS-R1A-ISS-CREATE-1');
  assert.equal(f.tables.Issues.filter(i => i.id === 'ISS-R1A-ISS-CREATE-1').length, 1);
  const issue = f.tables.Issues.find(i => i.id === 'ISS-R1A-ISS-CREATE-1');
  assert.equal(issue.job_id, 'J-1');
  assert.equal(issue.type, 'Complaint');
  assert.equal(issue.category, 'Customer unhappy');
  assert.equal(issue.description, 'Panels noisy after install');
  assert.equal(issue.severity, 'Medium');
  assert.equal(issue.status, 'Open');
  assert.equal(issue.office_owner_id, 'P-tanya');
  assert.equal(issue.raised_by, 'P-tanya');
  assert.equal(issue.blocks_completion, true);
  assert.equal(f.tables.IssueEvents.some(e => e.issue_id === issue.id && e.event_type === 'Opened'), true);
  assert.equal(f.tables.AuditEvents.some(e => e.entity_id === issue.id && e.action === 'Create'), true);
  assert.equal(f.tables.Tasks.some(t => t.related_entity_id === issue.id && t.template_code === 'ISS02'), true);
  assert.equal(JSON.stringify(f.tables.Jobs), beforeJobs);
  const replay = f.adapter().command({
    command_id: 'ISS-CREATE-1',
    command_type: 'ISSUE_CREATE',
    job_id: 'J-1',
    expected_version: 1,
    payload: {
      issue_type: 'Complaint',
      title: 'Customer unhappy',
      description: 'Panels noisy after install',
      severity: 'Medium',
      owner_id: 'P-tanya',
      customer_impact: true,
      requested_by: 'tanya@example.test'
    }
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(f.tables.Issues.filter(i => i.id === 'ISS-R1A-ISS-CREATE-1').length, 1);
  assert.throws(() => f.adapter().command({
    command_id: 'ISS-CREATE-STALE',
    command_type: 'ISSUE_CREATE',
    job_id: 'J-1',
    expected_version: 99,
    payload: { issue_type: 'Remedial', title: 'Leak', description: 'Roof leak' }
  }), /STALE_VERSION/);
  assert.throws(() => f.adapter().command({
    command_id: 'ISS-CREATE-BAD',
    command_type: 'ISSUE_CREATE',
    job_id: 'J-1',
    expected_version: 1,
    payload: { issue_type: 'Bug', title: 'x', description: 'y' }
  }), /INVALID_ISSUE_TYPE/);
  assert.throws(() => fixture('installer@example.test').adapter().command({
    command_id: 'ISS-CREATE-DENY',
    command_type: 'ISSUE_CREATE',
    job_id: 'J-1',
    expected_version: 1,
    payload: { issue_type: 'Complaint', title: 'x', description: 'y' }
  }), /ROLE_DENIED/);
});

test('ISSUE_CREATE request-row builds canonical command without AppSheet JSON', () => {
  const ops = require('../s10/operations.js');
  global._s10CreateIssue = ops.createIssue;
  const f = fixture();
  f.tables.PersonRoles = f.tables.PersonRoles.filter(r => !(r.person_id === 'P-hannah' && r.role === 'Office'));
  f.tables.IssueEvents = [];
  f.tables.TaskTemplates = [];
  f.tables.Holidays = [];
  f.tables.CommitJournal = [];
  f.options.services = serviceCore._r1sServices();
  const result = requestRow._r1aCommandFromRequestRow('ISSUE_CREATE', 'ROW-ISS', 'tanya@example.test', {
    sessionEmail: 'tanya@example.test',
    readRow: () => ({
      id: 'ROW-ISS',
      command_id: 'ISS-ROW-1',
      job_id: 'J-1',
      expected_version: 1,
      issue_type: 'Remedial',
      title: 'Return visit',
      description: 'Needs return',
      severity: 'Normal',
      owner_id: 'P-tanya',
      customer_impact: false,
      requested_by: 'tanya@example.test',
      requested_at: new Date('2026-09-10T10:00:00.000Z')
    }),
    dispatch: (request, actorEmail) => {
      assert.equal(actorEmail, 'tanya@example.test');
      assert.equal(request.command_type, 'ISSUE_CREATE');
      assert.equal(request.job_id, 'J-1');
      assert.equal(request.expected_version, 1);
      assert.equal(request.payload.issue_type, 'Remedial');
      assert.equal(request.payload.title, 'Return visit');
      assert.equal(request.payload.customer_impact, false);
      assert.equal(request.payload.requested_at, '2026-09-10T10:00:00.000Z');
      return f.adapter().command(request);
    }
  });
  assert.equal(result.result.status, 'Created');
  assert.equal(result.result.issue.blocks_completion, false);
  assert.equal(serviceCore.R1A_ISSUE_CREATE_REQUEST_COLUMNS[0], 'id');
  assert.equal(serviceCore.R1A_ISSUE_CREATE_REQUEST_COLUMNS.includes('issue_type'), true);
  assert.equal(serviceCore.R1A_ISSUE_CREATE_REQUEST_COLUMNS.at(-1), 'result_message');
  assert.equal(requestRow.R1A_REQUEST_TABLES.ISSUE_CREATE, 'DEVCreateIssueRequests');
});

test('TASK_REOPEN restores Complete/NotRequired to Open with audit history and PRE01 gate demotion', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const requestRow = require('../r1-appsheet/request-row.js');
  const f = fixture();
  installIntake(f);
  const sold = f.adapter().command({ command_id: 'SOLD-REOPEN', command_type: 'SOLD_INTAKE', payload: soldPayload() });
  const jobId = sold.result.job_id;
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE02');
  const pre03 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE03');
  assert.ok(pre01 && pre02 && pre03);

  const completed = f.adapter().command({
    command_id: 'PRE01-BEFORE-REOPEN', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version,
    payload: { completion_note: 'Deposit invoice sent to customer', invoice_number: 'INV-REOPEN-1', invoice_sent: 'Yes' }
  });
  assert.equal(completed.result.status, 'Completed');
  const completedTask = f.tables.Tasks.find(t => t.id === pre01.id);
  const priorNote = completedTask.completion_note;
  const priorVersion = completedTask.version;
  const depositBefore = Object.assign({}, f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit'));
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, true);

  // Force ReadyToBook so reopen must demote when PRE01 becomes outstanding again.
  f.tables.Jobs.find(j => j.id === jobId).workflow_stage = 'ReadyToBook';
  f.tables.Jobs.find(j => j.id === jobId).version = Number(f.tables.Jobs.find(j => j.id === jobId).version) + 1;

  assert.throws(() => f.adapter().command({
    command_id: 'REOPEN-STALE', command_type: 'TASK_REOPEN', task_id: pre01.id, expected_version: 1,
    payload: { reopen_reason: 'stale' }
  }), /STALE_VERSION/);

  const priorEmail = f.options.actorEmail;
  f.options.actorEmail = () => 'hannah@example.test';
  assert.throws(() => f.adapter().command({
    command_id: 'REOPEN-UNAUTH', command_type: 'TASK_REOPEN', task_id: pre01.id, expected_version: priorVersion,
    payload: { reopen_reason: 'not owner' }
  }), /JOB_ACCESS_DENIED|TASK_ACCESS_DENIED/);
  f.options.actorEmail = priorEmail;

  assert.throws(() => f.adapter().command({
    command_id: 'REOPEN-OPEN', command_type: 'TASK_REOPEN', task_id: pre02.id, expected_version: pre02.version,
    payload: { reopen_reason: 'still open' }
  }), /TASK_NOT_REOPENABLE/);

  const availOpen = f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre02.id });
  assert.equal(availOpen.data.appsheet_commands.task_reopen.available, false);
  const availComplete = f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre01.id });
  assert.equal(availComplete.data.appsheet_commands.task_reopen.available, true);
  assert.equal(availComplete.data.appsheet_commands.task_complete.available, false);

  const row = {
    id: 'REQ-REOPEN-1', command_id: 'REOPEN-OK', task_id: pre01.id, expected_version: priorVersion,
    reopen_reason: 'Acceptance correction: PRE01 completed without valid invoice evidence',
    submitted_by: 'tanya@example.test', submitted_at: '2026-09-14T12:00:00.000Z', status: 'Ready',
    result_status: '', result_message: ''
  };
  assert.throws(() => requestRow._r1aCommandFromRequestRow('TASK_REOPEN', 'REQ-REOPEN-1', 'ben@example.test', {
    readRow: () => row, dispatch: () => null
  }), /ACTOR_MISMATCH/);

  const reopened = requestRow._r1aCommandFromRequestRow('TASK_REOPEN', 'REQ-REOPEN-1', 'tanya@example.test', {
    readRow: () => row,
    dispatch: (request) => f.adapter().command(request)
  });
  assert.equal(reopened.result.status, 'Reopened');
  assert.equal(reopened.result.external_calls, 0);
  const taskAfter = f.tables.Tasks.find(t => t.id === pre01.id);
  assert.equal(taskAfter.status, 'Open');
  assert.equal(taskAfter.completed_at, null);
  assert.equal(taskAfter.completed_by, null);
  assert.equal(taskAfter.completion_note, priorNote);
  assert.equal(taskAfter.version, priorVersion + 1);
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, false);
  const jobAfter = f.tables.Jobs.find(j => j.id === jobId);
  assert.equal(jobAfter.workflow_stage, 'Prebooking');
  assert.equal(gates.evaluateReadyToBook(jobAfter, f.store).ready, false);
  const depositAfter = f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit');
  assert.equal(depositAfter.invoice_number, depositBefore.invoice_number);
  assert.equal(depositAfter.sent_at, depositBefore.sent_at);
  assert.ok(f.tables.TaskEvents.some(e => e.task_id === pre01.id && e.action === 'Complete'));
  assert.ok(f.tables.TaskEvents.some(e => e.task_id === pre01.id && e.action === 'Reopen' && e.old_status === 'Complete' && e.new_status === 'Open'));
  assert.ok(f.tables.AuditEvents.some(a => a.entity_id === pre01.id && a.action === 'Reopen'));
  assert.ok(f.tables.AuditEvents.some(a => a.entity_id === jobId && a.action === 'WorkflowStage:Prebooking'));
  assert.ok(f.tables.CommitJournal.some(j => j.id === 'CJ-R1A-REOPEN-OK' && j.state === 'Committed'));

  const replay = requestRow._r1aCommandFromRequestRow('TASK_REOPEN', 'REQ-REOPEN-1', 'tanya@example.test', {
    readRow: () => row,
    dispatch: (request) => f.adapter().command(request)
  });
  assert.equal(replay.result.status, 'Replayed');
  assert.equal(f.tables.Tasks.find(t => t.id === pre01.id).version, priorVersion + 1);

  const recompleted = f.adapter().command({
    command_id: 'PRE01-AFTER-REOPEN', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: taskAfter.version,
    payload: { completion_note: 'Deposit invoice resent with reference', invoice_number: 'INV-REOPEN-2', invoice_sent: 'Yes' }
  });
  assert.equal(recompleted.result.status, 'Completed');
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE01').pass, true);
  assert.equal(f.tables.InvoiceStages.find(s => s.job_id === jobId && s.stage === 'deposit').invoice_number, 'INV-REOPEN-2');

  // NotRequired reopen path (Tanya-owned PRE02)
  Object.assign(pre02, { status: 'NotRequired', completed_at: '2026-09-14T10:00:00.000Z', completed_by: 'P-tanya', completion_note: 'N/A for test', version: 3 });
  const nr = f.adapter().command({
    command_id: 'REOPEN-NR', command_type: 'TASK_REOPEN', task_id: pre02.id, expected_version: 3,
    payload: { reopen_reason: 'Mark as required again' }
  });
  assert.equal(nr.result.status, 'Reopened');
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).status, 'Open');
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).completion_note, 'N/A for test');

  assert.match(fs.readFileSync('docs/R1-office-appsheet-configuration.md', 'utf8'), /DEVTaskReopenRequests/);
  assert.equal(requestRow.R1A_REQUEST_TABLES.TASK_REOPEN, 'DEVTaskReopenRequests');
});

test('PRE03 hardened: only authenticated manual bank verification reconciled to the canonical deposit stage can Complete PRE03 and unlock ReadyToBook (SS-SHHC-8091 shape)', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const BEN = 'ben@simplesolarltd.co.uk', DAN = 'dan@simplesolarltd.co.uk';
  const GOOD = { completion_note: 'Deposit seen on bank statement', deposit_bank_confirmed: 'Yes', deposit_amount: '2612.95', deposit_received_date: '2026-09-14', deposit_bank_reference: 'BACS SS-SHHC-8091' };
  let seq = 0;
  function setup(email = BEN) {
    const f = fixture('tanya@example.test');
    installIntake(f);
    seq += 1;
    const sold = f.adapter().command({ command_id: 'SOLD-PRE03H-' + seq, command_type: 'SOLD_INTAKE', payload: soldPayload({ gross_amount: 10451.78 }) });
    f.options.actorEmail = () => email;
    const job = f.tables.Jobs.find(j => j.id === sold.result.job_id);
    // Mirror the live DEV job: contract gross £10,451.78 → deposit InvoiceStage £2,612.95; PRE01/PRE02/PRE04 already valid.
    Object.assign(job, {
      original_gross_pence: 1045178, current_contract_gross_pence: 1045178,
      contract_status: 'Signed', contract_id: 'SIGNABLE-8091', contract_evidence_id: 'EV-CONTRACT-8091', contract_signed_at: '2026-09-10T10:00:00.000Z',
      customer_details_verified_at: '2026-09-11T10:00:00.000Z', customer_details_verified_by: 'P-tanya', sold_booking_match_status: 'Match', valuation_basis: 'Standard',
      deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null
    });
    if (!f.tables.Evidence) f.tables.Evidence = [];
    f.tables.Evidence.push({ id: 'EV-CONTRACT-8091', job_id: job.id, category: 'Contract', drive_file_id: 'DRIVE-8091', upload_status: 'Uploaded' });
    const stage = f.tables.InvoiceStages.find(s => s.job_id === job.id && s.stage === 'deposit');
    assert.equal(stage.gross_pence, 261295, 'SOLD_INTAKE derives the canonical £2,612.95 deposit stage');
    Object.assign(stage, { invoice_number: 'INV-8091', sent_at: '2026-09-09T10:00:00.000Z', status: 'Sent', reference: null });
    ['PRE01', 'PRE02', 'PRE04'].forEach(code => {
      const t = f.tables.Tasks.find(t => t.job_id === job.id && t.template_code === code);
      Object.assign(t, { status: 'Complete', completed_at: '2026-09-11T10:00:00.000Z', completed_by: t.owner_id, completion_note: 'Verified', evidence_id: code === 'PRE02' ? 'EV-CONTRACT-8091' : null, version: Number(t.version) + 1 });
    });
    const task = f.tables.Tasks.find(t => t.job_id === job.id && t.template_code === 'PRE03');
    assert.equal(task.owner_id, 'PERSON-ben');
    assert.equal(task.backup_id, 'PERSON-dan');
    const readiness = gates.evaluateReadyToBook(job, f.store);
    ['PRE01_satisfied', 'PRE02_satisfied', 'PRE04_satisfied', 'signed_contract_evidence', 'customer_value_verified'].forEach(n => assert.equal(readiness.gates.find(g => g.name === n).pass, true, n));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.gates.filter(g => !g.pass).map(g => g.name).sort().join(','), 'PRE03_satisfied,deposit_confirmation_evidence');
    return { f, job, task, stage, version: task.version };
  }
  function complete(x, commandId, payload, version) {
    return x.f.adapter().command({ command_id: commandId, command_type: 'TASK_COMPLETE', task_id: x.task.id, expected_version: version === undefined ? x.version : version, payload });
  }
  const snapshot = x => JSON.stringify({ jobs: x.f.tables.Jobs, tasks: x.f.tables.Tasks, stages: x.f.tables.InvoiceStages, mbc: x.f.tables.ManualBankChecks || [], journal: x.f.tables.CommitJournal, audit: x.f.tables.AuditEvents });

  // 1–5 (+ invalid formats, evidence-as-substitute): refused before any write.
  for (const [label, payload, re] of [
    ['note only', { completion_note: 'Customer emailed to say the deposit was paid' }, /REQUIRED_DEPOSIT_BANK_CONFIRMED/],
    ['confirmed yes only', { completion_note: 'Checked', deposit_bank_confirmed: 'Yes' }, /REQUIRED_DEPOSIT_AMOUNT/],
    ['missing reference', { ...GOOD, deposit_bank_reference: '' }, /REQUIRED_DEPOSIT_BANK_REFERENCE/],
    ['missing received date', { ...GOOD, deposit_received_date: '' }, /REQUIRED_DEPOSIT_RECEIVED_DATE/],
    ['missing amount', { ...GOOD, deposit_amount: '' }, /REQUIRED_DEPOSIT_AMOUNT/],
    ['three decimal places', { ...GOOD, deposit_amount: '2612.951' }, /INVALID_DEPOSIT_AMOUNT/],
    ['non-numeric amount', { ...GOOD, deposit_amount: 'two grand' }, /INVALID_DEPOSIT_AMOUNT/],
    ['malformed date', { ...GOOD, deposit_received_date: '14/09/2026' }, /INVALID_DEPOSIT_RECEIVED_DATE/],
    ['future date', { ...GOOD, deposit_received_date: '2099-01-01' }, /INVALID_DEPOSIT_RECEIVED_DATE/],
    ['document upload cannot substitute', { completion_note: 'Bank screenshot attached', evidence_id: 'EV-CONTRACT-8091' }, /REQUIRED_DEPOSIT_BANK_CONFIRMED/],
    ['unknown field', { ...GOOD, expected_deposit_amount: '1.00' }, /INVALID_FIELDS/]
  ]) {
    const x = setup();
    const before = snapshot(x);
    assert.throws(() => complete(x, 'PRE03-' + label.replaceAll(' ', '-'), payload), re, label);
    assert.equal(snapshot(x), before, label + ' must not write');
    assert.equal(x.f.tables.Tasks.find(t => t.id === x.task.id).status, 'Open');
  }
  {
    const x = setup();
    x.f.tables.InvoiceStages = x.f.tables.InvoiceStages.filter(s => s.job_id !== x.job.id);
    assert.throws(() => complete(x, 'PRE03-NO-STAGE', GOOD), /DEPOSIT_STAGE_MISSING/);
  }

  // 6: explicit No → Waiting with follow-up; no successful bank check; ReadyToBook blocked.
  {
    const x = setup();
    const r = complete(x, 'PRE03-NO', { completion_note: 'Nothing on the statement yet', deposit_bank_confirmed: 'No' });
    assert.equal(r.result.status, 'FollowUpRequired');
    const task = x.f.tables.Tasks.find(t => t.id === x.task.id), job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(task.status, 'Waiting');
    assert.equal(task.blocking_reason, 'PRE03_DEPOSIT_NOT_RECEIVED');
    assert.ok(task.next_followup_at);
    assert.equal(task.completed_at, null);
    assert.equal(job.deposit_bank_confirmed_at, null);
    assert.equal(job.deposit_bank_confirmed_by, null);
    assert.equal(job.deposit_bank_reference, null);
    assert.equal(job.workflow_stage, 'Prebooking');
    assert.equal(x.f.tables.ManualBankChecks.length, 1);
    assert.equal(x.f.tables.ManualBankChecks[0].outcome, 'NotReceived');
    assert.equal(x.f.tables.ManualBankChecks.filter(c => c.outcome === 'Confirmed').length, 0);
    assert.equal(x.f.tables.InvoiceStages.find(s => s.id === x.stage.id).status, 'Sent');
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, false);
    const rd = gates.evaluateReadyToBook(job, x.f.store);
    assert.equal(rd.ready, false);
    assert.equal(rd.gates.find(g => g.name === 'deposit_confirmation_evidence').pass, false);
    assert.equal(x.f.tables.CommitJournal.at(-1).state, 'Committed');
    assert.equal(x.f.tables.TaskEvents.at(-1).action, 'FollowUp');
    assert.equal(x.f.tables.AuditEvents.at(-1).initiating_actor, 'PERSON-ben');
  }

  // 7 + 18: wrong amount → Waiting, blocked, canonical amounts untouched, mismatch journaled; retry with the right amount completes.
  {
    const x = setup();
    const r = complete(x, 'PRE03-WRONG', { ...GOOD, deposit_amount: '2612.59' });
    assert.equal(r.result.status, 'FollowUpRequired');
    let task = x.f.tables.Tasks.find(t => t.id === x.task.id), job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(task.status, 'Waiting');
    assert.equal(task.blocking_reason, 'PRE03_DEPOSIT_AMOUNT_MISMATCH');
    assert.ok(task.next_followup_at);
    assert.equal(job.deposit_bank_confirmed_at, null);
    assert.equal(job.original_gross_pence, 1045178);
    assert.equal(job.current_contract_gross_pence, 1045178);
    const stage = x.f.tables.InvoiceStages.find(s => s.id === x.stage.id);
    assert.equal(stage.gross_pence, 261295);
    assert.equal(stage.status, 'Sent');
    assert.equal(stage.reference, null);
    assert.equal(x.f.tables.ManualBankChecks.length, 1);
    assert.equal(x.f.tables.ManualBankChecks[0].outcome, 'AmountMismatch');
    assert.equal(x.f.tables.ManualBankChecks[0].amount_pence, 261259);
    assert.equal(JSON.parse(x.f.tables.CommitJournal.at(-1).changes_json).deposit_amount, '2612.59');
    assert.equal(job.workflow_stage, 'Prebooking');
    assert.equal(gates.evaluateReadyToBook(job, x.f.store).ready, false);
    const retry = complete(x, 'PRE03-RETRY', GOOD, task.version);
    assert.equal(retry.result.status, 'Completed');
    task = x.f.tables.Tasks.find(t => t.id === x.task.id); job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(task.status, 'Complete');
    assert.equal(task.blocking_reason, null);
    assert.equal(x.f.tables.ManualBankChecks.map(c => c.outcome).sort().join(','), 'AmountMismatch,Confirmed');
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, true);
    assert.equal(job.workflow_stage, 'ReadyToBook');
  }

  // 15: unauthorized actors are refused with no writes (Hannah: Office, unassigned; Tanya: assigned to the job but not PRE03 owner/backup/Admin).
  {
    const x = setup('hannah@example.test');
    const before = snapshot(x);
    assert.throws(() => complete(x, 'PRE03-UNAUTH', GOOD), /JOB_ACCESS_DENIED|TASK_ACCESS_DENIED/);
    assert.equal(snapshot(x), before);
    x.f.options.actorEmail = () => 'tanya@example.test';
    assert.throws(() => complete(x, 'PRE03-UNAUTH-2', GOOD), /TASK_ACCESS_DENIED/);
    assert.equal(snapshot(x), before);
    x.f.options.actorEmail = () => '';
    assert.throws(() => complete(x, 'PRE03-UNAUTH-3', GOOD), /AUTHENTICATED_EMAIL_REQUIRED/);
    assert.equal(snapshot(x), before);
  }

  // 8–14, 17: Ben (owner) with £2,612.95 + Yes + date + reference + note → Complete, ManualBankChecks + Jobs stamped, ReadyToBook; exact replay idempotent.
  {
    const x = setup(BEN);
    const r = complete(x, 'PRE03-OK', GOOD);
    assert.equal(r.result.status, 'Completed');
    assert.equal(r.result.external_calls, 0);
    const task = x.f.tables.Tasks.find(t => t.id === x.task.id), job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(task.status, 'Complete');
    assert.equal(task.completed_by, 'PERSON-ben');
    assert.ok(task.completed_at);
    assert.equal(task.blocking_reason, null);
    assert.equal(task.completion_note, GOOD.completion_note);
    assert.equal(job.deposit_bank_confirmed_by, 'PERSON-ben');
    assert.equal(job.deposit_bank_confirmed_at, '2026-09-14T12:00:00.000Z');
    assert.equal(job.deposit_bank_reference, 'BACS SS-SHHC-8091');
    const mbc = x.f.tables.ManualBankChecks;
    assert.equal(mbc.length, 1);
    assert.deepEqual(
      { id: mbc[0].id, job_id: mbc[0].job_id, stage: mbc[0].stage, checked_by: mbc[0].checked_by, checked_at: mbc[0].checked_at, amount_pence: mbc[0].amount_pence, outcome: mbc[0].outcome, evidence_reference: mbc[0].evidence_reference, commit_id: mbc[0].commit_id },
      { id: 'MBC-R1A-PRE03-OK', job_id: job.id, stage: 'deposit', checked_by: 'PERSON-ben', checked_at: '2026-09-14T12:00:00.000Z', amount_pence: 261295, outcome: 'Confirmed', evidence_reference: 'BACS SS-SHHC-8091', commit_id: 'R1A-PRE03-OK' });
    assert.ok(mbc[0].created_at);
    assert.equal(r.result.bank_check.id, mbc[0].id);
    const stage = x.f.tables.InvoiceStages.find(s => s.id === x.stage.id);
    assert.equal(stage.status, 'Confirmed');
    assert.equal(stage.reference, 'BACS SS-SHHC-8091');
    assert.equal(stage.gross_pence, 261295);
    assert.equal(job.original_gross_pence, 1045178);
    assert.equal(job.current_contract_gross_pence, 1045178);
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, true);
    const rd = gates.evaluateReadyToBook(job, x.f.store);
    assert.equal(rd.gates.find(g => g.name === 'PRE03_satisfied').pass, true);
    assert.equal(rd.gates.find(g => g.name === 'deposit_confirmation_evidence').pass, true);
    assert.equal(rd.ready, true);
    assert.equal(rd.blocked, false);
    assert.equal(job.workflow_stage, 'ReadyToBook');
    assert.equal(r.result.readiness.stage_advanced, true);
    assert.equal(r.result.job.workflow_stage, 'ReadyToBook');
    assert.equal(x.f.tables.AuditEvents.filter(a => a.action === 'WorkflowStage:ReadyToBook').length, 1);
    assert.ok(x.f.tables.AuditEvents.some(a => a.entity_id === task.id && a.action === 'Complete' && a.initiating_actor === 'PERSON-ben'));
    assert.equal(x.f.tables.TaskEvents.filter(e => e.task_id === task.id && e.action === 'Complete').length, 1);
    assert.equal(x.f.tables.CommitJournal.find(j => j.id === 'CJ-R1A-PRE03-OK').state, 'Committed');

    const jobVersion = job.version, journals = x.f.tables.CommitJournal.length, audits = x.f.tables.AuditEvents.length;
    const replay = complete(x, 'PRE03-OK', GOOD);
    assert.equal(replay.result.status, 'Replayed');
    assert.equal(x.f.tables.ManualBankChecks.length, 1);
    assert.equal(x.f.tables.Jobs.find(j => j.id === job.id).version, jobVersion);
    assert.equal(x.f.tables.CommitJournal.length, journals);
    assert.equal(x.f.tables.AuditEvents.length, audits);
    assert.throws(() => complete(x, 'PRE03-OK', { ...GOOD, deposit_bank_reference: 'OTHER' }), /COMMAND_CONFLICT/);
    assert.throws(() => complete(x, 'PRE03-AGAIN', GOOD, task.version), /TASK_NOT_COMPLETABLE/);

    // 12/13: the gates read the persisted manual-bank state, not the task status.
    x.f.tables.ManualBankChecks[0].amount_pence = 261294;
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, false);
    assert.equal(gates.evaluateReadyToBook(x.f.tables.Jobs.find(j => j.id === job.id), x.f.store).gates.find(g => g.name === 'deposit_confirmation_evidence').pass, false);
    x.f.tables.ManualBankChecks[0].amount_pence = 261295;
    x.f.tables.ManualBankChecks[0].outcome = 'NotReceived';
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, false);
    x.f.tables.ManualBankChecks[0].outcome = 'Confirmed';
    x.f.tables.ManualBankChecks[0].checked_by = 'PERSON-dan';
    assert.equal(gates.bankConfirmationEvidence(x.f.store, job.id).pass, false);
    x.f.tables.ManualBankChecks[0].checked_by = 'PERSON-ben';
    assert.equal(gates.bankConfirmationEvidence(x.f.store, job.id).pass, true);
    x.f.tables.ManualBankChecks.length = 0;
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, false);
    assert.equal(gates.evaluateReadyToBook(x.f.tables.Jobs.find(j => j.id === job.id), x.f.store).ready, false);
  }

  // 16: Dan, as PRE03 backup, is authorized and attributed.
  {
    const x = setup(DAN);
    const r = complete(x, 'PRE03-DAN', GOOD);
    assert.equal(r.result.status, 'Completed');
    assert.equal(x.f.tables.Tasks.find(t => t.id === x.task.id).completed_by, 'PERSON-dan');
    const job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(job.deposit_bank_confirmed_by, 'PERSON-dan');
    assert.equal(x.f.tables.ManualBankChecks[0].checked_by, 'PERSON-dan');
    assert.equal(job.workflow_stage, 'ReadyToBook');
  }

  // DEVTaskCompleteRequests row → TASK_COMPLETE with AppSheet-shaped cells (Price number, Date cell, Enum text).
  {
    const requestRow = require('../r1-appsheet/request-row.js');
    const x = setup(BEN);
    const row = {
      id: 'REQ-PRE03-1', command_id: 'PRE03-ROW', task_id: x.task.id, expected_version: x.version, completion_note: 'Deposit seen in bank',
      evidence_path: '', evidence_id: '', invoice_number: '', invoice_sent: '', outcome: '', contract_id: '', contract_signed: '',
      customer_details_verified: '', sold_value_verified: '', verified_gross_amount: '',
      deposit_bank_confirmed: 'Yes', deposit_amount: 2612.95, deposit_received_date: new Date(2026, 8, 14), deposit_bank_reference: 'BACS SS-SHHC-8091',
      submitted_by: BEN, submitted_at: '2026-09-15T09:00:00.000Z', status: 'Ready', result_status: '', result_message: ''
    };
    assert.throws(() => requestRow._r1aCommandFromRequestRow('TASK_COMPLETE', 'REQ-PRE03-1', DAN, { readRow: () => row, dispatch: () => null }), /ACTOR_MISMATCH/);
    const built = [];
    const r = requestRow._r1aCommandFromRequestRow('TASK_COMPLETE', 'REQ-PRE03-1', BEN, { readRow: () => row, dispatch: req => { built.push(req); return x.f.adapter().command(req); } });
    assert.deepEqual(built[0].payload, { completion_note: 'Deposit seen in bank', deposit_bank_confirmed: 'Yes', deposit_amount: 2612.95, deposit_received_date: '2026-09-14', deposit_bank_reference: 'BACS SS-SHHC-8091' });
    assert.equal(r.result.status, 'Completed');
    assert.equal(x.f.tables.ManualBankChecks[0].amount_pence, 261295);
    assert.equal(x.f.tables.ManualBankChecks[0].checked_at, '2026-09-14T12:00:00.000Z');
    assert.equal(x.f.tables.Jobs.find(j => j.id === x.job.id).workflow_stage, 'ReadyToBook');
    const noRow = Object.assign({}, row, { id: 'REQ-PRE03-2', command_id: 'PRE03-ROW-NO', deposit_bank_confirmed: 'No', deposit_amount: '', deposit_received_date: '', deposit_bank_reference: '' });
    const y = setup(BEN);
    noRow.task_id = y.task.id; noRow.expected_version = y.version;
    const nr = requestRow._r1aCommandFromRequestRow('TASK_COMPLETE', 'REQ-PRE03-2', BEN, { readRow: () => noRow, dispatch: req => y.f.adapter().command(req) });
    assert.equal(nr.result.status, 'FollowUpRequired');
    assert.equal(y.f.tables.Tasks.find(t => t.id === y.task.id).status, 'Waiting');
    assert.equal(y.f.tables.Jobs.find(j => j.id === y.job.id).workflow_stage, 'Prebooking');
  }

  // 19: weak/legacy routes cannot bypass the hardened gate; the retained DEPOSIT_CONFIRM needs the same facts and de-duplicates.
  {
    const x = setup(BEN);
    // S13 library-style stamp (Jobs + InvoiceStage only, no ManualBankChecks) is not evidence.
    payments.confirmDeposit(x.f.store, x.job.id, 'PERSON-ben', 'WEAK-REF');
    let job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.ok(job.deposit_bank_confirmed_at);
    assert.equal(gates.bankConfirmationEvidence(x.f.store, job.id).pass, false);
    assert.equal(gates.evaluateReadyToBook(job, x.f.store).ready, false);
    // A hand-edited Complete PRE03 does not satisfy the gate either.
    const t = x.f.tables.Tasks.find(t => t.id === x.task.id);
    const openState = { status: t.status, completed_at: t.completed_at, completed_by: t.completed_by, completion_note: t.completion_note };
    Object.assign(t, { status: 'Complete', completed_at: '2026-09-14T12:00:00.000Z', completed_by: 'PERSON-ben', completion_note: 'sheet edit' });
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, false);
    assert.equal(gates.evaluateReadyToBook(job, x.f.store).ready, false);
    Object.assign(t, openState);
    // Legacy DEPOSIT_CONFIRM with a reference only is refused and writes nothing.
    const before = snapshot(x);
    assert.throws(() => x.f.adapter().command({ command_id: 'DEP-WEAK', command_type: 'DEPOSIT_CONFIRM', job_id: job.id, expected_version: job.version, payload: { reference: 'WEAK-REF' } }), /REQUIRED_DEPOSIT_BANK_CONFIRMED/);
    assert.equal(snapshot(x), before);
    assert.equal((x.f.tables.ManualBankChecks || []).length, 0);
    // With the full facts it repairs the weak stamp through the same recorder (no PRE03 completion, so still Prebooking).
    const fixed = x.f.adapter().command({ command_id: 'DEP-FULL', command_type: 'DEPOSIT_CONFIRM', job_id: job.id, expected_version: job.version, payload: { reference: 'BACS SS-SHHC-8091', deposit_bank_confirmed: 'Yes', deposit_amount: 2612.95, deposit_received_date: '2026-09-14' } });
    assert.equal(fixed.result.status, 'Confirmed');
    assert.equal(x.f.tables.ManualBankChecks.length, 1);
    job = x.f.tables.Jobs.find(j => j.id === x.job.id);
    assert.equal(job.deposit_bank_reference, 'BACS SS-SHHC-8091');
    assert.equal(gates.bankConfirmationEvidence(x.f.store, job.id).pass, true);
    assert.equal(gates.taskSatisfaction(x.f.store, job.id, 'PRE03').pass, false);
    assert.equal(job.workflow_stage, 'Prebooking');
    // PRE03 TASK_COMPLETE with the same facts re-uses the existing check (no duplicate) and unlocks ReadyToBook.
    const done = complete(x, 'PRE03-AFTER-LEGACY', GOOD, x.f.tables.Tasks.find(t => t.id === x.task.id).version);
    assert.equal(done.result.status, 'Completed');
    assert.equal(x.f.tables.ManualBankChecks.length, 1);
    assert.equal(done.result.bank_check.id, 'MBC-R1A-DEP-FULL');
    assert.equal(x.f.tables.Jobs.find(j => j.id === x.job.id).workflow_stage, 'ReadyToBook');
  }

  // 20: documentation names the structured columns and no longer routes PRE03 through DEPOSIT_CONFIRM.
  const doc = fs.readFileSync('docs/R1-office-appsheet-configuration.md', 'utf8');
  ['deposit_bank_confirmed', 'deposit_amount', 'deposit_received_date', 'deposit_bank_reference', 'ManualBankChecks'].forEach(k => assert.match(doc, new RegExp(k)));
  assert.doesNotMatch(doc, /For PRE03 use the separate .DEPOSIT_CONFIRM. command/);
});

test('Staff identification: R1 task and job reads show public Job ID, customer, postcode and people names; commands and authorization keep internal ids (SS-SHHC-8091 shape)', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const s17 = require('../s17/admin.js');
  const S17_READS = ['_s17OfficeToday', '_s17JobSearch', '_s17JobOverview', '_s17OperationalQueue', '_s17AdminReleaseModes', '_s17AdminSystemStatus', '_s17AuditHistory', '_s17ActionAvailability', '_s17TaskActionAvailability'];
  const saved = Object.fromEntries(S17_READS.map(k => [k, globalThis[k]]));
  S17_READS.forEach(k => { globalThis[k] = s17[k]; });
  try {
    const f = fixture('tanya@example.test');
    f.tables.People.find(p => p.id === 'P-tanya').display_name = 'Tanya';
    f.tables.People.find(p => p.id === 'P-ben').display_name = 'Office Admin';
    f.tables.People.find(p => p.id === 'P-hannah').display_name = 'Hannah';
    installIntake(f);
    f.options.reads = core._r1aDefaultReads();
    const parton = f.adapter().command({ command_id: 'SOLD-IDENT-PARTON', command_type: 'SOLD_INTAKE', payload: soldPayload({ customer_first_name: 'Jane', customer_last_name: 'Parton', postcode: 'TQ3 3HY', quote_reference: 'TQ33HY111', street_address: '12 Example Road', city: 'Paignton', email: 'parton@s05.example.invalid', phone: '07000000002' }) });
    const other = f.adapter().command({ command_id: 'SOLD-IDENT-OTHER', command_type: 'SOLD_INTAKE', payload: soldPayload({ customer_first_name: 'Olly', customer_last_name: 'Other', postcode: 'EX1 1AA', quote_reference: 'EX11AA222', street_address: '9 Other Lane', city: 'Exeter', email: 'olly@s05.example.invalid', phone: '07000000001' }) });
    const jobId = parton.result.job_id, otherId = other.result.job_id;
    assert.notEqual(jobId, otherId);
    // Mirror the live public reference (SOLD_INTAKE generates a random SS-XXXX-NNNN).
    const job = f.tables.Jobs.find(j => j.id === jobId);
    const generatedPublicId = job.job_id;
    job.job_id = 'SS-SHHC-8091';
    const helperRow = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE-COPY-JOBID');
    helperRow.title = helperRow.title.replace(generatedPublicId, 'SS-SHHC-8091');
    const customer = f.tables.Customers.find(c => c.id === job.customer_id);
    assert.deepEqual([customer.last_name, customer.postcode, job.quote_reference], ['Parton', 'TQ3 3HY', 'TQ33HY111']);

    // 1. Internal relationships stay canonical J-… / People ids; nothing presentational is persisted on Tasks.
    assert.match(job.id, /^J-[a-z0-9]+-[a-z0-9]+$/);
    const stored = f.tables.Tasks.filter(t => t.job_id === jobId);
    assert.ok(stored.length >= 5);
    stored.forEach(t => { assert.equal(t.job_id, job.id); assert.doesNotMatch(t.job_id, /^SS-/); assert.match(t.owner_id, /^(P|PERSON)-/); });
    assert.equal(f.tables.Tasks.some(t => ['public_job_id', 'customer_name', 'postcode', 'owner_name', 'backup_name', 'search_text'].some(k => k in t)), false);
    const before = JSON.stringify(f.tables);

    // 2–5. MY_TASKS / OFFICE_HOME / OPERATIONAL_QUEUE rows resolve public Job ID, customer, postcode and owner names.
    const mine = f.adapter().read({ read_type: 'MY_TASKS' }).data.tasks;
    const mineParton = mine.filter(t => t.job_id === jobId);
    ['PRE01', 'PRE02', 'PRE04', 'PRE-COPY-JOBID'].forEach(code => assert.ok(mineParton.some(t => t.template_code === code), code));
    mineParton.forEach(t => {
      assert.equal(t.public_job_id, 'SS-SHHC-8091');
      assert.equal(t.customer_name, 'Jane Parton');
      assert.equal(t.postcode, 'TQ3 3HY');
      assert.equal(t.owner_name, 'Tanya');
      assert.equal(t.job_label, 'SS-SHHC-8091 – Parton – TQ3 3HY');
      assert.equal(t.job_id, jobId);
      assert.equal(t.owner_id, 'P-tanya');
      assert.equal(t.search_text, core._r1aTaskSearchText(t), 'adapter and S17 search text formats stay identical');
    });
    assert.equal(mineParton.find(t => t.template_code === 'PRE-COPY-JOBID').backup_name, 'Office Admin');
    assert.doesNotMatch(mineParton.find(t => t.template_code === 'PRE01').title, /SS-SHHC-8091/);
    const home = f.adapter().read({ read_type: 'OFFICE_HOME' }).data;
    assert.ok(home.booking_review.filter(t => t.job_id === jobId).every(t => t.public_job_id === 'SS-SHHC-8091' && t.owner_name === 'Tanya'));
    f.options.actorEmail = () => 'ben@simplesolarltd.co.uk';
    const benPre03 = f.adapter().read({ read_type: 'MY_TASKS' }).data.tasks.find(t => t.job_id === jobId && t.template_code === 'PRE03');
    assert.deepEqual([benPre03.owner_id, benPre03.backup_id, benPre03.owner_name, benPre03.backup_name, benPre03.title], ['PERSON-ben', 'PERSON-dan', 'Ben', 'Dan', 'Confirm bank deposit']);
    f.options.actorEmail = () => 'tanya@example.test';

    // 6–8. Task queues are searchable by public Job ID, customer name and postcode (with or without the space).
    const partonIds = mineParton.map(t => t.id).sort();
    for (const q of ['SS-SHHC-8091', 'ss-shhc-8091', 'Parton', 'Jane Parton', 'TQ3 3HY', 'tq33hy', 'TQ3']) {
      const r = f.adapter().read({ read_type: 'MY_TASKS', query: q }).data;
      assert.deepEqual(r.tasks.map(t => t.id).sort(), partonIds, 'MY_TASKS query ' + q);
      assert.equal(r.count, partonIds.length);
    }
    assert.ok(f.adapter().read({ read_type: 'MY_TASKS', query: 'EX1 1AA' }).data.tasks.every(t => t.job_id === otherId));
    assert.equal(f.adapter().read({ read_type: 'MY_TASKS', query: 'no-such-customer-xyz' }).data.count, 0);
    assert.equal(f.adapter().read({ read_type: 'MY_TASKS', query: '' }).data.count, mine.length, 'blank query does not filter');
    const bookingQueue = f.adapter().read({ read_type: 'OPERATIONAL_QUEUE', queue: 'booking', query: 'TQ3 3HY' }).data;
    assert.ok(bookingQueue.count >= 4);
    assert.ok(bookingQueue.tasks.every(t => t.job_id === jobId && t.public_job_id === 'SS-SHHC-8091'));
    assert.ok(bookingQueue.tasks.some(t => t.template_code === 'PRE01'), 'search is not limited to the helper task title');
    const team = f.adapter().read({ read_type: 'TEAM_TASKS', query: 'Parton' }).data.tasks;
    assert.ok(team.some(t => t.template_code === 'PRE03' && t.owner_name === 'Ben' && t.customer_name === 'Jane Parton'));
    assert.ok(team.every(t => t.job_id === jobId && t.customer_redacted === undefined));
    for (const q of ['SS-SHHC-8091', 'Parton', 'Jane', 'TQ3 3HY', 'tq33hy', 'TQ33HY111', '12 Example Road', 'Paignton', jobId]) {
      const r = f.adapter().read({ read_type: 'JOB_SEARCH', query: q }).data;
      assert.equal(r.count, 1, 'JOB_SEARCH ' + q);
      assert.deepEqual([r.results[0].id, r.results[0].job_id, r.results[0].customer_name, r.results[0].postcode, r.results[0].quote_reference, r.results[0].job_label],
        [jobId, 'SS-SHHC-8091', 'Jane Parton', 'TQ3 3HY', 'TQ33HY111', 'SS-SHHC-8091 – Parton – TQ3 3HY']);
    }

    // 9. Commands and job reads still take internal ids; the public id is never a key.
    assert.throws(() => f.adapter().read({ read_type: 'JOB_OVERVIEW', job_id: 'SS-SHHC-8091' }), /JOB_NOT_FOUND/);
    const overview = f.adapter().read({ read_type: 'JOB_OVERVIEW', job_id: jobId }).data;
    assert.equal(overview.identity.id, jobId);
    assert.ok(overview.booking.tasks.every(t => t.job_id === jobId && t.public_job_id === 'SS-SHHC-8091'));
    assert.throws(() => f.adapter().command({ command_id: 'IDENT-PUBLIC-KEY', command_type: 'TASK_COMPLETE', task_id: 'SS-SHHC-8091', expected_version: 1, payload: { completion_note: 'x' } }), /TASK_NOT_FOUND/);

    // 10. Authorization is unchanged: unassigned Office users see no Parton customer identity or tasks.
    f.options.actorEmail = () => 'hannah@example.test';
    assert.equal(f.adapter().read({ read_type: 'JOB_SEARCH', query: 'Parton' }).data.count, 0);
    assert.equal(f.adapter().read({ read_type: 'JOB_SEARCH', query: 'SS-SHHC-8091' }).data.count, 0);
    assert.equal(f.adapter().read({ read_type: 'MY_TASKS', query: 'SS-SHHC-8091' }).data.count, 0);
    assert.throws(() => f.adapter().read({ read_type: 'JOB_OVERVIEW', job_id: jobId }), /JOB_ACCESS_DENIED/);
    const hannahTeam = f.adapter().read({ read_type: 'TEAM_TASKS' }).data.tasks.filter(t => t.job_id === jobId);
    assert.ok(hannahTeam.length > 0, 'TEAM_TASKS visibility itself is unchanged');
    hannahTeam.forEach(t => {
      assert.deepEqual([t.customer_name, t.postcode, t.customer_redacted, t.job_label, t.public_job_id], [null, null, true, 'SS-SHHC-8091', 'SS-SHHC-8091']);
      assert.doesNotMatch(t.search_text, /parton|tq3/);
    });
    assert.equal(f.adapter().read({ read_type: 'TEAM_TASKS', query: 'Parton' }).data.tasks.some(t => t.job_id === jobId), false);
    assert.equal(f.adapter().read({ read_type: 'TEAM_TASKS', query: 'TQ3 3HY' }).data.tasks.some(t => t.job_id === jobId), false);
    const pre01 = stored.find(t => t.template_code === 'PRE01');
    assert.throws(() => f.adapter().command({ command_id: 'IDENT-HANNAH', command_type: 'TASK_COMPLETE', task_id: pre01.id, expected_version: pre01.version, payload: { completion_note: 'x', invoice_number: 'INV-1', invoice_sent: 'Yes' } }), /JOB_ACCESS_DENIED|TASK_ACCESS_DENIED/);
    f.options.actorEmail = () => 'installer@example.test';
    assert.throws(() => f.adapter().read({ read_type: 'MY_TASKS', query: 'Parton' }), /ROLE_DENIED/);
    assert.equal(JSON.stringify(f.tables), before, 'presentation reads and refused requests write nothing');

    // 9 (cont). Completing a task from a presentation row uses the canonical Tasks.id / Jobs.id throughout.
    f.options.actorEmail = () => 'tanya@example.test';
    const helper = mineParton.find(t => t.template_code === 'PRE-COPY-JOBID');
    const helperStored = f.tables.Tasks.find(t => t.id === helper.id);
    const done = f.adapter().command({ command_id: 'IDENT-HELPER', command_type: 'TASK_COMPLETE', task_id: helper.id, expected_version: helperStored.version, payload: { completion_note: 'Booking form opened with the job preselected' } });
    assert.equal(done.result.status, 'Completed');
    const helperAfter = f.tables.Tasks.find(t => t.id === helper.id);
    assert.deepEqual([helperAfter.status, helperAfter.job_id, helperAfter.owner_id, helperAfter.completed_by], ['Complete', jobId, 'P-tanya', 'P-tanya']);
    assert.equal(f.tables.TaskEvents.at(-1).task_id, helper.id);
    assert.equal(f.tables.AuditEvents.at(-1).entity_id, helper.id);
    assert.equal(f.tables.AuditEvents.at(-1).initiating_actor, 'P-tanya');
    assert.equal(f.tables.CommitJournal.at(-1).entity_id, helper.id);
    assert.equal(f.tables.Jobs.find(j => j.id === jobId).workflow_stage, 'Prebooking', 'helper task is not a readiness gate');

    const doc = fs.readFileSync('docs/R1-office-appsheet-configuration.md', 'utf8');
    ['[owner_id].[display_name]', '[job_id].[job_id]', '[job_id].[customer_name]', '[job_id].[postcode]', 'PRE-COPY-JOBID'].forEach(k => assert.ok(doc.includes(k), 'doc mentions ' + k));
  } finally {
    S17_READS.forEach(k => { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; });
  }
});

test('Request-row result feedback: PRE02 without evidence writes ACTION REQUIRED to the row; a corrected request writes SUCCESS; follow-up, replay and other actors behave (TASK_COMPLETE 0c046a5b shape)', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const requestRow = require('../r1-appsheet/request-row.js'), cr = require('../r1-appsheet/command-result.js');
  const f = fixture('tanya@example.test');
  installIntake(f);
  f.tables.Evidence = [];
  f.options.resolveUpload = path => {
    if (path === 'DEVTaskCompleteRequests_Images/signed-5961.pdf') return { drive_file_id: 'DRIVE-SIGNED-5961', filename: 'signed-5961.pdf', mime_type: 'application/pdf' };
    const e = new Error('R1C_UPLOAD_PATH_INVALID'); e.code = 'R1C_UPLOAD_PATH_INVALID'; throw e;
  };
  const jobA = f.adapter().command({ command_id: 'SOLD-FEEDBACK-A', command_type: 'SOLD_INTAKE', payload: soldPayload() }).result.job_id;
  const jobB = f.adapter().command({ command_id: 'SOLD-FEEDBACK-B', command_type: 'SOLD_INTAKE', payload: soldPayload({ customer_last_name: 'Other', email: 'other@s05.example.invalid', phone: '07000000009' }) }).result.job_id;
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobA && t.template_code === 'PRE02');
  const pre02B = f.tables.Tasks.find(t => t.job_id === jobB && t.template_code === 'PRE02');
  const HEADERS = ['id', 'command_id', 'task_id', 'expected_version', 'completion_note', 'evidence_path', 'evidence_id', 'invoice_number', 'invoice_sent', 'outcome', 'contract_id', 'contract_signed', 'customer_details_verified', 'sold_value_verified', 'verified_gross_amount', 'deposit_bank_confirmed', 'deposit_amount', 'deposit_received_date', 'deposit_bank_reference', 'submitted_by', 'submitted_at', 'status', 'result_status', 'result_message', 'result_code', 'result', 'result_at'];
  const sheet = [], plans = [];
  const addRow = v => { const r = Object.assign(Object.fromEntries(HEADERS.map(h => [h, ''])), { submitted_by: 'tanya@example.test', submitted_at: '2026-09-15T09:00:00.000Z', status: 'Ready' }, v); sheet.push(r); return r; };
  const deps = email => ({
    readRow: (table, id) => { assert.equal(table, 'DEVTaskCompleteRequests'); const r = sheet.find(x => x.id === id); return r ? { ...r } : null; },
    dispatch: request => { f.options.actorEmail = () => email; return f.adapter().command(request); },
    writeResult: (table, id, update) => { const r = sheet.find(x => x.id === id); const plan = cr._r1rPlanWrite(HEADERS, r, update); plans.push(plan); if (plan.skip) return { written: false, reason: plan.skip }; Object.assign(r, plan.write); return { written: true, columns: Object.keys(plan.write) }; }
  });
  const run = (id, email = 'tanya@example.test') => requestRow._r1aRunRequestRowCommand('TASK_COMPLETE', id, email, deps(email));
  const operational = () => JSON.stringify({ tasks: f.tables.Tasks, jobs: f.tables.Jobs, evidence: f.tables.Evidence, journal: f.tables.CommitJournal, audit: f.tables.AuditEvents, events: f.tables.TaskEvents || [] });

  // Live defect: the command is refused and the refusal must reach the request row in staff language.
  const refused = addRow({ id: '0c046a5b', command_id: '0c046a5b', task_id: pre02.id, expected_version: pre02.version, completion_note: 'Signed contract received from customer', contract_id: 'DEV-CONTRACT-SS-SEXL-5961', contract_signed: 'Yes', evidence_id: '' });
  const before = operational();
  const r1 = run('0c046a5b');
  assert.equal(r1.ok, false);
  assert.equal(r1.error, 'R1A_REQUIRED_EVIDENCE_ID');
  assert.deepEqual(r1.feedback, { status: 'ActionRequired', heading: 'ACTION REQUIRED', message: 'Signed contract evidence is required. Add the signed contract evidence and try again.', code: 'R1A_REQUIRED_EVIDENCE_ID' });
  assert.equal(r1.request_result.written, true);
  assert.equal(refused.result_status, 'ActionRequired');
  assert.equal(refused.result_message, 'Signed contract evidence is required. Add the signed contract evidence and try again.');
  assert.doesNotMatch(refused.result_message, /R1A_/);
  assert.equal(refused.result_code, 'R1A_REQUIRED_EVIDENCE_ID');
  assert.deepEqual(JSON.parse(refused.result), { ok: false, command_type: 'TASK_COMPLETE', status: 'ActionRequired', code: 'R1A_REQUIRED_EVIDENCE_ID' });
  assert.ok(refused.result_at instanceof Date);
  assert.deepEqual([refused.status, refused.completion_note, refused.contract_id, refused.contract_signed, refused.submitted_by], ['Ready', 'Signed contract received from customer', 'DEV-CONTRACT-SS-SEXL-5961', 'Yes', 'tanya@example.test']);
  assert.equal(operational(), before, 'PRE02 validation is unchanged: nothing operational is written');
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).status, 'Open');
  assert.throws(() => requestRow._r1aCommandFromRequestRow('TASK_COMPLETE', '0c046a5b', 'tanya@example.test', deps('tanya@example.test')), /R1A_REQUIRED_EVIDENCE_ID/, 'the inner command path still refuses exactly as before');

  // Corrected resubmission is a NEW request row (new command id) and records success.
  const fixed = addRow({ id: '7d1e2f90', command_id: '7d1e2f90', task_id: pre02.id, expected_version: pre02.version, completion_note: 'Signed contract received from customer', contract_id: 'DEV-CONTRACT-SS-SEXL-5961', contract_signed: 'Yes', evidence_path: 'DEVTaskCompleteRequests_Images/signed-5961.pdf' });
  const r2 = run('7d1e2f90');
  assert.equal(r2.ok, true);
  assert.equal(r2.result.status, 'Completed');
  assert.deepEqual(r2.feedback, { status: 'Succeeded', heading: 'SUCCESS', message: 'Task completed successfully.', code: null });
  assert.deepEqual([fixed.result_status, fixed.result_message, fixed.result_code], ['Succeeded', 'Task completed successfully.', '']);
  assert.equal(JSON.parse(fixed.result).business_status, 'Completed');
  assert.equal(f.tables.Tasks.find(t => t.id === pre02.id).status, 'Complete');
  assert.equal(f.tables.Jobs.find(j => j.id === jobA).contract_status, 'Signed');
  assert.equal(refused.result_status, 'ActionRequired', 'the earlier refused row keeps its own result');

  // Exact replay returns success again without rewriting the row or repeating effects.
  const journals = f.tables.CommitJournal.length, at = fixed.result_at.getTime();
  const r3 = run('7d1e2f90');
  assert.equal(r3.result.status, 'Replayed');
  assert.equal(r3.feedback.status, 'Succeeded');
  assert.deepEqual(r3.request_result, { written: false, reason: 'FINAL_RESULT_PRESERVED' });
  assert.equal(fixed.result_at.getTime(), at);
  assert.equal(f.tables.CommitJournal.length, journals);
  assert.equal(f.tables.Evidence.length, 1);
  const direct = requestRow._r1aCommandFromRequestRow('TASK_COMPLETE', '7d1e2f90', 'tanya@example.test', deps('tanya@example.test'));
  assert.equal('feedback' in direct || 'request_result' in direct, false, 'inner command response shape unchanged');

  // Another user cannot overwrite Tanya's result.
  const r4 = run('7d1e2f90', 'ben@example.test');
  assert.match(r4.error, /ACTOR_MISMATCH/);
  assert.equal(r4.feedback.status, 'Failed');
  assert.deepEqual(r4.request_result, { written: false, reason: 'NOT_ROW_OWNER' });
  assert.equal(fixed.result_status, 'Succeeded');

  // Re-firing the refused row after the task completed: non-final result is updated with a readable reason.
  const r5 = run('0c046a5b');
  assert.equal(r5.error, 'R1A_STALE_VERSION');
  assert.deepEqual([refused.result_status, refused.result_message, refused.result_code], ['ActionRequired', 'This record changed after you opened the form. Go back, refresh, and try again.', 'R1A_STALE_VERSION']);

  // Sent / awaiting signature is saved, not an error, and not a completion.
  const waiting = addRow({ id: 'a1b2c3d4', command_id: 'a1b2c3d4', task_id: pre02B.id, expected_version: pre02B.version, completion_note: 'Contract sent via Signable', contract_id: 'DEV-CONTRACT-B', contract_signed: 'No' });
  const r6 = run('a1b2c3d4');
  assert.equal(r6.result.status, 'FollowUpRequired');
  assert.equal(waiting.result_status, 'FollowUpRequired');
  assert.match(waiting.result_message, /^Saved\. The contract is recorded as sent and awaiting signature, so this task is waiting for follow-up\. Next follow-up: \d{1,2} [A-Z][a-z]{2} \d{4}\.$/);
  assert.equal(f.tables.Tasks.find(t => t.id === pre02B.id).status, 'Waiting');
  const r7 = run('a1b2c3d4');
  assert.equal(r7.result.status, 'Replayed');
  assert.equal(r7.feedback.status, 'FollowUpRequired', 'a replay of a follow-up is still reported as follow-up');
  assert.equal(r7.request_result.reason, 'FINAL_RESULT_PRESERVED');
});

test('PRE02 evidence deadlock fix: Add contract evidence on an Open PRE02 stores Tasks.evidence_id without completing; TASK_COMPLETE then consumes it (SS-SEXL-5961 / TASK-mu0y0pqu-744gxg shape)', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const requestRow = require('../r1-appsheet/request-row.js'), cr = require('../r1-appsheet/command-result.js');
  const PATH = 'DEVTaskEvidenceAttachRequests_Files_/1296b8b1.evidence_path.105129.pdf';
  const REPLACEMENT = 'DEVTaskEvidenceAttachRequests_Files_/replacement.evidence_path.110000.pdf';
  const STILL_UPLOADING = 'DEVTaskEvidenceAttachRequests_Files_/still-uploading.pdf';
  const f = fixture('tanya@example.test');
  installIntake(f);
  f.tables.Evidence = [];
  f.tables.ManualBankChecks = [];
  f.options.resolveUpload = path => {
    if (path === PATH) return { drive_file_id: 'DRIVE-1296b8b1', filename: '1296b8b1.evidence_path.105129.pdf', mime_type: 'application/pdf' };
    if (path === REPLACEMENT) return { drive_file_id: 'DRIVE-REPLACEMENT', filename: 'replacement.evidence_path.110000.pdf', mime_type: 'application/pdf' };
    const e = new Error(path === STILL_UPLOADING ? 'R1C_UPLOAD_PENDING' : 'R1C_UPLOAD_PATH_INVALID'); e.code = e.message; throw e;
  };
  f.options.reads.taskActionAvailability = (s, id) => {
    const t = f.tables.Tasks.find(x => x.id === id);
    const ok = !!t && ['Open', 'Waiting', 'InProgress'].includes(t.status) && t.revision_required !== true;
    return { task_id: id, actions: { complete: { available: ok } } };
  };
  const as = email => { f.options.actorEmail = () => email; };
  const tableOf = n => f.tables[n] || [];
  const operational = () => JSON.stringify(['Tasks', 'Jobs', 'Evidence', 'CommitJournal', 'AuditEvents', 'TaskEvents', 'InvoiceStages', 'ManualBankChecks', 'Outbox'].map(tableOf));
  const sheet = { DEVTaskEvidenceAttachRequests: [], DEVTaskCompleteRequests: [] };
  const deps = email => ({
    readRow: (table, id) => { const r = sheet[table].find(x => x.id === id); return r ? { ...r } : null; },
    dispatch: request => { as(email); return f.adapter().command(request); },
    writeResult: (table, id, update) => { const r = sheet[table].find(x => x.id === id); const plan = cr._r1rPlanWrite(Object.keys(r), r, update); if (plan.skip) return { written: false, reason: plan.skip }; Object.assign(r, plan.write); return { written: true }; }
  });
  const runRow = (type, id, email = 'tanya@example.test') => requestRow._r1aRunRequestRowCommand(type, id, email, deps(email));
  const blank = { submitted_by: 'tanya@example.test', submitted_at: '2026-09-15T10:51:29.000Z', status: 'Ready', result_status: '', result_message: '', result_code: '', result: '', result_at: '' };
  const attachRow = v => { const r = { id: '', command_id: '', task_id: '', expected_version: '', evidence_path: '', ...blank, ...v }; sheet.DEVTaskEvidenceAttachRequests.push(r); return r; };
  const completeRow = v => { const r = { id: '', command_id: '', task_id: '', expected_version: '', completion_note: '', evidence_path: '', evidence_id: '', invoice_number: '', invoice_sent: '', outcome: '', contract_id: '', contract_signed: '', customer_details_verified: '', sold_value_verified: '', verified_gross_amount: '', deposit_bank_confirmed: '', deposit_amount: '', deposit_received_date: '', deposit_bank_reference: '', ...blank, ...v }; sheet.DEVTaskCompleteRequests.push(r); return r; };

  // Job A mirrors SS-SEXL-5961: everything except PRE02 already satisfies ReadyToBook.
  const jobId = f.adapter().command({ command_id: 'SOLD-PRE02-DEADLOCK', command_type: 'SOLD_INTAKE', payload: soldPayload() }).result.job_id;
  const job = f.tables.Jobs.find(j => j.id === jobId);
  Object.assign(job, {
    job_id: 'SS-SEXL-5961', contract_status: 'NotSent', contract_id: null, contract_evidence_id: null, contract_signed_at: null,
    customer_details_verified_at: '2026-09-14T10:00:00.000Z', customer_details_verified_by: 'P-tanya', sold_booking_match_status: 'Match', valuation_basis: 'Standard',
    deposit_bank_confirmed_at: '2026-09-14T12:00:00.000Z', deposit_bank_confirmed_by: 'P-ben', deposit_bank_reference: 'DEP-5961'
  });
  ['PRE01', 'PRE03', 'PRE04'].forEach(code => {
    const task = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === code);
    Object.assign(task, { status: 'Complete', completed_at: '2026-09-14T12:30:00.000Z', completed_by: task.owner_id, completion_note: 'Verified', version: 2 });
  });
  const deposit = f.tables.InvoiceStages.find(x => x.job_id === jobId && x.stage === 'deposit');
  Object.assign(deposit, { invoice_number: 'INV-5961', sent_at: '2026-09-14T11:00:00.000Z', status: 'Confirmed', reference: 'DEP-5961', version: 2 });
  f.tables.ManualBankChecks.push({ id: 'MBC-5961', job_id: jobId, stage: 'deposit', checked_at: '2026-09-14T12:00:00.000Z', checked_by: 'P-ben', amount_pence: deposit.gross_pence, outcome: 'Confirmed', evidence_reference: 'DEP-5961', created_at: '2026-09-14T12:00:00.000Z', commit_id: 'MBC-5961' });
  const pre02 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE02');
  const pre01 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE01');
  const pre04 = f.tables.Tasks.find(t => t.job_id === jobId && t.template_code === 'PRE04');
  assert.deepEqual([pre02.status, pre02.version, pre02.owner_id, pre02.evidence_id], ['Open', 1, 'P-tanya', null]);
  const failing = () => gates.evaluateReadyToBook(f.tables.Jobs.find(j => j.id === jobId), f.store).gates.filter(g => !g.pass).map(g => g.name).sort();
  assert.deepEqual(failing(), ['PRE02_satisfied', 'signed_contract_evidence']);

  // The live refusal stays: completing PRE02 without evidence is still refused.
  let before = operational();
  assert.throws(() => f.adapter().command({ command_id: 'PRE02-NO-EVIDENCE', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: 1, payload: { completion_note: 'Signed contract received from customer', contract_id: 'DEV-CONTRACT-SS-SEXL-5961', contract_signed: 'Yes' } }), /R1A_REQUIRED_EVIDENCE_ID/);
  assert.equal(operational(), before);

  // Action availability now offers Add contract evidence on an open PRE02 only.
  let avail = f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre02.id }).data.appsheet_commands;
  assert.deepEqual([avail.task_evidence_attach.available, avail.task_complete.available], [true, true]);
  before = operational();
  pre04.status = 'Open';
  assert.equal(f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre04.id }).data.appsheet_commands.task_evidence_attach.available, false);

  // Refusals write nothing: unrelated open tasks, wrong actors, stale version, missing or pending uploads.
  const attach = (commandId, taskId, version, evidence_path, email = 'tanya@example.test') => { as(email); return f.adapter().command({ command_id: commandId, command_type: 'TASK_EVIDENCE_ATTACH', task_id: taskId, expected_version: version, payload: { evidence_path } }); };
  Object.assign(pre01, { status: 'Open', completed_at: null, completed_by: null });
  const refusalsBefore = operational();
  for (const [label, fn, re] of [
    ['open PRE04 (unrelated template)', () => attach('ATT-PRE04', pre04.id, pre04.version, PATH), /R1A_TASK_NOT_ATTACHABLE/],
    ['open PRE01 (unrelated template)', () => attach('ATT-PRE01', pre01.id, pre01.version, PATH), /R1A_TASK_NOT_ATTACHABLE/],
    ['unassigned office user', () => attach('ATT-HANNAH', pre02.id, 1, PATH, 'hannah@example.test'), /JOB_ACCESS_DENIED/],
    ['assigned director who is not PRE02 owner/backup', () => attach('ATT-DAN', pre02.id, 1, PATH, 'dan@simplesolarltd.co.uk'), /TASK_ACCESS_DENIED/],
    ['installer role', () => attach('ATT-INSTALLER', pre02.id, 1, PATH, 'installer@example.test'), /ROLE_DENIED/],
    ['stale expected_version', () => attach('ATT-STALE', pre02.id, 2, PATH), /R1A_STALE_VERSION/],
    ['upload still pending', () => attach('ATT-PENDING', pre02.id, 1, STILL_UPLOADING), /R1C_UPLOAD_PENDING/],
    ['invalid upload path', () => attach('ATT-BADPATH', pre02.id, 1, 'nope/../x.pdf'), /R1C_UPLOAD_PATH_INVALID/],
    ['no file', () => attach('ATT-NOFILE', pre02.id, 1, ''), /R1A_REQUIRED_EVIDENCE_PATH/]
  ]) {
    assert.throws(fn, re, label);
    assert.equal(operational(), refusalsBefore, label + ' must not mutate operational state');
  }
  Object.assign(pre01, { status: 'Complete', completed_at: '2026-09-14T12:30:00.000Z', completed_by: pre01.owner_id });
  pre04.status = 'Complete';
  assert.equal(operational(), before);

  // Tanya uploads the signed contract to the Open PRE02 through the request-row bot path.
  const upload = attachRow({ id: '1296b8b1-retry', command_id: '1296b8b1-retry', task_id: pre02.id, expected_version: 1, evidence_path: PATH });
  const jobBefore = JSON.stringify(f.tables.Jobs.find(j => j.id === jobId));
  const stageAuditsBefore = f.tables.AuditEvents.filter(x => /^WorkflowStage:/.test(x.action)).length;
  const up = runRow('TASK_EVIDENCE_ATTACH', '1296b8b1-retry');
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(up.result.status, 'EvidenceUploaded');
  assert.equal(up.result.completion_required, true);
  assert.equal(up.result.readiness, null);
  assert.equal(up.result.external_calls, 0);
  assert.deepEqual(up.feedback, { status: 'FollowUpRequired', heading: 'SAVED – FOLLOW-UP NEEDED', message: 'Signed contract evidence uploaded. Complete the contract task to confirm it is signed.', code: null });
  assert.deepEqual([upload.result_status, upload.result_message, upload.result_code], ['FollowUpRequired', 'Signed contract evidence uploaded. Complete the contract task to confirm it is signed.', '']);
  assert.equal(JSON.parse(upload.result).completion_required, true);
  // Canonical Evidence row, linked to this job and task.
  const evidence = f.tables.Evidence.filter(e => e.job_id === jobId);
  assert.equal(evidence.length, 1);
  assert.deepEqual([evidence[0].category, evidence[0].drive_file_id, evidence[0].filename], ['Contract', 'DRIVE-1296b8b1', '1296b8b1.evidence_path.105129.pdf']);
  assert.equal(up.result.evidence_id, evidence[0].id);
  let task = f.tables.Tasks.find(t => t.id === pre02.id);
  assert.deepEqual([task.status, task.evidence_id, task.version, task.completed_at, task.completed_by, task.completion_note], ['Open', evidence[0].id, 2, null, null, pre02.completion_note]);
  // Upload alone is not a signed contract.
  assert.equal(JSON.stringify(f.tables.Jobs.find(j => j.id === jobId)), jobBefore, 'Job contract fields and version untouched');
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).contract_status, 'NotSent');
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE02').pass, false);
  assert.deepEqual(failing(), ['PRE02_satisfied', 'signed_contract_evidence']);
  assert.equal(f.tables.Jobs.find(j => j.id === jobId).workflow_stage, 'Prebooking');
  assert.equal(f.tables.AuditEvents.filter(x => /^WorkflowStage:/.test(x.action)).length, stageAuditsBefore);
  // Journal, TaskEvent and AuditEvent recorded as the authenticated actor.
  assert.equal(f.tables.CommitJournal.find(j => j.id === 'CJ-R1A-1296b8b1-retry').state, 'Committed');
  const taskEvents = f.tables.TaskEvents.filter(e => e.task_id === pre02.id && e.action === 'EvidenceAttach');
  assert.equal(taskEvents.length, 1);
  assert.deepEqual([taskEvents[0].old_status, taskEvents[0].new_status, taskEvents[0].actor, taskEvents[0].reason], ['Open', 'Open', 'P-tanya', 'TASK_EVIDENCE_ATTACH:PendingCompletion']);
  const audit = f.tables.AuditEvents.find(x => x.id === 'AE-R1A-1296b8b1-retry');
  assert.deepEqual([audit.action, audit.entity_id, audit.initiating_actor], ['EvidenceAttach', pre02.id, 'P-tanya']);
  assert.deepEqual([JSON.parse(audit.before_json).evidence_id, JSON.parse(audit.after_json).evidence_id], [null, evidence[0].id]);

  // Exact replay: same outcome, nothing duplicated, recorded result preserved.
  const afterUpload = operational();
  const replay = runRow('TASK_EVIDENCE_ATTACH', '1296b8b1-retry');
  assert.deepEqual([replay.result.status, replay.result.completion_required, replay.feedback.status], ['Replayed', true, 'FollowUpRequired']);
  assert.deepEqual(replay.request_result, { written: false, reason: 'FINAL_RESULT_PRESERVED' });
  assert.equal(operational(), afterUpload);
  as('tanya@example.test');
  assert.throws(() => f.adapter().command({ command_id: '1296b8b1-retry', command_type: 'TASK_EVIDENCE_ATTACH', task_id: pre02.id, expected_version: 1, payload: { evidence_path: REPLACEMENT } }), /R1A_COMMAND_CONFLICT/);
  assert.equal(operational(), afterUpload);

  // A Complete Task form opened before the upload is stale.
  assert.throws(() => f.adapter().command({ command_id: 'PRE02-OLD-FORM', command_type: 'TASK_COMPLETE', task_id: pre02.id, expected_version: 1, payload: { completion_note: 'x', contract_id: 'DEV-CONTRACT-SS-SEXL-5961', contract_signed: 'Yes', evidence_id: evidence[0].id } }), /R1A_STALE_VERSION/);
  assert.equal(operational(), afterUpload);
  avail = f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre02.id }).data.appsheet_commands;
  assert.deepEqual([avail.task_complete.available, avail.task_evidence_attach.available], [true, true]);

  // Complete Task opened from the task row carries the new version and Tasks.evidence_id (LINKTOFORM prefill).
  task = f.tables.Tasks.find(t => t.id === pre02.id);
  const complete = completeRow({ id: 'c0mplete', command_id: 'c0mplete', task_id: task.id, expected_version: task.version, evidence_id: task.evidence_id, completion_note: 'Signed contract received from customer', contract_id: 'DEV-CONTRACT-SS-SEXL-5961', contract_signed: 'Yes' });
  const done = runRow('TASK_COMPLETE', 'c0mplete');
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.result.status, 'Completed');
  assert.deepEqual(done.feedback, { status: 'Succeeded', heading: 'SUCCESS', message: 'Task completed successfully. The job is now Ready to Book.', code: null });
  assert.equal(complete.result_status, 'Succeeded');
  task = f.tables.Tasks.find(t => t.id === pre02.id);
  assert.deepEqual([task.status, task.evidence_id, task.version, task.completed_by], ['Complete', evidence[0].id, 3, 'P-tanya']);
  const jobAfter = f.tables.Jobs.find(j => j.id === jobId);
  assert.deepEqual([jobAfter.contract_id, jobAfter.contract_status, jobAfter.contract_evidence_id], ['DEV-CONTRACT-SS-SEXL-5961', 'Signed', evidence[0].id]);
  assert.ok(jobAfter.contract_signed_at);
  assert.equal(f.tables.Evidence.filter(e => e.job_id === jobId).length, 1, 'completion reuses the uploaded Evidence row');
  assert.equal(gates.taskSatisfaction(f.store, jobId, 'PRE02').pass, true);
  assert.deepEqual(failing(), []);
  assert.equal(jobAfter.workflow_stage, 'ReadyToBook');
  assert.equal(done.result.readiness.stage_advanced, true);
  assert.equal(f.tables.AuditEvents.filter(x => x.entity_id === jobId && x.action === 'WorkflowStage:ReadyToBook').length, 1);

  // After completion the evidence can't be attached again.
  assert.throws(() => attach('ATT-AFTER-COMPLETE', pre02.id, task.version, REPLACEMENT), /R1A_EVIDENCE_ALREADY_ATTACHED/);
  assert.equal(f.adapter().read({ read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre02.id }).data.appsheet_commands.task_evidence_attach.available, false);

  // Job B: contract sent (Waiting) → upload → replace upload → complete WITHOUT typing an evidence id.
  const jobB = f.adapter().command({ command_id: 'SOLD-PRE02-WAITING', command_type: 'SOLD_INTAKE', payload: soldPayload({ customer_last_name: 'Waiting', email: 'waiting@s05.example.invalid', phone: '07000000077' }) }).result.job_id;
  const pre02B = f.tables.Tasks.find(t => t.job_id === jobB && t.template_code === 'PRE02');
  as('tanya@example.test');
  assert.equal(f.adapter().command({ command_id: 'B-SENT', command_type: 'TASK_COMPLETE', task_id: pre02B.id, expected_version: 1, payload: { completion_note: 'Sent via Signable', contract_id: 'SIGNABLE-B', contract_signed: 'No' } }).result.status, 'FollowUpRequired');
  assert.deepEqual([f.tables.Tasks.find(t => t.id === pre02B.id).status, f.tables.Tasks.find(t => t.id === pre02B.id).version], ['Waiting', 2]);
  const first = attach('B-UPLOAD-1', pre02B.id, 2, REPLACEMENT);
  assert.equal(first.result.status, 'EvidenceUploaded');
  const second = attach('B-UPLOAD-2', pre02B.id, 3, PATH);
  assert.equal(second.result.status, 'EvidenceUploaded');
  let taskB = f.tables.Tasks.find(t => t.id === pre02B.id);
  assert.deepEqual([taskB.status, taskB.version, taskB.evidence_id], ['Waiting', 4, second.result.evidence_id]);
  assert.equal(f.tables.Evidence.filter(e => e.job_id === jobB).length, 2, 'the replaced upload keeps its Evidence row');
  assert.equal(f.tables.Jobs.find(j => j.id === jobB).contract_status, 'Sent');
  const doneB = f.adapter().command({ command_id: 'B-COMPLETE', command_type: 'TASK_COMPLETE', task_id: pre02B.id, expected_version: 4, payload: { completion_note: 'Signed copy returned', contract_id: 'SIGNABLE-B', contract_signed: 'Yes' } });
  assert.equal(doneB.result.status, 'Completed');
  taskB = f.tables.Tasks.find(t => t.id === pre02B.id);
  assert.deepEqual([taskB.status, taskB.evidence_id], ['Complete', second.result.evidence_id]);
  assert.deepEqual([f.tables.Jobs.find(j => j.id === jobB).contract_status, f.tables.Jobs.find(j => j.id === jobB).contract_evidence_id], ['Signed', second.result.evidence_id]);
  assert.equal(doneB.result.readiness.ready, false, 'readiness re-evaluated; other prebooking gates still outstanding');
  assert.equal(f.tables.Jobs.find(j => j.id === jobB).workflow_stage, 'Prebooking');

  for (const file of ['apps-script/r1-appsheet/R1AppSheetAdapter.js', 'standalone-bridge/AppSheetBridge.js']) {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /function _r1sPre02AttachMode\(/, file);
    assert.match(src, /status:'EvidenceUploaded',completion_required:true/, file);
  }
  const doc = fs.readFileSync('docs/R1-office-appsheet-configuration.md', 'utf8');
  assert.match(doc, /PRE02 signed contract sequence/);
  assert.match(doc, /"evidence_id", \[evidence_id\]/);
});

test('PRE03 owner: SOLD_INTAKE gives Ben ownership with Ben and Lenny both Admin in either order; DEV repair reassigns only the owner of an existing Lenny-owned PRE03 (SS-SEXL-5961 shape)', () => {
  const gates = require('../s06/gates.js');
  global.processBookingGates = gates.processBookingGates;
  global.evaluateReadyToBook = gates.evaluateReadyToBook;
  const requestRow = require('../r1-appsheet/request-row.js');
  function setup(lennyFirst) {
    const f = fixture('tanya@example.test');
    installIntake(f);
    // Live DEV seed shape: Ben and Lenny are both Admin and Ben holds no Director role.
    f.tables.PersonRoles = f.tables.PersonRoles.filter(r => !(r.person_id === 'PERSON-ben' && r.role === 'Director'));
    f.tables.People.find(p => p.id === 'PERSON-ben').role = 'Admin';
    f.tables.People.find(p => p.id === 'PERSON-dan').display_name = 'Dan Barnes';
    const lenny = { id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', display_name: 'Lenny DEV', role: 'Admin', active: true };
    const lennyRole = { id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true };
    const benRole = { id: 'PROLE-ben-admin', person_id: 'PERSON-ben', role: 'Admin', active: true };
    if (lennyFirst) { f.tables.People.unshift(lenny); f.tables.PersonRoles.unshift(lennyRole, benRole); }
    else { f.tables.PersonRoles.unshift(benRole); f.tables.People.push(lenny); f.tables.PersonRoles.push(lennyRole); }
    return f;
  }
  const pre03Of = (f, jobId) => f.tables.Tasks.filter(t => t.job_id === jobId && t.template_code === 'PRE03');

  // New jobs: owner is Ben whatever the Admin row order; replay does not duplicate or reassign.
  for (const lennyFirst of [true, false]) {
    const f = setup(lennyFirst);
    assert.equal(gates.resolvePersonByRole(f.store, 'Admin'), lennyFirst ? 'PERSON-lenny-dev' : 'PERSON-ben');
    const cmd = { command_id: 'SOLD-OWNER-' + lennyFirst, command_type: 'SOLD_INTAKE', payload: soldPayload() };
    const sold = f.adapter().command(cmd);
    let pre03 = pre03Of(f, sold.result.job_id);
    assert.equal(pre03.length, 1);
    assert.deepEqual([pre03[0].owner_id, pre03[0].backup_id], ['PERSON-ben', 'PERSON-dan'], 'lennyFirst=' + lennyFirst);
    assert.equal(f.adapter().command(cmd).result.status, 'Replayed');
    gates.processBookingGates(sold.result.job_id, f.store, { actor: 'P-tanya', command_id: 'REEVAL-' + lennyFirst });
    pre03 = pre03Of(f, sold.result.job_id);
    assert.equal(pre03.length, 1);
    assert.deepEqual([pre03[0].owner_id, pre03[0].backup_id, pre03[0].version], ['PERSON-ben', 'PERSON-dan', 1]);
  }

  // Existing live defect: a PRE03 created before the fix is owned by Lenny.
  const f = setup(true);
  const jobId = f.adapter().command({ command_id: 'SOLD-SEXL', command_type: 'SOLD_INTAKE', payload: soldPayload() }).result.job_id;
  const job = f.tables.Jobs.find(j => j.id === jobId);
  job.job_id = 'SS-SEXL-5961';
  const pre03 = pre03Of(f, jobId)[0];
  Object.assign(pre03, { owner_id: 'PERSON-lenny-dev', version: 3, due_at: '2026-09-15T08:00:00.000Z', original_due_at: '2026-09-15T08:00:00.000Z', status: 'Open', blocking_reason: null });
  const otherJobId = f.adapter().command({ command_id: 'SOLD-DONE', command_type: 'SOLD_INTAKE', payload: soldPayload({ customer_last_name: 'Done', email: 'done@s05.example.invalid', phone: '07000000055' }) }).result.job_id;
  Object.assign(pre03Of(f, otherJobId)[0], { owner_id: 'PERSON-lenny-dev', status: 'Complete', completed_at: '2026-09-14T12:00:00.000Z', completed_by: 'PERSON-lenny-dev', completion_note: 'Seen', version: 2 });
  const tablesJson = () => JSON.stringify(['Tasks', 'Jobs', 'CommitJournal', 'AuditEvents', 'TaskEvents', 'InvoiceStages', 'Evidence'].map(n => f.tables[n] || []));
  const deps = (email, extra = {}) => ({ cloudOptions: () => ({ store: f.store }), sessionEmail: '', actorEmail: email, ...extra });
  const run = (fn, ...args) => JSON.parse(fn(...args));
  const LENNY = 'lenny@simplesolarltd.co.uk';

  // Regeneration leaves the wrong owner alone; the explicit repair is required.
  gates.processBookingGates(jobId, f.store, { actor: 'P-tanya', command_id: 'REGEN-SEXL' });
  assert.equal(pre03Of(f, jobId)[0].owner_id, 'PERSON-lenny-dev');
  const before = tablesJson();
  const readinessBefore = JSON.stringify(gates.evaluateReadyToBook(f.tables.Jobs.find(j => j.id === jobId), f.store));

  // Read-only audit finds both Lenny-owned PRE03 tasks, marking the completed one as not repairable.
  const audit = run(requestRow.runR1APre03AssignmentAudit, deps(LENNY));
  assert.equal(audit.ok, true, JSON.stringify(audit));
  assert.deepEqual([audit.canonical_owner_id, audit.canonical_owner_name, audit.canonical_backup_id, audit.canonical_backup_name], ['PERSON-ben', 'Ben', 'PERSON-dan', 'Dan Barnes']);
  assert.deepEqual(audit.misassigned.map(r => [r.job_id_human, r.current_owner_name, r.action]).sort(), [[f.tables.Jobs.find(j => j.id === otherJobId).job_id, 'Lenny DEV', 'NotRepairable'], ['SS-SEXL-5961', 'Lenny DEV', 'Reassign']].sort());
  assert.equal(tablesJson(), before);

  // Dry run by public and internal id: plan only, nothing written.
  for (const ref of ['SS-SEXL-5961', 'ss-sexl-5961', jobId]) {
    const dry = run(requestRow.runR1ARepairPre03Assignment, ref, false, deps(LENNY));
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.deepEqual([dry.status, dry.dry_run, dry.applied], ['DryRun', true, false]);
    assert.deepEqual([dry.plan.task_id, dry.plan.action, dry.plan.current_owner_id, dry.plan.canonical_owner_id, dry.plan.current_backup_id, dry.plan.backup_matches, dry.plan.due_at],
      [pre03.id, 'Reassign', 'PERSON-lenny-dev', 'PERSON-ben', 'PERSON-dan', true, '2026-09-15T08:00:00.000Z']);
  }
  assert.equal(run(requestRow.runR1ARepairPre03Assignment, 'SS-SEXL-5961', 'true', deps(LENNY)).status, 'DryRun', 'only boolean true applies');
  assert.equal(tablesJson(), before);

  // Unauthorized or invalid callers are refused with no writes.
  for (const [label, args, re] of [
    ['office user', ['SS-SEXL-5961', true, deps('tanya@example.test')], /R1A_ROLE_DENIED/],
    ['unassigned office user', ['SS-SEXL-5961', true, deps('hannah@example.test')], /R1A_ROLE_DENIED/],
    ['director backup', ['SS-SEXL-5961', true, deps('dan@simplesolarltd.co.uk')], /R1A_ROLE_DENIED/],
    ['installer', ['SS-SEXL-5961', true, deps('installer@example.test')], /R1A_ROLE_DENIED/],
    ['unknown email', ['SS-SEXL-5961', true, deps('stranger@example.test')], /R1A_UNKNOWN_OR_DUPLICATE_ACTOR/],
    ['no identity', ['SS-SEXL-5961', true, deps('')], /R1A_AUTHENTICATED_EMAIL_REQUIRED/],
    ['argument differs from session', ['SS-SEXL-5961', true, deps(LENNY, { sessionEmail: 'tanya@example.test' })], /R1A_ACTOR_MISMATCH/],
    ['non-DEV store', ['SS-SEXL-5961', true, deps(LENNY, { cloudOptions: () => ({ store: Object.assign({}, f.store, { getEnvironment: () => 'PROD' }) }) })], /R1A_DEV_ONLY/],
    ['completed PRE03', [otherJobId, true, deps(LENNY)], /R1A_PRE03_NOT_OPEN/],
    ['unknown job', ['SS-NOPE-0000', true, deps(LENNY)], /R1A_JOB_NOT_FOUND/],
    ['non-pilot job', ['J-N', true, deps(LENNY)], /R1A_OUTSIDE_PILOT/]
  ]) {
    const r = run(requestRow.runR1ARepairPre03Assignment, ...args);
    assert.equal(r.ok, false, label);
    assert.match(r.error, re, label);
    assert.equal(tablesJson(), before, label + ' must not write');
  }
  f.tables.Jobs.push({ id: 'J-NO-PRE03', job_id: 'SS-NOPR-0003', pilot_job: true, release_scope: 'R1', finance_route: 'Standard', version: 1 });
  assert.match(run(requestRow.runR1ARepairPre03Assignment, 'SS-NOPR-0003', true, deps(LENNY)).error, /R1A_PRE03_MISSING/);
  f.tables.Jobs.pop();
  const unauthorizedAudit = run(requestRow.runR1APre03AssignmentAudit, deps('tanya@example.test'));
  assert.deepEqual([unauthorizedAudit.ok, unauthorizedAudit.error], [false, 'R1A_ROLE_DENIED']);

  // Apply as Lenny (Admin): only owner_id changes, version + 1, journal/event/audit written.
  const otherTasksBefore = JSON.stringify(f.tables.Tasks.filter(t => t.id !== pre03.id));
  const jobsBefore = JSON.stringify(f.tables.Jobs);
  const taskBefore = JSON.parse(JSON.stringify(pre03Of(f, jobId)[0]));
  const tasksCount = f.tables.Tasks.length;
  const applied = run(requestRow.runR1ARepairPre03Assignment, 'SS-SEXL-5961', true, deps(LENNY));
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.deepEqual([applied.status, applied.applied, applied.actor_id, applied.external_calls], ['Reassigned', true, 'PERSON-lenny-dev', 0]);
  const taskAfter = pre03Of(f, jobId)[0];
  const changed = Object.keys(taskAfter).filter(k => JSON.stringify(taskAfter[k]) !== JSON.stringify(taskBefore[k])).sort();
  assert.deepEqual(changed, ['commit_id', 'owner_id', 'updated_at', 'updated_by', 'version']);
  assert.deepEqual([taskAfter.id, taskAfter.owner_id, taskAfter.backup_id, taskAfter.status, taskAfter.due_at, taskAfter.original_due_at, taskAfter.version, taskAfter.updated_by],
    [taskBefore.id, 'PERSON-ben', 'PERSON-dan', 'Open', '2026-09-15T08:00:00.000Z', '2026-09-15T08:00:00.000Z', 4, 'PERSON-lenny-dev']);
  assert.equal(f.tables.Tasks.length, tasksCount, 'no task created or removed');
  assert.equal(JSON.stringify(f.tables.Tasks.filter(t => t.id !== pre03.id)), otherTasksBefore, 'PRE01/PRE02/PRE04 and other tasks untouched');
  assert.equal(JSON.stringify(f.tables.Jobs), jobsBefore, 'job untouched');
  assert.equal(JSON.stringify(gates.evaluateReadyToBook(f.tables.Jobs.find(j => j.id === jobId), f.store)), readinessBefore, 'readiness unchanged');
  const cmdId = 'PRE03-OWNER-REPAIR-' + pre03.id + '-V3';
  assert.equal(applied.command_id, cmdId);
  const journal = f.tables.CommitJournal.find(j => j.id === 'CJ-R1A-' + cmdId);
  assert.deepEqual([journal.state, journal.entity_id, journal.expected_version, JSON.parse(journal.changes_json).from_owner_id], ['Committed', pre03.id, 3, 'PERSON-lenny-dev']);
  const event = f.tables.TaskEvents.find(e => e.id === 'TE-R1A-' + cmdId);
  assert.deepEqual([event.action, event.old_owner, event.new_owner, event.old_status, event.new_status, event.old_due, event.new_due, event.actor],
    ['Reassign', 'PERSON-lenny-dev', 'PERSON-ben', 'Open', 'Open', '2026-09-15T08:00:00.000Z', '2026-09-15T08:00:00.000Z', 'PERSON-lenny-dev']);
  assert.match(event.reason, /Lenny DEV -> Ben/);
  const auditEvent = f.tables.AuditEvents.find(a => a.id === 'AE-R1A-' + cmdId);
  assert.deepEqual([auditEvent.action, auditEvent.entity_id, auditEvent.initiating_actor, JSON.parse(auditEvent.before_json).owner_id, JSON.parse(auditEvent.after_json).owner_id],
    ['Reassign', pre03.id, 'PERSON-lenny-dev', 'PERSON-lenny-dev', 'PERSON-ben']);

  // Re-running is idempotent; the audit is now clean for this job.
  const afterApply = tablesJson();
  const again = run(requestRow.runR1ARepairPre03Assignment, 'SS-SEXL-5961', true, deps(LENNY));
  assert.deepEqual([again.ok, again.status, again.applied], [true, 'AlreadyCorrect', false]);
  assert.equal(tablesJson(), afterApply);
  assert.equal(run(requestRow.runR1APre03AssignmentAudit, deps(LENNY)).misassigned.some(r => r.job_id === jobId), false);

  // Ben, now owner, can complete PRE03 through the normal command authorization.
  f.options.actorEmail = () => 'ben@simplesolarltd.co.uk';
  const avail = f.adapter().read({ read_type: 'MY_TASKS' }).data.tasks.find(t => t.id === pre03.id);
  assert.ok(avail, 'the repaired PRE03 appears in Ben\'s My Tasks');

  for (const file of ['standalone-bridge/AppSheetBridge.js', 'apps-script/r1-appsheet/R1AppSheetAdapter.js']) {
    const src = fs.readFileSync(file, 'utf8');
    for (const fn of ['runR1APre03AssignmentAudit', 'runR1ARepairPre03Assignment', 'runR1ARepairPre03AssignmentSSSEXL5961DryRun', 'runR1ARepairPre03AssignmentSSSEXL5961Apply', '_r1sRepairPre03Assignment']) assert.match(src, new RegExp('function ' + fn + '\\('), file + ' ' + fn);
  }
  assert.match(fs.readFileSync('standalone-bridge/AppSheetBridge.js', 'utf8'), /const S06_PRE03_RESPONSIBILITY = Object\.freeze/);
  assert.match(fs.readFileSync('docs/R1-office-appsheet-configuration.md', 'utf8'), /runR1ARepairPre03AssignmentSSSEXL5961Apply/);
});

test('PRE03 repair helpers in the generated standalone bridge resolve SS-SEXL-5961 by Jobs.job_id or Jobs.id with store/lookup/task diagnostics; dry runs write nothing; apply changes only the owner (live R1A_JOB_NOT_FOUND audit)', () => {
  const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
  const DEV = core.R1A_BOUND_DEV_SHEET_ID;
  const JOB = 'J-mu0y0if3-80gy83', PUBLIC = 'SS-SEXL-5961', TASK = 'TASK-sexl-pre03';
  function bridge(opts = {}) {
    const c = vm.createContext({ console: { log() {} }, Intl, Date, JSON, Number, Object, Array, String, Math, RegExp, Error });
    vm.runInContext(fs.readFileSync('standalone-bridge/AppSheetBridge.js', 'utf8'), c);
    const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
    for (const n of ['People', 'PersonRoles', 'ReleaseModes', 'Settings', 'TaskTemplates']) for (const r of seed[n] || []) tables[n].push({ ...r, version: 1 });
    tables.People.find(p => p.id === 'PERSON-ben').display_name = 'Ben';
    tables.People.find(p => p.id === 'PERSON-dan').display_name = 'Dan Barnes';
    tables.Jobs.push({ id: JOB, job_id: opts.publicCell || PUBLIC, customer_id: 'CUST-sexl', display_name: 'Privatename – PC1 1AA', finance_route: 'Standard', workflow_stage: 'Prebooking', pilot_job: true, release_scope: 'R1', source_system: 'R1-AppSheet', version: 4 });
    for (const j of opts.extraJobs || []) tables.Jobs.push(j);
    tables.Tasks.push({ id: TASK, job_id: JOB, template_code: 'PRE03', instance_key: 'PRE03-' + JOB, group: 'Prebooking', title: 'Confirm bank deposit', owner_id: 'PERSON-lenny-dev', backup_id: 'PERSON-dan', status: 'Open', due_at: '2026-09-15', original_due_at: '2026-09-15', priority: 2, version: 1 });
    tables.Tasks.push({ id: 'TASK-mu0y0pqu-744gxg', job_id: JOB, template_code: 'PRE02', title: 'Check contract sent/signed', owner_id: 'PERSON-tanya', status: 'Open', version: 2 });
    const grids = Object.fromEntries(schema.tables.map(t => { const h = t.columns.map(x => x.name); return [t.name, [h, ...tables[t.name].map(r => h.map(k => r[k] ?? ''))]]; }));
    const sheets = {};
    const sheet = n => sheets[n] || (sheets[n] = { getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 1000,
      getRange: (row, col, h = 1, w = 1) => ({ getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => grids[n][row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues: v => v.forEach((r, i) => r.forEach((x, j) => { grids[n][row - 1 + i] = grids[n][row - 1 + i] || []; grids[n][row - 1 + i][col - 1 + j] = x; })),
        setValue: x => { grids[n][row - 1][col - 1] = x; } }) });
    const ss = { getId: () => DEV, getName: () => 'Simple Solar DEV', getSheets: () => Object.keys(grids).map(sheet) };
    c.SpreadsheetApp = { openById: id => { assert.equal(id, DEV, 'bridge must open the exact DEV spreadsheet'); return ss; }, getActiveSpreadsheet: () => ss, flush() {} };
    c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV', sheetId: DEV }) }) };
    let active = opts.active === undefined ? 'lenny@simplesolarltd.co.uk' : opts.active;
    c.Session = { getActiveUser: () => ({ getEmail: () => active }), getEffectiveUser: () => ({ getEmail: () => active }) };
    let held = false;
    c.LockService = { getScriptLock: () => ({ waitLock() { assert.equal(held, false); held = true; }, releaseLock() { held = false; } }) };
    c.Logger = { log() {} };
    const rows = n => { const [h, ...b] = grids[n]; return b.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
    return { c, grids, rows, snapshot: () => JSON.stringify(grids), setActive: e => { active = e; } };
  }
  const noCustomerData = out => { for (const needle of ['CUST-sexl', 'Privatename', 'PC1 1AA', 'display_name', 'customer']) assert.equal(out.includes(needle), false, 'diagnostics must not expose ' + needle); };

  // The editor Run button calls functions with no arguments: that is what produced the live R1A_JOB_NOT_FOUND.
  let b = bridge();
  let before = b.snapshot();
  let raw = b.c.runR1ARepairPre03Assignment();
  let out = JSON.parse(raw);
  assert.deepEqual([out.ok, out.error], [false, 'R1A_JOB_REF_REQUIRED']);
  assert.match(out.diagnostics.hint, /runR1ARepairPre03AssignmentSSSEXL5961DryRun/);
  assert.deepEqual(out.diagnostics.store, { spreadsheet_id: DEV, spreadsheet_name: 'Simple Solar DEV', environment: 'DEV', jobs_rows: 1, tasks_rows: 2 });
  assert.equal(out.diagnostics.lookup.supplied_job_ref, null);
  assert.equal(b.snapshot(), before);

  // Audit: proves the store and finds the misassigned task.
  out = JSON.parse(b.c.runR1APre03AssignmentAudit());
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.diagnostics.store, { spreadsheet_id: DEV, spreadsheet_name: 'Simple Solar DEV', environment: 'DEV', jobs_rows: 1, tasks_rows: 2 });
  assert.deepEqual(out.misassigned.map(r => [r.job_id, r.job_id_human, r.task_id, r.current_owner_id, r.canonical_owner_id, r.action]), [[JOB, PUBLIC, TASK, 'PERSON-lenny-dev', 'PERSON-ben', 'Reassign']]);
  assert.equal(b.snapshot(), before);

  // Dry run by the wrapper (public ID), the generic function with the public ID, lower case, and the internal ID.
  const expectPlan = (label, text, matchedBy, supplied) => {
    const r = JSON.parse(text);
    assert.equal(r.ok, true, label + ' ' + text);
    assert.deepEqual([r.status, r.dry_run, r.applied], ['DryRun', true, false], label);
    assert.deepEqual(r.diagnostics.store, { spreadsheet_id: DEV, spreadsheet_name: 'Simple Solar DEV', environment: 'DEV', jobs_rows: 1, tasks_rows: 2 }, label);
    assert.deepEqual([r.diagnostics.lookup.supplied_job_ref, r.diagnostics.lookup.matched_by, r.diagnostics.lookup.resolved_job_internal_id, r.diagnostics.lookup.resolved_public_job_id], [supplied, matchedBy, JOB, PUBLIC], label);
    assert.deepEqual([r.diagnostics.pre03.task_id, r.diagnostics.pre03.task_ids], [TASK, [TASK]], label);
    assert.deepEqual([r.plan.task_id, r.plan.task_status, r.plan.current_owner_id, r.plan.canonical_owner_id, r.plan.current_backup_id, r.plan.canonical_backup_id, r.plan.backup_matches, r.plan.due_at, r.plan.action],
      [TASK, 'Open', 'PERSON-lenny-dev', 'PERSON-ben', 'PERSON-dan', 'PERSON-dan', true, '2026-09-15', 'Reassign'], label);
    noCustomerData(text);
    return r;
  };
  expectPlan('wrapper', b.c.runR1ARepairPre03AssignmentSSSEXL5961DryRun(), 'Jobs.job_id', PUBLIC);
  expectPlan('public ID', b.c.runR1ARepairPre03Assignment(PUBLIC, false), 'Jobs.job_id', PUBLIC);
  expectPlan('lower-case public ID', b.c.runR1ARepairPre03Assignment('ss-sexl-5961', false), 'Jobs.job_id', 'ss-sexl-5961');
  expectPlan('internal ID', b.c.runR1ARepairPre03Assignment(JOB, false), 'Jobs.id', JOB);
  assert.equal(b.snapshot(), before, 'dry runs write nothing');

  // Unknown reference: clear diagnostics, nothing written, no customer data.
  raw = b.c.runR1ARepairPre03Assignment('SS-NOPE-0000', false);
  out = JSON.parse(raw);
  assert.deepEqual([out.ok, out.error, out.diagnostics.lookup.public_id_matches, out.diagnostics.lookup.internal_id_matches, out.diagnostics.store.spreadsheet_id, out.diagnostics.store.jobs_rows], [false, 'R1A_JOB_NOT_FOUND', 0, 0, DEV, 1]);
  noCustomerData(raw);
  assert.equal(b.snapshot(), before);

  // A job_id cell carrying an invisible character (the other way to get the live error) now resolves and says so.
  const invisible = bridge({ publicCell: PUBLIC + '​' });
  const inv = expectPlan('invisible character in Jobs.job_id', invisible.c.runR1ARepairPre03AssignmentSSSEXL5961DryRun(), 'Jobs.job_id', PUBLIC);
  assert.equal(inv.diagnostics.lookup.normalized_match, true);

  // A reference matching one job's public ID and another job's internal ID is refused, not guessed.
  const clash = bridge({ extraJobs: [{ id: PUBLIC, job_id: 'SS-OTHR-0001', finance_route: 'Standard', pilot_job: true, release_scope: 'R1', workflow_stage: 'Prebooking', version: 1 }] });
  out = JSON.parse(clash.c.runR1ARepairPre03AssignmentSSSEXL5961DryRun());
  assert.deepEqual([out.ok, out.error, out.diagnostics.lookup.public_id_matches, out.diagnostics.lookup.internal_id_matches], [false, 'R1A_JOB_AMBIGUOUS', 1, 1]);

  // Unauthorised sessions are refused before any lookup.
  const office = bridge({ active: 'hannah@simplesolarltd.co.uk' });
  office.grids.People.push(office.grids.People[0].map((_, i) => ({ id: 'PERSON-hannah-live', email: 'hannah@simplesolarltd.co.uk', display_name: 'Hannah', role: 'Office', active: true })[office.grids.People[0][i]] ?? ''));
  office.grids.PersonRoles.push(office.grids.PersonRoles[0].map(k => ({ id: 'PROLE-hannah-live', person_id: 'PERSON-hannah-live', role: 'Office', active: true })[k] ?? ''));
  const officeBefore = office.snapshot();
  assert.equal(JSON.parse(office.c.runR1ARepairPre03AssignmentSSSEXL5961Apply()).error, 'R1A_ROLE_DENIED');
  assert.equal(office.snapshot(), officeBefore);

  // Apply through the wrapper: only the intended PRE03 cells change, plus journal/event/audit rows.
  const st = b.c._s17CloudStore();
  const readinessBefore = JSON.stringify(b.c.evaluateReadyToBook(st.get('Jobs', JOB), st));
  const tasksHeader = b.grids.Tasks[0], pre03Before = b.rows('Tasks').find(t => t.id === TASK), pre02Before = JSON.stringify(b.rows('Tasks').find(t => t.id !== TASK));
  const jobsBefore = JSON.stringify(b.grids.Jobs);
  out = JSON.parse(b.c.runR1ARepairPre03AssignmentSSSEXL5961Apply());
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual([out.status, out.applied, out.diagnostics.lookup.resolved_job_internal_id, out.diagnostics.pre03.task_id], ['Reassigned', true, JOB, TASK]);
  const pre03After = b.rows('Tasks').find(t => t.id === TASK);
  assert.deepEqual(tasksHeader.filter(k => JSON.stringify(pre03After[k]) !== JSON.stringify(pre03Before[k])).sort(), ['commit_id', 'owner_id', 'updated_at', 'updated_by', 'version']);
  assert.deepEqual([pre03After.id, pre03After.owner_id, pre03After.backup_id, pre03After.status, pre03After.due_at, pre03After.original_due_at, pre03After.version, pre03After.updated_by], [TASK, 'PERSON-ben', 'PERSON-dan', 'Open', '2026-09-15', '2026-09-15', 2, 'PERSON-lenny-dev']);
  assert.equal(JSON.stringify(b.rows('Tasks').find(t => t.id !== TASK)), pre02Before, 'other tasks untouched');
  assert.equal(JSON.stringify(b.grids.Jobs), jobsBefore, 'Job untouched');
  assert.equal(JSON.stringify(b.c.evaluateReadyToBook(st.get('Jobs', JOB), st)), readinessBefore, 'readiness unchanged');
  assert.deepEqual(b.rows('CommitJournal').map(j => [j.id, j.state, j.entity_id]), [['CJ-R1A-PRE03-OWNER-REPAIR-' + TASK + '-V1', 'Committed', TASK]]);
  assert.deepEqual(b.rows('TaskEvents').map(e => [e.action, e.task_id, e.old_owner, e.new_owner, e.actor]), [['Reassign', TASK, 'PERSON-lenny-dev', 'PERSON-ben', 'PERSON-lenny-dev']]);
  assert.deepEqual(b.rows('AuditEvents').map(a => [a.action, a.entity_id, a.initiating_actor]), [['Reassign', TASK, 'PERSON-lenny-dev']]);

  // Idempotent afterwards.
  const afterApply = b.snapshot();
  assert.equal(JSON.parse(b.c.runR1ARepairPre03AssignmentSSSEXL5961Apply()).status, 'AlreadyCorrect');
  assert.equal(JSON.parse(b.c.runR1ARepairPre03AssignmentSSSEXL5961DryRun()).plan.action, 'AlreadyCorrect');
  assert.equal(b.snapshot(), afterApply);
});
