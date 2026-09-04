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
    // Deliberately the REAL merge function, not mocked -- unlike sibling
    // route.test.ts (which mocks it as a passthrough since it only asserts
    // routing/error-mapping there), THIS route's whole job is to feed real
    // effective steps into the real (also unmocked) readiness evaluator, so
    // the integration itself needs to be genuine, not stubbed.
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
    // resolveEffectiveCuttingStepsForRecord and everything else stay REAL.
  };
});

import { GET } from "./route";
import { deriveCuttingDemonstrationSteps } from "@/lib/technical-demonstration-derivation";
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

const DRAFT_PLAN = {
  id: "plan-1",
  ownerUserId: "owner-1",
  clientId: "client-1",
  analysisProposalId: "proposal-1",
  analysisProposalConfirmedAt: "2026-01-01T00:00:00.000Z",
  vertical: "cutting" as const,
  status: "DRAFT" as const,
  planVersion: 1,
  schemaVersion: "1.0.0-td1",
  generatorVersion: "1.1.0-td25a",
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
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-demonstration-plans/plan-1/readiness");
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue(DRAFT_PLAN);
  repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(realStepRecords());
});

describe("GET .../technical-demonstration-plans/[planId]/readiness", () => {
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

  it("returns 404 for a nonexistent/foreign-owner plan id", async () => {
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

  it("a DRAFT plan is never ready -- 200 with readiness.ready === false and a plan-level not-confirmed reason", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readiness.ready).toBe(false);
    expect(body.readiness.planLevelReasons.some((r: { code: string }) => r.code === "READINESS_PLAN_NOT_CONFIRMED")).toBe(true);
    expect(body.readiness.planId).toBe("plan-1");
    expect(body.readiness.planVersion).toBe(1);
  });

  it("a CONFIRMED plan with genuinely incomplete steps is honestly reported not-ready, with real per-step blocking reasons (never fake completeness)", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({ ...DRAFT_PLAN, status: "CONFIRMED", confirmedAt: "2026-01-02T00:00:00.000Z" });

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    const body = await response.json();
    // Real, unmodified derived steps are always missing stateBefore/
    // stateAfter (Stage 2.5.a's own honest "no source data yet" default) --
    // so a genuinely CONFIRMED-but-unreviewed plan must NOT be reported
    // ready.
    expect(body.readiness.ready).toBe(false);
    expect(body.readiness.planLevelReasons).toHaveLength(0); // it IS confirmed -- the block is step-level
    expect(body.readiness.steps).toHaveLength(2);
    const step1 = body.readiness.steps.find((s: { stepNumber: number }) => s.stepNumber === 1);
    expect(step1.ready).toBe(false);
    expect(step1.reasons.some((r: { field: string }) => r.field === "stateBefore")).toBe(true);
  });

  it("propagates professionalOverrides into the effective readiness result (not the raw baseline)", async () => {
    const steps = realStepRecords();
    repositoryMock.listTechnicalDemonstrationStepsForPlan.mockResolvedValue(steps);
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockResolvedValue({
      ...DRAFT_PLAN,
      status: "CONFIRMED",
      professionalOverrides: [
        { op: "set_value", stepNumber: 1, field: "stateBefore", value: "Dry, detangled.", source: "professional", setAt: "2026-01-02T00:00:00.000Z" },
      ],
    });

    const response = await GET(getReq(), ctx());
    const body = await response.json();

    const step1 = body.readiness.steps.find((s: { stepNumber: number }) => s.stepNumber === 1);
    // stateBefore is now satisfied by the override -- it must not appear
    // among step 1's own remaining reasons, even though step 1 is still
    // not fully ready overall (many other fields remain genuinely UNKNOWN).
    expect(step1.reasons.some((r: { field: string }) => r.field === "stateBefore")).toBe(false);
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.findTechnicalDemonstrationPlanForOwner.mockRejectedValue(new repositoryMock.TechnicalDemonstrationPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
