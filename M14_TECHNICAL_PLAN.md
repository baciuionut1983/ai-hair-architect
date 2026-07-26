# M14 TECHNICAL PLAN - Appointments and Notifications Persistence Convergence

**Date:** 26 iulie 2026
**Status:** Implementation completed - final validation accepted, Git checkpoint pending
**Scope:** PostgreSQL convergence for the existing Appointments, reminders, and in-app Notifications lifecycle

---

## 1. Milestone Objective

M14 will converge the existing Appointments and Notifications lifecycle from process-local memory to PostgreSQL-authoritative persistence.

The milestone closes the remaining `appointments` business-persistence blocker by replacing the in-memory Appointment and Notification arrays with owner-scoped, fail-closed repositories. Appointment creation, listing, client timeline composition, reminder execution, notification listing/read state, analytics counts, backup summary counts, and ops health counts will read from PostgreSQL.

M14 is a production-hardening milestone. It does not add social features, new commercial modules, a new scheduling product surface, or new AI behavior.

### 1.1 Required Outcomes

- PostgreSQL is the only authoritative store for Appointment and Notification records.
- Every read and write is owner-scoped.
- Database absence or failure returns a controlled failure; no memory fallback is allowed.
- Reminder claim, Notification creation, and `reminderSentAt` update are atomic.
- Existing HTTP and TypeScript response contracts remain compatible.
- The `appointments` and `notifications` business-persistence domains become `durable` and `productionReady` together, only after all M14 gates pass.
- M8 production behavior and the AI engine remain unchanged.
- M13 backup schema versions, canonicalization, SHA-256 checksum algorithm, fingerprints, validation, preview, restore, and dispatch remain compatible and unchanged; checksum values may differ because M14 applies the unchanged algorithm to summary payloads containing real Appointment and Notification counts.

### 1.2 Explicit Non-Goals

M14 will not implement:

- appointment update, cancel, reschedule, recurring appointment, or calendar synchronization APIs;
- email, SMS, push-provider, or social notification delivery;
- new billing or commercial behavior;
- distributed job infrastructure beyond the existing owner-triggered reminder route;
- changes to Analysis algorithms, thresholds, recommendation logic, or image analysis;
- a new M13 backup schema version;
- backfill of process-memory records that have no durable source.

---

## 2. Frozen Principles and Compatibility Boundaries

### 2.1 Persistence Principles

- **PostgreSQL authoritative:** successful application responses must reflect committed PostgreSQL state.
- **Owner scoped:** repositories must include `ownerUserId` in reads, writes, counts, updates, and relationship checks.
- **Fail closed:** an unavailable or malformed persistence layer must produce controlled `503` behavior.
- **No fallback memory:** M14 routes and aggregate readers must never fall back to `store.appointments` or `store.notifications`.
- **Single write path:** dual-write and shadow-write modes are prohibited.
- **Deterministic reads:** every ordered query must have an `id` tie-breaker.

### 2.2 M8 Compatibility

M14 does not modify:

- `web/src/lib/analysis-engine.ts`;
- `web/src/lib/analysis-thresholds.ts`;
- `web/src/lib/cutting-plan-engine.ts`;
- M8 upload, image analysis, review, mapper, or finalization production paths;
- Analysis persistence contracts or foreign-key semantics.

M14 may use the existing durable `User` and `Client` ownership model. It must not add a dependency from Appointment or Notification to Analysis.

### 2.3 M13 Compatibility

The following M13 surfaces are frozen:

- backup artifact schema versions `m13.v1`, `m13.v2`, and `m13.v3`;
- section ordering and canonical serialization;
- checksum and fingerprint algorithms;
- artifact validators and byte/row limits;
- preview and restore semantics;
- restore execution ordering and version dispatch;
- restore governance, retention, maintenance, observability, and alert contracts.

M14 changes only the values of the existing `appointmentsCount` and `notificationsCount` summary fields from fixed production zeros to owner-scoped PostgreSQL counts. Appointment and Notification rows are not added to M13 backup artifact sections in M14.

The M13 backup schema versions and checksum algorithm remain unchanged. Because the existing summary fields will contain real values instead of zero, the canonical artifact payload and its resulting checksum value will legitimately change when an owner has Appointment or Notification rows. Tests with fixed artifact or checksum expectations must regenerate the affected fixtures from the unchanged algorithm.

This preserves M13 compatibility but creates an explicit limit: M13 restore does not recreate Appointment or Notification rows. Extending backup coverage requires a separately approved backup-version milestone and must not be hidden inside M14.

---

## 3. Current-State Assessment

### 3.1 Current Appointment Lifecycle

The existing Appointment API provides:

