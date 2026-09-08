/* S17 finished screens / admin read models. Authority: 01 §12, 02 §§1,15-18, 04 S17, RA01.
 * Purely read-only over S01–S16 operational data. No new mutations.
 * No dedicated ReleaseMode — S17 spans all functions; respects existing modes.
 * No real Calendar/Xero/GHL/Drive calls. No destructive operations. */
'use strict';

const S17_ADMIN_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

/* --- Utilities --- */

function _s17Copy(x) { return JSON.parse(JSON.stringify(x)); }
function _s17Text(x) { return typeof x === 'string' && x.trim().length > 0; }
function _s17Date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('S17_DATE_INVALID');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  var text = String(value).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m) throw new Error('S17_DATE_INVALID');
  var iso = m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(iso + 'T12:00:00Z');
  if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return iso;
  throw new Error('S17_DATE_INVALID');
}
function _s17Now() { return new Date().toISOString(); }
function _s17Today() { return _s17Date(_s17Now().slice(0, 10)); }

/* --- Guard --- */

function _s17GuardStore(store) {
  if (!store.getSheetId || store.getSheetId() !== S17_ADMIN_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV')
    throw new Error('S17_REFUSED: exact DEV sheet/environment required');
}
function _s17Scope(store) {
  _s17GuardStore(store);
  // S17 is read-only — validate environment only, not specific mode
  var modes = {};
  var modeRows = store.list('ReleaseModes');
  for (var i = 0; i < modeRows.length; i++) {
    var r = modeRows[i];
    modes[r.function_id] = { mode: r.mode, scope: r.authorised_job_scope, target_release: r.target_release, name: r.function_name };
  }
  return modes;
}

/* --- 1. OFFICE HOME / TODAY --- */

function _s17OfficeToday(store, input) {
  _s17Scope(store);
  var today = input && input.as_of ? _s17Date(input.as_of) : _s17Today();
  var now = _s17Now();

  var allTasks = store.list('Tasks').filter(function (t) {
    return t.status !== 'Cancelled' && t.status !== 'Complete' && t.status !== 'NotRequired';
  });

  // Overdue: due_at before today
  var overdue = allTasks.filter(function (t) {
    if (!t.due_at) return false;
    var due = _s17Date(t.due_at);
    return due && due < today;
  }).map(_s17TaskSummary);

  // Due today
  var dueToday = allTasks.filter(function (t) {
    if (!t.due_at) return false;
    var due = _s17Date(t.due_at);
    return due === today;
  }).map(_s17TaskSummary);

  // Due soon (next 7 days, excluding today)
  var dueSoon = allTasks.filter(function (t) {
    if (!t.due_at) return false;
    var due = _s17Date(t.due_at);
    if (!due || due <= today) return false;
    var d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    return due <= d.toISOString().slice(0, 10);
  }).map(_s17TaskSummary);

  // Booking approvals
  var bookingReview = allTasks.filter(function (t) {
    return t.group === 'Booking' || t.group === 'Prebooking';
  }).map(_s17TaskSummary);

  // Unresolved issues
  var unresolvedIssues = store.list('Issues').filter(function (i) {
    return !['Resolved', 'Closed'].includes(i.status);
  }).map(function (i) {
    return { id: i.id, job_id: i.job_id, type: i.type, category: i.category, description: i.description, severity: i.severity, status: i.status, raised_at: i.raised_at ? _s17Date(i.raised_at) : null, office_owner_id: i.office_owner_id, blocks_completion: i.blocks_completion, blocks_strip: i.blocks_strip };
  });

  // Health alerts
  var healthAlerts = [];
  var stalledCommits = store.list('CommitJournal').filter(function (j) { return j.state !== 'Committed'; });
  if (stalledCommits.length > 0) healthAlerts.push({ type: 'stalled_commits', count: stalledCommits.length, detail: stalledCommits.length + ' commit(s) not committed' });
  var uncertainOutbox = store.list('Outbox').filter(function (o) { return ['NeedsReview', 'RetryDue'].includes(o.status); });
  if (uncertainOutbox.length > 0) healthAlerts.push({ type: 'uncertain_outbox', count: uncertainOutbox.length, detail: uncertainOutbox.length + ' outbox item(s) need review' });

  return {
    as_of: today,
    generated_at: now,
    overdue_count: overdue.length,
    due_today_count: dueToday.length,
    due_soon_count: dueSoon.length,
    booking_review_count: bookingReview.length,
    unresolved_issues_count: unresolvedIssues.length,
    health_alerts_count: healthAlerts.length,
    overdue: overdue,
    due_today: dueToday,
    due_soon: dueSoon,
    booking_review: bookingReview,
    unresolved_issues: unresolvedIssues,
    health_alerts: healthAlerts
  };
}

function _s17TaskSummary(t) {
  return {
    id: t.id, job_id: t.job_id, title: t.title, group: t.group,
    owner_id: t.owner_id, due_at: t.due_at ? _s17Date(t.due_at) : null,
    status: t.status, priority: t.priority, blocking_reason: t.blocking_reason,
    template_code: t.template_code, related_entity_type: t.related_entity_type, related_entity_id: t.related_entity_id
  };
}

/* --- 2. JOB OVERVIEW --- */

function _s17JobOverview(store, jobId) {
  _s17Scope(store);
  var job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, found: false };

  var overview = {
    found: true,
    identity: {
      id: job.id, job_id: job.job_id, display_name: job.display_name,
      customer_id: job.customer_id, workflow_stage: job.workflow_stage,
      pilot_job: job.pilot_job, release_scope: job.release_scope,
      financial_status: job.financial_status, handover_status: job.handover_status
    },
    booking: _s17BookingSummary(store, job),
    work: _s17WorkSummary(store, job),
    materials: _s17MaterialSummary(store, job),
    scaffold: _s17ScaffoldSummary(store, job),
    commissioning: _s17CommissioningSummary(store, job),
    handover: _s17HandoverSummary(store, job),
    finance: _s17FinanceSummary(store, job),
    crm: _s17CRMSummary(store, job),
    cancellation: _s17CancellationSummary(store, job),
    archive: { archived_at: job.archived_at ? _s17Date(job.archived_at) : null },
    system: _s17SystemSummary(store, job)
  };
  return overview;
}

