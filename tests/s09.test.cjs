const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const { evaluateScaffoldRequirement, createScaffoldBooking, processJobScaffolding } = require('../s09/scaffold.js');
const { installBaseFixture, buildJob, runScaffoldRequired, runScaffoldNotRequired, runReplayNoDuplicate, runInternalJobLinkage, runTaskOwnerCorrect, runUnrelatedRowsUntouched } = require('../s09/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['ScaffoldBookings','Companies','Jobs','Tasks','TaskTemplates','People','PersonRoles','ReleaseModes','Customers'];
  for (const t of tables) data[t] = [];
  data.ReleaseModes = [
    { id:'RM-FN04',function_id:'FN-04',function_name:'Scaffold commitments',mode:'Automated',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:'R2',planned_target_mode:'Automated',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test' }
  ];
  return {
    getSheetId: () => DEV_SHEET_ID,
    getEnvironment: () => 'DEV',
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('Dup: '+row.id); data[n].push(clone(row)); },
    update(n, id, p) { const r = (data[n]||[]).find(r => r.id === id); if (!r) throw new Error('NF: '+n+' '+id); Object.assign(r, p); }
  };
}

test('S09: scaffold required — booking created', () => {
  const s = makeStore();
  const r = runScaffoldRequired(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.booking_created, true);
  assert.equal(r.task_created, true);
});

test('S09: scaffold not required — no booking', () => {
  const s = makeStore();
  const r = runScaffoldNotRequired(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S09: replay no duplicate booking', () => {
  const s = makeStore();
  const r = runReplayNoDuplicate(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S09: internal Jobs.id linkage', () => {
  const s = makeStore();
  const r = runInternalJobLinkage(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S09: task owner correct (SCA01 → Tanya)', () => {
  const s = makeStore();
  const r = runTaskOwnerCorrect(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S09: unrelated rows untouched', () => {
  const s = makeStore();
  const r = runUnrelatedRowsUntouched(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S09: missing job returns error', () => {
  const s = makeStore();
  const r = evaluateScaffoldRequirement('J-none', s);
  assert.equal(r.error, 'JOB_NOT_FOUND');
});

test('S09: S09Scaffold.js VM smoke test', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }

  const grids = {
    ScaffoldBookings: [['id','job_id','company_id','erect_planned_at','status','revision','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    Jobs: [['id','job_id','customer_id','display_name','scaffold_required','next_action_at']],
    Companies: [['id','name','type','active','standard_lead_days']],
    Tasks: [['id','job_id','template_code','instance_key','group','title','owner_id','related_entity_type','related_entity_id','priority','status']],
    TaskTemplates: [['id','template_code','title','group','default_owner_role','active','template_version']],
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN04',function_id:'FN-04',function_name:'Scaffold',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R2',version:1})]
  };

  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {
      getName: function(){return tn;}, getLastColumn: function(){return grids[tn][0].length;}, getLastRow: function(){return grids[tn].length;}, getMaxRows: function(){return 1000;},
      getRange: function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(vals){vals.forEach(function(rv,ri){rv.forEach(function(v,ci){if(!grids[tn][row-1+ri])grids[tn][row-1+ri]=[];grids[tn][row-1+ri][col-1+ci]=v;});});}};}
    };
  }

  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{getActiveSpreadsheet:function(){return mockSs;},flush:function(){}},PropertiesService:{getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:function(_,t){return Array.from(crypto.createHash('sha256').update(t).digest());}}});
  vm.runInContext(fs.readFileSync('apps-script/s09/S09Scaffold.js','utf8'), ctx);

  for (const name of Object.keys(grids)) grids[name][0] = Array.from(ctx._S9C[name]);
  var dr = ctx.runS09FixtureDryRun();
  assert.equal(dr.sheet_id, DEV_SHEET_ID);
  var ap = ctx.runS09FixtureApply();
  assert.equal(ap.applied, true);
  var en = ctx.runS09EnableFn04ForSyntheticTest();
  assert.equal(en.pass, true);
  assert.equal(ctx.runS09HappyPathTest().pass, true);
  const store = ctx._s09Store(mockSs);
  store.update('Jobs', 'J-s09-ready', {pilot_job:false,release_scope:'R1'});
  grids.Tasks.splice(1); // Prior crash committed booking but not task.
  assert.equal(ctx.runS09HappyPathTest().pass, true);
  assert.equal(ctx.runS09HappyPathTest().pass, true);
  assert.equal(store.list('ScaffoldBookings').length, 1);
  assert.equal(store.list('Tasks').length, 1);
  store.update('ReleaseModes','RM-FN04',{mode:'Disabled',authorised_job_scope:'None',target_release:'R1'});
  var rs = ctx.restoreS09SafeState();
  assert.equal(rs.pass, true);
  assert.equal(store.get('ReleaseModes','RM-FN04').target_release, 'R2');
  assert.equal(ctx.runS09HappyPathTest().pass, false);
  ctx.runS09EnableFn04ForSyntheticTest();
  ctx.processJobScaffolding = function(){ return {}; };
  assert.equal(ctx.runS09HappyPathTest().pass, false);
  ctx.restoreS09SafeState();
});

 test('S09: guards refuse mutations outside DEV synthetic FN-04 pilot scope', () => {
  for (const change of [s => s.getSheetId = () => 'wrong', s => s.getEnvironment = () => 'PROD', s => s.update('ReleaseModes','RM-FN04',{mode:'Disabled'}), s => s.update('ReleaseModes','RM-FN04',{authorised_job_scope:'All'}), s => s.update('ReleaseModes','RM-FN04',{target_release:'R1'}), s => s.update('Jobs','J-s09-ready',{pilot_job:false}), s => s.update('Jobs','J-s09-ready',{release_scope:'R1'})]) {
    const s = makeStore(); installBaseFixture(s); s.insert('Jobs',buildJob(true)); change(s);
    assert.throws(() => processJobScaffolding('J-s09-ready',s), /S09_REFUSED/);
    assert.equal(s.list('ScaffoldBookings').length,0); assert.equal(s.list('Tasks').length,0);
  }
});
test('S09: booking-only recovery and task reuse', () => {
  const s = makeStore(); installBaseFixture(s); s.insert('Jobs',buildJob(true));
  createScaffoldBooking('J-s09-ready',s);
  const recovered = processJobScaffolding('J-s09-ready',s);
  assert.equal(recovered.success,true); assert.equal(recovered.booking.created,false); assert.equal(recovered.tasks.created.length,1);
  const replay = processJobScaffolding('J-s09-ready',s);
  assert.equal(replay.success,true); assert.equal(replay.tasks.created.length,0); assert.equal(replay.tasks.reused.length,1);
  assert.equal(s.list('ScaffoldBookings').length,1); assert.equal(s.list('Tasks').length,1);
});
