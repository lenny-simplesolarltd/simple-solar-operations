/* S09 scaffolding — scaffold requirement evaluation and booking.
 * Uses canonical ScaffoldBookings, Companies, Contacts, Jobs tables.
 * FN-04 governs scaffolding. No real external communication. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
function assertS09Scope(jobId, store) {
  if (!store.getSheetId || store.getSheetId() !== DEV_SHEET_ID ||
      !store.getEnvironment || store.getEnvironment() !== 'DEV') throw new Error('S09_REFUSED: DEV only / wrong sheet');
  const modes = store.list('ReleaseModes').filter(r => r.function_id === 'FN-04');
  if (modes.length !== 1 || modes[0].mode !== 'Automated' || modes[0].authorised_job_scope !== 'Pilot' || modes[0].target_release !== 'R2') throw new Error('S09_REFUSED: FN-04 must be Automated/Pilot/R2');
  const job = store.get('Jobs', jobId);
  if (!job || job.pilot_job !== true || job.release_scope !== 'R2' || job.source_system !== 'S09') throw new Error('S09_REFUSED: synthetic S09 R2 pilot job required');
}

function evaluateScaffoldRequirement(jobId, store) {
  const job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, required: false, ready: false, error: 'JOB_NOT_FOUND' };

  const required = job.scaffold_required === true;
  if (!required) return { job_id: jobId, required: false, ready: false, summary: 'NotRequired' };

  const existing = store.list('ScaffoldBookings').filter(b => b.job_id === jobId);
  const active = existing.find(b => b.status !== 'Cancelled');
  if (active) {
    return {
      job_id: jobId, required: true, ready: false,
      existing_booking_id: active.id,
      status: active.status,
      summary: 'AlreadyBooked'
    };
  }

  return { job_id: jobId, required: true, ready: true, summary: 'Ready' };
}

function createScaffoldBooking(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  assertS09Scope(jobId, store);
  const now = options.now || new Date().toISOString();
  const eval_ = evaluateScaffoldRequirement(jobId, store);
  if (eval_.existing_booking_id) return { status: 'AlreadyExists', eval: eval_, booking: store.get('ScaffoldBookings', eval_.existing_booking_id), created: false };
  if (!eval_.ready) return { status: 'NotReady', eval: eval_, booking: null, created: false };

  const job = store.get('Jobs', jobId);
  const bookingId = 'SB-' + jobId;
  const existing = store.get('ScaffoldBookings', bookingId);

  if (existing) {
    if (existing.status === 'Cancelled') {
      return { status: 'Cancelled', eval: eval_, booking: existing, created: false, detail: 'Existing booking is cancelled' };
    }
    return { status: 'AlreadyExists', eval: eval_, booking: existing, created: false, detail: 'Booking already exists with status: ' + existing.status };
  }

  const scaffolder = store.list('Companies').find(c => c.id === 'COMP-scaffold-dev' && c.name === 'DEV Scaffold Co' && c.type === 'Scaffolder' && c.active === true && /^S09/.test(c.source_system || ''));
  if (!scaffolder) return { status: 'NoScaffolder', eval: eval_, booking: null, created: false, detail: 'No active scaffolder company configured' };

  const installDate = job.next_action_at;
  const erectDate = installDate ? calculateErectDate(installDate, scaffolder.standard_lead_days || 0) : null;

  const booking = {
    id: bookingId, job_id: jobId, company_id: scaffolder.id,
    erect_planned_at: erectDate,
    erect_confirmed_at: null, erect_actual_at: null,
    strip_forecast_at: null, strip_authorised_at: null, strip_authorised_by: null,
    strip_planned_at: null, strip_confirmed_at: null, strip_actual_at: null,
    status: 'Requested', revision: 1, confirmed_revision: null,
    access_notes: null, scope_file_id: null,
    quoted_cost_pence: null, actual_cost_pence: null, invoice_reference: null,
    related_issue_ids: null,
    created_at: now, created_by: 'S09-scaffold',
    updated_at: now, updated_by: 'S09-scaffold',
    version: 1, source_system: 'S09-scaffold',
    commit_id: bookingId
  };

  store.insert('ScaffoldBookings', booking);
  return { status: 'Created', eval: eval_, booking, created: true };
}

function calculateErectDate(installDate, leadDays) {
  const d = new Date(installDate);
  d.setDate(d.getDate() - (leadDays || 0));
  // Move back to staffed day
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function createScaffoldTasks(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  assertS09Scope(jobId, store);
  const now = options.now || new Date().toISOString();
  const created = [];
  const tanyaId = 'PERSON-tanya';

  const key = 'SCA01-' + jobId + '-ROOT-nodue';
  const matches = store.list('Tasks').filter(t => t.instance_key === key || (t.job_id === jobId && t.template_code === 'SCA01'));
  const exists = matches[0];
  if (matches.length > 1 || (exists && (exists.instance_key !== key || exists.job_id !== jobId || exists.related_entity_type !== 'Jobs' || exists.related_entity_id !== jobId || exists.template_code !== 'SCA01' || exists.owner_id !== tanyaId || exists.group !== 'Materials'))) throw new Error('S09_CONFLICT: SCA01 linkage/duplicate');
  if (!exists) {
    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: jobId, template_code: 'SCA01', instance_key: key,
      group: 'Materials', title: 'Notify and confirm scaffolder erect',
      owner_id: tanyaId, backup_id: null,
      related_entity_type: 'Jobs', related_entity_id: jobId,
      due_at: null, original_due_at: null, priority: 1, status: 'Open',
      blocking_reason: null, next_followup_at: null,
      completed_at: null, completed_by: null, completion_note: null,
      evidence_id: null, revision_required: false,
      created_rule_version: '1.0',
      created_at: now, created_by: 'S09-scaffold',
      updated_at: now, updated_by: 'S09-scaffold',
      version: 1, source_system: 'S09-scaffold',
      commit_id: 'S09-' + key
    };
    store.insert('Tasks', task);
    created.push({ code: 'SCA01', task_id: task.id });
  }

  return { created, reused: exists ? [{ code: 'SCA01', task_id: exists.id }] : [] };
}

function processJobScaffolding(jobId, store, options = {}) {
  assertS09Scope(jobId, store);
  const eval_ = evaluateScaffoldRequirement(jobId, store);
  let bookingResult = { status: 'NotReady', booking: null, created: false };
  let taskResult = { created: [], reused: [] };
  const existing = store.list('ScaffoldBookings').filter(b => b.job_id === jobId);
  if (existing.length > 1 || existing.some(b => b.id !== 'SB-' + jobId || b.company_id !== 'COMP-scaffold-dev')) throw new Error('S09_CONFLICT: scaffold booking linkage/duplicate');
  if (eval_.ready || eval_.existing_booking_id) {
    bookingResult = createScaffoldBooking(jobId, store, options);
    if (bookingResult.booking && bookingResult.booking.status !== 'Cancelled') taskResult = createScaffoldTasks(jobId, store, options);
  }
  return { job_id: jobId, requirement: eval_, booking: bookingResult, tasks: taskResult,
    success: !!bookingResult.booking && bookingResult.booking.status !== 'Cancelled' && taskResult.created.length + taskResult.reused.length === 1 };
}

module.exports = {
  DEV_SHEET_ID,
  evaluateScaffoldRequirement, createScaffoldBooking, createScaffoldTasks, processJobScaffolding,
  calculateErectDate
};
