import type { AiUsageOutcome } from "@prisma/client";

import type { AiUsageQuantities } from "./ai-usage-contracts";
import { prisma } from "./prisma";

// AI Usage & Cost Metering Phase 1: the single server-side authoritative
// place these accounting questions get answered (Step 7) -- callers never
// query prisma.aiUsageEvent directly, and raw provider-level detail never
// crosses this boundary to a client. Rows are fetched and summed in
// application code rather than via SQL-level JSON aggregation: `usage` is
// a Json column (see AiUsageEvent's own schema comment for why), and at
// this product's current volume a straightforward in-process reduce is
// simpler, fully type-safe, and easier to test than raw SQL JSON-path
// aggregation -- if usage volume ever makes that a real cost, this
// function's signature does not need to change to swap the
// implementation for one.
export interface AiUsageAggregationFilter {
  startDate: Date;
  endDate: Date;
  ownerUserId?: string;
  provider?: string;
  model?: string;
  feature?: string;
}

export interface AiUsageBreakdownEntry {
  key: string;
  operations: number;
  succeededOperations: number;
  failedOperations: number;
  // BigInt is not JSON-serializable by default -- reported as a decimal
  // string (like Stripe's own convention for large integer amounts),
  // never coerced to `number`, which could silently lose precision at
  // large totals.
  estimatedCostMicros: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageTopUserEntry {
  ownerUserId: string;
  operations: number;
  estimatedCostMicros: string;
}

export interface AiUsageAggregationResult {
  totalOperations: number;
  succeededOperations: number;
  failedOperations: number;
  totalEstimatedCostMicros: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: AiUsageBreakdownEntry[];
  byModel: AiUsageBreakdownEntry[];
  byFeature: AiUsageBreakdownEntry[];
  // Only ever meaningful for a platform-wide (no ownerUserId filter)
  // query -- still returned (possibly a single entry) when scoped to one
  // user, since that's a harmless, honest reflection of the filter
  // rather than a special case the caller has to know about.
  topUsersByCost: AiUsageTopUserEntry[];
}

const TOP_USERS_LIMIT = 10;

interface MutableBreakdown {
  operations: number;
  succeededOperations: number;
  failedOperations: number;
  costMicros: bigint;
  inputTokens: number;
  outputTokens: number;
}

export async function getAiUsageAggregation(filter: AiUsageAggregationFilter): Promise<AiUsageAggregationResult> {
  const rows = await prisma.aiUsageEvent.findMany({
    where: {
      createdAt: { gte: filter.startDate, lt: filter.endDate },
      ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
      ...(filter.provider ? { provider: filter.provider } : {}),
      ...(filter.model ? { model: filter.model } : {}),
      ...(filter.feature ? { feature: filter.feature } : {}),
    },
    select: {
      ownerUserId: true,
      provider: true,
      model: true,
      feature: true,
      outcome: true,
      estimatedCostMicros: true,
      usage: true,
    },
  });

  const byProvider = new Map<string, MutableBreakdown>();
  const byModel = new Map<string, MutableBreakdown>();
  const byFeature = new Map<string, MutableBreakdown>();
  const byUser = new Map<string, { operations: number; costMicros: bigint }>();

  let totalCostMicros = BigInt(0);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const costMicros = row.estimatedCostMicros ?? BigInt(0);
    totalCostMicros += costMicros;

    const usage = (row.usage && typeof row.usage === "object" ? row.usage : {}) as AiUsageQuantities;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;

    if (row.outcome === "SUCCEEDED") succeeded += 1;
    else failed += 1;

    accumulate(byProvider, row.provider, row.outcome, costMicros, usage);
    accumulate(byModel, row.model, row.outcome, costMicros, usage);
    accumulate(byFeature, row.feature, row.outcome, costMicros, usage);

    const userEntry = byUser.get(row.ownerUserId) ?? { operations: 0, costMicros: BigInt(0) };
    userEntry.operations += 1;
    userEntry.costMicros += costMicros;
    byUser.set(row.ownerUserId, userEntry);
  }

  const topUsersByCost: AiUsageTopUserEntry[] = [...byUser.entries()]
    .sort(([, a], [, b]) => bigIntCompareDescending(a.costMicros, b.costMicros))
    .slice(0, TOP_USERS_LIMIT)
    .map(([ownerUserId, entry]) => ({
      ownerUserId,
      operations: entry.operations,
      estimatedCostMicros: entry.costMicros.toString(),
    }));

  return {
    totalOperations: rows.length,
    succeededOperations: succeeded,
    failedOperations: failed,
    totalEstimatedCostMicros: totalCostMicros.toString(),
    totalInputTokens,
    totalOutputTokens,
    byProvider: serializeBreakdown(byProvider),
    byModel: serializeBreakdown(byModel),
    byFeature: serializeBreakdown(byFeature),
    topUsersByCost,
  };
}

function bigIntCompareDescending(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function accumulate(
  map: Map<string, MutableBreakdown>,
  key: string,
  outcome: AiUsageOutcome,
  costMicros: bigint,
  usage: AiUsageQuantities,
): void {
  const entry = map.get(key) ?? {
    operations: 0,
    succeededOperations: 0,
    failedOperations: 0,
    costMicros: BigInt(0),
    inputTokens: 0,
    outputTokens: 0,
  };
  entry.operations += 1;
  if (outcome === "SUCCEEDED") entry.succeededOperations += 1;
  else entry.failedOperations += 1;
  entry.costMicros += costMicros;
  entry.inputTokens += usage.inputTokens ?? 0;
  entry.outputTokens += usage.outputTokens ?? 0;
  map.set(key, entry);
}

function serializeBreakdown(map: Map<string, MutableBreakdown>): AiUsageBreakdownEntry[] {
  return [...map.entries()]
    .map(([key, entry]) => ({
      key,
      operations: entry.operations,
      succeededOperations: entry.succeededOperations,
      failedOperations: entry.failedOperations,
      estimatedCostMicros: entry.costMicros.toString(),
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
    }))
    .sort((a, b) => b.operations - a.operations);
}
