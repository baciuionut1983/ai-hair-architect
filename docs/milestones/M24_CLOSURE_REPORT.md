# M24 Closure Report — Guest / Preview Mode

## Status: CLOSED

M24 gives an unauthenticated visitor a real, honest way to try the product before creating an account -- a gap the pre-M24 audit found explicitly named three times in `PRODUCT_ARCHITECTURE.md` (§2.1, §4.1, §9.1 "MVP Scope") and left completely unimplemented. It is stateless, text-based, and reuses the existing deterministic recommendation engine (`analyzeInitial`) unchanged; it introduces no persistence, no new authentication, and no access to the real Gemini photo-analysis pipeline.

## Problem Addressed

Before M24, every real analysis path -- the text-based `POST /api/v1/analysis/start` and the photo-based Gemini pipeline (`uploads` + `image-analyses/*`) -- required an authenticated session *and* an existing `Client` record owned by that session. There was no concept of "a visitor analyzing their own hair" anywhere in the codebase. The only UI that ever exercised the real photo pipeline, `/milestone9`, is an internal test harness: it hardcodes `clientId = 'client-1'` and reads a Bearer token from `localStorage` with no login form on the page at all -- not a usable product surface for any user, guest or authenticated.

## GO-1 → GO-4 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Read-only audit: full inventory, current unauthenticated flow, exact blocking point (client-centric architecture, not just missing auth), frozen scope decision (text-based/stateless, no photo, no Gemini) | Read-only, no commit |
| GO-2 | `AnalysisPreviewRequest`/`AnalysisPreviewResponse` contracts (additive) + `POST /api/v1/analysis/preview` (no auth, no clientId, IP rate-limited, reuses `analyzeInitial` unchanged) + unit/HTTP tests | Commit `e00e3d5` |
| GO-2 correction | Discovered during live verification (not by inspection alone): `goal: "reshape"` alone made `analyzeInitial` compute a `technicalCutPlan` whose prose leaked professional cutting terminology into `recommendations`/`safetyNotes` even after the `technicalCutPlan` object itself was stripped. Fixed by excluding `"reshape"` from the accepted goal enum -- input-validation boundary only, `analysis-engine.ts`/`cutting-plan-engine.ts` untouched | Commit `92ec491` |
| GO-3 | Real, dedicated `/preview` product page (not `/milestone9`) + one homepage nav link | Commit `4bfd54f` |
| GO-4 | Full end-to-end regression and this closure report | This package |

Commit chain verified continuous: `ae0f68d` (documentation vision milestone close) → `e00e3d5` → `92ec491` → `4bfd54f` → GO-4 (this report). Total M24 footprint: **5 files, 511 insertions, 0 deletions** -- no schema, no migration, no file outside this scope.

## Final Architecture

```
GET /preview
  -> real, standalone product page, no auth required
  -> form: goal / hairType / density / porosity (existing enums, reused
     verbatim from AnalysisRequest -- no new vocabulary invented)
  -> disclaimer shown before and after submission
  -> on submit, calls the endpoint below with no Authorization header
  -> result: recommendations, safety notes, follow-up questions, disclaimer
  -> CTA links to the existing, unchanged registration flow anchored on
     the homepage (no automatic data handoff -- the guest's form values
     simply stay in the browser)

POST /api/v1/analysis/preview
  -> no session check, no clientId accepted or required
  -> rate-limited per IP (20/60s) via the existing hardening.ts primitives
     (a guest has no user id to key on)
  -> validates all 4 fields against their real enums; "reshape" is the
     one goal value excluded (see GO-2 correction above)
  -> calls analyzeInitial with exactly the 4 basic fields -- zero engine
     changes, zero advanced fields ever passed
  -> response never includes: confidenceScore (never invented), phase /
     clarificationRound / analysisId (nothing persisted or async),
     technicalCutPlan (professional-only, defense in depth even though
     the "reshape" exclusion already prevents it from being generated)
  -> 200 on success, 400 on invalid input, 429 on rate limit
```

`/milestone9` and every professional route (`analysis/start`, `uploads`, `image-analyses/*`, `billing/*`) are untouched -- confirmed by empty `git diff` across the whole M24 range.

## Verification Evidence (GO-4, run against the full repository)

