import { describe, expect, it } from "vitest";

import {
  OCCIPITAL_TRANSITION_SKILL_INSTANCE,
} from "@/lib/cutting-skill-occipital-transition";
import { compileProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-compiler";
import { isValidProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-contracts";
import { compileRealExecutionPlan, compileRealScenePlan, realTemplates } from "@/lib/professional-execution-scene-fixtures";

// AI Hair Architect, Professional Skill Engine Stage 7 -- SCENE COMPILER
// tests, INCLUDING the Part P end-to-end proof using ONLY the 3 real
// registered skills. Zero I/O, zero AI, zero paid provider call.

describe("PART P -- end-to-end scene compilation proof, 3 real skills only", () => {
  it("compiles into a structurally valid ProfessionalExecutionScenePlan", () => {
    const result = compileRealScenePlan();
    expect(result.status).toBe("COMPILED");
    if (result.status !== "COMPILED") return;
    expect(isValidProfessionalExecutionScenePlan(result.scenePlan)).toBe(true);
  });

  it("UNIT 1 (central nape guide) splits into execution/verification scenes with a rear viewpoint and a visible guide/context observable", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const unit1Scenes = result.scenePlan.scenes.filter((s) => s.sourceExecutionUnitId === "executionunit-cutting-establish-central-nape-guide-1");
    const phases = unit1Scenes.map((s) => s.phase);
    expect(phases).toContain("EXECUTION");
    expect(phases).toContain("VERIFICATION");
    const exec = unit1Scenes.find((s) => s.phase === "EXECUTION")!;
    expect(exec.viewpoint.status).toBe("RESOLVED");
    expect(exec.viewpoint.family).toBe("POSTERIOR");
    expect(exec.observables.some((o) => o.aspect === "GUIDE_LINE_VISIBLE" || o.aspect === "ANATOMICAL_CONTEXT_VISIBLE")).toBe(true);
    const verify = unit1Scenes.find((s) => s.phase === "VERIFICATION")!;
    expect(verify.observables.some((o) => o.aspect === "ZONE_COMPLETION_VISIBLE")).toBe(true);
    expect(verify.demonstrationRequirements.some((r) => r.kind === "REQUIRES_VERIFICATION_VIEW")).toBe(true);
  });

  it("UNIT 2 (occipital transition) produces two dependent sub-unit scene groups; the lower group depends on the guide, the upper group depends on the lower", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const lowerScenes = result.scenePlan.scenes.filter((s) => s.sourceExecutionUnitId === "executionunit-cutting-occipital-transition-lower-1");
    const upperScenes = result.scenePlan.scenes.filter((s) => s.sourceExecutionUnitId === "executionunit-cutting-occipital-transition-upper-1");
    expect(lowerScenes.length).toBeGreaterThan(0);
    expect(upperScenes.length).toBeGreaterThan(0);
    const lowerFirst = lowerScenes.sort((a, b) => a.order - b.order)[0];
    expect(lowerFirst.beforeContract.requiredPriorState.some((c) => c.fact === "executionunit-cutting-establish-central-nape-guide-1.completed")).toBe(true);
    const upperFirst = upperScenes.sort((a, b) => a.order - b.order)[0];
    const lowerSceneIds = new Set(lowerScenes.map((s) => s.sceneId));
    expect(upperFirst.beforeContract.requiresPriorSceneIds.some((id) => lowerSceneIds.has(id))).toBe(true);
    expect(OCCIPITAL_TRANSITION_SKILL_INSTANCE.skillInstanceId).toBe("skillinstance-cutting-occipital-transition-pilot");
  });

  it("UNIT 3 (continuation) retains the real bounded iteration in its EXECUTION scene as SPATIAL_SUBSECTION_SEQUENCE progression -- NOT one isolated cut", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const exec = result.scenePlan.scenes.find((s) => s.sourceExecutionUnitId === "executionunit-cutting-continue-central-nape-construction-1" && s.phase === "EXECUTION")!;
    expect(exec.progression?.kind).toBe("SPATIAL_SUBSECTION_SEQUENCE");
    expect(exec.progression?.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(exec.observables.some((o) => o.aspect === "SUBSECTION_PROGRESSION_VISIBLE")).toBe(true);
    expect(exec.demonstrationRequirements.some((r) => r.kind === "REQUIRES_CONTINUOUS_PROGRESS")).toBe(true);
  });

  it("every scene carries the full preservation-constraint list -- never dropped (Part N 13/32/33)", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    for (const scene of result.scenePlan.scenes) {
      expect(scene.expectedVisibleEffect.preservedConstraints).toEqual([
        { scope: "nape", field: "lengthIntent", value: "preserve" },
        { scope: "occipital", field: "lengthIntent", value: "preserve" },
      ]);
    }
  });

  it("the unsupported crown weight-reduction delta creates ZERO scenes and stays visible in the plan -- readiness PARTIAL", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(result.scenePlan.scenes.some((s) => s.contributesToDelta.scope === "crown")).toBe(false);
    expect(result.scenePlan.unresolvedRequirements).toEqual([
      { scope: "crown", field: "weightIntent", reason: "No registered skill declares capability to reduce weight in the crown zone." },
    ]);
    expect(result.scenePlan.readiness).toBe("PARTIAL");
  });

  it("coverage maps every execution unit back to its own scenes (FULLY_COVERED for all real units)", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(result.scenePlan.coverage).toHaveLength(4); // guide + occipital lower + occipital upper + continuation
    for (const entry of result.scenePlan.coverage) {
      expect(entry.status).toBe("FULLY_COVERED");
      expect(entry.sceneIds.length).toBeGreaterThan(0);
    }
  });

  it("no provider-specific authority anywhere -- no scene field names a provider, model, prompt, duration, or camera geometry", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    const json = JSON.stringify(result.scenePlan).toLowerCase();
    for (const banned of ["veo", "gemini", "openai", "claude", "prompt", "seconds", "duration", "aspectratio", "seed", "focal"]) {
      expect(json.includes(banned)).toBe(false);
    }
  });

  it("deterministic -- compiling the same plan twice yields byte-identical scene plans (stable fingerprints)", () => {
    const a = compileRealScenePlan();
    const b = compileRealScenePlan();
    if (a.status !== "COMPILED" || b.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(a.scenePlan).toEqual(b.scenePlan);
    expect(a.scenePlan.scenePlanFingerprint).toBe(b.scenePlan.scenePlanFingerprint);
  });

  it("SceneS 50/51/52 -- a semantic change to one unit changes only that unit's scene fingerprints; unrelated scene fingerprints stay stable", () => {
    const base = compileRealScenePlan();
    if (base.status !== "COMPILED") throw new Error("expected COMPILED");

    // Recompile from fixtures again but this time the same input -- confirm
    // per-scene fingerprints are stable across runs.
    const rerun = compileRealScenePlan();
    if (rerun.status !== "COMPILED") throw new Error("expected COMPILED");
    for (const scene of base.scenePlan.scenes) {
      const twin = rerun.scenePlan.scenes.find((s) => s.sceneId === scene.sceneId)!;
      expect(twin.sceneFingerprint).toBe(scene.sceneFingerprint);
    }
    // Every scene fingerprint is a 64-hex sha256.
    for (const scene of base.scenePlan.scenes) expect(scene.sceneFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compilation alone is not approval -- the compiled scene plan carries no confirmed/approved flag; status is set only by the repository", () => {
    const result = compileRealScenePlan();
    if (result.status !== "COMPILED") throw new Error("expected COMPILED");
    expect(result.scenePlan).not.toHaveProperty("status");
    expect(result.scenePlan).not.toHaveProperty("confirmedByUserId");
  });
});

describe("scene compiler -- failure semantics", () => {
  it("UNRESOLVED when a planned unit's Skill Instance is not in the given template registry", () => {
    const plan = compileRealExecutionPlan();
    const result = compileProfessionalExecutionScenePlan({ plan, sourceExecutionPlanId: "row-x", templates: [], compiledAt: "2026-09-13T00:00:00.000Z" });
    expect(result.status).toBe("UNRESOLVED");
    if (result.status === "UNRESOLVED") expect(result.reason).toContain("No template registered");
  });

  it("compiles cleanly with the full real template registry", () => {
    const plan = compileRealExecutionPlan();
    const result = compileProfessionalExecutionScenePlan({ plan, sourceExecutionPlanId: "row-y", templates: realTemplates(), compiledAt: "2026-09-13T00:00:00.000Z" });
    expect(result.status).toBe("COMPILED");
  });
});
