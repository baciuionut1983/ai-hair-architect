import { createHash } from "crypto";

import type { ProfessionalLearningProvenanceSource } from "@/lib/professional-learning-draft-validators";
import type { BoundClaim } from "@/lib/professional-knowledge-claim-binding";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillCapabilityKind } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.2 --
// PROFESSIONAL REVIEW DECISION CAPTURE. Pure, no I/O, no database, ZERO
// AI calls, ZERO registry writes.
//
// THE GAP THIS FILE CLOSES: L5.R3.1's ClaimReviewConfirmationState
// (NOT_REVIEWED/PROFESSIONALLY_CONFIRMED/PROFESSIONALLY_CORRECTED/
// PROFESSIONALLY_REJECTED) assumes every reviewable fact starts as an AI
// claim. Ionuț's real review this stage contains a genuinely new case: a
// technique (Channel Cut) the AI extraction never mentioned at all.
// ProfessionalReviewDecision is the smallest wrapper that represents
// CONFIRMATION/CORRECTION (wrapping an existing BoundClaim) and ADDITION
// (no BoundClaim -- `originalAIClaim: null`) uniformly, while keeping
// `professionalValue`/`originalAIClaim` structurally distinct so neither
// can ever be confused with the other, and so a reader can always answer
// "did the AI see this, or did the professional teach it?"
//
// CONTEXTUAL PREFERENCE != UNIVERSAL RULE (the stage's own absolute
// rule): ContextualPreferenceRelation and UniversalRuleRelation are TWO
// SEPARATE, NON-OVERLAPPING enums -- a contextual-knowledge claim can
// structurally only ever use the first, so "commonly used for short
// hair" can never collapse into "required for short hair" by construction,
// not just by convention.

export const PROFESSIONAL_DECISION_TYPES = ["CONFIRMATION", "CORRECTION", "ADDITION"] as const;
export type ProfessionalDecisionType = (typeof PROFESSIONAL_DECISION_TYPES)[number];

export function isProfessionalDecisionType(value: unknown): value is ProfessionalDecisionType {
  return typeof value === "string" && (PROFESSIONAL_DECISION_TYPES as readonly string[]).includes(value);
}

// Section "NON-NEGOTIABLE SEMANTIC RULE": contextual/preference language
// only -- never REQUIRED/PROHIBITED/ALWAYS/NEVER.
export const CONTEXTUAL_PREFERENCE_RELATIONS = ["COMMONLY_USED_FOR", "TYPICALLY_USED_FOR", "PREFERRED_IN_CONTEXT", "COMPATIBLE_WITH", "ALTERNATIVE_TO", "MAY_BE_USED_FOR"] as const;
export type ContextualPreferenceRelation = (typeof CONTEXTUAL_PREFERENCE_RELATIONS)[number];

export function isContextualPreferenceRelation(value: unknown): value is ContextualPreferenceRelation {
  return typeof value === "string" && (CONTEXTUAL_PREFERENCE_RELATIONS as readonly string[]).includes(value);
}

// Deliberately a SEPARATE type from ContextualPreferenceRelation -- kept
// here only so ContextualKnowledgeClaim.relation's type can never widen to
// include one of these values by an incautious future edit (Section
// "CONTEXTUAL KNOWLEDGE MODEL"). Nothing in this file ever constructs a
// value of this type; it exists purely as the guard-rail that proves the
// two vocabularies are structurally distinct (see
// professional-knowledge-review-decision.test.ts's own type-level check).
export const UNIVERSAL_RULE_RELATIONS = ["REQUIRED", "PROHIBITED", "ALWAYS", "NEVER"] as const;
export type UniversalRuleRelation = (typeof UNIVERSAL_RULE_RELATIONS)[number];

export interface ContextualKnowledgeClaim {
  readonly relation: ContextualPreferenceRelation;
  readonly subject: string;
  readonly note: string;
}

// A technique identity is intentionally NOT a rigid taxonomy row in a new
// registry table (the task's own "do not prematurely hard-code" caution)
// -- it is a small, optional, generic descriptor a decision MAY carry.
// `distinctFrom` is the structural mechanism that prevents two genuinely
// different techniques from ever being silently aliased (Section "DO NOT
// merge Deep Point Cut into Slice-and-Slide").
export interface TechniqueIdentity {
  readonly techniqueId: string;
  readonly label: string;
  readonly familyId?: string;
  readonly relatedTechniqueIds?: readonly string[];
  readonly distinctFrom?: readonly string[];
}

export interface SourceInterval {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
  // Section "#13": a professional addition may bind to an approximate
  // interval the professional recalls, never a precisely AI-detected one
  // -- this flag keeps that distinction visible rather than presenting an
  // estimated interval as if it were extraction-grade.
  readonly estimatedByProfessional: boolean;
}

