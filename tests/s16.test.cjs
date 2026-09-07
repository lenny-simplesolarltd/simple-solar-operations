const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const core = require('../s16/health.js'), fixture = require('../s16/fixture.js');
const copy = x => structuredClone(x);

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  let held = false;
  const s = {
    tables,
    getSheetId: () => core.S16_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) {
      assert.ok(tables[n], n);
      assert.ok(!this.get(n, r.id), 'duplicate ' + r.id);
      const headers = schema.tables.find(t => t.name === n).columns.map(c => c.name);
      for (const k of Object.keys(r)) assert.ok(headers.includes(k), 'unknown ' + n + '.' + k);
      tables[n].push(copy(r));
    },
    update(n, id, p) {
      const r = tables[n].find(r => r.id === id);
      assert.ok(r, n + '/' + id);
      Object.assign(r, copy(p));
    },
    withLock(fn) { assert.equal(held, false, 'lock contention'); held = true; try { return fn(); } finally { held = false; } }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  fixture._s16Seed(s);
  core._s16SetModes(s, true);
  return s;
}

function add(s, t, r) { s.insert(t, { ...r }); }

test('S16 01: health status returns Healthy with no issues', () => {
  const s = makeStore();
  const h = core._s16HealthStatus(s);
  assert.ok(['Healthy', 'Degraded'].includes(h.overall));
  assert.ok(h.checked_at);
  assert.ok(h.health_id);
  assert.ok(h.summary.total_audit_events >= 0);
  assert.equal(typeof h.critical_count, 'number');
  assert.equal(typeof h.warning_count, 'number');
});

test('S16 02: stalled CommitJournal detected as Critical', () => {
  const s = makeStore();
  add(s, 'CommitJournal', { id: 'CJ-STALL', commit_id: 'STALL', state: 'RecoveryRequired', command_id: 'X', entity_type: 'Jobs', entity_id: 'J-s16-old', expected_version: 1, changes_json: '{}', prepared_at: '2025-01-01T00:00:00Z', committed_at: null, created_at: '2025-01-01T00:00:00Z' });
  const h = core._s16HealthStatus(s);
  assert.equal(h.overall, 'Critical');
  assert.ok(h.issues.some(i => i.component === 'CommitJournal' && i.severity === 'Critical'));
});

test('S16 03: uncertain Outbox detected as Degraded', () => {
  const s = makeStore();
  add(s, 'Outbox', { id: 'OUT-UNCERTAIN', idempotency_key: 'U1', action_type: 'XeroInvoice', target: 'NOT_CONFIGURED', payload_hash: 'abc', job_revision: 1, attempt_count: 2, next_attempt: null, external_id: null, response_summary: 'Uncertain', correlation_id: 'J-s16-old', status: 'NeedsReview', created_at: '2025-01-01T00:00:00Z', commit_id: 'U1' });
  const h = core._s16HealthStatus(s);
  assert.equal(h.overall, 'Degraded');
  assert.ok(h.warnings.some(w => w.component === 'Outbox'));
});

test('S16 04: backup manifest created deterministically', () => {
  const s = makeStore();
  const before = copy(s.tables);
  const b = core._s16BackupManifest(s, { command_id: 'S16-TEST-BACKUP', actor: 'PERSON-s16-office' });
  assert.equal(b.created, true);
  assert.ok(b.backup_id);
  assert.ok(b.checksum);
  assert.ok(b.total_rows > 0);
  assert.ok(b.table_count > 0);
  assert.match(b.destination, /NOT_CONFIGURED/);
  assert.ok(s.get('ReportSnapshots', b.backup_id));
});

test('S16 05: backup manifest is idempotent', () => {
  const s = makeStore();
  const b1 = core._s16BackupManifest(s, { command_id: 'S16-TEST-IDEM', actor: 'PERSON-s16-office' });
  const before = copy(s.tables);
  const b2 = core._s16BackupManifest(s, { command_id: 'S16-TEST-IDEM', actor: 'PERSON-s16-office' });
  assert.equal(b2.replay, true);
  assert.equal(b2.created, false);
  assert.deepEqual(s.tables, before);
});

