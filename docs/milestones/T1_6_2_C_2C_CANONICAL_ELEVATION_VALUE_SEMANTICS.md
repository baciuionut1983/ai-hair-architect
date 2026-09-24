# T1.6.2.c.2c — Canonical Elevation Value Semantics

Local implementation of the authoritative [c.2c architecture](T1_6_2_C_2C_CANONICAL_ELEVATION_VALUE_ARCHITECTURE.md), read in full before implementation. No release is authorized by this milestone.

## Baseline and scope

- Fresh origin/master and production parent: `e3af5ffb505e54574365b963ab6222d68c317d61`.
- Inherited architecture commit: `b5bbb6fb5aefc76a49644d711e5c098524c549e8`, directly atop that parent; retained without amendment, squash or rebase.
- Initial tracked tree and index clean; seven known untracked scratch artifacts matched their recorded SHA-256 hashes.
- Existing branch: `pre-release/a33fc85-ci-validation`; authority is the verified history, not the branch name.
- One new local implementation commit is intended atop the architecture commit. No push or deployment.

Production code changes are limited to the version constant in `professional-concept-contracts.ts`, pack construction in `professional-concept-cutting-pack.ts`, and the exact three-line status check in `professional-concept-registry.ts`. Tests update the registry, cutting-pack and O2 definition suites, add `professional-concept-elevation-values.test.ts`, and add the frozen O2 fixture. This milestone is the ninth changed/added file. The canonical architecture and O1.1 fixture/test remain untouched.

## Values, status and mapping provenance

Pack version is uniformly `1.3.0-t162c2c`: 12 concepts, 19 values, eight definitions and matching references. There are exactly five new pure angles, appended after the five historical elevation values in ascending order. Their labels are numeric degrees only; semanticMeaning retains the required placeholder. The existing O2 Elevation concept definition supplies the angle semantics; there are no redundant definitions, scopes, effect rules, aliases or relationships.

| Historical token (AMBIGUOUS) | Clean token (CANONICAL) | Correspondence |
|---|---|---|
| `0_deg_blunt` | `0_deg` | PARTIAL |
| `45_deg_graduation` | `45_deg` | PARTIAL |
| `90_deg_uniform_layer` | `90_deg` | PARTIAL |
| `135_deg_long_layer` | `135_deg` | PARTIAL |
| `180_deg_overdirection` | `180_deg` | PARTIAL |

Each historical value receives exactly one existing `legacyMappingCorrespondence` entry with `targetModelRef: "haircutting.elevation"`, `targetDimension: "AngleComponent"`, the table's targetValue and `correspondence: "PARTIAL"`. It maps only the angle component, never the mixed token's whole meaning. Historical identities, labels and AMBIGUOUS status remain unchanged. Clean values carry no correspondence of their own.

The concept remains AMBIGUOUS and references all ten values. Its existing `legacyMappings` field contains exactly five `{token: <clean token>, classification: "CANONICAL"}` declarations. These are status overrides, distinct from component correspondence. Clean values are not legacy tokens; they share the registry's existing closed status type.

Provenance is the originating professional validation and the exact architecture §§E–G, supported by inspection of the historical vocabulary. No external source, fabricated reviewer/date, parallel mapping contract, or note field is introduced. Mapping identity is included in the owning value's existing digest; there is no separate mapping digest algorithm.

## Validator and adversarial assessment

The sole validator edit is exactly architecture §B: look up the owning concept's exact token override, fall back to concept.status, then require exact equality with value.status. Existing reverse consistency, duplicate detection, reference ownership, digest validation and no-orphans checks are unchanged.

Tests re-pin adversarial packs before validation so rejection cannot be attributed merely to stale digests. Missing, duplicate, nonexistent-value, mismatched and cross-concept overrides are rejected. Elevation declarations cannot authorize sectioning, guideType or an undeclared legacy token. All 25 status combinations retain historical equality behavior with empty overrides. Correspondence, including PARTIAL or EXACT, cannot substitute for a status override.

This is the architecture-approved generic explicit per-concept/per-token mechanism, not an elevation-ID hardcode or an authorization system. A separately governed concept could explicitly declare its own consistent override under this contract; it cannot borrow elevation's override or bypass the remaining invariants. The correspondence shape guard still accepts textual target pointers, as architecture §E explicitly requires. Exact shipped targets are pinned in tests; no target-resolution adapter is created.

Adversarial source/diff review found no accidental whole-token equivalence, technique/effect semantics in clean values, implicit status exception, historical token rewrite, consumer, UI/TD/Skill migration, binding, eligibility change or Brain activation. No blocking finding.

## Semantic digest record

Unmodified digest functions compute all goldens; angle identity, status, mapping target, correspondence and semantic note changes affect identity. Labels and version labels do not. There is no supported review/date metadata field on the correspondence contract; none was invented.

Elevation concept changes from `sha256:ec9b50d9826f25ef21c233901710ac9a8281eca9e50c0240fc2538f033a57e78` to `sha256:d5c1b8ed934d23c44e32b9e7c7d2f83c6f8874807587f584f6973a20f184fb71` because membership, referenced value digests and overrides change.

| Clean value | Pinned semantic digest |
|---|---|
| `0_deg` | `sha256:e98798fa0f4fb43f342ed759de5d7acc5a20075913524401b835b010f05a8dee` |
| `45_deg` | `sha256:50062e9e9896ad234c27198a1efe0031bf4df1d5d17dddcc1bda5555d0b845b8` |
| `90_deg` | `sha256:fde40c649387d77f40ccd7f73e98d120ad4b02836de4e48dc6e6ba57ded257ad` |
| `135_deg` | `sha256:05851da67357251c6709879b069ade80934f7fb1026467d6606096279b3a0bcc` |
| `180_deg` | `sha256:d1909003ee2243610cdd4a9fd71c0c5c71e39f37c3ae1ecccd26cf7b273da7cb` |

