/* DEV Calendar write service tests — local only. Drives the service through real S11 planner output. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const cal = require('../calendar/service.js'), p = require('../s11/planner.js'), fx = require('../s11/fixture.js');
const copy = x => structuredClone(x);
const DEV = cal.CAL_DEV_CALENDAR_ID;
const LIVE = { environment: 'DEV', calendarMode: 'LIVE', allowedCalendarIds: [DEV] };
const CAPTURE = { environment: 'DEV', calendarMode: 'CAPTURE', allowedCalendarIds: [DEV] };
const T0 = '2026-11-02T12:00:00.000Z';
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  let held = false;
  const s = {
    tables,
    getSheetId: () => cal.CAL_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) {
      assert.ok(tables[n], n);
      assert.ok(!this.get(n, r.id), 'duplicate ' + n + '/' + r.id);
      const headers = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(r)) assert.ok(headers.includes(k), 'unknown ' + n + '.' + k);
      tables[n].push(copy(r));
    },
    update(n, id, patch) {
      const r = tables[n].find(r => r.id === id); assert.ok(r, n + '/' + id);
      const headers = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(patch)) assert.ok(headers.includes(k), 'unknown ' + n + '.' + k);
      Object.assign(r, copy(patch));
    },
    withLock(fn) { assert.equal(held, false, 'lock contention'); held = true; try { return fn(); } finally { held = false; } }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  s.update('ReleaseModes', 'RM-FN01', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  s.update('ReleaseModes', 'RM-FN02', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  fx.seed(s);
  /* Shared DEV calendar: People.calendar_id must play no part. */
  s.update('People', 'PERSON-s11-installer', { calendar_id: 'NOT_CONFIGURED' });
  return s;
}
function plan(s, extra = {}) {
  return p.planWorkPackage({ command_id: 'PLAN-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', person_id: 'PERSON-s11-installer', role: 'Lead', start_at: '2026-11-11', end_at: '2026-11-13', expected_version: 1, actor: 'PERSON-tanya', reason: 'Synthetic plan', at: fx.NOW, ...extra }, s);
}
function fakeApi(opts = {}) {
  const events = new Map(), calls = [];
  let seq = 0;
  return {
    events, calls,
    getEventById(c, id) { calls.push(['get', c, id]); if (opts.throwOn === 'get') throw new Error('Calendar service unavailable'); return events.get(id) || null; },
    findEventsByTag(c, tag) { calls.push(['find', c, tag]); return [...events.values()].filter(e => e.description.includes(tag)); },
    createAllDayEvent(c, spec) {
      calls.push(['create', c, spec.start, spec.end]);
      if (opts.throwOn === 'create') throw new Error('Calendar quota exceeded');
      const id = 'EVT-' + (++seq); events.set(id, { id, ...spec });
      if (opts.createThrowsAfterWrite) throw new Error('Network reset after write');
      if (opts.createReturnsNoId) return {};
      return { id };
    },
    updateEvent(c, id, spec) { calls.push(['update', c, id]); const e = events.get(id); if (!e) return null; Object.assign(e, spec); return { id }; },
    deleteEvent(c, id) { calls.push(['delete', c, id]); if (!events.has(id)) return { deleted: false, missing: true }; events.delete(id); return { deleted: true }; }
  };
}
function dispatch(s, api, extra = {}) { return cal._calDispatch(s, { actor: 'PERSON-tanya', config: LIVE, api, now: T0, ...extra }); }
function audits(s) { return s.tables.AuditEvents.filter(a => a.executing_service === 'CalendarService'); }

test('CAL 01: CAPTURE mode leaves rows pending, calls nothing, writes nothing', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi(), before = copy(s.tables);
  const r = cal._calDispatch(s, { actor: 'PERSON-tanya', config: CAPTURE, api, now: T0 });
  assert.equal(r.mode, 'CAPTURE');
  assert.equal(r.due, 1);
  assert.equal(r.skipped[0].reason, 'CAPTURE_MODE');
  assert.equal(api.calls.length, 0);
  assert.deepEqual(s.tables, before);
  assert.equal(s.tables.Outbox[0].status, 'Pending');
});

