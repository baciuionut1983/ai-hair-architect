# T1.6.2.c.2c — Canonical Elevation Value Architecture

**Status: architecture materialization, resolves the Codex HOLD. No ontology code is added by this document. This is the sole implementation authority for c.2c — every choice Codex previously found unavailable is locked below, deterministically.**

Baseline this document was written against: `e3af5ffb505e54574365b963ab6222d68c317d61` (production, `T1.6.2.c.2b`). Adds no code, no schema, no migration, no dependency. The completed `T1.6.2.c.2c` pre-implementation audit (this task's own prior turn) is the source of every finding restated here; this document exists to remove the five specific implementation blockers that audit correctly left open.

The real, persisted professional decision (`field: "elevation"`, `decision: "CORRECTED"`, `professionalValue: "45_deg_graduation"`) is never touched by this document or by the c.2c slice it authorizes.

---

## A. Why Codex correctly held — restated precisely

Reading `professional-concept-registry.ts` line-by-line (not assumed) shows two independent, exact mechanisms that make naive value addition unsafe:

1. **Uniform-status check** (`isValidProfessionalConceptPack`): for every value in the pack, `if (concept.status !== undefined && value.status !== concept.status) return false;` — this runs unconditionally, keyed by the value's own `conceptId`, regardless of whether the concept's own `canonicalValues` reference array lists it. A value with `status: "CANONICAL"` and `conceptId: "haircutting.elevation"` fails this check today, unconditionally, because the concept's own status is `AMBIGUOUS`.
2. **No-orphans check**: `if (referenced.size !== values.size) return false;` — every value must be referenced in its owning concept's own `canonicalValues` array, with no exception.

Together these mean: it is **impossible**, under the current validator, to register a value under `haircutting.elevation` with any status other than `AMBIGUOUS`, no matter how the pack is structured. This is not an implementation gap Codex could route around — it is the validator correctly enforcing the architecture's own stated invariant (F: concept-level status "is always at least as strict as any individual value's own status (never looser)"). Marking the clean values `AMBIGUOUS` "merely to satisfy the validator" is explicitly rejected by this task's own instruction — and rightly so, since it would be professionally false (the clean values are not ambiguous; only the legacy ones remain so). The correct fix is therefore a small, precisely-scoped, already-anticipated validator extension — not a workaround on either side.

## B. Locked resolution — the exact validator change (Blocker #3 + #4, combined)

**Decision: reuse the existing, already-typed, currently-inert `ProfessionalConcept.legacyMappings` field (F) as the explicit, auditable per-token override mechanism it was always documented to be** ("kept for concepts whose member tokens might eventually carry different statuses from the concept's own status" — F, `legacyMappings` row). No new field, no new contract, no new type.

**Exact change to `isValidProfessionalConceptPack`** (the one line that currently reads):
```
if (concept.status !== undefined && value.status !== concept.status) return false;
```
**becomes:**
```
const override = concept.legacyMappings?.find(m => m.token === value.valueToken);
const expectedStatus = override ? override.classification : concept.status;
if (expectedStatus !== undefined && value.status !== expectedStatus) return false;
```

Nothing else in the file changes. The existing `legacyMappings` consistency check (lines 55–59, unmodified) already enforces the reverse direction — every declared override must match a real value's real status — so the two checks are bidirectionally consistent with zero further code.

**Why this is safe and backward-compatible, not a loosening**: every historical `ProfessionalConcept` in O1/O1.1/O2 has `legacyMappings: []` (empty). For an empty array, `override` is always `undefined`, so `expectedStatus` always falls back to `concept.status`, and the new code produces **byte-identical pass/fail results to the old code for 100% of existing data** — this is a strict generalization, not a change in behavior for anything that exists today. The new behavior only activates for a concept that explicitly, individually, auditably declares an exception — never implicitly, never for a whole status tier at once.

**This directly resolves Blocker #4**: clean values get their true, professionally-correct `status: "CANONICAL"`. `haircutting.elevation`'s own concept-level `status` stays `"AMBIGUOUS"`, unchanged — correctly reflecting that the concept *as a whole* still contains five unresolved legacy members. A consumer who only reads concept-level status remains conservative (safe); a consumer who reads a specific value's own status (H's own stated authority: "Governs binding safety") gets the true, professionally-validated answer for that value alone.

## C. Concept digest — locked resolution (Blocker #3)

**Decision: A — the concept digest SHOULD change, and this is correct, not a defect.**

Two genuinely new pieces of semantic content are added to `haircutting.elevation`'s own record: (1) its `canonicalValues` reference array grows from 5 to 10 entries (the no-orphans rule forces this — the 5 new values must be referenced), and (2) its `legacyMappings` array grows from empty to 5 entries (the override declarations from §B). Both fields are already, unambiguously part of `conceptDigest`'s existing projection and part of P's own digest-boundary table ("`canonicalValues`... YES"; "`legacyMappings`... YES — an alias reclassification is a semantic event"). A digest that *didn't* change under these additions would be the actual bug — it would mean the digest silently ignored real new governed content.

**Historical reproducibility, preserved exactly as in every prior slice**: a new frozen fixture, `web/src/lib/__fixtures__/professional-concept-pack-1.2.0-t162c2b.json`, captures the exact pre-c.2c (O2-era) `CUTTING_PROFESSIONAL_CONCEPT_PACK` output, mirroring the already-proven `professional-concept-pack-1.1.0-t162c2a1.json` pattern exactly. The O1.1 fixture and its own tests remain completely untouched. `haircutting.elevation`'s **old** digest (under `1.2.0-t162c2b`) remains independently verifiable forever against this new frozen snapshot; its **new** digest (under `1.3.0-t162c2c`) is a different, equally real, equally reproducible value, pinned as its own golden.

## D. Which digests actually change — precise, not assumed

This is the one place this slice genuinely differs from every prior one, and it must be stated exactly:

- `haircutting.elevation`'s own concept digest: **changes** (§C).
- The **5 elevation legacy values'** own digests (`0_deg_blunt`, `45_deg_graduation`, `90_deg_uniform_layer`, `135_deg_long_layer`, `180_deg_overdirection`): **change**, because each receives a new `legacyMappingCorrespondence` entry (§E) — and `legacyMappingCorrespondence` is already, explicitly part of `canonicalValueDigest`'s projection and P's table ("a correspondence upgrade... is genuine new understanding, not presentation"). This is the documented, sanctioned case, not a new rule.
- The **other 9 legacy values** (sectioning ×5, guideType ×4): **unchanged** — zero relation to elevation, zero edits.
- The **other 11 concepts** (sectioning, guideType, cuttingAngle, cuttingLine, section, subsection, subsectioning, parting, projection, overdirection, guide): **unchanged**.
- The **8 O2 definitions**: **unchanged** — c.2c adds no `ProfessionalDefinition` record (§H).
- The **real, persisted `ProfessionalFieldClaimDecision` row** (`45_deg_graduation`, CORRECTED): **never touched, at any layer, by any mechanism in this document.** It is a Prisma-backed, immutable, append-only record entirely outside the ontology pack; nothing in c.2c reads or writes it.

## E. The five exact legacy-to-clean mappings (Blocker #2, #7)

**Decision: reuse H's existing `legacyMappingCorrespondence` / `LegacyCorrespondenceEntry` mechanism verbatim — the exact same shape already proven for `guideType`'s `stationary`/`traveling` → `GuideBehavior` mapping (N.3). No new contract type is introduced.**

Each of the 5 legacy elevation values receives exactly one new `LegacyCorrespondenceEntry`:

| Legacy token | `targetModelRef` | `targetDimension` | `targetValue` | `correspondence` |
|---|---|---|---|---|
| `0_deg_blunt` | `"haircutting.elevation"` | `"AngleComponent"` | `"0_deg"` | `PARTIAL` |
| `45_deg_graduation` | `"haircutting.elevation"` | `"AngleComponent"` | `"45_deg"` | `PARTIAL` |
| `90_deg_uniform_layer` | `"haircutting.elevation"` | `"AngleComponent"` | `"90_deg"` | `PARTIAL` |
| `135_deg_long_layer` | `"haircutting.elevation"` | `"AngleComponent"` | `"135_deg"` | `PARTIAL` |
| `180_deg_overdirection` | `"haircutting.elevation"` | `"AngleComponent"` | `"180_deg"` | `PARTIAL` |

`PARTIAL` (never `EXACT`) for all five — each legacy token still carries an un-mapped second axis (a technique/result/directional label) that this entry does not resolve, exactly matching N.2's own definition of `PARTIAL` ("the legacy token correctly corresponds to one target dimension but is silent about others the richer model distinguishes"). `targetDimension: "AngleComponent"` is a new, minimal, honest label naming exactly the one axis being mapped — never implying the second axis (technique/result) has been mapped, discarded, or asserted equal. **This is not whole-token equivalence** — it is the identical safety shape already shipped for guideType, applied here for the first time to elevation.

The `isLegacyCorrespondenceEntry` shape guard is unmodified — `targetModelRef`/`targetDimension`/`targetValue` are free text today (exactly as they already are for guideType's pointer into external `GuideBehavior` code), never cross-validated against the pack. No validator change is needed for this part.

## F. Mapping provenance (Blocker #2 continued)

The correspondence entries above are supported directly by the professional validation supplied in the originating task (0°/45°/90°/135°/180° pure-angle confirmations) plus direct inspection of the five historical tokens — no external citation, no fabricated source. No separate provenance/date field is added to `LegacyCorrespondenceEntry` — it never had one (guideType's own entries carry none either), and its content already participates fully in the owning value's `semanticDigest` (via `canonicalValueDigest`'s unmodified projection). Review metadata (who/when this mapping was authored) is out of scope for this contract, exactly as it already is for guideType — consistent, not a gap.

## G. Exact five clean canonical value tokens (Blocker #1)

**Locked**: `0_deg`, `45_deg`, `90_deg`, `135_deg`, `180_deg`. Registered under the existing `haircutting.elevation` concept (`conceptId: "haircutting.elevation"` on each) — no new concept identity. No collision with any of the 5 legacy tokens (`0_deg_blunt`, etc. — distinct strings). Each:

```
{
  conceptId: "haircutting.elevation",
  valueToken: "45_deg",                       // etc.
  semanticMeaning: PROFESSIONAL_VALIDATION_REQUIRED,
  localizedLabels: { en: "45°" },              // presentation only, numeral-only, no technique word
  semanticVersion: "1.3.0-t162c2c",
  status: "CANONICAL",
  // legacyMappingCorrespondence intentionally absent: these are the
  // TARGET of legacy correspondence entries (§E), never the source.
}
```

Ordering in the pack: appended after the 5 legacy tokens, in ascending angle order (`0_deg, 45_deg, 90_deg, 135_deg, 180_deg`), mirroring the existing seed-array convention.

`semanticMeaning` stays the placeholder — **no new `ProfessionalDefinition` is needed** (§H below); a bare numeric-angle token under the already-locked, angle-only O2 concept definition is semantically complete without redundant per-value prose.

## H. Value-definition representation (Blocker #5)

**Decision: C — concept definition + numeric canonical value only. No per-value `ProfessionalDefinition` is created.** The existing, locked O2 `haircutting.elevation` definition already states exactly and only "the angle at which a selected hair strand or subsection is lifted and held relative to the shape/curvature of the head." A value token of `"45_deg"` under that definition needs no further prose — inventing one would either redundantly restate the concept definition or risk smuggling in exactly the technique/result content this whole slice exists to keep out. This matches existing precedent exactly: none of the original 14 legacy values has ever had its own `ProfessionalDefinition` either.

## I. Legacy status / correspondence — final treatment (confirms prior audit)

All 5 legacy elevation tokens: `LegacyTokenStatus` **stays `AMBIGUOUS`, unchanged**. New `legacyMappingCorrespondence: PARTIAL` (§E) — informational only, never a binding-safety gate (N.2), never loosens the concept-level or value-level `AMBIGUOUS`.

## J. Clean value status/authority model (Blocker #4 restated)

Each of the 5 clean values: `status: "CANONICAL"`, declared via a matching `haircutting.elevation.legacyMappings` entry (§B) — e.g. `{token: "45_deg", classification: "CANONICAL"}` — enforced bidirectionally by the existing, unmodified consistency check. Clean values are **not** "legacy" in any sense other than sharing the `LegacyTokenStatus` type (which is simply the one closed binding-safety vocabulary the whole registry uses) — the document and any future code comment must say so explicitly, exactly as this section does, to avoid the mislabeling the task warns against.

## K. Associated professional semantics — destination table

Restated and finalized from the completed c.2c audit, using only already-existing repository vocabulary — nothing invented:

| Pure angle | Associated result/technique | Existing identity? | Destination |
|---|---|---|---|
| 0° | One Length | Yes — `"one_length"` (`StructuralTechnique`, `proposal-validators.ts`), and the real `skill-cutting-one-length-perimeter` Skill | future `haircutting.structuralTechnique` concept (unregistered today, same tier as `distribution`) + a future relationship instance — **not created by c.2c** |
| 45° | Graduation | Yes — `"graduation"` (`StructuralTechnique`) | same, **not created by c.2c** |
| 90° | Uniform layered result | No existing identity anywhere | deferred — no `StructuralTechnique` member exists for it; not invented here |
| 135° | Longer layering | No existing identity anywhere | deferred — same |
| 180° | (none — explicitly not overdirection) | `haircutting.overdirection` already exists as its own concept | n/a — 180° carries no association at all |

c.2c registers zero relationship instances, zero new `StructuralTechnique` values, and zero new concepts for these associations — they remain exactly where the prior audit placed them, out of scope.

## L. One Length / Graduation / Uniform Layers / Long Layers / Overdirection

Restated for the record, unchanged from the completed audit: One Length and Graduation already exist (`StructuralTechnique` + real Skills); Uniform Layers and Long Layers exist nowhere except as fragments of the legacy token strings/labels being cleaned up here; Overdirection already has its own full O2 concept. None is created, migrated, or touched by c.2c.

## M. Scope, observability

Unchanged from the completed audit: clean angle values carry no scope of their own (scope remains a property of a claim, never a value's identity — I's model). No observability change; c.1a's extraction/correction behavior is untouched.

## N. Version

**Locked: `1.3.0-t162c2c`**, applied uniformly (pack-level and per-record, identical mechanism to O1.1 and O2's own uniform relabeling) across all 12 concepts, all 19 canonical values (14 existing + 5 new), and all 8 definitions. Old per-record `specificationVersion`/`semanticVersion` labels are simply superseded, never disturbing digests on their own (version labels remain digest-excluded, unchanged mechanism).

## O. Digest contracts — exact, no new mechanism

- **Clean value digest**: computed by the existing, unmodified `canonicalValueDigest` (projects `valueToken, conceptId, semanticMeaning, legacyAliases, observability, executionSemantics, status, legacyMappingCorrespondence`). A change to the angle identity (`valueToken`/`status`) changes the digest; a label-only or version-only change does not (both already excluded).
- **Legacy value digest**: same function, now also reflecting the new `legacyMappingCorrespondence` entry (§D). A change to `targetValue`/`correspondence` changes the digest (proves the mapping is real semantic content, not decoration); a `note`-only or date-only change would too, since `note` is not excluded by the projection — so no free-text `note` should be added unless it is genuinely intended as semantic content (recommend omitting `note` entirely for these 5 entries, to avoid accidental semantic-digest churn from presentation-feeling text).
- **Concept digest**: existing, unmodified `conceptDigest` (§C, §D).
- **No new digest function, no new hashing mechanism.**

Exact hex digest values are not pre-computed in this document — they are computed by the implementer using these unmodified functions against the exact records specified above, and pinned as test goldens during implementation, exactly as every prior slice has done.

## P. UI / review compatibility

**Locked: no UI migration.** The professional review UI and `ProfessionalFieldClaimDecision` persistence continue using `ELEVATION_OPTIONS`/the 5 legacy tokens exactly as today. Clean canonical values exist only in the ontology registry, for future binding — never surfaced to or required by the current review flow.

## Q. TD / Skill compatibility

**Locked: zero edits.** `ELEVATION_OPTIONS`, `TechnicalCutElevation`, `structured-professional-field-claims.ts`, `cutting-skill-graduated.ts`, `cutting-skill-one-length-perimeter.ts`, `skill-cutting-45-degree-interior.ts` (explicitly, per the originating task's own reminder — untouched) — none is read, imported, or modified by c.2c. The new values are pure ontology additions, exactly mirroring how O1.1's seven new concepts required zero edits to any existing enum or Skill.

## R. First real binding readiness after c.2c

Concept binding: unchanged, already safe. **Value binding of the clean `45_deg` value becomes semantically safe** (its own `status: "CANONICAL"`, honestly earned, not defaulted). Value binding of the **legacy** `45_deg_graduation` token **remains blocked** — its own status stays `AMBIGUOUS`, by design, since its second axis (graduation) is still unresolved. A future binding would need an explicit adapter: historical decision → its new `legacyMappingCorrespondence` entry → the clean `45_deg` value — this adapter is **d's job, not created here**.

## S. Downstream blockers preserved from d.0

Unchanged: scope is still absent from the persisted `ProfessionalFieldClaimDecision` row; `owner-knowledge-eligibility.ts` remains structurally hardcoded to `INELIGIBLE` for everything and scoped only to `REVIEWED_PROCEDURAL_CLAIM`; `ProfessionalKnowledgeEntry`'s 8 kinds still have no shape for a bound concept/value fact. c.2c resolves only the value-semantics blocker; these remain for a separate, later slice.

## T. Implementation contract (exact Codex handoff)

**Files to modify:**
- `web/src/lib/professional-concept-registry.ts` — the one-statement change in §B, nothing else.
- `web/src/lib/professional-concept-cutting-pack.ts` — extend the `elevation` seed's value generation: add the 5 clean tokens (§G) and the 5 `legacyMappingCorrespondence` entries on the existing legacy tokens (§E); add the `legacyMappings` array (§J) to the `haircutting.elevation` concept object; bump `PROFESSIONAL_CONCEPT_SPEC_VERSION` to `1.3.0-t162c2c` in `professional-concept-contracts.ts`.
- New: `web/src/lib/__fixtures__/professional-concept-pack-1.2.0-t162c2b.json` (frozen pre-c.2c snapshot, §C).
- Test files: extend `professional-concept-registry.test.ts`, `professional-concept-cutting-pack.test.ts`, `professional-concept-identity-expansion.test.ts` (repoint its historical-reproduction assertions at the new `1.2.0-t162c2b` fixture where they currently assert against the live pack), add a new `professional-concept-elevation-values.test.ts`.

**Files NOT touched**: `professional-canonical-value-contracts.ts`, `professional-definition-contracts.ts`, `professional-concept-contracts.ts` (other than the version constant), any TD/Skill/UI/Prisma file.

**Zero consumers, zero DB, zero migration, zero dependency** — identical inertness discipline to O1/O1.1/O2.

## U. Test contract

Exactly 5 clean values registered, exact token strings (§G) · no clean value token or label contains a technique/effect word (`blunt`, `graduation`, `uniform`, `layer`, `overdirection`) · `0_deg`≠`one_length`, `45_deg`≠`graduation`, `90_deg`≠any `uniform_layer` identity, `135_deg`≠any `long_layer` identity, `180_deg`≠`haircutting.overdirection` (five explicit distinct-identity assertions) · clean values `status: "CANONICAL"` under the new validator rule, live · legacy values remain `status: "AMBIGUOUS"`, live · exactly 5 new `PARTIAL` correspondence entries, one per legacy token · whole-token binding (legacy→concept without going through the mapping) remains structurally impossible · old fixture (`1.1.0-t162c2a1`) digests unchanged, independently recomputed · new fixture (`1.2.0-t162c2b`) captures the exact pre-c.2c live pack, independently recomputed · new c.2c concept/value digests deterministic and pinned · O1/O1.1/O2 all still reproducible via their respective frozen fixtures · the real `45_deg_graduation` decision fixture (read-only, not DB) byte-unchanged · zero UI/TD/Skill file diff · zero `skill-cutting-45-degree-interior` diff · zero Brain consumer · zero binding/eligibility/applicability activation.

## V. Self-consistency check (performed before finalizing)

Verified no contradiction across this document between: canonical vs. legacy (never conflated — five legacy tokens keep their identity and their `AMBIGUOUS` status permanently; five clean tokens are new, separate records); status model (concept-level `AMBIGUOUS` is a floor for undeclared members, `legacyMappings` is the sole, explicit, bidirectionally-checked override — no implicit loosening anywhere); mapping vocabulary (`legacyMappingCorrespondence`/`PARTIAL` used only for the legacy→clean angle-component pointer, never for status); digest scope (exactly which of the 31 total records change is enumerated in §D, nothing left ambiguous); versioning (`1.3.0-t162c2c`, uniform, labels excluded from digests as always). No use of "canonical," "legacy," "AMBIGUOUS," "PARTIAL," "digest," or "version" in this document contradicts another use.

---

*End of materialized architecture document. This document changes no production behavior. Its purpose is to make the completed T1.6.2.c.2c audit's choices, and the two blockers Codex correctly could not resolve alone, available in the repository as the deterministic implementation authority for c.2c.*
