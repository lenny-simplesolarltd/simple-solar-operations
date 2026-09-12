/* S16 processing heartbeat tests — local only, no cloud, no external calls. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const core = require('../s16/health.js'), hb = require('../s16/heartbeat.js'), fixture = require('../s16/fixture.js');
const copy = x => structuredClone(x);

/* Wednesday 16 Sep 2026 11:00 London (BST) — inside the default staffed window. */
const STAFFED_NOW = '2026-09-16T10:00:00.000Z';
/* Saturday 19 Sep 2026 11:00 London — outside the staffed window. */
const WEEKEND_NOW = '2026-09-19T10:00:00.000Z';
/* Wednesday 16 Sep 2026 19:00 London — after office hours. */
const EVENING_NOW = '2026-09-16T18:00:00.000Z';

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  let held = false;
  const s = {
    tables,
    getSheetId: () => core.S16_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) {
      assert.ok(tables[n], n);
      assert.ok(!this.get(n, r.id), 'duplicate ' + r.id);
      const headers = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(r)) assert.ok(headers.includes(k), 'unknown ' + n + '.' + k);
      tables[n].push(copy(r));
    },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); assert.ok(r, n + '/' + id); Object.assign(r, copy(p)); },
    delete(n, id) { const idx = tables[n].findIndex(r => r.id === id); assert.ok(idx !== -1, n + '/' + id); tables[n].splice(idx, 1); },
    withLock(fn) { assert.equal(held, false, 'lock contention'); held = true; try { return fn(); } finally { held = false; } }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  for (const r of seed.Settings) s.insert('Settings', { ...r, created_at: '2026-01-01T00:00:00.000Z', commit_id: 'seed' });
  fixture._s16Seed(s);
  core._s16SetModes(s, true);
  return s;
}
function minutesBefore(iso, minutes) { return new Date(new Date(iso).getTime() - minutes * 60000).toISOString(); }
function rows(s) { return s.tables.HealthChecks.filter(r => r.integration.startsWith('Processing:')); }

test('HB 01: recording an OK heartbeat writes one Processing row with last_success', () => {
  const s = makeStore();
  const r = hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'CMD-1', now: STAFFED_NOW });
  assert.equal(r.created, true);
  assert.equal(r.heartbeat_id, 'HB-AppSheetBridge-CMD-1');
  assert.equal(rows(s).length, 1);
  const row = rows(s)[0];
  assert.equal(row.integration, 'Processing:AppSheetBridge');
  assert.equal(row.outcome, 'OK');
  assert.equal(row.checked_at, STAFFED_NOW);
  assert.equal(row.last_success, STAFFED_NOW);
  assert.equal(row.error_code, null);
  assert.equal(row.commit_id, 'S16-HB-CMD-1');
});

test('HB 02: replaying the same component + command_id is a no-op', () => {
  const s = makeStore();
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'CMD-1', now: STAFFED_NOW });
  const before = copy(s.tables);
  const r = hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'CMD-1', outcome: 'FAILED', now: EVENING_NOW });
  assert.equal(r.created, false);
  assert.equal(r.replay, true);
  assert.equal(r.outcome, 'OK');
  assert.deepEqual(s.tables, before);
  /* Same command_id under a different component is a distinct heartbeat, not a collision. */
  const other = hb._s16RecordHeartbeat(s, { component: 'Intake', command_id: 'CMD-1', now: STAFFED_NOW });
  assert.equal(other.created, true);
  assert.equal(rows(s).length, 2);
});

