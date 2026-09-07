const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const { buildInvoiceStages, confirmDeposit, createInterimChaseTask, createGHLTask, processJobPayments, STAGES } = require('../s13/payments.js');
const { installBaseFixture, buildJob, runStageSplit, runDepositConfirm, runDepositIdempotent, runInterimFriday, runInterimChase, runProcessJobPayments, runFinalGatedByOperationalMilestone, runNoRealOutbound, runUnrelatedRowsUntouched } = require('../s13/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['InvoiceStages','Payments','GHLTasks','Jobs','Tasks','Outbox','People','PersonRoles','ReleaseModes'];
  for (const t of tables) data[t] = [];
  ['FN-09','FN-11','FN-15'].forEach(function(id,i){data.ReleaseModes.push({id:'RM-'+id,function_id:id,function_name:'S13 '+id,mode:id==='FN-09'?'Automated':'Manual',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:id==='FN-09'?'R4':'R1',planned_target_mode:id==='FN-09'?'Automated':'Manual',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test'});});
  return {
    getSheetId: () => DEV_SHEET_ID,
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('Dup: '+row.id); data[n].push(clone(row)); },
    update(n, id, p) { const r = (data[n]||[]).find(r => r.id === id); if (!r) throw new Error('NF: '+n+' '+id); Object.assign(r, p); }
  };
}

test('S13: stage split 25/35 (Final gated)', () => { const s = makeStore(); const r = runStageSplit(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: stage amounts are integer pence', () => { const s = makeStore(); installBaseFixture(s); const job = buildJob(); s.insert('Jobs', job); buildInvoiceStages(job.id, 480000, s); const stages = s.list('InvoiceStages'); for (const st of stages) { assert.equal(typeof st.gross_pence, 'number'); assert.ok(Number.isSafeInteger(st.gross_pence)); } });
test('S13: deposit confirmed by Ben', () => { const s = makeStore(); const r = runDepositConfirm(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: deposit idempotent', () => { const s = makeStore(); const r = runDepositIdempotent(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: interim due Friday before install', () => { const s = makeStore(); const r = runInterimFriday(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.due_date, '2026-11-13'); });
test('S13: interim chase task created once', () => { const s = makeStore(); const r = runInterimChase(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: GHL task created once', () => { const s = makeStore(); installBaseFixture(s); const job = buildJob(); s.insert('Jobs', job); const r1 = createGHLTask(s, job.id); const r2 = createGHLTask(s, job.id); assert.equal(r1.created, true); assert.equal(r2.created, false); });
test('S13: full payment processing', () => { const s = makeStore(); const r = runProcessJobPayments(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: no real Xero calls', () => { const s = makeStore(); const r = runNoRealOutbound(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: unrelated rows untouched', () => { const s = makeStore(); const r = runUnrelatedRowsUntouched(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S13: unpaid interim does NOT block install', () => { const s = makeStore(); installBaseFixture(s); const job = buildJob(); s.insert('Jobs', job); processJobPayments(job.id, s); const j = s.get('Jobs', job.id); assert.equal(j.workflow_stage, 'Booked'); });
test('S13: Final gated by operational milestone', () => { const s = makeStore(); const r = runFinalGatedByOperationalMilestone(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.final_created, true); });

test('S13: S13Payments.js VM smoke test', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{},PropertiesService:{},Utilities:{}});
  vm.runInContext(fs.readFileSync('apps-script/s13/S13Payments.js','utf8'), ctx);
  var grids = {};
  ['InvoiceStages','Payments','GHLTasks','Jobs','Tasks','Outbox','People','PersonRoles','ReleaseModes'].forEach(function(tn){grids[tn]=[ctx.S13_HEADERS[tn]];});
  grids.ReleaseModes.push(mkRow({id:'RM-FN09',function_id:'FN-09',function_name:'Invoices',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R4',version:1}));
  grids.ReleaseModes.push(mkRow({id:'RM-FN11',function_id:'FN-11',function_name:'GHL',mode:'Manual',authorised_job_scope:'Pilot',target_release:'R1',version:1}));
  grids.ReleaseModes.push(mkRow({id:'RM-FN15',function_id:'FN-15',function_name:'Deposit',mode:'Manual',authorised_job_scope:'Pilot',target_release:'R1',version:1}));
  var sheets = {};
  for (let tn in grids) { sheets[tn] = {getName:function(){return tn;},getLastColumn:function(){return grids[tn][0].length;},getLastRow:function(){return grids[tn].length;},getMaxRows:function(){return 1000;},getRange:function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(vals){vals.forEach(function(rv,ri){rv.forEach(function(v,ci){if(!grids[tn][row-1+ri])grids[tn][row-1+ri]=[];grids[tn][row-1+ri][col-1+ci]=v;});});}};}}; }
  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  ctx.SpreadsheetApp = {getActiveSpreadsheet:function(){return mockSs;},flush:function(){}};
  ctx.PropertiesService = {getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}};
  ctx.Utilities = {DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:function(_,t){return Array.from(crypto.createHash('sha256').update(t).digest());}};
  var dr = ctx.runS13FixtureDryRun(); assert.equal(dr.pass, true);
  var ap = ctx.runS13FixtureApply(); assert.equal(ap.pass, true);
  var en = ctx.runS13EnableFunctionsForSyntheticTest(); assert.equal(en.pass, true);
  var rs = ctx.restoreS13SafeState(); assert.equal(rs.pass, true);
});
