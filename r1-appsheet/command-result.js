/* R1 command result feedback (DEV only).
 *
 * Apps Script "Success" only means the bot function returned. Business success is the parsed command response:
 *   {ok:true,result:{status:...}}  or  {ok:false,error:'R1A_…'}.
 * This module turns that response into a staff-facing outcome and writes it back onto the originating AppSheet
 * request row. It is shared by appSheetR1CommandFromRequestRow (request-row.js), appSheetR1Command (JSON path)
 * and the upload retry (upload-retry.js), so every path uses one vocabulary:
 *   Succeeded | FollowUpRequired | ActionRequired | Failed | UploadPending
 * Internal codes stay in result_code / result for diagnostics and are never the primary message.
 * Writes only result_* columns (never inputs or `status`), only on rows owned by the acting user, and never
 * replaces a final Succeeded / FollowUpRequired outcome. */
'use strict';
var R1R_DEV_SHEET_ID = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
var R1R_STATUSES = ['Succeeded', 'FollowUpRequired', 'ActionRequired', 'Failed', 'UploadPending'];
var R1R_FINAL_STATUSES = ['Succeeded', 'FollowUpRequired'];
var R1R_HEADINGS = { Succeeded: 'SUCCESS', FollowUpRequired: 'SAVED – FOLLOW-UP NEEDED', ActionRequired: 'ACTION REQUIRED', Failed: 'COULD NOT COMPLETE', UploadPending: 'UPLOAD PROCESSING' };
var R1R_RESULT_COLUMNS = ['result_status', 'result_message', 'result_code', 'result', 'result_at'];
var R1R_EXTRA_COLUMNS = ['result_job_id', 'result_job_id_human', 'result_version', 'result_workflow_stage', 'result_issue_id', 'result_stage_id'];

var R1R_MSG = {
  STALE: 'This record changed after you opened the form. Go back, refresh, and try again.',
  PERMISSION: "You don't have permission to do this. Ask the task owner or an administrator.",
  TASK_PERMISSION: 'Only the task owner, their backup, or an administrator can do this.',
  IDENTITY: "This request was submitted by a different user, so it wasn't processed.",
  SIGN_IN: "Your sign-in isn't set up for this app. Ask an administrator to check your staff record.",
  MODE: 'This action is switched off at the moment. Ask an administrator.',
  PILOT: "This job isn't part of the R1 pilot, so this action isn't available.",
  CONFIG: 'The app setup needs attention before this can run. Tell an administrator.',
  RECOVERY: "An earlier change to this record didn't finish. An administrator needs to check it before you try again.",
  CONFLICT: 'This request clashes with an earlier request that used the same ID. Start a new request from the task or job.',
  NOT_FOUND: "The record couldn't be found. Go back, refresh, and try again.",
  NOT_READY: "This request wasn't marked as ready, so it wasn't processed.",
  INVALID: "Some of the information entered isn't valid. Check the form and try again.",
  DATE: "A date entered isn't valid. Check the dates and try again.",
  NOT_ACTIONABLE: 'This job is cancelled or archived, so no changes can be made.',
  UPLOAD_PENDING: "Your file is still uploading. The system will retry automatically, so you don't need to resubmit.",
  UNKNOWN: "The request couldn't be completed. Tell an administrator."
};

