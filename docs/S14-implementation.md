# S14 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS (11 tests); DEV CLOUD NOT YET RUN.** Financial summaries, payment reconciliation, invoice status reporting, overdue detection, report snapshots, and financial completion checks. Derived from InvoiceStages, Payments, Jobs — no new transactions created.

## Authoritative tables

| Table | S14 role |
|---|---|
| `InvoiceStages` | Source of truth for invoiced amounts, due dates, status |
| `Payments` | Payment records linked to invoice stages |
| `Jobs` | Gross amount, operational milestone, deposit confirmation |
| `JobCosts` | Cost tracking (included in summaries) |
| `ReportSnapshots` | Frozen periodic report data with totals |
| `Outbox` | Xero intent presence (read-only) |

## ReleaseModes

| FN | Function | Target | Pilot mode |
|---|---|---|---|
| FN-09 | Invoices and payment reconciliation | R4 | Automated/Pilot/R4 |
| FN-12 | Accounting/reporting | R4 | Automated/Pilot/R4 |

Both must be enabled for S14 cloud smoke.

## Architecture

### Financial summaries (`s14/reporting.js`)
- `jobFinancialSummary(jobId, store, asOf)` — per-job gross, invoiced, paid, outstanding, overdue
- All amounts integer pence
- Overdue: stages with due_date < asOf and outstanding > 0
- Financial completion: all stages fully paid (outstanding === 0)

### Payment reconciliation
- `reconcilePayments(jobId, store)` — detects overpayment, duplicate xero_payment_id, missing external refs, Final-before-operational
- Returns exception list with types

### Invoice status
- `invoiceStatusReport(jobId, store)` — per-stage gross, paid, outstanding, overdue flag, Xero intent presence

### Report snapshots
- `createReportSnapshot(store, type, jobIds, periodStart, periodEnd)` — frozen snapshot with totals_json
- Idempotent: `RS-{type}-{periodStart}`

### Date handling
- `localDate(value)` — normalizes Date objects, ISO strings, YYYY-MM-DD
- `daysBetween(a, b)` — calendar day difference

## Tests (14, all passing)

| # | Test |
|---|---|
| 1 | Financial summary — gross, invoiced, paid, outstanding, overdue |
| 2 | Integer pence only |
| 3 | Duplicate payment ref detected |
| 4 | Overpayment detected |
| 5 | Invoice status report (overdue) |
| 6 | Report snapshot idempotent |
| 7 | Deposit+Interim paid, Final absent → NOT complete |
| 8 | Zero stages → NOT complete |
| 9 | Operational milestone + all 3 paid → complete |
| 10 | Any stage outstanding → NOT complete |
| 11 | Unrelated rows untouched |
| 12 | localDate handles Date objects and strings |
| 13 | Missing job returns error |
| 14 | S14Reporting.js VM smoke test |

## Cloud smoke test

`apps-script/s14/S14Reporting.js` — single file, 7 zero-arg functions:
- `runS14FixtureDryRun()` / `runS14FixtureApply()` / `runS14FixtureValidate()`
- `runS14EnableFunctionsForSyntheticTest()` — FN-09 + FN-12 Automated/Pilot/R4
- `runS14HappyPathTest()` — financial summary, reconciliation, invoice report, snapshot
- `restoreS14SafeState()` — both restored to Disabled/None/R4
