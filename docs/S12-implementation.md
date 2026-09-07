# S12 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (9 tests); DEV CLOUD NOT YET RUN.** Commissioning submissions, answers, review workflow, equipment recording, and handover readiness evaluation via canonical S12 tables. Real commissioning forms NOT_CONFIGURED.

## Authoritative tables

| Table | S12 role |
|---|---|
| `CommissioningTemplates` | Trade-specific templates (trade, equipment_type, template_version) |
| `CommissioningQuestions` | Questions within templates (question_key, label, data_type, required_when, photo_category) |
| `CommissioningSubmissions` | Installer submissions (job_id, work_package_id, status: Draft→Submitted→Accepted/Returned) |
| `CommissioningAnswers` | Answer values (value_text, value_number, value_date, value_boolean) |
| `JobEquipment` | Installed equipment (equipment_type, product_id, quantity, serial_number) |
| `Handover` | Handover pack tracking (checklist_version, completeness_status, generated_file_id) |
| `Evidence` | File evidence (drive_file_id, filename, category, upload_status) |

## ReleaseModes

| FN | Function | Target | Pilot state |
|---|---|---|---|
| FN-06 | Installer app/forms access | R3 | Automated/Pilot/R3 |
| FN-07 | Commissioning receipt/review | R3 | Automated/Pilot/R3 |
| FN-08 | Handover | R3 | Automated/Pilot/R3 |

All three must be enabled for S12 cloud smoke.

## Architecture

### Submissions (`s12/commissioning.js`)
- `createSubmission(store, jobId, wpId, ...)` — deterministic ID: `CS-{wpId}`, status Draft
- `submitAnswers(store, submissionId, answers)` — records answers, sets status Submitted
- `reviewSubmission(store, submissionId, reviewer, status, notes)` — Accepted or Returned

### Equipment
- `recordEquipment(store, jobId, wpId, equipmentType, qty, productId)` — deterministic ID: `JE-{wpId}-{equipmentType}`
- Idempotent: existing equipment reused

### Handover
- `evaluateHandover(store, jobId)` — checks all submissions accepted + equipment recorded
- `createHandover(store, jobId, checklistVersion, docTypes)` — deterministic ID: `HO-{jobId}`

## Tests (9, all passing)

| # | Test |
|---|---|
| 1 | Submission created |
| 2 | Answers submitted |
| 3 | Review accepted |
| 4 | Equipment recorded |
| 5 | Handover created when ready |
| 6 | Equipment idempotent replay |
| 7 | Unrelated rows untouched |
| 8 | Submission not created twice |
| 9 | S12Commissioning.js VM smoke test |

## Blockers

- **Real commissioning forms NOT_CONFIGURED** — synthetic DEV templates only (Roof/Solar, 3 questions)
- **Commissioning amendment** not yet supplied — full S12 acceptance blocked
- **No installer app screens** — that's AppSheet, not backend
- **No offline sync** — out of scope for backend domain layer
- **PROD untouched**

## Cloud smoke test

`apps-script/s12/S12Commissioning.js` — single file, 7 zero-arg functions:
- `runS12FixtureDryRun()` / `runS12FixtureApply()` / `runS12FixtureValidate()`
- `runS12EnableFunctionsForSyntheticTest()` — enables FN-06/07/08 (Automated/Pilot/R3)
- `runS12HappyPathTest()` — submission → answers → review accept → equipment → handover
- `restoreS12SafeState()` — restores all three to Disabled/None/R3