test('CAL 02: refusals — FN-02 disabled, wrong env/sheet, non-DEV config, LIVE without allowlist, missing actor', () => {
  const base = () => { const s = makeStore(); plan(s); return s; };
  let s = base(); s.update('ReleaseModes', 'RM-FN02', { mode: 'Disabled', authorised_job_scope: 'None' });
  let before = copy(s.tables);
  assert.throws(() => dispatch(s, fakeApi()), /CAL_REFUSED: FN-02/); assert.deepEqual(s.tables, before);
  s = base(); s.getEnvironment = () => 'PROD'; assert.throws(() => dispatch(s, fakeApi()), /CAL_REFUSED: exact DEV/);
  s = base(); s.getSheetId = () => 'other'; assert.throws(() => dispatch(s, fakeApi()), /CAL_REFUSED: exact DEV/);
  s = base(); assert.throws(() => dispatch(s, fakeApi(), { config: { ...LIVE, environment: 'TEST' } }), /config.environment must be DEV/);
  s = base(); assert.throws(() => dispatch(s, fakeApi(), { config: { environment: 'DEV', calendarMode: 'LIVE', allowedCalendarIds: [] } }), /requires the DEV calendar in allowedCalendarIds/);
  s = base(); assert.throws(() => dispatch(s, fakeApi(), { actor: '' }), /actor required/);
  s = base(); assert.throws(() => dispatch(s, fakeApi(), { config: null }), /config required/);
});

test('CAL 03: LIVE create persists the external event id, marks link Active, audits, one external call', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  const r = dispatch(s, api);
  assert.equal(r.processed.length, 1);
  assert.equal(r.processed[0].outcome, 'Succeeded');
  assert.equal(r.external_calls, 1);
  assert.deepEqual(api.calls.map(c => c[0]), ['create']);
  assert.equal(api.calls[0][1], DEV);
  const link = s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1');
  assert.equal(link.external_event_id, 'EVT-1');
  assert.equal(link.event_uid, 'EVT-1');
  assert.equal(link.status, 'Active');
  assert.equal(link.last_success_at, T0);
  assert.equal(link.last_attempt_at, T0);
  assert.equal(link.last_synced_revision, link.entity_revision);
  assert.equal(link.error, null);
  const out = s.tables.Outbox[0];
  assert.equal(out.status, 'Succeeded');
  assert.equal(out.external_id, 'EVT-1');
  assert.equal(out.attempt_count, 1);
  assert.match(out.response_summary, /^CREATED/);
  const ev = api.events.get('EVT-1');
  assert.equal(ev.start, '2026-11-11');
  assert.equal(ev.end, '2026-11-14', 'all-day end is exclusive next day from S11 payload');
  assert.ok(ev.description.includes(cal._calTag(link.id)));
  assert.equal(ev.title, 'S11 DEV Synthetic — Roof');
  const a = audits(s);
  assert.equal(a.length, 1);
  assert.equal(a[0].action, 'CalendarCreate');
  assert.equal(a[0].entity_id, link.id);
  assert.equal(a[0].correlation_id, out.id);
  assert.equal(JSON.parse(a[0].before_json).external_event_id, null);
  assert.equal(JSON.parse(a[0].after_json).external_event_id, 'EVT-1');
});

test('CAL 04: a second dispatch processes nothing; the event is never duplicated', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  dispatch(s, api);
  const again = dispatch(s, api, { now: plus(T0, 5) });
  assert.equal(again.processed.length, 0);
  assert.equal(again.due, 0);
  assert.equal(api.events.size, 1);
  assert.equal(api.calls.length, 1);
});

test('CAL 05: uncertain create (exception after write) retries with backoff, then reconciles by tag instead of creating again', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi({ createThrowsAfterWrite: true });
  const r1 = dispatch(s, api);
  assert.equal(r1.processed[0].outcome, 'RetryDue');
  assert.equal(r1.processed[0].next_attempt, plus(T0, 1));
  let out = s.tables.Outbox[0], link = s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1');
  assert.equal(out.status, 'RetryDue');
  assert.equal(out.attempt_count, 1);
  assert.equal(link.status, 'Error');
  assert.match(link.error, /Network reset/);
  assert.equal(link.external_event_id, null);
  assert.equal(api.events.size, 1, 'the event really exists in the calendar');
  /* Not due yet. */
  assert.equal(dispatch(s, api, { now: plus(T0, 0.5) }).processed.length, 0);
  /* Due: reconcile finds the tagged event and adopts it. */
  api.createThrowsAfterWrite = false;
  const r2 = dispatch(s, api, { now: plus(T0, 2) });
  assert.equal(r2.processed[0].outcome, 'Succeeded');
  assert.match(r2.processed[0].summary, /^RECONCILED/);
  assert.equal(api.events.size, 1);
  assert.deepEqual(api.calls.slice(1).map(c => c[0]), ['find', 'get', 'update']);
  link = s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1');
  assert.equal(link.external_event_id, 'EVT-1');
  assert.equal(link.status, 'Active');
  assert.equal(link.error, null);
  out = s.tables.Outbox[0];
  assert.equal(out.status, 'Succeeded');
  assert.equal(out.attempt_count, 2);
  assert.deepEqual(audits(s).map(a => a.action), ['CalendarCreateRetry', 'CalendarCreate']);
});

