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

This manual copy step is superseded by **Continue Booking**, which opens the Booking form with the job already selected. See §2A.7 for the helper-task audit.

---

## 2A. Staff-facing job and task identification

Presentation and search only. Canonical keys, commands, ownership, authorization and gates are unchanged.

### 2A.1 Audit findings

- `Tasks.job_id`, `owner_id`, `backup_id` and `related_entity_id` are physical TEXT columns holding canonical keys (`J-…`, `PERSON-…`). `schema/tables.json` records them only as FK notes and defines no AppSheet column types.
- This document previously configured no Ref types and no Tasks presentation columns, so AppSheet typed them as Text and every task table printed raw keys.
- Only the helper task `Copy Job ID into Job Booking form (SS-…)` has the public Job ID in its title. That is why a Booking Queue search for `SS-SHHC-8091` found only that task.
- Backend task reads (`OFFICE_HOME`, `MY_TASKS`, `TEAM_TASKS`, `OPERATIONAL_QUEUE`, `JOB_OVERVIEW`) returned ids only. `JOB_SEARCH` ignored quote reference, first name, address, town and postcodes typed without the space.

No physical sheet or schema change is required. Everything below is AppSheet column typing, virtual columns and view configuration.

### 2A.2 Ref configuration (column type only)

| Table | Column | AppSheet type | Source table | Is a part of? |
|---|---|---|---|---|
| Tasks | `job_id` | Ref | Jobs | Off |
| Tasks | `owner_id` | Ref | People | Off |
| Tasks | `backup_id` | Ref | People | Off |
| Tasks | `completed_by` | Ref (optional) | People | Off |
| Jobs | `customer_id` | Ref | Customers | Off |

Label columns (Data → Tables → column list → **Label**): Jobs = `job_id`; People = `display_name`; Customers = `last_name`.

A Ref column's value is still the canonical key. `[job_id]` still evaluates to `J-…` and `[owner_id]` to `PERSON-…`, so existing slice filters such as `[owner_id]=ANY(SELECT(People[id], [email]=USEREMAIL()))`, `LINKTOFORM(... "task_id", [id] ...)` and every bot keep sending internal ids. Adding the `Tasks.job_id` Ref also creates a reverse-reference list on Jobs (for example `Related Tasks`) that Job Detail can show inline. A Ref only displays its label when the referenced row is visible to the user under security filters; otherwise AppSheet shows the raw key.

### 2A.3 Virtual columns

Each expression uses a single dereference (`[Ref].[Column]`). Customer fields are derived once on Jobs, and Tasks dereference those Jobs virtual columns. Nothing is copied into Tasks rows.

**Jobs** (Virtual, App formula):

| Column | Type | Display name | App formula |
|---|---|---|---|
| `customer_name` | Text | Customer | `TRIM(CONCATENATE([customer_id].[first_name], " ", [customer_id].[last_name]))` |
| `customer_last_name` | Text | Surname | `[customer_id].[last_name]` |
| `postcode` | Text | Postcode | `[customer_id].[postcode]` |
| `address_summary` | Text | Address | `TRIM(CONCATENATE([customer_id].[address_line1], ", ", [customer_id].[town]))` |
| `job_label` | Text | Job | `CONCATENATE([job_id], " – ", [customer_id].[last_name], " – ", [customer_id].[postcode])` |

**Tasks** (Virtual, App formula):

| Column | Type | Display name | App formula (with Refs) | Fallback if Refs are not configured |
|---|---|---|---|---|
| `public_job_id` | Text | Job ID | `[job_id].[job_id]` | `LOOKUP([job_id], "Jobs", "id", "job_id")` |
| `customer_name` | Text | Customer | `[job_id].[customer_name]` | `LOOKUP([job_id], "Jobs", "id", "customer_name")` |
| `postcode` | Text | Postcode | `[job_id].[postcode]` | `LOOKUP([job_id], "Jobs", "id", "postcode")` |
| `job_label` | Text | Job | `[job_id].[job_label]` | `LOOKUP([job_id], "Jobs", "id", "job_label")` |
| `owner_name` | Text | Owner | `[owner_id].[display_name]` | `LOOKUP([owner_id], "People", "id", "display_name")` |
| `backup_name` | Text | Backup | `[backup_id].[display_name]` | `LOOKUP([backup_id], "People", "id", "display_name")` |

Prefer the Ref forms. Each `LOOKUP` scans a table per row. System tasks with a blank `job_id` show blank Job ID / Customer / Postcode, which is expected. Set the `title` column's display name to **Task**, `due_at` to **Due**, and `status` to **Status**.

**Search?** (column editor): turn on for Tasks `public_job_id`, `customer_name`, `postcode`, `job_label`, `title`, `owner_name`, and for Jobs `job_id`, `customer_name`, `postcode`, `address_summary`, `quote_reference`, `display_name`. Turn it off for Tasks `id`, `job_id`, `owner_id`, `backup_id`, `related_entity_id`, `instance_key` so internal keys do not dominate results. AppSheet's view search matches the displayed text, so staff type the postcode with its space or just the outward code (`TQ3`). The backend reads below also accept `TQ33HY`.

### 2A.4 Views, slices and column order

Keep every existing slice **row filter** unchanged. Only change the columns shown (view **Column order** for table views, or **Slice Columns**).

| Surface (source) | Column order |
|---|---|
| **My Tasks** (Tasks slice) | `public_job_id`, `customer_name`, `postcode`, `title`, `owner_name`, `due_at`, `status` |
| **Home — My Tasks panel** (My Tasks slice) | same as My Tasks |
| **Booking Queue** (Tasks where `group` is Prebooking/Booking; keep its current row filter) | same as My Tasks |
| **Team Tasks** (Tasks slice) | `public_job_id`, `customer_name`, `postcode`, `title`, `owner_name`, `backup_name`, `due_at`, `status` |
| **History** (Tasks slice) | `public_job_id`, `customer_name`, `postcode`, `title`, `owner_name`, `completed_at`, `status` |
| **Job Detail — Related Tasks inline** | `title`, `owner_name`, `due_at`, `status`, `blocking_reason` |
| **Task Detail** | `job_label`, `customer_name`, `postcode`, `title`, `status`, `due_at`, `owner_name`, `backup_name`, `blocking_reason`, `next_followup_at`, `completion_note`, `evidence_id`, then the admin-only internal columns |
| **Jobs (staff)** search view | `job_id`, `customer_name`, `postcode`, `address_summary`, `quote_reference`, `workflow_stage` |
| **Ready to Continue Booking**, **Booking In Progress**, **Upcoming Booked** (Jobs slices) | `job_id`, `customer_name`, `postcode`, `workflow_stage`, `next_action_at` |
| **Job Detail** header | `job_id`, `customer_name`, `postcode`, `address_summary`, `quote_reference`, `workflow_stage` |

For **deck** task views: Primary header `job_label`, Secondary header `title`, Summary column `owner_name`. The Synthetic Jobs / Synthetic Tasks admin views and R2+ surfaces are out of scope.

### 2A.5 Columns hidden from normal staff views

Leave these in the data model and in every expression, action and bot. Remove them from staff table views, and give detail views the admin-only Show_If below.

- **Tasks:** `id`, `job_id`, `owner_id`, `backup_id`, `completed_by` (raw), `related_entity_type`, `related_entity_id`, `instance_key`, `template_code`, `revision_required`, `created_rule_version`, `version`, `source_system`, `commit_id`, `created_by`, `updated_by`.
- **Jobs:** `id`, `customer_id`, `sold_submission_id`, `booking_submission_id`, `salesperson_id`, `presale_file_id`, `contract_evidence_id`, `deposit_bank_confirmed_by`, `version`, `source_system`, `source_record_id`, `commit_id`, `created_by`, `updated_by`.
- **Request tables:** show `result_job_id_human` instead of `result_job_id`. On `DEVBookingIntakeRequests` show `job_id_human` and keep `job_id` hidden but still prefilled by Continue Booking.

Admin-only Show_If for internal columns on detail views:

