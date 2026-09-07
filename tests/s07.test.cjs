const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const { evaluateMaterialRequirements, createOrderForJob, createOrderingTasks, processJobOrdering } = require('../s07/ordering.js');
const { installBaseFixture, buildSyntheticJob, buildReadyMaterials, buildMissingMerchantMaterial, buildMissingProductMaterial, runReadyOrder, runMissingMerchant, runMissingProduct, runReplayIdempotent, runInternalJobIdLinkage, runTaskOwnerCorrect, runRevisionDoesNotOverwrite, runUnrelatedRowsUntouched } = require('../s07/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['Materials','Orders','OrderLines','Products','Companies','Jobs','Tasks','TaskTemplates','TaskDependencies','People','PersonRoles','ReleaseModes','StockLocations','Customers','Outbox'];
  for (const t of tables) data[t] = [];
  data.ReleaseModes = [
    { id:'RM-FN03',function_id:'FN-03',function_name:'Orders and merchant messages',mode:'Automated',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:'R2',planned_target_mode:'Automated',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test' }
  ];
  return {
    getSheetId: () => DEV_SHEET_ID,
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('Dup: '+row.id); data[n].push(clone(row)); },
    update(n, id, p) { const r = (data[n]||[]).find(r => r.id === id); if (!r) throw new Error('NF: '+n+' '+id); Object.assign(r, p); }
  };
}

test('S07: ready order creates orders and tasks', () => {
  const s = makeStore();
  const r = runReadyOrder(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.ok(r.orders_created >= 2);
  assert.ok(r.tasks_created >= 1);
});

test('S07: missing merchant fails closed', () => {
  const s = makeStore();
  const r = runMissingMerchant(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.ready, false);
  assert.equal(r.blocked, true);
});

test('S07: missing product fails closed', () => {
  const s = makeStore();
  const r = runMissingProduct(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.ready, false);
  assert.equal(r.needs_review, true);
});

test('S07: replay creates no duplicate orders', () => {
  const s = makeStore();
  const r = runReplayIdempotent(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.second_created, 0);
  assert.ok(r.first_created > 0);
});

test('S07: orders use internal Jobs.id not human job_id', () => {
  const s = makeStore();
  const r = runInternalJobIdLinkage(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.ok(r.order_count > 0);
});

test('S07: task owner is correct (Office → Tanya)', () => {
  const s = makeStore();
  const r = runTaskOwnerCorrect(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.owner, 'PERSON-tanya');
});

test('S07: revision does not silently overwrite', () => {
  const s = makeStore();
  const r = runRevisionDoesNotOverwrite(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.second_created, 0);
});

test('S07: deterministic order idempotency key', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildSyntheticJob();
  s.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) s.insert('Materials', m);

  processJobOrdering(job.id, s);
  // Order id should be ORD-J-s07-ready-COMP-greentech
  assert.ok(s.get('Orders', 'ORD-J-s07-ready-COMP-greentech'));
  assert.ok(s.get('Orders', 'ORD-J-s07-ready-COMP-cef'));
});

test('S07: order lines link to correct order', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildSyntheticJob();
  s.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) s.insert('Materials', m);

  processJobOrdering(job.id, s);
  const lines = s.list('OrderLines');
  assert.ok(lines.length >= 3);
  for (const l of lines) {
    assert.ok(l.order_id.startsWith('ORD-'));
    assert.ok(s.get('Orders', l.order_id));
  }
});

test('S07: materials updated to AlreadyOrdered after order', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildSyntheticJob();
  s.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) s.insert('Materials', m);

  processJobOrdering(job.id, s);
  const mats = s.list('Materials').filter(m => m.job_id === job.id);
  const ordered = mats.filter(m => m.source === 'AlreadyOrdered');
  assert.ok(ordered.length >= 2);
});

test('S07: no duplicate tasks on replay', () => {
  const s = makeStore();
  installBaseFixture(s);
  const job = buildSyntheticJob();
  s.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) s.insert('Materials', m);

  processJobOrdering(job.id, s);
  const tc = s.list('Tasks').length;
  processJobOrdering(job.id, s);
  assert.equal(s.list('Tasks').length, tc);
});

