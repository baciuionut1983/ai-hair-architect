import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { ResolvedHairStateSnapshotEvidence } from "@/lib/hair-state-snapshot-evidence-repository";
import type { ProfessionalReasoningProposalRecord } from "@/lib/professional-reasoning-repository";
import type { ProfessionalReasoningProposalStatus } from "@/lib/professional-reasoning-repository";
import type { ProfessionalExecutionPlanRecord } from "@/lib/professional-execution-plan-repository";
import type { ProfessionalExecutionScenePlanRecord } from "@/lib/professional-execution-scene-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5A -- PROFESSIONAL
// BRAIN PIPELINE STATUS. Pure, deterministic, no I/O, no AI. Derives WHERE
// a real client currently is in the Stage 2 -> 8 chain SOLELY from
// already-persisted artifacts. It creates no lifecycle truth of its own --
// every value below is a plain function of records the Stage 2/3/5/6/7
// repositories already own. No fake completion is ever reported.
//
// AUTHORITY: this module never advances the pipeline; it only observes it.
// It is the read model the orchestration service and the dry-run
// diagnostic both consult, so "what step is this client on" is answered in
// exactly one place.

export const PROFESSIONAL_BRAIN_PIPELINE_STATUSES = [
  "NEEDS_VISUAL_EVIDENCE",
  "NEEDS_CURRENT_STATE",
  "NEEDS_TARGET_STATE",
  "NEEDS_STATE_CONFIRMATION",
  "NEEDS_REASONING",
  "REASONING_DRAFT",
  "NEEDS_PROFESSIONAL_APPROVAL",
  "NEEDS_EXECUTION_PLAN",
  "NEEDS_SCENE_COMPILATION",
  "NEEDS_VISUAL_INSTRUCTION",
  "NEEDS_RENDER_READINESS",
  "RENDER_READY",
  "UNRESOLVED",
  "BLOCKED",
] as const;
export type ProfessionalBrainPipelineStatus = (typeof PROFESSIONAL_BRAIN_PIPELINE_STATUSES)[number];

export function isProfessionalBrainPipelineStatus(value: unknown): value is ProfessionalBrainPipelineStatus {
  return typeof value === "string" && (PROFESSIONAL_BRAIN_PIPELINE_STATUSES as readonly string[]).includes(value);
}

// The already-persisted artifacts for one (owner, client), loaded by the
// orchestration service. Every field is exactly what a Stage 2/3/5/6/7
// repository read returns -- never a reshaped copy.
export interface ProfessionalBrainArtifacts {
  currentSnapshot: HairStateSnapshotRecord | null;
  currentSnapshotEvidence: readonly ResolvedHairStateSnapshotEvidence[];
  targetSnapshot: HairStateSnapshotRecord | null;
  // The single current CONFIRMED reasoning proposal (Stage 5) -- or the
  // most recent DRAFT if none is confirmed yet.
  reasoningProposal: ProfessionalReasoningProposalRecord | null;
  // Whether a paid Stage 5 reasoning call has ever produced a persisted
  // proposal for this exact (current, target). Stage 8.5A never sets this
  // true -- it is derived from `reasoningProposal !== null`.
  executionPlan: ProfessionalExecutionPlanRecord | null;
  scenePlan: ProfessionalExecutionScenePlanRecord | null;
  // From Stage 8's per-scene Render Readiness Gate, run on demand by the
  // orchestrator (never persisted). true iff at least one scene is
  // RENDER_READY (all mandatory semantics present) AND none is a hard
  // NOT_READY. null when the scene plan does not exist yet.
  anySceneRenderReady: boolean | null;
  // true iff every demonstrable scene is RENDER_READY.
  allScenesRenderReady: boolean | null;
  // true iff the source reasoning proposal carried at least one unresolved
  // requirement that no registered skill can address (e.g. crown
  // weight-reduction). A partial pipeline is honest, never an error.
  hasUnresolvedRequirement: boolean;
}

function hasPrimaryCapture(evidence: readonly ResolvedHairStateSnapshotEvidence[]): boolean {
  return evidence.some((e) => e.evidenceRole === "PRIMARY_CAPTURE");
}

const APPROVED_REASONING_STATUSES: readonly ProfessionalReasoningProposalStatus[] = ["CONFIRMED"];

