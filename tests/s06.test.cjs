const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const {
  evaluateReadyToBook, evaluateBookingGates, createTasksForJob, createPrebookingTasksForSold, processBookingGates,
  isStaffedDay, nextStaffedDay, fridayBefore
} = require('../s06/gates.js');

const {
  installBaseFixture, buildReadyJob, buildMissingDepositJob, buildUnpaidInterimJob, buildCustomer,
  runReadyBooking, runMissingDeposit, runUnpaidInterim,
  runReevaluationIdempotent, runDeterministicInstanceKey,
  runFridayBeforeCalculation, runUnrelatedRowsUntouched
} = require('../s06/fixture.js');


function stampPre01Invoice(store, jobId, now) {
  const id = 'IS-' + jobId + '-deposit';
  const existing = store.get('InvoiceStages', id);
  const row = {
    id, job_id: jobId, stage: 'deposit', amount_net_pence: 100000, vat_pence: 20000, gross_pence: 120000,
    due_date: null, status: 'Sent', xero_invoice_id: null, invoice_number: 'INV-' + jobId, xero_contact_id: null,
    reference: null, request_id: null, last_synced_at: null, source_status: null,
    sent_at: now || '2026-09-01T10:00:00.000Z', cancelled_at: null,
    created_at: now || '2026-09-01T09:00:00.000Z', created_by: 'test', updated_at: now || '2026-09-01T10:00:00.000Z',
    updated_by: 'test', version: existing ? Number(existing.version || 0) + 1 : 1, source_system: 'test', commit_id: id
  };
  if (existing) store.update('InvoiceStages', id, row);
  else store.insert('InvoiceStages', row);
}

/* Hardened PRE03: gate evidence is a Confirmed ManualBankChecks row reconciled to Jobs summary fields + deposit InvoiceStage. */
function stampPre03BankCheck(store, jobId) {
  const job = store.get('Jobs', jobId);
  const stage = store.get('InvoiceStages', 'IS-' + jobId + '-deposit');
  assert.ok(job && stage, 'stampPre03BankCheck requires job + deposit stage');
  store.update('InvoiceStages', stage.id, { status: 'Confirmed', reference: job.deposit_bank_reference });
  const id = 'MBC-' + jobId + '-deposit';
  if (!store.get('ManualBankChecks', id)) {
    store.insert('ManualBankChecks', {
      id, job_id: jobId, stage: 'deposit', checked_at: job.deposit_bank_confirmed_at, checked_by: job.deposit_bank_confirmed_by,
      amount_pence: stage.gross_pence, outcome: 'Confirmed', evidence_reference: job.deposit_bank_reference,
      created_at: job.deposit_bank_confirmed_at, commit_id: id
    });
  }
}

function makeStore() {
  const data = {};
  const tables = ['Jobs', 'Tasks', 'TaskDependencies', 'TaskEvents', 'AuditEvents', 'Customers', 'TaskTemplates', 'People', 'PersonRoles', 'ReleaseModes', 'Intake', 'InvoiceStages', 'ManualBankChecks'];
  for (const t of tables) data[t] = [];

  data.ReleaseModes = [
    { id: 'RM-FN01', function_id: 'FN-01', function_name: 'Office core', mode: 'Automated', mode_record_basis: 'test', authorised_job_scope: 'Pilot', target_release: 'R1', planned_target_mode: 'Automated', current_system: 'test', fallback: 'test', external_ids_protected_reference: null, activation_time: null, approved_version: null, ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'test', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'test', version: 1, commit_id: 'test' }
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

/* --- Test 1: Ready booking evaluates correctly --- */
test('S06: ready booking evaluates correctly', () => {
  const store = makeStore();
  const r = runReadyBooking(store);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.gates_ready, true);
  assert.equal(r.stage, 'Booked');
  assert.ok(r.tasks_created > 0);
});

/* --- Test 2: Missing deposit blocks --- */
test('S06: missing deposit blocks booking', () => {
  const store = makeStore();
  const r = runMissingDeposit(store);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.blocked, true);
  assert.ok(r.deposit_gate && !r.deposit_gate.pass);
});

/* --- Test 3: Unpaid interim creates Tanya chase task --- */
test('S06: unpaid interim creates Tanya chase task, does not auto-block install', () => {
  const store = makeStore();
  const r = runUnpaidInterim(store);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.chase_task_created, true);
  assert.equal(r.chase_owner, 'PERSON-tanya');
  assert.equal(r.install_not_blocked_by_payment, true);
});

