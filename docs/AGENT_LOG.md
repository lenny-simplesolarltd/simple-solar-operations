# Agent log

Chronological record of autonomous implementation batches. Newest last. Each entry: what was inspected, what changed, how it was tested, what cloud/browser configuration it needs, and what remains.

## 2026-09-12 — Batch 1 (Claude): Processing heartbeat

- Inspected: S16 health/backup/archive, S17 admin status, processor outbox/health, request-row bridge, S10/S11 staffed-day helpers.
- Implemented: `s16/heartbeat.js` — last successful processing per component as HealthChecks `Processing:<component>` rows; Fresh/Stale/Failing/Quiet/Never states; staffed-window staleness (office weekdays, office hours, Holidays); alerts merged into `_s16HealthStatus`; fail-safe wrapper; hourly tick; cloud entry points `runS16HeartbeatStatus/RecordHeartbeat/Tick/Smoke`; fixture reset removes smoke rows.
- Tests: `tests/s16-heartbeat.test.cjs` 16 pass; full suite 691/691.
- Cloud/browser: NOT RUN. Needs bundle paste of `apps-script/s16/S16Health.js`, `runS16HeartbeatSmoke()`, optional hourly trigger on `runS16HeartbeatTick()`.
- Commit: `42b1b8e`.

## 2026-09-12 — Batch 2 (Claude, sole agent): DEV Calendar write service

- Context: user made Claude the sole implementation agent for backend and browser work. No Chrome/browser tool is available in this session (ToolSearch for browser/chrome returned nothing), so browser configuration steps are documented per batch and flagged as blocked rather than performed.
- Inspected: S11 planner calendar capture (CalendarLinks/Outbox CalendarCreate/Update/Cancel), S15 cancellation calendar rows, OutboundGuard allowlist model, S16 cloud adapter/lock pattern, cross-bundle namespace and duplicate-identifier tests.
- Implemented: `calendar/service.js` + `calendar/cloud-adapter.js` → `apps-script/calendar/CalendarSync.js`. Drains Calendar* Outbox rows into the exact DEV calendar via an injectable adapter. Gates: DEV sheet/env, FN-02 Automated/Pilot/R2, `S01_CONFIG.calendarMode === 'LIVE'` (default CAPTURE sends nothing), target must equal the hardcoded DEV calendar ID and be allowlisted. Processing marked before the call; tag-based reconcile prevents duplicate creates after uncertain attempts; backoff 1/2/4/8/16 min then NeedsReview; EVENT_MISSING/UNCERTAIN_OUTCOME/DUPLICATE_EVENTS to review; stalled Processing recovery; every outcome audited; human review resolution (AdoptEvent/MarkCancelled/Retry) idempotent per command; explicit audited DEV calendar assignment for installers; dry run in any mode; `only_outbox_ids` so the live smoke touches only its own rows.
- Tests: `tests/calendar.test.cjs` 21 pass including a zero-arg cloud simulation with a CalendarApp stub asserting only the DEV calendar id is ever addressed; full suite green.
- Cloud/browser: BLOCKED in this session. Steps listed in `docs/CALENDAR-implementation.md` (paste bundle, confirm `S01_CONFIG.allowedCalendarIds`, `runCalStatus()`, `runCalDispatchDryRun()`, set `calendarMode` LIVE for `runCalLiveDevSmoke()`, assign installer calendars, restore).
- Decisions: calendar ID hardcoded to DEV (runbook "DEV calendar only"); no guests invited; cancellation deletes the DEV event (runbook "cancel or mark appropriately"); S15 cancellation rows stay human-reviewed as designed, with Retry handing deletion to the service.

## 2026-09-12 — Batch 2b (Claude): shared DEV calendar decision applied

