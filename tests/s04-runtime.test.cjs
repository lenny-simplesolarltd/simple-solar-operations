const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execute } = require('../s04/runtime.js');
const { createSheetStore } = require('../s04/sheet-store.js');
const { sheetEnvironment, clone, schema } = require('./s04-sheet-helper.cjs');
const command = () => ({ command_id: 'CMD-runtime', action: 'COMPLETE_TASK', task_id: 'T-open', expected_version: 1, payload: { completion_note: '=not a formula' } });
function packaged(env) {
  const context = vm.createContext(env.services);
  vm.runInContext(fs.readFileSync('apps-script/s04/S04Core.gs', 'utf8'), context);
  vm.runInContext(fs.readFileSync('apps-script/s04/S04Entry.gs', 'utf8'), context);
  return (cmd, proof) => clone(context.runS04CompleteTaskCommand(JSON.stringify(cmd), JSON.stringify(proof)));
}
for (const kind of ['local runtime', 'packaged .gs entry']) test('S04 ' + kind + ' writes real schema rows through locked enumeration adapter and replays', () => {
  const env = sheetEnvironment(), c = command();
  const run = kind === 'local runtime' ? (cmd, proof) => execute(env.services, schema, JSON.stringify(cmd), JSON.stringify(proof)) : packaged(env);
  const result = run(c, env.proof(c));
  assert.equal(result.status, 'Committed', JSON.stringify(result));
  assert.equal(env.calls.named, 0); assert.equal(env.calls.taskReadsUnlocked, 0);
  assert.equal(env.calls.locks, 1); assert.equal(env.calls.releases, 1); assert.equal(env.calls.flush, 6);
  assert.deepEqual(env.calls.writes, ['CommitJournal', 'CommitJournal', 'Tasks', 'TaskEvents', 'AuditEvents', 'CommitJournal']);
  assert.equal(env.records('Tasks')[0].completion_note, '=not a formula');
  assert.equal(env.records('Tasks')[0].version, 2);
  assert.equal(env.records('TaskEvents')[0].actor, 'P-office');
  const before = clone(env.grids);
  // New runtime/VM instance; persistence is in sheet rows, not execution memory.
  const replay = packaged(env)(c, env.proof(c));
  assert.deepEqual(replay, result); assert.deepEqual(env.grids, before);
});
for (const [name, mutation, expected] of [
  ['no identity secret', e => { delete e.properties.S04_IDENTITY_SECRET; }, 'TRUSTED_IDENTITY_REQUIRED'],
  ['PROD config', e => { e.properties.S04_CONFIG = JSON.stringify({ ...e.config, environment: 'PROD' }); }, 'DEV_ONLY'],
  ['wrong configured project', e => { e.properties.S04_CONFIG = JSON.stringify({ ...e.config, projectId: 'other' }); }, 'PROJECT_ID_MISMATCH'],
  ['wrong configured sheet', e => { e.properties.S04_CONFIG = JSON.stringify({ ...e.config, sheetId: 'other' }); }, 'SHEET_ID_MISMATCH']
]) test('S04 runtime refuses ' + name + ' before workbook access', () => {
  const e = sheetEnvironment(), c = command(); mutation(e);
  assert.equal(packaged(e)(c, e.proof(c)).error, expected);
  assert.equal(e.calls.opens, 0); assert.equal(e.calls.writes.length, 0);
});
test('S04 runtime rejects identity spoof without trusting app owner', () => {
  const e = sheetEnvironment(), c = command(), p = e.proof(c); p.email = 'admin@s04.example.invalid';
  e.services.Session = { getActiveUser: () => ({ getEmail: () => 'admin@s04.example.invalid' }) };
  assert.equal(packaged(e)(c, p).error, 'TRUSTED_IDENTITY_REQUIRED'); assert.equal(e.calls.opens, 0);
});
test('S04 package respects persisted Disabled mode', () => {
  const e = sheetEnvironment(), c = command(); e.change('ReleaseModes', 'MODE-s04', 'mode', 'Disabled');
  assert.equal(packaged(e)(c, e.proof(c)).error, 'MODE_DENIED'); assert.equal(e.calls.writes.length, 0);
});
test('S04 package re-reads persisted version after actual script lock', () => {
  const e = sheetEnvironment(), c = command(), original = e.lock.tryLock;
  e.lock.tryLock = () => { e.change('Tasks', 'T-open', 'version', 4); return original(); };
  assert.equal(packaged(e)(c, e.proof(c)).error, 'STALE_VERSION'); assert.equal(e.calls.writes.length, 0);
});
for (const at of [1, 2, 3, 4, 5, 6]) test('S04 packaged sheet recovery after flush ' + at, () => {
  const e = sheetEnvironment(), c = command(), flush = e.services.SpreadsheetApp.flush;
  let count = 0;
  e.services.SpreadsheetApp.flush = () => { flush(); if (++count === at) throw new Error('Lost flush acknowledgement'); };
  assert.equal(packaged(e)(c, e.proof(c)).status, 'Pending');
  e.services.SpreadsheetApp.flush = flush;
  const result = packaged(e)(c, e.proof(c));
  if ([3, 4].includes(at)) {
    assert.equal(result.error, 'RECOVERY_REQUIRED'); assert.equal(e.records('CommitJournal')[0].state, 'RecoveryRequired');
  } else {
    assert.equal(result.status, 'Committed', JSON.stringify(result));
    assert.equal(e.records('TaskEvents').length, 1); assert.equal(e.records('AuditEvents').length, 1);
  }
});
test('S04 sheet reads normalise boolean strings and dates without truthiness', () => {
  const e = sheetEnvironment(); e.change('People', 'P-office', 'active', 'FALSE');
  e.change('People', 'P-office', 'created_at', new Date('2026-01-01T00:00:00.000Z'));
  const store = createSheetStore(e.ss, schema, () => {});
  assert.equal(store.get('People', 'P-office').active, false);
  assert.equal(store.get('People', 'P-office').created_at, '2026-01-01T00:00:00.000Z');
});
test('S04 sheet adapter rejects malformed headers and duplicate IDs', () => {
  const e = sheetEnvironment(), store = createSheetStore(e.ss, schema, () => {});
  e.grids.Tasks[0][0] = 'unexpected'; assert.throws(() => store.list('Tasks'), /Schema mismatch/);
  e.grids.Tasks[0][0] = 'id'; e.grids.Tasks.push([...e.grids.Tasks[1]]);
  assert.throws(() => store.list('Tasks'), /duplicate id/);
});
test('S04 store forbids system configuration writes and event edits', () => {
  const e = sheetEnvironment(), store = createSheetStore(e.ss, schema, () => {});
  assert.throws(() => store.update('People', 'P-office', {}), /Write forbidden/);
  assert.throws(() => store.update('ReleaseModes', 'MODE-s04', {}), /Write forbidden/);
  assert.throws(() => store.update('AuditEvents', 'AE-test', {}), /Write forbidden/);
  assert.throws(() => store.update('TaskEvents', 'TE-test', {}), /Write forbidden/);
  assert.equal(e.calls.writes.length, 0);
});
test('S04 package rejects unavailable row capacity without inserting rows', () => {
  const e = sheetEnvironment(), c = command(); e.sheets.CommitJournal.getMaxRows = () => 1;
  assert.equal(packaged(e)(c, e.proof(c)).status, 'Pending'); assert.equal(e.calls.writes.length, 0);
});
test('S04 standalone manifest contains only reviewed Sheets scope', () => {
  const manifest = JSON.parse(fs.readFileSync('apps-script/s04/appsscript.json'));
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
});
