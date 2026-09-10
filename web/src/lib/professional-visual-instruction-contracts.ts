import { createHash } from "crypto";

import { isRecord } from "@/lib/technical-visual-map-validators";
import { SKILL_CAPABILITY_KINDS, type SkillCapabilityKind } from "@/lib/professional-skill-contracts";
import {
  isAtomicActionEvidenceStatus,
  type AtomicActionEvidenceStatus,
  type AtomicActionObservationCriterion,
} from "@/lib/professional-skill-atomic-action-contracts";
import { HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS, HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES, type HairStateSnapshotEvidenceKind, type HairStateSnapshotEvidenceRole } from "@/lib/hair-state-snapshot-evidence-validators";
import {
  SCENE_MEDIA,
  isSceneMedium,
  isValidProfessionalExecutionScene as _sceneGuard,
  type ProfessionalExecutionScene,
  type SceneContinuity,
  type SceneMedium,
  type SceneObservable,
  type SceneProgression,
  type SceneViewpoint,
} from "@/lib/professional-execution-scene-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8 -- PROVIDER-
// INDEPENDENT VISUAL INSTRUCTION COMPILER + RENDER READINESS GATE,
// contract/foundation layer. Types + pure structural validators, no I/O,
// no AI, no provider call. Transforms one Stage 7
// ProfessionalExecutionScene into a complete, provider-independent
// VisualInstructionPackage that a future video provider can RENDER
// without inventing haircut technique, geometry, sectioning, guide logic,
// progression, iteration, completion, verification, protected areas,
// camera intent, or continuity.
//
// AUTHORITY IS ONE-WAY (Part B):
//   HairStateSnapshot -> ProfessionalExecutionPlan ->
//   ProfessionalExecutionScenePlan -> VisualInstructionPackage ->
//   ProviderInstruction -> RenderAttempt
// Every professional fact a package carries is a verbatim reference to,
// or verbatim copy of, an already-approved value upstream. This layer
// NEVER mutates snapshots/deltas/skill/version/parameters/order/
// iteration/completion/expected-effect/preservation/unresolved-work. If
// professional information is missing, the RenderReadinessGate returns
// NOT_READY / NEEDS_PROFESSIONAL_INPUT with explicit reasons -- it never
// invents.
//
// A GOOD PROMPT IS NOT THE SOURCE OF TRUTH (Part "third core rule"): this
// package is DERIVED; a provider-specific prompt/request is derived AGAIN
// from it by a future serializer. There is no free-text field anywhere in
// this shape capable of carrying a giant hand-written prompt.
//
// REUSE, NOT DUPLICATION: this file reuses -- verbatim, by import --
// Stage 7's SceneProgression / SceneViewpoint / SceneContinuity /
// SceneObservable / SceneMedium, Stage 6/2.5.i.4's
// AtomicActionObservationCriterion / AtomicActionEvidenceStatus,
// SkillCapabilityKind, and Stage 3's HairStateSnapshotEvidenceKind /
// HairStateSnapshotEvidenceRole. It declares NO second viewpoint
// taxonomy, NO second medium vocabulary, NO parallel image store (visual
// evidence is referenced by id only).
//
// NOT PERSISTED (deliberate, reported): like VideoInstruction (Stage
// 2.5.i.13) and ProviderAdapterTranslationOutput (Stage 2.5.i.21), a
// VisualInstructionPackage is a pure deterministic compile of an
// already-persisted, already-approvable Stage 6/7 artifact -- it carries
// no professional decision of its own (approval happens at the scene-plan
// level) and is fully reproducible from the persisted rows. No Prisma
// model, no migration. A future sealed render request stores the
// package's fingerprint + the package inline in the render row.

export const VISUAL_INSTRUCTION_PACKAGE_SCHEMA_VERSION = "1.0.0-vip8";
export const VISUAL_INSTRUCTION_COMPILER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Part D -- visual subject elements. Closed. Only elements actually
// supported by upstream state/plan are ever compiled in.
// ---------------------------------------------------------------------------

export const VISUAL_SUBJECT_ELEMENTS = [
  "CLIENT_HEAD",
  "HAIR_REGION",
  "SECTION",
  "SUBSECTION",
  "ESTABLISHED_GUIDE",
  "COMPLETED_PRIOR_REGION",
  "PROTECTED_REGION",
  "HANDS",
  "FINGERS",
  "COMB",
  "SHEARS",
  "CLIPPER",
] as const;
export type VisualSubjectElement = (typeof VISUAL_SUBJECT_ELEMENTS)[number];

