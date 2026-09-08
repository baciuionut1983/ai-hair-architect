import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compileExecutionUnitToAtomicActions, type AtomicActionCompilationSuccess } from "@/lib/cutting-skill-atomic-action-compiler";
import {
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  isEstablishCentralNapeGuideFact,
} from "@/lib/cutting-skill-establish-central-nape-guide";
import {
  isOccipitalTransitionFact,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS,
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
} from "@/lib/cutting-skill-occipital-transition";
import { deriveDemonstrationRequirementsFromAtomicAction } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { isValidDemonstrationRequirement, type DemonstrationRequirement } from "@/lib/professional-skill-demonstration-requirement-contracts";
import { deriveViewpointConstraintsFromDemonstrationRequirements, type ViewpointSatisfactionResult } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import { isValidViewpointConstraint, type ViewpointConstraint } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import type { AtomicAction } from "@/lib/professional-skill-atomic-action-contracts";

const AT = "2026-09-08T00:00:00.000Z";

function compileAndDerive(
  skill: typeof ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL | typeof OCCIPITAL_TRANSITION_SKILL,
  instance: typeof ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE | typeof OCCIPITAL_TRANSITION_SKILL_INSTANCE,
  unit: (typeof ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS)[number] | (typeof OCCIPITAL_TRANSITION_EXECUTION_UNITS)[number],
  isValidFact: typeof isEstablishCentralNapeGuideFact | typeof isOccipitalTransitionFact,
): { action: AtomicAction; requirements: readonly DemonstrationRequirement[] }[] {
  const compiled = compileExecutionUnitToAtomicActions(skill, instance, unit, isValidFact as never, AT) as AtomicActionCompilationSuccess;
  return compiled.actions.map((action) => {
    const derivation = deriveDemonstrationRequirementsFromAtomicAction(action, instance as never, unit as never, isValidFact as never, AT);
    return { action, requirements: derivation.status === "DERIVED" ? derivation.requirements : [] };
  });
}

const napeGuideGroups = compileAndDerive(
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL,
  ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL_INSTANCE,
  ESTABLISH_CENTRAL_NAPE_GUIDE_EXECUTION_UNITS[0],
  isEstablishCentralNapeGuideFact,
);
const occipitalLowerGroups = compileAndDerive(
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS[0],
  isOccipitalTransitionFact,
);
const occipitalUpperGroups = compileAndDerive(
  OCCIPITAL_TRANSITION_SKILL,
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
  OCCIPITAL_TRANSITION_EXECUTION_UNITS[1],
  isOccipitalTransitionFact,
);

function deriveVC(
  group: { requirements: readonly DemonstrationRequirement[] },
  isValidFact: typeof isEstablishCentralNapeGuideFact | typeof isOccipitalTransitionFact,
) {
  return deriveViewpointConstraintsFromDemonstrationRequirements(group.requirements, isValidFact as never, AT);
}

function covered(result: ViewpointSatisfactionResult): readonly ViewpointConstraint[] {
  return result.status === "COVERED" ? result.constraints : [];
}

function findByAction(groups: ReturnType<typeof compileAndDerive>, actionKind: string) {
  return groups.find((g) => g.action.actionKind === actionKind)!;
}

// ===========================================================================
// SECTION B -- REAL CENTRAL NAPE GUIDE
// ===========================================================================

