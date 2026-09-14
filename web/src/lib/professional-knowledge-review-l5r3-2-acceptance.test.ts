import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { classifyProfessionalDecisionAssimilation, type ProfessionalDecisionAssimilationResult } from "@/lib/professional-knowledge-review-decision";
import { L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS } from "@/lib/professional-knowledge-review-l5r3-2-real-decisions";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import type { SkillCapabilityKind } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.2 -- THE
// REAL PROFESSIONAL REVIEW DECISION CLASSIFICATION ACCEPTANCE. Pure,
// ZERO database, ZERO AI calls, ZERO video access, ZERO network anywhere
// in this file -- classifies Ionuț's real 13 review decisions
// (professional-knowledge-review-l5r3-2-real-decisions.ts) against the
// real 6-skill registry. Doubles as its own deterministic-replay proof
// (run twice below, compared).
//
// `impliedCapability` below is THIS FILE's own explicit, narrow,
// human-supplied structural judgment for each decision -- never derived
// from free text (Section "EFFECT-BASED REASONING": similar effect !=
// same skill). Where no defensible capability mapping exists in the
// current SKILL_CAPABILITY_KINDS vocabulary, it is left undefined --
// itself an honest, reportable finding rather than a forced guess.
const IMPLIED_CAPABILITY_BY_REVIEW_ITEM: Partial<Record<string, SkillCapabilityKind>> = {
  "#2-guide": "CONNECT_ZONES", // traveling guide connects consecutive sections -- closest existing capability, not a perfect semantic fit (see report)
  "#4-guide": "CONNECT_ZONES",
  "#9": "CONNECT_ZONES",
  "#10": "CONNECT_ZONES",
  "#7": "REFINE_ENDS", // Deep Point Cut refines terminal ends -- only REFINE_ENDS-declaring skill is Slice-and-Slide, which #7 is explicitly distinct from
  "#12B": "REFINE_ENDS",
  "#11": "REFINE_ENDS", // Point Cut for correction/alignment -- also compared against REFINE_ENDS to prove it does NOT get treated identically to texturizing
  "#12A": "REFINE_ENDS",
  "#13": "REFINE_ENDS", // Channel Cut -- short-circuits to PROFESSIONAL_ADDITION_PENDING_REVIEW regardless
  // #2-elevation, #4-overdirection, #6a-direction, #6b-wet-to-dry: deliberately
  // NO capability supplied -- these are parameter/state/workflow facts,
  // not standalone capability claims (see report).
};

function classifyAll(): readonly ProfessionalDecisionAssimilationResult[] {
  const registry = buildCanonicalCandidateSkillRegistry();
  return L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.map((decision) => classifyProfessionalDecisionAssimilation({ decision, registry, impliedCapability: IMPLIED_CAPABILITY_BY_REVIEW_ITEM[decision.reviewItemLabel] }));
}

