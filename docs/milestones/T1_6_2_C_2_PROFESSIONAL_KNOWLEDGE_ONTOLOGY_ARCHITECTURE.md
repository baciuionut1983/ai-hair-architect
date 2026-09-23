# T1.6.2.c.2 — Professional Knowledge Ontology & Operational Vocabulary Architecture

**Status: architecture audit, materialized for O1 implementation handoff. No ontology code exists yet. This document is the sole source of truth for O1/O2 scope — it does not redesign anything, it transcribes the completed 101-section audit.**

Baseline this audit was performed against: `e7ddd483bddfc5a5eaabac7eedffb85ba16d7e21` (production, `T1.6.2.c.1b`). This document adds no code, no schema, no migration, no dependency. It is the first and only artifact of the `T1.6.2.c.2` audit committed to the repository.

Wherever the audit marked something `NEEDS EXTERNAL RESEARCH`, `NEEDS IONUȚ VALIDATION`, `AMBIGUOUS`, `UNRESOLVED`, or `P0`, that exact state is preserved below — nothing in this document resolves a professional-content question the audit itself left open, and nothing here should be read as inventing a definition that was not already established from repository evidence or explicitly supplied professional context.

**Errata #1 (contract clarity only, no professional content changed):** the first version of this document overloaded the word "status"/"classification" for two genuinely different axes — a token's own lifecycle/binding-safety state (`LegacyTokenStatus`, section N) and how completely a legacy token's meaning corresponds to a richer target model such as the six-dimension guide capability (`LegacyMappingCorrespondence`, also section N, now explicitly separated). Section N, the `ProfessionalCanonicalValue` contract (H), the O1 handoff (S), the P0 worklist (X), and the guide/matrix fixtures were corrected to keep these two axes textually and structurally distinct. No legacy token's actual classification changed as a result — every value already established by the audit is preserved, only which of two now-separate fields it lives in changed.

---

## A. Executive architecture decision

**Finding.** Roughly 70% of what a unified "Professional Brain ontology" needs already exists in this repository, built independently across five subsystems, under a strikingly consistent discipline (contract-only "Stage 1" files, `is*` runtime guards, fail-closed validation, UNKNOWN as a first-class state, provenance never conflated with authority). The one genuinely missing piece is a first-class **professional definition** — nothing today lets the system itself represent *what a term means*; only what values are legal and how they are labeled for display.

**Decision.** Do not build a new ontology from scratch. Build a thin, code-first, versioned **registry and definition layer** that references and composes the five existing systems, never re-declaring anything they already own. Sequence: an inert **O1** foundation (this document's main handoff target) → external/professional research → **O2** (real, validated definitions) → **T1.6.2.d** (Skill binding, redefined in scope) → **T1.6.3**. Each stage is independently releasable and, where possible, inert in production until explicitly wired.

**Verdict carried forward from the audit: `T1.6.2.c.2 ONTOLOGY ARCHITECTURE — GO FOR O1 FOUNDATION`.**

---

## B. Current five fragmented systems

| # | System | Files (representative) | What it owns |
|---|---|---|---|
| 1 | Professional Learning extraction | `professional-learning-draft-validators.ts` | 33-field evidence-time vocabulary, `PROFESSIONAL_LEARNING_PROVENANCE_SOURCES` |
| 2 | Structured field review | `structured-professional-field-claims.ts`, `professional-field-review-candidates.ts`, `professional-field-specification-governance.ts` | 3-field (elevation/sectioning/guideType) reviewable vocabulary, versioned via `STRUCTURED_FIELD_SPEC_VERSION` + SHA-256 golden |
| 3 | Technical Demonstration | `technical-demonstration-contracts.ts`, `technical-demonstration-cutting-contracts.ts` | Phase-scoped execution vocabulary, its own 6-value provenance tag, `CUTTING_EXECUTION_ACTION_TYPES` |
| 4 | Skill / Guide / Atomic Action | `professional-skill-contracts.ts`, `professional-skill-guide-relationship-contracts.ts`, `professional-skill-atomic-action-contracts.ts` | Skill-authoring-time ontology; the guide concept is **already** split into 6 independent dimensions, explicitly to fix a conflation in the coarser `GUIDELINE_OPTIONS` enum |
| 5 | Professional Knowledge Entry / Hair State | `professional-knowledge-entry-contracts.ts`, `professional-knowledge-approved-source.ts`, `hair-state-snapshot-validators.ts`, `hair-state-delta.ts` | An already-built 8-kind active-knowledge model with an `ACTIVE` / `APPROVED_BUT_UNATTACHED` / `RETIRED` authority trichotomy; a working "Evidence → Review → recomputed-hash → ApprovedSource" gate; a third provenance vocabulary; a real STATE → ACTION → STATE DELTA model |

None of these five systems references a shared concept identity. The same real-world fact (e.g. "guide behavior") is represented independently, at different maturity levels, in at least two of them.

---

## C. Final 15-layer target architecture

```
1.  SOURCE / EVIDENCE
2.  OBSERVATION
3.  CLAIM
4.  PROFESSIONAL REVIEW
5.  CANONICAL PROFESSIONAL SEMANTICS      <-- the missing layer; O1/O2's subject
6.  PRIVATE PROFESSIONAL KNOWLEDGE
7.  SKILL BINDING                          <-- T1.6.2.d's redefined scope
8.  APPLICABILITY
9.  ELIGIBILITY
10. ACTIVE PROFESSIONAL KNOWLEDGE
11. PROFESSIONAL BRAIN                     <-- explicitly out of scope, named only to complete the chain
12. EXECUTION PLAN
13. EXECUTION UNIT
14. ATOMIC ACTION
15. TECHNICAL / RESULT GENERATION
```

## D. Authority boundary for every layer

| Layer | Authority | Input | Output | Version identity | Provenance | Mutability | Exists today | Missing adapter/foundation |
|---|---|---|---|---|---|---|---|---|
| 1. Source/Evidence | none (untrusted input) | video/image/text/voice; future external docs | raw provider response | `extractorVersion` (proven: `gemini-real-v2:${model}`) | `evidenceId`, owner, `sourceMediaDeletedAt` gate | immutable once ACTIVE | **YES, fully** — `professional-learning-extractor-gemini.ts` | none |
| 2. Observation | none (still untrusted, AI-authored) | raw provider response | `{value\|null, source, rawObservation?, confidence?, note?}` | none per-instance (inherits `extractorVersion`) | instance-level provenance tag (see M) | immutable once persisted (frozen extraction JSON) | **YES** — c.1a's representation adapter | none |
| 3. Claim | none (server-derived candidate, still not authority) | Observation + governed specification | `ProfessionalFieldReviewCandidate {resolution, normalizedValue, observationDigest}` | `specificationVersion` + SHA-256 digest | `candidate.provenance {sourceEvidenceId, extractorVersion}` | recomputed fresh every read, never stored | **YES** — b.0/b.0.1 | none |
| 4. Professional Review | **real, first authority-bearing layer** | Claim + explicit professional decision | `ProfessionalFieldClaimDecision` (CONFIRMED/CORRECTED/UNKNOWN/REJECTED) | `revision` (append-only, R1 idempotency) | `reviewedByUserId`, pins to exact `observationDigest`/`specificationDigest` | append-only, immutable history | **YES** — b.1 | none |
| 5. Canonical Professional Semantics | shared, cross-owner | multiple professionals' reviews + future external research | `ProfessionalConcept` + `ProfessionalCanonicalValue` + `ProfessionalDefinition` (F/G/H below) | `conceptVersion`/`semanticDigest` (proposed, reuses proven pattern) | research/review chain | versioned, append-only definition history | **NO — the actual gap this document exists to close** | everything in F/G/H, this is O1/O2 itself |
| 6. Private Professional Knowledge | owner-scoped | Professional Review + (once it exists) Canonical Semantics reference | `ProfessionalKnowledgeEntry {kind, status}` | none explicit today | composed from `ProfessionalLearningProvenanceSource` + `ProfessionalDecisionType` | append-only per entry | **YES** — `professional-knowledge-entry-contracts.ts`, owner-scoped throughout | a `conceptId` reference field so an entry can point at shared semantics instead of only free-standing labels |
| 7. Skill Binding | professional, explicit | Private Knowledge (ACTIVE) + Canonical Semantics | `SkillParameterDefinition` populated from a real `conceptId`/canonical value | none yet | none yet | n/a, not built | **NO — this is T1.6.2.d's job** | the binding mechanism itself; "nowhere safe to attach" until O1/O2 exist |
| 8. Applicability | professional-authored, existing mechanism | Skill + `SkillCondition` | boolean/predicate evaluation | `SkillDefinition.version` | n/a | n/a | **YES, fully proven** — `SkillCondition`, generic, ready to consume `conceptId`-typed facts once they exist | none |
| 9. Eligibility | server, deterministic | Applicability result + owner scope + lifecycle status | `{eligible, status}` | reflects source draft/decision version | n/a | n/a | **YES, fully proven** — `owner-knowledge-eligibility.ts`, confirmed live via `resolveOwnerKnowledgeEligibility` in c.1a's own shipped test | none |
| 10. Active Professional Knowledge | final gate before Brain consumption | Eligibility = ELIGIBLE | knowledge Brain may deterministically query | — | — | — | **the STATE exists** (`ACTIVE` status) but nothing yet consumes it as Brain input | a real consumer |
| 11. Professional Brain | none of its own — a consumer, never a source of truth | Active Professional Knowledge | — | — | — | — | **NO — explicitly out of scope for this entire task**; named only to complete the chain | Brain itself |
| 12–14. ExecutionPlan / ExecutionUnit / AtomicAction | compiled output, inherits Skill's authority, creates none of its own | bound Skill parameters | ExecutionPlan/ExecutionUnit/AtomicAction records | `sourceSkillId` + `sourceSkillVersion` chain (proven — never creates new authority) | — | — | **PARTIALLY** — ExecutionPlan/ExecutionUnit/TD-cutting-compiler are real and active in production; the generic cross-vertical `AtomicAction` layer is contract-only, confirmed **inert** (no compiler produces one in production, by that file's own explicit statement) | the compiler that would populate `AtomicAction` from a real `ExecutionUnit` |
| 15. Technical/Result Generation | none — presentation of already-decided authority | compiled ExecutionPlan | — | — | — | — | **YES, active** — Photo Preview/Result Video pipeline, entirely downstream, unaffected by this audit | none |

