# R1 Office — AppSheet manual configuration (DEV)

**Authority:** build specification + user manual + this repo’s R1 AppSheet adapter.  
**Do not configure PROD.** Backend remains the security boundary; Show_If is presentation only.  
**Generated Apps Script to paste (DEV bound project):** `apps-script/r1-appsheet/R1AppSheetAdapter.js` and `apps-script/s05/S05Core.gs`. Paste `standalone-bridge/AppSheetBridge.js` into the standalone bridge. Rebuild with `npm run build:r1-appsheet`, `npm run build:s05`, `node scripts/build-standalone-bridge.cjs`.

Bot entry points: `appSheetR1Read(requestJson)`, `appSheetR1Command(requestJson)`.

**Verification:** ReadyToBook / Booked gate logic is **IMPLEMENTED / LOCAL PASS** in canonical Node tests. AppSheet UI wiring and DEV cloud smoke for these gates are **NOT RUN / BLOCKED** until the generated bundles below are pasted and the AppSheet steps in this doc are completed.

---

## 1. Data / connections

1. Open the **DEV** AppSheet app only.
2. Ensure the app connects to the **DEV** spreadsheet (`1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc`).
3. Require Google sign-in. Map users via **People.email** = `USEREMAIL()`.
4. Do **not** grant AppSheet Update permission on Jobs / Tasks / WorkPackages / Allocations / Materials for ordinary columns that the processor owns. Prefer **Read** + command bots.

### Recommended table Update permissions

| Table | Office role | Notes |
|---|---|---|
| Jobs | Read | Commands only for stage changes |
| Tasks | Read | Complete via `TASK_COMPLETE` |
| WorkPackages | Read | Move/Change via commands |
| Allocations | Read | |
| Customers | Read | Mismatches via Intake Review process |
| CustomerChanges | Read (+ Office update of resolution columns only if approved) | Accept/Keep/Correct later |
| Intake | Read | Review queue |
| ACTION bots | Run | `appSheetR1Command` |

---

## 2. Virtual columns / helpers (Jobs)

Add these **Virtual** columns on Jobs (App formula):

| Column | Formula | Purpose |
|---|---|---|
| `vc_job_id_copy` | `[job_id]` | Copyable human reference |
| `vc_expected_version` | `[version]` | Pass to commands |
| `vc_can_move` | `LOOKUP` against ACTION_AVAILABILITY bot result **or** stage check: `IN([workflow_stage], {"Booked","AwaitingInstallation","InProgress","BookingInProgress"})` | Button Show_If only |
| `vc_can_change_installer` | same stage set | Button Show_If only |

**Copy Job ID action (presentation):**
1. Behavior → New Action → Data: set the values of some columns in this row — **or** simpler: Detail view show `[job_id]` with **Copy to clipboard** if your AppSheet version supports it; otherwise instruct Tanya to select the field.
2. Label: `Copy Job ID`.
3. Place on Job Detail under Prebooking / Booking.

---

## 3. Slices

| Slice | Source | Row filter | Use |
|---|---|---|---|
| **My Tasks** | Tasks | `AND(OR([owner_id]=ANY(SELECT(People[id], [email]=USEREMAIL())), [backup_id]=ANY(SELECT(People[id], [email]=USEREMAIL()))), NOT(IN([status], {"Complete","Cancelled","NotRequired"})))` | Personal active work |
| **Team Tasks** | Tasks | `AND(NOT(IN([status], {"Complete","Cancelled","NotRequired"})), IN(LOOKUP(USEREMAIL(),"People","email","id"), SELECT(PersonRoles[person_id], AND([active]=TRUE, IN([role], {"Office","Admin","Manager"})))))` | Authorised team |
| **Booking In Progress** | Jobs | `[workflow_stage]="BookingInProgress"` | Queue |
| **Upcoming Booked** | Jobs | `IN([workflow_stage], {"Booked","AwaitingInstallation"})` | Upcoming |
| **Intake Review** | Intake | `[processing_status]="Review"` | Unknown ref / mismatches |
| **Planner Allocations Active** | Allocations | `[active]=TRUE` | Planner base |

