# M15 TECHNICAL PLAN - Production Object Storage

**Date:** 27 iulie 2026
**Status:** Proposed - implementation blocked pending review and approval
**Blockers:** `PR-C-003` Production storage backend; `PR-D-002` Object storage implementation
**Scope:** Private S3-compatible object storage for image bytes, zero-downtime migration from local filesystem storage, storage readiness, retention, and backup/restore reference compatibility

---

## 1. Milestone Objective

M15 will replace the process-local `.storage/images` backend used by the official Next.js runtime with a private, production-approved, S3-compatible object-storage backend.

PostgreSQL remains authoritative for `ImageAsset` metadata. Object storage becomes authoritative for image bytes. The application remains the authorization boundary: clients do not receive bucket credentials, permanent object URLs, bucket names, or raw object keys.

M15 closes `PR-C-003` and `PR-D-002` only after all active image assets are object-backed, configuration and live capability probes pass, local production writes are impossible, backup/restore external references are verifiable, and rollback evidence is complete. The independent Billing authenticity blocker remains unchanged, so global readiness may remain `503 NOT_READY` after M15.

### 1.1 Required Outcomes and Success Criteria

- All new production image writes use the configured S3-compatible backend; production local writes are rejected fail closed.
- The bucket is private and server-side encrypted; public ACLs and anonymous reads are prohibited.
- Every object key is deterministic, opaque, owner-partitioned, and derived only from trusted IDs.
- Upload, read, soft delete, retention purge, and reconciliation are owner-safe and observable.
- Upload failures cannot leave a database row presented as an available image.
- Database failures after object upload produce a detectable orphan that a reconciler can delete safely.
- Existing active local assets migrate without API downtime and are byte-verified before cutover.
- The authenticated application download route returns bytes only for an active asset owned by the caller.
- Production readiness passes storage only when configuration, provider capability, migration completion, and active-row invariants all pass.
- Backup `m13.v1`, `m13.v2`, and `m13.v3` parsing, canonicalization, checksums, fingerprints, and dispatch remain unchanged.
- New backups use `m15.v1` and carry structured object references plus content checksums, but not image bytes.
- Restore never creates available metadata for a missing or mismatched object.
- PostgreSQL, unit, integration, object-store, security, backup/restore, and production-readiness gates pass.
- No production import of `fs` or `.storage/images` remains after final cutover, except the isolated migration utility.

### 1.2 Explicit Non-Goals

M15 will not implement:

- public buckets, public object URLs, or browser-held object-store credentials;
- direct-to-bucket browser uploads or presigned upload URLs;
- a CDN or public image transformation service;
- a new image-analysis provider or changes to analysis algorithms;
- billing webhook authenticity or distributed rate limiting;
- backup embedding of binary image payloads inside PostgreSQL JSON artifacts;
- cross-cloud replication orchestration inside the application;
- migration or extension of the legacy root `server.js` runtime;
- destructive removal of `ImageAsset.storagePath` in the same deployment that introduces object storage.

---

## 2. Current-State Assessment

### 2.1 Runtime Storage

`web/src/lib/image-storage.ts` writes normalized images beneath `<process.cwd()>/.storage/images/<userId>/<assetId>/<fileName>`. This is unsuitable for horizontally scaled or ephemeral production instances and is the direct cause of `PR-C-003`.

`uploadAndAnalyzeImages` currently creates an `ImageAsset` row with `storagePath: "pending"`, writes the local file, updates the row, and then creates the analysis. The sequence has no durable storage state machine and can leave pending metadata or orphan files after partial failure.

The current delete path deletes the file immediately and then records a 30-day metadata retention deadline. This makes retention semantics internally inconsistent and swallows storage deletion errors.

### 2.2 API Surface

- `POST /api/v1/uploads` authenticates by bearer session and permits `professional`, `salon`, and `admin` roles.
- `GET /api/v1/image-assets/:id` returns metadata after owner verification.
- `GET /api/v1/image-assets/:id/download` is referenced by `getPrivateImageUrl` but is not implemented.
- `GET /api/v1/image-analyses/:assetId` returns analysis metadata.
- `DELETE /api/v1/image-analyses/:assetId` currently deletes bytes and soft-deletes metadata.

M15 preserves existing successful response shapes where they exist. It adds the intended private download route and stable storage failure responses.

### 2.3 Backup and Restore

M13 backup artifacts contain `ImageAsset` metadata and `storagePath`, but not image bytes. External-reference verification directly inspects the local filesystem. Restore replaces database metadata only after local-path verification.

An object-store key cannot be reinterpreted as a local path without changing M13 semantics. M15 therefore introduces a forward artifact version instead of changing the meaning of `m13.v1-v3`.

### 2.4 Readiness

`STORAGE_PRODUCTION_POLICY_READY` is currently an unconditional `FAIL`. M15 will replace it with a deterministic storage-readiness evaluation. The readiness response must stay `no-store` and must not reveal secrets, bucket names, endpoint hostnames, keys, or provider error bodies.