function _r1rA(message) { return ['ActionRequired', message]; }
function _r1rF(message) { return ['Failed', message]; }
var R1R_ERRORS = {
  /* Task completion inputs */
  R1A_REQUIRED_COMPLETION_NOTE: _r1rA('A completion note is required. Add a note and try again.'),
  R1A_REQUIRED_EVIDENCE_ID: _r1rA('Signed contract evidence is required. Add the signed contract evidence and try again.'),
  R1A_REQUIRED_EVIDENCE_PATH: _r1rA('Upload the signed contract file and try again.'),
  R1A_REQUIRED_CONTRACT_EVIDENCE: _r1rA("The contract evidence doesn't match a file saved for this job. Upload the signed contract file and try again."),
  R1A_CROSS_JOB_EVIDENCE: _r1rA('That evidence belongs to a different job. Add the evidence for this job and try again.'),
  R1C_CROSS_JOB_EVIDENCE: _r1rA('That evidence belongs to a different job. Add the evidence for this job and try again.'),
  R1A_EVIDENCE_AMBIGUOUS: _r1rA('More than one saved file matches that evidence. Upload the signed contract file directly and try again.'),
  R1A_EVIDENCE_CONFLICT: _r1rA("The uploaded file and the evidence reference don't match. Use one of them and try again."),
  R1A_EVIDENCE_ALREADY_ATTACHED: _r1rF('Contract evidence is already attached to this task, so nothing was changed.'),
  R1A_REQUIRED_CONTRACT_ID: _r1rA('The contract reference is required. Enter the Signable or contract reference and try again.'),
  R1A_REQUIRED_CONTRACT_SIGNED: _r1rA('Say whether the contract is signed. Choose Yes or No and try again.'),
  R1A_CONTRACT_ALREADY_SIGNED: _r1rF('This contract is already recorded as signed, so it was not changed to sent.'),
  R1A_REQUIRED_INVOICE_NUMBER: _r1rA('The deposit invoice number is required. Enter the invoice number and try again.'),
  R1A_REQUIRED_INVOICE_SENT: _r1rA('Confirm the deposit invoice was sent by choosing Yes, or set the outcome to Failed if it could not be sent.'),
  R1A_REQUIRED_DEPOSIT_BANK_CONFIRMED: _r1rA('Say whether the deposit has been seen in the bank. Choose Yes or No and try again.'),
  R1A_REQUIRED_DEPOSIT_AMOUNT: _r1rA('Enter the deposit amount shown in the bank and try again.'),
  R1A_INVALID_DEPOSIT_AMOUNT: _r1rA("The deposit amount isn't valid. Enter pounds and pence, for example 2612.95."),
  R1A_REQUIRED_DEPOSIT_RECEIVED_DATE: _r1rA('Enter the date the deposit was received and try again.'),
  R1A_INVALID_DEPOSIT_RECEIVED_DATE: _r1rA("The deposit received date isn't valid. Enter a real date that isn't in the future."),
  R1A_REQUIRED_DEPOSIT_BANK_REFERENCE: _r1rA('Enter the bank payment reference and try again.'),
  R1A_DEPOSIT_NOT_CONFIRMED: _r1rA('The deposit can only be confirmed once it has been seen in the bank. Choose Yes when it has arrived.'),
  R1A_DEPOSIT_AMOUNT_MISMATCH: _r1rA("The amount entered doesn't match the expected deposit for this job. Check the bank amount and try again."),
  R1A_DEPOSIT_STAGE_MISSING: _r1rF("This job doesn't have a deposit invoice set up yet. Ask an administrator to check the job's invoices."),
  R1A_DEPOSIT_AMOUNT_REQUIRED: _r1rF("This job doesn't have a deposit amount set up yet. Ask an administrator to check the job's invoices."),
  R1A_REQUIRED_CUSTOMER_DETAILS_VERIFIED: _r1rA('Say whether the customer details are correct. Choose Yes or No and try again.'),
  R1A_REQUIRED_SOLD_VALUE_VERIFIED: _r1rA('Say whether the sold value is correct. Choose Yes or No and try again.'),
  R1A_REQUIRED_VERIFIED_GROSS_AMOUNT: _r1rA('Enter the verified contract value in pounds and try again.'),
  R1A_VERIFIED_AMOUNT_MISMATCH: _r1rA("The verified value doesn't match the job's contract value. Check the amount and try again."),
  R1A_SOLD_VALUE_REQUIRED: _r1rF("This job doesn't have a sold value recorded. Ask an administrator to check the job."),
  R1A_REQUIRED_REOPEN_REASON: _r1rA('A reason is required to reopen a task. Add the reason and try again.'),
  R1A_TASK_NOT_COMPLETABLE: _r1rA("This task can't be completed in its current state. It may already be complete. Go back and check the task."),
  R1A_TASK_NOT_REOPENABLE: _r1rA('Only completed or not-required tasks can be reopened. Go back and check the task.'),
  R1A_TASK_NOT_ATTACHABLE: _r1rA('Contract evidence can only be added to an open contract task, or to a completed one that has no evidence yet.'),
  /* Other office commands */
  R1A_REQUIRED_OWNER_ID: _r1rA('Choose the new owner and try again.'),
  R1A_REQUIRED_OLD_ALLOCATION_ID: _r1rA('Choose the allocation to change and try again.'),
  R1A_REQUIRED_ACTIVITIES: _r1rA('Choose at least one activity to move and try again.'),
  R1A_INVALID_DATE: _r1rA("A date entered isn't valid. Check the dates and try again."),
  R1A_INVALID_INTEGER: _r1rA('A number entered must be a whole number. Check the form and try again.'),
  R1A_INVALID_BOOLEAN: _r1rA('A Yes/No answer is missing or not valid. Check the form and try again.'),
  R1A_INVALID_GROSS_AMOUNT: _r1rA("The amount isn't valid. Enter pounds and pence, for example 10451.78."),
  R1A_INVALID_FINANCE_ROUTE: _r1rA('Choose a finance route: Standard, Phoenix or OtherReview.'),
  R1A_INVALID_ISSUE_TYPE: _r1rA('Choose an issue type: Variation, Remedial or Complaint.'),
  R1A_INVALID_SEVERITY: _r1rA('Choose a severity: Normal or Medium.'),
  R1A_INVALID_CUSTOMER_IMPACT: _r1rA('Say whether the customer is affected. Choose Yes or No.'),
  R1A_INVALID_FIELDS: _r1rF('The form sent information this action does not accept. Ask an administrator to check the form setup.'),
  R1A_SALESPERSON_NOT_FOUND: _r1rA("The salesperson couldn't be found. Choose an active salesperson and try again."),
  R1A_CUSTOMER_OVERWRITE: _r1rA("The customer details don't match the existing job. Check them in Intake Review."),
  R1A_JOB_LINK_MISMATCH: _r1rA("This request doesn't match the selected job. Start again from the job."),
  R1A_JOB_ID_INVALID: _r1rA("The job reference isn't valid. Start again from the job."),
  R1A_TASK_JOB_MISMATCH: _r1rA("That task doesn't belong to this job. Start again from the job."),
  R1A_ISSUE_JOB_MISMATCH: _r1rA("That issue doesn't belong to this job. Start again from the job."),
  R1A_WORK_PACKAGE_JOB_MISMATCH: _r1rA("That work package doesn't belong to this job. Start again from the job."),
  R1A_STAGE_NOT_ELIGIBLE: _r1rA("This job isn't at a stage where this action is allowed."),
  R1A_JOB_NOT_ACTIONABLE: _r1rF(R1R_MSG.NOT_ACTIONABLE),
  R1C_JOB_NOT_ACTIONABLE: _r1rF(R1R_MSG.NOT_ACTIONABLE),
  /* Identity, permission, scope */
  R1A_ACTOR_MISMATCH: _r1rF(R1R_MSG.IDENTITY), R1C_ACTOR_MISMATCH: _r1rF(R1R_MSG.IDENTITY), R1U_ACTOR_MISMATCH: _r1rF(R1R_MSG.IDENTITY),
  R1A_AUTHENTICATED_EMAIL_REQUIRED: _r1rF(R1R_MSG.SIGN_IN), R1C_AUTHENTICATED_EMAIL_REQUIRED: _r1rF(R1R_MSG.SIGN_IN), R1U_AUTHENTICATED_EMAIL_REQUIRED: _r1rF(R1R_MSG.SIGN_IN),
  R1A_UNKNOWN_OR_DUPLICATE_ACTOR: _r1rF(R1R_MSG.SIGN_IN), R1A_INACTIVE_ACTOR: _r1rF(R1R_MSG.SIGN_IN), R1A_NO_ACTIVE_ROLE: _r1rF(R1R_MSG.SIGN_IN),
  R1A_TASK_ACCESS_DENIED: _r1rF(R1R_MSG.TASK_PERMISSION),
  R1A_OUTSIDE_PILOT: _r1rF(R1R_MSG.PILOT), R1C_PILOT_REQUIRED: _r1rF(R1R_MSG.PILOT),
  R1A_MODE_MISSING: _r1rF(R1R_MSG.MODE),
  /* Request row / idempotency / recovery */
  R1A_STALE_VERSION: _r1rA(R1R_MSG.STALE), R1C_STALE_VERSION: _r1rA(R1R_MSG.STALE),
  R1C_STALE_SUBMISSION: _r1rA('The commissioning form changed after you opened it. Go back, refresh, and try again.'),
  R1A_COMMAND_CONFLICT: _r1rF(R1R_MSG.CONFLICT), R1C_COMMAND_CONFLICT: _r1rF(R1R_MSG.CONFLICT),
  R1A_REQUEST_NOT_READY: _r1rF(R1R_MSG.NOT_READY), R1C_REQUEST_NOT_READY: _r1rF(R1R_MSG.NOT_READY), R1U_REQUEST_NOT_READY: _r1rF(R1R_MSG.NOT_READY),
  R1A_TASK_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND), R1A_JOB_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND), R1A_REQUEST_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND), R1C_REQUEST_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND),
  R1C_REQUEST_NOT_FOUND_OR_AMBIGUOUS: _r1rF(R1R_MSG.NOT_FOUND), R1U_REQUEST_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND), R1C_WORK_PACKAGE_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND),
  R1C_DELIVERY_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND), R1C_ORDER_NOT_FOUND: _r1rF(R1R_MSG.NOT_FOUND), R1C_ROW_MISSING: _r1rF(R1R_MSG.NOT_FOUND),
  R1U_REQUEST_CHANGED: _r1rF('This request was edited after it was submitted, so the automatic retry stopped. Start a new request.'),
  /* Uploads */
  R1C_UPLOAD_PENDING: ['UploadPending', R1R_MSG.UPLOAD_PENDING],
  R1C_UPLOAD_MISSING: _r1rA('Your uploaded file never arrived. Start a new request and upload the file again.'),
  R1C_UPLOAD_PATH_INVALID: _r1rA("The uploaded file couldn't be read. Upload the file again from the form."),
  R1A_UPLOAD_INVALID: _r1rA("The uploaded file couldn't be read. Upload the file again from the form."),
  R1C_UPLOAD_AMBIGUOUS: _r1rA('More than one file has that name. Rename the file and upload it again.'),
  R1C_EVIDENCE_FILE_REQUIRED: _r1rA('A photo or file is required. Add it and try again.'),
  R1C_INVALID_EVIDENCE: _r1rA("The attached file isn't valid. Upload it again."),
  R1U_NO_UPLOAD: _r1rA('This request has no uploaded file. Add the file and try again.'),
  /* Installer / goods-in / stock */
  R1C_OFFICE_REASON_REQUIRED: _r1rA('Office staff must give a reason when acting for an installer. Add the reason and try again.'),
  R1C_INVALID_QUANTITY: _r1rA("A quantity isn't valid. Check the quantities and try again."),
  R1C_INVALID_NUMBER: _r1rA("A number entered isn't valid. Check the form and try again."),
  R1C_INVALID_BOOLEAN: _r1rA('A Yes/No answer is missing or not valid. Check the form and try again.'),
  R1C_INVALID_ANSWER: _r1rA("A commissioning answer isn't valid. Check the answers and try again."),
  R1C_INVALID_ANSWERS: _r1rA("A commissioning answer isn't valid. Check the answers and try again."),
  R1C_RECEIPT_LINES_NOT_SYNCED: _r1rA("Not all delivery lines were saved yet. Wait a moment, sync, and submit again."),
  R1C_RECEIPT_LINES_REQUIRED: _r1rA('Add at least one delivery line and try again.'),
  R1C_DUPLICATE_RECEIPT_LINE: _r1rA('The same delivery line was entered twice. Remove the duplicate and try again.'),
  R1C_RECEIPT_PARENT_MISMATCH: _r1rA("A delivery line doesn't belong to this delivery. Check the lines and try again."),
  R1C_STOCK_PRODUCT_REQUIRED: _r1rA('Choose the product and try again.'),
  R1C_APPROVED_TEMPLATE_REQUIRED: _r1rF("There's no approved commissioning template for this work yet. Ask an administrator."),
  R1C_APPROVED_QUESTION_REQUIRED: _r1rA("That commissioning question isn't on the approved template. Check the answers and try again."),
  R1C_REVIEW_STATE_OR_NOTES: _r1rA('Choose a review outcome and add review notes, then try again.'),
  R1C_REVIEW_REFUSED: _r1rA("This commissioning submission can't be reviewed in its current state."),
  R1C_SUBMISSION_MISMATCH: _r1rA("That commissioning submission doesn't belong to this work. Start again from the work package."),
  R1C_AMBIGUOUS_SUBMISSION: _r1rF('More than one commissioning draft matches. Ask an administrator.'),
  R1C_TEMPLATE_AMBIGUOUS: _r1rF('More than one commissioning template matches. Ask an administrator.'),
  R1C_JOB_MISMATCH: _r1rA("This request doesn't match the selected job. Start again from the job."),
  R1C_COMMAND_TYPE_MISMATCH: _r1rF('The form sent a different action than the one being run. Ask an administrator to check the form setup.'),
  R1U_COMMAND_TYPE_MISMATCH: _r1rF('The form sent a different action than the one being run. Ask an administrator to check the form setup.'),
  R1C_EXPECTED_VERSION_REQUIRED: _r1rF(R1R_MSG.CONFIG),
  R1A_REQUEST_TIMESTAMP_REQUIRED: _r1rF(R1R_MSG.CONFIG),
  /* PRE03 owner repair (Admin/Manager DEV tool) */
  R1A_JOB_AMBIGUOUS: _r1rF('More than one job matches that reference. Use the internal job ID instead.'),
  R1A_JOB_REF_REQUIRED: _r1rA('A job reference is required. Enter the public job ID and try again.'),
  R1A_PRE03_NOT_APPLICABLE: _r1rF("This job isn't on the Standard finance route, so it has no bank deposit task."),
  R1A_PRE03_MISSING: _r1rF("This job has no bank deposit task to repair."),
  R1A_PRE03_AMBIGUOUS: _r1rF('This job has more than one bank deposit task. Ask an administrator to check it.'),
  R1A_PRE03_NOT_OPEN: _r1rF("The bank deposit task is already finished, so its owner can't be changed.")
};

