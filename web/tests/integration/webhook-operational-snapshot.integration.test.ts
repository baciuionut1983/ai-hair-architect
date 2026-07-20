import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebhookDeliveryRecord, createWebhookEventRecord } from "@/lib/webhook-delivery-persistence";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import { encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { getWebhookOperationalSnapshot } from "@/lib/webhook-operational-snapshot";
import { prisma } from "@/lib/prisma";

const ownerUserId = "52345678-1234-1234-1234-123456789101";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("f");
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
      name: `Snapshot Endpoint ${Date.now()}`,
      url: "https://example.com/snapshot",
      secretEncrypted,
      enabled: true,
    },
  });

  await prisma.webhookEndpointSecretVersion.create({
    data: {
      webhookEndpointId: endpoint.id,
      ownerUserId,
      version: 1,
      secretEncrypted,
      signatureScheme: "hmac_sha256_v1",
      isCurrent: true,
    },
  });

  return endpoint;
}

async function seedDelivery(endpointId: string, resourceId: string) {
  const event = await createWebhookEventRecord({
    envelope: createWebhookEventEnvelope({
      eventType: "image.analysis.ready_for_m8",
      ownerUserId,
      resourceType: "analysis",
      resourceId,
    }),
  });

  return createWebhookDeliveryRecord({
    ownerUserId,
    webhookEventId: event.id,
    webhookEndpointId: endpointId,
  });
}

describe("webhook operational snapshot integration", () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: ownerUserId },
      update: {},
      create: {
        id: ownerUserId,
        email: `m10c-snapshot-${Date.now()}@test.local`,
        passwordHash: "hash",
        role: "user",
        locale: "en-US",
      },
    });
  });

  afterEach(async () => {
    await cleanupOwnerData();
  });

  it("computes status counters, success rate, pending age, latency, last24h and retry distribution", async () => {
    const endpoint = await createEndpointFixture();
    const now = new Date("2026-07-20T20:00:00.000Z");

    const d1 = await seedDelivery(endpoint.id, "snapshot-1");
    const d2 = await seedDelivery(endpoint.id, "snapshot-2");
    const d3 = await seedDelivery(endpoint.id, "snapshot-3");
    const d4 = await seedDelivery(endpoint.id, "snapshot-4");
    const d5 = await seedDelivery(endpoint.id, "snapshot-5");

    await prisma.webhookDelivery.update({
      where: { id: d1.id },
      data: {
        status: "delivered",
        attemptCount: 1,
        createdAt: new Date("2026-07-20T19:00:00.000Z"),
        deliveredAt: new Date("2026-07-20T19:01:00.000Z"),
      },
    });

    await prisma.webhookDelivery.update({
      where: { id: d2.id },
      data: {
        status: "delivered",
        attemptCount: 2,
        createdAt: new Date("2026-07-20T18:00:00.000Z"),
        deliveredAt: new Date("2026-07-20T18:04:00.000Z"),
      },
    });

    await prisma.webhookDelivery.update({
      where: { id: d3.id },
      data: {
        status: "failed_terminal",
        attemptCount: 4,
        createdAt: new Date("2026-07-20T17:00:00.000Z"),
        failedTerminalAt: new Date("2026-07-20T17:10:00.000Z"),
      },
    });

    await prisma.webhookDelivery.update({
      where: { id: d4.id },
      data: {
        status: "pending",
        attemptCount: 1,
        createdAt: new Date("2026-07-20T16:00:00.000Z"),
      },
    });

    await prisma.webhookDelivery.update({
      where: { id: d5.id },
      data: {
        status: "failed_retryable",
        attemptCount: 3,
        nextAttemptAt: new Date("2026-07-20T19:59:00.000Z"),
        createdAt: new Date("2026-07-20T15:00:00.000Z"),
      },
    });

    const snapshot = await getWebhookOperationalSnapshot({
      ownerUserId,
      webhookEndpointId: endpoint.id,
      now,
    });

    expect(snapshot.pendingDeliveries).toBe(1);
    expect(snapshot.dispatchingDeliveries).toBe(0);
    expect(snapshot.deliveredDeliveries).toBe(2);
    expect(snapshot.retryableDeliveries).toBe(1);
    expect(snapshot.terminalFailures).toBe(1);
    expect(snapshot.successRate).toBeCloseTo(2 / 3, 8);

    expect(snapshot.oldestPendingAgeMs).toBe(5 * 60 * 60 * 1000);
    expect(snapshot.deliveryLatencyMedianMs).toBe(150_000);
    expect(snapshot.deliveryLatencyP95Ms).toBe(240_000);

    expect(snapshot.createdLast24h).toBe(5);
    expect(snapshot.deliveredLast24h).toBe(2);
    expect(snapshot.failedLast24h).toBe(1);
    expect(snapshot.deliveriesLast24h).toBe(5);
    expect(snapshot.retryDistribution).toEqual({
      attempt1: 2,
      attempt2: 1,
      attempt3: 1,
      attempt4Plus: 1,
    });
  });

  it("keeps failedLast24h stable when updatedAt changes after terminal transition", async () => {
    const endpoint = await createEndpointFixture();
    const now = new Date("2026-07-20T20:00:00.000Z");

    const delivery = await seedDelivery(endpoint.id, "snapshot-failed-updatedAt");

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "failed_terminal",
        failedTerminalAt: new Date("2026-07-18T10:00:00.000Z"),
      },
    });

    // This second update changes updatedAt but must not influence failedLast24h inclusion.
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        leaseToken: null,
      },
    });

    const snapshot = await getWebhookOperationalSnapshot({
      ownerUserId,
      webhookEndpointId: endpoint.id,
      now,
    });

    expect(snapshot.failedLast24h).toBe(0);
  });
});