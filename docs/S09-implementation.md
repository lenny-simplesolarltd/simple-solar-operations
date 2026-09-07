# S09 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (10 tests); corrected DEV cloud smoke awaiting manual rerun.** Previous cloud attempt failed after potentially committed writes. Scaffold requirement evaluation and booking via canonical ScaffoldBookings table. No real scaffolder communication.

## Authoritative tables

| Table | S09 role |
|---|---|
| `ScaffoldBookings` | Scaffold erect/strip bookings — `job_id`, `company_id`, `status`, `revision`, `erect_planned_at` |
| `Companies` | Scaffolders — `type: Scaffolder` |
| `Jobs` | `scaffold_required` (BOOLEAN), `next_action_at` for date calculation |

## ReleaseMode

**FN-04** ("Scaffold commitments"), target R2, planned Automated.

## Task template

**SCA01** ("Notify and confirm scaffolder erect"), owner Office (Tanya), group Materials.

## Architecture

### Scaffold evaluation (`s09/scaffold.js`)
- `evaluateScaffoldRequirement(jobId, store)` — checks `Jobs.scaffold_required`
- Returns: `NotRequired`, `AlreadyBooked`, `Ready`
- Missing job → error

### Booking creation
- `createScaffoldBooking(jobId, store)` — deterministic ID: `SB-{jobId}`
- Uses only the active synthetic `COMP-scaffold-dev` company.
- Calculates erect date from install date minus lead days
- Status: `Requested`
- No scaffolder → `NoScaffolder`

### Task creation
- `createScaffoldTasks(jobId, store)` — SCA01 task
- Instance key: `SCA01-{jobId}-ROOT-nodue`
- Owner: Tanya (Office)

## Tests (10, all passing)

| # | Test | Result |
|---|---|---|
| 1 | Scaffold required — booking created | PASS |
| 2 | Scaffold not required — no booking | PASS |
| 3 | Replay no duplicate booking | PASS |
| 4 | Internal Jobs.id linkage | PASS |
| 5 | Task owner correct (SCA01 → Tanya) | PASS |
| 6 | Unrelated rows untouched | PASS |
| 7 | Missing job returns error | PASS |
| 8 | S09Scaffold.js VM smoke test | PASS |

## Cloud smoke test

`apps-script/s09/S09Scaffold.js` — single file, 6 zero-arg functions:
- `runS09FixtureDryRun()` / `runS09FixtureApply()` / `runS09FixtureValidate()`
- `runS09EnableFn04ForSyntheticTest()` — enables FN-04 Disabled/None/R2 → Automated/Pilot/R2
- `runS09HappyPathTest()` — creates or evidences one booking and one correctly linked SCA01; repairs a missing task after partial failure; reports created/reused counts.
- `restoreS09SafeState()` — restores FN-04 to Disabled/None/R2

## Smoke repair

Stable nested processing results, task creation counts, and new Pilot/R2 jobs were already present. Added processing/mutator guards for exact DEV sheet, DEV environment, FN-04 Automated/Pilot/R2 and synthetic S09 pilot jobs. Stores must expose `getEnvironment()`. Existing recognized S09 smoke jobs can have their old R1/non-pilot fields corrected explicitly by the runner. Conflicting bookings/tasks fail without destructive cleanup. No communication adapters or real contact details are configured (NOT_CONFIGURED).

The VM smoke now uses canonical headers and actually runs the happy path, booking-only recovery, replay, malformed-result diagnostics, and safe-state restoration. Two focused regressions cover processing guards and recovery/reuse.

Replace the DEV S09 script manually, then run in order:
1. `restoreS09SafeState()`
2. `runS09FixtureDryRun()`
3. `runS09FixtureApply()`
4. `runS09EnableFn04ForSyntheticTest()`
5. `runS09FixtureValidate()`
6. `runS09HappyPathTest()`
7. `restoreS09SafeState()` — run even if any prior step fails.
8. `runS09FixtureValidate()` — expect Disabled and fn04_ready false.

No cloud deployment or execution was performed during this repair.