function _s17BookingSummary(store, job) {
  var tasks = store.list('Tasks').filter(function (t) { return t.job_id === job.id && (t.group === 'Booking' || t.group === 'Prebooking') && t.status !== 'Cancelled' && t.status !== 'Complete'; });
  return {
    sold_submission_id: job.sold_submission_id, booking_submission_id: job.booking_submission_id,
    booking_approved_at: job.booking_approved_at ? _s17Date(job.booking_approved_at) : null,
    booking_approved_by: job.booking_approved_by,
    sold_booking_match_status: job.sold_booking_match_status,
    outstanding_tasks: tasks.length,
    tasks: tasks.map(_s17TaskSummary)
  };
}

function _s17WorkSummary(store, job) {
  var packages = store.list('WorkPackages').filter(function (w) { return w.job_id === job.id; });
  var allocations = store.list('Allocations').filter(function (a) {
    return packages.some(function (w) { return w.id === a.work_package_id; }) && a.active === true;
  });
  var calls = store.list('Calls').filter(function (c) { return c.job_id === job.id; });
  var issues = store.list('Issues').filter(function (i) { return i.job_id === job.id && !['Resolved', 'Closed'].includes(i.status); });
  return {
    roof_required: job.roof_required, electrical_required: job.electrical_required, scaffold_required: job.scaffold_required,
    packages: packages.map(function (w) { return { id: w.id, trade: w.trade, status: w.status, planned_start: w.planned_start ? _s17Date(w.planned_start) : null, planned_end: w.planned_end ? _s17Date(w.planned_end) : null, commissioning_required: w.commissioning_required, actual_start: w.actual_start ? _s17Date(w.actual_start) : null, actual_end: w.actual_end ? _s17Date(w.actual_end) : null }; }),
    allocations: allocations.map(function (a) { return { id: a.id, work_package_id: a.work_package_id, person_id: a.person_id, role: a.role, start_at: a.start_at ? _s17Date(a.start_at) : null, end_at: a.end_at ? _s17Date(a.end_at) : null }; }),
    calls_count: calls.length,
    unresolved_issues: issues.length,
    operational_complete_at: job.operational_complete_at ? _s17Date(job.operational_complete_at) : null,
    customer_happy_at: job.customer_happy_at ? _s17Date(job.customer_happy_at) : null
  };
}

