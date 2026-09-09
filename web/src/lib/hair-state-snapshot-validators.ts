import type { HairCondition, HairDensity, HairLength, HairTexture, HairType } from "@/lib/contracts";
import { DENSITY_OPTIONS, HAIR_CONDITION_OPTIONS, HAIR_LENGTH_OPTIONS, HAIR_TEXTURE_OPTIONS, HAIR_TYPE_OPTIONS } from "@/lib/analysis-field-options";
import { HEAD_ZONES, isHeadZone, isZoneLengthIntent, isZoneWeightIntent, type HeadZone, type ZoneLengthIntent, type ZoneWeightIntent } from "@/lib/technical-visual-map-validators";

// AI Hair Architect, Professional Skill Engine Stage 2 -- HAIR STATE
// SNAPSHOT, contract/foundation layer. Types + pure validators + a pure
// structural diff helper. No I/O, no database, no AI, no semantic
// comparison -- mirrors technical-visual-map-validators.ts's own exact
// "Stage 1/2" convention (small exported allowlist arrays, `is*` type
// guards, `satisfies`/derived-from-existing-array reuse instead of
// hand-retyped literals).
//
// ARCHITECTURE DECISION LOCK (Stage 1, this engagement): HairStateSnapshot
// enters the authority chain AFTER Analysis/AnalysisProposal and attaches
// to -- never duplicates -- TechnicalVisualMap's own six-zone vocabulary.
// `HeadZone`/`isHeadZone` and the TARGET-relevant `ZoneLengthIntent`/
// `ZoneWeightIntent` vocabularies are imported directly from
// technical-visual-map-validators.ts, never re-declared here. This file
// adds ONLY what TechnicalVisualMap has no representation of at all: a
// per-zone CURRENT/observed descriptive state, and a small perimeter-
// relationship fact needed for "preserve perimeter length while shortening
// interior zones" style reasoning.
//
// SIX-ZONE VOCABULARY, AUDITED: sufficient for Stage 2's own scope (a
// zone-scoped descriptive state), but confirmed INSUFFICIENT for future
// left/right symmetry reasoning (HEAD_ZONES has "no left/right split" by
// its own locked design) or for finer-than-zone spatial precision. Neither
// gap is closed here -- HairZoneStateEntry is scoped generically by
// `HeadZone`, so if the zone vocabulary is ever refined (e.g. a future
// zone-subdivision), this file's own per-zone entry shape needs no change
// at all. Not performed in this stage because nothing in Stage 2's own
// scope requires it (task's own explicit instruction).
//
// HONEST UNCERTAINTY, BY CONSTRUCTION: every descriptive fact reuses an
// EXISTING categorical vocabulary (HairLength/HairType/HairDensity/
// HairTexture/HairCondition, from contracts.ts via analysis-field-options.ts's
// own real value lists) widened with a first-class "unspecified" value --
// never a numeric measurement (mirrors TechnicalVisualMap's own
// "deliberately NO centimeters/measurements anywhere -- no evidence in
// this domain ever supports one" rule exactly). Growth/implantation
// direction is DELIBERATELY EXCLUDED from this file: Analysis already
// carries a real, closed, GLOBAL `GrowthPattern` vocabulary, but nothing
// in this codebase observes it PER ZONE, and inventing a per-zone version
// nothing can ever populate would be exactly the overclaimed precision
// this stage's own task forbids. "Movement" is deliberately NOT a separate
// axis -- HairTexture (straight/wavy/curly/coily) already IS this
// industry's own natural-fall/movement-pattern vocabulary; a second,
// parallel "movement" field would duplicate it.
//
// SOURCE VS VALUE, KEPT SEPARATE (mirrors ZoneIntentEntry's own exact
// discipline): a fact's VALUE may itself be "unspecified" (the fact is
// simply not known); its SOURCE is a SEPARATE, always-populated field
// answering "how would we know this, if we did" -- "CONFIRMED" is
// deliberately NOT a source value here, because confirmation is the
// SNAPSHOT's own lifecycle status (see status below), not a per-fact
// provenance tag; conflating the two would let a snapshot claim a fact was
// "confirmed" independently of the snapshot itself ever being confirmed.

// ---------------------------------------------------------------------------
// Snapshot role -- CURRENT (before), TARGET, RESULT (after/observed).
// ---------------------------------------------------------------------------

export const HAIR_STATE_SNAPSHOT_ROLES = ["CURRENT", "TARGET", "RESULT"] as const;
export type HairStateSnapshotRole = (typeof HAIR_STATE_SNAPSHOT_ROLES)[number];

