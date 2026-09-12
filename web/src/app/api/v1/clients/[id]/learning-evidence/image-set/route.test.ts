import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
const imageAnalysisServiceMock = vi.hoisted(() => {
  class ObjectStorageWriteModeRequiredError extends Error {}
  return { ObjectStorageWriteModeRequiredError };
});
const imageUploadMock = vi.hoisted(() => {
  class LearningEvidenceImageValidationError extends Error {
    constructor(readonly detail: { code: string; message: string }) {
      super(detail.message);
    }
  }
  class LearningEvidenceImageMagicBytesError extends Error {}
  return { uploadLearningEvidenceImageAssets: vi.fn(), LearningEvidenceImageValidationError, LearningEvidenceImageMagicBytesError };
});
const captureSetRepoMock = vi.hoisted(() => {
  class CaptureSetValidationError extends Error {
    readonly httpStatus = 422;
    constructor(message: string) {
      super(message);
    }
  }
  class CaptureSetDependencyError extends Error {
    readonly httpStatus = 404;
    constructor(message: string) {
      super(message);
    }
  }
  class CaptureSetConcurrencyError extends Error {
    readonly httpStatus = 409;
  }
  class CaptureSetInvariantError extends Error {
    readonly httpStatus = 500;
  }
  class CaptureSetPersistenceError extends Error {
    readonly httpStatus = 503;
  }
  return { createCaptureSet: vi.fn(), CaptureSetValidationError, CaptureSetDependencyError, CaptureSetConcurrencyError, CaptureSetInvariantError, CaptureSetPersistenceError };
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
vi.mock("@/lib/learning-evidence-image-upload", () => imageUploadMock);
vi.mock("@/lib/capture-set-repository", () => captureSetRepoMock);
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invokePost(id: string, form: FormData): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/clients/${id}/learning-evidence/image-set`, { method: "POST", body: form }), {
    params: Promise.resolve({ id }),
  });
}

function fakeImageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  imageUploadMock.uploadLearningEvidenceImageAssets.mockResolvedValue([{ id: "image-1" }, { id: "image-2" }]);
  captureSetRepoMock.createCaptureSet.mockResolvedValue({ id: "capture-set-1" });
  evidenceRepoMock.findLearningEvidenceForOwner.mockResolvedValue(null);
  evidenceRepoMock.createLearningEvidence.mockResolvedValue({ id: "evidence-1", evidenceType: "IMAGE_SET", status: "ACTIVE" });
  evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/[id]/learning-evidence/image-set", () => {
  it("returns 400 when fewer than 2 files are provided", async () => {
    const form = new FormData();
    form.append("files", fakeImageFile("a.jpg"));

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(400);
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).not.toHaveBeenCalled();
  });

  it("returns 400 when more than 4 files are provided (the same cap CaptureSet/validateUploadBatch already enforce)", async () => {
    const form = new FormData();
    for (const name of ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"]) form.append("files", fakeImageFile(name));

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(400);
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).not.toHaveBeenCalled();
  });

  it("4. uploads N images, groups them into one CaptureSet preserving order, and links IMAGE_SET evidence to it", async () => {
    const form = new FormData();
    form.append("files", fakeImageFile("a.jpg"));
    form.append("files", fakeImageFile("b.jpg"));

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(201);
    expect(captureSetRepoMock.createCaptureSet).toHaveBeenCalledWith("owner-1", "client-1", [
      { viewLabel: "FRONT", imageAssetId: "image-1" },
      { viewLabel: "LEFT", imageAssetId: "image-2" },
    ]);
    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ evidenceType: "IMAGE_SET", captureSetId: "capture-set-1" }),
      expect.anything(),
    );
  });

  it("17/18. a repeated submissionId short-circuits without re-uploading or re-grouping", async () => {
    evidenceRepoMock.findLearningEvidenceForOwner.mockResolvedValue({ id: "evidence-existing", evidenceType: "IMAGE_SET", status: "ACTIVE" });
    const form = new FormData();
    form.append("files", fakeImageFile("a.jpg"));
    form.append("files", fakeImageFile("b.jpg"));
    form.append("submissionId", "existing-set-1");

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(201);
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).not.toHaveBeenCalled();
    expect(captureSetRepoMock.createCaptureSet).not.toHaveBeenCalled();
  });

  it("propagates a CaptureSet dependency error with its own status", async () => {
    captureSetRepoMock.createCaptureSet.mockRejectedValue(new captureSetRepoMock.CaptureSetDependencyError("not found"));
    const form = new FormData();
    form.append("files", fakeImageFile("a.jpg"));
    form.append("files", fakeImageFile("b.jpg"));

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(404);
  });
});
