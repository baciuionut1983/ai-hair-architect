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
  return { ProfessionalBrainAccessError, ProfessionalBrainStateError, getPipelineStatus: vi.fn() };
});
const dryRunMock = vi.hoisted(() => ({ professionalBrainRenderDryRun: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => ({ ...clientRepoMock }));
vi.mock("@/lib/professional-brain-orchestrator", () => orchestratorMock);
vi.mock("@/lib/professional-brain-dry-run", () => dryRunMock);
vi.mock("@/lib/proposal-validators", () => ({ isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) }));

import { GET as statusGET } from "./status/route";
import { POST as dryRunPOST } from "./render-dry-run/route";

const params = { params: Promise.resolve({ id: "client-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue({ id: "user-1" });
  clientRepoMock.resolveOwnedClient.mockResolvedValue({ id: "client-1", ownerUserId: "user-1" });
});

describe("GET /clients/[id]/professional-brain/status", () => {
  it("401 when unauthenticated", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const res = await statusGET(new Request("http://x"), params);
    expect(res.status).toBe(401);
  });

  it("404 when the client is not owned", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const res = await statusGET(new Request("http://x"), params);
    expect(res.status).toBe(404);
  });

  it("returns the pipeline status view, no-store", async () => {
    orchestratorMock.getPipelineStatus.mockResolvedValue({ status: "NEEDS_REASONING" });
    const res = await statusGET(new Request("http://x"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ pipelineStatus: { status: "NEEDS_REASONING" } });
    expect(orchestratorMock.getPipelineStatus).toHaveBeenCalledWith("user-1", "client-1");
  });
});

describe("POST /clients/[id]/professional-brain/render-dry-run", () => {
  function req(body: unknown) {
    return new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  }

  it("401 when unauthenticated", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const res = await dryRunPOST(req({ sceneId: "s1" }), params);
    expect(res.status).toBe(401);
  });

  it("404 when the client is not owned -- no dry-run is attempted", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const res = await dryRunPOST(req({ sceneId: "s1" }), params);
    expect(res.status).toBe(404);
    expect(dryRunMock.professionalBrainRenderDryRun).not.toHaveBeenCalled();
  });

  it("400 when sceneId is missing", async () => {
    const res = await dryRunPOST(req({}), params);
    expect(res.status).toBe(400);
    expect(dryRunMock.professionalBrainRenderDryRun).not.toHaveBeenCalled();
  });

  it("returns the dry-run result verbatim; providerRequestSent is false; response carries no secret", async () => {
    dryRunMock.professionalBrainRenderDryRun.mockResolvedValue({
      providerRequestSent: false,
      requestWouldBeAllowed: false,
      providerConfig: { apiKeyPresent: true, model: "veo-3.1-generate-preview" },
      blockers: ["provider config: disabled"],
    });
    const res = await dryRunPOST(req({ sceneId: "executionunit-cutting-establish-central-nape-guide-1#scene-execution" }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dryRun.providerRequestSent).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/SECRET|api[_-]?key["']?\s*[:=]\s*["'][^"']+/i);
    expect(dryRunMock.professionalBrainRenderDryRun).toHaveBeenCalledWith("user-1", "client-1", "executionunit-cutting-establish-central-nape-guide-1#scene-execution", expect.anything());
  });
});