---

## 3. Frozen Principles and Protected Boundaries

### 3.1 Storage Principles

- **Private by default:** no public access or ACL-based authorization.
- **Application-authorized:** authentication and owner checks occur before object-store access.
- **PostgreSQL metadata authority:** lifecycle state and object identity are persisted, owner-scoped metadata.
- **Object-store byte authority:** an `available` object-backed row must resolve to exactly one verified object.
- **Fail closed:** missing configuration, provider failures, malformed metadata, or checksum mismatch never fall back to success.
- **No production local writes:** local storage is development/test-only after cutover.
- **Idempotent operations:** put, delete, migration, and reconciliation tolerate retries.
- **No user-controlled keys:** original filenames are metadata only and never form an object key.
- **Bounded I/O:** existing file-count and byte limits remain enforced before provider calls.

### 3.2 Components That Must Not Be Touched

The following are protected:

- root `server.js`, `script.js`, `index.html`, `extension.html`, and `styles.css`;
- `web/src/lib/analysis-engine.ts`;
- `web/src/lib/analysis-thresholds.ts`;
- `web/src/lib/cutting-plan-engine.ts`;
- `web/src/lib/image-analysis-provider.ts` provider result semantics;
- `web/src/lib/image-analysis-m8-mapper.ts` mapping and confidence semantics;
- Appointment, Notification, Client, Consultation, Webhook, Billing, and auth persistence models except relation-neutral generated Prisma output;
- business-persistence registry status and M14 convergence behavior;
- webhook cryptography, delivery state machines, retry classification, and secret versioning;
- M13 `m13.v1-v3` artifact validators, canonical serialization, SHA-256 algorithm, fingerprints, and restore dispatch semantics;
- M13 restore governance, maintenance, retention, observability, and alert contracts;
- public launch authorization: M15 does not override independent critical blockers.

Allowed compatibility changes to shared backup files must be additive `m15.v1` dispatch branches. Existing M13 branches and fixtures are immutable.

---

## 4. Proposed Architecture

### 4.1 Provider Choice and Boundary

Use AWS SDK for JavaScript v3 with the S3 API. The production contract is S3-compatible, allowing AWS S3 in production and MinIO for deterministic integration tests. Proposed dependencies:

- `@aws-sdk/client-s3`;
- `@aws-sdk/lib-storage` only if streaming multipart upload is required by the final implementation; the current 8 MiB per-file limit does not require it;
- `@aws-sdk/s3-request-presigner` is not required because M15 uses an authenticated proxy download.

`object-storage.ts` owns the provider-neutral contract:

```ts
type StorageBackend = "local" | "s3";

interface ObjectReference {
  backend: "s3";
  bucketAlias: string;
  key: string;
  versionId: string | null;
  etag: string | null;
  contentSha256: string;
  sizeBytes: number;
}

interface ObjectStorage {
  put(input: PutObjectInput): Promise<ObjectReference>;
  get(input: ObjectIdentity): Promise<ReadableStream>;
  head(input: ObjectIdentity): Promise<ObjectMetadata>;
  delete(input: ObjectIdentity): Promise<void>;
}
```

The adapter must translate provider errors into stable internal categories: `not_found`, `access_denied`, `timeout`, `throttled`, `configuration`, and `provider_unavailable`. Raw provider messages are logged only after secret-safe sanitization and are not returned to clients.

### 4.2 Bucket and Key Policy

Required bucket controls:

- block all public access;
- bucket-owner-enforced ownership; ACLs disabled;
- TLS-only access;
- server-side encryption: provider-managed AES-256 minimum, KMS preferred where available;
- object versioning enabled in production;
- lifecycle policy aligned with retention and noncurrent-version deletion policy;
- application IAM principal restricted to the configured bucket and application prefix;
- list permission omitted from request-path credentials where possible; migration/reconciliation uses a separate operational role if listing is required.

Canonical key format:

```text
v1/owners/<ownerUserId>/assets/<assetId>/original
```

The key contains trusted UUIDs only. It excludes email, client name, original filename, MIME type, and other personal data. `Content-Disposition` uses the sanitized database filename at download time.

`bucketAlias` is a non-secret logical identifier persisted in PostgreSQL and artifacts. Physical bucket names come from deployment configuration. This permits environment-specific restoration without embedding infrastructure names in portable backups.

### 4.3 Upload State Machine

`ImageAsset.storageState` uses:

- `pending_upload`;
- `available`;
- `delete_pending`;
- `deleted`;
- `quarantined`.

Upload sequence for each validated file:

1. authenticate, authorize role, validate active owner-scoped Client, rate limit, MIME, size, magic bytes, and normalization;
2. compute SHA-256 over the exact normalized bytes to be stored;
3. create an owner-scoped `pending_upload` row with deterministic object key;
4. upload bytes using conditional create semantics where supported and record encryption/content metadata;
5. `HEAD` the object and verify key, size, checksum metadata, and version identity;
6. transactionally update the row to `available` and create the draft `ImageAnalysis`;
7. on object upload failure, mark the row `quarantined` or remove the still-unreferenced pending row;
8. on database finalization failure, retain a correlation record and invoke idempotent compensating delete; reconciliation handles any failed compensation.

