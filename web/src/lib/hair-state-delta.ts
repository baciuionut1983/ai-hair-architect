import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import {
  HAIR_STATE_DENSITY_VALUES,
  HAIR_STATE_LENGTH_VALUES,
  HAIR_STATE_PERIMETER_RELATIONSHIPS,
  type HairStateFact,
  type HairStateGlobalEntry,
  type HairStateSnapshotPayload,
  type HairStateValueSource,
  type HairZoneStateEntry,
} from "@/lib/hair-state-snapshot-validators";

// AI Hair Architect, Professional Skill Engine Stage 4 -- HAIR STATE DELTA.
// Pure, deterministic, no I/O, no AI. Answers exactly one question: "what
// changed between a CURRENT HairStateSnapshot and a TARGET one, expressed
// as a small closed set of transformation categories, never a numeric
// measurement." Built ON TOP OF hair-state-snapshot-validators.ts's own
// existing `diffHairStateSnapshots` -- that function proves two payloads
// CAN be compared mechanically (raw value inequality, per field); this
// file adds the ONE layer diffHairStateSnapshots deliberately does not
// attempt: classifying WHAT KIND of change each field's inequality
// represents, using ONLY the real, already-shipped vocabularies those
// fields already carry -- never a second, competing diff mechanism.
//
// SIX TRANSFORMATION CATEGORIES (task's own A-F list), never more:
//   PRESERVED -- current and target agree, both known.
//   CHANGED   -- current and target differ, both known, but the field's
//     own vocabulary has no defensible ordering (e.g. hair texture:
//     straight vs wavy is a difference, not a "more/less").
//   ADDED     -- target states a real value; current has none to compare
//     against (current is "unspecified"/"not_yet_assessed"). This is the
//     REAL, common case for lengthIntent/weightIntent today: Stage 2's own
//     assembler never populates these on a CURRENT snapshot (see
//     assembleCurrentHairStateFromAnalysis's own header comment) -- a
//     TARGET's own stated intent is therefore almost always a newly
//     required baseline, not a comparison against a prior stated one.
//   REDUCED / INCREASED -- current and target differ, both known, and the
//     field's own vocabulary has a real, defensible order (length/density/
//     perimeter-relationship scales) -- the ordinal position moved down or
//     up.
//   UNKNOWN -- the target has NOT stated a real value for this field
//     (still "unspecified"/"not_yet_assessed"). Per this stage's own
//     explicit instruction, silence is NEVER read as "preserve" -- this
//     vocabulary already has a real, distinct "preserve"/"maintain" value
//     a professional would use to SAY that; leaving a field unspecified
//     means "not yet part of this plan", not "keep it as is". Also covers
//     the case where neither side has a real value at all.
//
// TWO DIFFERENT COMPARISON RULES, both reusing only real, existing
// vocabulary, never invented:
//   1. DESCRIPTIVE facts (relativeLength, fiberThickness, density,
//      texture, condition, perimeterRelationship) -- genuine two-sided
//      CURRENT-vs-TARGET comparison, using each field's own real
//      HairState*Values array (or HAIR_STATE_PERIMETER_RELATIONSHIPS) as
//      its ordinal scale where the scale is real and defensible
//      (relativeLength, density, perimeterRelationship); texture/
//      condition/fiberThickness have no defensible reduce/increase
//      ordering for a cutting-scoped delta, so a real difference there is
//      CHANGED, never a fabricated direction.
//   2. INTENT facts (lengthIntent, weightIntent) -- these ALREADY ARE a
//      directional vocabulary (ZoneLengthIntent: preserve/maintain/
//      shorten; ZoneWeightIntent: preserve/reduce/build), imported
//      verbatim from technical-visual-map-validators.ts, never
//      re-declared. Because CURRENT structurally never carries a real
//      intent value (see above), classifying these via ordinal CURRENT-
//      vs-TARGET comparison would ALWAYS collapse to ADDED-or-UNKNOWN and
//      throw away the one piece of real semantic information these two
//      fields actually carry: the TARGET's own stated direction. So for
//      these two fields ONLY, the transformation is read directly from
//      the TARGET's own value (shorten -> REDUCED, preserve/maintain ->
//      PRESERVED, unspecified -> UNKNOWN; reduce -> REDUCED, build ->
//      INCREASED, preserve -> PRESERVED, unspecified -> UNKNOWN) --
//      CURRENT's own intent value (if a manually-authored snapshot ever
//      sets one) is still carried in the delta entry's own `current`
//      field for transparency/audit, just never used to derive the
//      transformation category.
//
// NO SECOND ZONE AUTHORITY: `scope` is exactly HEAD_ZONES ("global" for
// the head-level entry) -- imported, never re-declared, never subdivided.
//
// PROVENANCE: computeHairStateDelta takes the exact (id, snapshotVersion,
// payload) of both source snapshots and stamps them into its own output --
// see the file's own HairStateDelta interface. This function is a PURE,
// DETERMINISTIC computation, deliberately NOT persisted (no new Prisma
// model, no migration): the smallest architecture consistent with the
// repository, since HairStateSnapshot rows are already immutable and
// versioned -- recomputing against the SAME two (id, version) pairs always
// produces the byte-identical result, and the output's own stamped
// provenance makes clear exactly which two immutable snapshots produced
// it, so a caller can never mistake a fresh recomputation (e.g. against a
// newer TARGET revision) for the historical delta of an older one.

