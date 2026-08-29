import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const tvmRepositoryMock = vi.hoisted(() => ({ findMapForOwner: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalVisualMapSpatialBindingPersistenceError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("Technical Visual Map spatial binding data is temporarily unavailable.");
      this.name = "TechnicalVisualMapSpatialBindingPersistenceError";
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
      super("Spatial binding could not be confirmed because of a concurrent confirmation.");
      this.name = "TechnicalVisualMapSpatialBindingConcurrencyError";
    }
  }
  return {
    TechnicalVisualMapSpatialBindingPersistenceError,
    TechnicalVisualMapSpatialBindingDependencyError,
    TechnicalVisualMapSpatialBindingValidationError,
    TechnicalVisualMapSpatialBindingStateError,
    TechnicalVisualMapSpatialBindingConcurrencyError,
    createDraftSpatialBinding: vi.fn(),
    listSpatialBindingsForMap: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-visual-map-repository", () => tvmRepositoryMock);
vi.mock("@/lib/technical-visual-map-spatial-binding-repository", () => repositoryMock);

import { GET, POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };
const MAP = { id: "map-1", clientId: "client-1", analysisProposalId: "proposal-1", status: "CONFIRMED" };
const BINDING_A = { id: "binding-2", technicalVisualMapId: "map-1", clientId: "client-1", status: "CONFIRMED" };
const BINDING_B = { id: "binding-1", technicalVisualMapId: "map-1", clientId: "client-1", status: "SUPERSEDED" };

function ctx(id = "client-1", proposalId = "proposal-1", mapId = "map-1") {
  return { params: Promise.resolve({ id, proposalId, mapId }) };
}
function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/spatial-bindings");
}
function postReq(body?: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/spatial-bindings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  tvmRepositoryMock.findMapForOwner.mockResolvedValue(MAP);
  repositoryMock.createDraftSpatialBinding.mockResolvedValue(BINDING_A);
  repositoryMock.listSpatialBindingsForMap.mockResolvedValue([BINDING_A, BINDING_B]);
});

describe("GET .../technical-visual-maps/[mapId]/spatial-bindings", () => {
  it("returns 401 without a session, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.listSpatialBindingsForMap).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent map, never calling the repository", async () => {
    tvmRepositoryMock.findMapForOwner.mockResolvedValue(null);
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(404);
    expect(repositoryMock.listSpatialBindingsForMap).not.toHaveBeenCalled();
  });

  it("59. returns the full history for the exact owned map", async () => {
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.listSpatialBindingsForMap).toHaveBeenCalledWith("owner-1", "client-1", "map-1");
    expect(await response.json()).toEqual({ bindings: [BINDING_A, BINDING_B] });
  });

  it("fails closed with a no-store 503 on persistence failure", async () => {
    repositoryMock.listSpatialBindingsForMap.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingPersistenceError());
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST .../technical-visual-maps/[mapId]/spatial-bindings", () => {
  it("52. authenticated create succeeds and forwards exactly the minimum legitimate fields", async () => {
    const response = await POST(postReq({ sourceImageAssetId: "asset-1", viewLabel: "front" }), ctx());
    expect(response.status).toBe(201);
    expect(repositoryMock.createDraftSpatialBinding).toHaveBeenCalledWith("owner-1", "client-1", "map-1", "asset-1", "front");
    expect(await response.json()).toEqual({ binding: BINDING_A });
  });

  it("53. unauthenticated is blocked, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await POST(postReq({ sourceImageAssetId: "asset-1", viewLabel: "front" }), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.createDraftSpatialBinding).not.toHaveBeenCalled();
  });

  it("54. a foreign/nonexistent map is blocked with 404, never calling the repository", async () => {
    tvmRepositoryMock.findMapForOwner.mockResolvedValue(null);
    const response = await POST(postReq({ sourceImageAssetId: "asset-1", viewLabel: "front" }), ctx());
    expect(response.status).toBe(404);
    expect(repositoryMock.createDraftSpatialBinding).not.toHaveBeenCalled();
  });

  it("55. a foreign/inaccessible source asset is rejected via the repository's own dependency error", async () => {
    repositoryMock.createDraftSpatialBinding.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingDependencyError("TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_NOT_FOUND", 404, "Source image not found."),
    );
    const response = await POST(postReq({ sourceImageAssetId: "asset-1", viewLabel: "front" }), ctx());
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_ASSET_NOT_FOUND");
  });

  it("56. dimensions-unavailable is mapped safely with the exact documented stable code", async () => {
    repositoryMock.createDraftSpatialBinding.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingDependencyError(
        "TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE",
        422,
        "Image asset has no recorded dimensions.",
      ),
    );
    const response = await POST(postReq({ sourceImageAssetId: "asset-1", viewLabel: "front" }), ctx());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_SPATIAL_SOURCE_DIMENSIONS_UNAVAILABLE");
  });

  it("57/58. reads no field beyond sourceImageAssetId/viewLabel -- frozen snapshot, version, status, payload cannot be injected", async () => {
    const response = await POST(
      postReq({
        sourceImageAssetId: "asset-1",
        viewLabel: "front",
        ownerUserId: "attacker-owner",
        clientId: "attacker-client",
        frozenWidth: 9999,
        frozenHeight: 9999,
        frozenOrientation: 99,
        frozenContentSha256: "a".repeat(64),
        spatialVersion: 999,
        geometrySchemaVersion: "9.9.9",
        status: "CONFIRMED",
        payload: { zones: [], perimeter: { state: "placed" } },
      }),
      ctx(),
    );
    expect(response.status).toBe(201);
    expect(repositoryMock.createDraftSpatialBinding).toHaveBeenCalledWith("owner-1", "client-1", "map-1", "asset-1", "front");
    expect(repositoryMock.createDraftSpatialBinding).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when sourceImageAssetId or viewLabel is missing", async () => {
    const missingAsset = await POST(postReq({ viewLabel: "front" }), ctx());
    expect(missingAsset.status).toBe(400);
    const missingView = await POST(postReq({ sourceImageAssetId: "asset-1" }), ctx());
    expect(missingView.status).toBe(400);
    expect(repositoryMock.createDraftSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(
      new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" }),
      ctx(),
    );
    expect(response.status).toBe(400);
  });

  it("fails closed with a no-store 503 on persistence failure", async () => {
    repositoryMock.createDraftSpatialBinding.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingPersistenceError());
    const response = await POST(postReq({ sourceImageAssetId: "asset-1", viewLabel: "front" }), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