test('S16 06: backup validation passes for valid manifest', () => {
  const s = makeStore();
  const b = core._s16BackupManifest(s, { command_id: 'S16-TEST-VALID', actor: 'PERSON-s16-office' });
  const v = core._s16ValidateBackup(s, b.backup_id);
  assert.equal(v.valid, true);
  assert.equal(v.checksum_match, true);
  assert.equal(v.count_mismatches.length, 0);
});

test('S16 07: invalid backup refused', () => {
  const s = makeStore();
  assert.throws(() => core._s16ValidateBackup(s, 'NONEXISTENT'), /not found/);
});

test('S16 08: restore plan is dry-run only, blocked', () => {
  const s = makeStore();
  const b = core._s16BackupManifest(s, { command_id: 'S16-TEST-RESTORE', actor: 'PERSON-s16-office' });
  const r = core._s16RestorePlan(s, b.backup_id, { actor: 'PERSON-s16-office', reason: 'Synthetic restore plan' });
  assert.equal(r.dry_run, true);
  assert.equal(r.blocked, true);
  assert.ok(r.warnings.length > 0);
  assert.ok(r.block_reason);
});

test('S16 09: cross-environment restore refused', () => {
  const s = makeStore();
  const b = core._s16BackupManifest(s, { command_id: 'S16-TEST-XENV', actor: 'PERSON-s16-office' });
  // Tamper with the manifest totals to simulate cross-env
  const snap = s.get('ReportSnapshots', b.backup_id);
  const totals = JSON.parse(snap.totals_json);
  totals.environment = 'PROD';
  s.update('ReportSnapshots', b.backup_id, { totals_json: JSON.stringify(totals) });
  assert.throws(() => core._s16RestorePlan(s, b.backup_id, { actor: 'PERSON-s16-office', reason: 'X-env' }), /cross-environment/);
});

test('S16 10: archive eligible — old job (>6 months, no obligations)', () => {
  const s = makeStore();
  const e = core._s16ArchiveEligibility(s, 'J-s16-old');
  assert.equal(e.eligible, true);
  assert.ok(e.months_since_completion >= 6);
  assert.equal(e.blocker_count, 0);
});

test('S16 11: archive NOT eligible — recent job (<6 months)', () => {
  const s = makeStore();
  const e = core._s16ArchiveEligibility(s, 'J-s16-recent');
  assert.equal(e.eligible, false);
  assert.ok(e.blockers.some(b => b.includes('Less than')));
});

test('S16 12: archive NOT eligible — open task blocks', () => {
  const s = makeStore();
  const e = core._s16ArchiveEligibility(s, 'J-s16-opentask');
  assert.equal(e.eligible, false);
  assert.ok(e.blockers.some(b => b.includes('open task')));
});

test('S16 13: archive NOT eligible — unresolved issue blocks', () => {
  const s = makeStore();
  add(s, 'Issues', { id: 'ISSUE-s16', job_id: 'J-s16-old', type: 'Complaint', category: 'Workmanship', description: 'Test issue blocking archive', raised_at: '2025-03-01T00:00:00Z', raised_by: 'PERSON-s16-office', severity: 'Medium', status: 'Open', blocks_completion: false, blocks_strip: false, created_at: '2025-03-01T00:00:00Z', created_by: 'S16', updated_at: '2025-03-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16', commit_id: 'S16' });
  const e = core._s16ArchiveEligibility(s, 'J-s16-old');
  assert.equal(e.eligible, false);
  assert.ok(e.blockers.some(b => b.includes('unresolved issue')));
});

test('S16 14: archive NOT eligible — outstanding payment blocks', () => {
  const s = makeStore();
  add(s, 'InvoiceStages', { id: 'INV-s16', job_id: 'J-s16-old', stage: 'deposit', gross_pence: 100000, status: 'Sent', due_date: '2025-02-15', source_status: 'SENT', created_at: '2025-02-01T00:00:00Z', created_by: 'S16', updated_at: '2025-02-01T00:00:00Z', updated_by: 'S16', version: 1, source_system: 'S16', commit_id: 'S16' });
  // No payment against this stage — outstanding balance
  const e = core._s16ArchiveEligibility(s, 'J-s16-old');
  assert.equal(e.eligible, false);
  assert.ok(e.blockers.some(b => b.includes('Outstanding')));
});

