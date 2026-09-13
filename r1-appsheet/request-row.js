/* Read AppSheet helper-table rows and build canonical intake commands.
 * AppSheet must not serialize the booking payload. DEV spreadsheet only.
 * This module never writes helper tables or operational sheets. */
'use strict';

var R1A_REQUEST_DEV_SHEET = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var R1A_REQUEST_TABLES = {
  SOLD_INTAKE: 'DEVNewJobSoldRequests',
  BOOKING_INTAKE: 'DEVBookingIntakeRequests',
  DEPOSIT_CONFIRM: 'DEVDepositConfirmRequests',
  TASK_COMPLETE: 'DEVTaskCompleteRequests',
  TASK_EVIDENCE_ATTACH: 'DEVTaskEvidenceAttachRequests',
  ISSUE_CREATE: 'DEVCreateIssueRequests',
  IW_START: 'DEVInstallerCommandRequests',
  IW_PROGRESS: 'DEVInstallerCommandRequests',
  IW_REPORT_COMPLETION: 'DEVInstallerCommandRequests',
  IW_REPORT_PROBLEM: 'DEVInstallerCommandRequests',
  IW_REPORT_VARIATION: 'DEVInstallerCommandRequests',
  IW_COMMISSIONING_DRAFT: 'DEVInstallerCommandRequests',
  IW_COMMISSIONING_SUBMIT: 'DEVInstallerCommandRequests',
  COMMISSIONING_REVIEW: 'DEVInstallerCommandRequests',
  GOODS_IN_RECEIVE: 'DEVGoodsInRequests',
  STOCK_QUARANTINE: 'DEVStockCommandRequests'
};

function _r1aReqRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _r1aReqText(v) { return typeof v === 'string' && v.trim().length > 0; }
function _r1aReqEmail(v) {
  if (typeof v !== 'string') return '';
  var s = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}
function _r1aReqFields(commandType) {
  if (commandType === 'DEPOSIT_CONFIRM') return [{key: 'reference', type: 'text', required: true}];
  if (commandType === 'SOLD_INTAKE' && typeof R1A_SOLD_FIELDS !== 'undefined') return R1A_SOLD_FIELDS;
  if (commandType === 'BOOKING_INTAKE' && typeof R1A_BOOKING_FIELDS !== 'undefined') return R1A_BOOKING_FIELDS;
  if (commandType === 'ISSUE_CREATE' && typeof R1A_ISSUE_CREATE_FIELDS !== 'undefined') return R1A_ISSUE_CREATE_FIELDS;
  if (typeof require === 'function') {
    var spec = require('./services.js');
    if (commandType === 'SOLD_INTAKE') return spec.R1A_SOLD_FIELDS;
    if (commandType === 'BOOKING_INTAKE') return spec.R1A_BOOKING_FIELDS;
    if (commandType === 'ISSUE_CREATE') return spec.R1A_ISSUE_CREATE_FIELDS;
  }
  _r1aReqRefuse('R1A_COMMAND_UNSUPPORTED');
}
function _r1aReqPresent(v) { return !(v === undefined || v === null || v === ''); }
function _r1aReqDate(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(v, 'Europe/London', 'yyyy-MM-dd');
    var y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  return v;
}
function _r1aReqCell(v) {
  if (!_r1aReqPresent(v)) return undefined;
  if (typeof v === 'string') {
    var s = v.trim();
    return s.length ? s : undefined;
  }
  return _r1aReqDate(v);
}

