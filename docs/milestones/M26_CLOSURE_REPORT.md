# M26 Closure Report — Email Verification and Password Reset

## Status: CLOSED

M26 makes the account system actually secure at its two weakest points: registration granted a full session to an unproven email address, and there was no way to recover a lost password other than editing the database directly. Both gaps are closed with a strictly additive `AuthToken` model, a mandatory verification gate on login, and a fail-closed, anti-enumeration password reset flow. No MFA, no social login, no change to the two parallel session mechanisms beyond the minimum revocation required for a safe reset.

## Problem Addressed

The post-M25 audit found registration created and returned a working session immediately, with no proof the email address was real or owned by the registrant. There was no password reset path at all — a locked-out user had no self-service recovery. Both were flagged as real security gaps ahead of beta, distinct from every prior milestone's feature-completeness gaps.

## GO-1 → GO-4 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Read-only architecture design: component inventory, discovery of the two parallel session mechanisms (in-memory `getSession()` vs. Postgres-backed `authenticateSessionUser()`), complete verification/reset flow definitions, data model proposal, GO-2/3/4 split | Read-only, no commit |
| GO-2 | `AuthToken` model + `User.emailVerifiedAt` (additive migration with a documented backfill of existing accounts), `auth-token-repository.ts` (issue/find/claim, atomic, composable with an external transaction), complete unit + real-Postgres integration tests | Commit `b3d80d9` |
| GO-3 | Registration stopped granting a session; login gate rejecting unverified accounts; `verify-email`, `resend-verification-email`, `request-password-reset`, `reset-password` routes; 3 new pages; foundation-panel update; complete tests | Commit `68b4625` |
| GO-4 | Full regression, live end-to-end verification against a real running dev server and real Postgres, this closure report | This package |

Commit chain verified continuous: `616fdc8` (M25 close) → `b3d80d9` → `68b4625` → GO-4 (this report).

## Final Architecture

```
AuthToken (Postgres): purpose-scoped, single-use, hash-only
  id, userId, purpose (email_verification | password_reset),
  tokenHash (SHA-256 of a 256-bit random token, unique), expiresAt,
  usedAt, createdAt -- the raw token is never persisted anywhere,
  only emailed once at issuance time.

  issueAuthToken: deletes any prior unused token for the same
    (userId, purpose) before creating the new one, in one transaction
    -- at most one active token per user+purpose ever exists.
  findValidAuthToken: fail-closed lookup; not-found, wrong purpose,
    already-used, and expired all collapse to the same null, with no
    distinction exposed to the caller.
  claimAuthToken: atomic updateMany guarded by usedAt: null, accepts
    an optional transaction client so a caller can bundle the claim
    with the protected write (marking a user verified, changing a
    password) in one all-or-nothing transaction.

User.emailVerifiedAt (Postgres): DateTime?, no column default.
  Migration backfill: existing accounts get emailVerifiedAt = createdAt
  (verified as of when they registered under the rules then in effect)
  -- not the migration's execution time, and not a fabricated event.
  Only accounts created after M26 activates start with null.

Registration (POST /auth/register): creates the account, no session.
  Issues an email_verification token (24h TTL) and sends one
  transactional email (category "security") -- this replaces the old
  welcome email; no second email is sent. Token issuance/send failures
  never block registration (account already exists regardless).

Login (POST /auth/login): unchanged credential check, then a new gate
  -- findEmailVerifiedAtForUser is checked only after the password is
  confirmed valid (a wrong password never leaks verification state).
  Null verifiedAt -> 403 EMAIL_NOT_VERIFIED. A persistence failure
  fails closed with 503, never a silent login.

verify-email (POST): claims the token and sets emailVerifiedAt in one
  transaction -- a token can never be burned without the account
  actually becoming verified, or vice versa.

resend-verification-email / request-password-reset (POST): identical
  generic response regardless of whether the account exists (or, for
  resend, is already verified) -- looked up via the real-Postgres
  findPersistenceUserByEmail, not the process-local in-memory cache,
  so a cold cache never silently no-ops for a genuinely-existing user.
  Rate-limited per ip+email using the repo's existing in-memory
  limiter -- the only anti-abuse control available in this codebase;
  disclosed as a residual risk below, not claimed as distributed
  protection.

reset-password (POST): findValidAuthToken, then one transaction --
  claimAuthToken, tx.user.update(passwordHash), delete any remaining
  unused password_reset tokens (defense in depth), tx.session.deleteMany
  (every Postgres session for the user). After commit, the in-memory
  hybrid store is synced: updateUserPasswordHash + the new
  revokeAllSessionsForUser(userId) (in-memory, scoped by user --
  mirrors logout's existing single-token revocation). No session is
  returned -- the user must sign in again with the new password.
```

