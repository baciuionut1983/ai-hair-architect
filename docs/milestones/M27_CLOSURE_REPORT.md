# M27 Closure Report — Hair Recommendation Engine (Color + Treatment)

## Status: CLOSED

M27 completes the MVP's own explicit scope (PRODUCT_ARCHITECTURE.md §9.1: "Basic color, haircut, and treatment recommendations") by adding a Color Recommendation Engine and a Treatment Recommendation Engine, unified with the pre-existing Haircut engine under one shared architecture instead of three independent systems. No external AI was introduced anywhere in this milestone.

## Problem Addressed

The post-M26 global audit found that 2 of the 3 recommendation categories the product's own MVP definition requires were entirely unbuilt: only a haircut rule engine (`cutting-plan-engine.ts`, M8) existed. "AI Hair Architect" without color or treatment guidance covered roughly a third of its own namesake value proposition. This was identified as the single gap most directly contradicting the product's own MVP definition, ahead of every other candidate (client-data durability, billing enforcement, marketplace completeness).

## GO-1 → GO-4 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Read-only architecture design: full inventory of the existing haircut engine, common-vs-domain-specific analysis, proposed unified `BaseRecommendationPlan` foundation, contracts, domain rules, GO-2/3/4 split, extensibility analysis | Read-only, no commit |
| GO-2 | `recommendation-engine-shared.ts` (extracted verbatim from the haircut engine, behavior-neutral) + Color engine, isolated and unconnected + additive migration (all 6 M27 columns in one pass) + repository `colorPlan` support | Commit `44299b1` |
| GO-3 | Treatment engine + wiring both engines into `analyzeInitial`/`analyzeWithClarifications` + route/contract updates + a real regression found and fixed (see below) | Commit `f0603b4` |
| GO-4 | Full regression, live end-to-end verification against a running dev server and real Postgres, this closure report | This package |

Commit chain verified continuous: `cca926e` (M26 close) → `44299b1` → `f0603b4` → GO-4 (this report).

## Final Architecture

```
recommendation-engine-shared.ts: BaseRecommendationPlan (stylistExplanation,
  clientExplanation, professionalReason, warnings, contraindications,
  assumptions, missingData, confidence, notes, stylistValidationDisclaimer,
  version), calculateRecommendationConfidence (the haircut engine's original
  formula, extracted verbatim), dedupe, readable.

Three domain engines, same shouldGenerateX/generateX contract:
  cutting-plan-engine.ts  (M8, refactored to import the shared module --
                            zero behavior change, proven by diff + unchanged
                            test file still passing)
  color-plan-engine.ts    (M27 GO-2) -- fires on goal cover/lighten or an
                            explicit desiredColorResult/grayPercentage signal
  treatment-plan-engine.ts (M27 GO-3) -- fires on goal treat or an explicit
                            treatmentGoalDetail/scalpCondition signal

analyzeInitial (analysis-engine.ts) is the single orchestrator: checks all
  three shouldGenerateX predicates, calls whichever fire, merges each into
  the flat recommendations/safetyNotes arrays (haircut first, so
  recommendations[0] is unchanged from pre-M27 behavior whenever
  technicalCutPlan fires) and exposes each full structured plan under its
  own field. The three engines are independently triggered -- a Color plan's
  warnings may recommend Treatment first, but nothing auto-generates a plan
  the caller's input didn't itself request (explicit test coverage).

Persistence: Analysis gains 6 additive, nullable columns (colorPlan,
  desiredColorResult, grayPercentage, treatmentPlan, scalpCondition,
  treatmentGoalDetail), same fail-closed JSON validation pattern as the
  pre-existing technicalCutPlan. Clarify rounds now carry colorPlan/
  treatmentPlan forward unchanged, identically to technicalCutPlan.

Role gate: the existing professional/salon-only gate on technicalCutPlan
  now extends to colorPlan/treatmentPlan, reusing shouldGenerateColorPlan/
  shouldGenerateTreatmentPlan directly so the gate can never drift from
  what analyzeInitial actually generates.

Safety design (Color engine): a single unconditional clamp, applied after
  every rule branch, guarantees 40vol developer is never selected for
  fragile, damaged, or chemically-treated hair -- regardless of which
  branch chose it first. strandTestRequired is derived from real risk
  factors. Missing critical data degrades to the safest baseline
  (gloss/10vol), never a fabricated precise formula.
```

## Verification Evidence (GO-4, run against the full repository)

