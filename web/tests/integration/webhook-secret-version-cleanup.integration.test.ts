import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebhookDeliveryRecord, createWebhookEventRecord } from "@/lib/webhook-delivery-persistence";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import { encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { prisma } from "@/lib/prisma";
import { cleanupRetiredWebhookSecretVersions } from "@/lib/webhook-secret-version-cleanup";

const ownerUserId = "62345678-1234-1234-1234-123456789101";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("g");
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key.toString("base64");
  }
});

async function cleanupOwnerData() {
  await prisma.webhookDeliveryAttempt.deleteMany({ where: { delivery: { ownerUserId } } });
  await prisma.webhookDelivery.deleteMany({ where: { ownerUserId } });
  await prisma.webhookEvent.deleteMany({ where: { ownerUserId } });
  await prisma.webhookEndpointSecretVersion.deleteMany({ where: { ownerUserId } });
  await prisma.webhookEndpoint.deleteMany({ where: { ownerUserId } });
  await prisma.user.deleteMany({ where: { id: ownerUserId } });
}

async function createEndpointFixture() {
  const masterKey = getMasterKeyFromEnv();
  const secretEncrypted = encryptSecret(generateSecret(), ownerUserId, masterKey);

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      ownerUserId,
      name: `Cleanup Endpoint ${Date.now()}`,
      url: "https://example.com/cleanup",
      secretEncrypted,
      enabled: true,
    },
  });

  const current = await prisma.webhookEndpointSecretVersion.create({
    data: {
      webhookEndpointId: endpoint.id,
      ownerUserId,
      version: 1,
      secretEncrypted,
      signatureScheme: "hmac_sha256_v1",
      isCurrent: true,
    },
  });

  return { endpoint, current };
}

describe("webhook secret version cleanup integration", () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: ownerUserId },
      update: {},
      create: {
        id: ownerUserId,
        email: `m10c-cleanup-${Date.now()}@test.local`,
        passwordHash: "hash",
        role: "user",
        locale: "en-US",
      },
    });
  });

  afterEach(async () => {
    await cleanupOwnerData();
  });

  it("does not delete retired versions that are still within retention", async () => {
    const { endpoint } = await createEndpointFixture();

    const retired = await prisma.webhookEndpointSecretVersion.create({
      data: {
        webhookEndpointId: endpoint.id,
        ownerUserId,
        version: 2,
        secretEncrypted: encryptSecret(generateSecret(), ownerUserId, getMasterKeyFromEnv()),
        signatureScheme: "hmac_sha256_v1",
        isCurrent: false,
        retiredAt: new Date("2026-07-10T00:00:00.000Z"),
        retainUntil: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    const result = await cleanupRetiredWebhookSecretVersions({
      ownerUserId,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);

    const stillExists = await prisma.webhookEndpointSecretVersion.findUnique({ where: { id: retired.id } });
    expect(stillExists).not.toBeNull();
  });

  it("deletes expired retired versions when there are no references", async () => {
    const { endpoint } = await createEndpointFixture();

    const expired = await prisma.webhookEndpointSecretVersion.create({
      data: {
        webhookEndpointId: endpoint.id,
        ownerUserId,
        version: 2,
        secretEncrypted: encryptSecret(generateSecret(), ownerUserId, getMasterKeyFromEnv()),
        signatureScheme: "hmac_sha256_v1",
        isCurrent: false,
        retiredAt: new Date("2026-06-01T00:00:00.000Z"),
        retainUntil: new Date("2026-07-01T00:00:00.000Z"),
      },
    });

    const result = await cleanupRetiredWebhookSecretVersions({
      ownerUserId,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(1);
    expect(result.skippedReferenced).toBe(0);
    expect(result.failed).toBe(0);

    const deleted = await prisma.webhookEndpointSecretVersion.findUnique({ where: { id: expired.id } });
    expect(deleted).toBeNull();
  });

  it("keeps expired retired versions that are still referenced by deliveries", async () => {
    const { endpoint } = await createEndpointFixture();
    const masterKey = getMasterKeyFromEnv();

    const referencedRetired = await prisma.webhookEndpointSecretVersion.create({
      data: {
        webhookEndpointId: endpoint.id,
        ownerUserId,
        version: 2,
        secretEncrypted: encryptSecret(generateSecret(), ownerUserId, masterKey),
        signatureScheme: "hmac_sha256_v1",
        isCurrent: false,
        retiredAt: new Date("2026-06-01T00:00:00.000Z"),
        retainUntil: new Date("2026-07-01T00:00:00.000Z"),
      },
    });

    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "cleanup-referenced",
      }),
    });

    const delivery = await createWebhookDeliveryRecord({
      ownerUserId,
      webhookEventId: event.id,
      webhookEndpointId: endpoint.id,
    });

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        secretVersionId: referencedRetired.id,
        secretVersionSnapshot: referencedRetired.version,
      },
    });

    const result = await cleanupRetiredWebhookSecretVersions({
      ownerUserId,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(result.scanned).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.skippedReferenced).toBe(1);
    expect(result.failed).toBe(0);

    const kept = await prisma.webhookEndpointSecretVersion.findUnique({ where: { id: referencedRetired.id } });
    expect(kept).not.toBeNull();
  });

  it("never deletes current versions even if retainUntil is in the past", async () => {
    const { current } = await createEndpointFixture();

    await prisma.webhookEndpointSecretVersion.update({
      where: { id: current.id },
      data: {
        retainUntil: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    const result = await cleanupRetiredWebhookSecretVersions({
      ownerUserId,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(result.scanned).toBe(0);
    expect(result.deleted).toBe(0);

    const stillCurrent = await prisma.webhookEndpointSecretVersion.findUnique({ where: { id: current.id } });
    expect(stillCurrent?.isCurrent).toBe(true);
  });
});