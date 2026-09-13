/* DEV-only Apps Script entry points. No generic mutation and no PROD fallback. */
function _r1aCloudOptions(){
  var store=_s17CloudStore();
  store.withLock=function(fn){var lock=LockService.getScriptLock();lock.waitLock(30000);try{return fn();}finally{lock.releaseLock();}};
  return {store:store,config:{environment:'DEV',sheetId:R1A_BOUND_DEV_SHEET_ID},actorEmail:function(){return Session.getActiveUser().getEmail();},effectiveUserEmail:function(){return Session.getEffectiveUser().getEmail();},reads:_r1aDefaultReads(),services:_r1sServices()};
}
function appSheetR1Read(requestJson,actorEmail){try{var request=JSON.parse(requestJson);return JSON.stringify(R1C_READS.indexOf(request.read_type)>=0?_r1cReadCloud(request,actorEmail):_r1aCreate(_r1aCloudOptions()).read(request));}catch(e){return JSON.stringify({ok:false,error:e.code||e.message||'R1A_REFUSED'});}}
function appSheetR1Command(requestJson){try{return JSON.stringify(_r1aCreate(_r1aCloudOptions()).command(JSON.parse(requestJson)));}catch(e){return JSON.stringify({ok:false,error:e.code||e.message||'R1A_REFUSED'});}}

/* Namespaced DEV synthetic fixtures for AppSheet command smokes. Exact DEV sheet only. */
function _r1aFixtureResult(name,pass,detail){var r={test:name,pass:!!pass,detail:detail};console.log(JSON.stringify(r,null,2));return r;}
function _r1aFixtureIns(store,table,row){if(!store.get(table,row.id))store.insert(table,row);}
function _r1aFixtureUpsert(store,table,row){if(store.get(table,row.id))store.update(table,row.id,row);else store.insert(table,row);}
/* Soft-retire: clear id so store.list filters the row out. DEV fixture rows only. */
function _r1aFixtureRetire(store,table,id){if(store.get(table,id))store.update(table,id,{id:''});}

