/* S05 mapping layer — Jotform question-to-field mapping.
 * Uses the existing MappingRules table from the canonical schema.
 * No guessed Jotform question IDs. Synthetic DEV mappings only.
 * Missing required mappings fail closed with NeedsReview.
 * Real Job Booking column labels are mapped to synthetic question_ids
 * that must be replaced with exported Jotform QIDs before live use. */

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function buildFieldMap(rules, formId) {
  const active = rules.filter(r => r.form_id === formId && r.active === true);
  const byQuestion = {};
  for (const r of active) {
    byQuestion[r.question_id] = r;
  }
  return byQuestion;
}

function extractField(payload, rule) {
  const raw = payload[rule.question_id];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!rule.transform) return raw;
  if (rule.transform === 'trim') return String(raw).trim();
  if (rule.transform === 'lowercase') return String(raw).toLowerCase().trim();
  if (rule.transform === 'uppercase') return String(raw).toUpperCase().trim();
  if (rule.transform === 'integer') {
    const n = parseInt(String(raw).replace(/[^0-9-]/g, ''), 10);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  if (rule.transform === 'decimal_pence') {
    // Pounds with decimals → pence; bare integer treated as pence if >= 1000 else pounds*100 heuristic avoided — require pounds.decimal or pence via integer map
    const s = String(raw).trim().replace(/,/g, '');
    if (!s) return undefined;
    if (s.includes('.')) {
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n * 100) : undefined;
    }
    const n = parseInt(s.replace(/[^0-9-]/g, ''), 10);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  if (rule.transform === 'boolean') {
    const s = String(raw).toLowerCase().trim();
    if (s === 'true' || s === 'yes' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === '0') return false;
    return undefined;
  }
  if (rule.transform.startsWith('map:')) {
    const mapDef = rule.transform.slice(4);
    try {
      const map = JSON.parse(mapDef);
      return map[String(raw)] !== undefined ? map[String(raw)] : raw;
    } catch (_) { return raw; }
  }
  return raw;
}

function applyMappings(payload, rules, formId) {
  const byQuestion = buildFieldMap(rules, formId);
  const fields = {};
  const missingRequired = [];
  const errors = [];

  for (const rule of Object.values(byQuestion)) {
    const value = extractField(payload, rule);
    if (value !== undefined) {
      if (!fields[rule.target_table]) fields[rule.target_table] = {};
      fields[rule.target_table][rule.target_field] = value;
    } else if (rule.required_when === 'always') {
      missingRequired.push(rule);
    }
  }

  return { fields, missingRequired, errors };
}

