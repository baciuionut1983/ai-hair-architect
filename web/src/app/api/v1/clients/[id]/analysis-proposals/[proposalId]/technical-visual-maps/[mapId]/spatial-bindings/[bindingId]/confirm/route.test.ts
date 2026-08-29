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
    findSpatialBindingForOwner: vi.fn(),
    confirmSpatialBinding: vi.fn(),
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/technical-visual-map-spatial-binding-repository", () => repositoryMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };
const BINDING = { id: "binding-1", clientId: "client-1", technicalVisualMapId: "map-1", status: "DRAFT" };
const CONFIRMED = { ...BINDING, status: "CONFIRMED", confirmedAt: "2026-08-29T00:00:00.000Z" };

const CONFLICT_BODY = {
  error: "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_CONFIRMATION_CONFLICT",
  message: "Another spatial binding was confirmed for this image and view while this draft was open. Review the current confirmed binding before replacing it.",
};

function ctx(id = "client-1", proposalId = "proposal-1", mapId = "map-1", bindingId = "binding-1") {
  return { params: Promise.resolve({ id, proposalId, mapId, bindingId }) };
}
function req(body: unknown): Request {
  return new Request("http://localhost/api/v1/.../spatial-bindings/binding-1/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function rawReq(rawBody: string): Request {
  return new Request("http://localhost/api/v1/.../spatial-bindings/binding-1/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  repositoryMock.findSpatialBindingForOwner.mockResolvedValue(BINDING);
  repositoryMock.confirmSpatialBinding.mockResolvedValue(CONFIRMED);
});

describe("POST .../spatial-bindings/[bindingId]/confirm", () => {
  it("returns 401 without a session, never resolving the binding or confirming", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(401);
    expect(repositoryMock.confirmSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent binding, without confirming", async () => {
    repositoryMock.findSpatialBindingForOwner.mockResolvedValue(null);
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(404);
    expect(repositoryMock.confirmSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(rawReq("{oops"), ctx());
    expect(response.status).toBe(400);
    expect(repositoryMock.confirmSpatialBinding).not.toHaveBeenCalled();
  });

  it("returns 400 when expectedCurrentConfirmedSpatialBindingId is omitted or malformed", async () => {
    for (const body of [{}, { expectedCurrentConfirmedSpatialBindingId: 1 }, { expectedCurrentConfirmedSpatialBindingId: "" }]) {
      const response = await POST(req(body), ctx());
      expect(response.status).toBe(400);
    }
    expect(repositoryMock.confirmSpatialBinding).not.toHaveBeenCalled();
  });

  it("65. null expectedCurrentConfirmedSpatialBindingId (first confirmation) succeeds and forwards exact arguments", async () => {
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.confirmSpatialBinding).toHaveBeenCalledWith("owner-1", "binding-1", null);
    expect(await response.json()).toEqual({ binding: CONFIRMED });
  });

  it("66. a real prior-confirmed id (intentional replacement) is forwarded as the 3rd argument", async () => {
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: "previously-confirmed-binding" }), ctx());
    expect(response.status).toBe(200);
    expect(repositoryMock.confirmSpatialBinding).toHaveBeenCalledWith("owner-1", "binding-1", "previously-confirmed-binding");
  });

  it("returns 404 defensively when confirmSpatialBinding resolves null", async () => {
    repositoryMock.confirmSpatialBinding.mockResolvedValue(null);
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(404);
  });

  it("67/68/69. a stale confirm maps to the exact dedicated 409, never the repository's own code, and never retries", async () => {
    repositoryMock.confirmSpatialBinding.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingConcurrencyError());

    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(CONFLICT_BODY);
    // The message is the fixed, safe override text -- never the repository's
    // own raw message ("Spatial binding could not be confirmed because of a
    // concurrent confirmation."), and nothing about the winning binding is
    // ever appended to it.
    expect(body.message).not.toBe(new repositoryMock.TechnicalVisualMapSpatialBindingConcurrencyError().message);
    expect(repositoryMock.confirmSpatialBinding).toHaveBeenCalledTimes(1); // no silent retry
  });

  it("produces the byte-identical 409 conflict body regardless of the stated expectation (never an oracle)", async () => {
    repositoryMock.confirmSpatialBinding.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingConcurrencyError());
    const a = await POST(req({ expectedCurrentConfirmedSpatialBindingId: "real-looking-foreign-id-999" }), ctx());
    const b = await POST(req({ expectedCurrentConfirmedSpatialBindingId: "b6e6b9a0-2f1e-4a3a-9c7a-6b6e6b9a02f1" }), ctx());
    expect(await a.json()).toEqual(CONFLICT_BODY);
    expect(await b.json()).toEqual(CONFLICT_BODY);
  });

  it("maps a repeated confirm on an already-CONFIRMED target (state error) to 409, calling confirmSpatialBinding exactly once", async () => {
    repositoryMock.confirmSpatialBinding.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingStateError("CONFIRMED", "confirm", "already confirmed"),
    );
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_ILLEGAL_STATE_TRANSITION");
    expect(repositoryMock.confirmSpatialBinding).toHaveBeenCalledTimes(1);
  });

  it("maps the parent-map-ineligible dependency error via its own code/httpStatus", async () => {
    repositoryMock.confirmSpatialBinding.mockRejectedValue(
      new repositoryMock.TechnicalVisualMapSpatialBindingDependencyError(
        "TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE",
        409,
        "parent map no longer confirmed",
      ),
    );
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TECHNICAL_VISUAL_MAP_SPATIAL_BINDING_PARENT_MAP_INELIGIBLE");
  });

  it("70. fails closed with a no-store 503 on persistence failure (and no AI/provider modules are ever imported)", async () => {
    repositoryMock.confirmSpatialBinding.mockRejectedValue(new repositoryMock.TechnicalVisualMapSpatialBindingPersistenceError());
    const response = await POST(req({ expectedCurrentConfirmedSpatialBindingId: null }), ctx());
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