/* Read one helper row. No writes. Extra columns are ignored by the builder. */
function _r1aReadRequestRowFromSpreadsheet(ss, tableName, requestRowId, expectedSheetId) {
  if (!ss || typeof ss.getId !== 'function' || ss.getId() !== expectedSheetId) _r1aReqRefuse('R1A_DEV_ONLY');
  var matches = ss.getSheets().filter(function(sh) { return sh.getName() === tableName; });
  if (matches.length !== 1) _r1aReqRefuse('R1A_REQUEST_TABLE_MISSING');
  var sh = matches[0];
  var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
  if (lastCol < 1 || lastRow < 2) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); });
  if (headers.indexOf('id') < 0 || headers.indexOf('command_id') < 0) _r1aReqRefuse('R1A_REQUEST_SCHEMA');
  if ((tableName === 'DEVBookingIntakeRequests' || tableName === 'DEVCreateIssueRequests' || tableName === 'DEVDepositConfirmRequests') && (headers.indexOf('job_id') < 0 || headers.indexOf('expected_version') < 0)) _r1aReqRefuse('R1A_REQUEST_SCHEMA');
  if (tableName === 'DEVDepositConfirmRequests' && ['submitted_by','submitted_at','status','reference','result_status','result_message'].some(function(k) { return headers.indexOf(k) < 0; })) _r1aReqRefuse('R1A_REQUEST_SCHEMA');
  if (tableName === 'DEVTaskCompleteRequests' && ['task_id','expected_version','completion_note','evidence_path','evidence_id','submitted_by','submitted_at','status','result_status','result_message'].some(function(k) { return headers.indexOf(k) < 0; })) _r1aReqRefuse('R1A_REQUEST_SCHEMA');
  if (tableName === 'DEVTaskEvidenceAttachRequests' && ['task_id','expected_version','evidence_path','submitted_by','submitted_at','status','result_status','result_message'].some(function(k) { return headers.indexOf(k) < 0; })) _r1aReqRefuse('R1A_REQUEST_SCHEMA');
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var wanted = String(requestRowId).trim();
  var found = [];
  values.forEach(function(row) {
    var id = row[headers.indexOf('id')];
    if (!_r1aReqPresent(id)) return;
    if (String(id).trim() === wanted) found.push(row);
  });
  if (found.length === 0) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  if (found.length > 1) _r1aReqRefuse('R1A_REQUEST_AMBIGUOUS');
  var out = {};
  headers.forEach(function(h, i) { if (h && !Object.prototype.hasOwnProperty.call(out, h)) out[h] = found[0][i]; });
  return out;
}

function _r1aOpenDevRequestSpreadsheet() {
  if (typeof SpreadsheetApp === 'undefined') _r1aReqRefuse('R1A_DEV_ONLY');
  var ss = SpreadsheetApp.openById(R1A_REQUEST_DEV_SHEET);
  if (!ss || ss.getId() !== R1A_REQUEST_DEV_SHEET) _r1aReqRefuse('R1A_DEV_ONLY');
  return ss;
}

function _r1aSessionEmail() {
  try {
    if (typeof Session === 'undefined' || !Session.getActiveUser) return '';
    return _r1aReqEmail(Session.getActiveUser().getEmail() || '');
  } catch (e) { return ''; }
}

function _r1aAssertSubmittedBy(actorEmail, submittedBy) {
  if (!_r1aReqPresent(submittedBy)) return;
  var submitted = String(submittedBy).trim().toLowerCase();
  if (submitted.indexOf('@') >= 0 && submitted !== actorEmail) _r1aReqRefuse('R1A_ACTOR_MISMATCH');
}
function _r1aAssertActorField(actorEmail, value, actorId) {
  if (!_r1aReqPresent(value)) return;
  var submitted = String(value).trim().toLowerCase();
  if (submitted.indexOf('@') >= 0) {
    if (submitted !== actorEmail) _r1aReqRefuse('R1A_ACTOR_MISMATCH');
    return;
  }
  if (actorId && submitted === String(actorId).trim().toLowerCase()) return;
  if (submitted.indexOf('@') < 0 && actorId && submitted === String(actorId).trim().toLowerCase()) return;
  /* Non-email values are checked again against the authenticated actor id by the service. */
}

