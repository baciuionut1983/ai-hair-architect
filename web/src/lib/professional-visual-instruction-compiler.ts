import type { ProfessionalExecutionPlan, PlannedExecutionUnit } from "@/lib/professional-execution-plan-contracts";
import type { ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import type { ProfessionalExecutionScene, ProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-contracts";
import {
  VISUAL_INSTRUCTION_COMPILER_VERSION,
  VISUAL_INSTRUCTION_PACKAGE_SCHEMA_VERSION,
  computeVisualInstructionPackageFingerprint,
  type CameraConstraintKind,
  type ForbiddenDeviation,
  type HandToolRelationship,
  type OverlayElement,
  type VisualEvidenceReference,
  type VisualInstructionPackage,
  type VisualInstructionRenderScope,
  type VisualProfessionalParameter,
  type VisualSubjectElement,
  type VisualVerificationQuestion,
} from "@/lib/professional-visual-instruction-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8 -- PROVIDER-
// INDEPENDENT VISUAL INSTRUCTION COMPILER (Part W). Pure, deterministic,
// no I/O, no AI (no LLM / Gemini / OpenAI / Claude / Veo / Vision), no
// free-text reinterpretation, ZERO paid provider call, ZERO video/image
// generation.
//
// Transforms one Stage 7 ProfessionalExecutionScene + its source
// ProfessionalExecutionPlan + the skill template registry (for exact
// skill/version traceability) + optional source visual-evidence
// references -> one VisualInstructionPackage.
//
// AUTHORITY IS ONE-WAY (Part B): every professional fact is a verbatim
// carry from the Stage 7 scene or the Stage 6 plan. The compiler adds
// ONLY provider-independent VISUAL framing derived deterministically from
// those already-approved facts: subject elements, hand/tool/hair
// geometric relationships, forbidden-deviation "must not" semantics,
// technical camera constraints, overlay requirements, abstract render
// scope, a structured verification question set, and the deterministic
// package fingerprint. It NEVER adds a professional value not present
// upstream. If a required professional/visual fact is missing, the
// package is still produced with `viewpoint.status = NEEDS_INPUT` /
// `visualEvidenceRequired` unmet -- the RenderReadinessGate
// (professional-visual-instruction-readiness.ts) then returns NOT_READY
// with explicit reasons. This compiler never fabricates.
//
// UNSUPPORTED DELTA (Part J/AD): the scene plan has ZERO scenes for an
// unresolved requirement, so this compiler produces ZERO packages for it
// -- there is no code path that reads `scenePlan.unresolvedRequirements`
// to create anything.

export interface CompileVisualInstructionPackageInput {
  scene: ProfessionalExecutionScene;
  scenePlan: ProfessionalExecutionScenePlan;
  executionPlan: ProfessionalExecutionPlan;
  templates: readonly ExecutionPlanSkillTemplate<string>[];
  // Optional -- the caller supplies real source visual-evidence
  // references (by id, from the client's own HairStateSnapshotEvidence /
  // CaptureSet). Never bytes, never generated. Absent -> the readiness
  // gate reports NEEDS_VISUAL_EVIDENCE where a scene requires imagery.
  sourceVisualEvidence?: readonly VisualEvidenceReference[];
}

export interface VisualInstructionPackageCompilationSuccess {
  status: "COMPILED";
  package: VisualInstructionPackage;
}

export interface VisualInstructionPackageCompilationFailure {
  status: "UNRESOLVED";
  reason: string;
  sourceSceneId?: string;
}

export type VisualInstructionPackageCompilationResult = VisualInstructionPackageCompilationSuccess | VisualInstructionPackageCompilationFailure;

function paramValue(unit: PlannedExecutionUnit<string>, name: string): string | boolean | number | undefined {
  return unit.resolvedParameters.find((p) => p.name === name)?.value;
}

function isGuideRelated(unit: PlannedExecutionUnit<string>, scene: ProfessionalExecutionScene): boolean {
  return (
    unit.declaredCapabilityUsed === "ESTABLISH_GUIDE" ||
    unit.declaredCapabilityUsed === "CONNECT_ZONES" ||
    scene.beforeContract.requiredPriorState.length > 0 ||
    paramValue(unit, "guideReferenceMode") !== undefined
  );
}

function deriveSubjectElements(unit: PlannedExecutionUnit<string>, scene: ProfessionalExecutionScene): VisualSubjectElement[] {
  const out = new Set<VisualSubjectElement>(["CLIENT_HEAD", "HAIR_REGION", "HANDS"]);
  if (scene.progression?.kind === "SPATIAL_SUBSECTION_SEQUENCE" || scene.progression?.kind === "MIRRORED_BILATERAL") {
    out.add("SUBSECTION");
    out.add("SECTION");
  }
  if (isGuideRelated(unit, scene)) out.add("ESTABLISHED_GUIDE");
  if (scene.continuity.mustRemainStable.includes("SAME_COMPLETED_PRIOR_ZONES")) out.add("COMPLETED_PRIOR_REGION");
  if (scene.expectedVisibleEffect.preservedConstraints.length > 0) out.add("PROTECTED_REGION");
  const control = paramValue(unit, "controlMethod");
  if (control === "comb") out.add("COMB");
  if (control === "fingers") out.add("FINGERS");
  const tool = paramValue(unit, "tool");
  if (typeof tool === "string" && tool.includes("shear")) out.add("SHEARS");
  if (typeof tool === "string" && tool.includes("clipper")) out.add("CLIPPER");
  return [...out].sort();
}

function deriveHandToolRelationships(unit: PlannedExecutionUnit<string>): HandToolRelationship[] {
  const rels: HandToolRelationship[] = [];
  const has = (name: string) => paramValue(unit, name) !== undefined;
  if (paramValue(unit, "controlMethod") === "comb") rels.push({ kind: "CONTROL_HELD_WITH_COMB", sourceParameterNames: ["controlMethod"] });
  if (paramValue(unit, "controlMethod") === "fingers") rels.push({ kind: "CONTROL_HELD_WITH_FINGERS", sourceParameterNames: ["controlMethod"] });
  if (has("elevation")) rels.push({ kind: "STRAND_HELD_AT_DECLARED_ELEVATION", sourceParameterNames: ["elevation"] });
  if (has("distribution")) rels.push({ kind: "STRAND_IN_DECLARED_DISTRIBUTION", sourceParameterNames: ["distribution"] });
  if (has("cuttingLineShape")) rels.push({ kind: "TOOL_ALIGNED_TO_CUTTING_LINE", sourceParameterNames: ["cuttingLineShape", ...(has("tool") ? ["tool"] : [])] });
  if (has("shearOrientation")) rels.push({ kind: "TOOL_IN_DECLARED_ORIENTATION", sourceParameterNames: ["shearOrientation"] });
  if (has("guideReferenceMode")) rels.push({ kind: "TOOL_REFERENCES_PREVIOUS_GUIDE", sourceParameterNames: ["guideReferenceMode"] });
  if (has("guideReferenceMode")) rels.push({ kind: "SUBSECTION_REFERENCES_PRECEDING_SUBSECTION", sourceParameterNames: ["guideReferenceMode"] });
  if (has("clientHeadPosition")) rels.push({ kind: "HEAD_IN_DECLARED_POSITION", sourceParameterNames: ["clientHeadPosition"] });
  return rels;
}

function deriveRenderScope(scene: ProfessionalExecutionScene): VisualInstructionRenderScope {
  if (scene.phase === "VERIFICATION") return "VERIFICATION_ONLY";
  const p = scene.progression;
  if (!p || p.kind === "SINGLE_PASS") return "SHORT_SINGLE_ACTION";
  if (p.kind === "SPATIAL_SUBSECTION_SEQUENCE" && p.iteration?.mode === "UNTIL_EXECUTION_UNIT_COMPLETE") return "MULTI_STEP_PROGRESSIVE_ACTION";
  return "BOUNDED_PROGRESSIVE_ACTION";
}

function deriveForbiddenDeviations(unit: PlannedExecutionUnit<string>, scene: ProfessionalExecutionScene): ForbiddenDeviation[] {
  const out: ForbiddenDeviation[] = [
    { kind: "INVENT_EXTRA_CUT" },
    { kind: "INVENT_EXTRA_SECTIONING" },
    { kind: "CHANGE_SECTIONING_UNEXPECTEDLY" },
    { kind: "JUMP_TO_ANOTHER_ZONE", subject: unit.addressesDelta.scope },
    { kind: "INTRODUCE_UNDECLARED_TECHNIQUE_OR_TEMPLATE" },
    { kind: "NARRATE_INSTEAD_OF_SHOWING" },
    { kind: "CHANGE_CLIENT_IDENTITY_OR_ENVIRONMENT" },
  ];
  if (paramValue(unit, "tool") !== undefined) out.push({ kind: "CHANGE_TOOL", subject: "tool" });
  if (paramValue(unit, "elevation") !== undefined) out.push({ kind: "ALTER_DECLARED_ELEVATION", subject: "elevation" });
  if (paramValue(unit, "cuttingLineShape") !== undefined) out.push({ kind: "CHANGE_CUTTING_LINE", subject: "cuttingLineShape" });
  if (paramValue(unit, "hairState") !== undefined) out.push({ kind: "CHANGE_WET_DRY_STATE", subject: "hairState" });
  if (isGuideRelated(unit, scene)) out.push({ kind: "ALTER_GUIDE_GEOMETRY", subject: "guide" });
  for (const c of scene.expectedVisibleEffect.preservedConstraints) {
    out.push({ kind: "CHANGE_PROTECTED_LENGTH", subject: `${c.scope}:${c.field}` });
  }
  if (scene.continuity.mustRemainStable.includes("SAME_COMPLETED_PRIOR_ZONES")) out.push({ kind: "REMOVE_COMPLETED_WORK" });
  if (scene.progression && scene.progression.kind !== "SINGLE_PASS") out.push({ kind: "JUMP_UNFINISHED_TO_FINISHED_ZONE" });
  return out;
}

function deriveCameraConstraints(unit: PlannedExecutionUnit<string>, scene: ProfessionalExecutionScene): CameraConstraintKind[] {
  const out = new Set<CameraConstraintKind>([
    "HANDS_MUST_REMAIN_VISIBLE",
    "WORKED_ZONE_MUST_REMAIN_IN_FRAME",
    "NO_RAPID_CUTS_OR_MONTAGE",
    "NO_CAMERA_SHAKE",
    "NO_SHALLOW_FOCUS_HIDING_TECHNIQUE",
    "NO_ORBIT_OR_DRAMATIC_MOVE_DURING_TECHNIQUE",
  ]);
  if (paramValue(unit, "tool") !== undefined) out.add("TOOL_MUST_REMAIN_VISIBLE");
  if (isGuideRelated(unit, scene)) out.add("GUIDE_MUST_REMAIN_VISIBLE");
  if (paramValue(unit, "cuttingLineShape") !== undefined) out.add("CUTTING_LINE_MUST_REMAIN_VISIBLE");
  if (scene.demonstrationRequirements.some((r) => r.kind === "REQUIRES_BEFORE_AFTER")) out.add("BEFORE_AFTER_RELATION_MUST_BE_VISIBLE");
  return [...out].sort();
}

const OVERLAY_BY_OBSERVABLE: Readonly<Record<string, readonly OverlayElement["kind"][]>> = {
  GUIDE_LINE_VISIBLE: ["GUIDE_LINE"],
  CUTTING_LINE_VISIBLE: ["CUTTING_LINE_INDICATOR"],
  ELEVATION_RELATION_VISIBLE: ["ELEVATION_INDICATOR"],
  TOOL_TO_SUBJECT_RELATION_VISIBLE: [],
  SUBSECTION_PROGRESSION_VISIBLE: ["PROGRESSION_DIRECTION", "SECTION_LINE"],
  ZONE_COMPLETION_VISIBLE: ["ZONE_HIGHLIGHT"],
  PRESERVED_REGION_VISIBLE: ["PROTECTED_AREA"],
  ZONE_CONNECTION_VISIBLE: ["DIRECTION_ARROW"],
  SUBJECT_CONDITION_VISIBLE: [],
  ANATOMICAL_CONTEXT_VISIBLE: ["ZONE_HIGHLIGHT"],
};

function deriveOverlayElements(scene: ProfessionalExecutionScene): OverlayElement[] {
  const kinds = new Set<OverlayElement["kind"]>();
  for (const obs of scene.observables) for (const k of OVERLAY_BY_OBSERVABLE[obs.aspect] ?? []) kinds.add(k);
  return [...kinds].sort().map((kind) => ({ kind }));
}

function deriveVerificationQuestions(unit: PlannedExecutionUnit<string>, scene: ProfessionalExecutionScene): VisualVerificationQuestion[] {
  const qs: VisualVerificationQuestion[] = [
    { question: "INTENDED_PROFESSIONAL_ACTION_VISIBLE", failDisposition: "FAIL" },
    { question: "COMPLETION_CONDITION_REACHED", failDisposition: "FAIL" },
    { question: "EXPECTED_EFFECT_VISIBLE", failDisposition: "FAIL" },
    { question: "PRESERVATION_CONSTRAINTS_RESPECTED", failDisposition: "FAIL" },
    { question: "NO_UNDECLARED_CHANGES_INTRODUCED", failDisposition: "FAIL" },
    { question: "CAMERA_SUFFICIENT_TO_INSPECT_TECHNIQUE", failDisposition: "NEEDS_PROFESSIONAL_REVIEW" },
  ];
  if (scene.progression && scene.progression.kind !== "SINGLE_PASS") {
    qs.push({ question: "PROGRESSION_SHOWN", failDisposition: "FAIL" });
    if (scene.progression.iteration !== undefined) qs.push({ question: "ITERATION_REPRESENTED", failDisposition: "FAIL" });
  }
  if (isGuideRelated(unit, scene)) qs.push({ question: "GUIDE_VISIBLE", failDisposition: "FAIL" });
  return qs;
}

export function compileVisualInstructionPackage(input: CompileVisualInstructionPackageInput): VisualInstructionPackageCompilationResult {
  const { scene, scenePlan, executionPlan, templates } = input;

  const unit = executionPlan.plannedUnits.find((u) => u.executionUnit.executionUnitId === scene.sourceExecutionUnitId);
  if (!unit) {
    return { status: "UNRESOLVED", reason: `Scene "${scene.sceneId}" references execution unit "${scene.sourceExecutionUnitId}", which is not in the source execution plan.`, sourceSceneId: scene.sceneId };
  }
  const template = templates.find((t) => t.skillInstance.skillInstanceId === unit.executionUnit.sourceSkillInstanceId);
  if (!template) {
    return { status: "UNRESOLVED", reason: `No skill template registered for Skill Instance "${unit.executionUnit.sourceSkillInstanceId}".`, sourceSceneId: scene.sceneId };
  }

  const skillId = template.skillInstance.sourceSkillId;
  const skillVersion = template.skillInstance.sourceSkillVersion;

  const professionalParameters: VisualProfessionalParameter[] = unit.resolvedParameters.map((p) => ({ name: p.name, value: p.value, source: p.source }));
  const subjectElements = deriveSubjectElements(unit, scene);
  const handToolRelationships = deriveHandToolRelationships(unit);
  const renderScope = deriveRenderScope(scene);
  const forbiddenDeviations = deriveForbiddenDeviations(unit, scene);
  const cameraConstraints = deriveCameraConstraints(unit, scene);
  const overlayElements = deriveOverlayElements(scene);
  const verificationQuestions = deriveVerificationQuestions(unit, scene);

  const preservationConstraints = scene.expectedVisibleEffect.preservedConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value }));
  const visualEvidenceRequired = scene.requiredMedium !== "OVERLAY_REQUIRED";
  const sourceVisualEvidence = input.sourceVisualEvidence ? [...input.sourceVisualEvidence] : [];

  const packageFingerprint = computeVisualInstructionPackageFingerprint({
    sourceExecutionPlanId: scenePlan.sourceExecutionPlanId,
    sourceSceneId: scene.sceneId,
    sourceSceneFingerprint: scene.sceneFingerprint,
    skillId,
    skillVersion,
    contributesToDelta: scene.contributesToDelta,
    professionalParameters,
    progression: scene.progression,
    renderScope,
    completionCriterion: scene.completionCriterion,
    expectedCapability: unit.declaredCapabilityUsed,
    preservationConstraints,
    forbiddenDeviationKinds: forbiddenDeviations.map((f) => `${f.kind}:${f.subject ?? ""}`),
    viewpointFamily: scene.viewpoint.family,
    framingSemantics: scene.viewpoint.framingSemantics,
    observableAspects: scene.observables.map((o) => o.aspect),
    requiredMedium: scene.requiredMedium,
    overlayKinds: overlayElements.map((o) => o.kind),
    sourceVisualEvidence,
    compilerVersion: VISUAL_INSTRUCTION_COMPILER_VERSION,
  });

  const pkg: VisualInstructionPackage = {
    schemaVersion: VISUAL_INSTRUCTION_PACKAGE_SCHEMA_VERSION,
    compilerVersion: VISUAL_INSTRUCTION_COMPILER_VERSION,
    sourceScenePlanFingerprint: scenePlan.scenePlanFingerprint,
    sourceSceneId: scene.sceneId,
    sourceSceneFingerprint: scene.sceneFingerprint,
    sourceExecutionPlanId: scenePlan.sourceExecutionPlanId,
    sourceExecutionUnitId: scene.sourceExecutionUnitId,
    sourceAtomicActionIds: [...scene.sourceAtomicActionIds].sort(),
    skillId,
    skillVersion,
    contributesToDelta: { scope: scene.contributesToDelta.scope, field: scene.contributesToDelta.field },
    subjectElements,
    beforeState: {
      requiresPriorSceneIds: [...scene.beforeContract.requiresPriorSceneIds],
      requiredPriorState: [...scene.beforeContract.requiredPriorState],
    },
    professionalParameters,
    handToolRelationships,
    progression: scene.progression,
    progressionNotApplicableReason: scene.progressionNotApplicableReason,
    renderScope,
    completionCriterion: scene.completionCriterion,
    expectedVisibleEffect: { capability: unit.declaredCapabilityUsed, stateTransitions: [...scene.expectedVisibleEffect.stateTransitions] },
    preservationConstraints,
    forbiddenDeviations,
    viewpoint: scene.viewpoint,
    cameraConstraints,
    observables: [...scene.observables],
    verification: { mode: scene.verification.mode, questions: verificationQuestions, criterion: scene.verification.criterion },
    continuity: scene.continuity,
    visualEvidenceRequired,
    sourceVisualEvidence,
    requiredMedium: scene.requiredMedium,
    overlayElements,
    packageFingerprint,
  };

  return { status: "COMPILED", package: pkg };
}

