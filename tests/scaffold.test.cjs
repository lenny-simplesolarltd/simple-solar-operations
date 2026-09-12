/* Scaffold workflow tests — local only. No sends, no external calls. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const scf = require('../scaffold/workflow.js'), s09fx = require('../s09/fixture.js'), p = require('../s11/planner.js');
const copy = x => structuredClone(x);
const T0 = '2026-09-14T09:00:00.000Z'; /* Monday 14 Sep 2026 10:00 London */
const ACTOR = 'PERSON-tanya';

function makeStore(opts = {}) {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  let held = false;
  const s = {
    tables,
    getSheetId: () => scf.SCF_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) {
      assert.ok(tables[n], n);
      assert.ok(!this.get(n, r.id), 'duplicate ' + n + '/' + r.id);
      const headers = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(r)) assert.ok(headers.includes(k), 'unknown ' + n + '.' + k);
      tables[n].push(copy(r));
    },
    update(n, id, patch) {
      const r = tables[n].find(r => r.id === id); assert.ok(r, n + '/' + id);
      const headers = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(patch)) assert.ok(headers.includes(k), 'unknown ' + n + '.' + k);
      Object.assign(r, copy(patch));
    },
    withLock(fn) { assert.equal(held, false, 'lock contention'); held = true; try { return fn(); } finally { held = false; } }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  s.update('ReleaseModes', 'RM-FN04', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  for (const r of seed.Settings) s.insert('Settings', { ...r, created_at: T0, commit_id: 'seed' });
  for (const r of seed.TaskTemplates) s.insert('TaskTemplates', { ...r, created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' });
  s09fx.installBaseFixture(s); /* synthetic scaffolder COMP-scaffold-dev, Tanya, SCA01 reuse */
  const job = s09fx.buildJob(true); /* source_system S09 → synthetic job */
  if (opts.realJob) { job.source_system = 'S05'; job.id = 'J-real'; job.job_id = 'SS-REAL-0001'; }
  s.insert('Jobs', job);
  return s;
}
function configureReal(s) {
  return scf._scfConfigureScaffolder(s, { actor: 'PERSON-ben', command_id: 'CFG-1', company_id: 'COMP-acme-scaffold', name: 'Acme Scaffolding', standard_lead_days: 5, contact: { name: 'Pat', email: 'pat@acme.example', phone: '01onesix' }, at: T0 });
}
function request(s, extra = {}) {
  return scf._scfRequest(s, { actor: ACTOR, command_id: 'REQ-1', job_id: 'J-s09-ready', company_id: 'COMP-scaffold-dev', erect_planned_at: '2026-10-05', strip_forecast_at: '2026-10-20', access_notes: 'Side gate', scope_file_id: 'drive-scope-1', quoted_cost_pence: 85000, expected_version: 1, at: T0, ...extra });
}
function booking(s) { return s.tables.ScaffoldBookings.find(b => b.job_id === 'J-s09-ready' && b.status !== 'Cancelled') || s.tables.ScaffoldBookings[0]; }
function tasks(s, id) { return s.tables.Tasks.filter(t => t.related_entity_id === id).map(t => t.template_code + ':' + t.status).sort(); }
function toErected(s) {
  request(s);
  let b = booking(s);
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: '2026-09-29T10:00:00.000Z' });
  b = booking(s);
  scf._scfRecordErected(s, { actor: ACTOR, command_id: 'ERECT-1', booking_id: b.id, erect_actual_at: '2026-10-05', expected_version: b.version, at: '2026-10-05T15:00:00.000Z' });
  return booking(s);
}

