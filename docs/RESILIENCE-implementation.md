# Resilience review and Xero adapter — 12 September 2026

**LOCAL IMPLEMENTATION PASS (11 tests); DEV CLOUD NOT YET RUN.** Closes backlog items: failure alerts, outbound uncertain state handling, Xero adapter disabled by default. No external calls anywhere; the Xero adapter has no transport and no endpoint.

## Resilience review (`resilience/review.js`, FN-14)

| Function | Effect |
|---|---|
| `_rsReviewQueue` | Read-only unified queue: Outbox `NeedsReview`/`RetryDue`/stalled `Processing` (>15 min), Communications `Uncertain`/`Failed`, CommitJournal `RecoveryRequired` or stuck >15 min. Each item carries age, job, owner service (calendar rows belong to the calendar service) and a suggested action. Indicators: pending outbox count and oldest pending age, last health check and last health success (spec: "display last successful sync, oldest pending command, oldest outbox item and last successful health check") |
| `_rsRaiseReviewTasks` | One open task per uncertain item (`RS-REVIEW`, `RS-RECOVERY` for commits), Tanya owner / Ben backup, idempotent by instance key; `RetryDue` items are left to automatic retry |
| `_rsFailureAlerts` | One `RS-ALERT` task per component per day from: injected S16 health issues, stale/failing heartbeat warnings, heartbeats failing with no success inside the threshold, commits requiring recovery, outbox items that exhausted retries. Returns the documented manual check: if automation itself stops, Tanya runs SYS01 manually with Ben as backup |
| `_rsResolveOutbox` | Human resolution for non-calendar outbox rows: `MarkSucceeded` (external id required — confirm the external result first), `Cancel`, `Retry`; completes the review task; audited; idempotent per command. Calendar rows are refused here (use the calendar service) |

Cloud: `runRsReviewQueue()`, `runRsSweep()` (review tasks + alerts; safe for a 30-minute trigger), `runRsResolveOutbox(outboxId, resolution, externalId, reason)`. The cloud store inserts only Tasks/AuditEvents and updates only Tasks/Outbox.

## Xero adapter (`xero/adapter.js`, FN-09, R4) — DISABLED BY DEFAULT

- Builds request envelopes for the existing authorised Zapier/Xero route from S13 `XeroInvoice` intents: `request_id` = intent id, reference = internal Job ID + stage code (`SS-0001-DEP`), amounts, contact (`NOT_CONFIGURED` until real Xero contact ids exist), `create_as: DRAFT`, blockers (`ALREADY_LINKED`, `CONTACT_NOT_CONFIGURED`, `ZERO_AMOUNT`).
- `_xoDispatch` proceeds only when **all** hold: `S01_CONFIG.xeroMode === 'LIVE'`, FN-09 Automated/Pilot/R4, and an approved connector injects a `transport` function. Otherwise `DISABLED` with no writes (or a refusal for LIVE without transport). This repository contains no transport and no endpoint. With a transport: Outbox marked Processing before the call, `InvoiceStages.request_id` stored, accepted → Succeeded awaiting callback, timeout/uncertain → NeedsReview (never retried blindly), transient → RetryDue with backoff, 3 attempts max.
- `_xoInvoiceCallback` stores returned ids (`xero_invoice_id`, `invoice_number`, `source_status`) idempotently; a conflicting id for an already-linked stage goes to review; a Confirmed (bank-checked) stage keeps its status.
- `_xoPaymentCallback` records `Payments` as `Reported` (idempotent by Xero payment id), moves the stage to PartPaid/Paid; **never** touches `ManualBankChecks` (Ben's manual confirmation is never fabricated).
- `_xoReviewCancelInvoice` creates the spec's "Review/cancel Xero invoice" task instead of deleting; the action text depends on the actual invoice status (draft delete vs void/credit vs local cancel).

Cloud: `runXoRequests()`, `runXoDispatch()` (DISABLED unless configured; LIVE still refuses: no transport), `runXoInvoiceCallback(...)`, `runXoPaymentCallback(...)`, `runXoReviewCancelInvoice(stageId, reason)`. The cloud store inserts only Payments/Tasks/AuditEvents and updates only InvoiceStages/Outbox.

Build `npm run build:resilience` (both bundles); tests `npm run test:resilience` (`tests/resilience.test.cjs`, 11 incl. cloud simulation).

## DEV cloud steps (pending — no browser/Apps Script access in this session)

1. Paste `apps-script/resilience/ResilienceReview.js` and `apps-script/xero/XeroAdapter.js`.
2. `runRsReviewQueue()`, `runRsSweep()`; optional 30-minute trigger on `runRsSweep()`.
3. `runXoRequests()` and `runXoDispatch()` — expect `DISABLED`. Leave `xeroMode` unset until Xero automation is explicitly approved (R4).

## Not done

- No Xero/Zapier connector or webhook exists; enabling Xero automation is a business approval (R4), not a code switch.
- Review/alert tasks use module defaults (`RS-REVIEW`, `RS-RECOVERY`, `RS-ALERT`) rather than seeded TaskTemplates; add templates if the office wants titles configurable.
- Email/communication sending remains captured; `Uncertain`/`Failed` statuses can only arise once a mail adapter exists.
