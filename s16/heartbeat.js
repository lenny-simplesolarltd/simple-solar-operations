/* S16 processing heartbeat — last successful processing per system component.
 * Authority: 01 §13 health/last-success, 02 §17 daily health review, 04 S16, RA01.
 * FN-14 (R1 Automated): health monitoring. Heartbeats are HealthChecks rows whose
 * integration is 'Processing:<component>'. Recording is idempotent per command_id.
 * Staleness is only alarmed inside the staffed window (office.staffed_weekdays,
 * office.hours, Holidays.office_closed); outside it a quiet component is 'Quiet'.
 * No Calendar/Drive/Xero/GHL/mail calls. DEV sheet only. Fail-safe wrapper never
 * masks the wrapped processing result. */
'use strict';

var S16_HEARTBEAT_PREFIX = 'Processing:';
var S16_HEARTBEAT_DEFAULT_STALE_MINUTES = 120;
var S16_HEARTBEAT_STALE_SETTING = 'health.heartbeat_stale_minutes';
var S16_HEARTBEAT_OUTCOME_OK = 'OK';
var S16_HEARTBEAT_OUTCOME_FAILED = 'FAILED';
var S16_HEARTBEAT_STATES = ['Fresh', 'Stale', 'Failing', 'Quiet', 'Never'];

/* Resolve S16 core helpers from the shared Apps Script global scope or the Node module. */
function _s16HbCore() {
  if (typeof _s16Scope === 'function' && typeof _s16Timestamp === 'function') {
    return { scope: _s16Scope, guard: _s16GuardStore, timestamp: _s16Timestamp, date: _s16Date, isTrue: _s16IsTrue };
  }
  var core = require('./health.js');
  return { scope: core._s16Scope, guard: core._s16GuardStore, timestamp: core._s16Timestamp, date: core._s16Date, isTrue: core._s16IsTrue };
}

function _s16HbText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _s16HbNow(input) {
  if (input && input.now !== undefined && input.now !== null && input.now !== '') {
    var t = _s16HbCore().timestamp(input.now);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(String(t))) throw new Error('S16_REVIEW: invalid now');
    return new Date(t).toISOString();
  }
  return new Date().toISOString();
}
function _s16HbComponent(value) {
  if (!_s16HbText(value)) throw new Error('S16_REVIEW: component required');
  var c = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(c)) throw new Error('S16_REVIEW: component must be 1-48 chars of letters, digits, _ or -');
  return c;
}
function _s16HbCommandId(value) {
  if (!_s16HbText(value)) throw new Error('S16_REVIEW: command_id required');
  var c = value.trim();
  if (c.length > 120) throw new Error('S16_REVIEW: command_id too long');
  return c;
}
function _s16HbOutcome(value) {
  if (value === undefined || value === null || value === '') return S16_HEARTBEAT_OUTCOME_OK;
  var o = String(value).trim();
  if (!/^[A-Za-z0-9_]{1,40}$/.test(o)) throw new Error('S16_REVIEW: outcome must be a short code');
  return o;
}
function _s16HbErrorCode(value) {
  if (value === undefined || value === null || value === '') return null;
  var s = String(value.message || value).replace(/\s+/g, ' ').trim();
  return s.length > 200 ? s.substring(0, 200) : s;
}
function _s16HbIntegration(component) { return S16_HEARTBEAT_PREFIX + component; }
function _s16HbHeartbeatRows(store, component) {
  var wanted = component ? _s16HbIntegration(component) : null;
  return store.list('HealthChecks').filter(function (h) {
    return typeof h.integration === 'string' && h.integration.indexOf(S16_HEARTBEAT_PREFIX) === 0 && (!wanted || h.integration === wanted);
  });
}
function _s16HbMinutesBetween(fromIso, toIso) {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
}

/* --- Staffed window: Settings + Holidays --- */