- `GET /api/v1/appointments` with optional `clientId` filtering;
- `POST /api/v1/appointments` for creation;
- owner validation through the current session and durable Client lookup;
- title, start date, reminder offset, reminder type, and notes;
- ascending start-time ordering.

The route currently reads and writes `store.appointments` through `milestone1-store.ts`. Appointments disappear on process restart and are therefore blocked in production by `business-persistence-guards.ts`.

### 3.2 Current Notification and Reminder Lifecycle

The existing lifecycle provides:

- `POST /api/v1/notifications/reminders/run` to scan due Appointments;
- one in-app Notification generated for each due Appointment;
- `GET /api/v1/notifications` ordered newest first;
- `POST /api/v1/notifications/read` to mark selected or all Notifications read;
- `reminderSentAt` as the idempotency marker.

Both the Notification and the idempotency marker currently live in memory. A process restart loses read state and allows reminder behavior to diverge from prior execution.

### 3.3 Current Aggregate Consumers

In-memory Appointment or Notification state currently contributes to:

- client timeline responses;
- analytics snapshot `appointmentsCount` and `remindersSentCount`;
- ops health `appointmentsCount` and `notificationsCount`;
- the legacy `createBackupSnapshot` helper, which derives `appointmentsCount` and `notificationsCount` from the memory store;
- milestone 3, milestone 6, and milestone 7 tests.

The production M13 backup path is separate. `createPersistentBackupSnapshot` currently writes the existing summary fields `appointmentsCount` and `notificationsCount` with the fixed value `0`; it does not read those values from the memory store. M14 will replace those zeros with owner-scoped PostgreSQL counts read inside the existing M13 `RepeatableRead` snapshot transaction.

M14 must migrate these readers in the same convergence. Leaving any production reader on the old arrays would create split-brain reporting.

---

## 4. Final Architecture

### 4.1 Layering

M14 will use the existing route -> repository -> Prisma layering:

1. Route authenticates the current session.
2. Route normalizes and validates request input.
3. Route calls an owner-scoped repository contract.
4. Repository validates durable dependencies and executes the Prisma operation.
5. Repository maps Prisma rows to existing public contracts.
6. Route maps known domain errors to stable HTTP responses.

The new persistence boundary consists of:

- `appointment-repository.ts`: Appointment CRUD subset, counts, and atomic reminder execution;
- `notification-repository.ts`: Notification listing, read-state updates, and counts;
- Prisma `Appointment` and `Notification` models;
- no Appointment or Notification persistence functions in `milestone1-store.ts` after cutover.

### 4.2 Ownership Model

Appointment ownership is enforced structurally:

- `Appointment.ownerUserId -> User.id`;
- `(Appointment.clientId, Appointment.ownerUserId) -> Client(id, ownerUserId)`.

Notification ownership is tied to the originating Appointment:

- `Notification.ownerUserId -> User.id`;
- `(Notification.relatedAppointmentId, Notification.ownerUserId, Notification.relatedClientId)` references the corresponding Appointment candidate key.

No route may infer ownership from an unscoped ID lookup.

### 4.3 Client Deletion Policy

Appointments and Notifications are retained when a Client is soft-deleted because the database relation uses `ON DELETE RESTRICT`, while application reads require an active Client where the product surface is client-oriented.

- New Appointments cannot be created for a soft-deleted Client.
- Appointment list and client timeline hide records whose Client is soft-deleted.
- Notification history remains owner-scoped and retained; it does not make the deleted Client accessible.
- Hard deletion remains blocked while dependent records exist.

### 4.4 Reminder Atomicity and Concurrency

Reminder execution must atomically perform all of the following:

1. select at most `100` due, unsent, owner-scoped Appointments ordered by `startsAt ASC`, then `id ASC`;
2. process each candidate in a Prisma `Serializable` transaction;
3. claim the candidate with a conditional update whose predicate includes `reminderSentAt IS NULL`;
4. create a Notification only when the conditional update reports `count === 1`;
5. set `reminderSentAt` and Notification `createdAt` from the same transaction timestamp;
6. commit both records together or roll back both.

The batch limit is an internal hard maximum of `100` candidates per invocation. It prevents an unbounded transaction workload and is not a new public scheduling or pagination API.

Prisma `P2034`, PostgreSQL serialization failures, and deadlocks are retried with a bounded maximum of three transaction attempts. A concurrent runner that loses the conditional claim returns zero newly created reminders for that candidate; this is a benign race, not a `500`. An unexpected `P2002` unique violation is fail-closed unless a post-conflict owner-scoped read proves that the same Appointment was already completed by a concurrent winner. Retry exhaustion produces a controlled concurrency failure and never falls back to memory.

A concurrent second runner must not create a duplicate Notification, overwrite the first claim timestamp, or report another runner's work as its own.

