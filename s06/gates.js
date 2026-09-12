/* S06 gate evaluation — booking readiness checks.
 * Pure functions: takes a Job record + store, returns gate results.
 * No external calls, no mutations. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function clone(v) { return JSON.parse(JSON.stringify(v)); }

const SATISFIED_TASK_STATUSES = ['Complete', 'NotRequired'];

function taskSatisfaction(store, jobId, code) {
  const tasks = store.list('Tasks').filter(t => t.job_id === jobId && t.template_code === code);
  if (tasks.length !== 1) return { pass: false, detail: tasks.length ? 'Expected one task; found ' + tasks.length : 'Required task missing' };
  const task = tasks[0];
  const pass = SATISFIED_TASK_STATUSES.includes(task.status) &&
    (task.status !== 'NotRequired' || !!(task.completion_note || task.evidence_id));
  return { pass, detail: pass ? code + ' satisfied (' + task.status + ')' : code + ' outstanding (' + (task.status || 'missing status') + ')', task_id: task.id };
}

function evaluateReadyToBook(job, store) {
  const gates = [];
  let ready = true;
  function check(name, pass, detail) { gates.push({ name, pass: !!pass, detail, blocking: true }); if (!pass) ready = false; }

  check('sold_linked', !!job.sold_submission_id, job.sold_submission_id ? 'Sold intake linked' : 'Sold intake missing');
  check('finance_route_valid', ['Standard', 'Phoenix', 'OtherReview'].includes(job.finance_route), 'Finance route: ' + (job.finance_route || 'missing'));
  check('signed_contract_evidence', job.contract_status === 'Signed' && !!job.contract_evidence_id,
    job.contract_status === 'Signed' && job.contract_evidence_id ? 'Signed contract evidence recorded' : 'Signed contract evidence missing');

  const pre02 = taskSatisfaction(store, job.id, 'PRE02');
  check('PRE02_satisfied', pre02.pass, pre02.detail);

  const pre04 = taskSatisfaction(store, job.id, 'PRE04');
  check('PRE04_satisfied', pre04.pass, pre04.detail);
  check('customer_value_verified', !!job.customer_details_verified_at && !!job.customer_details_verified_by &&
    typeof job.original_gross_pence === 'number' && job.original_gross_pence > 0,
    'Customer verification actor/time and sold value must be recorded');

  if (job.finance_route === 'Standard') {
    const pre03 = taskSatisfaction(store, job.id, 'PRE03');
    check('PRE03_satisfied', pre03.pass, pre03.detail);
    check('deposit_confirmation_evidence', !!job.deposit_bank_confirmed_at && !!job.deposit_bank_confirmed_by && !!job.deposit_bank_reference,
      'Bank confirmation actor/time/reference must be recorded');
  } else {
    const pre05 = taskSatisfaction(store, job.id, 'PRE05');
    check('PRE05_satisfied', pre05.pass, pre05.detail);
    const pre05Task = store.list('Tasks').find(t => t.job_id === job.id && t.template_code === 'PRE05');
    check('finance_agreement_evidence', !!pre05Task && !!pre05Task.evidence_id, 'PRE05 provider/agreement evidence must be recorded');
  }

  return { job_id: job.id, workflow_stage: job.workflow_stage, ready, blocked: !ready, gates,
    summary: ready ? 'ReadyToBook' : 'PrebookingBlocked' };
}

/* --- Gate evaluation --- */