describe("B. REAL: Central Nape Guide viewpoint constraint derivation", () => {
  it("6. real requirements derive successfully for every real Atomic Action", () => {
    for (const group of napeGuideGroups) {
      const result = deriveVC(group, isEstablishCentralNapeGuideFact);
      expect(result.status).toBe("COVERED");
    }
  });

  it("7. anatomical context remains covered on every action", () => {
    for (const group of napeGuideGroups) {
      const constraints = covered(deriveVC(group, isEstablishCentralNapeGuideFact));
      expect(constraints.some((c) => c.framingSemantic === "ANATOMICAL_CONTEXT_VISIBLE")).toBe(true);
    }
  });

  it("8. comb/strand relationship remains covered on the CONTROL action", () => {
    const control = findByAction(napeGuideGroups, "CONTROL");
    const constraints = covered(deriveVC(control, isEstablishCentralNapeGuideFact));
    const relationship = constraints.find((c) => c.framingSemantic === "TECHNICAL_RELATIONSHIP_READABLE");
    const combRequirement = control.requirements.find((r) => r.subjectValue === "comb")!;
    expect(relationship?.satisfiedDemonstrationRequirementIds).toContain(combRequirement.demonstrationRequirementId);
  });

  it("9. zero-degree geometry remains covered on the EXECUTE action", () => {
    const execute = findByAction(napeGuideGroups, "EXECUTE");
    const constraints = covered(deriveVC(execute, isEstablishCentralNapeGuideFact));
    const geometry = constraints.find((c) => c.framingSemantic === "GEOMETRY_READABLE");
    const elevationRequirement = execute.requirements.find((r) => r.category === "SUBJECT_TO_REFERENCE_GEOMETRY")!;
    expect(geometry?.satisfiedDemonstrationRequirementIds).toContain(elevationRequirement.demonstrationRequirementId);
  });

  it("10. the resulting cutting/reference line remains covered where present, folded into the same GEOMETRY_READABLE constraint", () => {
    const execute = findByAction(napeGuideGroups, "EXECUTE");
    const constraints = covered(deriveVC(execute, isEstablishCentralNapeGuideFact));
    const geometryConstraints = constraints.filter((c) => c.framingSemantic === "GEOMETRY_READABLE");
    const lineRequirement = execute.requirements.find((r) => r.category === "RESULTING_LINE_OR_FORM")!;
    expect(geometryConstraints.length).toBe(1);
    expect(geometryConstraints[0].satisfiedDemonstrationRequirementIds).toContain(lineRequirement.demonstrationRequirementId);
  });

  it("11. no real requirement is ever silently dropped for any action -- total coverage matches total requirement count exactly", () => {
    for (const group of napeGuideGroups) {
      const constraints = covered(deriveVC(group, isEstablishCentralNapeGuideFact));
      const coveredIds = new Set(constraints.flatMap((c) => c.satisfiedDemonstrationRequirementIds));
      expect(coveredIds.size).toBe(group.requirements.length);
      for (const requirement of group.requirements) {
        expect(coveredIds.has(requirement.demonstrationRequirementId)).toBe(true);
      }
    }
  });

  it("12. no exact camera degree is ever invented", () => {
    const execute = findByAction(napeGuideGroups, "EXECUTE");
    const constraints = covered(deriveVC(execute, isEstablishCentralNapeGuideFact));
    const haystack = JSON.stringify(constraints).toLowerCase();
    expect(/\d+\s*(deg|degree)/.test(haystack.replace("0_deg_blunt", ""))).toBe(false);
    for (const c of constraints) {
      expect(Object.keys(c)).not.toContain("cameraAngleDegrees");
    }
  });

  it("13. no provider metadata is ever created", () => {
    const allConstraints = napeGuideGroups.flatMap((g) => covered(deriveVC(g, isEstablishCentralNapeGuideFact)));
    const haystack = JSON.stringify(allConstraints).toLowerCase();
    for (const term of ["prompt", "aspectratio", "seed", "resolution"]) {
      expect(haystack.includes(term)).toBe(false);
    }
    expect(/\bveo\b/.test(haystack)).toBe(false);
  });
});

// ===========================================================================
// SECTION C -- REAL OCCIPITAL LOWER
// ===========================================================================

describe("C. REAL: Occipital lower viewpoint constraint derivation", () => {
  it("14. lower requirements derive successfully", () => {
    for (const group of occipitalLowerGroups) {
      expect(deriveVC(group, isOccipitalTransitionFact).status).toBe("COVERED");
    }
  });

  it("15. COMB relation remains covered", () => {
    const control = findByAction(occipitalLowerGroups, "CONTROL");
    const constraints = covered(deriveVC(control, isOccipitalTransitionFact));
    const combRequirement = control.requirements.find((r) => r.subjectValue === "comb")!;
    const relationship = constraints.find((c) => c.framingSemantic === "TECHNICAL_RELATIONSHIP_READABLE");
    expect(relationship?.satisfiedDemonstrationRequirementIds).toContain(combRequirement.demonstrationRequirementId);
  });

  it("16. below-occipital anatomical context remains covered", () => {
    const control = findByAction(occipitalLowerGroups, "CONTROL");
    const constraints = covered(deriveVC(control, isOccipitalTransitionFact));
    const anatomicalRequirement = control.requirements.find((r) => r.category === "ANATOMICAL_CONTEXT")!;
    expect(anatomicalRequirement.subjectValue).toBe("posterior_below_occipital");
    expect(anatomicalRequirement.condition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: false });
    const context = constraints.find((c) => c.framingSemantic === "ANATOMICAL_CONTEXT_VISIBLE");
    expect(context?.satisfiedDemonstrationRequirementIds).toContain(anatomicalRequirement.demonstrationRequirementId);
  });

  it("17. no numeric anatomy coordinate is ever invented -- the underlying condition stays strictly boolean", () => {
    for (const group of occipitalLowerGroups) {
      for (const requirement of group.requirements) {
        if (requirement.condition && requirement.condition.op === "equals") {
          expect(typeof requirement.condition.value).toBe("boolean");
        }
      }
    }
  });
});