test('SCF 01: configuring a real scaffolder stores company + contact with audit, idempotent, refuses synthetic names', () => {
  const s = makeStore();
  const r = configureReal(s);
  assert.equal(r.company.type, 'Scaffolder');
  assert.equal(r.company.source_system, 'SCF-config');
  assert.equal(r.contact.email, 'pat@acme.example');
  assert.equal(s.get('CommitJournal', 'CJ-SCF-CFG-1').state, 'Committed');
  assert.equal(configureReal(s).replay, true);
  assert.equal(s.tables.Companies.filter(c => c.type === 'Scaffolder').length, 2);
  const list = scf._scfScaffolders(s);
  assert.deepEqual(list.map(x => [x.company_id, x.synthetic, x.configured]), [['COMP-scaffold-dev', true, false], ['COMP-acme-scaffold', false, true]]);
  assert.throws(() => scf._scfConfigureScaffolder(s, { actor: 'PERSON-ben', command_id: 'CFG-2', company_id: 'COMP-x', name: 'DEV Scaffold Two', at: T0 }), /synthetic names/);
  s.insert('Companies', { ...seed.Companies[0], created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' });
  assert.throws(() => scf._scfConfigureScaffolder(s, { actor: 'PERSON-ben', command_id: 'CFG-3', company_id: 'COMP-greentech', name: 'Greentech', at: T0 }), /another type/);
  assert.throws(() => scf._scfConfigureScaffolder(s, { actor: 'PERSON-ben', command_id: 'CFG-4', company_id: 'COMP-y', name: 'Y Scaffold', standard_lead_days: 99, at: T0 }), /0-60/);
  /* Update path keeps the id and bumps version. */
  const upd = scf._scfConfigureScaffolder(s, { actor: 'PERSON-ben', command_id: 'CFG-5', company_id: 'COMP-acme-scaffold', name: 'Acme Scaffolding Ltd', standard_lead_days: 6, at: T0 });
  assert.equal(upd.company.version, 2);
  assert.equal(upd.company.name, 'Acme Scaffolding Ltd');
  assert.equal(s.tables.AuditEvents.filter(a => a.action === 'ConfigureScaffolder').length, 2);
});

test('SCF 02: request creates booking, SCA01 due per lead time on a staffed day, captured instruction; replay and conflicts', () => {
  const s = makeStore();
  const r = request(s);
  assert.equal(r.status, 'Requested');
  const b = r.booking;
  assert.equal(b.id, 'SB-J-s09-ready');
  assert.equal(b.revision, 1);
  assert.equal(b.confirmed_revision, null);
  assert.equal(b.quoted_cost_pence, 85000);
  assert.equal(s.get('Jobs', 'J-s09-ready').version, 2);
  const task = s.get('Tasks', r.task.task_id);
  assert.equal(task.template_code, 'SCA01');
  assert.equal(task.owner_id, 'PERSON-tanya');
  /* erect Mon 5 Oct minus 7 lead days = Mon 28 Sep 09:00 London (BST) */
  assert.equal(task.due_at, '2026-09-28T08:00:00.000Z');
  const comm = s.get('Communications', r.communication.communication_id);
  assert.equal(comm.status, 'Draft');
  assert.equal(comm.type, 'ScaffoldInstruction');
  assert.equal(comm.revision, 1);
  assert.equal(comm.sent_at, null);
  assert.equal(comm.outbox_id, null);
  assert.deepEqual(JSON.parse(comm.attachment_ids), ['drive-scope-1']);
  assert.equal(s.tables.CommunicationJobs[0].scaffold_booking_id, b.id);
  assert.equal(request(s).replay, true);
  assert.equal(s.tables.ScaffoldBookings.length, 1);
  assert.throws(() => request(s, { erect_planned_at: '2026-10-06' }), /conflicting command identity/);
  assert.throws(() => request(s, { command_id: 'REQ-2' }), /already has an active scaffold booking/);
  assert.equal(s.tables.Outbox.length, 0, 'no outbound rows: nothing is sent');
});

test('SCF 03: refusals — FN-04 disabled, wrong env, non-pilot job, scaffold not required, bad dates, synthetic scaffolder on a real job', () => {
  let s = makeStore(); s.update('ReleaseModes', 'RM-FN04', { mode: 'Disabled', authorised_job_scope: 'None' });
  let before = copy(s.tables); assert.throws(() => request(s), /FN-04 must be Automated\/Pilot/); assert.deepEqual(s.tables, before);
  s = makeStore(); s.getEnvironment = () => 'PROD'; assert.throws(() => request(s), /exact DEV/);
  s = makeStore(); s.update('Jobs', 'J-s09-ready', { pilot_job: false }); assert.throws(() => request(s), /pilot R2 job required/);
  s = makeStore(); s.update('Jobs', 'J-s09-ready', { scaffold_required: false }); assert.throws(() => request(s), /does not require scaffold/);
  s = makeStore(); assert.throws(() => request(s, { strip_forecast_at: '2026-10-01' }), /strip forecast before erect/);
  s = makeStore(); assert.throws(() => request(s, { erect_planned_at: '2026-13-40' }), /SCF_DATE_INVALID/);
  s = makeStore(); assert.throws(() => request(s, { company_id: 'COMP-greentech' }), /active Scaffolder company required/);
  s = makeStore(); assert.throws(() => request(s, { expected_version: 9 }), /SCF_STALE/);
  s = makeStore(); s.update('Jobs', 'J-s09-ready', { cancellation_at: T0 }); assert.throws(() => request(s), /S15_REVIEW/);
  /* Real job + synthetic scaffolder refused; real scaffolder accepted. */
  s = makeStore({ realJob: true });
  assert.throws(() => request(s, { job_id: 'J-real' }), /synthetic scaffolder cannot be used/);
  configureReal(s);
  const ok = request(s, { job_id: 'J-real', company_id: 'COMP-acme-scaffold' });
  assert.equal(ok.status, 'Requested');
  assert.equal(ok.booking.company_id, 'COMP-acme-scaffold');
  const t = s.get('Tasks', ok.task.task_id);
  assert.equal(t.due_at, '2026-09-30T08:00:00.000Z', 'lead 5 days → Wed 30 Sep 09:00 London');
});

test('SCF 04: confirm erect records acknowledgement of the current revision, completes SCA01, opens SCA02 at erect day end', () => {
  const s = makeStore(); request(s);
  let b = booking(s);
  const r = scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: '2026-09-29T10:00:00.000Z', response_text: 'Confirmed by phone' });
  assert.equal(r.status, 'Confirmed');
  b = booking(s);
  assert.equal(b.confirmed_revision, 1);
  assert.equal(b.erect_confirmed_at, '2026-09-29T10:00:00.000Z');
  assert.deepEqual(tasks(s, b.id), ['SCA01:Complete', 'SCA02:Open']);
  const sca02 = s.tables.Tasks.find(t => t.template_code === 'SCA02');
  assert.equal(sca02.due_at, '2026-10-05T16:00:00.000Z', '17:00 London BST');
  assert.equal(s.tables.Acknowledgements.length, 1);
  assert.equal(s.tables.Acknowledgements[0].acknowledged_revision, 1);
  assert.equal(s.tables.Acknowledgements[0].response_text, 'Confirmed by phone');
  assert.equal(scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: 99, at: T0 }).replay, true);
  assert.throws(() => scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-2', booking_id: b.id, expected_version: 1, at: T0 }), /SCF_STALE/);
  assert.equal(scf._scfBookingView(s, b.id).acknowledgement_required, false);
});

