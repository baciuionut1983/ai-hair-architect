import { describe, expect, it } from "vitest";

import { resolveWorkflowStage } from "./orchestrator-workflow-stage";
import type { OrchestratorContext } from "./orchestrator-contracts";

function context(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return { roleClass: "professional", currentClientId: null, currentAnalysisId: null, hasCompletedPhotoPreview: false, ...overrides };
}

describe("resolveWorkflowStage -- task section 5/6, derived ONLY from already-verified context", () => {
  it("no_client when no client is resolved", () => {
    expect(resolveWorkflowStage(context())).toBe("no_client");
  });

  it("no_analysis when a client is resolved but no analysis is", () => {
    expect(resolveWorkflowStage(context({ currentClientId: "client-1" }))).toBe("no_analysis");
  });

  it("analysis_in_progress when client + analysis are resolved but Photo Preview isn't complete", () => {
    expect(resolveWorkflowStage(context({ currentClientId: "client-1", currentAnalysisId: "analysis-1" }))).toBe("analysis_in_progress");
  });

  it("result_available when client + analysis are resolved and Photo Preview IS complete", () => {
    expect(
      resolveWorkflowStage(context({ currentClientId: "client-1", currentAnalysisId: "analysis-1", hasCompletedPhotoPreview: true })),
    ).toBe("result_available");
  });

  // hasCompletedPhotoPreview alone, with no client/analysis, must never
  // fabricate a further-along stage -- the earlier checks always win.
  it("hasCompletedPhotoPreview never overrides a missing client/analysis", () => {
    expect(resolveWorkflowStage(context({ hasCompletedPhotoPreview: true }))).toBe("no_client");
    expect(resolveWorkflowStage(context({ currentClientId: "client-1", hasCompletedPhotoPreview: true }))).toBe("no_analysis");
  });
});