var R1R_FIELD_LABELS = {
  completion_note: 'A completion note', reopen_reason: 'A reason for reopening', reference: 'The bank reference', type: 'The call type', outcome: 'The outcome',
  action: 'The issue action', reason: 'A reason', planned_start: 'The planned start date', planned_end: 'The planned end date', effective_date: 'The effective date',
  work_performed: 'The work performed', material_state: 'The material state', scaffold_state: 'The scaffold state', finance_review: 'The finance review',
  legacy_state: 'The legacy system state', new_date: 'The new date', commitment_review: 'The commitment review', evidence_reference: 'The evidence reference',
  customer_first_name: "The customer's first name", customer_last_name: "The customer's last name", street_address: 'The street address', city: 'The town or city',
  postcode: 'The postcode', finance_route: 'The finance route', mode: 'The change type', person_id: 'The installer'
};

var R1R_BLOCKING_MESSAGES = {
  PRE01_INVOICE_SEND_FAILED: 'Saved. The deposit invoice was not sent, so this task is waiting for follow-up.',
  PRE02_AWAITING_SIGNATURE: 'Saved. The contract is recorded as sent and awaiting signature, so this task is waiting for follow-up.',
  PRE03_DEPOSIT_NOT_RECEIVED: "Saved. The deposit hasn't arrived in the bank yet, so this task is waiting for follow-up.",
  PRE03_DEPOSIT_AMOUNT_MISMATCH: "Saved. The bank amount doesn't match the expected deposit, so this task is waiting for follow-up. Check the amount with the customer.",
  PRE04_VALUE_MISMATCH: "Saved. The verified value doesn't match the contract value, so this task is waiting for review.",
  PRE04_CUSTOMER_DETAILS_MISMATCH: 'Saved. The customer details need correcting, so this task is waiting for review.',
  PRE04_SOLD_VALUE_MISMATCH: 'Saved. The sold value needs checking, so this task is waiting for review.'
};

