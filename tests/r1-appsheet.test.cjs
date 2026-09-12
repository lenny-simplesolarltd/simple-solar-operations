const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../r1-appsheet/adapter.js'),serviceCore=require('../r1-appsheet/services.js');
const copy=x=>structuredClone(x);
function fixture(email='tanya@example.test'){
 const tables={People:[{id:'P-tanya',email:'tanya@example.test',active:true},{id:'P-hannah',email:'hannah@example.test',active:true},{id:'P-ben',email:'ben@example.test',active:true},{id:'P-installer',email:'installer@example.test',active:true},{id:'P-var',email:'var@example.test',active:true}],PersonRoles:[{person_id:'P-tanya',role:'Office',active:true},{person_id:'P-hannah',role:'Office',active:true},{person_id:'P-ben',role:'Admin',active:true},{person_id:'P-installer',role:'Installer',active:true},{person_id:'P-var',role:'VariationApprover',active:true}],Jobs:[{id:'J-1',pilot_job:true,release_scope:'R1',version:1,salesperson_id:null,workflow_stage:'Booked'},{id:'J-2',pilot_job:true,release_scope:'R1',version:1,salesperson_id:null},{id:'J-N',pilot_job:false,release_scope:'R1',version:1},{id:'J-OPC',pilot_job:true,release_scope:'R1',version:3,salesperson_id:null,workflow_stage:'Aftercare',operational_complete_at:null,archived_at:null},{id:'J-BKG',pilot_job:true,release_scope:'R1',version:2,salesperson_id:null,workflow_stage:'BookingInProgress',archived_at:null},{id:'J-DEP',pilot_job:true,release_scope:'R1',version:4,salesperson_id:null,workflow_stage:'Booked',deposit_bank_confirmed_at:null,archived_at:null}],Tasks:[{id:'T-1',job_id:'J-1',owner_id:'P-tanya',backup_id:null,version:2,status:'Open',revision_required:false,due_at:'2026-09-08'},{id:'T-H',job_id:'J-2',owner_id:'P-hannah',backup_id:null,version:1,status:'Open'},{id:'T-OPC',job_id:'J-OPC',owner_id:'P-tanya',backup_id:null,version:1,status:'Open'},{id:'T-BKG',job_id:'J-BKG',owner_id:'P-tanya',backup_id:null,version:1,status:'Open'},{id:'T-DEP',job_id:'J-DEP',owner_id:'P-tanya',backup_id:null,version:1,status:'Open'}],Issues:[{id:'I-1',job_id:'J-1',office_owner_id:'P-tanya',responsible_person_id:null,responsible_company_id:'CO-1',status:'Open',version:1}],WorkPackages:[{id:'WP-1',job_id:'J-1',planned_start:'2026-09-10',planned_end:'2026-09-11',revision:1,version:1}],InvoiceStages:[{id:'IS-J-DEP-deposit',job_id:'J-DEP',stage:'deposit',status:'Pending',version:1}],ReleaseModes:[{function_id:'FN-01',target_release:'R1',authorised_job_scope:'Pilot',mode:'Automated'},{function_id:'FN-11',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-15',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-17',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-19',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'},{function_id:'FN-20',target_release:'R1',authorised_job_scope:'Pilot',mode:'Manual'}],AuditEvents:[],TaskEvents:[],IssueEvents:[],CommitJournal:[],Calls:[],GHLTasks:[]};
 const store={getSheetId:()=>core.R1A_BOUND_DEV_SHEET_ID,getEnvironment:()=> 'DEV',list:n=>copy(tables[n]||[]),get:(n,id)=>copy((tables[n]||[]).find(x=>x.id===id)||null),insert:(n,r)=>{if((tables[n]||[]).some(x=>x.id===r.id))throw Error('duplicate');(tables[n]||(tables[n]=[])).push(copy(r));},update:(n,id,p)=>{const row=(tables[n]||[]).find(x=>x.id===id);if(!row)throw Error('missing');Object.assign(row,copy(p));},withLock:fn=>fn()};
 const reads={officeHome:()=>({overdue:copy(tables.Tasks),due_today:[],due_soon:[],booking_review:[],unresolved_issues:[],health_alerts:[]}),jobSearch:(s,q)=>{const qq=String(q).toLowerCase();return tables.Jobs.filter(j=>(j.id||'').toLowerCase().indexOf(qq)>=0||(j.job_id||'').toLowerCase().indexOf(qq)>=0).map(j=>({id:j.id,job_id:j.job_id||j.id,display_name:j.display_name||j.id,workflow_stage:j.workflow_stage,release_scope:j.release_scope}));},jobOverview:(s,id)=>({job_id:id}),operationalQueue:(s,q)=>({queue:q,count:2,tasks:copy(tables.Tasks)}),releaseModes:()=>copy(tables.ReleaseModes),systemStatus:()=>({ok:true}),auditHistory:(s,id)=>({job_id:id,events:copy(tables.AuditEvents)}),actionAvailability:(s,id)=>({job_id:id}),taskActionAvailability:(s,id)=>({task_id:id,actions:{complete:{available:true}}})};
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
test('sold intake refuses a forged service that is not the canonical handler and refuses extra envelope fields',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command({command_id:'C-I',command_type:'SOLD_INTAKE',job_id:'J-1',payload:{customer_first_name:'A'}}),/INVALID_FIELDS/);assert.throws(()=>f.adapter().command({command_id:'C-I2',command_type:'SOLD_INTAKE',payload:{customer_first_name:'A',workflow_stage:'Booked'}}),/INVALID_FIELDS/);});
test('unsupported fixture-scoped command fails closed',()=>assert.throws(()=>fixture().adapter().command(cmd()),/COMMAND_UNSUPPORTED/));
test('unrelated job command refused',()=>{const f=fixture('hannah@example.test');f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command(cmd()),/JOB_ACCESS_DENIED/)});
test('action reads expose exact AppSheet command flags',()=>{const f=fixture();let a=f.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-1'}),t=f.adapter().read({read_type:'TASK_ACTION_AVAILABILITY',task_id:'T-1'});assert.deepEqual(Object.keys(a.data.appsheet_commands),['call_record','issue_update','issue_create','planner_update','move_job','change_installer','cancel_job','reinstate_job','deposit_confirm','operational_complete','booking_gates','sold_intake','booking_intake']);assert.equal(a.data.appsheet_commands.call_record.available,true);assert.equal(a.data.appsheet_commands.issue_create.available,true);assert.equal(a.data.appsheet_commands.cancel_job.available,true);assert.equal(a.data.appsheet_commands.move_job.available,true);assert.equal(a.data.appsheet_commands.deposit_confirm.available,false);assert.equal(a.data.appsheet_commands.deposit_confirm.reason,'DIRECTOR_REQUIRED');assert.equal(a.data.appsheet_commands.sold_intake.available,true);assert.equal(a.data.appsheet_commands.booking_intake.available,false);assert.equal(a.data.appsheet_commands.booking_intake.reason,'STAGE_NOT_ELIGIBLE');assert.equal(t.data.appsheet_commands.task_complete.available,true)});
test('job search filters to assigned R1 pilot jobs and refuses blank query',()=>{const f=fixture();assert.throws(()=>f.adapter().read({read_type:'JOB_SEARCH',query:''}),/QUERY_REQUIRED/);const r=f.adapter().read({read_type:'JOB_SEARCH',query:'J-1'});assert.equal(r.data.count,1);assert.equal(r.data.results[0].id,'J-1');const h=fixture('hannah@example.test').adapter().read({read_type:'JOB_SEARCH',query:'J-1'});assert.equal(h.data.count,0);const nonPilot=f.adapter().read({read_type:'JOB_SEARCH',query:'J-N'});assert.equal(nonPilot.data.count,0)});
test('operational queue allowlists R1 queues only and filters task visibility',()=>{const f=fixture();assert.throws(()=>f.adapter().read({read_type:'OPERATIONAL_QUEUE',queue:'materials'}),/QUEUE_NOT_IN_R1/);assert.throws(()=>f.adapter().read({read_type:'OPERATIONAL_QUEUE',queue:'archive'}),/QUEUE_NOT_IN_R1/);const r=f.adapter().read({read_type:'OPERATIONAL_QUEUE',queue:'booking'});assert.equal(r.data.queue,'booking');assert.equal(r.data.tasks.every(t=>t.owner_id==='P-tanya'||t.backup_id==='P-tanya'),true);assert.deepEqual(core.R1A_BOUND_QUEUES,['booking','calls','issues','payments','ghl','cancellation','intake_review'])});
test('call command delegates canonical S10 shape and suppresses external effects',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s10RecordCall=(x,s)=>{s.insert('Calls',{id:x.id,job_id:x.job_id,task_id:x.task_id,attempted_at:'2026-09-07T00:00:00Z',attempted_by:x.attempted_by,outcome:x.outcome});return{created:true,call:s.get('Calls',x.id)}};const r=f.adapter().command({command_id:'CALL-1',command_type:'CALL_RECORD',job_id:'J-1',task_id:'T-1',expected_version:2,payload:{type:'Customer',outcome:'NoAnswer',notes:'No reply'}});assert.equal(r.result.status,'Recorded');assert.equal(r.result.external_calls,0);assert.equal(f.tables.Calls[0].attempted_by,'P-tanya')});
test('issue and planner commands delegate only allowlisted lifecycle fields',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s10ReassignIssue=(id,owner,actor,s)=>{s.update('Issues',id,{office_owner_id:owner,updated_by:actor,version:2});return s.get('Issues',id)};global._s11UpdatePlannedDates=(x,s)=>({status:'Updated',input:x,external_calls:0});let i=f.adapter().command({command_id:'ISS-1',command_type:'ISSUE_UPDATE',job_id:'J-1',issue_id:'I-1',expected_version:1,payload:{action:'REASSIGN',owner_id:'P-hannah'}}),p=f.adapter().command({command_id:'PLAN-1',command_type:'PLANNER_UPDATE',job_id:'J-1',work_package_id:'WP-1',expected_version:1,payload:{planned_start:'2026-09-12',planned_end:'2026-09-13'}});assert.equal(i.result.issue.responsible_company_id,'CO-1');assert.equal(p.result.input.actor,'P-tanya')});
test('cancel and reinstate delegate S15 durable commands, never transports',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s15Execute=(kind,input)=>({ok:true,kind,input,external_calls:0});let c=f.adapter().command({command_id:'CAN-1',command_type:'CANCEL_JOB',job_id:'J-1',expected_version:1,payload:{reason:'Customer request',effective_date:'2026-09-08',work_performed:'None',material_state:'None',scaffold_state:'None',finance_review:'Reviewed',legacy_state:'None'}});f.tables.Jobs[0].workflow_stage='Cancelled';let r=f.adapter().command({command_id:'REIN-1',command_type:'REINSTATE_JOB',job_id:'J-1',expected_version:1,payload:{reason:'Customer resumed',new_date:'2026-09-10',commitment_review:'Reviewed',finance_review:'Reviewed',evidence_reference:'EV-1'}});assert.equal(c.result.kind,'Cancel');assert.equal(r.result.kind,'Reinstate');assert.equal(c.result.external_calls+r.result.external_calls,0)});
test('deposit confirm wraps confirmDeposit for Admin under FN-15 with reference only',()=>{const f=fixture('ben@example.test');f.options.services=serviceCore._r1sServices();let calls=0;global.confirmDeposit=(s,jobId,by,ref)=>{calls++;assert.equal(by,'P-ben');assert.equal(ref,'BANK-REF-1');s.update('InvoiceStages','IS-J-DEP-deposit',{status:'Confirmed',reference:ref,version:2});s.update('Jobs',jobId,{deposit_bank_confirmed_at:'2026-09-07T00:00:00Z',deposit_bank_confirmed_by:by,deposit_bank_reference:ref,version:5});return{ok:true,confirmed:true,stage_id:'IS-J-DEP-deposit'};};const r=f.adapter().command({command_id:'DEP-1',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'BANK-REF-1'}});assert.equal(r.result.status,'Confirmed');assert.equal(r.result.external_calls,0);assert.equal(calls,1);assert.equal(f.tables.Jobs.find(j=>j.id==='J-DEP').deposit_bank_reference,'BANK-REF-1');assert.equal(f.tables.AuditEvents.length,1)});
test('deposit confirm refuses Office, wrong mode, stale version and invalid fields',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global.confirmDeposit=()=>({ok:true,confirmed:true});assert.throws(()=>f.adapter().command({command_id:'DEP-2',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'X'}}),/ROLE_DENIED/);const b=fixture('ben@example.test');b.options.services=serviceCore._r1sServices();b.tables.ReleaseModes.find(m=>m.function_id==='FN-15').mode='Disabled';assert.throws(()=>b.adapter().command({command_id:'DEP-3',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'X'}}),/MODE_DENIED/);const s=fixture('ben@example.test');s.options.services=serviceCore._r1sServices();global.confirmDeposit=()=>({ok:true,confirmed:true});assert.throws(()=>s.adapter().command({command_id:'DEP-4',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:1,payload:{reference:'X'}}),/STALE_VERSION/);assert.throws(()=>s.adapter().command({command_id:'DEP-5',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{reference:'X',xero_id:'NOPE'}}),/INVALID_FIELDS/);assert.throws(()=>s.adapter().command({command_id:'DEP-6',command_type:'DEPOSIT_CONFIRM',job_id:'J-DEP',expected_version:4,payload:{}}),/REQUIRED_REFERENCE/)});
test('operational complete wraps approveOperationalCompletion under FN-19/FN-11 with empty payload',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global._s10ApproveOperationalCompletion=(jobId,actor,s)=>{assert.equal(actor,'P-tanya');s.update('Jobs',jobId,{workflow_stage:'OperationallyComplete',operational_complete_at:'2026-09-07T00:00:00Z',operational_complete_by:actor,version:4});return{status:'Completed',created:true,gate:{ready:true},ghl_task:{id:'T-GHL'}};};const r=f.adapter().command({command_id:'OPC-1',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{}});assert.equal(r.result.status,'Completed');assert.equal(r.result.external_calls,0);assert.equal(f.tables.Jobs.find(j=>j.id==='J-OPC').workflow_stage,'OperationallyComplete')});
test('operational complete refuses VariationApprover-only, wrong mode, stale version and payload extras',()=>{const f=fixture('var@example.test');f.options.services=serviceCore._r1sServices();global._s10ApproveOperationalCompletion=()=>({status:'Completed'});assert.throws(()=>f.adapter().command({command_id:'OPC-2',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{}}),/ROLE_DENIED/);const w=fixture();w.options.services=serviceCore._r1sServices();w.tables.ReleaseModes.find(m=>m.function_id==='FN-19').mode='Disabled';assert.throws(()=>w.adapter().command({command_id:'OPC-3',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{}}),/MODE_DENIED/);const s=fixture();s.options.services=serviceCore._r1sServices();global._s10ApproveOperationalCompletion=()=>({status:'Completed'});assert.throws(()=>s.adapter().command({command_id:'OPC-4',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:1,payload:{}}),/STALE_VERSION/);assert.throws(()=>s.adapter().command({command_id:'OPC-5',command_type:'OPERATIONAL_COMPLETE',job_id:'J-OPC',expected_version:3,payload:{note:'no'}}),/INVALID_FIELDS/)});
test('booking gates wraps processBookingGates under FN-01 and reports committed stage',()=>{const f=fixture();f.options.services=serviceCore._r1sServices();global.processBookingGates=(jobId,s,options)=>{assert.equal(options.actor,'P-tanya');s.update('Jobs',jobId,{workflow_stage:'Booked',booking_approved_at:'2026-09-07T00:00:00Z',booking_approved_by:options.actor,version:3});return{success:true,readiness:{ready:true},gates:{ready:true,blocked:false,summary:'Ready',workflow_stage:'Booked'},tasks:{created:[]}}};const r=f.adapter().command({command_id:'BKG-1',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}});assert.equal(r.result.status,'Booked');assert.equal(r.result.external_calls,0)});
test('booking gates refuses unauthorized, wrong mode, stale version and does not bypass blocked gates',()=>{const f=fixture('installer@example.test');f.options.services=serviceCore._r1sServices();assert.throws(()=>f.adapter().command({command_id:'BKG-2',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}}),/ROLE_DENIED/);const w=fixture();w.options.services=serviceCore._r1sServices();w.tables.ReleaseModes.find(m=>m.function_id==='FN-01').mode='Manual';assert.throws(()=>w.adapter().command({command_id:'BKG-3',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}}),/MODE_DENIED/);const s=fixture();s.options.services=serviceCore._r1sServices();global.processBookingGates=()=>({success:false,gates:{ready:false,blocked:true,summary:'Blocked'}});assert.throws(()=>s.adapter().command({command_id:'BKG-4',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:99,payload:{}}),/STALE_VERSION/);const b=fixture();b.options.services=serviceCore._r1sServices();global.processBookingGates=()=>({success:false,gates:{ready:false,blocked:true,summary:'Blocked'},tasks:{created:[]}});const blocked=b.adapter().command({command_id:'BKG-5',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{}});assert.equal(blocked.result.status,'Blocked');assert.equal(blocked.result.success,false);assert.throws(()=>b.adapter().command({command_id:'BKG-6',command_type:'BOOKING_GATES',job_id:'J-BKG',expected_version:2,payload:{force:true}}),/INVALID_FIELDS/)});
test('deposit and operational availability flags require Admin/Office modes correctly',()=>{const f=fixture('ben@example.test');let d=f.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-DEP'});assert.equal(d.data.appsheet_commands.deposit_confirm.available,true);const o=fixture();assert.equal(o.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-OPC'}).data.appsheet_commands.operational_complete.available,true);assert.equal(o.adapter().read({read_type:'ACTION_AVAILABILITY',job_id:'J-BKG'}).data.appsheet_commands.booking_gates.available,true)});
test('wrong environment and sheet refuse; no external API source',()=>{const f=fixture();f.options.config.environment='PROD';assert.throws(()=>f.adapter().read({read_type:'SYSTEM_STATUS'}),/DEV_ONLY/);const src=fs.readFileSync('r1-appsheet/adapter.js','utf8')+fs.readFileSync('r1-appsheet/cloud-adapter.js','utf8')+fs.readFileSync('r1-appsheet/services.js','utf8');assert.doesNotMatch(src,/UrlFetchApp|MailApp|GmailApp|CalendarApp|DriveApp/)});
test('generated Apps Script parses and exposes only narrow entry points',()=>{const src=fs.readFileSync('apps-script/r1-appsheet/R1AppSheetAdapter.js','utf8');new vm.Script(src);assert.match(src,/function appSheetR1Read/);assert.match(src,/function appSheetR1Command/);assert.match(src,/JOB_SEARCH/);assert.match(src,/jobSearch:_s17JobSearch/);assert.match(src,/DEPOSIT_CONFIRM/);assert.match(src,/OPERATIONAL_COMPLETE/);assert.match(src,/BOOKING_GATES/);assert.match(src,/function _r1sSoldIntake/);assert.match(src,/function _r1sBookingIntake/);assert.match(src,/function _r1sIssueCreate/);assert.match(src,/function appSheetR1CommandFromRequestRow/);assert.doesNotMatch(src,/R1A_INTAKE_POLICY_NOT_APPROVED/);assert.match(src,/runR1APrepareDepositConfirmFixture/);assert.match(src,/_r1aPrepareOperationalCompleteFixture/);assert.match(src,/_r1aPrepareBookingGatesFixture/);assert.match(src,/TPL-GHL01/);assert.doesNotMatch(src,/insert\([^)]*TPL-R1A-GHL01|_r1aFixtureIns\([^)]*TPL-R1A-GHL01|_r1aFixtureUpsert\([^)]*TPL-R1A-GHL01/);assert.doesNotMatch(src,/updateRow|genericUpdate|activateProduction/)});

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
  ['Intake','Customers','CustomerChanges','MappingRules','TaskTemplates','TechnicalDetails','WorkPackages','Allocations','Materials','JobEquipment','ScaffoldBookings','Companies','Tasks','CommitJournal','AuditEvents'].forEach(n=>{if(!f.tables[n])f.tables[n]=[];});
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
  assert.equal(f.tables.TechnicalDetails[0].roof_notes,'South facing');
  const codes=f.tables.Tasks.filter(t=>t.job_id===job.id).map(t=>t.template_code);
  assert.ok(codes.includes('PRE-COPY-JOBID'));
  assert.ok(codes.includes('PRE01'));
  const replay=f.adapter().command({command_id:'SOLD1',command_type:'SOLD_INTAKE',payload:soldPayload()});
  assert.equal(replay.result.status,'Replayed');
  assert.equal(replay.result.job_id,r.result.job_id);
  assert.equal(f.tables.Jobs.filter(j=>j.source_system==='R1-AppSheet').length,1);
  assert.equal(f.tables.Customers.length,1);
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