/* --- Test 4: Re-evaluation creates no duplicate tasks --- */
test('S06: re-evaluation idempotent — no duplicate tasks', () => {
  const store = makeStore();
  const r = runReevaluationIdempotent(store);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.second_created, 0);
  assert.ok(r.first_created > 0);
});

test('S06: PRE03 uses Director Ben and Director Dan even when Lenny is first active Admin', () => {
  const store = makeStore();
  installBaseFixture(store);
  const job = buildReadyJob();
  store.update('People', 'PERSON-ben', { role: 'Director' });
  store.insert('People', { id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', display_name: 'Lenny DEV', role: 'Admin', active: true });
  store.insert('PersonRoles', { id: 'PROLE-000-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true });
  createPrebookingTasksForSold(job, store, { now: '2026-09-01T09:00:00.000Z' });
  const task = store.list('Tasks').find(t => t.job_id === job.id && t.template_code === 'PRE03');
  assert.equal(task.owner_id, 'PERSON-ben');
  assert.equal(task.backup_id, 'PERSON-dan');
  assert.equal(store.get('People', 'PERSON-ben').role, 'Director');
  assert.equal(store.get('People', 'PERSON-dan').role, 'Director');
  assert.equal(store.list('PersonRoles').some(r => r.person_id === 'PERSON-ben' && r.role === 'Admin' && r.active === true), false);
  assert.equal(store.list('PersonRoles').some(r => r.person_id === 'PERSON-dan' && r.role === 'Admin' && r.active === true), false);
  for (const code of ['PRE01', 'PRE02', 'PRE04']) {
    assert.equal(store.list('Tasks').find(t => t.job_id === job.id && t.template_code === code).owner_id, 'PERSON-tanya');
  }
});

test('S06: PRE03 fails visibly when configured Ben is inactive instead of choosing another Admin', () => {
  const store = makeStore();
  installBaseFixture(store);
  const job = buildReadyJob();
  store.update('People', 'PERSON-ben', { active: false });
  store.insert('People', { id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', display_name: 'Lenny DEV', role: 'Admin', active: true });
  store.insert('PersonRoles', { id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true });
  assert.throws(() => createPrebookingTasksForSold(job, store), /S06_CONFIG: active PERSON-ben required for PRE03/);
  assert.equal(store.list('Tasks').some(t => t.template_code === 'PRE03' && t.owner_id === 'PERSON-lenny-dev'), false);
});

test('S06: PRE03 fails visibly when Ben has no active Admin, Manager or Director role', () => {
  const store = makeStore();
  installBaseFixture(store);
  const job = buildReadyJob();
  store.update('People', 'PERSON-ben', { role: 'Office' });
  store.update('PersonRoles', 'PROLE-ben-director', { active: false });
  store.insert('People', { id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', display_name: 'Lenny DEV', role: 'Admin', active: true });
  store.insert('PersonRoles', { id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true });
  assert.throws(() => createPrebookingTasksForSold(job, store), /S06_CONFIG: PERSON-ben must have an active Admin, Manager or Director role for PRE03/);
  assert.equal(store.list('Tasks').some(t => t.template_code === 'PRE03'), false);
});

test('S06: PRE03 continues with null backup when Dan has no active Admin, Manager or Director role', () => {
  const store = makeStore();
  installBaseFixture(store);
  const job = buildReadyJob();
  store.update('People', 'PERSON-dan', { role: 'Office', active: true });
  store.update('PersonRoles', 'PROLE-dan-director', { active: false });
  createPrebookingTasksForSold(job, store, { now: '2026-09-01T09:00:00.000Z' });
  const task = store.list('Tasks').find(t => t.job_id === job.id && t.template_code === 'PRE03');
  assert.equal(task.owner_id, 'PERSON-ben');
  assert.equal(task.backup_id, null);
});

/* --- Test 5: Deterministic instance_key --- */
test('S06: deterministic instance_key on created tasks', () => {
  const store = makeStore();
  const r = runDeterministicInstanceKey(store);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.bkg01_key, 'BKG01-J-s06-ready-ROOT-nodue');
});

/* --- Test 6: Correct internal Jobs.id linkage --- */
test('S06: tasks link to correct internal Jobs.id', () => {
  const store = makeStore();
  runReadyBooking(store);
  const tasks = store.list('Tasks').filter(t => t.job_id === 'J-s06-ready');
  assert.ok(tasks.length > 0);
  for (const t of tasks) {
    assert.equal(t.job_id, 'J-s06-ready');
    assert.equal(t.related_entity_type, 'Jobs');
    assert.equal(t.related_entity_id, 'J-s06-ready');
  }
});

/* --- Test 7: Friday-before-install calculation --- */
test('S06: Friday-before-install calculation correct', () => {
  const r = runFridayBeforeCalculation();
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.ok(r.result.startsWith('2026-10-09'));
});

/* --- Test 8: isStaffedDay respects weekends --- */
test('S06: isStaffedDay rejects weekends', () => {
  assert.equal(isStaffedDay('2026-09-05', []), false); // Saturday
  assert.equal(isStaffedDay('2026-09-06', []), false); // Sunday
  assert.equal(isStaffedDay('2026-09-07', []), true);  // Monday
  assert.equal(isStaffedDay('2026-09-11', []), true);  // Friday
});

/* --- Test 9: isStaffedDay respects holidays --- */
test('S06: isStaffedDay respects configured holidays', () => {
  const holidays = [{ date: '2026-09-07' }]; // Monday is a holiday
  assert.equal(isStaffedDay('2026-09-07', holidays), false);
  assert.equal(isStaffedDay('2026-09-08', holidays), true); // Tuesday
});

/* --- Test 10: nextStaffedDay skips weekends --- */
test('S06: nextStaffedDay skips weekends', () => {
  const fri = nextStaffedDay('2026-09-04T00:00:00.000Z', []); // Friday → next Monday
  assert.ok(fri.startsWith('2026-09-07'));
});

/* --- Test 11: Unrelated rows untouched --- */
test('S06: unrelated existing rows untouched', () => {
  const store = makeStore();
  const r = runUnrelatedRowsUntouched(store);
  assert.equal(r.pass, true, JSON.stringify(r));
});

/* --- Test 12: Gate evaluation on missing job --- */
test('S06: processBookingGates returns error for missing job', () => {
  const store = makeStore();
  const result = processBookingGates('J-nonexistent', store);
  assert.equal(result.error, 'JOB_NOT_FOUND');
});

test('S06: explicit ReadyToBook requires task and field evidence and records one audit transition', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob(); job.workflow_stage='Prebooking'; job.booking_submission_id=null;
  store.insert('Jobs',job); store.insert('Customers',buildCustomer(job.customer_id,'Alice','Ready'));
  createPrebookingTasksForSold(job,store,{now:'2026-09-01T09:00:00.000Z'});
  ['PRE01','PRE02','PRE03','PRE04'].forEach(code => { const t=store.list('Tasks').find(x=>x.job_id===job.id&&x.template_code===code); store.update('Tasks',t.id,{status:'Complete',completed_at:'2026-09-01T10:00:00.000Z',completed_by:t.owner_id,completion_note:'Verified',evidence_id:'EVID-'+code,version:2}); });
  stampPre01Invoice(store, job.id);
  assert.equal(evaluateReadyToBook(store.get('Jobs',job.id),store).ready,false, 'PRE03 Complete without ManualBankChecks must not be ready');
  stampPre03BankCheck(store, job.id);
  assert.equal(evaluateReadyToBook(store.get('Jobs',job.id),store).ready,true);
  const first=processBookingGates(job.id,store,{actor:'PERSON-tanya',command_id:'READY-1',now:'2026-09-01T11:00:00.000Z'});
  assert.equal(store.get('Jobs',job.id).workflow_stage,'ReadyToBook');
  assert.equal(first.readiness.stage_advanced,true);
  assert.equal(store.list('AuditEvents').filter(a=>a.action==='WorkflowStage:ReadyToBook').length,1);
  const version=store.get('Jobs',job.id).version;
  processBookingGates(job.id,store,{actor:'PERSON-tanya',command_id:'READY-RETRY',now:'2026-09-01T12:00:00.000Z'});
  assert.equal(store.get('Jobs',job.id).version,version);
  assert.equal(store.list('AuditEvents').filter(a=>a.action==='WorkflowStage:ReadyToBook').length,1);
});

test('S06: missing contract/PRE04/deposit evidence cannot reach ReadyToBook', () => {
  const store = makeStore(); installBaseFixture(store);
  const job=buildReadyJob(); job.workflow_stage='Prebooking'; job.booking_submission_id=null; job.contract_evidence_id=null; job.deposit_bank_reference=null;
  store.insert('Jobs',job); store.insert('Customers',buildCustomer(job.customer_id,'Alice','Blocked'));
  createPrebookingTasksForSold(job,store);
  const result=processBookingGates(job.id,store,{actor:'PERSON-tanya',command_id:'READY-BLOCKED'});
  assert.equal(result.readiness.ready,false);
  assert.equal(store.get('Jobs',job.id).workflow_stage,'Prebooking');
  assert.equal(store.list('AuditEvents').length,0);
});

test('S06: PRE01-PRE03 complete with PRE04 open stays Prebooking', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob(); job.workflow_stage = 'Prebooking'; job.booking_submission_id = null;
  store.insert('Jobs', job); store.insert('Customers', buildCustomer(job.customer_id, 'Alice', 'Pending'));
  createPrebookingTasksForSold(job, store);
  ['PRE01', 'PRE02', 'PRE03'].forEach(code => {
    const task = store.list('Tasks').find(t => t.job_id === job.id && t.template_code === code);
    store.update('Tasks', task.id, { status: 'Complete', completed_at: '2026-09-01T10:00:00.000Z', completed_by: task.owner_id, completion_note: 'Verified', evidence_id: 'EV-' + code, version: 2 });
  });
  stampPre01Invoice(store, job.id);
  const result = processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'PRE04-OPEN' });
  assert.equal(result.readiness.ready, false);
  assert.ok(result.readiness.gates.some(g => g.name === 'PRE04_satisfied' && !g.pass));
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'Prebooking');
});

test('S06: field gates cannot bypass outstanding mandatory PRE/BKG tasks', () => {
  const store=makeStore(); installBaseFixture(store);
  const job=buildReadyJob(); store.insert('Jobs',job); store.insert('Customers',buildCustomer(job.customer_id,'Alice','Blocked'));
  const result=processBookingGates(job.id,store);
  assert.equal(result.gates.ready,false);
  assert.equal(store.get('Jobs',job.id).workflow_stage,'BookingInProgress');
  assert.ok(result.gates.gates.some(g=>g.name==='task_BKG01'&&!g.pass));
});

test('S06: ReadyToBook requires PRE01/PRE02/PRE03/PRE04 and records actor/time/version once', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob();
  job.workflow_stage = 'Prebooking';
  job.booking_submission_id = null;
  job.version = 1;
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Alice', 'Ready'));
  createPrebookingTasksForSold(job, store, { now: '2026-09-01T09:00:00.000Z' });

  assert.equal(evaluateReadyToBook(store.get('Jobs', job.id), store).ready, false);

  const openPre03 = store.list('Tasks').find(t => t.template_code === 'PRE03');
  assert.equal(openPre03.status, 'Open');
  processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'RTB-PRE03-OPEN', now: '2026-09-01T10:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'Prebooking');

  ['PRE01', 'PRE02', 'PRE03', 'PRE04'].forEach(code => {
    const t = store.list('Tasks').find(x => x.job_id === job.id && x.template_code === code);
    store.update('Tasks', t.id, {
      status: 'Complete', completed_at: '2026-09-01T10:30:00.000Z', completed_by: t.owner_id,
      completion_note: 'Verified', evidence_id: 'EVID-' + code, version: 2
    });
  });
  stampPre01Invoice(store, job.id);
  assert.equal(evaluateReadyToBook(store.get('Jobs', job.id), store).gates.find(g => g.name === 'PRE03_satisfied').pass, false);
  assert.equal(evaluateReadyToBook(store.get('Jobs', job.id), store).gates.find(g => g.name === 'deposit_confirmation_evidence').pass, false);
  stampPre03BankCheck(store, job.id);
  assert.equal(evaluateReadyToBook(store.get('Jobs', job.id), store).ready, true);

  const advanced = processBookingGates(job.id, store, {
    actor: 'PERSON-tanya', command_id: 'RTB-OK', now: '2026-09-01T11:00:00.000Z'
  });
  const after = store.get('Jobs', job.id);
  assert.equal(after.workflow_stage, 'ReadyToBook');
  assert.equal(after.version, 2);
  assert.equal(after.updated_by, 'PERSON-tanya');
  assert.equal(after.updated_at, '2026-09-01T11:00:00.000Z');
  assert.equal(advanced.readiness.stage_advanced, true);
  const audits = store.list('AuditEvents').filter(a => a.action === 'WorkflowStage:ReadyToBook');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].initiating_actor, 'PERSON-tanya');
  assert.equal(audits[0].timestamp, '2026-09-01T11:00:00.000Z');

  processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'RTB-REPLAY', now: '2026-09-01T12:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).version, 2);
  assert.equal(store.list('AuditEvents').filter(a => a.action === 'WorkflowStage:ReadyToBook').length, 1);
});

