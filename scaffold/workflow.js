/* Scaffold workflow — real scaffolder configuration, booking lifecycle, revisions, chase, weekly lists, complaints, planner rows.
 * Authority: 01 §4 ScaffoldBookings/Communications/Acknowledgements, 01 §9 scaffold planning, task templates SCA01–SCA05,
 * 04 S09 ("distinct planned/confirmed/actual states", "moving a scaffold activity creates a new instruction/confirmation
 * revision", "missing actual completion after the planned date creates Tanya's chase task", "an actual strip must not close
 * a complaint"), 02 manual ("booking the strip and confirming actual removal remain separate tasks"), AGENT_RUNBOOK §C.
 *
 * FN-04 Scaffold commitments (R2). All mutations require DEV sheet/env + FN-04 Automated/Pilot/R2 + a pilot R2 job.
 * Scaffolder communications are CAPTURED as Communications rows (status Draft); nothing is sent. No external calls.
 * Synthetic scaffolder companies (source_system starting S09 or SCF-fixture) are refused for non-synthetic jobs. No real scaffolder is
 * invented: real companies/contacts are entered through _scfConfigureScaffolder with values supplied by the business. */
'use strict';

var SCF_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var SCF_SERVICE = 'ScaffoldWorkflow';
var SCF_STATUSES = ['Requested', 'Confirmed', 'Erected', 'StripAuthorised', 'StripPlanned', 'StripConfirmed', 'Stripped', 'Cancelled'];
var SCF_COMPLAINT_CATEGORIES = ['MissedAppointment', 'Access', 'Damage', 'UnsafeConcern', 'Other'];
var SCF_TEMPLATES = {
  SCA01: { title: 'Notify and confirm scaffolder erect', group: 'Materials' },
  SCA02: { title: 'Confirm scaffold erected', group: 'Scaffold' },
  SCA03: { title: 'Book scaffold strip', group: 'Scaffold' },
  SCA04: { title: 'Confirm scaffold stripped', group: 'Scaffold' },
  SCA05: { title: 'Friday scaffolder erect/strip list', group: 'Scaffold' }
};

/* --- utilities --- */

function _scfText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _scfIsTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }
function _scfRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _scfDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) _scfRefuse('SCF_DATE_INVALID');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) _scfRefuse('SCF_DATE_INVALID');
  var iso = m[1] + '-' + m[2] + '-' + m[3], d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) _scfRefuse('SCF_DATE_INVALID');
  return iso;
}
function _scfTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') { if (isNaN(value.getTime())) _scfRefuse('SCF_DATE_INVALID'); return value.toISOString(); }
  var t = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { var d = new Date(t); if (isNaN(d.getTime())) _scfRefuse('SCF_DATE_INVALID'); return d.toISOString(); }
  return t;
}
function _scfNow(input) { if (input && input.at) { var t = _scfTimestamp(input.at); if (!/^\d{4}-\d{2}-\d{2}T/.test(String(t))) _scfRefuse('SCF_DATE_INVALID'); return new Date(t).toISOString(); } return new Date().toISOString(); }
function _scfAddDays(iso, days) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function _scfWeekday(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
/* UTC instant for a London local date + HH:MM (handles BST/GMT via Intl). */
function _scfLondonInstant(iso, hhmm) {
  iso = _scfDate(iso);
  var parts = hhmm.split(':'), guess = new Date(iso + 'T' + hhmm + ':00Z');
  var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  var seen = fmt.formatToParts(guess), map = {}; seen.forEach(function (p) { map[p.type] = p.value; });
  var offsetMin = (Number(map.hour === '24' ? 0 : map.hour) * 60 + Number(map.minute)) - (Number(parts[0]) * 60 + Number(parts[1]));
  return new Date(guess.getTime() - offsetMin * 60000).toISOString();
}

/* --- settings / staffed days --- */

function _scfSetting(store, key, fallback) {
  var rows = store.list('Settings').filter(function (s) { return s.key === key; });
  if (!rows.length) return fallback;
  rows.sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); });
  try { return JSON.parse(rows[0].typed_value); } catch (e) { return rows[0].typed_value; }
}
function _scfStaffedWeekdays(store) { var v = _scfSetting(store, 'office.staffed_weekdays', [1, 2, 3, 4, 5]); return Array.isArray(v) ? v : [1, 2, 3, 4, 5]; }
function _scfOfficeHours(store) { var v = _scfSetting(store, 'office.hours', { start: '09:00', end: '17:00' }); return v && /^\d{2}:\d{2}$/.test(v.start) && /^\d{2}:\d{2}$/.test(v.end) ? v : { start: '09:00', end: '17:00' }; }
function _scfClosed(store) { var out = []; store.list('Holidays').forEach(function (h) { if (_scfIsTrue(h.office_closed)) { try { var d = _scfDate(h.local_date); if (d) out.push(d); } catch (e) { /* skip */ } } }); return out; }
function _scfIsStaffed(store, iso) { return _scfStaffedWeekdays(store).indexOf(_scfWeekday(iso)) !== -1 && _scfClosed(store).indexOf(iso) === -1; }
function _scfPrevStaffed(store, iso) { var d = iso, n = 0; while (!_scfIsStaffed(store, d) && n < 60) { d = _scfAddDays(d, -1); n++; } return d; }
function _scfNextStaffed(store, iso) { var d = _scfAddDays(iso, 1), n = 0; while (!_scfIsStaffed(store, d) && n < 60) { d = _scfAddDays(d, 1); n++; } return d; }
function _scfDayEnd(store, iso) { return _scfLondonInstant(iso, _scfOfficeHours(store).end); }
function _scfDayStart(store, iso) { return _scfLondonInstant(iso, _scfOfficeHours(store).start); }

/* --- guards --- */

