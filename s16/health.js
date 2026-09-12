/* S16 health, backup, archive, restore. Authority: 01 §13, 02 §§17-18, 04 S16, RA01.
 * FN-14 (R1 Automated): health monitoring + backup manifest.
 * FN-16 (R1 Manual): daily health review tasks.
 * FN-13 (R4 Automated): archive eligibility + archive action + reopen.
 * DEV-only Drive backup artifact when S01_CONFIG.backupFolderId is set (DriveApp).
 * No Calendar/Xero/GHL calls. No destructive restore. No PROD Drive writes.
 * Durable plans use canonical CommitJournal/AuditEvents. */
'use strict';

const S16_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const S16_FUNCTIONS = { 'FN-13': ['R4', 'Automated'], 'FN-14': ['R1', 'Automated'], 'FN-16': ['R1', 'Manual'] };
const S16_ENABLED = ['FN-13', 'FN-14', 'FN-16'];
const S16_ARCHIVE_MONTHS = 6;

/* --- Utilities --- */

function _s16Copy(x) { return JSON.parse(JSON.stringify(x)); }
function _s16Text(x) { return typeof x === 'string' && x.trim().length > 0; }
function _s16IsTrue(value) { return value === true || value === 'TRUE' || value === 'true' || value === 1; }
function _s16Date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('S16_DATE_INVALID');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  var text = String(value).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m) throw new Error('S16_DATE_INVALID');
  var iso = m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(iso + 'T12:00:00Z');
  if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return iso;
  throw new Error('S16_DATE_INVALID');
}
/* Normalize Sheet Date / ISO values for compare + hashing. Prefer totals_json strings for checksums. */
function _s16Timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('S16_DATE_INVALID');
    return value.toISOString();
  }
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    var d = new Date(text);
    if (isNaN(d.getTime())) throw new Error('S16_DATE_INVALID');
    return d.toISOString();
  }
  return text;
}
function _s16Now() { return new Date().toISOString(); }
function _s16Hash(obj) {
  var json = JSON.stringify(obj);
  var h = 0;
  for (var i = 0; i < json.length; i++) { h = ((h << 5) - h + json.charCodeAt(i)) | 0; }
  return 'S16-' + (h >>> 0).toString(16).padStart(8, '0');
}

/* --- Month arithmetic for archive --- */

function _s16AddMonths(dateStr, months) {
  var d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
function _s16MonthsBetween(a, b) {
  var aa = new Date(a + 'T12:00:00Z'), bb = new Date(b + 'T12:00:00Z');
  return (bb.getUTCFullYear() - aa.getUTCFullYear()) * 12 + (bb.getUTCMonth() - aa.getUTCMonth());
}

/* --- Guard + scope --- */

function _s16GuardStore(store) {
  if (!store.getSheetId || store.getSheetId() !== S16_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV')
    throw new Error('S16_REFUSED: exact DEV sheet/environment required');
}
function _s16ModesSnapshot(store) {
  var result = {};
  for (var id in S16_FUNCTIONS) {
    if (!S16_FUNCTIONS.hasOwnProperty(id)) continue;
    var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === id; });
    var def = S16_FUNCTIONS[id];
    if (rows.length !== 1 || rows[0].target_release !== def[0] || !['Disabled', 'Manual', 'Automated'].includes(rows[0].mode) || !['None', 'Pilot', 'All'].includes(rows[0].authorised_job_scope))
      throw new Error('S16_REFUSED: ReleaseMode ' + id);
    var r = rows[0];
    if ((r.mode === 'Disabled') !== (r.authorised_job_scope === 'None') || (def[1] === 'Manual' && r.mode === 'Automated'))
      throw new Error('S16_REFUSED: unexpected mode ' + id);
    result[id] = { mode: r.mode, scope: r.authorised_job_scope, target_release: r.target_release };
  }
  return result;
}
function _s16Scope(store) {
  _s16GuardStore(store);
  var modes = _s16ModesSnapshot(store);
  for (var i = 0; i < S16_ENABLED.length; i++) {
    var id = S16_ENABLED[i];
    if (modes[id].mode !== S16_FUNCTIONS[id][1] || modes[id].scope !== 'Pilot')
      throw new Error('S16_REFUSED: ' + id + ' pilot mode required (got mode=' + modes[id].mode + ' scope=' + modes[id].scope + ' need mode=' + S16_FUNCTIONS[id][1] + ' scope=Pilot)');
  }
  return modes;
}

/* Heartbeat functions live in s16/heartbeat.js: shared global scope in Apps Script, module in Node. */
function _s16HeartbeatModule() {
  if (typeof _s16HeartbeatStatus === 'function') return { _s16HeartbeatStatus: _s16HeartbeatStatus };
  return require('./heartbeat.js');
}

/* --- 1. HEALTH STATUS --- */

