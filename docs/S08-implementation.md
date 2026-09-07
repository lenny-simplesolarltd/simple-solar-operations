# S08 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (11 tests); DEV CLOUD NOT YET RUN.** Stock availability calculation, picking, reservations, and stock movements via the canonical StockMovements ledger.

## Authoritative tables

| Table | S08 role |
|---|---|
| `StockMovements` | Immutable stock movement ledger — `product_id`, `quantity`, `from_location_id`, `to_location_id`, `movement_type` (Issue), `idempotency_key` |
| `Reservations` | Stock reservations for picking — `material_id`, `product_id`, `location_id`, `status` (Active/Issued), `picked_quantity` |
| `StockLocations` | LOC-store (Main Store), LOC-jobsite (Job Site) |
| `Materials` | Material requirements — `source: Stock` for stock-pick items |
| `Products` | Product catalogue |

## ReleaseMode

**FN-05** ("Panel stock balances/movements"), target R2, currently Disabled.

## Architecture

### Stock availability (`s08/picking.js`)
- `calculateStockAvailable(productId, locationId, store)` — computes balance from StockMovements ledger
- Receipts add to balance, Issues/Installs subtract
- No hidden mutable counters

### Pick evaluation
- `evaluatePickRequirements(jobId, store)` — for each `source: Stock` Material, checks availability
- Reports: `ready`, `blocked`, per-item `available`, `already_picked`, `remaining`
- Insufficient stock → blocked, no partial deduction

### Pick execution
- `executePick(jobId, store)` — creates Reservation (Active → Issued), StockMovement (Issue type), updates Material
- Deterministic movement key: `MOV-{materialId}-v1`
- Deterministic reservation ID: `RES-{materialId}`
- Idempotent: existing movements/reservations reused
- Movement type: `Issue` from LOC-store to LOC-jobsite

### Task creation
- `createPickTasks(jobId, store)` — `S08-PICK-STOCK` task, owner Tanya
- Idempotent via `instance_key: S08-PICK-{jobId}`

## Tests (11, all passing)

| # | Test | Result |
|---|---|---|
| 1 | Stock availability calculation | PASS |
| 2 | Available pick succeeds | PASS |
| 3 | Insufficient stock refused | PASS |
| 4 | Replay no double deduct | PASS |
| 5 | Internal Jobs.id linkage | PASS |
| 6 | Deterministic movement key | PASS |
| 7 | Task created once | PASS |
| 8 | Unrelated rows untouched | PASS |
| 9 | Empty job → no stock materials | PASS |
| 10 | Not-ready → refused | PASS |
| 11 | S08Picking.js VM smoke test | PASS |

## Cloud smoke test

`apps-script/s08/S08Picking.js` — single file, 6 zero-arg functions:
- `runS08FixtureDryRun()` / `runS08FixtureApply()` / `runS08FixtureValidate()`
- `runS08EnableFn05ForSyntheticTest()` — enables FN-05 Disabled/None/R2 → Automated/Pilot/R2
- `runS08HappyPathTest()` — creates stock-seeded material, picks 5 panels
- `restoreS08SafeState()` — restores FN-05 to Disabled/None/R2
