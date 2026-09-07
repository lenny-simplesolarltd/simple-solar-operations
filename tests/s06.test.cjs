const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const {
  evaluateBookingGates, createTasksForJob, processBookingGates,
  isStaffedDay, nextStaffedDay, fridayBefore
} = require('../s06/gates.js');

const {
  installBaseFixture, buildReadyJob, buildMissingDepositJob, buildUnpaidInterimJob, buildCustomer,
  runReadyBooking, runMissingDeposit, runUnpaidInterim,
  runReevaluationIdempotent, runDeterministicInstanceKey,
  runFridayBeforeCalculation, runUnrelatedRowsUntouched
} = require('../s06/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['Jobs', 'Tasks', 'TaskDependencies', 'TaskEvents', 'AuditEvents', 'Customers', 'TaskTemplates', 'People', 'PersonRoles', 'ReleaseModes', 'Intake'];
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
  assert.equal(ap.templates, 6);

  var hp = ctx.runS06HappyPathTest();
  assert.equal(hp.pass, true, JSON.stringify(hp));

  var ss = ctx.restoreS06SafeState();
  assert.equal(ss.pass, true);
});
