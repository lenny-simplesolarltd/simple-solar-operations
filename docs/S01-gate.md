# S01 gate — G01

S01 status: **PARTIAL**. G01: **BLOCKED**. S02 is COMPLETE IN DEV; see [current status](implementation-status.md). This does not close G01.

Authority: document 04 S01, with B01/ownership/security and evidence rules from documents 01–03. G01-01…07 expand the explicit immediate checks; G01-S01…S11 report supporting S01 completion conditions individually. These suffixes are local tracking IDs, not extra numbered cases from the source workbook.

Every BLOCKED row is **BLOCKED — INPUT REQUIRED**: owners/inputs are assigned in the audit and manual setup. Nothing is marked FAIL without an observed failure. Only A1/A2 CAPTURE and B1 refusal cloud probes are reported PASS; remaining checks are NOT RUN / BLOCKED. Local PASS applies only to its stated component/deliverable, never the full connector or access gate.

| ID | Requirement | Status | Actual result | Evidence required / available | Next action |
|---|---|---|---|---|---|
| G01-01 | Email outside allowlist refused | BLOCKED | B1 DEV unapproved email refusal PASS per user; full G01 evidence pack incomplete | User report in implementation-status.md; execution/config and no-send evidence still required | Manual steps 7–9 |
| G01-02 | Calendar invitation outside allowlist refused | BLOCKED | Local refusal covered; deployed connector not executed | Test project/config, rejection log and no event/invite | Manual steps 7–9 |
| G01-03 | Approved test email received | BLOCKED | A1 approved DEV email CAPTURE PASS; delivery/receipt NOT RUN | Execution/probe label and recipient receipt/time | Manual step 10 |
| G01-04 | Approved test Calendar invitation received | BLOCKED | A2 approved DEV calendar CAPTURE PASS; invitation/receipt NOT RUN | Event ID/details plus recipient invitation receipt/time | Manual step 10 |
| G01-05 | Test user denied production data folder/access | BLOCKED | No verified test user or protected production folder reference | Direct-link denial under actual test identity; source/ACL review | Manual steps 4–5,11 |
| G01-06 | Ben company account accesses source repository | BLOCKED | Company repository created at https://github.com/lenny-simplesolarltd/simple-solar-operations.git (initial commit 8cf11c8). Currently controlled via Simple Solar developer GitHub identity. Ben's company account access and company ownership/recovery evidence outstanding. | Ben signed-in access and company ownership/recovery evidence | Manual steps 1–2,12 |
| G01-07 | Ben company account accesses system/integration inventory | BLOCKED | Local template is not verified company inventory access | Ben signed-in access to actual company inventory | Manual steps 2,6,12 |
| G01-S01 | Licensed company automation identity, MFA, named developer least privilege | BLOCKED | Accounts/grants unknown | Ownership register, licence/MFA/access evidence | Manual step 1 |
| G01-S02 | Company folder, Apps Script/AppSheet ownership and recovery/backups | BLOCKED | Company Shared Drive "Simple Solar Operations System" created; Ben and developer are members. DEV/TEST/PROD/Documentation/Test Evidence/Integration Exports/Backups folders exist. DEV and TEST AppSheet shells created under company account. DEV bound Apps Script project exists and S02 cloud validation passed; TEST script status unverified; company ownership/recovery verification outstanding. | Actual owners/recovery/backup contacts and access evidence | Manual steps 1–4 |
| G01-S03 | Distinct DEV/TEST Sheets, Drive, calendars, app sources and protected PROD config | BLOCKED | DEV and TEST Sheets and Calendars created in Shared Drive. DEV and TEST AppSheet shells created with synthetic S01_Setup placeholder originally; DEV now has 60 canonical S02 tabs, TEST status unchanged/unverified. PROD untouched. Full ID/ACL verification and disjoint-source proof outstanding. | Environment register with private IDs and disjoint-source/access verification | Manual steps 3–5 |
| G01-S04 | Verified synthetic-only test users/inboxes and no indirect production destinations | BLOCKED | Approved test email: lenny@simplesolarltd.co.uk. Forwarding/routing check not yet performed — do not assume safe until verified. DEV calendar was allowlisted for A2 CAPTURE; independent access/routing checks remain outstanding. | Mailbox/calendar forwarding/notification/access review | Manual step 5 |
| G01-S05 | Europe/London configured on cloud resources | BLOCKED | Manifest/template set; Sheets/Calendars created but timezone settings not independently verified | Sheets/Script/Calendar/AppSheet timezone evidence | Manual steps 3–4 |
| G01-S06 | Current producer inventory complete, settings exported, retain/retire decisions recorded | BLOCKED | Discovery placeholders only; no live inspection or exports | Per-instance inventory and protected checksummed exports; Ben decisions | Manual step 6 |
| G01-S07 | Workspace/AppSheet partner entitlements and connector limitations verified | BLOCKED | AppSheet access confirmed via lenny@simplesolarltd.co.uk. Plan/partner entitlement and external test account access not yet verified. | Operation/plan evidence and agreed unsupported-operation paths | Manual step 4; entitlement register |
| G01-S08 | Test/defect registers, fixture reset and local evidence location established | PASS | Repository files created and inspected | tests/test-register.csv; tests/defects.csv; fixtures/README.md; docs/evidence/README.md | Company evidence storage still covered by G01-S02 |
| G01-S09 | Local outbound safety components executed with evidence | PASS | 16 local tests passed; no remote services called | docs/evidence/S01-local-tests.tap; S01-local-run.json; S01-source-version.json | Never substitutes for G01-01 through G01-05 |
| G01-S10 | Initial company repository version and complete G01 evidence pack | BLOCKED | Initial company commit 8cf11c8 (43 files, main) made locally. Push to remote pending. Full G01 evidence pack not yet assembled. | Company commit/tag plus all required G01 evidence links | Manual step 13 |
| G01-S11 | No production automation changed | PASS | User reports PROD untouched; DEV S02 provisioned and validated | Historical S01 snapshot plus S02 cloud evidence; no PROD deployment claimed | Keep all production producers unchanged |