function _scfGuardStore(store) {
  if (!store || !store.getSheetId || store.getSheetId() !== SCF_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') _scfRefuse('SCF_REFUSED: exact DEV sheet/environment required');
}
function _scfMode(store) {
  var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-04'; });
  if (rows.length !== 1 || rows[0].target_release !== 'R2') _scfRefuse('SCF_REFUSED: FN-04 ReleaseMode invalid');
  return rows[0];
}
function _scfRequirePilot(store) {
  var r = _scfMode(store);
  if (r.mode !== 'Automated' || r.authorised_job_scope !== 'Pilot') _scfRefuse('SCF_REFUSED: FN-04 must be Automated/Pilot/R2 (got ' + r.mode + '/' + r.authorised_job_scope + ')');
}
function _scfJob(store, jobId) {
  var job = store.get('Jobs', jobId);
  if (!job) _scfRefuse('SCF_REVIEW: job not found');
  if (!_scfIsTrue(job.pilot_job) || job.release_scope !== 'R2') _scfRefuse('SCF_REFUSED: pilot R2 job required');
  if (job.cancellation_at || ['CancellationInProgress', 'Cancelled'].indexOf(job.workflow_stage) !== -1) _scfRefuse('S15_REVIEW: normal work suppressed');
  return job;
}
function _scfSynthetic(row) { return /^(S09|SCF-fixture)/.test(String((row && row.source_system) || '')) || (row && row.id === 'COMP-scaffold-dev'); }
function _scfScaffolder(store, companyId, job) {
  var c = store.get('Companies', companyId);
  if (!c || c.type !== 'Scaffolder' || !_scfIsTrue(c.active)) _scfRefuse('SCF_REVIEW: active Scaffolder company required');
  if (_scfSynthetic(c) && !_scfSynthetic(job)) _scfRefuse('SCF_REFUSED: synthetic scaffolder cannot be used for a non-synthetic job');
  return c;
}
function _scfBooking(store, bookingId) {
  var b = store.get('ScaffoldBookings', bookingId);
  if (!b) _scfRefuse('SCF_REVIEW: scaffold booking not found');
  return b;
}
function _scfOfficeOwner(store) {
  var people = store.list('People').filter(function (p) { return _scfIsTrue(p.active) && p.role === 'Office'; });
  var tanya = people.filter(function (p) { return String(p.display_name || '').toLowerCase().indexOf('tanya') !== -1; })[0];
  var owner = tanya || people[0];
  if (!owner) _scfRefuse('SCF_CONFIG: active Office owner required for scaffold tasks');
  return owner;
}

/* --- command journal (idempotent per command_id, conflict detection) --- */

function _scfCommandStart(store, input, entityType, entityId, changes) {
  if (!_scfText(input.command_id) || !_scfText(input.actor)) _scfRefuse('SCF_REVIEW: command_id and actor required');
  var id = 'CJ-SCF-' + input.command_id, encoded = JSON.stringify(changes), existing = store.get('CommitJournal', id);
  if (existing) {
    if (existing.command_id !== input.command_id || existing.entity_type !== entityType || existing.entity_id !== entityId || existing.changes_json !== encoded) _scfRefuse('SCF_REVIEW: conflicting command identity');
    if (existing.state !== 'Committed') _scfRefuse('SCF_RECOVERY_REQUIRED: incomplete scaffold command ' + input.command_id);
    return { replay: true };
  }
  var now = _scfNow(input);
  store.insert('CommitJournal', { id: id, commit_id: 'SCF-' + input.command_id, state: 'Prepared', command_id: input.command_id, entity_type: entityType, entity_id: entityId, expected_version: input.expected_version === undefined ? null : input.expected_version, changes_json: encoded, prepared_at: now, committed_at: null, created_at: now });
  return { replay: false };
}
function _scfCommit(store, input, now) { store.update('CommitJournal', 'CJ-SCF-' + input.command_id, { state: 'Committed', committed_at: now }); }
function _scfAudit(store, type, id, action, before, after, input, now) {
  store.insert('AuditEvents', { id: 'AUD-SCF-' + input.command_id + '-' + type + '-' + id + '-' + action, entity_type: type, entity_id: id, action: action, before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null, initiating_actor: input.actor, executing_service: SCF_SERVICE, timestamp: now, correlation_id: input.command_id, reason: input.reason || null, commit_id: 'SCF-' + input.command_id, created_at: now });
}
function _scfExpectVersion(row, input) { if (input.expected_version === undefined || input.expected_version === null) _scfRefuse('SCF_REVIEW: expected_version required'); if (Number(row.version) !== Number(input.expected_version)) _scfRefuse('SCF_STALE: version'); }
function _scfPatch(store, table, row, patch, input, now) {
  var p = {}; for (var k in patch) if (patch.hasOwnProperty(k)) p[k] = patch[k];
  p.updated_at = now; p.updated_by = input.actor; p.version = Number(row.version || 0) + 1;
  store.update(table, row.id, p);
  return store.get(table, row.id);
}

/* --- tasks (SCA01–SCA05) --- */

function _scfTemplate(store, code) {
  var rows = store.list('TaskTemplates').filter(function (t) { return t.template_code === code && _scfIsTrue(t.active); });
  return rows[0] || null;
}
function _scfTask(store, code, booking, instanceKey, dueAt, input, now, titleSuffix) {
  var existing = store.list('Tasks').filter(function (t) { return t.instance_key === instanceKey && t.status !== 'Cancelled'; });
  if (existing.length) return { created: false, task_id: existing[0].id, code: code };
  var tpl = _scfTemplate(store, code), def = SCF_TEMPLATES[code], owner = _scfOfficeOwner(store);
  if (!tpl) _scfRefuse('SCF_CONFIG: TaskTemplate ' + code + ' missing/inactive');
  var task = {
    id: 'TASK-SCF-' + instanceKey, job_id: booking.job_id, template_code: code, instance_key: instanceKey, group: tpl.group || def.group,
    title: (tpl.title || def.title) + (titleSuffix ? ' — ' + titleSuffix : ''), owner_id: owner.id, backup_id: owner.backup_person_id || null,
    related_entity_type: 'ScaffoldBookings', related_entity_id: booking.id, due_at: dueAt, original_due_at: dueAt, priority: 1, status: 'Open',
    blocking_reason: null, next_followup_at: null, completed_at: null, completed_by: null, completion_note: null, evidence_id: null, revision_required: false,
    created_rule_version: 'SCF-1.0', created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: SCF_SERVICE, commit_id: 'SCF-' + input.command_id
  };
  store.insert('Tasks', task);
  return { created: true, task_id: task.id, code: code };
}
function _scfCompleteTasks(store, booking, codes, input, now, note) {
  var done = [];
  store.list('Tasks').forEach(function (t) {
    if (t.related_entity_id !== booking.id || t.related_entity_type !== 'ScaffoldBookings' || codes.indexOf(t.template_code) === -1) return;
    if (['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) !== -1) return;
    store.update('Tasks', t.id, { status: 'Complete', completed_at: now, completed_by: input.actor, completion_note: note, updated_at: now, updated_by: input.actor, version: Number(t.version || 0) + 1 });
    done.push(t.id);
  });
  return done;
}
function _scfCancelTasks(store, booking, input, now) {
  var done = [];
  store.list('Tasks').forEach(function (t) {
    if (t.related_entity_id !== booking.id || t.related_entity_type !== 'ScaffoldBookings') return;
    if (['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) !== -1) return;
    store.update('Tasks', t.id, { status: 'Cancelled', completion_note: input.reason, updated_at: now, updated_by: input.actor, version: Number(t.version || 0) + 1 });
    done.push(t.id);
  });
  return done;
}

/* --- captured scaffolder communications (no send) --- */

function _scfContactsSnapshot(store, companyId) {
  return store.list('Contacts').filter(function (c) { return c.company_id === companyId && _scfIsTrue(c.active); }).map(function (c) { return { contact_id: c.id, name: c.name, email: c.email || 'NOT_CONFIGURED', channel: c.preferred_channel || 'NOT_CONFIGURED' }; });
}
function _scfCommunication(store, booking, company, type, subject, body, revision, input, now, weekStart) {
  var id = 'COMM-SCF-' + booking.id + '-' + type + '-R' + revision;
  var existing = store.get('Communications', id);
  if (existing) return { created: false, communication_id: id };
  store.insert('Communications', {
    id: id, job_id: booking.job_id, company_id: company.id, type: type, subject: subject, body_snapshot: JSON.stringify(body), attachment_ids: booking.scope_file_id ? JSON.stringify([booking.scope_file_id]) : null,
    recipients_snapshot: JSON.stringify(_scfContactsSnapshot(store, company.id)), covered_week_start: weekStart || null, delivery_date: null, revision: revision, status: 'Draft',
    approved_at: null, approved_by: null, sent_at: null, external_message_id: null, outbox_id: null,
    created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, commit_id: 'SCF-' + input.command_id
  });
  store.insert('CommunicationJobs', { id: 'CJOB-' + id, communication_id: id, job_id: booking.job_id, order_id: null, scaffold_booking_id: booking.id, entity_revision: revision, created_at: now, commit_id: 'SCF-' + input.command_id });
  return { created: true, communication_id: id };
}
function _scfAcknowledge(store, booking, company, communicationId, input, now, response) {
  var id = 'ACK-SCF-' + booking.id + '-R' + booking.revision;
  if (store.get('Acknowledgements', id)) return { created: false, acknowledgement_id: id };
  store.insert('Acknowledgements', { id: id, communication_id: communicationId, company_id: company.id, entity_id: booking.id, acknowledged_revision: booking.revision, response: response, response_text: input.response_text || null, received_at: input.received_at ? _scfTimestamp(input.received_at) : now, recorded_by: input.actor, evidence_id: input.evidence_id || null, created_at: now, commit_id: 'SCF-' + input.command_id });
  return { created: true, acknowledgement_id: id };
}
function _scfInstructionBody(booking, company, job) {
  return { scaffold_booking_id: booking.id, job_id: job.id, job_reference: job.job_id, customer_display: job.display_name, company: company.name, revision: booking.revision, erect_planned_at: booking.erect_planned_at, strip_forecast_at: booking.strip_forecast_at, strip_planned_at: booking.strip_planned_at, access_notes: booking.access_notes, scope_file_id: booking.scope_file_id, note: 'CAPTURED DRAFT — not sent. FN-04 R2.' };
}

/* --- 1. SCAFFOLDER CONFIGURATION (values supplied by the business; nothing invented) --- */

function _scfScaffolders(store) {
  _scfGuardStore(store);
  return store.list('Companies').filter(function (c) { return c.type === 'Scaffolder'; }).map(function (c) {
    var contacts = _scfContactsSnapshot(store, c.id);
    return { company_id: c.id, name: c.name, active: _scfIsTrue(c.active), standard_lead_days: c.standard_lead_days === null || c.standard_lead_days === undefined ? null : Number(c.standard_lead_days), synthetic: _scfSynthetic(c), contacts: contacts, configured: !_scfSynthetic(c) && contacts.some(function (x) { return x.email !== 'NOT_CONFIGURED'; }) };
  });
}
function _scfConfigureScaffolder(store, input) {
  _scfGuardStore(store);
  if (!_scfText(input.name) || !_scfText(input.company_id)) _scfRefuse('SCF_REVIEW: company_id and name required');
  if (/dev scaffold|synthetic|test/i.test(input.name) || /^COMP-scaffold-dev$/.test(input.company_id)) _scfRefuse('SCF_REFUSED: synthetic names are not real scaffolders');
  var lead = input.standard_lead_days === undefined || input.standard_lead_days === null ? null : Number(input.standard_lead_days);
  if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 60)) _scfRefuse('SCF_REVIEW: standard_lead_days 0-60');
  var changes = { company_id: input.company_id, name: input.name.trim(), standard_lead_days: lead, notes: input.notes || null, contact: input.contact || null };
  var cmd = _scfCommandStart(store, input, 'Companies', input.company_id, changes);
  if (cmd.replay) return { replay: true, company_id: input.company_id };
  var now = _scfNow(input), existing = store.get('Companies', input.company_id), company;
  if (existing) {
    if (existing.type !== 'Scaffolder') _scfRefuse('SCF_REFUSED: company exists with another type');
    company = _scfPatch(store, 'Companies', existing, { name: changes.name, active: true, standard_lead_days: lead, notes: changes.notes }, input, now);
    _scfAudit(store, 'Companies', company.id, 'ConfigureScaffolder', existing, company, input, now);
  } else {
    company = { id: input.company_id, name: changes.name, type: 'Scaffolder', active: true, standard_lead_days: lead, delivery_weekday: null, notes: changes.notes, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: 'SCF-config', commit_id: 'SCF-' + input.command_id };
    store.insert('Companies', company);
    _scfAudit(store, 'Companies', company.id, 'ConfigureScaffolder', null, company, input, now);
  }
  var contact = null;
  if (input.contact && _scfText(input.contact.name)) {
    var cid = input.contact.contact_id || ('CONT-' + input.company_id + '-' + input.contact.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    var prior = store.get('Contacts', cid);
    var fields = { company_id: input.company_id, name: input.contact.name.trim(), email: _scfText(input.contact.email) ? input.contact.email.trim().toLowerCase() : 'NOT_CONFIGURED', phone: _scfText(input.contact.phone) ? input.contact.phone.trim() : 'NOT_CONFIGURED', contact_role: input.contact.contact_role || 'Scaffolding', active: true, preferred_channel: input.contact.preferred_channel || 'NOT_CONFIGURED' };
    if (prior) { if (prior.company_id !== input.company_id) _scfRefuse('SCF_REFUSED: contact belongs to another company'); contact = _scfPatch(store, 'Contacts', prior, fields, input, now); _scfAudit(store, 'Contacts', cid, 'ConfigureScaffolderContact', prior, contact, input, now); }
    else { contact = Object.assign({ id: cid, verified_at: null, verified_by: null, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: 'SCF-config', commit_id: 'SCF-' + input.command_id }, fields); store.insert('Contacts', contact); _scfAudit(store, 'Contacts', cid, 'ConfigureScaffolderContact', null, contact, input, now); }
  }
  _scfCommit(store, input, now);
  return { replay: false, company_id: company.id, company: company, contact: contact, external_calls: 0 };
}

/* --- 2. REQUEST BOOKING --- */

function _scfRequest(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var job = _scfJob(store, input.job_id);
  if (!_scfIsTrue(job.scaffold_required)) _scfRefuse('SCF_REVIEW: job does not require scaffold');
  var company = _scfScaffolder(store, input.company_id, job);
  var erect = _scfDate(input.erect_planned_at); if (!erect) _scfRefuse('SCF_REVIEW: erect_planned_at required');
  var forecast = _scfDate(input.strip_forecast_at);
  if (forecast && forecast < erect) _scfRefuse('SCF_REVIEW: strip forecast before erect');
  var cost = input.quoted_cost_pence === undefined || input.quoted_cost_pence === null ? null : Number(input.quoted_cost_pence);
  if (cost !== null && (!Number.isInteger(cost) || cost < 0)) _scfRefuse('SCF_REVIEW: quoted_cost_pence must be a non-negative integer');
  var active = store.list('ScaffoldBookings').filter(function (b) { return b.job_id === job.id && b.status !== 'Cancelled'; });
  var changes = { job_id: job.id, company_id: company.id, erect_planned_at: erect, strip_forecast_at: forecast, access_notes: input.access_notes || null, scope_file_id: input.scope_file_id || null, quoted_cost_pence: cost };
  var cmd = _scfCommandStart(store, input, 'Jobs', job.id, changes);
  if (cmd.replay) return { replay: true, status: 'Replayed', booking: active[0] || null };
  if (active.length) _scfRefuse('SCF_REVIEW: job already has an active scaffold booking ' + active[0].id);
  _scfExpectVersion(job, input);
  var now = _scfNow(input), prior = store.list('ScaffoldBookings').filter(function (b) { return b.job_id === job.id; }).length;
  var bookingId = prior === 0 ? 'SB-' + job.id : 'SB-' + job.id + '-R' + (prior + 1);
  var booking = {
    id: bookingId, job_id: job.id, company_id: company.id, erect_planned_at: erect, erect_confirmed_at: null, erect_actual_at: null,
    strip_forecast_at: forecast, strip_authorised_at: null, strip_authorised_by: null, strip_planned_at: null, strip_confirmed_at: null, strip_actual_at: null,
    status: 'Requested', revision: 1, confirmed_revision: null, access_notes: changes.access_notes, scope_file_id: changes.scope_file_id,
    quoted_cost_pence: cost, actual_cost_pence: null, invoice_reference: null, related_issue_ids: null,
    created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: SCF_SERVICE, commit_id: 'SCF-' + input.command_id
  };
  store.insert('ScaffoldBookings', booking);
  store.update('Jobs', job.id, { updated_at: now, updated_by: input.actor, version: Number(job.version) + 1 });
  var lead = Number(company.standard_lead_days || 0);
  var due = _scfDayStart(store, _scfPrevStaffed(store, _scfAddDays(erect, -lead)));
  var task = _scfTask(store, 'SCA01', booking, 'SCA01-' + booking.id + '-R1', due, input, now, company.name + ' erect ' + erect);
  var comm = _scfCommunication(store, booking, company, 'ScaffoldInstruction', 'Scaffold erect instruction — ' + job.display_name + ' (rev 1)', _scfInstructionBody(booking, company, job), 1, input, now);
  _scfAudit(store, 'ScaffoldBookings', booking.id, 'Request', null, booking, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: 'Requested', booking: booking, task: task, communication: comm, external_calls: 0 };
}

/* --- 3. CONFIRM ERECT (scaffolder acknowledged current revision) --- */

function _scfConfirmErect(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id), company = _scfScaffolder(store, b.company_id, job);
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'ConfirmErect', revision: b.revision });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (['Requested', 'Confirmed'].indexOf(b.status) === -1) _scfRefuse('SCF_REVIEW: cannot confirm erect from ' + b.status);
  _scfExpectVersion(b, input);
  var now = _scfNow(input);
  var after = _scfPatch(store, 'ScaffoldBookings', b, { erect_confirmed_at: now, confirmed_revision: b.revision, status: 'Confirmed' }, input, now);
  var commId = 'COMM-SCF-' + b.id + '-ScaffoldInstruction-R' + b.revision;
  if (!store.get('Communications', commId)) _scfCommunication(store, b, company, 'ScaffoldInstruction', 'Scaffold erect instruction — ' + job.display_name + ' (rev ' + b.revision + ')', _scfInstructionBody(b, company, job), b.revision, input, now);
  var ack = _scfAcknowledge(store, b, company, commId, input, now, 'Confirmed');
  var completed = _scfCompleteTasks(store, b, ['SCA01'], input, now, 'Scaffolder confirmed revision ' + b.revision);
  var task = _scfTask(store, 'SCA02', after, 'SCA02-' + b.id + '-R' + b.revision, _scfDayEnd(store, b.erect_planned_at), input, now, 'expected ' + _scfDate(b.erect_planned_at));
  _scfAudit(store, 'ScaffoldBookings', b.id, 'ConfirmErect', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, acknowledgement: ack, completed_tasks: completed, task: task, external_calls: 0 };
}

/* --- 4. RECORD ERECTED (actual) --- */

function _scfRecordErected(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id); _scfJob(store, b.job_id);
  var actual = _scfDate(input.erect_actual_at); if (!actual) _scfRefuse('SCF_REVIEW: erect_actual_at required');
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'RecordErected', erect_actual_at: actual });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (['Requested', 'Confirmed'].indexOf(b.status) === -1) _scfRefuse('SCF_REVIEW: cannot record erected from ' + b.status);
  _scfExpectVersion(b, input);
  var now = _scfNow(input);
  if (actual > _scfDate(now)) _scfRefuse('SCF_REVIEW: erect_actual_at cannot be in the future');
  var after = _scfPatch(store, 'ScaffoldBookings', b, { erect_actual_at: actual, status: 'Erected' }, input, now);
  var planned = _scfDate(b.erect_planned_at);
  var completed = _scfCompleteTasks(store, b, ['SCA01', 'SCA02'], input, now, 'Erected ' + actual + (actual !== planned ? ' (planned ' + planned + ')' : ''));
  _scfAudit(store, 'ScaffoldBookings', b.id, 'RecordErected', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, completed_tasks: completed, late: actual > planned, external_calls: 0 };
}

