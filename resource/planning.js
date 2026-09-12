/* Resource planning — installer skills, leave/availability, flexible teams, readiness assessment, change-installer options,
 * Move Job preview and team planner. Authority: AGENT_RUNBOOK §A ("support flexible assignment without hardcoding fake teams",
 * "skill-aware availability", "leave-aware availability", "conflict calculations", "team-aware planner UX", "move/change-installer
 * improvements"), 01 §4 People (capacity_per_day advisory, available_from/to), 04 S11 ("make capacity warnings optional and per
 * person/team"), confirmed decisions 12 Sep 2026 (TeamMembers.role = Lead/Member/Apprentice; trades Roof/Electrical).
 *
 * Tables PersonSkills, PersonAvailability, Teams, TeamMembers (additive schema). Configuration mutations require an Admin/Manager/
 * Office actor, DEV sheet/env, CommitJournal idempotency and AuditEvents. Assessments are pure reads. S11 stays the authority at
 * commit time (it applies the same leave/skill rules); this module explains and ranks. No external calls. */
'use strict';

var RP_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var RP_SERVICE = 'ResourcePlanning';
var RP_TABLES = ['PersonSkills', 'PersonAvailability', 'Teams', 'TeamMembers'];
var RP_SKILLS = ['Roof', 'Electrical'];
var RP_TEAM_TRADES = ['Roof', 'Electrical', 'Mixed'];
var RP_MEMBER_ROLES = ['Lead', 'Member', 'Apprentice'];
var RP_AVAILABILITY_TYPES = ['Leave', 'Sick', 'Training', 'Unavailable', 'Available'];
var RP_CONFIG_ROLES = ['Admin', 'Manager', 'Office'];

/* --- utilities --- */

function _rpText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _rpTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }
function _rpRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _rpDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) _rpRefuse('RP_DATE_INVALID');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) _rpRefuse('RP_DATE_INVALID');
  var iso = m[1] + '-' + m[2] + '-' + m[3], d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) _rpRefuse('RP_DATE_INVALID');
  return iso;
}
function _rpNow(input) { if (input && input.at) { var d = new Date(input.at); if (isNaN(d.getTime())) _rpRefuse('RP_DATE_INVALID'); return d.toISOString(); } return new Date().toISOString(); }
function _rpAddDays(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function _rpDates(start, end) { var a = _rpDate(start), b = _rpDate(end); if (!a || !b) _rpRefuse('RP_REVIEW: start and end dates required'); if (b < a) _rpRefuse('RP_REVIEW: end before start'); var out = [], d = a; while (d <= b && out.length < 400) { out.push(d); d = _rpAddDays(d, 1); } return out; }
function _rpWeekday(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
function _rpOptional(store, name) { try { return store.list(name) || []; } catch (e) { return []; } }
function _rpSetting(store, key, fallback) { var rows = store.list('Settings').filter(function (s) { return s.key === key; }); if (!rows.length) return fallback; rows.sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); }); try { return JSON.parse(rows[0].typed_value); } catch (e) { return fallback; } }
function _rpStaffedWeekdays(store) { var v = _rpSetting(store, 'office.staffed_weekdays', [1, 2, 3, 4, 5]); return Array.isArray(v) ? v : [1, 2, 3, 4, 5]; }
function _rpHolidays(store) { var out = []; store.list('Holidays').forEach(function (h) { if (_rpTrue(h.office_closed)) { try { var d = _rpDate(h.local_date); if (d) out.push(d); } catch (e) { /* skip */ } } }); return out; }

/* --- guards --- */