- `git status --short`: clean except the pre-existing, out-of-scope `?? .claude/`.
- `git diff --check`: no errors.
- `npx prisma validate`: schema valid; M24 touched no schema/migration file (`git diff ae0f68d..HEAD -- prisma/`: empty).
- `npm run typecheck`: 0 errors.
- `npm run lint` (full repository): 52 pre-existing problems (14 errors, 38 warnings), identical to the M21-M23 baseline; 0 in any file M24 touched.
- Full Vitest suite, mocked mode: **1567 passed, 90 skipped, 0 failed** (162 files).
- Full Vitest suite, real Postgres: **1564 passed, 93 skipped, 0 failed** (162 files) -- run per the standard repository gate even though M24 introduces no persistence of its own.
- `npm run build`: successful; `/preview` (static) and `/api/v1/analysis/preview` (dynamic) both compiled alongside every other route.
- Live end-to-end verification against the real dev server (not just unit tests): homepage 200, `/preview` 200, a real POST returned the exact honest response shape, `goal: "reshape"` correctly rejected with 400, the form no longer offers it. This is how the GO-2 correction was actually found.
- Targeted M24 test file: **18 passed, 0 failed** (`analysis/preview/route.test.ts`).

## Closure Criteria — Proof of Each

| Criterion | Proof |
|---|---|
| No authentication required | `route.test.ts`: "requires no authentication at all (no cookie, no Bearer token, no session mock)" -- passes with zero auth mocking anywhere in the file |
| No clientId, no professional CRM access | Route never reads a `clientId` from the request; "ignores any advanced professional field smuggled into the request body" test proves a smuggled `clientId` is silently dropped |
| No fabricated confidence | `route.test.ts`: "never includes a fabricated confidence score" -- `confidenceScore` is asserted absent from every response |
| No professional technical plan or terminology | `route.test.ts`: "never includes a technicalCutPlan for any accepted goal" + "never surfaces professional cutting-plan terminology..." (checks all 5 accepted goals for the exact strings that leaked pre-fix) |
| No persistence, no implied async workflow | `route.test.ts`: "never includes an analysisId, phase, or clarificationRound" |
| No real photo/Gemini access | `git diff ae0f68d..HEAD -- "src/app/api/v1/uploads" "src/app/api/v1/image-analyses" src/lib/image-analysis-provider-gemini.ts`: empty output |
| `/milestone9` not reused or modified | `git diff ae0f68d..HEAD -- src/app/milestone9/`: empty output |
| No authentication changes | `git diff ae0f68d..HEAD -- src/lib/session-auth.ts src/lib/billing-session-auth.ts src/lib/milestone1-store.ts src/lib/auth-persistence.ts`: empty output |
| No new persistence | `git diff ae0f68d..HEAD -- prisma/`: empty output |
| Existing contracts/routes unchanged | `AnalysisRequest`/`AnalysisResponse`/`analysis/start`/`analysis-engine.ts` all byte-identical across the whole M24 range |

## Decisions Frozen in GO-1/GO-2 and Honored Through GO-4

- **Text-based, stateless, no photo, no Gemini**: explicitly confirmed by the user before GO-2 began, argued in GO-1 on cost/risk/no-real-product-UI-to-build-on grounds. Held through GO-4 without deviation.
- **Reuse `analyzeInitial` unchanged**: held throughout. The one real gap found (`reshape` leaking professional terminology) was fixed entirely at the input-validation boundary in the new route, never by touching the shared engine used by real professional users.
- **New, dedicated page instead of touching existing UI**: `Milestone1FoundationPanel` and `Milestone2AnalysisPanel` are both untouched; the only homepage change is one added nav link.

## Residual Risks (real, disclosed -- none block closure)

- **`recommendations`/`safetyNotes` are static text across all 5 accepted goals.** They only vary when `analyzeInitial` generates a `technicalCutPlan` -- the exact branch M24 must never reach for a guest. Only `followUpQuestions` varies (driven by the engine's internal confidence heuristic). This is an honest reflection of what the real engine computes for non-technical goals, not a shortcut taken in this milestone, but it does mean the guest preview demonstrates less input-sensitivity than an ideal "wow" demo might want. Enriching this would require either changing the shared engine (affects real professional output too) or new guest-specific content logic -- both out of M24's approved scope.
- **No automatic guest-to-account data handoff.** After signing up, a guest must re-enter their preview inputs manually in the real (existing, untouched) analysis flow. This was a deliberate choice to avoid touching `Milestone1FoundationPanel`/`Milestone2AnalysisPanel` in this milestone.
- **No dedicated abuse-monitoring beyond per-IP rate limiting** (20 requests/60s, in-memory, non-distributed -- the same known, already-disclosed limitation as every other rate-limited endpoint in this codebase).

## Confirmation

All closure criteria are proven above with direct evidence, not assumption. Every verification required by GO-4 is green against the full repository, including both real-Postgres and mocked test modes, and including live end-to-end verification against a running dev server. **M24 is CLOSED.**