- `git status --short`: clean except the pre-existing, out-of-scope `?? .claude/`.
- `git diff --check`: no real errors (only benign CRLF-normalization notices on Windows, matching the M21-M26 baseline).
- `npx prisma validate`: schema valid. No new migration was needed in GO-3 or GO-4 -- GO-2's single migration already covers all 6 M27 columns.
- `npm run typecheck`: 0 errors.
- `npm run lint` (targeted, all M27 files): 0 errors; 2 pre-existing warnings unrelated to M27 (`analysis-repository.ts`'s `_ContractAssertions`, `analysis-repository.test.ts`'s unused `AnalysisDependencyError` import -- both present before M27).
- `npm run build`: successful, all routes compiled.
- Full Vitest suite, mocked mode + real-Postgres integration (since `TEST_DATABASE_URL`/`DATABASE_URL` both point at the same reachable instance in this environment): **1719 passed, 106 skipped, 0 failed** (176 files). Includes 19 Color-engine tests, 13 Treatment-engine tests, 8 `analysis-engine.test.ts` tests (3 pre-existing + 5 new), 14 `analysis-repository.test.ts` tests (mock), 10 real-Postgres `analysis-repository.integration.test.ts` tests, and 45 tests across all 4 `analysis/*` routes.
- **Behavior-neutrality proof for the haircut engine refactor**: `cutting-plan-engine.test.ts` was never modified and still passes unchanged; the full diff of `cutting-plan-engine.ts` is exactly one import line added, one function call renamed at its single call site, and three function bodies removed (moved verbatim into `recommendation-engine-shared.ts`) -- zero rule, string, ordering, or condition changes.
- **Live verification against a real running dev server and real Postgres**: registered and verified a professional test user (M26 flow), created a client, then: (1) submitted a `reshape` analysis and confirmed `technicalCutPlan` output byte-identical in shape to pre-M27 behavior; (2) submitted `lighten` + `desiredColorResult: full_lightening` on `hairCondition: fragile_breakage` and confirmed live `developerVolume: "20vol"` (never 40vol), a real contraindication, and a warning recommending Treatment first; (3) submitted the same request with `hairCondition: virgin_healthy` and confirmed `developerVolume: "40vol"` **is** reachable for genuinely safe hair, proving the safety clamp isn't just universally conservative; (4) submitted `treat` + `treatmentGoalDetail: post_color_recovery` alone and confirmed a treatment-only response (zero colorPlan, zero technicalCutPlan) with the "3-7 days after the chemical service" note present; (5) confirmed a `consumer`-role user receives `403` on both a color-plan and a treatment-plan request; (6) confirmed the guest preview endpoint now rejects `cover`/`lighten`/`treat` with `400` and still returns a clean, leak-free `refresh` preview; (7) fetched the color analysis back via `GET /analysis/:id/result` (fresh request, proving real persistence, not an in-request echo) and confirmed the plan round-tripped exactly; (8) ran a clarify round on the same analysis and confirmed `colorPlan` survived unchanged; (9) queried the Analysis row directly in Postgres and confirmed `desiredColorResult`, `hairCondition`, and the persisted `colorPlan.developerVolume` all matched exactly. All test data (users, clients, analyses, cascaded email notifications) deleted immediately after. No real email was sent (M26's `EMAIL_PROCESSING_MODE` absence, unchanged).

## A Real Regression Found and Fixed During GO-3 Verification

The M24 guest preview route (`analysis/preview`) calls `analyzeInitial` directly and had already excluded `goal: "reshape"` from its accepted set, because that goal alone (with only the 4 basic fields the preview accepts) makes the engine emit professional cutting-plan prose into `recommendations`/`safetyNotes` -- content the guest preview's own contract explicitly promises never to expose to an unauthenticated visitor. Running the preview route's existing test suite after wiring Color/Treatment into `analyzeInitial` immediately caught that `goal: "cover"`, `"lighten"`, and `"treat"` now each alone trigger the same leak via the new engines. Fixed by excluding all four risky goals from the preview's accepted set (`VALID_GOALS` is now `["refresh", "correct"]`, the only two provably safe with just the 4 basic fields) and updating the guest-facing `/preview` page's goal dropdown to match, so a real user is never offered an option the backend will reject. Both the route's and the page's tests were updated accordingly; this is disclosed here in full rather than folded silently into the GO-3 diff.

## Closure Criteria — Proof of Each

