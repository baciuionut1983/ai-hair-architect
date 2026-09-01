import {
  buildVideoDemonstrationUsageEventInput,
  findVideoDemonstrationGenerationForOwner,
  type VideoDemonstrationGenerationRecord,
} from "@/lib/video-generation-repository";
import {
  claimVideoDemonstrationGenerationForReconciliation,
  markVideoDemonstrationGenerationReconciledCompleted,
  releaseVideoDemonstrationGenerationReconciliationClaim,
} from "@/lib/video-generation-execution-repository";
import { resolveVideoDemonstrationProviderConfig } from "@/lib/video-generation-provider-config";
import { VeoVideoDemonstrationProvider } from "@/lib/video-provider-veo";
import type { VideoDemonstrationProvider, VideoDemonstrationProviderError } from "@/lib/video-provider";
import { persistGeneratedVideoDemonstrationAsset } from "@/lib/video-asset-storage";
import { recordAiUsageEvent } from "@/lib/ai-usage-repository";

// Real AI Video Demonstration -- reconciliation. A DEDICATED, separate
// orchestrator from video-generation-execution-service.ts's own
// executeVideoDemonstrationGeneration, for a narrow, rare situation that
// function structurally can never handle: a row that is LOCALLY,
// terminally FAILED, but whose real providerOperationId can be proven,
// via a read-only poll of that SAME already-submitted operation, to have
// actually succeeded at the provider (the exact scenario the 2026-09-01
// polling root-cause audit uncovered: two separate client-side bugs in
// video-provider-veo.ts, both now fixed, could each crash a poll AFTER
// Google had already accepted and completed a real, billable generation,
// leaving a row falsely marked FAILED with the real result never
// retrieved).
//
// STRUCTURAL SAFETY (request point 3): this file NEVER imports or calls
// the provider's own real-submission method, nor either of the domain
// repository's row-creation functions (a fresh request, or a variation) --
// there is no code path here, under any outcome, that can create a new
// provider operation or a new VideoDemonstrationGeneration row. It only
// ever (a) polls the EXACT providerOperationId already persisted on the
// target row, and (b), only if that poll confirms genuine success,
// downloads and persists the result and transitions that SAME row
// FAILED -> COMPLETED. Locked by a source-level regression test
// (video-generation-reconciliation-service.test.ts) asserting this file's
// own text never references any of those identifiers by name.
//
// FAILED -> COMPLETED is a transition the ordinary state machine
// (video-generation-execution-repository.ts) never performs -- every
// function there that writes COMPLETED requires status PROCESSING.
// markVideoDemonstrationGenerationReconciledCompleted (imported above) is
// the only function anywhere with a FAILED -> COMPLETED write, and it is
// only ever called from this file.

export type VideoDemonstrationReconciliationResultCode =
  | "PROCESSING_DISABLED"
  | "PROVIDER_CONFIGURATION_INVALID"
  | "GENERATION_NOT_FOUND"
  | "NOT_FAILED"
  | "NO_OPERATION_ID"
  | "CLAIM_CONFLICT"
  | "STILL_PENDING"
  | "POLL_INCONCLUSIVE"
  | "PROVIDER_REFUSED"
  | "OPERATION_NOT_FOUND"
  | "STORAGE_FAILED"
  | "PERSISTENCE_FAILURE"
  | "INTERNAL_RECONCILIATION_FAILURE";

export type VideoDemonstrationReconciliationResult =
  | { outcome: "reconciled"; generation: VideoDemonstrationGenerationRecord }
  | { outcome: "already_reconciled"; generation: VideoDemonstrationGenerationRecord }
  | { outcome: "not_eligible"; code: VideoDemonstrationReconciliationResultCode }
  | { outcome: "incomplete"; code: VideoDemonstrationReconciliationResultCode }
  | { outcome: "failed"; code: VideoDemonstrationReconciliationResultCode };

export interface ReconcileVideoDemonstrationGenerationDependencies {
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  createProvider?: (config: { apiKey: string; model: string; timeoutMs?: number }) => VideoDemonstrationProvider;
  recordAiUsageEvent?: typeof recordAiUsageEvent;
  persistGeneratedVideo?: typeof persistGeneratedVideoDemonstrationAsset;
  /** Test-only hook invoked immediately before the atomic claim. Never used by any route. */
  beforeClaim?: () => Promise<void>;
}

