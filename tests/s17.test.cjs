const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const core = require('../s17/admin.js'), fixture = require('../s17/fixture.js');
const copy = x => structuredClone(x);

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables,
    getSheetId: () => core.S17_ADMIN_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) {
      assert.ok(tables[n], n);
      const h = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k);
      tables[n].push(copy(r));
    },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  // Pre-seed shared S16 prerequisite J-s16-old (simulating prior S16 fixture run)
  s.insert('Jobs', {
    id: 'J-s16-old', job_id: 'SS-S16O-LD01', customer_id: null, display_name: 'S16 Old Job',
    finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete', handover_status: 'Sent', financial_status: 'Complete',
    pilot_job: true, release_scope: 'R1',
    operational_complete_at: '2025-02-01T00:00:00.000Z', archived_at: null,
    created_at: '2025-02-01T00:00:00Z', created_by: 'S16', updated_at: '2025-02-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16-fixture', commit_id: 'S16-fixture'
  });
  fixture._s17Seed(s);
  return s;
}

test('S17 01: office today returns overdue, due-today, due-soon counts', () => {
  const s = makeStore();
  const t = core._s17OfficeToday(s, { as_of: '2026-09-06' });
  assert.equal(typeof t.overdue_count, 'number');
  assert.equal(typeof t.due_today_count, 'number');
  assert.equal(typeof t.due_soon_count, 'number');
  assert.ok(Array.isArray(t.overdue));
  assert.ok(Array.isArray(t.due_today));
  assert.ok(Array.isArray(t.due_soon));
  // TASK-s17-overdue: due 2026-08-01, as_of 2026-09-06 → overdue
  assert.ok(t.overdue.some(x => x.id === 'TASK-s17-overdue'), 'overdue task should be found');
  // TASK-s17-today: due 2026-09-06 → due today
  assert.ok(t.due_today.some(x => x.id === 'TASK-s17-today'), 'today task should be found');
  // TASK-s17-soon: due 2026-09-10 → within 7 days
  assert.ok(t.due_soon.some(x => x.id === 'TASK-s17-soon'), 'soon task should be found');
  // TASK-s17-complete: should NOT appear
  assert.ok(![...t.overdue, ...t.due_today, ...t.due_soon].some(x => x.id === 'TASK-s17-complete'));
});

test('S17 02: office today includes booking review and health alerts', () => {
  const s = makeStore();
  const t = core._s17OfficeToday(s, { as_of: '2026-09-06' });
  assert.equal(typeof t.booking_review_count, 'number');
  assert.equal(typeof t.unresolved_issues_count, 'number');
  assert.equal(typeof t.health_alerts_count, 'number');
  assert.ok(Array.isArray(t.booking_review));
  assert.ok(Array.isArray(t.health_alerts));
});

test('S17 03: job overview assembles all domains', () => {
  const s = makeStore();
  const o = core._s17JobOverview(s, 'J-s17-active');
  assert.equal(o.found, true);
  assert.ok(o.identity);
  assert.equal(o.identity.id, 'J-s17-active');
  assert.equal(o.identity.workflow_stage, 'Booked');
  assert.ok(o.booking);
  assert.ok(o.work);
  assert.equal(o.work.roof_required, true);
  assert.equal(o.work.electrical_required, true);
  assert.equal(o.work.scaffold_required, true);
  assert.equal(o.work.packages.length, 2);
  assert.ok(o.materials);
  assert.ok(o.scaffold);
  assert.ok(o.commissioning);
  assert.ok(o.handover);
  assert.ok(o.finance);
  assert.equal(o.finance.stages.length, 2);
  assert.ok(o.crm);
  assert.ok(o.cancellation);
  assert.ok(o.archive);
  assert.ok(o.system);
});

test('S17 04: job overview for missing job returns found=false', () => {
  const s = makeStore();
  const o = core._s17JobOverview(s, 'NONEXISTENT');
  assert.equal(o.found, false);
});

