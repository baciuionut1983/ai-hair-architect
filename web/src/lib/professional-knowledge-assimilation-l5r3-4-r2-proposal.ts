import { createHash } from "crypto";

import {
  INTERIOR_45_AUTHORITY_SOURCE,
  INTERIOR_45_EFFECT_SUMMARY,
  INTERIOR_45_GUIDE_CAPABILITY,
  INTERIOR_45_SKILL,
} from "@/lib/cutting-skill-45-degree-interior";
import { buildProposedRegistryMutation, type ProposedRegistryMutation } from "@/lib/professional-knowledge-assimilation-mutation-contracts";
import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4.R2 --
// THE REAL 45deg INTERIOR PROPOSAL: professional-authority provenance
// record + independent Graduated Cutting contradiction audit + the new
// ProposedRegistryMutation. Pure, no I/O, no database, ZERO AI calls,
// ZERO registry writes. This file does NOT touch, import, or re-export
// professional-knowledge-assimilation-l5r3-4-real-plan.ts's own 10
// EXISTING mutations -- it only READS buildRealAssimilationPlan() to
// report the existing count, never mutates or rebuilds it.

// ---------------------------------------------------------------------
// Professional authority record. Deliberately NOT a ProfessionalReview
// Decision (L5.R3.2's own vehicle): that type requires sourceEvidenceId/
// reviewId anchored to a real ApprovedKnowledgeSource/
// ProfessionalLearningReview row (L5.R2's own SOURCE_EVIDENCE_ID/
// REVIEW_ID/APPROVED_RESULT_HASH, reused verbatim throughout every prior
// L5.R3.x stage) -- reusing those identifiers here would falsely claim
// this new, separately-supplied definition came from that specific video
// review event. It did not (see cutting-skill-45-degree-interior.ts's
// own file header). Also deliberately NOT the L5.R3.4.R1 correction
// record's own shape (IONUTS_ONE_LENGTH_GUIDE_CORRECTION): that record
// exists specifically to correct THIS ENGAGEMENT'S OWN bridge-table
// interpretation bug -- there is no bug being corrected here, only new
// professional content being proposed. This is its own, honestly-scoped,
// third provenance shape.
// ---------------------------------------------------------------------

export const IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT = {
  stage: "8.5L5.R3.4.R2",
  professionalAuthoritySource: INTERIOR_45_AUTHORITY_SOURCE,
  provenanceClassification: "PROFESSIONAL_INPUT_NOT_VIDEO_DERIVED" as const,
  professionalSequenceEnglish: [
    "Precondition: the One-Length haircut is already complete.",
    "Work the perimetral termination region: front of one ear, then posterior, then front of the other ear.",
    "Use vertical partings, approximately 2cm wide strands/sections (approximate professional working reference, not an absolute universal requirement).",
    "Control the strand between the fingers, fingertips initially pointing down.",
    "Rotate the hand -- without lifting it away from the base, remaining at the same low level throughout -- until the fingertips point up.",
    "This rotation repositions the strand's interior corner to the lower position and its exterior corner to the upper position (never reversed).",
    "Begin the cut at the upper/exterior corner and progress downward toward the lower reference/guide line.",
    "The cut produces an approximately 45deg cutting line.",
    "Release the strand.",
    "The resulting relationship: exterior terminal hair shorter, interior terminal hair longer.",
    "This length difference causes the terminations to turn inward -- an inward curvature result.",
  ],
  // Explicit list of what this record does NOT establish -- never
  // silently omitted (same UNKNOWN POLICY discipline as
  // ProfessionalReviewDecision.unknownFields).
  unknownFields: [
    "structural identity of the lower reference/guide line (guideSource)",
    "whether that lower reference is a fixed or moving authority (guideBehavior/progression)",
    "whether the concrete reference checked changes per section (referenceProgression)",
    "exact section width in centimeters (professional working reference only, not a fixed value)",
    "exact cutting-line angle in degrees (only an approximate value is known)",
    "exact per-region completion verification criteria beyond having worked the full intended region",
  ],
} as const;

