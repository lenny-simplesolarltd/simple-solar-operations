# R1 Office go-live readiness register

Audit date: 7 September 2026. Authority order: build specification, user/admin manual, testing workbook, build/test guide, RA01, then the implemented S18–S20 contracts. This is not S21 and is not production authority. No production resource was accessed or changed.

## 1. Exact R1 scope

| Boundary | Contents |
|---|---|
| `IN_R1` | S01–S06; office/manual portions of S09–S13 and S15–S17. Sold/Booking intake and validation; stable jobs; booking gates; tasks and history; three-/six-week planning; multi-day work, moves and installer changes; calls/issues/remedials/complaints/variations; retained-form evidence tracking; manual invoice/deposit/interim/balance/Phoenix/GHL tasks; operational completion; full applicable cancellation/reinstatement; usable office/admin screens. |
| `FOUNDATION_REQUIRED_FOR_R1` | Company ownership/support and recovery; distinct DEV/TEST/PROD; authenticated roles and access denial; safe concurrency, journal recovery and outbox; backup plus demonstrated isolated restore/recovery; health/last-success and manual fallback; per-function modes; named Pilot jobs/users; producer ownership and no dual creator. |
| `DEFERRED_R2` | New order/delivery engine, stock ledger/picking/stocktakes, integrated scaffold workflow and Calendar adapter. Their existing routes and tracked R1 manual actions remain required. |
| `DEFERRED_R3` | Installer AppSheet, commissioning capture/forms/review automation and replacement handover. Current accepted forms/files and reviewed evidence route must remain usable in R1. |
| `DEFERRED_R4` | Automated Xero/payment integration, accounting/reporting, Phoenix integration automation and archive automation. Existing authorised invoice/Phoenix routes and human GHL remain tracked in R1. |

R1 canonical modes are FN-01 Automated/Pilot and FN-11, FN-15–FN-20 Manual/Pilot; FN-14 is planned Automated/Pilot for backup/health foundations. No mode is to be changed by this readiness exercise.

## 2. Canonical action register

There are **28 unique actions** after deduplicating S18, S19, and S20 symptoms. Categories are the required responsibility classifications; priority is separate.

