import {
  HAIR_STATE_COLOR_LEVEL_VALUES,
  type HairStateColorEntry,
  type HairStateFact,
} from "@/lib/hair-state-snapshot-validators";
import type { HairStateDeltaEntry, HairStateDeltaFactSide, HairStateDeltaTransformation, HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";

// AI Hair Architect, Professional Skill Engine, B1 (Professional Brain
// CUT+COLOR slice) -- COLOR STATE DELTA. Pure, deterministic, no I/O, no
// AI. The color-vertical sibling of hair-state-delta.ts's own
// computeHairStateDelta -- deliberately a SEPARATE function in a SEPARATE
// file, never a new case folded into hair-state-delta.ts's own CUT-scoped
// field lists (GLOBAL_FACT_FIELDS/ZONE_FACT_FIELDS): that file's own
// header already documents it as the single place CUT's own field set is
// diffed, and growing it with color fields would be exactly the kind of
// ever-larger, hardcoded-per-domain logic this stage's own task instructs
// against.
//
// Reuses the EXACT SAME HairStateDeltaEntry/HairStateDeltaTransformation
// shape hair-state-delta.ts already exports -- never a second, competing
// delta shape. A caller merges this function's own output entries with
// hair-state-delta.ts's own computeHairStateDelta(...).entries to obtain
// one combined delta (see professional-brain-orchestrator.ts's own
// multi-domain functions) -- this file never performs that merge itself,
// staying a pure, single-domain computation exactly like its CUT sibling.
//
// SCOPE: global only (HairStateSnapshotPayload.colorState is global-only
// for this slice -- see that field's own header). Two fields only:
// "colorLevel" (ordinal -- the industry level scale has a real, defensible
// order) and "colorTone" (no defensible order -- a real difference is
// CHANGED, never a fabricated lighter/darker direction, mirroring
// hair-state-delta.ts's own UNORDERED_DESCRIPTIVE_FIELDS discipline for
// texture/condition/fiberThickness).
//
// SAFETY: this function NEVER asserts that a base can be opened, that a
// target level is reachable, or that any formula is safe -- it only
// classifies whether current/target values differ and in which ordinal
// direction, using ONLY the already-structured level/tone facts. Whether a
// given transformation is professionally safe is exclusively a
// professional judgment made downstream (Stage 5/6), never decided here.

const COLOR_LEVEL_ORDER: ReadonlyMap<string, number> = new Map(HAIR_STATE_COLOR_LEVEL_VALUES.filter((v) => v !== "unspecified").map((v, i) => [v, i]));

function isKnown(fact: HairStateDeltaFactSide): boolean {
  return fact.value !== "unspecified" && fact.source !== "not_yet_assessed";
}

function toSide<TValue extends string>(fact: HairStateFact<TValue>): HairStateDeltaFactSide {
  return { value: fact.value, source: fact.source };
}

function classifyColorLevel(current: HairStateDeltaFactSide, target: HairStateDeltaFactSide): HairStateDeltaTransformation {
  const currentKnown = isKnown(current);
  const targetKnown = isKnown(target);
  if (!targetKnown) return "UNKNOWN";
  if (!currentKnown) return "ADDED";
  if (current.value === target.value) return "PRESERVED";
  const fromOrdinal = COLOR_LEVEL_ORDER.get(current.value);
  const toOrdinal = COLOR_LEVEL_ORDER.get(target.value);
  if (fromOrdinal === undefined || toOrdinal === undefined) return "CHANGED";
  return toOrdinal > fromOrdinal ? "INCREASED" : "REDUCED";
}

function classifyColorTone(current: HairStateDeltaFactSide, target: HairStateDeltaFactSide): HairStateDeltaTransformation {
  const currentKnown = isKnown(current);
  const targetKnown = isKnown(target);
  if (!targetKnown) return "UNKNOWN";
  if (!currentKnown) return "ADDED";
  return current.value === target.value ? "PRESERVED" : "CHANGED";
}

const UNASSESSED_COLOR_FACT: HairStateFact<"unspecified"> = { value: "unspecified", source: "not_yet_assessed" };

// Absent colorState (a pre-B1 payload, or a payload that simply never set
// it) is treated identically to an explicitly-unassessed color entry --
// never an error, never silently promoted to a real fact.
function resolveColorEntry(colorState: HairStateColorEntry | undefined): HairStateColorEntry {
  return colorState ?? { level: UNASSESSED_COLOR_FACT, tone: UNASSESSED_COLOR_FACT };
}

// Deliberately NOT named computeHairStateDelta-equivalent's own return
// shape (HairStateDelta, which stamps its own snapshot provenance) --
// returns bare entries only. The caller (orchestrator) stamps ONE shared
// provenance across the merged cut+color entries, never two independently
// stamped deltas pretending to be one.
export function computeColorStateDelta(current: HairStateSnapshotDeltaInput, target: HairStateSnapshotDeltaInput): readonly HairStateDeltaEntry[] {
  const currentColor = resolveColorEntry(current.payload.colorState);
  const targetColor = resolveColorEntry(target.payload.colorState);

  const currentLevel = toSide(currentColor.level);
  const targetLevel = toSide(targetColor.level);
  const currentTone = toSide(currentColor.tone);
  const targetTone = toSide(targetColor.tone);

  return [
    { scope: "global", field: "colorLevel", transformation: classifyColorLevel(currentLevel, targetLevel), current: currentLevel, target: targetLevel },
    { scope: "global", field: "colorTone", transformation: classifyColorTone(currentTone, targetTone), current: currentTone, target: targetTone },
  ];
}
