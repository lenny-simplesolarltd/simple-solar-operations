# S04 implementation — 6 September 2026

**S04 DEV CLOUD HAPPY PATH: PASS. G04 CORE DEV CLOUD CONTROL PACK: PASS (5/5). Full G04 not passed.** First end-to-end cloud transaction confirmed: T-open completed through the deployed bridge/backend. Five negative cloud tests subsequently executed and passed: disabled mode refusal, stale version refusal, duplicate command replay, command mismatch refusal, out-of-pilot refusal. 14 broader scenarios remain unexecuted in cloud. This implementation supersedes the pre-implementation findings in [S04-readiness.md](S04-readiness.md). [Current status](implementation-status.md) retains S01 PARTIAL/G01 BLOCKED, S02 COMPLETE IN DEV and S03 local-only. Evidence: [happy-path](evidence/S04-dev-cloud-happy-path.json), [negative tests](evidence/S04-dev-cloud-negative-tests.json).

## Delivered code

`s04/processor.js` is the authoritative S04-only processor. It reuses S03 `journal.js`, `tasks.completeTask` and `reconciler.checkApplicationStatus`; the generic S03 orchestrator is not a cloud entry point. The only change to the original S03 code is exporting its existing classification helper. No other command, outbox sender or trigger is part of this package.

`s04/identity.js` verifies short-lived HMAC-SHA256 proofs from a trusted issuer. The server-installed provider returns an authenticated email; active People and active PersonRoles determine the actor and roles. People.role is not a fallback when active PersonRoles are absent. Editable actor_email/user_email/role/person_id fields are rejected by the strict request schema. Audit and task attribution use the resolved People.id.

`s04/sheet-store.js` reads/writes the existing schema by enumerating sheets. It rejects missing/duplicate IDs, incompatible headers and malformed typed values. It writes only Tasks, TaskEvents, AuditEvents and CommitJournal; event updates are forbidden. Strings that could become formulas are escaped. Every write is flushed before the next checkpoint. Full JSON plans above 45,000 characters are refused; exhausted preallocated row capacity is reported through a failed/uncertain command, never auto-expanded or provisioned.

`s04/runtime.js` validates DEV, the exact known DEV Sheet and configured standalone script identity; verifies the signed proof before opening the workbook; obtains LockService.getScriptLock; then invokes the processor. No Session/app-owner email is treated as initiating identity. No external network service is called.

`s04/client-state.js` supplies the transport-neutral Pending/Committed/Failed controller. A durable client storage adapter retains the exact request across refresh/restart; repeated clicks are blocked, uncertain requests retry the same ID, and only a matching committed response permits hiding the task. It does not implement or pretend to provide user authentication. The AppSheet/issuer bridge remains a cloud prerequisite, documented in [manual setup](S04-manual-setup.md).

## Exact execution path

DEV/project/sheet guard → strict request parse → trusted actor proof → active People/PersonRoles → acquire script lock → recheck environment/identity/roles → re-read Task → persisted PermissionRules → exact FN-01 Automated/Pilot/R1 mode → persisted synthetic pilot Job → canonical request/actor hash and durable idempotency → unresolved-journal check → expected Task version and completion/dependency checks → durable Prepared plan → Applying → Task mutation → one TaskEvent → one AuditEvent → Committed journal with final result → release lock.

The idempotency lookup precedes stale-version/state rejection so a legitimate replay of a completed command can return the original result. Current permission/mode/pilot checks still apply before replay. A revoked actor or disabled function cannot use replay to retrieve results. Ordinary validation failures write nothing.

Only `COMPLETE_TASK` maps to persisted `PermissionRules.action=CompleteTask`, `entity=Tasks` (or explicit wildcard rules). Applicable denials win across roles. Supported scopes are All/Assigned; Assigned checks task owner/backup. Unsupported applicable rule scopes or non-boolean allowed values deny. Missing/Disabled/Manual/unknown modes deny. FN-01 must be exactly Automated with Pilot scope and target R1; All is deliberately rejected. Job.pilot_job must be true, release_scope R1. Both Job and Task must have source_system `S04-synthetic`; task.template_code must be `S04-DEV-COMPLETE`. This confines broad FN-01 to a synthetic sample action, without changing any seeded modes.

Completable states: Open, InProgress, Waiting. Blocked/Complete/Cancelled/NotRequired, non-empty blocking_reason, revision_required other than false and unsatisfied TaskDependencies deny. This sample template does not replace specialised calls, finance, safety or operational completion rules. Version must be a positive safe integer matching persisted Tasks.version; success increments once. Tasks.id/created metadata and unrelated fields are preserved.

## Durable command/result contract — no schema migration

One existing CommitJournal row per accepted command: id/commit_id=`S04-` + SHA256(command_id); command_id; entity_type=Tasks; entity_id; expected_version; state; prepared_at; committed_at; created_at. `changes_json` contains the versioned `S04-1` plan:

- Validated request and resolved actor identity; canonical request string and server SHA-256.
- Exact Task before/after images and planned TaskEvent/AuditEvent rows.
- Deterministic event IDs derived from commit_id.
- Intended result and final result (null until committed), plus recovery classification when applicable.

The final result and Committed state are saved in the same journal-row write. This is sufficient durable input/result storage after a command reaches the trusted boundary; there is no need for a new Commands table. AppSheet must never write this journal directly. Rejected unauthenticated/invalid/stale requests are not journalled because they must produce zero writes. Pending client drafts live in the transport/UI, not a business Intake row.

