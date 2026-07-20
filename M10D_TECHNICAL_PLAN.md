# M10D TECHNICAL PLAN - Webhook Management and Observability Surface

**Date:** 20 iulie 2026  
**Status:** Planning (awaiting approval)  
**Scope:** Read-only and management surfaces built on top of the webhook foundation delivered in M10

---

## 1. Objective M10D

M10D converts the webhook foundation delivered by M10 into a complete management and observability surface.

The milestone does **not** change delivery execution, retry semantics, secret lifecycle semantics, or terminal-state behavior. Instead, it exposes the stable capabilities already built in M10 through a cohesive set of owner-scoped management APIs and read models so that webhook operators can inspect deliveries, review operational state, rotate secrets, and understand cleanup status without touching the worker pipeline.

The intended outcome is a webhook subsystem that is not only reliable at runtime, but also operationally usable and reviewable.

---

## 2. Scope Included in M10D

### 2.1 Management and Observability API Surface

M10D should expose the existing stable lifecycle services through owner-scoped HTTP routes:

- `POST /api/v1/webhooks/:id/regenerate-secret`
- `GET /api/v1/webhooks/:id/events`
- `GET /api/v1/webhooks/:id/events/:eventId`
- `GET /api/v1/webhooks/:id/operational-snapshot`
- `GET /api/v1/webhooks/:id/secret-versions` is **out of scope for M10D** and deferred to a later milestone if ever needed.

These routes are planned as thin orchestration layers over already stable internal services, not as new persistence or execution systems.

### 2.2 Operational Consumption

UI is explicitly out of scope for M10D. The milestone focuses on backend contracts and service composition only.

### 2.3 Maintenance Visibility

The milestone should make secret rotation and cleanup legible to operators:

- current secret version and rotation history;
- retired versions and retention windows;
- cleanup eligibility and cleanup outcomes;
- delivery history and event-level detail.

### 2.4 Secret Exposure Policy

Plaintext secret exposure follows a strict one-time policy:

- the plaintext secret is returned exactly once, at regeneration time;
- it is never logged;
- it is never audited as a persisted payload;
- it is never emitted to telemetry, tracing metadata, or analytics events;
- responses that carry plaintext secret material must include `Cache-Control: no-store`.

---

## 3. M10D Responsibilities

M10D is responsible for the following concerns:

- expose stable webhook management actions without changing the worker or delivery state machine;
- provide read-only inspection of delivery history and terminal delivery details;
- surface current operational snapshot metrics in a deterministic, owner-scoped format;
- expose secret rotation as an explicit management action over the already implemented rotation service;
- preserve strict ownership boundaries and 404 semantics for cross-user access;
- keep the delivery engine, retry policy, and cleanup semantics unchanged.

What M10D must **not** do:

- no new delivery worker behavior;
- no new retry policy rules;
- no schema changes to delivery state, timestamps, or terminal semantics;
- no refactor of M10A, M10B, or M10C behavior.

---

## 4. Architecture Overview

The M10 architecture already separates webhook concerns into stable layers:

- `WebhookEndpoint` stores the owner-scoped integration configuration.
- `WebhookEndpointSecretVersion` stores the current and retired secret material.
- `WebhookEvent` stores the normalized event envelope.
- `WebhookDelivery` stores the delivery record, state, and terminal timestamp.
- `WebhookDeliveryAttempt` stores execution attempts and their outcomes.
- `webhook-delivery-worker` owns execution, lease claims, retries, and finalization.
- `webhook-delivery-history` provides owner-scoped history and delivery detail queries.
- `webhook-operational-snapshot` provides deterministic operational aggregates.
- `webhook-secret-rotation` performs atomic secret rotation and retirement.
- `webhook-secret-version-cleanup` removes retired versions only after retention and reference checks.

M10D sits on top of this stack and adds a stable management surface that composes these services without reinterpreting their responsibilities.

The intended request flow is:

1. User opens a webhook management view or calls a management API.
2. Route-level authorization confirms the caller owns the webhook.
3. The route delegates to an existing M10 service.
4. The service returns a read model or performs an atomic management action.
5. The route shapes a stable response without mutating delivery semantics.

---

## 5. Existing Stable Infrastructure M10D Reuses

M10D depends on, and should reuse directly, the following M10 components:

- [web/src/lib/webhook-delivery-persistence.ts](web/src/lib/webhook-delivery-persistence.ts)
- [web/src/lib/webhook-delivery-worker.ts](web/src/lib/webhook-delivery-worker.ts)
- [web/src/lib/webhook-delivery-history.ts](web/src/lib/webhook-delivery-history.ts)
- [web/src/lib/webhook-operational-snapshot.ts](web/src/lib/webhook-operational-snapshot.ts)
- [web/src/lib/webhook-secret-rotation.ts](web/src/lib/webhook-secret-rotation.ts)
- [web/src/lib/webhook-secret-version-cleanup.ts](web/src/lib/webhook-secret-version-cleanup.ts)
- [web/src/lib/webhook-delivery-state-machine.ts](web/src/lib/webhook-delivery-state-machine.ts)
- [web/src/lib/webhook-delivery-retry-policy.ts](web/src/lib/webhook-delivery-retry-policy.ts)
- [web/src/lib/webhook-crypto.ts](web/src/lib/webhook-crypto.ts)
- [web/src/lib/webhook-validator.ts](web/src/lib/webhook-validator.ts)
- [web/src/lib/webhook-safe-http-client.ts](web/src/lib/webhook-safe-http-client.ts)