function _rpGuardStore(store) {
  if (!store || !store.getSheetId || store.getSheetId() !== RP_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') _rpRefuse('RP_REFUSED: exact DEV sheet/environment required');
}
/* Configuration actors must be active Admin/Manager/Office people (by People.role or an active PersonRoles row). */
function _rpRequireConfigActor(store, actor) {
  if (!_rpText(actor)) _rpRefuse('RP_REVIEW: actor required');
  var p = store.get('People', actor);
  if (!p || !_rpTrue(p.active)) _rpRefuse('RP_REFUSED: actor must be an active person id');
  var roles = [p.role].concat(store.list('PersonRoles').filter(function (r) { return r.person_id === actor && _rpTrue(r.active); }).map(function (r) { return r.role; }));
  if (!roles.some(function (r) { return RP_CONFIG_ROLES.indexOf(r) !== -1; })) _rpRefuse('RP_REFUSED: actor role must be Admin, Manager or Office');
  return p;
}
function _rpInstaller(store, personId) {
  var p = store.get('People', personId);
  if (!p || !_rpTrue(p.active) || p.role !== 'Installer') _rpRefuse('RP_REVIEW: active Installer required');
  return p;
}
function _rpCommandStart(store, input, entityType, entityId, changes) {
  if (!_rpText(input.command_id)) _rpRefuse('RP_REVIEW: command_id required');
  var id = 'CJ-RP-' + input.command_id, encoded = JSON.stringify(changes), existing = store.get('CommitJournal', id);
  if (existing) {
    if (existing.command_id !== input.command_id || existing.entity_type !== entityType || existing.entity_id !== entityId || existing.changes_json !== encoded) _rpRefuse('RP_REVIEW: conflicting command identity');
    if (existing.state !== 'Committed') _rpRefuse('RP_RECOVERY_REQUIRED: incomplete command ' + input.command_id);
    return { replay: true };
  }
  var now = _rpNow(input);
  store.insert('CommitJournal', { id: id, commit_id: 'RP-' + input.command_id, state: 'Prepared', command_id: input.command_id, entity_type: entityType, entity_id: entityId, expected_version: null, changes_json: encoded, prepared_at: now, committed_at: null, created_at: now });
  return { replay: false };
}
function _rpCommit(store, input, now) { store.update('CommitJournal', 'CJ-RP-' + input.command_id, { state: 'Committed', committed_at: now }); }
function _rpAudit(store, type, id, action, before, after, input, now) {
  store.insert('AuditEvents', { id: 'AUD-RP-' + input.command_id + '-' + type + '-' + id, entity_type: type, entity_id: id, action: action, before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null, initiating_actor: input.actor, executing_service: RP_SERVICE, timestamp: now, correlation_id: input.command_id, reason: input.reason || null, commit_id: 'RP-' + input.command_id, created_at: now });
}
function _rpUpsert(store, table, id, fields, input, now) {
  var existing = store.get(table, id);
  if (existing) {
    var patch = {}; for (var k in fields) if (fields.hasOwnProperty(k)) patch[k] = fields[k];
    patch.updated_at = now; patch.updated_by = input.actor; patch.version = Number(existing.version || 0) + 1;
    store.update(table, id, patch);
    return { created: false, before: existing, after: store.get(table, id) };
  }
  var row = Object.assign({ id: id, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, commit_id: 'RP-' + input.command_id }, fields);
  store.insert(table, row);
  return { created: true, before: null, after: row };
}

/* --- 1. SKILLS --- */

function _rpSetSkill(store, input) {
  _rpGuardStore(store); _rpRequireConfigActor(store, input.actor);
  var person = _rpInstaller(store, input.person_id);
  if (RP_SKILLS.indexOf(input.skill) === -1) _rpRefuse('RP_REVIEW: skill must be Roof or Electrical');
  var level = input.level || 'Member';
  if (RP_MEMBER_ROLES.indexOf(level) === -1) _rpRefuse('RP_REVIEW: level must be Lead, Member or Apprentice');
  var until = _rpDate(input.certified_until);
  var fields = { person_id: person.id, skill: input.skill, level: level, certified_until: until, active: input.active === undefined ? true : input.active === true, notes: input.notes || null };
  var id = 'SK-' + person.id + '-' + input.skill;
  var cmd = _rpCommandStart(store, input, 'PersonSkills', id, fields);
  if (cmd.replay) return { replay: true, skill: store.get('PersonSkills', id) };
  var now = _rpNow(input), r = _rpUpsert(store, 'PersonSkills', id, fields, input, now);
  _rpAudit(store, 'PersonSkills', id, r.created ? 'SetSkill' : 'UpdateSkill', r.before, r.after, input, now);
  _rpCommit(store, input, now);
  return { replay: false, created: r.created, skill: r.after, external_calls: 0 };
}

/* --- 2. AVAILABILITY (leave) --- */

function _rpAllocationsFor(store, personId, from, to) {
  return store.list('Allocations').filter(function (a) {
    if (a.person_id !== personId || !_rpTrue(a.active) || !a.start_at || !a.end_at) return false;
    var s, e; try { s = _rpDate(a.start_at); e = _rpDate(a.end_at); } catch (x) { return false; }
    return s <= to && e >= from;
  });
}
function _rpSetAvailability(store, input) {
  _rpGuardStore(store); _rpRequireConfigActor(store, input.actor);
  var person = store.get('People', input.person_id);
  if (!person || !_rpTrue(person.active)) _rpRefuse('RP_REVIEW: active person required');
  if (RP_AVAILABILITY_TYPES.indexOf(input.type) === -1) _rpRefuse('RP_REVIEW: type must be Leave, Sick, Training, Unavailable or Available');
  var from = _rpDate(input.from_date); if (!from) _rpRefuse('RP_REVIEW: from_date required');
  var to = _rpDate(input.to_date) || from;
  if (to < from) _rpRefuse('RP_REVIEW: to_date before from_date');
  var fields = { person_id: person.id, type: input.type, from_date: from, to_date: to, reason: input.reason || null, approved_by: input.approved_by || input.actor, active: true };
  var id = input.availability_id || ('AV-' + person.id + '-' + input.command_id);
  var cmd = _rpCommandStart(store, input, 'PersonAvailability', id, fields);
  if (cmd.replay) return { replay: true, availability: store.get('PersonAvailability', id) };
  var now = _rpNow(input), r = _rpUpsert(store, 'PersonAvailability', id, fields, input, now);
  var conflicts = input.type === 'Available' ? [] : _rpAllocationsFor(store, person.id, from, to).map(function (a) { var wp = store.get('WorkPackages', a.work_package_id) || {}; return { allocation_id: a.id, work_package_id: a.work_package_id, job_id: wp.job_id || null, trade: wp.trade || null, start_at: _rpDate(a.start_at), end_at: _rpDate(a.end_at) }; });
  _rpAudit(store, 'PersonAvailability', id, r.created ? 'SetAvailability' : 'UpdateAvailability', r.before, r.after, input, now);
  _rpCommit(store, input, now);
  return { replay: false, created: r.created, availability: r.after, allocation_conflicts: conflicts, replan_required: conflicts.length > 0, external_calls: 0 };
}
function _rpCancelAvailability(store, input) {
  _rpGuardStore(store); _rpRequireConfigActor(store, input.actor);
  var row = store.get('PersonAvailability', input.availability_id); if (!row) _rpRefuse('RP_REVIEW: availability not found');
  if (!_rpText(input.reason)) _rpRefuse('RP_REVIEW: reason required');
  var cmd = _rpCommandStart(store, input, 'PersonAvailability', row.id, { action: 'Cancel', reason: input.reason });
  if (cmd.replay) return { replay: true, availability: row };
  var now = _rpNow(input), r = _rpUpsert(store, 'PersonAvailability', row.id, { active: false }, input, now);
  _rpAudit(store, 'PersonAvailability', row.id, 'CancelAvailability', r.before, r.after, input, now);
  _rpCommit(store, input, now);
  return { replay: false, availability: r.after, external_calls: 0 };
}

/* --- 3. TEAMS --- */

function _rpSlug(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function _rpUpsertTeam(store, input) {
  _rpGuardStore(store); _rpRequireConfigActor(store, input.actor);
  if (!_rpText(input.name)) _rpRefuse('RP_REVIEW: name required');
  if (RP_TEAM_TRADES.indexOf(input.trade) === -1) _rpRefuse('RP_REVIEW: trade must be Roof, Electrical or Mixed');
  var id = input.team_id || ('TEAM-' + _rpSlug(input.name));
  var fields = { name: input.name.trim(), trade: input.trade, active: input.active === undefined ? true : input.active === true, notes: input.notes || null };
  var cmd = _rpCommandStart(store, input, 'Teams', id, fields);
  if (cmd.replay) return { replay: true, team: store.get('Teams', id) };
  var now = _rpNow(input), r = _rpUpsert(store, 'Teams', id, fields, input, now);
  _rpAudit(store, 'Teams', id, r.created ? 'CreateTeam' : 'UpdateTeam', r.before, r.after, input, now);
  _rpCommit(store, input, now);
  return { replay: false, created: r.created, team: r.after, external_calls: 0 };
}
function _rpSetTeamMember(store, input) {
  _rpGuardStore(store); _rpRequireConfigActor(store, input.actor);
  var team = store.get('Teams', input.team_id); if (!team) _rpRefuse('RP_REVIEW: team not found');
  var person = _rpInstaller(store, input.person_id);
  var role = input.role || 'Member';
  if (RP_MEMBER_ROLES.indexOf(role) === -1) _rpRefuse('RP_REVIEW: role must be Lead, Member or Apprentice');
  var active = input.active === undefined ? true : input.active === true;
  var id = 'TM-' + team.id + '-' + person.id;
  if (active && role === 'Lead') {
    var otherLead = store.list('TeamMembers').filter(function (m) { return m.team_id === team.id && m.id !== id && _rpTrue(m.active) && m.role === 'Lead'; })[0];
    if (otherLead) _rpRefuse('RP_REVIEW: team already has an active Lead (' + otherLead.person_id + '); change that member first');
  }
  var fields = { team_id: team.id, person_id: person.id, role: role, from_date: _rpDate(input.from_date), to_date: _rpDate(input.to_date), active: active };
  var cmd = _rpCommandStart(store, input, 'TeamMembers', id, fields);
  if (cmd.replay) return { replay: true, member: store.get('TeamMembers', id) };
  var now = _rpNow(input), r = _rpUpsert(store, 'TeamMembers', id, fields, input, now);
  _rpAudit(store, 'TeamMembers', id, r.created ? 'AddTeamMember' : 'UpdateTeamMember', r.before, r.after, input, now);
  _rpCommit(store, input, now);
  return { replay: false, created: r.created, member: r.after, external_calls: 0 };
}
function _rpTeams(store) {
  _rpGuardStore(store);
  return _rpOptional(store, 'Teams').map(function (t) {
    var members = _rpOptional(store, 'TeamMembers').filter(function (m) { return m.team_id === t.id && _rpTrue(m.active); }).map(function (m) { var p = store.get('People', m.person_id) || {}; return { person_id: m.person_id, display_name: p.display_name || m.person_id, role: m.role, active_person: _rpTrue(p.active) }; });
    return { team_id: t.id, name: t.name, trade: t.trade, active: _rpTrue(t.active), lead: (members.filter(function (m) { return m.role === 'Lead'; })[0] || {}).person_id || null, members: members };
  });
}

/* --- 4. READINESS ASSESSMENT (pure) --- */

function _rpProfile(store, personId) {
  var p = store.get('People', personId) || null;
  var skills = _rpOptional(store, 'PersonSkills').filter(function (s) { return s.person_id === personId && _rpTrue(s.active); }).map(function (s) { return { skill: s.skill, level: s.level, certified_until: s.certified_until ? _rpDate(s.certified_until) : null }; });
  var leave = _rpOptional(store, 'PersonAvailability').filter(function (a) { return a.person_id === personId && _rpTrue(a.active) && a.type !== 'Available'; }).map(function (a) { return { availability_id: a.id, type: a.type, from_date: _rpDate(a.from_date), to_date: a.to_date ? _rpDate(a.to_date) : _rpDate(a.from_date) }; });
  var teams = _rpOptional(store, 'TeamMembers').filter(function (m) { return m.person_id === personId && _rpTrue(m.active); }).map(function (m) { var t = store.get('Teams', m.team_id) || {}; return { team_id: m.team_id, team: t.name || m.team_id, role: m.role }; });
  return { person: p, skills: skills, leave: leave, teams: teams };
}
function _rpAssessPerson(store, personId, trade, start, end, excludeAllocationId, ctx) {
  var prof = _rpProfile(store, personId), p = prof.person, reasons = [], warnings = [];
  var out = { person_id: personId, display_name: p ? p.display_name : personId, ready: false, reasons: reasons, warnings: warnings, skill: null, leave_conflicts: [], capacity: [], teams: prof.teams };
  if (!p || !_rpTrue(p.active) || p.role !== 'Installer') { reasons.push('INSTALLER_INACTIVE_OR_WRONG_ROLE'); return out; }
  var cap = Number(p.capacity_per_day);
  if (!Number.isInteger(cap) || cap < 1) reasons.push('CAPACITY_NOT_CONFIGURED');
  if (p.available_from && start < _rpDate(p.available_from)) reasons.push('INSTALLER_UNAVAILABLE');
  if (p.available_to && end > _rpDate(p.available_to)) reasons.push('INSTALLER_UNAVAILABLE');
  var matching = prof.skills.filter(function (s) { return s.skill === trade; });
  out.skill = { configured: prof.skills.length > 0, matches: matching.length > 0, level: matching.length ? matching[0].level : null, skills: prof.skills.map(function (s) { return s.skill + ':' + s.level; }) };
  if (prof.skills.length && !matching.length) reasons.push('SKILL_MISMATCH');
  if (matching.length && matching[0].certified_until && matching[0].certified_until < end) warnings.push('CERTIFICATION_EXPIRES_BEFORE_END');
  if (matching.length && matching[0].level === 'Apprentice') warnings.push('APPRENTICE_NEEDS_SUPERVISION');
  out.leave_conflicts = prof.leave.filter(function (l) { return l.from_date <= end && l.to_date >= start; });
  if (out.leave_conflicts.length) reasons.push('ON_LEAVE');
  var allocations = store.list('Allocations').filter(function (a) { return a.person_id === personId && _rpTrue(a.active) && a.id !== excludeAllocationId && a.start_at && a.end_at; });
  ctx.dates.forEach(function (date) {
    if (ctx.holidays.indexOf(date) !== -1) { reasons.indexOf('OFFICE_HOLIDAY') === -1 && reasons.push('OFFICE_HOLIDAY'); return; }
    if (ctx.weekdays.indexOf(_rpWeekday(date)) === -1) return;
    var used = allocations.filter(function (a) { return _rpDate(a.start_at) <= date && _rpDate(a.end_at) >= date; });
    var entry = { date: date, used: used.length, capacity: Number.isInteger(cap) ? cap : null, allocations: used.map(function (a) { return a.id; }) };
    out.capacity.push(entry);
    if (Number.isInteger(cap) && cap >= 1 && used.length >= cap) reasons.indexOf('CAPACITY_CONFLICT') === -1 && reasons.push('CAPACITY_CONFLICT');
  });
  out.load = out.capacity.reduce(function (n, c) { return n + c.used; }, 0);
  out.ready = reasons.length === 0;
  return out;
}
function _rpAssess(store, input) {
  _rpGuardStore(store);
  input = input || {};
  if (RP_SKILLS.indexOf(input.trade) === -1) _rpRefuse('RP_REVIEW: trade must be Roof or Electrical');
  var start = _rpDate(input.start_at), end = _rpDate(input.end_at);
  var ctx = { dates: _rpDates(start, end), holidays: _rpHolidays(store), weekdays: _rpStaffedWeekdays(store) };
  var ids = Array.isArray(input.person_ids) && input.person_ids.length ? input.person_ids : null;
  var teamMembers = null;
  if (!ids && _rpText(input.team_id)) { teamMembers = _rpOptional(store, 'TeamMembers').filter(function (m) { return m.team_id === input.team_id && _rpTrue(m.active); }); ids = teamMembers.map(function (m) { return m.person_id; }); }
  if (!ids) ids = store.list('People').filter(function (p) { return _rpTrue(p.active) && p.role === 'Installer'; }).map(function (p) { return p.id; });
  var people = ids.map(function (id) { return _rpAssessPerson(store, id, input.trade, start, end, input.exclude_allocation_id || null, ctx); });
  var rank = function (a, b) {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    var la = a.skill && a.skill.matches ? RP_MEMBER_ROLES.indexOf(a.skill.level) : 3, lb = b.skill && b.skill.matches ? RP_MEMBER_ROLES.indexOf(b.skill.level) : 3;
    if (la !== lb) return la - lb;
    if (a.load !== b.load) return (a.load || 0) - (b.load || 0);
    return String(a.display_name).localeCompare(String(b.display_name));
  };
  var ranked = people.slice().sort(rank);
  var result = { trade: input.trade, start_at: start, end_at: end, working_days: ctx.dates.filter(function (d) { return ctx.weekdays.indexOf(_rpWeekday(d)) !== -1 && ctx.holidays.indexOf(d) === -1; }).length, candidates: ranked, ready_count: ranked.filter(function (c) { return c.ready; }).length };
  if (teamMembers) {
    var lead = teamMembers.filter(function (m) { return m.role === 'Lead'; })[0];
    result.team = { team_id: input.team_id, all_ready: ranked.length > 0 && ranked.every(function (c) { return c.ready; }), lead_person_id: lead ? lead.person_id : null, lead_ready: lead ? !!(ranked.filter(function (c) { return c.person_id === lead.person_id; })[0] || {}).ready : false, members: ranked.length };
  }
  return result;
}

/* --- 5. CHANGE INSTALLER OPTIONS (ranked candidates + team suggestions for a work package) --- */

function _rpChangeInstallerOptions(store, input) {
  _rpGuardStore(store);
  var wp = store.get('WorkPackages', input.work_package_id); if (!wp) _rpRefuse('RP_REVIEW: work package not found');
  var current = store.list('Allocations').filter(function (a) { return a.work_package_id === wp.id && _rpTrue(a.active); });
  var start = _rpDate(input.start_at || wp.planned_start), end = _rpDate(input.end_at || wp.planned_end);
  if (!start || !end) _rpRefuse('RP_REVIEW: work package has no planned dates');
  var trade = RP_SKILLS.indexOf(wp.trade) !== -1 ? wp.trade : _rpRefuse('RP_REVIEW: work package trade ' + wp.trade + ' is not Roof/Electrical');
  var exclude = input.old_allocation_id || null;
  var assess = _rpAssess(store, { trade: trade, start_at: start, end_at: end, exclude_allocation_id: exclude });
  var currentIds = current.map(function (a) { return a.person_id; });
  assess.candidates.forEach(function (c) { c.currently_allocated = currentIds.indexOf(c.person_id) !== -1; c.allocation_id = (current.filter(function (a) { return a.person_id === c.person_id; })[0] || {}).id || null; });
  var teams = _rpTeams(store).filter(function (t) { return t.active && (t.trade === trade || t.trade === 'Mixed') && t.members.length; }).map(function (t) {
    var a = _rpAssess(store, { trade: trade, start_at: start, end_at: end, team_id: t.team_id, exclude_allocation_id: exclude });
    return { team_id: t.team_id, name: t.name, trade: t.trade, all_ready: a.team.all_ready, lead_ready: a.team.lead_ready, members: a.candidates.map(function (c) { return { person_id: c.person_id, display_name: c.display_name, ready: c.ready, reasons: c.reasons }; }) };
  });
  return { work_package_id: wp.id, job_id: wp.job_id, trade: trade, start_at: start, end_at: end, current_allocations: current.map(function (a) { return { allocation_id: a.id, person_id: a.person_id, role: a.role }; }), candidates: assess.candidates, ready_count: assess.ready_count, teams: teams };
}

/* --- 6. MOVE JOB PREVIEW (read-only impact of proposed dates) --- */

function _rpMoveJobPreview(store, input) {
  _rpGuardStore(store);
  var job = store.get('Jobs', input.job_id); if (!job) _rpRefuse('RP_REVIEW: job not found');
  var activities = Array.isArray(input.activities) ? input.activities : [];
  if (!activities.length) _rpRefuse('RP_REVIEW: select at least one activity (Roof|Electrical|Scaffold)');
  var start = _rpDate(input.planned_start), end = _rpDate(input.planned_end);
  var out = { job_id: job.id, job_version: job.version, activities: activities, proposed: { planned_start: start, planned_end: end, scaffold_erect: _rpDate(input.scaffold_erect), scaffold_strip: _rpDate(input.scaffold_strip) }, work_packages: [], preserved: [], scaffold: [], calendar_links: 0, materials: [], conflicts: 0, warnings: [] };
  store.list('WorkPackages').filter(function (w) { return w.job_id === job.id && w.status !== 'Cancelled'; }).forEach(function (wp) {
    var moving = activities.indexOf(wp.trade) !== -1;
    var allocations = store.list('Allocations').filter(function (a) { return a.work_package_id === wp.id && _rpTrue(a.active); });
    if (!moving) { out.preserved.push({ work_package_id: wp.id, trade: wp.trade, planned_start: _rpDate(wp.planned_start), planned_end: _rpDate(wp.planned_end), allocations: allocations.length }); return; }
    if (!start || !end) _rpRefuse('RP_REVIEW: planned_start/planned_end required for ' + wp.trade);
    var entry = { work_package_id: wp.id, trade: wp.trade, current: { planned_start: _rpDate(wp.planned_start), planned_end: _rpDate(wp.planned_end) }, proposed: { planned_start: start, planned_end: end }, revision: wp.revision, expected_version: wp.version, people: [] };
    if (RP_SKILLS.indexOf(wp.trade) !== -1) {
      var ctx = { dates: _rpDates(start, end), holidays: _rpHolidays(store), weekdays: _rpStaffedWeekdays(store) };
      allocations.forEach(function (a) {
        var as = _rpAssessPerson(store, a.person_id, wp.trade, start, end, a.id, ctx);
        entry.people.push({ allocation_id: a.id, person_id: a.person_id, display_name: as.display_name, role: a.role, ready: as.ready, reasons: as.reasons, warnings: as.warnings, leave_conflicts: as.leave_conflicts });
        if (!as.ready) out.conflicts++;
        if (a.calendar_link_id && store.get('CalendarLinks', a.calendar_link_id)) out.calendar_links++;
      });
    }
    store.list('Materials').filter(function (m) { return m.work_package_id === wp.id && _rpTrue(true) && Number(m.required_quantity || 0) - Number(m.cancelled_quantity || 0) > 0; }).forEach(function (m) {
      var need = m.need_by_date ? _rpDate(m.need_by_date) : null;
      var line = m.order_line_id ? store.get('OrderLines', m.order_line_id) : null, order = line ? store.get('Orders', line.order_id) : null;
      var risk = need && need > start ? 'NEED_BY_AFTER_NEW_START' : (order && ['Requested', 'Confirmed'].indexOf(order.status) !== -1 && need && need < _rpAddDays(start, -14) ? 'DELIVERY_WELL_BEFORE_NEW_START' : null);
      out.materials.push({ material_id: m.id, work_package_id: wp.id, need_by_date: need, order_id: order ? order.id : null, order_status: order ? order.status : null, flag: risk });
      if (risk) out.warnings.push(wp.trade + ' material ' + m.id + ': ' + risk);
    });
    out.work_packages.push(entry);
  });
  store.list('ScaffoldBookings').filter(function (b) { return b.job_id === job.id && b.status !== 'Cancelled'; }).forEach(function (b) {
    var moving = activities.indexOf('Scaffold') !== -1;
    out.scaffold.push({ scaffold_booking_id: b.id, status: b.status, moving: moving, current: { erect_planned_at: _rpDate(b.erect_planned_at), strip_planned_at: _rpDate(b.strip_planned_at) }, proposed: moving ? { erect_planned_at: out.proposed.scaffold_erect || _rpDate(b.erect_planned_at), strip_planned_at: out.proposed.scaffold_strip || _rpDate(b.strip_planned_at) } : null, acknowledgement_required_after_move: moving, erected: !!b.erect_actual_at });
    if (moving && b.erect_actual_at && out.proposed.scaffold_erect) out.warnings.push('Scaffold ' + b.id + ' already erected; erect date cannot move');
    if (!moving && activities.indexOf('Roof') !== -1 && b.erect_planned_at && start && _rpDate(b.erect_planned_at) > start) out.warnings.push('Scaffold erect ' + _rpDate(b.erect_planned_at) + ' is after the proposed roof start ' + start);
  });
  out.ok_to_move = out.conflicts === 0;
  return out;
}

/* --- 7. TEAM PLANNER (team-aware rows over a window) --- */

function _rpTeamPlanner(store, start, weeks) {
  _rpGuardStore(store);
  var from = _rpDate(start), to = _rpAddDays(from, Number(weeks || 3) * 7 - 1), holidays = _rpHolidays(store);
  var installers = store.list('People').filter(function (p) { return _rpTrue(p.active) && p.role === 'Installer'; });
  function rowsFor(personId) {
    return _rpAllocationsFor(store, personId, from, to).map(function (a) { var wp = store.get('WorkPackages', a.work_package_id) || {}, job = wp.job_id ? store.get('Jobs', wp.job_id) : null; return { allocation_id: a.id, work_package_id: a.work_package_id, job_id: wp.job_id || null, job_display: job ? job.display_name : null, trade: wp.trade || null, role: a.role, start_at: _rpDate(a.start_at), end_at: _rpDate(a.end_at) }; });
  }
  function leaveFor(personId) { return _rpOptional(store, 'PersonAvailability').filter(function (l) { return l.person_id === personId && _rpTrue(l.active) && l.type !== 'Available'; }).map(function (l) { return { type: l.type, from_date: _rpDate(l.from_date), to_date: l.to_date ? _rpDate(l.to_date) : _rpDate(l.from_date) }; }).filter(function (l) { return l.from_date <= to && l.to_date >= from; }); }
  var seen = {}, teams = _rpTeams(store).filter(function (t) { return t.active; }).map(function (t) {
    return { team_id: t.team_id, name: t.name, trade: t.trade, lead: t.lead, members: t.members.map(function (m) { seen[m.person_id] = true; return { person_id: m.person_id, display_name: m.display_name, role: m.role, allocations: rowsFor(m.person_id), leave: leaveFor(m.person_id) }; }) };
  });
  var unassigned = installers.filter(function (p) { return !seen[p.id]; }).map(function (p) { return { person_id: p.id, display_name: p.display_name, allocations: rowsFor(p.id), leave: leaveFor(p.id) }; });
  return { from: from, to: to, weeks: Number(weeks || 3), holidays: holidays.filter(function (h) { return h >= from && h <= to; }), teams: teams, unassigned_installers: unassigned };
}

/* --- 8. STATUS --- */

function _rpStatus(store) {
  _rpGuardStore(store);
  var tables = {};
  RP_TABLES.forEach(function (n) { try { var rows = store.list(n); tables[n] = { present: true, rows: rows.length, active: rows.filter(function (r) { return _rpTrue(r.active); }).length }; } catch (e) { tables[n] = { present: false, rows: 0, active: 0, detail: String(e.message || e) }; } });
  var installers = store.list('People').filter(function (p) { return _rpTrue(p.active) && p.role === 'Installer'; });
  var skilled = installers.filter(function (p) { return _rpOptional(store, 'PersonSkills').some(function (s) { return s.person_id === p.id && _rpTrue(s.active); }); }).length;
  return { tables: tables, installers: installers.length, installers_with_skills: skilled, installers_without_capacity: installers.filter(function (p) { return !(Number(p.capacity_per_day) >= 1); }).length, teams: tables.Teams.present ? _rpTeams(store).filter(function (t) { return t.active; }).length : 0 };
}

if (typeof module !== 'undefined') {
  module.exports = {
    RP_DEV_SHEET_ID, RP_TABLES, RP_SKILLS, RP_TEAM_TRADES, RP_MEMBER_ROLES, RP_AVAILABILITY_TYPES,
    _rpSetSkill, _rpSetAvailability, _rpCancelAvailability, _rpUpsertTeam, _rpSetTeamMember, _rpTeams,
    _rpAssess, _rpChangeInstallerOptions, _rpMoveJobPreview, _rpTeamPlanner, _rpStatus, _rpProfile, _rpGuardStore
  };
}