```
IN(LOOKUP(USEREMAIL(), "People", "email", "id"), SELECT(PersonRoles[person_id], AND([active]=TRUE, IN([role], {"Admin","Manager"}))))
```

### 2A.6 Job and task search (backend reads)

- **JOB_SEARCH** matches public Job ID, quote reference, display name, first/last/full customer name, postcode with or without the space, address lines, town, email and phone. The internal `J-…` id still matches for diagnostics. `NOT_CONFIGURED` placeholders never match. Each result adds `customer_name`, `postcode`, `quote_reference`, `address_line1`, `town` and `job_label`. Authorization is unchanged: results remain limited to R1 pilot jobs the actor is assigned to.
- **MY_TASKS**, **TEAM_TASKS** and **OPERATIONAL_QUEUE** accept an optional `query` using the same matching, and every task row adds `public_job_id`, `customer_name`, `postcode`, `owner_name`, `backup_name`, `job_label` and `search_text`. Canonical `id`, `job_id`, `owner_id` and `backup_id` are still returned for commands.
- **TEAM_TASKS** is not assignment-filtered, so for jobs the actor cannot open with `JOB_OVERVIEW`, `customer_name` and `postcode` are withheld (`customer_redacted = true`) and a customer or postcode query does not match them.

### 2A.7 Helper task `PRE-COPY-JOBID` audit

- `createPrebookingTasksForSold` creates it for every Sold job: title `Copy Job ID into Job Booking form (SS-…)`, owner Tanya, backup Admin, due the next staffed day, group Prebooking.
- It is not a ReadyToBook or Booked gate. The gates only require PRE01–PRE05 and BKG01–BKG03.
- Nothing closes it automatically, including `BOOKING_INTAKE`, so it stays open in Booking Queue / My Tasks after the job is booked unless Tanya completes it.
- Its only purpose is manual copying of the public Job ID into the Booking form. **Continue Booking** (§6 SOLD_INTAKE / BOOKING_INTAKE) already opens `DEV Booking Intake Form` with `job_id`, `job_id_human` and `expected_version` prefilled from the selected ReadyToBook job, which makes the copy step redundant.

Decision: keep it for now. Retire it only after Continue Booking is verified live, in a separate reviewed change that (1) stops generating `PRE-COPY-JOBID` in `createPrebookingTasksForSold` with its tests updated, and (2) closes existing open helper tasks through Complete Task with a note such as `Superseded by Continue Booking`. Until then staff can complete it as soon as they use Continue Booking.

---

## 3. Slices

Staff operational slices must exclude automated-test / smoke jobs. Do **not** use Task.`source_system` for that (genuine PRE tasks are written as `S06-prebooking` / `S06-gates`). Do **not** use `pilot_job` alone (genuine R1 sold jobs are also `pilot_job=TRUE`). Do **not** match job id/title prefixes. Use the parent Job classifier:

- Genuine R1 AppSheet sold jobs: `Jobs.source_system = "R1-AppSheet"` (and `pilot_job=TRUE`, `release_scope="R1"`).
- Fixture/smoke jobs: other `source_system` values (`S06-fixture`, `S06-test`, `S07-fixture`, `S10`, `S17-fixture`, `S17-smoke`, `R1A-fixture`, `MAT-fixture`, `IW-fixture`, …).

Shared Jobs allowlist expression (reuse in every staff Jobs/Tasks filter below):

```text
SELECT(Jobs[id], AND([source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1"))
```

| Slice | Source | Row filter | Use |
|---|---|---|---|
| **My Tasks** | Tasks | `AND(OR([owner_id]=ANY(SELECT(People[id], [email]=USEREMAIL())), [backup_id]=ANY(SELECT(People[id], [email]=USEREMAIL()))), NOT(IN([status], {"Complete","Cancelled","NotRequired"})), IN([job_id], SELECT(Jobs[id], AND([source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1"))))` | Personal active **staff** work |
| **Team Tasks** | Tasks | `AND(NOT(IN([status], {"Complete","Cancelled","NotRequired"})), IN(LOOKUP(USEREMAIL(),"People","email","id"), SELECT(PersonRoles[person_id], AND([active]=TRUE, IN([role], {"Office","Admin","Manager"})))), IN([job_id], SELECT(Jobs[id], AND([source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1"))))` | Authorised team staff work |
| **Booking In Progress** | Jobs | `AND([workflow_stage]="BookingInProgress", [source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1")` | Queue |
| **Upcoming Booked** | Jobs | `AND(IN([workflow_stage], {"Booked","AwaitingInstallation"}), [source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1")` | Upcoming |
| **Ready to Continue Booking** | Jobs | `AND([workflow_stage]="ReadyToBook", [source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1")` | Continue Booking |
| **Jobs (staff)** | Jobs | `AND([source_system]="R1-AppSheet", [pilot_job]=TRUE, [release_scope]="R1")` | Searchable staff jobs |
| **Intake Review** | Intake | `[processing_status]="Review"` | Unknown ref / mismatches |
| **Planner Allocations Active** | Allocations | `[active]=TRUE` | Planner base |
| **Synthetic Jobs (Admin)** | Jobs | `AND([pilot_job]=TRUE, NOT([source_system]="R1-AppSheet"))` | Debug/fixture inspection only |
| **Synthetic Tasks (Admin)** | Tasks | `AND(NOT(IN([status], {"Complete","Cancelled","NotRequired"})), NOT(IN([job_id], SELECT(Jobs[id], [source_system]="R1-AppSheet"))))` | Debug/fixture inspection only |

Also prefer bots for **MY_TASKS** / **TEAM_TASKS** / **INTAKE_REVIEW** / **PLANNER_3_WEEKS** / **PLANNER_6_WEEKS** read types when wiring Home. Until the bot `_r1aFilterTasks` path is aligned to the same Job allowlist, AppSheet slice filters above remain the staff UX gate.

### Superseded DEV acceptance submissions

Earlier real Parton / New Job Sold attempts (for example `SS-XSTV-7201` and other `R1-AppSheet` jobs from failed or repeated submissions) are **genuine staff-created pilot jobs**, not fixtures. Keep their Jobs, Tasks, Intake, request rows, AuditEvents and CommitJournal. Do not delete them and do not special-case one human Job ID in filters.

During acceptance:

1. Treat the current agreed job (for example `SS-SHHC-8091` / `J-mu12y2e6-7y7tui`) as the working job.
2. Leave superseded open PRE tasks visible until closed through normal commands (`TASK_COMPLETE` / `NotRequired`) with a completion note that names the superseding job — or leave them open and ignore them operationally.
3. Use **My Requests** (`[submitted_by]=USEREMAIL()`) to audit prior request rows via `result_status`, `result_job_id_human`, `result_message`; do not invent a second processor.

---

## 4. Views & navigation

Create / bind (DEV only):

1. **Home** — dashboard: overdue / due today / next 7 days from My Tasks (group by `due_class` if using bot enrichment).
2. **My Tasks** — table/deck on My Tasks slice using the §2A.4 column order (Job ID, Customer, Postcode, Task, Owner, Due, Status). Sort: overdue first, then due_at. Set **Row selected** to `LINKTOROW([id], "Task Detail")`.
3. **Team Tasks** — table on Team Tasks slice (Office/Admin only via Security Filter / view Show_If).
4. **Jobs** — searchable table on the **Jobs (staff)** slice; detail = Job Detail. Use the §2A.4 column order so staff search by Job ID, customer, postcode, address or quote reference.
5. **Job Detail** — show identity (`job_id`, display_name, stage), customer, work packages, materials, scaffold, tasks, actions.
6. **Booking In Progress** — deck/table.
7. **Intake Review** — table with validation_errors.
8. **Planner 3 Weeks** — table or calendar-like deck driven by PLANNER_3_WEEKS bot (resource = person, surname/postcode from Job display_name, Roof/Electrical/Erect/Strip columns).
9. **Planner 6 Weeks** — same for 6 weeks.
10. **History** — Tasks where status in Complete/Cancelled/NotRequired (separate slice). Prefer the same Job `R1-AppSheet` allowlist as My Tasks so History is not flooded with fixture completions. Its task links also use `LINKTOROW([id], "Task Detail")`.
11. **Task Detail** — the single canonical Tasks detail view. Use this same view for My Tasks, Team Tasks, Job Detail inline task rows, History, and Job Search paths; do not create a My-Tasks-specific detail view.
12. **Ready to Continue Booking** — use the Ready to Continue Booking slice; visible to the same assigned Office/Admin/Manager users as Job Detail. Place it on Home and route rows to Job Detail.
13. **Synthetic Jobs / Synthetic Tasks (Admin only)** — views on the Admin synthetic slices for fixture/smoke inspection. Do not place them in the normal staff navigation.