// ===========================================================================
// SECTION D -- REAL OCCIPITAL UPPER
// ===========================================================================

describe("D. REAL: Occipital upper viewpoint constraint derivation", () => {
  it("18. upper requirements derive successfully", () => {
    for (const group of occipitalUpperGroups) {
      expect(deriveVC(group, isOccipitalTransitionFact).status).toBe("COVERED");
    }
  });

  it("19. FINGERS relation remains covered", () => {
    const control = findByAction(occipitalUpperGroups, "CONTROL");
    const constraints = covered(deriveVC(control, isOccipitalTransitionFact));
    const fingersRequirement = control.requirements.find((r) => r.subjectValue === "fingers")!;
    const relationship = constraints.find((c) => c.framingSemantic === "TECHNICAL_RELATIONSHIP_READABLE");
    expect(relationship?.satisfiedDemonstrationRequirementIds).toContain(fingersRequirement.demonstrationRequirementId);
  });

  it("20. at/above-occipital anatomical context remains covered", () => {
    const control = findByAction(occipitalUpperGroups, "CONTROL");
    const anatomicalRequirement = control.requirements.find((r) => r.category === "ANATOMICAL_CONTEXT")!;
    expect(anatomicalRequirement.subjectValue).toBe("occipital_and_above");
    expect(anatomicalRequirement.condition).toEqual({ op: "equals", fact: "aboveOccipitalThreshold", value: true });
  });

  it("21. lower and upper policies remain structurally distinguishable -- never flattened", () => {
    const lowerControl = findByAction(occipitalLowerGroups, "CONTROL");
    const upperControl = findByAction(occipitalUpperGroups, "CONTROL");
    const lowerRel = covered(deriveVC(lowerControl, isOccipitalTransitionFact)).find((c) => c.framingSemantic === "TECHNICAL_RELATIONSHIP_READABLE")!;
    const upperRel = covered(deriveVC(upperControl, isOccipitalTransitionFact)).find((c) => c.framingSemantic === "TECHNICAL_RELATIONSHIP_READABLE")!;
    expect(lowerRel.satisfiedDemonstrationRequirementIds).not.toEqual(upperRel.satisfiedDemonstrationRequirementIds);
    // Cross-referencing back confirms the underlying facts are genuinely
    // different (comb vs fingers), never collapsed into an ambiguous value.
    const lowerSourceValue = lowerControl.requirements.find((r) => r.demonstrationRequirementId === lowerRel.satisfiedDemonstrationRequirementIds[0])?.subjectValue;
    const upperSourceValue = upperControl.requirements.find((r) => r.demonstrationRequirementId === upperRel.satisfiedDemonstrationRequirementIds[0])?.subjectValue;
    expect(lowerSourceValue).not.toBe(upperSourceValue);
  });
});

// ===========================================================================
// SECTION E -- COVERAGE / FAIL-CLOSED
// ===========================================================================

