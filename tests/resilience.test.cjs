/* Resilience review + Xero adapter tests. Local only; no external calls; Xero disabled by default. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const schema = require('../schema/tables.json'), seed = require('../schema/config-seed.json');
const rs = require('../resilience/review.js'), xo = require('../xero/adapter.js');
const copy = x => structuredClone(x);
const T0 = '2026-09-14T09:00:00.000Z';
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();
const CMD = (id, extra) => ({ actor: 'PERSON-tanya', command_id: id, at: T0, ...extra });

function makeStore() {
  const tables = Object.fromEntries(schema.tables.map(t => [t.name, []]));
  const s = {
    tables, getSheetId: () => rs.RS_DEV_SHEET_ID, getEnvironment: () => 'DEV',
    list: n => copy(tables[n] || []), get: (n, id) => copy((tables[n] || []).find(r => r.id === id) || null),
    insert(n, r) { assert.ok(tables[n], n); assert.ok(!this.get(n, r.id), 'duplicate ' + n + '/' + r.id); const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(r)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); tables[n].push(copy(r)); },
    update(n, id, patch) { const r = tables[n].find(r => r.id === id); assert.ok(r, n + '/' + id); const h = schema.tables.find(t => t.name === n).columns.map(c => c.name); for (const k of Object.keys(patch)) assert.ok(h.includes(k), 'unknown ' + n + '.' + k); Object.assign(r, copy(patch)); },
    withLock(fn) { return fn(); }
  };
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  for (const r of seed.ReleaseModes) s.insert('ReleaseModes', { ...r, version: 1 });
  s.update('ReleaseModes', 'RM-FN14', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  for (const r of seed.People) s.insert('People', { ...r, ...meta, source_system: 'seed', source_record_id: null });
  s.insert('Customers', { id: 'CUST-1', first_name: 'Ann', last_name: 'Smith', address_line1: '1 Way', address_line2: null, town: 'Plymouth', postcode: 'PL1 1AA', email: 'ann@example.invalid', phone: null, alternate_contact: null, contact_notes: null, ...meta, source_system: 'seed', source_record_id: null });
  s.insert('Jobs', { id: 'J-1', job_id: 'SS-0001', customer_id: 'CUST-1', display_name: 'Ann Smith PL1', finance_route: 'Standard', contract_status: 'Signed', sold_booking_match_status: 'Match', roof_required: true, electrical_required: false, scaffold_required: false, workflow_stage: 'Booked', handover_status: 'NotReady', financial_status: 'Pending', pilot_job: true, release_scope: 'R1', current_contract_gross_pence: 480000, ...meta, source_system: 'S05' });
  return s;
}
function outbox(s, id, extra) { s.insert('Outbox', { id, idempotency_key: 'k-' + id, action_type: 'Email', target: 'x', payload_hash: 'h', job_revision: 1, attempt_count: 0, next_attempt: null, external_id: null, response_summary: null, correlation_id: 'J-1', status: 'Pending', created_at: T0, commit_id: 'c', ...extra }); }

test('RS 01: review queue unifies uncertain outbox, stalled processing, failed communications and stuck commits with indicators', () => {
  const s = makeStore();
  outbox(s, 'OUT-ok');
  outbox(s, 'OUT-nr', { status: 'NeedsReview', attempt_count: 5, response_summary: 'max retries', created_at: plus(T0, -120) });
  outbox(s, 'OUT-rd', { status: 'RetryDue', attempt_count: 1, next_attempt: plus(T0, 5) });
  outbox(s, 'OUT-proc-fresh', { status: 'Processing', attempt_count: 1, created_at: plus(T0, -5) });
  outbox(s, 'OUT-proc-stalled', { status: 'Processing', attempt_count: 1, created_at: plus(T0, -40) });
  outbox(s, 'OUT-cal', { action_type: 'CalendarCreate', status: 'NeedsReview', created_at: plus(T0, -10) });
  s.insert('Communications', { id: 'COMM-1', job_id: 'J-1', company_id: 'COMP-cef', type: 'MerchantOrder', subject: 'PO', body_snapshot: null, attachment_ids: null, recipients_snapshot: '[]', covered_week_start: null, delivery_date: null, revision: 1, status: 'Uncertain', approved_at: null, approved_by: null, sent_at: null, external_message_id: null, outbox_id: null, created_at: T0, created_by: 't', updated_at: plus(T0, -30), updated_by: 't', version: 1, commit_id: 'c' });
  s.insert('CommitJournal', { id: 'CJ-1', commit_id: 'c1', state: 'RecoveryRequired', command_id: 'X1', entity_type: 'Jobs', entity_id: 'J-1', expected_version: 1, changes_json: '{}', prepared_at: plus(T0, -3), committed_at: null, created_at: T0 });
  s.insert('CommitJournal', { id: 'CJ-2', commit_id: 'c2', state: 'Prepared', command_id: 'X2', entity_type: 'Tasks', entity_id: 'T-1', expected_version: 1, changes_json: '{}', prepared_at: plus(T0, -2), committed_at: null, created_at: T0 });
  s.insert('HealthChecks', { id: 'HC-1', integration: 'S16-system', checked_at: plus(T0, -60), outcome: 'Healthy', last_success: plus(T0, -60), error_code: null, next_action_task_id: null, created_at: T0, commit_id: 'c' });
  const q = rs._rsReviewQueue(s, { at: T0 });
  assert.deepEqual(q.items.map(i => i.id).sort(), ['CJ-1', 'COMM-1', 'OUT-cal', 'OUT-nr', 'OUT-proc-stalled', 'OUT-rd']);
  assert.deepEqual(q.by_kind, { Outbox: 4, Communications: 1, CommitJournal: 1 });
  assert.equal(q.items.find(i => i.id === 'OUT-proc-stalled').status, 'ProcessingStalled');
  assert.equal(q.items.find(i => i.id === 'OUT-cal').owner_service, 'CalendarService');
  assert.equal(q.items.find(i => i.id === 'OUT-nr').job_id, 'J-1');
  assert.equal(q.items[0].id, 'OUT-nr', 'oldest first');
  assert.equal(q.indicators.pending_outbox, 1);
  assert.equal(q.indicators.oldest_pending_outbox_at, T0);
  assert.equal(q.indicators.last_health_success_at, plus(T0, -60));
  const before = copy(s.tables); rs._rsReviewQueue(s, { at: T0 }); assert.deepEqual(s.tables, before);
});

test('RS 02: review tasks are raised once per uncertain item (not for pending retries), owned by Tanya with Ben backup; replay reuses', () => {
  const s = makeStore();
  outbox(s, 'OUT-nr', { status: 'NeedsReview', attempt_count: 5 });
  outbox(s, 'OUT-rd', { status: 'RetryDue', attempt_count: 1 });
  s.insert('CommitJournal', { id: 'CJ-1', commit_id: 'c1', state: 'RecoveryRequired', command_id: 'X1', entity_type: 'Jobs', entity_id: 'J-1', expected_version: 1, changes_json: '{}', prepared_at: T0, committed_at: null, created_at: T0 });
  const r = rs._rsRaiseReviewTasks(s, CMD('SW-1'));
  assert.equal(r.created.length, 2);
  assert.deepEqual(r.created.map(c => c.kind).sort(), ['CommitJournal', 'Outbox']);
  const t = s.get('Tasks', 'TASK-RS-RS-REVIEW-Outbox-OUT-nr');
  assert.equal(t.owner_id, 'PERSON-tanya');
  assert.equal(t.backup_id, 'PERSON-ben');
  assert.equal(t.group, 'System');
  assert.equal(t.job_id, 'J-1');
  assert.match(t.title, /Review uncertain outbound outcome — Email OUT-nr \(NeedsReview\)/);
  assert.equal(s.get('Tasks', 'TASK-RS-RS-RECOVERY-CommitJournal-CJ-1').template_code, 'RS-RECOVERY');
  const again = rs._rsRaiseReviewTasks(s, CMD('SW-2'));
  assert.equal(again.created.length, 0);
  assert.equal(again.reused.length, 2);
  assert.equal(s.tables.Tasks.length, 2);
  s.update('ReleaseModes', 'RM-FN14', { mode: 'Disabled', authorised_job_scope: 'None' });
  assert.throws(() => rs._rsRaiseReviewTasks(s, CMD('SW-3')), /FN-14 must be Automated/);
});

test('RS 03: failure alerts — one task per component per day from health issues, failing heartbeats, recovery and exhausted retries', () => {
  const s = makeStore();
  s.insert('HealthChecks', { id: 'HB-1', integration: 'Processing:AppSheetBridge', checked_at: plus(T0, -10), outcome: 'FAILED', last_success: plus(T0, -300), error_code: 'LOCK', next_action_task_id: null, created_at: T0, commit_id: 'c' });
  s.insert('HealthChecks', { id: 'HB-2', integration: 'Processing:Intake', checked_at: plus(T0, -10), outcome: 'OK', last_success: plus(T0, -10), error_code: null, next_action_task_id: null, created_at: T0, commit_id: 'c' });
  outbox(s, 'OUT-nr', { status: 'NeedsReview', attempt_count: 5 });
  s.insert('CommitJournal', { id: 'CJ-1', commit_id: 'c1', state: 'RecoveryRequired', command_id: 'X1', entity_type: 'Jobs', entity_id: 'J-1', expected_version: 1, changes_json: '{}', prepared_at: T0, committed_at: null, created_at: T0 });
  const health = { issues: [{ component: 'ReleaseModes', detail: 'inconsistent' }], warnings: [{ component: 'Heartbeat:Outbox', state: 'Stale', detail: 'no success 200 min' }, { component: 'Outbox', state: null, detail: 'x' }] };
  const r = rs._rsFailureAlerts(s, CMD('AL-1', { health }));
  assert.deepEqual(r.alerts.map(a => a.component + ':' + a.severity).sort(), ['CommitJournal:Critical', 'Heartbeat:AppSheetBridge:Critical', 'Heartbeat:Outbox:Warning', 'Outbox:Warning', 'ReleaseModes:Critical']);
  assert.equal(r.created.length, 5);
  assert.match(r.manual_check, /SYS01/);
  const t = s.get('Tasks', 'TASK-RS-RS-ALERT-Heartbeat:AppSheetBridge-2026-09-14');
  assert.equal(t.template_code, 'RS-ALERT');
  assert.match(t.title, /Critical Heartbeat:AppSheetBridge/);
  assert.equal(rs._rsFailureAlerts(s, CMD('AL-2', { health })).created.length, 0, 'same day → reused');
  assert.equal(rs._rsFailureAlerts(s, CMD('AL-3', { health, at: plus(T0, 24 * 60) })).created.length, 5, 'next day → new alerts');
  /* No alerts when healthy. */
  const s2 = makeStore();
  assert.deepEqual(rs._rsFailureAlerts(s2, CMD('AL-4')).alerts, []);
});

