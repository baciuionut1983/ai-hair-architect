import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const tvmRepositoryMock = vi.hoisted(() => ({ findMapForOwner: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalVisualMapSpatialBindingPersistenceError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("unavailable");
      this.name = "TechnicalVisualMapSpatialBindingPersistenceError";
    }
  }
  class TechnicalVisualMapSpatialBindingInvariantError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMED_INVARIANT_VIOLATED";
    readonly httpStatus = 500;
    constructor(message: string) {
      super(message);
      this.name = "TechnicalVisualMapSpatialBindingInvariantError";
    }
  }
  class TechnicalVisualMapSpatialBindingDependencyError extends Error {
    constructor(
      readonly code: string,
      readonly httpStatus: number,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapSpatialBindingDependencyError";
    }
  }
  class TechnicalVisualMapSpatialBindingValidationError extends Error {
    readonly httpStatus = 422;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapSpatialBindingValidationError";
    }
  }
  class TechnicalVisualMapSpatialBindingStateError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
    constructor(
      readonly fromStatus: string,
      readonly attempted: "adjust" | "confirm",
      message: string,
    ) {
      super(message);
      this.name = "TechnicalVisualMapSpatialBindingStateError";
    }
  }
  class TechnicalVisualMapSpatialBindingConcurrencyError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("conflict");
      this.name = "TechnicalVisualMapSpatialBindingConcurrencyError";
    }
  }
  return {
    TechnicalVisualMapSpatialBindingPersistenceError,
    TechnicalVisualMapSpatialBindingInvariantError,
    TechnicalVisualMapSpatialBindingDependencyError,
    TechnicalVisualMapSpatialBindingValidationError,
    TechnicalVisualMapSpatialBindingStateError,
    TechnicalVisualMapSpatialBindingConcurrencyError,
    findCurrentConfirmedSpatialBinding: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-visual-map-repository", () => tvmRepositoryMock);
vi.mock("@/lib/technical-visual-map-spatial-binding-repository", () => repositoryMock);

import { GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };
const MAP = { id: "map-1", clientId: "client-1", analysisProposalId: "proposal-1", status: "CONFIRMED" };
const CURRENT_BINDING = { id: "binding-1", status: "CONFIRMED" };

function ctx(id = "client-1", proposalId = "proposal-1", mapId = "map-1") {
  return { params: Promise.resolve({ id, proposalId, mapId }) };
}
function req(query = "?sourceImageAssetId=asset-1&viewLabel=front"): Request {
  return new Request(`http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/spatial-bindings/current${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  tvmRepositoryMock.findMapForOwner.mockResolvedValue(MAP);
  repositoryMock.findCurrentConfirmedSpatialBinding.mockResolvedValue(CURRENT_BINDING);
});

describe("GET .../spatial-bindings/current", () => {
  it("returns 401 without a session", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(req(), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.findCurrentConfirmedSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent map", async () => {
    tvmRepositoryMock.findMapForOwner.mockResolvedValue(null);
    const response = await GET(req(), ctx());
    expect(response.status).toBe(404);
    expect(repositoryMock.findCurrentConfirmedSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 400 when sourceImageAssetId is missing", async () => {
    const response = await GET(req("?viewLabel=front"), ctx());
    expect(response.status).toBe(400);
    expect(repositoryMock.findCurrentConfirmedSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid viewLabel", async () => {
    const response = await GET(req("?sourceImageAssetId=asset-1&viewLabel=top_down"), ctx());
    expect(response.status).toBe(400);
    expect(repositoryMock.findCurrentConfirmedSpatialBinding).not.toHaveBeenCalled();
  });

  it("61. resolves current authority using the exact source image + view scope", async () => {
    const response = await GET(req(), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.findCurrentConfirmedSpatialBinding).toHaveBeenCalledWith("owner-1", "client-1", "map-1", "asset-1", "front");
    expect(await response.json()).toEqual({ binding: CURRENT_BINDING });
  });

  it("returns 200 with { binding: null } when nothing is confirmed yet -- never a 404", async () => {
    repositoryMock.findCurrentConfirmedSpatialBinding.mockResolvedValue(null);
    const response = await GET(req(), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ binding: null });
  });

  it("re-throws the invariant error (impossible >1 CONFIRMED state) rather than fabricating a result", async () => {
    repositoryMock.findCurrentConfirmedSpatialBinding.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingInvariantError("Found 2 CONFIRMED bindings -- should be impossible."),
    );
    await expect(GET(req(), ctx())).rejects.toThrow(/Found 2 CONFIRMED/);
  });

  it("fails closed with a no-store 503 on persistence failure", async () => {
    repositoryMock.findCurrentConfirmedSpatialBinding.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingPersistenceError());
    const response = await GET(req(), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
