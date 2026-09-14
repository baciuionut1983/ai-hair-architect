import { createHash } from "crypto";

import type { ProfessionalLearningExtraction } from "@/lib/professional-learning-draft-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 --
// PROFESSIONAL KNOWLEDGE UNIT. Pure, no I/O, no database, ZERO AI calls.
//
// A ProfessionalKnowledgeUnit is a CANDIDATE for reusable professional
// knowledge, decomposed from an already-frozen, already-professionally-
// reviewed video learning result (professional-knowledge-approved-source.ts).
// It is NOT a SkillDefinition, NOT an ExecutionPlan/AtomicAction, NOT a
// ProfessionalLearningDraft. It is the smallest unit this stage's
// assimilation pipeline reasons about before comparing against the
// registry (professional-knowledge-registry-comparison.ts) and assembling
// a proposal (professional-knowledge-assimilation-proposal.ts).
//
// PROCEDURE != SKILL, ACTION != SKILL, PARAMETER != SKILL (this stage's
// own absolute rules): a knowledge unit represents ONE candidate
// transformation/capability/relationship/rule -- never a whole 11-minute
// procedure, never a single raw action instance promoted directly, and
// never a bare parameter value standing in for a skill.

export const KNOWLEDGE_UNIT_TYPES = [
  "EXECUTION_CAPABILITY",
  "PARAMETERIZATION",
  "REFERENCE_RELATIONSHIP",
  "VALIDATION_RULE",
  "COMPLETION_RULE",
  "STATE_TRANSITION",
  "NEGATIVE_CONSTRAINT",
  "NON_REUSABLE_OBSERVATION",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type KnowledgeUnitType = (typeof KNOWLEDGE_UNIT_TYPES)[number];

export function isKnowledgeUnitType(value: unknown): value is KnowledgeUnitType {
  return typeof value === "string" && (KNOWLEDGE_UNIT_TYPES as readonly string[]).includes(value);
}

// Categorical, never a fabricated numeric confidence (Section 45 -- "no
// arbitrary 0.87-style values"). SUPPORTED/PARTIALLY_SUPPORTED/INSUFFICIENT/
// CONFLICTED/UNKNOWN mirror the categorical-evidence-state vocabulary
// already established across L4/L5 (e.g. CORE_CHAIN_SUPPORT_LEVELS).
export const EVIDENCE_SUPPORT_LEVELS = ["SUPPORTED", "PARTIALLY_SUPPORTED", "INSUFFICIENT", "CONFLICTED", "UNKNOWN"] as const;
export type EvidenceSupportLevel = (typeof EVIDENCE_SUPPORT_LEVELS)[number];

export interface KnowledgeUnitSourceInterval {
  readonly timeStartSeconds: number;
  readonly timeEndSeconds: number;
}

// WHY DOES THE BRAIN BELIEVE THIS? (Section 42/81.57) -- every unit
// carries its own full lineage back to the approved source, never a bare
// pointer to "the video."
export interface ProfessionalKnowledgeUnit {
  readonly id: string;
  readonly type: KnowledgeUnitType;
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly assimilationVersion: string;
  // Open string, cross-vertical (Section 54) -- never hardcoded to hair.
  readonly domain: string;
  // Descriptive ONLY (Section 32/81.9's "no provider label as authority")
  // -- never used as an identity key, a registry-matching key, or any
  // decision input. Safe to show a human reviewer; never trusted by code.
  readonly label: string;
  readonly sourceIntervals: readonly KnowledgeUnitSourceInterval[];
  readonly supportingActionCandidateIds: readonly string[];
  // Repetition as SUPPORT, never as a new-skill multiplier (Section 19):
  // 13 cutting actions contribute to ONE unit's occurrenceCount, they do
  // not create 13 units or imply 13 skills.
  readonly occurrenceCount: number;
  // Reuses the EXISTING closed extraction field vocabulary
  // (professional-learning-draft-validators.ts) for any technical
  // parameter this unit carries (elevation/distribution/overdirection/
  // sectioning/tool/...) -- each field keeps its OWN original provenance
  // (Section 43: professional approval never flattens history to
  // PROFESSIONAL_INPUT). Empty when nothing field-level was ever
  // corrected/asserted for this unit -- UNKNOWN is valid (Section 13).
  readonly knownFields: ProfessionalLearningExtraction;
  // Populated only for type REFERENCE_RELATIONSHIP -- the underlying
  // ReferenceDependencyRelationship id(s) this unit represents.
  readonly referenceRelationshipIds: readonly string[];
  readonly evidenceSupport: EvidenceSupportLevel;
  readonly note?: string;
}

// Deterministic identity (Section 14): same approved source + same
// capability/type + same discriminator (e.g. action kind + window index,
// or a relationship id) + same assimilation algorithm version always
// yields the same id. Never random.
export function computeKnowledgeUnitId(
  sourceEvidenceId: string,
  reviewId: string,
  approvedResultHash: string,
  type: KnowledgeUnitType,
  discriminator: string,
  assimilationVersion: string,
): string {
  const canonical = `${sourceEvidenceId}|${reviewId}|${approvedResultHash}|${type}|${discriminator}|${assimilationVersion}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