test('RS 04: resolving a non-calendar outbox item completes its review task; calendar rows are refused here; idempotent', () => {
  const s = makeStore();
  outbox(s, 'OUT-nr', { status: 'NeedsReview', attempt_count: 5 });
  outbox(s, 'OUT-cal', { action_type: 'CalendarCancel', status: 'NeedsReview' });
  outbox(s, 'OUT-ok', { status: 'Succeeded' });
  rs._rsRaiseReviewTasks(s, CMD('SW-1'));
  assert.throws(() => rs._rsResolveOutbox(s, CMD('RES-0', { outbox_id: 'OUT-nr', resolution: 'MarkSucceeded', reason: 'x' })), /external_id required/);
  assert.throws(() => rs._rsResolveOutbox(s, CMD('RES-0b', { outbox_id: 'OUT-nr', resolution: 'Delete', reason: 'x' })), /resolution must be/);
  assert.throws(() => rs._rsResolveOutbox(s, CMD('RES-0c', { outbox_id: 'OUT-cal', resolution: 'Cancel', reason: 'x' })), /resolved by the calendar service/);
  assert.throws(() => rs._rsResolveOutbox(s, CMD('RES-0d', { outbox_id: 'OUT-ok', resolution: 'Cancel', reason: 'x' })), /not reviewable/);
  const r = rs._rsResolveOutbox(s, CMD('RES-1', { outbox_id: 'OUT-nr', resolution: 'MarkSucceeded', external_id: 'MSG-123', reason: 'Supplier confirmed receipt by phone' }));
  assert.equal(r.status, 'Succeeded');
  assert.equal(r.completed_tasks.length, 1);
  assert.equal(s.get('Outbox', 'OUT-nr').external_id, 'MSG-123');
  assert.equal(s.get('Tasks', 'TASK-RS-RS-REVIEW-Outbox-OUT-nr').status, 'Complete');
  assert.equal(rs._rsResolveOutbox(s, CMD('RES-1', { outbox_id: 'OUT-nr', resolution: 'MarkSucceeded', external_id: 'OTHER', reason: 'again' })).replay, true);
  assert.equal(s.get('Outbox', 'OUT-nr').external_id, 'MSG-123');
  outbox(s, 'OUT-r', { status: 'NeedsReview' });
  assert.equal(rs._rsResolveOutbox(s, CMD('RES-2', { outbox_id: 'OUT-r', resolution: 'Retry', reason: 'Transient' })).status, 'Pending');
  outbox(s, 'OUT-c', { status: 'RetryDue' });
  assert.equal(rs._rsResolveOutbox(s, CMD('RES-3', { outbox_id: 'OUT-c', resolution: 'Cancel', reason: 'Superseded' })).status, 'Cancelled');
});

