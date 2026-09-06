const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const Core = require('../s04/processor.js');
const { createSignedActorProvider } = require('../s04/identity.js');
const { createFileStore, createLocalLock } = require('../s04/local-adapters.cjs');
const { build } = require('../scripts/build-s04.cjs');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const hmac = (text, secret) => crypto.createHmac('sha256', secret).update(text).digest('hex');
const copy = v => JSON.parse(JSON.stringify(v));
const command = () => ({ command_id: 'CMD-one', action: 'COMPLETE_TASK', task_id: 'T-open', expected_version: 1, payload: { completion_note: 'Synthetic completion' } });
function setup(t, api = Core) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's04-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'store.json');
  fs.copyFileSync('fixtures/s04-local.json', file);
  const store = createFileStore(file, Core.DEV_SHEET_ID);
  const options = { config: { environment: 'DEV', sheetId: Core.DEV_SHEET_ID, projectId: 's04-project' },
    projectId: () => 's04-project', store, lock: createLocalLock(), sha256,
    actorProvider: { getIdentity: () => ({ email: 'office@s04.example.invalid' }) }, now: () => '2026-09-05T11:00:00.000Z' };
  const run = input => api.createProcessor(options).process(input || command());
  return { file, store, options, run, change(table, id, patch) { store.update(table, id, { ...store.get(table, id), ...patch }); } };
}
function assertNoEffects(f) {
  assert.equal(f.store.get('Tasks', 'T-open').version, 1);
  for (const name of ['TaskEvents', 'AuditEvents', 'CommitJournal']) assert.equal(f.store.list(name).length, 0);
}

test('S04 completes task, increments version, persists exactly attributed events and journal result', t => {
  const f = setup(t), result = f.run();
  assert.equal(result.status, 'Committed', JSON.stringify(result));
  const task = f.store.get('Tasks', 'T-open');
  assert.equal(task.status, 'Complete'); assert.equal(task.version, 2);
  assert.equal(task.completed_by, 'P-office'); assert.equal(task.completed_at, f.options.now());
  assert.equal(task.completion_note, 'Synthetic completion');
  const event = f.store.list('TaskEvents'); const audit = f.store.list('AuditEvents');
  assert.equal(event.length, 1); assert.equal(audit.length, 1);
  assert.equal(event[0].actor, 'P-office'); assert.equal(audit[0].initiating_actor, 'P-office');
  assert.equal(event[0].commit_id, task.commit_id); assert.equal(audit[0].commit_id, task.commit_id);
  assert.equal(audit[0].correlation_id, command().command_id);
  const journal = f.store.list('CommitJournal')[0];
  assert.equal(journal.state, 'Committed');
  assert.deepEqual(JSON.parse(journal.changes_json).result, result);
});

