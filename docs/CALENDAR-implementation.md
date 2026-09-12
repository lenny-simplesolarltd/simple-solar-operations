# DEV Calendar write service — 12 September 2026

**LOCAL IMPLEMENTATION PASS (21 tests); DEV CLOUD NOT YET RUN.** Updated 12 Sep 2026 for the confirmed decision that DEV uses one shared calendar: S11 now queues every CalendarLink against the DEV calendar id and `People.calendar_id` is never consulted. Closes backlog items: DEV calendar write service, persist calendar event IDs, idempotent calendar create, calendar update on move, calendar cancellation handling, calendar audit/error recovery. No real Calendar call has been made from this repository. PROD is structurally unreachable: the only calendar the service will address is the hardcoded DEV calendar ID.

## What it does

S11 planning, moves and installer changes, and S15 cancellation, already queue `CalendarLinks` rows plus `Outbox` rows with action `CalendarCreate`, `CalendarUpdate` or `CalendarCancel` (CAPTURE_ONLY). This service drains those rows into the DEV Google Calendar.

| Source | Outbox action | Service behaviour |
|---|---|---|
| S11 plan | CalendarCreate | Create one all-day event; persist `external_event_id` and `event_uid`; link → Active |
| S11 move | CalendarUpdate | Update the existing event by id (title, dates, description); link → Active, `last_synced_revision` advanced |
| S11 replace installer | CalendarCancel (old) + CalendarCreate (new) | Delete the old event; create the new one |
| S15 cancellation | CalendarCancel (NeedsReview) | Human resolves: Retry → service deletes; MarkCancelled → closed without external change |

## Safety gates (all required before any external call)

1. Exact DEV sheet ID and DEV environment on the store.
2. FN-02 "Calendar entries" ReleaseMode is Automated/Pilot/R2. Disabled → refusal, no writes.
3. `S01_CONFIG.calendarMode === 'LIVE'`. Default (absent or anything else) is CAPTURE: due rows are reported and left Pending, nothing is sent.
4. Link `calendar_id` equals `CAL_DEV_CALENDAR_ID` **and** is listed in `S01_CONFIG.allowedCalendarIds`. Anything else → NeedsReview before any API call. An allowlisted non-DEV id is still refused. S11 sets `calendar_id` to the shared DEV calendar for every new link (`S11_SHARED_CALENDAR_ID`); legacy links carrying placeholder ids are fixed through the `RetargetDev` review resolution.
5. `Outbox.target` must agree with the link (or be `NOT_CONFIGURED`).
6. The default Apps Script adapter refuses any calendar id other than DEV before touching `CalendarApp`; a counting wrapper enforces the same on injected adapters.

## Idempotency and uncertain outcomes

- Outbox row is set to `Processing` and `attempt_count` incremented **before** the external call. A crash therefore leaves a visibly uncertain row.
- Every event carries the tag `[SSO:<calendar_link_id>]` in its description. When a row is retried after a prior attempt, the service first searches the DEV calendar for that tag and adopts an existing event instead of creating a second one. Two tagged matches → `DUPLICATE_EVENTS` NeedsReview.
- Transient exceptions → `RetryDue` with backoff 1, 2, 4, 8, 16 minutes; after 5 attempts → `NeedsReview MAX_RETRIES_EXCEEDED`. NeedsReview rows are never retried automatically.
- API results without an event id → `UNCERTAIN_OUTCOME` NeedsReview.
- Update whose event no longer exists → `EVENT_MISSING` NeedsReview (never a silent recreate). Create whose stale external id is missing → recreate.
- Cancel with no external id → Succeeded `NO_EXTERNAL_EVENT`; cancel of an already removed event → Succeeded `ALREADY_REMOVED`.
- `Processing` rows older than 15 minutes are recovered to `RetryDue` (audited `CalendarStalled`) so the next run reconciles them.
- Every outcome writes an `AuditEvents` row (`executing_service: CalendarService`, `correlation_id: <outbox id>`): CalendarCreate/Update/Cancel, `…Retry`, `…Failed`, `CalendarStalled`, `CalendarReview<Resolution>`.

