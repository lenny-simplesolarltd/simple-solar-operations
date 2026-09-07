const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

const { calculateStockAvailable, evaluatePickRequirements, executePick, processJobPicking } = require('../s08/picking.js');
const { installBaseFixture, buildSyntheticJob, buildStockMaterial, seedStock, runAvailablePick, runInsufficientStock, runReplayNoDoubleDeduct, runInternalJobLinkage, runDeterministicMovementKey, runTaskCreatedOnce, runUnrelatedRowsUntouched } = require('../s08/fixture.js');

function makeStore() {
  const data = {};
  const tables = ['StockMovements','Reservations','StockLocations','Materials','Products','Jobs','Tasks','People','PersonRoles','ReleaseModes','Customers'];
  for (const t of tables) data[t] = [];
  data.ReleaseModes = [
    { id:'RM-FN05',function_id:'FN-05',function_name:'Panel stock balances/movements',mode:'Automated',mode_record_basis:'test',authorised_job_scope:'Pilot',target_release:'R2',planned_target_mode:'Automated',current_system:'test',fallback:'test',external_ids_protected_reference:null,activation_time:null,approved_version:null,ben_approval_reference:null,scope_boundary_notes:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'test',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'test',version:1,commit_id:'test' }
  ];
  return {
    getSheetId: () => DEV_SHEET_ID,
    list: n => clone(data[n] || []),
    get: (n, id) => clone((data[n] || []).find(r => r.id === id) || null),
    insert(n, row) { if (!data[n]) data[n] = []; if (data[n].find(r => r.id === row.id)) throw new Error('Dup: '+row.id); data[n].push(clone(row)); },
    update(n, id, p) { const r = (data[n]||[]).find(r => r.id === id); if (!r) throw new Error('NF: '+n+' '+id); Object.assign(r, p); }
  };
}

test('S08: stock availability calculation', () => {
  const s = makeStore();
  seedStock(s, 'PROD-P460', 'LOC-store', 10);
  assert.equal(calculateStockAvailable('PROD-P460', 'LOC-store', s), 10);
  // Issue 3 out
  s.insert('StockMovements', { id:'SM-out',product_id:'PROD-P460',quantity:3,from_location_id:'LOC-store',to_location_id:'LOC-jobsite',movement_type:'Issue',job_id:null,receipt_line_id:null,reason:null,evidence_id:null,approval_id:null,movement_at:'2026-09-02T00:00:00.000Z',idempotency_key:'test-out',created_at:'2026-09-02T00:00:00.000Z',commit_id:'t' });
  assert.equal(calculateStockAvailable('PROD-P460', 'LOC-store', s), 7);
});

test('S08: available pick succeeds', () => {
  const s = makeStore();
  const r = runAvailablePick(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.movements_created, 1);
});

test('S08: insufficient stock refused', () => {
  const s = makeStore();
  const r = runInsufficientStock(s);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.blocked, true);
});

test('S08: replay no double deduct', () => {
  const s = makeStore();
  const r = runReplayNoDoubleDeduct(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S08: internal Jobs.id linkage', () => {
  const s = makeStore();
  const r = runInternalJobLinkage(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S08: deterministic movement idempotency key', () => {
  const s = makeStore();
  const r = runDeterministicMovementKey(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S08: task created once', () => {
  const s = makeStore();
  const r = runTaskCreatedOnce(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S08: unrelated rows untouched', () => {
  const s = makeStore();
  const r = runUnrelatedRowsUntouched(s);
  assert.equal(r.pass, true, JSON.stringify(r));
});

test('S08: evaluatePickRequirements on empty job', () => {
  const s = makeStore();
  const r = evaluatePickRequirements('J-none', s);
  assert.equal(r.ready, false);
  assert.ok(r.issues.some(i => i.includes('No stock')));
});

test('S08: executePick refuses when not ready', () => {
  const s = makeStore();
  const r = executePick('J-none', s);
  assert.equal(r.status, 'NotReady');
  assert.equal(r.movements_created, 0);
});

test('S08: S08Picking.js VM smoke test', () => {
  var modeHdrs = ['id','function_id','function_name','mode','mode_record_basis','authorised_job_scope','target_release','planned_target_mode','current_system','fallback','external_ids_protected_reference','activation_time','approved_version','ben_approval_reference','scope_boundary_notes','created_at','created_by','updated_at','updated_by','version','commit_id'];
  var empty = modeHdrs.map(function(){return '';});
  function mkRow(vals) { var r = empty.slice(); for (var k in vals) r[modeHdrs.indexOf(k)] = vals[k]; return r; }

  const grids = {
    Materials: [['id','job_id','product_id','required_quantity','unit','source','need_by_date','merchant_id','order_line_id','revision','cancelled_quantity','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    StockMovements: [['id','product_id','quantity','from_location_id','to_location_id','movement_type','job_id','receipt_line_id','reason','evidence_id','approval_id','movement_at','idempotency_key','created_at','commit_id']],
    Reservations: [['id','material_id','product_id','location_id','quantity','status','picked_quantity','picked_at','picked_by','created_at','created_by','updated_at','updated_by','version','commit_id']],
    StockLocations: [['id','name','type','job_id','usable','created_at','created_by','updated_at','updated_by','version','commit_id']],
    Products: [['id','sku','name','category','wattage','manufacturer','model','unit','unit_precision','stock_tracked','active','default_supplier_id','standard_lead_days','unit_cost_pence','created_at','created_by','updated_at','updated_by','version','source_system','commit_id']],
    Jobs: [['id','job_id','customer_id','display_name']],
    Tasks: [['id','job_id','template_code','instance_key','group','title','owner_id','related_entity_type','related_entity_id','priority','status']],
    ReleaseModes: [modeHdrs, mkRow({id:'RM-FN05',function_id:'FN-05',function_name:'Stock',mode:'Automated',authorised_job_scope:'Pilot',target_release:'R2',version:1})]
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
  vm.runInContext(fs.readFileSync('apps-script/s08/S08Picking.js','utf8'), ctx);

  var dr = ctx.runS08FixtureDryRun();
  assert.equal(dr.sheet_id, DEV_SHEET_ID);
  var ap = ctx.runS08FixtureApply();
  assert.equal(ap.applied, true);
  var en = ctx.runS08EnableFn05ForSyntheticTest();
  assert.equal(en.pass, true);
  var rs = ctx.restoreS08SafeState();
  assert.equal(rs.pass, true);
});
