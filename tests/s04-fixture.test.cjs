const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  dryRun, apply, validate, enableFn01, disableFn01,
  DEV_SHEET_ID, TEST_EMAIL, SYNTHETIC_JOB_INTERNAL_ID, SYNTHETIC_TASK_ID,
  buildSyntheticJob, buildSyntheticTask
} = require('../s04/fixture.js');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* --- Mock store factory --- */
function makeStore(overrides = {}) {
  const data = {
    People: [
      { id: 'PERSON-tanya', email: 'NOT_CONFIGURED', display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' },
      { id: 'PERSON-ben', email: 'NOT_CONFIGURED', display_name: 'Ben Quick', role: 'Admin', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' },
      { id: 'PERSON-installer-a', email: 'NOT_CONFIGURED', display_name: 'Installer A', role: 'Installer', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    PersonRoles: [
      { id: 'PROLE-tanya-office', person_id: 'PERSON-tanya', role: 'Office', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' },
      { id: 'PROLE-ben-admin', person_id: 'PERSON-ben', role: 'Admin', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' },
      { id: 'PROLE-installer', person_id: 'PERSON-installer-a', role: 'Installer', active: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' }
    ],
    PermissionRules: [
      { id: 'PERM-admin-all', role: 'Admin', action: '*', entity: '*', scope: 'All', allowed: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' },
      { id: 'PERM-office-tasks', role: 'Office', action: 'CompleteTask', entity: 'Tasks', scope: 'All', allowed: true, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' }
    ],
    ReleaseModes: [
      { id: 'RM-FN01', function_id: 'FN-01', function_name: 'Office core', mode: 'Disabled', mode_record_basis: 'seed', authorised_job_scope: 'None', target_release: 'R1', planned_target_mode: 'Automated', current_system: 'manual', fallback: 'manual', external_ids_protected_reference: null, activation_time: null, approved_version: null, ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' },
      { id: 'RM-FN02', function_id: 'FN-02', function_name: 'Calendar', mode: 'Disabled', mode_record_basis: 'seed', authorised_job_scope: 'None', target_release: 'R2', planned_target_mode: 'Automated', current_system: 'manual', fallback: 'manual', external_ids_protected_reference: null, activation_time: null, approved_version: null, ben_approval_reference: null, scope_boundary_notes: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, commit_id: 'seed' }
    ],
    Jobs: [],
    Tasks: [],
    TaskDependencies: [],
    TaskEvents: [],
    AuditEvents: [],
    CommitJournal: []
  };

  // Apply overrides to initial data
  for (const [table, rows] of Object.entries(overrides)) {
    if (data[table]) data[table] = rows;
  }

  const lastRows = {};
  const maxRows = {};
  for (const t of Object.keys(data)) {
    lastRows[t] = data[t].length + 1; // header + data
    maxRows[t] = 1000;
  }

  return {
    getSheetId: () => DEV_SHEET_ID,
    readTable(name) {
      return (data[name] || []).map((record, i) => ({ record, row: i + 2 }));
    },
    insertRow(name, rowData) {
      if (!data[name]) throw new Error('Unknown table: ' + name);
      if (data[name].some(r => r.id === rowData.id)) throw new Error('Duplicate id: ' + rowData.id);
      data[name].push(rowData);
      lastRows[name] = data[name].length + 1;
    },
    updateRow(name, rowIndex, id, patch) {
      const record = (data[name] || []).find(r => r.id === id);
      if (!record) throw new Error('Row not found: ' + name + ' ' + id);
      Object.assign(record, patch);
    },
    getLastRow(name) { return lastRows[name] || 1; },
    getMaxRows(name) { return maxRows[name] || 1000; }
  };
}

/* --- Dry run tests --- */
test('dry run detects missing person email and plans update', () => {
  const store = makeStore();
  const result = dryRun(store);
  assert.equal(result.planned.updates.length, 1);
  assert.equal(result.planned.updates[0].table, 'People');
  assert.equal(result.planned.updates[0].id, 'PERSON-tanya');
  assert.equal(result.actor.email, TEST_EMAIL);
  assert.equal(result.fn01.mode, 'Disabled');
  assert.equal(result.fn01_enabled, false);
  assert.equal(result.fixture_ready, true); // missing job/task are planned, not errors
  assert.equal(result.command_ready, false);
  assert.ok(result.planned.inserts.some(i => i.table === 'Jobs'));
  assert.ok(result.planned.inserts.some(i => i.table === 'Tasks'));
});

test('dry run finds existing person with test email', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const result = dryRun(store);
  assert.equal(result.actor.id, 'PERSON-tanya');
  assert.equal(result.actor.active, true);
  assert.equal(result.planned.updates.length, 0);
});

test('dry run errors on duplicate people with test email', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' },
      { id: 'PERSON-other', email: TEST_EMAIL, display_name: 'Other', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('Multiple')));
  assert.equal(result.actor, null);
});

test('dry run detects inactive actor', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: false, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('not active')));
});

test('dry run detects missing permission', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    PermissionRules: []
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('No PermissionRule')));
});

test('dry run detects explicit permission denial', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    PermissionRules: [
      { id: 'PERM-deny', role: 'Office', action: 'CompleteTask', entity: 'Tasks', scope: 'All', allowed: false, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', commit_id: 'seed' }
    ]
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('explicitly denied')));
});

