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
  return { ProfessionalBrainAccessError, ProfessionalBrainStateError, confirmSnapshot: vi.fn() };
});
const snapshotRepoMock = vi.hoisted(() => {
  class HairStateSnapshotConcurrencyError extends Error {
    readonly code = "HAIR_STATE_SNAPSHOT_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
    constructor() {
      super("Hair State Snapshot could not be confirmed because of a concurrent confirmation.");
    }
  }
  class HairStateSnapshotStateError extends Error {
    readonly code = "HAIR_STATE_SNAPSHOT_ILLEGAL_STATE_TRANSITION";
    readonly httpStatus = 409;
  }
  class HairStateSnapshotValidationError extends Error {}
  class HairStateSnapshotDependencyError extends Error {}
  class HairStateSnapshotPersistenceError extends Error {}
  return { HairStateSnapshotConcurrencyError, HairStateSnapshotStateError, HairStateSnapshotValidationError, HairStateSnapshotDependencyError, HairStateSnapshotPersistenceError };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => ({ ...clientRepoMock }));
vi.mock("@/lib/professional-brain-orchestrator", () => orchestratorMock);
vi.mock("@/lib/hair-state-snapshot-repository", () => snapshotRepoMock);
vi.mock("@/lib/proposal-validators", () => ({ isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "client-1", snapshotId: "snap-1" }) };
function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue({ id: "user-1" });
  clientRepoMock.resolveOwnedClient.mockResolvedValue({ id: "client-1", ownerUserId: "user-1" });
});

describe("POST /clients/[id]/professional-brain/snapshots/[snapshotId]/confirm", () => {
  it("401 when unauthenticated", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: null }), params);
    expect(res.status).toBe(401);
    expect(orchestratorMock.confirmSnapshot).not.toHaveBeenCalled();
  });

  it("404 when the client is not owned", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: null }), params);
    expect(res.status).toBe(404);
    expect(orchestratorMock.confirmSnapshot).not.toHaveBeenCalled();
  });

  it("400 when expectedCurrentConfirmedSnapshotId key is missing entirely", async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
    expect(orchestratorMock.confirmSnapshot).not.toHaveBeenCalled();
  });

  it("400 when expectedCurrentConfirmedSnapshotId is an empty string", async () => {
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: "" }), params);
    expect(res.status).toBe(400);
  });

  it("400 when expectedCurrentConfirmedSnapshotId is a number", async () => {
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: 5 }), params);
    expect(res.status).toBe(400);
  });

  it("404 when confirmSnapshot resolves null (not found / wrong client)", async () => {
    orchestratorMock.confirmSnapshot.mockResolvedValue(null);
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: null }), params);
    expect(res.status).toBe(404);
  });

  it("confirms and returns 200 with the snapshot, no-store, passing null through correctly", async () => {
    orchestratorMock.confirmSnapshot.mockResolvedValue({ id: "snap-1", status: "CONFIRMED", role: "CURRENT" });
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: null }), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ snapshot: { id: "snap-1", status: "CONFIRMED", role: "CURRENT" } });
    expect(orchestratorMock.confirmSnapshot).toHaveBeenCalledWith("user-1", "client-1", "snap-1", null);
  });

  it("passes a real string expectedCurrentConfirmedSnapshotId through unchanged", async () => {
    orchestratorMock.confirmSnapshot.mockResolvedValue({ id: "snap-1", status: "CONFIRMED" });
    await POST(req({ expectedCurrentConfirmedSnapshotId: "prior-confirmed-id" }), params);
    expect(orchestratorMock.confirmSnapshot).toHaveBeenCalledWith("user-1", "client-1", "snap-1", "prior-confirmed-id");
  });

  it("409 with a safe, non-leaking message on a real concurrency conflict -- proves stale-data protection is wired, not just declared", async () => {
    orchestratorMock.confirmSnapshot.mockRejectedValue(new snapshotRepoMock.HairStateSnapshotConcurrencyError());
    const res = await POST(req({ expectedCurrentConfirmedSnapshotId: null }), params);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("HAIR_STATE_SNAPSHOT_CONCURRENCY_CONFLICT");
    expect(json.message).not.toMatch(/concurrent confirmation/i);
  });
});
