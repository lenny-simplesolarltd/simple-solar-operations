/* S12 commissioning — templates, submissions, answers, equipment, handover.
 * Uses canonical Commissioning* tables, JobEquipment, Handover, Evidence.
 * FN-06/07/08 govern S12. No real installer app. DEV synthetic only. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

function buildSyntheticTemplate(id, trade, equipmentType) {
  const now = new Date().toISOString();
  return { id, trade, equipment_type: equipmentType, template_version: 'S12-DEV-1.0',
    effective_from: '2026-09-06', active: true, approved_by: null, approved_at: null,
    created_at: now, created_by: 'S12-fixture', updated_at: now, updated_by: 'S12-fixture',
    version: 1, commit_id: 'S12-fixture' };
}

function buildSyntheticQuestion(id, templateId, key, label, dataType, order, requiredWhen) {
  const now = new Date().toISOString();
  return { id, template_id: templateId, question_key: key, label, data_type: dataType,
    required_when: requiredWhen || null, allowed_values: null, photo_category: null,
    review_rule: null, help_text: null, display_order: order,
    created_at: now, created_by: 'S12-fixture', updated_at: now, updated_by: 'S12-fixture',
    version: 1, commit_id: 'S12-fixture' };
}

function createSubmission(store, jobId, wpId, allocationId, installerId, templateVersion) {
  const now = new Date().toISOString();
  const id = 'CS-' + wpId;
  const existing = store.get('CommissioningSubmissions', id);
  if (existing) {
    if (existing.status === 'Accepted') return { created: false, submission: existing, status: 'AlreadyAccepted' };
    return { created: false, submission: existing, status: 'AlreadyExists' };
  }

  const sub = { id, job_id: jobId, work_package_id: wpId, allocation_id: allocationId,
    installer_id: installerId, template_version: templateVersion,
    status: 'Draft', submitted_at: null, reviewed_at: null, reviewed_by: null,
    review_notes: null, supersedes_submission_id: null,
    created_at: now, created_by: 'S12-commissioning', updated_at: now, updated_by: 'S12-commissioning',
    version: 1, commit_id: id };
  store.insert('CommissioningSubmissions', sub);
  return { created: true, submission: sub, status: 'Created' };
}

function submitAnswers(store, submissionId, answers) {
  const now = new Date().toISOString();
  const sub = store.get('CommissioningSubmissions', submissionId);
  if (!sub) return { ok: false, reason: 'Submission not found' };
  if (sub.status === 'Accepted') return { ok: false, reason: 'Already accepted' };

  const created = [];
  for (const a of answers) {
    const aid = submissionId + '-A-' + a.question_key;
    if (store.get('CommissioningAnswers', aid)) continue;
    store.insert('CommissioningAnswers', {
      id: aid, submission_id: submissionId, question_key: a.question_key,
      value_text: a.value_text || null, value_number: a.value_number || null,
      value_date: a.value_date || null, value_boolean: a.value_boolean !== undefined ? a.value_boolean : null,
      not_applicable_reason: a.not_applicable_reason || null,
      created_at: now, commit_id: aid
    });
    created.push(aid);
  }

  store.update('CommissioningSubmissions', submissionId, {
    status: 'Submitted', submitted_at: now,
    updated_at: now, updated_by: 'S12-commissioning',
    version: (sub.version || 0) + 1
  });

  return { ok: true, created: created.length, submission_id: submissionId };
}

function reviewSubmission(store, submissionId, reviewerId, status, notes) {
  const now = new Date().toISOString();
  const sub = store.get('CommissioningSubmissions', submissionId);
  if (!sub) return { ok: false, reason: 'Submission not found' };
  if (!['Accepted', 'Returned'].includes(status)) return { ok: false, reason: 'Invalid review status: ' + status };

  store.update('CommissioningSubmissions', submissionId, {
    status, reviewed_at: now, reviewed_by: reviewerId, review_notes: notes || null,
    updated_at: now, updated_by: 'S12-review', version: (sub.version || 0) + 1
  });

  return { ok: true, submission_id: submissionId, status };
}

function recordEquipment(store, jobId, wpId, equipmentType, quantity, productId) {
  const now = new Date().toISOString();
  const id = 'JE-' + wpId + '-' + equipmentType;
  const existing = store.get('JobEquipment', id);
  if (existing) return { created: false, equipment: existing };

  const eq = { id, job_id: jobId, work_package_id: wpId, equipment_type: equipmentType,
    planned_product_id: productId || null, installed_product_id: null,
    quantity, planned_location: null, installed_location: null,
    serial_number: null, commissioning_submission_id: null, variation_id: null,
    technical_review_status: 'Pending',
    created_at: now, created_by: 'S12-equipment', updated_at: now, updated_by: 'S12-equipment',
    version: 1, commit_id: id };
  store.insert('JobEquipment', eq);
  return { created: true, equipment: eq };
}

function evaluateHandover(store, jobId) {
  const job = store.get('Jobs', jobId);
  if (!job) return { ready: false, reason: 'Job not found' };

  const submissions = store.list('CommissioningSubmissions').filter(s => s.job_id === jobId);
  const allAccepted = submissions.length > 0 && submissions.every(s => s.status === 'Accepted');
  const equipment = store.list('JobEquipment').filter(e => e.job_id === jobId);

  const issues = [];
  if (!allAccepted) issues.push('Not all commissioning submissions accepted');
  if (equipment.length === 0) issues.push('No equipment recorded');

  return {
    job_id: jobId,
    ready: allAccepted && equipment.length > 0,
    submissions_count: submissions.length,
    submissions_accepted: submissions.filter(s => s.status === 'Accepted').length,
    equipment_count: equipment.length,
    issues,
    summary: allAccepted && equipment.length > 0 ? 'Ready' : 'NotReady'
  };
}

function createHandover(store, jobId, checklistVersion, docTypes) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = new Date().toISOString();
  const id = 'HO-' + jobId;
  const existing = store.get('Handover', id);
  if (existing) return { created: false, handover: existing };

  const ho = { id, job_id: jobId, checklist_version: checklistVersion,
    required_document_types: JSON.stringify(docTypes),
    completeness_status: 'Pending', generated_file_id: null, generated_version: null,
    reviewed_at: null, reviewed_by: null, approved_at: null, approved_by: null,
    sent_at: null, communication_id: null,
    created_at: now, created_by: 'S12-handover', updated_at: now, updated_by: 'S12-handover',
    version: 1, commit_id: id };
  store.insert('Handover', ho);
  return { created: true, handover: ho };
}

module.exports = {
  DEV_SHEET_ID,
  buildSyntheticTemplate, buildSyntheticQuestion,
  createSubmission, submitAnswers, reviewSubmission,
  recordEquipment, evaluateHandover, createHandover
};