| Criterion | Proof |
|---|---|
| Unified architecture, not three independent systems | Single `analyzeInitial` orchestrator; single `BaseRecommendationPlan`/confidence-formula/dedupe/readable foundation in `recommendation-engine-shared.ts`, imported by all three engines |
| Haircut engine behavior provably unchanged | `cutting-plan-engine.test.ts` untouched and passing; diff limited to a mechanical extraction (see Verification Evidence) |
| Never 40vol on fragile/damaged/chemically-treated hair | Unconditional safety clamp in `color-plan-engine.ts`; `color-plan-engine.test.ts` parameterized test across all 3 risky conditions; live-verified against a real request |
| No AI/model output presented as a guaranteed formula | `strandTestRequired` derived from rules, not hardcoded; `stylistValidationDisclaimer` explicit on every plan: "not an exact salon formula" |
| Fail-closed on missing critical data | Unknown `hairCondition` clamps developer volume down and is unit- and live-tested; missing data always degrades to the safest baseline, never a fabricated precise formula |
| No engine auto-invokes another | `analysis-engine.test.ts`: "never auto-generates a treatment plan just because a color plan warns about compromised hair" -- explicit, passing test |
| No AI external, no Gemini pipeline change | Zero new HTTP/model calls anywhere in `color-plan-engine.ts`/`treatment-plan-engine.ts`; `image-analysis-provider-gemini.ts` and `image-analysis-service.ts` untouched (confirmed via `git diff --stat`, not present) |
| No authentication change | `getSession`/role-gate pattern in `analysis/start/route.ts` reused exactly as before; `git diff --stat` shows zero auth-related files touched |
| Minimal, disclosed, strictly additive schema | One migration (GO-2), 6 nullable columns, no defaults, no backfill, zero existing rows touched |
| No make-up/skincare implementation | Zero code for any vertical beyond hair; extensibility discussed in GO-1 only as architectural potential, explicitly deferred to a separately-approved blueprint per PRODUCT_ARCHITECTURE.md §9.8/§12 |

## Decisions Frozen in GO-1/GO-2 and Honored Through GO-4

- **`ai-explainer.ts` left untouched**: both new engines produce complete, deterministic explanations without it, exactly as approved -- confirmed by `git diff --stat` showing zero changes to that file.
- **Milestone2-types.ts extension**: the single disclosed, explicitly re-approved deviation from the original GO-2 allowlist (`colorPlan?: ColorPlan` on `AnalysisCreateRecordInput`) -- verified in GO-2's own report to contain exclusively that one addition; GO-3 extended the same file further (input fields, `treatmentPlan?`) under the same already-established, disclosed pattern.
- **`analysis-engine.ts` untouched in GO-2, modified only in GO-3** exactly as scoped: confirmed via `git diff --stat` per package.
- **Single migration for all 6 columns**, introduced once in GO-2 even though Treatment wasn't wired until GO-3: honored exactly as approved.

## Residual Risks (real, disclosed — none block closure)

- **Domain rule tables are a v1 starting point, not clinically validated cosmetology**: exactly like the pre-existing haircut engine, the Color and Treatment rule tables encode a reasonable, deterministic, professionally-worded first pass, explicitly disclaimed on every plan ("must be validated by a licensed professional at chair-side"). Real-world refinement from licensed-professional review is expected and not yet incorporated.
- **`AnalysisGoal`'s "refresh"/"correct" remain deliberately ambiguous cross-domain goals**: neither alone triggers any of the three engines; a user must supply an explicit domain signal (`targetShape`, `desiredColorResult`, `treatmentGoalDetail`, etc.) to get a plan under those two goals. This mirrors the haircut engine's pre-existing pattern and was a deliberate GO-1 design choice, not an oversight.
- **No UI**: this milestone is API/engine-layer only, consistent with the rest of the repository's current state (flagged repeatedly in prior audits as the largest overall gap, out of scope for M27 specifically).
- **Overall `confidenceScore` vs. per-plan `confidence` remain two independent numbers**, exactly as they already were pre-M27 for `technicalCutPlan` -- not reconciled in this milestone, per the GO-1 decision to avoid conflating global phase-gating confidence with per-domain plan confidence.

## Confirmation

All closure criteria are proven above with direct evidence, not assumption. Every verification required by GO-4 is green against the full repository, including real-Postgres integration tests and a genuine live end-to-end run — haircut regression-free, color with a live-proven safety clamp in both directions, treatment-only isolation, consumer-role gating on all three domains, and a real regression (guest-preview leak) caught and fixed with full disclosure — against a running dev server, with confirmation that no real email was sent and all test data was removed. **M27 is CLOSED.**
