# S16 implementation — 7 September 2026

**LOCAL IMPLEMENTATION PASS (30 tests); DEV CLOUD HAPPY PATH NOT RUN against live Apps Script after Sheet Date checksum fix.** Health monitoring, backup manifest, archive eligibility + action, reopen from archive, restore planning (dry-run only). No real Drive/Calendar/Xero/GHL calls. No destructive restore. PROD untouched.

## Authoritative tables

| Table | S16 role |
|---|---|
| `HealthChecks` | Health check results with outcome, last_success, error_code |
| `ArchiveIndex` | Archive manifest: job_id, archive_location, record_counts, checksum, restored_at |
| `ReportSnapshots` | Backup manifest storage (reuses existing table with report_type='BackupManifest') |
| `CommitJournal` | Scanned for stalled rows (RecoveryRequired, Prepared, Applying) |
| `Outbox` | Scanned for uncertain rows (NeedsReview, RetryDue, Processing-with-retries) |
| `AuditEvents` | Immutable audit log for archive/reopen operations |
| `Jobs` | Archived via `archived_at`; eligibility checks against workflow_stage, operational_complete_at |
| `Tasks` | Archive blocker if open; SYS01/SYS02 system tasks created |
| `TaskTemplates` | SYS01 (09:00 health check), SYS02 (16:30 review) |
| `Issues` | Archive blocker if unresolved |
| `InvoiceStages` | Archive blocker if outstanding balances |
| `Payments` | Checked for outstanding balances |
| `ScaffoldBookings` | Archive blocker if scaffold erected without strip |
| `People` | Owner resolution for system tasks |
| `ReleaseModes` | FN-13, FN-14, FN-16 mode gating |
| `Settings` | Enumerated in backup manifest |
| 44 more tables | Enumerated in backup manifest for record counts |

## ReleaseModes

| FN | Function | Target | Pilot mode |
|---|---|---|---|
| FN-13 | Archive | R4 | Automated/Pilot/R4 |
| FN-14 | Backup/restore + health monitoring | R1 | Automated/Pilot/R1 |
| FN-16 | Daily authorisation/health review | R1 | Manual/Pilot/R1 |

S16 smoke enables FN-13 + FN-14 + FN-16 together (archive + health/backup + daily review). Always restore to Disabled/None after smoke.

## Architecture

### 1. Health status (`_s16HealthStatus`)

Scans system state and returns overall status:

| State | Condition |
|---|---|
| Healthy | No issues, no warnings |
| Degraded | Warnings present (uncertain outbox, stalled in-flight commits, no prior health check) |
| Critical | Issues present (RecoveryRequired commits, ReleaseMode inconsistency) |

Checks performed:
- Stalled CommitJournal rows (RecoveryRequired → Critical, Prepared/Applying → Warning)
- Uncertain Outbox rows (NeedsReview/RetryDue → Warning)
- Failed Outbox (Processing with retries → Warning)
- Last health check presence (none → Warning)
- ReleaseMode consistency (Disabled/scope mismatch → Critical)

Records result in HealthChecks table with idempotent ID. Prior `checked_at` values are normalized before sort so Sheet `Date` objects do not throw.

### 2. Backup manifest (`_s16BackupManifest`)

Creates deterministic backup metadata stored in ReportSnapshots table:
- Enumerates all 60 tables
- Records row counts per table
- Computes checksum hash over schema_version + counts + environment + sheet_id + created_at
- Idempotent: `BACKUP-{command_id}` key prevents duplicates
- No real Drive file creation (destination: NOT_CONFIGURED)

### 3. Backup validation (`_s16ValidateBackup`)

Validates a backup manifest against current state:
- Recomputes row counts (excluding the backup manifest row itself)
- Recomputes checksum using **`totals_json.created_at`** (stable string), never Sheet `ReportSnapshots.created_at` (may be Date / ms-truncated)
- Reports count mismatches
- Returns valid/invalid with details

### 4. Restore planning (`_s16RestorePlan`)

Dry-run only — never performs destructive restore:
- Validates backup manifest
- Checks environment (DEV only) and sheet ID (exact match)
- Returns planned action with warnings
- Always blocked with explicit reason

### 5. Archive eligibility (`_s16ArchiveEligibility`)

Checks whether a job qualifies for archival:

Required conditions (ALL must pass):
1. Operationally complete (`operational_complete_at` set)
2. ≥ 6 calendar months since operational completion (not 180 days)
3. Not cancelled (no `cancellation_at`, not CancellationInProgress/Cancelled)
4. No open Tasks (status not Complete/NotRequired/Cancelled)
5. No unresolved Issues (status not Resolved/Closed)
6. Handover sent or approved
7. No outstanding invoice balances
8. No pending Outbox items for this job
9. No scaffold still erected without strip
10. Not already archived

### 6. Archive action (`_s16ArchiveJob`)

Archives an eligible job:
- Creates ArchiveIndex entry with record counts and checksum
- Sets `Jobs.archived_at`
- Creates AuditEvent
- Idempotent: checks for existing archive entries
- Does NOT delete any rows — all operational history preserved

### 7. Reopen from archive (`_s16ReopenArchivedJob`)

Restores an archived job to active state:
- Clears `Jobs.archived_at`
- Sets `ArchiveIndex.restored_at`
- Creates AuditEvent
- Preserves all original IDs and history
- Does NOT recreate external side effects
- Idempotent: detects already-reopened state

### 8. System tasks (`_s16SystemTasks`)

