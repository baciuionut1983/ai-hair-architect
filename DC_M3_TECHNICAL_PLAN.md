# DC-M3 Analysis Persistence Convergence - Closure Report

Status: Completed and validated
Date: 2026-07-26
Frozen baseline: `fae26d0e4b6e86eb550b203580b5056cd7eb902b`
Implementation commits: `e5d740c6`, `a2503c15`

## 1. Objective

DC-M3 converged the business `Analysis` lifecycle from memory-first plus best-effort Prisma persistence to Prisma-only, owner-scoped, fail-closed persistence.

The M2 `start`, `result`, and `clarify` endpoints became PostgreSQL-authoritative. The deterministic Analysis engine and its algorithms remained unchanged.

## 2. Frozen constraints

- DC-M2 remains the frozen baseline.
- Backup `m13.v1`, `m13.v2`, and `m13.v3` contracts, validators, checksums, canonicalization, fingerprints, and restore semantics remain unchanged.
- DC-M3 must not introduce `m13.v4`.
- Analysis engine behavior, thresholds, and algorithms remain unchanged.
- Production M8 Image Analysis routes, services, mapper, and provider remain unchanged.
- Appointments and other memory-only domains are outside DC-M3.
- Implementation was committed only after focused validation and explicit approval. No push was performed during closure.

## 3. Approved M8 fail-closed interpretation

DC-M3 added restrictive foreign keys from `Analysis` to `User` and `Client` under the following approved rule:

- Valid M8 flows with an existing User, an existing Client, and matching ownership must remain behaviorally unchanged.
- Invalid M8 inputs may be rejected by database integrity when the Client is missing, belongs to another owner, or has been deleted before persistence.
- Rejection of invalid or orphan-producing input is fail-closed behavior and is not a regression.
- No production M8 source file may be modified by DC-M3.
- M8 compatibility is demonstrated only through new or updated non-regression tests.

The M8 upload path continued to accept a supplied `clientId` without an owner-scoped Client lookup. The `finalizeToM8` path continued to copy `ImageAsset.clientId` into `Analysis`. The added foreign keys closed this integrity gap at the database boundary without changing valid M8 execution.

## 4. Analysis creation paths

### M2 start

`web/src/app/api/v1/analysis/start/route.ts` now delegates to one authoritative repository create that rechecks the active owner-scoped Client inside the persistence transaction. The previous in-memory create plus best-effort Prisma upsert path was removed.

### M8 finalizeToM8

`web/src/app/api/v1/image-analyses/[assetId]/review/route.ts` continued to create an M8 Analysis directly through Prisma. This production path remained unchanged. The new foreign keys accept valid owner/client combinations and reject invalid combinations.

### M13 restore

`web/src/lib/backup-v13-restore-execution.ts` continued to validate internal Client ownership, insert Clients before Analyses, and run restore atomically. Existing restore ordering remained compatible with the implemented foreign keys and was not modified.

No other production Analysis create, createMany, upsert, or raw SQL insert path was found. Direct Analysis creates under `web/tests` remained test fixtures, not production paths.

## 5. Implemented database integrity

The additive DC-M3 migration:

- preflight Analysis owner orphans;
- preflight missing or cross-owner Clients;
- preserve the DC-M2 unique key `(id, ownerUserId, clientId)`;
- add `Analysis.ownerUserId -> User.id` with `ON DELETE RESTRICT ON UPDATE CASCADE`;
- add `(Analysis.clientId, Analysis.ownerUserId) -> Client(id, ownerUserId)` with `ON DELETE RESTRICT ON UPDATE CASCADE`;
- perform no data updates, deletes, backfills, table recreation, or destructive operations.

The migration contains blocking preflight checks and aborts application when invalid existing data is detected.

## 6. Completed implementation phases

1. Complete - read-only baseline and data preflight.
2. Complete - additive Prisma schema and migration integrity.
3. Complete - Prisma-only Analysis repository and focused tests.
4. Complete - M2 `start` cutover and route tests.
5. Complete - M2 `result` cutover and route tests.
6. Complete - transactional M2 `clarify` cutover and concurrency tests.
7. Complete - removal of Analysis memory state and obsolete memory tests.
8. Complete - business persistence registry and readiness reconciliation.
9. Complete - M8, Consultation, analytics, and backup non-regression gates.
10. Complete - full validation and read-only implementation audit.

Each phase returned to green before the next phase began.

## 7. Implemented files