No API response may expose an asset until state is `available`. A retry with the same asset identity must not overwrite bytes belonging to a different checksum.

### 4.4 Read and Download Path

The server-side route performs:

1. bearer-session authentication using the established auth helper pattern;
2. owner-scoped lookup with `deletedAt: null` and `storageState: available` in the query itself;
3. object reference validation;
4. provider `GET` pinned to `versionId` when available;
5. streamed response with stored `Content-Type`, exact `Content-Length`, safe `Content-Disposition`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, and request ID;
6. stable `404/410/503` handling without disclosing cross-owner existence.

The route will not redirect to a provider URL in M15. This keeps bearer authentication, owner isolation, revocation behavior, and auditability inside the application.

### 4.5 Soft Delete and Retention Purge

The existing DELETE response remains compatible, but deletion becomes a metadata transition:

- set `deletedAt`, `retentionDeletesAt`, and `storageState: delete_pending` transactionally;
- immediately block metadata and byte reads;
- retain the object until the retention deadline;
- an admin-only ops execution deletes eligible object versions in bounded batches, verifies absence, and changes state to `deleted` with `objectDeletedAt`;
- provider failure leaves `delete_pending`, records a safe error, and is retryable;
- database metadata is not hard-deleted by this milestone.

Proposed operational route:

`POST /api/v1/ops/storage/retention/run`

It follows existing admin authentication, request ID, audit, idempotency, bounded-batch, and no-store conventions. Default batch limit is `100`; accepted range is `1..500`. Dry-run and execution modes must be explicit.

### 4.6 Reconciliation

An operational reconciler detects:

- stale `pending_upload` rows;
- `available` rows whose object is missing or mismatched;
- `delete_pending` rows past retention;
- known orphan objects created by failed finalization.

It must never infer owner identity from untrusted object metadata and must not delete unknown keys merely because they are absent from one database query. Destructive orphan cleanup requires the application prefix, deterministic key parse, grace period, and a second database check.

---

## 5. Configuration and Security

### 5.1 Environment Contract

Production-required variables:

- `OBJECT_STORAGE_BACKEND=s3`;
- `OBJECT_STORAGE_BUCKET_ALIAS`;
- `OBJECT_STORAGE_BUCKET`;
- `OBJECT_STORAGE_REGION`;

Optional production variables:

- `OBJECT_STORAGE_ENDPOINT` for approved S3-compatible providers;
- `OBJECT_STORAGE_FORCE_PATH_STYLE=false|true`;
- `OBJECT_STORAGE_KMS_KEY_ID`;
- `OBJECT_STORAGE_PREFIX=v1`;
- `OBJECT_STORAGE_REQUEST_TIMEOUT_MS` within a bounded allowed range.

Credentials must use the runtime platform's workload identity or standard SDK credential chain. Static access keys are not added to tracked `.env` templates, readiness payloads, logs, database rows, or backup artifacts.

Development/test may select `local` or `s3`. Production accepts only `s3`. Endpoint URLs must be HTTPS in production except explicitly isolated test environments.

### 5.2 Authentication and Authorization Impact

- Existing bearer-session authentication remains authoritative.
- Upload role policy remains `professional|salon|admin`.
- Metadata, download, analysis, review, and delete queries must scope by both asset ID and `ownerUserId`; lookup-then-check patterns should be replaced by owner-scoped queries.
- Cross-owner and unknown download IDs return the same non-disclosing status.
- The retention route is admin-only and emits an audit event.
- Object-store IAM is infrastructure authorization, not a replacement for application owner authorization.
- Object keys and bucket identifiers are internal and removed from API serializers.

### 5.3 Threat Controls

- path traversal is eliminated by deterministic keys and no user filename in keys;
- MIME and magic-byte validation remain before upload;
- EXIF stripping and orientation normalization remain before checksum and upload;
- SSRF is avoided by validating the configured endpoint once, not accepting endpoint input from requests;
- confused-deputy reads are prevented by owner-scoped metadata lookup before provider access;
- overwrite attacks are prevented by unique object identity and checksum/version verification;
- decompression and oversized upload risks remain bounded by current batch/file limits;
- logs mask credentials, authorization headers, signed query parameters, bucket names, and object keys;
- audit metadata uses asset ID, action, result, request ID, and safe provider category only.

---

## 6. Prisma Schema and Persistence

### 6.1 Additive Schema

Proposed additions:

