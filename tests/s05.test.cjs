const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

const { createIntakeProcessor, validateIntake, intakeHash, DEV_SHEET_ID: DID } = require('../s05/intake.js');
const { buildSyntheticMapping, applyMappings, resolveBookingJob, generateJobId } = require('../s05/mapping.js');
const {
  SOLD_FORM_ID, BOOKING_FORM_ID,
  soldPayload, bookingPayload,
  installBaseFixture, installSyntheticMappings,
  runSoldHappyPath, runSoldDuplicateReplay, runSoldConflictingReplay,
  runBookingHappyPath, runBookingDuplicateReplay, runBookingConflictingReplay,
  runBookingNoMatch, runSoldMissingRequired, runMalformedInput,
  runWrongEnvironment, runWrongSheet, runConcurrentSold,
  runInternalIdUsage, runUnrelatedRowsUntouched
} = require('../s05/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['Intake', 'Jobs', 'Customers', 'CustomerChanges', 'MappingRules', 'ReleaseModes', 'People', 'PersonRoles', 'TaskEvents', 'AuditEvents', 'CommitJournal', 'TaskDependencies', 'Tasks', 'TaskTemplates', 'WorkPackages', 'Allocations', 'Materials', 'Products', 'JobEquipment', 'ScaffoldBookings', 'Companies', 'Outbox', 'CalendarLinks', 'Holidays', 'Settings'];
  for (const t of tables) data[t] = [];

  data.People = [
    { id: 'PERSON-tanya', email: 'lenny@simplesolarltd.co.uk', display_name: 'Tanya', role: 'Office', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' },
    { id: 'PERSON-ben', email: 'ben@s05.example.invalid', display_name: 'Ben', role: 'Admin', active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' },
    { id: 'PERSON-roofer-a', email: 'roofera@s05.example.invalid', display_name: 'RooferA', role: 'Installer', active: true, calendar_id: 'CAL-roofer-a', notification_email: null, capacity_per_day: 2, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' },
    { id: 'PERSON-sparky-a', email: 'sparkya@s05.example.invalid', display_name: 'ElectricianA', role: 'Installer', active: true, calendar_id: 'CAL-sparky-a', notification_email: null, capacity_per_day: 2, available_from: null, available_to: null, backup_person_id: null, company_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
  ];
  data.PersonRoles = [
    { id: 'ROLE-tanya-office', person_id: 'PERSON-tanya', role: 'Office', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' },
    { id: 'ROLE-ben-admin', person_id: 'PERSON-ben', role: 'Admin', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' }
  ];
  data.TaskTemplates = [
    { id: 'TPL-PRE01', template_code: 'PRE01', title: 'Send deposit invoice', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-PRE02', template_code: 'PRE02', title: 'Check contract sent/signed', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-PRE03', template_code: 'PRE03', title: 'Confirm bank deposit', group: 'Prebooking', active: true, template_version: '1.0' }
  ];
  data.Settings = [
    { id: 'SET-tz', key: 'office.timezone', typed_value: 'Europe/London', version: 1 },
    { id: 'SET-days', key: 'office.staffed_weekdays', typed_value: '[1,2,3,4,5]', version: 1 }
  ];
  data.ReleaseModes = [
    { id: 'RM-FN01', function_id: 'FN-01', function_name: 'Office core', mode: 'Disabled', mode_record_basis: 'seed', authorised_job_scope: 'None', target_release: 'R1', planned_target_mode: 'Automated', current_system: 'manual', fallback: 'manual', external_ids_protected_reference: null, activation_time: null, approved_version: null, ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' }
  ];

  return {
    getSheetId: () => DEV_SHEET_ID,
    list: name => clone(data[name] || []),
    get: (name, id) => clone((data[name] || []).find(r => r.id === id) || null),
    insert(name, row) {
      if (!data[name]) data[name] = [];
      if (data[name].find(r => r.id === row.id)) throw new Error('Duplicate id: ' + row.id);
      data[name].push(clone(row));
    },
    update(name, id, patch) {
      const r = data[name].find(r => r.id === id);
      if (!r) throw new Error('Not found: ' + name + ' ' + id);
      Object.assign(r, patch);
    }
  };
}

/* --- Test 1: Sold intake creates one job --- */
test('S05: sold intake creates one job', () => {
  const store = makeStore();
  const r = runSoldHappyPath(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.ok(r.job_id);
  assert.ok(r.job_id_human);
  assert.ok(r.job_id_human.match(/^SS-[A-Z]{4}-\d{4}$/));
  assert.equal(r.result.status, 'Processed');
});

/* --- Test 2: Sold identical replay idempotent --- */
test('S05: sold identical replay idempotent', () => {
  const store = makeStore();
  const r = runSoldDuplicateReplay(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.first.status, 'Processed');
  assert.equal(r.second.status, 'Processed');
  assert.equal(r.second.duplicate, true);
  assert.equal(store.list('Jobs').length, r.job_count);
  assert.equal(store.list('Intake').length, 1);
});

/* --- Test 3: Sold conflicting replay refused --- */
test('S05: sold conflicting replay refused', () => {
  const store = makeStore();
  const r = runSoldConflictingReplay(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.second.status, 'Review');
  assert.equal(r.second.error, 'CONFLICTING_INTAKE');
  assert.equal(r.intake_status, 'Review');
});

/* --- Test 4: Human job_id unique but internal id used relationally --- */
test('S05: human job_id unique, internal id used relationally', () => {
  const store = makeStore();
  const r = runInternalIdUsage(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.ok(r.human_job_id.match(/^SS-[A-Z]{4}-\d{4}$/));
  assert.notEqual(r.internal_id, r.human_job_id);
  const intake = store.get('Intake', 'S05-sold-internal-001');
  assert.equal(intake.job_id, r.internal_id); // FK uses internal id, not human job_id
});

/* --- Test 5: Booking attaches to exact correct internal job --- */
test('S05: booking attaches to exact correct internal job', () => {
  const store = makeStore();
  const r = runBookingHappyPath(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.result.status, 'Processed');
  // Early Booking links the Job but must not skip the explicit ReadyToBook gate.
  assert.equal(r.job_after_stage, 'Prebooking');
});

/* --- Test 6: Booking identical replay idempotent --- */
test('S05: booking identical replay idempotent', () => {
  const store = makeStore();
  const r = runBookingDuplicateReplay(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.first.status, 'Processed');
  assert.equal(r.second.status, 'Processed');
  assert.equal(r.second.duplicate, true);
});

/* --- Test 7: Booking conflicting replay refused --- */
test('S05: booking conflicting replay refused', () => {
  const store = makeStore();
  const r = runBookingConflictingReplay(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.second.status, 'Review');
  assert.equal(r.intake_status, 'Review');
});

/* --- Test 8: Booking with no safe match refused --- */
test('S05: booking with no safe match refused', () => {
  const store = makeStore();
  const r = runBookingNoMatch(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.result.status, 'Review');
  assert.equal(r.result.error, 'NO_MATCHING_JOB');
  assert.equal(r.intake_created, true);
});

/* --- Test 9: Booking ambiguous match refused --- */
test('S05: booking ambiguous match refused', () => {
  const store = makeStore();
  const proc = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID },
    store, sha256, projectId: () => 's05-test' });
  installBaseFixture(store);

  // Create two jobs with the same human job_id (shouldn't happen in prod, but test it)
  store.insert('Jobs', { id: 'J-dup-1', job_id: 'SS-DUP1-0001', customer_id: 'C1', display_name: 'Dup 1', sold_submission_id: null, booking_submission_id: null, sold_at: null, salesperson_id: null, lead_source: null, quote_reference: null, presale_file_id: null, finance_route: 'Standard', contract_status: 'NotSent', contract_id: null, contract_signed_at: null, contract_evidence_id: null, original_net_pence: null, original_vat_pence: null, original_gross_pence: null, approved_change_pence: null, current_contract_gross_pence: null, valuation_basis: null, sold_booking_match_status: 'Pending', customer_details_verified_at: null, customer_details_verified_by: null, deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null, roof_required: false, electrical_required: false, scaffold_required: false, workflow_stage: 'Prebooking', booking_approved_at: null, booking_approved_by: null, operational_complete_at: null, operational_complete_by: null, customer_happy_at: null, customer_happy_by: null, handover_status: 'NotReady', financial_status: 'Pending', cancellation_at: null, cancellation_by: null, cancellation_reason: null, archived_at: null, next_action_at: null, account_policy_version: null, pilot_job: false, release_scope: 'R1', created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' });
  store.insert('Jobs', { id: 'J-dup-2', job_id: 'SS-DUP1-0001', customer_id: 'C2', display_name: 'Dup 2', sold_submission_id: null, booking_submission_id: null, sold_at: null, salesperson_id: null, lead_source: null, quote_reference: null, presale_file_id: null, finance_route: 'Standard', contract_status: 'NotSent', contract_id: null, contract_signed_at: null, contract_evidence_id: null, original_net_pence: null, original_vat_pence: null, original_gross_pence: null, approved_change_pence: null, current_contract_gross_pence: null, valuation_basis: null, sold_booking_match_status: 'Pending', customer_details_verified_at: null, customer_details_verified_by: null, deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null, roof_required: false, electrical_required: false, scaffold_required: false, workflow_stage: 'Prebooking', booking_approved_at: null, booking_approved_by: null, operational_complete_at: null, operational_complete_by: null, customer_happy_at: null, customer_happy_by: null, handover_status: 'NotReady', financial_status: 'Pending', cancellation_at: null, cancellation_by: null, cancellation_reason: null, archived_at: null, next_action_at: null, account_policy_version: null, pilot_job: false, release_scope: 'R1', created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' });

  const bookingIntake = {
    intake_id: 'S05-booking-ambiguous-001',
    form_id: BOOKING_FORM_ID,
    form_type: 'Booking',
    submission_id: 'SUB-ambiguous-001',
    raw_payload: bookingPayload('SS-DUP1-0001')
  };

  const result = proc.processBooking(bookingIntake);
  assert.equal(result.status, 'Review');
  assert.equal(result.error, 'NO_MATCHING_JOB');
});

/* --- Test 10: Missing required mapping refused --- */
test('S05: missing required field refused', () => {
  const store = makeStore();
  const r = runSoldMissingRequired(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.result.status, 'Review');
  assert.equal(r.result.error, 'MISSING_REQUIRED_FIELDS');
  assert.ok(r.missing.length >= 2);
});

/* --- Test 11: Malformed required input refused --- */
test('S05: malformed input refused', () => {
  const store = makeStore();
  const r = runMalformedInput(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.result.status, 'Failed');
});

/* --- Test 12: No duplicate S05 jobs on replay --- */
test('S05: no duplicate jobs on sold replay', () => {
  const store = makeStore();
  const r = runSoldDuplicateReplay(store, sha256);
  assert.equal(r.pass, true);
  const s05Jobs = store.list('Jobs').filter(j => j.source_system === 'S05-intake');
  assert.equal(s05Jobs.length, 1);
});

/* --- Test 13: Concurrent duplicate sold intake results in one job --- */
test('S05: concurrent duplicate sold results in one job', () => {
  const store = makeStore();
  const r = runConcurrentSold(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.job_count, 1);
});

/* --- Test 14: Wrong environment refused --- */
test('S05: wrong environment refused', () => {
  const store = makeStore();
  const r = runWrongEnvironment(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.result.error, 'DEV_ONLY');
});

/* --- Test 15: Wrong sheet refused --- */
test('S05: wrong sheet refused', () => {
  const store = makeStore();
  const r = runWrongSheet(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.result.error, 'SHEET_ID_MISMATCH');
});

/* --- Test 16: Unrelated existing rows untouched --- */
test('S05: unrelated existing rows untouched', () => {
  const store = makeStore();
  const r = runUnrelatedRowsUntouched(store, sha256);
  assert.equal(r.pass, true, JSON.stringify(r));
});

/* --- Additional unit tests --- */
test('S05: validateIntake rejects missing fields', () => {
  assert.throws(() => validateIntake(null), /INVALID_INTAKE/);
  assert.throws(() => validateIntake({}), /MISSING_INTAKE_ID/);
  assert.throws(() => validateIntake({ intake_id: 'x', form_id: 'f', form_type: 'Bad', submission_id: 's', raw_payload: {} }), /INVALID_FORM_TYPE/);
});

test('S05: applyMappings extracts and transforms fields', () => {
  const rules = buildSyntheticMapping(SOLD_FORM_ID, 'Sold');
  const payload = soldPayload();
  const { fields, missingRequired } = applyMappings(payload, rules, SOLD_FORM_ID);
  assert.equal(fields.Customers.first_name, 'Alice');
  assert.equal(fields.Customers.last_name, 'Synthetic');
  assert.equal(fields.Customers.postcode, 'TS1 1AA');
  assert.equal(fields.Jobs.roof_required, false);
  assert.equal(fields.Jobs.original_gross_pence, 500000);
  assert.equal(missingRequired.length, 0);
});

test('S05: applyMappings reports missing required fields', () => {
  const rules = buildSyntheticMapping(SOLD_FORM_ID, 'Sold');
  const payload = {};
  const { missingRequired } = applyMappings(payload, rules, SOLD_FORM_ID);
  assert.ok(missingRequired.length >= 5); // first_name, last_name, address1, town, postcode, finance_route
});

test('S05: resolveBookingJob returns null for unknown job_id', () => {
  const store = makeStore();
  assert.equal(resolveBookingJob(store, { Jobs: { job_id: 'SS-XXXX-XXXX' } }), null);
});

test('S05: generateJobId produces unique SS-XXXX-XXXX', () => {
  const store = makeStore();
  const id1 = generateJobId(store);
  store.insert('Jobs', { id: 'J1', job_id: id1, customer_id: 'C1', display_name: 'x', sold_submission_id: null, booking_submission_id: null, sold_at: null, salesperson_id: null, lead_source: null, quote_reference: null, presale_file_id: null, finance_route: 'Standard', contract_status: 'NotSent', contract_id: null, contract_signed_at: null, contract_evidence_id: null, original_net_pence: null, original_vat_pence: null, original_gross_pence: null, approved_change_pence: null, current_contract_gross_pence: null, valuation_basis: null, sold_booking_match_status: 'Pending', customer_details_verified_at: null, customer_details_verified_by: null, deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null, roof_required: false, electrical_required: false, scaffold_required: false, workflow_stage: 'Prebooking', booking_approved_at: null, booking_approved_by: null, operational_complete_at: null, operational_complete_by: null, customer_happy_at: null, customer_happy_by: null, handover_status: 'NotReady', financial_status: 'Pending', cancellation_at: null, cancellation_by: null, cancellation_reason: null, archived_at: null, next_action_at: null, account_policy_version: null, pilot_job: false, release_scope: 'R1', created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' });
  const id2 = generateJobId(store);
  assert.notEqual(id1, id2);
  assert.ok(id1.match(/^SS-[A-Z]{4}-\d{4}$/));
  assert.ok(id2.match(/^SS-[A-Z]{4}-\d{4}$/));
});

test('S05: intakeHash is deterministic', () => {
  const intake = { form_id: 'f', submission_id: 's', raw_payload: { a: 1, b: 2 } };
  assert.equal(intakeHash(intake), intakeHash(clone(intake)));
});

test('S05: Sold then Booking links same job', () => {
  const store = makeStore();
  const r = runBookingHappyPath(store, sha256);
  assert.equal(r.pass, true);
  const job = store.get('Jobs', r.result.job_id);
  assert.ok(job.sold_submission_id);
  assert.ok(job.booking_submission_id);
  assert.equal(job.sold_booking_match_status, 'Match');
});

test('S05: processor preserves raw intake payload', () => {
  const store = makeStore();
  const r = runSoldHappyPath(store, sha256);
  assert.equal(r.pass, true);
  const intake = store.get('Intake', r.result.intake_id);
  assert.ok(intake.raw_payload_json);
  const parsed = JSON.parse(intake.raw_payload_json);
  assert.equal(parsed.sold_first_name, 'Alice');
  assert.ok(intake.payload_hash);
});

/* --- Cloud test helper tests --- */

test('S05: S05Core.gs loads and exports all functions', () => {
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  assert.equal(typeof ctx.S05Core.createIntakeProcessor, 'function');
  assert.equal(typeof ctx.S05Core.validateIntake, 'function');
  assert.equal(typeof ctx.S05Core.buildSyntheticMapping, 'function');
  assert.equal(ctx.S05Core.DEV_SHEET_ID, DEV_SHEET_ID);
});

test('S05: S05Core.gs has no require or module.exports', () => {
  const src = fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8');
  assert.doesNotMatch(src, /\brequire\s*\(/);
  assert.doesNotMatch(src, /\bmodule\.exports\b/);
});

test('S05: S05Core.gs packaged createIntakeProcessor works', () => {
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  const store = makeStore();
  installBaseFixture(store);
  const proc = ctx.S05Core.createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID }, store, sha256, projectId: () => 'test' });
  const result = proc.processSold({
    intake_id: 'S05-pkg-test', form_id: SOLD_FORM_ID, form_type: 'Sold',
    submission_id: 'SUB-pkg', raw_payload: soldPayload()
  });
  assert.equal(result.status, 'Processed');
  assert.ok(result.job_id);
});

test('S05: cloud test happy path runner is idempotent via VM', () => {
  const grids = {};
  const seedIntake = ['id','intake_id','form_type','form_id','submission_id','source_revision','received_at','raw_payload_json','payload_hash','job_id','processing_status','validation_errors','processed_at','retry_count','created_at','commit_id'];
  const seedJobs = ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'];
  const seedCust = ['id','first_name','last_name','address_line1','address_line2','town','postcode','email','phone','alternate_contact','contact_notes','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'];
  const seedMap = ['id','form_id','question_id','source_label','target_table','target_field','transform','required_when','active','mapping_version','effective_from','owner','disposition','created_at','created_by','updated_at','updated_by','version','commit_id'];
  const seedMode = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];

  grids.Intake = [seedIntake];
  grids.Jobs = [seedJobs];
  grids.Customers = [seedCust];
  grids.MappingRules = [seedMap];
  grids.ReleaseModes = [seedMode, seedMode.map(function(h, i) {
    var r = { id:'RM-FN01',function_id:'FN-01',function_name:'Office core',mode:'Automated',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:'R1',planned_target_mode:'Automated',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test' };
    return r[seedMode[i]] !== undefined ? r[seedMode[i]] : null;
  })];

  // Install mappings
  grids.MappingRules.push(['MAP-Sold-first_name','260185763834060','sold_first_name','First Name','Customers','first_name','trim','always',true,'S05-DEV-1.0','2026-09-06','test','Import','2026-01-01T00:00:00.000Z','test','2026-01-01T00:00:00.000Z','test',1,'test']);
  grids.MappingRules.push(['MAP-Sold-last_name','260185763834060','sold_last_name','Last Name','Customers','last_name','trim','always',true,'S05-DEV-1.0','2026-09-06','test','Import','2026-01-01T00:00:00.000Z','test','2026-01-01T00:00:00.000Z','test',1,'test']);
  grids.MappingRules.push(['MAP-Sold-finance','260185763834060','sold_finance_route','Finance','Jobs','finance_route','trim','always',true,'S05-DEV-1.0','2026-09-06','test','Import','2026-01-01T00:00:00.000Z','test','2026-01-01T00:00:00.000Z','test',1,'test']);
  grids.MappingRules.push(['MAP-Book-ref','250293237424050','booking_job_id','Job ID','Jobs','job_id','trim','always',true,'S05-DEV-2.0','2026-09-09','test','Import','2026-01-01T00:00:00.000Z','test','2026-01-01T00:00:00.000Z','test',1,'test']);

  // Create mock Sheets
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {
      getName: function() { return tn; },
      getLastColumn: function() { return grids[tn][0].length; },
      getLastRow: function() { return grids[tn].length; },
      getMaxRows: function() { return 1000; },
      getRange: function(row, col, h, w) {
        h = h || 1; w = w || 1;
        var self = this;
        return {
          getValues: function() {
            var out = [];
            for (var r = 0; r < h; r++) {
              var rowVals = [];
              for (var c = 0; c < w; c++) {
                rowVals.push((grids[tn][row - 1 + r] || [])[col - 1 + c] || '');
              }
              out.push(rowVals);
            }
            return out;
          },
          setValues: function(vals) {
            vals.forEach(function(rv, ri) {
              rv.forEach(function(v, ci) {
                if (!grids[tn][row - 1 + ri]) grids[tn][row - 1 + ri] = [];
                grids[tn][row - 1 + ri][col - 1 + ci] = v;
              });
            });
          }
        };
      }
    };
  }

  var mockSs = {
    getId: function() { return DEV_SHEET_ID; },
    getSheets: function() { return Object.values(sheets); }
  };

  var ctx = vm.createContext({
    console: { log: function() {} },
    SpreadsheetApp: { getActiveSpreadsheet: function() { return mockSs; }, flush: function() {} },
    PropertiesService: { getScriptProperties: function() { return { getProperty: function() { return JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID }); } }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function(_, text) { return Array.from(crypto.createHash('sha256').update(text).digest()); }
    }
  });

  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8'), ctx);

  // Run sold happy path
  var r1 = ctx.runS05SoldHappyPathTest();
  assert.equal(r1.pass, true, JSON.stringify(r1));

  // Run again — should be idempotent
  var r2 = ctx.runS05SoldHappyPathTest();
  assert.equal(r2.pass, true, JSON.stringify(r2));

  // Run replay
  var r3 = ctx.runS05SoldReplayTest();
  assert.equal(r3.pass, true, JSON.stringify(r3));
});

test('S05: cloud test FN-01 disabled refusal via VM', () => {
  const grids = { Intake: [['id']], Jobs: [['id']], Customers: [['id']], MappingRules: [['id']], ReleaseModes: [['id','function_id','mode','authorised_job_scope','target_release','version'], ['RM-FN01','FN-01','Disabled','None','R1',1]] };
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {
      getName: function() { return tn; },
      getLastColumn: function() { return grids[tn][0].length; },
      getLastRow: function() { return grids[tn].length; },
      getMaxRows: function() { return 1000; },
      getRange: function() { return { getValues: function() { return []; }, setValues: function() {} }; }
    };
  }
  var mockSs = { getId: function() { return DEV_SHEET_ID; }, getSheets: function() { return Object.values(sheets); } };
  var ctx = vm.createContext({
    console: { log: function() {} },
    SpreadsheetApp: { getActiveSpreadsheet: function() { return mockSs; }, flush: function() {} },
    PropertiesService: { getScriptProperties: function() { return { getProperty: function() { return JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID }); } }; } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: function(_, t) { return Array.from(crypto.createHash('sha256').update(t).digest()); } }
  });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8'), ctx);
  var r = ctx.runS05SoldHappyPathTest();
  assert.equal(r.pass, false);
  assert.ok(r.detail.includes('FN-01'));
});

test('S05: cloud test safe state restore only changes FN-01 via VM', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function() { return ''; });
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) { r[modeHdrs.indexOf(k)] = vals[k]; } return r; }
  var fn01 = mkRow({id:'RM-FN01',function_id:'FN-01',function_name:'Office',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R1',version:1});
  var fn02 = mkRow({id:'RM-FN02',function_id:'FN-02',function_name:'Calendar',mode:'Disabled',authorised_job_scope:'None',target_release:'R2',version:1});

  const grids = { Intake: [['id']], Jobs: [['id']], Customers: [['id']], MappingRules: [['id']], ReleaseModes: [modeHdrs, fn01, fn02] };
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {
      getName: function() { return tn; },
      getLastColumn: function() { return grids[tn][0].length; },
      getLastRow: function() { return grids[tn].length; },
      getMaxRows: function() { return 1000; },
      getRange: function(row, col, h, w) {
        h = h || 1; w = w || 1;
        return {
          getValues: function() {
            return Array.from({length:h}, function(_,r) { return Array.from({length:w}, function(_,c) { return (grids[tn][row-1+r]||[])[col-1+c]||''; }); });
          },
          setValues: function(vals) {
            vals.forEach(function(rv,ri) { rv.forEach(function(v,ci) { if(!grids[tn][row-1+ri]) grids[tn][row-1+ri]=[]; grids[tn][row-1+ri][col-1+ci]=v; }); });
          }
        };
      }
    };
  }
  var mockSs = { getId: function() { return DEV_SHEET_ID; }, getSheets: function() { return Object.values(sheets); } };
  var ctx = vm.createContext({
    console: { log: function() {} },
    SpreadsheetApp: { getActiveSpreadsheet: function() { return mockSs; }, flush: function() {} },
    PropertiesService: { getScriptProperties: function() { return { getProperty: function() { return JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID }); } }; } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: function(_, t) { return Array.from(crypto.createHash('sha256').update(t).digest()); } }
  });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8'), ctx);

  var modeIdx = modeHdrs.indexOf('mode');
  var before = grids.ReleaseModes[2][modeIdx]; // FN-02 mode
  var r = ctx.restoreS05SafeState();
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(grids.ReleaseModes[1][modeIdx], 'Disabled'); // FN-01 now Disabled
  assert.equal(grids.ReleaseModes[2][modeIdx], before); // FN-02 unchanged
});