test('HB 03: a failed heartbeat carries the prior last_success forward and truncates the error', () => {
  const s = makeStore();
  const t0 = minutesBefore(STAFFED_NOW, 30);
  hb._s16RecordHeartbeat(s, { component: 'Intake', command_id: 'A', now: t0 });
  const r = hb._s16RecordHeartbeat(s, { component: 'Intake', command_id: 'B', outcome: 'FAILED', error_code: new Error('x'.repeat(500)), now: STAFFED_NOW });
  assert.equal(r.created, true);
  assert.equal(r.outcome, 'FAILED');
  assert.equal(r.last_success, t0);
  assert.equal(r.error_code.length, 200);
  const fails = hb._s16RecordHeartbeat(s, { component: 'Intake', command_id: 'C', outcome: 'TIMEOUT', now: STAFFED_NOW });
  assert.equal(fails.error_code, 'TIMEOUT');
  /* First-ever failure has no prior success. */
  const first = hb._s16RecordHeartbeat(s, { component: 'Outbox', command_id: 'F', outcome: 'FAILED', now: STAFFED_NOW });
  assert.equal(first.last_success, null);
});

test('HB 04: status reports Fresh inside the staffed window and within the threshold', () => {
  const s = makeStore();
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A', now: minutesBefore(STAFFED_NOW, 45) });
  const st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW });
  assert.equal(st.stale_minutes, 120);
  assert.equal(st.staffed_window.staffed, true);
  assert.equal(st.staffed_window.local_date, '2026-09-16');
  assert.equal(st.staffed_window.local_time, '11:00');
  assert.equal(st.components.length, 1);
  assert.equal(st.components[0].state, 'Fresh');
  assert.equal(st.components[0].age_minutes, 45);
  assert.equal(st.alert_count, 0);
  assert.deepEqual(st.summary, { fresh: 1, stale: 0, failing: 0, quiet: 0, never: 0 });
});

test('HB 05: stale in staffed window is a Warning; failing and stale is Critical', () => {
  const s = makeStore();
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A', now: minutesBefore(STAFFED_NOW, 121) });
  let st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW });
  assert.equal(st.components[0].state, 'Stale');
  assert.equal(st.components[0].stale, true);
  assert.equal(st.alerts.length, 1);
  assert.equal(st.alerts[0].severity, 'Warning');
  assert.equal(st.alerts[0].component, 'Heartbeat:AppSheetBridge');
  assert.match(st.alerts[0].detail, /121 min/);
  /* A recent failure while the last success is still fresh stays a Warning. */
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'B', outcome: 'FAILED', error_code: 'LOCK_BUSY', now: minutesBefore(STAFFED_NOW, 1) });
  st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW });
  assert.equal(st.components[0].state, 'Failing');
  assert.equal(st.components[0].error_code, 'LOCK_BUSY');
  assert.equal(st.alerts[0].severity, 'Critical', 'failing with no success inside threshold is Critical');
  /* Failing but the last success is within threshold → Warning. */
  const s2 = makeStore();
  hb._s16RecordHeartbeat(s2, { component: 'Intake', command_id: 'A', now: minutesBefore(STAFFED_NOW, 10) });
  hb._s16RecordHeartbeat(s2, { component: 'Intake', command_id: 'B', outcome: 'FAILED', now: minutesBefore(STAFFED_NOW, 1) });
  const st2 = hb._s16HeartbeatStatus(s2, { now: STAFFED_NOW });
  assert.equal(st2.components[0].state, 'Failing');
  assert.equal(st2.alerts[0].severity, 'Warning');
  assert.equal(st2.critical_count, 0);
});

test('HB 06: outside the staffed window an aged component is Quiet and raises no alert', () => {
  for (const [now, reason] of [[WEEKEND_NOW, 'NOT_STAFFED_WEEKDAY'], [EVENING_NOW, 'OUTSIDE_OFFICE_HOURS']]) {
    const s = makeStore();
    hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A', now: minutesBefore(now, 600) });
    const st = hb._s16HeartbeatStatus(s, { now });
    assert.equal(st.staffed_window.staffed, false);
    assert.equal(st.staffed_window.reason, reason);
    assert.equal(st.components[0].state, 'Quiet');
    assert.equal(st.alert_count, 0);
  }
  /* Office-closed holiday on a weekday. */
  const s = makeStore();
  s.insert('Holidays', { id: 'HOL-1', local_date: '2026-09-16', description: 'Synthetic closure', office_closed: 'TRUE', created_at: STAFFED_NOW, created_by: 'test', commit_id: 'test' });
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A', now: minutesBefore(STAFFED_NOW, 600) });
  const st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW });
  assert.equal(st.staffed_window.reason, 'OFFICE_HOLIDAY');
  assert.equal(st.components[0].state, 'Quiet');
  /* A failure is still Failing off-hours, but only a Warning because it is not stale. */
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'B', outcome: 'FAILED', now: minutesBefore(STAFFED_NOW, 1) });
  const st2 = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW });
  assert.equal(st2.components[0].state, 'Failing');
  assert.equal(st2.alerts[0].severity, 'Warning');
});

