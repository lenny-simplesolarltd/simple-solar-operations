const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const core = require('../s18/acceptance.js');
const copy = x => structuredClone(x);

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables,
    getSheetId: () => core.S18_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  return s;
}

function getSummary(s) { return core._s18AcceptanceSummary(s); }

test('S18 01: acceptance run returns items with valid statuses and fields', () => {
  const s = makeStore();
  const r = core._s18RunAcceptance(s);
  assert.ok(r.total_checks > 0);
  assert.equal(r.total_checks, r.items.length, 'total_checks must equal items.length');
  for (const item of r.items) {
    assert.ok(core.S18_STATUSES.includes(item.status), 'invalid status: ' + item.status);
    assert.ok(item.acceptance_id);
    assert.ok(item.required_for_release);
  }
});

test('S18 02: BLOCKED items have blocker messages', () => {
  const s = makeStore();
  const r = core._s18RunAcceptance(s);
  const blocked = r.items.filter(i => i.status === 'BLOCKED');
  assert.ok(blocked.length > 0, 'should have BLOCKED items');
  for (const b of blocked) assert.ok(b.blocker, b.acceptance_id + ' BLOCKED without blocker');
});

test('S18 03: combined readiness — all releases BLOCKED/NOT_EVALUATED', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    assert.notEqual(sum.readiness[rel].readiness, 'READY_FOR_CONTROLLED_PILOT', rel + ' should not be ready');
  }
});

test('S18 04: combined readiness has automated + manual breakdowns', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    assert.ok(rd.automated, rel + ' missing automated');
    assert.ok(rd.manual, rel + ' missing manual');
    assert.ok(rd.total_items > 0);
  }
});

test('S18 05: BLOCKED items prevent readiness', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    if (rd.blocked > 0) assert.notEqual(rd.readiness, 'READY_FOR_CONTROLLED_PILOT');
  }
});

test('S18 06: NOT_RUN items prevent readiness', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    if (rd.not_run > 0) assert.notEqual(rd.readiness, 'READY_FOR_CONTROLLED_PILOT');
  }
});

test('S18 07: FAIL status prevents readiness', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    if (rd.fail > 0) assert.notEqual(rd.readiness, 'READY_FOR_CONTROLLED_PILOT');
  }
});

test('S18 08: RA01 cumulative — R2/R3/R4 inherit unresolved R1 manual items', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of ['R2', 'R3', 'R4']) {
    assert.ok(sum.readiness[rel].inherited_items > 0, rel + ' should inherit unresolved R1 items');
  }
});

test('S18 09: inherited R1 BLOCKED manual items appear in R2 blockers', () => {
  const s = makeStore();
  const sum = getSummary(s);
  const r2Blockers = sum.readiness.R2.blockers.map(b => b.id);
  assert.ok(r2Blockers.includes('MAN-01'), 'R2 should inherit MAN-01 (AppSheet role visibility BLOCKED)');
  assert.ok(r2Blockers.includes('MAN-04'), 'R2 should inherit MAN-04 (staff accounts BLOCKED)');
});

test('S18 10: each release BLOCKED count equals blocker list length', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    assert.equal(rd.blocked, rd.blockers.length, rel + ' blocked=' + rd.blocked + ' blockers=' + rd.blockers.length);
  }
});

test('S18 11: release status counts sum to total_items', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    assert.equal(rd.pass + rd.blocked + rd.not_run + rd.fail, rd.total_items, rel + ' counts must sum');
  }
});

test('S18 12: automated total equals items length', () => {
  const s = makeStore();
  const r = core._s18RunAcceptance(s);
  assert.equal(r.total_checks, r.items.length);
  const pass = r.items.filter(i => i.status === 'PASS').length;
  const blocked = r.items.filter(i => i.status === 'BLOCKED').length;
  assert.equal(r.pass_count, pass);
  assert.equal(r.blocked_count, blocked);
  assert.equal(pass + blocked + r.not_run_count + r.fail_count, r.total_checks);
});

test('S18 13: manual total equals checklist length', () => {
  const manual = core._s18ManualChecklist();
  const s = makeStore();
  const sum = getSummary(s);
  assert.equal(sum.manual.total, manual.length);
});

test('S18 14: summary derived from matrix — no hardcoded duplicates', () => {
  const s = makeStore();
  const sum = getSummary(s);
  const auto = core._s18RunAcceptance(s);
  assert.equal(sum.automated.total, auto.total_checks);
  assert.equal(sum.automated.pass, auto.pass_count);
  assert.equal(sum.automated.blocked, auto.blocked_count);
  assert.equal(sum.manual.total, core._s18ManualChecklist().length);
});

