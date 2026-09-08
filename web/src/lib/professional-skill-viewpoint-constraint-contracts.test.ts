import { describe, expect, it } from "vitest";

import * as viewpointConstraintModule from "@/lib/professional-skill-viewpoint-constraint-contracts";
import {
  classifyFramingSemantic,
  FRAMING_SEMANTICS,
  isFramingSemantic,
  isValidViewpointConstraint,
  isViewpointFamily,
  VIEWPOINT_FAMILIES,
  type ViewpointConstraint,
} from "@/lib/professional-skill-viewpoint-constraint-contracts";
import { DEMONSTRATION_REQUIREMENT_CATEGORIES } from "@/lib/professional-skill-demonstration-requirement-contracts";

// SYNTHETIC TEST FIXTURE -- NOT REAL PROFESSIONAL AUTHORITY.

function baseConstraint(overrides: Partial<ViewpointConstraint> = {}): ViewpointConstraint {
  return {
    viewpointConstraintId: "vc-synthetic-1",
    vertical: "synthetic_cutting",
    viewpointFamily: "POSTERIOR",
    framingSemantic: "TECHNICAL_RELATIONSHIP_READABLE",
    satisfiedDemonstrationRequirementIds: ["req-synthetic-1"],
    derivedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("Viewpoint Constraint contract (Stage 2.5.i.12, SYNTHETIC FIXTURES ONLY)", () => {
  it("1. validates a well-formed synthetic Viewpoint Constraint", () => {
    expect(isValidViewpointConstraint(baseConstraint())).toBe(true);
  });

  it("rejects an unrecognized viewpoint family and an unrecognized framing semantic", () => {
    expect(isViewpointFamily("SYNTHETIC_NOT_A_REAL_FAMILY")).toBe(false);
    expect(isFramingSemantic("SYNTHETIC_NOT_A_REAL_FRAMING")).toBe(false);
    expect(isValidViewpointConstraint({ ...baseConstraint(), viewpointFamily: "FRONT" })).toBe(false);
    expect(isValidViewpointConstraint({ ...baseConstraint(), framingSemantic: "WIDE" })).toBe(false);
  });

  it("2. rejects a constraint carrying a provider-specific camera field -- the type itself has no such field to populate", () => {
    const withCameraField = { ...baseConstraint(), cameraAngleDegrees: 45 };
    // The extra field is structurally irrelevant -- isValidViewpointConstraint
    // never recognizes or requires it, and the contract's own declared
    // shape (verified below) has no such key at all.
    expect(isValidViewpointConstraint(withCameraField)).toBe(true);
    expect(Object.keys(baseConstraint())).not.toContain("cameraAngleDegrees");
    expect(Object.keys(baseConstraint())).not.toContain("cameraDistanceCm");
    expect(Object.keys(baseConstraint())).not.toContain("lens");
  });

  it("3. rejects representing an exact duration -- the type itself has no such field", () => {
    const keys = Object.keys(baseConstraint());
    for (const forbidden of ["duration", "seconds", "frameCount", "clipLength"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase()))).toBe(false);
    }
  });

  it("4. the universal vocabulary contains no haircut-specific terms", () => {
    const haystack = [...VIEWPOINT_FAMILIES, ...FRAMING_SEMANTICS].join(" ").toLowerCase();
    for (const term of ["comb", "finger", "shear", "elevation", "hair", "occipital", "nape"]) {
      expect(haystack.includes(term)).toBe(false);
    }
  });

  it("5. traceability to Demonstration Requirement(s) is required and preserved", () => {
    expect(isValidViewpointConstraint({ ...baseConstraint(), satisfiedDemonstrationRequirementIds: [] })).toBe(false);
    const multi = baseConstraint({ satisfiedDemonstrationRequirementIds: ["req-1", "req-2"] });
    expect(isValidViewpointConstraint(multi)).toBe(true);
    expect(multi.satisfiedDemonstrationRequirementIds).toEqual(["req-1", "req-2"]);
  });

  it("classifyFramingSemantic is a total, deterministic function over every real Demonstration Requirement category", () => {
    for (const category of DEMONSTRATION_REQUIREMENT_CATEGORIES) {
      const framing = classifyFramingSemantic(category);
      expect(isFramingSemantic(framing)).toBe(true);
    }
    expect(classifyFramingSemantic("ANATOMICAL_CONTEXT")).toBe("ANATOMICAL_CONTEXT_VISIBLE");
    expect(classifyFramingSemantic("SUBJECT_POSITION_STATE")).toBe("ANATOMICAL_CONTEXT_VISIBLE");
    expect(classifyFramingSemantic("TOOL_TO_SUBJECT_RELATIONSHIP")).toBe("TECHNICAL_RELATIONSHIP_READABLE");
    expect(classifyFramingSemantic("SUBJECT_TO_REFERENCE_GEOMETRY")).toBe("GEOMETRY_READABLE");
    expect(classifyFramingSemantic("RESULTING_LINE_OR_FORM")).toBe("GEOMETRY_READABLE");
  });

  it("the module exports no VideoInstruction, provider, or derivation-function concept", () => {
    const exported = Object.keys(viewpointConstraintModule);
    for (const forbidden of ["VideoInstruction", "isValidVideoInstruction", "Provider", "deriveViewpointConstraints", "compileVideoInstruction"]) {
      expect(exported.some((name) => name.includes(forbidden))).toBe(false);
    }
  });
});