test('HB 07: threshold comes from Settings or explicit input; invalid values refused or defaulted', () => {
  const s = makeStore();
  s.insert('Settings', { id: 'SET-hb', key: hb.S16_HEARTBEAT_STALE_SETTING, typed_value: '30', scope: 'Global', version: 1, effective_from: '2026-01-01', changed_by: 'test', reason: null, created_at: STAFFED_NOW, commit_id: 'test' });
  hb._s16RecordHeartbeat(s, { component: 'Intake', command_id: 'A', now: minutesBefore(STAFFED_NOW, 45) });
  let st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW });
  assert.equal(st.stale_minutes, 30);
  assert.equal(st.components[0].state, 'Stale');
  st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW, stale_minutes: 60 });
  assert.equal(st.components[0].state, 'Fresh');
  s.insert('Settings', { id: 'SET-hb-2', key: hb.S16_HEARTBEAT_STALE_SETTING, typed_value: 'garbage', scope: 'Global', version: 2, effective_from: '2026-01-01', changed_by: 'test', reason: null, created_at: STAFFED_NOW, commit_id: 'test' });
  assert.equal(hb._s16HeartbeatStatus(s, { now: STAFFED_NOW }).stale_minutes, 120, 'latest invalid setting falls back to default');
  assert.throws(() => hb._s16HeartbeatStatus(s, { now: STAFFED_NOW, stale_minutes: 0 }), /S16_REVIEW/);
  assert.throws(() => hb._s16HeartbeatStatus(s, { now: STAFFED_NOW, stale_minutes: 'abc' }), /S16_REVIEW/);
});

test('HB 08: expected components without any heartbeat are Never; alerted only in the staffed window', () => {
  const s = makeStore();
  let st = hb._s16HeartbeatStatus(s, { now: STAFFED_NOW, expected: ['AppSheetBridge', 'Intake'] });
  assert.deepEqual(st.components.map(c => c.component), ['AppSheetBridge', 'Intake']);
  assert.ok(st.components.every(c => c.state === 'Never' && c.checks === 0 && c.last_success_at === null));
  assert.equal(st.alert_count, 2);
  st = hb._s16HeartbeatStatus(s, { now: WEEKEND_NOW, expected: ['AppSheetBridge'] });
  assert.equal(st.components[0].state, 'Never');
  assert.equal(st.alert_count, 0);
  assert.throws(() => hb._s16HeartbeatStatus(s, { now: STAFFED_NOW, expected: ['bad name!'] }), /S16_REVIEW/);
  /* Status is read-only. */
  const before = copy(s.tables);
  hb._s16HeartbeatStatus(s, { now: STAFFED_NOW, expected: ['X'] });
  assert.deepEqual(s.tables, before);
});

