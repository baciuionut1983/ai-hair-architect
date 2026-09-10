import { describe, expect, it } from "vitest";

import {
  PROFESSIONAL_BRAIN_PIPELINE_STATUSES,
  buildPipelineStatusView,
  derivePipelineStatus,
  isProfessionalBrainPipelineStatus,
  type ProfessionalBrainArtifacts,
} from "@/lib/professional-brain-pipeline-status";
import type { HairStateSnapshotRecord } from "@/lib/hair-state-snapshot-repository";
import type { ResolvedHairStateSnapshotEvidence } from "@/lib/hair-state-snapshot-evidence-repository";
import type { ProfessionalReasoningProposalRecord } from "@/lib/professional-reasoning-repository";
import type { ProfessionalExecutionPlanRecord } from "@/lib/professional-execution-plan-repository";
import type { ProfessionalExecutionScenePlanRecord } from "@/lib/professional-execution-scene-repository";

// SYNTHETIC -- pure status-derivation unit tests. Zero I/O, zero AI.

function snap(role: "CURRENT" | "TARGET", status: "DRAFT" | "CONFIRMED" | "SUPERSEDED"): HairStateSnapshotRecord {
  return { id: `${role}-1`, ownerUserId: "o", clientId: "c", role, status, snapshotVersion: 1, createdAt: "2026-09-20T00:00:00.000Z" } as unknown as HairStateSnapshotRecord;
}
function primaryCapture(): ResolvedHairStateSnapshotEvidence {
  return { evidenceRole: "PRIMARY_CAPTURE", evidenceKind: "IMAGE_ASSET", imageAssetId: "img-1" } as unknown as ResolvedHairStateSnapshotEvidence;
}
function reasoning(status: "DRAFT" | "CONFIRMED" | "REJECTED" | "SUPERSEDED"): ProfessionalReasoningProposalRecord {
  return { id: "rp-1", clientId: "c", status } as unknown as ProfessionalReasoningProposalRecord;
}
function execPlan(): ProfessionalExecutionPlanRecord {
  return { id: "ep-1", status: "CONFIRMED" } as unknown as ProfessionalExecutionPlanRecord;
}
function scenePlan(sceneCount: number): ProfessionalExecutionScenePlanRecord {
  return { id: "sp-1", status: "CONFIRMED", scenePlan: { scenes: Array.from({ length: sceneCount }, (_v, i) => ({ sceneId: `s${i}` })), unresolvedRequirements: [] } } as unknown as ProfessionalExecutionScenePlanRecord;
}

function base(): ProfessionalBrainArtifacts {
  return {
    currentSnapshot: null,
    currentSnapshotEvidence: [],
    targetSnapshot: null,
    reasoningProposal: null,
    executionPlan: null,
    scenePlan: null,
    anySceneRenderReady: null,
    allScenesRenderReady: null,
    hasUnresolvedRequirement: false,
  };
}

