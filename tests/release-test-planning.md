# RA01 release test planning

Authority: RA01 v1.0 §§9–12, preserving document 03 T001–T112 and any future approved commissioning-amendment revisions. This is a plan, not executed test evidence. S01/G01 register and original component-test evidence remain unchanged.

## Registers and assertion traceability

- `original-case-register.csv`: all 112 original IDs, titles, setup and complete expected results, verbatim from document 03. Full-case status is NOT RUN. `first_release` includes scoped supplements; `planned_full_case_release` is the planned final assertion closure, subject to proper evidence and approved scope. A release label never establishes completion.
- `original-assertion-plan.csv`: every original expected-result clause, split only at semicolons, is preserved in `Txxx-Axx` rows. Each row retains every subcondition in its text and has a first/target release, mode, actual/evidence/defect and regression fields. Where a clause combines multiple functions, all must pass; its target is the release capable of satisfying the whole clause. R1/R2/R3 supplements use distinct IDs so a partial/manual demonstration cannot overwrite a deferred original assertion. Tests also require the original setup, not just checking the expected text.
- `release-test-plan.csv`: RT01–RT08 source actions/expected results, with separate rows for each explicitly required release. RT07 has four planned runs; RT08 runs before each R2/R3/R4 extension. RT03 repeats at R3; RT05 precedes R2/R3/R4. Re-run other RT checks if changes affect them. All rows NOT RUN.
- `test-register.csv`: existing S01 results only, preserved. New execution records must include actual release/config/app/fixture/environment/mode, component versus integration, tester/time, expected/actual, evidence, defect and retest.

The clause-level first-release allocation is developer planning under RA01's starting map, not a business-rule amendment. For shared tests, R1 executes the enabled office/foundation portion; the complete original case waits for its later-function assertions. T109 load includes R1 volumes/performance and expands through R4; T111 evolution expands to materials/commissioning; T112 needs a scoped normal/change/cancel journey each release and the complete final journey. T108 backup/isolated restore is mandatory before R1 even though archive reopening completes in R4. T098/T099 permitted installer/scaffolder access waits for enabled scope, but disabled direct/API/file access denial is mandatory at R1. Calendar/finance connector checks repeat when those adapters are introduced.

Keep additional run rows for every implementation, integration and regression execution. Never overwrite a previous release's result when retesting. Rows with owners/dates not supplied must be assigned by the developer/Ben before approval; blank is not an approved deferral. If a single clause needs separate component/manual/connector evidence, create linked child run rows retaining the original ID/text; the parent cannot PASS until all subconditions have evidence.

## Required release suites

| Release | Original scope and regression | RA01 additional tests |
|---|---|---|
| Every release | Relevant identity/role/concurrency/recovery/change/cancellation; T098–T106,T108–T112 as applicable; direct/API/file denial for Disabled functions. Bring forward all dependencies of enabled behaviour. | RT07; RT08 before each extension; repeat any affected RT test |
| R1 | Begin T001–T032; T064–T069,T074–T075,T077; manual/business-rule portions T078,T080–T085,T090–T093. Scoped supplements also capture draft safeguards, restoration and disabled access needed by RA01. Calendar/invoice automation and later screens remain outstanding where specified. | RT01,RT02,RT03,RT04,RT07 |
| R2 | Complete applicable T026–T063; extend T090–T093,T098–T100,T108–T112 across stores/scaffold/Calendar. Include shared-location non-pilot stock, urgent revisions/stale confirmation and processor restart. | RT05,RT06,RT07,RT08 |
| R3 | Complete applicable T064–T077; repeat installer-change, file security and recovery; add commissioning-amendment cases without losing original IDs/history. | RT03,RT05,RT07,RT08 |
| R4 | Complete T078–T089,T094–T097,T107, finance/archive assertions and affected earlier journeys. Use approved manual evidence route if R3 pending under approved swap. | RT05,RT07,RT08 |
| Final combined acceptance | Rerun T001–T112 plus all commissioning-amendment cases together after all four releases; reconcile every original assertion and final deliverable. Formally deferred PDF assertions remain explicitly outstanding. | Retain per-release RT evidence; rerun affected boundaries/recovery/regression |

## Manual evidence and result rules

R1 manual-route PASS can prove an owned, due, revisioned action with Job ID/package, external reference and completion evidence, but cannot pass an unexecuted automatic send/callback assertion. NoAnswer, sent, received, accepted and confirmed remain distinct. Waiting requires follow-up. Unverified current commissioning evidence cannot clear completion gates; the separate commissioning amendment is still required for R3.

Deferred work is NOT RUN or BLOCKED with reason, owner/date and target release, not Not Required or delivered. No enabled failure may be labelled deferred to pass a release. Record FAIL for observed failures and fix/retest; never infer PASS from this plan. No critical unauthorised access, data loss, false completion, duplicate action or financial discrepancy can remain in enabled scope. A whole original T-case is fully PASS only once every currently approved expected result has been observed, including connector evidence where required.

## Repeated release checkpoints

At each R?-S18, freeze the actual version/scope/modes and execute the required assertions plus manual interfaces. R?-S19 rehearses migration/rollback and trains users using normal job, move, installer change and cancellation. Ben's recorded decision precedes R?-S20 activation and harmless authorised pilot checks. Observe that release's real cycles and obtain Ben's later expansion decision. Use `docs/release-record-template.md` for each release. Tests run on synthetic data in isolated environments; live smoke/pilot activity requires its own approved scope. This planning update performs none of those actions.
