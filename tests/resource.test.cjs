/* Resource planning tests — skills, leave, teams, assessment, change-installer options, Move Job preview, team planner. Local only. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const rp = require('../resource/planning.js'), p = require('../s11/planner.js'), fx = require('../s11/fixture.js');
const copy = x => structuredClone(x);
const T0 = '2026-09-14T09:00:00.000Z';
const BEN = 'PERSON-ben';

function makeStore(opts = {}) {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables,
    getSheetId: () => rp.RP_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => { if (opts.missing && opts.missing.includes(n)) throw new Error('S17_SCHEMA: missing/duplicate tab ' + n); return copy(tables[n] || []); },
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
    withLock(fn) { return fn(); }
  };
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  s.update('ReleaseModes', 'RM-FN01', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  s.update('ReleaseModes', 'RM-FN02', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  for (const r of seed.Settings) s.insert('Settings', { ...r, created_at: T0, commit_id: 'seed' });
  for (const r of seed.People) s.insert('People', { ...r, ...meta, source_system: 'seed', source_record_id: null });
  for (const r of seed.PersonRoles) s.insert('PersonRoles', { ...r, ...meta, source_system: 'seed' });
  fx.seed(s); /* J-s11-plan, WP-s11-roof, PERSON-s11-installer (capacity 1, available Nov–Dec) */
  s.insert('People', { ...fx.person('PERSON-s11-sparky'), display_name: 'S11 Sparky' });
  s.insert('People', { ...fx.person('PERSON-s11-second'), display_name: 'S11 Second Roofer' });
  return s;
}
const cmd = (id, extra) => ({ actor: BEN, command_id: id, at: T0, ...extra });
function skill(s, person, skillName, level, id) { return rp._rpSetSkill(s, cmd(id || ('SK-' + person + '-' + skillName), { person_id: person, skill: skillName, level })); }
function plan(s, extra = {}) { return p.planWorkPackage({ command_id: 'PLAN-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', person_id: 'PERSON-s11-installer', role: 'Lead', start_at: '2026-11-11', end_at: '2026-11-13', expected_version: 1, actor: 'PERSON-tanya', reason: 'Synthetic plan', at: fx.NOW, ...extra }, s); }

test('RP 01: skills — upsert per person+skill with audit and replay; enums enforced; installers only; config actor required', () => {
  const s = makeStore();
  const r = skill(s, 'PERSON-s11-installer', 'Roof', 'Lead');
  assert.equal(r.created, true);
  assert.equal(r.skill.id, 'SK-PERSON-s11-installer-Roof');
  assert.equal(r.skill.level, 'Lead');
  assert.equal(s.get('CommitJournal', 'CJ-RP-SK-PERSON-s11-installer-Roof').state, 'Committed');
  assert.equal(skill(s, 'PERSON-s11-installer', 'Roof', 'Lead').replay, true);
  const upd = rp._rpSetSkill(s, cmd('SK-2', { person_id: 'PERSON-s11-installer', skill: 'Roof', level: 'Member', certified_until: '2027-01-31' }));
  assert.equal(upd.created, false);
  assert.equal(upd.skill.version, 2);
  assert.equal(upd.skill.certified_until, '2027-01-31');
  assert.equal(s.tables.PersonSkills.length, 1);
  assert.equal(s.tables.AuditEvents.filter(a => a.executing_service === 'ResourcePlanning').length, 2);
  assert.throws(() => skill(s, 'PERSON-s11-installer', 'Scaffold', 'Member', 'X1'), /skill must be Roof or Electrical/);
  assert.throws(() => skill(s, 'PERSON-s11-installer', 'Roof', 'Boss', 'X2'), /level must be Lead, Member or Apprentice/);
  assert.throws(() => skill(s, 'PERSON-tanya', 'Roof', 'Member', 'X3'), /active Installer required/);
  assert.throws(() => rp._rpSetSkill(s, { actor: 'PERSON-s11-installer', command_id: 'X4', person_id: 'PERSON-s11-sparky', skill: 'Roof', at: T0 }), /actor role must be Admin, Manager or Office/);
  assert.throws(() => rp._rpSetSkill(s, { actor: 'nobody', command_id: 'X5', person_id: 'PERSON-s11-sparky', skill: 'Roof', at: T0 }), /active person id/);
  /* Tanya (Office) may configure. */
  assert.equal(rp._rpSetSkill(s, cmd('X6', { actor: 'PERSON-tanya', person_id: 'PERSON-s11-sparky', skill: 'Electrical' })).created, true);
  const s2 = makeStore(); s2.getEnvironment = () => 'PROD';
  assert.throws(() => skill(s2, 'PERSON-s11-installer', 'Roof', 'Lead'), /exact DEV/);
});

