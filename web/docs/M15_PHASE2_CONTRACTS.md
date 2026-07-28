# M15 Phase 2 Contracts Freeze

**Amendment status:** `m15.v2` hybrid recovery contract frozen on 28 July 2026; WP2H1 implementation is not authorized by this document.

## Scope

This document freezes contracts only. It does not activate object writes, change routes, implement recovery, or alter Prisma schema or migrations.

## Recovery Versioning

`m15.v1` remains strictly object-only and permanently compatible. Its shape, exact-key validation, parser, canonical serialization, checksum, fingerprint, dispatch, and semantics are immutable. Existing `m15.v1` artifacts are never relabeled or converted implicitly to `m15.v2`.

All backups newly created during the hybrid Phase 2 period use `m15.v2`. Zero assets produces an empty `m15.v2` image-asset section; local-only, object-only, and mixed owner state each produce `m15.v2`. Any inconsistent asset blocks the complete backup.

## Exact Object Identity

Phase 2 consumers use an exact object identity containing a non-empty `versionId`. The transitional Phase 1 provider interface remains compatible until Gate B, but it is not a valid Phase 2 runtime reference until converted with fail-closed validation.

An object-backed M15 reference contains exactly the logical backend, logical bucket alias, canonical PII-free key, exact non-empty provider version ID, lowercase SHA-256, and positive bounded normalized byte size. It never contains a physical bucket, endpoint, credential, token, public URL, presigned URL, or legacy `storagePath` interpretation.

Exact-version `HEAD`, `GET`, and destructive compensation are mandatory. Current/latest-version fallback is prohibited.

## `m15.v2` Hybrid `ImageAsset`

Every `m15.v2` image asset contains exactly these common business fields: `id`, `fileName`, `mimeType`, `sizeBytes`, `ownerUserId`, `clientId`, `exifStripped`, `normalizedOrientation`, `uploadedAt`, `deletedAt`, `retentionDeletesAt`, `createdAt`, and `updatedAt`. It also contains exactly one exact-key variant:

```ts
type BackupM15V2ImageAsset =
	| {
			storageKind: "legacy-local";
			legacyReference: {
				backend: "local";
				rootAlias: "legacy-images";
				relativePath: string;
				contentSha256: string;
				sizeBytes: number;
			};
		}
	| {
			storageKind: "object-backed";
			objectReference: {
				backend: "s3";
				bucketAlias: string;
				key: string;
				versionId: string;
				contentSha256: string;
				sizeBytes: number;
			};
		};
```

`legacy-local` additionally requires only `storageKind` and complete `legacyReference`. It forbids `storagePath`, `objectReference`, `storageEtag`, `storageState`, `storageMigratedAt`, `objectDeletedAt`, `lastStorageErrorCode`, and any object locator.

`object-backed` additionally requires `storageKind`, complete `objectReference`, and present keys `storageEtag`, `storageState`, `storageMigratedAt`, `objectDeletedAt`, and `lastStorageErrorCode`. It forbids `storagePath`, `legacyReference`, and any local root/path field. A restorable active row is `available`; a soft-deleted row may be `delete_pending` only while its exact object still exists. `objectDeletedAt` remains null. `pending_upload`, `quarantined`, `deleted`, lifecycle drift, or a non-safe error code blocks creation.

Unknown discriminator, absent discriminator, both payloads, payload/discriminator mismatch, missing key, additional key, or unsupported value invalidates the complete artifact. No third implicit variant exists.

The legacy path is canonical POSIX relative to logical root alias `legacy-images`. Absolute paths, drive letters, leading slash, empty/`.`/`..` segments, traversal, and symlink escape are prohibited. Owner and asset path segments must match the row identity. A legacy file must be a confined readable regular file and match required size and SHA-256 during creation. Missing or inconsistent bytes block the complete backup; no asset is omitted. An M13 absolute `storagePath` is never persisted in `m15.v2`.

The object-backed reference retains only `bucketAlias`, canonical PII-free `key`, exact `versionId`, `contentSha256`, and `sizeBytes`. Physical bucket, endpoint, credentials, tokens, public/presigned URLs, and latest-version fallback are prohibited.

## PostgreSQL Source Classification

A valid legacy source has `storageBackend` absent or `local`, null object state/reference metadata, and a safe verifiable local file. A valid object-backed source has `storageBackend=s3`, a complete exact-version reference, and coherent lifecycle metadata. Partial or contradictory metadata is inconsistent, maps to neither variant, and blocks creation of the complete backup without omission or implicit conversion.

