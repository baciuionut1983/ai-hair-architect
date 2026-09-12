import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const imageAnalysisServiceMock = vi.hoisted(() => {
  class ObjectStorageWriteModeRequiredError extends Error {}
  return { ObjectStorageWriteModeRequiredError };
});
const runtimeMock = vi.hoisted(() => ({ resolveVideoMultipartStorageDependencies: vi.fn() }));
const serviceMock = vi.hoisted(() => {
  class UploadSessionValidationError extends Error {
    readonly httpStatus = 400;
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  class UploadSessionStateError extends Error {
    constructor(readonly code: string, readonly httpStatus: number, message: string) {
      super(message);
    }
  }
  class UploadSessionProviderError extends Error {
    readonly httpStatus = 502;
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return { requestUploadPartUrl: vi.fn(), UploadSessionValidationError, UploadSessionStateError, UploadSessionProviderError };
});
const sessionRepoMock = vi.hoisted(() => ({
  isUploadSessionPersistenceError: vi.fn(() => false),
  uploadSessionPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503 })),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/image-analysis-service", () => imageAnalysisServiceMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-runtime", () => runtimeMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-service", () => serviceMock);
vi.mock("@/lib/professional-learning-upload-session-repository", () => sessionRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokePost(sessionId: string, body: unknown): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/learning-evidence/video-upload-sessions/${sessionId}/parts`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ sessionId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 999 });
  runtimeMock.resolveVideoMultipartStorageDependencies.mockResolvedValue({ storage: {} });
  serviceMock.requestUploadPartUrl.mockResolvedValue({ url: "https://fake-s3/part-1", partNumber: 1, expiresInSeconds: 900 });
  sessionRepoMock.isUploadSessionPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/learning-evidence/video-upload-sessions/[sessionId]/parts", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokePost("session-1", { partNumber: 1 });
    expect(response.status).toBe(401);
    expect(serviceMock.requestUploadPartUrl).not.toHaveBeenCalled();
  });

  it("returns 400 when partNumber is missing", async () => {
    const response = await invokePost("session-1", {});
    expect(response.status).toBe(400);
  });

  it("9. authorizes a part URL using the authenticated owner, never a body-supplied one", async () => {
    const response = await invokePost("session-1", { partNumber: 2 });
    expect(response.status).toBe(200);
    expect(serviceMock.requestUploadPartUrl).toHaveBeenCalledWith("owner-1", "session-1", 2, expect.anything());
  });

  it("3/4. returns 404 when the service reports the session does not belong to this caller", async () => {
    serviceMock.requestUploadPartUrl.mockRejectedValue(new serviceMock.UploadSessionStateError("SESSION_NOT_FOUND", 404, "not found"));
    const response = await invokePost("session-1", { partNumber: 1 });
    expect(response.status).toBe(404);
  });

  it("11. returns 400 for an out-of-range part number", async () => {
    serviceMock.requestUploadPartUrl.mockRejectedValue(new serviceMock.UploadSessionValidationError("PART_NUMBER_OUT_OF_RANGE", "out of range"));
    const response = await invokePost("session-1", { partNumber: 999 });
    expect(response.status).toBe(400);
  });
});
