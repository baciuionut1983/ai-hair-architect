# M15 Phase 1 Object Storage Runbook

## Scope

Phase 1 provides an unused S3-compatible adapter, configuration validation, additive PostgreSQL metadata, and isolated tests. It does not change upload, download, delete, image analysis, M13 backup/restore, or production readiness behavior.

PostgreSQL remains authoritative for `ImageAsset` metadata. No existing route imports the object-storage adapter or repository. The legacy `storagePath` remains required and unchanged.

## Production Configuration

Production runtime requires:

- `OBJECT_STORAGE_BACKEND=s3`
- `OBJECT_STORAGE_BUCKET_ALIAS`: stable logical alias persisted with metadata; never the physical bucket name
- `OBJECT_STORAGE_BUCKET`: private physical bucket supplied by deployment configuration
- `OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION`: explicit `AES256` or `aws:kms`; production rejects a missing, unknown, or `none` value

Optional settings:

- `OBJECT_STORAGE_ENDPOINT`: approved HTTPS S3-compatible endpoint; omit for AWS S3
- `OBJECT_STORAGE_FORCE_PATH_STYLE=true|false`, default `false`
- `OBJECT_STORAGE_KMS_KEY_ID`: optional KMS key identifier when `OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION=aws:kms`
- `OBJECT_STORAGE_PREFIX`, default `v1`
- `OBJECT_STORAGE_REQUEST_TIMEOUT_MS`, integer `250..30000`, default `10000`

Use workload identity or the standard AWS SDK credential chain. Do not place access keys, secret keys, session tokens, physical bucket names, endpoints, or object keys in source control, API responses, logs, or test artifacts.

Development and test do not require S3 settings when the backend is inactive. When S3 is active, `OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION=none` explicitly omits the `ServerSideEncryption` request property and is permitted only outside production; `AES256` sends exactly `ServerSideEncryption: "AES256"`. Production rejects a missing, `none`, unknown, local, partial, insecure, or malformed configuration. No provider is inferred from the endpoint or hostname. Configuration validation does not mark storage readiness as passing.

## Bucket Controls

Before a later phase connects runtime traffic, the approved production bucket must have:

- all public access blocked and ACLs disabled through bucket-owner-enforced ownership;
- TLS-only access;
- server-side encryption using AES-256 at minimum, with KMS preferred;
- object versioning enabled;
- lifecycle rules reviewed against retention and rollback windows;
- residency and region approved;
- request-path credentials restricted to the configured bucket and application prefix.

The Phase 1 runtime role needs only the equivalent of:

- `s3:PutObject`
- `s3:GetObject`
- `s3:GetObjectVersion`
- `s3:DeleteObject`
- `s3:DeleteObjectVersion`

Bucket listing, bucket creation/deletion, policy administration, presigning, and multipart permissions are not required by the adapter. Isolated integration-test provisioning may use a separate test-only principal that can create and delete synthetic buckets.

## Object Identity

The canonical PII-free key is:

```text
v1/owners/<ownerUserId>/assets/<assetId>/original
```

Only trusted UUID owner and asset identifiers are accepted by the key builder. Original filenames, email addresses, client data, MIME types, and physical bucket names are excluded.

Every user-facing repository lookup requires both `ownerUserId` and `assetId`. Phase 1 exposes no asset-only lookup and does not mutate lifecycle state.

## Isolated Object-Store Test

The integration suite is skipped unless all activation conditions are explicit:

```text
M15_OBJECT_STORAGE_INTEGRATION=isolated
OBJECT_STORAGE_BACKEND=s3
OBJECT_STORAGE_ENDPOINT=<non-AWS isolated S3-compatible endpoint>
OBJECT_STORAGE_BUCKET_ALIAS=<synthetic logical alias>
OBJECT_STORAGE_BUCKET=<test-only placeholder bucket>
OBJECT_STORAGE_REGION=<test region>
OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION=none
```

Supply credentials only through the SDK credential chain in the test process. The suite requires the explicit `none` mode, rejects an implicit AWS endpoint, generates a unique bucket and prefix, writes three synthetic bytes, verifies `put/head/get/delete`, verifies object absence, and deletes the bucket. It never accesses `.storage/images`.

Run it with:

```powershell
npm.cmd run test -- tests/integration/m15-object-storage.integration.test.ts
```

## PostgreSQL Migration Verification

Validate the schema and apply migrations only to a database whose name is explicitly test-classified:

```powershell
npm.cmd run prisma:validate
node scripts/validate-test-db.js --verbose
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npx.cmd prisma migrate deploy
npm.cmd run test -- tests/integration/m15-object-storage-postgresql.integration.test.ts
```

M15a adds only nullable columns, an enum, and indexes. It does not alter or backfill `storagePath`, assign a storage state, or classify legacy rows as object-backed.

## Failure and Rollback

Provider errors are translated to safe internal categories: `not_found`, `access_denied`, `timeout`, `throttled`, `configuration`, and `provider_unavailable`. Provider messages and configuration values are not exposed by public error text. Requests use bounded timeouts and SDK retry limits.

Phase 1 rollback is application-only: the adapter and repository are unused, so removing their future deployment has no runtime data-path effect. The additive database columns may remain nullable and unused. Do not edit migration history, remove columns, backfill rows, delete local artifacts, or enable filesystem fallback as part of rollback.

## Phase Boundary

The following remain reserved for later approved phases:

- endpoint or service cutover;
- object-backed upload and private download;
- `m15.v1` backup/restore changes;
- dual-read, object-only writes, backfill, retention execution, and reconciliation;
- production storage readiness transition from `FAIL`.