export function derivePipelineStatus(artifacts: ProfessionalBrainArtifacts): ProfessionalBrainPipelineStatus {
  const {
    currentSnapshot,
    currentSnapshotEvidence,
    targetSnapshot,
    reasoningProposal,
    executionPlan,
    scenePlan,
    anySceneRenderReady,
    allScenesRenderReady,
    hasUnresolvedRequirement,
  } = artifacts;

  // 1 -- CURRENT state.
  if (!currentSnapshot) return "NEEDS_CURRENT_STATE";
  if (!hasPrimaryCapture(currentSnapshotEvidence)) return "NEEDS_VISUAL_EVIDENCE";

  // 2 -- TARGET state.
  if (!targetSnapshot) return "NEEDS_TARGET_STATE";

  // 3 -- both states confirmed (Stage 5 reasoning consumes CONFIRMED only).
  if (currentSnapshot.status !== "CONFIRMED" || targetSnapshot.status !== "CONFIRMED") return "NEEDS_STATE_CONFIRMATION";

  // 4 -- reasoning.
  if (!reasoningProposal) return "NEEDS_REASONING";
  if (reasoningProposal.status === "DRAFT") return "NEEDS_PROFESSIONAL_APPROVAL";
  if (reasoningProposal.status === "REJECTED") return "NEEDS_REASONING";
  if (reasoningProposal.status === "SUPERSEDED") return "NEEDS_REASONING";
  if (!APPROVED_REASONING_STATUSES.includes(reasoningProposal.status)) return "NEEDS_PROFESSIONAL_APPROVAL";

  // 5 -- execution plan (Stage 6).
  if (!executionPlan) return "NEEDS_EXECUTION_PLAN";

  // 6 -- scene plan (Stage 7).
  if (!scenePlan) return "NEEDS_SCENE_COMPILATION";

  // 7 -- visual instruction + render readiness (Stage 8).
  if (anySceneRenderReady === null) return "NEEDS_VISUAL_INSTRUCTION";
  if (anySceneRenderReady === false) return "NEEDS_RENDER_READINESS";

  // 8 -- ready. An unresolved requirement makes the WHOLE-plan state
  // UNRESOLVED even though individual scenes are render-ready -- the plan
  // is honestly partial (Part AG: UNRESOLVED is correct, never patched).
  if (hasUnresolvedRequirement && allScenesRenderReady !== true) return "UNRESOLVED";
  return "RENDER_READY";
}

// A structured, serialization-safe view for a status API / dry-run. Never
// includes secrets, client PII, or raw payloads -- only the pipeline
// position and the minimal identifiers a diagnostic needs.
export interface ProfessionalBrainPipelineStatusView {
  status: ProfessionalBrainPipelineStatus;
  currentSnapshotId: string | null;
  currentSnapshotStatus: string | null;
  hasPrimaryCapture: boolean;
  targetSnapshotId: string | null;
  targetSnapshotStatus: string | null;
  reasoningProposalId: string | null;
  reasoningProposalStatus: string | null;
  executionPlanId: string | null;
  executionPlanStatus: string | null;
  scenePlanId: string | null;
  scenePlanStatus: string | null;
  sceneCount: number | null;
  anySceneRenderReady: boolean | null;
  allScenesRenderReady: boolean | null;
  hasUnresolvedRequirement: boolean;
}

export function buildPipelineStatusView(artifacts: ProfessionalBrainArtifacts): ProfessionalBrainPipelineStatusView {
  return {
    status: derivePipelineStatus(artifacts),
    currentSnapshotId: artifacts.currentSnapshot?.id ?? null,
    currentSnapshotStatus: artifacts.currentSnapshot?.status ?? null,
    hasPrimaryCapture: hasPrimaryCapture(artifacts.currentSnapshotEvidence),
    targetSnapshotId: artifacts.targetSnapshot?.id ?? null,
    targetSnapshotStatus: artifacts.targetSnapshot?.status ?? null,
    reasoningProposalId: artifacts.reasoningProposal?.id ?? null,
    reasoningProposalStatus: artifacts.reasoningProposal?.status ?? null,
    executionPlanId: artifacts.executionPlan?.id ?? null,
    executionPlanStatus: artifacts.executionPlan?.status ?? null,
    scenePlanId: artifacts.scenePlan?.id ?? null,
    scenePlanStatus: artifacts.scenePlan?.status ?? null,
    sceneCount: artifacts.scenePlan?.scenePlan.scenes.length ?? null,
    anySceneRenderReady: artifacts.anySceneRenderReady,
    allScenesRenderReady: artifacts.allScenesRenderReady,
    hasUnresolvedRequirement: artifacts.hasUnresolvedRequirement,
  };
}
