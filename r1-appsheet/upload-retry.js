/* DEV-only bounded retry for the AppSheet upload-availability race.
 *
 * AppSheet saves a File/Image column, writes the DEV*Requests row and fires the bot before the uploaded
 * file is necessarily visible through Drive. The shared resolver (_r1cResolveUpload) reports that as
 * R1C_UPLOAD_PENDING before any write happens. This module makes that outcome retryable, bounded and
 * explicit using the existing generic Outbox retry vocabulary (Pending/Processing/RetryDue/Succeeded/
 * NeedsReview, attempt_count, next_attempt):
 *   - the bot entry schedules ONE Outbox row per request row (idempotency_key R1U:<table>:<row id>);
 *   - runR1URetryUploadRequests (time-driven trigger) sweeps upload-bearing Ready rows that have no
 *     CommitJournal entry, no Outbox row and no recorded refusal (rows submitted before this module, or whose
 *     bot call never reached the backend), then re-runs due items through the normal request-row path;
 *   - every attempt re-reads the authoritative request row, acts as row.submitted_by (locked in AppSheet at
 *     create) and refuses if the row identity/inputs changed since scheduling (payload_hash fingerprint);
 *   - idempotency, expected_version, role/task authorization and audit come from the command path itself
 *     (CJ-R1A-/CJ-R1C- journals), so a retry can never duplicate Evidence rows or lifecycle side effects;
 *   - after R1U_MAX_ATTEMPTS the row becomes NeedsReview with R1C_UPLOAD_MISSING (explicit final failure);
 *     any non-pending error is final immediately (NeedsReview with the error code).
 * Writes: Outbox rows, and the request row's result_* columns through the shared command-result.js writer
 * (same staff-facing vocabulary and messages as the bot entry; internal codes only in result_code/result).
 * Never touches operational tables directly and never invents Evidence ids. */
'use strict';
var R1U_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var R1U_ACTION = 'R1RequestUploadRetry';
var R1U_MAX_ATTEMPTS = 5;
var R1U_BACKOFF_MINUTES = [1, 2, 4, 8, 16];
var R1U_STALLED_MS = 10 * 60 * 1000;
var R1U_MAX_PER_TICK = 10;
var R1U_SWEEP_SKIP_RESULTS = ['ActionRequired', 'Failed'];
var R1U_UPLOAD_TABLES = {
  DEVTaskCompleteRequests: { command_type: 'TASK_COMPLETE', column: 'evidence_path' },
  DEVTaskEvidenceAttachRequests: { command_type: 'TASK_EVIDENCE_ATTACH', column: 'evidence_path' },
  DEVInstallerCommandRequests: { command_type: null, column: 'evidence_path' },
  DEVGoodsInRequests: { command_type: 'GOODS_IN_RECEIVE', column: 'delivery_note_path' }
};