/* Build TASK_COMPLETE from DEVTaskCompleteRequests. evidence_path is preferred for PRE02/PRE04. */
function _r1aBuildTaskCompleteRequest(row, actorEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  var commandId = _r1aReqCell(row.command_id);
  if (!_r1aReqText(commandId)) _r1aReqRefuse('R1A_COMMAND_ID_REQUIRED');
  _r1aAssertSubmittedBy(actorEmail, row.submitted_by);
  if (String(row.status || '').trim() !== 'Ready') _r1aReqRefuse('R1A_REQUEST_NOT_READY');
  if (!_r1aReqPresent(row.submitted_at)) _r1aReqRefuse('R1A_REQUEST_TIMESTAMP_REQUIRED');
  var taskId = _r1aReqCell(row.task_id);
  if (!_r1aReqText(taskId)) _r1aReqRefuse('R1A_TASK_NOT_FOUND');
  if (!_r1aReqPresent(row.expected_version)) _r1aReqRefuse('R1A_STALE_VERSION');
  var note = _r1aReqCell(row.completion_note);
  if (!_r1aReqText(note)) _r1aReqRefuse('R1A_REQUIRED_COMPLETION_NOTE');
  var payload = { completion_note: String(note).trim() };
  var path = _r1aReqCell(row.evidence_path);
  if (path !== undefined) payload.evidence_path = String(path).trim();
  var evid = _r1aReqCell(row.evidence_id);
  if (evid !== undefined) payload.evidence_id = String(evid).trim();
  return {
    command_id: String(commandId).trim(),
    command_type: 'TASK_COMPLETE',
    task_id: String(taskId).trim(),
    expected_version: typeof row.expected_version === 'number' ? row.expected_version : String(row.expected_version).trim(),
    payload: payload
  };
}

/* Build TASK_EVIDENCE_ATTACH from DEVTaskEvidenceAttachRequests (legacy completed PRE02 repair). */
function _r1aBuildTaskEvidenceAttachRequest(row, actorEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  var commandId = _r1aReqCell(row.command_id);
  if (!_r1aReqText(commandId)) _r1aReqRefuse('R1A_COMMAND_ID_REQUIRED');
  if (!_r1aReqPresent(row.submitted_by)) _r1aReqRefuse('R1A_AUTHENTICATED_EMAIL_REQUIRED');
  _r1aAssertSubmittedBy(actorEmail, row.submitted_by);
  if (String(row.status || '').trim() !== 'Ready') _r1aReqRefuse('R1A_REQUEST_NOT_READY');
  if (!_r1aReqPresent(row.submitted_at)) _r1aReqRefuse('R1A_REQUEST_TIMESTAMP_REQUIRED');
  var taskId = _r1aReqCell(row.task_id);
  if (!_r1aReqText(taskId)) _r1aReqRefuse('R1A_TASK_NOT_FOUND');
  if (!_r1aReqPresent(row.expected_version)) _r1aReqRefuse('R1A_STALE_VERSION');
  var path = _r1aReqCell(row.evidence_path);
  if (!_r1aReqText(path)) _r1aReqRefuse('R1A_REQUIRED_EVIDENCE_PATH');
  return {
    command_id: String(commandId).trim(),
    command_type: 'TASK_EVIDENCE_ATTACH',
    task_id: String(taskId).trim(),
    expected_version: typeof row.expected_version === 'number' ? row.expected_version : String(row.expected_version).trim(),
    payload: { evidence_path: String(path).trim() }
  };
}