function runR1APrepareDepositConfirmFixture(){
  var store=_r1aCloudOptions().store,n='2026-11-01T00:00:00.000Z',jobId='J-r1a-deposit';
  _r1aFixtureIns(store,'Jobs',{id:jobId,job_id:'SS-R1A-DEP',customer_id:'CUST-r1a-dep',display_name:'R1A Deposit Confirm DEV',sold_submission_id:'R1A-sold-dep',booking_submission_id:'R1A-booking-dep',sold_at:n,salesperson_id:null,lead_source:'R1A',quote_reference:'Q-R1A-DEP',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-R1A-DEP',contract_signed_at:n,contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:n,customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:null,deposit_bank_confirmed_by:null,deposit_bank_reference:null,roof_required:false,electrical_required:false,scaffold_required:false,workflow_stage:'Booked',booking_approved_at:n,booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:n,account_policy_version:null,pilot_job:true,release_scope:'R1',created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',source_record_id:null,commit_id:'R1A-DEP'});
  _r1aFixtureIns(store,'InvoiceStages',{id:'IS-'+jobId+'-deposit',job_id:jobId,stage:'deposit',amount_net_pence:100000,vat_pence:20000,gross_pence:120000,due_date:null,status:'Pending',xero_invoice_id:null,invoice_number:null,xero_contact_id:null,reference:null,request_id:null,last_synced_at:null,source_status:null,sent_at:null,cancelled_at:null,created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',commit_id:'R1A-DEP'});
  var job=store.get('Jobs',jobId);
  return _r1aFixtureResult('R1A deposit fixture',!!job&&!!store.get('InvoiceStages','IS-'+jobId+'-deposit')&&!job.deposit_bank_confirmed_at,{job_id:jobId,expected_version:Number(job.version)});
}

/* Reset ONLY J-r1a-opcomplete namespaced synthetic state left by prior OPERATIONAL_COMPLETE attempts. */
function _r1aResetOperationalCompleteSynthetic(store){
  var jobId='J-r1a-opcomplete',ghlTaskId='TASK-GHL01-'+jobId+'-OPCOMPLETE',ghlRowId='GHL-'+jobId+'-OPCOMPLETE',retired={tasks:[],ghl_tasks:[],audit:[],journal:[],task_events:[],templates:[]};
  /* Stale duplicate GHL01 template must not coexist with seed TPL-GHL01 */
  if(store.get('TaskTemplates','TPL-R1A-GHL01')){_r1aFixtureRetire(store,'TaskTemplates','TPL-R1A-GHL01');retired.templates.push('TPL-R1A-GHL01');}
  store.list('Tasks').filter(function(t){return t.job_id===jobId&&t.template_code==='GHL01';}).forEach(function(t){
    store.list('TaskEvents').filter(function(e){return e.task_id===t.id;}).forEach(function(e){_r1aFixtureRetire(store,'TaskEvents',e.id);retired.task_events.push(e.id);});
    _r1aFixtureRetire(store,'Tasks',t.id);retired.tasks.push(t.id);
  });
  if(store.get('Tasks',ghlTaskId)){_r1aFixtureRetire(store,'Tasks',ghlTaskId);retired.tasks.push(ghlTaskId);}
  store.list('GHLTasks').filter(function(g){return g.job_id===jobId;}).forEach(function(g){_r1aFixtureRetire(store,'GHLTasks',g.id);retired.ghl_tasks.push(g.id);});
  if(store.get('GHLTasks',ghlRowId)){_r1aFixtureRetire(store,'GHLTasks',ghlRowId);retired.ghl_tasks.push(ghlRowId);}
  store.list('AuditEvents').filter(function(a){return a.entity_id===jobId&&(a.action==='OperationalComplete'||(a.executing_service&&String(a.executing_service).indexOf('R1 AppSheet/S10')===0)||(a.commit_id&&String(a.commit_id).indexOf('R1A-')===0));}).forEach(function(a){_r1aFixtureRetire(store,'AuditEvents',a.id);retired.audit.push(a.id);});
  store.list('CommitJournal').filter(function(j){return j.entity_id===jobId||(j.command_id&&String(j.command_id).indexOf('R1A-OPC')===0)||(j.commit_id&&String(j.commit_id).indexOf('R1A-')===0&&j.entity_type==='Jobs'&&j.entity_id===jobId);}).forEach(function(j){_r1aFixtureRetire(store,'CommitJournal',j.id);retired.journal.push(j.id);});
  store.list('Outbox').filter(function(o){return o.correlation_id&&String(o.correlation_id).indexOf(jobId)>=0;}).forEach(function(o){_r1aFixtureRetire(store,'Outbox',o.id);});
  return retired;
}

function _r1aPrepareOperationalCompleteFixture(store){
  var n='2026-11-11T12:00:00.000Z',jobId='J-r1a-opcomplete';
  var retired=_r1aResetOperationalCompleteSynthetic(store);
  var ghlTpl=store.list('TaskTemplates').filter(function(t){return t.template_code==='GHL01'&&t.active===true;});
  if(ghlTpl.length!==1||ghlTpl[0].id!=='TPL-GHL01'){
    return {pass:false,detail:{job_id:jobId,error:'EXPECTED_SINGLE_TPL_GHL01',found:ghlTpl.map(function(t){return t.id;}),retired:retired}};
  }
  var jobRow={id:jobId,job_id:'SS-R1A-OPC',customer_id:'CUST-r1a-opc',display_name:'R1A Operational Complete DEV',sold_submission_id:'R1A-sold-opc',booking_submission_id:'R1A-booking-opc',sold_at:n,salesperson_id:null,lead_source:'R1A',quote_reference:'Q-R1A-OPC',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-R1A-OPC',contract_signed_at:n,contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:n,customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:n,deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'R1A-DEP',roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Aftercare',booking_approved_at:n,booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:'2026-11-09T10:00:00.000Z',customer_happy_by:'PERSON-tanya',handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:n,account_policy_version:null,pilot_job:true,release_scope:'R1',created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',source_record_id:null,commit_id:'R1A-OPC'};
  _r1aFixtureUpsert(store,'Jobs',jobRow);
  _r1aFixtureUpsert(store,'WorkPackages',{id:'WP-r1a-opc-roof',job_id:jobId,trade:'Roof',required:true,planned_start:'2026-11-05',planned_end:'2026-11-06',actual_start:'2026-11-05',actual_end:'2026-11-06',status:'ConfirmedComplete',completion_outcome:'Complete',installer_confirmation_at:'2026-11-09T10:00:00.000Z',installer_confirmation_by:'PERSON-tanya',commissioning_required:true,sequence:1,revision:1,created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',commit_id:'R1A-OPC'});
  _r1aFixtureUpsert(store,'Allocations',{id:'ALLOC-r1a-opc',work_package_id:'WP-r1a-opc-roof',person_id:'PERSON-installer-a',role:'Lead',active:true,created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',commit_id:'R1A-OPC'});
  _r1aFixtureUpsert(store,'CommissioningSubmissions',{id:'CS-r1a-opc',job_id:jobId,work_package_id:'WP-r1a-opc-roof',allocation_id:'ALLOC-r1a-opc',installer_id:'PERSON-installer-a',template_version:'R1A-sample',status:'Accepted',submitted_at:'2026-11-09T09:00:00.000Z',reviewed_at:'2026-11-09T10:00:00.000Z',reviewed_by:'PERSON-tanya',review_notes:'R1A synthetic accepted',created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,commit_id:'R1A-OPC'});
  _r1aFixtureUpsert(store,'Tasks',{id:'TASK-r1a-opc-access',job_id:jobId,template_code:'R1A-ACCESS',instance_key:'R1A-OPC-ACCESS',group:'Aftercare',title:'R1A office access (DEV)',owner_id:'PERSON-tanya',backup_id:null,related_entity_type:'Jobs',related_entity_id:jobId,due_at:n,original_due_at:n,priority:2,status:'Open',blocking_reason:null,next_followup_at:null,completed_at:null,completed_by:null,completion_note:null,evidence_id:null,revision_required:false,created_rule_version:'R1A-1.0',created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',commit_id:'R1A-OPC'});
  var job=store.get('Jobs',jobId);
  var ghlLeft=store.list('Tasks').filter(function(t){return t.job_id===jobId&&t.template_code==='GHL01';}).length;
  var ghlRows=store.list('GHLTasks').filter(function(g){return g.job_id===jobId;}).length;
  var pass=!!job&&Number(job.version)===1&&!job.operational_complete_at&&job.workflow_stage==='Aftercare'&&job.pilot_job===true&&!!store.get('WorkPackages','WP-r1a-opc-roof')&&ghlLeft===0&&ghlRows===0;
  return {pass:pass,detail:{job_id:jobId,expected_version:job?Number(job.version):null,retired:retired,ghl01_tasks_remaining:ghlLeft,ghl_rows_remaining:ghlRows}};
}

function runR1APrepareOperationalCompleteFixture(){
  var store=_r1aCloudOptions().store;
  var out=_r1aPrepareOperationalCompleteFixture(store);
  return _r1aFixtureResult('R1A operational-complete fixture',out.pass,out.detail);
}

/* Reset ONLY J-r1a-booking namespaced synthetic state left by prior BOOKING_GATES attempts. */
function _r1aResetBookingGatesSynthetic(store){
  var jobId='J-r1a-booking',retired={tasks:[],audit:[],journal:[],task_events:[],outbox:[]};
  store.list('Tasks').filter(function(t){return t.job_id===jobId;}).forEach(function(t){
    store.list('TaskEvents').filter(function(e){return e.task_id===t.id;}).forEach(function(e){_r1aFixtureRetire(store,'TaskEvents',e.id);retired.task_events.push(e.id);});
    _r1aFixtureRetire(store,'Tasks',t.id);retired.tasks.push(t.id);
  });
  store.list('AuditEvents').filter(function(a){return a.entity_id===jobId&&(a.action==='BookingGates'||(a.executing_service&&String(a.executing_service).indexOf('R1 AppSheet/S06')===0)||(a.commit_id&&String(a.commit_id).indexOf('R1A-')===0));}).forEach(function(a){_r1aFixtureRetire(store,'AuditEvents',a.id);retired.audit.push(a.id);});
  store.list('CommitJournal').filter(function(j){return j.entity_id===jobId||(j.command_id&&String(j.command_id).indexOf('R1A-BKG')===0);}).forEach(function(j){_r1aFixtureRetire(store,'CommitJournal',j.id);retired.journal.push(j.id);});
  store.list('Outbox').filter(function(o){return (o.correlation_id&&String(o.correlation_id).indexOf(jobId)>=0)||(o.job_id===jobId);}).forEach(function(o){_r1aFixtureRetire(store,'Outbox',o.id);retired.outbox.push(o.id);});
  return retired;
}

function _r1aPrepareBookingGatesFixture(store){
  var n='2026-09-06T00:00:00.000Z',jobId='J-r1a-booking';
  var retired=_r1aResetBookingGatesSynthetic(store);
  _r1aFixtureUpsert(store,'Customers',{id:'CUST-r1a-bkg',first_name:'R1A',last_name:'Booking',address_line1:'1 Pilot Lane',address_line2:'',town:'Testville',postcode:'TS1 1AA',email:'r1a-booking@test.example.invalid',phone:'07000000000',alternate_contact:null,contact_notes:null,created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',source_record_id:null,commit_id:'R1A-BKG'});
  var jobRow={id:jobId,job_id:'SS-R1A-BKG',customer_id:'CUST-r1a-bkg',display_name:'R1A Booking Gates DEV',sold_submission_id:'R1A-sold-bkg',booking_submission_id:'R1A-booking-bkg',sold_at:n,salesperson_id:null,lead_source:'R1A',quote_reference:'Q-R1A-BKG',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-R1A-BKG',contract_signed_at:n,contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:n,customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:n,deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'R1A-BKG-DEP',roof_required:false,electrical_required:false,scaffold_required:false,workflow_stage:'BookingInProgress',booking_approved_at:null,booking_approved_by:null,operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:n,account_policy_version:null,pilot_job:true,release_scope:'R1',created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',source_record_id:null,commit_id:'R1A-BKG'};
  _r1aFixtureUpsert(store,'Jobs',jobRow);
  _r1aFixtureUpsert(store,'Tasks',{id:'TASK-r1a-bkg-access',job_id:jobId,template_code:'R1A-ACCESS',instance_key:'R1A-BKG-ACCESS',group:'Booking',title:'R1A office access (DEV)',owner_id:'PERSON-tanya',backup_id:null,related_entity_type:'Jobs',related_entity_id:jobId,due_at:n,original_due_at:n,priority:2,status:'Open',blocking_reason:null,next_followup_at:null,completed_at:null,completed_by:null,completion_note:null,evidence_id:null,revision_required:false,created_rule_version:'R1A-1.0',created_at:n,created_by:'R1A-fixture',updated_at:n,updated_by:'R1A-fixture',version:1,source_system:'R1A-fixture',commit_id:'R1A-BKG'});
  var job=store.get('Jobs',jobId),cust=store.get('Customers','CUST-r1a-bkg');
  var gateTasks=store.list('Tasks').filter(function(t){return t.job_id===jobId&&t.id!=='TASK-r1a-bkg-access';});
  var pass=!!job&&!!cust&&Number(job.version)===1&&job.pilot_job===true&&job.release_scope==='R1'&&job.workflow_stage==='BookingInProgress'&&!job.booking_approved_at&&!!job.sold_submission_id&&!!job.booking_submission_id&&job.sold_booking_match_status==='Match'&&!!job.deposit_bank_confirmed_at&&job.finance_route==='Standard'&&job.contract_status==='Signed'&&typeof job.original_gross_pence==='number'&&job.original_gross_pence>0&&gateTasks.length===0;
  return {pass:pass,detail:{job_id:jobId,expected_version:job?Number(job.version):null,retired:retired,gate_tasks_remaining:gateTasks.length}};
}

function runR1APrepareBookingGatesFixture(){
  var store=_r1aCloudOptions().store;
  var out=_r1aPrepareBookingGatesFixture(store);
  return _r1aFixtureResult('R1A booking-gates fixture',out.pass,out.detail);
}

if(typeof module!=='undefined')module.exports={_r1aPrepareOperationalCompleteFixture:_r1aPrepareOperationalCompleteFixture,_r1aResetOperationalCompleteSynthetic:_r1aResetOperationalCompleteSynthetic,_r1aPrepareBookingGatesFixture:_r1aPrepareBookingGatesFixture,_r1aResetBookingGatesSynthetic:_r1aResetBookingGatesSynthetic,_r1aFixtureUpsert:_r1aFixtureUpsert,_r1aFixtureRetire:_r1aFixtureRetire};