/* S13-shaped stages and XeroInvoice intents (S13's own builders are scope-gated to their synthetic fixture jobs). */
function withStages(s) {
  s.update('ReleaseModes', 'RM-FN09', { mode: 'Automated', authorised_job_scope: 'Pilot' });
  const meta = { created_at: T0, created_by: 'S13', updated_at: T0, updated_by: 'S13', version: 1, source_system: 'S13', commit_id: 'S13' };
  for (const [stage, net, vat] of [['Deposit', 100000, 20000], ['Interim', 140000, 28000], ['Final', 160000, 32000]]) {
    s.insert('InvoiceStages', { id: 'IS-J-1-' + stage, job_id: 'J-1', stage, amount_net_pence: net, vat_pence: vat, gross_pence: net + vat, due_date: null, status: 'Pending', xero_invoice_id: null, invoice_number: null, xero_contact_id: null, reference: null, request_id: null, last_synced_at: null, source_status: null, sent_at: null, cancelled_at: null, ...meta });
  }
  for (const stage of ['Deposit', 'Interim']) s.insert('Outbox', { id: 'XI-J-1-' + stage, idempotency_key: 'S13-XERO-J-1-' + stage, action_type: 'XeroInvoice', target: 'NOT_CONFIGURED', payload_hash: JSON.stringify({ job_id: 'J-1', stage, gross_pence: s.get('InvoiceStages', 'IS-J-1-' + stage).gross_pence }), job_revision: 1, attempt_count: 0, next_attempt: null, external_id: null, response_summary: 'CAPTURE_ONLY: no Xero API call', correlation_id: 'XI-J-1-' + stage, status: 'Pending', created_at: T0, commit_id: 'XI-J-1-' + stage });
  return s;
}
const LIVE = { environment: 'DEV', xeroMode: 'LIVE' }, OFF = { environment: 'DEV' };

