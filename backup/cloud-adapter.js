/* Backup service cloud adapter: header-checked Sheets store + zero-arg DEV entry points. Drive writes only to S01_CONFIG.backupFolderId.
 * Restore rehearsal creates a NEW spreadsheet; in-place restore is refused. */
function _bkCloudConfig() {
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (!c || c.environment !== 'DEV') throw new Error('BK_REFUSED: exact DEV environment required');
  return c;
}
function _bkCloudGuard() { var ss = SpreadsheetApp.getActiveSpreadsheet(); _bkCloudConfig(); if (ss.getId() !== BK_DEV_SHEET_ID) throw new Error('BK_REFUSED: exact DEV sheet/environment required'); return ss; }
function _bkSheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('BK_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = BK_HEADERS[name];
  if (!headers || sh.getLastColumn() < headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers)) throw new Error('BK_SCHEMA: header mismatch ' + name);
  return sh;
}
function _bkCell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
function _bkCloudStore() {
  var ss = _bkCloudGuard();
  function list(name) {
    var sh = _bkSheet(ss, name), h = BK_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) { var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x; }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _bkCloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) { var rows = list(name).filter(function (r) { return r.id === id; }); if (rows.length > 1) throw new Error('BK_SCHEMA: duplicate ID ' + id); return rows[0] || null; },
    insert: function (name, row) {
      if (['ReportSnapshots', 'AuditEvents'].indexOf(name) === -1) throw new Error('BK_REFUSED: backup service writes only ReportSnapshots/AuditEvents in the DEV workbook');
      var sh = _bkSheet(ss, name), h = BK_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('BK_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('BK_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && h.indexOf(k) === -1) throw new Error('BK_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _bkCell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      if (name !== 'ReportSnapshots') throw new Error('BK_REFUSED: backup service updates only ReportSnapshots');
      var sh = _bkSheet(ss, name), h = BK_HEADERS[name], values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues(), indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('BK_SCHEMA: update row ' + id);
      var row = values[indices[0]];
      for (var k in patch) { if (!patch.hasOwnProperty(k)) continue; if (h.indexOf(k) === -1) throw new Error('BK_SCHEMA: unknown field ' + name + '.' + k); row[h.indexOf(k)] = patch[k]; }
      sh.getRange(indices[0] + 2, 1, 1, h.length).setValues([row.map(_bkCell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) throw new Error('BK_BUSY'); try { return fn(); } finally { lock.releaseLock(); } }
  };
}
function _bkResult(name, fn) {
  try { var result = fn(); var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result }; console.log(JSON.stringify(r)); return r; }
  catch (e) { var f = { test: name, pass: false, detail: String(e.message || e) }; console.log(JSON.stringify(f)); return f; }
}
function _bkActor() { try { var e = Session.getActiveUser().getEmail(); return e ? String(e) : 'DEV-apps-script'; } catch (x) { return 'DEV-apps-script'; } }
function _bkStamp() { return new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14); }
function runBkStatus() { return _bkResult('BK status', function () { return Object.assign({ ok: true }, _bkStatus(_bkCloudStore(), { config: _bkCloudConfig() })); }); }
/* One full data backup per calendar day (idempotent): safe for a daily time-driven trigger. NOT_CONFIGURED without backupFolderId. */
function runBkDailyBackup() {
  return _bkResult('BK daily backup', function () {
    var s = _bkCloudStore();
    return s.withLock(function () { var r = _bkExport(s, { actor: _bkActor(), command_id: 'DAILY-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''), config: _bkCloudConfig() }); return Object.assign({ ok: r.configured !== false }, r); });
  });
}
function runBkBackupNow() { return _bkResult('BK backup now', function () { var s = _bkCloudStore(); return s.withLock(function () { var r = _bkExport(s, { actor: _bkActor(), command_id: 'ADHOC-' + _bkStamp(), config: _bkCloudConfig() }); return Object.assign({ ok: r.configured !== false }, r); }); }); }
function runBkVerify(backupId) { return _bkResult('BK verify', function () { var s = _bkCloudStore(); return s.withLock(function () { return Object.assign({ ok: true }, _bkVerify(s, { actor: _bkActor(), command_id: 'VERIFY-' + backupId + '-' + _bkStamp(), backup_id: backupId })); }); }); }
function runBkCompare(backupId) { return _bkResult('BK compare', function () { return Object.assign({ ok: true }, _bkCompare(_bkCloudStore(), { backup_id: backupId })); }); }
function runBkRetentionReview(days) { return _bkResult('BK retention review', function () { return Object.assign({ ok: true }, _bkRetentionReview(_bkCloudStore(), { days: days || 30 })); }); }
/* Non-destructive: writes the verified backup into a NEW spreadsheet in the backups folder. Requires S01_CONFIG.restoreMode === 'REHEARSAL'. */
function runBkRestoreRehearsal(backupId, reason) {
  return _bkResult('BK restore rehearsal', function () {
    var s = _bkCloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _bkRestoreRehearsal(s, { actor: _bkActor(), command_id: 'REHEARSAL-' + backupId + '-' + _bkStamp(), backup_id: backupId, reason: reason || 'DEV restore rehearsal', confirm: BK_RESTORE_CONFIRM, config: _bkCloudConfig() })); });
  });
}
/* Backup → verify → compare (→ rehearsal when restoreMode is REHEARSAL). Touches only Drive backups folder + ReportSnapshots/AuditEvents. */
function runBkHappyPathTest() {
  return _bkResult('BK happy path', function () {
    var c = _bkCloudConfig();
    if (!c.backupFolderId) throw new Error('BK_NOT_CONFIGURED: set S01_CONFIG.backupFolderId to the DEV Shared Drive Backups folder ID');
    var s = _bkCloudStore(), actor = _bkActor(), stamp = _bkStamp();
    return s.withLock(function () {
      var b = _bkExport(s, { actor: actor, command_id: 'SMOKE-' + stamp, config: c });
      var again = _bkExport(s, { actor: actor, command_id: 'SMOKE-' + stamp, config: c });
      var v = _bkVerify(s, { actor: actor, command_id: 'SMOKE-' + stamp + '-V', backup_id: b.backup_id });
      var cmp = _bkCompare(s, { backup_id: b.backup_id });
      var rehearsal = null;
      if (c.restoreMode === 'REHEARSAL') rehearsal = _bkRestoreRehearsal(s, { actor: actor, command_id: 'SMOKE-' + stamp + '-R', backup_id: b.backup_id, reason: 'Smoke rehearsal', confirm: BK_RESTORE_CONFIRM, config: c });
      var inPlace; try { _bkRestoreInPlace(s, {}); inPlace = 'ALLOWED?!'; } catch (e) { inPlace = 'refused'; }
      var pass = b.created === true && again.replay === true && v.valid === true && inPlace === 'refused' && (rehearsal === null || (rehearsal.spreadsheet_id && rehearsal.spreadsheet_id !== BK_DEV_SHEET_ID));
      return { pass: pass, detail: { backup_id: b.backup_id, file_id: b.file_id, rows: b.total_rows, bytes: b.bytes, verified: v.valid, mismatches: v.mismatches, identical_now: cmp.identical, rehearsal: rehearsal ? { spreadsheet_id: rehearsal.spreadsheet_id, tables: rehearsal.tables_written, rows: rehearsal.rows_written } : 'skipped (restoreMode not REHEARSAL)', in_place_restore: inPlace } };
    });
  });
}