| Legacy value, now including its PARTIAL mapping | Pinned semantic digest |
|---|---|
| `0_deg_blunt` | `sha256:1b6466ebe2aac6d758b00296ce401e018653899b804a6a6260f0a5fa2835e80b` |
| `45_deg_graduation` | `sha256:828cc984b5da5fe5368807db26e48b5e30379f40c72d781122a6a0c952a40ec6` |
| `90_deg_uniform_layer` | `sha256:ad61f82ccbdf39b83bc6a8992acaf7e3a229c4c395158f9b035b09db1a27f304` |
| `135_deg_long_layer` | `sha256:9c19cb795517b29ee4d4f85af1ef9bfa195b1851388e093571b3d6018b6f00f2` |
| `180_deg_overdirection` | `sha256:19ba0c4ade0486b832994e3b2f269966b37e9281f026928b73bbd829c5b77968` |

The five legacy elevation digests deliberately change under architecture §D, overriding the continuation's generic request to preserve them. All other 11 concept digests, nine legacy value digests and eight O2 definition digests are unchanged, independently compared with the frozen O2 records. Historical digests remain reproducible in their historical version.

## History and compatibility

`web/src/lib/__fixtures__/professional-concept-pack-1.2.0-t162c2b.json` was captured before production code edits and independently compared byte-for-byte with the pack evaluated from the production commit's Git blobs. Tests never regenerate it. O1 baseline goldens, the unchanged O1.1 snapshot/tests and the new O2 snapshot retain historical reproducibility. O2 definition assertions now use their historical fixture; current definitions are separately compared with it. The identity-expansion suite already uses O1.1, so there was no live-pack assertion to repoint.

The supplied read-only decision triple `{field:"elevation", decision:"CORRECTED", professionalValue:"45_deg_graduation"}` remains accepted by the existing runtime validator and byte-unchanged in its frozen test fixture. This is not a claim to have read or copied a complete persisted production row. No production row was read or written. Clean tokens remain unavailable to the unchanged review/runtime enum.

`STRUCTURAL_TECHNIQUES` remains exactly `precision_layering`, `graduation`, `one_length`, `internal_layering`, `compact_graduation`. Zero elevation/natural fall is distinct from One Length; 45° is distinct from Graduation. Their professionally supplied associations are recorded here and in architecture §K but require a future knowledge relationship, not equality. 90° contains no Uniform Layers identity; 135° contains no Long Layers identity; neither absent structural identity is invented. 180° is distinct from `haircutting.overdirection` and has no overdirection association.

UI, Professional Learning, TD contracts and Skill parameter vocabularies are unchanged. Graduated Cutting, One-Length Perimeter and 45° Interior source hashes are pinned against the baseline. 45° Interior retains separate semantics/provenance and gains no connection to the reviewed claim. Decision service, structured claims, vocabulary and eligibility source hashes are also pinned. Existing AST/import isolation tests establish zero production ontology consumers.

## Semantic readiness and remaining limits

A future explicit adapter can extract the angle component from `45_deg_graduation` through its PARTIAL pointer to `haircutting.elevation / 45_deg`. The clean target is CANONICAL; the whole historical token stays AMBIGUOUS. This establishes semantic readiness only. No binding row, adapter, activation or professional decision is created.

Remaining downstream blockers are persisted-decision scope, Skill-target binding semantics, applicability, eligibility, a ProfessionalKnowledgeEntry concept/value kind and Brain consumption. `owner-knowledge-eligibility.ts` remains unchanged and fail-closed. No work on d or T1.6.3.

No schema, migration, dependency, production DB access or AI-provider call. Broad regression tests may exercise only the explicitly guarded localhost `ai_hair_architect_test` database; that test activity is distinct from ontology implementation, which performs no DB access. L5 scratch-writing and real-provider acceptance suites are excluded.

## Validation

- Regression gate: **147 suites / 2,795 tests passed**, including all eight ontology suites (133 tests), Professional Learning, c.1a/c.1b, structured review, b.0/b.1/b.2/c, T1.5/T1.6.1, Skill Engine, TD, Brain/reasoning, selector/compiler and relevant color coverage. The new c.2c suite has 27 tests, including the nested 25-case status matrix.
- Regression runner explicitly guarded the database hostname (`localhost` or `127.0.0.1`) and database name (`ai_hair_architect_test`) before launching. Real-provider acceptance and L5 suites were excluded. Test output includes expected negative-path diagnostics; the final test exit status is zero.
- Typecheck: passed after correcting one new JSON fixture type assertion; no production type issue.
- Touched-file lint: passed without warnings. Full lint: passed, zero errors and 120 pre-existing warnings in untouched files.
- Production build: passed. Eleven pre-existing Turbopack filesystem-tracing warnings concern storage/backup paths; no new warning category. Build-time font network access was permitted; no AI provider was invoked.
- `git diff --check`: passed. Final source review confirms only the three authorized production files changed; protected UI/TD/Skill/Prisma/eligibility/digest implementations and historical architecture/fixture remain untouched.
- Independent O2 fixture verification against production Git blobs passed. All seven scratch SHA-256 hashes were rechecked after tests/build and remain unchanged.

No implementation blocker remains. Existing lint/build warnings and the pre-existing branch label are nonblockers. The generic nature of explicit status overrides and unchanged textual correspondence shape validation are deliberate architecture boundaries, not newly introduced authority. Independent review is the next step; deployment, real binding, eligibility and downstream scope remain unauthorized here.
