/* S14 reporting — financial summaries, reconciliation, exceptions, snapshots.
 * Derives from InvoiceStages, Payments, Jobs, JobCosts.
 * FN-12 (Accounting/reporting, R4 Automated) + FN-09 from S13.
 * No real Xero/GHL calls. Read-only derivations + ReportSnapshots. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));
const STAGES = { deposit: 25, interim: 35, final: 40 };

function localDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m) return null;
  return m[1] + '-' + m[2] + '-' + m[3];
}

function daysBetween(a, b) {
  return Math.floor((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/* --- Job financial summary --- */

function jobFinancialSummary(jobId, store, asOf) {
  const job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, error: 'JOB_NOT_FOUND' };

  const stages = store.list('InvoiceStages').filter(s => s.job_id === jobId);
  const payments = store.list('Payments');
  const costs = store.list('JobCosts').filter(c => c.job_id === jobId);
  const today = asOf || new Date().toISOString().slice(0, 10);

  const gross = job.original_gross_pence || job.current_contract_gross_pence || 0;
  const deposit = stages.find(s => s.stage === 'deposit');
  const interim = stages.find(s => s.stage === 'interim');
  const final = stages.find(s => s.stage === 'final');

  const invoiced = stages.reduce((sum, s) => sum + (s.gross_pence || 0), 0);
  const stagePayments = {};
  let totalPaid = 0;

  for (const s of stages) {
    const sp = payments.filter(p => p.invoice_stage_id === s.id);
    const paid = sp.reduce((sum, p) => sum + (p.amount_pence || 0), 0);
    stagePayments[s.stage] = { invoiced: s.gross_pence || 0, paid, outstanding: (s.gross_pence || 0) - paid };
    totalPaid += paid;
  }

  const outstanding = invoiced - totalPaid;

  // Overdue: stages with due_date in the past and not fully paid
  const overdue = stages.filter(s => {
    if (!s.due_date) return false;
    const due = localDate(s.due_date);
    if (!due) return false;
    const sp = stagePayments[s.stage];
    return due < today && sp && sp.outstanding > 0;
  });

  const overdueAmount = overdue.reduce((sum, s) => {
    const sp = stagePayments[s.stage];
    return sum + (sp ? sp.outstanding : 0);
  }, 0);

  const totalCosts = costs.reduce((sum, c) => sum + (c.amount_net_pence || 0) + (c.vat_pence || 0), 0);

  // Financial completion: operational milestone reached + all 3 required stages exist + all fully paid.
  // A job with only Deposit+Interim paid but Final not yet created must NOT be financially complete.
  const requiredStages = ['deposit', 'interim', 'final'];
  const allRequiredExist = requiredStages.every(s => stages.find(x => x.stage === s));
  const allRequiredPaid = allRequiredExist && requiredStages.every(s => {
    const sp = stagePayments[s];
    return sp && sp.outstanding === 0;
  });
  const financiallyComplete = !!(job.operational_complete_at) && allRequiredExist && allRequiredPaid;

  return {
    job_id: jobId,
    as_of: today,
    gross,
    stages_count: stages.length,
    invoiced,
    total_paid: totalPaid,
    outstanding,
    overdue_amount: overdueAmount,
    overdue_stages: overdue.map(s => s.stage),
    total_costs: totalCosts,
    financially_complete: financiallyComplete,
    stage_details: stagePayments,
    deposit_confirmed: !!(job.deposit_bank_confirmed_at),
    operational_complete: !!(job.operational_complete_at)
  };
}

/* --- Reconciliation checks --- */