const denials = [
  ['unknown actor', f => { f.options.actorProvider.getIdentity = () => ({ email: 'unknown@s04.example.invalid' }); }, 'UNKNOWN_OR_DUPLICATE_ACTOR'],
  ['inactive actor', f => { f.options.actorProvider.getIdentity = () => ({ email: 'inactive@s04.example.invalid' }); }, 'INACTIVE_ACTOR'],
  ['no active roles', f => { f.options.actorProvider.getIdentity = () => ({ email: 'norole@s04.example.invalid' }); }, 'NO_ACTIVE_ROLE'],
  ['installer', f => { f.options.actorProvider.getIdentity = () => ({ email: 'installer@s04.example.invalid' }); }, 'PERMISSION_DENIED'],
  ['Disabled mode', f => f.change('ReleaseModes', 'MODE-s04', { mode: 'Disabled' }), 'MODE_DENIED'],
  ['Manual mode', f => f.change('ReleaseModes', 'MODE-s04', { mode: 'Manual' }), 'MODE_DENIED'],
  ['unknown mode', f => f.change('ReleaseModes', 'MODE-s04', { mode: 'Typo' }), 'MODE_DENIED'],
  ['outside pilot', f => f.change('Tasks', 'T-open', { job_id: 'J-outside' }), 'OUTSIDE_PILOT'],
  ['missing job', f => f.change('Tasks', 'T-open', { job_id: 'J-missing' }), 'JOB_NOT_FOUND'],
  ['unknown scope', f => f.change('ReleaseModes', 'MODE-s04', { authorised_job_scope: 'Typo' }), 'PILOT_SCOPE_DENIED'],
  ['All scope', f => f.change('ReleaseModes', 'MODE-s04', { authorised_job_scope: 'All' }), 'PILOT_SCOPE_DENIED'],
  ['wrong release', f => f.change('Jobs', 'J-pilot', { release_scope: 'R2' }), 'OUTSIDE_PILOT'],
  ['string pilot false', f => f.change('Jobs', 'J-pilot', { pilot_job: 'FALSE' }), 'OUTSIDE_PILOT'],
  ['non-synthetic task', f => f.change('Tasks', 'T-open', { source_system: 'business' }), 'SYNTHETIC_SCOPE_REQUIRED'],
  ['blocked task', f => f.change('Tasks', 'T-open', { blocking_reason: 'Prerequisite incomplete' }), 'TASK_BLOCKED'],
  ['revision required', f => f.change('Tasks', 'T-open', { revision_required: true }), 'TASK_BLOCKED'],
  ['cancelled task', f => f.change('Tasks', 'T-open', { status: 'Cancelled' }), 'TASK_STATE_DENIED'],
  ['dependency', f => f.store.insert('TaskDependencies', { id: 'D-one', task_id: 'T-open', satisfied_at: null }), 'TASK_DEPENDENCY_UNSATISFIED'],
  ['PROD', f => { f.options.config.environment = 'PROD'; }, 'DEV_ONLY'],
  ['wrong sheet', f => { f.options.config.sheetId = 'other'; }, 'SHEET_ID_MISMATCH'],
  ['wrong actual sheet', f => { f.options.store = { ...f.store, getSheetId: () => 'other' }; }, 'SHEET_ID_MISMATCH'],
  ['wrong project', f => { f.options.config.projectId = 'other'; }, 'PROJECT_ID_MISMATCH'],
  ['missing project', f => { f.options.config.projectId = ''; }, 'PROJECT_ID_MISMATCH'],
  ['no trusted provider', f => { f.options.actorProvider.getIdentity = () => null; }, 'TRUSTED_IDENTITY_REQUIRED'],
  ['explicit permission denial', f => f.store.insert('PermissionRules', { id: 'DENY', role: 'Office', action: 'CompleteTask', entity: 'Tasks', scope: 'All', allowed: false }), 'PERMISSION_DENIED'],
  ['invalid permission boolean', f => f.change('PermissionRules', 'RULE-office', { allowed: 'TRUE' }), 'INVALID_PERMISSION_RULE']
];
for (const [name, change, error] of denials) test('S04 denies ' + name + ' without writes', t => {
  const f = setup(t); change(f); const result = f.run();
  assert.equal(result.error, error); assertNoEffects(f);
});
for (const [name, mutate, error] of [
  ['spoofed actor_email', c => { c.actor_email = 'admin@s04.example.invalid'; }, 'INVALID_FIELDS'],
  ['spoofed role in payload', c => { c.payload.role = 'Admin'; }, 'INVALID_FIELDS'],
  ['missing task', c => { c.task_id = 'T-absent'; }, 'TASK_NOT_FOUND'],
  ['already completed', c => { c.task_id = 'T-complete'; c.expected_version = 2; }, 'TASK_STATE_DENIED'],
  ['stale version', c => { c.expected_version = 8; }, 'STALE_VERSION'],
  ['missing version', c => { delete c.expected_version; }, 'INVALID_VERSION'],
  ['other action', c => { c.action = 'CANCEL_JOB'; }, 'ACTION_DENIED'],
  ['missing payload', c => { delete c.payload; }, 'INVALID_FIELDS'],
  ['invalid command id', c => { c.command_id = ''; }, 'INVALID_COMMAND_ID']
]) test('S04 rejects ' + name, t => { const f = setup(t), c = command(); mutate(c); assert.equal(f.run(c).error, error); assertNoEffects(f); });

test('S04 null envelope safely rejected', t => { const f = setup(t); assert.equal(Core.createProcessor(f.options).process(null).status, 'Failed'); assert.equal(f.run({ ...command(), expected_version: Number.MAX_SAFE_INTEGER }).error, 'INVALID_VERSION'); assertNoEffects(f); });
test('S04 persisted admin rule permits active admin', t => { const f = setup(t); f.options.actorProvider.getIdentity = () => ({ email: 'admin@s04.example.invalid' }); assert.equal(f.run().status, 'Committed'); });
test('S04 ignores inactive elevated role; People.role alone never grants access', t => {
  const f = setup(t); f.change('People', 'P-installer', { role: 'Admin' });
  f.store.insert('PersonRoles', { id: 'R-installer-elevation', person_id: 'P-installer', active: false, role: 'Admin' });
  f.options.actorProvider.getIdentity = () => ({ email: 'installer@s04.example.invalid' });
  assert.equal(f.run().error, 'PERMISSION_DENIED');
});
test('S04 permission Assigned scope checks owner/backup', t => {
  const f = setup(t); f.change('PermissionRules', 'RULE-office', { scope: 'Assigned' });
  f.change('Tasks', 'T-open', { owner_id: 'P-admin', backup_id: null });
  assert.equal(f.run().error, 'PERMISSION_DENIED');
  f.change('Tasks', 'T-open', { backup_id: 'P-office' }); assert.equal(f.run().status, 'Committed');
});
test('S04 restart replays persisted result without mutation/events', t => {
  const f = setup(t), result = f.run(), before = fs.readFileSync(f.file, 'utf8');
  f.options.store = createFileStore(f.file, Core.DEV_SHEET_ID);
  assert.deepEqual(f.run(), result); assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});