test('S07: unrelated rows untouched', () => {
  const s = makeStore();
  const r = runUnrelatedRowsUntouched(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S07: evaluateMaterialRequirements on empty job', () => {
  const s = makeStore();
  const r = evaluateMaterialRequirements('J-none', s);
  assert.equal(r.ready, false);
  assert.equal(r.needs_review, true);
  assert.ok(r.issues.some(i => i.includes('No material')));
});

test('S07: createOrderForJob refuses when not ready', () => {
  const s = makeStore();
  const r = createOrderForJob('J-none', s);
  assert.equal(r.status, 'NotReady');
  assert.equal(r.orders_created, 0);
});

test('S07: S07Ordering.js VM smoke test', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }

  const grids = {
    Materials: [['id','job_id','work_package_id','product_id','description','required_quantity','unit','source','need_by_date','merchant_id','order_line_id','already_ordered_reference','notes','revision','cancelled_quantity','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    Orders: [['id','job_id','merchant_id','work_type','requested_delivery_date','delivery_location_id','delivery_address','status','revision','supplier_reference','sent_message_id','confirmed_revision','confirmed_at','confirmed_by','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    OrderLines: [['id','order_id','material_id','product_id','description_snapshot','quantity','unit','unit_net_cost_pence','vat_code','cancelled_quantity','created_at','commit_id']],
    Products: [['id','sku','name','category','wattage','manufacturer','model','unit','unit_precision','stock_tracked','active','default_supplier_id','standard_lead_days','unit_cost_pence','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    Companies: [['id','name','type','active','standard_lead_days','delivery_weekday','notes','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    Jobs: [['id','job_id','customer_id','display_name','sold_submission_id','booking_submission_id']],
    Tasks: [['id','job_id','template_code','instance_key','group','title','owner_id','backup_id','related_entity_type','related_entity_id','due_at','original_due_at','priority','status']],
    Customers: [['id','first_name','last_name']],
    StockLocations: [['id','name','type','job_id','usable']],
    TaskTemplates: [['id','template_code','title','group','default_owner_role','trigger_event','due_rule','evidence_required','active','template_version','created_at','created_by','updated_at','updated_by','version','commit_id']],
    People: [['id','email','display_name','role','active']],
    PersonRoles: [['id','person_id','role','active']],
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN03',function_id:'FN-03',function_name:'Orders',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R2',version:1})]
  };

  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {
      getName: function(){return tn;},
      getLastColumn: function(){return grids[tn][0].length;},
      getLastRow: function(){return grids[tn].length;},
      getMaxRows: function(){return 1000;},
      getRange: function(row,col,h,w){
        h=h||1;w=w||1;
        return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(vals){vals.forEach(function(rv,ri){rv.forEach(function(v,ci){if(!grids[tn][row-1+ri])grids[tn][row-1+ri]=[];grids[tn][row-1+ri][col-1+ci]=v;});});}};
      }
    };
  }

  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{getActiveSpreadsheet:function(){return mockSs;},flush:function(){}},PropertiesService:{getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:function(_,t){return Array.from(crypto.createHash('sha256').update(t).digest());}}});

  vm.runInContext(fs.readFileSync('apps-script/s07/S07Ordering.js','utf8'), ctx);
  var dr = ctx.runS07FixtureDryRun();
  assert.equal(dr.sheet_id, DEV_SHEET_ID);
  var ap = ctx.runS07FixtureApply();
  assert.equal(ap.applied, true);
  var ssr = ctx.restoreS07SafeState();
  assert.equal(ssr.pass, true);
});

test('S07: VM enable FN-03 from Disabled/None/R2', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }

  const grids = {
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN03',function_id:'FN-03',function_name:'Orders',mode:'Disabled',authorised_job_scope:'None',target_release:'R2',version:1})]
  };
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {getName:function(){return tn;},getLastColumn:function(){return grids[tn][0].length;},getLastRow:function(){return grids[tn].length;},getMaxRows:function(){return 1000;},getRange:function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(vals){vals.forEach(function(rv,ri){rv.forEach(function(v,ci){if(!grids[tn][row-1+ri])grids[tn][row-1+ri]=[];grids[tn][row-1+ri][col-1+ci]=v;});});}};}};
  }
  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{getActiveSpreadsheet:function(){return mockSs;},flush:function(){}},PropertiesService:{getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:function(){return[];}}});
  vm.runInContext(fs.readFileSync('apps-script/s07/S07Ordering.js','utf8'), ctx);

  var en = ctx.runS07EnableFn03ForSyntheticTest();
  assert.equal(en.pass, true, JSON.stringify(en));

  var en2 = ctx.runS07EnableFn03ForSyntheticTest();
  assert.equal(en2.pass, true); // already enabled

  var rs = ctx.restoreS07SafeState();
  assert.equal(rs.pass, true);
  // Check FN-03 is Disabled
  var modeIdx = modeHdrs.indexOf('mode');
  assert.equal(grids.ReleaseModes[1][modeIdx], 'Disabled');
});

test('S07: VM enable refuses non-R2 target', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }

  const grids = {
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN03',function_id:'FN-03',function_name:'Orders',mode:'Disabled',authorised_job_scope:'None',target_release:'R1',version:1})]
  };
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {getName:function(){return tn;},getLastColumn:function(){return grids[tn][0].length;},getLastRow:function(){return grids[tn].length;},getMaxRows:function(){return 1000;},getRange:function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(){}};}};
  }
  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{getActiveSpreadsheet:function(){return mockSs;},flush:function(){}},PropertiesService:{getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}},Utilities:{}});
  vm.runInContext(fs.readFileSync('apps-script/s07/S07Ordering.js','utf8'), ctx);

  var en = ctx.runS07EnableFn03ForSyntheticTest();
  assert.equal(en.pass, false);
  assert.ok(en.detail.includes('R2'));
});

test('S07: VM enable refuses unexpected mode', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }

  const grids = {
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN03',function_id:'FN-03',function_name:'Orders',mode:'Manual',authorised_job_scope:'None',target_release:'R2',version:1})]
  };
  var sheets = {};
  for (let tn in grids) {
    sheets[tn] = {getName:function(){return tn;},getLastColumn:function(){return grids[tn][0].length;},getLastRow:function(){return grids[tn].length;},getMaxRows:function(){return 1000;},getRange:function(row,col,h,w){h=h||1;w=w||1;return {getValues:function(){return Array.from({length:h},function(_,r){return Array.from({length:w},function(_,c){return (grids[tn][row-1+r]||[])[col-1+c]||'';});});},setValues:function(){}};}};
  }
  var mockSs = {getId:function(){return DEV_SHEET_ID;},getSheets:function(){return Object.values(sheets);}};
  var ctx = vm.createContext({console:{log:function(){}},SpreadsheetApp:{getActiveSpreadsheet:function(){return mockSs;},flush:function(){}},PropertiesService:{getScriptProperties:function(){return{getProperty:function(){return JSON.stringify({environment:'DEV',sheetId:DEV_SHEET_ID});}};}},Utilities:{}});
  vm.runInContext(fs.readFileSync('apps-script/s07/S07Ordering.js','utf8'), ctx);

  var en = ctx.runS07EnableFn03ForSyntheticTest();
  assert.equal(en.pass, false);
  assert.ok(en.detail.includes('Unexpected'));
});
