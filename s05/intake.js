/* S05 intake processor — Sold and Booking intake handling.
 * Reuses canonical hash comparison for idempotency via Intake table.
 * No Jotform webhook, no outbound calls, no PROD. */

const { applyMappings, buildSyntheticMapping, resolveBookingJob,
  generateJobId, generateInternalJobId, generateCustomerId } = require('./mapping.js');

const DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const clone = value => JSON.parse(JSON.stringify(value));

function refuse(code) { const e = new Error(code); e.code = code; throw e; }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

/* Validate intake envelope */
function validateIntake(input) {
  if (!input || typeof input !== 'object') refuse('INVALID_INTAKE');
  const required = ['intake_id', 'form_id', 'form_type', 'submission_id', 'raw_payload'];
  for (const f of required) {
    if (!input[f]) refuse('MISSING_' + f.toUpperCase());
  }
  if (!['Sold', 'Booking'].includes(input.form_type)) refuse('INVALID_FORM_TYPE');
  if (typeof input.intake_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(input.intake_id)) {
    refuse('INVALID_INTAKE_ID');
  }
  if (typeof input.raw_payload !== 'object') refuse('INVALID_PAYLOAD');
  return {
    intake_id: input.intake_id,
    form_id: String(input.form_id),
    form_type: input.form_type,
    submission_id: String(input.submission_id),
    raw_payload: clone(input.raw_payload)
  };
}

/* Compute canonical hash of intake payload for idempotency */
function intakeHash(intake) {
  return canonical({ form_id: intake.form_id, submission_id: intake.submission_id, raw_payload: intake.raw_payload });
}

/* Build Customer record from mapped fields */
function buildCustomer(mappedFields, intakeId) {
  const f = mappedFields.Customers || {};
  const now = new Date().toISOString();
  return {
    id: generateCustomerId(),
    first_name: f.first_name || 'NOT_CONFIGURED',
    last_name: f.last_name || 'NOT_CONFIGURED',
    address_line1: f.address_line1 || 'NOT_CONFIGURED',
    address_line2: f.address_line2 || null,
    town: f.town || 'NOT_CONFIGURED',
    postcode: f.postcode || 'NOT_CONFIGURED',
    email: f.email || null,
    phone: f.phone || null,
    alternate_contact: null,
    contact_notes: null,
    created_at: now, created_by: 'S05-intake',
    updated_at: now, updated_by: 'S05-intake',
    version: 1, source_system: 'S05-intake',
    source_record_id: intakeId, commit_id: intakeId
  };
}

/* Build Job record from mapped fields */
function buildJob(mappedFields, customerId, soldIntakeId) {
  const f = mappedFields.Jobs || {};
  const now = new Date().toISOString();
  return {
    id: generateInternalJobId(),
    job_id: 'PENDING', // Will be set after generation
    customer_id: customerId,
    display_name: 'S05 synthetic job',
    sold_submission_id: soldIntakeId,
    booking_submission_id: null,
    sold_at: now,
    salesperson_id: null,
    lead_source: f.lead_source || null,
    quote_reference: f.quote_reference || null,
    presale_file_id: null,
    finance_route: f.finance_route || 'Standard',
    contract_status: 'NotSent',
    contract_id: null, contract_signed_at: null, contract_evidence_id: null,
    original_net_pence: null, original_vat_pence: null,
    original_gross_pence: f.original_gross_pence || null,
    approved_change_pence: null, current_contract_gross_pence: f.original_gross_pence || null,
    valuation_basis: f.valuation_basis || null,
    sold_booking_match_status: 'Pending',
    customer_details_verified_at: null, customer_details_verified_by: null,
    deposit_bank_confirmed_at: null, deposit_bank_confirmed_by: null,
    deposit_bank_reference: null,
    roof_required: f.roof_required === true,
    electrical_required: f.electrical_required === true,
    scaffold_required: f.scaffold_required === true,
    workflow_stage: 'Prebooking',
    booking_approved_at: null, booking_approved_by: null,
    operational_complete_at: null, operational_complete_by: null,
    customer_happy_at: null, customer_happy_by: null,
    handover_status: 'NotReady', financial_status: 'Pending',
    cancellation_at: null, cancellation_by: null, cancellation_reason: null,
    archived_at: null, next_action_at: null, account_policy_version: null,
    pilot_job: false, release_scope: 'R1',
    created_at: now, created_by: 'S05-intake',
    updated_at: now, updated_by: 'S05-intake',
    version: 1, source_system: 'S05-intake',
    source_record_id: soldIntakeId, commit_id: soldIntakeId
  };
}