function _s17MaterialSummary(store, job) {
  var materials = store.list('Materials').filter(function (m) { return m.job_id === job.id; });
  var reservations = store.list('Reservations').filter(function (r) { return materials.some(function (m) { return m.id === r.material_id; }); });
  var orders = store.list('Orders').filter(function (o) { return o.job_id === job.id; });
  return {
    materials_count: materials.length,
    required_quantity: materials.reduce(function (s, m) { return s + (m.required_quantity || 0); }, 0),
    cancelled_quantity: materials.reduce(function (s, m) { return s + (m.cancelled_quantity || 0); }, 0),
    active_reservations: reservations.filter(function (r) { return r.status === 'Active'; }).length,
    orders: orders.map(function (o) { return { id: o.id, status: o.status, merchant_id: o.merchant_id, supplier_reference: o.supplier_reference }; })
  };
}

function _s17ScaffoldSummary(store, job) {
  var bookings = store.list('ScaffoldBookings').filter(function (b) { return b.job_id === job.id; });
  return {
    scaffold_required: job.scaffold_required,
    bookings: bookings.map(function (b) { return { id: b.id, status: b.status, erect_planned_at: b.erect_planned_at ? _s17Date(b.erect_planned_at) : null, erect_actual_at: b.erect_actual_at ? _s17Date(b.erect_actual_at) : null, strip_actual_at: b.strip_actual_at ? _s17Date(b.strip_actual_at) : null, company_id: b.company_id }; })
  };
}

function _s17CommissioningSummary(store, job) {
  var submissions = store.list('CommissioningSubmissions').filter(function (s) { return s.job_id === job.id; });
  var equipment = store.list('JobEquipment').filter(function (e) { return e.job_id === job.id; });
  return {
    submissions: submissions.map(function (s) { return { id: s.id, status: s.status, submitted_at: s.submitted_at ? _s17Date(s.submitted_at) : null, reviewed_at: s.reviewed_at ? _s17Date(s.reviewed_at) : null, installer_id: s.installer_id, work_package_id: s.work_package_id }; }),
    equipment_count: equipment.length,
    needs_review: submissions.some(function (s) { return s.status === 'Submitted'; })
  };
}

function _s17HandoverSummary(store, job) {
  var handover = store.list('Handover').filter(function (h) { return h.job_id === job.id; });
  return {
    status: job.handover_status,
    records: handover.map(function (h) { return { id: h.id, sent_at: h.sent_at ? _s17Date(h.sent_at) : null, status: h.status }; })
  };
}

function _s17FinanceSummary(store, job) {
  var stages = store.list('InvoiceStages').filter(function (s) { return s.job_id === job.id; });
  var payments = store.list('Payments');
  var stageDetails = stages.map(function (s) {
    var sp = payments.filter(function (p) { return p.invoice_stage_id === s.id; });
    var paid = sp.reduce(function (sum, p) { return sum + (p.amount_pence || 0); }, 0);
    return { stage_id: s.id, stage: s.stage, gross_pence: s.gross_pence || 0, paid_pence: paid, outstanding_pence: (s.gross_pence || 0) - paid, due_date: s.due_date ? _s17Date(s.due_date) : null, status: s.status, xero_invoice_id: s.xero_invoice_id || null };
  });
  return {
    original_gross_pence: job.original_gross_pence || job.current_contract_gross_pence || 0,
    deposit_confirmed: !!job.deposit_bank_confirmed_at,
    deposit_confirmed_at: job.deposit_bank_confirmed_at ? _s17Date(job.deposit_bank_confirmed_at) : null,
    deposit_confirmed_by: job.deposit_bank_confirmed_by,
    finance_route: job.finance_route,
    contract_status: job.contract_status,
    stages: stageDetails,
    total_invoiced: stageDetails.reduce(function (s, d) { return s + d.gross_pence; }, 0),
    total_paid: stageDetails.reduce(function (s, d) { return s + d.paid_pence; }, 0),
    total_outstanding: stageDetails.reduce(function (s, d) { return s + d.outstanding_pence; }, 0)
  };
}

