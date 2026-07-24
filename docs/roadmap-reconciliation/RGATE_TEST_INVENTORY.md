# Test Inventory and Validation Coverage

## 1. Test Scope Taxonomy
- unit tests: web/src/lib/*.test.ts
- route tests: web/src/app/api/v1/**/route.test.ts
- integration tests: web/tests/integration/*.test.ts
- e2e tests: web/tests/e2e/*.spec.ts

## 2. Milestone-Tagged Test Mapping

| Milestone | Representative Test Evidence | Status |
|---|---|---|
| M8 | web/src/lib/milestone8-integratio n.test.ts; web/src/lib/milestone8-e2e-real.test.ts | complete |
| M9 | web/tests/e2e/milestone9-real-e2e.spec.ts (Milestone 9 - Real E2E Workflow); web/tests/e2e/milestone9-contract-tests.spec.ts | complete |
| M10 | web/tests/integration/webhook-delivery-persistence.integration.test.ts; web/tests/integration/webhook-delivery-worker.integration.test.ts; web/tests/integration/webhook-operational-snapshot.integration.test.ts | complete |
| M11 | no dedicated M11 test artifact mapped to explicit blueprint requirement | unverified |
| M12 | web/tests/integration/m12-ops-persistence.integration.test.ts (M12 ops persistence integration); web/tests/integration/m12-push-runtime-persistence.integration.test.ts (M12 push runtime persistence) | complete |
| M13 | web/tests/integration/m13-backup-verification.integration.test.ts; web/tests/integration/m13-backup-restore-preview.integration.test.ts; web/tests/integration/m13-backup-restore-execution.integration.test.ts; web/tests/integration/m13-backup-restore-history.integration.test.ts; web/tests/integration/m13-backup-restore-run-maintenance.integration.test.ts; web/tests/integration/m13-backup-restore-run-retention.integration.test.ts; web/tests/integration/m13-backup-restore-observability.integration.test.ts; web/tests/integration/m13-backup-restore-alerts.integration.test.ts | complete |

## 3. Named Validation Evidence
- auth logout route: web/src/app/api/v1/auth/logout/route.test.ts validates 401 unauthenticated behavior and cookie/session revocation path.
- consultation by id route: web/src/app/api/v1/consultations/[id]/route.test.ts validates 401, owner-scoped 404, and successful owner retrieval.
- auth session revocation integration: web/tests/integration/auth-session-revocation.integration.test.ts validates single-token revocation in in-memory and Prisma-backed session stores.
- consultation ownership integration: web/tests/integration/consultations-ownership.integration.test.ts validates owner-scoped consultation lookup by consultation id.
- m13 restore observability integration: "enforces owner isolation, window semantics, deterministic timeline, and zero mutation"
- m13 restore alerts integration: "builds active-only alerts with threshold evidence and keeps DB mutation-free"
- m13 backup verification integration: "classifies valid m13 artifact without image assets as verification_ready"
- M12 ops persistence integration: "persists backup snapshots with deterministic checksum metadata"
- M12 push runtime persistence: "persists enqueue and process through real push routes, and retention removes only old owner-scoped entries"

## 4. Coverage vs Blueprint Acceptance Needs

| Blueprint Validation Need | Repository Evidence | Status |
|---|---|---|
| API contract verification | contract + route tests present | partial |
| Domain integration flow tests | broad integration suite present | complete |
| End-to-end critical journey tests | M9 persisted E2E present; broader commercial E2E limited | partial |
| Production readiness validation package | no unified formal package file in repo | not implemented |

## 5. Test Quality Flags
- complete requires named test evidence plus matching implementation artifact.
- partial indicates tests exist but do not fully prove all blueprint exit criteria.
- unverified indicates no direct technical test evidence.