test('HB 09: health status surfaces heartbeat alerts and summary', () => {
  const s = makeStore();
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A', now: minutesBefore(new Date().toISOString(), 5) });
  let h = core._s16HealthStatus(s);
  assert.equal(h.heartbeats.components.length, 1);
  assert.equal(h.heartbeats.summary.fresh, 1);
  assert.equal(h.summary.heartbeat_components, 1);
  assert.equal(h.summary.heartbeat_alerts, 0);
  assert.ok(!h.warnings.some(w => /^Heartbeat:/.test(w.component)));
  /* A failing component is a Warning while a success is still within threshold → Degraded at worst. */
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'B', outcome: 'FAILED', error_code: 'BOOM' });
  h = core._s16HealthStatus(s);
  assert.ok(h.warnings.some(w => w.component === 'Heartbeat:AppSheetBridge' && w.state === 'Failing'));
  assert.equal(h.overall, 'Degraded');
  assert.equal(h.summary.heartbeat_alerts, 1);
  /* A component that has only ever failed → Critical when the office is staffed, Warning otherwise. */
  hb._s16RecordHeartbeat(s, { component: 'Outbox', command_id: 'F', outcome: 'FAILED', error_code: 'DEAD' });
  h = core._s16HealthStatus(s);
  const staffedNow = hb._s16HbStaffedWindow(s, new Date().toISOString()).staffed;
  if (staffedNow) {
    assert.equal(h.overall, 'Critical');
    assert.ok(h.issues.some(i => i.component === 'Heartbeat:Outbox'));
  } else {
    assert.equal(h.overall, 'Degraded');
    assert.ok(h.warnings.some(w => w.component === 'Heartbeat:Outbox'));
  }
});

test('HB 10: fail-safe wrapper records OK on success and FAILED on throw without masking either', () => {
  const s = makeStore();
  const ok = hb._s16WithHeartbeat(s, { component: 'Intake', command_id: 'W1', now: STAFFED_NOW }, () => ({ done: 42 }));
  assert.deepEqual(ok.result, { done: 42 });
  assert.equal(ok.heartbeat.created, true);
  assert.equal(ok.heartbeat.outcome, 'OK');
  assert.equal(ok.heartbeat_error, null);
  const err = assert.throws(() => hb._s16WithHeartbeat(s, { component: 'Intake', command_id: 'W2', now: STAFFED_NOW }, () => { throw new Error('processing exploded'); }), /processing exploded/);
  const failedRow = s.tables.HealthChecks.find(r => r.id === 'HB-Intake-W2');
  assert.equal(failedRow.outcome, 'FAILED');
  assert.equal(failedRow.error_code, 'processing exploded');
  assert.equal(failedRow.last_success, STAFFED_NOW);
  /* Heartbeat refusal (modes disabled) never hides the processing result. */
  core._s16SetModes(s, false);
  const r = hb._s16WithHeartbeat(s, { component: 'Intake', command_id: 'W3' }, () => 'still-ran');
  assert.equal(r.result, 'still-ran');
  assert.equal(r.heartbeat, null);
  assert.match(r.heartbeat_error, /pilot mode/);
  assert.throws(() => hb._s16WithHeartbeat(s, { component: 'Intake', command_id: 'W4' }, null), /S16_REVIEW/);
});

test('HB 11: hourly tick is idempotent within the hour and distinct across hours', () => {
  const s = makeStore();
  const a = hb._s16HeartbeatTick(s, { now: '2026-09-16T10:05:00.000Z' });
  const b = hb._s16HeartbeatTick(s, { now: '2026-09-16T10:55:00.000Z' });
  const c = hb._s16HeartbeatTick(s, { now: '2026-09-16T11:00:00.000Z' });
  assert.equal(a.created, true);
  assert.equal(a.component, 'HealthMonitor');
  assert.equal(a.heartbeat_id, 'HB-HealthMonitor-TICK-2026-09-16T10');
  assert.equal(b.replay, true);
  assert.equal(c.created, true);
  assert.equal(rows(s).length, 2);
  const d = hb._s16HeartbeatTick(s, { now: '2026-09-16T11:30:00.000Z', component: 'Custom' });
  assert.equal(d.component, 'Custom');
});