### 4.5 Failure Model

M14 introduces stable domain errors:

- `APPOINTMENT_PERSISTENCE_UNAVAILABLE` -> `503`, `Cache-Control: no-store`;
- `APPOINTMENT_CLIENT_NOT_FOUND` -> `404`;
- `APPOINTMENT_DEPENDENCY_CHANGED` -> `409` for a concurrent dependency change;
- `APPOINTMENT_PAYLOAD_INVALID` -> `400`;
- `NOTIFICATION_PERSISTENCE_UNAVAILABLE` -> `503`, `Cache-Control: no-store`;
- `NOTIFICATION_PAYLOAD_INVALID` -> `400` where applicable.

Unexpected Prisma errors must not become empty arrays, false `404` responses, success responses, or memory writes.

---

## 5. Proposed Prisma Schema

The final field names preserve the existing `AppointmentRecord` and `NotificationRecord` contracts.

```prisma
model User {
  // Existing fields and relations remain unchanged.
  appointments  Appointment[]
  notifications Notification[]
}

model Client {
  // Existing fields and relations remain unchanged.
  appointments Appointment[]
}

model Appointment {
  id                    String         @id @default(uuid())
  ownerUserId           String
  clientId              String
  title                 String         @db.VarChar(200)
  startsAt              DateTime       @db.Timestamp(6)
  reminderMinutesBefore Int            @default(1440)
  reminderType          String         @db.VarChar(32)
  reminderSentAt        DateTime?      @db.Timestamp(6)
  notes                 String         @default("") @db.VarChar(4000)
  createdAt             DateTime       @default(now()) @db.Timestamp(6)
  updatedAt             DateTime       @updatedAt @db.Timestamp(6)
  owner                 User           @relation(fields: [ownerUserId], references: [id], onDelete: Restrict)
  client                Client         @relation(fields: [clientId, ownerUserId], references: [id, ownerUserId], onDelete: Restrict)
  notifications         Notification[]

  @@unique([id, ownerUserId, clientId])
  @@index([ownerUserId, startsAt, id])
  @@index([ownerUserId, clientId, startsAt, id])
  @@index([ownerUserId, reminderSentAt, startsAt, id])
}

model Notification {
  id                     String      @id @default(uuid())
  ownerUserId            String
  type                   String      @db.VarChar(32)
  title                  String      @db.VarChar(240)
  message                String      @db.VarChar(1000)
  relatedClientId        String
  relatedAppointmentId   String
  createdAt              DateTime    @default(now()) @db.Timestamp(6)
  readAt                 DateTime?   @db.Timestamp(6)
  owner                  User        @relation(fields: [ownerUserId], references: [id], onDelete: Restrict)
  relatedAppointment     Appointment @relation(fields: [relatedAppointmentId, ownerUserId, relatedClientId], references: [id, ownerUserId, clientId], onDelete: Restrict)

  @@unique([relatedAppointmentId, ownerUserId])
  @@index([ownerUserId, createdAt, id])
  @@index([ownerUserId, readAt, createdAt, id])
}
```

### 5.1 Database-Level Checks

Because Prisma schema syntax does not express these checks, migration SQL must add:

- `Appointment.reminderMinutesBefore BETWEEN 1 AND 525600`;
- `Appointment.reminderType IN ('appointment', 'follow_up', 'maintenance')`;
- `Notification.type IN ('appointment', 'follow_up', 'maintenance')`.

Application validation and database checks are both required. The database remains the final integrity boundary.

### 5.2 Ordering Contracts

- Appointments: `startsAt ASC`, then `id ASC`.
- Notifications: `createdAt DESC`, then `id DESC`.
- Reminder candidates: `startsAt ASC`, then `id ASC`, limited to `100` per invocation.
- Client timeline: `createdAt DESC`, then `kind ASC`, then `id DESC` where timestamps collide.

### 5.3 API Validation Contracts

Appointment creation uses these explicit limits:

- `title`: string, trimmed, between 1 and 200 Unicode characters;
- `notes`: string when provided, trimmed, between 0 and 4000 Unicode characters;
- `reminderMinutesBefore`: finite integer between 1 and 525600 inclusive; omitted values default to 1440, while supplied invalid values return `400` rather than silently defaulting;
- `startsAt`: a string representing a valid ISO date, with a finite ECMAScript timestamp; it is normalized to UTC with `Date.toISOString()` before persistence;
- `reminderType`: `appointment`, `follow_up`, or `maintenance`; omitted values default to `appointment`, while supplied invalid values return `400`.

Notification read requests use these explicit rules:

