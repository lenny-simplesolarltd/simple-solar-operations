/* Xero adapter — DISABLED BY DEFAULT. Authority: 01 §4 InvoiceStages/Payments/AccountingEvents, 01 finance ("Zapier creates the deposit
 * invoice and the interim/balance drafts once, using internal Job ID plus stage in the reference", "store returned IDs", "do not
 * automatically delete an authorised or paid Xero invoice … create a review task", "use verified connector/API functionality; do not
 * invent a Xero endpoint", "automatic sync never fabricates Ben's manual bank confirmation"), RA01 (R4; Xero stays external before),
 * AGENT_RUNBOOK §G ("Xero automation remains disabled until explicitly approved").
 *
 * This module builds request envelopes for the existing Zapier/Xero route from S13 XeroInvoice intents and records callbacks. It has NO
 * transport of its own: dispatch only proceeds when FN-09 is Automated/Pilot/R4, S01_CONFIG.xeroMode === 'LIVE' AND a transport function
 * is injected by an approved connector. Default result is DISABLED with no writes. No HTTP client service anywhere. DEV sheet only. */
'use strict';

var XO_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var XO_SERVICE = 'XeroAdapter';
var XO_STAGE_CODES = { Deposit: 'DEP', Interim: 'INT', Balance: 'BAL', Final: 'BAL', Variation: 'VAR', Finance: 'FIN', RefundReview: 'REF' };
var XO_MAX_ATTEMPTS = 3;

function _xoText(x) { return typeof x === 'string' && x.trim().length > 0; }
function _xoTrue(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1; }
function _xoRefuse(code) { var e = new Error(code); e.code = code; throw e; }
function _xoNow(input) { if (input && input.at) { var d = new Date(input.at); if (isNaN(d.getTime())) _xoRefuse('XO_DATE_INVALID'); return d.toISOString(); } return new Date().toISOString(); }
function _xoTs(v) { if (v === null || v === undefined || v === '') return null; if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.toISOString(); return String(v); }
function _xoGuardStore(store) { if (!store || !store.getSheetId || store.getSheetId() !== XO_DEV_SHEET_ID || !store.getEnvironment || store.getEnvironment() !== 'DEV') _xoRefuse('XO_REFUSED: exact DEV sheet/environment required'); }
function _xoMode(store) { var rows = store.list('ReleaseModes').filter(function (r) { return r.function_id === 'FN-09'; }); if (rows.length !== 1 || rows[0].target_release !== 'R4') _xoRefuse('XO_REFUSED: FN-09 ReleaseMode invalid'); return rows[0]; }
function _xoConfig(input) { var c = (input && input.config) || null; if (!c || typeof c !== 'object') _xoRefuse('XO_REFUSED: config required'); if (c.environment !== 'DEV') _xoRefuse('XO_REFUSED: config.environment must be DEV'); return { mode: c.xeroMode === 'LIVE' ? 'LIVE' : 'DISABLED' }; }
function _xoAudit(store, type, id, action, before, after, input, now, reason) {
  store.insert('AuditEvents', { id: 'AUD-XO-' + input.command_id + '-' + type + '-' + id + '-' + action, entity_type: type, entity_id: id, action: action, before_json: before ? JSON.stringify(before) : null, after_json: after ? JSON.stringify(after) : null, initiating_actor: input.actor, executing_service: XO_SERVICE, timestamp: now, correlation_id: input.command_id, reason: reason || input.reason || null, commit_id: 'XO-' + input.command_id, created_at: now });
}
function _xoOwner(store) { var office = store.list('People').filter(function (p) { return _xoTrue(p.active) && p.role === 'Office'; }); return office.filter(function (p) { return String(p.display_name || '').toLowerCase().indexOf('tanya') !== -1; })[0] || office[0] || null; }

/* --- 1. REQUEST ENVELOPES (pure) --- */