test('S04 changed payload with unchanged client hash conflicts after restart', t => {
  const f = setup(t), c = command(); c.payload_hash = 'client-lie'; assert.equal(f.run(c).status, 'Committed');
  c.payload.completion_note = 'Changed'; assert.equal(f.run(c).error, 'COMMAND_ID_CONFLICT');
  assert.equal(f.store.list('TaskEvents').length, 1); assert.equal(f.store.list('AuditEvents').length, 1);
});
test('S04 changed client hash alone does not change canonical request', t => {
  const f = setup(t), c = command(), result = f.run(c); c.payload_hash = 'ignored'; assert.deepEqual(f.run(c), result);
});
test('S04 cross-actor replay denied', t => {
  const f = setup(t); f.run(); f.options.actorProvider.getIdentity = () => ({ email: 'admin@s04.example.invalid' });
  assert.equal(f.run().error, 'COMMAND_ID_CONFLICT');
});
test('S04 overlapping command is locked out; same-version loser is stale', t => {
  const f = setup(t), competing = { ...command(), command_id: 'CMD-two' }; let overlap;
  const original = f.options.store;
  f.options.store = { ...original, update(table, id, row) {
    if (table === 'Tasks') overlap = Core.createProcessor(f.options).process(competing);
    original.update(table, id, row);
  } };
  assert.equal(f.run().status, 'Committed'); assert.equal(overlap.error, 'LOCK_BUSY');
  assert.equal(f.run(competing).error, 'STALE_VERSION');
  assert.equal(f.store.list('TaskEvents').length, 1); assert.equal(f.store.get('Tasks', 'T-open').version, 2);
});
test('S04 re-reads version after lock acquisition', t => {
  const f = setup(t), acquire = f.options.lock.acquire;
  f.options.lock.acquire = () => { f.change('Tasks', 'T-open', { version: 2 }); return acquire(); };
  assert.equal(f.run().error, 'STALE_VERSION'); assert.equal(f.store.list('CommitJournal').length, 0);
});
test('S04 re-resolves active roles under lock', t => {
  const f = setup(t), acquire = f.options.lock.acquire;
  f.options.lock.acquire = () => { f.change('PersonRoles', 'R-office', { active: false }); return acquire(); };
  assert.equal(f.run().error, 'NO_ACTIVE_ROLE'); assertNoEffects(f);
});

function interrupt(f, at, after = true) {
  let writes = 0; const original = f.options.store;
  const wrapped = { ...original };
  for (const method of ['insert', 'update']) wrapped[method] = (...args) => {
    writes++; if (writes === at && !after) throw new Error('simulated interruption');
    const result = original[method](...args);
    if (writes === at && after) throw new Error('simulated interruption'); return result;
  };
  f.options.store = wrapped;
}
for (const at of [1, 2, 3, 4, 5, 6]) test('S04 restart recovery after durable checkpoint ' + at, t => {
  const f = setup(t); interrupt(f, at);
  assert.equal(f.run().status, 'Pending');
  f.options.store = createFileStore(f.file, Core.DEV_SHEET_ID);
  const retry = f.run();
  if ([3, 4].includes(at)) {
    assert.equal(retry.error, 'RECOVERY_REQUIRED');
    assert.equal(f.store.list('CommitJournal')[0].state, 'RecoveryRequired');
    assert.equal(f.run({ ...command(), command_id: 'CMD-other' }).error, 'RECOVERY_REQUIRED');
  } else {
    assert.equal(retry.status, 'Committed', JSON.stringify(retry));
    assert.equal(f.store.list('TaskEvents').length, 1); assert.equal(f.store.list('AuditEvents').length, 1);
    if (at < 6) assert.equal(JSON.parse(f.store.list('CommitJournal')[0].changes_json).recovery_classification, at < 3 ? 'NOT_APPLIED' : 'FULLY_APPLIED');
  }
});
test('S04 lost prepared-write acknowledgement before persistence safely retried', t => {
  const f = setup(t); interrupt(f, 1, false); assert.equal(f.run().status, 'Pending');
  f.options.store = f.store; assert.equal(f.run().status, 'Committed');
});
test('S04 partial event corruption requires manual recovery', t => {
  const f = setup(t); interrupt(f, 5); f.run(); f.options.store = f.store;
  const event = f.store.list('TaskEvents')[0]; f.change('TaskEvents', event.id, { actor: 'P-wrong' });
  assert.equal(f.run().error, 'RECOVERY_REQUIRED');
});