| action_id | priority | title | category | owner | source_gate | authoritative_requirement | current_status | exact_action | input_needed | evidence_required | dependencies | blocks_r1 | can_do_now | completion_condition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1-001 | P0 | Preserve delivered DEV implementation | ALREADY_SATISFIED | Lenny | S18 implementation baseline | R1 code exists in isolated DEV | DONE | Keep source/version and PROD untouched | None | Passing source/test snapshot | None | YES | No action | Repository remains reproducible; no PROD change |
| R1-002 | P0 | Stable schema, IDs and safety controls | ALREADY_SATISFIED | Lenny | FND-02–10, schema/recovery/outbox | Stable IDs, roles/history, locks, recovery, idempotency, modes | DONE | Retain test evidence; regression-test release candidate | None | Existing local/cloud evidence plus final regression | R1-001 | YES | Regression can run | Final candidate repeats applicable tests without critical failure |
| R1-003 | P0 | Keep R1 modes Disabled/None | ALREADY_SATISFIED | Lenny | REL-01, S20 mode preflight | Disabled until approval | DONE | Verify, never activate during readiness | None | Read-only ReleaseModes capture | None | YES | Read-only check | All R1 functions remain Disabled/None until authorized cutover |
| R1-004 | P1 | Preserve later-release manual routes | ALREADY_SATISFIED | Business owners | RA01 §§5,7 | R1 retains Calendar/order/scaffold/evidence/finance/Phoenix/GHL routes | DONE | Do not retire existing routes during preparation | Route owners still need verification in R1-011 | Current routes unchanged | None | YES | No change | Existing routes remain active pending verified ownership register |
| R1-005 | P0 | Complete ownership and recovery designations | NEED_BEN | Ben/company admin | FND-01; G01-S01/S02/S06/S07 | Company-controlled accounts, source/config, support/recovery | NEED_INPUT | Name automation owner, admin, recovery owner, backup/support contacts and entitlement owner; verify company control | Named people/accounts and recovery policy | Completed protected ownership register, MFA/licence and recovery proof | None | YES | NO | Every required asset has company owner, connection owner, recovery path and least-privilege developer access |
| R1-006 | P0 | Complete environment and producer inventory | LENNY_CAN_DO_NOW | Lenny with current connection owners | G01-S03/S05/S06/S10; S20 config | Distinct environments and current-producer register | READY_TO_DO | Fill protected DEV/TEST/PROD resource register; export current producer settings read-only; record retain/retire/exclusion capability and checksums | Existing owners for inaccessible systems | IDs stored outside source, screenshots, config exports/checksums, initial company tag | R1-005 for inaccessible assets | YES | YES, accessible assets | Every resource and producer is uniquely identified, owned, time-zoned, exported and assigned a cutover disposition |
| R1-007 | P0 | Finish G01 identity/access/delivery evidence | TRAINING_OR_REHEARSAL | Lenny + Ben/company admin | FND-01; G01-01–07/S01–S07/S10 | Approved delivery, denial, company access, isolation | BLOCKED | Execute exact G01 work in §7 using isolated TEST identities/resources | Approved test inbox, secondary calendar, restricted test user, PROD folder link, Ben login | Refusal logs/no-side-effect checks, receipt proof, PROD denial, Ben source/inventory access, ACL/timezone/entitlement evidence | R1-005,R1-006 | YES | Partly | All G01 rows pass with tester/time/config/evidence; no PROD data read or ACL change |
| R1-008 | P0 | Confirm real R1 staff directory | NEED_BEN | Ben/company admin | BLK-04, MAN-04, S20 staff_accounts | Authenticated named R1 roles | NEED_INPUT | Supply and provision real company Google accounts for Tanya, Ben, Hannah and Lenny/automation as applicable; set People/PersonRoles and backups | Exact emails; active roles; backup people; calendar/notification fields where used | Account provisioning, People/PersonRoles export, sign-in proof | R1-005 | YES | NO | Required users authenticate under correct roles; no guessed email; inactive/extra access denied |
| R1-009 | P0 | Record production configuration references | TECHNICAL_CONFIGURATION | Lenny/company admin | S20 production config | Exact PROD Sheet, Script, AppSheet, evidence/backup folders, timezone, owners | NEED_INPUT | Populate protected configuration register without secrets or changing PROD; validate IDs and disjointness read-only | Company-approved PROD resources and access | Signed/config-version validation report | R1-005,R1-006 | YES | Partly | Every R1 S20 config entry is CONFIGURED with evidence, and IDs match without PROD mutation |
| R1-010 | P0 | Export and map both Jotforms | LENNY_CAN_DO_NOW | Lenny; Tanya validates meaning | JOB-04, MAN-02/03 | Exact question IDs, raw payload and stable submission keys | READY_TO_DO | Export form definitions/field names for forms 260185763834060 and 250293237424050; complete §8 worksheet; do not submit live forms | Tanya confirmation for ambiguous business labels | Protected exports/checksums, completed MappingRules review | None for export | YES | YES | Every required mapping has verified question ID, transform, required rule, owner and mapping version |
| R1-011 | P0 | Verify retained R1 business routes and owners | NEED_TANYA_OR_HANNAH | Tanya/Hannah; Ben approves | RA01 R1 manual work; FN-02–11/17–20 ownership | One owner/evidence route for every live action | NEED_INPUT | Document current Calendar, orders, scaffold, forms/evidence, handover, invoice, Phoenix and human GHL processes, owners, references and pilot exclusion behavior | Current-system details from Tanya/Hannah; Ben policy confirmation | Completed ownership/mode rows and sample redacted evidence | R1-005 | YES | NO | Each retained route has owner, backup, evidence, escalation and no-dual-creator boundary |
| R1-012 | P1 | Correct/close the R1 human-GHL gate | TECHNICAL_CONFIGURATION | Lenny | BLK-01; FN-11; S20 `ghl_configuration` | RA01: GHL remains human/manual in every release | READY_TO_DO | Treat R1 configuration as verified human task route, not API/pipeline automation; record required stage/reference instructions. Before final acceptance, minimally correct S18 wording/check so API IDs do not falsely block R1, while retaining task/evidence validation | Tanya's actual human GHL procedure and Ben approval | Test of GHL01/S13 human task with recorded outcome; gate regression | R1-011 | YES | Analysis/fix can start | R1 acceptance proves the human GHL task without requiring automated API IDs; future API work remains deferred |
| R1-013 | P0 | Confirm staffed-day, holiday and capacity settings | NEED_BEN | Ben | BLK-07; Settings/Holidays | Monday–Friday default, holidays maintained, capacity advisory | NEED_INPUT | Answer the single settings batch in §6; populate Settings/Holidays only in the authorized environment later | Ben decisions | Approved settings sheet and configured rows | None | YES | NO | Staffed weekdays, holiday source/owner, capacity assumptions and effective date are approved and configured |
| R1-014 | P0 | Configure R1 Drive backup destination and procedure | TECHNICAL_CONFIGURATION | Lenny/company admin | BKP-03, S20 backup config | Company-controlled backup and recovery | NEED_INPUT | Identify protected backup folder; document connection owner, schedule, retention, checksum/manifest and access controls | Folder/retention/recovery owner from Ben/admin | Folder ID protected reference, ACL capture, successful backup manifest/file reference | R1-005,R1-009 | YES | Procedure draft now | Backup destination is verified and a real pre-cutover backup can be produced without exposing secrets |
| R1-015 | P2 | Demonstrate isolated restore/recovery | TRAINING_OR_REHEARSAL | Lenny + Ben reviewer | BKP-04, MAN-06, RT07, S20 backup | Backups and demonstrated restore; preserve newer work | NOT_RUN | Restore a verified backup into an isolated TEST copy with outgoing actions disabled; validate counts/checksum/IDs, then document reconciliation. Never overwrite PROD | Approved TEST target and recovery procedure | Restore log, before/after counts/checksum, timing, no-outbound proof, Ben review | R1-014 | YES | NO | Isolated restore is repeatable and reviewed; production destructive rollback is neither required nor performed |
| R1-016 | P2 | Rehearse daily health and backup review | TRAINING_OR_REHEARSAL | Tanya and Ben | MAN-05/06; FN-14/16 | Tanya daily health, Ben backup/escalation, last-success/manual check | NOT_RUN | Tanya completes SYS01 against synthetic degraded/healthy states; Ben validates manifest; both rehearse manual outage route | Tanya/Ben availability | Task completion, screenshots/logs, escalation outcome | R1-014,R1-015 | YES | NO | SYS01 and backup review evidence passes with named follow-up for every alert |
| R1-017 | P1 | Produce task version/history evidence | LENNY_CAN_DO_NOW | Lenny | HST-04 | Reliable task revision/history | READY_TO_DO | Use existing synthetic DEV fixture or create one synthetic task through the approved DEV fixture; complete/update it through processor; show positive version plus TaskEvent/AuditEvent | None | Redacted row IDs, versions before/after, linked events, test output | R1-002 | YES | YES | S18 sees at least one versioned task and history proves update without overwrite |
| R1-018 | P1 | Configure R1 AppSheet views/actions | TECHNICAL_CONFIGURATION | Lenny | BLK-03; S17 mapping | Usable authenticated office UI | READY_TO_DO | Bind the exact R1 views in §9 to S17/table contracts; add role/security filters and hide disabled/later actions | Real account roles from R1-008 | App definition/export, view/action matrix, screenshots | R1-008 for final sharing | YES | Build can start in DEV/TEST | Required R1 screens function with only authorized actions and no later-release data exposure |
| R1-019 | P2 | Verify AppSheet roles and access denial | TRAINING_OR_REHEARSAL | Lenny + Tanya/Ben/Hannah | MAN-01/04; G01 AppSheet access | Actual role visibility and direct-link denial | NOT_RUN | Each real R1 user signs in; run positive/negative view/action tests; installer/scaffolder and direct links remain denied | R1 accounts and configured app | Per-user screenshots, action results, denial evidence, device/browser | R1-007,R1-008,R1-018 | YES | NO | Every role sees exactly its R1 views/actions; unauthorized table/file/action access is denied |
| R1-020 | P1 | Validate Sold/Booking intake in isolated DEV/TEST | TRAINING_OR_REHEARSAL | Lenny + Tanya | MAN-02/03, JOB-04, RT01 | Correct mapping, match, replay/conflict/non-pilot behavior | NOT_RUN | Use controlled test payloads or expressly authorized real-form test submissions to process Sold then Booking; verify duplicate replay and non-pilot suppression; no live downstream effects | Completed mappings and approved test route | Raw payload hash, Intake/Job IDs, match, replay/conflict logs, zero external effects | R1-010,R1-007 | YES | NO | Both flows pass with one Job/task set and no duplicate creator/event |
| R1-021 | P0 | Define bounded R1 migration dataset | NEED_TANYA_OR_HANNAH | Tanya; Ben approves boundary | MIG-R1-01–07, CUT-R1-02 | Reconcile chosen jobs/open obligations without replay | NEED_INPUT | Select a provisional smallest representative set of open jobs for rehearsal; identify authoritative source exports and fields for seven domains; exclude unnecessary history | Pilot candidates/current source locations | Approved rehearsal scope and source snapshot/checksum | R1-011 | YES | NO | Exact rehearsal job list and source cut-off cover all open obligations and retained external references; final live Pilot choice remains R1-025 |
| R1-022 | P2 | Rehearse R1 migration and reconciliation | TRAINING_OR_REHEARSAL | Lenny + Tanya | MIG-R1-01–07; S19 handoff | IDs/state/tasks/references retained, no replay | NOT_RUN | Import a copy into TEST, assign/retain stable IDs per §10, reconcile totals and exceptions, rerun idempotently, rehearse fallback | R1-021 exports | Counts, exception register, crosswalk, no-replay result, rollback rehearsal | R1-020,R1-021 | YES | NO | All seven domains reconcile; repeated run creates no duplicate; every exception has owner |
| R1-023 | P2 | Complete 15-module R1 training | TRAINING_OR_REHEARSAL | Lenny facilitates; Tanya/Ben/Hannah perform | MAN-14; TRN-R1-01–15 | Screen-specific trained users and evidence | NOT_RUN | Run §11 sequence using configured TEST app and synthetic data; record each module separately | Users, app, settings/manual routes | Module evidence in §11 and updated manual corrections | R1-016,R1-018,R1-020 | YES | NO | All 15 modules are PASS with participant/date/evidence; none inferred from attendance |
| R1-024 | P2 | Execute one R1 end-to-end rehearsal | TRAINING_OR_REHEARSAL | Lenny + Tanya/Ben/Hannah | RA01 exit demo; RT01–04/07/08; S19 prep | Normal/move/reassign/cancel/recovery journey | NOT_RUN | Execute §12 wholly in DEV/TEST with synthetic data and no external effects | Completed config, app and trained users | Evidence pack and defect/retest log | R1-015–023 | YES | NO | Every §12 criterion passes and no critical defect remains |
| R1-025 | P3 | Decide Pilot scope and success/stop criteria | NEED_BEN | Ben | CUT-R1-08; S20 pilot_scope | Explicit jobs/users/functions/duration/fallback | NEED_INPUT | Answer §13 decisions; approve smallest safe bounded scope | Business risk/availability decisions | Written pilot decision | R1-011,R1-024 | YES | NO | Pilot job IDs, users, modes, period, monitoring, success/stop/fallback are explicit |
| R1-026 | P3 | Freeze candidate and creator/fallback preflight | TECHNICAL_CONFIGURATION | Lenny | CUT-R1-03/04/09; S20 creator/modes/fallback | No dual creator; exact version; non-destructive fallback | BLOCKED | Freeze tag/config; capture modes; prove old Jotform/Calendar producer exclusion/freeze method; keep new creator inactive; approve fallback | Approved pilot and current-producer owner | Version/tag, before-state, freeze verification plan, fallback rehearsal reference | R1-006,R1-009,R1-014,R1-022,R1-025 | YES | NO | S20 inputs are evidenced: both creators inactive pre-switch, old-stop proof method, exact transitions and fallback |
| R1-027 | P3 | Rerun S18 then S19 then S20 | FINAL_SIGNOFF | Lenny | R1-S18/S19/S20 | Sequential fail-closed gates | BLOCKED | After §15 entry condition, run twice/read-only as applicable; resolve—not relabel—every remaining item | Completed evidence references | Captured outputs, blocker-free handoff and S20 authorization simulation | R1-005–026 except final decision record | YES | NO | S18 R1 `READY_FOR_CONTROLLED_PILOT`; S19 R1 `READY_FOR_S20`; S20 R1 `AUTHORIZED_FOR_CUTOVER` |
| R1-028 | P3 | Record Ben's R1 go-live decision | FINAL_SIGNOFF | Ben | MAN-15; S20 signoff | Separate written release authority | NOT_RUN | Ben reviews final evidence and records approve/reject, exact scope/version/date/operator/fallback; no implied approval | R1-027 results | Signed release record | R1-027 | YES | NO | Explicit approval exists and matches the S20-authorized configuration; otherwise R1 remains blocked |

