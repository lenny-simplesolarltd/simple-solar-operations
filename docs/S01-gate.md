# S01 gate — G01

S01 status: **PARTIAL**. G01: **BLOCKED**. Not ready for S02.

Authority: document 04 S01, with B01/ownership/security and evidence rules from documents 01–03. G01-01…07 expand the explicit immediate checks; G01-S01…S11 report supporting S01 completion conditions individually. These suffixes are local tracking IDs, not extra numbered cases from the source workbook.

Every BLOCKED row is **BLOCKED — INPUT REQUIRED**: owners/inputs are assigned in the audit and manual setup. Nothing is marked FAIL without an observed failure. The real cloud checks have not run. Local PASS applies only to its stated component/deliverable, never the full connector or access gate.

| ID | Requirement | Status | Actual result | Evidence required / available | Next action |
|---|---|---|---|---|---|
| G01-01 | Email outside allowlist refused | BLOCKED | Local refusal covered; deployed connector not executed | Test project/config, rejection log and absence of send | Manual steps 7–9 |
| G01-02 | Calendar invitation outside allowlist refused | BLOCKED | Local refusal covered; deployed connector not executed | Test project/config, rejection log and no event/invite | Manual steps 7–9 |
| G01-03 | Approved test email received | BLOCKED | No real test inbox supplied or send attempted | Execution/probe label and recipient receipt/time | Manual step 10 |
| G01-04 | Approved test Calendar invitation received | BLOCKED | No test calendar/inbox supplied or invite attempted | Event ID/details plus recipient invitation receipt/time | Manual step 10 |
| G01-05 | Test user denied production data folder/access | BLOCKED | No verified test user or protected production folder reference | Direct-link denial under actual test identity; source/ACL review | Manual steps 4–5,11 |
| G01-06 | Ben company account accesses source repository | BLOCKED | Company repository and Ben account not supplied | Ben signed-in access and company ownership/recovery evidence | Manual steps 1–2,12 |
| G01-07 | Ben company account accesses system/integration inventory | BLOCKED | Local template is not verified company inventory access | Ben signed-in access to actual company inventory | Manual steps 2,6,12 |
| G01-S01 | Licensed company automation identity, MFA, named developer least privilege | BLOCKED | Accounts/grants unknown | Ownership register, licence/MFA/access evidence | Manual step 1 |
| G01-S02 | Company folder, Apps Script/AppSheet ownership and recovery/backups | BLOCKED | Company Shared Drive "Simple Solar Operations System" created; Ben and developer are members. DEV/TEST/PROD/Documentation/Test Evidence/Integration Exports/Backups folders exist. Apps Script projects and AppSheet ownership verification still outstanding. | Actual owners/recovery/backup contacts and access evidence | Manual steps 1–4 |
| G01-S03 | Distinct DEV/TEST Sheets, Drive, calendars, app sources and protected PROD config | BLOCKED | DEV and TEST Sheets and Calendars created in Shared Drive. DEV AppSheet shell pending — requires minimal synthetic placeholder column in DEV Sheet (S01 tooling accommodation, not S02 business schema). TEST AppSheet shell not yet created. Full ID/ACL verification and disjoint-source proof outstanding. | Environment register with private IDs and disjoint-source/access verification | Manual steps 3–5 |
| G01-S04 | Verified synthetic-only test users/inboxes and no indirect production destinations | BLOCKED | Local synthetic fixtures exist; actual test inbox/calendar identities not yet approved | Mailbox/calendar forwarding/notification/access review | Manual step 5 |
| G01-S05 | Europe/London configured on cloud resources | BLOCKED | Manifest/template set; Sheets/Calendars created but timezone settings not independently verified | Sheets/Script/Calendar/AppSheet timezone evidence | Manual steps 3–4 |
| G01-S06 | Current producer inventory complete, settings exported, retain/retire decisions recorded | BLOCKED | Discovery placeholders only; no live inspection or exports | Per-instance inventory and protected checksummed exports; Ben decisions | Manual step 6 |
| G01-S07 | Workspace/AppSheet partner entitlements and connector limitations verified | BLOCKED | AppSheet access confirmed via lenny@simplesolarltd.co.uk. Plan/partner entitlement and external test account access not yet verified. | Operation/plan evidence and agreed unsupported-operation paths | Manual step 4; entitlement register |
| G01-S08 | Test/defect registers, fixture reset and local evidence location established | PASS | Repository files created and inspected | tests/test-register.csv; tests/defects.csv; fixtures/README.md; docs/evidence/README.md | Company evidence storage still covered by G01-S02 |
| G01-S09 | Local outbound safety components executed with evidence | PASS | 16 local tests passed; no remote services called | docs/evidence/S01-local-tests.tap; S01-local-run.json; S01-source-version.json | Never substitutes for G01-01 through G01-05 |
| G01-S10 | Initial company repository version and complete G01 evidence pack | BLOCKED | Local hashed snapshot only; no company commit/tag or integration evidence | Company commit/tag plus all required G01 evidence links | Manual step 13 |
| G01-S11 | No live automation changed; no S02 implementation | PASS | Only new local S01 files; no cloud mutation calls executed | Local source snapshot and session activity; no cloud deployment performed | Keep all production producers unchanged |

No G01 integration pass is claimed. See `S01-manual-setup.md` for exact actions and `S01-audit.md` for input owners. Ben/company administrator supplies accounts/resources/recipients; developer and named tester execute and record; Ben verifies his own company access. Keep new probes disabled except during the isolated test session. Do not fix a failed denial check by modifying production permissions without separate authorisation.

Developer verification may close S01 only when all rows pass with appropriate evidence. The local evidence snapshot is not a company release tag. S02 remains unstarted. Under authoritative RA01, S18/S19/S20 repeat per release and each R?-S20 requires Ben's recorded decision; completing all modules before the first live release is no longer required. This changes no G01 status. See [release plan](release-plan.md).

## AppSheet blank-sheet determination (2026-09-05)

AppSheet returned HTTP 400 when creating an app from the blank DEV Sheet. AppSheet requires at least one table with columns to accept a Sheet as a source.

Per `S01-manual-setup.md` step 4: *"using only the corresponding synthetic setup Sheet if a source is required to create the app."* Per step 3: *"Create no business tables yet. Only synthetic setup data is permitted."*

**Determination**: A single synthetic placeholder column (e.g. `S01_Setup`) in the DEV Sheet is an S01 tooling accommodation — the minimum AppSheet requires to create an app shell. It is not S02 business schema design (`S01-audit.md`: no S02 "tables/keys/directory seeding, F0 business loader"). A real business table with domain field names, data types, keys or relationships would cross into S02.

This placeholder should be added to the DEV Sheet, the app shell created, and then the placeholder removed before S02 schema design begins. TEST follows the same pattern.