test('S06: signed contract evidence and customer/value verification are required for ReadyToBook', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob();
  job.workflow_stage = 'Prebooking';
  job.booking_submission_id = null;
  job.contract_status = 'Sent';
  job.contract_evidence_id = null;
  job.customer_details_verified_at = null;
  job.customer_details_verified_by = null;
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Alice', 'Evidence'));
  createPrebookingTasksForSold(job, store);
  ['PRE02', 'PRE03', 'PRE04'].forEach(code => {
    const t = store.list('Tasks').find(x => x.job_id === job.id && x.template_code === code);
    store.update('Tasks', t.id, { status: 'Complete', completion_note: 'note', evidence_id: 'E-' + code, version: 2 });
  });
  const blocked = evaluateReadyToBook(store.get('Jobs', job.id), store);
  assert.equal(blocked.ready, false);
  assert.ok(blocked.gates.some(g => g.name === 'signed_contract_evidence' && !g.pass));
  assert.ok(blocked.gates.some(g => g.name === 'customer_value_verified' && !g.pass));
  processBookingGates(job.id, store);
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'Prebooking');
});

test('S06: finance route ReadyToBook requires PRE05 evidence and suppresses PRE03', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob();
  job.id = 'J-s06-finance';
  job.job_id = 'SS-S06F-INAN';
  job.customer_id = 'CUST-s06-finance';
  job.workflow_stage = 'Prebooking';
  job.booking_submission_id = null;
  job.finance_route = 'Phoenix';
  job.deposit_bank_confirmed_at = null;
  job.deposit_bank_confirmed_by = null;
  job.deposit_bank_reference = null;
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Fin', 'Ance'));
  const created = createPrebookingTasksForSold(job, store);
  assert.ok(created.created.some(t => t.template === 'PRE05'));
  assert.ok(!created.created.some(t => t.template === 'PRE01' || t.template === 'PRE03'));
  assert.equal(evaluateReadyToBook(store.get('Jobs', job.id), store).ready, false);

  ['PRE02', 'PRE04', 'PRE05'].forEach(code => {
    const t = store.list('Tasks').find(x => x.job_id === job.id && x.template_code === code);
    store.update('Tasks', t.id, {
      status: 'Complete', completed_at: '2026-09-01T10:00:00.000Z', completed_by: t.owner_id,
      completion_note: 'Finance checked', evidence_id: 'EVID-' + code, version: 2
    });
  });
  assert.equal(evaluateReadyToBook(store.get('Jobs', job.id), store).ready, true);
  processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'RTB-FIN', now: '2026-09-01T11:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'ReadyToBook');
});