/* --- 5. AUTHORISE STRIP (customer happy + no strip-blocking issues) --- */

function _scfStripBlockers(store, job, b) {
  var blockers = [];
  if (!job.customer_happy_at) blockers.push('CUSTOMER_NOT_HAPPY');
  if (b.status !== 'Erected') blockers.push('NOT_ERECTED');
  var issues = store.list('Issues').filter(function (i) { return i.job_id === job.id && _scfIsTrue(i.blocks_strip) && ['Resolved', 'Closed'].indexOf(i.status) === -1; });
  if (issues.length) blockers.push('STRIP_BLOCKING_ISSUES:' + issues.map(function (i) { return i.id; }).join(','));
  return blockers;
}
function _scfAuthoriseStrip(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id);
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'AuthoriseStrip' });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  _scfExpectVersion(b, input);
  var blockers = _scfStripBlockers(store, job, b);
  if (blockers.length) { store.update('CommitJournal', 'CJ-SCF-' + input.command_id, { state: 'Committed', committed_at: _scfNow(input) }); return { replay: false, status: 'Blocked', blockers: blockers, booking: b, external_calls: 0 }; }
  var now = _scfNow(input);
  var after = _scfPatch(store, 'ScaffoldBookings', b, { strip_authorised_at: now, strip_authorised_by: input.actor, status: 'StripAuthorised' }, input, now);
  var task = _scfTask(store, 'SCA03', after, 'SCA03-' + b.id + '-R' + b.revision, _scfDayStart(store, _scfNextStaffed(store, _scfDate(now))), input, now, null);
  _scfAudit(store, 'ScaffoldBookings', b.id, 'AuthoriseStrip', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, task: task, external_calls: 0 };
}