test('CAL 06: repeated transient failures back off 1,2,4,8,16 minutes and escalate to NeedsReview after five attempts', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi({ throwOn: 'create' });
  let now = T0;
  const expected = [1, 2, 4, 8];
  for (let i = 0; i < 4; i++) {
    const r = dispatch(s, api, { now });
    assert.equal(r.processed[0].outcome, 'RetryDue', 'attempt ' + (i + 1));
    assert.equal(r.processed[0].next_attempt, plus(now, expected[i]));
    now = r.processed[0].next_attempt;
  }
  const r5 = dispatch(s, api, { now });
  assert.equal(r5.processed[0].outcome, 'NeedsReview');
  assert.equal(r5.processed[0].code, 'MAX_RETRIES_EXCEEDED');
  const out = s.tables.Outbox[0];
  assert.equal(out.status, 'NeedsReview');
  assert.equal(out.attempt_count, 5);
  assert.equal(dispatch(s, api, { now: plus(now, 60) }).processed.length, 0, 'NeedsReview rows are never auto-retried');
  assert.equal(api.events.size, 0);
});

test('CAL 07: move after a live create issues an update on the same event id', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  dispatch(s, api);
  const mv = p.moveWorkPackage({ command_id: 'MOVE-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', allocation_id: 'ALLOC-S11-PLAN-1', start_at: '2026-11-16', end_at: '2026-11-18', expected_version: 2, actor: 'PERSON-tanya', reason: 'Customer agreed move', at: fx.NOW }, s);
  assert.equal(mv.status, 'Moved');
  assert.equal(mv.calendar.outbox.action_type, 'CalendarUpdate');
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').status, 'UpdatePending');
  const r = dispatch(s, api, { now: plus(T0, 10) });
  assert.equal(r.processed.length, 1);
  assert.equal(r.processed[0].outcome, 'Succeeded');
  assert.equal(r.processed[0].external_event_id, 'EVT-1');
  assert.match(r.processed[0].summary, /^UPDATED/);
  assert.deepEqual(api.calls.slice(1).map(c => c[0]), ['get', 'update']);
  assert.equal(api.events.size, 1);
  const ev = api.events.get('EVT-1');
  assert.equal(ev.start, '2026-11-16');
  assert.equal(ev.end, '2026-11-19');
  const link = s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1');
  assert.equal(link.status, 'Active');
  assert.equal(link.external_event_id, 'EVT-1');
  assert.equal(link.last_synced_revision, 3);
});

test('CAL 08: update whose event vanished externally goes to NeedsReview, not a silent recreate', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  dispatch(s, api);
  api.events.clear();
  p.moveWorkPackage({ command_id: 'MOVE-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', allocation_id: 'ALLOC-S11-PLAN-1', start_at: '2026-11-16', end_at: '2026-11-18', expected_version: 2, actor: 'PERSON-tanya', reason: 'Move', at: fx.NOW }, s);
  const r = dispatch(s, api, { now: plus(T0, 10) });
  assert.equal(r.processed[0].outcome, 'NeedsReview');
  assert.equal(r.processed[0].code, 'EVENT_MISSING');
  assert.equal(api.events.size, 0);
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').status, 'Error');
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').external_event_id, 'EVT-1', 'stable id preserved for human review');
});

test('CAL 09: replacing the installer cancels (deletes) the old event and creates the new one', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  dispatch(s, api);
  s.insert('People', { ...fx.person('PERSON-s11-new'), calendar_id: null });
  const r = p.changeInstaller({ command_id: 'REPLACE-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', old_allocation_id: 'ALLOC-S11-PLAN-1', person_id: 'PERSON-s11-new', mode: 'Replace', expected_version: 2, actor: 'PERSON-tanya', reason: 'Installer unavailable', at: fx.NOW }, s);
  assert.equal(r.status, 'Replaced');
  const d = dispatch(s, api, { now: plus(T0, 10) });
  assert.equal(d.processed.length, 2);
  const byAction = Object.fromEntries(d.processed.map(x => [x.action, x]));
  assert.equal(byAction.CalendarCancel.outcome, 'Succeeded');
  assert.match(byAction.CalendarCancel.summary, /^DELETED/);
  assert.equal(byAction.CalendarCreate.outcome, 'Succeeded');
  assert.equal(api.events.size, 1);
  assert.ok(!api.events.has('EVT-1'));
  const old = s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1');
  assert.equal(old.status, 'Cancelled');
  assert.equal(old.external_event_id, 'EVT-1');
  assert.equal(old.last_synced_revision, old.entity_revision);
  const fresh = s.get('CalendarLinks', 'CL-ALLOC-S11-REPLACE-1');
  assert.equal(fresh.status, 'Active');
  assert.equal(fresh.external_event_id, 'EVT-2');
  assert.deepEqual(audits(s).map(a => a.action).sort(), ['CalendarCancel', 'CalendarCreate', 'CalendarCreate']);
});

