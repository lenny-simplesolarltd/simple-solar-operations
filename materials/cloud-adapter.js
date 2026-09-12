/* Materials workflow cloud adapter: header-checked Sheets store + zero-arg DEV entry points.
 * Sheet-only writes. Merchant messages are captured as Draft Communications; nothing is sent. FN-03/FN-05 toggled only for synthetic smoke. */
function _matCloudConfig() {
  var c = JSON.parse(PropertiesService.getScriptProperties().getProperty('S01_CONFIG') || 'null');
  if (!c || c.environment !== 'DEV') throw new Error('MAT_REFUSED: exact DEV environment required');
  return c;
}
function _matCloudGuard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  _matCloudConfig();
  if (ss.getId() !== MAT_DEV_SHEET_ID) throw new Error('MAT_REFUSED: exact DEV sheet/environment required');
  return ss;
}
function _matSheet(ss, name) {
  var matches = ss.getSheets().filter(function (s) { return s.getName() === name; });
  if (matches.length !== 1) throw new Error('MAT_SCHEMA: missing/duplicate tab ' + name);
  var sh = matches[0], headers = MAT_HEADERS[name];
  if (!headers || sh.getLastColumn() !== headers.length || JSON.stringify(sh.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers))
    throw new Error('MAT_SCHEMA: header mismatch ' + name);
  return sh;
}
function _matCell(value) { return value === null || value === undefined ? '' : typeof value === 'string' && /^[=+@'\-]/.test(value) ? "'" + value : value; }
function _matCloudStore() {
  var ss = _matCloudGuard();
  function list(name) {
    var sh = _matSheet(ss, name), h = MAT_HEADERS[name];
    if (sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (row) { var x = {}; h.forEach(function (k, i) { x[k] = row[i] === '' ? null : row[i]; }); return x; }).filter(function (r) { return r.id; });
  }
  return {
    getSheetId: function () { return ss.getId(); },
    getEnvironment: function () { _matCloudGuard(); return 'DEV'; },
    list: list,
    get: function (name, id) { var rows = list(name).filter(function (r) { return r.id === id; }); if (rows.length > 1) throw new Error('MAT_SCHEMA: duplicate ID ' + id); return rows[0] || null; },
    insert: function (name, row) {
      var sh = _matSheet(ss, name), h = MAT_HEADERS[name];
      if (list(name).some(function (r) { return r.id === row.id; })) throw new Error('MAT_SCHEMA: duplicate insert ' + row.id);
      if (sh.getLastRow() >= sh.getMaxRows()) throw new Error('MAT_CAPACITY: ' + name);
      for (var k in row) if (row.hasOwnProperty(k) && h.indexOf(k) === -1) throw new Error('MAT_SCHEMA: unknown field ' + name + '.' + k);
      sh.getRange(sh.getLastRow() + 1, 1, 1, h.length).setValues([h.map(function (k) { return _matCell(row[k]); })]);
      SpreadsheetApp.flush();
    },
    update: function (name, id, patch) {
      var sh = _matSheet(ss, name), h = MAT_HEADERS[name];
      var values = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), h.length).getValues(), indices = [];
      values.forEach(function (r, i) { if (r[0] === id) indices.push(i); });
      if (indices.length !== 1) throw new Error('MAT_SCHEMA: update row ' + id);
      var idx = indices[0], row = values[idx];
      for (var k in patch) { if (!patch.hasOwnProperty(k)) continue; if (h.indexOf(k) === -1) throw new Error('MAT_SCHEMA: unknown field ' + name + '.' + k); row[h.indexOf(k)] = patch[k]; }
      sh.getRange(idx + 2, 1, 1, h.length).setValues([row.map(_matCell)]);
      SpreadsheetApp.flush();
    },
    withLock: function (fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) throw new Error('MAT_BUSY'); try { return fn(); } finally { lock.releaseLock(); } }
  };
}
function _matResult(name, fn) {
  try { var result = fn(); var r = { test: name, pass: result.pass === undefined ? result.ok !== false : result.pass, detail: result.detail || result }; console.log(JSON.stringify(r)); return r; }
  catch (e) { var f = { test: name, pass: false, detail: String(e.message || e) }; console.log(JSON.stringify(f)); return f; }
}
function _matActor() { try { var e = Session.getActiveUser().getEmail(); return e ? String(e) : 'DEV-apps-script'; } catch (x) { return 'DEV-apps-script'; } }
function _matStamp() { return new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 14); }
function _matSetModes(store, enable) {
  return store.withLock(function () {
    ['FN-03', 'FN-05'].forEach(function (fnId) {
      var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === fnId; });
      if (rows.length !== 1 || rows[0].target_release !== 'R2') throw new Error('MAT_REFUSED: ' + fnId + ' ReleaseMode invalid');
      var r = rows[0], ok = (r.mode === 'Disabled' && r.authorised_job_scope === 'None') || (r.mode === 'Automated' && r.authorised_job_scope === 'Pilot');
      if (!ok) throw new Error('MAT_REFUSED: ' + fnId + ' unexpected state ' + r.mode + '/' + r.authorised_job_scope);
      store.update('ReleaseModes', r.id, { mode: enable ? 'Automated' : 'Disabled', authorised_job_scope: enable ? 'Pilot' : 'None', updated_at: new Date().toISOString(), updated_by: enable ? 'MAT-enable' : 'MAT-restore', version: Number(r.version || 0) + 1 });
    });
    return { ok: true, enabled: enable, functions: ['FN-03', 'FN-05'] };
  });
}
function runMatRequirements(jobId) { return _matResult('MAT requirements', function () { return Object.assign({ ok: true }, _matRequirements(_matCloudStore(), jobId)); }); }
function runMatOrderView(orderId) { return _matResult('MAT order view', function () { return Object.assign({ ok: true }, _matOrderView(_matCloudStore(), orderId)); }); }
function runMatStoreQueue(fromDate, toDate) { return _matResult('MAT store queue', function () { return Object.assign({ ok: true }, _matStoreQueue(_matCloudStore(), { from: fromDate || null, to: toDate || null })); }); }
function runMatEnableFunctionsForSyntheticTest() { return _matResult('MAT enable', function () { return _matSetModes(_matCloudStore(), true); }); }
function restoreMatSafeState() { return _matResult('MAT restore', function () { return _matSetModes(_matCloudStore(), false); }); }
function runMatWeeklyList(listDate) { return _matResult('MAT weekly list', function () { var s = _matCloudStore(); return s.withLock(function () { return Object.assign({ ok: true }, _matWeeklyList(s, { actor: _matActor(), command_id: 'MAT-WEEKLY-' + _matStamp(), list_date: listDate || null })); }); }); }
/* Synthetic DEV smoke: fresh MAT-fixture job with Roof + Electrical packages → requirements → two orders → send → confirm →
 * partial receipt with damage (quarantine + issue) → balance receipt → Received; AlreadyOrdered verification; Friday list; replay. Restores FN-03/FN-05. */
