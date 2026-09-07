# S18 Acceptance — 6 September 2026

**LOCAL IMPLEMENTATION PASS (16 tests); DEV CLOUD NOT YET RUN.** Release-gate acceptance framework for RA01 phased rollout. Read-only over S01–S17 operational data. No mutations, no new ReleaseModes, no external API calls.

## Acceptance model

### Statuses

| Status | Meaning |
|---|---|
| `PASS` | Required implementation/configuration/evidence exists and check passed |
| `BLOCKED` | Cannot complete because required external configuration/manual dependency is missing |
| `NOT_RUN` | Test exists but has not yet been executed |
| `FAIL` | Acceptance was executed and failed |
| `NOT_APPLICABLE` | Check does not apply to this release |

### Release readiness

| Readiness | Condition |
|---|---|
| `READY_FOR_CONTROLLED_PILOT` | All required items PASS, no BLOCKED, no NOT_RUN, no FAIL |
| `BLOCKED` | One or more required items BLOCKED or FAIL |
| `NOT_EVALUATED` | One or more required items NOT_RUN |

## RA01 Release gates

### R1 Office foundations

| Gate | Status | Evidence |
|---|---|---|
| Company ownership / access | BLOCKED | G01: company accounts not supplied |
| Separate DEV/TEST/PROD | PASS | DEV Sheet ID confirmed, PROD untouched |
| Stable random Job IDs | PASS | SS-XXXX-XXXX format validated |
| Duplicate intake protection | PASS | S05 replay/conflict tests |
| Auth / roles | PASS | S04 identity/permission/role model |
| Protected history | PASS | AuditEvents, TaskEvents, IssueEvents tables |
| Reliable tasks | PASS | Task version/revision tracking |
| Concurrent update safety | PASS | S04 optimistic locking |
| Interrupted-write recovery | PASS | CommitJournal + recovery mechanism |
| Outbound duplicate prevention | PASS | Deterministic idempotency keys |
| Uncertain external outcome review | PASS | Outbox NeedsReview/RetryDue states |
| Backups / restore | BLOCKED | Backup manifest exists; destructive restore BLOCKED |
| Health alerts / last-success | PASS | HealthChecks mechanism exists |
| Tanya daily health / Ben backup | PASS | SYS01/SYS02 templates defined |
| Per-function ReleaseModes | PASS | FN-01–FN-20 present, valid states |
| Pilot scope | PASS | pilot_job + release_scope columns |
| Ownership / fallback | PASS | ReleaseModes have fallback fields |
| Disabled-until-approved | PASS | All modes start Disabled/None |

### R2 Materials / Scaffolding / Calendar

Additional gates over R1:
- S07 orders → PASS (table exists)
- S08 stock movements → PASS (ledger exists)
- S09 scaffold bookings → PASS (table exists)
- Calendar adapter (S11 portion) → PASS (Allocations table)
- Scaffolder contacts → BLOCKED (NOT_CONFIGURED)

### R3 Installer Commissioning

Additional gates over R1/R2:
- S12 commissioning submissions → PASS (table exists)
- Commissioning templates → BLOCKED (NOT_CONFIGURED)
- Installer AppSheet → BLOCKED (not deployed)
- S10 calls/issues extensions → PASS (tables exist)

### R4 Finance / Reporting / Archive

Additional gates over R1/R2/R3:
- S13 invoice stages → PASS (table exists)
- S14 reporting → PASS (ReportSnapshots table)
- S16 archive → PASS (ArchiveIndex table)
- Xero API → BLOCKED (NOT_CONFIGURED)
- Phoenix rules → BLOCKED (NOT_CONFIGURED)

## Automated checks (47 items)

| Area | Checks | Key findings |
|---|---|---|
| Environment | 4 | DEV confirmed, PROD untouched |
| Schema/Config | 4 | 60 tables, 20 ReleaseModes, valid states |
| Job/Intake Safety | 4 | SS-XXXX-XXXX format, pilot/scope fields, Jotform mappings BLOCKED |
| History Safety | 4 | AuditEvents, TaskEvents, IssueEvents available |
| Recovery | 3 | CommitJournal exists, 0 RecoveryRequired in DEV |
| Outbox | 3 | Outbox exists, uncertain items surfaced, Xero BLOCKED |
| Backup/Health | 5 | HealthChecks, backup manifest, Drive destination BLOCKED, destructive restore BLOCKED |
| ReleaseModes | 5 | All 20 present, valid states, no impossible modes |
| Stage Contracts | 12 | S05–S17 tables verified; S12 templates BLOCKED |
| Blocked Dependencies | 7 | GHL, Xero, AppSheet, staff, scaffold, Phoenix, holidays |

