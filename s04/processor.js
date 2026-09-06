/* Authoritative S04-only processor. Dependencies are injected server adapters,
 * never command fields. No generic S03 command endpoint is exported to cloud. */
const Journal = require('../processor/journal.js');
const { completeTask } = require('../processor/tasks.js');
const { checkApplicationStatus } = require('../processor/reconciler.js');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = value => JSON.parse(JSON.stringify(value));
function refuse(code) { const e = new Error(code); e.code = code; throw e; }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !allowed.includes(k))) refuse('INVALID_FIELDS');
}
function commandRequest(input) {
  keys(input, ['command_id', 'action', 'task_id', 'expected_version', 'payload', 'payload_hash']);
  for (const name of ['command_id', 'task_id']) {
    if (typeof input[name] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(input[name])) refuse('INVALID_' + name.toUpperCase());
  }
  if (input.action !== 'COMPLETE_TASK') refuse('ACTION_DENIED');
  if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1 || input.expected_version >= Number.MAX_SAFE_INTEGER) refuse('INVALID_VERSION');
  keys(input.payload, ['completion_note']);
  if (typeof input.payload.completion_note !== 'string' || input.payload.completion_note.length > 2000) refuse('INVALID_PAYLOAD');
  return { command_id: input.command_id, action: input.action, task_id: input.task_id,
    expected_version: input.expected_version, payload: { completion_note: input.payload.completion_note } };
}
function active(value) { return value === true; }
function one(rows, code) { if (rows.length !== 1) refuse(code); return rows[0]; }
function guard(options) {
  const c = options.config;
  if (!c || c.environment !== 'DEV') refuse('DEV_ONLY');
  if (c.sheetId !== DEV_SHEET_ID || options.store.getSheetId() !== c.sheetId) refuse('SHEET_ID_MISMATCH');
  if (!c.projectId || options.projectId() !== c.projectId) refuse('PROJECT_ID_MISMATCH');
}
function resolveActor(store, identity) {
  if (!identity || typeof identity.email !== 'string' || !identity.email.trim()) refuse('TRUSTED_IDENTITY_REQUIRED');
  const email = identity.email.trim().toLowerCase();
  const person = one(store.list('People').filter(p => typeof p.email === 'string' && p.email.trim().toLowerCase() === email), 'UNKNOWN_OR_DUPLICATE_ACTOR');
  if (!active(person.active)) refuse('INACTIVE_ACTOR');
  const roles = store.list('PersonRoles').filter(r => r.person_id === person.id && active(r.active)).map(r => r.role);
  if (!roles.length) refuse('NO_ACTIVE_ROLE');
  return { id: person.id, email, roles };
}
function permission(store, actor, task) {
  const rules = store.list('PermissionRules').filter(r => actor.roles.includes(r.role) &&
    ['CompleteTask', '*'].includes(r.action) && ['Tasks', '*'].includes(r.entity));
  let allowed = false;
  for (const rule of rules) {
    if (!['All', 'Assigned'].includes(rule.scope) || typeof rule.allowed !== 'boolean') refuse('INVALID_PERMISSION_RULE');
    const applies = rule.scope === 'All' || task.owner_id === actor.id || task.backup_id === actor.id;
    if (applies && !rule.allowed) refuse('PERMISSION_DENIED');
    if (applies && rule.allowed) allowed = true;
  }
  if (!allowed) refuse('PERMISSION_DENIED');
}
function gates(store, actor, task) {
  if (!task) refuse('TASK_NOT_FOUND');
  permission(store, actor, task);
  const mode = one(store.list('ReleaseModes').filter(r => r.function_id === 'FN-01'), 'MODE_MISSING_OR_DUPLICATE');
  if (mode.mode !== 'Automated') refuse('MODE_DENIED');
  if (mode.authorised_job_scope !== 'Pilot' || mode.target_release !== 'R1') refuse('PILOT_SCOPE_DENIED');
  const job = store.get('Jobs', task.job_id);
  if (!job) refuse('JOB_NOT_FOUND');
  if (!active(job.pilot_job) || job.release_scope !== 'R1') refuse('OUTSIDE_PILOT');
  // Explicit synthetic fixture boundary prevents FN-01 enabling real office tasks.
  if (task.template_code !== 'S04-DEV-COMPLETE' || task.source_system !== 'S04-synthetic' || job.source_system !== 'S04-synthetic') refuse('SYNTHETIC_SCOPE_REQUIRED');
}
function completable(store, task, request) {
  if (task.version !== request.expected_version) refuse('STALE_VERSION');
  if (!['Open', 'InProgress', 'Waiting'].includes(task.status)) refuse('TASK_STATE_DENIED');
  if (task.blocking_reason || task.revision_required !== false) refuse('TASK_BLOCKED');
  if (store.list('TaskDependencies').some(d => d.task_id === task.id && !d.satisfied_at)) refuse('TASK_DEPENDENCY_UNSATISFIED');
}
function persistJournal(store, row, plan) {
  row.changes_json = JSON.stringify(plan);
  if (row.changes_json.length > 45000) refuse('JOURNAL_TOO_LARGE');
  store.update('CommitJournal', row.id, row);
}
function transition(store, row, plan, action, now) {
  const journal = { entries: new Map([[row.commit_id, row]]) };
  const outcome = Journal[action](journal, row.commit_id);
  if (!outcome.ok) refuse('JOURNAL_TRANSITION_INVALID');
  if (action === 'markCommitted') row.committed_at = now();
  persistJournal(store, row, plan);
}
function same(a, b) { return canonical(a) === canonical(b); }
function classify(store, plan) {
  const actualTask = store.get('Tasks', plan.before.id);
  const event = store.get('TaskEvents', plan.task_event.id);
  const audit = store.get('AuditEvents', plan.audit_event.id);
  // Reuse S03 field classification, strengthened with exact full-row and event checks.
  const taskClass = checkApplicationStatus({ Tasks: new Map([[plan.before.id, actualTask]]) }, 'Tasks', plan.before.id, plan.after);
  if (taskClass === 'FULLY_APPLIED' && same(actualTask, plan.after) && same(event, plan.task_event) && same(audit, plan.audit_event)) return 'FULLY_APPLIED';
  if (same(actualTask, plan.before) && !event && !audit) return 'NOT_APPLIED';
  return 'PARTIALLY_APPLIED';
}
function createProcessor(options) {
  function process(input) {
    let locked = false, started = false;
    try {
      guard(options);
      const request = commandRequest(input);
      // Identity provider is installed server-side and verifies transport proof.
      const identity = options.actorProvider.getIdentity(request);
      resolveActor(options.store, identity);
      if (!options.lock.acquire()) refuse('LOCK_BUSY');
      locked = true;
      guard(options);
      const store = options.store;
      const actor = resolveActor(store, identity); // Re-resolve permissions/roles under lock.
      const task = store.get('Tasks', request.task_id); // Never rely on a pre-lock version.
      gates(store, actor, task);
      const canonicalRequest = canonical({ request, actor: { id: actor.id, email: actor.email } });
      const hash = options.sha256(canonicalRequest);
      const rows = store.list('CommitJournal');
      const matches = rows.filter(r => r.command_id === request.command_id);
      if (matches.length > 1) refuse('DUPLICATE_COMMAND_JOURNAL');
      let row = matches[0], plan;
      if (row) {
        plan = JSON.parse(row.changes_json);
        if (plan.contract !== 'S04-1' || plan.canonical_request !== canonicalRequest || plan.request_hash !== hash) refuse('COMMAND_ID_CONFLICT');
        if (row.state === 'Committed' && plan.result) return clone(plan.result);
        if (!['Prepared', 'Applying'].includes(row.state)) refuse('RECOVERY_REQUIRED');
        const classification = classify(store, plan);
        plan.recovery_classification = classification;
        if (classification === 'FULLY_APPLIED') {
          started = true;
          plan.result = plan.intended_result;
          if (row.state === 'Prepared') transition(store, row, plan, 'markApplying');
          transition(store, row, plan, 'markCommitted', options.now);
          return clone(plan.result);
        }
        if (classification === 'PARTIALLY_APPLIED') {
          transition(store, row, plan, 'markRecoveryRequired');
          refuse('RECOVERY_REQUIRED');
        }
      }
      // Any unresolved older command on the target prevents another command applying.
      if (rows.some(r => r.entity_type === 'Tasks' && r.entity_id === task.id && r.command_id !== request.command_id && r.state !== 'Committed')) refuse('RECOVERY_REQUIRED');
      completable(store, task, request);
      if (!row) {
        const time = options.now();
        const commitId = 'S04-' + options.sha256(request.command_id);
        const isolated = { tasks: new Map([[task.id, clone(task)]]), taskEvents: [] };
        const completion = completeTask(isolated, task.id, actor.id, request.payload.completion_note, { nowISO: () => time });
        if (!completion.ok) refuse('TASK_STATE_DENIED');
        const after = completion.task;
        after.commit_id = commitId;
        const taskEvent = isolated.taskEvents[0];
        Object.assign(taskEvent, { id: 'TE-' + commitId, actor: actor.id, timestamp: time, created_at: time, reason: request.payload.completion_note || null, commit_id: commitId });
        const auditEvent = { id: 'AE-' + commitId, entity_type: 'Tasks', entity_id: task.id,
          action: 'COMPLETE_TASK', before_json: JSON.stringify(task), after_json: JSON.stringify(after),
          initiating_actor: actor.id, executing_service: 'S04-DEV', timestamp: time,
          correlation_id: request.command_id, reason: request.payload.completion_note || null,
          commit_id: commitId, created_at: time };
        if (store.get('TaskEvents', taskEvent.id) || store.get('AuditEvents', auditEvent.id)) refuse('ORPHAN_EVENT_REQUIRES_REVIEW');
        const intended = { status: 'Committed', accepted: true, committed: true, command_id: request.command_id,
          task_id: task.id, version: after.version, commit_id: commitId, task_event_id: taskEvent.id, audit_event_id: auditEvent.id };
        plan = { contract: 'S04-1', request, actor: { id: actor.id, email: actor.email }, canonical_request: canonicalRequest,
          request_hash: hash, before: task, after, task_event: taskEvent, audit_event: auditEvent, intended_result: intended, result: null };
        const localJournal = Journal.createJournal();
        row = Journal.prepareCommit(localJournal, commitId, request.command_id, 'Tasks', task.id, request.expected_version, plan).entry;
        Object.assign(row, { id: commitId, created_at: time, prepared_at: time });
        if (row.changes_json.length > 45000) refuse('JOURNAL_TOO_LARGE');
        started = true;
        store.insert('CommitJournal', row);
      } else {
        // NOT_APPLIED: old task and absence of both events were verified exactly.
        // Reuse the same durable plan/IDs, after rechecking current gates/version.
        started = true;
        row.state = 'Prepared';
        persistJournal(store, row, plan);
      }
      transition(store, row, plan, 'markApplying');
      store.update('Tasks', task.id, plan.after);
      store.insert('TaskEvents', plan.task_event);
      store.insert('AuditEvents', plan.audit_event);
      plan.result = plan.intended_result;
      transition(store, row, plan, 'markCommitted', options.now); // Result and terminal state in one row write.
      return clone(plan.result);
    } catch (e) {
      return { status: started ? 'Pending' : 'Failed', accepted: false, committed: false,
        error: e.code || (started ? 'INTERRUPTED_RETRY_SAME_COMMAND' : 'PROCESSOR_ERROR') };
    } finally {
      if (locked) options.lock.release();
    }
  }
  return { process };
}
module.exports = { createProcessor, commandRequest, canonical, DEV_SHEET_ID, classify };
