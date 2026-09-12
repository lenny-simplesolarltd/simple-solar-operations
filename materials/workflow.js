/* Materials workflow — requirements, merchant orders with revisions/acknowledgements, receipts into stock, Friday lists.
 * Authority: 01 §4 Materials/Orders/OrderLines/Deliveries/ReceiptLines/StockMovements/Communications, task templates MAT01–MAT06,
 * 04 S07/S08 ("separate roofing and electrical order batches", "Thursday in the week before each package's work week",
 * "an AlreadyOrdered line creates verification, not a second order", "immutable sent snapshots", "good receipts to usable
 * store stock and damaged receipts to quarantine", "a replay must not add them again", "short or damaged goods create a
 * separate action, not silent substitution"), AGENT_RUNBOOK §D.
 *
 * FN-03 Orders and merchant messages (R2) gates requirements/orders/lists; FN-05 Panel stock (R2) additionally gates receipts.
 * Merchant messages are CAPTURED as Communications rows (status Draft); nothing is sent; sent_message_id stays null.
 * No external calls. Existing S07/S08 modules are untouched; this module uses distinct ids (ORD-<job>-<merchant>-<type>). */
'use strict';

var MAT_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var MAT_SERVICE = 'MaterialsWorkflow';
var MAT_SOURCES = ['ToOrder', 'AlreadyOrdered', 'Stock'];
var MAT_WORK_TYPES = ['Roof', 'Electrical', 'Other'];
var MAT_ORDER_STATUSES = ['Draft', 'Review', 'Requested', 'Confirmed', 'PartReceived', 'Received', 'Cancelled'];
var MAT_LOC = { store: 'LOC-store', quarantine: 'LOC-quarantine', supplier: 'LOC-external' };
var MAT_TEMPLATES = {
  MAT01: { title: 'Place material order', group: 'Materials', role: 'Office' },
  MAT02: { title: 'Verify already-ordered materials', group: 'Materials', role: 'Office' },
  MAT03: { title: 'Reserve and pick stock', group: 'Materials', role: 'Store' },
  MAT04: { title: 'Receive and check delivery', group: 'Materials', role: 'Store' },
  MAT05: { title: 'Friday merchant expected-delivery lists', group: 'Materials', role: 'Office' },
  MAT06: { title: 'Merchant confirmation of latest revision', group: 'Materials', role: 'Office' }
};

/* --- utilities --- */

function _matText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _matIsTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }
function _matRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _matNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function _matDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) _matRefuse('MAT_DATE_INVALID');
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, 'Europe/London', 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) _matRefuse('MAT_DATE_INVALID');
  var iso = m[1] + '-' + m[2] + '-' + m[3], d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) _matRefuse('MAT_DATE_INVALID');
  return iso;
}
function _matTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') { if (isNaN(value.getTime())) _matRefuse('MAT_DATE_INVALID'); return value.toISOString(); }
  var t = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { var d = new Date(t); if (isNaN(d.getTime())) _matRefuse('MAT_DATE_INVALID'); return d.toISOString(); }
  return t;
}
function _matNow(input) { if (input && input.at) { var t = _matTimestamp(input.at); if (!/^\d{4}-\d{2}-\d{2}T/.test(String(t))) _matRefuse('MAT_DATE_INVALID'); return new Date(t).toISOString(); } return new Date().toISOString(); }
function _matAddDays(iso, days) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function _matWeekday(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
function _matMonday(iso) { var d = _matDate(iso), wd = _matWeekday(d); return _matAddDays(d, wd === 0 ? -6 : 1 - wd); }
function _matLondonInstant(iso, hhmm) {
  iso = _matDate(iso);
  var parts = hhmm.split(':'), guess = new Date(iso + 'T' + hhmm + ':00Z');
  var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  var map = {}; fmt.formatToParts(guess).forEach(function (p) { map[p.type] = p.value; });
  var offsetMin = (Number(map.hour === '24' ? 0 : map.hour) * 60 + Number(map.minute)) - (Number(parts[0]) * 60 + Number(parts[1]));
  return new Date(guess.getTime() - offsetMin * 60000).toISOString();
}
function _matSetting(store, key, fallback) {
  var rows = store.list('Settings').filter(function (s) { return s.key === key; });
  if (!rows.length) return fallback;
  rows.sort(function (a, b) { return Number(b.version || 0) - Number(a.version || 0); });
  try { return JSON.parse(rows[0].typed_value); } catch (e) { return rows[0].typed_value; }
}
function _matStaffedWeekdays(store) { var v = _matSetting(store, 'office.staffed_weekdays', [1, 2, 3, 4, 5]); return Array.isArray(v) ? v : [1, 2, 3, 4, 5]; }
function _matOfficeHours(store) { var v = _matSetting(store, 'office.hours', { start: '09:00', end: '17:00' }); return v && /^\d{2}:\d{2}$/.test(v.start) && /^\d{2}:\d{2}$/.test(v.end) ? v : { start: '09:00', end: '17:00' }; }
function _matClosed(store) { var out = []; store.list('Holidays').forEach(function (h) { if (_matIsTrue(h.office_closed)) { try { var d = _matDate(h.local_date); if (d) out.push(d); } catch (e) { /* skip */ } } }); return out; }
function _matIsStaffed(store, iso) { return _matStaffedWeekdays(store).indexOf(_matWeekday(iso)) !== -1 && _matClosed(store).indexOf(iso) === -1; }
function _matPrevStaffed(store, iso) { var d = iso, n = 0; while (!_matIsStaffed(store, d) && n < 60) { d = _matAddDays(d, -1); n++; } return d; }
function _matNextStaffed(store, iso) { var d = _matAddDays(iso, 1), n = 0; while (!_matIsStaffed(store, d) && n < 60) { d = _matAddDays(d, 1); n++; } return d; }
function _matSameOrNextStaffed(store, iso) { return _matIsStaffed(store, iso) ? iso : _matNextStaffed(store, iso); }
function _matDayEnd(store, iso) { return _matLondonInstant(iso, _matOfficeHours(store).end); }
function _matDayStart(store, iso) { return _matLondonInstant(iso, _matOfficeHours(store).start); }

/* --- guards --- */

function _matGuardStore(store) {
  if (!store || !store.getSheetId || store.getSheetId() !== MAT_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') _matRefuse('MAT_REFUSED: exact DEV sheet/environment required');
}
function _matRequirePilot(store, fnId) {
  var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === fnId; });
  if (rows.length !== 1 || rows[0].target_release !== 'R2') _matRefuse('MAT_REFUSED: ' + fnId + ' ReleaseMode invalid');
  if (rows[0].mode !== 'Automated' || rows[0].authorised_job_scope !== 'Pilot') _matRefuse('MAT_REFUSED: ' + fnId + ' must be Automated/Pilot/R2 (got ' + rows[0].mode + '/' + rows[0].authorised_job_scope + ')');
}
function _matJob(store, jobId) {
  var job = store.get('Jobs', jobId);
  if (!job) _matRefuse('MAT_REVIEW: job not found');
  if (!_matIsTrue(job.pilot_job) || job.release_scope !== 'R2') _matRefuse('MAT_REFUSED: pilot R2 job required');
  if (job.cancellation_at || ['CancellationInProgress', 'Cancelled'].indexOf(job.workflow_stage) !== -1) _matRefuse('S15_REVIEW: normal work suppressed');
  return job;
}
function _matMerchant(store, id) {
  var c = store.get('Companies', id);
  if (!c || c.type !== 'Merchant' || !_matIsTrue(c.active)) _matRefuse('MAT_REVIEW: active Merchant company required');
  return c;
}
function _matOwner(store, role) {
  var people = store.list('People').filter(function (p) { return _matIsTrue(p.active) && p.role === role; });
  var named = role === 'Office' ? people.filter(function (p) { return String(p.display_name || '').toLowerCase().indexOf('tanya') !== -1; })[0] : null;
  var owner = named || people[0];
  if (!owner && role === 'Store') owner = _matOwner(store, 'Office');
  if (!owner) _matRefuse('MAT_CONFIG: active ' + role + ' owner required');
  return owner;
}
function _matExpect(row, input) { if (input.expected_version === undefined || input.expected_version === null) _matRefuse('MAT_REVIEW: expected_version required'); if (Number(row.version) !== Number(input.expected_version)) _matRefuse('MAT_STALE: version'); }
function _matPatch(store, table, row, patch, input, now) {
  var p = {}; for (var k in patch) if (patch.hasOwnProperty(k)) p[k] = patch[k];
  p.updated_at = now; p.updated_by = input.actor; p.version = Number(row.version || 0) + 1;
  store.update(table, row.id, p);
  return store.get(table, row.id);
}

