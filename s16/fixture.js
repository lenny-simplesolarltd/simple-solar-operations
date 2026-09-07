/* Minimal synthetic S16 fixture. DEV synthetic only. */
'use strict';

function _s16FixtureRows() {
  var n = '2025-02-01T12:00:00.000Z';
  var base = { created_at: n, created_by: 'S16', updated_at: n, updated_by: 'S16', version: 1, source_system: 'S16-fixture', commit_id: 'S16-fixture' };

  // Old completed job — archive-eligible
  var oldJob = Object.assign({}, base, {
    id: 'J-s16-old',
    job_id: 'SS-S16O-LD01',
    customer_id: 'CUST-s16',
    display_name: 'S16 Old Completed Job',
    sold_submission_id: null, booking_submission_id: null,
    sold_at: '2025-01-15T00:00:00.000Z',
    salesperson_id: null, lead_source: 'S16',
    quote_reference: 'Q-S16-OLD',
    presale_file_id: null,
    finance_route: 'Standard',
    contract_status: 'Signed',
    contract_id: 'C-S16-OLD',
    contract_signed_at: '2025-01-20T00:00:00.000Z',
    contract_evidence_id: null,
    original_net_pence: 400000, original_vat_pence: 80000, original_gross_pence: 480000,
    approved_change_pence: null, current_contract_gross_pence: 480000,
    valuation_basis: 'Standard',
    sold_booking_match_status: 'Match',
    customer_details_verified_at: '2025-01-20T00:00:00.000Z',
    customer_details_verified_by: 'PERSON-s16-office',
    deposit_bank_confirmed_at: '2025-02-01T00:00:00.000Z',
    deposit_bank_confirmed_by: 'PERSON-s16-ben',
    deposit_bank_reference: 'DEP-S16-OLD',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete',
    booking_approved_at: '2025-01-25T00:00:00.000Z',
    booking_approved_by: 'PERSON-s16-office',
    operational_complete_at: '2025-02-01T00:00:00.000Z',
    operational_complete_by: 'PERSON-s16-office',
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'Sent',
    financial_status: 'Complete',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null,
    next_action_at: null,
    account_policy_version: null,
    pilot_job: true, release_scope: 'R1',
    source_record_id: null
  });

  // Recent job — NOT archive-eligible
  var recentJob = Object.assign({}, base, {
    id: 'J-s16-recent',
    job_id: 'SS-S16R-ECENT',
    customer_id: 'CUST-s16',
    display_name: 'S16 Recent Job',
    sold_submission_id: null, booking_submission_id: null,
    sold_at: '2026-06-01T00:00:00.000Z',
    salesperson_id: null, lead_source: 'S16',
    quote_reference: 'Q-S16-RECENT',
    presale_file_id: null,
    finance_route: 'Standard',
    contract_status: 'Signed',
    contract_id: 'C-S16-RECENT',
    contract_signed_at: '2026-06-15T00:00:00.000Z',
    contract_evidence_id: null,
    original_net_pence: 400000, original_vat_pence: 80000, original_gross_pence: 480000,
    approved_change_pence: null, current_contract_gross_pence: 480000,
    valuation_basis: 'Standard',
    sold_booking_match_status: 'Match',
    customer_details_verified_at: '2026-06-15T00:00:00.000Z',
    customer_details_verified_by: 'PERSON-s16-office',
    deposit_bank_confirmed_at: '2026-07-01T00:00:00.000Z',
    deposit_bank_confirmed_by: 'PERSON-s16-ben',
    deposit_bank_reference: 'DEP-S16-RECENT',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete',
    booking_approved_at: '2026-06-20T00:00:00.000Z',
    booking_approved_by: 'PERSON-s16-office',
    operational_complete_at: '2026-07-01T00:00:00.000Z',
    operational_complete_by: 'PERSON-s16-office',
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'Sent',
    financial_status: 'Complete',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null,
    next_action_at: null,
    account_policy_version: null,
    pilot_job: true, release_scope: 'R1',
    source_record_id: null
  });

  // Job with open task — NOT archive-eligible
  var jobWithOpenTask = Object.assign({}, base, {
    id: 'J-s16-opentask',
    job_id: 'SS-S16O-PENT',
    customer_id: 'CUST-s16',
    display_name: 'S16 Job With Open Task',
    sold_submission_id: null, booking_submission_id: null,
    sold_at: '2025-01-15T00:00:00.000Z',
    salesperson_id: null, lead_source: 'S16',
    quote_reference: 'Q-S16-OT',
    presale_file_id: null,
    finance_route: 'Standard',
    contract_status: 'Signed',
    contract_id: 'C-S16-OT',
    contract_signed_at: '2025-01-20T00:00:00.000Z',
    contract_evidence_id: null,
    original_net_pence: 400000, original_vat_pence: 80000, original_gross_pence: 480000,
    approved_change_pence: null, current_contract_gross_pence: 480000,
    valuation_basis: 'Standard',
    sold_booking_match_status: 'Match',
    customer_details_verified_at: '2025-01-20T00:00:00.000Z',
    customer_details_verified_by: 'PERSON-s16-office',
    deposit_bank_confirmed_at: '2025-02-01T00:00:00.000Z',
    deposit_bank_confirmed_by: 'PERSON-s16-ben',
    deposit_bank_reference: 'DEP-S16-OT',
    roof_required: true, electrical_required: false, scaffold_required: false,
    workflow_stage: 'OperationallyComplete',
    booking_approved_at: '2025-01-25T00:00:00.000Z',
    booking_approved_by: 'PERSON-s16-office',
    operational_complete_at: '2025-02-01T00:00:00.000Z',
    operational_complete_by: 'PERSON-s16-office',
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'Sent',
    financial_status: 'Complete',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null,
    next_action_at: null,
    account_policy_version: null,
    pilot_job: true, release_scope: 'R1',
    source_record_id: null
  });

  var openTask = Object.assign({}, base, {
    id: 'TASK-s16-opentask',
    job_id: 'J-s16-opentask',
    template_code: 'BKG04',
    instance_key: 'S16-opentask',
    group: 'Booking',
    title: 'Open task blocking archive',
    owner_id: 'PERSON-s16-office',
    related_entity_type: 'Jobs',
    related_entity_id: 'J-s16-opentask',
    status: 'Open',
    created_rule_version: 'S16-1.0',
    source_system: 'S16-fixture'
  });

  var people = [
    Object.assign({}, base, { id: 'PERSON-s16-office', email: 's16-office@dev.example.invalid', display_name: 'Tanya S16', role: 'Office', active: true }),
    Object.assign({}, base, { id: 'PERSON-s16-ben', email: 's16-ben@dev.example.invalid', display_name: 'Ben S16', role: 'Manager', active: true })
  ];

  var sysTemplates = [
    Object.assign({}, base, { source_system: undefined, id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health', group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day', due_rule: '09:00', evidence_required: 'Last-success timestamps, failures assigned', active: true, template_version: 'S16-1.0' }),
    Object.assign({}, base, { source_system: undefined, id: 'TPL-SYS02', template_code: 'SYS02', title: 'End-of-day review', group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day', due_rule: '16:30', evidence_required: 'Unresolved actions assigned', active: true, template_version: 'S16-1.0' })
  ];

  // Shared canonical prerequisites — IDs that may already exist from prior stages
  var sharedTemplates = sysTemplates;
  // S16-owned synthetic rows — strict collision protection
  var ownedRows = {
    Jobs: [oldJob, recentJob, jobWithOpenTask],
    Tasks: [openTask],
    People: people
  };

  return { shared: { TaskTemplates: sharedTemplates }, owned: ownedRows };
}

/* Verify a shared canonical template is compatible with S16 requirements. */
function _s16ValidateSharedTemplate(existing, required) {
  var fields = ['template_code', 'group', 'default_owner_role', 'trigger_event', 'due_rule'];
  var mismatches = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (existing[f] !== required[f]) mismatches.push(f + ': expected=' + required[f] + ' actual=' + existing[f]);
  }
  if (existing.active !== true) mismatches.push('active: expected=true actual=' + existing.active);
  return { compatible: mismatches.length === 0, mismatches: mismatches };
}

function _s16Seed(store) {
  var data = _s16FixtureRows();
  var shared = data.shared;
  var owned = data.owned;

  // Phase 1: Shared canonical templates — reuse if compatible, insert if absent
  for (var table in shared) {
    if (!shared.hasOwnProperty(table)) continue;
    for (var i = 0; i < shared[table].length; i++) {
      var row = shared[table][i];
      // Remove source_system from TaskTemplates (not a valid column)
      delete row.source_system;
      var existing = store.get(table, row.id);
      if (existing) {
        var compat = _s16ValidateSharedTemplate(existing, row);
        if (!compat.compatible) throw new Error('S16_REFUSED: incompatible shared template ' + row.id + ': ' + compat.mismatches.join('; '));
        // Compatible — reuse, do not overwrite
      } else {
        store.insert(table, row);
      }
    }
  }

  // Phase 2: S16-owned synthetic rows — strict collision protection
  for (var table in owned) {
    if (!owned.hasOwnProperty(table)) continue;
    for (var i = 0; i < owned[table].length; i++) {
      var row = owned[table][i];
      var existing = store.get(table, row.id);
      if (existing && existing.created_by !== 'S16') throw new Error('S16_REFUSED: fixture ID collision ' + row.id);
      if (!existing) store.insert(table, row);
    }
  }
}

/* Verify a row can be retrieved through the store adapter with diagnostic detail. */
function _s16VerifyRow(store, table, id, expectedCreatedBy) {
  var rows = store.list(table);
  var totalRows = rows.length;
  var matching = rows.filter(function (r) { return r.id === id; });
  if (matching.length === 0) {
    var ids = rows.map(function (r) { return r.id; });
    return { ok: false, table: table, expected_id: id, total_rows: totalRows, found_ids: ids, detail: 'Row not found in ' + table + '. Present IDs: ' + JSON.stringify(ids.slice(0, 20)) };
  }
  if (matching.length > 1) return { ok: false, table: table, expected_id: id, count: matching.length, detail: 'Duplicate rows for ' + id };
  var row = matching[0];
  if (expectedCreatedBy && row.created_by !== expectedCreatedBy)
    return { ok: false, table: table, id: id, expected_created_by: expectedCreatedBy, actual_created_by: row.created_by, detail: 'created_by mismatch' };
  return { ok: true, table: table, id: id, created_by: row.created_by };
}

function _s16Smoke(store, core) {
  var h, b, a, r, v, eOld, eRecent, eOpen, a2, reopen, tasks;
  function fail(step, detail) { return { pass: false, step: step, detail: detail }; }

  // 0. Pre-flight: verify fixture rows exist through the adapter
  var verify = _s16VerifyRow(store, 'Jobs', 'J-s16-old', 'S16');
  if (!verify.ok) return fail('preflight-jobs', verify.detail);
  verify = _s16VerifyRow(store, 'Jobs', 'J-s16-recent', 'S16');
  if (!verify.ok) return fail('preflight-jobs-recent', verify.detail);
  verify = _s16VerifyRow(store, 'Jobs', 'J-s16-opentask', 'S16');
  if (!verify.ok) return fail('preflight-jobs-opentask', verify.detail);

  // 1. Health status
  try { h = core._s16HealthStatus(store); } catch (e) { return fail('health', e.message || String(e)); }
  if (h.overall !== 'Healthy' && h.overall !== 'Degraded') return fail('health', 'Unexpected: ' + h.overall);

  // 2. Backup manifest
  try { b = core._s16BackupManifest(store, { command_id: 'S16-SMOKE-BACKUP', actor: 'PERSON-s16-office' }); } catch (e) { return fail('backup-manifest', e.message || String(e)); }
  if (b.replay) {
    b.backup_id = b.manifest ? b.manifest.id : null;
    if (b.manifest && b.manifest.totals_json) {
      try { var pt = JSON.parse(b.manifest.totals_json); b.checksum = pt.checksum; } catch (e) { /* fall through */ }
    }
    if (!b.backup_id || !b.checksum) return fail('backup-manifest-replay', 'missing backup_id or checksum');
  } else if (!b.created || !b.checksum || !b.backup_id) {
    return fail('backup-manifest', 'created=' + b.created + ' checksum=' + b.checksum + ' backup_id=' + b.backup_id);
  }

  // 3. Validate backup (only on initial creation; replay skips as state has mutated)
  if (!b.replay) {
    try { v = core._s16ValidateBackup(store, b.backup_id); } catch (e) { return fail('backup-validate', e.message || String(e)); }
    if (!v.valid) return fail('backup-validate', JSON.stringify(v.count_mismatches));
  }

  // 4. Restore plan (dry-run only; replay skips as state has mutated)
  if (!b.replay) {
    try { r = core._s16RestorePlan(store, b.backup_id, { actor: 'PERSON-s16-office', reason: 'Synthetic restore plan test' }); } catch (e) { return fail('restore-plan', e.message || String(e)); }
    if (!r.dry_run || !r.blocked) return fail('restore-plan', 'dry_run=' + r.dry_run + ' blocked=' + r.blocked);
  }

  // 5. Archive eligibility — old job (>18 months) eligible
  try { eOld = core._s16ArchiveEligibility(store, 'J-s16-old'); } catch (e) { return fail('archive-eligibility-old', e.message || String(e)); }
  if (!eOld.eligible) return fail('archive-eligibility-old', (eOld.blockers || ['unknown']).join(', '));

  // 6. Archive eligibility — recent job NOT eligible
  try { eRecent = core._s16ArchiveEligibility(store, 'J-s16-recent'); } catch (e) { return fail('archive-eligibility-recent', e.message || String(e)); }
  if (eRecent.eligible) return fail('archive-eligibility-recent', 'should not be eligible');

  // 7. Archive eligibility — job with open task NOT eligible
  try { eOpen = core._s16ArchiveEligibility(store, 'J-s16-opentask'); } catch (e) { return fail('archive-eligibility-opentask', e.message || String(e)); }
  if (eOpen.eligible) return fail('archive-eligibility-opentask', 'should not be eligible');

  // 8. Archive old job (may be replay on second smoke run)
  try { a = core._s16ArchiveJob(store, { command_id: 'S16-SMOKE-ARCHIVE', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Synthetic archive' }); } catch (e) { return fail('archive-job', e.message || String(e)); }
  if (!a.archived && !a.replay) return fail('archive-job', 'archived=' + a.archived + ' replay=' + a.replay);

  // 9. Archive idempotent replay (or fresh archive on rerun after reopen)
  try { a2 = core._s16ArchiveJob(store, { command_id: 'S16-SMOKE-ARCHIVE-2', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Replay' }); } catch (e) { return fail('archive-job-idempotent', e.message || String(e)); }
  if (!a2.archived && !a2.replay) return fail('archive-job-idempotent', 'archived=' + a2.archived + ' replay=' + a2.replay);

  // 10. Reopen archived job (may be replay on second smoke run)
  try { reopen = core._s16ReopenArchivedJob(store, { command_id: 'S16-SMOKE-REOPEN', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Synthetic reopen' }); } catch (e) { return fail('reopen', e.message || String(e)); }
  if (!reopen.reopened) return fail('reopen', 'reopened=false');

  // 11. System tasks
  try { tasks = core._s16SystemTasks(store, { command_id: 'S16-SMOKE-SYS', actor: 'PERSON-s16-office' }); } catch (e) { return fail('system-tasks', e.message || String(e)); }
  if (tasks.tasks_created < 1 && tasks.tasks_reused < 1) return fail('system-tasks', 'no tasks created or reused');

  return {
    pass: true,
    detail: {
      health: h.overall,
      backup_checksum: b.checksum,
      backup_valid: v ? v.valid : 'skipped-replay',
      restore_blocked: r ? r.blocked : 'skipped-replay',
      old_eligible: eOld.eligible,
      recent_eligible: eRecent.eligible,
      opentask_eligible: eOpen.eligible,
      archived: a.archived,
      archive_id: a.archive_id,
      reopened: reopen.reopened,
      sys_tasks: tasks.tasks_created + tasks.tasks_reused,
      external_calls: 0
    }
  };
}

if (typeof module !== 'undefined') module.exports = { _s16FixtureRows, _s16Seed, _s16VerifyRow, _s16Smoke };
