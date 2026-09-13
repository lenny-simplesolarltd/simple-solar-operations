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
3. Paste the rebuilt bundles into the bound project (one file each, names as in the manifest): `s11/S11Planner.js` (updated), `s16/S16Health.js` (updated), `calendar/CalendarSync.js`, `scaffold/ScaffoldWorkflow.js`, `materials/MaterialsWorkflow.js`, `resource/ResourcePlanning.js`, `backup/BackupService.js`, `resilience/ResilienceReview.js`, `xero/XeroAdapter.js`, `installer/InstallerWorkflow.js`, `r1-appsheet/R1AppSheetAdapter.js`. Paste the rebuilt `standalone-bridge/AppSheetBridge.js` into the standalone bridge project (see step 11 for the operations contract). Record the manifest `sha256` of each pasted file in the release record.

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

## 11. AppSheet operations contract — installer, commissioning, goods-in, quarantine (request-row path)

Architecture (unchanged): AppSheet form/request row → `DEV*Requests` helper table → standalone bridge `appSheetR1CommandFromRequestRow(commandType, rowId, USEREMAIL())` → authoritative backend (`installer/workflow.js`, `materials/workflow.js`, S12 review). Request rows are input only; the actor is the authenticated user, never a row value. Every command needs `expected_version`, is idempotent per `command_id` (fingerprinted), audited (`AuditEvents` `AE-R1C-*`, `CommitJournal` `CJ-R1C-*`), DEV-locked (`S01_CONFIG.environment/sheetId`), and has zero Xero/GHL/messaging effects.

**Bundles to paste (rebuilt):** `standalone-bridge/AppSheetBridge.js` (standalone bridge project), `apps-script/r1-appsheet/R1AppSheetAdapter.js`, `apps-script/installer/InstallerWorkflow.js`, `apps-script/materials/MaterialsWorkflow.js` (bound project). Record the manifest SHA-256 of each.

**Config:** add `"evidenceFolderId": "<DEV AppSheet upload root folder id>"` to `S01_CONFIG` in the standalone bridge project (already required for the bound project). Uploads are resolved read-only by relative path under that root; nothing is created, moved or shared.

**Provision request tables** (signed in as Admin/Manager, standalone bridge): `runR1CRequestProvisionCheck()` (read-only plan) then `runR1CProvisionRequestTables()` (additive, repeatable). Exactly four tabs: `DEVInstallerCommandRequests`, `DEVGoodsInRequests`, `DEVGoodsInRequestLines`, `DEVStockCommandRequests`. Extra AppSheet-added columns are tolerated; required headers must exist.

**ReleaseModes for the pilot:** FN-06 Automated/Pilot/R3 (installer commands), FN-07 Automated/Pilot/R3 (`COMMISSIONING_REVIEW`), FN-03 + FN-05 Automated/Pilot/R2 (`GOODS_IN_RECEIVE`), FN-05 (`STOCK_QUARANTINE`). Use `runIwEnableFn06ForSyntheticTest()`, `runS12EnableFunctionsForSyntheticTest()`, `runMatEnableFunctionsForSyntheticTest()`; restore with the matching `restore*SafeState()` after the pilot.

**Reads (no request row):** `appSheetR1Read(json, USEREMAIL())` with `{"read_type":"INSTALLER_WORKFLOW","work_package_id":"<id>"}` (status, `expected_version`, current submission + `expected_version`, approved questions, evidence), `{"read_type":"GOODS_IN_DETAIL","payload":{"delivery_id":"<id>"}}` (order `expected_version`, lines with outstanding quantities), `{"read_type":"STOCK_BALANCE","payload":{"product_id":"<id>"}}` (product `expected_version`, store/quarantine balances). Use these to fill `expected_version` before submitting a request row. The existing `My Installs` slice stays the assigned-work list.

**Commands (request tables → `command_type`):**

| Table | `command_type` values | Actor rule | Notes |
|---|---|---|---|
| `DEVInstallerCommandRequests` | `IW_START`, `IW_PROGRESS`, `IW_REPORT_COMPLETION`, `IW_REPORT_PROBLEM`, `IW_REPORT_VARIATION`, `IW_COMMISSIONING_DRAFT`, `IW_COMMISSIONING_SUBMIT`, `COMMISSIONING_REVIEW` | allocated installer, or Office/Manager/Admin with `reason`; review is Office/Manager/Admin only | `submitted_by` = `USEREMAIL()` (initial value, not editable); `evidence_path` = the Image/File column's relative path; one answer per row for drafts (`question_key` + value column, `submission_id` + `expected_submission_version` from the read) |
| `DEVGoodsInRequests` + `DEVGoodsInRequestLines` | `GOODS_IN_RECEIVE` | Store/Office/Manager/Admin | parent carries `job_id`, `delivery_id`, `expected_version` (order), `line_count`, `delivery_note_reference`, `delivery_note_path`; children carry `request_id`, `order_line_id`, good/damaged/short quantities; the bridge refuses until `line_count` equals the synced child rows |
| `DEVStockCommandRequests` | `STOCK_QUARANTINE` | Store/Manager/Admin | `product_id`, `expected_version` (product), `expected_balance` (from `STOCK_BALANCE`), `quantity`, `reason`; store → quarantine only |

**AppSheet wiring per table:** (1) add the tab as a data source with `id` as key (AppSheet `UNIQUEID()`), `command_id` initial value `UNIQUEID()` (device-generated, keeps offline resubmission idempotent), `submitted_by` initial value `USEREMAIL()` with Editable? = false, `status` initial value `Draft`; (2) form view per command family; (3) a "Submit" action sets `status` to `Ready` (for goods-in, only after all child lines exist and `line_count = COUNT([Related DEVGoodsInRequestLines])`); (4) bot: when `status` changes to `Ready` → Call a script on the standalone bridge `appSheetR1CommandFromRequestRow([command_type], [id], USEREMAIL())` (for goods-in pass `"GOODS_IN_RECEIVE"`; for quarantine `"STOCK_QUARANTINE"`), then a second step sets `status` to `Done` or `Error` from the returned `ok`; optionally add a `result_message` column to store the returned JSON — extra columns are tolerated. Never let the bot pass a row-supplied email.

**Smoke in DEV (after provisioning):** signed in as an installer allocated to a pilot package: create a `DEVInstallerCommandRequests` row (`IW_START`, `expected_version` from `INSTALLER_WORKFLOW`), submit; expect `ok:true`, `status:"InProgress"`, a `CJ-R1C-<command_id>` Committed journal row and an `AE-R1C-<command_id>` audit row; submit the same row again → `replay:true`, no new rows. Signed in as Store: one goods-in parent + N lines → `receipt_lines` = N, order `Received`/`PartReceived`, stock movements to `LOC-store`/`LOC-quarantine`. Any run with `S01_CONFIG.environment` ≠ `DEV` → `R1C_DEV_ONLY`.

## 12. Evidence to capture

For each step: the JSON result printed by the function, the signed-in identity, the timestamp, and (for steps 6 and 9) a screenshot or link of the DEV calendar / Drive file. Store under `docs/evidence/` following `docs/evidence/README.md`. Update `docs/implementation-status.md` rows from "DEV CLOUD NOT YET RUN" only with real results.