test('S17 05: job search by job_id, display_name, postcode', () => {
  const s = makeStore();
  // Add a customer for the active job
  s.insert('Customers', { id: 'CUST-s17', first_name: 'John', last_name: 'Smith', postcode: 'AB12 3CD', email: 'smith@example.invalid', phone: '07123456789', created_at: '2026-01-01T00:00:00Z', created_by: 'S17', updated_at: '2026-01-01T00:00:00Z', updated_by: 'S17', version: 1, source_system: 'S17', commit_id: 'S17' });
  const r1 = core._s17JobSearch(s, 'SS-S17A');
  assert.ok(r1.length >= 1);
  const r2 = core._s17JobSearch(s, 'Smith');
  assert.ok(r2.length >= 1);
  const r3 = core._s17JobSearch(s, 'AB12');
  assert.ok(r3.length >= 1);
  const r4 = core._s17JobSearch(s, 'smith@example');
  assert.ok(r4.length >= 1);
  const r5 = core._s17JobSearch(s, 'nonexistent_xyz');
  assert.equal(r5.length, 0);
  const r6 = core._s17JobSearch(s, '');
  assert.equal(r6.length, 0);
});

test('S17 06: operational queue returns tasks by category', () => {
  const s = makeStore();
  const q1 = core._s17OperationalQueue(s, 'booking');
  assert.equal(typeof q1.count, 'number');
  assert.ok(Array.isArray(q1.tasks));
  const q2 = core._s17OperationalQueue(s, 'materials');
  assert.equal(typeof q2.count, 'number');
  const q3 = core._s17OperationalQueue(s, 'scaffold');
  assert.equal(typeof q3.count, 'number');
  const qUnknown = core._s17OperationalQueue(s, 'nonexistent');
  assert.ok(qUnknown.error);
  assert.ok(qUnknown.available);
  s.insert('Tasks', { id: 'T-s17-ins01', job_id: 'J-s17-active', template_code: 'INS01', group: 'Install', title: 'Installer call', owner_id: 'PERSON-tanya', status: 'Open', due_at: '2026-09-08T09:00:00.000Z', created_at: '2026-01-01T00:00:00Z', created_by: 'S17', updated_at: '2026-01-01T00:00:00Z', updated_by: 'S17', version: 1, source_system: 'S17', commit_id: 'S17' });
  s.insert('Tasks', { id: 'T-s17-ins04', job_id: 'J-s17-active', template_code: 'INS04', group: 'Aftercare', title: 'Customer call', owner_id: 'PERSON-tanya', status: 'Open', due_at: '2026-09-08T09:00:00.000Z', created_at: '2026-01-01T00:00:00Z', created_by: 'S17', updated_at: '2026-01-01T00:00:00Z', updated_by: 'S17', version: 1, source_system: 'S17', commit_id: 'S17' });
  const calls = core._s17OperationalQueue(s, 'calls');
  assert.ok(calls.tasks.some(t => t.id === 'T-s17-ins01'));
  assert.ok(calls.tasks.some(t => t.id === 'T-s17-ins04'));
});

test('S17 07: admin ReleaseModes returns all 20 functions', () => {
  const s = makeStore();
  const modes = core._s17AdminReleaseModes(s);
  assert.ok(Array.isArray(modes));
  assert.ok(modes.length >= 20);
  for (const m of modes) {
    assert.ok(m.function_id);
    assert.ok(m.mode);
    assert.ok(m.target_release);
    assert.ok(m.authorised_job_scope);
  }
});

test('S17 08: admin system status includes health, not_configured', () => {
  const s = makeStore();
  const st = core._s17AdminSystemStatus(s);
  assert.ok(st.health);
  assert.ok(st.commit_journal);
  assert.ok(st.outbox);
  assert.ok(Array.isArray(st.not_configured));
  assert.equal(typeof st.not_configured_count, 'number');
});

