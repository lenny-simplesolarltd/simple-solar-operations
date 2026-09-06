# Management/staff overview review

> Historical scope/planning record. Current stage status and DEV authorisation boundaries are in [implementation-status.md](implementation-status.md): S01 PARTIAL, G01 BLOCKED, S02 COMPLETE IN DEV, S03 complete locally only, S04 LOCAL IMPLEMENTATION PASS / NOT CLOUD DEPLOYED. Earlier “unstarted”, “no S02” and strict wait-to-code statements below describe the original task, not current status. S02 Apply must not be repeated.

Source: [New Operations System.pdf](../New%20Operations%20System.pdf), **Our new operations system**, 5 September 2026, pages 1–2. Supplied by Ben / Simple Solar; full text and both rendered pages reviewed on 5 September 2026. Authority: supporting business context only. See [reference index](reference-index.md) for the authoritative documents and source checksum.

## Clarified end-user outcome

The overview brings the existing requirements together as a staff-facing journey. It reinforces the following outcomes without adding implementation requirements:

| PDF location | Business context clarified | Authoritative implementation references |
|---|---|---|
| p1 introduction; One job record | One shared job history from sale/booking to installation, aftercare and payment; clear responsibilities, less repeated entry, fewer missed actions; role-appropriate AppSheet access on Mac/mobile and familiar name/postcode labels | 01 §§1,3,5,12; 02 §1; 03 T001,T098–T100 |
| p1 A current task list | Each person sees actionable work and overdue follow-ups; related tasks group by job; completion records actor/time/notes and preserves history | 01 §6; 02 §§2–3; 03 T017–T025 |
| p1 Booking, planning and changes | Signed-contract/manual Ben bank-check prerequisites, paper preparation, three-/six-week planning, and coordinated follow-ups for moves, reassignment and cancellation | 01 §§6–7,12; 02 §§4–6,13; 03 T013–T016,T026–T036,T090–T093 |
| p1 Ordering, deliveries and the store | Separate roofing/electrical Thursday deliveries; Friday merchant lists and Tanya's confirmation follow-up; early/partial receipts and usable/damaged stock visibility; 460W/515W demand alongside stock | 01 §8; 02 §§7–8; 03 T037–T058 |
| p2 Scaffolding, calls and follow-up work | Separate strip authorisation/booking/actual removal, persistent scaffold complaints, installer/customer call sequence, return visits, Hannah's variations and Tanya's normal remedial/complaint ownership | 01 §§6,9; 02 §§9–11; 03 T059–T075 |
| p2 Commissioning: detail still to be supplied | The full commissioning content/process is unfinished: actual forms, questions, required photos, equipment details, review process and handover contents must be supplied/mapped/approved. Receipt and review remain separate; missing forms prompt reminders after two working days; PDF presentation can follow agreed content | 01 §§9,14–16; 02 §9; 03 T066–T076; 04 S12 |
| p2 Payments and customer completion | Separate 25/35/40 invoices, interim chasing without automatic installation blocking, completion distinct from cash collection, human GHL task, and distinct Phoenix evidence/payment responsibilities | 01 §10; 02 §12; 03 T078–T089 |
| p2 What management will be able to see; How we will introduce it | Management visibility of sales/work/cash/invoices/recognised income and issue history; staged testing, staff trial/training, daily checks, recovery and retaining actionable obligations | 01 §§11,13,16; 02 §§14,17–18; 03 §§5–6; 04 S16–S20 |

## Contradiction review

**No direct contradiction discovered.** The following shorter descriptions were checked explicitly; none authorises a change to the detailed specification:

- **Commissioning (p2):** describing the outline as provisional preserves the need for actual content and process approval. Existing structural requirements (separate receipt/review, versioning, missing-form reminders, evidence and acceptance gates) still apply. The overview does not approve any technical questions, photo checklist, equipment acceptance rules or handover pack.
- **Operational completion (p2):** the summary mentions Tanya's approval and a happy customer. Document 01 §6 and document 02 §10 additionally require all required work confirmed, commissioning evidence accepted and completion-blocking issues resolved. Their omission from a short paragraph does not remove those gates. Correct invoice/payment wording still gates the human GHL action under 01 §§9–10.
- **Stock forecast (p1):** demand alongside stock is consistent with 01 §8's separate forecast/physical-stock views. It does not create an automatic shortfall order or change the immutable movement rules.
- **ISO 9001 records (p2):** supporting quality-review records is consistent with 01 §11. The overview does not claim certification/compliance or specify a new ISO implementation requirement.
- **Archive (p2):** the brief six-month description retains the stricter 01 §13 conditions: six calendar months after full closure, no unresolved tasks/issues/money/refunds/handover/claims/integration work, backup and integrity checks, and no statutory-record deletion.
- **Rollout (p2):** the initial review retained DEC-001; subsequent authoritative RA01/DEC-002 supersedes its allocation and strict stage sequencing. Current order is R1 Office → R2 Materials/scaffolding → R3 Installer commissioning → R4 Finance/reporting, with only the documented conditional swap. The supporting PDF’s topic order is not a release decision. Reconciliation, testing, training and controlled release repeat per release under RA01.

No conflicting requirement was silently substituted. If a later revision states an incompatible rule, record its exact source/location and the conflicting specification rule for Ben's review before changing implementation.

## Business inputs and blockers

**No new independent business blocker discovered.** The PDF materially reinforces the scope of an existing unresolved commissioning input; it does not supply that input.

**BLOCKED — INPUT REQUIRED:** actual commissioning forms and detailed questions, required photos, equipment details, complete review process and handover contents must be supplied and approved before this part is finalised or used for live sign-off. Ben / Simple Solar supplies the business/source material and identifies any still-unnamed process/content approver; the specification's technical lead/reviewer retains technical question/acceptance approval. Tanya's operational review/handover responsibilities remain as specified. The developer maps and versions the supplied/approved material when its build stage is reached; no invented thresholds, certificates or content. See 01 §§9,14–16 and 04 S12. PDF presentation deferral does not waive required evidence collection/review/handover or mark unfinished T076 assertions passed.

Company Workspace/AppSheet identities, ownership, entitlement/setup and G01 evidence remain outstanding as recorded in the S01 audit/gate. The overview supplies no account credentials, verified recipient/calendar IDs or acceptance evidence and closes none of those blockers.

Existing operational processes remain the baseline confirmed in DEC-001. Their per-producer inventory, settings/IDs, reconciliation, tests and safe cutover are still required; future-tense descriptions of the new system are not evidence that current processes are absent.

## Scope of this review

Documentation only. Supporting PDF retained unchanged beside the four unchanged authoritative DOCX files. The original review did not alter DEC-001; its sequencing is now superseded by RA01/DEC-002. S01 remains current/PARTIAL and G01 BLOCKED. No S02, additional functionality or live-system changes. No new test result or acceptance pass is claimed.

RA01 precedence update: detailed commissioning now explicitly requires a separate commissioning amendment before R3. R1/R2 may proceed under RA01 with a properly documented current evidence/review/handover route; no missing evidence is accepted by default. The overview remains supporting context, not authority to change technical/business rules.