function runMatHappyPathTest() {
  return _matResult('MAT happy path', function () {
    var s = _matCloudStore();
    _matSetModes(s, true);
    try {
      return s.withLock(function () {
        var n = new Date().toISOString(), stamp = _matStamp(), actor = _matActor(), jobId = 'J-mat-smoke-' + stamp;
        var roofStart = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10), elecStart = new Date(Date.now() + 49 * 86400000).toISOString().slice(0, 10);
        s.insert('Jobs', { id: jobId, job_id: 'SS-MAT-' + stamp.slice(-6), customer_id: 'CUST-mat', display_name: 'MAT Smoke ' + stamp, finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: true, scaffold_required: false, workflow_stage: 'Booked', handover_status: 'NotReady', financial_status: 'Pending', pilot_job: true, release_scope: 'R2', created_at: n, created_by: 'MAT-fixture', updated_at: n, updated_by: 'MAT-fixture', version: 1, source_system: 'MAT-fixture', commit_id: 'MAT-fixture' });
        s.insert('WorkPackages', { id: 'WP-' + jobId + '-roof', job_id: jobId, trade: 'Roof', required: true, planned_start: roofStart, planned_end: roofStart, status: 'Scheduled', commissioning_required: true, sequence: 1, revision: 1, created_at: n, created_by: 'MAT-fixture', updated_at: n, updated_by: 'MAT-fixture', version: 1, source_system: 'MAT-fixture', commit_id: 'MAT-fixture' });
        s.insert('WorkPackages', { id: 'WP-' + jobId + '-elec', job_id: jobId, trade: 'Electrical', required: true, planned_start: elecStart, planned_end: elecStart, status: 'Scheduled', commissioning_required: true, sequence: 2, revision: 1, created_at: n, created_by: 'MAT-fixture', updated_at: n, updated_by: 'MAT-fixture', version: 1, source_system: 'MAT-fixture', commit_id: 'MAT-fixture' });
        var r1 = _matAddRequirement(s, { actor: actor, command_id: 'MS-' + stamp + '-P460', job_id: jobId, work_package_id: 'WP-' + jobId + '-roof', product_id: 'PROD-P460', required_quantity: 10, source: 'ToOrder', expected_version: 1 });
        var r2 = _matAddRequirement(s, { actor: actor, command_id: 'MS-' + stamp + '-CABLE', job_id: jobId, work_package_id: 'WP-' + jobId + '-elec', description: '6mm twin & earth', unit: 'Metre', required_quantity: 50, source: 'ToOrder', merchant_id: 'COMP-cef', expected_version: 2 });
        var r3 = _matAddRequirement(s, { actor: actor, command_id: 'MS-' + stamp + '-AO', job_id: jobId, work_package_id: 'WP-' + jobId + '-roof', description: 'Rails (already ordered)', unit: 'Each', required_quantity: 8, source: 'AlreadyOrdered', merchant_id: 'COMP-greentech', already_ordered_reference: 'GT-PRE-' + stamp, expected_version: 3 });
        var built = _matBuildOrders(s, { actor: actor, command_id: 'MS-' + stamp + '-BUILD', job_id: jobId });
        var roof = built.orders.filter(function (o) { return o.work_type === 'Roof'; })[0], elec = built.orders.filter(function (o) { return o.work_type === 'Electrical'; })[0];
        var o = s.get('Orders', roof.order_id);
        var sent = _matSendOrder(s, { actor: actor, command_id: 'MS-' + stamp + '-SEND', order_id: o.id, expected_version: o.version }); o = s.get('Orders', o.id);
        var conf = _matConfirmOrder(s, { actor: actor, command_id: 'MS-' + stamp + '-CONF', order_id: o.id, supplier_reference: 'GT-' + stamp, expected_version: o.version }); o = s.get('Orders', o.id);
        var line = s.list('OrderLines').filter(function (l) { return l.order_id === o.id; })[0];
        var rec1 = _matReceiveDelivery(s, { actor: actor, command_id: 'MS-' + stamp + '-RCV1', delivery_id: conf.delivery.id, received_by: actor, delivery_note_reference: 'DN-' + stamp + '-1', lines: [{ order_line_id: line.id, quantity_good: 6, quantity_damaged: 1 }] });
        var rec1again = _matReceiveDelivery(s, { actor: actor, command_id: 'MS-' + stamp + '-RCV1', delivery_id: conf.delivery.id, received_by: actor, delivery_note_reference: 'DN-' + stamp + '-1', lines: [{ order_line_id: line.id, quantity_good: 6, quantity_damaged: 1 }] });
        var rec2 = _matReceiveDelivery(s, { actor: actor, command_id: 'MS-' + stamp + '-RCV2', delivery_id: rec1.follow_up_delivery_id, received_by: actor, delivery_note_reference: 'DN-' + stamp + '-2', lines: [{ order_line_id: line.id, quantity_good: 3, quantity_damaged: 0 }] });
        var view = _matOrderView(s, o.id), reqs = _matRequirements(s, jobId);
        var weekly = _matWeeklyList(s, { actor: actor, command_id: 'MS-' + stamp + '-WK', list_date: _matListDateFor(s.get('Orders', elec.order_id).requested_delivery_date) });
        var movements = s.list('StockMovements').filter(function (m) { return m.job_id === jobId; });
        var pass = built.orders.length === 2 && sent.status === 'Requested' && conf.status === 'Confirmed' && rec1.order.status === 'PartReceived' && rec1.issues.length === 1 && rec1again.replay === true && rec2.order.status === 'Received' && movements.length === 3 && movements.filter(function (m) { return m.to_location_id === 'LOC-quarantine'; }).length === 1 && reqs.items.some(function (i) { return i.state === 'VerifyExternalOrder'; }) && s.list('Tasks').some(function (t) { return t.template_code === 'MAT02' && t.job_id === jobId; });
        return { pass: pass, detail: { job_id: jobId, orders: built.orders.map(function (x) { return x.order_id + ':' + x.work_type + ':' + x.requested_delivery_date; }), roof_status: s.get('Orders', o.id).status, movements: movements.map(function (m) { return m.movement_type + ':' + m.quantity + '→' + m.to_location_id; }), issues: rec1.issues, replay: rec1again.replay, weekly_lists: weekly.lists.length, tasks: view.tasks.map(function (t) { return t.template_code + ':' + t.status; }), external_calls: 0 } };
      });
    } finally { _matSetModes(s, false); }
  });
}
