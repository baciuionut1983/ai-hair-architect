# Production Blockers Register

## Status Legend
- `critical`: blocks public launch and must produce readiness `NOT_READY`.
- `deferred`: accepted for later milestone and does not independently flip readiness in this phase.

## Critical Blockers (Current)

| Blocker ID | Area | Status | Rationale |
|---|---|---|---|
| PR-C-001 | Business persistence | critical | Core product domains still rely on in-memory persistence surfaces. |
| PR-C-002 | Billing webhook authenticity | critical | Provider authenticity verification contract is not approved or implemented. |
| PR-C-003 | Production storage backend | critical | Local filesystem storage is not approved for production usage. |

## Deferred Items (Not Implemented in Phase 1)

| Blocker ID | Area | Status | Notes |
|---|---|---|---|
| PR-D-001 | Distributed rate limiting | deferred | Can be handled in a dedicated infrastructure milestone. |
| PR-D-002 | Object storage implementation | deferred | Separate persistence/infrastructure milestone. |
| PR-D-003 | Full business-domain Prisma migration | deferred | Separate persistence convergence milestone. |

## Readiness Outcome
- While any critical blocker remains unresolved, readiness must return `503 NOT_READY` for public launch.
- This state is correct and expected after Phase 1.
