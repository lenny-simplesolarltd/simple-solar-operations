/* S03 processor — AuditEvents for immutable history.
 * Authority: 01 §4 AuditEvents, §3 authentication and privacy. */

function createAuditLog() {
  const events = [];
  return { events };
}

function recordAudit(auditLog, entityType, entityId, action, before, after, actor, executingService, correlationId, reason, commitId) {
  const event = {
    id: 'AEVT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    entity_type: entityType,
    entity_id: entityId,
    action,
    before_json: before ? JSON.stringify(before) : null,
    after_json: after ? JSON.stringify(after) : null,
    initiating_actor: actor,
    executing_service: executingService || 'processor',
    timestamp: new Date().toISOString(),
    correlation_id: correlationId || null,
    reason: reason || null,
    commit_id: commitId,
    created_at: new Date().toISOString()
  };
  auditLog.events.push(event);
  return event;
}

function queryAudit(auditLog, entityType, entityId) {
  return auditLog.events.filter(e =>
    e.entity_type === entityType && e.entity_id === entityId
  );
}

if (typeof module !== 'undefined') {
  module.exports = { createAuditLog, recordAudit, queryAudit };
}
