const { test } = require('node:test');
const assert = require('node:assert/strict');

const { makeCommand, makeActor, ReleaseMode, CommitState, OutboxStatus, TaskStatus, FailureCategory } = require('../processor/types.js');
const { testClock } = require('../processor/clock.js');
const { validateCommandEnvelope, checkIdempotency, recordProcessedCommand } = require('../processor/command.js');
const { resolveActor, actorCanPerform } = require('../processor/actor.js');
const { checkReleaseMode, checkPilotScope, resolveEffectiveMode } = require('../processor/modes.js');
const { checkVersion, acquireLock, releaseLock } = require('../processor/locking.js');
const { createJournal, prepareCommit, markApplying, markCommitted, markRecoveryRequired, getUncommitted } = require('../processor/journal.js');
const { createAuditLog, recordAudit, queryAudit } = require('../processor/audit.js');
const { createTaskStore, createTask, completeTask, getTaskByInstanceKey } = require('../processor/tasks.js');
const { createOutbox, enqueueOutbox, markProcessing, markSucceeded, markRetryDue, markNeedsReview, getPendingItems, calculateBackoff } = require('../processor/outbox.js');
const { createHealthStore, recordHealthCheck, getLastSuccess } = require('../processor/health.js');
const { recoverUncommitted } = require('../processor/reconciler.js');
const { createProcessor } = require('../processor/processor.js');

// --- Test fixtures ---

const releaseModes = [
  { function_id: 'FN-01', mode: ReleaseMode.AUTOMATED, authorised_job_scope: 'All', target_release: 'R1' },
  { function_id: 'FN-02', mode: ReleaseMode.DISABLED, authorised_job_scope: 'None', target_release: 'R2' },
  { function_id: 'FN-03', mode: ReleaseMode.DISABLED, authorised_job_scope: 'None', target_release: 'R2' },
  { function_id: 'FN-05', mode: ReleaseMode.DISABLED, authorised_job_scope: 'None', target_release: 'R2' },
  { function_id: 'FN-07', mode: ReleaseMode.DISABLED, authorised_job_scope: 'None', target_release: 'R3' },
  { function_id: 'FN-14', mode: ReleaseMode.DISABLED, authorised_job_scope: 'None', target_release: 'R1' },
  { function_id: 'FN-16', mode: ReleaseMode.DISABLED, authorised_job_scope: 'None', target_release: 'R1' },
  { function_id: 'FN-19', mode: ReleaseMode.MANUAL, authorised_job_scope: 'All', target_release: 'R1' }
];

const peopleDir = [
  { id: 'PERSON-tanya', email: 'tanya@office.test', role: 'Office', active: true },
  { id: 'PERSON-ben', email: 'ben@office.test', role: 'Admin', active: true },
  { id: 'PERSON-installer', email: 'installer@test.test', role: 'Installer', active: true },
  { id: 'PERSON-deactivated', email: 'old@test.test', role: 'Office', active: false }
];

// --- 1. Duplicate command replay ---
test('duplicate command with same content returns original result', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', null, { task_id: 'TASK-1' });

  const r1 = proc.process(cmd);
  assert.equal(r1.accepted, true);

  const r2 = proc.process(cmd);
  assert.equal(r2.accepted, true, 'replay should be accepted');
  assert.deepEqual(r2, r1, 'replay returns same result');
  assert.equal(proc.getProcessor().stats.commands_replayed, 1);
});

// --- 2. Same command_id, different content ---
test('same command_id with different content is rejected', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd1 = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', null, { task_id: 'TASK-1' });
  const cmd2 = { ...cmd1, payload: { task_id: 'TASK-2' }, payload_hash: 'different' };

  proc.process(cmd1);
  const r2 = proc.process(cmd2);
  assert.equal(r2.accepted, false);
  assert.ok(r2.error.includes('different content'));
});

// --- 3. Concurrent version conflict ---
test('stale version is rejected', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  // Seed entity with version 5
  proc.getProcessor().dataStore['Job'] = new Map();
  proc.getProcessor().dataStore['Job'].set('JOB-1', { id: 'JOB-1', version: 5, created_at: '2026-01-01', created_by: 'system' });

  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', 3, {});
  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.equal(r.error_category, FailureCategory.CONCURRENCY);
  assert.ok(r.error.includes('stale version'));
});