## Human recovery

`_calResolveReview(store, {actor, command_id, outbox_id, resolution, external_event_id?, reason})` on NeedsReview/RetryDue/Processing rows:

| Resolution | Effect |
|---|---|
| AdoptEvent | Link takes the given event id, status Active (Cancelled for cancel rows); Outbox Succeeded |
| MarkCancelled | Link Cancelled, Outbox Cancelled; no external change |
| Retry | Link Pending/UpdatePending, Outbox Pending; next dispatch processes it |
| RetargetDev | Link `calendar_id` and Outbox target set to the shared DEV calendar, then re-queued as Pending (for links captured before the shared-calendar decision) |

Idempotent per `command_id` (replay returns `replay: true` and changes nothing).

## Functions

| Function | Purpose |
|---|---|
| `_calDispatch(store, {actor, config, api?, now?, limit?, dry_run?, only_outbox_ids?})` | Drain due Calendar* rows; dry run plans without writes in any mode |
| `_calStatus(store, {config?})` | Read-only: mode, FN-02 state, `live_ready`, outbox/link counts, review queue |
| `_calResolveReview` | See above |
| `runCalStatus()` / `runCalDispatchDryRun()` | Cloud read-only |
| `runCalDispatch()` | Cloud dispatch under ScriptLock; LIVE only when configured |
| `runCalResolveReview(outboxId, resolution, externalEventId, reason)` | Cloud review resolution |
| `runCalEnableFn02ForSyntheticTest()` / `restoreCalSafeState()` | FN-02 toggle for synthetic DEV tests only |
| `runCalLiveDevSmoke()` | Controlled DEV happy path: create → replay (no-op) → update → delete on one synthetic link, only its own rows, leaves the DEV calendar clean, restores FN-02 |

Source: `calendar/service.js`, `calendar/cloud-adapter.js`; bundle `apps-script/calendar/CalendarSync.js` via `npm run build:calendar`; tests `npm run test:calendar` (`tests/calendar.test.cjs`).

## Configuration contract (`S01_CONFIG` Script Property, DEV project)

```json
{
  "environment": "DEV",
  "calendarMode": "CAPTURE",
  "allowedCalendarIds": ["c_78af3ebb19540667b0e233ef74f02738e5a813073a6c55ee33898aacb3f39b91@group.calendar.google.com"]
}
```

Set `calendarMode` to `LIVE` only for the DEV smoke and DEV pilot. Leave CAPTURE otherwise. No seed or schema change was needed.

## DEV cloud steps (pending — browser/Apps Script access not available in this session)

1. Paste `apps-script/calendar/CalendarSync.js` into the bound DEV Apps Script project (Script ID in the runbook).
2. Confirm `S01_CONFIG` carries `allowedCalendarIds` with the DEV calendar and `calendarMode: "CAPTURE"`.
3. `runCalStatus()` — expect `live_ready: false`, FN-02 Disabled.
4. `runCalDispatchDryRun()` — preview S11/S15 rows; links captured before 12 Sep 2026 may show `NeedsReview:CALENDAR_TARGET_NOT_DEV` (placeholder `CAL-S11-CAPTURE`); resolve with `runCalResolveReview(outboxId, 'RetargetDev', null, reason)` or `MarkCancelled`.
5. Set `calendarMode` to `LIVE`; `runCalLiveDevSmoke()` — expect pass, then check the DEV calendar is clean.
6. `runCalEnableFn02ForSyntheticTest()` + `runCalDispatch()` for pilot jobs; `restoreCalSafeState()` afterwards.
7. Optional: hourly time-driven trigger on `runCalDispatch()` (DEV only, after the smoke passes).
8. Set `calendarMode` back to `CAPTURE` when not piloting.

## Not done

- No real Calendar call executed; cloud smoke pending.
- Guests are not invited (S11 payload `guests: []`); per-installer calendars are explicitly out of scope for DEV (confirmed decision).
- Scaffold calendar links (`scaffold_activity_id`) follow the same path once the scaffold workflow queues them.