/* Build Intake record */
function buildIntakeRecord(intake, status, jobId, errors) {
  const now = new Date().toISOString();
  return {
    id: intake.intake_id,
    intake_id: intake.intake_id,
    form_type: intake.form_type,
    form_id: intake.form_id,
    submission_id: intake.submission_id,
    source_revision: null,
    received_at: now,
    raw_payload_json: JSON.stringify(intake.raw_payload),
    payload_hash: intakeHash(intake),
    job_id: jobId || null,
    processing_status: status,
    validation_errors: errors ? JSON.stringify(errors) : null,
    processed_at: status === 'Processed' ? now : null,
    retry_count: 0,
    created_at: now,
    commit_id: intake.intake_id
  };
}

/* Guard: DEV only, correct sheet */
function guard(options) {
  const c = options.config;
  if (!c || c.environment !== 'DEV') refuse('DEV_ONLY');
  if (c.sheetId !== DEV_SHEET_ID || options.store.getSheetId() !== c.sheetId) refuse('SHEET_ID_MISMATCH');
}

/* --- Sold intake --- */
function processSoldIntake(options, input) {
  const { store, sha256 } = options;
  guard(options);
  const intake = validateIntake(input);

  // Check for existing intake (idempotency)
  const existing = store.get('Intake', intake.intake_id);
  if (existing) {
    const newHash = intakeHash(intake);
    if (existing.payload_hash === newHash && existing.processing_status === 'Processed') {
      return { status: 'Processed', duplicate: true, intake_id: intake.intake_id,
        job_id: existing.job_id, message: 'Already processed — idempotent replay' };
    }
    if (existing.payload_hash === newHash && existing.processing_status === 'Review') {
      return { status: 'Review', duplicate: true, intake_id: intake.intake_id,
        message: 'Previously flagged for review — unchanged' };
    }
    // Same intake_id, different payload
    const reviewRecord = clone(existing);
    reviewRecord.processing_status = 'Review';
    reviewRecord.validation_errors = JSON.stringify([{
      error: 'CONFLICTING_INTAKE', detail: 'Same intake_id with different payload'
    }]);
    store.update('Intake', intake.intake_id, reviewRecord);
    return { status: 'Review', intake_id: intake.intake_id,
      error: 'CONFLICTING_INTAKE', message: 'Same intake_id, different payload. Needs review.' };
  }

  // Apply mappings
  const rules = store.list('MappingRules');
  const { fields: mappedFields, missingRequired, errors } = applyMappings(intake.raw_payload, rules, intake.form_id);

  if (missingRequired.length > 0) {
    const reviewRecord = buildIntakeRecord(intake, 'Review', null,
      missingRequired.map(r => ({ error: 'MISSING_REQUIRED_FIELD', field: r.target_table + '.' + r.target_field, question: r.question_id })));
    store.insert('Intake', reviewRecord);
    return { status: 'Review', intake_id: intake.intake_id,
      error: 'MISSING_REQUIRED_FIELDS', missing: missingRequired.map(r => r.target_table + '.' + r.target_field) };
  }

  // Create Customer
  const customer = buildCustomer(mappedFields, intake.intake_id);
  store.insert('Customers', customer);

  // Create Job
  const job = buildJob(mappedFields, customer.id, intake.intake_id);
  job.job_id = generateJobId(store);
  store.insert('Jobs', job);

  // Create Intake record
  const intakeRecord = buildIntakeRecord(intake, 'Processed', job.id, null);
  store.insert('Intake', intakeRecord);

  return {
    status: 'Processed',
    intake_id: intake.intake_id,
    job_id: job.id,
    job_id_human: job.job_id,
    customer_id: customer.id,
    message: 'Sold intake processed successfully'
  };
}