## Verification Evidence (GO-4, run against the full repository)

- `git status --short`: clean except the pre-existing, out-of-scope `?? .claude/`.
- `git diff --check`: no real errors (only benign CRLF-normalization notices on Windows, matching the M21-M25 baseline).
- `npx prisma generate` / `npx prisma validate`: client regenerated, schema valid.
- `npm run typecheck`: 0 errors.
- `npm run lint` (full repository): 52 pre-existing problems (14 errors, 38 warnings), identical to the M21-M25 baseline; 0 in any file M26 touched.
- Full Vitest suite, mocked mode: **1669 passed, 106 skipped, 0 failed** (173 files, includes real-Postgres integration suites since `TEST_DATABASE_URL` is present in `.env` and auto-loaded).
- Real-Postgres integration suite for `auth-token-repository.test.ts` run explicitly against `TEST_DATABASE_URL`: **7 passed** (12 mocked-mode tests correctly skipped in this run), including the atomic-rollback-composability test and the FK-cascade test.
- `npm run build`: successful; all 24 M26 files compile, including the 5 new API routes and 3 new pages (`/verify-email`, `/forgot-password`, `/reset-password`, all statically prerendered).
- **Live verification against a real running dev server and the real Postgres database** (`DATABASE_URL` in this environment points at the same instance as `TEST_DATABASE_URL`): a fresh test account was registered through `POST /api/v1/auth/register` (`201`, no session/cookie returned); the database was queried directly and confirmed `User.emailVerifiedAt: null`, one unused `AuthToken` row (`purpose: email_verification`, 24h expiry), and one `EmailNotification` row (`status: "skipped"`) -- proving the full register -> issue-token -> send-email wiring engages end-to-end. `POST /auth/login` with the correct password returned `403 EMAIL_NOT_VERIFIED`. A verification token was minted directly against the same database (same algorithm as `issueAuthToken`, since the raw token is by design never logged or persisted and so cannot be intercepted from the real email flow) and submitted to `POST /auth/verify-email`, which returned `200` and set `emailVerifiedAt`; replaying the same token then correctly returned `400 Invalid or expired verification link.`. `POST /auth/login` then succeeded (`200`, session cookie set) and `GET /auth/me` confirmed the session. `POST /auth/resend-verification-email` returned the identical generic message for the now-verified real account and for a nonexistent one. `POST /auth/request-password-reset` likewise returned an identical generic message for both. A `password_reset` token was minted the same way and submitted to `POST /auth/reset-password`, which returned `200` with no session/cookie; the **old session cookie then returned `authenticated: false`** (proving in-memory revocation engaged live, in the same dev-server process), the old password returned `401`, and the new password returned `200` with a fresh session. Database state afterward confirmed the password hash changed, both tokens marked used, and the Postgres session count net-zero across the reset (1 before -> 0 immediately after -> 1 again only once a fresh login was made). All test data (`User`, cascaded `AuthToken`/`Session`, and `EmailNotification` rows) was deleted immediately after. **No real email was sent**: `EMAIL_PROCESSING_MODE`/`RESEND_API_KEY` remain absent from every env file in this repository (unchanged since M25), so `resolveEmailConfig` resolves to `disabled` and every notification landed as `status: "skipped"`.
- Targeted M26 test files run together as part of the full suite above: register, login, verify-email, resend-verification-email, request-password-reset, reset-password, auth-persistence, and auth-token-repository — **all green**.

## Closure Criteria — Proof of Each