function buildSyntheticMapping(formId, formType, idPrefix) {
  const now = new Date().toISOString();
  const base = {
    form_id: formId,
    mapping_version: 'S05-DEV-2.0',
    effective_from: '2026-09-09',
    owner: 'S05-fixture',
    disposition: 'Import',
    active: true,
    created_at: now, created_by: 'S05-fixture',
    updated_at: now, updated_by: 'S05-fixture',
    version: 1, commit_id: 'S05-fixture'
  };

  const rules = [];

  function add(id, label, table, field, transform, requiredWhen) {
    rules.push({
      ...base,
      id: (idPrefix || ('MAP-' + formType + '-')) + id,
      question_id: id,
      source_label: label,
      target_table: table,
      target_field: field,
      transform: transform || null,
      required_when: requiredWhen || null
    });
  }

  if (formType === 'Sold') {
    add('sold_first_name', 'First Name', 'Customers', 'first_name', 'trim', 'always');
    add('sold_last_name', 'Last Name', 'Customers', 'last_name', 'trim', 'always');
    add('sold_address1', 'Address Line 1', 'Customers', 'address_line1', 'trim', 'always');
    add('sold_address2', 'Address Line 2', 'Customers', 'address_line2', 'trim', null);
    add('sold_town', 'Town/City', 'Customers', 'town', 'trim', 'always');
    add('sold_postcode', 'Postcode', 'Customers', 'postcode', 'uppercase', 'always');
    add('sold_email', 'Email', 'Customers', 'email', 'lowercase', null);
    add('sold_phone', 'Phone', 'Customers', 'phone', 'trim', null);
    add('sold_lead_source', 'Lead Source', 'Jobs', 'lead_source', 'trim', null);
    add('sold_quote_ref', 'Quote Reference', 'Jobs', 'quote_reference', 'trim', null);
    add('sold_finance_route', 'Finance Route', 'Jobs', 'finance_route', 'trim', 'always');
    add('sold_salesperson_id', 'Salesperson', 'Jobs', 'salesperson_id', 'trim', null);
    add('sold_presale_file_id', 'Presale File', 'Jobs', 'presale_file_id', 'trim', null);
    add('sold_roof_notes', 'Roof Notes', 'TechnicalDetails', 'roof_notes', 'trim', null);
    add('sold_electrical_notes', 'Electrical Notes', 'TechnicalDetails', 'electrical_notes', 'trim', null);
    add('sold_roof', 'Roof Required', 'Jobs', 'roof_required', 'boolean', null);
    add('sold_electrical', 'Electrical Required', 'Jobs', 'electrical_required', 'boolean', null);
    add('sold_scaffold', 'Scaffold Required', 'Jobs', 'scaffold_required', 'boolean', null);
    add('sold_gross_pence', 'Contract Value (pence)', 'Jobs', 'original_gross_pence', 'integer', null);
    add('sold_valuation', 'Valuation Basis', 'Jobs', 'valuation_basis', 'trim', null);
  } else if (formType === 'Booking') {
    // Exact Job ID reference — NEVER surname/address fallback
    add('booking_job_id', 'Job ID', 'Jobs', 'job_id', 'trim', 'always');
    // Customer proposals (checked, not silent overwrite)
    add('booking_first_name', '1st name', 'Customers', 'first_name', 'trim', null);
    add('booking_last_name', '2nd name', 'Customers', 'last_name', 'trim', null);
    add('booking_address1', 'Address - Street Address', 'Customers', 'address_line1', 'trim', null);
    add('booking_town', 'Address - City', 'Customers', 'town', 'trim', null);
    add('booking_postcode', 'Post code', 'Customers', 'postcode', 'uppercase', null);
    add('booking_phone', 'Customer Phone Number', 'Customers', 'phone', 'trim', null);
    add('booking_email', 'Customer Email', 'Customers', 'email', 'lowercase', null);
    // Value / finance / merchant (gross used for mismatch check only)
    add('booking_solar_kw', 'Solar size (kW) 2 decimal place', 'Jobs', 'solar_kw', 'trim', null);
    add('booking_cost', 'Cost of job', 'Jobs', 'booking_gross_pence', 'decimal_pence', null);
    add('booking_finance', 'Finance', 'Jobs', 'finance_route', 'trim', null);
    add('booking_merchant', 'Merchant Name', 'Jobs', 'merchant_name', 'trim', null);
    add('booking_invoice_date', 'Date for invoice', 'Jobs', 'invoice_date', 'trim', null);
    add('booking_annual_gen', 'Annual generation', 'Jobs', 'annual_generation', 'trim', null);
    // Dates → WorkPackageDates / Scaffold (applied into WorkPackages / ScaffoldBookings)
    add('booking_date_roofer', 'Date Roofer', 'WorkPackageDates', 'roof_date', 'trim', null);
    add('booking_date_sparky', 'Date Sparky', 'WorkPackageDates', 'electrical_date', 'trim', null);
    add('booking_date_scaffold', 'Date Scaffolding (at least 2 days before roofer)', 'WorkPackageDates', 'scaffold_erect', 'trim', null);
    // Installers (resolved to People by exact display_name)
    add('booking_roofer', 'Roofer', 'Installers', 'roofer', 'trim', null);
    add('booking_sparky', 'Sparky', 'Installers', 'sparky', 'trim', null);
    add('booking_second_sparky', '2nd Sparky', 'Installers', 'second_sparky', 'trim', null);
    // Scaffold
    add('booking_scaffold_company', 'Scaffold company', 'Scaffold', 'company_name', 'trim', null);
    add('booking_scaffold_pdf', 'Scaffold PDF & additional', 'Scaffold', 'pdf', 'trim', null);
    add('booking_scaffold_notes', 'Scaffolding notes', 'Notes', 'scaffolding', 'trim', null);
    add('booking_roofing_notes', 'Roofing notes', 'Notes', 'roofing', 'trim', null);
    add('booking_electrical_notes', 'Electrical notes', 'Notes', 'electrical', 'trim', null);
    add('booking_ordering_notes', 'Ordering notes', 'Notes', 'ordering', 'trim', null);
    // Materials — individual lines (totals preferred when present)
    add('booking_roof_hooks_type', 'Roof hooks type', 'Notes', 'roof_hooks_type', 'trim', null);
    add('booking_mat_slate_portrait', 'Slate Portrait - Renusol Roof Hook (R420181) - & screws', 'MaterialQty', 'renusol_hook_r420181_slate_portrait', 'integer', null);
    add('booking_mat_slate_landscape', 'Slate Landscape - Renusol Roof Hook (R420181) - & screws', 'MaterialQty', 'renusol_hook_r420181_slate_landscape', 'integer', null);
    add('booking_mat_r420181_total', 'Total Renusol Roof Hook (R420181) -& screws', 'MaterialQty', 'renusol_hook_r420181_total', 'integer', null);
    add('booking_mat_concrete_portrait', 'Concrete Portrait - Renusol Roof hook (R420150) - & screws', 'MaterialQty', 'renusol_hook_r420150_concrete_portrait', 'integer', null);
    add('booking_mat_concrete_landscape', 'Concrete Landscape - Renusol Roof Hook (R420150) - & screws', 'MaterialQty', 'renusol_hook_r420150_concrete_landscape', 'integer', null);
    add('booking_mat_r420150_total', 'Total Renusol Roof Hook (R420150) -& screws', 'MaterialQty', 'renusol_hook_r420150_total', 'integer', null);
    add('booking_mat_l_bracket', 'L bracket for landscape hooks - REN-420353', 'MaterialQty', 'renusol_l_bracket_ren_420353', 'integer', null);
    add('booking_mat_hook_rest', 'Hook Rest Rubber Tile H-Rest', 'MaterialQty', 'renusol_hook_rest_rubber', 'integer', null);
    add('booking_mat_end_clamps', 'Renusol End clamps REN-420081-B', 'MaterialQty', 'renusol_end_clamps_ren_420081_b', 'integer', null);
    add('booking_mat_end_caps', 'Renusol End caps REN-900276', 'MaterialQty', 'renusol_end_caps_ren_900276', 'integer', null);
    add('booking_mat_mid_clamps', 'Renusol Mid clamps REN-420082-B', 'MaterialQty', 'renusol_mid_clamps_ren_420082_b', 'integer', null);
    add('booking_mat_rail', 'Renusol Rail REN-400572', 'MaterialQty', 'renusol_rail_ren_400572', 'integer', null);
    add('booking_mat_splice', 'Renusol Splice REN-400531', 'MaterialQty', 'renusol_splice_ren_400531', 'integer', null);
    add('booking_mat_k2_flat_multi', 'K2 Flat multi rail - landscape', 'MaterialQty', 'k2_flat_multi_rail_landscape', 'integer', null);
    add('booking_mat_k2_curved_multi', 'K2 Curved multi rail - landscape', 'MaterialQty', 'k2_curved_multi_rail_landscape', 'integer', null);
    add('booking_mat_k2_flat_mini', 'K2 Flat mini rail - portrait', 'MaterialQty', 'k2_flat_mini_rail_portrait', 'integer', null);
    add('booking_mat_k2_curved_mini', 'K2 Curved mini rail - portrait', 'MaterialQty', 'k2_curved_mini_rail_portrait', 'integer', null);
    add('booking_mat_genius', 'Genius Speed flashing', 'MaterialQty', 'genius_speed_flashing', 'integer', null);
    add('booking_mat_k2_1000074', 'K2 1000074 15CM Roof Hook for Flat Tiles - Portrait & Landscape (NEED 1 x 1000041 T-bolt & 1000042 Nut WITH EVERY HOOK)', 'MaterialQty', 'k2_1000074_hook', 'integer', null);
    add('booking_mat_k2_mid', 'K2 Mid Clamps 2004540 - Portrait & Landscape', 'MaterialQty', 'k2_mid_clamps_2004540', 'integer', null);
    add('booking_mat_k2_end', 'K2 End Clamps 2004545 - Portrait & Landscape', 'MaterialQty', 'k2_end_clamps_2004545', 'integer', null);
    add('booking_mat_k2_end_caps', 'K2 End Caps - Portrait & Landscape', 'MaterialQty', 'k2_end_caps', 'integer', null);
    add('booking_mat_k2_rail', 'K2 Rail - Portrait & Landscape', 'MaterialQty', 'k2_rail', 'integer', null);
    add('booking_mat_k2_splice', 'K2 Splice - Portrait & Landscape', 'MaterialQty', 'k2_splice', 'integer', null);
    add('booking_mat_panel_515', 'Amount of 515 Panels', 'MaterialQty', 'panel_515', 'integer', null);
    add('booking_mat_panel_460', 'Amount of 460 Panels', 'MaterialQty', 'panel_460', 'integer', null);
    add('booking_mat_panel_m', 'Amount of M-Class Panels', 'MaterialQty', 'panel_m_class', 'integer', null);
    add('booking_mat_bird_netting', 'Bird netting (m)', 'MaterialQty', 'bird_netting_m', 'integer', null);
    add('booking_mat_optimisers', 'Optimisers', 'MaterialQty', 'optimisers', 'integer', null);
    add('booking_mat_fox_jb', 'Fox Junction Box', 'MaterialQty', 'fox_junction_box', 'integer', null);
    add('booking_mat_dongle', 'Dongle', 'MaterialQty', 'dongle', 'integer', null);
    add('booking_mat_gateway', 'Gateway', 'MaterialQty', 'gateway', 'integer', null);
    add('booking_mat_ev', 'EV Charger', 'MaterialQty', 'ev_charger', 'integer', null);
    // Equipment
    add('booking_inverter', 'Inverter to order', 'Equipment', 'inverter_to_order', 'trim', null);
    add('booking_battery', 'Battery to order', 'Equipment', 'battery_to_order', 'trim', null);
    add('booking_battery_qty', 'How many batteries?', 'Equipment', 'battery_quantity', 'integer', null);
    add('booking_fox_jb_calc', 'Fox Junction Box Calculation', 'Notes', 'fox_jb_calc', 'trim', null);
    add('booking_extras', 'Extras', 'Notes', 'extras', 'trim', null);
    add('booking_sig_extras', 'Sig Extras To Order', 'Notes', 'sig_extras', 'trim', null);
    add('booking_tesla_extras', 'Tesla Extras To Order', 'Notes', 'tesla_extras', 'trim', null);
    // Submission identity retained on Intake; mapping retained for completeness
    add('booking_submission_id_field', 'Submission ID', 'Jobs', 'external_submission_id', 'trim', null);
  }

  return rules;
}

