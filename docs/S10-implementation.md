# S10 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (19 tests); DEV CLOUD RETEST REQUIRED.** The first DEV happy-path attempt exposed Sheet `Date` normalization failure before completing. The corrected bundle has not been deployed or rerun. No PROD mutation, outbound call, GHL mutation, commissioning acceptance implementation, or payment automation was performed.

## Authoritative model

S10 reads and writes the canonical `Jobs`, `WorkPackages`, `Allocations`, `Tasks`, `Calls`, `Issues`, `IssueEvents`, `CommissioningSubmissions`, `GHLTasks`, `Holidays`, `People`, `PersonRoles`, `TaskTemplates`, and `ReleaseModes` tables. Every child relationship uses `Jobs.id`.

The authoritative templates are INS01 (installer confirmation call), INS02 (missing commissioning reminder), INS04 (customer call), REM01 (return-date booking), ISS01 (variation review), ISS02 (remedial/complaint investigation), and GHL01 (human GHL opportunity move). Tanya owns calls and remedial/complaint work; Hannah owns variation review; issue ownership can be reassigned with an immutable `IssueEvents` record. Installer reminders are assigned to the active lead installer with Tanya oversight represented by the office workflow.

The current production seed contains INS01, INS02, and GHL01. INS04, REM01, ISS01, and ISS02 are absent. The Apps Script fixture creates clearly labelled `DEV` synthetic INS04/ISS01/ISS02 templates only; REM01 remains required before exercising the return-required cloud path. These synthetic templates are smoke-test configuration and must not be treated as approved production configuration.

## Rules implemented

- INS01 is due on the next staffed day after actual/reported completion, or planned end when actual completion is absent. A planned date does not confirm work. Instance keys contain package and revision.
- INS04 unlocks only after all required packages have confirmed completion. `NoAnswer` records the attempt and leaves the task open with a next attempt.
- `ReturnRequired` creates a deterministic remedial and REM01 date-booking task. An unhappy customer call creates a deterministic complaint.
- Issue retries reuse the immutable issue ID; a materially different payload for the same ID fails closed. Resolve and close create history events; closure requires resolution and customer confirmation.
- INS02 becomes due two staffed days after actual completion and is omitted once a Submitted, UnderReview, or Accepted submission exists. S10 does not decide commissioning acceptance.
- Operational completion requires every required package confirmed, Accepted commissioning for each commissioning-required package, customer happiness, and no unresolved completion-blocking issue. It records `operational_complete_at/by`, advances the workflow stage, and creates one GHL01 task plus one `GHLTasks` tracking row. Cash, handover, and scaffold strip remain separate.
- Business dates use Mon–Fri plus `Holidays.office_closed`. Current S10 rules use date-only Europe/London business-day boundaries; the supplied November smoke dates are GMT.

## Release modes and safety

FN-01 (`Office core/intake/tasks/planners/calls/issues`) must be Automated/Pilot/R1. FN-18 (`Manual missing-form reminder`), FN-19 (`Operational completion approval`), and FN-11 (`GHL progression/messages`) must be Manual/Pilot/R1. The bundle refuses the wrong sheet, non-DEV environment, non-pilot job, wrong release, missing/duplicate mode rows, or unexpected mode.

The Apps Script helpers only permit expected Disabled/None/R1 to controlled Pilot/R1 state, and restore all four functions to Disabled/None/R1. `GHLTasks` contains no configured external identifiers and there is no GHL adapter or outbound API call.

## Local validation

`npm run test:s10`: 19 passed, 0 failed. The focused suite covers calls, deterministic keys, completed-task reuse, customer dependency, no-answer, issue creation/conflict/reassignment/history, blocking issues, completion writes/replay, human GHL tracking, two-day reminders, environment/mode/scope refusal, unrelated-row preservation, return-required behavior, Apps Script syntax/entry points, Sheet `Date` values, ISO/date strings, canonical holiday comparison, and clear invalid-date refusal.

## Manual DEV smoke sequence

Paste `apps-script/s10/S10Operations.js` into the DEV bound Apps Script project, then run:

1. `restoreS10SafeState()`
2. `runS10FixtureDryRun()`
3. `runS10FixtureApply()`
4. `runS10EnableFunctionsForSyntheticTest()`
5. `runS10FixtureValidate()`
6. `runS10HappyPathTest()`
7. `restoreS10SafeState()` even if an earlier step fails
8. `runS10FixtureValidate()` to confirm the disabled safe state

The happy path uses one synthetic R1 pilot job and a sample `Accepted` commissioning row solely to exercise the completion gate. It creates or reuses one durable human GHL task and reports `outbound_calls: 0`.
