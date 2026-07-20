import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import { createWebhookDeliveryRecord, createWebhookEventRecord } from "@/lib/webhook-delivery-persistence";

const ownerA = "12345678-1234-1234-1234-123456789201";
const ownerB = "12345678-1234-1234-1234-123456789202";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("c");
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key.toString("base64");
  }
});

async function cleanup() {
  await prisma.webhookDeliveryAttempt.deleteMany({
    where: {
      delivery: {
        ownerUserId: { in: [ownerA, ownerB] },
      },
    },
  });
  await prisma.webhookDelivery.deleteMany({ where: { ownerUserId: { in: [ownerA, ownerB] } } });
  await prisma.webhookEvent.deleteMany({ where: { ownerUserId: { in: [ownerA, ownerB] } } });
  await prisma.webhookEndpointSecretVersion.deleteMany({ where: { ownerUserId: { in: [ownerA, ownerB] } } });
  await prisma.webhookEndpoint.deleteMany({ where: { ownerUserId: { in: [ownerA, ownerB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerA, ownerB] } } });
}

async function createEndpoint(ownerUserId: string) {
  const secretEncrypted = encryptSecret(generateSecret(), ownerUserId, getMasterKeyFromEnv());
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      ownerUserId,
      name: `Endpoint-${ownerUserId}-${Date.now()}`,
      url: `https://${ownerUserId}.example.com/webhook`,
      secretEncrypted,
      enabled: true,
    },
  });

  const secretVersion = await prisma.webhookEndpointSecretVersion.create({
    data: {
      webhookEndpointId: endpoint.id,
      ownerUserId,
      version: 1,
      secretEncrypted,
      signatureScheme: "hmac_sha256_v1",
      isCurrent: true,
    },
  });

  return { endpoint, secretVersion };
}

describe("webhook owner consistency integration", () => {
  beforeEach(async () => {
    for (const [userId, suffix] of [[ownerA, "a"], [ownerB, "b"]] as const) {
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          email: `${suffix}-${Date.now()}@test.local`,
          passwordHash: "hash",
          role: "user",
          locale: "en-US",
        },
      });
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  it("prevents linking owner A event to owner B endpoint via service layer", async () => {
    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId: ownerA,
        resourceType: "analysis",
        resourceId: "analysis-owner-a",
      }),
    });

    const { endpoint } = await createEndpoint(ownerB);

    await expect(
      createWebhookDeliveryRecord({
        ownerUserId: ownerA,
        webhookEventId: event.id,
        webhookEndpointId: endpoint.id,
      })
    ).rejects.toThrow("Webhook endpoint not found for owner");
  });

  it("prevents direct DB insert with mismatched endpoint and secret version", async () => {
    const { endpoint: endpointA } = await createEndpoint(ownerA);
    const { secretVersion: secretVersionB } = await createEndpoint(ownerB);

    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.failed",
        ownerUserId: ownerA,
        resourceType: "analysis",
        resourceId: "analysis-direct-db",
      }),
    });

    await expect(
      prisma.webhookDelivery.create({
        data: {
          ownerUserId: ownerA,
          webhookEventId: event.id,
          webhookEndpointId: endpointA.id,
          secretVersionId: secretVersionB.id,
          status: "pending",
          idempotencyKey: `direct/${Date.now()}`,
          targetUrlSnapshot: endpointA.url,
          signatureSchemeSnapshot: "hmac_sha256_v1",
          secretVersionSnapshot: 1,
          eventTypeSnapshot: event.eventType,
        },
      })
    ).rejects.toThrow();
  });
});