export interface ProfessionalReviewDecision {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  // Anchors this decision back to Ionuț's own numbered review item (e.g.
  // "#2", "#13") -- purely for human traceability, never used in any
  // matching/comparison logic.
  readonly reviewItemLabel: string;
  readonly decisionType: ProfessionalDecisionType;
  // Populated for CONFIRMATION/CORRECTION -- the BoundClaim this decision
  // is about. Null for ADDITION (Section "#13": no AI claim exists at all).
  readonly boundClaimId: string | null;
  // Null means the AI made NO corresponding claim (Section "#13"'s
  // `originalAIClaim: NONE`) -- never fabricated to fill this field.
  readonly originalAIClaim: { readonly value: unknown; readonly provenance: ProfessionalLearningProvenanceSource } | null;
  readonly professionalValue: string;
  readonly professionalNote: string;
  readonly technique?: TechniqueIdentity;
  // Explicit list of technical facts this decision DOES establish --
  // free-text labels, never invented numeric values.
  readonly knownFields: readonly string[];
  // Explicit list of what remains UNKNOWN even after this decision
  // (Section "UNKNOWN POLICY") -- never silently omitted.
  readonly unknownFields: readonly string[];
  readonly contextualKnowledge: readonly ContextualKnowledgeClaim[];
  readonly sourceIntervals: readonly SourceInterval[];
}

export function computeProfessionalReviewDecisionId(sourceEvidenceId: string, approvedResultHash: string, reviewItemLabel: string, professionalValue: string): string {
  return createHash("sha256").update(`${sourceEvidenceId}|${approvedResultHash}|${reviewItemLabel}|${professionalValue}`, "utf8").digest("hex");
}

export interface BuildProfessionalReviewDecisionInput {
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly reviewItemLabel: string;
  readonly decisionType: ProfessionalDecisionType;
  readonly boundClaim?: BoundClaim | null;
  readonly professionalValue: string;
  readonly professionalNote: string;
  readonly technique?: TechniqueIdentity;
  readonly knownFields?: readonly string[];
  readonly unknownFields?: readonly string[];
  readonly contextualKnowledge?: readonly ContextualKnowledgeClaim[];
  readonly sourceIntervals?: readonly SourceInterval[];
}

// A CONFIRMATION/CORRECTION with no boundClaim, or an ADDITION WITH one,
// is a caller error -- fails closed rather than silently accepting a
// contradictory shape (Section "PROVENANCE REQUIREMENT").
export function buildProfessionalReviewDecision(input: BuildProfessionalReviewDecisionInput): ProfessionalReviewDecision {
  const hasBoundClaim = Boolean(input.boundClaim);
  if (input.decisionType === "ADDITION" && hasBoundClaim) {
    throw new Error("An ADDITION decision must not wrap an existing BoundClaim -- the AI made no claim to correct/confirm.");
  }
  if (input.decisionType !== "ADDITION" && !hasBoundClaim) {
    throw new Error(`A ${input.decisionType} decision requires an existing BoundClaim to confirm/correct.`);
  }

  return {
    id: computeProfessionalReviewDecisionId(input.sourceEvidenceId, input.approvedResultHash, input.reviewItemLabel, input.professionalValue),
    sourceEvidenceId: input.sourceEvidenceId,
    reviewId: input.reviewId,
    approvedResultHash: input.approvedResultHash,
    reviewItemLabel: input.reviewItemLabel,
    decisionType: input.decisionType,
    boundClaimId: input.boundClaim?.claimId ?? null,
    originalAIClaim: input.boundClaim ? { value: input.boundClaim.value, provenance: input.boundClaim.originalProvenance } : null,
    professionalValue: input.professionalValue,
    professionalNote: input.professionalNote,
    technique: input.technique,
    knownFields: input.knownFields ?? [],
    unknownFields: input.unknownFields ?? [],
    contextualKnowledge: input.contextualKnowledge ?? [],
    sourceIntervals: input.sourceIntervals ?? [],
  };
}

// ---------------------------------------------------------------------
// Assimilation classification (Section "IMPLEMENTATION SCOPE"). Reuses
// SkillCapabilityKind for the ONE deterministic evidence mechanism
// available -- an explicit `impliedCapability` the caller supplies (never
// guessed from free text, same "narrow, caller-supplied, never invented"
// discipline as every other candidate-mention heuristic in this lineage).
// ---------------------------------------------------------------------

export const PROFESSIONAL_DECISION_ASSIMILATION_OUTCOMES = [
  "ATTACH_EVIDENCE_TO_EXISTING_KNOWLEDGE",
  "EXTEND_EXISTING_CAPABILITY",
  "PROPOSE_NEW_SKILL",
  "PROPOSE_TECHNIQUE_VARIANT",
  "PROPOSE_CONTEXTUAL_PREFERENCE",
  "PROFESSIONAL_ADDITION_PENDING_REVIEW",
  "KEEP_UNKNOWN",
  "NO_ASSIMILATION",
] as const;
export type ProfessionalDecisionAssimilationOutcome = (typeof PROFESSIONAL_DECISION_ASSIMILATION_OUTCOMES)[number];

