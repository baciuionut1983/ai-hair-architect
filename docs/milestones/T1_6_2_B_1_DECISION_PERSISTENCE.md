# T1.6.2.b.1 — append-only professional field decisions

Implementation baseline: `defdebdcef459c2e3dc574efb639c5a3b31ea56a`.

`professional-field-claim-decision-service.ts` exports submission and owner-scoped
state/history reads. This module has no production consumer. There are no routes,
UI, skill bindings, registry writes, eligibility changes or Brain integrations.

## Authority and persistence

The authenticated owner is a separate service argument; it must come from the
session at a future boundary. The request cannot supply owner/reviewer identity,
candidate value/resolution, allowed values or a specification object. The current
owner is also the reviewing professional in this stage.

Every submission runs in one RepeatableRead transaction: load the owned draft,
check DB lifecycle/evidence, derive the current b.0 candidate, compute the b.0.1
semantic specification pin and check the default approved goldens, compare caller
pins, read the latest revision, compare expectedRevision, validate the b.0 decision
and note, then return the identical current row or insert a new revision.

CONFIRMED persists only the server-derived canonical value. CORRECTED reuses the
same-field validator and must differ from a canonical candidate; unresolved and
unclear observations need an explicit valid professional correction. UNKNOWN and
REJECTED are distinct decisions with null professionalValue. “45° Interior” is
never inferred to be elevation, nor is a cutting-line value moved across fields.

`ProfessionalFieldClaimDecision` stores immutable revisions. Its composite FK
`(draftId, ownerUserId)` references the draft's new `(id, ownerUserId)` unique key;
`(draftId, field, revision)` is unique. The one additive migration is
`20260921000000_professional_field_claim_decisions`. Existing migration files are
unchanged. FK delete/update restrictions preserve history when a parent exists.
Application code exposes insert/read only; no triggers or privileged-DB immutability
claim is made. Test fixture cleanup uses direct local DB deletion.

## Revisions and staleness

Revision 0 means no decision. A stale expectedRevision always raises
REVISION_CONFLICT (409), even for identical content. A current identical semantic
decision returns UNCHANGED (200), retaining id/time/revision. A changed decision,
including note or authority-pin changes, returns CREATED (201) at revision + 1.
P2002/P2034 also become REVISION_CONFLICT, without retry. The client must reread.

Reads retain all history in ascending revision order and select only its final
row as latest. A stale latest row is returned with a canonical stale reason;
no older row substitutes for it. Null latest means unreviewed. No eligibility or
activation is implied by an available decision or by a null stale reason.

The b.1 DB-only gate checks APPROVED/non-superseded drafts, owner-scoped ACTIVE
private evidence and source-deletion markers, pointer consistency, referenced
image/video rows, capture-set member images, and their live owned clients.
Missing/foreign evidence fails closed. Image objectDeletedAt is also checked.
Capture sets have no deletion column; their DB source images/clients are checked.
Storage bytes, HEAD, strong source proof, and binding remain deferred. Lifecycle
checks reflect the RepeatableRead snapshot; later revocation makes reads stale.
The protected T1.5 lifecycle and its stronger storage proof are unchanged.

## Locked observation format

Rows store the exact b.0 observationDigest and its existing identifier,
`professional-field-observation-v1`, in observationDigestVersion. The hash is
SHA-256 of UTF-8 encoded canonical JSON containing digestVersion, candidate id,
field, specificationVersion, original observation, provenance, resolution and
normalizedValue. Object keys are recursively sorted; undefined object members
are omitted; arrays retain order; JSON string escaping is used. No whitespace
trimming or Unicode normalization is performed. Provenance commits to draft id,
sourceEvidenceId, extractorVersion and sourceExtractionField.

The b.0 encoder is reused without edits. Regression fixture:
`sha256:4c105ff02c4eef2aac2da9bd7c6f07d49144749a311b2a80c3b978e145d07b74`
for draft-1/evidence-1/extractor-1 and observed elevation 45_deg_graduation.
Historical version mismatches are stale, never silently reinterpreted. Future
format changes must explicitly version this contract before adoption.

SpecificationDigest is the approved semantic digest, never the test-only
implementation fingerprint. The field guard precedes governance lookup. Neither
caller-supplied nor alternate golden registries can authorize persistence.

## Verification

Focused tests cover the decision matrix, notes, pins, Unicode/whitespace digest
identity, lifecycle, ownership leakage, ordered immutable history, latest-stale
selection, current/stale idempotency, real concurrent submissions, unique/FK
constraints, P2002/P2034 and no retry. AST boundary tests enforce insert/read-only
service access, exact dependency imports and zero downstream consumers. Existing
a/b.0/b.0.1 tests and protected implementation fingerprints remain unchanged except
for the exact allowlisted b.1 service consumer in boundary tests.

Safe regressions cover T1.5, T1.6.1, Brain, reasoning/provider adapters, selectors,
ExecutionPlan, execution scenes and Technical Demonstration. Provider tests use
their existing mocks. No real provider calls or scratch-writing L5 suites run.
All DB work uses localhost/ai_hair_architect_test. No push or deployment is part of
this implementation; independent review precedes any release.

Verified results: 73 b.1 tests, 199 a/b.0/b.0.1 tests, and 511 safe regression
tests passed (783 distinct tests, 36 files). Prisma validation/generation and
typecheck passed. Changed-file lint is clean; full repository lint passed with
0 errors and 120 warnings in unchanged files. The production build passed with
11 existing filesystem-tracing warnings. All seven known untracked scratch JSON
files retained their baseline SHA-256 hashes.

The migration's five SQL statements match Prisma's generated baseline-to-current
delta exactly, ignoring comments/order/whitespace. Only this new migration was
applied to the established test DB. During development its empty new table and
new migration record were reapplied to correct the initial overlong index name;
no prior migration file or record was edited. The final test rerun passed.
An additional whole-test-database/schema comparison reports unrelated legacy
index/FK naming and column drift outside this new model; it is not a clean-drift
gate and no unrelated schema repair was attempted. The new model/index/FK match.

Limits: immutability is enforced by the application API and tested access graph,
not against privileged direct SQL. DB lifecycle checks use a transaction snapshot;
storage proof and stronger binding-time guarantees remain explicitly deferred.