/* --- command journal + audit --- */

function _matCommandStart(store, input, entityType, entityId, changes) {
  if (!_matText(input.command_id) || !_matText(input.actor)) _matRefuse('MAT_REVIEW: command_id and actor required');
  var id = 'CJ-MAT-' + input.command_id, encoded = JSON.stringify(changes), existing = store.get('CommitJournal', id);
  if (existing) {
    if (existing.command_id !== input.command_id || existing.entity_type !== entityType || existing.entity_id !== entityId || existing.changes_json !== encoded) _matRefuse('MAT_REVIEW: conflicting command identity');
    if (existing.state !== 'Committed') _matRefuse('MAT_RECOVERY_REQUIRED: incomplete materials command ' + input.command_id);
    return { replay: true };
  }
  var now = _matNow(input);
  store.insert('CommitJournal', { id: id, commit_id: 'MAT-' + input.command_id, state: 'Prepared', command_id: input.command_id, entity_type: entityType, entity_id: entityId, expected_version: input.expected_version === undefined ? null : input.expected_version, changes_json: encoded, prepared_at: now, committed_at: null, created_at: now });
  return { replay: false };
}
function _matCommit(store, input, now) { store.update('CommitJournal', 'CJ-MAT-' + input.command_id, { state: 'Committed', committed_at: now }); }
function _matAudit(store, type, id, action, before, after, input, now) {
  store.insert('AuditEvents', { id: 'AUD-MAT-' + input.command_id + '-' + type + '-' + id + '-' + action, entity_type: type, entity_id: id, action: action, before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null, initiating_actor: input.actor, executing_service: MAT_SERVICE, timestamp: now, correlation_id: input.command_id, reason: input.reason || null, commit_id: 'MAT-' + input.command_id, created_at: now });
}

/* --- tasks MAT01–MAT06 --- */

