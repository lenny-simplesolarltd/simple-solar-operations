/* Minimal synthetic S17 fixture. DEV synthetic only. Reuses S16 fixture Jobs. */
'use strict';

function _s17FixtureRows() {
  var n = '2025-02-01T12:00:00.000Z';
  var base = { created_at: n, created_by: 'S17', updated_at: n, updated_by: 'S17', version: 1, source_system: 'S17-fixture', commit_id: 'S17-fixture' };

  // Reuse S16 job IDs — verify compatibility
  var oldJob = Object.assign({}, base, {
    id: 'J-s16-old', job_id: 'SS-S16O-LD01', customer_id: 'CUST-s17',
    display_name: 'S17 Old Completed Job',
    sold_submission_id: null, booking_submission_id: null,
    sold_at: '2025-01-15T00:00:00.000Z', salesperson_id: null, lead_source: 'S17',
    quote_reference: 'Q-S17-OLD', presale_file_id: null,
    finance_route: 'Standard', contract_status: 'Signed', contract_id: 'C-S17-OLD',
    contract_signed_at: '2025-01-20T00:00:00.000Z', contract_evidence_id: null,
    original_net_pence: 400000, original_vat_pence: 80000, original_gross_pence: 480000,
    approved_change_pence: null, current_contract_gross_pence: 480000,
    valuation_basis: 'Standard', sold_booking_match_status: 'Match',
    customer_details_verified_at: '2025-01-20T00:00:00.000Z', customer_details_verified_by: 'PERSON-s17-office',
    deposit_bank_confirmed_at: '2025-02-01T00:00:00.000Z', deposit_bank_confirmed_by: 'PERSON-s17-ben',
    deposit_bank_reference: 'DEP-S17-OLD',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete',
    booking_approved_at: '2025-01-25T00:00:00.000Z', booking_approved_by: 'PERSON-s17-office',
    operational_complete_at: '2025-02-01T00:00:00.000Z', operational_complete_by: 'PERSON-s17-office',
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'Sent', financial_status: 'Complete',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null, next_action_at: null, account_policy_version: null,
    pilot_job: true, release_scope: 'R1', source_record_id: null
  });

  var activeJob = Object.assign({}, base, {
    id: 'J-s17-active', job_id: 'SS-S17A-CTIVE', customer_id: 'CUST-s17',
    display_name: 'S17 Active Job', sold_submission_id: null, booking_submission_id: null,
    sold_at: '2026-07-01T00:00:00.000Z', salesperson_id: null, lead_source: 'S17',
    quote_reference: 'Q-S17-ACTIVE', presale_file_id: null,
    finance_route: 'Standard', contract_status: 'Signed', contract_id: 'C-S17-ACTIVE',
    contract_signed_at: '2026-07-15T00:00:00.000Z', contract_evidence_id: null,
    original_net_pence: 500000, original_vat_pence: 100000, original_gross_pence: 600000,
    approved_change_pence: null, current_contract_gross_pence: 600000,
    valuation_basis: 'Standard', sold_booking_match_status: 'Match',
    customer_details_verified_at: '2026-07-15T00:00:00.000Z', customer_details_verified_by: 'PERSON-s17-office',
    deposit_bank_confirmed_at: '2026-08-01T00:00:00.000Z', deposit_bank_confirmed_by: 'PERSON-s17-ben',
    deposit_bank_reference: 'DEP-S17-ACTIVE',
    roof_required: true, electrical_required: true, scaffold_required: true,
    workflow_stage: 'Booked',
    booking_approved_at: '2026-07-20T00:00:00.000Z', booking_approved_by: 'PERSON-s17-office',
    operational_complete_at: null, operational_complete_by: null,
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'NotReady', financial_status: 'Pending',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null, next_action_at: '2026-09-15T00:00:00.000Z',
    account_policy_version: null, pilot_job: true, release_scope: 'R1', source_record_id: null
  });

  var openTasks = [
    Object.assign({}, base, {
      id: 'TASK-s17-overdue', job_id: 'J-s17-active', template_code: 'BKG04',
      instance_key: 'S17-overdue', group: 'Booking', title: 'Overdue booking task',
      owner_id: 'PERSON-s17-office', related_entity_type: 'Jobs', related_entity_id: 'J-s17-active',
      due_at: '2026-08-01T00:00:00.000Z', original_due_at: '2026-08-01T00:00:00.000Z',
      status: 'Open', priority: 1, blocking_reason: null,
      created_rule_version: 'S17-1.0', source_system: 'S17-fixture'
    }),
    Object.assign({}, base, {
      id: 'TASK-s17-today', job_id: 'J-s17-active', template_code: 'MAT01',
      instance_key: 'S17-today', group: 'Materials', title: 'Order materials',
      owner_id: 'PERSON-s17-office', related_entity_type: 'Jobs', related_entity_id: 'J-s17-active',
      due_at: '2026-09-06T00:00:00.000Z', original_due_at: '2026-09-06T00:00:00.000Z',
      status: 'Open', priority: 1, blocking_reason: null,
      created_rule_version: 'S17-1.0', source_system: 'S17-fixture'
    }),
    Object.assign({}, base, {
      id: 'TASK-s17-soon', job_id: 'J-s17-active', template_code: 'SCA01',
      instance_key: 'S17-soon', group: 'Scaffold', title: 'Book scaffold',
      owner_id: 'PERSON-s17-office', related_entity_type: 'Jobs', related_entity_id: 'J-s17-active',
      due_at: '2026-09-10T00:00:00.000Z', original_due_at: '2026-09-10T00:00:00.000Z',
      status: 'Open', priority: 1, blocking_reason: null,
      created_rule_version: 'S17-1.0', source_system: 'S17-fixture'
    }),
    Object.assign({}, base, {
      id: 'TASK-s17-complete', job_id: 'J-s17-active', template_code: 'BKG04',
      instance_key: 'S17-complete', group: 'Booking', title: 'Completed task',
      owner_id: 'PERSON-s17-office', related_entity_type: 'Jobs', related_entity_id: 'J-s17-active',
      due_at: '2026-08-15T00:00:00.000Z', original_due_at: '2026-08-15T00:00:00.000Z',
      status: 'Complete', completed_at: '2026-08-15T00:00:00.000Z', completed_by: 'PERSON-s17-office',
      completion_note: 'Done', created_rule_version: 'S17-1.0', source_system: 'S17-fixture'
    })
  ];

  var people = [
    Object.assign({}, base, { id: 'PERSON-s17-office', email: 's17-office@dev.example.invalid', display_name: 'Tanya S17', role: 'Office', active: true }),
    Object.assign({}, base, { id: 'PERSON-s17-ben', email: 's17-ben@dev.example.invalid', display_name: 'Ben S17', role: 'Manager', active: true })
  ];

  var workPackages = [
    Object.assign({}, base, { id: 'WP-s17-roof', job_id: 'J-s17-active', trade: 'Roof', required: true, status: 'Scheduled', planned_start: '2026-09-15', planned_end: '2026-09-16', revision: 1, sequence: 1, commissioning_required: true }),
    Object.assign({}, base, { id: 'WP-s17-elec', job_id: 'J-s17-active', trade: 'Electrical', required: true, status: 'Unscheduled', planned_start: null, planned_end: null, revision: 1, sequence: 2, commissioning_required: false })
  ];

  var allocations = [
    Object.assign({}, base, { id: 'ALLOC-s17', work_package_id: 'WP-s17-roof', person_id: 'PERSON-s17-office', role: 'Lead', active: true, start_at: '2026-09-15', end_at: '2026-09-16' })
  ];

  var invoiceStages = [
    Object.assign({}, base, { id: 'INV-s17-deposit', job_id: 'J-s17-active', stage: 'deposit', gross_pence: 150000, status: 'Confirmed', due_date: '2026-08-01', source_status: 'PAID', xero_invoice_id: null }),
    Object.assign({}, base, { id: 'INV-s17-interim', job_id: 'J-s17-active', stage: 'interim', gross_pence: 210000, status: 'Sent', due_date: '2026-09-11', source_status: 'AUTHORISED', xero_invoice_id: null })
  ];

  var scaffoldBookings = [
    Object.assign({}, base, { id: 'SCA-s17', job_id: 'J-s17-active', status: 'Confirmed', company_id: null, erect_planned_at: '2026-09-14', erect_actual_at: null, strip_actual_at: null, revision: 1 })
  ];

  var auditEvents = [
    Object.assign({}, base, {
      id: 'AE-s17-1', entity_type: 'Jobs', entity_id: 'J-s17-active',
      action: 'S04CompleteTask', before_json: '{"status":"Open"}', after_json: '{"status":"Complete"}',
      initiating_actor: 'PERSON-s17-office', executing_service: 'S04 DEV',
      timestamp: '2026-08-15T10:00:00.000Z', correlation_id: 'S17-CMD-1', reason: 'Synthetic test event',
      commit_id: 'S17-fixture', source_system: undefined
    }),
    Object.assign({}, base, {
      id: 'AE-s17-2', entity_type: 'Jobs', entity_id: 'J-s17-active',
      action: 'S05Booking', before_json: null, after_json: '{"booking_submission_id":"S17-booking"}',
      initiating_actor: 'PERSON-s17-office', executing_service: 'S05 DEV',
      timestamp: '2026-07-20T09:00:00.000Z', correlation_id: 'S17-CMD-2', reason: 'Booking intake',
      commit_id: 'S17-fixture', source_system: undefined
    })
  ];

  // Shared canonical SYS01/SYS02 (compatible with S02 seed)
  var sysTemplates = [
    Object.assign({}, base, { source_system: undefined, id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health', group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day', due_rule: '09:00', evidence_required: 'Last-success timestamps, failures assigned', active: true, template_version: 'S17-1.0' }),
    Object.assign({}, base, { source_system: undefined, id: 'TPL-SYS02', template_code: 'SYS02', title: 'End-of-day review', group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day', due_rule: '16:30', evidence_required: 'Unresolved actions assigned', active: true, template_version: 'S17-1.0' })
  ];

  // Shared prior-stage prerequisites (must NOT require created_by === 'S17')
  // J-s16-old: S16 fixture job, S17 reads it for archive eligibility checks
  var sharedJobs = [oldJob];

  return {
    shared: { Jobs: sharedJobs, TaskTemplates: sysTemplates },
    owned: {
      Jobs: [activeJob],
      Tasks: openTasks,
      People: people,
      WorkPackages: workPackages,
      Allocations: allocations,
      InvoiceStages: invoiceStages,
      ScaffoldBookings: scaffoldBookings,
      AuditEvents: auditEvents
    }
  };
}

/* Verify a shared prior-stage Job is compatible with S17 read-model requirements. */
function _s17ValidateSharedJob(existing, required) {
  var fields = ['workflow_stage', 'handover_status', 'pilot_job', 'release_scope'];
  var mismatches = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (String(existing[f]) !== String(required[f])) mismatches.push(f + ': expected=' + required[f] + ' actual=' + existing[f]);
  }
  // operational_complete_at must be present for archive eligibility
  if (!existing.operational_complete_at && required.operational_complete_at) mismatches.push('operational_complete_at: expected set, actual missing');
  // archived_at must be null (S17 needs it unarchived for archive smoke)
  if (existing.archived_at && required.archived_at === null) mismatches.push('archived_at: expected null, actual ' + existing.archived_at);
  return { compatible: mismatches.length === 0, mismatches: mismatches };
}

function _s17ValidateSharedTemplate(existing, required) {
  var fields = ['template_code', 'group', 'default_owner_role', 'trigger_event', 'due_rule'];
  var mismatches = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (existing[f] !== required[f]) mismatches.push(f + ': expected=' + required[f] + ' actual=' + existing[f]);
  }
  if (existing.active !== true) mismatches.push('active: expected=true actual=' + existing.active);
  return { compatible: mismatches.length === 0, mismatches: mismatches };
}

