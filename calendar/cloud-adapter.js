/* Calendar service cloud adapter: header-checked Sheets store + zero-arg DEV entry points.
 * Live Calendar writes happen only in runCalDispatch()/runCalLiveDevSmoke() when S01_CONFIG.calendarMode === 'LIVE'
 * and the DEV calendar is allowlisted. Everything else is read-only or Sheet-only. */
function _calCloudConfig() {
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (!c || c.environment !== 'DEV') throw new Error('CAL_REFUSED: exact DEV environment required');
  return c;
}
function _calCloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = _calCloudConfig();
  if (ss.getId() !== CAL_DEV_SHEET_ID || c.environment !== 'DEV') throw new Error('CAL_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _calSheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('CAL_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = CAL_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('CAL_SCHEMA: header mismatch ' + name);
  return sh;
}
function _calCell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
function _calCloudStore() {
  var ss = _calCloudGuard();
  function list(name) {
    var sh = _calSheet(ss, name), h = CAL_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) {
      var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x;
    }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _calCloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) {
      var rows = list(name).filter(function (r) { return r.id === id; });
      if (rows.length > 1) throw new Error('CAL_SCHEMA: duplicate ID ' + id);
      return rows[0] || null;
    },
    insert: function (name, row) {
      var sh = _calSheet(ss, name), h = CAL_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('CAL_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('CAL_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && h.indexOf(k) === -1) throw new Error('CAL_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _calCell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var sh = _calSheet(ss, name), h = CAL_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues();
      var indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('CAL_SCHEMA: update row ' + id);
      var idx = indices[0], row = values[idx];
      for (var k in patch) {
        if (!patch.hasOwnProperty(k)) continue;
        if (h.indexOf(k) === -1) throw new Error('CAL_SCHEMA: unknown field ' + name + '.' + k);
        row[h.indexOf(k)] = patch[k];
      }
      sh.getRange(idx + 2, 1, 1, h.length).setValues([row.map(_calCell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(5000)) throw new Error('CAL_BUSY');
      try { return fn(); } finally { lock.releaseLock(); }
    }
  };
}
function _calResult(name, fn) {
  try {
    var result = fn();
    var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result };
    console.log(JSON.stringify(r));
    return r;
  } catch (e) {
    var f = { test: name, pass: false, detail: String(e.message || e) };
    console.log(JSON.stringify(f));
    return f;
  }
}
function _calActor() {
  try { var e = Session.getActiveUser().getEmail(); return e ? String(e) : 'DEV-apps-script'; } catch (x) { return 'DEV-apps-script'; }
}
/* FN-02 toggle for synthetic DEV tests only. Never touches other functions. */
function _calSetFn02(store, enable) {
  return store.withLock(function () {
    var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-02'; });
    if (rows.length !== 1 || rows[0].target_release !== 'R2') throw new Error('CAL_REFUSED: FN-02 ReleaseMode invalid');
    var r = rows[0];
    var ok = (r.mode === 'Disabled' && r.authorised_job_scope === 'None') || (r.mode === 'Automated' && r.authorised_job_scope === 'Pilot');
    if (!ok) throw new Error('CAL_REFUSED: FN-02 unexpected state ' + r.mode + '/' + r.authorised_job_scope);
    store.update('ReleaseModes', r.id, { mode: enable ? 'Automated' : 'Disabled', authorised_job_scope: enable ? 'Pilot' : 'None', updated_at: new Date().toISOString(), updated_by: enable ? 'CAL-enable' : 'CAL-restore', version: Number(r.version || 0) + 1 });
    return { ok: true, enabled: enable, function_id: 'FN-02' };
  });
}
function runCalStatus() { return _calResult('CAL status', function () { return Object.assign({ ok: true }, _calStatus(_calCloudStore(), { config: _calCloudConfig() })); }); }
function runCalEnableFn02ForSyntheticTest() { return _calResult('CAL enable FN-02', function () { return _calSetFn02(_calCloudStore(), true); }); }
function restoreCalSafeState() { return _calResult('CAL restore', function () { return _calSetFn02(_calCloudStore(), false); }); }
function runCalDispatchDryRun() { return _calResult('CAL dispatch dry run', function () { return Object.assign({ ok: true }, _calDispatch(_calCloudStore(), { actor: _calActor(), config: _calCloudConfig(), dry_run: true })); }); }
/* LIVE only when S01_CONFIG.calendarMode === 'LIVE'; otherwise rows stay Pending and nothing is sent. */
function runCalDispatch() {
  return _calResult('CAL dispatch', function () {
    var s = _calCloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _calDispatch(s, { actor: _calActor(), config: _calCloudConfig() })); });
  });
}
function runCalResolveReview(outboxId, resolution, externalEventId, reason) {
  return _calResult('CAL resolve review', function () {
    var s = _calCloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _calResolveReview(s, { actor: _calActor(), command_id: 'RESOLVE-' + outboxId + '-' + new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14), outbox_id: outboxId, resolution: resolution, external_event_id: externalEventId || null, reason: reason || 'Manual review resolution' })); });
  });
}
function runCalAssignDevCalendar(personIdsCsv) {
  return _calResult('CAL assign DEV calendar', function () {
    var ids = String(personIdsCsv || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var s = _calCloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _calAssignDevCalendar(s, { actor: _calActor(), command_id: 'ASSIGN-' + new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14), person_ids: ids, reason: 'DEV calendar assignment for installer allocations' })); });
  });
}
/* Controlled DEV happy path: one synthetic link → create → update → cancel (delete). Touches only its own outbox rows. Leaves the DEV calendar clean.
 * Requires S01_CONFIG.calendarMode === 'LIVE' and the DEV calendar allowlisted. FN-02 toggled outside the lock. */