test('XO 01: requests build envelopes from S13 intents with Job-ID+stage reference and flag blockers; disabled by default', () => {
  const s = withStages(makeStore());
  const r = xo._xoRequests(s, { config: OFF });
  assert.equal(r.xero_mode, 'DISABLED');
  assert.equal(r.live_ready, false);
  assert.equal(r.intents, 2);
  const dep = r.envelopes.find(e => e.stage === 'Deposit');
  assert.equal(dep.reference, 'SS-0001-DEP');
  assert.equal(dep.amounts.gross_pence, 120000);
  assert.equal(dep.create_as, 'DRAFT');
  assert.equal(dep.contact.name, 'Ann Smith');
  assert.deepEqual(dep.blockers, ['CONTACT_NOT_CONFIGURED']);
  assert.equal(r.blocked, 2);
  const d = xo._xoDispatch(s, { actor: 'PERSON-tanya', config: OFF, at: T0 });
  assert.equal(d.xero_mode, 'DISABLED');
  assert.equal(d.skipped.length, 2);
  assert.equal(d.external_calls, 0);
  assert.match(d.summary, /DISABLED/);
  assert.ok(s.tables.Outbox.every(o => o.status === 'Pending'), 'nothing touched');
  /* LIVE without a transport is refused: the module never invents an endpoint. */
  assert.throws(() => xo._xoDispatch(s, { actor: 'PERSON-tanya', command_id: 'D', config: LIVE, at: T0 }), /no approved transport injected/);
  s.update('ReleaseModes', 'RM-FN09', { mode: 'Disabled', authorised_job_scope: 'None' });
  assert.throws(() => xo._xoDispatch(s, { actor: 'PERSON-tanya', command_id: 'D', config: LIVE, transport: () => ({ accepted: true }), at: T0 }), /FN-09 must be Automated\/Pilot\/R4/);
  assert.throws(() => xo._xoDispatch(s, { actor: 'PERSON-tanya', config: { ...LIVE, environment: 'PROD' }, at: T0 }), /config.environment must be DEV/);
});

