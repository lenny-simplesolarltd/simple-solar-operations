/* Regression: the generated standalone AppSheetBridge must support PLANNER_3_WEEKS / PLANNER_6_WEEKS exactly like the bound R1
 * adapter. Root cause fixed: both builds now take their read delegates from one shared _r1aDefaultReads(). */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const adapter = require('../r1-appsheet/adapter.js'), planner = require('../s11/planner.js');
const T0 = '2026-11-01T12:00:00.000Z', DEV = adapter.R1A_BOUND_DEV_SHEET_ID;

test('BRIDGE 01: shared reads builder exposes every delegate incl. planner; planner fails closed without S11 and delegates with it', () => {
  const reads = adapter._r1aDefaultReads();
  assert.deepEqual(Object.keys(reads).sort(), ['actionAvailability', 'auditHistory', 'jobOverview', 'jobSearch', 'officeHome', 'operationalQueue', 'planner', 'releaseModes', 'systemStatus', 'taskActionAvailability']);
  assert.throws(() => reads.planner({}, '2026-11-09', 3), /R1A_READ_UNSUPPORTED/, 'no _s11BuildPlanner global in this process');
  assert.throws(() => reads.officeHome({}), /R1A_READ_UNSUPPORTED/);
  globalThis._s11BuildPlanner = (s, start, weeks) => ({ from: start, weeks, rows: [], scaffold: [] });
  try {
    assert.deepEqual(reads.planner({}, '2026-11-09', 6), { from: '2026-11-09', weeks: 6, rows: [], scaffold: [] });
    assert.equal(reads.planner({}, null, 3).from, new Date().toISOString().slice(0, 10), 'defaults to today when as_of is absent');
  } finally { delete globalThis._s11BuildPlanner; }
});

