import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const proposalRepositoryMock = vi.hoisted(() => ({ findProposalForOwner: vi.fn() }));
const assemblerMock = vi.hoisted(() => {
  class TechnicalVisualMapAssemblyError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapAssemblyError";
    }
  }
  return { TechnicalVisualMapAssemblyError };
});
const repositoryMock = vi.hoisted(() => {
  class TechnicalVisualMapPersistenceError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Visual Map data is temporarily unavailable.");
      this.name = "TechnicalVisualMapPersistenceError";
    }
  }
  class TechnicalVisualMapDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapDependencyError";
    }
  }
  class TechnicalVisualMapValidationError extends Error {
    readonly httpStatus = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapValidationError";
    }
  }
  class TechnicalVisualMapStateError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "adjust" | "confirm",
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapStateError";
    }
  }
  class TechnicalVisualMapConcurrencyError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Technical Visual Map could not be confirmed because of a concurrent confirmation.");
      this.name = "TechnicalVisualMapConcurrencyError";
    }
  }
  return {
    TechnicalVisualMapPersistenceError,
    TechnicalVisualMapDependencyError,
    TechnicalVisualMapValidationError,
    TechnicalVisualMapStateError,
    TechnicalVisualMapConcurrencyError,
    createDraftFromConfirmedProposal: vi.fn(),
    listMapsForProposal: vi.fn(),
    resolveEffectiveMapForRecord: vi.fn((record: { id: string }) => ({ effectiveOf: record.id })),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);
vi.mock("@/lib/technical-visual-map-assembler", () => assemblerMock);
vi.mock("@/lib/technical-visual-map-repository", () => repositoryMock);

import { GET, POST } from "./route";

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
const PROPOSAL = { id: "proposal-1", clientId: "client-1", vertical: "cutting", status: "CONFIRMED" };
const MAP_A = { id: "map-2", analysisProposalId: "proposal-1", clientId: "client-1", status: "CONFIRMED", mapVersion: 2 };
const MAP_B = { id: "map-1", analysisProposalId: "proposal-1", clientId: "client-1", status: "SUPERSEDED", mapVersion: 1 };

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps");
}

function postReq(body?: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  repositoryMock.createDraftFromConfirmedProposal.mockResolvedValue(MAP_A);
  repositoryMock.listMapsForProposal.mockResolvedValue([MAP_A, MAP_B]);
});

