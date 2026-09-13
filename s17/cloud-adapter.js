/* Header-checked enumeration adapter. S17 is read-only — no ScriptLock required for mutations. */
function _s17CloudGuard() {
  var ss = SpreadsheetApp.openById(S17_ADMIN_DEV_SHEET_ID);
  if (ss.getId() !== S17_ADMIN_DEV_SHEET_ID) throw new Error('S17_REFUSED: exact DEV sheet required');
  return ss;
}
function _s17Sheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('S17_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = S17_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('S17_SCHEMA: header mismatch ' + name);
  return sh;
}
function _s17Cell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
function _s17CloudStore() {
  var ss = _s17CloudGuard();
  function list(name) {
    var sh = _s17Sheet(ss, name), h = S17_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) {
      var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x;
    }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _s17CloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) {
      var rows = list(name).filter(function (r) { return r.id === id; });
      if (rows.length > 1) throw new Error('S17_SCHEMA: duplicate ID ' + id);
      return rows[0] || null;
    },
    insert: function (name, row) {
      var sh = _s17Sheet(ss, name), h = S17_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('S17_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('S17_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && !h.includes(k)) throw new Error('S17_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _s17Cell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var sh = _s17Sheet(ss, name), h = S17_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues();
      var indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('S17_SCHEMA: update row ' + id);
      var idx = indices[0], row = values[idx];
      for (var k in patch) {
        if (!patch.hasOwnProperty(k)) continue;
        if (!h.includes(k)) throw new Error('S17_SCHEMA: unknown field ' + name + '.' + k);
        row[h.indexOf(k)] = patch[k];
      }
      sh.getRange(idx + 2, 1, 1, h.length).setValues([row.map(_s17Cell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) { try { return fn(); } finally {} }
  };
}
function _s17Result(name, fn) {
  try {
    var result = fn();
    var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result };
    console.log(JSON.stringify(r));
    return r;
  } catch (e) {
    var r = { test: name, pass: false, detail: String(e.message || e) };
    console.log(JSON.stringify(r));
    return r;
  }
}
function runS17FixtureDryRun() { return _s17Result('S17 dry run', function () { var s = _s17CloudStore(); for (var n in S17_HEADERS) { if (S17_HEADERS.hasOwnProperty(n)) s.list(n); } _s17Scope(s); return { ok: true, existing_job: !!s.get('Jobs', 'J-s17-active') }; }); }
function runS17FixtureApply() { return _s17Result('S17 fixture apply', function () { var s = _s17CloudStore(); return s.withLock(function () { _s17Seed(s); return { ok: true }; }); }); }
function runS17FixtureValidate() { return _s17Result('S17 fixture validate', function () { var s = _s17CloudStore(), data = _s17FixtureRows(); function verifyRows(rows, expectedCreatedBy) { for (var t in rows) { if (!rows.hasOwnProperty(t)) continue; for (var i = 0; i < rows[t].length; i++) { var r = rows[t][i]; var v = _s17VerifyRow(s, t, r.id, expectedCreatedBy); if (!v.ok) throw new Error('S17_FIXTURE: ' + t + '/' + r.id + ' — ' + v.detail); } } } verifyRows(data.shared, null); /* Owned tables with created_by */ var ownedWithCreatedBy = {}; for (var t in data.owned) { if (t !== 'AuditEvents') ownedWithCreatedBy[t] = data.owned[t]; } verifyRows(ownedWithCreatedBy, 'S17'); /* AuditEvents: no created_by column */ if (data.owned.AuditEvents) verifyRows({ AuditEvents: data.owned.AuditEvents }, null); return { ok: true }; }); }
function runS17HappyPathTest() { return _s17Result('S17 happy path', function () { return _s17Smoke(_s17CloudStore(), typeof S17_ADMIN_EXPORTS !== 'undefined' ? S17_ADMIN_EXPORTS : { _s17OfficeToday: _s17OfficeToday, _s17JobOverview: _s17JobOverview, _s17JobSearch: _s17JobSearch, _s17OperationalQueue: _s17OperationalQueue, _s17AdminReleaseModes: _s17AdminReleaseModes, _s17AdminSystemStatus: _s17AdminSystemStatus, _s17AuditHistory: _s17AuditHistory, _s17ActionAvailability: _s17ActionAvailability, _s17TaskActionAvailability: _s17TaskActionAvailability, _s17Scope: _s17Scope }); }); }
function runS17AppSheetSmokeSetup() { return _s17Result('S17 AppSheet smoke setup', function () { var s = _s17CloudStore(); return s.withLock(function () { var people = s.list('People').filter(function (p) { return p.email && p.email.trim().toLowerCase() === 'lenny@simplesolarltd.co.uk' && p.active === true; }); if (people.length !== 1) throw new Error('S17_SMOKE: expected exactly one active People record for lenny@simplesolarltd.co.uk, found ' + people.length); var lennyId = people[0].id; var now = new Date().toISOString(); var created = []; function ensureRole(role) { var existing = s.list('PersonRoles').filter(function (r) { return r.person_id === lennyId && r.role === role && r.active === true; }); if (!existing.length) { var rid = 'ROLE-S17-lenny-' + role.toLowerCase(); if (!s.get('PersonRoles', rid)) { s.insert('PersonRoles', { id: rid, person_id: lennyId, role: role, active: true, created_at: now, created_by: 'S17-smoke', updated_at: now, updated_by: 'S17-smoke', version: 1, source_system: 'S17-smoke', commit_id: 'S17-smoke' }); created.push('PersonRoles:' + rid); } } } function ensureTask(id, jobId, templateCode, title, group, version) { var t = s.get('Tasks', id); if (!t) { s.insert('Tasks', { id: id, job_id: jobId, template_code: templateCode, instance_key: 'S17-SMOKE-' + id, group: group, title: title, owner_id: lennyId, backup_id: null, related_entity_type: 'Jobs', related_entity_id: jobId, due_at: '2026-12-31', original_due_at: '2026-12-31', priority: 1, status: 'Open', blocking_reason: null, next_followup_at: null, completed_at: null, completed_by: null, completion_note: null, evidence_id: null, revision_required: false, created_rule_version: 'S17-smoke-1.0', created_at: now, created_by: 'S17-smoke', updated_at: now, updated_by: 'S17-smoke', version: version || 1, source_system: 'S17-smoke', commit_id: 'S17-smoke' }); created.push('Tasks:' + id); } else { created.push('Tasks:' + id + ' (exists v' + t.version + ')'); } } function ensureJob(id, jobId, stage) { var j = s.get('Jobs', id); if (!j) { s.insert('Jobs', { id: id, job_id: jobId, customer_id: 'CUST-s17', display_name: 'S17 AppSheet Smoke ' + stage, sold_submission_id: null, booking_submission_id: null, sold_at: null, salesperson_id: null, lead_source: 'S17-smoke', quote_reference: null, presale_file_id: null, finance_route: 'Standard', contract_status: 'Signed', contract_id: null, contract_signed_at: null, contract_evidence_id: null, original_net_pence: 1000, original_vat_pence: 200, original_gross_pence: 1200, approved_change_pence: null, current_contract_gross_pence: 1200, valuation_basis: 'Standard', sold_booking_match_status: 'Match', customer_details_verified_at: null, customer_details_verified_by: null, deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null, roof_required: false, electrical_required: false, scaffold_required: false, workflow_stage: stage, booking_approved_at: null, booking_approved_by: null, operational_complete_at: null, operational_complete_by: null, customer_happy_at: null, customer_happy_by: null, handover_status: 'NotReady', financial_status: 'Pending', cancellation_at: null, cancellation_by: null, cancellation_reason: null, archived_at: null, next_action_at: null, account_policy_version: null, pilot_job: true, release_scope: 'R1', created_at: now, created_by: 'S17-smoke', updated_at: now, updated_by: 'S17-smoke', version: 1, source_system: 'S17-smoke', source_record_id: null, commit_id: 'S17-smoke' }); created.push('Jobs:' + id); } else { created.push('Jobs:' + id + ' (exists stage=' + j.workflow_stage + ')'); } } function ensureIssue(id, jobId) { var iss = s.get('Issues', id); if (!iss) { s.insert('Issues', { id: id, job_id: jobId, work_package_id: null, type: 'Remedial', category: 'Smoke', description: 'AppSheet R1 ISSUE_UPDATE smoke test', raised_at: now, raised_by: lennyId, responsible_person_id: null, responsible_company_id: null, office_owner_id: lennyId, severity: 'Normal', status: 'Open', due_at: '2026-12-31', next_followup_at: null, blocks_completion: false, blocks_strip: false, estimated_value_pence: null, approved_value_pence: null, approval_status: 'NotRequired', approved_at: null, approved_by: null, resolution: null, resolved_at: null, closed_at: null, closed_by: null, customer_resolution_confirmed: null, linked_return_package_id: null, evidence_folder_id: null, created_at: now, created_by: 'S17-smoke', updated_at: now, updated_by: 'S17-smoke', version: 1, source_system: 'S17-smoke', commit_id: 'S17-smoke' }); created.push('Issues:' + id); } else { created.push('Issues:' + id + ' (exists v' + iss.version + ')'); } } ensureRole('Office'); ensureRole('Admin'); ensureTask('TASK-s17-smoke-complete', 'J-s17-active', 'BKG04', 'AppSheet R1 TASK_COMPLETE smoke test', 'Booking'); ensureTask('TASK-s17-smoke-call', 'J-s17-active', 'INS01', 'AppSheet R1 CALL_RECORD smoke test', 'Calls'); ensureIssue('ISSUE-s17-smoke', 'J-s17-active'); ensureJob('J-s17-smoke-cancel', 'SS-S17S-MOKE-CANCEL', 'Booked'); var wp = s.get('WorkPackages', 'WP-s17-roof'); var plannerNote = wp ? 'WP-s17-roof exists v' + wp.version : 'WP-s17-roof MISSING'; return { ok: true, lenny_person_id: lennyId, created: created, planner_status: plannerNote, fixtures: { TASK_COMPLETE: { task_id: 'TASK-s17-smoke-complete', job_id: 'J-s17-active', owner_id: lennyId, version: (s.get('Tasks', 'TASK-s17-smoke-complete') || {}).version || 1 }, CALL_RECORD: { task_id: 'TASK-s17-smoke-call', job_id: 'J-s17-active', owner_id: lennyId, version: (s.get('Tasks', 'TASK-s17-smoke-call') || {}).version || 1 }, ISSUE_UPDATE: { issue_id: 'ISSUE-s17-smoke', job_id: 'J-s17-active', version: (s.get('Issues', 'ISSUE-s17-smoke') || {}).version || 1 }, PLANNER_UPDATE: { work_package_id: 'WP-s17-roof', job_id: 'J-s17-active', version: wp ? wp.version : null }, CANCEL_JOB: { job_id: 'J-s17-smoke-cancel', version: (s.get('Jobs', 'J-s17-smoke-cancel') || {}).version || 1 }, REINSTATE_JOB: { job_id: 'J-s17-smoke-cancel', version: 'AFTER_CANCEL' } } }; }); }); }
