/* Backup service tests — real data export to a (fake) Drive, verification, compare, restore rehearsal into a new spreadsheet, refusals. Local only. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const bk = require('../backup/service.js');
const copy = x => structuredClone(x);
const T0 = '2026-09-14T09:00:00.000Z';
const CFG = { environment: 'DEV', backupFolderId: 'FOLDER-DEV-BACKUPS' };
const CFG_REHEARSAL = { ...CFG, restoreMode: 'REHEARSAL' };

function makeStore(opts = {}) {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables,
    getSheetId: () => bk.BK_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => { if (opts.missing && opts.missing.includes(n)) throw new Error('BK_SCHEMA: missing/duplicate tab ' + n); return copy(tables[n] || []); },
    get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { assert.ok(tables[n], n); assert.ok(!this.get(n, r.id), 'duplicate ' + n + '/' + r.id); const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, patch) { const r = tables[n].find(r => r.id === id); assert.ok(r, n + '/' + id); Object.assign(r, copy(patch)); },
    withLock(fn) { return fn(); }
  };
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  for (const r of seed.People) s.insert('People', { ...r, ...meta, source_system: 'seed', source_record_id: null });
  for (const r of seed.Settings) s.insert('Settings', { ...r, created_at: T0, commit_id: 'seed' });
  s.insert('Jobs', { id: 'J-1', job_id: 'SS-0001', customer_id: 'C-1', display_name: 'Backup Job', finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: false, scaffold_required: false, workflow_stage: 'Booked', handover_status: 'NotReady', financial_status: 'Pending', pilot_job: true, release_scope: 'R1', sold_at: new Date('2026-08-01T00:00:00Z'), ...meta, source_system: 'S05' });
  return s;
}
function fakeDrive() {
  const files = Object.create(null), byId = Object.create(null), calls = [];
  return {
    files, byId, calls,
    findFileInFolder(folderId, name) { calls.push(['find', folderId, name]); const f = files[folderId + '::' + name]; return f ? { id: f.id, name } : null; },
    createFileInFolder(folderId, name, content, mime) { calls.push(['create', folderId, name, mime]); if (files[folderId + '::' + name]) throw new Error('duplicate'); const id = 'DRIVE-' + (Object.keys(files).length + 1); files[folderId + '::' + name] = { id, name, content, folderId }; byId[id] = files[folderId + '::' + name]; return { id, name }; },
    readFile(id) { calls.push(['read', id]); const f = byId[id]; if (!f) throw new Error('Drive file not found'); return f.content; }
  };
}
function fakeSheets() {
  const created = [];
  return {
    created,
    createSpreadsheet(name, folderId) { const ss = { id: 'NEW-SS-' + (created.length + 1), name, folderId, tabs: {} }; created.push(ss); return { id: ss.id, url: 'https://example.invalid/' + ss.id, ss }; },
    writeTab(target, name, headers, rows) { target.ss.tabs[name] = { headers, rows }; }
  };
}
const exp = (s, drive, cmd = 'B1', extra = {}) => bk._bkExport(s, { actor: 'PERSON-ben', command_id: cmd, config: CFG, drive, at: T0, ...extra });

test('BK 01: export writes one JSON data file with every table, a DataBackup manifest and an audit row; replay adds nothing', () => {
  const s = makeStore(); const drive = fakeDrive();
  const r = exp(s, drive);
  assert.equal(r.created, true);
  assert.equal(r.configured, true);
  assert.equal(r.backup_id, 'BACKUP-DATA-B1');
  assert.equal(r.file_id, 'DRIVE-1');
  assert.equal(r.table_count, schema.tables.length);
  assert.equal(r.total_rows, seed.ReleaseModes.length + seed.People.length + seed.Settings.length + 1);
  assert.deepEqual(r.missing_tabs, []);
  assert.deepEqual(drive.calls.map(c => c[0]), ['find', 'create']);
  assert.equal(drive.calls[1][1], 'FOLDER-DEV-BACKUPS');
  assert.equal(drive.calls[1][2], bk.BK_FILE_PREFIX + 'BACKUP-DATA-B1.json');
  const payload = JSON.parse(drive.byId['DRIVE-1'].content);
  assert.equal(payload.kind, 'DataBackup');
  assert.equal(payload.environment, 'DEV');
  assert.equal(payload.sheet_id, bk.BK_DEV_SHEET_ID);
  assert.equal(Object.keys(payload.tables).length, schema.tables.length);
  assert.deepEqual(payload.tables.Jobs.headers, schema.tables.find(t => t.name === 'Jobs').columns.map(c => c.name));
  assert.equal(payload.tables.Jobs.rows.length, 1);
  const soldIdx = payload.tables.Jobs.headers.indexOf('sold_at');
  assert.equal(payload.tables.Jobs.rows[0][soldIdx], '2026-08-01T00:00:00.000Z', 'Date values serialised as ISO strings');
  const manifest = s.get('ReportSnapshots', 'BACKUP-DATA-B1');
  assert.equal(manifest.report_type, 'DataBackup');
  assert.equal(manifest.file_id, 'DRIVE-1');
  const totals = JSON.parse(manifest.totals_json);
  assert.equal(totals.validation_status, 'Pending');
  assert.equal(totals.checksum, payload.checksum);
  assert.equal(totals.bytes, drive.byId['DRIVE-1'].content.length);
  assert.equal(s.tables.AuditEvents.filter(a => a.executing_service === 'BackupService').length, 1);
  const again = exp(s, drive);
  assert.equal(again.replay, true);
  assert.equal(Object.keys(drive.files).length, 1);
  assert.equal(s.tables.ReportSnapshots.length, 1);
  /* Only ReportSnapshots and AuditEvents changed. */
  assert.equal(s.tables.Jobs.length, 1);
});

