/* S07 ordering — Apps Script entry points for the DEV bound project.
 * FN-03 governs ordering. Must be explicitly enabled.
 * No real merchant communication. DEV only. */

function _s07Guard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc') throw new Error('S07_REFUSED: wrong sheet');
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(props.getProperty('S01_CONFIG') || 'null');
  if (!config || config.environment !== 'DEV') throw new Error('S07_REFUSED: DEV only');
  return ss;
}

function _s07Find(ss, name) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) { if (sheets[i].getName() === name) return sheets[i]; }
  return null;
}

var _S7C = {
  Materials: ['id','job_id','work_package_id','product_id','description','required_quantity','unit','source','need_by_date','merchant_id','order_line_id','already_ordered_reference','notes','revision','cancelled_quantity','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Orders: ['id','job_id','merchant_id','work_type','requested_delivery_date','delivery_location_id','delivery_address','status','revision','supplier_reference','sent_message_id','confirmed_revision','confirmed_at','confirmed_by','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  OrderLines: ['id','order_id','material_id','product_id','description_snapshot','quantity','unit','unit_net_cost_pence','vat_code','cancelled_quantity','created_at','commit_id'],
  Products: ['id','sku','name','category','wattage','manufacturer','model','unit','unit_precision','stock_tracked','active','default_supplier_id','standard_lead_days','unit_cost_pence','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Companies: ['id','name','type','active','standard_lead_days','delivery_weekday','notes','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Jobs: ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  Tasks: ['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  TaskTemplates: ['id','template_code','title','group','default_owner_role','trigger_event','due_rule','evidence_required','active','template_version','created_at','created_by','updated_at','updated_by','version','commit_id'],
  People: ['id','email','display_name','role','company_id','active','calendar_id','notification_email','capacity_per_day','available_from','available_to','backup_person_id','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  PersonRoles: ['id','person_id','role','active','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  ReleaseModes: ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'],
  StockLocations: ['id','name','type','job_id','usable'],
  Customers: ['id','first_name','last_name','address_line1','address_line2','town','postcode','email','phone']
};

function _s07Rd(ss, name) {
  var sheet = _s07Find(ss, name); if (!sheet) return [];
  var h = _S7C[name]; if (!h) return [];
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc === 0) return [];
  var v = sheet.getRange(2, 1, lr - 1, lc).getValues();
  var o = [];
  for (var r = 0; r < v.length; r++) {
    var rec = {};
    for (var c = 0; c < h.length && c < v[r].length; c++) { var x = v[r][c]; rec[h[c]] = (x === '' || x === undefined || x === null) ? null : x; }
    o.push(rec);
  }
  return o;
}

function _s07Ins(ss, name, d) {
  var sheet = _s07Find(ss, name); if (!sheet) throw new Error('Tab: ' + name);
  var h = _S7C[name]; var tr = sheet.getLastRow() + 1;
  if (tr > sheet.getMaxRows()) throw new Error('CAPACITY: ' + name);
  var vals = h.map(function(k) { var v = d[k]; if (v === null || v === undefined) return ''; if (typeof v === 'string' && /^[=']/.test(v)) return "'" + v; return v; });
  sheet.getRange(tr, 1, 1, vals.length).setValues([vals]); SpreadsheetApp.flush();
}

function _s07Upd(ss, name, id, p) {
  var sheet = _s07Find(ss, name); if (!sheet) throw new Error('Tab: ' + name);
  var h = _S7C[name]; var rows = _s07Rd(ss, name), ri = -1;
  for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { ri = i + 2; break; } }
  if (ri < 0) throw new Error('Row: ' + name + ' ' + id);
  var cv = sheet.getRange(ri, 1, 1, h.length).getValues()[0];
  for (var k in p) { if (!p.hasOwnProperty(k)) continue; var idx = h.indexOf(k); if (idx >= 0) { var v = p[k]; if (typeof v === 'string' && /^[=']/.test(v)) v = "'" + v; cv[idx] = v !== null && v !== undefined ? v : ''; } }
  sheet.getRange(ri, 1, 1, cv.length).setValues([cv]); SpreadsheetApp.flush();
}

function _s07Store(ss) {
  return { getSheetId:function(){return ss.getId();}, list:function(n){return _s07Rd(ss,n);}, get:function(n,id){return _s07Rd(ss,n).filter(function(r){return r.id===id;})[0]||null;}, insert:function(n,d){_s07Ins(ss,n,d);}, update:function(n,id,p){_s07Upd(ss,n,id,p);} };
}

function _s07R(name, pass, detail) { var r = {test:name,pass:pass,detail:detail}; console.log(JSON.stringify(r,null,2)); return r; }

/* --- Entry points --- */

function runS07FixtureDryRun() {
  var ss = _s07Guard(), s = _s07Store(ss);
  var fn03 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-03';})[0];
  var r = { sheet_id:ss.getId(), products:s.list('Products').length, merchants:s.list('Companies').filter(function(c){return c.type==='Merchant';}).length, materials:s.list('Materials').length, orders:s.list('Orders').length, fn03_mode:fn03?fn03.mode:'missing', ready:s.list('Products').length>=2 };
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS07FixtureApply() {
  var ss = _s07Guard(), s = _s07Store(ss);
  var n = '2026-09-06T00:00:00.000Z';
  function ins(t,id,data) { if (!s.get(t,id)) s.insert(t,data); }
  ins('Products','PROD-P460',{id:'PROD-P460',sku:'P460',name:'460W Solar Panel',category:'Panel',wattage:460,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:14,unit_cost_pence:null,created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07'});
  ins('Products','PROD-P515',{id:'PROD-P515',sku:'P515',name:'515W Solar Panel',category:'Panel',wattage:515,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:14,unit_cost_pence:null,created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07'});
  ins('Products','PROD-S07-RAIL',{id:'PROD-S07-RAIL',sku:'RAIL-4M',name:'4m Mounting Rail',category:'Mounting',wattage:null,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:7,unit_cost_pence:null,created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07'});
  ins('Companies','COMP-greentech',{id:'COMP-greentech',name:'Greentech',type:'Merchant',active:true,standard_lead_days:14,delivery_weekday:4,notes:'Roofing',created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07'});
  ins('Companies','COMP-cef',{id:'COMP-cef',name:'CEF',type:'Merchant',active:true,standard_lead_days:7,delivery_weekday:4,notes:'Electrical',created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07'});
  ins('StockLocations','LOC-store',{id:'LOC-store',name:'Main Store',type:'Store',job_id:null,usable:true});
  ins('TaskTemplates','TPL-MAT01',{id:'TPL-MAT01',template_code:'MAT01',title:'Place material order',group:'Materials',default_owner_role:'Office',trigger_event:'Material ToOrder created',due_rule:'Need-by minus lead days',evidence_required:'S07',active:true,template_version:'1.0',created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,commit_id:'S07'});
  var r = {applied:true,products:s.list('Products').length,merchants:s.list('Companies').filter(function(c){return c.type==='Merchant';}).length};
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS07FixtureValidate() {
  var ss = _s07Guard(), s = _s07Store(ss);
  var fn03 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-03';})[0];
  var r = {products:s.list('Products').length,merchants:s.list('Companies').filter(function(c){return c.type==='Merchant';}).length,fn03_mode:fn03?fn03.mode:'missing',fn03_ready:fn03&&fn03.mode==='Automated'&&fn03.authorised_job_scope==='Pilot',ready:s.list('Products').length>=2};
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS07HappyPathTest() {
  var ss = _s07Guard(), s = _s07Store(ss);
  var fn03 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-03';})[0];
  if (!fn03 || fn03.mode !== 'Automated') return _s07R('S07 happy path', false, 'FN-03 must be Automated/Pilot/R2. Run runS07EnableFn03ForSyntheticTest first.');

  var n = new Date().toISOString();
  var job = {id:'J-s07-ready',job_id:'SS-S07R-EADY',customer_id:'CUST-s07',display_name:'S07 Order',sold_submission_id:'S07-sold',booking_submission_id:'S07-booking',sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S07',quote_reference:'Q-S07',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S07',contract_signed_at:'2026-08-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-S07',roof_required:true,electrical_required:true,scaffold_required:false,workflow_stage:'Booked',booking_approved_at:'2026-08-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:false,release_scope:'R1',created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',source_record_id:null,commit_id:'S07'};
  if (!s.get('Jobs',job.id)) s.insert('Jobs',job);
  if (!s.get('Customers','CUST-s07')) s.insert('Customers',{id:'CUST-s07',first_name:'Alice',last_name:'Order',address_line1:'1 Test St',address_line2:'',town:'Testville',postcode:'TS1 1AA',email:null,phone:null});

  var now = '2026-09-01T00:00:00.000Z';
  function mat(id,pid,qty,unit,merch) {
    if (!s.get('Materials',id)) s.insert('Materials',{id:id,job_id:job.id,work_package_id:'WP-S07',product_id:pid,description:null,required_quantity:qty,unit:unit,source:'ToOrder',need_by_date:'2026-10-01',merchant_id:merch,order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:now,created_by:'S07',updated_at:now,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07'});
  }
  mat('MAT-S07-001','PROD-P460',10,'Each','COMP-greentech');
  mat('MAT-S07-002','PROD-S07-RAIL',8,'Each','COMP-greentech');
  mat('MAT-S07-003','PROD-P515',50,'Each','COMP-cef');

  // Evaluate + create orders
  var reqs = evaluateMaterialRequirements(job.id, s);
  var orders = createOrderForJob(job.id, s);
  var tasks = createOrderingTasks(job.id, s);

  var pass = reqs.ready && orders.orders_created >= 2 && tasks.created.length >= 1;
  return _s07R('S07 happy path', pass, pass ? 'PASS. Orders: '+orders.orders_created+'. Tasks: '+tasks.created.length : 'FAIL. Ready='+reqs.ready+' Orders='+orders.orders_created);
}

function runS07EnableFn03ForSyntheticTest() {
  var ss = _s07Guard(), s = _s07Store(ss);
  var fn03 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-03';})[0];
  if (!fn03) return _s07R('Enable FN-03', false, 'FN-03 ReleaseMode row not found');
  if (fn03.target_release !== 'R2') return _s07R('Enable FN-03', false, 'FN-03 target_release must be R2, got: ' + fn03.target_release);

  var before = {mode:fn03.mode,scope:fn03.authorised_job_scope,release:fn03.target_release};
  if (fn03.mode === 'Automated' && fn03.authorised_job_scope === 'Pilot') {
    return _s07R('Enable FN-03', true, 'Already Automated/Pilot/R2. Before: ' + JSON.stringify(before));
  }
  if (fn03.mode !== 'Disabled' || fn03.authorised_job_scope !== 'None') {
    return _s07R('Enable FN-03', false, 'Unexpected current state: ' + JSON.stringify(before) + '. Expected Disabled/None/R2.');
  }

  var now = new Date().toISOString();
  s.update('ReleaseModes', fn03.id, {
    mode:'Automated',authorised_job_scope:'Pilot',target_release:'R2',
    updated_at:now,updated_by:'S07-enable',version:(fn03.version||0)+1
  });

  var after = {mode:'Automated',scope:'Pilot',release:'R2'};
  return _s07R('Enable FN-03', true, 'Enabled. Before: ' + JSON.stringify(before) + ' After: ' + JSON.stringify(after));
}

function restoreS07SafeState() {
  var ss = _s07Guard(), s = _s07Store(ss);
  var fn03 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-03';})[0];
  if (!fn03) return _s07R('S07 safe state', false, 'FN-03 not found');

  var before = {mode:fn03.mode,scope:fn03.authorised_job_scope,release:fn03.target_release};
  if (fn03.mode === 'Disabled' && fn03.authorised_job_scope === 'None' && fn03.target_release === 'R2') {
    return _s07R('S07 safe state', true, 'FN-03 already Disabled/None/R2');
  }

  var now = new Date().toISOString();
  s.update('ReleaseModes', fn03.id, {
    mode:'Disabled',authorised_job_scope:'None',target_release:'R2',
    updated_at:now,updated_by:'S07-restore',version:(fn03.version||0)+1
  });

  var after = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-03';})[0];
  return _s07R('S07 safe state', after && after.mode==='Disabled',
    'FN-03: ' + (after?after.mode+'/'+after.authorised_job_scope+'/'+after.target_release:'?') + '. Before: ' + JSON.stringify(before));
}

/* Embedded core logic for cloud */

function evaluateMaterialRequirements(jobId, store) {
  var ms = store.list('Materials').filter(function(m){return m.job_id===jobId;});
  var result = {job_id:jobId,materials:[],ready:true,blocked:false,needs_review:false,issues:[]};
  if (ms.length===0) { result.ready=false;result.needs_review=true;result.issues.push('No materials'); return result; }
  for (var i=0;i<ms.length;i++) {
    var m=ms[i],issues=[],itemReady=true;
    if (!m.product_id&&!m.description){issues.push('Missing product_id and description');itemReady=false;}
    if (!m.required_quantity||m.required_quantity<=0){issues.push('Missing quantity');itemReady=false;}
    if (!m.merchant_id){issues.push('Missing merchant');itemReady=false;}
    if (!m.need_by_date){issues.push('Missing need_by_date');itemReady=false;}
    var already=(m.source==='AlreadyOrdered');
    result.materials.push({id:m.id,product_id:m.product_id,quantity:m.required_quantity,unit:m.unit,merchant_id:m.merchant_id,need_by_date:m.need_by_date,source:m.source,already_ordered:already,ready:itemReady&&!already,issues:issues});
    if(!itemReady){result.ready=false;result.needs_review=true;}
    if(!itemReady&&issues.some(function(x){return x.indexOf('Missing')>=0;}))result.blocked=true;
  }
  result.summary=result.ready?'Ready':(result.blocked?'Blocked':'NeedsReview');
  return result;
}

function createOrderForJob(jobId, store) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  var reqs = evaluateMaterialRequirements(jobId, store);
  if (!reqs.ready) return {status:'NotReady',orders_created:0,created:[],errors:[]};
  var ready = reqs.materials.filter(function(m){return m.ready;});
  var byM = {}; for (var i=0;i<ready.length;i++) { var m=ready[i]; if(!byM[m.merchant_id])byM[m.merchant_id]=[]; byM[m.merchant_id].push(m); }
  var created=[],existing=[],n=new Date().toISOString();
  for (var mid in byM) {
    if (!byM.hasOwnProperty(mid)) continue;
    var items=byM[mid],ok='ORD-'+jobId+'-'+mid,eo=store.get('Orders',ok);
    if (eo) { existing.push({order_id:ok,status:eo.status}); continue; }
    store.insert('Orders',{id:ok,job_id:jobId,merchant_id:mid,work_type:'Other',requested_delivery_date:items[0].need_by_date,delivery_location_id:'LOC-store',delivery_address:null,status:'Draft',revision:1,supplier_reference:null,sent_message_id:null,confirmed_revision:null,confirmed_at:null,confirmed_by:null,created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:ok});
    var lc=0;
    for (var j=0;j<items.length;j++) {
      var it=items[j],lid=ok+'-L'+(lc+1);
      if (store.get('OrderLines',lid)) continue;
      store.insert('OrderLines',{id:lid,order_id:ok,material_id:it.id,product_id:it.product_id,description_snapshot:it.product_id||'Material',quantity:it.quantity,unit:it.unit,unit_net_cost_pence:null,vat_code:null,cancelled_quantity:0,created_at:n,commit_id:lid});
      store.update('Materials',it.id,{source:'AlreadyOrdered',order_line_id:lid,updated_at:n,updated_by:'S07',version:(store.get('Materials',it.id)||{}).version+1||1});
      lc++;
    }
    created.push({order_id:ok,merchant_id:mid,line_count:lc});
  }
  return {status:created.length>0?'Created':'NoAction',orders_created:created.length,created:created,errors:[]};
}

function createOrderingTasks(jobId, store) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  var n=new Date().toISOString(),created=[],skipped=[];
  var orders=store.list('Orders').filter(function(o){return o.job_id===jobId&&o.status==='Draft';});
  if (orders.length>0) {
    var key='MAT01-'+jobId+'-ROOT-nodue';
    if (!store.list('Tasks').filter(function(t){return t.instance_key===key;}).length) {
      store.insert('Tasks',{id:'TASK-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),job_id:jobId,template_code:'MAT01',instance_key:key,group:'Materials',title:'Place material order',owner_id:'PERSON-tanya',backup_id:null,related_entity_type:'Jobs',related_entity_id:jobId,due_at:null,original_due_at:null,priority:1,status:'Open',blocking_reason:null,next_followup_at:null,completed_at:null,completed_by:null,completion_note:null,evidence_id:null,revision_required:false,created_rule_version:'S07-1.0',created_at:n,created_by:'S07',updated_at:n,updated_by:'S07',version:1,source_system:'S07',commit_id:'S07-'+key});
      created.push({code:'MAT01'});
    }
  }
  return {created:created,skipped:skipped};
}
