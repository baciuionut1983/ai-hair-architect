import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  hasValidVideoMagicBytes,
  LearningEvidenceVideoValidationError,
  MAX_LEARNING_VIDEO_BYTES,
  uploadLearningEvidenceVideoAsset,
  validateLearningEvidenceVideoUpload,
} from "@/lib/learning-evidence-video-upload";

// Pure validators -- no I/O. Real container magic bytes, not fabricated:
// WebM's EBML header (0x1A45DFA3) and the ISO-BMFF "ftyp" box MP4/
// QuickTime share at byte offset 4.
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
const MP4_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // "....ftyp"

describe("validateLearningEvidenceVideoUpload (pure)", () => {
  it("15. rejects an unsupported MIME type", () => {
    expect(validateLearningEvidenceVideoUpload({ size: 1024, type: "video/x-msvideo" })).toBe("INVALID_MIMETYPE");
    expect(validateLearningEvidenceVideoUpload({ size: 1024, type: "application/pdf" })).toBe("INVALID_MIMETYPE");
  });

  it("accepts the 3 real supported container types", () => {
    expect(validateLearningEvidenceVideoUpload({ size: 1024, type: "video/mp4" })).toBeNull();
    expect(validateLearningEvidenceVideoUpload({ size: 1024, type: "video/webm" })).toBeNull();
    expect(validateLearningEvidenceVideoUpload({ size: 1024, type: "video/quicktime" })).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(validateLearningEvidenceVideoUpload({ size: 0, type: "video/mp4" })).toBe("EMPTY_FILE");
  });

  it("16. rejects a file over MAX_LEARNING_VIDEO_BYTES", () => {
    expect(validateLearningEvidenceVideoUpload({ size: MAX_LEARNING_VIDEO_BYTES + 1, type: "video/mp4" })).toBe("FILE_TOO_LARGE");
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateLearningEvidenceVideoUpload({ size: MAX_LEARNING_VIDEO_BYTES, type: "video/mp4" })).toBeNull();
  });
});

describe("hasValidVideoMagicBytes (pure)", () => {
  it("accepts real WebM EBML magic bytes", () => {
    expect(hasValidVideoMagicBytes(WEBM_MAGIC, "video/webm")).toBe(true);
  });

  it("accepts real MP4/QuickTime ftyp box magic bytes", () => {
    expect(hasValidVideoMagicBytes(MP4_MAGIC, "video/mp4")).toBe(true);
    expect(hasValidVideoMagicBytes(MP4_MAGIC, "video/quicktime")).toBe(true);
  });

  it("rejects a declared MIME type that does not match the real bytes (e.g. an image renamed to .mp4)", () => {
    const fakeMp4 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]); // real JPEG magic
    expect(hasValidVideoMagicBytes(fakeMp4, "video/mp4")).toBe(false);
  });

  it("rejects a buffer too short to contain any real signature", () => {
    expect(hasValidVideoMagicBytes(Buffer.from([0x00, 0x01]), "video/mp4")).toBe(false);
  });
});

// Real Postgres -- proves the full upload path: origin is genuinely
// "uploaded_source" (never the generation pipeline's "generated_output"
// default), the row is a real, servable VideoAsset. Skips (never fails)
// when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("uploadLearningEvidenceVideoAsset (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("6/12. persists a real VideoAsset with origin='uploaded_source', never 'generated_output'", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const file = new File([WEBM_MAGIC], "demo.webm", { type: "video/webm" });

    const asset = await uploadLearningEvidenceVideoAsset(ownerUserId, clientId, file);

    expect(asset.origin).toBe("uploaded_source");
    expect(asset.ownerUserId).toBe(ownerUserId);
    expect(asset.mimeType).toBe("video/webm");
    expect(asset.sizeBytes).toBe(WEBM_MAGIC.length);

    const reread = await prisma.videoAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(reread.origin).toBe("uploaded_source");
  });

  it("15. rejects an unsupported MIME type before ever writing a row", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const file = new File([Buffer.from("not a video")], "note.txt", { type: "text/plain" });

    const error = await uploadLearningEvidenceVideoAsset(ownerUserId, clientId, file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LearningEvidenceVideoValidationError);
    expect((error as LearningEvidenceVideoValidationError).code).toBe("INVALID_MIMETYPE");
    await expect(prisma.videoAsset.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("rejects a MIME/content mismatch (declared video/mp4, real bytes are not ftyp) with no row written", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const file = new File([Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])], "fake.mp4", { type: "video/mp4" });

    const error = await uploadLearningEvidenceVideoAsset(ownerUserId, clientId, file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LearningEvidenceVideoValidationError);
    expect((error as LearningEvidenceVideoValidationError).code).toBe("INVALID_MAGIC_BYTES");
    await expect(prisma.videoAsset.count({ where: { ownerUserId } })).resolves.toBe(0);
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@learning-evidence-video-upload.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Learning Evidence Video Upload Client" } });
  return { ownerUserId, clientId };
}
