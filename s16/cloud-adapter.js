/* Header-checked enumeration adapter; shared ScriptLock for every S16 mutation. */
function _s16CloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (ss.getId() !== S16_DEV_SHEET_ID || !c || c.environment !== 'DEV') throw new Error('S16_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _s16Sheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('S16_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = S16_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('S16_SCHEMA: header mismatch ' + name);
  return sh;
}
function _s16Cell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
function _s16CloudStore() {
  var ss = _s16CloudGuard();
  function list(name) {
    var sh = _s16Sheet(ss, name), h = S16_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) {
      var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x;
    }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _s16CloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) {
      var rows = list(name).filter(function (r) { return r.id === id; });
      if (rows.length > 1) throw new Error('S16_SCHEMA: duplicate ID ' + id);
      return rows[0] || null;
    },
    insert: function (name, row) {
      var sh = _s16Sheet(ss, name), h = S16_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('S16_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('S16_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && !h.includes(k)) throw new Error('S16_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _s16Cell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var sh = _s16Sheet(ss, name), h = S16_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues();
      var indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('S16_SCHEMA: update row ' + id);
      var idx = indices[0], row = values[idx];
      for (var k in patch) {
        if (!patch.hasOwnProperty(k)) continue;
        if (!h.includes(k)) throw new Error('S16_SCHEMA: unknown field ' + name + '.' + k);
        row[h.indexOf(k)] = patch[k];
      }
      sh.getRange(idx + 2, 1, 1, h.length).setValues([row.map(_s16Cell)]);
      SpreadsheetApp.flush();
    },
    delete: function (name, id) {
      var sh = _s16Sheet(ss, name), h = S16_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues();
      var indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('S16_SCHEMA: delete row ' + id + ' (found ' + indices.length + ')');
      // Clear row — set all cells to empty. list() filters rows without id.
      sh.getRange(indices[0] + 2, 1, 1, h.length).setValues([h.map(function () { return ''; })]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(5000)) throw new Error('S16_BUSY');
      try { return fn(); } finally { lock.releaseLock(); }
    }
  };
}
function _s16Result(name, fn) {
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
function restoreS16SafeState() { return _s16Result('S16 restore', function () { return _s16SetModes(_s16CloudStore(), false); }); }
function runS16FixtureDryRun() { return _s16Result('S16 dry run', function () { var s = _s16CloudStore(); for (var n in S16_HEADERS) { if (S16_HEADERS.hasOwnProperty(n)) s.list(n); } _s16ModesSnapshot(s); return { ok: true, existing_old_job: !!s.get('Jobs', 'J-s16-old') }; }); }
function runS16FixtureApply() { return _s16Result('S16 fixture apply', function () { var s = _s16CloudStore(); return s.withLock(function () { _s16Seed(s); return { ok: true }; }); }); }
function runS16FixtureValidate() { return _s16Result('S16 fixture validate', function () { var s = _s16CloudStore(), data = _s16FixtureRows(); function verifyRows(rows, expectedCreatedBy) { for (var t in rows) { if (!rows.hasOwnProperty(t)) continue; for (var i = 0; i < rows[t].length; i++) { var r = rows[t][i]; var v = _s16VerifyRow(s, t, r.id, expectedCreatedBy); if (!v.ok) throw new Error('S16_FIXTURE: ' + t + '/' + r.id + ' — ' + v.detail); } } } /* Shared: no created_by check (canonical, seeded by prior stages). Owned: require S16. */ verifyRows(data.shared, null); verifyRows(data.owned, 'S16'); return { ok: true }; }); }
function runS16EnableFunctionsForSyntheticTest() { return _s16Result('S16 enable', function () { return _s16SetModes(_s16CloudStore(), true); }); }
function runS16ResetFixture() { return _s16Result('S16 reset fixture', function () { return _s16ResetFixture(_s16CloudStore()); }); }
function runS16DiagnoseModes() { return _s16Result('S16 diagnose modes', function () { var s = _s16CloudStore(); var rows = s.list('ReleaseModes'); var fn13 = rows.filter(function (r) { return r.function_id === 'FN-13'; }); var fn14 = rows.filter(function (r) { return r.function_id === 'FN-14'; }); var fn16 = rows.filter(function (r) { return r.function_id === 'FN-16'; }); return { ok: true, fn13_count: fn13.length, fn13: fn13.map(function (r) { return { id: r.id, mode: r.mode, scope: r.authorised_job_scope, target_release: r.target_release, planned_target_mode: r.planned_target_mode }; }), fn14_count: fn14.length, fn14: fn14.map(function (r) { return { id: r.id, mode: r.mode, scope: r.authorised_job_scope, target_release: r.target_release }; }), fn16_count: fn16.length, fn16: fn16.map(function (r) { return { id: r.id, mode: r.mode, scope: r.authorised_job_scope, target_release: r.target_release }; }) }; }); }
function _s16CloudConfig() {
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (!c || c.environment !== 'DEV') throw new Error('S16_REFUSED: exact DEV sheet/environment required');
  return c;
}
function runS16HappyPathTest() {
  return _s16Result('S16 happy path', function () {
    var c = _s16CloudConfig();
    return _s16Smoke(_s16CloudStore(), typeof S16_HEALTH_EXPORTS !== 'undefined' ? S16_HEALTH_EXPORTS : { _s16HealthStatus: _s16HealthStatus, _s16BackupManifest: _s16BackupManifest, _s16ValidateBackup: _s16ValidateBackup, _s16RestorePlan: _s16RestorePlan, _s16ArchiveEligibility: _s16ArchiveEligibility, _s16ArchiveJob: _s16ArchiveJob, _s16ReopenArchivedJob: _s16ReopenArchivedJob, _s16SystemTasks: _s16SystemTasks, _s16SetModes: _s16SetModes }, c);
  });
}
/* Focused DEV Drive backup smoke: enables modes, writes one backup artifact, restores modes. */
function runS16DevBackupDriveSmoke() {
  return _s16Result('S16 DEV backup Drive smoke', function () {
    var c = _s16CloudConfig();
    if (!c.backupFolderId || String(c.backupFolderId).trim() === '') throw new Error('S16_NOT_CONFIGURED: set S01_CONFIG.backupFolderId to the Shared Drive Backups folder ID');
    var s = _s16CloudStore();
    return s.withLock(function () {
      _s16SetModes(s, true);
      try {
        var b = _s16BackupManifest(s, { command_id: 'S16-DEV-DRIVE-SMOKE', actor: 'PERSON-tanya', config: c });
        var fileId = b.file_id || (b.manifest && b.manifest.file_id) || null;
        if (!fileId) throw new Error('S16_BACKUP: expected Drive file_id after configured backup');
        var v = null;
        if (!b.replay) v = _s16ValidateBackup(s, b.backup_id || (b.manifest && b.manifest.id));
        var restore = _s16RestorePlan(s, b.backup_id || b.manifest.id, { actor: 'PERSON-tanya', reason: 'Confirm dry-run still blocked after Drive backup' });
        return {
          ok: true,
          backup_id: b.backup_id || b.manifest.id,
          file_id: fileId,
          destination: b.destination,
          checksum: b.checksum,
          replay: !!b.replay,
          drive_created: !!b.drive_created,
          validation_valid: v ? v.valid : 'skipped-replay',
          restore_blocked: !!restore.blocked,
          restore_dry_run: !!restore.dry_run
        };
      } finally {
        _s16SetModes(s, false);
      }
    });
  });
}

/* --- Processing heartbeats (FN-14). Read-only status; idempotent writes under ScriptLock. --- */
function runS16HeartbeatStatus() {
  return _s16Result('S16 heartbeat status', function () { return Object.assign({ ok: true }, _s16HeartbeatStatus(_s16CloudStore(), {})); });
}
function runS16RecordHeartbeat(component, commandId, outcome, errorCode) {
  return _s16Result('S16 record heartbeat', function () {
    var s = _s16CloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _s16RecordHeartbeat(s, { component: component, command_id: commandId, outcome: outcome, error_code: errorCode })); });
  });
}
/* Safe for an hourly time-driven trigger (not installed by code): one row per hour, replays are no-ops. */
function runS16HeartbeatTick() {
  return _s16Result('S16 heartbeat tick', function () {
    var s = _s16CloudStore();
    return s.withLock(function () { return Object.assign({ ok: true }, _s16HeartbeatTick(s, { component: 'HealthMonitor' })); });
  });
}
/* Zero-arg DEV smoke: OK → replay → Fresh, FAILED → Failing surfaces in health, final OK leaves component Fresh.
 * Modes are toggled outside the lock because _s16SetModes takes the ScriptLock itself (no nested locks). */
