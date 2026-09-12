# Materials workflow — 12 September 2026

**LOCAL IMPLEMENTATION PASS (16 tests); DEV CLOUD NOT YET RUN.** Closes backlog items: materials requirements workflow, merchant order workflow, received/store workflow, ordering evidence. FN-03 "Orders and merchant messages" gates requirements, orders and lists; FN-05 "Panel stock" additionally gates receipts (both R2). Merchant messages are captured as `Communications` drafts and never sent (`sent_message_id` stays null). No external calls. Existing S07/S08 modules are untouched and use distinct ids.

## Authority applied

- 01 §4 Materials/Orders/OrderLines/Deliveries/ReceiptLines/StockMovements/Communications/Acknowledgements; Orders status Draft/Review/Requested/Confirmed/PartReceived/Received/Cancelled; work_type Roof/Electrical/Other.
- 01 task templates MAT01–MAT06 (MAT02, MAT03, MAT04, MAT06 added to `schema/config-seed.json` exactly as specified; embedded seed regenerated).
- 04 S07/S08: separate roofing and electrical order batches; delivery on the merchant's delivery weekday (Thursday) in the week before the package's work week; lead-time risk flag; an AlreadyOrdered line creates verification, not a second order; immutable sent snapshots with supplier reference and requested/confirmed/received states; Friday expected-delivery lists grouped by merchant with an acknowledgement task against the sent revision; urgent revision when dates change after a list; good receipts to usable store stock, damaged to quarantine, movements linked to delivery notes and receipt lines, replay must not add them again; short or damaged goods create a separate action.
- Spec worked example verified in tests: roof 4 Nov → delivery 29 Oct → list 23 Oct; electrical 16 Nov → delivery 12 Nov → list 6 Nov; a change on 28 Oct is an urgent revision with an open confirmation task.

## Flow

| Command | Effect | Tasks | Communication |
|---|---|---|---|
| `_matAddRequirement` | Material line (product or Other with description+unit); merchant defaults from product supplier; need-by defaults from the work package via the delivery-date rule; lead-time risk computed | AlreadyOrdered → MAT02 (Tanya, same staffed day end); Stock → MAT03 (Store owner, day before need-by) | |
| `_matBuildOrders` | One Draft order per merchant + work type (`ORD-<job>-<merchant>-<type>`), lines `OL-…`, material ↔ line linkage; later lines append to a Draft and pull the delivery date earlier | MAT01 due at latest order date (need-by − lead days, previous staffed day), flagged when at risk | |
| `_matSendOrder` | Draft/Review → Requested | MAT01 complete; MAT06 next staffed day (urgent: same day end) | `MerchantOrder` rev N snapshot (Draft, immutable, includes customer postcode and lines) |
| `_matConfirmOrder` | Requested → Confirmed with supplier reference, `confirmed_revision`, confirmed delivery date | MAT06 complete; MAT04 for the Store owner at delivery day end | Acknowledgement row for the revision; `Deliveries` row `DEL-<order>-R<rev>` |
| `_matReviseOrder` | revision +1; sent orders return to Requested; line quantity/cancelled changes validated against receipts and mirrored to Materials; open delivery and MAT04 move with the date | MAT06 for the new revision, urgent inside lead time | `MerchantOrder` amended snapshot |
| `_matCancelOrder` | Draft → Cancelled silently; sent → Cancelled with notice; received goods refused; lines cancelled, materials released to ToOrder, expected deliveries cancelled | open order/delivery tasks cancelled; MAT06 ack for sent orders | `MerchantOrderCancellation` |
| `_matReceiveDelivery` | ReceiptLines `RL-<delivery>-<line>`; StockMovements `Receipt` supplier→store (good) and `Damage` supplier→quarantine (damaged) with idempotency keys `MOV-RCPT-<rl>-GOOD/DMG` for stock-tracked products; `quantity_short` and damaged raise `Issues` (type Supply, category ShortDelivery/DamagedGoods, responsible merchant); delivery note evidence row; order → PartReceived/Received; balance → follow-up delivery | MAT04 complete; MAT04 for the follow-up delivery | |
| `_matWeeklyList` | Friday list: next Monday–Sunday deliveries per merchant (Requested/Confirmed/PartReceived), customer/postcode/work type/date/supplier ref, unacknowledged flag | MAT05 Friday 12:00; MAT06 list acknowledgement next staffed day | `MerchantDeliveryList` (Draft) per merchant per week, idempotent |

All commands: DEV sheet/env guard, ReleaseMode gates, pilot R2 job not in cancellation, CommitJournal `CJ-MAT-<command_id>` idempotency with conflict detection (build-orders identity is job + command, not derived state), `expected_version` checks on Jobs/Orders, AuditEvents per mutation (`executing_service: MaterialsWorkflow`).

## Read models

- `_matRequirements(store, jobId)`: per material state (ToOrder/Drafted/AwaitingConfirmation/Confirmed/PartReceived/Received/VerifyExternalOrder/Stock), order linkage, received good/damaged, lead-time risk.
- `_matOrderView(store, orderId)`: order, merchant + contacts, lines with outstanding quantities, deliveries, communications, acknowledgements, tasks, supply issues, `acknowledgement_required`.
- `_matStoreQueue(store, {from, to})`: expected deliveries and open MAT03/MAT04 tasks for the store.

## Cloud entry points (`apps-script/materials/MaterialsWorkflow.js`)

| Function | Purpose |
|---|---|
| `runMatRequirements(jobId)`, `runMatOrderView(orderId)`, `runMatStoreQueue(from, to)` | Read-only |
| `runMatWeeklyList(listDate)` | Friday list (scheduler-safe, idempotent per merchant/week) |
| `runMatEnableFunctionsForSyntheticTest()` / `restoreMatSafeState()` | FN-03 + FN-05 toggle |
| `runMatHappyPathTest()` | Synthetic end-to-end on a fresh MAT-fixture job: requirements (panels, Other cable, AlreadyOrdered) → two orders → send → confirm → partial receipt with damage (quarantine + issue) → replay no-op → balance receipt → Received → Friday list; restores modes |

Build `npm run build:materials`; tests `npm run test:materials` (`tests/materials.test.cjs`, 16 incl. zero-arg header-adapter simulation).

## DEV cloud steps (pending — no browser/Apps Script access in this session)

1. Add TaskTemplates MAT02, MAT03, MAT04, MAT06 to the DEV sheet through the controlled seed path (or insert the four rows from `schema/config-seed.json`).
2. Paste `apps-script/materials/MaterialsWorkflow.js`.
3. `restoreMatSafeState()`, `runMatHappyPathTest()`, `restoreMatSafeState()`, then `runMatStoreQueue()`.
4. Optional Friday trigger `runMatWeeklyList()`.

## Not done

- Sending merchant orders/lists (mail adapter to test inboxes) — FN-03 stays captured; Automated send is a later approved adapter.
- Stock picking for Stock-source lines remains S08 (`executePick`); MAT03 tasks are created here for the store owner.
- Supplier returns/credits for damaged or short goods beyond the Issue record; stocktake (S08 follow-up).
- Panel Usage Friday report (separate reporting item).
- AppSheet surface for the materials commands (R2 UI) — backend ready.