test('HB 12: refusals — disabled modes, wrong sheet/environment, bad inputs — leave no writes', () => {
  const s = makeStore();
  core._s16SetModes(s, false);
  let before = copy(s.tables);
  assert.throws(() => hb._s16RecordHeartbeat(s, { component: 'X', command_id: 'Y' }), /pilot mode/);
  assert.throws(() => hb._s16HeartbeatStatus(s, {}), /pilot mode/);
  assert.deepEqual(s.tables, before);
  for (const alter of [x => { x.getSheetId = () => 'wrong'; }, x => { x.getEnvironment = () => 'PROD'; }]) {
    const s2 = makeStore();
    alter(s2);
    before = copy(s2.tables);
    assert.throws(() => hb._s16RecordHeartbeat(s2, { component: 'X', command_id: 'Y' }), /S16_REFUSED/);
    assert.deepEqual(s2.tables, before);
  }
  const s3 = makeStore();
  before = copy(s3.tables);
  assert.throws(() => hb._s16RecordHeartbeat(s3, { component: '', command_id: 'Y' }), /component required/);
  assert.throws(() => hb._s16RecordHeartbeat(s3, { component: 'has space', command_id: 'Y' }), /S16_REVIEW/);
  assert.throws(() => hb._s16RecordHeartbeat(s3, { component: 'X', command_id: '' }), /command_id required/);
  assert.throws(() => hb._s16RecordHeartbeat(s3, { component: 'X', command_id: 'Y', outcome: 'not a code!' }), /S16_REVIEW/);
  assert.throws(() => hb._s16RecordHeartbeat(s3, { component: 'X', command_id: 'Y', now: 'yesterday' }), /S16_REVIEW|S16_DATE_INVALID/);
  assert.throws(() => hb._s16RecordHeartbeat(s3, null), /S16_REVIEW/);
  assert.deepEqual(s3.tables, before);
  /* An existing non-heartbeat row with the same id is a refused collision. */
  s3.insert('HealthChecks', { id: 'HB-X-Y', integration: 'S16-system', checked_at: STAFFED_NOW, outcome: 'Healthy', last_success: null, error_code: null, next_action_task_id: null, created_at: STAFFED_NOW, commit_id: 'x' });
  assert.throws(() => hb._s16RecordHeartbeat(s3, { component: 'X', command_id: 'Y' }), /collision/);
});

test('HB 13: Sheet Date values on checked_at / last_success are tolerated', () => {
  const s = makeStore();
  hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A', now: minutesBefore(STAFFED_NOW, 10) });
  for (const r of s.tables.HealthChecks) { r.checked_at = new Date(r.checked_at); if (r.last_success) r.last_success = new Date(r.last_success); }
  const st = hb._s16HeartbeatStatus(s, { now: new Date(STAFFED_NOW) });
  assert.equal(st.components[0].state, 'Fresh');
  assert.equal(st.components[0].last_success_at, minutesBefore(STAFFED_NOW, 10));
  const again = hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'B', outcome: 'FAILED', now: STAFFED_NOW });
  assert.equal(again.last_success, minutesBefore(STAFFED_NOW, 10));
  const replay = hb._s16RecordHeartbeat(s, { component: 'AppSheetBridge', command_id: 'A' });
  assert.equal(replay.replay, true);
  assert.equal(replay.checked_at, minutesBefore(STAFFED_NOW, 10));
});

test('HB 14: London local parts handle BST/GMT and the staffed window boundaries', () => {
  assert.deepEqual(hb._s16HbLocalParts('2026-07-01T08:30:00.000Z'), { date: '2026-07-01', time: '09:30', weekday: 3 });
  assert.deepEqual(hb._s16HbLocalParts('2026-01-05T08:30:00.000Z'), { date: '2026-01-05', time: '08:30', weekday: 1 });
  assert.deepEqual(hb._s16HbLocalParts('2026-01-05T23:30:00.000Z'), { date: '2026-01-05', time: '23:30', weekday: 1 });
  const s = makeStore();
  assert.equal(hb._s16HbStaffedWindow(s, '2026-09-16T08:00:00.000Z').staffed, true, '09:00 London start inclusive');
  assert.equal(hb._s16HbStaffedWindow(s, '2026-09-16T07:59:00.000Z').staffed, false);
  assert.equal(hb._s16HbStaffedWindow(s, '2026-09-16T16:00:00.000Z').staffed, false, '17:00 London end exclusive');
  assert.equal(hb._s16HbStaffedWindow(s, '2026-09-16T15:59:00.000Z').staffed, true);
});