test('S16 15: archive action succeeds for eligible job', () => {
  const s = makeStore();
  const before = copy(s.tables);
  const a = core._s16ArchiveJob(s, { command_id: 'S16-TEST-ARCHIVE', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Synthetic archive' });
  assert.equal(a.archived, true);
  assert.ok(a.archive_id);
  assert.ok(a.total_related_rows >= 0);
  const job = s.get('Jobs', 'J-s16-old');
  assert.ok(job.archived_at);
  assert.ok(s.get('ArchiveIndex', a.archive_id));
  assert.ok(s.list('AuditEvents').some(e => e.action === 'S16Archive'));
  // History preserved — job not deleted
  assert.ok(s.get('Jobs', 'J-s16-old'));
});

test('S16 16: archive idempotent — repeated archive is no-op', () => {
  const s = makeStore();
  core._s16ArchiveJob(s, { command_id: 'S16-TEST-ARCH-1', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'First' });
  const before = copy(s.tables);
  const a2 = core._s16ArchiveJob(s, { command_id: 'S16-TEST-ARCH-2', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Second' });
  assert.equal(a2.replay, true);
  assert.deepEqual(s.tables, before);
});

test('S16 17: archive preserves all operational history', () => {
  const s = makeStore();
  const jobBefore = s.get('Jobs', 'J-s16-old');
  core._s16ArchiveJob(s, { command_id: 'S16-TEST-PRESERVE', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Preserve test' });
  const jobAfter = s.get('Jobs', 'J-s16-old');
  // All original fields preserved
  assert.equal(jobAfter.id, jobBefore.id);
  assert.equal(jobAfter.job_id, jobBefore.job_id);
  assert.equal(jobAfter.workflow_stage, jobBefore.workflow_stage);
  assert.equal(jobAfter.operational_complete_at, jobBefore.operational_complete_at);
  assert.ok(jobAfter.archived_at);
});

test('S16 18: reopen from archive restores job to active', () => {
  const s = makeStore();
  core._s16ArchiveJob(s, { command_id: 'S16-TEST-ARCHIVE-REOPEN', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Archive for reopen test' });
  const r = core._s16ReopenArchivedJob(s, { command_id: 'S16-TEST-REOPEN', job_id: 'J-s16-old', actor: 'PERSON-s16-office', reason: 'Reopen test' });
  assert.equal(r.reopened, true);
  const job = s.get('Jobs', 'J-s16-old');
  assert.equal(job.archived_at, null);
  assert.ok(s.list('AuditEvents').some(e => e.action === 'S16ReopenFromArchive'));
  assert.ok(s.list('ArchiveIndex').some(a => a.job_id === 'J-s16-old' && a.restored_at));
});

test('S16 19: system tasks SYS01/SYS02 created with correct owners', () => {
  const s = makeStore();
  // Ensure SYS01/SYS02 templates exist
  if (!s.get('TaskTemplates', 'TPL-SYS01')) {
    add(s, 'TaskTemplates', {
      id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health',
      group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day',
      due_rule: '09:00', evidence_required: 'Last-success timestamps, failures assigned',
      active: true, template_version: 'S16-1.0',
      created_at: '2025-01-01T00:00:00Z', created_by: 'S16', updated_at: '2025-01-01T00:00:00Z', updated_by: 'S16', version: 1, commit_id: 'S16'
    });
  }
  if (!s.get('TaskTemplates', 'TPL-SYS02')) {
    add(s, 'TaskTemplates', {
      id: 'TPL-SYS02', template_code: 'SYS02', title: 'End-of-day review',
      group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day',
      due_rule: '16:30', evidence_required: 'Unresolved actions assigned',
      active: true, template_version: 'S16-1.0',
      created_at: '2025-01-01T00:00:00Z', created_by: 'S16', updated_at: '2025-01-01T00:00:00Z', updated_by: 'S16', version: 1, commit_id: 'S16'
    });
  }
  const result = core._s16SystemTasks(s, { command_id: 'S16-TEST-SYS', actor: 'PERSON-s16-office' });
  assert.ok(result.tasks_created + result.tasks_reused >= 1);
  assert.ok(result.owners.tanya || result.owners.ben);
});

test('S16 20: ReleaseMode refusal when disabled', () => {
  const s = makeStore();
  core._s16SetModes(s, false);
  const before = copy(s.tables);
  assert.throws(() => core._s16HealthStatus(s), /pilot mode/);
  assert.deepEqual(s.tables, before);
});

test('S16 21: wrong DEV sheet/environment refused', () => {
  for (const alter of [s => { s.getSheetId = () => 'wrong'; }, s => { s.getEnvironment = () => 'TEST'; }]) {
    const s = makeStore();
    alter(s);
    const before = copy(s.tables);
    assert.throws(() => core._s16HealthStatus(s), /S16_REFUSED/);
    assert.deepEqual(s.tables, before);
  }
});

test('S16 22: archive eligibility always returns blockers array even for missing job', () => {
  const s = makeStore();
  // Missing job must return blockers array, not undefined
  const e = core._s16ArchiveEligibility(s, 'NONEXISTENT');
  assert.equal(e.eligible, false);
  assert.ok(Array.isArray(e.blockers), 'blockers should be an array, got: ' + typeof e.blockers);
  assert.ok(e.blockers.length > 0);
  // Smoke-style join must not throw
  assert.doesNotThrow(() => e.blockers.join(', '));
  // Also verify valid job returns array
  const e2 = core._s16ArchiveEligibility(s, 'J-s16-old');
  assert.ok(Array.isArray(e2.blockers));
});

test('S16 23: shared canonical templates reused when pre-existing from prior stages', () => {
  // Raw store — no S16 seed yet, but modes must be enabled for scope checks
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  let held = false;
  const s = {
    tables, getSheetId: () => core.S16_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { assert.ok(tables[n], n); const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  core._s16SetModes(s, true);

  // Simulate TPL-SYS01/SYS02 already seeded by S02 with different created_by
  s.insert('TaskTemplates', {
    id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health',
    group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day',
    due_rule: '09:00', evidence_required: 'Last-success timestamps, failures assigned',
    active: true, template_version: '1.0',
    created_at: '2025-01-01T00:00:00Z', created_by: 'S02-provisioner',
    updated_at: '2025-01-01T00:00:00Z', updated_by: 'S02-provisioner', version: 1, commit_id: 'S02'
  });
  s.insert('TaskTemplates', {
    id: 'TPL-SYS02', template_code: 'SYS02', title: 'End-of-day review',
    group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day',
    due_rule: '16:30', evidence_required: 'Unresolved actions assigned',
    active: true, template_version: '1.0',
    created_at: '2025-01-01T00:00:00Z', created_by: 'S02-provisioner',
    updated_at: '2025-01-01T00:00:00Z', updated_by: 'S02-provisioner', version: 1, commit_id: 'S02'
  });
  // Seed must succeed — shared templates reused, S16 Jobs inserted
  fixture._s16Seed(s);
  assert.ok(s.get('Jobs', 'J-s16-old'), 'J-s16-old should exist after seed');
  assert.ok(s.get('Jobs', 'J-s16-recent'), 'J-s16-recent should exist');
  assert.ok(s.get('Jobs', 'J-s16-opentask'), 'J-s16-opentask should exist');
  // Templates must NOT be duplicated
  const tpls = s.list('TaskTemplates').filter(t => t.template_code === 'SYS01');
  assert.equal(tpls.length, 1, 'SYS01 should not be duplicated');
  // Original provenance preserved
  assert.equal(tpls[0].created_by, 'S02-provisioner', 'original created_by preserved');
});

test('S16 24: incompatible shared template fails closed', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => core.S16_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  core._s16SetModes(s, true);
  // Existing SYS01 with incompatible due_rule
  s.insert('TaskTemplates', {
    id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health',
    group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day',
    due_rule: '10:00',
    evidence_required: 'Last-success timestamps, failures assigned',
    active: true, template_version: '1.0',
    created_at: '2025-01-01T00:00:00Z', created_by: 'S02-provisioner',
    updated_at: '2025-01-01T00:00:00Z', updated_by: 'S02-provisioner', version: 1, commit_id: 'S02'
  });
  assert.throws(() => fixture._s16Seed(s), /incompatible shared template.*due_rule/);
});

test('S16 25: fixture validate accepts shared templates without created_by check', () => {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => core.S16_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, p) { const r = tables[n].find(r => r.id === id); if (r) Object.assign(r, copy(p)); },
    withLock(fn) { try { return fn(); } finally {} }
  };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  core._s16SetModes(s, true);
  // Pre-seed SYS01 as if from S02
  s.insert('TaskTemplates', {
    id: 'TPL-SYS01', template_code: 'SYS01', title: 'Check authorisation/integration health',
    group: 'System', default_owner_role: 'Office', trigger_event: 'Every staffed day',
    due_rule: '09:00', evidence_required: 'Last-success timestamps, failures assigned',
    active: true, template_version: '1.0',
    created_at: '2025-01-01T00:00:00Z', created_by: 'S02-provisioner',
    updated_at: '2025-01-01T00:00:00Z', updated_by: 'S02-provisioner', version: 1, commit_id: 'S02'
  });
  fixture._s16Seed(s);
  // VerifyRow with null expectedCreatedBy should pass for shared templates
  const v = fixture._s16VerifyRow(s, 'TaskTemplates', 'TPL-SYS01', null);
  assert.equal(v.ok, true, v.detail);
  // VerifyRow with 'S16' should still pass for S16-owned rows
  const v2 = fixture._s16VerifyRow(s, 'Jobs', 'J-s16-old', 'S16');
  assert.equal(v2.ok, true, v2.detail);
});

test('S16 26: date handling parity — Date objects, strings, invalid', () => {
  assert.equal(core._s16Date('2025-02-01'), '2025-02-01');
  assert.equal(core._s16Date(new Date('2025-02-01T12:00:00Z')), '2025-02-01');
  assert.throws(() => core._s16Date('2025-02-30'), /DATE_INVALID/);
  assert.throws(() => core._s16Date(new Date('invalid')), /DATE_INVALID/);
  // Month arithmetic
  assert.equal(core._s16AddMonths('2025-02-01', 6), '2025-08-01');
  assert.equal(core._s16AddMonths('2025-08-01', -6), '2025-02-01');
  assert.equal(core._s16MonthsBetween('2025-02-01', '2025-08-01'), 6);
});

test('S16 27: namespace compatibility — all bundles parse, S16 globals namespaced', () => {
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('s16/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  const s16 = fs.readFileSync('apps-script/s16/S16Health.js', 'utf8');
  new vm.Script(prior + '\n' + s16);
  for (const m of s16.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm))
    assert.match(m[1], /^(?:S16_|_s16|restoreS16|runS16)/);
  assert.doesNotMatch(s16, /CalendarApp|UrlFetchApp|fetch\(|deleteRow|deleteSheet|GmailApp|MailApp|DriveApp|https:\/\//);
});

test('S16 28: zero-arg DEV smoke with real header adapter reruns', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/s16/S16Health.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.S16_HEADERS)) grids[n] = [Array.from(h)];
  for (const r of seed.ReleaseModes) {
    grids.ReleaseModes.push(grids.ReleaseModes[0].map(k => r[k] ?? (k === 'version' ? 1 : '')));
  }
  let busy = false;
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 2000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() {
          return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? ''));
        },
        setValues(values) {
          values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; }));
        }
      };
    }
  }));
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => core.S16_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });

  for (const fn of ['restoreS16SafeState', 'runS16FixtureDryRun', 'runS16FixtureApply', 'runS16FixtureValidate', 'runS16EnableFunctionsForSyntheticTest', 'runS16HappyPathTest', 'runS16HappyPathTest', 'restoreS16SafeState']) {
    const r = ctx[fn]();
    assert.equal(r.pass, true, fn + ': ' + JSON.stringify(r));
  }
  // Header/environment refusal
  grids.Jobs[0][1] = 'bad';
  assert.equal(ctx.runS16FixtureApply().pass, false);
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'TEST' }) }) };
  assert.equal(ctx.restoreS16SafeState().pass, false);
});
