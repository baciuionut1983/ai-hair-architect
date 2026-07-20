import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface ListWebhookDeliveryHistoryInput {
  ownerUserId: string;
  webhookEndpointId: string;
  limit?: number;
  offset?: number;
}

export interface GetWebhookDeliveryDetailsInput {
  ownerUserId: string;
  webhookEndpointId: string;
  deliveryId: string;
}

export interface ListWebhookDeliveryHistoryCursorInput {
  ownerUserId: string;
  webhookEndpointId: string;
  cursor?: string | null;
  limit?: number;
}

export interface WebhookDeliveryHistoryPageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
  limit: number;
}

export interface ListWebhookDeliveryHistoryCursorResult {
  data: Awaited<ReturnType<DbClient["webhookDelivery"]["findMany"]>>;
  pageInfo: WebhookDeliveryHistoryPageInfo;
}

function getDb(client?: DbClient): DbClient {
  return client ?? prisma;
}

export async function listWebhookDeliveryHistory(
  input: ListWebhookDeliveryHistoryInput,
  client?: DbClient,
) {
  const db = getDb(client);
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 100);
  const offset = Math.max(Math.floor(input.offset ?? 0), 0);

  const [total, deliveries] = await Promise.all([
    db.webhookDelivery.count({
      where: {
        ownerUserId: input.ownerUserId,
        webhookEndpointId: input.webhookEndpointId,
      },
    }),
    db.webhookDelivery.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        webhookEndpointId: input.webhookEndpointId,
      },
      include: {
        attempts: {
          orderBy: {
            attemptNumber: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip: offset,
    }),
  ]);

  return {
    total,
    limit,
    offset,
    deliveries,
  };
}

export async function listWebhookDeliveryHistoryCursor(
  input: ListWebhookDeliveryHistoryCursorInput,
  client?: DbClient,
): Promise<ListWebhookDeliveryHistoryCursorResult> {
  const db = getDb(client);
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 100);

  const deliveries = await db.webhookDelivery.findMany({
    where: {
      ownerUserId: input.ownerUserId,
      webhookEndpointId: input.webhookEndpointId,
    },
    include: {
      attempts: {
        orderBy: {
          attemptNumber: "asc",
        },
      },
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    ...(input.cursor
      ? {
          cursor: {
            id: input.cursor,
          },
          skip: 1,
        }
      : {}),
    take: limit + 1,
  });

  const hasNextPage = deliveries.length > limit;
  const data = hasNextPage ? deliveries.slice(0, limit) : deliveries;
  const nextCursor = hasNextPage && data.length > 0 ? data[data.length - 1].id : null;

  return {
    data,
    pageInfo: {
      nextCursor,
      hasNextPage,
      limit,
    },
  };
}

export async function getWebhookDeliveryDetails(
  input: GetWebhookDeliveryDetailsInput,
  client?: DbClient,
) {
  const db = getDb(client);

  const delivery = await db.webhookDelivery.findFirst({
    where: {
      id: input.deliveryId,
      ownerUserId: input.ownerUserId,
      webhookEndpointId: input.webhookEndpointId,
    },
    include: {
      attempts: {
        orderBy: {
          attemptNumber: "asc",
        },
      },
      event: true,
      secretVersion: {
        select: {
          id: true,
          version: true,
          signatureScheme: true,
          createdAt: true,
          retiredAt: true,
          retainUntil: true,
        },
      },
    },
  });

  if (!delivery) {
    throw new Error("Webhook delivery not found for owner/endpoint.");
  }

  return delivery;
}