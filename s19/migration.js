/* S19 migration, training, cutover preparation. Authority: RA01 §§8-10, 04 S19, docs/release-plan.md.
 * Read-only over S01-S18 operational data. No PROD changes. No external API calls.
 * Prepares S20 handoff — does not perform production cutover. */
'use strict';

const S19_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const S19_RELEASES = ['R1', 'R2', 'R3', 'R4'];

function _s19Now() { return new Date().toISOString(); }

/* --- Guard --- */

function _s19GuardStore(store) {
  if (!store.getSheetId || store.getSheetId() !== S19_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV')
    throw new Error('S19_REFUSED: exact DEV sheet/environment required');
}

/* --- 1. MIGRATION INVENTORY --- */

function _s19MigrationInventory() {
  return [
    // R1 Office
    { id: 'MIG-R1-01', release: 'R1', domain: 'Jobs', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'S18 R1 acceptance PASS', acceptance_deps: ['FND-01','JOB-04'], status: 'BLOCKED', blocker: 'S18 R1 not passed', rehearsal: true },
    { id: 'MIG-R1-02', release: 'R1', domain: 'Customers', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'Job migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R1-03', release: 'R1', domain: 'Tasks', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'Job migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R1-04', release: 'R1', domain: 'Booking state', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'Job migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R1-05', release: 'R1', domain: 'Planner/install dates', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'Job migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R1-06', release: 'R1', domain: 'Calls/Issues', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'Job migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R1-07', release: 'R1', domain: 'Cancellation state', strategy: 'reference_only', owner: 'Tanya', prerequisite: 'None', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: false },

    // R2 Materials/Scaffolding
    { id: 'MIG-R2-01', release: 'R2', domain: 'Materials/reservations', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'R1 migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R2-02', release: 'R2', domain: 'Orders', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'R1 migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R2-03', release: 'R2', domain: 'Stock state', strategy: 'external_reconciliation', owner: 'Tanya', prerequisite: 'Physical stock count', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R2-04', release: 'R2', domain: 'Scaffold bookings', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'R1 migration complete', acceptance_deps: ['BLK-05'], status: 'BLOCKED', blocker: 'Scaffolder contacts not configured', rehearsal: true },
    { id: 'MIG-R2-05', release: 'R2', domain: 'Calendar events', strategy: 'external_reconciliation', owner: 'Tanya', prerequisite: 'R1 migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },

    // R3 Installer Commissioning
    { id: 'MIG-R3-01', release: 'R3', domain: 'Commissioning submissions', strategy: 'reference_only', owner: 'Tanya', prerequisite: 'Commissioning amendment supplied', acceptance_deps: ['STG-12b'], status: 'BLOCKED', blocker: 'Commissioning templates not configured', rehearsal: false },
    { id: 'MIG-R3-02', release: 'R3', domain: 'JobEquipment', strategy: 'migrate_open', owner: 'Tanya', prerequisite: 'R1/R2 migration complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R3-03', release: 'R3', domain: 'Handover', strategy: 'reference_only', owner: 'Tanya', prerequisite: 'Existing handover complete', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: false },

    // R4 Finance/Reporting
    { id: 'MIG-R4-01', release: 'R4', domain: 'Invoice/payment state', strategy: 'external_reconciliation', owner: 'Tanya', prerequisite: 'Xero API configured', acceptance_deps: ['OUT-03','BLK-02'], status: 'BLOCKED', blocker: 'Xero API not configured', rehearsal: true },
    { id: 'MIG-R4-02', release: 'R4', domain: 'GHL progression', strategy: 'reference_only', owner: 'Tanya', prerequisite: 'GHL IDs configured', acceptance_deps: ['BLK-01'], status: 'BLOCKED', blocker: 'GHL pipeline IDs not configured', rehearsal: false },
    { id: 'MIG-R4-03', release: 'R4', domain: 'Archive eligibility', strategy: 'start_fresh', owner: 'Tanya', prerequisite: 'S18 R4 acceptance PASS', acceptance_deps: [], status: 'NOT_RUN', blocker: null, rehearsal: true },
    { id: 'MIG-R4-04', release: 'R4', domain: 'Financial snapshots', strategy: 'start_fresh', owner: 'Tanya', prerequisite: 'Opening balances configured', acceptance_deps: [], status: 'BLOCKED', blocker: 'Opening balances not configured', rehearsal: true }
  ];
}

/* --- 2. NO-DUAL-CREATOR ENFORCEMENT --- */

function _s19CreatorMap() {
  return [
    { function: 'Job creation (sold intake)', old_creator: 'Current Jotform/Calendar', new_creator: 'S05 Intake (FN-01)', cutover: 'Disable old Jotform→Calendar trigger; enable S05', release: 'R1', mode: 'Automated/Pilot/R1' },
    { function: 'Job creation (booking intake)', old_creator: 'Current Jotform/Calendar', new_creator: 'S05 Intake (FN-01)', cutover: 'Disable old booking trigger; enable S05 booking match', release: 'R1', mode: 'Automated/Pilot/R1' },
    { function: 'Task management', old_creator: 'Manual (Trello/whiteboard)', new_creator: 'S04/S06 Tasks (FN-01)', cutover: 'Migrate open tasks; start new task creation', release: 'R1', mode: 'Automated/Pilot/R1' },
    { function: 'Order creation', old_creator: 'Manual merchant email', new_creator: 'S07 Orders (FN-03)', cutover: 'Stop manual emails for migrated jobs; enable S07', release: 'R2', mode: 'Automated/Pilot/R2' },
    { function: 'Stock tracking', old_creator: 'Current stock sheet', new_creator: 'S08 StockMovements (FN-05)', cutover: 'Reconcile physical; start ledger', release: 'R2', mode: 'Automated/Pilot/R2' },
    { function: 'Scaffold bookings', old_creator: 'Current scaffold sheet', new_creator: 'S09 ScaffoldBookings (FN-04)', cutover: 'Migrate open bookings; start new bookings', release: 'R2', mode: 'Automated/Pilot/R2' },
    { function: 'Commissioning', old_creator: 'Current forms/email', new_creator: 'S12 Commissioning (FN-06/07)', cutover: 'Per job/package/form-version boundary', release: 'R3', mode: 'Automated/Pilot/R3' },
    { function: 'Invoice creation', old_creator: 'Current Xero Zap', new_creator: 'S13 InvoiceStages (FN-09)', cutover: 'Disable old Zap for migrated jobs; enable S13', release: 'R4', mode: 'Automated/Pilot/R4' }
  ];
}

/* --- 3. TRAINING PLAN --- */

function _s19TrainingPlan() {
  return [
    // R1 Tanya (9)
    { id: 'TRN-R1-01', release: 'R1', role: 'Tanya', module: 'Office Home / Today', objective: 'Navigate dashboard, understand overdue/today/soon tasks', rehearsal: 'Open office home, identify 3 overdue tasks', status: 'NOT_RUN' },
    { id: 'TRN-R1-02', release: 'R1', role: 'Tanya', module: 'Job search and detail', objective: 'Search by surname/postcode, open job overview', rehearsal: 'Search for a job, verify 12 sections', status: 'NOT_RUN' },
    { id: 'TRN-R1-03', release: 'R1', role: 'Tanya', module: 'Task completion', objective: 'Complete a task, verify audit history', rehearsal: 'Complete synthetic task, check history', status: 'NOT_RUN' },
    { id: 'TRN-R1-04', release: 'R1', role: 'Tanya', module: 'Booking approval', objective: 'Approve booking, verify stage advance', rehearsal: 'Approve synthetic booking', status: 'NOT_RUN' },
    { id: 'TRN-R1-05', release: 'R1', role: 'Tanya', module: 'Daily health check (SYS01)', objective: 'Run SYS01, identify stalled commits, uncertain outbox', rehearsal: 'Execute SYS01 task', status: 'NOT_RUN' },
    { id: 'TRN-R1-06', release: 'R1', role: 'Tanya', module: 'Cancellation workflow', objective: 'Cancel job, close cancellation, reinstate', rehearsal: 'Cancel synthetic job, reinstate', status: 'NOT_RUN' },
    { id: 'TRN-R1-07', release: 'R1', role: 'Tanya', module: 'Safety: Job ID usage', objective: 'Internal ID for references, human ID for display', rehearsal: 'Copy reference, verify ID types', status: 'NOT_RUN' },
    { id: 'TRN-R1-08', release: 'R1', role: 'Tanya', module: 'Safety: ReleaseModes', objective: 'Understand Disabled/Manual/Automated, pilot scope', rehearsal: 'Review ReleaseMode table', status: 'NOT_RUN' },
    { id: 'TRN-R1-09', release: 'R1', role: 'Tanya', module: 'Safety: recovery/health', objective: 'Recognise health alerts, stalled commits', rehearsal: 'Identify degraded health state', status: 'NOT_RUN' },

    // R1 Ben (4)
    { id: 'TRN-R1-10', release: 'R1', role: 'Ben', module: 'Deposit confirmation', objective: 'Confirm bank deposit, verify stage updates', rehearsal: 'Confirm synthetic deposit', status: 'NOT_RUN' },
    { id: 'TRN-R1-11', release: 'R1', role: 'Ben', module: 'Backup review', objective: 'Review backup manifest, verify checksums', rehearsal: 'Review latest backup manifest', status: 'NOT_RUN' },
    { id: 'TRN-R1-12', release: 'R1', role: 'Ben', module: 'Release decision', objective: 'Understand release criteria, pilot scope, signoff', rehearsal: 'Review S18 acceptance matrix', status: 'NOT_RUN' },
    { id: 'TRN-R1-13', release: 'R1', role: 'Ben', module: 'Safety: escalation', objective: 'Know escalation: duplicate invoices, uncertain actions, recovery', rehearsal: 'Identify duplicate-invoice scenario', status: 'NOT_RUN' },

    // R1 Hannah (2)
    { id: 'TRN-R1-14', release: 'R1', role: 'Hannah', module: 'Issues and variations', objective: 'Raise issues, track variations, link to jobs', rehearsal: 'Raise synthetic issue', status: 'NOT_RUN' },
    { id: 'TRN-R1-15', release: 'R1', role: 'Hannah', module: 'Phoenix evidence (R4)', objective: 'Understand Phoenix evidence workflow', rehearsal: 'Review Phoenix requirements', status: 'NOT_RUN' },

    // R2 Tanya (3)
    { id: 'TRN-R2-01', release: 'R2', role: 'Tanya', module: 'Ordering workflow', objective: 'Create orders, manage confirmations, revisions', rehearsal: 'Create synthetic order lifecycle', status: 'NOT_RUN' },
    { id: 'TRN-R2-02', release: 'R2', role: 'Tanya', module: 'Stock and picking', objective: 'Review availability, execute picks, understand ledger', rehearsal: 'Execute synthetic pick', status: 'NOT_RUN' },
    { id: 'TRN-R2-03', release: 'R2', role: 'Tanya', module: 'Scaffold management', objective: 'Book scaffold, confirm erect/strip', rehearsal: 'Create synthetic scaffold booking', status: 'NOT_RUN' },

    // R3 (3)
    { id: 'TRN-R3-01', release: 'R3', role: 'Installer', module: 'Commissioning submission', objective: 'Submit form, upload photos, handle corrections', rehearsal: 'Submit synthetic commissioning form', status: 'NOT_RUN' },
    { id: 'TRN-R3-02', release: 'R3', role: 'Installer', module: 'Offline/sync', objective: 'Work offline, sync when connected', rehearsal: 'Simulate offline submission, sync', status: 'NOT_RUN' },
    { id: 'TRN-R3-03', release: 'R3', role: 'Tanya', module: 'Commissioning review', objective: 'Review submissions, accept/reject, track corrections', rehearsal: 'Review synthetic submission', status: 'NOT_RUN' },

    // R4 Tanya (3)
    { id: 'TRN-R4-01', release: 'R4', role: 'Tanya', module: 'Invoice management', objective: 'Create stages, confirm payments, chase overdue', rehearsal: 'Process synthetic payment', status: 'NOT_RUN' },
    { id: 'TRN-R4-02', release: 'R4', role: 'Tanya', module: 'Financial reporting', objective: 'Generate summaries, reconcile, create snapshots', rehearsal: 'Generate synthetic report', status: 'NOT_RUN' },
    { id: 'TRN-R4-03', release: 'R4', role: 'Tanya', module: 'Archive workflow', objective: 'Check eligibility, archive, reopen', rehearsal: 'Archive synthetic job, reopen', status: 'NOT_RUN' }
  ];
}

/* --- 4. CUTOVER PLAN --- */

function _s19CutoverPlan() {
  return [
    // R1 (15 steps)
    { id: 'CUT-R1-01', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Verify S18 R1 acceptance PASS', owner: 'Developer', status: 'BLOCKED', blocker: 'S18 R1 BLOCKED' },
    { id: 'CUT-R1-02', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Reconcile open job IDs, stages, tasks', owner: 'Tanya', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-03', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Freeze current Jotform→Calendar creator', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-04', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Create DEV backup before cutover', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-05', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Complete Tanya R1 training (TRN-R1-01 through TRN-R1-09)', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-06', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Complete Ben R1 training (TRN-R1-10 through TRN-R1-13)', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-07', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Complete Hannah R1 training (TRN-R1-14, TRN-R1-15)', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-08', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Agree pilot job scope with Ben', owner: 'Ben', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-09', release: 'R1', phase: 'PRE', type: 's19_prep', step: 'Confirm fallback route is ready', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-10', release: 'R1', phase: 'CUTOVER', type: 's20_exec', step: 'Enable FN-01 Automated/Pilot/R1', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-11', release: 'R1', phase: 'CUTOVER', type: 's20_exec', step: 'Enable FN-17 Manual/Pilot/R1', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-12', release: 'R1', phase: 'CUTOVER', type: 's20_exec', step: 'Enable FN-20 Manual/Pilot/R1', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-13', release: 'R1', phase: 'CUTOVER', type: 's20_exec', step: 'Verify first pilot job end-to-end', owner: 'Tanya', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-14', release: 'R1', phase: 'POST', type: 's20_exec', step: 'Daily health check and reconciliation', owner: 'Tanya', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R1-15', release: 'R1', phase: 'FALLBACK', type: 's19_prep', step: 'Return FN-01/17/20 to Disabled; preserve records; continue manually', owner: 'Developer', status: 'NOT_RUN', blocker: null },

    // R2 (6 steps)
    { id: 'CUT-R2-01', release: 'R2', phase: 'PRE', type: 's19_prep', step: 'Verify S18 R2 acceptance PASS + R1 live', owner: 'Developer', status: 'BLOCKED', blocker: 'S18 R2 BLOCKED' },
    { id: 'CUT-R2-02', release: 'R2', phase: 'PRE', type: 's19_prep', step: 'Reconcile opening stock at covered locations', owner: 'Tanya', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R2-03', release: 'R2', phase: 'PRE', type: 's19_prep', step: 'Migrate open orders and scaffold bookings', owner: 'Tanya', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R2-04', release: 'R2', phase: 'CUTOVER', type: 's20_exec', step: 'Enable FN-03/04/05 Automated/Pilot/R2', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R2-05', release: 'R2', phase: 'CUTOVER', type: 's20_exec', step: 'Enable Calendar adapter FN-02', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R2-06', release: 'R2', phase: 'FALLBACK', type: 's19_prep', step: 'Return R2 functions to Disabled; keep R1 live', owner: 'Developer', status: 'NOT_RUN', blocker: null },

    // R3 (4 steps)
    { id: 'CUT-R3-01', release: 'R3', phase: 'PRE', type: 's19_prep', step: 'Verify S18 R3 acceptance PASS + R1/R2 live', owner: 'Developer', status: 'BLOCKED', blocker: 'S18 R3 BLOCKED' },
    { id: 'CUT-R3-02', release: 'R3', phase: 'PRE', type: 's19_prep', step: 'Commissioning amendment supplied and tested', owner: 'Developer', status: 'BLOCKED', blocker: 'Commissioning templates NOT_CONFIGURED' },
    { id: 'CUT-R3-03', release: 'R3', phase: 'CUTOVER', type: 's20_exec', step: 'Enable FN-06/07/08 Automated/Pilot/R3', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R3-04', release: 'R3', phase: 'FALLBACK', type: 's19_prep', step: 'Return R3 functions to Disabled; keep R1/R2 live', owner: 'Developer', status: 'NOT_RUN', blocker: null },

    // R4 (5 steps)
    { id: 'CUT-R4-01', release: 'R4', phase: 'PRE', type: 's19_prep', step: 'Verify S18 R4 acceptance PASS + R1-R3 live', owner: 'Developer', status: 'BLOCKED', blocker: 'S18 R4 BLOCKED' },
    { id: 'CUT-R4-02', release: 'R4', phase: 'PRE', type: 's19_prep', step: 'Xero API configured and tested', owner: 'Developer', status: 'BLOCKED', blocker: 'Xero NOT_CONFIGURED' },
    { id: 'CUT-R4-03', release: 'R4', phase: 'PRE', type: 's19_prep', step: 'Opening financial balances configured', owner: 'Tanya', status: 'BLOCKED', blocker: 'Not configured' },
    { id: 'CUT-R4-04', release: 'R4', phase: 'CUTOVER', type: 's20_exec', step: 'Enable FN-09/12/13 Automated/Pilot/R4', owner: 'Developer', status: 'NOT_RUN', blocker: null },
    { id: 'CUT-R4-05', release: 'R4', phase: 'FALLBACK', type: 's19_prep', step: 'Return R4 functions to Disabled; keep R1-R3 live', owner: 'Developer', status: 'NOT_RUN', blocker: null }
  ];
}

/* --- 5. S20 HANDOFF READINESS --- */

function _s19HandoffReadiness(s18Summary) {
  var results = {};
  var migration = _s19MigrationInventory();
  var training = _s19TrainingPlan();
  var cutover = _s19CutoverPlan();

  for (var r = 0; r < S19_RELEASES.length; r++) {
    var rel = S19_RELEASES[r];
    var s18rd = s18Summary.readiness[rel];

    // S18: all three statuses propagate
    var s18Blocked = s18rd.blockers.map(function (b) { return b.id; });
    var s18NotRun = s18rd.not_run_items ? s18rd.not_run_items.map(function (n) { return n.id; }) : [];
    var s18Failed = []; // no FAIL items currently

    // Migration for this release
    var relMig = migration.filter(function (m) { return m.release === rel; });
    var migBlocked = relMig.filter(function (m) { return m.status === 'BLOCKED'; }).map(function (m) { return m.id; });
    var migNotRun = relMig.filter(function (m) { return m.status === 'NOT_RUN'; }).map(function (m) { return m.id; });
    var migFailed = relMig.filter(function (m) { return m.status === 'FAIL'; }).map(function (m) { return m.id; });

    // Training for this release
    var relTrn = training.filter(function (t) { return t.release === rel; });
    var trnBlocked = relTrn.filter(function (t) { return t.status === 'BLOCKED'; }).map(function (t) { return t.id; });
    var trnNotRun = relTrn.filter(function (t) { return t.status === 'NOT_RUN'; }).map(function (t) { return t.id; });
    var trnFailed = relTrn.filter(function (t) { return t.status === 'FAIL'; }).map(function (t) { return t.id; });

    // Cutover: S19 preparation steps only (not S20 execution steps)
    var relCut = cutover.filter(function (c) { return c.release === rel; });
    var cutPrepBlocked = relCut.filter(function (c) { return c.type === 's19_prep' && c.status === 'BLOCKED'; }).map(function (c) { return c.id; });
    var cutPrepNotRun = relCut.filter(function (c) { return c.type === 's19_prep' && c.status === 'NOT_RUN'; }).map(function (c) { return c.id; });
    var cutPrepFailed = relCut.filter(function (c) { return c.type === 's19_prep' && c.status === 'FAIL'; }).map(function (c) { return c.id; });

    // S20 execution steps (do not block S19 handoff)
    var s20ExecSteps = relCut.filter(function (c) { return c.type === 's20_exec'; }).map(function (c) { return c.id; });

    var totalBlockers = s18Blocked.length + s18Failed.length + migBlocked.length + migFailed.length + trnBlocked.length + trnFailed.length + cutPrepBlocked.length + cutPrepFailed.length;
    var totalNotRun = s18NotRun.length + migNotRun.length + trnNotRun.length + cutPrepNotRun.length;

    var readiness;
    if (totalBlockers > 0) readiness = 'BLOCKED';
    else if (totalNotRun > 0) readiness = 'NOT_EVALUATED';
    else readiness = 'READY_FOR_S20';

    results[rel] = {
      release: rel,
      handoff_readiness: readiness,
      s18: { blocked: s18Blocked, not_run: s18NotRun, failed: s18Failed },
      migration: { total: relMig.length, blocked: migBlocked, not_run: migNotRun, failed: migFailed },
      training: { total: relTrn.length, blocked: trnBlocked, not_run: trnNotRun, failed: trnFailed },
      cutover_prep: { total: relCut.filter(function (c) { return c.type === 's19_prep'; }).length, blocked: cutPrepBlocked, not_run: cutPrepNotRun, failed: cutPrepFailed },
      cutover_s20_exec: { total: s20ExecSteps.length, steps: s20ExecSteps },
      total_blockers: totalBlockers,
      total_not_run: totalNotRun
    };
  }
  return results;
}

/* --- 6. FULL MIGRATION SUMMARY --- */

function _s19MigrationSummary(store, s18Summary) {
  _s19GuardStore(store);
  var inventory = _s19MigrationInventory();
  var training = _s19TrainingPlan();
  var cutover = _s19CutoverPlan();
  var creators = _s19CreatorMap();
  var handoff = _s19HandoffReadiness(s18Summary);

  // Derived role counts
  var roles = {};
  for (var i = 0; i < training.length; i++) {
    var t = training[i];
    if (!roles[t.role]) roles[t.role] = { total: 0, not_run: 0 };
    roles[t.role].total++;
    if (t.status === 'NOT_RUN') roles[t.role].not_run++;
  }

  return {
    generated_at: _s19Now(),
    environment: 'DEV',
    s18: {
      automated_total: s18Summary.automated.total,
      automated_pass: s18Summary.automated.pass,
      automated_blocked: s18Summary.automated.blocked,
      manual_total: s18Summary.manual.total,
      manual_blocked: s18Summary.manual.blocked
    },
    migration: {
      total_domains: inventory.length,
      blocked: inventory.filter(function (m) { return m.status === 'BLOCKED'; }).length,
      not_run: inventory.filter(function (m) { return m.status === 'NOT_RUN'; }).length,
      ready: inventory.filter(function (m) { return m.status === 'READY'; }).length
    },
    training: {
      total_modules: training.length,
      not_run: training.filter(function (t) { return t.status === 'NOT_RUN'; }).length,
      by_role: roles
    },
    cutover: {
      total_steps: cutover.length,
      s19_prep: cutover.filter(function (c) { return c.type === 's19_prep'; }).length,
      s20_exec: cutover.filter(function (c) { return c.type === 's20_exec'; }).length,
      blocked: cutover.filter(function (c) { return c.status === 'BLOCKED'; }).length
    },
    creators: {
      total_functions: creators.length,
      rule: 'No two systems may be authoritative creators for the same scope simultaneously.'
    },
    handoff: handoff,
    overall_r1: handoff.R1.handoff_readiness,
    overall_r2: handoff.R2.handoff_readiness,
    overall_r3: handoff.R3.handoff_readiness,
    overall_r4: handoff.R4.handoff_readiness
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    S19_DEV_SHEET_ID, S19_RELEASES,
    _s19GuardStore, _s19MigrationInventory, _s19CreatorMap,
    _s19TrainingPlan, _s19CutoverPlan,
    _s19HandoffReadiness, _s19MigrationSummary
  };
}