test('S06: early Booking link stays Prebooking until ReadyToBook then advances one stage at a time', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob();
  job.workflow_stage = 'Prebooking';
  job.booking_submission_id = 'S06-booking-early';
  job.version = 1;
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Alice', 'Early'));
  createPrebookingTasksForSold(job, store);

  // Booking linked but prebooking incomplete → stay Prebooking (never jump to Booked).
  processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'EARLY-1', now: '2026-09-01T09:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'Prebooking');
  assert.ok(store.list('Tasks').some(t => t.template_code === 'BKG01'));
  assert.ok(!store.list('Tasks').some(t => t.template_code === 'BKG04'));

  ['PRE01', 'PRE02', 'PRE03', 'PRE04'].forEach(code => {
    const t = store.list('Tasks').find(x => x.job_id === job.id && x.template_code === code);
    store.update('Tasks', t.id, {
      status: 'Complete', completed_at: '2026-09-01T10:00:00.000Z', completed_by: t.owner_id,
      completion_note: 'Verified', evidence_id: 'EVID-' + code, version: 2
    });
  });
  stampPre01Invoice(store, job.id);
  stampPre03BankCheck(store, job.id);
  processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'EARLY-2', now: '2026-09-01T11:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'ReadyToBook');

  processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'EARLY-3', now: '2026-09-01T12:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'BookingInProgress');
  assert.ok(!store.list('Tasks').some(t => t.template_code === 'BKG04'));
});

