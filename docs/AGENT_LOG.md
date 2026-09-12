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
