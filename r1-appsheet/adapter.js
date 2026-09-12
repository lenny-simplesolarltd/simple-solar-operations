/* R1 AppSheet command/read boundary. DEV only; AppSheet is never authoritative. */
'use strict';

const R1A_BOUND_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const R1A_BOUND_READS = ['IDENTITY_PROBE','OFFICE_HOME','JOB_SEARCH','JOB_OVERVIEW','OPERATIONAL_QUEUE','RELEASE_MODE_STATUS','SYSTEM_STATUS','AUDIT_HISTORY','ACTION_AVAILABILITY','TASK_ACTION_AVAILABILITY','MY_TASKS','TEAM_TASKS','PLANNER_3_WEEKS','PLANNER_6_WEEKS','INTAKE_REVIEW'];
const R1A_BOUND_COMMANDS = ['TASK_COMPLETE','CALL_RECORD','ISSUE_UPDATE','ISSUE_CREATE','PLANNER_UPDATE','MOVE_JOB','CHANGE_INSTALLER','CANCEL_JOB','REINSTATE_JOB','DEPOSIT_CONFIRM','OPERATIONAL_COMPLETE','BOOKING_GATES','SOLD_INTAKE','BOOKING_INTAKE'];
const R1A_BOUND_QUEUES = ['booking','calls','issues','payments','ghl','cancellation','intake_review'];