function runCalLiveDevSmoke() {
  return _calResult('CAL live DEV smoke', function () {
    var c = _calCloudConfig();
    if (c.calendarMode !== 'LIVE') throw new Error('CAL_NOT_CONFIGURED: set S01_CONFIG.calendarMode to LIVE for the smoke (DEV only)');
    var s = _calCloudStore();
    _calSetFn02(s, true);
    try {
      return s.withLock(function () {
        var stamp = new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14);
        var linkId = 'CL-CALSMOKE-' + stamp, now = new Date().toISOString();
        var start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), end = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
        var payload = { job_id: 'J-calsmoke', work_package_id: 'WP-calsmoke', title: 'CAL SMOKE DEV — delete if present', start_at: start, end_at: end, all_day: true };
        s.insert('CalendarLinks', { id: linkId, job_id: 'J-calsmoke', allocation_id: null, scaffold_activity_id: null, calendar_id: CAL_DEV_CALENDAR_ID, external_event_id: null, event_uid: null, producer: 'NewSystem', entity_revision: 1, last_synced_revision: 0, status: 'Pending', start_at: start, end_at: end, all_day: true, guest_person_ids: null, description_snapshot: JSON.stringify(payload), last_attempt_at: null, last_success_at: null, error: null, outbox_id: 'OUT-CALSMOKE-' + stamp + '-CREATE', created_at: now, created_by: 'CAL-smoke', updated_at: now, updated_by: 'CAL-smoke', version: 1, commit_id: 'CAL-smoke-' + stamp });
        s.insert('Outbox', { id: 'OUT-CALSMOKE-' + stamp + '-CREATE', idempotency_key: 'CAL-SMOKE-' + stamp + '-CREATE', action_type: 'CalendarCreate', target: CAL_DEV_CALENDAR_ID, payload_hash: 'smoke', job_revision: 1, attempt_count: 0, next_attempt: null, external_id: null, response_summary: 'CAL smoke', correlation_id: 'CAL-SMOKE-' + stamp, status: 'Pending', created_at: now, commit_id: 'CAL-smoke-' + stamp });
        var actor = _calActor();
        var own = ['OUT-CALSMOKE-' + stamp + '-CREATE', 'OUT-CALSMOKE-' + stamp + '-UPDATE', 'OUT-CALSMOKE-' + stamp + '-CANCEL'];
        var d1 = _calDispatch(s, { actor: actor, config: c, only_outbox_ids: own });
        var link = s.get('CalendarLinks', linkId);
        if (!link.external_event_id) throw new Error('CAL_SMOKE: create did not persist external_event_id: ' + JSON.stringify(d1.processed));
        var d1again = _calDispatch(s, { actor: actor, config: c, only_outbox_ids: own });
        s.update('CalendarLinks', linkId, { status: 'UpdatePending', entity_revision: 2, outbox_id: 'OUT-CALSMOKE-' + stamp + '-UPDATE', end_at: new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10), updated_at: new Date().toISOString(), updated_by: 'CAL-smoke', version: Number(link.version) + 1 });
        s.insert('Outbox', { id: 'OUT-CALSMOKE-' + stamp + '-UPDATE', idempotency_key: 'CAL-SMOKE-' + stamp + '-UPDATE', action_type: 'CalendarUpdate', target: CAL_DEV_CALENDAR_ID, payload_hash: 'smoke', job_revision: 2, attempt_count: 0, next_attempt: null, external_id: link.external_event_id, response_summary: 'CAL smoke', correlation_id: 'CAL-SMOKE-' + stamp, status: 'Pending', created_at: new Date().toISOString(), commit_id: 'CAL-smoke-' + stamp });
        var d2 = _calDispatch(s, { actor: actor, config: c, only_outbox_ids: own });
        link = s.get('CalendarLinks', linkId);
        s.update('CalendarLinks', linkId, { outbox_id: 'OUT-CALSMOKE-' + stamp + '-CANCEL', entity_revision: 3, updated_at: new Date().toISOString(), updated_by: 'CAL-smoke', version: Number(link.version) + 1 });
        s.insert('Outbox', { id: 'OUT-CALSMOKE-' + stamp + '-CANCEL', idempotency_key: 'CAL-SMOKE-' + stamp + '-CANCEL', action_type: 'CalendarCancel', target: CAL_DEV_CALENDAR_ID, payload_hash: 'smoke', job_revision: 3, attempt_count: 0, next_attempt: null, external_id: link.external_event_id, response_summary: 'CAL smoke', correlation_id: 'CAL-SMOKE-' + stamp, status: 'Pending', created_at: new Date().toISOString(), commit_id: 'CAL-smoke-' + stamp });
        var d3 = _calDispatch(s, { actor: actor, config: c, only_outbox_ids: own });
        link = s.get('CalendarLinks', linkId);
        var pass = d1.processed.length === 1 && d1.processed[0].outcome === 'Succeeded' && d1again.processed.length === 0 && d2.processed.length === 1 && d2.processed[0].outcome === 'Succeeded' && d2.processed[0].external_event_id === d1.processed[0].external_event_id && d3.processed.length === 1 && d3.processed[0].outcome === 'Succeeded' && link.status === 'Cancelled';
        return { pass: pass, detail: { link_id: linkId, created: d1.processed[0], replay_processed: d1again.processed.length, updated: d2.processed[0], cancelled: d3.processed[0], final_link_status: link.status, external_calls: d1.external_calls + d2.external_calls + d3.external_calls } };
      });
    } finally {
      _calSetFn02(s, false);
    }
  });
}
