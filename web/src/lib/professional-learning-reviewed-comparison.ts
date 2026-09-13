import type { ProfessionalLearningComparisonOutcome, ProfessionalLearningExtraction, ProfessionalLearningExtractionFieldName } from "@/lib/professional-learning-draft-validators";
import type { ReferenceDependencyRelationship, ReferenceDependencyRelationshipType } from "@/lib/professional-learning-reference-dependency";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillCapabilityKind } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1.1 --
// POST-PROFESSIONAL-REVIEW REGISTRY COMPARISON. Pure, no I/O, no
// database, zero real AI calls, ZERO registry writes.
//
// WHY THIS FILE EXISTS (Section 18-21): Stage 8.5L5.R1's real blind
// comparator (professional-learning-draft-comparison.ts's
// compareExtractionAgainstRegistry, via professional-learning-technique-
// name-matcher.ts's token-overlap matcher) correctly returned
// POSSIBLE_NEW_SKILL for "Blunt Bob Perimeter Cutting with Head Tilt" --
// a 7-token compound name sharing only "perimeter" (1 token) with
// "Construct One-Length Perimeter" (4 tokens), well below the matcher's
// own 0.6 overlap threshold. THAT WAS CORRECT given the evidence
// available at the time (Section 20's own "possible acceptable
// conclusion"). This file does NOT touch that comparator, does NOT touch
// professional-learning-draft-repository.ts's createCorrectionDraft
// (which still hardcodes comparisonOutcome="POSSIBLE_CORRECTION" and
// copies comparedSkillId from the prior draft, entirely unmodified) --
// it computes a SEPARATE, ADDITIONAL "what does the evidence support
// NOW, after professional review" result, stored alongside (never
// instead of) the original.
//
// GENERIC BY CONSTRUCTION, NOT ONE-LENGTH-SPECIFIC (Section 18/22/23):
// this function never mentions "Blunt", "Bob", "One-Length", or any
// other skill/look name. It works in exactly two structural ways, both
// reusable for any skill/field/relationship-type combination:
//   1. PARAMETER EVIDENCE -- for each registry skill's own declared
//      parameters, if a parameter's `name` matches an extraction field
//      name VERBATIM (e.g. skill parameter "elevation" <-> extraction
//      field "elevation" -- a real, pre-existing correspondence this
//      file only READS, never invents) and the reviewed extraction has
//      that field as PROFESSIONAL_INPUT, compare the field's own numeric
//      content against the parameter's allowedValues' numeric content
//      (e.g. "0deg"/"0 degrees"/"0_deg_blunt" all reduce to the number
//      0) -- numeric comparison, never string/keyword matching.
//   2. CAPABILITY EVIDENCE -- for each ESTABLISHED reference-dependency
//      relationship (professional-learning-reference-dependency.ts), its
//      relationshipType maps through ONE small declarative table (never
//      a per-skill/per-haircut rule) to a SkillCapabilityKind; if the
//      candidate skill declares that capability, that counts as
//      supporting evidence.
// A skill needs at least one of these two evidence kinds to be proposed
// at all, and BOTH to reach VARIATION_OF_EXISTING -- EVIDENCE_FOR_EXISTING
// for a single evidence kind, unchanged POSSIBLE_NEW_SKILL for neither.
// Never MATCH_EXISTING (too strong a claim for parameter+capability
// correspondence alone) and never a registry write of any kind.

