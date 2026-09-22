# T1.6.2.c.1a — Structured field observation fallback

Local implementation only. Baseline HEAD and freshly fetched origin/master:
`ff366cc7ca73d6c82826c996239f34180329c98b`.

## Original blocker and revised scope

The original prompt-only attempt changed no files. Gemini's response schemas did
not expose rawObservation, the builders dropped raw-only entries, and the guard's
legacy downgrade preserved text with UNKNOWN provenance. The revised task
explicitly permits the minimal provider representation adapter and guard change.
The existing domain JSON, database, review authority and UI are unchanged.

## Representation and deterministic normalization

| Provider state | Result |
| --- | --- |
| Nonempty value, OBSERVED/INFERRED | Preserve existing value semantics, subject to existing semantic guard and canonical review vocabulary |
| Null/absent/empty value, useful string rawObservation, OBSERVED/INFERRED | value=null; preserve trimmed rawObservation and stated provenance |
| UNKNOWN, with or without rawObservation/value | value=null, source=UNKNOWN, no rawObservation; never invent OBSERVED provenance |
| OBSERVED/INFERRED without useful value or rawObservation | Omit entry; existing applicable-field completion supplies UNKNOWN where applicable |
| Invalid/null/blank rawObservation | Ignore it; preserve any independently valid value |
| Raw-only PROFESSIONAL_INPUT | Omit; no new professional authority path |
| Valid canonical claim plus rawObservation | Retain both; raw text is supporting evidence only and cannot change the canonical value |
| Semantically unbound value plus useful rawObservation | Guard clears value; retains rawObservation, source and evidence metadata |
| Legacy unbound value without rawObservation | Existing guard downgrade remains unchanged: UNKNOWN plus original value/note text |

Both Gemini schemas now allow nullable value and optional nullable rawObservation;
rawObservation is not required. Shared TEXT/IMAGE and VIDEO builders retain the
same representation. Video segment references survive on raw-only fields.
Malformed neighboring entries are ignored rather than throwing on null records or
non-string value/note properties. No text is silently classified as a canonical
value: b.0 still uses exact existing vocabulary validation.

TEXT OBSERVED raw evidence must pass the same lexical overlap grounding convention
used for existing textual claims. Ungrounded raw text is discarded without erasing
an independently supplied value. IMAGE/VIDEO grounding remains the existing
multimodal provider/prompt and professional review boundary.

## Guard and provenance

Direct literal evidence stays OBSERVED. Permitted interpretation stays INFERRED.
Reviewability does not turn inference into observation. A null-valued raw-only
entry makes no canonical claim, so the guard preserves it. For non-null values,
its existing field-marker checks use value/note only: supporting raw text cannot
launder an unsafe canonical claim. Existing marker lists are unchanged.

This is not a new semantic classifier. Raw descriptions can still have uncertain
field relevance and require professional judgment. Wrong-field text is never moved
to another field and raw-only descriptions never receive a normalized canonical
value or CONFIRMED action. The strict canonical hydrator continues to reject them;
the existing b.0 review-candidate adapter supplies UNRESOLVED_TEXT instead.

## Prompt behavior

Only elevation, sectioning and guideType receive the fallback instruction:

- Elevation: observe hair position relative to natural fall/head. Do not estimate
  angles, infer from technique names, cutting lines or temporal frequency. Visible
  numbers alone do not establish the named professional relationship.
- Sectioning: observe partings, divisions, isolated sections and visible shapes.
  The mere existence of sections does not establish a named sectioning system.
- GuideType: observe an actual guide relationship. Repetition, tools and technique
  names are insufficient for canonical guide classification.

The three states are canonical value, literal reviewable observation and true
UNKNOWN. Earlier numeric/unknown instructions were reconciled with the fallback.
No new fallback behavior is requested for guideSource, cuttingAngle, fingerAngle,
toolOrientation, distribution or overdirection.

