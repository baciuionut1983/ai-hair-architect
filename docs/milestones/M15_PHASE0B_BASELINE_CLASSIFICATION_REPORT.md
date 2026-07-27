# M15 Phase 0B - Baseline Verification and Anonymous Storage Classification

**Date:** 27 iulie 2026
**Mode:** Read-only
**Conclusion:** `STORAGE CONTENT IS TEST/FIXTURE DATA`
**Phase 1 status:** `NO-GO` remains in force

---

## 1. Scope and Safety

Phase 0B verified the locally selected PostgreSQL baseline, classified the 222 existing storage files anonymously, compared content only through SHA-256, and searched for configured storage roots only inside the repository.

The analysis used `web/scripts/classify-image-storage-baseline-readonly.js`. It performs only:

- local configuration-key discovery without printing values;
- PostgreSQL `SELECT` and Prisma count queries;
- repository-bounded directory traversal;
- filesystem read/stat operations;
- magic-byte inspection and in-memory SHA-256;
- in-memory normalization of repository image samples for checksum comparison.

It does not write to the database or filesystem, follow symlinks, upload/delete objects, expose secrets, emit hashes, or report raw IDs, personal data, filenames, or absolute paths.

No Phase 0 script was modified. No schema, migration, dependency, image flow, M13 backup/restore, readiness, blocker register, staging area, commit, or remote was changed.

---

## 2. PostgreSQL Baseline Identity

| Property | Verified result |
|---|---|
| Configuration source | `web/.env` |
| Logical database name | `ai_hair_architect_test` |
| Host classification | local |
| PostgreSQL schema | `public` |
| Database URL exposed | no |
| Username/password/port exposed | no |

Host classification uses only `local`, `container`, or `remote`. No hostname or connection endpoint is retained in this report.

### 2.1 Row Counts

| Model | Rows |
|---|---:|
| Client | 16 |
| Consultation | 8 |
| Analysis | 8 |
| Appointment | 0 |
| Notification | 0 |
| ImageAsset | 0 |

The database is unambiguously a local test database, not a production database. Its non-image business rows show that it is populated partially, while the zero `ImageAsset` count is consistent with automated cleanup that deletes image metadata after tests.

---

## 3. Storage Classification

### 3.1 Extension

| Extension | Files |
|---|---:|
| `.jpg` | 222 |

### 3.2 Size Distribution

| Size interval | Files |
|---|---:|
| 0 B | 0 |
| 1-1023 B | 222 |
| 1-9 KiB | 0 |
| 10-99 KiB | 0 |
| 100-1023 KiB | 0 |
| 1-7 MiB | 0 |
| 8 MiB or larger | 0 |

Total size remains 209,160 bytes.

### 3.3 Magic Bytes and Real Content Type

| Detected type | Files |
|---|---:|
| Valid JPEG | 219 |
| Non-image or unknown | 3 |
| Other valid image types | 0 |

- Valid images: **219**.
- Invalid/non-image files: **3**.
- Extension versus magic-byte mismatches: **3**.

Magic-byte validity confirms format signatures only; it does not inspect image subject matter or personal content.

### 3.4 Approximate Modification Date

All files were modified during July 2026.

| Day | Files |
|---|---:|
| 18 July 2026 | 5 |
| 19 July 2026 | 186 |
| 25 July 2026 | 1 |
| 26 July 2026 | 30 |

The concentration into four test-development days, especially the 186-file burst, is consistent with repeated automated suite execution rather than a varied manual image collection.

---

## 4. Duplicate Groups

Exactly three unique content hashes exist across 222 files.

| Anonymous group | Files | Bytes/file | Total bytes | Real type | Normalized fixture match |
|---|---:|---:|---:|---|---:|
| duplicate-group-1 | 219 | 955 | 209,145 | JPEG | 219 |
| duplicate-group-2 | 2 | 7 | 14 | non-image | 0 |
| unique content | 1 | 1 | 1 | non-image | 0 |

No SHA-256 value is included in the report.

The dominant group accounts for approximately 98.6% of files and 99.99% of bytes. The second group and unique one-byte item are compatible with tiny synthetic payloads used by backup/restore tests; no semantic content inspection was performed.

---

## 5. Repository Fixture Comparison

Five current repository fixture/sample candidates were hashed:

| Comparison | Result |
|---|---:|
| Candidate repository samples | 5 |
| Unique raw sample hashes | 5 |
| Storage files identical to raw samples | 0 |
| Unique raw sample hashes matched | 0 |
| Unique normalized sample hashes | 2 |
| Storage files identical to normalized samples | 219 |

The zero raw match is expected because the upload path transforms accepted images through the existing Sharp normalization before writing storage bytes. The classifier reproduced that in memory and compared SHA-256 only. All 219 valid JPEG storage files match a normalized repository sample exactly.

No fixture was modified, and no normalized output was written to disk.

---

## 6. Anonymous Layout Classification

| Layout signal | Files |
|---|---:|
| Three relative path segments | 222 |
| Canonical two-UUID directory layout | 221 |
| Noncanonical/non-UUID directory layout | 1 |
| One file per leaf directory | 222 |