function _r1uRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _r1uEmail(v) { if (typeof v !== 'string') return ''; var s = v.trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : ''; }
function _r1uCell(v) {
  if (v === undefined || v === null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).trim();
}
function _r1uHash(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; var hex = (h >>> 0).toString(16); while (hex.length < 8) hex = '0' + hex; return 'h' + hex; }
function _r1uRequestTables() {
  if (typeof R1A_REQUEST_TABLES !== 'undefined') return R1A_REQUEST_TABLES;
  if (typeof require === 'function') return require('./request-row.js').R1A_REQUEST_TABLES;
  _r1uRefuse('R1U_UNSUPPORTED');
}
function _r1uTableFor(type) { var t = typeof type === 'string' ? type.trim() : '', table = _r1uRequestTables()[t]; return table && R1U_UPLOAD_TABLES[table] ? table : null; }
function _r1uRowType(table, row) {
  var spec = R1U_UPLOAD_TABLES[table]; if (!spec) return null;
  if (spec.command_type) return spec.command_type;
  var t = _r1uCell(row.command_type);
  return t && _r1uRequestTables()[t] === table ? t : null;
}
function _r1uEligibility(table, row) {
  var spec = R1U_UPLOAD_TABLES[table];
  if (!spec) return 'R1U_TABLE_NOT_RETRYABLE';
  if (!row || _r1uCell(row.id) === '') return 'R1U_REQUEST_NOT_FOUND';
  if (_r1uCell(row.status) !== 'Ready') return 'R1U_REQUEST_NOT_READY';
  if (_r1uCell(row.command_id) === '') return 'R1U_COMMAND_ID_REQUIRED';
  if (!_r1uEmail(row.submitted_by)) return 'R1U_SUBMITTED_BY_REQUIRED';
  if (_r1uCell(row[spec.column]) === '') return 'R1U_NO_UPLOAD';
  if (!_r1uRowType(table, row)) return 'R1U_COMMAND_TYPE_INVALID';
  return null;
}
/* Identity + inputs the retry must preserve. Any later edit to the row aborts the retry (NeedsReview). */
function _r1uFingerprint(table, row) {
  var spec = R1U_UPLOAD_TABLES[table];
  return _r1uHash(JSON.stringify({
    table: table, row_id: _r1uCell(row.id), command_id: _r1uCell(row.command_id), command_type: _r1uRowType(table, row),
    submitted_by: _r1uEmail(row.submitted_by), expected_version: _r1uCell(row.expected_version), upload: _r1uCell(row[spec.column]),
    task_id: _r1uCell(row.task_id), job_id: _r1uCell(row.job_id), work_package_id: _r1uCell(row.work_package_id), delivery_id: _r1uCell(row.delivery_id)
  }));
}
function _r1uKey(table, rowId) { return 'R1U:' + table + ':' + rowId; }
function _r1uBackoffMs(attempt) { var i = Math.max(0, Math.min(attempt - 1, R1U_BACKOFF_MINUTES.length - 1)); return R1U_BACKOFF_MINUTES[i] * 60 * 1000; }
function _r1uParseTarget(target) { var s = _r1uCell(target), i = s.indexOf('/'); return i > 0 ? { table: s.slice(0, i), row_id: s.slice(i + 1) } : null; }

