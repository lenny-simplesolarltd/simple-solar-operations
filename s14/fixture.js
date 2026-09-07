/* S14 DEV fixtures — financial summaries, reconciliation, exceptions, snapshots. */

const { jobFinancialSummary, reconcilePayments, invoiceStatusReport, createReportSnapshot } = require('./reporting.js');
const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  const n = '2026-11-01T00:00:00.000Z';
  function ins(t, data) { if (!store.get(t, data.id)) store.insert(t, data); }
  ins('People', { id:'PERSON-tanya',email:'tanya@dev.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:n,created_by:'S14',updated_at:n,updated_by:'S14',version:1,source_system:'S14',source_record_id:null,commit_id:'S14' });
}

function buildJob() {
  const n = '2026-11-01T00:00:00.000Z';
  return { id:'J-s14-ready',job_id:'SS-S14R-EADY',customer_id:'CUST-s14',display_name:'S14 Report Test',sold_submission_id:'S14-sold',booking_submission_id:'S14-booking',sold_at:'2026-10-01T00:00:00.000Z',salesperson_id:null,lead_source:'S14',quote_reference:'Q-S14',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S14',contract_signed_at:'2026-10-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-10-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:null,deposit_bank_confirmed_by:null,deposit_bank_reference:null,roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Booked',booking_approved_at:'2026-10-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-11-15T00:00:00.000Z',account_policy_version:null,pilot_job:true,release_scope:'R4',created_at:n,created_by:'S14',updated_at:n,updated_by:'S14',version:1,source_system:'S14-fixture',source_record_id:null,commit_id:'S14' };
}

function seedStages(store, jobId) {
  const n = '2026-11-01T00:00:00.000Z';
  function ins(id, stage, gross, due, status) {
    if (!store.get('InvoiceStages', id)) {
      store.insert('InvoiceStages', { id, job_id: jobId, stage, amount_net_pence: Math.round(gross/1.2), vat_pence: gross - Math.round(gross/1.2), gross_pence: gross, due_date: due, status, xero_invoice_id: null, invoice_number: null, xero_contact_id: null, reference: null, request_id: null, last_synced_at: null, source_status: null, sent_at: null, cancelled_at: null, created_at: n, created_by:'S14', updated_at:n, updated_by:'S14', version:1, source_system:'S14', commit_id:id });
    }
  }
  ins('IS-' + jobId + '-deposit', 'deposit', 120000, '2026-10-20', 'Confirmed');
  ins('IS-' + jobId + '-interim', 'interim', 168000, '2026-11-13', 'Pending');
}

function seedPayment(store, stageId, amount, ref) {
  const n = '2026-11-01T00:00:00.000Z';
  const id = 'PAY-' + stageId;
  if (!store.get('Payments', id)) {
    store.insert('Payments', { id, invoice_stage_id: stageId, xero_payment_id: ref || null, amount_pence: amount, payment_date: '2026-10-25', status: 'Confirmed', reconciliation_evidence: null, last_synced_at: null, created_at: n, commit_id: id });
  }
}

function runFinancialSummary(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  seedStages(store, job.id);
  seedPayment(store, 'IS-' + job.id + '-deposit', 120000, 'XRO-PAY-001');

  const r = jobFinancialSummary(job.id, store, '2026-11-20');
  return {
    test: 'Financial summary',
    pass: r.gross === 480000 && r.invoiced === 288000 && r.total_paid === 120000 &&
      r.outstanding === 168000 && r.overdue_amount > 0 && !r.financially_complete,
    invoiced: r.invoiced, paid: r.total_paid, outstanding: r.outstanding, overdue: r.overdue_amount
  };
}

function runReconciliation(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  seedStages(store, job.id);
  seedPayment(store, 'IS-' + job.id + '-deposit', 120000, 'XRO-PAY-001');
  // Second payment with same xero ref but different internal id
  if (!store.get('Payments', 'PAY-dup')) {
    store.insert('Payments', { id:'PAY-dup', invoice_stage_id: 'IS-' + job.id + '-deposit', xero_payment_id: 'XRO-PAY-001', amount_pence: 0, payment_date: '2026-10-26', status: 'Confirmed', reconciliation_evidence: null, last_synced_at: null, created_at: '2026-11-01T00:00:00.000Z', commit_id: 'PAY-dup' });
  }

  const r = reconcilePayments(job.id, store);
  return { test: 'Reconciliation exceptions', pass: r.exception_count > 0 && r.exceptions.some(e => e.type === 'DUPLICATE_PAYMENT_REF'), exceptions: r.exception_count };
}

function runInvoiceStatus(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  seedStages(store, job.id);
  // Set interim due date to the past so it's overdue
  store.update('InvoiceStages', 'IS-' + job.id + '-interim', { due_date: '2026-08-01' });

  const r = invoiceStatusReport(job.id, store);
  const interim = r.find(s => s.stage === 'interim');
  return { test: 'Invoice status report', pass: r.length === 2 && interim && interim.outstanding > 0 && interim.overdue === true };
}

function runSnapshot(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  seedStages(store, job.id);
  seedPayment(store, 'IS-' + job.id + '-deposit', 120000, 'XRO-PAY-001');

  const r = createReportSnapshot(store, 'monthly', [job.id], '2026-11-01', '2026-11-30');
  const r2 = createReportSnapshot(store, 'monthly', [job.id], '2026-11-01', '2026-11-30');
  return { test: 'Report snapshot idempotent', pass: r.created && !r2.created && r.job_count === 1 };
}

function runFinancialCompletion(store) {
  installBaseFixture(store);
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  seedStages(store, job.id);
  seedPayment(store, 'IS-' + job.id + '-deposit', 120000, 'XRO-PAY-001');

  // Deposit+Interim paid, Final absent → NOT financially complete
  const r = jobFinancialSummary(job.id, store, '2026-11-20');
  // Pay interim too — still not complete because Final doesn't exist
  seedPayment(store, 'IS-' + job.id + '-interim', 168000, 'XRO-PAY-002');
  const r2 = jobFinancialSummary(job.id, store, '2026-11-20');
  // Now set operational milestone and create Final stage, then pay it
  store.update('Jobs', job.id, { operational_complete_at: '2026-12-01T00:00:00.000Z', operational_complete_by: 'PERSON-tanya', updated_at: new Date().toISOString(), version: (job.version || 0) + 1 });
  const n = '2026-12-01T00:00:00.000Z';
  if (!store.get('InvoiceStages', 'IS-' + job.id + '-final')) {
    store.insert('InvoiceStages', { id: 'IS-' + job.id + '-final', job_id: job.id, stage: 'final', amount_net_pence: 160000, vat_pence: 32000, gross_pence: 192000, due_date: null, status: 'Pending', xero_invoice_id: null, invoice_number: null, xero_contact_id: null, reference: null, request_id: null, last_synced_at: null, source_status: null, sent_at: null, cancelled_at: null, created_at: n, created_by:'S14', updated_at:n, updated_by:'S14', version:1, source_system:'S14', commit_id:'IS-' + job.id + '-final' });
  }
  seedPayment(store, 'IS-' + job.id + '-final', 192000, 'XRO-PAY-003');
  const r3 = jobFinancialSummary(job.id, store, '2026-12-01');

  return { test: 'Financial completion',
    pass: !r.financially_complete && !r2.financially_complete && r3.financially_complete,
    before_op: r.financially_complete,
    deposit_interim_paid: r2.financially_complete,
    all_three_paid: r3.financially_complete
  };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) store.insert('People', { id:'PERSON-tanya',email:'tanya@dev.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  seedStages(store, job.id);
  jobFinancialSummary(job.id, store, '2026-11-20');
  return { test: 'Unrelated rows untouched', pass: before === JSON.stringify(store.get('People', 'PERSON-tanya')) };
}

module.exports = {
  DEV_SHEET_ID, installBaseFixture, buildJob, seedStages, seedPayment,
  runFinancialSummary, runReconciliation, runInvoiceStatus,
  runSnapshot, runFinancialCompletion, runUnrelatedRowsUntouched
};
