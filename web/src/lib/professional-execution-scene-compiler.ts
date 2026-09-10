import { createHash } from "crypto";

import type { AtomicAction, AtomicActionKind, AtomicActionObservationCriterion } from "@/lib/professional-skill-atomic-action-contracts";
import type { ProfessionalExecutionPlan, PlannedExecutionUnit } from "@/lib/professional-execution-plan-contracts";
import type { ExecutionPlanSkillTemplate } from "@/lib/professional-execution-plan-compiler";
import { deriveDemonstrationRequirementsFromAtomicAction } from "@/lib/cutting-skill-demonstration-requirement-deriver";
import { deriveViewpointConstraintsFromDemonstrationRequirements } from "@/lib/cutting-skill-viewpoint-constraint-deriver";
import { compileAtomicActionToVideoInstruction } from "@/lib/cutting-skill-video-instruction-compiler";
import type { DemonstrationRequirement, DemonstrationRequirementCategory } from "@/lib/professional-skill-demonstration-requirement-contracts";
import type { FramingSemantic, ViewpointFamily } from "@/lib/professional-skill-viewpoint-constraint-contracts";
import {
  PROFESSIONAL_EXECUTION_SCENE_COMPILER_VERSION,
  PROFESSIONAL_EXECUTION_SCENE_PLAN_SCHEMA_VERSION,
  computeSceneFingerprint,
  computeScenePlanFingerprint,
  type ProfessionalExecutionScene,
  type ProfessionalExecutionScenePlan,
  type ProfessionalExecutionScenePlanReadiness,
  type ScenePhase,
  type SceneContinuityFact,
  type SceneCoverageEntry,
  type SceneCoverageStatus,
  type SceneDemonstrationRequirement,
  type SceneObservable,
  type SceneObservableAspect,
  type SceneProgression,
  type SceneViewpoint,
} from "@/lib/professional-execution-scene-contracts";

// AI Hair Architect, Professional Skill Engine Stage 7 -- TECHNICAL
// DEMONSTRATION SCENE COMPILER. Pure, deterministic, no I/O, no AI, ZERO
// paid provider call, ZERO video/Veo/image generation. Compiles a Stage 6
// ProfessionalExecutionPlan into a ProfessionalExecutionScenePlan by
// GROUPING/SPLITTING each PlannedExecutionUnit's own compiled AtomicAction
// sequence into coherent visual scenes -- reusing the EXISTING Stage
// 2.5.i.10/i.12/i.14 derivers (deriveDemonstrationRequirementsFromAtomicAction
// / deriveViewpointConstraintsFromDemonstrationRequirements /
// compileAtomicActionToVideoInstruction) entirely UNCHANGED for the
// per-action visibility/viewpoint/instruction work.
//
// SCENE BOUNDARY LOGIC (Part D) -- deterministic, provider-independent:
// the primary boundary is the ATOMIC ACTION PHASE (professional-skill-
// atomic-action-contracts.ts's own AtomicActionKind, unchanged):
//   PREPARE / POSITION -> PREPARATION phase
//   CONTROL / EXECUTE   -> EXECUTION phase
//   OBSERVE / VERIFY    -> VERIFICATION phase
// One non-empty phase per Execution Unit becomes one scene. Additional
// deterministic splits WITHIN a phase (mirrored bilateral laterality;
// tool/controlMethod change mid-phase) are represented but never fire for
// the 3 real skills (each Execution Unit is single-context by
// construction) -- proven via SYNTHETIC fixtures. Provider duration is
// NOT a domain concept here (Part D) -- it belongs to a future provider
// capability config, never this compiler.
//
// AUTHORITY IS ONE-WAY (Part "AUTHORITY"): every professional fact a scene
// carries is a verbatim reference/copy of an already-approved value on the
// source plan/unit/action. This file NEVER invents a skill/parameter,
// NEVER reorders professional actions, NEVER changes a professional value,
// NEVER marks an unresolved requirement solved, and NEVER drops a
// preservation constraint -- every scene carries the plan's FULL
// preservationConstraints list, and the plan's unresolvedRequirements are
// carried through verbatim with ZERO scenes created for them (Part M/P).