function _r1rText(v) { return typeof v === 'string' && v.trim().length > 0; }
function _r1rEmail(v) { if (typeof v !== 'string') return ''; var s = v.trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : ''; }
function _r1rHas(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
function _r1rDateLabel(v) {
  try {
    if (v === null || v === undefined || v === '') return '';
    var d = Object.prototype.toString.call(v) === '[object Date]' ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) + 'T12:00:00Z' : String(v));
    if (isNaN(d.getTime())) return '';
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(d, 'Europe/London', 'd MMM yyyy');
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      var parts = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d).forEach(function (x) { parts[x.type] = x.value; });
      return Number(parts.day) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(parts.month) - 1] + ' ' + parts.year;
    }
    return d.toISOString().slice(0, 10);
  } catch (e) { return ''; }
}
function _r1rHumanize(v) { return String(v || '').replace(/^(?:R1[ACU]|S\d+)_/, '').replace(/_/g, ' ').toLowerCase().trim(); }

/* 'R1A_FOO' | 'S15_REVIEW: stale job revision' | plain text → {code, detail}. */
function _r1rParseError(error) {
  var text = String(error === undefined || error === null ? '' : error).trim();
  var m = /^([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])(?::\s*([\s\S]*))?$/.exec(text);
  return m ? { code: m[1], detail: m[2] ? m[2].trim() : '' } : { code: 'UNCLASSIFIED', detail: text };
}