/* Exact job_id match only. Blank/unknown/ambiguous → null (Intake Review). */
function resolveBookingJob(store, mappedFields) {
  const jobFields = mappedFields.Jobs || {};
  const jobId = jobFields.job_id;
  if (!jobId || typeof jobId !== 'string' || !String(jobId).trim()) return null;
  const allJobs = store.list('Jobs');
  const matches = allJobs.filter(j => j.job_id === String(jobId).trim());
  if (matches.length === 1) return matches[0];
  return null;
}

function generateJobId(store) {
  const existing = new Set(store.list('Jobs').map(j => j.job_id));
  for (let attempt = 0; attempt < 20; attempt++) {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '0123456789';
    const id = 'SS-' +
      letters[Math.floor(Math.random() * letters.length)] +
      letters[Math.floor(Math.random() * letters.length)] +
      letters[Math.floor(Math.random() * letters.length)] +
      letters[Math.floor(Math.random() * letters.length)] + '-' +
      digits[Math.floor(Math.random() * digits.length)] +
      digits[Math.floor(Math.random() * digits.length)] +
      digits[Math.floor(Math.random() * digits.length)] +
      digits[Math.floor(Math.random() * digits.length)];
    if (!existing.has(id)) return id;
  }
  throw new Error('JOB_ID_COLLISION_EXHAUSTED');
}

function generateInternalJobId() {
  return 'J-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function generateCustomerId() {
  return 'CUST-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  buildFieldMap, extractField, applyMappings,
  buildSyntheticMapping, resolveBookingJob,
  generateJobId, generateInternalJobId, generateCustomerId
};