Navigation order: Home → My Tasks → Ready to Continue Booking → Team Tasks → Booking In Progress → Jobs → Intake Review → Planner 3W → Planner 6W → Admin (Release modes / System status / Synthetic Jobs for Admin only).

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
LINKTOFORM("Complete Task Form", "task_id", [id], "expected_version", [version], "evidence_id", [evidence_id])
```

### Other existing commands (already in adapter)

| Button | command_type | Key payload |
|---|---|---|
| Complete Task | TASK_COMPLETE | completion_note; PRE01: invoice_number + invoice_sent (or outcome=Failed); PRE02: contract_id + contract_signed=Yes + evidence_path/evidence_id (or contract_signed=No / outcome=AwaitingSignature); PRE03: deposit_bank_confirmed + deposit_amount + deposit_received_date + deposit_bank_reference; PRE04: customer_details_verified + sold_value_verified + verified_gross_amount |
| Reopen Task | TASK_REOPEN | reopen_reason |
| Record Call | CALL_RECORD | type, outcome |
| Update Issue | ISSUE_UPDATE | action REASSIGN/TRANSITION |
| Create Issue | ISSUE_CREATE | helper row via `appSheetR1CommandFromRequestRow` |

### TASK_COMPLETE with office evidence upload (DEV only)

Create `DEVTaskCompleteRequests` in the DEV spreadsheet only, with these columns in order:

`id`, `command_id`, `task_id`, `expected_version`, `completion_note`, `evidence_path`, `evidence_id`, `invoice_number`, `invoice_sent`, `outcome`, `contract_id`, `contract_signed`, `customer_details_verified`, `sold_value_verified`, `verified_gross_amount`, `deposit_bank_confirmed`, `deposit_amount`, `deposit_received_date`, `deposit_bank_reference`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_message`, `result_code`, `result`, `result_at`

The last three are optional diagnostics written by the bridge (§6A). If your sheet already has `result`, keep it.

Set `id` and `command_id` Initial value to `UNIQUEID()`, `submitted_by` Initial value to `USEREMAIL()`, `submitted_at` Initial value to `NOW()`, and `status` Initial value to `"Ready"`. Make `id`, `command_id`, `task_id`, `expected_version`, `completion_note`, `evidence_path`, `evidence_id`, `invoice_number`, `invoice_sent`, `outcome`, `contract_id`, `contract_signed`, `customer_details_verified`, `sold_value_verified`, `verified_gross_amount`, `deposit_bank_confirmed`, `deposit_amount`, `deposit_received_date`, `deposit_bank_reference`, `submitted_by`, `submitted_at`, and `status` non-editable after form creation; make every `result_*` column read-only. Do not permit users to edit `submitted_by`.

`evidence_path` is an AppSheet **File** column. Set DEV `S01_CONFIG.evidenceFolderId` to the Data-folder root `1sPEw0P6L2jOG4oEazzs7gayckHmtQ__2`, not a table-specific `*_Images` leaf. AppSheet stores relative paths such as `DEVTaskCompleteRequests_Images/<filename>` and `DEVTaskEvidenceAttachRequests_Images/<filename>` beneath that root. The bridge resolves the path with `_r1cResolveUpload`, creates/reuses an Evidence row idempotently for `job_id + drive_file_id`, and passes `Evidence.id` into TASK_COMPLETE. Categories: PRE02 → `Contract`, PRE04 → `CustomerDetails`. Do **not** give AppSheet Add/Edit on the Evidence table.

`evidence_id` remains an optional temporary text fallback for opaque refs when no file is uploaded. PRE02 requires documentary evidence and should prefer `evidence_path`; PRE04 evidence is optional because its structured reconciliation and persisted Job verification state are authoritative. For PRE02, `evidence_id` must resolve to an existing Evidence row for the job (opaque invented ids are refused).

**PRE01 (Send deposit invoice)** — notes alone are refused. Show `invoice_number` and `invoice_sent` when `[template_code]="PRE01"`:

- Success: `invoice_number` = Xero/manual invoice ID or invoice number; `invoice_sent` = `Yes` (Enum Yes/No). Backend stamps the job's deposit `InvoiceStages` row (`invoice_number`, `sent_at`, `status=Sent` unless already Confirmed/Paid) and Completes PRE01. `PRE01_satisfied` requires that InvoiceStages evidence, not the task note.
- Failure / chase: set `outcome` = `Failed` with a visible `completion_note`. Backend does **not** Complete PRE01; it sets status `Waiting`, `blocking_reason=PRE01_INVOICE_SEND_FAILED`, `next_followup_at` to the next staffed day, writes TaskEvents/AuditEvents, and leaves `PRE01_satisfied` false. Do not invent a second finance table.

**PRE02 (Check contract sent/signed)** — "sent" is not "signed". Notes alone are refused. Show `contract_id`, `contract_signed`, and evidence fields when `[template_code]="PRE02"`:

- Success (signed): `contract_id` = Signable/reference ID; `contract_signed` = `Yes`; `evidence_path` (preferred) or existing `evidence_id`; `completion_note`. Backend creates/reuses Evidence (`Contract`), stamps Jobs (`contract_id`, `contract_status=Signed`, `contract_signed_at`, `contract_evidence_id`), Completes PRE02, and re-evaluates ReadyToBook. `PRE02_satisfied` and `signed_contract_evidence` require that Job state — task Complete alone is not enough.
- Sent / awaiting signature: `contract_id` + `contract_signed` = `No` (or `outcome` = `AwaitingSignature`) + note. Backend does **not** Complete PRE02; sets `Waiting`, `blocking_reason=PRE02_AWAITING_SIGNATURE`, `next_followup_at`, stamps Jobs `contract_status=Sent` + `contract_id` only (no signed_at / evidence), and leaves gates unsatisfied.
- Evidence first (recommended): use **Add contract evidence** on the open or waiting PRE02, then Complete Task. See **PRE02 signed contract sequence** under TASK_EVIDENCE_ATTACH.

**PRE04 (Check customer details and sold/presale amount)** — notes alone are refused. Add these AppSheet columns:

| Column | AppSheet type | Configuration |
|---|---|---|
| `customer_details_verified` | Enum (base type Text) | Allowed values `Yes`, `No`; do not allow other values |
| `sold_value_verified` | Enum (base type Text) | Allowed values `Yes`, `No`; do not allow other values |
| `verified_gross_amount` | Price | GBP, two decimal places; the bridge sends pounds and the backend converts exactly to pence |
| `completion_note` | LongText | Required for every completion attempt |

Success requires both verification fields = `Yes`, a note, and `verified_gross_amount` equal to the canonical gross value (positive `current_contract_gross_pence`, otherwise positive `original_gross_pence`). The backend stamps `customer_details_verified_at/by`, sets `sold_booking_match_status=Match`, retains an existing nonblank `valuation_basis` or sets `Standard`, Completes PRE04, and re-evaluates ReadyToBook. It never changes either gross-value field.

Any explicit `No`, or a different amount, leaves PRE04 `Waiting` with a visible mismatch `blocking_reason` and `next_followup_at`, sets `sold_booking_match_status=Review`, preserves the submitted answers in the command journal/audit trail, and leaves ReadyToBook blocked. An optional PRE04 upload may supplement this check but is not required.

**PRE03 (Confirm bank deposit)** — notes, customer emails, invoice `Sent` status and document uploads are all refused as proof. The only route to Complete is an explicit manual bank verification recorded by the authenticated PRE03 owner (Ben), backup (Dan) or an Admin/Manager. Add these AppSheet columns to `DEVTaskCompleteRequests` (canonical names; do not create alternates):