test('S17 09: audit history returns chronological events', () => {
  const s = makeStore();
  const h = core._s17AuditHistory(s, 'J-s17-active');
  assert.equal(h.found, true);
  assert.equal(typeof h.total_events, 'number');
  assert.ok(h.total_events >= 2);
  assert.ok(Array.isArray(h.events));
  // Verify chronological order
  for (let i = 1; i < h.events.length; i++) {
    assert.ok(h.events[i - 1].timestamp <= h.events[i].timestamp);
  }
});

test('S17 10: audit history for missing job returns found=false', () => {
  const s = makeStore();
  const h = core._s17AuditHistory(s, 'NONEXISTENT');
  assert.equal(h.found, false);
});

test('S17 11: action availability reports per-action state without complete_task', () => {
  const s = makeStore();
  const a = core._s17ActionAvailability(s, 'J-s17-active');
  assert.equal(a.found, true);
  assert.ok(a.actions);
  // complete_task is NOT in per-job action list — it is task-specific
  assert.equal(a.actions.complete_task, undefined, 'complete_task must not be a per-job action');
  assert.ok(a.actions.cancel_job);
  assert.ok(a.actions.archive_job);
  assert.equal(typeof a.actions.record_call.available, 'boolean');
});

test('S17 12: action availability respects disabled mode', () => {
  const s = makeStore();
  s.update('ReleaseModes', 'RM-FN01', { mode: 'Disabled', authorised_job_scope: 'None' });
  const a = core._s17ActionAvailability(s, 'J-s17-active');
  assert.equal(a.actions.record_call.available, false);
  assert.equal(a.actions.record_call.mode, 'Disabled');
  assert.equal(a.actions.operational_completion.available, false);
  assert.equal(a.actions.operational_completion.mode, 'Disabled');
});

test('S17 13: action availability for cancelled job', () => {
  const s = makeStore();
  s.update('Jobs', 'J-s17-active', { workflow_stage: 'CancellationInProgress', cancellation_at: '2026-09-01T00:00:00Z', cancellation_by: 'PERSON-s17-office', cancellation_reason: 'Test' });
  const a = core._s17ActionAvailability(s, 'J-s17-active');
  assert.equal(a.actions.record_call.available, false);
  assert.equal(a.actions.approve_booking.available, false);
  assert.equal(a.actions.reinstate_job.available, false); // CancellationInProgress, not Cancelled
});

test('S17 14: task action availability — completable task', () => {
  const s = makeStore();
  const ta = core._s17TaskActionAvailability(s, 'TASK-s17-today');
  assert.equal(ta.found, true);
  assert.equal(ta.status, 'Open');
  assert.equal(ta.actions.complete.available, true);
});

test('S17 15: task action availability — already complete task not completable', () => {
  const s = makeStore();
  const ta = core._s17TaskActionAvailability(s, 'TASK-s17-complete');
  assert.equal(ta.found, true);
  assert.equal(ta.status, 'Complete');
  assert.equal(ta.actions.complete.available, false);
  assert.ok(ta.actions.complete.note);
});

test('S17 16: task action availability — missing task', () => {
  const s = makeStore();
  const ta = core._s17TaskActionAvailability(s, 'NONEXISTENT');
  assert.equal(ta.found, false);
});