export function computeInteriorFortyFiveProfessionalInputId(): string {
  const canonical = [IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.stage, IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.professionalAuthoritySource, ...IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.professionalSequenceEnglish].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID = computeInteriorFortyFiveProfessionalInputId();

// ---------------------------------------------------------------------
// Independent Graduated Cutting contradiction audit (task's own explicit
// requirement: do NOT silently edit cutting-skill-graduated.ts's own
// "interior-shorter-than-perimeter" statement; independently determine
// whether it is unrelated, valid, or a genuine contradiction, and if a
// genuine contradiction remains, report it separately -- never fix it
// here).
//
// FINDING: NOT a contradiction. cutting-skill-graduated.ts line 107's
// own statement ("any strand elevated out of its natural fall and cut
// necessarily creates an interior-shorter-than-perimeter relationship")
// describes a ZONE-vs-GUIDE-LENGTH comparison: an elevated INTERNAL ZONE
// (e.g. crown/above-occipital), once cut and released to natural fall,
// falls shorter than the established PERIMETER/CONTOUR guide length --
// this is what HAIR_STATE_PERIMETER_RELATIONSHIPS' own
// "shorter_than_perimeter" value represents (a single value per zone,
// relative to a guide). 45deg Interior's own "exterior shorter than
// interior" statement describes a WITHIN-STRAND, CORNER-TO-CORNER
// comparison on a single already-terminal (zero elevation, One-Length)
// section -- two different corners of the SAME terminal edge, never a
// zone-vs-guide relationship at all, and not expressible via
// perimeterRelationship (confirmed directly: that field has no
// corner-level granularity -- see cutting-skill-45-degree-interior.ts's
// own INTERIOR_45_EFFECT_SUMMARY.missingArchitectureVocabulary). The two
// statements use overlapping English words ("interior", "shorter") for
// two structurally unrelated physical referents (an elevated internal
// ZONE vs. one CORNER of a terminal edge) -- confirmed present, byte-
// unchanged, in cutting-skill-graduated.ts since its original commit
// (verified directly by this stage's own baseline read), never touched
// by this proposal.
// ---------------------------------------------------------------------

export const GRADUATED_CUTTING_INTERIOR_TERMINOLOGY_AUDIT = {
  stage: "8.5L5.R3.4.R2",
  targetFile: "cutting-skill-graduated.ts",
  targetStatementSummary: "MODIFY_PERIMETER_RELATIONSHIP capability rationale: elevating and cutting a strand necessarily creates an interior-shorter-than-perimeter relationship.",
  outcome: "NOT_A_CONTRADICTION" as const,
  reasoning:
    "Graduated Cutting's statement compares an elevated INTERNAL ZONE's resulting length against the PERIMETER/CONTOUR GUIDE length (a zone-vs-guide relationship, represented by HAIR_STATE_PERIMETER_RELATIONSHIPS' own single-value-per-zone vocabulary). 45deg Interior's statement compares the EXTERIOR corner against the INTERIOR corner of the SAME terminal edge on an already-complete, zero-elevation One-Length section (a within-strand, corner-to-corner relationship with no existing architectural field at all). Both are real, professionally valid statements about two structurally different physical referents that happen to share the English words 'interior' and 'shorter' -- not the same fact, not a contradiction, and this proposal does not edit either skill to reconcile the wording.",
  recommendationForFutureReview: "Purely a terminology-hygiene observation, not an architectural defect: a future professional glossary/documentation pass could disambiguate 'interior' (elevated internal zone, Graduated Cutting) from 'interior corner' (terminal-edge corner, 45deg Interior) in human-facing labels, to reduce reviewer confusion -- no code change is required or proposed here.",
  graduatedCuttingSkillIdConfirmedUnchanged: GRADUATED_CUTTING_SKILL.skillId,
  oneLengthSkillIdConfirmedUnchanged: ONE_LENGTH_PERIMETER_SKILL.skillId,
} as const;

// ---------------------------------------------------------------------
// The new ProposedRegistryMutation -- a SEPARATE, additionally auditable
// proposal, never merged into or silently added onto the existing
// L5.R3.4.R1 mutation set (professional-knowledge-assimilation-l5r3-4-
// real-plan.ts's own 10 mutations, untouched by this file).
//
// sourceDecisionIds: this mutation has no ProfessionalReviewDecision to
// point at (see file header) -- it is justified instead by
// IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID, this file's own
// professional-authority record id. This is a deliberate, narrow reuse
// of ProposedRegistryMutation.sourceDecisionIds (typed as a plain
// readonly string[], never constrained to ProfessionalReviewDecision.id
// specifically) for a differently-shaped provenance record -- documented
// here so a future reader does not expect it to resolve against
// L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.
// ---------------------------------------------------------------------

const INTERIOR_45_MUTATION_SOURCE_EVIDENCE_ID = "ionut-professional-input-45-degree-interior-2026-09-15";
const INTERIOR_45_MUTATION_APPROVED_RESULT_HASH = computeInteriorFortyFiveProfessionalInputId();

export const INTERIOR_45_PROPOSED_MUTATION: ProposedRegistryMutation = buildProposedRegistryMutation({
  sourceEvidenceId: INTERIOR_45_MUTATION_SOURCE_EVIDENCE_ID,
  approvedResultHash: INTERIOR_45_MUTATION_APPROVED_RESULT_HASH,
  operation: "PROPOSE_NEW_SKILL",
  discriminator: INTERIOR_45_SKILL.skillId,
  targetSkillId: null,
  proposedIdentity: {
    techniqueId: "45-degree-interior",
    label: "45deg Interior (Inward-Curve Terminal Technique)",
    relatedTechniqueIds: [ONE_LENGTH_PERIMETER_SKILL.skillId],
    distinctFrom: [GRADUATED_CUTTING_SKILL.skillId],
    purpose: "INWARD_TERMINAL_CURVATURE_VIA_ROTATION_CONTROLLED_CUTTING_LINE",
  },
  workflowStateTransition: null,
  sourceDecisionIds: [IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT_ID],
  fieldsAdded: [
    { name: "terminalCuttingLineAngle", value: "approximately_45_deg_interior_cutting_line", provenance: "PROFESSIONAL_INPUT" },
    { name: "terminalLengthRelationship", value: "exterior_shorter_than_interior", provenance: "PROFESSIONAL_INPUT" },
    { name: "cornerRepositioning", value: "interior_corner_lower_exterior_corner_upper", provenance: "PROFESSIONAL_INPUT" },
  ],
  fieldsPreservedUnchanged: [GRADUATED_CUTTING_SKILL.skillId, ONE_LENGTH_PERIMETER_SKILL.skillId],
  unknownFieldsPreserved: [...IONUTS_45_DEGREE_INTERIOR_PROFESSIONAL_INPUT.unknownFields],
  contextualKnowledge: [],
  conflict: "NONE",
  reason:
    "Professional addition -- Ionuț supplied a complete new technique definition (45deg Interior / inward-curve terminal technique) not derived from the L5.R2 video review or any AI extraction. Proposed as a new, distinct, One-Length-dependent SkillDefinition (DRAFT status, ineligible for authority), never merged into Graduated Cutting or One-Length Perimeter, and never silently added to the existing L5.R3.4.R1 mutation set.",
});

// ---------------------------------------------------------------------
// Pending mutation status -- nothing activated. Reads (never mutates)
// the existing L5.R3.4.R1 real plan to report the running total.
// ---------------------------------------------------------------------

export function computePendingMutationStatus(): { existingCount: number; newCount: number; totalPending: number } {
  const existingPlan = buildRealAssimilationPlan();
  return { existingCount: existingPlan.mutationSet.length, newCount: 1, totalPending: existingPlan.mutationSet.length + 1 };
}

export const INTERIOR_45_GUIDE_CAPABILITY_REF = INTERIOR_45_GUIDE_CAPABILITY;
export const INTERIOR_45_EFFECT_SUMMARY_REF = INTERIOR_45_EFFECT_SUMMARY;
