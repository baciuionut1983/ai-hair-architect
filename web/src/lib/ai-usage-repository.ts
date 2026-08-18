import { Prisma } from "@prisma/client";

import type { RecordAiUsageEventInput } from "./ai-usage-contracts";
import { loadPricingTable, resolveAIProviderCost } from "./ai-usage-pricing";
import { isDatabaseConfigured, prisma } from "./prisma";

// AI Usage & Cost Metering Phase 1: the single authoritative entry point
// every instrumented AI call site (Consult AI, image analysis, STT, TTS,
// and every future modality) records through. Two hard guarantees, both
// directly required by the task this shipped under:
//
// 1. This function NEVER throws and NEVER slows down or fails the
//    user-facing AI operation it's accounting for -- the caller has
//    already produced (or failed to produce) a real result for the
//    stylist by the time this runs, and a logging problem on the
//    accounting side must never retroactively turn that into a
//    user-visible failure. Every failure mode (database not configured,
//    a write error, a malformed input) is caught internally and reported
//    only via the same safe-fields-only console logging convention this
//    app already uses everywhere else (see logConsultationChatFailure
//    and friends) -- observable to Railway logs, invisible to the user.
// 2. A duplicate write for the same logical attempt (the same
//    correlationId + attemptNumber, or an explicit idempotencyKey) is a
//    safe no-op, not a double-counted cost -- see AiUsageEvent's own
//    unique index on idempotencyKey.
function logAiUsageMetering(status: "RECORDED" | "SKIPPED" | "FAILED", details: Record<string, unknown>): void {
  const line = JSON.stringify({ gate: "AI_USAGE_METERING", status, ...details });
  if (status === "FAILED") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function deriveIdempotencyKey(input: RecordAiUsageEventInput): string {
  if (input.idempotencyKey && input.idempotencyKey.trim().length > 0) {
    return input.idempotencyKey.trim().slice(0, 160);
  }
  return `${input.correlationId}:${input.attemptNumber ?? 1}`.slice(0, 160);
}

export async function recordAiUsageEvent(input: RecordAiUsageEventInput): Promise<void> {
  try {
    if (!isDatabaseConfigured()) {
      logAiUsageMetering("SKIPPED", { reason: "database_not_configured", feature: input.feature });
      return;
    }

    const idempotencyKey = deriveIdempotencyKey(input);
    const usageAvailable = input.usage !== undefined && Object.keys(input.usage).length > 0;
    const pricingTable = loadPricingTable();
    const cost = resolveAIProviderCost({
      provider: input.provider,
      model: input.model,
      modality: input.modality,
      usage: input.usage,
      usageAvailable,
      pricingTable,
    });

    await prisma.aiUsageEvent.create({
      data: {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId ?? null,
        clientId: input.clientId ?? null,
        analysisId: input.analysisId ?? null,
        feature: input.feature,
        modality: input.modality,
        correlationId: input.correlationId,
        attemptNumber: input.attemptNumber ?? 1,
        idempotencyKey,
        provider: input.provider,
        model: input.model,
        providerRequestId: input.providerRequestId ?? null,
        usage: (input.usage ?? {}) as unknown as Prisma.InputJsonValue,
        usageAvailable,
        estimatedCostMicros: cost.estimatedCostMicros,
        currency: cost.currency,
        pricingVersion: cost.pricingVersion,
        costBasis: cost.costBasis,
        outcome: input.outcome,
        errorCategory: input.errorCategory ?? null,
        latencyMs: input.latencyMs ?? null,
      },
    });

    logAiUsageMetering("RECORDED", {
      feature: input.feature,
      modality: input.modality,
      provider: input.provider,
      model: input.model,
      outcome: input.outcome,
      usageAvailable,
      costBasis: cost.costBasis,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Same logical attempt already recorded (idempotencyKey collision)
      // -- a safe no-op, not a failure. Expected under retries/duplicate
      // submissions, never itself logged as FAILED.
      logAiUsageMetering("SKIPPED", { reason: "duplicate_idempotency_key", feature: input.feature });
      return;
    }
    logAiUsageMetering("FAILED", {
      reason: "write_threw",
      feature: input.feature,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}