- the body must be a JSON object; invalid JSON, `null`, arrays, and primitive bodies return `400`;
- `notificationIds`, when present, must be an array of 1 to 100 non-empty strings;
- duplicate IDs are rejected with `400`; they are not silently deduplicated;
- omitted `notificationIds` retains the existing mark-all-unread-owned behavior;
- unknown and cross-owner IDs do not disclose existence and do not increment the update count.

---

## 6. Repository Contracts

### 6.1 Appointment Repository

```ts
interface AppointmentCreateInput {
  clientId: string;
  title: string;
  startsAt: Date;
  reminderMinutesBefore: number;
  reminderType: ReminderType;
  notes: string;
}

type AppointmentDb = Pick<Prisma.TransactionClient, "appointment">;

createAppointmentForOwner(
  ownerUserId: string,
  input: AppointmentCreateInput,
): Promise<AppointmentRecord>;

listAppointmentsForOwner(
  ownerUserId: string,
  clientId?: string,
): Promise<AppointmentRecord[]>;

countAppointmentsForOwner(
  ownerUserId: string,
  db?: AppointmentDb,
): Promise<number>;
countAllAppointments(): Promise<number>;
countSentRemindersForOwner(ownerUserId: string): Promise<number>;

executeDueAppointmentRemindersForOwner(
  ownerUserId: string,
  now?: Date,
): Promise<{ remindersCreated: number }>;
```

The owner count contract is transaction-aware for M13 snapshot composition.

`createAppointmentForOwner` must validate the active Client inside the same transaction used for creation. A route-level Client check may be retained only for response composition, not as the final integrity check.

### 6.2 Notification Repository

```ts
listNotificationsForOwner(ownerUserId: string): Promise<NotificationRecord[]>;

markNotificationsReadForOwner(
  ownerUserId: string,
  notificationIds?: string[],
  now?: Date,
): Promise<number>;

countNotificationsForOwner(
  ownerUserId: string,
  db?: Pick<Prisma.TransactionClient, "notification">,
): Promise<number>;
countAllNotifications(): Promise<number>;
```

`markNotificationsReadForOwner` must update only unread records owned by the caller. Unknown and cross-owner IDs must not disclose existence and must not increment the updated count.

### 6.3 Aggregate Contracts

Existing aggregate functions should receive durable counts or move behind repository-backed services. No aggregate route may import Appointment or Notification state from `milestone1-store.ts`.

Required durable values:

- analytics: owner Appointment count and owner sent-reminder count;
- ops health: global Appointment and Notification counts;
- backup summary: owner Appointment and Notification counts;
- timeline: owner/client Appointment rows.

`createPersistentBackupSnapshot` must call the transaction-aware owner count contracts with the same `Prisma.TransactionClient` used for the existing M13 section reads. Counts queried outside that transaction are not acceptable because they could describe a different database snapshot.

---

## 7. Database Migration Plan

### 7.1 Migration Shape

Create one additive migration, proposed name:

`web/prisma/migrations/20260726_m14_appointments_notifications_convergence/migration.sql`

The migration will:

1. abort if `Appointment` or `Notification` already exists unexpectedly;
2. verify the `Client(id, ownerUserId)` candidate key exists and has no duplicates;
3. create `Appointment` with primary key, candidate key, checks, indexes, and owner-scoped foreign keys;
4. create `Notification` with primary key, unique reminder relation, checks, indexes, and owner-scoped foreign keys;
5. perform no update, delete, or destructive table recreation;
6. perform no M8 or M13 schema mutation.

### 7.2 Preflight

Before applying the migration to any environment:

- Prisma migration history must be clean and current;
- `User` and `Client` tables must exist;
- `Client(id, ownerUserId)` must be unique;
- duplicate candidate keys must be zero;
- no conflicting `Appointment` or `Notification` relation/table may exist;
- the deployment must acknowledge that current process-memory records cannot be backfilled reliably.

### 7.3 Existing Memory Data

There is no durable source from which existing process-memory Appointments or Notifications can be reconstructed safely. M14 therefore performs no automatic backfill.

Deployment procedure:

1. drain or stop application instances that can create Appointments;
2. record that volatile pre-M14 data is outside the migration boundary;
3. apply migration;
4. deploy repository cutover and guard update together;
5. start all instances on the PostgreSQL-only path;
6. run post-deployment smoke checks and owner-isolation checks.

No dual-write transition is allowed because it would create divergent authorities.

### 7.4 Rollback Boundary

Before production data is accepted, application rollback may return to the prior production-blocked Appointment route while leaving additive tables unused.

After production data is accepted, dropping tables is prohibited. Rollback must preserve the M14 tables and data, return the Appointments surface to a controlled unavailable state if necessary, and use a forward fix.

---

## 8. Route and Consumer Cutover

### 8.1 Appointments API