export function isHairStateSnapshotRole(value: unknown): value is HairStateSnapshotRole {
  return typeof value === "string" && (HAIR_STATE_SNAPSHOT_ROLES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Lifecycle -- mirrors TechnicalVisualMap's own DRAFT|CONFIRMED|SUPERSEDED
// exactly, for the identical reason: a snapshot is either still editable,
// locked-and-authoritative, or a superseded historical record. No REJECTED
// state -- same reasoning as TechnicalVisualMap: this is never an
// independently-evaluated option with its own accept/decline decision.
// ---------------------------------------------------------------------------

export const HAIR_STATE_SNAPSHOT_STATUSES = ["DRAFT", "CONFIRMED", "SUPERSEDED"] as const;
export type HairStateSnapshotStatus = (typeof HAIR_STATE_SNAPSHOT_STATUSES)[number];

export function isHairStateSnapshotStatus(value: unknown): value is HairStateSnapshotStatus {
  return typeof value === "string" && (HAIR_STATE_SNAPSHOT_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Value source -- per-fact provenance. "not_yet_assessed" is the honest
// baseline (mirrors ZoneValueSource's own "global_default": a real,
// first-class value, never a disguised guess). Deliberately excludes
// "confirmed" -- see file header.
//
// "reference_image" (Stage 3 addition): this fact's value was read from a
// TARGET reference/inspiration image's own visual content -- NOT the
// CURRENT observed photo (that's "observed"), NOT an AI text proposal
// (that's "ai_proposed"), NOT a professional's own stated instruction
// (that's "professional_input"). A "combination" TARGET (the task's own
// explicit fifth case) needs no separate tag: each fact already carries
// its own independent source, so a TARGET whose zones mix reference-image
// facts with professional-override facts already represents that
// combination honestly, one field at a time -- exactly as this per-fact
// model was designed to do (see the file header's own "independently
// declared, per-fact" reasoning).
// ---------------------------------------------------------------------------

export const HAIR_STATE_VALUE_SOURCES = ["not_yet_assessed", "observed", "inferred", "professional_input", "ai_proposed", "client_reported", "reference_image"] as const;
export type HairStateValueSource = (typeof HAIR_STATE_VALUE_SOURCES)[number];

export function isHairStateValueSource(value: unknown): value is HairStateValueSource {
  return typeof value === "string" && (HAIR_STATE_VALUE_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Descriptive facts -- each reuses an EXISTING categorical type from
// contracts.ts, widened with "unspecified". Value lists are DERIVED from
// analysis-field-options.ts's own real, already-shipped option arrays
// (never hand-retyped), so this file can never silently drift from the
// vocabulary the rest of the application actually validates against.
// ---------------------------------------------------------------------------

export const HAIR_STATE_LENGTH_VALUES = ["unspecified", ...HAIR_LENGTH_OPTIONS.map((o) => o.value)] as const;
export type HairStateLengthValue = "unspecified" | HairLength;
export function isHairStateLengthValue(value: unknown): value is HairStateLengthValue {
  return typeof value === "string" && (HAIR_STATE_LENGTH_VALUES as readonly string[]).includes(value);
}

export const HAIR_STATE_FIBER_THICKNESS_VALUES = ["unspecified", ...HAIR_TYPE_OPTIONS.map((o) => o.value)] as const;
export type HairStateFiberThicknessValue = "unspecified" | HairType;
export function isHairStateFiberThicknessValue(value: unknown): value is HairStateFiberThicknessValue {
  return typeof value === "string" && (HAIR_STATE_FIBER_THICKNESS_VALUES as readonly string[]).includes(value);
}

export const HAIR_STATE_DENSITY_VALUES = ["unspecified", ...DENSITY_OPTIONS.map((o) => o.value)] as const;
export type HairStateDensityValue = "unspecified" | HairDensity;
export function isHairStateDensityValue(value: unknown): value is HairStateDensityValue {
  return typeof value === "string" && (HAIR_STATE_DENSITY_VALUES as readonly string[]).includes(value);
}

export const HAIR_STATE_TEXTURE_VALUES = ["unspecified", ...HAIR_TEXTURE_OPTIONS.map((o) => o.value)] as const;
export type HairStateTextureValue = "unspecified" | HairTexture;
export function isHairStateTextureValue(value: unknown): value is HairStateTextureValue {
  return typeof value === "string" && (HAIR_STATE_TEXTURE_VALUES as readonly string[]).includes(value);
}

export const HAIR_STATE_CONDITION_VALUES = ["unspecified", ...HAIR_CONDITION_OPTIONS.map((o) => o.value)] as const;
export type HairStateConditionValue = "unspecified" | HairCondition;
export function isHairStateConditionValue(value: unknown): value is HairStateConditionValue {
  return typeof value === "string" && (HAIR_STATE_CONDITION_VALUES as readonly string[]).includes(value);
}

// Internal-vs-external/perimeter relationship -- NOT a numeric measurement;
// a small, closed relational fact, needed for exactly the "preserve
// perimeter length while shortening interior zones" reasoning this stage's
// own task names as the target capability.
export const HAIR_STATE_PERIMETER_RELATIONSHIPS = ["unspecified", "at_perimeter", "shorter_than_perimeter", "longer_than_perimeter"] as const;
export type HairStatePerimeterRelationship = (typeof HAIR_STATE_PERIMETER_RELATIONSHIPS)[number];
export function isHairStatePerimeterRelationship(value: unknown): value is HairStatePerimeterRelationship {
  return typeof value === "string" && (HAIR_STATE_PERIMETER_RELATIONSHIPS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// A single descriptive fact -- value + source, always both present. Reused
// generically for every fact category below via a small helper, mirroring
// ZoneIntentEntry's own "always present, never a fabricated middle value"
// discipline.
// ---------------------------------------------------------------------------

export interface HairStateFact<TValue extends string> {
  value: TValue;
  source: HairStateValueSource;
}

function isValidFact<TValue extends string>(value: unknown, isValidValue: (candidate: unknown) => candidate is TValue): value is HairStateFact<TValue> {
  if (!isRecord(value)) return false;
  return isValidValue(value.value) && isHairStateValueSource(value.source);
}

// ---------------------------------------------------------------------------
// Global state -- mirrors TechnicalVisualMapGlobalIntent's own "one
// read-only mirror, never smeared across zones" shape, but for descriptive
// (not technique) facts.
// ---------------------------------------------------------------------------

export interface HairStateGlobalEntry {
  relativeLength: HairStateFact<HairStateLengthValue>;
  fiberThickness: HairStateFact<HairStateFiberThicknessValue>;
  density: HairStateFact<HairStateDensityValue>;
  texture: HairStateFact<HairStateTextureValue>;
  condition: HairStateFact<HairStateConditionValue>;
}

export function isHairStateGlobalEntry(value: unknown): value is HairStateGlobalEntry {
  if (!isRecord(value)) return false;
  return (
    isValidFact(value.relativeLength, isHairStateLengthValue) &&
    isValidFact(value.fiberThickness, isHairStateFiberThicknessValue) &&
    isValidFact(value.density, isHairStateDensityValue) &&
    isValidFact(value.texture, isHairStateTextureValue) &&
    isValidFact(value.condition, isHairStateConditionValue)
  );
}

// ---------------------------------------------------------------------------
// Per-zone state -- CURRENT/RESULT-relevant descriptive facts, plus
// TARGET-relevant direction facts REUSING TechnicalVisualMap's own
// ZoneLengthIntent/ZoneWeightIntent types directly (never re-declared) so a
// TARGET-role snapshot's own length/weight direction is never a second,
// competing truth from TechnicalVisualMap's own zones[].lengthIntent/
// weightIntent. Layering/graduation state is deliberately NOT a separate
// field here -- it is already expressible via TechnicalVisualMap's own
// elevationOverride + weightIntent; duplicating it here would be exactly
// the second competing truth this stage's own task forbids.
// ---------------------------------------------------------------------------

export interface HairZoneStateEntry {
  zone: HeadZone;
  relativeLength: HairStateFact<HairStateLengthValue>;
  fiberThickness: HairStateFact<HairStateFiberThicknessValue>;
  density: HairStateFact<HairStateDensityValue>;
  texture: HairStateFact<HairStateTextureValue>;
  condition: HairStateFact<HairStateConditionValue>;
  perimeterRelationship: HairStateFact<HairStatePerimeterRelationship>;
  // TARGET-relevant direction -- reused types, see file header.
  lengthIntent: { value: ZoneLengthIntent; source: HairStateValueSource };
  weightIntent: { value: ZoneWeightIntent; source: HairStateValueSource };
}

export function isHairZoneStateEntry(value: unknown): value is HairZoneStateEntry {
  if (!isRecord(value)) return false;
  if (!isHeadZone(value.zone)) return false;
  if (!isValidFact(value.relativeLength, isHairStateLengthValue)) return false;
  if (!isValidFact(value.fiberThickness, isHairStateFiberThicknessValue)) return false;
  if (!isValidFact(value.density, isHairStateDensityValue)) return false;
  if (!isValidFact(value.texture, isHairStateTextureValue)) return false;
  if (!isValidFact(value.condition, isHairStateConditionValue)) return false;
  if (!isValidFact(value.perimeterRelationship, isHairStatePerimeterRelationship)) return false;
  if (!isRecord(value.lengthIntent) || !isZoneLengthIntent(value.lengthIntent.value) || !isHairStateValueSource(value.lengthIntent.source)) return false;
  if (!isRecord(value.weightIntent) || !isZoneWeightIntent(value.weightIntent.value) || !isHairStateValueSource(value.weightIntent.source)) return false;
  return true;
}

// A valid `zones` array is exactly the 6 locked HeadZones, each appearing
// exactly once -- mirrors isZoneIntentArray's own exact invariant.
export function isHairZoneStateArray(value: unknown): value is HairZoneStateEntry[] {
  if (!Array.isArray(value) || value.length !== HEAD_ZONES.length) return false;
  if (!value.every(isHairZoneStateEntry)) return false;
  const zones = value.map((entry) => (entry as HairZoneStateEntry).zone);
  return HEAD_ZONES.every((zone) => zones.filter((z) => z === zone).length === 1);
}

// ---------------------------------------------------------------------------
// The full payload
// ---------------------------------------------------------------------------

export interface HairStateSnapshotPayload {
  globalState: HairStateGlobalEntry;
  zones: HairZoneStateEntry[];
}

export function isHairStateSnapshotPayload(value: unknown): value is HairStateSnapshotPayload {
  if (!isRecord(value)) return false;
  return isHairStateGlobalEntry(value.globalState) && isHairZoneStateArray(value.zones);
}

// ---------------------------------------------------------------------------
// A fully "not yet assessed" baseline -- the honest default for a fact
// category nothing has stated yet. Never a fabricated guess.
// ---------------------------------------------------------------------------

export function unassessedFact<TValue extends string>(value: TValue): HairStateFact<TValue> {
  return { value, source: "not_yet_assessed" };
}

export function buildUnassessedZoneEntry(zone: HeadZone): HairZoneStateEntry {
  return {
    zone,
    relativeLength: unassessedFact("unspecified"),
    fiberThickness: unassessedFact("unspecified"),
    density: unassessedFact("unspecified"),
    texture: unassessedFact("unspecified"),
    condition: unassessedFact("unspecified"),
    perimeterRelationship: unassessedFact("unspecified"),
    lengthIntent: { value: "unspecified", source: "not_yet_assessed" },
    weightIntent: { value: "unspecified", source: "not_yet_assessed" },
  };
}

export function buildUnassessedGlobalEntry(): HairStateGlobalEntry {
  return {
    relativeLength: unassessedFact("unspecified"),
    fiberThickness: unassessedFact("unspecified"),
    density: unassessedFact("unspecified"),
    texture: unassessedFact("unspecified"),
    condition: unassessedFact("unspecified"),
  };
}

// ---------------------------------------------------------------------------
// Deterministic structural diff -- NO semantic AI comparison (task's own
// explicit boundary). Pure value-inequality per fact, per zone, plus the
// global entry. Used to prove BEFORE vs TARGET (or TARGET vs RESULT) can be
// compared mechanically -- reasoning about WHAT the difference MEANS
// professionally is explicitly future work, never performed here.
// ---------------------------------------------------------------------------

export interface HairStateFieldDiff {
  scope: "global" | HeadZone;
  field: string;
  fromValue: string;
  toValue: string;
  changed: boolean;
}

const GLOBAL_FACT_FIELDS: readonly (keyof HairStateGlobalEntry)[] = ["relativeLength", "fiberThickness", "density", "texture", "condition"];
const ZONE_FACT_FIELDS: readonly (keyof HairZoneStateEntry)[] = [
  "relativeLength",
  "fiberThickness",
  "density",
  "texture",
  "condition",
  "perimeterRelationship",
  "lengthIntent",
  "weightIntent",
];

export function diffHairStateSnapshots(from: HairStateSnapshotPayload, to: HairStateSnapshotPayload): readonly HairStateFieldDiff[] {
  const diffs: HairStateFieldDiff[] = [];

  for (const field of GLOBAL_FACT_FIELDS) {
    const fromValue = String(from.globalState[field].value);
    const toValue = String(to.globalState[field].value);
    diffs.push({ scope: "global", field, fromValue, toValue, changed: fromValue !== toValue });
  }

  const toZonesByZone = new Map(to.zones.map((entry) => [entry.zone, entry]));
  for (const fromZoneEntry of from.zones) {
    const toZoneEntry = toZonesByZone.get(fromZoneEntry.zone);
    if (!toZoneEntry) continue; // structurally impossible for two valid payloads (both cover all 6 zones); defensive only.
    for (const field of ZONE_FACT_FIELDS) {
      const fromValue = String((fromZoneEntry[field] as { value: string }).value);
      const toValue = String((toZoneEntry[field] as { value: string }).value);
      diffs.push({ scope: fromZoneEntry.zone, field, fromValue, toValue, changed: fromValue !== toValue });
    }
  }

  return diffs;
}