| Criterion | Proof |
|---|---|
| New accounts cannot sign in before verifying | `login/route.test.ts`: "rejects an unverified account with 403 EMAIL_NOT_VERIFIED and never creates a session"; confirmed live against a real freshly-registered account |
| A bad password never leaks verification state | `login/route.test.ts`: "checks verification only after credentials are confirmed valid"; `findEmailVerifiedAtForUser` asserted not called on a failed password check |
| Existing accounts are not retroactively emailed | Migration backfills `emailVerifiedAt = createdAt` directly in SQL for all pre-M26 rows; no email-sending code runs at migration time -- verified by reading the migration and by the GO-2 backfill check (56/56 users verified, 0 emails sent) |
| Exactly one email at registration, not two | `register/route.test.ts`: `sendTransactionalEmail` asserted `toHaveBeenCalledTimes(1)`; no second call exists anywhere in the route |
| Resend/reset never reveal account existence | `resend-verification-email/route.test.ts` and `request-password-reset/route.test.ts`: identical generic message asserted for existing, already-verified, and nonexistent accounts; confirmed live with real HTTP calls |
| At most one active token per user+purpose | `issueAuthToken` deletes any unused token for the same (userId, purpose) before creating the new one, in the same transaction -- proven in `auth-token-repository.test.ts` (both mocked and real-Postgres) |
| Tokens are single-use, purpose-scoped, and never reused | `claimAuthToken`'s guarded `updateMany` (count-checked); `findValidAuthToken` collapses wrong-purpose/used/expired to the same null; live-verified by replaying a consumed verification token and getting `400` |
| Raw tokens never persisted or logged | `hashAuthToken` (SHA-256) is the only thing written to `AuthToken.tokenHash`; `sendTransactionalEmail`'s `createPendingEmailNotification` call never receives the email body/token, only `subject` -- confirmed by reading `email-service.ts` and by the live-verification `EmailNotification` row containing no token material |
| Password reset changes the password in every representation and revokes every session, atomically | `reset-password/route.test.ts`: one `prisma.$transaction` covers the claim, `tx.user.update`, and `tx.session.deleteMany`; a transaction failure is asserted to leave the in-memory store untouched; live-verified end-to-end including the in-memory session dying in the same process |
| No auto-login after reset or verification | Both routes' responses are typed `AuthGenericAckResponse`/`VerifyEmailResponse` with no token field; asserted in both test files; live-verified (`body.token` undefined, no `set-cookie`) |
| No changes outside auth/email and the minimum necessary session-revocation extension | `git diff 616fdc8..HEAD --stat`: exactly 24 files -- schema/migration, `auth-token-repository.ts`+tests, the 6 route files+tests, `contracts.ts`, `milestone1-store.ts` (one new function, `revokeAllSessionsForUser`), `auth-persistence.ts`+new test, the foundation panel, and 3 new pages |

## Decisions Frozen in GO-1 and Honored Through GO-4

- **Two response types, not one nullable one**: `AuthRegisterResponse` is a distinct contract from `AuthSessionResponse` so no consumer can mistake a no-session response for a working session.
- **Backfill semantics**: `emailVerifiedAt = createdAt`, not the migration's execution timestamp — held exactly as designed in GO-1.
- **Verification email replaces the welcome email**: no second email exists in the route; confirmed by test and by the live `EmailNotification` count (exactly one row per registration).
- **Anti-abuse minimum, honestly disclosed**: the existing in-memory, per-process `checkRateLimit` is reused as-is on resend/reset-request; no new distributed rate-limiting infrastructure was invented, per the explicit instruction not to fabricate a false protection.
- **No MFA, no social login, no unrelated session-mechanism refactor**: the only session-layer change is the new `revokeAllSessionsForUser`, an additive, userId-scoped sibling of the pre-existing `revokeSessionToken`, used solely by `reset-password`.

## Residual Risks (real, disclosed — none block closure)

- **Rate limiting is in-memory and per-process**: `checkRateLimit` resets on deploy/restart and does not coordinate across multiple server instances. A distributed attacker spreading requests across IPs or waiting out the 60-second window is not stopped by this alone. Acceptable for the current single-instance deployment; a real production rollout with multiple instances or behind a CDN should add a shared rate-limit store (e.g. Redis) before beta traffic scales up.
- **No live-Resend verification of the M26 email templates specifically**: the same disclosed M25 residual risk applies here — `EMAIL_PROCESSING_MODE`/`RESEND_API_KEY` are not configured in this environment, so the verification and reset emails have never been sent through Resend's real API, only exercised as `status: "skipped"`. The `enabled` code path itself is unchanged from M25 and remains covered by `email-provider.test.ts`/`email-service.test.ts`.
- **Password reset does not check `emailVerifiedAt`**: an account can reset its password even if it never completed email verification (the flow was not scoped to require it, since a user who lost a never-verified account's password still legitimately owns that mailbox). This is a deliberate, minimal-scope choice, not an oversight — no requirement in the approved GO-1 architecture asked for this gate.
- **Inherited hybrid-store risk**: `AuthToken`/`emailVerifiedAt` live only in Postgres (no in-memory shadow, correctly, since these are new fields with no legacy in-memory equivalent), but `findPersistenceUserByEmail` and `findEmailVerifiedAtForUser` still depend on the same Postgres-reachability assumptions already disclosed for every other owned model since M22.

## Confirmation

All closure criteria are proven above with direct evidence, not assumption. Every verification required by GO-4 is green against the full repository, including real-Postgres integration tests and a genuine live end-to-end run — register, reject-unverified-login, verify, login, resend/reset anti-enumeration, and a full atomic password reset with live proof of both session mechanisms being revoked — against a running dev server, with confirmation that no real email was ever sent. **M26 is CLOSED.**
