/* S03 processor — Main orchestrator.
 * Coordinates command validation, permission checking, mode enforcement,
 * locking, journal, audit, task creation, and outbox.
 * Authority: 01 §3; RA01. */

const { validateCommandEnvelope, checkIdempotency, recordProcessedCommand, validatePayload } = require('./command.js');
const { resolveActor, actorCanPerform } = require('./actor.js');
const { resolveEffectiveMode } = require('./modes.js');
const { checkVersion, incrementVersion, acquireLock, releaseLock } = require('./locking.js');
const { prepareCommit, markApplying, markCommitted } = require('./journal.js');
const { recordAudit } = require('./audit.js');
const { createTask } = require('./tasks.js');
const { enqueueOutbox } = require('./outbox.js');
const { recordHealthCheck } = require('./health.js');
const { ReleaseMode, FailureCategory, TaskStatus } = require('./types.js');

function createProcessor(options = {}) {
  const {
    releaseModes = [],
    peopleDirectory = [],
    journal = { entries: new Map() },
    auditLog = { events: [] },
    taskStore = { tasks: new Map(), taskEvents: [] },
    outbox = { items: new Map() },
    healthStore = { checks: new Map() },
    dataStore = {},
    lockStore = new Map(),
    processedCommands = new Map(),
    clock = null,
    commandSchema = null
  } = options;

  const processor = {
    releaseModes,
    peopleDirectory,
    journal,
    auditLog,
    taskStore,
    outbox,
    healthStore,
    dataStore,
    lockStore,
    processedCommands,
    clock,
    commandSchema,
    stats: { commands_processed: 0, commands_rejected: 0, commands_replayed: 0 }
  };

  return {
    process: (command) => processCommand(processor, command),
    getProcessor: () => processor
  };
}

function processCommand(proc, command) {
  const result = {
    command_id: command.command_id,
    accepted: false,
    committed: false,
    commit_id: null,
    tasks_created: [],
    outbox_items: [],
    audit_events: [],
    error: null,
    error_category: null,
    mode: null
  };

  try {
    // 1. Validate envelope
    const envCheck = validateCommandEnvelope(command);
    if (!envCheck.valid) {
      result.error = envCheck.reason;
      result.error_category = FailureCategory.VALIDATION;
      proc.stats.commands_rejected++;
      return result;
    }

    // 2. Check idempotency
    const idemCheck = checkIdempotency(command, proc.processedCommands);
    if (idemCheck.duplicate) {
      if (idemCheck.replay) {
        proc.stats.commands_replayed++;
        return idemCheck.originalResult;
      }
      result.error = idemCheck.reason;
      result.error_category = FailureCategory.VALIDATION;
      proc.stats.commands_rejected++;
      return result;
    }

    // 3. Resolve actor
    const actor = resolveActor(command.actor_email, proc.peopleDirectory);
    if (!actor.authenticated) {
      result.error = actor.reason;
      result.error_category = FailureCategory.AUTHENTICATION;
      proc.stats.commands_rejected++;
      return result;
    }

    // 4. Permission check
    const permCheck = actorCanPerform(actor, command.entity_type, command.command_type);
    if (!permCheck.allowed) {
      result.error = permCheck.reason;
      result.error_category = FailureCategory.PERMISSION;
      proc.stats.commands_rejected++;
      return result;
    }

    // 5. Validate payload against schema
    const schemaCheck = validatePayload(command, proc.commandSchema);
    if (!schemaCheck.valid) {
      result.error = schemaCheck.reason;
      result.error_category = FailureCategory.VALIDATION;
      proc.stats.commands_rejected++;
      return result;
    }

    // 6. ReleaseMode enforcement
    const functionId = mapCommandToFunction(command.command_type);
    const entity = proc.dataStore[command.entity_type]
      ? proc.dataStore[command.entity_type].get(command.entity_id)
      : null;

    const modeCheck = resolveEffectiveMode(functionId, proc.releaseModes, entity);
    result.mode = modeCheck.mode;
    if (!modeCheck.allowed) {
      result.error = modeCheck.reason;
      result.error_category = modeCheck.mode === ReleaseMode.DISABLED
        ? FailureCategory.DISABLED_MODE : FailureCategory.PILOT_SCOPE;
      proc.stats.commands_rejected++;
      return result;
    }

    // 7. Acquire lock
    const lock = acquireLock(proc.lockStore, command.entity_id, 30000);
    if (!lock.acquired) {
      result.error = lock.reason;
      result.error_category = FailureCategory.CONCURRENCY;
      proc.stats.commands_rejected++;
      return result;
    }

    try {
      // 8. Version check
      if (entity) {
        const versionCheck = checkVersion(command.expected_version, entity.version);
        if (!versionCheck.ok) {
          result.error = versionCheck.reason;
          result.error_category = FailureCategory.CONCURRENCY;
          proc.stats.commands_rejected++;
          return result;
        }
      }

      // 9. Prepare commit journal
      const commitId = 'COMMIT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const changes = computeChanges(command, entity);
      const prepResult = prepareCommit(proc.journal, commitId, command.command_id,
        command.entity_type, command.entity_id, command.expected_version, changes);

      if (!prepResult.ok) {
        result.error = prepResult.reason;
        result.error_category = FailureCategory.FATAL;
        proc.stats.commands_rejected++;
        return result;
      }

      // 10. Mark applying
      markApplying(proc.journal, commitId);

      // 11. Apply changes
      applyChanges(proc.dataStore, command.entity_type, command.entity_id, changes, command.actor_email, entity, proc.clock);

      // 12. Create tasks if applicable
      const taskResults = createTasksForCommand(proc.taskStore, command, entity, proc.clock);
      result.tasks_created = taskResults;

      // 13. Enqueue outbox items if applicable
      const outboxResults = createOutboxForCommand(proc.outbox, command, entity);
      result.outbox_items = outboxResults;

      // 14. Record audit
      const auditEvent = recordAudit(proc.auditLog, command.entity_type, command.entity_id,
        command.command_type,
        entity ? JSON.parse(JSON.stringify(entity)) : null,
        proc.dataStore[command.entity_type]
          ? JSON.parse(JSON.stringify(proc.dataStore[command.entity_type].get(command.entity_id)))
          : null,
        command.actor_email, 'processor', command.command_id, null, commitId);
      result.audit_events.push(auditEvent.id);

      // 15. Mark committed
      markCommitted(proc.journal, commitId);

      result.accepted = true;
      result.committed = true;
      result.commit_id = commitId;
      proc.stats.commands_processed++;

      // 16. Record processed command (after result is final)
      recordProcessedCommand(command, result, proc.processedCommands);

    } finally {
      releaseLock(proc.lockStore, command.entity_id, lock.lock.owner);
    }

  } catch (err) {
    result.error = err.message;
    result.error_category = FailureCategory.FATAL;
    proc.stats.commands_rejected++;
  }

  return result;
}