function _matTemplate(store, code) { return store.list('TaskTemplates').filter(function (t) { return t.template_code === code && _matIsTrue(t.active); })[0] || null; }
function _matTask(store, code, jobId, entityType, entityId, instanceKey, dueAt, input, now, suffix) {
  var existing = store.list('Tasks').filter(function (t) { return t.instance_key === instanceKey && t.status !== 'Cancelled'; });
  if (existing.length) return { created: false, task_id: existing[0].id, code: code };
  var tpl = _matTemplate(store, code), def = MAT_TEMPLATES[code];
  if (!tpl) _matRefuse('MAT_CONFIG: TaskTemplate ' + code + ' missing/inactive');
  var owner = _matOwner(store, tpl.default_owner_role || def.role);
  var task = {
    id: 'TASK-MAT-' + instanceKey, job_id: jobId, template_code: code, instance_key: instanceKey, group: tpl.group || def.group,
    title: (tpl.title || def.title) + (suffix ? ' — ' + suffix : ''), owner_id: owner.id, backup_id: owner.backup_person_id || null,
    related_entity_type: entityType, related_entity_id: entityId, due_at: dueAt, original_due_at: dueAt, priority: 1, status: 'Open',
    blocking_reason: null, next_followup_at: null, completed_at: null, completed_by: null, completion_note: null, evidence_id: null, revision_required: false,
    created_rule_version: 'MAT-1.0', created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: MAT_SERVICE, commit_id: 'MAT-' + input.command_id
  };
  store.insert('Tasks', task);
  return { created: true, task_id: task.id, code: code };
}
function _matCompleteTasks(store, entityType, entityId, codes, input, now, note) {
  var done = [];
  store.list('Tasks').forEach(function (t) {
    if (t.related_entity_type !== entityType || t.related_entity_id !== entityId || codes.indexOf(t.template_code) === -1) return;
    if (['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) !== -1) return;
    store.update('Tasks', t.id, { status: 'Complete', completed_at: now, completed_by: input.actor, completion_note: note, updated_at: now, updated_by: input.actor, version: Number(t.version || 0) + 1 });
    done.push(t.id);
  });
  return done;
}
function _matCancelTasks(store, entityType, entityId, input, now) {
  var done = [];
  store.list('Tasks').forEach(function (t) {
    if (t.related_entity_type !== entityType || t.related_entity_id !== entityId) return;
    if (['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) !== -1) return;
    store.update('Tasks', t.id, { status: 'Cancelled', completion_note: input.reason || null, updated_at: now, updated_by: input.actor, version: Number(t.version || 0) + 1 });
    done.push(t.id);
  });
  return done;
}

/* --- delivery date rule: merchant delivery weekday (default Thursday) in the week BEFORE the package's work week --- */

function _matDeliveryDate(plannedStart, merchant) {
  var dw = merchant && merchant.delivery_weekday !== null && merchant.delivery_weekday !== undefined ? Number(merchant.delivery_weekday) : 4;
  if (!(dw >= 1 && dw <= 6)) dw = 4;
  var monday = _matMonday(plannedStart);
  return _matAddDays(monday, -7 + (dw - 1));
}
/* Friday list date for a delivery: the Friday of the week before the delivery week. */
function _matListDateFor(deliveryDate) { return _matAddDays(_matMonday(deliveryDate), -3); }
function _matWorkType(store, workPackageId) {
  if (!workPackageId) return 'Other';
  var wp = store.get('WorkPackages', workPackageId);
  if (!wp) return 'Other';
  return MAT_WORK_TYPES.indexOf(wp.trade) !== -1 ? wp.trade : 'Other';
}
function _matLeadRisk(store, needBy, merchant, today) {
  var lead = Number(merchant && merchant.standard_lead_days ? merchant.standard_lead_days : 0);
  var latestOrderDate = _matPrevStaffed(store, _matAddDays(needBy, -lead));
  return { latest_order_date: latestOrderDate, lead_days: lead, at_risk: latestOrderDate < today };
}

/* --- captured merchant communications --- */

function _matContacts(store, companyId) {
  return store.list('Contacts').filter(function (c) { return c.company_id === companyId && _matIsTrue(c.active); }).map(function (c) { return { contact_id: c.id, name: c.name, email: c.email || 'NOT_CONFIGURED', channel: c.preferred_channel || 'NOT_CONFIGURED' }; });
}
function _matOrderSnapshot(store, order) {
  var job = store.get('Jobs', order.job_id), customer = job ? store.get('Customers', job.customer_id) : null;
  var lines = store.list('OrderLines').filter(function (l) { return l.order_id === order.id; }).map(function (l) {
    return { order_line_id: l.id, product_id: l.product_id, description: l.description_snapshot, quantity: _matNum(l.quantity), cancelled_quantity: _matNum(l.cancelled_quantity), unit: l.unit };
  });
  return { order_id: order.id, revision: order.revision, status: order.status, job_id: order.job_id, job_reference: job ? job.job_id : null, customer_display: job ? job.display_name : null, postcode: customer ? customer.postcode : null, work_type: order.work_type, requested_delivery_date: _matDate(order.requested_delivery_date), delivery_location_id: order.delivery_location_id, supplier_reference: order.supplier_reference || null, lines: lines, note: 'CAPTURED DRAFT — not sent. FN-03 R2.' };
}
function _matCommunication(store, id, jobId, companyId, type, subject, body, revision, input, now, extra) {
  if (store.get('Communications', id)) return { created: false, communication_id: id };
  store.insert('Communications', Object.assign({
    id: id, job_id: jobId, company_id: companyId, type: type, subject: subject, body_snapshot: JSON.stringify(body), attachment_ids: null,
    recipients_snapshot: JSON.stringify(_matContacts(store, companyId)), covered_week_start: null, delivery_date: null, revision: revision, status: 'Draft',
    approved_at: null, approved_by: null, sent_at: null, external_message_id: null, outbox_id: null,
    created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, commit_id: 'MAT-' + input.command_id
  }, extra || {}));
  return { created: true, communication_id: id };
}
function _matCommJob(store, communicationId, jobId, orderId, revision, input, now) {
  var id = 'CJOB-' + communicationId + (orderId ? '-' + orderId : '');
  if (store.get('CommunicationJobs', id)) return id;
  store.insert('CommunicationJobs', { id: id, communication_id: communicationId, job_id: jobId, order_id: orderId || null, scaffold_booking_id: null, entity_revision: revision, created_at: now, commit_id: 'MAT-' + input.command_id });
  return id;
}

/* --- 1. REQUIREMENTS --- */

function _matAddRequirement(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  var job = _matJob(store, input.job_id);
  if (MAT_SOURCES.indexOf(input.source) === -1) _matRefuse('MAT_REVIEW: source must be ToOrder, AlreadyOrdered or Stock');
  var qty = Number(input.required_quantity);
  if (!(qty > 0)) _matRefuse('MAT_REVIEW: required_quantity must be > 0');
  var product = null, description = _matText(input.description) ? input.description.trim() : null, unit = _matText(input.unit) ? input.unit.trim() : null;
  if (_matText(input.product_id)) {
    product = store.get('Products', input.product_id);
    if (!product || !_matIsTrue(product.active)) _matRefuse('MAT_REVIEW: active product required');
    unit = unit || product.unit;
  } else if (!description || !unit) _matRefuse('MAT_REVIEW: Other materials require description and unit');
  var wp = null;
  if (_matText(input.work_package_id)) { wp = store.get('WorkPackages', input.work_package_id); if (!wp || wp.job_id !== job.id) _matRefuse('MAT_REVIEW: work package linkage invalid'); }
  var merchantId = _matText(input.merchant_id) ? input.merchant_id : (product && product.default_supplier_id ? product.default_supplier_id : null);
  var merchant = null;
  if (input.source !== 'Stock') { if (!merchantId) _matRefuse('MAT_REVIEW: merchant_id required (no product default supplier)'); merchant = _matMerchant(store, merchantId); }
  else if (merchantId) merchant = store.get('Companies', merchantId);
  var needBy = _matDate(input.need_by_date);
  if (!needBy) {
    if (wp && wp.planned_start) needBy = _matDeliveryDate(_matDate(wp.planned_start), merchant);
    else _matRefuse('MAT_REVIEW: need_by_date required when the work package has no planned start');
  }
  if (input.source === 'AlreadyOrdered' && !_matText(input.already_ordered_reference)) _matRefuse('MAT_REVIEW: already_ordered_reference required');
  var changes = { job_id: job.id, work_package_id: wp ? wp.id : null, product_id: product ? product.id : null, description: description, required_quantity: qty, unit: unit, source: input.source, need_by_date: needBy, merchant_id: merchantId, already_ordered_reference: input.already_ordered_reference || null, notes: input.notes || null };
  var cmd = _matCommandStart(store, input, 'Jobs', job.id, changes);
  var materialId = 'MAT-' + job.id + '-' + input.command_id;
  if (cmd.replay) return { replay: true, material: store.get('Materials', materialId) };
  _matExpect(job, input);
  var now = _matNow(input), today = _matDate(now);
  var material = Object.assign({ id: materialId, order_line_id: null, revision: 1, cancelled_quantity: 0, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: MAT_SERVICE, commit_id: 'MAT-' + input.command_id }, changes);
  store.insert('Materials', material);
  store.update('Jobs', job.id, { updated_at: now, updated_by: input.actor, version: Number(job.version) + 1 });
  var risk = input.source === 'ToOrder' ? _matLeadRisk(store, needBy, merchant, today) : null, task = null;
  if (input.source === 'AlreadyOrdered') task = _matTask(store, 'MAT02', job.id, 'Materials', materialId, 'MAT02-' + materialId, _matDayEnd(store, _matSameOrNextStaffed(store, today)), input, now, (merchant ? merchant.name : '') + ' ref ' + input.already_ordered_reference);
  if (input.source === 'Stock') task = _matTask(store, 'MAT03', job.id, 'Materials', materialId, 'MAT03-' + materialId, _matDayEnd(store, _matPrevStaffed(store, _matAddDays(needBy, -1))), input, now, (product ? product.name : description) + ' x' + qty);
  _matAudit(store, 'Materials', materialId, 'AddRequirement', null, material, input, now);
  _matCommit(store, input, now);
  return { replay: false, material: material, work_type: _matWorkType(store, wp ? wp.id : null), lead_time_risk: risk, task: task, external_calls: 0 };
}

function _matReceivedForLine(store, lineId) {
  var good = 0, damaged = 0;
  store.list('ReceiptLines').forEach(function (r) { if (r.order_line_id === lineId) { good += _matNum(r.quantity_good); damaged += _matNum(r.quantity_damaged); } });
  return { good: good, damaged: damaged };
}
function _matRequirements(store, jobId) {
  _matGuardStore(store);
  var job = store.get('Jobs', jobId); if (!job) return { found: false, job_id: jobId };
  var today = _matDate(new Date().toISOString());
  var items = store.list('Materials').filter(function (m) { return m.job_id === jobId; }).map(function (m) {
    var product = m.product_id ? store.get('Products', m.product_id) : null, merchant = m.merchant_id ? store.get('Companies', m.merchant_id) : null;
    var line = m.order_line_id ? store.get('OrderLines', m.order_line_id) : null, order = line ? store.get('Orders', line.order_id) : null;
    var received = line ? _matReceivedForLine(store, line.id) : { good: 0, damaged: 0 };
    var open = _matNum(m.required_quantity) - _matNum(m.cancelled_quantity);
    var state = m.source === 'Stock' ? 'Stock' : m.source === 'AlreadyOrdered' ? 'VerifyExternalOrder' : !order || order.status === 'Cancelled' ? 'ToOrder' : order.status === 'Received' ? 'Received' : order.status === 'PartReceived' ? 'PartReceived' : order.status === 'Confirmed' ? 'Confirmed' : order.status === 'Requested' ? 'AwaitingConfirmation' : 'Drafted';
    return { material_id: m.id, product_id: m.product_id, product_name: product ? product.name : null, description: m.description, quantity: open, unit: m.unit, source: m.source, work_type: _matWorkType(store, m.work_package_id), merchant_id: m.merchant_id, merchant: merchant ? merchant.name : null, need_by_date: _matDate(m.need_by_date), order_id: order ? order.id : null, order_line_id: line ? line.id : null, order_status: order ? order.status : null, received_good: received.good, received_damaged: received.damaged, state: state, lead_time_risk: m.source === 'ToOrder' && !order ? _matLeadRisk(store, _matDate(m.need_by_date), merchant, today) : null };
  });
  return { found: true, job_id: jobId, count: items.length, items: items, to_order: items.filter(function (i) { return i.state === 'ToOrder'; }).length };
}

/* --- 2. BUILD ORDERS (separate per merchant + work type) --- */

function _matBuildOrders(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  var job = _matJob(store, input.job_id);
  var pending = store.list('Materials').filter(function (m) { return m.job_id === job.id && m.source === 'ToOrder' && !m.order_line_id && _matNum(m.required_quantity) - _matNum(m.cancelled_quantity) > 0; });
  /* Command identity is the job + command_id; the material set is derived state and must not break replay detection. */
  var cmd = _matCommandStart(store, input, 'Jobs', job.id, { action: 'BuildOrders', job_id: job.id });
  if (cmd.replay) return { replay: true, orders: [] };
  var now = _matNow(input), today = _matDate(now), groups = {}, orders = [];
  pending.forEach(function (m) {
    if (!m.merchant_id) _matRefuse('MAT_REVIEW: material ' + m.id + ' has no merchant');
    var key = m.merchant_id + '|' + _matWorkType(store, m.work_package_id);
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });
  Object.keys(groups).sort().forEach(function (key) {
    var parts = key.split('|'), merchant = _matMerchant(store, parts[0]), workType = parts[1], items = groups[key];
    var base = 'ORD-' + job.id + '-' + merchant.id + '-' + workType, orderId = base, n = 1, order = store.get('Orders', orderId);
    while (order && ['Draft', 'Review'].indexOf(order.status) === -1) { n++; orderId = base + '-' + n; order = store.get('Orders', orderId); }
    var needBy = items.map(function (m) { return _matDate(m.need_by_date); }).sort()[0];
    var created = false;
    if (!order) {
      order = { id: orderId, job_id: job.id, merchant_id: merchant.id, work_type: workType, requested_delivery_date: needBy, delivery_location_id: MAT_LOC.store, delivery_address: null, status: 'Draft', revision: 1, supplier_reference: null, sent_message_id: null, confirmed_revision: null, confirmed_at: null, confirmed_by: null, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: MAT_SERVICE, commit_id: 'MAT-' + input.command_id };
      store.insert('Orders', order); created = true;
    } else if (_matDate(order.requested_delivery_date) > needBy) {
      order = _matPatch(store, 'Orders', order, { requested_delivery_date: needBy }, input, now);
    }
    var existingLines = store.list('OrderLines').filter(function (l) { return l.order_id === orderId; }).length, added = [];
    items.forEach(function (m, i) {
      var lineId = 'OL-' + orderId + '-' + (existingLines + i + 1);
      var product = m.product_id ? store.get('Products', m.product_id) : null;
      store.insert('OrderLines', { id: lineId, order_id: orderId, material_id: m.id, product_id: m.product_id || null, description_snapshot: m.description || (product ? product.name + ' (' + product.sku + ')' : 'Material'), quantity: _matNum(m.required_quantity) - _matNum(m.cancelled_quantity), unit: m.unit, unit_net_cost_pence: product && product.unit_cost_pence !== null && product.unit_cost_pence !== undefined ? product.unit_cost_pence : null, vat_code: null, cancelled_quantity: 0, created_at: now, commit_id: 'MAT-' + input.command_id });
      store.update('Materials', m.id, { order_line_id: lineId, updated_at: now, updated_by: input.actor, version: Number(m.version || 0) + 1 });
      added.push(lineId);
    });
    var risk = _matLeadRisk(store, needBy, merchant, today);
    var task = _matTask(store, 'MAT01', job.id, 'Orders', orderId, 'MAT01-' + orderId, _matDayStart(store, risk.at_risk ? _matSameOrNextStaffed(store, today) : risk.latest_order_date), input, now, merchant.name + ' ' + workType + (risk.at_risk ? ' — LEAD-TIME RISK' : ''));
    _matAudit(store, 'Orders', orderId, created ? 'BuildOrder' : 'AppendOrderLines', null, store.get('Orders', orderId), input, now);
    orders.push({ order_id: orderId, merchant_id: merchant.id, merchant: merchant.name, work_type: workType, created: created, lines_added: added, requested_delivery_date: needBy, lead_time_risk: risk, task: task });
  });
  _matCommit(store, input, now);
  return { replay: false, orders: orders, pending_materials: pending.length, external_calls: 0 };
}

/* --- 3. SEND ORDER (immutable snapshot; captured, not sent) --- */

function _matOrder(store, orderId) { var o = store.get('Orders', orderId); if (!o) _matRefuse('MAT_REVIEW: order not found'); return o; }

function _matSendOrder(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  var order = _matOrder(store, input.order_id), job = _matJob(store, order.job_id), merchant = _matMerchant(store, order.merchant_id);
  var cmd = _matCommandStart(store, input, 'Orders', order.id, { action: 'Send', revision: order.revision, urgent: input.urgent === true });
  if (cmd.replay) return { replay: true, status: order.status, order: order };
  if (['Draft', 'Review', 'Requested'].indexOf(order.status) === -1) _matRefuse('MAT_REVIEW: cannot send from ' + order.status);
  if (!store.list('OrderLines').some(function (l) { return l.order_id === order.id && _matNum(l.quantity) - _matNum(l.cancelled_quantity) > 0; })) _matRefuse('MAT_REVIEW: order has no open lines');
  _matExpect(order, input);
  var now = _matNow(input), today = _matDate(now);
  var after = _matPatch(store, 'Orders', order, { status: 'Requested' }, input, now);
  var commId = 'COMM-MAT-' + order.id + '-MerchantOrder-R' + order.revision;
  var comm = _matCommunication(store, commId, job.id, merchant.id, 'MerchantOrder', 'Purchase order ' + order.id + ' rev ' + order.revision + ' — ' + job.display_name + ' (' + order.work_type + ')', _matOrderSnapshot(store, after), order.revision, input, now, { delivery_date: _matDate(order.requested_delivery_date) });
  _matCommJob(store, commId, job.id, order.id, order.revision, input, now);
  var completed = _matCompleteTasks(store, 'Orders', order.id, ['MAT01'], input, now, 'Order snapshot rev ' + order.revision + ' captured (send adapter not enabled)');
  var due = input.urgent === true ? _matDayEnd(store, _matSameOrNextStaffed(store, today)) : _matDayStart(store, _matNextStaffed(store, today));
  var task = _matTask(store, 'MAT06', job.id, 'Orders', order.id, 'MAT06-' + order.id + '-R' + order.revision, due, input, now, merchant.name + ' rev ' + order.revision + (input.urgent === true ? ' — URGENT' : ''));
  _matAudit(store, 'Orders', order.id, 'Send', order, after, input, now);
  _matCommit(store, input, now);
  return { replay: false, status: after.status, order: after, communication: comm, completed_tasks: completed, task: task, sent: false, external_calls: 0 };
}

/* --- 4. CONFIRM ORDER (merchant acknowledged latest revision) --- */

function _matConfirmOrder(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  var order = _matOrder(store, input.order_id), job = _matJob(store, order.job_id), merchant = _matMerchant(store, order.merchant_id);
  if (!_matText(input.supplier_reference)) _matRefuse('MAT_REVIEW: supplier_reference required');
  var confirmedDate = _matDate(input.confirmed_delivery_date) || _matDate(order.requested_delivery_date);
  var cmd = _matCommandStart(store, input, 'Orders', order.id, { action: 'Confirm', revision: order.revision, supplier_reference: input.supplier_reference.trim(), delivery_date: confirmedDate });
  if (cmd.replay) return { replay: true, status: order.status, order: order };
  if (order.status !== 'Requested') _matRefuse('MAT_REVIEW: only a Requested order can be confirmed (status ' + order.status + ')');
  _matExpect(order, input);
  var now = _matNow(input);
  var after = _matPatch(store, 'Orders', order, { status: 'Confirmed', supplier_reference: input.supplier_reference.trim(), confirmed_revision: order.revision, confirmed_at: now, confirmed_by: input.actor, requested_delivery_date: confirmedDate }, input, now);
  var commId = 'COMM-MAT-' + order.id + '-MerchantOrder-R' + order.revision;
  if (!store.get('Communications', commId)) { _matCommunication(store, commId, job.id, merchant.id, 'MerchantOrder', 'Purchase order ' + order.id + ' rev ' + order.revision, _matOrderSnapshot(store, order), order.revision, input, now, { delivery_date: confirmedDate }); _matCommJob(store, commId, job.id, order.id, order.revision, input, now); }
  var ackId = 'ACK-MAT-' + order.id + '-R' + order.revision;
  if (!store.get('Acknowledgements', ackId)) store.insert('Acknowledgements', { id: ackId, communication_id: commId, company_id: merchant.id, entity_id: order.id, acknowledged_revision: order.revision, response: 'Confirmed', response_text: input.response_text || ('Supplier reference ' + input.supplier_reference.trim()), received_at: input.received_at ? _matTimestamp(input.received_at) : now, recorded_by: input.actor, evidence_id: input.evidence_id || null, created_at: now, commit_id: 'MAT-' + input.command_id });
  var completed = _matCompleteTasks(store, 'Orders', order.id, ['MAT06', 'MAT01'], input, now, 'Confirmed rev ' + order.revision + ' ref ' + input.supplier_reference.trim());
  var deliveryId = 'DEL-' + order.id + '-R' + order.revision;
  var delivery = store.get('Deliveries', deliveryId);
  if (!delivery) { delivery = { id: deliveryId, order_id: order.id, expected_date: confirmedDate, actual_received_at: null, received_by: null, delivery_note_reference: null, receipt_status: 'Expected', discrepancy_note: null, created_at: now, commit_id: 'MAT-' + input.command_id }; store.insert('Deliveries', delivery); }
  var task = _matTask(store, 'MAT04', job.id, 'Deliveries', deliveryId, 'MAT04-' + deliveryId, _matDayEnd(store, confirmedDate), input, now, merchant.name + ' expected ' + confirmedDate);
  _matAudit(store, 'Orders', order.id, 'Confirm', order, after, input, now);
  _matCommit(store, input, now);
  return { replay: false, status: after.status, order: after, delivery: delivery, acknowledgement_id: ackId, completed_tasks: completed, task: task, external_calls: 0 };
}

/* --- 5. REVISE ORDER (new revision → re-confirmation; urgent when inside lead time) --- */

function _matReviseOrder(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  var order = _matOrder(store, input.order_id), job = _matJob(store, order.job_id), merchant = _matMerchant(store, order.merchant_id);
  if (!_matText(input.reason)) _matRefuse('MAT_REVIEW: reason required');
  var newDate = _matDate(input.requested_delivery_date), lineChanges = Array.isArray(input.lines) ? input.lines : [];
  if (!newDate && !lineChanges.length) _matRefuse('MAT_REVIEW: requested_delivery_date or lines required');
  var changes = { action: 'Revise', requested_delivery_date: newDate, lines: lineChanges.map(function (l) { return { order_line_id: l.order_line_id, quantity: l.quantity === undefined ? null : Number(l.quantity), cancelled_quantity: l.cancelled_quantity === undefined ? null : Number(l.cancelled_quantity) }; }), reason: input.reason };
  var cmd = _matCommandStart(store, input, 'Orders', order.id, changes);
  if (cmd.replay) return { replay: true, status: order.status, order: order };
  if (['Draft', 'Review', 'Requested', 'Confirmed'].indexOf(order.status) === -1) _matRefuse('MAT_REVIEW: cannot revise from ' + order.status);
  _matExpect(order, input);
  var now = _matNow(input), today = _matDate(now), revision = Number(order.revision) + 1;
  changes.lines.forEach(function (l) {
    var line = store.get('OrderLines', l.order_line_id);
    if (!line || line.order_id !== order.id) _matRefuse('MAT_REVIEW: order line linkage invalid');
    var received = _matReceivedForLine(store, line.id), patch = {};
    if (l.quantity !== null) { if (!(l.quantity >= received.good + received.damaged)) _matRefuse('MAT_REVIEW: quantity below received for ' + line.id); patch.quantity = l.quantity; }
    if (l.cancelled_quantity !== null) { if (l.cancelled_quantity < 0 || l.cancelled_quantity > (l.quantity !== null ? l.quantity : _matNum(line.quantity)) - received.good - received.damaged) _matRefuse('MAT_REVIEW: cancelled_quantity invalid for ' + line.id); patch.cancelled_quantity = l.cancelled_quantity; }
    store.update('OrderLines', line.id, patch);
    if (line.material_id) { var m = store.get('Materials', line.material_id); if (m) store.update('Materials', m.id, { cancelled_quantity: patch.cancelled_quantity !== undefined ? patch.cancelled_quantity : m.cancelled_quantity, required_quantity: patch.quantity !== undefined ? patch.quantity : m.required_quantity, revision: Number(m.revision || 0) + 1, updated_at: now, updated_by: input.actor, version: Number(m.version || 0) + 1 }); }
  });
  var wasSent = ['Requested', 'Confirmed'].indexOf(order.status) !== -1;
  var patchOrder = { revision: revision };
  if (newDate) patchOrder.requested_delivery_date = newDate;
  if (wasSent) patchOrder.status = 'Requested';
  var after = _matPatch(store, 'Orders', order, patchOrder, input, now);
  var comm = null, task = null, urgent = false;
  if (wasSent) {
    var commId = 'COMM-MAT-' + order.id + '-MerchantOrder-R' + revision;
    comm = _matCommunication(store, commId, job.id, merchant.id, 'MerchantOrder', 'Purchase order ' + order.id + ' rev ' + revision + ' (AMENDED) — ' + job.display_name, Object.assign(_matOrderSnapshot(store, after), { amendment_reason: input.reason, supersedes_revision: order.revision }), revision, input, now, { delivery_date: _matDate(after.requested_delivery_date) });
    _matCommJob(store, commId, job.id, order.id, revision, input, now);
    var risk = _matLeadRisk(store, _matDate(after.requested_delivery_date), merchant, today);
    urgent = input.urgent === true || risk.at_risk;
    task = _matTask(store, 'MAT06', job.id, 'Orders', order.id, 'MAT06-' + order.id + '-R' + revision, urgent ? _matDayEnd(store, _matSameOrNextStaffed(store, today)) : _matDayStart(store, _matNextStaffed(store, today)), input, now, merchant.name + ' rev ' + revision + (urgent ? ' — URGENT amendment' : ' — amendment'));
    store.list('Deliveries').forEach(function (d) { if (d.order_id === order.id && !d.actual_received_at && newDate) { store.update('Deliveries', d.id, { expected_date: newDate }); store.list('Tasks').forEach(function (t) { if (t.related_entity_type === 'Deliveries' && t.related_entity_id === d.id && t.status === 'Open') store.update('Tasks', t.id, { due_at: _matDayEnd(store, newDate), updated_at: now, updated_by: input.actor, version: Number(t.version || 0) + 1 }); }); } });
  }
  _matAudit(store, 'Orders', order.id, 'Revise', order, after, input, now);
  _matCommit(store, input, now);
  return { replay: false, status: after.status, order: after, revision: revision, acknowledgement_required: wasSent, urgent: urgent, communication: comm, task: task, external_calls: 0 };
}

/* --- 6. CANCEL ORDER --- */

function _matCancelOrder(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  var order = _matOrder(store, input.order_id), job = store.get('Jobs', order.job_id), merchant = store.get('Companies', order.merchant_id);
  if (!_matText(input.reason)) _matRefuse('MAT_REVIEW: reason required');
  var cmd = _matCommandStart(store, input, 'Orders', order.id, { action: 'Cancel', reason: input.reason });
  if (cmd.replay) return { replay: true, status: order.status, order: order };
  if (order.status === 'Cancelled') _matRefuse('MAT_REVIEW: already cancelled');
  if (['PartReceived', 'Received'].indexOf(order.status) !== -1) _matRefuse('MAT_REFUSED: goods received; use return/credit review instead of cancel');
  _matExpect(order, input);
  var now = _matNow(input), revision = Number(order.revision) + 1, wasSent = ['Requested', 'Confirmed'].indexOf(order.status) !== -1;
  var after = _matPatch(store, 'Orders', order, { status: 'Cancelled', revision: revision }, input, now);
  store.list('OrderLines').forEach(function (l) { if (l.order_id === order.id) { store.update('OrderLines', l.id, { cancelled_quantity: _matNum(l.quantity) }); if (l.material_id) { var m = store.get('Materials', l.material_id); if (m) store.update('Materials', m.id, { order_line_id: null, revision: Number(m.revision || 0) + 1, updated_at: now, updated_by: input.actor, version: Number(m.version || 0) + 1 }); } } });
  store.list('Deliveries').forEach(function (d) { if (d.order_id === order.id && !d.actual_received_at) store.update('Deliveries', d.id, { receipt_status: 'Cancelled' }); });
  var cancelled = _matCancelTasks(store, 'Orders', order.id, input, now);
  store.list('Deliveries').forEach(function (d) { if (d.order_id === order.id) cancelled = cancelled.concat(_matCancelTasks(store, 'Deliveries', d.id, input, now)); });
  var comm = null, task = null;
  if (wasSent && merchant) {
    var commId = 'COMM-MAT-' + order.id + '-MerchantOrderCancellation-R' + revision;
    comm = _matCommunication(store, commId, order.job_id, merchant.id, 'MerchantOrderCancellation', 'Cancel purchase order ' + order.id + ' (rev ' + revision + ')', Object.assign(_matOrderSnapshot(store, after), { cancellation_reason: input.reason }), revision, input, now);
    _matCommJob(store, commId, order.job_id, order.id, revision, input, now);
    task = _matTask(store, 'MAT06', order.job_id, 'Orders', order.id, 'MAT06-' + order.id + '-R' + revision, _matDayEnd(store, _matSameOrNextStaffed(store, _matDate(now))), input, now, (merchant.name) + ' cancellation acknowledgement');
  }
  _matAudit(store, 'Orders', order.id, 'Cancel', order, after, input, now);
  _matCommit(store, input, now);
  return { replay: false, status: 'Cancelled', order: after, cancelled_tasks: cancelled, communication: comm, task: task, acknowledgement_required: wasSent, materials_released: true, external_calls: 0 };
}

/* --- 7. RECEIVE DELIVERY (good → store, damaged → quarantine; short/damaged → separate action; replay-safe) --- */

function _matReceiveDelivery(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03'); _matRequirePilot(store, 'FN-05');
  var delivery = store.get('Deliveries', input.delivery_id); if (!delivery) _matRefuse('MAT_REVIEW: delivery not found');
  var order = _matOrder(store, delivery.order_id), job = _matJob(store, order.job_id), merchant = store.get('Companies', order.merchant_id);
  if (!_matText(input.received_by)) _matRefuse('MAT_REVIEW: received_by required');
  if (!_matText(input.delivery_note_reference)) _matRefuse('MAT_REVIEW: delivery_note_reference required');
  var lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) _matRefuse('MAT_REVIEW: at least one receipt line required');
  /* good → store stock; damaged → quarantine; short = quantity the merchant failed to supply on this note (raises a separate action). Anything else outstanding is a balance to follow. */
  var norm = lines.map(function (l) { var g = Number(l.quantity_good || 0), d = Number(l.quantity_damaged || 0), sh = Number(l.quantity_short || 0); if (!(g >= 0) || !(d >= 0) || !(sh >= 0) || g + d + sh === 0) _matRefuse('MAT_REVIEW: receipt quantities must be >= 0 and not all zero'); return { order_line_id: l.order_line_id, quantity_good: g, quantity_damaged: d, quantity_short: sh, evidence_id: l.evidence_id || null }; });
  var changes = { action: 'Receive', delivery_id: delivery.id, delivery_note_reference: input.delivery_note_reference.trim(), lines: norm };
  var cmd = _matCommandStart(store, input, 'Deliveries', delivery.id, changes);
  if (cmd.replay) return { replay: true, delivery: delivery, order: order };
  if (delivery.actual_received_at) _matRefuse('MAT_REVIEW: delivery already received; record a further delivery instead');
  if (['Confirmed', 'PartReceived', 'Requested'].indexOf(order.status) === -1) _matRefuse('MAT_REVIEW: order status ' + order.status + ' cannot receive');
  var now = _matNow(input), receiptLines = [], movements = [], issues = [], short = [];
  var evidenceId = input.evidence_id || null;
  if (!evidenceId && _matText(input.delivery_note_file_id)) {
    evidenceId = 'EV-' + delivery.id;
    if (!store.get('Evidence', evidenceId)) store.insert('Evidence', { id: evidenceId, job_id: job.id, submission_id: null, issue_id: null, category: 'DeliveryNote', drive_file_id: input.delivery_note_file_id.trim(), filename: input.delivery_note_filename || ('delivery-note-' + delivery.id), mime_type: null, upload_status: 'Referenced', captured_at: now, captured_by: input.received_by, received_at: now, customer_shareable: false, version: 1, checksum: null, created_at: now, commit_id: 'MAT-' + input.command_id });
  }
  norm.forEach(function (l) {
    var line = store.get('OrderLines', l.order_line_id);
    if (!line || line.order_id !== order.id) _matRefuse('MAT_REVIEW: order line linkage invalid: ' + l.order_line_id);
    var already = _matReceivedForLine(store, line.id), open = _matNum(line.quantity) - _matNum(line.cancelled_quantity) - already.good - already.damaged;
    if (l.quantity_good + l.quantity_damaged + l.quantity_short > open) _matRefuse('MAT_REVIEW: receipt exceeds outstanding quantity for ' + line.id);
    var rlId = 'RL-' + delivery.id + '-' + line.id;
    var product = line.product_id ? store.get('Products', line.product_id) : null, movIds = [];
    if (product && _matIsTrue(product.stock_tracked)) {
      [['GOOD', l.quantity_good, MAT_LOC.store], ['DMG', l.quantity_damaged, MAT_LOC.quarantine]].forEach(function (spec) {
        if (!(spec[1] > 0)) return;
        var key = 'MOV-RCPT-' + rlId + '-' + spec[0];
        if (store.list('StockMovements').some(function (m) { return m.idempotency_key === key; })) return;
        var movId = 'SM-' + key;
        store.insert('StockMovements', { id: movId, product_id: product.id, quantity: spec[1], from_location_id: MAT_LOC.supplier, to_location_id: spec[2], movement_type: spec[0] === 'GOOD' ? 'Receipt' : 'Damage', job_id: job.id, receipt_line_id: rlId, reason: (spec[0] === 'GOOD' ? 'Receipt ' : 'Damaged on receipt ') + input.delivery_note_reference.trim(), evidence_id: l.evidence_id || evidenceId, approval_id: null, movement_at: now, idempotency_key: key, created_at: now, commit_id: 'MAT-' + input.command_id });
        movIds.push(movId); movements.push({ movement_id: movId, product_id: product.id, quantity: spec[1], to: spec[2] });
      });
    }
    store.insert('ReceiptLines', { id: rlId, delivery_id: delivery.id, order_line_id: line.id, quantity_good: l.quantity_good, quantity_damaged: l.quantity_damaged, evidence_id: l.evidence_id || evidenceId, stock_movement_ids: movIds.length ? JSON.stringify(movIds) : null, created_at: now, commit_id: 'MAT-' + input.command_id });
    receiptLines.push(rlId);
    if (l.quantity_short > 0) short.push({ order_line_id: line.id, short_by: l.quantity_short });
    if (l.quantity_damaged > 0) issues.push({ line: line, kind: 'DamagedGoods', quantity: l.quantity_damaged });
  });
  var allLines = store.list('OrderLines').filter(function (l) { return l.order_id === order.id; });
  var complete = allLines.every(function (l) { var r = _matReceivedForLine(store, l.id); return r.good + r.damaged >= _matNum(l.quantity) - _matNum(l.cancelled_quantity); });
  if (short.length) short.forEach(function (s) { issues.push({ line: store.get('OrderLines', s.order_line_id), kind: 'ShortDelivery', quantity: s.short_by }); });
  var issueIds = [];
  issues.forEach(function (it) {
    var issueId = 'ISS-MAT-' + input.command_id + '-' + it.kind + '-' + it.line.id;
    if (store.get('Issues', issueId)) { issueIds.push(issueId); return; }
    store.insert('Issues', { id: issueId, job_id: job.id, work_package_id: null, type: 'Supply', category: it.kind, description: it.kind + ': ' + it.quantity + ' ' + (it.line.unit || '') + ' of ' + it.line.description_snapshot + ' on delivery ' + input.delivery_note_reference.trim(), raised_at: now, raised_by: input.actor, responsible_person_id: null, responsible_company_id: order.merchant_id, office_owner_id: _matOwner(store, 'Office').id, severity: 'Normal', status: 'Open', due_at: _matDayStart(store, _matNextStaffed(store, _matDate(now))), next_followup_at: null, blocks_completion: false, blocks_strip: false, estimated_value_pence: null, approved_value_pence: null, approval_status: 'NotRequired', approved_at: null, approved_by: null, resolution: null, resolved_at: null, closed_at: null, closed_by: null, customer_resolution_confirmed: null, linked_return_package_id: null, evidence_folder_id: null, created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: MAT_SERVICE, commit_id: 'MAT-' + input.command_id });
    issueIds.push(issueId);
  });
  var status = issues.length ? 'Discrepancy' : (complete ? 'Received' : 'Partial');
  store.update('Deliveries', delivery.id, { actual_received_at: now, received_by: input.received_by.trim(), delivery_note_reference: input.delivery_note_reference.trim(), receipt_status: status, discrepancy_note: issues.length ? (input.discrepancy_note || issues.map(function (i) { return i.kind + ' ' + i.quantity + ' on ' + i.line.id; }).join('; ')) : (input.discrepancy_note || null) });
  var after = _matPatch(store, 'Orders', order, { status: complete ? 'Received' : 'PartReceived' }, input, now);
  var completed = _matCompleteTasks(store, 'Deliveries', delivery.id, ['MAT04'], input, now, 'Received ' + input.delivery_note_reference.trim() + (issues.length ? ' with discrepancies (see issues)' : ''));
  var followUp = null, nextId = null;
  if (!complete) { nextId = 'DEL-' + order.id + '-R' + order.revision + '-' + (store.list('Deliveries').filter(function (d) { return d.order_id === order.id; }).length + 1); store.insert('Deliveries', { id: nextId, order_id: order.id, expected_date: _matDate(order.requested_delivery_date), actual_received_at: null, received_by: null, delivery_note_reference: null, receipt_status: 'Expected', discrepancy_note: 'Balance of order outstanding', created_at: now, commit_id: 'MAT-' + input.command_id }); followUp = _matTask(store, 'MAT04', job.id, 'Deliveries', nextId, 'MAT04-' + nextId, _matDayEnd(store, _matNextStaffed(store, _matDate(now))), input, now, 'balance of ' + order.id); }
  _matAudit(store, 'Deliveries', delivery.id, 'Receive', delivery, store.get('Deliveries', delivery.id), input, now);
  _matCommit(store, input, now);
  return { replay: false, delivery: store.get('Deliveries', delivery.id), order: after, receipt_lines: receiptLines, stock_movements: movements, issues: issueIds, short: short, complete: complete, completed_tasks: completed, follow_up_delivery_id: nextId, follow_up_task: followUp, evidence_id: evidenceId, external_calls: 0 };
}

/* --- 8. FRIDAY MERCHANT LIST (MAT05; next week's deliveries per merchant; captured; MAT06 acknowledgement) --- */

function _matWeeklyList(store, input) {
  _matGuardStore(store); _matRequirePilot(store, 'FN-03');
  if (!_matText(input.command_id) || !_matText(input.actor)) _matRefuse('MAT_REVIEW: command_id and actor required');
  var now = _matNow(input), listDate = _matDate(input.list_date) || _matDate(now);
  var weekStart = _matAddDays(_matMonday(listDate), 7), weekEnd = _matAddDays(weekStart, 6), byMerchant = {};
  store.list('Deliveries').forEach(function (d) {
    if (d.actual_received_at || d.receipt_status === 'Cancelled') return;
    var exp = _matDate(d.expected_date); if (!exp || exp < weekStart || exp > weekEnd) return;
    var order = store.get('Orders', d.order_id); if (!order || ['Requested', 'Confirmed', 'PartReceived'].indexOf(order.status) === -1) return;
    var job = store.get('Jobs', order.job_id); if (!job || !_matIsTrue(job.pilot_job) || job.cancellation_at) return;
    var customer = store.get('Customers', job.customer_id);
    var item = { delivery_id: d.id, order_id: order.id, revision: order.revision, acknowledged: order.confirmed_revision === order.revision, job_id: job.id, job_reference: job.job_id, customer_display: job.display_name, postcode: customer ? customer.postcode : null, work_type: order.work_type, delivery_date: exp, supplier_reference: order.supplier_reference || null, lines: store.list('OrderLines').filter(function (l) { return l.order_id === order.id; }).length };
    if (!byMerchant[order.merchant_id]) byMerchant[order.merchant_id] = [];
    byMerchant[order.merchant_id].push(item);
  });
  var lists = [];
  Object.keys(byMerchant).sort().forEach(function (merchantId) {
    var merchant = store.get('Companies', merchantId); if (!merchant) return;
    var items = byMerchant[merchantId].sort(function (a, b) { return a.delivery_date.localeCompare(b.delivery_date) || a.order_id.localeCompare(b.order_id); });
    var id = 'COMM-MAT-WEEKLY-' + merchantId + '-' + weekStart, existing = store.get('Communications', id);
    var thursday = items.map(function (i) { return i.delivery_date; }).sort()[0];
    if (!existing) {
      _matCommunication(store, id, null, merchantId, 'MerchantDeliveryList', 'Expected deliveries w/c ' + weekStart + ' — ' + merchant.name, { week_start: weekStart, week_end: weekEnd, list_date: listDate, items: items, note: 'CAPTURED DRAFT — not sent. FN-03 R2.' }, 1, input, now, { covered_week_start: weekStart, delivery_date: thursday });
      items.forEach(function (it) { _matCommJob(store, id, it.job_id, it.order_id, it.revision, input, now); });
    }
    var friday = _matAddDays(weekStart, -3);
    var task5 = _matTask(store, 'MAT05', null, 'Communications', id, 'MAT05-' + merchantId + '-' + weekStart, _matLondonInstant(friday, '12:00'), input, now, merchant.name + ' w/c ' + weekStart);
    var task6 = _matTask(store, 'MAT06', null, 'Communications', id, 'MAT06-LIST-' + merchantId + '-' + weekStart, _matDayStart(store, _matNextStaffed(store, friday)), input, now, merchant.name + ' list acknowledgement w/c ' + weekStart);
    lists.push({ merchant_id: merchantId, merchant: merchant.name, communication_id: id, created: !existing, items: items.length, unacknowledged: items.filter(function (i) { return !i.acknowledged; }).length, tasks: [task5, task6] });
  });
  return { list_date: listDate, week_start: weekStart, week_end: weekEnd, lists: lists, external_calls: 0 };
}

/* --- 9. READ MODELS --- */

function _matOrderView(store, orderId) {
  _matGuardStore(store);
  var o = store.get('Orders', orderId); if (!o) return { found: false, order_id: orderId };
  var job = store.get('Jobs', o.job_id), merchant = store.get('Companies', o.merchant_id);
  var lines = store.list('OrderLines').filter(function (l) { return l.order_id === o.id; }).map(function (l) { var r = _matReceivedForLine(store, l.id); return { id: l.id, material_id: l.material_id, product_id: l.product_id, description: l.description_snapshot, quantity: _matNum(l.quantity), cancelled_quantity: _matNum(l.cancelled_quantity), unit: l.unit, received_good: r.good, received_damaged: r.damaged, outstanding: _matNum(l.quantity) - _matNum(l.cancelled_quantity) - r.good - r.damaged }; });
  var deliveries = store.list('Deliveries').filter(function (d) { return d.order_id === o.id; }).map(function (d) { return { id: d.id, expected_date: _matDate(d.expected_date), actual_received_at: _matTimestamp(d.actual_received_at), receipt_status: d.receipt_status, delivery_note_reference: d.delivery_note_reference, discrepancy_note: d.discrepancy_note }; });
  var comms = store.list('Communications').filter(function (c) { return store.list('CommunicationJobs').some(function (j) { return j.communication_id === c.id && j.order_id === o.id; }); }).map(function (c) { return { id: c.id, type: c.type, revision: c.revision, status: c.status, subject: c.subject }; });
  var acks = store.list('Acknowledgements').filter(function (a) { return a.entity_id === o.id; }).map(function (a) { return { id: a.id, acknowledged_revision: a.acknowledged_revision, response: a.response, received_at: a.received_at }; });
  var tasks = store.list('Tasks').filter(function (t) { return (t.related_entity_type === 'Orders' && t.related_entity_id === o.id) || (t.related_entity_type === 'Deliveries' && deliveries.some(function (d) { return d.id === t.related_entity_id; })); }).map(function (t) { return { id: t.id, template_code: t.template_code, title: t.title, status: t.status, due_at: t.due_at, owner_id: t.owner_id }; });
  var issues = store.list('Issues').filter(function (i) { return i.job_id === o.job_id && i.responsible_company_id === o.merchant_id && i.type === 'Supply'; }).map(function (i) { return { id: i.id, category: i.category, status: i.status }; });
  return { found: true, order: o, job: job ? { id: job.id, job_reference: job.job_id, display_name: job.display_name } : null, merchant: merchant ? { id: merchant.id, name: merchant.name, standard_lead_days: merchant.standard_lead_days, delivery_weekday: merchant.delivery_weekday, contacts: _matContacts(store, merchant.id) } : null, acknowledgement_required: ['Requested', 'Confirmed', 'PartReceived'].indexOf(o.status) !== -1 && Number(o.confirmed_revision || 0) < Number(o.revision), lines: lines, deliveries: deliveries, communications: comms, acknowledgements: acks, tasks: tasks, issues: issues };
}
function _matStoreQueue(store, input) {
  _matGuardStore(store);
  input = input || {};
  var from = _matDate(input.from) || _matDate(new Date().toISOString()), to = _matDate(input.to) || _matAddDays(from, 14);
  var deliveries = store.list('Deliveries').filter(function (d) { var e = _matDate(d.expected_date); return !d.actual_received_at && d.receipt_status !== 'Cancelled' && e && e >= from && e <= to; }).map(function (d) { var o = store.get('Orders', d.order_id) || {}; var m = o.merchant_id ? store.get('Companies', o.merchant_id) : null; return { delivery_id: d.id, order_id: d.order_id, expected_date: _matDate(d.expected_date), merchant: m ? m.name : null, work_type: o.work_type, job_id: o.job_id, order_status: o.status, supplier_reference: o.supplier_reference || null }; }).sort(function (a, b) { return a.expected_date.localeCompare(b.expected_date); });
  var picks = store.list('Tasks').filter(function (t) { return ['MAT03', 'MAT04'].indexOf(t.template_code) !== -1 && ['Open', 'InProgress', 'Waiting', 'Blocked'].indexOf(t.status) !== -1; }).map(function (t) { return { task_id: t.id, template_code: t.template_code, title: t.title, due_at: _matTimestamp(t.due_at), related_entity_id: t.related_entity_id, job_id: t.job_id }; });
  return { from: from, to: to, expected_deliveries: deliveries, open_store_tasks: picks };
}

if (typeof module !== 'undefined') {
  module.exports = {
    MAT_DEV_SHEET_ID, MAT_SOURCES, MAT_WORK_TYPES, MAT_ORDER_STATUSES, MAT_LOC, MAT_TEMPLATES,
    _matAddRequirement, _matRequirements, _matBuildOrders, _matSendOrder, _matConfirmOrder, _matReviseOrder, _matCancelOrder, _matReceiveDelivery, _matWeeklyList, _matOrderView, _matStoreQueue,
    _matDeliveryDate, _matListDateFor, _matLeadRisk, _matMonday, _matLondonInstant, _matDate, _matGuardStore, _matReceivedForLine
  };
}
