import { isRecord } from "@/lib/technical-visual-map-validators";
import { isValidSkillCondition, type SkillCondition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Stage 2.5.i.10 -- DEMONSTRATION REQUIREMENT, contract/
// foundation only. Types + pure validators, no I/O, no database, no
// provider call, no AI -- mirrors Stage 2.5.i.3/i.4's own established
// "Stage 1" convention exactly. UNIVERSAL, not cutting-specific -- named
// accordingly (professional-skill-*, not cutting-skill-*).
//
// ARCHITECTURAL LOCK (Stage 2.5.i.9 audit): a Demonstration Requirement
// answers ONLY "what must be visually understandable/visible to
// faithfully demonstrate an already-authorized professional action" --
// never "where the camera is", never "how long the shot lasts", never a
// provider-specific rendering detail. It sits strictly between Atomic
// Action (Stage 2.5.i.4, professional truth) and a future VideoInstruction
// (not built here, not even started) -- it creates NO new professional
// salon authority, only translates already-structured technique facts
// into structured VISIBILITY facts, using the exact same closed-
// vocabulary, no-free-text, no-eval discipline as everything else in this
// domain.
//
// THREE-CLASS SEPARATION this file exists to enforce (Stage 2.5.i.9 §5):
//   A. Professional truth -- lives on Atomic Action/Execution Unit/Skill
//      Instance, never duplicated here beyond a reference.
//   B. Demonstration/visualization direction -- THIS FILE.
//   C. Provider/rendering detail -- deliberately absent from this
//      contract's own shape (see WHAT THIS FILE IS NOT below).
//
// CATEGORY VOCABULARY -- deliberately kept small and vertical-agnostic in
// NAME (Stage 2.5.i.9 §21/multi-vertical sanity check): none of the five
// values below names a cutting-specific concept (no "shear", "comb",
// "elevation", "hair"). The cutting-specific CONTENT (which technique
// facts map to which category, e.g. controlMethod -> TOOL_TO_SUBJECT_
// RELATIONSHIP) is deliberately NOT in this file -- that logic lives in
// cutting-skill-demonstration-requirement-deriver.ts, mirroring the exact
// universal-contract/vertical-deriver split already established between
// professional-skill-atomic-action-contracts.ts (universal) and cutting-
// skill-atomic-action-compiler.ts (cutting-specific), Stage 2.5.i.4/i.8.
//
// SUBJECT VALUE, deliberately NOT reference-only (unlike AtomicAction.
// boundParameterNames, which is explicitly a NAME reference, never a
// re-declared value): a Demonstration Requirement DOES carry a resolved
// `subjectValue`, because the entire reason this layer exists is to keep
// two structurally different professional facts (e.g. controlMethod=comb
// vs. controlMethod=fingers) visually DISTINGUISHABLE downstream --
// collapsing both into a bare parameter-name reference would itself
// recreate the exact "comb_and_fingers"-style flattening this stage's own
// task explicitly forbids. This is safe specifically because a
// Demonstration Requirement is always DERIVED fresh (never independently
// authored, never a second source of truth) -- see the deriver file's own
// header for the full reasoning.
//
// WHAT THIS FILE IS NOT (Stage 2.5.i.10's own explicit boundary):
//   - it contains ZERO camera/viewpoint/framing/shot concept -- no field
//     anywhere in this shape names an angle, a distance, a lens, or a
//     movement (Stage 2.5.i.9 §11: exact camera direction is visualization
//     POLICY or provider detail, never this layer's own job);
//   - it contains ZERO timing/duration/seconds/pacing concept (Stage
//     2.5.i.9 §12);
//   - it contains ZERO provider-specific field (prompt text, seed,
//     resolution, aspect ratio, provider name) -- Stage 2.5.i.9 §24;
//   - it does NOT implement VideoInstruction, a visualization policy, or
//     any provider adapter -- this file exports no such symbol;
//   - it is NOT persisted -- no Prisma model, no migration. Like Atomic
//     Action, it is compiled fresh from already-persisted authority, never
//     an independent source of truth;
//   - it does NOT represent or claim a runtime observation -- nothing
//     here asserts a real client was observed, a real guide was checked,
//     or real anatomy was measured (Stage 2.5.i.9 §15); it only ever says
//     "this must be visually demonstrated," never "this was witnessed."

// ---------------------------------------------------------------------------
// Category vocabulary -- see file header. Justified ONLY by what the two
// real Skills (Stage 2.5.i.6/i.7) actually exercise; no speculative
// category is included.
// ---------------------------------------------------------------------------

export const DEMONSTRATION_REQUIREMENT_CATEGORIES = [
  "TOOL_TO_SUBJECT_RELATIONSHIP",
  "SUBJECT_TO_REFERENCE_GEOMETRY",
  "RESULTING_LINE_OR_FORM",
  "ANATOMICAL_CONTEXT",
  "SUBJECT_POSITION_STATE",
] as const;
export type DemonstrationRequirementCategory = (typeof DEMONSTRATION_REQUIREMENT_CATEGORIES)[number];

export function isDemonstrationRequirementCategory(value: unknown): value is DemonstrationRequirementCategory {
  return typeof value === "string" && (DEMONSTRATION_REQUIREMENT_CATEGORIES as readonly string[]).includes(value);
}

function isSubjectValueLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

// ---------------------------------------------------------------------------
// The Demonstration Requirement itself.
// ---------------------------------------------------------------------------

export interface DemonstrationRequirement<TFact extends string = string> {
  demonstrationRequirementId: string;
  // Open string, deliberately -- mirrors every other contract in this
  // family exactly.
  vertical: string;
  category: DemonstrationRequirementCategory;
  // Which structured fact(s) justify this requirement -- names only,
  // never a competing value declaration for these (the resolved value
  // lives in `subjectValue` below, singular, for the PRIMARY fact this
  // requirement exists to make visible).
  subjectParameterNames: readonly string[];
  subjectValue: string | boolean | number;
  // Provenance -- the exact Atomic Action this requirement was derived
  // from. The full chain (Atomic Action -> Execution Unit -> Skill
  // Instance -> Skill Definition/version -> Professional Authority) is
  // reconstructible transitively via that action's own existing
  // provenance fields -- never duplicated here.
  sourceAtomicActionId: string;
  // Verbatim passthrough of the source Execution Unit's own
  // applicabilityCondition, ONLY when this requirement's own category is
  // ANATOMICAL_CONTEXT (the one category an anatomical condition is
  // direct evidence for) -- never re-evaluated, never re-interpreted.
  condition?: SkillCondition<TFact>;
  // Presentation-only, never technical authority -- built from structured
  // fields alone (see the deriver's own no-free-text-parsing discipline).
  presentationSummary: string;
  derivedAt: string;
}

export function isValidDemonstrationRequirement<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is DemonstrationRequirement<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.demonstrationRequirementId !== "string" || value.demonstrationRequirementId.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (!isDemonstrationRequirementCategory(value.category)) return false;

  if (!Array.isArray(value.subjectParameterNames) || value.subjectParameterNames.length === 0) return false;
  if (!value.subjectParameterNames.every((n) => typeof n === "string" && n.length > 0)) return false;

  if (!("subjectValue" in value) || value.subjectValue === undefined || !isSubjectValueLiteral(value.subjectValue)) return false;

  if (typeof value.sourceAtomicActionId !== "string" || value.sourceAtomicActionId.length === 0) return false;

  if (value.condition !== undefined && !isValidSkillCondition(value.condition, isValidFact)) return false;

  if (typeof value.presentationSummary !== "string" || value.presentationSummary.trim().length === 0) return false;
  if (typeof value.derivedAt !== "string" || value.derivedAt.length === 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Deduplication -- collapses exact duplicates (same category + same
// subjectValue) within ONE Atomic Action's own derived set, merging their
// subjectParameterNames. Deliberately never crosses Atomic Action
// boundaries (a caller must only ever pass requirements already scoped to
// one action -- merging across actions would make sourceAtomicActionId
// ambiguous, which this function structurally cannot do since it has no
// per-requirement override for that field).
// ---------------------------------------------------------------------------

export function deduplicateDemonstrationRequirements<TFact extends string>(
  requirements: readonly DemonstrationRequirement<TFact>[],
): readonly DemonstrationRequirement<TFact>[] {
  const byKey = new Map<string, DemonstrationRequirement<TFact>>();
  for (const requirement of requirements) {
    const key = `${requirement.category}::${String(requirement.subjectValue)}`;
    const existing = byKey.get(key);
    if (existing) {
      const mergedNames = Array.from(new Set([...existing.subjectParameterNames, ...requirement.subjectParameterNames]));
      byKey.set(key, { ...existing, subjectParameterNames: mergedNames });
    } else {
      byKey.set(key, requirement);
    }
  }
  return [...byKey.values()];
}