- `web/prisma/schema.prisma`
- `web/prisma/migrations/20260726_dc_m3_analysis_convergence/migration.sql`
- `web/src/lib/analysis-persistence.ts`
- `web/src/lib/analysis-repository.ts`
- `web/src/lib/analysis-repository.test.ts`
- `web/tests/integration/analysis-repository.integration.test.ts`
- `web/src/app/api/v1/analysis/start/route.ts`
- `web/src/app/api/v1/analysis/start/route.test.ts`
- `web/src/app/api/v1/analysis/[id]/result/route.ts`
- `web/src/app/api/v1/analysis/[id]/result/route.test.ts`
- `web/src/app/api/v1/analysis/[id]/clarify/route.ts`
- `web/src/app/api/v1/analysis/[id]/clarify/route.test.ts`
- `web/src/lib/milestone1-store.ts`
- `web/src/lib/milestone2-store.test.ts` (removed)
- `web/src/lib/milestone8-integration.test.ts`
- `web/src/lib/milestone8-e2e-real.test.ts`
- `web/src/lib/business-persistence-guards.ts`
- `web/src/lib/business-persistence-guards.test.ts`
- `web/src/lib/production-guards.test.ts`

The repository convergence and route cutover were committed in `e5d740c6`. The obsolete in-memory Analysis store and its test dependencies were removed in `a2503c15`.

## 8. Explicitly unmodified production surfaces

- `web/src/lib/analysis-engine.ts`
- `web/src/lib/analysis-thresholds.ts`
- `web/src/lib/cutting-plan-engine.ts`
- `web/src/app/api/v1/uploads/route.ts`
- `web/src/app/api/v1/image-analyses/[assetId]/review/route.ts`
- `web/src/lib/image-analysis-service.ts`
- `web/src/lib/image-analysis-m8-mapper.ts`
- all backup artifact, preview, verification, execution, fingerprint, and version-dispatch production files

## 9. Preflight and validation result

Before implementation, the following acceptance conditions were verified:

- Git must still identify the frozen DC-M2 baseline.
- The configured database must have all DC-M2 migrations applied.
- Analysis owner orphans must be zero.
- Missing or cross-owner Analysis Clients must be zero.
- Existing M8-linked Analysis reference mismatches must be zero.
- Analysis JSON structural anomalies must be zero.
- Consultation-to-Analysis owner/client mismatches must be zero.
- No production Analysis creation path may remain unclassified.

The configured `ai_hair_architect_test` database passed the final read-only preflight and post-implementation validation on 2026-07-26:

- 14 migrations applied; Prisma reported the schema up to date;
- 1 User and zero Client, Analysis, Consultation, ImageAsset, and ImageAnalysis rows;
- zero Analysis owner orphans;
- zero missing, cross-owner, or soft-deleted Analysis Clients;
- zero ImageAsset owner/client integrity anomalies;
- zero M8 reference or shape mismatches;
- zero Analysis JSON structural anomalies;
- zero Consultation-to-Analysis scope mismatches;
- zero duplicate Analysis candidate keys.

Focused Analysis route and repository tests, PostgreSQL integration tests, M8 compatibility tests, typecheck, build, Vitest, and Playwright gates passed during implementation and closure. This local result does not replace the required preflight for every deployment target.

## 10. Rollback criteria retained

The following criteria remain deployment stop conditions for DC-M3:

- a preflight detects existing orphan or cross-owner data;
- a valid M8 flow fails after the implemented constraints;
- any production M8 source file would need modification;
- any backup v1/v2/v3 artifact, checksum, canonicalization, fingerprint, or dispatch behavior changes;
- an Analysis database error is converted to success, fallback, or false `404` instead of fail-closed `503`;
- owner isolation or Client ownership can be bypassed;
- concurrent clarification loses an accepted update;
- the Analysis engine output changes;
- DC-M2 Consultation invariants regress.

Any rollback must avoid destructive Git commands and must not revert unrelated user changes.

## 11. Closure status

DC-M3 is completed and validated. The M8 fail-closed interpretation was preserved, the additive Analysis foreign keys were applied and validated against the configured test database, and the M2 Analysis lifecycle now uses the PostgreSQL-authoritative repository. Production M8 engine and route behavior remained unchanged. Backup restore behavior and all `m13.v1`, `m13.v2`, and `m13.v3` contracts remained unchanged. The implementation was closed by commits `e5d740c6` and `a2503c15`; no push was performed as part of this closure.
