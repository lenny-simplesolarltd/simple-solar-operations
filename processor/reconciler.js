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
      // Prepared but never applied — safe to discard
      uncommitted.push({ commit_id: entry.commit_id, action: 'discard', reason: 'never applied' });
    } else if (entry.state === CommitState.APPLYING) {
      // Applying but not committed — need to check if changes were applied
      const changes = JSON.parse(entry.changes_json);
      const partiallyApplied = checkPartialApplication(dataStore, entry.entity_type, entry.entity_id, changes);
      if (partiallyApplied) {
        // Changes exist — can commit
        uncommitted.push({ commit_id: entry.commit_id, action: 'commit', reason: 'partially applied, safe to commit' });
      } else {
        // No changes found — can discard
        uncommitted.push({ commit_id: entry.commit_id, action: 'discard', reason: 'not applied' });
      }
    } else if (entry.state === CommitState.RECOVERY_REQUIRED) {
      uncommitted.push({ commit_id: entry.commit_id, action: 'manual_review', reason: 'needs human decision' });
    }
  }
  return uncommitted;
}

function checkPartialApplication(dataStore, entityType, entityId, changes) {
  if (!dataStore || !dataStore[entityType]) return false;
  const record = dataStore[entityType].get(entityId);
  if (!record) return false;

  // Check if any changed field matches
  for (const [field, newValue] of Object.entries(changes)) {
    if (record[field] !== undefined && record[field] === newValue) return true;
  }
  return false;
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
