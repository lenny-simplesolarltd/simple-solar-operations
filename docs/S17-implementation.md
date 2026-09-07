# S17 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (20 tests); DEV CLOUD NOT YET RUN.** Finished screens/admin read models for the AppSheet staff UI. Purely read-only over S01–S16 operational data. No new mutations, no new ReleaseModes, no external API calls.

## Authoritative tables (consumed)

| Table | S17 role |
|---|---|
| `Jobs` | Identity, workflow stage, booking, work requirements, cancellation, archive |
| `Customers` | Search by name, postcode, email, phone |
| `Tasks` | Office home (overdue/today/soon), operational queues, booking review |
| `WorkPackages` | Job overview — trade, status, dates, commissioning |
| `Allocations` | Job overview — installer assignments |
| `Materials` | Job overview — requirements, quantities |
| `Reservations` | Job overview — active reservations |
| `Orders` | Job overview — order status, merchant |
| `ScaffoldBookings` | Job overview — erect/strip state |
| `CommissioningSubmissions` | Job overview — submissions, review state |
| `JobEquipment` | Job overview — equipment count |
| `Handover` | Job overview — sent/approved state |
| `InvoiceStages` | Job overview — deposit/interim/final stages, amounts |
| `Payments` | Job overview — paid amounts |
| `GHLTasks` | Job overview — CRM progression |
| `Issues` | Office home — unresolved count; job overview |
| `Calls` | Job overview — call count |
| `CommitJournal` | Office home — health alerts; admin system status |
| `Outbox` | Office home — health alerts; admin system status; job overview |
| `HealthChecks` | Admin system status — latest check |
| `AuditEvents` | Audit history — chronological events |
| `TaskEvents` | Audit history — task events |
| `IssueEvents` | Audit history — issue events |
| `ReleaseModes` | Admin status; action availability gating |
| `Settings` | Admin status — NOT_CONFIGURED detection |
| `ReportSnapshots` | Admin status — backup destination check |
| `CommissioningTemplates` | Admin status — commissioning form check |
| `Companies` | Admin status — scaffolder contact check |
| `Contacts` | Admin status — scaffolder contact check |
| `TaskTemplates` | Shared canonical SYS01/SYS02 reuse |

## ReleaseModes

**No dedicated S17 ReleaseMode.** S17 is purely read-only over existing operational data. No function requires enabling for the read models to work. Action availability derives from existing ReleaseModes (e.g., `archive_job` reports `Disabled` if FN-13 is not enabled).

## Read models implemented

### A. Office Home / Today (`_s17OfficeToday`)

Returns actionable items for the office dashboard:

| Category | Source |
|---|---|
| Overdue tasks | Tasks with `due_at` before today, not Complete/Cancelled/NotRequired |
| Due today | Tasks with `due_at` matching today |
| Due soon (7 days) | Tasks due within 7 days after today |
| Booking review | Tasks in Booking/Prebooking groups |
| Unresolved issues | Issues not Resolved/Closed |
| Health alerts | Stalled CommitJournal, uncertain Outbox |

Each task includes: `id`, `job_id`, `title`, `group`, `owner_id`, `due_at`, `status`, `priority`, `blocking_reason`, `template_code`.

### B. Job Overview (`_s17JobOverview`)

Consolidated per-job read model with 12 sections:

| Section | Content |
|---|---|
| `identity` | id, job_id, display_name, customer_id, workflow_stage, pilot_job, release_scope, financial_status, handover_status |
| `booking` | Sold/booking intake status, booking approval, outstanding booking tasks |
| `work` | Roof/electrical/scaffold requirements, WorkPackages with status/dates, allocations, calls count, unresolved issues, operational completion |
| `materials` | Materials count, required/cancelled quantities, active reservations, order statuses |
| `scaffold` | Bookings with status, erect/strip dates |
| `commissioning` | Submissions, review state, equipment count |
| `handover` | Status, sent records |
| `finance` | Gross, deposit confirmation, stages (deposit/interim/final) with amounts, invoice/payment totals |
| `crm` | GHL tasks |
| `cancellation` | Cancellation state, open review tasks |
| `archive` | archived_at |
| `system` | Pending outbox items, audit event count |

### C. Job Search (`_s17JobSearch`)

Case-insensitive substring search across: `job_id`, `display_name`, `last_name`, `postcode`, `email`, `phone`. Returns up to 50 results with id, job_id, display_name, customer_name, postcode, workflow_stage, release_scope.

### D. Operational Queues (`_s17OperationalQueue`)

Filtered task queues: `booking`, `materials`, `scaffold`, `calls`, `issues`, `commissioning`, `handover`, `payments`, `ghl`, `cancellation`, `archive`. Uses canonical Task groups and template codes from prior stages.

### E. Admin: ReleaseMode Status (`_s17AdminReleaseModes`)

Returns all 20 ReleaseMode rows with: `function_id`, `function_name`, `target_release`, `mode`, `authorised_job_scope`, `planned_target_mode`, `current_system`, `fallback`, `scope_boundary_notes`, activation/approval metadata.

### F. Admin: System Status (`_s17AdminSystemStatus`)

Returns:
- Latest HealthCheck
- Stalled/recovery CommitJournal counts
- Uncertain Outbox counts
- NOT_CONFIGURED dependencies (GHL pipeline IDs, Xero API, backup destination, destructive restore, commissioning templates, scaffolder contacts)

### G. Audit History (`_s17AuditHistory`)

Chronological merged history from AuditEvents, TaskEvents, and IssueEvents for a job. Each event includes: `type`, `timestamp`, `action`, `actor`, `reason`/`note`. Limited to 200 events.

