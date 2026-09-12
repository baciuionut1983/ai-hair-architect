import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors image-analysis-service.test.ts's own established mocking
// convention exactly (same real dependencies, same fake shapes) -- this
// module reuses the identical canonical pipeline, minus the
// ImageAnalysis row, so the fakes below deliberately include an
// `imageAnalysis` mock too, purely so a test can assert it is NEVER
// called (the one behavioral difference from uploadAndAnalyzeImages this
// file exists to prove).
const { PRISMA_MOCK } = vi.hoisted(() => ({
  PRISMA_MOCK: {
    imageAsset: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    imageAnalysis: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: PRISMA_MOCK }));

vi.mock("@/lib/image-upload-validation", () => ({
  validateUploadBatch: vi.fn(() => null),
  validateMagicBytes: vi.fn(async () => true),
  sanitizeFileName: vi.fn((name: string) => name.replace(/[^a-z0-9._-]/gi, "_")),
}));

vi.mock("@/lib/image-storage", () => ({
  saveImageFile: vi.fn(async (userId: string, assetId: string) => `/storage/${userId}/${assetId}/photo.jpg`),
}));

vi.mock("@/lib/image-normalizer", () => ({
  processImageForStorage: vi.fn(async (buffer: Buffer) => ({ buffer, exifStripped: true, orientation: 1, width: 1080, height: 1440 })),
}));

vi.mock("@/lib/image-analysis-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-analysis-service")>("@/lib/image-analysis-service");
  return { ...actual, resolveObjectStorageWriteTarget: vi.fn(() => null), resolveRuntimeMode: vi.fn(() => "test") };
});

import { validateUploadBatch, validateMagicBytes } from "@/lib/image-upload-validation";
import { LearningEvidenceImageMagicBytesError, LearningEvidenceImageValidationError, uploadLearningEvidenceImageAssets } from "@/lib/learning-evidence-image-upload";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

function fakeFile(name: string, type: string, content: string): File {
  const bytes = Buffer.from(content);
  return { name, type, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as File;
}

beforeEach(() => {
  vi.clearAllMocks();
  let counter = 0;
  PRISMA_MOCK.imageAsset.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    counter += 1;
    return { id: `asset-${counter}`, ...data };
  });
  PRISMA_MOCK.imageAsset.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    ...data,
  }));
  PRISMA_MOCK.imageAsset.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, storagePath: `/storage/${where.id}` }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("uploadLearningEvidenceImageAssets", () => {
  it("3/5. creates exactly one canonical ImageAsset for a single file, with no ImageAnalysis row (unlike uploadAndAnalyzeImages)", async () => {
    const created = await uploadLearningEvidenceImageAssets(OWNER_ID, CLIENT_ID, [fakeFile("photo.jpg", "image/jpeg", "hello")]);

    expect(created).toHaveLength(1);
    expect(PRISMA_MOCK.imageAsset.create).toHaveBeenCalledTimes(1);
    expect(PRISMA_MOCK.imageAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerUserId: OWNER_ID, clientId: CLIENT_ID, mimeType: "image/jpeg" }) }),
    );
    expect(PRISMA_MOCK.imageAnalysis.create).not.toHaveBeenCalled();
  });

  it("4/7. creates one ImageAsset per file, in the SAME order as the input files array", async () => {
    const files = [fakeFile("a.jpg", "image/jpeg", "a"), fakeFile("b.jpg", "image/jpeg", "b"), fakeFile("c.jpg", "image/jpeg", "c")];

    const created = await uploadLearningEvidenceImageAssets(OWNER_ID, CLIENT_ID, files);

    expect(created).toHaveLength(3);
    const fileNames = PRISMA_MOCK.imageAsset.create.mock.calls.map((call) => (call[0] as { data: { fileName: string } }).data.fileName);
    expect(fileNames).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(PRISMA_MOCK.imageAnalysis.create).not.toHaveBeenCalled();
  });

  it("15. propagates a validateUploadBatch rejection as a typed error, with no ImageAsset created", async () => {
    vi.mocked(validateUploadBatch).mockReturnValueOnce({ code: "INVALID_MIMETYPE", message: "Unsupported format" });

    const error = await uploadLearningEvidenceImageAssets(OWNER_ID, CLIENT_ID, [fakeFile("x.gif", "image/gif", "x")]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LearningEvidenceImageValidationError);
    expect((error as LearningEvidenceImageValidationError).detail.code).toBe("INVALID_MIMETYPE");
    expect(PRISMA_MOCK.imageAsset.create).not.toHaveBeenCalled();
  });

  it("propagates a magic-bytes mismatch as a typed error", async () => {
    vi.mocked(validateMagicBytes).mockResolvedValueOnce(false);

    const error = await uploadLearningEvidenceImageAssets(OWNER_ID, CLIENT_ID, [fakeFile("fake.jpg", "image/jpeg", "not-really-a-jpeg")]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LearningEvidenceImageMagicBytesError);
  });
});
