import { describe, expect, it } from "vitest";

import { bindClaimsForApprovedSource, bindClaimsForKnowledgeUnit, detectSupportModality } from "@/lib/professional-knowledge-claim-binding";
import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import type { ApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { planLongVideoWindows } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.1 -- pure
// claim-binding tests, no I/O, no database, no AI calls. Section 61
// requires a fictitious NON-HAIR fixture too -- see the last describe
// block.

function raw(
  actionCandidates: { timeStartSeconds: number; timeEndSeconds: number; kind: string }[],
  extraction: ProfessionalLearningExtractorOutput["extraction"] = {},
): ProfessionalLearningExtractorOutput {
  return { discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" }, extraction, comparisonSkillIdHint: null, relatedSkillIdHints: [], actionCandidates };
}

function buildSyntheticSource(): ApprovedKnowledgeSource {
  const plan = planLongVideoWindows({ sourceEvidenceId: "ev-1", totalDurationSeconds: 60, windowCount: 2, contextMarginSeconds: 5, segmentationVersion: "test-v1" });

  const window0Raw = raw([{ timeStartSeconds: 5, timeEndSeconds: 8, kind: "CUTTING_ACTION" }], {
    guideType: { value: "mobile guide", source: "INFERRED", note: "Voiceover states the previous section is used as a mobile guide." },
    elevation: { value: "low to progressively higher elevation", source: "INFERRED", note: "Voiceover notes lifting progressively." },
    sectioning: { value: "center parting", source: "OBSERVED", note: "White comb visible sectioning hair." },
    tool: { value: "scissors", source: "OBSERVED" }, // no theme maps to "tool" -- must stay NOT_REVIEWED
    cuttingAngle: { value: null, source: "UNKNOWN" }, // must never become a claim
  });
  // Window 1's context starts at 25 -> relative 10 => absolute 35.
  const window1Raw = raw([{ timeStartSeconds: 10, timeEndSeconds: 12, kind: "CUTTING_ACTION" }], {
    guideType: { value: "Stationary guideline", source: "OBSERVED", note: "Visible fixed reference strand." },
  });

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

describe("professional-knowledge-claim-binding: detectSupportModality", () => {
  it("Section 19: detects AUDIO_NARRATION, VISUAL, MIXED, and UNRESOLVED strictly from textual signals", () => {
    expect(detectSupportModality("Voiceover states the technique.")).toBe("AUDIO_NARRATION");
    expect(detectSupportModality("White comb clearly visible in frame.")).toBe("VISUAL");
    expect(detectSupportModality("Voiceover explains while the shears are visible.")).toBe("MIXED");
    expect(detectSupportModality("A plain claim with no modality signal.")).toBe("UNRESOLVED");
    expect(detectSupportModality(undefined)).toBe("UNRESOLVED");
  });
});

describe("professional-knowledge-claim-binding: bindClaimsForKnowledgeUnit", () => {
  it("Section 6/7: original provenance is NEVER rewritten -- INFERRED stays INFERRED, OBSERVED stays OBSERVED", () => {
    const source = buildSyntheticSource();
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const window0Unit = decomposition.knowledgeUnits.find((u) => u.type === "EXECUTION_CAPABILITY" && u.label.includes("window 0"))!;
    const binding = bindClaimsForKnowledgeUnit(window0Unit, source, ["mobile_guide", "progressive_elevation"], "assim-v1");

    const guideClaim = binding.claims.find((c) => c.fieldName === "guideType");
    expect(guideClaim?.originalProvenance).toBe("INFERRED");
    const sectioningClaim = binding.claims.find((c) => c.fieldName === "sectioning");
    expect(sectioningClaim?.originalProvenance).toBe("OBSERVED");
    // Never PROFESSIONAL_INPUT -- a review confirmation is not a correction.
    for (const claim of binding.claims) expect(claim.originalProvenance).not.toBe("PROFESSIONAL_INPUT");
  });

  it("Section 12: mobile_guide confirms window 0's guideType, and does NOT cross-confirm window 1's stationary guideline", () => {
    const source = buildSyntheticSource();
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const window0Unit = decomposition.knowledgeUnits.find((u) => u.label.includes("window 0"))!;
    const window1Unit = decomposition.knowledgeUnits.find((u) => u.label.includes("window 1"))!;

    const binding0 = bindClaimsForKnowledgeUnit(window0Unit, source, ["mobile_guide", "stationary_guide"], "assim-v1");
    const binding1 = bindClaimsForKnowledgeUnit(window1Unit, source, ["mobile_guide", "stationary_guide"], "assim-v1");

    const guide0 = binding0.claims.find((c) => c.fieldName === "guideType");
    expect(guide0?.reviewConfirmation).toBe("PROFESSIONALLY_CONFIRMED");
    expect(guide0?.confirmedByTheme).toBe("mobile_guide");

    const guide1 = binding1.claims.find((c) => c.fieldName === "guideType");
    expect(guide1?.reviewConfirmation).toBe("PROFESSIONALLY_CONFIRMED");
    expect(guide1?.confirmedByTheme).toBe("stationary_guide");
  });

  it("Section 16: a field with no matching confirmed theme stays NOT_REVIEWED -- neighboring fields are never filled", () => {
    const source = buildSyntheticSource();
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const window0Unit = decomposition.knowledgeUnits.find((u) => u.label.includes("window 0"))!;
    const binding = bindClaimsForKnowledgeUnit(window0Unit, source, ["mobile_guide"], "assim-v1"); // elevation/sectioning theme NOT supplied

    const toolClaim = binding.claims.find((c) => c.fieldName === "tool");
    expect(toolClaim?.reviewConfirmation).toBe("NOT_REVIEWED");
    const elevationClaim = binding.claims.find((c) => c.fieldName === "elevation");
    expect(elevationClaim?.reviewConfirmation).toBe("NOT_REVIEWED");
  });

  it("Section 8/16: a genuinely UNKNOWN field never becomes a claim at all (no fabrication)", () => {
    const source = buildSyntheticSource();
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const window0Unit = decomposition.knowledgeUnits.find((u) => u.label.includes("window 0"))!;
    const binding = bindClaimsForKnowledgeUnit(window0Unit, source, [], "assim-v1");
    expect(binding.claims.find((c) => c.fieldName === "cuttingAngle")).toBeUndefined();
  });

  it("Section 20/26: a reference-relationship unit's claim preserves the observation text and NEVER upgrades `established`", () => {
    const plan = planLongVideoWindows({ sourceEvidenceId: "ev-1", totalDurationSeconds: 30, windowCount: 1, contextMarginSeconds: 5, segmentationVersion: "test-v1" });
    const rawWithObservation: ProfessionalLearningExtractorOutput = {
      discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" },
      extraction: {},
      comparisonSkillIdHint: null,
      relatedSkillIdHints: [],
      temporalObservations: [{ timeStartSeconds: 5, timeEndSeconds: 6, observation: "Stylist cuts the strand using the previous reference guide." }],
    };
    const rawResultsByWindowId = new Map([[plan.windows[0].id, rawWithObservation]]);
    const reconciliation = reconcileLongVideoWindows(plan.sourceEvidenceId, plan.windows, rawResultsByWindowId, plan.segmentationVersion);
    const proceduralCandidate = buildProceduralCandidate({ actionCandidates: reconciliation.actionCandidates, segments: reconciliation.segments, editGaps: reconciliation.editGaps, resultObservationPresent: false, validationCandidatePresent: false });
    const source: ApprovedKnowledgeSource = {
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
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const referenceUnit = decomposition.knowledgeUnits.find((u) => u.type === "REFERENCE_RELATIONSHIP")!;
    const binding = bindClaimsForKnowledgeUnit(referenceUnit, source, [], "assim-v1");
    expect(binding.claims).toHaveLength(1);
    expect(binding.claims[0].claimType).toBe("REFERENCE_CANDIDATE");
    expect(binding.claims[0].value).toContain("previous reference guide");
    expect(binding.claims[0].note).toContain("established=false");
  });

  it("determinism: identical inputs produce identical binding and claim ids", () => {
    const source = buildSyntheticSource();
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const bindingsA = bindClaimsForApprovedSource(source, decomposition, ["mobile_guide"], "assim-v1");
    const bindingsB = bindClaimsForApprovedSource(source, decomposition, ["mobile_guide"], "assim-v1");
    expect(bindingsB.map((b) => b.id)).toEqual(bindingsA.map((b) => b.id));
    expect(bindingsB.flatMap((b) => b.claims.map((c) => c.claimId))).toEqual(bindingsA.flatMap((b) => b.claims.map((c) => c.claimId)));
  });
});

describe("professional-knowledge-claim-binding: Section 61 -- non-hair generic fixture", () => {
  it("binds an INFERRED claim + professional confirmation for a fictitious NAILS domain, preserving provenance and UNKNOWN neighbors", () => {
    const plan = planLongVideoWindows({ sourceEvidenceId: "ev-nails-1", totalDurationSeconds: 30, windowCount: 1, contextMarginSeconds: 5, segmentationVersion: "test-v1" });
    const nailsRaw = raw([{ timeStartSeconds: 5, timeEndSeconds: 8, kind: "CUTTING_ACTION" }], {
      overdirection: { value: "filed toward the free edge", source: "INFERRED", note: "Narrator mentions filing direction." },
      cuttingAngle: { value: null, source: "UNKNOWN" },
    });
    const rawResultsByWindowId = new Map([[plan.windows[0].id, nailsRaw]]);
    const reconciliation = reconcileLongVideoWindows(plan.sourceEvidenceId, plan.windows, rawResultsByWindowId, plan.segmentationVersion);
    const proceduralCandidate = buildProceduralCandidate({ actionCandidates: reconciliation.actionCandidates, segments: reconciliation.segments, editGaps: reconciliation.editGaps, resultObservationPresent: false, validationCandidatePresent: false });
    const source: ApprovedKnowledgeSource = {
      sourceEvidenceId: "ev-nails-1",
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
    const decomposition = decomposeApprovedSource(source, "assim-v1");
    const unit = decomposition.knowledgeUnits[0];
    const binding = bindClaimsForKnowledgeUnit(unit, source, ["overdirection"], "assim-v1");

    const overdirectionClaim = binding.claims.find((c) => c.fieldName === "overdirection");
    expect(overdirectionClaim?.originalProvenance).toBe("INFERRED");
    expect(overdirectionClaim?.reviewConfirmation).toBe("PROFESSIONALLY_CONFIRMED");
    expect(overdirectionClaim?.supportModality).toBe("AUDIO_NARRATION");
    expect(binding.claims.find((c) => c.fieldName === "cuttingAngle")).toBeUndefined(); // UNKNOWN neighbor never fabricated
  });
});