function _xoIntents(store) { return store.list('Outbox').filter(function (o) { return o.action_type === 'XeroInvoice'; }); }
function _xoStageFor(store, intent) {
  var p = null; try { p = JSON.parse(intent.payload_hash); } catch (e) { p = null; }
  var stageId = p && p.job_id && p.stage ? 'IS-' + p.job_id + '-' + p.stage : null;
  return { payload: p, stage: stageId ? store.get('InvoiceStages', stageId) : null };
}
function _xoEnvelope(store, intent) {
  var x = _xoStageFor(store, intent), s = x.stage;
  if (!s) return { ok: false, reason: 'STAGE_NOT_FOUND', intent_id: intent.id };
  var job = store.get('Jobs', s.job_id), customer = job ? store.get('Customers', job.customer_id) : null;
  var code = XO_STAGE_CODES[s.stage] || String(s.stage).toUpperCase().slice(0, 3);
  var reference = (job ? job.job_id : s.job_id) + '-' + code;
  return {
    ok: true, intent_id: intent.id, request_id: intent.id, idempotency_key: intent.idempotency_key, route: 'Zapier/Xero (existing authorised route)',
    job_id: s.job_id, job_reference: job ? job.job_id : null, stage: s.stage, reference: reference,
    contact: { xero_contact_id: s.xero_contact_id || 'NOT_CONFIGURED', name: customer ? (customer.first_name + ' ' + customer.last_name).trim() : (job ? job.display_name : null), email: customer ? (customer.email || 'NOT_CONFIGURED') : 'NOT_CONFIGURED' },
    amounts: { net_pence: Number(s.amount_net_pence || 0), vat_pence: Number(s.vat_pence || 0), gross_pence: Number(s.gross_pence || 0) },
    due_date: s.due_date ? _xoTs(s.due_date).slice(0, 10) : null, create_as: 'DRAFT', existing_xero_invoice_id: s.xero_invoice_id || null,
    blockers: [].concat(s.xero_invoice_id ? ['ALREADY_LINKED:' + s.xero_invoice_id] : [], !s.xero_contact_id || s.xero_contact_id === 'NOT_CONFIGURED' ? ['CONTACT_NOT_CONFIGURED'] : [], Number(s.gross_pence || 0) <= 0 ? ['ZERO_AMOUNT'] : [])
  };
}
function _xoRequests(store, input) {
  _xoGuardStore(store);
  var config = input && input.config ? _xoConfig(input) : { mode: 'NOT_CONFIGURED' }, mode = _xoMode(store);
  var envelopes = _xoIntents(store).map(function (i) { var e = _xoEnvelope(store, i); e.outbox_status = i.status; e.attempts = Number(i.attempt_count || 0); return e; });
  return { xero_mode: config.mode, release_mode: { mode: mode.mode, scope: mode.authorised_job_scope }, live_ready: config.mode === 'LIVE' && mode.mode === 'Automated' && mode.authorised_job_scope === 'Pilot', intents: envelopes.length, pending: envelopes.filter(function (e) { return e.outbox_status === 'Pending'; }).length, blocked: envelopes.filter(function (e) { return e.ok && e.blockers.length; }).length, envelopes: envelopes };
}

/* --- 2. DISPATCH — disabled by default; transport must be injected by an approved connector --- */

