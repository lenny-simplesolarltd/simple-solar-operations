# Real Drive data backups and restore procedure — 12 September 2026

**LOCAL IMPLEMENTATION PASS (10 tests); DEV CLOUD NOT YET RUN.** Closes backlog items: real Drive backups, restore procedure. FN-14 (R1 Automated). Complements S16, whose backup is a count-only manifest and whose restore is a dry-run plan.

## What it does

| Function | Effect |
|---|---|
| `_bkExport` | Snapshot of **every schema table** (headers + rows, Sheet Dates as ISO strings) written as one JSON file `SSO-DATA-BACKUP-<id>.json` to `S01_CONFIG.backupFolderId`; `ReportSnapshots` manifest `report_type: DataBackup` with counts, checksum, bytes, file id; AuditEvents row. Idempotent per `command_id`; an existing same-name file is adopted, never duplicated. Without a folder: `NOT_CONFIGURED`, nothing written. Missing tabs are recorded, not fatal |
| `_bkVerify` | Reads the Drive file back, recomputes the checksum over the rows, compares counts, bytes, environment, sheet id and backup id → manifest `validation_status` Verified/Failed with mismatches; audited |
| `_bkCompare` | Read-only per-table row-count differences between a backup and current data; `identical` flag |
| `_bkRestoreRehearsal` | **Non-destructive restore procedure**: writes a *Verified* backup into a NEW spreadsheet (`SSO-RESTORE-REHEARSAL-<backup>-<ts>`, moved into the backups folder), one tab per table; records `RestoreRehearsal` manifest (spreadsheet id, rows per table) and audit. Requires `S01_CONFIG.restoreMode === 'REHEARSAL'` and the literal confirm token `RESTORE_TO_NEW_SPREADSHEET`. Refuses a target equal to the DEV workbook. Never writes operational tables of the DEV workbook |
| `_bkRestoreInPlace` | Refused by construction. Destructive in-place restore requires explicit approval, an isolated environment and all outbound actions disabled (stop condition for the agent) |
| `_bkRetentionReview` | Lists backups older than N days; deletes nothing |
| `_bkStatus` | Configured?, restore mode, last backup, last verified, rehearsals |

The cloud store for this service can insert only `ReportSnapshots`/`AuditEvents` and update only `ReportSnapshots`, so a bug cannot write operational tables. Drive and spreadsheet creation are confined to the two default adapters and are injectable for tests.

## Restore procedure (documented path)

1. Nightly `runBkDailyBackup()` (one backup per calendar day, idempotent) — daily time-driven trigger in DEV once the bundle is pasted.
2. `runBkVerify(backupId)` after each backup (or on a schedule) — only Verified backups can be rehearsed.
3. To rehearse: set `S01_CONFIG.restoreMode` to `REHEARSAL`, run `runBkRestoreRehearsal(backupId, reason)`, open the new spreadsheet from `ReportSnapshots.file_id`, compare with `runBkCompare(backupId)`. Set `restoreMode` back afterwards.
4. Real recovery of the DEV/TEST/PROD workbook: business approval, isolated environment, outbound actions disabled, then a reviewed copy from the rehearsal spreadsheet into the target. Not automated; the service refuses in-place restore.
5. Retention: `runBkRetentionReview(days)` for a human decision; the service never deletes.

## Cloud entry points (`apps-script/backup/BackupService.js`)

`runBkStatus()`, `runBkDailyBackup()`, `runBkBackupNow()`, `runBkVerify(backupId)`, `runBkCompare(backupId)`, `runBkRetentionReview(days)`, `runBkRestoreRehearsal(backupId, reason)`, `runBkHappyPathTest()` (backup → replay → verify → compare → rehearsal when REHEARSAL → in-place refusal). No zero-arg entry point exists for a destructive restore.

Build `npm run build:backup`; tests `npm run test:backup` (`tests/backup.test.cjs`, 10 incl. a cloud simulation with DriveApp/SpreadsheetApp stubs proving DEV tables stay untouched).

## Configuration (`S01_CONFIG`)

```json
{ "environment": "DEV", "backupFolderId": "<DEV Shared Drive Backups folder id>", "restoreMode": "DISABLED" }
```

## DEV cloud steps (pending — no browser/Apps Script access in this session)

1. Paste `apps-script/backup/BackupService.js`; confirm `backupFolderId` (already used by S16's Drive smoke).
2. `runBkHappyPathTest()`; inspect the JSON file in the backups folder.
3. Daily trigger on `runBkDailyBackup()`; weekly `runBkVerify` of the latest backup.
4. One rehearsal with `restoreMode: REHEARSAL`, then restore the flag.

## Not done

- No PROD/TEST backups (structurally DEV only; other environments need their own protected configuration and approval).
- No automatic deletion/retention; no encryption beyond Drive access controls.
- In-place restore intentionally absent.