function _s16HealthStatus(store) {
  var modes = _s16Scope(store);
  var now = _s16Now();
  var issues = [];
  var warnings = [];

  // Stalled CommitJournal rows
  var stalled = store.list('CommitJournal').filter(function (j) {
    return j.state !== 'Committed';
  });
  var recoveryNeeded = stalled.filter(function (j) { return j.state === 'RecoveryRequired'; });
  var inFlight = stalled.filter(function (j) { return ['Prepared', 'Applying'].includes(j.state); });
  if (recoveryNeeded.length > 0) issues.push({ severity: 'Critical', component: 'CommitJournal', detail: recoveryNeeded.length + ' rows require recovery', ids: recoveryNeeded.map(function (r) { return r.id; }) });
  if (inFlight.length > 0) warnings.push({ severity: 'Warning', component: 'CommitJournal', detail: inFlight.length + ' rows in flight', ids: inFlight.map(function (r) { return r.id; }) });

  // Uncertain Outbox rows
  var uncertain = store.list('Outbox').filter(function (o) {
    return ['NeedsReview', 'RetryDue'].includes(o.status);
  });
  if (uncertain.length > 0) warnings.push({ severity: 'Warning', component: 'Outbox', detail: uncertain.length + ' uncertain/needs-review outbox rows', ids: uncertain.map(function (r) { return r.id; }) });

  // Failed outbox (Processing but stale)
  var failed = store.list('Outbox').filter(function (o) {
    return o.status === 'Processing' && o.attempt_count > 0;
  });
  if (failed.length > 0) warnings.push({ severity: 'Warning', component: 'Outbox', detail: failed.length + ' processing with retries', ids: failed.map(function (r) { return r.id; }) });

  // Processing heartbeats (last successful processing per component; staffed-window aware)
  var heartbeats = _s16HeartbeatModule()._s16HeartbeatStatus(store, { now: now });
  for (var hb = 0; hb < heartbeats.alerts.length; hb++) {
    var alert = heartbeats.alerts[hb];
    (alert.severity === 'Critical' ? issues : warnings).push({ severity: alert.severity, component: alert.component, detail: alert.detail, state: alert.state, last_success_at: alert.last_success_at });
  }

  // Last health check (Sheet may return Date — never call localeCompare on Date)
  var lastCheck = null;
  var healthRows = store.list('HealthChecks').filter(function (h) { return h.integration === 'S16-system'; });
  if (healthRows.length > 0) {
    healthRows.sort(function (a, b) {
      var aa = _s16Timestamp(a.checked_at) || '';
      var bb = _s16Timestamp(b.checked_at) || '';
      return bb.localeCompare(aa);
    });
    lastCheck = _s16Timestamp(healthRows[0].checked_at);
  }
  if (!lastCheck) warnings.push({ severity: 'Warning', component: 'HealthChecks', detail: 'No prior S16 system health check recorded' });

  // ReleaseMode configuration
  var modeIssues = [];
  for (var id in S16_FUNCTIONS) {
    if (!S16_FUNCTIONS.hasOwnProperty(id)) continue;
    var m = modes[id];
    if (m.mode === 'Disabled' && m.scope !== 'None') modeIssues.push(id + ' inconsistent Disabled/scope');
  }
  if (modeIssues.length > 0) issues.push({ severity: 'Critical', component: 'ReleaseModes', detail: modeIssues.join('; ') });

  // Determine overall status
  var overall = 'Healthy';
  if (issues.length > 0) overall = 'Critical';
  else if (warnings.length > 0) overall = 'Degraded';

  // Record health check
  var healthId = 'HC-' + now.replace(/[^0-9T]/g, '-');
  var existingHealth = store.get('HealthChecks', healthId);
  if (!existingHealth) {
    store.insert('HealthChecks', {
      id: healthId, integration: 'S16-system', checked_at: now,
      outcome: overall, last_success: overall === 'Healthy' ? now : (lastCheck || null),
      error_code: issues.length > 0 ? issues[0].component + '_' + issues[0].detail.substring(0, 20) : null,
      next_action_task_id: null, created_at: now, commit_id: healthId
    });
  }

  return {
    health_id: healthId,
    checked_at: now,
    overall: overall,
    last_health_check: lastCheck,
    critical_count: issues.length,
    warning_count: warnings.length,
    issues: issues,
    warnings: warnings,
    modes: modes,
    heartbeats: { stale_minutes: heartbeats.stale_minutes, staffed: heartbeats.staffed_window.staffed, components: heartbeats.components, summary: heartbeats.summary },
    summary: {
      stalled_commits: stalled.length,
      recovery_required: recoveryNeeded.length,
      uncertain_outbox: uncertain.length,
      failed_outbox: failed.length,
      heartbeat_components: heartbeats.components.length,
      heartbeat_alerts: heartbeats.alert_count,
      total_audit_events: store.list('AuditEvents').length,
      total_commits: store.list('CommitJournal').length,
      total_outbox: store.list('Outbox').length
    }
  };
}

/* --- 2. BACKUP MANIFEST (+ optional DEV Drive artifact) --- */

