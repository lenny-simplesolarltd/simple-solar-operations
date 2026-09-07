/* S08 picking/stock — stock availability, reservations, movements.
 * Uses canonical StockMovements, Reservations, StockLocations, Materials, Products.
 * FN-05 governs stock/picking. No real external actions. */

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = v => JSON.parse(JSON.stringify(v));

/* --- Stock availability --- */

function calculateStockAvailable(productId, locationId, store) {
  const movements = store.list('StockMovements').filter(m =>
    m.product_id === productId &&
    (m.from_location_id === locationId || m.to_location_id === locationId)
  );

  let balance = 0;
  for (const m of movements) {
    const qty = m.quantity || 0;
    if (m.to_location_id === locationId) balance += qty;
    if (m.from_location_id === locationId) balance -= qty;
  }
  return balance;
}

/* --- Pick evaluation --- */

function evaluatePickRequirements(jobId, store) {
  const materials = store.list('Materials').filter(m => m.job_id === jobId && m.source === 'Stock');
  const result = { job_id: jobId, items: [], ready: true, blocked: false, issues: [] };

  if (materials.length === 0) {
    result.ready = false;
    result.issues.push('No stock-source materials for job');
    return result;
  }

  for (const m of materials) {
    const issues = [];
    let itemReady = true;

    if (!m.product_id) { issues.push('Missing product_id'); itemReady = false; }
    if (!m.required_quantity || m.required_quantity <= 0) { issues.push('Missing quantity'); itemReady = false; }

    const locationId = 'LOC-store';
    const available = m.product_id ? calculateStockAvailable(m.product_id, locationId, store) : 0;
    const alreadyPicked = store.list('Reservations').filter(r =>
      r.material_id === m.id && r.status === 'Issued'
    ).reduce((sum, r) => sum + (r.picked_quantity || 0), 0);

    const remaining = m.required_quantity - alreadyPicked;
    const sufficient = remaining <= 0 || available >= remaining;

    if (remaining > 0 && !sufficient) {
      issues.push('Insufficient stock: need ' + remaining + ', have ' + available);
      itemReady = false;
    }

    const product = m.product_id ? store.get('Products', m.product_id) : null;
    const location = store.get('StockLocations', locationId);

    result.items.push({
      material_id: m.id,
      product_id: m.product_id,
      product_name: product ? product.name : null,
      required: m.required_quantity,
      already_picked: alreadyPicked,
      remaining,
      available,
      location_id: locationId,
      location_name: location ? location.name : null,
      ready: itemReady && remaining > 0 && sufficient,
      already_complete: remaining <= 0,
      issues
    });

    if (!itemReady) { result.ready = false; result.blocked = true; }
    if (remaining <= 0 && !itemReady) { /* already fully picked, not an error */ }
  }

  const pickableCount = result.items.filter(i => i.ready).length;
  result.summary = result.ready ? 'Ready' : (result.blocked ? 'Blocked' : 'NoAction');
  return result;
}

/* --- Pick execution --- */

