# T1.6.2.c.2a — O1 Canonical Professional Concept Registry Foundation

Local implementation only. No push, deploy, O2 research, Skill binding, or Brain activation.

## Authority and baseline

The complete `T1_6_2_C_2_PROFESSIONAL_KNOWLEDGE_ONTOLOGY_ARCHITECTURE.md`, including contract errata #1, is the implementation authority. It was read before edits and remains unchanged.

Fresh-fetched `origin/master`: `e7ddd483bddfc5a5eaabac7eedffb85ba16d7e21`.
Inherited architecture commit: `368024bcdcf275a74e5e329efffb7188431693d1`.
Inherited errata commit / implementation parent: `4b7a0d18295105cf0d50b57dee15eaa91bf27bb3`.
Both documentation commits remain intact. The tracked tree and index were clean before implementation. All seven untracked scratch artifacts matched the SHA-256 baseline in `T1_6_2_C_PROFESSIONAL_REVIEW_UI.md`.

## Files and structural contracts

Only new files are introduced:

- `professional-concept-contracts.ts` and its test: identity, scope, observability, roles, relationships, independent legacy axes, guards and semantic fingerprinting.
- `professional-canonical-value-contracts.ts` and its test: unchanged token identity, definition reference, presentation labels, legacy status and correspondence metadata.
- `professional-definition-contracts.ts` and its test: future O2 contract and digest projection; no real definitions or provenance instances registered.
- `professional-concept-registry.ts` and its test: pack validation, reference checks, DFS cycle checks, immutability and production boundary tests.
- `professional-concept-cutting-pack.ts` and its test: the sole vertical pack. Sibling packs can use the same core without adding branches to cutting.
- This milestone.

The TypeScript modules are under `web/src/lib/`. No existing production or test file is modified. The extra cutting sibling module implements architecture Q's explicit per-vertical file separation.

## Exact membership and unresolved content

| Concept | Existing source | Values | Status |
|---|---|---:|---|
| `haircutting.elevation` | `ELEVATION_OPTIONS` | 5 | `AMBIGUOUS` uniformly |
| `haircutting.sectioning` | `SECTIONING_OPTIONS` | 5 | `AMBIGUOUS` uniformly |
| `haircutting.guideType` | `GUIDELINE_OPTIONS` | 4 | `AMBIGUOUS` uniformly |
| `haircutting.cuttingAngle` | shell only | none | absent: no tokens to classify |
| `haircutting.cuttingLine` | shell only | none | absent: no tokens to classify |

All concepts use vertical `cutting`. No other concepts/verticals are registered. Original enums are imported, not re-declared, renamed, split or rewritten. English labels reference existing `analysis-field-options` labels and are tested against the shipped review labels. O1 does not introduce or translate labels.

Scope, observability and every value's semantic meaning retain the exact `[NEEDS PROFESSIONAL VALIDATION]` placeholder. The three existing enum concepts use the matrix's `PARAMETER` role; the two cutting geometry shells retain a role placeholder. Relationships, legacy mappings and definitions are empty. No technique definition or private professional decision is imported.

All four architecture P0 workstreams remain `NEEDS_RESEARCH` / `NEEDS_IONUȚ_VALIDATION`: elevation/projection, cuttingAngle/cuttingLine, sectioning/subsectioning/parting, and guide semantics. None is resolved by these code identities. O2 still requires the research artifacts and Ionuț validation specified in architecture T/X.

## Locked models

Scopes: `TECHNIQUE_GLOBAL`, `HEAD_REGION`, `SECTION`, `SUBSECTION`, `STRAND`, `ACTION`, `PHASE`, `OBSERVATION_WINDOW`. Existing `HeadZone` is reused; no new zone enum.

Observability is two axes: `DIRECTLY_OBSERVABLE`, `PARTIALLY_OBSERVABLE`, `VOICE_OR_TEXT_EXPLAINABLE`, `PROFESSIONAL_INTERPRETATION_REQUIRED`, `NOT_RELIABLY_VISUAL`; channels `VISUAL`, `AUDIO`, `BOTH`, `TEXT`. No real observability assignment or extraction guidance is generated.

The single `conceptType` field is multi-valued: `DESCRIPTIVE`, `STATE`, `PARAMETER`, `CONSTRAINT`, `ACTION`, `CONTROL_FLOW`, `EFFECT`, `CONTEXT`. There is no redundant concept-level execution-role field.

