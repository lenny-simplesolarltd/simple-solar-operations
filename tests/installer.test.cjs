/* Installer mobile workflow tests — assigned work only, start/progress, completion outcomes, evidence, problems/variations, commissioning drafts. Local only. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const iw = require('../installer/workflow.js');
const copy = x => structuredClone(x);
const T0 = '2026-09-14T09:00:00.000Z'; /* Monday */
const ROOFER = 'PERSON-installer-a', SPARKY = 'PERSON-installer-b';

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => iw.IW_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { assert.ok(tables[n], n); assert.ok(!this.get(n, r.id), 'duplicate ' + n + '/' + r.id); const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, patch) { const r = tables[n].find(r => r.id === id); assert.ok(r, n + '/' + id); const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(patch)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); Object.assign(r, copy(patch)); },
    withLock(fn) { return fn(); }
  };
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  s.update('ReleaseModes', 'RM-FN06', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  for (const r of seed.Settings) s.insert('Settings', { ...r, created_at: T0, commit_id: 'seed' });
  for (const r of seed.TaskTemplates) s.insert('TaskTemplates', { ...r, ...meta });
  for (const r of seed.People) s.insert('People', { ...r, ...meta, source_system: 'seed', source_record_id: null });
  for (const r of seed.PersonRoles) s.insert('PersonRoles', { ...r, ...meta, source_system: 'seed' });
  s.insert('PersonRoles', { id: 'PROLE-hannah-var', person_id: 'PERSON-hannah', role: 'VariationApprover', active: true, ...meta, source_system: 'seed' });
  s.insert('Customers', { id: 'CUST-1', first_name: 'Ann', last_name: 'Smith', address_line1: '1 Way', address_line2: null, town: 'Plymouth', postcode: 'PL1 1AA', email: null, phone: '01onesix', alternate_contact: null, contact_notes: null, ...meta, source_system: 'seed', source_record_id: null });
  s.insert('Jobs', { id: 'J-1', job_id: 'SS-0001', customer_id: 'CUST-1', display_name: 'Ann Smith PL1', finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: true, scaffold_required: false, workflow_stage: 'InProgress', handover_status: 'NotReady', financial_status: 'Pending', pilot_job: true, release_scope: 'R3', current_contract_gross_pence: 480000, ...meta, source_system: 'S05' });
  s.insert('WorkPackages', { id: 'WP-roof', job_id: 'J-1', trade: 'Roof', required: true, planned_start: '2026-09-14', planned_end: '2026-09-15', actual_start: null, actual_end: null, status: 'Scheduled', need_by_date: null, completion_outcome: null, installer_confirmation_at: null, installer_confirmation_by: null, commissioning_required: true, sequence: 1, revision: 1, parent_package_id: null, ...meta, source_system: 'S11' });
  s.insert('WorkPackages', { id: 'WP-elec', job_id: 'J-1', trade: 'Electrical', required: true, planned_start: '2026-09-16', planned_end: '2026-09-16', actual_start: null, actual_end: null, status: 'Scheduled', need_by_date: null, completion_outcome: null, installer_confirmation_at: null, installer_confirmation_by: null, commissioning_required: true, sequence: 2, revision: 1, parent_package_id: null, ...meta, source_system: 'S11' });
  s.insert('Allocations', { id: 'ALLOC-roof', work_package_id: 'WP-roof', person_id: ROOFER, role: 'Lead', start_at: '2026-09-14', end_at: '2026-09-15', active: true, replaced_allocation_id: null, cancellation_reason: null, calendar_link_id: null, ...meta, source_system: 'S11' });
  s.insert('Allocations', { id: 'ALLOC-elec', work_package_id: 'WP-elec', person_id: SPARKY, role: 'Lead', start_at: '2026-09-16', end_at: '2026-09-16', active: true, replaced_allocation_id: null, cancellation_reason: null, calendar_link_id: null, ...meta, source_system: 'S11' });
  return s;
}
const cmd = (id, extra) => ({ actor: ROOFER, command_id: id, work_package_id: 'WP-roof', at: T0, ...extra });
const wp = (s, id = 'WP-roof') => s.get('WorkPackages', id);

