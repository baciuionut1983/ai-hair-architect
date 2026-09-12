import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const imageAnalysisServiceMock = vi.hoisted(() => {
  class ObjectStorageWriteModeRequiredError extends Error {}
  return { ObjectStorageWriteModeRequiredError };
});
const runtimeMock = vi.hoisted(() => ({
  resolveVideoMultipartStorageDependencies: vi.fn(),
  resolveVideoUploadBucketAlias: vi.fn(),
}));
const serviceMock = vi.hoisted(() => {
  class UploadSessionValidationError extends Error {
    readonly httpStatus = 400;
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  class UploadSessionProviderError extends Error {
    readonly httpStatus = 502;
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return { initiateVideoUploadSession: vi.fn(), UploadSessionValidationError, UploadSessionProviderError };
});
const sessionRepoMock = vi.hoisted(() => ({
  isUploadSessionPersistenceError: vi.fn(() => false),
  uploadSessionPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } })),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/image-analysis-service", () => imageAnalysisServiceMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-runtime", () => runtimeMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-service", () => serviceMock);
vi.mock("@/lib/professional-learning-upload-session-repository", () => sessionRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invokePost(id: string, body: unknown): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/clients/${id}/learning-evidence/video-upload-sessions`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  runtimeMock.resolveVideoUploadBucketAlias.mockReturnValue("primary-videos");
  runtimeMock.resolveVideoMultipartStorageDependencies.mockResolvedValue({ storage: {} });
  serviceMock.initiateVideoUploadSession.mockResolvedValue({
    session: { id: "session-1", status: "INITIATED", expiresAt: "2026-09-16T00:00:00.000Z" },
    plan: { partSizeBytes: 16 * 1024 * 1024, partCount: 3, lastPartSizeBytes: 100 },
  });
  sessionRepoMock.isUploadSessionPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/[id]/learning-evidence/video-upload-sessions", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokePost("client-1", { sessionId: "s-1", fileName: "a.mp4", contentType: "video/mp4", expectedSizeBytes: 1024 });
    expect(response.status).toBe(401);
    expect(serviceMock.initiateVideoUploadSession).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const response = await invokePost("foreign", { sessionId: "s-1", fileName: "a.mp4", contentType: "video/mp4", expectedSizeBytes: 1024 });
    expect(response.status).toBe(404);
  });

  it("returns 400 when sessionId is missing", async () => {
    const response = await invokePost("client-1", { fileName: "a.mp4", contentType: "video/mp4", expectedSizeBytes: 1024 });
    expect(response.status).toBe(400);
    expect(serviceMock.initiateVideoUploadSession).not.toHaveBeenCalled();
  });

  it("5/8. initiates with the authenticated owner and ambient clientId, never a client-supplied owner", async () => {
    const response = await invokePost("client-1", { sessionId: "s-1", fileName: "a.mp4", contentType: "video/mp4", expectedSizeBytes: 1024 });

    expect(response.status).toBe(201);
    expect(serviceMock.initiateVideoUploadSession).toHaveBeenCalledWith(
      "owner-1",
      "s-1",
      expect.objectContaining({ clientId: "client-1", fileName: "a.mp4", contentType: "video/mp4", expectedSizeBytes: 1024 }),
      expect.anything(),
    );
    const body = await response.json();
    expect(body.partCount).toBe(3);
  });

  it("returns 503 when large video upload is unavailable (S3 not configured)", async () => {
    runtimeMock.resolveVideoUploadBucketAlias.mockImplementation(() => {
      throw new imageAnalysisServiceMock.ObjectStorageWriteModeRequiredError("unavailable");
    });
    const response = await invokePost("client-1", { sessionId: "s-1", fileName: "a.mp4", contentType: "video/mp4", expectedSizeBytes: 1024 });
    expect(response.status).toBe(503);
  });

  it("propagates a validation error from the service with its own code/status", async () => {
    serviceMock.initiateVideoUploadSession.mockRejectedValue(new serviceMock.UploadSessionValidationError("INVALID_MIMETYPE", "bad type"));
    const response = await invokePost("client-1", { sessionId: "s-1", fileName: "a.mp4", contentType: "application/pdf", expectedSizeBytes: 1024 });
    expect(response.status).toBe(400);
  });
});