/* --- 6. PLAN STRIP (date → new instruction revision) --- */

function _scfPlanStrip(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id), company = _scfScaffolder(store, b.company_id, job);
  var strip = _scfDate(input.strip_planned_at); if (!strip) _scfRefuse('SCF_REVIEW: strip_planned_at required');
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'PlanStrip', strip_planned_at: strip });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (['StripAuthorised', 'StripPlanned', 'StripConfirmed'].indexOf(b.status) === -1) _scfRefuse('SCF_REVIEW: strip must be authorised before planning (status ' + b.status + ')');
  if (b.erect_actual_at && strip < _scfDate(b.erect_actual_at)) _scfRefuse('SCF_REVIEW: strip before erect');
  _scfExpectVersion(b, input);
  var now = _scfNow(input), revision = Number(b.revision) + 1;
  var after = _scfPatch(store, 'ScaffoldBookings', b, { strip_planned_at: strip, revision: revision, status: 'StripPlanned' }, input, now);
  var comm = _scfCommunication(store, after, company, 'ScaffoldStripInstruction', 'Scaffold strip instruction — ' + job.display_name + ' (rev ' + revision + ')', _scfInstructionBody(after, company, job), revision, input, now);
  _scfAudit(store, 'ScaffoldBookings', b.id, 'PlanStrip', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, communication: comm, acknowledgement_required: true, external_calls: 0 };
}