### Counts by priority

- P0: 13 actions (3 already satisfied, 10 remaining).
- P1: 5 actions (1 already satisfied, 4 remaining).
- P2: 6 actions.
- P3: 4 actions.

## 3. Execution order

1. **Do first:** R1-006, R1-010 and R1-017 in parallel: inventory resources/producers, export both Jotform definitions, and capture task-version history.
2. Send Ben the single batch in §6. Send Tanya/Hannah the single batch in §6 at the same time.
3. Complete ownership/accounts, settings, production-reference register, retained-route register and backup procedure (R1-005, 008, 009, 011, 013, 014).
4. Finish G01, correct the human-GHL gate semantics, map/test Jotform, and configure/test AppSheet (R1-007, 012, 018–020).
5. Define the migration set, configure backup/restore and rehearse migration, health and recovery (R1-015, 016, 021, 022).
6. Train all 15 modules, then execute the single end-to-end rehearsal (R1-023, 024).
7. Ben decides the Pilot boundary; freeze the candidate and complete creator/fallback preflight (R1-025, 026).
8. Rerun S18 → S19 → S20. Only a genuinely authorized output goes to Ben for the separate R1 decision (R1-027, 028).

## 4. Lenny's immediate checklist

These require no decision from another person to begin.

| action | exact system/site to open | retrieve/configure | where it goes | evidence to save |
|---|---|---|---|---|
| R1-006 | Google Drive/Sheets/Calendar/AppSheet/Apps Script admin pages and current automation dashboards already accessible to `lenny@simplesolarltd.co.uk` | Resource IDs, visible owners, connections, timezone, current triggers/producers and export capability; do not change PROD | Protected copy of `config/environment-register.csv` and `integration-inventory/*` | Timestamped screenshots; exported configs/checksums; access gaps list |
| R1-010 | Jotform Builder for Job Sold `260185763834060` and Job Booking `250293237424050` | Form/source export and each stable question/field ID; do not submit | Protected mapping worksheet based on §8, then reviewed `MappingRules` configuration | Export files, form revision/time, checksum and field-ID screenshots |
| R1-017 | DEV Sheet and the existing S04/S06 fixture/test runners | One synthetic Task with version before/after plus TaskEvent/AuditEvent | DEV evidence folder and test register | IDs, screenshots/JSON output and source version |
| R1-018 | DEV/TEST AppSheet editor | Start binding Home, Jobs, Job Detail, Tasks, queues and admin views; require sign-in; keep later-release actions hidden/disabled | DEV/TEST app only | App definition/export and configuration screenshots |
| R1-012 | Repository S18 tests/source and GHL01/S13 task implementation | Draft the minimal acceptance correction proving human task/evidence rather than API IDs | Proposed local patch/test only; do not deploy yet | Failing-before/passing-after local test and requirement citation |
| R1-014 | Company Shared Drive Backups folder visible to Lenny | Draft naming, manifest/checksum, retention and isolated-restore procedure; do not create/delete PROD backups | Protected operations procedure | Draft and list of owner decisions still needed |