test('dry run detects missing synthetic job', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const result = dryRun(store);
  assert.ok(result.planned.inserts.some(i => i.table === 'Jobs'));
  assert.equal(result.synthetic_job, null);
});

test('dry run validates existing synthetic job', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })]
  });
  const result = dryRun(store);
  assert.equal(result.synthetic_job.id, SYNTHETIC_JOB_INTERNAL_ID);
  assert.equal(result.synthetic_job.pilot_job, true);
});

test('dry run rejects non-synthetic job with same id', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [{ ...buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID }), pilot_job: false }]
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('pilot_job')));
});

test('dry run detects bad task state', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [{ ...buildSyntheticTask('PERSON-tanya'), status: 'Cancelled', version: 5 }]
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('status must be Open')));
  assert.ok(result.errors.some(e => e.includes('version must be 1')));
});

test('dry run detects unsatisfied dependencies', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')],
    TaskDependencies: [{ id: 'DEP-01', task_id: SYNTHETIC_TASK_ID, prerequisite_task_id: 'T-other', named_gate: null, satisfied_at: null, created_at: '2026-01-01T00:00:00.000Z', commit_id: 'seed' }]
  });
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('Unsatisfied')));
});

test('dry run full fixture ready with correct data but fn01 disabled', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  const result = dryRun(store);
  assert.equal(result.fixture_ready, true);
  assert.equal(result.fn01_enabled, false);
  assert.equal(result.command_ready, false);
  assert.equal(result.errors.length, 0);
});

/* --- Apply tests --- */
test('apply inserts missing job and task', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const result = apply(store);
  assert.equal(result.applied, true);
  assert.ok(result.performed.inserts.some(i => i.table === 'Jobs'));
  assert.ok(result.performed.inserts.some(i => i.table === 'Tasks'));
  const job = store.readTable('Jobs').find(r => r.record.id === SYNTHETIC_JOB_INTERNAL_ID);
  assert.ok(job);
  assert.equal(job.record.pilot_job, true);
  assert.equal(job.record.source_system, 'S04-synthetic');
  const task = store.readTable('Tasks').find(r => r.record.id === SYNTHETIC_TASK_ID);
  assert.ok(task);
  assert.equal(task.record.status, 'Open');
  assert.equal(task.record.version, 1);
});

test('apply is idempotent - second run changes nothing', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const first = apply(store);
  assert.equal(first.applied, true);
  const jobCount = store.readTable('Jobs').length;
  const taskCount = store.readTable('Tasks').length;

  const second = apply(store);
  assert.equal(second.applied, true);
  assert.equal(second.performed.inserts.length, 0);
  assert.equal(second.performed.updates.length, 0);
  assert.equal(store.readTable('Jobs').length, jobCount);
  assert.equal(store.readTable('Tasks').length, taskCount);
});

test('apply updates PERSON-tanya email when NOT_CONFIGURED', () => {
  const store = makeStore();
  const result = apply(store);
  assert.equal(result.applied, true);
  const tanya = store.readTable('People').find(r => r.record.id === 'PERSON-tanya');
  assert.equal(tanya.record.email, TEST_EMAIL);
});

test('apply does not overwrite existing real email', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: 'real@example.com', display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ]
  });
  const result = apply(store);
  assert.equal(result.applied, false);
  const tanya = store.readTable('People').find(r => r.record.id === 'PERSON-tanya');
  assert.equal(tanya.record.email, 'real@example.com');
});

