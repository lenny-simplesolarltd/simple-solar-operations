const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const { jobFinancialSummary, reconcilePayments, invoiceStatusReport, createReportSnapshot, localDate } = require('../s14/reporting.js');
const { installBaseFixture, buildJob, seedStages, seedPayment, runFinancialSummary, runReconciliation, runInvoiceStatus, runSnapshot, runFinancialCompletion, runUnrelatedRowsUntouched } = require('../s14/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['InvoiceStages','Payments','Jobs','JobCosts','ReportSnapshots','Outbox','People','ReleaseModes'];
  for (const t of tables) data[t] = [];
  ['FN-09','FN-12'].forEach(function(id){data.ReleaseModes.push({id:'RM-'+id,function_id:id,function_name:'S14 '+id,mode:'Automated',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:'R4',planned_target_mode:'Automated',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test'});});
  return {
    getSheetId: () => DEV_SHEET_ID,
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('Dup: '+row.id); data[n].push(clone(row)); },
    update(n, id, p) { const r = (data[n]||[]).find(r => r.id === id); if (!r) throw new Error('NF: '+n+' '+id); Object.assign(r, p); }
  };
}

test('S14: financial summary — gross, invoiced, paid, outstanding, overdue', () => { const s = makeStore(); const r = runFinancialSummary(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.invoiced, 288000); assert.equal(r.paid, 120000); assert.equal(r.outstanding, 168000); assert.ok(r.overdue > 0); });
test('S14: financial summary — integer pence only', () => { const s = makeStore(); installBaseFixture(s); const job = buildJob(); s.insert('Jobs', job); seedStages(s, job.id); const r = jobFinancialSummary(job.id, s); assert.ok(Number.isSafeInteger(r.gross)); assert.ok(Number.isSafeInteger(r.invoiced)); });
test('S14: reconciliation — duplicate payment ref detected', () => { const s = makeStore(); const r = runReconciliation(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.ok(r.exceptions > 0); });
test('S14: reconciliation — overpayment detected', () => { const s = makeStore(); installBaseFixture(s); const job = buildJob(); s.insert('Jobs', job); seedStages(s, job.id); seedPayment(s, 'IS-'+job.id+'-deposit', 200000, 'XRO-OVER'); const r = reconcilePayments(job.id, s); assert.ok(r.exceptions.some(e => e.type === 'OVERPAYMENT')); });
test('S14: invoice status report', () => { const s = makeStore(); const r = runInvoiceStatus(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S14: report snapshot idempotent', () => { const s = makeStore(); const r = runSnapshot(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S14: financial completion — deposit+interim paid, Final absent → NOT complete', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildJob();
  s.insert('Jobs', job);
  seedStages(s, job.id);
  seedPayment(s, 'IS-'+job.id+'-deposit', 120000, 'XRO-001');
  seedPayment(s, 'IS-'+job.id+'-interim', 168000, 'XRO-002');
  const r = jobFinancialSummary(job.id, s, '2026-11-20');
  assert.equal(r.financially_complete, false);
});

test('S14: financial completion — zero stages → NOT complete', () => {
  const s = makeStore();
  const job = buildJob();
  s.insert('Jobs', job);
  const r = jobFinancialSummary(job.id, s);
  assert.equal(r.financially_complete, false);
});

test('S14: financial completion — operational milestone + all 3 paid → complete', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildJob();
  s.insert('Jobs', job);
  seedStages(s, job.id);
  s.update('Jobs', job.id, { operational_complete_at: '2026-12-01T00:00:00.000Z' });
  const n = '2026-12-01T00:00:00.000Z';
  s.insert('InvoiceStages', { id:'IS-'+job.id+'-final', job_id:job.id, stage:'final', amount_net_pence:160000, vat_pence:32000, gross_pence:192000, due_date:null, status:'Pending', xero_invoice_id:null, invoice_number:null, xero_contact_id:null, reference:null, request_id:null, last_synced_at:null, source_status:null, sent_at:null, cancelled_at:null, created_at:n, created_by:'S14', updated_at:n, updated_by:'S14', version:1, source_system:'S14', commit_id:'IS-'+job.id+'-final' });
  seedPayment(s, 'IS-'+job.id+'-deposit', 120000, 'XRO-001');
  seedPayment(s, 'IS-'+job.id+'-interim', 168000, 'XRO-002');
  seedPayment(s, 'IS-'+job.id+'-final', 192000, 'XRO-003');
  const r = jobFinancialSummary(job.id, s, '2026-12-01');
  assert.equal(r.financially_complete, true);
});

test('S14: financial completion — any stage outstanding → NOT complete', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildJob();
  s.insert('Jobs', job);
  seedStages(s, job.id);
  s.update('Jobs', job.id, { operational_complete_at: '2026-12-01T00:00:00.000Z' });
  s.insert('InvoiceStages', { id:'IS-'+job.id+'-final', job_id:job.id, stage:'final', amount_net_pence:160000, vat_pence:32000, gross_pence:192000, due_date:null, status:'Pending', xero_invoice_id:null, invoice_number:null, xero_contact_id:null, reference:null, request_id:null, last_synced_at:null, source_status:null, sent_at:null, cancelled_at:null, created_at:'2026-12-01T00:00:00.000Z', created_by:'S14', updated_at:'2026-12-01T00:00:00.000Z', updated_by:'S14', version:1, source_system:'S14', commit_id:'IS-'+job.id+'-final' });
  seedPayment(s, 'IS-'+job.id+'-deposit', 120000, 'XRO-001');
  seedPayment(s, 'IS-'+job.id+'-interim', 168000, 'XRO-002');
  // Final NOT paid
  const r = jobFinancialSummary(job.id, s, '2026-12-01');
  assert.equal(r.financially_complete, false);
});
test('S14: unrelated rows untouched', () => { const s = makeStore(); const r = runUnrelatedRowsUntouched(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S14: localDate handles Date objects and strings', () => { assert.equal(localDate('2026-11-13'), '2026-11-13'); assert.equal(localDate(new Date('2026-11-13T00:00:00Z')), '2026-11-13'); assert.equal(localDate(null), null); assert.equal(localDate(''), null); });
test('S14: missing job returns error', () => { const s = makeStore(); const r = jobFinancialSummary('J-none', s); assert.equal(r.error, 'JOB_NOT_FOUND'); });

test('S14: S14Reporting.js VM smoke test', () => {
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{},PropertiesService:{},Utilities:{}});
  vm.runInContext(fs.readFileSync('apps-script/s14/S14Reporting.js','utf8'), ctx);
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }
  var grids = {};
  ['InvoiceStages','Payments','Jobs','JobCosts','ReportSnapshots','Outbox','People','ReleaseModes'].forEach(function(tn){grids[tn]=[ctx.S14_HEADERS[tn]];});
  grids.ReleaseModes.push(mkRow({id:'RM-FN09',function_id:'FN-09',function_name:'Invoices',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R4',version:1}));
  grids.ReleaseModes.push(mkRow({id:'RM-FN12',function_id:'FN-12',function_name:'Accounting',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R4',version:1}));
  var sheets = {};
  for (let tn in grids) { sheets[tn] = {getName:function(){return tn;},getLastColumn:function(){return grids[tn][0].length;},getLastRow:function(){return grids[tn].length;},getMaxRows:function(){return 1000;},getRange:function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(vals){vals.forEach(function(rv,ri){rv.forEach(function(v,ci){if(!grids[tn][row-1+ri])grids[tn][row-1+ri]=[];grids[tn][row-1+ri][col-1+ci]=v;});});}};}}; }
  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  ctx.SpreadsheetApp = {getActiveSpreadsheet:function(){return mockSs;},flush:function(){}};
  ctx.PropertiesService = {getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}};
  ctx.Utilities = {DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:function(_,t){return Array.from(crypto.createHash('sha256').update(t).digest());}};
  var dr = ctx.runS14FixtureDryRun(); assert.equal(dr.pass, true);
  var ap = ctx.runS14FixtureApply(); assert.equal(ap.pass, true);
  var en = ctx.runS14EnableFunctionsForSyntheticTest(); assert.equal(en.pass, true);
  var rs = ctx.restoreS14SafeState(); assert.equal(rs.pass, true);
});
