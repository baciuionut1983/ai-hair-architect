import { createHash } from "crypto";

import { isRecord } from "@/lib/technical-visual-map-validators";
import { SKILL_CAPABILITY_KINDS, type SkillCapabilityKind } from "@/lib/professional-skill-contracts";
import {
  isAtomicActionEvidenceStatus,
  isValidAtomicActionIteration,
  type AtomicActionEvidenceStatus,
  type AtomicActionIteration,
  type AtomicActionObservationCriterion,
  type AtomicActionStateTransition,
} from "@/lib/professional-skill-atomic-action-contracts";
import { isFramingSemantic, isViewpointFamily, type FramingSemantic, type ViewpointFamily } from "@/lib/professional-skill-viewpoint-constraint-contracts";

// AI Hair Architect, Professional Skill Engine Stage 7 -- TECHNICAL
// DEMONSTRATION SCENE COMPILER, contract/foundation layer. Types + pure
// structural validators, no I/O, no AI, no provider call. This is the
// grouping/splitting layer the Part A audit found MISSING: the Skill
// Engine already compiles one provider-independent VideoInstruction per
// AtomicAction (Stage 2.5.i.13/i.14), and one grouped ProviderAdapter
// request per Execution Unit (Stage 2.5.i.21) -- but nothing decides
// which contiguous run of atomic actions forms ONE coherent, demonstrable
// visual scene showing BEFORE -> ACTION -> PROGRESSION -> ITERATION ->
// COMPLETION -> RESULT -> VERIFICATION. Stage 7 adds exactly that, and
// nothing else.
//
// NAMING DECISION (deliberate, reported): the task's own descriptive
// phrase is "TechnicalDemonstrationScenePlan / TechnicalDemonstrationScene",
// but System A already ships a real, persisted, 40+-test
// `TechnicalDemonstrationPlan` / `TechnicalDemonstrationStep` rooted in an
// entirely different authority chain (AnalysisProposal -> TechnicalCutPlan).
// Reusing that near-identical identifier would create exactly the
// "TechnicalDemonstrationPlan would become a competing professional
// authority" confusion the task's own STOP conditions warn against. This
// stage's artifacts are named `ProfessionalExecutionScenePlan` /
// `ProfessionalExecutionScene` -- keeping the `professional-execution-*`
// naming family from Stage 6, making it structurally unambiguous that a
// Scene Plan derives ONLY from a `ProfessionalExecutionPlan` (System B:
// HairStateSnapshot -> HairStateDelta -> ProfessionalReasoningProposal ->
// ProfessionalExecutionPlan). Semantically it is exactly the "scene plan"
// the task describes.
//
// AUTHORITY IS ONE-WAY: ProfessionalExecutionPlan -> Scene Plan. A Scene
// Plan is a DERIVED VISUAL COMPILATION. It may split actions into scenes,
// group them, attach viewpoints/observables/verification/continuity, and
// set scene boundaries. It may NOT invent a skill, invent a parameter,
// reorder professional actions, change any professional value (elevation/
// guide/distribution/overdirection/angle/tool/zone/target effect), mark
// unresolved work solved, or drop a preservation constraint. Every
// professional fact a scene carries is a verbatim reference to, or a
// verbatim copy of, an already-approved value on the source plan/unit/
// action -- never a fresh decision.
//
// REUSE, NOT DUPLICATION: this file declares NO new viewpoint taxonomy
// (reuses ViewpointFamily/FramingSemantic verbatim), NO new verification-
// method vocabulary (reuses AtomicActionEvidenceStatus verbatim, including
// Stage 6's own DETERMINISTIC_STATE_CHECK / FUTURE_VISION_VERIFICATION
// additions), NO new iteration model (reuses AtomicActionIteration
// verbatim), NO new state-transition or observation-criterion shape
// (reuses AtomicActionStateTransition / AtomicActionObservationCriterion
// verbatim), and NO new capability vocabulary (reuses SkillCapabilityKind).
// A scene also references the EXISTING per-action
// DemonstrationRequirement / ViewpointConstraint / VideoInstruction ids by
// id only -- the Stage 2.5.i.10/i.12/i.13 derivers/compilers are reused
// entirely unchanged by professional-execution-scene-compiler.ts.

