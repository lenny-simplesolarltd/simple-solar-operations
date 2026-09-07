/* S09 DEV fixtures — minimal scaffold set.
 * A: Scaffold required → booking created
 * B: Scaffold not required → no booking
 * C: Replay → no duplicate
 * D: Already booked → reused */

const { processJobScaffolding, evaluateScaffoldRequirement } = require('./scaffold.js');
const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  const n = '2026-09-01T00:00:00.000Z';
  if (!store.get('Companies', 'COMP-scaffold-dev')) {
    store.insert('Companies', { id:'COMP-scaffold-dev',name:'DEV Scaffold Co',type:'Scaffolder',active:true,standard_lead_days:7,delivery_weekday:null,notes:'Synthetic DEV scaffolder only',created_at:n,created_by:'S09-fixture',updated_at:n,updated_by:'S09-fixture',version:1,source_system:'S09-fixture',commit_id:'S09-fixture' });
  }
  if (!store.get('TaskTemplates', 'TPL-SCA01')) {
    store.insert('TaskTemplates', { id:'TPL-SCA01',template_code:'SCA01',title:'Notify and confirm scaffolder erect',group:'Materials',default_owner_role:'Office',trigger_event:'Scheduled erect',due_rule:'Before need date per lead time',evidence_required:'Latest revision confirmed',active:true,template_version:'1.0',created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,commit_id:'fixture' });
  }
  if (!store.get('PersonRoles', 'PROLE-tanya-office')) {
    store.insert('PersonRoles', { id:'PROLE-tanya-office',person_id:'PERSON-tanya',role:'Office',active:true,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@test.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }
}

function buildJob(scaffoldRequired, id, jobId) {
  return { id:id||'J-s09-ready',job_id:jobId||'SS-S09R-EADY',customer_id:'CUST-s09',display_name:'S09 Scaffold Test',sold_submission_id:'S09-sold',booking_submission_id:'S09-booking',sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S09',quote_reference:'Q-S09',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S09',contract_signed_at:'2026-08-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-S09',roof_required:true,electrical_required:false,scaffold_required:scaffoldRequired,workflow_stage:'Booked',booking_approved_at:'2026-08-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:true,release_scope:'R2',created_at:'2026-08-01T00:00:00.000Z',created_by:'S09',updated_at:'2026-08-20T00:00:00.000Z',updated_by:'S09',version:1,source_system:'S09',source_record_id:null,commit_id:'S09' };
}

function runScaffoldRequired(store) {
  installBaseFixture(store);
  const job = buildJob(true);
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const result = processJobScaffolding(job.id, store);
  return {
    test: 'Scaffold required — booking created',
    pass: result.success && store.list('ScaffoldBookings').filter(b => b.job_id === job.id).length === 1 && store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'SCA01').length === 1,
    booking_created: result.booking.created,
    task_created: result.tasks.created.length > 0
  };
}

function runScaffoldNotRequired(store) {
  installBaseFixture(store);
  const job = buildJob(false, 'J-s09-noscaff', 'SS-S09N-OSCF');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const result = processJobScaffolding(job.id, store);
  return {
    test: 'Scaffold not required — no booking',
    pass: !result.success && result.requirement.summary === 'NotRequired' && store.list('ScaffoldBookings').length === 0
  };
}

function runReplayNoDuplicate(store) {
  installBaseFixture(store);
  const job = buildJob(true);
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  processJobScaffolding(job.id, store);
  const count = store.list('ScaffoldBookings').length;
  const second = processJobScaffolding(job.id, store);
  return {
    test: 'Replay no duplicate booking',
    pass: !second.booking.created && store.list('ScaffoldBookings').length === count
  };
}

function runInternalJobLinkage(store) {
  installBaseFixture(store);
  const job = buildJob(true);
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  processJobScaffolding(job.id, store);
  const booking = store.get('ScaffoldBookings', 'SB-' + job.id);
  return { test: 'Internal Jobs.id linkage', pass: booking && booking.job_id === job.id };
}

function runTaskOwnerCorrect(store) {
  installBaseFixture(store);
  const job = buildJob(true);
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  processJobScaffolding(job.id, store);
  const tasks = store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'SCA01');
  return { test: 'Task owner correct', pass: tasks.length === 1 && tasks[0].owner_id === 'PERSON-tanya' };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@test.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }
  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildJob(true);
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  processJobScaffolding(job.id, store);
  return { test: 'Unrelated rows untouched', pass: before === JSON.stringify(store.get('People', 'PERSON-tanya')) };
}

module.exports = {
  DEV_SHEET_ID,
  installBaseFixture, buildJob,
  runScaffoldRequired, runScaffoldNotRequired, runReplayNoDuplicate,
  runInternalJobLinkage, runTaskOwnerCorrect, runUnrelatedRowsUntouched
};
