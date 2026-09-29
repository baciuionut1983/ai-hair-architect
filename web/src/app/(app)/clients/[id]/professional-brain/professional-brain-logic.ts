import { HEAD_ZONES, ZONE_LENGTH_INTENTS, ZONE_WEIGHT_INTENTS, type HeadZone, type ZoneLengthIntent, type ZoneWeightIntent } from "@/lib/technical-visual-map-validators";
import {
  HAIR_STATE_COLOR_LEVEL_VALUES,
  HAIR_STATE_COLOR_TONE_VALUES,
  HAIR_STATE_CONDITION_VALUES,
  HAIR_STATE_DENSITY_VALUES,
  HAIR_STATE_FIBER_THICKNESS_VALUES,
  HAIR_STATE_LENGTH_VALUES,
  HAIR_STATE_TEXTURE_VALUES,
  buildUnassessedGlobalEntry,
  buildUnassessedZoneEntry,
  type HairStateColorLevelValue,
  type HairStateColorToneValue,
  type HairStateConditionValue,
  type HairStateDensityValue,
  type HairStateFiberThicknessValue,
  type HairStateLengthValue,
  type HairStateSnapshotPayload,
  type HairStateTextureValue,
} from "@/lib/hair-state-snapshot-validators";
import type { BadgeVariant } from "@/components/ui";
import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { SkillCandidateMatch } from "@/lib/hair-state-delta-skill-candidate-selector";

// AI Hair Architect, B2 -- PROFESSIONAL BRAIN CUT+COLOR FLOW, pure UI
// logic. No fetch, no React, no rendering -- testable without a render
// environment, mirroring proposed-look-logic.ts / proposed-look-status-
// badge.tsx's own exact split (pure resolver functions exported alongside
// what a component would use, so a plain `.test.ts` can assert the
// mapping directly).

// ---------------------------------------------------------------------------
// Snapshot status badge (mirrors ProposalStatusBadge's own resolver split).
// ---------------------------------------------------------------------------

export function getSnapshotStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "CONFIRMED":
      return "success";
    case "SUPERSEDED":
      return "warning";
    case "DRAFT":
    default:
      return "neutral";
  }
}

export function getSnapshotStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "CONFIRMED":
      return "Confirmed";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// Delta transformation badge -- PRESERVED reads as a stable, good outcome;
// a real change (CHANGED/REDUCED/INCREASED) reads as something requiring
// attention; ADDED/UNKNOWN are neutral (new information / nothing stated
// yet), never alarming.
// ---------------------------------------------------------------------------

export function getTransformationBadgeVariant(transformation: string): BadgeVariant {
  switch (transformation) {
    case "PRESERVED":
      return "success";
    case "CHANGED":
    case "REDUCED":
    case "INCREASED":
      return "warning";
    case "ADDED":
    case "UNKNOWN":
    default:
      return "neutral";
  }
}

export function getTransformationLabel(transformation: string): string {
  switch (transformation) {
    case "PRESERVED":
      return "Preserved";
    case "CHANGED":
      return "Changed";
    case "REDUCED":
      return "Reduced";
    case "INCREASED":
      return "Increased";
    case "ADDED":
      return "Newly stated";
    case "UNKNOWN":
      return "Not yet stated";
    default:
      return transformation;
  }
}

// ---------------------------------------------------------------------------
// Candidate-skill domain -- derived from the real, declared capability, not
// a name/string-matching guess. EVALUATE_COLOR_SERVICE is the ONLY
// color-vertical capability kind (see professional-skill-contracts.ts's
// own header) -- every other real capability kind is a cutting-domain one
// today, so "not color" reads as "cut" without needing a second lookup.
// ---------------------------------------------------------------------------

export type CandidateDomain = "cut" | "color";

export function getCandidateDomain(matchedCapability: string): CandidateDomain {
  return matchedCapability === "EVALUATE_COLOR_SERVICE" ? "color" : "cut";
}

// ---------------------------------------------------------------------------
// API error mapping -- never a raw internal message to the professional.
// Mirrors mapProposedLookApiError's own exact shape/discipline.
// ---------------------------------------------------------------------------

export function mapProfessionalBrainApiError(status: number, code?: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 404) return "This client or snapshot is no longer available.";
  if (status === 409 && code === "HAIR_STATE_SNAPSHOT_CONCURRENCY_CONFLICT") {
    return "This snapshot's confirmed state changed since you loaded it. Reload and try again.";
  }
  if (status === 409) return "This couldn't be completed because the state changed. Reload and try again.";
  if (status === 400) return "Some required information is missing.";
  if (status === 503) return "This is temporarily unavailable. Please try again shortly.";
  return "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Payload builders -- pure, deterministic. Every zone except the one
// explicitly edited stays at the honest "not yet assessed" baseline
// (buildUnassessedZoneEntry); every global/color fact left at
// "unspecified" stays "not_yet_assessed" too. A real value set by the
// professional is tagged `professional_input` -- never a fabricated
// `observed`/`ai_proposed` source.
// ---------------------------------------------------------------------------

export interface GlobalCutFactsInput {
  relativeLength: HairStateLengthValue;
  fiberThickness: HairStateFiberThicknessValue;
  density: HairStateDensityValue;
  texture: HairStateTextureValue;
  condition: HairStateConditionValue;
}

export const UNSPECIFIED_GLOBAL_CUT_FACTS: GlobalCutFactsInput = {
  relativeLength: "unspecified",
  fiberThickness: "unspecified",
  density: "unspecified",
  texture: "unspecified",
  condition: "unspecified",
};

