import type {
  CuttingTechnique,
  StructuralTechnique,
  TechnicalCutDistribution,
  TechnicalCutElevation,
  TechnicalCutGuideline,
  TechnicalCutSectioning,
  TexturizingTechnique,
} from "@/lib/contracts";

// Technical Visual Map, Stage 2 -- runtime validators + the pure
// effective-map resolver for the TechnicalVisualMap domain. Mirrors
// proposal-validators.ts's own conventions (small exported allowlist
// arrays, `is*` type guards, `satisfies` against existing contract unions
// where reusing an existing enum). This file is types-only + pure
// functions -- no I/O, no database, no AI.

// ---------------------------------------------------------------------------
// Head zones (locked, Decision Lock) -- exactly 6, no left/right split, no
// "perimeter" (a constraint target, not a zone -- see
// PRESERVE_CONSTRAINT_TYPES below), no "interior" (already represented at
// the global technique level via structuralTechnique = "internal_layering").
// ---------------------------------------------------------------------------

export const HEAD_ZONES = ["crown", "occipital", "nape", "top", "sides", "fringe"] as const;
export type HeadZone = (typeof HEAD_ZONES)[number];

export function isHeadZone(value: unknown): value is HeadZone {
  return typeof value === "string" && (HEAD_ZONES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Source attribution -- every populated zone-local/constraint value must be
// explainable. "global_default" means "no zone-specific claim was ever
// made; this is the honest, unspecified baseline", never a disguised guess.
// ---------------------------------------------------------------------------

export const ZONE_VALUE_SOURCES = ["global_default", "deterministic_evidence", "professional_adjustment"] as const;
export type ZoneValueSource = (typeof ZONE_VALUE_SOURCES)[number];

export function isZoneValueSource(value: unknown): value is ZoneValueSource {
  return typeof value === "string" && (ZONE_VALUE_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Zone intent -- length/weight use OUR OWN new closed enums (so "unspecified"
// can be a first-class, honest value); elevation/distribution/texturizing
// reuse the EXISTING TechnicalCutPlan enum vocabulary (never duplicated) as
// OPTIONAL overrides -- absent means "no zone-local override", not a
// fabricated middle value forced into an enum that was never designed to
// hold one. Deliberately NO centimeters/measurements anywhere -- no
// evidence in this domain ever supports one.
// ---------------------------------------------------------------------------

export const ZONE_LENGTH_INTENTS = ["unspecified", "preserve", "maintain", "shorten"] as const;
export type ZoneLengthIntent = (typeof ZONE_LENGTH_INTENTS)[number];

export const ZONE_WEIGHT_INTENTS = ["unspecified", "preserve", "reduce", "build"] as const;
export type ZoneWeightIntent = (typeof ZONE_WEIGHT_INTENTS)[number];

export function isZoneLengthIntent(value: unknown): value is ZoneLengthIntent {
  return typeof value === "string" && (ZONE_LENGTH_INTENTS as readonly string[]).includes(value);
}

export function isZoneWeightIntent(value: unknown): value is ZoneWeightIntent {
  return typeof value === "string" && (ZONE_WEIGHT_INTENTS as readonly string[]).includes(value);
}

// Same literal enum values TechnicalCutPlan itself already uses -- see
// proposal-validators.ts's own ELEVATION_OPTIONS/DISTRIBUTION_OPTIONS
// (private there; re-declared here as the one place this domain needs them
// for validation, since importing a private const across modules is not
// possible -- the exported contracts.ts TYPES are reused directly, only the
// literal value lists are necessarily restated to validate against them).
const ELEVATION_VALUES = [
  "0_deg_blunt",
  "45_deg_graduation",
  "90_deg_uniform_layer",
  "135_deg_long_layer",
  "180_deg_overdirection",
] as const satisfies readonly TechnicalCutElevation[];

const DISTRIBUTION_VALUES = [
  "natural_fall",
  "perpendicular",
  "overdirected_back",
  "overdirected_forward",
  "shifting_line",
] as const satisfies readonly TechnicalCutDistribution[];

function isTechnicalCutElevation(value: unknown): value is TechnicalCutElevation {
  return typeof value === "string" && (ELEVATION_VALUES as readonly string[]).includes(value);
}

function isTechnicalCutDistribution(value: unknown): value is TechnicalCutDistribution {
  return typeof value === "string" && (DISTRIBUTION_VALUES as readonly string[]).includes(value);
}

const STRUCTURAL_TECHNIQUE_VALUES = [
  "precision_layering",
  "graduation",
  "one_length",
  "internal_layering",
  "compact_graduation",
] as const satisfies readonly StructuralTechnique[];

const CUTTING_TECHNIQUE_VALUES = [
  "blunt_line",
  "scissor_over_comb",
  "slice_cutting",
  "elevation_cutting",
] as const satisfies readonly CuttingTechnique[];

const TEXTURIZING_TECHNIQUE_VALUES = [
  "point_cutting",
  "slice_and_slide",
  "razor_texturizing",
  "channel_cutting",
  "debulking",
] as const satisfies readonly TexturizingTechnique[];

const SECTIONING_VALUES = [
  "4_quadrant_profile_radial",
  "horseshoe_crown",
  "diagonal_back",
  "pivot_radial",
  "horseshoe_fringe",
] as const satisfies readonly TechnicalCutSectioning[];

const GUIDELINE_VALUES = [
  "stationary",
  "traveling",
  "visual_perimeter",
  "multiple_reference",
] as const satisfies readonly TechnicalCutGuideline[];

function isStructuralTechnique(value: unknown): value is StructuralTechnique {
  return typeof value === "string" && (STRUCTURAL_TECHNIQUE_VALUES as readonly string[]).includes(value);
}
function isCuttingTechnique(value: unknown): value is CuttingTechnique {
  return typeof value === "string" && (CUTTING_TECHNIQUE_VALUES as readonly string[]).includes(value);
}
function isTexturizingTechnique(value: unknown): value is TexturizingTechnique {
  return typeof value === "string" && (TEXTURIZING_TECHNIQUE_VALUES as readonly string[]).includes(value);
}
function isTechnicalCutSectioning(value: unknown): value is TechnicalCutSectioning {
  return typeof value === "string" && (SECTIONING_VALUES as readonly string[]).includes(value);
}
function isTechnicalCutGuideline(value: unknown): value is TechnicalCutGuideline {
  return typeof value === "string" && (GUIDELINE_VALUES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Global intent -- a READ-ONLY mirror of the confirmed proposal's own global
// technique fields, copied ONCE here, never smeared across all 6 zones (the
// CRITICAL rule this whole domain exists to satisfy). Never edited via map
// adjustments -- see the Proposal vs Map boundary in
// technical-visual-map-repository.ts; a change here can only ever happen by
// going back to Proposed Look and reconfirming, which produces a brand new
// TechnicalVisualMap generation, not an edit of this one.
// ---------------------------------------------------------------------------

export interface TechnicalVisualMapGlobalIntent {
  structuralTechnique: StructuralTechnique;
  cuttingTechnique: CuttingTechnique;
  texturizingTechnique?: TexturizingTechnique;
  sectioning: TechnicalCutSectioning;
  elevation: TechnicalCutElevation;
  distribution: TechnicalCutDistribution;
  guideline: TechnicalCutGuideline;
}

export function isTechnicalVisualMapGlobalIntent(value: unknown): value is TechnicalVisualMapGlobalIntent {
  if (!isRecord(value)) return false;
  return (
    isStructuralTechnique(value.structuralTechnique) &&
    isCuttingTechnique(value.cuttingTechnique) &&
    (value.texturizingTechnique === undefined || isTexturizingTechnique(value.texturizingTechnique)) &&
    isTechnicalCutSectioning(value.sectioning) &&
    isTechnicalCutElevation(value.elevation) &&
    isTechnicalCutDistribution(value.distribution) &&
    isTechnicalCutGuideline(value.guideline)
  );
}

export interface ZoneIntentEntry {
  zone: HeadZone;
  // Always present -- "structurally present but semantically unspecified"
  // is the locked, correct default, never an absent/optional field.
  lengthIntent: ZoneLengthIntent;
  lengthIntentSource: ZoneValueSource;
  weightIntent: ZoneWeightIntent;
  weightIntentSource: ZoneValueSource;
  // Optional zone-local overrides on top of the plan's global technique
  // values (see TechnicalVisualMapPayload.globalIntent) -- absent means "no
  // override for this zone", reusing the exact existing enums.
  elevationOverride?: TechnicalCutElevation;
  elevationOverrideSource?: ZoneValueSource;
  distributionOverride?: TechnicalCutDistribution;
  distributionOverrideSource?: ZoneValueSource;
  texturizingApplicable?: boolean;
  texturizingApplicableSource?: ZoneValueSource;
  // Always present, default false -- an explicit "no density concern
  // recorded for this zone" is not the same as omitting the field.
  densitySensitive: boolean;
  densitySensitiveSource: ZoneValueSource;
  preserve: boolean;
  preserveSource: ZoneValueSource;
}

export function isZoneIntentEntry(value: unknown): value is ZoneIntentEntry {
  if (!isRecord(value)) return false;
  if (!isHeadZone(value.zone)) return false;
  if (!isZoneLengthIntent(value.lengthIntent) || !isZoneValueSource(value.lengthIntentSource)) return false;
  if (!isZoneWeightIntent(value.weightIntent) || !isZoneValueSource(value.weightIntentSource)) return false;
  if (value.elevationOverride !== undefined) {
    if (!isTechnicalCutElevation(value.elevationOverride)) return false;
    if (!isZoneValueSource(value.elevationOverrideSource)) return false;
  } else if (value.elevationOverrideSource !== undefined) {
    return false; // a source with no value is malformed
  }
  if (value.distributionOverride !== undefined) {
    if (!isTechnicalCutDistribution(value.distributionOverride)) return false;
    if (!isZoneValueSource(value.distributionOverrideSource)) return false;
  } else if (value.distributionOverrideSource !== undefined) {
    return false;
  }
  if (value.texturizingApplicable !== undefined) {
    if (typeof value.texturizingApplicable !== "boolean") return false;
    if (!isZoneValueSource(value.texturizingApplicableSource)) return false;
  } else if (value.texturizingApplicableSource !== undefined) {
    return false;
  }
  if (typeof value.densitySensitive !== "boolean" || !isZoneValueSource(value.densitySensitiveSource)) return false;
  if (typeof value.preserve !== "boolean" || !isZoneValueSource(value.preserveSource)) return false;
  return true;
}

// A valid `zones` array is exactly the 6 locked HeadZones, each appearing
// exactly once -- never more, never fewer, never an unknown/free-string
// zone. This is what keeps the "six-zone semantic skeleton" a real,
// enforced invariant rather than a convention the assembler could drift
// away from silently.
export function isZoneIntentArray(value: unknown): value is ZoneIntentEntry[] {
  if (!Array.isArray(value) || value.length !== HEAD_ZONES.length) return false;
  if (!value.every(isZoneIntentEntry)) return false;
  const zones = value.map((entry) => (entry as ZoneIntentEntry).zone);
  return HEAD_ZONES.every((zone) => zones.filter((z) => z === zone).length === 1);
}

// ---------------------------------------------------------------------------
// Zone relationships -- a SEPARATE array, never folded into ZoneIntentEntry
// (a relationship is inherently binary between two zones). The assembler
// NEVER creates these (see technical-visual-map-assembler.ts) -- only a
// professional adjustment legitimately can, hence the single-value `source`.
// ---------------------------------------------------------------------------

export const ZONE_RELATIONSHIP_TYPES = ["shorter_than", "longer_than", "same_length_as", "blends_into"] as const;
export type ZoneRelationshipType = (typeof ZONE_RELATIONSHIP_TYPES)[number];

export function isZoneRelationshipType(value: unknown): value is ZoneRelationshipType {
  return typeof value === "string" && (ZONE_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

// Symmetric relationship types have a real inverse (A shorter_than B means
// exactly the same claim as B longer_than A); "blends_into" is treated as a
// one-directional transition concept with no invented inverse -- only an
// EXACT duplicate of a blends_into entry is rejected, not a reversed one.
const RELATIONSHIP_INVERSES: Record<ZoneRelationshipType, ZoneRelationshipType | null> = {
  shorter_than: "longer_than",
  longer_than: "shorter_than",
  same_length_as: "same_length_as",
  blends_into: null,
};

export interface ZoneRelationshipEntry {
  sourceZone: HeadZone;
  relationship: ZoneRelationshipType;
  targetZone: HeadZone;
  // The assembler never produces one of these -- always "professional_adjustment".
  source: "professional_adjustment";
}

export function isZoneRelationshipEntry(value: unknown): value is ZoneRelationshipEntry {
  if (!isRecord(value)) return false;
  if (!isHeadZone(value.sourceZone) || !isHeadZone(value.targetZone)) return false;
  if (!isZoneRelationshipType(value.relationship)) return false;
  if (value.sourceZone === value.targetZone) return false; // reject same-zone relationships
  if (value.source !== "professional_adjustment") return false;
  return true;
}

// Two relationship ARRAY ENTRIES are duplicates if they are an exact match,
// or if one is the recognized inverse of the other referring to the same
// zone pair (see RELATIONSHIP_INVERSES above).
function relationshipsConflict(a: ZoneRelationshipEntry, b: ZoneRelationshipEntry): boolean {
  const exact = a.sourceZone === b.sourceZone && a.targetZone === b.targetZone && a.relationship === b.relationship;
  if (exact) return true;
  const inverseType = RELATIONSHIP_INVERSES[a.relationship];
  if (!inverseType) return false;
  return a.sourceZone === b.targetZone && a.targetZone === b.sourceZone && b.relationship === inverseType;
}

export function isZoneRelationshipArray(value: unknown): value is ZoneRelationshipEntry[] {
  if (!Array.isArray(value) || !value.every(isZoneRelationshipEntry)) return false;
  for (let i = 0; i < value.length; i += 1) {
    for (let j = i + 1; j < value.length; j += 1) {
      if (relationshipsConflict(value[i], value[j])) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Preserve / must-not-change constraints -- the locked closed vocabulary.
// `zone` is present only for zone-scoped types; `reference` carries frozen
// supporting text (e.g. the exact contraindication string) and is NEVER
// itself a machine instruction, only context. `do_not_modify_unrelated_
// appearance`, `preserve_identity`, and `preserve_face_proportions` are
// valid TYPES in this vocabulary (so a future Photo/Video sealed request or
// a professional adjustment can reference them) but the Stage 2 assembler
// never emits them -- see technical-visual-map-assembler.ts's own doc
// comment for why each is out of scope for deterministic map assembly.
// ---------------------------------------------------------------------------

export const PRESERVE_CONSTRAINT_TYPES = [
  "preserve_identity",
  "preserve_face_proportions",
  "preserve_hairline",
  "preserve_density_sensitive_area",
  "preserve_perimeter_weight",
  "respect_contraindication",
  "do_not_modify_unrelated_appearance",
] as const;
export type PreserveConstraintType = (typeof PRESERVE_CONSTRAINT_TYPES)[number];

export function isPreserveConstraintType(value: unknown): value is PreserveConstraintType {
  return typeof value === "string" && (PRESERVE_CONSTRAINT_TYPES as readonly string[]).includes(value);
}

// Zone-scoped constraint types -- only these may carry a `zone`.
const ZONE_SCOPED_PRESERVE_CONSTRAINT_TYPES: readonly PreserveConstraintType[] = [
  "preserve_hairline",
  "preserve_density_sensitive_area",
];

export const PRESERVE_CONSTRAINT_SOURCES = ["deterministic_evidence", "professional_adjustment", "system_default"] as const;
export type PreserveConstraintSource = (typeof PRESERVE_CONSTRAINT_SOURCES)[number];

export function isPreserveConstraintSource(value: unknown): value is PreserveConstraintSource {
  return typeof value === "string" && (PRESERVE_CONSTRAINT_SOURCES as readonly string[]).includes(value);
}

export interface PreserveConstraintEntry {
  type: PreserveConstraintType;
  zone?: HeadZone;
  reference?: string;
  source: PreserveConstraintSource;
}

export function isPreserveConstraintEntry(value: unknown): value is PreserveConstraintEntry {
  if (!isRecord(value)) return false;
  if (!isPreserveConstraintType(value.type)) return false;
  if (!isPreserveConstraintSource(value.source)) return false;
  if (value.zone !== undefined) {
    if (!isHeadZone(value.zone)) return false;
    if (!ZONE_SCOPED_PRESERVE_CONSTRAINT_TYPES.includes(value.type)) return false;
  }
  if (value.reference !== undefined && typeof value.reference !== "string") return false;
  return true;
}

// Exact-duplicate constraint entries are rejected (same type + zone +
// reference) -- two entries that merely share a type but differ in zone or
// reference are NOT duplicates (e.g. preserve_hairline is zone-fixed to
// "fringe" so it can only ever appear once meaningfully, but
// respect_contraindication legitimately repeats once per distinct
// contraindication string).
function constraintsAreDuplicate(a: PreserveConstraintEntry, b: PreserveConstraintEntry): boolean {
  return a.type === b.type && (a.zone ?? null) === (b.zone ?? null) && (a.reference ?? null) === (b.reference ?? null);
}

export function isPreserveConstraintArray(value: unknown): value is PreserveConstraintEntry[] {
  if (!Array.isArray(value) || !value.every(isPreserveConstraintEntry)) return false;
  for (let i = 0; i < value.length; i += 1) {
    for (let j = i + 1; j < value.length; j += 1) {
      if (constraintsAreDuplicate(value[i], value[j])) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The full payload
// ---------------------------------------------------------------------------

export interface TechnicalVisualMapPayload {
  globalIntent: TechnicalVisualMapGlobalIntent;
  zones: ZoneIntentEntry[];
  relationships: ZoneRelationshipEntry[];
  preserveConstraints: PreserveConstraintEntry[];
}

export function isTechnicalVisualMapPayload(value: unknown): value is TechnicalVisualMapPayload {
  if (!isRecord(value)) return false;
  return (
    isTechnicalVisualMapGlobalIntent(value.globalIntent) &&
    isZoneIntentArray(value.zones) &&
    isZoneRelationshipArray(value.relationships) &&
    isPreserveConstraintArray(value.preserveConstraints)
  );
}

// ---------------------------------------------------------------------------
// Professional adjustments -- a discriminated union, not a generic
// {field, newValue: unknown} shape, deliberately: the closed set of
// `target` discriminants IS the enforcement of the Proposal vs Map
// boundary -- there is structurally no way to construct an adjustment that
// targets a proposal-global field (structuralTechnique, cuttingTechnique,
// sectioning, elevation, distribution, guideline, texturizingTechnique all
// live only in TechnicalVisualMapGlobalIntent, which no adjustment target
// below ever references). `source` is always the literal "professional" --
// an adjustment is professional-sourced by definition, never anything else.
// ---------------------------------------------------------------------------

export const MAP_ADJUSTMENT_TARGETS = [
  "zone_length_intent",
  "zone_weight_intent",
  "zone_elevation_override",
  "zone_distribution_override",
  "zone_texturizing_applicable",
  "zone_density_sensitive",
  "zone_preserve",
  "zone_relationship_add",
  "map_preserve_constraint_add",
] as const;
export type MapAdjustmentTarget = (typeof MAP_ADJUSTMENT_TARGETS)[number];

interface BaseZoneAdjustment {
  zone: HeadZone;
  source: "professional";
  reason?: string;
}

export type MapAdjustmentEntry =
  | (BaseZoneAdjustment & { target: "zone_length_intent"; previousValue: ZoneLengthIntent; newValue: ZoneLengthIntent })
  | (BaseZoneAdjustment & { target: "zone_weight_intent"; previousValue: ZoneWeightIntent; newValue: ZoneWeightIntent })
  | (BaseZoneAdjustment & {
      target: "zone_elevation_override";
      previousValue: TechnicalCutElevation | null;
      newValue: TechnicalCutElevation | null;
    })
  | (BaseZoneAdjustment & {
      target: "zone_distribution_override";
      previousValue: TechnicalCutDistribution | null;
      newValue: TechnicalCutDistribution | null;
    })
  | (BaseZoneAdjustment & { target: "zone_texturizing_applicable"; previousValue: boolean | null; newValue: boolean | null })
  | (BaseZoneAdjustment & { target: "zone_density_sensitive"; previousValue: boolean; newValue: boolean })
  | (BaseZoneAdjustment & { target: "zone_preserve"; previousValue: boolean; newValue: boolean })
  | { target: "zone_relationship_add"; relationship: ZoneRelationshipEntry; source: "professional"; reason?: string }
  | { target: "map_preserve_constraint_add"; constraint: PreserveConstraintEntry; source: "professional"; reason?: string };

export function isMapAdjustmentEntry(value: unknown): value is MapAdjustmentEntry {
  if (!isRecord(value)) return false;
  if (value.source !== "professional") return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;

  switch (value.target) {
    case "zone_length_intent":
      return isHeadZone(value.zone) && isZoneLengthIntent(value.previousValue) && isZoneLengthIntent(value.newValue);
    case "zone_weight_intent":
      return isHeadZone(value.zone) && isZoneWeightIntent(value.previousValue) && isZoneWeightIntent(value.newValue);
    case "zone_elevation_override":
      return (
        isHeadZone(value.zone) &&
        (value.previousValue === null || isTechnicalCutElevation(value.previousValue)) &&
        (value.newValue === null || isTechnicalCutElevation(value.newValue))
      );
    case "zone_distribution_override":
      return (
        isHeadZone(value.zone) &&
        (value.previousValue === null || isTechnicalCutDistribution(value.previousValue)) &&
        (value.newValue === null || isTechnicalCutDistribution(value.newValue))
      );
    case "zone_texturizing_applicable":
      return (
        isHeadZone(value.zone) &&
        (value.previousValue === null || typeof value.previousValue === "boolean") &&
        (value.newValue === null || typeof value.newValue === "boolean")
      );
    case "zone_density_sensitive":
    case "zone_preserve":
      return isHeadZone(value.zone) && typeof value.previousValue === "boolean" && typeof value.newValue === "boolean";
    case "zone_relationship_add":
      return isZoneRelationshipEntry(value.relationship);
    case "map_preserve_constraint_add":
      return isPreserveConstraintEntry(value.constraint);
    default:
      return false;
  }
}

export function isMapAdjustmentArray(value: unknown): value is MapAdjustmentEntry[] {
  return Array.isArray(value) && value.every(isMapAdjustmentEntry);
}

// ---------------------------------------------------------------------------
// Effective map resolver -- pure, deterministic: baseline payload + ordered
// valid adjustments = effective semantic map. Never mutates its inputs.
// Adjustments are applied strictly in array order (append-only, so this is
// also chronological order) -- the LAST adjustment touching a given
// zone+field wins, exactly like computeEffectiveCuttingFields's own
// last-matching-edit-wins rule for AnalysisProposal.
// ---------------------------------------------------------------------------

export function resolveEffectiveTechnicalVisualMap(
  baseline: TechnicalVisualMapPayload,
  adjustments: MapAdjustmentEntry[],
): TechnicalVisualMapPayload {
  const zones: ZoneIntentEntry[] = baseline.zones.map((zone) => ({ ...zone }));
  let relationships = [...baseline.relationships];
  let preserveConstraints = [...baseline.preserveConstraints];

  function zoneEntry(zone: HeadZone): ZoneIntentEntry {
    const entry = zones.find((z) => z.zone === zone);
    if (!entry) throw new Error(`resolveEffectiveTechnicalVisualMap: unknown zone "${zone}" in baseline`);
    return entry;
  }

  for (const adjustment of adjustments) {
    switch (adjustment.target) {
      case "zone_length_intent": {
        const entry = zoneEntry(adjustment.zone);
        entry.lengthIntent = adjustment.newValue;
        entry.lengthIntentSource = "professional_adjustment";
        break;
      }
      case "zone_weight_intent": {
        const entry = zoneEntry(adjustment.zone);
        entry.weightIntent = adjustment.newValue;
        entry.weightIntentSource = "professional_adjustment";
        break;
      }
      case "zone_elevation_override": {
        const entry = zoneEntry(adjustment.zone);
        if (adjustment.newValue === null) {
          delete entry.elevationOverride;
          delete entry.elevationOverrideSource;
        } else {
          entry.elevationOverride = adjustment.newValue;
          entry.elevationOverrideSource = "professional_adjustment";
        }
        break;
      }
      case "zone_distribution_override": {
        const entry = zoneEntry(adjustment.zone);
        if (adjustment.newValue === null) {
          delete entry.distributionOverride;
          delete entry.distributionOverrideSource;
        } else {
          entry.distributionOverride = adjustment.newValue;
          entry.distributionOverrideSource = "professional_adjustment";
        }
        break;
      }
      case "zone_texturizing_applicable": {
        const entry = zoneEntry(adjustment.zone);
        if (adjustment.newValue === null) {
          delete entry.texturizingApplicable;
          delete entry.texturizingApplicableSource;
        } else {
          entry.texturizingApplicable = adjustment.newValue;
          entry.texturizingApplicableSource = "professional_adjustment";
        }
        break;
      }
      case "zone_density_sensitive": {
        const entry = zoneEntry(adjustment.zone);
        entry.densitySensitive = adjustment.newValue;
        entry.densitySensitiveSource = "professional_adjustment";
        break;
      }
      case "zone_preserve": {
        const entry = zoneEntry(adjustment.zone);
        entry.preserve = adjustment.newValue;
        entry.preserveSource = "professional_adjustment";
        break;
      }
      case "zone_relationship_add": {
        relationships = [...relationships, adjustment.relationship];
        break;
      }
      case "map_preserve_constraint_add": {
        preserveConstraints = [...preserveConstraints, adjustment.constraint];
        break;
      }
    }
  }

  return { globalIntent: baseline.globalIntent, zones, relationships, preserveConstraints };
}

// ---------------------------------------------------------------------------
// Low-level guards (mirrors proposal-validators.ts's own private helpers)
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
