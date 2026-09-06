const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCompletionController } = require('../s04/client-state.js');
function storage() { let saved; return { load: () => saved, save: value => { saved = value; } }; }
const committed = c => ({ status: 'Committed', committed: true, command_id: c.command_id, task_id: c.task_id, version: c.expected_version + 1, commit_id: 'COMMIT-test' });
test('S04 UI persists Pending and prevents duplicate taps until committed', async () => {
  const s = storage(); let resolve;
  const ui = createCompletionController({ storage: s, commandId: () => 'CMD-ui', send: c => new Promise(r => { resolve = () => r(committed(c)); }) });
  const pending = ui.complete('TASK-ui', 1, 'Done');
  assert.equal(s.load().status, 'Pending'); assert.equal(ui.canHideTask(), false);
  await assert.rejects(ui.complete('TASK-ui', 1, 'Done'), /COMMAND_ALREADY_EXISTS/);
  await assert.rejects(ui.retry(), /SUBMISSION_IN_PROGRESS/);
  resolve(); await pending; assert.equal(ui.canHideTask(), true);
});
test('S04 UI restart after uncertain transport retries the identical stored command', async () => {
  const s = storage(); let request;
  const first = createCompletionController({ storage: s, commandId: () => 'CMD-ui', send: async c => { request = c; throw new Error('network'); } });
  await first.complete('TASK-ui', 1, 'Done'); assert.equal(first.getState().status, 'Pending');
  const restarted = createCompletionController({ storage: s, commandId: () => 'MUST-NOT-USE', send: async c => { assert.deepEqual(c, request); return committed(c); } });
  await restarted.retry(); assert.equal(restarted.getState().status, 'Committed');
});
test('S04 UI failed command stays visible; no false committed response can hide task', async () => {
  const s = storage();
  const ui = createCompletionController({ storage: s, commandId: () => 'CMD-ui', send: async () => ({ status: 'Failed', error: 'PERMISSION_DENIED' }) });
  await ui.complete('TASK-ui', 1, 'Done'); assert.equal(ui.getState().status, 'Failed'); assert.equal(ui.canHideTask(), false);
  const bad = createCompletionController({ storage: storage(), commandId: () => 'CMD-ui', send: async c => ({ ...committed(c), command_id: 'OTHER' }) });
  await bad.complete('TASK-ui', 1, 'Done'); assert.equal(bad.getState().status, 'Pending'); assert.equal(bad.canHideTask(), false);
});
