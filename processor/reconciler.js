/* S03 processor — Recovery and reconciliation primitives.
 * Authority: 01 §3 command processing, concurrency and partial failure. */

const { CommitState } = require('./types.js');

function createReconciler() {
  return {};
}

function recoverUncommitted(journal, dataStore, auditLog) {
  const uncommitted = [];
  for (const [, entry] of journal.entries) {
    if (entry.state === CommitState.PREPARED) {
      uncommitted.push({ commit_id: entry.commit_id, action: 'discard', reason: 'PREPARED but never applied' });
    } else if (entry.state === CommitState.APPLYING) {
      const changes = JSON.parse(entry.changes_json);
      const appStatus = checkApplicationStatus(dataStore, entry.entity_type, entry.entity_id, changes);

      if (appStatus === 'FULLY_APPLIED') {
        uncommitted.push({ commit_id: entry.commit_id, action: 'commit', reason: 'all changes verified in data store' });
      } else if (appStatus === 'NOT_APPLIED') {
        uncommitted.push({ commit_id: entry.commit_id, action: 'discard', reason: 'no changes found in data store' });
      } else {
        uncommitted.push({ commit_id: entry.commit_id, action: 'manual_review', reason: 'PARTIALLY_APPLIED — some changes present, some missing. Do not assume completion.' });
      }
    } else if (entry.state === CommitState.RECOVERY_REQUIRED) {
      uncommitted.push({ commit_id: entry.commit_id, action: 'manual_review', reason: 'explicitly marked RECOVERY_REQUIRED' });
    }
  }
  return uncommitted;
}

function checkApplicationStatus(dataStore, entityType, entityId, changes) {
  if (!dataStore || !dataStore[entityType]) return 'NOT_APPLIED';
  const record = dataStore[entityType].get(entityId);
  if (!record) return 'NOT_APPLIED';

  const changeKeys = Object.keys(changes).filter(k => !k.startsWith('_'));
  if (changeKeys.length === 0) return 'FULLY_APPLIED';

  let appliedCount = 0;
  for (const [field, newValue] of Object.entries(changes)) {
    if (field.startsWith('_')) continue;
    if (record[field] !== undefined && record[field] === newValue) {
      appliedCount++;
    }
  }

  if (appliedCount === changeKeys.length) return 'FULLY_APPLIED';
  if (appliedCount === 0) return 'NOT_APPLIED';
  return 'PARTIALLY_APPLIED';
}

function reconcileOutbox(outbox, externalStateChecker) {
  const actions = [];
  for (const [, item] of outbox.items) {
    if (item.status === 'NeedsReview') {
      if (externalStateChecker && item.external_id) {
        const externalState = externalStateChecker(item.external_id, item.action_type);
        if (externalState === 'SUCCEEDED') {
          actions.push({ outbox_id: item.id, action: 'mark_succeeded', reason: 'external confirmation' });
        } else if (externalState === 'FAILED') {
          actions.push({ outbox_id: item.id, action: 'mark_failed', reason: 'external failure confirmed' });
        }
      }
    }
  }
  return actions;
}

if (typeof module !== 'undefined') {
  module.exports = { createReconciler, recoverUncommitted, reconcileOutbox };
}