/* --- 7. CONFIRM STRIP (scaffolder acknowledged strip revision) --- */

function _scfConfirmStrip(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id), company = _scfScaffolder(store, b.company_id, job);
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'ConfirmStrip', revision: b.revision });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (['StripPlanned', 'StripConfirmed'].indexOf(b.status) === -1 || !b.strip_planned_at) _scfRefuse('SCF_REVIEW: strip must be planned before confirmation');
  _scfExpectVersion(b, input);
  var now = _scfNow(input);
  var after = _scfPatch(store, 'ScaffoldBookings', b, { strip_confirmed_at: now, confirmed_revision: b.revision, status: 'StripConfirmed' }, input, now);
  var commId = 'COMM-SCF-' + b.id + '-ScaffoldStripInstruction-R' + b.revision;
  if (!store.get('Communications', commId)) _scfCommunication(store, b, company, 'ScaffoldStripInstruction', 'Scaffold strip instruction — ' + job.display_name + ' (rev ' + b.revision + ')', _scfInstructionBody(b, company, job), b.revision, input, now);
  var ack = _scfAcknowledge(store, b, company, commId, input, now, 'Confirmed');
  var completed = _scfCompleteTasks(store, b, ['SCA03'], input, now, 'Strip booked ' + _scfDate(b.strip_planned_at) + ', confirmed revision ' + b.revision);
  var task = _scfTask(store, 'SCA04', after, 'SCA04-' + b.id + '-R' + b.revision, _scfDayEnd(store, b.strip_planned_at), input, now, 'expected ' + _scfDate(b.strip_planned_at));
  _scfAudit(store, 'ScaffoldBookings', b.id, 'ConfirmStrip', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, acknowledgement: ack, completed_tasks: completed, task: task, external_calls: 0 };
}

/* --- 8. RECORD STRIPPED (actual removal; complaints stay open) --- */

function _scfRecordStripped(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id);
  var actual = _scfDate(input.strip_actual_at); if (!actual) _scfRefuse('SCF_REVIEW: strip_actual_at required');
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'RecordStripped', strip_actual_at: actual, actual_cost_pence: input.actual_cost_pence === undefined ? null : input.actual_cost_pence });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (['StripAuthorised', 'StripPlanned', 'StripConfirmed'].indexOf(b.status) === -1) _scfRefuse('SCF_REVIEW: strip must be authorised before recording removal (status ' + b.status + ')');
  if (!b.erect_actual_at) _scfRefuse('SCF_REVIEW: erect_actual_at missing');
  if (actual < _scfDate(b.erect_actual_at)) _scfRefuse('SCF_REVIEW: strip before erect');
  _scfExpectVersion(b, input);
  var now = _scfNow(input);
  if (actual > _scfDate(now)) _scfRefuse('SCF_REVIEW: strip_actual_at cannot be in the future');
  var patch = { strip_actual_at: actual, status: 'Stripped' };
  if (input.actual_cost_pence !== undefined && input.actual_cost_pence !== null) { var c = Number(input.actual_cost_pence); if (!Number.isInteger(c) || c < 0) _scfRefuse('SCF_REVIEW: actual_cost_pence must be a non-negative integer'); patch.actual_cost_pence = c; }
  if (_scfText(input.invoice_reference)) patch.invoice_reference = input.invoice_reference.trim();
  var after = _scfPatch(store, 'ScaffoldBookings', b, patch, input, now);
  var completed = _scfCompleteTasks(store, b, ['SCA03', 'SCA04'], input, now, 'Stripped ' + actual + (input.evidence_id ? ' evidence ' + input.evidence_id : ''));
  var openComplaints = store.list('Issues').filter(function (i) { return i.job_id === job.id && i.responsible_company_id === b.company_id && ['Resolved', 'Closed'].indexOf(i.status) === -1; }).map(function (i) { return i.id; });
  _scfAudit(store, 'ScaffoldBookings', b.id, 'RecordStripped', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, completed_tasks: completed, open_complaints: openComplaints, late: b.strip_planned_at ? actual > _scfDate(b.strip_planned_at) : false, external_calls: 0 };
}

