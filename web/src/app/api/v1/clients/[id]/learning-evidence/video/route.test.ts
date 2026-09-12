import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const imageAnalysisServiceMock = vi.hoisted(() => {
  class ObjectStorageWriteModeRequiredError extends Error {}
  return {
    ObjectStorageWriteModeRequiredError,
    resolveObjectStorageWriteTarget: vi.fn((): { bucketAlias: string; resolve: () => unknown } | null => null),
  };
});
const videoUploadMock = vi.hoisted(() => {
  class LearningEvidenceVideoValidationError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return { uploadLearningEvidenceVideoAsset: vi.fn(), LearningEvidenceVideoValidationError, MAX_LEARNING_VIDEO_BYTES: 200 * 1024 * 1024 };
});
const videoAssetStorageMock = vi.hoisted(() => {
  class VideoAssetStorageError extends Error {}
  return { VideoAssetStorageError };
});
const evidenceRepoMock = vi.hoisted(() => {
  class ProfessionalLearningEvidenceValidationError extends Error {
    readonly httpStatus = 400;
    constructor(message: string) {
      super(message);
    }
  }
  return {
    createLearningEvidence: vi.fn(),
    findLearningEvidenceForOwner: vi.fn(),
    isProfessionalLearningEvidencePersistenceError: vi.fn(() => false),
    professionalLearningEvidencePersistenceUnavailableResponse: vi.fn(() =>
      Response.json({ error: "PROFESSIONAL_LEARNING_EVIDENCE_PERSISTENCE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
    ),
    ProfessionalLearningEvidenceValidationError,
  };
});

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);
vi.mock("@/lib/image-analysis-service", () => imageAnalysisServiceMock);
vi.mock("@/lib/learning-evidence-video-upload", () => videoUploadMock);
vi.mock("@/lib/video-asset-storage", () => videoAssetStorageMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invokePost(id: string, form: FormData): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/clients/${id}/learning-evidence/video`, { method: "POST", body: form }), {
    params: Promise.resolve({ id }),
  });
}

function fakeVideoFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "demo.mp4", { type: "video/mp4" });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  imageAnalysisServiceMock.resolveObjectStorageWriteTarget.mockReturnValue(null);
  videoUploadMock.uploadLearningEvidenceVideoAsset.mockResolvedValue({ id: "video-asset-1", origin: "uploaded_source" });
  evidenceRepoMock.findLearningEvidenceForOwner.mockResolvedValue(null);
  evidenceRepoMock.createLearningEvidence.mockResolvedValue({ id: "evidence-1", evidenceType: "VIDEO", status: "ACTIVE" });
  evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/[id]/learning-evidence/video", () => {
  it("33. Stage 8.5L3.1: refuses with 410 (superseded) once S3/object storage is configured, before any file processing", async () => {
    imageAnalysisServiceMock.resolveObjectStorageWriteTarget.mockReturnValue({ bucketAlias: "primary-videos", resolve: vi.fn() });
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toBe("USE_MULTIPART_UPLOAD");
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(videoUploadMock.uploadLearningEvidenceVideoAsset).not.toHaveBeenCalled();
  });

  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(401);
    expect(videoUploadMock.uploadLearningEvidenceVideoAsset).not.toHaveBeenCalled();
  });

  it("returns 400 when no file is provided", async () => {
    const response = await invokePost("client-1", new FormData());
    expect(response.status).toBe(400);
  });

  it("6/12. uploads the video and links VIDEO evidence to the resulting VideoAsset (origin=uploaded_source is the upload function's own responsibility)", async () => {
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(201);
    expect(videoUploadMock.uploadLearningEvidenceVideoAsset).toHaveBeenCalledWith("owner-1", "client-1", expect.any(File));
    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ evidenceType: "VIDEO", videoAssetId: "video-asset-1" }),
      expect.anything(),
    );
  });

  it("16/19. returns 413 with the current byte limit when the video is too large -- large video is honestly not yet supported", async () => {
    videoUploadMock.uploadLearningEvidenceVideoAsset.mockRejectedValue(new videoUploadMock.LearningEvidenceVideoValidationError("FILE_TOO_LARGE", "too big"));
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toBe("FILE_TOO_LARGE");
    expect(body.maxBytes).toBe(videoUploadMock.MAX_LEARNING_VIDEO_BYTES);
  });

  it("15. returns 400 for an invalid MIME type", async () => {
    videoUploadMock.uploadLearningEvidenceVideoAsset.mockRejectedValue(new videoUploadMock.LearningEvidenceVideoValidationError("INVALID_MIMETYPE", "bad type"));
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(400);
  });

  it("returns 503 when object storage write mode is required but unavailable", async () => {
    videoUploadMock.uploadLearningEvidenceVideoAsset.mockRejectedValue(new imageAnalysisServiceMock.ObjectStorageWriteModeRequiredError("unavailable"));
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(503);
  });

  it("returns 502 when the durable video storage write itself fails", async () => {
    videoUploadMock.uploadLearningEvidenceVideoAsset.mockRejectedValue(new videoAssetStorageMock.VideoAssetStorageError("write failed"));
    const form = new FormData();
    form.append("file", fakeVideoFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(502);
  });

  it("17/18. a repeated submissionId short-circuits without re-uploading the video", async () => {
    evidenceRepoMock.findLearningEvidenceForOwner.mockResolvedValue({ id: "evidence-existing", evidenceType: "VIDEO", status: "ACTIVE" });
    const form = new FormData();
    form.append("file", fakeVideoFile());
    form.append("submissionId", "existing-video-1");

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(201);
    expect(videoUploadMock.uploadLearningEvidenceVideoAsset).not.toHaveBeenCalled();
  });
});
