/* Resilience review — unified uncertain-outcome queue, review tasks, failure alerts, generic outbox resolution.
 * Authority: 01 §3 ("a timeout after an external send is an uncertain outcome … raise a review task instead of blindly resending",
 * Outbox states, "display last successful sync, oldest pending command, oldest outbox item and last successful health check"),
 * RA01 ("uncertain external outcomes create a review task", "failure alerts and a last-success indicator", "documented manual check
 * if automation itself stops"), AGENT_RUNBOOK §I (visible failures, retry/recovery, outbound uncertain outcome review).
 * FN-14 (R1 Automated) / FN-16 (R1 Manual). Calendar rows are resolved by the calendar service; everything else here. No external calls. */
'use strict';

var RS_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var RS_SERVICE = 'ResilienceReview';
var RS_STALLED_MINUTES = 15;
var RS_TEMPLATES = {
  'RS-REVIEW': { title: 'Review uncertain outbound outcome', group: 'System' },
  'RS-ALERT': { title: 'Integration failure alert', group: 'System' },
  'RS-RECOVERY': { title: 'Recover interrupted commit', group: 'System' }
};
var RS_CALENDAR_ACTIONS = ['CalendarCreate', 'CalendarUpdate', 'CalendarCancel'];

function _rsText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _rsTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }
function _rsRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _rsTs(v) { if (v === null || v === undefined || v === '') return null; if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.toISOString(); var t = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { var d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString(); } return t; }
function _rsNow(input) { if (input && input.at) { var d = new Date(input.at); if (isNaN(d.getTime())) _rsRefuse('RS_DATE_INVALID'); return d.toISOString(); } return new Date().toISOString(); }
function _rsMinutes(fromIso, toIso) { return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000); }
function _rsOptional(store, name) { try { return store.list(name) || []; } catch (e) { return []; } }
function _rsGuardStore(store) { if (!store || !store.getSheetId || store.getSheetId() !== RS_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') _rsRefuse('RS_REFUSED: exact DEV sheet/environment required'); }
function _rsRequireFn14(store) {
  var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-14'; });
  if (rows.length !== 1 || rows[0].target_release !== 'R1') _rsRefuse('RS_REFUSED: FN-14 ReleaseMode invalid');
  if (rows[0].mode !== 'Automated' || rows[0].authorised_job_scope !== 'Pilot') _rsRefuse('RS_REFUSED: FN-14 must be Automated/Pilot (got ' + rows[0].mode + '/' + rows[0].authorised_job_scope + ')');
}
function _rsOwner(store) {
  var office = store.list('People').filter(function (p) { return _rsTrue(p.active) && p.role === 'Office'; });
  var tanya = office.filter(function (p) { return String(p.display_name || '').toLowerCase().indexOf('tanya') !== -1; })[0] || office[0];
  var ben = store.list('People').filter(function (p) { return _rsTrue(p.active) && ['Admin', 'Manager'].indexOf(p.role) !== -1 && String(p.display_name || '').toLowerCase().indexOf('ben') !== -1; })[0] || null;
  if (!tanya && !ben) _rsRefuse('RS_CONFIG: active Office or Admin owner required');
  return { owner: tanya || ben, backup: tanya && ben ? ben : null };
}
function _rsAudit(store, type, id, action, after, input, now, reason) {
  store.insert('AuditEvents', { id: 'AUD-RS-' + input.command_id + '-' + type + '-' + id + '-' + action, entity_type: type, entity_id: id, action: action, before_json: null, after_json: JSON.stringify(after), initiating_actor: input.actor, executing_service: RS_SERVICE, timestamp: now, correlation_id: input.command_id, reason: reason || input.reason || null, commit_id: 'RS-' + input.command_id, created_at: now });
}
function _rsTask(store, code, instanceKey, related, title, dueAt, input, now, jobId) {
  var existing = store.list('Tasks').filter(function (t) { return t.instance_key === instanceKey && ['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) === -1; });
  if (existing.length) return { created: false, task_id: existing[0].id };
  var tpl = store.list('TaskTemplates').filter(function (t) { return t.template_code === code && _rsTrue(t.active); })[0], def = RS_TEMPLATES[code], owners = _rsOwner(store);
  var task = { id: 'TASK-RS-' + instanceKey, job_id: jobId || null, template_code: code, instance_key: instanceKey, group: (tpl && tpl.group) || def.group, title: title || (tpl && tpl.title) || def.title, owner_id: owners.owner.id, backup_id: owners.backup ? owners.backup.id : null, related_entity_type: related.type, related_entity_id: related.id, due_at: dueAt, original_due_at: dueAt, priority: 1, status: 'Open', blocking_reason: null, next_followup_at: null, completed_at: null, completed_by: null, completion_note: null, evidence_id: null, revision_required: false, created_rule_version: 'RS-1.0', created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: RS_SERVICE, commit_id: 'RS-' + input.command_id };
  store.insert('Tasks', task);
  return { created: true, task_id: task.id };
}
function _rsCompleteTask(store, instanceKey, input, now, note) {
  var done = [];
  store.list('Tasks').forEach(function (t) { if (t.instance_key === instanceKey && ['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) === -1) { store.update('Tasks', t.id, { status: 'Complete', completed_at: now, completed_by: input.actor, completion_note: note, updated_at: now, updated_by: input.actor, version: Number(t.version || 0) + 1 }); done.push(t.id); } });
  return done;
}

/* --- 1. REVIEW QUEUE (read-only) --- */

function _rsReviewQueue(store, input) {
  _rsGuardStore(store);
  var now = _rsNow(input), items = [];
  store.list('Outbox').forEach(function (o) {
    var created = _rsTs(o.created_at), stalled = o.status === 'Processing' && created && _rsMinutes(created, now) >= RS_STALLED_MINUTES;
    if (['NeedsReview', 'RetryDue'].indexOf(o.status) === -1 && !stalled) return;
    var retries = Number(o.attempt_count || 0), jobId = o.correlation_id && store.get('Jobs', o.correlation_id) ? o.correlation_id : null;
    items.push({ kind: 'Outbox', id: o.id, action_type: o.action_type, status: stalled ? 'ProcessingStalled' : o.status, attempts: retries, target: o.target, summary: o.response_summary || null, external_id: o.external_id || null, age_minutes: created ? _rsMinutes(created, now) : null, job_id: jobId, owner_service: RS_CALENDAR_ACTIONS.indexOf(o.action_type) !== -1 ? 'CalendarService' : 'ResilienceReview', suggested: o.status === 'RetryDue' ? 'Wait for automatic retry; review if attempts exhaust' : stalled ? 'Reconcile by external id/reference before retry' : 'Resolve: confirm external result, cancel, or retry' });
  });
  store.list('Communications').forEach(function (c) { if (['Uncertain', 'Failed'].indexOf(c.status) === -1) return; items.push({ kind: 'Communications', id: c.id, action_type: c.type, status: c.status, summary: c.subject, external_id: c.external_message_id || null, age_minutes: _rsTs(c.updated_at) ? _rsMinutes(_rsTs(c.updated_at), now) : null, job_id: c.job_id || null, owner_service: 'ResilienceReview', suggested: 'Confirm with recipient before resending; a sent message is not supplier confirmation' }); });
  store.list('CommitJournal').forEach(function (j) {
    if (j.state === 'Committed') return;
    var prepared = _rsTs(j.prepared_at), age = prepared ? _rsMinutes(prepared, now) : null;
    if (j.state !== 'RecoveryRequired' && !(age !== null && age >= RS_STALLED_MINUTES)) return;
    items.push({ kind: 'CommitJournal', id: j.id, action_type: j.entity_type, status: j.state, summary: 'command ' + j.command_id + ' on ' + j.entity_type + '/' + j.entity_id, age_minutes: age, job_id: j.entity_type === 'Jobs' ? j.entity_id : null, owner_service: 'ResilienceReview', suggested: 'Run recovery; verify entity state before re-issuing the command' });
  });
  var oldestPendingOutbox = null, pendingCount = 0;
  store.list('Outbox').forEach(function (o) { if (o.status === 'Pending') { pendingCount++; var c = _rsTs(o.created_at); if (c && (!oldestPendingOutbox || c < oldestPendingOutbox)) oldestPendingOutbox = c; } });
  var lastHealth = null, lastHealthSuccess = null;
  store.list('HealthChecks').forEach(function (h) { var c = _rsTs(h.checked_at), s = _rsTs(h.last_success); if (c && (!lastHealth || c > lastHealth)) lastHealth = c; if (s && (!lastHealthSuccess || s > lastHealthSuccess)) lastHealthSuccess = s; });
  items.sort(function (a, b) { return (b.age_minutes || 0) - (a.age_minutes || 0); });
  return { generated_at: now, count: items.length, items: items, by_kind: items.reduce(function (m, i) { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {}), indicators: { pending_outbox: pendingCount, oldest_pending_outbox_at: oldestPendingOutbox, oldest_pending_outbox_minutes: oldestPendingOutbox ? _rsMinutes(oldestPendingOutbox, now) : null, last_health_check_at: lastHealth, last_health_success_at: lastHealthSuccess } };
}

/* --- 2. RAISE REVIEW TASKS (one open task per uncertain item; idempotent) --- */

function _rsRaiseReviewTasks(store, input) {
  _rsGuardStore(store); _rsRequireFn14(store);
  input = input || {};
  if (!_rsText(input.actor) || !_rsText(input.command_id)) _rsRefuse('RS_REVIEW: actor and command_id required');
  var now = _rsNow(input), queue = _rsReviewQueue(store, input), created = [], reused = [];
  queue.items.forEach(function (it) {
    if (it.status === 'RetryDue') return; /* automatic retry still pending */
    var code = it.kind === 'CommitJournal' ? 'RS-RECOVERY' : 'RS-REVIEW';
    var key = code + '-' + it.kind + '-' + it.id;
    var r = _rsTask(store, code, key, { type: it.kind, id: it.id }, (RS_TEMPLATES[code].title) + ' — ' + it.action_type + ' ' + it.id + ' (' + it.status + ')', now, input, now, it.job_id);
    (r.created ? created : reused).push({ task_id: r.task_id, kind: it.kind, id: it.id });
  });
  if (created.length) _rsAudit(store, 'Tasks', 'review-batch', 'RaiseReviewTasks', { created: created.length, reused: reused.length }, input, now, 'Uncertain outbound outcomes need human review');
  return { created: created, reused: reused, queue_count: queue.count, external_calls: 0 };
}

/* --- 3. FAILURE ALERTS (health critical / heartbeat stale-failing / stalled automation → one alert task per component per day) --- */

function _rsFailureAlerts(store, input) {
  _rsGuardStore(store); _rsRequireFn14(store);
  input = input || {};
  if (!_rsText(input.actor) || !_rsText(input.command_id)) _rsRefuse('RS_REVIEW: actor and command_id required');
  var now = _rsNow(input), day = now.slice(0, 10), alerts = [], created = [], reused = [];
  var health = input.health || null; /* optional injected S16 health result */
  if (health) {
    (health.issues || []).forEach(function (i) { alerts.push({ component: i.component, severity: 'Critical', detail: i.detail }); });
    (health.warnings || []).forEach(function (w) { if (/^Heartbeat:/.test(w.component) && (w.state === 'Failing' || w.state === 'Stale')) alerts.push({ component: w.component, severity: 'Warning', detail: w.detail }); });
  }
  var hb = {}; store.list('HealthChecks').forEach(function (h) { if (typeof h.integration === 'string' && h.integration.indexOf('Processing:') === 0) { var c = _rsTs(h.checked_at); if (!hb[h.integration] || c > hb[h.integration].at) hb[h.integration] = { at: c, outcome: h.outcome, last_success: _rsTs(h.last_success) }; } });
  var staleMinutes = Number((input && input.stale_minutes) || 120);
  Object.keys(hb).forEach(function (k) { var x = hb[k]; if (x.outcome !== 'OK' && (!x.last_success || _rsMinutes(x.last_success, now) > staleMinutes) && !alerts.some(function (a) { return a.component === 'Heartbeat:' + k.substring(11); })) alerts.push({ component: 'Heartbeat:' + k.substring(11), severity: 'Critical', detail: 'Last attempt ' + x.outcome + ', no success for ' + (x.last_success ? _rsMinutes(x.last_success, now) : '∞') + ' min' }); });
  var recovery = store.list('CommitJournal').filter(function (j) { return j.state === 'RecoveryRequired'; }).length;
  if (recovery) alerts.push({ component: 'CommitJournal', severity: 'Critical', detail: recovery + ' commit(s) require recovery' });
  var q = _rsReviewQueue(store, input);
  var exhausted = q.items.filter(function (i) { return i.kind === 'Outbox' && i.status === 'NeedsReview' && i.attempts >= 5; }).length;
  if (exhausted) alerts.push({ component: 'Outbox', severity: 'Warning', detail: exhausted + ' outbox item(s) exhausted retries' });
  alerts.forEach(function (a) {
    var key = 'RS-ALERT-' + a.component.replace(/[^A-Za-z0-9:_-]/g, '_') + '-' + day;
    var r = _rsTask(store, 'RS-ALERT', key, { type: 'HealthChecks', id: a.component }, RS_TEMPLATES['RS-ALERT'].title + ' — ' + a.severity + ' ' + a.component + ': ' + a.detail, now, input, now, null);
    (r.created ? created : reused).push({ task_id: r.task_id, component: a.component, severity: a.severity });
  });
  if (created.length) _rsAudit(store, 'Tasks', 'alert-batch-' + day, 'FailureAlerts', { created: created.length, alerts: alerts }, input, now, 'Integration failure alerts');
  return { alerts: alerts, created: created, reused: reused, manual_check: 'If automation itself stops (no heartbeat, no alerts), Tanya runs the documented manual daily check (SYS01) and Ben is backup.', external_calls: 0 };
}

/* --- 4. RESOLVE a non-calendar outbox item (human decision, audited, idempotent) --- */

function _rsResolveOutbox(store, input) {
  _rsGuardStore(store); _rsRequireFn14(store);
  input = input || {};
  if (!_rsText(input.actor) || !_rsText(input.command_id) || !_rsText(input.outbox_id) || !_rsText(input.reason)) _rsRefuse('RS_REVIEW: actor, command_id, outbox_id and reason required');
  if (['MarkSucceeded', 'Cancel', 'Retry'].indexOf(input.resolution) === -1) _rsRefuse('RS_REVIEW: resolution must be MarkSucceeded, Cancel or Retry');
  var auditId = 'AUD-RS-' + input.command_id + '-Outbox-' + input.outbox_id + '-Resolve' + input.resolution;
  if (store.get('AuditEvents', auditId)) return { replay: true, outbox_id: input.outbox_id };
  var out = store.get('Outbox', input.outbox_id); if (!out) _rsRefuse('RS_REVIEW: outbox row not found');
  if (RS_CALENDAR_ACTIONS.indexOf(out.action_type) !== -1) _rsRefuse('RS_REFUSED: calendar rows are resolved by the calendar service (runCalResolveReview)');
  if (['NeedsReview', 'RetryDue', 'Processing'].indexOf(out.status) === -1) _rsRefuse('RS_REVIEW: outbox status ' + out.status + ' is not reviewable');
  var now = _rsNow(input), patch;
  if (input.resolution === 'MarkSucceeded') { if (!_rsText(input.external_id)) _rsRefuse('RS_REVIEW: external_id required to mark succeeded (confirm the external result first)'); patch = { status: 'Succeeded', external_id: input.external_id.trim(), response_summary: 'RESOLVED by ' + input.actor + ': confirmed external result ' + input.external_id.trim() + ' — ' + input.reason }; }
  else if (input.resolution === 'Cancel') patch = { status: 'Cancelled', response_summary: 'RESOLVED by ' + input.actor + ': cancelled — ' + input.reason };
  else patch = { status: 'Pending', next_attempt: null, response_summary: 'RESOLVED by ' + input.actor + ': queued for retry — ' + input.reason };
  store.update('Outbox', out.id, patch);
  var completed = _rsCompleteTask(store, 'RS-REVIEW-Outbox-' + out.id, input, now, input.resolution + ': ' + input.reason);
  store.insert('AuditEvents', { id: auditId, entity_type: 'Outbox', entity_id: out.id, action: 'Resolve' + input.resolution, before_json: JSON.stringify(out), after_json: JSON.stringify(store.get('Outbox', out.id)), initiating_actor: input.actor, executing_service: RS_SERVICE, timestamp: now, correlation_id: input.command_id, reason: input.reason, commit_id: 'RS-' + input.command_id, created_at: now });
  return { replay: false, outbox_id: out.id, status: patch.status, completed_tasks: completed, external_calls: 0 };
}

if (typeof module !== 'undefined') {
  module.exports = { RS_DEV_SHEET_ID, RS_STALLED_MINUTES, RS_TEMPLATES, _rsReviewQueue, _rsRaiseReviewTasks, _rsFailureAlerts, _rsResolveOutbox, _rsGuardStore };
}