## E. Canonical ontology vs. private professional knowledge

- **Canonical Professional Semantics** answers *"what does this concept mean, in general, for anyone"* — shared, **never owner-scoped**, changes rarely, under heavy review (see V, "Authority").
- **Private Professional Knowledge** answers *"what has this specific professional confirmed, corrected, or composed"* — owner-scoped, changes with every review click, requires no cross-owner consensus.
- **The entire current active-knowledge architecture is private-only today** — every repository function audited across this whole review chain scopes queries by `ownerUserId` in the WHERE clause itself. There is currently no "shared/global" tier at all.
- **Hard rule, carried forward unconditionally**: `ProfessionalConcept`/`ProfessionalCanonicalValue`/`ProfessionalDefinition` (Canonical Semantics) must **not** be owner-scoped — they are the shared layer. Only *decisions about* them remain owner-scoped, exactly mirroring how `ELEVATION_OPTIONS` is already global/shared today while `ProfessionalFieldClaimDecision` rows are owner-scoped.
- **No automatic promotion path exists, and none is proposed.** A private professional's confirmed knowledge never becomes canonical/global truth automatically — see W and the O3–O7 roadmap.

---

## F. ProfessionalConcept contract (exact O1 choices)

| Field | Type (conceptual) | Required/Optional | Semantic/Presentation | In semantic digest | O1 or O2 | Rationale |
|---|---|---|---|---|---|---|
| `conceptId` | string, stable dot-namespace (e.g. `haircutting.elevation`) | **REQUIRED** | semantic | **YES** | O1 | Nothing today plays this role; field names are bare strings. Never renamed once assigned — mirrors `SkillDefinition.skillId` stability discipline. |
| `vertical` | open string (reuses existing `PROPOSAL_VERTICALS`/`TECHNICAL_DEMONSTRATION_VERTICALS` convention) | **REQUIRED** | semantic | **YES** | O1 | Do not invent a second "domain" axis name; align with the one already used everywhere. |
| `discipline` | open string | OPTIONAL | semantic | **YES** | O1 | Already a real Professional Learning extraction field name; reuse, don't shadow. |
| `canonicalName` | string — the English machine token (e.g. `"elevation"`) | **REQUIRED** | semantic | **YES** | O1 | Never a presentation string (see M/G on language independence). |
| `conceptType` (merged with execution role, see K) | closed enum | **REQUIRED** | semantic | **YES** | O1 (placeholder value permitted) | Every worked case in the audit showed "what kind of concept" and "what Brain can do with it" collapse to the same answer — one field, not two. |
| `scope` | reference into the locked scope model (I) | **REQUIRED** | semantic | **YES** | O1 (structural field; may be populated as `[NEEDS PROFESSIONAL VALIDATION]` for unresolved concepts) | Load-bearing for the sectioning/elevation real cases (R, S). |
| `appliesTo` | array of `HeadZone` references (reuses TD's existing closed zone enum, never a second zone list) | OPTIONAL | semantic | **YES** | O1 | |
| `observability` | reference into the locked observability model (J) | OPTIONAL, but the *field* must exist in O1 even if unpopulated | semantic | **YES** | O1 shell / O2 real content | |
| `evidenceRequirements` | merged into `observability` — not a separate field | — | — | — | — | Avoids two overlapping fields answering "how can I ever know this." |
| `canonicalValues` | array of references to `ProfessionalCanonicalValue` (H) — **never inline, never re-declared** | OPTIONAL (may be empty) | semantic | **YES** (by reference) | O1 (references, can be empty) / O2 (populated) | Mirrors how `STRUCTURED_FIELD_SPECIFICATIONS` already separates field spec from value enum. |
| `relationships` | array of typed relationships (L) | OPTIONAL (may be empty) | semantic | **YES** | O1 (structure, can be empty) / O2 (real content) | |
| `executionRole` | reference into K, **composed via `conceptType`**, never a separate redundant field | — | semantic | **YES** | O1 placeholder / O2 real | Reuses `SkillParameterDefinition`/`AtomicActionKind`, never redefines them. |
| `effectRole` | reference to a future effect/causal-claim entry (see the audit's §22 finding) | OPTIONAL | semantic | **YES** | O2 | Not populated in O1. |
| `professionalAuthorityPolicy` | **DELIBERATELY OMITTED as a per-concept field** | — | — | — | — | Cross-cutting policy, not per-concept data — a concept references a policy, never embeds one (see V). |
| `status` | reference into `LegacyTokenStatus` (N) — the concept's own overall lifecycle/binding-safety state | OPTIONAL (defaults to `CANONICAL` when a concept's canonical values are already all in an existing, actively-used governed enum with no known conflation issue) | semantic | **YES** | O1 | The single, authoritative gate for binding safety at concept granularity. **Distinct from `legacyMappingCorrespondence` on H** — this field never carries correspondence-quality values like `PARTIAL`/`EXACT`; see N for the full separation. When set, it applies uniformly to every `ProfessionalCanonicalValue` under this concept, and is always at least as strict as any individual value's own `status` (never looser). |
| `legacyMappings` | array of legacy-token classifications, reusing exactly `LegacyTokenStatus` (N) — **never** `LegacyMappingCorrespondence` values | OPTIONAL, shell only in O1 | semantic | **YES** | **O1 shell only, real population is O3** | Needs real O2 definitions to classify against first. Kept for concepts whose member tokens might eventually carry *different* statuses from the concept's own `status`; today every registered concept sets one uniform `status` instead (see S). |
| `specificationVersion` | string, reuses the exact `STRUCTURED_FIELD_SPEC_VERSION` pattern | **REQUIRED** | meta | n/a (this IS the version, not hashed content) | O1 | |
| `specificationDigest` | SHA-256, reuses `pinProfessionalFieldSpecification`'s exact `canonicalJson` mechanism | **REQUIRED** | meta | n/a (this is the digest itself) | O1 (computed even over placeholder content, so the mechanism is tested before anything real depends on it) | |

**No field above requires Codex to invent professional content.** Every field either references an existing, already-proven repository mechanism, or is explicitly permitted to ship with a placeholder value in O1.

---

## G. ProfessionalDefinition contract (future/O2)

| Field | Required/Optional | Semantic/Nonsemantic | Version/digest participation | Professional-validation requirement |
|---|---|---|---|---|
| `definitionId` | **REQUIRED** | meta identity | not hashed itself | none (structural) |
| `conceptId` | **REQUIRED** | semantic (reference) | **YES** | none (structural) |
| `text` | **REQUIRED** (may literally be the string `"[NEEDS PROFESSIONAL VALIDATION]"` — required to exist, not required to be complete) | semantic | **YES** | full — this is the field the audit identified as the single biggest gap |
| `scope` | **REQUIRED** | semantic | **YES** | may be `[NEEDS PROFESSIONAL VALIDATION]` |
| `distinguishFrom` | OPTIONAL (empty for a genuinely unambiguous concept) | semantic | **YES** | professional review |
| `observability` | OPTIONAL | semantic | **YES** | professional review (absent observability must make future extraction-guidance generation **skip** that concept entirely, never guess a default) |
| `interpretationRequired` | OPTIONAL, free text | semantic | **YES** | professional review |
| `executionRole` | OPTIONAL, reference only | semantic | **YES** | professional/architectural review |
| `effectClaims` | OPTIONAL, references only — never inline text | semantic | **YES** | professional review |
| `sourceLanguage` | OPTIONAL | meta | **YES** | translation-review discipline (Q/audit §55) |
| `sourceTerm` | OPTIONAL | meta | **YES** | — |
| `localizedLabels` | OPTIONAL, `{ro, en, ...}` | **PRESENTATION ONLY** | **NO** | separate translation-review action, never conflated with definitional confirmation |
| `provenance` | **REQUIRED** — `{authorId\|sourceId, authorityType, reviewedAt}` | meta | **YES** (authorityType) / reviewedAt not hashed | reuses b.1's CONFIRM/CORRECT role model |
| `specificationVersion` / `specificationDigest` | **REQUIRED** | meta | is the version/digest | — |

**No final professional definitions are populated by this document.** Every `text`/`observability`/`interpretationRequired` value that would require domain expertise ships, where used at all in O1, as an explicit placeholder string, never a plausible-sounding guess.

---

## H. ProfessionalCanonicalValue contract

```
ProfessionalCanonicalValue {
  valueToken: string              // e.g. "45_deg_graduation" — the EXISTING, UNCHANGED token, never renamed
  conceptId: string                // references ProfessionalConcept
  semanticMeaning: reference       // -> a ProfessionalDefinition scoped to this specific value
  localizedLabels: {ro, en, ...}   // PRESENTATION ONLY, reuses teach-ai-professional-field-review-labels.ts's proven pattern
  legacyAliases?: readonly {alias, classification: LegacyTokenStatus}[]   // same-concept synonym handling (e.g. "graduation" as an alias of "elevation") -- NOT the guide-style cross-model case below
  observability?: reference        // may differ per value within the same concept
  executionSemantics?: reference   // -> OperationalSemanticContract
  semanticVersion, semanticDigest
  status: LegacyTokenStatus        // CANONICAL | LEGACY_ALIAS | DEPRECATED | AMBIGUOUS | NEEDS_SPLIT -- see N. Governs binding safety. Never inherits a value from legacyMappingCorrespondence below.
  legacyMappingCorrespondence?: readonly LegacyCorrespondenceEntry[]   // OPTIONAL -- see N. Describes how completely THIS token's meaning corresponds to a richer, already-existing target model (e.g. the six-dimension guide capability). Purely descriptive/research metadata; never itself a binding-safety gate.
}

LegacyCorrespondenceEntry {
  targetModelRef: string           // e.g. "GuideRelationshipCapability"
  targetDimension: string          // e.g. "GuideBehavior"
  targetValue?: string             // e.g. "STATIONARY" -- omitted when correspondence is NO_MAPPING
  correspondence: LegacyMappingCorrespondence   // EXACT | PARTIAL | AMBIGUOUS_CORRESPONDENCE | MIXED | NO_MAPPING -- see N
  note?: string
}
```

- **Two axes, deliberately never merged (Errata #1):** `status` (`LegacyTokenStatus`) is the sole, authoritative binding-safety gate. `legacyMappingCorrespondence` (`LegacyMappingCorrespondence`, entries of type `LegacyCorrespondenceEntry`) is separate, purely descriptive metadata about how well a legacy token's meaning has been decomposed against a newer, richer model — it never gates or loosens what `status` already decides. See N for the full rule and the exact stationary/traveling worked example.
- **O1 may contain**: `valueToken`, `conceptId`, `status` (all legacy-sourced tokens start `CANONICAL` if they already appear in an existing governed enum like `ELEVATION_OPTIONS`, unless the audit already flagged the owning concept `AMBIGUOUS`/`NEEDS_SPLIT` — see S), `localizedLabels` (reused verbatim from existing label files where they already exist), an empty/placeholder `semanticMeaning` reference, `semanticVersion`/`semanticDigest` (computed even over the placeholder). `legacyMappingCorrespondence` **may also** be populated in O1 wherever the target model already exists in code today (e.g. the guide case, since `GuideRelationshipCapability` is already real, shipped code — mapping `stationary` → `GuideBehavior.STATIONARY` is a mechanical fact, not a research-dependent professional-content decision).
- **MUST wait for O2**: real `semanticMeaning` content, `legacyAliases`, `observability`, `executionSemantics`. `legacyMappingCorrespondence` entries whose target model does **not** yet exist in code must also wait for O2/O3.
- **Authority-bearing vs. presentation, explicit**: `valueToken`, `semanticVersion`, `semanticDigest`, `status` drive b.0's canonical-membership check and review reproducibility — authority tier. `legacyMappingCorrespondence` is semantic research content (see P) but is **never** consulted for binding-safety decisions — only `status` is. `localizedLabels` is presentation-only, never enters any POST body or authority decision (verified extensively across the whole T1.6.2.c review chain) and **must never affect `semanticDigest`**.

---

## I. Scope model (locked choices)

**Final, locked identifier set:**

```
TECHNIQUE_GLOBAL
HEAD_REGION
SECTION
SUBSECTION
STRAND
ACTION
PHASE
OBSERVATION_WINDOW
```

Structural meaning only, no hairdressing content:

- `TECHNIQUE_GLOBAL` — a fact about the technique as a whole, independent of any one execution instance.
- `HEAD_REGION` — a fact scoped to an anatomical region (reuses the existing `HeadZone` vocabulary, never a second zone list).
- `SECTION` / `SUBSECTION` — a fact scoped to a structural division of the head, at two nested granularities.
- `STRAND` — a fact scoped to a single working unit smaller than a subsection.
- `ACTION` — a fact scoped to one specific execution action/moment.
- `PHASE` — a fact scoped to a workflow stage (reuses TD's existing `CuttingExecutionPhase`-style concept generically, never re-declares cutting-specific phase names).
- `OBSERVATION_WINDOW` — a fact scoped to what a specific piece of evidence happened to capture (e.g. a video clip's own bounded time/spatial slice), **distinct from the technique's own true structural scope**. Added by the audit specifically because nothing else in this list distinguishes "what the camera showed" from "what the technique structurally is."

**Locked invariant, non-negotiable, enforced wherever this model is consumed:**

> A claim whose evidence-derived scope is `SUBSECTION` / `ACTION` / `OBSERVATION_WINDOW` (or any scope narrower than `TECHNIQUE_GLOBAL`) must never automatically populate a `ProfessionalCanonicalValue` whose owning concept is declared `TECHNIQUE_GLOBAL`-scoped, without a separate, explicit professional claim made *at* global scope.

This is not new behavior to build from zero — it is what the existing three-state review model (`UNRESOLVED_TEXT` / `UNCLEAR_MEANING` / `CANONICAL`) already, correctly, does today for the real sectioning case (see S). The scope field's job is to make that already-correct behavior machine-checkable instead of resting entirely on a reviewer's own judgment.

---

## J. Observability model (locked choices)

**Locked as two independent axes, not one enum** — the audit found these answer genuinely different questions.

**Axis 1 — `observabilityClass` (can this concept be observed at all, in principle):**

```
DIRECTLY_OBSERVABLE
PARTIALLY_OBSERVABLE
VOICE_OR_TEXT_EXPLAINABLE
PROFESSIONAL_INTERPRETATION_REQUIRED
NOT_RELIABLY_VISUAL
```

**Axis 2 — `typicalChannels` (through which evidence channel):**

```
VISUAL
AUDIO
BOTH
TEXT
```

Structural meaning: Axis 1 answers "is there ever honest evidence for this." Axis 2 answers "which modality would carry that evidence." A concept can be e.g. `VOICE_OR_TEXT_EXPLAINABLE` specifically via the `AUDIO` channel, or `DIRECTLY_OBSERVABLE` via `VISUAL` — these combinations are meaningful and must remain representable independently.

**Circularity safeguard, locked as a hard rule for any future consumer (extraction-prompt generation):** this metadata may only generate **negative/descriptive** guidance ("observe X," "don't estimate Y numerically," "distinguish X from Z") — it must **never** generate **positive/similarity-based** guidance ("if you see something like Y, it's probably X"). A future prompt-generation function must structurally exclude `canonicalValues`/tokens from ever appearing in generated text, and this exclusion should be enforced by a test, not only a convention.

No concept's `observabilityClass`/`typicalChannels` is populated with a real value by this document — every use in O1 is a placeholder.

---

## K. Execution-role model (locked choices)

**Locked, merged with `conceptType` per F (a single field, not two):**

```
DESCRIPTIVE
STATE
PARAMETER
CONSTRAINT
ACTION
CONTROL_FLOW
EFFECT
CONTEXT
```

- **Multi-valued: YES.** The audit's own worked example (`progression`) proved a single-valued field forces an artificial choice — the same underlying field can simultaneously be professional-concept-shaped and control-flow-shaped depending on sub-sense. Recommend `executionRoles: readonly ExecutabilityRole[]`, non-empty when populated.
- **Digest participation: YES** — this is semantic content.
- **Structural semantics**: `DESCRIPTIVE` — narrative, never execution-bound (e.g. `professionalRationale`). `STATE` — a fact about current/target hair state. `PARAMETER` — a value a Skill step consumes. `CONSTRAINT` — a condition gating applicability. `ACTION` — maps toward `AtomicActionKind`. `CONTROL_FLOW` — repetition/iteration mechanics, explicitly **not** domain content (mirrors `AtomicActionIteration`'s own documented non-professional-vocabulary status). `EFFECT` — a result/outcome claim. `CONTEXT` — execution-context facts that are not themselves professional parameters (e.g. client head positioning during execution, per the already-executed `headBodyPositioning` → `clientHeadPosition`/`observationView` split).

---

## L. Typed relationship model (locked choices)

**Locked as a closed, typed set — explicitly not an uncontrolled generic graph**, matching every existing pattern in this repository (`SkillCondition`'s closed 5-operator language; `AtomicActionStateTransition`'s typed, never-free-text shape).

| Identifier | Direction | Structural meaning | Cycles allowed | O1 may populate now |
|---|---|---|---|---|
| `PART_OF` / `CONTAINS` | directed, inverse pair | scope nesting | NO | shell only (empty by default) |
| `APPLIES_TO` | directed | concept → execution context | NO | shell only |
| `PRECEDES` / `FOLLOWS` | directed, inverse pair | ordering (reuses `AtomicAction.requiresActionIds`'s proven DAG + cycle-check algorithm) | **explicitly NO — acyclic, DFS-checked, same algorithm as `isValidAtomicActionSequence`** | shell only |
| `CONSTRAINS` | directed | reuses `SkillCondition`/`precondition` | NO | shell only |
| `REQUIRES` | directed | reuses `requiresActionIds` | NO (self-reference explicitly rejected) | shell only |
| `MODIFIES` | directed | reuses `AtomicActionStateTransition` | n/a | shell only |
| `PRODUCES_EFFECT` | directed | reuses `HairStateDeltaTransformation` | n/a | shell only |
| `USES_GUIDE` | directed | concept → `GuideRelationshipCapability` | n/a | shell only |
| `USES_TOOL` | directed | concept → tool reference | n/a | shell only |
| `OBSERVED_AS` | directed | concept → evidence/observation shape | n/a | shell only |
| `EXECUTED_BY` | directed | concept → Skill/ExecutionUnit chain | n/a | shell only |
| `INCOMPATIBLE_WITH` | symmetric | reuses `SkillCondition op:"not"` / `incompatibilities` | n/a | shell only |
| `NOT_EQUIVALENT` | symmetric | two concepts share a `canonicalName` but are distinct `conceptId`s (contradiction model) | n/a | shell only |

**No professional relationship instance is populated by this document.** Every entry above is the *type vocabulary* only; O1 registers the closed set of relationship *kinds*, never asserts that any two specific concepts actually hold one of these relationships — that is O2/O3 content, backed by research.

---

## M. Three provenance axes/vocabularies — exact documentation, final treatment

| | `PROFESSIONAL_LEARNING_PROVENANCE_SOURCES` | TD's inline provenance tag | `HAIR_STATE_VALUE_SOURCES` |
|---|---|---|---|
| **Exact symbol** | `ProfessionalLearningProvenanceSource`, `professional-learning-draft-validators.ts` | inline tag on `TechnicalDemonstrationProvenanceValue<T>`, `technical-demonstration-contracts.ts` | part of `HairStateValueSource`, `hair-state-snapshot-validators.ts` |
| **Exact values** | `OBSERVED, INFERRED, PROFESSIONAL_INPUT, UNKNOWN, EXTERNAL_RESEARCH, MANUFACTURER_CLAIM, TREND_SIGNAL` | `OBSERVED, INFERRED, UNKNOWN, PROFESSIONAL_OVERRIDE, NOT_APPLICABLE, DETERMINISTIC_DERIVATION` | `not_yet_assessed, observed, inferred, professional_input, ai_proposed, client_reported, reference_image` (lowercase — the one inconsistency of the three) |
| **Semantic purpose** | how a specific extracted-field claim was obtained, at extraction time | how a specific TD step-field value was obtained, at derivation/compilation time | how a specific hair-state fact was obtained, across heterogeneous input pipelines |
| **Current consumer** | extractor, semantic guard, b.0 | TD compiler/derivation/coherence | analysis engine, hair-state snapshot assembler, delta computation |
| **Proposed canonical axis name** | **EvidenceOrigin** | **ExecutionKnowledgeOrigin** | **EvidenceOrigin** (same axis as Learning's — **flagged for future reconciliation only, not decided here**; needs professional confirmation that `professional_input` and `PROFESSIONAL_INPUT` truly mean the same fact) |
| **O1 action** | **document only** — no code change | **document only** — no code change | **document only** — no code change |

**Critical, locked rule: do NOT collapse these into one enum.** `NOT_APPLICABLE`/`DETERMINISTIC_DERIVATION` (TD) and `client_reported`/`reference_image`/`ai_proposed` (Hair State) have no equivalents in the other vocabularies and answer genuinely different questions. A fourth axis, **`ProfessionalAuthorityOrigin`**, is not a new vocabulary — it is simply the existing b.1 `ProfessionalDecisionType` (CONFIRMED/CORRECTED/UNKNOWN/REJECTED), named as a provenance axis for the first time in this document. A fifth, genuinely new axis, **`ObservationStatus`**, is exactly J's `observabilityClass` — concept-level, not instance-level, with no existing analog.

O1 adds a thin, additive **mapping table** only (which existing vocabulary member maps to which named axis) — it does not rewrite, rename, or touch any of the three existing enums.

---

## N. Legacy-token classification model

**Two deliberately separate axes (Errata #1).** The completed audit used two conceptually distinct classifications and the first version of this document accidentally merged their vocabularies under one overloaded word ("status"). They are corrected here as two named, independent contracts. Neither replaces or loosens the other.

### N.1 — `LegacyTokenStatus` (lifecycle / binding-safety — the sole gate)

**Locked five-state model, unchanged from the original lock:**

```
CANONICAL
LEGACY_ALIAS
DEPRECATED
AMBIGUOUS
NEEDS_SPLIT
```

| State | Future automatic-binding behavior |
|---|---|
| `CANONICAL` | may be used freely as a Skill parameter's `allowedValues` source. |
| `LEGACY_ALIAS` | usable, but always resolves to its canonical target; never displayed as a separate identity. |
| `DEPRECATED` | usable for backward compatibility (existing persisted data), **never** the target of new professional input (mirrors the already-executed `headBodyPositioning` precedent — kept unchanged, additive-only, never rewritten or deleted). |
| `AMBIGUOUS` | **MUST FAIL CLOSED** — structurally excluded from any new automatic binding path; an explicit professional override is required to proceed anyway. |
| `NEEDS_SPLIT` | **MUST FAIL CLOSED**, identical treatment to `AMBIGUOUS`. |

`LegacyTokenStatus` applies at **concept granularity by default** (see F's new `status` field): when the audit found the owning concept itself problematic — as it did for elevation, sectioning, and guideType — every canonical value under that concept inherits the same status uniformly, regardless of how well-formed any individual token looks in isolation. A concept may instead assign a stricter status to an individual value (via H's own `status` field), but never a looser one than its own concept-level status.

**Historical data remains reproducible, by construction**: no legacy token's underlying value ever changes as a result of this classification — `ELEVATION_OPTIONS`/`SECTIONING_OPTIONS`/`GUIDELINE_OPTIONS` etc. are never edited. Classification is purely additive metadata layered on top; a decision reviewed under an old semantic version remains reproducible against that exact version forever (reuses O's mechanism unchanged).

**Concept-level statuses already established by the audit (not invented here — restated from the completed audit):**

| Concept | `LegacyTokenStatus` | Basis |
|---|---|---|
| `haircutting.elevation` (all 5 tokens uniformly) | **AMBIGUOUS** (whole concept, pending split) | mixes pure angle / named technique-result / directional relationship |
| `haircutting.sectioning` (all 5 tokens uniformly) | **AMBIGUOUS** (whole concept, pending split) | possible global/local scale mixing |
| `haircutting.guideType` (all 4 tokens uniformly — `stationary`, `traveling`, `visual_perimeter`, `multiple_reference`) | **AMBIGUOUS** (whole concept, pending split) | self-documented conflation of source and behavior in the guide-relationship contract's own header — see N.2 for why this applies uniformly even though `stationary`/`traveling` individually look better-formed than `visual_perimeter`/`multiple_reference` |
| `haircutting.cuttingAngle`, `haircutting.cuttingLine` | **n/a — no tokens exist yet** | placeholder free-text fields only, nothing to classify |

No other token or concept is classified by this document beyond what the completed audit already concluded.

### N.2 — `LegacyMappingCorrespondence` (mapping quality — descriptive research metadata only, never a binding gate)

**A separate, additive, five-value model**, used only when a legacy token is being compared against a newer, richer target model (such as the six-dimension guide capability). This is the vocabulary the audit's own guide-decomposition work (`EXACT`/`PARTIAL`/`AMBIGUOUS`/`MIXED`/`NO_MAPPING`) actually used — kept intact here, with one purely textual change: its own `AMBIGUOUS` value is renamed `AMBIGUOUS_CORRESPONDENCE` so it is never mistaken, in any table that shows both axes side by side, for `LegacyTokenStatus`'s `AMBIGUOUS`. No classification outcome changes — only the label.

```
EXACT
PARTIAL
AMBIGUOUS_CORRESPONDENCE
MIXED
NO_MAPPING
```

| Value | Structural meaning |
|---|---|
| `EXACT` | the legacy token corresponds to exactly one target dimension/value, with nothing lost or added. |
| `PARTIAL` | the legacy token correctly corresponds to one (or some) target dimension(s) but is silent about others the richer model distinguishes — the legacy token is not *wrong*, only *less granular*. |
| `AMBIGUOUS_CORRESPONDENCE` | the legacy token's own category is unclear relative to the target model — e.g. it names a value that belongs to a *different* target dimension than the one it was flatly grouped with. |
| `MIXED` | the legacy token corresponds to more than one target dimension simultaneously, in a way that cannot be cleanly separated without further research. |
| `NO_MAPPING` | no defensible single target has been identified at all. |

**This axis never gates automatic binding by itself.** Binding safety is governed exclusively by `LegacyTokenStatus` (N.1) / the owning concept's `status` (F). A `PARTIAL` or `AMBIGUOUS_CORRESPONDENCE` mapping-correspondence value does **not** independently block anything beyond what the token's/concept's own `LegacyTokenStatus` already blocks — and it never *permits* binding that `LegacyTokenStatus` would otherwise forbid. For the guide case specifically (N.3 below), this is moot in practice: `haircutting.guideType`'s concept-level status is already `AMBIGUOUS`, which already fails closed for all four tokens regardless of how well each one individually corresponds to the richer model.

### N.3 — Worked resolution: `stationary` / `traveling`

The exact case that surfaced this contradiction, resolved explicitly:

| | `stationary` | `traveling` |
|---|---|---|
| Legacy token | `stationary` (member of `GUIDELINE_OPTIONS`) | `traveling` (member of `GUIDELINE_OPTIONS`) |
| Owning concept | `haircutting.guideType` | `haircutting.guideType` |
| `LegacyTokenStatus` (N.1) | **AMBIGUOUS**, inherited from the concept — same as every other `guideType` token | **AMBIGUOUS**, inherited from the concept |
| `legacyMappingCorrespondence` (N.2) | `{targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue: "STATIONARY", correspondence: PARTIAL}` — captures exactly 1 of 6 guide dimensions | `{targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue: "TRAVELLING", correspondence: PARTIAL}` |
| Automatic mapping allowed? | **NO** — blocked by `LegacyTokenStatus: AMBIGUOUS`, independent of the `PARTIAL` correspondence quality | **NO**, same reason |
| Professional validation still required? | **YES** — per P0.D | **YES** |

Both tokens remain perfectly valid, currently-shipped, usable `GUIDELINE_OPTIONS` members in production today (nothing about this errata touches the enum itself) — they are simply not yet eligible for *new, automatic* Skill-parameter binding until `haircutting.guideType`'s concept-level ambiguity is resolved in O2/O3, exactly as strictly as `visual_perimeter`/`multiple_reference` are, and exactly as strictly as this document's first version already, correctly, intended — Errata #1 makes that intent explicit and consistent instead of contradictory.

---

## O. Semantic versioning

Reuses the exact, already-proven mechanism verbatim — `STRUCTURED_FIELD_SPEC_VERSION` + `PROFESSIONAL_FIELD_SPECIFICATION_GOLDENS` (a versioned SHA-256 digest per field per version), proven through three independent review cycles (T1.6.2.c/.c.1a/.c.1b). Every `ProfessionalConcept`/`ProfessionalCanonicalValue`/`ProfessionalDefinition`/relationship/operational-semantics/alias record gets the identical `specificationVersion` + digest treatment. **No new versioning scheme is introduced.** Existing professional decisions remain reproducible against the version they were reviewed under; no retroactive rewriting is proposed anywhere in this document.

---

## P. Semantic digest boundary

| Field/category | In semantic digest | Reason |
|---|---|---|
| `conceptId` | **YES** | identity is semantic |
| `specificationVersion` (the version label itself) | **NO** | mirrors `pinProfessionalFieldSpecification`'s own exclusion of "version labels, comments, documentation" |
| `definition.text` | **YES** | core semantic content |
| `canonicalValues` (token identity + `inclusionCriteria`/`exclusionCriteria`) | **YES** | |
| `scope` | **YES** | |
| `relationships` | **YES** | |
| `observability` (`observabilityClass` + `typicalChannels`) | **YES** | |
| `executionRole`/`executionRoles` | **YES** | |
| `distinguishFrom` | **YES** | |
| `legacyAliases` (the classification itself) | **YES** | an alias reclassification is a semantic event |
| `status` (`LegacyTokenStatus`, concept- or value-level) | **YES** | a lifecycle/binding-safety change is a semantic event |
| `legacyMappingCorrespondence` (`LegacyMappingCorrespondence` entries) | **YES** | a correspondence upgrade (e.g. `PARTIAL` → `EXACT` once a richer model is fully adopted) is genuine new understanding, not presentation — but note this field never itself participates in a binding-safety decision (N.2) |
| `localizedLabels` (all languages) | **NO** | presentation only |
| UI ordering/grouping | **NO** | presentation only |
| `presentationDetail`/help-text formatting | **NO** | presentation only |
| `provenance.reviewedAt` timestamp | **NO** | meta, not semantic content |
| `provenance.authorityType` | **YES** | who/what kind of authority approved this is semantic |

**Mechanism to reuse, unchanged**: `pinProfessionalFieldSpecification`'s exact `canonicalJson` function (sorted keys, `undefined` members omitted, arrays order-preserved, then SHA-256). Not a new hashing implementation.

---

## Q. Domain-pack architecture

- **Shared core, evidenced as already partially real**: `HeadZone` (anatomical, not cutting-specific — reusable with zero change), `HairStateSnapshot`/`HairStateDelta` (already vertical-agnostic in practice), `AtomicActionKind` (explicitly documented in its own header as "a small, closed, CROSS-VERTICAL structural envelope").
- **Vertical-specific packs**: cutting (mature — TD, Skill, Learning review), color (**exists, disconnected** — see Y), styling (**does not exist at all** — confirmed by direct search, zero matches).
- **Structure**: one shared-core module + one sibling file per vertical, mirroring `technical-demonstration-cutting-contracts.ts`'s own explicit precedent for how a second vertical gets its own file, never a branch inside the first vertical's own file.
- **`vertical` remains an open string** everywhere, matching `PROPOSAL_VERTICALS`/`TECHNICAL_DEMONSTRATION_VERTICALS`/`AtomicAction.vertical` exactly — a new vertical is a one-line addition, never a schema migration.

---

## R. Code-first decision (final)

**Decision: code-first, versioned, TypeScript-first now. DB-backed editing explicitly deferred.**

Rationale, evidenced: every vocabulary audited across all five existing systems is a `const [...] as const` array plus an `is*` guard, PR-reviewed, never DB-editable — this is the single most consistent pattern in the entire codebase, with zero exceptions found. `PROFESSIONAL_FIELD_SPECIFICATION_GOLDENS`'s own comment ("Reviewed fixtures: never regenerated automatically during tests/build") shows even the one existing semantic-fingerprint mechanism deliberately keeps the golden value in code, hand-reviewed.

**Research review before code entry**: a `ResearchedConceptCandidate` artifact (see X) is reviewed and approved by Ionuț *before* any PR introduces it into the O1/O2 registry — the registry never accepts raw research output directly.

**When DB-backed editing becomes appropriate**: only after the authority-role model (V) and the shared/global promotion governance (E, "no automatic promotion") are real, separately-authorized features — not assumed as an eventual default.

---

## S. O1 exact scope

**T1.6.2.c.2a — Canonical Professional Concept Registry Foundation.**

- **Purpose**: introduce the O1-tier fields from F/G/H as pure, contract-only types with `is*` guards — no wiring, no consumers, no behavior change anywhere in production.
- **Types**: `ProfessionalConcept`, `ProfessionalCanonicalValue`, `ProfessionalDefinition` (O1-shape only — placeholder content permitted/required for `definition`, `observability`, `executionRole`).
- **Registry content — exact, locked**: five entries, all vertical `"cutting"`, all marked with the exact placeholder text `[NEEDS PROFESSIONAL VALIDATION]` wherever content would require domain expertise:
  1. `haircutting.elevation` — `canonicalValues` references reuse `ELEVATION_OPTIONS` verbatim (5 tokens, never re-declared); concept-level `status: AMBIGUOUS` (whole-concept, per N.1), applied uniformly to all 5 values.
  2. `haircutting.sectioning` — `canonicalValues` references reuse `SECTIONING_OPTIONS` verbatim (5 tokens); concept-level `status: AMBIGUOUS` (whole-concept, per N.1), applied uniformly to all 5 values.
  3. `haircutting.guideType` — `canonicalValues` references reuse `GUIDELINE_OPTIONS` verbatim (4 tokens); concept-level `status: AMBIGUOUS` (per N.1), applied uniformly to all 4 tokens (`stationary`, `traveling`, `visual_perimeter`, `multiple_reference` — none is exempted, none gets a looser status). **Separately**, each of the 4 tokens' `legacyMappingCorrespondence` (per N.2, N.3) may be populated now, since the target model (`GuideRelationshipCapability`) already exists in code: `stationary`/`traveling` → `PARTIAL` (1 of 6 dimensions each); `visual_perimeter`/`multiple_reference` → `AMBIGUOUS_CORRESPONDENCE`/`NO_MAPPING` respectively. This correspondence data is informational only and never loosens the concept-level `AMBIGUOUS` binding-safety gate.
  4. `haircutting.cuttingAngle` — **no `canonicalValues` yet** (none exist in the repository); registered as a concept shell only, `status: n/a — no tokens to classify`.
  5. `haircutting.cuttingLine` — same as (4).
- **Concepts explicitly NOT registered in O1**: every other of the 33 Professional Learning extraction fields, every TD-only field (fingerAngle, toolOrientation, subsectioning, etc.), every guide-relationship dimension individually (they remain reachable only via the existing `professional-skill-guide-relationship-contracts.ts` file, not re-declared as concepts yet), all color/styling concepts. Registering these now would be scope creep beyond the P0 set this audit prioritized.
- **Domain-pack shape**: exactly Q — one module, `vertical: "cutting"` on every entry, structured so a sibling file is the only change needed for a future vertical.
- **Scope types**: exactly I's 8 identifiers, no others.
- **Observability types**: exactly J's two axes, no others.
- **Execution roles**: exactly K's 8 identifiers, multi-valued, no others.
- **Relationship types**: exactly L's 13 identifiers, registered as an empty/shell structure per concept in O1 (no relationship instances asserted).
- **Legacy statuses**: exactly N.1's 5 `LegacyTokenStatus` states — the only axis that gates automatic binding. **Separately**, `legacyMappingCorrespondence` (N.2's 5-value `LegacyMappingCorrespondence`) may also be populated in O1 wherever the target model already exists in code (the guide case) — it is informational research metadata only and is never a second, competing binding gate.
- **Digest fields**: exactly P's boundary table, now including both `status` and `legacyMappingCorrespondence`.
- **Registry validation rules**: unique `conceptId`s (Set-cardinality check, mirrors `isValidAtomicActionSequence`'s id-uniqueness pattern); digest computed and stable even over placeholder content; every `distinguishFrom`/relationship reference must resolve to a real `conceptId` in the same registry (referential integrity, mirrors `AtomicAction.requiresActionIds` validity check); no cycles in `PRECEDES`/`FOLLOWS`/`PART_OF` relationships (reuse the exact DFS algorithm from `isValidAtomicActionSequence`).
- **Boundary/inertness requirements**: **zero existing production file may import or reference this new module.** No extractor, guard, b.0, b.0.1, b.1, b.2, c, TD, or Skill file changes. This must be verifiable by a boundary/AST test mirroring the existing b.0/b.1/b.2 boundary-test pattern.
- **Migration**: **NO.**
- **Files (new only)**: `web/src/lib/professional-concept-contracts.ts`, `professional-canonical-value-contracts.ts`, `professional-definition-contracts.ts`, `professional-concept-registry.ts`, each with a co-located `.test.ts`; `docs/milestones/T1_6_2_C_2A_....md`.

**No professional-content decision is left for Codex to invent.** Every registry entry's uncertain content is either a direct reuse of an already-governed enum (elevation/sectioning/guideType tokens) or an explicit `[NEEDS PROFESSIONAL VALIDATION]` placeholder.

---

## T. O2 exact scope

**T1.6.2.c.2b — Professionally Validated Canonical Definitions.**

- **Cannot begin until** the P0 research worklist (X) produces `ResearchedConceptCandidate` artifacts with `finalStatus: APPROVED` and `ionutValidation.status: REVIEWED` for at least the P0 concepts.
- **Inputs**: the approved research artifacts themselves (external to this repository).
- **Work**: populate real `ProfessionalDefinition.text`/`scope`/`observability`/`distinguishFrom` for the P0 concepts; compute real, meaningful `semanticDigest` values; perform the real legacy-token classification (O3, moved here per the audit's own refined sequencing) now that real definitions exist to classify against; populate real `localizedLabels`, reviewed as a **separate** action from definitional confirmation (per the audit's own distinct-review-action finding).
- **Non-goals**: no Skill binding, no extraction-prompt change, no DB, no UI change.

---

## U. O3–O7 roadmap

- **O3** — legacy-vocabulary adapters, real population, now sequenced *inside* O2's own slice (T) rather than as a separate stage, since it needs O2's real definitions to compare against.
- **O4** — ontology-driven extraction guidance: migrate c.1a's hand-written `FIELD_OBSERVATION_POLICY` prompt block to be generated deterministically from O2's `observability`/`distinguishFrom` content, subject to J's circularity safeguard.
- **O5** — Skill binding integration — this is T1.6.2.d's own scope (V).
- **O6** — ExecutionPlan/TD parameter validation against ontology semantics (ontology supplies constraints, never executes code — zero `run()`/`execute()` method anywhere in any contract type audited).
- **O7** — additional vertical packs, starting with color (the most natural second vertical, per Y's finding that it already has real, non-placeholder canonical enums), explicitly deferred, not started by this document.

---

## V. Redefined T1.6.2.d

**d's scope, once O1/O2 exist for the concepts it targets**: bind a `ProfessionalFieldClaimDecision` (already-reviewed claim) to a `ProfessionalConcept`/`ProfessionalCanonicalValue` version, then populate a real `SkillParameterDefinition.allowedValues` entry from it. **d does not need to build Applicability or Eligibility — both already exist and are proven** (D). d's only genuinely new work is the binding step itself, respecting N's fail-closed rule for `AMBIGUOUS`/`NEEDS_SPLIT` tokens.

**Authority roles referenced by d (architectural roles only, no permissions implemented anywhere in this document or elsewhere)**: `PROPOSE` (AI or professional; AI proposals always untrusted), `CONFIRM`/`CORRECT` (professional only — reuses b.1's exact CONFIRMED/CORRECTED/UNKNOWN/REJECTED vocabulary), `DEPRECATE` (new, needed for N's DEPRECATED state, not yet built), `CREATE_ALIAS` (needs new authority, not yet built), `BIND_TO_SKILL` (explicitly d's own job, out of scope here), `ACTIVATE_PRIVATE`/`PROMOTE_SHARED` (the existing `ACTIVE`/`APPROVED_BUT_UNATTACHED` distinction, plus a genuinely new "shared/global" tier that does not exist yet and requires its own separately-authorized design per E).

**Prerequisites, hard checklist**: a real `conceptId` must exist for whatever field d is binding (O1); that concept's canonical values must carry a real `semanticDigest` (O2); the specific legacy token being bound must be classified `CANONICAL` or explicitly `LEGACY_ALIAS`-with-approval, never `AMBIGUOUS`/`NEEDS_SPLIT` (N).

---

## W. T1.6.3 entry gates

Before Professional Brain may consume any learned knowledge, all of the following must hold:

1. Reviewed claim exists (b.1 — already real).
2. Canonical concept identity exists (`conceptId`, O1).
3. Semantic version/digest is current, not stale relative to what was reviewed (O2, extends the existing field-specification staleness mechanism to concept-version staleness).
4. Skill binding exists (V, d's own output).
5. Applicability evaluates true (`SkillCondition` — already real).
6. Eligibility returns `ELIGIBLE` (`owner-knowledge-eligibility.ts` — already real).
7. Not stale (extends O's reproducibility guarantee).
8. Provenance chain is unbroken from source to claim (already real, E's evidence chain).
9. Private/global scope is explicitly known — T1.6.3 must know whether it is consuming owner-private knowledge or promoted/shared knowledge, and must never treat one as the other.
10. No unresolved contradiction exists for the concept being consumed (contradiction model, per the audit's namespace/variant approach — checked before consumption, not only before promotion).

---

## X. P0 research worklist

**A. Elevation / projection**
- Existing tokens: `0_deg_blunt, 45_deg_graduation, 90_deg_uniform_layer, 135_deg_long_layer, 180_deg_overdirection`.
- Known semantic mixing: pure angle, named technique/result, and directional relationship (`180_deg_overdirection`) appear mixed in one flat enum.
- What O1 may safely encode: the concept shell, `status: AMBIGUOUS`, references to the existing 5 tokens unchanged.
- What O1 MUST NOT encode: any split of the enum, any new token, any claim about which of the 5 members belongs to which future dimension.
- External research questions: is "elevation" the same concept as "projection" in professional usage? Should `180_deg_overdirection` be reclassified as a `distribution`/`overdirection` fact rather than an elevation value?
- Ionuț validation questions: does "elevation" always mean a pure angle to you, or does it sometimes carry technique/result meaning too? Is per-strand, per-subsection, or per-technique-global the correct scope?
- English research terms: "hair elevation," "cutting elevation," "graduation angle," "layering angle," "projection vs elevation hairdressing."
- Romanian terminology to validate: "elevație" (already used in shipped UI labels — needs confirmation it is the term a working Romanian stylist actually uses).
- Must never be inferred automatically: a numeric degree from pixel geometry alone; elevation from a technique/skill name; elevation from cutting-line geometry.

**B. cuttingAngle / cuttingLine**
- Existing tokens: none — both are free-text placeholders in Professional Learning's 33-field extraction contract and in TD's `CuttingDemonstrationStepPayload`, both explicitly documented in TD's own source as "no source in Stage 1's own data."
- Known semantic mixing: none possible yet — total absence of canonical vocabulary is the finding itself.
- What O1 may safely encode: two concept shells, no `canonicalValues` at all.
- What O1 MUST NOT encode: any enum, any value, any claim that these are or aren't the same concept.
- External research questions: is "cutting angle" the blade's angle relative to the section, and "cutting line" the resulting geometric line — two different facts, or one?
- Ionuț validation questions: when you say "45° interior," is that a blade angle, a resulting line shape, or both at once?
- English research terms: "cutting line hairdressing," "cutting angle vs elevation," "interior angle haircut," "blade angle cutting technique."
- Romanian terminology to validate: "unghi de tăiere," "linie de tăiere" (both plausible, unconfirmed).
- Must never be inferred automatically: from elevation (already proven the architecture never does this); from a technique name directly producing a numeric value.

**C. sectioning / subsectioning / parting**
- Existing tokens: `4_quadrant_profile_radial, horseshoe_crown, diagonal_back, pivot_radial, horseshoe_fringe`.
- Known semantic mixing: possible global/local scale mixing — the central open question motivating this entire audit's real trigger case.
- What O1 may safely encode: the concept shell, `status: AMBIGUOUS`, references to the existing 5 tokens unchanged.
- What O1 MUST NOT encode: any split, any claim about which tokens are global vs. local/regional.
- External research questions: which of the five tokens are global technique-structure choices vs. local/regional parting patterns? Are "sectioning," "subsectioning," "parting," and "working section" four distinct concepts or fewer?
- Ionuț validation questions: for "45° Interior," is there a fixed global sectioning pattern, or does it vary by client/hair type even at the global level? (Directly answers the still-unsaved real review decision, S below.)
- English research terms: "hair sectioning patterns," "four quadrant sectioning," "horseshoe sectioning," "parting vs sectioning hairdressing," "subsectioning technique."
- Romanian terminology to validate: "secționare," "împărțire," "cărare."
- Must never be inferred automatically: a global sectioning claim from a local video observation.

**D. Guide semantics**
- Existing repo identities: flat `GUIDELINE_OPTIONS` (4 values) vs. the already-built `GuideRelationshipCapability` 6-dimension model (see the exact mapping in section T of this document, "Guide decomposition" below).
- Known semantic mixing: self-documented conflation of source and behavior in the flat enum.
- What O1 may safely encode: the `haircutting.guideType` concept shell referencing the 4 existing flat tokens, with a single uniform concept-level `LegacyTokenStatus: AMBIGUOUS` (N.1) applied to all 4, plus per-token `legacyMappingCorrespondence` (N.2/N.3, informational only, never a binding gate).
- What O1 MUST NOT encode: a redesigned guideType enum; any claim about which of the 6 richer dimensions each flat token fully maps to.
- External research questions: is the 6-dimension model's exact split professionally correct and complete?
- Ionuț validation questions: does "45° Interior" use a traveling or stationary guide, and what serves as its structural authority?
- English research terms: "traveling guide vs stationary guide," "guideline hairdressing," "perimeter guide," "reference strand cutting."
- Romanian terminology to validate: "ghid," "linie de ghidare," "șuviță de referință."
- Must never be inferred automatically: guide behavior (stationary/traveling) from guide source alone.

**Priority, restated**: all four are **P0 — required before Skill Binding (T1.6.2.d)**. O2 cannot meaningfully proceed for any of them until the corresponding research + Ionuț validation is complete.

---

## Y. Risk register

| Risk | Rank | Evidence |
|---|---|---|
| `guideType` conflates source and behavior | **BLOCKING BEFORE d** | Self-documented in the guide-relationship contract's own header comment. |
| `elevation` mixes angle/technique-name/directional-relationship | **BLOCKING BEFORE O2** (for this concept) | Direct enum inspection; directly implicated in the real professional feedback that triggered this audit. |
| `sectioning` mixes global/local scale | **BLOCKING BEFORE O2** (for this concept) | Direct enum inspection; directly implicated in the real, currently-unsaved review decision. |
| cuttingAngle/cuttingLine have no canonical values | **HIGH** | Confirmed absent everywhere; not unsafe today (free text is safe), blocks any future canonical review of exactly the concept flagged by real professional feedback. |
| Three independent, overlapping provenance vocabularies | **HIGH** | Exact member-set evidence in M; not unsafe today (each correctly scoped to its own subsystem), a real obstacle to unified Brain reasoning later. |
| No `scope` concept exists anywhere yet | **HIGH** | Directly causes the elevation/sectioning risks above; currently mitigated only by a reviewer's personal judgment, not a system rule. |
| Presentation labels vs. definitions boundary — correct today, easy to regress | **MEDIUM** | The boundary is correctly enforced today; nothing yet computes a semantic digest that would *catch* a future accidental authority-label leak. |
| Free-text execution parameters (fingerAngle, toolOrientation, etc.) | **MEDIUM** | Honest placeholders today, not unsafe, a real completeness gap. |
| `positioning` not yet updated to match TD's own already-executed split | **LOW** | TD already fixed this class of problem; Learning hasn't caught up; nothing currently consumes Learning's field for execution. |
| Cross-field confusion (wrong-field mapping) | **LOW, actively defended** | Extensively, adversarially proven safe across the entire c.1/c.1a/c.1b review chain — zero leakage found in dozens of probes. |
| Narrow double-provider-call race under true concurrency | **DEFERRED, out of scope for ontology** | Pre-existing, unrelated to this audit (see the c.1b review), bounded by a real DB unique constraint. |
| Color vocabulary disconnected from Proposal/TD/Skill chain | **DEFERRED** | Real, but fully out of scope until O7. |
| Styling vocabulary entirely absent | **DEFERRED** | Confirmed absent by direct search; not started. |

**No item above is classified `BLOCKING BEFORE O1`** — O1 is inert by design and hard-codes no uncertain semantics (every ambiguous field ships as an explicit placeholder).

---

## Z. Explicit non-goals

This document, and the O1 slice it authorizes, explicitly do **not**:

- Define final professional meaning for elevation, sectioning, cuttingAngle, cuttingLine, or guide semantics.
- Split, merge, deprecate, or rename any existing production enum or token.
- Add any new column, table, or migration to the Prisma schema.
- Wire the new registry into the extractor, semantic guard, b.0, b.0.1, b.1, b.2, or c.
- Build T1.6.2.d's binding mechanism.
- Activate eligibility, Brain, ExecutionPlan validation, or any downstream consumer.
- Begin external/web research (that happens after this handoff, producing input for O2).
- Introduce an alias mechanism, a shared/global promotion mechanism, or DB-backed ontology editing.
- Touch color or styling vocabularies beyond documenting their current state.

---

## Real-case fixtures (mandatory reference examples for future scope/O1 tests)

### The real 45° case

| Item | Concept | Scope | Evidence | Claim | Professional authority | Execution relevance |
|---|---|---|---|---|---|---|
| elevation = 45° | `haircutting.elevation` | `ACTION` | AI-observed section held away from natural fall | `resolution: CANONICAL`, value `45_deg_graduation` | **CONFIRMED** (a real, persisted professional decision, per the supplied context) | Yes — binds a TD `elevation` step field once compiled |
| cutting geometry = "45° interior" | `haircutting.cuttingAngle` or `.cuttingLine` (undecided — P0.B) | `ACTION` | supplied professional context; no structured extraction field with a canonical enum exists yet | representable only as free text today | asserted in the supplied context; **not verified in this document as a persisted b.1 decision row** — stated precisely to avoid overclaiming | not yet — no canonical value exists to bind |
| thin vertical/slanted local sections | `haircutting.sectioning` or `.subsectioning` (undecided — P0.C) | `SUBSECTION` + `OBSERVATION_WINDOW` | AI-observed, professionally confirmed visually correct | `UNRESOLVED_TEXT`/`UNCLEAR_MEANING` (rawObservation-backed) | confirmed as *visually correct*, not as a *canonical sectioning decision* | not yet |
| possible global four-quadrant structure | `haircutting.sectioning` | `TECHNIQUE_GLOBAL` | none directly (inferred professional judgment about the complete technique) | **not yet a claim at all** | correctly, deliberately unconfirmed | not yet, and must never be inferred from the local evidence above |
| "45° Interior" (technique name) | Skill identity candidate | `TECHNIQUE_GLOBAL` | `techniqueCandidate` free-text extraction | not a canonical Skill yet | undetermined — no repo evidence this is a registered Skill | not applicable until a real `SkillDefinition` exists |
| guide semantics | `haircutting.guide.*` | undetermined | not covered by the supplied real-case context | none | none stated | not applicable yet |

**This table must never be read as promoting Ionuț's private technique statement into global ontology truth** — every row above stays exactly as scoped (private, owner-level, or explicitly unconfirmed) unless and until the full E/W promotion gates are separately satisfied.

### The real sectioning case

```
GLOBAL SECTIONING (candidate: possibly "4_quadrant_profile_radial")
  type: PROFESSIONAL CLAIM CANDIDATE, scope: TECHNIQUE_GLOBAL
  status: PROPOSED, intentionally UNSAVED — correct, current behavior,
  not a workaround (the video shows only a local portion)

LOCAL SUBSECTIONING (observed: "thin vertical/slanted working sections")
  type: OBSERVED CLAIM, scope: SUBSECTION + OBSERVATION_WINDOW
  status: professionally confirmed as visually correct
  representable today exactly as shipped (c.1a's rawObservation state)

PARTING DIRECTION (the specific vertical/slanted pattern)
  type: OBSERVED CLAIM, scope: SUBSECTION
  status: possibly the SAME fact as local subsectioning, or a separate,
  finer-grained fact — THIS DISTINCTION ITSELF NEEDS PROFESSIONAL
  VALIDATION (P0.C), not decided by this document
```

Neither layer overwrites the other today, by construction of the existing three-state review model. This fixture must be used as a literal test case once O1's scope field and any future scope-validation logic are built — to prove a local observation can never silently satisfy a global-scoped concept.

### Guide decomposition — exact six dimensions and legacy mapping

Source: `professional-skill-guide-relationship-contracts.ts`.

| Dimension | Symbol | Values |
|---|---|---|
| A. Guide source | `GuideSource` | `INITIAL_GUIDE, PREVIOUSLY_CUT_SECTION, PERIMETER_CONTOUR_GUIDE, EXTERNAL_REFERENCE_LINE, UNKNOWN` |
| — Guide role | `GuideRole` | `STRUCTURAL_AUTHORITY, CONTINUATION_GUIDE, UNKNOWN` |
| B. Guide behavior | `GuideBehavior` | `STATIONARY, TRAVELLING, UNKNOWN` |
| C. Current-section relationship | `GuideSectionRelationship` | `REFERENCES_GUIDE, CUT_RELATIVE_TO_GUIDE, BECOMES_NEXT_GUIDE, ALIGNED_TO_GUIDE, RELATIONSHIP_UNKNOWN` |
| D. Overdirection relationship | `OverdirectionRelationship` | `TOWARD_GUIDE, AWAY_FROM_GUIDE, NONE_OBSERVED, UNKNOWN` |
| E. Progression | `GuideProgressionState` | `FIXED_THROUGHOUT, PROGRESSES_EACH_UNIT, UNKNOWN` |
| F. Reference progression | `ReferenceProgressionState` | `REFERENCE_PROGRESSES_WITH_EXECUTION, REFERENCE_FIXED, UNKNOWN` |

Legacy `GUIDELINE_OPTIONS` mapping — every cell below is a `LegacyMappingCorrespondence` (N.2) value, **not** a `LegacyTokenStatus`. All four tokens additionally share one uniform concept-level `LegacyTokenStatus: AMBIGUOUS` (N.1/N.3), which is what actually governs binding safety — restated here so this table is never read in isolation as the binding-safety answer:

| Legacy value | Maps to | Legacy mapping correspondence (N.2) |
|---|---|---|
| `stationary` | `GuideBehavior: STATIONARY` | **PARTIAL** — one of six dimensions only |
| `traveling` | `GuideBehavior: TRAVELLING` | **PARTIAL** |
| `visual_perimeter` | `GuideSource: PERIMETER_CONTOUR_GUIDE` | **AMBIGUOUS_CORRESPONDENCE** — names a source, not a behavior; direct proof of the flat enum's conflation |
| `multiple_reference` | no single clean target identified | **NO_MAPPING** — needs professional research |

No mapping beyond this table is asserted; none is invented. See N.3 for the full stationary/traveling worked resolution, including the binding-safety answer.

### Color finding (corrected, restated for the record)

A real, if currently disconnected, color vocabulary exists — `web/src/lib/color-plan-engine.ts` + `contracts.ts` (from the earlier M27 Hair Recommendation Engine milestone), explicitly self-documented as "not yet part of `AnalysisEngineInput`... deliberately isolated and unconnected," with **no** wiring into `PROPOSAL_VERTICALS`, TD, Professional Learning, or the Skill/ExecutionPlan chain.

| Category | Status | Symbol/values |
|---|---|---|
| formula | already exists | `ColorFormulaDirection`: `single_process_gray_coverage, gloss_demi_permanent, root_shadow_melt, balayage_freehand, double_process_lightening, color_correction_neutralize` |
| developer | already exists | `ColorDeveloperVolume`: `10vol, 20vol, 30vol, 40vol` |
| tone | already exists | `ColorToneDirection`: `cool_ash, warm_gold, neutral, cool_violet, warm_copper` |
| application technique | already exists | `ColorApplicationTechnique`: `global_application, root_touch_up, foils, balayage_freehand, color_melt` |
| application order | partial | `ColorStep.stepNumber` (ordering exists), `zone`/`action` free text |
| sectioning | partial | `ColorStep.zone` — free string, no canonical enum |
| base/target level | absent | not found; `liftLevels: number` on `ColorPlan` is adjacent but not the same concept |
| mix ratio | absent | not found |
| saturation | absent | not found directly; `toneDirection` adjacent |
| starting state | partial, unreconciled | `ColorProfile` (`hairCondition`, `porosity`, `desiredColorResult`, `grayPercentage`) — a second, separate "starting state" model, not reconciled with `HairStateSnapshot` |
| processing | already exists | `processingTimeMinutes`, `processingSteps` |
| correction | already exists, folded in | `color_correction_neutralize` is one `ColorFormulaDirection` member, not its own dimension |
| compatibility | absent, vertical-specific | not found |

Classified as **future HairColor ontology-pack input (O7), no refactor now**. Semantic risk flagged for whenever this resumes: `ColorProfile`'s own starting-state model needs reconciliation with `HairStateSnapshot` — real duplication, not yet resolved.

---

## Haircutting canonical matrix

*(Concepts with real, verified evidence from the completed audit. `techniqueCandidate, professionalObjective, startingState, tool, iteration, prerequisites, incompatibilities, safety, professionalRationale, stylingRelationship, domain, discipline` were not individually re-verified against TD/Skill usage during the audit and are marked unaudited here rather than assumed absent.)*

*(The "Legacy status" column below is exclusively `LegacyTokenStatus` (N.1) — the binding-safety axis. Where a concept has no actual token enum to classify, the cell reads "n/a, no tokens." Per-token `LegacyMappingCorrespondence` (N.2) detail, where it exists, is documented separately in the guide-decomposition fixture, never inline here, to keep the two axes visibly distinct.)*

| Concept | Source(s) | Token(s) | Semantic status | Scope capability | Observability | Execution role | Skill usage | TD usage | Definition status | Duplication/conflict | Legacy status (`LegacyTokenStatus`) | Research priority | O1 membership | O2 requirement | Recommended role |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| elevation | shared enum | 5 tokens | mixed axes, flagged | mixed within enum | not yet classified | PARAMETER | none direct | direct, phase-scoped | none | none (single source) | AMBIGUOUS | **P0** | **YES** | **YES** | PARAMETER |
| sectioning | shared enum | 5 tokens | scope-mixed, flagged | global/local mixed | not yet classified | PARAMETER | none direct | direct | none | none (single source) | AMBIGUOUS | **P0** | **YES** | **YES** | PARAMETER |
| guideType | shared enum + richer capability model | 4 tokens (+6-dim model) | self-documented conflation | unclear | not yet classified | STRUCTURAL_RELATIONSHIP-shaped PARAMETER | via `SkillParameterDefinition` (3 skills, ad hoc) | direct | none | **yes — 2 models, unreconciled** | AMBIGUOUS (concept-level, uniform across all 4 tokens — see N.3 for per-token `LegacyMappingCorrespondence` detail) | **P0** | **YES** | **YES** | PARAMETER, pending guide-dimension reconciliation |
| guideSource | free text (Learning) / closed enum (guide contract) | none / 5 values | maturity mismatch | n/a | not yet classified | PARAMETER | via guide contract | n/a | none | yes | n/a, no tokens (folded into guideType) | P0 (folded into guideType) | NO (folded) | folded into guideType | STRUCTURAL_RELATIONSHIP |
| cuttingAngle | free text ×2 | none | placeholder | undefined | not yet classified | PARAMETER (pending) | none | placeholder field only | none | consistent placeholder | n/a, no tokens | **P0** | **YES (shell only)** | **YES** | PARAMETER (pending) |
| cuttingLine | free text ×2 | none | placeholder | undefined | not yet classified | PARAMETER (pending) | none | placeholder field only | none | consistent placeholder | n/a, no tokens | **P0** | **YES (shell only)** | **YES** | PARAMETER (pending) |
| distribution | shared enum | 5 tokens | clear | scope unclear | not yet classified | PARAMETER, TD-derived | none direct | direct | none | none | CANONICAL | P1 | no | P1 | PARAMETER |
| overdirection | boolean (TD) / 4-value relation (guide contract) | — | two granularities, complementary | n/a | n/a | EFFECT/derived | via guide contract | boolean flag | none | flagged, not blocking | n/a, no token enum (a boolean field, not an enum, in TD; the 4-value `OverdirectionRelationship` enum lives under the guide concept, not here) | P1 | no | P1 | STRUCTURAL_RELATIONSHIP |
| fingerAngle/fingerPosition/toolOrientation | free text ×2 each | none | placeholder | undefined | not yet classified | PARAMETER (pending) | none | placeholder fields only | none | consistent placeholder | n/a, no tokens | P2 | no | P2 | PARAMETER (pending) |
| subsectioning/subsectionThickness | free text ×2 each | none | placeholder | undefined | not yet classified | PARAMETER (pending) | none | placeholder fields only | none | consistent placeholder | n/a, no tokens | P2 | no | P2 | PARAMETER (pending) |
| progression | free text (TD, unified) / 2 typed enums (guide contract, deliberately split) | — | already correctly split in the richer model, not propagated | n/a | n/a | CONTROL_FLOW / STRUCTURAL_RELATIONSHIP (multi-valued, per K) | via guide contract | free text | none | yes, self-documented | n/a, no token enum (typed fields, not a token enum, on both sides) | P1 | no | P1 | CONTROL_FLOW + STRUCTURAL_RELATIONSHIP (multi-valued) |
| crossCheck | boolean (TD) / free text (Learning) | — | maturity mismatch | n/a | evidence-oriented | CONTROL_FLOW | none | boolean | none | minor | n/a | P2 | no | P2 | CONTROL_FLOW |
| applicableZones | free text (Learning) / closed `HeadZone` enum (TD) | — / 6 values | maturity mismatch | HEAD_REGION | directly observable | CONTEXT | none | direct | none | not conflicting, unpropagated | CANONICAL (TD side) | P1 | no | P1 | CONTEXT |
| completionCondition | free text | none | placeholder | undefined | evidence-oriented | CONTROL_FLOW | none | none | none | none | n/a | P2 | no | P2 | CONTROL_FLOW |
| targetEffect | free text | none | placeholder | undefined | interpretation-required | EFFECT | none | none | none | overlaps `HairStateDelta`, unreconciled | n/a | P1 | no | P1 | EFFECT |
| positioning (client/observation) | free text (Learning) / already-split typed fields (TD) | — | maturity mismatch, TD already fixed it | ACTION vs. REVIEW | directly observable | CONTEXT | none | direct, split | none | resolved in TD, not in Learning | DEPRECATED (Learning-side, unsplit) | P2 | no | P2 | CONTEXT |

---

*End of materialized architecture document. This document does not change production behavior. Its sole purpose is to make the completed T1.6.2.c.2 audit's approved choices available in the repository for O1 implementation, replacing the audit's own conversational record as the source of truth for that handoff.*
