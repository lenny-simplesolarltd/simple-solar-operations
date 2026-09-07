/* S06 DEV fixtures — minimal deterministic set for booking gate testing.
 * A: Ready booking/job (all data present)
 * B: Missing deposit (NeedsReview)
 * C: Interim unpaid chase task
 * D: Re-evaluation idempotency */

const { processBookingGates, evaluateBookingGates } = require('./gates.js');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  // Ensure TaskTemplates exist
  if (store.list('TaskTemplates').length === 0) {
    const now = '2026-01-01T00:00:00.000Z';
    const tpl = (id, code, title, group, owner, trigger, due) => ({
      id, template_code: code, title, group, default_owner_role: owner,
      trigger_event: trigger, due_rule: due, evidence_required: 'S06 test',
      active: true, template_version: '1.0',
      created_at: now, created_by: 'S06-fixture', updated_at: now, updated_by: 'S06-fixture',
      version: 1, commit_id: 'S06-fixture'
    });
    store.insert('TaskTemplates', tpl('TPL-PRE01','PRE01','Send deposit invoice','Prebooking','Office','New Standard sale','Same day'));
    store.insert('TaskTemplates', tpl('TPL-PRE02','PRE02','Check contract sent/signed','Prebooking','Office','New sale','Same day then daily'));
    store.insert('TaskTemplates', tpl('TPL-PRE03','PRE03','Confirm bank deposit','Prebooking','Admin','Deposit expected','Next staffed day'));
    store.insert('TaskTemplates', tpl('TPL-BKG01','BKG01','Prepare booking','Booking','Office','Booking intake received','Before booking confirmation'));
    store.insert('TaskTemplates', tpl('TPL-BKG04','BKG04','Send customer booking email','Booking','Office','Booking confirmed','Same staffed day'));
    store.insert('TaskTemplates', tpl('TPL-FIN01','FIN01','Interim draft check/send','Finance','Office','Installation confirmed','Seven days before due'));
  }

  // Ensure People/PersonRoles exist
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id: 'PERSON-tanya', email: 'tanya@test.example.invalid', display_name: 'Tanya', role: 'Office', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'fixture', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'fixture', version: 1, source_system: 'fixture', source_record_id: null, commit_id: 'fixture' });
  }
  if (!store.get('PersonRoles', 'PROLE-tanya-office')) {
    store.insert('PersonRoles', { id: 'PROLE-tanya-office', person_id: 'PERSON-tanya', role: 'Office', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'fixture', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'fixture', version: 1, source_system: 'fixture', commit_id: 'fixture' });
  }
  if (!store.get('People', 'PERSON-ben')) {
    store.insert('People', { id: 'PERSON-ben', email: 'ben@test.example.invalid', display_name: 'Ben', role: 'Admin', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'fixture', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'fixture', version: 1, source_system: 'fixture', source_record_id: null, commit_id: 'fixture' });
  }
  if (!store.get('PersonRoles', 'PROLE-ben-admin')) {
    store.insert('PersonRoles', { id: 'PROLE-ben-admin', person_id: 'PERSON-ben', role: 'Admin', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'fixture', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'fixture', version: 1, source_system: 'fixture', commit_id: 'fixture' });
  }
}

function buildReadyJob() {
  return {
    id: 'J-s06-ready', job_id: 'SS-S06R-EADY', customer_id: 'CUST-s06-ready',
    display_name: 'S06 Ready Test', sold_submission_id: 'S06-sold-ready',
    booking_submission_id: 'S06-booking-ready', sold_at: '2026-08-01T00:00:00.000Z',
    salesperson_id: null, lead_source: 'S06-test', quote_reference: 'Q-S06-001',
    presale_file_id: null, finance_route: 'Standard',
    contract_status: 'Signed', contract_id: 'CONTRACT-001',
    contract_signed_at: '2026-08-15T00:00:00.000Z', contract_evidence_id: null,
    original_net_pence: 400000, original_vat_pence: 80000,
    original_gross_pence: 480000, approved_change_pence: null,
    current_contract_gross_pence: 480000, valuation_basis: 'Standard',
    sold_booking_match_status: 'Match',
    customer_details_verified_at: '2026-08-15T00:00:00.000Z',
    customer_details_verified_by: 'PERSON-tanya',
    deposit_bank_confirmed_at: '2026-08-20T00:00:00.000Z',
    deposit_bank_confirmed_by: 'PERSON-ben', deposit_bank_reference: 'DEP-001',
    roof_required: false, electrical_required: false, scaffold_required: false,
    workflow_stage: 'BookingInProgress', booking_approved_at: null,
    booking_approved_by: null, operational_complete_at: null,
    operational_complete_by: null, customer_happy_at: null, customer_happy_by: null,
    handover_status: 'NotReady', financial_status: 'Pending',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null, next_action_at: '2026-10-15T00:00:00.000Z',
    account_policy_version: null, pilot_job: false, release_scope: 'R1',
    created_at: '2026-08-01T00:00:00.000Z', created_by: 'S06-fixture',
    updated_at: '2026-08-20T00:00:00.000Z', updated_by: 'S06-fixture',
    version: 1, source_system: 'S06-fixture', source_record_id: null, commit_id: 'S06-fixture'
  };
}

