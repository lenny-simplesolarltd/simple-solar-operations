/* Read AppSheet helper-table rows and build canonical intake commands.
 * AppSheet must not serialize the booking payload. DEV spreadsheet only.
 * This module never writes helper tables or operational sheets. */
'use strict';

var R1A_REQUEST_DEV_SHEET = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var R1A_REQUEST_TABLES = {
  SOLD_INTAKE: 'DEVNewJobSoldRequests',
  BOOKING_INTAKE: 'DEVBookingIntakeRequests',
  ISSUE_CREATE: 'DEVCreateIssueRequests'
};

function _r1aReqRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _r1aReqText(v) { return typeof v === 'string' && v.trim().length > 0; }
function _r1aReqEmail(v) {
  if (typeof v !== 'string') return '';
  var s = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}
function _r1aReqFields(commandType) {
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
  if ((tableName === 'DEVBookingIntakeRequests' || tableName === 'DEVCreateIssueRequests') && (headers.indexOf('job_id') < 0 || headers.indexOf('expected_version') < 0)) _r1aReqRefuse('R1A_REQUEST_SCHEMA');
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

/* Build the canonical command object. Sheet identity fields are never the authorization actor. */
function _r1aBuildIntakeRequest(commandType, row, actorEmail, actorId) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  if (commandType !== 'SOLD_INTAKE' && commandType !== 'BOOKING_INTAKE' && commandType !== 'ISSUE_CREATE') _r1aReqRefuse('R1A_UNKNOWN_COMMAND');
  var commandId = _r1aReqCell(row.command_id);
  if (!_r1aReqText(commandId)) _r1aReqRefuse('R1A_COMMAND_ID_REQUIRED');
  _r1aAssertSubmittedBy(actorEmail, row.submitted_by);
  _r1aAssertActorField(actorEmail, row.requested_by, actorId);
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
  if (_r1aReqPresent(row.submitted_by)) payload.submitted_by = String(row.submitted_by).trim();
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

function _r1aDispatchBuiltRequest(request, actorEmail) {
  var options = _r1aCloudOptions();
  if (!options || !options.config || options.config.environment !== 'DEV' || options.config.sheetId !== R1A_REQUEST_DEV_SHEET || !options.store || options.store.getSheetId() !== R1A_REQUEST_DEV_SHEET || options.store.getEnvironment() !== 'DEV') _r1aReqRefuse('R1A_DEV_ONLY');
  options.actorEmail = function() { return actorEmail; };
  return _r1aCreate(options).command(request);
}

function _r1aCommandFromRequestRow(commandType, requestRowId, actorEmail, deps) {
  deps = deps || {};
  var type = typeof commandType === 'string' ? commandType.trim() : '';
  if (!R1A_REQUEST_TABLES[type]) _r1aReqRefuse('R1A_UNKNOWN_COMMAND');
  if (!_r1aReqPresent(requestRowId) || !String(requestRowId).trim()) _r1aReqRefuse('R1A_REQUEST_NOT_FOUND');
  var actor = _r1aReqEmail(typeof actorEmail === 'string' ? actorEmail : '');
  if (!actor) _r1aReqRefuse('R1A_AUTHENTICATED_EMAIL_REQUIRED');
  var session = typeof deps.sessionEmail === 'string' ? _r1aReqEmail(deps.sessionEmail) : _r1aSessionEmail();
  if (session && session !== actor) _r1aReqRefuse('R1A_ACTOR_MISMATCH');
  var sheetId = deps.sheetId || R1A_REQUEST_DEV_SHEET;
  if (sheetId !== R1A_REQUEST_DEV_SHEET) _r1aReqRefuse('R1A_DEV_ONLY');
  var row = typeof deps.readRow === 'function'
    ? deps.readRow(R1A_REQUEST_TABLES[type], String(requestRowId).trim(), sheetId)
    : _r1aReadRequestRowFromSpreadsheet(_r1aOpenDevRequestSpreadsheet(), R1A_REQUEST_TABLES[type], requestRowId, R1A_REQUEST_DEV_SHEET);
  var request = _r1aBuildIntakeRequest(type, row, actor);
  var dispatch = typeof deps.dispatch === 'function' ? deps.dispatch : _r1aDispatchBuiltRequest;
  return dispatch(request, actor);
}

function appSheetR1CommandFromRequestRow(commandType, requestRowId, actorEmail) {
  try { return JSON.stringify(_r1aCommandFromRequestRow(commandType, requestRowId, actorEmail)); }
  catch (e) { return JSON.stringify({ ok: false, error: e.code || e.message || 'R1A_REFUSED' }); }
}

if (typeof module !== 'undefined') module.exports = {
  R1A_REQUEST_DEV_SHEET: R1A_REQUEST_DEV_SHEET,
  R1A_REQUEST_TABLES: R1A_REQUEST_TABLES,
  _r1aReadRequestRowFromSpreadsheet: _r1aReadRequestRowFromSpreadsheet,
  _r1aBuildIntakeRequest: _r1aBuildIntakeRequest,
  _r1aCommandFromRequestRow: _r1aCommandFromRequestRow,
  appSheetR1CommandFromRequestRow: appSheetR1CommandFromRequestRow
};
