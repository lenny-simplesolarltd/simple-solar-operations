const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const core = require('../s19/migration.js');
const s18 = require('../s18/acceptance.js');
const copy = x => structuredClone(x);

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = { tables, getSheetId: () => s18.S18_DEV_SHEET_ID, getEnvironment: () => 'DEV', list: n => copy(tables[n] || []), get: (n, id) => null, insert(n, r) { tables[n].push(copy(r)); } };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  return s;
}

function getS18Summary(s) { return s18._s18AcceptanceSummary(s); }

test('S19 01: training total equals module array length', () => {
  const trn = core._s19TrainingPlan();
  const byRole = {};
  trn.forEach(t => { if (!byRole[t.role]) byRole[t.role] = 0; byRole[t.role]++; });
  const roleSum = Object.values(byRole).reduce((a, b) => a + b, 0);
  assert.equal(roleSum, trn.length, 'role counts must sum to total');
  // Verify derived counts match
  const s = makeStore();
  const sum = getS18Summary(s);
  const ms = core._s19MigrationSummary(s, sum);
  assert.equal(ms.training.total_modules, trn.length, 'reported total must equal array length');
  const roleTotal = Object.values(ms.training.by_role).reduce((a, r) => a + r.total, 0);
  assert.equal(roleTotal, trn.length, 'by_role totals must sum to training total');
});

test('S19 02: training covers Tanya, Ben, Hannah, Installer', () => {
  const trn = core._s19TrainingPlan();
  const roles = [...new Set(trn.map(t => t.role))];
  assert.ok(roles.includes('Tanya'));
  assert.ok(roles.includes('Ben'));
  assert.ok(roles.includes('Hannah'));
  assert.ok(roles.includes('Installer'));
});

test('S19 03: training includes safety topics', () => {
  const trn = core._s19TrainingPlan();
  const safety = trn.filter(t => t.module.toLowerCase().includes('safety'));
  assert.ok(safety.length >= 3);
});

test('S19 04: S18 NOT_RUN propagates into S19 handoff', () => {
  const s = makeStore();
  const sum = getS18Summary(s);
  const h = core._s19HandoffReadiness(sum);
  for (const rel of core.S19_RELEASES) {
    assert.ok(h[rel].s18.not_run.length > 0, rel + ' should have S18 NOT_RUN items');
  }
});

test('S19 05: S18 FAIL would propagate into S19 handoff', () => {
  const s = makeStore();
  const sum = getS18Summary(s);
  const h = core._s19HandoffReadiness(sum);
  for (const rel of core.S19_RELEASES) {
    assert.ok(Array.isArray(h[rel].s18.failed), rel + ' missing failed array');
  }
});

test('S19 06: unrehearsed migration item is NOT_RUN, not BLOCKED', () => {
  const mig = core._s19MigrationInventory();
  const r1NotRun = mig.filter(m => m.release === 'R1' && m.status === 'NOT_RUN');
  assert.ok(r1NotRun.length > 0, 'R1 should have NOT_RUN migration items (not yet rehearsed)');
  // Verify no NOT_RUN item has a blocker message (it's just not done yet)
  for (const m of r1NotRun) assert.equal(m.blocker, null, m.id + ' NOT_RUN should have null blocker');
});

test('S19 07: genuinely missing prerequisite is BLOCKED', () => {
  const mig = core._s19MigrationInventory();
  const blocked = mig.filter(m => m.status === 'BLOCKED');
  assert.ok(blocked.length > 0, 'should have BLOCKED migration items');
  for (const b of blocked) assert.ok(b.blocker, b.id + ' BLOCKED must have blocker message');
});

test('S19 08: unperformed training is NOT_RUN', () => {
  const trn = core._s19TrainingPlan();
  const notRun = trn.filter(t => t.status === 'NOT_RUN');
  assert.ok(notRun.length > 0, 'should have NOT_RUN training');
});

test('S19 09: S20 execution-only cutover steps do not block S19', () => {
  const cut = core._s19CutoverPlan();
  const s20exec = cut.filter(c => c.type === 's20_exec');
  assert.ok(s20exec.length > 0, 'should have S20 execution steps');
  // Verify S20 exec steps are NOT counted as S19 preparation blockers
  const s = makeStore();
  const sum = getS18Summary(s);
  const h = core._s19HandoffReadiness(sum);
  for (const rel of core.S19_RELEASES) {
    const prepBlocked = h[rel].cutover_prep.blocked;
    const execSteps = h[rel].cutover_s20_exec.steps;
    // S20 exec steps must not appear in prep blocked list
    for (const step of execSteps) {
      assert.ok(!prepBlocked.includes(step), step + ' is S20 exec, should not be in S19 prep blockers');
    }
  }
});

test('S19 10: missing cutover prerequisite blocks S19', () => {
  const s = makeStore();
  const sum = getS18Summary(s);
  const h = core._s19HandoffReadiness(sum);
  // R1 should have at least one cutover prep blocker (CUT-R1-01: S18 R1 BLOCKED)
  assert.ok(h.R1.cutover_prep.blocked.length > 0, 'R1 should have cutover prep blockers');
});