function _r1aCopy(v) { return JSON.parse(JSON.stringify(v)); }
function _r1aRefuse(code) { var e=new Error(code); e.code=code; throw e; }
function _r1aObject(v) { return v && typeof v==='object' && !Array.isArray(v); }
function _r1aKeys(v, allowed) { if(!_r1aObject(v) || Object.keys(v).some(function(k){return allowed.indexOf(k)<0;})) _r1aRefuse('R1A_INVALID_FIELDS'); }
function _r1aText(v) { return typeof v==='string' && v.trim().length>0; }
function _r1aFlag(ok,type,entity,reason){var o={command_type:type,available:!!ok};if(entity)o.expected_version_entity=entity;if(!ok&&reason)o.reason=reason;return o;}

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
function _r1aDirector(a){return _r1aAdmin(a)||a.roles.indexOf('Director')>=0;}
function _r1aOffice(a){return _r1aDirector(a)||a.roles.indexOf('Office')>=0||a.roles.indexOf('VariationApprover')>=0;}
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
    _r1aGuardEnvironment(options);_r1aKeys(input,['read_type','job_id','task_id','queue','as_of','query']);
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
    } else if(input.read_type==='JOB_SEARCH'){
      if(!_r1aText(input.query))_r1aRefuse('R1A_QUERY_REQUIRED');
      if(typeof reads.jobSearch!=='function')_r1aRefuse('R1A_READ_UNSUPPORTED');
      var results=(reads.jobSearch(store,input.query)||[]).filter(function(r){var j=store.get('Jobs',r.id);return !!j&&j.pilot_job===true&&j.release_scope==='R1'&&_r1aAssigned(store,a,r.id);});
      out={query:input.query.trim(),count:results.length,results:results};
    } else if(input.read_type==='JOB_OVERVIEW'){_r1aAuthorizeJob(store,a,input.job_id);out=reads.jobOverview(store,input.job_id);
    } else if(input.read_type==='OPERATIONAL_QUEUE'){
      if(!_r1aText(input.queue)||R1A_BOUND_QUEUES.indexOf(input.queue)<0)_r1aRefuse('R1A_QUEUE_NOT_IN_R1');
      out=reads.operationalQueue(store,input.queue);out.tasks=_r1aFilterTasks(store,a,out.tasks||[]);out.count=out.tasks.length;
    } else if(input.read_type==='RELEASE_MODE_STATUS'){if(!_r1aAdmin(a))_r1aRefuse('R1A_ROLE_DENIED');out=reads.releaseModes(store);
    } else if(input.read_type==='SYSTEM_STATUS'){if(!_r1aAdmin(a)&&a.roles.indexOf('Office')<0)_r1aRefuse('R1A_ROLE_DENIED');out=reads.systemStatus(store);
    } else if(input.read_type==='AUDIT_HISTORY'){_r1aAuthorizeJob(store,a,input.job_id);out=reads.auditHistory(store,input.job_id);
    } else if(input.read_type==='ACTION_AVAILABILITY'){
      var aj=_r1aAuthorizeJob(store,a,input.job_id);out=reads.actionAvailability(store,input.job_id);
      var active=!aj.archived_at&&['CancellationInProgress','Cancelled'].indexOf(aj.workflow_stage)<0,fn01=_r1aModeAvailable(store,'FN-01','Automated'),cancelModes=fn01&&_r1aModeAvailable(store,'FN-17','Manual')&&_r1aModeAvailable(store,'FN-20','Manual'),fn15=_r1aModeAvailable(store,'FN-15','Manual'),fn19=_r1aModeAvailable(store,'FN-19','Manual'),fn11=_r1aModeAvailable(store,'FN-11','Manual'),officeMgr=_r1aOfficeManager(a),isAdmin=_r1aAdmin(a);
      var depOk=active&&fn15&&_r1aDirector(a)&&!aj.deposit_bank_confirmed_at,opcOk=active&&fn19&&fn11&&officeMgr&&!aj.operational_complete_at&&['InProgress','Aftercare'].indexOf(aj.workflow_stage)>=0,bkgOk=active&&fn01&&['Prebooking','ReadyToBook','BookingInProgress'].indexOf(aj.workflow_stage)>=0,reinOk=aj.workflow_stage==='Cancelled'&&cancelModes,bookInOk=active&&fn01&&['Prebooking','ReadyToBook','BookingInProgress'].indexOf(aj.workflow_stage)>=0;
      var moveOk=active&&fn01&&['Booked','AwaitingInstallation','InProgress','BookingInProgress'].indexOf(aj.workflow_stage)>=0;
      var changeOk=moveOk;
      out.appsheet_commands={
        call_record:_r1aFlag(active&&fn01,'CALL_RECORD','Tasks',!active?'JOB_NOT_ACTIONABLE':'MODE_UNAVAILABLE'),
        issue_update:_r1aFlag(active&&fn01,'ISSUE_UPDATE','Issues',!active?'JOB_NOT_ACTIONABLE':'MODE_UNAVAILABLE'),
        issue_create:_r1aFlag(active&&fn01,'ISSUE_CREATE','Jobs',!active?'JOB_NOT_ACTIONABLE':'MODE_UNAVAILABLE'),
        planner_update:_r1aFlag(active&&fn01,'PLANNER_UPDATE','WorkPackages',!active?'JOB_NOT_ACTIONABLE':'MODE_UNAVAILABLE'),
        move_job:_r1aFlag(moveOk,'MOVE_JOB','Jobs',!active?'JOB_NOT_ACTIONABLE':!fn01?'MODE_UNAVAILABLE':'STAGE_NOT_ELIGIBLE'),
        change_installer:_r1aFlag(changeOk,'CHANGE_INSTALLER','WorkPackages',!active?'JOB_NOT_ACTIONABLE':!fn01?'MODE_UNAVAILABLE':'STAGE_NOT_ELIGIBLE'),
        cancel_job:_r1aFlag(active&&cancelModes,'CANCEL_JOB','Jobs',!active?'JOB_NOT_ACTIONABLE':'MODE_UNAVAILABLE'),
        reinstate_job:_r1aFlag(reinOk,'REINSTATE_JOB','Jobs',aj.workflow_stage!=='Cancelled'?'STAGE_NOT_CANCELLED':'MODE_UNAVAILABLE'),
        deposit_confirm:_r1aFlag(depOk,'DEPOSIT_CONFIRM','Jobs',!active?'JOB_NOT_ACTIONABLE':!_r1aDirector(a)?'DIRECTOR_REQUIRED':!fn15?'MODE_UNAVAILABLE':'ALREADY_CONFIRMED'),
        operational_complete:_r1aFlag(opcOk,'OPERATIONAL_COMPLETE','Jobs',!active?'JOB_NOT_ACTIONABLE':!officeMgr?'OFFICE_OR_ADMIN_REQUIRED':!(fn19&&fn11)?'MODE_UNAVAILABLE':aj.operational_complete_at?'ALREADY_COMPLETE':'STAGE_NOT_ELIGIBLE'),
        booking_gates:_r1aFlag(bkgOk,'BOOKING_GATES','Jobs',!active?'JOB_NOT_ACTIONABLE':!fn01?'MODE_UNAVAILABLE':'STAGE_NOT_ELIGIBLE'),
        sold_intake:_r1aFlag(fn01,'SOLD_INTAKE',null,fn01?null:'MODE_UNAVAILABLE'),
        booking_intake:_r1aFlag(bookInOk,'BOOKING_INTAKE','Jobs',!active?'JOB_NOT_ACTIONABLE':!fn01?'MODE_UNAVAILABLE':'STAGE_NOT_ELIGIBLE')
      };
    } else if(input.read_type==='MY_TASKS'){
      var home=reads.officeHome(store,{as_of:input.as_of});
      var mine=_r1aFilterTasks(store,a,(home.overdue||[]).concat(home.due_today||[]).concat(home.due_soon||[]).concat(home.booking_review||[]));
      // Deduplicate by id
      var seen={},tasks=[];mine.forEach(function(t){if(!seen[t.id]){seen[t.id]=true;tasks.push(t);}});
      out={scope:'my',as_of:home.as_of||input.as_of||null,count:tasks.length,tasks:tasks};
    } else if(input.read_type==='TEAM_TASKS'){
      if(!_r1aOfficeManager(a)&&!_r1aAdmin(a))_r1aRefuse('R1A_ROLE_DENIED');
      var teamHome=reads.officeHome(store,{as_of:input.as_of});
      var team=(teamHome.overdue||[]).concat(teamHome.due_today||[]).concat(teamHome.due_soon||[]).concat(teamHome.booking_review||[]);
      var tseen={},ttasks=[];team.forEach(function(t){if(!tseen[t.id]&&(!t.job_id||(store.get('Jobs',t.job_id)||{}).pilot_job===true)){tseen[t.id]=true;ttasks.push(t);}});
      out={scope:'team',as_of:teamHome.as_of||input.as_of||null,count:ttasks.length,tasks:ttasks};
    } else if(input.read_type==='PLANNER_3_WEEKS'||input.read_type==='PLANNER_6_WEEKS'){
      if(!_r1aOffice(a))_r1aRefuse('R1A_ROLE_DENIED');
      var weeks=input.read_type==='PLANNER_3_WEEKS'?3:6;
      if(typeof reads.planner!=='function')_r1aRefuse('R1A_READ_UNSUPPORTED');
      out=reads.planner(store,input.as_of||null,weeks);
    } else if(input.read_type==='INTAKE_REVIEW'){
      if(!_r1aOfficeManager(a)&&!_r1aAdmin(a))_r1aRefuse('R1A_ROLE_DENIED');
      var reviews=store.list('Intake').filter(function(i){return i.processing_status==='Review';}).map(function(i){return{id:i.id,intake_id:i.intake_id,form_type:i.form_type,submission_id:i.submission_id,job_id:i.job_id,validation_errors:i.validation_errors,received_at:i.received_at};});
      out={queue:'intake_review',count:reviews.length,items:reviews};
    } else {
      var t=store.get('Tasks',input.task_id);if(!t)_r1aRefuse('R1A_TASK_NOT_FOUND');if(t.job_id)_r1aAuthorizeJob(store,a,t.job_id);else if(t.owner_id!==a.id&&!_r1aAdmin(a))_r1aRefuse('R1A_TASK_ACCESS_DENIED');
      out=reads.taskActionAvailability(store,input.task_id);
      var completeAvail=!!(out.actions&&out.actions.complete&&out.actions.complete.available),ownerOk=t.owner_id===a.id||t.backup_id===a.id||_r1aAdmin(a);
      out.appsheet_commands={task_complete:_r1aFlag(completeAvail&&ownerOk,'TASK_COMPLETE','Tasks',!completeAvail?'COMPLETE_NOT_AVAILABLE':'TASK_OWNER_OR_BACKUP_REQUIRED')};
    }
    return {ok:true,read_type:input.read_type,actor_id:a.id,data:_r1aCopy(out)};
  }
  function command(input){
    var a=_r1aGuard(options);_r1aKeys(input,['command_id','command_type','job_id','task_id','issue_id','work_package_id','old_allocation_id','expected_version','payload']);
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
    } else if(input.command_type==='SOLD_INTAKE') {
      /* Office/Admin/Manager, and Director because existing _r1aOffice includes Director. Installer/Store/Scaffolder already refused. No job mutation envelope. */
      _r1aMode(store,'FN-01','Automated');
    } else if(input.command_type==='BOOKING_INTAKE') {
      if(!_r1aText(input.job_id))_r1aRefuse('R1A_JOB_NOT_FOUND');
      _r1aAuthorizeJob(store,a,input.job_id);_r1aMode(store,'FN-01','Automated');
    } else if(input.command_type==='ISSUE_CREATE') {
      if(!_r1aText(input.job_id))_r1aRefuse('R1A_JOB_NOT_FOUND');
      _r1aAuthorizeJob(store,a,input.job_id);_r1aMode(store,'FN-01','Automated');
    } else if(input.command_type==='DEPOSIT_CONFIRM') {
      if(!_r1aDirector(a))_r1aRefuse('R1A_ROLE_DENIED');
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
      if(input.command_type==='MOVE_JOB'){/* job-scoped; activities validated in service */}
      if(input.command_type==='CHANGE_INSTALLER'){var cwp=store.get('WorkPackages',input.work_package_id);if(!cwp||cwp.job_id!==input.job_id)_r1aRefuse('R1A_WORK_PACKAGE_JOB_MISMATCH');}
      if(input.command_type==='CANCEL_JOB'||input.command_type==='REINSTATE_JOB'){_r1aMode(store,'FN-17','Manual');_r1aMode(store,'FN-20','Manual');}
    }
    var result=service({request:_r1aCopy(input),actor:a,store:store});
    return {ok:true,command_type:input.command_type,actor_id:a.id,result:_r1aCopy(result)};
  }
  return {read:read,command:command};
}

if(typeof module!=='undefined')module.exports={R1A_BOUND_DEV_SHEET_ID,R1A_BOUND_READS,R1A_BOUND_COMMANDS,R1A_BOUND_QUEUES,_r1aActor,_r1aCreate};