function _s17Seed(store) {
  var data = _s17FixtureRows();
  var shared = data.shared;
  var owned = data.owned;

  // Phase 1a: Shared TaskTemplates — reuse if compatible, insert if absent
  if (shared.TaskTemplates) {
    for (var i = 0; i < shared.TaskTemplates.length; i++) {
      var trow = shared.TaskTemplates[i];
      delete trow.source_system;
      var texisting = store.get('TaskTemplates', trow.id);
      if (texisting) {
        var tcompat = _s17ValidateSharedTemplate(texisting, trow);
        if (!tcompat.compatible) throw new Error('S17_REFUSED: incompatible shared template ' + trow.id + ': ' + tcompat.mismatches.join('; '));
      } else {
        store.insert('TaskTemplates', trow);
      }
    }
  }

  // Phase 1b: Shared prior-stage fixture Jobs — fail if absent, verify if present
  if (shared.Jobs) {
    for (var j = 0; j < shared.Jobs.length; j++) {
      var jrow = shared.Jobs[j];
      var jexisting = store.get('Jobs', jrow.id);
      if (!jexisting) throw new Error('S17_REFUSED: shared prerequisite ' + jrow.id + ' not found — run prior-stage fixture first');
      var jcompat = _s17ValidateSharedJob(jexisting, jrow);
      if (!jcompat.compatible) throw new Error('S17_REFUSED: incompatible shared Job ' + jrow.id + ': ' + jcompat.mismatches.join('; '));
      // Compatible — reuse, do not mutate
    }
  }

  // Phase 2: S17-owned synthetic rows — strict collision protection
  for (var table in owned) {
    if (!owned.hasOwnProperty(table)) continue;
    for (var i = 0; i < owned[table].length; i++) {
      var row2 = owned[table][i];
      // Strip columns not in AuditEvents schema (no created_by/updated_by/version/source_system)
      if (table === 'AuditEvents') {
        delete row2.source_system;
        delete row2.created_by;
        delete row2.updated_by;
        delete row2.updated_at;
        delete row2.version;
      }
      var existing2 = store.get(table, row2.id);
      // AuditEvents has no created_by — skip provenance check
      if (table !== 'AuditEvents' && existing2 && existing2.created_by !== 'S17') throw new Error('S17_REFUSED: fixture ID collision ' + row2.id);
      if (!existing2) store.insert(table, row2);
    }
  }
}