```prisma
enum ImageAssetStorageState {
  pending_upload
  available
  delete_pending
  deleted
  quarantined
}

model ImageAsset {
  // Existing fields remain during migration.
  storagePath           String
  storageBackend        String?                 @db.VarChar(16)
  storageBucketAlias    String?                 @db.VarChar(64)
  storageKey            String?                 @db.VarChar(512)
  storageVersionId      String?                 @db.VarChar(1024)
  storageEtag           String?                 @db.VarChar(256)
  contentSha256         String?                 @db.Char(64)
  storageState          ImageAssetStorageState?
  storageMigratedAt     DateTime?               @db.Timestamp(6)
  objectDeletedAt       DateTime?               @db.Timestamp(6)
  lastStorageErrorCode  String?                 @db.VarChar(80)

  @@unique([storageBucketAlias, storageKey])
  @@index([ownerUserId, storageState, id])
  @@index([storageState, retentionDeletesAt, id])
}
```

`storagePath` remains required and unchanged for historical M13 rows and rollback compatibility. New object-backed rows set it to a non-secret compatibility marker such as `object:<assetId>`; request paths never use it to address the object. Removing it requires a later schema cleanup milestone after legacy backup support is retired.

`storageState` is nullable only in M15a so pre-existing rows retain their current behavior during the additive deployment. A null state is accepted solely as a legacy-local migration state and is never written for a new upload. After backfill, M15b sets all rows to an explicit state, validates the state checks, makes the column non-null with `pending_upload` as the creation default, and removes null-state runtime handling.

Migration SQL adds checks not expressible in Prisma:

- `contentSha256` is either null or 64 lowercase hexadecimal characters;
- `available` S3 rows require backend, alias, key, checksum, and `sizeBytes > 0`;
- `deleted` rows require `objectDeletedAt`;
- `local` rows cannot claim `storageMigratedAt`;
- object key prefix and owner/asset identity are checked by application code; SQL does not duplicate UUID string parsing.

### 6.2 Migration Files

Two additive migrations are planned:

1. `20260727_m15a_object_storage_metadata`: enum, nullable object fields, indexes, and permissive migration-state checks.
2. `20260727_m15b_object_storage_cutover_guards`: final state checks added as `NOT VALID`, validated only after data migration, then activated for new writes.

No table recreation, column drop, or destructive rewrite is allowed. Indexes on a populated production table use PostgreSQL-safe online deployment strategy (`CREATE INDEX CONCURRENTLY` in an operational migration step where Prisma transactional migration constraints require it).

### 6.3 Persistence Invariants

- active `available` assets have one complete object reference;
- `(storageBucketAlias, storageKey)` is unique when non-null;
- owner ID and asset ID used to derive the key match the row being finalized;
- `sizeBytes` and `contentSha256` describe normalized stored bytes, not original upload bytes;
- storage state transitions use conditional updates to prevent stale workers from reviving deleted assets;
- provider calls do not occur inside long PostgreSQL transactions;
- every cross-system operation has a compensating or reconciling path.

---

## 7. API Changes and Failure Contracts

### 7.1 Affected APIs

`POST /api/v1/uploads`

- request and success response remain compatible;
- uses object storage and the storage state machine;
- returns `503` with `Cache-Control: no-store` for provider/configuration unavailability;
- validation remains `400`, auth `401`, role `403`, rate limiting `429`.

`GET /api/v1/image-assets/:id`

- continues returning public metadata only;
- omits `storagePath`, bucket alias, key, version, ETag, and provider error fields;
- requires active owner-scoped state.

`GET /api/v1/image-assets/:id/download` (new)

- streams private bytes after owner authorization;
- `401` unauthenticated, non-disclosing `404` unknown/cross-owner, `410` deleted, `503` provider unavailable or invariant failure;
- never redirects to a public URL.

`GET /api/v1/image-analyses/:assetId`

- changes only to owner-scoped active-asset lookup and stable storage-state handling.

`DELETE /api/v1/image-analyses/:assetId`

- retains response compatibility;
- changes from immediate best-effort file deletion to durable `delete_pending` retention workflow.

`POST /api/v1/ops/storage/retention/run` (new)

- admin-only dry-run/execution with idempotency and bounded batch.

`GET /api/v1/ops/readiness`

- preserves response envelope;
- derives `STORAGE_PRODUCTION_POLICY_READY` from validated configuration and readiness evidence.

### 7.2 Stable Internal Error Codes

- `OBJECT_STORAGE_CONFIGURATION_INVALID`;
- `OBJECT_STORAGE_UNAVAILABLE`;
- `OBJECT_STORAGE_ACCESS_DENIED`;
- `OBJECT_STORAGE_OBJECT_MISSING`;
- `OBJECT_STORAGE_INTEGRITY_MISMATCH`;
- `IMAGE_ASSET_STORAGE_STATE_INVALID`;
- `IMAGE_ASSET_UPLOAD_FINALIZATION_FAILED`;
- `IMAGE_ASSET_RETENTION_EXECUTION_FAILED`.

Client messages remain safe and generic. Request IDs correlate route, database, and provider telemetry.

---

## 8. Backup and Restore Impact

