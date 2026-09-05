/* S03 processor — Task creation, deduplication, and TaskEvents.
 * Authority: 01 §6 task rules; §4 Tasks, TaskEvents. */

const { TaskStatus } = require('./types.js');

function createTaskStore() {
  const tasks = new Map();
  const taskEvents = [];
  return { tasks, taskEvents };
}

function generateTaskId() {
  return 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function createTask(taskStore, template, jobId, ownerId, dueAt, relatedEntity, clock) {
  // Build instance_key for deduplication
  const instanceKey = template.template_code + '-' + (jobId || 'SYS') + '-' +
    (relatedEntity ? relatedEntity.type + '-' + relatedEntity.id : 'ROOT') + '-' +
    (dueAt || 'nodue');

  // Check for existing task with same instance_key
  for (const [, existing] of taskStore.tasks) {
    if (existing.instance_key === instanceKey &&
        existing.status !== TaskStatus.CANCELLED &&
        existing.status !== TaskStatus.COMPLETE) {
      return { created: false, reason: 'duplicate instance_key: ' + instanceKey, existing };
    }
  }

  const now = clock ? clock.nowISO() : new Date().toISOString();
  const task = {
    id: generateTaskId(),
    job_id: jobId || null,
    template_code: template.template_code,
    instance_key: instanceKey,
    group: template.group,
    title: template.title,
    owner_id: ownerId || null,
    backup_id: null,
    related_entity_type: relatedEntity ? relatedEntity.type : null,
    related_entity_id: relatedEntity ? relatedEntity.id : null,
    due_at: dueAt || null,
    original_due_at: dueAt || null,
    priority: 0,
    status: TaskStatus.OPEN,
    blocking_reason: null,
    next_followup_at: null,
    completed_at: null,
    completed_by: null,
    completion_note: null,
    evidence_id: null,
    revision_required: false,
    created_rule_version: template.template_version || '1.0',
    created_at: now,
    created_by: 'processor',
    updated_at: now,
    updated_by: 'processor',
    version: 1,
    source_system: 'processor',
    commit_id: null
  };

  taskStore.tasks.set(task.id, task);

  recordTaskEvent(taskStore, task.id, 'CREATED', null, task.status, null, task.owner_id, null, task.due_at, 'processor');

  return { created: true, task };
}

function completeTask(taskStore, taskId, actor, note, clock) {
  const task = taskStore.tasks.get(taskId);
  if (!task) return { ok: false, reason: 'task not found: ' + taskId };
  if (task.status === TaskStatus.COMPLETE) return { ok: false, reason: 'task already complete' };
  if (task.status === TaskStatus.CANCELLED) return { ok: false, reason: 'task is cancelled' };

  const oldStatus = task.status;
  const now = clock ? clock.nowISO() : new Date().toISOString();

  task.status = TaskStatus.COMPLETE;
  task.completed_at = now;
  task.completed_by = actor;
  task.completion_note = note || null;
  task.updated_at = now;
  task.updated_by = actor;
  task.version++;

  recordTaskEvent(taskStore, taskId, 'COMPLETED', oldStatus, task.status, null, null, null, null, actor);
  return { ok: true, task };
}

function recordTaskEvent(taskStore, taskId, action, oldStatus, newStatus, oldOwner, newOwner, oldDue, newDue, actor) {
  const event = {
    id: 'TEVT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    task_id: taskId,
    action,
    old_status: oldStatus,
    new_status: newStatus,
    old_owner: oldOwner,
    new_owner: newOwner,
    old_due: oldDue,
    new_due: newDue,
    reason: null,
    actor,
    timestamp: new Date().toISOString(),
    created_at: new Date().toISOString(),
    commit_id: null
  };
  taskStore.taskEvents.push(event);
  return event;
}

function getTaskByInstanceKey(taskStore, instanceKey) {
  for (const [, task] of taskStore.tasks) {
    if (task.instance_key === instanceKey) return task;
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { createTaskStore, createTask, completeTask, recordTaskEvent, getTaskByInstanceKey, generateTaskId };
}
