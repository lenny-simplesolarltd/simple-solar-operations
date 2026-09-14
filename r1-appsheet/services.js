/* Narrow ordinary-R1 services. Stage functions remain the business-rule authority. */
'use strict';

function _r1sErr(code){var e=new Error(code);e.code=code;throw e;}
function _r1sText(v){return typeof v==='string'&&v.trim().length>0;}
function _r1sPayload(request,allowed,required){var p=request.payload||{};if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(function(k){return allowed.indexOf(k)<0;}))_r1sErr('R1A_INVALID_FIELDS');(required||[]).forEach(function(k){if(p[k]===undefined||p[k]===null||p[k]==='')_r1sErr('R1A_REQUIRED_'+k.toUpperCase());});return p;}
function _r1sInsertAudit(store,id,type,entity,action,before,after,actor,command,reason,service,now){if(store.get('AuditEvents',id))return;store.insert('AuditEvents',{id:id,entity_type:type,entity_id:entity,action:action,before_json:before?JSON.stringify(before):null,after_json:JSON.stringify(after),initiating_actor:actor,executing_service:service,timestamp:now,correlation_id:command,reason:reason||null,commit_id:'R1A-'+command,created_at:now});}

function _r1sResolveContractEvidenceId(store,jobId,evidenceId){
  if(!_r1sText(evidenceId))_r1sErr('R1A_REQUIRED_EVIDENCE_ID');
  var id=String(evidenceId).trim();
  var byId=store.get('Evidence',id);
  if(byId){
    if(byId.job_id!==jobId)_r1sErr('R1A_CROSS_JOB_EVIDENCE');
    return byId.id;
  }
  var byDrive=(store.list('Evidence')||[]).filter(function(e){return e.drive_file_id===id&&e.job_id===jobId;});
  if(byDrive.length>1)_r1sErr('R1A_EVIDENCE_AMBIGUOUS');
  if(byDrive.length===1)return byDrive[0].id;
  return id;
}

