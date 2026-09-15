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

function _r1sApplyPre02Contract(store,job,actorId,evidenceId,now,commandId,contractId){
  var resolved=_r1sRequireJobContractEvidence(store,job.id,evidenceId);
  var ref=_r1sText(contractId)?String(contractId).trim():(_r1sText(job.contract_id)?String(job.contract_id).trim():'');
  if(!ref)_r1sErr('R1A_REQUIRED_CONTRACT_ID');
  if(job.contract_status==='Signed'&&job.contract_evidence_id===resolved&&job.contract_signed_at&&String(job.contract_id||'')===ref){
    return store.get('Jobs',job.id);
  }
  var patch={
    contract_status:'Signed',
    contract_id:ref,
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

/* Record contract sent / awaiting signature without Completing PRE02 or claiming Signed. */
function _r1sApplyPre02ContractSent(store,job,actorId,contractId,now,commandId){
  if(!_r1sText(contractId))_r1sErr('R1A_REQUIRED_CONTRACT_ID');
  if(job.contract_status==='Signed'&&_r1sText(job.contract_evidence_id))_r1sErr('R1A_CONTRACT_ALREADY_SIGNED');
  var ref=String(contractId).trim();
  if(job.contract_status==='Sent'&&String(job.contract_id||'')===ref){
    return store.get('Jobs',job.id);
  }
  store.update('Jobs',job.id,{
    contract_status:'Sent',
    contract_id:ref,
    updated_at:now,
    updated_by:actorId,
    version:Number(job.version||0)+1,
    commit_id:'R1A-'+commandId
  });
  return store.get('Jobs',job.id);
}

/* Evidence id must resolve to a real Evidence row for this job — never invent opaque ids. */
function _r1sRequireJobContractEvidence(store,jobId,evidenceId){
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
  _r1sErr('R1A_REQUIRED_CONTRACT_EVIDENCE');
}

function _r1sContractSignedFlag(v){
  if(v===true)return true;
  if(v===false||v===null||v===undefined||v==='')return false;
  return ['yes','true','1','signed','y'].indexOf(String(v).trim().toLowerCase())>=0;
}
function _r1sPre02AwaitingSignature(p){
  if(_r1sContractSignedFlag(p.contract_signed))return false;
  if(p.contract_signed===false)return true;
  if(_r1sText(p.contract_signed)){
    var cs=String(p.contract_signed).trim().toLowerCase();
    if(['no','false','0','n','sent','awaiting','awaiting_signature','awaiting-signature'].indexOf(cs)>=0)return true;
  }
  if(!_r1sText(p.outcome))return false;
  return ['awaiting_signature','awaiting-signature','awaitingsignature','sent','awaiting'].indexOf(String(p.outcome).trim().toLowerCase())>=0;
}

function _r1sCanonicalGrossPence(job){
  if(!(typeof job.original_gross_pence==='number'&&job.original_gross_pence>0))_r1sErr('R1A_SOLD_VALUE_REQUIRED');
  if(typeof job.current_contract_gross_pence==='number'&&job.current_contract_gross_pence>0)return job.current_contract_gross_pence;
  return job.original_gross_pence;
}
function _r1sYesFlag(v){
  if(v===true)return true;
  if(v===false||v===null||v===undefined||v==='')return false;
  return ['yes','true','1','y'].indexOf(String(v).trim().toLowerCase())>=0;
}
function _r1sExplicitNoFlag(v){
  if(v===false)return true;
  if(v===null||v===undefined||v==='')return false;
  return ['no','false','0','n'].indexOf(String(v).trim().toLowerCase())>=0;
}
/* Canonical expected deposit = the job's single deposit InvoiceStages row. Never client-supplied. */
function _r1sDepositStage(store,jobId){
  var stage=_r1sDepositInvoiceStage(store,jobId);
  if(!(typeof stage.gross_pence==='number'&&Number.isSafeInteger(stage.gross_pence)&&stage.gross_pence>0))_r1sErr('R1A_DEPOSIT_AMOUNT_REQUIRED');
  return stage;
}
/* GBP text/number → integer pence (max 2dp). allowZero only for explicit "not received" follow-ups. */
function _r1sDepositAmountPence(v,allowZero){
  if(_r1sBlank(v))_r1sErr('R1A_REQUIRED_DEPOSIT_AMOUNT');
  var pence;try{pence=Number(_r1sPoundsToPence(v));}catch(e){_r1sErr('R1A_INVALID_DEPOSIT_AMOUNT');}
  if(!Number.isSafeInteger(pence)||pence<0||(!allowZero&&pence===0))_r1sErr('R1A_INVALID_DEPOSIT_AMOUNT');
  return pence;
}
function _r1sSameInstant(a,b){if(!a||!b)return false;var x=new Date(a).getTime(),y=new Date(b).getTime();return Number.isFinite(x)&&Number.isFinite(y)&&x===y;}
/* Bank receipt date: YYYY-MM-DD (AppSheet Date) → noon UTC instant. A received date cannot be in the future. */
function _r1sDepositReceivedAt(v){
  var d;
  if(Object.prototype.toString.call(v)==='[object Date]'&&!isNaN(v.getTime()))d=v;
  else{
    var text=String(v||'').trim(),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if(!m)_r1sErr('R1A_INVALID_DEPOSIT_RECEIVED_DATE');
    d=new Date(text+'T12:00:00.000Z');
    if(isNaN(d.getTime())||d.toISOString().slice(0,10)!==text)_r1sErr('R1A_INVALID_DEPOSIT_RECEIVED_DATE');
  }
  if(d.getTime()>Date.now()+86400000)_r1sErr('R1A_INVALID_DEPOSIT_RECEIVED_DATE');
  return d.toISOString();
}
function _r1sInsertBankCheck(store,jobId,actorId,amountPence,checkedAt,outcome,reference,now,commandId){
  var id='MBC-R1A-'+commandId,existing=store.get('ManualBankChecks',id);
  var row={id:id,job_id:jobId,stage:'deposit',checked_at:checkedAt,checked_by:actorId,amount_pence:Number(amountPence),outcome:outcome,evidence_reference:_r1sText(reference)?String(reference).trim():null,created_at:now,commit_id:'R1A-'+commandId};
  if(existing){if(JSON.stringify(existing)!==JSON.stringify(row))_r1sErr('R1A_COMMAND_CONFLICT');return existing;}
  store.insert('ManualBankChecks',row);return row;
}
function _r1sApplyPre03Confirmation(store,job,stage,actorId,amountPence,receivedAt,reference,now,commandId){
  if(Number(amountPence)!==Number(stage.gross_pence))_r1sErr('R1A_DEPOSIT_AMOUNT_MISMATCH');
  var ref=String(reference).trim();
  if(!(stage.status==='Confirmed'&&stage.reference===ref))store.update('InvoiceStages',stage.id,{status:'Confirmed',reference:ref,updated_at:now,updated_by:actorId,version:Number(stage.version||0)+1,commit_id:'R1A-'+commandId});
  if(!(_r1sSameInstant(job.deposit_bank_confirmed_at,receivedAt)&&job.deposit_bank_confirmed_by===actorId&&job.deposit_bank_reference===ref))store.update('Jobs',job.id,{deposit_bank_confirmed_at:receivedAt,deposit_bank_confirmed_by:actorId,deposit_bank_reference:ref,updated_at:now,updated_by:actorId,version:Number(job.version||0)+1,commit_id:'R1A-'+commandId});
  return store.get('Jobs',job.id);
}
/* True only when S06 bankConfirmationEvidence reconciles Jobs + ManualBankChecks + deposit InvoiceStage. */
function _r1sBankConfirmationValid(store,jobId){
  var probe=typeof bankConfirmationEvidence==='function'?bankConfirmationEvidence:null;
  if(!probe&&typeof require==='function'){try{probe=require('../s06/gates.js').bankConfirmationEvidence;}catch(e){probe=null;}}
  if(typeof probe!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');
  var r=probe(store,jobId);return!!(r&&r.pass);
}
/* Single write path for a successful manual deposit verification (PRE03 TASK_COMPLETE and legacy DEPOSIT_CONFIRM).
 * Reconciles the submitted amount against the canonical deposit InvoiceStage, records exactly one Confirmed
 * ManualBankChecks row for those facts (re-used if an identical confirmation already exists), stamps the Jobs
 * summary fields + InvoiceStage Confirmed/reference, and never touches contract/invoice amounts. */
function _r1sRecordDepositConfirmation(store,jobId,actorId,amountPence,receivedAt,reference,now,commandId){
  var job=store.get('Jobs',jobId);if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
  if(!_r1sText(reference))_r1sErr('R1A_REQUIRED_DEPOSIT_BANK_REFERENCE');
  var stage=_r1sDepositStage(store,jobId),ref=String(reference).trim();
  if(Number(amountPence)!==Number(stage.gross_pence))_r1sErr('R1A_DEPOSIT_AMOUNT_MISMATCH');
  var grossBefore=job.original_gross_pence,currentBefore=job.current_contract_gross_pence,stageGrossBefore=stage.gross_pence;
  var existing=(store.list('ManualBankChecks')||[]).filter(function(c){return c.job_id===jobId&&String(c.stage||'').toLowerCase()==='deposit'&&c.outcome==='Confirmed'&&c.checked_by===actorId&&Number(c.amount_pence)===Number(amountPence)&&c.evidence_reference===ref&&_r1sSameInstant(c.checked_at,receivedAt);});
  var check=existing.length?existing[0]:_r1sInsertBankCheck(store,jobId,actorId,amountPence,receivedAt,'Confirmed',ref,now,commandId);
  var after=_r1sApplyPre03Confirmation(store,job,stage,actorId,amountPence,receivedAt,ref,now,commandId);
  var stageAfter=store.get('InvoiceStages',stage.id);
  if(after.original_gross_pence!==grossBefore||after.current_contract_gross_pence!==currentBefore||stageAfter.gross_pence!==stageGrossBefore)_r1sErr('R1A_FINANCIAL_MUTATION');
  return{job:after,stage:stageAfter,bank_check:check};
}
function _r1sApplyPre04Verification(store,job,actorId,now,commandId,verifiedGrossPence){
  var expected=_r1sCanonicalGrossPence(job);
  if(Number(verifiedGrossPence)!==Number(expected))_r1sErr('R1A_VERIFIED_AMOUNT_MISMATCH');
  if(job.customer_details_verified_at&&job.customer_details_verified_by&&job.sold_booking_match_status==='Match'&&_r1sText(job.valuation_basis)){
    return store.get('Jobs',job.id);
  }
  store.update('Jobs',job.id,{
    customer_details_verified_at:job.customer_details_verified_at||now,
    customer_details_verified_by:job.customer_details_verified_by||actorId,
    sold_booking_match_status:'Match',
    valuation_basis:_r1sText(job.valuation_basis)?String(job.valuation_basis).trim():'Standard',
    updated_at:now,
    updated_by:actorId,
    version:Number(job.version||0)+1,
    commit_id:'R1A-'+commandId
  });
  return store.get('Jobs',job.id);
}
function _r1sApplyPre04MismatchReview(store,job,actorId,now,commandId){
  if(job.sold_booking_match_status==='Review'){
    return store.get('Jobs',job.id);
  }
  store.update('Jobs',job.id,{
    sold_booking_match_status:'Review',
    updated_at:now,
    updated_by:actorId,
    version:Number(job.version||0)+1,
    commit_id:'R1A-'+commandId
  });
  return store.get('Jobs',job.id);
}

/* Internal post-command readiness hook. Advances Prebooking→ReadyToBook when ready.
 * Demotes ReadyToBook→Prebooking when a reopened gating task makes readiness false.
 * Never touches BookingInProgress+ and never recursively invokes a public command. */
function _r1sReevaluatePrebooking(store,jobId,actorId,commandId,now){
  if(!_r1sText(jobId))return null;
  var job=store.get('Jobs',jobId);
  if(!job)return null;
  if(job.workflow_stage==='Prebooking'){
    if(typeof processBookingGates!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');
    return processBookingGates(jobId,store,{actor:actorId,command_id:'AUTO-'+commandId,now:now});
  }
  if(job.workflow_stage==='ReadyToBook'){
    var evaluate=typeof evaluateReadyToBook==='function'?evaluateReadyToBook:null;
    if(!evaluate&&typeof require==='function'){
      try{evaluate=require('../s06/gates.js').evaluateReadyToBook;}catch(e){evaluate=null;}
    }
    if(typeof evaluate!=='function')_r1sErr('R1A_COMMAND_UNSUPPORTED');
    var readiness=evaluate(job,store);
    if(readiness&&readiness.ready)return{readiness:readiness};
    var before=job;
    store.update('Jobs',job.id,{
      workflow_stage:'Prebooking',
      updated_at:now,
      updated_by:actorId,
      version:Number(job.version||0)+1,
      commit_id:'R1A-'+commandId
    });
    var after=store.get('Jobs',job.id);
    _r1sInsertAudit(store,'AE-R1A-DEM-'+commandId,'Jobs',job.id,'WorkflowStage:Prebooking',before,after,actorId,commandId,(readiness&&readiness.summary)||'PrebookingBlocked','R1 AppSheet/S06',now);
    if(readiness){readiness.workflow_stage='Prebooking';readiness.stage_demoted=true;readiness.ready=false;readiness.blocked=true;}
    return{readiness:readiness||{ready:false,blocked:true,workflow_stage:'Prebooking',stage_demoted:true}};
  }
  return null;
}

/* PRE01 owns deposit InvoiceStages evidence: invoice ID/number + sent_at. Notes alone never satisfy it. */
function _r1sDepositInvoiceStage(store,jobId){
  var rows=(store.list('InvoiceStages')||[]).filter(function(s){return s.job_id===jobId&&String(s.stage||'').toLowerCase()==='deposit';});
  if(rows.length!==1)_r1sErr('R1A_DEPOSIT_STAGE_MISSING');
  return rows[0];
}
function _r1sPre01InvoiceEvidence(store,jobId){
  var rows=(store.list('InvoiceStages')||[]).filter(function(s){return s.job_id===jobId&&String(s.stage||'').toLowerCase()==='deposit';});
  if(rows.length!==1)return{pass:false,detail:'Deposit invoice stage missing'};
  var stage=rows[0],num=_r1sText(stage.invoice_number)?String(stage.invoice_number).trim():'',xero=_r1sText(stage.xero_invoice_id)?String(stage.xero_invoice_id).trim():'';
  var idOk=!!num||(!!xero&&xero!=='NOT_CONFIGURED'),sentOk=!!stage.sent_at;
  return{pass:idOk&&sentOk,detail:idOk&&sentOk?'Deposit invoice ID and sent status recorded':'Deposit invoice ID/sent status missing',stage:stage};
}
function _r1sInvoiceSentFlag(v){
  if(v===true)return true;
  if(v===false||v===null||v===undefined||v==='')return false;
  return ['yes','true','1','sent','y'].indexOf(String(v).trim().toLowerCase())>=0;
}
function _r1sPre01FailedOutcome(outcome){
  if(!_r1sText(outcome))return false;
  return ['failed','failure','follow_up','follow-up','followup'].indexOf(String(outcome).trim().toLowerCase())>=0;
}
function _r1sNextFollowUpAt(now){
  try{
    if(typeof nextStaffedDay==='function')return nextStaffedDay(now,[]);
    if(typeof require==='function'){var g=require('../s06/gates.js');if(g&&typeof g.nextStaffedDay==='function')return g.nextStaffedDay(now,[]);}
  }catch(e){}
  return new Date(Date.parse(now)+86400000).toISOString();
}
function _r1sApplyPre01InvoiceSent(store,jobId,actorId,invoiceNumber,now,commandId){
  var stage=_r1sDepositInvoiceStage(store,jobId);
  var patch={
    invoice_number:String(invoiceNumber).trim(),
    sent_at:now,
    updated_at:now,
    updated_by:actorId,
    version:Number(stage.version||0)+1,
    commit_id:'R1A-'+commandId
  };
  if(['Confirmed','Paid','PartPaid','Voided','Credited'].indexOf(stage.status)<0)patch.status='Sent';
  store.update('InvoiceStages',stage.id,patch);
  return store.get('InvoiceStages',stage.id);
}

function _r1sTaskComplete(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['completion_note','evidence_id','evidence_path','invoice_number','invoice_sent','outcome','contract_id','contract_signed','customer_details_verified','sold_value_verified','verified_gross_amount','deposit_bank_confirmed','deposit_amount','deposit_received_date','deposit_bank_reference'],['completion_note']),t=s.get('Tasks',r.task_id),jid='CJ-R1A-'+r.command_id;
  return s.withLock(function(){var prior=s.get('CommitJournal',jid);if(prior){if(prior.entity_type!=='Tasks'||prior.entity_id!==r.task_id||prior.changes_json!==JSON.stringify(p))_r1sErr('R1A_COMMAND_CONFLICT');if(prior.state!=='Committed')_r1sErr('R1A_RECOVERY_REQUIRED');return{status:'Replayed',task:s.get('Tasks',r.task_id),job:t&&t.job_id?s.get('Jobs',t.job_id):null,external_calls:0};}
    t=s.get('Tasks',r.task_id);if(Number(t.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');if(['Complete','NotRequired','Cancelled'].indexOf(t.status)>=0)_r1sErr('R1A_TASK_NOT_COMPLETABLE');if(['Open','Waiting','InProgress'].indexOf(t.status)<0||t.revision_required===true)_r1sErr('R1A_TASK_NOT_COMPLETABLE');
    var evidenceId=p.evidence_id||t.evidence_id||null,pendingUpload=null,pendingCategory=null,pre01Failed=_r1sPre01FailedOutcome(p.outcome),pre02Awaiting=_r1sPre02AwaitingSignature(p),pre03Mismatch=false,pre03BlockReason=null,pre03AmountPence=null,pre03ReceivedAt=null,pre03Stage=null,pre04Mismatch=false,pre04BlockReason=null,pre04VerifiedPence=null;
    if(t.template_code==='PRE01'){
      if(!t.job_id)_r1sErr('R1A_JOB_NOT_FOUND');
      if(!pre01Failed){
        if(!_r1sText(p.invoice_number))_r1sErr('R1A_REQUIRED_INVOICE_NUMBER');
        if(!_r1sInvoiceSentFlag(p.invoice_sent))_r1sErr('R1A_REQUIRED_INVOICE_SENT');
        _r1sDepositInvoiceStage(s,t.job_id);
      }
    }
    if(t.template_code==='PRE02'){
      if(!t.job_id)_r1sErr('R1A_JOB_NOT_FOUND');
      if(!_r1sText(p.contract_id))_r1sErr('R1A_REQUIRED_CONTRACT_ID');
      if(pre02Awaiting){
        /* Sent / awaiting signature — never Complete. Evidence not required. */
      } else if(!_r1sContractSignedFlag(p.contract_signed)){
        _r1sErr('R1A_REQUIRED_CONTRACT_SIGNED');
      } else {
        pendingCategory='Contract';
        if(_r1sText(p.evidence_path)){
          pendingUpload=_r1sResolveEvidencePath(p.evidence_path,ctx);
        } else {
          if(!_r1sText(evidenceId))_r1sErr('R1A_REQUIRED_EVIDENCE_ID');
          evidenceId=_r1sRequireJobContractEvidence(s,t.job_id,evidenceId);
        }
      }
    }
    if(t.template_code==='PRE03'){
      if(!t.job_id)_r1sErr('R1A_JOB_NOT_FOUND');
      var depYes=_r1sYesFlag(p.deposit_bank_confirmed),depNo=_r1sExplicitNoFlag(p.deposit_bank_confirmed);
      if(!depYes&&!depNo)_r1sErr('R1A_REQUIRED_DEPOSIT_BANK_CONFIRMED');
      pre03Stage=_r1sDepositStage(s,t.job_id);
      if(depNo){
        /* Explicit "not received": never Complete; optional amount/date are journaled with a NotReceived check. */
        pre03Mismatch=true;pre03BlockReason='PRE03_DEPOSIT_NOT_RECEIVED';
        pre03AmountPence=_r1sBlank(p.deposit_amount)?0:_r1sDepositAmountPence(p.deposit_amount,true);
        pre03ReceivedAt=_r1sBlank(p.deposit_received_date)?null:_r1sDepositReceivedAt(p.deposit_received_date);
      }else{
        if(_r1sBlank(p.deposit_amount))_r1sErr('R1A_REQUIRED_DEPOSIT_AMOUNT');
        if(_r1sBlank(p.deposit_received_date))_r1sErr('R1A_REQUIRED_DEPOSIT_RECEIVED_DATE');
        if(!_r1sText(p.deposit_bank_reference))_r1sErr('R1A_REQUIRED_DEPOSIT_BANK_REFERENCE');
        pre03AmountPence=_r1sDepositAmountPence(p.deposit_amount,false);
        pre03ReceivedAt=_r1sDepositReceivedAt(p.deposit_received_date);
        if(pre03AmountPence!==Number(pre03Stage.gross_pence)){pre03Mismatch=true;pre03BlockReason='PRE03_DEPOSIT_AMOUNT_MISMATCH';}
      }
      /* Documentary evidence is optional and can never replace the explicit bank check. */
    }
    if(t.template_code==='PRE04'){
      if(!t.job_id)_r1sErr('R1A_JOB_NOT_FOUND');
      var custYes=_r1sYesFlag(p.customer_details_verified),custNo=_r1sExplicitNoFlag(p.customer_details_verified);
      var soldYes=_r1sYesFlag(p.sold_value_verified),soldNo=_r1sExplicitNoFlag(p.sold_value_verified);
      if(!custYes&&!custNo)_r1sErr('R1A_REQUIRED_CUSTOMER_DETAILS_VERIFIED');
      if(!soldYes&&!soldNo)_r1sErr('R1A_REQUIRED_SOLD_VALUE_VERIFIED');
      if(custNo){pre04Mismatch=true;pre04BlockReason='PRE04_CUSTOMER_DETAILS_MISMATCH';}
      else if(soldNo){pre04Mismatch=true;pre04BlockReason='PRE04_SOLD_VALUE_MISMATCH';}
      else {
        if(p.verified_gross_amount===undefined||p.verified_gross_amount===null||p.verified_gross_amount==='')_r1sErr('R1A_REQUIRED_VERIFIED_GROSS_AMOUNT');
        pre04VerifiedPence=Number(_r1sPoundsToPence(p.verified_gross_amount));
        var jobAmt=s.get('Jobs',t.job_id);if(!jobAmt)_r1sErr('R1A_JOB_NOT_FOUND');
        if(pre04VerifiedPence!==Number(_r1sCanonicalGrossPence(jobAmt))){pre04Mismatch=true;pre04BlockReason='PRE04_VALUE_MISMATCH';}
      }
      /* Documentary upload is optional for PRE04; structured verification is authoritative. */
      if(!pre04Mismatch&&_r1sText(p.evidence_path)){
        pendingCategory='CustomerDetails';
        pendingUpload=_r1sResolveEvidencePath(p.evidence_path,ctx);
      } else if(!pre04Mismatch&&_r1sText(p.evidence_id)){
        var evPre04=s.get('Evidence',String(p.evidence_id).trim());
        if(evPre04&&evPre04.job_id!==t.job_id)_r1sErr('R1A_CROSS_JOB_EVIDENCE');
        evidenceId=String(p.evidence_id).trim();
      }
    }
    var now=new Date().toISOString();
    s.insert('CommitJournal',{id:jid,commit_id:'R1A-'+r.command_id,state:'Prepared',command_id:r.command_id,entity_type:'Tasks',entity_id:t.id,expected_version:r.expected_version,changes_json:JSON.stringify(p),prepared_at:now,committed_at:null,created_at:now});
    try{
    if(t.template_code==='PRE01'&&pre01Failed){
      var followUpAt=_r1sNextFollowUpAt(now);
      var failAfter=Object.assign({},t,{status:'Waiting',completed_at:null,completed_by:null,completion_note:p.completion_note,blocking_reason:'PRE01_INVOICE_SEND_FAILED',next_followup_at:followUpAt,updated_at:now,updated_by:a.id,version:Number(t.version)+1,commit_id:'R1A-'+r.command_id});
      s.update('Tasks',t.id,{status:failAfter.status,completed_at:null,completed_by:null,completion_note:failAfter.completion_note,blocking_reason:failAfter.blocking_reason,next_followup_at:failAfter.next_followup_at,updated_at:now,updated_by:a.id,version:failAfter.version,commit_id:failAfter.commit_id});
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'FollowUp',old_status:t.status,new_status:'Waiting',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.completion_note,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      var failJob=s.get('Jobs',t.job_id),failReadiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);
      _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'FollowUp',t,failAfter,a.id,r.command_id,p.completion_note,'R1 AppSheet/S04',now);
      s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
      return{status:'FollowUpRequired',task:s.get('Tasks',t.id),job:failJob,invoice_stage:_r1sPre01InvoiceEvidence(s,t.job_id).stage||null,readiness:failReadiness&&failReadiness.readiness||null,external_calls:0};
    }
    if(t.template_code==='PRE02'&&pre02Awaiting){
      var awaitFollowUp=_r1sNextFollowUpAt(now);
      var jobSent=s.get('Jobs',t.job_id);if(!jobSent)_r1sErr('R1A_JOB_NOT_FOUND');
      jobSent=_r1sApplyPre02ContractSent(s,jobSent,a.id,p.contract_id,now,r.command_id);
      var awaitAfter=Object.assign({},t,{status:'Waiting',completed_at:null,completed_by:null,completion_note:p.completion_note,blocking_reason:'PRE02_AWAITING_SIGNATURE',next_followup_at:awaitFollowUp,updated_at:now,updated_by:a.id,version:Number(t.version)+1,commit_id:'R1A-'+r.command_id});
      s.update('Tasks',t.id,{status:awaitAfter.status,completed_at:null,completed_by:null,completion_note:awaitAfter.completion_note,blocking_reason:awaitAfter.blocking_reason,next_followup_at:awaitAfter.next_followup_at,updated_at:now,updated_by:a.id,version:awaitAfter.version,commit_id:awaitAfter.commit_id});
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'FollowUp',old_status:t.status,new_status:'Waiting',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.completion_note,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      var awaitReadiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);
      _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'FollowUp',t,awaitAfter,a.id,r.command_id,p.completion_note,'R1 AppSheet/S04',now);
      s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
      return{status:'FollowUpRequired',task:s.get('Tasks',t.id),job:s.get('Jobs',t.job_id),readiness:awaitReadiness&&awaitReadiness.readiness||null,external_calls:0};
    }
    if(t.template_code==='PRE03'&&pre03Mismatch){
      var pre03Follow=_r1sNextFollowUpAt(now),pre03Outcome=pre03BlockReason==='PRE03_DEPOSIT_NOT_RECEIVED'?'NotReceived':'AmountMismatch';
      _r1sInsertBankCheck(s,t.job_id,a.id,pre03AmountPence,pre03ReceivedAt||now,pre03Outcome,p.deposit_bank_reference,now,r.command_id);
      var pre03After=Object.assign({},t,{status:'Waiting',completed_at:null,completed_by:null,completion_note:p.completion_note,blocking_reason:pre03BlockReason,next_followup_at:pre03Follow,updated_at:now,updated_by:a.id,version:Number(t.version)+1,commit_id:'R1A-'+r.command_id});
      s.update('Tasks',t.id,{status:'Waiting',completed_at:null,completed_by:null,completion_note:p.completion_note,blocking_reason:pre03BlockReason,next_followup_at:pre03Follow,updated_at:now,updated_by:a.id,version:pre03After.version,commit_id:pre03After.commit_id});
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'FollowUp',old_status:t.status,new_status:'Waiting',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.completion_note,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      var pre03Readiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);
      _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'FollowUp',t,pre03After,a.id,r.command_id,p.completion_note,'R1 AppSheet/S13',now);
      s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
      return{status:'FollowUpRequired',task:s.get('Tasks',t.id),job:s.get('Jobs',t.job_id),bank_check:s.get('ManualBankChecks','MBC-R1A-'+r.command_id),readiness:pre03Readiness&&pre03Readiness.readiness||null,external_calls:0};
    }
    if(t.template_code==='PRE04'&&pre04Mismatch){
      var pre04Follow=_r1sNextFollowUpAt(now);
      var jobReview=s.get('Jobs',t.job_id);if(!jobReview)_r1sErr('R1A_JOB_NOT_FOUND');
      var grossBefore=jobReview.original_gross_pence,currentBefore=jobReview.current_contract_gross_pence;
      jobReview=_r1sApplyPre04MismatchReview(s,jobReview,a.id,now,r.command_id);
      if(jobReview.original_gross_pence!==grossBefore||jobReview.current_contract_gross_pence!==currentBefore)_r1sErr('R1A_FINANCIAL_MUTATION');
      var pre04After=Object.assign({},t,{status:'Waiting',completed_at:null,completed_by:null,completion_note:p.completion_note,blocking_reason:pre04BlockReason,next_followup_at:pre04Follow,updated_at:now,updated_by:a.id,version:Number(t.version)+1,commit_id:'R1A-'+r.command_id});
      s.update('Tasks',t.id,{status:pre04After.status,completed_at:null,completed_by:null,completion_note:pre04After.completion_note,blocking_reason:pre04After.blocking_reason,next_followup_at:pre04After.next_followup_at,updated_at:now,updated_by:a.id,version:pre04After.version,commit_id:pre04After.commit_id});
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'FollowUp',old_status:t.status,new_status:'Waiting',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.completion_note,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      var pre04Readiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);
      _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'FollowUp',t,pre04After,a.id,r.command_id,p.completion_note,'R1 AppSheet/S04',now);
      s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
      return{status:'FollowUpRequired',task:s.get('Tasks',t.id),job:s.get('Jobs',t.job_id),readiness:pre04Readiness&&pre04Readiness.readiness||null,external_calls:0};
    }
    if(pendingUpload){
      var ensured=_r1sEnsureOfficeTaskEvidence(s,t.job_id,a.id,pendingCategory,pendingUpload,now,r.command_id);
      if(_r1sText(p.evidence_id)&&String(p.evidence_id).trim()!==ensured.evidence_id)_r1sErr('R1A_EVIDENCE_CONFLICT');
      evidenceId=ensured.evidence_id;
    }
    var invoiceStage=null,bankCheck=null;
    if(t.template_code==='PRE01')invoiceStage=_r1sApplyPre01InvoiceSent(s,t.job_id,a.id,p.invoice_number,now,r.command_id);
    if(t.template_code==='PRE03'){
      var pre03Recorded=_r1sRecordDepositConfirmation(s,t.job_id,a.id,pre03AmountPence,pre03ReceivedAt,p.deposit_bank_reference,now,r.command_id);
      bankCheck=pre03Recorded.bank_check;invoiceStage=pre03Recorded.stage;
    }
    var after=Object.assign({},t,{status:'Complete',completed_at:now,completed_by:a.id,completion_note:p.completion_note,evidence_id:evidenceId||null,blocking_reason:null,updated_at:now,updated_by:a.id,version:Number(t.version)+1,commit_id:'R1A-'+r.command_id});
    s.update('Tasks',t.id,{status:after.status,completed_at:after.completed_at,completed_by:after.completed_by,completion_note:after.completion_note,evidence_id:after.evidence_id,blocking_reason:null,updated_at:now,updated_by:a.id,version:after.version,commit_id:after.commit_id});
    s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'Complete',old_status:t.status,new_status:'Complete',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.completion_note,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
    var jobAfter=null,readiness=null;
    if(t.job_id&&(t.template_code==='PRE02'||t.template_code==='PRE04')){
      var job=s.get('Jobs',t.job_id);if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
      if(t.template_code==='PRE02')jobAfter=_r1sApplyPre02Contract(s,job,a.id,evidenceId,now,r.command_id,p.contract_id);
      if(t.template_code==='PRE04'){
        var grossKeep=job.original_gross_pence,currentKeep=job.current_contract_gross_pence;
        jobAfter=_r1sApplyPre04Verification(s,job,a.id,now,r.command_id,pre04VerifiedPence);
        if(jobAfter.original_gross_pence!==grossKeep||jobAfter.current_contract_gross_pence!==currentKeep)_r1sErr('R1A_FINANCIAL_MUTATION');
      }
    }
    if(t.job_id&&['PRE01','PRE02','PRE03','PRE04','PRE05'].indexOf(t.template_code)>=0){readiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);jobAfter=s.get('Jobs',t.job_id);}
    _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'Complete',t,after,a.id,r.command_id,p.completion_note,'R1 AppSheet/S04',now);s.update('CommitJournal',jid,{state:'Committed',committed_at:now});return{status:'Completed',task:s.get('Tasks',t.id),job:jobAfter,invoice_stage:invoiceStage,bank_check:bankCheck,readiness:readiness&&readiness.readiness||null,external_calls:0};}catch(e){s.update('CommitJournal',jid,{state:'RecoveryRequired'});throw e;}});}