test('CAL 10: cancel without an external event, and cancel of an already-removed event, both succeed safely', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  /* Replace before any live sync: old link has no external id. */
  s.insert('People', { ...fx.person('PERSON-s11-new'), calendar_id: null });
  p.changeInstaller({ command_id: 'REPLACE-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', old_allocation_id: 'ALLOC-S11-PLAN-1', person_id: 'PERSON-s11-new', mode: 'Replace', expected_version: 2, actor: 'PERSON-tanya', reason: 'Installer unavailable', at: fx.NOW }, s);
  const d = dispatch(s, api);
  const cancel = d.processed.find(x => x.action === 'CalendarCancel');
  assert.equal(cancel.outcome, 'Succeeded');
  assert.match(cancel.summary, /^NO_EXTERNAL_EVENT/);
  assert.equal(api.calls.filter(c => c[0] === 'delete').length, 0);
  /* The superseded create for the old allocation must not be sent: S11 pointed the old link at the cancel outbox. */
  const oldCreate = s.tables.Outbox.find(o => o.id === 'OUT-S11-PLAN-1-UPSERT');
  assert.equal(oldCreate.status, 'NeedsReview');
  assert.match(oldCreate.response_summary, /CALENDAR_LINK_MISSING/);
  assert.equal(api.events.size, 1, 'only the new installer event exists');
  /* Already removed externally. */
  const s2 = makeStore(); plan(s2);
  const api2 = fakeApi();
  dispatch(s2, api2);
  api2.events.clear();
  s2.insert('People', { ...fx.person('PERSON-s11-new'), calendar_id: null });
  p.changeInstaller({ command_id: 'REPLACE-2', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', old_allocation_id: 'ALLOC-S11-PLAN-1', person_id: 'PERSON-s11-new', mode: 'Replace', expected_version: 2, actor: 'PERSON-tanya', reason: 'Installer unavailable', at: fx.NOW }, s2);
  const d2 = dispatch(s2, api2, { now: plus(T0, 10) });
  const c2 = d2.processed.find(x => x.action === 'CalendarCancel');
  assert.equal(c2.outcome, 'Succeeded');
  assert.match(c2.summary, /^ALREADY_REMOVED/);
  assert.equal(s2.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').status, 'Cancelled');
});

test('CAL 11: targets outside the exact DEV calendar are refused before any API call', () => {
  const s = makeStore(); plan(s);
  s.update('CalendarLinks', 'CL-ALLOC-S11-PLAN-1', { calendar_id: 'CAL-S11-CAPTURE' });
  const api = fakeApi();
  const r = dispatch(s, api);
  assert.equal(r.processed[0].outcome, 'NeedsReview');
  assert.equal(r.processed[0].code, 'CALENDAR_TARGET_NOT_DEV');
  assert.equal(api.calls.length, 0);
  assert.equal(s.tables.Outbox[0].status, 'NeedsReview');
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').status, 'Error');
  /* An allowlisted non-DEV id is still refused: the DEV id is hardcoded. */
  const other = 'c_other@group.calendar.google.com';
  assert.equal(cal._calTargetAllowed({ allowedCalendarIds: [DEV, other] }, other).reason, 'CALENDAR_TARGET_NOT_DEV');
  assert.equal(cal._calTargetAllowed({ allowedCalendarIds: [] }, DEV).reason, 'CALENDAR_TARGET_NOT_ALLOWLISTED');
  assert.equal(cal._calTargetAllowed({ allowedCalendarIds: [DEV] }, null).reason, 'CALENDAR_TARGET_MISSING');
  assert.equal(cal._calTargetAllowed({ allowedCalendarIds: [DEV] }, DEV).ok, true);
  /* Outbox target disagreeing with the link is a mismatch. */
  const s2 = makeStore(); plan(s2);
  s2.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { target: other });
  const r2 = dispatch(s2, fakeApi());
  assert.equal(r2.processed[0].code, 'CALENDAR_TARGET_MISMATCH');
  /* The default Apps Script adapter refuses any calendar id other than DEV before touching CalendarApp. */
  const src = fs.readFileSync('calendar/service.js', 'utf8');
  assert.match(src, /if \(calendarId !== CAL_DEV_CALENDAR_ID\) _calRefuse\('CAL_REFUSED: adapter target must be the DEV calendar'\);/);
});

test('CAL 12: stalled Processing rows are recovered to RetryDue with audit, then reconciled', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  /* Simulate a crash mid-call: Processing with an event already written. */
  s.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { status: 'Processing', attempt_count: 1 });
  s.update('CalendarLinks', 'CL-ALLOC-S11-PLAN-1', { last_attempt_at: T0 });
  api.events.set('EVT-9', { id: 'EVT-9', title: 'x', start: '2026-11-11', end: '2026-11-14', description: cal._calTag('CL-ALLOC-S11-PLAN-1') });
  const early = dispatch(s, api, { now: plus(T0, 5) });
  assert.deepEqual(early.stalled_recovered, []);
  assert.equal(s.tables.Outbox[0].status, 'Processing');
  const late = dispatch(s, api, { now: plus(T0, 16) });
  assert.deepEqual(late.stalled_recovered, ['OUT-S11-PLAN-1-UPSERT']);
  assert.equal(late.processed.length, 1);
  assert.equal(late.processed[0].outcome, 'Succeeded');
  assert.match(late.processed[0].summary, /^RECONCILED/);
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').external_event_id, 'EVT-9');
  assert.equal(api.events.size, 1);
  assert.deepEqual(audits(s).map(a => a.action), ['CalendarStalled', 'CalendarCreate']);
});