| Column | AppSheet type | Configuration |
|---|---|---|
| `deposit_bank_confirmed` | Enum (base type Text) | Allowed values `Yes`, `No`; do not allow other values |
| `deposit_amount` | Price | GBP, two decimal places, the amount actually seen in the bank; the bridge sends pounds and the backend converts exactly to pence |
| `deposit_received_date` | Date | Date the payment was received/seen on the statement; cannot be in the future |
| `deposit_bank_reference` | Text | Bank/BACS payment reference as shown on the statement (redacted reference only — never account or login details) |
| `completion_note` | LongText | Required for every completion attempt |

Success requires all of: `completion_note`, `deposit_bank_confirmed=Yes`, a valid `deposit_amount`, a valid `deposit_received_date`, a nonblank `deposit_bank_reference`, an authorized actor, and the amount reconciling **server-side** against the job's canonical deposit `InvoiceStages` row (`gross_pence`). The expected amount is never taken from the form (for `SS-SHHC-8091` it is £2,612.95 = 261295 pence from the £10,451.78 contract). On success the backend writes exactly one `ManualBankChecks` row (`stage=deposit`, `checked_by` = authenticated actor, `checked_at` = received date, `amount_pence`, `outcome=Confirmed`, `evidence_reference` = bank reference), stamps the Jobs summary fields `deposit_bank_confirmed_at/by/reference`, marks the deposit InvoiceStage `Confirmed` with the same reference, Completes PRE03, clears `blocking_reason`, and re-evaluates ReadyToBook. `PRE03_satisfied` and `deposit_confirmation_evidence` both require that reconciled `ManualBankChecks` state — a Complete task or stamped Jobs fields alone never pass.

`deposit_bank_confirmed=No`, or an amount that does not reconcile, does **not** Complete PRE03: the task becomes `Waiting` with `blocking_reason=PRE03_DEPOSIT_NOT_RECEIVED` or `PRE03_DEPOSIT_AMOUNT_MISMATCH` and a `next_followup_at`, the submitted values are preserved in the command journal / audit trail and a non-successful `ManualBankChecks` row (`NotReceived` / `AmountMismatch`), no successful confirmation is stamped, contract and invoice amounts are untouched, and ReadyToBook stays blocked. Re-submit from the Waiting task once the bank shows the right amount. No bank screenshot is required or stored; `evidence_path` / `evidence_id` are hidden for PRE03.

Hide `invoice_number` / `invoice_sent` for non-PRE01. Hide `contract_id` / `contract_signed` for non-PRE02. Hide the four `deposit_*` columns for non-PRE03. Hide PRE01 invoice fields when completing PRE02/PRE03/PRE04. Hide PRE02 contract fields when completing PRE01/PRE03/PRE04. Hide `evidence_path` / `evidence_id` for PRE03.

### AppSheet Show_If / Required_If (Complete Task form)

`DEVTaskCompleteRequests` does not physically contain `template_code`. Either add a virtual column `template_code` = `LOOKUP([task_id], "Tasks", "id", "template_code")` and use `[template_code]` below, or write the LOOKUP inline (the PRE03 rows below show the inline form; the two are equivalent).

| Column | Show_If | Required_If |
|---|---|---|
| `invoice_number` | `[template_code]="PRE01"` | `[template_code]="PRE01"` AND `OR(ISBLANK([outcome]), [outcome]<>"Failed")` |
| `invoice_sent` | `[template_code]="PRE01"` | same as invoice_number |
| `outcome` | `OR([template_code]="PRE01", [template_code]="PRE02")` | optional |
| `contract_id` | `[template_code]="PRE02"` | `[template_code]="PRE02"` |
| `contract_signed` | `[template_code]="PRE02"` | `[template_code]="PRE02"` AND `OR(ISBLANK([outcome]), [outcome]<>"AwaitingSignature")` — Enum Yes/No |
| `customer_details_verified` | `[template_code]="PRE04"` | `[template_code]="PRE04"` |
| `sold_value_verified` | `[template_code]="PRE04"` | `[template_code]="PRE04"` |
| `verified_gross_amount` | `[template_code]="PRE04"` | `AND([template_code]="PRE04", [customer_details_verified]="Yes", [sold_value_verified]="Yes")` |
| `deposit_bank_confirmed` | `LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03"` | `LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03"` — Enum Yes/No |
| `deposit_amount` | `LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03"` | `AND(LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03", [deposit_bank_confirmed] = "Yes")` |
| `deposit_received_date` | `LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03"` | `AND(LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03", [deposit_bank_confirmed] = "Yes")` |
| `deposit_bank_reference` | `LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03"` | `AND(LOOKUP([task_id], "Tasks", "id", "template_code") = "PRE03", [deposit_bank_confirmed] = "Yes")` |
| `evidence_path` | `AND(OR([template_code]="PRE02", [template_code]="PRE04"), ISBLANK(LOOKUP([task_id], "Tasks", "id", "evidence_id")))` (never PRE03; hidden once Add contract evidence has stored evidence on the task) | `AND([template_code]="PRE02", [contract_signed]="Yes", ISBLANK([evidence_id]))` |
| `evidence_id` | `OR([template_code]="PRE02", [template_code]="PRE04")` (never PRE03) | Not required. Prefilled from the task's `[evidence_id]` by the Complete Task action. Editable_If `ISBLANK(LOOKUP([task_id], "Tasks", "id", "evidence_id"))`, so staff can't overwrite uploaded evidence by typing. To replace the file, use Add contract evidence again. |
| `completion_note` | always | always |

Complete Task form column order: `task_id`, `expected_version`, `completion_note`, `invoice_number`, `invoice_sent`, `outcome`, `contract_id`, `contract_signed`, `customer_details_verified`, `sold_value_verified`, `verified_gross_amount`, `deposit_bank_confirmed`, `deposit_amount`, `deposit_received_date`, `deposit_bank_reference`, `evidence_path`, `evidence_id`. Show_If keeps each template's block to itself, so a PRE03 user sees note → Yes/No → amount → date → reference only.

Backend remains authoritative if AppSheet Show_If is misconfigured.

From Task Detail (Open / Waiting / InProgress), use:

```
LINKTOFORM("DEV Complete Task Form", "task_id", [id], "expected_version", [version], "evidence_id", [evidence_id])
```

Show the action only when `TASK_ACTION_AVAILABILITY.appsheet_commands.task_complete.available` is true. The local presentation fallback is:

```
AND(IN([status], {"Open","Waiting","InProgress"}), [revision_required] <> TRUE,
  OR([owner_id]=ANY(SELECT(People[id], [email]=USEREMAIL())),
     [backup_id]=ANY(SELECT(People[id], [email]=USEREMAIL())),
     IN("Admin", SELECT(PersonRoles[role], AND([person_id]=ANY(SELECT(People[id], [email]=USEREMAIL())), [active]=TRUE)))))
```

Bot: Adds only, filter `[status] = "Ready"`, call:

```
appSheetR1CommandFromRequestRow("TASK_COMPLETE", [id], USEREMAIL())
```

Arguments (exactly three): `commandType` = `"TASK_COMPLETE"`, `requestRowId` = `[id]`, `actorEmail` = `USEREMAIL()`.

If you still use a JSON `appSheetR1Command` Complete Task path, allow payload keys `completion_note`, `evidence_path`, optional `evidence_id`, for PRE01 `invoice_number` / `invoice_sent` / optional `outcome`, for PRE02 `contract_id` / `contract_signed` / optional `outcome`, for PRE03 `deposit_bank_confirmed` / `deposit_amount` / `deposit_received_date` / `deposit_bank_reference`, and for PRE04 `customer_details_verified` / `sold_value_verified` / `verified_gross_amount` — never invent Evidence ids or pass an expected deposit amount from AppSheet.

### PRE03 owner assignment and DEV repair

