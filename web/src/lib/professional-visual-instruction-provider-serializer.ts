import { createHash } from "crypto";

import type { CameraConstraintKind, OverlayElement, VisualEvidenceReference, VisualInstructionPackage, VisualSubjectElement } from "@/lib/professional-visual-instruction-contracts";
import { isValidVisualInstructionPackage } from "@/lib/professional-visual-instruction-contracts";
import type { RenderReadinessResult } from "@/lib/professional-visual-instruction-readiness";
import type { FramingSemantic, ViewpointFamily } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import type { SkillCapabilityKind } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Stage 8.5A -- VISUAL INSTRUCTION -> PROVIDER
// INSTRUCTION SERIALIZER (Part R). Pure, deterministic, no I/O, no AI, no
// network, no provider SDK import. This is the bridge Stage 9 found
// missing. It is TRANSLATION ONLY (Part T): it may map already-approved,
// already-render-ready structured semantics into provider-supported
// fields + a deterministic text rendering of those same facts. It may
// NOT choose a skill, invent sectioning/guide/elevation/distribution/
// overdirection/cutting-angle/tool/progression/completion/preservation,
// resolve an unresolved delta, or change professional order.
//
// SINGLE-LAYER GUARD (Part T + "RENDER_READY does not authorize
// spending"): this function REFUSES to serialize any package whose own
// Stage 8 Render Readiness result is not exactly RENDER_READY. All
// "no professional mutation / exact traceability / no unresolved delta /
// viewpoint present / evidence required" checking is delegated to Stage
// 8's gate (professional-visual-instruction-readiness.ts) -- the single
// source of truth -- so this serializer stays a faithful copier and
// nothing more. Every professional field on the output is a verbatim
// copy of the input package's own field.
//
// PROVIDER-SPECIFIC ONLY AT THE LAST LAYER: `provider`/`model` are the
// only provider-targeting fields, taken from resolved configuration (never
// hardcoded). `providerText` exists only because a video provider
// requires text -- it is a byte-deterministic serialization of the
// structured `instruction`, regenerable and never a source of truth.
//
// SOURCE IMAGE IS PINNED EXACTLY (Part V): the caller passes the exact
// VisualEvidenceReference from the package's own sourceVisualEvidence
// (a PRIMARY_CAPTURE). This serializer never searches for "a current
// image", never uses "latest", never substitutes Photo Preview or
// another CaptureSet.

export const PROVIDER_INSTRUCTION_SCHEMA_VERSION = "1.0.0-pi85a";
export const PROVIDER_INSTRUCTION_SERIALIZER_VERSION = "1.0.0";

export interface ProviderInstructionAction {
  skillId: string;
  skillVersion: number;
  capability: SkillCapabilityKind;
  contributesToDelta: { scope: string; field: string };
  sourceAtomicActionIds: readonly string[];
}

export interface ProviderInstruction {
  schemaVersion: string;
  serializerVersion: string;

  // -- provenance, verbatim from the package.
  sourceScenePlanFingerprint: string;
  sourceSceneId: string;
  sourceSceneFingerprint: string;
  sourceVisualInstructionPackageFingerprint: string;
  sourceExecutionPlanId: string;
  sourceExecutionUnitId: string;

  // -- provider targeting (last layer only).
  provider: string;
  model: string;
  generationIntent: "TECHNICAL_EXECUTION_DEMONSTRATION";
  imageConditioningMode: "REFERENCE_SUBJECT_IDENTITY";

  // -- exact pinned source image (by id only).
  sourceImage: VisualEvidenceReference;

  // -- provider-independent abstract scope.
  renderScope: string;
  requiredMedium: string;

  // -- the structured instruction (all verbatim copies).
  instruction: {
    subject: readonly VisualSubjectElement[];
    beforeState: readonly { fact: string; expectedValue: string | boolean | number }[];
    action: ProviderInstructionAction;
    geometry: readonly { kind: string; sourceParameterNames: readonly string[] }[];
    professionalParameters: readonly { name: string; value: string | boolean | number }[];
    progression: { kind: string; zoneId: string | null; iteration: { mode: string; count?: number; note?: string } | null } | null;
    progressionNotApplicableReason: string | null;
    completion: { fact: string; expectedValue: string | boolean | number };
    expectedEffect: { capability: SkillCapabilityKind; stateTransitions: readonly { fact: string; toValue: string | boolean | number }[] };
    preserve: readonly { scope: string; field: string; value: string }[];
    mustNot: readonly { kind: string; subject: string | null }[];
    viewpoint: { family: ViewpointFamily; framingSemantics: readonly FramingSemantic[] };
    cameraConstraints: readonly CameraConstraintKind[];
    observables: readonly { aspect: string }[];
    continuity: { mustRemainStable: readonly string[]; carriesForward: readonly { fact: string; expectedValue: string | boolean | number }[] };
    overlays: readonly OverlayElement[];
  };

  providerText: string;
  providerInstructionFingerprint: string;
}

