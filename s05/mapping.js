/* S05 mapping layer — Jotform question-to-field mapping.
 * Uses the existing MappingRules table from the canonical schema.
 * No guessed Jotform question IDs. Synthetic DEV mappings only.
 * Missing required mappings fail closed with NeedsReview. */

function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* Build a field map from MappingRules rows.
 * Returns { byQuestion: { question_id: rule }, missingRequired: [field] } */
function buildFieldMap(rules, formId) {
  const active = rules.filter(r => r.form_id === formId && r.active === true);
  const byQuestion = {};
  for (const r of active) {
    byQuestion[r.question_id] = r;
  }
  return byQuestion;
}

/* Extract a single field value from raw payload using a mapping rule.
 * Returns the transformed value or undefined if not found. */
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

/* Apply all mapping rules to a raw payload.
 * Returns { fields: { table: { field: value } }, missingRequired: [rule], errors: [string] } */
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

/* Build a synthetic DEV mapping for a given form.
 * Returns MappingRules rows suitable for insertion. */
function buildSyntheticMapping(formId, formType) {
  const now = new Date().toISOString();
  const base = {
    form_id: formId,
    mapping_version: 'S05-DEV-1.0',
    effective_from: '2026-09-06',
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
      id: 'MAP-' + formType + '-' + id,
      question_id: id,
      source_label: label,
      target_table: table,
      target_field: field,
      transform: transform || null,
      required_when: requiredWhen || null
    });
  }

  if (formType === 'Sold') {
    // Customer fields
    add('sold_first_name', 'First Name', 'Customers', 'first_name', 'trim', 'always');
    add('sold_last_name', 'Last Name', 'Customers', 'last_name', 'trim', 'always');
    add('sold_address1', 'Address Line 1', 'Customers', 'address_line1', 'trim', 'always');
    add('sold_address2', 'Address Line 2', 'Customers', 'address_line2', 'trim', null);
    add('sold_town', 'Town/City', 'Customers', 'town', 'trim', 'always');
    add('sold_postcode', 'Postcode', 'Customers', 'postcode', 'uppercase', 'always');
    add('sold_email', 'Email', 'Customers', 'email', 'lowercase', null);
    add('sold_phone', 'Phone', 'Customers', 'phone', 'trim', null);
    // Job fields
    add('sold_lead_source', 'Lead Source', 'Jobs', 'lead_source', 'trim', null);
    add('sold_quote_ref', 'Quote Reference', 'Jobs', 'quote_reference', 'trim', null);
    add('sold_finance_route', 'Finance Route', 'Jobs', 'finance_route', 'trim', 'always');
    add('sold_roof', 'Roof Required', 'Jobs', 'roof_required', 'boolean', null);
    add('sold_electrical', 'Electrical Required', 'Jobs', 'electrical_required', 'boolean', null);
    add('sold_scaffold', 'Scaffold Required', 'Jobs', 'scaffold_required', 'boolean', null);
    add('sold_gross_pence', 'Contract Value (pence)', 'Jobs', 'original_gross_pence', 'integer', null);
    add('sold_valuation', 'Valuation Basis', 'Jobs', 'valuation_basis', 'trim', null);
  } else if (formType === 'Booking') {
    // Job-matching field (must match sold job)
    add('booking_sold_ref', 'Sold Reference / Job ID', 'Jobs', 'job_id', 'trim', 'always');
    // Booking-specific fields
    add('booking_install_date', 'Preferred Install Date', 'Jobs', 'next_action_at', 'trim', null);
    add('booking_notes', 'Booking Notes', 'Jobs', 'display_name', 'trim', null);
    // Customer updates
    add('booking_email', 'Email', 'Customers', 'email', 'lowercase', null);
    add('booking_phone', 'Phone', 'Customers', 'phone', 'trim', null);
  }

  return rules;
}

/* Find a matching Job for a booking submission.
 * Uses the job_id field from the mapped booking data (SS-XXXX-XXXX).
 * Returns the Job record or null. */
function resolveBookingJob(store, mappedFields) {
  const jobFields = mappedFields.Jobs || {};
  const jobId = jobFields.job_id;
  if (!jobId || typeof jobId !== 'string') return null;
  // Look up by human job_id (SS-XXXX-XXXX), not internal id
  const allJobs = store.list('Jobs');
  const matches = allJobs.filter(j => j.job_id === jobId);
  if (matches.length === 1) return matches[0];
  return null; // zero or ambiguous matches
}

/* Generate a unique SS-XXXX-XXXX job_id.
 * Uses existing convention: SS-XXXX-XXXX format with collision retry. */
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

/* Generate a stable internal Jobs.id */
function generateInternalJobId() {
  return 'J-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* Generate a stable internal Customers.id */
function generateCustomerId() {
  return 'CUST-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  buildFieldMap, extractField, applyMappings,
  buildSyntheticMapping, resolveBookingJob,
  generateJobId, generateInternalJobId, generateCustomerId
};