`GET /api/v1/appointments` and `POST /api/v1/appointments` retain their current request and response shapes.

Changes are internal:

- replace memory store calls with Appointment repository calls;
- preserve `401`, `400`, `404`, `201`, and `200` behavior;
- add controlled `409` and `503` mappings;
- preserve default reminder values and ISO timestamps;
- remove the production block only after convergence validation.

### 8.2 Notifications API

- `GET /api/v1/notifications` reads PostgreSQL rows.
- `POST /api/v1/notifications/read` updates PostgreSQL read state.
- `POST /api/v1/notifications/reminders/run` executes the atomic reminder transaction.
- Existing response shapes remain unchanged.

### 8.3 Client Timeline

The timeline route must load durable Appointments with durable Consultations and merge them with existing legacy timeline categories.

The route must:

- validate active Client ownership;
- load owner/client-scoped Appointments exactly once from `appointment-repository.ts`, which is the canonical Appointment source;
- use that same repository result for both the response `appointments` field and Appointment-derived timeline entries;
- remove Appointment reads from the memory-backed `getClientTimelineByUser` path, or replace that helper with a legacy-only photo/formula/treatment mapper;
- map Appointment `startsAt` to timeline `createdAt`, preserving existing UI behavior without a second Appointment source;
- map persistence failures to controlled no-store `503` responses;
- sort the merged timeline by `createdAt DESC`, then `kind ASC`, then `id DESC`.

### 8.4 Analytics

The analytics snapshot must replace memory counts with:

- `countAppointmentsForOwner(ownerUserId)`;
- `countSentRemindersForOwner(ownerUserId)`.

Consultation counting remains PostgreSQL-backed and unchanged. Existing snapshot fields and response types remain stable.

### 8.5 Backup Summary

The legacy `createBackupSnapshot` helper is memory-based and is not the production M13 backup path. Its tests must be migrated or retired when the Appointment and Notification memory arrays are removed.

Production `createPersistentBackupSnapshot` currently persists `appointmentsCount: 0` and `notificationsCount: 0`. M14 must replace only those fixed zeros with PostgreSQL counts for the requested owner, queried through the transaction-aware repository contracts inside the same existing `RepeatableRead` transaction as the M13 section reads.

The checksum algorithm, canonical serialization version, backup schema versions, and checksum field semantics remain unchanged. Checksum values will change legitimately when the summary changes from fixed zeros to real counts. Affected artifact and checksum fixtures must be regenerated from the unchanged canonicalization and checksum algorithm.

M14 must not:

- add Appointment or Notification sections to M13 artifacts;
- alter `m13.v1/v2/v3` validators;
- alter canonicalization, checksum algorithms, or fingerprint algorithms;
- restore Appointment or Notification rows;
- introduce `m13.v4`.

Legacy M12 summary recognition remains unchanged because the same count field names and numeric types are preserved.

### 8.6 Ops Health

Ops health must source global Appointment and Notification counts from PostgreSQL. Existing health state calculation based on push queue backlog remains unchanged.

A persistence failure must fail the route closed; stale or zero memory-derived counts are not acceptable substitutes.

### 8.7 Business Persistence and Readiness

The persistence registry must add or retain separate entries for both converged domains. They remain blocked during implementation:

```ts
appointments: {
  persistenceState: "memory_only",
  essential: true,
  productionReady: false,
},
notifications: {
  persistenceState: "memory_only",
  essential: true,
  productionReady: false,
}
```

Only after schema, repositories, route cutovers, aggregate cutovers, memory removal, and all focused regression gates pass may both entries change atomically to:

```ts
appointments: {
  persistenceState: "durable",
  essential: true,
  productionReady: true,
},
notifications: {
  persistenceState: "durable",
  essential: true,
  productionReady: true,
}
```

The `BUSINESS_PERSISTENCE_PRODUCTION_READY` readiness check may move from `FAIL` to `PASS` only when every essential registered business-persistence domain, including both `appointments` and `notifications`, is durable and production-ready. The two domains must not be activated independently because reminder consistency depends on both repositories.

The current hardcoded `FAIL` in `production-guards.ts` must be replaced during M14 cutover with an evaluation derived from `BUSINESS_PERSISTENCE_DOMAIN_REGISTRY`. The check returns `PASS` only when every domain with `essential: true` has both `persistenceState: "durable"` and `productionReady: true`; otherwise it returns `FAIL`. Its readiness message must be generated from that actual evaluation rather than retain a stale unconditional statement. Appointments and Notifications participate in this evaluation only after their coordinated M14 cutover.

Billing authenticity and storage checks remain unaffected and continue to keep global readiness `NOT_READY` until separately resolved. M14 can therefore make the business-persistence check pass without claiming global production readiness.