### 8.1 Frozen Legacy Behavior

- `m13.v1-v3` types, canonicalization, checksums, validators, preview fingerprints, execution ordering, and local external-reference semantics remain unchanged.
- Existing M13 artifacts are not relabeled or rewritten.
- An M13 artifact containing local image references remains executable only under its existing verified local-reference contract.
- M15 does not silently reinterpret a legacy `storagePath` as an object key.

### 8.2 New `m15.v1` Artifact

`m15.v1` extends the current `m13.v3` business sections and replaces each forward `ImageAsset` external reference with:

```ts
interface BackupM15ObjectReference {
  backend: "s3";
  bucketAlias: string;
  key: string;
  versionId: string | null;
  contentSha256: string;
  sizeBytes: number;
}
```

Image bytes remain outside the JSON artifact. The artifact checksum protects the reference metadata; the per-object SHA-256 protects the referenced bytes.

### 8.3 Backup Creation and Verification

- backup creation reads `ImageAsset` metadata in the existing PostgreSQL `RepeatableRead` snapshot;
- only complete object references are emitted;
- verification performs bounded `HEAD` checks for every active referenced object;
- verification requires size, checksum metadata, and pinned version identity where versioning is enabled;
- missing, inaccessible, or mismatched objects make the artifact ineligible for restore;
- provider throttling/unavailability is reported as verification unavailable, not as a false missing object;
- backup JSON never includes credentials, endpoint, physical bucket name, signed URL, or response headers.

Object-store durability is handled by infrastructure policy: versioning, encryption, lifecycle, provider durability, and independently documented replication/export. The database artifact alone is explicitly not a complete binary backup.

### 8.4 Restore

- preview verifies every object reference before declaring eligibility;
- execution repeats object verification inside the restore decision window before metadata replacement;
- restore maps `bucketAlias` to the target environment's configured bucket;
- restore never copies bytes between providers in the PostgreSQL transaction;
- a missing target object blocks restore before destructive database changes;
- postconditions include row counts, state fingerprint, reference completeness, and object verification summary;
- legacy M13 safety-backup requirements remain unchanged;
- cross-region/object-copy restore is a separate pre-restore operational step that must preserve checksum and record the target version ID.

### 8.5 Restore Rollback Safety

The pre-restore safety backup must be `m15.v1` when current state contains object-backed assets. A legacy M13 safety backup is insufficient because it cannot prove recoverability of structured object references. Object versions required by the safety backup must be protected from lifecycle deletion for the restore rollback window.

---

## 9. Zero-Downtime Migration and Cutover

### Phase 0 - Approval and Baseline

- approve this plan and provider/bucket policy;
- freeze the M14 checkpoint commit;
- inventory all active, deleted, pending, missing, unsafe-path, symlink, duplicate, and unreadable local assets;
- record row count, total bytes, per-owner counts, and SHA-256 manifest;
- block cutover if the inventory is incomplete or local files are not accessible from the migration runner.

### Phase 1 - Additive Infrastructure and Schema

- provision private versioned encrypted bucket and least-privilege identities;
- apply M15a additive schema;
- deploy configuration validation, object adapter, state mapping, and observability with storage readiness still `FAIL`;
- keep existing local reads/writes unchanged during this phase.

### Phase 2 - Write Cutover

- activate `m15.v1` backup creation before the first object-backed production row can be created, while retaining immutable M13 read/restore dispatch;
- deploy object-only writes for new uploads;
- new rows use `pending_upload -> available` and never write local files;
- reads use object storage for object-backed rows and temporary local read-only fallback for unmigrated legacy rows;
- fallback is forbidden for rows marked object-backed;
- storage readiness remains `FAIL` while any active local row exists.

### Phase 3 - Online Backfill

The migration utility processes deterministic owner/asset batches:

1. lock/claim a legacy row using conditional metadata update without holding a transaction during I/O;
2. safely resolve the path beneath the authorized local root and reject symlink escapes;
3. read bytes, compute SHA-256, and compare `sizeBytes`;
4. upload to the deterministic key with checksum metadata and encryption;
5. `HEAD` and verify size/checksum/version;
6. conditionally persist object reference, `storageBackend=s3`, `storageState=available`, and `storageMigratedAt`;
7. leave the local file in place through the rollback observation window;
8. retry idempotently; report conflicts and corruption without overwriting destination bytes.

Uploads and authenticated reads remain available during backfill. A row being migrated remains readable from its original source until the verified metadata switch commits.

### Phase 4 - Verification and Read Cutover

- reconcile manifest, PostgreSQL rows, and provider `HEAD` results;
- require zero active local rows, zero `pending_upload` beyond threshold, zero missing objects, zero checksum mismatches, and zero duplicate keys;
- apply/validate M15b state constraints;
- disable local fallback in production;
- run authenticated upload/download/delete and owner-isolation smoke tests on every production instance class;
- keep local files read-only for the rollback observation window.

