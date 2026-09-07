# S13 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (12 tests); DEV CLOUD NOT YET RUN.** Payment stages, deposit confirmation, Xero intents, interim chase, GHL progression via canonical InvoiceStages, Payments, GHLTasks, Outbox tables. No real Xero/GHL API calls.

## Authoritative tables

| Table | S13 role |
|---|---|
| `InvoiceStages` | Payment stages — `stage` (deposit/interim/final), `gross_pence`, `due_date`, `status`, `xero_invoice_id` |
| `Payments` | Payment records — `invoice_stage_id`, `amount_pence`, `payment_date`, `status` |
| `GHLTasks` | GHL progression — `job_id`, `task_id`, `opportunity_id`, `readiness_snapshot` |
| `Outbox` | Xero intents — `action_type: XeroInvoice`, `response_summary: CAPTURE_ONLY` |
| `Tasks` | Chase/GHL tasks — `instance_key` dedup |
| `Jobs` | `deposit_bank_confirmed_at/by/reference`, `original_gross_pence`, `next_action_at` |

## ReleaseModes

| FN | Function | Target | Pilot mode |
|---|---|---|---|
| FN-09 | Invoices and payment reconciliation | R4 | Automated/Pilot/R4 |
| FN-11 | GHL progression/messages | R1 | Manual/Pilot/R1 |
| FN-15 | Bank deposit confirmation | R1 | Manual/Pilot/R1 |

## Payment rules

| Stage | Pct | Due | Notes |
|---|---|---|---|
| Deposit | 25% | — | Ben confirms; updates `deposit_bank_confirmed_at` |
| Interim | 35% | Friday before install | Unpaid → Tanya chase task; does NOT block install |
| Final | 40% | Operational milestone | Gated: requires `operational_complete_at` on Jobs record (all packages confirmed, commissioning accepted, customer happy, no blocking issues). FIN03 template trigger: "Operational approval". Due: same staffed day. |

All amounts in integer pence. VAT at 20% (gross/1.2).

## Architecture

### Invoice stages (`s13/payments.js`)
- `buildInvoiceStages(jobId, grossPence, store)` — deterministic IDs: `IS-{jobId}-{stage}`
- `confirmDeposit(store, jobId, by, ref)` — updates stage + Job deposit fields
- Idempotent: already confirmed → no-op

### Xero intents
- `createXeroIntent(store, jobId, stage)` — Outbox row, `CAPTURE_ONLY: no Xero API call`
- One per stage, deterministic ID: `XI-{jobId}-{stage}`

### Tasks
- `createInterimChaseTask(store, jobId)` — S13-INTERIM-CHASE, owner Tanya
- `createGHLTask(store, jobId)` — S13-GHL-PROGRESSION + GHLTasks record
- Both idempotent via `instance_key`

## Tests (13, all passing)

| # | Test |
|---|---|
| 1 | Stage split 25/35 (Final gated) |
| 2 | Stage amounts are integer pence |
| 3 | Deposit confirmed by Ben |
| 4 | Deposit idempotent |
| 5 | Interim due Friday before install |
| 6 | Interim chase task created once |
| 7 | GHL task created once |
| 8 | Full payment processing (2 stages + Final blocked) |
| 9 | No real Xero calls |
| 10 | Unrelated rows untouched |
| 11 | Unpaid interim does NOT block install |
| 12 | Final gated by operational milestone |
| 13 | S13Payments.js VM smoke test |

## NOT_CONFIGURED

- Xero tenant/org ID, account codes, VAT/tax codes, invoice branding
- GHL pipeline/stage IDs, opportunity IDs
- Real customer/invoice references

## Cloud smoke test

`apps-script/s13/S13Payments.js` — single file, 7 zero-arg functions:
- `runS13FixtureDryRun()` / `runS13FixtureApply()` / `runS13FixtureValidate()`
- `runS13EnableFunctionsForSyntheticTest()` — FN-09 Automated, FN-11 Manual, FN-15 Manual (all Pilot)
- `runS13HappyPathTest()` — 3 stages, deposit confirmed, chase+GHL tasks, 3 Xero intents CAPTURE_ONLY
- `restoreS13SafeState()` — all three restored to Disabled/None
