import { createHash, randomUUID } from "crypto";
import fs from "fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as automationRunRoute } from "@/app/api/v1/ops/image-assets/retention/automation-run/route";
import { getStoragePath } from "@/lib/image-storage";
import { prisma } from "@/lib/prisma";

const TOKEN = "m37-integration-secret";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createEligibleLocalAsset(ownerUserId: string, clientId: string, retentionDeletesAt: Date): Promise<{ id: string; filePath: string }> {
  const assetId = randomUUID();
  const fileName = "photo.jpg";
  const content = Buffer.from(`m37-automation-fixture-${assetId}`);
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

function post(body: unknown): Promise<Response> {
  return automationRunRoute(
    new Request("http://localhost/api/v1/ops/image-assets/retention/automation-run", {
      method: "POST",
      headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
      body: JSON.stringify(body),
    }),
  );
}

describe("M37 image asset retention automation sweep", () => {
  const createdUserIds: string[] = [];
  const originalToken = process.env.RETENTION_AUTOMATION_TOKEN;

  beforeEach(() => {
    process.env.RETENTION_AUTOMATION_TOKEN = TOKEN;
    createdUserIds.length = 0;
  });

  afterEach(async () => {
    if (originalToken === undefined) delete process.env.RETENTION_AUTOMATION_TOKEN;
    else process.env.RETENTION_AUTOMATION_TOKEN = originalToken;

    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
    await prisma.opsImageAssetRetentionRun.deleteMany({ where: { ownerUserId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("sweeps across multiple owners for real: purges every eligible owner's asset, leaves a not-yet-eligible one untouched", async () => {
    const ownerA = await prisma.user.create({ data: { email: `m37-a-${Date.now()}@example.com`, passwordHash: "hash", role: "professional", locale: "en" } });
    const ownerB = await prisma.user.create({ data: { email: `m37-b-${Date.now()}@example.com`, passwordHash: "hash", role: "professional", locale: "en" } });
    const ownerC = await prisma.user.create({ data: { email: `m37-c-${Date.now()}@example.com`, passwordHash: "hash", role: "professional", locale: "en" } });
    createdUserIds.push(ownerA.id, ownerB.id, ownerC.id);

    const clientA = await prisma.client.create({ data: { ownerUserId: ownerA.id, fullName: "A" } });
    const clientB = await prisma.client.create({ data: { ownerUserId: ownerB.id, fullName: "B" } });
    const clientC = await prisma.client.create({ data: { ownerUserId: ownerC.id, fullName: "C" } });

    const assetA = await createEligibleLocalAsset(ownerA.id, clientA.id, new Date("2026-01-31T00:00:00.000Z"));
    const assetB = await createEligibleLocalAsset(ownerB.id, clientB.id, new Date("2026-01-31T00:00:00.000Z"));
    const notYetEligible = await createEligibleLocalAsset(ownerC.id, clientC.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    // Dry run first: nothing should be deleted, but both eligible owners counted.
    const dryRunResponse = await post({ dryRun: true });
    expect(dryRunResponse.status).toBe(200);
    const dryRunPayload = (await dryRunResponse.json()) as { result: { ownersProcessed: number; totalEligible: number; totalPurged: number } };
    expect(dryRunPayload.result.ownersProcessed).toBeGreaterThanOrEqual(2);
    expect(dryRunPayload.result.totalPurged).toBe(0);
    expect(fs.existsSync(assetA.filePath)).toBe(true);
    expect(fs.existsSync(assetB.filePath)).toBe(true);

    // Real execution.
    const response = await post({ dryRun: false });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { result: { ownersProcessed: number; ownersFailed: number; totalPurged: number } };
    expect(payload.result.ownersFailed).toBe(0);
    expect(payload.result.totalPurged).toBeGreaterThanOrEqual(2);

    expect(fs.existsSync(assetA.filePath)).toBe(false);
    expect(fs.existsSync(assetB.filePath)).toBe(false);
    expect(await prisma.imageAsset.findUnique({ where: { id: assetA.id } })).toBeNull();
    expect(await prisma.imageAsset.findUnique({ where: { id: assetB.id } })).toBeNull();

    // The not-yet-eligible owner's asset must survive untouched.
    expect(fs.existsSync(notYetEligible.filePath)).toBe(true);
    expect(await prisma.imageAsset.findUnique({ where: { id: notYetEligible.id } })).not.toBeNull();
  });

  it("returns zero counts and never calls storage when nothing is eligible", async () => {
    const owner = await prisma.user.create({ data: { email: `m37-none-${Date.now()}@example.com`, passwordHash: "hash", role: "professional", locale: "en" } });
    createdUserIds.push(owner.id);
    const client = await prisma.client.create({ data: { ownerUserId: owner.id, fullName: "None" } });
    const future = await createEligibleLocalAsset(owner.id, client.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    const response = await post({ dryRun: false });
    const payload = (await response.json()) as { result: { totalEligible: number; totalPurged: number } };

    expect(payload.result.totalPurged).toBe(0);
    expect(fs.existsSync(future.filePath)).toBe(true);
  });

  it("rejects an unauthorized request before touching Postgres", async () => {
    const response = await automationRunRoute(
      new Request("http://localhost/api/v1/ops/image-assets/retention/automation-run", {
        method: "POST",
        headers: new Headers({ authorization: "Bearer wrong-token" }),
        body: JSON.stringify({ dryRun: false }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("fails closed with 503 when the automation secret is unconfigured", async () => {
    delete process.env.RETENTION_AUTOMATION_TOKEN;
    const response = await automationRunRoute(
      new Request("http://localhost/api/v1/ops/image-assets/retention/automation-run", {
        method: "POST",
        headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
        body: JSON.stringify({ dryRun: false }),
      }),
    );
    expect(response.status).toBe(503);
  });
});
