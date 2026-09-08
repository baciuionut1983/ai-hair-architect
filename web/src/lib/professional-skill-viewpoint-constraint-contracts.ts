import { isRecord } from "@/lib/technical-visual-map-validators";
import { isDemonstrationRequirementCategory, type DemonstrationRequirementCategory } from "@/lib/professional-skill-demonstration-requirement-contracts";

// AI Hair Architect, Stage 2.5.i.12 -- VIEWPOINT CONSTRAINT, contract/
// foundation only. Types + pure validators, no I/O, no database, no
// provider call, no AI -- mirrors Stage 2.5.i.4/i.10's own established
// "Stage 1" convention exactly. UNIVERSAL, not cutting-specific -- named
// accordingly (professional-skill-*, not cutting-skill-*).
//
// ARCHITECTURAL LOCK (Stage 2.5.i.11 audit): a Viewpoint Constraint
// answers ONLY "which broad, provider-independent viewpoint family and
// semantic framing would make a set of already-derived Demonstration
// Requirements (Stage 2.5.i.10) visually readable" -- never "exactly
// where the camera is" (degrees, distance, height, lens, motion), never
// timing, never provider syntax. It creates NO new professional salon
// authority and NO new cinematographic authority -- it only classifies
// and groups already-derived visibility facts into the smallest
// provider-independent semantics a future VideoInstruction compiler could
// resolve without reading professional free text.
//
// VIEWPOINT FAMILY -- deliberately NOT a reuse of TechnicalVisualMap
// SpatialBinding's own `ViewLabel` (front/left_profile/right_profile/
// back/other, technical-visual-map-spatial-validators.ts), per Stage
// 2.5.i.11's own explicit conclusion (§3, Final Verdict A: "PARTIALLY
// SUFFICIENT as naming precedent only... importing the type directly
// would create a structural dependency from Technical Execution Video
// onto the Technical Visual Map/Spatial Map domain, violating this
// engagement's own locked independence principle"). `ViewLabel` describes
// which angle an EXISTING SOURCE PHOTO was declared to be taken from --
// a fundamentally different fact from "which viewpoint family a
// to-be-generated demonstration clip needs". This file declares its OWN,
// independently-named vocabulary, mirroring the exact "independently-
// named, structurally-similar vocabulary per entity" precedent already
// used repeatedly in this domain (e.g. ExecutionUnitLaterality vs. no
// import of anything TVM-related either).
//
// ONLY ONE REAL VALUE TODAY ("POSTERIOR") -- deliberately, not a
// speculative 5-value set copied from ViewLabel. Every real Demonstration
// Requirement derivable today (Stage 2.5.i.6's Central Nape Guide, Stage
// 2.5.i.7's Occipital Transition, both lower and upper) describes
// posterior/nape/occipital execution -- nothing in real content justifies
// a second family value yet. Growing this vocabulary is intentionally
// deferred until a real Skill actually needs a different family (e.g. a
// future lateral- or fringe-execution Skill) -- exactly the "implement
// only what current REAL requirements justify" discipline this whole
// engagement follows. "POSTERIOR" itself is a genuinely cross-vertical
// anatomical-direction term (not haircut vocabulary -- a color foil
// placement or a nail-region application could equally be posterior/
// anterior/lateral), which is why it belongs in this UNIVERSAL file.
//
// FRAMING SEMANTIC -- a small, closed, three-value vocabulary
// (ANATOMICAL_CONTEXT_VISIBLE / TECHNICAL_RELATIONSHIP_READABLE /
// GEOMETRY_READABLE), deliberately semantic rather than cinematographic
// (never WIDE/MEDIUM/CLOSE_UP -- Stage 2.5.i.11 §12's own explicit
// recommendation). Also universal: these three concepts ("is the broader
// context visible", "is a tool/subject relationship readable", "is a
// spatial/geometric relationship readable") are meaningful for any
// vertical, not just cutting.
//
// classifyFramingSemantic below is a PURE, UNIVERSAL structural mapping
// between two ALREADY-universal vocabularies (DemonstrationRequirement
// Category, Stage 2.5.i.10, and FramingSemantic, this file) -- it
// contains no vertical-specific keying (no parameter name, no cutting
// value) and therefore stays in this universal file, UNLIKE the
// viewpoint-family compatibility table (which family satisfies which
// framing), deliberately kept in the cutting-specific deriver file
// (cutting-skill-viewpoint-constraint-deriver.ts) instead -- that
// compatibility judgment genuinely depends on the vertical's own anatomy/
// geometry (a POSTERIOR viewpoint's suitability is a head-shaped-subject
// assumption this file makes no claim about generalizing to other
// verticals), matching Stage 2.5.i.12's own explicit "cutting-specific
// mappings may live in cutting-specific derivation rules" instruction.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.12's own explicit boundary):
//   - it contains ZERO exact camera geometry (angle in degrees, lens,
//     focal length, height, distance, dolly/pan/tilt/zoom);
//   - it contains ZERO timing (seconds, clip duration, frame count, slow
//     motion);
//   - it contains ZERO provider-specific field (model, prompt wording,
//     seed, aspect ratio, resolution) -- Stage 2.5.i.11 §24;
//   - it does NOT implement VideoInstruction, a provider adapter, or any
//     satisfaction/coverage DERIVATION logic -- this file exports no such
//     function; the pure deterministic derivation + family-compatibility
//     table live in cutting-skill-viewpoint-constraint-deriver.ts,
//     mirroring the exact universal-contract/vertical-deriver split
//     already established by Stage 2.5.i.4/i.8 and Stage 2.5.i.10;
//   - it is NOT persisted -- no Prisma model, no migration. Like Atomic
//     Action and Demonstration Requirement, it is compiled fresh from
//     already-persisted authority, never an independent source of truth;
//   - it does NOT depend on Technical Visual Map, Spatial Map, Photo
//     Preview, or Result Video in any way -- no import from any of those
//     files anywhere in this contract;
//   - it does NOT claim a runtime observation occurred -- it only ever
//     says "this viewpoint/framing would make this readable," never "this
//     was actually observed".

