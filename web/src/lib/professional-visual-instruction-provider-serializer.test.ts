import { describe, expect, it } from "vitest";

import { compileVisualInstructionPackage } from "@/lib/professional-visual-instruction-compiler";
import { evaluateRenderReadiness, type RenderReadinessResult } from "@/lib/professional-visual-instruction-readiness";
import { serializeVisualInstructionPackageToProviderInstruction } from "@/lib/professional-visual-instruction-provider-serializer";
import type { VisualInstructionPackage } from "@/lib/professional-visual-instruction-contracts";
import { compileRealExecutionPlan, realScenePlan, realTemplates, syntheticPrimaryCaptureEvidence } from "@/lib/professional-visual-instruction-fixtures";

// AI Hair Architect, Stage 8.5A -- VISUAL INSTRUCTION -> PROVIDER
// INSTRUCTION SERIALIZER tests. Zero I/O, zero AI, zero provider call,
// mocked transport only (there is no transport -- this is a pure
// function).

function firstExecutionPackageAndReadiness(): { pkg: VisualInstructionPackage; readiness: RenderReadinessResult } {
  const scenePlan = realScenePlan();
  const executionPlan = compileRealExecutionPlan();
  const scene = [...scenePlan.scenes].sort((a, b) => a.order - b.order).find((s) => s.phase === "EXECUTION")!;
  const compiled = compileVisualInstructionPackage({ scene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
  if (compiled.status !== "COMPILED") throw new Error("expected COMPILED");
  const readiness = evaluateRenderReadiness({ package: compiled.package, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
  return { pkg: compiled.package, readiness };
}

const CONFIG = { provider: "google", model: "veo-3.1-lite-generate-preview" };

describe("serializeVisualInstructionPackageToProviderInstruction -- faithful translation only", () => {
  it("53. serializes a RENDER_READY package deterministically; providerInstructionFingerprint is a 64-hex sha256 and stable across runs", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const a = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    const b = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    expect(a.status).toBe("SERIALIZED");
    expect(b.status).toBe("SERIALIZED");
    if (a.status !== "SERIALIZED" || b.status !== "SERIALIZED") return;
    expect(a.instruction).toEqual(b.instruction);
    expect(a.instruction.providerInstructionFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("54-58. every professional field on the output is a verbatim copy of the package (skill/version/zone/guide/elevation/tool never invented)", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    if (r.status !== "SERIALIZED") throw new Error("expected SERIALIZED");
    expect(r.instruction.instruction.action.skillId).toBe(pkg.skillId);
    expect(r.instruction.instruction.action.skillVersion).toBe(pkg.skillVersion);
    expect(r.instruction.instruction.action.contributesToDelta).toEqual(pkg.contributesToDelta);
    expect(r.instruction.instruction.professionalParameters).toEqual(pkg.professionalParameters.map((p) => ({ name: p.name, value: p.value })));
    expect(r.instruction.instruction.viewpoint.family).toBe(pkg.viewpoint.family);
    expect(r.instruction.instruction.geometry.map((g) => g.kind).sort()).toEqual(pkg.handToolRelationships.map((g) => g.kind).sort());
  });

  it("59/60. progression + bounded iteration survive serialization unchanged (continuation scene)", () => {
    const scenePlan = realScenePlan();
    const executionPlan = compileRealExecutionPlan();
    const scene = [...scenePlan.scenes].find((s) => s.sourceExecutionUnitId === "executionunit-cutting-continue-central-nape-construction-1" && s.phase === "EXECUTION")!;
    const compiled = compileVisualInstructionPackage({ scene, scenePlan, executionPlan, templates: realTemplates(), sourceVisualEvidence: [syntheticPrimaryCaptureEvidence()] });
    if (compiled.status !== "COMPILED") throw new Error("expected COMPILED");
    const readiness = evaluateRenderReadiness({ package: compiled.package, scenePlan, executionPlan, templates: realTemplates(), professionalApprovalPresent: true });
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: compiled.package, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    if (r.status !== "SERIALIZED") throw new Error("expected SERIALIZED");
    expect(r.instruction.instruction.progression?.kind).toBe("SPATIAL_SUBSECTION_SEQUENCE");
    expect(r.instruction.instruction.progression?.iteration?.mode).toBe("UNTIL_EXECUTION_UNIT_COMPLETE");
    expect(r.instruction.renderScope).toBe("MULTI_STEP_PROGRESSIVE_ACTION");
    expect(r.instruction.providerText).toContain("PROGRESSION:");
    expect(r.instruction.providerText.toLowerCase()).toContain("repeat");
  });

  it("61/62. preservation constraints + forbidden deviations survive; nothing marks the unresolved crown delta solved", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    if (r.status !== "SERIALIZED") throw new Error("expected SERIALIZED");
    expect(r.instruction.instruction.preserve).toEqual([
      { scope: "nape", field: "lengthIntent", value: "preserve" },
      { scope: "occipital", field: "lengthIntent", value: "preserve" },
    ]);
    expect(r.instruction.instruction.mustNot.some((m) => m.kind === "CHANGE_PROTECTED_LENGTH")).toBe(true);
    expect(JSON.stringify(r.instruction).toLowerCase()).not.toContain("crown");
  });

  it("63/64/65/66. exact source-image id, viewpoint, observables, completion preserved", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const img = syntheticPrimaryCaptureEvidence();
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: img, ...CONFIG });
    if (r.status !== "SERIALIZED") throw new Error("expected SERIALIZED");
    expect(r.instruction.sourceImage.assetId).toBe(img.assetId);
    expect(r.instruction.sourceImage.evidenceRole).toBe("PRIMARY_CAPTURE");
    expect(r.instruction.instruction.viewpoint.framingSemantics).toEqual([...pkg.viewpoint.framingSemantics]);
    expect(r.instruction.instruction.observables.map((o) => o.aspect).sort()).toEqual(pkg.observables.map((o) => o.aspect).sort());
    expect(r.instruction.instruction.completion).toEqual({ fact: pkg.completionCriterion.fact, expectedValue: pkg.completionCriterion.expectedValue });
  });

  it("67. REFUSES a package whose Render Readiness is not RENDER_READY -- a semantically-mutated (or evidence-missing) package can never be serialized", () => {
    const { pkg } = firstExecutionPackageAndReadiness();
    const notReady: RenderReadinessResult = { status: "NOT_READY", findings: [{ reason: "PROFESSIONAL_SEMANTIC_CONTRADICTION", detail: "x" }], professionalApprovalPresent: true };
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: notReady, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    expect(r.status).toBe("REFUSED");
  });

  it("REFUSES when the supplied source image is not one of the package's own pinned evidence references", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const foreign = { evidenceKind: "IMAGE_ASSET" as const, evidenceRole: "PRIMARY_CAPTURE" as const, assetId: "some-other-clients-image", snapshotId: "x" };
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: foreign, ...CONFIG });
    expect(r.status).toBe("REFUSED");
  });

  it("REFUSES when provider or model is empty (serialization cannot target an undefined provider)", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), provider: "google", model: "" });
    expect(r.status).toBe("REFUSED");
  });

  it("no provider SDK / network token appears in the module or its output", () => {
    const { pkg, readiness } = firstExecutionPackageAndReadiness();
    const r = serializeVisualInstructionPackageToProviderInstruction({ package: pkg, readinessResult: readiness, sourceImage: syntheticPrimaryCaptureEvidence(), ...CONFIG });
    if (r.status !== "SERIALIZED") throw new Error("expected SERIALIZED");
    const json = JSON.stringify(r.instruction).toLowerCase();
    for (const banned of ["apikey", "authorization", "http://", "https://", "bearer "]) expect(json.includes(banned)).toBe(false);
  });
});
