import { randomUUID } from "crypto";

import { Prisma, type VideoDemonstrationGeneration as PrismaVideoDemonstrationGenerationRow } from "@prisma/client";

import type { AiUsageQuantities } from "@/lib/ai-usage-contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { isSealedPhotoPreviewRequest } from "@/lib/photo-preview-contracts";
import { isViewLabel, type ViewLabel } from "@/lib/technical-visual-map-spatial-validators";
import {
  buildSealedVideoDemonstrationRequest,
  computeVideoDemonstrationRequestFingerprint,
  isSealedVideoDemonstrationRequest,
  VIDEO_DEMONSTRATION_SCHEMA_VERSION,
  type SealedVideoDemonstrationRequest,
} from "@/lib/video-generation-contracts";
import { isVideoDemonstrationProviderName, isVideoDemonstrationVeoModel } from "@/lib/video-generation-provider-config";

// Real AI Video Demonstration, Stage 1 -- the durable domain/repository
// layer. Mirrors photo-preview-generation-repository.ts's own conventions
// exactly: the runXQuery fail-closed wrapper, the runSerializableTransaction
// retry-on-conflict helper, the ownership-check style (owner-scoped
// findFirst INSIDE the transaction), and the typed-error taxonomy.
//
// Authority gate (Video Stage 0 Decision Lock, section F/G): a video
// generation may ONLY be created from a COMPLETED PhotoPreviewGeneration --
// never from Analysis/AnalysisProposal/TechnicalVisualMap/
// TechnicalVisualMapSpatialBinding directly. The FULL authority-chain
// snapshot (analysisProposalId/analysisProposalConfirmedAt/
// technicalVisualMapId/mapVersion/spatialBindingId/spatialVersion) is
// copied VERBATIM from the source PhotoPreviewGeneration row -- it is
// ALREADY frozen there (Photo Preview Stage 1's own authority gate), so
// this repository never re-derives it from the live proposal/map/binding
// chain, and a Photo Preview generation whose parents were later superseded
// remains a perfectly valid Video source (Decision Lock section 5:
// "historical provenance over current-state guessing").

const MAX_TRANSACTION_ATTEMPTS = 3;

export class VideoDemonstrationGenerationPersistenceError extends Error {
  readonly code = "VIDEO_DEMONSTRATION_GENERATION_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Video Demonstration generation data is temporarily unavailable.");
    this.name = "VideoDemonstrationGenerationPersistenceError";
  }
}

export class VideoDemonstrationGenerationDependencyError extends Error {
  constructor(
    readonly code:
      | "VIDEO_DEMONSTRATION_GENERATION_CLIENT_NOT_FOUND"
      | "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_FOUND"
      | "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_CLIENT_MISMATCH"
      | "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_COMPLETED"
      | "VIDEO_DEMONSTRATION_GENERATION_SOURCE_ASSET_NOT_FOUND"
      | "VIDEO_DEMONSTRATION_GENERATION_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "VideoDemonstrationGenerationDependencyError";
  }
}

export class VideoDemonstrationGenerationValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code: "VIDEO_DEMONSTRATION_GENERATION_INVALID_PROVIDER" | "VIDEO_DEMONSTRATION_GENERATION_INVALID_MODEL",
    message: string,
  ) {
    super(message);
    this.name = "VideoDemonstrationGenerationValidationError";
  }
}

// "This should be impossible" -- data that already passed every upstream
// domain validator (a COMPLETED Photo Preview's own sealedRequest) turned
// out malformed when re-read here. Never silently coerced or skipped.
export class VideoDemonstrationGenerationInvariantError extends Error {
  readonly code = "VIDEO_DEMONSTRATION_GENERATION_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "VideoDemonstrationGenerationInvariantError";
  }
}

export class VideoDemonstrationGenerationConcurrencyError extends Error {
  readonly code = "VIDEO_DEMONSTRATION_GENERATION_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Video Demonstration generation could not be created because of a concurrent conflict. Please try again.");
    this.name = "VideoDemonstrationGenerationConcurrencyError";
  }
}

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

