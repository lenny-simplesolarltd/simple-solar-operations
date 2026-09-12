/* DEV Calendar write service — drains Calendar* Outbox rows produced by S11 planning/moves/installer
 * changes and S15 cancellation into the exact DEV Google Calendar through an injectable adapter.
 * Authority: 01 §3 outbox/delivery certainty, 04 S11 Calendar, AGENT_RUNBOOK §B (Apps Script owns writes,
 * create once, persist external ID, update on move, cancel appropriately, no duplicates, audit every
 * external mutation, DEV calendar only, starts disabled/manual).
 *
 * DEV uses ONE shared calendar (confirmed 12 Sep 2026): S11 queues every link against CAL_DEV_CALENDAR_ID and
 * People.calendar_id is never consulted.
 *
 * Safety model (all must hold before any external call):
 *   - exact DEV sheet + DEV environment (store guard)
 *   - FN-02 Calendar entries ReleaseMode Automated/Pilot/R2
 *   - S01_CONFIG.calendarMode === 'LIVE' (default CAPTURE: nothing is sent, rows stay Pending)
 *   - target calendar === CAL_DEV_CALENDAR_ID AND listed in S01_CONFIG.allowedCalendarIds
 *   - Outbox row marked Processing BEFORE the call; a crash leaves an uncertain row that the next run
 *     reconciles by tag search before ever creating again.
 * No mail, Drive, Xero, GHL or HTTP. PROD is structurally unreachable (calendar ID is hardcoded to DEV). */
'use strict';

var CAL_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var CAL_DEV_CALENDAR_ID = 'c_78af3ebb19540667b0e233ef74f02738e5a813073a6c55ee33898aacb3f39b91@group.calendar.google.com';
var CAL_ACTIONS = ['CalendarCreate', 'CalendarUpdate', 'CalendarCancel'];
var CAL_MAX_ATTEMPTS = 5;
var CAL_BACKOFF_MINUTES = [1, 2, 4, 8, 16];
var CAL_STALLED_MINUTES = 15;
var CAL_TAG_PREFIX = '[SSO:';
var CAL_SERVICE = 'CalendarService';
var CAL_DEFAULT_BATCH = 20;

/* --- utilities --- */

function _calText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _calRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _calReview(code) { var e = new Error('CAL_REVIEW: ' + code); e.code = 'CAL_REVIEW'; e.review = code; throw e; }
function _calTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) _calRefuse('CAL_DATE_INVALID');
    return value.toISOString();
  }
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    var d = new Date(text);
    if (isNaN(d.getTime())) _calRefuse('CAL_DATE_INVALID');
    return d.toISOString();
  }
  return text;
}
function _calLocalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) _calRefuse('CAL_DATE_INVALID');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) _calRefuse('CAL_DATE_INVALID');
  return m[1] + '-' + m[2] + '-' + m[3];
}
function _calNow(input) {
  if (input && input.now) {
    var t = _calTimestamp(input.now);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(String(t))) _calRefuse('CAL_DATE_INVALID');
    return new Date(t).toISOString();
  }
  return new Date().toISOString();
}
function _calMinutesBetween(fromIso, toIso) { return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000); }
function _calAddMinutes(iso, minutes) { return new Date(new Date(iso).getTime() + minutes * 60000).toISOString(); }
function _calErrorText(e) { var s = String(e && e.message ? e.message : e).replace(/\s+/g, ' ').trim(); return s.length > 240 ? s.substring(0, 240) : s; }
function _calTag(linkId) { return CAL_TAG_PREFIX + linkId + ']'; }
function _calIsTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }

/* --- guards --- */