test('apply does not create duplicate job or task', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  const result = apply(store);
  assert.equal(result.applied, true);
  assert.equal(result.performed.inserts.length, 0);
  assert.equal(store.readTable('Jobs').length, 1);
  assert.equal(store.readTable('Tasks').length, 1);
});

/* --- Validate tests --- */
test('validate reports all gates', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  const result = validate(store);
  assert.ok(result.checks.length > 10);
  assert.equal(result.fixture_ready, true);
  assert.equal(result.fn01_enabled, false);
  assert.equal(result.command_ready, false);
  const fn01Check = result.checks.find(c => c.name === 'fn01_exists');
  assert.ok(fn01Check);
  assert.equal(fn01Check.pass, true);
});

/* --- Enable/disable FN-01 tests --- */
test('enableFn01 sets Automated/Pilot/R1', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  const result = enableFn01(store);
  assert.equal(result.success, true);
  assert.equal(result.already_enabled, false);
  assert.equal(result.after.mode, 'Automated');
  assert.equal(result.after.scope, 'Pilot');
  const fn01 = store.readTable('ReleaseModes').find(r => r.record.function_id === 'FN-01');
  assert.equal(fn01.record.mode, 'Automated');
  assert.equal(fn01.record.authorised_job_scope, 'Pilot');
  assert.equal(fn01.record.version, 2);
});

test('enableFn01 is idempotent', () => {
  const store = makeStore();
  const first = enableFn01(store);
  assert.equal(first.already_enabled, false);
  const second = enableFn01(store);
  assert.equal(second.already_enabled, true);
});

test('enableFn01 does not touch other modes', () => {
  const store = makeStore();
  const before = clone(store.readTable('ReleaseModes').find(r => r.record.id === 'RM-FN02'));
  enableFn01(store);
  const after = store.readTable('ReleaseModes').find(r => r.record.id === 'RM-FN02');
  assert.deepEqual(before, after);
});

test('disableFn01 sets Disabled/None', () => {
  const store = makeStore();
  enableFn01(store);
  const result = disableFn01(store);
  assert.equal(result.success, true);
  assert.equal(result.after.mode, 'Disabled');
  assert.equal(result.after.scope, 'None');
  const fn01 = store.readTable('ReleaseModes').find(r => r.record.function_id === 'FN-01');
  assert.equal(fn01.record.mode, 'Disabled');
});

test('disableFn01 is idempotent', () => {
  const store = makeStore();
  const first = disableFn01(store);
  assert.equal(first.already_disabled, true);
});

test('disableFn01 does not touch other modes', () => {
  const store = makeStore();
  enableFn01(store);
  const before = clone(store.readTable('ReleaseModes').find(r => r.record.id === 'RM-FN02'));
  disableFn01(store);
  const after = store.readTable('ReleaseModes').find(r => r.record.id === 'RM-FN02');
  assert.deepEqual(before, after);
});

test('validate shows command_ready after enable', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  enableFn01(store);
  const result = validate(store);
  assert.equal(result.fixture_ready, true);
  assert.equal(result.fn01_enabled, true);
  assert.equal(result.command_ready, true);
});

/* --- Environment guard tests --- */
test('dry run rejects wrong sheet id', () => {
  const store = makeStore();
  store.getSheetId = () => 'wrong-id';
  const result = dryRun(store);
  assert.equal(result.sheet_match, false);
});

/* --- Capacity tests --- */
test('dry run reports insufficient capacity', () => {
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  // Override max rows to simulate exhaustion
  const origMax = store.getMaxRows;
  const origLast = store.getLastRow;
  store.getMaxRows = (name) => name === 'CommitJournal' ? 2 : origMax(name);
  store.getLastRow = (name) => name === 'CommitJournal' ? 2 : origLast(name);
  const result = dryRun(store);
  assert.ok(result.errors.some(e => e.includes('CommitJournal')));
});

/* --- Apps Script entry points via VM --- */
test('S04FixtureCore.gs exposes all functions as global S04Fixture', () => {
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(fs.readFileSync('apps-script/S04FixtureCore.gs', 'utf8'), ctx);
  assert.equal(typeof ctx.S04Fixture.dryRun, 'function');
  assert.equal(typeof ctx.S04Fixture.apply, 'function');
  assert.equal(typeof ctx.S04Fixture.validate, 'function');
  assert.equal(typeof ctx.S04Fixture.enableFn01, 'function');
  assert.equal(typeof ctx.S04Fixture.disableFn01, 'function');
  assert.equal(ctx.S04Fixture.DEV_SHEET_ID, DEV_SHEET_ID);
  assert.equal(ctx.S04Fixture.TEST_EMAIL, TEST_EMAIL);
});