function _s16BackupFolderId(input) {
  if (!input) return null;
  if (_s16Text(input.backupFolderId)) return input.backupFolderId.trim();
  if (input.config && _s16Text(input.config.backupFolderId)) return input.config.backupFolderId.trim();
  return null;
}

function _s16BackupConfigEnvironment(input, store) {
  if (input && input.config && _s16Text(input.config.environment)) return String(input.config.environment).trim();
  if (store && typeof store.getEnvironment === 'function') return store.getEnvironment();
  return 'DEV';
}

/* Injectable Drive adapter for local tests; Apps Script uses DriveApp against Shared Drive folders. */
function _s16DriveApiDefault() {
  return {
    findFileInFolder: function (folderId, fileName) {
      var folder = DriveApp.getFolderById(folderId);
      var it = folder.getFilesByName(fileName);
      if (!it.hasNext()) return null;
      var f = it.next();
      return { id: f.getId(), name: f.getName() };
    },
    createFileInFolder: function (folderId, fileName, content, mimeType) {
      var folder = DriveApp.getFolderById(folderId);
      var blob = Utilities.newBlob(content, mimeType || 'application/json', fileName);
      var f = folder.createFile(blob);
      return { id: f.getId(), name: f.getName() };
    }
  };
}

function _s16WriteDevBackupDriveFile(store, input, payload) {
  var folderId = _s16BackupFolderId(input);
  if (!_s16Text(folderId)) return { ok: false, configured: false, reason: 'NOT_CONFIGURED' };
  var env = _s16BackupConfigEnvironment(input, store);
  if (env === 'PROD') throw new Error('S16_REFUSED: PROD backup Drive writes unavailable');
  if (env !== 'DEV') throw new Error('S16_REFUSED: Drive backup only when environment is DEV');
  if (payload.environment !== 'DEV' || payload.sheet_id !== S16_DEV_SHEET_ID)
    throw new Error('S16_REFUSED: Drive backup payload must be exact DEV sheet');
  var fileName = 'S16-' + payload.backup_id + '.json';
  var drive = (input && input.drive) || _s16DriveApiDefault();
  try {
    var existing = drive.findFileInFolder(folderId, fileName);
    if (existing && existing.id) {
      return { ok: true, configured: true, file_id: existing.id, file_name: existing.name || fileName, created: false, folder_id: folderId };
    }
    var created = drive.createFileInFolder(folderId, fileName, JSON.stringify(payload), 'application/json');
    if (!created || !_s16Text(created.id)) throw new Error('Drive create returned no file id');
    return { ok: true, configured: true, file_id: created.id, file_name: created.name || fileName, created: true, folder_id: folderId };
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (/S16_REFUSED:/.test(msg)) throw e;
    throw new Error('S16_BACKUP_DRIVE_FAILED: ' + msg);
  }
}

