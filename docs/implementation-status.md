# Current implementation status

Updated 6 September 2026. This is the canonical current status register, superseding stale status/authorisation wording in earlier planning snapshots. RA01 remains authoritative: R1 Office → R2 Materials/scaffolding → R3 Installer commissioning → R4 Finance/reporting. Stage completion is not release acceptance.

| Stage/gate | Current status | Evidence and boundary |
|---|---|---|
| S01 | PARTIAL | A1 approved email CAPTURE PASS; A2 approved calendar CAPTURE PASS; B1 unapproved email refusal PASS, as reported by user. Remaining checks NOT RUN / BLOCKED. Capture is not delivery. |
| G01 | BLOCKED / NOT PASSED | [Gate register](S01-gate.md); receipts, other denials, company access and supporting setup evidence remain outstanding. |
| S02 | COMPLETE IN DEV — CLOUD VALIDATION PASS | [Closure](S02-closure.md), [captured cloud output](evidence/S02-dev-validation-2026-09-05.json), 5 Sep 2026. Provisioned once already; do not rerun Apply. |
| S03 | COMPLETE LOCALLY / NOT CLOUD DEPLOYED | Local processor/recovery modules and passing tests; this status does not imply secure cloud readiness. [S04 audit](S04-readiness.md) records concrete integration gaps. |
| S04 | DEV CLOUD HAPPY PATH: PASS | [Implementation](S04-implementation.md), [manual setup](S04-manual-setup.md); 120 S04 local tests pass; 31 fixture tests pass; 12 G04 negative tests pass locally. End-to-end cloud happy-path confirmed 6 Sep 2026 ([evidence](evidence/S04-dev-cloud-happy-path.json)). Task T-open completed through deployed bridge/backend. |
| G04 | CORE DEV CLOUD CONTROL PACK: PASS (5/5) | Five negative cloud tests executed and passed 6 Sep 2026 ([evidence](evidence/S04-dev-cloud-negative-tests.json)): disabled mode, stale version, duplicate replay, command mismatch, out-of-pilot. 14 broader scenarios remain unexecuted in cloud (identity denial, proof forgery, concurrency, recovery, device tests). Full G04 not passed. |
| S05 | LOCAL IMPLEMENTATION PASS / DEV CLOUD NOT YET RUN | [Implementation](S05-implementation.md); 24 S05 tests pass. Sold and Booking intake processing implemented against canonical schema (Intake, Jobs, Customers, MappingRules). Synthetic DEV mappings installed. Real Jotform question IDs not yet verified. FN-01 remains Disabled. No Jotform webhook activated. |
| R1 | NOT RELEASE READY | G01 and applicable R1 acceptance, recovery/security, migration/training and Ben's recorded release decision remain required. |

The user authorised local S04 implementation and it is now delivered without claiming G01 passed. The S04 bridge and backend are deployed as cloud Apps Script projects. The S04 fixture tooling (`apps-script/S04Fixture.js` + `apps-script/S04FixtureCore.gs`) is implemented locally but NOT YET RUN against the DEV cloud sheet. No cloud mutation or deployment was authorised during fixture tooling development. DEV cloud testing requires verified isolation, accounts, transport and packaging described in the S04 audit. No production or release approval follows from S02 closure.

The original S01 evidence and full T001–T112/RT release acceptance records remain historical or outstanding. Local component passes do not close their full integration assertions.