test('BRIDGE 02: bound cloud adapter and standalone generator both use the shared builder; no divergent inline reads literal remains', () => {
  const bound = fs.readFileSync('r1-appsheet/cloud-adapter.js', 'utf8'), gen = fs.readFileSync('scripts/build-standalone-bridge.cjs', 'utf8');
  assert.match(bound, /reads:_r1aDefaultReads\(\)/);
  assert.match(gen, /reads:_r1aDefaultReads\(\)/);
  assert.doesNotMatch(bound, /reads:\{officeHome/);
  assert.doesNotMatch(gen, /reads:\{officeHome/);
  for (const f of ['standalone-bridge/AppSheetBridge.js', 'apps-script/r1-appsheet/R1AppSheetAdapter.js']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /function _r1aDefaultReads\(/, f + ' must carry the shared builder');
    assert.match(src, /reads:_r1aDefaultReads\(\)/, f);
  }
  assert.match(fs.readFileSync('standalone-bridge/AppSheetBridge.js', 'utf8'), /function _s11BuildPlanner\(/);
});

function loadStandalone(email) {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error, globalThis: undefined });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync('standalone-bridge/AppSheetBridge.js', 'utf8'), ctx);
  const grids = {};
  for (const [n, h] of Object.entries(ctx.S17_HEADERS)) grids[n] = [Array.from(h)];
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(rowOf('ReleaseModes', { ...r, version: 1, ...(r.function_id === 'FN-01' ? { mode: 'Automated', authorised_job_scope: 'Pilot' } : {}) }));
  for (const r of seed.Settings) grids.Settings.push(rowOf('Settings', { ...r, created_at: T0, commit_id: 'seed' }));
  for (const r of seed.People) grids.People.push(rowOf('People', { ...r, ...meta, source_system: 'seed', email: r.id === 'PERSON-tanya' ? 'tanya@dev.example.invalid' : r.id === 'PERSON-installer-a' ? 'roofer@dev.example.invalid' : r.email }));
  for (const r of seed.PersonRoles) grids.PersonRoles.push(rowOf('PersonRoles', { ...r, ...meta, source_system: 'seed' }));
  grids.PersonRoles.push(rowOf('PersonRoles', { id: 'PROLE-roofer', person_id: 'PERSON-installer-a', role: 'Installer', active: true, ...meta, source_system: 'seed' }));
  grids.Jobs.push(rowOf('Jobs', { id: 'J-p', job_id: 'SS-PLAN-0001', customer_id: 'C', display_name: 'Planner Job', workflow_stage: 'Booked', pilot_job: true, release_scope: 'R1', ...meta, source_system: 'S05' }));
  grids.WorkPackages.push(rowOf('WorkPackages', { id: 'WP-p', job_id: 'J-p', trade: 'Roof', required: true, planned_start: '2026-11-11', planned_end: '2026-11-13', status: 'Scheduled', commissioning_required: true, sequence: 1, revision: 1, ...meta, source_system: 'S11' }));
  grids.Allocations.push(rowOf('Allocations', { id: 'A-p', work_package_id: 'WP-p', person_id: 'PERSON-installer-a', role: 'Lead', start_at: '2026-11-11', end_at: '2026-11-13', active: true, ...meta, source_system: 'S11' }));
  grids.ScaffoldBookings.push(rowOf('ScaffoldBookings', { id: 'SB-p', job_id: 'J-p', company_id: 'COMP-scaffold-dev', erect_planned_at: '2026-11-10', status: 'Requested', revision: 1, ...meta, source_system: 'S09' }));
  const mkSheet = n => ({ getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 5000, getRange(row, col, height = 1, width = 1) { return { getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); }, setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = v; })); return this; } }; } });
  ctx.SpreadsheetApp = { openById(id) { assert.equal(id, DEV); return { getId: () => DEV, getSheets: () => Object.keys(grids).map(mkSheet) }; }, flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV', sheetId: DEV }) }) };
  ctx.LockService = { getScriptLock: () => ({ waitLock() { }, tryLock() { return true; }, releaseLock() { } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => 'owner@dev.example.invalid' }) };
  ctx.Utilities = { formatDate: d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  return { ctx, grids };
}

test('BRIDGE 03: generated standalone bridge answers PLANNER_3_WEEKS and PLANNER_6_WEEKS for an Office user, matching S11 directly', () => {
  const { ctx } = loadStandalone('tanya@dev.example.invalid');
  const r3 = JSON.parse(ctx.appSheetR1Read(JSON.stringify({ read_type: 'PLANNER_3_WEEKS', as_of: '2026-11-09' })));
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.equal(r3.read_type, 'PLANNER_3_WEEKS');
  assert.equal(r3.actor_id, 'PERSON-tanya');
  assert.equal(r3.data.weeks, 3);
  assert.equal(r3.data.from, '2026-11-09');
  assert.equal(r3.data.to, '2026-11-29');
  assert.deepEqual(r3.data.rows.map(x => [x.allocation_id, x.person_id, x.trade, x.start_at, x.end_at]), [['A-p', 'PERSON-installer-a', 'Roof', '2026-11-11', '2026-11-13']]);
  assert.deepEqual(r3.data.scaffold.map(x => [x.kind, x.date, x.acknowledged]), [['Erect', '2026-11-10', false]]);
  const r6 = JSON.parse(ctx.appSheetR1Read(JSON.stringify({ read_type: 'PLANNER_6_WEEKS', as_of: '2026-11-09' })));
  assert.equal(r6.ok, true, JSON.stringify(r6));
  assert.equal(r6.data.weeks, 6);
  assert.equal(r6.data.to, '2026-12-20');
  assert.equal(r6.data.rows.length, 1);
  /* Parity with the S11 source against an equivalent in-memory store. */
  const mem = { tables: {} };
  for (const n of ['WorkPackages', 'Allocations', 'ScaffoldBookings', 'Companies']) mem.tables[n] = [];
  mem.tables.WorkPackages.push({ id: 'WP-p', job_id: 'J-p', trade: 'Roof', planned_start: '2026-11-11', planned_end: '2026-11-13', status: 'Scheduled', revision: 1 });
  mem.tables.Allocations.push({ id: 'A-p', work_package_id: 'WP-p', person_id: 'PERSON-installer-a', role: 'Lead', start_at: '2026-11-11', end_at: '2026-11-13', active: true });
  mem.tables.ScaffoldBookings.push({ id: 'SB-p', job_id: 'J-p', company_id: 'COMP-scaffold-dev', erect_planned_at: '2026-11-10', status: 'Requested', revision: 1, confirmed_revision: null });
  const store = { list: n => JSON.parse(JSON.stringify(mem.tables[n] || [])), get: (n, id) => (mem.tables[n] || []).find(r => r.id === id) || null };
  const direct = planner.buildPlanner(store, '2026-11-09', 3);
  assert.deepEqual(JSON.parse(JSON.stringify(r3.data.rows)), direct.rows);
  assert.deepEqual(JSON.parse(JSON.stringify(r3.data.scaffold)).map(x => x.kind + x.date), direct.scaffold.map(x => x.kind + x.date));
  /* Default as_of → today; no error path. */
  const today = JSON.parse(ctx.appSheetR1Read(JSON.stringify({ read_type: 'PLANNER_3_WEEKS' })));
  assert.equal(today.ok, true, JSON.stringify(today));
  assert.equal(today.data.from, new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
});

test('BRIDGE 04: planner reads keep the bound adapter\'s authorisation — installers are refused, unknown users refused, other reads unaffected', () => {
  const installer = loadStandalone('roofer@dev.example.invalid');
  const denied = JSON.parse(installer.ctx.appSheetR1Read(JSON.stringify({ read_type: 'PLANNER_3_WEEKS', as_of: '2026-11-09' })));
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'R1A_ROLE_DENIED');
  const unknown = loadStandalone('nobody@dev.example.invalid');
  assert.equal(JSON.parse(unknown.ctx.appSheetR1Read(JSON.stringify({ read_type: 'PLANNER_6_WEEKS' }))).error, 'R1A_UNKNOWN_OR_DUPLICATE_ACTOR');
  const office = loadStandalone('tanya@dev.example.invalid');
  const home = JSON.parse(office.ctx.appSheetR1Read(JSON.stringify({ read_type: 'OFFICE_HOME' })));
  assert.equal(home.ok, true, JSON.stringify(home));
  const modes = JSON.parse(office.ctx.appSheetR1Read(JSON.stringify({ read_type: 'RELEASE_MODE_STATUS' })));
  assert.equal(modes.error, 'R1A_ROLE_DENIED', 'management-only read stays Admin/Manager, unchanged by the planner fix');
  const search = JSON.parse(office.ctx.appSheetR1Read(JSON.stringify({ read_type: 'JOB_SEARCH', query: 'Planner' })));
  assert.equal(search.ok, true, JSON.stringify(search));
  assert.equal(JSON.parse(office.ctx.appSheetR1Read(JSON.stringify({ read_type: 'PLANNER_9_WEEKS' }))).ok, false, 'unknown read types still refused');
});
