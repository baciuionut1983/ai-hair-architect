# T1.6.2.b.0 — Professional Field Review Candidate Contract

Baseline: `039f7248cfd70ed03deec1eb03e78396bf205236`. Implementation only; no push/deploy.
Candidates are pure read-time derivations, not persisted decisions. AI original,
system-derived structure, and future professional authority remain separate.

## Derivation and identity

Only the existing elevation, sectioning and guideType specifications are supported.
`field:<field>` is scoped by draft `id`, sourceEvidenceId and extractorVersion;
the observation digest identifies the exact version of that field observation.
No random ID or array-position identity. Requested fields are deduplicated and
sorted lexicographically. Invalid context/envelope or unsupported selection fails
closed. Each selected field independently yields a candidate or explicit diagnostic:
ABSENT, INVALID_OBSERVATION, NO_OBSERVATION, or EXTRACTION_UNKNOWN. Unselected fields
are irrelevant to this derivation and are not validated or promoted.

| State | Meaning / behavior |
| --- | --- |
| CANONICAL | OBSERVED/INFERRED string passes the existing same-field exact validator. |
| UNRESOLVED_TEXT | Meaningful text under an explicit field, without a canonical value. |
| UNCLEAR_MEANING | Existing semantic guard's UNKNOWN + meaningful rawObservation: field meaning was not established. No canonical value, even if the raw text resembles a token. |
| EXTRACTION_UNKNOWN | UNKNOWN without meaningful rawObservation; diagnostic only, never a reviewable candidate. A note alone cannot manufacture an observation. |

Missing/whitespace-only value and rawObservation on non-UNKNOWN produce NO_OBSERVATION.
Raw strings are preserved exactly; trim is used only to check presence. Structural
validation admits only OBSERVED, INFERRED, UNKNOWN and string/null/absent values for
these enum-oriented fields; nonstring objects/numbers are INVALID_OBSERVATION, not
coerced. Extra field members and malformed temporal references are rejected per field.
At most 100 segments and 100 string frame references per segment are retained.
Outputs are independently cloned/deeply frozen; input is never frozen or modified.

No semantic classifier is added. `45°`, `approximately 45 degrees`, `45° Interior`
and cutting-line text cannot infer elevation. Under an explicit elevation field they
remain unresolved; the existing guard's downgraded shape is unclear. Other fields,
skill names and neighboring values never create or normalize elevation. Only the
explicit elevation slot accepts `45_deg_graduation` canonically.
The existing T1.6.2.a hydrator stays unchanged and atomic.

## Exact observation digest

Format: `sha256:<64 lowercase hex>`, Node SHA-256 over UTF-8 canonical JSON.
Digest input is `{ digestVersion: "professional-field-observation-v1", id, field,
specificationVersion, original, provenance, resolution, normalizedValue }`.
`provenance` includes draft id, evidence id, extractorVersion, sourceExtractionField.
`original` includes value/source and present confidence, note, rawObservation,
segments (times, relevance, confidence, observations and frame references).
Every review-relevant original member is pinned, including exact raw whitespace.

Object keys sort recursively by JavaScript string order. Undefined optional members
are omitted; array order is retained because segment/frame order is provenance.
JSON number/string encoding is used without Unicode normalization. Null and omitted
values are distinct. Validated data contains no nonfinite numbers or cyclic objects.
Unrelated fields, selection order, duplicate selections, runtime timestamps and
unrecognized envelope noise do not participate. Same data with reordered object
keys or cloned in memory has the same digest. Tests include an independently
computed .NET SHA256 fixture. This is an observation/context digest, not an evidence
file hash or full-extraction digest. It does not authenticate the input snapshot.

## Future professional requests

Requests pin candidateId, same field, draftId, sourceEvidenceId, extractorVersion,
specificationVersion and observationDigest. Extra keys are rejected. Validation
re-derives candidate consistency, but b.1 must load an authoritative frozen snapshot
and check ownership/evidence/draft state; accepting a client-supplied candidate alone
would not establish authority.

| Decision | CANONICAL | UNRESOLVED_TEXT / UNCLEAR_MEANING |
| --- | --- | --- |
| CONFIRMED | Allowed; no correctedValue | Rejected |
| CORRECTED | Valid same-field canonical value different from AI value | Valid same-field canonical value |
| UNKNOWN | Allowed; professional cannot determine correct value | Allowed |
| REJECTED | Allowed; observation unsupported/false for this field | Allowed |

Equal-value correction returns USE_CONFIRMED. UNKNOWN is a professional decision,
never a generic system resolution state. Empty extraction UNKNOWN has no candidate
and no decision target. No semantic reassignment: a suspected wrong field can be
REJECTED with annotation; annotation is never parsed into another field or authority.

Three separate domains: AI raw text is structurally checked immutable provenance
(newlines/controls are preserved, not sanitized and never executed); professional
values use the existing exact validator; optional professional notes use a separate
1000 UTF-16-unit limit. Notes allow Romanian, ordinary Unicode, intact emoji including
emoji variation selectors, LF and tab; reject other C0 (including CR), C1, format/bidi
controls, zero-width joiners, isolated surrogates and additional invisible fillers.
Empty annotation is allowed. ZWJ emoji sequences are rejected by the format-control
rule. No silent trimming or sanitizing; future rendering must treat all text as text.

## Versioning, stale vocabulary and boundaries

Future persisted decisions pin the exact specification version. Changes to meaning,
allowed values or normalization/validation semantics require explicit version-bump
review before persistence. Current version remains `1.0.0-t162a`: removing the unused
potentiallySkillBindable metadata does not change canonical semantics. The digest
format has its own version; changing its canonicalization requires a format revision.
No automatic migration of either version exists.

Closed future stale reasons: OBSERVATION_DIGEST_MISMATCH, SPEC_VERSION_CHANGED,
VALUE_NOT_IN_CURRENT_SPEC, DRAFT_NOT_APPROVED, DRAFT_SUPERSEDED, EVIDENCE_NOT_ACTIVE,
EVIDENCE_SOURCE_DELETED. Vocabulary only, no storage/state evaluation service.

No persistence/model/migration, API/UI, registry lookup/mutation, binding,
applicability, eligibility activation, prompt/provider, selector, Brain, ExecutionPlan,
compiler, TD/video or consult change. T1.5 persistence remains untouched and T1.6.1
remains INELIGIBLE-only. b.1 owns future append-only decisions and authoritative reads;
b.2/c/d and T1.6.3 are not implemented. Node crypto is the sole added runtime facility;
no dependency is added. The a-boundary permits exactly this pure consumer, while the
b.0-boundary permits no consumers. Existing protected-file hash tests remain intact.

## Local validation

160 targeted tests passed (102 b.0 tests plus 58 a regressions), and 511 regression
tests passed across 29 files covering T1.5, T1.6.1, Brain, selector, reasoning,
ExecutionPlan/scene compilers, TD and the existing semantic guard. Integration
fixtures used localhost `ai_hair_architect_test`; provider adapters used fakes only.
Typecheck and touched-TypeScript ESLint passed. Production build passed with the
11 existing file-tracing warnings after retrying with network permission for Google
Fonts; the sandbox attempt failed only on font downloads. No config workaround.
Independent source/import scans found only the approved b.0-to-a dependency and
zero b.0 consumers. Exact source comparison confirmed a's only implementation
change is metadata removal. Seven scratch artifacts retain their baseline hashes.
