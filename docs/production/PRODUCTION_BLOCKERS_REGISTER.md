# Production Blockers Register

## Status Legend
- `critical`: blocks public launch and must produce readiness `NOT_READY`.
- `deferred`: accepted for later milestone and does not independently flip readiness in this phase.
- `resolved`: implementation and validation evidence close the blocker; it no longer contributes to readiness `NOT_READY`.

## Critical Blockers (Current)

| Blocker ID | Area | Status | Rationale |
|---|---|---|---|
| PR-C-002 | Billing webhook authenticity | critical | Provider authenticity verification contract is not approved or implemented. |
| PR-C-003 | Production storage backend | critical | Local filesystem storage is not approved for production usage. |

## Resolved Blockers

| Blocker ID | Area | Status | Resolution evidence |
|---|---|---|---|
| PR-C-001 | Business persistence | resolved | Clients, Consultations, Analyses, Appointments, and Notifications are PostgreSQL-authoritative, owner-scoped, fail closed, and registered as `durable` with `productionReady: true`. |
| PR-D-003 | Full business-domain Prisma migration | resolved | The essential business domains are converged to PostgreSQL and the registry-derived business-persistence readiness check is `PASS`. |

## Deferred Items (Not Implemented in Phase 1)

| Blocker ID | Area | Status | Notes |
|---|---|---|---|
| PR-D-001 | Distributed rate limiting | deferred | Can be handled in a dedicated infrastructure milestone. |
| PR-D-002 | Object storage implementation | deferred | Separate persistence/infrastructure milestone. |

## Readiness Outcome
- While any critical blocker remains unresolved, readiness must return `503 NOT_READY` for public launch.
- Business persistence is `PASS` and no longer contributes to `NOT_READY`.
- Global readiness remains correctly `503 NOT_READY` because Billing webhook authenticity and the production storage backend remain critical blockers.
