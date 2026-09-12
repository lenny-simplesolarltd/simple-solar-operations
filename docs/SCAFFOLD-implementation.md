# Scaffold workflow — 12 September 2026

**LOCAL IMPLEMENTATION PASS (18 tests); DEV CLOUD NOT YET RUN.** Closes backlog items: scaffold company/config model, scaffold booking workflow, scaffold planner integration. FN-04 "Scaffold commitments" (R2). Scaffolder messages are captured as `Communications` drafts and never sent. No external calls. No real scaffolder company is invented.

## Authority applied

- 01 §4: `ScaffoldBookings` with distinct planned/confirmed/actual erect and strip fields, `revision`/`confirmed_revision`, costs, access notes, scope file, related issues; `Communications`/`CommunicationJobs`/`Acknowledgements` for supplier instructions and acknowledgements; scaffold complaints in `Issues` with responsible company.
- 01 task templates SCA01–SCA05 (SCA02–SCA05 added to `schema/config-seed.json` exactly as specified; embedded seed regenerated).
- 04 S09: "moving a scaffold activity creates a new instruction/confirmation revision"; "missing actual completion after the planned date creates Tanya's chase task"; "an actual strip must not close a complaint automatically".
- 02 manual: strip authorisation after customer happy; booking the strip and confirming removal are separate tasks; "cancel booking" is insufficient for erected scaffold.
- Runbook §C: real scaffolder configuration model; synthetic scaffold company must not act as a real supplier.

## Booking lifecycle

| Command | Status after | Tasks | Communication |
|---|---|---|---|
| `_scfRequest` | Requested (rev 1) | SCA01 due erect − company lead days, previous staffed day 09:00 | `ScaffoldInstruction` rev 1 (Draft) |
| `_scfConfirmErect` | Confirmed, `confirmed_revision = revision` | SCA01 complete; SCA02 due erect day end (office hours end, London) | Acknowledgement row for the revision |
| `_scfRecordErected` | Erected (`erect_actual_at`) | SCA02 complete; `late` flag when after planned | |
| `_scfAuthoriseStrip` | StripAuthorised or **Blocked** (customer not happy, not erected, open strip-blocking issues) | SCA03 due next staffed day 09:00 | |
| `_scfPlanStrip` | StripPlanned, revision +1 | | `ScaffoldStripInstruction` new rev (Draft) |
| `_scfConfirmStrip` | StripConfirmed, `confirmed_revision = revision` | SCA03 complete; SCA04 due strip day end | Acknowledgement row |
| `_scfRecordStripped` | Stripped (`strip_actual_at`, optional actual cost/invoice ref) | SCA03/SCA04 complete; returns still-open complaints | |
| `_scfChangeDates` | revision +1; Confirmed → Requested, StripConfirmed → StripPlanned | new SCA01/SCA03 instance per revision | new instruction rev (Draft) |
| `_scfCancel` | Cancelled (refused once erected and not stripped) | open SCA tasks cancelled | `ScaffoldCancellation` (Draft) |
| `_scfComplaint` | Issue `type: Complaint`, category MissedAppointment/Access/Damage/UnsafeConcern/Other, responsible company, Tanya owner; `blocks_strip` defaults true for UnsafeConcern | | |
| `_scfChase` | SCA02/SCA04 "CHASE" instance once per booking revision when planned date passed without an actual | | |
| `_scfWeeklyList` | one `ScaffoldWeeklyList` Draft per company per week (erects + authorised strips), SCA05 due Friday 12:00 London | | |

All commands: DEV sheet/env guard, FN-04 Automated/Pilot/R2, pilot R2 job not in cancellation, CommitJournal `CJ-SCF-<command_id>` idempotency with conflict detection, `expected_version` check, AuditEvents per mutation (`executing_service: ScaffoldWorkflow`). S11 Move Job's `Scaffold` activity still moves dates and bumps `revision`; the booking view then reports `acknowledgement_required`.

## Scaffolder configuration

- `_scfScaffolders(store)`: active Scaffolder companies with contacts, `synthetic` (source_system S09/SCF-fixture or `COMP-scaffold-dev`) and `configured` flags.
- `_scfConfigureScaffolder(store, {company_id, name, standard_lead_days?, notes?, contact?})`: create/update a real company (`source_system: SCF-config`) and contact; refuses synthetic-looking names, existing companies of another type, lead days outside 0–60. Values must come from the business (runbook: "Ben supplies … merchant/scaffolder contacts").
- A synthetic scaffolder is refused for any non-synthetic job.

## Planner integration

`_scfPlannerRows(store, from, to)` and, for the AppSheet planner reads, `_s11BuildPlanner` now returns a `scaffold` array alongside `rows`: `{job_id, scaffold_booking_id, company, kind: Erect|Strip|StripForecast, date, status, revision, acknowledged, confirmed, actual_recorded}`. Cancelled bookings are excluded. The S11 bundle header list now includes `ScaffoldBookings` and `Companies`.

## Cloud entry points (`apps-script/scaffold/ScaffoldWorkflow.js`)

| Function | Purpose |
|---|---|
| `runScfScaffolders()`, `runScfPlannerRows(from, to)`, `runScfBookingView(id)` | Read-only |
| `runScfConfigureScaffolder(companyId, name, leadDays, contactName, contactEmail, contactPhone)` | Real scaffolder entry (values supplied by the business) |
| `runScfChase()`, `runScfWeeklyList(weekStart)` | Scheduler-safe; idempotent |
| `runScfEnableFn04ForSyntheticTest()` / `restoreScfSafeState()` | FN-04 toggle |
| `runScfHappyPathTest()` | Synthetic end-to-end on a fresh SCF-fixture job + synthetic scaffolder: request → confirm → erected → unsafe complaint blocks strip → resolved → authorise → plan → confirm → damage complaint → stripped with complaint still open; restores FN-04 |

Build `npm run build:scaffold`; tests `npm run test:scaffold` (`tests/scaffold.test.cjs`, 18 incl. zero-arg header-adapter simulation).

## DEV cloud steps (pending — no browser/Apps Script access in this session)

1. Re-run the S02 seed **only through the existing controlled path** to add TaskTemplates SCA02–SCA05 to the DEV sheet (or insert the four rows manually from `schema/config-seed.json`). Do not rerun S02 Apply wholesale.
2. Paste `apps-script/scaffold/ScaffoldWorkflow.js` and the rebuilt `apps-script/s11/S11Planner.js`.
3. `restoreScfSafeState()`, `runScfScaffolders()`, `runScfHappyPathTest()`, `restoreScfSafeState()`.
4. When Ben supplies the real scaffolder(s): `runScfConfigureScaffolder(...)`.
5. Optional: daily trigger `runScfChase()`; Friday trigger `runScfWeeklyList()`.

## Not done

- Sending scaffolder instructions/lists (FN-04 Manual route in R1; Automated send is a later approved adapter). Communications stay Draft.
- Scaffolder own-company external view / acknowledgement form (spec §9) — not built.
- Import mapping from the legacy scaffold sheet (S19 cutover).
- AppSheet surface for the scaffold commands (R2 UI) — backend ready; adapter wiring is a later batch.
