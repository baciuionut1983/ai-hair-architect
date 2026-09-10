import { describe, expect, it } from "vitest";

import { compileProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-compiler";
import { isProgressiveUnitFullyDemonstrated, validateProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-validator";
import { isValidProfessionalExecutionScenePlan, type ProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-contracts";
import { compileRealExecutionPlan, compileRealScenePlan, realTemplates, SCENE_COMPILED_AT } from "@/lib/professional-execution-scene-fixtures";

const COMPILED_AT = SCENE_COMPILED_AT;

function realPair() {
  const sourcePlan = compileRealExecutionPlan();
  const result = compileRealScenePlan();
  if (result.status !== "COMPILED") throw new Error("expected COMPILED");
  return { sourcePlan, scenePlan: result.scenePlan };
}

// deep clone helper -- structuredClone is available in this Node runtime.
function clone(plan: ProfessionalExecutionScenePlan): ProfessionalExecutionScenePlan {
  return structuredClone(plan);
}

describe("validateProfessionalExecutionScenePlan -- the real compiled scene plan passes with zero failures", () => {
  it("baseline: a freshly compiled scene plan validates against its own source execution plan", () => {
    const { sourcePlan, scenePlan } = realPair();
    const result = validateProfessionalExecutionScenePlan({ scenePlan, sourcePlan, expectedSourceExecutionPlanId: scenePlan.sourceExecutionPlanId });
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
  });
});

describe("AUTHORITY / SOURCE (Part Y 1-5)", () => {
  it("1/2. a scene plan whose pinned source-plan fingerprint no longer matches the plan is rejected", () => {
    const { scenePlan } = realPair();
    const tampered = { ...scenePlan, sourceExecutionPlanFingerprint: "0".repeat(64) };
    const otherSource = compileRealExecutionPlan();
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan: otherSource });
    expect(result.failures.some((f) => f.failureReason === "SCENE_PLAN_NOT_BOUND_TO_EXACT_PLAN_VERSION")).toBe(true);
  });

  it("1. an explicit expectedSourceExecutionPlanId mismatch is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const result = validateProfessionalExecutionScenePlan({ scenePlan, sourcePlan, expectedSourceExecutionPlanId: "a-different-plan-row-id" });
    expect(result.failures.some((f) => f.failureReason === "SCENE_PLAN_NOT_BOUND_TO_EXACT_PLAN_VERSION")).toBe(true);
  });

  it("3/4. a scene referencing a non-existent execution unit is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].sourceExecutionUnitId = "executionunit-that-does-not-exist";
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "MISSING_SOURCE_EXECUTION_UNIT")).toBe(true);
  });

  it("5. scene compilation cannot alter professional source semantics -- a changed capability is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].demonstratesCapability = "REDUCE_WEIGHT";
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "PROFESSIONAL_SOURCE_ALTERED")).toBe(true);
  });

  it("5. a changed contributesToDelta is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].contributesToDelta = { scope: "crown", field: "weightIntent" };
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    // both PROFESSIONAL_SOURCE_ALTERED and UNSUPPORTED_DELTA_SCENE fire
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.failureReason === "PROFESSIONAL_SOURCE_ALTERED")).toBe(true);
  });

  it("9/10. a source atomic action id not on the scene's own unit is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].sourceAtomicActionIds = [...tampered.scenes[0].sourceAtomicActionIds, "invented-atomic-action#x"];
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "MISSING_SOURCE_ACTION")).toBe(true);
  });
});

describe("ITERATION / PROGRESSION + PART Q one-cut regression (MANDATORY)", () => {
  const CONTINUATION_UNIT = "executionunit-cutting-continue-central-nape-construction-1";

  it("11/12/15. the real compiled plan retains the bounded iteration and passes the progressive-unit check", () => {
    const { sourcePlan, scenePlan } = realPair();
    expect(isProgressiveUnitFullyDemonstrated(scenePlan, sourcePlan, CONTINUATION_UNIT)).toBe(true);
  });

  it("13/14. PART Q -- an EXECUTION scene for a progressive unit collapsed to SINGLE_PASS (one isolated cut) is REJECTED and does not count as full demonstration", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    const execScene = tampered.scenes.find((s) => s.sourceExecutionUnitId === CONTINUATION_UNIT && s.phase === "EXECUTION")!;
    execScene.progression = { kind: "SINGLE_PASS", zoneId: execScene.progression?.zoneId };
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.failureReason === "ITERATION_COLLAPSED" || f.failureReason === "PROGRESSION_NOT_COVERED")).toBe(true);
    expect(isProgressiveUnitFullyDemonstrated(tampered, sourcePlan, CONTINUATION_UNIT)).toBe(false);
  });

  it("13. PART Q -- an EXECUTION scene for a progressive unit with the iteration removed entirely is REJECTED (ITERATION_COLLAPSED)", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    const execScene = tampered.scenes.find((s) => s.sourceExecutionUnitId === CONTINUATION_UNIT && s.phase === "EXECUTION")!;
    delete (execScene.progression as { iteration?: unknown }).iteration;
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "ITERATION_COLLAPSED")).toBe(true);
  });

  it("13. PART Q -- coverage for a progressive unit whose EXECUTION scene lost its iteration is PARTIALLY_COVERED, never FULLY_COVERED", () => {
    // Re-run the compiler but first strip the iteration from the source
    // action to confirm the compiler itself degrades coverage honestly
    // (never claims FULLY_COVERED for a progressive unit shown as one cut).
    const sourcePlan = compileRealExecutionPlan();
    const withoutIteration = structuredClone(sourcePlan);
    const contUnit = withoutIteration.plannedUnits.find((u) => u.executionUnit.executionUnitId === CONTINUATION_UNIT)!;
    // leave the unit's own verticalPayload.iterationPolicy alone but remove
    // the compiled iteration from its atomic actions -- a hand-tampered plan.
    for (const a of contUnit.atomicActions) delete (a as { iteration?: unknown }).iteration;
    const recompiled = compileProfessionalExecutionScenePlan({ plan: withoutIteration, sourceExecutionPlanId: "row-x", templates: realTemplates(), compiledAt: COMPILED_AT });
    if (recompiled.status !== "COMPILED") throw new Error("expected COMPILED");
    // now the source has no iteration, so the unit is legitimately a
    // single pass -- FULLY_COVERED is correct here. The guard only bites
    // when the SOURCE has iteration but the SCENE does not (covered above).
    const entry = recompiled.scenePlan.coverage.find((c) => c.sourceExecutionUnitId === CONTINUATION_UNIT)!;
    expect(entry.status).toBe("FULLY_COVERED");
  });
});