function _r1rErrorFeedback(commandType, error) {
  var parsed = _r1rParseError(error), code = parsed.code, detail = parsed.detail, hit = R1R_ERRORS[code];
  var out = function (status, message) { return { status: status, message: message, code: code, detail: detail }; };
  if (hit) return out(hit[0], hit[1]);
  if (/^R1[ACU]_REQUIRED_[A-Z0-9_]+$/.test(code)) {
    var key = code.replace(/^R1[ACU]_REQUIRED_/, '').toLowerCase();
    return out('ActionRequired', (R1R_FIELD_LABELS[key] || ('The ' + key.replace(/_/g, ' '))) + ' is required. Add it and try again.');
  }
  if (/STALE/.test(code) || (/^S\d+_REVIEW$/.test(code) && /stale/i.test(detail))) return out('ActionRequired', R1R_MSG.STALE);
  if (/RECOVERY_REQUIRED$/.test(code)) return out('Failed', R1R_MSG.RECOVERY);
  if (/_MODE_DENIED|_MODE_MISSING/.test(code)) return out('Failed', R1R_MSG.MODE);
  if (/_DENIED/.test(code)) return out('Failed', R1R_MSG.PERMISSION);
  if (/_DEV_ONLY$|_SCHEMA$|_TABLE_MISSING$|_UNSUPPORTED$|_NOT_CONFIGURED$|_RESOLVER_MISSING$|_COMMAND_ID_REQUIRED$|_BACKEND_MISSING|^S\d+_CONFIG$/.test(code)) return out('Failed', R1R_MSG.CONFIG);
  if (/_CONFLICT$|^S\d+_REVIEW$/.test(code) && /conflict/i.test(code + ' ' + detail)) return out('Failed', R1R_MSG.CONFLICT);
  if (/_DATE_INVALID$/.test(code)) return out('ActionRequired', R1R_MSG.DATE);
  if (/^R1[ACU]_INVALID_/.test(code)) return out('ActionRequired', R1R_MSG.INVALID);
  if (/^S\d+_REVIEW$/.test(code)) {
    var plain = _r1rText(detail) && !/[A-Z0-9]+_[A-Z0-9_]{2,}/.test(detail) ? ': ' + detail.replace(/[.\s]+$/, '') : '';
    return out('ActionRequired', 'This needs checking before it can go ahead' + plain + '.');
  }
  if (/^S\d+_REFUSED$/.test(code)) return out('Failed', "This action isn't allowed for this job at the moment.");
  if (/_NOT_FOUND$/.test(code)) return out('Failed', R1R_MSG.NOT_FOUND);
  return out('Failed', R1R_MSG.UNKNOWN);
}

function _r1rReadinessSuffix(inner) {
  var rd = inner && inner.readiness || {}, job = inner && inner.job || {};
  if (rd.stage_advanced && (job.workflow_stage === 'ReadyToBook' || rd.workflow_stage === 'ReadyToBook')) return ' The job is now Ready to Book.';
  if (rd.stage_demoted) return ' The job has moved back to Prebooking until this task is done again.';
  return '';
}
function _r1rJobRef(inner) { return inner && _r1rText(inner.job_id_human) ? ' ' + inner.job_id_human.trim() : ''; }

