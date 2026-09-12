/* S05 intake processor — Sold and Booking intake handling.
 * Reuses canonical hash comparison for idempotency via Intake table.
 * No Jotform webhook, no outbound calls, no PROD. */

const { applyMappings, buildSyntheticMapping, resolveBookingJob,
  generateJobId, generateInternalJobId, generateCustomerId } = require('./mapping.js');
const { applyBookingStructured } = require('./booking-apply.js');

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
function buildJob(mappedFields, customerId, soldIntakeId, extra) {
  const f = mappedFields.Jobs || {};
  const flags = extra || {};
  const actor = flags.actor || 'S05-intake';
  const now = new Date().toISOString();
  return {
    id: generateInternalJobId(),
    job_id: 'PENDING', // Will be set after generation
    customer_id: customerId,
    display_name: 'S05 synthetic job',
    sold_submission_id: soldIntakeId,
    booking_submission_id: null,
    sold_at: now,
    salesperson_id: f.salesperson_id || null,
    lead_source: f.lead_source || null,
    quote_reference: f.quote_reference || null,
    presale_file_id: f.presale_file_id || null,
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
    pilot_job: flags.pilot_job === true, release_scope: 'R1',
    created_at: now, created_by: actor,
    updated_at: now, updated_by: actor,
    version: 1, source_system: flags.pilot_job === true ? 'R1-AppSheet' : 'S05-intake',
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

  // Create Job — random human reference generated ONCE here
  const job = buildJob(mappedFields, customer.id, intake.intake_id, {
    pilot_job: options.pilotJob === true,
    actor: options.actor || 'S05-intake'
  });
  job.job_id = generateJobId(store);
  if (customer.last_name && customer.postcode) {
    job.display_name = customer.last_name + ' – ' + customer.postcode;
  }
  store.insert('Jobs', job);

  const tech = mappedFields.TechnicalDetails || {};
  if ((tech.roof_notes && String(tech.roof_notes).trim()) || (tech.electrical_notes && String(tech.electrical_notes).trim())) {
    const now = new Date().toISOString();
    store.insert('TechnicalDetails', {
      id: 'TD-' + job.id,
      job_id: job.id,
      roof_notes: tech.roof_notes || null,
      electrical_notes: tech.electrical_notes || null,
      created_at: now, created_by: options.actor || 'S05-intake',
      updated_at: now, updated_by: options.actor || 'S05-intake',
      version: 1, commit_id: intake.intake_id
    });
  }

  // Create Intake record
  const intakeRecord = buildIntakeRecord(intake, 'Processed', job.id, null);
  store.insert('Intake', intakeRecord);

  // Prebooking tasks (idempotent) when S06 helpers are available
  let prebooking_tasks = null;
  if (typeof options.createPrebookingTasks === 'function') {
    prebooking_tasks = options.createPrebookingTasks(job, store);
  } else {
    try {
      const gates = require('../s06/gates.js');
      if (typeof gates.createPrebookingTasksForSold === 'function') {
        prebooking_tasks = gates.createPrebookingTasksForSold(job, store);
      }
    } catch (_) { /* optional in isolated mapping unit tests */ }
  }

  return {
    status: 'Processed',
    intake_id: intake.intake_id,
    job_id: job.id,
    job_id_human: job.job_id,
    customer_id: customer.id,
    prebooking_tasks,
    message: 'Sold intake processed successfully — copy Job ID into Job Booking'
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

  // Missing/blank Job ID → Intake Review (never surname/address guess)
  const ref = (mappedFields.Jobs || {}).job_id;
  if (!ref || !String(ref).trim()) {
    const reviewRecord = buildIntakeRecord(intake, 'Review', null,
      [{ error: 'BLANK_JOB_REFERENCE', detail: 'Booking Job ID is blank — Intake Review only' }]);
    store.insert('Intake', reviewRecord);
    return { status: 'Review', intake_id: intake.intake_id,
      error: 'BLANK_JOB_REFERENCE', message: 'Blank Job ID. Needs review — no surname/address matching.' };
  }

  // Resolve matching Job by exact human job_id only
  const job = resolveBookingJob(store, mappedFields);
  if (!job) {
    const reviewRecord = buildIntakeRecord(intake, 'Review', null,
      [{ error: 'NO_MATCHING_JOB', detail: 'Unknown Job ID "' + String(ref).trim() + '" — never match by surname/address' }]);
    store.insert('Intake', reviewRecord);
    return { status: 'Review', intake_id: intake.intake_id,
      error: 'NO_MATCHING_JOB', message: 'Unknown Job ID. Needs review — no surname/address matching.' };
  }

  // Apply structured booking → CustomerChanges / WorkPackages / Materials / Equipment / Scaffold
  const applied = applyBookingStructured(store, job, mappedFields, intake, options);

  const jobUpdate = Object.assign({}, applied.job_patch || {});
  jobUpdate.booking_submission_id = intake.intake_id;
  jobUpdate.sold_booking_match_status = applied.match_status; // Match or Review
  // An early Booking intake may be linked, but it cannot skip the explicit ReadyToBook gate.
  jobUpdate.workflow_stage = job.workflow_stage === 'ReadyToBook' ? 'BookingInProgress' : job.workflow_stage;
  jobUpdate.updated_at = new Date().toISOString();
  jobUpdate.updated_by = 'S05-intake';
  jobUpdate.version = (job.version || 0) + 1;
  store.update('Jobs', job.id, jobUpdate);

  // Do NOT silently overwrite customer identity fields. Proposals live in CustomerChanges.
  // Optional non-identity contact proposals still require Accept in Intake Review when mismatched.

  const intakeStatus = applied.needs_review ? 'Review' : 'Processed';
  const intakeErrors = applied.needs_review
    ? applied.review_reasons.map(r => ({ error: r, detail: 'Booking structured apply flagged for Intake Review' }))
      .concat(applied.amount_mismatch ? [{ error: 'AMOUNT_MISMATCH', detail: JSON.stringify(applied.amount_mismatch) }] : [])
      .concat(applied.customer_changes.map(c => ({ error: 'CUSTOMER_MISMATCH', field: c.field_name })))
    : null;
  const intakeRecord = buildIntakeRecord(intake, intakeStatus, job.id, intakeErrors);
  store.insert('Intake', intakeRecord);

  return {
    status: intakeStatus,
    intake_id: intake.intake_id,
    job_id: job.id,
    job_id_human: job.job_id,
    match_status: applied.match_status,
    applied,
    message: intakeStatus === 'Processed'
      ? 'Booking intake processed successfully'
      : 'Booking linked but Intake Review required (mismatch/unresolved installer/amount)'
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