/* Reopen a terminal task (Complete or NotRequired) back to Open for correction.
 * Preserves completion_note / evidence_id on the task row and all prior TaskEvents/AuditEvents.
 * Clears completed_at / completed_by only. Gating PRE* reopen re-evaluates ReadyToBook. */
function _r1sTaskReopen(ctx){
  var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['reopen_reason'],['reopen_reason']),t=s.get('Tasks',r.task_id),jid='CJ-R1A-'+r.command_id;
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
    if(['Complete','NotRequired'].indexOf(t.status)<0)_r1sErr('R1A_TASK_NOT_REOPENABLE');
    var now=new Date().toISOString();
    var before=Object.assign({},t);
    s.insert('CommitJournal',{id:jid,commit_id:'R1A-'+r.command_id,state:'Prepared',command_id:r.command_id,entity_type:'Tasks',entity_id:t.id,expected_version:r.expected_version,changes_json:JSON.stringify(p),prepared_at:now,committed_at:null,created_at:now});
    try{
      var after=Object.assign({},t,{
        status:'Open',
        completed_at:null,
        completed_by:null,
        updated_at:now,
        updated_by:a.id,
        version:Number(t.version)+1,
        commit_id:'R1A-'+r.command_id
      });
      s.update('Tasks',t.id,{
        status:after.status,
        completed_at:null,
        completed_by:null,
        updated_at:now,
        updated_by:a.id,
        version:after.version,
        commit_id:after.commit_id
      });
      after=s.get('Tasks',t.id);
      if(after.completion_note!==t.completion_note||after.evidence_id!==t.evidence_id)_r1sErr('R1A_TASK_HISTORY_MUTATION');
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'Reopen',old_status:t.status,new_status:'Open',old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:p.reopen_reason,actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      var jobAfter=t.job_id?s.get('Jobs',t.job_id):null,readiness=null;
      if(t.job_id&&['PRE01','PRE02','PRE03','PRE04','PRE05'].indexOf(t.template_code)>=0){
        readiness=_r1sReevaluatePrebooking(s,t.job_id,a.id,r.command_id,now);
        jobAfter=s.get('Jobs',t.job_id);
      }
      _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'Reopen',before,after,a.id,r.command_id,p.reopen_reason,'R1 AppSheet/S04',now);
      s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
      return{status:'Reopened',task:s.get('Tasks',t.id),job:jobAfter,readiness:readiness&&readiness.readiness||null,external_calls:0};
    }catch(e){s.update('CommitJournal',jid,{state:'RecoveryRequired'});throw e;}
  });
}

