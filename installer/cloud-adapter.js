/* Installer workflow cloud adapter: header-checked Sheets store; installer-facing entry points take the signed-in user as actor. */
function _iwCloudConfig() { var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null'); if (!c || c.environment !== 'DEV') throw new Error('IW_REFUSED: exact DEV environment required'); return c; }
function _iwCloudGuard() { var ss = SpreadsheetApp.getActiveSpreadsheet(); _iwCloudConfig(); if (ss.getId() !== IW_DEV_SHEET_ID) throw new Error('IW_REFUSED: exact DEV sheet/environment required'); return ss; }
function _iwSheet(ss, name) { var m = ss.getSheets().filter(function (s) { return s.getName() === name; }); if (m.length !== 1) throw new Error('IW_SCHEMA: missing/duplicate tab ' + name); var sh = m[0], h = IW_HEADERS[name]; if (!h || sh.getLastColumn() < h.length || JSON.stringify(sh.getRange(1, 1, 1, h.length).getValues()[0]) !== JSON.stringify(h)) throw new Error('IW_SCHEMA: header mismatch ' + name); return sh; }
function _iwCell(v) { return v === null || v === undefined ? '' : typeof v === 'string' && /^[=+@'\-]/.test(v) ? "'" + v : v; }
function _iwCloudStore() {
  var ss = _iwCloudGuard();
  function list(name) { var sh = _iwSheet(ss, name), h = IW_HEADERS[name]; if (sh.getLastRow() < 2) return []; return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) { var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x; }).filter(function (r) { return r.id; }); }
  return {
    getSheetId: function () { return ss.getId(); }, getEnvironment: function () { _iwCloudGuard(); return 'DEV'; }, list: list,
    get: function (name, id) { var rows = list(name).filter(function (r) { return r.id === id; }); if (rows.length > 1) throw new Error('IW_SCHEMA: duplicate ID ' + id); return rows[0] || null; },
    insert: function (name, row) { var sh = _iwSheet(ss, name), h = IW_HEADERS[name]; if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('IW_SCHEMA: duplicate insert ' + row.id); if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('IW_CAPACITY: ' + name); for (var k in row) if (row.hasOwnProperty(k) && h.indexOf(k) === -1) throw new Error('IW_SCHEMA: unknown field ' + name + '.' + k); sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _iwCell(row[k]); })]); SpreadsheetApp.flush(); },
    update: function (name, id, patch) { var sh = _iwSheet(ss, name), h = IW_HEADERS[name], values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues(), idx = []; values.forEach(function (r, i) { if (r[0] === id) idx.push(i); }); if (idx.length !== 1) throw new Error('IW_SCHEMA: update row ' + id); var row = values[idx[0]]; for (var k in patch) { if (!patch.hasOwnProperty(k)) continue; if (h.indexOf(k) === -1) throw new Error('IW_SCHEMA: unknown field ' + name + '.' + k); row[h.indexOf(k)] = patch[k]; } sh.getRange(idx[0] + 2, 1, 1, h.length).setValues([row.map(_iwCell)]); SpreadsheetApp.flush(); },
    withLock: function (fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) throw new Error('IW_BUSY'); try { return fn(); } finally { lock.releaseLock(); } }
  };
}
function _iwResult(name, fn) { try { var result = fn(); var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result }; console.log(JSON.stringify(r)); return r; } catch (e) { var f = { test: name, pass: false, detail: String(e.message || e) }; console.log(JSON.stringify(f)); return f; } }
/* The actor is ALWAYS the signed-in user's People row — never a client-supplied id. */
function _iwActorId(store) { var email = ''; try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (e) { email = ''; } if (!email) throw new Error('IW_REFUSED: authenticated user required'); var p = store.list('People').filter(function (x) { return String(x.email || '').toLowerCase() === email && (x.active === true || x.active === 'TRUE'); })[0]; if (!p) throw new Error('IW_REFUSED: signed-in user is not an active People row'); return p.id; }
function _iwStamp() { return new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14); }
function _iwParse(json) { if (!json) return null; if (typeof json === 'object') return json; try { return JSON.parse(json); } catch (e) { throw new Error('IW_REVIEW: invalid JSON payload'); } }
function _iwSetFn06(store, enable) { return store.withLock(function () { var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-06'; }); if (rows.length !== 1 || rows[0].target_release !== 'R3') throw new Error('IW_REFUSED: FN-06 ReleaseMode invalid'); var r = rows[0], ok = (r.mode === 'Disabled' && r.authorised_job_scope === 'None') || (r.mode === 'Automated' && r.authorised_job_scope === 'Pilot'); if (!ok) throw new Error('IW_REFUSED: FN-06 unexpected state ' + r.mode + '/' + r.authorised_job_scope); store.update('ReleaseModes', r.id, { mode: enable ? 'Automated' : 'Disabled', authorised_job_scope: enable ? 'Pilot' : 'None', updated_at: new Date().toISOString(), updated_by: enable ? 'IW-enable' : 'IW-restore', version: Number(r.version || 0) + 1 }); return { ok: true, enabled: enable, function_id: 'FN-06' }; }); }
function runIwEnableFn06ForSyntheticTest() { return _iwResult('IW enable FN-06', function () { return _iwSetFn06(_iwCloudStore(), true); }); }
function restoreIwSafeState() { return _iwResult('IW restore', function () { return _iwSetFn06(_iwCloudStore(), false); }); }
function runIwMyWork(fromDate, toDate) { return _iwResult('IW my work', function () { var s = _iwCloudStore(); return Object.assign({ ok: true }, _iwMyWork(s, _iwActorId(s), { from: fromDate || null, to: toDate || null })); }); }
/* AppSheet-callable command: payloadJson carries command_id (client-generated for offline duplicate sync) and fields; actor from session. */
function appSheetInstallerCommand(commandType, payloadJson) {
  var s, actor; try { s = _iwCloudStore(); actor = _iwActorId(s); } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
  var map = { IW_START: _iwStart, IW_PROGRESS: _iwProgress, IW_REPORT_COMPLETION: _iwReportCompletion, IW_REPORT_PROBLEM: _iwReportProblem, IW_REPORT_VARIATION: _iwReportVariation, IW_COMMISSIONING_DRAFT: _iwSaveCommissioningDraft, IW_COMMISSIONING_SUBMIT: _iwSubmitCommissioning };
  var fn = map[commandType]; if (!fn) return JSON.stringify({ ok: false, error: 'IW_UNKNOWN_COMMAND' });
  var p; try { p = _iwParse(payloadJson) || {}; } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
  p.actor = actor; if (!p.command_id) return JSON.stringify({ ok: false, error: 'IW_REVIEW: command_id required (generate on the device for safe resubmission)' });
  try { return JSON.stringify(Object.assign({ ok: true, command_type: commandType, actor_id: actor }, s.withLock(function () { return fn(s, p); }))); } catch (e) { return JSON.stringify({ ok: false, command_type: commandType, error: e.message }); }
}
/* Synthetic zero-arg smoke on a fresh IW-fixture job with the signed-in user allocated as installer. Restores FN-06. */
function runIwHappyPathTest() {
  return _iwResult('IW happy path', function () {
    var s = _iwCloudStore(), actor = _iwActorId(s);
    _iwSetFn06(s, true);
    try {
      return s.withLock(function () {
        var n = new Date().toISOString(), stamp = _iwStamp(), jobId = 'J-iw-smoke-' + stamp, wpId = 'WP-' + jobId + '-roof', today = n.slice(0, 10);
        s.insert('Jobs', { id: jobId, job_id: 'SS-IW-' + stamp.slice(-6), customer_id: 'CUST-iw', display_name: 'IW Smoke ' + stamp, finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: false, scaffold_required: false, workflow_stage: 'InProgress', handover_status: 'NotReady', financial_status: 'Pending', pilot_job: true, release_scope: 'R3', created_at: n, created_by: 'IW-fixture', updated_at: n, updated_by: 'IW-fixture', version: 1, source_system: 'IW-fixture', commit_id: 'IW-fixture' });
        s.insert('WorkPackages', { id: wpId, job_id: jobId, trade: 'Roof', required: true, planned_start: today, planned_end: today, status: 'Scheduled', commissioning_required: true, sequence: 1, revision: 1, created_at: n, created_by: 'IW-fixture', updated_at: n, updated_by: 'IW-fixture', version: 1, source_system: 'IW-fixture', commit_id: 'IW-fixture' });
        s.insert('Allocations', { id: 'ALLOC-' + wpId, work_package_id: wpId, person_id: actor, role: 'Lead', start_at: today, end_at: today, active: true, created_at: n, created_by: 'IW-fixture', updated_at: n, updated_by: 'IW-fixture', version: 1, source_system: 'IW-fixture', commit_id: 'IW-fixture' });
        var mine = _iwMyWork(s, actor, {}), wp = s.get('WorkPackages', wpId);
        var st = _iwStart(s, { actor: actor, command_id: 'IW-' + stamp + '-START', work_package_id: wpId, expected_version: wp.version });
        var pr = _iwProgress(s, { actor: actor, command_id: 'IW-' + stamp + '-PROG', work_package_id: wpId, note: 'Half done', evidence: [{ drive_file_id: 'drive-iw-' + stamp + '-1', filename: 'progress.jpg' }] });
        var pb = _iwReportProblem(s, { actor: actor, command_id: 'IW-' + stamp + '-PROB', work_package_id: wpId, category: 'Access', description: 'Synthetic access issue', blocks_completion: false });
        wp = s.get('WorkPackages', wpId);
        var rc = _iwReportCompletion(s, { actor: actor, command_id: 'IW-' + stamp + '-DONE', work_package_id: wpId, outcome: 'Complete', actual_end: today, expected_version: wp.version, evidence: [{ drive_file_id: 'drive-iw-' + stamp + '-2', filename: 'done.jpg' }] });
        var rcAgain = _iwReportCompletion(s, { actor: actor, command_id: 'IW-' + stamp + '-DONE', work_package_id: wpId, outcome: 'Complete', actual_end: today, expected_version: wp.version, evidence: [{ drive_file_id: 'drive-iw-' + stamp + '-2', filename: 'done.jpg' }] });
        var dr = _iwSaveCommissioningDraft(s, { actor: actor, command_id: 'IW-' + stamp + '-DRAFT', work_package_id: wpId, answers: [{ question_key: 'synthetic_check', value_boolean: true }] });
        var sub = s.get('CommissioningSubmissions', dr.submission_id);
        var sm = _iwSubmitCommissioning(s, { actor: actor, command_id: 'IW-' + stamp + '-SUBMIT', work_package_id: wpId, submission_id: sub.id, expected_version: sub.version });
        var pass = mine.count >= 1 && st.status === 'InProgress' && pr.evidence.length === 1 && pb.issue.status === 'Open' && rc.status === 'ReportedComplete' && rcAgain.replay === true && rc.commissioning_submission && sm.status === 'Submitted' && s.get('WorkPackages', wpId).actual_end === today;
        return { pass: pass, detail: { job_id: jobId, my_work: mine.count, statuses: [st.status, rc.status, sm.status], replay: rcAgain.replay, issue: pb.issue.id, submission: sm.submission_id, template_version: dr.template_version, external_calls: 0 } };
      });
    } finally { _iwSetFn06(s, false); }
  });
}
