import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deleteImageFile, saveImageFile } from "@/lib/image-storage";
import { resolveLearningEvidenceVideoMedia } from "@/lib/professional-learning-video-media-resolver";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1 -- real
// Postgres + real local file, no mocks. Mirrors professional-learning-
// image-media-resolver.test.ts's own fixture pattern exactly -- reuses
// saveImageFile/deleteImageFile for the local video bytes (already
// content-agnostic, see the resolver's own header comment).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();
const localPaths = new Set<string>();
const FAKE_MP4_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 1, 2, 3, 4]);

suite("resolveLearningEvidenceVideoMedia (Stage 8.5L5.R1, real DB + real local file)", () => {
  afterEach(async () => {
    for (const path of localPaths) {
      await deleteImageFile(path).catch(() => undefined);
    }
    localPaths.clear();
    const ownerUserIds = [...owners];
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("resolves the real bytes for an owned, available, local-backend video asset", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(ownerUserId, assetId, "video.mp4", FAKE_MP4_BYTES);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: FAKE_MP4_BYTES.length, storagePath, storageBackend: null, origin: "uploaded_source" },
    });

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.media.mimeType).toBe("video/mp4");
    expect(Buffer.compare(result.media.buffer, FAKE_MP4_BYTES)).toBe(0);
  });

  it("IDOR: another user cannot resolve media for User A's video asset -- indistinguishable from nonexistent", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const userB = await createOwner();
    const assetId = randomUUID();
    const storagePath = await saveImageFile(userA, assetId, "video.mp4", FAKE_MP4_BYTES);
    localPaths.add(storagePath);
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId: userA, clientId, mimeType: "video/mp4", sizeBytes: FAKE_MP4_BYTES.length, storagePath, storageBackend: null, origin: "uploaded_source" },
    });

    const asUserA = await resolveLearningEvidenceVideoMedia(userA, assetId);
    const asUserB = await resolveLearningEvidenceVideoMedia(userB, assetId);

    expect(asUserA.status).toBe("resolved");
    expect(asUserB).toEqual({ status: "unavailable", reason: "VIDEO_ASSET_NOT_FOUND" });
  });

  it("returns unavailable (never throws) for a nonexistent asset id", async () => {
    const ownerUserId = await createOwner();
    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, randomUUID());
    expect(result).toEqual({ status: "unavailable", reason: "VIDEO_ASSET_NOT_FOUND" });
  });

  it("returns unavailable for an asset whose bytes were never actually stored (storagePath = pending)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    await prisma.videoAsset.create({
      data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 100, storagePath: "pending", storageBackend: null, origin: "uploaded_source" },
    });

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId);
    expect(result).toEqual({ status: "unavailable", reason: "VIDEO_UNAVAILABLE" });
  });

  it("honestly reports S3-backed rows as not-yet-implemented rather than fabricating bytes", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const assetId = randomUUID();
    await prisma.videoAsset.create({
      data: {
        id: assetId,
        ownerUserId,
        clientId,
        mimeType: "video/mp4",
        sizeBytes: FAKE_MP4_BYTES.length,
        storagePath: "owners/x/assets/y/original",
        storageBackend: "s3",
        origin: "uploaded_source",
      },
    });

    const result = await resolveLearningEvidenceVideoMedia(ownerUserId, assetId);
    expect(result).toEqual({ status: "unavailable", reason: "VIDEO_S3_READ_NOT_IMPLEMENTED" });
  });
});

async function createOwner(): Promise<string> {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@l5r1-video-media-resolver.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return ownerUserId;
}

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = await createOwner();
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5.R1 Video Media Resolver Client" } });
  return { ownerUserId, clientId };
}
