/* Apply structured Booking fields onto existing Job records.
 * Never writes Jotform directly into Jobs as the sole store.
 * Customer/value mismatches → CustomerChanges + Review match status.
 * Product SKUs without approval stay NEED_APPROVAL (no invented IDs).
 * No surname/address job matching. No external sends. */

'use strict';

const DEFAULT_PRODUCT_MAP = require('../config/booking-product-map.example.json');

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function norm(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/\s+/g, ' ').toLowerCase();
}
function moneyPence(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = String(v).trim().replace(/,/g, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Treat decimal pounds as pounds → pence when a decimal point is present
  if (String(v).includes('.')) return Math.round(n * 100);
  return Math.round(n);
}
function qty(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function idSuffix() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function loadProductMap(options) {
  if (options && options.productMap) return options.productMap;
  return DEFAULT_PRODUCT_MAP;
}

function compareCustomerField(field, previous, incoming) {
  if (incoming === undefined || incoming === null || incoming === '') return null;
  const prev = previous === null || previous === undefined ? '' : String(previous);
  if (norm(prev) === norm(incoming)) return null;
  return { field_name: field, previous_value: prev || null, incoming_value: String(incoming).trim() };
}

function resolveInstallerByName(store, name) {
  if (!name || !String(name).trim()) return { status: 'blank', person: null };
  const target = norm(name);
  const matches = store.list('People').filter(p =>
    p.active === true && p.role === 'Installer' && norm(p.display_name) === target);
  if (matches.length === 1) return { status: 'resolved', person: matches[0] };
  if (matches.length === 0) return { status: 'unresolved', person: null, reason: 'INSTALLER_NOT_FOUND', name: String(name).trim() };
  return { status: 'ambiguous', person: null, reason: 'INSTALLER_AMBIGUOUS', name: String(name).trim() };
}

function ensureWorkPackage(store, job, trade, plannedStart, plannedEnd, intakeId, notes) {
  const existing = store.list('WorkPackages').find(w => w.job_id === job.id && w.trade === trade && w.status !== 'Cancelled');
  const now = new Date().toISOString();
  const start = plannedStart || null;
  const end = plannedEnd || plannedStart || null;
  if (existing) {
    const patch = {
      planned_start: start || existing.planned_start,
      planned_end: end || existing.planned_end,
      required: true,
      updated_at: now,
      updated_by: 'S05-booking-apply',
      version: Number(existing.version || 0) + 1,
      commit_id: intakeId
    };
    if (notes) patch.completion_outcome = existing.completion_outcome; // preserve
    store.update('WorkPackages', existing.id, patch);
    return store.get('WorkPackages', existing.id);
  }
  const row = {
    id: 'WP-' + trade.toLowerCase() + '-' + idSuffix(),
    job_id: job.id,
    trade,
    required: true,
    planned_start: start,
    planned_end: end,
    actual_start: null,
    actual_end: null,
    status: start ? 'Scheduled' : 'Unscheduled',
    need_by_date: start,
    completion_outcome: null,
    installer_confirmation_at: null,
    installer_confirmation_by: null,
    commissioning_required: trade === 'Electrical',
    sequence: trade === 'Roof' ? 1 : (trade === 'Electrical' ? 2 : 9),
    revision: 1,
    parent_package_id: null,
    created_at: now,
    created_by: 'S05-booking-apply',
    updated_at: now,
    updated_by: 'S05-booking-apply',
    version: 1,
    source_system: 'S05-booking-apply',
    commit_id: intakeId
  };
  store.insert('WorkPackages', row);
  return row;
}

function ensureScaffold(store, job, dates, companyName, notes, intakeId) {
  const existing = store.list('ScaffoldBookings').find(s => s.job_id === job.id && s.status !== 'Cancelled');
  const now = new Date().toISOString();
  let companyId = null;
  if (companyName && String(companyName).trim()) {
    const cos = store.list('Companies').filter(c =>
      c.active !== false && (c.type === 'Scaffolder' || !c.type) && norm(c.name) === norm(companyName));
    if (cos.length === 1) companyId = cos[0].id;
  }
  const erect = dates.scaffold_erect || null;
  if (existing) {
    store.update('ScaffoldBookings', existing.id, {
      erect_planned_at: erect || existing.erect_planned_at,
      access_notes: notes || existing.access_notes,
      company_id: companyId || existing.company_id,
      updated_at: now,
      updated_by: 'S05-booking-apply',
      version: Number(existing.version || 0) + 1,
      commit_id: intakeId
    });
    return { scaffold: store.get('ScaffoldBookings', existing.id), company_resolved: !!companyId, company_name: companyName || null };
  }
  if (!erect && !companyName && !notes) return null;
  const row = {
    id: 'SCB-' + idSuffix(),
    job_id: job.id,
    company_id: companyId,
    erect_planned_at: erect,
    erect_confirmed_at: null,
    erect_actual_at: null,
    strip_forecast_at: null,
    strip_authorised_at: null,
    strip_authorised_by: null,
    strip_planned_at: null,
    strip_confirmed_at: null,
    strip_actual_at: null,
    status: erect ? 'Planned' : 'Draft',
    revision: 1,
    confirmed_revision: null,
    access_notes: notes || null,
    scope_file_id: null,
    quoted_cost_pence: null,
    actual_cost_pence: null,
    invoice_reference: null,
    related_issue_ids: null,
    created_at: now,
    created_by: 'S05-booking-apply',
    updated_at: now,
    updated_by: 'S05-booking-apply',
    version: 1,
    source_system: 'S05-booking-apply',
    commit_id: intakeId
  };
  store.insert('ScaffoldBookings', row);
  return { scaffold: row, company_resolved: !!companyId, company_name: companyName || null };
}

function materialIdempotencyKey(jobId, mapKey) {
  return 'MAT-BOOKING-' + jobId + '-' + mapKey;
}

function createMaterialLines(store, job, roofWp, electricalWp, quantities, productMap, intakeId, merchantName) {
  const created = [];
  const requirements = [];
  const materialsCfg = (productMap && productMap.materials) || {};
  const skipComponents = productMap && productMap.skip_component_when_authoritative_total_present === true;
  const hasR420181Total = qty(quantities.renusol_hook_r420181_total);
  const hasR420150Total = qty(quantities.renusol_hook_r420150_total);

  let merchantId = null;
  if (merchantName && String(merchantName).trim()) {
    const merchants = store.list('Companies').filter(c =>
      c.active !== false && (c.type === 'Merchant' || !c.type) && norm(c.name) === norm(merchantName));
    if (merchants.length === 1) merchantId = merchants[0].id;
  }

  for (const [key, rawQty] of Object.entries(quantities || {})) {
    const q = qty(rawQty);
    if (!q) continue;
    const cfg = materialsCfg[key];
    if (!cfg) {
      requirements.push({ key, reason: 'NO_PRODUCT_MAP_ENTRY', quantity: q });
      continue;
    }
    if (skipComponents && cfg.authoritative_total !== true) {
      if (key.indexOf('r420181') >= 0 && !key.endsWith('_total') && hasR420181Total) continue;
      if (key.indexOf('r420150') >= 0 && !key.endsWith('_total') && hasR420150Total) continue;
    }
    const mid = materialIdempotencyKey(job.id, key);
    if (store.get('Materials', mid)) {
      created.push({ id: mid, replayed: true });
      continue;
    }
    const needApproval = !cfg.product_id || cfg.product_id === 'NEED_APPROVAL';
    if (needApproval) requirements.push({ key, reason: 'PRODUCT_ID_NEED_APPROVAL', description: cfg.description, quantity: q });
    const category = cfg.category || '';
    const wpId = category === 'Electrical' || category === 'Panel' && key.indexOf('panel') === 0
      ? (electricalWp && electricalWp.id) || (roofWp && roofWp.id) || null
      : (roofWp && roofWp.id) || (electricalWp && electricalWp.id) || null;
    const panelWp = category === 'Panel' ? ((roofWp && roofWp.id) || null) : wpId;
    const now = new Date().toISOString();
    const row = {
      id: mid,
      job_id: job.id,
      work_package_id: panelWp,
      product_id: needApproval ? null : cfg.product_id,
      description: cfg.description,
      required_quantity: q,
      unit: cfg.unit || 'ea',
      source: 'ToOrder',
      need_by_date: (roofWp && roofWp.planned_start) || (electricalWp && electricalWp.planned_start) || null,
      merchant_id: merchantId,
      order_line_id: null,
      already_ordered_reference: null,
      notes: needApproval ? 'MAPPING_REQUIRED:' + key : null,
      revision: 1,
      cancelled_quantity: 0,
      created_at: now,
      created_by: 'S05-booking-apply',
      updated_at: now,
      updated_by: 'S05-booking-apply',
      version: 1,
      source_system: 'S05-booking-apply',
      commit_id: intakeId
    };
    store.insert('Materials', row);
    created.push({ id: mid, key, quantity: q, need_approval: needApproval });
  }
  return { created, requirements, merchant_id: merchantId };
}

function createEquipment(store, job, electricalWp, equipmentFields, productMap, intakeId) {
  const created = [];
  const requirements = [];
  const cfg = (productMap && productMap.equipment) || {};
  const now = new Date().toISOString();

  function add(fieldKey, quantity) {
    const map = cfg[fieldKey];
    if (!map) {
      requirements.push({ key: fieldKey, reason: 'NO_EQUIPMENT_MAP_ENTRY' });
      return;
    }
    const text = equipmentFields[fieldKey];
    if (!text && !quantity) return;
    const needApproval = !map.product_id || map.product_id === 'NEED_APPROVAL';
    if (needApproval) requirements.push({ key: fieldKey, reason: 'PRODUCT_ID_NEED_APPROVAL', value: text || quantity });
    const eid = 'JEQ-BOOKING-' + job.id + '-' + fieldKey;
    if (store.get('JobEquipment', eid)) {
      created.push({ id: eid, replayed: true });
      return;
    }
    store.insert('JobEquipment', {
      id: eid,
      job_id: job.id,
      work_package_id: electricalWp ? electricalWp.id : null,
      equipment_type: map.equipment_type,
      planned_product_id: needApproval ? null : map.product_id,
      installed_product_id: null,
      quantity: quantity || 1,
      planned_location: text ? String(text).trim() : null,
      installed_location: null,
      serial_number: null,
      commissioning_submission_id: null,
      variation_id: null,
      technical_review_status: needApproval ? 'MappingRequired' : 'Planned',
      created_at: now,
      created_by: 'S05-booking-apply',
      updated_at: now,
      updated_by: 'S05-booking-apply',
      version: 1,
      commit_id: intakeId
    });
    created.push({ id: eid, equipment_type: map.equipment_type, need_approval: needApproval });
  }

  add('inverter_to_order', 1);
  const batteryQty = qty(equipmentFields.battery_quantity) || (equipmentFields.battery_to_order ? 1 : null);
  if (equipmentFields.battery_to_order || batteryQty) add('battery_to_order', batteryQty || 1);
  return { created, requirements };
}

function writeCustomerChanges(store, job, customer, custFields, intakeId) {
  const changes = [];
  const fields = [
    ['first_name', custFields.first_name],
    ['last_name', custFields.last_name],
    ['address_line1', custFields.address_line1],
    ['address_line2', custFields.address_line2],
    ['town', custFields.town],
    ['postcode', custFields.postcode],
    ['email', custFields.email],
    ['phone', custFields.phone]
  ];
  const now = new Date().toISOString();
  for (const [name, incoming] of fields) {
    const diff = compareCustomerField(name, customer[name], incoming);
    if (!diff) continue;
    const cid = 'CC-' + job.id + '-' + name + '-' + intakeId;
    if (!store.get('CustomerChanges', cid)) {
      store.insert('CustomerChanges', {
        id: cid,
        job_id: job.id,
        field_name: diff.field_name,
        previous_value: diff.previous_value,
        incoming_value: diff.incoming_value,
        source_submission_id: intakeId,
        resolution: null,
        resolved_value: null,
        resolved_at: null,
        resolved_by: null,
        reason: 'BOOKING_CUSTOMER_MISMATCH',
        created_at: now,
        commit_id: intakeId
      });
    }
    changes.push(diff);
  }
  return changes;
}

function applyBookingStructured(store, job, mappedFields, intake, options) {
  const productMap = loadProductMap(options || {});
  const customer = store.get('Customers', job.customer_id);
  const custFields = mappedFields.Customers || {};
  const jobFields = mappedFields.Jobs || {};
  const dates = mappedFields.WorkPackageDates || {};
  const installers = mappedFields.Installers || {};
  const materialsQty = mappedFields.MaterialQty || {};
  const equipmentFields = mappedFields.Equipment || {};
  const scaffoldFields = mappedFields.Scaffold || {};
  const notes = mappedFields.Notes || {};
  const out = {
    customer_changes: [],
    amount_mismatch: null,
    match_status: 'Match',
    needs_review: false,
    review_reasons: [],
    work_packages: [],
    scaffold: null,
    materials: [],
    equipment: [],
    installers: { resolved: [], unresolved: [] },
    mapping_requirements: [],
    display_name: null
  };

  if (!customer) {
    out.needs_review = true;
    out.review_reasons.push('CUSTOMER_MISSING');
    out.match_status = 'Review';
    return out;
  }

  out.customer_changes = writeCustomerChanges(store, job, customer, custFields, intake.intake_id);
  if (out.customer_changes.length) {
    out.needs_review = true;
    out.review_reasons.push('CUSTOMER_MISMATCH');
    out.match_status = 'Review';
  }

  const bookingGross = moneyPence(jobFields.booking_gross_pence);
  if (bookingGross !== null && typeof job.original_gross_pence === 'number' && job.original_gross_pence > 0) {
    if (bookingGross !== job.original_gross_pence) {
      out.amount_mismatch = { previous: job.original_gross_pence, incoming: bookingGross };
      out.needs_review = true;
      out.review_reasons.push('AMOUNT_MISMATCH');
      out.match_status = 'Review';
    }
  }

  // Display name from surname + postcode when available (derived, not a match key)
  const last = (custFields.last_name || customer.last_name || '').trim();
  const pc = (custFields.postcode || customer.postcode || '').trim();
  if (last && pc) out.display_name = last + ' – ' + pc;

  const roofDate = dates.roof_date || null;
  const elecDate = dates.electrical_date || null;
  let roofWp = null;
  let elecWp = null;
  if (roofDate || job.roof_required || materialsQty && Object.keys(materialsQty).some(k => k.indexOf('panel') === 0 || k.indexOf('renusol') === 0 || k.indexOf('k2') === 0)) {
    roofWp = ensureWorkPackage(store, job, 'Roof', roofDate, roofDate, intake.intake_id, notes.roofing);
    out.work_packages.push(roofWp.id);
  }
  if (elecDate || job.electrical_required || equipmentFields.inverter_to_order || equipmentFields.battery_to_order) {
    elecWp = ensureWorkPackage(store, job, 'Electrical', elecDate, elecDate, intake.intake_id, notes.electrical);
    out.work_packages.push(elecWp.id);
  }
  // Job flags when dates imply work
  const jobPatchFlags = {};
  if (roofWp) jobPatchFlags.roof_required = true;
  if (elecWp) jobPatchFlags.electrical_required = true;

  if (dates.scaffold_erect || scaffoldFields.company_name || scaffoldFields.notes || job.scaffold_required) {
    const sc = ensureScaffold(store, job, dates, scaffoldFields.company_name, scaffoldFields.notes || notes.scaffolding, intake.intake_id);
    if (sc) {
      out.scaffold = sc;
      jobPatchFlags.scaffold_required = true;
      if (scaffoldFields.company_name && !sc.company_resolved) {
        out.review_reasons.push('SCAFFOLD_COMPANY_UNRESOLVED');
        // advisory — does not alone force match Review unless no date linkage needed
      }
    }
  }

  for (const role of [
    ['roofer', 'Roof', 'Lead'],
    ['sparky', 'Electrical', 'Lead'],
    ['second_sparky', 'Electrical', 'Second']
  ]) {
    const [field, trade, allocRole] = role;
    const name = installers[field];
    if (!name) continue;
    const resolved = resolveInstallerByName(store, name);
    if (resolved.status === 'resolved') {
      out.installers.resolved.push({ field, person_id: resolved.person.id, trade, role: allocRole });
      const wp = trade === 'Roof' ? roofWp : elecWp;
      if (wp) {
        const aid = 'ALLOC-BOOKING-' + job.id + '-' + field;
        if (!store.get('Allocations', aid)) {
          const now = new Date().toISOString();
          store.insert('Allocations', {
            id: aid,
            work_package_id: wp.id,
            person_id: resolved.person.id,
            role: allocRole,
            start_at: wp.planned_start,
            end_at: wp.planned_end || wp.planned_start,
            active: true,
            replaced_allocation_id: null,
            cancellation_reason: null,
            calendar_link_id: null,
            created_at: now,
            created_by: 'S05-booking-apply',
            updated_at: now,
            updated_by: 'S05-booking-apply',
            version: 1,
            source_system: 'S05-booking-apply',
            commit_id: intake.intake_id
          });
        }
      }
    } else if (resolved.status !== 'blank') {
      out.installers.unresolved.push(resolved);
      out.needs_review = true;
      out.review_reasons.push(resolved.reason);
      out.match_status = 'Review';
    }
  }

  const mat = createMaterialLines(store, job, roofWp, elecWp, materialsQty, productMap, intake.intake_id, jobFields.merchant_name);
  out.materials = mat.created;
  out.mapping_requirements = out.mapping_requirements.concat(mat.requirements);

  const eq = createEquipment(store, job, elecWp, equipmentFields, productMap, intake.intake_id);
  out.equipment = eq.created;
  out.mapping_requirements = out.mapping_requirements.concat(eq.requirements);

  // Persist note snapshots on job next_action_at from earliest work date (derived summary only)
  const summaryDates = [roofDate, elecDate, dates.scaffold_erect].filter(Boolean).sort();
  out.job_patch = Object.assign({}, jobPatchFlags);
  if (summaryDates.length) out.job_patch.next_action_at = summaryDates[0];
  if (out.display_name) out.job_patch.display_name = out.display_name;
  if (notes.ordering || notes.roofing || notes.electrical) {
    out.job_patch.source_record_id = intake.intake_id;
  }

  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    applyBookingStructured,
    resolveInstallerByName,
    compareCustomerField,
    moneyPence,
    loadProductMap,
    DEFAULT_PRODUCT_MAP
  };
}
