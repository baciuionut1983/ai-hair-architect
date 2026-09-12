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
  return { abortVideoUploadSession: vi.fn(), UploadSessionValidationError, UploadSessionStateError };
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

function invokePost(sessionId: string): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/learning-evidence/video-upload-sessions/${sessionId}/abort`, { method: "POST" }), { params: Promise.resolve({ sessionId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  runtimeMock.resolveVideoMultipartStorageDependencies.mockResolvedValue({ storage: {} });
  serviceMock.abortVideoUploadSession.mockResolvedValue(undefined);
  sessionRepoMock.isUploadSessionPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/learning-evidence/video-upload-sessions/[sessionId]/abort", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokePost("session-1");
    expect(response.status).toBe(401);
    expect(serviceMock.abortVideoUploadSession).not.toHaveBeenCalled();
  });

  it("23. aborts using the authenticated owner", async () => {
    const response = await invokePost("session-1");
    expect(response.status).toBe(200);
    expect(serviceMock.abortVideoUploadSession).toHaveBeenCalledWith("owner-1", "session-1", expect.anything());
    const body = await response.json();
    expect(body).toEqual({ aborted: true });
  });

  it("3/4. returns 404 when the session does not belong to this caller", async () => {
    serviceMock.abortVideoUploadSession.mockRejectedValue(new serviceMock.UploadSessionStateError("SESSION_NOT_FOUND", 404, "not found"));
    const response = await invokePost("session-1");
    expect(response.status).toBe(404);
  });
});