**Rule.** PRE03 "Confirm bank deposit" is always owned by Ben (`PERSON-ben`), with Dan Barnes (`PERSON-dan`) as backup. The pair is defined once, as `S06_PRE03_RESPONSIBILITY` in `s06/gates.js`, and is looked up by People ID. It is never taken from "the first active Admin", so adding more Admins, or reordering PersonRoles rows, cannot change it.

- Ben must be active and hold an active Admin, Manager or Director role. Otherwise Sold intake fails visibly with `S06_CONFIG` rather than choosing someone else.
- Dan is the backup only if he is active and holds one of those roles; otherwise the backup is left blank.
- Both task creators (Sold intake and booking-gate reconciliation) use this rule. Replays and re-evaluation skip an existing PRE03, so they never duplicate or reassign it.

**Repairing a PRE03 created before the fix.** Run these from the **standalone bridge** Apps Script editor, signed in as an active Admin or Manager (for example Lenny). The bound adapter project cannot run them.

1. `runR1APre03AssignmentAudit`: read-only. Lists every R1 pilot PRE03 whose owner is not Ben. Open tasks show `action: "Reassign"`; completed ones show `"NotRepairable"` and are left alone.
2. `runR1ARepairPre03AssignmentSSSEXL5961DryRun`: read-only plan for SS-SEXL-5961. Check `plan.current_owner_name = "Lenny DEV"`, `plan.canonical_owner_name = "Ben"`, `plan.current_backup_name = "Dan Barnes"`, `plan.backup_matches = true`, `plan.action = "Reassign"`.
3. `runR1ARepairPre03AssignmentSSSEXL5961Apply`: writes. Expect `status: "Reassigned"`.
4. Run the dry run again. Expect `plan.action = "AlreadyCorrect"`. Running Apply again returns `AlreadyCorrect` and writes nothing.
5. Sync AppSheet. PRE03 now shows Owner Ben, Backup Dan Barnes, the same due date, and version increased by one.

What the repair changes: `owner_id`, `version` (+1), `updated_at`, `updated_by`, `commit_id` on that one task. It writes one CommitJournal row, one TaskEvent `Reassign` (old owner, new owner, unchanged due date) and one AuditEvent. It does not change the task ID, status, due dates, backup, completion fields, other tasks, the Job or readiness. Do not run `runR1ARepairPre03Assignment` itself from the editor Run button. It needs a job argument, and without one it returns `R1A_JOB_REF_REQUIRED` with a hint. For other jobs, call `runR1ARepairPre03Assignment("<public SS- ID or internal J- ID>", false)` from a one-line wrapper, check the dry run, then call it again with `true`.

Every dry run, apply and refusal includes `diagnostics` with three parts:
- **`store`:** the spreadsheet actually opened (`spreadsheet_id`, `spreadsheet_name`, `environment`, row counts).
- **`lookup`:** the supplied reference, whether it matched `Jobs.job_id` or `Jobs.id`, `resolved_job_internal_id`, `resolved_public_job_id`, and `normalized_match` when invisible characters had to be ignored.
- **`pre03`:** the PRE03 task IDs found by `Tasks.job_id = Jobs.id`.

Diagnostics never include customer data. A `R1A_JOB_NOT_FOUND` result shows `public_id_matches: 0`, `internal_id_matches: 0`, and the spreadsheet that was searched.

### TASK_REOPEN (DEV only)

Use when a task was completed incorrectly and must return to active work (e.g. PRE01 completed without invoice evidence during acceptance testing). Prefer this over any sheet edit.

Create `DEVTaskReopenRequests` in the DEV spreadsheet only, columns in order:

`id`, `command_id`, `task_id`, `expected_version`, `reopen_reason`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_message`

Initials: `id`/`command_id` = `UNIQUEID()`; `submitted_by` = `USEREMAIL()`; `submitted_at` = `NOW()`; `status` = `"Ready"`. Lock identity/input columns after create; `result_*` read-only. Do not allow editing `submitted_by`.

From the existing **Task Detail** view (same detail path as Complete Task — do not create a competing detail view), add action **Reopen Task**:

```
LINKTOFORM("DEV Reopen Task Form", "task_id", [id], "expected_version", [version])
```

Show_If only when reopenable and authorized (do **not** show on Open / Waiting / InProgress):

```
AND(IN([status], {"Complete","NotRequired"}),
  OR([owner_id]=ANY(SELECT(People[id], [email]=USEREMAIL())),
     [backup_id]=ANY(SELECT(People[id], [email]=USEREMAIL())),
     IN("Admin", SELECT(PersonRoles[role], AND([person_id]=ANY(SELECT(People[id], [email]=USEREMAIL())), [active]=TRUE))),
     IN("Manager", SELECT(PersonRoles[role], AND([person_id]=ANY(SELECT(People[id], [email]=USEREMAIL())), [active]=TRUE)))))
```

Prefer also `TASK_ACTION_AVAILABILITY` → `appsheet_commands.task_reopen.available`. Never show Complete Task and Reopen Task for the same status.

Form requires `reopen_reason` (text). Form Saved opens **Task Reopen Result** (§6A). Its **Back to task** action opens `LINKTOROW([task_id], "Task Detail")`.

Bot: Adds only, filter `[status] = "Ready"`, call:

```
appSheetR1CommandFromRequestRow("TASK_REOPEN", [id], [submitted_by])
```

Exactly three arguments. Pass `[submitted_by]`, not Apps Script `USEREMAIL()`, matching other request-row bots.

Backend effects: status → `Open`; clear `completed_at` / `completed_by`; preserve `completion_note` / `evidence_id` and all prior TaskEvents/AuditEvents; bump `version`; TaskEvent `Reopen` + AuditEvent; CommitJournal idempotency. For PRE01–PRE05, re-evaluate prebooking readiness (ReadyToBook demotes to Prebooking when gates fail). InvoiceStages / Evidence rows are **not** deleted. Replay is safe; `external_calls = 0`.

### TASK_EVIDENCE_ATTACH: Add contract evidence (PRE02 only, DEV only)

**Add contract evidence** uploads the signed contract for a PRE02 task. The backend picks the mode from the task's current state:

| PRE02 task state | Effect of a successful upload | Result shown |
|---|---|---|
| `Open`, `Waiting` or `InProgress`, not revision required | Creates or reuses the canonical `Evidence` row (category `Contract`) and stores its id on `Tasks.evidence_id`. `Tasks.version` goes up by one. The task stays open. Job contract fields, `PRE02_satisfied`, `signed_contract_evidence` and readiness are not changed. | `FollowUpRequired`: "Signed contract evidence uploaded. Complete the contract task to confirm it is signed." |
| `Complete` with blank `evidence_id` (legacy repair) | Attaches evidence, stamps the Job contract fields, re-evaluates readiness. Completion fields are kept. | `Succeeded`: "Contract evidence added." |
| `Complete` with evidence already attached | Refused, nothing written (`R1A_EVIDENCE_ALREADY_ATTACHED`). | `Failed` |
| Any other template, or PRE02 `Cancelled`, `NotRequired`, `Blocked` or revision required | Refused, nothing written (`R1A_TASK_NOT_ATTACHABLE`). | `ActionRequired` |

An upload never completes PRE02. Only Complete Task with `contract_id`, `contract_signed = Yes` and valid job evidence records a signed contract. A second upload to an open PRE02 replaces `Tasks.evidence_id`; the earlier Evidence row is kept for audit.

#### PRE02 signed contract sequence

1. **Task Detail → Add contract evidence.** Upload the signed contract and save.
2. **Contract Evidence Result** shows `SAVED – FOLLOW-UP NEEDED`. Tap **Complete contract task** (§6A.6), or go back to the task after sync.
3. **Complete Task form** opens with `expected_version` and `evidence_id` prefilled from the task row. Enter `contract_id`, choose `contract_signed = Yes`, add the completion note, save.
4. **Task Complete Result** shows `SUCCESS`. The Job's `contract_id`, `contract_status = Signed`, `contract_signed_at` and `contract_evidence_id` are stamped, PRE02 is Complete and readiness is re-evaluated.

The one-step alternative still works: upload the file in the Complete Task form's `evidence_path` column. Never type or paste an Evidence ID.

`expected_version`: every upload increases `Tasks.version`. The Complete Task action passes `[version]` and `[evidence_id]` from the synced task row, so a form opened after the upload has both. A form opened before the upload is refused as stale; staff go back, sync and open it again.

Create `DEVTaskEvidenceAttachRequests` in the DEV spreadsheet only, columns in order:

`id`, `command_id`, `task_id`, `expected_version`, `evidence_path`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_message`, `result_code`, `result`, `result_at`

