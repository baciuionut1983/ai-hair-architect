# M20 Closure Report — Bearer Session Hardening

## Status: CLOSED (pending final commit approval for GO-3)

M20 closes an explicitly-deferred security gap from M19: seven Bearer-authenticated routes each defined their own local session-lookup function that resolved `prisma.session` without ever checking `expiresAt`, meaning an expired (though not yet deleted/revoked) session token continued to authenticate successfully. M20 replaces all seven local copies with one canonical, generic helper and proves — per route, with tests — that an expired session now fails closed before any business logic, storage, or repository access.

## GO-1 → GO-3 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Read-only audit: confirmed the exact 7 affected routes, their byte-identical implementation, the Prisma `Session` schema/semantics, revocation behavior, and the canonical-helper recommendation | Read-only, no commit |
| GO-2 | New generic helper `session-auth.ts` + hardening for the 4 image-analysis routes (`request-ai-analysis`, `process`, `review`, `image-analyses/[assetId]`) | Commit `ca28a17e7c9fc0c7f69733fe589b6dbeded5a361` |
| GO-3 | Hardening for the 3 remaining assets/upload routes (`image-assets/[id]`, `image-assets/[id]/content`, `uploads`) + this closure report | This package — commit pending approval |

Commit chain verified continuous: `86dd177` (M19 close) → `ca28a17` → GO-3 (pending).

## The 7 Hardened Routes

1. `web/src/app/api/v1/image-analyses/[assetId]/request-ai-analysis/route.ts` (GO-2)
2. `web/src/app/api/v1/image-analyses/[assetId]/process/route.ts` (GO-2)
3. `web/src/app/api/v1/image-analyses/[assetId]/review/route.ts` (GO-2)
4. `web/src/app/api/v1/image-analyses/[assetId]/route.ts` (GO-2)
5. `web/src/app/api/v1/image-assets/[id]/route.ts` (GO-3)
6. `web/src/app/api/v1/image-assets/[id]/content/route.ts` (GO-3)
7. `web/src/app/api/v1/uploads/route.ts` (GO-3)

Each previously carried an identical, independently-defined local `getAuthenticatedUser` (confirmed via grep in GO-1, byte-for-byte the same across all 7) that extracted the Bearer token, looked up `prisma.session` with `include: {user: true}`, and returned the user with **no `expiresAt` check at all**. All 7 now import and call the shared helper instead; no other behavior (role checks, rate limits, ownership checks, storage access, upload/business logic, response shapes) was touched.

## Canonical Helper: `web/src/lib/session-auth.ts`

```ts
authenticateSessionUser(request: Request): Promise<{ id, email, role, locale } | null>
```

- Extracts the Bearer token from `Authorization` only; rejects a missing header, a non-Bearer scheme, or an empty token.
- Looks up `prisma.session.findUnique({ where: { token }, include: { user: true } })`.
- **`expiresAt` semantics: `session.expiresAt.getTime() > Date.now()` — strictly greater than.** A session expiring at exactly the current instant is rejected, not accepted; tested explicitly at that exact boundary.
- Returns only `{id, email, role, locale}` — never `passwordHash`, `createdAt`, or any other Prisma `User` field; verified by a dedicated test asserting the exact key set.
- Introduces no global cache and never deletes the session row itself — authentication simply fails closed; any error during the lookup (e.g. database unavailable) is caught and also resolves to `null`.
- Deliberately generic: no billing semantics, no dependency on or coupling to `billing-session-auth.ts`.

## Revocation Behavior (confirmed read-only in GO-1, unchanged by this milestone)

Session revocation in this codebase deletes the `prisma.session` row outright (`revokePersistenceSessionToken` / `revokeSessionToken`); the `Session` model carries no separate `revoked`/`active` field. A revoked session is therefore indistinguishable from a session that never existed, and was already handled correctly by every route prior to M20 (a `findUnique` miss resolves to `null`). M20 did not need to — and did not — introduce any new revocation mechanism.

## Verifications Executed (GO-3, final)

- Helper tests (`session-auth.test.ts`): 11/11 passed (carried over from GO-2, unmodified).
- The 3 GO-3 route test suites: `image-assets/[id]/route.test.ts` 7/7, `image-assets/[id]/content/route.test.ts` 26/26 (18 pre-existing + expired-session addition), `uploads/route.test.ts` 6/6 — all passed, each covering: valid session preserves existing behavior; expired session → 401 with zero calls into the asset lookup, storage resolver, or upload service; missing token → 401; unknown session → 401; ownership/role regression; response shape unchanged.
- Full repository regression suite: **1502/1502 passed, 70 skipped, 0 failed** (156 test files).
- Real-Postgres test suites confirmed active in this environment and included in the above (no dedicated real-Postgres variant exists for these 7 routes specifically — their auth logic is proven at the unit level; the full-suite run proves zero regression elsewhere).
- `npm run typecheck`: 0 errors.
- ESLint, scoped to every file touched across GO-2 and GO-3: 0 errors, 0 warnings.
- `npm run build`: successful.
- `npx prisma validate`: schema valid (M20 makes no schema changes).
- `git diff --check`: no errors.
- `git status --short`: exactly the files in each GO's approved allowlist, no unrelated changes.

## Deliberately Out of Scope

- **`web/src/middleware/analytics-auth.ts`** — already checks `expiresAt` (and even deletes the expired row on detection); used by ~10 live routes (webhook management API, `audit/logs`, `analytics/metrics`/`export`). Has only a theoretical boundary quirk (`<` instead of strict `>`), not a real gap. Left untouched.
- **`web/src/lib/billing-session-auth.ts`** — the M19 billing-specific equivalent of this milestone's helper, already strict and already tested. Left untouched rather than refactored to delegate to `session-auth.ts`, to avoid re-touching an already-closed, verified file for zero net risk reduction. A future optional cleanup could consolidate the two; not part of M20.
- **`web/src/lib/auth-role.ts`'s `withRoleCheck`** — has the identical missing-`expiresAt` gap, but has zero callers anywhere in the codebase and is not covered by any test; confirmed dead code. Left untouched; flagged here for visibility rather than fixed, since fixing unreachable code carries no security benefit and is not proportionate to a narrowly-scoped hardening milestone.
- **Two concurrent AI image-analysis paths** (`/api/v1/uploads` still hardcodes the `mock-deterministic` provider synchronously, while the separate consent-gated `request-ai-analysis`/`process`/`review` flow uses the real Gemini provider from M18) — a real product-correctness question requiring a product decision, explicitly deferred to a candidate **M21**, not addressed here.

## Confirmation

M20 is ready to close pending the final GO-3 commit approval. All three packages (GO-1–GO-3) are scoped, tested, and verified independently and in combination; all 7 identified routes reject expired sessions before reaching any business logic; nothing outside the approved allowlists was modified in any package.