test('S05: cloud test validator does not fabricate PASS for unrun tests via VM', () => {
  const grids = { Intake: [['id']], Jobs: [['id']], Customers: [['id']], MappingRules: [['id']], ReleaseModes: [['id','function_id','mode','authorised_job_scope','target_release','version'], ['RM-FN01','FN-01','Disabled','None','R1',1]] };
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {
      getName: function() { return tn; },
      getLastColumn: function() { return grids[tn][0].length; },
      getLastRow: function() { return grids[tn].length; },
      getMaxRows: function() { return 1000; },
      getRange: function() { return { getValues: function() { return []; }, setValues: function() {} }; }
    };
  }
  var mockSs = { getId: function() { return DEV_SHEET_ID; }, getSheets: function() { return Object.values(sheets); } };
  var ctx = vm.createContext({
    console: { log: function() {} },
    SpreadsheetApp: { getActiveSpreadsheet: function() { return mockSs; }, flush: function() {} },
    PropertiesService: { getScriptProperties: function() { return { getProperty: function() { return JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID }); } }; } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: function() { return []; } }
  });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8'), ctx);

  var r = ctx.validateS05CloudEvidence();
  assert.equal(r.happy_path_pass, false);
  assert.equal(r.overall_core_s05_cloud_pass, false);
});