Initials: `id`/`command_id` = `UNIQUEID()`; `submitted_by` = `USEREMAIL()`; `submitted_at` = `NOW()`; `status` = `"Ready"`. Lock identity/input columns after create; `result_*` read-only. Do not allow editing `submitted_by`. `evidence_path` is File (same DEV evidence folder). No AppSheet Add/Edit on Evidence.

Show_If for action **Add contract evidence**, combined with the same owner/backup/Admin authorization expression as Complete Task:

```
AND([template_code] = "PRE02",
  OR(AND(IN([status], {"Open", "Waiting", "InProgress"}), [revision_required] <> TRUE),
     AND([status] = "Complete", ISBLANK([evidence_id]))))
```

Prefer `TASK_ACTION_AVAILABILITY` → `appsheet_commands.task_evidence_attach.available`, which uses the same rule. On an open PRE02, show **Add contract evidence** and **Complete Task** together. Never show Complete Task when status is Complete.

Form:

```
LINKTOFORM("DEV Attach Contract Evidence Form", "task_id", [id], "expected_version", [version])
```

Form Saved: **Show result** → Contract Evidence Result (§6A.6).

Bot: Adds only, `[status] = "Ready"`. Call with the request row's authenticated submitter. **Pass `[submitted_by]`, not Apps Script `USEREMAIL()`**:

```
appSheetR1CommandFromRequestRow("TASK_EVIDENCE_ATTACH", [id], [submitted_by])
```

Exactly three arguments. The bridge requires row `submitted_by` to equal the bot actor argument, then authorizes via normal job assignment plus task owner/backup/Admin rules. Tanya can upload on a Tanya-owned PRE02; unrelated Office users and assigned staff who don't own the task cannot. Every successful upload writes one CommitJournal entry, one `EvidenceAttach` TaskEvent and one AuditEvent. Refused or pending uploads write nothing operational. Replay with the same `command_id` is safe and returns the same result; `external_calls = 0`.

### Upload availability race (all File/Image request columns, DEV only)

AppSheet writes the request row and fires the bot before the uploaded file is necessarily visible through Drive. The bridge treats that as **retryable**, never as a validation failure, and the user never resubmits:

1. `_r1cResolveUpload` waits in-call (lookups at 0 s, 2 s, 6 s, 12 s — bounded, before any write). Most uploads resolve here and the bot sees `ok:true`.
2. If still not visible the bot receives `{"ok":false,"error":"R1C_UPLOAD_PENDING","retryable":true,"retry":{"scheduled":true,"outbox_id":"OUT-R1U-<row id>","attempt":1,"max_attempts":5,"next_attempt":"…"}}`. One `Outbox` row (`action_type = R1RequestUploadRetry`, `idempotency_key = R1U:<table>:<row id>`) is created per request row; the request row itself is not modified except `result_status = UploadPending` / `result_message` when those columns exist.
3. A time-driven trigger on the standalone bridge project runs `runR1URetryUploadRequests()` every 5 minutes. Each due item re-reads the authoritative request row, acts as `row.submitted_by` (locked at create), refuses if any identity/input column changed since scheduling (`R1U_REQUEST_CHANGED`), and re-runs the normal `appSheetR1CommandFromRequestRow` path with the same `command_id`, so journals (`CJ-R1A-` / `CJ-R1C-`) make duplicate Evidence rows or lifecycle side effects impossible.
4. Backoff 1 / 2 / 4 / 8 / 16 minutes, five attempts in total (bot attempt included). A file that never appears ends as `Outbox.status = NeedsReview` with `R1C_UPLOAD_MISSING`, and the request row shows `result_status = ActionRequired` with a message asking for a new request (`result_code = R1C_UPLOAD_MISSING`); `runRsSweep()` raises the RS-REVIEW task. Any other error (stale version, access denied, recovery required) is final on first sight.
5. The same trigger sweeps `DEVTaskCompleteRequests`, `DEVTaskEvidenceAttachRequests`, `DEVInstallerCommandRequests` and `DEVGoodsInRequests` for `Ready` rows that carry an upload but have neither a journal entry nor an Outbox row (rows submitted before this mechanism, or whose bot call never reached the backend) and schedules them the same way. Rows without an upload, non-Ready rows and rows already journaled are never touched. Rows whose `result_status` is already `ActionRequired` or `Failed` are skipped too: the bot reached the backend and recorded a refusal, so staff submit a new request instead.

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
| Booking Gates (admin diagnostic only; no staff action) | BOOKING_GATES | empty payload |
| Deposit Confirm | DEPOSIT_CONFIRM | request row via `appSheetR1CommandFromRequestRow` |

### DEPOSIT_CONFIRM (legacy secure request row, DEV only — superseded by PRE03 Complete Task)

Prefer completing PRE03 through the Complete Task form. `DEPOSIT_CONFIRM` remains registered for compatibility, but it is **not** a weaker route: a request with `reference` only is refused (`R1A_REQUIRED_DEPOSIT_BANK_CONFIRMED`), it never calls the old S13 stamp, and it can only record the Jobs / InvoiceStage deposit summary through the same `ManualBankChecks` recorder as PRE03 — explicit `deposit_bank_confirmed=Yes`, `deposit_amount` reconciled server-side to the deposit InvoiceStage, `deposit_received_date`, and `reference`. It does not Complete the PRE03 task, so ReadyToBook still requires PRE03 Complete Task (which re-uses the existing check rather than duplicating it). If you keep the table, add the three optional columns `deposit_bank_confirmed` (Enum Yes/No), `deposit_amount` (Price) and `deposit_received_date` (Date); otherwise disable its bot/action.

Create `DEVDepositConfirmRequests` in the DEV spreadsheet only, with these columns in order:

`id`, `command_id`, `job_id`, `expected_version`, `reference`, `deposit_bank_confirmed`, `deposit_amount`, `deposit_received_date`, `submitted_by`, `submitted_at`, `status`, `result_status`, `result_stage_id`, `result_message`.

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

Also prefill customer and booking columns from the related Customer / Job. The normal staff-facing **Continue Booking** action is owned by the assigned Office user (with permitted backup/Admin access) and is shown from Job Detail and the Ready to Continue Booking queue when `[workflow_stage]="ReadyToBook"` and ACTION_AVAILABILITY `booking_intake.available` is true. It passes both IDs from the selected row, so staff never type an internal job id. The backend still accepts an early booking link, but it must not skip `ReadyToBook`; `ReadyToBook` advances to `BookingInProgress` only through S05.

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

### New Job Sold post-save destination

Configure the successful form save to return staff to the request record rather than the empty default Ref view:

1. Add a slice named **My Requests** over `DEVNewJobSoldRequests` with row filter `[submitted_by] = USEREMAIL()`.
2. Add a staff-facing Table or Deck view named **My Requests** using that slice. Show `command_id`, `result_status`, `result_job_id_human`, and `result_message`; keep the request row visible while the bot is processing so the user can sync and see its result.
3. On `DEVNewJobSoldRequests`, add an action named **Return to My Requests**, type **App: go to another view within this app**, target `LINKTOVIEW("My Requests")`.
4. In **UX → Views → New Job Sold form → Event actions → Form Saved**, select **Return to My Requests**. Enable automatic updates/Quick Sync for the app.

The bot runs the command and the bridge writes the result columns (`result_status`, `result_message`, `result_job_id`, `result_job_id_human`, `result_version`, and the optional `result_code` / `result` / `result_at`; see §6A). Do not create a Job from the navigation action, copy result data to another table, or bypass `appSheetR1CommandFromRequestRow`. Immediately after save the row may show a processing/blank result until the bot finishes; after sync, the same My Requests row displays the authoritative human Job ID and status.

