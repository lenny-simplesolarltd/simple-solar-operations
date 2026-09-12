# DEV integration walkthrough — ordered cloud script

Status 12 September 2026: **every step below is PENDING.** No browser or Apps Script access existed in the implementing session, so nothing here has been executed. The order matters; each step names its zero-arg functions, expected results and rollback. Reference: `docs/generated/apps-script-manifest.md` (bundle hashes, entry points, services, config keys).

Safety rules for the whole walkthrough: DEV only (`S01_CONFIG.environment === "DEV"`, bound DEV sheet `1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc`). Never run `runS02Apply`. Run every `restore*SafeState()` even if a step fails. Nothing here enables Xero, GHL, payments or customer messaging; the only external writes are the DEV calendar (step 6, opt-in) and the DEV Drive backups folder (step 9).

## 0. Preconditions

1. Open the bound DEV Apps Script project (Script ID in `docs/AGENT_RUNBOOK.md`). Confirm Script Property `S01_CONFIG` exists and extend it:

```json
{
  "environment": "DEV",
  "sheetId": "1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc",
  "backupFolderId": "<DEV Shared Drive Backups folder id>",
  "allowedCalendarIds": ["c_78af3ebb19540667b0e233ef74f02738e5a813073a6c55ee33898aacb3f39b91@group.calendar.google.com"],
  "calendarMode": "CAPTURE",
  "restoreMode": "DISABLED"
}
```

Do not add `xeroMode`. Leave existing keys untouched.

2. Add the four spec task templates not yet in the DEV sheet through the controlled seed path, or insert the rows from `schema/config-seed.json`: `SCA02`–`SCA05`, `MAT02`, `MAT03`, `MAT04`, `MAT06`. Expected: `TaskTemplates` has 28 rows with these codes active.
3. Paste the rebuilt bundles into the bound project (one file each, names as in the manifest): `s11/S11Planner.js` (updated), `s16/S16Health.js` (updated), `calendar/CalendarSync.js`, `scaffold/ScaffoldWorkflow.js`, `materials/MaterialsWorkflow.js`, `resource/ResourcePlanning.js`, `backup/BackupService.js`, `resilience/ResilienceReview.js`, `xero/XeroAdapter.js`, `installer/InstallerWorkflow.js`. Paste the rebuilt `standalone-bridge/AppSheetBridge.js` into the standalone bridge project. Record the manifest `sha256` of each pasted file in the release record.

## 1. Heartbeat (S16) — FN-14

`runS16EnableFunctionsForSyntheticTest()` → `runS16HeartbeatSmoke()` (expect `pass: true`, component `S16Smoke` Fresh → Failing → Fresh) → `runS16HeartbeatTick()` twice (second is `replay: true`) → `runS16HeartbeatStatus()` → `restoreS16SafeState()`. Optional: hourly time-driven trigger on `runS16HeartbeatTick`.

## 2. Resource planning tabs — additive schema

`runRpProvisionCheck()` first and read the result: tabs the browser agent already created appear with `extra_columns`/`missing_columns`. Then `runRpProvisionMissingTabs()` (creates only missing tabs/columns; idempotent). Signed in as an Admin/Manager/Office person: `runRpHappyPathTest()` (expect `pass: true`; leaves synthetic rows inactive). `runRpStatus()`, `runRpTeams()`, `runRpTeamPlanner('2026-09-14', 3)`.

## 3. Planner reads (S11) — FN-01/FN-02

`runS11FixtureDryRun()` → `runS11HappyPathTest()` (replay-safe) → confirm `PLANNER_3_WEEKS` via the R1 adapter now returns a `scaffold` array alongside `rows`.

## 4. Scaffold workflow — FN-04

`restoreScfSafeState()` → `runScfScaffolders()` (expect only the synthetic company until Ben supplies real scaffolders) → `runScfHappyPathTest()` (expect statuses Requested → Confirmed → Erected → Blocked → StripAuthorised → StripPlanned → StripConfirmed → Stripped; complaint remains Open) → `restoreScfSafeState()`. When real scaffolder details arrive: `runScfConfigureScaffolder(companyId, name, leadDays, contactName, contactEmail, contactPhone)`. Optional triggers: daily `runScfChase`, Friday `runScfWeeklyList`.

