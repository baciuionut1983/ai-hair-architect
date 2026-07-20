import type { PrismaClient } from "@prisma/client";

import { decryptSecret, encryptSecret, generateSecret, getMasterKeyFromEnv } from "@/lib/webhook-crypto";
import { prisma } from "@/lib/prisma";

export const WEBHOOK_SECRET_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RotateWebhookSecretInput {
  ownerUserId: string;
  webhookEndpointId: string;
  rotatedAt?: Date;
}

export interface RotateWebhookSecretResult {
  webhookEndpointId: string;
  secretVersionId: string;
  secretVersion: number;
  rotatedAt: Date;
  retiredPreviousVersionAt: Date | null;
  previousVersionRetainUntil: Date | null;
  plainSecret: string;
}

function getDb(client?: PrismaClient): PrismaClient {
  return client ?? prisma;
}

export function computeSecretRetainUntil(retiredAt: Date): Date {
  return new Date(retiredAt.getTime() + WEBHOOK_SECRET_RETENTION_DAYS * DAY_MS);
}

export async function rotateWebhookSecret(
  input: RotateWebhookSecretInput,
  client?: PrismaClient,
): Promise<RotateWebhookSecretResult> {
  const db = getDb(client);
  const rotatedAt = input.rotatedAt ?? new Date();
  const plainSecret = generateSecret();
  const masterKey = getMasterKeyFromEnv();
  const encryptedSecret = encryptSecret(plainSecret, input.ownerUserId, masterKey);

  return db.$transaction(async tx => {
    const endpoint = await tx.webhookEndpoint.findFirst({
      where: {
        id: input.webhookEndpointId,
        ownerUserId: input.ownerUserId,
      },
    });

    if (!endpoint) {
      throw new Error("Webhook endpoint not found for owner.");
    }

    if (endpoint.deletedAt) {
      throw new Error("Cannot rotate secret for a soft-deleted webhook endpoint.");
    }

    const [currentVersion, maxVersionRow] = await Promise.all([
      tx.webhookEndpointSecretVersion.findFirst({
        where: {
          webhookEndpointId: endpoint.id,
          ownerUserId: input.ownerUserId,
          isCurrent: true,
        },
        orderBy: {
          version: "desc",
        },
      }),
      tx.webhookEndpointSecretVersion.aggregate({
        where: {
          webhookEndpointId: endpoint.id,
          ownerUserId: input.ownerUserId,
        },
        _max: {
          version: true,
        },
      }),
    ]);

    let retiredPreviousVersionAt: Date | null = null;
    let previousVersionRetainUntil: Date | null = null;

    if (currentVersion) {
      retiredPreviousVersionAt = rotatedAt;
      previousVersionRetainUntil = computeSecretRetainUntil(rotatedAt);

      await tx.webhookEndpointSecretVersion.update({
        where: {
          id_webhookEndpointId_ownerUserId: {
            id: currentVersion.id,
            webhookEndpointId: currentVersion.webhookEndpointId,
            ownerUserId: currentVersion.ownerUserId,
          },
        },
        data: {
          isCurrent: false,
          retiredAt: retiredPreviousVersionAt,
          retainUntil: previousVersionRetainUntil,
        },
      });
    }

    const nextVersion = (maxVersionRow._max.version ?? 0) + 1;
    const signatureScheme = currentVersion?.signatureScheme ?? "hmac_sha256_v1";

    const createdVersion = await tx.webhookEndpointSecretVersion.create({
      data: {
        webhookEndpointId: endpoint.id,
        ownerUserId: input.ownerUserId,
        version: nextVersion,
        secretEncrypted: encryptedSecret,
        signatureScheme,
        isCurrent: true,
      },
    });

    // Keep M9D compatibility behavior aligned with the current secret material.
    await tx.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        secretEncrypted: encryptedSecret,
      },
    });

    // Defensive sanity check for encryption consistency before returning plaintext.
    const decryptedRoundTrip = decryptSecret(createdVersion.secretEncrypted, input.ownerUserId, masterKey);
    if (decryptedRoundTrip !== plainSecret) {
      throw new Error("Rotated secret failed round-trip encryption verification.");
    }

    return {
      webhookEndpointId: endpoint.id,
      secretVersionId: createdVersion.id,
      secretVersion: createdVersion.version,
      rotatedAt,
      retiredPreviousVersionAt,
      previousVersionRetainUntil,
      plainSecret,
    };
  });
}