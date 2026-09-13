/* DEV AppSheet operations boundary. Request rows are input only; authenticated actor is supplied separately.
 * Existing IW/MAT services own business transitions. Validate against a buffered store before any write,
 * then journal/flush under the script lock; incomplete flushes require review, never blind replay. */
'use strict';
var R1C_COMMANDS = {
  IW_START: { fields: ['reason'], target: 'WorkPackages', fn: '_iwStart' },
  IW_PROGRESS: { fields: ['note','evidence','reason'], target: 'WorkPackages', fn: '_iwProgress' },
  IW_REPORT_COMPLETION: { fields: ['outcome','actual_end','return_reason','evidence','reason'], target: 'WorkPackages', fn: '_iwReportCompletion' },
  IW_REPORT_PROBLEM: { fields: ['category','description','evidence','reason'], target: 'WorkPackages', fn: '_iwReportProblem' },
  IW_REPORT_VARIATION: { fields: ['description','evidence','reason'], target: 'WorkPackages', fn: '_iwReportVariation' },
  IW_COMMISSIONING_DRAFT: { fields: ['submission_id','expected_submission_version','answers','evidence','reason'], target: 'WorkPackages', fn: '_iwSaveCommissioningDraft' },
  IW_COMMISSIONING_SUBMIT: { fields: ['submission_id','reason'], target: 'CommissioningSubmissions', fn: '_iwSubmitCommissioning' },
  COMMISSIONING_REVIEW: { fields: ['submission_id','status','review_notes'], target: 'CommissioningSubmissions', fn: '_r1cReviewSubmission' },
  GOODS_IN_RECEIVE: { fields: ['delivery_id','delivery_note_reference','delivery_note_file_id','delivery_note_filename','discrepancy_note','lines'], target: 'Orders', fn: '_matReceiveDelivery' },
  STOCK_QUARANTINE: { fields: ['product_id','quantity','expected_balance','reason','evidence_id'], target: 'Products', fn: '_matQuarantineStock' }
};
var R1C_READS = ['INSTALLER_WORKFLOW','GOODS_IN_DETAIL','STOCK_BALANCE'];
function _r1cFail(code) { var e = new Error(code); e.code = code; throw e; }
function _r1cCopy(x) { return JSON.parse(JSON.stringify(x)); }
function _r1cText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _r1cKeys(x, keys) { if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(function(k) { return keys.indexOf(k) < 0; })) _r1cFail('R1C_INVALID_FIELDS'); }
function _r1cVersion(x) { var n = typeof x === 'string' && /^[1-9][0-9]*$/.test(x) ? Number(x) : x; if (!Number.isSafeInteger(n) || n < 1) _r1cFail('R1C_EXPECTED_VERSION_REQUIRED'); return n; }
function _r1cCanonical(x) { if (Array.isArray(x)) return x.map(_r1cCanonical); if (x && typeof x === 'object') { var o = {}; Object.keys(x).sort().forEach(function(k) { o[k] = _r1cCanonical(x[k]); }); return o; } return x; }
function _r1cFn(name) {
  var g = typeof globalThis !== 'undefined' ? globalThis : this;
  if (typeof g[name] === 'function') return g[name];
  if (typeof require === 'function') {
    if(name==='_r1cS12ReviewSubmission')return require('../s12/commissioning.js').reviewSubmission;
    var m = name.indexOf('_iw') === 0 ? require('../installer/workflow.js') : name.indexOf('_mat') === 0 ? require('../materials/workflow.js') : null;
    if (m && typeof m[name] === 'function') return m[name];
  }
  _r1cFail('R1C_BACKEND_MISSING_' + name);
}
function _r1cRole(a, allowed) { if (!a.roles.some(function(r) { return allowed.indexOf(r) >= 0; })) _r1cFail('R1C_ROLE_DENIED'); }
function _r1cOffice(a) { return a.roles.some(function(r) { return ['Admin','Manager','Office'].indexOf(r) >= 0; }); }
function _r1cMode(s, fn, release) { var r = s.list('ReleaseModes').filter(function(m) { return m.function_id === fn; }); if (r.length !== 1 || r[0].mode !== 'Automated' || r[0].authorised_job_scope !== 'Pilot' || r[0].target_release !== release) _r1cFail('R1C_MODE_DENIED_' + fn); }
function _r1cJob(s, id) { var j = s.get('Jobs', id); if (!j || j.pilot_job !== true) _r1cFail('R1C_PILOT_REQUIRED'); if (j.archived_at || j.cancellation_at || ['Cancelled','CancellationInProgress'].indexOf(j.workflow_stage) >= 0 || s.list('Tasks').some(function(t) { return t.job_id === id && t.template_code === 'S15-REOPEN-REVIEW' && ['Complete','NotRequired'].indexOf(t.status) < 0; })) _r1cFail('R1C_JOB_NOT_ACTIONABLE'); return j; }
function _r1cAccess(s, a, r, mutate) {
  var p = r.payload || {}, type = r.command_type || r.read_type, row, job;
  if (type === 'GOODS_IN_RECEIVE' || type === 'GOODS_IN_DETAIL') {
    _r1cRole(a, ['Store','Office','Manager','Admin']); _r1cMode(s, 'FN-03', 'R2'); _r1cMode(s, 'FN-05', 'R2');
    var d = s.get('Deliveries', p.delivery_id); if (!d) _r1cFail('R1C_DELIVERY_NOT_FOUND');
    row = s.get('Orders', d.order_id); if (!row) _r1cFail('R1C_ORDER_NOT_FOUND'); job = _r1cJob(s, row.job_id);
    if (job.release_scope !== 'R2' || (mutate && r.job_id !== job.id)) _r1cFail('R1C_JOB_MISMATCH');
    return { row: row, job: job, delivery: d };
  }
  if (type === 'STOCK_QUARANTINE' || type === 'STOCK_BALANCE') {
    _r1cRole(a, ['Store','Manager','Admin']); _r1cMode(s, 'FN-05', 'R2');
    row = s.get('Products', p.product_id); if (!row || row.active !== true || row.stock_tracked !== true) _r1cFail('R1C_STOCK_PRODUCT_REQUIRED');
    if (r.job_id || r.work_package_id) _r1cFail('R1C_INVALID_FIELDS');
    return { row: row };
  }
  _r1cRole(a, type === 'COMMISSIONING_REVIEW' ? ['Office','Manager','Admin'] : ['Installer','Office','Manager','Admin']);
  _r1cMode(s, 'FN-06', 'R3');
  var wp = s.get('WorkPackages', r.work_package_id); if (!wp) _r1cFail('R1C_WORK_PACKAGE_NOT_FOUND');
  job = _r1cJob(s, wp.job_id); if (mutate && r.job_id !== job.id) _r1cFail('R1C_JOB_MISMATCH');
  var assigned = s.list('Allocations').some(function(al) { return al.work_package_id === wp.id && al.person_id === a.id && al.active === true; });
  if (type !== 'COMMISSIONING_REVIEW' && !assigned && !_r1cOffice(a)) _r1cFail('R1C_ASSIGNMENT_DENIED');
  if (mutate && type !== 'COMMISSIONING_REVIEW' && !assigned && !_r1cText(p.reason)) _r1cFail('R1C_OFFICE_REASON_REQUIRED');
  row = wp;
  if (type === 'IW_COMMISSIONING_SUBMIT' || type === 'COMMISSIONING_REVIEW') {
    row = s.get('CommissioningSubmissions', p.submission_id);
    if (!row || row.work_package_id !== wp.id || row.job_id !== job.id) _r1cFail('R1C_SUBMISSION_MISMATCH');
    if (type === 'COMMISSIONING_REVIEW') _r1cMode(s, 'FN-07', 'R3');
  }
  return { row: row, wp: wp, job: job };
}
/* Reads add workflow/version context; the existing My Installs slice remains the assigned-work list. */
function _r1cRead(s, a, r) {
  if(s.getSheetId()!=='1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc'||s.getEnvironment()!=='DEV')_r1cFail('R1C_DEV_ONLY');
  if(typeof PropertiesService!=='undefined')_r1cConfigGuard();
  _r1cKeys(r, ['read_type','work_package_id','payload']);
  _r1cKeys(r.payload || {}, r.read_type === 'GOODS_IN_DETAIL' ? ['delivery_id'] : r.read_type === 'STOCK_BALANCE' ? ['product_id'] : []);
  var c = _r1cAccess(s, a, r, false), out;
  if (r.read_type === 'STOCK_BALANCE') out = { product_id: c.row.id, name: c.row.name, expected_version: c.row.version, store_balance: _r1cFn('_matStockBalance')(s,c.row.id,'LOC-store'), quarantine_balance: _r1cFn('_matStockBalance')(s,c.row.id,'LOC-quarantine') };
  else if (r.read_type === 'GOODS_IN_DETAIL') out = { job_id: c.job.id, job_label: c.job.display_name, delivery_id: c.delivery.id, order_id: c.row.id, expected_version: c.row.version, receipt_status: c.delivery.receipt_status, lines: _r1cFn('_matOrderView')(s,c.row.id).lines };
  else {
    var subs = s.list('CommissioningSubmissions').filter(function(x) { return x.work_package_id === c.wp.id; });
    var superseded = subs.map(function(x) { return x.supersedes_submission_id; });
    var current = subs.filter(function(x) { return superseded.indexOf(x.id) < 0; });
    var sub = current.length === 1 ? current[0] : null;
    var templates = s.list('CommissioningTemplates').filter(function(t) { return t.trade === c.wp.trade && t.active === true && t.approved_by && t.approved_at; });
    out = { job_id: c.job.id, job_label: c.job.display_name, work_package_id: c.wp.id, status: c.wp.status, expected_version: c.wp.version, commissioning_required: c.wp.commissioning_required === true, submission: sub ? { id: sub.id, status: sub.status, expected_version: sub.version, template_version: sub.template_version, review_notes: sub.review_notes } : null,
      answers: sub ? s.list('CommissioningAnswers').filter(function(x) { return x.submission_id === sub.id; }) : [],
      questions: s.list('CommissioningQuestions').filter(function(q) { return templates.some(function(t) { return t.id === q.template_id && (!sub || t.template_version === sub.template_version); }); }),
      evidence: s.list('Evidence').filter(function(e) { return e.submission_id && sub && e.submission_id === sub.id; }).map(function(e) { return { id:e.id, filename:e.filename, drive_file_id:e.drive_file_id, category:e.category }; }) };
  }
  return { ok:true, read_type:r.read_type, actor_id:a.id, data:out };
}
function _r1cReviewSubmission(s, p) {
  var sub = s.get('CommissioningSubmissions',p.submission_id);
  if (['Submitted','UnderReview'].indexOf(sub.status) < 0 || ['Accepted','Returned'].indexOf(p.status) < 0 || !_r1cText(p.review_notes)) _r1cFail('R1C_REVIEW_STATE_OR_NOTES');
  if (p.status === 'Accepted' && (sub.template_version === 'NOT_CONFIGURED' || !s.list('CommissioningTemplates').some(function(t) { return t.template_version === sub.template_version && t.trade === s.get('WorkPackages',sub.work_package_id).trade && t.active === true && t.approved_by && t.approved_at; }))) _r1cFail('R1C_APPROVED_TEMPLATE_REQUIRED');
  // Existing S12 review transition; approval is a human technical decision, never a fabricated rule.
  var result = _r1cFn('_r1cS12ReviewSubmission')(s,sub.id,p.actor,p.status,p.review_notes);
  if (!result.ok) _r1cFail('R1C_REVIEW_REFUSED');
  s.update('CommissioningSubmissions',sub.id,{updated_by:p.actor}); return result;
}
function _r1cEvidence(s, job, p) {
  (p.evidence || []).forEach(function(e) {
    _r1cKeys(e,['drive_file_id','filename','mime_type']); if (!_r1cText(e.drive_file_id)) _r1cFail('R1C_EVIDENCE_FILE_REQUIRED');
    if (s.list('Evidence').some(function(x) { return x.drive_file_id === e.drive_file_id && x.job_id !== job.id; })) _r1cFail('R1C_CROSS_JOB_EVIDENCE');
  });
}
function _r1cApprovedTemplate(s,wp,sub){
  var candidates=s.list('CommissioningTemplates').filter(function(t){return t.trade===wp.trade&&t.active===true&&t.approved_at&&t.approved_by&&(!sub||sub.template_version==='NOT_CONFIGURED'||t.template_version===sub.template_version);});
  if(candidates.length>1)_r1cFail('R1C_TEMPLATE_AMBIGUOUS');return candidates[0]||null;
}
function _r1cValidate(s, c, r, p) {
  if (p.evidence !== undefined && !Array.isArray(p.evidence)) _r1cFail('R1C_INVALID_EVIDENCE');
  if (c.job) _r1cEvidence(s,c.job,p);
  if (r.command_type === 'IW_COMMISSIONING_DRAFT') {
    var open = s.list('CommissioningSubmissions').filter(function(x) { return x.work_package_id === c.wp.id && ['Draft','Returned'].indexOf(x.status) >= 0; });
    var parents = s.list('CommissioningSubmissions').map(function(x) { return x.supersedes_submission_id; });
    open = open.filter(function(x) { return parents.indexOf(x.id) < 0; });
    if (open.length > 1) _r1cFail('R1C_AMBIGUOUS_SUBMISSION');
    if (open.length && (p.submission_id !== open[0].id || _r1cVersion(p.expected_submission_version) !== Number(open[0].version))) _r1cFail('R1C_STALE_SUBMISSION');
    if (!open.length && (p.submission_id || p.expected_submission_version)) _r1cFail('R1C_STALE_SUBMISSION');
    if (p.answers !== undefined && !Array.isArray(p.answers)) _r1cFail('R1C_INVALID_ANSWERS');
    (p.answers || []).forEach(function(ans) {
      _r1cKeys(ans,['question_key','value_text','value_number','value_date','value_boolean','not_applicable_reason']);
      var template = _r1cApprovedTemplate(s,c.wp,open[0]), templates = template ? [template] : [];
      var q = s.list('CommissioningQuestions').filter(function(x) { return x.question_key === ans.question_key && templates.some(function(t) { return t.id === x.template_id; }); });
      if (q.length !== 1) _r1cFail('R1C_APPROVED_QUESTION_REQUIRED');
      if(ans.value_number!==undefined&&(typeof ans.value_number!=='number'||!Number.isFinite(ans.value_number)))_r1cFail('R1C_INVALID_ANSWER');
      if(ans.value_boolean!==undefined&&typeof ans.value_boolean!=='boolean')_r1cFail('R1C_INVALID_ANSWER');
      if(ans.value_text!==undefined&&typeof ans.value_text!=='string')_r1cFail('R1C_INVALID_ANSWER');
    });
  }
  if (r.command_type === 'GOODS_IN_RECEIVE') {
    if (r.work_package_id) _r1cFail('R1C_INVALID_FIELDS');
    if (!Array.isArray(p.lines) || !p.lines.length) _r1cFail('R1C_RECEIPT_LINES_REQUIRED');
    var seen = {};
    p.lines.forEach(function(l) {
      _r1cKeys(l,['order_line_id','quantity_good','quantity_damaged','quantity_short','evidence_id']);
      if (seen[l.order_line_id]) _r1cFail('R1C_DUPLICATE_RECEIPT_LINE'); seen[l.order_line_id] = true;
      ['quantity_good','quantity_damaged','quantity_short'].forEach(function(k) { if (l[k] !== undefined && (typeof l[k] !== 'number' || !Number.isFinite(l[k]) || l[k] < 0)) _r1cFail('R1C_INVALID_QUANTITY'); });
      if (l.evidence_id) { var e = s.get('Evidence',l.evidence_id); if (!e || e.job_id !== c.job.id) _r1cFail('R1C_CROSS_JOB_EVIDENCE'); }
    });
    if (p.delivery_note_file_id) _r1cEvidence(s,c.job,{evidence:[{drive_file_id:p.delivery_note_file_id}]});
  }
}
function _r1cBuffer(s) {
  var tables = {}, ops = [];
  function rows(n) { if (!tables[n]) tables[n] = _r1cCopy(s.list(n)); return tables[n]; }
  var b = { getSheetId:function(){return s.getSheetId();},getEnvironment:function(){return s.getEnvironment();},list:function(n){return _r1cCopy(rows(n));},get:function(n,id){var m=rows(n).filter(function(r){return r.id===id;});if(m.length>1)_r1cFail('R1C_DUPLICATE_ID');return m.length?_r1cCopy(m[0]):null;},
    insert:function(n,r){if(b.get(n,r.id))_r1cFail('R1C_DUPLICATE_ID');rows(n).push(_r1cCopy(r));ops.push(['insert',n,_r1cCopy(r)]);},
    update:function(n,id,p){var r=rows(n).filter(function(r){return r.id===id;})[0];if(!r)_r1cFail('R1C_ROW_MISSING');Object.assign(r,_r1cCopy(p));ops.push(['update',n,id,_r1cCopy(p)]);},withLock:function(fn){return fn();}};
  return {store:b,flush:function(){ops.forEach(function(op){s[op[0]].apply(s,op.slice(1));});}};
}
function _r1cExecute(s,a,r) {
  if(s.getSheetId()!=='1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc'||s.getEnvironment()!=='DEV')_r1cFail('R1C_DEV_ONLY');
  if(typeof PropertiesService!=='undefined')_r1cConfigGuard();
  _r1cKeys(r,['command_id','command_type','job_id','work_package_id','expected_version','payload']);
  if (!_r1cText(r.command_id) || !/^[A-Za-z0-9_-]{1,128}$/.test(r.command_id)) _r1cFail('R1C_COMMAND_ID_REQUIRED');
  var spec=R1C_COMMANDS[r.command_type]; if(!spec)_r1cFail('R1C_UNKNOWN_COMMAND');
  var p=_r1cCopy(r.payload||{});_r1cKeys(p,spec.fields);r=_r1cCopy(r);r.expected_version=_r1cVersion(r.expected_version);
  var fingerprint=JSON.stringify(_r1cCanonical({request:r,actor:a.id}));
  return s.withLock(function(){
    var c=_r1cAccess(s,a,r,true), jid='CJ-R1C-'+r.command_id, aid='AE-R1C-'+r.command_id, prior=s.get('CommitJournal',jid);
    if(prior){if(prior.changes_json!==fingerprint)_r1cFail('R1C_COMMAND_CONFLICT');if(prior.state!=='Committed')_r1cFail('R1C_RECOVERY_REQUIRED');var audit=s.get('AuditEvents',aid);if(!audit)_r1cFail('R1C_RECOVERY_REQUIRED');return Object.assign(JSON.parse(audit.after_json),{replay:true});}
    if(s.list('CommitJournal').some(function(j){return String(j.id).indexOf('CJ-R1C-')===0&&j.state!=='Committed';}))_r1cFail('R1C_RECOVERY_REQUIRED');
    if(Number(c.row.version)!==r.expected_version)_r1cFail('R1C_STALE_VERSION');
    _r1cValidate(s,c,r,p);
    var now=new Date().toISOString(), buffer=_r1cBuffer(s), b=buffer.store;
    var input=Object.assign({},p,{actor:a.id,received_by:a.id,command_id:'R1C-'+r.command_id,work_package_id:r.work_package_id,expected_version:r.expected_version,at:now});
    // Draft selection is explicit at the boundary; prevent the legacy helper from choosing an older Returned row.
    if(r.command_type==='IW_COMMISSIONING_DRAFT'){
      var draft=p.submission_id?b.get('CommissioningSubmissions',p.submission_id):null,template=_r1cApprovedTemplate(b,c.wp,draft);
      input.template_version=template?template.template_version:'NOT_CONFIGURED';
      if(draft&&draft.status==='Draft'&&draft.template_version==='NOT_CONFIGURED'&&template)b.update('CommissioningSubmissions',draft.id,{template_version:template.template_version});
    }
    var result = r.command_type==='COMMISSIONING_REVIEW' ? _r1cReviewSubmission(b,input) : _r1cFn(spec.fn)(b,input);
    // Append-only progress/issues and draft updates still consume the package version.
    if(c.wp && ['IW_PROGRESS','IW_REPORT_PROBLEM','IW_REPORT_VARIATION','IW_COMMISSIONING_DRAFT'].indexOf(r.command_type)>=0) b.update('WorkPackages',c.wp.id,{version:Number(c.wp.version)+1,updated_at:now,updated_by:a.id});
    var after=b.get(spec.target,c.row.id);result=Object.assign({},result,{replay:false,expected_version:after.version,external_calls:0});
    // Keep installer responses free of office/private issue contents and finance fields.
    if(r.command_type.indexOf('IW_')===0){var safe={replay:false,external_calls:0,expected_version:after.version};['status','outcome','submission_id','template_version','evidence','return_allocation_id','next'].forEach(function(k){if(result[k]!==undefined)safe[k]=result[k];});if(result.issue)safe.issue_id=result.issue.id;if(result.return_package)safe.return_package_id=result.return_package.id;if(result.commissioning_submission)safe.commissioning_submission=result.commissioning_submission;result=safe;}
    s.insert('CommitJournal',{id:jid,commit_id:'R1C-'+r.command_id,state:'Prepared',command_id:r.command_id,entity_type:spec.target,entity_id:c.row.id,expected_version:r.expected_version,changes_json:fingerprint,prepared_at:now,committed_at:null,created_at:now});
    try{buffer.flush();s.insert('AuditEvents',{id:aid,entity_type:spec.target,entity_id:c.row.id,action:r.command_type,before_json:JSON.stringify(c.row),after_json:JSON.stringify(result),initiating_actor:a.id,executing_service:'AppSheetOperations',timestamp:now,correlation_id:r.command_id,reason:p.reason||p.note||p.review_notes||null,commit_id:'R1C-'+r.command_id,created_at:now});s.update('CommitJournal',jid,{state:'Committed',committed_at:now});return result;}
    catch(e){try{s.update('CommitJournal',jid,{state:'RecoveryRequired'});}catch(ignored){}throw e;}
  });
}
if(typeof module!=='undefined')module.exports={R1C_COMMANDS:R1C_COMMANDS,R1C_READS:R1C_READS,_r1cExecute:_r1cExecute,_r1cRead:_r1cRead};
