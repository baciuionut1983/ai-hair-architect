import type { TechnicalCutDistribution, TechnicalCutElevation } from "@/lib/contracts";
import type { TechnicalVisualMapRecord } from "@/lib/technical-visual-map-repository";
import {
  HEAD_ZONES,
  resolveEffectiveTechnicalVisualMap,
  type HeadZone,
  type MapAdjustmentEntry,
  type PreserveConstraintType,
  type TechnicalVisualMapPayload,
  type ZoneIntentEntry,
  type ZoneLengthIntent,
  type ZoneRelationshipEntry,
  type ZoneRelationshipType,
  type ZoneValueSource,
  type ZoneWeightIntent,
} from "@/lib/technical-visual-map-validators";

// Technical Visual Map, Stage 4 -- pure logic for the professional UI. No
// React, no fetch -- mirrors proposed-look-logic.ts's own plain-function
// style exactly (plain exported functions/types, unit-testable with zero
// rendering environment).

export type TechnicalVisualMapLoadStatus = "ready" | "error";

export function resolveTechnicalVisualMapLoadStatus(response: { ok: boolean; status: number }): TechnicalVisualMapLoadStatus {
  return response.ok ? "ready" : "error";
}

// history has at most one DRAFT at a time per the locked lifecycle, but this
// does not assume/enforce that -- it just returns the first match honestly.
export function findExistingDraftMap(history: TechnicalVisualMapRecord[]): TechnicalVisualMapRecord | null {
  return history.find((map) => map.status === "DRAFT") ?? null;
}

// The exact same effective-map computation the Stage 3 API already performs
// server-side (resolveEffectiveMapForRecord in technical-visual-map-repository.ts),
// re-derived here ONLY because the Stage 3 list/history endpoint intentionally
// returns bare records without a precomputed effectiveMap (see
// technical-visual-maps/route.ts's GET handler) -- reusing the SAME exported
// pure resolver (resolveEffectiveTechnicalVisualMap), never a second
// reimplementation of the merge rule.
//
// This is the ONE client-side call site that must never be swapped back to
// `record.payload` alone: Proposed Look's own CurrentApprovedLook
// (buildEffectivePlan) already caught exactly this bug category once --
// silently showing the pre-adjustment baseline as if it were the current
// state. See the paired test proving this returns the ADJUSTED value, not
// the frozen baseline.
export function resolveHistoryRowEffectiveMap(record: TechnicalVisualMapRecord): TechnicalVisualMapPayload {
  return resolveEffectiveTechnicalVisualMap(record.payload, record.professionalAdjustments);
}

// Short, safe, professional-facing messages -- never a raw internal error.
export function mapTechnicalVisualMapApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This technical visual map is no longer available.";
  if (status === 409 && code === "TECHNICAL_VISUAL_MAP_CONFIRMATION_CONFLICT") {
    return "Another map was confirmed for this proposal while this draft was open. Review the current confirmed map, then try again if you still want to replace it.";
  }
  if (status === 409 && code === "TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION") {
    return "This map is no longer a draft, so it can't be changed.";
  }
  if (status === 400 || status === 422) {
    return "This request could not be completed with the current data. Please review and try again.";
  }
  if (status === 503) return "The technical visual map service is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Display labels -- hand-written, professional-facing wording for the Stage 2
// closed vocabularies. No invented values: every key here is exactly one of
// the locked enum members from technical-visual-map-validators.ts.
// ---------------------------------------------------------------------------

export const HEAD_ZONE_LABELS: Record<HeadZone, string> = {
  crown: "Crown",
  occipital: "Occipital",
  nape: "Nape",
  top: "Top",
  sides: "Sides",
  fringe: "Fringe",
};

export const ZONE_LENGTH_INTENT_LABELS: Record<ZoneLengthIntent, string> = {
  unspecified: "Not specified",
  preserve: "Preserve length",
  maintain: "Maintain length",
  shorten: "Shorten",
};

export const ZONE_WEIGHT_INTENT_LABELS: Record<ZoneWeightIntent, string> = {
  unspecified: "Not specified",
  preserve: "Preserve weight",
  reduce: "Reduce weight",
  build: "Build weight",
};

export const ZONE_RELATIONSHIP_TYPE_LABELS: Record<ZoneRelationshipType, string> = {
  shorter_than: "shorter than",
  longer_than: "longer than",
  same_length_as: "same length as",
  blends_into: "blends into",
};

export const PRESERVE_CONSTRAINT_TYPE_LABELS: Record<PreserveConstraintType, string> = {
  preserve_identity: "Preserve identity",
  preserve_face_proportions: "Preserve face proportions",
  preserve_hairline: "Preserve hairline",
  preserve_density_sensitive_area: "Preserve density-sensitive area",
  preserve_perimeter_weight: "Preserve perimeter weight",
  respect_contraindication: "Respect contraindication",
  do_not_modify_unrelated_appearance: "Do not modify unrelated appearance",
};

// Preserve constraint types that are documented (technical-visual-map-assembler.ts,
// technical-visual-map-validators.ts) as downstream Photo/Video generation
// invariants, not something this map's own generation currently produces or
// edits -- shown with a distinct, honest "not part of this map yet" note
// rather than presented as if they were an active constraint on this map.
export const DOWNSTREAM_ONLY_PRESERVE_CONSTRAINT_TYPES: ReadonlySet<PreserveConstraintType> = new Set([
  "preserve_identity",
  "preserve_face_proportions",
  "do_not_modify_unrelated_appearance",
]);