The canonical layout is the application pattern `owner / asset / object`, but no directory value was emitted. The 221 canonical entries prove application-generated storage placement, not ownership validity after their database rows were removed.

---

## 7. Other Storage Roots

Repository-bounded source inspection found one configured application storage root:

| Logical root | Role | Source references |
|---|---|---:|
| `.storage/images` | image bytes and M13 external-reference verification | 4 |

No separate `public/uploads`, configurable upload directory, second local storage root, or other filesystem upload destination was found in application source.

The scan did not traverse outside the repository. Phase 0/0B scripts were excluded from application-root conclusions, and no absolute path is reported.

---

## 8. Provenance Determination

### 8.1 Evidence

The following independent signals agree:

1. The selected database is explicitly a local test database.
2. `ImageAsset` has zero rows while test cleanup deletes image rows after execution.
3. The real E2E flow writes images through the production upload/normalization/storage path.
4. Cleanup removes database rows but does not remove corresponding filesystem objects.
5. 219 files are byte-identical after the exact repository fixture normalization pipeline.
6. 219 files form one duplicate group and 221 use the two-UUID runtime layout.
7. Modification times are concentrated on four test-development days.
8. Tiny non-image objects are compatible with synthetic M13 external-reference tests.
9. No raw repository fixture was copied directly into storage; valid files are normalized outputs.

### 8.2 Source Classification

| Candidate source | Assessment |
|---|---|
| Automated tests | high confidence; dominant source |
| Repository fixtures | high confidence as normalized test inputs |
| Repeated application executions | high confidence, specifically through repeated automated upload flows |
| Manual uploads | no positive evidence |
| Other source | possible only for the isolated noncanonical item; not needed to explain the aggregate |

### 8.3 Required Conclusion

**`STORAGE CONTENT IS TEST/FIXTURE DATA`**

Confidence is high for the aggregate and conclusive for the 219-file dominant group. The conclusion does not authorize deletion and does not assign current ownership to any orphan file.

---

## 9. Baseline Interpretation

The local baseline is confirmed as a **test baseline**:

- configuration source, database name, host type, schema, and counts are reproducible;
- database metadata and storage content reflect different cleanup lifetimes;
- the 222 files are not evidence of unmigrated production customer assets;
- no staging or production baseline was inspected or confirmed.

Therefore this report must not be used to claim that production has zero `ImageAsset` rows or only test data.

---

## 10. Conditions to Exit NO-GO

Phase 1 may leave `NO-GO` only when every applicable condition below is approved and evidenced:

1. **Baseline scope accepted:** reviewers explicitly accept `ai_hair_architect_test` as the Phase 1 development/test baseline, or provide a separately authorized target baseline for a new read-only inventory.
2. **Storage classification accepted:** reviewers accept the Phase 0B conclusion that current local storage is test/fixture output.
3. **Disposition decided without mutation:** the 222 files are explicitly classified as excluded test artifacts, retained test evidence, or candidates for a separately authorized cleanup. Phase 1 must not infer owners or migrate them as business assets.
4. **No deletion implied:** exclusion from backfill is approved independently from any future deletion authorization.
5. **Phase 1 data scope fixed:** Phase 1 schema/adapter tests use isolated synthetic data and do not treat the current orphan tree as production migration input.
6. **Provider approved:** AWS S3 or a named S3-compatible alternative is approved with versioning, encryption, private access, lifecycle, region, IAM, checksum, and conditional-write semantics.
7. **Credential policy approved:** workload identity or standard SDK credential chain is required; tracked static credentials remain prohibited.
8. **Additive schema approved:** proposed M15a fields, nullable transition, indexes, checks, rollback, and migration procedure receive explicit approval.
9. **Exact Phase 1 file scope approved:** no upload/download/delete, M13, readiness, or blocker changes are allowed in Phase 1.
10. **External environment boundary approved:** any object-store integration uses an isolated non-production bucket/service and synthetic data only.
11. **Repeatability gate passed:** a final pre-Phase-1 read-only run reproduces the database identity/counts and storage classification, or all deltas are reviewed.
12. **Git authorization remains separate:** no staging, checkpoint, commit, or push occurs without explicit approval.

### 10.1 Automatic NO-GO Conditions

`NO-GO` remains automatic if:

- the intended Phase 1 baseline is staging or production but has not been separately inventoried;
- any current orphan file would be assigned an owner or migrated without authoritative metadata;
- provider/security/schema decisions remain unresolved;
- Phase 1 expands into upload, download, delete, M13 backup/restore, readiness, or blocker status;
- cleanup, staging, commit, push, or external object operations are requested without separate approval.

---

## 11. Phase 0B Closure

Phase 0B is complete for the selected local test baseline. The evidence supports `STORAGE CONTENT IS TEST/FIXTURE DATA`; it does not support deletion, migration, or production-baseline claims.

Phase 1 remains `NO-GO` pending explicit acceptance of the baseline scope, test-data disposition, provider/security architecture, additive schema, and exact implementation scope.