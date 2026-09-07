/* Read-only cloud adapter for S19 migration rehearsal. No mutations. */
function _s19CloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (ss.getId() !== S19_DEV_SHEET_ID || !c || c.environment !== 'DEV') throw new Error('S19_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _s19Sheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('S19_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = S19_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('S19_SCHEMA: header mismatch ' + name);
  return sh;
}
function _s19CloudStore() {
  var ss = _s19CloudGuard();
  function list(name) {
    var sh = _s19Sheet(ss, name), h = S19_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) {
      var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x;
    }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _s19CloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) {
      var rows = list(name).filter(function (r) { return r.id === id; });
      if (rows.length > 1) throw new Error('S19_SCHEMA: duplicate ID ' + id);
      return rows[0] || null;
    }
  };
}
function _s19Result(name, fn) {
  try {
    var result = fn();
    var r = { test: name, pass: true, detail: result.detail || result };
    console.log(JSON.stringify(r));
    return r;
  } catch (e) {
    var r = { test: name, pass: false, detail: String(e.message || e) };
    console.log(JSON.stringify(r));
    return r;
  }
}
function runS19MigrationDryRun() { return _s19Result('S19 dry run', function () { var s = _s19CloudStore(); for (var n in S19_HEADERS) { if (S19_HEADERS.hasOwnProperty(n)) s.list(n); } return { ok: true }; }); }
function runS19MigrationRehearsal() { return _s19Result('S19 rehearsal', function () { var s = _s19CloudStore(); var s18summary = _s18AcceptanceSummary(s); var result = _s19MigrationSummary(s, s18summary); return { pass: true, r1: result.overall_r1, r2: result.overall_r2, r3: result.overall_r3, r4: result.overall_r4, mig_domains: result.migration.total_domains, mig_blocked: result.migration.blocked, trn_modules: result.training.total_modules, trn_not_run: result.training.not_run, cutover_steps: result.cutover.total_steps, external_calls: 0 }; }); }
function runS19MigrationSummary() { return _s19Result('S19 summary', function () { var s = _s19CloudStore(); var s18summary = _s18AcceptanceSummary(s); var result = _s19MigrationSummary(s, s18summary); return { r1_handoff: result.overall_r1, r2_handoff: result.overall_r2, r3_handoff: result.overall_r3, r4_handoff: result.overall_r4 }; }); }