---

## 9. Implementation Phases

### Phase 0 - Approval and Baseline

- approve this plan;
- freeze the implementation baseline commit;
- run migration and data preflight;
- classify every production Appointment/Notification reader and writer.

### Phase 1 - Additive Schema

- add Prisma relations and models;
- add migration SQL with preflight and constraints;
- validate Prisma schema and migration against the isolated test database.

### Phase 2 - Repositories

- implement normalization, row mapping, domain errors, and no-store `503` responses;
- implement Appointment create/list/count contracts;
- implement Notification list/read/count contracts;
- implement atomic reminder execution and concurrency handling.

### Phase 3 - API Cutover

- cut over Appointments routes;
- cut over Notifications and reminder routes;
- preserve public contracts and status behavior;
- remove production imports of Appointment/Notification memory functions.

### Phase 4 - Aggregate Cutover

- cut over client timeline;
- cut over analytics counts;
- cut over backup summary counts;
- cut over ops health counts.

### Phase 5 - Memory Removal and Guard Reconciliation

- remove Appointment/Notification arrays and obsolete functions from `milestone1-store.ts` when no production reference remains;
- migrate or replace memory-coupled tests;
- change Appointments and Notifications together from `memory_only` to `durable` in the business-persistence registry;
- replace the hardcoded `BUSINESS_PERSISTENCE_PRODUCTION_READY` failure in `production-guards.ts` with status and message derivation from all `essential` entries in `BUSINESS_PERSISTENCE_DOMAIN_REGISTRY`;
- update readiness tests without changing the independent Billing or Storage blockers.

### Phase 6 - Full Validation and Closure Audit

- run focused route and repository tests after each slice;
- run PostgreSQL integration and concurrency tests;
- run M8 and M13 compatibility gates;
- run lint, typecheck, full Vitest, build, and relevant Playwright suites;
- audit production imports for forbidden memory paths;
- reconcile documentation only after implementation evidence exists.

---

## 10. Complete Test Plan

### 10.1 Schema and Migration Tests

- Prisma schema validates and client generation succeeds.
- Migration applies to a clean database.
- Migration applies after the complete current migration lineage.
- Reapplying or encountering an unexpected existing table fails explicitly.
- Foreign keys reject missing User, missing Client, and cross-owner Client combinations.
- check constraints reject invalid reminder types and reminder offsets.
- M13 tables, constraints, and migration history remain unchanged.

### 10.2 Appointment Repository Integration

- creates an Appointment for an active owner-scoped Client;
- reads the record through a fresh Prisma client after restart simulation;
- lists only records owned by the caller;
- filters by Client without cross-owner disclosure;
- orders by `startsAt ASC`, `id ASC`;
- rejects missing, cross-owner, and soft-deleted Clients;
- retains but hides records after Client soft deletion;
- preserves title, notes, reminder type, offset, and ISO timestamp mapping;
- rejects malformed persisted enum-like values fail closed;
- returns the controlled no-store `503` contract when persistence is unavailable.

### 10.3 Notification Repository Integration

- lists owner-scoped Notifications in `createdAt DESC`, `id DESC` order;
- persists Notification records across restart simulation;
- marks selected owned Notifications read;
- marks all unread owned Notifications read when IDs are omitted;
- does not mutate cross-owner or unknown IDs;
- does not change already-read timestamps;
- returns accurate owner and global counts;
- returns controlled no-store `503` behavior on persistence failure.

### 10.4 Reminder Atomicity and Concurrency

- future Appointment is not claimed;
- candidates are selected by `startsAt ASC`, `id ASC` and capped at 100;
- due Appointment creates one Notification and sets `reminderSentAt`;
- transaction uses a consistent timestamp for claim and Notification creation;
- only a conditional update result of `count === 1` creates a Notification;
- rerun creates zero duplicates;
- two concurrent runners create exactly one Notification;
- a benign lost claim returns zero for that candidate;
- `P2034`, serialization failures, and deadlocks retry at most three times;
- retry exhaustion produces a controlled concurrency failure;
- unexpected `P2002` fails closed unless an owner-scoped post-conflict read proves a concurrent winner;
- Notification creation failure rolls back `reminderSentAt`;
- Appointment update failure rolls back Notification creation;
- owner A cannot claim owner B reminders;
- no conflict path falls back to memory;
- behavior remains correct after a fresh Prisma client is used.

### 10.5 Route Tests

Appointments:

- `401` without session;
- `400` for invalid JSON, missing required fields, invalid ISO timestamp, invalid type, and invalid limits;
- `404` for unavailable owned Client without cross-owner disclosure;
- `409` for concurrent dependency change;
- `503` for persistence unavailability;
- `201` create and `200` list preserve response contracts.

