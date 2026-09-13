import type { ProfessionalLearningExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2.1 --
// PROFESSIONAL VISUAL SEMANTIC CLASSIFICATION GUARD, scoped to ELEVATION
// only (Part 8: "the smallest safe deterministic guard"). Closes a real
// gap the L4.R2 acceptance run exposed: the real Gemini adapter lets the
// model pick BOTH the field name and the value in one atomic decision
// (EXTRACTED_FIELD_SCHEMA.field is a bare enum choice), so nothing ever
// checked whether "elevation" was the semantically correct professional
// concept for what was actually described -- only whether the VALUE
// itself was grounded. The real result correctly OBSERVED "directional
// projection arrows extending from head contours" but incorrectly filed
// that observation under ELEVATION, a precise professional concept
// (hair/strand lifted away from the head/reference during cutting) that
// generic diagram/projection geometry does not, by itself, establish.
//
// OBSERVATION CORRECTNESS != SEMANTIC FIELD-CHOICE CORRECTNESS (Part 2/7):
// this guard never disputes that something was visible -- it only
// disputes whether ELEVATION was the right label for it. A rejected
// claim becomes explicit UNKNOWN (R1.1's own authoritative state for
// "the system has a relevant question, but the source does not support
// a reliable answer here"), never silently dropped and never coerced
// into some other field on its own initiative (Part 5: do not force a
// reclassification the caller cannot verify either -- UNKNOWN is the
// honest, conservative outcome; a human professional, not this
// heuristic, decides whether the same observation actually belongs
// under cuttingLine/targetEffect/guideType, if it doesn't already sit
// there as its own separately-extracted field).
//
// SCOPE (Part 32): applies ONLY to IMAGE/DIAGRAM-derived elevation
// claims, i.e. exactly when the caller has no text to ground OBSERVED
// claims against (professional-learning-draft-extraction-validator.ts's
// skipObservedGrounding). TEXT/VOICE_TRANSCRIPT evidence already has a
// strictly stronger check for this (real token-overlap grounding against
// the evidence's own text, unchanged since L4.R1) -- this guard must
// never run there, or One-Length's real, explicit, professionally
// stated "no elevation" would be wrongly caught by a heuristic built for
// a fundamentally weaker (visual-only) evidence class.
//
// PROFESSIONAL_INPUT is exempt (Part 9): a real professional statement
// ("Ridic șuvița la 90°") is already independently grounded against the
// professional's own separate note text by the extractor itself (Part
// 7/8's existing authority protection) -- a categorically stronger
// safeguard than this heuristic, which exists specifically for the
// provider's OWN visual reading, never for the professional's own words.
// UNKNOWN entries are trivially exempt (nothing to guard).
//
// GENERALIZATION (Part 8): no image name, filename, test fixture, icon
// shape, or specific provider response is referenced anywhere below --
// the rule is a pure text-content check over whatever value/note text
// the claim itself carries, and applies identically to any future image.

const HAIR_RELATIONSHIP_TERMS = ["hair", "strand", "section", "subsection", "tress"];
const LIFT_RELATIONSHIP_TERMS = ["lift", "lifted", "raise", "raised", "elevat", "held at", "angle from", "away from the head", "away from the scalp", "relative to the head", "degrees from"];

function normalizedClaimText(value: unknown, note: string | undefined): string {
  const valueText = typeof value === "string" ? value : "";
  return `${valueText} ${note ?? ""}`.toLowerCase();
}

// Requires BOTH a hair/strand-relationship term AND a lift/angle-
// relationship term to co-occur -- generic diagram vocabulary ("line",
// "projection", "diagram", "guide", "boundary", "shape", "panel",
// "arrow", "contour") never satisfies this alone, regardless of how
// angular or geometric it sounds (Part 14: an unbound "90°" label does
// not automatically mean elevation).
export function isElevationClaimSemanticallyGrounded(value: unknown, note?: string): boolean {
  const text = normalizedClaimText(value, note);
  const hasHairRelationship = HAIR_RELATIONSHIP_TERMS.some((term) => text.includes(term));
  const hasLiftRelationship = LIFT_RELATIONSHIP_TERMS.some((term) => text.includes(term));
  return hasHairRelationship && hasLiftRelationship;
}

// Applied once, server-side, after strict validation and before UNKNOWN
// completion (Part 4/6's own pipeline placement: OBSERVATION ->
// INTERPRETATION -> VALIDATION -> STRUCTURED CLAIM). Never mutates any
// field other than `elevation`, and never runs at all for non-image
// evidence.
export function applyElevationSemanticGuard(extraction: ProfessionalLearningExtraction, isImageEvidence: boolean): ProfessionalLearningExtraction {
  if (!isImageEvidence) return extraction;

  const elevation = extraction.elevation;
  if (!elevation) return extraction;
  if (elevation.source === "PROFESSIONAL_INPUT" || elevation.source === "UNKNOWN") return extraction;

  if (isElevationClaimSemanticallyGrounded(elevation.value, elevation.note)) return extraction;

  return { ...extraction, elevation: { value: null, source: "UNKNOWN" } };
}
