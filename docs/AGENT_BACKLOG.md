## Active agent ownership

Updated 12 Sep 2026: Claude is the sole implementation agent (backend + browser/UI). No Codex-owned lanes remain.

CLAUDE:
- all backend/code items
- all DEV AppSheet / Sheets / Apps Script / Calendar configuration (browser automation currently BLOCKED in the Claude Code session — no Chrome tool available; cloud steps are documented per batch in docs/AGENT_LOG.md and the stage implementation docs)

# Autonomous Build Backlog

- [ ] Finish PersonSkills configuration
- [ ] Finish PersonAvailability configuration
- [ ] Implement flexible Teams / TeamMembers
- [ ] Make planner skill-aware
- [ ] Make planner leave-aware
- [ ] Make planner team-aware
- [ ] Improve Move Job UX
- [ ] Improve Change Installer UX

- [x] Implement DEV calendar write service — CLAUDE 12 Sep 2026: `calendar/service.js` drains S11/S15 Calendar* Outbox rows into the exact DEV calendar via injectable adapter; gated by DEV sheet/env, FN-02 Automated/Pilot, `S01_CONFIG.calendarMode=LIVE` (default CAPTURE sends nothing), hardcoded DEV calendar + allowlist; S11 targets the single shared DEV calendar (People.calendar_id unused, confirmed 12 Sep). 21 tests. DEV cloud smoke NOT RUN (browser blocked). See docs/CALENDAR-implementation.md.
- [x] Persist calendar event IDs — CLAUDE 12 Sep 2026: `CalendarLinks.external_event_id/event_uid`, `Outbox.external_id`, `last_success_at`, `last_synced_revision` written on every success.
- [x] Idempotent calendar create — CLAUDE 12 Sep 2026: Processing marked before the call; `[SSO:<link id>]` tag reconcile adopts an existing event after uncertain attempts; duplicates → NeedsReview.
- [x] Calendar update on move — CLAUDE 12 Sep 2026: S11 move/replace rows update the same event id; missing event → EVENT_MISSING review, never a silent recreate.
- [x] Calendar cancellation handling — CLAUDE 12 Sep 2026: replace-installer and S15 cancellations delete the DEV event (or succeed safely when absent); S15 rows stay human-reviewed with Retry/MarkCancelled/AdoptEvent.
- [x] Calendar audit/error recovery — CLAUDE 12 Sep 2026: AuditEvents per outcome, backoff 1/2/4/8/16 min then NeedsReview, stalled-Processing recovery, `_calResolveReview` idempotent per command, `_calStatus` review queue.

- [ ] Scaffold company/config model
- [ ] Scaffold booking workflow
- [ ] Scaffold planner integration

- [ ] Materials requirements workflow
- [ ] Merchant order workflow
- [ ] Received/store workflow
- [ ] Ordering evidence

- [ ] Installer mobile workflow
- [ ] Completion evidence
- [ ] Remedials/issues

- [ ] Commissioning framework
- [ ] Missing commissioning reminder
- [ ] Handover framework

- [ ] 25/35/40 finance workflow
- [ ] Payment status
- [ ] Payment call tasks
- [ ] Xero adapter disabled by default

- [ ] Health dashboard
- [x] Processing heartbeat — CLAUDE 12 Sep 2026: `s16/heartbeat.js` records last successful processing per component (HealthChecks `Processing:<component>`), staffed-window staleness, Fresh/Stale/Failing/Quiet/Never states, alerts merged into S16 health; cloud entry points `runS16HeartbeatStatus/RecordHeartbeat/Tick/Smoke`; 16 local tests. DEV cloud smoke and hourly trigger not yet run/installed. See docs/S16-implementation.md.
- [ ] Failure alerts
- [ ] Outbound uncertain state handling
- [ ] Real Drive backups
- [ ] Restore procedure
- [ ] Archive/restore

- [ ] Role-specific UX cleanup
- [ ] DEV integration walkthrough
- [ ] TEST deployment preparation