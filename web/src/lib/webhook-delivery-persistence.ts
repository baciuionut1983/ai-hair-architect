import { Prisma, PrismaClient } from "@prisma/client";

import type {
  WebhookAttemptOutcome,
  WebhookDeliveryStatus,
  WebhookEventEnvelope,
  WebhookFailureCode,
  WebhookFailureDomain,
} from "@/lib/contracts";
import { prisma } from "@/lib/prisma";
import { buildDeliveryIdempotencyKey, assertNamespacedProducerIdempotencyKey } from "@/lib/webhook-idempotency";
import { assertWebhookDeliveryTransition, getLeaseExpiryFailureStatus } from "@/lib/webhook-delivery-state-machine";
import { validateWebhookEventEnvelope } from "@/lib/webhook-envelope-validator";

type TransactionClient = Prisma.TransactionClient;

export interface CreateWebhookEventRecordInput {
  envelope: WebhookEventEnvelope;
}

export interface CreateWebhookDeliveryInput {
  ownerUserId: string;
  webhookEventId: string;
  webhookEndpointId: string;
  approvedHeadersSnapshot?: Record<string, string>;
}

export interface FinalizeWebhookAttemptInput {
  attemptId: string;
  deliveryId: string;
  status: Extract<WebhookDeliveryStatus, "delivered" | "failed_retryable" | "failed_terminal">;
  outcome: WebhookAttemptOutcome;
  failureDomain?: WebhookFailureDomain | null;
  failureCode?: WebhookFailureCode | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessageSafe?: string | null;
  responseTruncated?: boolean;
  completedAt?: Date;
}

function getPrismaClient(client?: PrismaClient | TransactionClient): PrismaClient | TransactionClient {
  return client ?? prisma;
}