export async function reconcileVideoDemonstrationGeneration(
  generationId: string,
  ownerUserId: string,
  dependencies: ReconcileVideoDemonstrationGenerationDependencies = {},
): Promise<VideoDemonstrationReconciliationResult> {
  const startedAt = Date.now();
  const result = await runVideoDemonstrationReconciliation(generationId, ownerUserId, dependencies);
  logVideoDemonstrationReconciliation(generationId, ownerUserId, result, Date.now() - startedAt);
  return result;
}

function logVideoDemonstrationReconciliation(generationId: string, ownerUserId: string, result: VideoDemonstrationReconciliationResult, totalLatencyMs: number): void {
  const line = JSON.stringify({
    gate: "VIDEO_DEMONSTRATION_RECONCILIATION",
    generationId,
    ownerUserId,
    outcome: result.outcome,
    ...("code" in result ? { code: result.code } : {}),
    totalLatencyMs,
  });
  if (result.outcome === "failed") {
    console.error(line);
  } else {
    console.log(line);
  }
}

async function runVideoDemonstrationReconciliation(
  generationId: string,
  ownerUserId: string,
  dependencies: ReconcileVideoDemonstrationGenerationDependencies,
): Promise<VideoDemonstrationReconciliationResult> {
  try {
    const now = dependencies.now ?? new Date();
    const env = dependencies.env ?? process.env;
    const createProvider = dependencies.createProvider ?? defaultCreateProvider;
    const recordUsage = dependencies.recordAiUsageEvent ?? recordAiUsageEvent;
    const persistVideo = dependencies.persistGeneratedVideo ?? persistGeneratedVideoDemonstrationAsset;

    const config = resolveVideoDemonstrationProviderConfig(env);
    if (config.status === "disabled") return notEligible("PROCESSING_DISABLED");
    if (config.status === "invalid") return notEligible("PROVIDER_CONFIGURATION_INVALID");

    const generation = await findVideoDemonstrationGenerationForOwner(ownerUserId, generationId);
    if (!generation) return notEligible("GENERATION_NOT_FOUND");

    // Fast, friendly pre-checks (request point 2). The REAL safety
    // boundary against concurrent double-processing is the atomic claim
    // below, not these reads -- defense in depth, not the actual guard.
    if (generation.generatedVideoAssetId) {
      return { outcome: "already_reconciled", generation };
    }
    if (generation.status !== "FAILED") {
      return notEligible("NOT_FAILED");
    }
    if (!generation.providerOperationId) {
      return notEligible("NO_OPERATION_ID");
    }
    const providerOperationId = generation.providerOperationId;

    if (dependencies.beforeClaim) await dependencies.beforeClaim();

    const claim = await claimVideoDemonstrationGenerationForReconciliation(generationId, ownerUserId, now);
    if (claim.outcome === "rejected") {
      if (claim.code === "NOT_FOUND") return notEligible("GENERATION_NOT_FOUND");
      // Lost a concurrency race, or the row changed under us since the
      // reads above (e.g. a concurrent attempt already reconciled it).
      const reread = await findVideoDemonstrationGenerationForOwner(ownerUserId, generationId);
      if (reread?.generatedVideoAssetId) return { outcome: "already_reconciled", generation: reread };
      return notEligible("CLAIM_CONFLICT");
    }

    const provider = createProvider({ apiKey: config.apiKey, model: generation.model, timeoutMs: config.timeoutMs });

    let pollResult: Awaited<ReturnType<VideoDemonstrationProvider["poll"]>>;
    try {
      pollResult = await provider.poll(providerOperationId);
    } catch (error) {
      await releaseVideoDemonstrationGenerationReconciliationClaim(generationId, ownerUserId);
      const providerError = error as Partial<VideoDemonstrationProviderError>;
      // MODERATION_REFUSED / OPERATION_NOT_FOUND are genuine, provider-
      // confirmed terminal answers -- request point 5's "failed/error" and
      // "not found" branches. Anything else (a transient network issue
      // checking status, a timeout, rate limiting) tells us NOTHING new
      // about the underlying operation -- it is a failure to CHECK, not
      // evidence either way, so it is reported as inconclusive, never as a
      // confirmed provider failure. Either way, the row's own status is
      // NEVER touched here -- it stays exactly FAILED, as it already was.
      if (providerError.code === "MODERATION_REFUSED") return failed("PROVIDER_REFUSED");
      if (providerError.code === "OPERATION_NOT_FOUND") return failed("OPERATION_NOT_FOUND");
      return incomplete("POLL_INCONCLUSIVE");
    }

    if (!pollResult.done) {
      // Request point 5: NEVER transform FAILED -> PROCESSING automatically
      // -- report incomplete and stop. The row's status is untouched; only
      // the claim is released so a human can retry reconciliation without
      // waiting out the full stale-claim window.
      await releaseVideoDemonstrationGenerationReconciliationClaim(generationId, ownerUserId);
      return incomplete("STILL_PENDING");
    }

    // done:true with no exception thrown is ALWAYS a genuine success --
    // VeoVideoDemonstrationProvider.poll()'s own contract throws
    // MODERATION_REFUSED for a done:true-with-error response; it is never
    // returned normally (mirrors executeVideoDemonstrationGeneration's own
    // identical reasoning in its poll branch).

    const usageCorrelationBase = { ownerUserId: generation.ownerUserId, clientId: generation.clientId, provider: generation.provider, model: generation.model, id: generation.id };
    try {
      await recordUsage({
        ...buildVideoDemonstrationUsageEventInput(usageCorrelationBase, {
          outcome: "SUCCEEDED",
          attemptNumber: generation.attemptCount,
          providerRequestId: providerOperationId,
          ...(pollResult.durationSeconds !== undefined ? { usage: { videoSeconds: pollResult.durationSeconds } } : {}),
        }),
        // Request point 7/8: an EXPLICIT, distinct idempotencyKey. The
        // default derivation (`${correlationId}:${attemptNumber}`) would
        // collide with the FAILED usage event already recorded, honestly,
        // at the time of the original crash -- reusing it here would get
        // silently SKIPPED as a "duplicate," and the real SUCCEEDED event
        // this reconciliation exists to record would never actually be
        // written. This key is itself still fully idempotent across
        // repeated or concurrent reconciliation attempts for the SAME
        // generation: they always derive the identical key, so at most one
        // SUCCEEDED row is ever created, no matter how many times
        // reconciliation runs.
        idempotencyKey: `${generation.id}:reconciliation`,
      });
    } catch {
      // Intentionally swallowed -- mirrors executeVideoDemonstrationGeneration's
      // own identical precedent: a metering problem must never block
      // persisting a real, successfully generated video.
    }

    let generatedAsset;
    try {
      generatedAsset = await persistVideo(generation.ownerUserId, generation.clientId, pollResult.videoBuffer, pollResult.mimeType, pollResult.durationSeconds);
    } catch {
      // Storage failed -- release the claim so a LATER reconciliation
      // attempt can retry the download (the real video remains on the
      // provider's own servers within its retention window; nothing is
      // lost). The SUCCEEDED usage event above is NOT retracted -- mirrors
      // executeVideoDemonstrationGeneration's own established precedent:
      // the generation genuinely succeeded (and was billed) even if this
      // application then fails to durably store it.
      await releaseVideoDemonstrationGenerationReconciliationClaim(generationId, ownerUserId);
      return failed("STORAGE_FAILED");
    }

    try {
      await markVideoDemonstrationGenerationReconciledCompleted(generationId, ownerUserId, { generatedVideoAssetId: generatedAsset.id }, providerOperationId, now);
    } catch {
      return failed("PERSISTENCE_FAILURE");
    }

    const updated = await findVideoDemonstrationGenerationForOwner(ownerUserId, generationId);
    if (!updated) return failed("PERSISTENCE_FAILURE");
    return { outcome: "reconciled", generation: updated };
  } catch {
    return failed("INTERNAL_RECONCILIATION_FAILURE");
  }
}

function notEligible(code: VideoDemonstrationReconciliationResultCode): VideoDemonstrationReconciliationResult {
  return { outcome: "not_eligible", code };
}

function incomplete(code: VideoDemonstrationReconciliationResultCode): VideoDemonstrationReconciliationResult {
  return { outcome: "incomplete", code };
}

function failed(code: VideoDemonstrationReconciliationResultCode): VideoDemonstrationReconciliationResult {
  return { outcome: "failed", code };
}

function defaultCreateProvider(config: { apiKey: string; model: string; timeoutMs?: number }): VideoDemonstrationProvider {
  return new VeoVideoDemonstrationProvider(config);
}