export function isVisualSubjectElement(value: unknown): value is VisualSubjectElement {
  return typeof value === "string" && (VISUAL_SUBJECT_ELEMENTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Part G -- hand / tool / hair geometric relationships. Never fabricates
// handedness; only the professional/geometric relationship.
// ---------------------------------------------------------------------------

export const HAND_TOOL_RELATIONSHIP_KINDS = [
  "CONTROL_HELD_WITH_COMB",
  "CONTROL_HELD_WITH_FINGERS",
  "STRAND_HELD_AT_DECLARED_ELEVATION",
  "STRAND_IN_DECLARED_DISTRIBUTION",
  "TOOL_ALIGNED_TO_CUTTING_LINE",
  "TOOL_IN_DECLARED_ORIENTATION",
  "TOOL_REFERENCES_PREVIOUS_GUIDE",
  "SUBSECTION_REFERENCES_PRECEDING_SUBSECTION",
  "HEAD_IN_DECLARED_POSITION",
] as const;
export type HandToolRelationshipKind = (typeof HAND_TOOL_RELATIONSHIP_KINDS)[number];

export function isHandToolRelationshipKind(value: unknown): value is HandToolRelationshipKind {
  return typeof value === "string" && (HAND_TOOL_RELATIONSHIP_KINDS as readonly string[]).includes(value);
}

export interface HandToolRelationship {
  kind: HandToolRelationshipKind;
  // The upstream professional parameter name(s) that justify this
  // relationship -- traceability, never a re-declared value.
  sourceParameterNames: readonly string[];
}

function isValidHandToolRelationship(value: unknown): value is HandToolRelationship {
  if (!isRecord(value)) return false;
  if (!isHandToolRelationshipKind(value.kind)) return false;
  if (!Array.isArray(value.sourceParameterNames) || value.sourceParameterNames.length === 0) return false;
  return value.sourceParameterNames.every((n) => typeof n === "string" && n.length > 0);
}

// ---------------------------------------------------------------------------
// Part L -- forbidden professional deviations. Closed, derived from
// authoritative semantics (preservation constraints + declared capability
// + declared parameters), never invented.
// ---------------------------------------------------------------------------

export const FORBIDDEN_DEVIATION_KINDS = [
  "INVENT_EXTRA_CUT",
  "INVENT_EXTRA_SECTIONING",
  "JUMP_TO_ANOTHER_ZONE",
  "ALTER_GUIDE_GEOMETRY",
  "ALTER_DECLARED_ELEVATION",
  "CHANGE_CUTTING_LINE",
  "CHANGE_TOOL",
  "CHANGE_WET_DRY_STATE",
  "REMOVE_COMPLETED_WORK",
  "JUMP_UNFINISHED_TO_FINISHED_ZONE",
  "CHANGE_PROTECTED_LENGTH",
  "INTRODUCE_UNDECLARED_TECHNIQUE_OR_TEMPLATE",
  "CHANGE_SECTIONING_UNEXPECTEDLY",
  "NARRATE_INSTEAD_OF_SHOWING",
  "CHANGE_CLIENT_IDENTITY_OR_ENVIRONMENT",
] as const;
export type ForbiddenDeviationKind = (typeof FORBIDDEN_DEVIATION_KINDS)[number];

export function isForbiddenDeviationKind(value: unknown): value is ForbiddenDeviationKind {
  return typeof value === "string" && (FORBIDDEN_DEVIATION_KINDS as readonly string[]).includes(value);
}

export interface ForbiddenDeviation {
  kind: ForbiddenDeviationKind;
  // Optional pointer to what this restriction protects (a scope/field, a
  // parameter name, a zone id) -- never a professional VALUE decision.
  subject?: string;
}

function isValidForbiddenDeviation(value: unknown): value is ForbiddenDeviation {
  if (!isRecord(value)) return false;
  if (!isForbiddenDeviationKind(value.kind)) return false;
  if (value.subject !== undefined && (typeof value.subject !== "string" || value.subject.length === 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Part M/N -- technical camera constraints. Professional observability
// over aesthetics. Small, closed; never a cinematic style spec.
// ---------------------------------------------------------------------------

export const CAMERA_CONSTRAINT_KINDS = [
  "HANDS_MUST_REMAIN_VISIBLE",
  "TOOL_MUST_REMAIN_VISIBLE",
  "GUIDE_MUST_REMAIN_VISIBLE",
  "CUTTING_LINE_MUST_REMAIN_VISIBLE",
  "WORKED_ZONE_MUST_REMAIN_IN_FRAME",
  "BEFORE_AFTER_RELATION_MUST_BE_VISIBLE",
  "NO_RAPID_CUTS_OR_MONTAGE",
  "NO_CAMERA_SHAKE",
  "NO_SHALLOW_FOCUS_HIDING_TECHNIQUE",
  "NO_ORBIT_OR_DRAMATIC_MOVE_DURING_TECHNIQUE",
] as const;
export type CameraConstraintKind = (typeof CAMERA_CONSTRAINT_KINDS)[number];

export function isCameraConstraintKind(value: unknown): value is CameraConstraintKind {
  return typeof value === "string" && (CAMERA_CONSTRAINT_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Part U -- overlay contract. NOT rendered here; only what a later
// compositor would need.
// ---------------------------------------------------------------------------

export const OVERLAY_ELEMENT_KINDS = [
  "ZONE_HIGHLIGHT",
  "SECTION_LINE",
  "GUIDE_LINE",
  "DIRECTION_ARROW",
  "ELEVATION_INDICATOR",
  "CUTTING_LINE_INDICATOR",
  "PROGRESSION_DIRECTION",
  "PROTECTED_AREA",
] as const;
export type OverlayElementKind = (typeof OVERLAY_ELEMENT_KINDS)[number];

export function isOverlayElementKind(value: unknown): value is OverlayElementKind {
  return typeof value === "string" && (OVERLAY_ELEMENT_KINDS as readonly string[]).includes(value);
}

export interface OverlayElement {
  kind: OverlayElementKind;
  subject?: string;
}

function isValidOverlayElement(value: unknown): value is OverlayElement {
  if (!isRecord(value)) return false;
  if (!isOverlayElementKind(value.kind)) return false;
  if (value.subject !== undefined && (typeof value.subject !== "string" || value.subject.length === 0)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Part V -- provider-independent abstract render scope. NOT a Veo clip
// length. Actual duration mapping belongs in a provider adapter config.
// ---------------------------------------------------------------------------

export const VISUAL_INSTRUCTION_RENDER_SCOPES = ["SHORT_SINGLE_ACTION", "BOUNDED_PROGRESSIVE_ACTION", "MULTI_STEP_PROGRESSIVE_ACTION", "VERIFICATION_ONLY"] as const;
export type VisualInstructionRenderScope = (typeof VISUAL_INSTRUCTION_RENDER_SCOPES)[number];

export function isVisualInstructionRenderScope(value: unknown): value is VisualInstructionRenderScope {
  return typeof value === "string" && (VISUAL_INSTRUCTION_RENDER_SCOPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Part P -- structured verification contract. No Vision call.
// ---------------------------------------------------------------------------

export const VERIFICATION_QUESTION_KINDS = [
  "INTENDED_PROFESSIONAL_ACTION_VISIBLE",
  "PROGRESSION_SHOWN",
  "ITERATION_REPRESENTED",
  "GUIDE_VISIBLE",
  "COMPLETION_CONDITION_REACHED",
  "EXPECTED_EFFECT_VISIBLE",
  "PRESERVATION_CONSTRAINTS_RESPECTED",
  "NO_UNDECLARED_CHANGES_INTRODUCED",
  "CAMERA_SUFFICIENT_TO_INSPECT_TECHNIQUE",
] as const;
export type VerificationQuestionKind = (typeof VERIFICATION_QUESTION_KINDS)[number];

export function isVerificationQuestionKind(value: unknown): value is VerificationQuestionKind {
  return typeof value === "string" && (VERIFICATION_QUESTION_KINDS as readonly string[]).includes(value);
}

export const VERIFICATION_FAIL_DISPOSITIONS = ["FAIL", "NEEDS_PROFESSIONAL_REVIEW"] as const;
export type VerificationFailDisposition = (typeof VERIFICATION_FAIL_DISPOSITIONS)[number];

export interface VisualVerificationQuestion {
  question: VerificationQuestionKind;
  // Every question's PASS condition is "answered yes". This records what a
  // "no" answer implies for the render outcome.
  failDisposition: VerificationFailDisposition;
}

function isValidVisualVerificationQuestion(value: unknown): value is VisualVerificationQuestion {
  if (!isRecord(value)) return false;
  if (!isVerificationQuestionKind(value.question)) return false;
  return value.failDisposition === "FAIL" || value.failDisposition === "NEEDS_PROFESSIONAL_REVIEW";
}

export interface VisualVerificationContract {
  // Reused verbatim from Stage 6/7 -- DETERMINISTIC_STATE_CHECK /
  // RUNTIME_PROFESSIONAL_OBSERVATION / FUTURE_VISION_VERIFICATION /
  // DEMONSTRATED_TARGET. FUTURE_VISION_VERIFICATION only models the
  // contract; Vision is never called in Stage 8.
  mode: AtomicActionEvidenceStatus;
  questions: readonly VisualVerificationQuestion[];
  criterion: AtomicActionObservationCriterion;
}

function isValidObservationCriterionShape(value: unknown): value is AtomicActionObservationCriterion {
  if (!isRecord(value)) return false;
  if (typeof value.fact !== "string" || value.fact.length === 0) return false;
  const v = value.expectedValue;
  if (!("expectedValue" in value) || (typeof v !== "string" && typeof v !== "boolean" && typeof v !== "number")) return false;
  return isAtomicActionEvidenceStatus(value.evidenceStatus);
}

function isValidVisualVerificationContract(value: unknown): value is VisualVerificationContract {
  if (!isRecord(value)) return false;
  if (!isAtomicActionEvidenceStatus(value.mode)) return false;
  if (!Array.isArray(value.questions) || value.questions.length === 0 || !value.questions.every(isValidVisualVerificationQuestion)) return false;
  return isValidObservationCriterionShape(value.criterion);
}

// ---------------------------------------------------------------------------
// Part R/S -- source visual evidence reference. BY ID ONLY. Never bytes,
// never a parallel store. Reuses Stage 3's own evidence vocabulary.
// TARGET_REFERENCE is visual evidence, NEVER professional authority (Part
// S) -- the readiness gate requires a PRIMARY_CAPTURE when evidence is
// required, not merely a target reference.
// ---------------------------------------------------------------------------

export interface VisualEvidenceReference {
  evidenceKind: HairStateSnapshotEvidenceKind;
  evidenceRole: HairStateSnapshotEvidenceRole;
  assetId: string;
  snapshotId: string;
}

function isValidVisualEvidenceReference(value: unknown): value is VisualEvidenceReference {
  if (!isRecord(value)) return false;
  if (!(HAIR_STATE_SNAPSHOT_EVIDENCE_KINDS as readonly string[]).includes(value.evidenceKind as string)) return false;
  if (!(HAIR_STATE_SNAPSHOT_EVIDENCE_ROLES as readonly string[]).includes(value.evidenceRole as string)) return false;
  if (typeof value.assetId !== "string" || value.assetId.length === 0) return false;
  if (typeof value.snapshotId !== "string" || value.snapshotId.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Part F -- carried professional parameters (verbatim from the source
// plan's own resolvedParameters for this Execution Unit).
// ---------------------------------------------------------------------------

export interface VisualProfessionalParameter {
  name: string;
  value: string | boolean | number;
  source: string;
}

function isValidVisualProfessionalParameter(value: unknown): value is VisualProfessionalParameter {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || value.name.length === 0) return false;
  const v = value.value;
  if (typeof v !== "string" && typeof v !== "boolean" && typeof v !== "number") return false;
  return typeof value.source === "string" && value.source.length > 0;
}

// ---------------------------------------------------------------------------
// Part E -- before-state visual contract (carried verbatim from the Stage
// 7 scene's own beforeContract).
// ---------------------------------------------------------------------------

export interface VisualBeforeStateContract {
  requiresPriorSceneIds: readonly string[];
  requiredPriorState: readonly AtomicActionObservationCriterion[];
}

// ---------------------------------------------------------------------------
// Part J -- expected visible effect (carried; capability from the source
// unit's declared capability, transitions from the scene).
// ---------------------------------------------------------------------------

export interface VisualExpectedEffect {
  capability: SkillCapabilityKind;
  stateTransitions: readonly { fact: string; fromValue?: string | boolean | number; toValue: string | boolean | number }[];
}

// ---------------------------------------------------------------------------
// The VisualInstructionPackage itself.
// ---------------------------------------------------------------------------

export interface VisualInstructionPackage {
  schemaVersion: string;
  compilerVersion: string;

  // -- Part C: exact traceability.
  sourceScenePlanFingerprint: string;
  sourceSceneId: string;
  sourceSceneFingerprint: string;
  sourceExecutionPlanId: string;
  sourceExecutionUnitId: string;
  sourceAtomicActionIds: readonly string[];
  skillId: string;
  skillVersion: number;
  contributesToDelta: { scope: string; field: string };

  // -- Part D.
  subjectElements: readonly VisualSubjectElement[];

  // -- Part E.
  beforeState: VisualBeforeStateContract;

  // -- Part F/G.
  professionalParameters: readonly VisualProfessionalParameter[];
  handToolRelationships: readonly HandToolRelationship[];

  // -- Part H (progression reused verbatim from Stage 7; exactly one of
  // progression / progressionNotApplicableReason present) + Part V.
  progression?: SceneProgression;
  progressionNotApplicableReason?: string;
  renderScope: VisualInstructionRenderScope;

  // -- Part I.
  completionCriterion: AtomicActionObservationCriterion;

  // -- Part J.
  expectedVisibleEffect: VisualExpectedEffect;

  // -- Part K/L.
  preservationConstraints: readonly { scope: string; field: string; value: string }[];
  forbiddenDeviations: readonly ForbiddenDeviation[];

  // -- Part M/N (viewpoint reused verbatim from Stage 7).
  viewpoint: SceneViewpoint;
  cameraConstraints: readonly CameraConstraintKind[];

  // -- Part O (observables reused verbatim from Stage 7).
  observables: readonly SceneObservable[];

  // -- Part P.
  verification: VisualVerificationContract;

  // -- Part Q (continuity reused verbatim from Stage 7).
  continuity: SceneContinuity;

  // -- Part R/S.
  visualEvidenceRequired: boolean;
  sourceVisualEvidence: readonly VisualEvidenceReference[];

  // -- Part T/U (medium reused verbatim from Stage 7).
  requiredMedium: SceneMedium;
  overlayElements: readonly OverlayElement[];

  // -- Part AB/AC.
  packageFingerprint: string;
}

export function isValidVisualInstructionPackage(value: unknown): value is VisualInstructionPackage {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.length === 0) return false;
  if (typeof value.compilerVersion !== "string" || value.compilerVersion.length === 0) return false;

  for (const key of ["sourceScenePlanFingerprint", "sourceSceneId", "sourceSceneFingerprint", "sourceExecutionPlanId", "sourceExecutionUnitId", "skillId"]) {
    if (typeof value[key] !== "string" || (value[key] as string).length === 0) return false;
  }
  if (typeof value.skillVersion !== "number" || !Number.isInteger(value.skillVersion) || value.skillVersion < 1) return false;
  if (!Array.isArray(value.sourceAtomicActionIds) || value.sourceAtomicActionIds.length === 0 || !value.sourceAtomicActionIds.every((id) => typeof id === "string" && id.length > 0)) {
    return false;
  }
  if (!isRecord(value.contributesToDelta) || typeof value.contributesToDelta.scope !== "string" || typeof value.contributesToDelta.field !== "string") return false;

  if (!Array.isArray(value.subjectElements) || value.subjectElements.length === 0 || !value.subjectElements.every(isVisualSubjectElement)) return false;

  if (!isRecord(value.beforeState) || !Array.isArray(value.beforeState.requiresPriorSceneIds) || !Array.isArray(value.beforeState.requiredPriorState)) return false;
  if (!value.beforeState.requiresPriorSceneIds.every((id: unknown) => typeof id === "string" && id.length > 0)) return false;
  if (!value.beforeState.requiredPriorState.every(isValidObservationCriterionShape)) return false;

  if (!Array.isArray(value.professionalParameters) || !value.professionalParameters.every(isValidVisualProfessionalParameter)) return false;
  if (!Array.isArray(value.handToolRelationships) || !value.handToolRelationships.every(isValidHandToolRelationship)) return false;

  const hasProgression = value.progression !== undefined;
  const hasNAReason = value.progressionNotApplicableReason !== undefined;
  if (hasProgression === hasNAReason) return false;
  if (hasNAReason && (typeof value.progressionNotApplicableReason !== "string" || (value.progressionNotApplicableReason as string).trim().length === 0)) return false;
  if (!isVisualInstructionRenderScope(value.renderScope)) return false;

  if (!isValidObservationCriterionShape(value.completionCriterion)) return false;

  if (!isRecord(value.expectedVisibleEffect)) return false;
  if (!(SKILL_CAPABILITY_KINDS as readonly string[]).includes(value.expectedVisibleEffect.capability as string)) return false;
  if (!Array.isArray(value.expectedVisibleEffect.stateTransitions)) return false;
  if (
    !value.expectedVisibleEffect.stateTransitions.every((t: unknown) => {
      if (!isRecord(t) || typeof t.fact !== "string" || t.fact.length === 0) return false;
      const to = t.toValue;
      return typeof to === "string" || typeof to === "boolean" || typeof to === "number";
    })
  ) {
    return false;
  }

  if (!Array.isArray(value.preservationConstraints)) return false;
  if (!value.preservationConstraints.every((c: unknown) => isRecord(c) && typeof c.scope === "string" && typeof c.field === "string" && typeof c.value === "string")) return false;
  if (!Array.isArray(value.forbiddenDeviations) || value.forbiddenDeviations.length === 0 || !value.forbiddenDeviations.every(isValidForbiddenDeviation)) return false;

  if (!isRecord(value.viewpoint)) return false;
  if (value.viewpoint.status !== "RESOLVED" && value.viewpoint.status !== "NEEDS_INPUT") return false;
  if (!Array.isArray(value.cameraConstraints) || !value.cameraConstraints.every(isCameraConstraintKind)) return false;

  if (!Array.isArray(value.observables) || value.observables.length === 0) return false;

  if (!isValidVisualVerificationContract(value.verification)) return false;

  if (!isRecord(value.continuity) || !Array.isArray(value.continuity.mustRemainStable) || !Array.isArray(value.continuity.carriesForward)) return false;

  if (typeof value.visualEvidenceRequired !== "boolean") return false;
  if (!Array.isArray(value.sourceVisualEvidence) || !value.sourceVisualEvidence.every(isValidVisualEvidenceReference)) return false;

  if (!isSceneMedium(value.requiredMedium)) return false;
  if (!Array.isArray(value.overlayElements) || !value.overlayElements.every(isValidOverlayElement)) return false;

  if (typeof value.packageFingerprint !== "string" || value.packageFingerprint.length !== 64) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Part AB/AC -- deterministic package fingerprint. Includes only the
// semantic inputs actually relevant to THIS package. A change to a
// professional parameter, viewpoint, preservation constraint, or the
// referenced source visual evidence changes the fingerprint; unrelated
// data does not.
// ---------------------------------------------------------------------------

export function computeVisualInstructionPackageFingerprint(input: {
  sourceExecutionPlanId: string;
  sourceSceneId: string;
  sourceSceneFingerprint: string;
  skillId: string;
  skillVersion: number;
  contributesToDelta: { scope: string; field: string };
  professionalParameters: readonly VisualProfessionalParameter[];
  progression: SceneProgression | undefined;
  renderScope: string;
  completionCriterion: AtomicActionObservationCriterion;
  expectedCapability: string;
  preservationConstraints: readonly { scope: string; field: string; value: string }[];
  forbiddenDeviationKinds: readonly string[];
  viewpointFamily: string | undefined;
  framingSemantics: readonly string[];
  observableAspects: readonly string[];
  requiredMedium: string;
  overlayKinds: readonly string[];
  sourceVisualEvidence: readonly VisualEvidenceReference[];
  compilerVersion: string;
}): string {
  const canonical = JSON.stringify({
    p: input.sourceExecutionPlanId,
    s: [input.sourceSceneId, input.sourceSceneFingerprint],
    sk: [input.skillId, input.skillVersion],
    d: input.contributesToDelta,
    pp: [...input.professionalParameters].map((x) => `${x.name}=${String(x.value)}:${x.source}`).sort(),
    prog: input.progression ? { k: input.progression.kind, z: input.progression.zoneId ?? null, it: input.progression.iteration ?? null } : null,
    rs: input.renderScope,
    comp: input.completionCriterion,
    cap: input.expectedCapability,
    pres: [...input.preservationConstraints].map((c) => `${c.scope}:${c.field}:${c.value}`).sort(),
    forb: [...input.forbiddenDeviationKinds].sort(),
    vf: input.viewpointFamily ?? null,
    fs: [...input.framingSemantics].sort(),
    obs: [...input.observableAspects].sort(),
    med: input.requiredMedium,
    ov: [...input.overlayKinds].sort(),
    ev: [...input.sourceVisualEvidence].map((e) => `${e.evidenceKind}:${e.evidenceRole}:${e.assetId}:${e.snapshotId}`).sort(),
    cv: input.compilerVersion,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// Kept only so a caller of this module can re-validate a Stage 7 scene it
// is about to compile from, without a second import.
export const isValidSourceScene: (value: unknown) => value is ProfessionalExecutionScene = _sceneGuard;
export { SCENE_MEDIA };
export type { AtomicActionObservationCriterion, SceneMedium, SceneProgression, SceneViewpoint };