**Identity acceptance testing:** AppSheet editor **Preview As** changes presentation and row expressions but is not proof that the Apps Script execution session belongs to that staff member. Staff-role acceptance tests must be run while actually signed in as the intended staff Google account (for example Dave), and the resulting `submitted_by`/resolved actor must be checked. `salesperson_id` remains editable business data and must never be treated as the authenticated actor. Do not relax the session, `USEREMAIL()`, or request-row identity cross-checks to accommodate editor preview testing.

---

## 6A. Command result feedback (all request-row commands, DEV only)

### 6A.1 What changed and why

Previously the bridge only returned JSON to the bot. Nothing wrote the outcome back to the request row, so `status` stayed `Ready` and `result_status` / `result_message` stayed blank. The AppSheet Automation Monitor shows **Success** whenever the Apps Script function returns, even when the return value is `{"ok":false,"error":"R1A_REQUIRED_EVIDENCE_ID"}`, so it can't be used as business feedback.

`appSheetR1CommandFromRequestRow` now reads the business outcome from the command response and writes it onto the same request row:

| Column | Written value |
|---|---|
| `result_status` | `Succeeded`, `FollowUpRequired`, `ActionRequired`, `Failed` or `UploadPending` |
| `result_message` | Staff-facing sentence. `Failed` adds `Reference: <command_id>.` |
| `result_code` (optional) | Internal code for diagnostics, for example `R1A_REQUIRED_EVIDENCE_ID`. Blank on success |
| `result` (optional) | Compact JSON detail: business status, replay, task status, blocking reason, job ID |
| `result_at` (optional) | Date/time the result was written |
| `result_job_id`, `result_job_id_human`, `result_version`, `result_workflow_stage`, `result_issue_id`, `result_stage_id` | Filled on success for Sold, Booking, Raise Issue and Deposit Confirm when those columns exist |

Rules the bridge enforces:

- Only `result_*` columns that exist on the sheet are written. Inputs and `status` are never changed. `status` stays `Ready` because it is the submission flag that the bot filter and upload retry read.
- Results are written only when the row's `submitted_by` (or `requested_by` on `DEVCreateIssueRequests`) matches the bot's actor email.
- A `Succeeded` or `FollowUpRequired` result is final. A replay or a later refusal of the same request row never overwrites it.
- `ActionRequired` means the staff member can fix it. Correct the input and submit a **new** request (new `command_id`). Never edit and resubmit the old row.
- Upload retries (§ Upload availability race) write through the same writer and messages.
- `appSheetR1Command` (JSON path) returns the same `feedback` object but has no request row to write to.

Example for request row `0c046a5b`:

```
result_status  = ActionRequired
result_message = Signed contract evidence is required. Add the signed contract evidence and try again.
result_code    = R1A_REQUIRED_EVIDENCE_ID
```

### 6A.2 Command coverage

| Request table | Commands | Result persisted |
|---|---|---|
| `DEVTaskCompleteRequests` | TASK_COMPLETE | Yes |
| `DEVTaskReopenRequests` | TASK_REOPEN | Yes |
| `DEVTaskEvidenceAttachRequests` | TASK_EVIDENCE_ATTACH | Yes |
| `DEVDepositConfirmRequests` | DEPOSIT_CONFIRM | Yes (+ `result_stage_id`) |
| `DEVCreateIssueRequests` | ISSUE_CREATE | Yes (+ `result_issue_id`) |
| `DEVNewJobSoldRequests` | SOLD_INTAKE | Yes (+ job id, human job id, version) |
| `DEVBookingIntakeRequests` | BOOKING_INTAKE | Yes (+ job id, human job id, version, stage) |
| `DEVInstallerCommandRequests`, `DEVGoodsInRequests`, `DEVStockCommandRequests` | IW_*, COMMISSIONING_REVIEW, GOODS_IN_RECEIVE, STOCK_QUARANTINE | Yes, once `runR1CProvisionRequestTables()` has added the optional result columns |
| No request table | CALL_RECORD, ISSUE_UPDATE, PLANNER_UPDATE, MOVE_JOB, CHANGE_INSTALLER, CANCEL_JOB, REINSTATE_JOB, OPERATIONAL_COMPLETE, BOOKING_GATES | `feedback` in the JSON return only |

Staff messages already exist for every command in the last row. Persisting them requires a request table for each command, registered in `R1A_REQUEST_TABLES` with a row builder. That is a separate change.

### 6A.3 Sheet columns (manual)

Add any missing columns at the end of each request sheet, then **Data → Tables → Regenerate structure** in AppSheet:

- `result_status`, `result_message` on every request table listed above (most already have them).
- Recommended on every request table: `result_code`, `result`, `result_at`.
- R1C tables: run `runR1CProvisionRequestTables()` as Admin in the standalone bridge. It adds all five columns and is repeatable.

Column settings (every request table):

| Column | Type | Editable_If | Show_If |
|---|---|---|---|
| `result_status` | Enum, base type Text. Values `Succeeded`, `FollowUpRequired`, `ActionRequired`, `Failed`, `UploadPending`. Allow other values: On | `FALSE` | `CONTEXT("ViewType") <> "Form"` |
| `result_message` | LongText | `FALSE` | `CONTEXT("ViewType") <> "Form"` |
| `result_code` | Text | `FALSE` | Admin-only expression from §2A.5 |
| `result` | LongText | `FALSE` | Admin-only expression from §2A.5 |
| `result_at` | DateTime | `FALSE` | `CONTEXT("ViewType") <> "Form"` |

### 6A.4 Virtual columns (every request table)

| Column | Type | App formula |
|---|---|---|
| `result_heading` | Text | `IF(ISBLANK([result_status]), "PROCESSING", SWITCH([result_status], "Succeeded", "SUCCESS", "FollowUpRequired", "SAVED – FOLLOW-UP NEEDED", "ActionRequired", "ACTION REQUIRED", "UploadPending", "UPLOAD PROCESSING", "COULD NOT COMPLETE"))` |
| `result_display` | LongText | `IF(ISBLANK([result_status]), "Your request is being processed. Tap Sync in a few seconds to see the result.", [result_message])` |

Context columns:

| Table | Column | App formula |
|---|---|---|
| `DEVTaskCompleteRequests`, `DEVTaskReopenRequests`, `DEVTaskEvidenceAttachRequests` | `task_title` | `LOOKUP([task_id], "Tasks", "id", "title")` |
| same | `task_job_label` | `LOOKUP([task_id], "Tasks", "id", "job_label")` |
| `DEVDepositConfirmRequests`, `DEVCreateIssueRequests`, `DEVBookingIntakeRequests` | `job_label` | `LOOKUP([job_id], "Jobs", "id", "job_label")` |

### 6A.5 Format rules (apply to `result_heading` and `result_display`)

Text is authoritative; colour only reinforces it.

| Rule | Condition | Colour | Icon |
|---|---|---|---|
| Result success | `[result_status] = "Succeeded"` | `#1B5E20` | check_circle |
| Result follow-up | `[result_status] = "FollowUpRequired"` | `#E65100` | schedule |
| Result action required | `[result_status] = "ActionRequired"` | `#B71C1C` | error |
| Result failed | `[result_status] = "Failed"` | `#4E342E` | block |
| Result processing | `OR(ISBLANK([result_status]), [result_status] = "UploadPending")` | `#1565C0` | sync |

### 6A.6 Result views and navigation

Create one **Detail** view per request table. Column order: `result_heading`, `result_display`, context columns, `submitted_at`, `result_at`. Hide every input column. Keep `result_code` / `result` admin-only.

