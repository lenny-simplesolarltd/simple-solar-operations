# S11 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (18 tests); DEV CLOUD NOT YET RUN.** Planning, allocation, moves, installer changes, Calendar capture, and planner views via canonical WorkPackages, Allocations, CalendarLinks tables. No real Calendar API calls.

## Authoritative tables

| Table | S11 role |
|---|---|
| `WorkPackages` | Planned work — `planned_start`, `planned_end`, `status`, `revision`, `trade` |
| `Allocations` | Person assignment — `person_id`, `role` (Lead/Second/Support), `active`, `replaced_allocation_id`, `calendar_link_id` |
| `CalendarLinks` | Calendar intent — `calendar_id`, `external_event_id`, `status` (Pending/Active/UpdatePending/Cancelled/Error), `outbox_id` |
| `People` | Installer — `capacity_per_day`, `available_from`, `available_to` (`calendar_id` is NOT used: DEV has one shared calendar, confirmed 12 Sep 2026) |
| `Holidays` | Office closure dates |
| `Outbox` | Outbound calendar intent (CAPTURE_ONLY in DEV) |
| `CommitJournal` | Command idempotency and recovery |
| `AuditEvents` | State change history |

## ReleaseModes

| FN | Function | Target | Pilot state |
|---|---|---|---|
| FN-01 | Office core/intake/tasks/planners/calls/issues | R1 | Automated/Pilot/R1 |
| FN-02 | Calendar entries | R2 | Automated/Pilot/R2 |

Both must be enabled for S11 cloud smoke.

## Architecture

### Planning (`_s11PlanWorkPackage`)
- Validates scope (DEV, sheet, pilot job, FN-01/FN-02 modes)
- Checks installer availability, capacity, holidays
- Creates Allocation + CalendarLink + Outbox
- Deterministic allocation ID: `ALLOC-S11-{command_id}`
- Calendar capture only: `CAPTURE_ONLY: no Calendar API call`
- Command journal for idempotency

### Move (`_s11MoveWorkPackage`)
- Updates WorkPackage dates and Allocation dates
- Preserves revision history
- Updates CalendarLink with new dates
- Excludes own allocation from capacity check

### Change installer (`_s11ChangeInstaller`)
- Replace mode: deactivates old allocation, creates new
- Add mode: creates second allocation (Support role)
- Calendar links for both

### Planner (`_s11BuildPlanner`)
- Returns all allocations in a date range
- Filters by staffed days

### Date handling (`_s11LocalDate`)
- Normalizes JavaScript Date objects and ISO strings
- Validates calendar dates
- Europe/London timezone

## Calendar safety

No real Calendar API calls. All calendar operations produce:
- `CalendarLinks` rows with `status: Pending` targeting the shared DEV calendar (`S11_SHARED_CALENDAR_ID`)
- `Outbox` rows with `response_summary: CAPTURE_ONLY: no Calendar API call`
- External event ID remains null until real cutover

## Tests (18, all passing)

| # | Test |
|---|---|
| 1 | Valid allocation uses WorkPackage.id and People.id |
| 2 | Planner returns multi-day allocation in views |
| 3 | Planning replay does not duplicate |
| 4 | Conflicting command identity fails closed |
| 5 | Inactive installer rejected |
| 6 | Unavailable installer rejected |
| 7 | Missing capacity fails closed |
| 8 | Capacity conflict returns NeedsReview |
| 9 | Configured holiday returns NeedsReview |
| 10 | Move revises package and preserves audit |
| 11 | Stale move refused |
| 12 | Calendar update preserves external event reference |
| 13 | Replacement deactivates old allocation |
| 14 | Adding second installer retains original |
| 15 | ReleaseMode and scope enforced |
| 16 | Date objects and strings normalize identically |
| 17 | Unrelated rows untouched, no outbound API |
| 18 | Apps Script bundle parses without generic-global collisions |

## Cloud smoke test

`apps-script/s11/S11Planner.js` — single self-contained file, 7 zero-arg functions:
- `runS11FixtureDryRun()` / `runS11FixtureApply()` / `runS11FixtureValidate()`
- `runS11EnableFunctionsForSyntheticTest()` — enables FN-01 (Automated/Pilot/R1) + FN-02 (Automated/Pilot/R2)
- `runS11HappyPathTest()` — plans a WorkPackage, creates Allocation + CalendarLink + Outbox
- `restoreS11SafeState()` — restores both to Disabled/None
