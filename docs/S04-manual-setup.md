# S04 manual cloud/AppSheet setup

Local implementation is complete and tested; **nothing here has been deployed or run in cloud**. These are later manual steps, not cloud actions performed by this task. Do not run S02 Apply, replace its files, recreate tabs, change PROD or activate other functions. S01 remains PARTIAL and G01/G04 are not passed.

## 1. Establish the one remaining transport prerequisite

Select a company-controlled trusted issuer/bridge that authenticates the initiating individual Google user server-side. It must obtain email from verified authentication, never from an AppSheet row, URL email argument or shared office login. It must issue a proof for the exact validated request and convey that proof to the S04 function over an authenticated service route. Keep the signing secret only in the issuer and S04 Script Properties; never in AppSheet tables, formulas, URL parameters, browser JavaScript or logs.

The verifier is implemented. The cloud issuer/bridge and its actual originating-user attribution are not available in this repository. This is the manual cloud transport blocker explicitly allowed by the implementation request. Do not configure a raw button-to-script call with actor_email as a substitute. No “enable authentication bypass” switch exists.

Native AppSheet Call a script supports standalone scripts, runs as app owner and executes the head version. It does not itself establish the initiating person's identity. [Google documentation](https://support.google.com/appsheet/answer/11997142?hl=en). If native automation is chosen, the issuer must independently bind its proof to the exact command, and the bridge needs a verified command-submission event/input surface; do not use authoritative Task status changes or client-writable CommitJournal rows as that trigger. An alternative is an external action opening the trusted issuer's command page. That page is responsible for authentication, request composition and calling the service route; it may use the delivered `s04/client-state.js` controller. The bridge URL is deliberately not invented.

## 2. Install the standalone DEV package later

1. Confirm company ownership, approved individual test users, AppSheet script-task entitlement and strictly DEV source access. Record the actual DEV AppSheet app ID and owner. Do not invite/send email from this task.
2. Create one separate company-controlled standalone DEV Apps Script project. Keep the existing S02 Sheet-bound project intact. Do not duplicate S04 writers against the same workbook.
3. Run `npm run build:s04` locally. Add exactly `S04Core.gs` and `S04Entry.gs` from `apps-script/s04/` to the new project. Use that directory's `appsscript.json`. No S01 probe, S02 provisioner or generic S03 orchestrator files are needed.
4. Review the new project's explicit Sheets OAuth scope. It is needed for standalone explicit Sheet access; no Mail/Calendar/external-request scope is requested. Do not broaden the old project's scopes.
5. Set **S04_CONFIG** in the new project's Script Properties, substituting its actual script ID:

```json
{
  "environment": "DEV",
  "projectId": "ACTUAL_NEW_STANDALONE_DEV_SCRIPT_ID",
  "sheetId": "1z7PNZtDdC4Z5eLbmTuQdqp0QpJSmuEvx3QvN3VyNTsc"
}
```