function _s16HbLatestSetting(store, key) {
  var rows = store.list('Settings').filter(function (s) { return s.key === key; });
  if (rows.length === 0) return null;
  rows.sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); });
  return rows[0];
}
function _s16HbStaleMinutes(store, input) {
  if (input && input.stale_minutes !== undefined && input.stale_minutes !== null && input.stale_minutes !== '') {
    var n = Number(input.stale_minutes);
    if (!isFinite(n) || n <= 0 || n > 10080) throw new Error('S16_REVIEW: stale_minutes must be 1-10080');
    return Math.floor(n);
  }
  var setting = _s16HbLatestSetting(store, S16_HEARTBEAT_STALE_SETTING);
  if (!setting) return S16_HEARTBEAT_DEFAULT_STALE_MINUTES;
  var v = Number(setting.typed_value);
  if (!isFinite(v) || v <= 0 || v > 10080) return S16_HEARTBEAT_DEFAULT_STALE_MINUTES;
  return Math.floor(v);
}
function _s16HbStaffedWeekdays(store) {
  var setting = _s16HbLatestSetting(store, 'office.staffed_weekdays');
  if (!setting) return [1, 2, 3, 4, 5];
  try {
    var parsed = JSON.parse(setting.typed_value);
    if (Array.isArray(parsed) && parsed.every(function (d) { return Number.isInteger(d) && d >= 0 && d <= 6; })) return parsed;
  } catch (e) { /* fall through to default */ }
  return [1, 2, 3, 4, 5];
}
function _s16HbOfficeHours(store) {
  var setting = _s16HbLatestSetting(store, 'office.hours');
  var def = { start: '09:00', end: '17:00' };
  if (!setting) return def;
  try {
    var parsed = JSON.parse(setting.typed_value);
    if (parsed && /^\d{2}:\d{2}$/.test(parsed.start) && /^\d{2}:\d{2}$/.test(parsed.end)) return { start: parsed.start, end: parsed.end };
  } catch (e) { /* fall through to default */ }
  return def;
}
function _s16HbClosedDates(store) {
  var core = _s16HbCore();
  var out = [];
  var rows = store.list('Holidays');
  for (var i = 0; i < rows.length; i++) {
    if (!core.isTrue(rows[i].office_closed)) continue;
    try { var d = core.date(rows[i].local_date); if (d) out.push(d); } catch (e) { /* ignore malformed holiday rows */ }
  }
  return out;
}
/* Europe/London local date + HH:MM for an ISO instant. */
function _s16HbLocalParts(iso) {
  var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  var map = {};
  for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
  var date = map.year + '-' + map.month + '-' + map.day;
  var hour = map.hour === '24' ? '00' : map.hour;
  return { date: date, time: hour + ':' + map.minute, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
}
function _s16HbStaffedWindow(store, nowIso) {
  var local = _s16HbLocalParts(nowIso);
  var weekdays = _s16HbStaffedWeekdays(store);
  var hours = _s16HbOfficeHours(store);
  var closed = _s16HbClosedDates(store);
  var reason = null;
  if (weekdays.indexOf(local.weekday) === -1) reason = 'NOT_STAFFED_WEEKDAY';
  else if (closed.indexOf(local.date) !== -1) reason = 'OFFICE_HOLIDAY';
  else if (local.time < hours.start || local.time >= hours.end) reason = 'OUTSIDE_OFFICE_HOURS';
  return { staffed: reason === null, reason: reason, local_date: local.date, local_time: local.time, weekday: local.weekday, hours: hours, weekdays: weekdays };
}

/* --- 1. RECORD HEARTBEAT (idempotent per component + command_id) --- */

function _s16RecordHeartbeat(store, input) {
  var core = _s16HbCore();
  core.scope(store);
  if (!input || typeof input !== 'object') throw new Error('S16_REVIEW: input required');
  var component = _s16HbComponent(input.component);
  var commandId = _s16HbCommandId(input.command_id);
  var outcome = _s16HbOutcome(input.outcome);
  var errorCode = outcome === S16_HEARTBEAT_OUTCOME_OK ? null : (_s16HbErrorCode(input.error_code) || outcome);
  var now = _s16HbNow(input);
  var integration = _s16HbIntegration(component);
  var id = 'HB-' + component + '-' + commandId;

  var existing = store.get('HealthChecks', id);
  if (existing) {
    if (existing.integration !== integration) throw new Error('S16_REFUSED: heartbeat id collision ' + id);
    return { created: false, replay: true, heartbeat_id: id, component: component, integration: integration, outcome: existing.outcome, checked_at: core.timestamp(existing.checked_at), last_success: core.timestamp(existing.last_success) };
  }

  var prior = _s16HbHeartbeatRows(store, component);
  var priorSuccess = null;
  for (var i = 0; i < prior.length; i++) {
    var ls = core.timestamp(prior[i].last_success);
    if (ls && (!priorSuccess || ls > priorSuccess)) priorSuccess = ls;
  }
  var lastSuccess = outcome === S16_HEARTBEAT_OUTCOME_OK ? now : priorSuccess;

  store.insert('HealthChecks', {
    id: id, integration: integration, checked_at: now, outcome: outcome,
    last_success: lastSuccess, error_code: errorCode,
    next_action_task_id: null, created_at: now, commit_id: 'S16-HB-' + commandId
  });
  return { created: true, replay: false, heartbeat_id: id, component: component, integration: integration, outcome: outcome, checked_at: now, last_success: lastSuccess, error_code: errorCode };
}

/* --- 2. HEARTBEAT STATUS (read-only) --- */

function _s16ComponentHeartbeat(rows, component, nowIso, staleMinutes, window) {
  var core = _s16HbCore();
  var latest = null, latestAt = null, lastSuccess = null;
  for (var i = 0; i < rows.length; i++) {
    var at = core.timestamp(rows[i].checked_at);
    if (at && (!latestAt || at > latestAt)) { latestAt = at; latest = rows[i]; }
    var ls = core.timestamp(rows[i].last_success);
    if (ls && (!lastSuccess || ls > lastSuccess)) lastSuccess = ls;
  }
  var result = {
    component: component, integration: _s16HbIntegration(component), checks: rows.length,
    latest_outcome: latest ? latest.outcome : null, last_checked_at: latestAt, last_success_at: lastSuccess,
    age_minutes: lastSuccess ? _s16HbMinutesBetween(lastSuccess, nowIso) : null,
    error_code: latest && latest.outcome !== S16_HEARTBEAT_OUTCOME_OK ? (latest.error_code || latest.outcome) : null,
    state: 'Never', stale: false
  };
  if (!latest) return result;
  var aged = !lastSuccess || result.age_minutes > staleMinutes;
  result.stale = aged && window.staffed;
  if (latest.outcome !== S16_HEARTBEAT_OUTCOME_OK) result.state = 'Failing';
  else if (aged) result.state = window.staffed ? 'Stale' : 'Quiet';
  else result.state = 'Fresh';
  return result;
}

function _s16HeartbeatStatus(store, input) {
  var core = _s16HbCore();
  core.scope(store);
  input = input || {};
  var now = _s16HbNow(input);
  var staleMinutes = _s16HbStaleMinutes(store, input);
  var window = _s16HbStaffedWindow(store, now);
  var all = _s16HbHeartbeatRows(store, null);
  var byComponent = {};
  for (var i = 0; i < all.length; i++) {
    var c = all[i].integration.substring(S16_HEARTBEAT_PREFIX.length);
    if (!byComponent[c]) byComponent[c] = [];
    byComponent[c].push(all[i]);
  }
  var expected = Array.isArray(input.expected) ? input.expected : [];
  for (var e = 0; e < expected.length; e++) {
    var ec = _s16HbComponent(expected[e]);
    if (!byComponent[ec]) byComponent[ec] = [];
  }
  var names = Object.keys(byComponent).sort();
  var components = [], alerts = [], summary = { fresh: 0, stale: 0, failing: 0, quiet: 0, never: 0 };
  for (var n = 0; n < names.length; n++) {
    var comp = _s16ComponentHeartbeat(byComponent[names[n]], names[n], now, staleMinutes, window);
    components.push(comp);
    summary[comp.state.toLowerCase()]++;
    if (comp.state === 'Failing') {
      alerts.push({ severity: comp.stale ? 'Critical' : 'Warning', component: 'Heartbeat:' + comp.component, state: comp.state, detail: 'Last processing attempt failed (' + comp.error_code + ')' + (comp.stale ? '; no success for ' + comp.age_minutes + ' min' : ''), last_success_at: comp.last_success_at });
    } else if (comp.state === 'Stale') {
      alerts.push({ severity: 'Warning', component: 'Heartbeat:' + comp.component, state: comp.state, detail: comp.last_success_at ? 'No successful processing for ' + comp.age_minutes + ' min (threshold ' + staleMinutes + ')' : 'No successful processing recorded', last_success_at: comp.last_success_at });
    } else if (comp.state === 'Never' && window.staffed) {
      alerts.push({ severity: 'Warning', component: 'Heartbeat:' + comp.component, state: comp.state, detail: 'Expected component has never recorded a heartbeat', last_success_at: null });
    }
  }
  return {
    generated_at: now,
    stale_minutes: staleMinutes,
    staffed_window: window,
    components: components,
    alerts: alerts,
    alert_count: alerts.length,
    critical_count: alerts.filter(function (a) { return a.severity === 'Critical'; }).length,
    summary: summary
  };
}

/* --- 3. FAIL-SAFE WRAPPER: heartbeat around a processing step --- */

function _s16WithHeartbeat(store, input, fn) {
  if (typeof fn !== 'function') throw new Error('S16_REVIEW: fn required');
  var outcome = S16_HEARTBEAT_OUTCOME_OK, error = null, result, threw = false;
  try { result = fn(); }
  catch (e) { threw = true; error = e; outcome = S16_HEARTBEAT_OUTCOME_FAILED; }
  var heartbeat = null, heartbeatError = null;
  try {
    heartbeat = _s16RecordHeartbeat(store, { component: input && input.component, command_id: input && input.command_id, outcome: outcome, error_code: error, now: input && input.now });
  } catch (e2) { heartbeatError = e2 && e2.message ? e2.message : String(e2); }
  if (threw) {
    try { error.heartbeat = heartbeat; error.heartbeat_error = heartbeatError; } catch (e3) { /* frozen error objects are fine */ }
    throw error;
  }
  return { result: result, heartbeat: heartbeat, heartbeat_error: heartbeatError };
}

/* --- 4. HOURLY TICK: for a time-driven trigger; one row per component per hour --- */

function _s16HeartbeatTick(store, input) {
  input = input || {};
  var now = _s16HbNow(input);
  var component = _s16HbComponent(input.component || 'HealthMonitor');
  var bucket = now.substring(0, 13).replace(/[^0-9T]/g, '-');
  return _s16RecordHeartbeat(store, { component: component, command_id: 'TICK-' + bucket, outcome: S16_HEARTBEAT_OUTCOME_OK, now: now });
}

if (typeof module !== 'undefined') {
  module.exports = {
    S16_HEARTBEAT_PREFIX, S16_HEARTBEAT_DEFAULT_STALE_MINUTES, S16_HEARTBEAT_STALE_SETTING, S16_HEARTBEAT_STATES,
    _s16RecordHeartbeat, _s16HeartbeatStatus, _s16WithHeartbeat, _s16HeartbeatTick,
    _s16HbStaffedWindow, _s16HbLocalParts, _s16HbStaleMinutes, _s16HbHeartbeatRows
  };
}