### H. Action Availability (`_s17ActionAvailability`)

Per-job action gating derived from ReleaseModes and workflow state:

| Action | Gates |
|---|---|
| `complete_task` | Always (task-level) |
| `record_call` | Not cancelled/archived; FN-01 |
| `resolve_issue` | Not cancelled/archived; FN-01 |
| `approve_booking` | Prebooking/ReadyToBook/BookingInProgress; FN-01 |
| `operational_completion` | InProgress/Aftercare, not operational; FN-01 |
| `commissioning_review` | Not cancelled/archived; FN-07 |
| `handover_approval` | Not cancelled/archived; FN-08 |
| `deposit_confirmation` | Not cancelled/archived, no prior confirmation; FN-15 |
| `cancel_job` | Not cancelled/archived; FN-01 + FN-17 |
| `reinstate_job` | Cancelled; FN-01 + FN-17 |
| `archive_job` | Not archived, operational; FN-13 |
| `ghl_progression` | Not cancelled/archived; FN-11 |

## AppSheet mapping

The read models are backend contracts for AppSheet views. The following screens require manual AppSheet configuration:

| Screen | Read model | Primary user | Manual configuration |
|---|---|---|---|
| Home / Today | `_s17OfficeToday` | Office (Tanya) | AppSheet view binding, overdue/today/soon tabs |
| My Tasks | `_s17OfficeToday` (filtered by owner) | All | Owner filter, due-date grouping |
| Team Tasks | `_s17OfficeToday` (unfiltered) | Office | Permission-based visibility |
| Jobs | `_s17JobSearch` + list | Office | Search bar, result columns |
| Job Detail | `_s17JobOverview` | Office | Expandable sections, action buttons |
| Booking In Progress | `_s17OperationalQueue('booking')` | Office | Queue view |
| Materials | `_s17OperationalQueue('materials')` | Office/Store | Queue view |
| Scaffolding | `_s17OperationalQueue('scaffold')` | Office | Queue view |
| Issues | `_s17OperationalQueue('issues')` | Office | Queue view |
| Finance | `_s17JobOverview` (finance section) | Office | Payment stage columns |
| History | `_s17AuditHistory` | Office | Chronological list |
| Settings / Admin | `_s17AdminReleaseModes` + `_s17AdminSystemStatus` | Admin | Mode table, health indicators |
| Planner 3/6 Weeks | S11 read model | Office | Calendar view (from S11) |
| Calls | `_s17OperationalQueue('calls')` | Office | Queue view |

**No AppSheet configuration is deployed.** The repository provides backend read models only. Manual AppSheet view creation, action binding, and permission configuration remain required.

## Source files

| File | Purpose | Lines |
|---|---|---|
| `s17/admin.js` | Core read-model engine | ~390 |
| `s17/fixture.js` | Synthetic fixture + smoke runner | ~280 |
| `s17/cloud-adapter.js` | Cloud sheet enumeration adapter | ~80 |

## Tests (20, all passing)

| # | Test |
|---|---|
| 1 | Office today: overdue, due-today, due-soon counts and correct task inclusion/exclusion |
| 2 | Office today: booking review, unresolved issues, health alerts |
| 3 | Job overview: all 12 sections assemble correctly |
| 4 | Job overview: missing job returns found=false |
| 5 | Job search: by job_id, last_name, postcode, email; empty query returns [] |
| 6 | Operational queue: booking, materials, scaffold; unknown queue reports error |
| 7 | Admin ReleaseModes: all 20 functions returned with required fields |
| 8 | Admin system status: health, commit_journal, outbox, not_configured |
| 9 | Audit history: chronological events from AuditEvents |
| 10 | Audit history: missing job returns found=false |
| 11 | Action availability: per-action state with found flag |
| 12 | Action availability: respects disabled FN-01 mode |
| 13 | Action availability: cancelled job gates record_call, approve_booking |
| 14 | Date handling: strings, Date objects, invalid, null, empty |
| 15 | Missing/optional data: minimal job with no packages/allocations/finance |
| 16 | Fixture idempotency: seed does not duplicate |
| 17 | Fixture collision: non-S17 rows refused |
| 18 | No mutation: all read models leave store unchanged |
| 19 | Namespace compatibility: all bundles parse, S17 globals namespaced |
| 20 | Zero-arg DEV smoke with real header adapter reruns |

## NOT_CONFIGURED / deferred

| Area | Status |
|---|---|
| AppSheet view configuration | Manual — not in repo |
| Real device/network load testing (T109) | Deferred to S18 acceptance |
| Schema/template evolution testing (T111) | Deferred to S18 acceptance |
| Dynamic row growth (T012) | Requires finished AppSheet views |
| GHL pipeline/stage IDs | NOT_CONFIGURED |
| Xero API integration | NOT_CONFIGURED |
| Backup Drive destination | NOT_CONFIGURED |
| Destructive restore procedure | NOT_CONFIGURED |
| Commissioning templates/forms | NOT_CONFIGURED |
| Scaffolder contacts | NOT_CONFIGURED |

## DEV cloud smoke procedure

1. Paste `apps-script/s17/S17Admin.js` into DEV Apps Script project
2. `runS17FixtureDryRun()` — validates headers, checks existing data
3. `runS17FixtureApply()` — seeds synthetic fixture (Jobs, Tasks, WorkPackages, etc.)
4. `runS17FixtureValidate()` — verifies all fixture rows exist
5. `runS17HappyPathTest()` — exercises all 8 read models
6. `runS17HappyPathTest()` — verifies rerun idempotency

No ReleaseMode changes needed (S17 is read-only). No external API calls. No PROD references.