const PHASE_BY_KIND: Readonly<Record<AtomicActionKind, ScenePhase>> = {
  PREPARE: "PREPARATION",
  POSITION: "PREPARATION",
  CONTROL: "EXECUTION",
  EXECUTE: "EXECUTION",
  OBSERVE: "VERIFICATION",
  VERIFY: "VERIFICATION",
};

const PHASE_ORDER: readonly ScenePhase[] = ["PREPARATION", "EXECUTION", "VERIFICATION"];

export interface CompileScenePlanInput {
  plan: ProfessionalExecutionPlan;
  sourceExecutionPlanId: string;
  templates: readonly ExecutionPlanSkillTemplate<string>[];
  compiledAt: string;
}

export interface ScenePlanCompilationSuccess {
  status: "COMPILED";
  scenePlan: ProfessionalExecutionScenePlan;
}

export interface ScenePlanCompilationFailure {
  status: "UNRESOLVED";
  reason: string;
  sourceExecutionUnitId?: string;
}

export type ScenePlanCompilationResult = ScenePlanCompilationSuccess | ScenePlanCompilationFailure;

// A deterministic hash of the source plan's own SEMANTIC content -- the
// exact-version binding anchor (Part B / Part N checks 1/2). A scene plan
// compiled from this content never silently starts using a changed plan.
export function computeSourceExecutionPlanFingerprint(plan: ProfessionalExecutionPlan): string {
  const canonical = JSON.stringify({
    sv: plan.schemaVersion,
    cs: [plan.currentSnapshotId, plan.currentSnapshotVersion],
    ts: [plan.targetSnapshotId, plan.targetSnapshotVersion],
    rp: [plan.reasoningProposalId, plan.reasoningProposalContextFingerprint],
    units: plan.plannedUnits.map((u) => ({
      eu: u.executionUnit.executionUnitId,
      cap: u.declaredCapabilityUsed,
      d: u.addressesDelta,
      actions: u.atomicActions.map((a) => [a.atomicActionId, a.actionKind, a.order, a.iteration ?? null]),
      params: [...u.resolvedParameters].map((p) => `${p.name}=${String(p.value)}:${p.source}`).sort(),
      comp: u.completionCriterion,
    })),
    pres: plan.preservationConstraints,
    unres: plan.unresolvedRequirements,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function groupByPhase<TFact extends string>(actions: readonly AtomicAction<TFact>[]): Map<ScenePhase, AtomicAction<TFact>[]> {
  const byPhase = new Map<ScenePhase, AtomicAction<TFact>[]>();
  const ordered = [...actions].sort((a, b) => a.order - b.order);
  for (const action of ordered) {
    const phase = PHASE_BY_KIND[action.actionKind];
    const bucket = byPhase.get(phase);
    if (bucket) bucket.push(action);
    else byPhase.set(phase, [action]);
  }
  return byPhase;
}

const OBSERVABLE_ASPECT_BY_CATEGORY: Readonly<Record<DemonstrationRequirementCategory, SceneObservableAspect>> = {
  TOOL_TO_SUBJECT_RELATIONSHIP: "TOOL_TO_SUBJECT_RELATION_VISIBLE",
  SUBJECT_TO_REFERENCE_GEOMETRY: "ELEVATION_RELATION_VISIBLE",
  RESULTING_LINE_OR_FORM: "CUTTING_LINE_VISIBLE",
  ANATOMICAL_CONTEXT: "ANATOMICAL_CONTEXT_VISIBLE",
  SUBJECT_POSITION_STATE: "ANATOMICAL_CONTEXT_VISIBLE",
  SUBJECT_CONDITION_STATE: "SUBJECT_CONDITION_VISIBLE",
};

interface PhaseDerivation<TFact extends string> {
  requirements: readonly DemonstrationRequirement<TFact>[];
  videoInstructionIds: readonly string[];
  viewpoint: SceneViewpoint;
}

function derivePhase<TFact extends string>(
  template: ExecutionPlanSkillTemplate<TFact>,
  unit: PlannedExecutionUnit<TFact>,
  phaseActions: readonly AtomicAction<TFact>[],
  compiledAt: string,
): { ok: true; value: PhaseDerivation<TFact> } | { ok: false; reason: string } {
  const executionUnit = unit.executionUnit;
  const allRequirements: DemonstrationRequirement<TFact>[] = [];
  const videoInstructionIds: string[] = [];

  // Scene-level viewpoint is the UNION of its constituent actions' own
  // viewpoint constraints -- each derived PER ACTION via the existing
  // Stage 2.5.i.12 deriver unchanged (that deriver is scoped to one
  // action's requirements by design and rejects a mixed-action set). A
  // phase-scene groups several actions, so this compiler unions their
  // already-correctly-derived per-action results rather than re-running
  // the deriver on a mixed set.
  const families = new Set<ViewpointFamily>();
  const framings = new Set<FramingSemantic>();
  const constraintIds = new Set<string>();
  let anyActionUnsatisfied = false;
  let anyActionHadRequirements = false;

  for (const action of phaseActions) {
    const reqResult = deriveDemonstrationRequirementsFromAtomicAction(action, template.skillInstance, executionUnit, template.isValidFact, compiledAt);
    if (reqResult.status === "NON_DERIVABLE") {
      return { ok: false, reason: `Demonstration Requirement derivation failed for action "${action.atomicActionId}": ${reqResult.reason}` };
    }
    allRequirements.push(...reqResult.requirements);
    if (reqResult.requirements.length === 0) continue;
    anyActionHadRequirements = true;

    const viewpointResult = deriveViewpointConstraintsFromDemonstrationRequirements(reqResult.requirements, template.isValidFact, compiledAt);
    if (viewpointResult.status === "COVERED") {
      for (const c of viewpointResult.constraints) {
        families.add(c.viewpointFamily);
        framings.add(c.framingSemantic);
        constraintIds.add(c.viewpointConstraintId);
      }
      const vi = compileAtomicActionToVideoInstruction(action, reqResult.requirements, viewpointResult, template.isValidFact, compiledAt);
      if (vi.status === "COMPILED") videoInstructionIds.push(vi.instruction.videoInstructionId);
    } else {
      anyActionUnsatisfied = true;
    }
  }

  // Fail-closed (Part I): a phase with no visibility requirements at all,
  // or one where a constituent action's viewpoint could not be resolved,
  // is NEEDS_INPUT -- never silently guessed. A single resolved family
  // across all actions is the RESOLVED outcome.
  let viewpoint: SceneViewpoint;
  if (!anyActionHadRequirements || anyActionUnsatisfied || families.size !== 1) {
    viewpoint = { status: "NEEDS_INPUT", framingSemantics: [], sourceViewpointConstraintIds: [] };
  } else {
    viewpoint = {
      status: "RESOLVED",
      family: [...families][0],
      framingSemantics: [...framings].sort(),
      sourceViewpointConstraintIds: [...constraintIds].sort(),
    };
  }

  return { ok: true, value: { requirements: dedupeById(allRequirements), videoInstructionIds: [...new Set(videoInstructionIds)].sort(), viewpoint } };
}

function dedupeById<TFact extends string>(requirements: readonly DemonstrationRequirement<TFact>[]): DemonstrationRequirement<TFact>[] {
  const byId = new Map<string, DemonstrationRequirement<TFact>>();
  for (const r of requirements) if (!byId.has(r.demonstrationRequirementId)) byId.set(r.demonstrationRequirementId, r);
  return [...byId.values()];
}

function buildObservables<TFact extends string>(
  phase: ScenePhase,
  requirements: readonly DemonstrationRequirement<TFact>[],
  unit: PlannedExecutionUnit<TFact>,
  hasIteration: boolean,
  hasPreservation: boolean,
): SceneObservable[] {
  const byAspect = new Map<SceneObservableAspect, Set<string>>();
  const add = (aspect: SceneObservableAspect, id: string) => {
    const set = byAspect.get(aspect) ?? new Set<string>();
    set.add(id);
    byAspect.set(aspect, set);
  };

  for (const r of requirements) {
    let aspect = OBSERVABLE_ASPECT_BY_CATEGORY[r.category];
    if (r.category === "RESULTING_LINE_OR_FORM" && unit.declaredCapabilityUsed === "ESTABLISH_GUIDE") aspect = "GUIDE_LINE_VISIBLE";
    add(aspect, r.demonstrationRequirementId);
  }

  const unitId = unit.executionUnit.executionUnitId;
  if (phase === "EXECUTION" && hasIteration) add("SUBSECTION_PROGRESSION_VISIBLE", unitId);
  if (phase === "VERIFICATION") add("ZONE_COMPLETION_VISIBLE", unitId);
  if (unit.declaredCapabilityUsed === "CONNECT_ZONES") add("ZONE_CONNECTION_VISIBLE", unitId);
  if (hasPreservation) add("PRESERVED_REGION_VISIBLE", unitId);

  return [...byAspect.entries()]
    .map(([aspect, ids]) => ({ aspect, sourceRequirementIds: [...ids].sort() }))
    .sort((a, b) => a.aspect.localeCompare(b.aspect));
}

function buildDemonstrationRequirements<TFact extends string>(
  phase: ScenePhase,
  unit: PlannedExecutionUnit<TFact>,
  progression: SceneProgression | undefined,
  preservation: readonly { scope: string; field: string; value: string }[],
): SceneDemonstrationRequirement[] {
  const reqs: SceneDemonstrationRequirement[] = [{ kind: "MUST_SHOW", subject: unit.declaredCapabilityUsed }];
  for (const c of preservation) reqs.push({ kind: "MUST_PRESERVE", subject: `${c.scope}:${c.field}` });
  if (progression?.kind === "SPATIAL_SUBSECTION_SEQUENCE") reqs.push({ kind: "REQUIRES_CONTINUOUS_PROGRESS" });
  if (progression?.kind === "MIRRORED_BILATERAL") reqs.push({ kind: "REQUIRES_BEFORE_AFTER" });
  if (phase === "EXECUTION" || phase === "VERIFICATION") reqs.push({ kind: "REQUIRES_COMPLETION_VISIBLE" });
  if (phase === "VERIFICATION") reqs.push({ kind: "REQUIRES_VERIFICATION_VIEW" });
  if (unit.declaredCapabilityUsed === "ESTABLISH_GUIDE" || unit.declaredCapabilityUsed === "CONNECT_ZONES") reqs.push({ kind: "REQUIRES_CLOSEUP" });
  return reqs;
}

function coverageStatusForUnit(scenesForUnit: readonly ProfessionalExecutionScene[], executionHasIteration: boolean): SceneCoverageStatus {
  if (scenesForUnit.length === 0) return "NOT_DEMONSTRABLE";
  if (scenesForUnit.some((s) => s.viewpoint.status === "NEEDS_INPUT")) return "NEEDS_INPUT";
  const executionScene = scenesForUnit.find((s) => s.phase === "EXECUTION");
  if (!executionScene) return "PARTIALLY_COVERED";
  if (executionHasIteration && executionScene.progression?.kind !== "SPATIAL_SUBSECTION_SEQUENCE") return "PARTIALLY_COVERED";
  if (executionHasIteration && executionScene.progression?.iteration === undefined) return "PARTIALLY_COVERED";
  if (!scenesForUnit.some((s) => s.phase === "VERIFICATION")) return "PARTIALLY_COVERED";
  return "FULLY_COVERED";
}

export function compileProfessionalExecutionScenePlan(input: CompileScenePlanInput): ScenePlanCompilationResult {
  const { plan, templates, compiledAt } = input;
  const sourceExecutionPlanFingerprint = computeSourceExecutionPlanFingerprint(plan);

  const scenes: ProfessionalExecutionScene[] = [];
  const coverage: SceneCoverageEntry[] = [];
  let order = 1;

  // Map every execution unit id -> its own eventual scene ids, for the
  // before-contract / dependency wiring.
  const unitSceneIds = new Map<string, string[]>();
  const unitCompletionFact = new Map<string, AtomicActionObservationCriterion>();
  for (const unit of plan.plannedUnits) unitCompletionFact.set(unit.executionUnit.executionUnitId, unit.completionCriterion);

  for (const unit of plan.plannedUnits) {
    const executionUnit = unit.executionUnit;
    const template = templates.find(
      (t) => t.skillInstance.skillInstanceId === executionUnit.sourceSkillInstanceId,
    );
    if (!template) {
      return { status: "UNRESOLVED", reason: `No template registered for Skill Instance "${executionUnit.sourceSkillInstanceId}".`, sourceExecutionUnitId: executionUnit.executionUnitId };
    }

    const byPhase = groupByPhase(unit.atomicActions);
    const executionHasIteration = (byPhase.get("EXECUTION") ?? []).some((a) => a.iteration !== undefined);
    const resolvedParamNames = new Set(unit.resolvedParameters.map((p) => p.name));
    const scenesForUnit: ProfessionalExecutionScene[] = [];
    const myPhaseSceneId = new Map<ScenePhase, string>();

    for (const phase of PHASE_ORDER) {
      const phaseActions = byPhase.get(phase);
      if (!phaseActions || phaseActions.length === 0) continue;

      const derived = derivePhase(template, unit, phaseActions, compiledAt);
      if (!derived.ok) return { status: "UNRESOLVED", reason: derived.reason, sourceExecutionUnitId: executionUnit.executionUnitId };

      const sceneId = `${executionUnit.executionUnitId}#scene-${phase.toLowerCase()}`;

      // PROGRESSION (Part F / Part N check 16).
      let progression: SceneProgression | undefined;
      let progressionNotApplicableReason: string | undefined;
      if (phase === "EXECUTION") {
        if (executionUnit.laterality === "BILATERAL") {
          progression = { kind: "MIRRORED_BILATERAL", zoneId: executionUnit.zoneId, iteration: phaseActions.find((a) => a.iteration)?.iteration };
        } else if (executionHasIteration) {
          progression = { kind: "SPATIAL_SUBSECTION_SEQUENCE", zoneId: executionUnit.zoneId, iteration: phaseActions.find((a) => a.iteration)!.iteration };
        } else {
          progression = { kind: "SINGLE_PASS", zoneId: executionUnit.zoneId };
        }
      } else if (phase === "PREPARATION") {
        progressionNotApplicableReason = "Preparation/positioning is a single bounded setup step, not a progressive execution pass.";
      } else {
        progressionNotApplicableReason = "Verification is a single bounded observation, not a progressive execution pass.";
      }

      // COMPLETION.
      const completionCriterion: AtomicActionObservationCriterion =
        phase === "PREPARATION"
          ? { fact: `${sceneId}.preparation_ready`, expectedValue: true, evidenceStatus: "RUNTIME_PROFESSIONAL_OBSERVATION" }
          : unit.completionCriterion;

      // VERIFICATION mode/criterion -- prefer a VERIFY action's own
      // observationCriterion; else the unit's own completion criterion.
      const verifyAction = phaseActions.find((a) => a.actionKind === "VERIFY" || a.actionKind === "OBSERVE");
      const verificationCriterion = verifyAction?.observationCriterion ?? unit.completionCriterion;

      // BEFORE CONTRACT.
      const requiresPriorSceneIds: string[] = [];
      const requiredPriorState: AtomicActionObservationCriterion[] = [];
      // Prior phase-scene of the SAME unit.
      const priorPhaseIndex = PHASE_ORDER.indexOf(phase) - 1;
      for (let i = priorPhaseIndex; i >= 0; i -= 1) {
        const priorId = myPhaseSceneId.get(PHASE_ORDER[i]);
        if (priorId) {
          requiresPriorSceneIds.push(priorId);
          break;
        }
      }
      // Cross-unit dependency -- only on the FIRST phase-scene of this unit.
      if (myPhaseSceneId.size === 0) {
        const prereqUnitIds = new Set<string>(executionUnit.prerequisiteExecutionUnitIds ?? []);
        for (const prereqInstanceId of template.skillInstance.prerequisiteSkillInstanceIds ?? []) {
          for (const other of plan.plannedUnits) {
            if (other.executionUnit.sourceSkillInstanceId === prereqInstanceId) prereqUnitIds.add(other.executionUnit.executionUnitId);
          }
        }
        for (const prereqUnitId of prereqUnitIds) {
          for (const sid of unitSceneIds.get(prereqUnitId) ?? []) requiresPriorSceneIds.push(sid);
          const priorCompletion = unitCompletionFact.get(prereqUnitId);
          if (priorCompletion) requiredPriorState.push(priorCompletion);
        }
      }

      // CONTINUITY (Part H).
      const mustRemainStable: SceneContinuityFact[] = ["SAME_CLIENT_AND_HEAD"];
      if (resolvedParamNames.has("hairState")) mustRemainStable.push("SAME_WET_DRY_STATE");
      if (requiredPriorState.length > 0) mustRemainStable.push("SAME_ESTABLISHED_GUIDE");
      if (order > 1 || unitSceneIds.size > 0) mustRemainStable.push("SAME_COMPLETED_PRIOR_ZONES");
      if (plan.preservationConstraints.length > 0) mustRemainStable.push("SAME_PRESERVED_REGIONS");
      if (resolvedParamNames.has("tool")) mustRemainStable.push("SAME_TOOL");

      const preservedConstraints = plan.preservationConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value }));
      const observables = buildObservables(phase, derived.value.requirements, unit, phase === "EXECUTION" && executionHasIteration, preservedConstraints.length > 0);
      const demonstrationRequirements = buildDemonstrationRequirements(phase, unit, progression, preservedConstraints);

      const stateTransitions =
        phase === "PREPARATION"
          ? [{ fact: completionCriterion.fact, toValue: completionCriterion.expectedValue }]
          : [{ fact: unit.completionCriterion.fact, toValue: unit.completionCriterion.expectedValue }];

      const requiredMedium = verificationCriterion.evidenceStatus === "DETERMINISTIC_STATE_CHECK" && phase === "VERIFICATION" ? "STATIC_OK" : "MOTION_REQUIRED";

      const sceneFingerprint = computeSceneFingerprint({
        sourceExecutionPlanId: input.sourceExecutionPlanId,
        sourceExecutionUnitId: executionUnit.executionUnitId,
        phase,
        sourceAtomicActionIds: phaseActions.map((a) => a.atomicActionId),
        demonstratesCapability: unit.declaredCapabilityUsed,
        contributesToDelta: unit.addressesDelta,
        progression,
        completionCriterion,
        observableAspects: observables.map((o) => o.aspect),
        viewpointFamily: derived.value.viewpoint.family,
        framingSemantics: derived.value.viewpoint.framingSemantics,
        preservedConstraints,
        compilerVersion: PROFESSIONAL_EXECUTION_SCENE_COMPILER_VERSION,
      });

      const scene: ProfessionalExecutionScene = {
        sceneId,
        order: order++,
        phase,
        sourceExecutionUnitId: executionUnit.executionUnitId,
        sourceAtomicActionIds: phaseActions.map((a) => a.atomicActionId).sort(),
        sourceVideoInstructionIds: derived.value.videoInstructionIds,
        demonstratesCapability: unit.declaredCapabilityUsed,
        contributesToDelta: { scope: unit.addressesDelta.scope, field: unit.addressesDelta.field },
        beforeContract: { requiresPriorSceneIds: [...new Set(requiresPriorSceneIds)], requiredPriorState },
        progression,
        progressionNotApplicableReason,
        completionCriterion,
        expectedVisibleEffect: { stateTransitions, preservedConstraints },
        observables,
        verification: { mode: verificationCriterion.evidenceStatus, criterion: verificationCriterion },
        viewpoint: derived.value.viewpoint,
        continuity: { mustRemainStable, carriesForward: [unit.completionCriterion] },
        demonstrationRequirements,
        requiredMedium,
        sceneFingerprint,
      };

      scenes.push(scene);
      scenesForUnit.push(scene);
      myPhaseSceneId.set(phase, sceneId);
    }

    unitSceneIds.set(executionUnit.executionUnitId, scenesForUnit.map((s) => s.sceneId));
    coverage.push({
      sourceExecutionUnitId: executionUnit.executionUnitId,
      status: coverageStatusForUnit(scenesForUnit, executionHasIteration),
      sceneIds: scenesForUnit.map((s) => s.sceneId),
    });
  }

  const readiness = computeReadiness(coverage, plan.unresolvedRequirements.length);

  const scenePlanFingerprint = computeScenePlanFingerprint({
    sourceExecutionPlanId: input.sourceExecutionPlanId,
    sourceExecutionPlanFingerprint,
    compilerVersion: PROFESSIONAL_EXECUTION_SCENE_COMPILER_VERSION,
    schemaVersion: PROFESSIONAL_EXECUTION_SCENE_PLAN_SCHEMA_VERSION,
    sceneFingerprints: scenes.map((s) => s.sceneFingerprint),
  });

  const scenePlan: ProfessionalExecutionScenePlan = {
    schemaVersion: PROFESSIONAL_EXECUTION_SCENE_PLAN_SCHEMA_VERSION,
    compilerVersion: PROFESSIONAL_EXECUTION_SCENE_COMPILER_VERSION,
    sourceExecutionPlanId: input.sourceExecutionPlanId,
    sourceExecutionPlanFingerprint,
    sourceReasoningProposalId: plan.reasoningProposalId,
    currentSnapshotId: plan.currentSnapshotId,
    currentSnapshotVersion: plan.currentSnapshotVersion,
    targetSnapshotId: plan.targetSnapshotId,
    targetSnapshotVersion: plan.targetSnapshotVersion,
    scenes,
    coverage,
    preservationConstraints: plan.preservationConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value, description: c.description })),
    unresolvedRequirements: plan.unresolvedRequirements.map((r) => ({ scope: r.scope, field: r.field, reason: r.reason })),
    readiness,
    scenePlanFingerprint,
  };

  return { status: "COMPILED", scenePlan };
}

function computeReadiness(coverage: readonly SceneCoverageEntry[], unresolvedCount: number): ProfessionalExecutionScenePlanReadiness {
  if (coverage.some((c) => c.status === "NOT_DEMONSTRABLE")) return "BLOCKED";
  if (coverage.some((c) => c.status === "NEEDS_INPUT")) return "NEEDS_INPUT";
  if (coverage.some((c) => c.status === "PARTIALLY_COVERED") || unresolvedCount > 0) return "PARTIAL";
  return "READY_FOR_PROFESSIONAL_REVIEW";
}