## 5. Consolidated Ask Ben list

Send this once; each answer should be written and attributable.

1. Confirm the exact company emails and R1 roles for Tanya, Ben and Hannah; name each backup and the automation/admin/recovery/support owners.
2. Confirm Ben can open the company source repository and protected integration inventory in his own account, and name who can recover them without Lenny.
3. Approve the test inbox, secondary test Calendar and restricted test identity for G01; provide the PROD folder link solely for a direct access-denial test.
4. Confirm the staffed-week default (Monday–Friday), the authoritative holiday/closure list and maintainer, capacity per person/trade, whether capacity is advisory only, and the effective date.
5. Confirm the current authorised route and accountable owner/backup for Calendar changes, merchant/order messages, scaffold changes, commissioning evidence review/handover, invoice/payment checks, Phoenix evidence, and human GHL progression/cancellation.
6. Confirm backup folder ownership, retention, recovery owner, required recovery time/point objectives and that an isolated TEST restore is the acceptance demonstration.
7. Confirm which smallest representative open jobs may be proposed for the R1 pilot and which data may be copied into the protected migration rehearsal.
8. After rehearsal—not now—decide Pilot job IDs/users, exact FN-01/FN-11/FN-14–20 modes, pilot duration, monitoring cadence, success criteria, stop triggers, fallback owner and support availability.
9. After S18/S19/S20 pass—not now—record the formal approve/reject decision with version, date, scope and operator.

### Ask Ben configuration sheet

| setting | current default | question for Ben | why needed | blocks R1? |
|---|---|---|---|---|
| Timezone | Europe/London | Confirm for Sheets, Script, AppSheet and Calendars | Due dates and evidence time | YES |
| Staffed weekdays | Monday–Friday | Confirm or specify exceptions | Due rules/calls/reminders | YES |
| Holidays/closures | None configured | Supply authoritative list/source and maintainer | Working-day calculation | YES |
| Capacity | Unconfirmed; advisory by specification | Confirm per-person/trade values and warning policy | Planner warnings | YES if capacity views enabled; values may be nullable if explicitly approved |
| Daily health owner | Tanya | Confirm Tanya and backup Ben | Failure visibility | YES |
| Backup/recovery owner | Unconfirmed | Name owner/backup and retention/RTO/RPO | Restore/continuity | YES |
| Pilot jobs/users/period | Undefined | Approve exact bounded set and observation period | S20 Pilot scope | YES |
| Fallback owner | Unconfirmed | Name operator and business owner | Safe stop/manual continuation | YES |