/* ---- Cloud defaults (DEV spreadsheet only; injected in tests) ---- */
function _r1uSheetRows(ss, table) {
  if (!ss || typeof ss.getId !== 'function' || ss.getId() !== R1U_DEV_SHEET_ID) _r1uRefuse('R1U_DEV_ONLY');
  var matches = ss.getSheets().filter(function (sh) { return sh.getName() === table; });
  if (matches.length !== 1) return null;
  var sh = matches[0], lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
  if (lastCol < 1) return null;
  var h = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x || '').trim(); });
  if (h.indexOf('id') < 0 || h.indexOf('command_id') < 0) return null;
  if (lastRow < 2) return [];
  return sh.getRange(2, 1, lastRow - 1, lastCol).getValues().map(function (r) {
    var o = {}; h.forEach(function (k, i) { if (k && !Object.prototype.hasOwnProperty.call(o, k)) o[k] = r[i]; }); return o;
  }).filter(function (o) { return _r1uCell(o.id) !== ''; });
}
function _r1uResultApi() {
  if (typeof _r1rFeedback === 'function' && typeof _r1rSheetWriteResult === 'function') return { feedback: _r1rFeedback, update: _r1rUpdate, write: _r1rSheetWriteResult };
  if (typeof require === 'function' && typeof module !== 'undefined') { try { var m = require('./command-result.js'); return { feedback: m._r1rFeedback, update: m._r1rUpdate, write: m._r1rSheetWriteResult }; } catch (e) {} }
  return null;
}
/* Staff-facing result for a retry outcome; falls back to the raw code only if the shared module is missing. */
function _r1uFeedback(type, response, fallbackStatus) {
  var api = _r1uResultApi();
  if (api) { try { return api.feedback(type, response); } catch (e) {} }
  var code = response && response.error ? String(response.error) : '';
  return { status: fallbackStatus, message: code || fallbackStatus, code: code, result_json: '', extras: {} };
}
/* extra = {actorEmail, code, detail, extras}. The shared writer enforces row owner, existing columns and final-result preservation. */
function _r1uSheetWriteResult(ss, table, rowId, status, message, extra) {
  try {
    var api = _r1uResultApi();
    if (!api) return false;
    extra = extra || {};
    return !!api.write(ss, table, rowId, { status: status, message: message, code: extra.code || '', detail: extra.detail || '', extras: extra.extras || {}, actorEmail: extra.actorEmail }).written;
  } catch (e) { return false; }
}
function _r1uContext(deps) {
  deps = deps || {};
  var ctx = { now: typeof deps.now === 'function' ? deps.now : function () { return new Date(); } };
  if (deps.store) ctx.store = deps.store;
  else {
    if (typeof _r1cConfigGuard === 'function') _r1cConfigGuard();
    ctx.store = _r1aCloudOptions().store;
  }
  if (!ctx.store || ctx.store.getSheetId() !== R1U_DEV_SHEET_ID || ctx.store.getEnvironment() !== 'DEV') _r1uRefuse('R1U_DEV_ONLY');
  var ss = null;
  function sheet() { if (!ss) ss = _r1aOpenDevRequestSpreadsheet(); return ss; }
  ctx.readRows = typeof deps.readRows === 'function' ? deps.readRows : function (table) { return _r1uSheetRows(sheet(), table); };
  ctx.writeResult = typeof deps.writeResult === 'function' ? deps.writeResult : function (table, rowId, status, message, extra) { return _r1uSheetWriteResult(sheet(), table, rowId, status, message, extra); };
  /* Retry attempts do a single Drive lookup (no in-call wait); the actor is the authoritative row's submitted_by. */
  ctx.command = typeof deps.command === 'function' ? deps.command : function (type, rowId, actor) {
    return _r1aCommandFromRequestRow(type, rowId, actor, { sessionEmail: '', resolveUpload: function (p) { return _r1cResolveUpload(p, { wait: false }); } });
  };
  return ctx;
}
function _r1uFind(store, key) { var rows = store.list('Outbox').filter(function (o) { return o.idempotency_key === key; }); if (rows.length > 1) _r1uRefuse('R1U_OUTBOX_AMBIGUOUS'); return rows[0] || null; }
function _r1uSafeWrite(ctx, table, rowId, status, message, extra) { try { return !!ctx.writeResult(table, rowId, status, message, extra || {}); } catch (e) { return false; } }
function _r1uExtra(actor, fb) { return { actorEmail: actor, code: fb.code || '', detail: fb.result_json || '', extras: fb.extras || {} }; }
function _r1uOutboxRow(table, row, type, now, attemptCount, status, nextAttempt, summary) {
  var rowId = _r1uCell(row.id);
  return {
    id: 'OUT-R1U-' + rowId, idempotency_key: _r1uKey(table, rowId), action_type: R1U_ACTION, target: table + '/' + rowId,
    payload_hash: _r1uFingerprint(table, row), job_revision: null, attempt_count: attemptCount, next_attempt: nextAttempt,
    external_id: null, response_summary: summary, correlation_id: _r1uCell(row.command_id), status: status,
    created_at: now.toISOString(), commit_id: 'R1U-' + rowId
  };
}

/* Bot path: called once by appSheetR1CommandFromRequestRow after a verified call ended in R1C_UPLOAD_PENDING.
 * The bot attempt counts as attempt 1. Repeat calls for the same row are idempotent. */