export type VideoDemonstrationGenerationStatus = "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface VideoDemonstrationGenerationRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  photoPreviewGenerationId: string;
  analysisProposalId: string;
  analysisProposalConfirmedAt: string;
  technicalVisualMapId: string;
  mapVersion: number;
  spatialBindingId: string;
  spatialVersion: number;
  sourceGeneratedImageAssetId: string;
  frozenSourceContentSha256: string | null;
  provider: string;
  model: string;
  generationSchemaVersion: string;
  sealedRequest: SealedVideoDemonstrationRequest;
  requestFingerprint: string;
  variationIndex: number;
  status: VideoDemonstrationGenerationStatus;
  attemptCount: number;
  providerOperationId: string | null;
  generatedVideoAssetId: string | null;
  errorCode: string | null;
  errorMetadata: Record<string, unknown> | null;
  requestedAt: string;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVideoDemonstrationGenerationOutcome {
  record: VideoDemonstrationGenerationRecord;
  created: boolean;
}

type VideoDemonstrationGenerationTransaction = Pick<Prisma.TransactionClient, "videoDemonstrationGeneration" | "client" | "photoPreviewGeneration" | "imageAsset">;

// ---------------------------------------------------------------------------
// createVideoDemonstrationGeneration / createVideoDemonstrationGenerationVariation
// ---------------------------------------------------------------------------

export async function createVideoDemonstrationGeneration(
  ownerUserId: string,
  clientId: string,
  photoPreviewGenerationId: string,
  provider: string,
  model: string,
): Promise<CreateVideoDemonstrationGenerationOutcome> {
  return runVideoDemonstrationGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const chain = await resolveAuthorityChain(tx, ownerUserId, clientId, photoPreviewGenerationId);
      validateProviderAndModel(provider, model);
      const sealedRequest = assembleSealedRequest(chain);

      const requestFingerprint = computeVideoDemonstrationRequestFingerprint({
        ownerUserId,
        clientId,
        photoPreviewGenerationId: chain.photoPreview.id,
        provider,
        model,
        variationIndex: 0,
      });

      return createOrResolveExisting(tx, { ownerUserId, clientId, chain, provider, model, variationIndex: 0, sealedRequest, requestFingerprint });
    }),
  );
}

