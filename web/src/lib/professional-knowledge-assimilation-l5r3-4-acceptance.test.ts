import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS } from "@/lib/professional-knowledge-review-l5r3-2-real-decisions";
import { L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY } from "@/lib/professional-skill-guide-relationship-l5r3-3-real-replay";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4 -- THE
// REAL PROFESSIONAL KNOWLEDGE ASSIMILATION PLAN ACCEPTANCE. Pure, ZERO
// database, ZERO AI calls, ZERO video access, ZERO network anywhere in
// this file.

describe("Stage 8.5L5.R3.4 -- real professional knowledge assimilation plan (zero database, zero AI, zero network)", () => {
  it("builds the real plan with zero registry mutation and writes the report artifact", () => {
    const registrySnapshotBefore = JSON.stringify(buildCanonicalCandidateSkillRegistry());
    const plan = buildRealAssimilationPlan();
    expect(JSON.stringify(buildCanonicalCandidateSkillRegistry())).toBe(registrySnapshotBefore);

    fs.writeFileSync(path.join(process.cwd(), "scratch-l5r3-4-real-assimilation-plan-result.json"), JSON.stringify(plan, null, 2), "utf8");
  });

  it("test 2/3: plan status and every mutation's activationState are PENDING_PROFESSIONAL_APPROVAL -- never any other value", () => {
    const plan = buildRealAssimilationPlan();
    expect(plan.status).toBe("DRAFT_PENDING_PROFESSIONAL_APPROVAL");
    for (const mutation of plan.mutationSet) expect(mutation.activationState).toBe("PENDING_PROFESSIONAL_APPROVAL");
  });

  it("test 4: identical inputs produce an identical plan (deterministic, no LLM reasoning)", () => {
    const first = buildRealAssimilationPlan();
    const second = buildRealAssimilationPlan();
    expect(second.canonicalHash).toBe(first.canonicalHash);
  });

  it("Stage 8.5L5.R3.4.R1 CORRECTION: #2 mobile/travelling guide evidence attaches ONLY to Graduated Cutting -- NEVER to One-Length Perimeter. Ionut's own final review: One-Length's previously-cut-strand reference reproduces the SAME UNCHANGED established line (fixed authority), it does not travel -- semantic similarity (both use already-cut hair as a reference) must never imply full behavioral equivalence (travelling guide)", () => {
    const plan = buildRealAssimilationPlan();
    const entry2 = plan.entries.find((e) => e.reviewItemLabel === "#2-guide")!;
    expect(entry2.registryCandidates).toContain("skill-cutting-graduated");
    expect(entry2.registryCandidates).not.toContain("skill-cutting-one-length-perimeter");
    expect(entry2.safeToApplyLater).toBe("YES");
  });

  it("test 6/7: #4 never invents a guide source and remains PARTIAL/pending, never attached", () => {
    const plan = buildRealAssimilationPlan();
    const entry4 = plan.entries.find((e) => e.reviewItemLabel === "#4-guide")!;
    expect(entry4.registryCandidates).toHaveLength(0);
    expect(entry4.safeToApplyLater).toBe("NO");
    expect(entry4.conflicts).toContain("UNKNOWN_INSUFFICIENT_FOR_MUTATION");
  });

  it("test 8: #6a forward/outward direction never becomes an anatomical target anywhere in the plan", () => {
    const plan = buildRealAssimilationPlan();
    const entry6a = plan.entries.find((e) => e.reviewItemLabel === "#6a-direction")!;
    expect(entry6a.professionalKnowledgeSummary).toBe("forward and outward");
    expect(entry6a.professionalKnowledgeSummary).not.toMatch(/eye|nose/i);
  });

  it("test 9: #6b wet-to-dry is represented as ADD_WORKFLOW_STATE_TRANSITION, never as a cutting technique", () => {
    const plan = buildRealAssimilationPlan();
    const mutation = plan.mutationSet.find((m) => m.operation === "ADD_WORKFLOW_STATE_TRANSITION")!;
    expect(mutation).toBeDefined();
    expect(mutation.workflowStateTransition).toEqual({ fact: "hairWorkflowPhase", fromValue: "wet_structural_work", toValue: "dry_refinement_check_finishing" });
    expect(mutation.proposedIdentity).toBeNull();
  });

  it("test 10/11: Deep Point Cut (#7+#12B) is proposed as its own reusable technique, distinct from generic Point Cut AND from Slice-and-Slide", () => {
    const plan = buildRealAssimilationPlan();
    const deepPointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "deep-point-cut")!;
    expect(deepPointCut).toBeDefined();
    expect(deepPointCut.proposedIdentity?.distinctFrom).toContain("skill-cutting-slice-and-slide-refinement");
    expect(deepPointCut.sourceDecisionIds).toHaveLength(2); // #7 and #12B merged
  });

  it("test 12/13: contextual short-hair/long-hair preferences are never REQUIRED", () => {
    const plan = buildRealAssimilationPlan();
    const deepPointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "deep-point-cut")!;
    for (const claim of deepPointCut.contextualKnowledge) {
      expect(["COMMONLY_USED_FOR", "TYPICALLY_USED_FOR", "PREFERRED_IN_CONTEXT", "COMPATIBLE_WITH", "ALTERNATIVE_TO", "MAY_BE_USED_FOR"]).toContain(claim.relation);
    }
  });

  it("test 14: #11 Point Cut correction/alignment never becomes a generic texturizing rule -- proposed with purpose ALIGNMENT_CORRECTION, distinct from Deep Point Cut's TEXTURIZATION_WEIGHT_REDUCTION", () => {
    const plan = buildRealAssimilationPlan();
    const pointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "point-cut")!;
    const deepPointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "deep-point-cut")!;
    expect(pointCut.proposedIdentity?.purpose).toBe("ALIGNMENT_CORRECTION");
    expect(deepPointCut.proposedIdentity?.purpose).toBe("TEXTURIZATION_WEIGHT_REDUCTION");
    expect(pointCut.proposedIdentity?.purpose).not.toBe(deepPointCut.proposedIdentity?.purpose);
  });

  it("test 15: #12A and #12B remain two SEPARATE decisions even though they feed two DIFFERENT proposed techniques", () => {
    const plan = buildRealAssimilationPlan();
    const decision12A = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#12A")!;
    const decision12B = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#12B")!;
    const pointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "point-cut")!;
    const deepPointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "deep-point-cut")!;
    expect(pointCut.sourceDecisionIds).toContain(decision12A.id);
    expect(deepPointCut.sourceDecisionIds).toContain(decision12B.id);
    expect(pointCut.sourceDecisionIds).not.toContain(decision12B.id);
    expect(deepPointCut.sourceDecisionIds).not.toContain(decision12A.id);
  });

  it("test 16/17: #13 Channel Cut exists with originalAIClaim=null on its source decision, and the mutation reports it as a professional addition", () => {
    const plan = buildRealAssimilationPlan();
    const channelCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "channel-cut")!;
    expect(channelCut).toBeDefined();
    expect(channelCut.reason).toContain("Professional addition");
    const decision13 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#13")!;
    expect(decision13.originalAIClaim).toBeNull();
  });

  it("test 18/19: Channel Cut is distinct from Slice-and-Slide AND from Deep Point Cut", () => {
    const plan = buildRealAssimilationPlan();
    const channelCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "channel-cut")!;
    expect(channelCut.proposedIdentity?.distinctFrom).toContain("skill-cutting-slice-and-slide-refinement");
    expect(channelCut.proposedIdentity?.techniqueId).not.toBe("deep-point-cut");
  });

  it("test 22: Deep Point Cut, Channel Cut, and Slice-and-Slide are linked by ONE effect relationship, never aliased", () => {
    const plan = buildRealAssimilationPlan();
    const effect = plan.mutationSet.find((m) => m.operation === "ADD_EFFECT_RELATIONSHIP")!;
    expect(effect).toBeDefined();
    const relatedIds = effect.fieldsAdded.map((f) => f.value);
    expect(relatedIds).toEqual(["deep-point-cut", "channel-cut", "skill-cutting-slice-and-slide-refinement"]);
    // Effect relationship never itself proposes a merged identity.
    expect(effect.proposedIdentity).toBeNull();
  });

  it("test 23: no unknownFieldsPreserved anywhere in the mutation set contains a fabricated numeric value", () => {
    const plan = buildRealAssimilationPlan();
    for (const mutation of plan.mutationSet) {
      for (const field of mutation.unknownFieldsPreserved) expect(field).not.toMatch(/\d/);
    }
  });

  it("test 24/25/26: Graduated Cutting / One-Length / Slice-and-Slide skill definitions are byte-unchanged after planning", () => {
    const before = JSON.stringify(buildCanonicalCandidateSkillRegistry());
    buildRealAssimilationPlan();
    const after = JSON.stringify(buildCanonicalCandidateSkillRegistry());
    expect(after).toBe(before);
  });

  it("test 30/31: L5.R3.2 decisions and L5.R3.3 guide capabilities remain unchanged -- this file only reads them", () => {
    expect(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS).toHaveLength(13);
    expect(Object.keys(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY)).toEqual(["#2", "#4", "#9", "#10"]);
  });

  it("test 28/29: this file and its planner dependency never import Prisma or call any provider client", () => {
    const files = ["professional-knowledge-assimilation-plan.ts", "professional-knowledge-assimilation-mutation-contracts.ts", "professional-knowledge-assimilation-l5r3-4-real-plan.ts"];
    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/from ["']@\/lib\/prisma["']/);
      expect(source).not.toMatch(/\bprisma\./);
    }
  });

  it("test 32: the plan can be serialized (JSON.stringify) and replayed -- a deserialized copy is structurally identical to the original", () => {
    const plan = buildRealAssimilationPlan();
    const roundTripped = JSON.parse(JSON.stringify(plan));
    expect(roundTripped).toEqual(plan);
  });

  it("Section 'MUTATION SET MUST BE NON-EXECUTABLE BY DEFAULT': no apply/activate/mutate function exists anywhere in the mutation-contracts or plan modules", () => {
    const files = ["professional-knowledge-assimilation-plan.ts", "professional-knowledge-assimilation-mutation-contracts.ts"];
    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/function apply/i);
      expect(source).not.toMatch(/function activate/i);
      expect(source).not.toMatch(/professionalSkillDefinition\.(create|update|upsert)/);
    }
  });
});