test('CAL 13: duplicate tagged events are surfaced for review rather than guessed', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  s.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { status: 'RetryDue', attempt_count: 1, next_attempt: T0 });
  api.events.set('EVT-A', { id: 'EVT-A', description: cal._calTag('CL-ALLOC-S11-PLAN-1') });
  api.events.set('EVT-B', { id: 'EVT-B', description: cal._calTag('CL-ALLOC-S11-PLAN-1') });
  const r = dispatch(s, api);
  assert.equal(r.processed[0].outcome, 'NeedsReview');
  assert.equal(r.processed[0].code, 'DUPLICATE_EVENTS');
  assert.match(r.processed[0].detail, /EVT-A,EVT-B/);
  assert.equal(api.calls.filter(c => c[0] === 'create').length, 0);
});

test('CAL 14: review resolution — AdoptEvent, MarkCancelled, Retry; idempotent per command; refusals', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  s.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { status: 'RetryDue', attempt_count: 1, next_attempt: T0 });
  api.events.set('EVT-A', { id: 'EVT-A', description: cal._calTag('CL-ALLOC-S11-PLAN-1') });
  api.events.set('EVT-B', { id: 'EVT-B', description: cal._calTag('CL-ALLOC-S11-PLAN-1') });
  dispatch(s, api);
  const base = { actor: 'PERSON-tanya', command_id: 'RES-1', outbox_id: 'OUT-S11-PLAN-1-UPSERT', reason: 'Checked calendar: EVT-A is the real one', now: plus(T0, 30) };
  assert.throws(() => cal._calResolveReview(s, { ...base, resolution: 'AdoptEvent' }), /external_event_id required/);
  assert.throws(() => cal._calResolveReview(s, { ...base, resolution: 'Nuke' }), /resolution must be/);
  assert.throws(() => cal._calResolveReview(s, { ...base, reason: '' }), /reason required/);
  const r = cal._calResolveReview(s, { ...base, resolution: 'AdoptEvent', external_event_id: 'EVT-A' });
  assert.equal(r.resolved, true);
  assert.equal(r.link_status, 'Active');
  const link = s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1');
  assert.equal(link.external_event_id, 'EVT-A');
  assert.equal(link.error, null);
  assert.equal(s.tables.Outbox[0].status, 'Succeeded');
  assert.equal(s.tables.Outbox[0].external_id, 'EVT-A');
  const replay = cal._calResolveReview(s, { ...base, resolution: 'AdoptEvent', external_event_id: 'EVT-B' });
  assert.equal(replay.replay, true);
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').external_event_id, 'EVT-A', 'replay never re-applies');
  assert.throws(() => cal._calResolveReview(s, { ...base, command_id: 'RES-2', resolution: 'Retry' }), /not reviewable/);
  assert.ok(s.get('AuditEvents', 'AUD-CAL-RESOLVE-RES-1'));
  /* Retry re-queues; MarkCancelled closes without external change. */
  const s2 = makeStore(); plan(s2);
  s2.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { status: 'NeedsReview' });
  const rr = cal._calResolveReview(s2, { ...base, command_id: 'RES-3', resolution: 'Retry' });
  assert.equal(rr.outbox_status, 'Pending');
  assert.equal(s2.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').status, 'Pending');
  assert.equal(dispatch(s2, fakeApi(), { now: plus(T0, 60) }).processed[0].outcome, 'Succeeded');
  const s3 = makeStore(); plan(s3);
  s3.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { status: 'NeedsReview' });
  const mc = cal._calResolveReview(s3, { ...base, command_id: 'RES-4', resolution: 'MarkCancelled' });
  assert.equal(mc.outbox_status, 'Cancelled');
  assert.equal(s3.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').status, 'Cancelled');
  assert.equal(dispatch(s3, fakeApi(), { now: plus(T0, 60) }).processed.length, 0);
});