test('S05: cloud test wrong environment refusal via VM', () => {
  var mockSs = { getId: function() { return 'wrong'; }, getSheets: function() { return []; } };
  var ctx = vm.createContext({
    console: { log: function() {} },
    SpreadsheetApp: { getActiveSpreadsheet: function() { return mockSs; }, flush: function() {} },
    PropertiesService: { getScriptProperties: function() { return { getProperty: function() { return JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID }); } }; } },
    Utilities: {}
  });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8'), ctx);
  assert.throws(function() { ctx.runS05FixtureDryRun(); }, /S05_REFUSED/);
});

const { applyBookingStructured } = require('../s05/booking-apply.js');

function columnMapStore(colMap) {
  const data = {};
  Object.keys(colMap).forEach(n => { data[n] = []; });
  return {
    getSheetId: () => DEV_SHEET_ID,
    list: n => {
      if (!colMap[n]) throw new Error('S05_SCHEMA: no column map for ' + n);
      return clone(data[n] || []);
    },
    get: (n, id) => {
      if (!colMap[n]) throw new Error('S05_SCHEMA: no column map for ' + n);
      return clone((data[n] || []).find(r => r.id === id) || null);
    },
    insert(n, row) {
      if (!colMap[n]) throw new Error('S05_SCHEMA: no column map for ' + n);
      // Prove adapter would be able to map every written field.
      colMap[n].forEach(() => {});
      const shaped = {};
      colMap[n].forEach(h => { shaped[h] = row[h] === undefined ? null : row[h]; });
      if (!data[n]) data[n] = [];
      if (data[n].find(r => r.id === shaped.id)) throw new Error('dup ' + shaped.id);
      data[n].push(clone(shaped));
    },
    update(n, id, patch) {
      if (!colMap[n]) throw new Error('S05_SCHEMA: no column map for ' + n);
      const r = data[n].find(x => x.id === id);
      if (!r) throw new Error('missing');
      Object.assign(r, patch);
    },
    _data: data
  };
}