## 6. Consolidated Ask Tanya/Hannah list

1. Tanya: confirm the business meaning of every Sold/Booking field, which fields are mandatory, and the current match/reference used between the two forms.
2. Tanya: identify authoritative sources and open obligations for candidate jobs across Jobs, Customers, Tasks, Booking, planning/install dates, Calls/Issues and Cancellation.
3. Tanya: describe the current Calendar, order, scaffold, invoice/payment-chase, commissioning evidence/handover and human GHL steps, including proof recorded and what identifies the latest revision.
4. Tanya: identify representative synthetic scenarios for normal, moved-trade, replacement-installer, no-answer/issue, operational-completion and cancellation/reinstatement rehearsals.
5. Hannah: confirm the R1 variation notification/evidence process and the current Phoenix evidence route for Phoenix jobs; Phoenix automation itself remains R4.
6. Tanya and Hannah: confirm availability for role/access tests, assigned training and the end-to-end rehearsal; report corrections needed in the user manual.

## 7. Exact G01 remaining work

Already provisioned: company Shared Drive and DEV/TEST folders; DEV/TEST Sheets and secondary Calendars; DEV/TEST AppSheet shells; DEV bound Apps Script; DEV canonical schema; company repository exists; local safety evidence exists; PROD is reported untouched.

Still required:

1. Complete company automation identity, normal licence, MFA, administrator/recovery owners, named least-privilege developer access and revocation path (`G01-S01`).
2. Prove company ownership/recovery for Drive, Apps Script, AppSheet, evidence and backups (`G01-S02`).
3. Fill actual DEV/TEST/PROD IDs privately; prove sources/connections are disjoint and TEST has no PROD access (`G01-S03`).
4. Review approved test mailbox forwarding/groups/auto-response, Calendar sharing/notifications and indirect integrations (`G01-S04`).
5. Independently verify Europe/London in Sheet, Script, Calendar and AppSheet presentation (`G01-S05`).
6. Export/checksum every current Jotform/Zap/Calendar/Xero/GHL/scaffold producer and record owner/trigger/output/retain/retire/exclusion capability (`G01-S06`).
7. Record actual Workspace/AppSheet entitlement and external-user/connector limitations (`G01-S07`).
8. Repeat negative email and Calendar checks, including mixed recipients, and prove no side effect (`G01-01/02`).
9. Perform one approved synthetic email and Calendar delivery in isolated TEST and capture independent receipt/invitation evidence (`G01-03/04`).
10. With the restricted TEST user in a clean profile, prove direct PROD folder/source/file/AppSheet denial without reading customer data (`G01-05`).
11. Ben opens source and the actual inventory in his own company session and confirms recovery without Lenny (`G01-06/07`).
12. Push/tag the reviewed company source version and assemble the complete evidence pack (`G01-S10`).

G01 passes only when every row has actual result, tester, timestamp, config/version and evidence. A capture log is not delivery proof; sharing settings are not signed-in access proof.

## 8. Exact Jotform work

How Lenny obtains IDs: sign into the company Jotform account; open each form in Form Builder; use its field/properties/source or API/export facility to capture the stable question identifier (`qid`/field name as exported), label and form revision; export the form definition; checksum it; compare a redacted sample payload key set without submitting the live form. Do not infer IDs from labels or synthetic names. Store protected exports outside source control, then enter reviewed IDs in `MappingRules` with a mapping version/effective date.

`NEED_INPUT` below means the actual question ID is unknown. The duplicate key is always `(form_id, submission_id)` in Intake; Booking also requires the human `SS-XXXX-XXXX` sold/job reference for matching.

| source form | question/field | question ID | destination table | destination column | required? | normalization | duplicate key/external ID | status |
|---|---|---|---|---|---|---|---|---|
| Job Sold 260185763834060 | First Name | NEED_INPUT | Customers | first_name | YES | trim | form+submission | NEED_INPUT |
| Job Sold | Last Name | NEED_INPUT | Customers | last_name | YES | trim | form+submission | NEED_INPUT |
| Job Sold | Address Line 1 | NEED_INPUT | Customers | address_line1 | YES | trim | form+submission | NEED_INPUT |
| Job Sold | Address Line 2 | NEED_INPUT | Customers | address_line2 | NO | trim | form+submission | NEED_INPUT |
| Job Sold | Town/City | NEED_INPUT | Customers | town | YES | trim | form+submission | NEED_INPUT |
| Job Sold | Postcode | NEED_INPUT | Customers | postcode | YES | uppercase/text | form+submission | NEED_INPUT |
| Job Sold | Email | NEED_INPUT | Customers | email | Conditional contact rule | lowercase/trim | form+submission | NEED_INPUT |
| Job Sold | Phone | NEED_INPUT | Customers | phone | Conditional contact rule | trim/text | form+submission | NEED_INPUT |
| Job Sold | Lead Source | NEED_INPUT | Jobs | lead_source | NO | trim | form+submission | NEED_INPUT |
| Job Sold | Quote Reference | NEED_INPUT | Jobs | quote_reference | NO | trim/text | retained external ref | NEED_INPUT |
| Job Sold | Finance Route | NEED_INPUT | Jobs | finance_route | YES | reviewed enum | form+submission | NEED_INPUT |
| Job Sold | Roof Required | NEED_INPUT | Jobs | roof_required | Confirm with Tanya | boolean map | form+submission | NEED_INPUT |
| Job Sold | Electrical Required | NEED_INPUT | Jobs | electrical_required | Confirm with Tanya | boolean map | form+submission | NEED_INPUT |
| Job Sold | Scaffold Required | NEED_INPUT | Jobs | scaffold_required | Confirm with Tanya | boolean map | form+submission | NEED_INPUT |
| Job Sold | Contract Value | NEED_INPUT | Jobs | original_gross_pence | Confirm with Ben/Tanya | currency→integer pence; explicit VAT basis | form+submission | NEED_INPUT |
| Job Sold | Valuation Basis | NEED_INPUT | Jobs | valuation_basis | Confirm with Ben | reviewed enum/trim | form+submission | NEED_INPUT |
| Job Booking 250293237424050 | Sold Reference / Job ID | NEED_INPUT | Jobs | job_id (match only) | YES | trim; validate SS-XXXX-XXXX | sold Job ID + form+submission | NEED_INPUT |
| Job Booking | Preferred Install Date | NEED_INPUT | Current synthetic map says Jobs.next_action_at; authoritative model requires WorkPackages date review | NEED_REVIEW | local date, Europe/London | form+submission | NEED_INPUT |
| Job Booking | Booking Notes | NEED_INPUT | Current synthetic map says Jobs.display_name; must not overwrite canonical display name without decision | NEED_REVIEW | trim | form+submission | NEED_INPUT |
| Job Booking | Email | NEED_INPUT | Customers | email | NO/change review | lowercase/trim | form+submission | NEED_INPUT |
| Job Booking | Phone | NEED_INPUT | Customers | phone | NO/change review | trim/text | form+submission | NEED_INPUT |