test('IW 01: my work shows only assigned packages with site info and no finance; excludes cancelled', () => {
  const s = makeStore();
  const mine = iw._iwMyWork(s, ROOFER, {});
  assert.equal(mine.count, 1);
  assert.equal(mine.items[0].work_package_id, 'WP-roof');
  assert.equal(mine.items[0].site.postcode, 'PL1 1AA');
  assert.equal(mine.items[0].job.display_name, 'Ann Smith PL1');
  assert.equal(mine.items[0].commissioning, null);
  assert.ok(!JSON.stringify(mine).includes('480000'), 'no contract value leaks');
  assert.ok(!JSON.stringify(mine).includes('gross_pence'));
  assert.equal(iw._iwMyWork(s, SPARKY, {}).items[0].work_package_id, 'WP-elec');
  assert.equal(iw._iwMyWork(s, ROOFER, { from: '2026-09-20' }).count, 0, 'date window filter');
  s.update('Jobs', 'J-1', { cancellation_at: T0 });
  assert.equal(iw._iwMyWork(s, ROOFER, {}).count, 0);
  assert.throws(() => iw._iwMyWork(s, 'PERSON-nobody', {}), /active person id/);
});

test('IW 02: installers act only on their own packages; office may act with a reason; FN-06 gate; idempotent start', () => {
  const s = makeStore();
  assert.throws(() => iw._iwStart(s, cmd('S-0', { actor: SPARKY, expected_version: 1 })), /not allocated to this work package/);
  assert.throws(() => iw._iwStart(s, cmd('S-0b', { actor: 'PERSON-tanya', expected_version: 1 })), /office actor must give a reason/);
  const r = iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  assert.equal(r.status, 'InProgress');
  assert.equal(wp(s).actual_start, '2026-09-14');
  assert.equal(wp(s).version, 2);
  assert.equal(iw._iwStart(s, cmd('S-1', { expected_version: 99 })).replay, true, 'duplicate sync replays');
  assert.throws(() => iw._iwStart(s, cmd('S-2', { expected_version: 1 })), /IW_STALE/);
  const office = iw._iwStart(s, cmd('S-3', { actor: 'PERSON-tanya', reason: 'Installer phoned in', expected_version: 2 }));
  assert.equal(office.status, 'InProgress', 'restart is allowed while in progress');
  assert.equal(wp(s).actual_start, '2026-09-14', 'first actual start preserved');
  s.update('ReleaseModes', 'RM-FN06', { mode: 'Disabled', authorised_job_scope: 'None' });
  assert.throws(() => iw._iwStart(s, cmd('S-4', { expected_version: 3 })), /FN-06 must be Automated\/Pilot\/R3/);
  const s2 = makeStore(); s2.getEnvironment = () => 'PROD';
  assert.throws(() => iw._iwStart(s2, cmd('S-5', { expected_version: 1 })), /exact DEV/);
});

test('IW 03: progress notes and evidence are audited; evidence is deduplicated per file and denied across jobs', () => {
  const s = makeStore(); iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  assert.throws(() => iw._iwProgress(s, cmd('P-0')), /note or evidence required/);
  const r = iw._iwProgress(s, cmd('P-1', { note: 'Rails on', percent: 40, evidence: [{ drive_file_id: 'drive-1', filename: 'rails.jpg', mime_type: 'image/jpeg' }] }));
  assert.equal(r.evidence.length, 1);
  const ev = s.get('Evidence', r.evidence[0].evidence_id);
  assert.equal(ev.category, 'Progress');
  assert.equal(ev.upload_status, 'Uploaded');
  assert.equal(ev.captured_by, ROOFER);
  assert.equal(ev.customer_shareable, false);
  assert.equal(s.tables.AuditEvents.filter(a => a.action === 'InstallerProgress').length, 1);
  const again = iw._iwProgress(s, cmd('P-2', { note: 'same photo again', evidence: [{ drive_file_id: 'drive-1' }] }));
  assert.equal(again.evidence[0].created, false);
  assert.equal(s.tables.Evidence.length, 1);
  assert.throws(() => iw._iwProgress(s, cmd('P-3', { note: 'x', evidence: [{ drive_file_id: 'drive-1', category: 'Selfie' }] })), /evidence category must be/);
  assert.throws(() => iw._iwProgress(s, cmd('P-4', { note: 'x', evidence: [{ filename: 'nofile.jpg' }] })), /drive_file_id required/);
  /* Cross-job denial: the same file id linked under another job is refused. */
  s.tables.Evidence[0].job_id = 'J-other';
  assert.throws(() => iw._iwProgress(s, cmd('P-5', { note: 'x', evidence: [{ drive_file_id: 'drive-1' }] })), /already linked to another job/);
});