test('HB 15: bundle contains heartbeat functions, all S16-namespaced, no external APIs', () => {
  const bundle = fs.readFileSync('apps-script/s16/S16Health.js', 'utf8');
  const src = fs.readFileSync('s16/heartbeat.js', 'utf8');
  for (const name of ['_s16RecordHeartbeat', '_s16HeartbeatStatus', '_s16WithHeartbeat', '_s16HeartbeatTick', 'runS16HeartbeatStatus', 'runS16RecordHeartbeat', 'runS16HeartbeatTick', 'runS16HeartbeatSmoke'])
    assert.match(bundle, new RegExp('function ' + name + '\\('));
  for (const m of src.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:S16_|_s16)/);
  assert.doesNotMatch(src, /CalendarApp|UrlFetchApp|DriveApp|GmailApp|MailApp|fetch\(|https:\/\//);
  assert.ok(bundle.indexOf('function _s16RecordHeartbeat') > bundle.indexOf('function _s16HealthStatus'), 'build order: health then heartbeat');
  new vm.Script(bundle);
});

test('HB 16: zero-arg DEV cloud smoke, tick and status run against the header adapter', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/s16/S16Health.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.S16_HEADERS)) grids[n] = [Array.from(h)];
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(grids.ReleaseModes[0].map(k => r[k] ?? (k === 'version' ? 1 : '')));
  let busy = false;
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); },
        setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); }
      };
    }
  }));
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => core.S16_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });

  assert.equal(ctx.restoreS16SafeState().pass, true);
  /* Disabled modes: writes refused, nothing recorded. */
  const refused = ctx.runS16RecordHeartbeat('AppSheetBridge', 'CMD-1', 'OK', null);
  assert.equal(refused.pass, false);
  assert.match(refused.detail, /pilot mode/);
  assert.equal(grids.HealthChecks.length, 1);

  const smoke = ctx.runS16HeartbeatSmoke();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.equal(smoke.detail.replay, true);
  assert.equal(smoke.detail.fresh_state, 'Fresh');
  assert.equal(smoke.detail.failing_state, 'Failing');
  assert.equal(smoke.detail.surfaced_in_health, true);
  assert.equal(smoke.detail.recovered_state, 'Fresh');
  assert.equal(smoke.detail.external_calls, 0);
  /* Smoke restored modes: status refuses until enabled. */
  assert.equal(ctx.runS16HeartbeatStatus().pass, false);
  assert.equal(ctx.runS16EnableFunctionsForSyntheticTest().pass, true);
  const tick1 = ctx.runS16HeartbeatTick(), tick2 = ctx.runS16HeartbeatTick();
  assert.equal(tick1.pass, true);
  assert.equal(tick1.detail.created, true);
  assert.equal(tick2.detail.replay, true);
  const status = ctx.runS16HeartbeatStatus();
  assert.equal(status.pass, true);
  assert.equal(JSON.stringify(status.detail.components.map(c => c.component)), JSON.stringify(['HealthMonitor', 'S16Smoke']));
  assert.ok(status.detail.components.every(c => c.state === 'Fresh'));
  /* The smoke's FAILED row was followed by a recovery row, so health no longer alerts on it. */
  const health = ctx._s16HealthStatus(ctx._s16CloudStore());
  assert.ok(!health.warnings.concat(health.issues).some(w => /^Heartbeat:/.test(w.component)), JSON.stringify(health.warnings));
  assert.equal(health.heartbeats.components.length, 2);
  assert.equal(health.summary.heartbeat_alerts, 0);
  /* Reset removes smoke heartbeat rows but keeps the HealthMonitor tick. */
  const reset = ctx.runS16ResetFixture();
  assert.equal(reset.pass, true);
  const idx = grids.HealthChecks[0].indexOf('integration');
  const remaining = grids.HealthChecks.slice(1).map(r => r[idx]).filter(Boolean);
  assert.ok(remaining.every(i => i !== 'Processing:S16Smoke' && i !== 'S16-system'));
  assert.ok(remaining.includes('Processing:HealthMonitor'));
  assert.equal(ctx.restoreS16SafeState().pass, true);
});