function s05IntakeColumnMapFromSource() {
  const src = fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(src.replace(/function _s05Guard[\s\S]*$/, 'true;'), ctx);
  // Re-eval only the column map by extracting from source.
  const m = src.match(/var _S05_COLS = (\{[\s\S]*?\n\});/);
  assert.ok(m, '_S05_COLS missing');
  return vm.runInNewContext('(' + m[1] + ')');
}

test('S05: bound store column map covers all structured Booking write tables', () => {
  const cols = s05IntakeColumnMapFromSource();
  for (const name of ['CustomerChanges', 'WorkPackages', 'ScaffoldBookings', 'Materials', 'JobEquipment', 'Allocations', 'People', 'Companies']) {
    assert.ok(Array.isArray(cols[name]) && cols[name].length > 0, name);
    assert.equal(cols[name][0], 'id');
  }
});

test('S05: cloud-compatible store can insert CustomerChanges and all Booking output tables', () => {
  const cols = s05IntakeColumnMapFromSource();
  const store = columnMapStore(cols);
  store.insert('Customers', {
    id: 'CUST-1', first_name: 'Alice', last_name: 'Synthetic', address_line1: '1 Test Street',
    address_line2: '', town: 'Testville', postcode: 'TS1 1AA', email: 'alice@s05.example.invalid',
    phone: '07123456789', alternate_contact: null, contact_notes: null, created_at: '2026-01-01T00:00:00.000Z',
    created_by: 't', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1,
    source_system: 't', source_record_id: null, commit_id: 't'
  });
  store.insert('Jobs', {
    id: 'J-1', job_id: 'SS-TEST-0001', customer_id: 'CUST-1', display_name: 'Synthetic – TS1 1AA',
    sold_submission_id: 'SOLD-1', booking_submission_id: null, sold_at: '2026-01-01T00:00:00.000Z',
    salesperson_id: null, lead_source: 'Website', quote_reference: 'Q1', presale_file_id: null,
    finance_route: 'Standard', contract_status: 'Signed', contract_id: null, contract_signed_at: null,
    contract_evidence_id: 'E1', original_net_pence: null, original_vat_pence: null, original_gross_pence: 500000,
    approved_change_pence: null, current_contract_gross_pence: 500000, valuation_basis: 'Standard',
    sold_booking_match_status: 'Pending', customer_details_verified_at: '2026-01-01T00:00:00.000Z',
    customer_details_verified_by: 'PERSON-tanya', deposit_bank_confirmed_at: '2026-01-01T00:00:00.000Z',
    deposit_bank_confirmed_by: 'PERSON-ben', deposit_bank_reference: 'DEP', roof_required: true,
    electrical_required: true, scaffold_required: true, workflow_stage: 'ReadyToBook',
    booking_approved_at: null, booking_approved_by: null, operational_complete_at: null,
    operational_complete_by: null, customer_happy_at: null, customer_happy_by: null,
    handover_status: 'NotReady', financial_status: 'Pending', cancellation_at: null, cancellation_by: null,
    cancellation_reason: null, archived_at: null, next_action_at: null, account_policy_version: null,
    pilot_job: true, release_scope: 'R1', created_at: '2026-01-01T00:00:00.000Z', created_by: 't',
    updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1, source_system: 't',
    source_record_id: null, commit_id: 't'
  });
  store.insert('People', {
    id: 'PERSON-roofer-a', email: 'r@example.invalid', display_name: 'RooferA', role: 'Installer',
    company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: 2,
    available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z',
    created_by: 't', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1,
    source_system: 't', source_record_id: null, commit_id: 't'
  });
  store.insert('People', {
    id: 'PERSON-sparky-a', email: 's@example.invalid', display_name: 'ElectricianA', role: 'Installer',
    company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: 2,
    available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z',
    created_by: 't', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1,
    source_system: 't', source_record_id: null, commit_id: 't'
  });
  store.insert('Companies', {
    id: 'CO-scaffold-a', name: 'ScaffoldA', type: 'Scaffolder', active: true, standard_lead_days: 7,
    delivery_weekday: null, notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 't',
    updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1, source_system: 't', commit_id: 't'
  });

  const job = store.get('Jobs', 'J-1');
  const applied = applyBookingStructured(store, job, {
    Customers: { email: 'changed@s05.example.invalid', phone: '07999999999', last_name: 'Synthetic', postcode: 'TS1 1AA' },
    Jobs: { booking_gross_pence: '5000.00' },
    WorkPackageDates: { roof_date: '2026-10-06', electrical_date: '2026-10-08', scaffold_erect: '2026-10-03' },
    Installers: { roofer: 'RooferA', sparky: 'ElectricianA' },
    MaterialQty: { panel_515: '12' },
    Equipment: { inverter_to_order: 'Fox 5.0' },
    Scaffold: { company_name: 'ScaffoldA' },
    Notes: {}
  }, { intake_id: 'INT-BOOK-1' }, { productMap: require('../config/booking-product-map.example.json') });

  assert.ok(applied.customer_changes.length >= 1);
  assert.ok(store.list('CustomerChanges').length >= 1);
  assert.ok(store.list('WorkPackages').some(w => w.trade === 'Roof'));
  assert.ok(store.list('WorkPackages').some(w => w.trade === 'Electrical'));
  assert.ok(store.list('ScaffoldBookings').length >= 1);
  assert.ok(store.list('Materials').length >= 1);
  assert.ok(store.list('JobEquipment').length >= 1);
  assert.ok(store.list('Allocations').length >= 1);
  assert.doesNotThrow(() => store.insert('CustomerChanges', {
    id: 'CC-extra', job_id: 'J-1', field_name: 'town', previous_value: 'Testville',
    incoming_value: 'Other', source_submission_id: 'X', resolution: null, resolved_value: null,
    resolved_at: null, resolved_by: null, reason: 'TEST', created_at: '2026-01-01T00:00:00.000Z', commit_id: 'X'
  }));
});

