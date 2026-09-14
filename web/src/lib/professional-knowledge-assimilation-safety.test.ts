import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { decomposeApprovedSource } from "@/lib/professional-knowledge-decomposition";
import { buildKnowledgeAssimilationProposal } from "@/lib/professional-knowledge-assimilation-proposal";
import { compareKnowledgeUnitAgainstRegistry } from "@/lib/professional-knowledge-registry-comparison";
import type { ApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { planLongVideoWindows } from "@/lib/professional-learning-video-long-window-planner";
import { reconcileLongVideoWindows } from "@/lib/professional-learning-video-cross-window-reconciliation";
import { buildProceduralCandidate } from "@/lib/professional-learning-video-procedural-candidate";
import type { ProfessionalLearningExtractorOutput } from "@/lib/professional-learning-extractor";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- ANTI-
// TEMPLATE + PROFESSIONAL SAFETY TESTS (Section 66/67). No I/O, no
// database, no AI calls. Covers the invariants not already exercised by
// professional-knowledge-decomposition.test.ts /
// -registry-comparison.test.ts / -approved-source.test.ts.

function raw(actionCandidates: { timeStartSeconds: number; timeEndSeconds: number; kind: string }[]): ProfessionalLearningExtractorOutput {
  return { discernment: { category: "PROFESSIONAL_TECHNIQUE", reason: "test" }, extraction: {}, comparisonSkillIdHint: null, relatedSkillIdHints: [], actionCandidates };
}

function buildSyntheticSource(approvedResultHash = "fixed-test-hash"): ApprovedKnowledgeSource {
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
    approvedResultHash,
    reviewId: "review-1",
    reviewStatus: "PROFESSIONALLY_VALIDATED",
    windows: plan.windows,
    reconciliation,
    proceduralCandidate,
    rawResultsByWindowId,
  };
}

describe("professional-knowledge assimilation -- anti-template + professional safety (Section 66/67)", () => {
  it("6/40: changing the approved source's own result hash changes every knowledge unit id and the proposal's canonical hash", () => {
    const decompA = decomposeApprovedSource(buildSyntheticSource("hash-A"), "assim-v1");
    const decompB = decomposeApprovedSource(buildSyntheticSource("hash-B"), "assim-v1");
    const idsA = new Set(decompA.knowledgeUnits.map((u) => u.id));
    for (const unit of decompB.knowledgeUnits) expect(idsA.has(unit.id)).toBe(false);

    const proposalA = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition: decompA, registry: [] });
    const proposalB = buildKnowledgeAssimilationProposal({ proposalVersion: "p-v1", decomposition: decompB, registry: [] });
    expect(proposalA.canonicalHash).not.toBe(proposalB.canonicalHash);
  });

  it("11/12: PROCEDURE != SKILL, LOOK/HAIRCUT NAME != SKILL -- decomposition never produces a compiled skill/haircut-template object of any kind", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    // Structural proof: the decomposition's own shape has no field that
    // could hold a compiled SkillDefinition/ExecutionPlan/haircut template.
    expect(Object.keys(decomposition)).toEqual(["approvedSourceEvidenceId", "reviewId", "approvedResultHash", "assimilationVersion", "knowledgeUnits", "nonReusableObservations", "procedureSpecificSequence", "knownGaps"]);
  });

  it("32/56: a knowledge unit's own free-text `label`/provider technique text is never read by registry comparison (behaviorally confirmed)", () => {
    // Behavioral confirmation: two structurally-identical units differing
    // ONLY in their label produce the identical comparison outcome. This
    // is the authoritative proof (a comment-text grep would false-positive
    // on this very file's own documentation of the rule).
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const unit = decomposition.knowledgeUnits[0];
    const relabeled = { ...unit, label: "Completely different haircut name that does not exist in any registry" };
    const originalResult = compareKnowledgeUnitAgainstRegistry(unit, [], []);
    const relabeledResult = compareKnowledgeUnitAgainstRegistry(relabeled, [], []);
    expect(relabeledResult.outcome).toBe(originalResult.outcome);
  });

  it("21/24/25/26: this stage never fabricates COMPLETION_RULE, STATE_TRANSITION, PARAMETERIZATION, or NEGATIVE_CONSTRAINT units from evidence that does not genuinely support them", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const types = new Set(decomposition.knowledgeUnits.map((u) => u.type));
    // This synthetic source has no completion/state/parameter/negative
    // evidence at all -- none of those types may appear.
    expect(types.has("COMPLETION_RULE")).toBe(false);
    expect(types.has("STATE_TRANSITION")).toBe(false);
    expect(types.has("PARAMETERIZATION")).toBe(false);
    expect(types.has("NEGATIVE_CONSTRAINT")).toBe(false);
  });

  it("45: evidenceSupport is always one of the fixed categorical states -- never a numeric confidence value", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    const allowed = ["SUPPORTED", "PARTIALLY_SUPPORTED", "INSUFFICIENT", "CONFLICTED", "UNKNOWN"];
    for (const unit of decomposition.knowledgeUnits) {
      expect(typeof unit.evidenceSupport).toBe("string");
      expect(allowed).toContain(unit.evidenceSupport);
    }
  });

  it("42/54/55: every knowledge unit carries full lineage back to the approved source and stays domain-open (never hardcoded to a single vertical value elsewhere in the type)", () => {
    const decomposition = decomposeApprovedSource(buildSyntheticSource(), "assim-v1");
    for (const unit of decomposition.knowledgeUnits) {
      expect(unit.sourceEvidenceId).toBe("ev-1");
      expect(unit.reviewId).toBe("review-1");
      expect(unit.approvedResultHash).toBe("fixed-test-hash");
      expect(typeof unit.domain).toBe("string");
    }
  });

  it("42/44/46/72/73: this module set never imports Prisma or any registry/review/draft mutation function (structural, grep-verified)", () => {
    const files = [
      "professional-knowledge-unit.ts",
      "professional-knowledge-approved-source.ts",
      "professional-knowledge-decomposition.ts",
      "professional-knowledge-registry-comparison.ts",
      "professional-knowledge-assimilation-proposal.ts",
    ];
    // Precise, Prisma/repository-scoped patterns -- deliberately NOT a
    // bare `.create(`/`.update(` (which would false-positive on the
    // legitimate Node crypto API's own createHash(...).update(...) calls
    // these files genuinely use for deterministic hashing).
    const forbidden = [
      /from ["']@\/lib\/prisma["']/,
      /\bprisma\./,
      /createReview\(/,
      /createDraft\(/,
      /createCorrectionDraft\(/,
      /professionalSkillDefinition\.(create|update|upsert|delete)/,
      /professionalLearningReview\.(create|update|upsert|delete)/,
      /professionalLearningDraft\.(create|update|upsert|delete)/,
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      for (const pattern of forbidden) expect(source).not.toMatch(pattern);
    }
  });
});
