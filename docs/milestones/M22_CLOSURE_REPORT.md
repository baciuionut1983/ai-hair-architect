# M22 Closure Report — Honest Video Lesson Persistence

## Status: CLOSED

M22 eliminates the video-lessons subsystem's exact analog of the defect M21 fixed for image analysis: a fully synchronous, in-memory "generation" pipeline that fabricated a script from a hardcoded template, fabricated a video URL pointing at a domain that serves nothing, and immediately marked the row `completed` -- with no real AI generation ever occurring. M22 replaces it with real Postgres persistence and an honest status that never claims processing or completion that didn't happen.

## Problem Eliminated

Before M22, `POST /api/v1/video-lessons/generate` called `createVideoLessonJob` (in-memory, `status: "queued"`) immediately followed, in the same request, by `processVideoLessonJob`, which set `status: "processing"`, overwrote `script` with a 5-line hardcoded template, overwrote `videoUrl` with `https://cdn.ai-hair-architect.local/video-lessons/{id}.mp4` (a fictional domain), and then set `status: "completed"` -- all synchronously, before returning. `"processing"` was never an externally observable state; it existed only inside one function call. A second, entirely dead, untested duplicate of the same pattern (`generateVideoLesson`/`getVideoLessonById` in `milestone4-content.ts`) existed alongside it with zero callers anywhere in the app. The live UI (`Milestone4GrowthPanel`, mounted on the actual homepage) displayed the fabricated script and video URL, and unconditionally showed "Video lesson generated." on any successful response regardless of what was actually returned.

## GO-1 → GO-4 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Read-only audit: full inventory, current-flow documentation, `milestone4-content.ts` dead-code investigation, schema/User-relation verification, proposed `VideoLesson` schema, frozen status/transition decisions, GO-2 allowlist | Read-only, no commit |
| GO-2 | `VideoLesson` Prisma model (additive migration, `onDelete: Restrict` owner FK matching the dominant owned-model pattern) + `video-lesson-repository.ts` (create/getById) + its dual-mode test suite | Commit `f0a05a8` |
| GO-3 | Routes rewritten onto the repository, fake generator removed from `milestone1-store.ts`, dead duplicate removed from `milestone4-content.ts`, analytics count moved off the deleted in-memory array, UI corrected to an honest state, `VideoLessonStatus` extended additively | Commit `caaa434` |
| GO-4 | Full end-to-end regression and this closure report | This package |

Commit chain verified continuous: `46cf6ea` (M21 close) → `f0a05a8` → `caaa434` → GO-4 (this report).

## Final Architecture

```
POST /api/v1/video-lessons/generate
  -> cookie session auth (getSession), unchanged from before M22
  -> findRecommendedLessonIds (real keyword match against academy content, unchanged)
  -> createVideoLessonRecord (video-lesson-repository.ts):
       persists exactly one row: status "not_generated", script null,
       videoUrl null -- never fabricated, never advanced toward a status
       that implies real processing
  -> 201, not idempotent (each call creates an independent row, matching
     pre-M22 behavior on this axis)
  -> zero AI provider invocation

GET /api/v1/video-lessons/[id]
  -> cookie session auth, unchanged
  -> getVideoLessonRecordById (owner-neutral lookup)
  -> single 404 for both "doesn't exist" and "belongs to another owner" --
     the existing convention of this cookie-auth family (clients/[id],
     consultations/[id]), deliberately not the separate 404/403 split used
     by the Bearer-authenticated image-analyses/image-assets family
```

One repository (`video-lesson-repository.ts`) is the sole place a `VideoLesson` row is ever created or read. `VIDEO_LESSON_STATUS_NOT_GENERATED` is the only status M22 code ever writes; `"queued" | "processing" | "completed" | "failed"` remain valid contract values, reserved for a future milestone that adds real generation, so no consumer had to be broken to make this change honest.

## Verification Evidence (GO-4, run against the full repository)

- `git status --short`: clean except the pre-existing, out-of-scope `?? .claude/`.
- `git diff --check`: no errors.
- `npx prisma validate`: schema valid.
- `npm run typecheck`: 0 errors.
- `npm run lint` (full repository): 52 pre-existing problems (14 errors, 38 warnings), identical to the M21 baseline; 0 in any file M22 touched.
- Full Vitest suite, mocked mode: **1538 passed, 90 skipped, 0 failed** (160 files).
- Full Vitest suite, real Postgres: **1535 passed, 93 skipped, 0 failed** (160 files).
- `npm run build`: successful, all routes compiled including `/api/v1/video-lessons/generate` and `/api/v1/video-lessons/[id]`.
- Targeted M22-specific test files run together (repository, both routes, growth-panel-adjacent store test, both analytics tests): **29 passed, 9 skipped, 0 failed** (6 files).

