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
  return { completeVideoUploadSession: vi.fn(), UploadSessionValidationError, UploadSessionStateError, UploadSessionProviderError };
});
const sessionRepoMock = vi.hoisted(() => ({
  isUploadSessionPersistenceError: vi.fn(() => false),
  uploadSessionPersistenceUnavailableResponse: vi.fn(() => Response.json({ error: "UNAVAILABLE" }, { status: 503 })),
}));
const evidenceRepoMock = vi.hoisted(() => {
  class ProfessionalLearningEvidenceValidationError extends Error {
    readonly httpStatus = 400;
    constructor(message: string) {
      super(message);
    }
  }
  return { isProfessionalLearningEvidencePersistenceError: vi.fn(() => false), ProfessionalLearningEvidenceValidationError };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/image-analysis-service", () => imageAnalysisServiceMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-runtime", () => runtimeMock);
vi.mock("@/lib/professional-learning-video-multipart-upload-service", () => serviceMock);
vi.mock("@/lib/professional-learning-upload-session-repository", () => sessionRepoMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invokePost(sessionId: string, body: unknown): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/learning-evidence/video-upload-sessions/${sessionId}/complete`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ sessionId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  runtimeMock.resolveVideoMultipartStorageDependencies.mockResolvedValue({ storage: {} });
  serviceMock.completeVideoUploadSession.mockResolvedValue({ evidence: { id: "evidence-1", evidenceType: "VIDEO", status: "ACTIVE" } });
  sessionRepoMock.isUploadSessionPersistenceError.mockReturnValue(false);
  evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/learning-evidence/video-upload-sessions/[sessionId]/complete", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await invokePost("session-1", { parts: [{ partNumber: 1, etag: "x" }] });
    expect(response.status).toBe(401);
    expect(serviceMock.completeVideoUploadSession).not.toHaveBeenCalled();
  });

  it("returns 400 when parts is missing or empty", async () => {
    const empty = await invokePost("session-1", { parts: [] });
    expect(empty.status).toBe(400);
    const missing = await invokePost("session-1", {});
    expect(missing.status).toBe(400);
  });

  it("12/19. completes using the authenticated owner and returns the created evidence", async () => {
    const response = await invokePost("session-1", { parts: [{ partNumber: 1, etag: "real-etag" }] });
    expect(response.status).toBe(201);
    expect(serviceMock.completeVideoUploadSession).toHaveBeenCalledWith("owner-1", "session-1", expect.objectContaining({ parts: [{ partNumber: 1, etag: "real-etag" }] }), expect.anything());
    const body = await response.json();
    expect(body.evidence.id).toBe("evidence-1");
  });

  it("13. propagates INCOMPLETE_PARTS_LIST as 400", async () => {
    serviceMock.completeVideoUploadSession.mockRejectedValue(new serviceMock.UploadSessionValidationError("INCOMPLETE_PARTS_LIST", "missing part"));
    const response = await invokePost("session-1", { parts: [{ partNumber: 1, etag: "x" }] });
    expect(response.status).toBe(400);
  });

  it("14. propagates a provider completion failure as 502", async () => {
    serviceMock.completeVideoUploadSession.mockRejectedValue(new serviceMock.UploadSessionProviderError("PROVIDER_COMPLETE_FAILED", "rejected"));
    const response = await invokePost("session-1", { parts: [{ partNumber: 1, etag: "forged" }] });
    expect(response.status).toBe(502);
  });

  it("24. propagates an expired session as 410", async () => {
    serviceMock.completeVideoUploadSession.mockRejectedValue(new serviceMock.UploadSessionStateError("SESSION_EXPIRED", 410, "expired"));
    const response = await invokePost("session-1", { parts: [{ partNumber: 1, etag: "x" }] });
    expect(response.status).toBe(410);
  });
});