Also prefer bots for **MY_TASKS** / **TEAM_TASKS** / **INTAKE_REVIEW** / **PLANNER_3_WEEKS** / **PLANNER_6_WEEKS** read types when wiring Home.

---

## 4. Views & navigation

Create / bind (DEV only):

1. **Home** — dashboard: overdue / due today / next 7 days from My Tasks (group by `due_class` if using bot enrichment).
2. **My Tasks** — table/deck on My Tasks slice. Sort: overdue first, then due_at.
3. **Team Tasks** — table on Team Tasks slice (Office/Admin only via Security Filter / view Show_If).
4. **Jobs** — searchable table; detail = Job Detail.
5. **Job Detail** — show identity (`job_id`, display_name, stage), customer, work packages, materials, scaffold, tasks, actions.
6. **Booking In Progress** — deck/table.
7. **Intake Review** — table with validation_errors.
8. **Planner 3 Weeks** — table or calendar-like deck driven by PLANNER_3_WEEKS bot (resource = person, surname/postcode from Job display_name, Roof/Electrical/Erect/Strip columns).
9. **Planner 6 Weeks** — same for 6 weeks.
10. **History** — Tasks where status in Complete/Cancelled/NotRequired (separate slice).

Navigation order: Home → My Tasks → Team Tasks → Booking In Progress → Jobs → Intake Review → Planner 3W → Planner 6W → Admin (Release modes / System status for Admin only).

---

## 5. Format rules (priority UI — text is authoritative)

Colour alone is **not** sufficient. Prefix titles or use a Visible text column `due_class_label`.

| Rule name | Expression | Text prefix | Suggested colour | Icon |
|---|---|---|---|---|
| OVERDUE | `AND(ISNOTBLANK([due_at]), DATE([due_at]) < TODAY())` | `OVERDUE — ` | `#B71C1C` | warning |
| DUE TODAY | `AND(ISNOTBLANK([due_at]), DATE([due_at]) = TODAY())` | `DUE TODAY — ` | `#E65100` | today |
| DUE TOMORROW | `AND(ISNOTBLANK([due_at]), DATE([due_at]) = TODAY()+1)` | `DUE TOMORROW — ` | `#F9A825` | schedule |
| NEXT 7 DAYS | `AND(ISNOTBLANK([due_at]), DATE([due_at]) > TODAY()+1, DATE([due_at]) <= TODAY()+7)` | `NEXT 7 DAYS — ` | `#1565C0` | event |
| NORMAL/LATER | `OR(ISBLANK([due_at]), DATE([due_at]) > TODAY()+7)` | `LATER — ` | `#546E7A` | low_priority |

Backend classes: `OVERDUE | DUE_TODAY | DUE_TOMORROW | NEXT_7_DAYS | NORMAL_LATER | NO_DUE` (`s05/priority.js` / S17 task summary).

---

## 6. Actions & forms (commands)

All commands go through **Apps Script bot** → `appSheetR1Command`. Never edit operational tables directly from AppSheet.

### Shared payload pattern

```
{
  "command_id": UNIQUEID(),
  "command_type": "...",
  "job_id": [id],
  "expected_version": [version],
  "payload": { ... }
}
```

### MOVE_JOB (Finish Move Job journey)

1. Behavior → New Action → **External: execute an Apps Script function** (or webhook bot calling `appSheetR1Command`).
2. Or: Form view **Move Job Form** on a helper table / input-only form with columns:
   - `activities` (EnumList: Roof, Electrical, Return, Scaffold)
   - `planned_start`, `planned_end` (Date)
   - `scaffold_erect`, `scaffold_strip` (Date, optional)
   - `reason` (LongText, required)
   - `expected_version` (Number, initial `[version]`)