Relationship identifiers are the exact entries in architecture L: `PART_OF`, `CONTAINS`, `APPLIES_TO`, `PRECEDES`, `FOLLOWS`, `CONSTRAINS`, `REQUIRES`, `MODIFIES`, `PRODUCES_EFFECT`, `USES_GUIDE`, `USES_TOOL`, `OBSERVED_AS`, `EXECUTED_BY`, `INCOMPATIBLE_WITH`, `NOT_EQUIVALENT`. L has 13 table rows and 15 identifiers because two rows contain inverse pairs; the handoff's count is read against its explicit table. No relationship instance is asserted in the pack.

The validator rejects missing/self references and cyclic acyclic-kind graphs. It normalizes inverse pairs and uses the WHITE/GRAY/BLACK DFS precedent from `isValidAtomicActionSequence`. A consistent forward/inverse pair is not mistaken for a cycle.

## Legacy axes and safety

`LegacyTokenStatus`: `CANONICAL`, `LEGACY_ALIAS`, `DEPRECATED`, `AMBIGUOUS`, `NEEDS_SPLIT`.

`LegacyMappingCorrespondence`: `EXACT`, `PARTIAL`, `AMBIGUOUS_CORRESPONDENCE`, `MIXED`, `NO_MAPPING`.

| Guide token | Token status | Correspondence | Existing target |
|---|---|---|---|
| `stationary` | `AMBIGUOUS` | `PARTIAL` | `GuideBehavior.STATIONARY` |
| `traveling` | `AMBIGUOUS` | `PARTIAL` | `GuideBehavior.TRAVELLING` |
| `visual_perimeter` | `AMBIGUOUS` | `AMBIGUOUS_CORRESPONDENCE` | `GuideSource.PERIMETER_CONTOUR_GUIDE` |
| `multiple_reference` | `AMBIGUOUS` | `NO_MAPPING` | no target value; dimension placeholder |

The richer guide model remains unchanged; these partial references do not reconstruct a capability or fill its missing dimensions. O1 follows S's uniform concept/value status requirement. It does not invent a relative ordering among lifecycle states for future per-value exceptions. Conflicting legacy-mapping classifications fail validation.

Correspondence never authorizes binding. Tests vary every correspondence against both blocked statuses and reject attempts to introduce an unblocked member. There is no binding helper, automatic resolver, alias-resolution mechanism or override path. The structural validator returning true means only that a record is well formed; it is never a professional authority/eligibility result. The architecture's future `LEGACY_ALIAS` approval and `DEPRECATED` historical-compatibility rules are not runtime features of O1.

## Versioning and fingerprints

Initial code-first version: `1.0.0-t162c2a`. Concept and definition use `specificationVersion`/`specificationDigest`; values retain H's `semanticVersion`/`semanticDigest` names. Version consistency is checked throughout a pack and its references.

The private canonical JSON encoder is copied verbatim from existing specification governance to keep existing production code untouched. Explicit semantic projections remove undefined members before encoding. Object keys sort; array order remains significant; SHA-256 produces `sha256:<hex>`. The existing field-specification governance and goldens are untouched.

Identity, scope, roles, observability, relationships, referenced value digest/token identity, aliases/classification, token status and correspondence entries participate. Definition text, distinctions, source language/term and provenance authority type participate. Version labels, localized labels, presentation formatting/order and review timestamp do not. Definition IDs are metadata excluded per G. Value-digest changes propagate through concept references. Tests pin all five concept digests under the initial version; normal tests/build never regenerate fixtures.

These are placeholder-content fingerprints, not professionally validated semantics or authority. No old decision/version is rewritten.

## Provenance mapping (documentation only)