The two Booking mappings marked `NEED_REVIEW` reveal a genuine mapping risk: dates belong in WorkPackages, and booking notes should not overwrite `Jobs.display_name`. Resolve the target fields through the mapping/config decision before real-form acceptance; do not copy the synthetic fixture blindly.

## 9. Exact AppSheet R1 work

S17 supplies read models, not deployed views. All rows below remain manual AppSheet configuration and test work.

| required view | source/model | view type | intended role | allowed actions | hidden/protected | filters/slices | status / exact work remaining |
|---|---|---|---|---|---|---|---|
| Office Home / Today | `_s17OfficeToday` / Tasks, Issues, health | Dashboard | Tanya/Office; Ben read/escalation | Open task/job, authorized task completion | Admin edits; R2–R4 actions | Active, owner/team, overdue/today/7-day | NOT_CONFIGURED: bind panels and navigation |
| My Tasks | Tasks / today model | Table/deck | All signed-in R1 users | Complete permitted own task with evidence | Reassignment/admin columns | owner=`USEREMAIL()` identity mapping; active statuses | NOT_CONFIGURED |
| Team Tasks | Tasks | Table | Office/Manager | Review/reassign where permission allows | Installer/partner cross-job data | active tasks; role-based scope | NOT_CONFIGURED |
| Job Search | `_s17JobSearch` / Jobs+Customers | Search/table | Office/Manager | Open selected job | Raw payload, finance/audit mutation | authorized R1/Pilot jobs | NOT_CONFIGURED |
| Job Overview | `_s17JobOverview` | Detail/dashboard | Office/Manager; role-limited Ben/Hannah | R1 actions returned available by `_s17ActionAvailability` | FN-02–10/12–13 automated controls; sensitive columns by role | Pilot/authorized scope and row security | NOT_CONFIGURED |
| Booking queue/approval | `_s17OperationalQueue('booking')`, S06 action | Table + grouped detail/action | Tanya/Office | Approve only when gates pass | Direct Jobs edits/bypass | Booking/Prebooking active tasks | NOT_CONFIGURED |
| Calls/issues/remedials | queues + Calls/Issues | Table/detail/form | Tanya; Hannah for variations | Record attempt/outcome, raise/resolve within permission | Closed-history edits, unrelated jobs | open/Waiting with next follow-up; role scope | NOT_CONFIGURED |
| Cancellation/reinstatement | cancellation queue + S15 actions | Detail/action | Tanya/Office; approval per rules | Preview/confirm cancel; controlled reinstate | One-click/direct row edits; R2–R4 external automation | eligible state + FN-01/FN-17 + Pilot | NOT_CONFIGURED |
| Operational queues | `_s17OperationalQueue` | Menu/table | Office | R1 booking, calls, issues, payments, GHL, cancellation; retained-route tasks | Materials/scaffold automation, commissioning, archive actions | release/role/status filters | NOT_CONFIGURED |
| ReleaseMode status | `_s17AdminReleaseModes` | Read-only table | Admin/Manager | View only | All inline edits | all 20, prominently show disabled/deferred | NOT_CONFIGURED |
| System Status | `_s17AdminSystemStatus` | Read-only dashboard | Tanya/Ben/Admin | View/escalate | Mutating health/outbox/journal | latest checks, stalled/uncertain/not-configured | NOT_CONFIGURED |
| Audit History | `_s17AuditHistory` | Read-only chronological table | Authorized Office/Manager | View evidence | Edit/delete/export beyond role | selected authorized job | NOT_CONFIGURED |
| Action Availability | `_s17ActionAvailability`, `_s17TaskActionAvailability` | Inline/virtual-state controls | Per role | Show only server-authorized actions | Hidden button must not replace server authorization | job state, role, mode and Pilot scope | NOT_CONFIGURED |

Required security: Google sign-in, People/PersonRoles identity, server-side permission/mode checks, table/file security filters, no direct editing of authoritative logs/finance/config, and explicit denial tests. Slices and hidden menus alone are insufficient.

## 10. Exact migration preparation

R1 covers seven S19 domains: Jobs, Customers, Tasks, Booking state, Planner/install dates, Calls/Issues and Cancellation state. A bounded pilot may migrate only the explicitly approved jobs, but every open obligation for those jobs must migrate or remain as a visible owned manual action.