### Phase 5 - Backup/Restore and Retention Cutover

- validate the active `m15.v1` backup, preview, safety backup, restore, and postconditions against object-backed assets;
- activate retention execution and reconciliation;
- prove object version protection across a restore rollback drill.

### Phase 6 - Readiness and Closure

- switch storage readiness from unconditional `FAIL` to derived evaluation;
- mark `PR-C-003` and `PR-D-002` resolved only after all gates pass;
- retain Billing authenticity as an independent blocker;
- remove production imports of local storage and delete local copies only after the approved rollback window;
- publish closure evidence and Git checkpoint.

### Migration Abort Conditions

- source path escapes authorized root or is a symbolic-link escape;
- source bytes missing or unreadable;
- source size differs from persisted metadata without approved reconciliation;
- destination key exists with a different checksum;
- provider versioning/encryption/public-access controls are not proven;
- database migration history is dirty;
- active rows cannot be mapped one-to-one to verified objects.

---

## 10. Storage Readiness Contract

`STORAGE_PRODUCTION_POLICY_READY` returns `PASS` only when all are true:

- production backend is exactly `s3`;
- required configuration validates and endpoint policy is approved;
- credential resolution succeeds without static secrets in application configuration;
- bucket `HEAD`/capability probe proves access to the expected private bucket;
- encryption and versioning policy evidence is present;
- a bounded write-read-head-delete canary succeeds under an isolated readiness prefix, or a recent signed capability result is within its TTL;
- PostgreSQL invariant query finds zero active non-object rows and zero incomplete active references;
- migration/reconciliation status has no blocking discrepancy;
- local production fallback and local writes are disabled.

Readiness must not perform unbounded scans or a provider write on every request. Capability evidence is cached for at most 60 seconds with explicit failure expiry. Database invariant queries use indexed predicates. Any stale/failed evidence returns `FAIL`.

Readiness remains synchronous from the route perspective and exposes only safe messages such as `Production object storage is configured and verified` or `Production object storage is not ready`.

---

## 11. Test Strategy

### 11.1 Unit Tests

- environment classification and production-only requirements;
- endpoint HTTPS and timeout bounds;
- deterministic key generation and rejection of malformed IDs;
- no filename/PII leakage in keys;
- provider error classification and sanitization;
- state-transition legality and conditional update behavior;
- SHA-256, size, ETag normalization, and version handling;
- safe `Content-Disposition` and response headers;
- readiness PASS/FAIL matrix and cache expiry;
- M13 dispatch remains byte-for-byte compatible;
- `m15.v1` validation, canonicalization, checksums, and structured references;
- retention candidate selection and idempotency fingerprints.

### 11.2 Route and Contract Tests

- upload `401/403/400/429/503/success` contracts;
- upload never returns `pending_upload` or `quarantined` rows;
- metadata serializers never expose storage internals;
- download `401`, non-disclosing cross-owner `404`, deleted `410`, provider `503`, and streamed success;
- download headers prevent sniffing and shared caching;
- DELETE is owner-scoped, idempotent, and transitions to `delete_pending`;
- retention execution is admin-only, no-store, audited, bounded, and replay-safe;
- readiness response preserves four checks and remains blocked by Billing after storage passes.

### 11.3 Object-Store Integration Tests

Run against an isolated MinIO/S3-compatible test service, never mocks alone:

- put/get/head/delete round trip;
- version ID and checksum metadata behavior;
- private/anonymous access rejection;
- access denied, missing object, timeout, throttling, and retry behavior;
- same-key same-checksum retry succeeds idempotently;
- same-key different-checksum collision fails closed;
- stream integrity for JPEG, PNG, and WebP;
- compensating delete and orphan reconciliation;
- retention purge and noncurrent-version policy assumptions.

### 11.4 PostgreSQL Integration Tests

- clean migration and full-lineage migration apply;
- state and checksum constraints reject invalid rows;
- unique object reference prevents collisions;
- pending row is invisible to active reads;
- concurrent finalize/delete cannot revive an asset;
- owner-scoped queries prevent cross-owner disclosure;
- backfill resumes after interruption without duplicate rows or objects;
- active local-row count gates readiness;
- object upload success plus DB failure is reconciled;
- DB success cannot claim availability before object verification.

### 11.5 Backup/Restore Integration Tests

- `m13.v1-v3` fixtures retain existing checksums and outcomes;
- `m15.v1` backup round trip with object-backed assets;
- missing object, wrong size, wrong checksum, wrong version, and unknown alias block preview;
- transient provider failure is distinguished from definitive missing object;
- restore performs no destructive database step before reference verification;
- safety backup must be `m15.v1` for object-backed current state;
- rollback restores metadata and resolves the original protected object versions;
- backup artifact contains no credentials, physical bucket, endpoint, or signed URL.

### 11.6 Migration Tests