function _xoDispatch(store, input) {
  _xoGuardStore(store);
  input = input || {};
  if (!_xoText(input.actor)) _xoRefuse('XO_REVIEW: actor required');
  var config = _xoConfig(input), mode = _xoMode(store), now = _xoNow(input);
  var due = _xoIntents(store).filter(function (o) { return o.status === 'Pending' || o.status === 'RetryDue'; });
  var base = { xero_mode: config.mode, release_mode: mode.mode + '/' + mode.authorised_job_scope, due: due.length, processed: [], skipped: [], external_calls: 0 };
  if (config.mode !== 'LIVE') { base.skipped = due.map(function (o) { return { outbox_id: o.id, reason: 'XERO_DISABLED' }; }); base.summary = 'DISABLED: Xero automation is not enabled (S01_CONFIG.xeroMode); ' + due.length + ' intent(s) left pending; no request built, nothing sent'; return base; }
  if (mode.mode !== 'Automated' || mode.authorised_job_scope !== 'Pilot') _xoRefuse('XO_REFUSED: FN-09 must be Automated/Pilot/R4 for LIVE dispatch (got ' + mode.mode + '/' + mode.authorised_job_scope + ')');
  if (typeof input.transport !== 'function') _xoRefuse('XO_REFUSED: no approved transport injected; this module never invents a Xero endpoint');
  if (!_xoText(input.command_id)) _xoRefuse('XO_REVIEW: command_id required');
  due.slice(0, Number(input.limit) > 0 ? Number(input.limit) : 20).forEach(function (o) {
    var env = _xoEnvelope(store, o);
    if (!env.ok) { store.update('Outbox', o.id, { status: 'NeedsReview', response_summary: 'NEEDS_REVIEW ' + env.reason }); base.processed.push({ outbox_id: o.id, outcome: 'NeedsReview', code: env.reason }); return; }
    if (env.blockers.length) { store.update('Outbox', o.id, { status: 'NeedsReview', response_summary: 'NEEDS_REVIEW ' + env.blockers.join(',') }); base.processed.push({ outbox_id: o.id, outcome: 'NeedsReview', code: env.blockers.join(',') }); return; }
    var attempt = Number(o.attempt_count || 0) + 1;
    store.update('Outbox', o.id, { status: 'Processing', attempt_count: attempt });
    var stage = store.get('InvoiceStages', 'IS-' + env.job_id + '-' + env.stage);
    store.update('InvoiceStages', stage.id, { request_id: env.request_id, updated_at: now, updated_by: input.actor, version: Number(stage.version || 0) + 1 });
    var res; try { base.external_calls++; res = input.transport(env); } catch (e) { res = { error: String(e && e.message ? e.message : e) }; }
    if (res && res.accepted === true) { store.update('Outbox', o.id, { status: 'Succeeded', external_id: res.request_ref || env.request_id, response_summary: 'REQUESTED via Zapier/Xero route ' + (res.request_ref || '') + '; awaiting callback' }); _xoAudit(store, 'InvoiceStages', stage.id, 'XeroRequestSent', null, { request_id: env.request_id, reference: env.reference, request_ref: res.request_ref || null }, input, now, 'Invoice request submitted to the authorised route'); base.processed.push({ outbox_id: o.id, outcome: 'Requested', request_id: env.request_id }); return; }
    var uncertain = !res || res.error === undefined || /timeout|timed out|uncertain/i.test(String(res.error));
    if (uncertain || attempt >= XO_MAX_ATTEMPTS) { store.update('Outbox', o.id, { status: 'NeedsReview', response_summary: 'NEEDS_REVIEW ' + (uncertain ? 'UNCERTAIN_OUTCOME' : 'MAX_RETRIES_EXCEEDED') + ': ' + String(res && res.error || 'no response') }); _xoAudit(store, 'InvoiceStages', stage.id, 'XeroRequestUncertain', null, { request_id: env.request_id, error: res && res.error }, input, now, 'Uncertain outcome — reconcile by reference before retry'); base.processed.push({ outbox_id: o.id, outcome: 'NeedsReview', code: uncertain ? 'UNCERTAIN_OUTCOME' : 'MAX_RETRIES_EXCEEDED' }); return; }
    store.update('Outbox', o.id, { status: 'RetryDue', next_attempt: new Date(new Date(now).getTime() + Math.pow(2, attempt) * 60000).toISOString(), response_summary: 'RETRY_DUE attempt ' + attempt + ': ' + res.error });
    base.processed.push({ outbox_id: o.id, outcome: 'RetryDue', attempt: attempt });
  });
  base.summary = 'LIVE: ' + base.processed.length + ' processed';
  return base;
}

/* --- 3. CALLBACKS (store returned IDs; idempotent; never fabricate bank confirmation) --- */