test('IW 04: reporting Complete sets ReportedComplete with actual_end, opens a commissioning draft, never confirms completion', () => {
  const s = makeStore(); iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  assert.throws(() => iw._iwReportCompletion(s, cmd('C-0', { outcome: 'Done', actual_end: '2026-09-14', expected_version: 2 })), /outcome must be/);
  assert.throws(() => iw._iwReportCompletion(s, cmd('C-0b', { outcome: 'Complete', actual_end: '2026-09-20', expected_version: 2 })), /cannot be in the future/);
  const r = iw._iwReportCompletion(s, cmd('C-1', { outcome: 'Complete', actual_end: '2026-09-14', expected_version: 2, evidence: [{ drive_file_id: 'drive-done', filename: 'done.jpg' }] }));
  assert.equal(r.status, 'ReportedComplete');
  const w = wp(s);
  assert.equal(w.completion_outcome, 'Complete');
  assert.equal(w.actual_end, '2026-09-14');
  assert.equal(w.installer_confirmation_at, null, 'office confirmation stays with S10');
  assert.equal(r.commissioning_submission.id, 'CS-WP-roof');
  assert.equal(r.commissioning_submission.status, 'Draft');
  assert.equal(s.get('CommissioningSubmissions', 'CS-WP-roof').template_version, 'NOT_CONFIGURED');
  assert.equal(s.get('CommissioningSubmissions', 'CS-WP-roof').installer_id, ROOFER);
  assert.match(r.next, /INS01/);
  assert.equal(s.get('Evidence', r.evidence[0].evidence_id).category, 'Completion');
  assert.equal(iw._iwReportCompletion(s, cmd('C-1', { outcome: 'Complete', actual_end: '2026-09-14', expected_version: 9 })).replay, true);
  assert.throws(() => iw._iwReportCompletion(s, cmd('C-2', { outcome: 'Complete', actual_end: '2026-09-14', expected_version: 3 })), /cannot report completion from ReportedComplete/);
  /* No commissioning required → no submission. */
  const s2 = makeStore(); s2.update('WorkPackages', 'WP-roof', { commissioning_required: false });
  const r2 = iw._iwReportCompletion(s2, cmd('C-3', { outcome: 'Complete', actual_end: '2026-09-14', expected_version: 1 }));
  assert.equal(r2.commissioning_submission, null);
  assert.equal(s2.tables.CommissioningSubmissions.length, 0);
});