function _s16BackupManifest(store, input) {
  _s16Scope(store);
  if (!_s16Text(input.command_id) || !_s16Text(input.actor)) throw new Error('S16_REVIEW: command_id and actor required');

  var now = _s16Now();
  var backupId = 'BACKUP-' + input.command_id;
  var existing = store.get('ReportSnapshots', backupId);
  if (existing) {
    /* Replay: if prior run left a Sheet row without Drive file_id, retry Drive once when configured. */
    if (!_s16Text(existing.file_id) && _s16BackupFolderId(input)) {
      var priorTotals;
      try { priorTotals = JSON.parse(existing.totals_json); } catch (e) { priorTotals = null; }
      if (priorTotals && priorTotals.checksum) {
        var retryPayload = {
          backup_id: backupId,
          environment: 'DEV',
          sheet_id: S16_DEV_SHEET_ID,
          created_at: priorTotals.created_at || existing.created_at || now,
          checksum: priorTotals.checksum,
          schema_version: priorTotals.schema_version || 'S02-1.0',
          record_counts: priorTotals.record_counts || {},
          total_rows: priorTotals.total_rows || 0,
          tables_count: priorTotals.tables_count || 0,
          report_id: backupId
        };
        var retryDrive = _s16WriteDevBackupDriveFile(store, input, retryPayload);
        if (retryDrive.ok && retryDrive.file_id) {
          priorTotals.destination = 'DriveFolder:' + retryDrive.folder_id;
          priorTotals.drive_file_name = retryDrive.file_name;
          priorTotals.validation_status = 'Pending';
          priorTotals.notes = 'DEV Drive backup artifact';
          store.update('ReportSnapshots', backupId, { file_id: retryDrive.file_id, totals_json: JSON.stringify(priorTotals) });
          existing = store.get('ReportSnapshots', backupId);
          return { created: false, replay: true, drive_repaired: true, backup_id: backupId, manifest: existing, file_id: existing.file_id, checksum: priorTotals.checksum, destination: priorTotals.destination };
        }
      }
    }
    return { created: false, manifest: existing, replay: true, backup_id: backupId, file_id: existing.file_id || null, checksum: (function () { try { return JSON.parse(existing.totals_json).checksum; } catch (e) { return null; } })(), destination: (function () { try { return JSON.parse(existing.totals_json).destination; } catch (e) { return null; } })() };
  }

  // Enumerate tables and record counts
  var tables = [
    'Jobs', 'Customers', 'WorkPackages', 'Allocations', 'Tasks', 'TaskDependencies',
    'Materials', 'Reservations', 'Orders', 'OrderLines', 'Deliveries', 'ReceiptLines',
    'StockLocations', 'StockMovements', 'Stocktakes', 'StocktakeLines',
    'ScaffoldBookings', 'InvoiceStages', 'Payments', 'ManualBankChecks',
    'CommissioningSubmissions', 'CommissioningAnswers', 'CommissioningTemplates', 'CommissioningQuestions',
    'JobEquipment', 'Handover', 'Evidence', 'CalendarLinks', 'Communications', 'CommunicationJobs',
    'Acknowledgements', 'Issues', 'IssueEvents', 'TaskEvents', 'GHLTasks',
    'AccountingEvents', 'JobCosts', 'FinancePlans',
    'Outbox', 'CommitJournal', 'AuditEvents', 'HealthChecks', 'ArchiveIndex', 'ReportSnapshots',
    'People', 'PersonRoles', 'PermissionRules', 'Companies', 'Contacts',
    'Intake', 'MappingRules', 'CustomerChanges', 'TechnicalDetails', 'PanelUse',
    'Settings', 'Holidays', 'TaskTemplates', 'ReleaseModes'
  ];

  var counts = {};
  var totalRows = 0;
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    var rows = store.list(t);
    counts[t] = rows.length;
    totalRows += rows.length;
  }

  var schemaVersion = 'S02-1.0'; // Canonical schema version
  var checksum = _s16Hash({ schema_version: schemaVersion, counts: counts, environment: 'DEV', sheet_id: S16_DEV_SHEET_ID, created_at: now });

  var artifact = {
    backup_id: backupId,
    environment: 'DEV',
    sheet_id: S16_DEV_SHEET_ID,
    created_at: now,
    checksum: checksum,
    schema_version: schemaVersion,
    record_counts: counts,
    total_rows: totalRows,
    tables_count: tables.length,
    report_id: backupId
  };

  var folderConfigured = !!_s16BackupFolderId(input);
  var driveResult = null;
  var destination = 'NOT_CONFIGURED: no real Drive copy';
  var notes = 'Synthetic DEV manifest only. No Drive file created.';
  var fileId = null;

  if (folderConfigured) {
    /* Drive write before Sheet insert — failure must not claim success. */
    driveResult = _s16WriteDevBackupDriveFile(store, input, artifact);
    if (!driveResult.ok || !_s16Text(driveResult.file_id)) throw new Error('S16_BACKUP_DRIVE_FAILED: no file_id');
    fileId = driveResult.file_id;
    destination = 'DriveFolder:' + driveResult.folder_id;
    notes = 'DEV Drive backup artifact';
  }

  var manifest = {
    id: backupId,
    period_start: now.slice(0, 10),
    period_end: now.slice(0, 10),
    as_of_at: now,
    policy_version: 'S16-DEV-1.0',
    report_type: 'BackupManifest',
    totals_json: JSON.stringify({
      backup_id: backupId,
      environment: 'DEV',
      sheet_id: S16_DEV_SHEET_ID,
      schema_version: schemaVersion,
      created_at: now,
      created_by: input.actor,
      record_counts: counts,
      total_rows: totalRows,
      checksum: checksum,
      tables_count: tables.length,
      destination: destination,
      drive_file_name: driveResult && driveResult.file_name ? driveResult.file_name : null,
      validation_status: 'Pending',
      notes: notes
    }),
    underlying_job_ids: JSON.stringify([]),
    file_id: fileId,
    generated_by: input.actor,
    created_at: now,
    commit_id: backupId
  };

  var existingSnap = store.get('ReportSnapshots', backupId);
  if (!existingSnap) store.insert('ReportSnapshots', manifest);

  return {
    created: true,
    backup_id: backupId,
    manifest: manifest,
    table_count: tables.length,
    total_rows: totalRows,
    checksum: checksum,
    file_id: fileId,
    destination: destination,
    drive_created: !!(driveResult && driveResult.created)
  };
}

/* --- 3. BACKUP VALIDATION --- */