export const PROFESSIONAL_EXECUTION_SCENE_PLAN_SCHEMA_VERSION = "1.0.0-pes7";
export const PROFESSIONAL_EXECUTION_SCENE_COMPILER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Scene phase -- deterministic grouping of one Execution Unit's own atomic
// actions by AtomicActionKind (professional-skill-atomic-action-
// contracts.ts, unchanged): PREPARE/POSITION -> PREPARATION, CONTROL/
// EXECUTE -> EXECUTION, OBSERVE/VERIFY -> VERIFICATION. A phase boundary is
// the primary deterministic scene boundary (Part D).
// ---------------------------------------------------------------------------

export const SCENE_PHASES = ["PREPARATION", "EXECUTION", "VERIFICATION"] as const;
export type ScenePhase = (typeof SCENE_PHASES)[number];

export function isScenePhase(value: unknown): value is ScenePhase {
  return typeof value === "string" && (SCENE_PHASES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Progression kind -- how work advances within a scene. Closed, small.
// SINGLE_PASS: one bounded pass (e.g. establishing the guide, one
// verification look). SPATIAL_SUBSECTION_SEQUENCE: repeated advance across
// an ordered set of subsections through a bounded zone (Part F -- the
// "one cut is not a demonstration" case). MIRRORED_BILATERAL: the same
// bounded work performed on each side (Part D -- mirrored side change).
// ---------------------------------------------------------------------------

export const SCENE_PROGRESSION_KINDS = ["SINGLE_PASS", "SPATIAL_SUBSECTION_SEQUENCE", "MIRRORED_BILATERAL"] as const;
export type SceneProgressionKind = (typeof SCENE_PROGRESSION_KINDS)[number];

export function isSceneProgressionKind(value: unknown): value is SceneProgressionKind {
  return typeof value === "string" && (SCENE_PROGRESSION_KINDS as readonly string[]).includes(value);
}

export interface SceneProgression {
  kind: SceneProgressionKind;
  zoneId?: string;
  // Reused verbatim from the source atomic actions' own `iteration` --
  // never re-derived, never independently decided (Part F). Required
  // whenever kind is SPATIAL_SUBSECTION_SEQUENCE (a repeated progression
  // is meaningless without a bounded stop condition -- Part Q).
  iteration?: AtomicActionIteration;
}

function isValidSceneProgression(value: unknown): value is SceneProgression {
  if (!isRecord(value)) return false;
  if (!isSceneProgressionKind(value.kind)) return false;
  if (value.zoneId !== undefined && (typeof value.zoneId !== "string" || value.zoneId.length === 0)) return false;
  if (value.iteration !== undefined && !isValidAtomicActionIteration(value.iteration)) return false;
  // Part Q -- a repeated spatial progression MUST carry its bounded stop
  // condition; a scene that claims progression across subsections but has
  // no iteration is exactly the original "one cut" failure.
  if (value.kind === "SPATIAL_SUBSECTION_SEQUENCE" && value.iteration === undefined) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Required medium (Part T/U) -- planning metadata only, never rendered
// here. Derived conservatively from demonstration semantics: a scene is
// MOTION_REQUIRED unless it is provably a static/overlay concept.
// ---------------------------------------------------------------------------

export const SCENE_MEDIA = ["MOTION_REQUIRED", "STATIC_OK", "OVERLAY_REQUIRED", "COMPOSITE"] as const;
export type SceneMedium = (typeof SCENE_MEDIA)[number];

export function isSceneMedium(value: unknown): value is SceneMedium {
  return typeof value === "string" && (SCENE_MEDIA as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Continuity facts (Part H) -- what must remain visually stable between
// scenes. Closed, small; each maps to a real Stage 6 concept.
// ---------------------------------------------------------------------------

export const SCENE_CONTINUITY_FACTS = [
  "SAME_CLIENT_AND_HEAD",
  "SAME_WET_DRY_STATE",
  "SAME_ESTABLISHED_GUIDE",
  "SAME_COMPLETED_PRIOR_ZONES",
  "SAME_PRESERVED_REGIONS",
  "SAME_TOOL",
] as const;
export type SceneContinuityFact = (typeof SCENE_CONTINUITY_FACTS)[number];

export function isSceneContinuityFact(value: unknown): value is SceneContinuityFact {
  return typeof value === "string" && (SCENE_CONTINUITY_FACTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Demonstration-requirement kind (Part K) -- reuses repository-style
// MUST_* naming. Distinct from the Stage 2.5.i.10 `DemonstrationRequirement`
// (which is a per-action VISIBILITY fact with a category+value); this is a
// scene-level REQUIREMENT FLAG about how the eventual video must behave.
// ---------------------------------------------------------------------------

export const SCENE_DEMONSTRATION_REQUIREMENT_KINDS = [
  "MUST_SHOW",
  "MUST_PRESERVE",
  "MUST_NOT_CHANGE",
  "REQUIRES_CONTINUOUS_PROGRESS",
  "REQUIRES_COMPLETION_VISIBLE",
  "REQUIRES_VERIFICATION_VIEW",
  "REQUIRES_BEFORE_AFTER",
  "REQUIRES_CLOSEUP",
] as const;
export type SceneDemonstrationRequirementKind = (typeof SCENE_DEMONSTRATION_REQUIREMENT_KINDS)[number];

export function isSceneDemonstrationRequirementKind(value: unknown): value is SceneDemonstrationRequirementKind {
  return typeof value === "string" && (SCENE_DEMONSTRATION_REQUIREMENT_KINDS as readonly string[]).includes(value);
}

export interface SceneDemonstrationRequirement {
  kind: SceneDemonstrationRequirementKind;
  // Free reference target -- a scope/field pair, a parameter name, or a
  // zone id. Never a professional VALUE decision (those live on the source
  // plan). Present for MUST_SHOW/MUST_PRESERVE/MUST_NOT_CHANGE.
  subject?: string;
}

function isValidSceneDemonstrationRequirement(value: unknown): value is SceneDemonstrationRequirement {
  if (!isRecord(value)) return false;
  if (!isSceneDemonstrationRequirementKind(value.kind)) return false;
  if (value.subject !== undefined && (typeof value.subject !== "string" || value.subject.length === 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Observable (Part J) -- WHAT the eventual visual output must expose for
// verification. Each references an already-derived per-action
// DemonstrationRequirement id (Stage 2.5.i.10) plus a small closed
// "aspect" describing what about it must be visible.
// ---------------------------------------------------------------------------

export const SCENE_OBSERVABLE_ASPECTS = [
  "GUIDE_LINE_VISIBLE",
  "CUTTING_LINE_VISIBLE",
  "ELEVATION_RELATION_VISIBLE",
  "TOOL_TO_SUBJECT_RELATION_VISIBLE",
  "SUBSECTION_PROGRESSION_VISIBLE",
  "ZONE_COMPLETION_VISIBLE",
  "PRESERVED_REGION_VISIBLE",
  "ZONE_CONNECTION_VISIBLE",
  "SUBJECT_CONDITION_VISIBLE",
  "ANATOMICAL_CONTEXT_VISIBLE",
] as const;
export type SceneObservableAspect = (typeof SCENE_OBSERVABLE_ASPECTS)[number];

export function isSceneObservableAspect(value: unknown): value is SceneObservableAspect {
  return typeof value === "string" && (SCENE_OBSERVABLE_ASPECTS as readonly string[]).includes(value);
}

export interface SceneObservable {
  aspect: SceneObservableAspect;
  // At least one already-derived per-action DemonstrationRequirement id
  // this observable maps back to (Stage 2.5.i.10 output) -- or, for a
  // completion/preservation observable that has no single per-action
  // requirement, the source ExecutionUnit id.
  sourceRequirementIds: readonly string[];
}

function isValidSceneObservable(value: unknown): value is SceneObservable {
  if (!isRecord(value)) return false;
  if (!isSceneObservableAspect(value.aspect)) return false;
  if (!Array.isArray(value.sourceRequirementIds) || value.sourceRequirementIds.length === 0) return false;
  if (!value.sourceRequirementIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Viewpoint (Part I) -- reuses ViewpointFamily / FramingSemantic verbatim;
// NEVER a second taxonomy. `status` NEEDS_INPUT is the explicit
// fail-closed outcome when a viewpoint cannot be safely determined.
// ---------------------------------------------------------------------------

export const SCENE_VIEWPOINT_STATUSES = ["RESOLVED", "NEEDS_INPUT"] as const;
export type SceneViewpointStatus = (typeof SCENE_VIEWPOINT_STATUSES)[number];

export interface SceneViewpoint {
  status: SceneViewpointStatus;
  family?: ViewpointFamily;
  framingSemantics: readonly FramingSemantic[];
  sourceViewpointConstraintIds: readonly string[];
}

function isValidSceneViewpoint(value: unknown): value is SceneViewpoint {
  if (!isRecord(value)) return false;
  if (value.status !== "RESOLVED" && value.status !== "NEEDS_INPUT") return false;
  if (!Array.isArray(value.framingSemantics) || !value.framingSemantics.every(isFramingSemantic)) return false;
  if (!Array.isArray(value.sourceViewpointConstraintIds) || !value.sourceViewpointConstraintIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (value.status === "RESOLVED") {
    if (!isViewpointFamily(value.family)) return false;
    if (value.framingSemantics.length === 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Verification contract (Part L) -- reuses AtomicActionEvidenceStatus
// verbatim as the "how will this eventually be checked" mode, and the
// AtomicActionObservationCriterion shape verbatim as the pass/fail
// contract. Vision is NEVER called in Stage 7 -- FUTURE_VISION_VERIFICATION
// only models the contract.
// ---------------------------------------------------------------------------

export interface SceneVerification {
  mode: AtomicActionEvidenceStatus;
  criterion: AtomicActionObservationCriterion;
}

function isValidObservationCriterionShape(value: unknown): value is AtomicActionObservationCriterion {
  if (!isRecord(value)) return false;
  if (typeof value.fact !== "string" || value.fact.length === 0) return false;
  const v = value.expectedValue;
  if (!("expectedValue" in value) || (typeof v !== "string" && typeof v !== "boolean" && typeof v !== "number")) return false;
  return isAtomicActionEvidenceStatus(value.evidenceStatus);
}

function isValidSceneVerification(value: unknown): value is SceneVerification {
  if (!isRecord(value)) return false;
  if (!isAtomicActionEvidenceStatus(value.mode)) return false;
  return isValidObservationCriterionShape(value.criterion);
}

// ---------------------------------------------------------------------------
// Before / after state contract (Part G/H).
// ---------------------------------------------------------------------------

export interface SceneBeforeContract {
  // Continuity dependency -- scene ids (within the same plan) that MUST be
  // demonstrated before this scene. Part N check 8/29/30.
  requiresPriorSceneIds: readonly string[];
  // What must already be visibly true when this scene begins -- reuses the
  // AtomicActionObservationCriterion shape verbatim.
  requiredPriorState: readonly AtomicActionObservationCriterion[];
}

export interface SceneExpectedVisibleEffect {
  // Reused verbatim from EXECUTE-kind source atomic actions' own
  // `stateTransition` -- never a fresh claim.
  stateTransitions: readonly AtomicActionStateTransition[];
  // Carried VERBATIM from the source ProfessionalExecutionPlan's own
  // preservationConstraints -- MUST survive scene compilation (Part N
  // check 13/32/33).
  preservedConstraints: readonly { scope: string; field: string; value: string }[];
}

export interface SceneContinuity {
  mustRemainStable: readonly SceneContinuityFact[];
  // The output state this scene hands to the next -- reuses the
  // AtomicActionObservationCriterion shape verbatim (Part N check 24/27).
  carriesForward: readonly AtomicActionObservationCriterion[];
}

function isValidBeforeContract(value: unknown): value is SceneBeforeContract {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.requiresPriorSceneIds) || !value.requiresPriorSceneIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (!Array.isArray(value.requiredPriorState) || !value.requiredPriorState.every(isValidObservationCriterionShape)) return false;
  return true;
}

function isValidExpectedVisibleEffect(value: unknown): value is SceneExpectedVisibleEffect {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.stateTransitions)) return false;
  if (
    !value.stateTransitions.every((t) => {
      if (!isRecord(t) || typeof t.fact !== "string" || t.fact.length === 0) return false;
      const to = t.toValue;
      return typeof to === "string" || typeof to === "boolean" || typeof to === "number";
    })
  ) {
    return false;
  }
  if (!Array.isArray(value.preservedConstraints)) return false;
  if (!value.preservedConstraints.every((c) => isRecord(c) && typeof c.scope === "string" && typeof c.field === "string" && typeof c.value === "string")) return false;
  return true;
}

function isValidContinuity(value: unknown): value is SceneContinuity {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.mustRemainStable) || !value.mustRemainStable.every(isSceneContinuityFact)) return false;
  if (!Array.isArray(value.carriesForward) || !value.carriesForward.every(isValidObservationCriterionShape)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The scene itself.
// ---------------------------------------------------------------------------

export interface ProfessionalExecutionScene {
  sceneId: string;
  order: number;
  phase: ScenePhase;

  // IDENTITY -- traceable to exact source (Part C, Part N checks 3/4/5).
  sourceExecutionUnitId: string;
  sourceAtomicActionIds: readonly string[];
  sourceVideoInstructionIds: readonly string[];

  // PURPOSE -- structured, never prose authority (Part C).
  demonstratesCapability: SkillCapabilityKind;
  contributesToDelta: { scope: string; field: string };

  beforeContract: SceneBeforeContract;

  // PROGRESSION -- present, OR an explicit not-applicable reason (Part N
  // check 16).
  progression?: SceneProgression;
  progressionNotApplicableReason?: string;

  completionCriterion: AtomicActionObservationCriterion;
  expectedVisibleEffect: SceneExpectedVisibleEffect;
  observables: readonly SceneObservable[];
  verification: SceneVerification;
  viewpoint: SceneViewpoint;
  continuity: SceneContinuity;
  demonstrationRequirements: readonly SceneDemonstrationRequirement[];
  requiredMedium: SceneMedium;

  // Deterministic identity of this scene's own semantic inputs (Part S).
  sceneFingerprint: string;
}

export function isValidProfessionalExecutionScene(value: unknown): value is ProfessionalExecutionScene {
  if (!isRecord(value)) return false;
  if (typeof value.sceneId !== "string" || value.sceneId.length === 0) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;
  if (!isScenePhase(value.phase)) return false;

  if (typeof value.sourceExecutionUnitId !== "string" || value.sourceExecutionUnitId.length === 0) return false;
  if (!Array.isArray(value.sourceAtomicActionIds) || value.sourceAtomicActionIds.length === 0) return false;
  if (!value.sourceAtomicActionIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (!Array.isArray(value.sourceVideoInstructionIds) || !value.sourceVideoInstructionIds.every((id) => typeof id === "string" && id.length > 0)) return false;

  if (!(SKILL_CAPABILITY_KINDS as readonly string[]).includes(value.demonstratesCapability as string)) return false;
  if (!isRecord(value.contributesToDelta) || typeof value.contributesToDelta.scope !== "string" || typeof value.contributesToDelta.field !== "string") return false;

  if (!isValidBeforeContract(value.beforeContract)) return false;

  if (value.progression !== undefined && !isValidSceneProgression(value.progression)) return false;
  if (value.progressionNotApplicableReason !== undefined && (typeof value.progressionNotApplicableReason !== "string" || value.progressionNotApplicableReason.trim().length === 0)) {
    return false;
  }
  // Part N check 16 -- exactly one of the two must be present.
  if ((value.progression === undefined) === (value.progressionNotApplicableReason === undefined)) return false;

  if (!isValidObservationCriterionShape(value.completionCriterion)) return false;
  if (!isValidExpectedVisibleEffect(value.expectedVisibleEffect)) return false;

  if (!Array.isArray(value.observables) || value.observables.length === 0 || !value.observables.every(isValidSceneObservable)) return false;
  if (!isValidSceneVerification(value.verification)) return false;
  if (!isValidSceneViewpoint(value.viewpoint)) return false;
  if (!isValidContinuity(value.continuity)) return false;

  if (!Array.isArray(value.demonstrationRequirements) || value.demonstrationRequirements.length === 0) return false;
  if (!value.demonstrationRequirements.every(isValidSceneDemonstrationRequirement)) return false;

  if (!isSceneMedium(value.requiredMedium)) return false;
  if (typeof value.sceneFingerprint !== "string" || value.sceneFingerprint.length !== 64) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Coverage (Part O) -- one entry per source Execution Unit.
// ---------------------------------------------------------------------------

export const SCENE_COVERAGE_STATUSES = ["FULLY_COVERED", "PARTIALLY_COVERED", "NOT_DEMONSTRABLE", "NEEDS_INPUT", "UNRESOLVED"] as const;
export type SceneCoverageStatus = (typeof SCENE_COVERAGE_STATUSES)[number];

export function isSceneCoverageStatus(value: unknown): value is SceneCoverageStatus {
  return typeof value === "string" && (SCENE_COVERAGE_STATUSES as readonly string[]).includes(value);
}

export interface SceneCoverageEntry {
  sourceExecutionUnitId: string;
  status: SceneCoverageStatus;
  sceneIds: readonly string[];
  note?: string;
}

function isValidSceneCoverageEntry(value: unknown): value is SceneCoverageEntry {
  if (!isRecord(value)) return false;
  if (typeof value.sourceExecutionUnitId !== "string" || value.sourceExecutionUnitId.length === 0) return false;
  if (!isSceneCoverageStatus(value.status)) return false;
  if (!Array.isArray(value.sceneIds) || !value.sceneIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (value.note !== undefined && (typeof value.note !== "string" || value.note.length === 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Failure reasons (Part X) -- closed, specific, never a generic "invalid
// scene".
// ---------------------------------------------------------------------------

export const SCENE_PLAN_FAILURE_REASONS = [
  "MISSING_SOURCE_EXECUTION_UNIT",
  "MISSING_SOURCE_ACTION",
  "MISSING_VIEWPOINT",
  "MISSING_OBSERVABLE",
  "MISSING_COMPLETION_REQUIREMENT",
  "MISSING_EXPECTED_EFFECT",
  "MISSING_VERIFICATION_REQUIREMENT",
  "ITERATION_COLLAPSED",
  "PROGRESSION_NOT_COVERED",
  "DEPENDENCY_ORDER_VIOLATION",
  "STATE_CONTINUITY_MISMATCH",
  "PRESERVATION_CONSTRAINT_LOST",
  "UNSUPPORTED_DELTA_SCENE",
  "NEEDS_PROFESSIONAL_INPUT",
  "SCENE_TOO_BROAD",
  "SCENE_NOT_SEMANTICALLY_COMPLETE",
  "PROFESSIONAL_SOURCE_ALTERED",
  "SKILL_ORDER_ALTERED",
  "EXECUTION_UNIT_OMITTED",
  "SCENE_PLAN_NOT_BOUND_TO_EXACT_PLAN_VERSION",
] as const;
export type ScenePlanFailureReason = (typeof SCENE_PLAN_FAILURE_REASONS)[number];

export function isScenePlanFailureReason(value: unknown): value is ScenePlanFailureReason {
  return typeof value === "string" && (SCENE_PLAN_FAILURE_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The scene plan.
// ---------------------------------------------------------------------------

export const PROFESSIONAL_EXECUTION_SCENE_PLAN_STATUSES = ["DRAFT", "CONFIRMED", "SUPERSEDED"] as const;
export type ProfessionalExecutionScenePlanStatus = (typeof PROFESSIONAL_EXECUTION_SCENE_PLAN_STATUSES)[number];

export function isProfessionalExecutionScenePlanStatus(value: unknown): value is ProfessionalExecutionScenePlanStatus {
  return typeof value === "string" && (PROFESSIONAL_EXECUTION_SCENE_PLAN_STATUSES as readonly string[]).includes(value);
}

export const PROFESSIONAL_EXECUTION_SCENE_PLAN_READINESS_STATES = ["READY_FOR_PROFESSIONAL_REVIEW", "PARTIAL", "NEEDS_INPUT", "BLOCKED"] as const;
export type ProfessionalExecutionScenePlanReadiness = (typeof PROFESSIONAL_EXECUTION_SCENE_PLAN_READINESS_STATES)[number];

export function isProfessionalExecutionScenePlanReadiness(value: unknown): value is ProfessionalExecutionScenePlanReadiness {
  return typeof value === "string" && (PROFESSIONAL_EXECUTION_SCENE_PLAN_READINESS_STATES as readonly string[]).includes(value);
}

export interface ProfessionalExecutionScenePlan {
  schemaVersion: string;
  compilerVersion: string;
  // Exact binding to the source (Part B / Part N checks 1/2). A scene plan
  // compiled from ExecutionPlan V1 never silently starts using V2.
  sourceExecutionPlanId: string;
  sourceExecutionPlanFingerprint: string;
  sourceReasoningProposalId: string;
  // Carried through for full traceability (Part B).
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;

  scenes: readonly ProfessionalExecutionScene[];
  coverage: readonly SceneCoverageEntry[];
  // Carried VERBATIM from the source plan -- never re-derived, never
  // dropped (Part N check 13/26).
  preservationConstraints: readonly { scope: string; field: string; value: string; description: string }[];
  unresolvedRequirements: readonly { scope: string; field: string; reason: string }[];

  readiness: ProfessionalExecutionScenePlanReadiness;
  scenePlanFingerprint: string;
}

export function isValidProfessionalExecutionScenePlan(value: unknown): value is ProfessionalExecutionScenePlan {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.length === 0) return false;
  if (typeof value.compilerVersion !== "string" || value.compilerVersion.length === 0) return false;
  if (typeof value.sourceExecutionPlanId !== "string" || value.sourceExecutionPlanId.length === 0) return false;
  if (typeof value.sourceExecutionPlanFingerprint !== "string" || value.sourceExecutionPlanFingerprint.length === 0) return false;
  if (typeof value.sourceReasoningProposalId !== "string" || value.sourceReasoningProposalId.length === 0) return false;
  if (typeof value.currentSnapshotId !== "string" || value.currentSnapshotId.length === 0) return false;
  if (typeof value.currentSnapshotVersion !== "number" || !Number.isInteger(value.currentSnapshotVersion) || value.currentSnapshotVersion < 1) return false;
  if (typeof value.targetSnapshotId !== "string" || value.targetSnapshotId.length === 0) return false;
  if (typeof value.targetSnapshotVersion !== "number" || !Number.isInteger(value.targetSnapshotVersion) || value.targetSnapshotVersion < 1) return false;

  if (!Array.isArray(value.scenes) || !value.scenes.every(isValidProfessionalExecutionScene)) return false;
  // Contiguous 1..N ordering + unique scene ids.
  const ids = (value.scenes as ProfessionalExecutionScene[]).map((s) => s.sceneId);
  if (new Set(ids).size !== ids.length) return false;
  const orders = (value.scenes as ProfessionalExecutionScene[]).map((s) => s.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i += 1) if (orders[i] !== i + 1) return false;

  if (!Array.isArray(value.coverage) || value.coverage.length === 0 || !value.coverage.every(isValidSceneCoverageEntry)) return false;

  if (!Array.isArray(value.preservationConstraints)) return false;
  if (
    !value.preservationConstraints.every(
      (c) => isRecord(c) && typeof c.scope === "string" && typeof c.field === "string" && typeof c.value === "string" && typeof c.description === "string",
    )
  ) {
    return false;
  }
  if (!Array.isArray(value.unresolvedRequirements)) return false;
  if (!value.unresolvedRequirements.every((r) => isRecord(r) && typeof r.scope === "string" && typeof r.field === "string" && typeof r.reason === "string")) return false;

  if (!isProfessionalExecutionScenePlanReadiness(value.readiness)) return false;
  if (typeof value.scenePlanFingerprint !== "string" || value.scenePlanFingerprint.length !== 64) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Deterministic fingerprints (Part S). Include only the SEMANTIC inputs
// actually relevant to the scene -- a change to one scene's own semantic
// source changes that scene's fingerprint, while an unrelated scene stays
// stable.
// ---------------------------------------------------------------------------

export function computeSceneFingerprint(input: {
  sourceExecutionPlanId: string;
  sourceExecutionUnitId: string;
  phase: ScenePhase;
  sourceAtomicActionIds: readonly string[];
  demonstratesCapability: string;
  contributesToDelta: { scope: string; field: string };
  progression: SceneProgression | undefined;
  completionCriterion: AtomicActionObservationCriterion;
  observableAspects: readonly string[];
  viewpointFamily: string | undefined;
  framingSemantics: readonly string[];
  preservedConstraints: readonly { scope: string; field: string; value: string }[];
  compilerVersion: string;
}): string {
  const canonical = JSON.stringify({
    p: input.sourceExecutionPlanId,
    u: input.sourceExecutionUnitId,
    ph: input.phase,
    a: [...input.sourceAtomicActionIds].sort(),
    cap: input.demonstratesCapability,
    d: input.contributesToDelta,
    prog: input.progression ? { k: input.progression.kind, z: input.progression.zoneId ?? null, it: input.progression.iteration ?? null } : null,
    comp: input.completionCriterion,
    obs: [...input.observableAspects].sort(),
    vf: input.viewpointFamily ?? null,
    fs: [...input.framingSemantics].sort(),
    pres: [...input.preservedConstraints].map((c) => `${c.scope}:${c.field}:${c.value}`).sort(),
    cv: input.compilerVersion,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function computeScenePlanFingerprint(input: {
  sourceExecutionPlanId: string;
  sourceExecutionPlanFingerprint: string;
  compilerVersion: string;
  schemaVersion: string;
  sceneFingerprints: readonly string[];
}): string {
  const canonical = JSON.stringify({
    p: input.sourceExecutionPlanId,
    pf: input.sourceExecutionPlanFingerprint,
    cv: input.compilerVersion,
    sv: input.schemaVersion,
    s: [...input.sceneFingerprints],
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type { AtomicActionObservationCriterion, AtomicActionStateTransition, AtomicActionIteration };
