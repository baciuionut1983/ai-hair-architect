import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalDemonstrationPersistenceError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Demonstration data is temporarily unavailable.");
      this.name = "TechnicalDemonstrationPersistenceError";
    }
  }
  class TechnicalDemonstrationDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalDemonstrationDependencyError";
    }
  }
  class TechnicalDemonstrationValidationError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVALID_DERIVED_PAYLOAD";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationValidationError";
    }
  }
  class TechnicalDemonstrationOverrideValidationError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVALID_OVERRIDE";
    readonly httpStatus = 422;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationOverrideValidationError";
    }
  }
  class TechnicalDemonstrationStateError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "confirm" | "adjust",
      message: string,
    ) {
      super(message);
      this.name = "TechnicalDemonstrationStateError";
    }
  }
  class TechnicalDemonstrationConcurrencyError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Technical Demonstration Plan could not be confirmed because of a concurrent confirmation.");
      this.name = "TechnicalDemonstrationConcurrencyError";
    }
  }
  class TechnicalDemonstrationInvariantError extends Error {
    readonly code = "TECHNICAL_DEMONSTRATION_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalDemonstrationInvariantError";
    }
  }
  return {
    TechnicalDemonstrationPersistenceError,
    TechnicalDemonstrationDependencyError,
    TechnicalDemonstrationValidationError,
    TechnicalDemonstrationOverrideValidationError,
    TechnicalDemonstrationStateError,
    TechnicalDemonstrationConcurrencyError,
    TechnicalDemonstrationInvariantError,
    findTechnicalDemonstrationPlanForOwner: vi.fn(),
    listTechnicalDemonstrationStepsForPlan: vi.fn(),
    // resolveEffectiveCuttingStepsForRecord stays REAL -- this route's own
    // job is to feed real effective steps into the real (also unmocked)
    // coherence engine, so the integration itself must be genuine.
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-demonstration-repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/technical-demonstration-repository")>("@/lib/technical-demonstration-repository");
  return {
    ...actual,
    findTechnicalDemonstrationPlanForOwner: repositoryMock.findTechnicalDemonstrationPlanForOwner,
    listTechnicalDemonstrationStepsForPlan: repositoryMock.listTechnicalDemonstrationStepsForPlan,
    TechnicalDemonstrationPersistenceError: repositoryMock.TechnicalDemonstrationPersistenceError,
    TechnicalDemonstrationDependencyError: repositoryMock.TechnicalDemonstrationDependencyError,
    TechnicalDemonstrationValidationError: repositoryMock.TechnicalDemonstrationValidationError,
    TechnicalDemonstrationOverrideValidationError: repositoryMock.TechnicalDemonstrationOverrideValidationError,
    TechnicalDemonstrationStateError: repositoryMock.TechnicalDemonstrationStateError,
    TechnicalDemonstrationConcurrencyError: repositoryMock.TechnicalDemonstrationConcurrencyError,
    TechnicalDemonstrationInvariantError: repositoryMock.TechnicalDemonstrationInvariantError,
  };
});

import { GET } from "./route";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
import { resolveEffectiveCuttingStepPayload, toCuttingStepOverrideEntry, type CuttingStepOverrideInput } from "@/lib/technical-demonstration-cutting-overrides";
import type { CuttingDemonstrationStepPayload } from "@/lib/technical-demonstration-cutting-contracts";
import type { CuttingStep, TechnicalCutPlan } from "@/lib/contracts";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = {
  id: "client-1",
  ownerUserId: "owner-1",
  fullName: "Jane Doe",
  email: "",
  phone: "",
  notes: "",
  createdAt: "",
  updatedAt: "",
};

