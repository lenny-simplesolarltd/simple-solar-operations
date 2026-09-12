# Autonomous Build Backlog

- [ ] Finish PersonSkills configuration
- [ ] Finish PersonAvailability configuration
- [ ] Implement flexible Teams / TeamMembers
- [ ] Make planner skill-aware
- [ ] Make planner leave-aware
- [ ] Make planner team-aware
- [ ] Improve Move Job UX
- [ ] Improve Change Installer UX

- [ ] Implement DEV calendar write service
- [ ] Persist calendar event IDs
- [ ] Idempotent calendar create
- [ ] Calendar update on move
- [ ] Calendar cancellation handling
- [ ] Calendar audit/error recovery

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