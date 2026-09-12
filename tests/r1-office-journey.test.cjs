/* R1 office journey — Sold → Booking → Tasks → Move Job / Change Installer.
 * Local only. No real emails/calendar/orders/invoices. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const sha256 = t => crypto.createHash('sha256').update(t).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const DEV = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

const { createIntakeProcessor } = require('../s05/intake.js');
const { buildSyntheticMapping } = require('../s05/mapping.js');
const { classifyTaskDue } = require('../s05/priority.js');
const { createPrebookingTasksForSold, processBookingGates } = require('../s06/gates.js');
const { moveJobR1, changeInstallerR1, buildPlanner, updatePlannedDates } = require('../s11/planner.js');
const adapter = require('../r1-appsheet/adapter.js');
const services = require('../r1-appsheet/services.js');

function store() {
  const data = {};
  const names = ['Intake','Jobs','Customers','CustomerChanges','MappingRules','People','PersonRoles','TaskTemplates','Tasks','WorkPackages','Allocations','Materials','JobEquipment','ScaffoldBookings','Companies','Outbox','CalendarLinks','Holidays','Settings','ReleaseModes','CommitJournal','AuditEvents','TaskEvents'];
  names.forEach(n => data[n] = []);
  data.People = [
    { id: 'PERSON-tanya', email: 'tanya@example.test', display_name: 'Tanya', role: 'Office', active: true, calendar_id: null, capacity_per_day: null },
    { id: 'PERSON-ben', email: 'ben@example.test', display_name: 'Ben', role: 'Admin', active: true, calendar_id: null, capacity_per_day: null },
    { id: 'PERSON-dan', email: 'dan@example.test', display_name: 'Dan', role: 'Director', active: true, calendar_id: null, capacity_per_day: null },
    { id: 'PERSON-roofer-a', email: 'roofera@example.test', display_name: 'RooferA', role: 'Installer', active: true, calendar_id: 'CAL-roofer-a', capacity_per_day: 2 },
    { id: 'PERSON-sparky-a', email: 'sparkya@example.test', display_name: 'ElectricianA', role: 'Installer', active: true, calendar_id: 'CAL-sparky-a', capacity_per_day: 2 },
    { id: 'PERSON-sparky-b', email: 'sparkyb@example.test', display_name: 'ElectricianB', role: 'Installer', active: true, calendar_id: 'CAL-sparky-b', capacity_per_day: 2 }
  ];
  data.PersonRoles = [
    { id: 'R1', person_id: 'PERSON-tanya', role: 'Office', active: true },
    { id: 'R2', person_id: 'PERSON-ben', role: 'Admin', active: true }
    ,{ id: 'R3', person_id: 'PERSON-dan', role: 'Director', active: true }
  ];
  data.TaskTemplates = [
    { id: 'TPL-PRE01', template_code: 'PRE01', title: 'Send deposit invoice', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-PRE02', template_code: 'PRE02', title: 'Check contract sent/signed', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-PRE03', template_code: 'PRE03', title: 'Confirm bank deposit', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-PRE04', template_code: 'PRE04', title: 'Check customer details and sold/presale amount', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-PRE05', template_code: 'PRE05', title: 'Check finance agreement approval', group: 'Prebooking', active: true, template_version: '1.0' },
    { id: 'TPL-BKG01', template_code: 'BKG01', title: 'Prepare booking', group: 'Booking', active: true, template_version: '1.0' },
    { id: 'TPL-BKG02', template_code: 'BKG02', title: 'Book dates and allocations', group: 'Booking', active: true, template_version: '1.0' },
    { id: 'TPL-BKG03', template_code: 'BKG03', title: 'Reconcile booking response', group: 'Booking', active: true, template_version: '1.0' },
    { id: 'TPL-BKG04', template_code: 'BKG04', title: 'Send customer booking email', group: 'Booking', active: true, template_version: '1.0' },
    { id: 'TPL-BKG05', template_code: 'BKG05', title: 'Check calendar events and document pack', group: 'Booking', active: true, template_version: '1.0' }
  ];
  data.Settings = [
    { id: 'S1', key: 'office.timezone', typed_value: 'Europe/London', version: 1 },
    { id: 'S2', key: 'office.staffed_weekdays', typed_value: '[1,2,3,4,5]', version: 1 }
  ];
  data.ReleaseModes = [
    { id: 'RM1', function_id: 'FN-01', mode: 'Automated', authorised_job_scope: 'Pilot', target_release: 'R1' }
  ];
  data.Companies = [
    { id: 'CO-green', name: 'Greentech', type: 'Merchant', active: true },
    { id: 'CO-scaffold-a', name: 'ScaffoldA', type: 'Scaffolder', active: true }
  ];
  for (const r of buildSyntheticMapping('260185763834060', 'Sold').concat(buildSyntheticMapping('250293237424050', 'Booking'))) {
    data.MappingRules.push(r);
  }
  return {
    getSheetId: () => DEV,
    getEnvironment: () => 'DEV',
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('dup ' + row.id); data[n].push(clone(row)); },
    update(n, id, patch) { const r = (data[n] || []).find(x => x.id === id); if (!r) throw new Error('missing'); Object.assign(r, patch); },
    withLock: fn => fn(),
    _data: data
  };
}

function proc(s) {
  return createIntakeProcessor({ config: { environment: 'DEV', sheetId: DEV }, store: s, sha256 });
}

function sold(s, id) {
  return proc(s).processSold({
    intake_id: id, form_id: '260185763834060', form_type: 'Sold', submission_id: 'SUB-' + id,
    raw_payload: {
      sold_first_name: 'Alice', sold_last_name: 'Synthetic', sold_address1: '1 Test Street',
      sold_town: 'Testville', sold_postcode: 'TS1 1AA', sold_email: 'alice@s05.example.invalid',
      sold_phone: '07123456789', sold_finance_route: 'Standard', sold_gross_pence: '500000',
      sold_roof: 'Yes', sold_electrical: 'Yes', sold_scaffold: 'Yes'
    }
  });
}

function bookingPayload(jobId, extra) {
  return Object.assign({
    booking_job_id: jobId,
    booking_first_name: 'Alice', booking_last_name: 'Synthetic',
    booking_address1: '1 Test Street', booking_town: 'Testville', booking_postcode: 'TS1 1AA',
    booking_email: 'alice@s05.example.invalid', booking_phone: '07123456789',
    booking_cost: '5000.00',
    booking_date_roofer: '2026-10-06', booking_date_sparky: '2026-10-08',
    booking_date_scaffold: '2026-10-03',
    booking_roofer: 'RooferA', booking_sparky: 'ElectricianA', booking_second_sparky: 'ElectricianB',
    booking_scaffold_company: 'ScaffoldA',
    booking_mat_r420181_total: '20', booking_mat_panel_515: '12',
    booking_mat_end_clamps: '4', booking_inverter: 'Fox 5.0', booking_battery: 'PowerVault',
    booking_battery_qty: '1', booking_merchant: 'Greentech'
  }, extra || {});
}

test('Sold creates exactly one Job with random reference and prebooking tasks', () => {
  const s = store();
  const r = sold(s, 'INT-SOLD-1');
  assert.equal(r.status, 'Processed');
  assert.match(r.job_id_human, /^SS-[A-Z]{4}-\d{4}$/);
  assert.equal(s.list('Jobs').length, 1);
  assert.equal(s.get('Jobs', r.job_id).workflow_stage, 'Prebooking');
  const tasks = s.list('Tasks').filter(t => t.job_id === r.job_id);
  assert.ok(tasks.some(t => t.template_code === 'PRE-COPY-JOBID'));
  assert.ok(tasks.some(t => t.template_code === 'PRE01'));
  assert.deepEqual(tasks.filter(t => /^PRE0[1-5]$/.test(t.template_code)).map(t => t.template_code).sort(), ['PRE01','PRE02','PRE03','PRE04']);
  const deposit = tasks.find(t => t.template_code === 'PRE03');
  assert.equal(deposit.owner_id, 'PERSON-ben');
  assert.equal(deposit.backup_id, 'PERSON-dan');
  assert.ok(tasks.every(t => t.owner_id));
  assert.ok(tasks.find(t => t.template_code === 'PRE-COPY-JOBID').title.includes(r.job_id_human));
});

test('duplicate Sold is idempotent; conflicting Sold goes to Review', () => {
  const s = store();
  const first = sold(s, 'INT-SOLD-DUP');
  const second = sold(s, 'INT-SOLD-DUP');
  assert.equal(second.duplicate, true);
  assert.equal(s.list('Jobs').length, 1);
  const conflict = proc(s).processSold({
    intake_id: 'INT-SOLD-DUP', form_id: '260185763834060', form_type: 'Sold', submission_id: 'SUB-x',
    raw_payload: { sold_first_name: 'Bob', sold_last_name: 'X', sold_address1: '2', sold_town: 'T', sold_postcode: 'ZZ1 1ZZ', sold_finance_route: 'Standard' }
  });
  assert.equal(conflict.status, 'Review');
  assert.equal(conflict.error, 'CONFLICTING_INTAKE');
});

test('Booking exact reference links same Job; creates packages/materials/equipment', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-BK');
  const r = proc(s).processBooking({
    intake_id: 'INT-BK-1', form_id: '250293237424050', form_type: 'Booking', submission_id: 'SUB-BK-1',
    raw_payload: bookingPayload(soldR.job_id_human)
  });
  assert.equal(r.status, 'Processed');
  assert.equal(r.job_id, soldR.job_id);
  const job = s.get('Jobs', soldR.job_id);
  assert.equal(job.workflow_stage, 'Prebooking');
  assert.equal(job.sold_booking_match_status, 'Match');
  assert.ok(s.list('WorkPackages').some(w => w.trade === 'Roof' && w.job_id === job.id));
  assert.ok(s.list('WorkPackages').some(w => w.trade === 'Electrical' && w.job_id === job.id));
  assert.ok(s.list('ScaffoldBookings').some(b => b.job_id === job.id));
  assert.ok(s.list('Materials').some(m => m.description.includes('515 Panels')));
  assert.ok(s.list('Materials').some(m => m.notes && m.notes.indexOf('MAPPING_REQUIRED') === 0));
  assert.ok(s.list('JobEquipment').some(e => e.equipment_type === 'Inverter'));
  assert.ok(s.list('Allocations').filter(a => a.active).length >= 2);
});

test('unknown and blank Booking reference → Intake Review; never surname match', () => {
  const s = store();
  sold(s, 'INT-SOLD-UNK');
  const blank = proc(s).processBooking({
    intake_id: 'INT-BK-BLANK', form_id: '250293237424050', form_type: 'Booking', submission_id: 'B1',
    raw_payload: bookingPayload('')
  });
  assert.equal(blank.status, 'Review');
  assert.equal(blank.error, 'BLANK_JOB_REFERENCE');
  const unknown = proc(s).processBooking({
    intake_id: 'INT-BK-UNK', form_id: '250293237424050', form_type: 'Booking', submission_id: 'B2',
    raw_payload: bookingPayload('SS-FAKE-9999')
  });
  assert.equal(unknown.status, 'Review');
  assert.equal(unknown.error, 'NO_MATCHING_JOB');
  assert.equal(s.list('Jobs').length, 1);
});

test('customer mismatch and amount mismatch → Review + CustomerChanges; no silent overwrite', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-MM');
  const custBefore = s.get('Customers', s.get('Jobs', soldR.job_id).customer_id);
  const r = proc(s).processBooking({
    intake_id: 'INT-BK-MM', form_id: '250293237424050', form_type: 'Booking', submission_id: 'BMM',
    raw_payload: bookingPayload(soldR.job_id_human, { booking_last_name: 'Different', booking_cost: '5500.00' })
  });
  assert.equal(r.status, 'Review');
  assert.equal(s.get('Jobs', soldR.job_id).sold_booking_match_status, 'Review');
  assert.ok(s.list('CustomerChanges').some(c => c.field_name === 'last_name'));
  assert.equal(s.get('Customers', custBefore.id).last_name, 'Synthetic');
});

test('corrected Booking (new intake_id) re-processes; duplicate identical replay idempotent', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-COR');
  const payload = bookingPayload(soldR.job_id_human);
  const first = proc(s).processBooking({ intake_id: 'INT-BK-COR1', form_id: '250293237424050', form_type: 'Booking', submission_id: 'COR1', raw_payload: payload });
  assert.equal(first.status, 'Processed');
  const replay = proc(s).processBooking({ intake_id: 'INT-BK-COR1', form_id: '250293237424050', form_type: 'Booking', submission_id: 'COR1', raw_payload: payload });
  assert.equal(replay.duplicate, true);
  const mats = s.list('Materials').length;
  const corrected = proc(s).processBooking({
    intake_id: 'INT-BK-COR2', form_id: '250293237424050', form_type: 'Booking', submission_id: 'COR2',
    raw_payload: bookingPayload(soldR.job_id_human, { booking_mat_panel_515: '14' })
  });
  assert.equal(corrected.status, 'Processed');
  assert.ok(s.list('Materials').length >= mats);
});

test('unresolved installer name → Review; second installer allocation role Second', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-INS');
  const bad = proc(s).processBooking({
    intake_id: 'INT-BK-BADINS', form_id: '250293237424050', form_type: 'Booking', submission_id: 'BI',
    raw_payload: bookingPayload(soldR.job_id_human, { booking_roofer: 'NobodyKnown' })
  });
  assert.equal(bad.status, 'Review');
  assert.ok(bad.applied.installers.unresolved.length >= 1);

  const s2 = store();
  const sold2 = sold(s2, 'INT-SOLD-INS2');
  const ok = proc(s2).processBooking({
    intake_id: 'INT-BK-2ND', form_id: '250293237424050', form_type: 'Booking', submission_id: 'B2',
    raw_payload: bookingPayload(sold2.job_id_human)
  });
  assert.equal(ok.status, 'Processed');
  const second = s2.list('Allocations').find(a => a.role === 'Second');
  assert.ok(second);
  assert.equal(second.person_id, 'PERSON-sparky-b');
});

test('priority classification covers overdue/today/tomorrow/next7/later', () => {
  const asOf = '2026-09-09';
  assert.equal(classifyTaskDue({ due_at: '2026-09-08' }, asOf).class, 'OVERDUE');
  assert.equal(classifyTaskDue({ due_at: '2026-09-09' }, asOf).class, 'DUE_TODAY');
  assert.equal(classifyTaskDue({ due_at: '2026-09-10' }, asOf).class, 'DUE_TOMORROW');
  assert.equal(classifyTaskDue({ due_at: '2026-09-14' }, asOf).class, 'NEXT_7_DAYS');
  assert.equal(classifyTaskDue({ due_at: '2026-10-01' }, asOf).class, 'NORMAL_LATER');
  assert.equal(classifyTaskDue({ due_at: null }, asOf).class, 'NO_DUE');
});

test('task generation after booking gates is idempotent with owners', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-G');
  proc(s).processBooking({
    intake_id: 'INT-BK-G', form_id: '250293237424050', form_type: 'Booking', submission_id: 'G1',
    raw_payload: bookingPayload(soldR.job_id_human)
  });
  s.update('Jobs', soldR.job_id, {
    deposit_bank_confirmed_at: '2026-09-01T00:00:00.000Z',
    deposit_bank_confirmed_by: 'PERSON-ben',
    deposit_bank_reference: 'BANK-EVID-1',
    contract_status: 'Signed',
    contract_evidence_id: 'CONTRACT-EVID-1',
    customer_details_verified_at: '2026-09-01T00:00:00.000Z',
    customer_details_verified_by: 'PERSON-tanya',
    sold_booking_match_status: 'Match',
    original_gross_pence: 500000,
    finance_route: 'Standard',
    workflow_stage: 'BookingInProgress',
    version: 3
  });
  const a = processBookingGates(soldR.job_id, s);
  const required = ['PRE01','PRE02','PRE03','PRE04','BKG01','BKG02','BKG03'];
  s.list('Tasks').filter(t => required.includes(t.template_code)).forEach(t => s.update('Tasks', t.id, { status:'Complete',completed_at:'2026-09-02T00:00:00.000Z',completed_by:t.owner_id,completion_note:'Checked',evidence_id:'EVID-'+t.template_code,version:Number(t.version||0)+1 }));
  const b = processBookingGates(soldR.job_id, s);
  const c = processBookingGates(soldR.job_id, s);
  assert.ok(a.tasks.created.length >= 1 || a.tasks.skipped.length >= 1);
  assert.equal(s.get('Jobs', soldR.job_id).workflow_stage, 'Booked');
  assert.deepEqual(b.tasks.created.map(t => t.template).sort(), ['BKG04','BKG05']);
  assert.equal(c.tasks.created.length, 0);
  const keys = s.list('Tasks').map(t => t.instance_key);
  assert.equal(keys.length, new Set(keys).size);
  assert.deepEqual(s.list('Tasks').filter(t => /^BKG0[1-5]$/.test(t.template_code)).map(t => t.template_code).sort(), ['BKG01','BKG02','BKG03','BKG04','BKG05']);
});

test('finance Sold creates PRE05 instead of Standard deposit tasks', () => {
  const s = store();
  const r = proc(s).processSold({
    intake_id: 'INT-SOLD-FIN', form_id: '260185763834060', form_type: 'Sold', submission_id: 'SUB-FIN',
    raw_payload: { sold_first_name:'F', sold_last_name:'Finance', sold_address1:'1 Test', sold_town:'T', sold_postcode:'TS1 1AA', sold_email:'f@example.invalid', sold_phone:'07000000000', sold_finance_route:'Phoenix', sold_gross_pence:'500000', sold_roof:'Yes', sold_electrical:'Yes', sold_scaffold:'Yes' }
  });
  const codes = s.list('Tasks').filter(t => t.job_id === r.job_id).map(t => t.template_code);
  assert.ok(codes.includes('PRE05'));
  assert.ok(!codes.includes('PRE01'));
  assert.ok(!codes.includes('PRE03'));
});

test('Move Job roof only preserves electrical; multi-day move; impact tasks; no external calls', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-MV');
  proc(s).processBooking({
    intake_id: 'INT-BK-MV', form_id: '250293237424050', form_type: 'Booking', submission_id: 'MV',
    raw_payload: bookingPayload(soldR.job_id_human)
  });
  const job = s.get('Jobs', soldR.job_id);
  s.update('Jobs', job.id, { pilot_job: true, release_scope: 'R1', version: Number(job.version) });
  const roof = s.list('WorkPackages').find(w => w.trade === 'Roof');
  const elec = s.list('WorkPackages').find(w => w.trade === 'Electrical');
  const elecBefore = elec.planned_start;
  const r = moveJobR1({
    command_id: 'MOVE-ROOF-1', job_id: job.id, expected_version: Number(s.get('Jobs', job.id).version),
    actor: 'PERSON-tanya', reason: 'Customer agreed roof move',
    activities: ['Roof'], planned_start: '2026-10-13', planned_end: '2026-10-14', at: '2026-09-09T12:00:00.000Z'
  }, s);
  assert.equal(r.status, 'Moved');
  assert.equal(r.external_calls, 0);
  assert.equal(s.get('WorkPackages', roof.id).planned_start, '2026-10-13');
  assert.equal(s.get('WorkPackages', roof.id).planned_end, '2026-10-14');
  assert.equal(s.get('WorkPackages', elec.id).planned_start, elecBefore);
  assert.ok(r.impact_tasks.some(t => t.code === 'CUSTOMER_NOTICE'));
  assert.ok(s.list('Outbox').every(o => String(o.response_summary || '').indexOf('CAPTURE_ONLY') >= 0 || o.action_type));
});

test('Move Job electrical only and Change Installer Replace via R1 helpers', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-CI');
  proc(s).processBooking({
    intake_id: 'INT-BK-CI', form_id: '250293237424050', form_type: 'Booking', submission_id: 'CI',
    raw_payload: bookingPayload(soldR.job_id_human)
  });
  const job = s.get('Jobs', soldR.job_id);
  s.update('Jobs', job.id, { pilot_job: true, release_scope: 'R1' });
  const roofBefore = s.list('WorkPackages').find(w => w.trade === 'Roof').planned_start;
  moveJobR1({
    command_id: 'MOVE-ELEC-1', job_id: job.id, expected_version: Number(s.get('Jobs', job.id).version),
    actor: 'PERSON-tanya', reason: 'Sparky delay', activities: ['Electrical'],
    planned_start: '2026-10-15', planned_end: '2026-10-15', at: '2026-09-09T12:00:00.000Z'
  }, s);
  assert.equal(s.list('WorkPackages').find(w => w.trade === 'Roof').planned_start, roofBefore);
  const elec = s.list('WorkPackages').find(w => w.trade === 'Electrical');
  const oldAlloc = s.list('Allocations').find(a => a.work_package_id === elec.id && a.role === 'Lead' && a.active);
  const ch = changeInstallerR1({
    command_id: 'CHG-1', job_id: job.id, work_package_id: elec.id, old_allocation_id: oldAlloc.id,
    person_id: 'PERSON-sparky-b', mode: 'Replace', reason: 'Lead unavailable',
    expected_version: Number(s.get('WorkPackages', elec.id).version), actor: 'PERSON-tanya', at: '2026-09-09T12:00:00.000Z'
  }, s);
  assert.equal(ch.status, 'Replaced');
  assert.equal(ch.external_calls, 0);
  assert.equal(s.get('Allocations', oldAlloc.id).active, false);
});

test('planners 3 and 6 weeks return resource rows; AppSheet MOVE_JOB availability', () => {
  const s = store();
  const soldR = sold(s, 'INT-SOLD-PL');
  proc(s).processBooking({
    intake_id: 'INT-BK-PL', form_id: '250293237424050', form_type: 'Booking', submission_id: 'PL',
    raw_payload: bookingPayload(soldR.job_id_human)
  });
  s.update('Jobs', soldR.job_id, { pilot_job: true, release_scope: 'R1', workflow_stage: 'Booked' });
  const p3 = buildPlanner(s, '2026-10-01', 3);
  const p6 = buildPlanner(s, '2026-10-01', 6);
  assert.equal(p3.weeks, 3);
  assert.equal(p6.weeks, 6);
  assert.ok(p3.rows.length >= 1);

  const tables = {
    People: [{ id: 'PERSON-tanya', email: 'tanya@example.test', active: true }],
    PersonRoles: [{ person_id: 'PERSON-tanya', role: 'Office', active: true }],
    Jobs: [{ id: soldR.job_id, pilot_job: true, release_scope: 'R1', version: 1, workflow_stage: 'Booked', salesperson_id: null }],
    Tasks: [{ id: 'T1', job_id: soldR.job_id, owner_id: 'PERSON-tanya', backup_id: null, version: 1, status: 'Open' }],
    Issues: [], WorkPackages: [], ReleaseModes: [{ function_id: 'FN-01', target_release: 'R1', authorised_job_scope: 'Pilot', mode: 'Automated' },
      { function_id: 'FN-17', target_release: 'R1', authorised_job_scope: 'Pilot', mode: 'Manual' },
      { function_id: 'FN-20', target_release: 'R1', authorised_job_scope: 'Pilot', mode: 'Manual' },
      { function_id: 'FN-15', target_release: 'R1', authorised_job_scope: 'Pilot', mode: 'Manual' },
      { function_id: 'FN-19', target_release: 'R1', authorised_job_scope: 'Pilot', mode: 'Manual' },
      { function_id: 'FN-11', target_release: 'R1', authorised_job_scope: 'Pilot', mode: 'Manual' }],
    Intake: [], AuditEvents: [], CommitJournal: []
  };
  const st = {
    getSheetId: () => adapter.R1A_BOUND_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => clone(tables[n] || []), get: (n, id) => clone((tables[n] || []).find(x => x.id === id) || null),
    insert() {}, update() {}, withLock: fn => fn()
  };
  const a = adapter._r1aCreate({
    store: st, config: { environment: 'DEV', sheetId: adapter.R1A_BOUND_DEV_SHEET_ID },
    actorEmail: () => 'tanya@example.test',
    reads: { actionAvailability: () => ({ job_id: soldR.job_id }), officeHome: () => ({ overdue: [], due_today: [], due_soon: [], booking_review: [] }), planner: (store, asOf, weeks) => buildPlanner(store, asOf || '2026-10-01', weeks) },
    services: services._r1sServices()
  });
  const avail = a.read({ read_type: 'ACTION_AVAILABILITY', job_id: soldR.job_id });
  assert.equal(avail.data.appsheet_commands.move_job.available, true);
  assert.equal(avail.data.appsheet_commands.change_installer.available, true);
  assert.ok(avail.data.appsheet_commands.move_job.command_type === 'MOVE_JOB');
});

test('no real external side-effect APIs in new office modules', () => {
  const fs = require('node:fs');
  const src = ['s05/intake.js', 's05/booking-apply.js', 's05/mapping.js', 's11/planner.js', 'r1-appsheet/services.js']
    .map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(src, /UrlFetchApp|MailApp|GmailApp|CalendarApp\.|DriveApp/);
});