All six approved domains are read owner-scoped in one `RepeatableRead` transaction. Classification and reference verification are fail-closed. A zero-asset, local-only, object-only, or mixed snapshot creates `m15.v2`; any inconsistent row creates no backup.

## State Machine

Phase 2 permits only:

- `pending_upload -> available`
- `pending_upload -> quarantined`
- `pending_upload -> delete_pending`
- `available -> delete_pending`

`delete_pending`, `deleted`, and `quarantined` cannot transition to `available`. Phase 2 does not implement `delete_pending -> deleted`; physical retention deletion remains outside this phase.

The asset UUID is the durable upload operation identity. It also binds the canonical owner/asset object key without requiring a schema amendment. Mutations additionally require bounded idempotency keys and conditional state/owner/key/version predicates in the later repository work package.

## Object-Write Mode

`OBJECT_STORAGE_WRITE_MODE` accepts only `disabled` or `enabled` and defaults to `disabled`. An invalid value resolves fail-closed to disabled with a typed configuration issue.

Enabled configuration alone never permits a write. Runtime eligibility also requires unexpired Gate B evidence for the expected logical bucket alias and PASS for every mandatory provider capability. Missing, stale, mismatched, failed, or malformed evidence blocks writes.

## Provider Capability Evidence

The `m15.provider-capabilities.v1` contract records only the backend class, logical bucket alias, issue/expiry timestamps, mandatory PASS/FAIL results, and safe error codes. It excludes physical provider locators and raw provider errors.

Mandatory capabilities are private access, bucket versioning, conditional create, custom metadata, configured encryption, exact-version HEAD/GET/DELETE, integrity, bounded timeout, and safe error classification.

## Safe Errors

Provider and contract failures use only the approved taxonomy: `not_found`, `access_denied`, `timeout`, `throttled`, `configuration`, `missing_version`, `integrity_mismatch`, `invalid_state`, `capability_unavailable`, and `provider_unavailable`. Only timeout, throttling, and provider unavailability are retryable by default. Raw provider details are never public error messages.

## Restore Boundary

The additive M15 branches cover only Clients, Analyses, Consultations, ImageAssets, ImageAnalyses, and ImageAnalysisReviews already governed by the backup contract. Billing, Webhooks, Appointments, auth, Notifications, and unrelated domains are prohibited. Existing `m13.v1-v3` behavior and object-only `m15.v1` remain unchanged.

`m15.v2` preview verifies legacy and object-backed references separately, validates every reference, and permits no filesystem/S3 fallback. Its response exposes no local path, object key, version ID, endpoint, or provider information. It uses fingerprint contract `m15.restore-preview.v2`; M13 and `m15.v1` fingerprints remain unchanged.

Future `m15.v2` execution must complete all legacy and exact-version object verification before any mutation and must restore metadata all-or-nothing. A missing legacy file or missing/mismatched exact object blocks execution. Partial restore, asset omission, latest-object fallback, cross-backend fallback, and reconstruction of local bytes from metadata alone are prohibited.

Any safety backup for state containing local, object-backed, or mixed assets must be complete `m15.v2`. M13 is prohibited as a safety backup for object-backed or mixed state. All required local files and exact object versions remain protected through the rollback window.

## Backfill Contract

Each legacy-to-object transition verifies the confined local file, uploads bytes, verifies exact version/size/SHA-256, conditionally updates PostgreSQL against unchanged legacy metadata, and retains the local source through the rollback window. Historical artifacts remain byte-for-byte unchanged.

New `legacy-local` creation may be disabled only after zero active legacy assets, rollback-window expiry, resolved retention for every historical backup that depends on local files, and separate explicit approval. Existing artifact parsing and restore compatibility are not removed implicitly.

## WP2H Work Package Order

1. `WP2H0` - architecture amendment documentation
2. `WP2H1` - contract and artifact core v2
3. `WP2H2` - legacy and hybrid reference verification
4. `WP2H3` - pure restore preview v2
5. `WP2H4` - preview runtime integration
6. `WP2H5` - creation and verification persistence
7. `WP2H6` - HTTP activation
8. `WP2H7` - restore execution core
9. `WP2H8` - execution runtime and route wiring

Every package requires a separate audit, exact allowlist, gates, approval, and implementation authorization. `WP2H0` does not authorize or begin `WP2H1`.

## Phase Boundary

WP2H0 modifies documentation only. It does not modify the S3 adapter, repository, upload orchestration, API routes, backup/recovery implementation, tests, runtime, Prisma schema, or migration history. Those surfaces remain blocked until their approved sequential work packages.