Notifications:

- `401` without session;
- owner-scoped listing;
- selected and all-read behavior;
- invalid JSON returns `400`;
- `null`, primitive, and array bodies return `400`;
- non-array `notificationIds` returns `400`;
- non-string or empty elements return `400`;
- duplicate IDs return `400`;
- more than 100 IDs returns `400`;
- cross-owner and unknown IDs do not disclose existence and do not increment the update count;
- reminder run count contract;
- controlled `503` mapping for repository failure.

### 10.6 Timeline Tests

- durable Appointment appears after process restart simulation;
- cross-owner Appointment does not appear;
- soft-deleted Client and its Appointment are hidden;
- Consultation and Appointment entries merge deterministically;
- the response `appointments` field and timeline entries come from one repository read, with no memory-backed duplicate source;
- equal timestamps sort by `createdAt DESC`, `kind ASC`, then `id DESC`;
- legacy photo/formula/treatment entries remain behaviorally unchanged;
- persistence errors fail closed.

### 10.7 Analytics, Backup, and Ops Tests

- analytics uses durable owner Appointment and sent-reminder counts;
- ops health uses durable global Appointment and Notification counts;
- production M13 backup summary replaces fixed zeros with durable owner counts after M14;
- Appointment and Notification counters are read through the same M13 `RepeatableRead` transaction as artifact sections;
- a concurrent write outside the backup transaction cannot produce a mixed-snapshot summary;
- equal counts preserve existing response and artifact shapes;
- checksum algorithms and canonicalization remain unchanged while checksum values reflect the real summary;
- affected artifact and checksum fixtures are regenerated from the unchanged algorithm;
- M12 legacy summary recognition remains valid;
- M13 v1/v2/v3 canonicalization, checksum, fingerprint, preview, restore, and dispatch regression suites remain green;
- no Appointment or Notification rows are implied to be restorable by M14.

### 10.8 Business Guard and Readiness Tests

- Appointments and Notifications remain `memory_only` and blocked until the final cutover;
- Appointments and Notifications change together from `memory_only` to `durable` only after both persistence paths and all consumers pass;
- production no longer blocks the Appointments route through the business persistence guard;
- the hardcoded business-persistence `FAIL` is removed and the check is derived from `BUSINESS_PERSISTENCE_DOMAIN_REGISTRY`;
- the business-persistence readiness check changes from `FAIL` to `PASS` only when every essential domain has `persistenceState: "durable"` and `productionReady: true`;
- readiness messages reflect the actual registry evaluation for passing and failing states;
- Appointments and Notifications are included in the derived evaluation after their coordinated cutover;
- unknown domains still fail closed;
- Billing and Storage readiness checks remain independent and may keep global readiness `NOT_READY` after the business-persistence check passes;
- readiness reports accurate durable domain metadata.

### 10.9 M8 and AI Non-Regression Tests

- M8 integration and real E2E suites remain green;
- Analysis repository and Consultation persistence suites remain green;
- no AI engine snapshot or deterministic result changes;
- no M8 production file appears in the implementation diff unless separately approved.

### 10.10 Static and Release Gates

- `npm run lint`;
- `npm run typecheck`;
- `npm run test`, including migrated milestone 3/6/7 tests;
- focused PostgreSQL integration tests;
- `npm run build` with approved production-like environment;
- relevant Playwright persisted E2E tests;
- `git diff --check` and path audit;
- search confirms no production import of removed Appointment/Notification memory functions.

---

## 11. Acceptance Criteria

M14 is acceptable only when all conditions are true:

1. Appointment and Notification records are PostgreSQL-authoritative.
2. No production code reads or writes `store.appointments` or `store.notifications`.
3. No database failure falls back to memory, success, empty data, or false `404` behavior.
4. Appointment creation validates an active owner-scoped Client inside the persistence transaction.
5. All Appointment and Notification reads, writes, counts, and updates are owner-scoped where applicable.
6. Reminder claim, Notification creation, and `reminderSentAt` update are atomic.
7. Concurrent reminder execution creates at most one Notification per Appointment.
8. Existing Appointment, Notification, timeline, analytics, backup-summary, and ops response shapes remain compatible.
9. Analytics, backup summary, and ops health use durable counts; backup counts share the existing M13 `RepeatableRead` transaction.
10. Appointments and Notifications change together from `memory_only` to `durable` and `productionReady` only after all focused gates pass.
11. `BUSINESS_PERSISTENCE_PRODUCTION_READY` is derived from `BUSINESS_PERSISTENCE_DOMAIN_REGISTRY`, is `PASS` only when every essential domain is durable and production-ready, and emits a message based on the actual evaluation rather than a hardcoded failure.
12. M8 behavior and AI engine outputs remain unchanged.
13. M13 v1/v2/v3 schemas, canonicalization algorithms, checksum algorithm, and restore behavior remain unchanged; checksum values may change only because existing summary fields contain real counts.
14. No new social feature, commercial module, AI behavior, or backup artifact version is introduced.
15. Migration preflight and post-migration integrity checks pass in the target environment.
16. Focused tests, PostgreSQL integration tests, concurrency tests, lint, typecheck, build, and required regressions pass.
17. Final Git audit shows only approved M14 implementation and documentation paths.
18. Billing and Storage readiness checks remain independent and may keep global readiness `NOT_READY` after business persistence reaches `PASS`.

