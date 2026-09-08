# S14 implementation — 6 September 2026

**LOCAL IMPLEMENTATION PASS; DEV CLOUD HAPPY PATH AWAITING REDEPLOY/RERUN.** Financial summaries, payment reconciliation, invoice status reporting, overdue detection, report snapshots, and financial completion checks. Derived from InvoiceStages, Payments, Jobs — no new transactions created.

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

Both must be enabled for S14 cloud smoke. `restoreS14SafeState()` returns both to Disabled/None/R4.

## Architecture

### Financial summaries (`s14/reporting.js`)
- `jobFinancialSummary(jobId, store, asOf)` — per-job gross, invoiced, paid, outstanding, overdue
- All amounts integer pence via `pence()` coercion (Sheets may return numeric strings)
- Overdue: stages with due_date < asOf and outstanding > 0
- Financial completion: `operational_complete_at` + Deposit + Interim + Final all exist and fully paid (25/35/40 model preserved)

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

## DEV cloud gross mismatch (resolved in code)

Root cause: happy-path asserted `summary.gross === 480000` while Sheets/`getValues` can return pence as strings (`"480000" === 480000` is false; FAIL text still printed `Gross=480000`). Stale job rows missing gross also yielded `Gross=0`. Fix: coerce all money fields with `_s14Pence`/`pence`, upsert canonical job/stage/payment amounts in the happy path, accept idempotent snapshot reuse. Validation not weakened — completion still requires operational milestone + all three stages paid.

## Tests (15, all passing)

| # | Test |
|---|---|
| 1 | Financial summary — gross, invoiced, paid, outstanding, overdue |
| 2 | Integer pence only |
| 3 | Sheet numeric strings coerce to integer pence (gross=480000) |
| 4 | Duplicate payment ref detected |
| 5 | Overpayment detected |
| 6 | Invoice status report (overdue) |
| 7 | Report snapshot idempotent |
| 8 | Deposit+Interim paid, Final absent → NOT complete |
| 9 | Zero stages → NOT complete |
| 10 | Operational milestone + all 3 paid → complete |
| 11 | Any stage outstanding → NOT complete |
| 12 | Unrelated rows untouched |
| 13 | localDate handles Date objects and strings |
| 14 | Missing job returns error |
| 15 | S14Reporting.js VM smoke (string-gross + happy path + restore) |

## Cloud smoke test

`apps-script/s14/S14Reporting.js` — single file, 7 zero-arg functions:
- `runS14FixtureDryRun()` / `runS14FixtureApply()` / `runS14FixtureValidate()`
- `runS14EnableFunctionsForSyntheticTest()` — FN-09 + FN-12 Automated/Pilot/R4
- `runS14HappyPathTest()` — financial summary, invoice report, snapshot (upserts fixture money fields)
- `restoreS14SafeState()` — both restored to Disabled/None/R4

No automated clasp/deploy runner in repo — redeploy the Apps Script file and rerun the four functions above in the DEV project, always ending with `restoreS14SafeState()`.