export interface SerializeProviderInstructionInput {
  package: VisualInstructionPackage;
  // The Stage 8 Render Readiness result for THIS package's scene. Must be
  // exactly RENDER_READY or serialization is refused.
  readinessResult: RenderReadinessResult;
  // The exact PRIMARY_CAPTURE reference from the package's own
  // sourceVisualEvidence.
  sourceImage: VisualEvidenceReference;
  provider: string;
  model: string;
}

export type SerializeProviderInstructionResult =
  | { status: "SERIALIZED"; instruction: ProviderInstruction }
  | { status: "REFUSED"; reason: string };

function fmt(value: string | boolean | number): string {
  return typeof value === "string" ? value.replace(/_/g, " ") : String(value);
}

function buildProviderText(pkg: VisualInstructionPackage): string {
  const lines: string[] = [];
  lines.push("TECHNICAL EXECUTION DEMONSTRATION -- one continuous real-world video of the exact person in the attached reference photo.");
  lines.push("Depict the professional action itself. Do not narrate or explain via on-screen text.");
  lines.push("");
  lines.push(`SUBJECT: ${pkg.subjectElements.map(fmt).join(", ")}.`);
  if (pkg.beforeState.requiredPriorState.length > 0) {
    lines.push(`BEFORE THE SCENE BEGINS: ${pkg.beforeState.requiredPriorState.map((c) => `${fmt(c.fact)} = ${fmt(c.expectedValue)}`).join("; ")}.`);
  }
  lines.push(`ACTION: perform "${fmt(pkg.expectedVisibleEffect.capability)}" at zone "${fmt(pkg.contributesToDelta.scope)}" for the "${fmt(pkg.contributesToDelta.field)}" relationship.`);
  if (pkg.professionalParameters.length > 0) {
    lines.push(`PARAMETERS (exact, do not change): ${pkg.professionalParameters.map((p) => `${fmt(p.name)} = ${fmt(p.value)}`).join("; ")}.`);
  }
  if (pkg.handToolRelationships.length > 0) {
    lines.push(`GEOMETRY: ${pkg.handToolRelationships.map((r) => fmt(r.kind)).join("; ")}.`);
  }
  if (pkg.progression) {
    const it = pkg.progression.iteration ? ` -- repeat ${fmt(pkg.progression.iteration.mode)}${pkg.progression.iteration.note ? ` (${pkg.progression.iteration.note})` : ""}` : "";
    lines.push(`PROGRESSION: ${fmt(pkg.progression.kind)}${pkg.progression.zoneId ? ` through zone "${fmt(pkg.progression.zoneId)}"` : ""}${it}.`);
  } else if (pkg.progressionNotApplicableReason) {
    lines.push(`PROGRESSION: not applicable -- ${pkg.progressionNotApplicableReason}`);
  }
  lines.push(`COMPLETION: the scene ends when ${fmt(pkg.completionCriterion.fact)} = ${fmt(pkg.completionCriterion.expectedValue)}.`);
  lines.push(`EXPECTED VISIBLE EFFECT: ${pkg.expectedVisibleEffect.stateTransitions.map((t) => `${fmt(t.fact)} -> ${fmt(t.toValue)}`).join("; ") || fmt(pkg.expectedVisibleEffect.capability)}.`);
  if (pkg.preservationConstraints.length > 0) {
    lines.push(`MUST NOT CHANGE (preserve): ${pkg.preservationConstraints.map((c) => `${fmt(c.scope)}/${fmt(c.field)} stays "${fmt(c.value)}"`).join("; ")}.`);
  }
  lines.push(`MUST NOT: ${pkg.forbiddenDeviations.map((f) => `${fmt(f.kind)}${f.subject ? ` (${fmt(f.subject)})` : ""}`).join("; ")}.`);
  lines.push(`VIEWPOINT: ${pkg.viewpoint.status === "RESOLVED" ? fmt(pkg.viewpoint.family!) : "NEEDS INPUT"} -- ${pkg.viewpoint.framingSemantics.map(fmt).join(", ")}.`);
  lines.push(`CAMERA: ${pkg.cameraConstraints.map(fmt).join("; ")}.`);
  lines.push(`MUST BE OBSERVABLE: ${pkg.observables.map((o) => fmt(o.aspect)).join("; ")}.`);
  lines.push(`CONTINUITY: keep stable -- ${pkg.continuity.mustRemainStable.map(fmt).join(", ")}.`);
  lines.push("");
  lines.push("STYLE: photorealistic, continuous motion, natural lighting and camera consistent with the reference photo. No scene cuts, no camera shake, no text overlays, no narration, no stylized editing.");
  lines.push("Do not add, invent, or substitute any action, tool, technique, zone, or viewpoint beyond what is listed above. Do not change the person's identity, face, or the visible environment.");
  return lines.join("\n");
}