// Section 18/22: ONE small, declarative, domain-general table -- not a
// per-skill or per-haircut rule farm. Maps generic reference-dependency
// relationship types to the generic capability vocabulary a skill may
// declare (professional-skill-contracts.ts's own SKILL_CAPABILITY_KINDS).
const RELATIONSHIP_TYPE_TO_CAPABILITY_KIND: Partial<Record<ReferenceDependencyRelationshipType, SkillCapabilityKind>> = {
  ESTABLISHES_REFERENCE: "ESTABLISH_GUIDE",
  REPLACES_REFERENCE: "ESTABLISH_GUIDE",
  USES_REFERENCE: "CONNECT_ZONES",
  ALIGNS_TO_REFERENCE: "CONNECT_ZONES",
  CUTS_TO_REFERENCE: "CONNECT_ZONES",
  CONTINUES_REFERENCE: "CONNECT_ZONES",
  // REFERENCE_ROLE_UNKNOWN deliberately maps to nothing -- an
  // unestablished/unknown-role relationship contributes zero capability
  // evidence, by construction.
};

function extractLeadingNumber(text: string): number | null {
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

interface ParameterEvidence {
  readonly skillId: string;
  readonly fieldName: ProfessionalLearningExtractionFieldName;
  readonly parameterName: string;
}

function findParameterEvidence(extraction: ProfessionalLearningExtraction, skill: ProfessionalSkillDefinitionRecord): readonly ParameterEvidence[] {
  const evidence: ParameterEvidence[] = [];
  const parameters = skill.payload.parameters ?? [];

  for (const parameter of parameters) {
    const fieldName = parameter.name as ProfessionalLearningExtractionFieldName;
    const field = extraction[fieldName];
    // Only PROFESSIONAL_INPUT field claims count as reviewed evidence
    // here -- an OBSERVED/INFERRED claim from the original blind pass is
    // already accounted for by the ORIGINAL comparator; this function
    // exists specifically to reflect what professional review ADDED.
    if (!field || field.source !== "PROFESSIONAL_INPUT" || typeof field.value !== "string") continue;
    // Only a FIXED parameter (exactly one allowed value -- "no
    // exceptions," in this registry's own recurring phrasing) counts as
    // meaningful evidence. A parameter with several allowed values (e.g.
    // Graduated Cutting's elevation, which legitimately varies by phase)
    // merely happening to include the reviewed value among its options is
    // much weaker signal -- matching one of several possibilities never
    // identifies a specific skill on its own.
    if (!parameter.allowedValues || parameter.allowedValues.length !== 1) continue;

    const fieldNumber = extractLeadingNumber(field.value);
    const parameterNumbers = parameter.allowedValues.filter((v): v is string => typeof v === "string").map(extractLeadingNumber);

    const numericMatch = fieldNumber !== null && parameterNumbers.some((n) => n === fieldNumber);
    // A non-numeric parameter (no leading number on either side) falls
    // back to exact, case-insensitive string equality -- still never a
    // partial/keyword match.
    const exactMatch = fieldNumber === null && parameter.allowedValues.some((v) => typeof v === "string" && v.toLowerCase() === field.value?.toString().toLowerCase());

    if (numericMatch || exactMatch) {
      evidence.push({ skillId: skill.skillId, fieldName, parameterName: parameter.name });
    }
  }

  return evidence;
}

interface CapabilityEvidence {
  readonly skillId: string;
  readonly relationshipId: string;
  readonly capabilityKind: SkillCapabilityKind;
}

function findCapabilityEvidence(relationships: readonly ReferenceDependencyRelationship[], skill: ProfessionalSkillDefinitionRecord): readonly CapabilityEvidence[] {
  const declaredKinds = new Set((skill.payload.capabilities ?? []).map((c) => c.kind));
  const evidence: CapabilityEvidence[] = [];

  for (const relationship of relationships) {
    if (!relationship.established) continue;
    const capabilityKind = RELATIONSHIP_TYPE_TO_CAPABILITY_KIND[relationship.relationshipType];
    if (!capabilityKind) continue;
    if (declaredKinds.has(capabilityKind)) {
      evidence.push({ skillId: skill.skillId, relationshipId: relationship.id, capabilityKind });
    }
  }

  return evidence;
}

export interface ReviewedComparisonSkillFinding {
  readonly skillId: string;
  readonly parameterEvidence: readonly ParameterEvidence[];
  readonly capabilityEvidence: readonly CapabilityEvidence[];
}

export interface ReviewedComparisonResult {
  readonly outcome: ProfessionalLearningComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly findings: readonly ReviewedComparisonSkillFinding[];
  readonly reason: string;
}

// Only re-evaluates when the ORIGINAL outcome was POSSIBLE_NEW_SKILL or
// INSUFFICIENT_INFORMATION (Section 20/21's own scope: professional
// review REFINES an uncertain blind result, it does not arbitrarily
// override a confident one). Any other original outcome is returned
// unchanged, with an empty findings list and an explanatory reason.
export function computeReviewedComparison(
  extraction: ProfessionalLearningExtraction,
  originalOutcome: ProfessionalLearningComparisonOutcome,
  relationships: readonly ReferenceDependencyRelationship[],
  registry: readonly ProfessionalSkillDefinitionRecord[],
): ReviewedComparisonResult {
  if (originalOutcome !== "POSSIBLE_NEW_SKILL" && originalOutcome !== "INSUFFICIENT_INFORMATION") {
    return { outcome: originalOutcome, comparedSkillId: null, findings: [], reason: "Original comparison was not uncertain -- reviewed comparison is a no-op by design (Section 21)." };
  }

  const findings: ReviewedComparisonSkillFinding[] = [];
  for (const skill of registry) {
    const parameterEvidence = findParameterEvidence(extraction, skill);
    const capabilityEvidence = findCapabilityEvidence(relationships, skill);
    if (parameterEvidence.length > 0 || capabilityEvidence.length > 0) {
      findings.push({ skillId: skill.skillId, parameterEvidence, capabilityEvidence });
    }
  }

  if (findings.length === 0) {
    return { outcome: originalOutcome, comparedSkillId: null, findings: [], reason: "No registry skill's parameters or capabilities are supported by the professionally reviewed evidence." };
  }

  const evidenceCount = (f: ReviewedComparisonSkillFinding) => f.parameterEvidence.length + f.capabilityEvidence.length;
  const maxCount = Math.max(...findings.map(evidenceCount));
  const topFindings = findings.filter((f) => evidenceCount(f) === maxCount);

  // GENUINE TIE (Section 29/47): more than one registry skill is equally
  // well supported by the same reviewed evidence -- this registry
  // apparently models a family of closely related skills (e.g. a
  // composite skill and its own phase-level siblings) that legitimately
  // share the same fixed parameter and capability tags. Forcing a single
  // comparedSkillId here would invent a precision the evidence does not
  // support (exactly the "Do not force YES" rule this stage's task
  // states explicitly) -- reported honestly as EVIDENCE_FOR_EXISTING
  // with comparedSkillId left null, naming every tied candidate.
  if (topFindings.length > 1) {
    return {
      outcome: "EVIDENCE_FOR_EXISTING",
      comparedSkillId: null,
      findings,
      reason: `Reviewed evidence equally supports ${topFindings.length} registry skills (${topFindings.map((f) => f.skillId).join(", ")}) -- insufficient to uniquely identify one without further professional clarification (e.g. which zone/phase this evidence belongs to).`,
    };
  }

  const best = topFindings[0];
  const outcome: ProfessionalLearningComparisonOutcome = best.parameterEvidence.length > 0 && best.capabilityEvidence.length > 0 ? "VARIATION_OF_EXISTING" : "EVIDENCE_FOR_EXISTING";

  return {
    outcome,
    comparedSkillId: best.skillId,
    findings,
    reason:
      outcome === "VARIATION_OF_EXISTING"
        ? `Reviewed evidence uniquely matches both a declared parameter and a declared capability of ${best.skillId}.`
        : `Reviewed evidence uniquely matches ${best.parameterEvidence.length > 0 ? "a declared parameter" : "a declared capability"} of ${best.skillId}, but not both.`,
  };
}