- Decisions received from the user (browser agent confirmed): TeamMembers.role enum = Lead/Member/Apprentice; DEV uses one shared calendar only; do not depend on People.calendar_id; WorkPackages.trade constrained to Roof/Electrical. Recorded in AGENT_RUNBOOK.md "Confirmed decisions".
- Changed: `s11/planner.js` queues every CalendarLink against `S11_SHARED_CALENDAR_ID` (the DEV calendar) and no longer refuses when `People.calendar_id` is missing; Move Job queues calendar updates for every active allocation. `calendar/service.js` drops the People.calendar_id assignment function; new `RetargetDev` review resolution repairs legacy placeholder links. Bundles rebuilt (S11, standalone bridge, R1 AppSheet adapter, calendar).
- Tests: calendar tests now prove the flow with `People.calendar_id = NOT_CONFIGURED`; full suite green.
- Flag: S11 Move Job still maps the `Return` activity to a `ReturnVisit` work-package trade string, which is outside the confirmed Roof/Electrical constraint. Left unchanged pending an intentional migration decision (runbook taxonomy rule).

## 2026-09-12 — Batch 3 (Claude): scaffold backend

- Inspected: S09 scaffold evaluation/booking (synthetic company, SCA01 only), S11 Move Job scaffold activity, S15 cancellation scaffold handling, S16 archive scaffold blocker, S17 scaffold summary/queue, spec §4/§9 and SCA01–SCA05 definitions (extracted from the DOCX), Communications/Acknowledgements/Issues schema.
- Implemented: `scaffold/workflow.js` + `scaffold/cloud-adapter.js` → `apps-script/scaffold/ScaffoldWorkflow.js`: real scaffolder configuration; booking lifecycle Requested→Confirmed→Erected→StripAuthorised→StripPlanned→StripConfirmed→Stripped/Cancelled with revision + `confirmed_revision`; captured Draft communications + Acknowledgements; SCA01–SCA05 tasks with London day-start/day-end/lead-time/Friday-12:00 due rules; strip gates (customer happy, erected, no strip-blocking issues); complaints in Issues (strip never closes them); chase; weekly lists; booking view; planner rows. `s11/planner.js` planner now returns `scaffold` rows; S11 bundle headers extended. Seed: SCA02–SCA05 TaskTemplates added exactly as specified; embedded seed regenerated (drift test green).
- Tests: `tests/scaffold.test.cjs` 18 pass; full suite 730/730.
- Cloud/browser: BLOCKED. Steps in `docs/SCAFFOLD-implementation.md` (add four SCA template rows to DEV sheet via controlled path, paste ScaffoldWorkflow + rebuilt S11Planner, run `runScfHappyPathTest()`, restore).
- Decisions: cancellation of erected scaffold refused (must strip); UnsafeConcern complaints block strip by default (other categories do not, caller may set); weekly list week starts Monday on/before the date, Sunday rolls forward; synthetic scaffolder allowed only for synthetic jobs.

## 2026-09-12 — Batch 4 (Claude): materials backend

- Inspected: S07 ordering (Draft orders per merchant, MAT01), S08 picking (ledger, reservations), S15 cancellation order handling, S17 materials queue, spec §4 tables and MAT01–MAT06 definitions with the worked delivery-date example, Deliveries/ReceiptLines/StockMovements/Evidence schema (unused until now).
- Implemented: `materials/workflow.js` + `materials/cloud-adapter.js` → `apps-script/materials/MaterialsWorkflow.js`: requirements (product/Other, merchant default, need-by via delivery rule, lead-time risk, MAT02/MAT03), orders per merchant + work type with MAT01, send (immutable snapshot, MAT06), confirm (supplier reference, acknowledgement, Deliveries row, MAT04 for Store owner), revise (new revision, re-acknowledgement, urgent inside lead time, delivery/MAT04 moved), cancel (materials released, merchant notice for sent orders), receive (ReceiptLines, Receipt/Damage stock movements with idempotency keys, short/damaged Supply issues, delivery-note Evidence, PartReceived/Received, follow-up delivery), Friday merchant lists (MAT05 + MAT06), order view, store queue. Seed: MAT02, MAT03, MAT04, MAT06 added exactly per spec; embedded seed regenerated.
- Tests: `tests/materials.test.cjs` 16 pass (spec example 4 Nov → 29 Oct → 23 Oct verified); full suite 746/746.
- Cloud/browser: BLOCKED. Steps in `docs/MATERIALS-implementation.md`.
- Decisions: `quantity_short` is an explicit merchant shortfall (raises an issue) while any other outstanding quantity is a balance to follow (follow-up delivery); build-orders replay identity is job + command id, not the derived material set; Other lines without a stock-tracked product create no ledger movement; received orders cannot be cancelled (return/credit review instead).