test('S05: ReadyToBook Booking advances to BookingInProgress; Prebooking Booking stays Prebooking', () => {
  const store = makeStore();
  installBaseFixture(store);
  installSyntheticMappings(store);
  const sold = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID }, store, sha256 }).processSold({
    intake_id: 'S05-RTB-SOLD', form_id: SOLD_FORM_ID, form_type: 'Sold', submission_id: 'SUB-RTB-SOLD',
    raw_payload: soldPayload()
  });
  assert.equal(sold.status, 'Processed');
  assert.equal(store.get('Jobs', sold.job_id).workflow_stage, 'Prebooking');

  const early = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID }, store, sha256 }).processBooking({
    intake_id: 'S05-RTB-BOOK-EARLY', form_id: BOOKING_FORM_ID, form_type: 'Booking', submission_id: 'SUB-RTB-EARLY',
    raw_payload: bookingPayload(sold.job_id_human)
  });
  assert.equal(early.status, 'Processed');
  assert.equal(store.get('Jobs', sold.job_id).workflow_stage, 'Prebooking');
  assert.equal(store.list('Jobs').length, 1);

  store.update('Jobs', sold.job_id, {
    workflow_stage: 'ReadyToBook',
    booking_submission_id: null,
    sold_booking_match_status: 'Pending',
    version: Number(store.get('Jobs', sold.job_id).version) + 1
  });
  // Clear early booking intake so a fresh booking can apply against ReadyToBook.
  const store2 = makeStore();
  installBaseFixture(store2);
  installSyntheticMappings(store2);
  const sold2 = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID }, store: store2, sha256 }).processSold({
    intake_id: 'S05-RTB-SOLD2', form_id: SOLD_FORM_ID, form_type: 'Sold', submission_id: 'SUB-RTB-SOLD2',
    raw_payload: soldPayload()
  });
  store2.update('Jobs', sold2.job_id, { workflow_stage: 'ReadyToBook', version: 2 });
  const readyBook = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID }, store: store2, sha256 }).processBooking({
    intake_id: 'S05-RTB-BOOK-READY', form_id: BOOKING_FORM_ID, form_type: 'Booking', submission_id: 'SUB-RTB-READY',
    raw_payload: bookingPayload(sold2.job_id_human)
  });
  assert.equal(readyBook.status, 'Processed');
  assert.equal(store2.get('Jobs', sold2.job_id).workflow_stage, 'BookingInProgress');
  assert.equal(store2.list('Jobs').length, 1);

  const replay = createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV_SHEET_ID }, store: store2, sha256 }).processBooking({
    intake_id: 'S05-RTB-BOOK-READY', form_id: BOOKING_FORM_ID, form_type: 'Booking', submission_id: 'SUB-RTB-READY',
    raw_payload: bookingPayload(sold2.job_id_human)
  });
  assert.equal(replay.duplicate, true);
  assert.equal(store2.list('Jobs').length, 1);
});

