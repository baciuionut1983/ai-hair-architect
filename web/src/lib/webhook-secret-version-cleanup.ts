import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CleanupRetiredWebhookSecretsInput {
  now?: Date;
  ownerUserId?: string;
  limit?: number;
}

export interface CleanupRetiredWebhookSecretsResult {
  scanned: number;
  deleted: number;
  skippedReferenced: number;
  failed: number;
}

function getDb(client?: DbClient): DbClient {
  return client ?? prisma;
}

export async function cleanupRetiredWebhookSecretVersions(
  input: CleanupRetiredWebhookSecretsInput = {},
  client?: DbClient,
): Promise<CleanupRetiredWebhookSecretsResult> {
  const db = getDb(client);
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 1000);

  const candidates = await db.webhookEndpointSecretVersion.findMany({
    where: {
      isCurrent: false,
      retainUntil: {
        not: null,
        lte: now,
      },
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    },
    orderBy: {
      retainUntil: "asc",
    },
    take: limit,
    select: {
      id: true,
    },
  });

  const result: CleanupRetiredWebhookSecretsResult = {
    scanned: candidates.length,
    deleted: 0,
    skippedReferenced: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      const references = await db.webhookDelivery.count({
        where: {
          secretVersionId: candidate.id,
        },
      });

      if (references > 0) {
        result.skippedReferenced += 1;
        continue;
      }

      await db.webhookEndpointSecretVersion.delete({
        where: {
          id: candidate.id,
        },
      });

      result.deleted += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        result.skippedReferenced += 1;
        continue;
      }

      result.failed += 1;
    }
  }

  return result;
}