describe("GET /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-visual-maps", () => {
  it("returns 401 without a session and touches nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(repositoryMock.listMapsForProposal).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client, before resolving the proposal", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect(proposalRepositoryMock.findProposalForOwner).not.toHaveBeenCalled();
  });

  it("18/21. hides history for a foreign or nonexistent proposal with a generic 404, never calling listMapsForProposal", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(repositoryMock.listMapsForProposal).not.toHaveBeenCalled();
  });

  it("18. hides history when the proposal belongs to a different client (byte-identical 404, no discovery oracle)", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce(null);
    const absent = await GET(getReq(), ctx());
    const absentBody = await absent.json();

    proposalRepositoryMock.findProposalForOwner.mockResolvedValueOnce({ ...PROPOSAL, clientId: "someone-elses-client" });
    const foreign = await GET(getReq(), ctx());
    const foreignBody = await foreign.json();

    expect(foreign.status).toBe(absent.status);
    expect(foreignBody).toEqual(absentBody);
    expect(repositoryMock.listMapsForProposal).not.toHaveBeenCalled();
  });

  it("18/19. returns the exact owned proposal's history, in the order the repository returns it, using its own vertical", async () => {
    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.listMapsForProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1", "cutting");
    expect(await response.json()).toEqual({ maps: [MAP_A, MAP_B] });
  });

  it("20. history preserves DRAFT/CONFIRMED/SUPERSEDED rows exactly as the repository returns them", async () => {
    const draft = { ...MAP_A, id: "map-3", status: "DRAFT", mapVersion: 3 };
    repositoryMock.listMapsForProposal.mockResolvedValue([draft, MAP_A, MAP_B]);

    const response = await GET(getReq(), ctx());

    expect(await response.json()).toEqual({ maps: [draft, MAP_A, MAP_B] });
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.listMapsForProposal.mockRejectedValue(new repositoryMock.TechnicalVisualMapPersistenceError());

    const response = await GET(getReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-visual-maps", () => {
  it("1. authenticated owner creates a DRAFT from their owned CONFIRMED cutting proposal", async () => {
    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(201);
    expect(repositoryMock.createDraftFromConfirmedProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1");
    expect(await response.json()).toEqual({ map: MAP_A, effectiveMap: { effectiveOf: "map-2" } });
  });

  it("2. unauthenticated is blocked, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.createDraftFromConfirmedProposal).not.toHaveBeenCalled();
  });

  it("3. foreign/nonexistent client is blocked with 404, never calling the repository", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.createDraftFromConfirmedProposal).not.toHaveBeenCalled();
  });

  it("4. an unknown/foreign-owner proposal is rejected via the repository's own dependency error", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapDependencyError("TECHNICAL_VISUAL_MAP_PROPOSAL_NOT_FOUND", 404, "Proposal not found."),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_PROPOSAL_NOT_FOUND");
  });

  it("5. a proposal/client mismatch is rejected via the repository's own dependency error", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapDependencyError(
        "TECHNICAL_VISUAL_MAP_PROPOSAL_CLIENT_MISMATCH",
        404,
        "Proposal does not belong to this client.",
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_PROPOSAL_CLIENT_MISMATCH");
  });

  it("6. a DRAFT (not yet confirmed) proposal is rejected with 422 via the propagated assembly error", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(
      new assemblerMock.TechnicalVisualMapAssemblyError(
        "TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED",
        "Proposal proposal-1 is DRAFT; a Technical Visual Map can only be assembled from a CONFIRMED proposal.",
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED");
  });

  it("7. a SUPERSEDED proposal is rejected with the same 422 assembly error (Stage 2 marks it ineligible)", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(
      new assemblerMock.TechnicalVisualMapAssemblyError(
        "TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED",
        "Proposal proposal-1 is SUPERSEDED; a Technical Visual Map can only be assembled from a CONFIRMED proposal.",
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED");
  });

  it("8. an unsupported vertical is rejected with 422", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(
      new assemblerMock.TechnicalVisualMapAssemblyError(
        "TECHNICAL_VISUAL_MAP_ASSEMBLY_UNSUPPORTED_VERTICAL",
        'Proposal proposal-1 has vertical "color"; Technical Visual Map Stage 2 only supports "cutting".',
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_UNSUPPORTED_VERTICAL");
  });

  it("9. a malformed confirmed payload is rejected safely with 422, not a 500", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(
      new assemblerMock.TechnicalVisualMapAssemblyError(
        "TECHNICAL_VISUAL_MAP_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN",
        "Proposal proposal-1's effective technical cut plan failed structural validation.",
      ),
    );

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN");
  });

  it("10/11/12. reads no request body at all -- payload/source asset ids/mapVersion/schemaVersion/generatorVersion in the body are structurally impossible to inject", async () => {
    const response = await POST(
      postReq({
        payload: { structuralTechnique: "one_length" },
        sourceImageAssetId: "attacker-asset",
        sourceImageAnalysisId: "attacker-analysis",
        mapVersion: 999,
        schemaVersion: "9.9.9",
        generatorVersion: "9.9.9-evil",
        professionalAdjustments: [{ target: "zone_preserve" }],
      }),
      ctx(),
    );

    expect(response.status).toBe(201);
    // Called with exactly three primitive identity arguments -- nothing from
    // the request body was ever read or forwarded.
    expect(repositoryMock.createDraftFromConfirmedProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1");
    expect(repositoryMock.createDraftFromConfirmedProposal).toHaveBeenCalledTimes(1);
  });

  it("10/11/12b. a request with NO body at all (undefined) behaves identically -- the body is never required or read", async () => {
    const response = await POST(postReq(undefined), ctx());

    expect(response.status).toBe(201);
    expect(repositoryMock.createDraftFromConfirmedProposal).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1");
  });

  it("fails closed with a no-store 503 when the repository reports persistence unavailable", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(new repositoryMock.TechnicalVisualMapPersistenceError());

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("maps a TechnicalVisualMapConcurrencyError generically (exhausted allocation retries), not the confirm-only override", async () => {
    repositoryMock.createDraftFromConfirmedProposal.mockRejectedValue(new repositoryMock.TechnicalVisualMapConcurrencyError());

    const response = await POST(postReq(), ctx());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_CONCURRENCY_CONFLICT");
  });
});
