/* S06 booking gates — Apps Script entry points for the DEV bound project.
 * Deploy alongside S05Intake.js, S05Core.gs, etc.
 * Minimal cloud smoke test: dry run, apply fixture, validate, happy path, safe state.
 * FN-01 must be explicitly enabled. No outbound calls. */

function _s06Guard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc') {
    throw new Error('S06_REFUSED: wrong sheet');
  }
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(props.getProperty('S01_CONFIG') || 'null');
  if (!config || config.environment !== 'DEV') throw new Error('S06_REFUSED: DEV only');
  return ss;
}

function _s06FindSheet(ss, name) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === name) return sheets[i];
  }
  return null;
}

var _S06_COLS = {
  Jobs: ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  Tasks: ['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Customers: ['id','first_name','last_name','address_line1','address_line2','town','postcode','email','phone','alternate_contact','contact_notes','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  TaskTemplates: ['id','template_code','title','group','default_owner_role','trigger_event','due_rule','evidence_required','active','template_version','created_at','created_by','updated_at','updated_by','version','commit_id'],
  People: ['id','email','display_name','role','company_id','active','calendar_id','notification_email','capacity_per_day','available_from','available_to','backup_person_id','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  PersonRoles: ['id','person_id','role','active','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  ReleaseModes: ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id']
};

function _s06Read(ss, name) {
  var sheet = _s06FindSheet(ss, name);
  if (!sheet) return [];
  var hdrs = _S06_COLS[name]; if (!hdrs) return [];
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc === 0) return [];
  var vals = sheet.getRange(2, 1, lr - 1, lc).getValues();
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var rec = {};
    for (var c = 0; c < hdrs.length && c < vals[r].length; c++) {
      var v = vals[r][c];
      rec[hdrs[c]] = (v === '' || v === undefined || v === null) ? null : v;
    }
    out.push(rec);
  }
  return out;
}

function _s06Ins(ss, name, data) {
  var sheet = _s06FindSheet(ss, name);
  if (!sheet) throw new Error('Tab not found: ' + name);
  var hdrs = _S06_COLS[name];
  var tr = sheet.getLastRow() + 1;
  if (tr > sheet.getMaxRows()) throw new Error('ROW_CAPACITY: ' + name);
  var vals = hdrs.map(function(h) {
    var v = data[h];
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' && /^[=']/.test(v)) return "'" + v;
    return v;
  });
  sheet.getRange(tr, 1, 1, vals.length).setValues([vals]);
  SpreadsheetApp.flush();
}

