import { HEAD_ZONES, type HeadZone, type ZoneValueSource } from "@/lib/technical-visual-map-validators";
import {
  buildUnassessedGlobalEntry,
  buildUnassessedZoneEntry,
  isHairStateConditionValue,
  isHairStateDensityValue,
  isHairStateFiberThicknessValue,
  isHairStateLengthValue,
  isHairStateTextureValue,
  type HairStateFact,
  type HairStateSnapshotPayload,
  type HairStateValueSource,
  type HairZoneStateEntry,
} from "@/lib/hair-state-snapshot-validators";
import type { TechnicalVisualMapPayload } from "@/lib/technical-visual-map-validators";

// Professional Skill Engine, Stage 2 -- HAIR STATE SNAPSHOT deterministic
// assemblers. Pure functions, no I/O, no database, no AI -- mirrors
// technical-visual-map-assembler.ts's own exact discipline: this is the
// ONLY place a snapshot's frozen `payload` is ever computed from a live
// source, and it computes NOTHING beyond a direct, honest copy of already-
// real, already-structured facts.
//
// assembleCurrentHairStateFromAnalysis: copies Analysis's own global
// (head-level, never per-zone) observed facts into a HairStateSnapshotPayload's
// `globalState`. Every one of the six zones is emitted with an honest
// "unspecified"/"not_yet_assessed" baseline -- Analysis carries no
// per-zone data whatsoever, and this function never invents any (task's
// own explicit "do not overclaim precision" boundary).
//
// assembleTargetHairStateFromTechnicalVisualMap: copies a CONFIRMED
// TechnicalVisualMap's own per-zone lengthIntent/weightIntent direction
// facts verbatim -- this is the ONE place those two fields are ever
// populated with a real, non-"unspecified" value for a TARGET-role
// snapshot, and they are FROZEN-COPIED, never re-derived, so a TARGET
// snapshot's own length/weight direction is never a second, competing
// truth from TechnicalVisualMap's own authority. Every OTHER fact
// (relativeLength/fiberThickness/density/texture/condition/
// perimeterRelationship) stays at its honest "unspecified" baseline --
// TechnicalVisualMap carries no descriptive facts to copy.

export const HAIR_STATE_SNAPSHOT_ASSEMBLER_VERSION = "1.0.0-hss2";

// ---------------------------------------------------------------------------
// assembleCurrentHairStateFromAnalysis
// ---------------------------------------------------------------------------

export interface HairStateAnalysisAssemblerInput {
  hairType: string; // HairType, but Analysis.hairType is a plain, already-validated-elsewhere string column
  density: string; // HairDensity/DensityLevel
  hairLength: string | null;
  hairTexture: string | null;
  hairCondition: string | null;
}

export function assembleCurrentHairStateFromAnalysis(input: HairStateAnalysisAssemblerInput): HairStateSnapshotPayload {
  const globalState = buildUnassessedGlobalEntry();

  if (isHairStateFiberThicknessValue(input.hairType)) {
    globalState.fiberThickness = observedFact(input.hairType);
  }
  if (isHairStateDensityValue(input.density)) {
    globalState.density = observedFact(input.density);
  }
  if (input.hairLength !== null && isHairStateLengthValue(input.hairLength)) {
    globalState.relativeLength = observedFact(input.hairLength);
  }
  if (input.hairTexture !== null && isHairStateTextureValue(input.hairTexture)) {
    globalState.texture = observedFact(input.hairTexture);
  }
  if (input.hairCondition !== null && isHairStateConditionValue(input.hairCondition)) {
    globalState.condition = observedFact(input.hairCondition);
  }

  // Per-zone: honestly unassessed everywhere -- Analysis has no per-zone
  // observation of any kind. Never smeared from the global facts above
  // (mirrors TechnicalVisualMapGlobalIntent's own "never smeared across
  // all 6 zones" rule exactly).
  const zones: HairZoneStateEntry[] = HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone));

  return { globalState, zones };
}

function observedFact<TValue extends string>(value: TValue): HairStateFact<TValue> {
  return { value, source: "observed" };
}

// ---------------------------------------------------------------------------
// assembleTargetHairStateFromTechnicalVisualMap
// ---------------------------------------------------------------------------

export function assembleTargetHairStateFromTechnicalVisualMap(technicalVisualMapPayload: TechnicalVisualMapPayload): HairStateSnapshotPayload {
  const globalState = buildUnassessedGlobalEntry();

  const zonesByZone = new Map(technicalVisualMapPayload.zones.map((entry) => [entry.zone, entry]));
  const zones: HairZoneStateEntry[] = HEAD_ZONES.map((zone: HeadZone) => {
    const base = buildUnassessedZoneEntry(zone);
    const tvmZone = zonesByZone.get(zone);
    if (!tvmZone) return base; // structurally impossible for a valid TVM payload; defensive only.
    return {
      ...base,
      // Frozen-copied verbatim -- the VALUE never changes. The SOURCE is
      // faithfully translated from TechnicalVisualMap's own ZoneValueSource
      // (never blindly claimed as "professional_input"): a zone that was
      // itself only ever "global_default" (the honest, real, current
      // behavior for every real proposal -- see the Stage 2.5 audit) must
      // not be reported here as though a professional had actually stated
      // it.
      lengthIntent: { value: tvmZone.lengthIntent, source: translateZoneValueSource(tvmZone.lengthIntentSource) },
      weightIntent: { value: tvmZone.weightIntent, source: translateZoneValueSource(tvmZone.weightIntentSource) },
    };
  });

  return { globalState, zones };
}

// Faithful, honest translation between TechnicalVisualMap's own
// authorship-provenance vocabulary and HairStateSnapshot's own
// observation-confidence vocabulary -- the two are DIFFERENT epistemic
// axes (see hair-state-snapshot-validators.ts's own header comment), so
// this is a deliberate, explicit mapping, never an assumed equivalence.
function translateZoneValueSource(source: ZoneValueSource): HairStateValueSource {
  switch (source) {
    case "global_default":
      return "not_yet_assessed";
    case "deterministic_evidence":
      return "inferred";
    case "professional_adjustment":
      return "professional_input";
  }
}