test('SCF 05: recording actual erect completes SCA02, flags lateness, refuses future dates', () => {
  const s = makeStore(); request(s);
  let b = booking(s);
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: T0 });
  b = booking(s);
  assert.throws(() => scf._scfRecordErected(s, { actor: ACTOR, command_id: 'ERECT-X', booking_id: b.id, erect_actual_at: '2026-10-07', expected_version: b.version, at: '2026-10-05T15:00:00.000Z' }), /cannot be in the future/);
  const r = scf._scfRecordErected(s, { actor: ACTOR, command_id: 'ERECT-1', booking_id: b.id, erect_actual_at: '2026-10-06', expected_version: b.version, at: '2026-10-06T15:00:00.000Z' });
  assert.equal(r.status, 'Erected');
  assert.equal(r.late, true);
  assert.deepEqual(tasks(s, b.id), ['SCA01:Complete', 'SCA02:Complete']);
  assert.equal(booking(s).erect_actual_at, '2026-10-06');
  assert.equal(booking(s).erect_planned_at, '2026-10-05', 'planned date preserved separately from actual');
});

test('SCF 06: strip authorisation is gated on customer happy and strip-blocking complaints; complaint stays open after strip', () => {
  const s = makeStore();
  let b = toErected(s);
  let r = scf._scfAuthoriseStrip(s, { actor: ACTOR, command_id: 'AUTH-1', booking_id: b.id, expected_version: b.version, at: '2026-10-10T10:00:00.000Z' });
  assert.equal(r.status, 'Blocked');
  assert.deepEqual(r.blockers, ['CUSTOMER_NOT_HAPPY']);
  assert.equal(booking(s).strip_authorised_at, null);
  s.update('Jobs', 'J-s09-ready', { customer_happy_at: '2026-10-09T10:00:00.000Z', customer_happy_by: ACTOR });
  const c = scf._scfComplaint(s, { actor: ACTOR, command_id: 'CMP-1', booking_id: b.id, category: 'UnsafeConcern', description: 'Loose board on lift 2', at: '2026-10-09T11:00:00.000Z' });
  assert.equal(c.blocks_strip, true);
  const issue = s.get('Issues', c.issue_id);
  assert.equal(issue.type, 'Complaint');
  assert.equal(issue.responsible_company_id, 'COMP-scaffold-dev');
  assert.equal(issue.severity, 'High');
  assert.equal(issue.office_owner_id, 'PERSON-tanya');
  assert.deepEqual(JSON.parse(booking(s).related_issue_ids), [c.issue_id]);
  b = booking(s);
  r = scf._scfAuthoriseStrip(s, { actor: ACTOR, command_id: 'AUTH-2', booking_id: b.id, expected_version: b.version, at: '2026-10-10T10:00:00.000Z' });
  assert.equal(r.status, 'Blocked');
  assert.match(r.blockers[0], /^STRIP_BLOCKING_ISSUES:ISS-SCF-CMP-1$/);
  s.update('Issues', c.issue_id, { status: 'Resolved', resolved_at: '2026-10-10T12:00:00.000Z' });
  /* A non-blocking complaint does not gate the strip and must survive the strip. */
  const c2 = scf._scfComplaint(s, { actor: ACTOR, command_id: 'CMP-2', booking_id: b.id, category: 'Damage', description: 'Gutter dent', at: '2026-10-10T12:30:00.000Z' });
  assert.equal(c2.blocks_strip, false);
  r = scf._scfAuthoriseStrip(s, { actor: ACTOR, command_id: 'AUTH-3', booking_id: booking(s).id, expected_version: booking(s).version, at: '2026-10-10T13:00:00.000Z' });
  assert.equal(r.status, 'StripAuthorised');
  b = booking(s);
  assert.equal(b.strip_authorised_by, ACTOR);
  const sca03 = s.tables.Tasks.find(t => t.template_code === 'SCA03');
  assert.equal(sca03.due_at, '2026-10-12T08:00:00.000Z', 'next staffed day (Mon 12 Oct) 09:00 London');
  r = scf._scfPlanStrip(s, { actor: ACTOR, command_id: 'PLAN-1', booking_id: b.id, strip_planned_at: '2026-10-15', expected_version: b.version, at: '2026-10-12T10:00:00.000Z' });
  assert.equal(r.status, 'StripPlanned');
  assert.equal(r.booking.revision, 2);
  assert.equal(r.acknowledgement_required, true);
  assert.equal(s.get('Communications', 'COMM-SCF-' + b.id + '-ScaffoldStripInstruction-R2').status, 'Draft');
  b = booking(s);
  r = scf._scfConfirmStrip(s, { actor: ACTOR, command_id: 'SCONF-1', booking_id: b.id, expected_version: b.version, at: '2026-10-12T11:00:00.000Z' });
  assert.equal(r.status, 'StripConfirmed');
  assert.equal(booking(s).confirmed_revision, 2);
  assert.deepEqual(tasks(s, b.id), ['SCA01:Complete', 'SCA02:Complete', 'SCA03:Complete', 'SCA04:Open']);
  assert.equal(s.tables.Tasks.find(t => t.template_code === 'SCA04').due_at, '2026-10-15T16:00:00.000Z');
  b = booking(s);
  r = scf._scfRecordStripped(s, { actor: ACTOR, command_id: 'STRIP-1', booking_id: b.id, strip_actual_at: '2026-10-15', actual_cost_pence: 90000, invoice_reference: 'ACME-1', expected_version: b.version, at: '2026-10-15T17:30:00.000Z' });
  assert.equal(r.status, 'Stripped');
  assert.deepEqual(r.open_complaints, [c2.issue_id]);
  assert.equal(s.get('Issues', c2.issue_id).status, 'Open', 'actual strip never closes a complaint');
  assert.equal(booking(s).actual_cost_pence, 90000);
  assert.deepEqual(tasks(s, b.id), ['SCA01:Complete', 'SCA02:Complete', 'SCA03:Complete', 'SCA04:Complete']);
  assert.equal(scf._scfBookingView(s, b.id).next_action, 'Complete');
  assert.equal(s.tables.Acknowledgements.length, 2);
  assert.equal(s.tables.Outbox.length, 0);
});