| Request table | Form view (existing) | Result view (new) | Back action target |
|---|---|---|---|
| `DEVTaskCompleteRequests` | Complete Task Form | Task Complete Result | `LINKTOROW([task_id], "Task Detail")` |
| `DEVTaskReopenRequests` | DEV Reopen Task Form | Task Reopen Result | `LINKTOROW([task_id], "Task Detail")` |
| `DEVTaskEvidenceAttachRequests` | DEV Attach Contract Evidence Form | Contract Evidence Result | `LINKTOROW([task_id], "Task Detail")` |
| `DEVDepositConfirmRequests` | DEV Deposit Confirm Form | Deposit Confirm Result | `LINKTOROW([job_id], "Job Detail")` |
| `DEVCreateIssueRequests` | DEV Create Issue Form | Raise Issue Result | `LINKTOROW([job_id], "Job Detail")` |
| `DEVBookingIntakeRequests` | DEV Booking Intake Form | Booking Result | `LINKTOROW([job_id], "Job Detail")` |
| `DEVNewJobSoldRequests` | New Job Sold form | New Job Sold Result | `IF(ISNOTBLANK([result_job_id]), LINKTOROW([result_job_id], "Job Detail"), LINKTOVIEW("My Requests"))` |

Actions on each request table (Behavior → Actions):

1. **Show result**: type *App: go to another view within this app*, target `LINKTOROW([id], "<Result view>")`. Prominence: Do not display.
2. **Back to task** (task tables) or **Back to job** (job tables): type *App: go to another view within this app*, target from the table above. Prominence: Display prominently. Show_If `TRUE`.
3. **My Tasks**: `LINKTOVIEW("My Tasks")`. Prominence: Display prominently. Show_If `IN([result_status], {"Succeeded", "FollowUpRequired"})`.
4. **Try again** (`DEVTaskCompleteRequests`): type *App: go to another view within this app*, target:

```
LINKTOFORM("Complete Task Form",
  "task_id", [task_id],
  "expected_version", LOOKUP([task_id], "Tasks", "id", "version"),
  "evidence_id", LOOKUP([task_id], "Tasks", "id", "evidence_id"),
  "completion_note", [completion_note],
  "invoice_number", [invoice_number], "invoice_sent", [invoice_sent], "outcome", [outcome],
  "contract_id", [contract_id], "contract_signed", [contract_signed],
  "customer_details_verified", [customer_details_verified], "sold_value_verified", [sold_value_verified], "verified_gross_amount", [verified_gross_amount],
  "deposit_bank_confirmed", [deposit_bank_confirmed], "deposit_amount", [deposit_amount], "deposit_received_date", [deposit_received_date], "deposit_bank_reference", [deposit_bank_reference])
```

   Show_If `AND([result_status] = "ActionRequired", IN(LOOKUP([task_id], "Tasks", "id", "status"), {"Open", "Waiting", "InProgress"}))`. Do not pass `id`, `command_id`, `submitted_by`, `submitted_at` or `status`; their initial values create a new request. Files are not carried over. For PRE02, use **Add contract evidence** first so the task's `evidence_id` is prefilled. For the other task and job tables, use the same pattern with their own form name and input columns.
5. **Complete contract task** (`DEVTaskEvidenceAttachRequests`): type *App: go to another view within this app*, target:

```
LINKTOFORM("Complete Task Form",
  "task_id", [task_id],
  "expected_version", LOOKUP([task_id], "Tasks", "id", "version"),
  "evidence_id", LOOKUP([task_id], "Tasks", "id", "evidence_id"))
```

   Show_If `AND([result_status] = "FollowUpRequired", IN(LOOKUP([task_id], "Tasks", "id", "status"), {"Open", "Waiting", "InProgress"}), ISNOTBLANK(LOOKUP([task_id], "Tasks", "id", "evidence_id")))`. The LOOKUPs read the task after sync, so the form never uses the pre-upload version. If the button isn't visible yet, tap Sync. Use your Complete Task form view's actual name.

Form navigation: **UX → Views → <form view> → Behavior → Event actions → Form Saved = Show result**. This replaces any Form Saved navigation to My Tasks.

Sync: **Settings → Offline & Sync**: Automatic updates **On**, Delayed sync **Off**. The bot runs after the form's sync, so the row can show `PROCESSING` briefly. The result appears after the next sync; staff tap Sync if it hasn't appeared. Confirm this timing in DEV with a real staff login.

Automation: keep each bot **Adds only** with filter `[status] = "Ready"`, one *Call a script* step, and the existing three arguments. Remove any bot step that sets `result_status`, `result_message` or `result` from the script return value; the bridge writes them. Do not add a step that writes `status`.

Optional history: a **My Requests** slice per request table with `[submitted_by] = USEREMAIL()` (`[requested_by] = USEREMAIL()` for `DEVCreateIssueRequests`), sorted by `submitted_at` descending, with Row selected = the result view.

---

## 7. ACTION_AVAILABILITY wiring

1. On Job Detail open, run bot `appSheetR1Read` with:
   `{"read_type":"ACTION_AVAILABILITY","job_id":"[id]"}`
2. Store result in a temporary/UX table or use returned `appsheet_commands.*.available` to drive button Show_If.
3. Do **not** treat Show_If as security — processor refuses unauthorised commands.

Same for `TASK_ACTION_AVAILABILITY` on task rows.

**Ready/booking gate workflow:** Do not expose `BOOKING_GATES` as a staff action. Successful PRE01–PRE05 task completion, PRE02 evidence attachment, and deposit confirmation internally rerun the canonical S06 prebooking evaluation. Incomplete requirements leave the Job at `Prebooking` without failing the staff command; the final satisfied requirement advances it once to `ReadyToBook`. `BOOKING_GATES` remains an authenticated explicit command for diagnostics/admin use only. Booking intake then advances `ReadyToBook → BookingInProgress`; the later booking evaluation advances to `Booked` only after BKG01–BKG03 are satisfied. Never expose a force/override field. BKG04/BKG05 then appear as post-Booked manual tasks.

After any request form is saved, open that request's result view (§6A), not My Tasks, so staff always see whether the command succeeded. The result view's **Back to task** and **My Tasks** actions return staff to their work. After a sync, a completed task leaves My Tasks because My Tasks shows active statuses only. Do not create a second task-detail view.

For PRE02 completion forms, require `contract_id` + `contract_signed=Yes` plus signed evidence via `evidence_path` (preferred) or an existing Evidence `evidence_id`. Use `contract_signed=No` / `outcome=AwaitingSignature` for sent-but-unsigned follow-up (does not Complete). For PRE04, require the two structured Yes/No checks, the reconciled GBP amount, and a note; documentary evidence remains optional. For PRE03, the single Ben/Dan task is completed through the same Complete Task form with the four structured `deposit_*` fields; the backend records the `ManualBankChecks` verification, stamps Jobs, Completes the task and re-evaluates readiness in one command. The legacy `DEPOSIT_CONFIRM` command is no longer needed for PRE03 and, if used, requires the same facts (see below). A missing required value must remain visibly blocked.

Open PRE02 without evidence: use **Add contract evidence**, then Complete Task (PRE02 signed contract sequence above). Legacy completed PRE02 with blank `evidence_id`: the same action repairs it. Do not use Apps Script editor helpers for Tony recovery.

---

## 8. Planner views (3 / 6 week)

1. Bot read `PLANNER_3_WEEKS` / `PLANNER_6_WEEKS` with optional `as_of` (YYYY-MM-DD).
2. Display rows: person_id, trade, start_at, end_at, job display (surname – postcode).
3. Multi-day = one allocation spanning dates; multiple jobs/day = multiple rows.
4. Weekends: staffed-day settings already exclude from capacity warnings; show weekend cells empty or grey.
5. Capacity warnings: advisory only (NeedsReview from S11) — show banner text, do not hard-block office confirmation without review.

---

## 9. Column order (Job Detail)

Suggested: Identity (`job_id`, `customer_name`, `postcode`, `address_summary`, `quote_reference`, stage; see §2A.4) → Customer → Match status → Work packages & dates → Allocations → Materials → Equipment → Scaffold → Tasks → Finance flags → System (version, submissions).

---

## 10. Security filters (reminder)

Slices/Show_If are not security. Apply People/role security filters on every connected table as in S04 manual. Installer/scaffolder views stay denied for R1 office app.

Staff UX pollution control (Job `source_system="R1-AppSheet"` allowlist) belongs on **slices** first so Admin synthetic views can still see fixtures. Do not put that allowlist into table Security Filters unless you deliberately want every AppSheet consumer of Jobs/Tasks to lose fixture rows.