---

## 12. Risks and Mitigations

### 12.1 Atomicity Risk

**Risk:** `reminderSentAt` commits while Notification creation fails, or the reverse.

**Mitigation:** both operations occur in one transaction; failure rolls back both.

### 12.2 Duplicate Reminder Risk

**Risk:** concurrent reminder runners create duplicates.

**Mitigation:** deterministic bounded selection, conditional claim, unique Notification relation, three-attempt serializable conflict handling, fail-closed unexpected `P2002`, and concurrency integration tests.

### 12.3 Split-Brain Reader Risk

**Risk:** routes use PostgreSQL while timeline, analytics, backup, or ops continue using memory.

**Mitigation:** classify and migrate every production consumer before changing the readiness registry; prohibit production memory imports in the acceptance audit.

### 12.4 Volatile Pre-M14 Data Risk

**Risk:** appointments and notifications present only in a running process cannot be migrated reliably.

**Mitigation:** explicit cutover window, no fabricated backfill, deployment acknowledgement, and PostgreSQL-only operation after cutover.

### 12.5 Client Lifecycle Risk

**Risk:** appointments become orphaned or expose a soft-deleted Client.

**Mitigation:** composite owner/client foreign key, active-Client transaction check, `RESTRICT` deletion, and hidden retained history policy.

### 12.6 Failure-Mapping Risk

**Risk:** broad exception handling converts database failures into empty arrays or false not-found responses.

**Mitigation:** typed persistence errors, narrow dependency errors, no-store `503` responses, and explicit negative tests.

### 12.7 M13 Compatibility Risk

**Risk:** adding durable records is mistaken for extending backup/restore coverage.

**Mitigation:** freeze M13 versions and algorithms; query summary counts inside the existing `RepeatableRead` transaction; regenerate affected checksum fixtures from the unchanged algorithm; document row-level restore as out of scope.

### 12.8 Performance Risk

**Risk:** due-reminder scans and timeline queries degrade with volume.

**Mitigation:** owner/start/client/reminder indexes, bounded candidate batches if required, query-plan review, and deterministic pagination as a future extension if list volume requires it.

### 12.9 Scope Risk

**Risk:** M14 expands into calendar integrations, external notifications, or commercial scheduling.

**Mitigation:** preserve existing contracts and features only; reject new product surface during this milestone.

---

## 13. Known Limits After M14

Even after successful M14 closure:

- reminder execution remains invoked through the existing route; M14 does not introduce a distributed scheduler;
- Notifications remain in-app records only; no external delivery guarantee is added;
- Appointment update, cancellation, recurrence, and pagination remain out of scope;
- M13 restore does not recreate Appointment or Notification rows;
- M13 backup schemas remain unchanged and contain no Appointment or Notification row sections;
- local image storage, billing webhook authenticity, and distributed rate limiting remain separate production-readiness concerns;
- global readiness remains `NOT_READY` until all unrelated critical blockers are resolved.

These limits do not invalidate Appointment and Notification persistence convergence, but they must remain visible in production-readiness reporting.

---

## 14. Implementation Closure

The implementation plan was approved and executed through the coordinated Phase 5 cutover. Appointments and Notifications are PostgreSQL-authoritative, owner-scoped, fail closed without memory fallback, and are activated together as `durable` and `productionReady` business-persistence domains.

Closure evidence confirms:

- Appointment and Notification persistence are one atomic convergence scope;
- PostgreSQL is authoritative with no memory fallback;
- the additive schema and owner-scoped foreign keys are implemented;
- M13 backup artifacts remain frozen and row-level Appointment/Notification restore is out of scope;
- no AI engine, social feature, or new commercial module is included;
- guard activation occurred only after implementation and validation completed;
- business-persistence readiness is `PASS`, while global readiness remains `NOT_READY` because Billing webhook authenticity and production storage are still independent critical blockers;
- the Phase 5 Git checkpoint remains pending explicit approval and must precede any new milestone.

**Plan Status:** implementation completed and validated; awaiting explicit Git checkpoint approval.
