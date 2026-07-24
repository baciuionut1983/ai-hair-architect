# Gap Register - Roadmap Reconciliation Gate

## 1. Mandatory Gaps (Blueprint Obligations)

| Gap ID | Category | Description | Impact | Risk | Dependencies | Priority | Closure Criterion | Status |
|---|---|---|---|---|---|---|---|---|
| G-API-001 | functional | Missing POST /auth/logout required by blueprint 5.1 | incomplete auth contract | session lifecycle inconsistency | auth route layer | P0 | route exists and has validation evidence | complete |
| G-API-002 | functional | Missing GET /consultations/:id required by blueprint 5.4 | incomplete consultation read contract | downstream flow blocking for record retrieval | consultation routing and store/persistence | P0 | route exists and has validation evidence | complete |
| G-DATA-001 | persistence | Blueprint key tables not fully represented in web/prisma/schema.prisma | data architecture divergence | high rework risk before commercialization | data model convergence decisions | P0 | requirement-to-model matrix has no mandatory unmapped table | partial |
| G-ARCH-001 | architectural | Blueprint monorepo target not fully materialized (apps/worker, packages/ui, packages/ai-sdk, packages/config) | architecture traceability gap | scaling and ownership ambiguity | platform architecture decisions | P1 | approved target-state reconciliation record | partial |
| G-DOC-001 | documentation | Missing comprehensive milestone closing artifacts for M8-M13 in docs/milestones | governance/audit traceability gap | approval ambiguity | evidence indexing across milestones | P1 | canonical closure index complete and evidence-linked | partial |
| G-READY-001 | production readiness | Blueprint production readiness checklist has no dedicated reconciled artifact baseline in repository | launch-readiness ambiguity | go-live risk | security, billing, ops evidence pack | P0 | RGATE_PRODUCTION_READINESS_CHECKLIST.md fully classified and evidence-backed | partial |

## 2. Optional Improvements

| Gap ID | Category | Description | Priority | Status |
|---|---|---|---|---|
| O-OBS-001 | observability | long-range time-series aggregation beyond current operational snapshots | P2 | not applicable |
| O-DOC-002 | documentation | consolidated timeline of internal milestones and tags in one index file | P3 | partial |

## 3. Non-Blueprint Extensions

| Gap ID | Description | Status |
|---|---|---|
| X-ROADMAP-001 | Defining any official milestone beyond blueprint 9.7 without blueprint update | not applicable |
| X-FEATURE-001 | Proposing new functional scope during reconciliation gate | not applicable |

## 4. Contradictions Between Blueprint, Documentation, and Code

| Contradiction ID | Statement | Evidence | Recorded As |
|---|---|---|---|
| C-001 | Blueprint requires POST /auth/logout but route surface lacks it | TECHNICAL_IMPLEMENTATION_BLUEPRINT.md section 5.1; web/src/app/api/v1/auth | resolved via G-API-001 completion |
| C-002 | Blueprint requires GET /consultations/:id but route surface lacks it | TECHNICAL_IMPLEMENTATION_BLUEPRINT.md section 5.4; web/src/app/api/v1/consultations | resolved via G-API-002 completion |
| C-003 | Blueprint database key tables exceed current Prisma model set | TECHNICAL_IMPLEMENTATION_BLUEPRINT.md section 6; web/prisma/schema.prisma | G-DATA-001 |
| C-004 | Internal milestone M11 exists in history but lacks direct requirement-level technical mapping evidence | git log (ab98d38); no direct M11 matrix artifact | unverified classification retained |

## 5. Gap Priority Matrix
- P0: mandatory before formal post-M13 launch-readiness gate closure.
- P1: mandatory for complete architectural/document traceability.
- P2/P3: optional enhancements.

## 6. Closure Rule
- A mandatory gap can move to complete only when both implementation and validation evidence exist and are linked by repository-relative paths.