- complete manifest migration;
- restart after every migration phase;
- source missing, unsafe path, symlink escape, corrupt size, destination collision, and provider outage;
- concurrent reads during backfill return identical bytes;
- new uploads during backfill are object-only;
- rollback observation window retains verified local copies;
- final audit proves zero production local imports and zero active local rows.

### 11.7 Production Readiness Gate

Required commands and evidence:

```text
npm run prisma:validate
npm run prisma:generate
npm run db:test:migrate
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
npm run test:e2e:real
```

Additionally required:

- isolated object-store integration suite;
- full PostgreSQL storage migration suite;
- M8 upload/analyze/review/finalize regression;
- complete M13 legacy backup regression;
- M15 backup/restore drill;
- production-like private-bucket policy inspection;
- canary upload/download/delete and cross-owner denial;
- process restart and multi-instance read test;
- static scan for `fs`, `.storage/images`, raw storage fields in API responses, and provider credentials;
- migration manifest reconciliation report;
- readiness evidence showing storage `PASS`, business persistence `PASS`, Billing `FAIL`, and global `NOT_READY` until Billing closure.

---

## 12. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Database/object-store partial commit | Orphan object or unavailable metadata | Explicit state machine, conditional finalization, compensating delete, reconciler |
| Existing local files are missing or host-bound | Unmigratable assets | Mandatory preflight manifest, checksum inventory, abort cutover on discrepancy |
| Cross-owner object access | Severe privacy breach | Owner-scoped DB query before provider access, private bucket, no direct URLs, isolation tests |
| Object key exposes PII | Privacy leakage in provider logs | UUID-only deterministic keys, original filename stored only as metadata |
| Credential or signed URL leakage | Bucket compromise | Workload identity, no presigned flow, log masking, no secrets in DB/backups/readiness |
| Provider outage or throttling | Upload/download outage | Bounded SDK retries, timeouts, stable 503, observability; no unsafe local fallback |
| Checksum mismatch or silent corruption | Wrong image served/restored | SHA-256 over normalized bytes, metadata verification, version pinning, fail closed |
| Legacy M13 semantic drift | Restore regression | Immutable legacy dispatch and fixtures; additive `m15.v1` only |
| Backup gives false confidence | Metadata restored without bytes | Explicit external-object contract, HEAD/checksum verification, version protection, restore drill |
| Retention deletes rollback objects | Irrecoverable rollback | Versioning, lifecycle hold window, safety-backup version protection |
| Zero-downtime dual-source inconsistency | Different bytes across instances | New writes object-only, row-level verified switch, temporary read-only legacy fallback only |
| Readiness overloads provider/database | Self-inflicted outage | Indexed invariant query, bounded canary, short TTL cache, no unbounded list |
| Large memory usage during upload/download | Process pressure | Existing 8 MiB upload bound; streaming downloads; no unbounded buffering |
| Bucket alias maps incorrectly by environment | Wrong restore target | Deployment mapping validation, alias allowlist, pre-destructive restore verification |

---

## 13. Rollback Plan

### 13.1 Before Object-Only Writes

- roll back application code;
- leave additive columns and indexes unused;
- bucket and objects may remain isolated;
- storage readiness returns `FAIL`;
- no data conversion has occurred.

### 13.2 During Backfill

- stop migration workers;
- retain uploaded objects and migration manifest;
- roll application reads back to local for legacy rows;
- object-backed new uploads cannot be made local automatically; keep the M15 read path available or put upload/download surfaces into controlled `503` maintenance mode;
- never rewrite object-backed rows to local without a verified reverse-copy procedure.

### 13.3 After Read Cutover, Before Local Cleanup

- keep additive schema and object metadata;
- re-enable temporary local reads only for rows whose original local file and checksum are verified;
- keep new object-backed assets on the M15 read path;
- if mixed-version application rollback cannot understand object rows, block affected image routes with controlled `503` rather than return missing/corrupt data;
- use a forward fix as the preferred recovery.

### 13.4 After Local Cleanup or `m15.v1` Backups

- do not deploy pre-M15 code against production data;
- preserve bucket, versions, aliases, and all additive database fields;
- disable writes if necessary, keep authenticated reads on the object adapter, and forward-fix;
- restore only from a verified `m15.v1` safety backup plus protected object versions;
- never drop M15 columns, delete the bucket, or expire protected versions as rollback actions.

### 13.5 Rollback Validation

Every rollback drill must prove:

- metadata and byte reads remain owner-safe;
- no object version required by current rows or safety backup is deleted;
- pending/orphan/delete-pending sets are reconciled;
- readiness returns `FAIL` whenever the approved production storage path is unavailable;
- Billing and other independent blocker statuses are unchanged.

---

## 14. Estimated File Change Inventory

This is the exact planned implementation inventory. Any additional production file requires plan amendment and approval.

### 14.1 New Files