test('XO 02: LIVE dispatch with an injected transport marks Processing first, stores request ids, handles accepted/uncertain/transient; blockers go to review', () => {
  const s = withStages(makeStore());
  s.update('InvoiceStages', 'IS-J-1-Deposit', { xero_contact_id: 'XC-1' });
  const sent = [];
  const d = xo._xoDispatch(s, { actor: 'PERSON-tanya', command_id: 'D1', config: LIVE, at: T0, transport: env => { sent.push(env); return { accepted: true, request_ref: 'ZAP-1' }; } });
  assert.equal(d.external_calls, 1, 'only the unblocked intent was sent');
  assert.equal(sent[0].reference, 'SS-0001-DEP');
  assert.equal(sent[0].request_id, 'XI-J-1-Deposit');
  const dep = s.get('Outbox', 'XI-J-1-Deposit'), intr = s.get('Outbox', 'XI-J-1-Interim');
  assert.equal(dep.status, 'Succeeded');
  assert.equal(dep.external_id, 'ZAP-1');
  assert.equal(dep.attempt_count, 1);
  assert.equal(s.get('InvoiceStages', 'IS-J-1-Deposit').request_id, 'XI-J-1-Deposit');
  assert.equal(intr.status, 'NeedsReview');
  assert.match(intr.response_summary, /CONTACT_NOT_CONFIGURED/);
  assert.ok(s.tables.AuditEvents.some(a => a.action === 'XeroRequestSent'));
  /* Uncertain (timeout) → NeedsReview, not retried blindly. */
  const s2 = withStages(makeStore()); s2.update('InvoiceStages', 'IS-J-1-Deposit', { xero_contact_id: 'XC-1' });
  xo._xoDispatch(s2, { actor: 'PERSON-tanya', command_id: 'D2', config: LIVE, at: T0, transport: () => { throw new Error('Request timed out'); } });
  assert.equal(s2.get('Outbox', 'XI-J-1-Deposit').status, 'NeedsReview');
  assert.match(s2.get('Outbox', 'XI-J-1-Deposit').response_summary, /UNCERTAIN_OUTCOME/);
  /* Transient error → RetryDue with backoff, then NeedsReview after max attempts. */
  const s3 = withStages(makeStore()); s3.update('InvoiceStages', 'IS-J-1-Deposit', { xero_contact_id: 'XC-1' });
  const fail = () => ({ error: 'HTTP 503' });
  xo._xoDispatch(s3, { actor: 'PERSON-tanya', command_id: 'D3', config: LIVE, at: T0, transport: fail });
  assert.equal(s3.get('Outbox', 'XI-J-1-Deposit').status, 'RetryDue');
  assert.equal(s3.get('Outbox', 'XI-J-1-Deposit').next_attempt, plus(T0, 2));
  xo._xoDispatch(s3, { actor: 'PERSON-tanya', command_id: 'D4', config: LIVE, at: plus(T0, 3), transport: fail });
  xo._xoDispatch(s3, { actor: 'PERSON-tanya', command_id: 'D5', config: LIVE, at: plus(T0, 10), transport: fail });
  assert.equal(s3.get('Outbox', 'XI-J-1-Deposit').status, 'NeedsReview');
  assert.match(s3.get('Outbox', 'XI-J-1-Deposit').response_summary, /MAX_RETRIES_EXCEEDED/);
});

test('XO 03: invoice callback stores returned ids idempotently, maps status, refuses conflicting ids; already-linked intents are blocked', () => {
  const s = withStages(makeStore());
  const r = xo._xoInvoiceCallback(s, CMD('CB-1', { request_id: 'XI-J-1-Deposit', xero_invoice_id: 'INV-001', invoice_number: 'INV-0001', source_status: 'DRAFT' }));
  assert.equal(r.stage_id, 'IS-J-1-Deposit');
  const st = s.get('InvoiceStages', 'IS-J-1-Deposit');
  assert.equal(st.xero_invoice_id, 'INV-001');
  assert.equal(st.invoice_number, 'INV-0001');
  assert.equal(st.status, 'Draft');
  assert.equal(st.source_status, 'DRAFT');
  assert.equal(s.get('Outbox', 'XI-J-1-Deposit').status, 'Succeeded');
  assert.equal(xo._xoInvoiceCallback(s, CMD('CB-1', { request_id: 'XI-J-1-Deposit', xero_invoice_id: 'INV-999' })).replay, true);
  assert.equal(s.get('InvoiceStages', 'IS-J-1-Deposit').xero_invoice_id, 'INV-001');
  assert.throws(() => xo._xoInvoiceCallback(s, CMD('CB-2', { request_id: 'XI-J-1-Deposit', xero_invoice_id: 'INV-777' })), /different Xero invoice/);
  assert.equal(s.get('Outbox', 'XI-J-1-Deposit').status, 'NeedsReview');
  assert.throws(() => xo._xoInvoiceCallback(s, CMD('CB-3', { request_id: 'nope', xero_invoice_id: 'X' })), /unknown request_id/);
  /* A stage already linked is never requested again. */
  const env = xo._xoEnvelope(s, s.get('Outbox', 'XI-J-1-Deposit'));
  assert.ok(env.blockers.includes('ALREADY_LINKED:INV-001'));
  /* A confirmed (Ben bank-checked) deposit keeps its Confirmed status. */
  s.update('InvoiceStages', 'IS-J-1-Interim', { status: 'Confirmed' });
  xo._xoInvoiceCallback(s, CMD('CB-4', { request_id: 'XI-J-1-Interim', xero_invoice_id: 'INV-002', source_status: 'AUTHORISED' }));
  assert.equal(s.get('InvoiceStages', 'IS-J-1-Interim').status, 'Confirmed');
  assert.equal(s.get('InvoiceStages', 'IS-J-1-Interim').xero_invoice_id, 'INV-002');
});

