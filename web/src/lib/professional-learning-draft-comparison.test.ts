import { describe, expect, it } from "vitest";

import { compareExtractionAgainstRegistry } from "./professional-learning-draft-comparison";
import { buildCanonicalCandidateSkillRegistry } from "./professional-brain-skill-templates";

const registry = buildCanonicalCandidateSkillRegistry();

describe("compareExtractionAgainstRegistry", () => {
  it("returns INSUFFICIENT_INFORMATION for non-comparable discernment categories without ever touching the registry match logic", () => {
    for (const category of ["IRRELEVANT", "INSUFFICIENT_EVIDENCE", "RESULT_REFERENCE"] as const) {
      const result = compareExtractionAgainstRegistry(category, ["skill-cutting-one-length-perimeter"], registry, "evidence-1");
      expect(result).toEqual({ outcome: "INSUFFICIENT_INFORMATION", comparedSkillId: null, conflictDetail: null });
    }
  });

  it("returns EVIDENCE_FOR_EXISTING when the evidence names exactly one real, existing skill (Part 23 fixture shape)", () => {
    const result = compareExtractionAgainstRegistry("PROFESSIONAL_TECHNIQUE", ["skill-cutting-one-length-perimeter"], registry, "evidence-1");
    expect(result.outcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(result.comparedSkillId).toBe("skill-cutting-one-length-perimeter");
    expect(result.conflictDetail).toBeNull();
  });

  it("returns POSSIBLE_CONFLICT when the evidence proposes combining two skills the registry itself declares incompatible (Part 24 fixture shape)", () => {
    const result = compareExtractionAgainstRegistry(
      "PROFESSIONAL_RULE",
      ["skill-cutting-slice-and-slide-refinement", "skill-cutting-one-length-perimeter"],
      registry,
      "evidence-2",
    );
    expect(result.outcome).toBe("POSSIBLE_CONFLICT");
    expect(result.comparedSkillId).toBe("skill-cutting-slice-and-slide-refinement");
    expect(result.conflictDetail).not.toBeNull();
    expect(result.conflictDetail?.reviewRequired).toBe(true);
    expect(result.conflictDetail?.existingAuthority.skillId).toBe("skill-cutting-slice-and-slide-refinement");
    expect(result.conflictDetail?.newEvidenceId).toBe("evidence-2");
  });

  it("never mutates or even inspects the approved skill's own row -- the registry passed in is returned untouched", () => {
    const before = JSON.stringify(registry);
    compareExtractionAgainstRegistry(
      "PROFESSIONAL_RULE",
      ["skill-cutting-slice-and-slide-refinement", "skill-cutting-one-length-perimeter"],
      registry,
      "evidence-2",
    );
    expect(JSON.stringify(registry)).toBe(before);
  });

  it("returns POSSIBLE_NEW_SKILL when no known skill is mentioned at all despite real procedural content", () => {
    const result = compareExtractionAgainstRegistry("PROFESSIONAL_TECHNIQUE", [], registry, "evidence-3");
    expect(result).toEqual({ outcome: "POSSIBLE_NEW_SKILL", comparedSkillId: null, conflictDetail: null });
  });

  it("treats a hint pointing at a nonexistent registry skillId identically to no hint at all (Part 21: never trust an unverifiable reference)", () => {
    const result = compareExtractionAgainstRegistry("PROFESSIONAL_TECHNIQUE", ["skill-cutting-does-not-exist"], registry, "evidence-4");
    expect(result.outcome).toBe("POSSIBLE_NEW_SKILL");
    expect(result.comparedSkillId).toBeNull();
  });

  it("does not flag a conflict for two named skills the registry does not declare incompatible", () => {
    const result = compareExtractionAgainstRegistry(
      "PROFESSIONAL_RULE",
      ["skill-cutting-slice-and-slide-refinement", "skill-cutting-graduated"],
      registry,
      "evidence-5",
    );
    expect(result.outcome).toBe("EVIDENCE_FOR_EXISTING");
    expect(result.conflictDetail).toBeNull();
  });
});