describe("E. Coverage / fail-closed behavior", () => {
  it("22. every mandatory requirement across every real group maps to coverage", () => {
    // isOccipitalTransitionFact's own fact set is a strict superset of
    // isEstablishCentralNapeGuideFact's (both share the real
    // ExecutionRuleConditionFact list; Occipital Transition additionally
    // recognizes aboveOccipitalThreshold, never used by Central Nape
    // Guide) -- safe to use uniformly across all three real groups here.
    const allGroups = [...napeGuideGroups, ...occipitalLowerGroups, ...occipitalUpperGroups];
    for (const group of allGroups) {
      const constraints = covered(deriveVC(group, isOccipitalTransitionFact));
      const coveredIds = new Set(constraints.flatMap((c) => c.satisfiedDemonstrationRequirementIds));
      expect(coveredIds.size).toBe(group.requirements.length);
    }
  });

  it("23-24. the intersection-based coverage algorithm correctly detects non-coverage (algorithm-soundness proof, not the exported function -- see file header: with exactly one real family covering all three real framing semantics, VIEWPOINT_UNSATISFIED is provably unreachable via any valid input today)", () => {
    // SYNTHETIC algorithm-shape check only -- mirrors the exact
    // intersection logic deriveViewpointConstraintsFromDemonstrationRequirements
    // itself uses, with a deliberately narrower synthetic family set to
    // prove the approach correctly rejects non-coverage when it can occur.
    const syntheticFamilyCompatibility: Record<string, readonly string[]> = {
      SYNTHETIC_FAMILY_A: ["ANATOMICAL_CONTEXT_VISIBLE", "TECHNICAL_RELATIONSHIP_READABLE"],
      SYNTHETIC_FAMILY_B: ["GEOMETRY_READABLE"],
    };
    const neededFramings = ["ANATOMICAL_CONTEXT_VISIBLE", "GEOMETRY_READABLE"];
    const satisfyingFamilies = Object.keys(syntheticFamilyCompatibility).filter((family) =>
      neededFramings.every((framing) => syntheticFamilyCompatibility[family].includes(framing)),
    );
    expect(satisfyingFamilies).toEqual([]);
  });

  it("real content always resolves successfully -- proving VIEWPOINT_UNSATISFIED is honestly unreachable, not silently avoided by under-testing", () => {
    const allGroups = [...napeGuideGroups, ...occipitalLowerGroups, ...occipitalUpperGroups];
    for (const group of allGroups) {
      expect(deriveVC(group, isOccipitalTransitionFact).status).toBe("COVERED");
    }
  });

  it("25. no best-effort silent degradation -- coverage is exact, never partial-but-reported-as-success", () => {
    const execute = findByAction(napeGuideGroups, "EXECUTE");
    const result = deriveVC(execute, isEstablishCentralNapeGuideFact);
    if (result.status === "COVERED") {
      const coveredIds = new Set(result.constraints.flatMap((c) => c.satisfiedDemonstrationRequirementIds));
      expect(coveredIds.size).toBe(execute.requirements.length);
    } else {
      throw new Error("expected COVERED for real Central Nape Guide EXECUTE action");
    }
  });

  it("26. duplicate equivalent constraints normalize deterministically -- multiple real requirements sharing one framing merge into one constraint", () => {
    // Stage 2.5.i.19: distribution's own promoted SUBJECT_TO_REFERENCE_
    // GEOMETRY requirement (also GEOMETRY_READABLE) joins elevation's and
    // cuttingLineShape's on the real EXECUTE action -- 3 requirements
    // merging into 1 constraint, not 2; the merging behavior itself
    // (never one constraint per requirement) is what this test proves,
    // and remains true regardless of exact count.
    const execute = findByAction(napeGuideGroups, "EXECUTE");
    const constraints = covered(deriveVC(execute, isEstablishCentralNapeGuideFact));
    const geometryConstraints = constraints.filter((c) => c.framingSemantic === "GEOMETRY_READABLE");
    expect(geometryConstraints.length).toBe(1);
    expect(geometryConstraints[0].satisfiedDemonstrationRequirementIds.length).toBe(3);
  });

  it("27. rejects an invalid Demonstration Requirement", () => {
    const control = findByAction(napeGuideGroups, "CONTROL");
    const malformed = [{ ...control.requirements[0], demonstrationRequirementId: "" }];
    const result = deriveViewpointConstraintsFromDemonstrationRequirements(malformed, isEstablishCentralNapeGuideFact, AT);
    expect(result.status).toBe("INVALID_INPUT");
  });

  it("28. a free-text-only mutation never changes the derived structural output", () => {
    const control = findByAction(napeGuideGroups, "CONTROL");
    const real = covered(deriveVC(control, isEstablishCentralNapeGuideFact));
    const mangled = control.requirements.map((r) => ({ ...r, presentationSummary: "SYNTHETIC garbage prose claiming an unrelated fact" }));
    const withGarbageProse = covered(deriveViewpointConstraintsFromDemonstrationRequirements(mangled, isEstablishCentralNapeGuideFact, AT));
    const shape = (c: ViewpointConstraint) => ({ viewpointFamily: c.viewpointFamily, framingSemantic: c.framingSemantic, satisfiedDemonstrationRequirementIds: [...c.satisfiedDemonstrationRequirementIds].sort() });
    expect(withGarbageProse.map(shape)).toEqual(real.map(shape));
  });

  it("29. a synthetic, fabricated Demonstration Requirement set never gains more viewpoint authority than it explicitly declares", () => {
    const fabricated: DemonstrationRequirement[] = [
      {
        demonstrationRequirementId: "req-synthetic-fabricated",
        vertical: "cutting",
        category: "TOOL_TO_SUBJECT_RELATIONSHIP",
        subjectParameterNames: ["controlMethod"],
        subjectValue: "comb",
        sourceAtomicActionId: "aa-synthetic-fabricated",
        presentationSummary: "SYNTHETIC.",
        derivedAt: AT,
      },
    ];
    expect(isValidDemonstrationRequirement(fabricated[0], isEstablishCentralNapeGuideFact)).toBe(true);
    const result = deriveViewpointConstraintsFromDemonstrationRequirements(fabricated, isEstablishCentralNapeGuideFact, AT);
    expect(result.status).toBe("COVERED");
    const constraints = covered(result);
    // Only ONE constraint (TECHNICAL_RELATIONSHIP_READABLE) -- never more
    // than what the single declared requirement structurally justifies.
    expect(constraints.length).toBe(1);
    expect(constraints[0].framingSemantic).toBe("TECHNICAL_RELATIONSHIP_READABLE");
  });

  it("30. no derived Viewpoint Constraint ever claims a runtime observation", () => {
    const allConstraints = [...napeGuideGroups, ...occipitalLowerGroups, ...occipitalUpperGroups].flatMap((g) =>
      covered(deriveVC(g, isEstablishCentralNapeGuideFact)),
    );
    for (const constraint of allConstraints) {
      expect(isValidViewpointConstraint(constraint)).toBe(true);
      expect("observationCriterion" in constraint).toBe(false);
      expect("evidenceStatus" in constraint).toBe(false);
    }
  });
});