- `web/src/lib/object-storage.ts`
- `web/src/lib/object-storage-s3.ts`
- `web/src/lib/object-storage-config.ts`
- `web/src/lib/object-storage-errors.ts`
- `web/src/lib/image-asset-storage-repository.ts`
- `web/src/lib/image-asset-storage-reconciliation.ts`
- `web/src/lib/image-asset-storage-retention.ts`
- `web/src/app/api/v1/image-assets/[id]/download/route.ts`
- `web/src/app/api/v1/ops/storage/retention/run/route.ts`
- `web/scripts/migrate-local-images-to-object-storage.ts`
- `web/scripts/verify-object-storage-migration.ts`
- `web/prisma/migrations/20260727_m15a_object_storage_metadata/migration.sql`
- `web/prisma/migrations/20260727_m15b_object_storage_cutover_guards/migration.sql`
- `web/src/lib/object-storage.test.ts`
- `web/src/lib/object-storage-config.test.ts`
- `web/src/lib/image-asset-storage-repository.test.ts`
- `web/src/lib/image-asset-storage-retention.test.ts`
- `web/src/app/api/v1/image-assets/[id]/download/route.test.ts`
- `web/src/app/api/v1/ops/storage/retention/run/route.test.ts`
- `web/tests/integration/m15-object-storage.integration.test.ts`
- `web/tests/integration/m15-object-storage-postgresql.integration.test.ts`
- `web/tests/integration/m15-object-storage-migration.integration.test.ts`
- `web/tests/integration/m15-backup-restore-object-storage.integration.test.ts`
- `web/docs/M15_OBJECT_STORAGE_RUNBOOK.md`
- `docs/milestones/M15_CLOSING_REPORT.md` (created only at closure)

### 14.2 Existing Files Expected to Change

- `web/package.json`
- `web/package-lock.json`
- `web/prisma/schema.prisma`
- `web/src/lib/image-storage.ts`
- `web/src/lib/image-analysis-service.ts`
- `web/src/lib/image-upload-validation.ts`
- `web/src/app/api/v1/uploads/route.ts`
- `web/src/app/api/v1/image-assets/[id]/route.ts`
- `web/src/app/api/v1/image-analyses/[assetId]/route.ts`
- `web/src/lib/env-core-gate.ts`
- `web/src/lib/env-core-gate.test.ts`
- `web/src/lib/production-guards.ts`
- `web/src/lib/production-guards.test.ts`
- `web/src/lib/contracts.ts`
- `web/src/lib/backup-v13-artifact.ts`
- `web/src/lib/backup-v13-artifact.test.ts`
- `web/src/lib/backup-v13-restore-preview.ts`
- `web/src/lib/backup-v13-restore-preview.test.ts`
- `web/src/lib/backup-v13-restore-execution.ts`
- `web/src/lib/backup-v13-restore-execution.test.ts`
- `web/src/lib/ops-persistence.ts`
- `web/tests/integration/m13-backup-verification.integration.test.ts`
- `web/tests/integration/m13-backup-restore-execution.integration.test.ts`
- `web/tests/e2e/milestone9-real-e2e.spec.ts`
- `web/README.md`
- `docs/production/PRODUCTION_BLOCKERS_REGISTER.md` (closure only)
- `docs/roadmap-reconciliation/RGATE_PRODUCTION_READINESS_CHECKLIST.md` (closure evidence only)

### 14.3 Conditional Files

These files may change only if focused tests prove their fixtures encode the old external-reference shape:

- `web/tests/integration/m13-backup-restore-preview.integration.test.ts`
- `web/tests/integration/consultation-backup-v3.integration.test.ts`
- `web/src/lib/backup-v13-restore-observability.test.ts`
- `web/playwright.config.ts`
- `web/start-dev-for-e2e.js`

No other Prisma migration may be edited. Existing migration SQL is immutable.

---

## 15. Acceptance and Closure Gates

M15 is accepted only when:

1. provider, schema, API, security, migration, backup/restore, test, and rollback decisions in this plan are implemented without unapproved scope expansion;
2. every active production asset is object-backed and verified;
3. production local write and fallback paths are disabled;
4. storage readiness is derived and `PASS` under production-like validation;
5. `PR-C-003` and `PR-D-002` have closure evidence;
6. M13 legacy regression is green with unchanged fixtures/checksums;
7. M8 image workflow regression is green;
8. private-bucket, encryption, versioning, IAM, retention, and restore evidence is attached;
9. zero-downtime migration and rollback drills are documented and reproducible;
10. full lint, typecheck, Vitest, PostgreSQL integration, object-store integration, build, and Playwright gates pass;
11. an audit confirms no secret or storage locator leaks through API, logs, backup JSON, or readiness;
12. the closure report is reviewed before blocker status changes or Git checkpoint creation.

---

## 16. Approval Boundary

This document is planning-only. No application code, schema, dependency, infrastructure, migration, or blocker-status change is authorized until explicit review and approval.

Implementation must begin with Phase 0 and stop on any migration abort condition. Any change to direct-download policy, backup binary coverage, provider class, retention semantics, protected components, or the file inventory requires a revised plan.