test('RP 02: availability — leave periods flag existing allocation conflicts; Available type does not; cancel deactivates', () => {
  const s = makeStore(); plan(s);
  const r = rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-12', to_date: '2026-11-14', reason: 'Holiday' }));
  assert.equal(r.created, true);
  assert.equal(r.replan_required, true);
  assert.deepEqual(r.allocation_conflicts.map(c => [c.allocation_id, c.trade, c.start_at, c.end_at]), [['ALLOC-S11-PLAN-1', 'Roof', '2026-11-11', '2026-11-13']]);
  assert.equal(r.availability.approved_by, BEN);
  assert.equal(rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-12', to_date: '2026-11-14', reason: 'Holiday' })).replay, true);
  const single = rp._rpSetAvailability(s, cmd('LV-2', { person_id: 'PERSON-s11-installer', type: 'Training', from_date: '2026-12-01' }));
  assert.equal(single.availability.to_date, '2026-12-01');
  assert.equal(single.replan_required, false);
  const avail = rp._rpSetAvailability(s, cmd('LV-3', { person_id: 'PERSON-s11-installer', type: 'Available', from_date: '2026-11-11', to_date: '2026-11-13' }));
  assert.deepEqual(avail.allocation_conflicts, []);
  assert.throws(() => rp._rpSetAvailability(s, cmd('LV-4', { person_id: 'PERSON-s11-installer', type: 'Vacation', from_date: '2026-11-12' })), /type must be/);
  assert.throws(() => rp._rpSetAvailability(s, cmd('LV-5', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-12', to_date: '2026-11-10' })), /to_date before from_date/);
  assert.throws(() => rp._rpCancelAvailability(s, cmd('LV-6', { availability_id: r.availability.id })), /reason required/);
  const c = rp._rpCancelAvailability(s, cmd('LV-7', { availability_id: r.availability.id, reason: 'Leave withdrawn' }));
  assert.equal(c.availability.active, false);
  assert.equal(s.get('PersonAvailability', r.availability.id).version, 2);
});

test('RP 03: teams — flexible creation, Lead/Member/Apprentice roles, single active Lead, installers only', () => {
  const s = makeStore();
  const t = rp._rpUpsertTeam(s, cmd('T-1', { name: 'Roof Crew A', trade: 'Roof' }));
  assert.equal(t.team.id, 'TEAM-roof-crew-a');
  assert.equal(rp._rpUpsertTeam(s, cmd('T-1', { name: 'Roof Crew A', trade: 'Roof' })).replay, true);
  assert.throws(() => rp._rpUpsertTeam(s, cmd('T-2', { name: 'X', trade: 'Scaffold' })), /trade must be Roof, Electrical or Mixed/);
  const m1 = rp._rpSetTeamMember(s, cmd('M-1', { team_id: t.team.id, person_id: 'PERSON-s11-installer', role: 'Lead' }));
  assert.equal(m1.member.id, 'TM-TEAM-roof-crew-a-PERSON-s11-installer');
  assert.throws(() => rp._rpSetTeamMember(s, cmd('M-2', { team_id: t.team.id, person_id: 'PERSON-s11-second', role: 'Lead' })), /already has an active Lead/);
  const m2 = rp._rpSetTeamMember(s, cmd('M-3', { team_id: t.team.id, person_id: 'PERSON-s11-second', role: 'Apprentice' }));
  assert.equal(m2.created, true);
  assert.throws(() => rp._rpSetTeamMember(s, cmd('M-4', { team_id: t.team.id, person_id: 'PERSON-s11-sparky', role: 'Foreman' })), /role must be Lead, Member or Apprentice/);
  assert.throws(() => rp._rpSetTeamMember(s, cmd('M-5', { team_id: t.team.id, person_id: 'PERSON-tanya', role: 'Member' })), /active Installer required/);
  assert.throws(() => rp._rpSetTeamMember(s, cmd('M-6', { team_id: 'TEAM-nope', person_id: 'PERSON-s11-sparky' })), /team not found/);
  /* Demote lead, then promote another. */
  rp._rpSetTeamMember(s, cmd('M-7', { team_id: t.team.id, person_id: 'PERSON-s11-installer', role: 'Member' }));
  rp._rpSetTeamMember(s, cmd('M-8', { team_id: t.team.id, person_id: 'PERSON-s11-second', role: 'Lead' }));
  const teams = rp._rpTeams(s);
  assert.equal(teams.length, 1);
  assert.equal(teams[0].lead, 'PERSON-s11-second');
  assert.deepEqual(teams[0].members.map(m => m.role).sort(), ['Lead', 'Member']);
  assert.equal(s.get('TeamMembers', m1.member.id).version, 2);
});

test('RP 04: assessment — skill match, leave, capacity, holidays and ranking', () => {
  const s = makeStore();
  skill(s, 'PERSON-s11-installer', 'Roof', 'Lead');
  skill(s, 'PERSON-s11-second', 'Roof', 'Apprentice');
  skill(s, 'PERSON-s11-sparky', 'Electrical', 'Member');
  rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-second', type: 'Sick', from_date: '2026-11-12' }));
  s.insert('Allocations', { id: 'BUSY', work_package_id: 'OTHER', person_id: 'PERSON-s11-installer', role: 'Lead', start_at: '2026-11-11', end_at: '2026-11-11', active: true, replaced_allocation_id: null, cancellation_reason: null, calendar_link_id: null, created_at: T0, created_by: 't', updated_at: T0, updated_by: 't', version: 1, source_system: 't', commit_id: 't' });
  const r = rp._rpAssess(s, { trade: 'Roof', start_at: '2026-11-11', end_at: '2026-11-13' });
  assert.equal(r.working_days, 3);
  const by = Object.fromEntries(r.candidates.map(c => [c.person_id, c]));
  assert.deepEqual(by['PERSON-s11-installer'].reasons, ['CAPACITY_CONFLICT']);
  assert.equal(by['PERSON-s11-installer'].capacity[0].used, 1);
  assert.deepEqual(by['PERSON-s11-second'].reasons, ['ON_LEAVE']);
  assert.deepEqual(by['PERSON-s11-second'].warnings, ['APPRENTICE_NEEDS_SUPERVISION']);
  assert.deepEqual(by['PERSON-s11-sparky'].reasons, ['SKILL_MISMATCH']);
  assert.equal(r.ready_count, 0);
  /* Excluding the busy allocation (replacing it) frees the lead; installer B (seed) has no skills or capacity configured. */
  const r2 = rp._rpAssess(s, { trade: 'Roof', start_at: '2026-11-11', end_at: '2026-11-13', exclude_allocation_id: 'BUSY' });
  assert.equal(r2.candidates[0].person_id, 'PERSON-s11-installer');
  assert.equal(r2.candidates[0].ready, true);
  assert.ok(r2.candidates.find(c => c.person_id === 'PERSON-installer-a').reasons.includes('CAPACITY_NOT_CONFIGURED'));
  assert.equal(r2.candidates.find(c => c.person_id === 'PERSON-installer-a').skill.configured, false, 'no skills configured = flexible');
  /* Office holiday blocks everyone; weekend days are not counted. */
  s.insert('Holidays', { id: 'HOL', local_date: '2026-11-12', description: 'x', office_closed: true, created_at: T0, created_by: 't', commit_id: 't' });
  const r3 = rp._rpAssess(s, { trade: 'Roof', start_at: '2026-11-11', end_at: '2026-11-15', exclude_allocation_id: 'BUSY' });
  assert.ok(r3.candidates.every(c => c.reasons.includes('OFFICE_HOLIDAY')));
  assert.equal(r3.working_days, 2);
  assert.equal(r3.candidates[0].capacity.length, 2, 'Thu/Fri only: holiday and weekend excluded');
  assert.throws(() => rp._rpAssess(s, { trade: 'Plumbing', start_at: '2026-11-11', end_at: '2026-11-11' }), /trade must be Roof or Electrical/);
  assert.throws(() => rp._rpAssess(s, { trade: 'Roof', start_at: '2026-11-13', end_at: '2026-11-11' }), /end before start/);
});

test('RP 05: team assessment reports lead readiness and all-ready', () => {
  const s = makeStore();
  skill(s, 'PERSON-s11-installer', 'Roof', 'Lead'); skill(s, 'PERSON-s11-second', 'Roof', 'Member');
  const t = rp._rpUpsertTeam(s, cmd('T-1', { name: 'Roof Crew', trade: 'Roof' }));
  rp._rpSetTeamMember(s, cmd('M-1', { team_id: t.team.id, person_id: 'PERSON-s11-installer', role: 'Lead' }));
  rp._rpSetTeamMember(s, cmd('M-2', { team_id: t.team.id, person_id: 'PERSON-s11-second', role: 'Member' }));
  let r = rp._rpAssess(s, { trade: 'Roof', start_at: '2026-11-11', end_at: '2026-11-12', team_id: t.team.id });
  assert.deepEqual(r.team, { team_id: t.team.id, all_ready: true, lead_person_id: 'PERSON-s11-installer', lead_ready: true, members: 2 });
  rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-12' }));
  r = rp._rpAssess(s, { trade: 'Roof', start_at: '2026-11-11', end_at: '2026-11-12', team_id: t.team.id });
  assert.equal(r.team.all_ready, false);
  assert.equal(r.team.lead_ready, false);
  assert.equal(r.candidates[0].person_id, 'PERSON-s11-second', 'ready member ranks first');
});

test('RP 06: S11 planning is leave-aware and skill-aware; no skills configured stays flexible; missing tabs fail open', () => {
  const s = makeStore();
  rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-13' }));
  let r = plan(s);
  assert.equal(r.status, 'NeedsReview');
  assert.equal(r.reason, 'ON_LEAVE');
  assert.equal(r.detail.type, 'Leave');
  assert.equal(s.tables.Allocations.length, 0);
  const s2 = makeStore();
  skill(s2, 'PERSON-s11-installer', 'Electrical', 'Member');
  r = plan(s2);
  assert.equal(r.reason, 'SKILL_MISMATCH');
  assert.deepEqual(r.detail.skills, ['Electrical']);
  skill(s2, 'PERSON-s11-installer', 'Roof', 'Member');
  r = plan(s2, { command_id: 'PLAN-2' });
  assert.equal(r.status, 'Planned');
  const s3 = makeStore();
  assert.equal(plan(s3).status, 'Planned', 'no skills/leave rows → unconstrained');
  /* Tabs absent in a DEV sheet: S11 treats them as empty rather than failing. */
  const s4 = makeStore({ missing: ['PersonSkills', 'PersonAvailability', 'Teams', 'TeamMembers'] });
  assert.equal(plan(s4).status, 'Planned');
  const st = rp._rpStatus(s4);
  assert.equal(st.tables.PersonSkills.present, false);
  assert.equal(rp._rpAssess(s4, { trade: 'Roof', start_at: '2026-11-11', end_at: '2026-11-11' }).candidates.length >= 1, true);
  /* Change installer honours leave for the replacement. */
  const s5 = makeStore(); plan(s5);
  rp._rpSetAvailability(s5, cmd('LV-2', { person_id: 'PERSON-s11-second', type: 'Leave', from_date: '2026-11-11', to_date: '2026-11-13' }));
  const ch = p.changeInstaller({ command_id: 'REPLACE-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', old_allocation_id: 'ALLOC-S11-PLAN-1', person_id: 'PERSON-s11-second', mode: 'Replace', expected_version: 2, actor: 'PERSON-tanya', reason: 'Installer unavailable', at: fx.NOW }, s5);
  assert.equal(ch.status, 'NeedsReview');
  assert.equal(ch.reason, 'ON_LEAVE');
});

test('RP 07: change-installer options rank candidates for the package dates and suggest ready teams', () => {
  const s = makeStore(); plan(s);
  skill(s, 'PERSON-s11-installer', 'Roof', 'Lead'); skill(s, 'PERSON-s11-second', 'Roof', 'Member'); skill(s, 'PERSON-s11-sparky', 'Electrical', 'Member');
  const t = rp._rpUpsertTeam(s, cmd('T-1', { name: 'Roof Crew', trade: 'Roof' }));
  rp._rpSetTeamMember(s, cmd('M-1', { team_id: t.team.id, person_id: 'PERSON-s11-installer', role: 'Lead' }));
  rp._rpSetTeamMember(s, cmd('M-2', { team_id: t.team.id, person_id: 'PERSON-s11-second', role: 'Member' }));
  const mixed = rp._rpUpsertTeam(s, cmd('T-2', { name: 'Mixed Crew', trade: 'Mixed' }));
  rp._rpSetTeamMember(s, cmd('M-3', { team_id: mixed.team.id, person_id: 'PERSON-s11-sparky', role: 'Lead' }));
  const o = rp._rpChangeInstallerOptions(s, { work_package_id: 'WP-s11-roof', old_allocation_id: 'ALLOC-S11-PLAN-1' });
  assert.equal(o.trade, 'Roof');
  assert.equal(o.start_at, '2026-11-11');
  assert.deepEqual(o.current_allocations.map(a => a.person_id), ['PERSON-s11-installer']);
  const cur = o.candidates.find(c => c.person_id === 'PERSON-s11-installer');
  assert.equal(cur.currently_allocated, true);
  assert.equal(cur.ready, true, 'excluding its own allocation the current installer is free');
  assert.equal(o.candidates[0].person_id, 'PERSON-s11-installer', 'Lead skill ranks first');
  assert.equal(o.candidates[1].person_id, 'PERSON-s11-second');
  assert.equal(o.candidates.find(c => c.person_id === 'PERSON-s11-sparky').reasons[0], 'SKILL_MISMATCH');
  assert.deepEqual(o.teams.map(tm => [tm.name, tm.all_ready, tm.lead_ready]), [['Roof Crew', true, true], ['Mixed Crew', false, false]]);
  /* Without excluding the current allocation it shows as a capacity conflict for the same person. */
  const o2 = rp._rpChangeInstallerOptions(s, { work_package_id: 'WP-s11-roof' });
  assert.deepEqual(o2.candidates.find(c => c.person_id === 'PERSON-s11-installer').reasons, ['CAPACITY_CONFLICT']);
  assert.throws(() => rp._rpChangeInstallerOptions(s, { work_package_id: 'nope' }), /work package not found/);
});

test('RP 08: Move Job preview shows per-person readiness at new dates, preserved packages, scaffold and material impacts', () => {
  const s = makeStore(); plan(s);
  s.insert('WorkPackages', { ...fx.workPackage(), id: 'WP-s11-elec', trade: 'Electrical', planned_start: '2026-11-18', planned_end: '2026-11-18', status: 'Scheduled' });
  rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-17', to_date: '2026-11-17' }));
  s.insert('Materials', { id: 'MAT-1', job_id: 'J-s11-plan', work_package_id: 'WP-s11-roof', product_id: 'PROD-P460', description: null, required_quantity: 10, unit: 'Each', source: 'ToOrder', need_by_date: '2026-11-05', merchant_id: 'COMP-greentech', order_line_id: null, already_ordered_reference: null, notes: null, revision: 1, cancelled_quantity: 0, created_at: T0, created_by: 't', updated_at: T0, updated_by: 't', version: 1, source_system: 't', commit_id: 't' });
  s.insert('ScaffoldBookings', { id: 'SB-J-s11-plan', job_id: 'J-s11-plan', company_id: 'COMP-scaffold-dev', erect_planned_at: '2026-11-10', erect_confirmed_at: null, erect_actual_at: null, strip_forecast_at: null, strip_authorised_at: null, strip_authorised_by: null, strip_planned_at: null, strip_confirmed_at: null, strip_actual_at: null, status: 'Requested', revision: 1, confirmed_revision: null, access_notes: null, scope_file_id: null, quoted_cost_pence: null, actual_cost_pence: null, invoice_reference: null, related_issue_ids: null, created_at: T0, created_by: 't', updated_at: T0, updated_by: 't', version: 1, source_system: 't', commit_id: 't' });
  const pv = rp._rpMoveJobPreview(s, { job_id: 'J-s11-plan', activities: ['Roof'], planned_start: '2026-11-16', planned_end: '2026-11-18' });
  assert.equal(pv.work_packages.length, 1);
  assert.equal(pv.work_packages[0].trade, 'Roof');
  assert.deepEqual(pv.work_packages[0].current, { planned_start: '2026-11-11', planned_end: '2026-11-13' });
  assert.equal(pv.work_packages[0].people[0].ready, false);
  assert.deepEqual(pv.work_packages[0].people[0].reasons, ['ON_LEAVE']);
  assert.equal(pv.conflicts, 1);
  assert.equal(pv.ok_to_move, false);
  assert.equal(pv.calendar_links, 1);
  assert.deepEqual(pv.preserved.map(x => x.trade), ['Electrical']);
  assert.equal(pv.materials.length, 1);
  assert.equal(pv.materials[0].flag, null, 'need-by 5 Nov still before 16 Nov start');
  assert.equal(pv.scaffold[0].moving, false);
  assert.equal(pv.warnings.length, 0);
  /* Moving earlier than the scaffold erect and the material need-by produces warnings. */
  const pv2 = rp._rpMoveJobPreview(s, { job_id: 'J-s11-plan', activities: ['Roof'], planned_start: '2026-11-02', planned_end: '2026-11-03' });
  assert.equal(pv2.ok_to_move, true);
  assert.ok(pv2.warnings.some(w => /NEED_BY_AFTER_NEW_START/.test(w)));
  assert.ok(pv2.warnings.some(w => /Scaffold erect 2026-11-10 is after the proposed roof start/.test(w)));
  const pv3 = rp._rpMoveJobPreview(s, { job_id: 'J-s11-plan', activities: ['Scaffold'], scaffold_erect: '2026-11-12' });
  assert.equal(pv3.scaffold[0].moving, true);
  assert.equal(pv3.scaffold[0].proposed.erect_planned_at, '2026-11-12');
  assert.equal(pv3.scaffold[0].acknowledgement_required_after_move, true);
  assert.throws(() => rp._rpMoveJobPreview(s, { job_id: 'J-s11-plan', activities: [] }), /select at least one activity/);
  assert.throws(() => rp._rpMoveJobPreview(s, { job_id: 'J-s11-plan', activities: ['Roof'] }), /planned_start\/planned_end required/);
  /* Read-only. */
  const before = copy(s.tables);
  rp._rpMoveJobPreview(s, { job_id: 'J-s11-plan', activities: ['Roof'], planned_start: '2026-11-16', planned_end: '2026-11-18' });
  assert.deepEqual(s.tables, before);
});

test('RP 09: team planner groups allocations and leave by team and lists unassigned installers', () => {
  const s = makeStore(); plan(s);
  const t = rp._rpUpsertTeam(s, cmd('T-1', { name: 'Roof Crew', trade: 'Roof' }));
  rp._rpSetTeamMember(s, cmd('M-1', { team_id: t.team.id, person_id: 'PERSON-s11-installer', role: 'Lead' }));
  rp._rpSetAvailability(s, cmd('LV-1', { person_id: 'PERSON-s11-installer', type: 'Leave', from_date: '2026-11-20', to_date: '2026-11-21' }));
  const tp = rp._rpTeamPlanner(s, '2026-11-09', 3);
  assert.equal(tp.to, '2026-11-29');
  assert.equal(tp.teams.length, 1);
  assert.equal(tp.teams[0].lead, 'PERSON-s11-installer');
  assert.deepEqual(tp.teams[0].members[0].allocations.map(a => [a.trade, a.start_at, a.end_at]), [['Roof', '2026-11-11', '2026-11-13']]);
  assert.deepEqual(tp.teams[0].members[0].leave, [{ type: 'Leave', from_date: '2026-11-20', to_date: '2026-11-21' }]);
  assert.ok(tp.unassigned_installers.map(u => u.person_id).includes('PERSON-s11-sparky'));
  assert.ok(!tp.unassigned_installers.map(u => u.person_id).includes('PERSON-s11-installer'));
  const st = rp._rpStatus(s);
  assert.equal(st.teams, 1);
  assert.equal(st.tables.TeamMembers.active, 1);
});

test('RP 10: schema — four resource tables with audit columns, foreign keys, seed order; embedded schema regenerated', () => {
  for (const n of rp.RP_TABLES) {
    const t = schema.tables.find(x => x.name === n); assert.ok(t, n);
    const cols = t.columns.map(c => c.name);
    for (const c of ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'commit_id', 'active']) assert.ok(cols.includes(c), n + '.' + c);
    assert.ok(schema.seed_order.includes(n));
  }
  assert.ok(schema.foreign_keys.some(f => f.from_table === 'TeamMembers' && f.to_table === 'Teams'));
  assert.ok(schema.foreign_keys.some(f => f.from_table === 'PersonSkills' && f.to_table === 'People'));
  assert.equal(schema.tables.length, 64);
  assert.match(fs.readFileSync('apps-script/S02SchemaData.js', 'utf8'), /"name":"TeamMembers"/);
  assert.match(schema.tables.find(x => x.name === 'TeamMembers').columns.find(c => c.name === 'role').notes, /Lead\/Member\/Apprentice/);
});

test('RP 11: bundle — namespaced, parses with all bundles, no external APIs; S11 bundles carry the optional reads', () => {
  const bundle = fs.readFileSync('apps-script/resource/ResourcePlanning.js', 'utf8');
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('resource/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  new vm.Script(prior + '\n' + bundle);
  for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:RP_|_rp|runRp)/);
  assert.doesNotMatch(bundle, /CalendarApp|UrlFetchApp|fetch\(|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet|https:\/\/|module\.exports|use strict/);
  for (const fn of ['runRpProvisionCheck', 'runRpProvisionMissingTabs', 'runRpStatus', 'runRpTeams', 'runRpAssess', 'runRpChangeInstallerOptions', 'runRpMoveJobPreview', 'runRpTeamPlanner', 'runRpHappyPathTest']) assert.match(bundle, new RegExp('function ' + fn + '\\('));
  for (const f of ['apps-script/s11/S11Planner.js', 'standalone-bridge/AppSheetBridge.js']) assert.match(fs.readFileSync(f, 'utf8'), /function _s11LeaveConflict/, f);
});

test('RP 12: zero-arg cloud simulation — provision check, additive tab creation, name-mapped store with extra columns, smoke', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/resource/ResourcePlanning.js', 'utf8'), ctx);
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const [n, h] of Object.entries(ctx.RP_HEADERS)) if (!['PersonSkills', 'PersonAvailability', 'Teams'].includes(n)) grids[n] = [Array.from(h)];
  /* TeamMembers exists already (as the browser agent may have created it) with an extra column and a different order. */
  grids.TeamMembers = [['id', 'team_id', 'person_id', 'role', 'notes_extra', 'active', 'from_date', 'to_date', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version', 'commit_id']];
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  for (const r of seed.Settings) grids.Settings.push(rowOf('Settings', { ...r, created_at: T0, commit_id: 'seed' }));
  for (const r of seed.People) grids.People.push(rowOf('People', { ...r, ...meta, source_system: 'seed', email: r.id === 'PERSON-ben' ? 'ben@dev.example.invalid' : r.email }));
  for (const r of seed.PersonRoles) grids.PersonRoles.push(rowOf('PersonRoles', { ...r, ...meta, source_system: 'seed' }));
  const mkSheet = n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000, setFrozenRows() { },
    getRange(row, col, height = 1, width = 1) {
      const self = {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); },
        setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); return self; },
        setFontWeight() { return self; }, setNumberFormat() { return self; }
      };
      return self;
    }
  });
  const ss = { getId: () => rp.RP_DEV_SHEET_ID, getSheets: () => Object.keys(grids).map(mkSheet), insertSheet(name) { grids[name] = [[]]; return mkSheet(name); } };
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ss, flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  let busy = false;
  ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'ben@dev.example.invalid' }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  const check = ctx.runRpProvisionCheck();
  assert.equal(check.pass, true);
  assert.equal(check.detail.tables.PersonSkills.present, false);
  assert.equal(check.detail.tables.TeamMembers.present, true);
  assert.deepEqual(JSON.parse(JSON.stringify(check.detail.tables.TeamMembers.extra_columns)), ['notes_extra']);
  assert.deepEqual(JSON.parse(JSON.stringify(check.detail.tables.TeamMembers.missing_columns)), []);
  const status0 = ctx.runRpStatus();
  assert.equal(status0.pass, true);
  assert.equal(status0.detail.tables.Teams.present, false, 'status reads tolerate missing tabs');
  assert.equal(ctx.runRpHappyPathTest().pass, false, 'smoke refuses until tabs exist');
  const prov = ctx.runRpProvisionMissingTabs();
  assert.equal(prov.pass, true, JSON.stringify(prov));
  assert.deepEqual(JSON.parse(JSON.stringify(prov.detail.created)), ['PersonSkills', 'PersonAvailability', 'Teams']);
  assert.deepEqual(JSON.parse(JSON.stringify(prov.detail.columns_added)), []);
  assert.ok(Object.values(prov.detail.after).every(t => t.present && t.missing_columns.length === 0));
  assert.equal(ctx.runRpProvisionMissingTabs().detail.created.length, 0, 'idempotent');
  const smoke = ctx.runRpHappyPathTest();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.equal(smoke.detail.replay, true);
  assert.equal(smoke.detail.external_calls, 0);
  /* Name-mapped write landed in the reordered TeamMembers tab. */
  const roleIdx = grids.TeamMembers[0].indexOf('role'), activeIdx = grids.TeamMembers[0].indexOf('active');
  assert.ok(grids.TeamMembers.slice(1).some(r => r[roleIdx] === 'Lead'));
  assert.ok(grids.TeamMembers.slice(1).every(r => r[activeIdx] === false), 'smoke leaves memberships inactive');
  assert.equal(ctx.runRpTeams().pass, true);
  assert.equal(ctx.runRpTeamPlanner('2026-11-09', 3).pass, true);
});