/* --- Booking intake --- */
function processBookingIntake(options, input) {
  const { store, sha256 } = options;
  guard(options);
  const intake = validateIntake(input);

  // Check for existing intake (idempotency)
  const existing = store.get('Intake', intake.intake_id);
  if (existing) {
    const newHash = intakeHash(intake);
    if (existing.payload_hash === newHash && existing.processing_status === 'Processed') {
      return { status: 'Processed', duplicate: true, intake_id: intake.intake_id,
        job_id: existing.job_id, message: 'Already processed — idempotent replay' };
    }
    if (existing.payload_hash === newHash && existing.processing_status === 'Review') {
      return { status: 'Review', duplicate: true, intake_id: intake.intake_id,
        message: 'Previously flagged for review — unchanged' };
    }
    const reviewRecord = clone(existing);
    reviewRecord.processing_status = 'Review';
    reviewRecord.validation_errors = JSON.stringify([{
      error: 'CONFLICTING_INTAKE', detail: 'Same intake_id with different payload'
    }]);
    store.update('Intake', intake.intake_id, reviewRecord);
    return { status: 'Review', intake_id: intake.intake_id,
      error: 'CONFLICTING_INTAKE', message: 'Same intake_id, different payload. Needs review.' };
  }

  // Apply mappings
  const rules = store.list('MappingRules');
  const { fields: mappedFields, missingRequired, errors } = applyMappings(intake.raw_payload, rules, intake.form_id);

  // Resolve matching Job
  const job = resolveBookingJob(store, mappedFields);
  if (!job) {
    const reviewRecord = buildIntakeRecord(intake, 'Review', null,
      [{ error: 'NO_MATCHING_JOB', detail: 'Could not resolve a unique matching job for this booking' }]);
    store.insert('Intake', reviewRecord);
    return { status: 'Review', intake_id: intake.intake_id,
      error: 'NO_MATCHING_JOB', message: 'No unique job matched. Needs review.' };
  }

  // Update Job with booking data
  const jobUpdate = {};
  const jobFields = mappedFields.Jobs || {};
  if (jobFields.next_action_at) jobUpdate.next_action_at = jobFields.next_action_at;
  if (jobFields.display_name && jobFields.display_name !== 'S05 synthetic job') {
    jobUpdate.display_name = jobFields.display_name;
  }
  jobUpdate.booking_submission_id = intake.intake_id;
  jobUpdate.sold_booking_match_status = 'Match';
  jobUpdate.workflow_stage = 'BookingInProgress';
  jobUpdate.updated_at = new Date().toISOString();
  jobUpdate.updated_by = 'S05-intake';
  jobUpdate.version = (job.version || 0) + 1;
  store.update('Jobs', job.id, jobUpdate);

  // Update customer if booking provides new data
  const custFields = mappedFields.Customers || {};
  if (custFields.email || custFields.phone) {
    const custUpdate = { updated_at: new Date().toISOString(), updated_by: 'S05-intake' };
    if (custFields.email) custUpdate.email = custFields.email;
    if (custFields.phone) custUpdate.phone = custFields.phone;
    custUpdate.version = (store.get('Customers', job.customer_id)?.version || 0) + 1;
    store.update('Customers', job.customer_id, custUpdate);
  }

  // Create Intake record
  const intakeRecord = buildIntakeRecord(intake, 'Processed', job.id, null);
  store.insert('Intake', intakeRecord);

  return {
    status: 'Processed',
    intake_id: intake.intake_id,
    job_id: job.id,
    job_id_human: job.job_id,
    message: 'Booking intake processed successfully'
  };
}

/* Create an intake processor */
function createIntakeProcessor(options) {
  return {
    processSold: input => processSoldIntake(options, input),
    processBooking: input => processBookingIntake(options, input)
  };
}

module.exports = {
  createIntakeProcessor, processSoldIntake, processBookingIntake,
  validateIntake, intakeHash, buildIntakeRecord,
  buildCustomer, buildJob, generateJobId, generateInternalJobId,
  guard, DEV_SHEET_ID
};