test('IW 05: ReturnRequired raises a remedial, a linked return package with the same trade, keeps the installer responsible and tasks Tanya', () => {
  const s = makeStore(); iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  assert.throws(() => iw._iwReportCompletion(s, cmd('R-0', { outcome: 'ReturnRequired', actual_end: '2026-09-14', expected_version: 2 })), /return_reason required/);
  const r = iw._iwReportCompletion(s, cmd('R-1', { outcome: 'ReturnRequired', actual_end: '2026-09-14', return_reason: 'Two panels short; return to fit', expected_version: 2, evidence: [{ drive_file_id: 'drive-ret' }] }));
  assert.equal(r.status, 'ReturnRequired');
  assert.equal(wp(s).completion_outcome, 'ReturnRequired');
  assert.equal(r.return_package.id, 'WP-roof-RET1');
  assert.equal(r.return_package.trade, 'Roof', 'no ReturnVisit trade string; linked via parent_package_id');
  assert.equal(r.return_package.parent_package_id, 'WP-roof');
  assert.equal(r.return_package.status, 'Unscheduled');
  assert.equal(r.return_package.sequence, 3);
  const alloc = s.get('Allocations', r.return_allocation_id);
  assert.equal(alloc.person_id, ROOFER);
  assert.equal(alloc.start_at, null, 'dates come from the planner');
  const issue = s.get('Issues', r.issue.id);
  assert.equal(issue.type, 'Remedial');
  assert.equal(issue.category, 'ReturnRequired');
  assert.equal(issue.responsible_person_id, ROOFER);
  assert.equal(issue.linked_return_package_id, 'WP-roof-RET1');
  assert.equal(issue.office_owner_id, 'PERSON-tanya');
  assert.equal(issue.blocks_completion, true);
  assert.equal(s.tables.IssueEvents[0].event_type, 'Opened');
  assert.equal(s.get('Evidence', r.evidence[0].evidence_id).issue_id, issue.id);
  assert.deepEqual(r.tasks.map(t => t.code), ['REM01', 'BKG02']);
  const bkg = s.get('Tasks', r.tasks[1].task_id);
  assert.equal(bkg.owner_id, 'PERSON-tanya');
  assert.equal(bkg.related_entity_id, 'WP-roof-RET1');
  assert.equal(bkg.due_at, '2026-09-15T08:00:00.000Z', 'next staffed day 09:00 London');
  assert.equal(iw._iwMyWork(s, ROOFER, {}).count, 2, 'return package appears in the installer\'s work');
  /* A second return on the same package gets a distinct id. */
  const s2 = makeStore(); iw._iwStart(s2, cmd('S-1', { expected_version: 1 }));
  iw._iwReportCompletion(s2, cmd('R-1', { outcome: 'ReturnRequired', actual_end: '2026-09-14', return_reason: 'x', expected_version: 2 }));
  const again = iw._iwReportCompletion(s2, cmd('R-2', { outcome: 'ReturnRequired', actual_end: '2026-09-14', return_reason: 'y', expected_version: 3 }));
  assert.equal(again.return_package.id, 'WP-roof-RET2');
});

test('IW 06: problem and variation reports create issues with the right owners, tasks and evidence before the final form', () => {
  const s = makeStore(); iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  assert.throws(() => iw._iwReportProblem(s, cmd('PB-0', { category: 'Weather', description: 'x' })), /category must be/);
  const pb = iw._iwReportProblem(s, cmd('PB-1', { category: 'Safety', description: 'Loose tiles near eaves', evidence: [{ drive_file_id: 'drive-safety' }] }));
  assert.equal(pb.blocks_completion, true, 'Safety blocks by default');
  assert.equal(pb.issue.severity, 'High');
  assert.equal(pb.issue.type, 'Remedial');
  assert.equal(pb.issue.office_owner_id, 'PERSON-tanya');
  assert.equal(pb.task.code, 'ISS02');
  assert.equal(s.get('Evidence', pb.evidence[0].evidence_id).issue_id, pb.issue.id);
  const pb2 = iw._iwReportProblem(s, cmd('PB-2', { category: 'Access', description: 'Gate locked until 9', blocks_completion: false }));
  assert.equal(pb2.blocks_completion, false);
  assert.equal(iw._iwReportProblem(s, cmd('PB-2', { category: 'Access', description: 'Gate locked until 9', blocks_completion: false })).replay, true);
  const v = iw._iwReportVariation(s, cmd('V-1', { description: 'Customer wants bird mesh', estimated_value_pence: 25000 }));
  assert.equal(v.issue.type, 'Variation');
  assert.equal(v.issue.approval_status, 'Pending');
  assert.equal(v.issue.estimated_value_pence, 25000);
  assert.equal(v.issue.blocks_completion, false);
  assert.equal(v.approver_id, 'PERSON-hannah', 'VariationApprover role');
  assert.equal(v.task.code, 'ISS01');
  assert.equal(s.get('Tasks', v.task.task_id).owner_id, 'PERSON-hannah');
  assert.equal(v.issue.due_at, '2026-09-14T16:00:00.000Z', 'same staffed day end');
  assert.throws(() => iw._iwReportVariation(s, cmd('V-2', { description: 'x', estimated_value_pence: -1 })), /non-negative integer/);
  /* Still possible to report completion afterwards; variation does not block. */
  const r = iw._iwReportCompletion(s, cmd('C-1', { outcome: 'Complete', actual_end: '2026-09-14', expected_version: wp(s).version }));
  assert.equal(r.status, 'ReportedComplete');
});