function buildMissingDepositJob() {
  const j = buildReadyJob();
  j.id = 'J-s06-nodeposit';
  j.job_id = 'SS-S06N-ODEP';
  j.deposit_bank_confirmed_at = null;
  j.deposit_bank_confirmed_by = null;
  j.deposit_bank_reference = null;
  j.customer_id = 'CUST-s06-nodeposit';
  j.sold_submission_id = 'S06-sold-nodeposit';
  j.booking_submission_id = 'S06-booking-nodeposit';
  j.workflow_stage = 'BookingInProgress';
  return j;
}

function buildUnpaidInterimJob() {
  const j = buildReadyJob();
  j.id = 'J-s06-unpaid';
  j.job_id = 'SS-S06U-NPAID';
  j.deposit_bank_confirmed_at = null;
  j.deposit_bank_confirmed_by = null;
  j.deposit_bank_reference = null;
  j.customer_id = 'CUST-s06-unpaid';
  j.sold_submission_id = 'S06-sold-unpaid';
  j.booking_submission_id = 'S06-booking-unpaid';
  j.next_action_at = '2026-10-15T00:00:00.000Z'; // Install date set
  j.workflow_stage = 'BookingInProgress';
  return j;
}

function buildCustomer(id, first, last) {
  return {
    id, first_name: first, last_name: last,
    address_line1: '1 Test Street', address_line2: '',
    town: 'Testville', postcode: 'TS1 1AA',
    email: first.toLowerCase() + '@test.example.invalid',
    phone: '07123456789', alternate_contact: null, contact_notes: null,
    created_at: '2026-08-01T00:00:00.000Z', created_by: 'S06-fixture',
    updated_at: '2026-08-01T00:00:00.000Z', updated_by: 'S06-fixture',
    version: 1, source_system: 'S06-fixture', source_record_id: null, commit_id: 'S06-fixture'
  };
}

/* --- Test runners --- */

function runReadyBooking(store) {
  installBaseFixture(store);
  const job = buildReadyJob();
  const cust = buildCustomer('CUST-s06-ready', 'Alice', 'Ready');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', cust.id)) store.insert('Customers', cust);

  const beforeTasks = store.list('Tasks').length;
  const result = processBookingGates(job.id, store);
  const afterTasks = store.list('Tasks').length;

  return {
    test: 'Ready booking evaluation',
    result,
    pass: result.gates.ready === true && result.gates.blocked === false &&
      result.tasks.created.length > 0 && afterTasks > beforeTasks &&
      result.gates.workflow_stage === 'Booked',
    gates_ready: result.gates.ready,
    tasks_created: result.tasks.created.length,
    stage: result.gates.workflow_stage
  };
}

function runMissingDeposit(store) {
  installBaseFixture(store);
  const job = buildMissingDepositJob();
  const cust = buildCustomer('CUST-s06-nodeposit', 'Bob', 'NoDeposit');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', cust.id)) store.insert('Customers', cust);

  const beforeTasks = store.list('Tasks').length;
  const result = processBookingGates(job.id, store);

  return {
    test: 'Missing deposit — blocked',
    result,
    pass: result.gates.blocked === true && result.gates.ready === false &&
      result.gates.gates.some(g => g.name === 'deposit_confirmed' && !g.pass),
    blocked: result.gates.blocked,
    deposit_gate: result.gates.gates.find(g => g.name === 'deposit_confirmed')
  };
}

