/* S05 DEV fixture — synthetic test data and test runner.
 * All data is obviously synthetic. No real customer data.
 * Uses distinct IDs so existing S04 T-open evidence remains untouched. */

const { buildSyntheticMapping } = require('./mapping.js');
const { createIntakeProcessor, validateIntake } = require('./intake.js');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const SOLD_FORM_ID = '260185763834060';
const BOOKING_FORM_ID = '250293237424050';
const clone = v => JSON.parse(JSON.stringify(v));

/* --- Synthetic payloads --- */
function soldPayload() {
  return {
    sold_first_name: 'Alice',
    sold_last_name: 'Synthetic',
    sold_address1: '1 Test Street',
    sold_address2: '',
    sold_town: 'Testville',
    sold_postcode: 'TS1 1AA',
    sold_email: 'alice@s05.example.invalid',
    sold_phone: '07123456789',
    sold_lead_source: 'Website',
    sold_quote_ref: 'Q-S05-001',
    sold_finance_route: 'Standard',
    sold_roof: 'No',
    sold_electrical: 'No',
    sold_scaffold: 'No',
    sold_gross_pence: '500000',
    sold_valuation: 'Standard'
  };
}

function bookingPayload(soldJobId) {
  return {
    booking_job_id: soldJobId,
    booking_first_name: 'Alice',
    booking_last_name: 'Synthetic',
    booking_address1: '1 Test Street',
    booking_town: 'Testville',
    booking_postcode: 'TS1 1AA',
    booking_email: 'alice@s05.example.invalid',
    booking_phone: '07123456789',
    booking_cost: '5000.00',
    booking_date_roofer: '2026-10-01',
    booking_date_sparky: '2026-10-03',
    booking_notes_compat: 'S05 synthetic booking'
  };
}

/* --- Fixture installer --- */
function installSyntheticMappings(store) {
  const existing = store.list('MappingRules');
  if (existing.length > 0) return; // Already installed

  const soldRules = buildSyntheticMapping(SOLD_FORM_ID, 'Sold');
  const bookingRules = buildSyntheticMapping(BOOKING_FORM_ID, 'Booking');
  for (const r of [...soldRules, ...bookingRules]) {
    store.insert('MappingRules', r);
  }
}

function installBaseFixture(store) {
  installSyntheticMappings(store);
}

/* --- Test runner: Sold happy path --- */
function runSoldHappyPath(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const intake = {
    intake_id: 'S05-sold-happy-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-001',
    raw_payload: soldPayload()
  };

  const beforeJobs = store.list('Jobs').length;
  const beforeCustomers = store.list('Customers').length;
  const beforeIntake = store.list('Intake').length;

  const result = proc.processSold(intake);

  const afterJobs = store.list('Jobs').length;
  const afterCustomers = store.list('Customers').length;
  const afterIntake = store.list('Intake').length;
  const job = result.job_id ? store.get('Jobs', result.job_id) : null;
  const customer = result.customer_id ? store.get('Customers', result.customer_id) : null;

  return {
    test: 'Sold happy path',
    result,
    pass: result.status === 'Processed' && !result.duplicate &&
      afterJobs === beforeJobs + 1 && afterCustomers === beforeCustomers + 1 &&
      afterIntake === beforeIntake + 1 && job && job.workflow_stage === 'Prebooking' &&
      customer && customer.first_name === 'Alice',
    before_counts: { jobs: beforeJobs, customers: beforeCustomers, intake: beforeIntake },
    after_counts: { jobs: afterJobs, customers: afterCustomers, intake: afterIntake },
    job_id: result.job_id,
    job_id_human: result.job_id_human,
    customer_id: result.customer_id
  };
}

/* --- Test: Sold duplicate replay --- */
function runSoldDuplicateReplay(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const intake = {
    intake_id: 'S05-sold-replay-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-replay-001',
    raw_payload: soldPayload()
  };

  const first = proc.processSold(intake);
  const jobCount = store.list('Jobs').length;
  const second = proc.processSold(intake);

  return {
    test: 'Sold duplicate replay',
    first, second,
    pass: first.status === 'Processed' && second.status === 'Processed' &&
      second.duplicate === true && store.list('Jobs').length === jobCount &&
      store.list('Intake').filter(i => i.intake_id === intake.intake_id).length === 1,
    job_count: jobCount
  };
}

/* --- Test: Sold conflicting replay --- */
function runSoldConflictingReplay(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const intake = {
    intake_id: 'S05-sold-conflict-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-conflict-001',
    raw_payload: soldPayload()
  };

  proc.processSold(intake);
  const jobCount = store.list('Jobs').length;

  // Different payload, same intake_id
  const changed = clone(intake);
  changed.raw_payload.sold_first_name = 'Bob';
  const second = proc.processSold(changed);

  const intakeRecord = store.get('Intake', intake.intake_id);

  return {
    test: 'Sold conflicting replay',
    second,
    pass: second.status === 'Review' && second.error === 'CONFLICTING_INTAKE' &&
      store.list('Jobs').length === jobCount &&
      intakeRecord && intakeRecord.processing_status === 'Review',
    intake_status: intakeRecord ? intakeRecord.processing_status : null
  };
}