function _s17CRMSummary(store, job) {
  var ghlTasks = store.list('GHLTasks').filter(function (g) { return g.job_id === job.id; });
  return {
    ghl_tasks: ghlTasks.map(function (g) { return { id: g.id, task_id: g.task_id, opportunity_id: g.opportunity_id, target_pipeline_id: g.target_pipeline_id, completed_at: g.completed_at ? _s17Date(g.completed_at) : null }; })
  };
}

function _s17CancellationSummary(store, job) {
  var cancelTasks = store.list('Tasks').filter(function (t) { return t.job_id === job.id && t.group === 'Cancellation' && !['Complete', 'NotRequired'].includes(t.status); });
  return {
    is_cancelled: ['CancellationInProgress', 'Cancelled'].includes(job.workflow_stage),
    cancellation_at: job.cancellation_at ? _s17Date(job.cancellation_at) : null,
    cancellation_by: job.cancellation_by,
    cancellation_reason: job.cancellation_reason,
    open_review_tasks: cancelTasks.length,
    tasks: cancelTasks.map(_s17TaskSummary)
  };
}

function _s17SystemSummary(store, job) {
  var pendingOutbox = store.list('Outbox').filter(function (o) {
    return !['Succeeded', 'Cancelled'].includes(o.status) && (o.correlation_id === job.id || o.correlation_id === 'XI-' + job.id + '-deposit' || o.correlation_id === 'XI-' + job.id + '-interim' || o.correlation_id === 'XI-' + job.id + '-final');
  });
  var auditCount = store.list('AuditEvents').filter(function (a) { return a.entity_id === job.id; }).length;
  return {
    pending_outbox: pendingOutbox.length,
    audit_events: auditCount
  };
}

/* --- 3. JOB SEARCH --- */

function _s17JobSearch(store, query) {
  _s17Scope(store);
  if (!_s17Text(query)) return [];
  var q = query.toLowerCase().trim();
  var jobs = store.list('Jobs');
  var customers = store.list('Customers');
  var results = [];

  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    var cust = customers.filter(function (c) { return c.id === j.customer_id; })[0] || {};
    var match =
      (j.job_id && j.job_id.toLowerCase().indexOf(q) !== -1) ||
      (j.display_name && j.display_name.toLowerCase().indexOf(q) !== -1) ||
      (cust.last_name && cust.last_name.toLowerCase().indexOf(q) !== -1) ||
      (cust.postcode && cust.postcode.toLowerCase().indexOf(q) !== -1) ||
      (cust.email && cust.email.toLowerCase().indexOf(q) !== -1) ||
      (cust.phone && String(cust.phone).toLowerCase().indexOf(q) !== -1);
    if (match) {
      results.push({
        id: j.id, job_id: j.job_id, display_name: j.display_name,
        customer_name: [cust.first_name, cust.last_name].filter(Boolean).join(' ').trim(),
        postcode: cust.postcode || null,
        workflow_stage: j.workflow_stage, release_scope: j.release_scope
      });
    }
  }
  return results.slice(0, 50); // limit results
}

/* --- 4. OPERATIONAL QUEUES --- */

function _s17OperationalQueue(store, queueName) {
  _s17Scope(store);
  var allTasks = store.list('Tasks').filter(function (t) {
    return !['Complete', 'NotRequired', 'Cancelled'].includes(t.status);
  });

  var queueMap = {
    'booking': function () { return allTasks.filter(function (t) { return t.group === 'Booking' || t.group === 'Prebooking'; }); },
    'materials': function () { return allTasks.filter(function (t) { return t.group === 'Materials' || t.template_code === 'MAT01' || t.template_code === 'MAT05'; }); },
    'scaffold': function () { return allTasks.filter(function (t) { return t.group === 'Scaffold' || t.template_code === 'SCA01'; }); },
    'calls': function () { return allTasks.filter(function (t) { return t.group === 'Calls' || t.template_code === 'CAL01'; }); },
    'issues': function () { return allTasks.filter(function (t) { return t.related_entity_type === 'Issues'; }); },
    'commissioning': function () { return allTasks.filter(function (t) { return t.group === 'Commissioning'; }); },
    'handover': function () { return allTasks.filter(function (t) { return t.group === 'Handover'; }); },
    'payments': function () { return allTasks.filter(function (t) { return t.group === 'Finance' || t.template_code === 'FIN01' || t.template_code === 'FIN03'; }); },
    'ghl': function () { return allTasks.filter(function (t) { return t.group === 'CRM' || t.template_code === 'GHL01'; }); },
    'cancellation': function () { return allTasks.filter(function (t) { return t.group === 'Cancellation'; }); },
    'archive': function () { return allTasks.filter(function (t) { return t.group === 'System' && ['SYS01', 'SYS02'].includes(t.template_code); }); }
  };

  var filter = queueMap[queueName];
  if (!filter) return { queue: queueName, error: 'UNKNOWN_QUEUE', available: Object.keys(queueMap) };

  var tasks = filter().map(_s17TaskSummary);
  return { queue: queueName, count: tasks.length, tasks: tasks };
}

