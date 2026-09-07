/* S06 gate evaluation — booking readiness checks.
 * Pure functions: takes a Job record + store, returns gate results.
 * No external calls, no mutations. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function clone(v) { return JSON.parse(JSON.stringify(v)); }

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

  // 5. Contract status is Sent or Signed
  const contractOk = ['Sent', 'Signed'].includes(job.contract_status);
  check('contract_status', contractOk,
    'Contract: ' + (job.contract_status || 'missing') + (contractOk ? '' : ' (expected Sent or Signed)'),
    false);

  // 6. Finance route is valid
  check('finance_route_valid',
    ['Standard', 'Phoenix', 'OtherReview'].includes(job.finance_route),
    'Finance route: ' + (job.finance_route || 'missing'),
    true);

  // 7. Deposit confirmed (blocking)
  const depositOk = !!job.deposit_bank_confirmed_at;
  check('deposit_confirmed', depositOk,
    depositOk ? 'Deposit confirmed at ' + job.deposit_bank_confirmed_at : 'Deposit not yet confirmed',
    true);

  // 8. Gross amount present
  const grossOk = typeof job.original_gross_pence === 'number' && job.original_gross_pence > 0;
  check('gross_amount_present', grossOk,
    grossOk ? 'Gross: ' + job.original_gross_pence + ' pence' : 'Gross amount missing or zero',
    false);

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

  function createTask(template, ownerId, dueAt, priority) {
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
      backup_id: null,
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
  if (!job.deposit_bank_confirmed_at) {
    const tpl = getTemplate('PRE01');
    if (tpl) createTask(tpl, tanyaId, nextStaffedDay(now, holidays), 1);
  }

  // PRE02: Check contract sent/signed — if not yet Sent or Signed
  if (!['Sent', 'Signed'].includes(job.contract_status)) {
    const tpl = getTemplate('PRE02');
    if (tpl) createTask(tpl, tanyaId, nextStaffedDay(now, holidays), 1);
  }

  // PRE03: Confirm bank deposit — if not yet confirmed
  if (!job.deposit_bank_confirmed_at) {
    const tpl = getTemplate('PRE03');
    if (tpl) createTask(tpl, adminId, nextStaffedDay(now, holidays), 2);
  }

  // BKG01: Prepare booking — always create when booking linked
  if (job.booking_submission_id) {
    const tpl = getTemplate('BKG01');
    if (tpl) createTask(tpl, tanyaId, nextStaffedDay(now, holidays), 1);
  }

  // BKG04: Send customer booking email — if booking confirmed
  if (job.sold_booking_match_status === 'Match') {
    const tpl = getTemplate('BKG04');
    if (tpl) createTask(tpl, tanyaId, nextStaffedDay(now, holidays), 2);
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
  if (installDate && !job.deposit_bank_confirmed_at) {
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

function processBookingGates(jobId, store, options = {}) {
  const job = store.get('Jobs', jobId);
  if (!job) return { error: 'JOB_NOT_FOUND', job_id: jobId };

  const gates = evaluateBookingGates(job, store);
  let taskResult = { created: [], skipped: [], errors: [], task_count: 0 };

  // Only create tasks if there's at least a booking link
  if (job.booking_submission_id || job.sold_submission_id) {
    taskResult = createTasksForJob(job, gates, store, options);
  }

  // Update workflow stage if ready
  if (gates.ready && job.workflow_stage === 'BookingInProgress') {
    store.update('Jobs', job.id, {
      workflow_stage: 'Booked',
      booking_approved_at: new Date().toISOString(),
      booking_approved_by: 'S06-gates',
      updated_at: new Date().toISOString(),
      updated_by: 'S06-gates',
      version: (job.version || 0) + 1
    });
    gates.workflow_stage = 'Booked';
    gates.stage_advanced = true;
  }

  return {
    job_id: job.id,
    job_id_human: job.job_id,
    gates,
    tasks: taskResult,
    success: !gates.blocked
  };
}

module.exports = {
  DEV_SHEET_ID,
  evaluateBookingGates, createTasksForJob, processBookingGates,
  isStaffedDay, nextStaffedDay, fridayBefore, resolvePersonByRole
};