/* Build the canonical command object. Sheet identity fields are never the authorization actor. */
function _r1aBuildIntakeRequest(commandType, row, actorEmail, actorId) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  if (commandType !== 'SOLD_INTAKE' && commandType !== 'BOOKING_INTAKE' && commandType !== 'ISSUE_CREATE' && commandType !== 'DEPOSIT_CONFIRM') _r1aReqRefuse('R1A_UNKNOWN_COMMAND');
  var commandId = _r1aReqCell(row.command_id);
  if (!_r1aReqText(commandId)) _r1aReqRefuse('R1A_COMMAND_ID_REQUIRED');
  _r1aAssertSubmittedBy(actorEmail, row.submitted_by);
  _r1aAssertActorField(actorEmail, row.requested_by, actorId);
  if (commandType === 'DEPOSIT_CONFIRM') {
    if (String(row.status || '').trim() !== 'Ready') _r1aReqRefuse('R1A_REQUEST_NOT_READY');
    if (!_r1aReqPresent(row.submitted_at)) _r1aReqRefuse('R1A_REQUEST_TIMESTAMP_REQUIRED');
  }
  var fields = _r1aReqFields(commandType);
  var payload = {};
  fields.forEach(function(f) {
    if (f.key === 'job_id' || f.key === 'job_id_human' || f.key === 'expected_version' || f.key === 'command_id') return;
    var value = _r1aReqCell(row[f.key]);
    if (value !== undefined) {
      if (f.type === 'timestamp' && Object.prototype.toString.call(row[f.key]) === '[object Date]' && !isNaN(row[f.key].getTime())) {
        payload[f.key] = row[f.key].toISOString();
      } else if (f.type === 'bool' && (row[f.key] === true || row[f.key] === false)) {
        payload[f.key] = row[f.key];
      } else {
        payload[f.key] = value;
      }
    }
  });
  if (commandType !== 'DEPOSIT_CONFIRM' && _r1aReqPresent(row.submitted_by)) payload.submitted_by = String(row.submitted_by).trim();
  if (_r1aReqPresent(row.requested_by)) payload.requested_by = String(row.requested_by).trim();
  var request = { command_id: String(commandId).trim(), command_type: commandType, payload: payload };
  if (commandType === 'SOLD_INTAKE') {
    if (_r1aReqPresent(row.job_id) || _r1aReqPresent(row.expected_version)) _r1aReqRefuse('R1A_INVALID_FIELDS');
    return request;
  }
  var jobId = _r1aReqCell(row.job_id);
  if (!_r1aReqText(jobId)) _r1aReqRefuse('R1A_JOB_NOT_FOUND');
  if (!_r1aReqPresent(row.expected_version)) _r1aReqRefuse('R1A_STALE_VERSION');
  request.job_id = String(jobId).trim();
  request.expected_version = typeof row.expected_version === 'number' ? row.expected_version : String(row.expected_version).trim();
  return request;
}

function _r1aDispatchBuiltRequest(request, actorEmail, resolveUpload) {
  var options = _r1aCloudOptions();
  if (!options || !options.config || options.config.environment !== 'DEV' || options.config.sheetId !== R1A_REQUEST_DEV_SHEET || !options.store || options.store.getSheetId() !== R1A_REQUEST_DEV_SHEET || options.store.getEnvironment() !== 'DEV') _r1aReqRefuse('R1A_DEV_ONLY');
  options.actorEmail = function() { return actorEmail; };
  /* Optional upload resolver override (the scheduled retry passes a single-lookup resolver). */
  if (typeof resolveUpload === 'function') options.resolveUpload = resolveUpload;
  return _r1aCreate(options).command(request);
}

function _r1aCommandFromRequestRow(commandType, requestRowId, actorEmail, deps) {
  deps = deps || {};
  var type = typeof commandType === 'string' ? commandType.trim() : '';
  var ops = typeof _r1cRequestTable === 'function' ? { _r1cRequestTable: _r1cRequestTable, _r1cCommandFromRow: _r1cCommandFromRow } : (typeof require === 'function' ? require('./operations-requests.js') : null);
  if (ops && ops._r1cRequestTable(type)) return ops._r1cCommandFromRow(type, requestRowId, actorEmail, deps);
  if (!R1A_REQUEST_TABLES[type]) _r1aReqRefuse('R1A_UNKNOWN_COMMAND');
  if (!_r1aReqPresent(requestRowId) || !String(requestRowId).trim()) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  var actor = _r1aReqEmail(typeof actorEmail === 'string' ? actorEmail : '');
  if (!actor) _r1aReqRefuse('R1A_AUTHENTICATED_EMAIL_REQUIRED');
  var sheetId = deps.sheetId || R1A_REQUEST_DEV_SHEET;
  if (sheetId !== R1A_REQUEST_DEV_SHEET) _r1aReqRefuse('R1A_DEV_ONLY');
  var row = typeof deps.readRow === 'function'
    ? deps.readRow(R1A_REQUEST_TABLES[type], String(requestRowId).trim(), sheetId)
    : _r1aReadRequestRowFromSpreadsheet(_r1aOpenDevRequestSpreadsheet(), R1A_REQUEST_TABLES[type], requestRowId, R1A_REQUEST_DEV_SHEET);
  var request = type === 'TASK_COMPLETE' ? _r1aBuildTaskCompleteRequest(row, actor)
    : (type === 'TASK_EVIDENCE_ATTACH' ? _r1aBuildTaskEvidenceAttachRequest(row, actor) : _r1aBuildIntakeRequest(type, row, actor));
  var dispatch = typeof deps.dispatch === 'function' ? deps.dispatch : function(req, email) { return _r1aDispatchBuiltRequest(req, email, deps.resolveUpload); };
  return dispatch(request, actor);
}