function _s16ValidateBackup(store, backupId) {
  _s16Scope(store);
  var manifest = store.get('ReportSnapshots', backupId);
  if (!manifest || manifest.report_type !== 'BackupManifest') throw new Error('S16_REVIEW: backup manifest not found');

  var totals;
  try { totals = JSON.parse(manifest.totals_json); } catch (e) { throw new Error('S16_REVIEW: corrupt manifest totals'); }

  if (!totals.checksum || !totals.record_counts || !totals.schema_version || !totals.created_at)
    throw new Error('S16_REVIEW: incomplete manifest');

  // Recompute counts, excluding the backup manifest row itself from ReportSnapshots
  var currentCounts = {};
  var tables = Object.keys(totals.record_counts);
  for (var i = 0; i < tables.length; i++) {
    var t = tables[i];
    currentCounts[t] = store.list(t).length;
  }
  // Exclude the backup manifest row from ReportSnapshots count
  if (currentCounts.ReportSnapshots > 0) currentCounts.ReportSnapshots -= 1;

  // Use totals_json.created_at (stable string), never Sheet Date from ReportSnapshots.created_at
  var createdAt = totals.created_at;
  var recomputedChecksum = _s16Hash({ schema_version: totals.schema_version, counts: currentCounts, environment: 'DEV', sheet_id: S16_DEV_SHEET_ID, created_at: createdAt });

  var countMismatches = [];
  for (var j = 0; j < tables.length; j++) {
    var tn = tables[j];
    if (currentCounts[tn] !== totals.record_counts[tn]) countMismatches.push({ table: tn, manifest: totals.record_counts[tn], current: currentCounts[tn] });
  }

  var valid = countMismatches.length === 0 && recomputedChecksum === totals.checksum;

  return {
    backup_id: backupId,
    valid: valid,
    checksum_match: recomputedChecksum === totals.checksum,
    count_mismatches: countMismatches,
    manifest_created_at: createdAt,
    manifest_checksum: totals.checksum,
    recomputed_checksum: recomputedChecksum,
    environment: totals.environment,
    schema_version: totals.schema_version
  };
}

/* --- 4. RESTORE PLANNING (dry-run only) --- */

function _s16RestorePlan(store, backupId, input) {
  _s16Scope(store);
  if (!_s16Text(input.actor) || !_s16Text(input.reason)) throw new Error('S16_REVIEW: actor and reason required');

  var validation = _s16ValidateBackup(store, backupId);
  if (!validation.valid) throw new Error('S16_REVIEW: backup validation failed — restore blocked');

  var manifest = store.get('ReportSnapshots', backupId);
  var totals;
  try { totals = JSON.parse(manifest.totals_json); } catch (e) { throw new Error('S16_REVIEW: corrupt manifest'); }

  if (totals.environment !== 'DEV') throw new Error('S16_REFUSED: cross-environment restore blocked');
  if (totals.sheet_id !== S16_DEV_SHEET_ID) throw new Error('S16_REFUSED: cross-sheet restore blocked');

  // Dry-run: report what would happen, do NOT mutate
  var now = _s16Now();
  return {
    backup_id: backupId,
    dry_run: true,
    planned_at: now,
    planned_by: input.actor,
    reason: input.reason,
    validation: validation,
    source_manifest: {
      created_at: totals.created_at,
      total_rows: totals.total_rows,
      table_count: totals.tables_count,
      schema_version: totals.schema_version
    },
    warnings: [
      'Restore is DRY-RUN ONLY. No data has been modified.',
      'Full restore requires explicit approval, isolated environment, and disabled outgoing actions.',
      'NOT_CONFIGURED: actual Drive restore procedure not implemented.'
    ],
    blocked: true,
    block_reason: 'Destructive restore not authorised in DEV synthetic smoke'
  };
}

/* --- 5. ARCHIVE ELIGIBILITY --- */

