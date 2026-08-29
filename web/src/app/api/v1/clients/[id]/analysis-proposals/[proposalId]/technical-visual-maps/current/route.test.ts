import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const proposalRepositoryMock = vi.hoisted(() => ({ findProposalForOwner: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalVisualMapPersistenceError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Visual Map data is temporarily unavailable.");
      this.name = "TechnicalVisualMapPersistenceError";
    }
  }
  class TechnicalVisualMapInvariantError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_CONFIRMED_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalVisualMapInvariantError";
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
    TechnicalVisualMapInvariantError,
    TechnicalVisualMapDependencyError,
    TechnicalVisualMapValidationError,
    TechnicalVisualMapStateError,
    TechnicalVisualMapConcurrencyError,
    findCurrentConfirmedMap: vi.fn(),
    resolveEffectiveMapForRecord: vi.fn((record: { id: string }) => ({ effectiveOf: record.id })),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/proposal-repository", () => proposalRepositoryMock);
vi.mock("@/lib/technical-visual-map-repository", () => repositoryMock);

import { GET } from "./route";

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
const CURRENT_MAP = { id: "map-2", analysisProposalId: "proposal-1", clientId: "client-1", status: "CONFIRMED" };

function ctx(id = "client-1", proposalId = "proposal-1") {
  return { params: Promise.resolve({ id, proposalId }) };
}

function req(): Request {
  return new Request(
    "http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/current",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  proposalRepositoryMock.findProposalForOwner.mockResolvedValue(PROPOSAL);
  repositoryMock.findCurrentConfirmedMap.mockResolvedValue(CURRENT_MAP);
});

describe("GET .../technical-visual-maps/current", () => {
  it("returns 401 without a session, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(req(), ctx());

    expect(response.status).toBe(401);
    expect(repositoryMock.findCurrentConfirmedMap).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(req(), ctx());

    expect(response.status).toBe(404);
    expect(repositoryMock.findCurrentConfirmedMap).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent proposal, without calling findCurrentConfirmedMap", async () => {
    proposalRepositoryMock.findProposalForOwner.mockResolvedValue(null);

    const response = await GET(req(), ctx());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Proposal not found.");
    expect(repositoryMock.findCurrentConfirmedMap).not.toHaveBeenCalled();
  });

  it("22. returns 200 with { map: null, effectiveMap: null } when no map is confirmed yet -- never a 404", async () => {
    repositoryMock.findCurrentConfirmedMap.mockResolvedValue(null);

    const response = await GET(req(), ctx());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ map: null, effectiveMap: null });
  });

  it("23. returns the exact current CONFIRMED map, sourced from the Stage 2 current-confirmed resolver using the proposal's own vertical", async () => {
    const response = await GET(req(), ctx());

    expect(response.status).toBe(200);
    expect(repositoryMock.findCurrentConfirmedMap).toHaveBeenCalledWith("owner-1", "client-1", "proposal-1", "cutting");
    expect(await response.json()).toEqual({ map: CURRENT_MAP, effectiveMap: { effectiveOf: "map-2" } });
  });

  it("24. never selects a 'latest' row ad hoc -- the route calls no function other than findCurrentConfirmedMap to determine authority", async () => {
    await GET(req(), ctx());
    expect(repositoryMock.findCurrentConfirmedMap).toHaveBeenCalledTimes(1);
  });

  it("25. a SUPERSEDED map is never returned as current -- if the repository (correctly) reports none, the route reports none", async () => {
    // The repository itself is the authority for excluding SUPERSEDED rows;
    // this test proves the route does not second-guess or override a null
    // result with some other lookup.
    repositoryMock.findCurrentConfirmedMap.mockResolvedValue(null);

    const response = await GET(req(), ctx());

    expect(await response.json()).toEqual({ map: null, effectiveMap: null });
  });

  it("re-throws TechnicalVisualMapInvariantError (the impossible >1 CONFIRMED state) rather than fabricating a result", async () => {
    repositoryMock.findCurrentConfirmedMap.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapInvariantError("Found 2 CONFIRMED maps -- should be impossible."),
    );

    await expect(GET(req(), ctx())).rejects.toThrow(/Found 2 CONFIRMED/);
  });

  it("fails closed with a no-store 503 when persistence is unavailable", async () => {
    repositoryMock.findCurrentConfirmedMap.mockRejectedValue(new repositoryMock.TechnicalVisualMapPersistenceError());

    const response = await GET(req(), ctx());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
