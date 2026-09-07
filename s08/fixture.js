/* S08 DEV fixtures — minimal picking/stock set.
 * A: Stock available → successful pick
 * B: Insufficient stock → refused
 * C: Replay A → no duplicate movement
 * D: Already picked → skipped */

const { processJobPicking, executePick, calculateStockAvailable } = require('./picking.js');
const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  const n = '2026-09-01T00:00:00.000Z';
  if (!store.get('Products', 'PROD-P460')) {
    store.insert('Products', { id:'PROD-P460',sku:'P460',name:'460W Solar Panel',category:'Panel',wattage:460,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:14,unit_cost_pence:null,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('StockLocations', 'LOC-store')) {
    store.insert('StockLocations', { id:'LOC-store',name:'Main Store',type:'Store',job_id:null,usable:true,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,commit_id:'fixture' });
  }
  if (!store.get('StockLocations', 'LOC-jobsite')) {
    store.insert('StockLocations', { id:'LOC-jobsite',name:'Job Site',type:'JobSite',job_id:null,usable:true,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,commit_id:'fixture' });
  }
  if (!store.get('PersonRoles', 'PROLE-tanya-office')) {
    store.insert('PersonRoles', { id:'PROLE-tanya-office',person_id:'PERSON-tanya',role:'Office',active:true,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@test.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:n,created_by:'fixture',updated_at:n,updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }
}

function buildSyntheticJob() {
  return { id:'J-s08-ready',job_id:'SS-S08R-EADY',customer_id:'CUST-s08',display_name:'S08 Pick Test',sold_submission_id:'S08-sold',booking_submission_id:'S08-booking',sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S08',quote_reference:'Q-S08',presale_file_id:null,finance_route:'Standard',contract_status:'Signed',contract_id:'C-S08',contract_signed_at:'2026-08-15T00:00:00.000Z',contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,valuation_basis:'Standard',sold_booking_match_status:'Match',customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',deposit_bank_reference:'DEP-S08',roof_required:true,electrical_required:false,scaffold_required:false,workflow_stage:'Booked',booking_approved_at:'2026-08-20T00:00:00.000Z',booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:false,release_scope:'R1',created_at:'2026-08-01T00:00:00.000Z',created_by:'S08',updated_at:'2026-08-20T00:00:00.000Z',updated_by:'S08',version:1,source_system:'S08',source_record_id:null,commit_id:'S08' };
}

function buildStockMaterial(jobId, qty) {
  const n = '2026-09-01T00:00:00.000Z';
  return { id:'MAT-S08-001',job_id:jobId,work_package_id:'WP-S08',product_id:'PROD-P460',description:null,required_quantity:qty,unit:'Each',source:'Stock',need_by_date:'2026-10-01',merchant_id:null,order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:n,created_by:'S08',updated_at:n,updated_by:'S08',version:1,source_system:'S08',commit_id:'S08' };
}

function seedStock(store, productId, locationId, qty) {
  const key = 'MOV-seed-' + productId + '-' + locationId;
  if (store.list('StockMovements').find(m => m.idempotency_key === key)) return;
  store.insert('StockMovements', {
    id:'SM-seed-' + productId,product_id:productId,quantity:qty,
    from_location_id:'LOC-supplier',to_location_id:locationId,
    movement_type:'Receipt',job_id:null,receipt_line_id:null,
    reason:'S08 fixture seed',evidence_id:null,approval_id:null,
    movement_at:'2026-09-01T00:00:00.000Z',idempotency_key:key,
    created_at:'2026-09-01T00:00:00.000Z',commit_id:'seed'
  });
}

/* --- Test runners --- */

function runAvailablePick(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const mat = buildStockMaterial(job.id, 5);
  if (!store.get('Materials', mat.id)) store.insert('Materials', mat);
  seedStock(store, 'PROD-P460', 'LOC-store', 10);

  const beforeMov = store.list('StockMovements').length;
  const result = processJobPicking(job.id, store);
  const afterMov = store.list('StockMovements').length;

  return {
    test: 'Available stock pick',
    pass: result.success && afterMov > beforeMov && result.picking.movements_created === 1,
    movements_created: result.picking.movements_created,
    available: calculateStockAvailable('PROD-P460', 'LOC-store', store)
  };
}

function runInsufficientStock(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  job.id = 'J-s08-short'; job.job_id = 'SS-S08S-HORT';
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const mat = buildStockMaterial(job.id, 50);
  mat.id = 'MAT-S08-SHORT';
  if (!store.get('Materials', mat.id)) store.insert('Materials', mat);
  seedStock(store, 'PROD-P460', 'LOC-store', 5);

  const result = processJobPicking(job.id, store);

  return {
    test: 'Insufficient stock refused',
    pass: !result.success && result.requirements.blocked === true,
    blocked: result.requirements.blocked,
    available: calculateStockAvailable('PROD-P460', 'LOC-store', store)
  };
}

function runReplayNoDoubleDeduct(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  const mat = buildStockMaterial(job.id, 5);
  if (!store.get('Materials', mat.id)) store.insert('Materials', mat);
  seedStock(store, 'PROD-P460', 'LOC-store', 10);

  processJobPicking(job.id, store);
  const movCount = store.list('StockMovements').length;
  const second = processJobPicking(job.id, store);

  return {
    test: 'Replay no double deduct',
    pass: second.picking.movements_created === 0 && store.list('StockMovements').length === movCount,
    movements_after: store.list('StockMovements').length
  };
}

function runInternalJobLinkage(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  store.insert('Materials', buildStockMaterial(job.id, 5));
  seedStock(store, 'PROD-P460', 'LOC-store', 10);
  processJobPicking(job.id, store);

  const movs = store.list('StockMovements').filter(m => m.job_id === job.id && m.movement_type === 'Issue');
  return { test: 'Internal Jobs.id linkage', pass: movs.length === 1 && movs[0].job_id === job.id };
}

function runDeterministicMovementKey(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  store.insert('Materials', buildStockMaterial(job.id, 5));
  seedStock(store, 'PROD-P460', 'LOC-store', 10);
  processJobPicking(job.id, store);

  const mov = store.list('StockMovements').find(m => m.idempotency_key === 'MOV-MAT-S08-001-v1');
  return { test: 'Deterministic movement key', pass: !!mov };
};

function runTaskCreatedOnce(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  store.insert('Materials', buildStockMaterial(job.id, 5));
  seedStock(store, 'PROD-P460', 'LOC-store', 10);

  processJobPicking(job.id, store);
  const tc = store.list('Tasks').length;
  processJobPicking(job.id, store);
  return { test: 'Task created once', pass: store.list('Tasks').length === tc };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@test.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }
  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  store.insert('Materials', buildStockMaterial(job.id, 5));
  seedStock(store, 'PROD-P460', 'LOC-store', 10);
  processJobPicking(job.id, store);
  return { test: 'Unrelated rows untouched', pass: before === JSON.stringify(store.get('People', 'PERSON-tanya')) };
}

module.exports = {
  DEV_SHEET_ID,
  installBaseFixture, buildSyntheticJob, buildStockMaterial, seedStock,
  runAvailablePick, runInsufficientStock, runReplayNoDoubleDeduct,
  runInternalJobLinkage, runDeterministicMovementKey, runTaskCreatedOnce,
  runUnrelatedRowsUntouched
};
