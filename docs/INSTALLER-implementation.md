# Installer mobile workflow — 12 September 2026

**LOCAL IMPLEMENTATION PASS (9 tests); DEV CLOUD NOT YET RUN.** Closes backlog items: installer mobile workflow, completion evidence, remedials/issues (backend). FN-06 "Installer app/forms access" (R3). No commissioning questions, thresholds or certificates are invented: drafts carry `template_version: NOT_CONFIGURED` until approved templates exist. AppSheet installer screens remain browser work.

## Rules applied

- Installers see and act on **assigned work only** (active allocation); office roles may act with a reason. The cloud entry point takes the actor from the signed-in session and ignores any client-supplied actor.
- Required trades are reported by the installer (`ReportedComplete`) and **confirmed by the office** (S10 INS01 call → `ConfirmedComplete`). Reporting never sets confirmation.
- `ReturnRequired` creates a Remedial issue (responsible = original installer, blocks completion), a linked return package with the **same trade** and `parent_package_id` (no new trade string; confirmed Roof/Electrical constraint), a dateless allocation so the original installer keeps responsibility, `REM01` for Tanya and `BKG02` to book the customer date.
- Problems (Access/Damage/Technical/Safety/MaterialsShort/Other) and Variations can be reported before the final form; variations go to the `VariationApprover` (Hannah) with `ISS01` due the same staffed day; Safety/Technical problems block completion by default.
- Commissioning: draft/resume with upserted answers and evidence; submit is immutable; a `Returned` form is never edited — corrections become a superseding draft (`supersedes_submission_id`); `Accepted` closes the package's forms.
- Evidence rows are deduplicated per Drive file id per package and refused when the file is already linked to another job (cross-job denial). No financial or private issue data in the installer read.
- Every command is idempotent per client-generated `command_id` (offline duplicate sync); same id with different content is rejected.

## Functions

| Function | Effect |
|---|---|
| `_iwMyWork(store, personId, {from,to})` | Assigned packages with site, dates, status, expected version, commissioning state, evidence count, open issues, my tasks |
| `_iwStart` | Scheduled/ReturnRequired → InProgress, first `actual_start` |
| `_iwProgress` | Note/percent + Progress evidence, audited |
| `_iwReportCompletion` | `Complete` → ReportedComplete + commissioning Draft (if required); `ReturnRequired` → remedial + return package + tasks |
| `_iwReportProblem` / `_iwReportVariation` | Issues with IssueEvents, evidence, ISS02/ISS01 tasks |
| `_iwSaveCommissioningDraft` / `_iwSubmitCommissioning` | Draft/resume/supersede and immutable submit |

Cloud (`apps-script/installer/InstallerWorkflow.js`): `runIwMyWork(from, to)`, `appSheetInstallerCommand(commandType, payloadJson)` for `IW_START`, `IW_PROGRESS`, `IW_REPORT_COMPLETION`, `IW_REPORT_PROBLEM`, `IW_REPORT_VARIATION`, `IW_COMMISSIONING_DRAFT`, `IW_COMMISSIONING_SUBMIT`; `runIwEnableFn06ForSyntheticTest()` / `restoreIwSafeState()`; `runIwHappyPathTest()` (synthetic job allocated to the signed-in user: start → progress → problem → complete → draft → submit; restores FN-06).

Build `npm run build:installer`; tests `npm run test:installer` (`tests/installer.test.cjs`, 9 incl. cloud simulation proving session-derived actor, replay and cross-installer denial).

## DEV cloud steps (pending — no browser/Apps Script access in this session)

1. Paste `apps-script/installer/InstallerWorkflow.js`.
2. Signed in as a People row with an Installer role: `runIwEnableFn06ForSyntheticTest()`, `runIwHappyPathTest()`, `restoreIwSafeState()`.
3. AppSheet installer app: My Work view from `runIwMyWork`, buttons calling `appSheetInstallerCommand` with a device-generated `command_id`, photo capture into the job evidence folder then `drive_file_id` in the payload.

## Not done

- AppSheet installer screens, offline drafts and photo upload UI (browser).
- Office technical review remains S12 `reviewSubmission`; INS01/INS02 scheduling remains S10.
- Real commissioning templates/questions (business input).