export const HAIR_STATE_DELTA_TRANSFORMATIONS = ["PRESERVED", "CHANGED", "ADDED", "REDUCED", "INCREASED", "UNKNOWN"] as const;
export type HairStateDeltaTransformation = (typeof HAIR_STATE_DELTA_TRANSFORMATIONS)[number];

export function isHairStateDeltaTransformation(value: unknown): value is HairStateDeltaTransformation {
  return typeof value === "string" && (HAIR_STATE_DELTA_TRANSFORMATIONS as readonly string[]).includes(value);
}

export interface HairStateDeltaFactSide {
  value: string;
  source: HairStateValueSource;
}

export interface HairStateDeltaEntry {
  scope: "global" | (typeof HEAD_ZONES)[number];
  field: string;
  transformation: HairStateDeltaTransformation;
  current: HairStateDeltaFactSide;
  target: HairStateDeltaFactSide;
}

export interface HairStateDelta {
  sourceCurrentSnapshotId: string;
  sourceCurrentSnapshotVersion: number;
  sourceTargetSnapshotId: string;
  sourceTargetSnapshotVersion: number;
  computedAt: string;
  entries: readonly HairStateDeltaEntry[];
}

export interface HairStateSnapshotDeltaInput {
  id: string;
  snapshotVersion: number;
  payload: HairStateSnapshotPayload;
}

// ---------------------------------------------------------------------------
// Ordinal scales -- ONLY for vocabularies with a real, defensible order.
// Derived from the exact, real, already-shipped option arrays; never a
// hand-retyped duplicate ranking.
// ---------------------------------------------------------------------------

const RELATIVE_LENGTH_ORDER = new Map(HAIR_STATE_LENGTH_VALUES.filter((v) => v !== "unspecified").map((v, i) => [v, i]));
const DENSITY_ORDER = new Map(HAIR_STATE_DENSITY_VALUES.filter((v) => v !== "unspecified").map((v, i) => [v, i]));
const PERIMETER_RELATIONSHIP_ORDER = new Map(
  HAIR_STATE_PERIMETER_RELATIONSHIPS.filter((v) => v !== "unspecified").map((v, i) => [v, i]),
);

const ORDINAL_SCALES: Partial<Record<string, ReadonlyMap<string, number>>> = {
  relativeLength: RELATIVE_LENGTH_ORDER,
  density: DENSITY_ORDER,
  perimeterRelationship: PERIMETER_RELATIONSHIP_ORDER,
};

// Fields whose fact.value carries genuine meaning even when it differs but
// has no ordinal scale -- a real difference here is CHANGED, never a
// fabricated direction.
const UNORDERED_DESCRIPTIVE_FIELDS = new Set(["fiberThickness", "texture", "condition"]);

function isKnown(fact: HairStateDeltaFactSide): boolean {
  return fact.value !== "unspecified" && fact.source !== "not_yet_assessed";
}

function classifyDescriptiveField(field: string, current: HairStateDeltaFactSide, target: HairStateDeltaFactSide): HairStateDeltaTransformation {
  const currentKnown = isKnown(current);
  const targetKnown = isKnown(target);

  if (!targetKnown) return "UNKNOWN";
  if (!currentKnown) return "ADDED";
  if (current.value === target.value) return "PRESERVED";

  const scale = ORDINAL_SCALES[field];
  if (scale) {
    const fromOrdinal = scale.get(current.value);
    const toOrdinal = scale.get(target.value);
    if (fromOrdinal !== undefined && toOrdinal !== undefined) {
      return toOrdinal > fromOrdinal ? "INCREASED" : "REDUCED";
    }
  }
  if (UNORDERED_DESCRIPTIVE_FIELDS.has(field)) return "CHANGED";
  return "CHANGED";
}

