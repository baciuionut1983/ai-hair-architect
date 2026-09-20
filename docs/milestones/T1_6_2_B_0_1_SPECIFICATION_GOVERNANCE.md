# T1.6.2.b.0.1 — Specification Governance + Note Hardening

Baseline: `e5b6050678126d018346add7c3d2705f0295d806`. Local implementation only.
No professional decision persistence; b.1 remains outside this slice.

## Independent specification pins

`getProfessionalFieldSpecification(field)` observes the existing a-specification.
`pinProfessionalFieldSpecification(spec)` returns field, specificationVersion and
specificationDigest (`sha256:<64 lowercase hex>`). Version identifies an intentional
reviewed revision; digest identifies its exact semantic content. Neither replaces
the other. The version label is deliberately excluded from the digest payload.
These pins are available independently; they are not added to b.0 candidates,
observation digests or decision requests in this prerequisite.

The exact payload contains:

- field, sourceExtractionField, semanticCategory;
- valueKind, allowedValues (in source order), normalization;
- unknownRepresentable, professionalCorrectionAllowed;
- authoritativeTextSafety: inputType (`string`), minimumUtf16Length (1),
  maximumUtf16Length (the existing 2000 constant), nonWhitespaceRequired (true),
  whitespaceCheck (`ECMAScript String.trim length > 0; input unchanged`),
  forbiddenPattern (the existing a-validator's exact regular-expression source),
  forbiddenPatternFlags (`u`), membership (`Array.includes exact string identity`).

Field properties/enum arrays come directly from STRUCTURED_FIELD_SPECIFICATIONS;
the original proposal-validator arrays remain their sole canonical source. The
text-safety descriptor witnesses the existing code without becoming a new validator.
Tests pin that code and check its regex, length behavior and source-property inventory
to prevent a descriptor silently diverging from the implementation.

Canonical JSON recursively sorts object keys by JavaScript string order, preserves
array order and exact strings, uses JSON primitive encoding, and hashes UTF-8 bytes
with Node SHA-256. There is no fuzzy mapping or Unicode rewriting. Input is the
typed, internal semantic specification, not an untrusted JSON ingestion API.
Version labels, comments, documentation, owner/draft/evidence/provider data, runtime
noise and timestamps are excluded. No observation-digest encoder is reused or changed:
the small private encoder avoids a dependency on the review-candidate layer.

## Reviewed goldens and drift protection

`PROFESSIONAL_FIELD_SPECIFICATION_GOLDENS` is a frozen version/field registry.
Current `1.0.0-t162a` goldens, independently calculated using .NET SHA256 over
explicitly ordered payloads and source-derived enum arrays/regex:

| Field | Semantic digest |
| --- | --- |
| elevation | `sha256:e203aae422ae2f7ebc54110cd6ac7de334572ebad38bd331b1d5ccf90c8b37ec` |
| sectioning | `sha256:fd3e357561ac1d54088dec45a55b76966bb004df226ff578befba04ebeebebb1` |
| guideType | `sha256:49ac4434ee357a3047bddcad88226fe31c3be5e6c5a0328618e68b8e54ee7a74` |

Current pins must match those constants. Missing version/field entries fail closed.
Same-version semantic drift fails; a new version is insufficient until it has a
new independently reviewed golden. Tests include an independent changed-spec vector.
Golden expectations are never computed dynamically by the tested encoder.

Version-indexed implementation witnesses additionally pin the comment-insensitive
TypeScript AST of the specification factory, field/value/text validators and spec
projection/canonicalizer/pin functions. These catch code-only drift, including
canonicalizer changes. Comments/formatting do not affect witnesses or semantic digests.
Witnesses are conservative: a nonsemantic code refactor may require a reviewed witness
update without a semantic version bump; it must not be used to waive semantic drift.
Static tests are not a replacement for review of changes to governance tests themselves.

Mandatory version review/bump applies to field identity, allowed-value additions,
removals/renames, valueKind, normalization, UNKNOWN representation semantics,
professionalCorrectionAllowed, authoritative length/text-safety policy, or spec-digest
canonicalization semantics. Update the descriptor if necessary, add a new version and
reviewed semantic/implementation goldens, retain prior entries, run all gates, and
independently review. Never overwrite an old semantic golden to bless same-version
drift. Comments and unused metadata removal need no bump. Field semantics are unchanged
here, so version remains `1.0.0-t162a`; annotation safety is not canonical field-value
semantics. No automatic version/data migration exists.

## Notes and segment/frame bounds

Only the b.0 professional note validator changes: reject present empty/whitespace-only
strings, U+2028 and U+2029. Existing 1000 UTF-16 maximum and all existing unsafe-class
rejections remain. Romanian, allowed emoji, safe Unicode, LF/tab remain accepted.
Presence checks never trim the returned text or sanitize it. Undefined/omitted note
remains absence; null continues to be invalid as a present note under the existing
contract. Private-use, noncharacters and unassigned characters remain deferred and
are not newly rejected solely for their class. AI raw text and canonical validators
are untouched.

b.0 documentation now explicitly says >100 segments or >100 frame references in a
segment rejects the field as INVALID_OBSERVATION. It never truncates. Limit/code unchanged.

## Inertness and deferred work

The only new production-source dependency is governance → structured-field claims →
the existing pure primitive validators, plus Node createHash. Governance and b.0 have
zero consumers, including client runtime imports. a's allowlist permits exactly these
two pure modules. No new server-only package, fourth vocabulary or registry mutation.
No DB, Prisma, storage, repository/service, API/UI, binding, applicability, eligibility,
prompt/provider, Brain/HairStateDelta, ExecutionPlan/compiler, TD/consult, preview/video.
T1.5 and T1.6.1 remain unchanged. a hydration and b.0 candidate resolution/identity,
observation digest, 45° safety, decision matrix and stale reasons are untouched.

Deferred: private-use/noncharacter/unassigned policy; raw-AI text length cap; finer
INVALID_OBSERVATION taxonomy; server-only package/client vocabulary extraction;
lifecycle predicates; /correct reconciliation; storage HEAD; backup/restore;
all Prisma work; b.1/b.2/c/d and T1.6.3. Future b.1 must load authoritative snapshots
and persist the required independent pins; this slice does neither.

## Local validation

199 targeted tests passed across five files, including 25 governance tests and
the existing a/b.0 functional and architectural regressions. A further 511 tests
passed across 29 T1.5/T1.6.1/Brain/reasoning/selector/compiler/TD files. Integration
fixtures used only localhost `ai_hair_architect_test`; provider tests used fakes.
Typecheck, touched-TypeScript ESLint, diff-check and production build passed.
Build used network permission for existing Google Fonts and retained 11 pre-existing
file-tracing warnings. No source/config workaround. Independent import inspection
confirmed exactly the two allowed a-consumers and zero candidate/governance consumers.
All seven scratch artifacts remain untracked with baseline hashes unchanged.
