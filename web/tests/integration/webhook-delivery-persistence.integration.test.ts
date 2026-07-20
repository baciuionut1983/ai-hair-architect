import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import {
  cancelWebhookDelivery,
  createWebhookDeliveryRecord,
  createWebhookEventRecord,
  expireWebhookDeliveryLease,
  finalizeWebhookDeliveryAttempt,
  startWebhookDeliveryAttempt,
} from "@/lib/webhook-delivery-persistence";

const ownerUserId = "12345678-1234-1234-1234-123456789101";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("b");
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
      name: `M10A Webhook ${Date.now()}`,
      url: "https://example.com/hook",
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

describe("webhook delivery persistence integration", () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: ownerUserId },
      update: {},
      create: {
        id: ownerUserId,
        email: `m10a-${Date.now()}@test.local`,
        passwordHash: "hash",
        role: "user",
        locale: "en-US",
      },
    });
  });

  afterEach(async () => {
    await cleanupOwnerData();
  });

  it("creates idempotent events when producer key is present", async () => {
    const envelope = createWebhookEventEnvelope({
      eventType: "image.analysis.ready_for_m8",
      ownerUserId,
      resourceType: "analysis",
      resourceId: "analysis-1",
      producerIdempotencyKey: "image-analysis/ready-for-m8/analysis-1",
      data: { analysisId: "analysis-1" },
    });

    const first = await createWebhookEventRecord({ envelope });
    const second = await createWebhookEventRecord({ envelope });

    expect(first.id).toBe(second.id);
    expect(await prisma.webhookEvent.count({ where: { ownerUserId } })).toBe(1);
  });

  it("creates distinct events when producer key is absent", async () => {
    const first = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.failed",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-2",
      }),
    });

    const second = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.failed",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-2",
      }),
    });

    expect(first.id).not.toBe(second.id);
  });

  it("creates a delivery with endpoint and secret snapshots", async () => {
    const { endpoint, secretVersion } = await createEndpointFixture();
    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-3",
        producerIdempotencyKey: "image-analysis/ready-for-m8/analysis-3",
      }),
    });

    const delivery = await createWebhookDeliveryRecord({
      ownerUserId,
      webhookEventId: event.id,
      webhookEndpointId: endpoint.id,
      approvedHeadersSnapshot: { "X-Test": "true" },
    });

    expect(delivery.secretVersionId).toBe(secretVersion.id);
    expect(delivery.targetUrlSnapshot).toBe(endpoint.url);
    expect(delivery.signatureSchemeSnapshot).toBe(secretVersion.signatureScheme);
    expect(delivery.secretVersionSnapshot).toBe(1);
  });

  it("creates incomplete attempts and finalizes them atomically", async () => {
    const { endpoint } = await createEndpointFixture();
    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-4",
      }),
    });
    const delivery = await createWebhookDeliveryRecord({ ownerUserId, webhookEventId: event.id, webhookEndpointId: endpoint.id });

    const attempt = await startWebhookDeliveryAttempt(delivery.id, "lease-1", new Date(Date.now() + 30_000));
    expect(attempt.completedAt).toBeNull();
    expect(attempt.outcome).toBeNull();

    const finalized = await finalizeWebhookDeliveryAttempt({
      attemptId: attempt.id,
      deliveryId: delivery.id,
      status: "failed_retryable",
      outcome: "retryable_failure",
      failureDomain: "destination",
      failureCode: "timeout",
      errorCode: "TIMEOUT",
      errorMessageSafe: "timed out",
    });

    expect(finalized.attempt.outcome).toBe("retryable_failure");
    expect(finalized.delivery.status).toBe("failed_retryable");
  });

  it("supports cancel and lease-expiry transitions", async () => {
    const { endpoint } = await createEndpointFixture();
    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "analysis-5",
      }),
    });

    const cancelable = await createWebhookDeliveryRecord({ ownerUserId, webhookEventId: event.id, webhookEndpointId: endpoint.id });
    const canceled = await cancelWebhookDelivery(cancelable.id);
    expect(canceled.status).toBe("canceled");

    const retryable = await createWebhookDeliveryRecord({
      ownerUserId,
      webhookEventId: (
        await createWebhookEventRecord({
          envelope: createWebhookEventEnvelope({
            eventType: "image.analysis.failed",
            ownerUserId,
            resourceType: "analysis",
            resourceId: "analysis-6",
          }),
        })
      ).id,
      webhookEndpointId: endpoint.id,
    });

    await startWebhookDeliveryAttempt(retryable.id, "lease-2", new Date(Date.now() + 30_000));
    const expired = await expireWebhookDeliveryLease(retryable.id);
    expect(expired.status).toBe("failed_retryable");
  });
});