function _calGuardStore(store) {
  if (!store || !store.getSheetId || store.getSheetId() !== CAL_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV')
    _calRefuse('CAL_REFUSED: exact DEV sheet/environment required');
}
function _calMode(store) {
  var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-02'; });
  if (rows.length !== 1) _calRefuse('CAL_REFUSED: FN-02 ReleaseMode missing/duplicate');
  var r = rows[0];
  if (r.target_release !== 'R2') _calRefuse('CAL_REFUSED: FN-02 target_release must be R2');
  return { mode: r.mode, scope: r.authorised_job_scope, id: r.id, version: Number(r.version || 0) };
}
function _calRequirePilot(store) {
  var m = _calMode(store);
  if (m.mode !== 'Automated' || m.scope !== 'Pilot') _calRefuse('CAL_REFUSED: FN-02 must be Automated/Pilot (got ' + m.mode + '/' + m.scope + ')');
  return m;
}
/* Config from S01_CONFIG (Script Properties) or injected. Live sending is opt-in and DEV-locked. */
function _calConfig(input) {
  var c = (input && input.config) || null;
  if (!c || typeof c !== 'object') _calRefuse('CAL_REFUSED: config required');
  if (c.environment !== 'DEV') _calRefuse('CAL_REFUSED: config.environment must be DEV');
  var mode = c.calendarMode === 'LIVE' ? 'LIVE' : 'CAPTURE';
  var allow = Array.isArray(c.allowedCalendarIds) ? c.allowedCalendarIds.filter(_calText).map(function (s) { return s.trim(); }) : [];
  return { mode: mode, allowedCalendarIds: allow, environment: 'DEV' };
}
function _calTargetAllowed(config, calendarId) {
  if (!_calText(calendarId)) return { ok: false, reason: 'CALENDAR_TARGET_MISSING' };
  var id = calendarId.trim();
  if (id !== CAL_DEV_CALENDAR_ID) return { ok: false, reason: 'CALENDAR_TARGET_NOT_DEV' };
  if (config.allowedCalendarIds.indexOf(id) === -1) return { ok: false, reason: 'CALENDAR_TARGET_NOT_ALLOWLISTED' };
  return { ok: true, calendar_id: id };
}

/* --- adapter contract ---
 * api.getEventById(calendarId, eventId) -> {id, title, start, end, all_day} | null
 * api.findEventsByTag(calendarId, tag, fromDate, toDate) -> [{id, title, start, end}]
 * api.createAllDayEvent(calendarId, {title, start, end, description}) -> {id}
 * api.updateEvent(calendarId, eventId, {title, start, end, description}) -> {id}
 * api.deleteEvent(calendarId, eventId) -> {deleted: true}
 * Every adapter method is only ever called with calendarId === CAL_DEV_CALENDAR_ID. */
function _calDefaultApi() {
  function cal(calendarId) {
    if (calendarId !== CAL_DEV_CALENDAR_ID) _calRefuse('CAL_REFUSED: adapter target must be the DEV calendar');
    var c = CalendarApp.getCalendarById(calendarId);
    if (!c) _calRefuse('CAL_TRANSIENT: DEV calendar not accessible');
    return c;
  }
  function dateAt(iso) { return new Date(iso + 'T00:00:00'); }
  function shape(ev) { return ev ? { id: ev.getId(), title: ev.getTitle(), start: ev.getStartTime(), end: ev.getEndTime(), all_day: ev.isAllDayEvent(), description: ev.getDescription() } : null; }
  return {
    getEventById: function (calendarId, eventId) { var ev = cal(calendarId).getEventById(eventId); return shape(ev); },
    findEventsByTag: function (calendarId, tag, fromDate, toDate) {
      var from = new Date(dateAt(fromDate).getTime() - 7 * 86400000), to = new Date(dateAt(toDate).getTime() + 7 * 86400000);
      return cal(calendarId).getEvents(from, to, { search: tag }).map(shape).filter(function (e) { return e && String(e.description || '').indexOf(tag) !== -1; });
    },
    createAllDayEvent: function (calendarId, spec) {
      var ev = cal(calendarId).createAllDayEvent(spec.title, dateAt(spec.start), dateAt(spec.end), { description: spec.description });
      return { id: ev.getId() };
    },
    updateEvent: function (calendarId, eventId, spec) {
      var ev = cal(calendarId).getEventById(eventId);
      if (!ev) return null;
      ev.setTitle(spec.title);
      ev.setAllDayDates(dateAt(spec.start), dateAt(spec.end));
      ev.setDescription(spec.description);
      return { id: ev.getId() };
    },
    deleteEvent: function (calendarId, eventId) {
      var ev = cal(calendarId).getEventById(eventId);
      if (!ev) return { deleted: false, missing: true };
      ev.deleteEvent();
      return { deleted: true };
    }
  };
}

/* --- row helpers --- */

function _calCalendarOutbox(store) {
  return store.list('Outbox').filter(function (o) { return CAL_ACTIONS.indexOf(o.action_type) !== -1; });
}
function _calLinkForOutbox(store, out) {
  var byOutbox = store.list('CalendarLinks').filter(function (l) { return l.outbox_id === out.id; });
  if (byOutbox.length === 1) return byOutbox[0];
  if (byOutbox.length > 1) return null;
  /* Fallback: payloads that carry the link id (S15 cancellations store JSON in payload_hash). */
  try {
    var p = JSON.parse(out.payload_hash);
    if (p && _calText(p.calendar_link_id)) return store.get('CalendarLinks', p.calendar_link_id);
  } catch (e) { /* hashed payload */ }
  return null;
}
function _calSpec(link) {
  var snap = null;
  try { snap = link.description_snapshot ? JSON.parse(link.description_snapshot) : null; } catch (e) { snap = null; }
  var start = _calLocalDate(link.start_at || (snap && snap.start_at));
  var end = _calLocalDate(link.end_at || (snap && snap.end_at));
  if (!start || !end) _calReview('EVENT_DATES_MISSING');
  if (end <= start) _calReview('EVENT_DATES_INVALID');
  var title = (snap && _calText(snap.title)) ? snap.title : ('Simple Solar DEV — ' + link.job_id);
  var lines = [_calTag(link.id), 'Job: ' + link.job_id, 'Revision: ' + link.entity_revision, 'DEV synthetic — system managed; do not edit in Calendar'];
  if (snap && snap.work_package_id) lines.splice(2, 0, 'Work package: ' + snap.work_package_id);
  return { title: title, start: start, end: end, description: lines.join('\n'), tag: _calTag(link.id) };
}
function _calAudit(store, link, out, action, before, after, input, now, reason) {
  store.insert('AuditEvents', {
    id: 'AUD-CAL-' + out.id + '-' + action + '-' + Number(out.attempt_count || 0),
    entity_type: 'CalendarLinks', entity_id: link ? link.id : (out.id), action: action,
    before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null,
    initiating_actor: input.actor, executing_service: CAL_SERVICE, timestamp: now,
    correlation_id: out.id, reason: reason || null, commit_id: 'CAL-' + out.id + '-' + Number(out.attempt_count || 0), created_at: now
  });
}
function _calPatchLink(store, link, patch, now, actor) {
  var p = {}; for (var k in patch) if (patch.hasOwnProperty(k)) p[k] = patch[k];
  p.updated_at = now; p.updated_by = actor; p.version = Number(link.version || 0) + 1;
  store.update('CalendarLinks', link.id, p);
  return store.get('CalendarLinks', link.id);
}

/* --- outcome recorders --- */

function _calSucceed(store, link, out, action, externalId, summary, input, now, linkPatch) {
  var before = JSON.parse(JSON.stringify(link));
  var patch = { external_event_id: externalId || link.external_event_id || null, event_uid: externalId || link.event_uid || null, last_success_at: now, last_synced_revision: link.entity_revision, error: null, status: 'Active' };
  if (linkPatch) for (var k in linkPatch) if (linkPatch.hasOwnProperty(k)) patch[k] = linkPatch[k];
  var after = _calPatchLink(store, link, patch, now, input.actor);
  store.update('Outbox', out.id, { status: 'Succeeded', external_id: patch.external_event_id, response_summary: summary });
  _calAudit(store, link, out, action, before, after, input, now, summary);
  return { outbox_id: out.id, link_id: link.id, action: action, outcome: 'Succeeded', external_event_id: patch.external_event_id, summary: summary };
}
function _calNeedsReview(store, link, out, action, code, detail, input, now) {
  var summary = 'NEEDS_REVIEW ' + code + (detail ? ': ' + detail : '');
  store.update('Outbox', out.id, { status: 'NeedsReview', response_summary: summary.substring(0, 400) });
  if (link) {
    var before = JSON.parse(JSON.stringify(link));
    var after = _calPatchLink(store, link, { status: 'Error', error: summary.substring(0, 400) }, now, input.actor);
    _calAudit(store, link, out, action + 'Failed', before, after, input, now, summary.substring(0, 400));
  } else {
    _calAudit(store, null, out, action + 'Failed', null, { outbox_status: 'NeedsReview' }, input, now, summary.substring(0, 400));
  }
  return { outbox_id: out.id, link_id: link ? link.id : null, action: action, outcome: 'NeedsReview', code: code, detail: detail || null };
}
function _calRetry(store, link, out, action, detail, input, now) {
  var attempt = Number(out.attempt_count || 0);
  if (attempt >= CAL_MAX_ATTEMPTS) return _calNeedsReview(store, link, out, action, 'MAX_RETRIES_EXCEEDED', detail, input, now);
  var minutes = CAL_BACKOFF_MINUTES[Math.min(attempt, CAL_BACKOFF_MINUTES.length) - 1] || CAL_BACKOFF_MINUTES[0];
  var next = _calAddMinutes(now, minutes);
  var summary = 'RETRY_DUE attempt ' + attempt + ': ' + detail;
  store.update('Outbox', out.id, { status: 'RetryDue', next_attempt: next, response_summary: summary.substring(0, 400) });
  var before = JSON.parse(JSON.stringify(link));
  var after = _calPatchLink(store, link, { status: 'Error', error: summary.substring(0, 400) }, now, input.actor);
  _calAudit(store, link, out, action + 'Retry', before, after, input, now, summary.substring(0, 400));
  return { outbox_id: out.id, link_id: link.id, action: action, outcome: 'RetryDue', next_attempt: next, detail: detail };
}

/* --- reconcile: find an event already created for this link (uncertain prior attempt) --- */

function _calReconcile(api, calendarId, link, spec) {
  var found = api.findEventsByTag(calendarId, spec.tag, spec.start, spec.end) || [];
  if (found.length === 0) return { found: false };
  if (found.length > 1) return { found: true, ambiguous: true, ids: found.map(function (f) { return f.id; }) };
  return { found: true, ambiguous: false, id: found[0].id };
}

/* --- one outbox row --- */

function _calProcessOne(store, out, input, config, api, now) {
  var link = _calLinkForOutbox(store, out);
  var action = out.action_type;
  if (!link) return _calNeedsReview(store, null, out, action, 'CALENDAR_LINK_MISSING', 'no CalendarLinks row references outbox ' + out.id, input, now);
  var target = _calTargetAllowed(config, link.calendar_id);
  if (!target.ok) return _calNeedsReview(store, link, out, action, target.reason, 'link.calendar_id=' + (link.calendar_id || 'null'), input, now);
  if (_calText(out.target) && out.target.trim() !== target.calendar_id && out.target !== 'NOT_CONFIGURED')
    return _calNeedsReview(store, link, out, action, 'CALENDAR_TARGET_MISMATCH', 'outbox.target differs from link.calendar_id', input, now);
  var calendarId = target.calendar_id;
  var priorUncertain = Number(out.attempt_count || 0) > 0 || out.status === 'RetryDue';

  /* Mark Processing BEFORE any external call so a crash is visible as an uncertain row. */
  var attempt = Number(out.attempt_count || 0) + 1;
  store.update('Outbox', out.id, { status: 'Processing', attempt_count: attempt });
  out = store.get('Outbox', out.id);
  link = _calPatchLink(store, link, { last_attempt_at: now }, now, input.actor);

  var spec;
  try { spec = action === 'CalendarCancel' ? null : _calSpec(link); }
  catch (e) { return _calNeedsReview(store, link, out, action, e.review || 'EVENT_SPEC_INVALID', _calErrorText(e), input, now); }

  try {
    if (action === 'CalendarCancel') {
      if (!_calText(link.external_event_id)) return _calSucceed(store, link, out, action, null, 'NO_EXTERNAL_EVENT: nothing to cancel in Calendar', input, now, { status: 'Cancelled' });
      var del = api.deleteEvent(calendarId, link.external_event_id);
      if (del && del.missing) return _calSucceed(store, link, out, action, link.external_event_id, 'ALREADY_REMOVED: event not present in DEV calendar', input, now, { status: 'Cancelled' });
      if (!del || del.deleted !== true) return _calNeedsReview(store, link, out, action, 'UNCERTAIN_OUTCOME', 'delete returned no confirmation', input, now);
      return _calSucceed(store, link, out, action, link.external_event_id, 'DELETED: DEV calendar event removed', input, now, { status: 'Cancelled' });
    }

    var eventId = _calText(link.external_event_id) ? link.external_event_id : null;
    var how = eventId ? 'update' : 'create';
    if (!eventId && priorUncertain) {
      var rec = _calReconcile(api, calendarId, link, spec);
      if (rec.found && rec.ambiguous) return _calNeedsReview(store, link, out, action, 'DUPLICATE_EVENTS', 'tag matched ' + rec.ids.length + ' events: ' + rec.ids.join(','), input, now);
      if (rec.found) { eventId = rec.id; how = 'reconcile-update'; }
    }
    if (eventId) {
      var existing = api.getEventById(calendarId, eventId);
      if (!existing) {
        if (how === 'update' && action === 'CalendarCreate') { eventId = null; how = 'create'; }
        else return _calNeedsReview(store, link, out, action, 'EVENT_MISSING', 'external_event_id ' + eventId + ' not found in DEV calendar', input, now);
      }
    }
    if (eventId) {
      var upd = api.updateEvent(calendarId, eventId, spec);
      if (!upd || !_calText(upd.id)) return _calNeedsReview(store, link, out, action, 'UNCERTAIN_OUTCOME', 'update returned no event id', input, now);
      return _calSucceed(store, link, out, action, upd.id, (how === 'reconcile-update' ? 'RECONCILED: adopted existing tagged event and updated' : 'UPDATED: DEV calendar event updated') + ' (' + spec.start + '→' + spec.end + ')', input, now);
    }
    var created = api.createAllDayEvent(calendarId, spec);
    if (!created || !_calText(created.id)) return _calNeedsReview(store, link, out, action, 'UNCERTAIN_OUTCOME', 'create returned no event id', input, now);
    return _calSucceed(store, link, out, action, created.id, 'CREATED: DEV calendar event (' + spec.start + '→' + spec.end + ')', input, now);
  } catch (e) {
    var msg = _calErrorText(e);
    if (/^CAL_REFUSED/.test(msg)) return _calNeedsReview(store, link, out, action, 'REFUSED', msg, input, now);
    return _calRetry(store, link, out, action, msg, input, now);
  }
}

/* --- stalled Processing rows: make them visible and retryable (reconcile-by-tag guards duplicates) --- */

function _calRecoverStalled(store, input, now) {
  var recovered = [];
  _calCalendarOutbox(store).forEach(function (o) {
    if (o.status !== 'Processing') return;
    var link = _calLinkForOutbox(store, o);
    var at = _calTimestamp(link && link.last_attempt_at ? link.last_attempt_at : o.created_at);
    if (at && _calMinutesBetween(at, now) < CAL_STALLED_MINUTES) return;
    store.update('Outbox', o.id, { status: 'RetryDue', next_attempt: now, response_summary: 'STALLED: Processing for >' + CAL_STALLED_MINUTES + ' min; reconcile before retry' });
    if (link) {
      var before = JSON.parse(JSON.stringify(link));
      var after = _calPatchLink(store, link, { status: 'Error', error: 'STALLED: prior attempt outcome unknown' }, now, input.actor);
      _calAudit(store, link, o, 'CalendarStalled', before, after, input, now, 'Processing row stalled; queued for reconcile');
    }
    recovered.push(o.id);
  });
  return recovered;
}

/* --- 1. DISPATCH --- */

function _calDispatch(store, input) {
  _calGuardStore(store);
  input = input || {};
  if (!_calText(input.actor)) _calRefuse('CAL_REVIEW: actor required');
  var mode = _calRequirePilot(store);
  var config = _calConfig(input);
  var now = _calNow(input);
  var limit = Number(input.limit) > 0 ? Math.min(Number(input.limit), 200) : CAL_DEFAULT_BATCH;
  var dryRun = input.dry_run === true;

  var stalled = dryRun ? [] : _calRecoverStalled(store, input, now);
  var only = Array.isArray(input.only_outbox_ids) ? input.only_outbox_ids : null;
  var due = _calCalendarOutbox(store).filter(function (o) {
    if (only && only.indexOf(o.id) === -1) return false;
    if (o.status !== 'Pending' && o.status !== 'RetryDue') return false;
    var next = _calTimestamp(o.next_attempt);
    return !next || next <= now;
  }).sort(function (a, b) { return String(_calTimestamp(a.created_at) || '').localeCompare(String(_calTimestamp(b.created_at) || '')); });

  var base = { mode: config.mode, release_mode: mode, now: now, due: due.length, stalled_recovered: stalled, external_calls: 0, processed: [], skipped: [] };
  /* Dry run previews the plan in any mode; it never writes to the Sheet or the Calendar. */
  if (dryRun) {
    base.skipped = due.slice(0, limit).map(function (o) {
      var link = _calLinkForOutbox(store, o);
      var target = link ? _calTargetAllowed(config, link.calendar_id) : { ok: false, reason: 'CALENDAR_LINK_MISSING' };
      return { outbox_id: o.id, action: o.action_type, link_id: link ? link.id : null, would: !target.ok ? 'NeedsReview:' + target.reason : (o.action_type === 'CalendarCancel' ? (link.external_event_id ? 'delete' : 'mark-cancelled') : (link.external_event_id ? 'update' : (Number(o.attempt_count || 0) > 0 ? 'reconcile-then-create' : 'create'))) };
    });
    base.summary = 'DRY RUN (' + config.mode + '): ' + base.skipped.length + ' row(s) planned; no writes';
    return base;
  }
  if (config.mode !== 'LIVE') {
    base.skipped = due.map(function (o) { return { outbox_id: o.id, action: o.action_type, reason: 'CAPTURE_MODE' }; });
    base.summary = 'CAPTURE mode: ' + due.length + ' calendar row(s) left pending; no Calendar API call';
    return base;
  }
  if (config.allowedCalendarIds.indexOf(CAL_DEV_CALENDAR_ID) === -1) _calRefuse('CAL_REFUSED: LIVE mode requires the DEV calendar in allowedCalendarIds');
  var api = input.api || (typeof CalendarApp !== 'undefined' ? _calDefaultApi() : null);
  if (!api) _calRefuse('CAL_REFUSED: no Calendar adapter available');
  var counting = _calCountingApi(api);
  due.slice(0, limit).forEach(function (o) { base.processed.push(_calProcessOne(store, store.get('Outbox', o.id), input, config, counting.api, now)); });
  base.external_calls = counting.count();
  base.summary = 'LIVE: ' + base.processed.length + ' processed, ' + base.processed.filter(function (p) { return p.outcome === 'Succeeded'; }).length + ' succeeded, ' + base.processed.filter(function (p) { return p.outcome === 'NeedsReview'; }).length + ' needs review, ' + base.processed.filter(function (p) { return p.outcome === 'RetryDue'; }).length + ' retry due';
  return base;
}
function _calCountingApi(api) {
  var n = 0;
  function wrap(name) { return function () { n++; var args = Array.prototype.slice.call(arguments); if (args[0] !== CAL_DEV_CALENDAR_ID) _calRefuse('CAL_REFUSED: adapter target must be the DEV calendar'); return api[name].apply(api, args); }; }
  return { api: { getEventById: wrap('getEventById'), findEventsByTag: wrap('findEventsByTag'), createAllDayEvent: wrap('createAllDayEvent'), updateEvent: wrap('updateEvent'), deleteEvent: wrap('deleteEvent') }, count: function () { return n; } };
}

/* --- 2. STATUS (read-only) --- */

function _calStatus(store, input) {
  _calGuardStore(store);
  input = input || {};
  var now = _calNow(input);
  var config = input.config ? _calConfig(input) : { mode: 'NOT_CONFIGURED', allowedCalendarIds: [] };
  var mode = _calMode(store);
  var outbox = _calCalendarOutbox(store);
  var links = store.list('CalendarLinks');
  function countBy(rows, key) { var c = {}; rows.forEach(function (r) { var k = r[key] || 'null'; c[k] = (c[k] || 0) + 1; }); return c; }
  var review = outbox.filter(function (o) { return o.status === 'NeedsReview'; }).map(function (o) { var l = _calLinkForOutbox(store, o); return { outbox_id: o.id, action: o.action_type, link_id: l ? l.id : null, job_id: l ? l.job_id : null, summary: o.response_summary, external_event_id: l ? l.external_event_id : null }; });
  var due = outbox.filter(function (o) { if (o.status !== 'Pending' && o.status !== 'RetryDue') return false; var n = _calTimestamp(o.next_attempt); return !n || n <= now; });
  var lastSuccess = null;
  links.forEach(function (l) { var t = _calTimestamp(l.last_success_at); if (t && (!lastSuccess || t > lastSuccess)) lastSuccess = t; });
  return {
    generated_at: now, calendar_mode: config.mode, release_mode: mode, dev_calendar_id: CAL_DEV_CALENDAR_ID,
    dev_calendar_allowlisted: config.allowedCalendarIds.indexOf(CAL_DEV_CALENDAR_ID) !== -1,
    live_ready: config.mode === 'LIVE' && mode.mode === 'Automated' && mode.scope === 'Pilot' && config.allowedCalendarIds.indexOf(CAL_DEV_CALENDAR_ID) !== -1,
    outbox: { total: outbox.length, by_status: countBy(outbox, 'status'), by_action: countBy(outbox, 'action_type'), due_now: due.length, processing: outbox.filter(function (o) { return o.status === 'Processing'; }).length },
    links: { total: links.length, by_status: countBy(links, 'status'), with_external_id: links.filter(function (l) { return _calText(l.external_event_id); }).length, last_success_at: lastSuccess },
    needs_review: review
  };
}

/* --- 3. REVIEW RESOLUTION (human recovery, audited, idempotent per command_id) --- */

function _calResolveReview(store, input) {
  _calGuardStore(store);
  input = input || {};
  if (!_calText(input.actor) || !_calText(input.command_id) || !_calText(input.outbox_id) || !_calText(input.reason)) _calRefuse('CAL_REVIEW: actor, command_id, outbox_id and reason required');
  if (['AdoptEvent', 'MarkCancelled', 'Retry', 'RetargetDev'].indexOf(input.resolution) === -1) _calRefuse('CAL_REVIEW: resolution must be AdoptEvent, MarkCancelled, Retry or RetargetDev');
  var now = _calNow(input);
  var auditId = 'AUD-CAL-RESOLVE-' + input.command_id;
  if (store.get('AuditEvents', auditId)) return { replay: true, resolved: false, outbox_id: input.outbox_id, resolution: input.resolution };
  var out = store.get('Outbox', input.outbox_id);
  if (!out || CAL_ACTIONS.indexOf(out.action_type) === -1) _calRefuse('CAL_REVIEW: calendar outbox row not found');
  if (out.status !== 'NeedsReview' && out.status !== 'RetryDue' && out.status !== 'Processing') _calRefuse('CAL_REVIEW: outbox status ' + out.status + ' is not reviewable');
  var link = _calLinkForOutbox(store, out);
  if (!link) _calRefuse('CAL_REVIEW: calendar link not found for outbox ' + out.id);
  var before = JSON.parse(JSON.stringify(link)), after, patchOut;
  if (input.resolution === 'AdoptEvent') {
    if (!_calText(input.external_event_id)) _calRefuse('CAL_REVIEW: external_event_id required to adopt');
    after = _calPatchLink(store, link, { external_event_id: input.external_event_id.trim(), event_uid: input.external_event_id.trim(), status: out.action_type === 'CalendarCancel' ? 'Cancelled' : 'Active', error: null, last_success_at: now, last_synced_revision: link.entity_revision }, now, input.actor);
    patchOut = { status: 'Succeeded', external_id: input.external_event_id.trim(), response_summary: 'RESOLVED by ' + input.actor + ': adopted event ' + input.external_event_id.trim() + ' — ' + input.reason };
  } else if (input.resolution === 'MarkCancelled') {
    after = _calPatchLink(store, link, { status: 'Cancelled', error: null, last_synced_revision: link.entity_revision }, now, input.actor);
    patchOut = { status: 'Cancelled', response_summary: 'RESOLVED by ' + input.actor + ': cancelled without external change — ' + input.reason };
  } else if (input.resolution === 'RetargetDev') {
    /* Legacy links captured before the shared-calendar decision may carry placeholder ids; point them at the DEV calendar and re-queue. */
    after = _calPatchLink(store, link, { calendar_id: CAL_DEV_CALENDAR_ID, status: link.external_event_id ? 'UpdatePending' : 'Pending', error: null }, now, input.actor);
    patchOut = { status: 'Pending', next_attempt: null, target: CAL_DEV_CALENDAR_ID, response_summary: 'RESOLVED by ' + input.actor + ': retargeted to DEV shared calendar — ' + input.reason };
  } else {
    after = _calPatchLink(store, link, { status: link.external_event_id ? 'UpdatePending' : 'Pending', error: null }, now, input.actor);
    patchOut = { status: 'Pending', next_attempt: null, response_summary: 'RESOLVED by ' + input.actor + ': queued for retry — ' + input.reason };
  }
  store.update('Outbox', out.id, patchOut);
  store.insert('AuditEvents', { id: auditId, entity_type: 'CalendarLinks', entity_id: link.id, action: 'CalendarReview' + input.resolution, before_json: JSON.stringify(before), after_json: JSON.stringify(after), initiating_actor: input.actor, executing_service: CAL_SERVICE, timestamp: now, correlation_id: out.id, reason: input.reason, commit_id: 'CAL-RESOLVE-' + input.command_id, created_at: now });
  return { replay: false, resolved: true, outbox_id: out.id, link_id: link.id, resolution: input.resolution, outbox_status: patchOut.status, link_status: after.status };
}

if (typeof module !== 'undefined') {
  module.exports = {
    CAL_DEV_SHEET_ID, CAL_DEV_CALENDAR_ID, CAL_ACTIONS, CAL_MAX_ATTEMPTS, CAL_BACKOFF_MINUTES, CAL_STALLED_MINUTES, CAL_TAG_PREFIX,
    _calDispatch, _calStatus, _calResolveReview,
    _calConfig, _calTargetAllowed, _calSpec, _calLinkForOutbox, _calTag, _calRecoverStalled, _calGuardStore, _calMode, _calDefaultApi
  };
}
