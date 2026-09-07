/* Header-checked enumeration adapter. S17 is read-only — no ScriptLock required for mutations. */
function _s17CloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (ss.getId() !== S17_DEV_SHEET_ID || !c || c.environment !== 'DEV') throw new Error('S17_REFUSED: exact DEV sheet/environment required');
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
