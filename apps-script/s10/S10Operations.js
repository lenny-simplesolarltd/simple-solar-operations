/* S10 DEV smoke bundle. No outbound calls; GHL is a durable human task only. */
var _S10H={"Jobs":["id","job_id","customer_id","display_name","sold_submission_id","booking_submission_id","sold_at","salesperson_id","lead_source","quote_reference","presale_file_id","finance_route","contract_status","contract_id","contract_signed_at","contract_evidence_id","original_net_pence","original_vat_pence","original_gross_pence","approved_change_pence","current_contract_gross_pence","valuation_basis","sold_booking_match_status","customer_details_verified_at","customer_details_verified_by","deposit_bank_confirmed_at","deposit_bank_confirmed_by","deposit_bank_reference","roof_required","electrical_required","scaffold_required","workflow_stage","booking_approved_at","booking_approved_by","operational_complete_at","operational_complete_by","customer_happy_at","customer_happy_by","handover_status","financial_status","cancellation_at","cancellation_by","cancellation_reason","archived_at","next_action_at","account_policy_version","pilot_job","release_scope","created_at","created_by","updated_at","updated_by","version","source_system","source_record_id","commit_id"],"Tasks":["id","job_id","template_code","instance_key","group","title","owner_id","backup_id","related_entity_type","related_entity_id","due_at","original_due_at","priority","status","blocking_reason","next_followup_at","completed_at","completed_by","completion_note","evidence_id","revision_required","created_rule_version","created_at","created_by","updated_at","updated_by","version","source_system","commit_id"],"TaskTemplates":["id","template_code","title","group","default_owner_role","trigger_event","due_rule","evidence_required","active","template_version","created_at","created_by","updated_at","updated_by","version","commit_id"],"People":["id","email","display_name","role","company_id","active","calendar_id","notification_email","capacity_per_day","available_from","available_to","backup_person_id","created_at","created_by","updated_at","updated_by","version","source_system","source_record_id","commit_id"],"PersonRoles":["id","person_id","role","active","created_at","created_by","updated_at","updated_by","version","source_system","commit_id"],"ReleaseModes":["id","function_id","function_name","mode","mode_record_basis","authorised_job_scope","target_release","planned_target_mode","current_system","fallback","external_ids_protected_reference","activation_time","approved_version","ben_approval_reference","scope_boundary_notes","created_at","created_by","updated_at","updated_by","version","commit_id"],"WorkPackages":["id","job_id","trade","required","planned_start","planned_end","actual_start","actual_end","status","need_by_date","completion_outcome","installer_confirmation_at","installer_confirmation_by","commissioning_required","sequence","revision","parent_package_id","created_at","created_by","updated_at","updated_by","version","source_system","commit_id"],"Allocations":["id","work_package_id","person_id","role","start_at","end_at","active","replaced_allocation_id","cancellation_reason","calendar_link_id","created_at","created_by","updated_at","updated_by","version","source_system","commit_id"],"Calls":["id","job_id","work_package_id","task_id","type","contact_id","person_id","attempted_at","attempted_by","outcome","notes","next_attempt_at","actual_completion_confirmed","customer_happy","strip_authorised","created_at","commit_id"],"Issues":["id","job_id","work_package_id","type","category","description","raised_at","raised_by","responsible_person_id","responsible_company_id","office_owner_id","severity","status","due_at","next_followup_at","blocks_completion","blocks_strip","estimated_value_pence","approved_value_pence","approval_status","approved_at","approved_by","resolution","resolved_at","closed_at","closed_by","customer_resolution_confirmed","linked_return_package_id","evidence_folder_id","created_at","created_by","updated_at","updated_by","version","source_system","commit_id"],"IssueEvents":["id","issue_id","event_type","actor","timestamp","note","previous_status","new_status","evidence_id","created_at","commit_id"],"CommissioningSubmissions":["id","job_id","work_package_id","allocation_id","installer_id","template_version","status","submitted_at","reviewed_at","reviewed_by","review_notes","supersedes_submission_id","created_at","created_by","updated_at","updated_by","version","commit_id"],"GHLTasks":["id","job_id","task_id","opportunity_id","target_pipeline_id","target_stage_id","template_id","readiness_snapshot","completed_at","completed_by","evidence_reference","created_at","commit_id"],"Holidays":["id","local_date","description","office_closed","created_at","created_by","commit_id"]};
function _s10Guard(){var ss=SpreadsheetApp.getActiveSpreadsheet();if(ss.getId()!=='1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc')throw new Error('S10_REFUSED: wrong sheet');var c=JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG')||'null');if(!c||c.environment!=='DEV')throw new Error('S10_REFUSED: DEV only');return ss;}
function _s10Sheet(ss,n){var a=ss.getSheets();for(var i=0;i<a.length;i++)if(a[i].getName()===n)return a[i];return null;}
function _s10Read(ss,n){var sh=_s10Sheet(ss,n),h=_S10H[n];if(!sh||sh.getLastRow()<2)return[];var v=sh.getRange(2,1,sh.getLastRow()-1,Math.min(sh.getLastColumn(),h.length)).getValues(),out=[];for(var r=0;r<v.length;r++){var x={};for(var c=0;c<h.length&&c<v[r].length;c++)x[h[c]]=v[r][c]===''?null:v[r][c];out.push(x);}return out;}
function _s10Insert(ss,n,x){var sh=_s10Sheet(ss,n),h=_S10H[n],row=sh.getLastRow()+1;if(row>sh.getMaxRows())throw new Error('CAPACITY: '+n);sh.getRange(row,1,1,h.length).setValues([h.map(function(k){var v=x[k];return v===null||v===undefined?'':(typeof v==='string'&&/^[=']/.test(v)?"'"+v:v);})]);SpreadsheetApp.flush();}
function _s10Update(ss,n,id,p){var sh=_s10Sheet(ss,n),h=_S10H[n],rows=_s10Read(ss,n),ri=-1;for(var i=0;i<rows.length;i++)if(rows[i].id===id){ri=i+2;break;}if(ri<0)throw new Error('Row: '+n+' '+id);var v=sh.getRange(ri,1,1,h.length).getValues()[0];Object.keys(p).forEach(function(k){var j=h.indexOf(k);if(j>=0)v[j]=p[k]===null||p[k]===undefined?'':p[k];});sh.getRange(ri,1,1,h.length).setValues([v]);SpreadsheetApp.flush();}
function _s10Store(ss){return{getSheetId:function(){return ss.getId();},getEnvironment:function(){_s10Guard();return'DEV';},list:function(n){return _s10Read(ss,n);},get:function(n,id){return _s10Read(ss,n).filter(function(x){return x.id===id;})[0]||null;},insert:function(n,x){_s10Insert(ss,n,x);},update:function(n,id,p){_s10Update(ss,n,id,p);}};}
function _s10Result(name,pass,detail){var r={test:name,pass:pass,detail:detail};console.log(JSON.stringify(r,null,2));return r;}
function _s10Fixture(s){var n='2026-11-11T12:00:00.000Z';function ins(t,x){if(!s.get(t,x.id))s.insert(t,x);}var t=[['INS04','Customer call','Aftercare','Office'],['ISS01','Review variation','Aftercare','VariationApprover'],['ISS02','Investigate and resolve issue','Aftercare','Office']];t.forEach(function(a){ins('TaskTemplates',{id:'TPL-S10-'+a[0],template_code:a[0],title:a[1]+' (DEV synthetic)',group:a[2],default_owner_role:a[3],trigger_event:'S10 DEV synthetic',due_rule:'Authoritative S10 rule',evidence_required:'Recorded outcome',active:true,template_version:'DEV-1.0',created_at:n,created_by:'S10',updated_at:n,updated_by:'S10',version:1,commit_id:'S10'});});ins('PersonRoles',{id:'ROLE-S10-hannah-variation',person_id:'PERSON-hannah',role:'VariationApprover',active:true,created_at:n,created_by:'S10',updated_at:n,updated_by:'S10',version:1,source_system:'S10',commit_id:'S10'});}
function _s10Job(){return{id:'J-s10-ready',job_id:'SS-S10R-EADY',customer_id:'CUST-s10',display_name:'S10 DEV Synthetic',sold_submission_id:'S10-sold',booking_submission_id:'S10-booking',sold_at:'2026-10-01T00:00:00.000Z',finance_route:'Standard',contract_status:'Signed',sold_booking_match_status:'Match',roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Aftercare',customer_happy_at:'2026-11-09T10:00:00.000Z',customer_happy_by:'PERSON-tanya',handover_status:'NotReady',financial_status:'Pending',pilot_job:true,release_scope:'R1',created_at:'2026-11-11T12:00:00.000Z',created_by:'S10',updated_at:'2026-11-11T12:00:00.000Z',updated_by:'S10',version:1,source_system:'S10-fixture',commit_id:'S10'};}
function _s10Package(){return{id:'WP-s10-roof',job_id:'J-s10-ready',trade:'Roof',required:true,planned_start:'2026-11-05',planned_end:'2026-11-06',actual_start:'2026-11-05',actual_end:'2026-11-06',status:'ReportedComplete',completion_outcome:'Complete',installer_confirmation_at:null,installer_confirmation_by:null,commissioning_required:true,sequence:1,revision:1,created_at:'2026-11-11T12:00:00.000Z',created_by:'S10',updated_at:'2026-11-11T12:00:00.000Z',updated_by:'S10',version:1,source_system:'S10',commit_id:'S10'};}
function runS10FixtureDryRun(){var s=_s10Store(_s10Guard()),ids=['FN-01','FN-11','FN-18','FN-19'];return _s10Result('S10 fixture dry run',ids.every(function(id){return s.list('ReleaseModes').filter(function(r){return r.function_id===id;}).length===1;}),{functions:ids,jobs:s.list('Jobs').filter(function(j){return j.id==='J-s10-ready';}).length});}
function runS10FixtureApply(){var s=_s10Store(_s10Guard());_s10Fixture(s);if(!s.get('Jobs','J-s10-ready'))s.insert('Jobs',_s10Job());if(!s.get('WorkPackages','WP-s10-roof'))s.insert('WorkPackages',_s10Package());if(!s.get('Allocations','ALLOC-s10'))s.insert('Allocations',{id:'ALLOC-s10',work_package_id:'WP-s10-roof',person_id:'PERSON-installer-a',role:'Lead',active:true,created_at:'2026-11-11T12:00:00.000Z',created_by:'S10',updated_at:'2026-11-11T12:00:00.000Z',updated_by:'S10',version:1,source_system:'S10',commit_id:'S10'});if(!s.get('CommissioningSubmissions','CS-s10'))s.insert('CommissioningSubmissions',{id:'CS-s10',job_id:'J-s10-ready',work_package_id:'WP-s10-roof',allocation_id:'ALLOC-s10',installer_id:'PERSON-installer-a',template_version:'S10-sample',status:'Accepted',submitted_at:'2026-11-09T09:00:00.000Z',reviewed_at:'2026-11-09T10:00:00.000Z',reviewed_by:'PERSON-tanya',review_notes:'Synthetic accepted state only',created_at:'2026-11-11T12:00:00.000Z',created_by:'S10',updated_at:'2026-11-11T12:00:00.000Z',updated_by:'S10',version:1,commit_id:'S10'});return _s10Result('S10 fixture apply',true,'Synthetic fixtures present');}
function _s10Modes(enable){var s=_s10Store(_s10Guard()),want={'FN-01':enable?'Automated':'Disabled','FN-11':enable?'Manual':'Disabled','FN-18':enable?'Manual':'Disabled','FN-19':enable?'Manual':'Disabled'};for(var id in want){var rows=s.list('ReleaseModes').filter(function(r){return r.function_id===id;});if(rows.length!==1)return _s10Result('S10 modes',false,id+' missing/duplicate');var r=rows[0];if(r.target_release!=='R1')return _s10Result('S10 modes',false,id+' target must be R1');if(enable&&!(r.mode==='Disabled'&&r.authorised_job_scope==='None')&&!(r.mode===want[id]&&r.authorised_job_scope==='Pilot'))return _s10Result('S10 modes',false,id+' unexpected state');s.update('ReleaseModes',r.id,{mode:want[id],authorised_job_scope:enable?'Pilot':'None',updated_at:new Date().toISOString(),updated_by:enable?'S10-enable':'S10-restore',version:Number(r.version||0)+1});}return _s10Result('S10 modes',true,enable?'Enabled controlled Pilot/R1':'Restored Disabled/None/R1');}
function runS10EnableFunctionsForSyntheticTest(){return _s10Modes(true);}function restoreS10SafeState(){return _s10Modes(false);}
function runS10FixtureValidate(){var s=_s10Store(_s10Guard()),m={};['FN-01','FN-11','FN-18','FN-19'].forEach(function(id){m[id]=(s.list('ReleaseModes').filter(function(r){return r.function_id===id;})[0]||{}).mode||'missing';});return _s10Result('S10 fixture validate',!!s.get('Jobs','J-s10-ready'),m);}
function runS10HappyPathTest(){try{var s=_s10Store(_s10Guard()),j=s.get('Jobs','J-s10-ready'),testNow='2026-11-12T12:00:00.000Z';if(!j)return _s10Result('S10 happy path',false,'Run fixture apply');var wp=s.get('WorkPackages','WP-s10-roof'),callTasks=s.list('Tasks').filter(function(t){return t.job_id===j.id&&t.template_code==='INS01';});if(!wp)return _s10Result('S10 happy path',false,'Synthetic work package missing');if(!callTasks.length){if(wp.status==='ConfirmedComplete')callTasks=[_s10InsertTask(s,'INS01',j.id,'WorkPackages',wp.id,'R'+wp.revision,_s10AddStaffedDays(wp.actual_end||wp.planned_end,1,_s10Holidays(s)),_s10OwnerForRole(s,'Office')).task];else callTasks=_s10ScheduleInstallerCalls(j.id,s).created;}if(callTasks.length!==1)throw new Error('Expected one INS01 task');var callInput={id:'CALL-s10-roof-confirm',job_id:j.id,work_package_id:wp.id,task_id:callTasks[0].id,type:'Installer',person_id:'PERSON-installer-a',attempted_at:testNow,attempted_by:'PERSON-tanya',outcome:'Complete',notes:'DEV synthetic confirmation',actual_completion_confirmed:true,commit_id:'S10-CALL'},callResult=_s10RecordCall(callInput,s);if(!callResult.created){var savedCall=callResult.call,currentTask=s.get('Tasks',callTasks[0].id),currentPackage=s.get('WorkPackages',wp.id);if(currentTask.status!=='Complete')s.update('Tasks',currentTask.id,{status:'Complete',completed_at:savedCall.attempted_at,completed_by:savedCall.attempted_by,completion_note:savedCall.outcome,updated_at:testNow,updated_by:'S10-reconcile',version:Number(currentTask.version||0)+1});if(currentPackage.status!=='ConfirmedComplete'||!currentPackage.installer_confirmation_at)s.update('WorkPackages',currentPackage.id,{status:'ConfirmedComplete',installer_confirmation_at:savedCall.attempted_at,installer_confirmation_by:savedCall.attempted_by,updated_at:testNow,updated_by:'S10-reconcile',version:Number(currentPackage.version||0)+1});}var r=_s10ApproveOperationalCompletion(j.id,'PERSON-tanya',s,testNow),tasks=s.list('Tasks').filter(function(t){return t.job_id===j.id&&t.template_code==='GHL01';}),ghl=s.list('GHLTasks').filter(function(g){return g.job_id===j.id;}),calls=s.list('Calls').filter(function(c){return c.job_id===j.id;}),issues=s.list('Issues').filter(function(i){return i.job_id===j.id&&!S10_TERMINAL_ISSUES.has(i.status);});return _s10Result('S10 happy path',(['Completed','AlreadyComplete'].indexOf(r.status)>=0&&callTasks.length===1&&calls.length===1&&issues.length===0&&tasks.length===1&&ghl.length===1),{status:r.status,installer_calls:calls.length,open_issues:issues.length,ghl_tasks:tasks.length,ghl_records:ghl.length,outbound_calls:0,test_time:testNow});}catch(e){return _s10Result('S10 happy path',false,String(e.message||e));}}

/* S10 calls, issues and operational completion. No outbound integrations. */


const S10_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const S10_TERMINAL_ISSUES = new Set(['Resolved', 'Closed']);

function _s10AssertScope(jobId, store, functionIds) {
  if (!store.getSheetId || store.getSheetId() !== S10_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') throw new Error('S10_REFUSED: DEV only / wrong sheet');
  const job = store.get('Jobs', jobId);
  if (!job || job.pilot_job !== true || job.release_scope !== 'R1') throw new Error('S10_REFUSED: R1 pilot job required');
  for (const id of functionIds) {
    const rows = store.list('ReleaseModes').filter(r => r.function_id === id);
    if (rows.length !== 1 || rows[0].target_release !== 'R1' || rows[0].authorised_job_scope !== 'Pilot') throw new Error('S10_REFUSED: '+id+' must be Pilot/R1');
    const wanted = id === 'FN-01' ? 'Automated' : 'Manual';
    if (rows[0].mode !== wanted) throw new Error('S10_REFUSED: '+id+' must be '+wanted);
  }
  return job;
}

function _s10LocalDate(value) {
  if (value === null || value === undefined || value === '') throw new Error('S10_DATE_INVALID: date value is required');
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('S10_DATE_INVALID: invalid Date object');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
  }
  const text=String(value).trim(), match=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
  if(!match) throw new Error('S10_DATE_INVALID: expected YYYY-MM-DD or ISO timestamp');
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),check=new Date(Date.UTC(y,m-1,d));
  if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d) throw new Error('S10_DATE_INVALID: invalid calendar date '+match[1]+'-'+match[2]+'-'+match[3]);
  if(text.length>10&&!Number.isFinite(new Date(text).getTime())) throw new Error('S10_DATE_INVALID: invalid ISO timestamp');
  return match[1]+'-'+match[2]+'-'+match[3];
}
function _s10Holidays(store) { return store.list('Holidays').filter(h => h.office_closed === true).map(h => _s10LocalDate(h.local_date)); }
function _s10RequireDateTime(value) {
  if(value===null||value===undefined||value==='')throw new Error('S10_DATE_INVALID: timestamp value is required');
  const parsed=Object.prototype.toString.call(value)==='[object Date]'?value:new Date(value);
  if(isNaN(parsed.getTime()))throw new Error('S10_DATE_INVALID: invalid timestamp');
  return parsed;
}
function _s10AddStaffedDays(value, count, closed) {
  const d = new Date(_s10LocalDate(value)+'T12:00:00Z'), closedDates=(closed||[]).map(v=>_s10LocalDate(v)); let added = 0;
  while (added < count) { d.setUTCDate(d.getUTCDate()+1); const iso=d.toISOString().slice(0,10), day=d.getUTCDay(); if(day!==0&&day!==6&&!closedDates.includes(iso)) added++; }
  return d.toISOString().slice(0,10)+'T09:00:00.000Z';
}
function _s10OwnerForRole(store, role) {
  const roles=store.list('PersonRoles').filter(r=>r.role===role&&r.active===true);
  const people=store.list('People').filter(p=>p.active===true&&roles.some(r=>r.person_id===p.id));
  if(role==='Office') { const tanya=people.filter(p=>p.id==='PERSON-tanya'); if(tanya.length===1)return tanya[0].id; }
  if(people.length!==1) throw new Error('S10_CONFIG: exactly one active '+role+' owner required');
  return people[0].id;
}
function _s10Template(store, code) {
  const rows=store.list('TaskTemplates').filter(t=>t.template_code===code&&t.active===true);
  if(rows.length!==1) throw new Error('S10_CONFIG: exactly one active _s10Template '+code+' required');
  return rows[0];
}
function _s10InsertTask(store, code, jobId, entityType, entityId, episode, dueAt, ownerId) {
  const tpl=_s10Template(store,code), key=[code,entityId,episode].join('-');
  const rows=store.list('Tasks').filter(t=>t.instance_key===key);
  if(rows.length>1) throw new Error('S10_CONFLICT: duplicate task '+key);
  if(rows.length) return {created:false,task:rows[0]};
  const now=new Date().toISOString(), task={id:'TASK-'+key,job_id:jobId,template_code:code,instance_key:key,group:tpl.group,title:tpl.title,owner_id:ownerId,backup_id:null,related_entity_type:entityType,related_entity_id:entityId,due_at:dueAt,original_due_at:dueAt,priority:1,status:'Open',blocking_reason:null,next_followup_at:null,completed_at:null,completed_by:null,completion_note:null,evidence_id:null,revision_required:false,created_rule_version:tpl.template_version,created_at:now,created_by:'S10',updated_at:now,updated_by:'S10',version:1,source_system:'S10',commit_id:'S10-'+key};
  store.insert('Tasks',task); return {created:true,task};
}

function _s10ScheduleInstallerCalls(jobId, store) {
  _s10AssertScope(jobId,store,['FN-01']); const created=[], reused=[], closed=_s10Holidays(store), tanya=_s10OwnerForRole(store,'Office');
  const packages=store.list('WorkPackages').filter(p=>p.job_id===jobId&&p.required===true&&!['Cancelled','ConfirmedComplete'].includes(p.status)&&(p.planned_end||p.actual_end));
  for(const p of packages){const base=p.actual_end||p.planned_end, due=_s10AddStaffedDays(base,1,closed), r=_s10InsertTask(store,'INS01',jobId,'WorkPackages',p.id,'R'+p.revision,due,tanya); (r.created?created:reused).push(r.task);}
  return {created,reused};
}

function _s10ScheduleCustomerCall(jobId, store) {
  _s10AssertScope(jobId,store,['FN-01']); const required=store.list('WorkPackages').filter(p=>p.job_id===jobId&&p.required===true&&p.status!=='Cancelled');
  if(!required.length||required.some(p=>p.status!=='ConfirmedComplete'||!p.installer_confirmation_at)) return {status:'Blocked',reason:'INSTALLER_CONFIRMATIONS_MISSING',created:[]};
  const latest=required.map(p=>_s10LocalDate(p.installer_confirmation_at)).sort().pop(), r=_s10InsertTask(store,'INS04',jobId,'Jobs',jobId,'ROOT',_s10AddStaffedDays(latest,1,_s10Holidays(store)),_s10OwnerForRole(store,'Office'));
  return {status:'Ready',created:r.created?[r.task]:[],reused:r.created?[]:[r.task]};
}

function _s10RecordCall(input, store) {
  _s10AssertScope(input.job_id,store,['FN-01']); const task=store.get('Tasks',input.task_id);
  if(!task||task.job_id!==input.job_id||!['INS01','INS04'].includes(task.template_code)) throw new Error('S10_REVIEW: invalid call task');
  const id=input.id||('CALL-'+input.commit_id), existing=store.get('Calls',id);
  const material=JSON.stringify([input.job_id,input.work_package_id||null,input.task_id,input.type,input.person_id||null,input.outcome,input.actual_completion_confirmed===true,input.customer_happy]);
  if(existing){const old=JSON.stringify([existing.job_id,existing.work_package_id||null,existing.task_id,existing.type,existing.person_id||null,existing.outcome,existing.actual_completion_confirmed===true,existing.customer_happy]); if(old!==material) throw new Error('S10_REVIEW: conflicting call identity'); return {created:false,call:existing};}
  const now=input.attempted_at||new Date().toISOString(); _s10RequireDateTime(now); if(input.next_attempt_at)_s10RequireDateTime(input.next_attempt_at); const call={id,job_id:input.job_id,work_package_id:input.work_package_id||null,task_id:input.task_id,type:input.type,contact_id:input.contact_id||null,person_id:input.person_id||null,attempted_at:now,attempted_by:input.attempted_by,outcome:input.outcome,notes:input.notes||null,next_attempt_at:input.next_attempt_at||null,actual_completion_confirmed:input.actual_completion_confirmed===true,customer_happy:input.customer_happy===undefined?null:input.customer_happy,strip_authorised:null,created_at:now,commit_id:input.commit_id};
  store.insert('Calls',call);
  if(input.outcome==='NoAnswer') store.update('Tasks',task.id,{status:'Open',next_followup_at:input.next_attempt_at||_s10AddStaffedDays(now,1,_s10Holidays(store)),updated_at:now,updated_by:input.attempted_by,version:Number(task.version||0)+1});
  else store.update('Tasks',task.id,{status:'Complete',completed_at:now,completed_by:input.attempted_by,completion_note:input.outcome,updated_at:now,updated_by:input.attempted_by,version:Number(task.version||0)+1});
  if(task.template_code==='INS01'&&input.actual_completion_confirmed===true){const p=store.get('WorkPackages',input.work_package_id); store.update('WorkPackages',p.id,{status:input.outcome==='ReturnRequired'?'ReturnRequired':'ConfirmedComplete',installer_confirmation_at:now,installer_confirmation_by:input.attempted_by,updated_at:now,updated_by:input.attempted_by,version:Number(p.version||0)+1});}
  if(task.template_code==='INS04'&&input.customer_happy===true){const j=store.get('Jobs',input.job_id);store.update('Jobs',j.id,{customer_happy_at:now,customer_happy_by:input.attempted_by,updated_at:now,updated_by:input.attempted_by,version:Number(j.version||0)+1});}
  if(task.template_code==='INS04'&&input.customer_happy===false) _s10CreateIssue({id:'ISS-'+id,job_id:input.job_id,type:'Complaint',category:'CustomerCall',description:input.notes||'Customer reported unhappy',raised_at:now,raised_by:input.attempted_by,commit_id:input.commit_id+'-ISS'},store);
  if(task.template_code==='INS01'&&input.outcome==='ReturnRequired') { const issue=_s10CreateIssue({id:'ISS-'+id,job_id:input.job_id,work_package_id:input.work_package_id,type:'Remedial',category:'ReturnRequired',description:input.notes||'Return visit required',raised_at:now,raised_by:input.attempted_by,commit_id:input.commit_id+'-ISS'},store); _s10InsertTask(store,'REM01',input.job_id,'Issues',issue.issue.id,'E1',_s10AddStaffedDays(now,1,_s10Holidays(store)),_s10OwnerForRole(store,'Office')); }
  return {created:true,call};
}

function _s10CreateIssue(input, store) {
  _s10AssertScope(input.job_id,store,['FN-01']); if(!['Variation','Remedial','Complaint'].includes(input.type)) throw new Error('S10_REVIEW: invalid issue type');
  const existing=store.get('Issues',input.id), fingerprint=JSON.stringify([input.job_id,input.work_package_id||null,input.type,input.category,input.description]);
  if(existing){if(JSON.stringify([existing.job_id,existing.work_package_id||null,existing.type,existing.category,existing.description])!==fingerprint) throw new Error('S10_REVIEW: conflicting issue identity'); return {created:false,issue:existing};}
  const now=input.raised_at||new Date().toISOString(); _s10RequireDateTime(now); if(input.due_at)_s10RequireDateTime(input.due_at); const defaultOwner=input.type==='Variation'?_s10OwnerForRole(store,'VariationApprover'):_s10OwnerForRole(store,'Office');
  const issue={id:input.id,job_id:input.job_id,work_package_id:input.work_package_id||null,type:input.type,category:input.category,description:input.description,raised_at:now,raised_by:input.raised_by,responsible_person_id:input.responsible_person_id||null,responsible_company_id:input.responsible_company_id||null,office_owner_id:input.office_owner_id||defaultOwner,severity:input.severity||'Normal',status:'Open',due_at:input.due_at||_s10AddStaffedDays(now,1,_s10Holidays(store)),next_followup_at:null,blocks_completion:input.blocks_completion!==false,blocks_strip:input.blocks_strip===true,estimated_value_pence:null,approved_value_pence:null,approval_status:'NotRequired',approved_at:null,approved_by:null,resolution:null,resolved_at:null,closed_at:null,closed_by:null,customer_resolution_confirmed:null,linked_return_package_id:input.linked_return_package_id||null,evidence_folder_id:input.evidence_folder_id||null,created_at:now,created_by:input.raised_by,updated_at:now,updated_by:input.raised_by,version:1,source_system:'S10',commit_id:input.commit_id};
  store.insert('Issues',issue); store.insert('IssueEvents',{id:'IE-'+input.id+'-OPEN',issue_id:input.id,event_type:'Opened',actor:input.raised_by,timestamp:now,note:input.description,previous_status:null,new_status:'Open',evidence_id:null,created_at:now,commit_id:'S10-'+input.commit_id+'-OPEN'});
  const code=input.type==='Variation'?'ISS01':'ISS02', r=_s10InsertTask(store,code,input.job_id,'Issues',input.id,'E1',issue.due_at,issue.office_owner_id);
  return {created:true,issue,task:r.task};
}

function _s10ReassignIssue(issueId, ownerId, actor, store, at) {
  const issue=store.get('Issues',issueId); if(!issue) throw new Error('S10_REVIEW: issue not found'); _s10AssertScope(issue.job_id,store,['FN-01']);
  const now=at||new Date().toISOString(); _s10RequireDateTime(now); store.update('Issues',issueId,{office_owner_id:ownerId,updated_at:now,updated_by:actor,version:Number(issue.version||0)+1});
  store.insert('IssueEvents',{id:'IE-'+issueId+'-ASSIGN-'+Number(issue.version||0),issue_id:issueId,event_type:'Reassigned',actor,timestamp:now,note:ownerId,previous_status:issue.status,new_status:issue.status,evidence_id:null,created_at:now,commit_id:'S10-'+issueId+'-ASSIGN-'+Number(issue.version||0)}); return store.get('Issues',issueId);
}

function _s10TransitionIssue(issueId, status, actor, store, options={}) {
  const issue=store.get('Issues',issueId); if(!issue)throw new Error('S10_REVIEW: issue not found'); _s10AssertScope(issue.job_id,store,['FN-01']);
  if(!['Resolved','Closed'].includes(status))throw new Error('S10_REVIEW: invalid issue transition');
  if(status==='Resolved'&&!options.resolution)throw new Error('S10_REVIEW: resolution required');
  if(status==='Closed'&&(issue.status!=='Resolved'||options.customer_resolution_confirmed!==true))throw new Error('S10_REVIEW: resolved issue and customer confirmation required');
  const now=options.at||new Date().toISOString(); _s10RequireDateTime(now); const patch={status,updated_at:now,updated_by:actor,version:Number(issue.version||0)+1};
  if(status==='Resolved')Object.assign(patch,{resolution:options.resolution,resolved_at:now});else Object.assign(patch,{closed_at:now,closed_by:actor,customer_resolution_confirmed:true});
  store.update('Issues',issueId,patch);store.insert('IssueEvents',{id:'IE-'+issueId+'-'+status.toUpperCase()+'-'+Number(issue.version||0),issue_id:issueId,event_type:status,actor,timestamp:now,note:options.resolution||null,previous_status:issue.status,new_status:status,evidence_id:options.evidence_id||null,created_at:now,commit_id:'S10-'+issueId+'-'+status+'-'+Number(issue.version||0)});return store.get('Issues',issueId);
}

function _s10ScheduleMissingCommissioning(jobId, store, now) {
  _s10AssertScope(jobId,store,['FN-18']); const created=[],reused=[],closed=_s10Holidays(store);
  const packages=store.list('WorkPackages').filter(p=>p.job_id===jobId&&p.required===true&&p.commissioning_required===true&&['ReportedComplete','ConfirmedComplete','ReturnRequired'].includes(p.status)&&p.actual_end);
  const evaluationTime=_s10RequireDateTime(now); for(const p of packages){const accepted=store.list('CommissioningSubmissions').some(s=>s.job_id===jobId&&s.work_package_id===p.id&&['Submitted','UnderReview','Accepted'].includes(s.status)); if(accepted)continue; const due=_s10AddStaffedDays(p.actual_end,2,closed); if(evaluationTime<_s10RequireDateTime(due))continue; const alloc=store.list('Allocations').filter(a=>a.work_package_id===p.id&&a.active===true&&a.role==='Lead'); if(alloc.length!==1)throw new Error('S10_REVIEW: commissioning owner ambiguous'); const r=_s10InsertTask(store,'INS02',jobId,'WorkPackages',p.id,'R'+p.revision,due,alloc[0].person_id); (r.created?created:reused).push(r.task);}
  return {created,reused};
}

function _s10EvaluateOperationalCompletion(jobId, store) {
  const job=_s10AssertScope(jobId,store,['FN-19']); if(job.operational_complete_at)return {status:'AlreadyComplete',ready:true,reasons:[]}; const reasons=[];
  const packages=store.list('WorkPackages').filter(p=>p.job_id===jobId&&p.required===true&&p.status!=='Cancelled');
  if(!packages.length||packages.some(p=>p.status!=='ConfirmedComplete'||!p.installer_confirmation_at))reasons.push('REQUIRED_WORK_UNCONFIRMED'); else packages.forEach(p=>_s10RequireDateTime(p.installer_confirmation_at));
  for(const p of packages.filter(p=>p.commissioning_required===true)){if(!store.list('CommissioningSubmissions').some(s=>s.job_id===jobId&&s.work_package_id===p.id&&s.status==='Accepted'))reasons.push('COMMISSIONING_NOT_ACCEPTED:'+p.id);}
  if(!job.customer_happy_at)reasons.push('CUSTOMER_NOT_HAPPY'); else _s10RequireDateTime(job.customer_happy_at);
  if(store.list('Issues').some(i=>i.job_id===jobId&&i.blocks_completion===true&&!S10_TERMINAL_ISSUES.has(i.status)))reasons.push('BLOCKING_ISSUE_OPEN');
  return {status:reasons.length?'NeedsReview':'Ready',ready:reasons.length===0,reasons};
}

function _s10EnsureGhlTracking(jobId, store, completedAt) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const task=_s10InsertTask(store,'GHL01',jobId,'Jobs',jobId,'OPCOMPLETE',_s10AddStaffedDays(completedAt,1,_s10Holidays(store)),_s10OwnerForRole(store,'Office'));
  const gid='GHL-'+jobId+'-OPCOMPLETE'; if(!store.get('GHLTasks',gid))store.insert('GHLTasks',{id:gid,job_id:jobId,task_id:task.task.id,opportunity_id:null,target_pipeline_id:null,target_stage_id:null,template_id:null,readiness_snapshot:JSON.stringify({status:'Ready',ready:true,reasons:[]}),completed_at:null,completed_by:null,evidence_reference:null,created_at:completedAt,commit_id:'S10-'+gid});
  return task.task;
}

function _s10ApproveOperationalCompletion(jobId, actor, store, at) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  _s10AssertScope(jobId,store,['FN-19','FN-11']); const gate=_s10EvaluateOperationalCompletion(jobId,store); if(gate.status==='AlreadyComplete'){const job=store.get('Jobs',jobId),task=_s10EnsureGhlTracking(jobId,store,job.operational_complete_at);return {status:'AlreadyComplete',created:false,gate,ghl_task:task};} if(!gate.ready)return {status:'NeedsReview',created:false,gate};
  const now=at||new Date().toISOString(); _s10RequireDateTime(now); const job=store.get('Jobs',jobId); store.update('Jobs',jobId,{workflow_stage:'OperationallyComplete',operational_complete_at:now,operational_complete_by:actor,updated_at:now,updated_by:actor,version:Number(job.version||0)+1});
  const task=_s10EnsureGhlTracking(jobId,store,now);
  return {status:'Completed',created:true,gate,ghl_task:task.task};
}

