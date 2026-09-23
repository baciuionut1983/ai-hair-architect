# T1.6.2.c.2a.1 — Canonical Identity Expansion

Local implementation of `T1.6.2.c.2a.1 IDENTITY ARCHITECTURE — GO FOR EXPANSION`, supplied in the task. This decision authorizes exactly seven additional identity shells and supersedes the earlier five-identity membership limit for this slice only. The canonical c.2 architecture and released O1 milestone remain unchanged as historical authority.

## Baseline and purpose

Fresh-fetched HEAD and origin/master: `4decea5a7ed4289d45f4c15ea5a9815003a6ee2d`. Tracked tree/index were clean; exactly seven known scratch artifacts were untracked, all SHA-256 hashes matching the c UI milestone baseline.

The O2 HOLD identified missing canonical ownership for section/subsection/parting and related concepts, plus ambiguity in the legacy sectioning and guideType umbrellas. The approved identity decision now supplies exact IDs and keeps the legacy umbrellas intact. This slice supplies ownership only; it does not populate the professionally supplied definitions or resolve all O2 content questions.

The c.2 architecture and O1 milestone were consumed in full, and the released contracts/registry/pack and seven-dimension Skill guide model were inspected directly. No core contract, validator, hashing mechanism, existing vocabulary or runtime consumer was redesigned.

## Exact registry

Original five, retained in their original order:

1. `haircutting.elevation`
2. `haircutting.sectioning`
3. `haircutting.guideType`
4. `haircutting.cuttingAngle`
5. `haircutting.cuttingLine`

Exactly seven additions:

6. `haircutting.section`
7. `haircutting.subsection`
8. `haircutting.subsectioning`
9. `haircutting.parting`
10. `haircutting.projection`
11. `haircutting.overdirection`
12. `haircutting.guide`

All use vertical `cutting`, stable machine names, `[NEEDS PROFESSIONAL VALIDATION]` for unresolved scope/observability/conceptType, empty relationships and empty legacy mappings. New shells have no status, canonical values, aliases, effects, procedural rules or bindings. Definitions remain an empty array. No thirteenth identity is introduced.

## Identity decisions preserved

- Sectioning remains the existing pattern/scheme identity, `AMBIGUOUS`, with its five unchanged records. It is not redefined as section, subsection, subsectioning or parting.
- Section and subsection identify professional objects; `SECTION` and `SUBSECTION` remain orthogonal scope identifiers describing where a claim applies. No object definition or concrete scope assignment is added.
- Subsectioning supplies separate process/system identity ownership. No `PROCESS`/`OBJECT` role enum is invented; absent an approved assignment, execution-role metadata remains unresolved.
- Parting is separate from sectioning. Future direction belongs under parting; no `haircutting.partingDirection` identity or direction values are added.
- Projection is separate from elevation. No alias or equivalence relationship is asserted.
- Overdirection owns future definitions, without moving `180_deg_overdirection`, `overdirected_back`, `overdirected_forward`, or changing `OverdirectionRelationship`.
- Guide is a new core identity. Legacy guideType remains `AMBIGUOUS` with four unchanged records and unchanged correspondence metadata.
- Stationary/fixed and traveling/moving are future **new** values under guide, referencing existing GuideBehavior semantics. None is added now. Legacy stationary/traveling remain `AMBIGUOUS + PARTIAL` under guideType.
- Guide mobility remains distinct from overdirection. Elevation, cuttingAngle and cuttingLine remain separate; no cutting-geometry value or definition is added.
- No relationship instances are invented, including process-to-result mappings; no relationship kind is added.

## Existing seven independent Skill guide dimensions

Verified directly from `GuideRelationshipCapability` in `professional-skill-guide-relationship-contracts.ts` and pinned structurally by an AST test:

| Field | Existing type |
|---|---|
| guideSource | GuideSource |
| guideRole | GuideRole |
| guideBehavior | GuideBehavior |
| currentSectionRelationship | GuideSectionRelationship |
| overdirectionRelationship | OverdirectionRelationship |
| progression | GuideProgressionState |
| referenceProgression | ReferenceProgressionState |

Identity, note and `unknownNumericFields` are metadata, not additional dimensions. The Skill guide module is untouched; no seven dimension concepts are registered. Its richer model is not flattened into guideType or the new guide shell.

## Version and digest preservation

