# Production Blockers Register

## Status Legend
- `critical`: blocks public launch and must produce readiness `NOT_READY`.
- `deferred`: accepted for later milestone and does not independently flip readiness in this phase.
- `resolved`: implementation and validation evidence close the blocker; it no longer contributes to readiness `NOT_READY`.

## Critical Blockers (Current)

| Blocker ID | Area | Status | Rationale |
|---|---|---|---|
| — | — | — | No critical blockers are currently tracked. |

## Resolved Blockers

| Blocker ID | Area | Status | Resolution evidence |
|---|---|---|---|
| PR-C-001 | Business persistence | resolved | Clients, Consultations, Analyses, Appointments, and Notifications are PostgreSQL-authoritative, owner-scoped, fail closed, and registered as `durable` with `productionReady: true`. |
| PR-D-003 | Full business-domain Prisma migration | resolved | The essential business domains are converged to PostgreSQL and the registry-derived business-persistence readiness check is `PASS`. |
| PR-C-003 | Production storage backend | resolved | M16 (GO-1–GO-4): S3-backed object storage is the active write path with independent post-write integrity verification; `STORAGE_PRODUCTION_POLICY_READY` is a real, live readiness canary (cached, single-flight, fail-closed) rather than a hardcoded result. Reaching `PASS` still requires a correctly configured, reachable S3-compatible endpoint in the target environment — the check itself is real and closed. |
| PR-C-002 | Billing webhook authenticity | resolved | M17 (GO-1–GO-5): Stripe webhook signatures are verified via the official SDK against the exact raw request body before any processing; billing state is persisted durably in PostgreSQL with database-enforced idempotency; `BILLING_WEBHOOK_AUTHENTICITY_READY` is a real, live, fail-closed readiness evaluation rather than a hardcoded result. See `docs/milestones/M17_CLOSURE_REPORT.md`. |

## Deferred Items (Not Implemented in Phase 1)

| Blocker ID | Area | Status | Notes |
|---|---|---|---|
| PR-D-001 | Distributed rate limiting | deferred | Can be handled in a dedicated infrastructure milestone. |
| PR-D-002 | Object storage implementation | deferred | Retained pending explicit review against M16's closure; not re-scoped as part of the M17 update. |

## Readiness Outcome
- No critical blocker currently requires readiness to be `NOT_READY` by policy.
- Business persistence, production storage backend readiness, and billing webhook authenticity readiness are all real, live, fail-closed checks rather than hardcoded results.
- A `NOT_READY` result in a given environment now means that environment is genuinely not correctly configured (for example, no reachable S3-compatible endpoint, or no `BILLING_PROCESSING_MODE`/Stripe credentials configured) — not that a check is unimplemented.
