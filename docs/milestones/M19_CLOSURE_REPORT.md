# M19 Closure Report — Real Stripe Checkout Activation

## Status: CLOSED (pending final commit approval for GO-4)

M19 replaces the fully simulated `checkout`/`subscription` routes (in-memory `milestone1-store`, no external provider) with a real, Stripe-authenticated checkout flow backed by the durable billing persistence and webhook processing built in M17, canonical `Authorization: Bearer` + `prisma.session` authentication with strict `expiresAt` validation, an unambiguous `entitlementActive` access signal, a fail-closed production readiness gate for checkout, and a controlled removal of the now-dead legacy billing primitives.

## GO-1 → GO-4 Chain

| Package | Scope | Outcome |
|---|---|---|
| GO-1 | Stripe Checkout config + adapter: fail-closed `resolveBillingCheckoutConfig`, `createBillingCheckoutAdapter` seam (`StripeCheckoutClient`, injectable, zero live Stripe calls in tests) | Commit `5ace461c625b2e4e58742102c987853e2c1b421b` |
| GO-2 | Webhook processing for `checkout.session.completed`: fail-closed validation, `findOrCreateBillingCustomer` made transaction-safe (SAVEPOINT), provisional `incomplete` status (never `active`) so only `customer.subscription.created/updated` can ever confirm real entitlement | Commit `59d47f7ef098e9f0677e17883c65184194704aea` |
| GO-3 | Real checkout/subscription routes: canonical Bearer+`prisma.session` auth with strict `expiresAt`, real Stripe Customer/Checkout Session creation, `entitlementActive` allowlist semantics (corrected mid-package after review) | Commit `a8a34ac91b330f089008bf11051c8a120cb7ca59` |
| GO-4 | Checkout production readiness (`BILLING_CHECKOUT_READY`), removal of dead legacy billing primitives (`createPaymentRecord`), this closure report | This package — commit pending approval |

Commit chain verified continuous: `9a6b35f` (M18 close) → `5ace461` → `59d47f7` → `a8a34ac` → GO-4 (pending). Zero scope leakage into M13–M18, storage, AI, or unrelated routes at any point in the chain.

## Final Stripe Checkout Flow, End to End

1. **Checkout initiation** (`POST /api/v1/billing/checkout`): caller authenticates via `Authorization: Bearer <token>` only; body contributes exactly one trusted value, `plan`. Every other client-supplied field (owner id, Stripe customer/session id, raw price id, redirect URLs, a claimed status) is never read.
   - `plan === "free"`: zero Stripe calls, synchronous canonical response (`plan: "free", status: "inactive", entitlementActive: false`).
   - `plan` paid: `resolveBillingCheckoutConfig()` gates fail-closed (disabled/invalid → 503) → existing `BillingCustomer` reused, or a real Stripe Customer is created only if none exists yet, via the injectable adapter seam from GO-1 → a real Stripe Checkout Session is created with the price id resolved server-side and `client_reference_id`/`metadata.ownerUserId`/`metadata.plan`/`subscription_data.metadata.*` set from the authenticated owner — never from the client. Response carries only `{checkout: {provider: "stripe", url}}`; no subscription snapshot is invented before Stripe confirms anything.
2. **Webhook processing** (`POST /api/v1/billing/webhook`, unchanged route from M17, extended processor from GO-2): Stripe signature verified via the official SDK against the raw body; `checkout.session.completed` is validated fail-closed (correlated `client_reference_id`/`metadata.ownerUserId`, valid plan, present customer/subscription ids) and persists the `BillingCustomer` link plus a `BillingSubscription` row with status `incomplete` — never `active` — inside the same atomic, idempotent, ordering-guarded transaction as every other supported event.
3. **Authoritative status**: only `customer.subscription.created`/`customer.subscription.updated`/`customer.subscription.deleted` (already supported since M17) ever write a real Stripe-confirmed status, applied through the same ordering guard, correctly superseding the provisional `incomplete` row regardless of delivery order.
4. **Subscription read** (`GET /api/v1/billing/subscription`): same Bearer auth; reads `BillingSubscription` by owner (`getSubscriptionByOwner`, newest by `updatedAt`), entirely independent of `milestone1-store`.

## Canonical Authentication