function _r1sHashDrive(text){
  var h=0,s=String(text||''),i,hex;
  for(i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;
  hex=(h>>>0).toString(16);
  while(hex.length<8)hex='0'+hex;
  return hex;
}

/* Resolve AppSheet File path via existing upload resolver. Never invents Evidence ids. */
function _r1sResolveEvidencePath(path,ctx){
  if(!_r1sText(path))return null;
  var resolve=null;
  if(ctx&&typeof ctx.resolveUpload==='function')resolve=ctx.resolveUpload;
  else if(typeof _r1cResolveUpload==='function')resolve=_r1cResolveUpload;
  if(!resolve)_r1sErr('R1A_UPLOAD_RESOLVER_MISSING');
  return resolve(String(path).trim());
}

/* Idempotent Evidence row keyed by job_id + drive_file_id (deterministic id EV-R1A-{job}-{hash}). */
function _r1sEnsureOfficeTaskEvidence(store,jobId,actorId,category,upload,now,commandId){
  if(!upload||!_r1sText(upload.drive_file_id))_r1sErr('R1A_UPLOAD_INVALID');
  var driveId=String(upload.drive_file_id).trim();
  var matches=(store.list('Evidence')||[]).filter(function(e){return e&&e.job_id===jobId&&String(e.drive_file_id||'').trim()===driveId;});
  if(matches.length>1)_r1sErr('R1A_EVIDENCE_AMBIGUOUS');
  if(matches.length===1)return{evidence_id:matches[0].id,created:false};
  var id='EV-R1A-'+jobId+'-'+_r1sHashDrive(driveId);
  var byId=store.get('Evidence',id);
  if(byId){
    if(byId.job_id!==jobId)_r1sErr('R1A_CROSS_JOB_EVIDENCE');
    if(String(byId.drive_file_id||'').trim()!==driveId)_r1sErr('R1A_EVIDENCE_AMBIGUOUS');
    return{evidence_id:byId.id,created:false};
  }
  store.insert('Evidence',{
    id:id,
    job_id:jobId,
    submission_id:null,
    issue_id:null,
    category:category,
    drive_file_id:driveId,
    filename:_r1sText(upload.filename)?String(upload.filename).trim():(String(category).toLowerCase()+'-'+jobId),
    mime_type:upload.mime_type||null,
    upload_status:'Uploaded',
    captured_at:now,
    captured_by:actorId,
    received_at:now,
    customer_shareable:false,
    version:1,
    checksum:null,
    created_at:now,
    commit_id:'R1A-'+commandId
  });
  return{evidence_id:id,created:true};
}

function _r1sApplyPre02Contract(store,job,actorId,evidenceId,now,commandId){
  var resolved=_r1sResolveContractEvidenceId(store,job.id,evidenceId);
  if(job.contract_status==='Signed'&&job.contract_evidence_id===resolved&&job.contract_signed_at){
    return store.get('Jobs',job.id);
  }
  var patch={
    contract_status:'Signed',
    contract_evidence_id:resolved,
    contract_signed_at:job.contract_signed_at||now,
    updated_at:now,
    updated_by:actorId,
    version:Number(job.version||0)+1,
    commit_id:'R1A-'+commandId
  };
  store.update('Jobs',job.id,patch);
  return store.get('Jobs',job.id);
}

function _r1sApplyPre04Verification(store,job,actorId,now,commandId){
  if(job.customer_details_verified_at&&job.customer_details_verified_by){
    return store.get('Jobs',job.id);
  }
  if(!(typeof job.original_gross_pence==='number'&&job.original_gross_pence>0))_r1sErr('R1A_SOLD_VALUE_REQUIRED');
  store.update('Jobs',job.id,{
    customer_details_verified_at:now,
    customer_details_verified_by:actorId,
    updated_at:now,
    updated_by:actorId,
    version:Number(job.version||0)+1,
    commit_id:'R1A-'+commandId
  });
  return store.get('Jobs',job.id);
}

/* Internal post-command readiness hook. It only evaluates the Prebooking phase,
 * so booking-link gates cannot advance a later phase and no public command is
 * recursively invoked. */
function _r1sReevaluatePrebooking(store,jobId,actorId,commandId,now){
  if(!_r1sText(jobId))return null;
  var job=store.get('Jobs',jobId);
  if(!job||job.workflow_stage!=='Prebooking')return null;
  if(typeof processBookingGates!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');
  return processBookingGates(jobId,store,{actor:actorId,command_id:'AUTO-'+commandId,now:now});
}

function _r1sTaskComplete(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['completion_note','evidence_id','evidence_path'],['completion_note']),t=s.get('Tasks',r.task_id),jid='CJ-R1A-'+r.command_id;
  return s.withLock(function(){var prior=s.get('CommitJournal',jid);if(prior){if(prior.entity_type!=='Tasks'||prior.entity_id!==r.task_id||prior.changes_json!==JSON.stringify(p))_r1sErr('R1A_COMMAND_CONFLICT');if(prior.state!=='Committed')_r1sErr('R1A_RECOVERY_REQUIRED');return{status:'Replayed',task:s.get('Tasks',r.task_id),job:t&&t.job_id?s.get('Jobs',t.job_id):null,external_calls:0};}
    t=s.get('Tasks',r.task_id);if(Number(t.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');if(['Complete','NotRequired','Cancelled'].indexOf(t.status)>=0)_r1sErr('R1A_TASK_NOT_COMPLETABLE');if(['Open','Waiting','InProgress'].indexOf(t.status)<0||t.revision_required===true)_r1sErr('R1A_TASK_NOT_COMPLETABLE');
    var evidenceId=p.evidence_id||t.evidence_id||null,pendingUpload=null,pendingCategory=null;
    if(t.template_code==='PRE02'||t.template_code==='PRE04'){
      pendingCategory=t.template_code==='PRE02'?'Contract':'CustomerDetails';
      if(_r1sText(p.evidence_path)){
        pendingUpload=_r1sResolveEvidencePath(p.evidence_path,ctx);
      } else {
        if(!_r1sText(evidenceId))_r1sErr('R1A_REQUIRED_EVIDENCE_ID');
        if(t.template_code==='PRE02')evidenceId=_r1sResolveContractEvidenceId(s,t.job_id,evidenceId);
        else {
          var ev=s.get('Evidence',String(evidenceId).trim());
          if(ev&&ev.job_id!==t.job_id)_r1sErr('R1A_CROSS_JOB_EVIDENCE');
          evidenceId=String(evidenceId).trim();
        }
      }
    }
    var now=new Date().toISOString();
    s.insert('CommitJournal',{id:jid,commit_id:'R1A-'+r.command_id,state:'Prepared',command_id:r.command_id,entity_type:'Tasks',entity_id:t.id,expected_version:r.expected_version,changes_json:JSON.stringify(p),prepared_at:now,committed_at:null,created_at:now});
    try{
    if(pendingUpload){
      var ensured=_r1sEnsureOfficeTaskEvidence(s,t.job_id,a.id,pendingCategory,pendingUpload,now,r.command_id);
      if(_r1sText(p.evidence_id)&&String(p.evidence_id).trim()!==ensured.evidence_id)_r1sErr('R1A_EVIDENCE_CONFLICT');
      evidenceId=ensured.evidence_id;
    }
    var after=Object.assign({},t,{status:'Complete',completed_at:now,completed_by:a.id,completion_note:p.completion_note,evidence_id:evidenceId||null,updated_at:now,updated_by:a.id,version:Number(t.version)+1,commit_id:'R1A-'+r.command_id});
    s.update('Tasks',t.id,{status:after.status,completed_at:after.completed_at,completed_by:after.completed_by,completion_note:after.completion_note,evidence_id:after.evidence_id,updated_at:now,updated_by:a.id,version:after.version,commit_id:after.commit_id});
    s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'Complete',old_status:t.status,new_status:'Complete',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.completion_note,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
    var jobAfter=null,readiness=null;
    if(t.job_id&&(t.template_code==='PRE02'||t.template_code==='PRE04')){
      var job=s.get('Jobs',t.job_id);if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
      if(t.template_code==='PRE02')jobAfter=_r1sApplyPre02Contract(s,job,a.id,evidenceId,now,r.command_id);
      if(t.template_code==='PRE04')jobAfter=_r1sApplyPre04Verification(s,job,a.id,now,r.command_id);
    }
    if(t.job_id&&['PRE01','PRE02','PRE03','PRE04','PRE05'].indexOf(t.template_code)>=0){readiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);jobAfter=s.get('Jobs',t.job_id);}
    _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'Complete',t,after,a.id,r.command_id,p.completion_note,'R1 AppSheet/S04',now);s.update('CommitJournal',jid,{state:'Committed',committed_at:now});return{status:'Completed',task:s.get('Tasks',t.id),job:jobAfter,readiness:readiness&&readiness.readiness||null,external_calls:0};}catch(e){s.update('CommitJournal',jid,{state:'RecoveryRequired'});throw e;}});}

/* Legacy repair: attach required evidence to an already-Complete PRE02 with blank evidence_id.
 * Does not reopen the task or alter completed_at / completed_by / completion_note. */
function _r1sTaskEvidenceAttach(ctx){
  var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['evidence_path'],['evidence_path']),t=s.get('Tasks',r.task_id),jid='CJ-R1A-'+r.command_id;
  return s.withLock(function(){
    var prior=s.get('CommitJournal',jid);
    if(prior){
      if(prior.entity_type!=='Tasks'||prior.entity_id!==r.task_id||prior.changes_json!==JSON.stringify(p))_r1sErr('R1A_COMMAND_CONFLICT');
      if(prior.state!=='Committed')_r1sErr('R1A_RECOVERY_REQUIRED');
      return{status:'Replayed',task:s.get('Tasks',r.task_id),job:t&&t.job_id?s.get('Jobs',t.job_id):null,external_calls:0};
    }
    t=s.get('Tasks',r.task_id);
    if(!t)_r1sErr('R1A_TASK_NOT_FOUND');
    if(Number(t.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');
    if(t.status!=='Complete')_r1sErr('R1A_TASK_NOT_ATTACHABLE');
    if(t.template_code!=='PRE02')_r1sErr('R1A_TASK_NOT_ATTACHABLE');
    if(_r1sText(t.evidence_id))_r1sErr('R1A_EVIDENCE_ALREADY_ATTACHED');
    if(!t.job_id)_r1sErr('R1A_JOB_NOT_FOUND');
    var upload=_r1sResolveEvidencePath(p.evidence_path,ctx);
    var now=new Date().toISOString();
    var before={
      status:t.status,completed_at:t.completed_at,completed_by:t.completed_by,completion_note:t.completion_note,
      evidence_id:t.evidence_id,version:t.version
    };
    s.insert('CommitJournal',{id:jid,commit_id:'R1A-'+r.command_id,state:'Prepared',command_id:r.command_id,entity_type:'Tasks',entity_id:t.id,expected_version:r.expected_version,changes_json:JSON.stringify(p),prepared_at:now,committed_at:null,created_at:now});
    try{
      var ensured=_r1sEnsureOfficeTaskEvidence(s,t.job_id,a.id,'Contract',upload,now,r.command_id);
      var evidenceId=ensured.evidence_id;
      s.update('Tasks',t.id,{
        evidence_id:evidenceId,
        updated_at:now,
        updated_by:a.id,
        version:Number(t.version)+1,
        commit_id:'R1A-'+r.command_id
      });
      var after=s.get('Tasks',t.id);
      if(after.status!=='Complete'||after.completed_at!==t.completed_at||after.completed_by!==t.completed_by||after.completion_note!==t.completion_note)_r1sErr('R1A_TASK_COMPLETION_MUTATION');
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'EvidenceAttach',old_status:t.status,new_status:t.status,old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:'TASK_EVIDENCE_ATTACH',actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      var job=s.get('Jobs',t.job_id);if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
      var grossBefore=job.original_gross_pence;
      var jobAfter=_r1sApplyPre02Contract(s,job,a.id,evidenceId,now,r.command_id);
      if(jobAfter.original_gross_pence!==grossBefore)_r1sErr('R1A_FINANCIAL_MUTATION');
      var readiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);
      jobAfter=s.get('Jobs',t.job_id);
      _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'EvidenceAttach',before,after,a.id,r.command_id,p.evidence_path,'R1 AppSheet/S04',now);
      s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
      return{status:'Attached',task:s.get('Tasks',t.id),job:jobAfter,evidence_id:evidenceId,readiness:readiness&&readiness.readiness||null,external_calls:0};
    }catch(e){s.update('CommitJournal',jid,{state:'RecoveryRequired'});throw e;}
  });
}

