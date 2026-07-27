# M15 Phase 0 - Read-Only Storage Baseline and Inventory Report

**Date:** 27 iulie 2026
**Status:** Phase 0 inventory completed; Phase 1 is `NO-GO` pending the decisions in section 12
**Execution mode:** Read-only database and filesystem inspection
**Implementation authorization:** Not granted

---

## 1. Scope and Safety Boundary

This report inventories the `ImageAsset` rows visible through the locally configured development `DATABASE_URL` and the local image storage root used by the official `web` workspace.

The inventory was produced by `web/scripts/inventory-image-storage-readonly.js`. The script:

- executes only a database connectivity `SELECT`, Prisma `findMany`, and filesystem read/stat/hash operations;
- does not update the database;
- does not write, rename, copy, upload, or delete files;
- does not follow symbolic links while traversing storage;
- emits no database URL, local path, filename, asset ID, owner ID, client data, or other personal data;
- uses SHA-256 only for aggregate duplicate detection and does not emit hashes.

No Prisma schema, migration, dependency, upload/download/delete path, image-analysis path, M13 contract, readiness check, blocker status, staging area, commit, or remote was changed.

### 1.1 Classification Definitions

- **Active:** an `ImageAsset` row whose `deletedAt` is null. A row may be active and still have a file-integrity finding.
- **Deleted:** an `ImageAsset` row whose `deletedAt` is set.
- **Incomplete:** a row whose `storagePath` is blank or equals `pending`. This is an integrity classification and may overlap lifecycle state.
- **Orphan file:** a regular file under the authorized storage root that is not referenced by an accessible `ImageAsset.storagePath` in the inspected database.
- **Duplicate:** two or more readable regular files with identical SHA-256 content. Hash values and file identities are not reported.

---

## 2. Executive Result

The inspected database contains no `ImageAsset` rows. The storage root exists and contains 222 regular files totaling 209,160 bytes. Because there are no database rows, all 222 files are orphan files relative to this database baseline.

No missing, inaccessible, symbolic-link, outside-root, or metadata inconsistency can be attributed to an `ImageAsset` row because no rows exist. The storage tree itself contains no detected symbolic links, inaccessible entries, or non-regular entries.

The immediate technical backfill workload for database-linked assets is zero. However, Phase 1 must not start until reviewers confirm that the inspected database is the intended environment and approve the treatment of the 222 orphan files. Their content was hashed but not opened for semantic identification.

---

## 3. Exact ImageAsset Inventory

| Metric | Result |
|---|---:|
| Total `ImageAsset` rows | 0 |
| Active rows | 0 |
| Deleted rows | 0 |
| Incomplete references | 0 |
| Metadata-declared bytes | 0 |
| Accessible bytes referenced by rows | 0 |
| Distinct owners represented | 0 |

This is an exact result for the database selected by the existing ignored `web/.env` configuration at inventory time. It is not evidence that another development, staging, or production database has no assets.

---

## 4. Aggregated and Anonymized Distribution

### 4.1 Lifecycle Status

| Status | Assets | Share |
|---|---:|---:|
| Active | 0 | not applicable |
| Deleted | 0 | not applicable |
| Incomplete | 0 | not applicable |

### 4.2 Owner Distribution

No owner aliases were generated because no `ImageAsset` rows exist. There are therefore no owner-level counts or byte totals to expose.

The inventory script assigns aliases such as `owner-001` from a stable hash ordering when rows exist; raw owner identifiers are never emitted.

---

## 5. Storage Root Inventory

| Metric | Result |
|---|---:|
| Storage root present | yes |
| Regular files | 222 |
| Total regular-file bytes | 209,160 bytes |
| Orphan files relative to inspected DB | 222 |
| Orphan bytes | 209,160 bytes |
| Symbolic links | 0 |
| Symbolic links resolving outside root | 0 |
| Inaccessible entries | 0 |
| Non-regular entries | 0 |

No local paths, directory names below the storage root, or filenames were captured in this report.

---

## 6. Reference and Integrity Findings

### 6.1 Missing, Inaccessible, Unsafe, and Symlink References

| Finding | Referenced assets |
|---|---:|
| Missing file | 0 |
| Inaccessible file | 0 |
| Path outside authorized storage root | 0 |
| Symbolic-link reference | 0 |
| Non-regular file reference | 0 |

These zeroes mean that no database reference exhibited the finding. Because the database has zero rows, they must not be interpreted as proof that the orphan files belong to valid assets.

### 6.2 Metadata Inconsistencies

