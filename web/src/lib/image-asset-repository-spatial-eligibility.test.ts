import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { listEligibleSpatialSourceImagesForClient } from "@/lib/image-asset-repository";
import { PHOTO_PREVIEW_OUTPUT_ORIGIN } from "@/lib/photo-preview-output-storage";

// Spatial Mapping revisit fix #2 (real production defect) -- real Postgres,
// separate from image-asset-repository.test.ts's own mocked-prisma suite:
// the whole point of these tests is proving the ACTUAL DB query excludes a
// real ai_generated row and includes a real upload row, which a mocked
// prisma.findMany (told exactly what to return) cannot prove on its own.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("listEligibleSpatialSourceImagesForClient -- structural provenance filtering (real Postgres)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("a real client/source photo remains selectable", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createImageAsset(ownerUserId, clientId, { fileName: "client-front.jpg", origin: "upload" });

    const images = await listEligibleSpatialSourceImagesForClient(ownerUserId, clientId);

    expect(images).toHaveLength(1);
    expect(images[0].fileName).toBe("client-front.jpg");
  });

  it("an AI-generated Photo Preview output is excluded from Spatial Mapping source candidates", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createImageAsset(ownerUserId, clientId, { fileName: "photo-preview-1234567890.png", origin: PHOTO_PREVIEW_OUTPUT_ORIGIN });

    const images = await listEligibleSpatialSourceImagesForClient(ownerUserId, clientId);

    expect(images).toHaveLength(0);
  });

  it("multiple real source images all remain available", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createImageAsset(ownerUserId, clientId, { fileName: "front.jpg", origin: "upload" });
    await createImageAsset(ownerUserId, clientId, { fileName: "back.jpg", origin: "upload" });
    await createImageAsset(ownerUserId, clientId, { fileName: "left-profile.jpg", origin: "upload" });

    const images = await listEligibleSpatialSourceImagesForClient(ownerUserId, clientId);

    expect(images.map((image) => image.fileName).sort()).toEqual(["back.jpg", "front.jpg", "left-profile.jpg"]);
  });

  it("with both an existing generated Photo Preview AND the original real source present, only the real source remains eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    await createImageAsset(ownerUserId, clientId, { fileName: "original-client-photo.jpg", origin: "upload" });
    await createImageAsset(ownerUserId, clientId, { fileName: "photo-preview-9999999999.jpg", origin: PHOTO_PREVIEW_OUTPUT_ORIGIN });

    const images = await listEligibleSpatialSourceImagesForClient(ownerUserId, clientId);

    expect(images).toHaveLength(1);
    expect(images[0].fileName).toBe("original-client-photo.jpg");
  });

  it("filtering uses structural provenance (origin), not filename: an ai_generated asset with an unrelated filename is still excluded", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    // Deliberately does NOT contain "photo-preview" anywhere in the name --
    // proves the exclusion is never a filename heuristic.
    await createImageAsset(ownerUserId, clientId, { fileName: "totally-unrelated-name.jpg", origin: PHOTO_PREVIEW_OUTPUT_ORIGIN });

    const images = await listEligibleSpatialSourceImagesForClient(ownerUserId, clientId);

    expect(images).toHaveLength(0);
  });

  it("filtering uses structural provenance (origin), not filename: a real client photo named like a Photo Preview output is NEVER excluded", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    // A real, ordinary upload that HAPPENS to be named like a generated
    // output (e.g. the professional's own camera roll naming, or a manual
    // rename) -- must remain fully eligible. Only origin decides.
    await createImageAsset(ownerUserId, clientId, { fileName: "photo-preview-of-new-style.jpg", origin: "upload" });

    const images = await listEligibleSpatialSourceImagesForClient(ownerUserId, clientId);

    expect(images).toHaveLength(1);
    expect(images[0].fileName).toBe("photo-preview-of-new-style.jpg");
  });

  it("cross-owner isolation is preserved alongside the new filter", async () => {
    const { ownerUserId: ownerA, clientId: clientA } = await createOwnerAndClient();
    const { ownerUserId: ownerB, clientId: clientB } = await createOwnerAndClient();
    await createImageAsset(ownerA, clientA, { fileName: "owner-a-photo.jpg", origin: "upload" });
    await createImageAsset(ownerB, clientB, { fileName: "owner-b-photo.jpg", origin: "upload" });

    const imagesForA = await listEligibleSpatialSourceImagesForClient(ownerA, clientA);

    expect(imagesForA).toHaveLength(1);
    expect(imagesForA[0].fileName).toBe("owner-a-photo.jpg");
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@image-asset-repository-spatial-eligibility.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Spatial Eligibility Test Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(
  ownerUserId: string,
  clientId: string,
  overrides: { fileName: string; origin: string },
) {
  return prisma.imageAsset.create({
    data: {
      id: randomUUID(),
      fileName: overrides.fileName,
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      ownerUserId,
      clientId,
      storagePath: "pending",
      origin: overrides.origin,
      width: 1080,
      height: 1440,
    },
  });
}
