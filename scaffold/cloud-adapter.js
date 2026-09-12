/* Scaffold workflow cloud adapter: header-checked Sheets store + zero-arg DEV entry points.
 * Sheet-only writes. No scaffolder message is sent (Communications rows stay Draft). FN-04 toggled only for synthetic smoke. */
function _scfCloudConfig() {
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (!c || c.environment !== 'DEV') throw new Error('SCF_REFUSED: exact DEV environment required');
  return c;
}
function _scfCloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _scfCloudConfig();
  if (ss.getId() !== SCF_DEV_SHEET_ID) throw new Error('SCF_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _scfSheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('SCF_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = SCF_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('SCF_SCHEMA: header mismatch ' + name);
  return sh;
}
function _scfCell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
function _scfCloudStore() {
  var ss = _scfCloudGuard();
  function list(name) {
    var sh = _scfSheet(ss, name), h = SCF_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) { var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x; }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _scfCloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) { var rows = list(name).filter(function (r) { return r.id === id; }); if (rows.length > 1) throw new Error('SCF_SCHEMA: duplicate ID ' + id); return rows[0] || null; },
    insert: function (name, row) {
      var sh = _scfSheet(ss, name), h = SCF_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('SCF_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('SCF_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && h.indexOf(k) === -1) throw new Error('SCF_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _scfCell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var sh = _scfSheet(ss, name), h = SCF_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues(), indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('SCF_SCHEMA: update row ' + id);
      var idx = indices[0], row = values[idx];
      for (var k in patch) { if (!patch.hasOwnProperty(k)) continue; if (h.indexOf(k) === -1) throw new Error('SCF_SCHEMA: unknown field ' + name + '.' + k); row[h.indexOf(k)] = patch[k]; }
      sh.getRange(idx + 2, 1, 1, h.length).setValues([row.map(_scfCell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) throw new Error('SCF_BUSY'); try { return fn(); } finally { lock.releaseLock(); } }
  };
}
function _scfResult(name, fn) {
  try { var result = fn(); var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result }; console.log(JSON.stringify(r)); return r; }
  catch (e) { var f = { test: name, pass: false, detail: String(e.message || e) }; console.log(JSON.stringify(f)); return f; }
}
function _scfActor() { try { var e = Session.getActiveUser().getEmail(); return e ? String(e) : 'DEV-apps-script'; } catch (x) { return 'DEV-apps-script'; } }
function _scfStamp() { return new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14); }
function _scfSetFn04(store, enable) {
  return store.withLock(function () {
    var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-04'; });
    if (rows.length !== 1 || rows[0].target_release !== 'R2') throw new Error('SCF_REFUSED: FN-04 ReleaseMode invalid');
    var r = rows[0], ok = (r.mode === 'Disabled' && r.authorised_job_scope === 'None') || (r.mode === 'Automated' && r.authorised_job_scope === 'Pilot');
    if (!ok) throw new Error('SCF_REFUSED: FN-04 unexpected state ' + r.mode + '/' + r.authorised_job_scope);
    store.update('ReleaseModes', r.id, { mode: enable ? 'Automated' : 'Disabled', authorised_job_scope: enable ? 'Pilot' : 'None', updated_at: new Date().toISOString(), updated_by: enable ? 'SCF-enable' : 'SCF-restore', version: Number(r.version || 0) + 1 });
    return { ok: true, enabled: enable, function_id: 'FN-04' };
  });
}
function runScfScaffolders() { return _scfResult('SCF scaffolders', function () { return { ok: true, scaffolders: _scfScaffolders(_scfCloudStore()) }; }); }
function runScfPlannerRows(fromDate, toDate) { return _scfResult('SCF planner rows', function () { var s = _scfCloudStore(); var from = fromDate || new Date().toISOString().slice(0, 10); var to = toDate || new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10); return { ok: true, from: from, to: to, rows: _scfPlannerRows(s, from, to) }; }); }
function runScfBookingView(bookingId) { return _scfResult('SCF booking view', function () { return Object.assign({ ok: true }, _scfBookingView(_scfCloudStore(), bookingId)); }); }
function runScfEnableFn04ForSyntheticTest() { return _scfResult('SCF enable FN-04', function () { return _scfSetFn04(_scfCloudStore(), true); }); }
function restoreScfSafeState() { return _scfResult('SCF restore', function () { return _scfSetFn04(_scfCloudStore(), false); }); }
/* Real scaffolder entry: values must be supplied by the business (Ben). Nothing is invented here. */
function runScfConfigureScaffolder(companyId, name, leadDays, contactName, contactEmail, contactPhone) {
  return _scfResult('SCF configure scaffolder', function () {
    var s = _scfCloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _scfConfigureScaffolder(s, { actor: _scfActor(), command_id: 'SCF-CONFIG-' + companyId + '-' + _scfStamp(), company_id: companyId, name: name, standard_lead_days: leadDays === undefined || leadDays === null || leadDays === '' ? null : Number(leadDays), contact: contactName ? { name: contactName, email: contactEmail || null, phone: contactPhone || null } : null, reason: 'Scaffolder configuration supplied by business' })); });
  });
}
function runScfChase() { return _scfResult('SCF chase', function () { var s = _scfCloudStore(); return s.withLock(function () { return Object.assign({ ok: true }, _scfChase(s, { actor: _scfActor(), command_id: 'SCF-CHASE-' + _scfStamp() })); }); }); }
function runScfWeeklyList(weekStart) { return _scfResult('SCF weekly list', function () { var s = _scfCloudStore(); return s.withLock(function () { return Object.assign({ ok: true }, _scfWeeklyList(s, { actor: _scfActor(), command_id: 'SCF-WEEKLY-' + _scfStamp(), week_start: weekStart || null })); }); }); }
/* Synthetic DEV smoke on the S09 fixture job + synthetic scaffolder: request → confirm → erected → complaint blocks strip → resolve → authorise → plan → confirm → stripped; complaint stays open. */
function runScfHappyPathTest() {
  return _scfResult('SCF happy path', function () {
    var s = _scfCloudStore();
    _scfSetFn04(s, true);
    try {
      return s.withLock(function () {
        var n = new Date().toISOString(), stamp = _scfStamp(), actor = _scfActor();
        if (!s.get('Companies', 'COMP-scaffold-dev')) s.insert('Companies', { id: 'COMP-scaffold-dev', name: 'DEV Scaffold Co', type: 'Scaffolder', active: true, standard_lead_days: 7, delivery_weekday: null, notes: 'Synthetic DEV scaffolder only', created_at: n, created_by: 'S09-fixture', updated_at: n, updated_by: 'S09-fixture', version: 1, source_system: 'S09-fixture', commit_id: 'S09-fixture' });
        var jobId = 'J-scf-smoke-' + stamp;
        s.insert('Jobs', { id: jobId, job_id: 'SS-SCF-' + stamp.slice(-6), customer_id: 'CUST-scf', display_name: 'SCF Smoke ' + stamp, finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: false, scaffold_required: true, workflow_stage: 'Booked', handover_status: 'NotReady', financial_status: 'Pending', customer_happy_at: null, pilot_job: true, release_scope: 'R2', next_action_at: null, created_at: n, created_by: 'SCF-fixture', updated_at: n, updated_by: 'SCF-fixture', version: 1, source_system: 'SCF-fixture', commit_id: 'SCF-fixture' });
        var erect = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), today = n.slice(0, 10);
        var r1 = _scfRequest(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-REQ', job_id: jobId, company_id: 'COMP-scaffold-dev', erect_planned_at: erect, strip_forecast_at: new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10), access_notes: 'Synthetic', expected_version: 1 });
        var b = s.get('ScaffoldBookings', r1.booking.id);
        var r2 = _scfConfirmErect(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-CONF', booking_id: b.id, expected_version: b.version }); b = s.get('ScaffoldBookings', b.id);
        var r3 = _scfRecordErected(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-ERECT', booking_id: b.id, erect_actual_at: today, expected_version: b.version }); b = s.get('ScaffoldBookings', b.id);
        var c1 = _scfComplaint(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-CMP', booking_id: b.id, category: 'UnsafeConcern', description: 'Synthetic unsafe concern' }); b = s.get('ScaffoldBookings', b.id);
        s.update('Jobs', jobId, { customer_happy_at: n, customer_happy_by: actor });
        var blocked = _scfAuthoriseStrip(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-AUTHX', booking_id: b.id, expected_version: b.version });
        var job = s.get('Jobs', jobId);
        s.update('Issues', c1.issue_id, { status: 'Resolved', resolution: 'Synthetic resolution', resolved_at: n, updated_at: n, updated_by: actor, version: 2 });
        var r4 = _scfAuthoriseStrip(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-AUTH', booking_id: b.id, expected_version: b.version }); b = s.get('ScaffoldBookings', b.id);
        var r5 = _scfPlanStrip(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-PLAN', booking_id: b.id, strip_planned_at: today, expected_version: b.version }); b = s.get('ScaffoldBookings', b.id);
        var r6 = _scfConfirmStrip(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-SCONF', booking_id: b.id, expected_version: b.version }); b = s.get('ScaffoldBookings', b.id);
        var c2 = _scfComplaint(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-CMP2', booking_id: b.id, category: 'Damage', description: 'Synthetic damage', blocks_strip: false }); b = s.get('ScaffoldBookings', b.id);
        var r7 = _scfRecordStripped(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-STRIP', booking_id: b.id, strip_actual_at: today, expected_version: b.version }); b = s.get('ScaffoldBookings', b.id);
        var view = _scfBookingView(s, b.id), replay = _scfRequest(s, { actor: actor, command_id: 'SCF-SMOKE-' + stamp + '-REQ', job_id: jobId, company_id: 'COMP-scaffold-dev', erect_planned_at: erect, strip_forecast_at: new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10), access_notes: 'Synthetic', expected_version: 1 });
        var pass = r1.status === 'Requested' && r2.status === 'Confirmed' && r3.status === 'Erected' && blocked.status === 'Blocked' && r4.status === 'StripAuthorised' && r5.status === 'StripPlanned' && r6.status === 'StripConfirmed' && r7.status === 'Stripped' && r7.open_complaints.indexOf(c2.issue_id) !== -1 && s.get('Issues', c2.issue_id).status === 'Open' && replay.replay === true && b.revision === 2 && b.confirmed_revision === 2;
        return { pass: pass, detail: { job_id: jobId, booking_id: b.id, statuses: [r1.status, r2.status, r3.status, blocked.status, r4.status, r5.status, r6.status, r7.status], blockers: blocked.blockers, open_complaints: r7.open_complaints, tasks: view.tasks.map(function (t) { return t.template_code + ':' + t.status; }), communications: view.communications.length, acknowledgements: view.acknowledgements.length, external_calls: 0 } };
      });
    } finally { _scfSetFn04(s, false); }
  });
}