`web/src/lib/billing-session-auth.ts` (GO-3): reads `Authorization: Bearer <token>` exclusively — no cookie, no `milestone1-store` fallback. Resolves the token against `prisma.session`, requires `expiresAt` **strictly** in the future (rejects the exact-boundary case, unlike the pre-existing `findPersistenceUserBySessionToken` helper), and requires a valid joined `user`. Any failure (missing token, missing session, expired session, missing user, or an unexpected lookup error) resolves to `null` — the route then returns 401 before any Stripe call or billing write is possible. This is a new, stricter helper; it intentionally does not modify the M17/M18 Bearer routes that still lack an `expiresAt` check (see Known Risk below).

## `entitlementActive` Semantics

Allowlist, not a denylist: `entitlementActive = status === "active" || status === "trialing"`. Every other known status (`past_due`, `canceled`, `unpaid`, `paused`, `incomplete`, `incomplete_expired`) — and any status this code does not yet recognize — falls closed to `entitlementActive: false`. The real `plan`/`status` remain visible in the response for UI/informational purposes; `entitlementActive` is the single field any consumer must check to decide paid access. Verified the one existing caller (`milestone5-hardening-panel.tsx`) only displays these fields as text and makes no access decision from them.

## `free` Plan Behavior

Fully synchronous, zero Stripe calls, zero billing-table reads or writes. Both the checkout route's free branch and the subscription route's no-row/unrecognized-plan fallback return the identical canonical shape: `{plan: "free", status: "inactive", entitlementActive: false}`.

## Environment Variables (real Stripe Checkout)

| Variable | Required when | Purpose |
|---|---|---|
| `BILLING_PROCESSING_MODE` | always | must be exactly `"enabled"` for checkout (not merely `"webhook_only"`) |
| `STRIPE_SECRET_KEY` | mode `enabled` | Stripe API key used to create real Customers and Checkout Sessions |
| `STRIPE_PRICE_PRO` | mode `enabled` | Stripe Price id for the `pro` plan |
| `STRIPE_PRICE_SALON` | mode `enabled` | Stripe Price id for the `salon` plan |
| `STRIPE_PRICE_BUSINESS` | mode `enabled` | Stripe Price id for the `business` plan |
| `APP_BASE_URL` | mode `enabled` | server-controlled base URL used to build `success_url`/`cancel_url`; never taken from the client or from request headers |

All six are validated in exactly one place, `resolveBillingCheckoutConfig` (`billing-checkout-config.ts`), extended in GO-4 to include `APP_BASE_URL` so the checkout route and the readiness signal can never drift apart.

## Readiness

`web/src/lib/billing-checkout-readiness.ts` (new, GO-4): `evaluateCheckoutReadiness(env)` wraps `resolveBillingCheckoutConfig` and returns exactly one of `disabled` / `invalid` / `ready`. `invalid` carries the underlying `issues` array (variable names and fixed messages only — never a secret value). Exposed as a new critical check, `BILLING_CHECKOUT_READY`, in the existing `/api/v1/ops/readiness` aggregator (`production-guards.ts`), alongside the untouched `BILLING_WEBHOOK_AUTHENTICITY_READY` check from M17. No Stripe API call and no database probe are performed during readiness evaluation.

## Legacy Cleanup

| Primitive | Callers found (grep, before any edit) | Action |
|---|---|---|
| `createPaymentRecord` | only `milestone5-billing.test.ts` | **Removed**, along with the now-orphaned `payments` store field/initializer and the unused `PaymentRecord` import |
| `getSubscriptionForUser` | internal (`updateSubscriptionForUser`) + `milestone5-billing.test.ts` | **Kept** — see below |
| `updateSubscriptionForUser` | `milestone5-billing.test.ts` + `milestone6-analytics.test.ts` | **Kept** — real remaining caller |

`updateSubscriptionForUser` (and by extension `getSubscriptionForUser`, which it calls internally) is retained because `milestone6-analytics.test.ts` still depends on it to seed `store.subscriptions` for testing the **still-live** `getAnalyticsSnapshotForUser`, imported by the real `/api/v1/analytics/snapshot` route. Removing it would have required modifying test infrastructure for a function entirely outside M19's scope, which the authorization explicitly prohibited. `milestone5-billing.test.ts` — which tested only the three now-superseded primitives — was deleted in full rather than partially edited, since nothing in it remained meaningful once `createPaymentRecord` was gone.

