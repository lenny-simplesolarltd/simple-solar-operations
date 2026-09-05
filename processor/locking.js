/* S03 processor — optimistic locking and version checking.
 * Authority: 01 §3 concurrency control. */

function checkVersion(expectedVersion, currentVersion) {
  if (expectedVersion === null || expectedVersion === undefined) return { ok: true };

  if (expectedVersion !== currentVersion) {
    return {
      ok: false,
      conflict: true,
      expected: expectedVersion,
      current: currentVersion,
      reason: 'stale version: expected ' + expectedVersion + ', current ' + currentVersion
    };
  }

  return { ok: true };
}

function incrementVersion(currentVersion) {
  return (currentVersion || 0) + 1;
}

function acquireLock(lockStore, entityId, lockTimeoutMs) {
  const now = Date.now();
  const existing = lockStore.get(entityId);

  if (existing && (now - existing.acquired_at) < (lockTimeoutMs || 30000)) {
    return { acquired: false, reason: 'lock held by ' + existing.owner, holder: existing.owner };
  }

  const lock = {
    owner: 'cmd-' + Math.random().toString(36).slice(2, 8),
    acquired_at: now,
    entity_id: entityId
  };
  lockStore.set(entityId, lock);
  return { acquired: true, lock };
}

function releaseLock(lockStore, entityId, lockOwner) {
  const existing = lockStore.get(entityId);
  if (!existing) return { released: true };
  if (existing.owner === lockOwner) {
    lockStore.delete(entityId);
    return { released: true };
  }
  return { released: false, reason: 'lock owned by ' + existing.owner };
}

if (typeof module !== 'undefined') {
  module.exports = { checkVersion, incrementVersion, acquireLock, releaseLock };
}