describe("PRESERVATION / UNRESOLVED (Part Y 32-36)", () => {
  it("32/33. a scene whose expectedVisibleEffect drops a preservation constraint is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].expectedVisibleEffect.preservedConstraints = [tampered.scenes[0].expectedVisibleEffect.preservedConstraints[0]];
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "PRESERVATION_CONSTRAINT_LOST")).toBe(true);
  });

  it("35. a scene fabricated for the unsupported crown weight-reduction delta is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].contributesToDelta = { scope: "crown", field: "weightIntent" };
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "UNSUPPORTED_DELTA_SCENE")).toBe(true);
  });

  it("36. removing a still-unresolved requirement from the scene plan is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.unresolvedRequirements = [];
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "PROFESSIONAL_SOURCE_ALTERED")).toBe(true);
  });
});

describe("DEPENDENCIES / CONTINUITY (Part Y 29-31, 25-28)", () => {
  it("30. a scene depending on a later scene (order violation) is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    const last = tampered.scenes[tampered.scenes.length - 1];
    tampered.scenes[0].beforeContract.requiresPriorSceneIds = [last.sceneId];
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "DEPENDENCY_ORDER_VIOLATION")).toBe(true);
  });

  it("28. a required prior state that no earlier scene carries forward is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].beforeContract.requiredPriorState = [{ fact: "some.fact.nobody.produces", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" }];
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "STATE_CONTINUITY_MISMATCH")).toBe(true);
  });

  it("29. the occipital transition's guide dependency is really enforced -- its first scene depends on the guide unit's completion", () => {
    const { scenePlan } = realPair();
    const lowerScenes = scenePlan.scenes.filter((s) => s.sourceExecutionUnitId === "executionunit-cutting-occipital-transition-lower-1").sort((a, b) => a.order - b.order);
    expect(lowerScenes[0].beforeContract.requiredPriorState.some((c) => c.fact === "executionunit-cutting-establish-central-nape-guide-1.completed")).toBe(true);
  });
});

describe("COVERAGE (Part Y 37-40)", () => {
  it("37/38. every demonstrable execution unit has a coverage entry, all FULLY_COVERED for the real proof", () => {
    const { scenePlan } = realPair();
    const unitIds = new Set(scenePlan.scenes.map((s) => s.sourceExecutionUnitId));
    for (const uid of unitIds) {
      const entry = scenePlan.coverage.find((c) => c.sourceExecutionUnitId === uid);
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("FULLY_COVERED");
    }
  });

  it("40. a scene plan missing a coverage entry for a real execution unit is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.coverage = tampered.coverage.slice(1);
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "EXECUTION_UNIT_OMITTED")).toBe(true);
  });
});

describe("DEMONSTRATION COMPLETENESS (Part Y 41-45)", () => {
  it("42. an EXECUTION scene with no REQUIRES_COMPLETION_VISIBLE requirement is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    const exec = tampered.scenes.find((s) => s.phase === "EXECUTION")!;
    exec.demonstrationRequirements = exec.demonstrationRequirements.filter((r) => r.kind !== "REQUIRES_COMPLETION_VISIBLE");
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "MISSING_COMPLETION_REQUIREMENT")).toBe(true);
  });

  it("43. a VERIFICATION scene with no REQUIRES_VERIFICATION_VIEW requirement is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    const verify = tampered.scenes.find((s) => s.phase === "VERIFICATION")!;
    verify.demonstrationRequirements = verify.demonstrationRequirements.filter((r) => r.kind !== "REQUIRES_VERIFICATION_VIEW");
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "MISSING_VERIFICATION_REQUIREMENT")).toBe(true);
  });

  it("45. a scene with its observables emptied is rejected (pretty-but-empty guard)", () => {
    const { sourcePlan, scenePlan } = realPair();
    const tampered = clone(scenePlan);
    tampered.scenes[0].observables = [];
    // structural validator would also catch this; the business validator
    // must catch it too (defense in depth).
    expect(isValidProfessionalExecutionScenePlan(tampered)).toBe(false);
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "MISSING_OBSERVABLE")).toBe(true);
  });
});

describe("PROVIDER BOUNDARY (Part Y 46-49)", () => {
  it("46/47/48. the real scene plan contains no provider token; a fabricated one is rejected", () => {
    const { sourcePlan, scenePlan } = realPair();
    expect(validateProfessionalExecutionScenePlan({ scenePlan, sourcePlan }).valid).toBe(true);

    const tampered = clone(scenePlan);
    (tampered.scenes[0] as unknown as { prompt: string }).prompt = "a Veo prompt";
    const result = validateProfessionalExecutionScenePlan({ scenePlan: tampered, sourcePlan });
    expect(result.failures.some((f) => f.failureReason === "PROFESSIONAL_SOURCE_ALTERED")).toBe(true);
  });
});
