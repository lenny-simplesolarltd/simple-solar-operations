/* Materials workflow tests — local only. No sends, no external calls. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const mat = require('../materials/workflow.js');
const copy = x => structuredClone(x);
const T0 = '2026-09-14T09:00:00.000Z'; /* Monday 14 Sep 2026 */
const ACTOR = 'PERSON-tanya';
const JOB = 'J-mat';

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  let held = false;
  const s = {
    tables,
    getSheetId: () => mat.MAT_DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []),
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
    withLock(fn) { assert.equal(held, false, 'lock contention'); held = true; try { return fn(); } finally { held = false; } }
  };
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  s.update('ReleaseModes', 'RM-FN03', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  s.update('ReleaseModes', 'RM-FN05', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  for (const r of seed.Settings) s.insert('Settings', { ...r, created_at: T0, commit_id: 'seed' });
  for (const r of seed.TaskTemplates) s.insert('TaskTemplates', { ...r, ...meta });
  for (const r of seed.Companies) s.insert('Companies', { ...r, ...meta, source_system: 'seed' });
  for (const r of seed.Contacts) s.insert('Contacts', { ...r, ...meta, source_system: 'seed' });
  for (const r of seed.Products) s.insert('Products', { ...r, ...meta, source_system: 'seed' });
  for (const r of seed.StockLocations) s.insert('StockLocations', { ...r, ...meta });
  for (const r of seed.People) s.insert('People', { ...r, ...meta, source_system: 'seed', source_record_id: null });
  s.insert('Customers', { id: 'CUST-mat', first_name: 'Synthetic', last_name: 'Customer', address_line1: '1 Test Way', address_line2: null, town: 'Plymouth', postcode: 'PL1 1AA', email: null, phone: null, alternate_contact: null, contact_notes: null, ...meta, source_system: 'seed', source_record_id: null });
  s.insert('Jobs', { id: JOB, job_id: 'SS-MAT-0001', customer_id: 'CUST-mat', display_name: 'MAT Synthetic', finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: true, scaffold_required: false, workflow_stage: 'Booked', handover_status: 'NotReady', financial_status: 'Pending', pilot_job: true, release_scope: 'R2', ...meta, source_system: 'MAT-fixture' });
  /* Roof Wed 4 Nov 2026 → delivery Thu 29 Oct → list Fri 23 Oct; Electrical Mon 16 Nov → delivery Thu 12 Nov → list Fri 6 Nov (spec example). */
  s.insert('WorkPackages', { id: 'WP-roof', job_id: JOB, trade: 'Roof', required: true, planned_start: '2026-11-04', planned_end: '2026-11-05', actual_start: null, actual_end: null, status: 'Scheduled', need_by_date: null, completion_outcome: null, installer_confirmation_at: null, installer_confirmation_by: null, commissioning_required: true, sequence: 1, revision: 1, parent_package_id: null, ...meta, source_system: 'S11' });
  s.insert('WorkPackages', { id: 'WP-elec', job_id: JOB, trade: 'Electrical', required: true, planned_start: '2026-11-16', planned_end: '2026-11-16', actual_start: null, actual_end: null, status: 'Scheduled', need_by_date: null, completion_outcome: null, installer_confirmation_at: null, installer_confirmation_by: null, commissioning_required: true, sequence: 2, revision: 1, parent_package_id: null, ...meta, source_system: 'S11' });
  return s;
}
function add(s, cmd, extra) { return mat._matAddRequirement(s, { actor: ACTOR, command_id: cmd, job_id: JOB, expected_version: s.get('Jobs', JOB).version, at: T0, ...extra }); }
function panels(s) { return add(s, 'REQ-P460', { work_package_id: 'WP-roof', product_id: 'PROD-P460', required_quantity: 10, source: 'ToOrder' }); }
function cable(s) { return add(s, 'REQ-CABLE', { work_package_id: 'WP-elec', description: '6mm twin & earth', unit: 'Metre', required_quantity: 50, source: 'ToOrder', merchant_id: 'COMP-cef' }); }
function build(s, cmd = 'BUILD-1') { return mat._matBuildOrders(s, { actor: ACTOR, command_id: cmd, job_id: JOB, at: T0 }); }
function order(s, id) { return s.get('Orders', id); }
function tasks(s, type, id) { return s.tables.Tasks.filter(t => t.related_entity_type === type && t.related_entity_id === id).map(t => t.template_code + ':' + t.status).sort(); }
const ROOF = 'ORD-J-mat-COMP-greentech-Roof', ELEC = 'ORD-J-mat-COMP-cef-Electrical';
function toConfirmed(s) {
  panels(s); cable(s); build(s);
  let o = order(s, ROOF);
  mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-1', order_id: ROOF, expected_version: o.version, at: '2026-10-01T10:00:00.000Z' });
  o = order(s, ROOF);
  return mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-1', order_id: ROOF, supplier_reference: 'GT-12345', expected_version: o.version, at: '2026-10-02T10:00:00.000Z' });
}

test('MAT 01: delivery date is the merchant delivery weekday in the week before the work week; Friday list is the week before that', () => {
  const gt = { delivery_weekday: 4 };
  assert.equal(mat._matDeliveryDate('2026-11-04', gt), '2026-10-29');
  assert.equal(mat._matDeliveryDate('2026-11-16', gt), '2026-11-12');
  assert.equal(mat._matDeliveryDate('2026-11-08', gt), '2026-10-29', 'Sunday belongs to the week starting Monday 2 Nov');
  assert.equal(mat._matDeliveryDate('2026-11-04', { delivery_weekday: null }), '2026-10-29', 'default Thursday');
  assert.equal(mat._matDeliveryDate('2026-11-04', { delivery_weekday: 2 }), '2026-10-27');
  assert.equal(mat._matListDateFor('2026-10-29'), '2026-10-23');
  assert.equal(mat._matListDateFor('2026-11-12'), '2026-11-06');
  assert.equal(mat._matMonday('2026-09-13'), '2026-09-07');
});

test('MAT 02: requirements — product line defaults merchant and need-by from the work package; Other needs description+unit; lead-time risk', () => {
  const s = makeStore();
  const r = panels(s);
  assert.equal(r.material.merchant_id, 'COMP-greentech');
  assert.equal(r.material.need_by_date, '2026-10-29');
  assert.equal(r.material.unit, 'Each');
  assert.equal(r.work_type, 'Roof');
  assert.deepEqual(r.lead_time_risk, { latest_order_date: '2026-10-15', lead_days: 14, at_risk: false });
  assert.equal(r.task, null, 'ToOrder raises MAT01 only when the order is built');
  assert.equal(s.get('Jobs', JOB).version, 2);
  assert.equal(s.get('CommitJournal', 'CJ-MAT-REQ-P460').state, 'Committed');
  assert.equal(panels(s).replay, true);
  assert.equal(s.tables.Materials.length, 1);
  assert.throws(() => add(s, 'REQ-X1', { work_package_id: 'WP-elec', required_quantity: 5, source: 'ToOrder', merchant_id: 'COMP-cef' }), /Other materials require description and unit/);
  assert.throws(() => add(s, 'REQ-X2', { work_package_id: 'WP-elec', description: 'Clips', unit: 'Each', required_quantity: 5, source: 'ToOrder' }), /merchant_id required/);
  assert.throws(() => add(s, 'REQ-X3', { product_id: 'PROD-P460', required_quantity: 5, source: 'ToOrder' }), /need_by_date required/);
  assert.throws(() => add(s, 'REQ-X4', { product_id: 'PROD-P460', required_quantity: 0, source: 'ToOrder', need_by_date: '2026-10-01' }), /required_quantity/);
  assert.throws(() => add(s, 'REQ-X5', { product_id: 'PROD-P460', required_quantity: 1, source: 'Borrowed', need_by_date: '2026-10-01' }), /source must be/);
  assert.throws(() => add(s, 'REQ-X6', { product_id: 'PROD-P460', required_quantity: 1, source: 'ToOrder', need_by_date: '2026-10-01', merchant_id: 'COMP-scaffold-dev' }), /active Merchant/);
  const risky = add(s, 'REQ-RISK', { product_id: 'PROD-P515', required_quantity: 2, source: 'ToOrder', need_by_date: '2026-09-20' });
  assert.equal(risky.lead_time_risk.at_risk, true);
  const view = mat._matRequirements(s, JOB);
  assert.equal(view.count, 2);
  assert.equal(view.to_order, 2);
  assert.equal(view.items[0].state, 'ToOrder');
});

test('MAT 03: AlreadyOrdered creates MAT02 verification (never an order); Stock creates MAT03 for the store owner', () => {
  const s = makeStore();
  const ao = add(s, 'REQ-AO', { work_package_id: 'WP-roof', description: 'Rails', unit: 'Each', required_quantity: 8, source: 'AlreadyOrdered', merchant_id: 'COMP-greentech', already_ordered_reference: 'GT-PRE-77' });
  assert.equal(ao.task.code, 'MAT02');
  const t2 = s.get('Tasks', ao.task.task_id);
  assert.equal(t2.owner_id, 'PERSON-tanya');
  assert.equal(t2.due_at, '2026-09-14T16:00:00.000Z', 'same staffed day end (Mon 14 Sep 17:00 BST)');
  assert.throws(() => add(s, 'REQ-AO2', { description: 'Rails', unit: 'Each', required_quantity: 1, source: 'AlreadyOrdered', merchant_id: 'COMP-greentech', need_by_date: '2026-10-01' }), /already_ordered_reference required/);
  const st = add(s, 'REQ-STOCK', { work_package_id: 'WP-roof', product_id: 'PROD-P515', required_quantity: 4, source: 'Stock' });
  assert.equal(st.task.code, 'MAT03');
  const t3 = s.get('Tasks', st.task.task_id);
  assert.equal(t3.owner_id, 'PERSON-store');
  assert.equal(t3.due_at, '2026-10-28T17:00:00.000Z', 'day before need-by (Thu 29 Oct) at day end; GMT after 25 Oct');
  const built = build(s);
  assert.equal(built.orders.length, 0, 'AlreadyOrdered and Stock lines never become orders');
  assert.equal(s.tables.Orders.length, 0);
  const view = mat._matRequirements(s, JOB);
  assert.deepEqual(view.items.map(i => i.state).sort(), ['Stock', 'VerifyExternalOrder']);
});

test('MAT 04: orders are built per merchant and work type with MAT01 due at the latest order date; replay adds nothing', () => {
  const s = makeStore(); panels(s); cable(s);
  add(s, 'REQ-RAILS', { work_package_id: 'WP-roof', description: 'Rails', unit: 'Each', required_quantity: 8, source: 'ToOrder', merchant_id: 'COMP-greentech' });
  const r = build(s);
  assert.deepEqual(r.orders.map(o => [o.order_id, o.work_type, o.requested_delivery_date, o.lines_added.length, o.created]), [[ELEC, 'Electrical', '2026-11-12', 1, true], [ROOF, 'Roof', '2026-10-29', 2, true]]);
  const roof = order(s, ROOF);
  assert.equal(roof.status, 'Draft');
  assert.equal(roof.revision, 1);
  assert.equal(roof.delivery_location_id, 'LOC-store');
  const lines = s.tables.OrderLines.filter(l => l.order_id === ROOF);
  assert.deepEqual(lines.map(l => [l.id, l.quantity, l.unit]), [['OL-' + ROOF + '-1', 10, 'Each'], ['OL-' + ROOF + '-2', 8, 'Each']]);
  assert.match(lines[0].description_snapshot, /460W Solar Panel \(P460\)/);
  assert.equal(s.get('Materials', 'MAT-J-mat-REQ-P460').order_line_id, 'OL-' + ROOF + '-1');
  assert.equal(s.get('Tasks', r.orders[1].task.task_id).due_at, '2026-10-15T08:00:00.000Z', 'need-by 29 Oct minus 14 lead days = Thu 15 Oct 09:00 London');
  assert.equal(s.get('Tasks', r.orders[0].task.task_id).due_at, '2026-11-05T09:00:00.000Z', 'need-by 12 Nov minus 7 = Thu 5 Nov 09:00 London (GMT)');
  assert.equal(build(s).replay, true);
  assert.equal(build(s, 'BUILD-2').orders.length, 0, 'nothing left to order');
  assert.equal(s.tables.Orders.length, 2);
  /* A later requirement for the same merchant+type appends to the Draft order and pulls the delivery date earlier if needed. */
  add(s, 'REQ-LATE', { work_package_id: 'WP-roof', description: 'Flashing', unit: 'Each', required_quantity: 2, source: 'ToOrder', merchant_id: 'COMP-greentech', need_by_date: '2026-10-22' });
  const r2 = build(s, 'BUILD-3');
  assert.equal(r2.orders[0].created, false);
  assert.equal(order(s, ROOF).requested_delivery_date, '2026-10-22');
  assert.equal(s.tables.OrderLines.filter(l => l.order_id === ROOF).length, 3);
  assert.equal(s.tables.Outbox.length, 0);
});

test('MAT 05: send captures an immutable snapshot, completes MAT01, opens MAT06; nothing is actually sent', () => {
  const s = makeStore(); panels(s); cable(s); build(s);
  let o = order(s, ROOF);
  assert.throws(() => mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-X', order_id: ROOF, expected_version: 9, at: T0 }), /MAT_STALE/);
  const r = mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-1', order_id: ROOF, expected_version: o.version, at: '2026-10-01T10:00:00.000Z' });
  assert.equal(r.status, 'Requested');
  assert.equal(r.sent, false);
  o = order(s, ROOF);
  assert.equal(o.sent_message_id, null);
  const comm = s.get('Communications', r.communication.communication_id);
  assert.equal(comm.type, 'MerchantOrder');
  assert.equal(comm.status, 'Draft');
  assert.equal(comm.revision, 1);
  assert.equal(comm.delivery_date, '2026-10-29');
  const body = JSON.parse(comm.body_snapshot);
  assert.equal(body.lines.length, 1);
  assert.equal(body.postcode, 'PL1 1AA');
  assert.equal(JSON.parse(comm.recipients_snapshot)[0].name, 'Tom');
  assert.equal(s.tables.CommunicationJobs[0].order_id, ROOF);
  assert.deepEqual(tasks(s, 'Orders', ROOF), ['MAT01:Complete', 'MAT06:Open']);
  assert.equal(s.tables.Tasks.find(t => t.template_code === 'MAT06').due_at, '2026-10-02T08:00:00.000Z', 'next staffed day 09:00');
  assert.equal(mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-1', order_id: ROOF, expected_version: 5, at: T0 }).replay, true);
  /* Urgent send is due same day end. */
  const e = order(s, ELEC);
  const ur = mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-2', order_id: ELEC, expected_version: e.version, urgent: true, at: '2026-10-01T10:00:00.000Z' });
  assert.equal(s.get('Tasks', ur.task.task_id).due_at, '2026-10-01T16:00:00.000Z');
  assert.equal(s.tables.Outbox.length, 0);
});

test('MAT 06: confirm records supplier reference + acknowledgement of the revision, creates the expected delivery and MAT04 for the store', () => {
  const s = makeStore();
  const r = toConfirmed(s);
  assert.equal(r.status, 'Confirmed');
  const o = order(s, ROOF);
  assert.equal(o.supplier_reference, 'GT-12345');
  assert.equal(o.confirmed_revision, 1);
  assert.equal(o.confirmed_by, ACTOR);
  assert.equal(r.delivery.id, 'DEL-' + ROOF + '-R1');
  assert.equal(r.delivery.expected_date, '2026-10-29');
  assert.equal(r.delivery.receipt_status, 'Expected');
  assert.equal(s.tables.Acknowledgements[0].acknowledged_revision, 1);
  assert.deepEqual(tasks(s, 'Orders', ROOF), ['MAT01:Complete', 'MAT06:Complete']);
  assert.deepEqual(tasks(s, 'Deliveries', r.delivery.id), ['MAT04:Open']);
  const t4 = s.get('Tasks', r.task.task_id);
  assert.equal(t4.owner_id, 'PERSON-store');
  assert.equal(t4.due_at, '2026-10-29T17:00:00.000Z', 'delivery day end, GMT');
  assert.equal(mat._matOrderView(s, ROOF).acknowledgement_required, false);
  assert.throws(() => mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-2', order_id: ROOF, supplier_reference: 'x', expected_version: o.version, at: T0 }), /only a Requested order/);
  assert.throws(() => mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-3', order_id: ELEC, supplier_reference: 'x', expected_version: order(s, ELEC).version, at: T0 }), /only a Requested order/, 'Draft cannot be confirmed before send');
});

test('MAT 07: revising a sent order creates a new revision needing re-acknowledgement; inside lead time it is urgent; delivery moves', () => {
  const s = makeStore();
  const conf = toConfirmed(s);
  let o = order(s, ROOF);
  assert.throws(() => mat._matReviseOrder(s, { actor: ACTOR, command_id: 'REV-0', order_id: ROOF, requested_delivery_date: '2026-11-05', expected_version: o.version, at: T0 }), /reason required/);
  /* Spec example: on 28 Oct the roof date moves after the first list → urgent revision. */
  const r = mat._matReviseOrder(s, { actor: ACTOR, command_id: 'REV-1', order_id: ROOF, requested_delivery_date: '2026-11-05', reason: 'Roof moved to 11 Nov', expected_version: o.version, at: '2026-10-28T10:00:00.000Z' });
  assert.equal(r.revision, 2);
  assert.equal(r.status, 'Requested');
  assert.equal(r.acknowledgement_required, true);
  assert.equal(r.urgent, true, '5 Nov minus 14 lead days is already past on 28 Oct');
  o = order(s, ROOF);
  assert.equal(o.confirmed_revision, 1);
  assert.equal(o.requested_delivery_date, '2026-11-05');
  assert.equal(s.get('Communications', 'COMM-MAT-' + ROOF + '-MerchantOrder-R2').revision, 2);
  assert.equal(JSON.parse(s.get('Communications', 'COMM-MAT-' + ROOF + '-MerchantOrder-R2').body_snapshot).supersedes_revision, 1);
  assert.deepEqual(tasks(s, 'Orders', ROOF), ['MAT01:Complete', 'MAT06:Complete', 'MAT06:Open']);
  const urgentTask = s.tables.Tasks.find(t => t.instance_key === 'MAT06-' + ROOF + '-R2');
  assert.equal(urgentTask.due_at, '2026-10-28T17:00:00.000Z', 'urgent → same day end (GMT)');
  assert.equal(s.get('Deliveries', conf.delivery.id).expected_date, '2026-11-05');
  assert.equal(s.tables.Tasks.find(t => t.instance_key === 'MAT04-' + conf.delivery.id).due_at, '2026-11-05T17:00:00.000Z');
  assert.equal(mat._matOrderView(s, ROOF).acknowledgement_required, true);
  /* Re-confirm revision 2. */
  o = order(s, ROOF);
  mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-2', order_id: ROOF, supplier_reference: 'GT-12345-A', expected_version: o.version, at: '2026-10-28T12:00:00.000Z' });
  assert.equal(order(s, ROOF).confirmed_revision, 2);
  assert.equal(s.tables.Acknowledgements.map(a => a.acknowledged_revision).join(','), '1,2');
  /* Line quantity change below received is refused; cancelled quantity reduces the material. */
  o = order(s, ROOF);
  const line = 'OL-' + ROOF + '-1';
  const rl = mat._matReviseOrder(s, { actor: ACTOR, command_id: 'REV-2', order_id: ROOF, lines: [{ order_line_id: line, cancelled_quantity: 2 }], reason: 'Two fewer panels', expected_version: o.version, at: '2026-10-28T13:00:00.000Z' });
  assert.equal(rl.revision, 3);
  assert.equal(s.get('OrderLines', line).cancelled_quantity, 2);
  assert.equal(s.get('Materials', 'MAT-J-mat-REQ-P460').cancelled_quantity, 2);
  assert.throws(() => mat._matReviseOrder(s, { actor: ACTOR, command_id: 'REV-3', order_id: ROOF, lines: [{ order_line_id: line, cancelled_quantity: 20 }], reason: 'x', expected_version: order(s, ROOF).version, at: T0 }), /cancelled_quantity invalid/);
  /* Draft revision needs no acknowledgement. */
  const e = order(s, ELEC);
  const rd = mat._matReviseOrder(s, { actor: ACTOR, command_id: 'REV-4', order_id: ELEC, requested_delivery_date: '2026-11-19', reason: 'Electrical moved', expected_version: e.version, at: T0 });
  assert.equal(rd.acknowledgement_required, false);
  assert.equal(rd.communication, null);
  assert.equal(order(s, ELEC).status, 'Draft');
});

test('MAT 08: receipt moves good stock to store and damaged to quarantine exactly once, raises separate issues, tracks balance', () => {
  const s = makeStore();
  const conf = toConfirmed(s);
  const line = 'OL-' + ROOF + '-1';
  assert.throws(() => mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-X', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-1', lines: [{ order_line_id: line, quantity_good: 11 }], at: '2026-10-29T14:00:00.000Z' }), /exceeds outstanding/);
  assert.throws(() => mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-Y', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-1', lines: [{ order_line_id: line, quantity_good: 0 }], at: T0 }), /not all zero/);
  assert.throws(() => mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-Z', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: '', lines: [{ order_line_id: line, quantity_good: 1 }], at: T0 }), /delivery_note_reference required/);
  const r = mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-1', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-1', delivery_note_file_id: 'drive-dn-1', lines: [{ order_line_id: line, quantity_good: 6, quantity_damaged: 1, quantity_short: 1 }], at: '2026-10-29T14:00:00.000Z' });
  assert.equal(r.complete, false);
  assert.equal(r.order.status, 'PartReceived');
  assert.equal(r.delivery.receipt_status, 'Discrepancy');
  assert.equal(r.delivery.received_by, 'PERSON-store');
  assert.match(r.delivery.discrepancy_note, /DamagedGoods 1/);
  assert.match(r.delivery.discrepancy_note, /ShortDelivery 1/);
  assert.deepEqual(r.receipt_lines, ['RL-' + conf.delivery.id + '-' + line]);
  const rl = s.get('ReceiptLines', r.receipt_lines[0]);
  assert.equal(rl.quantity_good, 6);
  assert.equal(rl.quantity_damaged, 1);
  assert.equal(rl.evidence_id, 'EV-' + conf.delivery.id);
  assert.equal(s.get('Evidence', 'EV-' + conf.delivery.id).category, 'DeliveryNote');
  assert.equal(s.get('Evidence', 'EV-' + conf.delivery.id).drive_file_id, 'drive-dn-1');
  assert.deepEqual(JSON.parse(rl.stock_movement_ids).length, 2);
  const mv = s.tables.StockMovements;
  assert.deepEqual(mv.map(m => [m.movement_type, m.quantity, m.from_location_id, m.to_location_id, m.receipt_line_id]), [['Receipt', 6, 'LOC-external', 'LOC-store', rl.id], ['Damage', 1, 'LOC-external', 'LOC-quarantine', rl.id]]);
  assert.ok(mv.every(m => m.product_id === 'PROD-P460' && m.job_id === JOB));
  assert.deepEqual(r.issues.sort(), ['ISS-MAT-RCV-1-DamagedGoods-' + line, 'ISS-MAT-RCV-1-ShortDelivery-' + line]);
  const iss = s.get('Issues', 'ISS-MAT-RCV-1-ShortDelivery-' + line);
  assert.equal(iss.type, 'Supply');
  assert.equal(iss.responsible_company_id, 'COMP-greentech');
  assert.equal(iss.status, 'Open');
  assert.equal(iss.blocks_completion, false);
  assert.deepEqual(tasks(s, 'Deliveries', conf.delivery.id), ['MAT04:Complete']);
  assert.equal(r.follow_up_delivery_id, 'DEL-' + ROOF + '-R1-2');
  assert.deepEqual(tasks(s, 'Deliveries', r.follow_up_delivery_id), ['MAT04:Open']);
  /* Replay: same command → nothing added; a second attempt on the received delivery → refused. */
  const again = mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-1', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-1', delivery_note_file_id: 'drive-dn-1', lines: [{ order_line_id: line, quantity_good: 6, quantity_damaged: 1, quantity_short: 1 }], at: T0 });
  assert.equal(again.replay, true);
  assert.equal(s.tables.StockMovements.length, 2);
  assert.equal(s.tables.ReceiptLines.length, 1);
  assert.throws(() => mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-1b', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-1b', lines: [{ order_line_id: line, quantity_good: 1 }], at: T0 }), /already received/);
  /* Balance (including the shorted unit) arrives on the follow-up delivery → Received. */
  const r2 = mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-2', delivery_id: r.follow_up_delivery_id, received_by: 'PERSON-store', delivery_note_reference: 'DN-2', lines: [{ order_line_id: line, quantity_good: 3 }], at: '2026-10-30T14:00:00.000Z' });
  assert.equal(r2.complete, true);
  assert.equal(r2.order.status, 'Received');
  assert.equal(r2.delivery.receipt_status, 'Received');
  assert.equal(r2.follow_up_delivery_id, null);
  assert.equal(s.tables.StockMovements.length, 3);
  assert.equal(s.tables.StockMovements.filter(m => m.to_location_id === 'LOC-store').reduce((a, m) => a + m.quantity, 0), 9);
  assert.equal(s.get('Issues', iss.id).status, 'Open', 'receipt never closes supply issues automatically');
  const view = mat._matOrderView(s, ROOF);
  assert.equal(view.lines[0].outstanding, 0);
  assert.equal(view.deliveries.length, 2);
  assert.equal(view.issues.length, 2);
  assert.equal(mat._matRequirements(s, JOB).items.find(i => i.material_id === 'MAT-J-mat-REQ-P460').state, 'Received');
});