1. Tanya and Ben select representative open jobs only after Pilot criteria are agreed. Avoid bulk historical migration for the first pilot.
2. Export authoritative source rows at a recorded cut-off; retain protected originals/checksums. Include job/customer identity, stage, dates/packages, task owner/due/status/evidence, call/issue follow-up, cancellation state and all external references.
3. Create a crosswalk from source record to immutable `Jobs.id` and displayed `job_id`. Retain a valid existing SS reference when uniquely authoritative; otherwise generate once through the canonical generator. Never use row numbers.
4. Preserve Jotform submission IDs, Calendar event links, invoice/order/scaffold/form/file references and current revisions as text. Do not recreate or resend them.
5. Reconcile counts and field totals per domain; log conflicts rather than choosing silently. Tanya owns business reconciliation; Lenny owns import mechanics; Ben approves exceptions/scope.
6. Prove idempotent rerun and that non-pilot jobs keep their current route.
7. Creator rule: old producer remains active during preparation while new production creator stays disabled. At a future authorized cutover, freeze/exclude old creator for approved scope, verify it stopped, then activate new FN-01 Pilot scope. Never dual-write.
8. Fallback preserves imported records/history/external IDs, disables the new creator, resumes owned manual work and requires new authorization.

## 11. Exact 15-module R1 training plan

All canonical S19 modules are currently `NOT_RUN`.

| module ID | role | topic | rehearsal | evidence required | prerequisites | current status |
|---|---|---|---|---|---|---|
| TRN-R1-01 | Tanya | Office Home / Today | Open dashboard; identify 3 overdue tasks | Screen recording plus correct explanation | AppSheet Home configured | NOT_RUN |
| TRN-R1-02 | Tanya | Job search and detail | Search and verify 12 job sections | Recording/screenshots and correct job | Search/detail configured | NOT_RUN |
| TRN-R1-03 | Tanya | Task completion | Complete synthetic task; check history | Completed Task, version, Task/Audit events | Processor/action configured | NOT_RUN |
| TRN-R1-04 | Tanya | Booking approval | Approve synthetic booking | Gate result and stage/audit evidence | Intake and Booking UI | NOT_RUN |
| TRN-R1-05 | Tanya | Daily health check (SYS01) | Execute SYS01 and triage alerts | Completed SYS01 with assigned follow-up | Health/last-success configured | NOT_RUN |
| TRN-R1-06 | Tanya | Cancellation workflow | Cancel then reinstate synthetic job | Full cancellation/reinstatement history | S15 UI/action configured | NOT_RUN |
| TRN-R1-07 | Tanya | Safety: Job ID usage | Distinguish internal and displayed IDs | Correct reference demonstration | Job UI | NOT_RUN |
| TRN-R1-08 | Tanya | Safety: ReleaseModes | Explain Disabled/Manual/Automated and Pilot | Recorded walkthrough/answers | Admin status view | NOT_RUN |
| TRN-R1-09 | Tanya | Safety: recovery/health | Identify degraded health state | Correct escalation/manual route | Health rehearsal | NOT_RUN |
| TRN-R1-10 | Ben | Deposit confirmation | Confirm synthetic deposit | Actor/time/reference and stage evidence | Ben account; FN-15 test mode | NOT_RUN |
| TRN-R1-11 | Ben | Backup review | Review latest manifest/checksum | Signed review with exceptions | Verified backup/restore | NOT_RUN |
| TRN-R1-12 | Ben | Release decision | Review S18 matrix and Pilot criteria | Written accept/reject exercise | Draft release record | NOT_RUN |
| TRN-R1-13 | Ben | Safety: escalation | Diagnose duplicate/uncertain/recovery case | Correct escalation/fallback decision | Health/outbox demo | NOT_RUN |
| TRN-R1-14 | Hannah | Issues and variations | Raise/link synthetic variation issue | Issue/audit linkage | Hannah account/role | NOT_RUN |
| TRN-R1-15 | Hannah | Phoenix evidence (future R4 context) | Review current R1 manual evidence route and future boundary | Acknowledgement of R1 duties; no automation claim | Current route documented | NOT_RUN |

Minimum sequence: Tanya 01–04 → 07–09 → 05–06; Ben 10–13 after backup is available; Hannah 14–15 after her role and retained route are documented. Training is complete only when each rehearsal evidence passes, not merely when a session occurs.

## 12. One exact R1 rehearsal

Use DEV/TEST, synthetic identities/data and capture-only/stub adapters. Keep all PROD and external transports unavailable.

1. Verify exact DEV/TEST guard, all R1 modes at the rehearsal state only, later modes disabled, and record starting row counts.
2. Feed a synthetic Sold payload through the real mapped intake path; verify raw payload/hash, one Customer, one Job, stable internal/display IDs and Pilot scope.
3. Replay it identically, then with conflicting content; prove one Job and visible conflict handling. Feed a non-pilot Booking and prove it cannot trigger operational actions.
4. Feed the matching Booking; verify the same Job, customer-change review and grouped booking gates/tasks. Approve through authenticated action.
5. Verify My/Team Tasks, due rules/history and three-/six-week planning. Create roof/electrical packages, multi-day work, move one trade, replace one installer and add another. Confirm retained Calendar actions only—no event call.
6. Record installer/customer call attempts including NoAnswer/next follow-up; raise an issue/remedial/complaint and a Hannah variation notification. Prove unresolved work blocks completion.
7. Record missing→received→accepted current-process evidence with package/file/reviewer/outcome. Exercise two-working-day missing-form reminder as Tanya's manual action.
8. Standard finance branch: Ben records synthetic bank confirmation; verify deposit/interim/balance and Friday chase tasks through retained route. Phoenix branch: Hannah's manual evidence task. Prove no Xero/Phoenix/GHL API call.
9. Resolve required work/evidence/customer/blockers and approve operational completion. Verify human GHL task stays pending until invoice/evidence prerequisites and captures manual proof.
10. On a separate synthetic job, run cancellation after simulated external commitments; verify latest merchant/scaffold/Calendar/finance/Signable/GHL/Phoenix/customer/installer actions, safe strip, no hidden complaint and same Job ID on reinstatement.
11. Interrupt a commit and introduce an uncertain outbox result; verify RecoveryRequired/review visibility, named manual follow-up and no blind retry. Tanya runs SYS01.
12. Run backup manifest/validation and isolated restore plan/rehearsal; prove counts/checksum/IDs/history and no outbound effects.
13. Repeat relevant operations to prove idempotency, then run role/direct-link denial checks and capture final counts.