test('S06: Booked denied for open/blocked mandatory tasks; BKG04/BKG05 never block', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob();
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Alice', 'Gate'));
  createPrebookingTasksForSold(job, store);
  processBookingGates(job.id, store);
  const codes = ['PRE01', 'PRE02', 'PRE03', 'PRE04', 'BKG01', 'BKG02', 'BKG03'];
  codes.forEach(code => {
    const t = store.list('Tasks').find(x => x.job_id === job.id && x.template_code === code);
    assert.ok(t, 'missing task ' + code);
    store.update('Tasks', t.id, {
      status: 'Complete', completed_at: '2026-09-01T10:00:00.000Z', completed_by: t.owner_id,
      completion_note: 'Verified', evidence_id: 'EVID-' + code, version: 2
    });
  });
  stampPre01Invoice(store, job.id);
  stampPre03BankCheck(store, job.id);
  const bkg02 = store.list('Tasks').find(t => t.job_id === job.id && t.template_code === 'BKG02');
  store.update('Tasks', bkg02.id, { status: 'Blocked', blocking_reason: 'Awaiting survey', version: 3 });
  let result = processBookingGates(job.id, store);
  assert.equal(result.gates.ready, false);
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'BookingInProgress');
  assert.ok(result.gates.gates.some(g => g.name === 'task_BKG02' && !g.pass));

  store.update('Tasks', bkg02.id, { status: 'Open', blocking_reason: null, version: 4 });
  result = processBookingGates(job.id, store);
  assert.equal(result.gates.ready, false);
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'BookingInProgress');

  store.update('Tasks', bkg02.id, {
    status: 'Complete', completed_at: '2026-09-01T11:00:00.000Z', completed_by: bkg02.owner_id,
    completion_note: 'Booked', evidence_id: 'EVID-BKG02', version: 5
  });
  // Spurious open BKG04/BKG05 must not block Booked (they are post-Booked).
  store.insert('Tasks', {
    id: 'TASK-fake-bkg04', job_id: job.id, template_code: 'BKG04',
    instance_key: 'BKG04-' + job.id + '-ROOT-nodue', status: 'Open', version: 1
  });
  store.insert('Tasks', {
    id: 'TASK-fake-bkg05', job_id: job.id, template_code: 'BKG05',
    instance_key: 'BKG05-' + job.id + '-ROOT-nodue', status: 'Open', version: 1
  });
  result = processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'BOOK-OK', now: '2026-09-01T12:00:00.000Z' });
  assert.equal(result.gates.ready, true);
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'Booked');
  assert.equal(store.get('Jobs', job.id).booking_approved_by, 'PERSON-tanya');
  assert.ok(!result.gates.gates.some(g => g.name === 'task_BKG04' || g.name === 'task_BKG05'));
});

