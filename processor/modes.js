/* S03 processor — ReleaseMode enforcement.
 * Authority: RA01 §§1–12; DEC-002. */

const { ReleaseMode } = require('./types.js');

function getFunctionMode(functionId, releaseModes) {
  const entry = releaseModes.find(r => r.function_id === functionId);
  if (!entry) return ReleaseMode.DISABLED;
  return entry.mode;
}

function checkReleaseMode(functionId, releaseModes) {
  const mode = getFunctionMode(functionId, releaseModes);
  if (mode === ReleaseMode.DISABLED) {
    return { allowed: false, reason: 'function ' + functionId + ' is Disabled', mode };
  }
  if (mode === ReleaseMode.MANUAL) {
    return { allowed: false, reason: 'function ' + functionId + ' is Manual — no automated execution', mode };
  }
  return { allowed: true, mode };
}

function checkPilotScope(jobId, job, functionId, releaseModes) {
  const entry = releaseModes.find(r => r.function_id === functionId);
  if (!entry || entry.mode === ReleaseMode.DISABLED) {
    return { allowed: false, reason: 'function ' + functionId + ' is Disabled' };
  }

  const authorisedScope = entry.authorised_job_scope;
  if (!authorisedScope || authorisedScope === 'None') {
    return { allowed: false, reason: 'function ' + functionId + ' has no authorised job scope' };
  }

  if (authorisedScope === 'All') return { allowed: true };

  // Pilot scope: only pilot jobs allowed
  if (authorisedScope === 'Pilot' || authorisedScope.includes('pilot')) {
    if (!job || !job.pilot_job) {
      return { allowed: false, reason: 'function ' + functionId + ' limited to pilot scope; job ' + jobId + ' is not a pilot job' };
    }
  }

  // Release scope check
  if (job && job.release_scope) {
    const targetRelease = entry.target_release;
    if (targetRelease && job.release_scope !== targetRelease) {
      return { allowed: false, reason: 'job release_scope ' + job.release_scope + ' does not match function target ' + targetRelease };
    }
  }

  return { allowed: true };
}

// Determine what can actually run for a given command and context
function resolveEffectiveMode(functionId, releaseModes, job) {
  const modeCheck = checkReleaseMode(functionId, releaseModes);
  if (!modeCheck.allowed) return modeCheck;

  if (job) {
    const scopeCheck = checkPilotScope(job.id || job.job_id, job, functionId, releaseModes);
    if (!scopeCheck.allowed) return scopeCheck;
  }

  return { allowed: true, mode: modeCheck.mode };
}

if (typeof module !== 'undefined') {
  module.exports = { getFunctionMode, checkReleaseMode, checkPilotScope, resolveEffectiveMode };
}