function computeFingerprint(pkg: VisualInstructionPackage, provider: string, model: string, sourceImage: VisualEvidenceReference): string {
  const canonical = JSON.stringify({
    pf: pkg.packageFingerprint,
    sf: pkg.sourceSceneFingerprint,
    spf: pkg.sourceScenePlanFingerprint,
    prov: provider,
    model,
    img: `${sourceImage.evidenceKind}:${sourceImage.evidenceRole}:${sourceImage.assetId}:${sourceImage.snapshotId}`,
    sv: PROVIDER_INSTRUCTION_SERIALIZER_VERSION,
    sch: PROVIDER_INSTRUCTION_SCHEMA_VERSION,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializeVisualInstructionPackageToProviderInstruction(input: SerializeProviderInstructionInput): SerializeProviderInstructionResult {
  const pkg = input.package;

  if (!isValidVisualInstructionPackage(pkg)) {
    return { status: "REFUSED", reason: "The visual instruction package is not structurally valid." };
  }
  if (input.readinessResult.status !== "RENDER_READY") {
    return { status: "REFUSED", reason: `Render Readiness for this scene is "${input.readinessResult.status}", not RENDER_READY -- refusing to serialize.` };
  }
  if (pkg.viewpoint.status !== "RESOLVED" || !pkg.viewpoint.family) {
    return { status: "REFUSED", reason: "The package has no resolved viewpoint." };
  }
  if (pkg.visualEvidenceRequired && input.sourceImage.evidenceRole !== "PRIMARY_CAPTURE") {
    return { status: "REFUSED", reason: "This scene requires a PRIMARY_CAPTURE source image; the supplied reference is not one." };
  }
  if (!pkg.sourceVisualEvidence.some((e) => e.assetId === input.sourceImage.assetId && e.evidenceRole === input.sourceImage.evidenceRole)) {
    return { status: "REFUSED", reason: "The supplied source image is not one of the package's own pinned source visual evidence references." };
  }
  if (!input.provider || !input.model) {
    return { status: "REFUSED", reason: "Provider and model must both be resolved before serialization." };
  }

  const instruction: ProviderInstruction = {
    schemaVersion: PROVIDER_INSTRUCTION_SCHEMA_VERSION,
    serializerVersion: PROVIDER_INSTRUCTION_SERIALIZER_VERSION,
    sourceScenePlanFingerprint: pkg.sourceScenePlanFingerprint,
    sourceSceneId: pkg.sourceSceneId,
    sourceSceneFingerprint: pkg.sourceSceneFingerprint,
    sourceVisualInstructionPackageFingerprint: pkg.packageFingerprint,
    sourceExecutionPlanId: pkg.sourceExecutionPlanId,
    sourceExecutionUnitId: pkg.sourceExecutionUnitId,
    provider: input.provider,
    model: input.model,
    generationIntent: "TECHNICAL_EXECUTION_DEMONSTRATION",
    imageConditioningMode: "REFERENCE_SUBJECT_IDENTITY",
    sourceImage: { ...input.sourceImage },
    renderScope: pkg.renderScope,
    requiredMedium: pkg.requiredMedium,
    instruction: {
      subject: [...pkg.subjectElements],
      beforeState: pkg.beforeState.requiredPriorState.map((c) => ({ fact: c.fact, expectedValue: c.expectedValue })),
      action: {
        skillId: pkg.skillId,
        skillVersion: pkg.skillVersion,
        capability: pkg.expectedVisibleEffect.capability,
        contributesToDelta: { scope: pkg.contributesToDelta.scope, field: pkg.contributesToDelta.field },
        sourceAtomicActionIds: [...pkg.sourceAtomicActionIds],
      },
      geometry: pkg.handToolRelationships.map((r) => ({ kind: r.kind, sourceParameterNames: [...r.sourceParameterNames] })),
      professionalParameters: pkg.professionalParameters.map((p) => ({ name: p.name, value: p.value })),
      progression: pkg.progression
        ? { kind: pkg.progression.kind, zoneId: pkg.progression.zoneId ?? null, iteration: pkg.progression.iteration ? { ...pkg.progression.iteration } : null }
        : null,
      progressionNotApplicableReason: pkg.progressionNotApplicableReason ?? null,
      completion: { fact: pkg.completionCriterion.fact, expectedValue: pkg.completionCriterion.expectedValue },
      expectedEffect: {
        capability: pkg.expectedVisibleEffect.capability,
        stateTransitions: pkg.expectedVisibleEffect.stateTransitions.map((t) => ({ fact: t.fact, toValue: t.toValue })),
      },
      preserve: pkg.preservationConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value })),
      mustNot: pkg.forbiddenDeviations.map((f) => ({ kind: f.kind, subject: f.subject ?? null })),
      viewpoint: { family: pkg.viewpoint.family, framingSemantics: [...pkg.viewpoint.framingSemantics] },
      cameraConstraints: [...pkg.cameraConstraints],
      observables: pkg.observables.map((o) => ({ aspect: o.aspect })),
      continuity: {
        mustRemainStable: [...pkg.continuity.mustRemainStable],
        carriesForward: pkg.continuity.carriesForward.map((c) => ({ fact: c.fact, expectedValue: c.expectedValue })),
      },
      overlays: pkg.overlayElements.map((o) => ({ kind: o.kind, subject: o.subject })),
    },
    providerText: buildProviderText(pkg),
    providerInstructionFingerprint: computeFingerprint(pkg, input.provider, input.model, input.sourceImage),
  };

  return { status: "SERIALIZED", instruction };
}