function _s16ArchiveEligibility(store, jobId) {
  _s16Scope(store);
  var job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, eligible: false, reason: 'JOB_NOT_FOUND', blockers: ['Job not found'], checks: [], blocker_count: 1 };

  var checks = [];
  var blockers = [];

  // 1. Must be operationally complete
  if (!job.operational_complete_at) {
    blockers.push('Not operationally complete');
  } else {
    // 2. Six calendar months since operational completion
    var completeDate = _s16Date(job.operational_complete_at);
    var today = _s16Date(_s16Now().slice(0, 10));
    var monthsElapsed = _s16MonthsBetween(completeDate, today);
    var threshold = _s16AddMonths(completeDate, S16_ARCHIVE_MONTHS);

    checks.push({ check: 'operational_complete', value: completeDate, passed: true });
    checks.push({ check: 'months_since_completion', value: monthsElapsed, threshold: S16_ARCHIVE_MONTHS, passed: monthsElapsed >= S16_ARCHIVE_MONTHS, threshold_date: threshold });

    if (monthsElapsed < S16_ARCHIVE_MONTHS) blockers.push('Less than ' + S16_ARCHIVE_MONTHS + ' calendar months since operational completion (' + monthsElapsed + ' months, threshold ' + threshold + ')');
  }

  // 3. Must not be cancelled
  if (job.cancellation_at || ['CancellationInProgress', 'Cancelled'].includes(job.workflow_stage)) {
    blockers.push('Job is cancelled or cancellation in progress');
  }

  // 4. No open Tasks (not Complete, NotRequired, or Cancelled)
  var openTasks = store.list('Tasks').filter(function (t) {
    return t.job_id === jobId && !['Complete', 'NotRequired', 'Cancelled'].includes(t.status);
  });
  checks.push({ check: 'open_tasks', value: openTasks.length, passed: openTasks.length === 0 });
  if (openTasks.length > 0) blockers.push(openTasks.length + ' open tasks');

  // 5. No unresolved Issues
  var openIssues = store.list('Issues').filter(function (i) {
    return i.job_id === jobId && !['Resolved', 'Closed'].includes(i.status);
  });
  checks.push({ check: 'unresolved_issues', value: openIssues.length, passed: openIssues.length === 0 });
  if (openIssues.length > 0) blockers.push(openIssues.length + ' unresolved issues');

  // 6. Handover must be complete
  var handoverReady = job.handover_status === 'Sent' || job.handover_status === 'Approved';
  checks.push({ check: 'handover_status', value: job.handover_status, passed: handoverReady });
  if (!handoverReady) blockers.push('Handover not sent/approved: ' + job.handover_status);

  // 7. No outstanding payments/refunds
  var stages = store.list('InvoiceStages').filter(function (s) { return s.job_id === jobId; });
  var hasOutstanding = stages.some(function (s) {
    var payments = store.list('Payments').filter(function (p) { return p.invoice_stage_id === s.id; });
    var totalPaid = payments.reduce(function (sum, p) { return sum + (p.amount_pence || 0); }, 0);
    return (s.gross_pence || 0) - totalPaid > 0;
  });
  checks.push({ check: 'outstanding_payments', value: hasOutstanding ? 'Has outstanding' : 'None', passed: !hasOutstanding });
  if (hasOutstanding) blockers.push('Outstanding invoice balances');

  // 8. No pending Outbox
  var pendingOutbox = store.list('Outbox').filter(function (o) {
    return (o.correlation_id === jobId || stages.some(function (s) { return o.correlation_id === 'XI-' + jobId + '-' + s.stage; })) &&
      !['Succeeded', 'Cancelled'].includes(o.status);
  });
  checks.push({ check: 'pending_outbox', value: pendingOutbox.length, passed: pendingOutbox.length === 0 });
  if (pendingOutbox.length > 0) blockers.push(pendingOutbox.length + ' pending outbox items');

  // 9. No open scaffolding obligations
  var scaffoldPending = store.list('ScaffoldBookings').filter(function (b) {
    return b.job_id === jobId && b.erect_actual_at && !b.strip_actual_at && b.status !== 'Cancelled';
  });
  checks.push({ check: 'scaffold_obligations', value: scaffoldPending.length, passed: scaffoldPending.length === 0 });
  if (scaffoldPending.length > 0) blockers.push('Scaffold still erected, strip required');

  // 10. Already archived?
  if (job.archived_at) {
    blockers.push('Already archived at ' + _s16Date(job.archived_at));
  }

  var eligible = blockers.length === 0;

  return {
    job_id: jobId,
    job_display: job.display_name || job.job_id,
    eligible: eligible,
    operational_complete_at: job.operational_complete_at ? _s16Date(job.operational_complete_at) : null,
    months_since_completion: job.operational_complete_at ? _s16MonthsBetween(_s16Date(job.operational_complete_at), _s16Date(_s16Now().slice(0, 10))) : null,
    checks: checks,
    blockers: blockers,
    blocker_count: blockers.length
  };
}

/* --- 6. ARCHIVE ACTION --- */