/* TASK_EVIDENCE_ATTACH: signed-contract evidence for PRE02 only (every other template is refused).
 *  Pending: PRE02 Open/Waiting/InProgress (not revision_required). Uploads the signed contract BEFORE completion:
 *    creates/reuses the canonical Evidence row (category Contract, keyed by job + Drive file) and stores its id on
 *    Tasks.evidence_id (version + 1) so the Complete Task form and TASK_COMPLETE consume it. It does NOT complete
 *    PRE02, stamp Jobs contract fields or re-evaluate readiness: PRE02 TASK_COMPLETE (contract_id +
 *    contract_signed=Yes + valid job Evidence) remains the only signed-contract transition. A later upload replaces
 *    Tasks.evidence_id; earlier Evidence rows are kept.
 *  Repair: PRE02 Complete with blank evidence_id (completed before evidence existed). Attaches evidence, applies
 *    the PRE02 Jobs contract stamps and re-evaluates readiness without changing completion fields. */
function _r1sPre02AttachMode(t){
  if(!t||t.template_code!=='PRE02')return null;
  if(t.status==='Complete')return _r1sText(t.evidence_id)?'AlreadyAttached':'Repair';
  if(['Open','Waiting','InProgress'].indexOf(t.status)>=0&&t.revision_required!==true)return 'Pending';
  return null;
}
function _r1sTaskEvidenceAttach(ctx){
  var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['evidence_path'],['evidence_path']),t=s.get('Tasks',r.task_id),jid='CJ-R1A-'+r.command_id;
  return s.withLock(function(){
    var prior=s.get('CommitJournal',jid);
    if(prior){
      if(prior.entity_type!=='Tasks'||prior.entity_id!==r.task_id||prior.changes_json!==JSON.stringify(p))_r1sErr('R1A_COMMAND_CONFLICT');
      if(prior.state!=='Committed')_r1sErr('R1A_RECOVERY_REQUIRED');
      /* The committed audit's before-state records which mode ran, so a replay reports the same outcome. */
      var priorAudit=s.get('AuditEvents','AE-R1A-'+r.command_id),pendingReplay=false;
      try{pendingReplay=!!priorAudit&&JSON.parse(priorAudit.before_json||'{}').status!=='Complete';}catch(e){pendingReplay=false;}
      return{status:'Replayed',completion_required:pendingReplay,task:s.get('Tasks',r.task_id),job:t&&t.job_id?s.get('Jobs',t.job_id):null,external_calls:0};
    }
    t=s.get('Tasks',r.task_id);
    if(!t)_r1sErr('R1A_TASK_NOT_FOUND');
    if(Number(t.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');
    var mode=_r1sPre02AttachMode(t);
    if(!mode)_r1sErr('R1A_TASK_NOT_ATTACHABLE');
    if(mode==='AlreadyAttached')_r1sErr('R1A_EVIDENCE_ALREADY_ATTACHED');
    if(!t.job_id||!s.get('Jobs',t.job_id))_r1sErr('R1A_JOB_NOT_FOUND');
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
      if(after.status!==t.status||after.completed_at!==t.completed_at||after.completed_by!==t.completed_by||after.completion_note!==t.completion_note)_r1sErr('R1A_TASK_COMPLETION_MUTATION');
      s.insert('TaskEvents',{id:'TE-R1A-'+r.command_id,task_id:t.id,action:'EvidenceAttach',old_status:t.status,new_status:t.status,old_owner:t.owner_id,new_owner:t.owner_id,old_due:t.due_at,new_due:t.due_at,reason:mode==='Pending'?'TASK_EVIDENCE_ATTACH:PendingCompletion':'TASK_EVIDENCE_ATTACH',actor:a.id,timestamp:now,created_at:now,commit_id:'R1A-'+r.command_id});
      if(mode==='Pending'){
        var jobPending=s.get('Jobs',t.job_id);
        _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Tasks',t.id,'EvidenceAttach',before,after,a.id,r.command_id,p.evidence_path,'R1 AppSheet/S04',now);
        s.update('CommitJournal',jid,{state:'Committed',committed_at:now});
        return{status:'EvidenceUploaded',completion_required:true,task:s.get('Tasks',t.id),job:jobPending,evidence_id:evidenceId,evidence_created:!!ensured.created,readiness:null,external_calls:0};
      }
      var job=s.get('Jobs',t.job_id);if(!job)_r1sErr('R1A_JOB_NOT_FOUND');
      var grossBefore=job.original_gross_pence;
      var jobAfter=_r1sApplyPre02Contract(s,job,a.id,evidenceId,now,r.command_id,job.contract_id);
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

/* Legacy DEPOSIT_CONFIRM (Director, FN-15). Retained for the DEVDepositConfirmRequests route, but it is no longer a weaker
 * path: it requires the same manual bank-verification facts as PRE03 (explicit Yes, GBP amount reconciled server-side
 * against the deposit InvoiceStage, received date, reference) and writes through the same recorder, so it cannot produce
 * the Jobs/InvoiceStage summary state without a matching ManualBankChecks row. It never Completes the PRE03 task. */
function _r1sDepositConfirm(ctx){var r=ctx.request,s=ctx.store,a=ctx.actor,p=_r1sPayload(r,['reference','deposit_bank_confirmed','deposit_amount','deposit_received_date'],['reference','deposit_bank_confirmed','deposit_amount','deposit_received_date']);
  if(!_r1sYesFlag(p.deposit_bank_confirmed))_r1sErr('R1A_DEPOSIT_NOT_CONFIRMED');
  var amountPence=_r1sDepositAmountPence(p.deposit_amount,false),receivedAt=_r1sDepositReceivedAt(p.deposit_received_date);
  return s.withLock(function(){var job=s.get('Jobs',r.job_id);if(!job)_r1sErr('R1A_STALE_VERSION');
    if(job.deposit_bank_confirmed_at&&_r1sBankConfirmationValid(s,r.job_id))return{status:'AlreadyConfirmed',deposit:{ok:true,confirmed:false,reason:'Already confirmed'},job:job,readiness:null,external_calls:0};
    if(Number(job.version)!==Number(r.expected_version))_r1sErr('R1A_STALE_VERSION');
    var before=job,now=new Date().toISOString();
    var rec=_r1sRecordDepositConfirmation(s,r.job_id,a.id,amountPence,receivedAt,p.reference,now,r.command_id);
    var readiness=_r1sReevaluatePrebooking(s,r.job_id,a.id,r.command_id,now),after=s.get('Jobs',r.job_id);
    _r1sInsertAudit(s,'AE-R1A-'+r.command_id,'Jobs',r.job_id,'DepositConfirm',before,after,a.id,r.command_id,String(p.reference).trim(),'R1 AppSheet/S13',now);
    return{status:'Confirmed',deposit:{ok:true,confirmed:true,stage_id:rec.stage.id,bank_check_id:rec.bank_check.id},job:after,bank_check:rec.bank_check,readiness:readiness&&readiness.readiness||null,external_calls:0};});}

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

/* ---- PRE03 owner assignment: read-only audit and DEV repair (Admin/Manager only) ----
 * The canonical owner/backup come from S06 (resolveBankConfirmationOwner/Backup, defined once in s06/gates.js).
 * Repair changes only Tasks.owner_id on one open PRE03 task: same task id, due dates, backup, status and history;
 * version + 1; CommitJournal + TaskEvent 'Reassign' + AuditEvent. It never creates, completes or recreates tasks and
 * does not re-evaluate readiness, because PRE03 gates do not depend on the owner. */
var R1S_PRE03_REPAIRABLE_STATUSES=['Open','Waiting','InProgress','Blocked'];
var R1S_PRE03_PRESERVED_FIELDS=['id','job_id','template_code','instance_key','group','title','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','source_system'];
function _r1sGatesApi(){
  if(typeof resolveBankConfirmationOwner==='function'&&typeof resolveBankConfirmationBackup==='function')return{owner:resolveBankConfirmationOwner,backup:resolveBankConfirmationBackup};
  if(typeof require==='function'){try{var g=require('../s06/gates.js');if(g&&typeof g.resolveBankConfirmationOwner==='function')return{owner:g.resolveBankConfirmationOwner,backup:g.resolveBankConfirmationBackup};}catch(e){}}
  _r1sErr('R1A_COMMAND_UNSUPPORTED');
}
function _r1sRequireAdminActor(store,actor){
  if(!store||typeof store.getEnvironment!=='function'||store.getEnvironment()!=='DEV')_r1sErr('R1A_DEV_ONLY');
  if(!actor||!Array.isArray(actor.roles)||(actor.roles.indexOf('Admin')<0&&actor.roles.indexOf('Manager')<0))_r1sErr('R1A_ROLE_DENIED');
}
function _r1sPersonLabel(store,id){if(!_r1sText(id))return null;var p=store.get('People',id);return p&&_r1sText(p.display_name)?p.display_name.trim():id;}
function _r1sErrWith(code,diagnostics){var e=new Error(code);e.code=code;e.diagnostics=diagnostics;throw e;}
/* Identifier text as typed or stored in Sheets: trimmed, zero-width/BOM characters removed, no-break space as space. */
function _r1sIdKey(v){return String(v===undefined||v===null?'':v).replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\u00A0/g,' ').trim();}
function _r1sStoreInfo(store,info,jobs,tasks){
  return{spreadsheet_id:typeof store.getSheetId==='function'?store.getSheetId():null,spreadsheet_name:info&&typeof info.spreadsheet_name==='string'?info.spreadsheet_name:null,
    environment:typeof store.getEnvironment==='function'?store.getEnvironment():null,jobs_rows:jobs.length,tasks_rows:tasks.length};
}
/* Explicit job resolution for DEV admin tools. Jobs has two identifiers: public Jobs.job_id (SS-XXXX-0000) and the
 * internal Jobs.id primary key (J-...). The supplied reference is matched against Jobs.job_id (case-insensitive) and
 * Jobs.id (exact); it must identify exactly one row. The lookup record never contains customer data. */
function _r1sResolveJobRef(jobs,ref){
  var supplied=ref===undefined||ref===null?null:String(ref),key=_r1sIdKey(supplied);
  var lookup={supplied_job_ref:supplied,normalized_job_ref:key||null,public_id_matches:0,internal_id_matches:0,matched_by:null,normalized_match:false,resolved_job_internal_id:null,resolved_public_job_id:null};
  if(!key)_r1sErrWith('R1A_JOB_REF_REQUIRED',{lookup:lookup,hint:'Pass the public job ID (for example SS-SEXL-5961) or the internal Jobs.id. From the Apps Script editor run a no-argument wrapper such as runR1ARepairPre03AssignmentSSSEXL5961DryRun.'});
  var upper=key.toUpperCase();
  var byPublic=jobs.filter(function(j){var v=_r1sIdKey(j.job_id);return v!==''&&v.toUpperCase()===upper;});
  var byInternal=jobs.filter(function(j){return _r1sIdKey(j.id)===key;});
  var rows={};byPublic.concat(byInternal).forEach(function(j){rows[_r1sIdKey(j.id)]=j;});
  var ids=Object.keys(rows);
  lookup.public_id_matches=byPublic.length;lookup.internal_id_matches=byInternal.length;
  if(ids.length>1)_r1sErrWith('R1A_JOB_AMBIGUOUS',{lookup:lookup});
  if(!ids.length)_r1sErrWith('R1A_JOB_NOT_FOUND',{lookup:lookup});
  var job=rows[ids[0]],matchedValue=byPublic.length?job.job_id:job.id;
  lookup.matched_by=byPublic.length?'Jobs.job_id':'Jobs.id';
  lookup.normalized_match=String(matchedValue)!==_r1sIdKey(matchedValue)||(supplied!==null&&supplied.trim()!==key);
  /* Cleaned values: normalized_match says whether hidden characters were ignored to find them. */
  lookup.resolved_job_internal_id=_r1sIdKey(job.id);
  lookup.resolved_public_job_id=_r1sIdKey(job.job_id)||null;
  return{job:job,lookup:lookup};
}
function _r1sPre03Row(store,t,job,owner,backup){
  var open=R1S_PRE03_REPAIRABLE_STATUSES.indexOf(t.status)>=0;
  return{job_id:job.id,job_id_human:job.job_id||null,task_id:t.id,task_status:t.status,task_version:Number(t.version),due_at:t.due_at||null,
    current_owner_id:t.owner_id||null,current_owner_name:_r1sPersonLabel(store,t.owner_id),canonical_owner_id:owner,canonical_owner_name:_r1sPersonLabel(store,owner),
    current_backup_id:t.backup_id||null,current_backup_name:_r1sPersonLabel(store,t.backup_id),canonical_backup_id:backup||null,canonical_backup_name:_r1sPersonLabel(store,backup),
    backup_matches:(t.backup_id||null)===(backup||null),
    action:t.owner_id===owner?'AlreadyCorrect':(open?'Reassign':'NotRepairable')};
}
/* 1 resolve job (Jobs.job_id or Jobs.id)  2 canonical Jobs.id  3 PRE03 by Tasks.job_id = Jobs.id + template_code
 * 4 exactly one  5-6 status and owner/backup checked by the caller. diagnostics prove store, lookup and task. Read-only. */
function _r1sPre03AssignmentPlan(store,jobRef,info){
  var jobs=store.list('Jobs')||[],tasks=store.list('Tasks')||[];
  var diagnostics={store:_r1sStoreInfo(store,info,jobs,tasks)};
  function withDiagnostics(e,extra){e.diagnostics=Object.assign({},diagnostics,e.diagnostics||{},extra||{});return e;}
  var resolved;
  try{resolved=_r1sResolveJobRef(jobs,jobRef);}catch(e){throw withDiagnostics(e);}
  var job=resolved.job,jobKey=_r1sIdKey(job.id);
  diagnostics.lookup=resolved.lookup;
  if(job.pilot_job!==true||job.release_scope!=='R1')_r1sErrWith('R1A_OUTSIDE_PILOT',diagnostics);
  if(job.finance_route!=='Standard')_r1sErrWith('R1A_PRE03_NOT_APPLICABLE',diagnostics);
  var pre03=tasks.filter(function(t){return _r1sIdKey(t.job_id)===jobKey&&t.template_code==='PRE03';});
  diagnostics.pre03={match_rule:"Tasks.job_id = Jobs.id AND Tasks.template_code = 'PRE03'",task_ids:pre03.map(function(t){return t.id;}),task_statuses:pre03.map(function(t){return t.status;}),task_id:pre03.length===1?pre03[0].id:null};
  if(!pre03.length)_r1sErrWith('R1A_PRE03_MISSING',diagnostics);
  if(pre03.length>1)_r1sErrWith('R1A_PRE03_AMBIGUOUS',diagnostics);
  var api=_r1sGatesApi(),row;
  try{row=_r1sPre03Row(store,pre03[0],job,api.owner(store),api.backup(store));}catch(e){throw withDiagnostics(e);}
  row.diagnostics=diagnostics;
  return row;
}
function _r1sPre03AssignmentAudit(store,actor,info){
  _r1sRequireAdminActor(store,actor);
  var api=_r1sGatesApi(),owner=api.owner(store),backup=api.backup(store),jobRows=store.list('Jobs')||[],taskRows=store.list('Tasks')||[],jobs={};
  jobRows.forEach(function(j){jobs[_r1sIdKey(j.id)]=j;});
  var rows=taskRows.filter(function(t){var j=jobs[_r1sIdKey(t.job_id)];return t.template_code==='PRE03'&&!!j&&j.pilot_job===true&&j.release_scope==='R1';}).map(function(t){return _r1sPre03Row(store,t,jobs[_r1sIdKey(t.job_id)],owner,backup);});
  return{ok:true,environment:'DEV',diagnostics:{store:_r1sStoreInfo(store,info,jobRows,taskRows)},canonical_owner_id:owner,canonical_owner_name:_r1sPersonLabel(store,owner),canonical_backup_id:backup||null,canonical_backup_name:_r1sPersonLabel(store,backup),
    checked:rows.length,misassigned:rows.filter(function(r){return r.action!=='AlreadyCorrect';}),backup_mismatches:rows.filter(function(r){return !r.backup_matches;}),external_calls:0};
}
function _r1sRepairPre03Assignment(store,actor,input){
  _r1sRequireAdminActor(store,actor);
  input=input||{};
  var apply=input.apply===true;
  return store.withLock(function(){
    var plan=_r1sPre03AssignmentPlan(store,input.job_ref,input.store_info);
    var diagnostics=plan.diagnostics;delete plan.diagnostics;
    var out={ok:true,environment:'DEV',dry_run:!apply,applied:false,actor_id:actor.id,diagnostics:diagnostics,plan:plan,external_calls:0};
    if(!apply){out.status='DryRun';return out;}
    if(plan.action==='NotRepairable')_r1sErr('R1A_PRE03_NOT_OPEN');
    if(plan.action==='AlreadyCorrect'){out.status='AlreadyCorrect';return out;}
    var t=store.get('Tasks',plan.task_id),cmd='PRE03-OWNER-REPAIR-'+t.id+'-V'+Number(t.version),jid='CJ-R1A-'+cmd,now=new Date().toISOString();
    /* A journal for this exact task version with the owner still wrong means an earlier attempt did not finish. */
    if(store.get('CommitJournal',jid))_r1sErr('R1A_RECOVERY_REQUIRED');
    var reason='PRE03 owner repair: '+(plan.current_owner_name||plan.current_owner_id||'unassigned')+' -> '+plan.canonical_owner_name+' (canonical bank confirmation owner)';
    store.insert('CommitJournal',{id:jid,commit_id:'R1A-'+cmd,state:'Prepared',command_id:cmd,entity_type:'Tasks',entity_id:t.id,expected_version:Number(t.version),changes_json:JSON.stringify({owner_id:plan.canonical_owner_id,from_owner_id:t.owner_id||null}),prepared_at:now,committed_at:null,created_at:now});
    try{
      store.update('Tasks',t.id,{owner_id:plan.canonical_owner_id,updated_at:now,updated_by:actor.id,version:Number(t.version)+1,commit_id:'R1A-'+cmd});
      var after=store.get('Tasks',t.id);
      R1S_PRE03_PRESERVED_FIELDS.forEach(function(k){if(JSON.stringify(after[k])!==JSON.stringify(t[k]))_r1sErr('R1A_TASK_HISTORY_MUTATION');});
      if(after.owner_id!==plan.canonical_owner_id||Number(after.version)!==Number(t.version)+1)_r1sErr('R1A_TASK_HISTORY_MUTATION');
      store.insert('TaskEvents',{id:'TE-R1A-'+cmd,task_id:t.id,action:'Reassign',old_status:t.status,new_status:after.status,old_owner:t.owner_id||null,new_owner:after.owner_id,old_due:t.due_at||null,new_due:after.due_at||null,reason:reason,actor:actor.id,timestamp:now,created_at:now,commit_id:'R1A-'+cmd});
      _r1sInsertAudit(store,'AE-R1A-'+cmd,'Tasks',t.id,'Reassign',t,after,actor.id,cmd,reason,'R1 AppSheet/S06 PRE03 owner repair',now);
      store.update('CommitJournal',jid,{state:'Committed',committed_at:now});
    }catch(e){store.update('CommitJournal',jid,{state:'RecoveryRequired'});throw e;}
    out.applied=true;out.status='Reassigned';out.command_id=cmd;out.task=store.get('Tasks',plan.task_id);
    return out;
  });
}

function _r1sServices(){return{TASK_COMPLETE:_r1sTaskComplete,TASK_REOPEN:_r1sTaskReopen,TASK_EVIDENCE_ATTACH:_r1sTaskEvidenceAttach,CALL_RECORD:_r1sCallRecord,ISSUE_UPDATE:_r1sIssueUpdate,ISSUE_CREATE:_r1sIssueCreate,PLANNER_UPDATE:_r1sPlannerUpdate,MOVE_JOB:_r1sMoveJob,CHANGE_INSTALLER:_r1sChangeInstaller,CANCEL_JOB:_r1sCancel,REINSTATE_JOB:_r1sReinstate,DEPOSIT_CONFIRM:_r1sDepositConfirm,OPERATIONAL_COMPLETE:_r1sOperationalComplete,BOOKING_GATES:_r1sBookingGates,SOLD_INTAKE:_r1sSoldIntake,BOOKING_INTAKE:_r1sBookingIntake};}

if(typeof module!=='undefined')module.exports={_r1sServices:_r1sServices,R1A_SOLD_FIELDS:R1A_SOLD_FIELDS,R1A_BOOKING_FIELDS:R1A_BOOKING_FIELDS,R1A_ISSUE_CREATE_FIELDS:R1A_ISSUE_CREATE_FIELDS,R1A_SOLD_REQUEST_COLUMNS:R1A_SOLD_REQUEST_COLUMNS,R1A_BOOKING_REQUEST_COLUMNS:R1A_BOOKING_REQUEST_COLUMNS,R1A_ISSUE_CREATE_REQUEST_COLUMNS:R1A_ISSUE_CREATE_REQUEST_COLUMNS,_r1sSoldExpression:_r1sSoldExpression,_r1sBookingExpression:_r1sBookingExpression,_r1sApplyPre02Contract:_r1sApplyPre02Contract,_r1sApplyPre02ContractSent:_r1sApplyPre02ContractSent,_r1sPre02AttachMode:_r1sPre02AttachMode,_r1sPre03AssignmentPlan:_r1sPre03AssignmentPlan,_r1sResolveJobRef:_r1sResolveJobRef,_r1sIdKey:_r1sIdKey,_r1sPre03AssignmentAudit:_r1sPre03AssignmentAudit,_r1sRepairPre03Assignment:_r1sRepairPre03Assignment,_r1sApplyPre04Verification:_r1sApplyPre04Verification,_r1sApplyPre04MismatchReview:_r1sApplyPre04MismatchReview,_r1sCanonicalGrossPence:_r1sCanonicalGrossPence,_r1sReevaluatePrebooking:_r1sReevaluatePrebooking,_r1sResolveContractEvidenceId:_r1sResolveContractEvidenceId,_r1sRequireJobContractEvidence:_r1sRequireJobContractEvidence,_r1sEnsureOfficeTaskEvidence:_r1sEnsureOfficeTaskEvidence,_r1sHashDrive:_r1sHashDrive,_r1sPre01InvoiceEvidence:_r1sPre01InvoiceEvidence,_r1sApplyPre01InvoiceSent:_r1sApplyPre01InvoiceSent,_r1sRecordDepositConfirmation:_r1sRecordDepositConfirmation,_r1sDepositAmountPence:_r1sDepositAmountPence,_r1sDepositReceivedAt:_r1sDepositReceivedAt,_r1sBankConfirmationValid:_r1sBankConfirmationValid};
