/* S03 processor — type definitions, constants, and enums.
 * Authority: 01 §3, §4; RA01 §9. */

const CommandType = Object.freeze({
  COMPLETE_TASK: 'COMPLETE_TASK',
  RECORD_CALL: 'RECORD_CALL',
  RAISE_ISSUE: 'RAISE_ISSUE',
  MOVE_JOB: 'MOVE_JOB',
  CHANGE_INSTALLER: 'CHANGE_INSTALLER',
  CANCEL_JOB: 'CANCEL_JOB',
  APPROVE_OPERATIONAL_COMPLETE: 'APPROVE_OPERATIONAL_COMPLETE',
  CREATE_ORDER: 'CREATE_ORDER',
  RECEIVE_DELIVERY: 'RECEIVE_DELIVERY',
  STOCK_MOVEMENT: 'STOCK_MOVEMENT',
  SUBMIT_COMMISSIONING: 'SUBMIT_COMMISSIONING',
  REVIEW_COMMISSIONING: 'REVIEW_COMMISSIONING',
  SEND_COMMUNICATION: 'SEND_COMMUNICATION',
  RECONCILE: 'RECONCILE',
  HEALTH_CHECK: 'HEALTH_CHECK',
  PROCESS_INTAKE: 'PROCESS_INTAKE'
});

const ReleaseMode = Object.freeze({
  DISABLED: 'Disabled',
  MANUAL: 'Manual',
  AUTOMATED: 'Automated'
});

const CommitState = Object.freeze({
  PREPARED: 'Prepared',
  APPLYING: 'Applying',
  COMMITTED: 'Committed',
  RECOVERY_REQUIRED: 'RecoveryRequired'
});

const OutboxStatus = Object.freeze({
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Succeeded',
  RETRY_DUE: 'RetryDue',
  NEEDS_REVIEW: 'NeedsReview',
  CANCELLED: 'Cancelled'
});

const TaskStatus = Object.freeze({
  BLOCKED: 'Blocked',
  OPEN: 'Open',
  IN_PROGRESS: 'InProgress',
  WAITING: 'Waiting',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
  NOT_REQUIRED: 'NotRequired'
});

const JobStage = Object.freeze({
  PREBOOKING: 'Prebooking',
  READY_TO_BOOK: 'ReadyToBook',
  BOOKING_IN_PROGRESS: 'BookingInProgress',
  BOOKED: 'Booked',
  AWAITING_INSTALLATION: 'AwaitingInstallation',
  IN_PROGRESS: 'InProgress',
  AFTERCARE: 'Aftercare',
  OPERATIONALLY_COMPLETE: 'OperationallyComplete',
  CANCELLATION_IN_PROGRESS: 'CancellationInProgress',
  CANCELLED: 'Cancelled'
});

const ActorRole = Object.freeze({
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  OFFICE: 'Office',
  FINANCE: 'Finance',
  STORE: 'Store',
  INSTALLER: 'Installer',
  SCAFFOLDER: 'Scaffolder',
  READ_ONLY: 'ReadOnly'
});

const FailureCategory = Object.freeze({
  VALIDATION: 'Validation',
  PERMISSION: 'Permission',
  CONCURRENCY: 'Concurrency',
  DISABLED_MODE: 'DisabledMode',
  PILOT_SCOPE: 'PilotScope',
  TRANSIENT: 'Transient',
  AUTHENTICATION: 'Authentication',
  UNCERTAIN: 'Uncertain',
  FATAL: 'Fatal'
});

function makeCommand(commandType, actor, entityId, expectedVersion, payload) {
  const ts = Date.now();
  const rawPayload = JSON.stringify(payload || {});
  return Object.freeze({
    command_id: 'CMD-' + ts.toString(36) + '-' + Math.random().toString(36).slice(2, 10),
    source: 'appsheet',
    actor_email: actor.email,
    actor_roles: [...actor.roles],
    entity_type: 'Job',
    entity_id: entityId,
    expected_version: expectedVersion || null,
    command_type: commandType,
    payload: Object.freeze({ ...payload }),
    submitted_at: new Date(ts).toISOString(),
    payload_hash: simpleHash(rawPayload)
  });
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'h' + (hash >>> 0).toString(16).padStart(8, '0');
}

function makeActor(email, roles, personId) {
  return Object.freeze({
    email,
    roles: Object.freeze([...roles]),
    person_id: personId || null
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    CommandType, ReleaseMode, CommitState, OutboxStatus, TaskStatus,
    JobStage, ActorRole, FailureCategory,
    makeCommand, makeActor, simpleHash
  };
}