test('S05: stale Processed Booking fixture linked to another Job cannot false-PASS via VM harness', () => {
  const cols = s05IntakeColumnMapFromSource();
  const grids = {};
  Object.keys(cols).forEach(n => { grids[n] = [cols[n].slice()]; });

  function pushRow(table, obj) {
    grids[table].push(cols[table].map(h => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]));
  }

  pushRow('ReleaseModes', {
    id: 'RM-FN01', function_id: 'FN-01', function_name: 'Office', mode: 'Automated',
    mode_record_basis: 't', authorised_job_scope: 'Pilot', target_release: 'R1',
    planned_target_mode: 'Automated', current_system: 't', fallback: 't',
    external_ids_protected_reference: null, activation_time: null, approved_version: null,
    ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z',
    created_by: 't', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1, commit_id: 't'
  });
  pushRow('Customers', {
    id: 'CUST-current', first_name: 'Alice', last_name: 'Synthetic', address_line1: '1', address_line2: '',
    town: 'T', postcode: 'TS1 1AA', email: 'alice@s05.example.invalid', phone: '07123456789',
    alternate_contact: null, contact_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 't',
    updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1, source_system: 'S05-intake',
    source_record_id: null, commit_id: 't'
  });
  pushRow('Jobs', {
    id: 'J-current', job_id: 'SS-CURR-0001', customer_id: 'CUST-current', display_name: 'Synthetic – TS1 1AA',
    sold_submission_id: 'S05-DEV-SOLD-001', booking_submission_id: null, sold_at: '2026-01-01T00:00:00.000Z',
    salesperson_id: null, lead_source: 'Website', quote_reference: 'Q', presale_file_id: null,
    finance_route: 'Standard', contract_status: null, contract_id: null, contract_signed_at: null,
    contract_evidence_id: null, original_net_pence: null, original_vat_pence: null, original_gross_pence: 500000,
    approved_change_pence: null, current_contract_gross_pence: null, valuation_basis: 'Standard',
    sold_booking_match_status: 'Pending', customer_details_verified_at: null, customer_details_verified_by: null,
    deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null,
    roof_required: false, electrical_required: false, scaffold_required: false, workflow_stage: 'ReadyToBook',
    booking_approved_at: null, booking_approved_by: null, operational_complete_at: null, operational_complete_by: null,
    customer_happy_at: null, customer_happy_by: null, handover_status: null, financial_status: null,
    cancellation_at: null, cancellation_by: null, cancellation_reason: null, archived_at: null, next_action_at: null,
    account_policy_version: null, pilot_job: true, release_scope: 'R1', created_at: '2026-01-01T00:00:00.000Z',
    created_by: 't', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 't', version: 1,
    source_system: 'S05-intake', source_record_id: null, commit_id: 't'
  });
  pushRow('Intake', {
    id: 'S05-DEV-SOLD-001', intake_id: 'S05-DEV-SOLD-001', form_type: 'Sold', form_id: '260185763834060',
    submission_id: 'SUB', source_revision: null, received_at: '2026-01-01T00:00:00.000Z',
    raw_payload_json: '{}', payload_hash: 'h', job_id: 'J-current', processing_status: 'Processed',
    validation_errors: null, processed_at: '2026-01-01T00:00:00.000Z', retry_count: 0,
    created_at: '2026-01-01T00:00:00.000Z', commit_id: 't'
  });
  // Stale booking linked to a different job id
  pushRow('Intake', {
    id: 'S05-DEV-BOOKING-001', intake_id: 'S05-DEV-BOOKING-001', form_type: 'Booking', form_id: '250293237424050',
    submission_id: 'SUB-B', source_revision: null, received_at: '2026-01-01T00:00:00.000Z',
    raw_payload_json: '{}', payload_hash: 'hb', job_id: 'J-OTHER', processing_status: 'Processed',
    validation_errors: null, processed_at: '2026-01-01T00:00:00.000Z', retry_count: 0,
    created_at: '2026-01-01T00:00:00.000Z', commit_id: 't'
  });

  const sheets = {};
  for (const tn of Object.keys(grids)) {
    sheets[tn] = {
      getName: () => tn,
      getLastColumn: () => grids[tn][0].length,
      getLastRow: () => grids[tn].length,
      getMaxRows: () => 1000,
      getRange(row, col, h, w) {
        h = h || 1; w = w || 1;
        return {
          getValues: () => Array.from({ length: h }, (_, r) =>
            Array.from({ length: w }, (_, c) => (grids[tn][row - 1 + r] || [])[col - 1 + c] || '')),
          setValues: (vals) => vals.forEach((rv, ri) => rv.forEach((v, ci) => {
            if (!grids[tn][row - 1 + ri]) grids[tn][row - 1 + ri] = [];
            grids[tn][row - 1 + ri][col - 1 + ci] = v;
          }))
        };
      }
    };
  }
  const mockSs = { getId: () => DEV_SHEET_ID, getSheets: () => Object.values(sheets) };
  const ctx = vm.createContext({
    console: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID }) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, text) => Array.from(crypto.createHash('sha256').update(text).digest())
    }
  });
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Core.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/s05/S05Intake.js', 'utf8'), ctx);
  const r = ctx.runS05BookingHappyPathTest();
  assert.equal(r.pass, false);
  assert.match(r.detail, /Stale Processed Booking fixture/);
});