/* --- 9. CHANGE DATES (move → new revision requiring re-acknowledgement) --- */

function _scfChangeDates(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id), company = _scfScaffolder(store, b.company_id, job);
  if (!_scfText(input.reason)) _scfRefuse('SCF_REVIEW: reason required');
  var erect = _scfDate(input.erect_planned_at), strip = _scfDate(input.strip_planned_at);
  if (!erect && !strip) _scfRefuse('SCF_REVIEW: erect_planned_at or strip_planned_at required');
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'ChangeDates', erect_planned_at: erect, strip_planned_at: strip, reason: input.reason });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (['Cancelled', 'Stripped'].indexOf(b.status) !== -1) _scfRefuse('SCF_REVIEW: cannot move a ' + b.status + ' booking');
  if (erect && b.erect_actual_at) _scfRefuse('SCF_REVIEW: scaffold already erected; erect date cannot move');
  if (strip && ['StripAuthorised', 'StripPlanned', 'StripConfirmed'].indexOf(b.status) === -1) _scfRefuse('SCF_REVIEW: strip not yet authorised');
  _scfExpectVersion(b, input);
  var now = _scfNow(input), revision = Number(b.revision) + 1, patch = { revision: revision }, tasks = [], comms = [];
  if (erect) { patch.erect_planned_at = erect; if (b.status === 'Confirmed') patch.status = 'Requested'; }
  if (strip) { patch.strip_planned_at = strip; if (b.status === 'StripConfirmed') patch.status = 'StripPlanned'; }
  var after = _scfPatch(store, 'ScaffoldBookings', b, patch, input, now);
  if (erect) {
    var lead = Number(company.standard_lead_days || 0);
    tasks.push(_scfTask(store, 'SCA01', after, 'SCA01-' + b.id + '-R' + revision, _scfDayStart(store, _scfPrevStaffed(store, _scfAddDays(erect, -lead))), input, now, 'revised erect ' + erect + ' (rev ' + revision + ')'));
    comms.push(_scfCommunication(store, after, company, 'ScaffoldInstruction', 'Scaffold erect instruction — ' + job.display_name + ' (rev ' + revision + ')', _scfInstructionBody(after, company, job), revision, input, now));
  }
  if (strip) {
    tasks.push(_scfTask(store, 'SCA03', after, 'SCA03-' + b.id + '-R' + revision, _scfDayStart(store, _scfNextStaffed(store, _scfDate(now))), input, now, 'revised strip ' + strip + ' (rev ' + revision + ')'));
    comms.push(_scfCommunication(store, after, company, 'ScaffoldStripInstruction', 'Scaffold strip instruction — ' + job.display_name + ' (rev ' + revision + ')', _scfInstructionBody(after, company, job), revision, input, now));
  }
  _scfAudit(store, 'ScaffoldBookings', b.id, 'ChangeDates', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: after.status, booking: after, revision: revision, acknowledgement_required: true, tasks: tasks, communications: comms, external_calls: 0 };
}

/* --- 10. CANCEL BOOKING (before erection only; erected scaffold must go through strip) --- */

function _scfCancel(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = store.get('Jobs', b.job_id), company = store.get('Companies', b.company_id);
  if (!_scfText(input.reason)) _scfRefuse('SCF_REVIEW: reason required');
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'Cancel', reason: input.reason });
  if (cmd.replay) return { replay: true, status: b.status, booking: b };
  if (b.status === 'Cancelled') _scfRefuse('SCF_REVIEW: already cancelled');
  if (b.erect_actual_at && !b.strip_actual_at) _scfRefuse('SCF_REFUSED: scaffold is erected; arrange safe strip and confirm removal instead of cancelling');
  _scfExpectVersion(b, input);
  var now = _scfNow(input), revision = Number(b.revision) + 1;
  var after = _scfPatch(store, 'ScaffoldBookings', b, { status: 'Cancelled', revision: revision }, input, now);
  var cancelled = _scfCancelTasks(store, b, input, now);
  var comm = company ? _scfCommunication(store, after, company, 'ScaffoldCancellation', 'Scaffold booking cancelled — ' + (job ? job.display_name : b.job_id) + ' (rev ' + revision + ')', Object.assign(_scfInstructionBody(after, company, job || { id: b.job_id }), { reason: input.reason }), revision, input, now) : null;
  _scfAudit(store, 'ScaffoldBookings', b.id, 'Cancel', b, after, input, now);
  _scfCommit(store, input, now);
  return { replay: false, status: 'Cancelled', booking: after, cancelled_tasks: cancelled, communication: comm, acknowledgement_required: true, external_calls: 0 };
}

/* --- 11. COMPLAINT (Issues row; never auto-closed by strip) --- */

