# S01 audit — test environment and ownership

Audit date: 2026-09-05. Scope: S01 only. Overall: PARTIAL locally; G01 BLOCKED.

## Authority and observed workspace

Read all four supplied documents: **01 Developer Build Specification**, edition 2.0; **02 User and Admin Manual**, edition 2.0; **03 Testing and Acceptance**, edition 2.0; **04 Step-by-Step Build and Test Guide**, edition 2.1. All dated 5 September 2026. They are in the workspace root `/Users/lennybeadle/:reference` (the requested `/reference` path is not present). These current editions supersede conflicting legacy sources. Document 04 S01 expands document 01 B01; it does not authorise later stages. Subsequent authoritative RA01 changes release sequencing as recorded below; S01 itself remains current. No application, Git repository, account configuration or existing inventory was present at audit time. The four documents are instructions, not evidence of completed setup.

Architecture: AppSheet → structured Google Sheets → authoritative Apps Script processor → Drive/Calendar/external integrations. Jotform/Zapier intake, Zapier/Xero actions and human GHL/Phoenix tasks belong to later stages. Squarespace is outside the core. No Supabase/Vercel redesign.

## Complete S01 requirement allocation

“Local” means code/templates/instructions possible here, not company account setup verified. Every unresolved external input below is **BLOCKED — INPUT REQUIRED**. Ben owns priorities/access; the developer owns implementation/deployment. Where a provider administrator or recovery contact is not named in the specifications, Ben must designate one; no identity is inferred.

| ID | S01 requirement and source | Local work | Manual/account work and required input |
|---|---|---|---|
| S01-01 | Company-controlled licensed automation user, MFA, named developer access; no shared Ben password, super-admin or unrestricted banking access (01 B01, §3) | Ownership/access procedure | Ben/company administrator: actual company account, licence, least-privilege grants and MFA evidence |
| S01-02 | Company-owned project folder, source repository, development Apps Script; company retains access after developer leaves (04 S01.1; 01 §1; 02 §18) | Source foundation and version manifest | Ben: company repository organisation, owner account; administrator: project/source ownership and access evidence |
| S01-03 | Record owners, recovery contacts, developer access, named backups and deployment responsibility (04 S01.1; 01 §16) | Ownership register | Ben: verified identities, recovery contacts, backups; developer: support contact/term. Do not transfer Ben's business authority |
| S01-04 | Separate DEV/TEST Sheets, Drive evidence folders, calendars and AppSheet apps; production IDs separately protected (04 S01.2; 01 §1/B01; 03 §1) | Null templates and isolation design | Administrator/developer: create independent resources, verify IDs/ACLs and AppSheet sources, no copied production credentials |
| S01-05 | Synthetic first customer/test jobs, verified test inboxes and installer accounts, record permitted data/credentials per environment (04 S01.2–3,6; 03 §1/F0) | S01 synthetic probes; data policy | Ben: approved inboxes/users and who verifies receipt; administrator: no forwarding to real recipients. Full F0 loader belongs to S02 |
| S01-06 | Europe/London business dates; configurable staffed days/holidays/capacities, no real-clock changes (04 S01.3; 01 §1; 03 §1) | Timezone in manifest/template; calendar policy | Administrator: matching Sheets/Calendar/AppSheet settings; Ben: holiday/capacity/owner settings for later configuration. Do not invent holidays or capacity limits |
| S01-07 | Outbound adapter denies all non-allowlisted destinations, including email and Calendar invitations (04 S01.3/G01) | Fail-closed allowlist and test-only probe; component tests | Company connection owner: reviewed test configuration; developer/tester: execute isolated connector probes and capture results |
| S01-08 | Inventory each current Jotform, Zap, calendar, invoice/GHL action, scaffold sheet; triggers, owners, outputs, identifiers, intended replacement/retirement (04 S01.4; 01 B01/§13/§15; 03 §5) | Structured discovery inventory, including supplier/Phoenix/Signable and retained manual processes | Ben/Tanya and existing connection owners: enumerate every actual producer, IDs, live state and transition decisions; split templates into one row per instance |
| S01-09 | Export/back up current settings without changing live producers (04 S01.4; 01 B01) | Protected export/evidence procedure | Existing connection owners: read-only exports with date/version/checksum and restricted storage; exports may contain secrets/customer data, never commit raw exports |
| S01-10 | Verify Workspace/AppSheet entitlements, partner access and actual connector operations; agree unsupported-operation path before relying on it (04 S01.5; 01 §14; 02 §15) | Entitlement/operation register | Administrator and developer: exact plans, tenant policies, internal/external test users and operation evidence; Ben agrees implementation path where necessary |
| S01-11 | Test register, defect log, expected/actual, component/integration separation, release/config/environment/fixture/tester/time/evidence/retest (04 introduction/S01.6; 03 §1/§4) | Registers and evidence location | Named human tester and reviewer, real connector results. Blank/not executed is NOT RUN; blocked is never PASS |
| S01-12 | Repeatable fixture reset/load and evidence linked to initial source version (04 S01.6; 03 §1/F0) | Local reset instructions and source hashes | Administrator/developer: verify target environment before any cloud reset, retain evidence before cleanup; no production reset. Business F0 deferred to S02 |
| S01-13 | Preserve existing processes; explicitly decide retain/retire Trello, whiteboard, paper folders and scaffold sheet (01 B01/§13/§15; 02 §4) | Inventory and future cutover/rollback fields | Ben: decisions; actual producer replacement only at the applicable R?-S20 after that release’s rehearsal and Ben approval under RA01, never S01 |