export async function createVideoDemonstrationGenerationVariation(
  ownerUserId: string,
  clientId: string,
  photoPreviewGenerationId: string,
  provider: string,
  model: string,
): Promise<CreateVideoDemonstrationGenerationOutcome> {
  return runVideoDemonstrationGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const chain = await resolveAuthorityChain(tx, ownerUserId, clientId, photoPreviewGenerationId);
      validateProviderAndModel(provider, model);
      const sealedRequest = assembleSealedRequest(chain);

      const maxVariation = await tx.videoDemonstrationGeneration.aggregate({
        where: { ownerUserId, clientId, photoPreviewGenerationId: chain.photoPreview.id, provider, model },
        _max: { variationIndex: true },
      });
      const variationIndex = (maxVariation._max.variationIndex ?? -1) + 1;

      const requestFingerprint = computeVideoDemonstrationRequestFingerprint({
        ownerUserId,
        clientId,
        photoPreviewGenerationId: chain.photoPreview.id,
        provider,
        model,
        variationIndex,
      });

      return createOrResolveExisting(tx, { ownerUserId, clientId, chain, provider, model, variationIndex, sealedRequest, requestFingerprint });
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findVideoDemonstrationGenerationForOwner(ownerUserId: string, id: string): Promise<VideoDemonstrationGenerationRecord | null> {
  return runVideoDemonstrationGenerationQuery(async () => {
    const row = await prisma.videoDemonstrationGeneration.findFirst({ where: { id, ownerUserId } });
    return row ? toVideoDemonstrationGenerationRecord(row) : null;
  });
}

export async function listVideoDemonstrationGenerationsForPhotoPreview(
  ownerUserId: string,
  clientId: string,
  photoPreviewGenerationId: string,
): Promise<VideoDemonstrationGenerationRecord[]> {
  return runVideoDemonstrationGenerationQuery(async () => {
    const rows = await prisma.videoDemonstrationGeneration.findMany({
      where: { ownerUserId, clientId, photoPreviewGenerationId },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toVideoDemonstrationGenerationRecord);
  });
}

// ---------------------------------------------------------------------------
// AiUsageEvent integration boundary -- a PURE mapping function only, same
// precedent as buildPhotoPreviewUsageEventInput (photo-preview-generation-repository.ts).
// ---------------------------------------------------------------------------

export interface VideoDemonstrationUsageEventBoundaryInput {
  outcome: "SUCCEEDED" | "FAILED";
  providerRequestId?: string | null;
  usage?: AiUsageQuantities;
  attemptNumber?: number;
  errorCategory?: string | null;
  latencyMs?: number;
}

export interface VideoDemonstrationUsageEventBoundaryOutput {
  ownerUserId: string;
  clientId: string;
  feature: "video_demonstration";
  modality: "VIDEO_GENERATION";
  correlationId: string;
  attemptNumber?: number;
  provider: string;
  model: string;
  providerRequestId?: string;
  usage?: AiUsageQuantities;
  outcome: "SUCCEEDED" | "FAILED";
  errorCategory?: string;
  latencyMs?: number;
}

export function buildVideoDemonstrationUsageEventInput(
  generation: Pick<VideoDemonstrationGenerationRecord, "id" | "ownerUserId" | "clientId" | "provider" | "model">,
  outcome: VideoDemonstrationUsageEventBoundaryInput,
): VideoDemonstrationUsageEventBoundaryOutput {
  return {
    ownerUserId: generation.ownerUserId,
    clientId: generation.clientId,
    feature: "video_demonstration",
    modality: "VIDEO_GENERATION",
    // The generation request's own id IS the correlation id -- shared by
    // every real provider attempt for this exact request (task §9: "cost
    // must be associated with the real operation, not each poll" -- polling
    // itself never calls this function at all, only a real submit attempt
    // does, so this naturally never double-counts a poll as a new attempt).
    correlationId: generation.id,
    ...(outcome.attemptNumber !== undefined ? { attemptNumber: outcome.attemptNumber } : {}),
    provider: generation.provider,
    model: generation.model,
    ...(outcome.providerRequestId ? { providerRequestId: outcome.providerRequestId } : {}),
    ...(outcome.usage ? { usage: outcome.usage } : {}),
    outcome: outcome.outcome,
    ...(outcome.errorCategory ? { errorCategory: outcome.errorCategory } : {}),
    ...(outcome.latencyMs !== undefined ? { latencyMs: outcome.latencyMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ResolvedAuthorityChain {
  photoPreview: NonNullable<Awaited<ReturnType<VideoDemonstrationGenerationTransaction["photoPreviewGeneration"]["findFirst"]>>>;
  sourceAsset: NonNullable<Awaited<ReturnType<VideoDemonstrationGenerationTransaction["imageAsset"]["findFirst"]>>>;
}

// Re-verifies the authority chain fresh, inside the caller's own
// transaction -- never trusts a browser-supplied id, never re-derives from
// the live proposal/map/binding chain (see this file's own header comment).
async function resolveAuthorityChain(
  tx: VideoDemonstrationGenerationTransaction,
  ownerUserId: string,
  clientId: string,
  photoPreviewGenerationId: string,
): Promise<ResolvedAuthorityChain> {
  const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
  if (!client) {
    throw new VideoDemonstrationGenerationDependencyError("VIDEO_DEMONSTRATION_GENERATION_CLIENT_NOT_FOUND", 404, "Client not found.");
  }

  const photoPreview = await tx.photoPreviewGeneration.findFirst({ where: { id: photoPreviewGenerationId, ownerUserId } });
  if (!photoPreview) {
    throw new VideoDemonstrationGenerationDependencyError(
      "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_FOUND",
      404,
      "Photo Preview generation not found.",
    );
  }
  if (photoPreview.clientId !== clientId) {
    throw new VideoDemonstrationGenerationDependencyError(
      "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_CLIENT_MISMATCH",
      404,
      "Photo Preview generation does not belong to this client.",
    );
  }
  // The ONLY authority check Video ever performs (Decision Lock section
  // F/G): the source Photo Preview's own live status must be COMPLETED
  // right now. Its OWN authority chain (proposal/map/binding) is never
  // re-verified here -- it was already verified, and frozen, when the
  // Photo Preview row itself was created.
  if (photoPreview.status !== "COMPLETED" || !photoPreview.generatedImageAssetId) {
    throw new VideoDemonstrationGenerationDependencyError(
      "VIDEO_DEMONSTRATION_GENERATION_PHOTO_PREVIEW_NOT_COMPLETED",
      422,
      `Photo Preview generation ${photoPreview.id} is ${photoPreview.status}; a Video Demonstration can only be created from a COMPLETED Photo Preview.`,
    );
  }

  const sourceAsset = await tx.imageAsset.findFirst({ where: { id: photoPreview.generatedImageAssetId, ownerUserId, deletedAt: null } });
  if (!sourceAsset) {
    throw new VideoDemonstrationGenerationDependencyError(
      "VIDEO_DEMONSTRATION_GENERATION_SOURCE_ASSET_NOT_FOUND",
      404,
      "The Photo Preview's generated image is no longer available.",
    );
  }
  if (sourceAsset.clientId !== clientId) {
    throw new VideoDemonstrationGenerationDependencyError(
      "VIDEO_DEMONSTRATION_GENERATION_DEPENDENCY_CHANGED",
      409,
      "The Photo Preview's generated image no longer belongs to this client.",
    );
  }

  return { photoPreview, sourceAsset };
}

function validateProviderAndModel(provider: string, model: string): void {
  if (!isVideoDemonstrationProviderName(provider)) {
    throw new VideoDemonstrationGenerationValidationError(
      "VIDEO_DEMONSTRATION_GENERATION_INVALID_PROVIDER",
      `"${provider}" is not a supported Video Demonstration provider.`,
    );
  }
  if (!isVideoDemonstrationVeoModel(model)) {
    throw new VideoDemonstrationGenerationValidationError(
      "VIDEO_DEMONSTRATION_GENERATION_INVALID_MODEL",
      `"${model}" is not one of the supported candidate models for this provider.`,
    );
  }
}

function assembleSealedRequest(chain: ResolvedAuthorityChain): SealedVideoDemonstrationRequest {
  const { photoPreview, sourceAsset } = chain;

  if (!isViewLabel(photoPreview.viewLabel)) {
    throw new VideoDemonstrationGenerationInvariantError(`Photo Preview generation ${photoPreview.id} has an invalid viewLabel "${photoPreview.viewLabel}".`);
  }

  const photoPreviewSealed = photoPreview.sealedRequest;
  if (!isSealedPhotoPreviewRequest(photoPreviewSealed)) {
    throw new VideoDemonstrationGenerationInvariantError(`Photo Preview generation ${photoPreview.id} has a malformed sealedRequest.`);
  }

  const request = buildSealedVideoDemonstrationRequest({
    sourceImage: {
      assetId: sourceAsset.id,
      mimeType: sourceAsset.mimeType,
      contentSha256: sourceAsset.contentSha256,
    },
    viewLabel: photoPreview.viewLabel as ViewLabel,
    targetSummary: { structuralTechnique: photoPreviewSealed.target.globalIntent.structuralTechnique },
  });

  if (!isSealedVideoDemonstrationRequest(request)) {
    throw new VideoDemonstrationGenerationInvariantError("Assembled Video Demonstration sealed request failed its own shape validator.");
  }

  return request;
}

interface CreateOrResolveExistingInput {
  ownerUserId: string;
  clientId: string;
  chain: ResolvedAuthorityChain;
  provider: string;
  model: string;
  variationIndex: number;
  sealedRequest: SealedVideoDemonstrationRequest;
  requestFingerprint: string;
}

// Pre-check-then-insert, NOT try-insert-then-recover -- identical reasoning
// and precedent to createOrResolveExisting in photo-preview-generation-repository.ts
// (Postgres poisons the whole transaction on any failed statement; see that
// file's own extensive doc comment for the full explanation).
async function createOrResolveExisting(tx: VideoDemonstrationGenerationTransaction, input: CreateOrResolveExistingInput): Promise<CreateVideoDemonstrationGenerationOutcome> {
  const { chain } = input;

  const existing = await tx.videoDemonstrationGeneration.findFirst({ where: { requestFingerprint: input.requestFingerprint } });
  if (existing) {
    return { record: toVideoDemonstrationGenerationRecord(existing), created: false };
  }

  const row = await tx.videoDemonstrationGeneration.create({
    data: {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      photoPreviewGenerationId: chain.photoPreview.id,
      analysisProposalId: chain.photoPreview.analysisProposalId,
      analysisProposalConfirmedAt: chain.photoPreview.analysisProposalConfirmedAt,
      technicalVisualMapId: chain.photoPreview.technicalVisualMapId,
      mapVersion: chain.photoPreview.mapVersion,
      spatialBindingId: chain.photoPreview.spatialBindingId,
      spatialVersion: chain.photoPreview.spatialVersion,
      sourceGeneratedImageAssetId: chain.sourceAsset.id,
      frozenSourceContentSha256: chain.sourceAsset.contentSha256,
      provider: input.provider,
      model: input.model,
      generationSchemaVersion: VIDEO_DEMONSTRATION_SCHEMA_VERSION,
      sealedRequest: input.sealedRequest as unknown as Prisma.InputJsonValue,
      requestFingerprint: input.requestFingerprint,
      variationIndex: input.variationIndex,
      status: "REQUESTED",
    },
  });
  return { record: toVideoDemonstrationGenerationRecord(row), created: true };
}

async function runVideoDemonstrationGenerationQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new VideoDemonstrationGenerationPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof VideoDemonstrationGenerationPersistenceError ||
      error instanceof VideoDemonstrationGenerationDependencyError ||
      error instanceof VideoDemonstrationGenerationValidationError ||
      error instanceof VideoDemonstrationGenerationInvariantError ||
      error instanceof VideoDemonstrationGenerationConcurrencyError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new VideoDemonstrationGenerationDependencyError("VIDEO_DEMONSTRATION_GENERATION_DEPENDENCY_CHANGED", 409, "Video Demonstration generation dependencies changed.");
    }
    throw new VideoDemonstrationGenerationPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: VideoDemonstrationGenerationTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new VideoDemonstrationGenerationConcurrencyError();
    }
  }
  throw new VideoDemonstrationGenerationConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof VideoDemonstrationGenerationDependencyError ||
    error instanceof VideoDemonstrationGenerationValidationError ||
    error instanceof VideoDemonstrationGenerationInvariantError ||
    error instanceof VideoDemonstrationGenerationPersistenceError ||
    error instanceof VideoDemonstrationGenerationConcurrencyError
  ) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return true;
    if (error.code === "P2002" && hitsFingerprintUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function hitsFingerprintUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText = typeof target === "string" ? target : Array.isArray(target) ? target.filter((entry): entry is string => typeof entry === "string").join(",") : "";
  return targetText.toLowerCase().includes("requestfingerprint");
}

function parseSealedRequest(value: Prisma.JsonValue): SealedVideoDemonstrationRequest {
  if (!isSealedVideoDemonstrationRequest(value)) throw new VideoDemonstrationGenerationPersistenceError();
  return value;
}

function toVideoDemonstrationGenerationRecord(row: PrismaVideoDemonstrationGenerationRow): VideoDemonstrationGenerationRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    photoPreviewGenerationId: row.photoPreviewGenerationId,
    analysisProposalId: row.analysisProposalId,
    analysisProposalConfirmedAt: row.analysisProposalConfirmedAt.toISOString(),
    technicalVisualMapId: row.technicalVisualMapId,
    mapVersion: row.mapVersion,
    spatialBindingId: row.spatialBindingId,
    spatialVersion: row.spatialVersion,
    sourceGeneratedImageAssetId: row.sourceGeneratedImageAssetId,
    frozenSourceContentSha256: row.frozenSourceContentSha256,
    provider: row.provider,
    model: row.model,
    generationSchemaVersion: row.generationSchemaVersion,
    sealedRequest: parseSealedRequest(row.sealedRequest),
    requestFingerprint: row.requestFingerprint,
    variationIndex: row.variationIndex,
    status: row.status as VideoDemonstrationGenerationStatus,
    attemptCount: row.attemptCount,
    providerOperationId: row.providerOperationId,
    generatedVideoAssetId: row.generatedVideoAssetId,
    errorCode: row.errorCode,
    errorMetadata: row.errorMetadata as Record<string, unknown> | null,
    requestedAt: row.requestedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