## 5. Materials workflow — FN-03 / FN-05

`restoreMatSafeState()` → `runMatHappyPathTest()` (expect two orders Roof/Greentech and Electrical/CEF, roof order PartReceived then Received, one quarantine movement, one Supply issue, replay true) → `runMatStoreQueue()` → `restoreMatSafeState()`. Optional Friday trigger `runMatWeeklyList`.

## 6. Calendar write service — FN-02 (the only external write besides backups)

With `calendarMode: "CAPTURE"`: `runCalStatus()` (expect `live_ready: false`), `runCalDispatchDryRun()` (preview; legacy `CAL-S11-CAPTURE` links show `NeedsReview:CALENDAR_TARGET_NOT_DEV` — fix with `runCalResolveReview(outboxId, 'RetargetDev', null, reason)` or `MarkCancelled`). Then set `calendarMode: "LIVE"` and run `runCalLiveDevSmoke()` (creates, updates and deletes one synthetic all-day event on the DEV calendar; expect `pass: true` and a clean calendar afterwards). For a pilot: `runCalEnableFn02ForSyntheticTest()` → `runCalDispatch()` → inspect the DEV calendar → `restoreCalSafeState()`. Set `calendarMode` back to `"CAPTURE"` when not piloting. Optional hourly trigger `runCalDispatch` (DEV only, after the smoke).

## 7. Installer workflow — FN-06 (R3)

Signed in as a People row holding an Installer role: `runIwEnableFn06ForSyntheticTest()` → `runIwHappyPathTest()` (expect InProgress → ReportedComplete → Submitted, `template_version: NOT_CONFIGURED`) → `restoreIwSafeState()`. AppSheet installer app: My Work from `runIwMyWork`, buttons calling `appSheetInstallerCommand(commandType, payloadJson)` with a device-generated `command_id`.

## 8. Resilience review + Xero (disabled)

`runRsReviewQueue()` → `runRsSweep()` (creates RS-REVIEW/RS-ALERT tasks for anything uncertain; idempotent) → resolve with `runRsResolveOutbox(outboxId, resolution, externalId, reason)`. Optional 30-minute trigger `runRsSweep`. `runXoRequests()` and `runXoDispatch()` must both report `DISABLED` and zero external calls; do not set `xeroMode`.

## 9. Backups and restore rehearsal — FN-14

`runBkStatus()` → `runBkHappyPathTest()` (writes one JSON data backup to the Drive folder, verifies, compares; rehearsal skipped unless `restoreMode` is `REHEARSAL`). Daily trigger `runBkDailyBackup`. For one rehearsal: set `restoreMode: "REHEARSAL"`, `runBkRestoreRehearsal(backupId, reason)`, open the new spreadsheet, then set `restoreMode` back to `"DISABLED"`. The service refuses in-place restore.

## 10. AppSheet wiring (browser)

Follow `docs/R1-office-appsheet-configuration.md` for R1, then: Scaffolding view from `runScfPlannerRows`/`runScfBookingView`; Materials/Store views from `runMatRequirements`, `runMatOrderView`, `runMatStoreQueue`; Change Installer picker from `runRpChangeInstallerOptions`; Move Job preview from `runRpMoveJobPreview`; Team planner from `runRpTeamPlanner`; PersonSkills/PersonAvailability/Teams editors on the provisioned tabs; Review queue from `runRsReviewQueue`; installer screens from step 7. Record each AppSheet change in the release record.

## 11. Evidence to capture

For each step: the JSON result printed by the function, the signed-in identity, the timestamp, and (for steps 6 and 9) a screenshot or link of the DEV calendar / Drive file. Store under `docs/evidence/` following `docs/evidence/README.md`. Update `docs/implementation-status.md` rows from "DEV CLOUD NOT YET RUN" only with real results.
