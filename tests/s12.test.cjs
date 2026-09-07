const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const { buildSyntheticTemplate, buildSyntheticQuestion, createSubmission, submitAnswers, reviewSubmission, recordEquipment, evaluateHandover, createHandover } = require('../s12/commissioning.js');
const { installBaseFixture, buildSyntheticJob, runSubmissionCreate, runAnswersSubmit, runReviewAccept, runEquipmentRecord, runHandoverCreate, runIdempotentReplay, runUnrelatedRowsUntouched } = require('../s12/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['CommissioningTemplates','CommissioningQuestions','CommissioningSubmissions','CommissioningAnswers','JobEquipment','Handover','Jobs','WorkPackages','People','PersonRoles','ReleaseModes','Customers'];
  for (const t of tables) data[t] = [];
  ['FN-06','FN-07','FN-08'].forEach(function(id,i){data.ReleaseModes.push({id:'RM-'+id,function_id:id,function_name:'S12 '+id,mode:'Automated',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:'R3',planned_target_mode:'Automated',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test'});});
  return {
    getSheetId: () => DEV_SHEET_ID,
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('Dup: '+row.id); data[n].push(clone(row)); },
    update(n, id, p) { const r = (data[n]||[]).find(r => r.id === id); if (!r) throw new Error('NF: '+n+' '+id); Object.assign(r, p); }
  };
}

test('S12: submission created', () => { const s = makeStore(); const r = runSubmissionCreate(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S12: answers submitted', () => { const s = makeStore(); const r = runAnswersSubmit(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.answers, 2); });
test('S12: review accepted', () => { const s = makeStore(); const r = runReviewAccept(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.status, 'Accepted'); });
test('S12: equipment recorded', () => { const s = makeStore(); const r = runEquipmentRecord(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S12: handover created when ready', () => { const s = makeStore(); const r = runHandoverCreate(s); assert.equal(r.pass, true, JSON.stringify(r)); assert.equal(r.ready, true); });
test('S12: equipment idempotent replay', () => { const s = makeStore(); const r = runIdempotentReplay(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S12: unrelated rows untouched', () => { const s = makeStore(); const r = runUnrelatedRowsUntouched(s); assert.equal(r.pass, true, JSON.stringify(r)); });
test('S12: submission not created twice', () => { const s = makeStore(); installBaseFixture(s); const job = buildSyntheticJob(); s.insert('Jobs', job); s.insert('WorkPackages', { id:'WP-s12',job_id:job.id,trade:'Roof',required:true,status:'ReportedComplete',commissioning_required:true,sequence:1,revision:1,created_at:'2026-11-01T00:00:00.000Z',created_by:'S12',updated_at:'2026-11-01T00:00:00.000Z',updated_by:'S12',version:1,source_system:'S12',commit_id:'S12' }); createSubmission(s, job.id, 'WP-s12', 'ALLOC-s12', 'PERSON-installer-a', 'S12-DEV-1.0'); const count = s.list('CommissioningSubmissions').length; createSubmission(s, job.id, 'WP-s12', 'ALLOC-s12', 'PERSON-installer-a', 'S12-DEV-1.0'); assert.equal(s.list('CommissioningSubmissions').length, count); });
test('S12: S12Commissioning.js VM smoke test', () => {
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{},PropertiesService:{},Utilities:{}});
  vm.runInContext(fs.readFileSync('apps-script/s12/S12Commissioning.js','utf8'), ctx);
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }
  var grids = {};
  ['CommissioningTemplates','CommissioningQuestions','CommissioningSubmissions','CommissioningAnswers','JobEquipment','Handover','Jobs','WorkPackages','People','PersonRoles','ReleaseModes'].forEach(function(tn){grids[tn]=[ctx.S12_HEADERS[tn]];});
  grids.ReleaseModes.push(mkRow({id:'RM-FN06',function_id:'FN-06',function_name:'Installer app',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R3',version:1}));
  grids.ReleaseModes.push(mkRow({id:'RM-FN07',function_id:'FN-07',function_name:'Commissioning',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R3',version:1}));
  grids.ReleaseModes.push(mkRow({id:'RM-FN08',function_id:'FN-08',function_name:'Handover',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R3',version:1}));
  var sheets = {};
  for (let tn in grids) { sheets[tn] = {getName:function(){return tn;},getLastColumn:function(){return grids[tn][0].length;},getLastRow:function(){return grids[tn].length;},getMaxRows:function(){return 1000;},getRange:function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(vals){vals.forEach(function(rv,ri){rv.forEach(function(v,ci){if(!grids[tn][row-1+ri])grids[tn][row-1+ri]=[];grids[tn][row-1+ri][col-1+ci]=v;});});}};}}; }
  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  ctx.SpreadsheetApp = {getActiveSpreadsheet:function(){return mockSs;},flush:function(){}};
  ctx.PropertiesService = {getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}};
  ctx.Utilities = {DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:function(_,t){return Array.from(crypto.createHash('sha256').update(t).digest());}};
  var dr = ctx.runS12FixtureDryRun(); assert.equal(dr.pass, true);
  var ap = ctx.runS12FixtureApply(); assert.equal(ap.pass, true);
  var en = ctx.runS12EnableFunctionsForSyntheticTest(); assert.equal(en.pass, true);
  var rs = ctx.restoreS12SafeState(); assert.equal(rs.pass, true);
});
