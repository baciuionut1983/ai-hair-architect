# M21 Closure Report — Unified AI Image Analysis Pipeline

## Status: CLOSED (pending final commit approval for GO-4)

M21 eliminates the last structural inconsistency left over from M18: two concurrent, differently-governed code paths that could both produce an `ImageAnalysis` row for the same asset — an ungoverned synchronous mock at upload time, and a consent-gated, quota-governed real Gemini path. M21 replaces the mock path with a single, honest, non-privileged placeholder and makes the real-provider path the only path that ever creates or advances an `ImageAnalysis` row toward a real result.

## Problem Eliminated

Before M21, `POST /api/v1/uploads` created an `ImageAsset` **and**, synchronously in the same request, ran `MockDeterministicProvider` (a hash-of-bytes fake classifier) and persisted its output as a `status: 'draft'` `ImageAnalysis` row — indistinguishable in shape from a real result. Separately, the consent-gated trio (`request-ai-analysis` → `process` → `review`) used `queueAnalysisForExternalProvider` to create a **second**, independent `ImageAnalysis` row for the same asset once real analysis was requested. `queueAnalysisForExternalProvider` never checked for an existing draft row, so an asset could end up with two simultaneous `status: 'draft'` rows — one fabricated, one real — and `review`'s `take(1)` query with no `orderBy` picked between them non-deterministically. M21 closes this end to end.

## GO-1 → GO-4 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Read-only audit of both flows, decision freeze (placeholder shape, consent boundary, `queueAnalysisForExternalProvider` reuse contract, review ordering, `MockDeterministicProvider` disposition, dead-code confirmation) | Read-only, no commit |
| GO-2 | Repository-level unification: `queueAnalysisForExternalProvider` extended to recognize and reuse a fresh placeholder or a still-retryable failed row, fail-closed on every ambiguous/incompatible state, race-safe | Commit `8163e3d899101edef11530c5015a3568733b41a3` |
| GO-3 | Service/route-level unification: upload creates the placeholder directly (no provider call), `/uploads`'s `analysisId` bug fixed, `review` made deterministic and fail-closed on duplicates, `getAnalysisForAsset` removed, live path to `MockDeterministicProvider` eliminated | Commit `bcf35f32e37cb7a298e37ea5129ea92400e1ec47` |
| GO-4 | Full end-to-end regression across the unified pipeline and this closure report | This package — commit pending approval |

Commit chain verified continuous: `e8aa8cc` (M20 close) → `8163e3d` → `bcf35f3` → GO-4 (pending).

## Final Pipeline Architecture

```
POST /api/v1/uploads
  -> creates ImageAsset + storage
  -> creates exactly one ImageAnalysis placeholder:
       status: 'draft', providerName: 'manual-only', modelVersion: 'manual-1.0',
       analysisPayload/confidences: all-unknown/zero (ManualOnlyProvider, no I/O, no external call)
  -> zero AI provider invocation

POST .../request-ai-analysis  (consent required)
  -> recordExternalAiConsent (sole writer of consent)
  -> queueAnalysisForExternalProvider:
       recognizes the fresh manual-only/no-consent placeholder and transitions
       the SAME row to 'queued' (never a second row); a still-retryable failed
       row is reused identically; any other existing state fails closed
  -> processImageAnalysis (see below)

POST .../process  (retry / continuation of an already-queued, consented row)
  -> processImageAnalysis:
       sole place in the codebase that ever calls an AI provider;
       resolveImageAnalysisProviderConfig (fail-closed) -> GeminiImageAnalysisProvider;
       claimQueuedAnalysisForProcessing (M18 quota/retry, unchanged) -> provider.analyze() -> persist

POST .../review
  -> selects the asset's draft row(s) ordered by createdAt desc, with no take
     limit; exactly one row -> reviewed; more than one -> 409
     ANALYSIS_STATE_INTEGRITY_ERROR, fail-closed, never an arbitrary pick
  -> reviewAnalysis: creates an ImageAnalysisReview and updates the existing
     ImageAnalysis row -- never creates a parallel one
```

One pipeline, one entry point for provider invocation (`processImageAnalysis`), one job-creation/reuse primitive (`queueAnalysisForExternalProvider`), one configurable provider resolver (`resolveImageAnalysisProviderConfig`).

## Verification Evidence (GO-4, run against the full repository)