function mapCommandToFunction(commandType) {
  const map = {
    COMPLETE_TASK: 'FN-01',
    RECORD_CALL: 'FN-01',
    RAISE_ISSUE: 'FN-01',
    MOVE_JOB: 'FN-01',
    CHANGE_INSTALLER: 'FN-01',
    CANCEL_JOB: 'FN-01',
    APPROVE_OPERATIONAL_COMPLETE: 'FN-19',
    CREATE_ORDER: 'FN-03',
    RECEIVE_DELIVERY: 'FN-05',
    STOCK_MOVEMENT: 'FN-05',
    SUBMIT_COMMISSIONING: 'FN-07',
    REVIEW_COMMISSIONING: 'FN-07',
    SEND_COMMUNICATION: 'FN-02',
    RECONCILE: 'FN-14',
    HEALTH_CHECK: 'FN-16',
    PROCESS_INTAKE: 'FN-01'
  };
  return map[commandType] || 'FN-01';
}

function computeChanges(command, entity) {
  const changes = {};
  if (command.payload) {
    Object.assign(changes, command.payload);
  }
  if (entity) {
    changes._previous_version = entity.version;
  }
  return changes;
}

function applyChanges(dataStore, entityType, entityId, changes, actor, entity, clock) {
  if (!dataStore[entityType]) {
    dataStore[entityType] = new Map();
  }

  const now = clock ? clock.nowISO() : new Date().toISOString();
  const existing = dataStore[entityType].get(entityId);

  const record = {
    id: entityId,
    ...(existing || {}),
    ...changes,
    updated_at: now,
    updated_by: actor,
    version: existing ? (existing.version || 0) + 1 : 1,
    commit_id: null
  };

  // Don't overwrite immutable fields
  if (existing) {
    record.created_at = existing.created_at;
    record.created_by = existing.created_by;
  } else {
    record.created_at = now;
    record.created_by = actor;
  }

  dataStore[entityType].set(entityId, record);
}

function createTasksForCommand(taskStore, command, entity, clock) {
  const results = [];

  if (command.command_type === 'APPROVE_OPERATIONAL_COMPLETE') {
    const finTemplate = {
      template_code: 'FIN03',
      group: 'Finance',
      title: 'Balance invoice authorise/send',
      template_version: '1.0'
    };
    const taskResult = createTask(taskStore, finTemplate,
      entity ? entity.job_id : null,
      null, null, null, clock);
    if (taskResult.created) results.push(taskResult.task.id);
  }

  return results;
}

function createOutboxForCommand(outbox, command, entity) {
  const results = [];

  if (command.command_type === 'SEND_COMMUNICATION' && command.payload) {
    const obResult = enqueueOutbox(outbox,
      'EMAIL', command.payload.to || 'unknown',
      command.payload, null, command.command_id, null);
    if (obResult.created) results.push(obResult.item.id);
  }

  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { createProcessor, processCommand };
}