/* --- Test: Booking happy path --- */
function runBookingHappyPath(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  // First create a sold job
  const soldIntake = {
    intake_id: 'S05-sold-for-booking-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-for-booking-001',
    raw_payload: soldPayload()
  };
  const soldResult = proc.processSold(soldIntake);
  if (soldResult.status !== 'Processed') {
    return { test: 'Booking happy path (prep failed)', pass: false, soldResult };
  }
  const jobIdHuman = soldResult.job_id_human;
  const job = store.get('Jobs', soldResult.job_id);

  // Now submit booking
  const bookingIntake = {
    intake_id: 'S05-booking-happy-001',
    form_id: BOOKING_FORM_ID,
    form_type: 'Booking',
    submission_id: 'SUB-booking-001',
    raw_payload: bookingPayload(jobIdHuman)
  };

  const beforeJobs = store.list('Jobs').length;
  const beforeIntake = store.list('Intake').length;

  const result = proc.processBooking(bookingIntake);

  const updatedJob = store.get('Jobs', soldResult.job_id);
  const afterIntake = store.list('Intake').length;

  return {
    test: 'Booking happy path',
    result,
    pass: result.status === 'Processed' && !result.duplicate &&
      updatedJob && updatedJob.booking_submission_id === 'S05-booking-happy-001' &&
      updatedJob.sold_booking_match_status === 'Match' &&
      updatedJob.workflow_stage === 'Prebooking' &&
      afterIntake === beforeIntake + 1,
    job_before_stage: job ? job.workflow_stage : null,
    job_after_stage: updatedJob ? updatedJob.workflow_stage : null
  };
}

/* --- Test: Booking duplicate replay --- */
function runBookingDuplicateReplay(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  // Create sold job first
  const soldIntake = {
    intake_id: 'S05-sold-replay-bk-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-replay-bk-001',
    raw_payload: soldPayload()
  };
  const soldResult = proc.processSold(soldIntake);
  const jobIdHuman = soldResult.job_id_human;

  const bookingIntake = {
    intake_id: 'S05-booking-replay-001',
    form_id: BOOKING_FORM_ID,
    form_type: 'Booking',
    submission_id: 'SUB-booking-replay-001',
    raw_payload: bookingPayload(jobIdHuman)
  };

  const first = proc.processBooking(bookingIntake);
  const intakeCount = store.list('Intake').length;
  const second = proc.processBooking(bookingIntake);

  return {
    test: 'Booking duplicate replay',
    first, second,
    pass: first.status === 'Processed' && second.status === 'Processed' &&
      second.duplicate === true && store.list('Intake').length === intakeCount,
    intake_count: intakeCount
  };
}

/* --- Test: Booking conflicting replay --- */
function runBookingConflictingReplay(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const soldIntake = {
    intake_id: 'S05-sold-conflict-bk-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-conflict-bk-001',
    raw_payload: soldPayload()
  };
  const soldResult = proc.processSold(soldIntake);
  const jobIdHuman = soldResult.job_id_human;

  const bookingIntake = {
    intake_id: 'S05-booking-conflict-001',
    form_id: BOOKING_FORM_ID,
    form_type: 'Booking',
    submission_id: 'SUB-booking-conflict-001',
    raw_payload: bookingPayload(jobIdHuman)
  };

  proc.processBooking(bookingIntake);

  const changed = clone(bookingIntake);
  changed.raw_payload.booking_date_roofer = '2026-11-01';
  const second = proc.processBooking(changed);

  return {
    test: 'Booking conflicting replay',
    second,
    pass: second.status === 'Review' && second.error === 'CONFLICTING_INTAKE',
    intake_status: store.get('Intake', bookingIntake.intake_id)?.processing_status
  };
}

/* --- Test: Booking with no matching job --- */
function runBookingNoMatch(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const bookingIntake = {
    intake_id: 'S05-booking-nomatch-001',
    form_id: BOOKING_FORM_ID,
    form_type: 'Booking',
    submission_id: 'SUB-booking-nomatch-001',
    raw_payload: bookingPayload('SS-XXXX-XXXX')
  };

  const beforeIntake = store.list('Intake').length;
  const result = proc.processBooking(bookingIntake);

  return {
    test: 'Booking no matching job',
    result,
    pass: result.status === 'Review' && result.error === 'NO_MATCHING_JOB' &&
      store.list('Intake').length === beforeIntake + 1,
    intake_created: store.list('Intake').length === beforeIntake + 1
  };
}

/* --- Test: Missing required field --- */
function runSoldMissingRequired(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const payload = soldPayload();
  delete payload.sold_first_name; // Required field
  delete payload.sold_last_name;

  const intake = {
    intake_id: 'S05-sold-missing-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-missing-001',
    raw_payload: payload
  };

  const result = proc.processSold(intake);

  return {
    test: 'Sold missing required field',
    result,
    pass: result.status === 'Review' && result.error === 'MISSING_REQUIRED_FIELDS' &&
      result.missing && result.missing.length >= 2,
    missing: result.missing
  };
}

