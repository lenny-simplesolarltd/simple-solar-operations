/* S15 DEV synthetic cancellation. Authority: 01 §7, 02 §13, 04 S15, RA01 §5–6.
 * Durable plans use canonical CommitJournal/AuditEvents. No outbound dispatcher. */
'use strict';
const S15_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const S15_FUNCTIONS = {'FN-01':['R1','Automated'],'FN-02':['R2','Automated'],'FN-03':['R2','Automated'],'FN-04':['R2','Automated'],'FN-05':['R2','Automated'],'FN-06':['R3','Automated'],'FN-07':['R3','Automated'],'FN-08':['R3','Automated'],'FN-09':['R4','Automated'],'FN-10':['R4','Manual'],'FN-11':['R1','Manual'],'FN-12':['R4','Automated'],'FN-17':['R1','Manual'],'FN-20':['R1','Manual']};
const S15_ENABLED = ['FN-01','FN-17','FN-20'];
function _s15Copy(x) { return JSON.parse(JSON.stringify(x)); }
function _s15Text(x) { return typeof x === 'string' && x.trim().length > 0; }
function _s15Date(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value + 'T12:00:00Z');
    if (!isNaN(d.getTime()) && d.toISOString().slice(0,10) === value) return value;
  } else if (Object.prototype.toString.call(value) === '[object Date]' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d,'Europe/London','yyyy-MM-dd') : new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  }
  throw new Error('S15_DATE_INVALID');
}
function _s15GuardStore(store) {
  if (!store.getSheetId || store.getSheetId() !== S15_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') throw new Error('S15_REFUSED: exact DEV sheet/environment required');
}
function _s15ModesSnapshot(store) {
  const result = {};
  for (const id of Object.keys(S15_FUNCTIONS)) {
    const rows = store.list('ReleaseModes').filter(r=>r.function_id===id), def=S15_FUNCTIONS[id];
    if (rows.length!==1 || rows[0].target_release!==def[0] || !['Disabled','Manual','Automated'].includes(rows[0].mode) || !['None','Pilot','All'].includes(rows[0].authorised_job_scope)) throw new Error('S15_REFUSED: ReleaseMode '+id);
    const r=rows[0];
    if ((r.mode==='Disabled') !== (r.authorised_job_scope==='None') || (def[1]==='Manual' && r.mode==='Automated')) throw new Error('S15_REFUSED: unexpected mode '+id);
    result[id]={mode:r.mode,scope:r.authorised_job_scope,target_release:r.target_release};
  }
  return result;
}
function _s15Scope(store,input) {
  _s15GuardStore(store);
  const job=store.get('Jobs',input.job_id), modes=_s15ModesSnapshot(store);
  if (!job || job.pilot_job!==true || !/^S15-fixture$/.test(job.source_system||'') || !/^J-s15-/.test(job.id) || !['R1','R2','R3','R4'].includes(job.release_scope)) throw new Error('S15_REFUSED: synthetic S15 pilot required');
  for (const id of S15_ENABLED) if(modes[id].mode!==S15_FUNCTIONS[id][1] || modes[id].scope!=='Pilot') throw new Error('S15_REFUSED: '+id+' pilot mode');
  const actor=store.get('People',input.actor);
  const roles=store.list('PersonRoles').filter(r=>r.person_id===input.actor&&r.active===true).map(r=>r.role);
  if(!actor || actor.active!==true || ![actor.role].concat(roles).some(r=>['Admin','Office','Manager'].includes(r))) throw new Error('S15_REFUSED: authenticated office actor required');
  if(!_s15Text(input.command_id)||!/^[-A-Za-z0-9]+$/.test(input.command_id)||!_s15Text(input.reason)) throw new Error('S15_REVIEW: command identity and reason required');
  return {job,modes};
}
function _s15Related(store,jobId) {
  const tables=['WorkPackages','Materials','Orders','ScaffoldBookings','InvoiceStages','StockMovements','CommissioningSubmissions','JobEquipment','Handover','Issues','Tasks','CalendarLinks','Communications','GHLTasks','JobCosts'];
  const rows={}; for(const t of tables) rows[t]=store.list(t).filter(r=>r.job_id===jobId);
  rows.Allocations=store.list('Allocations').filter(r=>rows.WorkPackages.some(w=>w.id===r.work_package_id));
  rows.Reservations=store.list('Reservations').filter(r=>rows.Materials.some(m=>m.id===r.material_id));
  rows.OrderLines=store.list('OrderLines').filter(r=>rows.Orders.some(o=>o.id===r.order_id));
  rows.Payments=store.list('Payments').filter(r=>rows.InvoiceStages.some(s=>s.id===r.invoice_stage_id));
  rows.CommunicationJobs=store.list('CommunicationJobs').filter(r=>r.job_id===jobId);
  const communicationIds=rows.CommunicationJobs.map(r=>r.communication_id);
  rows.Communications=store.list('Communications').filter(r=>r.job_id===jobId||communicationIds.includes(r.id));
  rows.ReceiptLines=store.list('ReceiptLines').filter(r=>rows.OrderLines.some(l=>l.id===r.order_line_id));
  const outIds=rows.CalendarLinks.concat(rows.Communications).map(r=>r.outbox_id).filter(Boolean);
  rows.Outbox=store.list('Outbox').filter(o=>outIds.includes(o.id)||rows.InvoiceStages.some(s=>o.correlation_id==='XI-'+jobId+'-'+s.stage)||o.correlation_id===jobId||rows.Orders.some(r=>r.id===o.correlation_id)||rows.ScaffoldBookings.some(r=>r.id===o.correlation_id)||rows.WorkPackages.some(r=>r.id===o.correlation_id));
  return rows;
}
function _s15Preview(input,store) {
  const scope=_s15Scope(store,input), rows=_s15Related(store,input.job_id);
  const risks=[];
  if(scope.job.operational_complete_at) risks.push('OPERATIONALLY_COMPLETE');
  if(rows.WorkPackages.some(w=>w.actual_start||w.actual_end||!['Unscheduled','Scheduled','Cancelled'].includes(w.status))) risks.push('WORK_PERFORMED_OR_UNCERTAIN');
  if(rows.Payments.length || scope.job.deposit_bank_confirmed_at) risks.push('PAYMENT_REVIEW');
  if(rows.InvoiceStages.some(s=>s.stage==='final')) risks.push('FINAL_INVOICE_REVIEW');
  if(rows.ScaffoldBookings.some(s=>s.erect_actual_at&&!s.strip_actual_at)) risks.push('SAFE_STRIP_REQUIRED');
  if(rows.StockMovements.length||rows.Reservations.some(r=>Number(r.picked_quantity)>0||r.status==='Issued')) risks.push('PHYSICAL_STOCK_REVIEW');
  if(rows.CommissioningSubmissions.length||rows.Handover.length) risks.push('EVIDENCE_HANDOVER_REVIEW');
  return {job:scope.job,modes:scope.modes,rows,risks};
}
function _s15Plan(input,store,kind) {
  const preview=_s15Preview(input,store), job=preview.job, now=new Date().toISOString(), commit='S15-'+input.command_id, ops=[];
  function patch(table,row,values) {
    const after=Object.assign({},values);
    if('version' in row) Object.assign(after,{version:Number(row.version||0)+1,updated_at:now,updated_by:input.actor});
    if('commit_id' in row) after.commit_id=commit;
    ops.push({table,id:row.id,before:_s15Copy(row),patch:after});
  }
  function insert(table,row) {ops.push({table,id:row.id,before:null,insert:row});}
  const owner=store.list('People').filter(p=>p.active===true&&p.role==='Office'&&p.id==='PERSON-s15-office')[0];
  if(!owner) throw new Error('S15_NOT_CONFIGURED: synthetic office owner');
  function task(code,table,id,title,blocking) {
    const tpl=store.list('TaskTemplates').find(t=>t.template_code===code&&t.active===true);
    if(!tpl) throw new Error('S15_NOT_CONFIGURED: '+code);
    const key=commit+'-'+code+'-'+id, tid='TASK-'+key;
    insert('Tasks',{id:tid,job_id:job.id,template_code:code,instance_key:key,group:'Cancellation',title:title||tpl.title,owner_id:owner.id,backup_id:input.actor,related_entity_type:table,related_entity_id:id,due_at:now,original_due_at:now,priority:1,status:blocking?'Blocked':'Open',blocking_reason:blocking||null,completion_note:null,evidence_id:null,revision_required:true,created_rule_version:'S15-1.0',created_at:now,created_by:input.actor,updated_at:now,updated_by:input.actor,version:1,source_system:'S15',commit_id:commit});
    return tid;
  }
  const rows=preview.rows;
  if(kind==='Cancel') {
    if(['Cancelled','CancellationInProgress'].includes(job.workflow_stage)) throw new Error('S15_REVIEW: cancellation already started; replay original command');
    for(const field of ['work_performed','material_state','scaffold_state','finance_review','legacy_state']) if(!_s15Text(input[field])) throw new Error('S15_REVIEW: '+field+' required');
    const date=_s15Date(input.effective_date);
    patch('Jobs',job,{workflow_stage:'CancellationInProgress',cancellation_at:date,cancellation_by:input.actor,cancellation_reason:input.reason});
    for(const w of rows.WorkPackages) {
      if(['Unscheduled','Scheduled'].includes(w.status)&&!w.actual_start&&!w.actual_end&&!w.installer_confirmation_at) patch('WorkPackages',w,{status:'Cancelled',revision:Number(w.revision||0)+1});
      else if(w.status!=='Cancelled') task('S15-CAN-REVIEW','WorkPackages',w.id,'Review performed work and retained commissioning responsibility','Review');
    }
    for(const a of rows.Allocations.filter(a=>a.active===true)) {
      // Deactivate future/unfinished commitment, retaining actual package/person history.
      if(!a.end_at || _s15Date(a.end_at)>=date) patch('Allocations',a,{active:false,cancellation_reason:input.reason});
      task('S15-CAN-INSTALLER','Allocations',a.id);
    }
    const normalCodes=['PRE01','PRE02','BKG01','BKG04','MAT01','MAT05','FIN01','FIN03','GHL01','S13-GHL-PROGRESSION','S08-PICK-STOCK','SCA01'];
    for(const t of rows.Tasks) if(['Open','Waiting','InProgress','Blocked'].includes(t.status) && t.group!=='Cancellation' && t.related_entity_type!=='Issues' && (normalCodes.includes(t.template_code)||rows.GHLTasks.some(g=>g.task_id===t.id)||(['Prebooking','Booking'].includes(t.group)))) patch('Tasks',t,{status:'Cancelled',completion_note:input.reason});
    for(const m of rows.Materials) patch('Materials',m,{cancelled_quantity:Number(m.required_quantity||0),revision:Number(m.revision||0)+1});
    for(const r of rows.Reservations) {
      if(r.status==='Active'&&!r.picked_at&&!Number(r.picked_quantity)) patch('Reservations',r,{status:'Released'});
      else if(!['Released','Cancelled'].includes(r.status)) task('S15-CAN-STOCK','Reservations',r.id,undefined,'Review: physical goods; no automatic reversal');
    }
    for(const o of rows.Orders) {
      if(o.status==='Cancelled') continue;
      const draft=o.status==='Draft'&&!o.sent_message_id&&!o.supplier_reference&&!o.confirmed_at&&!rows.ReceiptLines.some(r=>rows.OrderLines.some(l=>l.id===r.order_line_id&&l.order_id===o.id));
      patch('Orders',o,{status:draft?'Cancelled':'Review',revision:Number(o.revision||0)+1});
      if(!draft) task('S15-CAN-MERCHANT','Orders',o.id,'Merchant confirmed latest cancellation / receive, hold, return or credit goods','Review: latest revision acknowledgement required');
    }
    if(rows.StockMovements.length||input.material_state!=='None') task('S15-CAN-STOCK','Jobs',job.id,undefined,'Review: preserve actual movements and costs');
    for(const b of rows.ScaffoldBookings) if(b.status!=='Cancelled'&&!b.strip_actual_at) {
      patch('ScaffoldBookings',b,{revision:Number(b.revision||0)+1});
      task(b.erect_actual_at?'S15-CAN-STRIP':'S15-CAN-SCAFFOLD','ScaffoldBookings',b.id,undefined,'Review: acknowledgement / actual safe removal required');
    }
    if(input.scaffold_state!=='None'&&!rows.ScaffoldBookings.length)task('S15-CAN-REVIEW','Jobs',job.id,'Reconcile external scaffold commitment','Review');
    for(const link of rows.CalendarLinks) {
      const outId='OUT-'+commit+'-'+link.id;
      patch('CalendarLinks',link,{status:'Error',error:'S15 cancellation removal requires reconciliation',entity_revision:Number(link.entity_revision||0)+1,outbox_id:outId});
      insert('Outbox',{id:outId,idempotency_key:outId,action_type:'CalendarCancel',target:link.calendar_id||'NOT_CONFIGURED',payload_hash:JSON.stringify({calendar_link_id:link.id,action:'Cancel',external_event_id:link.external_event_id||null}),job_revision:Number(job.version)+1,attempt_count:0,next_attempt:null,external_id:link.external_event_id||null,response_summary:'CAPTURE_ONLY / Review: external removal unconfirmed',correlation_id:job.id,status:'NeedsReview',created_at:now,commit_id:commit});
      task('S15-CAN-CALENDAR','CalendarLinks',link.id,undefined,'Review: external removal unconfirmed');
    }
    for(const o of rows.Outbox) if(!['Succeeded','Cancelled'].includes(o.status)) patch('Outbox',o,{status:Number(o.attempt_count||0)===0&&!o.external_id&&o.status==='Pending'?'Cancelled':'NeedsReview',next_attempt:null,response_summary:'S15 stopped normal action; reconcile uncertain sends before any retry'});
    for(const o of rows.Outbox) if(!['Succeeded','Cancelled'].includes(o.status)&&!(Number(o.attempt_count||0)===0&&!o.external_id&&o.status==='Pending')) task('S15-CAN-REVIEW','Outbox',o.id,'Reconcile uncertain normal send','Review');
    for(const c of rows.Communications) if(['Draft','Approved','Queued'].includes(c.status)) patch('Communications',c,{status:'Failed'});
    for(const inv of rows.InvoiceStages) task('S15-CAN-XERO','InvoiceStages',inv.id,'Review/cancel Xero invoice ('+(inv.source_status||inv.status||'unknown')+')','NOT_CONFIGURED: accounting action policy');
    if(!rows.InvoiceStages.length) task('S15-CAN-FINANCE','Jobs',job.id,'Review existing finance route, payment receipts, fees and refunds');
    if(job.contract_id||job.contract_status==='Signed') task('S15-CAN-SIGNABLE','Jobs',job.id);
    if(job.finance_route==='Phoenix') task('S15-CAN-PHOENIX','Jobs',job.id,undefined,'NOT_CONFIGURED: agreement/evidence policy');
    task('S15-CAN-CUSTOMER','Jobs',job.id);
    task('S15-CAN-SALES','Jobs',job.id);
    if(input.legacy_state!=='None') task('S15-CAN-LEGACY','Jobs',job.id);
    const tid=task('S15-CAN-GHL','Jobs',job.id,undefined,'NOT_CONFIGURED: GHL cancellation IDs');
    insert('GHLTasks',{id:'GHL-'+commit,job_id:job.id,task_id:tid,opportunity_id:null,target_pipeline_id:null,target_stage_id:null,template_id:null,readiness_snapshot:JSON.stringify({action:'Cancellation',revision:Number(job.version)+1,mode:preview.modes['FN-17'],configuration:'NOT_CONFIGURED'}),created_at:now,commit_id:commit});
    if(preview.risks.length) task('S15-CAN-REVIEW','Jobs',job.id,'Review late/partial cancellation: '+preview.risks.join(', '),'Review');
    for(const extra of store.list('TaskTemplates').filter(t=>t.active===true&&t.trigger_event==='S15 cancellation extra')) task(extra.template_code,'Jobs',job.id);
  } else if(kind==='Resolve') {
    if(!['CancellationInProgress','Cancelled'].includes(job.workflow_stage)) throw new Error('S15_REVIEW: cancellation not active');
    const t=rows.Tasks.find(t=>t.id===input.task_id&&t.group==='Cancellation');
    if(!t||!['Open','Blocked','Waiting','InProgress'].includes(t.status)||!_s15Text(input.evidence_reference)) throw new Error('S15_REVIEW: open cancellation task and evidence required');
    if(t.template_code==='S15-CAN-GHL') {
      const g=rows.GHLTasks.find(g=>g.task_id===t.id);
      if(!g||!g.opportunity_id||!g.target_pipeline_id||!g.target_stage_id||[g.opportunity_id,g.target_pipeline_id,g.target_stage_id].includes('NOT_CONFIGURED'))throw new Error('S15_NOT_CONFIGURED: GHL cancellation IDs');
      patch('GHLTasks',g,{completed_at:now,completed_by:input.actor,evidence_reference:input.evidence_reference});
    }
    if(input.task_version!==Number(t.version)) throw new Error('S15_REVIEW: stale task revision');
    if(['S15-CAN-MERCHANT','S15-CAN-SCAFFOLD','S15-CAN-STRIP','S15-CAN-CALENDAR'].includes(t.template_code)) {
      const entity=store.get(t.related_entity_type,t.related_entity_id), revision=Number(entity.revision||entity.entity_revision||entity.version);
      if(input.confirmed_revision!==revision || input.outcome!=='Confirmed') throw new Error('S15_REVIEW: latest revision confirmation required; sent is not confirmed');
      if(t.template_code==='S15-CAN-MERCHANT') patch('Orders',entity,{status:'Cancelled',confirmed_revision:revision,confirmed_at:now,confirmed_by:input.actor});
      if(t.template_code==='S15-CAN-SCAFFOLD') patch('ScaffoldBookings',entity,{status:'Cancelled',confirmed_revision:revision});
      if(t.template_code==='S15-CAN-STRIP') patch('ScaffoldBookings',entity,{strip_actual_at:_s15Date(input.actual_date)});
      if(t.template_code==='S15-CAN-CALENDAR') {patch('CalendarLinks',entity,{status:'Cancelled',error:null,last_synced_revision:revision});const out=store.get('Outbox',entity.outbox_id);if(out)patch('Outbox',out,{status:'Cancelled',response_summary:'Manual external reconciliation: '+input.evidence_reference});}
    }
    patch('Tasks',t,{status:'Complete',completed_at:now,completed_by:input.actor,completion_note:input.reason+'; evidence: '+input.evidence_reference,revision_required:false,blocking_reason:null});
    patch('Jobs',job,{});
  } else if(kind==='Close') {
    if(job.workflow_stage!=='CancellationInProgress') throw new Error('S15_REVIEW: cancellation not in progress');
    const pending=rows.Tasks.filter(t=>t.group==='Cancellation'&&!['Complete','NotRequired'].includes(t.status));
    const tracked=input.tracked_obligations||[];
    for(const t of pending) {
      if(['S15-CAN-MERCHANT','S15-CAN-SCAFFOLD','S15-CAN-STRIP','S15-CAN-CALENDAR'].includes(t.template_code)) throw new Error('S15_REVIEW: confirmation outstanding '+t.id);
      const record=tracked.find(r=>r.task_id===t.id);
      if(!t.owner_id||!record||!_s15Text(record.reference)||!_s15Text(record.reason)) throw new Error('S15_REVIEW: unresolved obligation must be explicitly tracked '+t.id);
    }
    patch('Jobs',job,{workflow_stage:'Cancelled'});
  } else if(kind==='Reinstate') {
    if(job.workflow_stage!=='Cancelled') throw new Error('S15_REVIEW: only Cancelled can reopen');
    if(preview.risks.length&&!_s15Text(input.risk_review))throw new Error('S15_REVIEW: late/partial work requires explicit risk review');
    if(!_s15Text(input.commitment_review)||!_s15Text(input.finance_review)||!_s15Text(input.evidence_reference)) throw new Error('S15_REVIEW: commitments, invoice/order reuse and evidence review required');
    const newDate=_s15Date(input.new_date);
    if(newDate<=_s15Date(job.cancellation_at)) throw new Error('S15_REVIEW: fresh date after cancellation required');
    // Conservative controlled reopen: rerun booking gates, never resurrect commitments.
    patch('Jobs',job,{workflow_stage:'Prebooking',cancellation_at:null,cancellation_by:null,cancellation_reason:null,booking_approved_at:null,booking_approved_by:null,next_action_at:newDate});
    for(const w of rows.WorkPackages.filter(w=>w.status==='Cancelled'&&w.required===true)) {
      const id='WP-'+commit+'-'+w.id;
      insert('WorkPackages',{id,job_id:job.id,trade:w.trade,required:true,planned_start:newDate,planned_end:newDate,status:'Unscheduled',commissioning_required:w.commissioning_required,sequence:w.sequence,revision:Number(w.revision||0)+1,parent_package_id:w.id,created_at:now,created_by:input.actor,updated_at:now,updated_by:input.actor,version:1,source_system:'S15',commit_id:commit});
    }
    task('S15-REOPEN-REVIEW','Jobs',job.id,'Review fresh dates, booking gates, retained obligations and invoice/order reuse');
  } else throw new Error('S15_REVIEW: unknown command');
  return {kind,input:_s15Copy(input),modes:preview.modes,risks:preview.risks,ops,now,commit};
}
function _s15ApplyPlan(store,journal,plan) {
  store.update('CommitJournal',journal.id,{state:'Applying'});
  try {
    for(let i=0;i<plan.ops.length;i++) {
      const op=plan.ops[i],current=store.get(op.table,op.id), intended=op.insert||Object.assign({},op.before,op.patch);
      const keys=op.insert?Object.keys(op.insert):Object.keys(op.patch);
      const equal=(a,b,ks)=>ks.every(k=>{const av=a&&a[k],bv=b&&b[k];if(Object.prototype.toString.call(av)==='[object Date]'||Object.prototype.toString.call(bv)==='[object Date]'){if((typeof av==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(av))||(typeof bv==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(bv)))return _s15Date(av)===_s15Date(bv);return new Date(av).getTime()===new Date(bv).getTime();}return JSON.stringify(av===undefined?null:av)===JSON.stringify(bv===undefined?null:bv);});
      if(!current&&op.insert) store.insert(op.table,op.insert);
      else if(current&&equal(current,intended,keys)) { /* prior partial application verified */ }
      else if(current&&op.before&&equal(current,op.before,Object.keys(op.before))) store.update(op.table,op.id,op.patch);
      else throw new Error('S15_RECOVERY_REQUIRED: changed entity '+op.table+'/'+op.id);
      const aid='AE-'+plan.commit+'-'+i;
      if(!store.get('AuditEvents',aid)) store.insert('AuditEvents',{id:aid,entity_type:op.table,entity_id:op.id,action:'S15'+plan.kind,before_json:op.before?JSON.stringify(op.before):null,after_json:JSON.stringify(intended),initiating_actor:plan.input.actor,executing_service:'S15 DEV',timestamp:plan.now,correlation_id:plan.input.command_id,reason:plan.input.reason,commit_id:plan.commit,created_at:plan.now});
    }
    store.update('CommitJournal',journal.id,{state:'Committed',committed_at:plan.now});
  } catch(e) {store.update('CommitJournal',journal.id,{state:'RecoveryRequired'});throw e;}
  return {ok:true,status:store.get('Jobs',plan.input.job_id).workflow_stage,review:plan.risks.length>0,affected:plan.ops.length,external_calls:0};
}
function _s15Execute(kind,input,store) {
  // Store.withLock is required: cloud uses ScriptLock, local tests provide a lock model.
  if(!store.withLock) throw new Error('S15_REFUSED: lock adapter required');
  return store.withLock(function(){
    const scope=_s15Scope(store,input), id='CJ-S15-'+input.command_id, existing=store.get('CommitJournal',id);
    if(existing) {
      const plan=JSON.parse(existing.changes_json);
      if(plan.kind!==kind||JSON.stringify(plan.input)!==JSON.stringify(_s15Copy(input))) throw new Error('S15_REVIEW: conflicting command replay');
      if(existing.state==='Committed') return {ok:true,replay:true,status:scope.job.workflow_stage,external_calls:0};
      return _s15ApplyPlan(store,existing,plan);
    }
    if(store.list('CommitJournal').some(j=>j.entity_id===input.job_id&&j.state!=='Committed')) throw new Error('S15_RECOVERY_REQUIRED: pending job journal');
    if(input.expected_version!==Number(scope.job.version)) throw new Error('S15_REVIEW: stale job revision');
    const plan=_s15Plan(input,store,kind), journal={id,commit_id:plan.commit,state:'Prepared',command_id:input.command_id,entity_type:'Jobs',entity_id:input.job_id,expected_version:input.expected_version,changes_json:JSON.stringify(plan),prepared_at:plan.now,committed_at:null,created_at:plan.now};
    store.insert('CommitJournal',journal);
    return _s15ApplyPlan(store,journal,plan);
  });
}
function _s15SetModes(store,enable) {
  _s15GuardStore(store);
  return store.withLock(function(){
    const rows=S15_ENABLED.map(id=>{
      const a=store.list('ReleaseModes').filter(r=>r.function_id===id),d=S15_FUNCTIONS[id];
      if(a.length!==1||a[0].target_release!==d[0]||!((a[0].mode==='Disabled'&&a[0].authorised_job_scope==='None')||(a[0].mode===d[1]&&a[0].authorised_job_scope==='Pilot'))) throw new Error('S15_REFUSED: unexpected starting mode '+id);
      return a[0];
    });
    for(const r of rows) {
      const mode=enable?S15_FUNCTIONS[r.function_id][1]:'Disabled',scope=enable?'Pilot':'None';
      if(r.mode!==mode||r.authorised_job_scope!==scope) store.update('ReleaseModes',r.id,{mode,authorised_job_scope:scope,updated_at:new Date().toISOString(),updated_by:'S15-modes',version:Number(r.version||0)+1});
    }
    return {ok:true,enabled:enable,functions:S15_ENABLED};
  });
}
if(typeof module!=='undefined') module.exports={S15_DEV_SHEET_ID,S15_FUNCTIONS,S15_ENABLED,_s15Date,_s15Preview,_s15Execute,_s15SetModes};