function evaluateBookingGates(job, store) {
  const gates = [];
  let ready = true;
  let blocked = false;

  function check(name, pass, detail, blocking) {
    gates.push({ name, pass, detail, blocking: blocking || false });
    if (!pass && blocking) blocked = true;
    if (!pass) ready = false;
  }

  // 1. Sold + Booking linked
  check('sold_booking_linked',
    !!job.sold_submission_id && !!job.booking_submission_id,
    job.sold_submission_id && job.booking_submission_id
      ? 'Sold (' + job.sold_submission_id + ') and Booking (' + job.booking_submission_id + ') linked'
      : 'Missing sold or booking submission link',
    true);

  // 2. Match status confirmed
  check('sold_booking_match',
    job.sold_booking_match_status === 'Match',
    'Match status: ' + (job.sold_booking_match_status || 'missing'),
    true);

  // 3. Customer exists
  const customer = job.customer_id ? store.get('Customers', job.customer_id) : null;
  check('customer_exists', !!customer,
    customer ? 'Customer ' + customer.id + ' (' + customer.first_name + ' ' + customer.last_name + ')' : 'No customer linked',
    true);

  // 4. Customer has required fields
  if (customer) {
    const missingCust = [];
    if (!customer.first_name || customer.first_name === 'NOT_CONFIGURED') missingCust.push('first_name');
    if (!customer.last_name || customer.last_name === 'NOT_CONFIGURED') missingCust.push('last_name');
    if (!customer.address_line1 || customer.address_line1 === 'NOT_CONFIGURED') missingCust.push('address_line1');
    if (!customer.town || customer.town === 'NOT_CONFIGURED') missingCust.push('town');
    if (!customer.postcode || customer.postcode === 'NOT_CONFIGURED') missingCust.push('postcode');
    check('customer_details_complete', missingCust.length === 0,
      missingCust.length === 0 ? 'All required customer fields present' : 'Missing: ' + missingCust.join(', '),
      false);
  }

  // 5. A booking cannot weaken the signed-evidence prebooking gate.
  const contractOk = job.contract_status === 'Signed' && !!job.contract_evidence_id;
  check('contract_status', contractOk,
    'Contract: ' + (job.contract_status || 'missing') + (contractOk ? ' with evidence' : ' (signed evidence required)'),
    true);

  // 6. Finance route is valid
  check('finance_route_valid',
    ['Standard', 'Phoenix', 'OtherReview'].includes(job.finance_route),
    'Finance route: ' + (job.finance_route || 'missing'),
    true);

  // 7. Deposit is applicable only to Standard; finance routes use PRE05.
  const depositOk = job.finance_route !== 'Standard' || (!!job.deposit_bank_confirmed_at && !!job.deposit_bank_confirmed_by && !!job.deposit_bank_reference);
  check('deposit_confirmed', depositOk,
    depositOk ? 'Deposit confirmed at ' + job.deposit_bank_confirmed_at : 'Deposit not yet confirmed',
    true);

  // 8. Gross amount present
  const grossOk = typeof job.original_gross_pence === 'number' && job.original_gross_pence > 0;
  check('gross_amount_present', grossOk,
    grossOk ? 'Gross: ' + job.original_gross_pence + ' pence' : 'Gross amount missing or zero',
    false);

  const mandatory = (job.finance_route === 'Standard' ? ['PRE01', 'PRE02', 'PRE03', 'PRE04'] : ['PRE02', 'PRE04', 'PRE05'])
    .concat(['BKG01', 'BKG02', 'BKG03']);
  mandatory.forEach(code => {
    const satisfied = taskSatisfaction(store, job.id, code);
    check('task_' + code, satisfied.pass, satisfied.detail, true);
  });

  return {
    job_id: job.id,
    job_id_human: job.job_id,
    workflow_stage: job.workflow_stage,
    ready,
    blocked,
    gates,
    needs_review: !ready && !blocked,
    summary: ready ? 'Ready' : (blocked ? 'Blocked' : 'NeedsReview')
  };
}

/* --- Due-date helpers --- */

function isStaffedDay(date, holidays) {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  if (holidays && holidays.some(h => h.date === iso)) return false;
  return true;
}

function nextStaffedDay(from, holidays) {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (!isStaffedDay(d, holidays)) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10) + 'T09:00:00.000Z';
}

function fridayBefore(date, holidays) {
  const d = new Date(date);
  // Find the Friday before this date
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  // If that Friday is a holiday, go back to previous staffed day
  while (!isStaffedDay(d, holidays)) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10) + 'T17:00:00.000Z';
}

/* --- Task creation --- */