Same command ID, same canonical request and actor returns the exact saved result after restart. Changed command/task/version/note/actor with the same ID rejects even if the caller supplies the same payload_hash. Client payload_hash is ignored. Canonical JSON recursively sorts object keys; note contents are preserved exactly. SHA-256 and HMAC use UTF-8.

## Failure and recovery behavior

A write/flush exception after beginning persistence returns Pending with `INTERRUPTED_RETRY_SAME_COMMAND`; it must not be presented as proof that no write happened. On authenticated retry under the same lock:

| Observed persistent state | Action |
|---|---|
| No journal row exists | Validate again and prepare the command normally. |
| Committed with saved result | Replay without writes. |
| NOT_APPLIED: exact original task and neither event exists | Recheck gates/version/dependencies, reuse the same journal/write plan and event IDs, then complete. |
| FULLY_APPLIED: exact planned task and both exact planned events | Finalise the journal/result; never write a second event or increment again. |
| PARTIALLY_APPLIED or conflicting task/event content | Persist RecoveryRequired; refuse automatic retry and new commands on that task. Manual investigation required. |
| Already RecoveryRequired / incompatible journal | Refuse automatic execution. |

Unresolved different commands on the same task are blocked. Orphan deterministic event IDs prevent a fresh mutation. Recovery verifies all three affected records, strengthening the original S03 single-record classification. It never silently repairs or overwrites ambiguous rows. There is no automated recovery worker. If a process is terminated before returning, durable Prepared/Applying plus the exact plan still make interruption detectable on retry.

One standalone S04 project must be the only operational writer. ScriptLock serialises calls within that project, not human spreadsheet edits or another project. Protect authoritative rows and do not deploy a second S04 writer. Storage is not an atomic multi-table transaction; checkpoint tests explicitly cover that limitation.

## Packaging and verification

`npm run build:s04` generates `apps-script/s04/S04Core.gs` from scoped S03/S04 modules and the existing canonical schema subset. `S04Entry.gs` exposes `runS04CompleteTaskCommand(commandJson, identityProofJson)`. The separate manifest requests only Sheets scope; it does not alter the S01/S02 manifest. No require/module runtime dependency remains. The local file store and client state controller are excluded from the server package.

`npm run test:s04` verifies the S04 components, signed provider, durable filesystem restart, lock races, schema-bound sheet writes, packaged runtime/entry point, all six write-checkpoint interruptions, source drift/parity and client state. `npm test` also retains all existing S01/S02/S03 tests. See the recorded [local verification](evidence/S04-local-run.json).

## Cloud deployment and first transaction

The S04 bridge (`apps-script/s04-bridge/`) and backend (`apps-script/s04/`) were deployed as separate Apps Script projects on 6 September 2026. The bridge runs as `USER_ACCESSING`, authenticates the Google user via `Session.getActiveUser()`, signs an HMAC-SHA256 proof bound to the exact command, and POSTs to the backend. The backend runs as `USER_DEPLOYING`, verifies the proof, and processes the command against the DEV sheet. No editable `actor_email` or app-owner identity is trusted.

The S04 fixture tooling (`apps-script/S04Fixture.js` + `apps-script/S04FixtureCore.gs`) was pasted into the DEV bound project. `runS04FixtureDryRun` → `runS04FixtureApply` → `runS04FixtureValidate` confirmed the fixture was ready. FN-01 was explicitly enabled for the test duration only (`runS04EnableFn01ForSyntheticTest`), then restored to Disabled (`runS04DisableFn01AfterSyntheticTest`).

The first end-to-end cloud transaction was confirmed:
- Command `CMD-1d463de2-264d-44cd-b78f-70aa14f0ed8a` completed task `T-open`
- One TaskEvent (COMPLETED), one AuditEvent (COMPLETE_TASK), one CommitJournal (Committed) — all sharing commit_id `S04-e0e910ac...`
- Initiating actor correctly resolved to `PERSON-tanya`
- Bridge UI displayed "Committed. Task completed."
- [Full evidence](evidence/S04-dev-cloud-happy-path.json)

## G04 negative cloud tests

The G04 negative-test tooling (`apps-script/s04/G04NegativeTests.js` + `apps-script/s04/G04NegativeCore.gs`) was pasted into the backend project. Five tests were executed against the DEV cloud sheet on 6 September 2026:

| Test | Task | Result | Events | Journal |
|---|---|---|---|---|
| Disabled mode | T-g04-disabled | MODE_DENIED | 0/0 | 0 |
| Stale version | T-g04-stale | STALE_VERSION | 0/0 | 0 |
| Duplicate replay | T-g04-replay | Committed (1st) / Committed replay (2nd) | 1/1 | 1 |
| Command mismatch | T-g04-mismatch | Committed (1st) / COMMAND_ID_CONFLICT (2nd) | 1/1 | 1 |
| Out-of-pilot | T-g04-outside | OUTSIDE_PILOT | 0/0 | 0 |

All five passed. FN-01 restored to Disabled after tests. [Full evidence](evidence/S04-dev-cloud-negative-tests.json).

**Remaining unexecuted cloud scenarios (14):** inactive actor denial, no-role denial, installer role denial, forged/spoofed proof rejection, expired proof rejection, proof reuse across commands, concurrent submissions, write-interruption recovery (6 checkpoints), row capacity exhaustion, Mac/phone client devices, protected file access, AppSheet Security Filter verification, user-switch behaviour, bridge UI error paths.
