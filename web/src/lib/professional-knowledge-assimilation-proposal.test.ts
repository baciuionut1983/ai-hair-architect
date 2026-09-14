import { describe, expect, it } from "vitest";

import { buildKnowledgeAssimilationProposal } from "@/lib/professional-knowledge-assimilation-proposal";
import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import type { ApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { planLongVideoWindows } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillDefinition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- pure
// proposal-assembly tests, no I/O, no database, no AI calls.

function raw(actionCandidates: { timeStartSeconds: number; timeEndSeconds: number; kind: string }[]): ProfessionalLearningExtractorOutput {
  return { discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" }, extraction: {}, comparisonSkillIdHint: null, relatedSkillIdHints: [], actionCandidates };
}

function buildSyntheticSource(): ApprovedKnowledgeSource {
  const plan = planLongVideoWindows({ sourceEvidenceId: "ev-1", totalDurationSeconds: 30, windowCount: 1, contextMarginSeconds: 5, segmentationVersion: "test-v1" });
  const rawResultsByWindowId = new Map([[plan.windows[0].id, raw([{ timeStartSeconds: 5, timeEndSeconds: 8, kind: "CUTTING_ACTION" }])]]);
  const reconciliation = reconcileLongVideoWindows(plan.sourceEvidenceId, plan.windows, rawResultsByWindowId, plan.segmentationVersion);
  const proceduralCandidate = buildProceduralCandidate({
    actionCandidates: reconciliation.actionCandidates,
    segments: reconciliation.segments,
    editGaps: reconciliation.editGaps,
    resultObservationPresent: false,
    validationCandidatePresent: false,
  });
  return {
    sourceEvidenceId: "ev-1",
    ownerUserId: "owner-1",
    extractionVersion: "test-v1",
    approvedResultHash: "fixed-test-hash",
    reviewId: "review-1",
    reviewStatus: "PROFESSIONALLY_VALIDATED",
    windows: plan.windows,
    reconciliation,
    proceduralCandidate,
    rawResultsByWindowId,
  };
}

function emptyRegistry(): readonly ProfessionalSkillDefinitionRecord[] {
  return [];
}

function registryWithOneSkill(): readonly ProfessionalSkillDefinitionRecord[] {
  const payload: SkillDefinition = {
    skillId: "skill-fictitious-1",
    version: 1,
    vertical: "hair_cutting",
    name: "Fictitious",
    description: "test",
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: "test",
    parameters: [],
    procedure: [
      { order: 1, instruction: "a" },
      { order: 2, instruction: "b" },
    ],
    createdAt: new Date(0).toISOString(),
  };
  return [
    {
      id: "registry-1",
      skillId: payload.skillId,
      version: payload.version,
      vertical: payload.vertical,
      name: payload.name,
      status: payload.status,
      authorityType: payload.authorityType,
      payload,
      reviewedByUserId: null,
      reviewedAt: null,
      supersededBySkillDefinitionId: null,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    },
  ];
}

describe("professional-knowledge-assimilation-proposal", () => {
  it("Section 47: status is always DRAFT_PENDING_PROFESSIONAL_APPROVAL -- never ACTIVE/APPROVED/LEARNED/PROMOTED", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const proposal = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry: emptyRegistry() });
    expect(proposal.status).toBe("DRAFT_PENDING_PROFESSIONAL_APPROVAL");
  });

  it("Section 61: determinism -- identical inputs produce an identical canonicalHash", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const first = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry: emptyRegistry() });
    const second = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry: emptyRegistry() });
    expect(second.canonicalHash).toBe(first.canonicalHash);
  });

  it("Section 61: a materially changed registry context changes the canonicalHash and the registryContextHash", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const withoutRegistry = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry: emptyRegistry() });
    const withRegistry = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry: registryWithOneSkill() });
    expect(withRegistry.canonicalHash).not.toBe(withoutRegistry.canonicalHash);
    expect(withRegistry.registryContextHash).not.toBe(withoutRegistry.registryContextHash);
  });

  it("every knowledge unit appears in exactly one outcome bucket, and buckets partition registryComparisons", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const proposal = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry: emptyRegistry() });
    const bucketed = [
      ...proposal.proposedEvidenceAttachments,
      ...proposal.proposedVariations,
      ...proposal.proposedExtensions,
      ...proposal.possibleConflicts,
      ...proposal.proposedNewSkills,
      ...proposal.insufficientItems,
    ];
    expect(bucketed).toHaveLength(proposal.registryComparisons.length);
  });

  it("Section 51: no comparison outcome ever mutates anything -- the function is pure and returns a plain object with zero side effects", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const registry = registryWithOneSkill();
    const registrySnapshotBefore = JSON.stringify(registry);
    buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition, registry });
    expect(JSON.stringify(registry)).toBe(registrySnapshotBefore);
  });
});