test('S18 15: READY_FOR_CONTROLLED_PILOT requires zero BLOCKED/NOT_RUN/FAIL', () => {
  const s = makeStore();
  const sum = getSummary(s);
  for (const rel of core.S18_RELEASES) {
    const rd = sum.readiness[rel];
    if (rd.readiness === 'READY_FOR_CONTROLLED_PILOT') {
      assert.equal(rd.blocked, 0);
      assert.equal(rd.not_run, 0);
      assert.equal(rd.fail, 0);
    }
  }
});

test('S18 16: G01 remains NOT_RUN', () => {
  const s = makeStore();
  const r = core._s18RunAcceptance(s);
  const fnd01 = r.items.find(i => i.acceptance_id === 'FND-01');
  assert.equal(fnd01.status, 'NOT_RUN', 'G01 must be NOT_RUN');
});

test('S18 17: NOT_RUN does not become BLOCKED', () => {
  const s = makeStore();
  const r = core._s18RunAcceptance(s);
  for (const item of r.items.filter(i => i.status === 'NOT_RUN')) {
    assert.ok(item.blocker || item.notes, item.acceptance_id + ' NOT_RUN should explain why');
  }
});

test('S18 18: missing external config is BLOCKED', () => {
  const s = makeStore();
  const r = core._s18RunAcceptance(s);
  const ghl = r.items.find(i => i.acceptance_id === 'BLK-01');
  assert.equal(ghl.status, 'BLOCKED');
  assert.ok(ghl.blocker);
});

test('S18 19: BKP-05 PASS when compatible SYS01/SYS02 exist', () => {
  const s = makeStore();
  s.insert('TaskTemplates', { id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health', group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day', due_rule: '09:00', evidence_required: 'Last-success timestamps, failures assigned', active: true, template_version: '1.0', created_at: '2025-01-01T00:00:00Z', created_by: 'S02', updated_at: '2025-01-01T00:00:00Z', updated_by: 'S02', version: 1, commit_id: 'S02' });
  s.insert('TaskTemplates', { id: 'TPL-SYS02', template_code: 'SYS02', title: 'End-of-day review', group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day', due_rule: '16:30', evidence_required: 'Unresolved actions assigned', active: true, template_version: '1.0', created_at: '2025-01-01T00:00:00Z', created_by: 'S02', updated_at: '2025-01-01T00:00:00Z', updated_by: 'S02', version: 1, commit_id: 'S02' });
  const r = core._s18RunAcceptance(s);
  const bkp05 = r.items.find(i => i.acceptance_id === 'BKP-05');
  assert.equal(bkp05.status, 'PASS', 'BKP-05 should be PASS');
});

test('S18 20: environment guard refuses wrong sheet', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = { tables, getSheetId: () => 'wrong', getEnvironment: () => 'DEV', list: n => copy(tables[n] || []), get: (n, id) => null };
  assert.throws(() => core._s18RunAcceptance(s), /S18_REFUSED/);
});

test('S18 21: environment guard refuses non-DEV', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = { tables, getSheetId: () => core.S18_DEV_SHEET_ID, getEnvironment: () => 'TEST', list: n => copy(tables[n] || []), get: (n, id) => null };
  assert.throws(() => core._s18RunAcceptance(s), /S18_REFUSED/);
});

test('S18 22: acceptance is read-only', () => {
  const s = makeStore();
  const before = copy(s.tables);
  core._s18RunAcceptance(s);
  core._s18AcceptanceSummary(s);
  core._s18ManualChecklist();
  assert.deepEqual(s.tables, before);
});

test('S18 23: namespace compatibility — bundles parse, S18 globals namespaced', () => {
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('s18/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  const s18 = fs.readFileSync('apps-script/s18/S18Acceptance.js', 'utf8');
  new vm.Script(prior + '\n' + s18);
  for (const m of s18.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm))
    assert.match(m[1], /^(?:S18_|_s18|runS18)/);
  assert.doesNotMatch(s18, /CalendarApp|UrlFetchApp|fetch\(|deleteRow|deleteSheet|GmailApp|MailApp|DriveApp|https:\/\//);
});

test('S18 24: zero-arg DEV smoke', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/s18/S18Acceptance.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.S18_HEADERS)) grids[n] = [Array.from(h)];
  for (const r of seed.ReleaseModes) {
    grids.ReleaseModes.push(grids.ReleaseModes[0].map(k => r[k] ?? (k === 'version' ? 1 : '')));
  }
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); },
        setValues() {}
      };
    }
  }));
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => core.S18_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });

  for (const fn of ['runS18AcceptanceDryRun', 'runS18AcceptanceTest', 'runS18AcceptanceTest']) {
    const r = ctx[fn]();
    assert.equal(r.pass, true, fn + ': ' + JSON.stringify(r));
  }
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'TEST' }) }) };
  assert.equal(ctx.runS18AcceptanceDryRun().pass, false);
});