## G01 requirements (04 S01 “Test immediately”, “Move on”, “Save as evidence”)

1. Email outside allowlist refused; rejection before any send, no external message.
2. Calendar invitation outside allowlist refused; no event/invitation created.
3. Approved test destination succeeds and receipt confirmed. Record email and Calendar separately to close both channels unambiguously; transport return alone is insufficient.
4. Test user cannot open production data folder. Test with the actual restricted test identity and a company-provided link, not a developer/admin session. Do not change production ACLs during S01.
5. Ben's company account can access source repository.
6. Ben's company account can access project/system/integration inventory.
7. Environment isolation, ownership, entitlement checks, inventory exports and setup registers above completed; retain environment register, ownership/access screenshots, automation inventory, allowed/blocked results and initial source version.

The six explicit checks are split into seven rows in the gate because approved email and approved Calendar receipt are recorded separately. Supporting S01 completion conditions are also reported individually there. A local capture test cannot satisfy G01's real connector/identity requirements. S02 must wait for all G01 checks and S01 prerequisites to pass.

## Inputs, unknowns and dependencies

All are **BLOCKED — INPUT REQUIRED**, unless explicitly described as later-stage inputs:

- Ben: company Google domain/account, repository hosting organisation, named developer account and access scope, recovery owner/contact and backups. No remote URL or ownership can be inferred from this personal workspace.
- Ben/company administrator: Workspace and AppSheet subscriptions, tenant restrictions, shared-drive availability and verified ownership/deployment support; external installer/scaffolder test identities; test resource IDs and actual production folder link for the denial test. Exact supported connector operations/quotas remain unverified.
- Ben/company administrator: verified direct test inboxes (no forwarding, group expansion, auto-replies or rules that can reach customers), isolated test calendars and service permissions. No emails inferred from people's names.
- Ben/Tanya plus existing integration owners: complete live producer list, owner/access/export evidence and intended replacement decisions. Job Sold and Job Booking URLs are known from 01 §14, but current question IDs, Zaps, source/target IDs and actual live status are unverified. Ben/Tanya approve future mappings at S05; headings/legacy worksheets are not mappings.
- Ben/developer: setup deadlines, named tester, release identifier, evidence location and licence exceptions/implementation decisions. This audit supplies no invented deadline or acceptance signature.
- Later, before related features: Ben supplies staff/calendars/merchant/scaffolder/product/business settings; technical lead supplies approved commissioning questions; accountant/finance owner supplies account/tax/recognition/cost and opening balance rules; Hannah retains variations/Phoenix evidence and Tanya payment chasing/GHL/operations. No such business workflow is implemented here. Missing later finance/commissioning inputs alone need not block S01.

