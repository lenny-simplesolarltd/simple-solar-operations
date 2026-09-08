/* R1 AppSheet command/read boundary. DEV only; AppSheet is never authoritative. */
'use strict';

const R1A_BOUND_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const R1A_BOUND_READS = ['IDENTITY_PROBE','OFFICE_HOME','JOB_OVERVIEW','OPERATIONAL_QUEUE','RELEASE_MODE_STATUS','SYSTEM_STATUS','AUDIT_HISTORY','ACTION_AVAILABILITY','TASK_ACTION_AVAILABILITY'];
const R1A_BOUND_COMMANDS = ['TASK_COMPLETE','CALL_RECORD','ISSUE_UPDATE','PLANNER_UPDATE','CANCEL_JOB','REINSTATE_JOB','DEPOSIT_CONFIRM','OPERATIONAL_COMPLETE','BOOKING_GATES','SOLD_INTAKE','BOOKING_INTAKE'];

function _r1aCopy(v) { return JSON.parse(JSON.stringify(v)); }
function _r1aRefuse(code) { var e=new Error(code); e.code=code; throw e; }
function _r1aObject(v) { return v && typeof v==='object' && !Array.isArray(v); }
function _r1aKeys(v, allowed) { if(!_r1aObject(v) || Object.keys(v).some(function(k){return allowed.indexOf(k)<0;})) _r1aRefuse('R1A_INVALID_FIELDS'); }
function _r1aText(v) { return typeof v==='string' && v.trim().length>0; }

function _r1aActor(store,email) {
  if(!_r1aText(email)) _r1aRefuse('R1A_AUTHENTICATED_EMAIL_REQUIRED');
  var normalized=email.trim().toLowerCase();
  var people=store.list('People').filter(function(p){return _r1aText(p.email)&&p.email.trim().toLowerCase()===normalized;});
  if(people.length!==1) _r1aRefuse('R1A_UNKNOWN_OR_DUPLICATE_ACTOR');
  var person=people[0]; if(person.active!==true) _r1aRefuse('R1A_INACTIVE_ACTOR');
  var roles=store.list('PersonRoles').filter(function(r){return r.person_id===person.id&&r.active===true;}).map(function(r){return r.role;});
  if(!roles.length) _r1aRefuse('R1A_NO_ACTIVE_ROLE');
  return {id:person.id,email:normalized,roles:roles};
}
function _r1aAdmin(a){return a.roles.indexOf('Admin')>=0||a.roles.indexOf('Manager')>=0;}
function _r1aOffice(a){return _r1aAdmin(a)||a.roles.indexOf('Office')>=0||a.roles.indexOf('VariationApprover')>=0;}
function _r1aOfficeManager(a){return _r1aAdmin(a)||a.roles.indexOf('Office')>=0;}
function _r1aGuardEnvironment(options){
  if(!options||!options.store||!options.config||options.config.environment!=='DEV'||options.config.sheetId!==R1A_BOUND_DEV_SHEET_ID||options.store.getSheetId()!==R1A_BOUND_DEV_SHEET_ID||options.store.getEnvironment()!=='DEV') _r1aRefuse('R1A_DEV_ONLY');
}
function _r1aGuard(options){
  _r1aGuardEnvironment(options);
  return _r1aActor(options.store,options.actorEmail());
}
function _r1aJob(store,id){var j=store.get('Jobs',id);if(!j)_r1aRefuse('R1A_JOB_NOT_FOUND');if(j.pilot_job!==true||j.release_scope!=='R1')_r1aRefuse('R1A_OUTSIDE_PILOT');return j;}
function _r1aAssigned(store,a,jobId){
  if(_r1aAdmin(a))return true;
  return store.list('Tasks').some(function(t){return t.job_id===jobId&&(t.owner_id===a.id||t.backup_id===a.id);})||
    store.list('Issues').some(function(i){return i.job_id===jobId&&(i.responsible_person_id===a.id||i.office_owner_id===a.id);})||
    store.list('Jobs').some(function(j){return j.id===jobId&&j.salesperson_id===a.id;});
}
function _r1aAuthorizeJob(store,a,id){var j=_r1aJob(store,id);if(!_r1aAssigned(store,a,id))_r1aRefuse('R1A_JOB_ACCESS_DENIED');return j;}
function _r1aMode(store,id,wanted){var rows=store.list('ReleaseModes').filter(function(r){return r.function_id===id;});if(rows.length!==1)_r1aRefuse('R1A_MODE_MISSING');var m=rows[0];if(m.target_release!=='R1'||m.authorised_job_scope!=='Pilot'||m.mode!==wanted)_r1aRefuse('R1A_MODE_DENIED');return m;}
function _r1aModeAvailable(store,id,wanted){var rows=store.list('ReleaseModes').filter(function(r){return r.function_id===id;});return rows.length===1&&rows[0].target_release==='R1'&&rows[0].authorised_job_scope==='Pilot'&&rows[0].mode===wanted;}
function _r1aVersion(row,expected){if(!Number.isSafeInteger(expected)||expected<1||Number(row.version)!==expected)_r1aRefuse('R1A_STALE_VERSION');}
function _r1aFilterTasks(store,a,items){return (items||[]).filter(function(t){return (t.owner_id===a.id||t.backup_id===a.id||_r1aAdmin(a))&&(!t.job_id||(store.get('Jobs',t.job_id)||{}).pilot_job===true);});}