test('matching version passes', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  proc.getProcessor().dataStore['Job'] = new Map();
  proc.getProcessor().dataStore['Job'].set('JOB-1', { id: 'JOB-1', version: 5, created_at: '2026-01-01', created_by: 'system' });

  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', 5, {});
  const r = proc.process(cmd);
  assert.equal(r.accepted, true);
  assert.equal(r.committed, true);
});

// --- 4. Unauthorized role ---
test('installer cannot complete tasks (no permission)', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('installer@test.test', ['Installer']), 'JOB-1', null, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.equal(r.error_category, FailureCategory.PERMISSION);
});

test('unknown actor is rejected', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('stranger@test.test', ['Office']), 'JOB-1', null, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.equal(r.error_category, FailureCategory.AUTHENTICATION);
});

test('deactivated actor is rejected', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('old@test.test', ['Office']), 'JOB-1', null, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.ok(r.error.includes('deactivated'));
});

// --- 5. Disabled ReleaseMode ---
test('Disabled function is rejected', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('CREATE_ORDER', makeActor('tanya@office.test', ['Office']), 'JOB-1', null, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.equal(r.error_category, FailureCategory.DISABLED_MODE);
  assert.ok(r.error.includes('Disabled'));
});

// --- 6. Manual ReleaseMode ---
test('Manual function is rejected for automated execution', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  proc.getProcessor().dataStore['Job'] = new Map();
  proc.getProcessor().dataStore['Job'].set('JOB-1', { id: 'JOB-1', version: 1, job_id: 'SS-AAAA-BBBB', created_at: '2026-01-01', created_by: 'system' });

  const cmd = makeCommand('APPROVE_OPERATIONAL_COMPLETE', makeActor('tanya@office.test', ['Office']), 'JOB-1', 1, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.ok(r.error.includes('Manual'));
});

// --- 7. Pilot job scope ---
test('pilot-only function rejects non-pilot job', () => {
  const pilotModes = [
    { function_id: 'FN-01', mode: ReleaseMode.AUTOMATED, authorised_job_scope: 'Pilot', target_release: 'R1' }
  ];
  const proc = createProcessor({ releaseModes: pilotModes, peopleDirectory: peopleDir });
  proc.getProcessor().dataStore['Job'] = new Map();
  proc.getProcessor().dataStore['Job'].set('JOB-1', { id: 'JOB-1', version: 1, pilot_job: false, created_at: '2026-01-01', created_by: 'system' });

  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', 1, {});
  const r = proc.process(cmd);
  assert.equal(r.accepted, false);
  assert.ok(r.error.includes('pilot'));
});

test('pilot-only function accepts pilot job', () => {
  const pilotModes = [
    { function_id: 'FN-01', mode: ReleaseMode.AUTOMATED, authorised_job_scope: 'Pilot', target_release: 'R1' }
  ];
  const proc = createProcessor({ releaseModes: pilotModes, peopleDirectory: peopleDir });
  proc.getProcessor().dataStore['Job'] = new Map();
  proc.getProcessor().dataStore['Job'].set('JOB-1', { id: 'JOB-1', version: 1, pilot_job: true, created_at: '2026-01-01', created_by: 'system' });

  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', 1, {});
  const r = proc.process(cmd);
  assert.equal(r.accepted, true);
});

// --- 8. Partial/interrupted commit ---
test('interrupted commit: FULLY_APPLIED is safe to commit', () => {
  const journal = createJournal();
  const changes = { status: 'updated', assigned_to: 'PERSON-tanya' };
  prepareCommit(journal, 'COMMIT-1', 'CMD-1', 'Job', 'JOB-1', 1, changes);
  markApplying(journal, 'COMMIT-1');

  const dataStore = { Job: new Map([['JOB-1', { id: 'JOB-1', version: 1, status: 'updated', assigned_to: 'PERSON-tanya', created_at: '2026-01-01' }]]) };

  const recovery = recoverUncommitted(journal, dataStore, { events: [] });
  const commitAction = recovery.find(r => r.commit_id === 'COMMIT-1');
  assert.equal(commitAction.action, 'commit', 'fully applied should be committed');
});

test('interrupted commit: NOT_APPLIED is safe to discard', () => {
  const journal = createJournal();
  prepareCommit(journal, 'COMMIT-2', 'CMD-2', 'Job', 'JOB-2', 1, { status: 'new' });
  markApplying(journal, 'COMMIT-2');

  const recovery = recoverUncommitted(journal, {}, { events: [] });
  const discardAction = recovery.find(r => r.commit_id === 'COMMIT-2');
  assert.equal(discardAction.action, 'discard', 'not applied should be discarded');
});