export interface ColorFactsInput {
  level: HairStateColorLevelValue;
  tone: HairStateColorToneValue;
}

export const UNSPECIFIED_COLOR_FACTS: ColorFactsInput = { level: "unspecified", tone: "unspecified" };

export interface TargetZoneIntentInput {
  zone: HeadZone;
  lengthIntent: ZoneLengthIntent;
  weightIntent: ZoneWeightIntent;
}

function applyGlobalCutFacts(global: GlobalCutFactsInput) {
  const base = buildUnassessedGlobalEntry();
  return {
    relativeLength: global.relativeLength === "unspecified" ? base.relativeLength : { value: global.relativeLength, source: "professional_input" as const },
    fiberThickness: global.fiberThickness === "unspecified" ? base.fiberThickness : { value: global.fiberThickness, source: "professional_input" as const },
    density: global.density === "unspecified" ? base.density : { value: global.density, source: "professional_input" as const },
    texture: global.texture === "unspecified" ? base.texture : { value: global.texture, source: "professional_input" as const },
    condition: global.condition === "unspecified" ? base.condition : { value: global.condition, source: "professional_input" as const },
  };
}

function applyColorFacts(color: ColorFactsInput) {
  return {
    level: color.level === "unspecified" ? { value: "unspecified" as const, source: "not_yet_assessed" as const } : { value: color.level, source: "professional_input" as const },
    tone: color.tone === "unspecified" ? { value: "unspecified" as const, source: "not_yet_assessed" as const } : { value: color.tone, source: "professional_input" as const },
  };
}

export function buildCurrentStatePayload(global: GlobalCutFactsInput, color: ColorFactsInput): HairStateSnapshotPayload {
  return {
    globalState: applyGlobalCutFacts(global),
    zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)),
    colorState: applyColorFacts(color),
  };
}

export function buildTargetStatePayload(global: GlobalCutFactsInput, color: ColorFactsInput, zoneIntent: TargetZoneIntentInput | null): HairStateSnapshotPayload {
  const zones = HEAD_ZONES.map((zone) => {
    const entry = buildUnassessedZoneEntry(zone);
    if (!zoneIntent || zoneIntent.zone !== zone) return entry;
    return {
      ...entry,
      lengthIntent: zoneIntent.lengthIntent === "unspecified" ? entry.lengthIntent : { value: zoneIntent.lengthIntent, source: "professional_input" as const },
      weightIntent: zoneIntent.weightIntent === "unspecified" ? entry.weightIntent : { value: zoneIntent.weightIntent, source: "professional_input" as const },
    };
  });
  return { globalState: applyGlobalCutFacts(global), zones, colorState: applyColorFacts(color) };
}

// ---------------------------------------------------------------------------
// Select option lists -- reused directly by the page, never hand-retyped.
// ---------------------------------------------------------------------------

export const GLOBAL_LENGTH_OPTIONS = HAIR_STATE_LENGTH_VALUES;
export const GLOBAL_FIBER_THICKNESS_OPTIONS = HAIR_STATE_FIBER_THICKNESS_VALUES;
export const GLOBAL_DENSITY_OPTIONS = HAIR_STATE_DENSITY_VALUES;
export const GLOBAL_TEXTURE_OPTIONS = HAIR_STATE_TEXTURE_VALUES;
export const GLOBAL_CONDITION_OPTIONS = HAIR_STATE_CONDITION_VALUES;
export const COLOR_LEVEL_OPTIONS = HAIR_STATE_COLOR_LEVEL_VALUES;
export const COLOR_TONE_OPTIONS = HAIR_STATE_COLOR_TONE_VALUES;
export const ZONE_OPTIONS = HEAD_ZONES;
export const ZONE_LENGTH_INTENT_OPTIONS = ZONE_LENGTH_INTENTS;
export const ZONE_WEIGHT_INTENT_OPTIONS = ZONE_WEIGHT_INTENTS;

// ---------------------------------------------------------------------------
// B2.1 -- SAFE NEW-EVALUATION-ROUND helper. This is the one rule that
// makes "confirm a fresh snapshot after an earlier one is already
// CONFIRMED" work correctly instead of a hardcoded `null`: since
// pickSnapshot (professional-brain-orchestrator.ts) always prefers a
// CONFIRMED row over any newer DRAFT, `currentSnapshot` from the
// evaluation GET is EITHER the still-unconfirmed draft being worked on
// (expected id: null, nothing confirmed yet) OR the previously CONFIRMED
// row a new draft is about to supersede (expected id: that row's own
// id) -- there is no third case. Passing the wrong value here either
// fails a legitimate first confirmation (false 409) or -- far worse --
// would let a stale client silently confirm over a newer approval it
// never saw. Always compute this fresh from the live snapshot, never
// cache it across a render.
// ---------------------------------------------------------------------------

export function getExpectedConfirmedSnapshotId(snapshot: HairStateSnapshotRecord | null): string | null {
  return snapshot && snapshot.status === "CONFIRMED" ? snapshot.id : null;
}

// ---------------------------------------------------------------------------
// B2.1 -- color-candidate detection + the real skill identity it keys
// off. Used to decide when the "what's missing for color" disclosure
// must render -- see page.tsx's ColorReadinessNotice.
// ---------------------------------------------------------------------------

export const COLOR_EVALUATION_GATE_SKILL_KEY = "skill-color-global-single-process-evaluation-gate";

export function hasColorCandidate(matches: readonly SkillCandidateMatch[]): boolean {
  return matches.some((m) => m.skillKey === COLOR_EVALUATION_GATE_SKILL_KEY);
}