Uniform version label: `1.1.0-t162c2a1` across pack, 12 concepts, 14 existing canonical values and their references. Version labels are excluded from semantic fingerprints. No hashing or projection code changes.

The original five golden SHA-256 digests are retained byte-for-byte in the registry test under the original `1.0.0-t162c2a` fixture and checked against the expanded pack's first five entries. A second test pins the **entire original five-concept plus 14-value content**, excluding only version-label fields, to `sha256:d77ea89558c1d453d05057c6f79fe1bd5454121371d3ae955451aaa08d06dd17`. This fingerprint was captured against released O1 before the implementation edits and includes labels, statuses, correspondence, reference/value digests and all other original fields.

Seven new reviewed shell goldens under `1.1.0-t162c2a1`:

| Concept suffix | SHA-256 hex (stored with `sha256:` prefix) |
|---|---|
| section | `08437c8d59395e7a8177303aba41bdca8c6793cc31469742f6d84e3feddb7ab0` |
| subsection | `4cbd9591cd18a178d892c42e95563f6c2bd4976930db4eab2ef7e7638e941fc6` |
| subsectioning | `c167fde94a9bfb3c4b1fe1c47fe7d4c664143b0a76309e3549f95adcf09a41b1` |
| parting | `fdb78223fdcb3627335de3f6bba88c530c8a9d44f56e016dd3968c623bf6fe21` |
| projection | `f81fc0510cf248bb4623cc784a8c18251d90843f3364c1d3755c3084207c0e6a` |
| overdirection | `d98bd2553e70b8301d758cbeeb792ac748e493628a0fc6de8e6655ba5d087521` |
| guide | `395d58fda9c55157671a58e71f7c37b2378ec2363e3d67e0977b1d61b7b399ba` |

Goldens are not regenerated by tests/build. Tests separately prove uniform version labels and version-label/presentation-only digest invariance. These remain placeholder-shell digests, not validated professional semantics.

## Private knowledge and inertness

The private 45° Interior technique supplies no global definition, concept, angle assignment, finger orientation, rotation, guide relationship, effect or finishing procedure. New shells retain unknown scope; local observations do not become global rules. Existing private-payload rejection tests remain active.

The O1 production boundary scan and outbound dependency checks remain intact. No existing runtime consumes the registry: no Professional Learning/review, T1.6.1, Skill, Brain/reasoning, TD, compiler/ExecutionPlan, provider, Photo Preview or Result Video integration. No Prisma/schema/migration, dependency/lockfile, env/config or provider change. Tests that require persistence use the explicitly guarded local TEST DB only; no production DB is used.

## Validation and adversarial review

Final local gates passed: 84 tests in six ontology suites; 2,746 tests in 145 relevant regression suites; TypeScript typecheck; touched-file lint (zero warnings); full lint (zero errors, 120 pre-existing warnings); and the production build (11 pre-existing Turbopack file-tracing warnings). Regression selection excluded scratch-writing L5 and real-provider acceptance tests, and persistence tests used the guarded local test database. No Gemini or production route was invoked.

During verification, the new AST test was corrected to exclude `unknownNumericFields` metadata from the seven guide dimensions, and its mapped tuple received an explicit `as const` annotation for TypeScript inference. Final tests and typecheck include both corrections. No production behavior change was needed.

The original architecture, O1 milestone, Skill guide contracts, proposal validators, registry validator, Prisma/schema/migrations and dependency manifests/lockfiles remain unchanged. All seven pre-existing scratch JSON files retain their recorded SHA-256 hashes and remain excluded from the commit. Diff whitespace checks passed.

Adversarial inspection covers all 12 IDs, empty shell shape, unchanged original content/digests, sectioning/guideType preservation, no legacy status relaxation, no aliases or invented relationships, scope/concept separation, no private promotion, unchanged seven guide dimensions, no runtime consumers and no binding/activation.

## O2 readiness and limits

Definition ownership is now available for elevation, section, subsection, subsectioning, parting, projection, overdirection and guide. The identity-expansion blocker is addressed. O2 remains a separate task: record approved provenance, validate definition scope/observability where needed, resolve new value content and any semantic-version consequences under that task's authority. CuttingAngle/cuttingLine still await general professional validation/research. Sectioning and guideType retain their legacy ambiguity. No definitions or new values are authorized by this slice; no O2, Skill binding, d or T1.6.3 work was performed.