function _s16ArchiveJob(store, input) {
  _s16Scope(store);
  if (!_s16Text(input.job_id) || !_s16Text(input.actor) || !_s16Text(input.reason)) throw new Error('S16_REVIEW: job_id, actor and reason required');

  var job = store.get('Jobs', input.job_id);
  if (!job) throw new Error('S16_REVIEW: job not found');

  // Already archived — idempotent
  if (job.archived_at) {
    var existingArchive = store.list('ArchiveIndex').filter(function (a) { return a.job_id === job.id && !a.restored_at; });
    if (existingArchive.length > 0) return { archived: false, replay: true, job_id: job.id, archive_id: existingArchive[0].id, detail: 'Already archived' };
  }
  // Check for existing archive entries even if archived_at was cleared by reopen
  var priorArchive = store.list('ArchiveIndex').filter(function (a) { return a.job_id === job.id && !a.restored_at; });
  if (priorArchive.length > 0) return { archived: false, replay: true, job_id: job.id, archive_id: priorArchive[0].id, detail: 'Already archived (prior entry)' };

  var archiveId = 'ARCHIVE-' + input.command_id;
  // Idempotent: same command_id already processed
  var existingArchiveById = store.get('ArchiveIndex', archiveId);
  if (existingArchiveById) return { archived: false, replay: true, job_id: job.id, archive_id: archiveId, detail: 'Archive already recorded for this command' };

  var eligibility = _s16ArchiveEligibility(store, input.job_id);
  if (!eligibility.eligible) throw new Error('S16_REVIEW: job not archive-eligible: ' + eligibility.blockers.join('; '));

  var now = _s16Now();
  var commit = 'S16-ARCHIVE-' + input.command_id;
  var archiveId = 'ARCHIVE-' + input.command_id;

  // Create ArchiveIndex entry
  var relatedTables = [
    'WorkPackages', 'Allocations', 'Tasks', 'Materials', 'Reservations',
    'Orders', 'OrderLines', 'ScaffoldBookings', 'InvoiceStages', 'Payments',
    'CommissioningSubmissions', 'CommissioningAnswers', 'JobEquipment', 'Handover',
    'Issues', 'CalendarLinks', 'Communications', 'GHLTasks', 'JobCosts'
  ];

  var counts = { Jobs: 1 };
  for (var i = 0; i < relatedTables.length; i++) {
    var t = relatedTables[i];
    counts[t] = store.list(t).filter(function (r) { return r.job_id === job.id; }).length;
  }

  var totalRelated = 0;
  for (var ck in counts) { if (counts.hasOwnProperty(ck)) totalRelated += counts[ck]; }
  var checksum = _s16Hash({ job_id: job.id, counts: counts, archived_at: now });

  var archiveEntry = {
    id: archiveId,
    job_id: job.id,
    archive_location: 'DEV-ARCHIVE-' + now.slice(0, 10),
    archived_at: now,
    record_counts: JSON.stringify(counts),
    checksum: checksum,
    schema_version: 'S02-1.0',
    restored_at: null,
    created_at: now,
    commit_id: commit
  };

  store.insert('ArchiveIndex', archiveEntry);

  // Mark job archived
  store.update('Jobs', job.id, {
    archived_at: now,
    updated_at: now,
    updated_by: input.actor,
    version: Number(job.version || 0) + 1,
    commit_id: commit
  });

  // Audit event
  var auditId = 'AE-' + commit;
  if (!store.get('AuditEvents', auditId)) {
    store.insert('AuditEvents', {
      id: auditId, entity_type: 'Jobs', entity_id: job.id,
      action: 'S16Archive',
      before_json: JSON.stringify({ archived_at: job.archived_at }),
      after_json: JSON.stringify({ archived_at: now }),
      initiating_actor: input.actor,
      executing_service: 'S16 DEV',
      timestamp: now,
      correlation_id: input.command_id,
      reason: input.reason,
      commit_id: commit,
      created_at: now
    });
  }

  return {
    archived: true,
    job_id: job.id,
    archive_id: archiveId,
    archived_at: now,
    archived_by: input.actor,
    total_related_rows: totalRelated,
    tables_affected: Object.keys(counts).length,
    record_counts: counts,
    checksum: checksum
  };
}

/* --- 7. REOPEN FROM ARCHIVE --- */

function _s16ReopenArchivedJob(store, input) {
  _s16Scope(store);
  if (!_s16Text(input.job_id) || !_s16Text(input.actor) || !_s16Text(input.reason)) throw new Error('S16_REVIEW: job_id, actor and reason required');

  var job = store.get('Jobs', input.job_id);
  if (!job) throw new Error('S16_REVIEW: job not found');
  if (!job.archived_at) {
    // Already reopened — idempotent
    var existingReopen = store.list('AuditEvents').filter(function (e) { return e.entity_id === job.id && e.action === 'S16ReopenFromArchive' && e.correlation_id === input.command_id; });
    if (existingReopen.length > 0) return { reopened: true, replay: true, job_id: job.id, detail: 'Already reopened' };
    throw new Error('S16_REVIEW: job not archived');
  }

  var archiveEntry = store.list('ArchiveIndex').filter(function (a) { return a.job_id === job.id && !a.restored_at; });
  if (archiveEntry.length === 0) throw new Error('S16_REVIEW: no un-restored archive entry found');

  var now = _s16Now();
  var commit = 'S16-REOPEN-' + input.command_id;

  // Clear archived_at on job
  store.update('Jobs', job.id, {
    archived_at: null,
    updated_at: now,
    updated_by: input.actor,
    version: Number(job.version || 0) + 1,
    commit_id: commit
  });

  // Mark archive entry as restored
  store.update('ArchiveIndex', archiveEntry[0].id, {
    restored_at: now
  });

  // Audit event
  var auditId = 'AE-' + commit;
  if (!store.get('AuditEvents', auditId)) {
    store.insert('AuditEvents', {
      id: auditId, entity_type: 'Jobs', entity_id: job.id,
      action: 'S16ReopenFromArchive',
      before_json: JSON.stringify({ archived_at: job.archived_at }),
      after_json: JSON.stringify({ archived_at: null, restored_at: now }),
      initiating_actor: input.actor,
      executing_service: 'S16 DEV',
      timestamp: now,
      correlation_id: input.command_id,
      reason: input.reason,
      commit_id: commit,
      created_at: now
    });
  }

  return {
    reopened: true,
    job_id: job.id,
    archive_id: archiveEntry[0].id,
    reopened_at: now,
    reopened_by: input.actor,
    previous_archived_at: job.archived_at,
    workflow_stage: job.workflow_stage,
    notes: 'IDs and history preserved. No external side effects recreated. Review fresh obligations before resuming normal operations.'
  };
}