Existing systems are read-only discovery dependencies in S01, not runtime dependencies of the local tests. New intake must eventually avoid old derived Sheets/helper tabs. Existing event/invoice/order IDs must later be reconciled before replacement to avoid duplicate producers.

## Explicitly excluded and untouched

No production emails, invoices, orders, stock movements, Calendar mutations, GHL/Phoenix changes, live Zap shutdown, Jotform submission/edit, Apps Script changes to live projects, scaffold/supplier workflow change, customer migration or real customer first fixture. No change to production folder permissions to force a gate pass. No banking access. No commissioning thresholds, accounting codes or current question IDs invented. No secrets or production identifiers in committed configuration. No S02 tables/keys/directory seeding, F0 business loader, S03 processor/triggers, later interfaces or application built.

## Historical release-planning clarification — DEC-001 (allocation superseded by RA01/DEC-002)

Ben / Simple Solar has confirmed the intended functional rollout: office operations first, installer functionality second, stores functionality third. Materials/scaffolding, installer processes and finance/reporting already exist operationally in some form; the new system streamlines, improves and progressively replaces/integrates them. See [the confirmed decision](implementation-decisions.md).

Existing-process details and per-producer live status still require inventory verification. That clarification originally left the build sequence unchanged. RA01/DEC-002 now supersedes its rollout allocation and the strict build sequence; business rules and S01/G01 status remain unchanged. Replacements still require inventory, reconciliation, testing and safe cutover under the specification. No S02 or additional functionality is authorised by this note.

## Supporting management/staff overview received

Ben / Simple Solar supplied `New Operations System.pdf` (5 September 2026, two pages), retained in the workspace root alongside the four authoritative specifications. Both pages have been read in full. See the [reference index](reference-index.md) and [review](operations-overview-review.md). This overview supports understanding of the end-user journey; it does not supersede implementation requirements or provide evidence of completed setup.

No direct contradiction or new independent S01 blocker was found. The commissioning input remains **BLOCKED — INPUT REQUIRED** and explicitly includes actual forms/questions, required photos, equipment details, review process and handover contents to be supplied/approved. Ben / Simple Solar provides source material and identifies unresolved business approvers; the technical lead/reviewer retains technical acceptance responsibility under the specification. No technical criteria or content have been inferred. This is a later-feature input, not an additional S01 prerequisite.

The overview review originally retained DEC-001; its allocation is now superseded by RA01/DEC-002: R1 Office → R2 Materials/scaffolding → R3 Installer commissioning → R4 Finance/reporting. Existing processes must still be inventoried, reconciled, tested and progressively integrated/replaced through the specified safe cutover. S01 remains current while company Workspace/AppSheet setup and G01 verification are outstanding; no S02 or additional functionality is authorised.

## Authoritative RA01 amendment

RA01 Version 1.0, 5 September 2026 was read in full and added to the [reference index](reference-index.md). Its dependency-based allocation supersedes the strict S01→S20 single-go-live interpretation. Original final functions/business rules and included portions’ technical/evidence requirements remain; S18/S19/S20 repeat for each release. See [DEC-002](implementation-decisions.md), [release plan](release-plan.md), [mode register](../integration-inventory/release-ownership-modes.csv) and [test planning](../tests/release-test-planning.md).

R1 includes required recovery, backup/restore, health, security, cancellation/reinstatement and usable office controls, plus tracked existing external routes; later modules cannot excuse missing controls. G01 remains BLOCKED pending cloud evidence and company setup. No S02 functionality or live activation is authorised here. Separate commissioning amendment is required for R3; a documented safe current evidence/review/handover route is required for R1. Deferred features/tests remain outstanding, never delivered or Not Required by release allocation alone.
