import type { ProfessionalExecutionPlan } from "@/lib/professional-execution-plan-contracts";
import { computeSourceExecutionPlanFingerprint } from "@/lib/professional-execution-scene-compiler";
import type { ProfessionalExecutionScenePlan, ScenePlanFailureReason } from "@/lib/professional-execution-scene-contracts";

// AI Hair Architect, Professional Skill Engine Stage 7 -- SCENE PLAN
// deterministic validator (Part N, 27 checks + the mandatory Part Q
// "one isolated cut" guard). Pure, no I/O, no AI, no provider call. FAIL
// CLOSED throughout. Assumes the `scenePlan` input already passed
// isValidProfessionalExecutionScenePlan (professional-execution-scene-
// contracts.ts) -- this file re-verifies PROFESSIONAL CORRECTNESS and
// SOURCE FIDELITY against the exact ProfessionalExecutionPlan the scene
// plan claims to derive from, never bare shape.
//
// SCENE COMPILATION MAY NOT ALTER PROFESSIONAL SOURCE SEMANTICS (Part Y
// item 5): every check below that compares a scene value to a source
// value is verbatim equality -- a scene compiler that reordered actions,
// changed a capability/delta/parameter, dropped a preservation
// constraint, marked an unresolved delta solved, or collapsed a bounded
// progression to one cut is rejected here with a specific reason, never a
// generic "invalid scene".

export interface ScenePlanValidationFailure {
  failureReason: ScenePlanFailureReason;
  detail: string;
  sceneId?: string;
}

export interface ScenePlanValidationResult {
  valid: boolean;
  failures: readonly ScenePlanValidationFailure[];
}

export interface ValidateScenePlanInput {
  scenePlan: ProfessionalExecutionScenePlan;
  sourcePlan: ProfessionalExecutionPlan;
  // Optional -- when the caller knows the persisted ProfessionalExecutionPlan
  // row id, a mismatch is reported (Part N check 1).
  expectedSourceExecutionPlanId?: string;
}