PASS requires: one authoritative Job per Sold submission; Booking matches exactly; no duplicate task/send/event/invoice; every obligation has owner/due/evidence/follow-up; versions/history survive; non-pilot and later functions are denied; completion gates hold; cancellation/reinstatement preserves history; recovery/uncertain outcomes are visible; backup restores in isolation; every expected role boundary passes; zero real external effects; and no unresolved critical security, lost-data, false-completion, duplicate-action or financial discrepancy defect.

Retain release/config/source versions, input hashes, record IDs, screenshots/logs, before/after counts, test identities, timestamps, defects/retests and a signed rehearsal result.

## 13. Pilot decisions still required

Ben must decide, not Lenny:

- The smallest number and type of open jobs, with explicit IDs and exclusion criteria.
- Pilot users and backups (normally Tanya, Ben and Hannah only for their duties).
- Exact approved modes: FN-01 Automated/Pilot; whether/when FN-14 is Automated/Pilot; FN-11 and FN-15–FN-20 Manual/Pilot; all R2–R4 automated functions disabled.
- Whether each retained external route can exclude Pilot jobs or must remain a manual task/whole-function boundary.
- Pilot start window, observation duration and support coverage.
- Daily review cadence and required first-job/normal/move/cancellation evidence.
- Success thresholds and explicit stop triggers (identity/security, duplicate creator/action, lost history, recovery/outbox uncertainty, failed health/backup, incorrect completion or financial state).
- Fallback owner, manual continuation route and decision authority for restart.

## 14. Deferred items that do not block R1

- R2: automated orders/merchant messages (FN-03), stock/picking/stocktakes (FN-05), integrated scaffolding (FN-04), Calendar adapter (FN-02), R2 merchant/scaffolder contacts and R2 live workflow tests. R1 still needs owned manual tasks and verified current routes.
- R3: installer AppSheet/forms, commissioning templates/submission automation (FN-06/07), automated handover (FN-08), commissioning amendment and installer device/offline training. R1 still needs accepted current-form evidence tracking.
- R4: automated Xero/payment adapter (FN-09), accounting/reporting (FN-12), Phoenix automation/configuration (FN-10), archive automation (FN-13), opening balances and finance/archive tests. R1 retains existing invoice/Phoenix work as manual tasks.
- GHL API automation/pipeline integration is not an R1 requirement: human GHL progression/cancellation with recorded outcome is. Actual job/opportunity reference may still be needed to perform and evidence the human task.
- A destructive production restore is not required. A demonstrated, controlled restore into isolation plus safe reconciliation is required before R1.

## 15. Condition before rerunning S18 → S19 → S20

Do not rerun merely because code passes locally. First require:

- G01 evidence complete; real R1 accounts/roles and AppSheet access/denial verified.
- Exact Jotform mappings approved and Sold/Booking isolated acceptance passed.
- R1 AppSheet views/actions configured and tested.
- Settings/holidays and retained manual routes/owners approved.
- Real backup destination, validated backup and isolated restore/recovery evidence complete.
- Task version/history evidence present; health/manual fallback rehearsed.
- All seven R1 migration domains scoped and rehearsed with no replay.
- All 15 R1 training modules passed.
- End-to-end R1 rehearsal passed and critical defects closed.
- Pilot jobs/users/functions/modes/period/criteria and fallback approved.
- Candidate version/config frozen; exact modes verified Disabled/None; creator freeze/stop verification prepared; production config references validated.

Then run S18 twice and require R1 `READY_FOR_CONTROLLED_PILOT`; run corrected S19 and require R1 `READY_FOR_S20` with no blocked/not-run/failed preparation; run S20 and require R1 `AUTHORIZED_FOR_CUTOVER`. Only then may Ben consider the separate production release decision. Actual cutover still needs explicit production authority and is not part of this document.

## 16. Software defects discovered

1. **S18 BLK-01 over-scopes R1.** It requires real GHL pipeline/stage IDs, conflicting with RA01's explicit human-GHL route for every release. R1 should test the configured manual task, prerequisites, reference/evidence and deduplication; API automation must not block R1.
2. **S18 BKP-04 is misnamed and over-prescriptive.** It says “Destructive restore procedure.” Authority requires a demonstrated restore/recovery without destructive production rollback. The gate should require a verified isolated restore plus reconciliation/safety evidence.
3. **S18 MAN-13 assigns restore rehearsal only to R4 while BKP-04 blocks every release.** RA01 makes demonstrated restore an R1 foundation; the manual evidence belongs in R1 (and regresses later).
4. **S20 R1 `ghl_configuration` is ambiguous.** It must be satisfiable by the approved human/manual GHL route, not silently interpreted as API credentials or pipeline automation.
5. **Synthetic Booking mapping risks wrong authoritative targets.** `booking_install_date → Jobs.next_action_at` conflicts with WorkPackages as date master, and `booking_notes → Jobs.display_name` risks overwriting canonical display identity. Real mappings require corrected target decisions before acceptance.

No code was changed in this audit. These should receive minimal, separately tested corrections before the final gate rerun; current R1 remains blocked meanwhile.