function createTasksForJob(job, gateResult, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = job; if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = options.now || new Date().toISOString();
  const holidays = options.holidays || [];
  const tanyaId = resolvePersonByRole(store, 'Office') || 'PERSON-tanya';
  const adminId = resolvePersonByRole(store, 'Admin') || 'PERSON-ben';
  const created = [];
  const skipped = [];
  const errors = [];

  function instanceKey(templateCode) {
    return templateCode + '-' + job.id + '-ROOT-nodue';
  }

  function existingTask(code) {
    const key = instanceKey(code);
    return store.list('Tasks').find(t => t.instance_key === key) || null;
  }

  function createTask(template, ownerId, dueAt, priority, backupId) {
    const key = instanceKey(template.template_code);
    const existing = store.list('Tasks').find(t => t.instance_key === key);
    if (existing) {
      if (existing.status === 'Complete' || existing.status === 'Cancelled') {
        skipped.push({ template: template.template_code, reason: 'Already ' + existing.status, task_id: existing.id });
      } else {
        skipped.push({ template: template.template_code, reason: 'Already exists (status: ' + existing.status + ')', task_id: existing.id });
      }
      return null;
    }

    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: job.id,
      template_code: template.template_code,
      instance_key: key,
      group: template.group,
      title: template.title,
      owner_id: ownerId,
      backup_id: backupId || null,
      related_entity_type: 'Jobs',
      related_entity_id: job.id,
      due_at: dueAt || null,
      original_due_at: dueAt || null,
      priority: priority || 0,
      status: 'Open',
      blocking_reason: null,
      next_followup_at: null,
      completed_at: null,
      completed_by: null,
      completion_note: null,
      evidence_id: null,
      revision_required: false,
      created_rule_version: template.template_version || '1.0',
      created_at: now,
      created_by: 'S06-gates',
      updated_at: now,
      updated_by: 'S06-gates',
      version: 1,
      source_system: 'S06-gates',
      commit_id: 'S06-' + key
    };

    store.insert('Tasks', task);
    created.push({ template: template.template_code, task_id: task.id, owner_id: ownerId, due_at: dueAt });
    return task;
  }

  function getTemplate(code) {
    return store.list('TaskTemplates').find(t => t.template_code === code && t.active !== false) || null;
  }

  // PRE01: Send deposit invoice — if not yet confirmed
  if (job.finance_route === 'Standard') {
    const tpl = getTemplate('PRE01');
    if (tpl) createTask(tpl, tanyaId, nextStaffedDay(now, holidays), 1);
  }

  // PRE02 records the human signed-contract check even if reliable status was imported.
  const pre02Template = getTemplate('PRE02');
  if (pre02Template) createTask(pre02Template, tanyaId, nextStaffedDay(now, holidays), 1);

  // PRE03: Confirm bank deposit — if not yet confirmed
  if (job.finance_route === 'Standard') {
    const tpl = getTemplate('PRE03');
    const danId = store.get('People', 'PERSON-dan') && store.get('People', 'PERSON-dan').active === true ? 'PERSON-dan' : null;
    if (tpl) createTask(tpl, adminId, nextStaffedDay(now, holidays), 2, danId);
  }

  // BKG01: Prepare booking — always create when booking linked
  if (job.booking_submission_id) {
    ['BKG01', 'BKG02', 'BKG03'].forEach(function(code) {
      const tpl = getTemplate(code);
      if (tpl) createTask(tpl, tanyaId, null, 2);
    });
  }

  // BKG04/BKG05 are post-confirmation tasks, never pre-created merely from a match.
  if (job.workflow_stage === 'Booked' || !!job.booking_approved_at) {
    ['BKG04', 'BKG05'].forEach(function(code) {
      const tpl = getTemplate(code);
      if (tpl) createTask(tpl, tanyaId, now, 2);
    });
  }

  // FIN01: Interim draft check/send — if install date known
  const installDate = job.next_action_at;
  if (installDate && gateResult.ready) {
    const tpl = getTemplate('FIN01');
    const dueDate = fridayBefore(installDate, holidays);
    if (tpl) createTask(tpl, tanyaId, dueDate, 1);
  }

  // FIN03: Balance invoice — only after operational approval (not S06)
  // GHL01: Move GHL — only after operational approval (not S06)

  // Unpaid interim chase task — if install date is set but deposit not confirmed
  if (installDate && job.finance_route === 'Standard' && !job.deposit_bank_confirmed_at) {
    const key = 'S06-UNPAID-INTERIM-' + job.id;
    const existing = store.list('Tasks').find(t => t.instance_key === key);
    if (!existing) {
      const chaseTask = {
        id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        job_id: job.id,
        template_code: 'S06-UNPAID-INTERIM',
        instance_key: key,
        group: 'Finance',
        title: 'Chase unpaid interim payment',
        owner_id: tanyaId,
        backup_id: null,
        related_entity_type: 'Jobs',
        related_entity_id: job.id,
        due_at: nextStaffedDay(now, holidays),
        original_due_at: nextStaffedDay(now, holidays),
        priority: 1,
        status: 'Open',
        blocking_reason: null,
        next_followup_at: null,
        completed_at: null,
        completed_by: null,
        completion_note: null,
        evidence_id: null,
        revision_required: false,
        created_rule_version: 'S06-1.0',
        created_at: now,
        created_by: 'S06-gates',
        updated_at: now,
        updated_by: 'S06-gates',
        version: 1,
        source_system: 'S06-gates',
        commit_id: 'S06-' + key
      };
      store.insert('Tasks', chaseTask);
      created.push({ template: 'S06-UNPAID-INTERIM', task_id: chaseTask.id, owner_id: tanyaId, due_at: chaseTask.due_at });
    } else {
      skipped.push({ template: 'S06-UNPAID-INTERIM', reason: 'Already exists', task_id: existing.id });
    }
  }

  return { created, skipped, errors, task_count: created.length };
}