function _r1uScheduleRetry(commandType, requestRowId, actorEmail, err, deps) {
  var ctx = _r1uContext(deps), table = _r1uTableFor(commandType), rowId = _r1uCell(requestRowId), actor = _r1uEmail(actorEmail);
  if (!table) _r1uRefuse('R1U_NOT_RETRYABLE');
  if (!rowId) _r1uRefuse('R1U_REQUEST_NOT_FOUND');
  if (!actor) _r1uRefuse('R1U_AUTHENTICATED_EMAIL_REQUIRED');
  return ctx.store.withLock(function () {
    var rows = ctx.readRows(table) || [], match = rows.filter(function (r) { return _r1uCell(r.id) === rowId; });
    if (match.length !== 1) _r1uRefuse('R1U_REQUEST_NOT_FOUND');
    var row = match[0], reason = _r1uEligibility(table, row);
    if (reason) _r1uRefuse(reason);
    if (_r1uEmail(row.submitted_by) !== actor) _r1uRefuse('R1U_ACTOR_MISMATCH');
    var type = _r1uRowType(table, row);
    if (type !== String(commandType).trim()) _r1uRefuse('R1U_COMMAND_TYPE_MISMATCH');
    var now = ctx.now(), existing = _r1uFind(ctx.store, _r1uKey(table, rowId));
    if (existing) {
      var active = ['Pending', 'RetryDue', 'Processing'].indexOf(existing.status) >= 0;
      return { scheduled: active, outbox_id: existing.id, status: existing.status, attempt: Number(existing.attempt_count) || 0, max_attempts: R1U_MAX_ATTEMPTS, next_attempt: existing.next_attempt || null };
    }
    var next = new Date(now.getTime() + _r1uBackoffMs(1)).toISOString();
    var lookups = err && err.attempts ? Number(err.attempts) : 1;
    var summary = 'R1C_UPLOAD_PENDING after bot attempt 1 of ' + R1U_MAX_ATTEMPTS + ' (' + lookups + ' Drive lookup(s)); next attempt ' + next;
    ctx.store.insert('Outbox', _r1uOutboxRow(table, row, type, now, 1, 'RetryDue', next, summary));
    var pendingFb = _r1uFeedback(type, { ok: false, error: 'R1C_UPLOAD_PENDING', retry: { scheduled: true, attempt: 1, next_attempt: next } }, 'UploadPending');
    var written = _r1uSafeWrite(ctx, table, rowId, 'UploadPending', 'Your file is still uploading. The system will try again automatically (retry 2 of ' + R1U_MAX_ATTEMPTS + '), so you do not need to resubmit.', _r1uExtra(actor, pendingFb));
    return { scheduled: true, outbox_id: 'OUT-R1U-' + rowId, status: 'RetryDue', attempt: 1, max_attempts: R1U_MAX_ATTEMPTS, next_attempt: next, result_written: written };
  });
}

