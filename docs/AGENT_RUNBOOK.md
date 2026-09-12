# Simple Solar Operations — Autonomous Agent Runbook

## Mission

Complete the Simple Solar Operations system defined by the repository,
implementation specifications, existing DEV implementation, and this runbook.

The agent is expected to perform the work itself using:

- repository access
- terminal
- Google Sheets DEV
- AppSheet DEV
- Apps Script DEV
- Google Calendar DEV
- GitHub

Do not merely tell the user how to perform configuration that the agent
can safely perform itself.

## Environment

DEV Google Sheet:
Simple Solar Operations - DEV

DEV Sheet ID:
1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc

DEV Apps Script project:
Simple Solar Operations - DEV

DEV bound Script ID:
1QLsRtIdxjQ3r3gHFaqufx9je8uEtBW9Q8W6marIkdNsu_nWJlqkaalzo

Standalone AppSheet bridge:
Simple Solar Operations - S04 Backend DEV

Standalone Script ID:
10WnsSnwVHG2c5oAhxj507W4bcD1f1VbgSvwaGCifEqQoHSh-msPkag2g

DEV Calendar:
Simple Solar Operations - DEV

Calendar ID:
c_78af3ebb19540667b0e233ef74f02738e5a813073a6c55ee33898aacb3f39b91@group.calendar.google.com

Repository:
https://github.com/lenny-simplesolarltd/simple-solar-operations

## Absolute safety rules

1. DEV ONLY unless the user explicitly authorizes TEST or PROD.
2. Never edit PROD data, PROD AppSheet, PROD calendar or production integrations.
3. Never weaken authorization, concurrency, idempotency or audit protections.
4. Never create a second Job where an existing Job should be updated.
5. Never replace stable IDs.
6. Never invent regulatory or commissioning requirements.
7. Never enable external side effects just to make a test pass.
8. Never enable Xero/GHL/payment/customer messaging without explicit approval.
9. Never expose credentials or copy passwords into repository files.
10. Never delete operational records to clean up tests. Deactivate synthetic records where needed.
11. Preserve optimistic concurrency/version checks.
12. Preserve audit history.
13. Preserve command idempotency.
14. All new functions must fail safely.
15. Commit after each coherent implementation batch.

## User preference

The user does not want click-by-click manual instructions when the agent can
perform the task itself.

Perform the work autonomously.

Only interrupt the user when:
- authentication is required
- a business fact cannot safely be inferred
- a destructive/high-impact action needs approval
- a website blocks automation
- a PROD action would be required
- commissioning/regulatory requirements are genuinely unknown

Do not interrupt merely to report progress.

## Architecture

Squarespace:
public website only

AppSheet:
staff operational UI

Google Sheets:
structured operational datastore

Google Apps Script:
authoritative workflow/business logic

Google Drive:
evidence, exports, documents and backups

Google Calendar:
appointments/installations

Xero:
finance integration — later release

GHL:
human progression task in R1; automation later

## Release strategy

R1 — Office
R2 — Materials and scaffolding
R3 — Installer commissioning
R4 — Finance/reporting

Development may proceed in DEV while earlier releases are awaiting acceptance.

## Current implementation status

Already substantially implemented:

- stable Jobs and Customers
- native Job Sold intake
- native Booking Intake
- request-row command bridge
- booking gates
- deposit confirmation
- operational completion
- task completion
- call recording
- issue creation
- issue updates
- cancellation/reinstatement
- planner update
- MOVE_JOB
- CHANGE_INSTALLER
- office dashboards
- Job Overview
- related Tasks/Calls/Issues/WorkPackages/etc
- Planner 3 Weeks
- Planner 6 Weeks
- Planner Board
- installer conflict calculations
- PersonAvailability
- PersonSkills
- staff roles
- real People seed data
- Holidays

## Confirmed decisions (12 September 2026)

Confirmed by the user after browser-agent review. Treat as business facts.

- TeamMembers.role enum = Lead, Member, Apprentice.
- DEV uses ONE shared calendar only:
  c_78af3ebb19540667b0e233ef74f02738e5a813073a6c55ee33898aacb3f39b91@group.calendar.google.com
- Do not depend on People.calendar_id for the current DEV calendar architecture.
- WorkPackages.trade is constrained to Roof / Electrical.

## Current trade taxonomy

WorkPackages currently use:

- Roof
- Electrical

Do not create alternative strings such as:
Roofing
Roofer
Electrician
PV

without performing an intentional schema migration.

## Real installation people

Dan Anderson — Installer — Electrical
John Doyle — Installer — Roof
Josh Lewis — Installer — Roof
Angel Dos Santos — Installer — Roof
James Davies — Installer — Electrical
Robbie Daniel — Installer — Electrical
Darren Lester — Installer — Electrical
Casey Lakey — Installer — Electrical
Lucan Bender — Installer — Electrical

## Real office / management people

Ben Quick — Director
Dan Barnes — Director
Hannah Harvey — Office + VariationApprover
Tanya Harris — Office
Lucy Ross — Office
Rosie Ashley — Office
Mike Bater — Surveyor
Anne Pike — Surveyor
Dave Gorman — Surveyor
Rick Jarvis — Surveyor
Dave Hopwood — Manager

Lenny DEV and Simple Solar Info are DEV/Admin identities.

## Immediate implementation backlog

### A. Resource planning

Complete:

- PersonSkills UI
- PersonAvailability UI
- team model
- team membership
- skill-aware availability
- leave-aware availability
- conflict calculations
- team-aware planner UX
- move/change-installer improvements