describe("derivePipelineStatus", () => {
  it("the status vocabulary guard works", () => {
    for (const s of PROFESSIONAL_BRAIN_PIPELINE_STATUSES) expect(isProfessionalBrainPipelineStatus(s)).toBe(true);
    expect(isProfessionalBrainPipelineStatus("DONE")).toBe(false);
  });

  it("no current snapshot -> NEEDS_CURRENT_STATE", () => {
    expect(derivePipelineStatus(base())).toBe("NEEDS_CURRENT_STATE");
  });

  it("current snapshot but no PRIMARY_CAPTURE -> NEEDS_VISUAL_EVIDENCE", () => {
    expect(derivePipelineStatus({ ...base(), currentSnapshot: snap("CURRENT", "DRAFT") })).toBe("NEEDS_VISUAL_EVIDENCE");
  });

  it("current + primary capture, no target -> NEEDS_TARGET_STATE", () => {
    expect(derivePipelineStatus({ ...base(), currentSnapshot: snap("CURRENT", "DRAFT"), currentSnapshotEvidence: [primaryCapture()] })).toBe("NEEDS_TARGET_STATE");
  });

  it("both states present but not both CONFIRMED -> NEEDS_STATE_CONFIRMATION", () => {
    expect(
      derivePipelineStatus({
        ...base(),
        currentSnapshot: snap("CURRENT", "DRAFT"),
        currentSnapshotEvidence: [primaryCapture()],
        targetSnapshot: snap("TARGET", "CONFIRMED"),
      }),
    ).toBe("NEEDS_STATE_CONFIRMATION");
  });

  it("both CONFIRMED, no reasoning -> NEEDS_REASONING", () => {
    expect(
      derivePipelineStatus({
        ...base(),
        currentSnapshot: snap("CURRENT", "CONFIRMED"),
        currentSnapshotEvidence: [primaryCapture()],
        targetSnapshot: snap("TARGET", "CONFIRMED"),
      }),
    ).toBe("NEEDS_REASONING");
  });

  it("reasoning DRAFT -> NEEDS_PROFESSIONAL_APPROVAL; REJECTED/SUPERSEDED -> NEEDS_REASONING", () => {
    const withStates = {
      ...base(),
      currentSnapshot: snap("CURRENT", "CONFIRMED"),
      currentSnapshotEvidence: [primaryCapture()],
      targetSnapshot: snap("TARGET", "CONFIRMED"),
    };
    expect(derivePipelineStatus({ ...withStates, reasoningProposal: reasoning("DRAFT") })).toBe("NEEDS_PROFESSIONAL_APPROVAL");
    expect(derivePipelineStatus({ ...withStates, reasoningProposal: reasoning("REJECTED") })).toBe("NEEDS_REASONING");
    expect(derivePipelineStatus({ ...withStates, reasoningProposal: reasoning("SUPERSEDED") })).toBe("NEEDS_REASONING");
  });

  it("reasoning CONFIRMED, no execution plan -> NEEDS_EXECUTION_PLAN; then NEEDS_SCENE_COMPILATION; then NEEDS_VISUAL_INSTRUCTION", () => {
    const approved = {
      ...base(),
      currentSnapshot: snap("CURRENT", "CONFIRMED"),
      currentSnapshotEvidence: [primaryCapture()],
      targetSnapshot: snap("TARGET", "CONFIRMED"),
      reasoningProposal: reasoning("CONFIRMED"),
    };
    expect(derivePipelineStatus(approved)).toBe("NEEDS_EXECUTION_PLAN");
    expect(derivePipelineStatus({ ...approved, executionPlan: execPlan() })).toBe("NEEDS_SCENE_COMPILATION");
    expect(derivePipelineStatus({ ...approved, executionPlan: execPlan(), scenePlan: scenePlan(3) })).toBe("NEEDS_VISUAL_INSTRUCTION");
  });

  it("scene plan compiled, no scene render-ready -> NEEDS_RENDER_READINESS; at least one ready -> RENDER_READY", () => {
    const withScenePlan = {
      ...base(),
      currentSnapshot: snap("CURRENT", "CONFIRMED"),
      currentSnapshotEvidence: [primaryCapture()],
      targetSnapshot: snap("TARGET", "CONFIRMED"),
      reasoningProposal: reasoning("CONFIRMED"),
      executionPlan: execPlan(),
      scenePlan: scenePlan(3),
    };
    expect(derivePipelineStatus({ ...withScenePlan, anySceneRenderReady: false, allScenesRenderReady: false })).toBe("NEEDS_RENDER_READINESS");
    expect(derivePipelineStatus({ ...withScenePlan, anySceneRenderReady: true, allScenesRenderReady: true })).toBe("RENDER_READY");
  });

  it("an unresolved requirement with not-all-scenes-ready -> UNRESOLVED (never patched to RENDER_READY)", () => {
    const withUnresolved = {
      ...base(),
      currentSnapshot: snap("CURRENT", "CONFIRMED"),
      currentSnapshotEvidence: [primaryCapture()],
      targetSnapshot: snap("TARGET", "CONFIRMED"),
      reasoningProposal: reasoning("CONFIRMED"),
      executionPlan: execPlan(),
      scenePlan: scenePlan(3),
      anySceneRenderReady: true,
      allScenesRenderReady: false,
      hasUnresolvedRequirement: true,
    };
    expect(derivePipelineStatus(withUnresolved)).toBe("UNRESOLVED");
  });

  it("buildPipelineStatusView never leaks a payload or PII -- only ids/statuses/booleans", () => {
    const view = buildPipelineStatusView({
      ...base(),
      currentSnapshot: snap("CURRENT", "CONFIRMED"),
      currentSnapshotEvidence: [primaryCapture()],
      targetSnapshot: snap("TARGET", "CONFIRMED"),
    });
    expect(view.status).toBe("NEEDS_REASONING");
    expect(view.hasPrimaryCapture).toBe(true);
    expect(Object.keys(view).sort()).toEqual(
      [
        "allScenesRenderReady",
        "anySceneRenderReady",
        "currentSnapshotId",
        "currentSnapshotStatus",
        "executionPlanId",
        "executionPlanStatus",
        "hasPrimaryCapture",
        "hasUnresolvedRequirement",
        "reasoningProposalId",
        "reasoningProposalStatus",
        "sceneCount",
        "scenePlanId",
        "scenePlanStatus",
        "status",
        "targetSnapshotId",
        "targetSnapshotStatus",
      ].sort(),
    );
  });
});