function _r1rSuccessFeedback(commandType, inner) {
  inner = inner && typeof inner === 'object' ? inner : {};
  var s = inner.status, replay = inner.replay === true || s === 'Replayed', task = inner.task || null;
  function ok(m) { return { status: 'Succeeded', message: m }; }
  function follow(m) { return { status: 'FollowUpRequired', message: m }; }
  function action(m) { return { status: 'ActionRequired', message: m }; }
  function followUpDate(t) { var d = t && _r1rDateLabel(t.next_followup_at); return d ? ' Next follow-up: ' + d + '.' : ''; }
  switch (commandType) {
    case 'TASK_COMPLETE':
      if (s === 'FollowUpRequired' || (replay && task && task.status !== 'Complete' && _r1rText(task.blocking_reason))) {
        var reason = task && task.blocking_reason;
        return follow((R1R_BLOCKING_MESSAGES[reason] || 'Saved. This task is waiting for follow-up.') + followUpDate(task));
      }
      if (s === 'Completed' || (replay && task && task.status === 'Complete')) return ok('Task completed successfully.' + (replay ? '' : _r1rReadinessSuffix(inner)));
      if (replay) return ok('This request was already processed.');
      break;
    case 'TASK_REOPEN':
      if (s === 'Reopened' || replay) return ok('Task reopened. It is back in the task list.' + (replay ? '' : _r1rReadinessSuffix(inner)));
      break;
    case 'TASK_EVIDENCE_ATTACH':
      /* An upload to an open PRE02 is not the signed-contract transition: staff still have to complete the task. */
      if (inner.completion_required === true || s === 'EvidenceUploaded') return follow('Signed contract evidence uploaded. Complete the contract task to confirm it is signed.');
      if (s === 'Attached' || replay) return ok('Contract evidence added.' + (replay ? '' : _r1rReadinessSuffix(inner)));
      break;
    case 'DEPOSIT_CONFIRM':
      if (s === 'Confirmed' || replay) return ok('Deposit confirmed.' + (replay ? '' : _r1rReadinessSuffix(inner)));
      if (s === 'AlreadyConfirmed') return ok('The deposit was already confirmed. Nothing else is needed.');
      break;
    case 'SOLD_INTAKE':
      if (s === 'Review') return follow('The sale was saved but needs checking in Intake Review before a job is created.');
      if (inner.duplicate) return ok('This sale was already recorded' + (_r1rJobRef(inner) ? ' as job' + _r1rJobRef(inner) : '') + '. No new job was created.');
      if (s === 'Processed' || replay) return ok(_r1rJobRef(inner) ? 'New job created:' + _r1rJobRef(inner) + '.' : 'New job created.');
      break;
    case 'BOOKING_INTAKE':
      if (s === 'Review') return follow('The booking was saved but needs checking in Intake Review.');
      if (inner.duplicate) return ok('This booking was already recorded' + (_r1rJobRef(inner) ? ' for job' + _r1rJobRef(inner) : '') + '.');
      if (s === 'Processed' || replay) {
        var stage = inner.workflow_stage === 'BookingInProgress' ? ' The job is now Booking In Progress.' : (inner.workflow_stage === 'Booked' ? ' The job is now Booked.' : '');
        return ok('Booking saved' + (_r1rJobRef(inner) ? ' for job' + _r1rJobRef(inner) : '') + '.' + stage);
      }
      break;
    case 'ISSUE_CREATE': if (s === 'Created' || replay) return ok('Issue raised.'); break;
    case 'ISSUE_UPDATE': if (s === 'Updated' || replay) return ok('Issue updated.'); break;
    case 'CALL_RECORD': if (s === 'Recorded' || replay) return ok('Call recorded.'); break;
    case 'PLANNER_UPDATE': if (s === 'Updated' || replay) return ok('Planned dates updated.'); break;
    case 'MOVE_JOB':
      if (s === 'Moved' || replay) return ok('Job moved.');
      if (s === 'NeedsReview') return action('The move needs checking before it can go ahead' + (_r1rText(inner.reason) ? ': ' + _r1rHumanize(inner.reason) : '') + '.');
      break;
    case 'CHANGE_INSTALLER':
      if (s === 'Moved' || s === 'Planned' || replay) return ok('Installer changed.');
      if (s === 'NeedsReview') return action('The installer change needs checking before it can go ahead' + (_r1rText(inner.reason) ? ': ' + _r1rHumanize(inner.reason) : '') + '.');
      break;
    case 'CANCEL_JOB': return ok('Job cancellation recorded.' + (inner.review ? ' Some items need review.' : ''));
    case 'REINSTATE_JOB': return ok('Job reinstated.' + (inner.review ? ' Some items need review.' : ''));
    case 'OPERATIONAL_COMPLETE':
      if (s === 'Completed') return ok('Job marked operationally complete.');
      if (s === 'AlreadyComplete') return ok('The job was already operationally complete. Nothing else is needed.');
      if (s === 'NeedsReview') return action("The job can't be marked operationally complete yet. Check the outstanding items on the job.");
      break;
    case 'BOOKING_GATES':
      if (s === 'ReadyToBook' || s === 'Booked') return ok('Booking checks passed. The job is ' + (s === 'Booked' ? 'Booked.' : 'Ready to Book.'));
      if (s === 'Blocked' || s === 'NeedsReview') return follow("Booking checks aren't complete yet. Check the outstanding tasks on the job.");
      break;
    case 'IW_START': return ok('Work started.');
    case 'IW_PROGRESS': return ok('Progress update saved.');
    case 'IW_REPORT_COMPLETION': return ok(s === 'ReturnRequired' ? 'Return visit recorded. The office will arrange it.' : 'Completion reported. The office will confirm it.');
    case 'IW_REPORT_PROBLEM': return ok('Problem reported.');
    case 'IW_REPORT_VARIATION': return ok('Variation reported.');
    case 'IW_COMMISSIONING_DRAFT': return ok('Commissioning draft saved.');
    case 'IW_COMMISSIONING_SUBMIT': return ok('Commissioning submitted for review.');
    case 'COMMISSIONING_REVIEW': return ok(s === 'Returned' ? 'Commissioning returned to the installer.' : 'Commissioning review saved.');
    case 'GOODS_IN_RECEIVE': return ok('Delivery received.' + (inner.complete === false ? ' Some lines are still outstanding.' : ''));
    case 'STOCK_QUARANTINE': return ok('Stock moved to quarantine.');
  }
  if (/^(NeedsReview|Review|Blocked|Failed|Refused)$/.test(String(s || ''))) return action('The request was received but needs checking before it can go ahead.');
  return ok('Request completed successfully.');
}