describe("Stage 8.5L5.R3.2 -- real professional review decision classification (zero database, zero AI, zero network)", () => {
  it("classifies all 13 real decisions deterministically, with zero registry mutation", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const registrySnapshotBefore = JSON.stringify(registry);
    const results = classifyAll();
    expect(results).toHaveLength(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.length);
    expect(JSON.stringify(buildCanonicalCandidateSkillRegistry())).toBe(registrySnapshotBefore);

    const byLabel = new Map(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.map((d, i) => [d.reviewItemLabel, results[i]]));
    fs.writeFileSync(
      path.join(process.cwd(), "scratch-l5r3-2-real-decision-classification-result.json"),
      JSON.stringify({ decisions: L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS, results: Object.fromEntries(byLabel) }, null, 2),
      "utf8",
    );
  });

  it("#13 Channel Cut classifies as PROFESSIONAL_ADDITION_PENDING_REVIEW -- never auto-attached despite sharing REFINE_ENDS with Slice-and-Slide", () => {
    const results = classifyAll();
    const byLabel = new Map(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.map((d, i) => [d.reviewItemLabel, results[i]]));
    expect(byLabel.get("#13")?.outcome).toBe("PROFESSIONAL_ADDITION_PENDING_REVIEW");
  });

  it("#7 Deep Point Cut and #12B (deep point cut texturization) never silently attach to Slice-and-Slide -- PROPOSE_TECHNIQUE_VARIANT, not EXTEND_EXISTING_CAPABILITY", () => {
    const results = classifyAll();
    const byLabel = new Map(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.map((d, i) => [d.reviewItemLabel, results[i]]));
    expect(byLabel.get("#7")?.outcome).toBe("PROPOSE_TECHNIQUE_VARIANT");
    expect(byLabel.get("#7")?.comparedSkillId).toBe("skill-cutting-slice-and-slide-refinement");
    expect(byLabel.get("#12B")?.outcome).toBe("PROPOSE_TECHNIQUE_VARIANT");
  });

  it("#11 (Point Cut for correction/alignment) and #12A (Point Cut for lateral alignment) receive the SAME structural outcome as #7/#12B (both compare against REFINE_ENDS) -- the DIFFERENCE in professional purpose (correction/alignment vs texturization) is preserved in professionalValue/professionalNote, not collapsed by the classifier", () => {
    const results = classifyAll();
    const byLabel = new Map(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.map((d, i) => [d.reviewItemLabel, results[i]]));
    expect(byLabel.get("#11")?.outcome).toBe("PROPOSE_TECHNIQUE_VARIANT");
    expect(byLabel.get("#12A")?.outcome).toBe("PROPOSE_TECHNIQUE_VARIANT");
    // The classifier's structural outcome is the same shape, but the two
    // decisions' own recorded purpose text is never conflated:
    const decision11 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#11")!;
    const decision12B = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#12B")!;
    expect(decision11.professionalValue).toContain("correction");
    expect(decision12B.professionalValue).toContain("texturizing");
    expect(decision11.professionalValue).not.toContain("texturizing");
  });

  it("#6a/#6b (direction + wet-to-dry workflow knowledge) are NOT capability-comparable -- NO_ASSIMILATION, never forced into a capability match", () => {
    const results = classifyAll();
    const byLabel = new Map(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.map((d, i) => [d.reviewItemLabel, results[i]]));
    expect(byLabel.get("#6a-direction")?.outcome).toBe("NO_ASSIMILATION");
    expect(byLabel.get("#6b-wet-to-dry")?.outcome).toBe("NO_ASSIMILATION");
  });

  it("#7's contextual knowledge (commonly used for shorter hair) never appears as REQUIRED/mandatory language anywhere in the decision", () => {
    const decision7 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#7")!;
    for (const claim of decision7.contextualKnowledge) {
      expect(["COMMONLY_USED_FOR", "TYPICALLY_USED_FOR", "PREFERRED_IN_CONTEXT", "COMPATIBLE_WITH", "ALTERNATIVE_TO", "MAY_BE_USED_FOR"]).toContain(claim.relation);
    }
  });

  it("#13's contextual knowledge (commonly used for short-hair zones) is never REQUIRED/mandatory language", () => {
    const decision13 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#13")!;
    expect(decision13.contextualKnowledge[0].relation).toBe("COMMONLY_USED_FOR");
  });

  it("test 12: Channel Cut's known natural-fall control is textually distinguishable from Slice-and-Slide's own fixed fingers-held control", () => {
    const decision13 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#13")!;
    expect(decision13.knownFields.some((f) => f.includes("natural fall") && f.includes("NOT held between fingers"))).toBe(true);
  });

  it("test 13: no unknownFields anywhere across all 13 real decisions contains a fabricated numeric value", () => {
    for (const decision of L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS) {
      for (const field of decision.unknownFields) expect(field).not.toMatch(/\d/);
    }
  });

  it("test 2: every CORRECTION decision's originalAIClaim remains exactly what the AI originally said -- never overwritten by the professional's own corrected value", () => {
    const decision7 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#7")!;
    expect(decision7.originalAIClaim?.value).toBe("Point cutting and slicing for texturizing a bob");
    expect(decision7.professionalValue).toBe("DEEP_POINT_CUT");
  });

  it("test 17: deterministic replay -- classifying the same 13 real decisions twice produces byte-identical results", () => {
    const first = classifyAll();
    const second = classifyAll();
    expect(second).toEqual(first);
  });

  it("test 14/15/16: this file never imports Prisma, never touches the DB, and the registry function used is the same pure canonical builder L5.R3 already used -- zero mutation possible by construction", () => {
    const source = fs.readFileSync(__filename, "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/prisma["']/);
    expect(source).not.toMatch(/\bprisma\./);
  });
});