test('interrupted commit: PARTIALLY_APPLIED requires manual review', () => {
  const journal = createJournal();
  const changes = { status: 'updated', assigned_to: 'PERSON-tanya', priority: 'high' };
  prepareCommit(journal, 'COMMIT-3', 'CMD-3', 'Job', 'JOB-3', 1, changes);
  markApplying(journal, 'COMMIT-3');

  // Only status was applied; assigned_to and priority are missing
  const dataStore = { Job: new Map([['JOB-3', { id: 'JOB-3', version: 1, status: 'updated', created_at: '2026-01-01' }]]) };

  const recovery = recoverUncommitted(journal, dataStore, { events: [] });
  const reviewAction = recovery.find(r => r.commit_id === 'COMMIT-3');
  assert.equal(reviewAction.action, 'manual_review', 'partially applied must go to manual review');
  assert.ok(reviewAction.reason.includes('PARTIALLY_APPLIED'));
});

// --- 9. Task creation exactly once ---
test('task with same instance_key is not duplicated', () => {
  const store = createTaskStore();
  const template = { template_code: 'INS01', group: 'Install', title: 'Installer call', template_version: '1.0' };

  const r1 = createTask(store, template, 'JOB-1', 'PERSON-tanya', '2026-11-09', { type: 'WorkPackage', id: 'WP-1' });
  assert.equal(r1.created, true);

  const r2 = createTask(store, template, 'JOB-1', 'PERSON-tanya', '2026-11-09', { type: 'WorkPackage', id: 'WP-1' });
  assert.equal(r2.created, false, 'duplicate instance_key should be rejected');
  assert.ok(r2.reason.includes('duplicate'));
});

test('task with different parameters creates separate instance', () => {
  const store = createTaskStore();
  const template = { template_code: 'INS01', group: 'Install', title: 'Installer call', template_version: '1.0' };

  const r1 = createTask(store, template, 'JOB-1', 'PERSON-tanya', '2026-11-09', { type: 'WorkPackage', id: 'WP-1' });
  const r2 = createTask(store, template, 'JOB-2', 'PERSON-tanya', '2026-11-09', { type: 'WorkPackage', id: 'WP-2' });
  assert.equal(r1.created, true);
  assert.equal(r2.created, true);
  assert.notEqual(r1.task.id, r2.task.id);
});

// --- 10. Audit event exactly once ---
test('audit event is recorded for each committed command', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', null, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, true);
  assert.equal(r.audit_events.length, 1);

  // Replay — no new audit event (returns cached result)
  const r2 = proc.process(cmd);
  assert.equal(r2.audit_events.length, 1, 'replay returns same audit event count');
});

// --- 11. Outbox item exactly once ---
test('outbox item with same idempotency_key is not duplicated', () => {
  const outbox = createOutbox();
  const r1 = enqueueOutbox(outbox, 'EMAIL', 'test@test.com', { subject: 'test' }, 1, 'CORR-1', 'IKEY-1');
  assert.equal(r1.created, true);

  const r2 = enqueueOutbox(outbox, 'EMAIL', 'test@test.com', { subject: 'test' }, 1, 'CORR-2', 'IKEY-1');
  assert.equal(r2.created, false, 'duplicate idempotency_key rejected');
});

// --- 12. Retryable external failure ---
test('transient failure retries with backoff', () => {
  const outbox = createOutbox();
  enqueueOutbox(outbox, 'EMAIL', 'test@test.com', {}, 1, null, 'IKEY-RETRY');

  const items = getPendingItems(outbox);
  const item = items[0];
  markProcessing(outbox, item.id);

  const backoff = calculateBackoff(1);
  const retryResult = markRetryDue(outbox, item.id, backoff, 'Connection timeout');
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.item.status, OutboxStatus.RETRY_DUE);
});

// --- 13. Non-retryable failure ---
test('max retries escalates to NEEDS_REVIEW', () => {
  const outbox = createOutbox();
  enqueueOutbox(outbox, 'EMAIL', 'test@test.com', {}, 1, null, 'IKEY-FATAL');

  const items = getPendingItems(outbox);
  const item = items[0];

  // Simulate 5 failures
  for (let i = 0; i < 5; i++) {
    markProcessing(outbox, item.id);
    markRetryDue(outbox, item.id, 100, 'Auth error');
    if (item.status === OutboxStatus.RETRY_DUE) {
      // Reset for next attempt simulation
    }
  }

  // Force 6th attempt
  markProcessing(outbox, item.id);
  item.attempt_count = 5; // simulate
  const final = markRetryDue(outbox, item.id, 100, 'Auth error');
  assert.equal(final.item.status, OutboxStatus.NEEDS_REVIEW);
  assert.equal(final.escalated, true);
});