function _xoInvoiceCallback(store, input) {
  _xoGuardStore(store);
  input = input || {};
  if (!_xoText(input.actor) || !_xoText(input.command_id) || !_xoText(input.request_id) || !_xoText(input.xero_invoice_id)) _xoRefuse('XO_REVIEW: actor, command_id, request_id and xero_invoice_id required');
  var auditId = 'AUD-XO-' + input.command_id + '-InvoiceStages-callback-' + input.request_id + '-XeroInvoiceLinked';
  if (store.get('AuditEvents', auditId)) return { replay: true, request_id: input.request_id };
  var intent = store.get('Outbox', input.request_id); if (!intent || intent.action_type !== 'XeroInvoice') _xoRefuse('XO_REVIEW: unknown request_id');
  var x = _xoStageFor(store, intent), stage = x.stage; if (!stage) _xoRefuse('XO_REVIEW: invoice stage not found for request');
  if (_xoText(stage.xero_invoice_id) && stage.xero_invoice_id !== input.xero_invoice_id.trim()) { store.update('Outbox', intent.id, { status: 'NeedsReview', response_summary: 'NEEDS_REVIEW CONFLICTING_XERO_ID existing ' + stage.xero_invoice_id + ' callback ' + input.xero_invoice_id }); _xoRefuse('XO_REVIEW: stage already linked to a different Xero invoice; review required'); }
  var now = _xoNow(input), before = JSON.parse(JSON.stringify(stage));
  var sourceStatus = _xoText(input.source_status) ? input.source_status.trim().toUpperCase() : 'DRAFT';
  var mapped = sourceStatus === 'AUTHORISED' ? 'Authorised' : sourceStatus === 'PAID' ? 'Paid' : sourceStatus === 'VOIDED' ? 'Voided' : 'Draft';
  var patch = { xero_invoice_id: input.xero_invoice_id.trim(), invoice_number: _xoText(input.invoice_number) ? input.invoice_number.trim() : stage.invoice_number, source_status: sourceStatus, last_synced_at: now, request_id: intent.id, updated_at: now, updated_by: input.actor, version: Number(stage.version || 0) + 1 };
  if (['Pending', 'Planned', 'Draft', 'Authorised'].indexOf(stage.status) !== -1 && stage.status !== 'Confirmed') patch.status = mapped;
  store.update('InvoiceStages', stage.id, patch);
  store.update('Outbox', intent.id, { status: 'Succeeded', external_id: input.xero_invoice_id.trim(), response_summary: 'LINKED Xero invoice ' + input.xero_invoice_id.trim() + ' (' + sourceStatus + ')' });
  store.insert('AuditEvents', { id: auditId, entity_type: 'InvoiceStages', entity_id: stage.id, action: 'XeroInvoiceLinked', before_json: JSON.stringify(before), after_json: JSON.stringify(store.get('InvoiceStages', stage.id)), initiating_actor: input.actor, executing_service: XO_SERVICE, timestamp: now, correlation_id: input.command_id, reason: 'Callback from authorised Zapier/Xero route', commit_id: 'XO-' + input.command_id, created_at: now });
  return { replay: false, request_id: intent.id, stage_id: stage.id, xero_invoice_id: patch.xero_invoice_id, status: patch.status || stage.status, external_calls: 0 };
}
function _xoPaymentCallback(store, input) {
  _xoGuardStore(store);
  input = input || {};
  if (!_xoText(input.actor) || !_xoText(input.command_id) || !_xoText(input.xero_payment_id) || !_xoText(input.xero_invoice_id)) _xoRefuse('XO_REVIEW: actor, command_id, xero_invoice_id and xero_payment_id required');
  var amount = Number(input.amount_pence); if (!(amount > 0) || !Number.isInteger(amount)) _xoRefuse('XO_REVIEW: amount_pence must be a positive integer');
  var stage = store.list('InvoiceStages').filter(function (s) { return s.xero_invoice_id === input.xero_invoice_id.trim(); })[0]; if (!stage) _xoRefuse('XO_REVIEW: no invoice stage linked to ' + input.xero_invoice_id);
  var id = 'PAY-XERO-' + input.xero_payment_id.trim();
  var existing = store.get('Payments', id); if (existing) return { replay: true, payment_id: id, stage_id: stage.id };
  var now = _xoNow(input), date = _xoText(input.payment_date) ? input.payment_date.slice(0, 10) : now.slice(0, 10);
  store.insert('Payments', { id: id, invoice_stage_id: stage.id, xero_payment_id: input.xero_payment_id.trim(), amount_pence: amount, payment_date: date, status: 'Reported', reconciliation_evidence: input.evidence || null, last_synced_at: now, created_at: now, commit_id: 'XO-' + input.command_id });
  var paid = store.list('Payments').filter(function (p) { return p.invoice_stage_id === stage.id && p.status !== 'Reversed'; }).reduce(function (n, p) { return n + Number(p.amount_pence || 0); }, 0);
  var newStatus = paid >= Number(stage.gross_pence || 0) ? 'Paid' : 'PartPaid';
  if (stage.status !== 'Confirmed') store.update('InvoiceStages', stage.id, { status: newStatus, last_synced_at: now, updated_at: now, updated_by: input.actor, version: Number(stage.version || 0) + 1 });
  _xoAudit(store, 'Payments', id, 'XeroPaymentReported', null, { stage_id: stage.id, amount_pence: amount, paid_total_pence: paid, stage_status: newStatus }, input, now, 'Payment reported by Xero; Reported until reconciled. Manual bank confirmation is never inferred from this.');
  return { replay: false, payment_id: id, stage_id: stage.id, paid_total_pence: paid, stage_status: newStatus, manual_bank_check_touched: false, external_calls: 0 };
}