function _scfComplaint(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  var b = _scfBooking(store, input.booking_id), job = _scfJob(store, b.job_id);
  if (SCF_COMPLAINT_CATEGORIES.indexOf(input.category) === -1) _scfRefuse('SCF_REVIEW: category must be one of ' + SCF_COMPLAINT_CATEGORIES.join('/'));
  if (!_scfText(input.description)) _scfRefuse('SCF_REVIEW: description required');
  var cmd = _scfCommandStart(store, input, 'ScaffoldBookings', b.id, { action: 'Complaint', category: input.category, description: input.description });
  if (cmd.replay) { var ids = []; try { ids = JSON.parse(b.related_issue_ids || '[]'); } catch (e) { ids = []; } return { replay: true, issue_id: 'ISS-SCF-' + input.command_id, related_issue_ids: ids }; }
  var now = _scfNow(input), owner = _scfOfficeOwner(store), issueId = 'ISS-SCF-' + input.command_id;
  var severity = input.severity || (input.category === 'UnsafeConcern' ? 'High' : 'Normal');
  var blocksStrip = input.blocks_strip === true || (input.blocks_strip === undefined && input.category === 'UnsafeConcern');
  var issue = {
    id: issueId, job_id: job.id, work_package_id: null, type: 'Complaint', category: input.category, description: input.description.trim(), raised_at: now, raised_by: input.actor,
    responsible_person_id: null, responsible_company_id: b.company_id, office_owner_id: owner.id, severity: severity, status: 'Open',
    due_at: _scfDayStart(store, _scfNextStaffed(store, _scfDate(now))), next_followup_at: null, blocks_completion: input.blocks_completion === true, blocks_strip: blocksStrip,
    estimated_value_pence: null, approved_value_pence: null, approval_status: 'NotRequired', approved_at: null, approved_by: null, resolution: null, resolved_at: null, closed_at: null, closed_by: null,
    customer_resolution_confirmed: null, linked_return_package_id: null, evidence_folder_id: input.evidence_folder_id || null,
    created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: SCF_SERVICE, commit_id: 'SCF-' + input.command_id
  };
  store.insert('Issues', issue);
  var related = []; try { related = JSON.parse(b.related_issue_ids || '[]'); } catch (e) { related = []; }
  if (!Array.isArray(related)) related = [];
  related.push(issueId);
  var after = _scfPatch(store, 'ScaffoldBookings', b, { related_issue_ids: JSON.stringify(related) }, input, now);
  _scfAudit(store, 'Issues', issueId, 'ScaffoldComplaint', null, issue, input, now);
  _scfCommit(store, input, now);
  return { replay: false, issue_id: issueId, issue: issue, booking: after, blocks_strip: blocksStrip, external_calls: 0 };
}

/* --- 12. CHASE (missed planned erect/strip → Tanya chase task; idempotent per booking+revision+kind) --- */

function _scfChase(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  if (!_scfText(input.command_id) || !_scfText(input.actor)) _scfRefuse('SCF_REVIEW: command_id and actor required');
  var now = _scfNow(input), today = _scfDate(now), created = [], considered = 0;
  store.list('ScaffoldBookings').forEach(function (b) {
    if (b.status === 'Cancelled') return;
    var job = store.get('Jobs', b.job_id);
    if (!job || !_scfIsTrue(job.pilot_job) || job.release_scope !== 'R2' || job.cancellation_at) return;
    considered++;
    var erect = _scfDate(b.erect_planned_at), strip = _scfDate(b.strip_planned_at);
    if (erect && !b.erect_actual_at && erect < today && ['Requested', 'Confirmed'].indexOf(b.status) !== -1) {
      var r = _scfTask(store, 'SCA02', b, 'SCA02-' + b.id + '-R' + b.revision + '-CHASE', _scfDayStart(store, today), input, now, 'CHASE: erect planned ' + erect + ' not recorded');
      if (r.created) created.push(r);
    }
    if (strip && !b.strip_actual_at && strip < today && ['StripPlanned', 'StripConfirmed'].indexOf(b.status) !== -1) {
      var r2 = _scfTask(store, 'SCA04', b, 'SCA04-' + b.id + '-R' + b.revision + '-CHASE', _scfDayStart(store, today), input, now, 'CHASE: strip planned ' + strip + ' not recorded');
      if (r2.created) created.push(r2);
    }
  });
  return { considered: considered, created: created, external_calls: 0 };
}

/* --- 13. WEEKLY LIST (SCA05: next week's erects / authorised strips per company, captured draft + acknowledgement task) --- */

/* Monday on or before the date; a Sunday rolls forward to the coming Monday (lists are prepared for the week ahead). */
function _scfWeekStart(iso) { var d = _scfDate(iso), wd = _scfWeekday(d); return _scfAddDays(d, wd === 0 ? 1 : 1 - wd); }
function _scfWeeklyList(store, input) {
  _scfGuardStore(store); _scfRequirePilot(store);
  if (!_scfText(input.command_id) || !_scfText(input.actor)) _scfRefuse('SCF_REVIEW: command_id and actor required');
  var now = _scfNow(input), weekStart = input.week_start ? _scfWeekStart(input.week_start) : _scfWeekStart(_scfAddDays(_scfDate(now), 7)), weekEnd = _scfAddDays(weekStart, 6);
  var byCompany = {};
  store.list('ScaffoldBookings').forEach(function (b) {
    if (b.status === 'Cancelled') return;
    var job = store.get('Jobs', b.job_id);
    if (!job || !_scfIsTrue(job.pilot_job) || job.release_scope !== 'R2' || job.cancellation_at) return;
    var erect = _scfDate(b.erect_planned_at), strip = _scfDate(b.strip_planned_at);
    var items = [];
    if (erect && !b.erect_actual_at && erect >= weekStart && erect <= weekEnd) items.push({ kind: 'Erect', date: erect, booking_id: b.id, job_id: job.id, job_reference: job.job_id, customer_display: job.display_name, revision: b.revision, acknowledged: b.confirmed_revision === b.revision, access_notes: b.access_notes });
    if (strip && b.strip_authorised_at && !b.strip_actual_at && strip >= weekStart && strip <= weekEnd) items.push({ kind: 'Strip', date: strip, booking_id: b.id, job_id: job.id, job_reference: job.job_id, customer_display: job.display_name, revision: b.revision, acknowledged: b.confirmed_revision === b.revision, access_notes: b.access_notes });
    if (!items.length) return;
    if (!byCompany[b.company_id]) byCompany[b.company_id] = [];
    byCompany[b.company_id] = byCompany[b.company_id].concat(items);
  });
  var lists = [];
  Object.keys(byCompany).sort().forEach(function (companyId) {
    var company = store.get('Companies', companyId); if (!company) return;
    var items = byCompany[companyId].sort(function (a, b) { return a.date.localeCompare(b.date); });
    var id = 'COMM-SCF-WEEKLY-' + companyId + '-' + weekStart, existing = store.get('Communications', id);
    if (!existing) {
      store.insert('Communications', { id: id, job_id: null, company_id: companyId, type: 'ScaffoldWeeklyList', subject: 'Scaffold erect/strip list w/c ' + weekStart + ' — ' + company.name, body_snapshot: JSON.stringify({ week_start: weekStart, week_end: weekEnd, items: items, note: 'CAPTURED DRAFT — not sent. FN-04 R2.' }), attachment_ids: null, recipients_snapshot: JSON.stringify(_scfContactsSnapshot(store, companyId)), covered_week_start: weekStart, delivery_date: null, revision: 1, status: 'Draft', approved_at: null, approved_by: null, sent_at: null, external_message_id: null, outbox_id: null, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, commit_id: 'SCF-' + input.command_id });
      items.forEach(function (it) { var cj = 'CJOB-' + id + '-' + it.booking_id; if (!store.get('CommunicationJobs', cj)) store.insert('CommunicationJobs', { id: cj, communication_id: id, job_id: it.job_id, order_id: null, scaffold_booking_id: it.booking_id, entity_revision: it.revision, created_at: now, commit_id: 'SCF-' + input.command_id }); });
    }
    var friday = _scfAddDays(weekStart, -3);
    var task = _scfTask(store, 'SCA05', { id: id, job_id: null }, 'SCA05-' + companyId + '-' + weekStart, _scfLondonInstant(friday, '12:00'), input, now, company.name + ' w/c ' + weekStart);
    lists.push({ company_id: companyId, company: company.name, communication_id: id, created: !existing, items: items.length, unacknowledged: items.filter(function (i) { return !i.acknowledged; }).length, task: task });
  });
  return { week_start: weekStart, week_end: weekEnd, lists: lists, external_calls: 0 };
}

