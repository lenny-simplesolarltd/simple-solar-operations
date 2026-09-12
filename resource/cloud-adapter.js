/* Resource planning cloud adapter. Header-NAME mapped store (tolerates extra/reordered columns on tabs the browser agent may have
 * created) and an additive provisioner for the four resource tables. DEV only. No external calls. */
function _rpCloudConfig() {
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (!c || c.environment !== 'DEV') throw new Error('RP_REFUSED: exact DEV environment required');
  return c;
}
function _rpCloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _rpCloudConfig();
  if (ss.getId() !== RP_DEV_SHEET_ID) throw new Error('RP_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _rpFindSheet(ss, name) { var m = ss.getSheets().filter(function (s) { return s.getName() === name; }); if (m.length > 1) throw new Error('RP_SCHEMA: duplicate tab ' + name); return m[0] || null; }
function _rpHeadersOf(sh) { var n = sh.getLastColumn(); if (n < 1) return []; return sh.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h || '').trim(); }); }
function _rpCell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
/* Name-mapped store: required = schema headers; actual tab may hold them in any order with extra columns. Missing tab → list() throws (callers use optional reads). */
function _rpCloudStore() {
  var ss = _rpCloudGuard();
  function sheet(name) {
    var sh = _rpFindSheet(ss, name); if (!sh) throw new Error('RP_SCHEMA: missing tab ' + name + ' (run runRpProvisionMissingTabs)');
    var actual = _rpHeadersOf(sh), expected = RP_HEADERS[name] || [];
    var missing = expected.filter(function (h) { return actual.indexOf(h) === -1; });
    if (missing.length) throw new Error('RP_SCHEMA: tab ' + name + ' missing columns ' + missing.join(','));
    return { sh: sh, headers: actual };
  }
  function list(name) {
    var s = sheet(name); if (s.sh.getLastRow() < 2) return [];
    return s.sh.getRange(2, 1, s.sh.getLastRow() - 1, s.headers.length).getValues().map(function (row) { var x = {}; s.headers.forEach(function (k, i) { if (k) x[k] = row[i] === '' ? null : row[i]; }); return x; }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _rpCloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) { var rows = list(name).filter(function (r) { return r.id === id; }); if (rows.length > 1) throw new Error('RP_SCHEMA: duplicate ID ' + id); return rows[0] || null; },
    insert: function (name, row) {
      var s = sheet(name);
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('RP_SCHEMA: duplicate insert ' + row.id);
      if (s.sh.getLastRow() >= s.sh.getMaxRows()) throw new Error('RP_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && s.headers.indexOf(k) === -1) throw new Error('RP_SCHEMA: unknown field ' + name + '.' + k);
      s.sh.getRange(s.sh.getLastRow() + 1, 1, 1, s.headers.length).setValues([s.headers.map(function (k) { return _rpCell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var s = sheet(name), values = s.sh.getRange(2, 1, Math.max(1, s.sh.getLastRow() - 1), s.headers.length).getValues(), idIdx = s.headers.indexOf('id'), indices = [];
      values.forEach(function (r, i) { if (r[idIdx] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('RP_SCHEMA: update row ' + id);
      var row = values[indices[0]];
      for (var k in patch) { if (!patch.hasOwnProperty(k)) continue; var j = s.headers.indexOf(k); if (j === -1) throw new Error('RP_SCHEMA: unknown field ' + name + '.' + k); row[j] = patch[k]; }
      s.sh.getRange(indices[0] + 2, 1, 1, s.headers.length).setValues([row.map(_rpCell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) throw new Error('RP_BUSY'); try { return fn(); } finally { lock.releaseLock(); } }
  };
}
function _rpResult(name, fn) {
  try { var result = fn(); var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result }; console.log(JSON.stringify(r)); return r; }
  catch (e) { var f = { test: name, pass: false, detail: String(e.message || e) }; console.log(JSON.stringify(f)); return f; }
}
function _rpActorId() {
  try {
    var email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    var s = _rpCloudStore(), p = s.list('People').filter(function (x) { return String(x.email || '').toLowerCase() === email && (x.active === true || x.active === 'TRUE'); })[0];
    return p ? p.id : null;
  } catch (e) { return null; }
}
/* Additive provisioning: create only the resource tabs that are missing; add only missing columns to existing resource tabs. Never touches other tabs. */
function _rpProvisionCheck() {
  var ss = _rpCloudGuard(), out = {};
  RP_TABLES.forEach(function (name) {
    var sh = _rpFindSheet(ss, name);
    if (!sh) { out[name] = { present: false, missing_columns: RP_HEADERS[name], extra_columns: [] }; return; }
    var actual = _rpHeadersOf(sh), expected = RP_HEADERS[name];
    out[name] = { present: true, rows: Math.max(0, sh.getLastRow() - 1), missing_columns: expected.filter(function (h) { return actual.indexOf(h) === -1; }), extra_columns: actual.filter(function (h) { return h && expected.indexOf(h) === -1; }) };
  });
  return out;
}
function runRpProvisionCheck() { return _rpResult('RP provision check', function () { return { ok: true, tables: _rpProvisionCheck() }; }); }
function runRpProvisionMissingTabs() {
  return _rpResult('RP provision missing tabs', function () {
    var ss = _rpCloudGuard(), created = [], columnsAdded = [];
    RP_TABLES.forEach(function (name) {
      var sh = _rpFindSheet(ss, name), expected = RP_HEADERS[name];
      if (!sh) {
        sh = ss.insertSheet(name);
        sh.getRange(1, 1, 1, expected.length).setValues([expected]).setFontWeight('bold');
        sh.getRange(1, 1, Math.max(2, sh.getMaxRows()), expected.length).setNumberFormat('@');
        sh.setFrozenRows(1);
        created.push(name);
      } else {
        var actual = _rpHeadersOf(sh), missing = expected.filter(function (h) { return actual.indexOf(h) === -1; });
        if (missing.length) { var startCol = Math.max(1, actual.length) + 1; sh.getRange(1, startCol, 1, missing.length).setValues([missing]).setFontWeight('bold'); columnsAdded.push({ tab: name, added: missing }); }
      }
    });
    SpreadsheetApp.flush();
    return { ok: true, created: created, columns_added: columnsAdded, after: _rpProvisionCheck() };
  });
}
function runRpStatus() { return _rpResult('RP status', function () { return Object.assign({ ok: true }, _rpStatus(_rpCloudStore())); }); }
function runRpTeams() { return _rpResult('RP teams', function () { return { ok: true, teams: _rpTeams(_rpCloudStore()) }; }); }
function runRpAssess(trade, startDate, endDate, teamId) { return _rpResult('RP assess', function () { return Object.assign({ ok: true }, _rpAssess(_rpCloudStore(), { trade: trade, start_at: startDate, end_at: endDate, team_id: teamId || null })); }); }
function runRpChangeInstallerOptions(workPackageId, oldAllocationId) { return _rpResult('RP change installer options', function () { return Object.assign({ ok: true }, _rpChangeInstallerOptions(_rpCloudStore(), { work_package_id: workPackageId, old_allocation_id: oldAllocationId || null })); }); }
function runRpMoveJobPreview(jobId, activitiesCsv, plannedStart, plannedEnd, scaffoldErect, scaffoldStrip) { return _rpResult('RP move job preview', function () { return Object.assign({ ok: true }, _rpMoveJobPreview(_rpCloudStore(), { job_id: jobId, activities: String(activitiesCsv || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), planned_start: plannedStart || null, planned_end: plannedEnd || null, scaffold_erect: scaffoldErect || null, scaffold_strip: scaffoldStrip || null })); }); }
function runRpTeamPlanner(startDate, weeks) { return _rpResult('RP team planner', function () { return Object.assign({ ok: true }, _rpTeamPlanner(_rpCloudStore(), startDate || new Date().toISOString().slice(0, 10), weeks || 3)); }); }
/* Synthetic DEV smoke: two synthetic installers, skills, leave, one team; assess shows skill/leave/capacity reasons; rows left inactive. Requires the four tabs. */
function runRpHappyPathTest() {
  return _rpResult('RP happy path', function () {
    var s = _rpCloudStore(), actor = _rpActorId();
    if (!actor) throw new Error('RP_REFUSED: signed-in user is not an active People row (actor required for configuration)');
    var check = _rpProvisionCheck(), notReady = RP_TABLES.filter(function (n) { return !check[n].present || check[n].missing_columns.length; });
    if (notReady.length) throw new Error('RP_NOT_PROVISIONED: run runRpProvisionMissingTabs first (' + notReady.join(',') + ')');
    return s.withLock(function () {
      var n = new Date().toISOString(), stamp = n.replace(/[^0-9]/g, '').substring(0, 17) + Math.random().toString(36).slice(2, 6), a = 'PERSON-rp-a-' + stamp, b = 'PERSON-rp-b-' + stamp;
      [[a, 'RP Roofer ' + stamp, 1], [b, 'RP Sparky ' + stamp, 1]].forEach(function (x) { s.insert('People', { id: x[0], email: x[0].toLowerCase() + '@dev.example.invalid', display_name: x[1], role: 'Installer', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: x[2], available_from: null, available_to: null, backup_person_id: null, created_at: n, created_by: 'RP-fixture', updated_at: n, updated_by: 'RP-fixture', version: 1, source_system: 'RP-fixture', source_record_id: null, commit_id: 'RP-fixture' }); });
      var start = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10), end = new Date(Date.now() + 22 * 86400000).toISOString().slice(0, 10);
      var r1 = _rpSetSkill(s, { actor: actor, command_id: 'RP-' + stamp + '-SK1', person_id: a, skill: 'Roof', level: 'Lead' });
      var r2 = _rpSetSkill(s, { actor: actor, command_id: 'RP-' + stamp + '-SK2', person_id: b, skill: 'Electrical', level: 'Member' });
      var lv = _rpSetAvailability(s, { actor: actor, command_id: 'RP-' + stamp + '-LV', person_id: b, type: 'Leave', from_date: start, to_date: end, reason: 'Synthetic leave' });
      var t = _rpUpsertTeam(s, { actor: actor, command_id: 'RP-' + stamp + '-TEAM', team_id: 'TEAM-rp-' + stamp, name: 'RP Smoke ' + stamp, trade: 'Mixed' });
      var m1 = _rpSetTeamMember(s, { actor: actor, command_id: 'RP-' + stamp + '-M1', team_id: t.team.id, person_id: a, role: 'Lead' });
      var m2 = _rpSetTeamMember(s, { actor: actor, command_id: 'RP-' + stamp + '-M2', team_id: t.team.id, person_id: b, role: 'Member' });
      var roof = _rpAssess(s, { trade: 'Roof', start_at: start, end_at: end, person_ids: [a, b] }), elec = _rpAssess(s, { trade: 'Electrical', start_at: start, end_at: end, team_id: t.team.id });
      var replay = _rpSetSkill(s, { actor: actor, command_id: 'RP-' + stamp + '-SK1', person_id: a, skill: 'Roof', level: 'Lead' });
      var byId = function (res, id) { return res.candidates.filter(function (c) { return c.person_id === id; })[0]; };
      var pass = r1.created && r2.created && lv.created && m1.created && m2.created && replay.replay === true && byId(roof, a).ready === true && byId(roof, b).reasons.indexOf('SKILL_MISMATCH') !== -1 && byId(roof, b).reasons.indexOf('ON_LEAVE') !== -1 && byId(elec, b).reasons.indexOf('ON_LEAVE') !== -1 && elec.team.lead_person_id === a && elec.team.all_ready === false;
      /* Leave synthetic rows inactive. */
      _rpSetTeamMember(s, { actor: actor, command_id: 'RP-' + stamp + '-M1X', team_id: t.team.id, person_id: a, role: 'Lead', active: false });
      _rpSetTeamMember(s, { actor: actor, command_id: 'RP-' + stamp + '-M2X', team_id: t.team.id, person_id: b, role: 'Member', active: false });
      _rpUpsertTeam(s, { actor: actor, command_id: 'RP-' + stamp + '-TEAMX', team_id: t.team.id, name: 'RP Smoke ' + stamp, trade: 'Mixed', active: false });
      _rpCancelAvailability(s, { actor: actor, command_id: 'RP-' + stamp + '-LVX', availability_id: lv.availability.id, reason: 'Smoke cleanup' });
      [a, b].forEach(function (id) { s.update('People', id, { active: false, updated_at: new Date().toISOString(), updated_by: actor, version: 2 }); });
      return { pass: pass, detail: { roof_ready: roof.ready_count, roof_b_reasons: byId(roof, b).reasons, elec_team: elec.team, replay: replay.replay, external_calls: 0 } };
    });
  });
}
