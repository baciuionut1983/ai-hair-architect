# Roadmap Reconciliation Blocker Decisions

## Purpose
- Record closure-milestone decisions for unresolved mandatory blockers after G-API-001 and G-API-002 completion.

## Decision Register

| Decision ID | Gap | Decision | Scope Boundary | Result |
|---|---|---|---|---|
| D-GDATA-001 | G-DATA-001 | Do not change Prisma schema or run migrations in this closure milestone; carry a dedicated parity decision into a follow-up data-convergence milestone. | No schema.prisma edits, no migration files, no database contract expansion in current milestone. | blocker remains partial |
| D-GARCH-001 | G-ARCH-001 | Do not materialize additional monorepo target-state packages/apps in this closure milestone; document architectural delta and defer to architecture alignment milestone. | No creation of apps/worker, packages/ui, packages/ai-sdk, packages/config as implementation deliverables in current milestone. | blocker remains partial |
| D-GREADY-001 | G-READY-001 | Keep readiness items factual; mark unresolved evidence (commercial E2E, p95 verification, rollback runbook) as blocking for full gate closure. | No fabricated readiness claims; only repository-backed evidence accepted. | blocker remains partial |

## Readiness Impact
- Gate cannot move to PASS while any mandatory blocker is partial/unverified/not implemented.
- Current closure milestone result: API obligations reconciled; non-API mandatory blockers remain open.

## Next Required Milestone Scope
- Data-model parity matrix resolution and explicit implementation decision (G-DATA-001).
- Architecture target-state reconciliation decision package (G-ARCH-001).
- Production-readiness evidence package completion (G-READY-001).