async function findCurrentSecretVersion(
  client: PrismaClient | TransactionClient,
  webhookEndpointId: string,
  ownerUserId: string,
) {
  return client.webhookEndpointSecretVersion.findFirst({
    where: {
      webhookEndpointId,
      ownerUserId,
      isCurrent: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function createWebhookEventRecord(
  input: CreateWebhookEventRecordInput,
  client?: PrismaClient | TransactionClient,
) {
  const tx = getPrismaClient(client);
  const envelope = validateWebhookEventEnvelope(input.envelope);

  if (envelope.meta.producerIdempotencyKey) {
    assertNamespacedProducerIdempotencyKey(envelope.meta.producerIdempotencyKey);
  }

  try {
    return await tx.webhookEvent.create({
      data: {
        id: envelope.eventId,
        ownerUserId: envelope.ownerUserId,
        eventType: envelope.eventType,
        schemaVersion: envelope.schemaVersion,
        producerIdempotencyKey: envelope.meta.producerIdempotencyKey ?? null,
        resourceType: envelope.resource.type,
        resourceId: envelope.resource.id,
        occurredAt: new Date(envelope.occurredAt),
        payload: envelope.data as Prisma.InputJsonValue,
        dispatchEligible: envelope.meta.dispatchEligible,
        auditOnly: envelope.meta.auditOnly,
        sensitivity: envelope.meta.sensitivity,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      envelope.meta.producerIdempotencyKey
    ) {
      const existing = await tx.webhookEvent.findFirst({
        where: {
          ownerUserId: envelope.ownerUserId,
          producerIdempotencyKey: envelope.meta.producerIdempotencyKey,
        },
      });

      if (existing) {
        return existing;
      }
    }

    throw error;
  }
}

export async function createWebhookDeliveryRecord(
  input: CreateWebhookDeliveryInput,
  client?: PrismaClient,
) {
  const db = client ?? prisma;

  return db.$transaction(async (tx) => {
    const event = await tx.webhookEvent.findFirst({
      where: {
        id: input.webhookEventId,
        ownerUserId: input.ownerUserId,
      },
    });

    if (!event) {
      throw new Error("Webhook event not found for owner.");
    }

    const endpoint = await tx.webhookEndpoint.findFirst({
      where: {
        id: input.webhookEndpointId,
        ownerUserId: input.ownerUserId,
      },
    });

    if (!endpoint) {
      throw new Error("Webhook endpoint not found for owner.");
    }

    if (!endpoint.enabled) {
      throw new Error("Webhook endpoint is disabled.");
    }

    if (endpoint.deletedAt) {
      throw new Error("Webhook endpoint is soft-deleted.");
    }

    const secretVersion = await findCurrentSecretVersion(tx, endpoint.id, endpoint.ownerUserId);
    if (!secretVersion) {
      throw new Error("Current webhook secret version not found.");
    }

    const idempotencyKey = buildDeliveryIdempotencyKey(endpoint.id, event.id);

    try {
      return await tx.webhookDelivery.create({
        data: {
          ownerUserId: input.ownerUserId,
          webhookEventId: event.id,
          webhookEndpointId: endpoint.id,
          secretVersionId: secretVersion.id,
          status: "pending",
          idempotencyKey,
          targetUrlSnapshot: endpoint.url,
          signatureSchemeSnapshot: secretVersion.signatureScheme,
          secretVersionSnapshot: secretVersion.version,
          eventTypeSnapshot: event.eventType,
          approvedHeadersSnapshot: input.approvedHeadersSnapshot ?? Prisma.JsonNull,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await tx.webhookDelivery.findFirst({
          where: {
            webhookEndpointId: endpoint.id,
            webhookEventId: event.id,
          },
        });

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  });
}

export async function startWebhookDeliveryAttempt(
  deliveryId: string,
  leaseToken: string,
  leaseExpiresAt: Date,
  client?: PrismaClient,
) {
  const db = client ?? prisma;

  return db.$transaction(async (tx) => {
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });

    const nextStatus: WebhookDeliveryStatus = "dispatching";
    assertWebhookDeliveryTransition(delivery.status as WebhookDeliveryStatus, nextStatus);

    const attemptNumber = delivery.attemptCount + 1;
    await tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: nextStatus,
        attemptCount: attemptNumber,
        lastAttemptAt: new Date(),
        leaseToken,
        leaseExpiresAt,
      },
    });

    return tx.webhookDeliveryAttempt.create({
      data: {
        webhookDeliveryId: deliveryId,
        attemptNumber,
        startedAt: new Date(),
      },
    });
  });
}

export async function finalizeWebhookDeliveryAttempt(
  input: FinalizeWebhookAttemptInput,
  client?: PrismaClient,
) {
  const db = client ?? prisma;

  return db.$transaction(async (tx) => {
    const attempt = await tx.webhookDeliveryAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });

    const delivery = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: input.deliveryId },
    });

    assertWebhookDeliveryTransition(delivery.status as WebhookDeliveryStatus, input.status);

    const completedAt = input.completedAt ?? new Date();
    const durationMs = Math.max(0, completedAt.getTime() - attempt.startedAt.getTime());

    const updatedAttempt = await tx.webhookDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        completedAt,
        durationMs,
        httpStatus: input.httpStatus ?? null,
        outcome: input.outcome,
        failureDomain: input.failureDomain ?? null,
        failureCode: input.failureCode ?? null,
        errorCode: input.errorCode ?? null,
        errorMessageSafe: input.errorMessageSafe ?? null,
        responseTruncated: input.responseTruncated ?? false,
      },
    });

    const updatedDelivery = await tx.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: input.status,
        deliveredAt: input.status === "delivered" ? completedAt : null,
        nextAttemptAt: input.status === "failed_retryable" ? completedAt : null,
        lastFailureDomain: input.failureDomain ?? null,
        lastFailureCode: input.failureCode ?? "none",
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });

    if (input.status === "failed_terminal") {
      await tx.webhookDelivery.updateMany({
        where: {
          id: delivery.id,
          failedTerminalAt: null,
        },
        data: {
          failedTerminalAt: completedAt,
        },
      });
    }

    const deliveryWithStableTerminalTimestamp = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });

    return {
      attempt: updatedAttempt,
      delivery: deliveryWithStableTerminalTimestamp,
    };
  });
}

export async function cancelWebhookDelivery(
  deliveryId: string,
  client?: PrismaClient,
) {
  const db = client ?? prisma;

  return db.$transaction(async (tx) => {
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });

    assertWebhookDeliveryTransition(delivery.status as WebhookDeliveryStatus, "canceled");

    return tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "canceled",
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  });
}

export async function expireWebhookDeliveryLease(
  deliveryId: string,
  client?: PrismaClient,
) {
  const db = client ?? prisma;

  return db.$transaction(async (tx) => {
    const delivery = await tx.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });

    const expiredStatus = getLeaseExpiryFailureStatus();
    assertWebhookDeliveryTransition(delivery.status as WebhookDeliveryStatus, expiredStatus);

    return tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: expiredStatus,
        leaseToken: null,
        leaseExpiresAt: null,
        lastFailureDomain: "platform_internal",
        lastFailureCode: "internal_transient",
      },
    });
  });
}