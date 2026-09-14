import { createHash } from "crypto";

import type { ProcedureKnowledgeDecomposition } from "@/lib/professional-knowledge-decomposition";
import { compareKnowledgeUnitAgainstRegistry, computeRegistryContextHash, type KnowledgeUnitComparisonResult } from "@/lib/professional-knowledge-registry-comparison";
import type { BoundClaim } from "@/lib/professional-knowledge-claim-binding";
import type { ReferenceDependencyRelationship } from "@/lib/professional-learning-reference-dependency";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 --
// PROFESSIONAL KNOWLEDGE ASSIMILATION PROPOSAL. Pure, no I/O, no
// database, ZERO AI calls, ZERO registry writes.
//
// PROPOSAL ONLY (Section 46/47): this is never persisted as active
// knowledge in this stage -- no migration, no DB row, no registry write.
// Status is always DRAFT_PENDING_PROFESSIONAL_APPROVAL -- never ACTIVE,
// APPROVED, LEARNED, or PROMOTED (Section 47's own explicit exclusion
// list). A future, separately-authorized stage is the only place this
// status may ever change.

export const KNOWLEDGE_ASSIMILATION_PROPOSAL_STATUSES = ["DRAFT_PENDING_PROFESSIONAL_APPROVAL"] as const;
export type KnowledgeAssimilationProposalStatus = (typeof KNOWLEDGE_ASSIMILATION_PROPOSAL_STATUSES)[number];

export interface ProfessionalKnowledgeAssimilationProposal {
  readonly proposalVersion: string;
  readonly status: KnowledgeAssimilationProposalStatus;
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly createdFromExtractionVersion: string;
  readonly registryContextHash: string;
  readonly knowledgeUnits: ProcedureKnowledgeDecomposition["knowledgeUnits"];
  readonly registryComparisons: readonly KnowledgeUnitComparisonResult[];
  readonly procedureSpecificSequence: ProcedureKnowledgeDecomposition["procedureSpecificSequence"];
  readonly knownGaps: ProcedureKnowledgeDecomposition["knownGaps"];
  readonly nonReusableItems: ProcedureKnowledgeDecomposition["nonReusableObservations"];
  readonly proposedEvidenceAttachments: readonly KnowledgeUnitComparisonResult[];
  readonly proposedVariations: readonly KnowledgeUnitComparisonResult[];
  readonly proposedExtensions: readonly KnowledgeUnitComparisonResult[];
  readonly possibleConflicts: readonly KnowledgeUnitComparisonResult[];
  readonly proposedNewSkills: readonly KnowledgeUnitComparisonResult[];
  readonly insufficientItems: readonly KnowledgeUnitComparisonResult[];
  readonly provenance: "PROFESSIONAL_INPUT_APPROVED_SOURCE";
  readonly canonicalHash: string;
}

export interface BuildKnowledgeAssimilationProposalInput {
  readonly proposalVersion: string;
  readonly decomposition: ProcedureKnowledgeDecomposition;
  readonly registry: readonly ProfessionalSkillDefinitionRecord[];
  // Relationships associated with each knowledge unit, keyed by unit id --
  // populated only for REFERENCE_RELATIONSHIP-type units (see
  // professional-knowledge-decomposition.ts). Absent/empty for every other
  // unit type.
  readonly relationshipsByUnitId?: ReadonlyMap<string, readonly ReferenceDependencyRelationship[]>;
  // Stage 8.5L5.R3.1 (Section 30/31): PROFESSIONALLY_CONFIRMED claim
  // bindings for each knowledge unit, keyed by unit id -- optional,
  // additive. Absent entirely reproduces L5.R3's own original behavior
  // byte-for-byte (registry comparison never sees confirmed claims it
  // was not given).
  readonly confirmedClaimsByUnitId?: ReadonlyMap<string, readonly BoundClaim[]>;
}

function computeCanonicalHash(proposalWithoutHash: Omit<ProfessionalKnowledgeAssimilationProposal, "canonicalHash">): string {
  return createHash("sha256").update(JSON.stringify(proposalWithoutHash), "utf8").digest("hex");
}

export function buildKnowledgeAssimilationProposal(input: BuildKnowledgeAssimilationProposalInput): ProfessionalKnowledgeAssimilationProposal {
  const { proposalVersion, decomposition, registry, relationshipsByUnitId, confirmedClaimsByUnitId } = input;
  const registryContextHash = computeRegistryContextHash(registry);

  const registryComparisons = decomposition.knowledgeUnits.map((unit) =>
    compareKnowledgeUnitAgainstRegistry(unit, relationshipsByUnitId?.get(unit.id) ?? [], registry, confirmedClaimsByUnitId?.get(unit.id) ?? []),
  );

  const byOutcome = (outcome: KnowledgeUnitComparisonResult["outcome"]) => registryComparisons.filter((c) => c.outcome === outcome);

  const withoutHash: Omit<ProfessionalKnowledgeAssimilationProposal, "canonicalHash"> = {
    proposalVersion,
    status: "DRAFT_PENDING_PROFESSIONAL_APPROVAL",
    sourceEvidenceId: decomposition.approvedSourceEvidenceId,
    reviewId: decomposition.reviewId,
    approvedResultHash: decomposition.approvedResultHash,
    createdFromExtractionVersion: decomposition.assimilationVersion,
    registryContextHash,
    knowledgeUnits: decomposition.knowledgeUnits,
    registryComparisons,
    procedureSpecificSequence: decomposition.procedureSpecificSequence,
    knownGaps: decomposition.knownGaps,
    nonReusableItems: decomposition.nonReusableObservations,
    proposedEvidenceAttachments: byOutcome("ATTACH_EVIDENCE_TO_EXISTING"),
    proposedVariations: byOutcome("PROPOSE_VARIATION_OF_EXISTING"),
    proposedExtensions: byOutcome("PROPOSE_EXTENSION_OF_EXISTING"),
    possibleConflicts: byOutcome("POSSIBLE_CONFLICT_WITH_EXISTING"),
    proposedNewSkills: byOutcome("PROPOSE_NEW_REUSABLE_SKILL"),
    insufficientItems: byOutcome("INSUFFICIENT_FOR_ASSIMILATION"),
    provenance: "PROFESSIONAL_INPUT_APPROVED_SOURCE",
  };

  return { ...withoutHash, canonicalHash: computeCanonicalHash(withoutHash) };
}