test('SCF 07: strip cannot be planned, confirmed or recorded before authorisation; complaint categories validated', () => {
  const s = makeStore();
  const b = toErected(s);
  assert.throws(() => scf._scfPlanStrip(s, { actor: ACTOR, command_id: 'P', booking_id: b.id, strip_planned_at: '2026-10-20', expected_version: b.version, at: T0 }), /authorised before planning/);
  assert.throws(() => scf._scfConfirmStrip(s, { actor: ACTOR, command_id: 'C', booking_id: b.id, expected_version: b.version, at: T0 }), /planned before confirmation/);
  assert.throws(() => scf._scfRecordStripped(s, { actor: ACTOR, command_id: 'S', booking_id: b.id, strip_actual_at: '2026-10-20', expected_version: b.version, at: '2026-10-21T00:00:00.000Z' }), /authorised before recording/);
  assert.throws(() => scf._scfComplaint(s, { actor: ACTOR, command_id: 'X', booking_id: b.id, category: 'Rude', description: 'x', at: T0 }), /category must be one of/);
  assert.throws(() => scf._scfComplaint(s, { actor: ACTOR, command_id: 'Y', booking_id: b.id, category: 'Access', description: '', at: T0 }), /description required/);
});

test('SCF 08: moving dates creates a new revision that needs re-acknowledgement, new SCA01 instance and new instruction draft', () => {
  const s = makeStore(); request(s);
  let b = booking(s);
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: T0 });
  b = booking(s);
  assert.throws(() => scf._scfChangeDates(s, { actor: ACTOR, command_id: 'MV-0', booking_id: b.id, erect_planned_at: '2026-10-12', expected_version: b.version, at: T0 }), /reason required/);
  const r = scf._scfChangeDates(s, { actor: ACTOR, command_id: 'MV-1', booking_id: b.id, erect_planned_at: '2026-10-12', reason: 'Roof moved a week', expected_version: b.version, at: '2026-09-30T10:00:00.000Z' });
  assert.equal(r.revision, 2);
  assert.equal(r.status, 'Requested', 'confirmed booking returns to Requested until re-acknowledged');
  assert.equal(r.acknowledgement_required, true);
  b = booking(s);
  assert.equal(b.confirmed_revision, 1);
  assert.equal(b.erect_planned_at, '2026-10-12');
  assert.deepEqual(tasks(s, b.id), ['SCA01:Complete', 'SCA01:Open', 'SCA02:Open']);
  assert.equal(s.tables.Tasks.find(t => t.instance_key === 'SCA01-' + b.id + '-R2').due_at, '2026-10-05T08:00:00.000Z');
  assert.equal(s.get('Communications', 'COMM-SCF-' + b.id + '-ScaffoldInstruction-R2').revision, 2);
  const view = scf._scfBookingView(s, b.id);
  assert.equal(view.acknowledgement_required, true);
  assert.equal(view.communications.length, 2);
  /* Re-confirm revision 2. */
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-2', booking_id: b.id, expected_version: b.version, at: '2026-10-01T10:00:00.000Z' });
  b = booking(s);
  assert.equal(b.confirmed_revision, 2);
  assert.equal(s.tables.Acknowledgements.map(a => a.acknowledged_revision).join(','), '1,2');
  assert.equal(scf._scfBookingView(s, b.id).acknowledgement_required, false);
  /* Erected scaffold: erect date can no longer move; strip move needs authorisation. */
  scf._scfRecordErected(s, { actor: ACTOR, command_id: 'ERECT-1', booking_id: b.id, erect_actual_at: '2026-10-12', expected_version: b.version, at: '2026-10-12T15:00:00.000Z' });
  b = booking(s);
  assert.throws(() => scf._scfChangeDates(s, { actor: ACTOR, command_id: 'MV-2', booking_id: b.id, erect_planned_at: '2026-10-13', reason: 'x', expected_version: b.version, at: T0 }), /already erected/);
  assert.throws(() => scf._scfChangeDates(s, { actor: ACTOR, command_id: 'MV-3', booking_id: b.id, strip_planned_at: '2026-10-30', reason: 'x', expected_version: b.version, at: T0 }), /strip not yet authorised/);
});

