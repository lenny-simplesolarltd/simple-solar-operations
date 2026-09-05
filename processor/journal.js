/* S03 processor — CommitJournal for deterministic recovery.
 * Authority: 01 §3 command processing, concurrency and partial failure. */

const { CommitState } = require('./types.js');

function createJournal() {
  const entries = new Map();
  return { entries };
}

function prepareCommit(journal, commitId, commandId, entityType, entityId, expectedVersion, changesJson) {
  if (journal.entries.has(commitId)) {
    return { ok: false, reason: 'commit_id already exists: ' + commitId };
  }

  const entry = {
    commit_id: commitId,
    state: CommitState.PREPARED,
    command_id: commandId,
    entity_type: entityType,
    entity_id: entityId,
    expected_version: expectedVersion,
    changes_json: JSON.stringify(changesJson),
    prepared_at: new Date().toISOString(),
    committed_at: null
  };

  journal.entries.set(commitId, entry);
  return { ok: true, entry };
}

function markApplying(journal, commitId) {
  const entry = journal.entries.get(commitId);
  if (!entry) return { ok: false, reason: 'commit_id not found: ' + commitId };
  if (entry.state !== CommitState.PREPARED) {
    return { ok: false, reason: 'cannot apply from state ' + entry.state };
  }
  entry.state = CommitState.APPLYING;
  return { ok: true, entry };
}

function markCommitted(journal, commitId) {
  const entry = journal.entries.get(commitId);
  if (!entry) return { ok: false, reason: 'commit_id not found: ' + commitId };
  if (entry.state !== CommitState.APPLYING) {
    return { ok: false, reason: 'cannot commit from state ' + entry.state };
  }
  entry.state = CommitState.COMMITTED;
  entry.committed_at = new Date().toISOString();
  return { ok: true, entry };
}

function markRecoveryRequired(journal, commitId) {
  const entry = journal.entries.get(commitId);
  if (!entry) return { ok: false, reason: 'commit_id not found: ' + commitId };
  entry.state = CommitState.RECOVERY_REQUIRED;
  return { ok: true, entry };
}

function getUncommitted(journal) {
  const uncommitted = [];
  for (const [id, entry] of journal.entries) {
    if (entry.state === CommitState.PREPARED || entry.state === CommitState.APPLYING || entry.state === CommitState.RECOVERY_REQUIRED) {
      uncommitted.push(entry);
    }
  }
  return uncommitted;
}

function getByCommitId(journal, commitId) {
  return journal.entries.get(commitId) || null;
}

if (typeof module !== 'undefined') {
  module.exports = {
    createJournal, prepareCommit, markApplying, markCommitted,
    markRecoveryRequired, getUncommitted, getByCommitId
  };
}