function resolvePersonByRole(store, role) {
  const roles = store.list('PersonRoles').filter(r => r.role === role && r.active === true);
  if (roles.length === 0) return null;
  return roles[0].person_id;
}

function resolvePersonById(store, id) {
  const person = store.get('People', id);
  return person && person.active === true ? person.id : null;
}

/* Prebooking tasks after Sold — before Booking form. Idempotent via instance_key. */
function createPrebookingTasksForSold(job, store, options = {}) {
  const now = options.now || new Date().toISOString();
  const holidays = options.holidays || [];
  const tanyaId = resolvePersonByRole(store, 'Office') || 'PERSON-tanya';
  const adminId = resolvePersonByRole(store, 'Admin') || 'PERSON-ben';
  const directorBackupId = resolvePersonById(store, 'PERSON-dan');
  const created = [];
  const skipped = [];

  function instanceKey(templateCode) {
    return templateCode + '-' + job.id + '-ROOT-nodue';
  }

  function getTemplate(code) {
    return store.list('TaskTemplates').find(t => t.template_code === code && t.active !== false) || null;
  }

  function createTask(template, ownerId, backupId, dueAt, priority) {
    const key = instanceKey(template.template_code);
    const existing = store.list('Tasks').find(t => t.instance_key === key);
    if (existing) {
      skipped.push({ template: template.template_code, reason: 'Already exists', task_id: existing.id });
      return null;
    }
    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: job.id,
      template_code: template.template_code,
      instance_key: key,
      group: template.group,
      title: template.title,
      owner_id: ownerId,
      backup_id: backupId || null,
      related_entity_type: 'Jobs',
      related_entity_id: job.id,
      due_at: dueAt || null,
      original_due_at: dueAt || null,
      priority: priority || 0,
      status: 'Open',
      blocking_reason: null,
      next_followup_at: null,
      completed_at: null,
      completed_by: null,
      completion_note: null,
      evidence_id: null,
      revision_required: false,
      created_rule_version: template.template_version || '1.0',
      created_at: now,
      created_by: 'S06-prebooking',
      updated_at: now,
      updated_by: 'S06-prebooking',
      version: 1,
      source_system: 'S06-prebooking',
      commit_id: 'S06-' + key
    };
    store.insert('Tasks', task);
    created.push({ template: template.template_code, task_id: task.id, owner_id: ownerId, due_at: dueAt });
    return task;
  }

  if (job.finance_route === 'Standard') {
    const tpl = getTemplate('PRE01');
    if (tpl) createTask(tpl, tanyaId, null, now, 1);
  }
  const pre02Template = getTemplate('PRE02');
  if (pre02Template) createTask(pre02Template, tanyaId, null, now, 1);
  if (job.finance_route === 'Standard') {
    const tpl = getTemplate('PRE03');
    if (tpl) createTask(tpl, adminId, directorBackupId, nextStaffedDay(now, holidays), 2);
  }
  {
    const tpl = getTemplate('PRE04');
    if (tpl) createTask(tpl, tanyaId, null, null, 2);
  }
  if (job.finance_route && job.finance_route !== 'Standard') {
    const tpl = getTemplate('PRE05');
    if (tpl) createTask(tpl, tanyaId, null, null, 2);
  }
  // Copy Job ID into Booking form — office action tied to human reference
  const copyKey = 'PRE-COPY-JOBID-' + job.id;
  if (!store.list('Tasks').find(t => t.instance_key === copyKey)) {
    const due = nextStaffedDay(now, holidays);
    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: job.id,
      template_code: 'PRE-COPY-JOBID',
      instance_key: copyKey,
      group: 'Prebooking',
      title: 'Copy Job ID into Job Booking form (' + (job.job_id || '') + ')',
      owner_id: tanyaId,
      backup_id: adminId,
      related_entity_type: 'Jobs',
      related_entity_id: job.id,
      due_at: due,
      original_due_at: due,
      priority: 1,
      status: 'Open',
      blocking_reason: null,
      next_followup_at: null,
      completed_at: null,
      completed_by: null,
      completion_note: null,
      evidence_id: null,
      revision_required: false,
      created_rule_version: 'S06-1.0',
      created_at: now,
      created_by: 'S06-prebooking',
      updated_at: now,
      updated_by: 'S06-prebooking',
      version: 1,
      source_system: 'S06-prebooking',
      commit_id: 'S06-' + copyKey
    };
    store.insert('Tasks', task);
    created.push({ template: 'PRE-COPY-JOBID', task_id: task.id, owner_id: tanyaId, due_at: due, job_id_human: job.job_id });
  } else {
    skipped.push({ template: 'PRE-COPY-JOBID', reason: 'Already exists' });
  }

  return { created, skipped, task_count: created.length, job_id_human: job.job_id };
}