## 2026-09-12 — Batch 5 (Claude): resource planning backend

- Inspected: spec (no skills/availability/team tables defined; People capacity advisory; "capacity warnings optional and per person/team"), S11 validation/capacity rules, provisioner additive capabilities, bridge/S17 store behaviour on missing tabs (throws), schema test audit rules, absence of any repo definition for PersonSkills/PersonAvailability/Teams despite runbook STATUS.
- Implemented: additive schema tables PersonSkills, PersonAvailability, Teams, TeamMembers (64 tables; embedded schema regenerated; provisioner/adapter tests made count-agnostic). `resource/planning.js` + cloud adapter with header-name-mapped store and `runRpProvisionMissingTabs` (creates only missing tabs/columns). S11 now leave-aware (`ON_LEAVE`) and skill-aware (`SKILL_MISMATCH`, only when skills are configured), reading the new tables optionally so missing tabs never break planning; NeedsReview results carry detail. Readiness assessment, change-installer options, Move Job preview, team planner, status.
- Tests: `tests/resource.test.cjs` 12 pass; full suite 758/758.
- Cloud/browser: BLOCKED. Steps in `docs/RESOURCE-implementation.md`. The DEV sheet may already contain tabs created by the browser agent; `runRpProvisionCheck()` reports missing/extra columns before anything is added.
- Decisions: PersonSkills.level reuses the confirmed Lead/Member/Apprentice enum; skills limited to Roof/Electrical; teams may be Mixed; one active Lead per team; configuration actors must be active Admin/Manager/Office people; no team compositions seeded.

## 2026-09-12 — Batch 6 (Claude): real Drive data backups + restore procedure; backlog reconciliation

- Inspected: S16 backup (count-only manifest, optional Drive manifest file) and restore (dry-run, always blocked), S16 Drive adapter contract and fake Drive in tests, ReportSnapshots schema. Evidence for reconciliation: S10 reminder holiday-aware via staffed-day helper; S12 commissioning/handover frameworks; S13/S14/S06 finance stages and chase tasks; S16 archive/reopen; S16/S17 health.
- Implemented: `backup/service.js` + cloud adapter → `apps-script/backup/BackupService.js`: full-data JSON export of all 64 tables to the configured DEV Drive folder with DataBackup manifest and audit; read-back verification; compare; retention review (no deletion); non-destructive restore rehearsal into a NEW spreadsheet (REHEARSAL mode + confirm token; DEV workbook never written); in-place restore refused by construction; daily idempotent backup entry point. Cloud store restricted to ReportSnapshots/AuditEvents writes.
- Tests: `tests/backup.test.cjs` 10 pass (incl. Drive/Spreadsheet stubs proving DEV tables untouched); full suite 768/768.
- Cloud/browser: BLOCKED. Steps in `docs/BACKUP-implementation.md`.
- Backlog reconciled as done with pointers: Commissioning framework, Missing commissioning reminder, Handover framework, 25/35/40 finance workflow, Payment status, Payment call tasks, Health dashboard, Archive/restore.

## 2026-09-12 — Batch 7 (Claude): resilience review, failure alerts, Xero adapter (disabled)