/* --- 4. REVIEW/CANCEL INVOICE — never deletes; creates the review task the spec requires --- */

function _xoReviewCancelInvoice(store, input) {
  _xoGuardStore(store);
  input = input || {};
  if (!_xoText(input.actor) || !_xoText(input.command_id) || !_xoText(input.stage_id) || !_xoText(input.reason)) _xoRefuse('XO_REVIEW: actor, command_id, stage_id and reason required');
  var stage = store.get('InvoiceStages', input.stage_id); if (!stage) _xoRefuse('XO_REVIEW: invoice stage not found');
  var key = 'XO-REVIEW-CANCEL-' + stage.id, existing = store.list('Tasks').filter(function (t) { return t.instance_key === key && ['Complete', 'Cancelled', 'NotRequired'].indexOf(t.status) === -1; })[0];
  if (existing) return { created: false, task_id: existing.id, stage_id: stage.id };
  var owner = _xoOwner(store); if (!owner) _xoRefuse('XO_CONFIG: active Office owner required');
  var now = _xoNow(input), action = stage.xero_invoice_id ? (['Authorised', 'Paid', 'PartPaid'].indexOf(stage.status) !== -1 || /AUTHORISED|PAID/.test(String(stage.source_status || '')) ? 'void/credit via supported Xero action' : 'delete draft via supported Xero action') : 'no Xero invoice linked — cancel locally after review';
  var task = { id: 'TASK-' + key, job_id: stage.job_id, template_code: 'XO-REVIEW-CANCEL', instance_key: key, group: 'Finance', title: 'Review/cancel Xero invoice — ' + stage.stage + ' ' + (stage.invoice_number || stage.xero_invoice_id || stage.id) + ' (' + action + ')', owner_id: owner.id, backup_id: null, related_entity_type: 'InvoiceStages', related_entity_id: stage.id, due_at: now, original_due_at: now, priority: 1, status: 'Open', blocking_reason: null, next_followup_at: null, completed_at: null, completed_by: null, completion_note: null, evidence_id: null, revision_required: false, created_rule_version: 'XO-1.0', created_at: now, created_by: input.actor, updated_at: now, updated_by: input.actor, version: 1, source_system: XO_SERVICE, commit_id: 'XO-' + input.command_id };
  store.insert('Tasks', task);
  _xoAudit(store, 'InvoiceStages', stage.id, 'ReviewCancelRequested', null, { task_id: task.id, action: action, reason: input.reason }, input, now);
  return { created: true, task_id: task.id, stage_id: stage.id, action: action, deleted: false, external_calls: 0 };
}

if (typeof module !== 'undefined') {
  module.exports = { XO_DEV_SHEET_ID, XO_STAGE_CODES, XO_MAX_ATTEMPTS, _xoRequests, _xoEnvelope, _xoDispatch, _xoInvoiceCallback, _xoPaymentCallback, _xoReviewCancelInvoice, _xoGuardStore };
}
