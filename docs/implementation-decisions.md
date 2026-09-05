# Confirmed implementation and release-planning decisions

## DEC-001 — staged functional rollout (historical)

Status: **SUPERSEDED for release order/allocation and strict stage sequencing by DEC-002 / RA01**. Historical decision owner: **Ben / Simple Solar**. Recorded: 2026-09-05. Source: Ben / Simple Solar business clarification supplied by the user in this project conversation.

The intended staged functional rollout is:

1. Office operations first.
2. Installer functionality second.
3. Stores functionality third.

Materials/scaffolding, installer processes, and finance/reporting already exist operationally in some form. The new system is intended to streamline, improve, and progressively replace or integrate those existing processes. Planning must recognise that operational baseline. Confirmation that these processes exist does not verify any particular application's configuration, producer, identifier, owner or live status; those details remain subject to inventory and evidence.

This decision records functional rollout priorities. It does not reinterpret the four authoritative specification documents, reorder S01–S20 build stages, waive dependencies or acceptance cases, remove agreed functionality, or authorise an early production release. Do not infer a detailed feature-to-release allocation or rollout dates from this note. In particular, the note does not allocate every materials/scaffolding or finance/reporting feature to a particular release.

Every existing process proposed for replacement must still be inventoried, reconciled, tested and cut over safely according to the specification. Preserve current settings and external identifiers, designate one producer for each outgoing action, and retain the specified cutover/rollback safeguards. Existing operations continue until their tested replacement is authorised under the specification's release gates and Ben's release decision. Relevant controls remain document 01 B01/§13, document 03 §5 and document 04 S19–S20.

Current task impact: documentation only. S01 remains PARTIAL, G01 remains BLOCKED, and S02 remains unstarted. This decision grants no permission to implement additional functionality or change any live system.

## DEC-002 — RA01 controlled releases

Status: **CONFIRMED**. Decision owner: **Ben / Simple Solar**. Authority: [RA01 Version 1.0, 5 September 2026](../Simple_Solar_Phased_Rollout_Amendment.docx), read in full. Recorded: 2026-09-05.

RA01 supersedes the strict single-go-live S01→S20 interpretation and DEC-001's Office → Installers → Stores release order. Current allocation and default order:

1. R1 — Office operations.
2. R2 — Materials and scaffolding (including stores and the Calendar adapter by default).
3. R3 — Installer commissioning.
4. R4 — Finance and reporting (including archive).

R3/R4 may exchange order **only if commissioning details are still pending and the documented manual evidence process supports R4**, with a revised dependency plan and Ben's documented approval. No swap is presently approved. Release names continue to identify scope even if their chronological order changes.

Replace numerical build sequencing with the dependency-based portions in [release plan](release-plan.md). Preserve each portion's technical instructions/evidence and all original final functions and business rules. Relevant cancellation, recovery, health, usable screens and manual external-action controls move into R1; they cannot wait for later modules. Repeat S18 acceptance, S19 migration/training and S20 controlled release for each release, with Ben's go-live decision and later pilot expansion acceptance for each.

DEC-001's recognition of existing operational processes remains valid: inventory, reconcile, test and progressively integrate/replace them safely. One producer per authorised scope; no duplicate source events or blind replay. Track Disabled / Manual / Automated per function and job scope; implementation must enforce modes in the processor, not merely hide buttons. No such enforcement is implemented by this documentation change.

Detailed commissioning remains provisional and requires a **separate commissioning amendment** covering actual questions, photos, checks, reviewers and handover contents before R3. R1/R2 may use documented, accepted evidence from the current company process; missing evidence cannot be treated as accepted. PDF presentation is separately accepted; the complete existing handover route continues until replacement acceptance.

Deferred features/assertions remain outstanding with target release, owner and date to be supplied. They are never delivered or Not Required merely because they belong to a later release. Enabled failures cannot be relabelled deferred. Retain T001–T112, add RT01–RT08, and finally rerun all original and commissioning-amendment cases together.

Current authorisation: documentation/planning only. S01 remains active/PARTIAL; G01 remains BLOCKED. S02 and all new functionality remain unstarted. RA01 is not a go-live approval or evidence of completed software/tests.
