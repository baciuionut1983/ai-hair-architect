import { randomUUID } from "crypto";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { PHOTO_PREVIEW_OUTPUT_ORIGIN, persistGeneratedPhotoPreviewImage, PhotoPreviewOutputStorageError } from "@/lib/photo-preview-output-storage";

// Real AI Photo Preview, Stage 2 -- real Postgres + real local-disk storage
// (no S3 credentials are configured in this environment, matching every
// other test in this codebase that exercises the upload storage path).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("photo-preview-output-storage (real AI Photo Preview, Stage 2 durable output persistence)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("persists a real generated image as a NEW ImageAsset row, tagged ai_generated, with real computed dimensions", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const buffer = await sharp({ create: { width: 64, height: 96, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

    const asset = await persistGeneratedPhotoPreviewImage(ownerUserId, clientId, buffer, "image/png");

    expect(asset.id).toBeTruthy();
    expect(asset.origin).toBe(PHOTO_PREVIEW_OUTPUT_ORIGIN);
    expect(asset.ownerUserId).toBe(ownerUserId);
    expect(asset.clientId).toBe(clientId);
    expect(asset.width).toBe(64);
    expect(asset.height).toBe(96);
    expect(asset.storagePath).not.toBe("pending"); // real bytes were actually written somewhere
  });

  it("never overwrites or reuses an existing ImageAsset id -- every call allocates a brand-new one", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();

    const first = await persistGeneratedPhotoPreviewImage(ownerUserId, clientId, buffer, "image/png");
    const second = await persistGeneratedPhotoPreviewImage(ownerUserId, clientId, buffer, "image/png");

    expect(first.id).not.toBe(second.id);
  });

  it("rejects genuinely unprocessable bytes (not a real image) with a typed, safe error -- no row left in an inconsistent state", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const notAnImage = Buffer.from("this is not a real image");

    await expect(persistGeneratedPhotoPreviewImage(ownerUserId, clientId, notAnImage, "image/png")).rejects.toBeInstanceOf(
      PhotoPreviewOutputStorageError,
    );
    // No orphaned ImageAsset row -- processing fails BEFORE any row is created.
    await expect(prisma.imageAsset.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("an existing, real client-uploaded ImageAsset's own origin is never affected by generating a preview alongside it", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const uploadBuffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toBuffer();
    const uploaded = await prisma.imageAsset.create({
      data: { id: randomUUID(), fileName: "client-photo.jpg", mimeType: "image/jpeg", sizeBytes: uploadBuffer.length, ownerUserId, clientId, storagePath: "pending" },
    });
    expect(uploaded.origin).toBe("upload"); // the default, matching every pre-Stage-2 row

    const generatedBuffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();
    const generated = await persistGeneratedPhotoPreviewImage(ownerUserId, clientId, generatedBuffer, "image/png");

    const rereadUpload = await prisma.imageAsset.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(rereadUpload.origin).toBe("upload"); // untouched
    expect(generated.origin).toBe("ai_generated");
    expect(generated.id).not.toBe(uploaded.id);
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@photo-preview-output-storage.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Photo Preview Output Storage Client" } });
  return { ownerUserId, clientId };
}
