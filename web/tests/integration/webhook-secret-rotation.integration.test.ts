import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebhookDeliveryRecord, createWebhookEventRecord } from "@/lib/webhook-delivery-persistence";
import { createWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";
import { decryptSecret, encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { prisma } from "@/lib/prisma";
import {
  computeSecretRetainUntil,
  rotateWebhookSecret,
  WEBHOOK_SECRET_RETENTION_DAYS,
} from "@/lib/webhook-secret-rotation";

const ownerUserId = "32345678-1234-1234-1234-123456789101";

beforeAll(() => {
  if (!process.env.WEBHOOK_SECRET_ENCRYPTION_KEY) {
    const key = Buffer.alloc(32);
    key.fill("d");
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

async function createEndpointWithCurrentSecret() {
  const masterKey = getMasterKeyFromEnv();
  const secretEncrypted = encryptSecret(generateSecret(), ownerUserId, masterKey);

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      ownerUserId,
      name: `Rotate Target ${Date.now()}`,
      url: "https://example.com/hook",
      secretEncrypted,
      enabled: true,
    },
  });

  const version = await prisma.webhookEndpointSecretVersion.create({
    data: {
      webhookEndpointId: endpoint.id,
      ownerUserId,
      version: 1,
      secretEncrypted,
      signatureScheme: "hmac_sha256_v1",
      isCurrent: true,
    },
  });

  return { endpoint, version };
}

describe("webhook secret rotation integration", () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: ownerUserId },
      update: {},
      create: {
        id: ownerUserId,
        email: `m10c-rotation-${Date.now()}@test.local`,
        passwordHash: "hash",
        role: "user",
        locale: "en-US",
      },
    });
  });

  afterEach(async () => {
    await cleanupOwnerData();
  });

  it("retires previous secret version and creates a new current version", async () => {
    const { endpoint, version } = await createEndpointWithCurrentSecret();
    const rotatedAt = new Date("2026-07-20T18:00:00.000Z");

    const result = await rotateWebhookSecret({
      ownerUserId,
      webhookEndpointId: endpoint.id,
      rotatedAt,
    });

    expect(result.webhookEndpointId).toBe(endpoint.id);
    expect(result.secretVersion).toBe(2);
    expect(result.rotatedAt.toISOString()).toBe(rotatedAt.toISOString());

    const versions = await prisma.webhookEndpointSecretVersion.findMany({
      where: {
        ownerUserId,
        webhookEndpointId: endpoint.id,
      },
      orderBy: { version: "asc" },
    });

    expect(versions).toHaveLength(2);
    expect(versions[0].id).toBe(version.id);
    expect(versions[0].isCurrent).toBe(false);
    expect(versions[0].retiredAt?.toISOString()).toBe(rotatedAt.toISOString());
    expect(versions[0].retainUntil?.toISOString()).toBe(computeSecretRetainUntil(rotatedAt).toISOString());

    expect(versions[1].isCurrent).toBe(true);
    expect(versions[1].version).toBe(2);

    const masterKey = getMasterKeyFromEnv();
    const endpointAfter = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    const decryptedCurrent = decryptSecret(endpointAfter.secretEncrypted, ownerUserId, masterKey);
    expect(decryptedCurrent).toBe(result.plainSecret);
    expect(WEBHOOK_SECRET_RETENTION_DAYS).toBe(30);
  });

  it("keeps in-flight deliveries bound to their original secret version", async () => {
    const { endpoint, version } = await createEndpointWithCurrentSecret();

    const event = await createWebhookEventRecord({
      envelope: createWebhookEventEnvelope({
        eventType: "image.analysis.ready_for_m8",
        ownerUserId,
        resourceType: "analysis",
        resourceId: "rotation-in-flight",
      }),
    });

    const delivery = await createWebhookDeliveryRecord({
      ownerUserId,
      webhookEventId: event.id,
      webhookEndpointId: endpoint.id,
    });

    await rotateWebhookSecret({ ownerUserId, webhookEndpointId: endpoint.id });

    const deliveryAfter = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(deliveryAfter.secretVersionId).toBe(version.id);

    const oldVersion = await prisma.webhookEndpointSecretVersion.findUniqueOrThrow({
      where: {
        id_webhookEndpointId_ownerUserId: {
          id: version.id,
          webhookEndpointId: endpoint.id,
          ownerUserId,
        },
      },
    });

    expect(oldVersion.retiredAt).not.toBeNull();
    expect(oldVersion.retainUntil).not.toBeNull();
  });
});