| Finding | Assets |
|---|---:|
| Persisted size differs from physical size | 0 |
| Non-positive or invalid `sizeBytes` | 0 |
| Unsupported MIME type | 0 |
| Active row with retention deadline | 0 |
| Deleted row without retention deadline | 0 |
| Invalid normalized orientation | 0 |
| EXIF not marked stripped | 0 |

There are no database rows on which metadata consistency can be evaluated. The orphan condition is the only blocking inventory discrepancy.

---

## 7. SHA-256 Duplicate Analysis

### 7.1 Database-Referenced Assets

| Metric | Result |
|---|---:|
| Duplicate groups | 0 |
| Files in duplicate groups | 0 |
| Redundant bytes | 0 |

### 7.2 Entire Storage Root

| Metric | Result |
|---|---:|
| Duplicate groups | 2 |
| Files in duplicate groups | 221 |
| Largest group | 219 files |
| Second group | 2 files |
| Redundant bytes | 208,197 bytes |
| Unique-content files outside duplicate groups | 1 |

Duplicate detection proves byte equality only. It does not establish ownership, business identity, test provenance, or whether deletion is safe. No deduplication is authorized in Phase 0.

---

## 8. Backfill Duration Estimate

### 8.1 Database-Linked Workload

- Migratable active assets: `0`.
- Migratable deleted assets: `0`.
- Declared bytes to transfer: `0`.
- Estimated object-transfer time: effectively `0`, excluding provisioning and validation overhead.

### 8.2 Orphan Triage Workload

The 222 orphan files total only 209,160 bytes, so network transfer volume would be negligible. Transfer speed is not the constraint. Ownership and provenance are absent, and an object-storage key cannot be safely constructed without a trusted `ownerUserId` and `assetId`.

Estimated operational time after a disposition policy is approved:

- automated re-scan and manifest comparison: less than 1 minute at the observed volume;
- technical checksum and storage-root verification: less than 1 minute;
- manual environment/provenance decision: approximately 15-60 minutes, depending on whether the files are confirmed as disposable test artifacts or require recovery from another database;
- backfill of the current database-linked set: no transfer work;
- if matching metadata is later recovered, provider provisioning, canary validation, migration rehearsal, and rollback evidence dominate the schedule rather than the 209,160-byte payload.

### 8.3 Backfill Risks

- The database and storage root may come from different environment snapshots.
- Orphan files cannot be assigned to owners safely from directory structure alone.
- The two large duplicate groups may be repeated test fixtures, but Phase 0 does not prove that hypothesis.
- Importing orphan files without recovered metadata would fabricate ownership and violate owner isolation.
- Deleting orphan files before provenance review could destroy recoverable development evidence.
- A zero-row local database must not be generalized to staging or production.

---

## 9. Provider Recommendation

### 9.1 Recommended Production Provider: AWS S3

AWS S3 is recommended as the default production provider behind the S3-compatible application contract because it provides:

- mature IAM and workload-identity integration;
- Block Public Access and bucket-owner-enforced ownership;
- native versioning and lifecycle controls required by rollback and retention;
- server-side encryption with provider-managed keys or AWS KMS;
- object checksums, conditional operations, audit integration, durability, and operational documentation;
- direct compatibility with AWS SDK for JavaScript v3 without provider-specific translation.

### 9.2 Alternative S3-Compatible Provider

Cloudflare R2, Backblaze B2 S3 API, MinIO, or another approved provider can satisfy the application abstraction, but each requires explicit validation of:

- version ID and noncurrent-version semantics;
- checksum headers and `HEAD` behavior;
- conditional create/overwrite protection;
- encryption and key-management guarantees;
- IAM granularity and private-access enforcement;
- lifecycle behavior, egress model, regional residency, SLA, and incident support.

MinIO remains recommended for isolated integration tests, not as the default production recommendation without a separately approved highly available operations model.

### 9.3 Decision Rationale

The application should standardize on the S3 API, while production should initially use AWS S3 unless cost, data residency, or platform constraints justify another provider. Portability is preserved at the adapter boundary, but recovery semantics must be qualified per provider; API compatibility alone is insufficient.

---

## 10. Exact Proposed Phase 1 File Inventory

Phase 1 remains unapproved. If approved without scope amendment, the exact proposed repository paths are:

### 10.1 New Production Files

- `web/src/lib/object-storage.ts`
- `web/src/lib/object-storage-s3.ts`
- `web/src/lib/object-storage-config.ts`
- `web/src/lib/object-storage-errors.ts`
- `web/src/lib/image-asset-storage-repository.ts`
- `web/prisma/migrations/20260727_m15a_object_storage_metadata/migration.sql`

