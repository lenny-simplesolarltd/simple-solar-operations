# Resource planning — 12 September 2026

**LOCAL IMPLEMENTATION PASS (12 tests); DEV CLOUD NOT YET RUN.** Backend for backlog group A: flexible Teams/TeamMembers, skill-aware and leave-aware planning, team-aware planner, Move Job and Change Installer improvements. The two UI items ("Finish PersonSkills configuration", "Finish PersonAvailability configuration") are AppSheet work and remain open.

## Confirmed decisions applied

- `TeamMembers.role` enum = Lead / Member / Apprentice (12 Sep 2026). The same enum is used for `PersonSkills.level`.
- Skills use the WorkPackages trade taxonomy Roof / Electrical only. Teams may be Roof / Electrical / Mixed.
- No real team compositions are seeded or invented. Teams are created by Admin/Manager/Office people from real inputs.

## Schema (additive)

Four tables added to `schema/tables.json` (now 64 tables; embedded schema regenerated; drift, schema and provisioner tests updated to dynamic counts):

| Table | Key columns |
|---|---|
| `PersonSkills` | `person_id`, `skill` (Roof/Electrical), `level` (Lead/Member/Apprentice), `certified_until`, `active` |
| `PersonAvailability` | `person_id`, `type` (Leave/Sick/Training/Unavailable/Available), `from_date`, `to_date` (inclusive, null = single day), `reason`, `approved_by`, `active` |
| `Teams` | `name`, `trade` (Roof/Electrical/Mixed), `active`, `notes` |
| `TeamMembers` | `team_id`, `person_id`, `role`, `from_date`, `to_date`, `active` |

All carry the full audit column set. Foreign keys and seed order extended. **Absence of rows means no constraint** (an installer with no skill rows is eligible for any trade), so existing DEV data keeps working.

## Behaviour

| Function | Effect |
|---|---|
| `_rpSetSkill` | Upsert `SK-<person>-<skill>`; installers only; enum checks; audited; idempotent per command |
| `_rpSetAvailability` / `_rpCancelAvailability` | Leave periods; returns overlapping active allocations (`replan_required`); `Available` type never conflicts |
| `_rpUpsertTeam` / `_rpSetTeamMember` / `_rpTeams` | Flexible teams; one active Lead per team; installers only |
| `_rpAssess` | Pure readiness assessment for a trade and date range: skill match, leave, office holidays, capacity per staffed day (reusing S11's rules), window; ranked (ready → Lead → least loaded); team mode reports `all_ready` and `lead_ready` |
| `_rpChangeInstallerOptions` | Ranked candidates for a work package's dates excluding the allocation being replaced, plus team suggestions |
| `_rpMoveJobPreview` | Read-only impact of proposed dates: per-person readiness at the new dates, preserved packages, calendar links affected, material need-by flags, scaffold erect/strip impacts and re-acknowledgement; `ok_to_move` |
| `_rpTeamPlanner` | Team-grouped allocations and leave over a window, plus unassigned installers |
| `_rpStatus` | Table presence, installers with/without skills and capacity, active teams |

Configuration mutations require the actor to be an active Admin/Manager/Office person (People.role or active PersonRoles), DEV sheet/env, CommitJournal `CJ-RP-<command_id>` idempotency and AuditEvents (`executing_service: ResourcePlanning`).

## S11 integration (authoritative at commit time)

`s11/planner.js` now refuses with `NeedsReview` when the chosen installer is on leave (`ON_LEAVE`, from `PersonAvailability`) or has skills configured that do not include the package trade (`SKILL_MISMATCH`). The lookups are optional: if the tabs do not exist in a DEV sheet the checks fail open to "no constraint", so the bridge and S17 stores (which throw on missing tabs) never break planning. Detail is returned on the result. Rebuilt bundles: `apps-script/s11/S11Planner.js`, `standalone-bridge/AppSheetBridge.js`, `apps-script/r1-appsheet/R1AppSheetAdapter.js`.

## Cloud entry points (`apps-script/resource/ResourcePlanning.js`)

The store maps columns by **header name**, so tabs the browser agent already created may carry extra or reordered columns; only the schema columns are required.

| Function | Purpose |
|---|---|
| `runRpProvisionCheck()` | Which of the four tabs exist; missing/extra columns vs schema |
| `runRpProvisionMissingTabs()` | Additive: create only missing resource tabs (headers, plain text, frozen row) and add only missing columns. Never touches other tabs. Idempotent |
| `runRpStatus()`, `runRpTeams()`, `runRpTeamPlanner(start, weeks)` | Read-only |
| `runRpAssess(trade, start, end, teamId)` | Readiness assessment |
| `runRpChangeInstallerOptions(workPackageId, oldAllocationId)` | Change Installer journey data |
| `runRpMoveJobPreview(jobId, 'Roof,Scaffold', start, end, erect, strip)` | Move Job preview data |
| `runRpHappyPathTest()` | Synthetic smoke (two synthetic installers, skills, leave, one team; assessment shows reasons); leaves rows inactive; refuses until tabs are provisioned; requires the signed-in user to be an active People row with a configuration role |

Build `npm run build:resource`; tests `npm run test:resource` (`tests/resource.test.cjs`, 12 incl. a cloud simulation with a pre-existing reordered `TeamMembers` tab).

## DEV cloud steps (pending — no browser/Apps Script access in this session)

1. Paste `apps-script/resource/ResourcePlanning.js`, rebuilt `apps-script/s11/S11Planner.js` and the standalone bridge.
2. `runRpProvisionCheck()` — compare with whatever the browser agent created; then `runRpProvisionMissingTabs()` (additive only).
3. `runRpHappyPathTest()` signed in as an Admin/Manager/Office person.
4. Enter real skills and leave through the AppSheet UI items (still open) or `_rpSetSkill`/`_rpSetAvailability`; create teams only from real crew information supplied by the business.
5. Wire AppSheet: Change Installer picker from `runRpChangeInstallerOptions`, Move Job preview from `runRpMoveJobPreview`, team planner view from `runRpTeamPlanner`.

## Not done

- AppSheet UI for PersonSkills/PersonAvailability/Teams and the planner/Move/Change journeys (browser).
- Per-team capacity warnings beyond per-person capacity (spec: optional) — team assessment reports readiness, not a team-level capacity number.
- Real installer skills/leave/teams data (business inputs).