function _r1rExtras(commandType, inner) {
  var x = {};
  function put(k, v) { if (v !== undefined && v !== null && v !== '') x[k] = v; }
  if (!inner || typeof inner !== 'object') return x;
  if (commandType === 'SOLD_INTAKE' || commandType === 'BOOKING_INTAKE') {
    put('result_job_id', inner.job_id); put('result_job_id_human', inner.job_id_human); put('result_version', inner.version);
    if (commandType === 'BOOKING_INTAKE') put('result_workflow_stage', inner.workflow_stage);
  }
  if (commandType === 'ISSUE_CREATE') put('result_issue_id', inner.issue_id);
  if (commandType === 'DEPOSIT_CONFIRM') put('result_stage_id', inner.deposit && inner.deposit.stage_id);
  return x;
}

/* Business outcome of one command response (object or the JSON string an Apps Script bot receives). */
function _r1rFeedback(commandType, response) {
  var r = response;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
  var fb, inner = null;
  if (!r || typeof r !== 'object') fb = { status: 'Failed', message: R1R_MSG.UNKNOWN, code: 'R1R_NO_RESPONSE', detail: '' };
  else if (r.ok === true) { inner = r.result && typeof r.result === 'object' ? r.result : {}; fb = _r1rSuccessFeedback(commandType, inner); fb.code = ''; fb.detail = ''; }
  else if (r.error === 'R1C_UPLOAD_PENDING' && r.retry && r.retry.scheduled === false) fb = { status: 'ActionRequired', message: "Your file is still uploading and an automatic retry couldn't be scheduled. Wait a minute, then submit a new request.", code: 'R1C_UPLOAD_PENDING', detail: '' };
  else fb = _r1rErrorFeedback(commandType, r.error);
  if (R1R_STATUSES.indexOf(fb.status) < 0) fb.status = 'Failed';
  fb.heading = R1R_HEADINGS[fb.status];
  fb.extras = fb.status === 'Succeeded' || fb.status === 'FollowUpRequired' ? _r1rExtras(commandType, inner) : {};
  var d = { ok: !!(r && r.ok === true), command_type: commandType || null, status: fb.status, code: fb.code || null };
  if (inner) {
    if (inner.status) d.business_status = inner.status;
    if (inner.replay === true || inner.status === 'Replayed') d.replay = true;
    if (inner.completion_required === true) d.completion_required = true;
    if (inner.task) { d.task_status = inner.task.status || null; if (inner.task.blocking_reason) d.blocking_reason = inner.task.blocking_reason; }
    if (inner.job_id_human) d.job_id_human = inner.job_id_human;
    var stage = inner.workflow_stage || (inner.job && inner.job.workflow_stage);
    if (stage) d.workflow_stage = stage;
  }
  if (fb.detail) d.detail = String(fb.detail).slice(0, 300);
  if (r && r.retry) d.retry = { scheduled: r.retry.scheduled, attempt: r.retry.attempt, next_attempt: r.retry.next_attempt || null };
  fb.result_json = JSON.stringify(d);
  return fb;
}

/* Additive `feedback` on a bot response (JSON path and request-row path). Never throws. */
function _r1rAttachFeedback(commandType, response) {
  try {
    if (!response || typeof response !== 'object') return response;
    var fb = _r1rFeedback(commandType, response);
    response.feedback = { status: fb.status, heading: fb.heading, message: fb.message, code: fb.code || null };
  } catch (e) {}
  return response;
}
function _r1rUpdate(fb, actorEmail) {
  return { status: fb.status, message: fb.message, code: fb.code || '', detail: fb.result_json || '', extras: fb.extras || {}, actorEmail: actorEmail };
}