function _s06Upd(ss, name, id, patch) {
  var sheet = _s06FindSheet(ss, name);
  if (!sheet) throw new Error('Tab not found: ' + name);
  var hdrs = _S06_COLS[name];
  var rows = _s06Read(ss, name), ri = -1;
  for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { ri = i + 2; break; } }
  if (ri < 0) throw new Error('Row not found: ' + name + ' ' + id);
  var cv = sheet.getRange(ri, 1, 1, hdrs.length).getValues()[0];
  for (var k in patch) {
    if (!patch.hasOwnProperty(k)) continue;
    var idx = hdrs.indexOf(k);
    if (idx >= 0) {
      var v = patch[k];
      if (typeof v === 'string' && /^[=']/.test(v)) v = "'" + v;
      cv[idx] = v !== null && v !== undefined ? v : '';
    }
  }
  sheet.getRange(ri, 1, 1, cv.length).setValues([cv]);
  SpreadsheetApp.flush();
}

function _s06Store(ss) {
  return {
    getSheetId: function() { return ss.getId(); },
    list: function(n) { return _s06Read(ss, n); },
    get: function(n, id) { return _s06Read(ss, n).filter(function(r) { return r.id === id; })[0] || null; },
    insert: function(n, d) { _s06Ins(ss, n, d); },
    update: function(n, id, p) { _s06Upd(ss, n, id, p); }
  };
}

function _s06Result(name, pass, detail) {
  var r = { test: name, pass: pass, detail: detail };
  console.log(JSON.stringify(r, null, 2));
  return r;
}

/* --- Entry points --- */

function runS06FixtureDryRun() {
  var ss = _s06Guard(), store = _s06Store(ss);
  var result = {
    sheet_id: ss.getId(),
    templates: store.list('TaskTemplates').length,
    existing_tasks: store.list('Tasks').length,
    s06_jobs: store.list('Jobs').filter(function(j) { return j.source_system === 'S06-fixture'; }).length,
    ready: store.list('TaskTemplates').length >= 6
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runS06FixtureApply() {
  var ss = _s06Guard(), store = _s06Store(ss);
  // Ensure TaskTemplates (idempotent — only insert if missing)
  var tpls = store.list('TaskTemplates');
  var now = '2026-09-06T00:00:00.000Z';
  function tpl(id, code, title, group, owner, trigger, due) {
    if (tpls.filter(function(t) { return t.id === id; }).length > 0) return;
    store.insert('TaskTemplates', { id:id,template_code:code,title:title,group:group,default_owner_role:owner,trigger_event:trigger,due_rule:due,evidence_required:'S06 test',active:true,template_version:'1.0',created_at:now,created_by:'S06-fixture',updated_at:now,updated_by:'S06-fixture',version:1,commit_id:'S06-fixture' });
  }
  tpl('TPL-PRE01','PRE01','Send deposit invoice','Prebooking','Office','New Standard sale','Same day');
  tpl('TPL-PRE02','PRE02','Check contract sent/signed','Prebooking','Office','New sale','Same day then daily');
  tpl('TPL-PRE03','PRE03','Confirm bank deposit','Prebooking','Admin','Deposit expected','Next staffed day');
  tpl('TPL-BKG01','BKG01','Prepare booking','Booking','Office','Booking intake received','Before booking confirmation');
  tpl('TPL-BKG04','BKG04','Send customer booking email','Booking','Office','Booking confirmed','Same staffed day');
  tpl('TPL-FIN01','FIN01','Interim draft check/send','Finance','Office','Installation confirmed','Seven days before due');

  var result = { applied: true, templates: store.list('TaskTemplates').length };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runS06FixtureValidate() {
  var ss = _s06Guard(), store = _s06Store(ss);
  var fn01 = store.list('ReleaseModes').filter(function(r) { return r.function_id === 'FN-01'; })[0];
  var result = {
    templates: store.list('TaskTemplates').length,
    fn01_mode: fn01 ? fn01.mode : 'missing',
    fn01_ready: fn01 && fn01.mode === 'Automated' && fn01.authorised_job_scope === 'Pilot',
    ready: store.list('TaskTemplates').length >= 6
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function runS06HappyPathTest() {
  var ss = _s06Guard(), store = _s06Store(ss);

  var fn01 = store.list('ReleaseModes').filter(function(r) { return r.function_id === 'FN-01'; })[0];
  if (!fn01 || fn01.mode !== 'Automated') {
    return _s06Result('S06 happy path', false, 'FN-01 must be Automated. Run runS04EnableFn01ForSyntheticTest first.');
  }

  // Create synthetic ready job
  var now = new Date().toISOString();
  var job = { id:'J-s06-ready',job_id:'SS-S06R-EADY',customer_id:'CUST-s06-ready',display_name:'S06 Ready Test',sold_submission_id:'S06-sold-ready',booking_submission_id:'S06-booking-ready',sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S06-test',quote_reference:'Q-S06-001',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'CONTRACT-001',contract_signed_at:'2026-08-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-001',roof_required:false,electrical_required:false,scaffold_required:false,workflow_stage:'BookingInProgress',booking_approved_at:null,booking_approved_by:null,operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:false,release_scope:'R1',created_at:now,created_by:'S06-test',updated_at:now,updated_by:'S06-test',version:1,source_system:'S06-test',source_record_id:null,commit_id:'S06-test' };

  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', 'CUST-s06-ready')) {
    store.insert('Customers', { id:'CUST-s06-ready',first_name:'Alice',last_name:'Ready',address_line1:'1 Test Street',address_line2:'',town:'Testville',postcode:'TS1 1AA',email:'alice@test.example.invalid',phone:'07123456789',alternate_contact:null,contact_notes:null,created_at:now,created_by:'S06-test',updated_at:now,updated_by:'S06-test',version:1,source_system:'S06-test',source_record_id:null,commit_id:'S06-test' });
  }

  // Process gates
  var result = processBookingGates(job.id, store);

  var pass = result.gates.ready === true && result.gates.blocked === false &&
    result.tasks.created.length > 0 && result.gates.workflow_stage === 'Booked';

  return _s06Result('S06 happy path', pass, pass ?
    'PASS. Gates ready. Stage: ' + result.gates.workflow_stage + '. Tasks created: ' + result.tasks.created.length :
    'FAIL. Ready=' + result.gates.ready + ' Blocked=' + result.gates.blocked + ' Tasks=' + result.tasks.created.length);
}

function restoreS06SafeState() {
  var ss = _s06Guard(), store = _s06Store(ss);
  var fn01 = store.list('ReleaseModes').filter(function(r) { return r.function_id === 'FN-01'; })[0];
  if (fn01 && fn01.mode !== 'Disabled') {
    store.update('ReleaseModes', fn01.id, { mode:'Disabled',authorised_job_scope:'None',target_release:'R1',updated_at:new Date().toISOString(),updated_by:'S06-restore',version:(fn01.version||0)+1 });
  }
  return _s06Result('S06 safe state', true, 'FN-01 restored to Disabled');
}

/* Minimal embedded processBookingGates for cloud */
function processBookingGates(jobId, store) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  var job = store.get('Jobs', jobId);
  if (!job) return { error: 'JOB_NOT_FOUND' };

  var gates = [];
  var ready = true, blocked = false;

  function check(name, pass, detail, blk) {
    gates.push({ name:name, pass:pass, detail:detail, blocking:!!blk });
    if (!pass && blk) blocked = true;
    if (!pass) ready = false;
  }

  check('sold_booking_linked', !!(job.sold_submission_id && job.booking_submission_id), 'Linked: ' + !!job.booking_submission_id, true);
  check('sold_booking_match', job.sold_booking_match_status === 'Match', 'Match: ' + (job.sold_booking_match_status||'?'), true);
  var cust = job.customer_id ? store.get('Customers', job.customer_id) : null;
  check('customer_exists', !!cust, cust ? 'Customer: ' + cust.id : 'No customer', true);
  check('contract_status', ['Sent','Signed'].includes(job.contract_status), 'Contract: ' + (job.contract_status||'?'), false);
  check('finance_route', ['Standard','Phoenix','OtherReview'].includes(job.finance_route), 'Finance: ' + (job.finance_route||'?'), true);
  check('deposit_confirmed', !!job.deposit_bank_confirmed_at, 'Deposit: ' + (job.deposit_bank_confirmed_at||'not confirmed'), true);
  check('gross_amount', typeof job.original_gross_pence === 'number' && job.original_gross_pence > 0, 'Gross: ' + (job.original_gross_pence||0), false);

  var created = [];
  var now = new Date().toISOString();

  function mkTask(code, title, group, owner, due) {
    var key = code + '-' + jobId + '-ROOT-nodue';
    var exists = store.list('Tasks').filter(function(t) { return t.instance_key === key; });
    if (exists.length > 0) return;
    var t = { id:'TASK-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8), job_id:jobId, template_code:code, instance_key:key, group:group, title:title, owner_id:owner, backup_id:null, related_entity_type:'Jobs', related_entity_id:jobId, due_at:due||null, original_due_at:due||null, priority:1, status:'Open', blocking_reason:null, next_followup_at:null, completed_at:null, completed_by:null, completion_note:null, evidence_id:null, revision_required:false, created_rule_version:'S06-1.0', created_at:now, created_by:'S06-gates', updated_at:now, updated_by:'S06-gates', version:1, source_system:'S06-gates', commit_id:'S06-'+key };
    store.insert('Tasks', t);
    created.push({ code:code, task_id:t.id });
  }

  mkTask('PRE01','Send deposit invoice','Prebooking','PERSON-tanya',null);
  mkTask('PRE02','Check contract sent/signed','Prebooking','PERSON-tanya',null);
  mkTask('PRE03','Confirm bank deposit','Prebooking','PERSON-ben',null);
  mkTask('BKG01','Prepare booking','Booking','PERSON-tanya',null);
  mkTask('BKG04','Send customer booking email','Booking','PERSON-tanya',null);

  if (ready && job.workflow_stage === 'BookingInProgress') {
    store.update('Jobs', jobId, { workflow_stage:'Booked',booking_approved_at:now,booking_approved_by:'S06-gates',updated_at:now,updated_by:'S06-gates',version:(job.version||0)+1 });
    job.workflow_stage = 'Booked';
  }

  return {
    job_id: jobId, job_id_human: job.job_id,
    gates: { ready:ready, blocked:blocked, gates:gates, workflow_stage:job.workflow_stage },
    tasks: { created:created, task_count:created.length },
    success: !blocked
  };
}
