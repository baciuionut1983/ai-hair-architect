import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface WebhookOperationalSnapshotInput {
  ownerUserId: string;
  webhookEndpointId?: string;
  now?: Date;
}

export interface WebhookRetryDistribution {
  attempt1: number;
  attempt2: number;
  attempt3: number;
  attempt4Plus: number;
}

export interface WebhookOperationalSnapshot {
  pendingDeliveries: number;
  dispatchingDeliveries: number;
  deliveredDeliveries: number;
  retryableDeliveries: number;
  terminalFailures: number;
  activeDeliveries: number;
  successRate: number | null;
  oldestPendingAgeMs: number | null;
  deliveryLatencyMedianMs: number | null;
  deliveryLatencyP95Ms: number | null;
  createdLast24h: number;
  deliveredLast24h: number;
  failedLast24h: number;
  deliveriesLast24h: number;
  retryDistribution: WebhookRetryDistribution;
}

function getDb(client?: DbClient): DbClient {
  return client ?? prisma;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  const boundedIndex = Math.min(Math.max(idx, 0), sorted.length - 1);
  return sorted[boundedIndex];
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function distributionFromAttemptCounts(attemptCounts: number[]): WebhookRetryDistribution {
  const distribution: WebhookRetryDistribution = {
    attempt1: 0,
    attempt2: 0,
    attempt3: 0,
    attempt4Plus: 0,
  };

  for (const attempts of attemptCounts) {
    if (attempts <= 1) {
      distribution.attempt1 += 1;
    } else if (attempts === 2) {
      distribution.attempt2 += 1;
    } else if (attempts === 3) {
      distribution.attempt3 += 1;
    } else {
      distribution.attempt4Plus += 1;
    }
  }

  return distribution;
}

export async function getWebhookOperationalSnapshot(
  input: WebhookOperationalSnapshotInput,
  client?: DbClient,
): Promise<WebhookOperationalSnapshot> {
  const db = getDb(client);
  const now = input.now ?? new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const scope = {
    ownerUserId: input.ownerUserId,
    ...(input.webhookEndpointId ? { webhookEndpointId: input.webhookEndpointId } : {}),
  };

  const [pendingDeliveries, dispatchingDeliveries, deliveredDeliveries, retryableDeliveries, terminalFailures] = await Promise.all([
    db.webhookDelivery.count({ where: { ...scope, status: "pending" } }),
    db.webhookDelivery.count({ where: { ...scope, status: "dispatching" } }),
    db.webhookDelivery.count({ where: { ...scope, status: "delivered" } }),
    db.webhookDelivery.count({ where: { ...scope, status: "failed_retryable" } }),
    db.webhookDelivery.count({ where: { ...scope, status: "failed_terminal" } }),
  ]);

  const [oldestEligible, deliveredLatenciesRows, deliveriesLast24hRows, deliveredLast24h, failedLast24h] = await Promise.all([
    db.webhookDelivery.findFirst({
      where: {
        ...scope,
        OR: [
          { status: "pending" },
          {
            status: "failed_retryable",
            nextAttemptAt: {
              lte: now,
            },
          },
        ],
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        createdAt: true,
      },
    }),
    db.webhookDelivery.findMany({
      where: {
        ...scope,
        status: "delivered",
        deliveredAt: {
          not: null,
        },
      },
      select: {
        createdAt: true,
        deliveredAt: true,
      },
    }),
    db.webhookDelivery.findMany({
      where: {
        ...scope,
        createdAt: {
          gte: since24h,
        },
      },
      select: {
        attemptCount: true,
      },
    }),
    db.webhookDelivery.count({
      where: {
        ...scope,
        status: "delivered",
        deliveredAt: {
          gte: since24h,
        },
      },
    }),
    db.webhookDelivery.count({
      where: {
        ...scope,
        status: "failed_terminal",
        failedTerminalAt: {
          gte: since24h,
        },
      },
    }),
  ]);

  const oldestPendingAgeMs = oldestEligible
    ? Math.max(0, now.getTime() - oldestEligible.createdAt.getTime())
    : null;

  const latencySamples = deliveredLatenciesRows
    .map(row => {
      if (!row.deliveredAt) {
        return null;
      }
      return Math.max(0, row.deliveredAt.getTime() - row.createdAt.getTime());
    })
    .filter((value): value is number => value !== null);

  const successDenominator = deliveredDeliveries + terminalFailures;
  const successRate = successDenominator > 0 ? deliveredDeliveries / successDenominator : null;

  const createdLast24h = deliveriesLast24hRows.length;

  return {
    pendingDeliveries,
    dispatchingDeliveries,
    deliveredDeliveries,
    retryableDeliveries,
    terminalFailures,
    activeDeliveries: pendingDeliveries + dispatchingDeliveries + retryableDeliveries,
    successRate,
    oldestPendingAgeMs,
    deliveryLatencyMedianMs: median(latencySamples),
    deliveryLatencyP95Ms: percentile(latencySamples, 95),
    createdLast24h,
    deliveredLast24h,
    failedLast24h,
    deliveriesLast24h: createdLast24h,
    retryDistribution: distributionFromAttemptCounts(deliveriesLast24hRows.map(row => row.attemptCount)),
  };
}