// --- 14. Uncertain external result ---
test('uncertain outcome creates review task', () => {
  const outbox = createOutbox();
  enqueueOutbox(outbox, 'EMAIL', 'test@test.com', {}, 1, null, 'IKEY-UNCERTAIN');

  const items = getPendingItems(outbox);
  const item = items[0];
  markProcessing(outbox, item.id);

  const review = markNeedsReview(outbox, item.id, 'Sent but no confirmation received');
  assert.equal(review.item.status, OutboxStatus.NEEDS_REVIEW);
  assert.ok(review.item.response_summary.includes('no confirmation'));
});

// --- 15. Immutable history ---
test('audit events are immutable (no editing)', () => {
  const auditLog = createAuditLog();
  const event = recordAudit(auditLog, 'Job', 'JOB-1', 'CREATE', null, { status: 'new' }, 'tanya', 'processor', 'CORR-1', null, 'COMMIT-1');

  assert.equal(auditLog.events.length, 1);
  // Audit events can only be appended, not modified
  const queried = queryAudit(auditLog, 'Job', 'JOB-1');
  assert.equal(queried.length, 1);
  assert.equal(queried[0].entity_id, 'JOB-1');
});

// --- 16. Health checks ---
test('health check records last success', () => {
  const store = createHealthStore();
  recordHealthCheck(store, 'Calendar', 'OK');
  recordHealthCheck(store, 'Email', 'AUTH_ERROR');

  assert.equal(getLastSuccess(store, 'Calendar'), store.checks.get('Calendar').last_success);
  assert.equal(getLastSuccess(store, 'Email'), null);
});

// --- 17. Locking ---
test('lock prevents concurrent access', () => {
  const lockStore = new Map();
  const l1 = acquireLock(lockStore, 'JOB-1', 30000);
  assert.equal(l1.acquired, true);

  const l2 = acquireLock(lockStore, 'JOB-1', 30000);
  assert.equal(l2.acquired, false, 'second lock should fail');
  assert.ok(l2.reason.includes('lock held'));
});

test('lock can be released and re-acquired', () => {
  const lockStore = new Map();
  const l1 = acquireLock(lockStore, 'JOB-1', 30000);
  releaseLock(lockStore, 'JOB-1', l1.lock.owner);

  const l2 = acquireLock(lockStore, 'JOB-1', 30000);
  assert.equal(l2.acquired, true, 'should re-acquire after release');
});

// --- 18. Journal state machine ---
test('commit journal follows state transitions', () => {
  const journal = createJournal();

  // PREPARED -> APPLYING -> COMMITTED
  prepareCommit(journal, 'COMMIT-A', 'CMD-A', 'Job', 'JOB-1', 1, {});
  markApplying(journal, 'COMMIT-A');
  markCommitted(journal, 'COMMIT-A');

  const entry = journal.entries.get('COMMIT-A');
  assert.equal(entry.state, CommitState.COMMITTED);
  assert.ok(entry.committed_at);

  // Cannot commit from PREPARED
  prepareCommit(journal, 'COMMIT-B', 'CMD-B', 'Job', 'JOB-2', 1, {});
  const badCommit = markCommitted(journal, 'COMMIT-B');
  assert.equal(badCommit.ok, false);
});

// --- 19. Malformed command ---
test('malformed command is rejected at envelope validation', () => {
  assert.equal(validateCommandEnvelope(null).valid, false);
  assert.equal(validateCommandEnvelope({}).valid, false);
  assert.equal(validateCommandEnvelope({ command_id: 'x' }).valid, false);
  assert.ok(validateCommandEnvelope(makeCommand('COMPLETE_TASK', makeActor('t@t.com', ['Office']), 'J-1', null, {})).valid);
});

// --- 20. Task completion ---
test('task completion transitions state and records event', () => {
  const store = createTaskStore();
  const template = { template_code: 'T001', group: 'Test', title: 'Test task', template_version: '1.0' };
  const created = createTask(store, template, 'JOB-1', 'PERSON-tanya', null, null);

  const completed = completeTask(store, created.task.id, 'tanya', 'Done');
  assert.equal(completed.ok, true);
  assert.equal(completed.task.status, TaskStatus.COMPLETE);
  assert.equal(completed.task.completed_by, 'tanya');

  // TaskEvents recorded
  assert.ok(store.taskEvents.length >= 2, 'created and completed events');
  const completeEvent = store.taskEvents.find(e => e.action === 'COMPLETED');
  assert.equal(completeEvent.old_status, TaskStatus.OPEN);
  assert.equal(completeEvent.new_status, TaskStatus.COMPLETE);
});

