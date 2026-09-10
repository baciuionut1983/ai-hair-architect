import { compileAllVisualInstructionPackages, compileVisualInstructionPackage } from "@/lib/professional-visual-instruction-compiler";
import type { VisualEvidenceReference } from "@/lib/professional-visual-instruction-contracts";
import { compileRealExecutionPlan, compileRealScenePlan, realTemplates } from "@/lib/professional-execution-scene-fixtures";
import type { ProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-contracts";
import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";

// AI Hair Architect, Stage 8 -- SHARED TEST FIXTURES. NOT a test file.
// Builds on the Stage 7 canonical proof (3 real skills, nape/occipital
// preserved, crown weight-reduction unresolved). Pure, zero I/O, zero AI.

export { realTemplates, compileRealExecutionPlan } from "@/lib/professional-execution-scene-fixtures";

export function realScenePlan(): ProfessionalExecutionScenePlan {
  const r = compileRealScenePlan();
  if (r.status !== "COMPILED") throw new Error("Stage 7 scene plan did not compile in the Stage 8 fixture");
  return r.scenePlan;
}

// A labelled, id-only source visual-evidence reference -- NOT a real
// asset, NOT generated. Stands in for what a route would pull from the
// client's own HairStateSnapshotEvidence.
export function syntheticPrimaryCaptureEvidence(): VisualEvidenceReference {
  return {
    evidenceKind: "IMAGE_ASSET",
    evidenceRole: "PRIMARY_CAPTURE",
    assetId: "SYNTHETIC-primary-capture-asset",
    snapshotId: "current-proof-1",
  };
}

export function syntheticTargetReferenceEvidence(): VisualEvidenceReference {
  return {
    evidenceKind: "IMAGE_ASSET",
    evidenceRole: "TARGET_REFERENCE",
    assetId: "SYNTHETIC-target-reference-asset",
    snapshotId: "target-proof-1",
  };
}

export function compileRealPackages(withEvidence: boolean) {
  const scenePlan = realScenePlan();
  const executionPlan: ProfessionalExecutionPlan = compileRealExecutionPlan();
  const evidenceBySceneId = withEvidence
    ? Object.fromEntries(scenePlan.scenes.map((s) => [s.sceneId, [syntheticPrimaryCaptureEvidence()] as const]))
    : undefined;
  return {
    scenePlan,
    executionPlan,
    ...compileAllVisualInstructionPackages({ scenePlan, executionPlan, templates: realTemplates(), evidenceBySceneId }),
  };
}

export function compileOneRealPackage(sceneIndex: number, withEvidence: boolean) {
  const scenePlan = realScenePlan();
  const executionPlan = compileRealExecutionPlan();
  const scene = [...scenePlan.scenes].sort((a, b) => a.order - b.order)[sceneIndex];
  return compileVisualInstructionPackage({
    scene,
    scenePlan,
    executionPlan,
    templates: realTemplates(),
    sourceVisualEvidence: withEvidence ? [syntheticPrimaryCaptureEvidence()] : undefined,
  });
}
