import { describe, expect, it } from "vitest";

import {
  PROFESSIONAL_EXECUTION_SCENE_PLAN_READINESS_STATES,
  SCENE_COVERAGE_STATUSES,
  SCENE_PHASES,
  SCENE_PLAN_FAILURE_REASONS,
  SCENE_PROGRESSION_KINDS,
  computeSceneFingerprint,
  computeScenePlanFingerprint,
  isProfessionalExecutionScenePlanReadiness,
  isScenePhase,
  isScenePlanFailureReason,
  isValidProfessionalExecutionScene,
  isValidProfessionalExecutionScenePlan,
  type ProfessionalExecutionScene,
  type ProfessionalExecutionScenePlan,
} from "@/lib/professional-execution-scene-contracts";

// SYNTHETIC TEST FIXTURE -- not real professional authority. Pure, zero
// I/O, zero AI.

function syntheticScene(overrides: Partial<ProfessionalExecutionScene> = {}): ProfessionalExecutionScene {
  return {
    sceneId: "eu-1#scene-execution",
    order: 1,
    phase: "EXECUTION",
    sourceExecutionUnitId: "eu-1",
    sourceAtomicActionIds: ["eu-1#control", "eu-1#execute"],
    sourceVideoInstructionIds: ["eu-1#control#video"],
    demonstratesCapability: "ESTABLISH_GUIDE",
    contributesToDelta: { scope: "nape", field: "lengthIntent" },
    beforeContract: { requiresPriorSceneIds: [], requiredPriorState: [] },
    progression: { kind: "SINGLE_PASS", zoneId: "center_nape" },
    completionCriterion: { fact: "eu-1.completed", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" },
    expectedVisibleEffect: {
      stateTransitions: [{ fact: "eu-1.completed", toValue: true }],
      preservedConstraints: [{ scope: "nape", field: "lengthIntent", value: "preserve" }],
    },
    observables: [{ aspect: "GUIDE_LINE_VISIBLE", sourceRequirementIds: ["eu-1#control#requirement-1"] }],
    verification: { mode: "RUNTIME_PROFESSIONAL_OBSERVATION", criterion: { fact: "eu-1.completed", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" } },
    viewpoint: { status: "RESOLVED", family: "POSTERIOR", framingSemantics: ["GEOMETRY_READABLE"], sourceViewpointConstraintIds: ["eu-1#control#viewpoint-1"] },
    continuity: { mustRemainStable: ["SAME_CLIENT_AND_HEAD"], carriesForward: [{ fact: "eu-1.completed", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" }] },
    demonstrationRequirements: [{ kind: "MUST_SHOW", subject: "ESTABLISH_GUIDE" }, { kind: "REQUIRES_COMPLETION_VISIBLE" }],
    requiredMedium: "MOTION_REQUIRED",
    sceneFingerprint: "a".repeat(64),
    ...overrides,
  };
}

function syntheticPlan(overrides: Partial<ProfessionalExecutionScenePlan> = {}): ProfessionalExecutionScenePlan {
  return {
    schemaVersion: "1.0.0-pes7",
    compilerVersion: "1.0.0",
    sourceExecutionPlanId: "plan-row-1",
    sourceExecutionPlanFingerprint: "f".repeat(64),
    sourceReasoningProposalId: "reasoning-1",
    currentSnapshotId: "current-1",
    currentSnapshotVersion: 1,
    targetSnapshotId: "target-1",
    targetSnapshotVersion: 1,
    scenes: [syntheticScene()],
    coverage: [{ sourceExecutionUnitId: "eu-1", status: "FULLY_COVERED", sceneIds: ["eu-1#scene-execution"] }],
    preservationConstraints: [{ scope: "nape", field: "lengthIntent", value: "preserve", description: "SYNTHETIC." }],
    unresolvedRequirements: [{ scope: "crown", field: "weightIntent", reason: "SYNTHETIC." }],
    readiness: "PARTIAL",
    scenePlanFingerprint: "b".repeat(64),
    ...overrides,
  };
}

describe("professional-execution-scene-contracts", () => {
  it("SCENE_PHASES / progression / coverage / readiness / failure-reason vocabularies are the expected closed sets", () => {
    expect([...SCENE_PHASES]).toEqual(["PREPARATION", "EXECUTION", "VERIFICATION"]);
    expect([...SCENE_PROGRESSION_KINDS]).toEqual(["SINGLE_PASS", "SPATIAL_SUBSECTION_SEQUENCE", "MIRRORED_BILATERAL"]);
    expect([...SCENE_COVERAGE_STATUSES]).toEqual(["FULLY_COVERED", "PARTIALLY_COVERED", "NOT_DEMONSTRABLE", "NEEDS_INPUT", "UNRESOLVED"]);
    expect([...PROFESSIONAL_EXECUTION_SCENE_PLAN_READINESS_STATES]).toEqual(["READY_FOR_PROFESSIONAL_REVIEW", "PARTIAL", "NEEDS_INPUT", "BLOCKED"]);
    expect(isScenePhase("EXECUTION")).toBe(true);
    expect(isScenePhase("RENDER")).toBe(false);
    expect(isProfessionalExecutionScenePlanReadiness("PARTIAL")).toBe(true);
    for (const r of SCENE_PLAN_FAILURE_REASONS) expect(isScenePlanFailureReason(r)).toBe(true);
    expect(isScenePlanFailureReason("invalid scene")).toBe(false);
  });

  it("a structurally valid scene passes isValidProfessionalExecutionScene", () => {
    expect(isValidProfessionalExecutionScene(syntheticScene())).toBe(true);
  });

  it("a scene with BOTH progression and a not-applicable reason is rejected; a scene with NEITHER is rejected", () => {
    expect(isValidProfessionalExecutionScene({ ...syntheticScene(), progressionNotApplicableReason: "x" })).toBe(false);
    const { progression: _p, ...withoutProgression } = syntheticScene();
    void _p;
    expect(isValidProfessionalExecutionScene(withoutProgression)).toBe(false);
    expect(isValidProfessionalExecutionScene({ ...withoutProgression, progressionNotApplicableReason: "positioning only" })).toBe(true);
  });

  it("a SPATIAL_SUBSECTION_SEQUENCE progression with no iteration is rejected (Part Q at the type level)", () => {
    expect(isValidProfessionalExecutionScene({ ...syntheticScene(), progression: { kind: "SPATIAL_SUBSECTION_SEQUENCE", zoneId: "z" } })).toBe(false);
    expect(
      isValidProfessionalExecutionScene({
        ...syntheticScene(),
        progression: { kind: "SPATIAL_SUBSECTION_SEQUENCE", zoneId: "z", iteration: { mode: "UNTIL_EXECUTION_UNIT_COMPLETE" } },
      }),
    ).toBe(true);
  });

  it("a scene with no observables is rejected; a scene with an empty verification criterion fact is rejected", () => {
    expect(isValidProfessionalExecutionScene({ ...syntheticScene(), observables: [] })).toBe(false);
    expect(
      isValidProfessionalExecutionScene({
        ...syntheticScene(),
        verification: { mode: "RUNTIME_PROFESSIONAL_OBSERVATION", criterion: { fact: "", expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" } },
      }),
    ).toBe(false);
  });

  it("a RESOLVED viewpoint with no family is rejected; a NEEDS_INPUT viewpoint with no family/framings is accepted (fail-closed but representable)", () => {
    expect(isValidProfessionalExecutionScene({ ...syntheticScene(), viewpoint: { status: "RESOLVED", framingSemantics: [], sourceViewpointConstraintIds: [] } })).toBe(false);
    expect(isValidProfessionalExecutionScene({ ...syntheticScene(), viewpoint: { status: "NEEDS_INPUT", framingSemantics: [], sourceViewpointConstraintIds: [] } })).toBe(true);
  });

  it("a structurally valid scene plan passes; scene order must be contiguous 1..N with unique ids", () => {
    expect(isValidProfessionalExecutionScenePlan(syntheticPlan())).toBe(true);
    const twoScenes = syntheticPlan({
      scenes: [syntheticScene({ sceneId: "s1", order: 1 }), syntheticScene({ sceneId: "s2", order: 3 })],
      coverage: [{ sourceExecutionUnitId: "eu-1", status: "FULLY_COVERED", sceneIds: ["s1", "s2"] }],
    });
    expect(isValidProfessionalExecutionScenePlan(twoScenes)).toBe(false);
  });

  it("computeSceneFingerprint is deterministic and order-insensitive on its set-valued inputs; a semantic change flips it", () => {
    const base = {
      sourceExecutionPlanId: "p",
      sourceExecutionUnitId: "u",
      phase: "EXECUTION" as const,
      sourceAtomicActionIds: ["a2", "a1"],
      demonstratesCapability: "ESTABLISH_GUIDE",
      contributesToDelta: { scope: "nape", field: "lengthIntent" },
      progression: undefined,
      completionCriterion: { fact: "u.completed", expectedValue: true as const, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" as const },
      observableAspects: ["B", "A"],
      viewpointFamily: "POSTERIOR",
      framingSemantics: ["GEOMETRY_READABLE"],
      preservedConstraints: [{ scope: "nape", field: "lengthIntent", value: "preserve" }],
      compilerVersion: "1.0.0",
    };
    const f1 = computeSceneFingerprint(base);
    const f2 = computeSceneFingerprint({ ...base, sourceAtomicActionIds: ["a1", "a2"], observableAspects: ["A", "B"] });
    expect(f1).toBe(f2);
    const f3 = computeSceneFingerprint({ ...base, demonstratesCapability: "CONNECT_ZONES" });
    expect(f3).not.toBe(f1);
    expect(f1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeScenePlanFingerprint changes iff a scene fingerprint or the source-plan fingerprint changes", () => {
    const base = { sourceExecutionPlanId: "p", sourceExecutionPlanFingerprint: "x".repeat(64), compilerVersion: "1.0.0", schemaVersion: "1.0.0-pes7", sceneFingerprints: ["a", "b"] };
    expect(computeScenePlanFingerprint(base)).toBe(computeScenePlanFingerprint({ ...base }));
    expect(computeScenePlanFingerprint({ ...base, sceneFingerprints: ["a", "c"] })).not.toBe(computeScenePlanFingerprint(base));
    expect(computeScenePlanFingerprint({ ...base, sourceExecutionPlanFingerprint: "y".repeat(64) })).not.toBe(computeScenePlanFingerprint(base));
  });
});