Do not invent real team combinations.
If real crew composition is unknown, support flexible assignment without
hardcoding fake teams.

### B. Calendar

Implement authoritative DEV Calendar integration.

Requirements:

- Apps Script owns writes.
- Create event once.
- Persist external event ID.
- Update event when job/work package moves.
- Cancel or mark appropriately when cancelled.
- No duplicate events.
- Handle uncertain outcomes.
- Audit every external mutation.
- DEV calendar only.
- Calendar functionality starts disabled/manual until implementation is complete.

### C. Scaffolding

Implement:

- real scaffolder configuration model
- scaffold booking workflow
- erect date
- strike date
- status
- notes/evidence
- planner visibility
- change/move handling

Do not use synthetic scaffold company as a real supplier.

### D. Materials and ordering

Implement:

- merchant configuration
- material requirements
- product/material line items
- ordering source
- required-by dates
- order status
- ordered/received state
- evidence/reference
- store workflow
- planner/office visibility

Existing merchants:
- Greentech
- CEF

### E. Installer completion

Implement mobile-friendly installer workflow for:

- assigned work
- start/completion
- evidence upload
- completion outcome
- issue/remedial creation
- commissioning-required state

Do not invent commissioning certification requirements.

### F. Commissioning and handover

Build only framework until authoritative commissioning specification exists.

Support:
- required/not required
- submitted/missing/accepted states
- evidence
- reminders
- two-working-day missing reminder
- handover status

Do not fabricate forms, declarations or regulatory gates.

### G. Finance

Implement system structures for:

- 25% invoice
- 35% interim invoice
- 40% final invoice
- due states
- payment confirmation
- Tanya payment call tasks
- financial status

Interim unpaid does NOT automatically block installation.

Xero automation remains disabled until explicitly approved.

### H. Operational completion

Preserve rule:

GHL progression remains a HUMAN TASK after Tanya approves operational
completion in R1.

Do not automatically progress GHL yet.

### I. Resilience

Implement:

- system health state
- last successful processing
- visible failures
- retry/recovery
- outbound uncertain outcome review
- real Drive backup process
- backup manifest
- restore procedure
- archival eligibility
- restore path

### J. UX

Finish:

- Office Home
- role-based navigation
- Tasks
- Planner
- Jobs
- Calls
- Issues
- Payments
- materials
- scaffold
- installer mobile views
- admin/configuration
- useful human-readable labels

No internal IDs as primary user-facing labels.

## Work methodology

For every batch:

1. Inspect existing implementation first.
2. Do not duplicate something already implemented.
3. Update code/config.
4. Run focused tests.
5. Regenerate generated Apps Script artifacts where required.
6. Run appropriate full local suite.
7. Apply DEV configuration through browser when necessary.
8. Confirm resulting schema/config.
9. Update this runbook's STATUS section.
10. Commit.
11. Continue automatically to next safe batch.

Do not stop after creating documentation or giving recommendations.

## Testing policy during active development

Prioritize implementation speed.

Required:
- focused local tests for changed logic
- existing full suite after meaningful backend changes
- one controlled DEV happy path where useful

Deferred until release acceptance:
- broad negative matrices
- device matrices
- large concurrency matrices
- exhaustive cloud acceptance

Never claim deferred tests have passed.

## Git policy

Use branch:

agent/full-operations-build

Commit format examples:

feat(planner): add leave-aware installer availability
feat(calendar): add idempotent work package sync
feat(scaffold): implement booking workflow
feat(materials): implement ordering state machine

Do not force-push.
Do not rewrite unrelated history.

## Browser policy

The agent may edit:

- AppSheet DEV
- DEV Google Sheets
- DEV Apps Script
- DEV Calendar

The agent may NOT edit:

- PROD equivalents
- live finance systems
- live GHL
- customer-facing messaging

If AppSheet presents a destructive schema regeneration warning, inspect it
before accepting.

## STATUS

Update this section continuously.

Current milestone:
Resource planning

Current next action:
Complete PersonSkills + flexible team model, then Calendar DEV integration.

Claude backend batch (12 Sep 2026):
Processing heartbeat implemented locally (s16/heartbeat.js, bundled into apps-script/s16/S16Health.js, 16 tests). Resilience item "Processing heartbeat" closed in AGENT_BACKLOG.md. DEV cloud run of runS16HeartbeatSmoke() and an hourly runS16HeartbeatTick() trigger remain to be applied after the bundle is pasted. DEV calendar write service implemented locally (calendar/service.js → apps-script/calendar/CalendarSync.js, 21 tests); six Calendar backlog items closed. Cloud smoke (runCalLiveDevSmoke) and S01_CONFIG.calendarMode/allowedCalendarIds confirmation remain pending: no browser tool is available in this session. Scaffold backend implemented locally (scaffold/workflow.js → apps-script/scaffold/ScaffoldWorkflow.js, 18 tests; SCA02–SCA05 seeded; planner scaffold rows). Cloud: paste bundles, add the four SCA templates to the DEV sheet, runScfHappyPathTest() — pending (no browser tool). Materials backend implemented locally (materials/workflow.js → apps-script/materials/MaterialsWorkflow.js, 16 tests; MAT02–MAT04/MAT06 seeded). Cloud: add template rows, paste bundle, runMatHappyPathTest() — pending (no browser tool). Next: reconcile resource-planning (PersonSkills/PersonAvailability/Teams) against what exists in DEV, then remaining resilience/finance items.