/* --- 5. ADMIN: RELEASE MODE STATUS --- */

function _s17AdminReleaseModes(store) {
  var modes = _s17Scope(store);
  var rows = store.list('ReleaseModes');
  return rows.map(function (r) {
    return {
      function_id: r.function_id,
      function_name: r.function_name,
      target_release: r.target_release,
      mode: r.mode,
      authorised_job_scope: r.authorised_job_scope,
      planned_target_mode: r.planned_target_mode,
      current_system: r.current_system,
      fallback: r.fallback,
      scope_boundary_notes: r.scope_boundary_notes,
      activation_time: r.activation_time,
      approved_version: r.approved_version,
      ben_approval_reference: r.ben_approval_reference
    };
  });
}

/* --- 6. ADMIN: SYSTEM STATUS --- */

function _s17AdminSystemStatus(store) {
  _s17Scope(store);
  var now = _s17Now();

  // Health checks
  var healthRows = store.list('HealthChecks');
  healthRows.sort(function (a, b) { return b.checked_at.localeCompare(a.checked_at); });
  var latestHealth = healthRows.length > 0 ? healthRows[0] : null;

  // CommitJournal
  var stalledCommits = store.list('CommitJournal').filter(function (j) { return j.state !== 'Committed'; });
  var recoveryNeeded = stalledCommits.filter(function (j) { return j.state === 'RecoveryRequired'; });

  // Outbox
  var uncertainOutbox = store.list('Outbox').filter(function (o) { return ['NeedsReview', 'RetryDue'].includes(o.status); });

  // NOT_CONFIGURED dependencies (derived from canonical known gaps)
  var notConfigured = [];
  var settings = store.list('Settings');
  function settingPresent(key) { return settings.some(function (s) { return s.key === key && s.typed_value !== 'NOT_CONFIGURED'; }); }

  // Check GHL configuration
  var ghlTasks = store.list('GHLTasks');
  var ghlConfigured = ghlTasks.some(function (g) { return g.opportunity_id && g.opportunity_id !== 'NOT_CONFIGURED'; });
  if (!ghlConfigured) notConfigured.push({ area: 'GHL pipeline/stage IDs', status: 'NOT_CONFIGURED', detail: 'No GHL opportunity_id configured' });

  // Check Xero configuration
  var xeroConfigured = store.list('InvoiceStages').some(function (s) { return s.xero_invoice_id && s.xero_invoice_id !== 'NOT_CONFIGURED'; });
  if (!xeroConfigured) notConfigured.push({ area: 'Xero API integration', status: 'NOT_CONFIGURED', detail: 'No real Xero invoice IDs present' });

  // Check backup destination
  var backupConfigured = store.list('ReportSnapshots').some(function (s) { return s.report_type === 'BackupManifest' && s.file_id; });
  if (!backupConfigured) notConfigured.push({ area: 'Backup Drive destination', status: 'NOT_CONFIGURED', detail: 'No Drive file_id on backup manifests' });

  // Check destructive restore
  notConfigured.push({ area: 'Destructive restore procedure', status: 'NOT_CONFIGURED', detail: 'Restore is dry-run only; full procedure not implemented' });

  // Check commissioning forms
  var commForms = store.list('CommissioningTemplates');
  if (commForms.length === 0) notConfigured.push({ area: 'Commissioning templates/forms', status: 'NOT_CONFIGURED', detail: 'No commissioning templates present' });

  // Check scaffolder contacts
  var scaffContacts = store.list('Contacts').filter(function (c) { return c.company_id && store.list('Companies').some(function (co) { return co.id === c.company_id && co.type === 'Scaffolder'; }); });
  if (scaffContacts.length === 0) notConfigured.push({ area: 'Scaffolder contacts', status: 'NOT_CONFIGURED', detail: 'No scaffolder company contacts configured' });

  return {
    generated_at: now,
    health: {
      latest_check: latestHealth ? { checked_at: latestHealth.checked_at, outcome: latestHealth.outcome, last_success: latestHealth.last_success, error_code: latestHealth.error_code } : null,
      total_checks: healthRows.length
    },
    commit_journal: {
      stalled: stalledCommits.length,
      recovery_required: recoveryNeeded.length,
      recovery_ids: recoveryNeeded.map(function (r) { return r.id; })
    },
    outbox: {
      uncertain: uncertainOutbox.length,
      uncertain_ids: uncertainOutbox.map(function (o) { return o.id; })
    },
    not_configured: notConfigured,
    not_configured_count: notConfigured.length
  };
}