test('BK 02: without a backup folder nothing is written and NOT_CONFIGURED is reported; refusals leave no writes', () => {
  const s = makeStore(); const drive = fakeDrive(); const before = copy(s.tables);
  const r = bk._bkExport(s, { actor: 'PERSON-ben', command_id: 'B1', config: { environment: 'DEV' }, drive, at: T0 });
  assert.equal(r.created, false);
  assert.equal(r.configured, false);
  assert.match(r.reason, /NOT_CONFIGURED/);
  assert.deepEqual(s.tables, before);
  assert.equal(drive.calls.length, 0);
  assert.throws(() => bk._bkExport(s, { actor: 'PERSON-ben', command_id: 'B2', config: { ...CFG, environment: 'PROD' }, drive, at: T0 }), /config.environment must be DEV/);
  assert.throws(() => bk._bkExport(s, { actor: '', command_id: 'B3', config: CFG, drive }), /actor and command_id required/);
  assert.throws(() => bk._bkExport(s, { actor: 'PERSON-ben', command_id: 'B4', drive }), /config required/);
  const s2 = makeStore(); s2.getEnvironment = () => 'PROD';
  assert.throws(() => exp(s2, drive), /exact DEV/);
  assert.deepEqual(s.tables, before);
});

test('BK 03: missing tabs are recorded, not fatal; existing same-name Drive file is adopted rather than duplicated', () => {
  const s = makeStore({ missing: ['Teams', 'TeamMembers'] }); const drive = fakeDrive();
  const r = exp(s, drive);
  assert.deepEqual(r.missing_tabs, ['Teams', 'TeamMembers']);
  const payload = JSON.parse(drive.byId['DRIVE-1'].content);
  assert.equal(payload.tables.Teams.present, false);
  assert.equal(payload.tables.Teams.rows.length, 0);
  const s3 = makeStore(); const d3 = fakeDrive();
  d3.createFileInFolder('FOLDER-DEV-BACKUPS', bk.BK_FILE_PREFIX + 'BACKUP-DATA-B1.json', '{"stale":true}', 'application/json');
  const r3 = exp(s3, d3);
  assert.equal(r3.drive_created, false, 'adopted existing file');
  assert.equal(r3.file_id, 'DRIVE-1');
  assert.equal(Object.keys(d3.files).length, 1);
});