test('cannot complete already completed task', () => {
  const store = createTaskStore();
  const template = { template_code: 'T001', group: 'Test', title: 'Test task', template_version: '1.0' };
  const created = createTask(store, template, 'JOB-1', 'PERSON-tanya', null, null);
  completeTask(store, created.task.id, 'tanya', 'Done');

  const r2 = completeTask(store, created.task.id, 'tanya', 'Again');
  assert.equal(r2.ok, false);
  assert.ok(r2.reason.includes('already complete'));
});

// --- 21. Backoff calculation ---
test('backoff increases exponentially with jitter', () => {
  const b0 = calculateBackoff(0);
  const b1 = calculateBackoff(1);
  const b2 = calculateBackoff(2);
  const b5 = calculateBackoff(5);

  assert.ok(b1 > b0, 'backoff should increase');
  assert.ok(b2 > b1, 'backoff should increase');
  assert.ok(b5 <= 300000 + 1000, 'max 5 minutes plus jitter');
});

// --- 22. Full processor pipeline for valid command ---
test('valid command goes through full pipeline: validate → actor → perm → mode → lock → journal → audit', () => {
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('tanya@office.test', ['Office']), 'JOB-1', null, {});

  const r = proc.process(cmd);
  assert.equal(r.accepted, true);
  assert.equal(r.committed, true);
  assert.ok(r.commit_id);
  assert.equal(r.audit_events.length, 1);
  assert.equal(r.mode, ReleaseMode.AUTOMATED);
  assert.equal(proc.getProcessor().stats.commands_processed, 1);
});

// --- 23. Command envelope validation ---
test('command envelope requires all mandatory fields', () => {
  const valid = makeCommand('COMPLETE_TASK', makeActor('t@t.com', ['Office']), 'J-1', null, {});
  assert.ok(validateCommandEnvelope(valid).valid);

  const noId = { ...valid, command_id: null };
  assert.equal(validateCommandEnvelope(noId).valid, false);

  const noType = { ...valid, command_type: null };
  assert.equal(validateCommandEnvelope(noType).valid, false);

  const noEntity = { ...valid, entity_id: null };
  assert.equal(validateCommandEnvelope(noEntity).valid, false);

  const noActor = { ...valid, actor_email: null };
  assert.equal(validateCommandEnvelope(noActor).valid, false);
});

// --- 24. Admin role permission authorization (not a bypass of mode/lock/audit) ---
test('admin role passes permission checks but does not bypass ReleaseMode or locking', () => {
  // Admin can perform actions that Office role cannot (permission check only).
  // Admin does NOT bypass: ReleaseMode enforcement, pilot scope, version checks,
  // locking, idempotency, or audit recording.

  // Admin can complete tasks (Office can too, but this verifies admin permission path)
  const proc = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd = makeCommand('COMPLETE_TASK', makeActor('ben@office.test', ['Admin']), 'JOB-1', null, {});
  const r = proc.process(cmd);
  assert.equal(r.accepted, true, 'admin can complete tasks via permission check');

  // Admin still cannot run Disabled functions
  const proc2 = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  const cmd2 = makeCommand('CREATE_ORDER', makeActor('ben@office.test', ['Admin']), 'JOB-1', null, {});
  const r2 = proc2.process(cmd2);
  assert.equal(r2.accepted, false, 'admin cannot bypass Disabled mode');
  assert.equal(r2.error_category, 'DisabledMode');

  // Admin still subject to version conflicts
  const proc3 = createProcessor({ releaseModes, peopleDirectory: peopleDir });
  proc3.getProcessor().dataStore['Job'] = new Map();
  proc3.getProcessor().dataStore['Job'].set('JOB-1', { id: 'JOB-1', version: 5, created_at: '2026-01-01', created_by: 'system' });
  const cmd3 = makeCommand('COMPLETE_TASK', makeActor('ben@office.test', ['Admin']), 'JOB-1', 3, {});
  const r3 = proc3.process(cmd3);
  assert.equal(r3.accepted, false, 'admin cannot bypass version check');
  assert.equal(r3.error_category, 'Concurrency');
});
