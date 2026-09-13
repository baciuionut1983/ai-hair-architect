import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { resolveLearningEvidenceImageMedia } from "@/lib/professional-learning-image-media-resolver";

// AI Hair Architect, Professional Skill Engine Stage 8.5L4.R2 -- real
// Postgres + real local file, no mocks. Reuses the exact fixture pattern
// image-analysis-processing-service.test.ts already established
// (saveImageFile + a real minimal JPEG magic-byte buffer) rather than a
// second, competing test double for the same storage layer.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const REAL_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

suite("resolveLearningEvidenceImageMedia (Stage 8.5L4.R2, real DB + real local file)", () => {
  afterEach(async () => {
    for (const path of localPaths) {
      await deleteImageFile(path).catch(() => undefined);
    }
    localPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("resolves the real bytes for an owned, available image asset", async () => {
    const ownerUserId = await createOwner();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "photo.jpg", REAL_JPEG_BYTES);
    localPaths.add(storagePath);
    await prisma.imageAsset.create({
      data: { id: assetId, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: REAL_JPEG_BYTES.length, ownerUserId, clientId: randomUUID(), storagePath, storageBackend: null },
    });

    const result = await resolveLearningEvidenceImageMedia(ownerUserId, assetId);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.media.mimeType).toBe("image/jpeg");
    expect(Buffer.compare(result.media.buffer, REAL_JPEG_BYTES)).toBe(0);
  });

  it("Part 45 IDOR: another user cannot resolve media for User A's image asset -- indistinguishable from nonexistent", async () => {
    const userA = await createOwner();
    const userB = await createOwner();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(userA, assetId, "photo.jpg", REAL_JPEG_BYTES);
    localPaths.add(storagePath);
    await prisma.imageAsset.create({
      data: { id: assetId, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: REAL_JPEG_BYTES.length, ownerUserId: userA, clientId: randomUUID(), storagePath, storageBackend: null },
    });

    const asUserA = await resolveLearningEvidenceImageMedia(userA, assetId);
    const asUserB = await resolveLearningEvidenceImageMedia(userB, assetId);

    expect(asUserA.status).toBe("resolved");
    expect(asUserB).toEqual({ status: "unavailable", reason: "IMAGE_ASSET_NOT_FOUND" });
  });

  it("returns unavailable (never throws) for a nonexistent asset id", async () => {
    const ownerUserId = await createOwner();
    const result = await resolveLearningEvidenceImageMedia(ownerUserId, randomUUID());
    expect(result).toEqual({ status: "unavailable", reason: "IMAGE_ASSET_NOT_FOUND" });
  });

  it("returns unavailable for an asset whose bytes were never actually stored (storagePath = pending, no backend)", async () => {
    const ownerUserId = await createOwner();
    const assetId = randomUUID();
    await prisma.imageAsset.create({
      data: { id: assetId, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 100, ownerUserId, clientId: randomUUID(), storagePath: "pending", storageBackend: null },
    });

    const result = await resolveLearningEvidenceImageMedia(ownerUserId, assetId);
    expect(result.status).toBe("unavailable");
  });
});

async function createOwner(): Promise<string> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@l4r2-image-media-resolver.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return ownerUserId;
}