test('S17 17: cancel_job mode is Manual when FN-17 is Manual', () => {
  const s = makeStore();
  // Enable FN-01 = Automated/Pilot, FN-17 = Manual/Pilot → combined = Manual
  s.update('ReleaseModes', 'RM-FN01', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  s.update('ReleaseModes', 'RM-FN17', { mode: 'Manual', authorised_job_scope: 'Pilot' });
  const a = core._s17ActionAvailability(s, 'J-s17-active');
  assert.equal(a.actions.cancel_job.mode, 'Manual');
  assert.equal(a.actions.cancel_job.available, true);
});

test('S17 18: pilot-scoped function rejects non-pilot job', () => {
  const s = makeStore();
  s.update('Jobs', 'J-s17-active', { pilot_job: false });
  // FN-01 is Automated/Pilot → non-pilot job should not have record_call available
  const a = core._s17ActionAvailability(s, 'J-s17-active');
  assert.equal(a.actions.record_call.available, false);
});

test('S17 19: date handling — strings, Date objects, invalid', () => {
  assert.equal(core._s17Date('2026-09-06'), '2026-09-06');
  assert.equal(core._s17Date(new Date('2026-09-06T12:00:00Z')), '2026-09-06');
  assert.throws(() => core._s17Date('2026-02-30'), /DATE_INVALID/);
  assert.throws(() => core._s17Date(new Date('invalid')), /DATE_INVALID/);
  assert.equal(core._s17Date(null), null);
  assert.equal(core._s17Date(''), null);
});

test('S17 20: missing/optional data handled gracefully', () => {
  const s = makeStore();
  // Job overview with no work packages, no allocations, no scaffold
  s.insert('Jobs', {
    id: 'J-s17-minimal', job_id: 'SS-S17M-IN', customer_id: null, display_name: 'Minimal',
    sold_submission_id: null, booking_submission_id: null, sold_at: null, salesperson_id: null,
    lead_source: null, quote_reference: null, presale_file_id: null,
    finance_route: 'Standard', contract_status: 'NotSent', contract_id: null,
    contract_signed_at: null, contract_evidence_id: null,
    original_net_pence: null, original_vat_pence: null, original_gross_pence: null,
    approved_change_pence: null, current_contract_gross_pence: null,
    valuation_basis: null, sold_booking_match_status: 'Pending',
    customer_details_verified_at: null, customer_details_verified_by: null,
    deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null, deposit_bank_reference: null,
    roof_required: false, electrical_required: false, scaffold_required: false,
    workflow_stage: 'Prebooking', booking_approved_at: null, booking_approved_by: null,
    operational_complete_at: null, operational_complete_by: null,
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'NotReady', financial_status: 'Pending',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null, next_action_at: null, account_policy_version: null,
    pilot_job: true, release_scope: 'R1', source_record_id: null,
    created_at: '2026-09-01T00:00:00Z', created_by: 'S17', updated_at: '2026-09-01T00:00:00Z', updated_by: 'S17', version: 1, source_system: 'S17', commit_id: 'S17'
  });
  const o = core._s17JobOverview(s, 'J-s17-minimal');
  assert.equal(o.found, true);
  assert.equal(o.work.packages.length, 0);
  assert.equal(o.work.allocations.length, 0);
  assert.equal(o.finance.stages.length, 0);
  assert.equal(o.finance.original_gross_pence, 0);
});

test('S17 21: fixture idempotency — seed does not duplicate', () => {
  const s = makeStore();
  const before = copy(s.tables);
  fixture._s17Seed(s);
  // All fixture tables should be unchanged (idempotent)
  for (const t of Object.keys(before)) {
    assert.equal(s.tables[t].length, before[t].length, 'table ' + t + ' changed');
  }
});

test('S17 22: pre-existing J-s16-old from S16 is accepted as shared dependency', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => core.S17_ADMIN_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  // Pre-insert J-s16-old as if from S16 fixture (created_by='S16')
  s.insert('Jobs', {
    id: 'J-s16-old', job_id: 'SS-S16O-LD01', customer_id: null, display_name: 'S16 Old Job',
    finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete', handover_status: 'Sent', financial_status: 'Complete',
    pilot_job: true, release_scope: 'R1',
    operational_complete_at: '2025-02-01T00:00:00.000Z', archived_at: null,
    created_at: '2025-02-01T00:00:00Z', created_by: 'S16', updated_at: '2025-02-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16-fixture', commit_id: 'S16-fixture'
  });
  // Seed must succeed — J-s16-old is a shared dependency, created_by='S16' is fine
  fixture._s17Seed(s);
  // Verify J-s16-old was NOT overwritten
  const j = s.get('Jobs', 'J-s16-old');
  assert.equal(j.created_by, 'S16', 'prior-stage provenance preserved');
});