test('S06: non-applicable PRE01/PRE03 do not block finance Booked; post-Booked BKG04/BKG05 created once', () => {
  const store = makeStore(); installBaseFixture(store);
  const job = buildReadyJob();
  job.id = 'J-s06-finbook';
  job.job_id = 'SS-S06F-BOOK';
  job.customer_id = 'CUST-s06-finbook';
  job.finance_route = 'Phoenix';
  job.deposit_bank_confirmed_at = null;
  job.deposit_bank_confirmed_by = null;
  job.deposit_bank_reference = null;
  job.workflow_stage = 'BookingInProgress';
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Fin', 'Book'));
  createPrebookingTasksForSold(job, store);
  processBookingGates(job.id, store);
  assert.ok(!store.list('Tasks').some(t => t.job_id === job.id && (t.template_code === 'PRE01' || t.template_code === 'PRE03')));
  ['PRE02', 'PRE04', 'PRE05', 'BKG01', 'BKG02', 'BKG03'].forEach(code => {
    const t = store.list('Tasks').find(x => x.job_id === job.id && x.template_code === code);
    assert.ok(t, 'missing task ' + code);
    store.update('Tasks', t.id, {
      status: 'Complete', completed_at: '2026-09-01T10:00:00.000Z', completed_by: t.owner_id,
      completion_note: 'Verified', evidence_id: 'EVID-' + code, version: 2
    });
  });
  const first = processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'FIN-BOOK', now: '2026-09-01T12:00:00.000Z' });
  assert.equal(store.get('Jobs', job.id).workflow_stage, 'Booked');
  assert.ok(first.tasks.created.some(t => t.template === 'BKG04'));
  assert.ok(first.tasks.created.some(t => t.template === 'BKG05'));
  const second = processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'FIN-BOOK-2', now: '2026-09-01T13:00:00.000Z' });
  assert.equal(second.tasks.created.length, 0);
  assert.equal(store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'BKG04').length, 1);
  assert.equal(store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'BKG05').length, 1);
});