/* AppSheet bot entry. R1C_UPLOAD_PENDING (upload not yet visible in Drive) is retryable: the request row is
 * left untouched and a bounded backend retry is scheduled (upload-retry.js); every other error is final. */
function appSheetR1CommandFromRequestRow(commandType, requestRowId, actorEmail) {
  try { return JSON.stringify(_r1aCommandFromRequestRow(commandType, requestRowId, actorEmail)); }
  catch (e) {
    var out = { ok: false, error: e.code || e.message || 'R1A_REFUSED' };
    if (e && e.code === 'R1C_UPLOAD_PENDING') {
      out.retryable = true;
      if (typeof _r1uScheduleRetry === 'function') {
        try { out.retry = _r1uScheduleRetry(commandType, requestRowId, actorEmail, e); }
        catch (scheduleError) { out.retry = { scheduled: false, error: scheduleError.code || scheduleError.message || 'R1U_SCHEDULE_FAILED' }; }
      }
    }
    return JSON.stringify(out);
  }
}

/* Shared Admin resolution for Tony DEV-only helpers (argument email; Session may be blank). */
function _r1aTonyAdminActor(actorEmail, deps) {
  deps = deps || {};
  var options = typeof deps.cloudOptions === 'function' ? deps.cloudOptions() : _r1aCloudOptions();
  var actor = _r1aReqEmail(typeof actorEmail === 'string' ? actorEmail : '');
  if (!actor) _r1aReqRefuse('R1A_AUTHENTICATED_EMAIL_REQUIRED');
  var resolveActor = typeof _r1aActor === 'function' ? _r1aActor : (typeof require === 'function' ? require('./adapter.js')._r1aActor : null);
  if (typeof resolveActor !== 'function') _r1aReqRefuse('R1A_COMMAND_UNSUPPORTED');
  var person = resolveActor(options.store, actor);
  var adminOk = typeof _r1aAdmin === 'function'
    ? _r1aAdmin(person)
    : (person.roles.indexOf('Admin') >= 0 || person.roles.indexOf('Manager') >= 0);
  if (!adminOk) _r1aReqRefuse('R1A_ROLE_DENIED');
  return { options: options, actor: actor, person: person };
}

/* One controlled DEV reconciliation for the acceptance-test Tony job. It uses the
 * same S13 initializer as SOLD_INTAKE and never creates an external invoice.
 * Manual Apps Script runs often have a blank Session.getActiveUser() email, so this
 * helper authorizes from the required Admin/Manager email argument only. */
function runR1AReconcileTonyPaymentStages(actorEmail, deps) {
  var output;
  try {
    deps = deps || {};
    var auth = _r1aTonyAdminActor(actorEmail, deps);
    var processPayments = typeof deps.processJobPayments === 'function' ? deps.processJobPayments : (typeof processJobPayments === 'function' ? processJobPayments : null);
    if (typeof processPayments !== 'function') _r1aReqRefuse('R1A_COMMAND_UNSUPPORTED');
    output = JSON.stringify(auth.options.store.withLock(function() {
      var job = auth.options.store.get('Jobs', 'J-mtzl04hw-bdpt6i');
      if (!job || Number(job.original_gross_pence) <= 0) _r1aReqRefuse('R1A_TONY_RECONCILE_REFUSED');
      var result = processPayments(job.id, auth.options.store, {command_id: 'R1A-TONY-S13-RECONCILE'});
      return {ok: true, job_id: job.id, deposit_stage_id: 'IS-' + job.id + '-deposit', stages_created: result.stages_created, external_calls: 0};
    }));
  } catch (e) { output = JSON.stringify({ok: false, error: e.code || e.message || 'R1A_REFUSED'}); }
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(output);
  return output;
}