function processBookingGates(jobId, store, options = {}) {
  const job = store.get('Jobs', jobId);
  if (!job) return { error: 'JOB_NOT_FOUND', job_id: jobId };

  const readiness = evaluateReadyToBook(job, store);
  const gates = evaluateBookingGates(job, store);
  let taskResult = { created: [], skipped: [], errors: [], task_count: 0 };

  // Only create tasks if there's at least a booking link
  if (job.booking_submission_id || job.sold_submission_id) {
    taskResult = createTasksForJob(job, gates, store, options);
  }

  const now = options.now || new Date().toISOString();
  const actor = options.actor || 'S06-gates';
  function transition(nextStage, extra) {
    const before = store.get('Jobs', job.id);
    const patch = Object.assign({ workflow_stage: nextStage, updated_at: now, updated_by: actor,
      version: Number(before.version || 0) + 1, commit_id: options.command_id ? 'S06-' + options.command_id : before.commit_id }, extra || {});
    store.update('Jobs', job.id, patch);
    const after = store.get('Jobs', job.id);
    const auditId = 'AE-S06-' + nextStage + '-' + job.id;
    if (!store.get('AuditEvents', auditId)) store.insert('AuditEvents', { id: auditId, entity_type: 'Jobs', entity_id: job.id,
      action: 'WorkflowStage:' + nextStage, before_json: JSON.stringify(before), after_json: JSON.stringify(after), initiating_actor: actor,
      executing_service: 'S06-gates', timestamp: now, correlation_id: options.command_id || null, reason: readiness.summary,
      commit_id: options.command_id ? 'S06-' + options.command_id : 'S06-' + nextStage + '-' + job.id, created_at: now });
    return after;
  }

  if (job.workflow_stage === 'Prebooking' && readiness.ready) {
    transition('ReadyToBook');
    readiness.workflow_stage = 'ReadyToBook'; readiness.stage_advanced = true;
  } else if (job.workflow_stage === 'ReadyToBook' && job.booking_submission_id) {
    transition('BookingInProgress');
    gates.workflow_stage = 'BookingInProgress'; gates.stage_advanced = true;
  } else if (job.workflow_stage === 'BookingInProgress' && gates.ready) {
    const booked = transition('Booked', { booking_approved_at: now, booking_approved_by: actor });
    gates.workflow_stage = 'Booked'; gates.stage_advanced = true;
    const postBooking = createTasksForJob(booked, gates, store, options);
    taskResult.created = taskResult.created.concat(postBooking.created);
    taskResult.skipped = taskResult.skipped.concat(postBooking.skipped);
    taskResult.errors = taskResult.errors.concat(postBooking.errors);
    taskResult.task_count = taskResult.created.length;
  }

  return {
    job_id: job.id,
    job_id_human: job.job_id,
    readiness,
    gates,
    tasks: taskResult,
    success: !gates.blocked
  };
}

module.exports = {
  DEV_SHEET_ID,
  evaluateReadyToBook, evaluateBookingGates, taskSatisfaction, createTasksForJob, createPrebookingTasksForSold, processBookingGates,
  isStaffedDay, nextStaffedDay, fridayBefore, resolvePersonByRole
};
