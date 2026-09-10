import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";
import type { ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import type { ProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-contracts";
import { SKILL_CAPABILITY_KINDS } from "@/lib/professional-skill-contracts";
import type { VisualInstructionPackage } from "@/lib/professional-visual-instruction-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8 -- RENDER
// READINESS GATE (Part X). Pure, deterministic, no I/O, no AI, no
// provider call. Given a VisualInstructionPackage + the exact Stage 6/7
// sources it claims to derive from, decides -- FAIL CLOSED -- whether it
// carries enough validated, provider-independent visual information for a
// future renderer to execute the professional action without inventing
// anything.
//
// TECHNICALLY RENDER READY != AUTHORIZED TO SPEND (Part AI): a
// RENDER_READY status means the package is technically complete. Actual
// paid rendering additionally requires professional authorization --
// modelled by isAuthorizedToRender() below, never by this gate alone. A
// RENDER_READY result whose input did not carry professional approval
// still lists PROFESSIONAL_APPROVAL_REQUIRED as an informational reason.

export const RENDER_READINESS_STATUSES = [
  "RENDER_READY",
  "NOT_READY",
  "NEEDS_PROFESSIONAL_INPUT",
  "NEEDS_VISUAL_EVIDENCE",
  "NEEDS_VIEWPOINT",
  "NEEDS_SCENE_SPLIT",
  "UNRESOLVED",
] as const;
export type RenderReadinessStatus = (typeof RENDER_READINESS_STATUSES)[number];

export function isRenderReadinessStatus(value: unknown): value is RenderReadinessStatus {
  return typeof value === "string" && (RENDER_READINESS_STATUSES as readonly string[]).includes(value);
}

export const RENDER_READINESS_REASONS = [
  "MISSING_SOURCE_SCENE",
  "SOURCE_SCENE_FINGERPRINT_MISMATCH",
  "EXECUTION_PLAN_TRACEABILITY_BROKEN",
  "MISSING_SOURCE_EXECUTION_UNIT",
  "MISSING_SOURCE_ACTION",
  "SKILL_VERSION_TRACEABILITY_BROKEN",
  "MISSING_SOURCE_EVIDENCE",
  "MISSING_VIEWPOINT",
  "MISSING_GUIDE_RELATIONSHIP",
  "MISSING_TOOL_RELATIONSHIP",
  "MISSING_PROGRESSION",
  "MISSING_ITERATION",
  "MISSING_STOP_CONDITION",
  "MISSING_COMPLETION_VISIBILITY",
  "MISSING_OBSERVABLE",
  "MISSING_VERIFICATION",
  "MISSING_PRESERVATION_CONSTRAINT",
  "CONTINUITY_UNSATISFIED",
  "PROFESSIONAL_PARAMETER_UNKNOWN",
  "SCENE_TOO_BROAD",
  "NEEDS_SCENE_SPLIT",
  "UNRESOLVED_DELTA",
  "PROFESSIONAL_APPROVAL_REQUIRED",
  "UNSUPPORTED_EXPECTED_EFFECT",
  "PROFESSIONAL_SEMANTIC_CONTRADICTION",
  "SCENE_SEMANTICALLY_EMPTY",
] as const;
export type RenderReadinessReason = (typeof RENDER_READINESS_REASONS)[number];

export function isRenderReadinessReason(value: unknown): value is RenderReadinessReason {
  return typeof value === "string" && (RENDER_READINESS_REASONS as readonly string[]).includes(value);
}

export interface RenderReadinessFinding {
  reason: RenderReadinessReason;
  detail: string;
}

export interface RenderReadinessResult {
  status: RenderReadinessStatus;
  findings: readonly RenderReadinessFinding[];
  professionalApprovalPresent: boolean;
}

export interface EvaluateRenderReadinessInput {
  package: VisualInstructionPackage;
  scenePlan: ProfessionalExecutionScenePlan;
  executionPlan: ProfessionalExecutionPlan;
  templates: readonly ExecutionPlanSkillTemplate<string>[];
  expectedSourceExecutionPlanId?: string;
  // Whether a professional has approved rendering this package's source
  // scene plan. Absent/false -> RENDER_READY may still be returned
  // (technical readiness), but PROFESSIONAL_APPROVAL_REQUIRED is listed
  // and isAuthorizedToRender() will refuse.
  professionalApprovalPresent?: boolean;
}

// Which recoverable status a given reason maps to. Any reason NOT listed
// here is a hard NOT_READY.
const REASON_STATUS: Partial<Record<RenderReadinessReason, RenderReadinessStatus>> = {
  MISSING_SOURCE_EVIDENCE: "NEEDS_VISUAL_EVIDENCE",
  MISSING_VIEWPOINT: "NEEDS_VIEWPOINT",
  SCENE_TOO_BROAD: "NEEDS_SCENE_SPLIT",
  NEEDS_SCENE_SPLIT: "NEEDS_SCENE_SPLIT",
  PROFESSIONAL_PARAMETER_UNKNOWN: "NEEDS_PROFESSIONAL_INPUT",
  UNRESOLVED_DELTA: "UNRESOLVED",
};

const STATUS_PRIORITY: readonly RenderReadinessStatus[] = ["UNRESOLVED", "NEEDS_SCENE_SPLIT", "NEEDS_VISUAL_EVIDENCE", "NEEDS_VIEWPOINT", "NEEDS_PROFESSIONAL_INPUT", "NOT_READY", "RENDER_READY"];

const ITERATION_STOP_MODES = new Set(["OVER_ORDERED_SUBSECTIONS", "UNTIL_EXECUTION_UNIT_COMPLETE", "FIXED_COUNT"]);

export function evaluateRenderReadiness(input: EvaluateRenderReadinessInput): RenderReadinessResult {
  const pkg = input.package;
  const { scenePlan, executionPlan, templates } = input;
  const findings: RenderReadinessFinding[] = [];
  const add = (reason: RenderReadinessReason, detail: string) => findings.push({ reason, detail });
  const professionalApprovalPresent = input.professionalApprovalPresent === true;

  // 1 -- exact source scene exists.
  const scene = scenePlan.scenes.find((s) => s.sceneId === pkg.sourceSceneId);
  if (!scene) {
    add("MISSING_SOURCE_SCENE", `No scene "${pkg.sourceSceneId}" in the given scene plan.`);
    return finalize(findings, professionalApprovalPresent);
  }

  // 2 -- exact scene / scene-plan fingerprint match.
  if (pkg.sourceSceneFingerprint !== scene.sceneFingerprint) {
    add("SOURCE_SCENE_FINGERPRINT_MISMATCH", "Package's pinned scene fingerprint no longer matches the scene's own fingerprint.");
  }
  if (pkg.sourceScenePlanFingerprint !== scenePlan.scenePlanFingerprint) {
    add("SOURCE_SCENE_FINGERPRINT_MISMATCH", "Package's pinned scene-plan fingerprint no longer matches the given scene plan.");
  }

  // 3 -- ExecutionPlan traceability.
  if (pkg.sourceExecutionPlanId !== scenePlan.sourceExecutionPlanId) {
    add("EXECUTION_PLAN_TRACEABILITY_BROKEN", "Package's sourceExecutionPlanId does not match the scene plan's.");
  }
  if (input.expectedSourceExecutionPlanId !== undefined && pkg.sourceExecutionPlanId !== input.expectedSourceExecutionPlanId) {
    add("EXECUTION_PLAN_TRACEABILITY_BROKEN", "Package's sourceExecutionPlanId does not match the expected execution plan id.");
  }

  // 4 -- source ExecutionUnit exists.
  const unit = executionPlan.plannedUnits.find((u) => u.executionUnit.executionUnitId === pkg.sourceExecutionUnitId);
  if (!unit) {
    add("MISSING_SOURCE_EXECUTION_UNIT", `Execution unit "${pkg.sourceExecutionUnitId}" is not in the source execution plan.`);
    return finalize(findings, professionalApprovalPresent);
  }
  if (scene.sourceExecutionUnitId !== pkg.sourceExecutionUnitId) {
    add("PROFESSIONAL_SEMANTIC_CONTRADICTION", "Package's source execution unit differs from its own source scene's.");
  }

  // 5 / 7 -- source AtomicAction references valid + non-empty.
  const validActionIds = new Set(unit.atomicActions.map((a) => a.atomicActionId));
  if (pkg.sourceAtomicActionIds.length === 0) add("MISSING_SOURCE_ACTION", "Package has no source atomic actions.");
  for (const aid of pkg.sourceAtomicActionIds) {
    if (!validActionIds.has(aid)) add("MISSING_SOURCE_ACTION", `Atomic action "${aid}" is not on the package's own source execution unit.`);
    if (!scene.sourceAtomicActionIds.includes(aid)) add("PROFESSIONAL_SEMANTIC_CONTRADICTION", `Atomic action "${aid}" is not part of the package's own source scene.`);
  }

  // 6 -- exact skill / version traceable.
  const template = templates.find((t) => t.skillInstance.skillInstanceId === unit.executionUnit.sourceSkillInstanceId);
  if (!template) {
    add("SKILL_VERSION_TRACEABILITY_BROKEN", `No skill template registered for Skill Instance "${unit.executionUnit.sourceSkillInstanceId}".`);
  } else {
    if (pkg.skillId !== template.skillInstance.sourceSkillId || pkg.skillVersion !== template.skillInstance.sourceSkillVersion) {
      add("SKILL_VERSION_TRACEABILITY_BROKEN", `Package skill ${pkg.skillId} v${pkg.skillVersion} does not match the traceable source skill ${template.skillInstance.sourceSkillId} v${template.skillInstance.sourceSkillVersion}.`);
    }
    const declared = new Set((template.skillDefinition.capabilities ?? []).map((c) => c.kind));
    // 13 -- expected visible effect uses a real, declared skill capability.
    if (!declared.has(pkg.expectedVisibleEffect.capability)) {
      add("UNSUPPORTED_EXPECTED_EFFECT", `Package's expected effect capability "${pkg.expectedVisibleEffect.capability}" is not declared by skill ${pkg.skillId} v${pkg.skillVersion}.`);
    }
  }
  if (!(SKILL_CAPABILITY_KINDS as readonly string[]).includes(pkg.expectedVisibleEffect.capability)) {
    add("UNSUPPORTED_EXPECTED_EFFECT", "Package's expected effect capability is not a recognized skill capability.");
  }
  if (pkg.expectedVisibleEffect.capability !== unit.declaredCapabilityUsed) {
    add("PROFESSIONAL_SEMANTIC_CONTRADICTION", `Package expected-effect capability "${pkg.expectedVisibleEffect.capability}" differs from the source unit's declared capability "${unit.declaredCapabilityUsed}".`);
  }

  // 8 -- zone consistent with source.
  if (pkg.contributesToDelta.scope !== unit.addressesDelta.scope || pkg.contributesToDelta.field !== unit.addressesDelta.field) {
    add("PROFESSIONAL_SEMANTIC_CONTRADICTION", "Package's contributesToDelta differs from its source unit's addressesDelta.");
  }

  // 9 -- required professional parameters present.
  if (pkg.professionalParameters.length === 0 && scene.phase !== "VERIFICATION") {
    add("PROFESSIONAL_PARAMETER_UNKNOWN", "No resolved professional parameters carried for a non-verification scene.");
  }

  // 20 -- unresolved delta not falsely solved.
  if (scenePlan.unresolvedRequirements.some((r) => r.scope === pkg.contributesToDelta.scope && r.field === pkg.contributesToDelta.field)) {
    add("UNRESOLVED_DELTA", `Package contributes to (${pkg.contributesToDelta.scope}, ${pkg.contributesToDelta.field}), still listed as unresolved.`);
  }

  // 10 / 11 / 12 / 27 -- progression + bounded iteration + stop condition
  // (the mandatory "one isolated cut" guard, Part AE). Scoped to the
  // package's OWN covered source actions: a progressive unit's PREPARATION
  // and VERIFICATION scenes legitimately show no progression -- only its
  // EXECUTION-phase package (which covers the iterated CONTROL/EXECUTE
  // actions) must carry the bounded progression.
  const iteratedActionIds = new Set(unit.atomicActions.filter((a) => a.iteration !== undefined).map((a) => a.atomicActionId));
  const packageCoversIteratedAction = pkg.sourceAtomicActionIds.some((id) => iteratedActionIds.has(id));
  if (packageCoversIteratedAction) {
    if (!pkg.progression || pkg.progression.kind === "SINGLE_PASS") {
      add("MISSING_PROGRESSION", "Source unit repeats subsection-by-subsection, but the package shows only a single pass.");
    }
    if (!pkg.progression || pkg.progression.iteration === undefined || !ITERATION_STOP_MODES.has(pkg.progression.iteration.mode)) {
      add("MISSING_ITERATION", "Source unit has bounded iteration, but the package carries no bounded stop condition.");
    }
    if (!pkg.observables.some((o) => o.aspect === "SUBSECTION_PROGRESSION_VISIBLE")) {
      add("MISSING_PROGRESSION", "A progressive unit's package has no SUBSECTION_PROGRESSION_VISIBLE observable.");
    }
    if (!pkg.verification.questions.some((q) => q.question === "PROGRESSION_SHOWN") || !pkg.verification.questions.some((q) => q.question === "ITERATION_REPRESENTED")) {
      add("MISSING_ITERATION", "A progressive unit's verification contract does not require PROGRESSION_SHOWN + ITERATION_REPRESENTED.");
    }
  }

  // 12 -- completion / stop condition.
  if (pkg.completionCriterion.fact.length === 0) add("MISSING_STOP_CONDITION", "Package has an empty completion criterion.");
  if ((scene.phase === "EXECUTION" || scene.phase === "VERIFICATION") && !pkg.verification.questions.some((q) => q.question === "COMPLETION_CONDITION_REACHED")) {
    add("MISSING_COMPLETION_VISIBILITY", "Package's verification contract does not require the completion condition to be reached.");
  }

  // 14 -- observable exists.
  if (pkg.observables.length === 0) add("MISSING_OBSERVABLE", "Package has no observable.");

  // 15 -- verification contract exists.
  if (pkg.verification.questions.length === 0 || pkg.verification.criterion.fact.length === 0) add("MISSING_VERIFICATION", "Package has no usable verification contract.");

  // 16 -- viewpoint resolved.
  if (pkg.viewpoint.status !== "RESOLVED" || !pkg.viewpoint.family) {
    add("MISSING_VIEWPOINT", "Package's viewpoint could not be resolved deterministically.");
  }

  // 17 -- source visual evidence where required (a PRIMARY_CAPTURE, not
  // merely a TARGET_REFERENCE -- Part S).
  if (pkg.visualEvidenceRequired && !pkg.sourceVisualEvidence.some((e) => e.evidenceRole === "PRIMARY_CAPTURE")) {
    add("MISSING_SOURCE_EVIDENCE", "This scene requires source imagery of the real client (a PRIMARY_CAPTURE), and none is referenced.");
  }

  // 18 -- continuity satisfiable from earlier scenes.
  for (const priorId of pkg.beforeState.requiresPriorSceneIds) {
    const prior = scenePlan.scenes.find((s) => s.sceneId === priorId);
    if (!prior) add("CONTINUITY_UNSATISFIED", `Package depends on prior scene "${priorId}", which is not in the scene plan.`);
    else if (prior.order >= scene.order) add("CONTINUITY_UNSATISFIED", `Package depends on scene "${priorId}", which does not precede its own scene.`);
  }
  for (const need of pkg.beforeState.requiredPriorState) {
    const satisfied = scenePlan.scenes.some((s) => s.order < scene.order && s.continuity.carriesForward.some((c) => c.fact === need.fact));
    if (!satisfied) add("CONTINUITY_UNSATISFIED", `Package requires prior state "${need.fact}", which no earlier scene carries forward.`);
  }

  // 19 -- preservation constraints represented, both as data and as
  // forbidden-deviation "must not" semantics.
  const srcPres = scenePlan.preservationConstraints.map((c) => `${c.scope}::${c.field}::${c.value}`).sort();
  const pkgPres = pkg.preservationConstraints.map((c) => `${c.scope}::${c.field}::${c.value}`).sort();
  if (srcPres.length !== pkgPres.length || srcPres.some((k, i) => k !== pkgPres[i])) {
    add("MISSING_PRESERVATION_CONSTRAINT", "Package's preservation-constraint list differs from the scene plan's.");
  }
  for (const c of scenePlan.preservationConstraints) {
    if (!pkg.forbiddenDeviations.some((f) => f.kind === "CHANGE_PROTECTED_LENGTH" && f.subject === `${c.scope}:${c.field}`)) {
      add("MISSING_PRESERVATION_CONSTRAINT", `Package has no CHANGE_PROTECTED_LENGTH restriction for preserved (${c.scope}, ${c.field}).`);
    }
  }

  // 24 -- required visual relationships present when their parameter is.
  const hasParam = (name: string) => pkg.professionalParameters.some((p) => p.name === name);
  if (hasParam("guideReferenceMode") && !pkg.handToolRelationships.some((r) => r.kind === "TOOL_REFERENCES_PREVIOUS_GUIDE")) {
    add("MISSING_GUIDE_RELATIONSHIP", "guideReferenceMode is a resolved parameter, but no TOOL_REFERENCES_PREVIOUS_GUIDE relationship was compiled.");
  }
  if (hasParam("tool") && !pkg.handToolRelationships.some((r) => r.kind === "TOOL_ALIGNED_TO_CUTTING_LINE" || r.kind === "TOOL_IN_DECLARED_ORIENTATION")) {
    add("MISSING_TOOL_RELATIONSHIP", "A tool parameter is resolved, but no tool relationship was compiled.");
  }

  // 25 -- scene not too broad for its abstract scope.
  if (pkg.progression?.kind === "SPATIAL_SUBSECTION_SEQUENCE" && (pkg.progression.zoneId === undefined || pkg.progression.zoneId.length === 0)) {
    add("SCENE_TOO_BROAD", "A subsection-sequence progression has no bounded zone -- the scene must be split before rendering.");
  }

  // 26 -- scene not semantically empty.
  if (pkg.subjectElements.length === 0 || pkg.observables.length === 0) {
    add("SCENE_SEMANTICALLY_EMPTY", "Package has no subject elements or no observables.");
  }

  // 28 -- professional approval presence (informational -- never blocks
  // RENDER_READY; enforced by isAuthorizedToRender()).
  if (!professionalApprovalPresent) {
    add("PROFESSIONAL_APPROVAL_REQUIRED", "This package is technically render-ready but the source scene plan has not been professionally approved for rendering.");
  }

  return finalize(findings, professionalApprovalPresent);
}

function finalize(findings: readonly RenderReadinessFinding[], professionalApprovalPresent: boolean): RenderReadinessResult {
  // PROFESSIONAL_APPROVAL_REQUIRED is informational only -- it does not
  // change the technical readiness status.
  const blocking = findings.filter((f) => f.reason !== "PROFESSIONAL_APPROVAL_REQUIRED");
  if (blocking.length === 0) {
    return { status: "RENDER_READY", findings, professionalApprovalPresent };
  }
  const candidateStatuses = new Set<RenderReadinessStatus>(blocking.map((f) => REASON_STATUS[f.reason] ?? "NOT_READY"));
  const status = STATUS_PRIORITY.find((s) => candidateStatuses.has(s)) ?? "NOT_READY";
  return { status, findings, professionalApprovalPresent };
}

// ---------------------------------------------------------------------------
// Part AI -- TECHNICALLY RENDER READY vs AUTHORIZED TO SPEND. A future
// paid render must call this, never rely on evaluateRenderReadiness()
// alone.
// ---------------------------------------------------------------------------

export function isAuthorizedToRender(result: RenderReadinessResult): boolean {
  return result.status === "RENDER_READY" && result.professionalApprovalPresent === true;
}

// ---------------------------------------------------------------------------
// Part AE -- the mandatory permanent guard, standalone: a package whose
// source unit requires bounded repeated progression is NOT render-ready
// if it shows only one isolated pass.
// ---------------------------------------------------------------------------

export function isProgressiveScenePackageRenderReady(pkg: VisualInstructionPackage, sourceUnitHasIteration: boolean): boolean {
  if (!sourceUnitHasIteration) return true;
  if (!pkg.progression || pkg.progression.kind === "SINGLE_PASS" || pkg.progression.iteration === undefined) return false;
  if (!pkg.observables.some((o) => o.aspect === "SUBSECTION_PROGRESSION_VISIBLE")) return false;
  const q = new Set(pkg.verification.questions.map((x) => x.question));
  return q.has("PROGRESSION_SHOWN") && q.has("ITERATION_REPRESENTED");
}
