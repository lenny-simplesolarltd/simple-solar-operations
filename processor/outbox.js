/* S03 processor — Outbox queue with retry and uncertain outcome handling.
 * Authority: 01 §3 outbox and delivery certainty. */

const { OutboxStatus, FailureCategory } = require('./types.js');

function createOutbox() {
  const items = new Map();
  return { items };
}

function generateOutboxId() {
  return 'OUT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function enqueueOutbox(outbox, actionType, target, payload, jobRevision, correlationId, idempotencyKey) {
  const ikey = idempotencyKey || generateOutboxId();

  // Idempotency: check if this key already exists
  for (const [, item] of outbox.items) {
    if (item.idempotency_key === ikey &&
        item.status !== OutboxStatus.CANCELLED) {
      return { created: false, reason: 'duplicate idempotency_key: ' + ikey, existing: item };
    }
  }

  const item = {
    id: generateOutboxId(),
    idempotency_key: ikey,
    action_type: actionType,
    target,
    payload_hash: simpleHashStr(JSON.stringify(payload)),
    payload: JSON.parse(JSON.stringify(payload)),
    job_revision: jobRevision || null,
    attempt_count: 0,
    next_attempt: new Date().toISOString(),
    external_id: null,
    response_summary: null,
    correlation_id: correlationId || null,
    status: OutboxStatus.PENDING,
    created_at: new Date().toISOString(),
    commit_id: null
  };

  outbox.items.set(item.id, item);
  return { created: true, item };
}

function simpleHashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + (hash >>> 0).toString(16).padStart(8, '0');
}

function markProcessing(outbox, outboxId) {
  const item = outbox.items.get(outboxId);
  if (!item) return { ok: false, reason: 'not found' };
  if (item.status !== OutboxStatus.PENDING && item.status !== OutboxStatus.RETRY_DUE) {
    return { ok: false, reason: 'cannot process from ' + item.status };
  }
  item.status = OutboxStatus.PROCESSING;
  item.attempt_count++;
  return { ok: true, item };
}

function markSucceeded(outbox, outboxId, externalId, responseSummary) {
  const item = outbox.items.get(outboxId);
  if (!item) return { ok: false, reason: 'not found' };
  item.status = OutboxStatus.SUCCEEDED;
  item.external_id = externalId || null;
  item.response_summary = responseSummary || null;
  return { ok: true, item };
}

function markRetryDue(outbox, outboxId, backoffMs, errorSummary) {
  const item = outbox.items.get(outboxId);
  if (!item) return { ok: false, reason: 'not found' };
  if (item.attempt_count >= 5) {
    item.status = OutboxStatus.NEEDS_REVIEW;
    item.response_summary = 'Max retries exceeded. Last error: ' + errorSummary;
    return { ok: true, item, escalated: true };
  }
  item.status = OutboxStatus.RETRY_DUE;
  item.next_attempt = new Date(Date.now() + backoffMs).toISOString();
  item.response_summary = errorSummary || null;
  return { ok: true, item };
}

function markNeedsReview(outbox, outboxId, reason) {
  const item = outbox.items.get(outboxId);
  if (!item) return { ok: false, reason: 'not found' };
  item.status = OutboxStatus.NEEDS_REVIEW;
  item.response_summary = reason || 'Uncertain outcome — requires manual review';
  return { ok: true, item };
}

function markCancelled(outbox, outboxId, reason) {
  const item = outbox.items.get(outboxId);
  if (!item) return { ok: false, reason: 'not found' };
  item.status = OutboxStatus.CANCELLED;
  item.response_summary = reason || null;
  return { ok: true, item };
}

function getPendingItems(outbox) {
  const pending = [];
  for (const [, item] of outbox.items) {
    if (item.status === OutboxStatus.PENDING || item.status === OutboxStatus.RETRY_DUE) {
      pending.push(item);
    }
  }
  return pending;
}

function calculateBackoff(attemptCount) {
  const baseMs = 1000;
  const maxMs = 300000; // 5 minutes
  const delay = Math.min(baseMs * Math.pow(2, attemptCount), maxMs);
  const jitter = Math.random() * 1000;
  return Math.floor(delay + jitter);
}

if (typeof module !== 'undefined') {
  module.exports = {
    createOutbox, enqueueOutbox, markProcessing, markSucceeded,
    markRetryDue, markNeedsReview, markCancelled, getPendingItems, calculateBackoff
  };
}
