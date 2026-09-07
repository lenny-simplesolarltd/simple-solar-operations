/* Read-only cloud adapter for S18 acceptance. No mutations, no lock required. */
function _s18CloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (ss.getId() !== S18_DEV_SHEET_ID || !c || c.environment !== 'DEV') throw new Error('S18_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _s18Sheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('S18_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = S18_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('S18_SCHEMA: header mismatch ' + name);
  return sh;
}
function _s18CloudStore() {
  var ss = _s18CloudGuard();
  function list(name) {
    var sh = _s18Sheet(ss, name), h = S18_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) {
      var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x;
    }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _s18CloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) {
      var rows = list(name).filter(function (r) { return r.id === id; });
      if (rows.length > 1) throw new Error('S18_SCHEMA: duplicate ID ' + id);
      return rows[0] || null;
    }
  };
}
function _s18Result(name, fn) {
  try {
    var result = fn();
    var r = { test: name, pass: result.pass === undefined ? true : result.pass, detail: result.detail || result };
    console.log(JSON.stringify(r));
    return r;
  } catch (e) {
    var r = { test: name, pass: false, detail: String(e.message || e) };
    console.log(JSON.stringify(r));
    return r;
  }
}
function runS18AcceptanceDryRun() { return _s18Result('S18 dry run', function () { var s = _s18CloudStore(); for (var n in S18_HEADERS) { if (S18_HEADERS.hasOwnProperty(n)) s.list(n); } return { ok: true }; }); }
function runS18AcceptanceTest() { return _s18Result('S18 acceptance', function () { var s = _s18CloudStore(); var result = _s18AcceptanceSummary(s); return { pass: true, summary: result.overall_r1 + ' / ' + result.overall_r2 + ' / ' + result.overall_r3 + ' / ' + result.overall_r4, automated_checks: result.automated.total, automated_pass: result.automated.pass, automated_blocked: result.automated.blocked, manual_total: result.manual.total, manual_blocked: result.manual.blocked, external_calls: 0 }; }); }