test('SCF 09: cancel before erection cancels tasks and drafts a cancellation notice; erected scaffold cannot be cancelled', () => {
  const s = makeStore(); request(s);
  let b = booking(s);
  const r = scf._scfCancel(s, { actor: ACTOR, command_id: 'CAN-1', booking_id: b.id, reason: 'Customer postponed indefinitely', expected_version: b.version, at: T0 });
  assert.equal(r.status, 'Cancelled');
  assert.equal(r.cancelled_tasks.length, 1);
  assert.deepEqual(tasks(s, b.id), ['SCA01:Cancelled']);
  assert.equal(s.get('Communications', r.communication.communication_id).type, 'ScaffoldCancellation');
  assert.equal(scf._scfCancel(s, { actor: ACTOR, command_id: 'CAN-1', booking_id: b.id, reason: 'Customer postponed indefinitely', expected_version: 5, at: T0 }).replay, true);
  /* A new request after cancellation gets a distinct stable id. */
  const again = request(s, { command_id: 'REQ-2', expected_version: 2 });
  assert.equal(again.booking.id, 'SB-J-s09-ready-R2');
  const s2 = makeStore();
  b = toErected(s2);
  assert.throws(() => scf._scfCancel(s2, { actor: ACTOR, command_id: 'CAN-2', booking_id: b.id, reason: 'x', expected_version: b.version, at: T0 }), /arrange safe strip/);
});