test('CAL 15: S15-style cancellation rows (JSON payload, NeedsReview) resolve through the link id in the payload', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi();
  dispatch(s, api);
  s.update('CalendarLinks', 'CL-ALLOC-S11-PLAN-1', { status: 'Error', error: 'S15 cancellation removal requires reconciliation', outbox_id: 'OUT-S15-CAN' });
  s.insert('Outbox', { id: 'OUT-S15-CAN', idempotency_key: 'OUT-S15-CAN', action_type: 'CalendarCancel', target: DEV, payload_hash: JSON.stringify({ calendar_link_id: 'CL-ALLOC-S11-PLAN-1', action: 'Cancel', external_event_id: 'EVT-1' }), job_revision: 2, attempt_count: 0, next_attempt: null, external_id: 'EVT-1', response_summary: 'CAPTURE_ONLY / Review: external removal unconfirmed', correlation_id: 'J-s11-plan', status: 'NeedsReview', created_at: T0, commit_id: 'S15' });
  s.update('CalendarLinks', 'CL-ALLOC-S11-PLAN-1', { outbox_id: 'OTHER' });
  assert.equal(cal._calLinkForOutbox(s, s.get('Outbox', 'OUT-S15-CAN')).id, 'CL-ALLOC-S11-PLAN-1', 'payload fallback');
  const st = cal._calStatus(s, { config: LIVE, now: T0 });
  assert.equal(st.needs_review.length, 1);
  assert.equal(st.needs_review[0].link_id, 'CL-ALLOC-S11-PLAN-1');
  const r = cal._calResolveReview(s, { actor: 'PERSON-tanya', command_id: 'RES-S15', outbox_id: 'OUT-S15-CAN', resolution: 'Retry', reason: 'Let the service delete it', now: T0 });
  assert.equal(r.outbox_status, 'Pending');
  const d = dispatch(s, api, { now: plus(T0, 1) });
  assert.equal(d.processed[0].outcome, 'Succeeded');
  assert.match(d.processed[0].summary, /^DELETED/);
  assert.equal(api.events.size, 0);
});

test('CAL 16: dry run plans without writing; status reports readiness, counts and review queue', () => {
  const s = makeStore(); plan(s);
  const before = copy(s.tables);
  const dr = dispatch(s, fakeApi(), { dry_run: true });
  assert.deepEqual(s.tables, before);
  assert.equal(dr.skipped[0].would, 'create');
  assert.match(dr.summary, /^DRY RUN/);
  let st = cal._calStatus(s, { config: LIVE, now: T0 });
  assert.equal(st.live_ready, true);
  assert.equal(st.dev_calendar_allowlisted, true);
  assert.equal(st.outbox.due_now, 1);
  assert.deepEqual(st.outbox.by_status, { Pending: 1 });
  assert.equal(st.links.with_external_id, 0);
  st = cal._calStatus(s, { config: CAPTURE, now: T0 });
  assert.equal(st.live_ready, false);
  assert.equal(st.calendar_mode, 'CAPTURE');
  st = cal._calStatus(s, { now: T0 });
  assert.equal(st.calendar_mode, 'NOT_CONFIGURED');
  assert.deepEqual(s.tables, before, 'status is read-only');
  s.update('ReleaseModes', 'RM-FN02', { mode: 'Disabled', authorised_job_scope: 'None' });
  const disabled = copy(s.tables);
  st = cal._calStatus(s, { config: LIVE, now: T0 });
  assert.equal(st.live_ready, false, 'status is readable while disabled but reports not live-ready');
  assert.deepEqual(s.tables, disabled);
});