function samePreservation(
  a: readonly { scope: string; field: string; value: string }[],
  b: readonly { scope: string; field: string; value: string }[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (c: { scope: string; field: string; value: string }) => `${c.scope}::${c.field}::${c.value}`;
  const setB = new Set(b.map(key));
  return a.every((c) => setB.has(key(c)));
}

export function validateProfessionalExecutionScenePlan(input: ValidateScenePlanInput): ScenePlanValidationResult {
  const { scenePlan, sourcePlan } = input;
  const failures: ScenePlanValidationFailure[] = [];
  const add = (failureReason: ScenePlanFailureReason, detail: string, sceneId?: string) => failures.push({ failureReason, detail, sceneId });

  // -- Checks 1/2/10 -- exact source binding.
  if (input.expectedSourceExecutionPlanId !== undefined && input.expectedSourceExecutionPlanId !== scenePlan.sourceExecutionPlanId) {
    add("SCENE_PLAN_NOT_BOUND_TO_EXACT_PLAN_VERSION", `Scene plan sourceExecutionPlanId "${scenePlan.sourceExecutionPlanId}" does not match the expected plan id.`);
  }
  const recomputedFingerprint = computeSourceExecutionPlanFingerprint(sourcePlan);
  if (scenePlan.sourceExecutionPlanFingerprint !== recomputedFingerprint) {
    add(
      "SCENE_PLAN_NOT_BOUND_TO_EXACT_PLAN_VERSION",
      "Scene plan's pinned source-plan fingerprint no longer matches the given ProfessionalExecutionPlan's own content (a skill version, parameter, order, or preservation constraint changed).",
    );
  }
  if (scenePlan.sourceReasoningProposalId !== sourcePlan.reasoningProposalId) {
    add("PROFESSIONAL_SOURCE_ALTERED", "Scene plan references a different reasoning proposal than its source execution plan.");
  }

  // -- Index the source plan.
  const unitById = new Map(sourcePlan.plannedUnits.map((u) => [u.executionUnit.executionUnitId, u] as const));
  const actionIdsByUnit = new Map(
    sourcePlan.plannedUnits.map((u) => [u.executionUnit.executionUnitId, new Set(u.atomicActions.map((a) => a.atomicActionId))] as const),
  );
  const iterationByUnitAction = new Map<string, Map<string, string>>();
  for (const u of sourcePlan.plannedUnits) {
    const m = new Map<string, string>();
    for (const a of u.atomicActions) if (a.iteration) m.set(a.atomicActionId, JSON.stringify(a.iteration));
    iterationByUnitAction.set(u.executionUnit.executionUnitId, m);
  }
  const scenesById = new Map(scenePlan.scenes.map((s) => [s.sceneId, s] as const));

  // -- Check 13/26 -- preservation & unresolved carried verbatim.
  if (
    !samePreservation(
      scenePlan.preservationConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value })),
      sourcePlan.preservationConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value })),
    )
  ) {
    add("PRESERVATION_CONSTRAINT_LOST", "Scene plan's preservation-constraint list differs from the source execution plan's.");
  }
  const srcUnresolvedKeys = new Set(sourcePlan.unresolvedRequirements.map((r) => `${r.scope}::${r.field}`));
  const sceneUnresolvedKeys = new Set(scenePlan.unresolvedRequirements.map((r) => `${r.scope}::${r.field}`));
  if (srcUnresolvedKeys.size !== sceneUnresolvedKeys.size || [...srcUnresolvedKeys].some((k) => !sceneUnresolvedKeys.has(k))) {
    add("PROFESSIONAL_SOURCE_ALTERED", "Scene plan's unresolved-requirements list differs from the source execution plan's.");
  }

  // -- Per-scene checks (3/4/5/7/8/9/11/12/14/15/17/18/19/20/21/22/23).
  for (const scene of scenePlan.scenes) {
    const unit = unitById.get(scene.sourceExecutionUnitId);
    if (!scene.sourceExecutionUnitId) add("MISSING_SOURCE_EXECUTION_UNIT", "Scene has no source execution unit id.", scene.sceneId);
    if (!unit) {
      add("MISSING_SOURCE_EXECUTION_UNIT", `Scene references execution unit "${scene.sourceExecutionUnitId}", which is not in the source plan.`, scene.sceneId);
      continue;
    }

    // Check 5/15 -- source actions exist and are non-empty.
    if (scene.sourceAtomicActionIds.length === 0) {
      add("MISSING_SOURCE_ACTION", "Scene has no source atomic actions.", scene.sceneId);
    }
    const validActionIds = actionIdsByUnit.get(scene.sourceExecutionUnitId)!;
    for (const aid of scene.sourceAtomicActionIds) {
      if (!validActionIds.has(aid)) add("MISSING_SOURCE_ACTION", `Scene references atomic action "${aid}", which is not on its own source execution unit.`, scene.sceneId);
    }

    // Check 9/11 -- no professional parameter/capability/delta changed.
    if (scene.demonstratesCapability !== unit.declaredCapabilityUsed) {
      add("PROFESSIONAL_SOURCE_ALTERED", `Scene declares capability "${scene.demonstratesCapability}" but its source unit uses "${unit.declaredCapabilityUsed}".`, scene.sceneId);
    }
    if (scene.contributesToDelta.scope !== unit.addressesDelta.scope || scene.contributesToDelta.field !== unit.addressesDelta.field) {
      add("PROFESSIONAL_SOURCE_ALTERED", "Scene's contributesToDelta differs from its source unit's addressesDelta.", scene.sceneId);
    }

    // Check 12 -- no scene for an unsupported delta.
    if (srcUnresolvedKeys.has(`${scene.contributesToDelta.scope}::${scene.contributesToDelta.field}`)) {
      add("UNSUPPORTED_DELTA_SCENE", `Scene contributes to (${scene.contributesToDelta.scope}, ${scene.contributesToDelta.field}), which the plan still lists as unresolved.`, scene.sceneId);
    }

    // Check 13 -- every scene still carries the full preservation list.
    if (
      !samePreservation(
        scene.expectedVisibleEffect.preservedConstraints,
        sourcePlan.preservationConstraints.map((c) => ({ scope: c.scope, field: c.field, value: c.value })),
      )
    ) {
      add("PRESERVATION_CONSTRAINT_LOST", "Scene's expectedVisibleEffect.preservedConstraints does not match the source plan's full preservation list.", scene.sceneId);
    }

    // Check 17 + Part Q -- iteration retained where the source has it.
    const iteratedActions = iterationByUnitAction.get(scene.sourceExecutionUnitId)!;
    const sceneCoversIteratedAction = scene.sourceAtomicActionIds.some((aid) => iteratedActions.has(aid));
    if (sceneCoversIteratedAction) {
      if (!scene.progression || scene.progression.iteration === undefined) {
        add("ITERATION_COLLAPSED", `Scene "${scene.sceneId}" covers a bounded-iteration action but retains no progression/iteration -- one isolated pass cannot demonstrate a progressive task.`, scene.sceneId);
      } else if (scene.progression.kind === "SINGLE_PASS") {
        add("PROGRESSION_NOT_COVERED", `Scene "${scene.sceneId}" covers a bounded-iteration action but is marked SINGLE_PASS.`, scene.sceneId);
      } else {
        const expected = [...iteratedActions.values()][0];
        if (JSON.stringify(scene.progression.iteration) !== expected) {
          add("ITERATION_COLLAPSED", `Scene "${scene.sceneId}" carries an iteration that does not match its source action's own bounded iteration.`, scene.sceneId);
        }
      }
    }

    // Check 18 -- completion requirement present for execution/verification.
    if ((scene.phase === "EXECUTION" || scene.phase === "VERIFICATION") && !scene.demonstrationRequirements.some((r) => r.kind === "REQUIRES_COMPLETION_VISIBLE")) {
      add("MISSING_COMPLETION_REQUIREMENT", `Scene "${scene.sceneId}" (${scene.phase}) has no REQUIRES_COMPLETION_VISIBLE demonstration requirement.`, scene.sceneId);
    }
    if (scene.completionCriterion.fact.length === 0) add("MISSING_COMPLETION_REQUIREMENT", `Scene "${scene.sceneId}" has an empty completion criterion.`, scene.sceneId);

    // Check 19 -- expected visible effect exists.
    if (scene.expectedVisibleEffect.stateTransitions.length === 0 && scene.expectedVisibleEffect.preservedConstraints.length === 0) {
      add("MISSING_EXPECTED_EFFECT", `Scene "${scene.sceneId}" declares no expected visible effect and no preserved constraint.`, scene.sceneId);
    }

    // Check 20 -- observable exists (Part J -- also that it maps to a real source).
    if (scene.observables.length === 0) add("MISSING_OBSERVABLE", `Scene "${scene.sceneId}" has no observable.`, scene.sceneId);
    for (const obs of scene.observables) {
      if (obs.sourceRequirementIds.length === 0) add("MISSING_OBSERVABLE", `Scene "${scene.sceneId}" has an observable with no source requirement id.`, scene.sceneId);
    }

    // Check 21 -- verification requirement exists.
    if (scene.verification.criterion.fact.length === 0) add("MISSING_VERIFICATION_REQUIREMENT", `Scene "${scene.sceneId}" has an empty verification criterion.`, scene.sceneId);
    if (scene.phase === "VERIFICATION" && !scene.demonstrationRequirements.some((r) => r.kind === "REQUIRES_VERIFICATION_VIEW")) {
      add("MISSING_VERIFICATION_REQUIREMENT", `Verification scene "${scene.sceneId}" has no REQUIRES_VERIFICATION_VIEW demonstration requirement.`, scene.sceneId);
    }

    // Check 22 -- viewpoint exists or explicit NEEDS_INPUT.
    if (scene.viewpoint.status === "NEEDS_INPUT") {
      add("NEEDS_PROFESSIONAL_INPUT", `Scene "${scene.sceneId}" could not resolve a viewpoint deterministically and is flagged NEEDS_INPUT.`, scene.sceneId);
    } else if (!scene.viewpoint.family) {
      add("MISSING_VIEWPOINT", `Scene "${scene.sceneId}" claims a RESOLVED viewpoint with no family.`, scene.sceneId);
    }

    // Check 8/23 -- before-contract dependency references are real and earlier.
    for (const priorSceneId of scene.beforeContract.requiresPriorSceneIds) {
      const prior = scenesById.get(priorSceneId);
      if (!prior) {
        add("STATE_CONTINUITY_MISMATCH", `Scene "${scene.sceneId}" depends on scene "${priorSceneId}", which does not exist in the plan.`, scene.sceneId);
      } else if (prior.order >= scene.order) {
        add("DEPENDENCY_ORDER_VIOLATION", `Scene "${scene.sceneId}" (order ${scene.order}) depends on scene "${priorSceneId}" (order ${prior.order}), which does not precede it.`, scene.sceneId);
      }
    }

    // Check 24 -- required prior state must be carried forward by some earlier scene.
    for (const need of scene.beforeContract.requiredPriorState) {
      const satisfied = scenePlan.scenes.some((other) => other.order < scene.order && other.continuity.carriesForward.some((c) => c.fact === need.fact));
      if (!satisfied) {
        add("STATE_CONTINUITY_MISMATCH", `Scene "${scene.sceneId}" requires prior state "${need.fact}", which no earlier scene carries forward.`, scene.sceneId);
      }
    }
  }

  // -- Check 7 -- professional action order preserved: within a unit,
  // PREPARATION < EXECUTION < VERIFICATION by scene order.
  const PHASE_RANK: Record<string, number> = { PREPARATION: 0, EXECUTION: 1, VERIFICATION: 2 };
  for (const unit of sourcePlan.plannedUnits) {
    const unitScenes = scenePlan.scenes.filter((s) => s.sourceExecutionUnitId === unit.executionUnit.executionUnitId).sort((a, b) => a.order - b.order);
    for (let i = 1; i < unitScenes.length; i += 1) {
      if (PHASE_RANK[unitScenes[i].phase] < PHASE_RANK[unitScenes[i - 1].phase]) {
        add("SKILL_ORDER_ALTERED", `Unit "${unit.executionUnit.executionUnitId}" scene order places ${unitScenes[i].phase} before ${unitScenes[i - 1].phase}.`, unitScenes[i].sceneId);
      }
    }
  }

  // -- Check 25 -- every demonstrable execution unit is covered.
  const coveredUnitIds = new Set(scenePlan.coverage.map((c) => c.sourceExecutionUnitId));
  for (const unit of sourcePlan.plannedUnits) {
    if (!coveredUnitIds.has(unit.executionUnit.executionUnitId)) {
      add("EXECUTION_UNIT_OMITTED", `Execution unit "${unit.executionUnit.executionUnitId}" has no coverage entry in the scene plan.`);
    }
  }
  for (const entry of scenePlan.coverage) {
    if (!unitById.has(entry.sourceExecutionUnitId)) {
      add("MISSING_SOURCE_EXECUTION_UNIT", `Coverage entry references unknown execution unit "${entry.sourceExecutionUnitId}".`);
    }
    if ((entry.status === "FULLY_COVERED" || entry.status === "PARTIALLY_COVERED") && entry.sceneIds.length === 0) {
      add("EXECUTION_UNIT_OMITTED", `Coverage entry for "${entry.sourceExecutionUnitId}" claims ${entry.status} but lists no scenes.`);
    }
  }

  // -- Check 27 -- no provider-specific token leaked into professional
  // authority anywhere in the scene plan.
  const json = JSON.stringify(scenePlan).toLowerCase();
  for (const banned of ["veo", "gemini", "openai", "anthropic", "\"prompt\"", "seconds", "framecount", "aspectratio", "focal", "\"seed\""]) {
    if (json.includes(banned)) {
      add("PROFESSIONAL_SOURCE_ALTERED", `Scene plan contains a provider-specific token ("${banned}") -- a scene plan must remain provider-independent.`);
    }
  }

  return { valid: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Part Q -- the mandatory permanent guard, as a standalone predicate too:
// given a source unit whose execution requires bounded repeated
// progression, a scene plan whose EXECUTION scene for that unit shows only
// one isolated pass MUST NOT count as full demonstration coverage.
// ---------------------------------------------------------------------------

export function isProgressiveUnitFullyDemonstrated(scenePlan: ProfessionalExecutionScenePlan, sourcePlan: ProfessionalExecutionPlan, executionUnitId: string): boolean {
  const unit = sourcePlan.plannedUnits.find((u) => u.executionUnit.executionUnitId === executionUnitId);
  if (!unit) return false;
  const requiresProgression = unit.atomicActions.some((a) => a.iteration !== undefined);
  const coverage = scenePlan.coverage.find((c) => c.sourceExecutionUnitId === executionUnitId);
  if (!coverage) return false;
  if (!requiresProgression) return coverage.status === "FULLY_COVERED";

  const executionScene = scenePlan.scenes.find((s) => s.sourceExecutionUnitId === executionUnitId && s.phase === "EXECUTION");
  if (!executionScene) return false;
  const progressive = executionScene.progression?.kind === "SPATIAL_SUBSECTION_SEQUENCE" || executionScene.progression?.kind === "MIRRORED_BILATERAL";
  const boundedStop = executionScene.progression?.iteration !== undefined;
  return coverage.status === "FULLY_COVERED" && progressive && boundedStop;
}