test('SCF 10: chase creates Tanya tasks for missed planned erect/strip, once per revision', () => {
  const s = makeStore(); request(s);
  let b = booking(s);
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: T0 });
  let r = scf._scfChase(s, { actor: ACTOR, command_id: 'CHASE-1', at: '2026-10-05T18:00:00.000Z' });
  assert.equal(r.created.length, 0, 'not yet past the planned date');
  r = scf._scfChase(s, { actor: ACTOR, command_id: 'CHASE-2', at: '2026-10-06T08:00:00.000Z' });
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].code, 'SCA02');
  const chase = s.get('Tasks', r.created[0].task_id);
  assert.match(chase.title, /CHASE: erect planned 2026-10-05/);
  assert.equal(chase.owner_id, 'PERSON-tanya');
  assert.equal(scf._scfChase(s, { actor: ACTOR, command_id: 'CHASE-3', at: '2026-10-07T08:00:00.000Z' }).created.length, 0, 'idempotent');
  /* Strip chase. */
  b = booking(s);
  scf._scfRecordErected(s, { actor: ACTOR, command_id: 'ERECT-1', booking_id: b.id, erect_actual_at: '2026-10-06', expected_version: b.version, at: '2026-10-06T15:00:00.000Z' });
  s.update('Jobs', 'J-s09-ready', { customer_happy_at: '2026-10-09T10:00:00.000Z' });
  b = booking(s);
  scf._scfAuthoriseStrip(s, { actor: ACTOR, command_id: 'AUTH-1', booking_id: b.id, expected_version: b.version, at: '2026-10-10T10:00:00.000Z' });
  b = booking(s);
  scf._scfPlanStrip(s, { actor: ACTOR, command_id: 'PLAN-1', booking_id: b.id, strip_planned_at: '2026-10-15', expected_version: b.version, at: '2026-10-12T10:00:00.000Z' });
  assert.equal(scf._scfChase(s, { actor: ACTOR, command_id: 'CHASE-4', at: '2026-10-15T20:00:00.000Z' }).created.length, 0);
  r = scf._scfChase(s, { actor: ACTOR, command_id: 'CHASE-5', at: '2026-10-16T08:00:00.000Z' });
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].code, 'SCA04');
});

test('SCF 11: weekly list drafts one captured communication per company with SCA05 acknowledgement task, idempotent per week', () => {
  const s = makeStore(); request(s, { erect_planned_at: '2026-10-07', strip_forecast_at: '2026-10-21' });
  configureReal(s);
  s.insert('Jobs', { ...s09fx.buildJob(true, 'J-s09-two', 'SS-S09T-WO'), source_system: 'S05' });
  scf._scfRequest(s, { actor: ACTOR, command_id: 'REQ-2', job_id: 'J-s09-two', company_id: 'COMP-acme-scaffold', erect_planned_at: '2026-10-08', expected_version: 1, at: T0 });
  const r = scf._scfWeeklyList(s, { actor: ACTOR, command_id: 'WK-1', week_start: '2026-10-05', at: '2026-10-02T09:00:00.000Z' });
  assert.equal(r.week_start, '2026-10-05');
  assert.equal(r.lists.length, 2);
  const acme = r.lists.find(l => l.company_id === 'COMP-acme-scaffold');
  assert.equal(acme.items, 1);
  assert.equal(acme.unacknowledged, 1);
  const comm = s.get('Communications', acme.communication_id);
  assert.equal(comm.type, 'ScaffoldWeeklyList');
  assert.equal(comm.status, 'Draft');
  assert.equal(comm.covered_week_start, '2026-10-05');
  assert.equal(comm.job_id, null);
  assert.equal(JSON.parse(comm.body_snapshot).items[0].kind, 'Erect');
  assert.equal(JSON.parse(comm.recipients_snapshot)[0].email, 'pat@acme.example');
  const t = s.get('Tasks', acme.task.task_id);
  assert.equal(t.template_code, 'SCA05');
  assert.equal(t.due_at, '2026-10-02T11:00:00.000Z', 'Friday 2 Oct 12:00 London');
  assert.equal(t.job_id, null);
  const again = scf._scfWeeklyList(s, { actor: ACTOR, command_id: 'WK-2', week_start: '2026-10-06', at: '2026-10-02T10:00:00.000Z' });
  assert.equal(again.week_start, '2026-10-05', 'any day normalises to Monday');
  assert.ok(again.lists.every(l => l.created === false));
  assert.equal(s.tables.Communications.filter(c => c.type === 'ScaffoldWeeklyList').length, 2);
  /* Unauthorised strip forecasts never appear; authorised planned strips do. */
  assert.equal(scf._scfWeeklyList(s, { actor: ACTOR, command_id: 'WK-3', week_start: '2026-10-19', at: T0 }).lists.length, 0);
  assert.equal(s.tables.Outbox.length, 0);
});

