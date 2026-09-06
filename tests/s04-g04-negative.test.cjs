const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {
  testDisabledMode, testStaleVersion, testDuplicateReplay,
  testCommandMismatch, testOutOfPilot, restoreSafeState,
  buildJob, buildTask, upsertJob, upsertTask,
  enableFn01, disableFn01, makeCommand, DEV_SHEET_ID
} = require('../s04/g04-negative.js');
const { canonical, commandRequest } = require('../s04/processor.js');
const { createProcessor } = require('../s04/processor.js');
const { createSignedActorProvider } = require('../s04/identity.js');

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const hmac = (text, secret) => crypto.createHmac('sha256', secret).update(text).digest('hex');
const secret = 'local-test-secret-at-least-32-chars-long!!';
const copy = v => JSON.parse(JSON.stringify(v));

function makeStore() {
  const data = {};
  const tables = ['Jobs', 'Tasks', 'TaskEvents', 'AuditEvents', 'CommitJournal', 'ReleaseModes', 'People', 'PersonRoles', 'PermissionRules', 'TaskDependencies'];
  for (const t of tables) data[t] = [];

  // Seed People/PersonRoles/PermissionRules/ReleaseModes for processor
  data.People = [
    { id: 'PERSON-tanya', email: 'lenny@simplesolarltd.co.uk', display_name: 'Tanya', role: 'Office', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
  ];
  data.PersonRoles = [
    { id: 'PROLE-tanya-office', person_id: 'PERSON-tanya', role: 'Office', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' }
  ];
  data.PermissionRules = [
    { id: 'PERM-office-tasks', role: 'Office', action: 'CompleteTask', entity: 'Tasks', scope: 'All', allowed: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' }
  ];
  data.ReleaseModes = [
    { id: 'RM-FN01', function_id: 'FN-01', function_name: 'Office core', mode: 'Disabled', mode_record_basis: 'seed', authorised_job_scope: 'None', target_release: 'R1', planned_target_mode: 'Automated', current_system: 'manual', fallback: 'manual', external_ids_protected_reference: null, activation_time: null, approved_version: null, ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' }
  ];

  return {
    getSheetId: () => DEV_SHEET_ID,
    list: name => data[name] || [],
    get: (name, id) => (data[name] || []).find(r => r.id === id) || null,
    insert(name, row) { if (data[name].find(r => r.id === row.id)) throw new Error('Duplicate'); data[name].push(copy(row)); },
    update(name, id, patch) { const r = data[name].find(r => r.id === id); if (!r) throw new Error('Not found'); Object.assign(r, patch); }
  };
}

function makeServices(store) {
  function signProof(command) {
    const validated = commandRequest(command);
    const requestHash = sha256(canonical(validated));
    const now = Date.now();
    const proof = {
      version: 'S04-IDENTITY-2', purpose: 'S04_COMPLETE_TASK',
      subject: 'lenny@simplesolarltd.co.uk', jti: 'test-jti-' + Math.random().toString(36).slice(2, 10),
      email: 'lenny@simplesolarltd.co.uk',
      audience: 'S04:s04-project:' + DEV_SHEET_ID,
      issued_at: now, expires_at: now + 120000, request_hash: requestHash
    };
    proof.signature = hmac(canonical(proof), secret);
    return proof;
  }

  function runCommand(command, proof) {
    const provider = createSignedActorProvider({
      proof, secret, audience: 'S04:s04-project:' + DEV_SHEET_ID,
      now: () => Date.now(), sha256, hmac
    });
    const proc = createProcessor({
      config: { environment: 'DEV', sheetId: DEV_SHEET_ID, projectId: 's04-project' },
      projectId: () => 's04-project', store, lock: { acquire: () => true, release: () => {} },
      actorProvider: provider, sha256,
      now: () => new Date().toISOString()
    });
    return proc.process(command);
  }

  return {
    store, config: { environment: 'DEV', sheetId: DEV_SHEET_ID, projectId: 's04-project' },
    secret, signProof, runCommand,
    now: () => Date.now(), sha256, hmac, canonical, commandRequest
  };
}

/* --- Test 1: Disabled mode --- */
test('G04 negative: disabled mode refusal', () => {
  const store = makeStore();
  const svc = makeServices(store);
  const result = testDisabledMode(svc);
  assert.equal(result.pass, true, result.detail);
  assert.equal(result.before_status, 'Open');
  assert.equal(result.after_status, 'Open');
  assert.equal(result.before_version, 1);
  assert.equal(result.after_version, 1);
  assert.equal(result.task_events, 0);
  assert.equal(result.audit_events, 0);
  assert.ok(!result.journal_state || result.journal_state !== 'Committed');
});

/* --- Test 2: Stale version --- */
test('G04 negative: stale version refusal', () => {
  const store = makeStore();
  const svc = makeServices(store);
  const result = testStaleVersion(svc);
  assert.equal(result.pass, true, result.detail);
  assert.equal(result.before_status, 'Open');
  assert.equal(result.after_status, 'Open');
  assert.equal(result.before_version, 1);
  assert.equal(result.after_version, 1);
  assert.equal(result.task_events, 0);
  assert.equal(result.audit_events, 0);
});

/* --- Test 3: Duplicate replay --- */
test('G04 negative: duplicate command replay', () => {
  const store = makeStore();
  const svc = makeServices(store);
  const result = testDuplicateReplay(svc);
  assert.equal(result.pass, true, result.detail);
  assert.equal(result.before_status, 'Open');
  assert.equal(result.after_status, 'Complete');
  assert.equal(result.before_version, 1);
  assert.equal(result.after_version, 2);
  assert.equal(result.task_events, 1);
  assert.equal(result.audit_events, 1);
  assert.equal(result.journal_state, 'Committed');
  assert.equal(result.journal_count, 1);
});

/* --- Test 4: Command mismatch --- */
test('G04 negative: same command ID / different payload refusal', () => {
  const store = makeStore();
  const svc = makeServices(store);
  const result = testCommandMismatch(svc);
  assert.equal(result.pass, true, result.detail);
  assert.equal(result.after_version, 2);
  assert.equal(result.task_events, 1);
  assert.equal(result.audit_events, 1);
  assert.equal(result.journal_count, 1);
});

/* --- Test 5: Out of pilot --- */
test('G04 negative: out-of-pilot refusal', () => {
  const store = makeStore();
  const svc = makeServices(store);
  const result = testOutOfPilot(svc);
  assert.equal(result.pass, true, result.detail);
  assert.equal(result.before_status, 'Open');
  assert.equal(result.after_status, 'Open');
  assert.equal(result.before_version, 1);
  assert.equal(result.after_version, 1);
  assert.equal(result.task_events, 0);
  assert.equal(result.audit_events, 0);
});

/* --- Safety tests --- */
test('G04 negative: restoreSafeState disables FN-01', () => {
  const store = makeStore();
  enableFn01(store);
  assert.equal(store.get('ReleaseModes', 'RM-FN01').mode, 'Automated');
  restoreSafeState(store);
  assert.equal(store.get('ReleaseModes', 'RM-FN01').mode, 'Disabled');
});

test('G04 negative: test fixtures are idempotent', () => {
  const store = makeStore();
  const svc = makeServices(store);
  // Run disabled mode test twice — second run should not create duplicates
  testDisabledMode(svc);
  const jobCount = store.list('Jobs').length;
  const taskCount = store.list('Tasks').length;
  testDisabledMode(svc);
  assert.equal(store.list('Jobs').length, jobCount);
  assert.equal(store.list('Tasks').length, taskCount);
});

test('G04 negative: each test uses distinct IDs', () => {
  const store = makeStore();
  const svc = makeServices(store);
  testDisabledMode(svc);
  testStaleVersion(svc);
  testDuplicateReplay(svc);
  testCommandMismatch(svc);
  testOutOfPilot(svc);
  // All 5 tasks should have distinct IDs
  const ids = store.list('Tasks').map(t => t.id);
  assert.equal(new Set(ids).size, 5);
  assert.ok(ids.includes('T-g04-disabled'));
  assert.ok(ids.includes('T-g04-stale'));
  assert.ok(ids.includes('T-g04-replay'));
  assert.ok(ids.includes('T-g04-mismatch'));
  assert.ok(ids.includes('T-g04-outside'));
});

test('G04 negative: original T-open untouched', () => {
  const store = makeStore();
  // Pre-create T-open
  store.insert('Tasks', { id: 'T-open', job_id: 'J-s04-pilot', template_code: 'S04-DEV-COMPLETE', instance_key: 'orig', group: 'System', title: 'Original', owner_id: 'PERSON-tanya', backup_id: null, related_entity_type: null, related_entity_id: null, due_at: null, original_due_at: null, priority: 1, status: 'Open', blocking_reason: null, next_followup_at: null, completed_at: null, completed_by: null, completion_note: null, evidence_id: null, revision_required: false, created_rule_version: 'v1', created_at: '2026-01-01T00:00:00.000Z', created_by: 'orig', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'orig', version: 1, source_system: 'original', commit_id: 'orig' });
  const svc = makeServices(store);
  testDisabledMode(svc);
  testStaleVersion(svc);
  const tOpen = store.get('Tasks', 'T-open');
  assert.equal(tOpen.status, 'Open');
  assert.equal(tOpen.version, 1);
  assert.equal(tOpen.source_system, 'original');
});

/* --- Package tests --- */
test('G04NegativeCore.gs exposes all functions as global G04Tests', () => {
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(fs.readFileSync('apps-script/s04/G04NegativeCore.gs', 'utf8'), ctx);
  assert.equal(typeof ctx.G04Tests.testDisabledMode, 'function');
  assert.equal(typeof ctx.G04Tests.testStaleVersion, 'function');
  assert.equal(typeof ctx.G04Tests.testDuplicateReplay, 'function');
  assert.equal(typeof ctx.G04Tests.testCommandMismatch, 'function');
  assert.equal(typeof ctx.G04Tests.testOutOfPilot, 'function');
  assert.equal(typeof ctx.G04Tests.restoreSafeState, 'function');
});

test('G04NegativeCore.gs has no require or module.exports', () => {
  const source = fs.readFileSync('apps-script/s04/G04NegativeCore.gs', 'utf8');
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bmodule\.exports\b/);
  assert.match(source, /var G04Tests/);
});

test('G04NegativeCore.gs packaged matches local core behavior', () => {
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(fs.readFileSync('apps-script/s04/G04NegativeCore.gs', 'utf8'), ctx);
  // Verify the packaged restoreSafeState works the same way
  const store = makeStore();
  enableFn01(store);
  ctx.G04Tests.restoreSafeState(store);
  assert.equal(store.get('ReleaseModes', 'RM-FN01').mode, 'Disabled');
});