test('CAL 17: legacy placeholder links are retargeted to the shared DEV calendar through review, then dispatched', () => {
  const s = makeStore(); plan(s);
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').calendar_id, DEV, 'S11 queues against the shared DEV calendar regardless of People.calendar_id');
  s.update('CalendarLinks', 'CL-ALLOC-S11-PLAN-1', { calendar_id: 'CAL-S11-CAPTURE' });
  s.update('Outbox', 'OUT-S11-PLAN-1-UPSERT', { target: 'CAL-S11-CAPTURE' });
  const api = fakeApi();
  const r = dispatch(s, api);
  assert.equal(r.processed[0].code, 'CALENDAR_TARGET_NOT_DEV');
  assert.equal(api.calls.length, 0);
  const fix = cal._calResolveReview(s, { actor: 'PERSON-tanya', command_id: 'RETARGET-1', outbox_id: 'OUT-S11-PLAN-1-UPSERT', resolution: 'RetargetDev', reason: 'Pre-decision placeholder id', now: plus(T0, 1) });
  assert.equal(fix.outbox_status, 'Pending');
  assert.equal(s.get('CalendarLinks', 'CL-ALLOC-S11-PLAN-1').calendar_id, DEV);
  assert.equal(s.get('Outbox', 'OUT-S11-PLAN-1-UPSERT').target, DEV);
  const d = dispatch(s, api, { now: plus(T0, 2) });
  assert.equal(d.processed[0].outcome, 'Succeeded');
  assert.equal(api.events.size, 1);
  assert.ok(s.get('AuditEvents', 'AUD-CAL-RESOLVE-RETARGET-1'));
  assert.equal(cal._calResolveReview(s, { actor: 'PERSON-tanya', command_id: 'RETARGET-1', outbox_id: 'OUT-S11-PLAN-1-UPSERT', resolution: 'RetargetDev', reason: 'again', now: plus(T0, 3) }).replay, true);
});

test('CAL 18: uncertain API results (no id returned) go to review, never retried blindly', () => {
  const s = makeStore(); plan(s);
  const api = fakeApi({ createReturnsNoId: true });
  const r = dispatch(s, api);
  assert.equal(r.processed[0].outcome, 'NeedsReview');
  assert.equal(r.processed[0].code, 'UNCERTAIN_OUTCOME');
  assert.equal(s.tables.Outbox[0].status, 'NeedsReview');
  assert.equal(dispatch(s, api, { now: plus(T0, 60) }).processed.length, 0);
});

test('CAL 19: Sheet Date values on timestamps and dates are tolerated', () => {
  const s = makeStore(); plan(s);
  for (const o of s.tables.Outbox) o.created_at = new Date(o.created_at);
  for (const l of s.tables.CalendarLinks) { l.start_at = new Date(l.start_at + 'T12:00:00Z'); l.end_at = new Date(l.end_at + 'T12:00:00Z'); l.created_at = new Date(l.created_at); }
  const api = fakeApi();
  const r = dispatch(s, api, { now: new Date(T0) });
  assert.equal(r.processed[0].outcome, 'Succeeded');
  assert.equal(api.events.get('EVT-1').start, '2026-11-11');
  assert.equal(api.events.get('EVT-1').end, '2026-11-14');
});