3. On save, bot body:

```
CONCATENATE(
  "{\"command_id\":\"", UNIQUEID(),
  "\",\"command_type\":\"MOVE_JOB\",\"job_id\":\"", [id],
  "\",\"expected_version\":", [version],
  ",\"payload\":{\"activities\":", /* JSON array from EnumList */,
  ",\"planned_start\":\"", TEXT([planned_start],"YYYY-MM-DD"),
  "\",\"planned_end\":\"", TEXT([planned_end],"YYYY-MM-DD"),
  "\",\"scaffold_erect\":\"", IF(ISBLANK([scaffold_erect]),"",TEXT([scaffold_erect],"YYYY-MM-DD")),
  "\",\"scaffold_strip\":\"", IF(ISBLANK([scaffold_strip]),"",TEXT([scaffold_strip],"YYYY-MM-DD")),
  "\",\"reason\":\"", SUBSTITUTE([reason],"\"","'"), "\"}}"
)
```

4. **Show_If** (presentation):  
   `IN([workflow_stage], {"Booked","AwaitingInstallation","InProgress","BookingInProgress"})`  
   Prefer also checking ACTION_AVAILABILITY.read → `appsheet_commands.move_job.available`.
5. Only selected activities change; unrelated WorkPackage / Scaffold dates stay.

### CHANGE_INSTALLER

1. Form fields: `work_package_id`, `old_allocation_id`, `person_id` (Ref People where `role=Installer` AND `active`), `mode` (Replace|Add), `role` (optional Second), `reason`, `expected_version` (WorkPackages.version).
2. Command type `CHANGE_INSTALLER`; include `work_package_id` and `old_allocation_id` at top level.
3. **Never** type free-text emails into calendar guests — People Ref only.
4. Show_If: same stage set as Move Job + ACTION_AVAILABILITY `change_installer.available`.

### LINKTOFORM examples

```
LINKTOFORM("Move Job Form", "job_id", [id], "expected_version", [version])
LINKTOFORM("Change Installer Form", "job_id", [id], "work_package_id", [_THISROW].[WorkPackages pick], "expected_version", [WorkPackages].[version])
LINKTOFORM("Complete Task Form", "task_id", [id], "expected_version", [version])
```

### Other existing commands (already in adapter)

| Button | command_type | Key payload |
|---|---|---|
| Complete Task | TASK_COMPLETE | completion_note; evidence_path (PRE02/PRE04) or evidence_id fallback |
| Record Call | CALL_RECORD | type, outcome |
| Update Issue | ISSUE_UPDATE | action REASSIGN/TRANSITION |
| Create Issue | ISSUE_CREATE | helper row via `appSheetR1CommandFromRequestRow` |

### TASK_COMPLETE with office evidence upload (DEV only)

Create `DEVTaskCompleteRequests` in the DEV spreadsheet only, with these columns in order:

`id`, `command_id`, `task_id`, `expected_version`, `completion_note`, `evidence_path`, `evidence_id`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_message`

Set `id` and `command_id` Initial value to `UNIQUEID()`, `submitted_by` Initial value to `USEREMAIL()`, `submitted_at` Initial value to `NOW()`, and `status` Initial value to `"Ready"`. Make `id`, `command_id`, `task_id`, `expected_version`, `completion_note`, `evidence_path`, `evidence_id`, `submitted_by`, `submitted_at`, and `status` non-editable after form creation; make every `result_*` column read-only. Do not permit users to edit `submitted_by`.

`evidence_path` is an AppSheet **File** column. AppSheet uploads into the configured DEV evidence folder (`S01_CONFIG.evidenceFolderId`). The bridge resolves the path with `_r1cResolveUpload`, creates/reuses an Evidence row idempotently for `job_id + drive_file_id`, and passes `Evidence.id` into TASK_COMPLETE. Categories: PRE02 → `Contract`, PRE04 → `CustomerDetails`. Do **not** give AppSheet Add/Edit on the Evidence table.

`evidence_id` remains an optional temporary text fallback for opaque refs when no file is uploaded. Prefer `evidence_path` for PRE02/PRE04.

From Task Detail (Open / Waiting / InProgress), use:

```
LINKTOFORM("DEV Complete Task Form", "task_id", [id], "expected_version", [version])
```

Bot: Adds only, filter `[status] = "Ready"`, call:

```
appSheetR1CommandFromRequestRow("TASK_COMPLETE", [id], USEREMAIL())
```

Arguments (exactly three): `commandType` = `"TASK_COMPLETE"`, `requestRowId` = `[id]`, `actorEmail` = `USEREMAIL()`.

If you still use a JSON `appSheetR1Command` Complete Task path, allow payload keys `completion_note`, `evidence_path`, and optional `evidence_id` only — never invent Evidence ids in AppSheet.

### TASK_EVIDENCE_ATTACH (legacy completed PRE02 repair, DEV only)

Use this only when a PRE02 task is already `Complete` with blank `evidence_id` (completion predates contract evidence). Do **not** reopen the task. New PRE02 completions still use `TASK_COMPLETE` + `evidence_path`.

Create `DEVTaskEvidenceAttachRequests` in the DEV spreadsheet only, columns in order:

`id`, `command_id`, `task_id`, `expected_version`, `evidence_path`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_message`

Initials: `id`/`command_id` = `UNIQUEID()`; `submitted_by` = `USEREMAIL()`; `submitted_at` = `NOW()`; `status` = `"Ready"`. Lock identity/input columns after create; `result_*` read-only. Do not allow editing `submitted_by`. `evidence_path` is File (same DEV evidence folder). No AppSheet Add/Edit on Evidence.

Show_If for action **Add contract evidence** (not Complete Task):

`AND([status] = "Complete", ISBLANK([evidence_id]), [template_code] = "PRE02")`

Prefer also `TASK_ACTION_AVAILABILITY` → `appsheet_commands.task_evidence_attach.available`. Never show Complete Task when status is Complete.

Form:

```
LINKTOFORM("DEV Attach Contract Evidence Form", "task_id", [id], "expected_version", [version])
```

Bot: Adds only, `[status] = "Ready"`. Call with the request row’s authenticated submitter — **pass `[submitted_by]`, not Apps Script `USEREMAIL()`**:

```
appSheetR1CommandFromRequestRow("TASK_EVIDENCE_ATTACH", [id], [submitted_by])
```

Exactly three arguments. The bridge requires row `submitted_by` to equal the bot actor argument, then authorizes via normal task owner/backup/Admin rules (plus People/PersonRoles). Tanya can attach on a Tanya-owned PRE02; unrelated Office users cannot. Effects: resolve upload → idempotent Evidence `Contract` → set `Tasks.evidence_id` only → PRE02 contract Job stamps. Preserves `status`, `completed_at`, `completed_by`, `completion_note`, and financial fields. Replay is safe; `external_calls = 0`.

### Upload availability race (all File/Image request columns, DEV only)

AppSheet writes the request row and fires the bot before the uploaded file is necessarily visible through Drive. The bridge treats that as **retryable**, never as a validation failure, and the user never resubmits:

1. `_r1cResolveUpload` waits in-call (lookups at 0 s, 2 s, 6 s, 12 s — bounded, before any write). Most uploads resolve here and the bot sees `ok:true`.
2. If still not visible the bot receives `{"ok":false,"error":"R1C_UPLOAD_PENDING","retryable":true,"retry":{"scheduled":true,"outbox_id":"OUT-R1U-<row id>","attempt":1,"max_attempts":5,"next_attempt":"…"}}`. One `Outbox` row (`action_type = R1RequestUploadRetry`, `idempotency_key = R1U:<table>:<row id>`) is created per request row; the request row itself is not modified except `result_status = UploadPending` / `result_message` when those columns exist.
3. A time-driven trigger on the standalone bridge project runs `runR1URetryUploadRequests()` every 5 minutes. Each due item re-reads the authoritative request row, acts as `row.submitted_by` (locked at create), refuses if any identity/input column changed since scheduling (`R1U_REQUEST_CHANGED`), and re-runs the normal `appSheetR1CommandFromRequestRow` path with the same `command_id`, so journals (`CJ-R1A-` / `CJ-R1C-`) make duplicate Evidence rows or lifecycle side effects impossible.
4. Backoff 1 / 2 / 4 / 8 / 16 minutes, five attempts in total (bot attempt included). A file that never appears ends as `Outbox.status = NeedsReview` with `R1C_UPLOAD_MISSING` and `result_status = Failed`; `runRsSweep()` raises the RS-REVIEW task. Any other error (stale version, access denied, recovery required) is final on first sight.
5. The same trigger sweeps `DEVTaskCompleteRequests`, `DEVTaskEvidenceAttachRequests`, `DEVInstallerCommandRequests` and `DEVGoodsInRequests` for `Ready` rows that carry an upload but have neither a journal entry nor an Outbox row (rows submitted before this mechanism, or whose bot call never reached the backend) and schedules them the same way. Rows without an upload, non-Ready rows and rows already journaled are never touched.

Bot configuration stays **Adds only, `[status] = "Ready"`**. Do not add a re-run on update, do not let the bot write `status`, and do not add an AppSheet Wait step: a Wait step turns the process asynchronous with minute-level granularity and still cannot distinguish a slow upload from a missing one — the backend already does both. `runR1UUploadRetryStatus()` lists scheduled/succeeded/exhausted items.

### ISSUE_CREATE (Raise Issue, DEV only)

Jobs → Raise Issue opens `DEVCreateIssueRequests`. Do not overload `ISSUE_UPDATE`.

Helper columns: `id`, `command_id`, `job_id`, `expected_version`, `issue_type`, `title`, `description`, `severity`, `owner_id`, `customer_impact`, `requested_by`, `requested_at`, `result_status`, `result_issue_id`, `result_message`.

Enums: `issue_type` = `Variation` | `Remedial` | `Complaint`. `severity` = `Normal` | `Medium` (S10 default `Normal`). `customer_impact` Yes/No maps to Issues.`blocks_completion`. `title` maps to Issues.`category` (Issues has no title column). Status is always created as `Open`.

Prefill:

```
LINKTOFORM("DEV Create Issue Form", "job_id", [id], "expected_version", [version], "requested_by", USEREMAIL(), "requested_at", NOW(), "command_id", UNIQUEID(), "id", [_THISROW].[command_id])
```

Bot: `appSheetR1CommandFromRequestRow("ISSUE_CREATE", [id], USEREMAIL())`.
| Planner date patch | PLANNER_UPDATE | planned_start/end |
| Booking Gates | BOOKING_GATES | empty payload |
| Deposit Confirm | DEPOSIT_CONFIRM | request row via `appSheetR1CommandFromRequestRow` |

### DEPOSIT_CONFIRM (secure request row, DEV only)

Create `DEVDepositConfirmRequests` in the DEV spreadsheet only, with these columns in order:

