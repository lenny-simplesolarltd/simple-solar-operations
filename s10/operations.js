/* S10 calls, issues and operational completion. No outbound integrations. */
'use strict';

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

module.exports={
  DEV_SHEET_ID:S10_DEV_SHEET_ID,
  localDate:_s10LocalDate,
  addStaffedDays:_s10AddStaffedDays,
  scheduleInstallerCalls:_s10ScheduleInstallerCalls,
  scheduleCustomerCall:_s10ScheduleCustomerCall,
  recordCall:_s10RecordCall,
  createIssue:_s10CreateIssue,
  reassignIssue:_s10ReassignIssue,
  transitionIssue:_s10TransitionIssue,
  scheduleMissingCommissioning:_s10ScheduleMissingCommissioning,
  evaluateOperationalCompletion:_s10EvaluateOperationalCompletion,
  approveOperationalCompletion:_s10ApproveOperationalCompletion
};