/* --- 7. AUDIT / HISTORY --- */

function _s17AuditHistory(store, jobId) {
  _s17Scope(store);
  var job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, found: false };

  var events = [];

  // AuditEvents
  var auditEvents = store.list('AuditEvents').filter(function (a) { return a.entity_id === job.id || a.correlation_id === job.id; });
  for (var i = 0; i < auditEvents.length; i++) {
    var ae = auditEvents[i];
    var beforeSummary = null, afterSummary = null;
    try {
      if (ae.before_json) { var bj = JSON.parse(ae.before_json); beforeSummary = Object.keys(bj).slice(0, 5).join(','); }
      if (ae.after_json) { var aj = JSON.parse(ae.after_json); afterSummary = Object.keys(aj).slice(0, 5).join(','); }
    } catch (e) { /* ignore parse errors */ }
    events.push({
      type: 'audit', timestamp: ae.timestamp, action: ae.action,
      entity_type: ae.entity_type, entity_id: ae.entity_id,
      actor: ae.initiating_actor, reason: ae.reason,
      before_keys: beforeSummary, after_keys: afterSummary
    });
  }

  // TaskEvents for this job's tasks
  var jobTasks = store.list('Tasks').filter(function (t) { return t.job_id === job.id; });
  var taskIds = jobTasks.map(function (t) { return t.id; });
  var taskEvents = store.list('TaskEvents').filter(function (te) { return taskIds.includes(te.task_id); });
  for (var j = 0; j < taskEvents.length; j++) {
    var te = taskEvents[j];
    events.push({
      type: 'task_event', timestamp: te.timestamp || te.created_at, action: te.action || te.event_type,
      task_id: te.task_id, actor: te.actor || te.initiating_actor, note: te.note || te.completion_note
    });
  }

  // IssueEvents for this job's issues
  var jobIssues = store.list('Issues').filter(function (i) { return i.job_id === job.id; });
  var issueIds = jobIssues.map(function (i) { return i.id; });
  var issueEvents = store.list('IssueEvents').filter(function (ie) { return issueIds.includes(ie.issue_id); });
  for (var k = 0; k < issueEvents.length; k++) {
    var ie = issueEvents[k];
    events.push({
      type: 'issue_event', timestamp: ie.timestamp || ie.created_at, action: ie.action || ie.event_type,
      issue_id: ie.issue_id, actor: ie.actor || ie.initiating_actor, note: ie.note
    });
  }

  // Sort chronologically
  events.sort(function (a, b) { return (a.timestamp || '').localeCompare(b.timestamp || ''); });

  return {
    job_id: jobId,
    found: true,
    total_events: events.length,
    audit_events: auditEvents.length,
    task_events: taskEvents.length,
    issue_events: issueEvents.length,
    events: events.slice(0, 200) // limit for display
  };
}

/* --- 8. ACTION AVAILABILITY --- */

