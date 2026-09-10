import {
  confirmDraftSnapshot,
  createManualSnapshot,
  findCurrentConfirmedSnapshot,
  findSnapshotForOwner,
  listSnapshotsForClient,
  type HairStateSnapshotRecord,
} from "@/lib/hair-state-snapshot-repository";
import { listResolvedEvidenceForSnapshot, type ResolvedHairStateSnapshotEvidence } from "@/lib/hair-state-snapshot-evidence-repository";
import { isHairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { computeHairStateDelta, type HairStateDelta } from "@/lib/hair-state-delta";
import { selectCandidateSkillsForDelta, type HairStateDeltaSkillSelectionResult } from "@/lib/hair-state-delta-skill-candidate-selector";
import { buildProfessionalReasoningContext, type ProfessionalReasoningContext } from "@/lib/professional-reasoning-contracts";
import {
  confirmDraftReasoningProposal,
  findCurrentConfirmedReasoningProposal,
  findReasoningProposalForOwner,
  listReasoningProposalsForClient,
  rejectDraftReasoningProposal,
  type ProfessionalReasoningProposalRecord,
} from "@/lib/professional-reasoning-repository";
import { compileProfessionalExecutionPlan } from "@/lib/professional-execution-plan-compiler";
import {
  confirmDraftExecutionPlan,
  createDraftExecutionPlan,
  findCurrentConfirmedExecutionPlan,
  type ProfessionalExecutionPlanRecord,
} from "@/lib/professional-execution-plan-repository";
import { compileProfessionalExecutionScenePlan } from "@/lib/professional-execution-scene-compiler";
import {
  confirmDraftScenePlan,
  createDraftScenePlan,
  findCurrentConfirmedScenePlan,
  type ProfessionalExecutionScenePlanRecord,
} from "@/lib/professional-execution-scene-repository";
import { compileAllVisualInstructionPackages } from "@/lib/professional-visual-instruction-compiler";
import { evaluateRenderReadiness, type RenderReadinessResult } from "@/lib/professional-visual-instruction-readiness";
import type { VisualEvidenceReference, VisualInstructionPackage } from "@/lib/professional-visual-instruction-contracts";
import { PROFESSIONAL_BRAIN_SKILL_TEMPLATES, buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import {
  buildPipelineStatusView,
  type ProfessionalBrainArtifacts,
  type ProfessionalBrainPipelineStatusView,
} from "@/lib/professional-brain-pipeline-status";
import { findClientForOwner } from "@/lib/client-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5A -- PROFESSIONAL
// BRAIN ORCHESTRATOR. The single canonical application/service layer that
// CONNECTS the Stage 2 -> 8 domain modules to a real client. It contains
// NO haircut/professional logic of its own (Part "core rule": DO NOT
// BUILD A SECOND BRAIN) -- every function below only:
//   * checks client ownership,
//   * loads already-persisted authoritative artifacts,
//   * invokes the exact Stage 2/3/4/5/6/7/8 module,
//   * persists the output through the existing repository,
//   * STOPS at each authority/approval boundary,
//   * STOPS before any paid AI reasoning or provider call.
//
// It makes ZERO paid AI calls and ZERO provider calls. The Stage 5
// reasoning boundary is prepared (prepareReasoningRequestPackage) but the
// paid call is deliberately NOT invoked here -- a later authorized stage
// (8.5R1) runs exactly one real reasoning call.

export class ProfessionalBrainAccessError extends Error {
  readonly code = "PROFESSIONAL_BRAIN_CLIENT_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("Client not found.");
    this.name = "ProfessionalBrainAccessError";
  }
}

export class ProfessionalBrainStateError extends Error {
  readonly httpStatus = 409;
  constructor(
    readonly code:
      | "PROFESSIONAL_BRAIN_NEEDS_CURRENT_STATE"
      | "PROFESSIONAL_BRAIN_NEEDS_TARGET_STATE"
      | "PROFESSIONAL_BRAIN_NEEDS_STATE_CONFIRMATION"
      | "PROFESSIONAL_BRAIN_NEEDS_APPROVED_REASONING"
      | "PROFESSIONAL_BRAIN_NEEDS_EXECUTION_PLAN"
      | "PROFESSIONAL_BRAIN_NEEDS_SCENE_PLAN"
      | "PROFESSIONAL_BRAIN_REASONING_CALL_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalBrainStateError";
  }
}

async function assertOwnedClient(ownerUserId: string, clientId: string): Promise<void> {
  const client = await findClientForOwner(ownerUserId, clientId);
  if (!client) throw new ProfessionalBrainAccessError();
}

// ---------------------------------------------------------------------------
// Artifact loading + pipeline status (read-only, zero AI, zero provider).
// ---------------------------------------------------------------------------

function pickSnapshot(records: readonly HairStateSnapshotRecord[]): HairStateSnapshotRecord | null {
  const confirmed = records.find((r) => r.status === "CONFIRMED");
  if (confirmed) return confirmed;
  return [...records].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

function evidenceToVisualReferences(snapshot: HairStateSnapshotRecord, evidence: readonly ResolvedHairStateSnapshotEvidence[]): VisualEvidenceReference[] {
  return evidence.map((e) => ({
    evidenceKind: e.evidenceKind,
    evidenceRole: e.evidenceRole,
    assetId: e.imageAssetId ?? e.captureSetId ?? "",
    snapshotId: snapshot.id,
  }));
}

export interface LoadedProfessionalBrainState extends ProfessionalBrainArtifacts {
  clientId: string;
  visualPackages: readonly VisualInstructionPackage[];
  sceneReadiness: readonly { sceneId: string; result: RenderReadinessResult }[];
}

export async function loadProfessionalBrainState(ownerUserId: string, clientId: string): Promise<LoadedProfessionalBrainState> {
  await assertOwnedClient(ownerUserId, clientId);

  const currentSnapshot = pickSnapshot(await listSnapshotsForClient(ownerUserId, clientId, "CURRENT"));
  const targetSnapshot = pickSnapshot(await listSnapshotsForClient(ownerUserId, clientId, "TARGET"));
  const currentSnapshotEvidence = currentSnapshot ? await listResolvedEvidenceForSnapshot(ownerUserId, currentSnapshot.id) : [];

  const confirmedReasoning = await findCurrentConfirmedReasoningProposal(ownerUserId, clientId);
  let reasoningProposal: ProfessionalReasoningProposalRecord | null = confirmedReasoning;
  if (!reasoningProposal) {
    const all = await listReasoningProposalsForClient(ownerUserId, clientId);
    reasoningProposal = [...all].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  }

  const executionPlan = await findCurrentConfirmedExecutionPlan(ownerUserId, clientId);
  const scenePlan = executionPlan ? await findCurrentConfirmedScenePlan(ownerUserId, executionPlan.id) : null;

  let visualPackages: readonly VisualInstructionPackage[] = [];
  let sceneReadiness: { sceneId: string; result: RenderReadinessResult }[] = [];
  let anySceneRenderReady: boolean | null = null;
  let allScenesRenderReady: boolean | null = null;
  let hasUnresolvedRequirement = false;

  if (executionPlan && scenePlan) {
    hasUnresolvedRequirement = scenePlan.scenePlan.unresolvedRequirements.length > 0;
    const evidenceBySceneId = currentSnapshot
      ? Object.fromEntries(scenePlan.scenePlan.scenes.map((s) => [s.sceneId, evidenceToVisualReferences(currentSnapshot, currentSnapshotEvidence)]))
      : undefined;
    const compiled = compileAllVisualInstructionPackages({
      scenePlan: scenePlan.scenePlan,
      executionPlan: executionPlan.plan,
      templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
      evidenceBySceneId,
    });
    visualPackages = compiled.packages;
    sceneReadiness = compiled.packages.map((pkg) => ({
      sceneId: pkg.sourceSceneId,
      result: evaluateRenderReadiness({
        package: pkg,
        scenePlan: scenePlan.scenePlan,
        executionPlan: executionPlan.plan,
        templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
        professionalApprovalPresent: scenePlan.status === "CONFIRMED",
      }),
    }));
    if (sceneReadiness.length > 0) {
      anySceneRenderReady = sceneReadiness.some((s) => s.result.status === "RENDER_READY");
      allScenesRenderReady = sceneReadiness.every((s) => s.result.status === "RENDER_READY");
    } else {
      anySceneRenderReady = false;
      allScenesRenderReady = false;
    }
  }

  return {
    clientId,
    currentSnapshot,
    currentSnapshotEvidence,
    targetSnapshot,
    reasoningProposal,
    executionPlan,
    scenePlan,
    anySceneRenderReady,
    allScenesRenderReady,
    hasUnresolvedRequirement,
    visualPackages,
    sceneReadiness,
  };
}

export async function getPipelineStatus(ownerUserId: string, clientId: string): Promise<ProfessionalBrainPipelineStatusView> {
  return buildPipelineStatusView(await loadProfessionalBrainState(ownerUserId, clientId));
}

// ---------------------------------------------------------------------------
// Part D/E/F -- CURRENT state + PRIMARY_CAPTURE binding (Stage 2/3).
// ---------------------------------------------------------------------------

export interface CreateCurrentStateInput {
  payload: unknown;
  primaryCaptureImageAssetId?: string;
  primaryCaptureCaptureSetId?: string;
}

export async function createDraftCurrentState(ownerUserId: string, clientId: string, input: CreateCurrentStateInput): Promise<HairStateSnapshotRecord> {
  await assertOwnedClient(ownerUserId, clientId);
  if (!isHairStateSnapshotPayload(input.payload)) {
    throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_CURRENT_STATE", "CURRENT state payload is not a structurally valid HairStateSnapshotPayload.");
  }
  const evidence = input.primaryCaptureImageAssetId
    ? [{ evidenceKind: "IMAGE_ASSET" as const, evidenceRole: "PRIMARY_CAPTURE" as const, imageAssetId: input.primaryCaptureImageAssetId }]
    : input.primaryCaptureCaptureSetId
      ? [{ evidenceKind: "CAPTURE_SET" as const, evidenceRole: "PRIMARY_CAPTURE" as const, captureSetId: input.primaryCaptureCaptureSetId }]
      : undefined;
  return createManualSnapshot(ownerUserId, clientId, "CURRENT", input.payload, {}, evidence);
}

// ---------------------------------------------------------------------------
// Part G -- TARGET state (professional structured input only; a reference
// image never becomes TARGET professional truth here).
// ---------------------------------------------------------------------------

export async function createDraftTargetState(ownerUserId: string, clientId: string, payload: unknown): Promise<HairStateSnapshotRecord> {
  await assertOwnedClient(ownerUserId, clientId);
  if (!isHairStateSnapshotPayload(payload)) {
    throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_TARGET_STATE", "TARGET state payload is not a structurally valid HairStateSnapshotPayload.");
  }
  return createManualSnapshot(ownerUserId, clientId, "TARGET", payload, {});
}

// ---------------------------------------------------------------------------
// Part H -- explicit confirmation (Stage 2 lifecycle DRAFT -> CONFIRMED).
// ---------------------------------------------------------------------------

export async function confirmSnapshot(
  ownerUserId: string,
  clientId: string,
  snapshotId: string,
  expectedCurrentConfirmedSnapshotId: string | null,
): Promise<HairStateSnapshotRecord | null> {
  await assertOwnedClient(ownerUserId, clientId);
  const snapshot = await findSnapshotForOwner(ownerUserId, snapshotId);
  if (!snapshot || snapshot.clientId !== clientId) return null;
  return confirmDraftSnapshot(ownerUserId, snapshotId, expectedCurrentConfirmedSnapshotId);
}

// ---------------------------------------------------------------------------
// Part I/J -- delta + deterministic candidate skills (Stage 4).
// ---------------------------------------------------------------------------

async function requireConfirmedStates(ownerUserId: string, clientId: string): Promise<{ current: HairStateSnapshotRecord; target: HairStateSnapshotRecord }> {
  const current = await findCurrentConfirmedSnapshot(ownerUserId, clientId, "CURRENT");
  const target = await findCurrentConfirmedSnapshot(ownerUserId, clientId, "TARGET");
  if (!current) throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_STATE_CONFIRMATION", "No CONFIRMED CURRENT snapshot exists for this client.");
  if (!target) throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_STATE_CONFIRMATION", "No CONFIRMED TARGET snapshot exists for this client.");
  return { current, target };
}

export async function computeDelta(ownerUserId: string, clientId: string): Promise<HairStateDelta> {
  await assertOwnedClient(ownerUserId, clientId);
  const { current, target } = await requireConfirmedStates(ownerUserId, clientId);
  return computeHairStateDelta(
    { id: current.id, snapshotVersion: current.snapshotVersion, payload: current.payload },
    { id: target.id, snapshotVersion: target.snapshotVersion, payload: target.payload },
  );
}

export async function selectCandidateSkills(ownerUserId: string, clientId: string): Promise<HairStateDeltaSkillSelectionResult> {
  await assertOwnedClient(ownerUserId, clientId);
  const { current, target } = await requireConfirmedStates(ownerUserId, clientId);
  return selectCandidateSkillsForDelta(
    { id: current.id, snapshotVersion: current.snapshotVersion, payload: current.payload },
    { id: target.id, snapshotVersion: target.snapshotVersion, payload: target.payload },
    buildCanonicalCandidateSkillRegistry(),
  );
}

// ---------------------------------------------------------------------------
// Part K -- REASONING BOUNDARY. Prepares everything a later authorized
// paid Stage 5 call needs, and STOPS. ZERO provider calls.
// ---------------------------------------------------------------------------

export interface ReasoningRequestPackage {
  clientId: string;
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;
  context: ProfessionalReasoningContext;
  candidateSkillCount: number;
  unresolvedDeltaCount: number;
  // A real, paid Stage 5 provider call is required to turn this package
  // into a persisted ProfessionalReasoningProposal. Stage 8.5A never
  // makes it.
  requiresPaidReasoningCall: true;
}

export async function prepareReasoningRequestPackage(
  ownerUserId: string,
  clientId: string,
  options: { professionalRequestText?: string } = {},
): Promise<ReasoningRequestPackage> {
  await assertOwnedClient(ownerUserId, clientId);
  const { current, target } = await requireConfirmedStates(ownerUserId, clientId);
  const selection = selectCandidateSkillsForDelta(
    { id: current.id, snapshotVersion: current.snapshotVersion, payload: current.payload },
    { id: target.id, snapshotVersion: target.snapshotVersion, payload: target.payload },
    buildCanonicalCandidateSkillRegistry(),
  );
  const context = buildProfessionalReasoningContext({ selection, professionalRequestText: options.professionalRequestText });
  return {
    clientId,
    currentSnapshotId: current.id,
    currentSnapshotVersion: current.snapshotVersion,
    targetSnapshotId: target.id,
    targetSnapshotVersion: target.snapshotVersion,
    context,
    candidateSkillCount: context.candidateSkills.length,
    unresolvedDeltaCount: context.unresolvedDeltas.length,
    requiresPaidReasoningCall: true,
  };
}

// ---------------------------------------------------------------------------
// Part N -- professional approval of a persisted DRAFT reasoning proposal.
// (The proposal itself is only created by a later paid Stage 5 call.)
// ---------------------------------------------------------------------------

export async function approveReasoningProposal(
  ownerUserId: string,
  clientId: string,
  proposalId: string,
  approvingUserId: string,
  expectedCurrentConfirmedProposalId: string | null,
): Promise<ProfessionalReasoningProposalRecord | null> {
  await assertOwnedClient(ownerUserId, clientId);
  const proposal = await findReasoningProposalForOwner(ownerUserId, proposalId);
  if (!proposal || proposal.clientId !== clientId) return null;
  return confirmDraftReasoningProposal(ownerUserId, proposalId, approvingUserId, expectedCurrentConfirmedProposalId);
}

export async function rejectReasoningProposal(ownerUserId: string, clientId: string, proposalId: string): Promise<ProfessionalReasoningProposalRecord | null> {
  await assertOwnedClient(ownerUserId, clientId);
  const proposal = await findReasoningProposalForOwner(ownerUserId, proposalId);
  if (!proposal || proposal.clientId !== clientId) return null;
  return rejectDraftReasoningProposal(ownerUserId, proposalId);
}

// ---------------------------------------------------------------------------
// Part O -- Stage 6 compilation (deterministic, no AI).
// ---------------------------------------------------------------------------

export async function compileAndPersistExecutionPlan(ownerUserId: string, clientId: string): Promise<ProfessionalExecutionPlanRecord> {
  await assertOwnedClient(ownerUserId, clientId);
  const proposal = await findCurrentConfirmedReasoningProposal(ownerUserId, clientId);
  if (!proposal) throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_APPROVED_REASONING", "No CONFIRMED reasoning proposal exists for this client.");

  const compiled = compileProfessionalExecutionPlan({
    proposal: proposal.proposal,
    reasoningProposalId: proposal.id,
    reasoningProposalContextFingerprint: proposal.contextFingerprint,
    currentSnapshotId: proposal.currentSnapshotId,
    currentSnapshotVersion: proposal.currentSnapshotVersion,
    targetSnapshotId: proposal.targetSnapshotId,
    targetSnapshotVersion: proposal.targetSnapshotVersion,
    templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
    compiledAt: new Date().toISOString(),
  });
  if (compiled.status !== "COMPILED") {
    throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_APPROVED_REASONING", `Stage 6 compilation failed: ${compiled.reason}`);
  }
  return createDraftExecutionPlan({ ownerUserId, clientId, sourceReasoningProposalId: proposal.id, plan: compiled.plan });
}

export async function confirmExecutionPlan(
  ownerUserId: string,
  clientId: string,
  planId: string,
  approvingUserId: string,
  expectedCurrentConfirmedPlanId: string | null,
): Promise<ProfessionalExecutionPlanRecord | null> {
  await assertOwnedClient(ownerUserId, clientId);
  return confirmDraftExecutionPlan(ownerUserId, planId, approvingUserId, expectedCurrentConfirmedPlanId);
}

// ---------------------------------------------------------------------------
// Part P -- Stage 7 scene compilation (deterministic, no AI).
// ---------------------------------------------------------------------------

export async function compileAndPersistScenePlan(ownerUserId: string, clientId: string): Promise<ProfessionalExecutionScenePlanRecord> {
  await assertOwnedClient(ownerUserId, clientId);
  const executionPlan = await findCurrentConfirmedExecutionPlan(ownerUserId, clientId);
  if (!executionPlan) throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_EXECUTION_PLAN", "No CONFIRMED execution plan exists for this client.");

  const compiled = compileProfessionalExecutionScenePlan({
    plan: executionPlan.plan,
    sourceExecutionPlanId: executionPlan.id,
    templates: PROFESSIONAL_BRAIN_SKILL_TEMPLATES,
    compiledAt: new Date().toISOString(),
  });
  if (compiled.status !== "COMPILED") {
    throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_EXECUTION_PLAN", `Stage 7 compilation failed: ${compiled.reason}`);
  }
  const outcome = await createDraftScenePlan({ ownerUserId, clientId, sourceExecutionPlanId: executionPlan.id, scenePlan: compiled.scenePlan });
  return outcome.record;
}

export async function confirmScenePlan(
  ownerUserId: string,
  clientId: string,
  scenePlanId: string,
  approvingUserId: string,
  expectedCurrentConfirmedScenePlanId: string | null,
): Promise<ProfessionalExecutionScenePlanRecord | null> {
  await assertOwnedClient(ownerUserId, clientId);
  return confirmDraftScenePlan(ownerUserId, scenePlanId, approvingUserId, expectedCurrentConfirmedScenePlanId);
}

// ---------------------------------------------------------------------------
// Part Q -- Stage 8 visual instructions + per-scene render readiness.
// Not persisted (Stage 8 is a compile-fresh artifact). Zero provider call.
// ---------------------------------------------------------------------------

export interface SceneRenderReadinessView {
  sceneId: string;
  packageFingerprint: string;
  status: RenderReadinessResult["status"];
  reasons: readonly string[];
}

export async function getVisualInstructionReadiness(ownerUserId: string, clientId: string): Promise<readonly SceneRenderReadinessView[]> {
  const state = await loadProfessionalBrainState(ownerUserId, clientId);
  if (!state.scenePlan || !state.executionPlan) {
    throw new ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_SCENE_PLAN", "No CONFIRMED scene plan exists for this client.");
  }
  const packageBySceneId = new Map(state.visualPackages.map((p) => [p.sourceSceneId, p] as const));
  return state.sceneReadiness.map((s) => ({
    sceneId: s.sceneId,
    packageFingerprint: packageBySceneId.get(s.sceneId)?.packageFingerprint ?? "",
    status: s.result.status,
    reasons: s.result.findings.map((f) => f.reason),
  }));
}
