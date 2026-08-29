import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const repositoryMock = vi.hoisted(() => {
  class TechnicalVisualMapSpatialBindingPersistenceError extends Error {
    readonly code = "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PERSISTENCE_UNAVAILABLE";
    readonly httpStatus = 503;
    constructor() {
      super("unavailable");
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
      super("conflict");
      this.name = "TechnicalVisualMapSpatialBindingConcurrencyError";
    }
  }
  return {
    TechnicalVisualMapSpatialBindingPersistenceError,
    TechnicalVisualMapSpatialBindingDependencyError,
    TechnicalVisualMapSpatialBindingValidationError,
    TechnicalVisualMapSpatialBindingStateError,
    TechnicalVisualMapSpatialBindingConcurrencyError,
    findSpatialBindingForOwner: vi.fn(),
    applySpatialBindingEdits: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-visual-map-spatial-binding-repository", () => repositoryMock);

import { GET, PATCH } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };
const BINDING = { id: "binding-1", clientId: "client-1", technicalVisualMapId: "map-1", status: "DRAFT", payload: { zones: [], perimeter: { state: "not_placed" } } };

const OP = { op: "set_zone_anchor", zone: "nape", x: 0.4, y: 0.6 };

function ctx(id = "client-1", proposalId = "proposal-1", mapId = "map-1", bindingId = "binding-1") {
  return { params: Promise.resolve({ id, proposalId, mapId, bindingId }) };
}
function getReq(): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/spatial-bindings/binding-1");
}
function patchReq(body: unknown): Request {
  return new Request("http://localhost/api/v1/clients/client-1/analysis-proposals/proposal-1/technical-visual-maps/map-1/spatial-bindings/binding-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findSpatialBindingForOwner.mockResolvedValue(BINDING);
  repositoryMock.applySpatialBindingEdits.mockResolvedValue({ ...BINDING, payload: { zones: [OP], perimeter: { state: "not_placed" } } });
});

describe("GET .../spatial-bindings/[bindingId]", () => {
  it("returns 401 without a session", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(401);
  });

  it("60. owner can read their own binding", async () => {
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.findSpatialBindingForOwner).toHaveBeenCalledWith("owner-1", "binding-1");
    expect(await response.json()).toEqual({ binding: BINDING });
  });

  it("returns the byte-identical generic 404 for a foreign owner, foreign client, or foreign map (no discovery oracle)", async () => {
    repositoryMock.findSpatialBindingForOwner.mockResolvedValueOnce(null);
    const absent = await GET(getReq(), ctx());
    const absentBody = await absent.json();

    repositoryMock.findSpatialBindingForOwner.mockResolvedValueOnce({ ...BINDING, clientId: "someone-elses-client" });
    const foreignClient = await GET(getReq(), ctx());

    repositoryMock.findSpatialBindingForOwner.mockResolvedValueOnce({ ...BINDING, technicalVisualMapId: "someone-elses-map" });
    const foreignMap = await GET(getReq(), ctx());

    expect(foreignClient.status).toBe(absent.status);
    expect(foreignMap.status).toBe(absent.status);
    expect(await foreignClient.json()).toEqual(absentBody);
    expect(await foreignMap.json()).toEqual(absentBody);
  });

  it("fails closed with a no-store 503 on persistence failure", async () => {
    repositoryMock.findSpatialBindingForOwner.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingPersistenceError());
    const response = await GET(getReq(), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("PATCH .../spatial-bindings/[bindingId]", () => {
  it("returns 401 without a session, touching nothing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await PATCH(patchReq({ operations: [OP] }), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.applySpatialBindingEdits).not.toHaveBeenCalled();
  });

  it("blocks a foreign binding with 404, never calling applySpatialBindingEdits", async () => {
    repositoryMock.findSpatialBindingForOwner.mockResolvedValue(null);
    const response = await PATCH(patchReq({ operations: [OP] }), ctx());
    expect(response.status).toBe(404);
    expect(repositoryMock.applySpatialBindingEdits).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{oops" }),
      ctx(),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when operations is missing, empty, or not an array", async () => {
    for (const body of [{}, { operations: [] }, { operations: "nope" }]) {
      const response = await PATCH(patchReq(body), ctx());
      expect(response.status).toBe(400);
    }
    expect(repositoryMock.applySpatialBindingEdits).not.toHaveBeenCalled();
  });

  it("62. a valid typed PATCH forwards the exact operations array", async () => {
    const response = await PATCH(patchReq({ operations: [OP] }), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.applySpatialBindingEdits).toHaveBeenCalledWith("owner-1", "binding-1", [OP]);
  });

  it("63. invalid geometry is rejected by the domain layer's own validation, mapped to 422", async () => {
    repositoryMock.applySpatialBindingEdits.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingValidationError(
        "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_EDIT_OPERATION",
        "One or more edit operations are malformed.",
      ),
    );
    const response = await PATCH(patchReq({ operations: [{ op: "set_zone_anchor", zone: "nape", x: 5, y: 0.5 }] }), ctx());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_INVALID_EDIT_OPERATION");
  });

  it("64. editing a CONFIRMED binding is rejected with 409", async () => {
    repositoryMock.applySpatialBindingEdits.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingStateError("CONFIRMED", "adjust", "Spatial binding is CONFIRMED; only a DRAFT binding can be edited."),
    );
    const response = await PATCH(patchReq({ operations: [OP] }), ctx());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_ILLEGAL_STATE_TRANSITION");
  });

  it("returns 404 defensively when applySpatialBindingEdits resolves null", async () => {
    repositoryMock.applySpatialBindingEdits.mockResolvedValue(null);
    const response = await PATCH(patchReq({ operations: [OP] }), ctx());
    expect(response.status).toBe(404);
  });

  it("fails closed with a no-store 503 on persistence failure", async () => {
    repositoryMock.applySpatialBindingEdits.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingPersistenceError());
    const response = await PATCH(patchReq({ operations: [OP] }), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
