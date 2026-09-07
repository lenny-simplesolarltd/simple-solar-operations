/* Minimal synthetic fixture; source-specific template codes, not invented spec IDs. */
const S15_TITLES={
 'S15-CAN-CUSTOMER':'Notify customer using reviewed cancellation message',
 'S15-CAN-INSTALLER':'Notify installer and cancel future commitment',
 'S15-CAN-MERCHANT':'Merchant confirmed latest cancellation and goods disposition',
 'S15-CAN-SCAFFOLD':'Scaffolder acknowledged cancellation',
 'S15-CAN-STRIP':'Arrange safe strip and confirm actual removal',
 'S15-CAN-CALENDAR':'Reconcile Calendar removal using retained event ID',
 'S15-CAN-STOCK':'Review goods: receive, hold, return or reallocate; retain actual cost',
 'S15-CAN-XERO':'Review/cancel Xero invoice',
 'S15-CAN-FINANCE':'Review finance obligations and existing payment route',
 'S15-CAN-SIGNABLE':'Cancel/amend Signable contract with evidence',
 'S15-CAN-PHOENIX':'Review Phoenix agreement and evidence obligations',
 'S15-CAN-GHL':'Record human GHL cancellation stage action',
 'S15-CAN-SALES':'Notify salesperson of cancellation',
 'S15-CAN-LEGACY':'Close retained paper, Trello and whiteboard records',
 'S15-CAN-REVIEW':'Review partial work, retained evidence and unresolved obligations',
 'S15-REOPEN-REVIEW':'Review fresh planning and invoice/order reuse before booking'
};
function _s15FixtureRows(){
 const n='2026-11-01T12:00:00.000Z', base={created_at:n,created_by:'S15',updated_at:n,updated_by:'S15',version:1,source_system:'S15-fixture',commit_id:'S15-fixture'};
 return {
  Jobs:[Object.assign({},base,{id:'J-s15-clean',job_id:'SS-S15C-LEAN',display_name:'S15 Synthetic',customer_id:'CUST-s15',workflow_stage:'Booked',finance_route:'Standard',contract_status:'NotSent',pilot_job:true,release_scope:'R1',roof_required:true,electrical_required:false,scaffold_required:false,handover_status:'NotReady',financial_status:'Pending'})],
  WorkPackages:[Object.assign({},base,{id:'WP-s15-roof',job_id:'J-s15-clean',trade:'Roof',required:true,status:'Scheduled',planned_start:'2026-11-16',planned_end:'2026-11-16',revision:1,sequence:1,commissioning_required:true})],
  Allocations:[Object.assign({},base,{id:'ALLOC-s15-roof',work_package_id:'WP-s15-roof',person_id:'PERSON-s15-installer',role:'Lead',active:true,start_at:'2026-11-16',end_at:'2026-11-16'})],
  Tasks:[Object.assign({},base,{id:'TASK-s15-booking',job_id:'J-s15-clean',template_code:'BKG04',instance_key:'S15-booking',group:'Booking',title:'Send synthetic booking notice',owner_id:'PERSON-s15-office',related_entity_type:'Jobs',related_entity_id:'J-s15-clean',status:'Open'})],
  People:[Object.assign({},base,{id:'PERSON-s15-office',email:'s15-office@dev.example.invalid',display_name:'S15 Synthetic Office',role:'Office',active:true}),Object.assign({},base,{id:'PERSON-s15-installer',email:'s15-installer@dev.example.invalid',display_name:'S15 Synthetic Installer',role:'Installer',active:true})],
  TaskTemplates:Object.keys(S15_TITLES).map(code=>Object.assign({},base,{source_system:undefined,id:'TPL-'+code,template_code:code,title:S15_TITLES[code],group:'Cancellation',default_owner_role:'Office',trigger_event:code==='S15-REOPEN-REVIEW'?'S15 reinstatement':'S15 cancellation',due_rule:'Cancellation review now',evidence_required:'Reviewed outcome reference; confirmations must match latest entity revision',active:true,template_version:'S15-1.0'}))
 };
}
function _s15Seed(store){
 const rows=_s15FixtureRows();
 for(const r of rows.TaskTemplates)delete r.source_system;
 // Preflight all collisions before writing; partial fixture writes can be retried.
 for(const table of Object.keys(rows)) for(const row of rows[table]) {const old=store.get(table,row.id);if(old&&old.created_by!=='S15')throw new Error('S15_REFUSED: fixture ID collision '+row.id);}
 for(const table of Object.keys(rows)) for(const row of rows[table]) if(!store.get(table,row.id))store.insert(table,row);
}
function _s15CancelInput(){return{command_id:'S15-CLOUD-CANCEL',job_id:'J-s15-clean',actor:'PERSON-s15-office',reason:'Synthetic pre-install cancellation',expected_version:1,effective_date:'2026-11-02',work_performed:'None',material_state:'None',scaffold_state:'None',finance_review:'Synthetic fixture has no invoices or payments',legacy_state:'None'};}
function _s15Smoke(store,execute){
 const input=_s15CancelInput();execute('Cancel',input,store);execute('Cancel',input,store);
 const pending=store.list('Tasks').filter(t=>t.job_id===input.job_id&&t.group==='Cancellation'&&t.template_code!=='S15-REOPEN-REVIEW');
 const close={command_id:'S15-CLOUD-CLOSE',job_id:input.job_id,actor:input.actor,reason:'Synthetic obligations explicitly tracked; no external completion claimed',expected_version:2,tracked_obligations:pending.map(t=>({task_id:t.id,reference:'S15-SYNTHETIC-TRACKING',reason:'Retained owned test obligation; no actual customer or external commitment'}))};
 execute('Close',close,store);
 const reopen={command_id:'S15-CLOUD-REOPEN',job_id:input.job_id,actor:input.actor,reason:'Synthetic controlled reopen',expected_version:3,new_date:'2026-11-23',commitment_review:'No orders/events in clean synthetic fixture; fresh unallocated package only',finance_review:'No synthetic invoices/payments; existing route remains review-only',evidence_reference:'S15-SYNTHETIC-REVIEW'};
 execute('Reinstate',reopen,store);execute('Reinstate',reopen,store);
 const j=store.get('Jobs',input.job_id),wp=store.list('WorkPackages').filter(w=>w.job_id===j.id),journals=store.list('CommitJournal').filter(c=>c.entity_id===j.id);
 const pass=j.workflow_stage==='Prebooking'&&j.version===4&&wp.length===2&&store.get('WorkPackages','WP-s15-roof').status==='Cancelled'&&store.get('Allocations','ALLOC-s15-roof').active===false&&store.get('Tasks','TASK-s15-booking').status==='Cancelled'&&journals.length===3&&journals.every(c=>c.state==='Committed')&&store.list('AuditEvents').some(a=>a.action==='S15Cancel'&&a.entity_id===j.id)&&store.list('InvoiceStages').filter(s=>s.job_id===j.id).length===0;
 return {pass,detail:{job_stage:j.workflow_stage,job_version:j.version,packages:wp.length,journals:journals.length,external_calls:0}};
}
if(typeof module!=='undefined')module.exports={S15_TITLES,_s15FixtureRows,_s15Seed,_s15CancelInput,_s15Smoke};
