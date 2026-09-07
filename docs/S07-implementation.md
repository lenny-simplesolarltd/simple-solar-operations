# S07 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (15 tests); DEV CLOUD NOT YET RUN.** Material requirements evaluation and order creation implemented against the canonical 60-table schema. No real merchant communication.

## Authoritative tables

| Table | S07 role |
|---|---|
| `Materials` | Material requirements per job — `product_id`, `required_quantity`, `merchant_id`, `source` (ToOrder/AlreadyOrdered/Stock), `need_by_date` |
| `Orders` | Merchant purchase orders — `job_id`, `merchant_id`, `status` (Draft→Requested→Confirmed), `revision` |
| `OrderLines` | Line items — `order_id`, `material_id`, `product_id`, `quantity`, `unit` |
| `Products` | Product catalogue — `sku`, `name`, `unit`, `default_supplier_id` |
| `Companies` | Merchants — Greentech (roofing), CEF (electrical) |
| `TaskTemplates` | MAT01 (Place material order), MAT05 (Friday merchant lists) |
| `StockLocations` | Delivery locations |

## ReleaseMode

**FN-03** ("Orders and merchant messages"), target R2, currently Disabled.

## Architecture

### Material requirements (`s07/ordering.js`)
- `evaluateMaterialRequirements(jobId, store)` — checks all Materials for a job
- Validates: product_id/description, quantity, merchant, need_by_date
- Reports: `ready`, `blocked`, `needs_review`, per-material issues
- Already-ordered materials marked as not ready (prevents re-ordering)

### Order creation
- `createOrderForJob(jobId, store)` — groups materials by merchant, creates Orders + OrderLines
- Deterministic order ID: `ORD-{jobId}-{merchantId}`
- Idempotent: existing orders reused, not duplicated
- Updates Materials to `source: AlreadyOrdered` after ordering

### Task creation
- `createOrderingTasks(jobId, store)` — MAT01 when Draft orders exist
- Idempotent via `instance_key: MAT01-{jobId}-ROOT-nodue`
- Owner: Tanya (Office)

## Tests (15, all passing)

| # | Test | Result |
|---|---|---|
| 1 | Ready order creates orders and tasks | PASS |
| 2 | Missing merchant fails closed | PASS |
| 3 | Missing product fails closed | PASS |
| 4 | Replay creates no duplicate orders | PASS |
| 5 | Orders use internal Jobs.id | PASS |
| 6 | Task owner is Tanya (Office) | PASS |
| 7 | Revision does not silently overwrite | PASS |
| 8 | Deterministic order idempotency key | PASS |
| 9 | Order lines link to correct order | PASS |
| 10 | Materials updated to AlreadyOrdered | PASS |
| 11 | No duplicate tasks on replay | PASS |
| 12 | Unrelated rows untouched | PASS |
| 13 | Empty job → needs review | PASS |
| 14 | Not-ready → refused | PASS |
| 15 | S07Ordering.js VM smoke test | PASS |

## Cloud smoke test

`apps-script/s07/S07Ordering.js` — single file, 5 zero-arg functions:
- `runS07FixtureDryRun()` / `runS07FixtureApply()` / `runS07FixtureValidate()`
- `runS07HappyPathTest()` — creates synthetic job + materials, evaluates + creates orders
- `restoreS07SafeState()` — restores FN-03 to Disabled
