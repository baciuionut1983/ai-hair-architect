import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebhookDeliveryRecord, createWebhookEventRecord } from "@/lib/webhook-delivery-persistence";
import { listWebhookDeliveryHistory, getWebhookDeliveryDetails } from "@/lib/webhook-delivery-history";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import { encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { prisma } from "@/lib/prisma";

const ownerUserId = "42345678-1234-1234-1234-123456789101";
const otherUserId = "42345678-1234-1234-1234-123456789102";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("e");
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key.toString("base64");
  }
});

async function cleanupUsers() {
  for (const userId of [ownerUserId, otherUserId]) {
    await prisma.webhookDeliveryAttempt.deleteMany({ where: { delivery: { ownerUserId: userId } } });
    await prisma.webhookDelivery.deleteMany({ where: { ownerUserId: userId } });
    await prisma.webhookEvent.deleteMany({ where: { ownerUserId: userId } });
    await prisma.webhookEndpointSecretVersion.deleteMany({ where: { ownerUserId: userId } });
    await prisma.webhookEndpoint.deleteMany({ where: { ownerUserId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

async function createEndpoint(owner: string, suffix: string) {
  const masterKey = getMasterKeyFromEnv();
  const secretEncrypted = encryptSecret(generateSecret(), owner, masterKey);

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      ownerUserId: owner,
      name: `History-${suffix}-${Date.now()}`,
      url: "https://example.com/history",
      secretEncrypted,
      enabled: true,
    },
  });

  await prisma.webhookEndpointSecretVersion.create({
    data: {
      webhookEndpointId: endpoint.id,
      ownerUserId: owner,
      version: 1,
      secretEncrypted,
      signatureScheme: "hmac_sha256_v1",
      isCurrent: true,
    },
  });

  return endpoint;
}

async function seedDelivery(owner: string, endpointId: string, idx: number) {
  const event = await createWebhookEventRecord({
    envelope: createWebhookEventEnvelope({
      eventType: idx % 2 === 0 ? "image.analysis.ready_for_m8" : "image.analysis.failed",
      ownerUserId: owner,
      resourceType: "analysis",
      resourceId: `history-${idx}-${Date.now()}`,
    }),
  });

  return createWebhookDeliveryRecord({
    ownerUserId: owner,
    webhookEventId: event.id,
    webhookEndpointId: endpointId,
  });
}

describe("webhook delivery history integration", () => {
  beforeEach(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerUserId,
          email: `m10c-history-owner-${Date.now()}@test.local`,
          passwordHash: "hash",
          role: "user",
          locale: "en-US",
        },
        {
          id: otherUserId,
          email: `m10c-history-other-${Date.now()}@test.local`,
          passwordHash: "hash",
          role: "user",
          locale: "en-US",
        },
      ],
    });
  });

  afterEach(async () => {
    await cleanupUsers();
  });

  it("lists and paginates owner-scoped delivery history", async () => {
    const endpoint = await createEndpoint(ownerUserId, "owner");

    await seedDelivery(ownerUserId, endpoint.id, 1);
    await seedDelivery(ownerUserId, endpoint.id, 2);
    await seedDelivery(ownerUserId, endpoint.id, 3);

    const page = await listWebhookDeliveryHistory({
      ownerUserId,
      webhookEndpointId: endpoint.id,
      limit: 2,
      offset: 0,
    });

    expect(page.total).toBe(3);
    expect(page.deliveries).toHaveLength(2);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(0);
  });

  it("returns delivery details only for matching owner/endpoint", async () => {
    const ownerEndpoint = await createEndpoint(ownerUserId, "details-owner");
    const otherEndpoint = await createEndpoint(otherUserId, "details-other");

    const ownerDelivery = await seedDelivery(ownerUserId, ownerEndpoint.id, 1);
    await seedDelivery(otherUserId, otherEndpoint.id, 2);

    const details = await getWebhookDeliveryDetails({
      ownerUserId,
      webhookEndpointId: ownerEndpoint.id,
      deliveryId: ownerDelivery.id,
    });

    expect(details.id).toBe(ownerDelivery.id);
    expect(details.ownerUserId).toBe(ownerUserId);

    await expect(
      getWebhookDeliveryDetails({
        ownerUserId,
        webhookEndpointId: ownerEndpoint.id,
        deliveryId: "not-a-real-delivery-id",
      }),
    ).rejects.toThrow("not found");
  });
});