- `git status --short` (pre-check): only `?? .claude/` — untracked, pre-existing, out of scope. Repository otherwise clean.
- `git diff --check`: no errors.
- `npx prisma validate`: schema valid. M21 introduced no schema change across any of its three packages.
- `npm run typecheck`: 0 errors.
- `npm run lint` (full repository): 52 pre-existing problems (14 errors, 38 warnings), all in files M21 never touched (`scripts/*.js`, `backup-v13-*`, `milestone1-store.ts`, `webhook-delivery-*`, e2e/integration test files) — confirmed identical to the baseline present before M21 began. Scoped lint on every file touched across M20–M21 (16 files, including all six from GO-3 plus the session-hardening and job-repository files GO-2 depends on): **0 errors, 0 warnings**.
- Full Vitest suite, mocked mode (`TEST_DATABASE_URL` unset): **1482 passed, 112 skipped, 0 failed** (151 files).
- Full Vitest suite, real Postgres: **1513 passed, 81 skipped, 0 failed** (156 files). Transient `prisma:error` serialization-conflict lines in the concurrency tests are expected — each is a correctly-caught write conflict, automatically retried by the existing Serializable-transaction retry policy, ending in a passing assertion.
- `npm run build`: successful, all routes compiled including `/api/v1/uploads`, `/api/v1/image-analyses/[assetId]/*`.
- Targeted M21-specific test files run together (job-repository, processing-service, request-ai-analysis, process, uploads, review, image-analysis-service, session-auth): **162 passed, 38 skipped, 0 failed** (8 files).

## Closure Criteria — Proof of Each

| Criterion | Proof |
|---|---|
| Upload creates only a `manual-only`/`draft` placeholder | `image-analysis-service.ts`: sole `.analyze()` call in the file is `placeholder.analyze()` on a `new ManualOnlyProvider()`; test `image-analysis-service.test.ts` #10 asserts the exact `prisma.imageAnalysis.create` payload (all-unknown/zero, `manual-only`/`manual-1.0`) |
| Upload never calls an AI provider | Grep for `getProvider(`/`MockDeterministicProvider` across `src/`: zero matches outside `image-analysis-provider.ts` (definition) and `image-analysis-provider.test.ts` (its own dedicated unit test) |
| `request-ai-analysis` remains the sole entry to real AI processing | Grep for `processImageAnalysis(`: called only from `process/route.ts` and `request-ai-analysis/route.ts` (plus its own test file); never from `image-analysis-service.ts` or any upload/review code path |
| Review reuses the existing analysis, never creates a parallel one | `review/route.ts` calls `reviewAnalysis`, which does `findUniqueOrThrow` + `imageAnalysisReview.create` + `imageAnalysis.update` — no `imageAnalysis.create` anywhere in the review path |
| `MockDeterministicProvider` inaccessible from any live route | Confirmed by the same grep above: the only two references left in the entire `src/` tree are the class's own definition and its own standalone unit test |
| `getAnalysisForAsset` removed | Grep for `getAnalysisForAsset` across `src/`: zero matches anywhere |
| `milestone9` UI unchanged | `git diff --stat 5ace461..HEAD -- web/src/app/milestone9/page.tsx`: empty output — byte-for-byte identical across the entire M19–M21 range |
| Single coherent pipeline | See architecture diagram above; `queueAnalysisForExternalProvider` (GO-2) and the direct placeholder creation (GO-3) are complementary, non-overlapping halves of the same invariant: exactly one `ImageAnalysis` row per asset is ever the live target |

## Residual Risks (real, disclosed — none block closure)

- **Historical pre-M21 data**: any asset that already accumulated two simultaneous `draft` rows before this milestone shipped will now receive `409 ANALYSIS_STATE_INTEGRITY_ERROR` on `review` instead of the previous non-deterministic pick. This is the intended fail-closed behavior, not a regression, but affected historical rows (if any exist in a real deployment) need a manual data-reconciliation pass outside M21's scope.
- **`/uploads` response no longer carries a fabricated result**: any external client that was reading `analysisId`/`status` from the upload response as a real classification result will now see the honest `manual-only`/`draft` placeholder instead. The only real consumer in this codebase (`milestone9/page.tsx`) does not read these fields from the upload response at all (confirmed in GO-1), so no in-repo consumer is affected.
- **`getProvider()`'s `MockDeterministicProvider` branch is now fully dead** (zero live callers, zero test callers via `getProvider(...)` specifically — only the class itself is still directly unit-tested). Left in place per the GO-1 decision (harmless, tested utility, not worth deleting), not a risk.

## Confirmation

All closure criteria are proven above with direct evidence, not assumption. Every verification required by GO-4 is green against the full repository, including both real-Postgres and mocked test modes. **M21 is ready to be declared CLOSED**, pending the final GO-4 commit approval for this report.