test('XO 04: payment callback records Reported payments idempotently, updates PartPaid/Paid, never touches manual bank checks', () => {
  const s = withStages(makeStore());
  xo._xoInvoiceCallback(s, CMD('CB-1', { request_id: 'XI-J-1-Deposit', xero_invoice_id: 'INV-001' }));
  const r1 = xo._xoPaymentCallback(s, CMD('P-1', { xero_invoice_id: 'INV-001', xero_payment_id: 'PAY-1', amount_pence: 50000, payment_date: '2026-09-10' }));
  assert.equal(r1.stage_status, 'PartPaid');
  assert.equal(r1.manual_bank_check_touched, false);
  const p = s.get('Payments', 'PAY-XERO-PAY-1');
  assert.equal(p.status, 'Reported');
  assert.equal(p.payment_date, '2026-09-10');
  assert.equal(xo._xoPaymentCallback(s, CMD('P-1b', { xero_invoice_id: 'INV-001', xero_payment_id: 'PAY-1', amount_pence: 50000 })).replay, true);
  const r2 = xo._xoPaymentCallback(s, CMD('P-2', { xero_invoice_id: 'INV-001', xero_payment_id: 'PAY-2', amount_pence: 70000 }));
  assert.equal(r2.stage_status, 'Paid');
  assert.equal(r2.paid_total_pence, 120000);
  assert.equal(s.tables.ManualBankChecks.length, 0);
  assert.throws(() => xo._xoPaymentCallback(s, CMD('P-3', { xero_invoice_id: 'INV-404', xero_payment_id: 'PAY-3', amount_pence: 1 })), /no invoice stage linked/);
  assert.throws(() => xo._xoPaymentCallback(s, CMD('P-4', { xero_invoice_id: 'INV-001', xero_payment_id: 'PAY-4', amount_pence: -5 })), /positive integer/);
});

test('XO 05: review/cancel creates a task and never deletes; action depends on the actual invoice status', () => {
  const s = withStages(makeStore());
  const r0 = xo._xoReviewCancelInvoice(s, CMD('RC-0', { stage_id: 'IS-J-1-Interim', reason: 'Job cancelled' }));
  assert.equal(r0.deleted, false);
  assert.match(r0.action, /no Xero invoice linked/);
  xo._xoInvoiceCallback(s, CMD('CB-1', { request_id: 'XI-J-1-Deposit', xero_invoice_id: 'INV-001', source_status: 'AUTHORISED' }));
  const r = xo._xoReviewCancelInvoice(s, CMD('RC-1', { stage_id: 'IS-J-1-Deposit', reason: 'Job cancelled' }));
  assert.equal(r.created, true);
  assert.match(r.action, /void\/credit/);
  const t = s.get('Tasks', r.task_id);
  assert.match(t.title, /^Review\/cancel Xero invoice/);
  assert.equal(t.owner_id, 'PERSON-tanya');
  assert.equal(t.group, 'Finance');
  assert.equal(xo._xoReviewCancelInvoice(s, CMD('RC-2', { stage_id: 'IS-J-1-Deposit', reason: 'again' })).created, false);
  assert.equal(s.get('InvoiceStages', 'IS-J-1-Deposit').xero_invoice_id, 'INV-001', 'nothing deleted or voided locally');
});

