# S20 production release and phased cutover

S20 is a preparation and simulation layer only. It does not deploy, write to production, change a `ReleaseMode`, invoke an integration, or perform cutover. The current authorization for R1, R2, R3, and R4 is **BLOCKED**. A local implementation pass is not production readiness.

## Authorization model

Each release is evaluated independently as `AUTHORIZED_FOR_CUTOVER`, `BLOCKED`, `NOT_EVALUATED`, or `FAIL`. Authorization is deterministic and fail-closed: every required S18 item must pass, S19 must report `READY_FOR_S20`, and its acceptance, migration, training, and cutover groups must contain no blocked, not-run, or failed item. Production configuration, approval, verified backup/recovery, creator switch, Pilot scope, fallback, and exact current `ReleaseModes` must also pass. Missing data is never inferred from a majority of passing checks.

S20 consumes both the current S19 handoff fields and the corrected grouped contract through `_s20AdaptS19`. The expected final per-release shape is `status`, grouped `acceptance`, `migration`, `training`, and `cutover` arrays (`blocked`, `not_run`, `failed`), plus `creator_map`, `pilot_scope`, and `fallback_plan`. S20 does not duplicate S19 blocker derivation.

## Release plans

| Release | Included canonical functions | Pilot target |
|---|---|---|
| R1 Office | FN-01, FN-11, FN-14–FN-20 | Each approved function moves from Disabled/None to its configured Manual or Automated mode with Pilot scope only |
| R2 Materials / scaffolding / Calendar | FN-02–FN-05 | Automated/Pilot |
| R3 Installer commissioning | FN-06–FN-08 | Automated/Pilot |
| R4 Finance / reporting / archive | FN-09, FN-10, FN-12, FN-13 | Configured Manual or Automated mode/Pilot |

The exact function name and planned target mode come from the canonical ReleaseModes seed. S20 expects every included function to remain `Disabled/None` with an approved version before cutover preparation can authorize it. It proposes transitions but never applies them. Dependencies are phased R1 → R2 → R3 → R4; a blocker belonging only to a later release does not block an earlier release.

## Production configuration contract

Every entry is explicitly `CONFIGURED`, `NOT_CONFIGURED`, or `INVALID`, with evidence held outside secrets-bearing source. Common requirements are production Sheet, Apps Script, AppSheet, evidence folder and backup folder identifiers; Europe/London; company-controlled accounts; responsible and fallback owners; and a defined pilot-job scope.

R1 additionally requires Jotform mappings, GHL configuration, and real staff accounts. R2 requires Calendar identifiers plus verified merchant and scaffolder details. R3 requires commissioning assets and installer accounts. R4 requires Xero, GHL, Phoenix rules, reporting policy, and archive destination. No production identifiers are guessed or committed here.

## Preflight and creator protocol

Preflight freezes a version, confirms S18 and S19, validates production configuration and exact current modes, verifies backup/recovery evidence, training, owners and Pilot scope, checks fallback, and records the release decision.

The no-dual-creator sequence is mandatory:

1. Identify the current and target authoritative creators and their scope.
2. Freeze or disable the old creator.
3. independently verify the old creator stopped.
4. Confirm the target creator is still inactive.
5. Only during an explicitly authorized future cutover, activate the new creator for the approved Pilot scope.
6. Verify the first controlled job and reconcile external identifiers.

Unknown state, an active old creator, or simultaneous creators blocks release. Dual writing is prohibited.

## Prepared cutover sequence

The deterministic plan is: freeze the old creator; verify it stopped; deploy the approved version; verify schema/configuration; apply only approved function modes and Pilot scope; verify the first controlled job; and reconcile external references. Post-cutover checks cover health, tasks, uncertain outbox outcomes, first-job audit, staff confirmation, external reconciliation, release evidence, and an explicit continue/hold/fallback decision.

This is documentation and simulation output, not an executable production command.

## Stop conditions

Stop without automatic continuation when S18 is not passed; S19 is not `READY_FOR_S20`; signoff, backup, ownership, configuration, training, or Pilot scope is missing; a production identifier or ReleaseMode differs; the old creator remains active; health is critical; a commit is `RecoveryRequired`; an external result is uncertain; a required integration is unconfigured; or first-job verification fails.

## Non-destructive fallback

Fallback stops the new creator and returns affected functions to the approved Disabled or Manual state. It preserves created records, audit history, and external IDs; reconciles uncertain external effects; continues affected jobs manually; records the incident and reason; and requires fresh authorization before retry. It never deletes production records or rewinds history.

## Required release evidence

An actual future release record must contain release/version and timestamp; release phase; approver and operator; S18 and S19 result references; backup reference and recovery verification; production configuration validation; ReleaseModes before/after; creators before/after and old-stop proof; approved Pilot scope; first job ID; health and external reconciliation results; whether fallback was invoked; incident/decision references; and notes. DEV simulation fabricates none of these.

## Current blockers and next actions

S18 reports all releases blocked and S19 does not provide a ready handoff. Production IDs/configuration, real approval, backup/recovery evidence, Pilot jobs, and creator-stop evidence are intentionally absent. Therefore every real release must remain blocked.

Before any production action: genuinely close the applicable S18 checks; complete the corrected S19 migration/training/cutover handoff; fill and independently validate the production configuration register without committing secrets; rehearse backup/recovery; define owners and Pilot jobs; capture creator freeze evidence; approve a non-destructive fallback; record Ben's release decision; rerun the S20 DEV simulation; review every proposed transition; and obtain separate explicit authority for production execution. S20 deliberately contains no callable production executor.

## DEV simulation

Build with `npm run build:s20` and test with `npm run test:s20`. Apps Script exposes only `runS20ReleaseDryRun()`, `runS20ReleaseSimulation()`, and `runS20ReleaseSummary()`. They enforce the exact DEV Sheet/environment, read S18/S19, list blockers and transitions, and report zero external calls, writes, and production changes.