function _s17VerifyRow(store, table, id, expectedCreatedBy) {
  var rows = store.list(table);
  var matching = rows.filter(function (r) { return r.id === id; });
  if (matching.length === 0) {
    var ids = rows.map(function (r) { return r.id; });
    return { ok: false, table: table, expected_id: id, total_rows: rows.length, found_ids: ids, detail: 'Row not found' };
  }
  if (matching.length > 1) return { ok: false, table: table, expected_id: id, count: matching.length, detail: 'Duplicate rows' };
  var row = matching[0];
  if (expectedCreatedBy && row.created_by !== expectedCreatedBy)
    return { ok: false, table: table, id: id, expected_created_by: expectedCreatedBy, actual_created_by: row.created_by, detail: 'created_by mismatch' };
  return { ok: true, table: table, id: id, created_by: row.created_by };
}

function _s17Smoke(store, core) {
  function fail(step, detail) { return { pass: false, step: step, detail: detail }; }

  // 1. Office today
  var today;
  try { today = core._s17OfficeToday(store, { as_of: '2026-09-06' }); } catch (e) { return fail('office-today', e.message || String(e)); }
  if (typeof today.overdue_count !== 'number') return fail('office-today', 'missing overdue_count');

  // 2. Job overview
  var overview;
  try { overview = core._s17JobOverview(store, 'J-s17-active'); } catch (e) { return fail('job-overview', e.message || String(e)); }
  if (!overview.found) return fail('job-overview', 'job not found');
  if (!overview.identity) return fail('job-overview', 'missing identity');
  if (!overview.booking) return fail('job-overview', 'missing booking');
  if (!overview.work) return fail('job-overview', 'missing work');
  if (!overview.finance) return fail('job-overview', 'missing finance');

  // 3. Job search
  var search;
  try { search = core._s17JobSearch(store, 'S17'); } catch (e) { return fail('job-search', e.message || String(e)); }
  if (!Array.isArray(search)) return fail('job-search', 'not an array');

  // 4. Operational queue
  var queue;
  try { queue = core._s17OperationalQueue(store, 'booking'); } catch (e) { return fail('operational-queue', e.message || String(e)); }
  if (typeof queue.count !== 'number') return fail('operational-queue', 'missing count');

  // 5. Admin ReleaseModes
  var modes;
  try { modes = core._s17AdminReleaseModes(store); } catch (e) { return fail('admin-modes', e.message || String(e)); }
  if (!Array.isArray(modes) || modes.length === 0) return fail('admin-modes', 'no modes returned');

  // 6. Admin system status
  var status;
  try { status = core._s17AdminSystemStatus(store); } catch (e) { return fail('admin-status', e.message || String(e)); }
  if (!status.health) return fail('admin-status', 'missing health');
  if (!status.not_configured) return fail('admin-status', 'missing not_configured');

  // 7. Audit history
  var history;
  try { history = core._s17AuditHistory(store, 'J-s17-active'); } catch (e) { return fail('audit-history', e.message || String(e)); }
  if (!history.found) return fail('audit-history', 'job not found');
  if (typeof history.total_events !== 'number') return fail('audit-history', 'missing total_events');

  // 8. Action availability
  var actions;
  try { actions = core._s17ActionAvailability(store, 'J-s17-active'); } catch (e) { return fail('action-availability', e.message || String(e)); }
  if (!actions.found) return fail('action-availability', 'job not found');
  if (!actions.actions) return fail('action-availability', 'missing actions');
  if (actions.actions.complete_task) return fail('action-availability', 'complete_task must not be a per-job action');

  // 9. Task action availability
  var taskActions;
  try { taskActions = core._s17TaskActionAvailability(store, 'TASK-s17-today'); } catch (e) { return fail('task-actions', e.message || String(e)); }
  if (!taskActions.found) return fail('task-actions', 'task not found');
  if (!taskActions.actions.complete) return fail('task-actions', 'missing complete action');

  return {
    pass: true,
    detail: {
      overdue_count: today.overdue_count,
      due_today_count: today.due_today_count,
      job_stage: overview.identity.workflow_stage,
      search_results: search.length,
      queue_count: queue.count,
      mode_count: modes.length,
      not_configured_count: status.not_configured_count,
      audit_events: history.total_events,
      actions_count: Object.keys(actions.actions).length,
      task_completable: taskActions.actions.complete.available,
      external_calls: 0
    }
  };
}

if (typeof module !== 'undefined') module.exports = { _s17FixtureRows, _s17Seed, _s17VerifyRow, _s17Smoke };