test('SCF 12: planner rows (module and S11 planner) expose erect/strip activities with acknowledgement state', () => {
  const s = makeStore(); request(s);
  s.insert('WorkPackages', { id: 'WP-x', job_id: 'J-s09-ready', trade: 'Roof', required: true, planned_start: '2026-10-06', planned_end: '2026-10-07', actual_start: null, actual_end: null, status: 'Scheduled', need_by_date: null, completion_outcome: null, installer_confirmation_at: null, installer_confirmation_by: null, commissioning_required: true, sequence: 1, revision: 1, parent_package_id: null, created_at: T0, created_by: 't', updated_at: T0, updated_by: 't', version: 1, source_system: 'S11', commit_id: 't' });
  const rows = scf._scfPlannerRows(s, '2026-10-01', '2026-10-31');
  assert.deepEqual(rows.map(r => [r.kind, r.date, r.acknowledged, r.company]), [['Erect', '2026-10-05', false, 'DEV Scaffold Co'], ['StripForecast', '2026-10-20', false, 'DEV Scaffold Co']]);
  assert.equal(scf._scfPlannerRows(s, '2026-11-01', '2026-11-30').length, 0);
  s.insert('Settings', { id: 'SET-S11-tz', key: 'office.timezone', typed_value: 'Europe/London', scope: 'Global', version: 9, effective_from: '2026-01-01', changed_by: 't', reason: null, created_at: T0, commit_id: 't' });
  const planner = p.buildPlanner(s, '2026-10-05', 3);
  assert.equal(planner.rows.length, 0, 'no allocations in fixture');
  assert.deepEqual(planner.scaffold.map(r => r.kind + ':' + r.date), ['Erect:2026-10-05', 'StripForecast:2026-10-20']);
  assert.equal(planner.scaffold[0].acknowledged, false);
  const b = booking(s);
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: T0 });
  assert.equal(p.buildPlanner(s, '2026-10-05', 3).scaffold[0].acknowledged, true);
  /* Cancelled bookings disappear from planners. */
  const b2 = booking(s);
  scf._scfCancel(s, { actor: ACTOR, command_id: 'CAN-1', booking_id: b2.id, reason: 'x', expected_version: b2.version, at: T0 });
  assert.equal(p.buildPlanner(s, '2026-10-05', 3).scaffold.length, 0);
});

test('SCF 13: S11 Move Job scaffold activity still moves dates; the workflow then flags re-acknowledgement', () => {
  const s = makeStore(); request(s);
  let b = booking(s);
  scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: T0 });
  s.update('ReleaseModes', 'RM-FN01', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  s.update('Jobs', 'J-s09-ready', { release_scope: 'R1' });
  const job = s.get('Jobs', 'J-s09-ready');
  const mv = p.moveJobR1({ command_id: 'MJ-1', job_id: 'J-s09-ready', expected_version: job.version, actor: ACTOR, activities: ['Scaffold'], scaffold_erect: '2026-10-09', reason: 'Customer request', at: T0 }, s);
  assert.equal(mv.status, 'Moved');
  b = booking(s);
  assert.equal(b.erect_planned_at, '2026-10-09');
  assert.equal(b.revision, 2);
  assert.equal(b.confirmed_revision, 1);
  assert.equal(scf._scfBookingView(s, b.id).acknowledgement_required, true);
});

test('SCF 14: Sheet Date values and booleans are tolerated; read models are read-only', () => {
  const s = makeStore(); request(s);
  for (const b of s.tables.ScaffoldBookings) { b.erect_planned_at = new Date(b.erect_planned_at + 'T12:00:00Z'); b.strip_forecast_at = new Date(b.strip_forecast_at + 'T12:00:00Z'); }
  s.tables.Jobs[0].scaffold_required = 'TRUE';
  s.tables.Companies.find(c => c.id === 'COMP-scaffold-dev').active = 'TRUE';
  const before = copy(s.tables);
  const rows = scf._scfPlannerRows(s, '2026-10-01', '2026-10-31');
  assert.equal(rows[0].date, '2026-10-05');
  const view = scf._scfBookingView(s, 'SB-J-s09-ready');
  assert.equal(view.found, true);
  assert.equal(view.next_action, 'Send instruction; record scaffolder confirmation (SCA01)');
  scf._scfScaffolders(s);
  assert.deepEqual(s.tables, before);
  assert.equal(scf._scfBookingView(s, 'nope').found, false);
  const b = booking(s);
  const r = scf._scfConfirmErect(s, { actor: ACTOR, command_id: 'CONF-1', booking_id: b.id, expected_version: b.version, at: new Date(T0) });
  assert.equal(r.status, 'Confirmed');
  assert.equal(s.tables.Tasks.find(t => t.template_code === 'SCA02').due_at, '2026-10-05T16:00:00.000Z');
});

test('SCF 15: London day-end/day-start instants across BST and GMT; week start normalisation', () => {
  assert.equal(scf._scfLondonInstant('2026-07-01', '17:00'), '2026-07-01T16:00:00.000Z');
  assert.equal(scf._scfLondonInstant('2026-12-01', '17:00'), '2026-12-01T17:00:00.000Z');
  assert.equal(scf._scfLondonInstant('2026-12-01', '09:00'), '2026-12-01T09:00:00.000Z');
  assert.equal(scf._scfWeekStart('2026-09-13'), '2026-09-14', 'Sunday → next Monday');
  assert.equal(scf._scfWeekStart('2026-09-14'), '2026-09-14');
  assert.equal(scf._scfWeekStart('2026-09-17'), '2026-09-14');
});