Login, general sessions (`createSession`/`getSession`/`revokeSessionToken`), and every other `milestone1-store.ts` export were not touched.

## Verifications Executed

- GO-4-scoped tests: `billing-checkout-config.test.ts` (13), `billing-checkout-readiness.test.ts` (7, new), `production-guards.test.ts` (13), `checkout/route.test.ts` (13), `subscription/route.test.ts` (14), `milestone6-analytics.test.ts` (1) — **61/61 passed**.
- Full repository regression suite: **1460/1460 passed, 70 skipped, 0 failed** (151 test files).
- `npm run typecheck`: 0 errors.
- ESLint, scoped to every GO-4 file: 0 errors, 0 new warnings (3 pre-existing unrelated warnings in `milestone1-store.ts`, shifted line numbers only).
- `npm run build`: successful.
- `npx prisma validate`: schema valid (no migration needed — GO-4 touches no Prisma model).
- `git diff --check`: no errors.
- `git status --short`: exactly the 10 GO-4 code files (7 modified, 1 deleted, 2 new) plus this report, no unrelated changes.

## Known Risk: `expiresAt` Not Checked in Other M17/M18 Bearer Routes

`billing-session-auth.ts`'s strict `expiresAt` check is new and applies only to the M19 checkout/subscription routes. The pre-existing Bearer-authenticated routes from M17/M18 (`request-ai-analysis`, `process`, `review`, image-assets `content`/`[id]`, `uploads`) each define their own local `getAuthenticatedUser` and **do not** verify `expiresAt` at all — a session row that has already expired would still authenticate successfully on those routes. This was identified during M19's authentication-convergence analysis, explicitly deferred by design (fixing it there was out of scope for M19, which required only that the *new* routes be correct), and remains open technical debt. Recommended as a dedicated, narrowly-scoped hardening package: add the same strict `expiresAt` check to each of those routes' local session helpers, with no other behavior change.

## Other Remaining Limitations

- **Provisional `incomplete` status window**: between `checkout.session.completed` and the confirming `customer.subscription.created`/`updated` event, a `BillingSubscription` row exists with `entitlementActive: false`. No code path currently reads this table for feature gating, so this is not exploitable today; it is noted for whichever future milestone adds real feature gating.
- **`milestone5-hardening-panel.tsx`** still posts to `/api/v1/billing/webhook` using the old simulated `BillingWebhookEvent` contract shape, which the real GO-2 processor does not accept. This UI panel was already stale before M19 and updating it was not requested or in scope; it is a demo/QA panel, not a production consumer.
- **Local price/plan consistency**: Stripe Prices should be configured with `lookup_key` values matching `pro`/`salon`/`business` so `resolvePlanKey`'s derivation for `customer.subscription.*` events (M17) stays consistent with the `metadata.plan` value GO-2/GO-3 write at checkout time. Not enforced in code; an operational setup step (see below).

## Operational Steps to Configure Stripe in Production

1. Create three Stripe Prices (recurring), one per paid plan, each with a `lookup_key` of `pro`, `salon`, `business` respectively.
2. Set `STRIPE_SECRET_KEY` to a live (`sk_live_`/`rk_live_`) key — a test-mode key is rejected in production by the existing webhook readiness check (M17) and should be treated the same way operationally for checkout.
3. Set `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SALON`, `STRIPE_PRICE_BUSINESS` to the three Price ids from step 1.
4. Set `APP_BASE_URL` to the application's real public base URL (e.g. `https://app.example.com`), used only to build `success_url`/`cancel_url` server-side.
5. Set `BILLING_PROCESSING_MODE=enabled` (not `webhook_only`) — this is the single switch that activates real checkout on top of the already-required webhook configuration from M17 (`STRIPE_WEBHOOK_SECRET`, etc.).
6. Confirm `GET /api/v1/ops/readiness` reports `BILLING_CHECKOUT_READY: PASS` alongside `BILLING_WEBHOOK_AUTHENTICITY_READY: PASS` before enabling customer-facing checkout traffic.

## Confirmation

M19 is ready to close pending the final GO-4 commit approval. All four packages (GO-1–GO-4) are scoped, tested, and verified independently and in combination; the simulated checkout/subscription flow is fully replaced; the two intentionally-deferred items (`expiresAt` hardening for other routes, AI-provider integration) remain open for future, separately-authorized milestones.
