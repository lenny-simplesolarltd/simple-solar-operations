/* S12 DEV fixtures — minimal commissioning/handover set. */

const { buildSyntheticTemplate, buildSyntheticQuestion, createSubmission, submitAnswers, reviewSubmission, recordEquipment, evaluateHandover, createHandover } = require('./commissioning.js');
const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  const n = '2026-09-06T00:00:00.000Z';
  function ins(t, data) { if (!store.get(t, data.id)) store.insert(t, data); }

  ins('CommissioningTemplates', buildSyntheticTemplate('TPL-COM-ROOF', 'Roof', 'Solar'));
  ins('CommissioningQuestions', buildSyntheticQuestion('Q-COM-001', 'TPL-COM-ROOF', 'panel_count', 'Number of panels installed', 'number', 1, 'always'));
  ins('CommissioningQuestions', buildSyntheticQuestion('Q-COM-002', 'TPL-COM-ROOF', 'inverter_model', 'Inverter model', 'text', 2, 'always'));
  ins('CommissioningQuestions', buildSyntheticQuestion('Q-COM-003', 'TPL-COM-ROOF', 'roof_photo', 'Roof photo', 'photo', 3, null));

  ins('People', { id:'PERSON-installer-a',email:'installer-a@dev.example.invalid',display_name:'Installer A',role:'Installer',active:true,calendar_id:null,notification_email:null,capacity_per_day:1,available_from:'2026-01-01',available_to:'2026-12-31',backup_person_id:null,company_id:null,created_at:n,created_by:'S12',updated_at:n,updated_by:'S12',version:1,source_system:'S12',source_record_id:null,commit_id:'S12' });
  ins('PersonRoles', { id:'PROLE-installer-a',person_id:'PERSON-installer-a',role:'Installer',active:true,created_at:n,created_by:'S12',updated_at:n,updated_by:'S12',version:1,source_system:'S12',commit_id:'S12' });
  ins('People', { id:'PERSON-tanya',email:'tanya@dev.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:n,created_by:'S12',updated_at:n,updated_by:'S12',version:1,source_system:'S12',source_record_id:null,commit_id:'S12' });
}

function buildSyntheticJob() {
  const n = '2026-11-01T00:00:00.000Z';
  return { id:'J-s12-ready',job_id:'SS-S12R-EADY',customer_id:'CUST-s12',display_name:'S12 Commissioning Test',sold_submission_id:'S12-sold',booking_submission_id:'S12-booking',sold_at:'2026-10-01T00:00:00.000Z',salesperson_id:null,lead_source:'S12',quote_reference:'Q-S12',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S12',contract_signed_at:'2026-10-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-10-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-10-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-S12',roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Aftercare',booking_approved_at:'2026-10-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:null,account_policy_version:null,pilot_job:true,release_scope:'R3',created_at:n,created_by:'S12',updated_at:n,updated_by:'S12',version:1,source_system:'S12-fixture',source_record_id:null,commit_id:'S12' };
}

function runSubmissionCreate(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('WorkPackages', 'WP-s12')) store.insert('WorkPackages', { id:'WP-s12',job_id:job.id,trade:'Roof',required:true,status:'ReportedComplete',commissioning_required:true,sequence:1,revision:1,created_at:'2026-11-01T00:00:00.000Z',created_by:'S12',updated_at:'2026-11-01T00:00:00.000Z',updated_by:'S12',version:1,source_system:'S12',commit_id:'S12' });

  const r = createSubmission(store, job.id, 'WP-s12', 'ALLOC-s12', 'PERSON-installer-a', 'S12-DEV-1.0');
  return { test: 'Submission created', pass: r.created && r.submission.status === 'Draft', submission_id: r.submission ? r.submission.id : null };
}

function runAnswersSubmit(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('WorkPackages', 'WP-s12')) store.insert('WorkPackages', { id:'WP-s12',job_id:job.id,trade:'Roof',required:true,status:'ReportedComplete',commissioning_required:true,sequence:1,revision:1,created_at:'2026-11-01T00:00:00.000Z',created_by:'S12',updated_at:'2026-11-01T00:00:00.000Z',updated_by:'S12',version:1,source_system:'S12',commit_id:'S12' });

  createSubmission(store, job.id, 'WP-s12', 'ALLOC-s12', 'PERSON-installer-a', 'S12-DEV-1.0');
  const r = submitAnswers(store, 'CS-WP-s12', [
    { question_key: 'panel_count', value_number: 10 },
    { question_key: 'inverter_model', value_text: 'Inverter-X' }
  ]);

  const sub = store.get('CommissioningSubmissions', 'CS-WP-s12');
  return { test: 'Answers submitted', pass: r.ok && sub && sub.status === 'Submitted', answers: r.created };
}