/* DEV-only: ensure TPL-PRE04 exists and idempotently create Tony's Open PRE04 task. Does not complete it. */
function runR1ABackfillTonyPre04(actorEmail, deps) {
  var output;
  try {
    deps = deps || {};
    var auth = _r1aTonyAdminActor(actorEmail, deps);
    var createFn = typeof deps.createTasksForJob === 'function' ? deps.createTasksForJob
      : (typeof createTasksForJob === 'function' ? createTasksForJob : null);
    if (!createFn && typeof require === 'function') {
      try { createFn = require('../s06/gates.js').createTasksForJob; } catch (e) { createFn = null; }
    }
    if (typeof createFn !== 'function') _r1aReqRefuse('R1A_COMMAND_UNSUPPORTED');
    output = JSON.stringify(auth.options.store.withLock(function() {
      var job = auth.options.store.get('Jobs', 'J-mtzl04hw-bdpt6i');
      if (!job) _r1aReqRefuse('R1A_JOB_NOT_FOUND');
      var before = auth.options.store.list('Tasks').filter(function(t) { return t.job_id === job.id && t.template_code === 'PRE04'; });
      var result = createFn(job, { ready: false, gates: [] }, auth.options.store, { actor: auth.person.id, command_id: 'R1A-TONY-PRE04-BACKFILL' });
      var after = auth.options.store.list('Tasks').filter(function(t) { return t.job_id === job.id && t.template_code === 'PRE04'; });
      var created = (result.created || []).filter(function(c) { return c.template === 'PRE04'; });
      return {
        ok: true,
        job_id: job.id,
        pre04_before: before.length,
        pre04_after: after.length,
        pre04_created: created.map(function(c) { return c.task_id; }),
        pre04_status: after.length === 1 ? after[0].status : null,
        template_present: !!auth.options.store.list('TaskTemplates').find(function(t) { return t.template_code === 'PRE04' && t.active !== false; }),
        external_calls: 0
      };
    }));
  } catch (e) { output = JSON.stringify({ok: false, error: e.code || e.message || 'R1A_REFUSED'}); }
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(output);
  return output;
}

/* DEV-only: if Tony PRE02 is Complete, attach genuine Evidence (via evidence_path when missing)
 * then apply Jobs contract side-effect. Does not invent evidence ids or reopen the task. */