No G01 integration pass is claimed. See `S01-manual-setup.md` for exact actions and `S01-audit.md` for input owners. Ben/company administrator supplies accounts/resources/recipients; developer and named tester execute and record; Ben verifies his own company access. Keep new probes disabled except during the isolated test session. Do not fix a failed denial check by modifying production permissions without separate authorisation.

Developer verification may close S01 only when all rows pass with appropriate evidence. The local evidence snapshot is not a company release tag. S02 is COMPLETE IN DEV; G01 remains BLOCKED. Under authoritative RA01, S18/S19/S20 repeat per release and each R?-S20 requires Ben's recorded decision; completing all modules before the first live release is no longer required. This changes no G01 status. See [release plan](release-plan.md).

## AppSheet blank-sheet determination (2026-09-05)

AppSheet returned HTTP 400 when creating an app from the blank DEV Sheet. AppSheet requires at least one table with columns to accept a Sheet as a source.

Per `S01-manual-setup.md` step 4: *"using only the corresponding synthetic setup Sheet if a source is required to create the app."* Per step 3: *"Create no business tables yet. Only synthetic setup data is permitted."*

**Determination**: A single synthetic placeholder column (`S01_Setup`) in the DEV Sheet is an S01 tooling accommodation — the minimum AppSheet requires to create an app shell. It is not S02 business schema design (`S01-audit.md`: no S02 "tables/keys/directory seeding, F0 business loader"). A real business table with domain field names, data types, keys or relationships would cross into S02.

DEV and TEST AppSheet shells created using this placeholder. DEV placeholder has since been replaced by the 60-table S02 schema; no new TEST evidence supplied.