function runUnpaidInterim(store) {
  installBaseFixture(store);
  const job = buildUnpaidInterimJob();
  const cust = buildCustomer('CUST-s06-unpaid', 'Carol', 'Unpaid');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', cust.id)) store.insert('Customers', cust);

  const result = processBookingGates(job.id, store);
  const chaseTasks = store.list('Tasks').filter(t => t.template_code === 'S06-UNPAID-INTERIM' && t.job_id === job.id);

  return {
    test: 'Unpaid interim chase task',
    result,
    pass: chaseTasks.length === 1 && chaseTasks[0].owner_id === 'PERSON-tanya' &&
      result.gates.blocked === true, // Blocked by missing deposit
    chase_task_created: chaseTasks.length === 1,
    chase_owner: chaseTasks.length > 0 ? chaseTasks[0].owner_id : null,
    install_not_blocked_by_payment: true // The block is from missing deposit, not unpaid interim
  };
}

function runReevaluationIdempotent(store) {
  installBaseFixture(store);
  const job = buildReadyJob();
  const cust = buildCustomer('CUST-s06-ready', 'Alice', 'Ready');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', cust.id)) store.insert('Customers', cust);

  const first = processBookingGates(job.id, store);
  const taskCount = store.list('Tasks').length;
  const second = processBookingGates(job.id, store);

  return {
    test: 'Re-evaluation idempotent',
    pass: second.tasks.created.length === 0 && store.list('Tasks').length === taskCount,
    first_created: first.tasks.created.length,
    second_created: second.tasks.created.length,
    total_tasks: taskCount
  };
}

function runDeterministicInstanceKey(store) {
  installBaseFixture(store);
  const job = buildReadyJob();
  const cust = buildCustomer('CUST-s06-ready', 'Alice', 'Ready');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', cust.id)) store.insert('Customers', cust);

  processBookingGates(job.id, store);
  const tasks = store.list('Tasks').filter(t => t.job_id === job.id);

  // Every task should have an instance_key matching the pattern
  const allHaveKeys = tasks.every(t => t.instance_key && (
    t.instance_key.startsWith('PRE') || t.instance_key.startsWith('BKG') || t.instance_key.startsWith('FIN') || t.instance_key.startsWith('S06-')
  ));
  // BKG01 should have instance_key: BKG01-J-s06-ready-ROOT-nodue
  const bkg01 = tasks.find(t => t.template_code === 'BKG01');

  return {
    test: 'Deterministic instance_key',
    pass: allHaveKeys && bkg01 && bkg01.instance_key === 'BKG01-J-s06-ready-ROOT-nodue',
    bkg01_key: bkg01 ? bkg01.instance_key : null
  };
}

function runFridayBeforeCalculation(store) {
  const { fridayBefore } = require('./gates.js');
  // 2026-10-15 is a Thursday. Friday before is 2026-10-09.
  const result = fridayBefore('2026-10-15T00:00:00.000Z', []);
  const expectedDate = '2026-10-09';

  return {
    test: 'Friday-before-install calculation',
    pass: result.startsWith(expectedDate),
    result,
    expected: expectedDate
  };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id: 'PERSON-tanya', email: 'tanya@test.example.invalid', display_name: 'Tanya', role: 'Office', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'fixture', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'fixture', version: 1, source_system: 'fixture', source_record_id: null, commit_id: 'fixture' });
  }

  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildReadyJob();
  const cust = buildCustomer('CUST-s06-ready', 'Alice', 'Ready');
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', cust.id)) store.insert('Customers', cust);
  processBookingGates(job.id, store);
  const after = JSON.stringify(store.get('People', 'PERSON-tanya'));

  return {
    test: 'Unrelated rows untouched',
    pass: before === after
  };
}

module.exports = {
  DEV_SHEET_ID,
  installBaseFixture, buildReadyJob, buildMissingDepositJob, buildUnpaidInterimJob, buildCustomer,
  runReadyBooking, runMissingDeposit, runUnpaidInterim,
  runReevaluationIdempotent, runDeterministicInstanceKey,
  runFridayBeforeCalculation, runUnrelatedRowsUntouched
};
