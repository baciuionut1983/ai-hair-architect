# M8-M13 Reconciliation Closure Status

## Scope
- This record captures closure status for internal milestones M8-M13 under the Roadmap Reconciliation Closure Milestone.
- Status values are factual and evidence-linked only.

## Status Table

| Milestone | Status | Evidence |
|---|---|---|
| M8 | complete | web/src/lib/milestone8-integration.test.ts; web/src/lib/milestone8-e2e-real.test.ts |
| M9 | complete | web/tests/e2e/milestone9-real-e2e.spec.ts; web/tests/e2e/milestone9-contract-tests.spec.ts |
| M10 | complete | web/tests/integration/webhook-delivery-persistence.integration.test.ts; web/tests/integration/webhook-delivery-worker.integration.test.ts; web/tests/integration/webhook-operational-snapshot.integration.test.ts |
| M11 | unverified | no dedicated requirement-level technical mapping artifact in repository |
| M12 | complete | web/tests/integration/m12-ops-persistence.integration.test.ts; web/tests/integration/m12-push-runtime-persistence.integration.test.ts |
| M13 | complete | web/tests/integration/m13-backup-verification.integration.test.ts; web/tests/integration/m13-backup-restore-preview.integration.test.ts; web/tests/integration/m13-backup-restore-execution.integration.test.ts; web/tests/integration/m13-backup-restore-history.integration.test.ts; web/tests/integration/m13-backup-restore-run-maintenance.integration.test.ts; web/tests/integration/m13-backup-restore-run-retention.integration.test.ts; web/tests/integration/m13-backup-restore-observability.integration.test.ts; web/tests/integration/m13-backup-restore-alerts.integration.test.ts |

## Closure Milestone Additions
- G-API-001 completed: web/src/app/api/v1/auth/logout/route.ts and test evidence.
- G-API-002 completed: web/src/app/api/v1/consultations/[id]/route.ts and test evidence.

## Remaining Mandatory Gaps
- G-DATA-001 (partial)
- G-ARCH-001 (partial)
- G-DOC-001 (partial)
- G-READY-001 (partial)

## Decision
- M8-M13 reconciliation remains partially closed until remaining mandatory non-API gaps are resolved.