test('MAT 09: receipts on Other lines without a product create no stock movement; FN-05 disabled refuses receipts but not ordering', () => {
  const s = makeStore(); panels(s); cable(s); build(s);
  let e = order(s, ELEC);
  mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-E', order_id: ELEC, expected_version: e.version, at: T0 }); e = order(s, ELEC);
  const conf = mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-E', order_id: ELEC, supplier_reference: 'CEF-1', expected_version: e.version, at: T0 });
  s.update('ReleaseModes', 'RM-FN05', { mode: 'Disabled', authorised_job_scope: 'None' });
  const before = copy(s.tables);
  assert.throws(() => mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-E', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-E', lines: [{ order_line_id: 'OL-' + ELEC + '-1', quantity_good: 50 }], at: T0 }), /FN-05 must be Automated/);
  assert.deepEqual(s.tables, before);
  assert.equal(build(s, 'BUILD-9').replay, false, 'ordering still works under FN-03 alone');
  s.update('ReleaseModes', 'RM-FN05', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  const r = mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-E', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-E', lines: [{ order_line_id: 'OL-' + ELEC + '-1', quantity_good: 50 }], at: T0 });
  assert.equal(r.order.status, 'Received');
  assert.equal(r.stock_movements.length, 0, 'untracked Other line: no ledger movement');
  assert.equal(s.get('ReceiptLines', r.receipt_lines[0]).stock_movement_ids, null);
  assert.equal(r.issues.length, 0);
});

