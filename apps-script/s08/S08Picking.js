/* S08 picking/stock — Apps Script entry points for the DEV bound project.
 * FN-05 governs stock/picking. Must be explicitly enabled.
 * No real external actions. DEV only. */

function _s08Guard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc') throw new Error('S08_REFUSED: wrong sheet');
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(props.getProperty('S01_CONFIG') || 'null');
  if (!config || config.environment !== 'DEV') throw new Error('S08_REFUSED: DEV only');
  return ss;
}

function _s08Find(ss, name) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) { if (sheets[i].getName() === name) return sheets[i]; }
  return null;
}

var _S8C = {
  Materials: ['id','job_id','work_package_id','product_id','description','required_quantity','unit','source','need_by_date','merchant_id','order_line_id','already_ordered_reference','notes','revision','cancelled_quantity','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  StockMovements: ['id','product_id','quantity','from_location_id','to_location_id','movement_type','job_id','receipt_line_id','reason','evidence_id','approval_id','movement_at','idempotency_key','created_at','commit_id'],
  Reservations: ['id','material_id','product_id','location_id','quantity','status','picked_quantity','picked_at','picked_by','created_at','created_by','updated_at','updated_by','version','commit_id'],
  StockLocations: ['id','name','type','job_id','usable','created_at','created_by','updated_at','updated_by','version','commit_id'],
  Products: ['id','sku','name','category','wattage','manufacturer','model','unit','unit_precision','stock_tracked','active','default_supplier_id','standard_lead_days','unit_cost_pence','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Jobs: ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  Tasks: ['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  People: ['id','email','display_name','role','active','calendar_id','notification_email','capacity_per_day','available_from','available_to','backup_person_id','company_id','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  PersonRoles: ['id','person_id','role','active','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  ReleaseModes: ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id']
};

function _s08Rd(ss, name) {
  var sheet = _s08Find(ss, name); if (!sheet) return [];
  var h = _S8C[name]; if (!h) return [];
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc === 0) return [];
  var v = sheet.getRange(2, 1, lr - 1, lc).getValues();
  var o = [];
  for (var r = 0; r < v.length; r++) { var rec = {}; for (var c = 0; c < h.length && c < v[r].length; c++) { var x = v[r][c]; rec[h[c]] = (x === '' || x === undefined || x === null) ? null : x; } o.push(rec); }
  return o;
}

function _s08Ins(ss, name, d) {
  var sheet = _s08Find(ss, name); if (!sheet) throw new Error('Tab: ' + name);
  var h = _S8C[name]; var tr = sheet.getLastRow() + 1;
  if (tr > sheet.getMaxRows()) throw new Error('CAPACITY: ' + name);
  var vals = h.map(function(k) { var v = d[k]; if (v === null || v === undefined) return ''; if (typeof v === 'string' && /^[=']/.test(v)) return "'" + v; return v; });
  sheet.getRange(tr, 1, 1, vals.length).setValues([vals]); SpreadsheetApp.flush();
}

function _s08Upd(ss, name, id, p) {
  var sheet = _s08Find(ss, name); if (!sheet) throw new Error('Tab: ' + name);
  var h = _S8C[name]; var rows = _s08Rd(ss, name), ri = -1;
  for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { ri = i + 2; break; } }
  if (ri < 0) throw new Error('Row: ' + name + ' ' + id);
  var cv = sheet.getRange(ri, 1, 1, h.length).getValues()[0];
  for (var k in p) { if (!p.hasOwnProperty(k)) continue; var idx = h.indexOf(k); if (idx >= 0) { var v = p[k]; if (typeof v === 'string' && /^[=']/.test(v)) v = "'" + v; cv[idx] = v !== null && v !== undefined ? v : ''; } }
  sheet.getRange(ri, 1, 1, cv.length).setValues([cv]); SpreadsheetApp.flush();
}

function _s08Store(ss) { return { getSheetId:function(){return ss.getId();}, list:function(n){return _s08Rd(ss,n);}, get:function(n,id){return _s08Rd(ss,n).filter(function(r){return r.id===id;})[0]||null;}, insert:function(n,d){_s08Ins(ss,n,d);}, update:function(n,id,p){_s08Upd(ss,n,id,p);} }; }
function _s08R(name, pass, detail) { var r = {test:name,pass:pass,detail:detail}; console.log(JSON.stringify(r,null,2)); return r; }

function runS08FixtureDryRun() {
  var ss = _s08Guard(), s = _s08Store(ss);
  var fn05 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-05';})[0];
  var r = { sheet_id:ss.getId(), products:s.list('Products').length, locations:s.list('StockLocations').length, movements:s.list('StockMovements').length, fn05_mode:fn05?fn05.mode:'missing', ready:s.list('Products').length>=1&&s.list('StockLocations').length>=1 };
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS08FixtureApply() {
  var ss = _s08Guard(), s = _s08Store(ss); var n = '2026-09-06T00:00:00.000Z';
  function ins(t,id,data) { if (!s.get(t,id)) s.insert(t,data); }
  ins('Products','PROD-P460',{id:'PROD-P460',sku:'P460',name:'460W Solar Panel',category:'Panel',wattage:460,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:14,unit_cost_pence:null,created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,source_system:'S08',commit_id:'S08'});
  ins('StockLocations','LOC-store',{id:'LOC-store',name:'Main Store',type:'Store',job_id:null,usable:true,created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,commit_id:'S08'});
  ins('StockLocations','LOC-jobsite',{id:'LOC-jobsite',name:'Job Site',type:'JobSite',job_id:null,usable:true,created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,commit_id:'S08'});
  var r = {applied:true,locations:s.list('StockLocations').length};
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS08FixtureValidate() {
  var ss = _s08Guard(), s = _s08Store(ss);
  var fn05 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-05';})[0];
  var r = { locations:s.list('StockLocations').length, fn05_mode:fn05?fn05.mode:'missing', fn05_ready:fn05&&fn05.mode==='Automated'&&fn05.authorised_job_scope==='Pilot', ready:s.list('StockLocations').length>=2 };
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS08EnableFn05ForSyntheticTest() {
  var ss = _s08Guard(), s = _s08Store(ss);
  var fn05 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-05';})[0];
  if (!fn05) return _s08R('Enable FN-05', false, 'FN-05 not found');
  if (fn05.target_release !== 'R2') return _s08R('Enable FN-05', false, 'FN-05 target_release must be R2, got: '+fn05.target_release);
  var before = {mode:fn05.mode,scope:fn05.authorised_job_scope,release:fn05.target_release};
  if (fn05.mode === 'Automated' && fn05.authorised_job_scope === 'Pilot') return _s08R('Enable FN-05', true, 'Already Automated/Pilot/R2');
  if (fn05.mode !== 'Disabled' || fn05.authorised_job_scope !== 'None') return _s08R('Enable FN-05', false, 'Unexpected state: '+JSON.stringify(before));
  s.update('ReleaseModes',fn05.id,{mode:'Automated',authorised_job_scope:'Pilot',target_release:'R2',updated_at:new Date().toISOString(),updated_by:'S08-enable',version:(fn05.version||0)+1});
  return _s08R('Enable FN-05', true, 'Enabled. Before: '+JSON.stringify(before)+' After: Automated/Pilot/R2');
}

function runS08HappyPathTest() {
  var ss = _s08Guard(), s = _s08Store(ss);
  var fn05 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-05';})[0];
  if (!fn05 || fn05.mode !== 'Automated') return _s08R('S08 happy path', false, 'FN-05 must be Automated/Pilot/R2. Run runS08EnableFn05ForSyntheticTest first.');

  var n = new Date().toISOString();
  var job = {id:'J-s08-ready',job_id:'SS-S08R-EADY',customer_id:'CUST-s08',display_name:'S08 Pick',sold_submission_id:'S08-sold',booking_submission_id:'S08-booking',sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S08',quote_reference:'Q-S08',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S08',contract_signed_at:'2026-08-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-S08',roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Booked',booking_approved_at:'2026-08-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:false,release_scope:'R1',created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,source_system:'S08',source_record_id:null,commit_id:'S08'};
  if (!s.get('Jobs',job.id)) s.insert('Jobs',job);
  if (!s.get('Materials','MAT-S08-001')) s.insert('Materials',{id:'MAT-S08-001',job_id:job.id,work_package_id:'WP-S08',product_id:'PROD-P460',description:null,required_quantity:5,unit:'Each',source:'Stock',need_by_date:'2026-10-01',merchant_id:null,order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,source_system:'S08',commit_id:'S08'});
  // Seed stock
  var sk = 'MOV-seed-PROD-P460-LOC-store';
  if (!s.list('StockMovements').filter(function(m){return m.idempotency_key===sk;}).length) {
    s.insert('StockMovements',{id:'SM-seed-PROD-P460',product_id:'PROD-P460',quantity:10,from_location_id:'LOC-supplier',to_location_id:'LOC-store',movement_type:'Receipt',job_id:null,receipt_line_id:null,reason:'S08 seed',evidence_id:null,approval_id:null,movement_at:'2026-09-01T00:00:00.000Z',idempotency_key:sk,created_at:'2026-09-01T00:00:00.000Z',commit_id:'seed'});
  }

  var result = processJobPicking(job.id, s);
  var pass = result.success && result.picking.movements_created === 1;
  return _s08R('S08 happy path', pass, pass ? 'PASS. Movement created. Available: '+calculateStockAvailable('PROD-P460','LOC-store',s) : 'FAIL. Success='+result.success+' Movements='+result.picking.movements_created);
}

function restoreS08SafeState() {
  var ss = _s08Guard(), s = _s08Store(ss);
  var fn05 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-05';})[0];
  if (!fn05) return _s08R('S08 safe state', false, 'FN-05 not found');
  if (fn05.mode === 'Disabled' && fn05.authorised_job_scope === 'None') return _s08R('S08 safe state', true, 'FN-05 already Disabled/None/R2');
  s.update('ReleaseModes',fn05.id,{mode:'Disabled',authorised_job_scope:'None',target_release:'R2',updated_at:new Date().toISOString(),updated_by:'S08-restore',version:(fn05.version||0)+1});
  return _s08R('S08 safe state', true, 'FN-05 restored to Disabled/None/R2');
}

/* Embedded core */

function calculateStockAvailable(pid, lid, store) {
  var ms = store.list('StockMovements').filter(function(m){return m.product_id===pid&&(m.from_location_id===lid||m.to_location_id===lid);});
  var bal = 0;
  for (var i=0;i<ms.length;i++) { var m=ms[i]; if(m.to_location_id===lid)bal+=m.quantity||0; if(m.from_location_id===lid)bal-=m.quantity||0; }
  return bal;
}

function evaluatePickRequirements(jobId, store) {
  var ms = store.list('Materials').filter(function(m){return m.job_id===jobId&&m.source==='Stock';});
  var result = {job_id:jobId,items:[],ready:true,blocked:false,issues:[]};
  if (ms.length===0) { result.ready=false;result.issues.push('No stock materials'); return result; }
  for (var i=0;i<ms.length;i++) {
    var m=ms[i],issues=[],itemReady=true;
    if (!m.product_id) { issues.push('Missing product_id'); itemReady=false; }
    if (!m.required_quantity||m.required_quantity<=0) { issues.push('Missing quantity'); itemReady=false; }
    var lid='LOC-store', avail=m.product_id?calculateStockAvailable(m.product_id,lid,store):0;
    var picked=store.list('Reservations').filter(function(r){return r.material_id===m.id&&r.status==='Issued';}).reduce(function(s,r){return s+(r.picked_quantity||0);},0);
    var remaining=m.required_quantity-picked, sufficient=remaining<=0||avail>=remaining;
    if (remaining>0&&!sufficient) { issues.push('Insufficient: need '+remaining+' have '+avail); itemReady=false; }
    result.items.push({material_id:m.id,product_id:m.product_id,required:m.required_quantity,already_picked:picked,remaining:remaining,available:avail,location_id:lid,ready:itemReady&&remaining>0&&sufficient,already_complete:remaining<=0,issues:issues});
    if (!itemReady) { result.ready=false;result.blocked=true; }
  }
  result.summary=result.ready?'Ready':(result.blocked?'Blocked':'NoAction');
  return result;
}

function executePick(jobId, store) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  var reqs = evaluatePickRequirements(jobId, store);
  if (!reqs.ready) return {status:'NotReady',movements_created:0,reservations_created:0,created:[],errors:reqs.issues};
  var created=[],skipped=[],n=new Date().toISOString();
  for (var i=0;i<reqs.items.length;i++) {
    var it=reqs.items[i];
    if (!it.ready) { if (it.already_complete) skipped.push({material_id:it.material_id,reason:'Already picked'}); continue; }
    var rid='RES-'+it.material_id;
    if (!store.get('Reservations',rid)) store.insert('Reservations',{id:rid,material_id:it.material_id,product_id:it.product_id,location_id:it.location_id,quantity:it.remaining,status:'Active',picked_quantity:0,picked_at:null,picked_by:null,created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,commit_id:rid});
    var mk='MOV-'+it.material_id+'-v1';
    if (store.list('StockMovements').filter(function(m){return m.idempotency_key===mk;}).length) { skipped.push({material_id:it.material_id,reason:'Movement exists'}); continue; }
    var mid='SM-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
    store.insert('StockMovements',{id:mid,product_id:it.product_id,quantity:it.remaining,from_location_id:it.location_id,to_location_id:'LOC-jobsite',movement_type:'Issue',job_id:jobId,receipt_line_id:null,reason:'S08 pick',evidence_id:null,approval_id:null,movement_at:n,idempotency_key:mk,created_at:n,commit_id:mid});
    store.update('Reservations',rid,{status:'Issued',picked_quantity:it.remaining,picked_at:n,picked_by:'S08',updated_at:n,updated_by:'S08',version:2});
    store.update('Materials',it.material_id,{source:'AlreadyOrdered',updated_at:n,updated_by:'S08',version:(store.get('Materials',it.material_id)||{}).version+1||1});
    created.push({material_id:it.material_id,movement_id:mid,reservation_id:rid,quantity:it.remaining});
  }
  return {status:created.length>0?'Picked':'NoAction',movements_created:created.length,created:created,errors:[]};
}

function createPickTasks(jobId, store) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  var n=new Date().toISOString(),key='S08-PICK-'+jobId;
  if (!store.list('Tasks').filter(function(t){return t.instance_key===key;}).length) {
    store.insert('Tasks',{id:'TASK-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),job_id:jobId,template_code:'S08-PICK-STOCK',instance_key:key,group:'Materials',title:'Pick stock for job',owner_id:'PERSON-tanya',backup_id:null,related_entity_type:'Jobs',related_entity_id:jobId,due_at:null,original_due_at:null,priority:1,status:'Open',blocking_reason:null,next_followup_at:null,completed_at:null,completed_by:null,completion_note:null,evidence_id:null,revision_required:false,created_rule_version:'S08-1.0',created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,source_system:'S08',commit_id:'S08-'+key});
  }
  return {created:[]};
}

function processJobPicking(jobId, store) {
  var reqs = evaluatePickRequirements(jobId, store);
  var pr = {status:'NotReady',movements_created:0,created:[],errors:[]};
  if (reqs.ready) { pr = executePick(jobId, store); createPickTasks(jobId, store); }
  return {job_id:jobId,requirements:reqs,picking:pr,success:reqs.ready&&pr.status==='Picked'};
}
