# Project reference index

All six supplied documents are retained unchanged in the workspace root, alongside one another. The user described the supporting PDF as `reference/New Operations System.pdf`; its actual repository-relative path is `New Operations System.pdf`.

## Authoritative implementation documents and amendment

| Reference | Edition/date | Use |
|---|---|---|
| [01 Developer Build Specification](../01_Simple_Solar_Developer_Build_Specification.docx) | Implementation 2.0; 5 September 2026 | Architecture, business rules, fields, security, ownership and delivery contract |
| [02 User and Admin Manual](../02_Simple_Solar_User_and_Admin_Manual.docx) | Implementation 2.0; 5 September 2026 | Required user/admin journeys and responsibilities |
| [03 Testing and Acceptance](../03_Simple_Solar_Testing_and_Acceptance.docx) | Implementation 2.0; 5 September 2026 | Fixtures, acceptance cases, evidence and release acceptance |
| [RA01 Phased Rollout Amendment](../Simple_Solar_Phased_Rollout_Amendment.docx) | Version 1.0; 5 September 2026 | Authoritative dependency/release sequencing amendment; takes precedence over a single final go-live |
| [04 Step-by-Step Build and Test Guide](../04_Simple_Solar_Step_by_Step_Build_and_Test_Guide.docx) | Implementation 2.1; 5 September 2026 | S01–S20 sequence, prerequisites and gates |

Use documents 01–04 for technical/business detail, subject to RA01’s authoritative dependency-based release allocation. RA01 supersedes requirements to finish every S01–S20 stage before first live use; it preserves all final functions/business rules and each included portion’s technical/evidence requirements. S18/S19/S20 repeat per release. Supporting context does not supersede these authorities; record other genuine contradictions for review.

RA01 is retained at actual repository path `Simple_Solar_Phased_Rollout_Amendment.docx` (supplied as `reference/Simple_Solar_Phased_Rollout_Amendment.docx`). Read in full on 5 September 2026. SHA-256: `fbee5b6137e024e88677bc32e48507ebb9c46f9a014e495236a1f468bf4c798f`.

## Supporting business context

[New Operations System.pdf](../New%20Operations%20System.pdf), displayed title **Our new operations system**, management and staff overview, dated 5 September 2026, 2 pages. Supplied by Ben / Simple Solar. Read in full, including visual verification of both pages, on 5 September 2026. Retained as supporting business context, not an implementation specification or acceptance result.

SHA-256: `7cdf2322811087c5946509fd753e84305f2e6baf400f2701264f44149110abfb`.

See [overview review](operations-overview-review.md) for page/section references, clarifications, comparison notes and outstanding inputs. No direct contradiction was found in this review. The document does not supply the detailed commissioning forms/questions, photos, equipment requirements, review process or handover contents needed for approval.

## Confirmed planning decisions and current stage

[DEC-002 / RA01](implementation-decisions.md) supersedes DEC-001's previous rollout order and strict stage interpretation. Default **R1 Office → R2 Materials/scaffolding → R3 Installer commissioning → R4 Finance/reporting**; a conditional R3/R4 swap needs Ben's documented approval and a revised dependency plan. See [release plan](release-plan.md). Existing operational processes still require inventory, reconciliation, tests and safe scoped cutover. Detailed commissioning awaits a separate commissioning amendment.

S01 remains current and PARTIAL; G01 remains BLOCKED pending company Workspace/AppSheet setup and verification. S02 is unstarted. Adding this reference authorises no functionality, deployment or live-system change. The original S01 test snapshot remains historical evidence; this supporting document and subsequent documentation edits are not part of that earlier hashed snapshot.