// ---------------------------------------------------------------------------
// Whole-scene-plan convenience: one package per scene, in scene order.
// ZERO packages for unresolved requirements -- there are no scenes for
// them (Part J/AD).
// ---------------------------------------------------------------------------

export interface CompileAllVisualInstructionPackagesInput {
  scenePlan: ProfessionalExecutionScenePlan;
  executionPlan: ProfessionalExecutionPlan;
  templates: readonly ExecutionPlanSkillTemplate<string>[];
  // Optional map: sceneId -> the source visual-evidence references for
  // that scene.
  evidenceBySceneId?: Readonly<Record<string, readonly VisualEvidenceReference[]>>;
}

export interface CompileAllVisualInstructionPackagesResult {
  packages: readonly VisualInstructionPackage[];
  failures: readonly VisualInstructionPackageCompilationFailure[];
}

export function compileAllVisualInstructionPackages(input: CompileAllVisualInstructionPackagesInput): CompileAllVisualInstructionPackagesResult {
  const packages: VisualInstructionPackage[] = [];
  const failures: VisualInstructionPackageCompilationFailure[] = [];
  for (const scene of [...input.scenePlan.scenes].sort((a, b) => a.order - b.order)) {
    const result = compileVisualInstructionPackage({
      scene,
      scenePlan: input.scenePlan,
      executionPlan: input.executionPlan,
      templates: input.templates,
      sourceVisualEvidence: input.evidenceBySceneId?.[scene.sceneId],
    });
    if (result.status === "COMPILED") packages.push(result.package);
    else failures.push(result);
  }
  return { packages, failures };
}
