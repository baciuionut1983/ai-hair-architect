import { describe, expect, it } from "vitest";

import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import type { ApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { planLongVideoWindows } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- pure
// decomposition tests, no I/O, no database, no AI calls. A synthetic
// 2-window source (window 0 core [0,30), window 1 core [30,60)) with
// hand-crafted raw provider output exercises: the relevance gate (Section
// 17), no-over-split/no-under-split grouping by (kind, window) (Section
// 15/16), unestablished reference candidates staying unestablished
// (Section 20), and procedure-specific (non-universal) ordering (Section
// 39-41).

function raw(actionCandidates: { timeStartSeconds: number; timeEndSeconds: number; kind: string }[], temporalObservations: { timeStartSeconds: number; timeEndSeconds: number; observation: string }[] = []): ProfessionalLearningExtractorOutput {
  return {
    discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" },
    extraction: {},
    comparisonSkillIdHint: null,
    relatedSkillIdHints: [],
    actionCandidates,
    temporalObservations,
  };
}

function buildSyntheticSource(): ApprovedKnowledgeSource {
  const plan = planLongVideoWindows({ sourceEvidenceId: "ev-1", totalDurationSeconds: 60, windowCount: 2, contextMarginSeconds: 5, segmentationVersion: "test-v1" });

  const window0Raw = raw(
    [
      { timeStartSeconds: 5, timeEndSeconds: 8, kind: "CUTTING_ACTION" },
      { timeStartSeconds: 10, timeEndSeconds: 13, kind: "CUTTING_ACTION" },
      { timeStartSeconds: 20, timeEndSeconds: 21, kind: "COMBING" },
    ],
    [{ timeStartSeconds: 22, timeEndSeconds: 23, observation: "Stylist cuts the strand using the previous reference guide." }],
  );
  // Window 1's context starts at 25 (core 30, margin 5) -- relative 10 -> absolute 35, relative 15 -> absolute 40.
  const window1Raw = raw([
    { timeStartSeconds: 10, timeEndSeconds: 12, kind: "CUTTING_ACTION" },
    { timeStartSeconds: 15, timeEndSeconds: 16, kind: "INSPECTION" },
  ]);

  const rawResultsByWindowId = new Map([
    [plan.windows[0].id, window0Raw],
    [plan.windows[1].id, window1Raw],
  ]);

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

describe("professional-knowledge-decomposition", () => {
  it("Section 17: COMBING is filtered as a non-reusable observation, never a knowledge unit", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    expect(decomposition.nonReusableObservations.some((o) => o.kind === "COMBING")).toBe(true);
    expect(decomposition.knowledgeUnits.some((u) => u.label.includes("COMBING"))).toBe(false);
  });

  it("Section 15: DO NOT OVER-SPLIT -- 2 repeated CUTTING_ACTION instances in the SAME window collapse into ONE unit with occurrenceCount 2", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const window0CuttingUnit = decomposition.knowledgeUnits.find((u) => u.type === "EXECUTION_CAPABILITY" && u.label.includes("window 0"));
    expect(window0CuttingUnit).toBeDefined();
    expect(window0CuttingUnit?.occurrenceCount).toBe(2);
  });

  it("Section 16: DO NOT UNDER-SPLIT -- CUTTING_ACTION in window 0 and window 1 remain TWO distinct units, never merged", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const cuttingUnits = decomposition.knowledgeUnits.filter((u) => u.type === "EXECUTION_CAPABILITY" && u.label.includes("CUTTING_ACTION"));
    expect(cuttingUnits).toHaveLength(2);
    expect(cuttingUnits[0].id).not.toBe(cuttingUnits[1].id);
  });

  it("INSPECTION action produces a VALIDATION_RULE unit, distinct from EXECUTION_CAPABILITY", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    expect(decomposition.knowledgeUnits.some((u) => u.type === "VALIDATION_RULE")).toBe(true);
  });

  it("Section 20: an unestablished reference-dependency candidate becomes a REFERENCE_RELATIONSHIP unit, but stays INSUFFICIENT (never upgraded)", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const referenceUnit = decomposition.knowledgeUnits.find((u) => u.type === "REFERENCE_RELATIONSHIP");
    expect(referenceUnit).toBeDefined();
    expect(referenceUnit?.evidenceSupport).toBe("INSUFFICIENT");
    expect(referenceUnit?.note).toContain("established=false");
  });

  it("Section 39-41: procedureSpecificSequence orders units by first occurrence and is a separate field from any universal-rule claim", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    expect(decomposition.procedureSpecificSequence.length).toBeGreaterThan(0);
    expect(decomposition.procedureSpecificSequence[0].precedingTransition).toBe("START");
  });

  it("determinism: decomposing the identical source twice yields byte-identical unit ids and counts", () => {
    const source = buildSyntheticSource();
    const first = decomposeApprovedSource(source, "assim-v1");
    const second = decomposeApprovedSource(source, "assim-v1");
    expect(second.knowledgeUnits.map((u) => u.id)).toEqual(first.knowledgeUnits.map((u) => u.id));
    expect(second.knowledgeUnits).toHaveLength(first.knowledgeUnits.length);
  });

  it("a different assimilationVersion changes every unit id (never silently collides with a prior algorithm version)", () => {
    const source = buildSyntheticSource();
    const v1 = decomposeApprovedSource(source, "assim-v1");
    const v2 = decomposeApprovedSource(source, "assim-v2");
    const v1Ids = new Set(v1.knowledgeUnits.map((u) => u.id));
    for (const unit of v2.knowledgeUnits) expect(v1Ids.has(unit.id)).toBe(false);
  });
});