## Closure Criteria — Proof of Each

| Criterion | Proof |
|---|---|
| Zero fictional URLs generated | `grep -rn "ai-hair-architect.local\|videos.ai-hair-architect" src/`: zero matches |
| Zero hardcoded scripts presented as AI results | `grep -rn "Step 1: diagnose baseline\|Step 1: Analyze baseline" src/`: zero matches |
| Zero `completed`/`processing` status without a real result | `grep -rn '"completed"\|"processing"\|"queued"' src/lib/video-lesson-repository.ts src/app/api/v1/video-lessons/`: only match is a code comment explaining why those values are reserved, not emitted |
| Mock and PostgreSQL persistence with identical semantics | `video-lesson-repository.test.ts` dual-mode suite (unitSuite/integrationSuite) exercises the same contract against both; both full-suite runs (1538/1535) are 0-failed |
| Fail-closed ownership verification | `getVideoLessonRecordById` + explicit `record.ownerUserId !== sessionUser.id` check in the route, tested directly (`route.test.ts`: "returns the same 404 ... when the record belongs to another owner") |
| Zero changes to `agents/orchestrate` | `git diff 46cf6ea..HEAD -- src/app/api/v1/agents/orchestrate/`: empty output |
| Zero authentication changes | `git diff 46cf6ea..HEAD -- src/lib/session-auth.ts src/lib/billing-session-auth.ts src/lib/auth-role.ts src/lib/auth-persistence.ts`: empty output; video-lessons routes still use the same cookie + `getSession` mechanism as before M22 |
| Zero real AI integration | `grep -rn "GoogleGenAI\|@google/genai\|gemini" src/lib/video-lesson-repository.ts src/app/api/v1/video-lessons/`: zero matches |
| Zero opportunistic refactors | Every touched file maps directly to the video-lesson migration or a proven, disclosed consequence of it (the analytics count read); academy/marketplace/shortlist code in `milestone4-content.ts` was left untouched |

## Decisions Frozen in GO-1 and Honored Through GO-3

- **Non-breaking contract**: `VideoLessonStatus` gained `"not_generated"` additively; the pre-existing four values were kept rather than removed, per the user's explicit steer toward extensibility over a breaking change.
- **Ownership convention**: resolved by evidence, not invention. The codebase has two internally-consistent but different conventions split by auth family -- Bearer/`session-auth.ts` routes (image-assets, image-analyses) use a 404-then-403 split; cookie/`getSession` routes (clients/[id], consultations/[id]) conflate both into a single 404. Video-lessons stays on cookie auth (auth mechanism unchanged, per scope), so it follows its own family's convention: unchanged, single-404 behavior.
- **`getAnalyticsSnapshotForUser`**: flagged in GO-1 as touching a file outside the "video-lessons" name, implemented in GO-3 as the minimal necessary consequence of deleting `store.videoLessons` -- the video-lesson count moved into the same `countXForOwner`/`Promise.all` pattern the route already used for consultations/appointments/reminders, rather than staying silently pinned to a deleted array.

## Residual Risks (real, disclosed -- none block closure)

- **FK on `VideoLesson.ownerUserId`**: relies on the pre-existing hybrid dual-write in `auth-persistence.ts` (`upsertPersistenceUser` alongside the in-memory `store.users`), which swallows Postgres write failures non-fatally. This is the same inherited risk already accepted by 10 other owned models in the schema, not a new one introduced by M22.
- **`generatedVideoLessonsCount` under `DATABASE_URL` unset**: if Postgres is unreachable, `countVideoLessonsForOwner` throws `VideoLessonPersistenceError`, and the analytics snapshot route now fails closed with a 503 for that case (previously it silently returned 0 from the in-memory array). This is intended fail-closed behavior, not a regression -- an unreachable database was already fatal to the same route's other three counts.
- **`generation_unavailable` UX**: the growth panel now tells the user real generation isn't available yet rather than showing a fake result. No further UI polish (e.g., disabling the generate button) was in scope for M22.

## Confirmation

All closure criteria are proven above with direct evidence, not assumption. Every verification required by GO-4 is green against the full repository, including both real-Postgres and mocked test modes. **M22 is CLOSED.**
