import { createHash, randomUUID } from "crypto";
import fs from "fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

import { POST as retentionRunRoute } from "@/app/api/v1/ops/image-assets/retention/run/route";
import { createPersistenceSession } from "@/lib/auth-persistence";
import { getStoragePath } from "@/lib/image-storage";
import { prisma } from "@/lib/prisma";

async function createPersistedOwner(emailPrefix: string): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: "hash",
      role: "professional",
      locale: "en",
    },
  });
  const token = `m36-retention-token-${user.id}`;
  await createPersistenceSession(token, user.id);
  return { id: user.id, token };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createEligibleLocalAsset(ownerUserId: string, clientId: string, retentionDeletesAt: Date): Promise<{ id: string; filePath: string }> {
  const assetId = randomUUID();
  const fileName = "photo.jpg";
  const content = Buffer.from(`m36-retention-fixture-${assetId}`);
  const filePath = getStoragePath(ownerUserId, assetId, fileName);
  fs.mkdirSync(filePath.slice(0, filePath.length - fileName.length - 1), { recursive: true });
  fs.writeFileSync(filePath, content);

  await prisma.imageAsset.create({
    data: {
      id: assetId,
      fileName,
      mimeType: "image/jpeg",
      sizeBytes: content.byteLength,
      ownerUserId,
      clientId,
      storagePath: filePath,
      contentSha256: sha256(content),
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
      retentionDeletesAt,
    },
  });

  return { id: assetId, filePath };
}