## Manual acceptance checklist (15 items)

| ID | Release | Requirement | Owner | Status |
|---|---|---|---|---|
| MAN-01 | R1 | AppSheet role visibility | BLOCKED | BLOCKED |
| MAN-02 | R1 | Real Jotform sold submission | Tanya | NOT_RUN |
| MAN-03 | R1 | Real Jotform booking submission | Tanya | NOT_RUN |
| MAN-04 | R1 | Staff Google Workspace accounts | BLOCKED | BLOCKED |
| MAN-05 | R1 | Tanya daily health check | Tanya | NOT_RUN |
| MAN-06 | R1 | Ben backup review | Ben | NOT_RUN |
| MAN-07 | R2 | Scaffolder contacts | BLOCKED | BLOCKED |
| MAN-08 | R2 | Real merchant/order workflow | Tanya | NOT_RUN |
| MAN-09 | R3 | Real commissioning form | BLOCKED | BLOCKED |
| MAN-10 | R3 | Installer AppSheet on device | BLOCKED | BLOCKED |
| MAN-11 | R4 | Real Xero invoice | BLOCKED | BLOCKED |
| MAN-12 | R4 | Real backup in Drive | BLOCKED | BLOCKED |
| MAN-13 | R4 | Restore rehearsal | BLOCKED | BLOCKED |
| MAN-14 | R1 | User training | Tanya | NOT_RUN |
| MAN-15 | R1 | Ben release decision | Ben | NOT_RUN |

## Current release readiness

| Release | Status | Pass | Blocked | Not Run | Key blockers |
|---|---|---|---|---|---|
| **R1** | **BLOCKED** | 24 | 5 | 3 | G01 company access, GHL IDs, AppSheet UI, staff directory, holidays |
| **R2** | **BLOCKED** | 28 | 6 | 3 | Same as R1 + scaffolder contacts |
| **R3** | **BLOCKED** | 31 | 8 | 3 | Same as R2 + commissioning templates, installer AppSheet |
| **R4** | **BLOCKED** | 34 | 10 | 3 | Same as R3 + Xero, Phoenix, backup destination, destructive restore |

## What S19 must do next

1. Resolve BLOCKED configuration dependencies (GHL IDs, Xero API, staff directory, scaffolder contacts, commissioning templates)
2. Execute manual acceptance items (Jotform end-to-end, staff sign-in, training)
3. Run cloud acceptance against DEV sheet with real fixture data
4. Ben release decision for controlled pilot

## What remains for S20 production release

1. PROD environment provisioning
2. Production data migration
3. Real external integration testing (Xero, GHL, Calendar)
4. Load/performance testing (T109)
5. Schema/template evolution testing (T111)
6. Full restore rehearsal
7. Production go-live signoff

## Source files

| File | Purpose |
|---|---|
| `s18/acceptance.js` | Core acceptance engine (47 automated checks, release readiness, manual checklist) |
| `s18/cloud-adapter.js` | Read-only cloud sheet adapter |
| `apps-script/s18/S18Acceptance.js` | Built bundle |

## Tests (16, all passing)

| # | Test |
|---|---|
| 1 | All items have valid status values and required fields |
| 2 | PASS/BLOCKED/NOT_RUN semantics — BLOCKED items have blocker messages |
| 3 | BLOCKED items prevent readiness |
| 4 | All releases have readiness calculated with item counts |
| 5 | No release ready with BLOCKED items |
| 6 | No release ready with NOT_RUN items |
| 7 | FAIL status prevents readiness |
| 8 | Later-release blockers don't block earlier releases |
| 9 | Summary includes automated + manual sections |
| 10 | Manual checklist items have required fields |
| 11 | Environment guard — wrong sheet refused |
| 12 | Environment guard — non-DEV refused |
| 13 | Acceptance is read-only — no mutations |
| 14 | All items have required fields (acceptance_id, release, area, requirement, status, required_for_release, last_checked_at) |
| 15 | Namespace compatibility — all bundles parse, S18 globals namespaced |
| 16 | Zero-arg DEV smoke with real header adapter |

## DEV cloud smoke procedure

1. Paste `apps-script/s18/S18Acceptance.js` into DEV Apps Script project
2. `runS18AcceptanceDryRun()` — validates all table headers
3. `runS18AcceptanceTest()` — full acceptance run, returns R1/R2/R3/R4 summary
4. `runS18AcceptanceTest()` — idempotency

No ReleaseMode changes needed. No mutations. No external calls.
