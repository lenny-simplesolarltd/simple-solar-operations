# S05 intake implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (24 tests); DEV CLOUD NOT YET RUN.** Sold and Booking intake processing implemented against the existing canonical 60-table schema. No Jotform webhooks activated. No PROD access.

## Authoritative tables used

| Table | Purpose |
|---|---|
| `Intake` | Raw Jotform/Zapier submission records; 16 columns including `raw_payload_json`, `payload_hash`, `processing_status` |
| `Jobs` | Core job record; 60 columns including `sold_submission_id` and `booking_submission_id` FK to Intake |
| `Customers` | Customer contact/address; 18 columns |
| `CustomerChanges` | Audit trail for intake-driven customer detail changes; 13 columns |
| `MappingRules` | Jotform question-to-field mapping; 19 columns including `question_id`, `target_table`, `target_field`, `transform` |

No new tables required — the S02 schema already covers all S05 domains.

## ReleaseMode

**FN-01** ("Office core/intake/tasks/planners/calls/issues") governs S05 intake. Currently Disabled in DEV. Must be explicitly enabled for cloud testing. Same mode as S04; activation scope notes specify "Split per actual function/producer/job-package scope at activation."

## Architecture

### Mapping layer (`s05/mapping.js`)
- `buildSyntheticMapping(formId, formType)` — generates DEV MappingRules rows with synthetic question IDs
- `applyMappings(payload, rules, formId)` — extracts and transforms fields using active mapping rules
- `resolveBookingJob(store, mappedFields)` — resolves a Job by human `job_id` (SS-XXXX-XXXX) for booking intake
- Supports transforms: `trim`, `lowercase`, `uppercase`, `integer`, `boolean`, `map:{...}`
- Missing required fields (`required_when: 'always'`) cause `NeedsReview`

### Intake processor (`s05/intake.js`)
- `processSoldIntake(options, input)` — creates Customer + Job + Intake record
- `processBookingIntake(options, input)` — matches existing Job, updates booking fields
- Idempotency via `Intake.intake_id` + canonical `payload_hash` comparison
- Same intake_id + different payload → `Review`/`CONFLICTING_INTAKE`
- Same intake_id + same payload → idempotent replay of original result
- DEV-only guard; wrong environment/sheet → fail closed
- Raw payload preserved in `raw_payload_json` for later mapping/debugging

### Job ID conventions
- Internal immutable `Jobs.id` used for all FK references (Intake, Tasks, etc.)
- Human-visible `job_id` generated as `SS-XXXX-XXXX` (existing convention)
- Booking matches by human `job_id` (the SS-XXXX-XXXX reference visible in the booking form)

### Synthetic DEV mappings
- Sold form (`260185763834060`): 16 mappings (customer fields + job fields)
- Booking form (`250293237424050`): 5 mappings (job matching + customer updates)
- All question IDs are synthetic (`sold_first_name`, `booking_sold_ref`, etc.)
- Real Jotform question IDs are NOT_CONFIGURED — populated later without code changes

## Delivered code

| File | Purpose |
|---|---|
| `s05/mapping.js` | Mapping layer (150 lines) |
| `s05/intake.js` | Core intake processor (301 lines) |
| `s05/fixture.js` | DEV test fixtures and runners (430 lines) |
| `apps-script/s05/S05Intake.js` | Apps Script entry points (235 lines) |
| `tests/s05.test.cjs` | 24 local tests |

## Tests (24, all passing)

| # | Test | Result |
|---|---|---|
| 1 | Sold intake creates one job | PASS |
| 2 | Sold identical replay idempotent | PASS |
| 3 | Sold conflicting replay refused | PASS |
| 4 | Human job_id unique, internal id used relationally | PASS |
| 5 | Booking attaches to exact correct internal job | PASS |
| 6 | Booking identical replay idempotent | PASS |
| 7 | Booking conflicting replay refused | PASS |
| 8 | Booking with no safe match refused | PASS |
| 9 | Booking ambiguous match refused | PASS |
| 10 | Missing required field refused | PASS |
| 11 | Malformed input refused | PASS |
| 12 | No duplicate jobs on replay | PASS |
| 13 | Concurrent duplicate sold results in one job | PASS |
| 14 | Wrong environment refused | PASS |
| 15 | Wrong sheet refused | PASS |
| 16 | Unrelated existing rows untouched | PASS |
| 17 | validateIntake rejects missing fields | PASS |
| 18 | applyMappings extracts and transforms | PASS |
| 19 | applyMappings reports missing required | PASS |
| 20 | resolveBookingJob null for unknown job_id | PASS |
| 21 | generateJobId unique SS-XXXX-XXXX | PASS |
| 22 | intakeHash is deterministic | PASS |
| 23 | Sold then Booking links same job | PASS |
| 24 | Processor preserves raw intake payload | PASS |

## Remaining blockers

1. **Real Jotform question IDs** — not yet exported/verified. Synthetic IDs used in DEV mappings. Replace `sold_first_name` → actual Jotform field ID when available.
2. **FN-01 activation** — must be explicitly enabled (Automated/Pilot/R1) for cloud testing, then restored to Disabled.
3. **Cloud deployment** — Apps Script entry points (`apps-script/s05/S05Intake.js`) ready to paste into the DEV bound project.
4. **No Jotform webhook** — intake processing is callable but no webhook endpoint is configured yet.