test('IW 07: commissioning draft/resume, submit is immutable, Returned forms get a superseding draft; no questions invented', () => {
  const s = makeStore(); iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  assert.throws(() => iw._iwSaveCommissioningDraft(s, cmd('D-0', { answers: [] })), /answers or evidence required/);
  const d1 = iw._iwSaveCommissioningDraft(s, cmd('D-1', { answers: [{ question_key: 'inverter_serial', value_text: 'INV-123' }, { question_key: 'panels_fitted', value_number: 10 }] }));
  assert.equal(d1.created, true);
  assert.equal(d1.submission_id, 'CS-WP-roof');
  assert.equal(d1.template_version, 'NOT_CONFIGURED');
  assert.equal(d1.answers_saved, 2);
  const d2 = iw._iwSaveCommissioningDraft(s, cmd('D-2', { answers: [{ question_key: 'panels_fitted', value_number: 12 }], evidence: [{ drive_file_id: 'drive-comm-1', filename: 'board.jpg' }] }));
  assert.equal(d2.created, false, 'resume the same draft');
  assert.equal(s.get('CommissioningAnswers', 'CS-WP-roof-A-panels_fitted').value_number, 12);
  assert.equal(s.tables.CommissioningAnswers.length, 2);
  assert.equal(s.get('Evidence', d2.evidence[0].evidence_id).submission_id, 'CS-WP-roof');
  assert.equal(iw._iwSaveCommissioningDraft(s, cmd('D-2', { answers: [{ question_key: 'panels_fitted', value_number: 12 }], evidence: [{ drive_file_id: 'drive-comm-1', filename: 'board.jpg' }] })).replay, true, 'identical resubmission replays');
  assert.throws(() => iw._iwSaveCommissioningDraft(s, cmd('D-2', { answers: [{ question_key: 'panels_fitted', value_number: 99 }] })), /conflicting command identity/, 'same id, different content is rejected');
  assert.equal(s.get('CommissioningAnswers', 'CS-WP-roof-A-panels_fitted').value_number, 12, 'replay never re-applies');
  assert.throws(() => iw._iwSubmitCommissioning(s, cmd('SUB-0', { submission_id: 'CS-WP-roof', expected_version: 1 })), /IW_STALE/);
  const sub = s.get('CommissioningSubmissions', 'CS-WP-roof');
  const sm = iw._iwSubmitCommissioning(s, cmd('SUB-1', { submission_id: sub.id, expected_version: sub.version }));
  assert.equal(sm.status, 'Submitted');
  assert.equal(sm.immutable, true);
  assert.throws(() => iw._iwSaveCommissioningDraft(s, cmd('D-3', { answers: [{ question_key: 'x', value_text: 'late edit' }] })), /awaiting review/);
  /* Office returns it (S12 review); the installer's correction becomes a superseding draft. */
  s.update('CommissioningSubmissions', sub.id, { status: 'Returned', review_notes: 'Inverter photo missing', reviewed_at: T0, reviewed_by: 'PERSON-tanya' });
  assert.equal(iw._iwMyWork(s, ROOFER, {}).items[0].commissioning.review_notes, 'Inverter photo missing');
  const d3 = iw._iwSaveCommissioningDraft(s, cmd('D-4', { evidence: [{ drive_file_id: 'drive-inverter', filename: 'inverter.jpg' }] }));
  assert.equal(d3.created, true);
  assert.equal(d3.submission_id, 'CS-WP-roof-v2');
  assert.equal(s.get('CommissioningSubmissions', 'CS-WP-roof-v2').supersedes_submission_id, 'CS-WP-roof');
  assert.equal(s.get('CommissioningSubmissions', 'CS-WP-roof').status, 'Returned', 'original immutable');
  assert.equal(s.get('CommissioningAnswers', 'CS-WP-roof-A-panels_fitted').value_number, 12, 'original answers untouched');
  s.update('CommissioningSubmissions', 'CS-WP-roof-v2', { status: 'Accepted' });
  assert.throws(() => iw._iwSaveCommissioningDraft(s, cmd('D-5', { answers: [{ question_key: 'x', value_text: 'y' }] })), /already accepted/);
  assert.throws(() => iw._iwSubmitCommissioning(s, cmd('SUB-2', { submission_id: 'CS-WP-roof', expected_version: s.get('CommissioningSubmissions', 'CS-WP-roof').version })), /only a Draft can be submitted/);
  assert.throws(() => iw._iwSubmitCommissioning(s, cmd('SUB-3', { submission_id: 'CS-WP-roof', expected_version: 1, work_package_id: 'WP-elec', actor: SPARKY })), /submission not found for this package/);
});

