# Evidence policy

Commit only synthetic, sanitised component evidence. `S01-local-tests.tap` is actual Node test output; `S01-source-version.json` hashes the initial source files and the four authoritative documents, allowing this uncommitted local snapshot to be identified without inventing a release tag. It is not proof of company repository access or deployment. `S01-local-run.json` records actual execution time/runtime/result. Re-run evidence capture for changed code and preserve prior evidence under a new release directory in the company store.

Real connector evidence, account screenshots, production folder identifiers and exports belong in company-restricted storage; `private/` is ignored for local working copies. Record protected evidence references in company copies of the registers. Never include passwords, MFA recovery codes, tokens or real customer records in committed logs. Redact screenshots; identify tester/account by a protected reference when necessary.

Every result requires release/source hash, config version, fixture, environment, component/integration classification, tester/time, expected and actual result, evidence, defect/retest. PASS is observed success; FAIL is observed failure; BLOCKED means a stated dependency prevents execution; NOT RUN means not attempted. No human connector result was supplied in the original S01 snapshot. See the later S02 evidence entry below for current cloud evidence. Later T001–T112 remain NOT RUN; S01 does not claim their acceptance.

Documentation change record: DEC-001 was recorded after the initial S01 local test snapshot. The original test output and source-version manifest remain historical evidence of that run; they do not checksum subsequent documentation edits. No executable code or test result changed for this release-planning clarification.

RA01 documentation change record: release planning, reference/decision entries, inventory guidance and new assertion/mode templates were added after the original S01 local test snapshot. That snapshot remains historical and must not be regenerated to imply these plans were tested. All new release-test rows are NOT RUN; modes are planned, not active. Real release records will link their own exact versions and evidence.

## S02 DEV cloud evidence — 5 September 2026

[S02-dev-validation-2026-09-05.json](S02-dev-validation-2026-09-05.json) transcribes user-supplied captured cloud output, including provenance and absent metadata. [Closure and limits](../S02-closure.md). Historical S01 files above remain unchanged. Current S01 A1/A2 CAPTURE and B1 refusal passes are user reports, not fabricated raw logs. No release acceptance follows.

## S04 local implementation evidence

[S04-local-run.json](S04-local-run.json) records the actual 215-test local run, runtime and source hashes; [S04-local-tests.tap](S04-local-tests.tap) is its captured TAP output. Includes 93 new S04 tests and all 122 previous tests. This is local mock/filesystem/packaged-runtime verification, not cloud deployment, AppSheet sign-in or G04 acceptance.