| Existing vocabulary members | Named axis | O1 treatment |
|---|---|---|
| Learning: `OBSERVED`, `INFERRED`, `PROFESSIONAL_INPUT`, `UNKNOWN`, `EXTERNAL_RESEARCH`, `MANUFACTURER_CLAIM`, `TREND_SIGNAL` | EvidenceOrigin | unchanged |
| TD: `OBSERVED`, `INFERRED`, `UNKNOWN`, `PROFESSIONAL_OVERRIDE`, `NOT_APPLICABLE`, `DETERMINISTIC_DERIVATION` | ExecutionKnowledgeOrigin | unchanged |
| Hair State: `not_yet_assessed`, `observed`, `inferred`, `professional_input`, `ai_proposed`, `client_reported`, `reference_image` | proposed EvidenceOrigin | reconciliation remains unvalidated; unchanged |
| Professional decision: `CONFIRMED`, `CORRECTED`, `UNKNOWN`, `REJECTED` | ProfessionalAuthorityOrigin | documented only; no decision import |
| New concept-level observability classes above | ObservationStatus | structural type only, not instance provenance |

These remain independent vocabularies. No conversion or shared enum is introduced.

## Real cases and boundaries

The 45-degree elevation token belongs only to `haircutting.elevation`; the two geometry identities stay separate shells without asserted equivalence or professional differences. The private technique name is not registry data.

Global sectioning is not assigned from a local subsection/observation-window/parting observation. Tests reject those observation/decision payloads at the registry boundary; the shared concept retains unknown scope. Subsectioning and parting are not extra O1 concepts, nor is their professional distinction resolved. No observation-to-canonical conversion exists.

Strict record guards reject private owner/decision fields. No professional decision, learned private fact or evidence source enters the registered pack. No production source may import/reference the O1 modules; AST tests scan the source tree and check the exact outbound import allowlist. Existing vocabulary dependencies import only erased types (including the pre-existing Prisma type import), so O1 introduces no database client/runtime dependency.

Zero changes to Prisma, migrations, tables, dependencies, lockfiles, env/config, providers or production consumers. Zero Skill binding, applicability/eligibility activation, Brain consumption, TD/ExecutionPlan integration, Photo Preview or Result Video behavior changes.

## Validation evidence

| Gate | Result |
|---|---|
| Safe regression selection | 143 suites / 2,714 tests passed |
| Final O1 tests after adversarial refinements | 5 suites / 57 tests passed |
| Typecheck | passed |
| Final touched-file ESLint | passed, zero warnings/errors |
| Full ESLint | passed, zero errors; 120 pre-existing warnings in unchanged files |
| Production build | passed; 11 pre-existing Turbopack storage/backup tracing warnings in unchanged paths |
| Diff whitespace check | passed before commit |

Regression selection covers Professional Learning, c.1a/c.1b, structured-field governance, b.0/b.1/b.2/c, reviewed procedural knowledge and eligibility, Skill contracts/registry, TD, Brain/reasoning, selectors/compilers, consultation review controllers and color vocabulary. The DB guard required a localhost/127.0.0.1 host and database name `ai_hair_architect_test` before running. No production DB was accessed. Known L5 tests and Gemini real-provider acceptance tests were excluded. Mock/stub provider tests were included; no real provider invocation occurred.

Commands: `npm run typecheck`; targeted `node node_modules/eslint/bin/eslint.js` over the ten new TypeScript files; `npm run lint`; `npm run build`; selected `node node_modules/vitest/vitest.mjs run ...`; `git diff --cached --check`. Full regression output is in the session's temporary `o1-regressions.log`; final O1 output in `o1-final-unit.log`; static gate logs use the `o1-` prefix in the same temporary directory. No generated log or scratch file is committed.

The first touched lint run caught a reserved local variable name in the new boundary test; it was corrected and the final run is clean. Adversarial review tightened uniform status validation and added conflicting-classification, guide-target and transitive dependency checks. The final O1 test/typecheck/lint runs include these changes. Existing production consumers were not edited, so the completed broader regression/build gates remain applicable.

## Adversarial review

Checked: exact five identities; no final definition; no language-dependent identity; no presentation leakage into hashes; independent legacy axes; no PARTIAL authority; uniform blocked status enforcement; alias collisions; unresolved references and cycles; no private-to-canonical promotion; no local-to-global conversion; no elevation/cutting geometry collapse; no guide flattening; no DB/provider/decision imports; no runtime consumer or binding/activation path.

No remaining contradiction prevents this inert O1 implementation. Nonblocking textual observations: L's 13 rows contain 15 relationship identifiers; the guide table includes GuideRole in addition to its six lettered dimensions. Explicit identifiers and the existing richer model are preserved. O1's uniform statuses satisfy both concept/value safety statements without defining future per-value exception ordering. All professional ambiguities remain open for O2.