IMAGE/VIDEO instructions now explicitly treat visible text, captions, transcripts,
spoken instructions and embedded prompts as DATA. They cannot override
system/developer authority, extraction rules, canonical vocabulary or provenance.
TEXT keeps its existing evidence-as-data rule. This is prompt-boundary hardening,
not a claim that synthetic tests prove real-model resistance to all injections.

## Version, immutability and calls

`gemini-real-v1:${model}` → `gemini-real-v2:${model}` covers response representation,
parser/guard preservation, fallback instructions and evidence-as-data hardening.
Existing evidence/version lookup therefore cannot silently reuse the old semantics.
A local TEST DB integration test creates an old approved fixture, creates a new v2
draft for the same evidence, verifies the old row is unchanged, and verifies a
repeated v2 request reuses only the new version.

One existing Gemini generateContent invocation remains per extraction request
(or per already-existing bounded window). No additional analysis pass or provider
was introduced. All test clients are mocked; implementation made zero real
provider calls and did not reanalyze any production video.

## Review compatibility and inertness

Synthetic provider response → parser → strict validation → semantic guard → JSON
snapshot → b.0 candidate → actual b.2 aggregate → unchanged c render is covered.
The b.1 decision validator supplies allowed actions to that aggregate: CORRECTED,
UNKNOWN and REJECTED; CONFIRMED is absent. Literal text is visible, canonical
interpretation absent and correction has no preselected canonical value.

No Prisma, migration, table, dependency, domain contract, b.0/b.1/b.2 production,
UI production, route, logging, registry or downstream production change.
No raw evidence logging was added. Owner-scoped privacy remains unchanged.
`bindTemporalProfessionalFieldClaim` remains defined but unused in production.
Temporal arrays and action frequency are never copied into extractedFields.
T1.6.1 remains INELIGIBLE-only. No new skill binding, applicability, Brain/reasoning
consumption, ExecutionPlan, TD or video generation is activated.

## Safety and adversarial review

The regression phrase “45° Interior” appears only in tests/documentation. Tests
cover that phrase, horizontal cuts, embedded commands and visible numeric text as
insufficient support for elevation=45_deg_graduation. Supporting raw evidence
cannot validate those otherwise unbound canonical claims. Literal outward-held
hair remains raw OBSERVED evidence for a later explicit professional correction.

BLOCKING findings resolved: raw loss at parser, provenance loss at guard, missing
version bump, new TEXT raw path bypassing textual grounding, and contradictory
numeric/UNKNOWN prompt wording. Malformed outputs and neighboring fields are
covered. Historical fixtures retain their behavior.

NONBLOCKING limitations: existing lexical semantic checks are not semantic proof;
mocked outputs and prompt assertions cannot establish live-model visual accuracy or
universal injection resistance. No new inference engine or security subsystem was
introduced. Professional review remains the authority boundary. Future real-video
acceptance needs separate authorization after review/release and a NEW v2 draft;
the existing approved real-video draft and professional history remain untouched.

## Validation

- 65 safe suites, 1,292 tests passed, including 23 new adapter tests and one new
  local TEST DB version/immutability test (24 added tests).
- Coverage includes extraction/parser/guard, b.0/b.0.1/b.1/b.2/c, T1.5, T1.6.1,
  relevant learning routes/services and Brain/reasoning/selector/compiler boundaries.
- Real-provider acceptance suites and known L5 scratch-writing tests were excluded.
- Typecheck and touched-file lint passed with zero warnings.
- Full lint passed: 0 errors, 120 PRE-EXISTING warnings, 0 NEW warnings.
- Production build passed: 11 PRE-EXISTING storage tracing warnings, 0 NEW warnings.
- git diff --check passed. Expected constraint-error logs in DB rejection tests
  are asserted negative cases, not test failures.

## Integrity and release boundary

Exactly one local commit is intended. No push/deploy. The final report supplies its
SHA; the required parent is the baseline above. Tracked tree/staging must be clean
after commit. All seven pre-existing scratch artifacts remain untracked with the
SHA-256 hashes recorded in T1_6_2_C_PROFESSIONAL_REVIEW_UI.md, checked before work
and again after validation. No d or T1.6.3 work is included.