test('IW 08: empty drafts cannot be submitted; S15-cancelled jobs suppress installer work; bundle namespaced and external-free', () => {
  const s = makeStore(); iw._iwStart(s, cmd('S-1', { expected_version: 1 }));
  iw._iwReportCompletion(s, cmd('C-1', { outcome: 'Complete', actual_end: '2026-09-14', expected_version: 2 }));
  const sub = s.get('CommissioningSubmissions', 'CS-WP-roof');
  assert.throws(() => iw._iwSubmitCommissioning(s, cmd('SUB-1', { submission_id: sub.id, expected_version: sub.version })), /nothing to submit/);
  s.update('Jobs', 'J-1', { workflow_stage: 'CancellationInProgress', cancellation_at: T0 });
  assert.throws(() => iw._iwProgress(s, cmd('P-1', { note: 'x' })), /S15_REVIEW/);
  const bundle = fs.readFileSync('apps-script/installer/InstallerWorkflow.js', 'utf8');
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('installer/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  new vm.Script(prior + '\n' + bundle);
  for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:IW_|_iw|runIw|restoreIw|appSheetInstallerCommand)/);
  assert.doesNotMatch(bundle, /CalendarApp|UrlFetchApp|fetch\(|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet|https:\/\/|module\.exports|use strict/);
  for (const fn of ['runIwMyWork', 'appSheetInstallerCommand', 'runIwHappyPathTest', 'runIwEnableFn06ForSyntheticTest', 'restoreIwSafeState']) assert.match(bundle, new RegExp('function ' + fn + '\\('));
});

