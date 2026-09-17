import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { recordUploadedVideoAssetDuration } from "@/lib/video-asset-storage";

// AI Hair Architect, Professional Skill Engine Stage 8.5T1.3.R1 -- proves
// recordUploadedVideoAssetDuration's own safety properties against real
// Postgres: ownership-scoping, origin-scoping (never touching a
// generated-output row), write-once, and sanity-bounding an insane
// value. Mirrors professional-learning-draft-real-extractor-acceptance.
// test.ts's own real-DB fixture discipline (owners/cleanup).
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("recordUploadedVideoAssetDuration (Stage 8.5T1.3.R1)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("persists an authoritative duration, in seconds, onto the exact owned uploaded_source VideoAsset row", async () => {
    const { ownerUserId, assetId } = await createUploadedSourceVideoAsset();

    await recordUploadedVideoAssetDuration(ownerUserId, assetId, 67.335);

    const reloaded = await prisma.videoAsset.findUnique({ where: { id: assetId } });
    expect(reloaded?.durationSeconds).toBe(67.335);
  });

  it("a wrong owner cannot alter another owner's video duration", async () => {
    const { assetId } = await createUploadedSourceVideoAsset();
    const { ownerUserId: attacker } = await createOwner();

    await recordUploadedVideoAssetDuration(attacker, assetId, 999);

    const reloaded = await prisma.videoAsset.findUnique({ where: { id: assetId } });
    expect(reloaded?.durationSeconds).toBeNull();
  });

  it("an arbitrary/nonexistent videoAssetId cannot set duration on anything", async () => {
    const { ownerUserId } = await createOwner();

    await expect(recordUploadedVideoAssetDuration(ownerUserId, randomUUID(), 30)).resolves.toBeUndefined();
  });

  it("never overwrites an already-recorded value (write-once, idempotent across reanalysis retries)", async () => {
    const { ownerUserId, assetId } = await createUploadedSourceVideoAsset();
    await recordUploadedVideoAssetDuration(ownerUserId, assetId, 60);

    await recordUploadedVideoAssetDuration(ownerUserId, assetId, 90);

    const reloaded = await prisma.videoAsset.findUnique({ where: { id: assetId } });
    expect(reloaded?.durationSeconds).toBe(60);
  });

  it("never touches a generated-output video's own (unrelated) duration semantics, even with the correct owner and id", async () => {
    const { ownerUserId, clientId } = await createOwner();
    const generatedAssetId = randomUUID();
    await prisma.videoAsset.create({
      data: {
        id: generatedAssetId,
        ownerUserId,
        clientId,
        mimeType: "video/mp4",
        sizeBytes: 100,
        storagePath: "pending",
        origin: "generated_output",
        durationSeconds: 8,
      },
    });

    await recordUploadedVideoAssetDuration(ownerUserId, generatedAssetId, 67);

    const reloaded = await prisma.videoAsset.findUnique({ where: { id: generatedAssetId } });
    expect(reloaded?.durationSeconds).toBe(8);
  });

  it.each([
    ["negative", -5],
    ["zero", 0],
    ["non-finite", Number.NaN],
    ["absurdly large (garbled parse)", 999_999_999],
  ])("ignores an insane duration value (%s) rather than persisting it as fact", async (_label, insaneValue) => {
    const { ownerUserId, assetId } = await createUploadedSourceVideoAsset();

    await recordUploadedVideoAssetDuration(ownerUserId, assetId, insaneValue);

    const reloaded = await prisma.videoAsset.findUnique({ where: { id: assetId } });
    expect(reloaded?.durationSeconds).toBeNull();
  });
});

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@video-asset-storage.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "T1.3.R1 Duration Test Client" } });
  return { ownerUserId, clientId };
}

async function createUploadedSourceVideoAsset() {
  const { ownerUserId, clientId } = await createOwner();
  const assetId = randomUUID();
  await prisma.videoAsset.create({
    data: { id: assetId, ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 100, storagePath: "pending", origin: "uploaded_source" },
  });
  return { ownerUserId, clientId, assetId };
}
