/* S07 ordering — material requirements evaluation and order creation.
 * Uses canonical Materials, Orders, OrderLines, Products, Companies tables.
 * FN-03 governs ordering. No real merchant communication in DEV.
 * Idempotent via deterministic order keys. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

/* --- Material requirements --- */

function evaluateMaterialRequirements(jobId, store) {
  const materials = store.list('Materials').filter(m => m.job_id === jobId);
  const result = { job_id: jobId, materials: [], ready: true, blocked: false, needs_review: false, issues: [] };

  if (materials.length === 0) {
    result.ready = false;
    result.needs_review = true;
    result.issues.push('No material requirements found for job');
    return result;
  }

  for (const m of materials) {
    const issues = [];
    let itemReady = true;

    if (!m.product_id && !m.description) {
      issues.push('Missing product_id and description');
      itemReady = false;
    }
    if (!m.required_quantity || m.required_quantity <= 0) {
      issues.push('Missing or zero required_quantity');
      itemReady = false;
    }
    if (!m.merchant_id) {
      issues.push('Missing merchant_id');
      itemReady = false;
    }
    if (!m.need_by_date) {
      issues.push('Missing need_by_date');
      itemReady = false;
    }

    const product = m.product_id ? store.get('Products', m.product_id) : null;
    const merchant = m.merchant_id ? store.get('Companies', m.merchant_id) : null;

    if (m.product_id && !product) {
      issues.push('Product not found: ' + m.product_id);
      itemReady = false;
    }
    if (m.merchant_id && !merchant) {
      issues.push('Merchant not found: ' + m.merchant_id);
      itemReady = false;
    }

    const status = m.source || 'ToOrder';
    const alreadyOrdered = status === 'AlreadyOrdered';

    result.materials.push({
      id: m.id,
      product_id: m.product_id,
      product_name: product ? product.name : null,
      sku: product ? product.sku : null,
      description: m.description,
      quantity: m.required_quantity,
      unit: m.unit,
      merchant_id: m.merchant_id,
      merchant_name: merchant ? merchant.name : null,
      need_by_date: m.need_by_date,
      source: status,
      already_ordered: alreadyOrdered,
      ready: itemReady && !alreadyOrdered,
      issues
    });

    if (!itemReady) {
      result.ready = false;
      result.needs_review = true;
    }
    if (!itemReady && issues.some(i => i.includes('Missing'))) {
      result.blocked = true;
    }
  }

  result.summary = result.ready ? 'Ready' : (result.blocked ? 'Blocked' : 'NeedsReview');
  return result;
}

/* --- Order creation --- */

function createOrderForJob(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const reqs = evaluateMaterialRequirements(jobId, store);
  if (!reqs.ready) {
    return { status: 'NotReady', orders_created: 0, orders_reused: 0, reqs, created: [], existing: [], errors: [] };
  }

  const now = options.now || new Date().toISOString();
  const readyMaterials = reqs.materials.filter(m => m.ready);

  // Group by merchant
  const byMerchant = {};
  for (const m of readyMaterials) {
    if (!byMerchant[m.merchant_id]) byMerchant[m.merchant_id] = [];
    byMerchant[m.merchant_id].push(m);
  }

  const created = [];
  const existing = [];
  const errors = [];

  for (const [merchantId, items] of Object.entries(byMerchant)) {
    const orderKey = 'ORD-' + jobId + '-' + merchantId;
    const existingOrder = store.list('Orders').find(o => o.id === orderKey);

    if (existingOrder) {
      if (existingOrder.status === 'Confirmed' || existingOrder.status === 'Received') {
        existing.push({ order_id: orderKey, status: existingOrder.status, reason: 'Already confirmed/received' });
        continue;
      }
      // Existing draft/review — reuse
      existing.push({ order_id: orderKey, status: existingOrder.status, reason: 'Existing order, reusing' });
      created.push({ order_id: orderKey, merchant_id: merchantId, reused: true, line_count: store.list('OrderLines').filter(l => l.order_id === orderKey).length });
      continue;
    }

    const order = {
      id: orderKey,
      job_id: jobId,
      merchant_id: merchantId,
      work_type: 'Other',
      requested_delivery_date: items[0].need_by_date,
      delivery_location_id: 'LOC-store',
      delivery_address: null,
      status: 'Draft',
      revision: 1,
      supplier_reference: null,
      sent_message_id: null,
      confirmed_revision: null,
      confirmed_at: null,
      confirmed_by: null,
      created_at: now,
      created_by: 'S07-ordering',
      updated_at: now,
      updated_by: 'S07-ordering',
      version: 1,
      source_system: 'S07-ordering',
      commit_id: orderKey
    };
    store.insert('Orders', order);

    let lineCount = 0;
    for (const item of items) {
      const lineId = orderKey + '-L' + (lineCount + 1);
      const existingLine = store.get('OrderLines', lineId);
      if (existingLine) continue;

      const line = {
        id: lineId,
        order_id: orderKey,
        material_id: item.id,
        product_id: item.product_id,
        description_snapshot: item.description || (item.product_name || 'Material'),
        quantity: item.quantity,
        unit: item.unit,
        unit_net_cost_pence: null,
        vat_code: null,
        cancelled_quantity: 0,
        created_at: now,
        commit_id: lineId
      };
      store.insert('OrderLines', line);
      lineCount++;

      // Update material to mark as ordered
      store.update('Materials', item.id, {
        source: 'AlreadyOrdered',
        order_line_id: lineId,
        updated_at: now,
        updated_by: 'S07-ordering',
        version: (store.get('Materials', item.id)?.version || 0) + 1
      });
    }

    created.push({ order_id: orderKey, merchant_id: merchantId, reused: false, line_count: lineCount });
  }

  return {
    status: created.length > 0 || existing.length > 0 ? 'Created' : 'NoAction',
    reqs,
    orders_created: created.filter(c => !c.reused).length,
    orders_reused: created.filter(c => c.reused).length,
    already_confirmed: existing.filter(e => e.status === 'Confirmed' || e.status === 'Received').length,
    created,
    existing,
    errors
  };
}

