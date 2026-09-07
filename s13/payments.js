/* S13 payments — invoice stages, payment tracking, GHL tasks, Xero intents.
 * Uses canonical InvoiceStages, Payments, GHLTasks, Jobs, Tasks tables.
 * FN-09 (R4), FN-11 (R1 Manual), FN-15 (R1 Manual) govern S13.
 * No real Xero/GHL calls. Durable intents/manual actions only. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));
const STAGES = { deposit: 25, interim: 35, final: 40 };

function buildInvoiceStages(jobId, grossPence, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = options.now || new Date().toISOString();
  const existing = store.list('InvoiceStages').filter(s => s.job_id === jobId);
  if (existing.length >= 3) return { created: 0, stages: existing, status: 'AlreadyExists' };

  const job = store.get('Jobs', jobId);
  const created = [];
  for (const [stage, pct] of Object.entries(STAGES)) {
    const id = 'IS-' + jobId + '-' + stage;
    if (store.get('InvoiceStages', id)) continue;

    // Final stage requires operational completion (authoritative trigger: operational milestone)
    if (stage === 'final' && (!job || !job.operational_complete_at)) continue;

    const gross = Math.round(grossPence * pct / 100);
    const net = Math.round(gross / 1.2);
    const vat = gross - net;

    const dueDate = stage === 'interim' ? fridayBeforeInstall(store, jobId) : null;

    store.insert('InvoiceStages', {
      id, job_id: jobId, stage,
      amount_net_pence: net, vat_pence: vat, gross_pence: gross,
      due_date: dueDate,
      status: 'Pending', xero_invoice_id: null, invoice_number: null,
      xero_contact_id: null, reference: null, request_id: null,
      last_synced_at: null, source_status: null,
      sent_at: null, cancelled_at: null,
      created_at: now, created_by: 'S13-payments',
      updated_at: now, updated_by: 'S13-payments',
      version: 1, source_system: 'S13-payments', commit_id: id
    });
    created.push(id);
  }
  return { created: created.length, stages: store.list('InvoiceStages').filter(s => s.job_id === jobId), status: 'Created' };
}

function confirmDeposit(store, jobId, confirmedBy, reference) {
  const now = new Date().toISOString();
  const stage = store.get('InvoiceStages', 'IS-' + jobId + '-deposit');
  if (!stage) return { ok: false, reason: 'Deposit stage not found' };
  if (stage.status === 'Confirmed') return { ok: true, confirmed: false, reason: 'Already confirmed' };

  store.update('InvoiceStages', stage.id, {
    status: 'Confirmed', reference: reference || null,
    updated_at: now, updated_by: 'S13-deposit', version: (stage.version || 0) + 1
  });

  // Update Job deposit fields
  const job = store.get('Jobs', jobId);
  if (job) {
    store.update('Jobs', jobId, {
      deposit_bank_confirmed_at: now, deposit_bank_confirmed_by: confirmedBy,
      deposit_bank_reference: reference || null,
      updated_at: now, updated_by: 'S13-deposit', version: (job.version || 0) + 1
    });
  }

  return { ok: true, confirmed: true, stage_id: stage.id };
}

function createXeroIntent(store, jobId, stage) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = new Date().toISOString();
  const stageRec = store.get('InvoiceStages', 'IS-' + jobId + '-' + stage);
  if (!stageRec) return { ok: false, reason: 'Stage not found' };

  const intentId = 'XI-' + jobId + '-' + stage;
  const existing = store.get('Outbox', intentId);
  if (existing) return { ok: true, created: false, intent: existing, reason: 'Already exists' };

  store.insert('Outbox', {
    id: intentId, idempotency_key: 'S13-XERO-' + jobId + '-' + stage,
    action_type: 'XeroInvoice', target: stageRec.xero_contact_id || 'NOT_CONFIGURED',
    payload_hash: JSON.stringify({ job_id: jobId, stage, gross_pence: stageRec.gross_pence }),
    job_revision: stageRec.version, attempt_count: 0, next_attempt: null,
    external_id: null, response_summary: 'CAPTURE_ONLY: no Xero API call',
    correlation_id: intentId, status: 'Pending',
    created_at: now, commit_id: intentId
  });

  return { ok: true, created: true, intent_id: intentId };
}

function createInterimChaseTask(store, jobId) {
  const now = new Date().toISOString();
  const key = 'S13-INTERIM-CHASE-' + jobId;
  const exists = store.list('Tasks').find(t => t.instance_key === key);
  if (exists) return { created: false, task_id: exists.id, reason: 'Already exists' };

  const task = {
    id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    job_id: jobId, template_code: 'S13-INTERIM-CHASE', instance_key: key,
    group: 'Finance', title: 'Chase unpaid interim payment',
    owner_id: 'PERSON-tanya', backup_id: null,
    related_entity_type: 'Jobs', related_entity_id: jobId,
    due_at: now, original_due_at: now, priority: 1, status: 'Open',
    blocking_reason: null, next_followup_at: null,
    completed_at: null, completed_by: null, completion_note: null,
    evidence_id: null, revision_required: false,
    created_rule_version: 'S13-1.0',
    created_at: now, created_by: 'S13-payments',
    updated_at: now, updated_by: 'S13-payments',
    version: 1, source_system: 'S13-payments',
    commit_id: 'S13-' + key
  };
  store.insert('Tasks', task);
  return { created: true, task_id: task.id };
}

function createGHLTask(store, jobId) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = new Date().toISOString();
  const key = 'S13-GHL-' + jobId;
  const exists = store.list('Tasks').find(t => t.instance_key === key);
  if (exists) return { created: false, task_id: exists.id };

  const task = {
    id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    job_id: jobId, template_code: 'S13-GHL-PROGRESSION', instance_key: key,
    group: 'Aftercare', title: 'Move GHL opportunity (human task)',
    owner_id: 'PERSON-tanya', backup_id: null,
    related_entity_type: 'Jobs', related_entity_id: jobId,
    due_at: null, original_due_at: null, priority: 2, status: 'Open',
    blocking_reason: null, next_followup_at: null,
    completed_at: null, completed_by: null, completion_note: null,
    evidence_id: null, revision_required: false,
    created_rule_version: 'S13-1.0',
    created_at: now, created_by: 'S13-payments',
    updated_at: now, updated_by: 'S13-payments',
    version: 1, source_system: 'S13-payments',
    commit_id: 'S13-' + key
  };
  store.insert('Tasks', task);

  // Also create GHLTasks record
  const ghlId = 'GHL-' + jobId;
  if (!store.get('GHLTasks', ghlId)) {
    store.insert('GHLTasks', {
      id: ghlId, job_id: jobId, task_id: task.id,
      opportunity_id: null, target_pipeline_id: null, target_stage_id: null,
      template_id: null, readiness_snapshot: JSON.stringify({ stage: 'payment-complete' }),
      completed_at: null, completed_by: null, evidence_reference: null,
      created_at: now, commit_id: ghlId
    });
  }

  return { created: true, task_id: task.id, ghl_task_id: ghlId };
}

function fridayBeforeInstall(store, jobId) {
  const job = store.get('Jobs', jobId);
  if (!job || !job.next_action_at) return null;
  const d = new Date(job.next_action_at);
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function processJobPayments(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const job = store.get('Jobs', jobId);
  if (!job || !job.original_gross_pence || job.original_gross_pence <= 0) {
    return { ok: false, reason: 'Job not found or no gross amount' };
  }

  const stages = buildInvoiceStages(jobId, job.original_gross_pence, store, options);
  const xeroIntents = [];
  const tasks = [];
  const finalEligible = !!(job.operational_complete_at);

  // Create Xero intents for each stage
  for (const stage of ['deposit', 'interim', 'final']) {
    if (stage === 'final' && !finalEligible) continue;
    const r = createXeroIntent(store, jobId, stage);
    xeroIntents.push(r);
  }

  // Create interim chase task
  const chase = createInterimChaseTask(store, jobId);
  tasks.push({ type: 'interim_chase', ...chase });

  // Create GHL task
  const ghl = createGHLTask(store, jobId);
  tasks.push({ type: 'ghl', ...ghl });

  return {
    ok: true,
    stages_created: stages.created,
    final_eligible: finalEligible,
    final_blocked: !finalEligible,
    final_blocked_reason: finalEligible ? null : 'Operational milestone not reached (operational_complete_at not set)',
    xero_intents: xeroIntents.length,
    tasks_created: tasks.filter(t => t.created).length,
    stages,
    xeroIntents,
    tasks
  };
}

module.exports = {
  DEV_SHEET_ID, STAGES,
  buildInvoiceStages, confirmDeposit, createXeroIntent,
  createInterimChaseTask, createGHLTask,
  fridayBeforeInstall, processJobPayments
};
