# S15 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (18 tests); DEV CLOUD NOT YET RUN.** Job cancellation, downstream reconciliation, controlled reinstatement with durable CommitJournal/AuditEvents. No outbound dispatcher. No real Calendar/Xero/GHL/Jotform calls.

## Authoritative tables

| Table | S15 role |
|---|---|
| `Jobs` | Core cancellation fields: `cancellation_at`, `cancellation_by`, `cancellation_reason`, `workflow_stage` |
| `WorkPackages` | Future packages cancelled; performed work requires Review task |
| `Allocations` | Future allocations deactivated; installer notification tasks |
| `Tasks` | Open normal tasks cancelled; cancellation-specific tasks created from TaskTemplates |
| `Materials` | `cancelled_quantity` set; revision incremented |
| `Reservations` | Active unpicked released; picked/issued requires Review (no automatic stock reversal) |
| `Orders` | Draft cancelled; sent/received → Review requiring latest merchant acknowledgement |
| `OrderLines` | Preserved historically |
| `ScaffoldBookings` | Unerected cancelled; erected retains removal obligation (S15-CAN-STRIP task) |
| `StockMovements` | Immutable — never rolled back |
| `InvoiceStages` | Human review tasks only — no automatic cancellation, deletion, or credit notes |
| `Payments` | Immutable — never rolled back |
| `CommissioningSubmissions` | Immutable — late cancellation flagged as Review |
| `JobEquipment` | Immutable |
| `Handover` | Immutable |
| `CalendarLinks` | Status → Error; outbox capture for manual external reconciliation |
| `Outbox` | Unsent actions cancelled; uncertain sends → NeedsReview |
| `Communications` | Draft/Approved/Queued → Failed |
| `GHLTasks` | Human GHL cancellation task only (NOT_CONFIGURED for real pipeline/stage IDs) |
| `CommitJournal` | Write-ahead commit journal with recovery |
| `AuditEvents` | Immutable audit log of every entity transition |
| `TaskTemplates` | 17 cancellation templates + S15-REOPEN-REVIEW |
| `ReleaseModes` | 14 functions governed; 3 enabled for Pilot (FN-01, FN-17, FN-20) |

## ReleaseModes

| FN | Function | Target | Pilot mode |
|---|---|---|---|
| FN-01 | Office core/intake/tasks/planners/calls/issues | R1 | Automated/Pilot/R1 |
| FN-02 | Calendar entries | R2 | Automated/Pilot/R2 |
| FN-03 | Orders and merchant messages | R2 | Automated/Pilot/R2 |
| FN-04 | Scaffold commitments | R2 | Automated/Pilot/R2 |
| FN-05 | Panel stock balances/movements | R2 | Automated/Pilot/R2 |
| FN-06 | Installer app/forms access | R3 | Automated/Pilot/R3 |
| FN-07 | Commissioning receipt/review | R3 | Automated/Pilot/R3 |
| FN-08 | Handover | R3 | Automated/Pilot/R3 |
| FN-09 | Invoices and payment reconciliation | R4 | Automated/Pilot/R4 |
| FN-10 | Phoenix evidence/upload/chase | R4 | Manual/Pilot/R4 |
| FN-11 | GHL progression/messages | R1 | Manual/Pilot/R1 |
| FN-12 | Accounting/reporting | R4 | Automated/Pilot/R4 |
| FN-17 | GHL cancellation | R1 | Manual/Pilot/R1 |
| FN-20 | Customer and installer notices | R1 | Manual/Pilot/R1 |

S15-enabled functions (must be Pilot mode): FN-01, FN-17, FN-20.

## Cancellation state machine

### Commands

| Command | Purpose | Precondition | Postcondition |
|---|---|---|---|
| `Cancel` | Initiate cancellation | workflow_stage not Cancelled/CancellationInProgress | CancellationInProgress |
| `Resolve` | Resolve a single cancellation review task | Open cancellation task with evidence | Task → Complete; related entity updated if confirmation required |
| `Close` | Finalise cancellation | All review tasks tracked (no outstanding confirmations for Merchant/Scaffold/Strip/Calendar) | Cancelled |
| `Reinstate` | Reopen a cancelled job | workflow_stage = Cancelled; risk/finance/commitment reviews | Prebooking; fresh WorkPackages; cancellation history preserved |