/* --- 14. READ MODELS --- */

function _scfBookingView(store, bookingId) {
  _scfGuardStore(store);
  var b = store.get('ScaffoldBookings', bookingId); if (!b) return { found: false, booking_id: bookingId };
  var job = store.get('Jobs', b.job_id), company = store.get('Companies', b.company_id);
  var tasks = store.list('Tasks').filter(function (t) { return t.related_entity_type === 'ScaffoldBookings' && t.related_entity_id === b.id; });
  var comms = store.list('Communications').filter(function (c) { return store.list('CommunicationJobs').some(function (j) { return j.communication_id === c.id && j.scaffold_booking_id === b.id; }); });
  var acks = store.list('Acknowledgements').filter(function (a) { return a.entity_id === b.id; });
  var related = []; try { related = JSON.parse(b.related_issue_ids || '[]'); } catch (e) { related = []; }
  var issues = store.list('Issues').filter(function (i) { return related.indexOf(i.id) !== -1 || (i.job_id === b.job_id && i.responsible_company_id === b.company_id); });
  var ackRequired = b.status !== 'Cancelled' && b.status !== 'Stripped' && Number(b.confirmed_revision || 0) < Number(b.revision);
  var next = b.status === 'Requested' ? 'Send instruction; record scaffolder confirmation (SCA01)' : b.status === 'Confirmed' ? 'Record actual erect (SCA02)' : b.status === 'Erected' ? (job && job.customer_happy_at ? 'Authorise strip' : 'Awaiting customer happy before strip authorisation') : b.status === 'StripAuthorised' ? 'Book strip date (SCA03)' : b.status === 'StripPlanned' ? 'Record scaffolder strip confirmation' : b.status === 'StripConfirmed' ? 'Record actual removal (SCA04)' : b.status === 'Stripped' ? 'Complete' : 'Cancelled';
  return {
    found: true, booking: b, job: job ? { id: job.id, job_reference: job.job_id, display_name: job.display_name, customer_happy_at: job.customer_happy_at, workflow_stage: job.workflow_stage } : null,
    company: company ? { id: company.id, name: company.name, standard_lead_days: company.standard_lead_days, synthetic: _scfSynthetic(company), contacts: _scfContactsSnapshot(store, company.id) } : null,
    acknowledgement_required: ackRequired, strip_blockers: job && b.status === 'Erected' ? _scfStripBlockers(store, job, b) : [], next_action: next,
    tasks: tasks.map(function (t) { return { id: t.id, template_code: t.template_code, title: t.title, status: t.status, due_at: t.due_at, owner_id: t.owner_id }; }),
    communications: comms.map(function (c) { return { id: c.id, type: c.type, revision: c.revision, status: c.status, subject: c.subject }; }),
    acknowledgements: acks.map(function (a) { return { id: a.id, acknowledged_revision: a.acknowledged_revision, response: a.response, received_at: a.received_at }; }),
    issues: issues.map(function (i) { return { id: i.id, category: i.category, status: i.status, blocks_strip: _scfIsTrue(i.blocks_strip), severity: i.severity }; })
  };
}
/* Planner rows for erect/strip activities in [from, to]. Pure read. */
function _scfPlannerRows(store, from, to) {
  var a = _scfDate(from), z = _scfDate(to), rows = [];
  store.list('ScaffoldBookings').forEach(function (b) {
    if (b.status === 'Cancelled') return;
    var company = store.get('Companies', b.company_id), ack = Number(b.confirmed_revision || 0) >= Number(b.revision);
    function push(kind, date, actual, confirmed) {
      var d = _scfDate(date); if (!d || d < a || d > z) return;
      rows.push({ job_id: b.job_id, scaffold_booking_id: b.id, company_id: b.company_id, company: company ? company.name : null, kind: kind, date: d, status: b.status, revision: b.revision, acknowledged: ack, confirmed: !!confirmed, actual_recorded: !!actual });
    }
    push('Erect', b.erect_planned_at, b.erect_actual_at, b.erect_confirmed_at);
    if (b.strip_planned_at) push('Strip', b.strip_planned_at, b.strip_actual_at, b.strip_confirmed_at);
    else if (b.strip_forecast_at && !b.strip_actual_at) push('StripForecast', b.strip_forecast_at, null, false);
  });
  return rows.sort(function (x, y) { return x.date.localeCompare(y.date) || x.scaffold_booking_id.localeCompare(y.scaffold_booking_id); });
}

if (typeof module !== 'undefined') {
  module.exports = {
    SCF_DEV_SHEET_ID, SCF_STATUSES, SCF_COMPLAINT_CATEGORIES, SCF_TEMPLATES,
    _scfScaffolders, _scfConfigureScaffolder, _scfRequest, _scfConfirmErect, _scfRecordErected, _scfAuthoriseStrip, _scfPlanStrip, _scfConfirmStrip, _scfRecordStripped,
    _scfChangeDates, _scfCancel, _scfComplaint, _scfChase, _scfWeeklyList, _scfBookingView, _scfPlannerRows,
    _scfDate, _scfLondonInstant, _scfWeekStart, _scfStripBlockers, _scfGuardStore, _scfSynthetic
  };
}
