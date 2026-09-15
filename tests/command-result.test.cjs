/* R1 command result feedback: business outcome (not Apps Script success), staff-readable messages, safe request-row writes. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const cr = require('../r1-appsheet/command-result.js');
const DEV = '1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc';
const INTERNAL = /\b(?:R1[ACRU]|S\d{2})_[A-Z0-9_]+\b/;

test('CR 01: Apps Script Success with ReturnValue ok:false is ACTION REQUIRED, never success (live PRE02 request 0c046a5b)', () => {
  const returnValue = '{"ok":false,"error":"R1A_REQUIRED_EVIDENCE_ID"}';
  const fb = cr._r1rFeedback('TASK_COMPLETE', returnValue);
  assert.equal(fb.status, 'ActionRequired');
  assert.equal(fb.heading, 'ACTION REQUIRED');
  assert.equal(fb.message, 'Signed contract evidence is required. Add the signed contract evidence and try again.');
  assert.equal(fb.code, 'R1A_REQUIRED_EVIDENCE_ID');
  assert.doesNotMatch(fb.message, INTERNAL);
  assert.deepEqual(JSON.parse(fb.result_json), { ok: false, command_type: 'TASK_COMPLETE', status: 'ActionRequired', code: 'R1A_REQUIRED_EVIDENCE_ID' });
  for (const notSuccess of ['', 'not json', '{}', 'null', '{"ok":"true"}', '{"error":"R1A_STALE_VERSION"}', '{"ok":1,"result":{"status":"Completed"}}']) {
    assert.notEqual(cr._r1rFeedback('TASK_COMPLETE', notSuccess).status, 'Succeeded', notSuccess);
  }
  assert.equal(cr._r1rFeedback('TASK_COMPLETE', { ok: true, result: { status: 'Completed', task: { status: 'Complete' } } }).status, 'Succeeded');
});

test('CR 02: success and follow-up outcomes produce useful staff messages for every R1 command family', () => {
  const cases = [
    ['TASK_COMPLETE', { status: 'Completed', task: { status: 'Complete' }, job: { workflow_stage: 'Prebooking' } }, 'Succeeded', 'Task completed successfully.'],
    ['TASK_COMPLETE', { status: 'Completed', task: { status: 'Complete' }, job: { workflow_stage: 'ReadyToBook' }, readiness: { stage_advanced: true } }, 'Succeeded', 'Task completed successfully. The job is now Ready to Book.'],
    ['TASK_COMPLETE', { status: 'Replayed', task: { status: 'Complete' } }, 'Succeeded', 'Task completed successfully.'],
    ['TASK_COMPLETE', { status: 'FollowUpRequired', task: { status: 'Waiting', blocking_reason: 'PRE02_AWAITING_SIGNATURE', next_followup_at: '2026-09-16T08:00:00.000Z' } }, 'FollowUpRequired', 'Saved. The contract is recorded as sent and awaiting signature, so this task is waiting for follow-up. Next follow-up: 16 Sep 2026.'],
    ['TASK_COMPLETE', { status: 'Replayed', task: { status: 'Waiting', blocking_reason: 'PRE03_DEPOSIT_NOT_RECEIVED' } }, 'FollowUpRequired', "Saved. The deposit hasn't arrived in the bank yet, so this task is waiting for follow-up."],
    ['TASK_REOPEN', { status: 'Reopened', readiness: { stage_demoted: true } }, 'Succeeded', 'Task reopened. It is back in the task list. The job has moved back to Prebooking until this task is done again.'],
    ['TASK_EVIDENCE_ATTACH', { status: 'Attached' }, 'Succeeded', 'Contract evidence added.'],
    ['TASK_EVIDENCE_ATTACH', { status: 'EvidenceUploaded', completion_required: true, task: { status: 'Open' } }, 'FollowUpRequired', 'Signed contract evidence uploaded. Complete the contract task to confirm it is signed.'],
    ['TASK_EVIDENCE_ATTACH', { status: 'Replayed', completion_required: true, task: { status: 'Complete' } }, 'FollowUpRequired', 'Signed contract evidence uploaded. Complete the contract task to confirm it is signed.'],
    ['TASK_EVIDENCE_ATTACH', { status: 'Replayed', completion_required: false, task: { status: 'Complete' } }, 'Succeeded', 'Contract evidence added.'],
    ['DEPOSIT_CONFIRM', { status: 'Confirmed', deposit: { stage_id: 'IS-J-deposit' } }, 'Succeeded', 'Deposit confirmed.'],
    ['DEPOSIT_CONFIRM', { status: 'AlreadyConfirmed' }, 'Succeeded', 'The deposit was already confirmed. Nothing else is needed.'],
    ['SOLD_INTAKE', { status: 'Processed', job_id: 'J-x', job_id_human: 'SS-SEXL-5961', version: 1 }, 'Succeeded', 'New job created: SS-SEXL-5961.'],
    ['SOLD_INTAKE', { status: 'Processed', duplicate: true, job_id_human: 'SS-SEXL-5961' }, 'Succeeded', 'This sale was already recorded as job SS-SEXL-5961. No new job was created.'],
    ['SOLD_INTAKE', { status: 'Review' }, 'FollowUpRequired', 'The sale was saved but needs checking in Intake Review before a job is created.'],
    ['BOOKING_INTAKE', { status: 'Processed', job_id_human: 'SS-SEXL-5961', workflow_stage: 'BookingInProgress' }, 'Succeeded', 'Booking saved for job SS-SEXL-5961. The job is now Booking In Progress.'],
    ['ISSUE_CREATE', { status: 'Created', issue_id: 'ISS-1' }, 'Succeeded', 'Issue raised.'],
    ['ISSUE_UPDATE', { status: 'Updated' }, 'Succeeded', 'Issue updated.'],
    ['CALL_RECORD', { status: 'Recorded' }, 'Succeeded', 'Call recorded.'],
    ['PLANNER_UPDATE', { status: 'Updated' }, 'Succeeded', 'Planned dates updated.'],
    ['MOVE_JOB', { status: 'NeedsReview', reason: 'CAPACITY_EXCEEDED' }, 'ActionRequired', 'The move needs checking before it can go ahead: capacity exceeded.'],
    ['CHANGE_INSTALLER', { status: 'Planned' }, 'Succeeded', 'Installer changed.'],
    ['CANCEL_JOB', { ok: true, status: 'CancellationInProgress', review: true }, 'Succeeded', 'Job cancellation recorded. Some items need review.'],
    ['REINSTATE_JOB', { ok: true, replay: true, status: 'Booked' }, 'Succeeded', 'Job reinstated.'],
    ['OPERATIONAL_COMPLETE', { status: 'NeedsReview' }, 'ActionRequired', "The job can't be marked operationally complete yet. Check the outstanding items on the job."],
    ['BOOKING_GATES', { status: 'Blocked' }, 'FollowUpRequired', "Booking checks aren't complete yet. Check the outstanding tasks on the job."],
    ['IW_START', { status: 'InProgress', replay: true }, 'Succeeded', 'Work started.'],
    ['IW_REPORT_COMPLETION', { status: 'ReturnRequired' }, 'Succeeded', 'Return visit recorded. The office will arrange it.'],
    ['GOODS_IN_RECEIVE', { complete: true }, 'Succeeded', 'Delivery received.'],
    ['FUTURE_COMMAND', { status: 'Done' }, 'Succeeded', 'Request completed successfully.'],
    ['FUTURE_COMMAND', { status: 'NeedsReview' }, 'ActionRequired', 'The request was received but needs checking before it can go ahead.']
  ];
  for (const [type, result, status, message] of cases) {
    const fb = cr._r1rFeedback(type, { ok: true, command_type: type, result });
    assert.equal(fb.status, status, type + ' ' + JSON.stringify(result));
    assert.equal(fb.message, message, type);
    assert.equal(fb.heading, cr.R1R_HEADINGS[status]);
    assert.equal(fb.code, '');
    assert.doesNotMatch(fb.message, INTERNAL);
  }
  assert.deepEqual(cr._r1rFeedback('SOLD_INTAKE', { ok: true, result: { status: 'Processed', job_id: 'J-x', job_id_human: 'SS-SEXL-5961', version: 1 } }).extras, { result_job_id: 'J-x', result_job_id_human: 'SS-SEXL-5961', result_version: 1 });
  assert.deepEqual(cr._r1rFeedback('DEPOSIT_CONFIRM', { ok: true, result: { status: 'Confirmed', deposit: { stage_id: 'IS-J-deposit' } } }).extras, { result_stage_id: 'IS-J-deposit' });
  assert.deepEqual(cr._r1rFeedback('ISSUE_CREATE', { ok: false, error: 'R1A_ROLE_DENIED' }).extras, {}, 'failures never stamp result ids');
});

test('CR 03: every code thrown by the R1 AppSheet sources maps to a staff-readable message; only internal integrity faults use the generic fallback', () => {
  const src = fs.readdirSync('r1-appsheet').filter(f => f.endsWith('.js')).map(f => fs.readFileSync('r1-appsheet/' + f, 'utf8')).join('\n');
  const thrown = [...new Set([...src.matchAll(/(?:_r1sErr|_r1aRefuse|_r1aReqRefuse|_r1cFail|_r1cRequestError|_r1uRefuse)\('([A-Z0-9_]+[A-Z0-9])'\)/g)].map(m => m[1]))].sort();
  assert.ok(thrown.length > 100, 'scanned ' + thrown.length + ' codes');
  const INTERNAL_ONLY = new Set(['R1A_FINANCIAL_MUTATION', 'R1A_JOB_MUTATION', 'R1A_TASK_HISTORY_MUTATION', 'R1A_TASK_COMPLETION_MUTATION', 'R1A_STAGE_RULE_BROKEN', 'R1A_INTAKE_CARDINALITY', 'R1A_REFUSED', 'R1A_UNKNOWN_COMMAND', 'R1A_UNKNOWN_READ', 'R1A_PRE02_MISSING', 'R1A_PRE02_NOT_COMPLETE', 'R1A_TONY_RECONCILE_REFUSED', 'R1C_UNKNOWN_COMMAND', 'R1C_DUPLICATE_ID', 'R1U_OUTBOX_AMBIGUOUS', 'R1U_UNEXPECTED_RESULT', 'R1U_COMMAND_FAILED', 'R1U_SCHEDULE_FAILED', 'R1U_TARGET_INVALID', 'R1U_NOT_RETRYABLE', 'R1U_TABLE_NOT_RETRYABLE', 'R1U_COMMAND_TYPE_INVALID', 'R1A_QUERY_REQUIRED', 'R1A_QUEUE_NOT_IN_R1', 'R1A_REQUEST_AMBIGUOUS', 'R1U_REFUSED', 'R1A_INTAKE_MAPPING_INCOMPLETE']);
  const generic = [];
  for (const code of thrown) {
    const fb = cr._r1rFeedback('TASK_COMPLETE', { ok: false, error: code });
    assert.ok(cr.R1R_STATUSES.includes(fb.status), code);
    assert.equal(fb.code, code, 'internal code retained for diagnostics');
    assert.doesNotMatch(fb.message, INTERNAL, code + ' -> ' + fb.message);
    assert.match(fb.message, /\.$/, code);
    assert.notEqual(fb.status, 'Succeeded', code);
    if (/^R1[ACU]_REQUIRED_/.test(code)) assert.equal(fb.status, 'ActionRequired', code);
    if (fb.message === cr.R1R_MSG.UNKNOWN) generic.push(code);
  }
  assert.deepEqual(generic.filter(c => !INTERNAL_ONLY.has(c)), [], 'map these codes to a specific staff message');
  const required = cr._r1rFeedback('CALL_RECORD', { ok: false, error: 'R1A_REQUIRED_TYPE' });
  assert.deepEqual([required.status, required.message], ['ActionRequired', 'The call type is required. Add it and try again.']);
  const families = [
    ['S15_REVIEW: stale job revision', 'ActionRequired', cr.R1R_MSG.STALE],
    ['S15_REVIEW: conflicting command replay', 'Failed', cr.R1R_MSG.CONFLICT],
    ['S10_REVIEW: resolution required', 'ActionRequired', 'This needs checking before it can go ahead: resolution required.'],
    ['S11_RECOVERY_REQUIRED: incomplete move command', 'Failed', cr.R1R_MSG.RECOVERY],
    ['S11_DATE_INVALID: end before start', 'ActionRequired', cr.R1R_MSG.DATE],
    ['S10_CONFIG: exactly one active Office owner required', 'Failed', cr.R1R_MSG.CONFIG],
    ['S11_REFUSED: R1 pilot job required', 'Failed', "This action isn't allowed for this job at the moment."],
    ['R1C_MODE_DENIED_FN06', 'Failed', cr.R1R_MSG.MODE],
    ['R1A_JOB_ACCESS_DENIED', 'Failed', cr.R1R_MSG.PERMISSION],
    ['Invalid receipt linkage', 'Failed', cr.R1R_MSG.UNKNOWN]
  ];
  for (const [error, status, message] of families) {
    const fb = cr._r1rFeedback('MOVE_JOB', { ok: false, error });
    assert.deepEqual([fb.status, fb.message], [status, message], error);
  }
  assert.equal(cr._r1rFeedback('TASK_COMPLETE', { ok: false, error: 'R1C_UPLOAD_PENDING', retryable: true, retry: { scheduled: true } }).status, 'UploadPending');
  assert.equal(cr._r1rFeedback('TASK_COMPLETE', { ok: false, error: 'R1C_UPLOAD_PENDING', retryable: true, retry: { scheduled: false } }).status, 'ActionRequired');
});

test('CR 04: write plan touches only existing result columns on the owner\'s row and never replaces a final outcome', () => {
  const H = ['id', 'command_id', 'task_id', 'completion_note', 'submitted_by', 'status', 'result_status', 'result_message', 'result_code', 'result', 'result_at', 'result_job_id_human'];
  const base = { id: 'R', command_id: '0c046a5b', task_id: 'T', completion_note: 'note', submitted_by: 'Tanya@Example.test', status: 'Ready', result_status: '', result_message: '' };
  const upd = (status, message, extras = {}, actorEmail = 'tanya@example.test') => ({ status, message, code: 'R1A_X', detail: '{"ok":false}', extras, actorEmail, at: '2026-09-15T10:00:00.000Z' });
  let p = cr._r1rPlanWrite(H, base, upd('ActionRequired', 'Fix it.'));
  assert.deepEqual(Object.keys(p.write).sort(), ['result', 'result_at', 'result_code', 'result_message', 'result_status']);
  assert.equal(p.write.result_at.toISOString(), '2026-09-15T10:00:00.000Z');
  assert.equal(p.write.result_message, 'Fix it.');
  p = cr._r1rPlanWrite(H, base, upd('Failed', 'Could not do it.'));
  assert.equal(p.write.result_message, 'Could not do it. Reference: 0c046a5b.');
  assert.deepEqual(Object.keys(cr._r1rPlanWrite(['id', 'submitted_by', 'result_status', 'result_message'], base, upd('Succeeded', 'Done.')).write).sort(), ['result_message', 'result_status']);
  assert.equal(cr._r1rPlanWrite(H, base, upd('Succeeded', 'Done.', { result_job_id_human: 'SS-1', result_issue_id: 'ISS' })).write.result_job_id_human, 'SS-1');
  assert.equal('result_issue_id' in cr._r1rPlanWrite(H, base, upd('Succeeded', 'Done.', { result_issue_id: 'ISS' })).write, false);
  assert.equal(cr._r1rPlanWrite(H, base, upd('Succeeded', 'Done.', {}, 'ben@example.test')).skip, 'NOT_ROW_OWNER');
  assert.equal(cr._r1rPlanWrite(H, base, upd('Succeeded', 'Done.', {}, '')).skip, 'ACTOR_REQUIRED');
  assert.equal(cr._r1rPlanWrite(H, { ...base, submitted_by: 'P-tanya' }, upd('Succeeded', 'Done.')).skip, 'NOT_ROW_OWNER');
  assert.equal(cr._r1rPlanWrite(H, { ...base, submitted_by: '', requested_by: 'tanya@example.test' }, upd('Succeeded', 'Done.')).write.result_status, 'Succeeded', 'DEVCreateIssueRequests identifies the owner by requested_by');
  for (const final of cr.R1R_FINAL_STATUSES) for (const next of cr.R1R_STATUSES) assert.equal(cr._r1rPlanWrite(H, { ...base, result_status: final }, upd(next, 'x.')).skip, 'FINAL_RESULT_PRESERVED', final + '->' + next);
  for (const open of ['', 'ActionRequired', 'Failed', 'UploadPending']) assert.ok(cr._r1rPlanWrite(H, { ...base, result_status: open }, upd('Succeeded', 'Done.')).write, open);
  assert.equal(cr._r1rPlanWrite(['id', 'submitted_by', 'status'], base, upd('Succeeded', 'Done.')).skip, 'NO_RESULT_COLUMNS');
  assert.equal(cr._r1rPlanWrite(H, base, upd('Weird', 'x.')).skip, 'INVALID_UPDATE');
  assert.equal(cr._r1rPlanWrite(H, null, upd('Succeeded', 'Done.')).skip, 'ROW_NOT_FOUND');
  for (const k of ['id', 'command_id', 'task_id', 'completion_note', 'submitted_by', 'status']) assert.equal(k in cr._r1rPlanWrite(H, base, upd('Succeeded', 'Done.')).write, false, 'never writes input ' + k);
});

test('CR 05: sheet writer is DEV-locked, targets exactly one row, neutralises formulas and never throws', () => {
  function mock(id, rows, opts = {}) {
    const grid = [['id', 'command_id', 'submitted_by', 'status', 'result_status', 'result_message', 'result_code'], ...rows];
    const sh = { getName: () => 'DEVTaskCompleteRequests', getLastColumn: () => grid[0].length, getLastRow: () => grid.length,
      getRange: (r, c, h = 1, w = 1) => { if (opts.explode) throw Error('boom'); return { getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => grid[r - 1 + i][c - 1 + j])), setValues: v => v.forEach((rv, i) => rv.forEach((x, j) => { grid[r - 1 + i][c - 1 + j] = x; })) }; } };
    return { grid, ss: { getId: () => id, getSheets: () => [sh] } };
  }
  const update = { status: 'ActionRequired', message: 'Fix it.', code: 'R1A_REQUIRED_EVIDENCE_ID', actorEmail: 'tanya@example.test' };
  const rows = () => [['A', 'CA', 'tanya@example.test', 'Ready', '', '', ''], ['B', 'CB', 'tanya@example.test', 'Ready', '', '', '']];
  let m = mock('other-sheet', rows());
  assert.deepEqual(cr._r1rSheetWriteResult(m.ss, 'DEVTaskCompleteRequests', 'B', update), { written: false, reason: 'DEV_ONLY' });
  m = mock(DEV, rows());
  assert.deepEqual(cr._r1rSheetWriteResult(m.ss, 'DEVTaskCompleteRequests', 'B', update), { written: true, columns: ['result_status', 'result_message', 'result_code'] });
  assert.deepEqual(m.grid[1], ['A', 'CA', 'tanya@example.test', 'Ready', '', '', '']);
  assert.deepEqual(m.grid[2], ['B', 'CB', 'tanya@example.test', 'Ready', 'ActionRequired', 'Fix it.', 'R1A_REQUIRED_EVIDENCE_ID']);
  m = mock(DEV, rows());
  cr._r1rSheetWriteResult(m.ss, 'DEVTaskCompleteRequests', 'A', { ...update, message: '=HYPERLINK("http://x")' });
  assert.equal(m.grid[1][5], "'=HYPERLINK(\"http://x\")");
  assert.equal(cr._r1rSheetWriteResult(mock(DEV, [...rows(), ['B', 'CB2', 'tanya@example.test', 'Ready', '', '', '']]).ss, 'DEVTaskCompleteRequests', 'B', update).reason, 'ROW_AMBIGUOUS');
  assert.equal(cr._r1rSheetWriteResult(m.ss, 'DEVTaskCompleteRequests', 'missing', update).reason, 'ROW_NOT_FOUND');
  assert.equal(cr._r1rSheetWriteResult(m.ss, 'DEVOtherRequests', 'A', update).reason, 'TABLE_MISSING');
  assert.equal(cr._r1rSheetWriteResult(mock(DEV, rows(), { explode: true }).ss, 'DEVTaskCompleteRequests', 'A', update).reason, 'WRITE_ERROR');
  assert.equal(cr._r1rCell('x'.repeat(3000), 'result').length, 2000);
  assert.equal(cr._r1rCell('x'.repeat(3000), 'result_message').length, 500);
});

test('CR 06: both generated bundles carry the shared module and wire both bot entries to it', () => {
  for (const file of ['apps-script/r1-appsheet/R1AppSheetAdapter.js', 'standalone-bridge/AppSheetBridge.js']) {
    const src = fs.readFileSync(file, 'utf8');
    for (const fn of ['_r1rFeedback', '_r1rSheetWriteResult', '_r1rPlanWrite', '_r1aRunRequestRowCommand', 'appSheetR1CommandFromRequestRow', 'appSheetR1Command']) assert.match(src, new RegExp('function ' + fn + '\\('), file + ' ' + fn);
    assert.match(src, /_r1rAttachFeedback\(type,x\)/, file + ' JSON path feedback');
    assert.ok(src.indexOf('function _r1rFeedback(') < src.indexOf('function appSheetR1CommandFromRequestRow('), file + ' module precedes the bot entry');
  }
});