Creates daily health review tasks:
- SYS01: Tanya's 09:00 authorisation/integration health check
- SYS02: 16:30 end-of-day review
- Deterministic instance_key prevents duplicates
- Owner resolution: Tanya (Office) or Ben (Manager) from People table
- Sheet boolean `TRUE`/`true` treated as active

### 9. ReleaseMode toggle (`_s16SetModes`)

Enables/disables FN-13, FN-14 and FN-16:
- Guard: exact DEV sheet + environment
- Lock-based concurrent safety
- Validates starting state before transition
- Idempotent

## Source files

| File | Purpose |
|---|---|
| `s16/health.js` | Core health/backup/archive/restore engine |
| `s16/fixture.js` | Minimal synthetic fixture and smoke runner |
| `s16/cloud-adapter.js` | Cloud sheet enumeration adapter |
| `apps-script/s16/S16Health.js` | Built DEV bundle (`npm run build:s16`) |

## Cloud smoke functions

| Function | Purpose |
|---|---|
| `restoreS16SafeState()` | Disable S16 functions (FN-13/14/16 → Disabled/None) |
| `runS16FixtureDryRun()` | Read-only preflight — validate headers, modes, existing data |
| `runS16FixtureApply()` | Seed synthetic fixture (3 Jobs, 1 Task, 2 People, shared SYS templates) |
| `runS16FixtureValidate()` | Verify fixture rows; shared templates skip created_by check |
| `runS16EnableFunctionsForSyntheticTest()` | Enable FN-13/14/16 → Pilot mode |
| `runS16HappyPathTest()` | Full smoke: health, backup manifest, validate, restore plan (blocked), archive eligibility, archive, reopen, system tasks |

## Tests (30, all passing)

| # | Test |
|---|---|
| 1 | Health status returns Healthy with no issues |
| 2 | Stalled CommitJournal detected as Critical |
| 3 | Uncertain Outbox detected as Degraded |
| 4 | Backup manifest created deterministically |
| 5 | Backup manifest idempotent |
| 6 | Backup validation passes for valid manifest |
| 7 | Invalid backup refused |
| 8 | Restore plan is dry-run only, blocked |
| 9 | Cross-environment restore refused |
| 10 | Archive eligible — old job (>6 months, no obligations) |
| 11 | Archive NOT eligible — recent job (<6 months) |
| 12 | Archive NOT eligible — open task blocks |
| 13 | Archive NOT eligible — unresolved issue blocks |
| 14 | Archive NOT eligible — outstanding payment blocks |
| 15 | Archive action succeeds for eligible job |
| 16 | Archive idempotent — repeated archive is no-op |
| 17 | Archive preserves all operational history |
| 18 | Reopen from archive restores job to active |
| 19 | System tasks SYS01/SYS02 created with correct owners |
| 20 | ReleaseMode refusal when disabled |
| 21 | Wrong DEV sheet/environment refused |
| 22 | Archive eligibility always returns blockers array even for missing job |
| 23 | Shared canonical templates reused when pre-existing from prior stages |
| 24 | Incompatible shared template fails closed |
| 25 | Fixture validate accepts shared templates without created_by check |
| 26 | Date handling parity — Date objects, strings, invalid |
| 27 | Backup validation tolerates Sheet Date on ReportSnapshots.created_at |
| 28 | Health status sorts prior checks when checked_at is Sheet Date |
| 29 | Namespace compatibility — all bundles parse, S16 globals namespaced |
| 30 | Zero-arg DEV smoke with real header adapter reruns (incl. Sheet Date) |

## Defect fixed 7 Sep 2026 (blocking DEV happy path)

Sheets return `Date` for timestamp cells. Backup validation previously hashed `manifest.created_at` from the row; after Sheet readback this could diverge from the string used at create time (ms truncation / Date serialisation). Fix: recompute checksum exclusively from `totals_json.created_at`. Health prior-check sort now normalizes timestamps before `localeCompare`.

## NOT_CONFIGURED

| Area | Reason |
|---|---|
| Real Drive backup file creation | No Drive API in scope; manifest metadata only |
| Destructive restore | Intentionally blocked — dry-run planning only |
| Backup destination/folder IDs | NOT_CONFIGURED — no real Drive folder IDs |
| Restore into isolated environment | NOT_CONFIGURED — requires approved TEST copy / infrastructure |
| Restore timing measurement | NOT_CONFIGURED — no actual restore performed |
| Connection owner reauthorisation | NOT_CONFIGURED — no external auth integration |
| Independent monitoring route | NOT_CONFIGURED — requires external monitoring infrastructure |

## Safe DEV cloud steps (when Lenny pastes corrected bundle)

May run against main DEV workbook (synthetic fixture only; restore remains dry-run):

1. Paste rebuilt `apps-script/s16/S16Health.js` into DEV Apps Script project
2. `restoreS16SafeState()`
3. `runS16FixtureDryRun()`
4. `runS16FixtureApply()` — already PASS historically; idempotent / shared-template safe
5. `runS16FixtureValidate()`
6. `runS16EnableFunctionsForSyntheticTest()`
7. `runS16HappyPathTest()` — includes blocked restore plan; does **not** overwrite workbook from backup
8. `restoreS16SafeState()` even if a prior step fails

Do **not**: run destructive restore, invent Drive folder IDs, touch PROD, or restore into the main DEV workbook as a real rollback.

No real Drive/Calendar/Xero/GHL calls. No PROD references. No destructive restore.
