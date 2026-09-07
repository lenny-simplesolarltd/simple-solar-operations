/* S09 scaffolding — Apps Script entry points for the DEV bound project.
 * FN-04 governs scaffolding. Must be explicitly enabled.
 * No real scaffolder communication. DEV only. */

function _s09Guard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getId() !== '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc') throw new Error('S09_REFUSED: wrong sheet');
  var props = PropertiesService.getScriptProperties();
  var config = JSON.parse(props.getProperty('S01_CONFIG') || 'null');
  if (!config || config.environment !== 'DEV') throw new Error('S09_REFUSED: DEV only');
  return ss;
}

function _s09Find(ss, name) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) { if (sheets[i].getName() === name) return sheets[i]; }
  return null;
}

var _S9C = {
  ScaffoldBookings: ['id','job_id','company_id','erect_planned_at','erect_confirmed_at','erect_actual_at','strip_forecast_at','strip_authorised_at','strip_authorised_by','strip_planned_at','strip_confirmed_at','strip_actual_at','status','revision','confirmed_revision','access_notes','scope_file_id','quoted_cost_pence','actual_cost_pence','invoice_reference','related_issue_ids','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Jobs: ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  Companies: ['id','name','type','active','standard_lead_days','delivery_weekday','notes','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  Tasks: ['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  TaskTemplates: ['id','template_code','title','group','default_owner_role','trigger_event','due_rule','evidence_required','active','template_version','created_at','created_by','updated_at','updated_by','version','commit_id'],
  People: ['id','email','display_name','role','active','calendar_id','notification_email','capacity_per_day','available_from','available_to','backup_person_id','company_id','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
  PersonRoles: ['id','person_id','role','active','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
  ReleaseModes: ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id']
};

function _s09Rd(ss, name) {
  var sheet = _s09Find(ss, name); if (!sheet) return [];
  var h = _S9C[name]; if (!h) return [];
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc === 0) return [];
  var v = sheet.getRange(2, 1, lr - 1, lc).getValues();
  var o = [];
  for (var r = 0; r < v.length; r++) { var rec = {}; for (var c = 0; c < h.length && c < v[r].length; c++) { var x = v[r][c]; rec[h[c]] = (x === '' || x === undefined || x === null) ? null : x; } o.push(rec); }
  return o;
}

function _s09Ins(ss, name, d) {
  var sheet = _s09Find(ss, name); if (!sheet) throw new Error('Tab: ' + name);
  var h = _S9C[name]; var tr = sheet.getLastRow() + 1;
  if (tr > sheet.getMaxRows()) throw new Error('CAPACITY: ' + name);
  var vals = h.map(function(k) { var v = d[k]; if (v === null || v === undefined) return ''; if (typeof v === 'string' && /^[=']/.test(v)) return "'" + v; return v; });
  sheet.getRange(tr, 1, 1, vals.length).setValues([vals]); SpreadsheetApp.flush();
}

function _s09Upd(ss, name, id, p) {
  var sheet = _s09Find(ss, name); if (!sheet) throw new Error('Tab: ' + name);
  var h = _S9C[name]; var rows = _s09Rd(ss, name), ri = -1;
  for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { ri = i + 2; break; } }
  if (ri < 0) throw new Error('Row: ' + name + ' ' + id);
  var cv = sheet.getRange(ri, 1, 1, h.length).getValues()[0];
  for (var k in p) { if (!p.hasOwnProperty(k)) continue; var idx = h.indexOf(k); if (idx >= 0) { var v = p[k]; if (typeof v === 'string' && /^[=']/.test(v)) v = "'" + v; cv[idx] = v !== null && v !== undefined ? v : ''; } }
  sheet.getRange(ri, 1, 1, cv.length).setValues([cv]); SpreadsheetApp.flush();
}

function _s09Store(ss) { return { getSheetId:function(){return ss.getId();}, getEnvironment:function(){_s09Guard();return 'DEV';}, list:function(n){return _s09Rd(ss,n);}, get:function(n,id){return _s09Rd(ss,n).filter(function(r){return r.id===id;})[0]||null;}, insert:function(n,d){_s09Ins(ss,n,d);}, update:function(n,id,p){_s09Upd(ss,n,id,p);} }; }
function _s09R(name, pass, detail) { var r = {test:name,pass:pass,detail:detail}; console.log(JSON.stringify(r,null,2)); return r; }

function runS09FixtureDryRun() {
  var ss = _s09Guard(), s = _s09Store(ss);
  var fn04 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-04';})[0];
  var r = { sheet_id:ss.getId(), scaffolders:s.list('Companies').filter(function(c){return c.type==='Scaffolder';}).length, bookings:s.list('ScaffoldBookings').length, fn04_mode:fn04?fn04.mode:'missing', ready:s.list('Companies').filter(function(c){return c.type==='Scaffolder';}).length>=1 };
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS09FixtureApply() {
  var ss = _s09Guard(), s = _s09Store(ss); var n = '2026-09-06T00:00:00.000Z';
  function ins(t,id,data) { if (!s.get(t,id)) s.insert(t,data); }
  ins('Companies','COMP-scaffold-dev',{id:'COMP-scaffold-dev',name:'DEV Scaffold Co',type:'Scaffolder',active:true,standard_lead_days:7,delivery_weekday:null,notes:'Synthetic DEV',created_at:n,created_by:'S09',updated_at:n,updated_by:'S09',version:1,source_system:'S09',commit_id:'S09'});
  ins('TaskTemplates','TPL-SCA01',{id:'TPL-SCA01',template_code:'SCA01',title:'Notify and confirm scaffolder erect',group:'Materials',default_owner_role:'Office',trigger_event:'Scheduled erect',due_rule:'Before need date per lead time',evidence_required:'Latest revision confirmed',active:true,template_version:'1.0',created_at:n,created_by:'S09',updated_at:n,updated_by:'S09',version:1,commit_id:'S09'});
  var r = {applied:true,scaffolders:s.list('Companies').filter(function(c){return c.type==='Scaffolder';}).length};
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS09FixtureValidate() {
  var ss = _s09Guard(), s = _s09Store(ss);
  var fn04 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-04';})[0];
  var r = { scaffolders:s.list('Companies').filter(function(c){return c.type==='Scaffolder';}).length, fn04_mode:fn04?fn04.mode:'missing', fn04_ready:fn04&&fn04.mode==='Automated'&&fn04.authorised_job_scope==='Pilot'&&fn04.target_release==='R2', ready:s.list('Companies').filter(function(c){return c.type==='Scaffolder';}).length>=1 };
  console.log(JSON.stringify(r,null,2)); return r;
}

function runS09EnableFn04ForSyntheticTest() {
  var ss = _s09Guard(), s = _s09Store(ss);
  var fn04 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-04';})[0];
  if (!fn04) return _s09R('Enable FN-04', false, 'FN-04 not found');
  if (fn04.target_release !== 'R2') return _s09R('Enable FN-04', false, 'FN-04 target_release must be R2, got: '+fn04.target_release);
  var before = {mode:fn04.mode,scope:fn04.authorised_job_scope,release:fn04.target_release};
  if (fn04.mode === 'Automated' && fn04.authorised_job_scope === 'Pilot') return _s09R('Enable FN-04', true, 'Already Automated/Pilot/R2');
  if (fn04.mode !== 'Disabled' || fn04.authorised_job_scope !== 'None') return _s09R('Enable FN-04', false, 'Unexpected state: '+JSON.stringify(before));
  s.update('ReleaseModes',fn04.id,{mode:'Automated',authorised_job_scope:'Pilot',target_release:'R2',updated_at:new Date().toISOString(),updated_by:'S09-enable',version:(fn04.version||0)+1});
  return _s09R('Enable FN-04', true, 'Enabled. Before: '+JSON.stringify(before)+' After: Automated/Pilot/R2');
}

function runS09HappyPathTest() {
  try {
  var ss = _s09Guard(), s = _s09Store(ss);
  var fn04 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-04';})[0];
  if (!fn04 || fn04.mode !== 'Automated' || fn04.authorised_job_scope !== 'Pilot' || fn04.target_release !== 'R2') return _s09R('S09 happy path', false, 'FN-04 must be Automated/Pilot/R2. Run runS09EnableFn04ForSyntheticTest first.');

  var n = new Date().toISOString();
  var job = {id:'J-s09-ready',job_id:'SS-S09R-EADY',customer_id:'CUST-s09',display_name:'S09 Scaffold',sold_submission_id:'S09-sold',booking_submission_id:'S09-booking',sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S09',quote_reference:'Q-S09',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S09',contract_signed_at:'2026-08-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-S09',roof_required:true,electrical_required:false,scaffold_required:true,workflow_stage:'Booked',booking_approved_at:'2026-08-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:true,release_scope:'R2',created_at:n,created_by:'S09',updated_at:n,updated_by:'S09',version:1,source_system:'S09',source_record_id:null,commit_id:'S09'};
  var old = s.get('Jobs',job.id);
  if (old && (old.source_system !== 'S09' || old.job_id !== job.job_id || old.customer_id !== job.customer_id)) return _s09R('S09 happy path', false, 'Synthetic job identity conflict');
  if (!old) s.insert('Jobs',job);
  else if (old.pilot_job !== true || old.release_scope !== 'R2') s.update('Jobs',job.id,{pilot_job:true,release_scope:'R2',updated_at:n,updated_by:'S09',version:Number(old.version||0)+1});

  var result = processJobScaffolding(job.id, s);
  var bookings = s.list('ScaffoldBookings').filter(function(b){return b.job_id===job.id;});
  var tasks = s.list('Tasks').filter(function(t){return t.job_id===job.id && t.template_code==='SCA01';});
  var pass = !!(result && result.success && result.booking && result.tasks && bookings.length===1 && bookings[0].id==='SB-'+job.id && bookings[0].company_id==='COMP-scaffold-dev' && tasks.length===1 && tasks[0].instance_key==='SCA01-'+job.id+'-ROOT-nodue' && tasks[0].related_entity_type==='Jobs' && tasks[0].related_entity_id===job.id && tasks[0].owner_id==='PERSON-tanya');
  return _s09R('S09 happy path', pass, {bookings:bookings.length,tasks:tasks.length,booking_created:!!(result && result.booking && result.booking.created),tasks_created:result && result.tasks && result.tasks.created ? result.tasks.created.length : 0,tasks_reused:result && result.tasks && result.tasks.reused ? result.tasks.reused.length : 0});
  } catch (e) { return _s09R('S09 happy path', false, String(e.message || e)); }
}

function restoreS09SafeState() {
  var ss = _s09Guard(), s = _s09Store(ss);
  var fn04 = s.list('ReleaseModes').filter(function(r){return r.function_id==='FN-04';})[0];
  if (!fn04) return _s09R('S09 safe state', false, 'FN-04 not found');
  if (fn04.mode === 'Disabled' && fn04.authorised_job_scope === 'None' && fn04.target_release === 'R2') return _s09R('S09 safe state', true, 'FN-04 already Disabled/None/R2');
  s.update('ReleaseModes',fn04.id,{mode:'Disabled',authorised_job_scope:'None',target_release:'R2',updated_at:new Date().toISOString(),updated_by:'S09-restore',version:(fn04.version||0)+1});
  return _s09R('S09 safe state', true, 'FN-04 restored to Disabled/None/R2');
}

/* Embedded core — kept identical to s09/scaffold.js (excluding exports). */
/* S09 scaffolding — scaffold requirement evaluation and booking.
 * Uses canonical ScaffoldBookings, Companies, Contacts, Jobs tables.
 * FN-04 governs scaffolding. No real external communication. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
function assertS09Scope(jobId, store) {
  if (!store.getSheetId || store.getSheetId() !== DEV_SHEET_ID ||
      !store.getEnvironment || store.getEnvironment() !== 'DEV') throw new Error('S09_REFUSED: DEV only / wrong sheet');
  const modes = store.list('ReleaseModes').filter(r => r.function_id === 'FN-04');
  if (modes.length !== 1 || modes[0].mode !== 'Automated' || modes[0].authorised_job_scope !== 'Pilot' || modes[0].target_release !== 'R2') throw new Error('S09_REFUSED: FN-04 must be Automated/Pilot/R2');
  const job = store.get('Jobs', jobId);
  if (!job || job.pilot_job !== true || job.release_scope !== 'R2' || job.source_system !== 'S09') throw new Error('S09_REFUSED: synthetic S09 R2 pilot job required');
}

function evaluateScaffoldRequirement(jobId, store) {
  const job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, required: false, ready: false, error: 'JOB_NOT_FOUND' };

  const required = job.scaffold_required === true;
  if (!required) return { job_id: jobId, required: false, ready: false, summary: 'NotRequired' };

  const existing = store.list('ScaffoldBookings').filter(b => b.job_id === jobId);
  const active = existing.find(b => b.status !== 'Cancelled');
  if (active) {
    return {
      job_id: jobId, required: true, ready: false,
      existing_booking_id: active.id,
      status: active.status,
      summary: 'AlreadyBooked'
    };
  }

  return { job_id: jobId, required: true, ready: true, summary: 'Ready' };
}

function createScaffoldBooking(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  assertS09Scope(jobId, store);
  const now = options.now || new Date().toISOString();
  const eval_ = evaluateScaffoldRequirement(jobId, store);
  if (eval_.existing_booking_id) return { status: 'AlreadyExists', eval: eval_, booking: store.get('ScaffoldBookings', eval_.existing_booking_id), created: false };
  if (!eval_.ready) return { status: 'NotReady', eval: eval_, booking: null, created: false };

  const job = store.get('Jobs', jobId);
  const bookingId = 'SB-' + jobId;
  const existing = store.get('ScaffoldBookings', bookingId);

  if (existing) {
    if (existing.status === 'Cancelled') {
      return { status: 'Cancelled', eval: eval_, booking: existing, created: false, detail: 'Existing booking is cancelled' };
    }
    return { status: 'AlreadyExists', eval: eval_, booking: existing, created: false, detail: 'Booking already exists with status: ' + existing.status };
  }

  const scaffolder = store.list('Companies').find(c => c.id === 'COMP-scaffold-dev' && c.name === 'DEV Scaffold Co' && c.type === 'Scaffolder' && c.active === true && /^S09/.test(c.source_system || ''));
  if (!scaffolder) return { status: 'NoScaffolder', eval: eval_, booking: null, created: false, detail: 'No active scaffolder company configured' };

  const installDate = job.next_action_at;
  const erectDate = installDate ? calculateErectDate(installDate, scaffolder.standard_lead_days || 0) : null;

  const booking = {
    id: bookingId, job_id: jobId, company_id: scaffolder.id,
    erect_planned_at: erectDate,
    erect_confirmed_at: null, erect_actual_at: null,
    strip_forecast_at: null, strip_authorised_at: null, strip_authorised_by: null,
    strip_planned_at: null, strip_confirmed_at: null, strip_actual_at: null,
    status: 'Requested', revision: 1, confirmed_revision: null,
    access_notes: null, scope_file_id: null,
    quoted_cost_pence: null, actual_cost_pence: null, invoice_reference: null,
    related_issue_ids: null,
    created_at: now, created_by: 'S09-scaffold',
    updated_at: now, updated_by: 'S09-scaffold',
    version: 1, source_system: 'S09-scaffold',
    commit_id: bookingId
  };

  store.insert('ScaffoldBookings', booking);
  return { status: 'Created', eval: eval_, booking, created: true };
}

function calculateErectDate(installDate, leadDays) {
  const d = new Date(installDate);
  d.setDate(d.getDate() - (leadDays || 0));
  // Move back to staffed day
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function createScaffoldTasks(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  assertS09Scope(jobId, store);
  const now = options.now || new Date().toISOString();
  const created = [];
  const tanyaId = 'PERSON-tanya';

  const key = 'SCA01-' + jobId + '-ROOT-nodue';
  const matches = store.list('Tasks').filter(t => t.instance_key === key || (t.job_id === jobId && t.template_code === 'SCA01'));
  const exists = matches[0];
  if (matches.length > 1 || (exists && (exists.instance_key !== key || exists.job_id !== jobId || exists.related_entity_type !== 'Jobs' || exists.related_entity_id !== jobId || exists.template_code !== 'SCA01' || exists.owner_id !== tanyaId || exists.group !== 'Materials'))) throw new Error('S09_CONFLICT: SCA01 linkage/duplicate');
  if (!exists) {
    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: jobId, template_code: 'SCA01', instance_key: key,
      group: 'Materials', title: 'Notify and confirm scaffolder erect',
      owner_id: tanyaId, backup_id: null,
      related_entity_type: 'Jobs', related_entity_id: jobId,
      due_at: null, original_due_at: null, priority: 1, status: 'Open',
      blocking_reason: null, next_followup_at: null,
      completed_at: null, completed_by: null, completion_note: null,
      evidence_id: null, revision_required: false,
      created_rule_version: '1.0',
      created_at: now, created_by: 'S09-scaffold',
      updated_at: now, updated_by: 'S09-scaffold',
      version: 1, source_system: 'S09-scaffold',
      commit_id: 'S09-' + key
    };
    store.insert('Tasks', task);
    created.push({ code: 'SCA01', task_id: task.id });
  }

  return { created, reused: exists ? [{ code: 'SCA01', task_id: exists.id }] : [] };
}

function processJobScaffolding(jobId, store, options = {}) {
  assertS09Scope(jobId, store);
  const eval_ = evaluateScaffoldRequirement(jobId, store);
  let bookingResult = { status: 'NotReady', booking: null, created: false };
  let taskResult = { created: [], reused: [] };
  const existing = store.list('ScaffoldBookings').filter(b => b.job_id === jobId);
  if (existing.length > 1 || existing.some(b => b.id !== 'SB-' + jobId || b.company_id !== 'COMP-scaffold-dev')) throw new Error('S09_CONFLICT: scaffold booking linkage/duplicate');
  if (eval_.ready || eval_.existing_booking_id) {
    bookingResult = createScaffoldBooking(jobId, store, options);
    if (bookingResult.booking && bookingResult.booking.status !== 'Cancelled') taskResult = createScaffoldTasks(jobId, store, options);
  }
  return { job_id: jobId, requirement: eval_, booking: bookingResult, tasks: taskResult,
    success: !!bookingResult.booking && bookingResult.booking.status !== 'Cancelled' && taskResult.created.length + taskResult.reused.length === 1 };
}