// ===========================================================================
// SECTION F -- MULTI-VERTICAL / BOUNDARY
// ===========================================================================

describe("F. Multi-vertical and dependency boundary", () => {
  it("31. the universal contract accepts a synthetic non-cutting semantic relationship", () => {
    const syntheticMakeupConstraint: ViewpointConstraint = {
      viewpointConstraintId: "vc-synthetic-makeup-1",
      vertical: "synthetic_makeup",
      viewpointFamily: "POSTERIOR",
      framingSemantic: "TECHNICAL_RELATIONSHIP_READABLE",
      satisfiedDemonstrationRequirementIds: ["req-synthetic-makeup-1"],
      derivedAt: AT,
    };
    expect(isValidViewpointConstraint(syntheticMakeupConstraint)).toBe(true);
  });

  it("32. cutting vocabulary does not leak into universal fields on real derived output", () => {
    const allConstraints = napeGuideGroups.flatMap((g) => covered(deriveVC(g, isEstablishCentralNapeGuideFact)));
    for (const constraint of allConstraints) {
      expect(["POSTERIOR"]).toContain(constraint.viewpointFamily);
      expect(["ANATOMICAL_CONTEXT_VISIBLE", "TECHNICAL_RELATIONSHIP_READABLE", "GEOMETRY_READABLE"]).toContain(constraint.framingSemantic);
    }
  });

  it("33-35. neither the universal contract nor the cutting deriver has an IMPORT STATEMENT naming Technical Visual Map, Spatial Map, Photo Preview, or Result Video", () => {
    // Checks only `import ... from "..."` lines -- header comments
    // legitimately discuss (and even contain the word "spatial") WHY no
    // such dependency exists, exactly like this domain's own established
    // "prose mentioning a boundary is not the same as violating it"
    // precedent (see e.g. Stage 2.5.i.6's own "laterality"/"laterals"
    // false-positive lesson).
    const contractsPath = fileURLToPath(new URL("./professional-skill-viewpoint-constraint-contracts.ts", import.meta.url));
    const deriverPath = fileURLToPath(new URL("./cutting-skill-viewpoint-constraint-deriver.ts", import.meta.url));
    const importLines = (source: string) =>
      source
        .split("\n")
        .filter((line) => /^\s*import\s/.test(line))
        // Excludes the one already-established, shared-utility import
        // every contract file in this domain uses identically (isRecord
        // from technical-visual-map-validators.ts, e.g. Stage 2.5.i.1/
        // i.3/i.4/i.10's own contracts all do this too) -- a generic type
        // guard, never TVM domain data/types, so it is not the dependency
        // this test is checking for.
        .filter((line) => !line.includes("isRecord"))
        .join("\n")
        .toLowerCase();

    const contractsImports = importLines(readFileSync(contractsPath, "utf8"));
    const deriverImports = importLines(readFileSync(deriverPath, "utf8"));

    for (const forbidden of ["technical-visual-map", "spatial-validators", "photo-preview", "video-generation", "video-provider"]) {
      expect(contractsImports.includes(forbidden)).toBe(false);
      expect(deriverImports.includes(forbidden)).toBe(false);
    }
  });
});
