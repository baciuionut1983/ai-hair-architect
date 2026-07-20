import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import { encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { createWebhookDeliveryRecord, createWebhookEventRecord } from "@/lib/webhook-delivery-persistence";
import { processWebhookDeliveryBatch } from "@/lib/webhook-delivery-worker";

const ownerUserId = "22345678-1234-1234-1234-123456789101";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("c");
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = key.toString("base64");
  }
});

async function cleanupOwnerData() {
  await prisma.webhookDeliveryAttempt.deleteMany({
    where: {
      delivery: {
        ownerUserId,
      },
    },
  });

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
      name: `M10B Worker ${Date.now()}`,
      url: "https://example.com/hook",
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

describe("webhook delivery worker integration", () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: ownerUserId },
      update: {},
      create: {
        id: ownerUserId,
        email: `m10b-${Date.now()}@test.local`,
        passwordHash: "hash",
        role: "user",
        locale: "en-US",
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupOwnerData();
  });

  it("delivers a webhook and records a successful attempt", async () => {
    const endpoint = await createEndpointFixture();
    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-deliver-1",
      }),
    });

    await createWebhookDeliveryRecord({
      ownerUserId,
      webhookEventId: event.id,
      webhookEndpointId: endpoint.id,
    });

    const sendRequest = vi.fn().mockResolvedValue({
      statusCode: 200,
      responseTimeMs: 22,
      truncated: false,
    });

    const result = await processWebhookDeliveryBatch({
      client: prisma,
      sendRequest: sendRequest as never,
      now: new Date("2026-07-20T12:00:00.000Z"),
      random: () => 0,
    });

    expect(result.processed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(sendRequest).toHaveBeenCalledTimes(1);

    const delivery = await prisma.webhookDelivery.findFirstOrThrow({
      where: { ownerUserId },
    });

    expect(delivery.status).toBe("delivered");
    expect(delivery.deliveredAt).not.toBeNull();

    const attempt = await prisma.webhookDeliveryAttempt.findFirstOrThrow({
      where: { webhookDeliveryId: delivery.id },
    });

    expect(attempt.outcome).toBe("success");
    expect(attempt.httpStatus).toBe(200);
  });

  it("schedules retryable failures with standard backoff after connectivity retries are exhausted", async () => {
    const endpoint = await createEndpointFixture();
    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.failed",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-deliver-2",
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
        attemptCount: 3,
      },
    });

    const sendRequest = vi.fn().mockResolvedValue({
      statusCode: 500,
      responseTimeMs: 19,
      truncated: false,
    });

    await processWebhookDeliveryBatch({
      client: prisma,
      sendRequest: sendRequest as never,
      now: new Date("2026-07-20T12:00:00.000Z"),
      random: () => 0,
    });

    const updated = await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });

    expect(updated.status).toBe("failed_retryable");
    expect(updated.nextAttemptAt).toBeInstanceOf(Date);
    expect(updated.nextAttemptAt?.toISOString()).toBe("2026-07-20T12:04:00.000Z");
  });
});