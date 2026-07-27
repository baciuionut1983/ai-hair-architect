import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { ImageAssetStorageRepository } from "@/lib/image-asset-storage-repository";
import { prisma } from "@/lib/prisma";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const isolatedDatabase = isIsolatedTestDatabase(testDatabaseUrl);
const suite = isolatedDatabase ? describe : describe.skip;
const ownerUserIds = new Set<string>();

suite("M15 object storage PostgreSQL metadata", () => {
  afterEach(async () => {
    const ids = [...ownerUserIds];
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    ownerUserIds.clear();
  });

  it("preserves a legacy ImageAsset with all additive storage fields null", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const asset = await prisma.imageAsset.create({
      data: {
        fileName: "m15-synthetic.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 3,
        ownerUserId,
        clientId,
        storagePath: "synthetic/legacy/path.jpg"
      }
    });

    expect(asset).toMatchObject({
      storagePath: "synthetic/legacy/path.jpg",
      storageBackend: null,
      storageBucketAlias: null,
      storageKey: null,
      storageVersionId: null,
      storageEtag: null,
      contentSha256: null,
      storageState: null,
      storageMigratedAt: null,
      objectDeletedAt: null,
      lastStorageErrorCode: null
    });
  });

  it("enforces owner-scoped repository lookup in PostgreSQL", async () => {
    const first = await createOwnerAndClient();
    const second = await createOwnerAndClient();
    const asset = await prisma.imageAsset.create({
      data: {
        fileName: "m15-owner-scope.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 3,
        ownerUserId: first.ownerUserId,
        clientId: first.clientId,
        storagePath: "synthetic/owner/path.jpg"
      }
    });
    const repository = new ImageAssetStorageRepository(prisma);

    await expect(repository.findByOwner(first.ownerUserId, asset.id)).resolves.toMatchObject({ id: asset.id });
    await expect(repository.findByOwner(second.ownerUserId, asset.id)).resolves.toBeNull();
  });
});

async function createOwnerAndClient(): Promise<{ ownerUserId: string; clientId: string }> {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  ownerUserIds.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `m15-${ownerUserId}@example.invalid`,
      passwordHash: "synthetic-not-authenticatable",
      role: "professional",
      locale: "en"
    }
  });
  await prisma.client.create({
    data: { id: clientId, ownerUserId, fullName: "M15 Synthetic Client" }
  });
  return { ownerUserId, clientId };
}

function isIsolatedTestDatabase(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const databaseName = new URL(rawUrl).pathname.replace(/^\//, "").toLowerCase();
    return databaseName.includes("test") && !/(prod|production|live)/.test(databaseName);
  } catch {
    return false;
  }
}