function _r1aCreate(options){
  var store=options.store, reads=options.reads||{}, services=options.services||{};
  function read(input){
    _r1aGuardEnvironment(options);_r1aKeys(input,['read_type','job_id','task_id','queue','as_of']);
    if(R1A_BOUND_READS.indexOf(input.read_type)<0)_r1aRefuse('R1A_UNKNOWN_READ');
    if(input.read_type==='IDENTITY_PROBE'){
      if(Object.keys(input).length!==1)_r1aRefuse('R1A_INVALID_FIELDS');
      var active=options.actorEmail(),effective=typeof options.effectiveUserEmail==='function'?options.effectiveUserEmail():'';
      active=_r1aText(active)?active.trim().toLowerCase():'';effective=_r1aText(effective)?effective.trim().toLowerCase():'';
      var matches=active?store.list('People').filter(function(p){return _r1aText(p.email)&&p.email.trim().toLowerCase()===active&&p.active===true;}):[];
      var person=matches.length===1?matches[0]:null,roles=person?store.list('PersonRoles').filter(function(r){return r.person_id===person.id&&r.active===true;}).map(function(r){return r.role;}).filter(function(r,i,a){return a.indexOf(r)===i;}).sort():[];
      return{ok:true,read_type:'IDENTITY_PROBE',data:{environment:'DEV',spreadsheet_id:R1A_BOUND_DEV_SHEET_ID,session_active_user_email:active||null,session_effective_user_email:effective||null,active_user_maps_to_active_people:!!person,resolved_person_roles:roles,authenticated:!!person&&roles.length>0}};
    }
    var a=_r1aActor(store,options.actorEmail());
    if(!_r1aOffice(a))_r1aRefuse('R1A_ROLE_DENIED');
    var out;
    if(input.read_type==='OFFICE_HOME'){
      out=reads.officeHome(store,{as_of:input.as_of});
      ['overdue','due_today','due_soon','booking_review'].forEach(function(k){out[k]=_r1aFilterTasks(store,a,out[k]);});
      out.unresolved_issues=(out.unresolved_issues||[]).filter(function(i){return _r1aAssigned(store,a,i.job_id);});
      out.overdue_count=out.overdue.length;out.due_today_count=out.due_today.length;out.due_soon_count=out.due_soon.length;out.booking_review_count=out.booking_review.length;out.unresolved_issues_count=out.unresolved_issues.length;
    } else if(input.read_type==='JOB_OVERVIEW'){_r1aAuthorizeJob(store,a,input.job_id);out=reads.jobOverview(store,input.job_id);
    } else if(input.read_type==='OPERATIONAL_QUEUE'){out=reads.operationalQueue(store,input.queue);out.tasks=_r1aFilterTasks(store,a,out.tasks||[]);out.count=out.tasks.length;
    } else if(input.read_type==='RELEASE_MODE_STATUS'){if(!_r1aAdmin(a))_r1aRefuse('R1A_ROLE_DENIED');out=reads.releaseModes(store);
    } else if(input.read_type==='SYSTEM_STATUS'){if(!_r1aAdmin(a)&&a.roles.indexOf('Office')<0)_r1aRefuse('R1A_ROLE_DENIED');out=reads.systemStatus(store);
    } else if(input.read_type==='AUDIT_HISTORY'){_r1aAuthorizeJob(store,a,input.job_id);out=reads.auditHistory(store,input.job_id);
    } else if(input.read_type==='ACTION_AVAILABILITY'){var aj=_r1aAuthorizeJob(store,a,input.job_id);out=reads.actionAvailability(store,input.job_id);var active=!aj.archived_at&&['CancellationInProgress','Cancelled'].indexOf(aj.workflow_stage)<0,fn01=_r1aModeAvailable(store,'FN-01','Automated'),cancelModes=fn01&&_r1aModeAvailable(store,'FN-17','Manual')&&_r1aModeAvailable(store,'FN-20','Manual'),fn15=_r1aModeAvailable(store,'FN-15','Manual'),fn19=_r1aModeAvailable(store,'FN-19','Manual'),fn11=_r1aModeAvailable(store,'FN-11','Manual'),officeMgr=_r1aOfficeManager(a);out.appsheet_commands={call_record:{command_type:'CALL_RECORD',available:active&&fn01,expected_version_entity:'Tasks'},issue_update:{command_type:'ISSUE_UPDATE',available:active&&fn01,expected_version_entity:'Issues'},planner_update:{command_type:'PLANNER_UPDATE',available:active&&fn01,expected_version_entity:'WorkPackages'},cancel_job:{command_type:'CANCEL_JOB',available:active&&cancelModes,expected_version_entity:'Jobs'},reinstate_job:{command_type:'REINSTATE_JOB',available:aj.workflow_stage==='Cancelled'&&cancelModes,expected_version_entity:'Jobs'},deposit_confirm:{command_type:'DEPOSIT_CONFIRM',available:active&&fn15&&_r1aAdmin(a)&&!aj.deposit_bank_confirmed_at,expected_version_entity:'Jobs'},operational_complete:{command_type:'OPERATIONAL_COMPLETE',available:active&&fn19&&fn11&&officeMgr&&!aj.operational_complete_at&&['InProgress','Aftercare'].indexOf(aj.workflow_stage)>=0,expected_version_entity:'Jobs'},booking_gates:{command_type:'BOOKING_GATES',available:active&&fn01&&['Prebooking','ReadyToBook','BookingInProgress'].indexOf(aj.workflow_stage)>=0,expected_version_entity:'Jobs'},sold_intake:{command_type:'SOLD_INTAKE',available:false,reason:'INTAKE_POLICY_NOT_APPROVED'},booking_intake:{command_type:'BOOKING_INTAKE',available:false,reason:'INTAKE_POLICY_NOT_APPROVED'}};
    } else {var t=store.get('Tasks',input.task_id);if(!t)_r1aRefuse('R1A_TASK_NOT_FOUND');if(t.job_id)_r1aAuthorizeJob(store,a,t.job_id);else if(t.owner_id!==a.id&&!_r1aAdmin(a))_r1aRefuse('R1A_TASK_ACCESS_DENIED');out=reads.taskActionAvailability(store,input.task_id);out.appsheet_commands={task_complete:{command_type:'TASK_COMPLETE',available:!!(out.actions&&out.actions.complete&&out.actions.complete.available)&&(t.owner_id===a.id||t.backup_id===a.id||_r1aAdmin(a)),expected_version_entity:'Tasks'}};}
    return {ok:true,read_type:input.read_type,actor_id:a.id,data:_r1aCopy(out)};
  }
  function command(input){
    var a=_r1aGuard(options);_r1aKeys(input,['command_id','command_type','job_id','task_id','issue_id','work_package_id','expected_version','payload']);
    if(!_r1aText(input.command_id))_r1aRefuse('R1A_COMMAND_ID_REQUIRED');
    if(R1A_BOUND_COMMANDS.indexOf(input.command_type)<0)_r1aRefuse('R1A_UNKNOWN_COMMAND');
    if(!_r1aOffice(a))_r1aRefuse('R1A_ROLE_DENIED');
    var service=services[input.command_type];
    if(typeof service!=='function')_r1aRefuse('R1A_COMMAND_UNSUPPORTED');
    if(input.command_type==='TASK_COMPLETE'){
      var task=store.get('Tasks',input.task_id);if(!task)_r1aRefuse('R1A_TASK_NOT_FOUND');
      if(task.job_id)_r1aAuthorizeJob(store,a,task.job_id);else if(task.owner_id!==a.id&&!_r1aAdmin(a))_r1aRefuse('R1A_TASK_ACCESS_DENIED');
      if(task.owner_id!==a.id&&task.backup_id!==a.id&&!_r1aAdmin(a))_r1aRefuse('R1A_TASK_ACCESS_DENIED');
      _r1aMode(store,'FN-01','Automated');
    } else if(input.command_type==='SOLD_INTAKE'||input.command_type==='BOOKING_INTAKE') {
      _r1aRefuse('R1A_INTAKE_POLICY_NOT_APPROVED');
    } else if(input.command_type==='DEPOSIT_CONFIRM') {
      if(!_r1aAdmin(a))_r1aRefuse('R1A_ROLE_DENIED');
      _r1aAuthorizeJob(store,a,input.job_id);_r1aMode(store,'FN-15','Manual');
    } else if(input.command_type==='OPERATIONAL_COMPLETE') {
      if(!_r1aOfficeManager(a))_r1aRefuse('R1A_ROLE_DENIED');
      _r1aAuthorizeJob(store,a,input.job_id);_r1aMode(store,'FN-19','Manual');_r1aMode(store,'FN-11','Manual');
    } else if(input.command_type==='BOOKING_GATES') {
      _r1aAuthorizeJob(store,a,input.job_id);_r1aMode(store,'FN-01','Automated');
    } else {
      _r1aAuthorizeJob(store,a,input.job_id);_r1aMode(store,'FN-01','Automated');
      if(input.command_type==='CALL_RECORD'){var ct=store.get('Tasks',input.task_id);if(!ct||ct.job_id!==input.job_id)_r1aRefuse('R1A_TASK_JOB_MISMATCH');if(ct.owner_id!==a.id&&ct.backup_id!==a.id&&!_r1aAdmin(a))_r1aRefuse('R1A_TASK_ACCESS_DENIED');}
      if(input.command_type==='ISSUE_UPDATE'){var ci=store.get('Issues',input.issue_id);if(!ci||ci.job_id!==input.job_id)_r1aRefuse('R1A_ISSUE_JOB_MISMATCH');}
      if(input.command_type==='PLANNER_UPDATE'){var cw=store.get('WorkPackages',input.work_package_id);if(!cw||cw.job_id!==input.job_id)_r1aRefuse('R1A_WORK_PACKAGE_JOB_MISMATCH');}
      if(input.command_type==='CANCEL_JOB'||input.command_type==='REINSTATE_JOB'){_r1aMode(store,'FN-17','Manual');_r1aMode(store,'FN-20','Manual');}
    }
    var result=service({request:_r1aCopy(input),actor:a,store:store});
    return {ok:true,command_type:input.command_type,actor_id:a.id,result:_r1aCopy(result)};
  }
  return {read:read,command:command};
}

if(typeof module!=='undefined')module.exports={R1A_BOUND_DEV_SHEET_ID,R1A_BOUND_READS,R1A_BOUND_COMMANDS,_r1aActor,_r1aCreate};