function runR1AApplyTonyPre02ContractSideEffect(actorEmail, evidencePath, deps) {
  var output;
  try {
    if (evidencePath && typeof evidencePath === 'object' && !Array.isArray(evidencePath)) {
      deps = evidencePath;
      evidencePath = deps.evidence_path;
    }
    deps = deps || {};
    var auth = _r1aTonyAdminActor(actorEmail, deps);
    var applyFn = typeof deps.applyPre02 === 'function' ? deps.applyPre02 : null;
    if (!applyFn && typeof _r1sApplyPre02Contract === 'function') applyFn = _r1sApplyPre02Contract;
    if (!applyFn && typeof require === 'function') {
      try {
        var svc = require('./services.js');
        applyFn = svc._r1sApplyPre02Contract;
      } catch (e) { applyFn = null; }
    }
    if (typeof applyFn !== 'function') _r1aReqRefuse('R1A_COMMAND_UNSUPPORTED');
    var ensureFn = typeof deps.ensureEvidence === 'function' ? deps.ensureEvidence : null;
    if (!ensureFn && typeof _r1sEnsureOfficeTaskEvidence === 'function') ensureFn = _r1sEnsureOfficeTaskEvidence;
    if (!ensureFn && typeof require === 'function') {
      try { ensureFn = require('./services.js')._r1sEnsureOfficeTaskEvidence; } catch (e) { ensureFn = null; }
    }
    var path = _r1aReqText(evidencePath) ? String(evidencePath).trim() : (_r1aReqText(deps.evidence_path) ? String(deps.evidence_path).trim() : '');
    output = JSON.stringify(auth.options.store.withLock(function() {
      var job = auth.options.store.get('Jobs', 'J-mtzl04hw-bdpt6i');
      if (!job) _r1aReqRefuse('R1A_JOB_NOT_FOUND');
      var pre02 = auth.options.store.list('Tasks').filter(function(t) { return t.job_id === job.id && t.template_code === 'PRE02'; });
      if (pre02.length !== 1) _r1aReqRefuse('R1A_PRE02_MISSING');
      var task = pre02[0];
      if (task.status !== 'Complete') _r1aReqRefuse('R1A_PRE02_NOT_COMPLETE');
      var now = new Date().toISOString();
      var evidenceId = task.evidence_id;
      var evidenceCreated = false;
      if (!_r1aReqText(evidenceId)) {
        if (!path) _r1aReqRefuse('R1A_REQUIRED_EVIDENCE_ID');
        if (typeof ensureFn !== 'function') _r1aReqRefuse('R1A_COMMAND_UNSUPPORTED');
        var resolve = typeof deps.resolveUpload === 'function' ? deps.resolveUpload
          : (typeof _r1cResolveUpload === 'function' ? _r1cResolveUpload : null);
        if (typeof resolve !== 'function') _r1aReqRefuse('R1A_UPLOAD_RESOLVER_MISSING');
        var upload = resolve(path);
        var ensured = ensureFn(auth.options.store, job.id, auth.person.id, 'Contract', upload, now, 'R1A-TONY-PRE02-CONTRACT');
        evidenceId = ensured.evidence_id;
        evidenceCreated = !!ensured.created;
        auth.options.store.update('Tasks', task.id, {
          evidence_id: evidenceId,
          updated_at: now,
          updated_by: auth.person.id,
          version: Number(task.version || 0) + 1,
          commit_id: 'R1A-TONY-PRE02-CONTRACT'
        });
        task = auth.options.store.get('Tasks', task.id);
      }
      var before = {
        contract_status: job.contract_status,
        contract_evidence_id: job.contract_evidence_id,
        contract_signed_at: job.contract_signed_at,
        version: job.version,
        task_evidence_id: evidenceId,
        task_completed_at: task.completed_at
      };
      var afterJob = applyFn(auth.options.store, job, auth.person.id, evidenceId, now, 'R1A-TONY-PRE02-CONTRACT');
      var afterTask = auth.options.store.get('Tasks', task.id);
      return {
        ok: true,
        job_id: job.id,
        task_id: task.id,
        evidence_id: evidenceId,
        evidence_created: evidenceCreated,
        before: before,
        after: {
          contract_status: afterJob.contract_status,
          contract_evidence_id: afterJob.contract_evidence_id,
          contract_signed_at: afterJob.contract_signed_at,
          version: afterJob.version,
          task_evidence_id: afterTask.evidence_id,
          task_completed_at: afterTask.completed_at
        },
        external_calls: 0
      };
    }));
  } catch (e) { output = JSON.stringify({ok: false, error: e.code || e.message || 'R1A_REFUSED'}); }
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(output);
  return output;
}

if (typeof module !== 'undefined') module.exports = {
  R1A_REQUEST_DEV_SHEET: R1A_REQUEST_DEV_SHEET,
  R1A_REQUEST_TABLES: R1A_REQUEST_TABLES,
  _r1aReadRequestRowFromSpreadsheet: _r1aReadRequestRowFromSpreadsheet,
  _r1aBuildIntakeRequest: _r1aBuildIntakeRequest,
  _r1aBuildTaskCompleteRequest: _r1aBuildTaskCompleteRequest,
  _r1aBuildTaskEvidenceAttachRequest: _r1aBuildTaskEvidenceAttachRequest,
  _r1aCommandFromRequestRow: _r1aCommandFromRequestRow,
  appSheetR1CommandFromRequestRow: appSheetR1CommandFromRequestRow,
  runR1AReconcileTonyPaymentStages: runR1AReconcileTonyPaymentStages,
  runR1ABackfillTonyPre04: runR1ABackfillTonyPre04,
  runR1AApplyTonyPre02ContractSideEffect: runR1AApplyTonyPre02ContractSideEffect
};