/* --- Test 13: Completed tasks not recreated --- */
test('S06: completed tasks not recreated on re-evaluation', () => {
  const store = makeStore();
  installBaseFixture(store);
  const job = buildReadyJob();
  const cust = buildCustomer('CUST-s06-ready', 'Alice', 'Ready');
  store.insert('Jobs', job);
  store.insert('Customers', cust);

  processBookingGates(job.id, store);
  const tasks = store.list('Tasks').filter(t => t.job_id === job.id);
  // Complete one task
  const bkg01 = tasks.find(t => t.template_code === 'BKG01');
  store.update('Tasks', bkg01.id, { status: 'Complete', completed_at: '2026-09-01T00:00:00.000Z' });

  const count = store.list('Tasks').length;
  processBookingGates(job.id, store);
  // No new BKG01 should be created
  const bkg01Tasks = store.list('Tasks').filter(t => t.template_code === 'BKG01' && t.job_id === job.id);
  assert.equal(bkg01Tasks.length, 1);
  assert.equal(bkg01Tasks[0].status, 'Complete');
});

test('S06: PRE04 template is ensured and BOOKING_GATES idempotently backfills a missing PRE04', () => {
  const store = makeStore();
  installBaseFixture(store);
  const job = Object.assign({}, buildReadyJob(), {
    id: 'J-s06-pre04-miss',
    job_id: 'SS-S06P-MISS',
    customer_id: 'CUST-s06-miss',
    sold_submission_id: 'S06-sold-miss',
    booking_submission_id: null,
    workflow_stage: 'Prebooking'
  });
  store.insert('Jobs', job);
  store.insert('Customers', buildCustomer(job.customer_id, 'Mia', 'Miss'));
  store.update('TaskTemplates', 'TPL-PRE04', { active: false });
  assert.equal(store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'PRE04').length, 0);
  const first = createTasksForJob(job, { ready: false }, store);
  assert.ok(first.created.some(c => c.template === 'PRE04'));
  assert.ok(store.list('TaskTemplates').some(t => t.template_code === 'PRE04' && t.active !== false));
  const second = createTasksForJob(job, { ready: false }, store);
  assert.ok(second.skipped.some(s => s.template === 'PRE04'));
  assert.equal(store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'PRE04').length, 1);
});

/* --- VM smoke test --- */
test('S06: S06Gates.js entry points run via VM', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function() { return ''; });
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) { r[modeHdrs.indexOf(k)] = vals[k]; } return r; }

  const grids = {
    Jobs: [['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id']],
    Tasks: [['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    Customers: [['id','first_name','last_name','address_line1','address_line2','town','postcode','email','phone','alternate_contact','contact_notes','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id']],
    TaskTemplates: [['id','template_code','title','group','default_owner_role','trigger_event','due_rule','evidence_required','active','template_version','created_at','created_by','updated_at','updated_by','version','commit_id']],
    AuditEvents: [['id','entity_type','entity_id','action','before_json','after_json','initiating_actor','executing_service','timestamp','correlation_id','reason','commit_id','created_at']],
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN01',function_id:'FN-01',function_name:'Office',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R1',version:1})]
  };

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

  vm.runInContext(fs.readFileSync('apps-script/s06/S06Gates.js', 'utf8'), ctx);

  var dr = ctx.runS06FixtureDryRun();
  assert.equal(dr.sheet_id, DEV_SHEET_ID);

  var ap = ctx.runS06FixtureApply();
  assert.equal(ap.applied, true);
  assert.equal(ap.templates, 11);

  var hp = ctx.runS06HappyPathTest();
  assert.equal(hp.pass, true, JSON.stringify(hp));

  var ss = ctx.restoreS06SafeState();
  assert.equal(ss.pass, true);
});