function reconcilePayments(jobId, store) {
  const stages = store.list('InvoiceStages').filter(s => s.job_id === jobId);
  const payments = store.list('Payments');
  const exceptions = [];

  for (const s of stages) {
    const sp = payments.filter(p => p.invoice_stage_id === s.id);
    const totalPaid = sp.reduce((sum, p) => sum + (p.amount_pence || 0), 0);

    if (totalPaid > (s.gross_pence || 0)) {
      exceptions.push({
        type: 'OVERPAYMENT',
        stage: s.stage,
        stage_id: s.id,
        invoiced: s.gross_pence,
        paid: totalPaid,
        excess: totalPaid - (s.gross_pence || 0)
      });
    }

    // Duplicate payment references
    const refs = sp.filter(p => p.xero_payment_id).map(p => p.xero_payment_id);
    const dupes = refs.filter((r, i) => refs.indexOf(r) !== i);
    for (const d of [...new Set(dupes)]) {
      exceptions.push({
        type: 'DUPLICATE_PAYMENT_REF',
        stage: s.stage,
        reference: d
      });
    }

    // Missing external reference on paid stage
    if (totalPaid > 0 && sp.every(p => !p.xero_payment_id)) {
      exceptions.push({
        type: 'MISSING_EXTERNAL_REF',
        stage: s.stage,
        stage_id: s.id,
        paid: totalPaid
      });
    }
  }

  // Final stage created without operational milestone
  const job = store.get('Jobs', jobId);
  const finalStage = stages.find(s => s.stage === 'final');
  if (finalStage && job && !job.operational_complete_at) {
    exceptions.push({
      type: 'FINAL_BEFORE_OPERATIONAL',
      stage_id: finalStage.id
    });
  }

  return {
    job_id: jobId,
    exceptions,
    exception_count: exceptions.length,
    needs_review: exceptions.length > 0
  };
}

/* --- Invoice status report --- */

function invoiceStatusReport(jobId, store) {
  const stages = store.list('InvoiceStages').filter(s => s.job_id === jobId);
  const today = new Date().toISOString().slice(0, 10);

  return stages.map(s => {
    const due = localDate(s.due_date);
    const overdue = due && due < today && s.status !== 'Confirmed';
    const stagePayments = store.list('Payments').filter(p => p.invoice_stage_id === s.id);
    const paid = stagePayments.reduce((sum, p) => sum + (p.amount_pence || 0), 0);

    return {
      stage_id: s.id,
      stage: s.stage,
      gross: s.gross_pence || 0,
      due_date: due,
      status: s.status,
      paid,
      outstanding: (s.gross_pence || 0) - paid,
      overdue,
      xero_invoice_id: s.xero_invoice_id || null,
      has_xero_intent: !!store.list('Outbox').find(o => o.correlation_id === 'XI-' + jobId + '-' + s.stage)
    };
  });
}

/* --- Report snapshot --- */

function createReportSnapshot(store, reportType, jobIds, periodStart, periodEnd) {
  const now = new Date().toISOString();
  const id = 'RS-' + reportType + '-' + periodStart;
  const existing = store.get('ReportSnapshots', id);
  if (existing) return { created: false, snapshot: existing };

  const summaries = jobIds.map(jid => jobFinancialSummary(jid, store, periodEnd));
  const totals = {
    total_gross: summaries.reduce((s, r) => s + (r.gross || 0), 0),
    total_invoiced: summaries.reduce((s, r) => s + (r.invoiced || 0), 0),
    total_paid: summaries.reduce((s, r) => s + (r.total_paid || 0), 0),
    total_outstanding: summaries.reduce((s, r) => s + (r.outstanding || 0), 0),
    total_overdue: summaries.reduce((s, r) => s + (r.overdue_amount || 0), 0),
    job_count: summaries.length,
    financially_complete: summaries.filter(r => r.financially_complete).length
  };

  store.insert('ReportSnapshots', {
    id, period_start: periodStart, period_end: periodEnd, as_of_at: now,
    policy_version: 'S14-DEV-1.0', report_type: reportType,
    totals_json: JSON.stringify(totals),
    underlying_job_ids: JSON.stringify(jobIds),
    file_id: null, generated_by: 'S14-reporting',
    created_at: now, commit_id: id
  });

  return { created: true, snapshot_id: id, totals, job_count: summaries.length };
}

module.exports = {
  DEV_SHEET_ID, STAGES,
  localDate, daysBetween,
  jobFinancialSummary, reconcilePayments,
  invoiceStatusReport, createReportSnapshot
};
