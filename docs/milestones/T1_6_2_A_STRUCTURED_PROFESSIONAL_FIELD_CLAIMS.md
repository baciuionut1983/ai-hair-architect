# T1.6.2.a — Structured Professional Field Claims

Pure, unconsumed bridge over the frozen Professional Learning extraction. Baseline:
`609f8d1af991729739ea8dba320b4ed7f2151da5`. No fourth professional vocabulary.

## Field specifications

| Identity / extraction field | Canonical vocabulary | Semantic category | Kind / normalization | Unknown | Future correction |
| --- | --- | --- | --- | --- | --- |
| elevation | proposal-validators ELEVATION_OPTIONS, TechnicalCutElevation | elevation only | enum / exact identity | yes | yes |
| sectioning | proposal-validators SECTIONING_OPTIONS, TechnicalCutSectioning | sectioning only | enum / exact identity | yes | yes |
| guideType | proposal-validators GUIDELINE_OPTIONS, TechnicalCutGuideline | guide type only | enum / exact identity | yes | yes |

Every specification carries `1.0.0-t162a` and a validator. Learning field names are
type-constrained to the existing extraction contract. Values are imported from
the same primitive arrays used by TD, never copied as independent enums. These
enum primitives are compatible with SkillParameterDefinition's enum allowedValues
shape. No particular skill is loaded, selected or validated. T1.6.2.b.0 removes
`potentiallySkillBindable`; actual bindability belongs to future T1.6.2.d registry
evaluation. This metadata removal does not change field meaning or validation.

The TD override validator module also imports derivation logic. This layer instead
imports the underlying pure primitive validators. Prisma imports there are type-only;
the transitive runtime graph consists of exactly three pure files, enforced by tests.

## Scope and semantics

The smallest initial set deliberately excludes every other extraction field.
`cuttingLine` and `cuttingAngle` retain their existing raw extraction semantics and
are not hydrated: their TD representation is unrestricted text, insufficient for
a safe canonical decision value here. Likewise defer phase (no Learning field),
zone/applicability mappings, distribution, overdirection and other free-text fields.
No fuzzy matching, trimming, case folding, numeric parsing or synonym mapping.

`45° Interior` describes cutting-line geometry in the existing skill, not elevation.
Neither that skill name nor `45°` nor cuttingLine/cuttingAngle can hydrate elevation.
Only the explicitly named elevation field with a valid canonical elevation token
(including `45_deg_graduation`) passes. Unknown geometry is not guessed.

Taxonomy distinguishes OBSERVATIONAL from DECISION_RELEVANT_STRUCTURED_FIELD.
The latter describes field structure, not truth, review approval or eligibility.
Existing T1.5 frequency objects remain observational; this layer neither rewrites
them nor accepts their shape as a field value. UNKNOWN extraction has an explicit
null normalized state, never a future review decision. Missing fields yield no claim.

## Pure hydration and provenance

Input is the frozen extraction plus existing draft id, sourceEvidenceId and
extractorVersion references. Hydration cannot prove that an input is authentic or
frozen; a future caller must supply the authoritative frozen snapshot. No DB or
evidence lookup occurs. IDs `field:<field>` are stable within that snapshot; draft
provenance scopes them across snapshots. Conflicting observations must not be
combined into one extraction: it has one existing slot per field.

Explicit requests for unsupported fields fail closed. Unselected unsupported fields
remain only in the original extraction. Invalid selected fields reject the batch
without partial claims. Duplicate selections collapse; output sorts by field name.
All outputs are independently cloned and deeply frozen without freezing/mutating input.

`original` preserves the AI field value, source, confidence, note, rawObservation and
existing segment/frame references. `normalized` is separate even when its primitive
value is identical. Only OBSERVED, INFERRED or UNKNOWN extraction sources are allowed;
professional input is not mislabeled AI original. Existing segment times, relevance,
confidence and frame references are validated and retained, never turned into
applicability. No new spatial annotation or coordinate system is invented.

Professional value validation accepts canonical enum values only. Common text safety
rejects C0/C1, Unicode format controls (including zero-width and bidi), isolated
surrogates and additional invisible characters; maximum 2,000 UTF-16 units per string.
No sanitization changes meaning. Provenance is bounded to 100 segments and 100 frame
references per segment; malformed or unsafe provenance fails closed.

## Architecture locks and validation

No review history/persistence, binding, eligibility activation, API, UI, migration,
provider, prompts, Brain decisions, selector, compiler, video or consult integration.
Temporal evidence is provenance only. T1.5 storage and projection are untouched;
T1.6.1 remains INELIGIBLE-only. Future review history must be append-only and separate.
Future layers own evidence verification and revocation. b.0 adds an observation
digest without authenticating evidence or activating binding.

Boundary tests allow only the pure b.0 candidate module as a consumer (it has no
production consumers), inspect transitive runtime
imports, and lock protected T1.5/T1.6.1/Brain/provider/compiler files to baseline hashes.
Behavioral tests cover canonical values, determinism, identity, duplicate selection,
UNKNOWN, original independence, semantic separation, text safety and provenance.
Run targeted tests, relevant pure regressions, typecheck, touched-file lint and build.
No push or deploy is part of this slice.

Local validation: 58 new tests; 283 tests passed across 13 files including existing
T1.5/T1.6.1 regressions (their existing integration fixtures use local test Postgres).
Typecheck and touched-file ESLint passed. Production build passed with the 11
pre-existing file-tracing warnings; its first sandbox attempt could not fetch Google
Fonts, so the identical command was rerun with network permission. No source or
configuration workaround. Final diff contains only four new files; all seven scratch
artifact hashes match baseline. No new module performs DB reads/writes or provider I/O.