export interface ProfessionalDecisionAssimilationResult {
  readonly decisionId: string;
  readonly outcome: ProfessionalDecisionAssimilationOutcome;
  readonly comparedSkillId: string | null;
  readonly reason: string;
}

export interface ClassifyProfessionalDecisionInput {
  readonly decision: ProfessionalReviewDecision;
  readonly registry: readonly ProfessionalSkillDefinitionRecord[];
  // Caller-supplied, never inferred from `professionalValue`/`technique`
  // text (Section "EFFECT-BASED REASONING": similar effect != same
  // skill, so this is deliberately a single, explicit, narrow input, not
  // a lexical classifier).
  readonly impliedCapability?: SkillCapabilityKind;
}

export function classifyProfessionalDecisionAssimilation(input: ClassifyProfessionalDecisionInput): ProfessionalDecisionAssimilationResult {
  const { decision, registry, impliedCapability } = input;

  // A pure ADDITION (Section "#13") is never auto-attached anywhere --
  // zero AI corroboration exists yet, so the ONLY safe outcome is to
  // surface it for professional/architectural review.
  if (decision.decisionType === "ADDITION") {
    return { decisionId: decision.id, outcome: "PROFESSIONAL_ADDITION_PENDING_REVIEW", comparedSkillId: null, reason: "No original AI claim exists -- this is professional-taught knowledge with no prior extraction corroboration; it is surfaced for review, never auto-attached." };
  }

  // Contextual knowledge is NEVER comparison evidence, by construction
  // (Section "NON-NEGOTIABLE SEMANTIC RULE") -- a decision carrying only
  // contextual claims and no known technical fields is reported as such,
  // never silently promoted into a capability match.
  if (decision.knownFields.length === 0 && decision.contextualKnowledge.length > 0) {
    return { decisionId: decision.id, outcome: "PROPOSE_CONTEXTUAL_PREFERENCE", comparedSkillId: null, reason: "This decision carries only contextual/preference knowledge (e.g. commonly-used-for) -- never usable as a universal-rule capability match." };
  }

  if (decision.unknownFields.length > 0 && decision.knownFields.length === 0) {
    return { decisionId: decision.id, outcome: "KEEP_UNKNOWN", comparedSkillId: null, reason: "No known technical field exists yet to compare -- everything relevant remains explicitly UNKNOWN." };
  }

  if (!impliedCapability) {
    return { decisionId: decision.id, outcome: "NO_ASSIMILATION", comparedSkillId: null, reason: "No capability was supplied for structural comparison -- this decision cannot be evaluated against the registry without inventing one." };
  }

  const matches = registry.filter((skill) => (skill.payload.capabilities ?? []).some((c) => c.kind === impliedCapability));

  if (matches.length === 0) {
    // The technique carries a distinctFrom marker naming an existing
    // skill -- that skill's own fixed parameters structurally conflict
    // with this technique (e.g. Slice-and-Slide's fixed
    // controlMethod="fingers" vs Channel Cut's natural-fall control), so
    // a brand-new skill is the only structurally honest outcome, never a
    // forced variant of the excluded skill.
    if (decision.technique?.distinctFrom && decision.technique.distinctFrom.length > 0) {
      return { decisionId: decision.id, outcome: "PROPOSE_NEW_SKILL", comparedSkillId: null, reason: `No registry skill declares capability ${impliedCapability}, and this technique is explicitly distinct from ${decision.technique.distinctFrom.join(", ")} -- proposed as a new reusable skill, never merged into an incompatible existing one.` };
    }
    return { decisionId: decision.id, outcome: "KEEP_UNKNOWN", comparedSkillId: null, reason: `No registry skill declares capability ${impliedCapability} -- insufficient registry coverage to compare against.` };
  }

  if (matches.length > 1) {
    return { decisionId: decision.id, outcome: "ATTACH_EVIDENCE_TO_EXISTING_KNOWLEDGE", comparedSkillId: null, reason: `${matches.length} registry skills equally declare capability ${impliedCapability} -- insufficient to uniquely identify one.` };
  }

  const skill = matches[0];
  if (decision.technique?.distinctFrom?.includes(skill.skillId)) {
    return { decisionId: decision.id, outcome: "PROPOSE_TECHNIQUE_VARIANT", comparedSkillId: skill.skillId, reason: `${skill.skillId} shares capability ${impliedCapability} but this technique is explicitly distinct from it -- proposed as a separate, related variant, never an alias.` };
  }
  return { decisionId: decision.id, outcome: "EXTEND_EXISTING_CAPABILITY", comparedSkillId: skill.skillId, reason: `${skill.skillId} declares capability ${impliedCapability}, and no distinctness marker excludes it -- proposed as an extension of that existing capability representation.` };
}
