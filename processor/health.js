/* S03 processor — HealthChecks and last-success tracking.
 * Authority: 01 §3 scheduling and health defaults. */

function createHealthStore() {
  const checks = new Map();
  return { checks };
}

function recordHealthCheck(healthStore, integration, outcome, clock) {
  const now = clock ? clock.nowISO() : new Date().toISOString();
  const check = {
    id: 'HLTH-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    integration,
    checked_at: now,
    outcome,
    last_success: outcome === 'OK' ? now : (healthStore.checks.get(integration)?.last_success || null),
    error_code: outcome !== 'OK' ? outcome : null,
    next_action_task_id: null,
    created_at: now,
    commit_id: null
  };
  healthStore.checks.set(integration, check);
  return check;
}

function getLastSuccess(healthStore, integration) {
  const check = healthStore.checks.get(integration);
  return check ? check.last_success : null;
}

function getAllHealth(healthStore) {
  const result = {};
  for (const [integration, check] of healthStore.checks) {
    result[integration] = {
      outcome: check.outcome,
      last_success: check.last_success,
      checked_at: check.checked_at,
      error: check.error_code
    };
  }
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = { createHealthStore, recordHealthCheck, getLastSuccess, getAllHealth };
}