function runReviewAccept(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('WorkPackages', 'WP-s12')) store.insert('WorkPackages', { id:'WP-s12',job_id:job.id,trade:'Roof',required:true,status:'ReportedComplete',commissioning_required:true,sequence:1,revision:1,created_at:'2026-11-01T00:00:00.000Z',created_by:'S12',updated_at:'2026-11-01T00:00:00.000Z',updated_by:'S12',version:1,source_system:'S12',commit_id:'S12' });

  createSubmission(store, job.id, 'WP-s12', 'ALLOC-s12', 'PERSON-installer-a', 'S12-DEV-1.0');
  submitAnswers(store, 'CS-WP-s12', [{ question_key: 'panel_count', value_number: 10 }]);
  const r = reviewSubmission(store, 'CS-WP-s12', 'PERSON-tanya', 'Accepted', 'Looks good');

  const sub = store.get('CommissioningSubmissions', 'CS-WP-s12');
  return { test: 'Review accepted', pass: r.ok && sub && sub.status === 'Accepted', status: sub ? sub.status : null };
}

function runEquipmentRecord(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);

  const r = recordEquipment(store, job.id, 'WP-s12', 'Solar', 10, 'PROD-P460');
  return { test: 'Equipment recorded', pass: r.created && r.equipment.quantity === 10 };
}

function runHandoverCreate(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('WorkPackages', 'WP-s12')) store.insert('WorkPackages', { id:'WP-s12',job_id:job.id,trade:'Roof',required:true,status:'ReportedComplete',commissioning_required:true,sequence:1,revision:1,created_at:'2026-11-01T00:00:00.000Z',created_by:'S12',updated_at:'2026-11-01T00:00:00.000Z',updated_by:'S12',version:1,source_system:'S12',commit_id:'S12' });

  createSubmission(store, job.id, 'WP-s12', 'ALLOC-s12', 'PERSON-installer-a', 'S12-DEV-1.0');
  submitAnswers(store, 'CS-WP-s12', [{ question_key: 'panel_count', value_number: 10 }]);
  reviewSubmission(store, 'CS-WP-s12', 'PERSON-tanya', 'Accepted', 'OK');
  recordEquipment(store, job.id, 'WP-s12', 'Solar', 10, 'PROD-P460');

  const eval_ = evaluateHandover(store, job.id);
  const r = createHandover(store, job.id, 'S12-DEV-1.0', ['certificate', 'checklist', 'photos']);

  return { test: 'Handover created', pass: eval_.ready && r.created, ready: eval_.ready, handover_id: r.handover ? r.handover.id : null };
}

function runIdempotentReplay(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);

  const first = recordEquipment(store, job.id, 'WP-s12', 'Solar', 10, 'PROD-P460');
  const second = recordEquipment(store, job.id, 'WP-s12', 'Solar', 10, 'PROD-P460');

  return { test: 'Equipment idempotent', pass: first.created && !second.created };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@dev.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }
  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  recordEquipment(store, job.id, 'WP-s12', 'Solar', 10, 'PROD-P460');
  return { test: 'Unrelated rows untouched', pass: before === JSON.stringify(store.get('People', 'PERSON-tanya')) };
}

module.exports = {
  DEV_SHEET_ID,
  installBaseFixture, buildSyntheticJob,
  runSubmissionCreate, runAnswersSubmit, runReviewAccept,
  runEquipmentRecord, runHandoverCreate, runIdempotentReplay,
  runUnrelatedRowsUntouched
};
