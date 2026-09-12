/* Real Drive data backups and restore procedure. Authority: 01 §13 backup/restore/health, 04 S16 ("restore into an isolated
 * environment", "destructive restore requires explicit approval"), AGENT_RUNBOOK §I (real Drive backup process, backup manifest,
 * restore procedure, restore path), FN-14 (R1 Automated).
 *
 * - Export: full data snapshot of every schema table (rows + headers) as one JSON file in the configured DEV Drive backups folder,
 *   plus a ReportSnapshots 'DataBackup' manifest (counts, checksum, file id). Idempotent per command_id. NOT_CONFIGURED without folder.
 * - Verify: read the Drive file back, recompute checksum, compare counts → manifest validation_status Verified/Failed.
 * - Restore rehearsal: NON-DESTRUCTIVE. Writes the verified backup into a NEW spreadsheet (isolated copy) and records it. Requires
 *   S01_CONFIG.restoreMode === 'REHEARSAL' and the literal confirm token. Never writes operational tables of the DEV workbook.
 * - In-place restore: structurally refused (approval + isolated environment + disabled outbound are business gates).
 * DEV sheet only. S16's count-only manifest remains; this module adds the real data path. No mail/Calendar/HTTP. */
'use strict';

var BK_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var BK_SERVICE = 'BackupService';
var BK_SCHEMA_VERSION = 'S02-1.0';
var BK_RESTORE_CONFIRM = 'RESTORE_TO_NEW_SPREADSHEET';
var BK_FILE_PREFIX = 'SSO-DATA-BACKUP-';

/* --- utilities --- */