function runS16HeartbeatSmoke() {
  return _s16Result('S16 heartbeat smoke', function () {
    var s = _s16CloudStore();
    _s16SetModes(s, true);
    try {
      return s.withLock(function () {
        var stamp = new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14);
        function comp(status) { return status.components.filter(function (c) { return c.component === 'S16Smoke'; })[0] || null; }
        var first = _s16RecordHeartbeat(s, { component: 'S16Smoke', command_id: 'SMOKE-' + stamp + '-OK' });
        var replay = _s16RecordHeartbeat(s, { component: 'S16Smoke', command_id: 'SMOKE-' + stamp + '-OK' });
        var fresh = comp(_s16HeartbeatStatus(s, {}));
        var failed = _s16RecordHeartbeat(s, { component: 'S16Smoke', command_id: 'SMOKE-' + stamp + '-FAIL', outcome: 'FAILED', error_code: 'Synthetic smoke failure' });
        var failing = comp(_s16HeartbeatStatus(s, {}));
        var health = _s16HealthStatus(s);
        var surfaced = health.warnings.concat(health.issues).some(function (w) { return w.component === 'Heartbeat:S16Smoke'; });
        var recovered = _s16RecordHeartbeat(s, { component: 'S16Smoke', command_id: 'SMOKE-' + stamp + '-RECOVER' });
        var after = comp(_s16HeartbeatStatus(s, {}));
        var pass = !!(first.created && replay.replay && fresh && fresh.state === 'Fresh' && failed.created && failing && failing.state === 'Failing' && surfaced && recovered.created && after && after.state === 'Fresh' && after.last_success_at === recovered.last_success);
        return { pass: pass, detail: { first: first.heartbeat_id, replay: replay.replay, fresh_state: fresh ? fresh.state : null, failing_state: failing ? failing.state : null, failing_error: failing ? failing.error_code : null, health_overall: health.overall, surfaced_in_health: surfaced, recovered_state: after ? after.state : null, external_calls: 0 } };
      });
    } finally {
      _s16SetModes(s, false);
    }
  });
}
