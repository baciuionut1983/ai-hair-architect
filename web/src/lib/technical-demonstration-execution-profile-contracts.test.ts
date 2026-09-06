import { describe, expect, it } from "vitest";

import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";
import type { TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import { evaluatePlanReadiness } from "@/lib/technical-demonstration-cutting-video-readiness";
import { deriveEffectiveExecutionState } from "@/lib/technical-demonstration-cutting-state-derivation";
import {
  EXECUTION_PROFILE_AUTHORITY_TYPES,
  EXECUTION_PROFILE_STATUSES,
  findConflictingExecutionFieldRules,
  isExecutionProfileEligibleForAuthority,
  isValidExecutionFieldRule,
  isValidExecutionProfileKey,
  isValidExecutionRuleCondition,
  isValidProfessionalTechniqueExecutionProfile,
  type ExecutionFieldRule,
  type ProfessionalTechniqueExecutionProfile,
} from "@/lib/technical-demonstration-execution-profile-contracts";

// Technical Demonstration, Stage 2.5.h.2b -- pure contract tests for the
// Professional Technique Execution Profile FOUNDATION. No I/O, no database,
// no provider. Every fixture below is DELIBERATELY SYNTHETIC and clearly
// labeled as such -- "SYNTHETIC TEST FIXTURE, not a real professional rule"
// appears in every rationale string. No real haircut technique fact is
// ever encoded here, per this stage's own explicit "no real professional
// rules" boundary.

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";

function syntheticRule(overrides: Partial<ExecutionFieldRule> = {}): ExecutionFieldRule {
  return {
    ruleId: "synthetic-rule-1",
    field: "clientHeadPosition",
    semantic: "UNDEFINED",
    rationale: SYNTHETIC,
    ...overrides,
  };
}

function syntheticProfile(overrides: Partial<ProfessionalTechniqueExecutionProfile> = {}): ProfessionalTechniqueExecutionProfile {
  return {
    profileId: "synthetic.test.profile",
    version: 1,
    key: { vertical: "cutting", actionType: "SECTIONING_ACTION", techniqueSelector: { kind: "sectioning", sectioning: "horseshoe_crown" } },
    status: "DRAFT",
    authorityType: "MACHINE_DRAFTED",
    rationale: SYNTHETIC,
    fieldRules: [syntheticRule()],
    createdAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Stable identity and version.
// ---------------------------------------------------------------------------
describe("profile identity and version (test 1)", () => {
  it("two versions of the same profileId are distinct, independently valid snapshots -- never an in-place update", () => {
    const v1 = syntheticProfile({ version: 1, status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    const v2 = syntheticProfile({ version: 2, status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isValidProfessionalTechniqueExecutionProfile(v1)).toBe(true);
    expect(isValidProfessionalTechniqueExecutionProfile(v2)).toBe(true);
    expect(v1.profileId).toBe(v2.profileId);
    expect(v1.version).not.toBe(v2.version);
    expect(v1).not.toBe(v2); // genuinely separate objects, no shared mutable state
  });

  it("version must be a positive integer", () => {
    expect(isValidProfessionalTechniqueExecutionProfile(syntheticProfile({ version: 0 }))).toBe(false);
    expect(isValidProfessionalTechniqueExecutionProfile(syntheticProfile({ version: 1.5 }))).toBe(false);
    expect(isValidProfessionalTechniqueExecutionProfile(syntheticProfile({ version: -1 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Explicit lifecycle/status.
// ---------------------------------------------------------------------------
describe("profile lifecycle/status (test 2)", () => {
  it("DRAFT, ACTIVE, RETIRED are the exact closed set", () => {
    expect(EXECUTION_PROFILE_STATUSES).toEqual(["DRAFT", "ACTIVE", "RETIRED"]);
  });

  it("PROFESSIONALLY_AUTHORED, PROFESSIONALLY_REVIEWED, MACHINE_DRAFTED are the exact closed authority-type set", () => {
    expect(EXECUTION_PROFILE_AUTHORITY_TYPES).toEqual(["PROFESSIONALLY_AUTHORED", "PROFESSIONALLY_REVIEWED", "MACHINE_DRAFTED"]);
  });

  it("an unrecognized status is rejected", () => {
    expect(isValidProfessionalTechniqueExecutionProfile(syntheticProfile({ status: "PUBLISHED" as never }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Field rules reuse the EXISTING execution field universe.
// ---------------------------------------------------------------------------
describe("field-rule field universe (test 3)", () => {
  it("accepts a real CuttingStepOverrideFieldName", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "zones", semantic: "UNDEFINED" }))).toBe(true);
    expect(isValidExecutionFieldRule(syntheticRule({ field: "subsectioning", semantic: "UNDEFINED" }))).toBe(true);
    expect(isValidExecutionFieldRule(syntheticRule({ field: "observationView", semantic: "UNDEFINED" }))).toBe(true);
    expect(isValidExecutionFieldRule(syntheticRule({ field: "styling", semantic: "UNDEFINED" }))).toBe(true);
  });

  it("rejects an invented field name that does not exist in the real field universe", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "stylingFinish" as never }))).toBe(false);
    expect(isValidExecutionFieldRule(syntheticRule({ field: "observationViewpoint" as never }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. REQUIRED_FIXED requires a valid structured value.
// ---------------------------------------------------------------------------
describe("REQUIRED_FIXED (test 4)", () => {
  it("valid when fixedValue passes the field's own real validator", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "tool", semantic: "REQUIRED_FIXED", fixedValue: "SYNTHETIC-TEST-TOOL" }))).toBe(true);
  });

  it("invalid with no fixedValue at all", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "tool", semantic: "REQUIRED_FIXED" }))).toBe(false);
  });

  it("invalid when fixedValue fails the field's own real validator (e.g. boolean field given a string)", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "overdirection", semantic: "REQUIRED_FIXED", fixedValue: "not-a-boolean" }))).toBe(false);
  });

  it("invalid if allowedOptions or condition is also supplied -- semantics never cross-contaminate", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "tool", semantic: "REQUIRED_FIXED", fixedValue: "x", allowedOptions: ["x", "y"] }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. PROFESSIONAL_CHOICE with allowed structured choices.
// ---------------------------------------------------------------------------
describe("PROFESSIONAL_CHOICE (test 5)", () => {
  it("valid with a non-empty set of individually-valid options", () => {
    expect(
      isValidExecutionFieldRule(syntheticRule({ field: "clientHeadPosition", semantic: "PROFESSIONAL_CHOICE", allowedOptions: ["SYNTHETIC-A", "SYNTHETIC-B"] })),
    ).toBe(true);
  });

  it("invalid with an empty options array -- a reviewed profile must narrow the choice, never punt", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "clientHeadPosition", semantic: "PROFESSIONAL_CHOICE", allowedOptions: [] }))).toBe(false);
  });

  it("invalid when any one option fails the field's own real validator", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ field: "overdirection", semantic: "PROFESSIONAL_CHOICE", allowedOptions: [true, "not-a-boolean"] }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. NOT_APPLICABLE is explicit, never implicit from UNKNOWN.
// ---------------------------------------------------------------------------
describe("NOT_APPLICABLE (test 6)", () => {
  it("valid, bare, with no value/options/condition attached", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ semantic: "NOT_APPLICABLE" }))).toBe(true);
  });

  it("invalid if a fixedValue is attached -- NOT_APPLICABLE can never smuggle a value", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ semantic: "NOT_APPLICABLE", fixedValue: "x" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. CLIENT_DERIVED never fabricates a client value.
// ---------------------------------------------------------------------------
describe("CLIENT_DERIVED (test 7)", () => {
  it("valid, bare -- marks the field as sourced from approved client evidence, resolved by a later stage", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ semantic: "CLIENT_DERIVED" }))).toBe(true);
  });

  it("invalid if it carries a fixedValue -- this contract must never invent the client's own value", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ semantic: "CLIENT_DERIVED", fixedValue: "invented-client-value" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8/9. REQUIRED_CONDITIONAL uses deterministic typed conditions; arbitrary
// executable/free-form conditions are never accepted.
// ---------------------------------------------------------------------------
describe("REQUIRED_CONDITIONAL and the condition model (tests 8, 9)", () => {
  it("valid with a real, typed equals condition", () => {
    const condition = { op: "equals" as const, fact: "actionType" as const, value: "SECTIONING_ACTION" };
    expect(isValidExecutionRuleCondition(condition)).toBe(true);
    expect(isValidExecutionFieldRule(syntheticRule({ semantic: "REQUIRED_CONDITIONAL", condition }))).toBe(true);
  });

  it("valid with a nested and/or/not condition tree", () => {
    const condition = {
      op: "and" as const,
      conditions: [
        { op: "equals" as const, fact: "elevation" as const, value: "0_deg_blunt" },
        { op: "not" as const, condition: { op: "in" as const, fact: "toolCategory" as const, values: ["synthetic-a", "synthetic-b"] } },
      ],
    };
    expect(isValidExecutionRuleCondition(condition)).toBe(true);
  });

  it("invalid with no condition at all", () => {
    expect(isValidExecutionFieldRule(syntheticRule({ semantic: "REQUIRED_CONDITIONAL" }))).toBe(false);
  });

  it("rejects an unrecognized/free-form op -- there is no 'javascript'/'eval'/'expression' op", () => {
    expect(isValidExecutionRuleCondition({ op: "javascript", code: "process.exit()" })).toBe(false);
    expect(isValidExecutionRuleCondition({ op: "eval", expression: "1===1" })).toBe(false);
  });

  it("rejects a condition referencing an unrecognized fact name", () => {
    expect(isValidExecutionRuleCondition({ op: "equals", fact: "clientFavoriteColor", value: "red" })).toBe(false);
  });

  it("rejects a condition carrying an actual function instead of data", () => {
    const malformed = { op: "equals", fact: "actionType", value: (() => true) as unknown as string };
    expect(isValidExecutionRuleCondition(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. UNDEFINED remains unresolved.
// ---------------------------------------------------------------------------
describe("UNDEFINED (test 10)", () => {
  it("valid, bare, and carries no resolution of any kind", () => {
    const rule = syntheticRule({ semantic: "UNDEFINED" });
    expect(isValidExecutionFieldRule(rule)).toBe(true);
    expect(rule.fixedValue).toBeUndefined();
    expect(rule.allowedOptions).toBeUndefined();
    expect(rule.condition).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 11-14. Authority eligibility: only ACTIVE + professionally-reviewed
// authority is ever eligible; DRAFT/RETIRED/MACHINE_DRAFTED never are.
// ---------------------------------------------------------------------------
describe("authority eligibility predicate (tests 11, 12, 13, 14)", () => {
  it("ACTIVE + PROFESSIONALLY_AUTHORED is eligible", () => {
    const profile = syntheticProfile({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isValidProfessionalTechniqueExecutionProfile(profile)).toBe(true);
    expect(isExecutionProfileEligibleForAuthority(profile)).toBe(true);
  });

  it("ACTIVE + PROFESSIONALLY_REVIEWED (with reviewer stamped) is eligible", () => {
    const profile = syntheticProfile({ status: "ACTIVE", authorityType: "PROFESSIONALLY_REVIEWED", reviewedByUserId: "user-1", reviewedAt: "2026-09-07T00:00:00.000Z" });
    expect(isValidProfessionalTechniqueExecutionProfile(profile)).toBe(true);
    expect(isExecutionProfileEligibleForAuthority(profile)).toBe(true);
  });

  it("DRAFT is never eligible, even with a professionally-authored authority type", () => {
    const profile = syntheticProfile({ status: "DRAFT", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isExecutionProfileEligibleForAuthority(profile)).toBe(false);
  });

  it("RETIRED is never eligible", () => {
    const profile = syntheticProfile({ status: "RETIRED", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isExecutionProfileEligibleForAuthority(profile)).toBe(false);
  });

  it("a MACHINE_DRAFTED profile can never even be constructed as ACTIVE -- structurally prevented, not just deemed ineligible", () => {
    expect(isValidProfessionalTechniqueExecutionProfile(syntheticProfile({ status: "ACTIVE", authorityType: "MACHINE_DRAFTED" }))).toBe(false);
  });

  it("a MACHINE_DRAFTED DRAFT profile is a valid OBJECT (an honest 'AI draft awaiting review' state) but never eligible authority", () => {
    const profile = syntheticProfile({ status: "DRAFT", authorityType: "MACHINE_DRAFTED" });
    expect(isValidProfessionalTechniqueExecutionProfile(profile)).toBe(true);
    expect(isExecutionProfileEligibleForAuthority(profile)).toBe(false);
  });

  it("PROFESSIONALLY_REVIEWED without a stamped reviewer/timestamp is invalid -- review must be traceable, never assumed", () => {
    expect(isValidProfessionalTechniqueExecutionProfile(syntheticProfile({ status: "ACTIVE", authorityType: "PROFESSIONALLY_REVIEWED" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 15. Duplicate conflicting rules within one profile are detected.
// ---------------------------------------------------------------------------
describe("conflict detection (test 15)", () => {
  it("finds a field targeted by two rules in the same profile", () => {
    const conflicts = findConflictingExecutionFieldRules([
      syntheticRule({ ruleId: "r1", field: "zones" }),
      syntheticRule({ ruleId: "r2", field: "zones" }),
      syntheticRule({ ruleId: "r3", field: "styling" }),
    ]);
    expect(conflicts).toEqual(["zones"]);
  });

  it("a profile with a field conflict is rejected as a whole, not silently resolved", () => {
    const profile = syntheticProfile({
      fieldRules: [syntheticRule({ ruleId: "r1", field: "zones" }), syntheticRule({ ruleId: "r2", field: "zones" })],
    });
    expect(isValidProfessionalTechniqueExecutionProfile(profile)).toBe(false);
  });

  it("no conflict when every rule targets a distinct field", () => {
    expect(findConflictingExecutionFieldRules([syntheticRule({ field: "zones" }), syntheticRule({ field: "styling" })])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 16. Profile identity avoids a Cartesian-product key.
// ---------------------------------------------------------------------------
describe("profile key -- smallest composable identity, not a Cartesian product (tests 1, 16)", () => {
  it("SECTIONING_ACTION requires only a sectioning selector, not all seven technique dimensions", () => {
    expect(isValidExecutionProfileKey({ vertical: "cutting", actionType: "SECTIONING_ACTION", techniqueSelector: { kind: "sectioning", sectioning: "horseshoe_crown" } })).toBe(true);
  });

  it("STRUCTURAL_CUTTING requires exactly the 3 fields cutting geometry actually depends on", () => {
    expect(
      isValidExecutionProfileKey({
        vertical: "cutting",
        actionType: "STRUCTURAL_CUTTING",
        techniqueSelector: { kind: "structural_cutting", structuralTechnique: "one_length", cuttingTechnique: "blunt_line", elevation: "0_deg_blunt" },
      }),
    ).toBe(true);
  });

  it("FINAL_OBSERVATION requires NO technique selector at all -- its meaning is already fully fixed", () => {
    expect(isValidExecutionProfileKey({ vertical: "cutting", actionType: "FINAL_OBSERVATION" })).toBe(true);
  });

  it("rejects a technique selector supplied for FINAL_OBSERVATION -- it would be meaningless", () => {
    expect(isValidExecutionProfileKey({ vertical: "cutting", actionType: "FINAL_OBSERVATION", techniqueSelector: { kind: "sectioning", sectioning: "horseshoe_crown" } })).toBe(false);
  });

  it("rejects the wrong selector kind for a given actionType", () => {
    expect(isValidExecutionProfileKey({ vertical: "cutting", actionType: "SECTIONING_ACTION", techniqueSelector: { kind: "texturizing", texturizingTechnique: "slice_and_slide" } })).toBe(false);
  });

  it("rejects a selector missing for an actionType that requires one", () => {
    expect(isValidExecutionProfileKey({ vertical: "cutting", actionType: "STRUCTURAL_CUTTING" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 17-21. Zero readiness integration -- proven directly against the real,
// unmodified readiness engine, not just asserted structurally.
// ---------------------------------------------------------------------------
describe("zero readiness integration (tests 17, 18, 19, 20, 21)", () => {
  function realisticCuttingSteps(): CuttingStep[] {
    return [
      { stepNumber: 1, zone: "Mapping and sectioning", action: "Partition using 4 quadrant profile radial with visual balance checkpoints.", elevationAngle: "0_deg_blunt", toolRequired: "tail-comb" },
      { stepNumber: 2, zone: "Baseline guideline", action: "Set a visual perimeter guideline and establish the structural shape with one length.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
      { stepNumber: 3, zone: "Bulk and shape control", action: "Use elevation cutting for perimeter control and natural fall distribution for silhouette correction.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
      { stepNumber: 4, zone: "Texture refinement", action: "Apply slice and slide only after the structural form is established.", elevationAngle: "0_deg_blunt", toolRequired: "texturizer-shear" },
      { stepNumber: 5, zone: "Cross-check and finish", action: "Cross-check symmetry, inspect perimeter balance and silhouette, and compare frontal and profile views to confirm natural fall.", elevationAngle: "0_deg_blunt", toolRequired: "finishing-comb" },
    ];
  }

  function cuttingPlan(): TechnicalCutPlan {
    return {
      structuralTechnique: "one_length",
      cuttingTechnique: "blunt_line",
      texturizingTechnique: "slice_and_slide",
      sectioning: "4_quadrant_profile_radial",
      elevation: "0_deg_blunt",
      distribution: "natural_fall",
      guideline: "visual_perimeter",
      cuttingSteps: realisticCuttingSteps(),
      stylistExplanation: "x",
      clientExplanation: "x",
      professionalReason: "x",
      warnings: [],
      contraindications: [],
      assumptions: [],
      missingData: [],
      confidence: 0.9,
      stylistValidationDisclaimer: "x",
      version: "1.0.0-m8",
    };
  }

  function toStepRecord(stepNumber: number, payload: CuttingDemonstrationStepPayload, explanation: string | null): TechnicalDemonstrationStepRecord {
    return {
      id: `step-${stepNumber}`,
      ownerUserId: "owner-1",
      clientId: "client-1",
      planId: "plan-1",
      vertical: "cutting",
      stepNumber,
      stepSchemaVersion: "1.1.0-td25a",
      payload: payload as unknown as Record<string, unknown>,
      explanation,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  function realisticSteps(): TechnicalDemonstrationStepRecord[] {
    return deriveCuttingDemonstrationSteps(cuttingPlan()).map((derived) => toStepRecord(derived.stepNumber, derived.payload, derived.explanation));
  }

  it("merely importing/using this contract module has zero effect on readiness -- 51 field + 1 DRAFT = 52, exactly as Stage 2.5.h.2a left it", () => {
    // Constructs a real, valid, even ACTIVE-and-eligible synthetic profile
    // (proving the module is fully usable) purely to demonstrate that its
    // mere existence changes nothing about the real readiness computation
    // below -- no field is populated, no NOT_APPLICABLE appears, and the
    // stale free-text description (still present on step 3, untouched) is
    // never read by either the profile contract or readiness itself.
    const profile = syntheticProfile({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isExecutionProfileEligibleForAuthority(profile)).toBe(true);

    const plan = { id: "40f61489-40c0-4072-9c6a-d4b0bd330b1a", planVersion: 4, status: "DRAFT" as const };
    const derived = deriveEffectiveExecutionState(realisticSteps());
    const result = evaluatePlanReadiness(plan, derived);

    const fieldBlockers = result.steps.reduce((n, s) => n + s.reasons.length, 0);
    expect(fieldBlockers).toBe(51);
    expect(result.planLevelReasons).toHaveLength(1);
    expect(fieldBlockers + result.planLevelReasons.length).toBe(52);

    // No auto-N/A, no automatic value: every remaining reason is a real,
    // honest UNKNOWN blocker, never masked.
    for (const step of result.steps) {
      expect(step.reasons.every((r) => typeof r.field === "string")).toBe(true);
    }

    // Stale free text on step 3 remains present and untouched, and had zero
    // influence on the readiness result above (which reads structured
    // fields only, exactly as before this stage).
    const step3 = derived.find((s) => s.stepNumber === 3)!;
    expect(step3.explanation).toContain("elevation cutting");
    const step3Payload = step3.payload as unknown as CuttingDemonstrationStepPayload;
    expect(step3Payload.cuttingTechnique.value).toBe("blunt_line");
  });
});
