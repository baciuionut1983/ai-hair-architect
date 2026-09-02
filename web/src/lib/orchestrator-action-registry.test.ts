import { describe, expect, it } from "vitest";

import {
  isOrchestratorActionAllowedForRole,
  ORCHESTRATOR_ACTION_REGISTRY,
  resolveOrchestratorActionHref,
} from "@/lib/orchestrator-action-registry";
import type { OrchestratorActionId } from "@/lib/orchestrator-contracts";

const ALL_ACTION_IDS = Object.keys(ORCHESTRATOR_ACTION_REGISTRY) as OrchestratorActionId[];

describe("ORCHESTRATOR_ACTION_REGISTRY -- structural safety (task section 3/4/12)", () => {
  it("every action is navigation-only in Stage 1 -- no action can execute an engine directly", () => {
    for (const id of ALL_ACTION_IDS) {
      expect(ORCHESTRATOR_ACTION_REGISTRY[id].kind).toBe("navigate");
      expect(ORCHESTRATOR_ACTION_REGISTRY[id].canExecuteAutomatically).toBe(false);
    }
  });

  it("REQUEST_VIDEO is classified MEANINGFUL_COST and requires user consent -- never treated as free", () => {
    expect(ORCHESTRATOR_ACTION_REGISTRY.REQUEST_VIDEO.costClass).toBe("MEANINGFUL_COST");
    expect(ORCHESTRATOR_ACTION_REGISTRY.REQUEST_VIDEO.requiresUserConsent).toBe(true);
  });

  it("REQUEST_VIDEO itself changes no data -- the existing Video UI's own dialog is what actually submits", () => {
    expect(ORCHESTRATOR_ACTION_REGISTRY.REQUEST_VIDEO.changesData).toBe(false);
  });

  it("navigation-only actions (clients/analysis browsing) are NO_INCREMENTAL_COST", () => {
    expect(ORCHESTRATOR_ACTION_REGISTRY.OPEN_CLIENTS.costClass).toBe("NO_INCREMENTAL_COST");
    expect(ORCHESTRATOR_ACTION_REGISTRY.OPEN_CLIENT.costClass).toBe("NO_INCREMENTAL_COST");
    expect(ORCHESTRATOR_ACTION_REGISTRY.OPEN_ANALYSIS.costClass).toBe("NO_INCREMENTAL_COST");
  });

  it("no Stage 1 action is available to the public role class", () => {
    for (const id of ALL_ACTION_IDS) {
      expect(isOrchestratorActionAllowedForRole(id, "public")).toBe(false);
    }
  });

  it("every Stage 1 action is available to the professional role class", () => {
    for (const id of ALL_ACTION_IDS) {
      expect(isOrchestratorActionAllowedForRole(id, "professional")).toBe(true);
    }
  });
});

describe("resolveOrchestratorActionHref -- never a URL built from an unverified id (task section 11)", () => {
  it("OPEN_CLIENTS never needs a client/analysis id", () => {
    expect(resolveOrchestratorActionHref("OPEN_CLIENTS", { clientId: null, analysisId: null })).toBe("/clients");
  });

  it("OPEN_CLIENT returns null with no clientId, and the exact real path once one is present", () => {
    expect(resolveOrchestratorActionHref("OPEN_CLIENT", { clientId: null, analysisId: null })).toBeNull();
    expect(resolveOrchestratorActionHref("OPEN_CLIENT", { clientId: "client-1", analysisId: null })).toBe("/clients/client-1");
  });

  it("START_ANALYSIS returns null with no clientId", () => {
    expect(resolveOrchestratorActionHref("START_ANALYSIS", { clientId: null, analysisId: null })).toBeNull();
    expect(resolveOrchestratorActionHref("START_ANALYSIS", { clientId: "client-1", analysisId: null })).toBe("/clients/client-1/analysis/new");
  });

  it("OPEN_ANALYSIS and REQUEST_VIDEO both return null unless BOTH clientId and analysisId are present", () => {
    expect(resolveOrchestratorActionHref("OPEN_ANALYSIS", { clientId: "client-1", analysisId: null })).toBeNull();
    expect(resolveOrchestratorActionHref("OPEN_ANALYSIS", { clientId: null, analysisId: "analysis-1" })).toBeNull();
    expect(resolveOrchestratorActionHref("OPEN_ANALYSIS", { clientId: "client-1", analysisId: "analysis-1" })).toBe("/clients/client-1/analysis/analysis-1");
    expect(resolveOrchestratorActionHref("REQUEST_VIDEO", { clientId: "client-1", analysisId: null })).toBeNull();
    expect(resolveOrchestratorActionHref("REQUEST_VIDEO", { clientId: "client-1", analysisId: "analysis-1" })).toBe("/clients/client-1/analysis/analysis-1");
  });

  it("REQUEST_VIDEO resolves to the SAME analysis page OPEN_ANALYSIS does -- it can never point at a Video-specific create/execute endpoint", () => {
    const ctx = { clientId: "client-1", analysisId: "analysis-1" };
    expect(resolveOrchestratorActionHref("REQUEST_VIDEO", ctx)).toBe(resolveOrchestratorActionHref("OPEN_ANALYSIS", ctx));
    expect(resolveOrchestratorActionHref("REQUEST_VIDEO", ctx)).not.toMatch(/video-demonstrations|generateVideos|execute/);
  });
});
