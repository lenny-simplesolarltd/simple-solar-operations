# Simple Solar — operations foundations

**S01 PARTIAL; G01 BLOCKED; S02 COMPLETE IN DEV; S03 COMPLETE LOCALLY (not cloud deployed); S04 LOCAL IMPLEMENTATION PASS (not cloud deployed).** See the canonical [implementation status](docs/implementation-status.md), [S02 closure](docs/S02-closure.md) and [S04 implementation](docs/S04-implementation.md) and [manual setup](docs/S04-manual-setup.md). Read [audit](docs/S01-audit.md), [gate](docs/S01-gate.md) and [manual setup](docs/S01-manual-setup.md). The four original DOCX specifications remain authoritative for final functions and technical/business rules; [RA01](Simple_Solar_Phased_Rollout_Amendment.docx) now governs dependency/release sequencing. The [reference index](docs/reference-index.md) distinguishes these authorities from the supporting [management/staff overview](New%20Operations%20System.pdf). All supplied source documents remain unchanged.

Architecture: AppSheet → structured Google Sheets → authoritative Apps Script workflow processor → Google Drive/Calendar and specified external integrations. The 60-table S02 schema is provisioned and cloud-validated in DEV. S03 processor/recovery code exists locally; The minimum S04 command processor, signed identity verifier, durable adapters, client state controller and Apps Script package are implemented locally. The cloud issuer/AppSheet bridge and production integrations are not deployed.

Current default releases: **R1 Office → R2 Materials/scaffolding → R3 Installer commissioning → R4 Finance/reporting**. [DEC-002 / RA01](docs/implementation-decisions.md) supersedes DEC-001’s rollout allocation and strict single-go-live sequencing. See [release plan](docs/release-plan.md) for dependencies, per-release S18/S19/S20, retained manual routes and Ben approvals. R3/R4 may swap only under RA01’s conditions and Ben’s documented approval. Existing processes remain the operational baseline; detailed commissioning awaits its separate amendment.

Run local checks with Node 22+: `npm test`. No npm install or credentials needed. S02 DEV cloud validation passed on 5 September 2026; remaining S01/G01 setup and acceptance evidence is blocked. Do not rerun S02 Apply. Default configuration captures only and rejects empty allowlists; S01 rejects PROD. Do not deploy the probe into an existing/live project. See the manual for a new company-owned test project and independent receipt/access verification.

| File | Purpose |
|---|---|
| `.gitignore` | Excludes private config, raw evidence/exports, credentials and deployment bindings; not a substitute for secret review |
| `package.json` | Dependency-free local test command |
| `apps-script/appsscript.json` | Test project V8 manifest, Europe/London and explicit probe scopes |
| `apps-script/OutboundGuard.js` | Exact recipient/calendar allowlist; fail-closed DEV/TEST guard |
| `apps-script/S01Probe.js` | Manual test-only email/Calendar probe; not executed remotely |
| `config/environment.example.json` | Inert configuration template, null IDs and empty allowlists |
| `config/environment-register.csv` | Separate DEV/TEST/PROD resource/access registration template |
| `config/README.md` | Protected configuration, environment/data and calendar policy |
| `docs/release-plan.md` | RA01 controlled release milestones, dependencies and blockers |
| `docs/release-record-template.md` | Separate acceptance/migration/pilot/Ben approval record per release |
| `integration-inventory/release-ownership-modes.csv` | Planned per-function modes, job scope, owners, versions and fallback |
| `tests/release-test-planning.md` | Assertion allocation and phased acceptance rules |
| `tests/original-case-register.csv` | Preserved T001–T112 setup/expected results and full-case status |
| `tests/original-assertion-plan.csv` | Original clauses and scoped supplements with target/retest releases |
| `tests/release-test-plan.csv` | RT01–RT08 planned runs by release |
| `docs/reference-index.md` | Authoritative specifications and supporting business-context references |
| `docs/operations-overview-review.md` | Full overview review, comparison notes and outstanding commissioning inputs |
| `docs/implementation-decisions.md` | Confirmed business rollout decision and specification boundaries |
| `docs/S01-audit.md` | Requirement/source allocation, inputs, dependencies and exclusions |
| `docs/S01-gate.md` | Individual G01 and supporting S01 statuses/evidence/actions |
| `docs/S01-manual-setup.md` | Company setup and exact isolated G01 execution steps |
| `docs/S01-ownership.md` | Company control, named roles, access and recovery responsibilities |
| `docs/ownership-register.csv` | Actual owner/developer/recovery/backup evidence template |
| `docs/entitlement-register.csv` | Plans, partner access, operations and unsupported-path decisions |
| `docs/evidence/README.md` | Evidence storage, privacy and result standards |
| `docs/evidence/S01-local-tests.tap` | Executed local test output |
| `docs/evidence/S01-local-run.json` | Actual local runtime/time/command/exit record |
| `docs/evidence/S01-source-version.json` | Source/reference document checksums for the initial local snapshot |
| `fixtures/s01-probes.json` | Synthetic, non-deliverable local probe inputs |
| `fixtures/README.md` | Reset/load policy; business F0 implementation deferred to S02 |
| `integration-inventory/inventory.csv` | Per-system discovery placeholders, known Jotform URLs and export/cutover fields |
| `integration-inventory/README.md` | Read-only discovery/export and future mapping requirements |
| `tests/outbound.test.cjs` | Guard and probe-wrapper safety tests with transport spies |
| `tests/test-register.csv` | Expected/actual/component/integration/release/evidence/status tracking |
| `tests/defects.csv` | Defect/reproduction/ownership/fix/retest log template |
| `tests/README.md` | Execution, evidence and acceptance conventions |

Company hosting/ownership is not established by this local folder or local Git metadata. Ben must provide the organisation and company access; no personal remote, identity, fake production IDs or release tag is configured. A company initial commit/tag remains a gate blocker. No production/live systems were changed. Advance only after the real S01 gate passes; never start S02 automatically.