test('S06: PRE03 owner is Ben by canonical identity whatever the order of Admin rows; Dan stays backup; both creators and replays never duplicate or reassign', () => {
  const g = require('../s06/gates.js');
  assert.deepEqual(JSON.parse(JSON.stringify(g.S06_PRE03_RESPONSIBILITY)), { template_code: 'PRE03', owner_person_id: 'PERSON-ben', backup_person_id: 'PERSON-dan', eligible_roles: ['Admin', 'Manager', 'Director'] });
  for (const lennyFirst of [true, false]) {
    const label = lennyFirst ? 'Lenny Admin row first' : 'Ben Admin row first';
    const store = makeStore();
    const addLenny = () => {
      store.insert('People', { id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', display_name: 'Lenny DEV', role: 'Admin', active: true });
      store.insert('PersonRoles', { id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true });
    };
    if (lennyFirst) addLenny();
    installBaseFixture(store);
    // Live seed shape: Ben is an Admin (not Director), so Ben and Lenny are both Admin.
    store.update('People', 'PERSON-ben', { role: 'Admin' });
    store.update('PersonRoles', 'PROLE-ben-director', { active: false });
    store.insert('PersonRoles', { id: 'PROLE-ben-admin', person_id: 'PERSON-ben', role: 'Admin', active: true });
    if (!lennyFirst) addLenny();
    assert.equal(g.resolvePersonByRole(store, 'Admin'), lennyFirst ? 'PERSON-lenny-dev' : 'PERSON-ben', label + ': generic Admin resolution depends on row order (the old bug)');

    const job = buildReadyJob();
    job.workflow_stage = 'Prebooking';
    job.booking_submission_id = null;
    store.insert('Jobs', job);
    store.insert('Customers', buildCustomer(job.customer_id, 'Alice', 'Owner'));
    const pre03s = () => store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'PRE03');

    g.createPrebookingTasksForSold(store.get('Jobs', job.id), store, { now: '2026-09-14T07:50:11.000Z' });
    assert.equal(pre03s().length, 1, label);
    const created = pre03s()[0];
    assert.deepEqual([created.owner_id, created.backup_id, created.title], ['PERSON-ben', 'PERSON-dan', 'Confirm bank deposit'], label);

    // Replays through both creators and gate re-evaluation: one task, same owner, same version.
    g.createPrebookingTasksForSold(store.get('Jobs', job.id), store, { now: '2026-09-14T09:00:00.000Z' });
    g.createTasksForJob(store.get('Jobs', job.id), { ready: false, gates: [] }, store, { now: '2026-09-14T09:00:00.000Z' });
    g.processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'OWNER-REPLAY-' + lennyFirst, now: '2026-09-14T09:00:00.000Z' });
    assert.equal(pre03s().length, 1, label + ': no duplicate PRE03');
    assert.deepEqual([pre03s()[0].id, pre03s()[0].owner_id, pre03s()[0].backup_id, pre03s()[0].version], [created.id, 'PERSON-ben', 'PERSON-dan', created.version], label);

    // The reconciliation creator on a job with no PRE03 yet also uses the canonical owner.
    const job2 = Object.assign(buildReadyJob(), { id: 'J-s06-owner-2', job_id: 'SS-S06O-WNR2', customer_id: 'CUST-s06-owner-2', sold_submission_id: 'S06-sold-owner-2', booking_submission_id: null, workflow_stage: 'Prebooking' });
    store.insert('Jobs', job2);
    g.createTasksForJob(job2, { ready: false, gates: [] }, store, { now: '2026-09-14T09:30:00.000Z' });
    const pre03Job2 = store.list('Tasks').filter(t => t.job_id === job2.id && t.template_code === 'PRE03');
    assert.equal(pre03Job2.length, 1, label);
    assert.deepEqual([pre03Job2[0].owner_id, pre03Job2[0].backup_id], ['PERSON-ben', 'PERSON-dan'], label);

    // An existing wrongly-owned PRE03 is never silently changed by regeneration: it needs the explicit repair.
    store.update('Tasks', created.id, { owner_id: 'PERSON-lenny-dev' });
    g.createPrebookingTasksForSold(store.get('Jobs', job.id), store, { now: '2026-09-14T10:00:00.000Z' });
    g.processBookingGates(job.id, store, { actor: 'PERSON-tanya', command_id: 'OWNER-REGEN-' + lennyFirst, now: '2026-09-14T10:00:00.000Z' });
    assert.equal(pre03s().length, 1, label);
    assert.equal(pre03s()[0].owner_id, 'PERSON-lenny-dev', label);
  }

  // Manager and Director also qualify; an ineligible Ben fails loudly and never falls back to another Admin.
  const store = makeStore();
  installBaseFixture(store);
  store.insert('People', { id: 'PERSON-lenny-dev', email: 'lenny@simplesolarltd.co.uk', display_name: 'Lenny DEV', role: 'Admin', active: true });
  store.insert('PersonRoles', { id: 'PROLE-lenny-admin', person_id: 'PERSON-lenny-dev', role: 'Admin', active: true });
  store.update('People', 'PERSON-ben', { role: 'Office' });
  store.update('PersonRoles', 'PROLE-ben-director', { active: false });
  store.insert('PersonRoles', { id: 'PROLE-ben-manager', person_id: 'PERSON-ben', role: 'Manager', active: true });
  assert.equal(g.resolveBankConfirmationOwner(store), 'PERSON-ben');
  store.update('PersonRoles', 'PROLE-ben-manager', { active: false });
  assert.throws(() => g.resolveBankConfirmationOwner(store), /PERSON-ben must have an active Admin, Manager or Director role for PRE03/);
});