`id`, `command_id`, `job_id`, `expected_version`, `reference`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_stage_id`, `result_message`.

Set `id` and `command_id` Initial value to `UNIQUEID()`, `submitted_by` Initial value to `USEREMAIL()`, `submitted_at` Initial value to `NOW()`, and `status` Initial value to `"Ready"`. Make `id`, `command_id`, `job_id`, `expected_version`, `reference`, `submitted_by`, `submitted_at`, and `status` non-editable after form creation; make every `result_*` column read-only. Do not permit users to edit `submitted_by`.

From Job Detail, use a form action with:

```
LINKTOFORM("DEV Deposit Confirm Form", "job_id", [id], "expected_version", [version])
```

The bot event is Adds only, filtered by `[status] = "Ready"`, and calls:

```
appSheetR1CommandFromRequestRow("DEPOSIT_CONFIRM", [id], USEREMAIL())
```

The bridge loads the row itself, requires its `submitted_by` to equal the supplied AppSheet identity, then uses the normal DEPOSIT_CONFIRM authorization path. That retains FN-15 Manual enforcement, active People/roles, Admin/Manager access, and Director assignment checks. Keep old `R1A_Cmd_DEPOSIT_CONFIRM` rows as history only; disable their bot/action and do not migrate them.
| Operational Complete | OPERATIONAL_COMPLETE | empty |
| Cancel / Reinstate | CANCEL_JOB / REINSTATE_JOB | per S15 fields |

### SOLD_INTAKE / BOOKING_INTAKE (native AppSheet, DEV only)

Jotform is no longer required for the R1 new-job path. These commands call the existing S05 processors. They do not allow generic Job/Customer edits.

**Authorization:** Office, Admin, Manager, and Director (Director is already inside the R1 office role). VariationApprover is allowed only because existing R1 office commands include that role. Installer, Store, and Scaffolder are denied.

**Helper tables (create in the DEV spreadsheet, then add to the DEV AppSheet app).** AppSheet may Add rows. Do not grant Update on Jobs, Customers, WorkPackages, Allocations, Materials, JobEquipment, or ScaffoldBookings.

`DEVNewJobSoldRequests` columns, in order:

`id`, `command_id`, `submitted_by`, `customer_first_name`, `customer_last_name`, `street_address`, `city`, `postcode`, `phone`, `email`, `salesperson_id`, `lead_source`, `quote_reference`, `presale_file_id`, `finance_route`, `gross_amount`, `roof_required`, `electrical_required`, `scaffold_required`, `roof_notes`, `electrical_notes`, `result_status`, `result_job_id`, `result_job_id_human`, `result_version`, `result_message`

Initial values: `command_id` = `UNIQUEID()`, `submitted_by` = `USEREMAIL()`, `id` = `[command_id]`. `gross_amount` is pounds, not pence. `finance_route` is `Standard`, `Phoenix`, or `OtherReview`. `salesperson_id` is a People Ref (internal id).

`DEVBookingIntakeRequests` columns, in order:

`id`, `command_id`, `submitted_by`, `job_id`, `job_id_human`, `expected_version`, `customer_first_name`, `customer_last_name`, `street_address`, `city`, `postcode`, `phone`, `email`, `solar_kw`, `cost`, `finance_route`, `merchant_name`, `invoice_date`, `annual_generation`, `date_roofer`, `date_sparky`, `date_scaffold`, `roofer`, `sparky`, `second_sparky`, `scaffold_company`, `scaffold_pdf`, `scaffold_notes`, `roofing_notes`, `electrical_notes`, `ordering_notes`, `roof_hooks_type`, `mat_slate_portrait`, `mat_slate_landscape`, `mat_r420181_total`, `mat_concrete_portrait`, `mat_concrete_landscape`, `mat_r420150_total`, `mat_l_bracket`, `mat_hook_rest`, `mat_end_clamps`, `mat_end_caps`, `mat_mid_clamps`, `mat_rail`, `mat_splice`, `mat_k2_flat_multi`, `mat_k2_curved_multi`, `mat_k2_flat_mini`, `mat_k2_curved_mini`, `mat_genius`, `mat_k2_1000074`, `mat_k2_mid`, `mat_k2_end`, `mat_k2_end_caps`, `mat_k2_rail`, `mat_k2_splice`, `mat_panel_515`, `mat_panel_460`, `mat_panel_m`, `mat_bird_netting`, `mat_optimisers`, `mat_fox_jb`, `mat_dongle`, `mat_gateway`, `mat_ev`, `inverter`, `battery`, `battery_qty`, `fox_jb_calc`, `extras`, `sig_extras`, `tesla_extras`, `result_status`, `result_job_id`, `result_job_id_human`, `result_version`, `result_workflow_stage`, `result_message`

`job_id` is the internal Jobs `id`. `job_id_human` is display only and is not a match key. Continue Booking prefills from the existing Job:

```
LINKTOFORM("DEV Booking Intake Form", "job_id", [id], "job_id_human", [job_id], "expected_version", [version])
```

Also prefill customer and booking columns from the related Customer / Job. Show Continue Booking only when ACTION_AVAILABILITY `booking_intake.available` is true (`Prebooking`, `ReadyToBook`, or `BookingInProgress`). An early booking may link, but it must not skip `ReadyToBook`. `ReadyToBook` advances to `BookingInProgress` only through S05.

Do **not** build the intake JSON in AppSheet. Expression Assistant hangs on the booking payload.

Call `appSheetR1CommandFromRequestRow` with three arguments only.

Sold bot:

- `commandType`: `"SOLD_INTAKE"`
- `requestRowId`: `[id]`
- `actorEmail`: `USEREMAIL()`

Booking bot:

- `commandType`: `"BOOKING_INTAKE"`
- `requestRowId`: `[id]`
- `actorEmail`: `USEREMAIL()`

The script reads the helper row, builds the canonical command, and runs the existing command path. `submitted_by` is not the authorization actor. It must match `USEREMAIL()` when present. No Calendar, email, or other external call.

---

## 7. ACTION_AVAILABILITY wiring

1. On Job Detail open, run bot `appSheetR1Read` with:
   `{"read_type":"ACTION_AVAILABILITY","job_id":"[id]"}`
2. Store result in a temporary/UX table or use returned `appsheet_commands.*.available` to drive button Show_If.
3. Do **not** treat Show_If as security — processor refuses unauthorised commands.

Same for `TASK_ACTION_AVAILABILITY` on task rows.

**Ready/booking gate workflow:** Run `BOOKING_GATES` after evidence-backed PRE completion. Refresh the Job after each committed stage change and pass the new `[version]`: `Prebooking → ReadyToBook`, then (when Booking intake is linked) `ReadyToBook → BookingInProgress`. The final call advances to `Booked` only after all applicable PRE tasks and BKG01–BKG03 are satisfied. Never expose a force/override field. BKG04/BKG05 then appear as post-Booked manual tasks.

For PRE02/PRE04 completion forms, capture required evidence via `evidence_path` (File upload → Evidence row). Keep `evidence_id` text only as a temporary opaque fallback. For PRE03 use the separate `DEPOSIT_CONFIRM` command to record bank actor/time/reference and then complete the single Ben/Dan task. A missing evidence value must remain visibly blocked.

Legacy completed PRE02 with blank `evidence_id`: use `TASK_EVIDENCE_ATTACH` / **Add contract evidence** (see above). Do not use Apps Script editor helpers for Tony recovery.

---

## 8. Planner views (3 / 6 week)

1. Bot read `PLANNER_3_WEEKS` / `PLANNER_6_WEEKS` with optional `as_of` (YYYY-MM-DD).
2. Display rows: person_id, trade, start_at, end_at, job display (surname – postcode).
3. Multi-day = one allocation spanning dates; multiple jobs/day = multiple rows.
4. Weekends: staffed-day settings already exclude from capacity warnings; show weekend cells empty or grey.
5. Capacity warnings: advisory only (NeedsReview from S11) — show banner text, do not hard-block office confirmation without review.

---

## 9. Column order (Job Detail)

Suggested: Identity (job_id, display_name, stage) → Customer → Match status → Work packages & dates → Allocations → Materials → Equipment → Scaffold → Tasks → Finance flags → System (version, submissions).

---

## 10. Security filters (reminder)

Slices/Show_If are not security. Apply People/role security filters on every connected table as in S04 manual. Installer/scaffolder views stay denied for R1 office app.