6. Once the issuer is verified, set **S04_IDENTITY_SECRET** to a securely generated shared secret with at least 32 characters (prefer 32 random bytes encoded as hex). Do not paste it into source control. Missing/short secret or missing proof returns TRUSTED_IDENTITY_REQUIRED before workbook access.
7. Record the exact reviewed source hashes/head version, issuer owner, script owner, sheet identity and scopes. Restrict script editors and direct Sheet writes. LockService.getScriptLock protects only executions of this one project. [Google LockService](https://developers.google.com/apps-script/reference/lock/lock-service).

## 3. Exact command and proof formats

The function is:

```javascript
runS04CompleteTaskCommand(commandJson, identityProofJson)
```

Both arguments are JSON strings. It returns an object, not a JSON string. Example synthetic request:

```json
{
  "command_id": "CMD-s04-example-001",
  "action": "COMPLETE_TASK",
  "task_id": "T-open",
  "expected_version": 1,
  "payload": { "completion_note": "Synthetic completion" }
}
```

command_id/task_id: 1–120 characters, first alphanumeric, remaining alphanumeric/underscore/hyphen. expected_version: positive safe integer. completion_note: required string, up to 2,000 characters (empty allowed). No other payload fields. Optional legacy payload_hash is ignored. No actor/role/person ID fields accepted. IDs are internal TEXT IDs, never Jobs.job_id labels.

Issuer algorithm (implemented verifier: `s04/identity.js`):

1. Validate/project the command with the `commandRequest` contract; exclude client payload_hash.
2. Compute lowercase hexadecimal SHA-256 of UTF-8 `canonical(request)` using the recursively sorted-key JSON algorithm exported by `s04/processor.js`.
3. Build these exact signed fields:

```text
version: "S04-IDENTITY-2"
purpose: "S04_COMPLETE_TASK"
subject: independently authenticated initiating Google user's email (must equal email)
jti: unique nonce, 16–120 alphanumeric/hyphen/underscore, starting alphanumeric
email: independently authenticated initiating Google user's email
audience: "S04:" + actualScriptId + ":" + DEVSheetId
issued_at: integer Unix milliseconds
expires_at: integer Unix milliseconds, greater than issued_at, at most 300000 ms later
request_hash: lowercase SHA-256 hex from step 2
```

4. Compute lowercase hexadecimal HMAC-SHA256 over canonical JSON of those nine fields (excluding signature), using S04_IDENTITY_SECRET. Add `signature` to the proof object and serialize it as identityProofJson. Do not include signature in the signed message. Future issued_at tolerance is 30 seconds; expired proofs deny.
5. The issuer must reauthenticate/reauthorise the initiating session before refreshing a proof. After an uncertain result, refresh the proof if needed but resend the **same command ID, version and note**. Never create a fresh command to bypass RecoveryRequired.

A signed proof is a short-lived bearer assertion: use authenticated transport, protect it from other users, and never put it in query strings or shared rows. The backend independently rechecks current directory roles, permissions, modes and job scope, including on replay.

## 4. Prepare only approved synthetic DEV fixtures later

`fixtures/s04-local.json` is a local test dataset, not an instruction to replace the workbook or import the whole file. It contains no real logins or customer data; `.example.invalid` addresses cannot sign in. In a separately authorised setup session:

- Use approved individual Google test logins, each linked to one active People row with active PersonRoles rows. Include office/admin success and inactive/no-role/installer denial identities. Do not invent real addresses from names. Preserve existing canonical required fields and internal FK references.
- Use reviewed PermissionRules for CompleteTask/Tasks with All or Assigned scope; an applicable false rule overrides an allow. Keep PermissionRules server-only and protected.
- Create a synthetic R1 pilot Job with source_system=`S04-synthetic`; create a synthetic Task with template_code=`S04-DEV-COMPLETE`, source_system=`S04-synthetic`, a valid internal job_id/owner_id, status=Open, version=1, revision_required=false and no blocking_reason/unsatisfied TaskDependencies. Populate all required canonical fields and referenced synthetic customer/company/template records as necessary; do not copy the fixture's generic placeholders into real relationships.
- Prepare non-pilot, missing-parent, already-complete and stale-version test cases only in isolated synthetic records. Do not delete existing business/configuration rows to reset tests.
- Only after explicit DEV pilot approval, set FN-01 to mode=Automated, authorised_job_scope=Pilot, target_release=R1 for this synthetic test. Record the approval/source/scope in its existing metadata. All other ReleaseModes remain Disabled. The S04 endpoint accepts only COMPLETE_TASK even though FN-01 covers broader office functions. Restore FN-01 to Disabled after the controlled test session.
- Ensure Tasks, TaskEvents, AuditEvents and CommitJournal have spare preallocated blank rows. The adapter refuses exhausted row capacity; it does not add rows/tabs. Empty gaps among populated rows or duplicate/missing IDs are refused. Protect authoritative rows and event history from ordinary app/manual edits.

## 5. Minimum AppSheet sources and Security Filters

Use Google sign-in and a named approved-user allowlist. All connected tables below are **READ_ONLY**; id is the immutable Key, version is Number, active/pilot_job/revision_required are Yes/No, timestamps DateTime. Use human titles/display names as Labels. Avoid automatic dereference labels that would silently add unfiltered customer/finance tables.

Connect only People, PersonRoles, Jobs and Tasks for this office sample. People/PersonRoles contain only the current user's security context through filters. PermissionRules, ReleaseModes, TaskDependencies, TaskEvents, AuditEvents and CommitJournal are backend-only for the minimum app. The backend reads ten tables and writes four; do not expose journal changes_json or audit before/after images to app users.

Actual Security Filter expressions (use exact existing column names):

**People** — own active record only:

```text
AND([active] = TRUE, LOWER([email]) = LOWER(USEREMAIL()))
```

**PersonRoles** — own active roles only (person_id Ref to People):

```text
AND(
  [active] = TRUE,
  IN([person_id], SELECT(People[id], AND([active] = TRUE, LOWER([email]) = LOWER(USEREMAIL()))))
)
```

**Jobs** — office/admin synthetic pilot scope:

```text
AND(
  [pilot_job] = TRUE,
  [release_scope] = "R1",
  [source_system] = "S04-synthetic",
  COUNT(SELECT(PersonRoles[id], AND(
    [active] = TRUE,
    IN([role], LIST("Office", "Admin")),
    IN([person_id], SELECT(People[id], AND([active] = TRUE, LOWER([email]) = LOWER(USEREMAIL()))))
  ))) > 0
)
```

**Tasks** — same permitted Job set, sample template only (job_id Ref to Jobs):

```text
AND(
  [source_system] = "S04-synthetic",
  [template_code] = "S04-DEV-COMPLETE",
  IN([job_id], SELECT(Jobs[id], AND(
    [pilot_job] = TRUE,
    [release_scope] = "R1",
    [source_system] = "S04-synthetic"
  ))),
  COUNT(SELECT(PersonRoles[id], AND(
    [active] = TRUE,
    IN([role], LIST("Office", "Admin")),
    IN([person_id], SELECT(People[id], AND([active] = TRUE, LOWER([email]) = LOWER(USEREMAIL()))))
  ))) > 0
)
```

Unknown/inactive/no-role/installer users receive no Jobs/Tasks in this minimum **office-only** slice. Finance/private issues/files are not connected. Read visibility in this sample is office/admin; mutation still uses live PermissionRules independently. These filters do not implement the later assigned-installer/scaffolder app. Do not claim full G04 role/file coverage until its real tests are run. Security Filters must be configured for each table; slices only organise already-permitted rows. [Google security-filter guidance](https://support.google.com/appsheet/answer/10104977?hl=en).

Create **My Tasks** as a slice additionally matching owner_id or backup_id to the signed-in People.id. Create **Team Tasks** over the already-filtered Tasks set for office/admin. Show signed-in display_name/email. Keep completed rows visible in this small test app: **do not hide on Tasks.status alone**, because task writes precede the committed journal checkpoint. This conservatively prevents partial writes hiding unfinished commands. The trusted command page/controller can remove a task from its own active list only after a matching Committed response.

## 6. Complete action and Pending/Committed/Failed UI

After the trusted issuer's URL and transport are available, add a Tasks action of type **External: go to a website** opening its authenticated command page. The target uses the actual reviewed issuer base URL plus URL-encoded internal task ID and expected version; no email, role, proof or secret in the link. For a bridge accepting `task_id` and `expected_version`, the target expression is:

```text
CONCATENATE(
  "REPLACE_WITH_VERIFIED_ISSUER_HTTPS_URL?task_id=", ENCODEURL([id]),
  "&expected_version=", ENCODEURL(TEXT([version]))
)
```

The issuer treats both query values as untrusted command input and independently authenticates the current Google user. Its command page collects completion_note, creates a stable command_id once, and calls the reviewed service route into runS04CompleteTaskCommand. Do not expose this placeholder action until the issuer is available. Native bot wiring is an alternative only after its secure command-event and proof provenance are demonstrated; no writable command table is shipped or required by the backend.

Button visibility may additionally check Open/InProgress/Waiting and no blocking_reason/revision_required; it is only convenience. Backend checks remain authoritative. The delivered `createCompletionController({storage, send, commandId})` in `s04/client-state.js` implements the bridge UI state contract:

- `complete(taskId, expectedVersion, note)` saves the request, sets Pending and blocks repeat clicks.
- `send(request)` is the injected authenticated transport; the proof is obtained by the trusted server, not by the controller.
- Matching Committed response shows success; `canHideTask()` becomes true. A status label without matching command/task/version/commit ID is not accepted as success.
- Failed shows the precise denial/review reason and keeps the row visible. Do not automatically resubmit with a new command ID. For a stale version, reload and let the user deliberately create a new command only after reviewing current state.
- Network failure or Pending preserves the exact saved command for `retry()` after reconnect/restart. Store per signed-in user and task (e.g. protected session-scoped client storage); clear/switch storage on logout/account change. Do not store signing secrets or proofs. RecoveryRequired needs manual investigation, not repeated automated retries.

A user-facing example return is `{"status":"Committed","accepted":true,"committed":true,"command_id":"...","task_id":"...","version":2,"commit_id":"...","task_event_id":"...","audit_event_id":"..."}`. Denials/uncertain outcomes contain status, committed=false and error. Failures need not contain request IDs; the controller retains its own exact request.

## 7. Collect actual G04 evidence later

Use approved office/admin, unknown/inactive/no-role and installer sessions. Capture successful task completion and exactly one TaskEvent/AuditEvent sharing commit ID and initiating People.id; duplicate replay; changed payload with same command ID; stale/concurrent versions; Disabled mode; out-of-pilot/missing job; spoofed actor/proof rejection. Verify all state changes in the DEV workbook and no outbound actions. Test Mac/phone, direct row URLs, user switches and protected file access independently. Do not infer file security from hidden menus. Full assigned-installer/scaffolder child/file cases remain G04 acceptance work; local tests are not substitutes.

Do not label S04/G04 cloud accepted until the trusted transport and actual user/action/denial traces are captured. No PROD or R1 release approval follows from local PASS.