- Inspected: spec §3 outbox/uncertain outcome rules and dashboard indicators, RA01 (review tasks for uncertain outcomes, failure alerts, manual check), finance rules (Zapier/Xero route, stored ids, never delete authorised invoices, manual bank confirmation never fabricated), S13 intents and statuses, S17 outbox reads.
- Implemented: `resilience/review.js` (+ cloud adapter) → unified review queue, RS-REVIEW/RS-RECOVERY tasks, RS-ALERT daily alerts, audited outbox resolution; `xero/adapter.js` (+ cloud adapter) → envelopes from S13 intents, DISABLED-by-default dispatch requiring LIVE config + FN-09 pilot + injected transport (none exists; no HTTP client or endpoint anywhere), idempotent invoice/payment callbacks, review/cancel task. Build `scripts/build-resilience.cjs` → `apps-script/resilience/ResilienceReview.js`, `apps-script/xero/XeroAdapter.js`.
- Tests: `tests/resilience.test.cjs` 11 pass; full suite 779/779.
- Cloud/browser: BLOCKED. Steps in `docs/RESILIENCE-implementation.md`.
- Decisions: review/alert task codes are module defaults (no new seed templates); calendar outbox rows stay with the calendar service; uncertain Xero outcomes go straight to review, transient errors retry up to 3 times; a Confirmed stage keeps its status on callback.

## 2026-09-12 — Batch 8 (Claude): installer mobile workflow backend

- Inspected: spec WorkPackages/Submissions/Evidence vocabularies, installer rules (assigned work only, report-then-confirm, no finance exposure), 04 S12 installer screen requirements (progress/variation/problem/return before final form, immutable versions, duplicate sync, cross-job denial), S10 INS01/INS02 scheduling and issue shape, S12 submission functions, seeded roles.
- Implemented: `installer/workflow.js` + cloud adapter → `apps-script/installer/InstallerWorkflow.js` (prefix `_iw`; `_ins` already existed). My-work read, start, progress, completion outcomes (ReportedComplete with commissioning Draft at `template_version: NOT_CONFIGURED`; ReturnRequired → Remedial issue, return package with the same trade + `parent_package_id`, dateless allocation for the original installer, REM01 + BKG02 for Tanya), problem/variation issues (ISS02/ISS01, VariationApprover owner), evidence dedup + cross-job denial, commissioning draft/resume/submit/supersede (Accepted checked first). AppSheet entry `appSheetInstallerCommand` takes the actor from the session and requires a device-generated command id.
- Tests: `tests/installer.test.cjs` 9 pass; full suite 788/788.
- Cloud/browser: BLOCKED. Steps in `docs/INSTALLER-implementation.md`.
- Decisions: return visits keep the original trade (confirmed Roof/Electrical constraint) instead of a ReturnVisit trade string; office actors may act on installer packages only with a reason; Safety/Technical problems block completion by default; a same-id command with different content is rejected.

## 2026-09-12 — Batch 9 (Claude): DEV integration walkthrough, TEST preparation, Apps Script manifest

- Implemented: `scripts/build-manifest.cjs` → `docs/generated/apps-script-manifest.{json,md}` (40 bundles: SHA-256, entry points, Google services, S01_CONFIG keys, DEV-id guards); `tests/manifest.test.cjs` (manifest drift, external-service allowlist — Calendar only in calendar/ and the S01 probe, Drive only in s16/ and backup/, HTTP only in the pre-existing s04-bridge — DEV-guard presence, walkthrough coverage of every smoke/restore entry point).
- Docs: `docs/DEV-integration-walkthrough.md` (ordered cloud script: config, seed rows, bundle pastes, per-service smokes with expected results and rollback, triggers, AppSheet wiring, evidence); `docs/TEST-deployment-preparation.md` (prerequisites, configuration contract, deployment manifest, triggers, and the finding that the 12 Sep services are DEV-locked by construction and need an approved environment-profile change before TEST).
- Backlog: DEV integration walkthrough and TEST deployment preparation marked done as documentation; role-specific UX cleanup, PersonSkills/PersonAvailability UI and Move/Change UX remain (browser). Full suite 791/791.
- Session summary: browser automation unavailable throughout; all cloud configuration steps are queued in the walkthrough and in each implementation doc. Stop condition reached for the remaining items: browser automation blocked.