The existing M10 API surface already includes webhook CRUD and test delivery routes under `web/src/app/api/v1/webhooks/*`. M10D should build on those endpoints rather than redesigning them.

### 5.1 Existing Route Contracts

The following routes already exist and are treated as stable inputs for M10D planning:

- `POST /api/v1/webhooks`
  - request: `{ name, url }`
  - response: created webhook record plus plaintext secret on first creation
  - status codes: `201`, `400`, `401`, `403`, `409`, `500`
  - error model: JSON object with `error`, `status`, and `message`

- `GET /api/v1/webhooks`
  - request: query params `limit`, `offset`
  - response: `{ data, pagination }`
  - pagination: offset-based for the existing CRUD surface
  - status codes: `200`, `400`, `401`, `403`, `500`
  - error model: JSON object with `error`, `status`, and `message`

- `GET /api/v1/webhooks/:id`
  - request: path param `id`
  - response: webhook record or `404`
  - status codes: `200`, `401`, `404`, `500`
  - error model: JSON object with `error`, `status`, and `message`

- `PATCH /api/v1/webhooks/:id`
  - request: path param `id`, body containing mutable webhook fields
  - response: updated webhook record
  - status codes: `200`, `400`, `401`, `404`, `409`, `422`, `500`
  - error model: JSON object with `error`, `status`, and `message`

- `DELETE /api/v1/webhooks/:id`
  - request: path param `id`
  - response: no content
  - status codes: `204`, `401`, `404`, `500`
  - error model: JSON object with `error`, `status`, and `message` when not successful

- `POST /api/v1/webhooks/:id/test`
  - request: path param `id`
  - response: test delivery outcome object with success or failure state
  - status codes: `200`, `401`, `404`, `409`, `500`
  - error model: JSON object with `error`, `status`, and `message`

The M10D review should preserve these contracts unless an explicit follow-up milestone says otherwise.

---

## 6. Data Model Impact

### 6.1 What Already Exists

M10D should treat the following as stable and reusable:

- `WebhookEndpoint`
- `WebhookEndpointSecretVersion`
- `WebhookEvent`
- `WebhookDelivery`
- `WebhookDeliveryAttempt`

The existing indexes already support the most important management reads:

- owner + createdAt for ordered event and endpoint reads;
- owner + status + nextAttemptAt for queue-style delivery access;
- owner + failedTerminalAt for terminal-failure metrics;
- owner + retainUntil for secret cleanup;
- secretVersionId for reference checks and cleanup safety.

### 6.2 Expected M10D Data Model Impact

M10D should not require new tables or changes to the delivery state model.

If review finds a gap, the preferred response is a minimal additive index only. The default plan is no schema migration.

---

## 7. Planned API Surfaces

M10D is expected to expose the following stable management surfaces, all owner-scoped and read-safe unless explicitly mutating a secret version.

- `POST /api/v1/webhooks/:id/regenerate-secret`
  - request: path param `id`, no request body required;
  - response: `{ webhookEndpointId, secretVersionId, secretVersion, rotatedAt, retiredPreviousVersionAt, previousVersionRetainUntil, plainSecret }`;
  - status codes: `200`, `401`, `404`, `409`, `500`;
  - error model: JSON object with `error`, `status`, and `message`;
  - pagination: not applicable.

- `GET /api/v1/webhooks/:id/events`
  - request: path param `id`, query params `cursor`, `limit`, and optional `status` filter if supported by the underlying read model;
  - response: `{ data, pageInfo }` with delivery history items and a next-cursor token when more results exist;
  - pagination: cursor-based, ordered by `createdAt DESC`, with a stable secondary ordering on `id DESC` for tie-breaking;
  - status codes: `200`, `401`, `404`, `400`, `500`;
  - error model: JSON object with `error`, `status`, and `message`.

- `GET /api/v1/webhooks/:id/events/:eventId`
  - request: path params `id` and `eventId`;
  - response: a single delivery detail object with event context and ordered attempts;
  - pagination: not applicable;
  - status codes: `200`, `401`, `404`, `500`;
  - error model: JSON object with `error`, `status`, and `message`.

- `GET /api/v1/webhooks/:id/operational-snapshot`
  - request: path param `id` and optional `now` context only if explicitly supported by the implementation review;
  - response: a single snapshot object with active counts, success rate, recent volume, latency, and retry distribution;
  - consistency model: transaction snapshot of the current persisted delivery state at read time, not a long-lived eventually consistent projection;
  - status codes: `200`, `401`, `404`, `500`;
  - error model: JSON object with `error`, `status`, and `message`.