test('RSXO 06: bundles — namespaced, parse with all bundles, no UrlFetchApp/mail/Calendar/Drive anywhere in either bundle', () => {
  const files = fs.readdirSync('apps-script', { recursive: true }).filter(f => /\.(gs|js)$/.test(f));
  for (const [dir, file, re] of [['resilience/', 'apps-script/resilience/ResilienceReview.js', /^(?:RS_|_rs|runRs)/], ['xero/', 'apps-script/xero/XeroAdapter.js', /^(?:XO_|_xo|runXo)/]]) {
    const bundle = fs.readFileSync(file, 'utf8');
    const prior = files.filter(f => !f.startsWith(dir)).map(f => fs.readFileSync('apps-script/' + f, 'utf8')).join('\n');
    new vm.Script(prior + '\n' + bundle);
    for (const m of bundle.matchAll(/^(?:function|var|const|let)\s+([\w$]+)/gm)) assert.match(m[1], re, file);
    assert.doesNotMatch(bundle, /UrlFetchApp|fetch\(|CalendarApp|GmailApp|MailApp|DriveApp|deleteRow|deleteSheet|https:\/\/|module\.exports|use strict/, file);
  }
  const xb = fs.readFileSync('apps-script/xero/XeroAdapter.js', 'utf8');
  assert.doesNotMatch(xb, /xero\.com|api\.xero|zapier\.com|hooks\./, 'no endpoint of any kind');
  for (const fn of ['runRsReviewQueue', 'runRsSweep', 'runRsResolveOutbox']) assert.match(fs.readFileSync('apps-script/resilience/ResilienceReview.js', 'utf8'), new RegExp('function ' + fn + '\\('));
  for (const fn of ['runXoRequests', 'runXoDispatch', 'runXoInvoiceCallback', 'runXoPaymentCallback', 'runXoReviewCancelInvoice']) assert.match(xb, new RegExp('function ' + fn + '\\('));
});

test('RSXO 07: zero-arg cloud simulation — sweep raises tasks and alerts, resolve completes; Xero dispatch stays DISABLED and LIVE refuses without transport', () => {
  function ctxFor(file) {
    const ctx = vm.createContext({ console: { log() { } }, Intl, Date, JSON, Object, Array, Math, Number, String, RegExp, Error });
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx); return ctx;
  }
  const grids = {};
  const rsCtx = ctxFor('apps-script/resilience/ResilienceReview.js'), xoCtx = ctxFor('apps-script/xero/XeroAdapter.js');
  const headers = { ...rsCtx.RS_HEADERS, ...xoCtx.XO_HEADERS };
  for (const [n, h] of Object.entries(headers)) grids[n] = [Array.from(h)];
  const meta = { created_at: T0, created_by: 'seed', updated_at: T0, updated_by: 'seed', version: 1, commit_id: 'seed' };
  const rowOf = (n, obj) => grids[n][0].map(k => obj[k] ?? '');
  for (const r of seed.ReleaseModes) grids.ReleaseModes.push(rowOf('ReleaseModes', { ...r, version: 1, ...(r.function_id === 'FN-14' ? { mode: 'Automated', authorised_job_scope: 'Pilot' } : {}) }));
  for (const r of seed.People) grids.People.push(rowOf('People', { ...r, ...meta, source_system: 'seed' }));
  grids.Jobs.push(rowOf('Jobs', { id: 'J-1', job_id: 'SS-0001', customer_id: 'C-1', display_name: 'Cloud Job', workflow_stage: 'Booked', pilot_job: true, release_scope: 'R1', ...meta, source_system: 'S05' }));
  grids.Outbox.push(rowOf('Outbox', { id: 'OUT-nr', idempotency_key: 'k', action_type: 'Email', target: 'x', payload_hash: 'h', attempt_count: 5, status: 'NeedsReview', correlation_id: 'J-1', created_at: T0, commit_id: 'c' }));
  grids.Outbox.push(rowOf('Outbox', { id: 'XI-J-1-Deposit', idempotency_key: 'S13-XERO-J-1-Deposit', action_type: 'XeroInvoice', target: 'NOT_CONFIGURED', payload_hash: JSON.stringify({ job_id: 'J-1', stage: 'Deposit', gross_pence: 120000 }), attempt_count: 0, status: 'Pending', correlation_id: 'XI-J-1-Deposit', created_at: T0, commit_id: 'c' }));
  grids.InvoiceStages.push(rowOf('InvoiceStages', { id: 'IS-J-1-Deposit', job_id: 'J-1', stage: 'Deposit', amount_net_pence: 100000, vat_pence: 20000, gross_pence: 120000, status: 'Pending', ...meta, source_system: 'S13' }));
  const NOW = new Date().toISOString(); /* cloud entry points run at real time */
  grids.HealthChecks.push(rowOf('HealthChecks', { id: 'HB-1', integration: 'Processing:AppSheetBridge', checked_at: plus(NOW, -10), outcome: 'FAILED', last_success: plus(NOW, -500), error_code: 'LOCK', created_at: NOW, commit_id: 'c' }));
  const mkSheet = n => ({ getName: () => n, getLastColumn: () => grids[n][0].length, getLastRow: () => grids[n].length, getMaxRows: () => 5000, getRange(row, col, height = 1, width = 1) { return { getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => (grids[n][row + i - 1] || [])[col + j - 1] ?? '')); }, setValues(values) { values.forEach((r, i) => r.forEach((v, j) => { grids[n][row + i - 1] ??= []; grids[n][row + i - 1][col + j - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; })); return this; } }; } });
  let config = { environment: 'DEV' };
  for (const ctx of [rsCtx, xoCtx]) {
    ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => rs.RS_DEV_SHEET_ID, getSheets: () => Object.keys(grids).map(mkSheet) }), flush() { } };
    ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => JSON.stringify(config) }) };
    let busy = false; ctx.LockService = { getScriptLock: () => ({ tryLock() { if (busy) return false; busy = true; return true; }, releaseLock() { busy = false; } }) };
    ctx.Session = { getActiveUser: () => ({ getEmail: () => 'tanya@test.example.invalid' }) };
    for (const api of ['CalendarApp', 'UrlFetchApp', 'GmailApp', 'MailApp', 'DriveApp']) ctx[api] = new Proxy({}, { get() { throw new Error('EXTERNAL API FORBIDDEN'); } });
  }
  const q = rsCtx.runRsReviewQueue();
  assert.equal(q.pass, true, JSON.stringify(q));
  assert.equal(q.detail.count, 1);
  const sweep = rsCtx.runRsSweep();
  assert.equal(sweep.pass, true, JSON.stringify(sweep));
  assert.equal(sweep.detail.review_tasks.created.length, 1);
  assert.ok(sweep.detail.alerts.created.some(a => a.component === 'Heartbeat:AppSheetBridge'));
  assert.equal(rsCtx.runRsSweep().detail.review_tasks.created.length, 0, 'idempotent');
  const res = rsCtx.runRsResolveOutbox('OUT-nr', 'MarkSucceeded', 'MSG-1', 'Confirmed by phone');
  assert.equal(res.pass, true, JSON.stringify(res));
  const statusIdx = grids.Tasks[0].indexOf('status'), keyIdx = grids.Tasks[0].indexOf('instance_key');
  assert.equal(grids.Tasks.find(r => r[keyIdx] === 'RS-REVIEW-Outbox-OUT-nr')[statusIdx], 'Complete');
  /* Xero: disabled by default → nothing happens; LIVE refuses without transport. */
  const req = xoCtx.runXoRequests();
  assert.equal(req.pass, true, JSON.stringify(req));
  assert.equal(req.detail.xero_mode, 'DISABLED');
  const d = xoCtx.runXoDispatch();
  assert.equal(d.pass, true, JSON.stringify(d));
  assert.equal(d.detail.xero_mode, 'DISABLED');
  assert.equal(d.detail.external_calls, 0);
  config = { environment: 'DEV', xeroMode: 'LIVE' };
  const live = xoCtx.runXoDispatch();
  assert.equal(live.pass, false);
  assert.match(live.detail, /FN-09 must be Automated|no approved transport/);
  const outStatusIdx = grids.Outbox[0].indexOf('status');
  assert.equal(grids.Outbox.find(r => r[0] === 'XI-J-1-Deposit')[outStatusIdx], 'Pending', 'intent untouched');
  const cb = xoCtx.runXoInvoiceCallback('XI-J-1-Deposit', 'INV-001', 'INV-0001', 'DRAFT');
  assert.equal(cb.pass, true, JSON.stringify(cb));
  const rc = xoCtx.runXoReviewCancelInvoice('IS-J-1-Deposit', 'test');
  assert.equal(rc.pass, true, JSON.stringify(rc));
  assert.equal(rc.detail.deleted, false);
});