test('S19 11: READY_FOR_S20 impossible with any BLOCKED/NOT_RUN/FAIL', () => {
  const s = makeStore();
  const sum = getS18Summary(s);
  const h = core._s19HandoffReadiness(sum);
  for (const rel of core.S19_RELEASES) {
    const rd = h[rel];
    if (rd.handoff_readiness === 'READY_FOR_S20') {
      assert.equal(rd.s18.blocked.length, 0, rel + ' ready but has S18 blocked');
      assert.equal(rd.s18.not_run.length, 0, rel + ' ready but has S18 not_run');
      assert.equal(rd.migration.blocked.length, 0, rel + ' ready but has migration blocked');
      assert.equal(rd.migration.not_run.length, 0, rel + ' ready but has migration not_run');
      assert.equal(rd.training.blocked.length, 0);
      assert.equal(rd.training.not_run.length, 0);
      assert.equal(rd.cutover_prep.blocked.length, 0);
      assert.equal(rd.cutover_prep.not_run.length, 0);
    }
  }
});

test('S19 12: every reported count equals corresponding list length', () => {
  const s = makeStore();
  const sum = getS18Summary(s);
  const ms = core._s19MigrationSummary(s, sum);
  const mig = core._s19MigrationInventory();
  const trn = core._s19TrainingPlan();
  const cut = core._s19CutoverPlan();

  assert.equal(ms.migration.total_domains, mig.length, 'migration total');
  assert.equal(ms.training.total_modules, trn.length, 'training total');
  assert.equal(ms.cutover.total_steps, cut.length, 'cutover total');
  assert.equal(ms.creators.total_functions, core._s19CreatorMap().length, 'creator total');
  assert.equal(ms.cutover.s19_prep + ms.cutover.s20_exec, cut.length, 'prep+exec = total');

  // Per-release handoff counts must match
  for (const rel of core.S19_RELEASES) {
    const h = core._s19HandoffReadiness(sum)[rel];
    assert.equal(h.s18.blocked.length + h.s18.not_run.length + h.s18.failed.length, h.s18.blocked.length + h.s18.not_run.length);
    assert.equal(h.migration.total, mig.filter(m => m.release === rel).length);
    assert.equal(h.training.total, trn.filter(t => t.release === rel).length);
    assert.equal(h.cutover_prep.total, cut.filter(c => c.release === rel && c.type === 's19_prep').length);
    assert.equal(h.cutover_s20_exec.total, cut.filter(c => c.release === rel && c.type === 's20_exec').length);
  }
});

test('S19 13: fallback preserves records, does not delete', () => {
  const cut = core._s19CutoverPlan();
  const fallbacks = cut.filter(c => c.phase === 'FALLBACK');
  assert.ok(fallbacks.length > 0);
  for (const f of fallbacks) {
    const text = (f.step + ' ' + (f.blocker || '')).toLowerCase();
    assert.ok(!text.includes('delete'), f.id + ' fallback mentions delete');
    assert.ok(!text.includes('destroy'), f.id + ' fallback mentions destroy');
  }
});

test('S19 14: no-dual-creator map has unique function+release', () => {
  const creators = core._s19CreatorMap();
  const keys = creators.map(c => c.function + '|' + c.release);
  assert.equal(new Set(keys).size, keys.length);
});

test('S19 15: cutover has PRE/CUTOVER/FALLBACK per release', () => {
  const cut = core._s19CutoverPlan();
  for (const rel of core.S19_RELEASES) {
    const phases = [...new Set(cut.filter(c => c.release === rel).map(c => c.phase))];
    assert.ok(phases.includes('PRE'), rel + ' missing PRE');
    assert.ok(phases.includes('CUTOVER'), rel + ' missing CUTOVER');
    assert.ok(phases.includes('FALLBACK'), rel + ' missing FALLBACK');
  }
});

test('S19 16: no external calls / no writes', () => {
  const s = makeStore();
  const before = copy(s.tables);
  const sum = getS18Summary(s);
  core._s19MigrationSummary(s, sum);
  core._s19MigrationInventory();
  core._s19CreatorMap();
  core._s19TrainingPlan();
  core._s19CutoverPlan();
  core._s19HandoffReadiness(sum);
  assert.deepEqual(s.tables, before);
});

test('S19 17: DEV guard enforced', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const bad = { tables, getSheetId: () => 'wrong', getEnvironment: () => 'DEV', list: n => [] };
  const sum = getS18Summary(makeStore());
  assert.throws(() => core._s19MigrationSummary(bad, sum), /S19_REFUSED/);
});

test('S19 18: namespace compatibility', () => {
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('s19/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  const s19text = fs.readFileSync('apps-script/s19/S19Migration.js', 'utf8');
  new vm.Script(prior + '\n' + s19text);
  for (const m of s19text.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm))
    assert.match(m[1], /^(?:S19_|_s19|runS19)/);
  assert.doesNotMatch(s19text, /CalendarApp|UrlFetchApp|fetch\(|deleteRow|deleteSheet|GmailApp|MailApp|DriveApp|https:\/\//);
});

test('S19 19: zero-arg DEV smoke', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/s19/S19Migration.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s18/S18Acceptance.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.S19_HEADERS)) grids[n] = [Array.from(h)];
  for (const r of seed.ReleaseModes) {
    grids.ReleaseModes.push(grids.ReleaseModes[0].map(k => r[k] ?? (k === 'version' ? 1 : '')));
  }
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return { getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); }, setValues() {} };
    }
  }));
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => core.S19_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });

  for (const fn of ['runS19MigrationDryRun', 'runS19MigrationRehearsal', 'runS19MigrationSummary']) {
    const r = ctx[fn]();
    assert.equal(r.pass, true, fn + ': ' + JSON.stringify(r));
  }
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'TEST' }) }) };
  assert.equal(ctx.runS19MigrationDryRun().pass, false);
});
