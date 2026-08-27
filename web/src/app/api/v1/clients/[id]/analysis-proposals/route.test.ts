import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const analysisRepositoryMock = vi.hoisted(() => ({
  findAnalysisForOwner: vi.fn(),
  isAnalysisPersistenceError: vi.fn((_error: unknown) => false),
  analysisPersistenceUnavailableResponse: vi.fn(() =>
    Response.json(
      { error: "ANALYSIS_PERSISTENCE_UNAVAILABLE", message: "Analysis data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    ),
  ),
}));
const proposalRepositoryMock = vi.hoisted(() => {
  class ProposalPersistenceError extends Error {
    readonly code = "PROPOSAL_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Proposal data is temporarily unavailable.");
      this.name = "ProposalPersistenceError";
    }
  }
  class ProposalDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "ProposalDependencyError";
    }
  }
  class ProposalValidationError extends Error {
    readonly httpStatus = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProposalValidationError";
    }
  }
  class ProposalStateError extends Error {
    readonly code = "PROPOSAL_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "edit" | "reject" | "confirm",
      message: string,
    ) {
      super(message);
      this.name = "ProposalStateError";
    }
  }
  class ProposalConcurrencyError extends Error {
    readonly code = "PROPOSAL_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Proposal could not be confirmed because of a concurrent confirmation.");
      this.name = "ProposalConcurrencyError";
    }
  }
  return {
    ProposalPersistenceError,
    ProposalDependencyError,
    ProposalValidationError,
    ProposalStateError,
    ProposalConcurrencyError,
    createProposalForOwner: vi.fn(),
    listProposalsForOwner: vi.fn(),
  };
});
const assemblerMock = vi.hoisted(() => {
  class ProposalAssemblyError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProposalAssemblyError";
    }
  }
  return {
    ProposalAssemblyError,
    assembleCuttingProposalCreationInput: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/analysis-repository", () => analysisRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);
vi.mock("@/lib/proposal-assembler", () => assemblerMock);

import { GET, POST } from "./route";

const ROUTE_SOURCE = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

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
const ANALYSIS = { id: "analysis-1", clientId: "client-1" };
const ASSEMBLED = {
  payload: { version: "cutting-engine@2026-01", structuralTechnique: "graduation" },
  evidenceSnapshot: {
    observations: { hairType: "medium", density: "high", porosity: "low" },
    derivedSafety: { safetyNotes: [], contraindications: [] },
  },
  engineVersion: "cutting-engine@2026-01",
  // The route must NEVER forward these two onward as `extras`.
  sourceImageAssetId: "asset-from-assembler",
  sourceImageAnalysisId: "img-analysis-from-assembler",
};
const PROPOSAL = {
  id: "proposal-1",
  clientId: "client-1",
  analysisId: "analysis-1",
  vertical: "cutting",
  status: "DRAFT",
};

const params = { params: Promise.resolve({ id: "client-1" }) };

function getReq(query = "?vertical=cutting"): Request {
  return new Request(`http://localhost/api/v1/clients/client-1/analysis-proposals${query}`);
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  analysisRepositoryMock.findAnalysisForOwner.mockResolvedValue(ANALYSIS);
  analysisRepositoryMock.isAnalysisPersistenceError.mockReturnValue(false);
  assemblerMock.assembleCuttingProposalCreationInput.mockReturnValue(ASSEMBLED);
  proposalRepositoryMock.listProposalsForOwner.mockResolvedValue([]);
  proposalRepositoryMock.createProposalForOwner.mockResolvedValue(PROPOSAL);
});