function _r1sCallRecord(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['type','work_package_id','contact_id','person_id','attempted_at','outcome','notes','next_attempt_at','actual_completion_confirmed','customer_happy'],['type','outcome']),t=s.get('Tasks',r.task_id),id='CALL-R1A-'+r.command_id,existing=s.get('Calls',id);if(existing)return{status:'Replayed',call:existing,external_calls:0};if(!t||Number(t.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');var before=t,res=_s10RecordCall({id:id,job_id:r.job_id,work_package_id:p.work_package_id||null,task_id:r.task_id,type:p.type,contact_id:p.contact_id||null,person_id:p.person_id||null,attempted_at:p.attempted_at,attempted_by:a.id,outcome:p.outcome,notes:p.notes||null,next_attempt_at:p.next_attempt_at||null,actual_completion_confirmed:p.actual_completion_confirmed===true,customer_happy:p.customer_happy,commit_id:'R1A-'+r.command_id},s),now=(res.call||{}).attempted_at||new Date().toISOString(),after=s.get('Tasks',t.id);if(after&&Number(after.version)!==Number(before.version))s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'CallOutcome',old_status:before.status,new_status:after.status,old_owner:before.owner_id,new_owner:after.owner_id,old_due:before.due_at,new_due:after.due_at,reason:p.outcome,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Calls',id,'RecordCall',null,res.call,a.id,r.command_id,p.notes,'R1 AppSheet/S10',now);return{status:'Recorded',call:res.call,external_calls:0};}