function _s17ActionAvailability(store, jobId) {
  var modes = _s17Scope(store);
  var job = store.get('Jobs', jobId);
  if (!job) return { job_id: jobId, found: false };

  function fnMode(fnId) {
    var m = modes[fnId];
    if (!m) return 'Disabled';
    return m.mode;
  }
  function fnScope(fnId) {
    var m = modes[fnId];
    if (!m) return 'None';
    return m.authorised_job_scope;
  }
  function fnEnabled(fnId) {
    return fnMode(fnId) !== 'Disabled' && fnScope(fnId) !== 'None';
  }
  function pilotGated(fnId) {
    if (!fnEnabled(fnId)) return false;
    if (fnScope(fnId) === 'Pilot' && !job.pilot_job) return false;
    return true;
  }
  function combinedMode(fnIds) {
    var modes_ = fnIds.map(fnMode);
    if (modes_.some(function (m) { return m === 'Disabled'; })) return 'Disabled';
    if (modes_.some(function (m) { return m === 'Manual'; })) return 'Manual';
    return 'Automated';
  }

  var stage = job.workflow_stage;
  var operational = !!job.operational_complete_at;
  var cancelled = ['CancellationInProgress', 'Cancelled'].includes(stage);
  var archived = !!job.archived_at;

  return {
    job_id: jobId,
    found: true,
    workflow_stage: stage,
    actions: {
      record_call: { available: !cancelled && !archived && pilotGated('FN-01'), mode: fnEnabled('FN-01') ? fnMode('FN-01') : 'Disabled' },
      resolve_issue: { available: !cancelled && !archived && pilotGated('FN-01'), mode: fnEnabled('FN-01') ? fnMode('FN-01') : 'Disabled' },
      approve_booking: { available: !cancelled && !archived && ['Prebooking', 'ReadyToBook', 'BookingInProgress'].includes(stage) && pilotGated('FN-01'), mode: fnEnabled('FN-01') ? fnMode('FN-01') : 'Disabled' },
      operational_completion: { available: !cancelled && !archived && ['InProgress', 'Aftercare'].includes(stage) && !operational && pilotGated('FN-01'), mode: fnEnabled('FN-01') ? fnMode('FN-01') : 'Disabled' },
      commissioning_review: { available: !cancelled && !archived && pilotGated('FN-07'), mode: fnEnabled('FN-07') ? fnMode('FN-07') : 'Disabled' },
      handover_approval: { available: !cancelled && !archived && pilotGated('FN-08'), mode: fnEnabled('FN-08') ? fnMode('FN-08') : 'Disabled' },
      deposit_confirmation: { available: !cancelled && !archived && !job.deposit_bank_confirmed_at && pilotGated('FN-15'), mode: fnEnabled('FN-15') ? fnMode('FN-15') : 'Disabled' },
      cancel_job: { available: !cancelled && !archived && fnEnabled('FN-01') && fnEnabled('FN-17'), mode: combinedMode(['FN-01', 'FN-17']), note: 'FN-01 + FN-17 required; GHL cancellation task is Manual' },
      reinstate_job: { available: stage === 'Cancelled' && fnEnabled('FN-01') && fnEnabled('FN-17'), mode: combinedMode(['FN-01', 'FN-17']) },
      archive_job: { available: !archived && operational && pilotGated('FN-13'), mode: fnEnabled('FN-13') ? fnMode('FN-13') : 'Disabled' },
      ghl_progression: { available: !cancelled && !archived && pilotGated('FN-11'), mode: fnEnabled('FN-11') ? fnMode('FN-11') : 'Disabled' }
    }
  };
}

/* --- 9. TASK ACTION AVAILABILITY --- */

function _s17TaskActionAvailability(store, taskId) {
  _s17Scope(store);
  var task = store.get('Tasks', taskId);
  if (!task) return { task_id: taskId, found: false };

  var completable = ['Open', 'Waiting', 'InProgress'].includes(task.status) && !task.revision_required;
  var blockable = task.status === 'Blocked';
  var alreadyDone = ['Complete', 'NotRequired', 'Cancelled'].includes(task.status);

  return {
    task_id: taskId,
    found: true,
    job_id: task.job_id,
    status: task.status,
    title: task.title,
    actions: {
      complete: { available: completable, note: completable ? null : (alreadyDone ? 'Already ' + task.status : 'Status ' + task.status + ' not completable') },
      reopen: { available: task.status === 'Complete', note: task.status === 'Complete' ? null : 'Not complete' }
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    S17_ADMIN_DEV_SHEET_ID,
    _s17Date, _s17Today, _s17GuardStore, _s17Scope,
    _s17OfficeToday, _s17JobOverview, _s17JobSearch,
    _s17OperationalQueue, _s17AdminReleaseModes, _s17AdminSystemStatus,
    _s17AuditHistory, _s17ActionAvailability, _s17TaskActionAvailability
  };
}