const secret = 'test-only-secret-never-deploy-0123456789';
const now = 1788600000000;
function signedProof(request = command()) {
  const p = { version: 'S04-IDENTITY-2', purpose: 'S04_COMPLETE_TASK', subject: 'office@s04.example.invalid', jti: 'test-jti-0123456789', email: 'office@s04.example.invalid', audience: 'test-audience',
    issued_at: now, expires_at: now + 60000, request_hash: sha256(Core.canonical(Core.commandRequest(request))) };
  p.signature = hmac(Core.canonical(p), secret); return p;
}
function provider(proof, overrides = {}) { return createSignedActorProvider({ proof, secret, audience: 'test-audience', now: () => now, sha256, hmac, ...overrides }); }
test('S04 signed trusted provider validates cryptographically bound actor', () => {
  assert.deepEqual(provider(signedProof()).getIdentity(Core.commandRequest(command())), { email: 'office@s04.example.invalid', subject: 'office@s04.example.invalid', jti: 'test-jti-0123456789' });
});
for (const field of ['email', 'audience', 'signature', 'request_hash', 'issued_at', 'expires_at']) test('S04 proof tampering denied: ' + field, () => {
  const p = signedProof(); p[field] = typeof p[field] === 'number' ? 0 : 'forged';
  assert.throws(() => provider(p).getIdentity(Core.commandRequest(command())), /TRUSTED_IDENTITY_REQUIRED/);
});
test('S04 missing issuer secret denies', () => { assert.throws(() => provider(signedProof(), { secret: '' }).getIdentity(command()), /TRUSTED_IDENTITY_REQUIRED/); });
test('S04 expired proof denies', () => { assert.throws(() => provider(signedProof(), { now: () => now + 300001 }).getIdentity(command()), /TRUSTED_IDENTITY_REQUIRED/); });
test('S04 proof cannot be reused for another command', () => { assert.throws(() => provider(signedProof()).getIdentity({ ...command(), command_id: 'CMD-other' }), /TRUSTED_IDENTITY_REQUIRED/); });

test('S04 generated package matches local sources and has no CommonJS runtime calls', () => {
  const source = fs.readFileSync('apps-script/s04/S04Core.gs', 'utf8');
  assert.equal(source, build()); assert.doesNotMatch(source, /\brequire\s*\(|module\.exports/);
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(typeof context.S04.createProcessor, 'function');
});
test('S04 packaged/local processor behavior parity', t => {
  const context = vm.createContext({}); vm.runInContext(build(), context);
  const local = setup(t), packaged = setup(t, context.S04);
  assert.deepEqual(copy(packaged.run()), local.run());
  assert.deepEqual(JSON.parse(fs.readFileSync(packaged.file)), JSON.parse(fs.readFileSync(local.file)));
  assert.deepEqual(copy(packaged.run()), local.run());
});

test('S04 orphan deterministic event prevents a new task mutation', t => {
  const f = setup(t);
  f.store.insert('TaskEvents', { id: 'TE-S04-' + sha256(command().command_id), actor: 'P-office' });
  assert.equal(f.run().error, 'ORPHAN_EVENT_REQUIRES_REVIEW');
  assert.equal(f.store.get('Tasks', 'T-open').version, 1); assert.equal(f.store.list('CommitJournal').length, 0);
});
test('S04 missing/duplicate mode rows fail closed', t => {
  const f = setup(t); f.change('ReleaseModes', 'MODE-s04', { function_id: 'FN-other' });
  assert.equal(f.run().error, 'MODE_MISSING_OR_DUPLICATE');
  f.change('ReleaseModes', 'MODE-s04', { function_id: 'FN-01' });
  f.store.insert('ReleaseModes', { ...f.store.get('ReleaseModes', 'MODE-s04'), id: 'MODE-duplicate' });
  assert.equal(f.run().error, 'MODE_MISSING_OR_DUPLICATE'); assertNoEffects(f);
});
test('S04 duplicate normalised People email fails closed', t => {
  const f = setup(t); f.store.insert('People', { ...f.store.get('People', 'P-office'), id: 'P-duplicate', email: ' OFFICE@s04.example.invalid ' });
  assert.equal(f.run().error, 'UNKNOWN_OR_DUPLICATE_ACTOR'); assertNoEffects(f);
});
