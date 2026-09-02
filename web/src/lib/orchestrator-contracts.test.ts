import { describe, expect, it } from "vitest";

import { isOrchestratorDecision, resolveOrchestratorRoleClass, type OrchestratorDecision } from "@/lib/orchestrator-contracts";

// AI Concierge / Orchestrator, Stage 1 -- pure domain validation. No DB,
// no network, no React.

function validDecision(overrides: Partial<OrchestratorDecision> = {}): OrchestratorDecision {
  return {
    intent: "open_clients",
    targetVertical: "clients",
    targetClientId: null,
    targetAnalysisId: null,
    currentContext: { roleClass: "professional", currentClientId: null, currentAnalysisId: null, hasCompletedPhotoPreview: false },
    recommendedAction: "OPEN_CLIENTS",
    availableActions: ["OPEN_CLIENTS"],
    requiresProfessionalApproval: false,
    requiresUserConsent: false,
    costClass: "NO_INCREMENTAL_COST",
    reasonCode: "no_client_selected",
    nextStepCode: "no_client_selected",
    ...overrides,
  };
}

describe("resolveOrchestratorRoleClass", () => {
  it("maps professional and salon to the professional role class", () => {
    expect(resolveOrchestratorRoleClass("professional")).toBe("professional");
    expect(resolveOrchestratorRoleClass("salon")).toBe("professional");
  });

  it("maps consumer to the public role class", () => {
    expect(resolveOrchestratorRoleClass("consumer")).toBe("public");
  });
});

describe("isOrchestratorDecision -- the runtime boundary (task section 2/3)", () => {
  it("accepts a genuinely well-formed decision", () => {
    expect(isOrchestratorDecision(validDecision())).toBe(true);
  });

  it("accepts a decision with recommendedAction null and empty availableActions (an honest 'unsupported' answer)", () => {
    expect(isOrchestratorDecision(validDecision({ recommendedAction: null, availableActions: [] }))).toBe(true);
  });

  it("rejects null/undefined/non-object input", () => {
    expect(isOrchestratorDecision(null)).toBe(false);
    expect(isOrchestratorDecision(undefined)).toBe(false);
    expect(isOrchestratorDecision("a string")).toBe(false);
    expect(isOrchestratorDecision(42)).toBe(false);
  });

  it("rejects an invented action id -- exactly the 'LLM invents a route name' case task section 3 exists to prevent", () => {
    expect(isOrchestratorDecision(validDecision({ recommendedAction: "DELETE_EVERYTHING" as never }))).toBe(false);
    expect(isOrchestratorDecision(validDecision({ availableActions: ["DELETE_EVERYTHING"] as never }))).toBe(false);
  });

  it("rejects an unknown intent value", () => {
    expect(isOrchestratorDecision(validDecision({ intent: "do_anything_i_want" as never }))).toBe(false);
  });

  it("rejects an unknown costClass value", () => {
    expect(isOrchestratorDecision(validDecision({ costClass: "FREE" as never }))).toBe(false);
  });

  it("rejects an unknown reasonCode/nextStepCode value", () => {
    expect(isOrchestratorDecision(validDecision({ reasonCode: "made_up_reason" as never }))).toBe(false);
    expect(isOrchestratorDecision(validDecision({ nextStepCode: "made_up_reason" as never }))).toBe(false);
  });

  it("rejects a malformed currentContext (missing/wrong-typed fields)", () => {
    expect(isOrchestratorDecision(validDecision({ currentContext: { roleClass: "professional" } as never }))).toBe(false);
    expect(isOrchestratorDecision(validDecision({ currentContext: { ...validDecision().currentContext, roleClass: "admin" } as never }))).toBe(false);
  });

  it("rejects availableActions that is not an array", () => {
    expect(isOrchestratorDecision(validDecision({ availableActions: "OPEN_CLIENTS" as never }))).toBe(false);
  });

  it("rejects wrong-typed requiresProfessionalApproval/requiresUserConsent", () => {
    expect(isOrchestratorDecision(validDecision({ requiresProfessionalApproval: "yes" as never }))).toBe(false);
    expect(isOrchestratorDecision(validDecision({ requiresUserConsent: 1 as never }))).toBe(false);
  });

  it("rejects targetClientId/targetAnalysisId that are neither null nor a string", () => {
    expect(isOrchestratorDecision(validDecision({ targetClientId: 123 as never }))).toBe(false);
    expect(isOrchestratorDecision(validDecision({ targetAnalysisId: {} as never }))).toBe(false);
  });
});
