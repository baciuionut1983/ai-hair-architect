import { describe, expect, it } from "vitest";

import * as demonstrationRequirementModule from "@/lib/professional-skill-demonstration-requirement-contracts";
import {
  DEMONSTRATION_REQUIREMENT_CATEGORIES,
  deduplicateDemonstrationRequirements,
  isDemonstrationRequirementCategory,
  isValidDemonstrationRequirement,
  type DemonstrationRequirement,
} from "@/lib/professional-skill-demonstration-requirement-contracts";

// SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY.

type SyntheticFact = "handedness" | "aboveOccipitalThreshold";
function isSyntheticFact(value: unknown): value is SyntheticFact {
  return value === "handedness" || value === "aboveOccipitalThreshold";
}

function baseRequirement(overrides: Partial<DemonstrationRequirement<SyntheticFact>> = {}): DemonstrationRequirement<SyntheticFact> {
  return {
    demonstrationRequirementId: "req-synthetic-1",
    vertical: "synthetic_cutting",
    category: "TOOL_TO_SUBJECT_RELATIONSHIP",
    subjectParameterNames: ["controlMethod"],
    subjectValue: "comb",
    sourceAtomicActionId: "aa-synthetic-1",
    presentationSummary: "SYNTHETIC -- demonstrate tool-to-subject relationship.",
    derivedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("Demonstration Requirement contract (Stage 2.5.i.10, SYNTHETIC FIXTURES ONLY)", () => {
  it("validates a well-formed synthetic Demonstration Requirement", () => {
    expect(isValidDemonstrationRequirement(baseRequirement(), isSyntheticFact)).toBe(true);
  });

  it("rejects an unrecognized category", () => {
    expect(isDemonstrationRequirementCategory("SYNTHETIC_NOT_A_REAL_CATEGORY")).toBe(false);
    expect(isValidDemonstrationRequirement({ ...baseRequirement(), category: "SYNTHETIC_NOT_A_REAL_CATEGORY" }, isSyntheticFact)).toBe(false);
  });

  it("rejects an empty subjectParameterNames array", () => {
    expect(isValidDemonstrationRequirement({ ...baseRequirement(), subjectParameterNames: [] }, isSyntheticFact)).toBe(false);
  });

  it("rejects a missing subjectValue", () => {
    const withoutValue: Record<string, unknown> = { ...baseRequirement() };
    delete withoutValue.subjectValue;
    expect(isValidDemonstrationRequirement(withoutValue, isSyntheticFact)).toBe(false);
  });

  it("supports an optional condition using the reused SkillCondition language, and rejects an executable/free-form one", () => {
    const withCondition = baseRequirement({
      category: "ANATOMICAL_CONTEXT",
      condition: { op: "equals", fact: "aboveOccipitalThreshold", value: false },
    });
    expect(isValidDemonstrationRequirement(withCondition, isSyntheticFact)).toBe(true);

    const withEval = baseRequirement({ condition: { op: "eval", expression: "1===1" } as never });
    expect(isValidDemonstrationRequirement(withEval, isSyntheticFact)).toBe(false);
  });

  it("deduplicateDemonstrationRequirements merges exact category+value duplicates within one action, keeping sourceAtomicActionId unambiguous", () => {
    const duplicate = baseRequirement({ subjectParameterNames: ["tool"], demonstrationRequirementId: "req-synthetic-2" });
    const merged = deduplicateDemonstrationRequirements([baseRequirement(), duplicate]);
    expect(merged.length).toBe(1);
    expect(merged[0].subjectParameterNames).toEqual(["controlMethod", "tool"]);
    expect(merged[0].sourceAtomicActionId).toBe("aa-synthetic-1");
  });

  it("does not merge requirements with different categories or different subject values", () => {
    const differentCategory = baseRequirement({ category: "SUBJECT_POSITION_STATE" });
    const differentValue = baseRequirement({ subjectValue: "fingers" });
    const merged = deduplicateDemonstrationRequirements([baseRequirement(), differentCategory, differentValue]);
    expect(merged.length).toBe(3);
  });

  it("the category vocabulary contains no cutting-specific vocabulary", () => {
    const haystack = DEMONSTRATION_REQUIREMENT_CATEGORIES.join(" ").toLowerCase();
    for (const term of ["comb", "finger", "shear", "elevation", "hair", "occipital"]) {
      expect(haystack.includes(term)).toBe(false);
    }
  });

  it("the module exports no camera/timing/provider/observation concept", () => {
    const exported = Object.keys(demonstrationRequirementModule);
    for (const forbidden of [
      "CAMERA",
      "Camera",
      "Viewpoint",
      "VIEWPOINT",
      "Duration",
      "DURATION",
      "Timing",
      "VideoInstruction",
      "isValidVideoInstruction",
      "Provider",
      "ObservationCriterion",
    ]) {
      expect(exported.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
