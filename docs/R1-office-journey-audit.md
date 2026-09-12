# R1 DEV office journey audit

Authority: Developer Build Specification edition 2.0 (5 September 2026). Scope: Job Sold through planner operations. DEV only; no external calls.

## PRE/BKG compliance matrix

| Code | Trigger | Owner | Backup | Due rule | Evidence/completion requirement | Implemented | Exact implementation |
|---|---|---|---|---|---|---|---|
| PRE01 | New Standard sale | Tanya | — | Same day | Confirmed invoice ID and sent status, or failure follow-up | Yes | `s06/gates.js:createPrebookingTasksForSold`; template `schema/config-seed.json:TaskTemplates` |
| PRE02 | New sale | Tanya | — | Same day, then daily follow-up | Signable reference and signed evidence; sending is not signing | Yes | `s06/gates.js:createPrebookingTasksForSold`; template seed |
| PRE03 | Deposit expected on Standard route | Ben | Dan | Next staffed day after payment notice | Verified amount/date; no email-only auto-completion | Yes | `s06/gates.js:createPrebookingTasksForSold` and `createTasksForJob`; `r1-appsheet/adapter.js:_r1aDirector`; `_r1sTaskComplete` preserves actor |
| PRE04 | New sale | Tanya | — | Before booking approval | Checked customer/sold-presale fields and source references | Yes | `s06/gates.js:createPrebookingTasksForSold`; template seed |
| PRE05 | Finance job (non-Standard) | Tanya | — | Before booking approval | Provider/agreement evidence; ordinary deposit task suppressed | Yes | `s06/gates.js:createPrebookingTasksForSold`; template seed |
| BKG01 | Booking intake received / prepare booking | Tanya | — | Before booking | Survey, presale, extras, board capacity and roof quantities checked | Yes | `s06/gates.js:createTasksForJob`; template seed |
| BKG02 | Booking intake received / book dates | Tanya | — | Before booking confirmation | Customer contact outcome plus each required installer/scaffold allocation | Yes | `s06/gates.js:createTasksForJob`; template seed |
| BKG03 | Booking response | Tanya | — | Before confirmation | Value/contact match or approved documented difference | Yes | `s06/gates.js:createTasksForJob`; template seed |
| BKG04 | Booking confirmed | Tanya | — | Same staffed day | Approved customer message, surveyor copy and sent record | Yes, manual | `s06/gates.js:createTasksForJob` creates it only after Booked/approval; actual send intentionally remains manual/no external API |
| BKG05 | Booking confirmed | Tanya | — | Same staffed day | Calendar event links and required document-pack evidence | Yes, manual | `s06/gates.js:createTasksForJob` creates it only after Booked/approval; live Calendar send intentionally remains disabled |

All task instance keys are `template + job + ROOT + nodue`, so Ben and Dan share one PRE03 row. Optimistic versioning permits only one successful completion; `completed_by`, TaskEvents.actor, and AuditEvents.initiating_actor retain the actual actor.

## Job identity and booking update

- `s05/intake.js:processSoldIntake` inserts one Customer, then one Job, then stores the Intake. `s05/mapping.js:generateJobId` creates the random `SS-XXXX-XXXX` value once with collision retry. A replay with the same intake/hash returns the existing job; a conflicting replay goes to Review.
- `s05/intake.js:processBookingIntake` requires `booking_job_id`; `s05/mapping.js:resolveBookingJob` accepts exactly one exact `Jobs.job_id` match. Blank, unknown, or ambiguous references go to Intake Review. It never matches surname/address and never inserts a Job.
- Booking applies structured data to the existing Job FK graph through `s05/booking-apply.js:applyBookingStructured`; identity mismatches create CustomerChanges and Review rather than overwriting the Customer.

## Data already known before Booking — do not manually re-enter

Sold/presale should supply and the Booking UI should display read-only: internal/human job reference; Sold submission/date; salesperson; lead source; quote/presale reference and file; customer first/last name, address lines, town, postcode, email, phone; agreed original net/VAT/gross and valuation basis; finance route; sold roof/electrical/scaffold scope; contract status/reference/evidence when reliably sourced; deposit state/evidence when reliably sourced. Current synthetic Sold mapping covers customer identity/contact, lead source, quote reference, finance route, work-scope booleans, gross value and valuation basis. Salesperson, presale file, net/VAT breakdown, and reliable contract/deposit imports remain source-mapping gaps.

