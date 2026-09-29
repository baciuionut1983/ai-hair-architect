import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const orchestratorMock = vi.hoisted(() => {
  class ProfessionalBrainAccessError extends Error {
    readonly code = "PROFESSIONAL_BRAIN_CLIENT_NOT_FOUND";
    readonly httpStatus = 404;
    constructor() {
      super("Client not found.");
      this.name = "ProfessionalBrainAccessError";
    }
  }
  class ProfessionalBrainStateError extends Error {
    readonly httpStatus = 409;
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProfessionalBrainStateError";
    }
  }
  return { ProfessionalBrainAccessError, ProfessionalBrainStateError, createDraftCurrentState: vi.fn() };
});
const snapshotRepoMock = vi.hoisted(() => {
  class HairStateSnapshotValidationError extends Error {}
  class HairStateSnapshotDependencyError extends Error {}
  class HairStateSnapshotPersistenceError extends Error {}
  return { HairStateSnapshotValidationError, HairStateSnapshotDependencyError, HairStateSnapshotPersistenceError };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => ({ ...clientRepoMock }));
vi.mock("@/lib/professional-brain-orchestrator", () => orchestratorMock);
vi.mock("@/lib/hair-state-snapshot-repository", () => snapshotRepoMock);
vi.mock("@/lib/proposal-validators", () => ({ isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "client-1" }) };
function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue({ id: "user-1" });
  clientRepoMock.resolveOwnedClient.mockResolvedValue({ id: "client-1", ownerUserId: "user-1" });
});

describe("POST /clients/[id]/professional-brain/current-state", () => {
  it("401 when unauthenticated", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const res = await POST(req({ payload: {} }), params);
    expect(res.status).toBe(401);
    expect(orchestratorMock.createDraftCurrentState).not.toHaveBeenCalled();
  });

  it("404 when the client is not owned -- no snapshot is created", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const res = await POST(req({ payload: {} }), params);
    expect(res.status).toBe(404);
    expect(orchestratorMock.createDraftCurrentState).not.toHaveBeenCalled();
  });

  it("400 when the body has no `payload` key at all", async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
    expect(orchestratorMock.createDraftCurrentState).not.toHaveBeenCalled();
  });

  it("400 on unparseable JSON", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: "{not json" }), params);
    expect(res.status).toBe(400);
  });

  it("creates the draft and returns 201 with the snapshot, no-store", async () => {
    orchestratorMock.createDraftCurrentState.mockResolvedValue({ id: "snap-1", status: "DRAFT", role: "CURRENT" });
    const res = await POST(req({ payload: { globalState: {}, zones: [] } }), params);
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ snapshot: { id: "snap-1", status: "DRAFT", role: "CURRENT" } });
    expect(orchestratorMock.createDraftCurrentState).toHaveBeenCalledWith("user-1", "client-1", { payload: { globalState: {}, zones: [] } });
  });

  it("maps an invalid payload (ProfessionalBrainStateError) to its own status/code -- never a silently-accepted malformed snapshot", async () => {
    orchestratorMock.createDraftCurrentState.mockRejectedValue(
      new orchestratorMock.ProfessionalBrainStateError("PROFESSIONAL_BRAIN_NEEDS_CURRENT_STATE", "CURRENT state payload is not a structurally valid HairStateSnapshotPayload."),
    );
    const res = await POST(req({ payload: { bogus: true } }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("PROFESSIONAL_BRAIN_NEEDS_CURRENT_STATE");
  });
});