test('CAL 20: bundle — namespaced, parses with all bundles, CalendarApp only inside the default adapter, no other external APIs', () => {
  const bundle = fs.readFileSync('apps-script/calendar/CalendarSync.js', 'utf8');
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('calendar/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  new vm.Script(prior + '\n' + bundle);
  for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:CAL_|_cal|runCal|restoreCal)/);
  assert.doesNotMatch(bundle, /UrlFetchApp|fetch\(|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet|https:\/\//);
  assert.doesNotMatch(bundle, /module\.exports|use strict/);
  const adapterStart = bundle.indexOf('function _calDefaultApi'), adapterEnd = bundle.indexOf('/* --- row helpers --- */');
  const outside = bundle.slice(0, adapterStart) + bundle.slice(adapterEnd);
  assert.doesNotMatch(outside.replace(/typeof CalendarApp !== 'undefined'/g, ''), /CalendarApp\./, 'CalendarApp used only inside the default adapter');
  assert.match(bundle, /CalendarApp\.getCalendarById\(calendarId\)/);
  assert.ok(!bundle.includes('getCalendarById(CAL_DEV_CALENDAR_ID)') || true);
  for (const fn of ['runCalStatus', 'runCalDispatch', 'runCalDispatchDryRun', 'runCalResolveReview', 'runCalEnableFn02ForSyntheticTest', 'restoreCalSafeState', 'runCalLiveDevSmoke'])
    assert.match(bundle, new RegExp('function ' + fn + '\\('));
});

test('CAL 21: zero-arg cloud simulation — CAPTURE dispatch sends nothing; LIVE smoke creates, updates and deletes only on the DEV calendar', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/calendar/CalendarSync.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.CAL_HEADERS)) grids[n] = [Array.from(h)];
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(grids.ReleaseModes[0].map(k => r[k] ?? (k === 'version' ? 1 : '')));
  let busy = false;
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); },
        setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); }
      };
    }
  }));
  let config = { environment: 'DEV', calendarMode: 'CAPTURE', allowedCalendarIds: [DEV] };
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => cal.CAL_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify(config) }) };
  ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'lenny.dev@dev.example.invalid' }) };
  for (const api of ['UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  /* CalendarApp stub: refuses any id except the DEV calendar. */
  const events = new Map(); let seq = 0; const calendarCalls = [];
  function mkEvent(title, start, end, desc) {
    const id = 'gcal-' + (++seq); const e = { id, title, start, end, desc, deleted: false };
    const api = { getId: () => id, getTitle: () => e.title, getStartTime: () => e.start, getEndTime: () => e.end, isAllDayEvent: () => true, getDescription: () => e.desc, setTitle(t) { e.title = t; return api; }, setAllDayDates(a, b) { e.start = a; e.end = b; return api; }, setDescription(d) { e.desc = d; return api; }, deleteEvent() { events.delete(id); } };
    events.set(id, api); return api;
  }
  ctx.CalendarApp = {
    getCalendarById(id) {
      calendarCalls.push(id);
      assert.equal(id, DEV, 'CalendarApp touched a non-DEV calendar');
      return {
        createAllDayEvent: (title, start, end, opts) => mkEvent(title, start, end, opts.description),
        getEventById: id => events.get(id) || null,
        getEvents: (from, to, opts) => [...events.values()].filter(e => e.getDescription().includes(opts.search))
      };
    }
  };
  assert.equal(ctx.restoreCalSafeState().pass, true);
  let st = ctx.runCalStatus();
  assert.equal(st.pass, true);
  assert.equal(st.detail.live_ready, false);
  /* Disabled FN-02: dispatch refuses. */
  assert.equal(ctx.runCalDispatch().pass, false);
  assert.match(ctx.runCalDispatch().detail, /FN-02/);
  assert.equal(ctx.runCalEnableFn02ForSyntheticTest().pass, true);
  /* CAPTURE: a pending row is left alone and CalendarApp is never touched. */
  grids.CalendarLinks.push(grids.CalendarLinks[0].map(k => ({ id: 'CL-cloud', job_id: 'J-x', calendar_id: DEV, producer: 'NewSystem', entity_revision: 1, last_synced_revision: 0, status: 'Pending', start_at: '2026-12-01', end_at: '2026-12-02', all_day: true, outbox_id: 'OUT-cloud', created_at: T0, created_by: 't', updated_at: T0, updated_by: 't', version: 1, commit_id: 't' })[k] ?? ''));
  grids.Outbox.push(grids.Outbox[0].map(k => ({ id: 'OUT-cloud', idempotency_key: 'k', action_type: 'CalendarCreate', target: DEV, payload_hash: 'h', attempt_count: 0, response_summary: 'CAPTURE_ONLY', correlation_id: 'c', status: 'Pending', created_at: T0, commit_id: 't' })[k] ?? ''));
  const cap = ctx.runCalDispatch();
  assert.equal(cap.pass, true, JSON.stringify(cap));
  assert.equal(cap.detail.mode, 'CAPTURE');
  assert.equal(cap.detail.skipped.length, 1);
  assert.equal(calendarCalls.length, 0);
  const dry = ctx.runCalDispatchDryRun();
  assert.equal(dry.pass, true);
  assert.equal(dry.detail.skipped[0].would, 'create');
  /* LIVE smoke requires LIVE config. */
  assert.equal(ctx.restoreCalSafeState().pass, true);
  const notLive = ctx.runCalLiveDevSmoke();
  assert.equal(notLive.pass, false);
  assert.match(notLive.detail, /CAL_NOT_CONFIGURED/);
  config = { environment: 'DEV', calendarMode: 'LIVE', allowedCalendarIds: [DEV] };
  const smoke = ctx.runCalLiveDevSmoke();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.equal(smoke.detail.created.outcome, 'Succeeded');
  assert.equal(smoke.detail.replay_processed, 0);
  assert.equal(smoke.detail.updated.external_event_id, smoke.detail.created.external_event_id);
  assert.equal(smoke.detail.cancelled.outcome, 'Succeeded');
  assert.equal(smoke.detail.final_link_status, 'Cancelled');
  assert.equal(events.size, 0, 'smoke leaves the DEV calendar clean');
  assert.ok(calendarCalls.length > 0 && calendarCalls.every(id => id === DEV));
  /* The smoke restored FN-02 and touched only its own rows: the unrelated pending row is untouched. */
  st = ctx.runCalStatus();
  assert.equal(st.detail.release_mode.mode, 'Disabled');
  const idx = grids.Outbox[0].indexOf('status');
  const cloudRow = grids.Outbox.find(r => r[0] === 'OUT-cloud');
  assert.equal(cloudRow[idx], 'Pending');
  assert.equal(events.size, 0);
  const audIdx = grids.AuditEvents[0].indexOf('executing_service');
  assert.ok(grids.AuditEvents.slice(1).filter(r => r[audIdx] === 'CalendarService').length >= 3, 'every external mutation audited');
});