function realisticCuttingSteps(): CuttingStep[] {
  return [
    { stepNumber: 1, zone: "Mapping and sectioning", action: "Partition.", elevationAngle: "0_deg_blunt", toolRequired: "tail-comb" },
    { stepNumber: 2, zone: "Baseline guideline", action: "Set guideline.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 3, zone: "Bulk and shape control", action: "Cut.", elevationAngle: "0_deg_blunt", toolRequired: "straight-shear" },
    { stepNumber: 4, zone: "Texture refinement", action: "Texturize.", elevationAngle: "0_deg_blunt", toolRequired: "texturizer-shear" },
    { stepNumber: 5, zone: "Cross-check and finish", action: "Finish.", elevationAngle: "0_deg_blunt", toolRequired: "finishing-comb" },
  ];
}

function cuttingPlan(): TechnicalCutPlan {
  return {
    structuralTechnique: "one_length",
    cuttingTechnique: "blunt_line",
    texturizingTechnique: "slice_and_slide",
    sectioning: "4_quadrant_profile_radial",
    elevation: "0_deg_blunt",
    distribution: "natural_fall",
    guideline: "visual_perimeter",
    cuttingSteps: realisticCuttingSteps(),
    stylistExplanation: "x",
    clientExplanation: "x",
    professionalReason: "x",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.9,
    stylistValidationDisclaimer: "x",
    version: "1.0.0-m8",
  };
}

function realStepRecords() {
  return deriveCuttingDemonstrationSteps(cuttingPlan()).map((derived) => ({
    id: `step-${derived.stepNumber}`,
    ownerUserId: "owner-1",
    clientId: "client-1",
    planId: "plan-1",
    vertical: "cutting" as const,
    stepNumber: derived.stepNumber,
    stepSchemaVersion: "1.1.0-td25a",
    payload: derived.payload as unknown as Record<string, unknown>,
    explanation: derived.explanation,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

// Applies one professional override to ONE step, via the real
// resolveEffectiveCuttingStepPayload -- the same mechanism a production
// override goes through.
function withOverride(steps: ReturnType<typeof realStepRecords>, input: CuttingStepOverrideInput) {
  const entry = toCuttingStepOverrideEntry(input, new Date("2026-01-01T00:00:00.000Z"));
  return steps.map((step) => {
    if (step.stepNumber !== input.stepNumber) return step;
    const effective = resolveEffectiveCuttingStepPayload(step.stepNumber, step.payload as unknown as CuttingDemonstrationStepPayload, [entry]);
    return { ...step, payload: effective as unknown as Record<string, unknown> };
  });
}

const DRAFT_PLAN = {
  id: "plan-1",
  ownerUserId: "owner-1",
  clientId: "client-1",
  analysisProposalId: "proposal-1",
  analysisProposalConfirmedAt: "2026-01-01T00:00:00.000Z",
  vertical: "cutting" as const,
  status: "DRAFT" as const,
  planVersion: 1,
  schemaVersion: "1.1.0-td25a",
  generatorVersion: "1.3.0-td25f2",
  requestFingerprint: "fp-1",
  professionalOverrides: [],
  supersededByPlanId: null,
  confirmedAt: null,
  supersededAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function ctx(id = "client-1", proposalId = "proposal-1", planId = "plan-1") {
  return { params: Promise.resolve({ id, proposalId, planId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1/coherence");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(DRAFT_PLAN);
  repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(realStepRecords());
});

describe("GET .../technical-demonstration-plans/[planId]/coherence", () => {
  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.findTechnicalDemonstrationPlanForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the plan", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findTechnicalDemonstrationPlanForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent/foreign-owner plan id, never leaking another owner's coherence findings", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Technical Demonstration Plan not found.");
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT client than the URL's own id", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, clientId: "someone-elses-client" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  it("returns 404 when a real, owned plan belongs to a DIFFERENT proposal than the URL's own proposalId", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, analysisProposalId: "some-other-proposal" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.listTechnicalDemonstrationStepsForPlan).not.toHaveBeenCalled();
  });

  // Required test 1: server evaluates coherence for the displayed DRAFT plan.
  it("1. evaluates coherence for a DRAFT plan and returns a clean pass for real, unedited derived steps", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coherence).toMatchObject({ planId: "plan-1", planVersion: 1, pass: true, blockers: [], warnings: [], reviewItems: [] });
  });

  // Required test 2: server evaluates coherence for a displayed CONFIRMED plan too.
  it("2. evaluates coherence for a CONFIRMED plan identically -- coherence is not gated by plan status", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, status: "CONFIRMED", confirmedAt: "2026-01-02T00:00:00.000Z" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coherence.pass).toBe(true);
  });

  // Required test 3: correct planId/planVersion in the result.
  it("3. the result identifies the exact plan it was computed for", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, id: "plan-42", planVersion: 7 });

    const response = await GET(getReq(), ctx("client-1", "proposal-1", "plan-42"));
    const body = await response.json();

    expect(body.coherence.planId).toBe("plan-42");
    expect(body.coherence.planVersion).toBe(7);
  });

  // Required test 4: effective professional overrides are evaluated, not the raw baseline.
  it("4. propagates professionalOverrides into the effective coherence result (not the raw baseline)", async () => {
    const steps = withOverride(realStepRecords(), { op: "set_value", stepNumber: 3, field: "actionType", value: "SECTIONING_ACTION" });
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(steps);

    const response = await GET(getReq(), ctx());
    const body = await response.json();

    expect(body.coherence.pass).toBe(false);
    expect(body.coherence.blockers).toHaveLength(1);
    expect(body.coherence.blockers[0].code).toBe("COHERENCE_PHASE_ACTION_TYPE_MISMATCH");
  });

  // Required test 5: the locked real WARNING case.
  it("5. the real One Length + Elevation Cutting + 0 Deg Blunt combination is returned as a WARNING, not a blocker", async () => {
    const steps = withOverride(realStepRecords(), { op: "set_value", stepNumber: 3, field: "cuttingTechnique", value: "elevation_cutting" });
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(steps);

    const response = await GET(getReq(), ctx());
    const body = await response.json();

    expect(body.coherence.blockers).toHaveLength(0);
    expect(body.coherence.warnings).toHaveLength(1);
    expect(body.coherence.warnings[0].code).toBe("COHERENCE_ONE_LENGTH_ELEVATION_CUTTING_ZERO_BLUNT");
    expect(body.coherence.pass).toBe(true);
  });

  // Required test 6: the locked real REVIEW_ONLY case.
  it("6. the real STRUCTURAL_CUTTING + texturizer-shear combination is returned as review-only, not a blocker", async () => {
    const steps = withOverride(realStepRecords(), { op: "set_value", stepNumber: 3, field: "tool", value: "texturizer-shear" });
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(steps);

    const response = await GET(getReq(), ctx());
    const body = await response.json();

    expect(body.coherence.blockers).toHaveLength(0);
    expect(body.coherence.warnings).toHaveLength(0);
    expect(body.coherence.reviewItems).toHaveLength(1);
    expect(body.coherence.reviewItems[0].code).toBe("COHERENCE_STRUCTURAL_CUTTING_TEXTURIZER_SHEAR_TOOL");
  });

  // Required test 7: a real deterministic blocker is returned correctly.
  it("7. a real deterministic phase/actionType blocker is returned with pass=false", async () => {
    const steps = withOverride(realStepRecords(), { op: "set_value", stepNumber: 5, field: "actionType", value: "GUIDE_CUTTING" });
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(steps);

    const response = await GET(getReq(), ctx());
    const body = await response.json();

    expect(body.coherence.pass).toBe(false);
    expect(body.coherence.blockers).toHaveLength(1);
    expect(body.coherence.blockers[0].stepNumber).toBe(5);
  });

  // Required test 8: UNKNOWN/N/A never fabricate a finding.
  it("8. genuinely UNKNOWN fields (the real, unedited baseline) never fabricate a finding", async () => {
    const response = await GET(getReq(), ctx());
    const body = await response.json();

    expect(body.coherence.blockers).toHaveLength(0);
    expect(body.coherence.warnings).toHaveLength(0);
    expect(body.coherence.reviewItems).toHaveLength(0);
  });

  // Required test 17: no production write path -- this module exports GET only.
  it("17. this route module exports GET only -- no write method exists", async () => {
    const routeModule = await import("./route");
    expect(routeModule.GET).toBeInstanceOf(Function);
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined();
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined();
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined();
  });

  // Required test 18: description changes never alter the result -- proven
  // at the route/integration level too, not just inside the pure engine's
  // own test suite.
  it("18. changing a step's free-text explanation never changes the coherence result", async () => {
    const steps = withOverride(realStepRecords(), { op: "set_value", stepNumber: 3, field: "cuttingTechnique", value: "elevation_cutting" });
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(steps);
    const response1 = await GET(getReq(), ctx());
    const body1 = await response1.json();

    const stepsWithDifferentText = steps.map((s) => (s.stepNumber === 3 ? { ...s, explanation: "A completely different sentence." } : s));
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(stepsWithDifferentText);
    const response2 = await GET(getReq(), ctx());
    const body2 = await response2.json();

    expect(body2.coherence).toEqual(body1.coherence);
  });

  it("exposes the current coherence rules version", async () => {
    const response = await GET(getReq(), ctx());
    const body = await response.json();
    expect(body.coherence.coherenceRulesVersion).toBe("1.0.0-coh1");
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
