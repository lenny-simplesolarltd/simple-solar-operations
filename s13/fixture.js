/* S13 DEV fixtures — payment stages, deposit, interim chase, GHL. */

const { buildInvoiceStages, confirmDeposit, createInterimChaseTask, createGHLTask, processJobPayments } = require('./payments.js');
const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  const n = '2026-11-01T00:00:00.000Z';
  function ins(t, data) { if (!store.get(t, data.id)) store.insert(t, data); }
  ins('People', { id:'PERSON-tanya',email:'tanya@dev.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:n,created_by:'S13',updated_at:n,updated_by:'S13',version:1,source_system:'S13',source_record_id:null,commit_id:'S13' });
  ins('People', { id:'PERSON-ben',email:'ben@dev.example.invalid',display_name:'Ben Quick',role:'Admin',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:n,created_by:'S13',updated_at:n,updated_by:'S13',version:1,source_system:'S13',source_record_id:null,commit_id:'S13' });
  ins('PersonRoles', { id:'PROLE-tanya-office',person_id:'PERSON-tanya',role:'Office',active:true,created_at:n,created_by:'S13',updated_at:n,updated_by:'S13',version:1,source_system:'S13',commit_id:'S13' });
  ins('PersonRoles', { id:'PROLE-ben-admin',person_id:'PERSON-ben',role:'Admin',active:true,created_at:n,created_by:'S13',updated_at:n,updated_by:'S13',version:1,source_system:'S13',commit_id:'S13' });
}

function buildJob() {
  return { id:'J-s13-ready',job_id:'SS-S13R-EADY',customer_id:'CUST-s13',display_name:'S13 Payment Test',sold_submission_id:'S13-sold',booking_submission_id:'S13-booking',sold_at:'2026-10-01T00:00:00.000Z',salesperson_id:null,lead_source:'S13',quote_reference:'Q-S13',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S13',contract_signed_at:'2026-10-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-10-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:null,deposit_bank_confirmed_by:null,deposit_bank_reference:null,roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Booked',booking_approved_at:'2026-10-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-11-15T00:00:00.000Z',account_policy_version:null,pilot_job:true,release_scope:'R1',created_at:'2026-10-01T00:00:00.000Z',created_by:'S13',updated_at:'2026-10-20T00:00:00.000Z',updated_by:'S13',version:1,source_system:'S13-fixture',source_record_id:null,commit_id:'S13' };
}

function runStageSplit(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const r = buildInvoiceStages(job.id, 480000, store);
  const stages = store.list('InvoiceStages').filter(s => s.job_id === job.id);
  const deposit = stages.find(s => s.stage === 'deposit');
  const interim = stages.find(s => s.stage === 'interim');
  const final = stages.find(s => s.stage === 'final');
  return { test: 'Stage split 25/35 (Final gated)', pass: r.created === 2 && deposit && deposit.gross_pence === 120000 && interim && interim.gross_pence === 168000 && !final };
}

function runDepositConfirm(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  buildInvoiceStages(job.id, 480000, store);
  const r = confirmDeposit(store, job.id, 'PERSON-ben', 'DEP-REF-001');
  const stage = store.get('InvoiceStages', 'IS-' + job.id + '-deposit');
  const jobAfter = store.get('Jobs', job.id);
  return { test: 'Deposit confirmed', pass: !!(r.ok && stage && stage.status === 'Confirmed' && jobAfter && jobAfter.deposit_bank_confirmed_at) };
}

function runDepositIdempotent(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  buildInvoiceStages(job.id, 480000, store);
  confirmDeposit(store, job.id, 'PERSON-ben', 'DEP-001');
  const r = confirmDeposit(store, job.id, 'PERSON-ben', 'DEP-002');
  return { test: 'Deposit idempotent', pass: r.ok && !r.confirmed };
}

function runInterimFriday(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  buildInvoiceStages(job.id, 480000, store);
  const stage = store.get('InvoiceStages', 'IS-' + job.id + '-interim');
  // 2026-11-15 is a Sunday → Friday before is 2026-11-13
  return { test: 'Interim due Friday before install', pass: stage && stage.due_date === '2026-11-13', due_date: stage ? stage.due_date : null };
}

function runInterimChase(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const r = createInterimChaseTask(store, job.id);
  const r2 = createInterimChaseTask(store, job.id);
  return { test: 'Interim chase task once', pass: r.created && !r2.created };
}

function runFinalGatedByOperationalMilestone(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const r = processJobPayments(job.id, store);
  const beforeFinal = store.get('InvoiceStages', 'IS-' + job.id + '-final');
  // Set operational milestone
  store.update('Jobs', job.id, { operational_complete_at: '2026-12-01T00:00:00.000Z', operational_complete_by: 'PERSON-tanya', updated_at: new Date().toISOString(), version: (job.version || 0) + 1 });
  const r2 = processJobPayments(job.id, store);
  const afterFinal = store.get('InvoiceStages', 'IS-' + job.id + '-final');
  return { test: 'Final gated by operational milestone', pass: r.final_blocked === true && !beforeFinal && r2.final_eligible === true && !!afterFinal, final_created: !!afterFinal };
}

function runProcessJobPayments(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const r = processJobPayments(job.id, store);
  const tasks = store.list('Tasks').filter(t => t.job_id === job.id);
  return { test: 'Full payment processing', pass: r.ok && r.stages_created === 2 && r.final_blocked === true && r.xero_intents === 2 && tasks.length >= 2 };
}

function runNoRealOutbound(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  processJobPayments(job.id, store);
  const outbox = store.list('Outbox').filter(o => o.correlation_id && o.correlation_id.startsWith('XI-'));
  const allCapture = outbox.every(o => o.response_summary && o.response_summary.includes('CAPTURE_ONLY'));
  return { test: 'No real Xero calls', pass: outbox.length === 2 && allCapture };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) store.insert('People', { id:'PERSON-tanya',email:'tanya@dev.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  processJobPayments(job.id, store);
  return { test: 'Unrelated rows untouched', pass: before === JSON.stringify(store.get('People', 'PERSON-tanya')) };
}

module.exports = {
  DEV_SHEET_ID, installBaseFixture, buildJob,
  runStageSplit, runDepositConfirm, runDepositIdempotent,
  runInterimFriday, runInterimChase, runProcessJobPayments,
  runFinalGatedByOperationalMilestone, runNoRealOutbound, runUnrelatedRowsUntouched
};