### 10.2 New Phase 1 Tests

- `web/src/lib/object-storage.test.ts`
- `web/src/lib/object-storage-config.test.ts`
- `web/src/lib/image-asset-storage-repository.test.ts`
- `web/tests/integration/m15-object-storage.integration.test.ts`
- `web/tests/integration/m15-object-storage-postgresql.integration.test.ts`

### 10.3 Existing Files Proposed for Modification

- `web/package.json`
- `web/package-lock.json`
- `web/prisma/schema.prisma`
- `web/src/lib/env-core-gate.ts`
- `web/src/lib/env-core-gate.test.ts`
- `web/README.md`

### 10.4 Phase 1 Operational Documentation

- `web/docs/M15_OBJECT_STORAGE_RUNBOOK.md`

Phase 1 must not modify upload, download, delete, image analysis, M13 backup/restore, `m13.v1-v3`, canonicalization, production readiness, or blocker status. If Phase 1 requires any path outside this list, implementation must stop for plan amendment and approval.

---

## 11. Phase 1 GO/NO-GO Criteria

### 11.1 Mandatory GO Conditions

Every condition must be satisfied:

1. Reviewer confirms that the database selected by the existing ignored `web/.env` is the intended M15 baseline environment.
2. A second inventory run at the approved baseline produces reproducible row/file/byte counts or any delta is explained.
3. The 222 orphan files receive an explicit disposition: confirmed disposable test artifacts, preserved outside migration scope, or matched to recovered authoritative metadata.
4. No orphan is imported by inferring owner or asset identity from a path.
5. AWS S3 or a named alternative provider is architecturally approved.
6. Private bucket, encryption, versioning, lifecycle, region, and IAM policies are approved.
7. Workload identity/credential-chain policy is approved; static credentials in tracked configuration remain prohibited.
8. The S3 compatibility requirements for checksum, `HEAD`, conditional writes, version IDs, and delete behavior are accepted.
9. The additive `ImageAsset` fields, nullable M15a transition state, indexes, and SQL checks are approved.
10. The exact Phase 1 file inventory in section 10 is approved.
11. The M14 Git baseline is identified and a separate authorization is given before any Phase 1 checkpoint operation.
12. Phase 1 validation environment is isolated from external production objects and permits no use of real customer data.
13. Rollback for additive schema and unused object-storage components is reviewed.
14. Phase 1 explicitly retains `STORAGE_PRODUCTION_POLICY_READY=FAIL` and does not alter blocker status.

### 11.2 Automatic NO-GO Conditions

Any condition produces `NO-GO`:

- baseline database identity is ambiguous;
- orphan disposition is absent;
- any active asset is discovered with a missing, inaccessible, outside-root, symlink, size-mismatch, or owner ambiguity finding;
- provider/versioning/encryption/IAM decisions remain unresolved;
- Phase 1 requires upload/download/delete or M13 behavior changes;
- schema change becomes destructive or edits an existing migration;
- credentials would need to be stored in tracked files;
- the proposed file scope expands without approval;
- a staging, commit, push, external upload, delete, or live object-store probe is requested without separate authorization.

### 11.3 Current Decision

**Current result: `NO-GO` for Phase 1.**

Technical volume is not blocking: there are zero database-linked assets and only 209,160 orphan bytes. The blockers are evidentiary and architectural:

- confirmation that the inspected zero-row database is the intended baseline;
- approved disposition for the 222 orphan files;
- provider, bucket policy, identity, lifecycle, and additive-schema approval;
- explicit approval of the Phase 1 file scope.

---

## 12. Decisions Required Before Phase 1

1. Confirm or replace the baseline database/environment used for inventory.
2. Classify the orphan storage tree without exposing or fabricating owner identity.
3. Approve preservation, quarantine outside migration scope, or deletion in a separately authorized operation; Phase 0 performs none of these.
4. Approve AWS S3 or name the alternative S3-compatible provider.
5. Approve region, data residency, encryption mode, versioning, lifecycle, and rollback hold period.
6. Approve workload identity and operational-role boundaries.
7. Approve the additive M15a schema contract and exact Phase 1 file inventory.
8. Decide whether a Git checkpoint is authorized after Phase 0 review; none has been created.

---

## 13. Phase 0 Closure Statement

Phase 0 read-only inventory is complete for the currently configured local baseline. No implementation work is authorized by this report. The project remains frozen pending review of the `NO-GO` conditions and explicit Phase 1 approval.