test('MAT 10: cancel — draft cancels silently; sent order needs merchant acknowledgement; received goods cannot be cancelled; materials released', () => {
  const s = makeStore(); panels(s); cable(s); build(s);
  const e = order(s, ELEC);
  const rd = mat._matCancelOrder(s, { actor: ACTOR, command_id: 'CAN-E', order_id: ELEC, reason: 'Scope change', expected_version: e.version, at: T0 });
  assert.equal(rd.status, 'Cancelled');
  assert.equal(rd.acknowledgement_required, false);
  assert.equal(rd.communication, null);
  assert.equal(s.get('Materials', 'MAT-J-mat-REQ-CABLE').order_line_id, null, 'material back to ToOrder');
  assert.equal(s.get('OrderLines', 'OL-' + ELEC + '-1').cancelled_quantity, 50);
  assert.deepEqual(tasks(s, 'Orders', ELEC), ['MAT01:Cancelled']);
  assert.equal(mat._matRequirements(s, JOB).items.find(i => i.material_id === 'MAT-J-mat-REQ-CABLE').state, 'ToOrder');
  /* Rebuilding creates a new order id since the base id is Cancelled. */
  const rb = build(s, 'BUILD-2');
  assert.equal(rb.orders[0].order_id, ELEC + '-2');
  /* Sent order cancellation drafts a notice and MAT06 acknowledgement. */
  let o = order(s, ROOF);
  mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-1', order_id: ROOF, expected_version: o.version, at: T0 }); o = order(s, ROOF);
  const rs = mat._matCancelOrder(s, { actor: ACTOR, command_id: 'CAN-R', order_id: ROOF, reason: 'Job cancelled', expected_version: o.version, at: T0 });
  assert.equal(rs.acknowledgement_required, true);
  assert.equal(s.get('Communications', rs.communication.communication_id).type, 'MerchantOrderCancellation');
  assert.equal(s.get('Tasks', rs.task.task_id).template_code, 'MAT06');
  /* Received orders refuse cancel. */
  const s2 = makeStore(); const conf = toConfirmed(s2);
  mat._matReceiveDelivery(s2, { actor: ACTOR, command_id: 'RCV-1', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN-1', lines: [{ order_line_id: 'OL-' + ROOF + '-1', quantity_good: 10 }], at: T0 });
  assert.throws(() => mat._matCancelOrder(s2, { actor: ACTOR, command_id: 'CAN-X', order_id: ROOF, reason: 'x', expected_version: order(s2, ROOF).version, at: T0 }), /goods received/);
});

test('MAT 11: Friday list drafts next week\'s deliveries per merchant with MAT05 + MAT06 tasks; idempotent; unconfirmed orders flagged', () => {
  const s = makeStore(); panels(s); cable(s); build(s);
  let o = order(s, ROOF);
  mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-1', order_id: ROOF, expected_version: o.version, at: '2026-10-01T10:00:00.000Z' }); o = order(s, ROOF);
  mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-1', order_id: ROOF, supplier_reference: 'GT-1', expected_version: o.version, at: '2026-10-02T10:00:00.000Z' });
  let e = order(s, ELEC);
  mat._matSendOrder(s, { actor: ACTOR, command_id: 'SEND-2', order_id: ELEC, expected_version: e.version, at: '2026-10-01T10:00:00.000Z' }); e = order(s, ELEC);
  mat._matConfirmOrder(s, { actor: ACTOR, command_id: 'CONF-2', order_id: ELEC, supplier_reference: 'CEF-1', expected_version: e.version, at: '2026-10-02T10:00:00.000Z' });
  /* Friday 23 Oct → week of Thu 29 Oct: roof delivery only. */
  const r = mat._matWeeklyList(s, { actor: ACTOR, command_id: 'WK-1', list_date: '2026-10-23', at: '2026-10-23T09:00:00.000Z' });
  assert.equal(r.week_start, '2026-10-26');
  assert.equal(r.lists.length, 1);
  assert.equal(r.lists[0].merchant_id, 'COMP-greentech');
  assert.equal(r.lists[0].items, 1);
  assert.equal(r.lists[0].unacknowledged, 0);
  const comm = s.get('Communications', r.lists[0].communication_id);
  assert.equal(comm.type, 'MerchantDeliveryList');
  assert.equal(comm.status, 'Draft');
  assert.equal(comm.covered_week_start, '2026-10-26');
  assert.equal(comm.delivery_date, '2026-10-29');
  assert.equal(comm.job_id, null);
  const item = JSON.parse(comm.body_snapshot).items[0];
  assert.equal(item.postcode, 'PL1 1AA');
  assert.equal(item.work_type, 'Roof');
  assert.equal(item.supplier_reference, 'GT-1');
  assert.deepEqual(r.lists[0].tasks.map(t => t.code), ['MAT05', 'MAT06']);
  assert.equal(s.get('Tasks', r.lists[0].tasks[0].task_id).due_at, '2026-10-23T11:00:00.000Z', 'Friday 23 Oct 12:00 London');
  assert.equal(s.get('Tasks', r.lists[0].tasks[1].task_id).due_at, '2026-10-26T09:00:00.000Z', 'next staffed day (Mon 26 Oct, GMT) 09:00');
  assert.ok(mat._matWeeklyList(s, { actor: ACTOR, command_id: 'WK-1b', list_date: '2026-10-23', at: T0 }).lists.every(l => l.created === false));
  assert.equal(s.tables.Communications.filter(c => c.type === 'MerchantDeliveryList').length, 1);
  /* Friday 6 Nov → week of Thu 12 Nov: electrical; an amended, unconfirmed order shows as unacknowledged. */
  e = order(s, ELEC);
  mat._matReviseOrder(s, { actor: ACTOR, command_id: 'REV-E', order_id: ELEC, requested_delivery_date: '2026-11-12', lines: [{ order_line_id: 'OL-' + ELEC + '-1', quantity: 60 }], reason: 'More cable', expected_version: e.version, at: '2026-11-02T09:00:00.000Z' });
  const r2 = mat._matWeeklyList(s, { actor: ACTOR, command_id: 'WK-2', list_date: '2026-11-06', at: '2026-11-06T09:00:00.000Z' });
  assert.equal(r2.lists.length, 1);
  assert.equal(r2.lists[0].merchant_id, 'COMP-cef');
  assert.equal(r2.lists[0].unacknowledged, 1);
  assert.equal(s.tables.Outbox.length, 0);
});

test('MAT 12: refusals — FN-03 disabled, wrong env, non-pilot or cancelled job, missing actor; no writes on refusal', () => {
  let s = makeStore(); s.update('ReleaseModes', 'RM-FN03', { mode: 'Disabled', authorised_job_scope: 'None' });
  let before = copy(s.tables); assert.throws(() => panels(s), /FN-03 must be Automated/); assert.deepEqual(s.tables, before);
  s = makeStore(); s.getEnvironment = () => 'PROD'; assert.throws(() => panels(s), /exact DEV/);
  s = makeStore(); s.update('Jobs', JOB, { pilot_job: false }); assert.throws(() => panels(s), /pilot R2 job/);
  s = makeStore(); s.update('Jobs', JOB, { cancellation_at: T0 }); assert.throws(() => panels(s), /S15_REVIEW/);
  s = makeStore(); assert.throws(() => add(s, 'X', { product_id: 'PROD-P460', required_quantity: 1, source: 'ToOrder', need_by_date: '2026-10-01', actor: '' }), /command_id and actor required/);
  s = makeStore(); panels(s); assert.throws(() => panels(s) && add(s, 'REQ-P460', { work_package_id: 'WP-roof', product_id: 'PROD-P460', required_quantity: 11, source: 'ToOrder' }), /conflicting command identity/);
  s = makeStore(); assert.throws(() => mat._matSendOrder(s, { actor: ACTOR, command_id: 'S', order_id: 'nope', expected_version: 1 }), /order not found/);
  s = makeStore(); panels(s); build(s); assert.throws(() => mat._matSendOrder(s, { actor: ACTOR, command_id: 'S', order_id: ROOF, expected_version: order(s, ROOF).version, at: T0 }) && mat._matSendOrder(s, { actor: ACTOR, command_id: 'S2', order_id: ELEC, expected_version: 1, at: T0 }), /order not found/);
});

test('MAT 13: store queue lists expected deliveries and open store tasks; read models are read-only; Sheet Dates tolerated', () => {
  const s = makeStore();
  const conf = toConfirmed(s);
  add(s, 'REQ-STOCK', { work_package_id: 'WP-roof', product_id: 'PROD-P515', required_quantity: 4, source: 'Stock' });
  for (const d of s.tables.Deliveries) d.expected_date = new Date(d.expected_date + 'T12:00:00Z');
  for (const o of s.tables.Orders) o.requested_delivery_date = new Date(o.requested_delivery_date + 'T12:00:00Z');
  const before = copy(s.tables);
  const q = mat._matStoreQueue(s, { from: '2026-10-01', to: '2026-11-30' });
  assert.equal(q.expected_deliveries.length, 1);
  assert.equal(q.expected_deliveries[0].expected_date, '2026-10-29');
  assert.equal(q.expected_deliveries[0].merchant, 'Greentech');
  assert.deepEqual(q.open_store_tasks.map(t => t.template_code).sort(), ['MAT03', 'MAT04']);
  const v = mat._matOrderView(s, ROOF);
  assert.equal(v.deliveries[0].expected_date, '2026-10-29');
  mat._matRequirements(s, JOB);
  assert.deepEqual(s.tables, before);
  assert.equal(mat._matOrderView(s, 'nope').found, false);
  assert.equal(mat._matStoreQueue(s, { from: '2027-01-01', to: '2027-02-01' }).expected_deliveries.length, 0);
  /* Mutations still work on Sheet Date values. */
  const r = mat._matReceiveDelivery(s, { actor: ACTOR, command_id: 'RCV-D', delivery_id: conf.delivery.id, received_by: 'PERSON-store', delivery_note_reference: 'DN', lines: [{ order_line_id: 'OL-' + ROOF + '-1', quantity_good: 10 }], at: new Date('2026-10-29T14:00:00.000Z') });
  assert.equal(r.order.status, 'Received');
});

test('MAT 14: seed carries MAT01–MAT06 exactly and the embedded seed matches', () => {
  const codes = seed.TaskTemplates.map(t => t.template_code);
  for (const c of ['MAT01', 'MAT02', 'MAT03', 'MAT04', 'MAT05', 'MAT06']) assert.ok(codes.includes(c), c);
  assert.equal(seed.TaskTemplates.find(t => t.template_code === 'MAT03').default_owner_role, 'Store');
  assert.equal(seed.TaskTemplates.find(t => t.template_code === 'MAT04').default_owner_role, 'Store');
  assert.equal(seed.TaskTemplates.find(t => t.template_code === 'MAT06').due_rule, 'Next staffed day default, urgent same day');
  assert.ok(fs.readFileSync('apps-script/S02SeedData.js', 'utf8').includes('"template_code":"MAT06"'));
});

test('MAT 15: bundle — namespaced, parses with all bundles, no external APIs, no S07/S08 id collisions', () => {
  const bundle = fs.readFileSync('apps-script/materials/MaterialsWorkflow.js', 'utf8');
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  const prior = files.filter(f => !f.startsWith('materials/')).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
  new vm.Script(prior + '\n' + bundle);
  for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], /^(?:MAT_|_mat|runMat|restoreMat)/);
  assert.doesNotMatch(bundle, /CalendarApp|UrlFetchApp|fetch\(|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet|https:\/\/|module\.exports|use strict/);
  for (const fn of ['runMatRequirements', 'runMatOrderView', 'runMatStoreQueue', 'runMatWeeklyList', 'runMatHappyPathTest', 'runMatEnableFunctionsForSyntheticTest', 'restoreMatSafeState']) assert.match(bundle, new RegExp('function ' + fn + '\\('));
  /* Distinct id schemes from S07 (ORD-<job>-<merchant>) and S08 (RES-/MOV-<material>). */
  const s = makeStore(); panels(s); build(s);
  assert.equal(order(s, ROOF).id, 'ORD-J-mat-COMP-greentech-Roof');
  assert.ok(!s.tables.Orders.some(o => o.id === 'ORD-J-mat-COMP-greentech'), 'S07 id scheme untouched');
});

test('MAT 16: zero-arg cloud simulation — synthetic happy path on the header adapter, modes restored, nothing sent', () => {
  const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
  const grids = {};
  vm.runInContext(fs.readFileSync('apps-script/materials/MaterialsWorkflow.js', 'utf8'), ctx);
  for (const [n, h] of Object.entries(ctx.MAT_HEADERS)) grids[n] = [Array.from(h)];
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(rowOf('ReleaseModes', { ...r, version: 1 }));
  for (const r of seed.Settings) grids.Settings.push(rowOf('Settings', { ...r, created_at: T0, commit_id: 'seed' }));
  for (const r of seed.TaskTemplates) grids.TaskTemplates.push(rowOf('TaskTemplates', { ...r, ...meta }));
  for (const r of seed.Companies) grids.Companies.push(rowOf('Companies', { ...r, ...meta, source_system: 'seed' }));
  for (const r of seed.Contacts) grids.Contacts.push(rowOf('Contacts', { ...r, ...meta, source_system: 'seed' }));
  for (const r of seed.Products) grids.Products.push(rowOf('Products', { ...r, ...meta, source_system: 'seed' }));
  for (const r of seed.StockLocations) grids.StockLocations.push(rowOf('StockLocations', { ...r, ...meta }));
  for (const r of seed.People) grids.People.push(rowOf('People', { ...r, ...meta, source_system: 'seed' }));
  let busy = false;
  const sheets = Object.keys(grids).map(n => ({
    getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 5000,
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); },
        setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); }
      };
    }
  }));
  ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => mat.MAT_DEV_SHEET_ID, getSheets: () => sheets }), flush() { } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify({ environment: 'DEV' }) }) };
  ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
  ctx.Session = { getActiveUser: () => ({ getEmail: () => 'tanya@test.example.invalid' }) };
  for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  assert.equal(ctx.restoreMatSafeState().pass, true);
  assert.equal(ctx.runMatWeeklyList().pass, false, 'disabled FN-03 refuses');
  const smoke = ctx.runMatHappyPathTest();
  assert.equal(smoke.pass, true, JSON.stringify(smoke));
  assert.equal(smoke.detail.roof_status, 'Received');
  assert.equal(smoke.detail.replay, true);
  assert.equal(smoke.detail.issues.length, 1);
  assert.equal(smoke.detail.external_calls, 0);
  const modeIdx = grids.ReleaseModes[0].indexOf('mode');
  assert.equal(grids.ReleaseModes.find(r => r[0] === 'RM-FN03')[modeIdx], 'Disabled');
  assert.equal(grids.ReleaseModes.find(r => r[0] === 'RM-FN05')[modeIdx], 'Disabled');
  assert.equal(ctx.runMatRequirements(smoke.detail.job_id).pass, true);
  assert.equal(ctx.runMatStoreQueue('2026-01-01', '2030-01-01').pass, true);
  const statusIdx = grids.Communications[0].indexOf('status');
  assert.ok(grids.Communications.slice(1).every(r => r[statusIdx] === 'Draft'));
  assert.equal(grids.Outbox, undefined, 'materials bundle never touches Outbox');
});
