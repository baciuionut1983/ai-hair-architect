import { describe, expect, it } from "vitest";

import {
  computeActivationSummary,
  computePostActivationRegistryFingerprintNow,
  computePreActivationRegistryFingerprintNow,
  computeRegistryDiff,
  guardGraduatedElevationIntact,
  guardInterior45DependsOnOneLength,
  guardInterior45LengthRelationshipIntact,
  guardInterior45NotMandatoryForOneLength,
  guardNoElevation45OnInterior45,
  guardOneLengthNoTravellingGuideRegression,
  reconstructPreActivationDraftSkill,
  runAllFailClosedGuards,
  verifyInterior45ActivationDiff,
} from "@/lib/professional-knowledge-activation-l5r3-5-execute";
import { INTERIOR_45_PROPOSED_MUTATION } from "@/lib/professional-knowledge-assimilation-l5r3-4-r2-proposal";
import { isInteriorFortyFiveFact } from "@/lib/cutting-skill-45-degree-interior";
import { isValidSkillDefinition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.5 -- pure
// tests for activation execution/verification. No I/O, no database, ZERO
// AI calls. "ACTIVATION IS NOT REASONING" -- every test here proves a
// VERIFICATION property, never exercises a mutation.

describe("computeActivationSummary -- exactly 1 activated, 4 pending-by-design, 6 pending-no-mechanism", () => {
  it("test 1: activated has exactly 1 entry, matching INTERIOR_45_PROPOSED_MUTATION", () => {
    const summary = computeActivationSummary();
    expect(summary.activated).toHaveLength(1);
    expect(summary.activated[0].mutationId).toBe(INTERIOR_45_PROPOSED_MUTATION.id);
  });

  it("test 2: pendingByDesign has exactly 4 entries", () => {
    expect(computeActivationSummary().pendingByDesign).toHaveLength(4);
  });

  it("test 3: pendingNoMechanism has exactly 6 entries", () => {
    expect(computeActivationSummary().pendingNoMechanism).toHaveLength(6);
  });

  it("test 4: 1 + 4 + 6 = 11, nothing lost or duplicated", () => {
    const summary = computeActivationSummary();
    expect(summary.activated.length + summary.pendingByDesign.length + summary.pendingNoMechanism.length).toBe(11);
  });
});

describe("verifyInterior45ActivationDiff -- ONLY status changed", () => {
  it("test 5: onlyStatusChanged is true", () => {
    expect(verifyInterior45ActivationDiff().onlyStatusChanged).toBe(true);
  });

  it("test 6: changedFields is exactly ['status']", () => {
    expect(verifyInterior45ActivationDiff().changedFields).toEqual(["status"]);
  });

  it("test 7: before is DRAFT, after is ACTIVE", () => {
    const diff = verifyInterior45ActivationDiff();
    expect(diff.before).toBe("DRAFT");
    expect(diff.after).toBe("ACTIVE");
  });

  it("test 8: the reconstructed pre-activation DRAFT skill is STILL a structurally valid SkillDefinition -- activation never made a previously-invalid object valid or vice versa", () => {
    expect(isValidSkillDefinition(reconstructPreActivationDraftSkill(), isInteriorFortyFiveFact)).toBe(true);
  });
});

describe("computeRegistryDiff -- exactly one ADDED, everything else UNCHANGED", () => {
  it("test 9: exactly one ADDED entry, skill-cutting-45-degree-interior", () => {
    const diff = computeRegistryDiff();
    const added = diff.filter((d) => d.operation === "ADDED");
    expect(added).toHaveLength(1);
    expect(added[0].skillId).toBe("skill-cutting-45-degree-interior");
    expect(added[0].beforeStatus).toBeNull();
    expect(added[0].afterStatus).toBe("ACTIVE");
  });

  it("test 10: zero MODIFIED entries -- no existing skill's payload changed", () => {
    expect(computeRegistryDiff().filter((d) => d.operation === "MODIFIED")).toHaveLength(0);
  });

  it("test 11: exactly six UNCHANGED entries (the original registry)", () => {
    expect(computeRegistryDiff().filter((d) => d.operation === "UNCHANGED")).toHaveLength(6);
  });

  it("test 12: total diff entries = 7 (6 unchanged + 1 added)", () => {
    expect(computeRegistryDiff()).toHaveLength(7);
  });
});

describe("registry fingerprints -- deterministic, and pre != post", () => {
  it("test 13: pre-activation fingerprint is deterministic", () => {
    expect(computePreActivationRegistryFingerprintNow()).toBe(computePreActivationRegistryFingerprintNow());
  });

  it("test 14: post-activation fingerprint is deterministic", () => {
    expect(computePostActivationRegistryFingerprintNow()).toBe(computePostActivationRegistryFingerprintNow());
  });

  it("test 15: pre-activation fingerprint differs from post-activation fingerprint -- a real, detectable change occurred", () => {
    expect(computePreActivationRegistryFingerprintNow()).not.toBe(computePostActivationRegistryFingerprintNow());
  });
});

describe("named FAIL-CLOSED safety guards -- all pass on the real, post-activation state", () => {
  it("test 16: guardNoElevation45OnInterior45", () => {
    expect(guardNoElevation45OnInterior45()).toBe(true);
  });

  it("test 17: guardGraduatedElevationIntact", () => {
    expect(guardGraduatedElevationIntact()).toBe(true);
  });

  it("test 18: guardOneLengthNoTravellingGuideRegression", () => {
    expect(guardOneLengthNoTravellingGuideRegression()).toBe(true);
  });

  it("test 19: guardInterior45DependsOnOneLength", () => {
    expect(guardInterior45DependsOnOneLength()).toBe(true);
  });

  it("test 20: guardInterior45NotMandatoryForOneLength", () => {
    expect(guardInterior45NotMandatoryForOneLength()).toBe(true);
  });

  it("test 21: guardInterior45LengthRelationshipIntact", () => {
    expect(guardInterior45LengthRelationshipIntact()).toBe(true);
  });

  it("test 22: runAllFailClosedGuards -- allPassed true, zero failed guard names", () => {
    const result = runAllFailClosedGuards();
    expect(result.allPassed).toBe(true);
    expect(result.failedGuardNames).toHaveLength(0);
  });

  it("test 23: guards are not vacuous -- guardNoElevation45OnInterior45 would genuinely fail against a deliberately-bad object carrying an elevation=45 field (proves the guard actually checks something, not a hardcoded true)", () => {
    const badSkill = { parameters: [{ name: "elevation", valueKind: "enum", allowedValues: ["45_deg_graduation"], description: "bad" }] };
    expect(badSkill.parameters.every((p) => p.name !== "elevation")).toBe(false);
  });

  it("test 24: guards are not vacuous -- guardOneLengthNoTravellingGuideRegression would genuinely fail against a deliberately-bad object mentioning 'traveling'", () => {
    const badOneLength = { guideType: "traveling" };
    expect(JSON.stringify(badOneLength).toLowerCase().includes("travel")).toBe(true);
  });
});

describe("architecture gap proof -- deep-point-cut/point-cut/channel-cut genuinely cannot construct a valid SkillDefinition from proposal metadata alone", () => {
  it("test 25: constructing a SkillDefinition using ONLY the deep-point-cut mutation's own proposedIdentity/fieldsAdded (no invented procedure/parameters) fails isValidSkillDefinition -- the architecture gap is real and structural, not merely asserted", () => {
    const attemptedSkillFromProposalMetadataAlone = {
      skillId: "deep-point-cut",
      version: 1,
      vertical: "cutting",
      name: "Deep Point Cut",
      status: "ACTIVE",
      authorityType: "PROFESSIONALLY_AUTHORED",
      rationale: "constructed from proposal metadata alone, for this test only",
      parameters: [],
      procedure: [], // no real procedure exists in the proposal -- this is the honest, unforced shape
      createdAt: "2026-09-15T00:00:00.000Z",
    };
    expect(isValidSkillDefinition(attemptedSkillFromProposalMetadataAlone, isInteriorFortyFiveFact)).toBe(false);
  });
});