test('SCF 16: seed carries spec task templates SCA01–SCA05 and the embedded seed matches', () => {
  const codes = seed.TaskTemplates.map(t => t.template_code);
  for (const c of ['SCA01', 'SCA02', 'SCA03', 'SCA04', 'SCA05']) assert.ok(codes.includes(c), c);
  const embedded = fs.readFileSync('apps-script/S02SeedData.js', 'utf8');
  assert.ok(embedded.includes('"template_code":"SCA05"'));
  assert.equal(seed.TaskTemplates.find(t => t.template_code === 'SCA03').trigger_event, 'Customer happy and strip authorised');
});

test('SCF 17: bundle — namespaced, parses with all bundles, no external APIs; S11 bundle carries scaffold headers', () => {
  const bundle = fs.readFileSync('apps-script/scaffold/ScaffoldWorkflow.js', 'utf8');
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('scaffold/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  new vm.Script(prior + '\n' + bundle);
  for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:SCF_|_scf|runScf|restoreScf)/);
  assert.doesNotMatch(bundle, /CalendarApp|UrlFetchApp|fetch\(|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet|https:\/\/|module\.exports|use strict/);
  for (const fn of ['runScfScaffolders', 'runScfPlannerRows', 'runScfBookingView', 'runScfConfigureScaffolder', 'runScfChase', 'runScfWeeklyList', 'runScfHappyPathTest', 'runScfEnableFn04ForSyntheticTest', 'restoreScfSafeState']) assert.match(bundle, new RegExp('function ' + fn + '\\('));
  const s11 = fs.readFileSync('apps-script/s11/S11Planner.js', 'utf8');
  assert.match(s11, /"ScaffoldBookings":\[/);
  assert.match(s11, /"Companies":\[/);
});

test('SCF 18: zero-arg cloud simulation — synthetic happy path on the header adapter, FN-04 restored, nothing sent', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/scaffold/ScaffoldWorkflow.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.SCF_HEADERS)) grids[n] = [Array.from(h)];
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(rowOf('ReleaseModes', { ...r, version: 1 }));
  for (const r of seed.Settings) grids.Settings.push(rowOf('Settings', { ...r, created_at: T0, commit_id: 'seed' }));
  for (const r of seed.TaskTemplates) grids.TaskTemplates.push(rowOf('TaskTemplates', { ...r, created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' }));
  grids.People.push(rowOf('People', { id: 'PERSON-tanya', email: 'tanya@test.example.invalid', display_name: 'Tanya', role: 'Office', active: true, created_at: T0, created_by: 't', updated_at: T0, updated_by: 't', version: 1, source_system: 't', commit_id: 't' }));
  let busy = false;
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); },
        setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); }
      };
    }
  }));
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => scf.SCF_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'tanya@test.example.invalid' }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  assert.equal(ctx.restoreScfSafeState().pass, true);
  assert.equal(ctx.runScfScaffolders().pass, true);
  assert.equal(ctx.runScfChase().pass, false, 'disabled FN-04 refuses mutations');
  const cfg = ctx.runScfConfigureScaffolder('COMP-acme-scaffold', 'Acme Scaffolding', 5, 'Pat', 'pat@acme.example', '');
  assert.equal(cfg.pass, true, JSON.stringify(cfg));
  const smoke = ctx.runScfHappyPathTest();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.deepEqual(JSON.parse(JSON.stringify(smoke.detail.statuses)), ['Requested', 'Confirmed', 'Erected', 'Blocked', 'StripAuthorised', 'StripPlanned', 'StripConfirmed', 'Stripped']);
  assert.equal(smoke.detail.external_calls, 0);
  const modeIdx = grids.ReleaseModes[0].indexOf('mode');
  assert.equal(grids.ReleaseModes.find(r => r[0] === 'RM-FN04')[modeIdx], 'Disabled', 'FN-04 restored');
  assert.equal(ctx.runScfBookingView(smoke.detail.booking_id).pass, true);
  const planner = ctx.runScfPlannerRows('2026-01-01', '2030-01-01');
  assert.equal(planner.pass, true);
  assert.ok(planner.detail.rows.length >= 1);
  const statusIdx = grids.Communications[0].indexOf('status');
  assert.ok(grids.Communications.slice(1).every(r => r[statusIdx] === 'Draft'), 'no communication left Draft status');
  assert.equal(grids.Outbox, undefined, 'scaffold bundle never touches Outbox');
});
