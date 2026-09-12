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
vi.mock("@/lib/professional-learning-evidence-repository", () => evidenceRepoMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

function invokePost(id: string, form: FormData): Promise<Response> {
  return POST(new Request(`http://localhost/api/v1/clients/${id}/learning-evidence/image`, { method: "POST", body: form }), {
    params: Promise.resolve({ id }),
  });
}

function fakeImageFile(name = "photo.jpg"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  imageUploadMock.uploadLearningEvidenceImageAssets.mockResolvedValue([{ id: "image-asset-1" }]);
  evidenceRepoMock.findLearningEvidenceForOwner.mockResolvedValue(null);
  evidenceRepoMock.createLearningEvidence.mockResolvedValue({ id: "evidence-1", evidenceType: "IMAGE", status: "ACTIVE" });
  evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/clients/[id]/learning-evidence/image", () => {
  it("returns 401 without a cookie", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const form = new FormData();
    form.append("file", fakeImageFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(401);
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/nonexistent client", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const form = new FormData();
    form.append("file", fakeImageFile());

    const response = await invokePost("foreign-client", form);
    expect(response.status).toBe(404);
  });

  it("returns 400 when no file is provided", async () => {
    const response = await invokePost("client-1", new FormData());
    expect(response.status).toBe(400);
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).not.toHaveBeenCalled();
  });

  it("3. uploads the file and links it as IMAGE evidence by default", async () => {
    const form = new FormData();
    form.append("file", fakeImageFile());

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(201);
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).toHaveBeenCalledWith("owner-1", "client-1", [expect.any(File)]);
    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ evidenceType: "IMAGE", imageAssetId: "image-asset-1" }),
      expect.anything(),
    );
  });

  it("5. links as DIAGRAM evidence when evidenceType=DIAGRAM is supplied", async () => {
    const form = new FormData();
    form.append("file", fakeImageFile("diagram.png"));
    form.append("evidenceType", "DIAGRAM");

    await invokePost("client-1", form);

    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith("owner-1", expect.objectContaining({ evidenceType: "DIAGRAM" }), expect.anything());
  });

  it("ignores an unrecognized evidenceType value and falls back to IMAGE", async () => {
    const form = new FormData();
    form.append("file", fakeImageFile());
    form.append("evidenceType", "VIDEO");

    await invokePost("client-1", form);

    expect(evidenceRepoMock.createLearningEvidence).toHaveBeenCalledWith("owner-1", expect.objectContaining({ evidenceType: "IMAGE" }), expect.anything());
  });

  it("17/18. a repeated submissionId short-circuits to the already-persisted evidence, without re-uploading", async () => {
    evidenceRepoMock.findLearningEvidenceForOwner.mockResolvedValue({ id: "evidence-existing", evidenceType: "IMAGE", status: "ACTIVE" });
    const form = new FormData();
    form.append("file", fakeImageFile());
    form.append("submissionId", "existing-evidence-1");

    const response = await invokePost("client-1", form);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.evidence.id).toBe("evidence-existing");
    expect(imageUploadMock.uploadLearningEvidenceImageAssets).not.toHaveBeenCalled();
    expect(evidenceRepoMock.createLearningEvidence).not.toHaveBeenCalled();
  });

  it("15. returns 400 with the validation code when the upload is structurally invalid", async () => {
    imageUploadMock.uploadLearningEvidenceImageAssets.mockRejectedValue(
      new imageUploadMock.LearningEvidenceImageValidationError({ code: "FILE_TOO_LARGE", message: "too big" }),
    );
    const form = new FormData();
    form.append("file", fakeImageFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("FILE_TOO_LARGE");
  });

  it("returns 503 when object storage write mode is required but unavailable", async () => {
    imageUploadMock.uploadLearningEvidenceImageAssets.mockRejectedValue(new imageAnalysisServiceMock.ObjectStorageWriteModeRequiredError("unavailable"));
    const form = new FormData();
    form.append("file", fakeImageFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(503);
  });

  it("returns a fail-closed 503 when evidence persistence is unavailable after a successful upload", async () => {
    evidenceRepoMock.createLearningEvidence.mockRejectedValue(new Error("db down"));
    evidenceRepoMock.isProfessionalLearningEvidencePersistenceError.mockReturnValue(true);
    const form = new FormData();
    form.append("file", fakeImageFile());

    const response = await invokePost("client-1", form);
    expect(response.status).toBe(503);
  });
});
