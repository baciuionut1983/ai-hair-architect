import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
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
  return { listUploadedParts: vi.fn(), UploadSessionValidationError, UploadSessionStateError };
});
const sessionRepoMock = vi.hoisted(() => ({
  findUploadSessionForOwner: vi.fn(),
  isUploadSessionPersistenceError: vi.fn(() => false),
  uploadSessionPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503 })),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/image-analysis-service", () => imageAnalysisServiceMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-runtime", () => runtimeMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-service", () => serviceMock);
vi.mock("@/lib/professional-learning-upload-session-repository", () => sessionRepoMock);

import { GET } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokeGet(sessionId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/v1/learning-evidence/video-upload-sessions/${sessionId}`), { params: Promise.resolve({ sessionId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  runtimeMock.resolveVideoMultipartStorageDependencies.mockResolvedValue({ storage: {} });
  sessionRepoMock.findUploadSessionForOwner.mockResolvedValue({
    id: "session-1",
    status: "UPLOADING",
    fileName: "a.mp4",
    expectedSizeBytes: 1024,
    partSizeBytes: 16 * 1024 * 1024,
    expiresAt: "2026-09-16T00:00:00.000Z",
    evidenceId: null,
  });
  serviceMock.listUploadedParts.mockResolvedValue([{ partNumber: 2, etag: "x" }, { partNumber: 1, etag: "y" }]);
  sessionRepoMock.isUploadSessionPersistenceError.mockReturnValue(false);
});

describe("GET /api/v1/learning-evidence/video-upload-sessions/[sessionId]", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokeGet("session-1");
    expect(response.status).toBe(401);
    expect(sessionRepoMock.findUploadSessionForOwner).not.toHaveBeenCalled();
  });

  it("3/4. returns 404 when the session does not belong to this caller", async () => {
    sessionRepoMock.findUploadSessionForOwner.mockResolvedValue(null);
    const response = await invokeGet("session-1");
    expect(response.status).toBe(404);
  });

  it("9. reports uploaded part numbers, sorted, for resume", async () => {
    const response = await invokeGet("session-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploadedPartNumbers).toEqual([1, 2]);
    expect(sessionRepoMock.findUploadSessionForOwner).toHaveBeenCalledWith("owner-1", "session-1");
  });

  it("17. still returns the session's own persisted state when the live parts list is unavailable", async () => {
    serviceMock.listUploadedParts.mockRejectedValue(new imageAnalysisServiceMock.ObjectStorageWriteModeRequiredError("unavailable"));
    const response = await invokeGet("session-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploadedPartNumbers).toEqual([]);
    expect(body.status).toBe("UPLOADING");
  });
});