/* --- Task creation --- */

function createOrderingTasks(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = options.now || new Date().toISOString();
  const created = [];
  const skipped = [];
  const tanyaId = resolvePersonByRole(store, 'Office') || 'PERSON-tanya';

  function mkTask(code, title, group, due, priority) {
    const key = code + '-' + jobId + '-ROOT-nodue';
    const exists = store.list('Tasks').find(t => t.instance_key === key);
    if (exists) {
      if (exists.status === 'Complete' || exists.status === 'Cancelled') {
        skipped.push({ code, reason: 'Already ' + exists.status });
      } else {
        skipped.push({ code, reason: 'Already exists', task_id: exists.id });
      }
      return;
    }
    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: jobId, template_code: code, instance_key: key,
      group, title, owner_id: tanyaId, backup_id: null,
      related_entity_type: 'Jobs', related_entity_id: jobId,
      due_at: due || null, original_due_at: due || null,
      priority: priority || 1, status: 'Open',
      blocking_reason: null, next_followup_at: null,
      completed_at: null, completed_by: null, completion_note: null,
      evidence_id: null, revision_required: false,
      created_rule_version: 'S07-1.0',
      created_at: now, created_by: 'S07-ordering',
      updated_at: now, updated_by: 'S07-ordering',
      version: 1, source_system: 'S07-ordering',
      commit_id: 'S07-' + key
    };
    store.insert('Tasks', task);
    created.push({ code, task_id: task.id });
  }

  const orders = store.list('Orders').filter(o => o.job_id === jobId && o.status === 'Draft');
  if (orders.length > 0) {
    mkTask('MAT01', 'Place material order', 'Materials', null, 1);
  }

  return { created, skipped };
}

function resolvePersonByRole(store, role) {
  const roles = store.list('PersonRoles').filter(r => r.role === role && r.active === true);
  if (roles.length === 0) return null;
  return roles[0].person_id;
}

/* --- Full S07 process --- */

function processJobOrdering(jobId, store, options = {}) {
  const reqs = evaluateMaterialRequirements(jobId, store);
  let orderResult = { status: 'NotReady', orders_created: 0, created: [], errors: [] };
  let taskResult = { created: [], skipped: [] };

  if (reqs.ready) {
    orderResult = createOrderForJob(jobId, store, options);
    taskResult = createOrderingTasks(jobId, store, options);
  }

  return {
    job_id: jobId,
    requirements: reqs,
    ordering: orderResult,
    tasks: taskResult,
    success: reqs.ready && orderResult.status === 'Created'
  };
}

module.exports = {
  DEV_SHEET_ID,
  evaluateMaterialRequirements, createOrderForJob, createOrderingTasks, processJobOrdering,
  resolvePersonByRole
};