// A source badge is only worth showing when it tells the professional
// something -- "global_default" is definitionally "no claim was ever made",
// so annotating it would be noise next to an already-honest "Not specified"
// value. Only a genuinely informative source (evidence-derived or
// professional-adjusted) gets a badge.
export function zoneFieldSourceBadgeLabel(source: ZoneValueSource): string | null {
  if (source === "global_default") return null;
  if (source === "deterministic_evidence") return "From evidence";
  return "Adjusted";
}

// ---------------------------------------------------------------------------
// Zone edit form values + the pure builder that turns them back into
// MapAdjustmentEntry objects, mirroring proposed-look-edit-form-logic.ts's
// buildProposalEditEntries exactly: compare against the CURRENT EFFECTIVE
// value, emit an entry only for genuinely changed fields, `[]` means nothing
// to save.
// ---------------------------------------------------------------------------

export interface ZoneFormValues {
  lengthIntent: ZoneLengthIntent;
  weightIntent: ZoneWeightIntent;
  elevationOverride: TechnicalCutElevation | "";
  distributionOverride: TechnicalCutDistribution | "";
  texturizingApplicable: "unspecified" | "yes" | "no";
  densitySensitive: boolean;
  preserve: boolean;
}

export function seedZoneFormValues(entry: ZoneIntentEntry): ZoneFormValues {
  return {
    lengthIntent: entry.lengthIntent,
    weightIntent: entry.weightIntent,
    elevationOverride: entry.elevationOverride ?? "",
    distributionOverride: entry.distributionOverride ?? "",
    texturizingApplicable:
      entry.texturizingApplicable === undefined ? "unspecified" : entry.texturizingApplicable ? "yes" : "no",
    densitySensitive: entry.densitySensitive,
    preserve: entry.preserve,
  };
}

// Never mutates `current`, never invents a field the effective zone entry
// doesn't already carry. Only the map-level adjustment targets Stage 2
// actually implements for a single zone are ever produced here.
export function buildZoneAdjustmentEntries(
  zone: HeadZone,
  current: ZoneIntentEntry,
  form: ZoneFormValues,
): MapAdjustmentEntry[] {
  const entries: MapAdjustmentEntry[] = [];
  const source = "professional" as const;

  if (form.lengthIntent !== current.lengthIntent) {
    entries.push({ target: "zone_length_intent", zone, previousValue: current.lengthIntent, newValue: form.lengthIntent, source });
  }
  if (form.weightIntent !== current.weightIntent) {
    entries.push({ target: "zone_weight_intent", zone, previousValue: current.weightIntent, newValue: form.weightIntent, source });
  }

  const currentElevation = current.elevationOverride ?? "";
  if (form.elevationOverride !== currentElevation) {
    entries.push({
      target: "zone_elevation_override",
      zone,
      previousValue: current.elevationOverride ?? null,
      newValue: form.elevationOverride === "" ? null : form.elevationOverride,
      source,
    });
  }

  const currentDistribution = current.distributionOverride ?? "";
  if (form.distributionOverride !== currentDistribution) {
    entries.push({
      target: "zone_distribution_override",
      zone,
      previousValue: current.distributionOverride ?? null,
      newValue: form.distributionOverride === "" ? null : form.distributionOverride,
      source,
    });
  }

  const currentTexturizing =
    current.texturizingApplicable === undefined ? "unspecified" : current.texturizingApplicable ? "yes" : "no";
  if (form.texturizingApplicable !== currentTexturizing) {
    entries.push({
      target: "zone_texturizing_applicable",
      zone,
      previousValue: current.texturizingApplicable ?? null,
      newValue: form.texturizingApplicable === "unspecified" ? null : form.texturizingApplicable === "yes",
      source,
    });
  }

  if (form.densitySensitive !== current.densitySensitive) {
    entries.push({
      target: "zone_density_sensitive",
      zone,
      previousValue: current.densitySensitive,
      newValue: form.densitySensitive,
      source,
    });
  }

  if (form.preserve !== current.preserve) {
    entries.push({ target: "zone_preserve", zone, previousValue: current.preserve, newValue: form.preserve, source });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Zone relationships -- a small UX affordance layered on top of Stage 2's own
// authoritative validation (which still applies server-side regardless of
// what this UI allows the professional to attempt). Prevents same-zone and
// already-related pairs from ever being offered as a choice.
// ---------------------------------------------------------------------------

export function unorderedPairKey(a: HeadZone, b: HeadZone): string {
  return [a, b].sort().join("|");
}

export function zonePairAlreadyRelated(relationships: ZoneRelationshipEntry[], a: HeadZone, b: HeadZone): boolean {
  const key = unorderedPairKey(a, b);
  return relationships.some((relationship) => unorderedPairKey(relationship.sourceZone, relationship.targetZone) === key);
}

// Every zone except the source itself, and never a zone already paired with
// the source in an existing relationship (in either direction).
export function availableTargetZones(relationships: ZoneRelationshipEntry[], sourceZone: HeadZone): HeadZone[] {
  return HEAD_ZONES.filter((zone) => zone !== sourceZone && !zonePairAlreadyRelated(relationships, sourceZone, zone));
}

export function formatRelationship(entry: ZoneRelationshipEntry): string {
  return `${HEAD_ZONE_LABELS[entry.sourceZone]} — ${ZONE_RELATIONSHIP_TYPE_LABELS[entry.relationship]} — ${HEAD_ZONE_LABELS[entry.targetZone]}`;
}
