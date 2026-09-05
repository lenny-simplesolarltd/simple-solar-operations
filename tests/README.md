# S01 tests

Run `npm test` with Node 22 or later. No dependencies/install, credentials, network or cloud resources are required. Tests exercise actual allowlist code and the probe wrapper with instrumented Mail/Calendar stubs. An approved capture or stubbed submission is not delivery evidence. T001–T112 are outside S01 and remain NOT RUN.

`test-register.csv` distinguishes local deliverables from blocked cloud acceptance. Replace expected evidence with actual protected references only after execution. Add one row per component/integration run/retest, keeping earlier results and release versions. For human checks record tester, timestamp, device/browser and signed-in identity reference. Blank results count as NOT RUN. `defects.csv` starts with a header only: no observed unresolved software defect is claimed; missing setup inputs are audit blockers. Log genuine failures with severity, owner, reproducible steps, evidence, fix version and retest; do not treat a resolved test run as proof of an unexecuted integration.

To capture a new local run, invoke Node's TAP reporter and record the command, UTC time, runtime, exit code and source hashes. Keep its evidence under a new version; do not overwrite historical company acceptance evidence. This initial run is in `docs/evidence/`.

## RA01 release planning

Use [release-test-planning.md](release-test-planning.md), `original-case-register.csv`, `original-assertion-plan.csv` and `release-test-plan.csv` alongside the unchanged S01 `test-register.csv`. They retain all T001–T112 and add RT01–RT08 planned runs. All new rows are NOT RUN; original automated assertions stay outstanding even when a scoped manual variant later passes. S18 acceptance, S19 migration/training and S20 controlled release repeat for each release. No tests or functionality were executed/implemented by this planning update.
