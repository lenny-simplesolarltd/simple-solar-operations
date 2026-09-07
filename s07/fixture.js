/* S07 DEV fixtures — minimal set for ordering testing.
 * A: Ready order (valid materials + products + merchants)
 * B: Missing product/merchant → NeedsReview
 * C: Replay → no duplicate orders
 * D: Revision/change → existing order reused, not duplicated */

const { processJobOrdering, evaluateMaterialRequirements, createOrderForJob } = require('./ordering.js');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';

function installBaseFixture(store) {
  // Products
  if (!store.get('Products', 'PROD-P460')) {
    store.insert('Products', { id:'PROD-P460',sku:'P460',name:'460W Solar Panel',category:'Panel',wattage:460,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:14,unit_cost_pence:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('Products', 'PROD-P515')) {
    store.insert('Products', { id:'PROD-P515',sku:'P515',name:'515W Solar Panel',category:'Panel',wattage:515,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:14,unit_cost_pence:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  // Synthetic panel product
  if (!store.get('Products', 'PROD-S07-RAIL')) {
    store.insert('Products', { id:'PROD-S07-RAIL',sku:'RAIL-4M',name:'4m Mounting Rail',category:'Mounting',wattage:null,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Each',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-greentech',standard_lead_days:7,unit_cost_pence:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('Products', 'PROD-S07-CABLE')) {
    store.insert('Products', { id:'PROD-S07-CABLE',sku:'CABLE-100M',name:'100m Solar Cable',category:'Electrical',wattage:null,manufacturer:'NOT_CONFIGURED',model:'NOT_CONFIGURED',unit:'Metre',unit_precision:0,stock_tracked:true,active:true,default_supplier_id:'COMP-cef',standard_lead_days:5,unit_cost_pence:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  // Merchants
  if (!store.get('Companies', 'COMP-greentech')) {
    store.insert('Companies', { id:'COMP-greentech',name:'Greentech',type:'Merchant',active:true,standard_lead_days:14,delivery_weekday:4,notes:'Roofing merchant',created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('Companies', 'COMP-cef')) {
    store.insert('Companies', { id:'COMP-cef',name:'CEF',type:'Merchant',active:true,standard_lead_days:7,delivery_weekday:4,notes:'Electrical merchant',created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  // Stock location
  if (!store.get('StockLocations', 'LOC-store')) {
    store.insert('StockLocations', { id:'LOC-store',name:'Main Store',type:'Store',job_id:null,usable:true });
  }
  // PersonRoles
  if (!store.get('PersonRoles', 'PROLE-tanya-office')) {
    store.insert('PersonRoles', { id:'PROLE-tanya-office',person_id:'PERSON-tanya',role:'Office',active:true,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',commit_id:'fixture' });
  }
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@test.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }
  // TaskTemplates
  function tpl(id, code, title, group, owner, trigger, due) {
    if (!store.get('TaskTemplates', id)) {
      store.insert('TaskTemplates', { id, template_code:code, title, group, default_owner_role:owner, trigger_event:trigger, due_rule:due, evidence_required:'S07 test', active:true, template_version:'1.0', created_at:'2026-01-01T00:00:00.000Z', created_by:'fixture', updated_at:'2026-01-01T00:00:00.000Z', updated_by:'fixture', version:1, commit_id:'fixture' });
    }
  }
  tpl('TPL-MAT01','MAT01','Place material order','Materials','Office','Material ToOrder created','Need-by minus lead days');
  tpl('TPL-MAT05','MAT05','Friday merchant expected-delivery lists','Materials','Office','Every Friday','Friday 12:00');
}

function buildSyntheticJob() {
  return {
    id:'J-s07-ready',job_id:'SS-S07R-EADY',customer_id:'CUST-s07',display_name:'S07 Ordering Test',
    sold_submission_id:'S07-sold',booking_submission_id:'S07-booking',
    sold_at:'2026-08-01T00:00:00.000Z',salesperson_id:null,lead_source:'S07-test',
    quote_reference:'Q-S07',presale_file_id:null,finance_route:'Standard',
    contract_status:'Signed',contract_id:'C-S07',contract_signed_at:'2026-08-15T00:00:00.000Z',
    contract_evidence_id:null,original_net_pence:400000,original_vat_pence:80000,
    original_gross_pence:480000,approved_change_pence:null,current_contract_gross_pence:480000,
    valuation_basis:'Standard',sold_booking_match_status:'Match',
    customer_details_verified_at:'2026-08-15T00:00:00.000Z',customer_details_verified_by:'PERSON-tanya',
    deposit_bank_confirmed_at:'2026-08-20T00:00:00.000Z',deposit_bank_confirmed_by:'PERSON-ben',
    deposit_bank_reference:'DEP-S07',roof_required:true,electrical_required:true,scaffold_required:false,
    workflow_stage:'Booked',booking_approved_at:'2026-08-20T00:00:00.000Z',
    booking_approved_by:'PERSON-tanya',operational_complete_at:null,operational_complete_by:null,
    customer_happy_at:null,customer_happy_by:null,handover_status:'NotReady',financial_status:'Pending',
    cancellation_at:null,cancellation_by:null,cancellation_reason:null,archived_at:null,
    next_action_at:'2026-10-15T00:00:00.000Z',account_policy_version:null,pilot_job:false,release_scope:'R1',
    created_at:'2026-08-01T00:00:00.000Z',created_by:'S07-fixture',updated_at:'2026-08-20T00:00:00.000Z',
    updated_by:'S07-fixture',version:1,source_system:'S07-fixture',source_record_id:null,commit_id:'S07-fixture'
  };
}

function buildReadyMaterials(jobId) {
  const now = '2026-09-01T00:00:00.000Z';
  return [
    { id:'MAT-S07-001',job_id:jobId,work_package_id:'WP-S07',product_id:'PROD-P460',description:null,required_quantity:10,unit:'Each',source:'ToOrder',need_by_date:'2026-10-01',merchant_id:'COMP-greentech',order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:now,created_by:'S07-fixture',updated_at:now,updated_by:'S07-fixture',version:1,source_system:'S07-fixture',commit_id:'S07-fixture' },
    { id:'MAT-S07-002',job_id:jobId,work_package_id:'WP-S07',product_id:'PROD-S07-RAIL',description:null,required_quantity:8,unit:'Each',source:'ToOrder',need_by_date:'2026-10-01',merchant_id:'COMP-greentech',order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:now,created_by:'S07-fixture',updated_at:now,updated_by:'S07-fixture',version:1,source_system:'S07-fixture',commit_id:'S07-fixture' },
    { id:'MAT-S07-003',job_id:jobId,work_package_id:'WP-S07',product_id:'PROD-S07-CABLE',description:null,required_quantity:50,unit:'Metre',source:'ToOrder',need_by_date:'2026-10-01',merchant_id:'COMP-cef',order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:now,created_by:'S07-fixture',updated_at:now,updated_by:'S07-fixture',version:1,source_system:'S07-fixture',commit_id:'S07-fixture' }
  ];
}

function buildMissingMerchantMaterial(jobId) {
  const now = '2026-09-01T00:00:00.000Z';
  return { id:'MAT-S07-004',job_id:jobId,work_package_id:'WP-S07',product_id:'PROD-P460',description:null,required_quantity:5,unit:'Each',source:'ToOrder',need_by_date:'2026-10-01',merchant_id:null,order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:now,created_by:'S07-fixture',updated_at:now,updated_by:'S07-fixture',version:1,source_system:'S07-fixture',commit_id:'S07-fixture' };
}

function buildMissingProductMaterial(jobId) {
  const now = '2026-09-01T00:00:00.000Z';
  return { id:'MAT-S07-005',job_id:jobId,work_package_id:'WP-S07',product_id:null,description:null,required_quantity:5,unit:'Each',source:'ToOrder',need_by_date:'2026-10-01',merchant_id:'COMP-greentech',order_line_id:null,already_ordered_reference:null,notes:null,revision:1,cancelled_quantity:0,created_at:now,created_by:'S07-fixture',updated_at:now,updated_by:'S07-fixture',version:1,source_system:'S07-fixture',commit_id:'S07-fixture' };
}

/* --- Test runners --- */

function runReadyOrder(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  if (!store.get('Customers', 'CUST-s07')) {
    store.insert('Customers', { id:'CUST-s07',first_name:'Alice',last_name:'Order',address_line1:'1 Test St',address_line2:'',town:'Testville',postcode:'TS1 1AA',email:null,phone:null,alternate_contact:null,contact_notes:null,created_at:'2026-08-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-08-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }

  for (const m of buildReadyMaterials(job.id)) {
    if (!store.get('Materials', m.id)) store.insert('Materials', m);
  }

  const beforeOrders = store.list('Orders').length;
  const beforeTasks = store.list('Tasks').length;
  const result = processJobOrdering(job.id, store);
  const afterOrders = store.list('Orders').length;

  return {
    test: 'Ready order creation',
    pass: result.success === true && afterOrders > beforeOrders &&
      result.ordering.orders_created >= 2 && result.tasks.created.length >= 1,
    orders_created: result.ordering.orders_created,
    tasks_created: result.tasks.created.length,
    reqs_ready: result.requirements.ready
  };
}

function runMissingMerchant(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  job.id = 'J-s07-nomerchant';
  job.job_id = 'SS-S07N-OMCH';
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  store.insert('Materials', buildMissingMerchantMaterial(job.id));

  const result = processJobOrdering(job.id, store);

  return {
    test: 'Missing merchant — blocked',
    pass: result.requirements.ready === false && result.requirements.blocked === true &&
      result.ordering.status === 'NotReady',
    ready: result.requirements.ready,
    blocked: result.requirements.blocked
  };
}

function runMissingProduct(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  job.id = 'J-s07-noproduct';
  job.job_id = 'SS-S07N-OPRD';
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  store.insert('Materials', buildMissingProductMaterial(job.id));

  const result = processJobOrdering(job.id, store);

  return {
    test: 'Missing product — needs review',
    pass: result.requirements.ready === false && result.requirements.needs_review === true,
    ready: result.requirements.ready,
    needs_review: result.requirements.needs_review
  };
}

function runReplayIdempotent(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) {
    if (!store.get('Materials', m.id)) store.insert('Materials', m);
  }

  const first = processJobOrdering(job.id, store);
  const orderCount = store.list('Orders').length;
  const taskCount = store.list('Tasks').length;
  const second = processJobOrdering(job.id, store);

  return {
    test: 'Replay idempotent',
    pass: second.ordering.orders_created === 0 && store.list('Orders').length === orderCount &&
      store.list('Tasks').length === taskCount,
    first_created: first.ordering.orders_created,
    second_created: second.ordering.orders_created
  };
}

function runInternalJobIdLinkage(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) {
    if (!store.get('Materials', m.id)) store.insert('Materials', m);
  }

  processJobOrdering(job.id, store);
  const orders = store.list('Orders').filter(o => o.job_id === job.id);

  return {
    test: 'Internal Jobs.id linkage',
    pass: orders.length > 0 && orders.every(o => o.job_id === job.id && o.job_id !== job.job_id),
    order_count: orders.length
  };
}

function runTaskOwnerCorrect(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) {
    if (!store.get('Materials', m.id)) store.insert('Materials', m);
  }

  processJobOrdering(job.id, store);
  const tasks = store.list('Tasks').filter(t => t.job_id === job.id && t.template_code === 'MAT01');

  return {
    test: 'Task owner correct',
    pass: tasks.length === 1 && tasks[0].owner_id === 'PERSON-tanya',
    owner: tasks.length > 0 ? tasks[0].owner_id : null
  };
}

function runRevisionDoesNotOverwrite(store) {
  installBaseFixture(store);
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) {
    if (!store.get('Materials', m.id)) store.insert('Materials', m);
  }

  processJobOrdering(job.id, store);
  const orderCount = store.list('Orders').length;

  // Change a material quantity (revision scenario)
  store.update('Materials', 'MAT-S07-001', { required_quantity: 12, revision: 2, updated_at: new Date().toISOString() });

  // Re-process — existing orders should be reused, not duplicated
  const second = processJobOrdering(job.id, store);

  return {
    test: 'Revision does not silently overwrite',
    pass: store.list('Orders').length === orderCount && second.ordering.orders_created === 0,
    orders_after: store.list('Orders').length,
    second_created: second.ordering.orders_created
  };
}

function runUnrelatedRowsUntouched(store) {
  installBaseFixture(store);
  if (!store.get('People', 'PERSON-tanya')) {
    store.insert('People', { id:'PERSON-tanya',email:'tanya@test.example.invalid',display_name:'Tanya',role:'Office',active:true,calendar_id:null,notification_email:null,capacity_per_day:null,available_from:null,available_to:null,backup_person_id:null,company_id:null,created_at:'2026-01-01T00:00:00.000Z',created_by:'fixture',updated_at:'2026-01-01T00:00:00.000Z',updated_by:'fixture',version:1,source_system:'fixture',source_record_id:null,commit_id:'fixture' });
  }

  const before = JSON.stringify(store.get('People', 'PERSON-tanya'));
  const job = buildSyntheticJob();
  if (!store.get('Jobs', job.id)) store.insert('Jobs', job);
  for (const m of buildReadyMaterials(job.id)) {
    if (!store.get('Materials', m.id)) store.insert('Materials', m);
  }
  processJobOrdering(job.id, store);
  const after = JSON.stringify(store.get('People', 'PERSON-tanya'));

  return { test: 'Unrelated rows untouched', pass: before === after };
}

module.exports = {
  DEV_SHEET_ID,
  installBaseFixture, buildSyntheticJob, buildReadyMaterials,
  buildMissingMerchantMaterial, buildMissingProductMaterial,
  runReadyOrder, runMissingMerchant, runMissingProduct,
  runReplayIdempotent, runInternalJobIdLinkage, runTaskOwnerCorrect,
  runRevisionDoesNotOverwrite, runUnrelatedRowsUntouched
};
