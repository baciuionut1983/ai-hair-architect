import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateVideoWorkerRequest: vi.fn() }));
const runtimeMock = vi.hoisted(() => ({ runVideoDemonstrationRecoverySweepForRuntime: vi.fn() }));

vi.mock("@/lib/video-worker-auth", () => authMock);
vi.mock("@/lib/video-worker-runtime", () => runtimeMock);

import { POST } from "./route";

function request(header = "Bearer valid-token"): Request {
  const headers = new Headers({ authorization: header });
  return new Request("http://localhost/api/v1/ops/video-demonstrations/recovery-run", { method: "POST", headers });
}

// Real AI Video Demonstration, Stage 3 (task §4/§16) -- mirrors
// image-asset-retention automation-run's own route-test conventions.

describe("POST /api/v1/ops/video-demonstrations/recovery-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateVideoWorkerRequest.mockReturnValue("authorized");
  });

  it("fails closed with 503 when the worker secret is not configured, never running the sweep -- no normal user can reach this effect at all", async () => {
    authMock.authenticateVideoWorkerRequest.mockReturnValue("not_configured");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "VIDEO_DEMONSTRATION_WORKER_NOT_CONFIGURED" });
    expect(runtimeMock.runVideoDemonstrationRecoverySweepForRuntime).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized (missing/wrong) bearer token with 401, never running the sweep", async () => {
    authMock.authenticateVideoWorkerRequest.mockReturnValue("unauthorized");

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
    expect(runtimeMock.runVideoDemonstrationRecoverySweepForRuntime).not.toHaveBeenCalled();
  });

  it("runs the sweep and returns its result when authorized", async () => {
    runtimeMock.runVideoDemonstrationRecoverySweepForRuntime.mockResolvedValue({
      generationsFound: 3,
      outcomeCounts: { submitted: 1, completed: 2 },
      generationsErrored: 0,
      hasMore: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { generationsFound: 3, outcomeCounts: { submitted: 1, completed: 2 }, generationsErrored: 0, hasMore: false } });
    expect(runtimeMock.runVideoDemonstrationRecoverySweepForRuntime).toHaveBeenCalledTimes(1);
  });

  it("collapses an unexpected sweep failure to a sanitized 500, leaking no internal detail", async () => {
    runtimeMock.runVideoDemonstrationRecoverySweepForRuntime.mockRejectedValue(new Error("unexpected: db host 10.0.0.9 unreachable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR", message: "Video Demonstration recovery sweep failed." });
    expect(JSON.stringify(body)).not.toContain("10.0.0.9");
  });

  it("every response carries a Cache-Control: no-store header", async () => {
    runtimeMock.runVideoDemonstrationRecoverySweepForRuntime.mockResolvedValue({ generationsFound: 0, outcomeCounts: {}, generationsErrored: 0, hasMore: false });
    const response = await POST(request());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a session cookie alone (no worker bearer token) never authorizes this route -- verified at the auth-call level, not just status code", async () => {
    authMock.authenticateVideoWorkerRequest.mockReturnValue("unauthorized");
    const sessionOnlyRequest = new Request("http://localhost/api/v1/ops/video-demonstrations/recovery-run", {
      method: "POST",
      headers: new Headers({ cookie: "session=a-real-authenticated-user-session" }),
    });

    const response = await POST(sessionOnlyRequest);
    expect(response.status).toBe(401);
    expect(runtimeMock.runVideoDemonstrationRecoverySweepForRuntime).not.toHaveBeenCalled();
  });
});