describe("GET /api/v1/clients/[id]/analysis-proposals (history)", () => {
  it("returns 401 without a session and never touches the domain layer", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), params);

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.listProposalsForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before any history read", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), params);

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.listProposalsForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 PROPOSAL_INVALID_VERTICAL when the vertical query param is missing", async () => {
    const response = await GET(getReq(""), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_VERTICAL");
    expect(proposalRepositoryMock.listProposalsForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 PROPOSAL_INVALID_VERTICAL when the vertical query param is not supported", async () => {
    const response = await GET(getReq("?vertical=coloring"), params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_VERTICAL");
    expect(proposalRepositoryMock.listProposalsForOwner).not.toHaveBeenCalled();
  });

  it("returns 200 with the owner+client+vertical scoped history passed straight through", async () => {
    const history = [
      { id: "p2", clientId: "client-1", status: "DRAFT" },
      { id: "p1", clientId: "client-1", status: "REJECTED" },
    ];
    proposalRepositoryMock.listProposalsForOwner.mockResolvedValue(history);

    const response = await GET(getReq("?vertical=cutting"), params);

    expect(response.status).toBe(200);
    expect(proposalRepositoryMock.listProposalsForOwner).toHaveBeenCalledWith("owner-1", "client-1", "cutting");
    expect(await response.json()).toEqual({ proposals: history });
  });

  it("fails closed with a no-store 503 when proposal persistence is unavailable", async () => {
    proposalRepositoryMock.listProposalsForOwner.mockRejectedValue(new proposalRepositoryMock.ProposalPersistenceError());

    const response = await GET(getReq("?vertical=cutting"), params);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/v1/clients/[id]/analysis-proposals (create DRAFT)", () => {
  it("returns 401 without a session and never touches the domain layer", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(analysisRepositoryMock.findAnalysisForOwner).not.toHaveBeenCalled();
    expect(assemblerMock.assembleCuttingProposalCreationInput).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client BEFORE any analysis load or proposal write", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(404);
    expect(analysisRepositoryMock.findAnalysisForOwner).not.toHaveBeenCalled();
    expect(assemblerMock.assembleCuttingProposalCreationInput).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 when analysisId or vertical is missing, without any domain work", async () => {
    const response = await POST(postReq({ analysisId: "analysis-1" }), params);

    expect(response.status).toBe(400);
    expect(analysisRepositoryMock.findAnalysisForOwner).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const badRequest = new Request("http://localhost/api/v1/clients/client-1/analysis-proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    const response = await POST(badRequest, params);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid request body.");
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 422 PROPOSAL_INVALID_VERTICAL for an unsupported vertical, before loading any analysis", async () => {
    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "coloring" }), params);

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_VERTICAL");
    expect(analysisRepositoryMock.findAnalysisForOwner).not.toHaveBeenCalled();
    expect(assemblerMock.assembleCuttingProposalCreationInput).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 404 PROPOSAL_ANALYSIS_NOT_FOUND for a foreign/nonexistent analysis, without assembling or writing", async () => {
    analysisRepositoryMock.findAnalysisForOwner.mockResolvedValue(null);

    const response = await POST(postReq({ analysisId: "missing", vertical: "cutting" }), params);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("PROPOSAL_ANALYSIS_NOT_FOUND");
    expect(assemblerMock.assembleCuttingProposalCreationInput).not.toHaveBeenCalled();
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("returns 503 (no-store) when the analysis load reports persistence unavailable", async () => {
    const failure = new Error("db down");
    analysisRepositoryMock.findAnalysisForOwner.mockRejectedValue(failure);
    analysisRepositoryMock.isAnalysisPersistenceError.mockImplementation((error: unknown) => error === failure);

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("maps an assembler ProposalAssemblyError to 422 and never calls createProposalForOwner", async () => {
    assemblerMock.assembleCuttingProposalCreationInput.mockImplementation(() => {
      throw new assemblerMock.ProposalAssemblyError(
        "PROPOSAL_ASSEMBLY_MISSING_PLAN",
        "Analysis analysis-1 has no technicalCutPlan; a cutting proposal cannot be created from it.",
      );
    });

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("PROPOSAL_ASSEMBLY_MISSING_PLAN");
    // The read happened; no mutation, no engine/AI call.
    expect(analysisRepositoryMock.findAnalysisForOwner).toHaveBeenCalledTimes(1);
    expect(proposalRepositoryMock.createProposalForOwner).not.toHaveBeenCalled();
  });

  it("only ever touches analysis-repository through the read findAnalysisForOwner -- no write/mutation/engine import", () => {
    expect(Object.keys(analysisRepositoryMock).sort()).toEqual([
      "analysisPersistenceUnavailableResponse",
      "findAnalysisForOwner",
      "isAnalysisPersistenceError",
    ]);
    expect(ROUTE_SOURCE).toContain("findAnalysisForOwner");
    expect(ROUTE_SOURCE).not.toMatch(
      /createAnalysisForOwner|applyAnalysisCorrection|updateAnalysis|persistAnalysis|deleteAnalysis|clarifyAnalysis|recomputePlans|analysis-engine/,
    );
  });

  it("on success returns 201 { proposal } and calls createProposalForOwner with extras EXACTLY {} (image ids never forwarded)", async () => {
    const response = await POST(
      postReq({
        analysisId: "analysis-1",
        vertical: "cutting",
        // Values a caller must never be able to influence:
        sourceImageAssetId: "attacker-asset",
        sourceImageAnalysisId: "attacker-img-analysis",
      }),
      params,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ proposal: PROPOSAL });

    expect(proposalRepositoryMock.createProposalForOwner).toHaveBeenCalledTimes(1);
    const callArgs = proposalRepositoryMock.createProposalForOwner.mock.calls[0];
    expect(callArgs).toEqual([
      "owner-1",
      "client-1",
      "analysis-1",
      "cutting",
      ASSEMBLED.payload,
      ASSEMBLED.evidenceSnapshot,
      ASSEMBLED.engineVersion,
      {},
    ]);
    // 8th positional argument (extras) is exactly an empty object -- neither the
    // assembler output nor the request body leaks sourceImageAssetId /
    // sourceImageAnalysisId into it.
    expect(callArgs[7]).toEqual({});
    expect(Object.keys(callArgs[7] as Record<string, unknown>)).toHaveLength(0);
  });

  it("maps createProposalForOwner's ProposalDependencyError(PROPOSAL_ANALYSIS_CLIENT_MISMATCH, 404) to a 404 with that exact code", async () => {
    proposalRepositoryMock.createProposalForOwner.mockRejectedValue(
      new proposalRepositoryMock.ProposalDependencyError(
        "PROPOSAL_ANALYSIS_CLIENT_MISMATCH",
        404,
        "Analysis does not belong to this client.",
      ),
    );

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("PROPOSAL_ANALYSIS_CLIENT_MISMATCH");
  });

  it("maps a ProposalValidationError from createProposalForOwner to its own 422", async () => {
    proposalRepositoryMock.createProposalForOwner.mockRejectedValue(
      new proposalRepositoryMock.ProposalValidationError("PROPOSAL_INVALID_PAYLOAD", "payload is not a structurally valid \"cutting\" plan."),
    );

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("PROPOSAL_INVALID_PAYLOAD");
  });

  it("fails closed with a no-store 503 when createProposalForOwner reports persistence unavailable", async () => {
    proposalRepositoryMock.createProposalForOwner.mockRejectedValue(new proposalRepositoryMock.ProposalPersistenceError());

    const response = await POST(postReq({ analysisId: "analysis-1", vertical: "cutting" }), params);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