function _bkText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _bkRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _bkNow(input) { if (input && input.at) { var d = new Date(input.at); if (isNaN(d.getTime())) _bkRefuse('BK_DATE_INVALID'); return d.toISOString(); } return new Date().toISOString(); }
function _bkHash(text) { var h = 0; for (var i = 0; i < text.length; i++) { h = ((h << 5) - h + text.charCodeAt(i)) | 0; } return 'BK-' + (h >>> 0).toString(16).padStart(8, '0') + '-' + text.length.toString(16); }
function _bkNormalise(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return String(v);
}
function _bkHeadersMap() {
  if (typeof BK_HEADERS !== 'undefined') return BK_HEADERS;
  var schema = require('../schema/tables.json'), out = {};
  schema.tables.forEach(function (t) { out[t.name] = t.columns.map(function (c) { return c.name; }); });
  return out;
}
function _bkGuardStore(store) {
  if (!store || !store.getSheetId || store.getSheetId() !== BK_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') _bkRefuse('BK_REFUSED: exact DEV sheet/environment required');
}
function _bkConfig(input) {
  var c = (input && input.config) || null;
  if (!c || typeof c !== 'object') _bkRefuse('BK_REFUSED: config required');
  if (c.environment !== 'DEV') _bkRefuse('BK_REFUSED: config.environment must be DEV');
  return { folderId: _bkText(c.backupFolderId) ? c.backupFolderId.trim() : null, restoreMode: c.restoreMode === 'REHEARSAL' ? 'REHEARSAL' : 'DISABLED' };
}
function _bkAudit(store, action, entityId, after, input, now, reason) {
  store.insert('AuditEvents', { id: 'AUD-BK-' + input.command_id + '-' + action, entity_type: 'ReportSnapshots', entity_id: entityId, action: action, before_json: null, after_json: JSON.stringify(after), initiating_actor: input.actor, executing_service: BK_SERVICE, timestamp: now, correlation_id: input.command_id, reason: reason || input.reason || null, commit_id: 'BK-' + input.command_id, created_at: now });
}
function _bkTotals(row) { try { return JSON.parse(row.totals_json) || {}; } catch (e) { return {}; } }

/* --- snapshot of every schema table --- */

function _bkSnapshot(store) {
  var headers = _bkHeadersMap(), tables = {}, counts = {}, total = 0, missing = [], names = Object.keys(headers);
  names.forEach(function (name) {
    var rows;
    try { rows = store.list(name) || []; } catch (e) { missing.push(name); tables[name] = { present: false, headers: headers[name], rows: [] }; counts[name] = 0; return; }
    var h = headers[name], out = rows.map(function (r) { return h.map(function (k) { return _bkNormalise(r[k]); }); });
    tables[name] = { present: true, headers: h, rows: out };
    counts[name] = out.length; total += out.length;
  });
  var checksum = _bkHash(JSON.stringify(names.map(function (n) { return [n, tables[n].rows]; })));
  return { tables: tables, counts: counts, total_rows: total, checksum: checksum, missing_tabs: missing, table_count: names.length };
}

/* --- 1. EXPORT --- */

function _bkExport(store, input) {
  _bkGuardStore(store);
  input = input || {};
  if (!_bkText(input.actor) || !_bkText(input.command_id)) _bkRefuse('BK_REVIEW: actor and command_id required');
  var config = _bkConfig(input), now = _bkNow(input), backupId = 'BACKUP-DATA-' + input.command_id;
  var existing = store.get('ReportSnapshots', backupId);
  if (existing) { var t = _bkTotals(existing); return { replay: true, created: false, backup_id: backupId, file_id: existing.file_id, checksum: t.checksum, total_rows: t.total_rows, validation_status: t.validation_status }; }
  if (!config.folderId) return { replay: false, created: false, configured: false, backup_id: backupId, reason: 'NOT_CONFIGURED: S01_CONFIG.backupFolderId missing; no data backup written' };
  var drive = input.drive || _bkDriveDefault();
  var snap = _bkSnapshot(store);
  var payload = { backup_id: backupId, kind: 'DataBackup', environment: 'DEV', sheet_id: BK_DEV_SHEET_ID, schema_version: BK_SCHEMA_VERSION, created_at: now, created_by: input.actor, table_count: snap.table_count, total_rows: snap.total_rows, counts: snap.counts, missing_tabs: snap.missing_tabs, checksum: snap.checksum, tables: snap.tables };
  var content = JSON.stringify(payload), fileName = BK_FILE_PREFIX + backupId + '.json';
  var file = drive.findFileInFolder(config.folderId, fileName), created = false;
  if (!file) { file = drive.createFileInFolder(config.folderId, fileName, content, 'application/json'); created = true; }
  if (!file || !_bkText(file.id)) _bkRefuse('BK_DRIVE_FAILED: no file id returned');
  var totals = { kind: 'DataBackup', backup_id: backupId, environment: 'DEV', sheet_id: BK_DEV_SHEET_ID, schema_version: BK_SCHEMA_VERSION, created_at: now, created_by: input.actor, table_count: snap.table_count, total_rows: snap.total_rows, counts: snap.counts, missing_tabs: snap.missing_tabs, checksum: snap.checksum, bytes: content.length, destination: 'DriveFolder:' + config.folderId, file_name: fileName, validation_status: 'Pending', verified_at: null };
  var manifest = { id: backupId, period_start: now.slice(0, 10), period_end: now.slice(0, 10), as_of_at: now, policy_version: 'BK-DEV-1.0', report_type: 'DataBackup', totals_json: JSON.stringify(totals), underlying_job_ids: JSON.stringify([]), file_id: file.id, generated_by: input.actor, created_at: now, commit_id: 'BK-' + input.command_id };
  store.insert('ReportSnapshots', manifest);
  _bkAudit(store, 'DataBackup', backupId, { file_id: file.id, checksum: snap.checksum, total_rows: snap.total_rows, bytes: content.length, drive_created: created }, input, now, 'Full data backup to DEV Drive folder');
  return { replay: false, created: true, configured: true, backup_id: backupId, file_id: file.id, file_name: fileName, drive_created: created, checksum: snap.checksum, table_count: snap.table_count, total_rows: snap.total_rows, bytes: content.length, missing_tabs: snap.missing_tabs, external_calls: created ? 2 : 1 };
}

/* --- 2. VERIFY (read back, recompute, compare) --- */

function _bkReadPayload(store, backupId, drive) {
  var manifest = store.get('ReportSnapshots', backupId);
  if (!manifest || manifest.report_type !== 'DataBackup') _bkRefuse('BK_REVIEW: data backup manifest not found');
  if (!_bkText(manifest.file_id)) _bkRefuse('BK_REVIEW: manifest has no Drive file id');
  var content = drive.readFile(manifest.file_id);
  if (!_bkText(content)) _bkRefuse('BK_DRIVE_FAILED: empty backup file');
  var payload; try { payload = JSON.parse(content); } catch (e) { _bkRefuse('BK_REVIEW: backup file is not valid JSON'); }
  return { manifest: manifest, totals: _bkTotals(manifest), payload: payload, bytes: content.length };
}
function _bkVerify(store, input) {
  _bkGuardStore(store);
  input = input || {};
  if (!_bkText(input.actor) || !_bkText(input.command_id) || !_bkText(input.backup_id)) _bkRefuse('BK_REVIEW: actor, command_id and backup_id required');
  var drive = input.drive || _bkDriveDefault(), now = _bkNow(input);
  var read = _bkReadPayload(store, input.backup_id, drive), p = read.payload, t = read.totals, mismatches = [];
  if (p.kind !== 'DataBackup') mismatches.push('KIND');
  if (p.environment !== 'DEV' || p.sheet_id !== BK_DEV_SHEET_ID) mismatches.push('ENVIRONMENT_OR_SHEET');
  if (p.backup_id !== input.backup_id) mismatches.push('BACKUP_ID');
  var names = Object.keys(p.tables || {});
  var recomputed = _bkHash(JSON.stringify(names.map(function (n) { return [n, (p.tables[n] || {}).rows || []]; })));
  if (recomputed !== p.checksum) mismatches.push('PAYLOAD_CHECKSUM');
  if (p.checksum !== t.checksum) mismatches.push('MANIFEST_CHECKSUM');
  var counted = 0; names.forEach(function (n) { var rows = (p.tables[n].rows || []).length; counted += rows; if ((t.counts || {})[n] !== rows) mismatches.push('COUNT:' + n); });
  if (counted !== t.total_rows) mismatches.push('TOTAL_ROWS');
  if (read.bytes !== t.bytes) mismatches.push('BYTES');
  var valid = mismatches.length === 0;
  t.validation_status = valid ? 'Verified' : 'Failed'; t.verified_at = now; t.verified_by = input.actor; t.verification_mismatches = mismatches;
  store.update('ReportSnapshots', input.backup_id, { totals_json: JSON.stringify(t) });
  _bkAudit(store, valid ? 'DataBackupVerified' : 'DataBackupVerifyFailed', input.backup_id, { mismatches: mismatches, bytes: read.bytes }, input, now, valid ? 'Backup read back and verified' : 'Backup verification failed');
  return { valid: valid, backup_id: input.backup_id, mismatches: mismatches, table_count: names.length, total_rows: counted, bytes: read.bytes, external_calls: 1 };
}

/* --- 3. COMPARE current data with a backup (read-only) --- */

function _bkCompare(store, input) {
  _bkGuardStore(store);
  input = input || {};
  if (!_bkText(input.backup_id)) _bkRefuse('BK_REVIEW: backup_id required');
  var drive = input.drive || _bkDriveDefault(), read = _bkReadPayload(store, input.backup_id, drive), p = read.payload, current = _bkSnapshot(store), diffs = [];
  Object.keys(_bkHeadersMap()).forEach(function (n) { var b = p.tables && p.tables[n] ? p.tables[n].rows.length : 0, c = current.counts[n] || 0; if (b !== c) diffs.push({ table: n, backup_rows: b, current_rows: c, delta: c - b }); });
  return { backup_id: input.backup_id, backup_created_at: p.created_at, backup_total_rows: p.total_rows, current_total_rows: current.total_rows, identical: diffs.length === 0 && p.checksum === current.checksum, differences: diffs };
}

/* --- 4. RESTORE REHEARSAL into a NEW spreadsheet (non-destructive) --- */

function _bkRestoreRehearsal(store, input) {
  _bkGuardStore(store);
  input = input || {};
  if (!_bkText(input.actor) || !_bkText(input.command_id) || !_bkText(input.backup_id) || !_bkText(input.reason)) _bkRefuse('BK_REVIEW: actor, command_id, backup_id and reason required');
  var config = _bkConfig(input);
  if (config.restoreMode !== 'REHEARSAL') _bkRefuse('BK_REFUSED: S01_CONFIG.restoreMode must be REHEARSAL for a restore rehearsal');
  if (input.confirm !== BK_RESTORE_CONFIRM) _bkRefuse('BK_REFUSED: confirm must be the literal ' + BK_RESTORE_CONFIRM);
  var now = _bkNow(input), rehearsalId = 'RESTORE-REHEARSAL-' + input.command_id;
  var existing = store.get('ReportSnapshots', rehearsalId);
  if (existing) { var et = _bkTotals(existing); return { replay: true, rehearsal_id: rehearsalId, spreadsheet_id: existing.file_id, url: et.url || null, tables_written: et.tables_written, rows_written: et.rows_written }; }
  var drive = input.drive || _bkDriveDefault(), sheets = input.sheets || _bkSheetsDefault();
  var read = _bkReadPayload(store, input.backup_id, drive), t = read.totals, p = read.payload;
  if (t.validation_status !== 'Verified') _bkRefuse('BK_REFUSED: backup must be Verified before rehearsal (status ' + (t.validation_status || 'Pending') + ')');
  if (p.environment !== 'DEV' || p.sheet_id !== BK_DEV_SHEET_ID) _bkRefuse('BK_REFUSED: cross-environment or cross-sheet restore blocked');
  var name = 'SSO-RESTORE-REHEARSAL-' + input.backup_id + '-' + now.replace(/[^0-9]/g, '').substring(0, 14);
  var target = sheets.createSpreadsheet(name, config.folderId);
  if (!target || !_bkText(target.id)) _bkRefuse('BK_RESTORE_FAILED: no spreadsheet id returned');
  if (target.id === BK_DEV_SHEET_ID) _bkRefuse('BK_REFUSED: rehearsal target must not be the DEV workbook');
  var written = 0, tables = 0, perTable = {};
  Object.keys(p.tables).forEach(function (n) { var tb = p.tables[n]; sheets.writeTab(target, n, tb.headers, tb.rows); tables++; written += tb.rows.length; perTable[n] = tb.rows.length; });
  var totals = { kind: 'RestoreRehearsal', backup_id: input.backup_id, source_checksum: p.checksum, spreadsheet_name: name, url: target.url || null, tables_written: tables, rows_written: written, per_table: perTable, performed_at: now, performed_by: input.actor, reason: input.reason, destructive: false, target_is_dev_workbook: false };
  store.insert('ReportSnapshots', { id: rehearsalId, period_start: now.slice(0, 10), period_end: now.slice(0, 10), as_of_at: now, policy_version: 'BK-DEV-1.0', report_type: 'RestoreRehearsal', totals_json: JSON.stringify(totals), underlying_job_ids: JSON.stringify([]), file_id: target.id, generated_by: input.actor, created_at: now, commit_id: 'BK-' + input.command_id });
  _bkAudit(store, 'RestoreRehearsal', rehearsalId, { spreadsheet_id: target.id, tables_written: tables, rows_written: written, backup_id: input.backup_id }, input, now);
  return { replay: false, rehearsal_id: rehearsalId, spreadsheet_id: target.id, url: target.url || null, tables_written: tables, rows_written: written, destructive: false, external_calls: 1 + tables };
}

/* --- 5. IN-PLACE RESTORE: refused by construction --- */

function _bkRestoreInPlace(store, input) {
  _bkGuardStore(store);
  _bkRefuse('BK_REFUSED: destructive in-place restore is not implemented. It requires explicit approval, an isolated environment and all outbound actions disabled. Use the restore rehearsal and then a reviewed, approved procedure.');
}

/* --- 6. RETENTION REVIEW (lists only; never deletes) & STATUS --- */

function _bkRetentionReview(store, input) {
  _bkGuardStore(store);
  var days = Number((input && input.days) || 30), now = _bkNow(input), cutoff = new Date(new Date(now).getTime() - days * 86400000).toISOString();
  var backups = store.list('ReportSnapshots').filter(function (r) { return r.report_type === 'DataBackup'; }).map(function (r) { var t = _bkTotals(r); return { backup_id: r.id, created_at: t.created_at || null, file_id: r.file_id, validation_status: t.validation_status || 'Pending', bytes: t.bytes || null }; });
  return { days: days, cutoff: cutoff, total: backups.length, older_than_cutoff: backups.filter(function (b) { return b.created_at && b.created_at < cutoff; }), note: 'Review only. Nothing is deleted by this service.' };
}
function _bkStatus(store, input) {
  _bkGuardStore(store);
  var config = input && input.config ? _bkConfig(input) : { folderId: null, restoreMode: 'DISABLED' };
  var rows = store.list('ReportSnapshots').filter(function (r) { return r.report_type === 'DataBackup'; }).map(function (r) { return { id: r.id, file_id: r.file_id, totals: _bkTotals(r) }; });
  rows.sort(function (a, b) { return String(b.totals.created_at || '').localeCompare(String(a.totals.created_at || '')); });
  var last = rows[0] || null, verified = rows.filter(function (r) { return r.totals.validation_status === 'Verified'; })[0] || null;
  var rehearsals = store.list('ReportSnapshots').filter(function (r) { return r.report_type === 'RestoreRehearsal'; }).length;
  return { configured: !!config.folderId, restore_mode: config.restoreMode, backups: rows.length, last_backup: last ? { backup_id: last.id, created_at: last.totals.created_at, total_rows: last.totals.total_rows, validation_status: last.totals.validation_status, file_id: last.file_id } : null, last_verified: verified ? { backup_id: verified.id, verified_at: verified.totals.verified_at } : null, rehearsals: rehearsals, in_place_restore: 'REFUSED (not implemented; needs approval + isolated environment)' };
}

/* --- default Apps Script adapters (only used when nothing is injected) --- */

function _bkDriveDefault() {
  return {
    findFileInFolder: function (folderId, fileName) { var it = DriveApp.getFolderById(folderId).getFilesByName(fileName); if (!it.hasNext()) return null; var f = it.next(); return { id: f.getId(), name: f.getName() }; },
    createFileInFolder: function (folderId, fileName, content, mimeType) { var f = DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(content, mimeType || 'application/json', fileName)); return { id: f.getId(), name: f.getName() }; },
    readFile: function (fileId) { return DriveApp.getFileById(fileId).getBlob().getDataAsString(); }
  };
}
function _bkSheetsDefault() {
  return {
    createSpreadsheet: function (name, folderId) {
      var ss = SpreadsheetApp.create(name);
      if (folderId) { try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderId)); } catch (e) { /* leave in root if move fails */ } }
      return { id: ss.getId(), url: ss.getUrl(), ss: ss };
    },
    writeTab: function (target, name, headers, rows) {
      var ss = target.ss, sh = ss.getSheetByName(name) || ss.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      if (rows.length) { var CH = 500; for (var i = 0; i < rows.length; i += CH) { var chunk = rows.slice(i, i + CH).map(function (r) { return r.map(function (v) { return v === null ? '' : v; }); }); sh.getRange(2 + i, 1, chunk.length, headers.length).setValues(chunk); } }
      var first = ss.getSheets()[0]; if (first && first.getName() === 'Sheet1' && ss.getSheets().length > 1) ss.deleteSheet(first);
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { BK_DEV_SHEET_ID, BK_RESTORE_CONFIRM, BK_FILE_PREFIX, _bkExport, _bkVerify, _bkCompare, _bkRestoreRehearsal, _bkRestoreInPlace, _bkRetentionReview, _bkStatus, _bkSnapshot, _bkHash, _bkGuardStore };
}
