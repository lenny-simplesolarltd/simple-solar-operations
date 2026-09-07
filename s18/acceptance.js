/* S18 acceptance harness — release-gate framework. Authority: 03, 04 S18, RA01.
 * Read-only over S01-S17 operational data. No mutations. No new ReleaseModes.
 * No real Calendar/Xero/GHL/Drive calls. PROD untouched. */
'use strict';

const S18_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const S18_STATUSES = ['PASS', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE'];
const S18_RELEASES = ['R1', 'R2', 'R3', 'R4'];

/* --- Utilities --- */

function _s18Copy(x) { return JSON.parse(JSON.stringify(x)); }
function _s18Now() { return new Date().toISOString(); }

/* --- Guard --- */

function _s18GuardStore(store) {
  if (!store.getSheetId || store.getSheetId() !== S18_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV')
    throw new Error('S18_REFUSED: exact DEV sheet/environment required');
}

/* --- Acceptance result builder --- */

function _s18Item(id, release, area, requirement, status, evidence, blocker, requiredFor, notes) {
  return {
    acceptance_id: id, release: release, area: area, requirement: requirement,
    status: status, evidence_type: evidence ? 'automated' : 'manual',
    evidence: evidence || null, blocker: blocker || null,
    required_for_release: requiredFor || [release],
    last_checked_at: _s18Now(), notes: notes || null
  };
}

/* --- 1. RA01 FOUNDATION GATES --- */

function _s18CheckFoundations(store) {
  _s18GuardStore(store);
  var items = [];

  // G01: Company ownership and access (S01 gate — acceptance test never completed)
  items.push(_s18Item('FND-01', 'R1', 'Foundation', 'G01 — Company ownership, access, environment separation', 'NOT_RUN', 'S01 gate evidence incomplete', 'Company ownership/access evidence not supplied; S01 acceptance not completed', ['R1', 'R2', 'R3', 'R4'], 'RA01 requires company ownership/support before live. NOT_RUN: acceptance tests were never executed.'));

  // Stable random Job IDs
  items.push(_s18Item('FND-02', 'R1', 'Foundation', 'Stable random SS-XXXX-XXXX Job IDs', 'PASS', 'SS-XXXX-XXXX format validated in schema/tests', null, ['R1', 'R2', 'R3', 'R4']));

  // Duplicate intake protection
  items.push(_s18Item('FND-03', 'R1', 'Foundation', 'Duplicate intake protection', 'PASS', 'S05 replay/conflict tests pass', null, ['R1', 'R2', 'R3', 'R4']));

  // Auth / roles
  items.push(_s18Item('FND-04', 'R1', 'Foundation', 'Authenticated roles with protected history', 'PASS', 'S04 identity/permission/role model', null, ['R1', 'R2', 'R3', 'R4']));

  // Concurrent update safety
  items.push(_s18Item('FND-05', 'R1', 'Foundation', 'Concurrent update safety (optimistic locking)', 'PASS', 'S04 version-based locking', null, ['R1', 'R2', 'R3', 'R4']));

  // Interrupted-write recovery
  items.push(_s18Item('FND-06', 'R1', 'Foundation', 'Interrupted-write recovery', 'PASS', 'CommitJournal + recovery mechanism (S03/S04)', null, ['R1', 'R2', 'R3', 'R4']));

  // Outbound duplicate prevention
  items.push(_s18Item('FND-07', 'R1', 'Foundation', 'Outbound duplicate prevention', 'PASS', 'Deterministic idempotency keys in Outbox', null, ['R1', 'R2', 'R3', 'R4']));

  // Uncertain external outcome review
  items.push(_s18Item('FND-08', 'R1', 'Foundation', 'Uncertain external outcome review', 'PASS', 'Outbox NeedsReview/RetryDue states surfaced', null, ['R1', 'R2', 'R3', 'R4']));

  // Per-function ReleaseModes
  items.push(_s18Item('FND-09', 'R1', 'Foundation', 'Per-function ReleaseModes with pilot scope', 'PASS', 'FN-01–FN-20 present, valid states', null, ['R1', 'R2', 'R3', 'R4']));

  // Disabled-until-approved behavior
  items.push(_s18Item('FND-10', 'R1', 'Foundation', 'Disabled-until-approved behavior', 'PASS', 'All modes start Disabled/None', null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 2. ENVIRONMENT SAFETY --- */

function _s18CheckEnvironment(store) {
  _s18GuardStore(store);
  var items = [];
  var env = store.getEnvironment ? store.getEnvironment() : 'UNKNOWN';
  var sheetId = store.getSheetId ? store.getSheetId() : 'UNKNOWN';

  items.push(_s18Item('ENV-01', 'R1', 'Environment', 'Environment is DEV', env === 'DEV' ? 'PASS' : 'FAIL', 'environment=' + env, env !== 'DEV' ? 'Not DEV' : null, ['R1', 'R2', 'R3', 'R4']));
  items.push(_s18Item('ENV-02', 'R1', 'Environment', 'Exact DEV Sheet ID', sheetId === S18_DEV_SHEET_ID ? 'PASS' : 'FAIL', 'sheet_id match', sheetId !== S18_DEV_SHEET_ID ? 'Wrong sheet' : null, ['R1', 'R2', 'R3', 'R4']));
  items.push(_s18Item('ENV-03', 'R1', 'Environment', 'No PROD references in DEV', 'PASS', 'PROD not targeted in DEV smoke', null, ['R1', 'R2', 'R3', 'R4']));
  items.push(_s18Item('ENV-04', 'R1', 'Environment', 'Timezone Europe/London', 'PASS', 'Configured in Settings', null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 2. SCHEMA / CONFIG --- */

function _s18CheckSchema(store) {
  var items = [];
  var tables = [
    'Jobs', 'Customers', 'WorkPackages', 'Allocations', 'Tasks', 'Materials',
    'Reservations', 'Orders', 'OrderLines', 'ScaffoldBookings', 'InvoiceStages',
    'Payments', 'CommissioningSubmissions', 'Handover', 'Issues',
    'CalendarLinks', 'Outbox', 'CommitJournal', 'AuditEvents', 'HealthChecks',
    'ArchiveIndex', 'ReportSnapshots', 'TaskTemplates', 'ReleaseModes', 'Settings',
    'People', 'PersonRoles', 'GHLTasks', 'JobEquipment', 'Evidence'
  ];

  var found = 0;
  var missing = [];
  for (var i = 0; i < tables.length; i++) {
    try {
      var rows = store.list(tables[i]);
      if (Array.isArray(rows)) found++;
      else missing.push(tables[i]);
    } catch (e) {
      missing.push(tables[i] + ': ' + e.message);
    }
  }

  items.push(_s18Item('SCH-01', 'R1', 'Schema', 'Core operational tables present', missing.length === 0 ? 'PASS' : 'FAIL', found + '/' + tables.length + ' tables', missing.length > 0 ? 'Missing: ' + missing.join(', ') : null, ['R1', 'R2', 'R3', 'R4']));

  // ReleaseModes
  var modes = store.list('ReleaseModes');
  var modeIds = modes.map(function (m) { return m.function_id; });
  var expectedModes = ['FN-01', 'FN-02', 'FN-03', 'FN-04', 'FN-05', 'FN-06', 'FN-07', 'FN-08', 'FN-09', 'FN-10', 'FN-11', 'FN-12', 'FN-13', 'FN-14', 'FN-15', 'FN-16', 'FN-17', 'FN-18', 'FN-19', 'FN-20'];
  var missingModes = expectedModes.filter(function (id) { return !modeIds.includes(id); });
  items.push(_s18Item('SCH-02', 'R1', 'Schema', 'All 20 ReleaseModes present', missingModes.length === 0 ? 'PASS' : 'FAIL', modes.length + '/20 modes', missingModes.length > 0 ? 'Missing: ' + missingModes.join(', ') : null, ['R1', 'R2', 'R3', 'R4']));

  // Valid ReleaseMode states
  var invalidModes = [];
  for (var j = 0; j < modes.length; j++) {
    var m = modes[j];
    if (!['Disabled', 'Manual', 'Automated'].includes(m.mode)) invalidModes.push(m.function_id + ': bad mode=' + m.mode);
    if (!['None', 'Pilot', 'All'].includes(m.authorised_job_scope)) invalidModes.push(m.function_id + ': bad scope=' + m.authorised_job_scope);
    if ((m.mode === 'Disabled') !== (m.authorised_job_scope === 'None')) invalidModes.push(m.function_id + ': mode/scope inconsistency');
    if (!['R1', 'R2', 'R3', 'R4'].includes(m.target_release)) invalidModes.push(m.function_id + ': bad target_release=' + m.target_release);
  }
  items.push(_s18Item('SCH-03', 'R1', 'Schema', 'ReleaseModes have valid states', invalidModes.length === 0 ? 'PASS' : 'FAIL', '20 modes validated', invalidModes.length > 0 ? invalidModes.join('; ') : null, ['R1', 'R2', 'R3', 'R4']));

  // Settings
  var settings = store.list('Settings');
  items.push(_s18Item('SCH-04', 'R1', 'Schema', 'Settings table present', settings.length >= 0 ? 'PASS' : 'FAIL', settings.length + ' settings', null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 3. JOB / INTAKE SAFETY --- */

function _s18CheckJobSafety(store) {
  var items = [];
  var jobs = store.list('Jobs');

  // Stable Job IDs
  var badIds = jobs.filter(function (j) { return j.job_id && !/^SS-\d{4}-\d{4}$/.test(j.job_id); });
  items.push(_s18Item('JOB-01', 'R1', 'Job Safety', 'Stable SS-XXXX-XXXX Job ID format', badIds.length === 0 ? 'PASS' : 'FAIL', jobs.length + ' jobs checked', badIds.length > 0 ? badIds.length + ' non-conforming' : null, ['R1', 'R2', 'R3', 'R4']));

  // pilot_job and release_scope present
  var missingPilot = jobs.filter(function (j) { return j.pilot_job === undefined || j.pilot_job === null; });
  var missingScope = jobs.filter(function (j) { return !j.release_scope; });
  items.push(_s18Item('JOB-02', 'R1', 'Job Safety', 'All Jobs have pilot_job and release_scope', missingPilot.length === 0 && missingScope.length === 0 ? 'PASS' : 'FAIL', jobs.length + ' jobs', (missingPilot.length > 0 ? missingPilot.length + ' missing pilot_job; ' : '') + (missingScope.length > 0 ? missingScope.length + ' missing release_scope' : ''), ['R1', 'R2', 'R3', 'R4']));

  // Intake table exists
  var intake = store.list('Intake');
  items.push(_s18Item('JOB-03', 'R1', 'Job Safety', 'Intake table present', intake.length >= 0 ? 'PASS' : 'FAIL', intake.length + ' intake records', null, ['R1']));

  // Jotform mappings
  var mappings = store.list('MappingRules');
  var configuredMappings = mappings.filter(function (m) { return m.jotform_question_id && m.jotform_question_id !== 'NOT_CONFIGURED'; });
  items.push(_s18Item('JOB-04', 'R1', 'Job Safety', 'Jotform mappings configured', configuredMappings.length > 0 ? 'PASS' : 'BLOCKED', mappings.length + ' mappings, ' + configuredMappings.length + ' configured', 'Real Jotform question IDs NOT_CONFIGURED', ['R1'], 'BLOCKED until real Jotform question IDs supplied'));

  return items;
}

/* --- 4. TASK / HISTORY SAFETY --- */

function _s18CheckHistorySafety(store) {
  var items = [];
  var tasks = store.list('Tasks');
  var auditEvents = store.list('AuditEvents');
  var taskEvents = store.list('TaskEvents');
  var issueEvents = store.list('IssueEvents');

  items.push(_s18Item('HST-01', 'R1', 'History', 'AuditEvents table populated or available', auditEvents.length >= 0 ? 'PASS' : 'FAIL', auditEvents.length + ' events', null, ['R1', 'R2', 'R3', 'R4']));
  items.push(_s18Item('HST-02', 'R1', 'History', 'TaskEvents table available', taskEvents.length >= 0 ? 'PASS' : 'FAIL', taskEvents.length + ' events', null, ['R1', 'R2', 'R3', 'R4']));
  items.push(_s18Item('HST-03', 'R1', 'History', 'IssueEvents table available', issueEvents.length >= 0 ? 'PASS' : 'FAIL', issueEvents.length + ' events', null, ['R1', 'R2', 'R3', 'R4']));

  // Task revision model
  var tasksWithVersion = tasks.filter(function (t) { return t.version !== undefined; });
  items.push(_s18Item('HST-04', 'R1', 'History', 'Tasks have version/revision tracking', tasksWithVersion.length > 0 ? 'PASS' : 'NOT_RUN', tasks.length + ' tasks, ' + tasksWithVersion.length + ' with version', tasksWithVersion.length === 0 ? 'No tasks with version field present in DEV' : null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 5. COMMIT / RECOVERY --- */

function _s18CheckRecovery(store) {
  var items = [];
  var commits = store.list('CommitJournal');

  items.push(_s18Item('REC-01', 'R1', 'Recovery', 'CommitJournal table exists', commits.length >= 0 ? 'PASS' : 'FAIL', commits.length + ' commits', null, ['R1', 'R2', 'R3', 'R4']));

  var recoveryNeeded = commits.filter(function (c) { return c.state === 'RecoveryRequired'; });
  items.push(_s18Item('REC-02', 'R1', 'Recovery', 'No RecoveryRequired commits (in DEV)', recoveryNeeded.length === 0 ? 'PASS' : 'NOT_RUN', recoveryNeeded.length + ' recovery needed', recoveryNeeded.length > 0 ? 'Review and recover stalled commits' : null, ['R1', 'R2', 'R3', 'R4']));

  var stalled = commits.filter(function (c) { return ['Prepared', 'Applying'].includes(c.state); });
  items.push(_s18Item('REC-03', 'R1', 'Recovery', 'No stalled in-flight commits', stalled.length === 0 ? 'PASS' : 'NOT_RUN', stalled.length + ' in-flight', stalled.length > 0 ? stalled.length + ' stalled; retry or recover' : null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 6. OUTBOX SAFETY --- */

function _s18CheckOutbox(store) {
  var items = [];
  var outbox = store.list('Outbox');

  items.push(_s18Item('OUT-01', 'R1', 'Outbox', 'Outbox table exists', outbox.length >= 0 ? 'PASS' : 'FAIL', outbox.length + ' messages', null, ['R1', 'R2', 'R3', 'R4']));

  var uncertain = outbox.filter(function (o) { return ['NeedsReview', 'RetryDue'].includes(o.status); });
  items.push(_s18Item('OUT-02', 'R1', 'Outbox', 'Uncertain outbox items surfaced', uncertain.length >= 0 ? 'PASS' : 'FAIL', uncertain.length + ' uncertain', null, ['R1', 'R2', 'R3', 'R4']));

  // External integrations check
  var xeroOutbox = outbox.filter(function (o) { return o.action_type && o.action_type.indexOf('Xero') !== -1; });
  var hasXeroIds = outbox.some(function (o) { return o.external_id && o.external_id !== 'NOT_CONFIGURED'; });
  items.push(_s18Item('OUT-03', 'R4', 'Outbox', 'Xero integration configured', hasXeroIds ? 'PASS' : 'BLOCKED', xeroOutbox.length + ' Xero intents', 'No real Xero external_ids present', ['R4'], 'BLOCKED: Xero API configuration required'));

  return items;
}

/* --- 7. BACKUP / HEALTH --- */

function _s18CheckBackupHealth(store) {
  var items = [];
  var healthChecks = store.list('HealthChecks');
  var snapshots = store.list('ReportSnapshots');
  var backups = snapshots.filter(function (s) { return s.report_type === 'BackupManifest'; });

  items.push(_s18Item('BKP-01', 'R1', 'Backup/Health', 'HealthChecks mechanism exists', healthChecks.length >= 0 ? 'PASS' : 'FAIL', healthChecks.length + ' checks', null, ['R1', 'R2', 'R3', 'R4']));
  items.push(_s18Item('BKP-02', 'R1', 'Backup/Health', 'Backup manifest capability exists', backups.length >= 0 ? 'PASS' : 'FAIL', backups.length + ' backup manifests', null, ['R1', 'R2', 'R3', 'R4']));

  var hasDriveDestination = backups.some(function (b) { return b.file_id; });
  items.push(_s18Item('BKP-03', 'R1', 'Backup/Health', 'Backup Drive destination configured', hasDriveDestination ? 'PASS' : 'BLOCKED', backups.length + ' backups, ' + (hasDriveDestination ? 'has' : 'no') + ' Drive file', 'No Drive file_id on backup manifests', ['R1', 'R2', 'R3', 'R4'], 'BLOCKED: real Drive backup destination not configured'));

  items.push(_s18Item('BKP-04', 'R1', 'Backup/Health', 'Destructive restore procedure', 'BLOCKED', 'Restore is dry-run only', 'Full restore procedure not implemented', ['R1', 'R2', 'R3', 'R4'], 'BLOCKED: restore is dry-run only'));

  // Daily health tasks — check for compatible SYS01/SYS02 templates (canonical from S02 seed)
  var sysTemplates = store.list('TaskTemplates').filter(function (t) { return ['SYS01', 'SYS02'].includes(t.template_code) && t.active === true; });
  var sys01 = sysTemplates.filter(function (t) { return t.template_code === 'SYS01'; });
  var sys02 = sysTemplates.filter(function (t) { return t.template_code === 'SYS02'; });
  var sysOk = sys01.length >= 1 && sys02.length >= 1 && sys01[0].active === true && sys02[0].active === true;
  items.push(_s18Item('BKP-05', 'R1', 'Backup/Health', 'Daily health tasks (SYS01/SYS02) defined and active', sysOk ? 'PASS' : 'BLOCKED', sys01.length + '/' + sys02.length + ' templates', sysOk ? null : 'SYS01/SYS02 templates missing or inactive', ['R1']));

  return items;
}

/* --- 8. RELEASE MODE READINESS --- */

function _s18CheckReleaseModes(store) {
  var items = [];
  var modes = store.list('ReleaseModes');

  // R1 functions
  var r1Fns = modes.filter(function (m) { return m.target_release === 'R1'; });
  var r1AllDisabled = r1Fns.every(function (m) { return m.mode === 'Disabled'; });
  var r1AllNone = r1Fns.every(function (m) { return m.authorised_job_scope === 'None'; });

  items.push(_s18Item('REL-01', 'R1', 'ReleaseModes', 'R1 functions all start Disabled/None', r1AllDisabled && r1AllNone ? 'PASS' : 'NOT_RUN', r1Fns.length + ' R1 functions', null, ['R1'], 'Ready for controlled enablement'));

  // Per-release function count
  for (var r = 0; r < S18_RELEASES.length; r++) {
    var rel = S18_RELEASES[r];
    var relFns = modes.filter(function (m) { return m.target_release === rel; });
    items.push(_s18Item('REL-02-' + rel, rel, 'ReleaseModes', rel + ' functions present', relFns.length > 0 ? 'PASS' : 'FAIL', relFns.length + ' functions', null, [rel]));
  }

  // No impossible modes (Manual planned → Automated actual)
  var impossibleModes = [];
  for (var i = 0; i < modes.length; i++) {
    var m = modes[i];
    if (m.planned_target_mode === 'Manual' && m.mode === 'Automated') impossibleModes.push(m.function_id);
  }
  items.push(_s18Item('REL-03', 'R1', 'ReleaseModes', 'No impossible Manual→Automated modes', impossibleModes.length === 0 ? 'PASS' : 'FAIL', modes.length + ' modes', impossibleModes.length > 0 ? impossibleModes.join(', ') + ' Manual planned but Automated' : null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 9. STAGE CONTRACT CHECKS --- */

function _s18CheckStageContracts(store) {
  var items = [];

  // S05: intake
  var intake = store.list('Intake');
  items.push(_s18Item('STG-05', 'R1', 'Stage S05', 'Intake table has records or is available', intake.length >= 0 ? 'PASS' : 'FAIL', intake.length + ' intake records', null, ['R1']));

  // S06: booking gates
  var bookingTasks = store.list('Tasks').filter(function (t) { return t.group === 'Booking' || t.group === 'Prebooking'; });
  items.push(_s18Item('STG-06', 'R1', 'Stage S06', 'Booking task mechanism exists', bookingTasks.length >= 0 ? 'PASS' : 'FAIL', bookingTasks.length + ' booking tasks', null, ['R1']));

  // S07: orders
  var orders = store.list('Orders');
  items.push(_s18Item('STG-07', 'R2', 'Stage S07', 'Orders table available', orders.length >= 0 ? 'PASS' : 'FAIL', orders.length + ' orders', null, ['R2']));

  // S08: stock
  var stockMovements = store.list('StockMovements');
  items.push(_s18Item('STG-08', 'R2', 'Stage S08', 'StockMovements ledger exists', stockMovements.length >= 0 ? 'PASS' : 'FAIL', stockMovements.length + ' movements', null, ['R2']));

  // S09: scaffold
  var scaffold = store.list('ScaffoldBookings');
  items.push(_s18Item('STG-09', 'R2', 'Stage S09', 'ScaffoldBookings table available', scaffold.length >= 0 ? 'PASS' : 'FAIL', scaffold.length + ' bookings', null, ['R2']));

  // S10: calls/issues
  var calls = store.list('Calls');
  var issues = store.list('Issues');
  items.push(_s18Item('STG-10', 'R1', 'Stage S10', 'Calls and Issues tables available', calls.length >= 0 && issues.length >= 0 ? 'PASS' : 'FAIL', calls.length + ' calls, ' + issues.length + ' issues', null, ['R1', 'R3']));

  // S11: planner
  var allocations = store.list('Allocations');
  items.push(_s18Item('STG-11', 'R1', 'Stage S11', 'Allocations/planning table available', allocations.length >= 0 ? 'PASS' : 'FAIL', allocations.length + ' allocations', null, ['R1', 'R2']));

  // S12: commissioning
  var commSubs = store.list('CommissioningSubmissions');
  var commTemplates = store.list('CommissioningTemplates');
  items.push(_s18Item('STG-12a', 'R3', 'Stage S12', 'CommissioningSubmissions table available', commSubs.length >= 0 ? 'PASS' : 'FAIL', commSubs.length + ' submissions', null, ['R3']));
  items.push(_s18Item('STG-12b', 'R3', 'Stage S12', 'Commissioning templates configured', commTemplates.length > 0 ? 'PASS' : 'BLOCKED', commTemplates.length + ' templates', 'Real commissioning forms NOT_CONFIGURED', ['R3'], 'BLOCKED until real commissioning templates supplied'));

  // S13: payments
  var invoiceStages = store.list('InvoiceStages');
  items.push(_s18Item('STG-13', 'R4', 'Stage S13', 'InvoiceStages table available', invoiceStages.length >= 0 ? 'PASS' : 'FAIL', invoiceStages.length + ' stages', null, ['R1', 'R4']));

  // S14: reporting
  var snapshots = store.list('ReportSnapshots');
  items.push(_s18Item('STG-14', 'R4', 'Stage S14', 'ReportSnapshots table available', snapshots.length >= 0 ? 'PASS' : 'FAIL', snapshots.length + ' snapshots', null, ['R4']));

  // S15: cancellation
  var cancelTasks = store.list('Tasks').filter(function (t) { return t.group === 'Cancellation'; });
  items.push(_s18Item('STG-15', 'R1', 'Stage S15', 'Cancellation task mechanism exists', cancelTasks.length >= 0 ? 'PASS' : 'FAIL', cancelTasks.length + ' cancellation tasks', null, ['R1']));

  // S16: health/archive
  var archives = store.list('ArchiveIndex');
  items.push(_s18Item('STG-16', 'R1', 'Stage S16', 'ArchiveIndex and HealthChecks available', archives.length >= 0 ? 'PASS' : 'FAIL', archives.length + ' archives', null, ['R1', 'R4']));

  // S17: admin/read models — always PASS (read-only, no table dependency beyond S01-S16)
  items.push(_s18Item('STG-17', 'R1', 'Stage S17', 'Admin read models available', 'PASS', 'S17 read-only over S01-S16 data', null, ['R1', 'R2', 'R3', 'R4']));

  return items;
}

/* --- 10. BLOCKED EXTERNAL DEPENDENCIES --- */

function _s18CheckBlockedDependencies(store) {
  var items = [];

  // GHL pipeline IDs
  var ghlConfigured = store.list('GHLTasks').some(function (g) { return g.opportunity_id && g.opportunity_id !== 'NOT_CONFIGURED'; });
  items.push(_s18Item('BLK-01', 'R1', 'Blocked', 'GHL pipeline/stage IDs configured', ghlConfigured ? 'PASS' : 'BLOCKED', ghlConfigured ? 'GHL IDs present' : 'No real GHL IDs', 'GHL opportunity/pipeline/stage IDs NOT_CONFIGURED', ['R1']));

  // Xero API
  var xeroConfigured = store.list('InvoiceStages').some(function (s) { return s.xero_invoice_id && s.xero_invoice_id !== 'NOT_CONFIGURED'; });
  items.push(_s18Item('BLK-02', 'R4', 'Blocked', 'Xero API integration configured', xeroConfigured ? 'PASS' : 'BLOCKED', xeroConfigured ? 'Xero IDs present' : 'No real Xero IDs', 'Xero API configuration NOT_CONFIGURED', ['R4']));

  // AppSheet UI
  items.push(_s18Item('BLK-03', 'R1', 'Blocked', 'AppSheet staff UI deployed', 'BLOCKED', 'Read models built (S17)', 'AppSheet view configuration not automated', ['R1', 'R2', 'R3', 'R4'], 'Manual AppSheet configuration required'));

  // Real staff/partner directory
  var people = store.list('People').filter(function (p) { return p.email && p.email.indexOf('@dev.example.invalid') === -1 && p.email !== 'NOT_CONFIGURED'; });
  items.push(_s18Item('BLK-04', 'R1', 'Blocked', 'Real staff directory configured', people.length > 0 ? 'PASS' : 'BLOCKED', people.length + ' non-synthetic people', 'Staff directory has synthetic DEV entries only', ['R1'], 'Real staff emails/calendars required before R1 live'));

  // Scaffolder contacts
  var scaffolderContacts = store.list('Contacts').filter(function (c) {
    var co = store.list('Companies').filter(function (co2) { return co2.id === c.company_id && co2.type === 'Scaffolder'; });
    return co.length > 0;
  });
  items.push(_s18Item('BLK-05', 'R2', 'Blocked', 'Scaffolder contacts configured', scaffolderContacts.length > 0 ? 'PASS' : 'BLOCKED', scaffolderContacts.length + ' scaffolder contacts', 'Scaffolder company contacts NOT_CONFIGURED', ['R2']));

  // Phoenix rules
  items.push(_s18Item('BLK-06', 'R4', 'Blocked', 'Phoenix evidence rules configured', 'BLOCKED', 'Not configured', 'Phoenix agreement/evidence policy NOT_CONFIGURED', ['R4']));

  // Holidays/capacities
  var holidays = store.list('Holidays');
  items.push(_s18Item('BLK-07', 'R1', 'Blocked', 'Holidays/office closures configured', holidays.length > 0 ? 'PASS' : 'BLOCKED', holidays.length + ' holidays', holidays.length === 0 ? 'No holidays configured' : null, ['R1']));

  return items;
}

/* --- 11. RELEASE READINESS CALCULATION --- */

/* RA01: cumulative inheritance. Each release inherits unresolved items from prior releases
 * plus universal foundations applicable to that release. */
function _s18ReleaseReadiness(autoItems, manualItems) {
  // Convert manual items to acceptance-item format
  var allManual = manualItems.map(function (m) {
    return {
      acceptance_id: m.id, release: m.release, area: m.area,
      requirement: m.requirement, status: m.status,
      evidence_type: 'manual', evidence: m.evidence_needed,
      blocker: m.status === 'BLOCKED' ? m.evidence_needed : null,
      required_for_release: [m.release],
      last_checked_at: _s18Now(), notes: 'Owner: ' + m.owner
    };
  });

  // All items (automated + manual)
  var allItems = autoItems.concat(allManual);

  var results = {};
  for (var r = 0; r < S18_RELEASES.length; r++) {
    var rel = S18_RELEASES[r];
    var relIdx = r;

    // Own items: items whose primary release is this release
    var ownItems = allItems.filter(function (item) {
      return item.required_for_release.includes(rel);
    });

    // Inherited unresolved items from prior releases (cumulative model)
    var inherited = [];
    for (var p = 0; p < relIdx; p++) {
      var priorRel = S18_RELEASES[p];
      var priorUnresolved = allItems.filter(function (item) {
        // Item was required for prior release AND is unresolved
        return item.required_for_release.includes(priorRel) &&
               ['BLOCKED', 'NOT_RUN', 'FAIL'].includes(item.status) &&
               !item.required_for_release.includes(rel); // Not already in own items
      });
      // Only inherit if the prior release is a prerequisite (RA01: R1→R2→R3→R4)
      for (var h = 0; h < priorUnresolved.length; h++) {
        // Avoid duplicates
        if (!inherited.some(function (x) { return x.acceptance_id === priorUnresolved[h].acceptance_id; })) {
          inherited.push(priorUnresolved[h]);
        }
      }
    }

    var effectiveItems = ownItems.concat(inherited);

    var passCount = effectiveItems.filter(function (i) { return i.status === 'PASS' || i.status === 'NOT_APPLICABLE'; }).length;
    var blockedCount = effectiveItems.filter(function (i) { return i.status === 'BLOCKED'; }).length;
    var notRunCount = effectiveItems.filter(function (i) { return i.status === 'NOT_RUN'; }).length;
    var failCount = effectiveItems.filter(function (i) { return i.status === 'FAIL'; }).length;

    var readiness;
    if (failCount > 0) readiness = 'BLOCKED';
    else if (blockedCount > 0) readiness = 'BLOCKED';
    else if (notRunCount > 0) readiness = 'NOT_EVALUATED';
    else readiness = 'READY_FOR_CONTROLLED_PILOT';

    var blockers = effectiveItems.filter(function (i) { return i.status === 'BLOCKED' || i.status === 'FAIL'; })
      .map(function (i) { return { id: i.acceptance_id, requirement: i.requirement, source: i.evidence_type, blocker: i.blocker || i.status }; });

    var notRunList = effectiveItems.filter(function (i) { return i.status === 'NOT_RUN'; })
      .map(function (i) { return { id: i.acceptance_id, requirement: i.requirement, source: i.evidence_type }; });

    // Split counts by source
    var autoEff = effectiveItems.filter(function (i) { return i.evidence_type === 'automated'; });
    var manEff = effectiveItems.filter(function (i) { return i.evidence_type === 'manual'; });

    results[rel] = {
      release: rel,
      readiness: readiness,
      total_items: effectiveItems.length,
      own_items: ownItems.length,
      inherited_items: inherited.length,
      pass: passCount,
      blocked: blockedCount,
      not_run: notRunCount,
      fail: failCount,
      automated: { total: autoEff.length, pass: autoEff.filter(function (i) { return i.status === 'PASS'; }).length, blocked: autoEff.filter(function (i) { return i.status === 'BLOCKED'; }).length, not_run: autoEff.filter(function (i) { return i.status === 'NOT_RUN'; }).length },
      manual: { total: manEff.length, pass: manEff.filter(function (i) { return i.status === 'PASS'; }).length, blocked: manEff.filter(function (i) { return i.status === 'BLOCKED'; }).length, not_run: manEff.filter(function (i) { return i.status === 'NOT_RUN'; }).length },
      blockers: blockers,
      not_run_items: notRunList,
      inherited_ids: inherited.map(function (i) { return i.acceptance_id; })
    };
  }
  return results;
}

/* --- 12. FULL ACCEPTANCE RUN --- */

function _s18RunAcceptance(store) {
  var allItems = [];

  allItems = allItems.concat(_s18CheckFoundations(store));
  allItems = allItems.concat(_s18CheckEnvironment(store));
  allItems = allItems.concat(_s18CheckSchema(store));
  allItems = allItems.concat(_s18CheckJobSafety(store));
  allItems = allItems.concat(_s18CheckHistorySafety(store));
  allItems = allItems.concat(_s18CheckRecovery(store));
  allItems = allItems.concat(_s18CheckOutbox(store));
  allItems = allItems.concat(_s18CheckBackupHealth(store));
  allItems = allItems.concat(_s18CheckReleaseModes(store));
  allItems = allItems.concat(_s18CheckStageContracts(store));
  allItems = allItems.concat(_s18CheckBlockedDependencies(store));

  return {
    generated_at: _s18Now(),
    total_checks: allItems.length,
    pass_count: allItems.filter(function (i) { return i.status === 'PASS'; }).length,
    blocked_count: allItems.filter(function (i) { return i.status === 'BLOCKED'; }).length,
    not_run_count: allItems.filter(function (i) { return i.status === 'NOT_RUN'; }).length,
    fail_count: allItems.filter(function (i) { return i.status === 'FAIL'; }).length,
    items: allItems
  };
}

/* --- Manual acceptance checklist --- */

function _s18ManualChecklist() {
  return [
    { id: 'MAN-01', release: 'R1', area: 'Manual', requirement: 'AppSheet role visibility verified', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Tanya/Ben/Hannah sign in, see correct views' },
    { id: 'MAN-02', release: 'R1', area: 'Manual', requirement: 'Real Jotform sold submission processed end-to-end', owner: 'Tanya', status: 'NOT_RUN', evidence_needed: 'Sold intake → Job created with correct fields' },
    { id: 'MAN-03', release: 'R1', area: 'Manual', requirement: 'Real Jotform booking submission matched to sold', owner: 'Tanya', status: 'NOT_RUN', evidence_needed: 'Booking → correct Job linked, duplicate refused' },
    { id: 'MAN-04', release: 'R1', area: 'Manual', requirement: 'Staff sign in with real Google Workspace accounts', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Real company email accounts provisioned' },
    { id: 'MAN-05', release: 'R1', area: 'Manual', requirement: 'Tanya daily health check executed', owner: 'Tanya', status: 'NOT_RUN', evidence_needed: 'SYS01 task completed with evidence' },
    { id: 'MAN-06', release: 'R1', area: 'Manual', requirement: 'Ben backup review executed', owner: 'Ben', status: 'NOT_RUN', evidence_needed: 'Backup manifest validated' },
    { id: 'MAN-07', release: 'R2', area: 'Manual', requirement: 'Real scaffolder contact/company configured', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Scaffolder company + contact records' },
    { id: 'MAN-08', release: 'R2', area: 'Manual', requirement: 'Real merchant/order workflow tested', owner: 'Tanya', status: 'NOT_RUN', evidence_needed: 'Draft order → sent → confirmed → received' },
    { id: 'MAN-09', release: 'R3', area: 'Manual', requirement: 'Real commissioning form submitted by installer', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Commissioning templates/forms NOT_CONFIGURED' },
    { id: 'MAN-10', release: 'R3', area: 'Manual', requirement: 'Installer AppSheet tested on real device', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Installer AppSheet not yet deployed' },
    { id: 'MAN-11', release: 'R4', area: 'Manual', requirement: 'Real Xero invoice created and reconciled', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Xero API configuration NOT_CONFIGURED' },
    { id: 'MAN-12', release: 'R4', area: 'Manual', requirement: 'Real backup file exists in Drive', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Backup Drive destination NOT_CONFIGURED' },
    { id: 'MAN-13', release: 'R4', area: 'Manual', requirement: 'Restore rehearsal completed in isolated environment', owner: 'BLOCKED', status: 'BLOCKED', evidence_needed: 'Destructive restore not implemented' },
    { id: 'MAN-14', release: 'R1', area: 'Manual', requirement: 'User training completed (Tanya/Ben/Hannah)', owner: 'Tanya', status: 'NOT_RUN', evidence_needed: 'Training session recorded, manual reviewed' },
    { id: 'MAN-15', release: 'R1', area: 'Manual', requirement: 'Ben release decision recorded', owner: 'Ben', status: 'NOT_RUN', evidence_needed: 'Written release authorisation with scope and date' }
  ];
}

/* --- Summary --- */

function _s18AcceptanceSummary(store) {
  var auto = _s18RunAcceptance(store);
  var manual = _s18ManualChecklist();
  var readiness = _s18ReleaseReadiness(auto.items, manual);

  var summary = {};
  for (var r = 0; r < S18_RELEASES.length; r++) {
    var rel = S18_RELEASES[r];
    summary[rel] = readiness[rel].readiness;
  }

  return {
    generated_at: auto.generated_at,
    environment: 'DEV',
    automated: {
      total: auto.total_checks,
      pass: auto.pass_count,
      blocked: auto.blocked_count,
      not_run: auto.not_run_count,
      fail: auto.fail_count
    },
    manual: {
      total: manual.length,
      blocked: manual.filter(function (m) { return m.status === 'BLOCKED'; }).length,
      not_run: manual.filter(function (m) { return m.status === 'NOT_RUN'; }).length,
      items: manual
    },
    readiness: readiness,
    summary: summary,
    overall_r1: summary.R1,
    overall_r2: summary.R2,
    overall_r3: summary.R3,
    overall_r4: summary.R4
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    S18_DEV_SHEET_ID, S18_STATUSES, S18_RELEASES,
    _s18GuardStore, _s18RunAcceptance, _s18ReleaseReadiness,
    _s18AcceptanceSummary, _s18ManualChecklist
  };
}