test('IW 09: zero-arg cloud simulation — actor is the signed-in installer, AppSheet command entry is idempotent, cross-installer access refused', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
  vm.runInContext(fs.readFileSync('apps-script/installer/InstallerWorkflow.js', 'utf8'), ctx);
  const grids = {}; for (const [n, h] of Object.entries(ctx.IW_HEADERS)) grids[n] = [Array.from(h)];
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(rowOf('ReleaseModes', { ...r, version: 1 }));
  for (const r of seed.Settings) grids.Settings.push(rowOf('Settings', { ...r, created_at: T0, commit_id: 'seed' }));
  for (const r of seed.TaskTemplates) grids.TaskTemplates.push(rowOf('TaskTemplates', { ...r, ...meta }));
  for (const r of seed.People) grids.People.push(rowOf('People', { ...r, ...meta, source_system: 'seed', email: r.id === 'PERSON-installer-a' ? 'roofer@dev.example.invalid' : r.email }));
  for (const r of seed.PersonRoles) grids.PersonRoles.push(rowOf('PersonRoles', { ...r, ...meta, source_system: 'seed' }));
  const today = new Date().toISOString().slice(0, 10);
  grids.Jobs.push(rowOf('Jobs', { id: 'J-c', job_id: 'SS-C', customer_id: 'C', display_name: 'Cloud Job', workflow_stage: 'InProgress', pilot_job: true, release_scope: 'R3', ...meta, source_system: 'S05' }));
  grids.WorkPackages.push(rowOf('WorkPackages', { id: 'WP-c', job_id: 'J-c', trade: 'Roof', required: true, planned_start: today, planned_end: today, status: 'Scheduled', commissioning_required: true, sequence: 1, revision: 1, ...meta, source_system: 'S11' }));
  grids.WorkPackages.push(rowOf('WorkPackages', { id: 'WP-other', job_id: 'J-c', trade: 'Electrical', required: true, planned_start: today, planned_end: today, status: 'Scheduled', commissioning_required: true, sequence: 2, revision: 1, ...meta, source_system: 'S11' }));
  grids.Allocations.push(rowOf('Allocations', { id: 'A-c', work_package_id: 'WP-c', person_id: 'PERSON-installer-a', role: 'Lead', start_at: today, end_at: today, active: true, ...meta, source_system: 'S11' }));
  grids.Allocations.push(rowOf('Allocations', { id: 'A-o', work_package_id: 'WP-other', person_id: 'PERSON-installer-b', role: 'Lead', start_at: today, end_at: today, active: true, ...meta, source_system: 'S11' }));
  const mkSheet = n => ({ getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 5000, getRange(row, col, height = 1, width = 1) { return { getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); }, setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); return this; } }; } });
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => iw.IW_DEV_SHEET_ID, getSheets: () => Object.keys(grids).map(mkSheet) }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  let busy = false; ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'roofer@dev.example.invalid' }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  assert.equal(ctx.restoreIwSafeState().pass, true);
  const mine = ctx.runIwMyWork();
  assert.equal(mine.pass, true, JSON.stringify(mine));
  assert.equal(mine.detail.person_id, 'PERSON-installer-a', 'actor from session');
  assert.equal(mine.detail.count, 1);
  let r = JSON.parse(ctx.appSheetInstallerCommand('IW_START', JSON.stringify({ command_id: 'DEV-1', work_package_id: 'WP-c', expected_version: 1, actor: 'PERSON-ben' })));
  assert.equal(r.ok, false, 'disabled FN-06 refuses');
  assert.match(r.error, /FN-06/);
  assert.equal(ctx.runIwEnableFn06ForSyntheticTest().pass, true);
  r = JSON.parse(ctx.appSheetInstallerCommand('IW_START', JSON.stringify({ command_id: 'DEV-1', work_package_id: 'WP-c', expected_version: 1, actor: 'PERSON-ben' })));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.actor_id, 'PERSON-installer-a', 'client-supplied actor ignored');
  assert.equal(r.status, 'InProgress');
  const again = JSON.parse(ctx.appSheetInstallerCommand('IW_START', JSON.stringify({ command_id: 'DEV-1', work_package_id: 'WP-c', expected_version: 1 })));
  assert.equal(again.replay, true, 'offline duplicate sync');
  const denied = JSON.parse(ctx.appSheetInstallerCommand('IW_START', JSON.stringify({ command_id: 'DEV-2', work_package_id: 'WP-other', expected_version: 1 })));
  assert.equal(denied.ok, false);
  assert.match(denied.error, /not allocated/);
  assert.equal(JSON.parse(ctx.appSheetInstallerCommand('IW_START', JSON.stringify({ work_package_id: 'WP-c' }))).error.startsWith('IW_REVIEW: command_id required'), true);
  assert.equal(JSON.parse(ctx.appSheetInstallerCommand('IW_NOPE', '{}')).error, 'IW_UNKNOWN_COMMAND');
  assert.equal(ctx.restoreIwSafeState().pass, true);
  const smoke = ctx.runIwHappyPathTest();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.deepEqual(JSON.parse(JSON.stringify(smoke.detail.statuses)), ['InProgress', 'ReportedComplete', 'Submitted']);
  assert.equal(smoke.detail.template_version, 'NOT_CONFIGURED');
  const modeIdx = grids.ReleaseModes[0].indexOf('mode');
  assert.equal(grids.ReleaseModes.find(x => x[0] === 'RM-FN06')[modeIdx], 'Disabled');
  assert.equal(grids.Outbox, undefined, 'installer bundle never touches Outbox');
});