// ---------------------------------------------------------------------------
// Viewpoint family -- see file header for why this is independently
// declared (never importing ViewLabel) and why only one real value exists
// today.
// ---------------------------------------------------------------------------

export const VIEWPOINT_FAMILIES = ["POSTERIOR"] as const;
export type ViewpointFamily = (typeof VIEWPOINT_FAMILIES)[number];

export function isViewpointFamily(value: unknown): value is ViewpointFamily {
  return typeof value === "string" && (VIEWPOINT_FAMILIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Framing semantic -- see file header for why these three, and why
// semantic rather than cinematographic.
// ---------------------------------------------------------------------------

export const FRAMING_SEMANTICS = ["ANATOMICAL_CONTEXT_VISIBLE", "TECHNICAL_RELATIONSHIP_READABLE", "GEOMETRY_READABLE"] as const;
export type FramingSemantic = (typeof FRAMING_SEMANTICS)[number];

export function isFramingSemantic(value: unknown): value is FramingSemantic {
  return typeof value === "string" && (FRAMING_SEMANTICS as readonly string[]).includes(value);
}

// Pure, universal, exhaustive structural mapping -- see file header for
// why this stays here rather than in the cutting-specific deriver.
//
// SUBJECT_CONDITION_STATE (Stage 2.5.i.18 audit, Stage 2.5.i.19 addition)
// maps to the EXISTING ANATOMICAL_CONTEXT_VISIBLE value, never a new
// FramingSemantic -- it is, like ANATOMICAL_CONTEXT and SUBJECT_POSITION_
// STATE, fundamentally a fact about the subject's own current visible
// context (here: material/condition rather than location or pose), and
// the already-real POSTERIOR family already satisfies that framing (see
// cutting-skill-viewpoint-constraint-deriver.ts's own FAMILY_FRAMING_
// COMPATIBILITY table, unchanged). No new viewpoint vocabulary is
// introduced by this addition.
export function classifyFramingSemantic(category: DemonstrationRequirementCategory): FramingSemantic {
  switch (category) {
    case "ANATOMICAL_CONTEXT":
    case "SUBJECT_POSITION_STATE":
    case "SUBJECT_CONDITION_STATE":
      return "ANATOMICAL_CONTEXT_VISIBLE";
    case "TOOL_TO_SUBJECT_RELATIONSHIP":
      return "TECHNICAL_RELATIONSHIP_READABLE";
    case "SUBJECT_TO_REFERENCE_GEOMETRY":
    case "RESULTING_LINE_OR_FORM":
      return "GEOMETRY_READABLE";
  }
}

// ---------------------------------------------------------------------------
// The Viewpoint Constraint itself. No TFact generic -- unlike Demonstration
// Requirement, a Viewpoint Constraint never embeds a SkillCondition of its
// own; any condition relevant to it is reachable via the Demonstration
// Requirement(s) it references.
// ---------------------------------------------------------------------------

export interface ViewpointConstraint {
  viewpointConstraintId: string;
  // Open string, deliberately -- mirrors every other contract in this
  // family exactly.
  vertical: string;
  viewpointFamily: ViewpointFamily;
  framingSemantic: FramingSemantic;
  // Traceability -- every Demonstration Requirement this constraint
  // covers. The full chain (Demonstration Requirement -> Atomic Action ->
  // Execution Unit -> Skill Instance -> Skill Definition/version ->
  // Professional Authority) is reconstructible transitively via those
  // referenced ids -- never duplicated here.
  satisfiedDemonstrationRequirementIds: readonly string[];
  derivedAt: string;
}

export function isValidViewpointConstraint(value: unknown): value is ViewpointConstraint {
  if (!isRecord(value)) return false;
  if (typeof value.viewpointConstraintId !== "string" || value.viewpointConstraintId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (!isViewpointFamily(value.viewpointFamily)) return false;
  if (!isFramingSemantic(value.framingSemantic)) return false;

  if (!Array.isArray(value.satisfiedDemonstrationRequirementIds) || value.satisfiedDemonstrationRequirementIds.length === 0) return false;
  if (!value.satisfiedDemonstrationRequirementIds.every((id) => typeof id === "string" && id.length > 0)) return false;

  if (typeof value.derivedAt !== "string" || value.derivedAt.length === 0) return false;

  return true;
}

// Re-exported so a caller only ever needs one import for "is this a
// recognized Demonstration Requirement category" alongside this file's
// own vocabulary -- avoids a second import for a guard already defined
// one layer over.
export { isDemonstrationRequirementCategory };