### Workflow stages

```
Prebooking → ReadyToBook → BookingInProgress → Booked → AwaitingInstallation → InProgress → Aftercare → OperationallyComplete
                                     ↑                                                                              |
                                     └── CancellationInProgress ──→ Cancelled ──→ (Reinstate) ──→ Prebooking ─────────┘
```

### Cancellation tasks (TaskTemplates)

| Template code | Title | Blocking |
|---|---|---|
| `S15-CAN-CUSTOMER` | Notify customer using reviewed cancellation message | No |
| `S15-CAN-INSTALLER` | Notify installer and cancel future commitment | No |
| `S15-CAN-MERCHANT` | Merchant confirmed latest cancellation and goods disposition | Review (blocking) |
| `S15-CAN-SCAFFOLD` | Scaffolder acknowledged cancellation | Review (blocking) |
| `S15-CAN-STRIP` | Arrange safe strip and confirm actual removal | Review (blocking) |
| `S15-CAN-CALENDAR` | Reconcile Calendar removal using retained event ID | Review (blocking) |
| `S15-CAN-STOCK` | Review goods: receive, hold, return or reallocate | Review |
| `S15-CAN-XERO` | Review/cancel Xero invoice | NOT_CONFIGURED |
| `S15-CAN-FINANCE` | Review finance obligations and existing payment route | No |
| `S15-CAN-SIGNABLE` | Cancel/amend Signable contract with evidence | No |
| `S15-CAN-PHOENIX` | Review Phoenix agreement and evidence obligations | NOT_CONFIGURED |
| `S15-CAN-GHL` | Record human GHL cancellation stage action | NOT_CONFIGURED |
| `S15-CAN-SALES` | Notify salesperson of cancellation | No |
| `S15-CAN-LEGACY` | Close retained paper, Trello and whiteboard records | No |
| `S15-CAN-REVIEW` | Review partial work, retained evidence and unresolved obligations | Review |
| `S15-REOPEN-REVIEW` | Review fresh planning and invoice/order reuse before booking | No |

### Downstream entity behaviour on cancellation

| Entity | Clean pre-install | Partial work | Already complete |
|---|---|---|---|
| WorkPackages | Unscheduled/Scheduled → Cancelled | Review task created | Preserved |
| Allocations | Future → active=false | Deactivated + installer task | Preserved |
| Tasks (normal) | Open/Waiting/InProgress/Blocked → Cancelled | Open → Cancelled | Complete → preserved |
| Materials | cancelled_quantity set | cancelled_quantity set | Preserved |
| Reservations | Active unpicked → Released | Picked/Issued → Review task | Preserved |
| Orders (Draft) | → Cancelled | → Cancelled | Preserved |
| Orders (Sent) | → Review + merchant task | → Review + merchant task | Preserved |
| ScaffoldBookings | Unerected → Review task | Erected → strip task | Preserved |
| InvoiceStages | Review task only | Review task only | Preserved |
| Payments | Preserved | Preserved | Preserved |
| Commissioning | Preserved | Preserved | Late cancellation flagged |
| CalendarLinks | Error + outbox capture | Error + outbox capture | Preserved |
| StockMovements | Immutable | Immutable | Immutable |

### Reinstatement behaviour

- Only a Cancelled job can be reinstated
- workflow_stage → Prebooking
- cancellation_at, cancellation_by, cancellation_reason cleared
- Fresh WorkPackages created (old cancelled packages preserved as history)
- Old Allocations NOT reactivated
- Fresh planning task (S15-REOPEN-REVIEW) created
- Old external references (Calendar, Xero, GHL) NOT reused
- Invoices/payments NOT duplicated
- Historical cancellation preserved in AuditEvents
- Requires: risk_review, commitment_review, finance_review, evidence_reference, new_date after cancellation

### Safety properties

- Cancellation is NOT deletion — no records are physically removed
- StockMovements are immutable (no automatic stock reversal)
- Financial records are immutable (no automatic refunds/credit notes)
- External API calls are never made (Calendar/Xero/GHL/Jotform)
- Reinstatement creates fresh state; never mutates cancelled history
- Idempotent: identical cancellation/reinstatement replays are no-ops
- Conflicting replays fail closed (different reason/payload = refused)
- Late/high-risk cancellation routes to Review (not silently reversed)
- S06–S13 normal work suppressed during cancellation/reopen review

