# TEST deployment preparation — 12 September 2026

Preparation only. Nothing is deployed to TEST; TEST resources are not created by this repository. RA01/S20 govern release authorisation; this note records what a TEST deployment of the current code would need and which decisions are still the business's.

## 1. What TEST must have before any paste

| Requirement | Status | Note |
|---|---|---|
| Separate company-controlled TEST Google Sheet, bound Apps Script project, standalone bridge project, AppSheet app, evidence and backups folders, secondary calendar | NOT_CONFIGURED | IDs recorded in `config/environment-register.csv`; none exist in this repository |
| TEST `S01_CONFIG` with `environment: "TEST"` and TEST ids/allowlists | NOT_CONFIGURED | S01 guard already accepts DEV or TEST and rejects PROD |
| Verified test inboxes only in `allowedRecipients`; TEST calendar only in `allowedCalendarIds` | NOT_CONFIGURED | No mail adapter exists yet |
| S18 acceptance items PASS/BLOCKED reviewed; S19 migration rehearsal; S20 preflight | NOT_RUN | See `docs/S18-acceptance.md`, `docs/S20-production-release.md` |

## 2. Code finding: the new services are DEV-locked by construction

Every module added on 12 September 2026 (calendar, scaffold, materials, resource, backup, resilience, xero, installer) and the S16 heartbeat carries the DEV sheet id as a hardcoded constant and refuses any other store (`*_DEV_SHEET_ID`, `getEnvironment() === 'DEV'`). The calendar service additionally hardcodes the DEV calendar id. This is intentional for the DEV pilot and means a TEST deployment of these bundles is **structurally impossible without a deliberate code change**.

Preparation decision for TEST (not taken here): introduce one environment profile per module (`{ environment, sheetId, calendarId }`) read from `S01_CONFIG` and validated against an allowlist of **company-registered** TEST ids committed to `config/environment-register.csv`, keeping PROD unreachable. The manifest (`docs/generated/apps-script-manifest.md`) lists which bundles carry the hardcoded ids. Until that change is approved, TEST is limited to the S01–S20 stage bundles already written for dual environments.

## 3. TEST configuration contract (target state)

```json
{
  "environment": "TEST",
  "sheetId": "<TEST sheet id>",
  "backupFolderId": "<TEST backups folder id>",
  "allowedCalendarIds": ["<TEST secondary calendar id>"],
  "calendarMode": "CAPTURE",
  "restoreMode": "DISABLED",
  "allowedRecipients": ["<verified test inbox>"]
}
```

`xeroMode` must remain absent in TEST until R4 approval; GHL stays a human task; customer messaging stays captured.

## 4. Deployment manifest

`docs/generated/apps-script-manifest.json` gives, for every bundle, the SHA-256 to record in the release record, the entry points to smoke, the Google services it uses (Calendar only in `calendar/`, Drive only in `s16/` and `backup/`, HTTP only in the pre-existing `s04-bridge/`), and the `S01_CONFIG` keys it reads. `tests/manifest.test.cjs` fails if a bundle starts using a service outside that allowlist or if the manifest is stale.

## 5. Triggers to register in TEST (after smokes pass)

| Function | Cadence | Purpose |
|---|---|---|
| `runS16HeartbeatTick` | hourly | processing heartbeat |
| `runRsSweep` | 30 min | review tasks + failure alerts |
| `runBkDailyBackup` | daily | full-data backup |
| `runScfChase` | daily | missed erect/strip chase |
| `runScfWeeklyList`, `runMatWeeklyList` | Friday | supplier lists |
| `runCalDispatch` | hourly | only while `calendarMode` is LIVE |

## 6. Open items before TEST

- Environment profile change (section 2) and its tests.
- Real People/roles/calendar, merchant and scaffolder contacts supplied by the business (never invented).
- AppSheet TEST app configured per `docs/R1-office-appsheet-configuration.md` plus the views listed in `docs/DEV-integration-walkthrough.md` step 10.
- Evidence of the DEV walkthrough completed and recorded.