test('S17 23: missing shared prerequisite J-s16-old fails clearly', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => core.S17_ADMIN_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  // No J-s16-old pre-inserted — seed must fail
  assert.throws(() => fixture._s17Seed(s), /shared prerequisite J-s16-old not found/);
});

test('S17 24: incompatible shared Job fails closed', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => core.S17_ADMIN_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  // J-s16-old with incompatible workflow_stage
  s.insert('Jobs', {
    id: 'J-s16-old', job_id: 'SS-S16O-LD01', customer_id: null, display_name: 'S16 Old Job',
    finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'Cancelled', handover_status: 'Sent', financial_status: 'Complete',
    pilot_job: true, release_scope: 'R1',
    operational_complete_at: '2025-02-01T00:00:00.000Z', archived_at: null,
    created_at: '2025-02-01T00:00:00Z', created_by: 'S16', updated_at: '2025-02-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16-fixture', commit_id: 'S16-fixture'
  });
  assert.throws(() => fixture._s17Seed(s), /incompatible shared Job.*workflow_stage/);
});

test('S17 25: fixture collision refused for non-S17 rows', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => core.S17_ADMIN_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  // Pre-insert J-s16-old as shared dependency
  s.insert('Jobs', {
    id: 'J-s16-old', job_id: 'SS-S16O-LD01', customer_id: null, display_name: 'S16 Old Job',
    finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete', handover_status: 'Sent', financial_status: 'Complete',
    pilot_job: true, release_scope: 'R1',
    operational_complete_at: '2025-02-01T00:00:00.000Z', archived_at: null,
    created_at: '2025-02-01T00:00:00Z', created_by: 'S16', updated_at: '2025-02-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16-fixture', commit_id: 'S16-fixture'
  });
  // Pre-insert an S17-owned Job with different created_by — must collide
  s.insert('Jobs', {
    id: 'J-s17-active', job_id: 'SS-OTHER', customer_id: null, display_name: 'Other', finance_route: 'Standard', contract_status: 'NotSent',
    sold_booking_match_status: 'Pending', roof_required: false, electrical_required: false, scaffold_required: false,
    workflow_stage: 'Prebooking', handover_status: 'NotReady', financial_status: 'Pending',
    pilot_job: false, release_scope: 'R1',
    created_at: '2026-01-01T00:00:00Z', created_by: 'OTHER', updated_at: '2026-01-01T00:00:00Z', updated_by: 'OTHER', version: 1, source_system: 'OTHER', commit_id: 'OTHER'
  });
  assert.throws(() => fixture._s17Seed(s), /fixture ID collision/);
});

test('S17 26: no mutation of operational state', () => {
  const s = makeStore();
  const before = copy(s.tables);
  core._s17OfficeToday(s, { as_of: '2026-09-06' });
  core._s17JobOverview(s, 'J-s17-active');
  core._s17JobSearch(s, 'test');
  core._s17OperationalQueue(s, 'booking');
  core._s17AdminReleaseModes(s);
  core._s17AdminSystemStatus(s);
  core._s17AuditHistory(s, 'J-s17-active');
  core._s17ActionAvailability(s, 'J-s17-active');
  assert.deepEqual(s.tables, before);
});