/* Pure write plan for one request row. Only result columns that exist, only the row owner, final outcomes kept. */
function _r1rPlanWrite(headers, row, update) {
  if (!row || typeof row !== 'object') return { skip: 'ROW_NOT_FOUND' };
  var cols = (headers || []).map(function (h) { return String(h || '').trim(); }).filter(Boolean);
  if (cols.indexOf('result_status') < 0 && cols.indexOf('result_message') < 0) return { skip: 'NO_RESULT_COLUMNS' };
  if (!update || R1R_STATUSES.indexOf(update.status) < 0 || !_r1rText(update.message)) return { skip: 'INVALID_UPDATE' };
  var actor = _r1rEmail(update.actorEmail);
  if (!actor) return { skip: 'ACTOR_REQUIRED' };
  var owner = _r1rEmail(row.submitted_by) || _r1rEmail(row.requested_by);
  if (!owner || owner !== actor) return { skip: 'NOT_ROW_OWNER' };
  var existing = String(row.result_status === undefined || row.result_status === null ? '' : row.result_status).trim();
  if (R1R_FINAL_STATUSES.indexOf(existing) >= 0) return { skip: 'FINAL_RESULT_PRESERVED', existing_status: existing };
  var message = update.message.trim();
  if (update.status === 'Failed' && _r1rText(String(row.command_id || ''))) message += ' Reference: ' + String(row.command_id).trim() + '.';
  var values = { result_status: update.status, result_message: message, result_code: update.code || '', result: update.detail || '', result_at: update.at ? new Date(update.at) : new Date() };
  var extras = update.extras || {};
  R1R_EXTRA_COLUMNS.forEach(function (k) { if (_r1rHas(extras, k)) values[k] = extras[k]; });
  var write = {};
  Object.keys(values).forEach(function (k) { if (cols.indexOf(k) >= 0 && values[k] !== undefined && values[k] !== null) write[k] = values[k]; });
  return { write: write };
}
function _r1rCell(value, column) {
  if (typeof value !== 'string') return value;
  var v = value.slice(0, column === 'result' ? 2000 : 500);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
/* Sheet writer for the exact DEV request spreadsheet. Never throws; returns {written, reason?, columns?}. */
function _r1rSheetWriteResult(ss, table, rowId, update) {
  try {
    if (!ss || typeof ss.getId !== 'function' || ss.getId() !== R1R_DEV_SHEET_ID) return { written: false, reason: 'DEV_ONLY' };
    var wanted = String(rowId === undefined || rowId === null ? '' : rowId).trim();
    if (!_r1rText(table) || !wanted) return { written: false, reason: 'ROW_NOT_FOUND' };
    var matches = ss.getSheets().filter(function (sh) { return sh.getName() === table; });
    if (matches.length !== 1) return { written: false, reason: 'TABLE_MISSING' };
    var sh = matches[0], lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    if (lastCol < 1 || lastRow < 2) return { written: false, reason: 'ROW_NOT_FOUND' };
    var h = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x || '').trim(); });
    var idCol = h.indexOf('id');
    if (idCol < 0) return { written: false, reason: 'NO_ID_COLUMN' };
    var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues(), found = [];
    values.forEach(function (r, i) { if (String(r[idCol] === undefined || r[idCol] === null ? '' : r[idCol]).trim() === wanted) found.push(i); });
    if (found.length !== 1) return { written: false, reason: found.length ? 'ROW_AMBIGUOUS' : 'ROW_NOT_FOUND' };
    var row = {};
    h.forEach(function (k, i) { if (k && !_r1rHas(row, k)) row[k] = values[found[0]][i]; });
    var plan = _r1rPlanWrite(h, row, update);
    if (plan.skip) return { written: false, reason: plan.skip };
    var columns = Object.keys(plan.write);
    columns.forEach(function (k) { sh.getRange(found[0] + 2, h.indexOf(k) + 1, 1, 1).setValues([[_r1rCell(plan.write[k], k)]]); });
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) SpreadsheetApp.flush();
    return { written: true, columns: columns };
  } catch (e) { return { written: false, reason: 'WRITE_ERROR' }; }
}
if(typeof module!=='undefined')module.exports={R1R_STATUSES:R1R_STATUSES,R1R_FINAL_STATUSES:R1R_FINAL_STATUSES,R1R_HEADINGS:R1R_HEADINGS,R1R_RESULT_COLUMNS:R1R_RESULT_COLUMNS,R1R_EXTRA_COLUMNS:R1R_EXTRA_COLUMNS,R1R_ERRORS:R1R_ERRORS,R1R_MSG:R1R_MSG,_r1rParseError:_r1rParseError,_r1rErrorFeedback:_r1rErrorFeedback,_r1rSuccessFeedback:_r1rSuccessFeedback,_r1rFeedback:_r1rFeedback,_r1rAttachFeedback:_r1rAttachFeedback,_r1rUpdate:_r1rUpdate,_r1rPlanWrite:_r1rPlanWrite,_r1rCell:_r1rCell,_r1rSheetWriteResult:_r1rSheetWriteResult};