test('S04FixtureCore.gs packaged dry run matches local core', () => {
  const ctx = vm.createContext({ console: { log() {} } });
  vm.runInContext(fs.readFileSync('apps-script/S04FixtureCore.gs', 'utf8'), ctx);
  const store = makeStore({
    People: [
      { id: 'PERSON-tanya', email: TEST_EMAIL, display_name: 'Tanya', role: 'Office', company_id: null, active: true, calendar_id: null, notification_email: null, capacity_per_day: null, available_from: null, available_to: null, backup_person_id: null, created_at: '2026-01-01T00:00:00.000Z', created_by: 'seed', updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'seed', version: 1, source_system: 'seed', source_record_id: null, commit_id: 'seed' }
    ],
    Jobs: [buildSyntheticJob({ getSheetId: () => DEV_SHEET_ID })],
    Tasks: [buildSyntheticTask('PERSON-tanya')]
  });
  const localResult = dryRun(store);
  const pkgResult = ctx.S04Fixture.dryRun(store);
  // job_id uses Date.now() so differs; compare without it
  assert.equal(pkgResult.sheet_match, localResult.sheet_match);
  assert.equal(pkgResult.fixture_ready, localResult.fixture_ready);
  assert.equal(pkgResult.fn01_enabled, localResult.fn01_enabled);
  assert.equal(pkgResult.command_ready, localResult.command_ready);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pkgResult.actor)), localResult.actor);
  assert.equal(pkgResult.errors.length, localResult.errors.length);
  assert.equal(pkgResult.warnings.length, localResult.warnings.length);
  assert.equal(pkgResult.fixture_ready, localResult.fixture_ready);
  assert.equal(pkgResult.fn01_enabled, localResult.fn01_enabled);
  assert.equal(pkgResult.command_ready, localResult.command_ready);
});

