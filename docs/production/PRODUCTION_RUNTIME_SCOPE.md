# Production Runtime Scope

## Official Runtime
- Official production runtime is the Next.js application in the `web` workspace.
- Production command surface is defined by `web/package.json` (`build`, `start`).

## Legacy Runtime
- Repository root `server.js` is legacy/non-production.
- `server.js` is not part of the official production runtime and must not be extended for production delivery in this gate.

## Core Gate Phase 1 Intent
- Phase 1 introduces production policy and readiness foundation.
- A `503 NOT_READY` readiness state is expected until critical launch blockers are resolved.

## Deployment Posture
- Phase 1 allows technical/internal deployment for validation.
- Phase 1 does not authorize public launch traffic.