- `POST /api/v1/webhooks/:id/regenerate-secret` and the existing secret lifecycle services are the only secret-management surface in M10D.

These routes are intentionally read-first and management-oriented. They are not a second worker, a second retry engine, or a second persistence model.

---

## 8. M10D Flows

### 8.1 Secret Rotation Flow

1. Owner requests secret rotation for a webhook.
2. Route validates ownership and endpoint state.
3. Route calls `rotateWebhookSecret`.
4. Service retires the current version, creates a new current version, and updates the endpoint compatibility secret.
5. Route returns the new plaintext secret exactly once.

### 8.2 History Flow

1. Owner requests delivery history for a webhook endpoint.
2. Route validates ownership.
3. Route calls `listWebhookDeliveryHistory` or `getWebhookDeliveryDetails`.
4. Route returns a cursor-paginated, owner-scoped view ordered by `createdAt DESC` with a stable `id` tie-breaker and attempts ordered by `attemptNumber ASC`.

### 8.3 Snapshot Flow

1. Owner requests the operational snapshot for a webhook endpoint.
2. Route validates ownership.
3. Route calls `getWebhookOperationalSnapshot`.
4. Route returns a transaction snapshot of deterministic counts and recent-interval metrics derived from delivery state at read time.

### 8.4 Cleanup Visibility Flow

1. An internal maintenance job or operator-triggered inspection requests cleanup status.
2. Route or job calls `cleanupRetiredWebhookSecretVersions`.
3. Service evaluates retired versions into explicit states: `eligible`, `retained`, `referenced`, `deleted`, or `failed`.
4. Cleanup result is reported without altering delivery semantics.

---

## 9. Why No Refactor Is Needed

M10D does not need a refactor of the M10 infrastructure because the core invariants are already in the correct shape:

- the delivery model already separates event, endpoint, secret version, delivery, and attempt;
- the worker already owns execution and terminalization logic;
- the history and snapshot services already produce owner-scoped read models;
- the secret lifecycle already has atomic rotation and safe cleanup boundaries;
- the existing indexes already align with the intended management reads;
- the terminal timestamp is already stabilized in official finalization paths.

Refactoring any of these layers would not reduce risk; it would only expand the change surface. M10D should therefore remain an additive milestone that composes the existing foundation.

---

## 10. Risks

### 10.1 Product and Scope Risks

- Scope creep into delivery engine behavior or retry rules.
- Mixing read-model work with execution-path changes.
- Overlapping M10D management work with the already stable M10 worker and persistence contracts.

### 10.2 Technical Risks

- Owner-scoped endpoints can become expensive if pagination or filters are too broad.
- Secret rotation must preserve atomicity and avoid exposing the secret more than once.
- Cleanup visibility must not imply deletion of referenced or in-flight secrets.
- Existing harness instability can reappear if broad integration suites are run together instead of in isolated groups.

### 10.3 Operational Risks

- New management routes may be mistaken for delivery-plane writes if they are not clearly separated.
- Metrics exposed by snapshots can be misread as historical reporting; M10D must be explicit that these are operational snapshots, not a time-series system.

### 10.4 Review Risks

- Adding a schema migration or new endpoint before explicit architecture approval would expand the change surface and is not allowed in M10D planning.
- Introducing a second secret listing surface would duplicate responsibilities already covered by the existing secret lifecycle services.

---

## 11. Acceptance Criteria

M10D is acceptable when all of the following are true:

- existing M10A, M10B, and M10C behavior remains unchanged;
- webhook ownership checks continue to return 404 for cross-user access;
- secret rotation is exposed as a stable management action and returns plaintext once only;
- delivery history and delivery details are available in owner-scoped, paginated form;
- operational snapshot data is available and consistent with the persisted delivery state;
- cleanup status for retired secret versions is exposed without deleting active references;
- no new delivery engine, retry engine, or state-machine behavior is introduced;
- no schema migration is added without explicit approval in architecture review;
- all relevant webhook test suites and regressions continue to pass.

---

## 12. Test Strategy

M10D should be validated with focused tests that prove composition rather than re-implementation:

- unit tests for new route orchestration and ownership checks;
- integration tests for history, snapshot, rotation, and cleanup visibility;
- regression tests proving that M10A/B/C behavior and metrics remain unchanged;
- authorization tests confirming 404 cross-user behavior;
- secret regeneration tests proving plaintext is exposed exactly once and never on repeat fetches or follow-up reads;
- operational snapshot tests proving the response matches the internal service result for the same read window;
- no tests that require changing the worker engine or delivery state machine.

---

## 13. Readiness Assessment

The webhook infrastructure is ready for M10D.

M10 already provides the stable persistence, worker execution, lifecycle services, terminal timestamp semantics, and operational metrics needed for the next milestone. M10D can therefore focus on a safe, additive management and observability surface without reworking the foundation.

---

**Plan Status:** complete and awaiting approval before implementation begins.

**Next Step:** architectural review and approval of M10D scope.