/* --- Test: Malformed input --- */
function runMalformedInput(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  let result;
  try {
    result = proc.processSold(null);
  } catch (e) {
    result = { status: 'Failed', error: e.code || e.message };
  }

  return {
    test: 'Malformed input',
    result,
    pass: result && result.status === 'Failed',
    error: result ? result.error : null
  };
}

/* --- Test: Wrong environment --- */
function runWrongEnvironment(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'PROD', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  const intake = {
    intake_id: 'S05-prod-reject-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-prod-reject-001',
    raw_payload: soldPayload()
  };

  let result;
  try { result = proc.processSold(intake); }
  catch (e) { result = { status: 'Failed', error: e.code || e.message }; }

  return {
    test: 'Wrong environment',
    result,
    pass: result && result.status === 'Failed' && result.error === 'DEV_ONLY'
  };
}

/* --- Test: Wrong sheet --- */
function runWrongSheet(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: 'wrong' },
    store, sha256, projectId: () => 's05-test' });

  const intake = {
    intake_id: 'S05-sheet-reject-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sheet-reject-001',
    raw_payload: soldPayload()
  };

  let result;
  try { result = proc.processSold(intake); }
  catch (e) { result = { status: 'Failed', error: e.code || e.message }; }

  return {
    test: 'Wrong sheet',
    result,
    pass: result && result.status === 'Failed' && result.error === 'SHEET_ID_MISMATCH'
  };
}

/* --- Test: Concurrent duplicate sold --- */
function runConcurrentSold(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const intake = {
    intake_id: 'S05-sold-concurrent-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-concurrent-001',
    raw_payload: soldPayload()
  };

  const first = proc.processSold(intake);
  const second = proc.processSold(intake);
  const jobCount = store.list('Jobs').filter(j => j.source_system === 'S05-intake').length;

  return {
    test: 'Concurrent duplicate sold',
    first, second,
    pass: first.status === 'Processed' && second.status === 'Processed' &&
      second.duplicate === true && jobCount === 1,
    job_count: jobCount
  };
}

/* --- Test: Job uses internal id, not human job_id --- */
function runInternalIdUsage(store, sha256) {
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });

  installBaseFixture(store);

  const intake = {
    intake_id: 'S05-sold-internal-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-internal-001',
    raw_payload: soldPayload()
  };

  const result = proc.processSold(intake);
  const job = store.get('Jobs', result.job_id);
  const intakeRecord = store.get('Intake', intake.intake_id);

  return {
    test: 'Internal id used relationally',
    pass: job && job.job_id && job.job_id.match(/^SS-[A-Z]{4}-\d{4}$/) &&
      intakeRecord && intakeRecord.job_id === job.id &&
      job.id !== job.job_id,
    internal_id: job ? job.id : null,
    human_job_id: job ? job.job_id : null
  };
}

/* --- Test: Unrelated rows untouched --- */
function runUnrelatedRowsUntouched(store, sha256) {
  // Pre-seed a known row
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id: 'PERSON-tanya', email: 'lenny@simplesolarltd.co.uk', display_name: 'Tanya', role: 'Office', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' });
  }
  if (!store.get('ReleaseModes', 'RM-FN01')) {
    store.insert('ReleaseModes', { id: 'RM-FN01', function_id: 'FN-01', function_name: 'Office core', mode: 'Disabled', mode_record_basis: 'seed', authorised_job_scope: 'None', target_release: 'R1', planned_target_mode: 'Automated', current_system: 'manual', fallback: 'manual', external_ids_protected_reference: null, activation_time: null, approved_version: null, ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' });
  }

  const personBefore = clone(store.get('People', 'PERSON-tanya'));
  const modeBefore = clone(store.get('ReleaseModes', 'RM-FN01'));

  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });
  installBaseFixture(store);

  const intake = {
    intake_id: 'S05-sold-unrelated-001',
    form_id: SOLD_FORM_ID,
    form_type: 'Sold',
    submission_id: 'SUB-sold-unrelated-001',
    raw_payload: soldPayload()
  };
  proc.processSold(intake);

  const personAfter = store.get('People', 'PERSON-tanya');
  const modeAfter = store.get('ReleaseModes', 'RM-FN01');

  return {
    test: 'Unrelated rows untouched',
    pass: JSON.stringify(personBefore) === JSON.stringify(personAfter) &&
      JSON.stringify(modeBefore) === JSON.stringify(modeAfter)
  };
}

module.exports = {
  SOLD_FORM_ID, BOOKING_FORM_ID, DEV_SHEET_ID,
  soldPayload, bookingPayload,
  installBaseFixture, installSyntheticMappings,
  runSoldHappyPath, runSoldDuplicateReplay, runSoldConflictingReplay,
  runBookingHappyPath, runBookingDuplicateReplay, runBookingConflictingReplay,
  runBookingNoMatch, runSoldMissingRequired, runMalformedInput,
  runWrongEnvironment, runWrongSheet, runConcurrentSold,
  runInternalIdUsage, runUnrelatedRowsUntouched
};
