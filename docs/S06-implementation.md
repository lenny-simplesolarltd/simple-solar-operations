# S06 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (14 tests); DEV CLOUD NOT YET RUN.** Booking gate evaluation and task creation implemented against the canonical 60-table schema. No external actions.

## Authoritative tables used

| Table | Purpose |
|---|---|
| `Jobs` | Gate evaluation target: `workflow_stage`, `sold_booking_match_status`, `contract_status`, `deposit_bank_confirmed_at`, `finance_route`, `original_gross_pence`, `next_action_at`, `customer_id` |
| `Tasks` | Created via templates with deterministic `instance_key` for dedup |
| `TaskTemplates` | PRE01, PRE02, PRE03, BKG01, BKG04, FIN01 — 6 S06-relevant templates |
| `TaskDependencies` | Supports `named_gate` and `prerequisite_task_id` for gating |
| `Customers` | Customer existence and field completeness checks |
| `People` / `PersonRoles` | Resolve Tanya (Office) and Ben (Admin) as task owners |
| `Settings` | Deposit 25%, interim 35%, balance 40%, interim lead 7 days |
| `ReleaseModes` | FN-01 governs S06 |

## ReleaseMode

**FN-01** ("Office core/intake/tasks/planners/calls/issues"). S06 falls under the same function as S04 and S05. No dedicated FN-xx exists for booking gates.

## Architecture

### Gate evaluation (`s06/gates.js`)
- `evaluateBookingGates(job, store)` — returns `{ ready, blocked, gates[], needs_review, summary }`
- 8 checks: sold/booking linked, match status, customer exists, customer details, contract status, finance route, deposit confirmed, gross amount
- Blocking gates (5): sold/booking linked, match status, customer exists, finance route, deposit confirmed
- Non-blocking gates (3): customer details, contract status, gross amount

### Task creation
- `createTasksForJob(job, gateResult, store)` — idempotent via `instance_key`
- Templates triggered: PRE01 (deposit), PRE02 (contract), PRE03 (bank deposit), BKG01 (prepare booking), BKG04 (booking email), FIN01 (interim)
- S06-UNPAID-INTERIM: Tanya chase task when deposit not confirmed but install date set
- Unpaid interim does NOT auto-block installation
- Tanya (Office) is default owner; Ben (Admin) for deposit confirmation

### Due dates
- `nextStaffedDay(from, holidays)` — skips weekends and configured holidays
- `fridayBefore(date, holidays)` — Friday before a given date, skipping holidays
- FIN01 (interim) due Friday before install date
- Europe/London timezone; Mon-Fri default

## Tests (14, all passing)

| # | Test | Result |
|---|---|---|
| 1 | Ready booking evaluates correctly | PASS |
| 2 | Missing deposit blocks booking | PASS |
| 3 | Unpaid interim creates Tanya chase, doesn't block install | PASS |
| 4 | Re-evaluation idempotent | PASS |
| 5 | Deterministic instance_key | PASS |
| 6 | Correct internal Jobs.id linkage | PASS |
| 7 | Friday-before-install calculation | PASS |
| 8 | isStaffedDay rejects weekends | PASS |
| 9 | isStaffedDay respects holidays | PASS |
| 10 | nextStaffedDay skips weekends | PASS |
| 11 | Unrelated rows untouched | PASS |
| 12 | Missing job returns error | PASS |
| 13 | Completed tasks not recreated | PASS |
| 14 | S06Gates.js VM smoke test | PASS |

## Cloud smoke test

`apps-script/s06/S06Gates.js` — single file, zero-arg functions:
- `runS06FixtureDryRun()` / `runS06FixtureApply()` / `runS06FixtureValidate()`
- `runS06HappyPathTest()` — creates synthetic ready job, evaluates gates, creates tasks
- `restoreS06SafeState()` — restores FN-01 to Disabled