/* Sweep: Ready upload-bearing request rows with no journal entry and no Outbox row become Pending items. */
function _r1uSweep(ctx, now) {
  var swept = [], journaled = {}, keys = {};
  ctx.store.list('CommitJournal').forEach(function (j) { if (j && j.command_id) journaled[_r1uCell(j.command_id)] = true; });
  ctx.store.list('Outbox').forEach(function (o) { if (o && o.action_type === R1U_ACTION) keys[o.idempotency_key] = true; });
  Object.keys(R1U_UPLOAD_TABLES).forEach(function (table) {
    var rows = ctx.readRows(table);
    if (!rows) return;
    rows.forEach(function (row) {
      if (_r1uEligibility(table, row)) return;
      /* The bot already reached the backend and recorded a refusal: staff were told to submit a new request, so a
       * later deploy must never silently re-run that refused row. */
      if (R1U_SWEEP_SKIP_RESULTS.indexOf(_r1uCell(row.result_status)) >= 0) return;
      var rowId = _r1uCell(row.id), key = _r1uKey(table, rowId);
      if (keys[key] || journaled[_r1uCell(row.command_id)]) return;
      ctx.store.insert('Outbox', _r1uOutboxRow(table, row, _r1uRowType(table, row), now, 0, 'Pending', now.toISOString(), 'Swept: Ready upload request without journal entry'));
      keys[key] = true;
      swept.push({ outbox_id: 'OUT-R1U-' + rowId, table: table, row_id: rowId, command_type: _r1uRowType(table, row) });
    });
  });
  return swept;
}
function _r1uDue(ctx, now) {
  var t = now.getTime();
  return ctx.store.list('Outbox').filter(function (o) {
    if (!o || o.action_type !== R1U_ACTION) return false;
    var due = !o.next_attempt || Date.parse(o.next_attempt) <= t;
    if (o.status === 'Pending' || o.status === 'RetryDue') return due;
    return o.status === 'Processing' && !!o.next_attempt && due; /* stalled claim */
  }).sort(function (a, b) { return String(a.next_attempt || a.created_at).localeCompare(String(b.next_attempt || b.created_at)); }).slice(0, R1U_MAX_PER_TICK);
}
function _r1uFinish(ctx, item, table, rowId, status, summary, nextAttempt, resultStatus, resultMessage, extra) {
  ctx.store.update('Outbox', item.id, { status: status, next_attempt: nextAttempt || null, response_summary: String(summary).slice(0, 400) });
  var written = _r1uSafeWrite(ctx, table, rowId, resultStatus, resultMessage, extra);
  return { outbox_id: item.id, table: table, row_id: rowId, outcome: status, attempt: item.attempt_count, next_attempt: nextAttempt || null, summary: summary, result_written: written };
}
/* Final failure: Outbox keeps the diagnostic code; the request row gets the staff-facing message. */
function _r1uFail(ctx, item, table, rowId, type, actor, code, summary) {
  var fb = _r1uFeedback(type, { ok: false, error: code }, 'Failed');
  return _r1uFinish(ctx, item, table, rowId, 'NeedsReview', summary || code, null, fb.status, fb.message, _r1uExtra(actor, fb));
}
function _r1uProcess(ctx, item) {
  var t = _r1uParseTarget(item.target), now = ctx.now();
  if (!t) return _r1uFinish(ctx, item, '', '', 'NeedsReview', 'R1U_TARGET_INVALID', null, 'Failed', 'R1U_TARGET_INVALID');
  var rows = ctx.readRows(t.table) || [], match = rows.filter(function (r) { return _r1uCell(r.id) === t.row_id; });
  if (match.length !== 1) return _r1uFinish(ctx, item, t.table, t.row_id, 'NeedsReview', 'R1U_REQUEST_NOT_FOUND', null, 'Failed', 'R1U_REQUEST_NOT_FOUND');
  var row = match[0], reason = _r1uEligibility(t.table, row), rowActor = _r1uEmail(row.submitted_by), rowType = _r1uRowType(t.table, row);
  if (reason) return _r1uFail(ctx, item, t.table, t.row_id, rowType, rowActor, reason);
  if (_r1uFingerprint(t.table, row) !== item.payload_hash) return _r1uFail(ctx, item, t.table, t.row_id, rowType, rowActor, 'R1U_REQUEST_CHANGED', 'R1U_REQUEST_CHANGED: request identity or inputs changed after scheduling');
  var type = rowType, actor = rowActor, attempt = item.attempt_count, upload = _r1uCell(row[R1U_UPLOAD_TABLES[t.table].column]);
  var result = null, error = null;
  try { result = ctx.command(type, t.row_id, actor); } catch (e) { error = e; }
  if (!error && result && result.ok === true) {
    var inner = result.result || {}, replay = inner.replay === true || inner.status === 'Replayed';
    var okSummary = 'Succeeded on attempt ' + attempt + (replay ? ' (replay of earlier commit)' : '') + (inner.status ? ': ' + inner.status : '');
    var okFb = _r1uFeedback(type, result, 'Succeeded');
    return _r1uFinish(ctx, item, t.table, t.row_id, 'Succeeded', okSummary, null, okFb.status, okFb.message === 'Succeeded' ? okSummary : okFb.message, _r1uExtra(actor, okFb));
  }
  var code = error ? (error.code || error.message || 'R1U_COMMAND_FAILED') : (result && result.error ? String(result.error) : 'R1U_UNEXPECTED_RESULT');
  if (code === 'R1C_UPLOAD_PENDING') {
    if (attempt >= R1U_MAX_ATTEMPTS) {
      var missing = 'R1C_UPLOAD_MISSING: upload "' + upload + '" never became visible in Drive after ' + attempt + ' attempts';
      return _r1uFail(ctx, item, t.table, t.row_id, type, actor, 'R1C_UPLOAD_MISSING', missing);
    }
    var next = new Date(now.getTime() + _r1uBackoffMs(attempt)).toISOString();
    var pendingFb = _r1uFeedback(type, { ok: false, error: 'R1C_UPLOAD_PENDING', retry: { scheduled: true, attempt: attempt, next_attempt: next } }, 'UploadPending');
    return _r1uFinish(ctx, item, t.table, t.row_id, 'RetryDue', 'R1C_UPLOAD_PENDING after attempt ' + attempt + ' of ' + R1U_MAX_ATTEMPTS + '; next attempt ' + next, next, 'UploadPending', 'Your file is still uploading. The system will try again automatically (retry ' + (attempt + 1) + ' of ' + R1U_MAX_ATTEMPTS + '), so you do not need to resubmit.', _r1uExtra(actor, pendingFb));
  }
  return _r1uFail(ctx, item, t.table, t.row_id, type, actor, code, code + ' on attempt ' + attempt + ' (final)');
}
/* One trigger run: sweep, claim due items under the lock, then execute each outside the lock (the command path takes its own lock). */
function _r1uTick(deps) {
  var ctx = _r1uContext(deps), now = ctx.now();
  var claimed = ctx.store.withLock(function () {
    var swept = _r1uSweep(ctx, now), due = _r1uDue(ctx, now);
    due.forEach(function (o) {
      ctx.store.update('Outbox', o.id, { status: 'Processing', attempt_count: (Number(o.attempt_count) || 0) + 1, next_attempt: new Date(now.getTime() + R1U_STALLED_MS).toISOString() });
    });
    return { swept: swept, items: due.map(function (o) { return ctx.store.get('Outbox', o.id); }) };
  });
  var processed = claimed.items.map(function (item) { return _r1uProcess(ctx, item); });
  var remaining = ctx.store.list('Outbox').filter(function (o) { return o.action_type === R1U_ACTION && (o.status === 'Pending' || o.status === 'RetryDue'); }).length;
  return { ok: true, environment: 'DEV', run_at: now.toISOString(), swept: claimed.swept, processed: processed, remaining_scheduled: remaining, max_attempts: R1U_MAX_ATTEMPTS, external_calls: 0 };
}
function _r1uStatus(deps) {
  var ctx = _r1uContext(deps), items = ctx.store.list('Outbox').filter(function (o) { return o.action_type === R1U_ACTION; });
  var by = {}; items.forEach(function (o) { by[o.status] = (by[o.status] || 0) + 1; });
  return { ok: true, environment: 'DEV', count: items.length, by_status: by, items: items.map(function (o) { return { outbox_id: o.id, target: o.target, command_id: o.correlation_id, status: o.status, attempt: o.attempt_count, next_attempt: o.next_attempt, summary: o.response_summary }; }) };
}
/* Zero-argument, trigger-safe. Install as a time-driven trigger (every 5 minutes) in the standalone bridge project. */
function runR1URetryUploadRequests() {
  var out;
  try { out = _r1uTick(); } catch (e) { out = { ok: false, error: e.code || e.message || 'R1U_REFUSED' }; }
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(JSON.stringify(out));
  return out;
}
function runR1UUploadRetryStatus() {
  var out;
  try { out = _r1uStatus(); } catch (e) { out = { ok: false, error: e.code || e.message || 'R1U_REFUSED' }; }
  if (typeof Logger !== 'undefined' && Logger.log) Logger.log(JSON.stringify(out));
  return out;
}
if (typeof module !== 'undefined') module.exports = { R1U_ACTION: R1U_ACTION, R1U_MAX_ATTEMPTS: R1U_MAX_ATTEMPTS, R1U_BACKOFF_MINUTES: R1U_BACKOFF_MINUTES, R1U_STALLED_MS: R1U_STALLED_MS, R1U_UPLOAD_TABLES: R1U_UPLOAD_TABLES, _r1uFingerprint: _r1uFingerprint, _r1uEligibility: _r1uEligibility, _r1uScheduleRetry: _r1uScheduleRetry, _r1uSweep: _r1uSweep, _r1uTick: _r1uTick, _r1uStatus: _r1uStatus, _r1uSheetRows: _r1uSheetRows, _r1uSheetWriteResult: _r1uSheetWriteResult };