test('BK 04: verify reads the file back, recomputes checksum and counts, marks Verified; tampering marks Failed', () => {
  const s = makeStore(); const drive = fakeDrive(); exp(s, drive);
  const v = bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V1', backup_id: 'BACKUP-DATA-B1', drive, at: T0 });
  assert.equal(v.valid, true);
  assert.deepEqual(v.mismatches, []);
  assert.equal(v.table_count, schema.tables.length);
  let totals = JSON.parse(s.get('ReportSnapshots', 'BACKUP-DATA-B1').totals_json);
  assert.equal(totals.validation_status, 'Verified');
  assert.equal(totals.verified_by, 'PERSON-ben');
  assert.ok(s.get('AuditEvents', 'AUD-BK-V1-DataBackupVerified'));
  /* Tamper with a row in the Drive file. */
  const f = drive.byId['DRIVE-1']; const p = JSON.parse(f.content); p.tables.Jobs.rows[0][3] = 'Tampered'; f.content = JSON.stringify(p);
  const v2 = bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V2', backup_id: 'BACKUP-DATA-B1', drive, at: T0 });
  assert.equal(v2.valid, false);
  assert.ok(v2.mismatches.includes('PAYLOAD_CHECKSUM'));
  assert.ok(v2.mismatches.includes('BYTES'));
  totals = JSON.parse(s.get('ReportSnapshots', 'BACKUP-DATA-B1').totals_json);
  assert.equal(totals.validation_status, 'Failed');
  /* Truncated / wrong file. */
  f.content = '';
  assert.throws(() => bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V3', backup_id: 'BACKUP-DATA-B1', drive }), /empty backup file/);
  f.content = 'not json';
  assert.throws(() => bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V4', backup_id: 'BACKUP-DATA-B1', drive }), /not valid JSON/);
  assert.throws(() => bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V5', backup_id: 'nope', drive }), /manifest not found/);
});

test('BK 05: compare reports per-table differences between the backup and current data', () => {
  const s = makeStore(); const drive = fakeDrive(); exp(s, drive);
  let c = bk._bkCompare(s, { backup_id: 'BACKUP-DATA-B1', drive });
  assert.equal(c.identical, false, 'the manifest and audit rows were added after the snapshot');
  assert.deepEqual(c.differences.map(d => [d.table, d.delta]), [['AuditEvents', 1], ['ReportSnapshots', 1]]);
  s.tables.Jobs.push({ ...s.tables.Jobs[0], id: 'J-2' });
  c = bk._bkCompare(s, { backup_id: 'BACKUP-DATA-B1', drive });
  assert.ok(c.differences.some(d => d.table === 'Jobs' && d.backup_rows === 1 && d.current_rows === 2));
  assert.throws(() => bk._bkCompare(s, { drive }), /backup_id required/);
});

test('BK 06: restore rehearsal writes the verified backup into a NEW spreadsheet only under REHEARSAL mode with the confirm token', () => {
  const s = makeStore(); const drive = fakeDrive(); const sheets = fakeSheets(); exp(s, drive);
  const base = { actor: 'PERSON-ben', command_id: 'R1', backup_id: 'BACKUP-DATA-B1', reason: 'Quarterly rehearsal', confirm: bk.BK_RESTORE_CONFIRM, drive, sheets, at: T0 };
  assert.throws(() => bk._bkRestoreRehearsal(s, { ...base, config: CFG }), /restoreMode must be REHEARSAL/);
  assert.throws(() => bk._bkRestoreRehearsal(s, { ...base, config: CFG_REHEARSAL, confirm: 'yes' }), /confirm must be the literal/);
  assert.throws(() => bk._bkRestoreRehearsal(s, { ...base, config: CFG_REHEARSAL }), /must be Verified/);
  assert.equal(sheets.created.length, 0);
  bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V1', backup_id: 'BACKUP-DATA-B1', drive, at: T0 });
  const before = copy(s.tables);
  const r = bk._bkRestoreRehearsal(s, { ...base, config: CFG_REHEARSAL });
  assert.equal(r.destructive, false);
  assert.equal(r.spreadsheet_id, 'NEW-SS-1');
  assert.equal(r.tables_written, schema.tables.length);
  assert.equal(r.rows_written, seed.ReleaseModes.length + seed.People.length + seed.Settings.length + 1);
  assert.match(sheets.created[0].name, /^SSO-RESTORE-REHEARSAL-BACKUP-DATA-B1-/);
  assert.equal(sheets.created[0].folderId, 'FOLDER-DEV-BACKUPS');
  assert.equal(sheets.created[0].tabs.Jobs.rows.length, 1);
  assert.deepEqual(sheets.created[0].tabs.Jobs.headers, schema.tables.find(t => t.name === 'Jobs').columns.map(c => c.name));
  /* The DEV workbook's operational tables are untouched; only a RestoreRehearsal manifest and an audit row were added. */
  for (const n of Object.keys(before)) if (!['ReportSnapshots', 'AuditEvents'].includes(n)) assert.deepEqual(s.tables[n], before[n], n);
  const reh = s.get('ReportSnapshots', 'RESTORE-REHEARSAL-R1');
  assert.equal(reh.report_type, 'RestoreRehearsal');
  assert.equal(reh.file_id, 'NEW-SS-1');
  assert.equal(JSON.parse(reh.totals_json).target_is_dev_workbook, false);
  assert.equal(bk._bkRestoreRehearsal(s, { ...base, config: CFG_REHEARSAL }).replay, true);
  assert.equal(sheets.created.length, 1);
  /* A target that resolves to the DEV workbook is refused. */
  const bad = fakeSheets(); bad.createSpreadsheet = () => ({ id: bk.BK_DEV_SHEET_ID, ss: {} });
  assert.throws(() => bk._bkRestoreRehearsal(s, { ...base, command_id: 'R2', config: CFG_REHEARSAL, sheets: bad }), /must not be the DEV workbook/);
});

test('BK 07: in-place restore is refused by construction; retention review lists but never deletes; status summarises', () => {
  const s = makeStore(); const drive = fakeDrive();
  assert.throws(() => bk._bkRestoreInPlace(s, { actor: 'PERSON-ben', command_id: 'X', backup_id: 'BACKUP-DATA-B1', confirm: bk.BK_RESTORE_CONFIRM, config: CFG_REHEARSAL }), /destructive in-place restore is not implemented/);
  exp(s, drive, 'OLD', { at: '2026-07-01T09:00:00.000Z' });
  exp(s, drive, 'NEW', { at: '2026-09-10T09:00:00.000Z' });
  const rr = bk._bkRetentionReview(s, { days: 30, at: T0 });
  assert.equal(rr.total, 2);
  assert.deepEqual(rr.older_than_cutoff.map(b => b.backup_id), ['BACKUP-DATA-OLD']);
  assert.equal(Object.keys(drive.files).length, 2, 'nothing deleted');
  let st = bk._bkStatus(s, { config: CFG });
  assert.equal(st.configured, true);
  assert.equal(st.restore_mode, 'DISABLED');
  assert.equal(st.backups, 2);
  assert.equal(st.last_backup.backup_id, 'BACKUP-DATA-NEW');
  assert.equal(st.last_verified, null);
  bk._bkVerify(s, { actor: 'PERSON-ben', command_id: 'V', backup_id: 'BACKUP-DATA-NEW', drive, at: T0 });
  st = bk._bkStatus(s, { config: CFG_REHEARSAL });
  assert.equal(st.last_verified.backup_id, 'BACKUP-DATA-NEW');
  assert.equal(st.restore_mode, 'REHEARSAL');
  assert.equal(bk._bkStatus(s).configured, false);
});

test('BK 08: snapshot hashing is deterministic and sensitive to content', () => {
  const s = makeStore();
  const a = bk._bkSnapshot(s), b = bk._bkSnapshot(s);
  assert.equal(a.checksum, b.checksum);
  s.tables.Jobs[0].display_name = 'Changed';
  assert.notEqual(bk._bkSnapshot(s).checksum, a.checksum);
  assert.equal(a.table_count, schema.tables.length);
});

test('BK 09: bundle — namespaced, parses with all bundles, Drive/Spreadsheet creation confined to the default adapters, no mail/HTTP', () => {
  const bundle = fs.readFileSync('apps-script/backup/BackupService.js', 'utf8');
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('backup/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  new vm.Script(prior + '\n' + bundle);
  for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:BK_|_bk|runBk)/);
  assert.doesNotMatch(bundle, /CalendarApp|UrlFetchApp|fetch\(|GmailApp|MailApp|https:\/\/(?!example)|module\.exports|use strict/);
  const adapters = bundle.slice(bundle.indexOf('function _bkDriveDefault'), bundle.indexOf('function _bkCloudConfig'));
  const outside = bundle.slice(0, bundle.indexOf('function _bkDriveDefault')) + bundle.slice(bundle.indexOf('function _bkCloudConfig'));
  assert.doesNotMatch(outside, /DriveApp|SpreadsheetApp\.create|deleteSheet/, 'Drive and spreadsheet creation only inside default adapters');
  assert.match(adapters, /DriveApp\.getFolderById/);
  assert.match(adapters, /SpreadsheetApp\.create/);
  for (const fn of ['runBkStatus', 'runBkDailyBackup', 'runBkBackupNow', 'runBkVerify', 'runBkCompare', 'runBkRetentionReview', 'runBkRestoreRehearsal', 'runBkHappyPathTest']) assert.match(bundle, new RegExp('function ' + fn + '\\('));
  assert.doesNotMatch(bundle, /function runBkRestoreInPlace/, 'no zero-arg entry point for a destructive restore');
});

test('BK 10: zero-arg cloud simulation — daily backup idempotent per day, verify, compare, rehearsal into a new spreadsheet, DEV workbook tables untouched', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/backup/BackupService.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.BK_HEADERS)) grids[n] = [Array.from(h)];
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(rowOf('ReleaseModes', { ...r, version: 1 }));
  for (const r of seed.People) grids.People.push(rowOf('People', { ...r, ...meta, source_system: 'seed' }));
  grids.Jobs.push(rowOf('Jobs', { id: 'J-1', job_id: 'SS-0001', customer_id: 'C-1', display_name: 'Cloud Job', workflow_stage: 'Booked', pilot_job: true, release_scope: 'R1', sold_at: new Date('2026-08-01T00:00:00Z'), ...meta, source_system: 'S05' }));
  const mkSheet = n => ({ getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 5000, getRange(row, col, height = 1, width = 1) { return { getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); }, setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); return this; }, setFontWeight() { return this; } }; } });
  const devSS = { getId: () => bk.BK_DEV_SHEET_ID, getSheets: () => Object.keys(grids).map(mkSheet) };
  const newSpreadsheets = [];
  function mkNewSS(name) { const tabs = { Sheet1: [[]] }; const ss = { id: 'NEW-' + (newSpreadsheets.length + 1), name, getId() { return this.id; }, getUrl() { return 'https://example.invalid/' + this.id; }, getSheetByName(n) { return tabs[n] ? tabSheet(n) : null; }, insertSheet(n) { tabs[n] = [[]]; return tabSheet(n); }, getSheets() { return Object.keys(tabs).map(tabSheet); }, deleteSheet(sh) { delete tabs[sh.getName()]; }, tabs }; function tabSheet(n) { return { getName: () => n, getRange(row, col, height = 1, width = 1) { return { setValues(values) { values.forEach((r, i) => { tabs[n][row + i - 1] = r.slice(); }); return this; }, setFontWeight() { return this; } }; } }; } newSpreadsheets.push(ss); return ss; }
  const driveFiles = {}; let fileSeq = 0; const folder = { getFilesByName(name) { const hits = Object.values(driveFiles).filter(f => f.name === name); let i = 0; return { hasNext: () => i < hits.length, next: () => hits[i++] }; }, createFile(blob) { const f = { id: 'DRV-' + (++fileSeq), name: blob.name, content: blob.content, getId() { return this.id; }, getName() { return this.name; }, getBlob() { return { getDataAsString: () => this.content }; }, moveTo() { return this; } }; driveFiles[f.id] = f; return f; } };
  let config = { environment: 'DEV', backupFolderId: 'FOLDER-1' };
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => devSS, create: name => mkNewSS(name), flush() { } };
  ctx.DriveApp = { getFolderById(id) { assert.equal(id, 'FOLDER-1'); return folder; }, getFileById(id) { if (driveFiles[id]) return driveFiles[id]; const ss = newSpreadsheets.find(x => x.id === id); if (ss) return { moveTo() { return this; } }; throw new Error('not found'); } };
  ctx.Utilities = { newBlob: (content, mime, name) => ({ content, mime, name }), formatDate: (d) => d.toISOString().slice(0, 10) };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify(config) }) };
  let busy = false; ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'ben@dev.example.invalid' }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  const jobsBefore = JSON.stringify(grids.Jobs), peopleBefore = JSON.stringify(grids.People);
  config = { environment: 'DEV' };
  const nc = ctx.runBkDailyBackup();
  assert.equal(nc.pass, false, 'NOT_CONFIGURED without folder');
  assert.match(JSON.stringify(nc.detail), /NOT_CONFIGURED/);
  assert.equal(Object.keys(driveFiles).length, 0);
  config = { environment: 'DEV', backupFolderId: 'FOLDER-1' };
  const d1 = ctx.runBkDailyBackup(), d2 = ctx.runBkDailyBackup();
  assert.equal(d1.pass, true, JSON.stringify(d1));
  assert.equal(d1.detail.created, true);
  assert.equal(d2.detail.replay, true, 'one backup per day');
  assert.equal(Object.keys(driveFiles).length, 1);
  const payload = JSON.parse(Object.values(driveFiles)[0].content);
  assert.equal(payload.tables.Jobs.rows.length, 1);
  assert.equal(payload.tables.People.rows.length, seed.People.length);
  const v = ctx.runBkVerify(d1.detail.backup_id);
  assert.equal(v.pass, true, JSON.stringify(v));
  assert.equal(v.detail.valid, true);
  assert.equal(ctx.runBkCompare(d1.detail.backup_id).detail.differences.length, 2, 'manifest + audit rows added since');
  const refused = ctx.runBkRestoreRehearsal(d1.detail.backup_id, 'test');
  assert.equal(refused.pass, false);
  assert.match(refused.detail, /restoreMode must be REHEARSAL/);
  config = { environment: 'DEV', backupFolderId: 'FOLDER-1', restoreMode: 'REHEARSAL' };
  const reh = ctx.runBkRestoreRehearsal(d1.detail.backup_id, 'DEV rehearsal');
  assert.equal(reh.pass, true, JSON.stringify(reh));
  assert.equal(reh.detail.destructive, false);
  assert.equal(newSpreadsheets.length, 1);
  assert.equal(newSpreadsheets[0].tabs.Jobs.length, 2, 'header + one job row');
  assert.equal(newSpreadsheets[0].tabs.Sheet1, undefined, 'default tab removed');
  assert.equal(JSON.stringify(grids.Jobs), jobsBefore, 'DEV Jobs untouched');
  assert.equal(JSON.stringify(grids.People), peopleBefore, 'DEV People untouched');
  assert.equal(grids.ReportSnapshots.length, 3, 'header + DataBackup + RestoreRehearsal');
  const smoke = ctx.runBkHappyPathTest();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.equal(smoke.detail.in_place_restore, 'refused');
  assert.equal(ctx.runBkRetentionReview(30).pass, true);
  assert.equal(ctx.runBkStatus().detail.backups, 2);
});