// lengthIntent/weightIntent -- see file header for why these read the
// transformation directly from the TARGET's own directional value.
function classifyLengthIntent(target: HairStateDeltaFactSide): HairStateDeltaTransformation {
  switch (target.value) {
    case "shorten":
      return "REDUCED";
    case "preserve":
    case "maintain":
      return "PRESERVED";
    default:
      return "UNKNOWN";
  }
}

function classifyWeightIntent(target: HairStateDeltaFactSide): HairStateDeltaTransformation {
  switch (target.value) {
    case "reduce":
      return "REDUCED";
    case "build":
      return "INCREASED";
    case "preserve":
      return "PRESERVED";
    default:
      return "UNKNOWN";
  }
}

function toSide<TValue extends string>(fact: HairStateFact<TValue>): HairStateDeltaFactSide {
  return { value: fact.value, source: fact.source };
}

function globalFieldEntries(current: HairStateGlobalEntry, target: HairStateGlobalEntry): HairStateDeltaEntry[] {
  const fields: readonly (keyof HairStateGlobalEntry)[] = ["relativeLength", "fiberThickness", "density", "texture", "condition"];
  return fields.map((field) => {
    const currentSide = toSide(current[field]);
    const targetSide = toSide(target[field]);
    return { scope: "global" as const, field, transformation: classifyDescriptiveField(field, currentSide, targetSide), current: currentSide, target: targetSide };
  });
}

function zoneFieldEntries(zone: (typeof HEAD_ZONES)[number], current: HairZoneStateEntry, target: HairZoneStateEntry): HairStateDeltaEntry[] {
  const descriptiveFields: readonly (keyof HairZoneStateEntry)[] = ["relativeLength", "fiberThickness", "density", "texture", "condition", "perimeterRelationship"];
  const entries: HairStateDeltaEntry[] = descriptiveFields.map((field) => {
    const currentSide = toSide(current[field] as HairStateFact<string>);
    const targetSide = toSide(target[field] as HairStateFact<string>);
    return { scope: zone, field, transformation: classifyDescriptiveField(field, currentSide, targetSide), current: currentSide, target: targetSide };
  });

  const currentLengthIntent = toSide(current.lengthIntent);
  const targetLengthIntent = toSide(target.lengthIntent);
  entries.push({ scope: zone, field: "lengthIntent", transformation: classifyLengthIntent(targetLengthIntent), current: currentLengthIntent, target: targetLengthIntent });

  const currentWeightIntent = toSide(current.weightIntent);
  const targetWeightIntent = toSide(target.weightIntent);
  entries.push({ scope: zone, field: "weightIntent", transformation: classifyWeightIntent(targetWeightIntent), current: currentWeightIntent, target: targetWeightIntent });

  return entries;
}

export function computeHairStateDelta(current: HairStateSnapshotDeltaInput, target: HairStateSnapshotDeltaInput): HairStateDelta {
  const entries: HairStateDeltaEntry[] = [...globalFieldEntries(current.payload.globalState, target.payload.globalState)];

  const targetZonesByZone = new Map(target.payload.zones.map((entry) => [entry.zone, entry]));
  for (const zone of HEAD_ZONES) {
    const currentZoneEntry = current.payload.zones.find((z) => z.zone === zone);
    const targetZoneEntry = targetZonesByZone.get(zone);
    if (!currentZoneEntry || !targetZoneEntry) continue; // structurally impossible for two valid payloads; defensive only.
    entries.push(...zoneFieldEntries(zone, currentZoneEntry, targetZoneEntry));
  }

  return {
    sourceCurrentSnapshotId: current.id,
    sourceCurrentSnapshotVersion: current.snapshotVersion,
    sourceTargetSnapshotId: target.id,
    sourceTargetSnapshotVersion: target.snapshotVersion,
    computedAt: new Date().toISOString(),
    entries,
  };
}

// A general-purpose "what genuinely differs" view -- UNKNOWN (nothing
// stated on the target side) is excluded. PRESERVED is deliberately KEPT
// here: "preserve the perimeter"/"preserve length" are real, professionally
// active requirements, not "no change happened" -- see
// hair-state-delta-skill-candidate-selector.ts's own header for why its
// own candidate matching iterates ALL entries directly (gated on whether
// a capability mapping exists at all) rather than this helper, since a
// capability-less PRESERVED field (e.g. texture staying the same) still
// needs to be excluded from a *candidate-matching* view for a different
// reason (no capability vocabulary addresses it) than an UNKNOWN one
// (nothing was stated) -- two different filters for two different
// purposes, kept honestly separate rather than conflated into one.
export function actionableDeltaEntries(delta: HairStateDelta): readonly HairStateDeltaEntry[] {
  return delta.entries.filter((entry) => entry.transformation !== "UNKNOWN");
}