describe("M36 image asset retention purge", () => {
  const createdUserIds: string[] = [];
  const createdClientIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    createdUserIds.length = 0;
    createdClientIds.length = 0;
  });

  afterEach(async () => {
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
    await prisma.opsImageAssetRetentionRun.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("dry run reports the eligible count without deleting anything", async () => {
    const owner = await createPersistedOwner("m36-dryrun");
    createdUserIds.push(owner.id);
    const client = await prisma.client.create({ data: { ownerUserId: owner.id, fullName: "M36 Client" } });
    createdClientIds.push(client.id);

    const asset = await createEligibleLocalAsset(owner.id, client.id, new Date("2026-01-31T00:00:00.000Z"));

    vi.mocked(cookiesMock.cookies).mockResolvedValue({ get: () => ({ value: owner.token }) } as never);

    const response = await retentionRunRoute({ json: async () => ({ dryRun: true }) } as never);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { eligibleCount: number; purgedCount: number; dryRun: boolean } };
    expect(payload.result).toMatchObject({ eligibleCount: 1, purgedCount: 0, dryRun: true });

    expect(fs.existsSync(asset.filePath)).toBe(true);
    const stillThere = await prisma.imageAsset.findUnique({ where: { id: asset.id } });
    expect(stillThere).not.toBeNull();
  });

  it("real execution deletes the real file and hard-deletes the DB row, both confirmed via Postgres and the filesystem", async () => {
    const owner = await createPersistedOwner("m36-execute");
    createdUserIds.push(owner.id);
    const client = await prisma.client.create({ data: { ownerUserId: owner.id, fullName: "M36 Client" } });
    createdClientIds.push(client.id);

    const asset = await createEligibleLocalAsset(owner.id, client.id, new Date("2026-01-31T00:00:00.000Z"));
    expect(fs.existsSync(asset.filePath)).toBe(true);

    vi.mocked(cookiesMock.cookies).mockResolvedValue({ get: () => ({ value: owner.token }) } as never);

    const response = await retentionRunRoute({
      json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    } as never);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { eligibleCount: number; purgedCount: number; failedCount: number } };
    expect(payload.result).toMatchObject({ eligibleCount: 1, purgedCount: 1, failedCount: 0 });

    expect(fs.existsSync(asset.filePath)).toBe(false);
    const dbRow = await prisma.imageAsset.findUnique({ where: { id: asset.id } });
    expect(dbRow).toBeNull();

    const runs = await prisma.opsImageAssetRetentionRun.findMany({ where: { ownerUserId: owner.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "execution_completed", purgedCount: 1, failedCount: 0 });
  });

  it("never touches a row that has not yet reached its retention deadline", async () => {
    const owner = await createPersistedOwner("m36-not-yet");
    createdUserIds.push(owner.id);
    const client = await prisma.client.create({ data: { ownerUserId: owner.id, fullName: "M36 Client" } });
    createdClientIds.push(client.id);

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const asset = await createEligibleLocalAsset(owner.id, client.id, future);

    vi.mocked(cookiesMock.cookies).mockResolvedValue({ get: () => ({ value: owner.token }) } as never);

    const response = await retentionRunRoute({
      json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }),
    } as never);

    const payload = (await response.json()) as { result: { eligibleCount: number; purgedCount: number } };
    expect(payload.result).toMatchObject({ eligibleCount: 0, purgedCount: 0 });
    expect(fs.existsSync(asset.filePath)).toBe(true);
    const stillThere = await prisma.imageAsset.findUnique({ where: { id: asset.id } });
    expect(stillThere).not.toBeNull();
  });

  it("is strictly owner-scoped: purging one owner's queue never touches another owner's eligible asset", async () => {
    const ownerA = await createPersistedOwner("m36-owner-a");
    const ownerB = await createPersistedOwner("m36-owner-b");
    createdUserIds.push(ownerA.id, ownerB.id);
    const clientA = await prisma.client.create({ data: { ownerUserId: ownerA.id, fullName: "A" } });
    const clientB = await prisma.client.create({ data: { ownerUserId: ownerB.id, fullName: "B" } });
    createdClientIds.push(clientA.id, clientB.id);

    const assetA = await createEligibleLocalAsset(ownerA.id, clientA.id, new Date("2026-01-31T00:00:00.000Z"));
    const assetB = await createEligibleLocalAsset(ownerB.id, clientB.id, new Date("2026-01-31T00:00:00.000Z"));

    vi.mocked(cookiesMock.cookies).mockResolvedValue({ get: () => ({ value: ownerA.token }) } as never);
    await retentionRunRoute({ json: async () => ({ dryRun: false, confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION" }) } as never);

    expect(await prisma.imageAsset.findUnique({ where: { id: assetA.id } })).toBeNull();
    expect(fs.existsSync(assetA.filePath)).toBe(false);

    const stillThereB = await prisma.imageAsset.findUnique({ where: { id: assetB.id } });
    expect(stillThereB).not.toBeNull();
    expect(fs.existsSync(assetB.filePath)).toBe(true);
  });

  it("replays the same result for a repeated idempotency key without deleting twice", async () => {
    const owner = await createPersistedOwner("m36-idempotent");
    createdUserIds.push(owner.id);
    const client = await prisma.client.create({ data: { ownerUserId: owner.id, fullName: "M36 Client" } });
    createdClientIds.push(client.id);

    const asset = await createEligibleLocalAsset(owner.id, client.id, new Date("2026-01-31T00:00:00.000Z"));

    vi.mocked(cookiesMock.cookies).mockResolvedValue({ get: () => ({ value: owner.token }) } as never);

    const requestBody = {
      dryRun: false,
      confirmationToken: "CONFIRM_IMAGE_ASSET_RETENTION_EXECUTION",
      executionIdempotencyKey: `m36-idem-${asset.id}`,
    };

    const first = await retentionRunRoute({ json: async () => requestBody } as never);
    const firstPayload = (await first.json()) as { result: { runId: string; purgedCount: number; replayed: boolean } };
    expect(firstPayload.result).toMatchObject({ purgedCount: 1, replayed: false });

    const second = await retentionRunRoute({ json: async () => requestBody } as never);
    const secondPayload = (await second.json()) as { result: { runId: string; purgedCount: number; replayed: boolean } };
    expect(secondPayload.result.runId).toBe(firstPayload.result.runId);
    expect(secondPayload.result.replayed).toBe(true);

    const runs = await prisma.opsImageAssetRetentionRun.findMany({ where: { ownerUserId: owner.id } });
    expect(runs).toHaveLength(1);
  });

  it("returns 401 without a valid session, never reaching Postgres", async () => {
    vi.mocked(cookiesMock.cookies).mockResolvedValue({ get: () => undefined } as never);

    const response = await retentionRunRoute({ json: async () => ({ dryRun: true }) } as never);
    expect(response.status).toBe(401);
  });
});