test('S17 27: namespace compatibility — all bundles parse, S17 globals namespaced', () => {
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('s17/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  const s17 = fs.readFileSync('apps-script/s17/S17Admin.js', 'utf8');
  new vm.Script(prior + '\n' + s17);
  for (const m of s17.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm))
    assert.match(m[1], /^(?:S17_|_s17|runS17)/);
  assert.doesNotMatch(s17, /CalendarApp|UrlFetchApp|fetch\(|deleteRow|deleteSheet|GmailApp|MailApp|DriveApp|https:\/\//);
});

test('S17 28: zero-arg DEV smoke with real header adapter reruns', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/s17/S17Admin.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.S17_HEADERS)) grids[n] = [Array.from(h)];
  for (const r of seed.ReleaseModes) {
    grids.ReleaseModes.push(grids.ReleaseModes[0].map(k => r[k] ?? (k === 'version' ? 1 : '')));
  }
  // Pre-seed shared S16 prerequisite J-s16-old (simulating prior S16 fixture run)
  var s16jobCols = ctx.S17_HEADERS['Jobs'];
  var s16jobRow = s16jobCols.map(function (k) {
    var vals = { id: 'J-s16-old', job_id: 'SS-S16O-LD01', display_name: 'S16 Old Job', finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: false, scaffold_required: false, workflow_stage: 'OperationallyComplete', handover_status: 'Sent', financial_status: 'Complete', pilot_job: true, release_scope: 'R1', operational_complete_at: '2025-02-01T00:00:00.000Z', created_at: '2025-02-01T00:00:00Z', created_by: 'S16', updated_at: '2025-02-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16-fixture', commit_id: 'S16-fixture' };
    return vals[k] !== undefined ? vals[k] : '';
  });
  grids.Jobs.push(s16jobRow);
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() {
          return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? ''));
        },
        setValues(values) {
          values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; }));
        }
      };
    }
  }));
  ctx.SpreadsheetApp = { openById: () => ({ getId: () => core.S17_ADMIN_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.LockService = { getScriptLock: () => ({ tryLock() { return true; }, releaseLock() { } }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });

  for (const fn of ['runS17FixtureDryRun', 'runS17FixtureApply', 'runS17FixtureValidate', 'runS17HappyPathTest', 'runS17HappyPathTest']) {
    const r = ctx[fn]();
    assert.equal(r.pass, true, fn + ': ' + JSON.stringify(r));
  }
  // Header mismatch refusal
  grids.Jobs[0][1] = 'bad';
  assert.equal(ctx.runS17FixtureApply().pass, false);
});

test('S17 staff identification: task rows derive public Job ID, customer, postcode and names; job search covers business identifiers', () => {
  const s = makeStore();
  s.insert('People', { id: 'PERSON-idt-tanya', email: 'idt-tanya@example.invalid', display_name: 'Tanya', role: 'Office', active: true });
  s.insert('People', { id: 'PERSON-idt-ben', email: 'idt-ben@example.invalid', display_name: 'Ben', role: 'Director', active: true });
  s.insert('Customers', { id: 'CUST-idt', first_name: 'Jane', last_name: 'Parton', address_line1: '12 Example Road', address_line2: null, town: 'Paignton', postcode: 'TQ3 3HY', email: 'parton@example.invalid', phone: '07000000002' });
  s.insert('Customers', { id: 'CUST-idt-placeholder', first_name: 'Pat', last_name: 'Placeholder', address_line1: 'NOT_CONFIGURED', town: 'NOT_CONFIGURED', postcode: 'ZZ9 9ZZ' });
  s.insert('Jobs', { id: 'J-mu12y2e6-7y7tui', job_id: 'SS-SHHC-8091', customer_id: 'CUST-idt', display_name: 'Parton – TQ3 3HY', quote_reference: 'TQ33HY111', finance_route: 'Standard', workflow_stage: 'Prebooking', pilot_job: true, release_scope: 'R1' });
  s.insert('Jobs', { id: 'J-idt-placeholder', job_id: 'SS-PLAC-0001', customer_id: 'CUST-idt-placeholder', display_name: 'Placeholder – ZZ9 9ZZ', finance_route: 'Standard', workflow_stage: 'Prebooking', pilot_job: true, release_scope: 'R1' });
  const base = { group: 'Prebooking', status: 'Open', priority: 1, due_at: '2026-09-20T09:00:00.000Z', related_entity_type: 'Jobs' };
  s.insert('Tasks', { ...base, id: 'TASK-idt-pre03', job_id: 'J-mu12y2e6-7y7tui', template_code: 'PRE03', title: 'Confirm bank deposit', owner_id: 'PERSON-idt-ben', backup_id: 'PERSON-idt-missing', related_entity_id: 'J-mu12y2e6-7y7tui' });
  s.insert('Tasks', { ...base, id: 'TASK-idt-sys', job_id: null, template_code: 'SYS-IDT', group: 'Booking', title: 'System check', owner_id: 'PERSON-idt-tanya', backup_id: null });

  const queue = core._s17OperationalQueue(s, 'booking');
  const pre03 = queue.tasks.find(t => t.id === 'TASK-idt-pre03');
  assert.equal(pre03.job_id, 'J-mu12y2e6-7y7tui', 'canonical relationship retained');
  assert.equal(pre03.owner_id, 'PERSON-idt-ben');
  assert.equal(pre03.public_job_id, 'SS-SHHC-8091');
  assert.equal(pre03.customer_name, 'Jane Parton');
  assert.equal(pre03.postcode, 'TQ3 3HY');
  assert.equal(pre03.owner_name, 'Ben');
  assert.equal(pre03.backup_name, null, 'an unknown person never echoes a PERSON-* id as a name');
  assert.equal(pre03.job_label, 'SS-SHHC-8091 – Parton – TQ3 3HY');
  assert.equal(pre03.search_text, core._s17TaskSearchText(pre03));
  assert.ok(pre03.search_text.split(' | ').includes('ss-shhc-8091'));
  const sys = queue.tasks.find(t => t.id === 'TASK-idt-sys');
  assert.deepEqual([sys.public_job_id, sys.customer_name, sys.postcode, sys.job_label, sys.owner_name], [null, null, null, null, 'Tanya']);
  assert.equal(Object.prototype.hasOwnProperty.call(s.tables.Tasks.find(t => t.id === 'TASK-idt-pre03'), 'public_job_id'), false, 'presentation is never persisted onto Tasks');

  const home = core._s17OfficeToday(s, { as_of: '2026-09-15' });
  const homeRow = home.booking_review.find(t => t.id === 'TASK-idt-pre03');
  assert.deepEqual([homeRow.public_job_id, homeRow.customer_name, homeRow.postcode, homeRow.owner_name], ['SS-SHHC-8091', 'Jane Parton', 'TQ3 3HY', 'Ben']);
  const overview = core._s17JobOverview(s, 'J-mu12y2e6-7y7tui');
  assert.equal(overview.booking.tasks.find(t => t.id === 'TASK-idt-pre03').owner_name, 'Ben');

  for (const q of ['SS-SHHC-8091', 'ss-shhc', 'Parton', 'Jane', 'jane parton', 'TQ3 3HY', 'tq33hy', 'TQ3', 'TQ33HY111', '12 Example', 'Paignton', 'J-mu12y2e6-7y7tui']) {
    const results = core._s17JobSearch(s, q);
    const hit = results.find(r => r.id === 'J-mu12y2e6-7y7tui');
    assert.ok(hit, 'job search should find Parton by ' + q);
    assert.equal(results.some(r => r.id === 'J-idt-placeholder'), false, q + ' must not match the other job');
    assert.deepEqual([hit.job_id, hit.customer_name, hit.postcode, hit.quote_reference, hit.address_line1, hit.town, hit.job_label],
      ['SS-SHHC-8091', 'Jane Parton', 'TQ3 3HY', 'TQ33HY111', '12 Example Road', 'Paignton', 'SS-SHHC-8091 – Parton – TQ3 3HY']);
  }
  assert.equal(core._s17JobSearch(s, 'NOT_CONFIGURED').some(r => r.id === 'J-idt-placeholder'), false, 'placeholder address values are not searchable');
  const placeholder = core._s17JobSearch(s, 'zz99zz').find(r => r.id === 'J-idt-placeholder');
  assert.ok(placeholder);
  assert.equal(placeholder.address_line1, null);
});