/* --- 8. RELEASE MODE TOGGLE --- */

function _s16SetModes(store, enable) {
  _s16GuardStore(store);
  return store.withLock(function () {
    var rows = S16_ENABLED.map(function (id) {
      var all = store.list('ReleaseModes').filter(function (r) { return r.function_id === id; });
      var def = S16_FUNCTIONS[id];
      if (all.length !== 1 || all[0].target_release !== def[0] ||
        !((all[0].mode === 'Disabled' && all[0].authorised_job_scope === 'None') ||
          (all[0].mode === def[1] && all[0].authorised_job_scope === 'Pilot')))
        throw new Error('S16_REFUSED: unexpected starting mode ' + id);
      return all[0];
    });
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var mode = enable ? S16_FUNCTIONS[r.function_id][1] : 'Disabled';
      var scope = enable ? 'Pilot' : 'None';
      if (r.mode !== mode || r.authorised_job_scope !== scope)
        store.update('ReleaseModes', r.id, { mode: mode, authorised_job_scope: scope, updated_at: _s16Now(), updated_by: 'S16-modes', version: Number(r.version || 0) + 1 });
    }
    return { ok: true, enabled: enable, functions: S16_ENABLED };
  });
}

/* --- 9. SYSTEM TASK GENERATION (SYS01, SYS02) --- */

function _s16SystemTasks(store, input) {
  _s16Scope(store);
  if (!_s16Text(input.actor) || !_s16Text(input.command_id)) throw new Error('S16_REVIEW: actor and command_id required');

  var now = _s16Now();
  var tasks = [];
  var templates = store.list('TaskTemplates').filter(function (t) {
    return _s16IsTrue(t.active) && ['SYS01', 'SYS02'].includes(t.template_code);
  });

  // Find owners
  var tanya = store.list('People').filter(function (p) { return _s16IsTrue(p.active) && p.role === 'Office' && p.display_name && p.display_name.toLowerCase().indexOf('tanya') !== -1; })[0];
  var ben = store.list('People').filter(function (p) { return _s16IsTrue(p.active) && p.role === 'Manager' && p.display_name && p.display_name.toLowerCase().indexOf('ben') !== -1; })[0];

  for (var i = 0; i < templates.length; i++) {
    var tpl = templates[i];
    var owner = tpl.template_code === 'SYS01' ? (tanya || ben) : (tanya || ben);
    if (!owner) continue;
    var backupPerson = (ben && ben.id !== owner.id) ? ben : ((tanya && tanya.id !== owner.id) ? tanya : null);

    var instanceKey = 'S16-' + input.command_id + '-' + tpl.template_code;
    var existingTask = store.list('Tasks').filter(function (t) {
      return t.instance_key === instanceKey && t.status !== 'Cancelled';
    });

    if (existingTask.length > 0) {
      tasks.push({ created: false, reused: true, task_id: existingTask[0].id, template: tpl.template_code });
      continue;
    }

    var taskId = 'TASK-' + instanceKey;
    var task = {
      id: taskId,
      job_id: null,
      template_code: tpl.template_code,
      instance_key: instanceKey,
      group: 'System',
      title: tpl.title,
      owner_id: owner.id,
      backup_id: backupPerson ? backupPerson.id : null,
      related_entity_type: 'HealthChecks',
      related_entity_id: null,
      due_at: now,
      original_due_at: now,
      priority: 1,
      status: 'Open',
      blocking_reason: null,
      completion_note: null,
      evidence_id: null,
      revision_required: false,
      created_rule_version: 'S16-1.0',
      created_at: now,
      created_by: input.actor,
      updated_at: now,
      updated_by: input.actor,
      version: 1,
      source_system: 'S16',
      commit_id: 'S16-' + input.command_id
    };
    store.insert('Tasks', task);
    tasks.push({ created: true, task_id: taskId, template: tpl.template_code, owner: owner.display_name });
  }

  return {
    tasks_created: tasks.filter(function (t) { return t.created; }).length,
    tasks_reused: tasks.filter(function (t) { return t.reused; }).length,
    tasks: tasks,
    owners: { tanya: tanya ? tanya.id : null, ben: ben ? ben.id : null }
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    S16_DEV_SHEET_ID, S16_FUNCTIONS, S16_ENABLED, S16_ARCHIVE_MONTHS,
    _s16Date, _s16Timestamp, _s16IsTrue, _s16AddMonths, _s16MonthsBetween, _s16Hash,
    _s16HealthStatus, _s16BackupManifest, _s16ValidateBackup, _s16RestorePlan,
    _s16ArchiveEligibility, _s16ArchiveJob, _s16ReopenArchivedJob,
    _s16SystemTasks, _s16SetModes, _s16Scope, _s16GuardStore,
    _s16BackupFolderId, _s16WriteDevBackupDriveFile
  };
}