test('S04FixtureCore.gs has no require or module.exports', () => {
  const source = fs.readFileSync('apps-script/S04FixtureCore.gs', 'utf8');
  assert.doesNotMatch(source, /\brequire\s*\(/);
  assert.doesNotMatch(source, /\bmodule\.exports\b/);
  assert.match(source, /var S04Fixture/);
});

/* --- S04Fixture.js entry points test via VM --- */
test('S04Fixture.js entry points run through mock SpreadsheetApp', () => {
  const grids = {};
  const headers = {
    People: ['id','email','display_name','role','company_id','active','calendar_id','notification_email','capacity_per_day','available_from','available_to','backup_person_id','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
    PersonRoles: ['id','person_id','role','active','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
    PermissionRules: ['id','role','action','entity','scope','allowed','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
    ReleaseModes: ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'],
    Jobs: ['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id','sold_at','salesperson_id','lead_source','quote_reference','presale_file_id','finance_route','contract_status','contract_id','contract_signed_at','contract_evidence_id','original_net_pence','original_vat_pence','original_gross_pence','approved_change_pence','current_contract_gross_pence','valuation_basis','sold_booking_match_status','customer_details_verified_at','customer_details_verified_by','deposit_bank_confirmed_at','deposit_bank_confirmed_by','deposit_bank_reference','roof_required','electrical_required','scaffold_required','workflow_stage','booking_approved_at','booking_approved_by','operational_complete_at','operational_complete_by','customer_happy_at','customer_happy_by','handover_status','financial_status','cancellation_at','cancellation_by','cancellation_reason','archived_at','next_action_at','account_policy_version','pilot_job','release_scope','created_at','created_by','updated_at','updated_by','version','source_system','source_record_id','commit_id'],
    Tasks: ['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status','blocking_reason','next_followup_at','completed_at','completed_by','completion_note','evidence_id','revision_required','created_rule_version','created_at','created_by','updated_at','updated_by','version','source_system','commit_id'],
    TaskDependencies: ['id','task_id','prerequisite_task_id','named_gate','satisfied_at','created_at','commit_id'],
    TaskEvents: ['id','task_id','action','old_status','new_status','old_owner','new_owner','old_due','new_due','reason','actor','timestamp','created_at','commit_id'],
    AuditEvents: ['id','entity_type','entity_id','action','before_json','after_json','initiating_actor','executing_service','timestamp','correlation_id','reason','commit_id','created_at'],
    CommitJournal: ['id','commit_id','state','command_id','entity_type','entity_id','expected_version','changes_json','prepared_at','committed_at','created_at']
  };

  // Seed the mock grids with initial data
  const seedPerson = { id:'PERSON-tanya',email:'NOT_CONFIGURED',display_name:'Tanya',role:'Office',company_id:null,active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'seed',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'seed',version:1,source_system:'seed',source_record_id:null,commit_id:'seed' };
  const seedPersonRole = { id:'PROLE-tanya-office',person_id:'PERSON-tanya',role:'Office',active:true,created_at:'2026-01-01T00:00:00.000Z',created_by:'seed',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'seed',version:1,source_system:'seed',commit_id:'seed' };
  const seedPermRule = { id:'PERM-office-tasks',role:'Office',action:'CompleteTask',entity:'Tasks',scope:'All',allowed:true,created_at:'2026-01-01T00:00:00.000Z',created_by:'seed',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'seed',version:1,source_system:'seed',commit_id:'seed' };
  const seedFn01 = { id:'RM-FN01',function_id:'FN-01',function_name:'Office core',mode:'Disabled',mode_record_basis:'seed',authorised_job_scope:'None',target_release:'R1',planned_target_mode:'Automated',current_system:'manual',fallback:'manual',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'seed',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'seed',version:1,commit_id:'seed' };

  const seedData = {
    People: [seedPerson],
    PersonRoles: [seedPersonRole],
    PermissionRules: [seedPermRule],
    ReleaseModes: [seedFn01],
    Jobs: [],
    Tasks: [],
    TaskDependencies: [],
    TaskEvents: [],
    AuditEvents: [],
    CommitJournal: []
  };

  for (const [name, cols] of Object.entries(headers)) {
    const rows = [cols];
    for (const rec of (seedData[name] || [])) {
      rows.push(cols.map(h => rec[h] ?? ''));
    }
    grids[name] = rows;
  }

  const sheets = {};
  for (const name of Object.keys(grids)) {
    sheets[name] = {
      getName: () => name,
      getLastColumn: () => grids[name][0].length,
      getLastRow: () => grids[name].length,
      getMaxRows: () => 1000,
      getRange(row, col, height = 1, width = 1) {
        return {
          getValues() {
            return Array.from({ length: height }, (_, r) =>
              Array.from({ length: width }, (_, c) => (grids[name][row - 1 + r] || [])[col - 1 + c] ?? ''));
          },
          setValues(values) {
            values.forEach((rowVals, ri) => {
              rowVals.forEach((v, ci) => {
                if (!grids[name][row - 1 + ri]) grids[name][row - 1 + ri] = [];
                grids[name][row - 1 + ri][col - 1 + ci] = v;
              });
            });
          }
        };
      }
    };
  }

  const ss = {
    getId: () => DEV_SHEET_ID,
    getSheets: () => Object.values(sheets)
  };

  const ctx = vm.createContext({
    console: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => JSON.stringify({ environment: 'DEV', sheetId: DEV_SHEET_ID })
      })
    }
  });

  vm.runInContext(fs.readFileSync('apps-script/S04FixtureCore.gs', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('apps-script/S04Fixture.js', 'utf8'), ctx);

  const dryRunResult = ctx.runS04FixtureDryRun();
  assert.equal(dryRunResult.sheet_match, true);
  assert.equal(dryRunResult.actor.email, TEST_EMAIL);
  assert.equal(dryRunResult.fn01.mode, 'Disabled');

  const applyResult = ctx.runS04FixtureApply();
  assert.equal(applyResult.applied, true);
  assert.ok(applyResult.performed.inserts.some(i => i.table === 'Jobs'));
  assert.ok(applyResult.performed.inserts.some(i => i.table === 'Tasks'));

  const validateResult = ctx.runS04FixtureValidate();
  assert.equal(validateResult.fixture_ready, true);
  assert.equal(validateResult.command_ready, false);

  const enableResult = ctx.runS04EnableFn01ForSyntheticTest();
  assert.equal(enableResult.success, true);

  const afterEnable = ctx.runS04FixtureValidate();
  assert.equal(afterEnable.command_ready, true);

  const disableResult = ctx.runS04DisableFn01AfterSyntheticTest();
  assert.equal(disableResult.success, true);
});