function _r1sIssueUpdate(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['action','owner_id','status','resolution','evidence_id','customer_resolution_confirmed'],['action']),issue=s.get('Issues',r.issue_id),aid='AE-R1A-'+r.command_id;if(s.get('AuditEvents',aid))return{status:'Replayed',issue:issue,external_calls:0};if(!issue||Number(issue.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');var before=issue,after;if(p.action==='REASSIGN'){if(!_r1sText(p.owner_id))_r1sErr('R1A_REQUIRED_OWNER_ID');after=_s10ReassignIssue(issue.id,p.owner_id,a.id,s);}else if(p.action==='TRANSITION'){after=_s10TransitionIssue(issue.id,p.status,a.id,s,{resolution:p.resolution,evidence_id:p.evidence_id,customer_resolution_confirmed:p.customer_resolution_confirmed===true});}else _r1sErr('R1A_ISSUE_ACTION_DENIED');_r1sInsertAudit(s,aid,'Issues',issue.id,p.action,before,after,a.id,r.command_id,p.resolution,'R1 AppSheet/S10',new Date().toISOString());return{status:'Updated',issue:after,external_calls:0};}

function _r1sEnsureIssueTaskTemplates(store){
  var now=new Date().toISOString(),needed=[
    {id:'TPL-ISS01',template_code:'ISS01',title:'Review variation',group:'Aftercare',default_owner_role:'VariationApprover'},
    {id:'TPL-ISS02',template_code:'ISS02',title:'Investigate and resolve issue',group:'Aftercare',default_owner_role:'Office'}
  ];
  needed.forEach(function(tpl){
    var byCode=store.list('TaskTemplates').filter(function(t){return t.template_code===tpl.template_code&&t.active===true;});
    if(byCode.length)return;
    if(store.get('TaskTemplates',tpl.id))return;
    store.insert('TaskTemplates',{id:tpl.id,template_code:tpl.template_code,title:tpl.title,group:tpl.group,default_owner_role:tpl.default_owner_role,trigger_event:'Issue created',due_rule:'Next staffed day',evidence_required:'Issue outcome',active:true,template_version:'R1A-1.0',created_at:now,created_by:'R1A-appsheet',updated_at:now,updated_by:'R1A-appsheet',version:1,commit_id:'R1A-ISSUE-TPL'});
  });
}
function _r1sIssueImpact(v){
  if(v===undefined||v===null||v==='')return undefined;
  if(v===true||v===false)return v;
  var s=String(v).trim().toLowerCase();
  if(['yes','true','1','y'].indexOf(s)>=0)return true;
  if(['no','false','0','n'].indexOf(s)>=0)return false;
  _r1sErr('R1A_INVALID_CUSTOMER_IMPACT');
}
function _r1sIssueCreate(ctx){
  var r=ctx.request,s=ctx.store,a=ctx.actor;
  if(r.task_id||r.issue_id||r.work_package_id||r.old_allocation_id)_r1sErr('R1A_INVALID_FIELDS');
  if(!_r1sText(r.job_id))_r1sErr('R1A_JOB_NOT_FOUND');
  _r1sCommandId(r.command_id);
  var p=_r1sPayload(r,['issue_type','title','description','severity','owner_id','customer_impact','requested_by','requested_at'],['issue_type','title','description']);
  if(['Variation','Remedial','Complaint'].indexOf(p.issue_type)<0)_r1sErr('R1A_INVALID_ISSUE_TYPE');
  var severity=_r1sText(p.severity)?String(p.severity).trim():'Normal';
  if(['Normal','Medium'].indexOf(severity)<0)_r1sErr('R1A_INVALID_SEVERITY');
  if(!_r1sBlank(p.owner_id))_r1sActivePerson(s,p.owner_id);
  if(!_r1sBlank(p.requested_by)&&!_r1sActorMatch(a,p.requested_by))_r1sErr('R1A_ACTOR_MISMATCH');
  var impact=_r1sIssueImpact(p.customer_impact),expected=_r1sVersion(r.expected_version);
  var fingerprint=JSON.stringify({command_type:'ISSUE_CREATE',job_id:r.job_id,payload:{issue_type:p.issue_type,title:p.title,description:p.description,severity:severity,owner_id:p.owner_id||null,customer_impact:impact===undefined?null:impact,requested_at:p.requested_at||null}});
  return s.withLock(function(){
    var now=new Date().toISOString(),issueId='ISS-R1A-'+r.command_id,prior=s.get('CommitJournal',_r1sJournalId(r.command_id));
    var job=s.get('Jobs',r.job_id);if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
    if(job.pilot_job!==true||job.release_scope!=='R1')_r1sErr('R1A_OUTSIDE_PILOT');
    if(!prior){
      if(Number(job.version)!==expected)_r1sErr('R1A_STALE_VERSION');
      if(job.archived_at||['CancellationInProgress','Cancelled'].indexOf(job.workflow_stage)>=0)_r1sErr('R1A_JOB_NOT_ACTIONABLE');
    }
    var journal=_r1sBeginJournal(s,r.command_id,'Issues',issueId,expected,fingerprint,now);
    var jobsBefore=s.list('Jobs').length,issueCountBefore=s.list('Issues').length,jobVersionBefore=Number(job.version);
    try{
      if(typeof _s10CreateIssue!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');
      _r1sEnsureIssueTaskTemplates(s);
      var input={id:issueId,job_id:r.job_id,type:p.issue_type,category:String(p.title).trim(),description:String(p.description).trim(),raised_at:p.requested_at||now,raised_by:a.id,office_owner_id:p.owner_id||null,severity:severity,commit_id:'R1A-'+r.command_id};
      if(impact!==undefined)input.blocks_completion=impact;
      var res=_s10CreateIssue(input,s);
      if(Number(s.get('Jobs',r.job_id).version)!==jobVersionBefore)_r1sErr('R1A_JOB_MUTATION');
      if(s.list('Jobs').length!==jobsBefore)_r1sErr('R1A_INTAKE_CARDINALITY');
      if(res.created&&s.list('Issues').length!==issueCountBefore+1)_r1sErr('R1A_INTAKE_CARDINALITY');
      if(!res.created&&s.list('Issues').length!==issueCountBefore)_r1sErr('R1A_INTAKE_CARDINALITY');
      var issue=s.get('Issues',issueId);
      if(!issue||issue.job_id!==r.job_id)_r1sErr('R1A_ISSUE_JOB_MISMATCH');
      var out={status:journal.replay?'Replayed':(res.created?'Created':'Replayed'),issue_id:issueId,issue:issue,task:res.task||null,external_calls:0};
      if(!journal.replay)_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Issues',issueId,'Create',null,issue,a.id,r.command_id,p.title,'R1 AppSheet/S10',now);
      s.update('CommitJournal',journal.id,{state:'Committed',committed_at:now,entity_id:issueId});
      return out;
    }catch(e){if(s.get('CommitJournal',journal.id))s.update('CommitJournal',journal.id,{state:'RecoveryRequired'});throw e;}
  });
}

function _r1sPlannerUpdate(ctx){var r=ctx.request,p=_r1sPayload(r,['planned_start','planned_end','reason'],['planned_start','planned_end']);return _s11UpdatePlannedDates({command_id:r.command_id,job_id:r.job_id,work_package_id:r.work_package_id,planned_start:p.planned_start,planned_end:p.planned_end,expected_version:r.expected_version,actor:ctx.actor.id,reason:p.reason||null},ctx.store);}
function _r1sMoveJob(ctx){var r=ctx.request,p=_r1sPayload(r,['activities','planned_start','planned_end','scaffold_erect','scaffold_strip','reason'],['activities','reason']);if(!Array.isArray(p.activities)||!p.activities.length)_r1sErr('R1A_REQUIRED_ACTIVITIES');if(typeof _s11MoveJobR1!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');return _s11MoveJobR1({command_id:r.command_id,job_id:r.job_id,expected_version:r.expected_version,actor:ctx.actor.id,activities:p.activities,planned_start:p.planned_start||null,planned_end:p.planned_end||null,scaffold_erect:p.scaffold_erect||null,scaffold_strip:p.scaffold_strip||null,reason:p.reason},ctx.store);}
function _r1sChangeInstaller(ctx){var r=ctx.request,p=_r1sPayload(r,['mode','person_id','reason','role','old_allocation_id'],['mode','person_id','reason']);var oldId=p.old_allocation_id||r.old_allocation_id;if(!_r1sText(oldId))_r1sErr('R1A_REQUIRED_OLD_ALLOCATION_ID');if(typeof _s11ChangeInstallerR1!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');return _s11ChangeInstallerR1({command_id:r.command_id,job_id:r.job_id,work_package_id:r.work_package_id,old_allocation_id:oldId,person_id:p.person_id,mode:p.mode,role:p.role||null,expected_version:r.expected_version,actor:ctx.actor.id,reason:p.reason},ctx.store);}
function _r1sCancel(ctx){var r=ctx.request,p=_r1sPayload(r,['reason','effective_date','work_performed','material_state','scaffold_state','finance_review','legacy_state'],['reason','effective_date','work_performed','material_state','scaffold_state','finance_review','legacy_state']);return _s15Execute('Cancel',Object.assign({command_id:r.command_id,job_id:r.job_id,expected_version:r.expected_version,actor:ctx.actor.id},p),ctx.store);}
function _r1sReinstate(ctx){var r=ctx.request,p=_r1sPayload(r,['reason','new_date','risk_review','commitment_review','finance_review','evidence_reference'],['reason','new_date','commitment_review','finance_review','evidence_reference']);return _s15Execute('Reinstate',Object.assign({command_id:r.command_id,job_id:r.job_id,expected_version:r.expected_version,actor:ctx.actor.id},p),ctx.store);}

function _r1sDepositConfirm(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['reference'],['reference']);
  return s.withLock(function(){var job=s.get('Jobs',r.job_id);if(!job)_r1sErr('R1A_STALE_VERSION');if(job.deposit_bank_confirmed_at)return{status:'AlreadyConfirmed',deposit:{ok:true,confirmed:false,reason:'Already confirmed'},job:job,readiness:null,external_calls:0};if(Number(job.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');if(typeof confirmDeposit!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');var before=job,res=confirmDeposit(s,r.job_id,a.id,p.reference),now=new Date().toISOString(),readiness=res&&res.confirmed?_r1sReevaluatePrebooking(s,r.job_id,a.id,r.command_id,now):null,after=s.get('Jobs',r.job_id);_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Jobs',r.job_id,'DepositConfirm',before,after,a.id,r.command_id,p.reference,'R1 AppSheet/S13',now);return{status:res&&res.confirmed?'Confirmed':(res&&res.ok?'AlreadyConfirmed':'Failed'),deposit:res,job:after,readiness:readiness&&readiness.readiness||null,external_calls:0};});}

function _r1sOperationalComplete(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor;_r1sPayload(r,[],[]);
  return s.withLock(function(){var job=s.get('Jobs',r.job_id);if(!job||Number(job.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');if(typeof _s10ApproveOperationalCompletion!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');var before=job,res=_s10ApproveOperationalCompletion(r.job_id,a.id,s),now=new Date().toISOString(),after=s.get('Jobs',r.job_id);_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Jobs',r.job_id,'OperationalComplete',before,after,a.id,r.command_id,res&&res.status,'R1 AppSheet/S10',now);return{status:res.status,created:!!res.created,gate:res.gate,ghl_task:res.ghl_task||null,external_calls:0};});}

function _r1sBookingGates(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor;_r1sPayload(r,[],[]);
  return s.withLock(function(){var job=s.get('Jobs',r.job_id);if(!job||Number(job.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');if(typeof processBookingGates!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');var before=job,res=processBookingGates(r.job_id,s,{actor:a.id,command_id:r.command_id}),now=new Date().toISOString(),after=s.get('Jobs',r.job_id);_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Jobs',r.job_id,'BookingGates',before,after,a.id,r.command_id,res&&res.gates&&res.gates.summary,'R1 AppSheet/S06',now);return{status:after&&after.workflow_stage==='ReadyToBook'?'ReadyToBook':(after&&after.workflow_stage==='Booked'?'Booked':(res&&res.gates&&res.gates.blocked?'Blocked':'NeedsReview')),readiness:res.readiness||null,gates:res.gates||res,tasks:res.tasks||null,success:!!(res&&res.success),external_calls:0};});}

/* AppSheet helper-table contracts. These tables are request envelopes only.
 * The processor never treats them as authoritative Jobs/Customers storage. */
var R1A_SOLD_FORM_ID='R1A-SOLD-DEV';
var R1A_BOOKING_FORM_ID='R1A-BOOKING-DEV';
var R1A_DEV_SHEET='1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var R1A_SOLD_FIELDS=[
  {key:'customer_first_name',qid:'sold_first_name',type:'text',required:true},
  {key:'customer_last_name',qid:'sold_last_name',type:'text',required:true},
  {key:'street_address',qid:'sold_address1',type:'text',required:true},
  {key:'city',qid:'sold_town',type:'text',required:true},
  {key:'postcode',qid:'sold_postcode',type:'text',required:true},
  {key:'phone',qid:'sold_phone',type:'text'},
  {key:'email',qid:'sold_email',type:'text'},
  {key:'salesperson_id',qid:'sold_salesperson_id',type:'text'},
  {key:'lead_source',qid:'sold_lead_source',type:'text'},
  {key:'quote_reference',qid:'sold_quote_ref',type:'text'},
  {key:'presale_file_id',qid:'sold_presale_file_id',type:'text'},
  {key:'finance_route',qid:'sold_finance_route',type:'text',required:true},
  {key:'gross_amount',qid:'sold_gross_pence',type:'number'},
  {key:'roof_required',qid:'sold_roof',type:'bool'},
  {key:'electrical_required',qid:'sold_electrical',type:'bool'},
  {key:'scaffold_required',qid:'sold_scaffold',type:'bool'},
  {key:'roof_notes',qid:'sold_roof_notes',type:'text'},
  {key:'electrical_notes',qid:'sold_electrical_notes',type:'text'},
  {key:'submitted_by',qid:'sold_submitted_by',type:'text'}
];
var R1A_BOOKING_FIELDS=[
  {key:'customer_first_name',qid:'booking_first_name',type:'text'},
  {key:'customer_last_name',qid:'booking_last_name',type:'text'},
  {key:'street_address',qid:'booking_address1',type:'text'},
  {key:'city',qid:'booking_town',type:'text'},
  {key:'postcode',qid:'booking_postcode',type:'text'},
  {key:'phone',qid:'booking_phone',type:'text'},
  {key:'email',qid:'booking_email',type:'text'},
  {key:'solar_kw',qid:'booking_solar_kw',type:'text'},
  {key:'cost',qid:'booking_cost',type:'number'},
  {key:'finance_route',qid:'booking_finance',type:'text'},
  {key:'merchant_name',qid:'booking_merchant',type:'text'},
  {key:'invoice_date',qid:'booking_invoice_date',type:'date'},
  {key:'annual_generation',qid:'booking_annual_gen',type:'text'},
  {key:'date_roofer',qid:'booking_date_roofer',type:'date'},
  {key:'date_sparky',qid:'booking_date_sparky',type:'date'},
  {key:'date_scaffold',qid:'booking_date_scaffold',type:'date'},
  {key:'roofer',qid:'booking_roofer',type:'person'},
  {key:'sparky',qid:'booking_sparky',type:'person'},
  {key:'second_sparky',qid:'booking_second_sparky',type:'person'},
  {key:'scaffold_company',qid:'booking_scaffold_company',type:'company'},
  {key:'scaffold_pdf',qid:'booking_scaffold_pdf',type:'text'},
  {key:'scaffold_notes',qid:'booking_scaffold_notes',type:'text'},
  {key:'roofing_notes',qid:'booking_roofing_notes',type:'text'},
  {key:'electrical_notes',qid:'booking_electrical_notes',type:'text'},
  {key:'ordering_notes',qid:'booking_ordering_notes',type:'text'},
  {key:'roof_hooks_type',qid:'booking_roof_hooks_type',type:'text'},
  {key:'mat_slate_portrait',qid:'booking_mat_slate_portrait',type:'int'},
  {key:'mat_slate_landscape',qid:'booking_mat_slate_landscape',type:'int'},
  {key:'mat_r420181_total',qid:'booking_mat_r420181_total',type:'int'},
  {key:'mat_concrete_portrait',qid:'booking_mat_concrete_portrait',type:'int'},
  {key:'mat_concrete_landscape',qid:'booking_mat_concrete_landscape',type:'int'},
  {key:'mat_r420150_total',qid:'booking_mat_r420150_total',type:'int'},
  {key:'mat_l_bracket',qid:'booking_mat_l_bracket',type:'int'},
  {key:'mat_hook_rest',qid:'booking_mat_hook_rest',type:'int'},
  {key:'mat_end_clamps',qid:'booking_mat_end_clamps',type:'int'},
  {key:'mat_end_caps',qid:'booking_mat_end_caps',type:'int'},
  {key:'mat_mid_clamps',qid:'booking_mat_mid_clamps',type:'int'},
  {key:'mat_rail',qid:'booking_mat_rail',type:'int'},
  {key:'mat_splice',qid:'booking_mat_splice',type:'int'},
  {key:'mat_k2_flat_multi',qid:'booking_mat_k2_flat_multi',type:'int'},
  {key:'mat_k2_curved_multi',qid:'booking_mat_k2_curved_multi',type:'int'},
  {key:'mat_k2_flat_mini',qid:'booking_mat_k2_flat_mini',type:'int'},
  {key:'mat_k2_curved_mini',qid:'booking_mat_k2_curved_mini',type:'int'},
  {key:'mat_genius',qid:'booking_mat_genius',type:'int'},
  {key:'mat_k2_1000074',qid:'booking_mat_k2_1000074',type:'int'},
  {key:'mat_k2_mid',qid:'booking_mat_k2_mid',type:'int'},
  {key:'mat_k2_end',qid:'booking_mat_k2_end',type:'int'},
  {key:'mat_k2_end_caps',qid:'booking_mat_k2_end_caps',type:'int'},
  {key:'mat_k2_rail',qid:'booking_mat_k2_rail',type:'int'},
  {key:'mat_k2_splice',qid:'booking_mat_k2_splice',type:'int'},
  {key:'mat_panel_515',qid:'booking_mat_panel_515',type:'int'},
  {key:'mat_panel_460',qid:'booking_mat_panel_460',type:'int'},
  {key:'mat_panel_m',qid:'booking_mat_panel_m',type:'int'},
  {key:'mat_bird_netting',qid:'booking_mat_bird_netting',type:'int'},
  {key:'mat_optimisers',qid:'booking_mat_optimisers',type:'int'},
  {key:'mat_fox_jb',qid:'booking_mat_fox_jb',type:'int'},
  {key:'mat_dongle',qid:'booking_mat_dongle',type:'int'},
  {key:'mat_gateway',qid:'booking_mat_gateway',type:'int'},
  {key:'mat_ev',qid:'booking_mat_ev',type:'int'},
  {key:'inverter',qid:'booking_inverter',type:'text'},
  {key:'battery',qid:'booking_battery',type:'text'},
  {key:'battery_qty',qid:'booking_battery_qty',type:'int'},
  {key:'fox_jb_calc',qid:'booking_fox_jb_calc',type:'text'},
  {key:'extras',qid:'booking_extras',type:'text'},
  {key:'sig_extras',qid:'booking_sig_extras',type:'text'},
  {key:'tesla_extras',qid:'booking_tesla_extras',type:'text'},
  {key:'submitted_by',qid:'booking_submitted_by',type:'text'}
];
var R1A_SOLD_REQUEST_COLUMNS=['id','command_id','submitted_by'].concat(R1A_SOLD_FIELDS.map(function(f){return f.key;})).concat(['result_status','result_job_id','result_job_id_human','result_version','result_message']);
var R1A_BOOKING_REQUEST_COLUMNS=['id','command_id','submitted_by','job_id','job_id_human','expected_version'].concat(R1A_BOOKING_FIELDS.map(function(f){return f.key;})).concat(['result_status','result_job_id','result_job_id_human','result_version','result_workflow_stage','result_message']);

function _r1sBlank(v){return v===undefined||v===null||v==='';}
function _r1sCommandId(id){if(!_r1sText(id)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id))_r1sErr('R1A_INVALID_COMMAND_ID');}
function _r1sActorMatch(a,v){var s=String(v).trim().toLowerCase();return s===a.id.toLowerCase()||s===a.email;}
function _r1sFinance(v){if(['Standard','Phoenix','OtherReview'].indexOf(v)<0)_r1sErr('R1A_INVALID_FINANCE_ROUTE');}
function _r1sVersion(v){var n=typeof v==='number'?v:(typeof v==='string'&&/^\d+$/.test(v.trim())?Number(v):NaN);if(!Number.isSafeInteger(n)||n<1)_r1sErr('R1A_STALE_VERSION');return n;}
function _r1sDate(v){if(_r1sBlank(v))return undefined;var s=String(v).trim(),m=s.match(/^(\d{4}-\d{2}-\d{2})/);if(!m)_r1sErr('R1A_INVALID_DATE');return m[1];}
function _r1sInt(v){if(_r1sBlank(v))return undefined;var n=typeof v==='number'?v:Number(String(v).trim());if(!Number.isSafeInteger(n)||n<0)_r1sErr('R1A_INVALID_INTEGER');return String(n);}
function _r1sBoolText(v){if(v===true||v===false)return v?'Yes':'No';var s=String(v).trim().toLowerCase();if(['yes','true','1'].indexOf(s)>=0)return 'Yes';if(['no','false','0'].indexOf(s)>=0)return 'No';_r1sErr('R1A_INVALID_BOOLEAN');}
function _r1sPoundsToPence(v){if(_r1sBlank(v))return undefined;var s=String(v).trim().replace(/[£,\s]/g,'');if(!/^\d+(\.\d{1,2})?$/.test(s))_r1sErr('R1A_INVALID_GROSS_AMOUNT');var pence=Math.round(Number(s)*100);if(!Number.isSafeInteger(pence))_r1sErr('R1A_INVALID_GROSS_AMOUNT');return String(pence);}
function _r1sCanonPayload(fields,payload){var out={};fields.forEach(function(f){if(Object.prototype.hasOwnProperty.call(payload,f.key)&&!_r1sBlank(payload[f.key]))out[f.key]=payload[f.key];});return JSON.stringify(out);}
function _r1sPersonName(store,v){if(_r1sBlank(v))return undefined;var s=String(v).trim();var byId=store.list('People').filter(function(p){return p.id===s&&p.active===true;});if(byId.length===1&&_r1sText(byId[0].display_name))return byId[0].display_name;return s;}
function _r1sCompanyName(store,v){if(_r1sBlank(v))return undefined;var s=String(v).trim();var byId=store.list('Companies').filter(function(c){return c.id===s;});if(byId.length===1&&_r1sText(byId[0].name))return byId[0].name;return s;}
function _r1sActivePerson(store,id){var p=store.get('People',id);if(!p||p.active!==true)_r1sErr('R1A_SALESPERSON_NOT_FOUND');}
function _r1sJournalId(id){return 'CJ-R1A-'+id;}
function _r1sDevConfig(store){if(!store||store.getSheetId()!==R1A_DEV_SHEET||(typeof store.getEnvironment==='function'&&store.getEnvironment()!=='DEV'))_r1sErr('R1A_DEV_ONLY');return{environment:'DEV',sheetId:R1A_DEV_SHEET};}
function _r1sMappingBuilder(){
  if(typeof S05Core!=='undefined'&&typeof S05Core.buildSyntheticMapping==='function')return S05Core.buildSyntheticMapping;
  if(typeof buildSyntheticMapping==='function')return buildSyntheticMapping;
  if(typeof require==='function'){try{return require('../s05/mapping.js').buildSyntheticMapping;}catch(e){}}
  _r1sErr('R1A_COMMAND_UNSUPPORTED');
}
function _r1sIntakeProcessor(store,actor){
  var options={config:_r1sDevConfig(store),store:store,pilotJob:true,actor:actor.id,createPrebookingTasks:function(job,s){
    var fn=typeof createPrebookingTasksForSold==='function'?createPrebookingTasksForSold:null;
    if(!fn&&typeof require==='function'){try{fn=require('../s06/gates.js').createPrebookingTasksForSold;}catch(e){fn=null;}}
    return fn?fn(job,s):null;
  }};
  if(typeof S05Core!=='undefined'&&typeof S05Core.createIntakeProcessor==='function')return S05Core.createIntakeProcessor(options);
  if(typeof createIntakeProcessor==='function')return createIntakeProcessor(options);
  if(typeof require==='function'){try{return require('../s05/intake.js').createIntakeProcessor(options);}catch(e){}}
  _r1sErr('R1A_COMMAND_UNSUPPORTED');
}
function _r1sEnsureMappings(store,formId,formType,idPrefix){
  var builder=_r1sMappingBuilder();
  var expected=builder(formId,formType,idPrefix);
  var existing=store.list('MappingRules').filter(function(r){return r.form_id===formId;});
  if(existing.length){
    var have={};
    existing.forEach(function(r){if(r.active===true)have[r.question_id]=true;});
    if(expected.some(function(r){return !have[r.question_id];}))_r1sErr('R1A_INTAKE_MAPPING_INCOMPLETE');
    return;
  }
  expected.forEach(function(r){
    r.owner='R1A-appsheet';r.mapping_version='R1A-1.0';r.created_by='R1A-appsheet';r.updated_by='R1A-appsheet';
    if(!store.get('MappingRules',r.id))store.insert('MappingRules',r);
  });
}
function _r1sFieldValue(store,field,value){
  if(_r1sBlank(value))return undefined;
  if(field.type==='bool')return _r1sBoolText(value);
  if(field.type==='date')return _r1sDate(value);
  if(field.type==='int')return _r1sInt(value);
  if(field.type==='person')return _r1sPersonName(store,value);
  if(field.type==='company')return _r1sCompanyName(store,value);
  if(field.key==='gross_amount')return _r1sPoundsToPence(value);
  if(field.key==='cost'){var s=String(value).trim().replace(/[£,\s]/g,'');if(!/^\d+(\.\d{1,2})?$/.test(s))_r1sErr('R1A_INVALID_GROSS_AMOUNT');if(s.indexOf('.')<0)s+='.00';return s;}
  return String(value).trim();
}
function _r1sRawPayload(store,fields,payload,extra){
  var raw=extra||{};
  fields.forEach(function(f){
    if(f.qid==='sold_submitted_by'||f.qid==='booking_submitted_by')return;
    var value=_r1sFieldValue(store,f,payload[f.key]);
    if(value!==undefined)raw[f.qid]=value;
  });
  return raw;
}
function _r1sAppSheetEscape(col){return 'SUBSTITUTE(SUBSTITUTE(['+col+'], CHAR(34), "\'"), CHAR(10), " ")';}
function _r1sAppSheetExpression(commandType,fields,top){
  var lines=['CONCATENATE(','  "{\\"command_id\\":\\"", [command_id],','  "\\",\\"command_type\\":\\"'+commandType+'\\""'];
  (top||[]).forEach(function(key){
    if(key==='expected_version')lines.push('  , ",\\"expected_version\\":", TEXT([expected_version], "0")');
    else lines.push('  , ",\\"'+key+'\\":\\"", ['+key+'], "\\""');
  });
  lines.push('  , ",\\"payload\\":{"');
  fields.forEach(function(f,i){
    var lead=i===0?'"\\"'+(f.key)+'\\":':'",\\"'+f.key+'\\":';
    if(f.type==='bool')lines.push('  , '+lead+'", IF(OR(ISBLANK(['+f.key+']), ['+f.key+']=FALSE), "false", "true")');
    else if(f.type==='number'||f.type==='int')lines.push('  , '+lead+'", IF(ISBLANK(['+f.key+']), "null", TEXT(['+f.key+']))');
    else if(f.type==='date')lines.push('  , '+lead+'\\"", IF(ISBLANK(['+f.key+']), "", TEXT(['+f.key+'], "YYYY-MM-DD")), "\\""');
    else lines.push('  , '+lead+'\\"", '+_r1sAppSheetEscape(f.key)+', "\\""');
  });
  lines.push('  , "}}"',' )');
  return lines.join('\n');
}
function _r1sSoldExpression(){return _r1sAppSheetExpression('SOLD_INTAKE',R1A_SOLD_FIELDS,[]);}
function _r1sBookingExpression(){return _r1sAppSheetExpression('BOOKING_INTAKE',R1A_BOOKING_FIELDS,['job_id','expected_version']);}
function _r1sBeginJournal(store,commandId,entityType,entityId,expected,fingerprint,now){
  var jid=_r1sJournalId(commandId),prior=store.get('CommitJournal',jid);
  if(prior){if(prior.changes_json!==fingerprint)_r1sErr('R1A_COMMAND_CONFLICT');if(prior.state!=='Committed')_r1sErr('R1A_RECOVERY_REQUIRED');return{replay:true,id:jid};}
  store.insert('CommitJournal',{id:jid,commit_id:'R1A-'+commandId,state:'Prepared',command_id:commandId,entity_type:entityType,entity_id:entityId||null,expected_version:expected||null,changes_json:fingerprint,prepared_at:now,committed_at:null,created_at:now});
  return{replay:false,id:jid};
}
function _r1sSoldIntake(ctx){
  var r=ctx.request,s=ctx.store,a=ctx.actor;
  if(r.job_id||r.task_id||r.issue_id||r.work_package_id||r.old_allocation_id||r.expected_version!=null)_r1sErr('R1A_INVALID_FIELDS');
  _r1sCommandId(r.command_id);
  var allowed=R1A_SOLD_FIELDS.map(function(f){return f.key;});
  var p=_r1sPayload(r,allowed,['customer_first_name','customer_last_name','street_address','city','postcode','finance_route']);
  _r1sFinance(p.finance_route);
  if(!_r1sBlank(p.salesperson_id))_r1sActivePerson(s,p.salesperson_id);
  if(!_r1sBlank(p.submitted_by)&&!_r1sActorMatch(a,p.submitted_by))_r1sErr('R1A_ACTOR_MISMATCH');
  var fingerprint=JSON.stringify({command_type:'SOLD_INTAKE',payload:JSON.parse(_r1sCanonPayload(R1A_SOLD_FIELDS,p))});
  return s.withLock(function(){
    var now=new Date().toISOString();
    var journal=_r1sBeginJournal(s,r.command_id,'Intake','R1A-SOLD-'+r.command_id,null,fingerprint,now);
    var jobsBefore=s.list('Jobs').length,customersBefore=s.list('Customers').length;
    try{
      _r1sEnsureMappings(s,R1A_SOLD_FORM_ID,'Sold','MAP-R1A-SOLD-');
      var raw=_r1sRawPayload(s,R1A_SOLD_FIELDS,p,{});
      var res=_r1sIntakeProcessor(s,a).processSold({intake_id:'R1A-SOLD-'+r.command_id,form_id:R1A_SOLD_FORM_ID,form_type:'Sold',submission_id:r.command_id,raw_payload:raw});
      var jobsAfter=s.list('Jobs').length,customersAfter=s.list('Customers').length;
      if(res.status==='Processed'&&!res.duplicate){
        if(jobsAfter!==jobsBefore+1||customersAfter!==customersBefore+1)_r1sErr('R1A_INTAKE_CARDINALITY');
      }else if(jobsAfter!==jobsBefore||customersAfter!==customersBefore){_r1sErr('R1A_INTAKE_CARDINALITY');}
      var job=res.job_id?s.get('Jobs',res.job_id):null;
      if(job){
        if(job.pilot_job!==true||job.release_scope!=='R1')_r1sErr('R1A_OUTSIDE_PILOT');
        if(!/^SS-[A-Z]{4}-\d{4}$/.test(job.job_id))_r1sErr('R1A_JOB_ID_INVALID');
        /* S13 owns calculations and its idempotent reconciliation. It creates only
         * internal records/intents; no Xero transport is invoked from R1 intake. */
        if(Number(job.original_gross_pence)>0){
          if(typeof processJobPayments!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');
          processJobPayments(job.id,s,{command_id:r.command_id});
        }
      }
      var out={status:journal.replay?'Replayed':res.status,duplicate:!!res.duplicate,intake_id:res.intake_id||('R1A-SOLD-'+r.command_id),job_id:res.job_id||null,job_id_human:job?job.job_id:null,customer_id:res.customer_id||(job?job.customer_id:null),version:job?Number(job.version):null,workflow_stage:job?job.workflow_stage:null,prebooking_tasks:res.prebooking_tasks||null,error:res.error||null,message:res.message||null,external_calls:0};
      if(!journal.replay&&res.job_id)_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Jobs',res.job_id,'SoldIntake',null,job,a.id,r.command_id,res.message,'R1 AppSheet/S05',now);
      s.update('CommitJournal',journal.id,{state:'Committed',committed_at:now,entity_id:res.job_id||('R1A-SOLD-'+r.command_id)});
      return out;
    }catch(e){if(s.get('CommitJournal',journal.id))s.update('CommitJournal',journal.id,{state:'RecoveryRequired'});throw e;}
  });
}
function _r1sBookingIntake(ctx){
  var r=ctx.request,s=ctx.store,a=ctx.actor;
  if(r.task_id||r.issue_id||r.work_package_id||r.old_allocation_id)_r1sErr('R1A_INVALID_FIELDS');
  if(!_r1sText(r.job_id))_r1sErr('R1A_JOB_NOT_FOUND');
  _r1sCommandId(r.command_id);
  var allowed=R1A_BOOKING_FIELDS.map(function(f){return f.key;});
  var p=_r1sPayload(r,allowed,[]);
  if(!_r1sBlank(p.submitted_by)&&!_r1sActorMatch(a,p.submitted_by))_r1sErr('R1A_ACTOR_MISMATCH');
  if(!_r1sBlank(p.finance_route))_r1sFinance(p.finance_route);
  var expected=_r1sVersion(r.expected_version);
  var fingerprint=JSON.stringify({command_type:'BOOKING_INTAKE',job_id:r.job_id,payload:JSON.parse(_r1sCanonPayload(R1A_BOOKING_FIELDS,p))});
  return s.withLock(function(){
    var now=new Date().toISOString();
    var prior=s.get('CommitJournal',_r1sJournalId(r.command_id));
    var job=s.get('Jobs',r.job_id);
    if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
    if(job.pilot_job!==true||job.release_scope!=='R1')_r1sErr('R1A_OUTSIDE_PILOT');
    if(!_r1sText(job.job_id)||!/^SS-[A-Z]{4}-\d{4}$/.test(job.job_id))_r1sErr('R1A_JOB_ID_INVALID');
    if(!prior){
      if(Number(job.version)!==expected)_r1sErr('R1A_STALE_VERSION');
      if(job.archived_at||['CancellationInProgress','Cancelled'].indexOf(job.workflow_stage)>=0)_r1sErr('R1A_JOB_NOT_ACTIONABLE');
      if(['Prebooking','ReadyToBook','BookingInProgress'].indexOf(job.workflow_stage)<0)_r1sErr('R1A_STAGE_NOT_ELIGIBLE');
    }
    var journal=_r1sBeginJournal(s,r.command_id,'Jobs',r.job_id,expected,fingerprint,now);
    var beforeStage=job.workflow_stage,jobsBefore=s.list('Jobs').length,customerBefore=s.get('Customers',job.customer_id);
    try{
      _r1sEnsureMappings(s,R1A_BOOKING_FORM_ID,'Booking','MAP-R1A-BOOK-');
      var raw=_r1sRawPayload(s,R1A_BOOKING_FIELDS,p,{booking_job_id:job.job_id});
      var res=_r1sIntakeProcessor(s,a).processBooking({intake_id:'R1A-BOOK-'+r.command_id,form_id:R1A_BOOKING_FORM_ID,form_type:'Booking',submission_id:r.command_id,raw_payload:raw});
      if(s.list('Jobs').length!==jobsBefore)_r1sErr('R1A_INTAKE_CARDINALITY');
      if(res.job_id&&res.job_id!==r.job_id)_r1sErr('R1A_JOB_LINK_MISMATCH');
      var after=s.get('Jobs',r.job_id),customerAfter=s.get('Customers',job.customer_id);
      if(customerBefore&&customerAfter){
        ['first_name','last_name','address_line1','town','postcode','email','phone'].forEach(function(k){if(customerBefore[k]!==customerAfter[k])_r1sErr('R1A_CUSTOMER_OVERWRITE');});
      }
      if(beforeStage==='ReadyToBook'&&after&&after.workflow_stage!=='BookingInProgress'&&res.status!=='Review'&&!res.duplicate)_r1sErr('R1A_STAGE_RULE_BROKEN');
      if(beforeStage==='Prebooking'&&after&&after.workflow_stage!=='Prebooking')_r1sErr('R1A_STAGE_RULE_BROKEN');
      var out={status:journal.replay?'Replayed':res.status,duplicate:!!res.duplicate,intake_id:res.intake_id||('R1A-BOOK-'+r.command_id),job_id:r.job_id,job_id_human:after?after.job_id:job.job_id,version:after?Number(after.version):null,workflow_stage:after?after.workflow_stage:null,match_status:res.match_status||(after?after.sold_booking_match_status:null),customer_changes:(res.applied&&res.applied.customer_changes)||[],error:res.error||null,message:res.message||null,external_calls:0};
      if(!journal.replay)_r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Jobs',r.job_id,'BookingIntake',job,after,a.id,r.command_id,res.message,'R1 AppSheet/S05',now);
      s.update('CommitJournal',journal.id,{state:'Committed',committed_at:now,entity_id:r.job_id});
      return out;
    }catch(e){if(s.get('CommitJournal',journal.id))s.update('CommitJournal',journal.id,{state:'RecoveryRequired'});throw e;}
  });
}

var R1A_ISSUE_CREATE_FIELDS=[
  {key:'issue_type',type:'enum'},
  {key:'title',type:'text',required:true},
  {key:'description',type:'text',required:true},
  {key:'severity',type:'enum'},
  {key:'owner_id',type:'person'},
  {key:'customer_impact',type:'bool'},
  {key:'requested_by',type:'text'},
  {key:'requested_at',type:'timestamp'}
];
var R1A_ISSUE_CREATE_REQUEST_COLUMNS=['id','command_id','job_id','expected_version'].concat(R1A_ISSUE_CREATE_FIELDS.map(function(f){return f.key;})).concat(['result_status','result_issue_id','result_message']);

function _r1sServices(){return{TASK_COMPLETE:_r1sTaskComplete,TASK_EVIDENCE_ATTACH:_r1sTaskEvidenceAttach,CALL_RECORD:_r1sCallRecord,ISSUE_UPDATE:_r1sIssueUpdate,ISSUE_CREATE:_r1sIssueCreate,PLANNER_UPDATE:_r1sPlannerUpdate,MOVE_JOB:_r1sMoveJob,CHANGE_INSTALLER:_r1sChangeInstaller,CANCEL_JOB:_r1sCancel,REINSTATE_JOB:_r1sReinstate,DEPOSIT_CONFIRM:_r1sDepositConfirm,OPERATIONAL_COMPLETE:_r1sOperationalComplete,BOOKING_GATES:_r1sBookingGates,SOLD_INTAKE:_r1sSoldIntake,BOOKING_INTAKE:_r1sBookingIntake};}

if(typeof module!=='undefined')module.exports={_r1sServices:_r1sServices,R1A_SOLD_FIELDS:R1A_SOLD_FIELDS,R1A_BOOKING_FIELDS:R1A_BOOKING_FIELDS,R1A_ISSUE_CREATE_FIELDS:R1A_ISSUE_CREATE_FIELDS,R1A_SOLD_REQUEST_COLUMNS:R1A_SOLD_REQUEST_COLUMNS,R1A_BOOKING_REQUEST_COLUMNS:R1A_BOOKING_REQUEST_COLUMNS,R1A_ISSUE_CREATE_REQUEST_COLUMNS:R1A_ISSUE_CREATE_REQUEST_COLUMNS,_r1sSoldExpression:_r1sSoldExpression,_r1sBookingExpression:_r1sBookingExpression,_r1sApplyPre02Contract:_r1sApplyPre02Contract,_r1sApplyPre04Verification:_r1sApplyPre04Verification,_r1sReevaluatePrebooking:_r1sReevaluatePrebooking,_r1sResolveContractEvidenceId:_r1sResolveContractEvidenceId,_r1sEnsureOfficeTaskEvidence:_r1sEnsureOfficeTaskEvidence,_r1sHashDrive:_r1sHashDrive};