## NOT_CONFIGURED

| Area | Reason |
|---|---|
| Xero invoice cancellation/credit notes | No accounting policy defined |
| GHL pipeline/stage IDs | No CRM stage IDs configured |
| Phoenix agreement policy | No evidence/agreement policy defined |
| Calendar external mutation | No Calendar API in scope |
| Scaffolder cancellation contacts | No external contacts configured |
| Supplier cancellation API | No supplier APIs defined |
| Refund policy | No refund policy configured |
| Cancellation fees/notice periods | No policy defined |

## Architecture

### Source files

| File | Purpose | Lines |
|---|---|---|
| `s15/cancellation.js` | Core cancellation/reinstatement engine | 240 |
| `s15/fixture.js` | Minimal synthetic fixture and smoke runner | 50 |
| `s15/cloud-adapter.js` | Cloud sheet enumeration adapter | 32 |

### Built bundle

`apps-script/s15/S15Cancellation.js` — single concatenated file with:
- `S15_HEADERS` — embedded column headers for 29 tables
- All three source files concatenated (module exports stripped)
- 6 zero-arg cloud smoke functions

### Cloud smoke functions

| Function | Purpose |
|---|---|
| `restoreS15SafeState()` | Disable S15 functions (FN-01, FN-17, FN-20 → Disabled/None) |
| `runS15FixtureDryRun()` | Read-only preflight — validate headers, modes, existing job |
| `runS15FixtureApply()` | Seed synthetic fixture (Job, WorkPackage, Allocation, Task, People, TaskTemplates) |
| `runS15FixtureValidate()` | Verify fixture rows exist with correct created_by |
| `runS15EnableFunctionsForSyntheticTest()` | Enable FN-01, FN-17, FN-20 → Pilot mode |
| `runS15HappyPathTest()` | Full smoke: Cancel → Close → Reinstate, verify all state transitions |

## Tests (18, all passing)

| # | Test |
|---|---|
| 1 | Valid cancellation preview read-only; removes future demand, preserves internal Job ID |
| 2 | Reason, effective date, impact fields, actor and optimistic revision fail closed |
| 3 | Identical replay is no-op; conflicting replay and second cancellation refused |
| 4 | Completed tasks, complaints, remedials and performed work remain attributed |
| 5 | Material demand/reservations released without physical stock rollback |
| 6 | Sent/received orders require latest acknowledgement; draft history retained |
| 7 | Erected scaffold retains removal obligation and complaints |
| 8 | Calendar IDs retained, unsent actions suppressed, uncertain sends not declared cancelled |
| 9 | Paid invoice, final invoice, commissioning and handover stay immutable; late cancellation needs review |
| 10 | Closure requires explicit owned tracking; reinstatement creates fresh revision, retains cancellation audit |
| 11 | Interrupted writes recover every operation once and block interleaving commands |
| 12 | Recovery refuses concurrent entity edits; no silent overwrite |
| 13 | All modes preflight; restore refuses unexpected state and is rerunnable |
| 14 | Exact DEV, synthetic job, role and downstream release refusal |
| 15 | London dates cover date-only, ISO, Date and BST rollover |
| 16 | S06–S13 normal work cannot restart cancellation or bypass reopen review |
| 17 | All S01–S15 bundles parse together; S15 globals namespaced and no outbound/delete capability |
| 18 | Zero-arg DEV smoke with real header adapter reruns; unknown header and environment refused |

## DEV cloud smoke procedure

1. Paste `apps-script/s15/S15Cancellation.js` into DEV Apps Script project
2. Run `restoreS15SafeState()` — verify FN-01/17/20 → Disabled/None
3. Run `runS15FixtureDryRun()` — verify headers read, no existing fixture job
4. Run `runS15FixtureApply()` — seed synthetic fixture
5. Run `runS15FixtureValidate()` — verify fixture rows exist
6. Run `runS15EnableFunctionsForSyntheticTest()` — enable Pilot modes
7. Run `runS15HappyPathTest()` — full smoke sequence
8. Run `restoreS15SafeState()` — disable all functions

No real Calendar/Xero/GHL/Jotform calls. No PROD references.