## Fields specifically required at Booking

The exact existing Job ID; agreed roof/electrical/scaffold dates (and multi-day ends where applicable); lead/second installer allocations; scaffold company, scope PDF and access notes; survey/design/scope review outcomes; roof/material quantities and approved product selections; inverter/battery/other planned equipment; merchant/source and ordering notes; extras; board-capacity and technical-review evidence; customer date-call outcome; and value/contact reconciliation outcome. Customer identity, sold value, finance route, and sold scope are comparison/display values, not re-entry fields.

## MOVE_JOB regression boundary

No MOVE_JOB implementation was changed in this audit. `s11/planner.js:_s11MoveJobR1` still changes only selected activities, preserves unrelated WorkPackage/Scaffold dates, increments revisions, records audit/commit state, creates customer/installer/calendar/material/scaffold/interim impact tasks, and only captures Calendar outbox work (`external_calls: 0`).

## Verification status

| Area | Status | Notes |
|---|---|---|
| Explicit `Prebooking → ReadyToBook` | IMPLEMENTED / LOCAL PASS | Canonical `s06/gates.js` + local/node tests; cloud AppSheet exercise NOT RUN |
| Safe `BookingInProgress → Booked` (mandatory PRE/BKG tasks) | IMPLEMENTED / LOCAL PASS | Field gates alone cannot advance; BKG04/BKG05 excluded from Booked blockers |
| Ben/Dan single PRE03 task | IMPLEMENTED / LOCAL PASS | `owner_id=PERSON-ben`, `backup_id=PERSON-dan`; Dan remains Director |
| Early Booking without ReadyToBook bypass | IMPLEMENTED / LOCAL PASS | Booking links Job; stage stays Prebooking until ReadyToBook |
| DEV AppSheet / bound cloud smoke | NOT RUN / BLOCKED | Requires paste of generated bundles into DEV Apps Script + AppSheet config |
| Live Calendar / email / Xero / Jotform cutover | NOT RUN / BLOCKED | Intentionally out of scope |

## Resolved blockers

1. `Prebooking → ReadyToBook` is now explicit and requires signed contract evidence, PRE02, PRE04/customer-value verification, and either Standard PRE03/bank evidence or applicable PRE05 finance evidence. **IMPLEMENTED / LOCAL PASS.**
2. `BookingInProgress → Booked` now requires every applicable mandatory PRE task and BKG01–BKG03 to be `Complete`, or explicitly `NotRequired` with a recorded note/evidence. Field gates alone cannot advance it. **IMPLEMENTED / LOCAL PASS.**
3. BKG04/BKG05 are created only after the Booked transition and remain manual. **IMPLEMENTED / LOCAL PASS.**

Remaining configuration inputs are unchanged: Dan's verified email, approved Jotform mappings, approved product mappings, verified installer/calendar/scaffold directory data, and the physical-pack retention decision. AppSheet UI wiring remains **NOT RUN / BLOCKED** until DEV deploy.

## Exact AppSheet work next

1. In DEV People, set Dan's verified email on `PERSON-dan`; retain active `Director` PersonRole. Do not give Dan Admin.
2. Refresh/regenerate People, PersonRoles, PermissionRules, TaskTemplates, and Tasks columns after deploying the updated seed/bundle.
3. Use the My Tasks filter `(owner_id = current person) OR (backup_id = current person)` so Dan sees Ben-owned PRE03 tasks. Keep TASK_COMPLETE routed through `appSheetR1Command`.
4. Show `completed_by`, `completed_at`, completion note, and evidence on task history. Do not create a second Dan task or an AppSheet-side completion action.
5. Make Sold-known fields read-only/displayed from the linked Job. Keep only the Booking-specific fields above editable in the helper form.
6. Keep BKG04/BKG05 as manual evidence tasks while live Calendar/email sends are disabled. Do not configure PROD.