function executePick(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = options.now || new Date().toISOString();
  const reqs = evaluatePickRequirements(jobId, store);
  if (!reqs.ready) {
    return { status: 'NotReady', movements_created: 0, reservations_created: 0, created: [], errors: reqs.issues };
  }

  const created = [];
  const skipped = [];

  for (const item of reqs.items) {
    if (!item.ready) {
      if (item.already_complete) skipped.push({ material_id: item.material_id, reason: 'Already fully picked' });
      continue;
    }

    const resId = 'RES-' + item.material_id;
    const existingRes = store.get('Reservations', resId);

    if (!existingRes) {
      store.insert('Reservations', {
        id: resId, material_id: item.material_id, product_id: item.product_id,
        location_id: item.location_id, quantity: item.remaining,
        status: 'Active', picked_quantity: 0, picked_at: null, picked_by: null,
        created_at: now, created_by: 'S08-picking', updated_at: now,
        updated_by: 'S08-picking', version: 1, commit_id: resId
      });
    }

    const movementKey = 'MOV-' + item.material_id + '-v1';
    const existingMov = store.list('StockMovements').find(m => m.idempotency_key === movementKey);
    if (existingMov) {
      skipped.push({ material_id: item.material_id, reason: 'Movement already exists', movement_id: existingMov.id });
      continue;
    }

    const movId = 'SM-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    store.insert('StockMovements', {
      id: movId, product_id: item.product_id, quantity: item.remaining,
      from_location_id: item.location_id, to_location_id: 'LOC-jobsite',
      movement_type: 'Issue', job_id: jobId, receipt_line_id: null,
      reason: 'S08 pick for job ' + jobId, evidence_id: null, approval_id: null,
      movement_at: now, idempotency_key: movementKey,
      created_at: now, commit_id: movId
    });

    // Update reservation
    store.update('Reservations', resId, {
      status: 'Issued', picked_quantity: item.remaining, picked_at: now, picked_by: 'S08-picking',
      updated_at: now, updated_by: 'S08-picking', version: (existingRes ? existingRes.version : 1) + 1
    });

    // Update material
    store.update('Materials', item.material_id, {
      source: 'AlreadyOrdered', updated_at: now, updated_by: 'S08-picking',
      version: (store.get('Materials', item.material_id)?.version || 0) + 1
    });

    created.push({ material_id: item.material_id, movement_id: movId, reservation_id: resId, quantity: item.remaining });
  }

  return {
    status: created.length > 0 ? 'Picked' : 'NoAction',
    movements_created: created.length,
    reservations_created: created.filter(c => !store.get('Reservations', 'RES-' + c.material_id)?.status).length || 0,
    created, skipped, errors: []
  };
}

/* --- Task creation --- */

function createPickTasks(jobId, store, options = {}) {
  /* S15: stop normal work during cancellation and controlled reopen review. */
  var S15_job = store.get('Jobs',jobId); if (S15_job && (S15_job.cancellation_at || ['CancellationInProgress','Cancelled'].includes(S15_job.workflow_stage) || store.list('Tasks').some(function(t){return t.job_id===S15_job.id&&t.template_code==='S15-REOPEN-REVIEW'&&!['Complete','NotRequired'].includes(t.status);}))) throw new Error('S15_REVIEW: normal work suppressed');

  const now = options.now || new Date().toISOString();
  const created = [];
  const tanyaId = 'PERSON-tanya';

  const key = 'S08-PICK-' + jobId;
  const exists = store.list('Tasks').find(t => t.instance_key === key);
  if (!exists) {
    const task = {
      id: 'TASK-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      job_id: jobId, template_code: 'S08-PICK-STOCK', instance_key: key,
      group: 'Materials', title: 'Pick stock for job',
      owner_id: tanyaId, backup_id: null,
      related_entity_type: 'Jobs', related_entity_id: jobId,
      due_at: null, original_due_at: null, priority: 1, status: 'Open',
      blocking_reason: null, next_followup_at: null,
      completed_at: null, completed_by: null, completion_note: null,
      evidence_id: null, revision_required: false,
      created_rule_version: 'S08-1.0',
      created_at: now, created_by: 'S08-picking',
      updated_at: now, updated_by: 'S08-picking',
      version: 1, source_system: 'S08-picking',
      commit_id: 'S08-' + key
    };
    store.insert('Tasks', task);
    created.push({ code: 'S08-PICK-STOCK', task_id: task.id });
  }

  return { created };
}

function processJobPicking(jobId, store, options = {}) {
  const reqs = evaluatePickRequirements(jobId, store);
  let pickResult = { status: 'NotReady', movements_created: 0, created: [], errors: [] };
  let taskResult = { created: [] };

  if (reqs.ready) {
    pickResult = executePick(jobId, store, options);
    taskResult = createPickTasks(jobId, store, options);
  }

  return { job_id: jobId, requirements: reqs, picking: pickResult, tasks: taskResult, success: reqs.ready && pickResult.status === 'Picked' };
}

module.exports = {
  DEV_SHEET_ID,
  calculateStockAvailable, evaluatePickRequirements, executePick, createPickTasks, processJobPicking
};
