import { randomUUID } from "crypto";

import { Prisma, type PhotoPreviewGeneration as PrismaPhotoPreviewGenerationRow } from "@prisma/client";

import type { AiUsageQuantities } from "@/lib/ai-usage-contracts";
import type { TechnicalCutPlan } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  buildSealedPhotoPreviewRequest,
  computePhotoPreviewRequestFingerprint,
  isSealedPhotoPreviewRequest,
  PHOTO_PREVIEW_GENERATION_SCHEMA_VERSION,
  type SealedPhotoPreviewRequest,
} from "@/lib/photo-preview-contracts";
import { isPhotoPreviewGeminiModel, isPhotoPreviewProviderName } from "@/lib/photo-preview-provider-config";
import {
  isTechnicalVisualMapSpatialPayload,
  isViewLabel,
  type ViewLabel,
} from "@/lib/technical-visual-map-spatial-validators";
import {
  isMapAdjustmentEntry,
  isTechnicalVisualMapPayload,
  resolveEffectiveTechnicalVisualMap,
  type MapAdjustmentEntry,
  type TechnicalVisualMapPayload,
} from "@/lib/technical-visual-map-validators";

// Real AI Photo Preview, Stage 1 -- the durable domain/repository layer.
// Mirrors technical-visual-map-spatial-binding-repository.ts's own
// conventions exactly: the runXQuery fail-closed wrapper, the
// runSerializableTransaction retry-on-conflict helper, the ownership-check
// style (owner-scoped findFirst INSIDE the transaction, every ancestor's
// status/ownership/relationship re-verified fresh in that same transaction
// -- never via a separate pre-transaction call -- to close the same TOCTOU
// window every sibling repository in this domain already closes), and the
// typed-error taxonomy.
//
// Authority gate (task §1/§2): a generation may only be created from the
// EXACT confirmed chain reachable from one CONFIRMED spatial binding --
// CONFIRMED TechnicalVisualMapSpatialBinding -> its CONFIRMED
// TechnicalVisualMap -> its CONFIRMED AnalysisProposal -> its owned source
// ImageAsset. Every hop is re-verified fresh, by id AND by clientId
// equality, never trusted transitively. "Current" is never inferred by
// "latest row" -- checking the NAMED row's own live status is sufficient
// (and correct) because this domain's own partial unique indexes already
// guarantee at most one CONFIRMED row per scope: if a newer sibling had
// superseded it, this exact row's own status would already read
// SUPERSEDED, not CONFIRMED.

const MAX_TRANSACTION_ATTEMPTS = 3;

export class PhotoPreviewGenerationPersistenceError extends Error {
  readonly code = "PHOTO_PREVIEW_GENERATION_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Photo Preview generation data is temporarily unavailable.");
    this.name = "PhotoPreviewGenerationPersistenceError";
  }
}

export class PhotoPreviewGenerationDependencyError extends Error {
  constructor(
    readonly code:
      | "PHOTO_PREVIEW_GENERATION_CLIENT_NOT_FOUND"
      | "PHOTO_PREVIEW_GENERATION_BINDING_NOT_FOUND"
      | "PHOTO_PREVIEW_GENERATION_BINDING_CLIENT_MISMATCH"
      | "PHOTO_PREVIEW_GENERATION_BINDING_NOT_CONFIRMED"
      | "PHOTO_PREVIEW_GENERATION_MAP_NOT_FOUND"
      | "PHOTO_PREVIEW_GENERATION_MAP_CLIENT_MISMATCH"
      | "PHOTO_PREVIEW_GENERATION_MAP_NOT_CONFIRMED"
      | "PHOTO_PREVIEW_GENERATION_PROPOSAL_NOT_FOUND"
      | "PHOTO_PREVIEW_GENERATION_PROPOSAL_CLIENT_MISMATCH"
      | "PHOTO_PREVIEW_GENERATION_PROPOSAL_NOT_CONFIRMED"
      | "PHOTO_PREVIEW_GENERATION_SOURCE_ASSET_NOT_FOUND"
      | "PHOTO_PREVIEW_GENERATION_SOURCE_ASSET_CLIENT_MISMATCH"
      | "PHOTO_PREVIEW_GENERATION_DEPENDENCY_CHANGED",
    readonly httpStatus: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "PhotoPreviewGenerationDependencyError";
  }
}

export class PhotoPreviewGenerationValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code:
      | "PHOTO_PREVIEW_GENERATION_INVALID_PROVIDER"
      | "PHOTO_PREVIEW_GENERATION_INVALID_MODEL",
    message: string,
  ) {
    super(message);
    this.name = "PhotoPreviewGenerationValidationError";
  }
}

// "This should be impossible" -- data that already passed every upstream
// domain validator (a CONFIRMED map's own payload, a CONFIRMED binding's
// own payload, a CONFIRMED proposal's own confirmedAt) turned out malformed
// when re-read here. Never silently coerced or skipped.
export class PhotoPreviewGenerationInvariantError extends Error {
  readonly code = "PHOTO_PREVIEW_GENERATION_INVARIANT_VIOLATED";
  readonly httpStatus = 500;

  constructor(message: string) {
    super(message);
    this.name = "PhotoPreviewGenerationInvariantError";
  }
}

// Retries were exhausted while resolving a genuine concurrent conflict
// (task §20's DB backstop working as intended, just under unusually heavy
// contention). Distinct from PhotoPreviewGenerationPersistenceError, which
// means the database itself is unavailable -- this means it IS available
// and the operation is safe to simply retry from the caller's side.
export class PhotoPreviewGenerationConcurrencyError extends Error {
  readonly code = "PHOTO_PREVIEW_GENERATION_CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;

  constructor() {
    super("Photo Preview generation could not be created because of a concurrent conflict. Please try again.");
    this.name = "PhotoPreviewGenerationConcurrencyError";
  }
}

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

export type PhotoPreviewGenerationStatus = "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface PhotoPreviewGenerationRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  analysisProposalId: string;
  analysisProposalConfirmedAt: string;
  technicalVisualMapId: string;
  mapVersion: number;
  spatialBindingId: string;
  spatialVersion: number;
  sourceImageAssetId: string;
  sourceImageAnalysisId: string | null;
  viewLabel: ViewLabel;
  frozenSourceWidth: number;
  frozenSourceHeight: number;
  frozenSourceOrientation: number;
  frozenSourceContentSha256: string | null;
  frozenSourceStorageVersionId: string | null;
  provider: string;
  model: string;
  generationSchemaVersion: string;
  sealedRequest: SealedPhotoPreviewRequest;
  requestFingerprint: string;
  variationIndex: number;
  status: PhotoPreviewGenerationStatus;
  providerRequestId: string | null;
  generatedImageAssetId: string | null;
  errorCode: string | null;
  errorMetadata: Record<string, unknown> | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePhotoPreviewGenerationOutcome {
  record: PhotoPreviewGenerationRecord;
  // false when this call resolved to an already-existing generation instead
  // of creating a new one -- task §19: "repeat of same submission should
  // return existing request instead of creating duplicate paid work."
  created: boolean;
}

type PhotoPreviewGenerationTransaction = Pick<
  Prisma.TransactionClient,
  "photoPreviewGeneration" | "client" | "technicalVisualMapSpatialBinding" | "technicalVisualMap" | "analysisProposal" | "imageAsset"
>;

// ---------------------------------------------------------------------------
// createPhotoPreviewGeneration / createPhotoPreviewGenerationVariation
// ---------------------------------------------------------------------------

// The ordinary "Generate" action -- always variationIndex 0. Idempotent: a
// second call for the exact same (owner, client, spatial binding + its
// current spatialVersion, provider, model) scope returns the SAME row
// rather than creating a second billable job (task §18/§19).
export async function createPhotoPreviewGeneration(
  ownerUserId: string,
  clientId: string,
  spatialBindingId: string,
  provider: string,
  model: string,
): Promise<CreatePhotoPreviewGenerationOutcome> {
  return runPhotoPreviewGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const chain = await resolveAuthorityChain(tx, ownerUserId, clientId, spatialBindingId);
      validateProviderAndModel(provider, model);
      const sealedRequest = assembleSealedRequest(chain);

      const requestFingerprint = computePhotoPreviewRequestFingerprint({
        ownerUserId,
        clientId,
        spatialBindingId: chain.binding.id,
        spatialVersion: chain.binding.spatialVersion,
        provider,
        model,
        variationIndex: 0,
      });

      return createOrResolveExisting(tx, {
        ownerUserId,
        clientId,
        chain,
        provider,
        model,
        variationIndex: 0,
        sealedRequest,
        requestFingerprint,
      });
    }),
  );
}

// The explicit "Generate another variation" action (task §18/§29/§30) --
// always creates a genuinely NEW row bound to the exact same authoritative
// intent. variationIndex is allocated SERVER-SIDE, transactionally (MAX+1
// within this exact scope), mirroring createDraftSpatialBinding's own
// spatialVersion allocation exactly -- never a caller-supplied nonce, which
// would either need to be trusted or would reopen the same race a
// server-allocated counter already closes.
export async function createPhotoPreviewGenerationVariation(
  ownerUserId: string,
  clientId: string,
  spatialBindingId: string,
  provider: string,
  model: string,
): Promise<CreatePhotoPreviewGenerationOutcome> {
  return runPhotoPreviewGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const chain = await resolveAuthorityChain(tx, ownerUserId, clientId, spatialBindingId);
      validateProviderAndModel(provider, model);
      const sealedRequest = assembleSealedRequest(chain);

      const maxVariation = await tx.photoPreviewGeneration.aggregate({
        where: { ownerUserId, clientId, spatialBindingId: chain.binding.id, provider, model },
        _max: { variationIndex: true },
      });
      const variationIndex = (maxVariation._max.variationIndex ?? -1) + 1;

      const requestFingerprint = computePhotoPreviewRequestFingerprint({
        ownerUserId,
        clientId,
        spatialBindingId: chain.binding.id,
        spatialVersion: chain.binding.spatialVersion,
        provider,
        model,
        variationIndex,
      });

      return createOrResolveExisting(tx, {
        ownerUserId,
        clientId,
        chain,
        provider,
        model,
        variationIndex,
        sealedRequest,
        requestFingerprint,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findPhotoPreviewGenerationForOwner(
  ownerUserId: string,
  id: string,
): Promise<PhotoPreviewGenerationRecord | null> {
  return runPhotoPreviewGenerationQuery(async () => {
    const row = await prisma.photoPreviewGeneration.findFirst({ where: { id, ownerUserId } });
    return row ? toPhotoPreviewGenerationRecord(row) : null;
  });
}

// Full history for one exact spatial binding -- newest requested first.
// Multiple providers/models/variations can legitimately coexist for the
// same binding (a controlled A/B comparison is the explicit point of
// keeping `model` on every row rather than a single global setting).
export async function listPhotoPreviewGenerationsForBinding(
  ownerUserId: string,
  clientId: string,
  spatialBindingId: string,
): Promise<PhotoPreviewGenerationRecord[]> {
  return runPhotoPreviewGenerationQuery(async () => {
    const rows = await prisma.photoPreviewGeneration.findMany({
      where: { ownerUserId, clientId, spatialBindingId },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toPhotoPreviewGenerationRecord);
  });
}

// ---------------------------------------------------------------------------
// AiUsageEvent integration boundary (task §23, widened in Stage 2 now that
// real usage data exists) -- a PURE mapping function only; it never itself
// calls recordAiUsageEvent (ai-usage-repository.ts). `usage` is deliberately
// omitted whenever the caller has none to report -- never coerced to a
// fabricated object of zeros (ai-usage-contracts.ts's own "never fabricate"
// convention). `attemptNumber` threads through the exact attempt number
// claimPhotoPreviewGenerationForExecution returned, so a retried generation
// meters each real attempt distinctly (task §22/§41) rather than
// conflating them under attempt 1.
// ---------------------------------------------------------------------------

export interface PhotoPreviewUsageEventBoundaryInput {
  outcome: "SUCCEEDED" | "FAILED";
  providerRequestId?: string | null;
  usage?: AiUsageQuantities;
  attemptNumber?: number;
  errorCategory?: string | null;
  latencyMs?: number;
}

export interface PhotoPreviewUsageEventBoundaryOutput {
  ownerUserId: string;
  clientId: string;
  feature: "photo_preview";
  modality: "IMAGE_GENERATION";
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

export function buildPhotoPreviewUsageEventInput(
  generation: Pick<PhotoPreviewGenerationRecord, "id" | "ownerUserId" | "clientId" | "provider" | "model">,
  outcome: PhotoPreviewUsageEventBoundaryInput,
): PhotoPreviewUsageEventBoundaryOutput {
  return {
    ownerUserId: generation.ownerUserId,
    clientId: generation.clientId,
    feature: "photo_preview",
    modality: "IMAGE_GENERATION",
    // The generation request's own id IS the correlation id -- every real
    // provider attempt for this exact request (first try, any retry) shares
    // it, mirroring AiUsageEvent's own correlationId/attemptNumber contract.
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
  proposal: NonNullable<Awaited<ReturnType<PhotoPreviewGenerationTransaction["analysisProposal"]["findFirst"]>>>;
  map: NonNullable<Awaited<ReturnType<PhotoPreviewGenerationTransaction["technicalVisualMap"]["findFirst"]>>>;
  binding: NonNullable<Awaited<ReturnType<PhotoPreviewGenerationTransaction["technicalVisualMapSpatialBinding"]["findFirst"]>>>;
  asset: NonNullable<Awaited<ReturnType<PhotoPreviewGenerationTransaction["imageAsset"]["findFirst"]>>>;
}

// Re-verifies EVERY hop of the authority chain fresh, inside the caller's
// own transaction (task §1/§2) -- never trusts a browser-supplied id chain,
// never infers "current" by latest-row, never assumes a grandparent is
// still eligible just because an intermediate parent's own id matches.
async function resolveAuthorityChain(
  tx: PhotoPreviewGenerationTransaction,
  ownerUserId: string,
  clientId: string,
  spatialBindingId: string,
): Promise<ResolvedAuthorityChain> {
  const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
  if (!client) {
    throw new PhotoPreviewGenerationDependencyError("PHOTO_PREVIEW_GENERATION_CLIENT_NOT_FOUND", 404, "Client not found.");
  }

  const binding = await tx.technicalVisualMapSpatialBinding.findFirst({ where: { id: spatialBindingId, ownerUserId } });
  if (!binding) {
    throw new PhotoPreviewGenerationDependencyError("PHOTO_PREVIEW_GENERATION_BINDING_NOT_FOUND", 404, "Spatial binding not found.");
  }
  if (binding.clientId !== clientId) {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_BINDING_CLIENT_MISMATCH",
      404,
      "Spatial binding does not belong to this client.",
    );
  }
  // The binding's OWN live status is the authoritative "is this eligible"
  // check -- the partial unique index elsewhere in this domain already
  // guarantees at most one CONFIRMED binding per (map, image, view) scope,
  // so if a newer sibling had superseded this exact row, its own status
  // would already read SUPERSEDED here, not CONFIRMED. No separate
  // "find current" lookup is needed or more correct than this.
  if (binding.status !== "CONFIRMED") {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_BINDING_NOT_CONFIRMED",
      422,
      `Spatial binding ${binding.id} is ${binding.status}; a Photo Preview generation can only be created from a CONFIRMED spatial binding.`,
    );
  }

  const map = await tx.technicalVisualMap.findFirst({ where: { id: binding.technicalVisualMapId, ownerUserId } });
  if (!map) {
    throw new PhotoPreviewGenerationDependencyError("PHOTO_PREVIEW_GENERATION_MAP_NOT_FOUND", 404, "Technical Visual Map not found.");
  }
  if (map.clientId !== clientId) {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_MAP_CLIENT_MISMATCH",
      404,
      "Technical Visual Map does not belong to this client.",
    );
  }
  if (map.status !== "CONFIRMED") {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_MAP_NOT_CONFIRMED",
      422,
      `Technical Visual Map ${map.id} is ${map.status}; its spatial binding was confirmed under it, but the map itself is no longer eligible for new generation.`,
    );
  }

  const proposal = await tx.analysisProposal.findFirst({ where: { id: map.analysisProposalId, ownerUserId } });
  if (!proposal) {
    throw new PhotoPreviewGenerationDependencyError("PHOTO_PREVIEW_GENERATION_PROPOSAL_NOT_FOUND", 404, "Proposal not found.");
  }
  if (proposal.clientId !== clientId) {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_PROPOSAL_CLIENT_MISMATCH",
      404,
      "Proposal does not belong to this client.",
    );
  }
  if (proposal.status !== "CONFIRMED" || !proposal.confirmedAt) {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_PROPOSAL_NOT_CONFIRMED",
      422,
      `Proposal ${proposal.id} is ${proposal.status}; its Technical Visual Map was confirmed under it, but the proposal itself is no longer eligible for new generation.`,
    );
  }

  const asset = await tx.imageAsset.findFirst({ where: { id: binding.sourceImageAssetId, ownerUserId, deletedAt: null } });
  if (!asset) {
    throw new PhotoPreviewGenerationDependencyError("PHOTO_PREVIEW_GENERATION_SOURCE_ASSET_NOT_FOUND", 404, "Source image not found.");
  }
  if (asset.clientId !== clientId) {
    throw new PhotoPreviewGenerationDependencyError(
      "PHOTO_PREVIEW_GENERATION_SOURCE_ASSET_CLIENT_MISMATCH",
      404,
      "Source image does not belong to this client.",
    );
  }
  if (asset.width == null || asset.height == null) {
    // Should be structurally impossible -- a CONFIRMED spatial binding can
    // only ever have been created from an asset that already had
    // dimensions (Stage 5B's own createDraftSpatialBinding guarantee).
    // Surfaced as a real invariant violation, never silently worked around.
    throw new PhotoPreviewGenerationInvariantError(
      `Source image ${asset.id} has no recorded dimensions, but its spatial binding ${binding.id} is CONFIRMED -- this should be impossible.`,
    );
  }

  return { proposal, map, binding, asset };
}

function validateProviderAndModel(provider: string, model: string): void {
  if (!isPhotoPreviewProviderName(provider)) {
    throw new PhotoPreviewGenerationValidationError(
      "PHOTO_PREVIEW_GENERATION_INVALID_PROVIDER",
      `"${provider}" is not a supported Photo Preview provider.`,
    );
  }
  if (!isPhotoPreviewGeminiModel(model)) {
    throw new PhotoPreviewGenerationValidationError(
      "PHOTO_PREVIEW_GENERATION_INVALID_MODEL",
      `"${model}" is not one of the supported candidate models for this provider.`,
    );
  }
}

function assembleSealedRequest(chain: ResolvedAuthorityChain): SealedPhotoPreviewRequest {
  const { proposal, map, binding, asset } = chain;

  if (!isViewLabel(binding.viewLabel)) {
    throw new PhotoPreviewGenerationInvariantError(`Spatial binding ${binding.id} has an invalid viewLabel "${binding.viewLabel}".`);
  }

  const spatialPayload = binding.payload;
  if (!isTechnicalVisualMapSpatialPayload(spatialPayload)) {
    throw new PhotoPreviewGenerationInvariantError(`Spatial binding ${binding.id} has a malformed payload.`);
  }

  const mapBaseline = map.payload;
  if (!isTechnicalVisualMapPayload(mapBaseline)) {
    throw new PhotoPreviewGenerationInvariantError(`Technical Visual Map ${map.id} has a malformed payload.`);
  }
  const rawAdjustments = map.professionalAdjustments;
  const adjustments: MapAdjustmentEntry[] =
    Array.isArray(rawAdjustments) && rawAdjustments.every(isMapAdjustmentEntry) ? (rawAdjustments as unknown as MapAdjustmentEntry[]) : [];
  const effectiveTarget: TechnicalVisualMapPayload = resolveEffectiveTechnicalVisualMap(mapBaseline, adjustments);

  const cutPlan = proposal.payload as unknown as Partial<TechnicalCutPlan> | null;
  const contraindications =
    cutPlan && Array.isArray(cutPlan.contraindications) ? cutPlan.contraindications.filter((entry): entry is string => typeof entry === "string") : [];

  return buildSealedPhotoPreviewRequest({
    sourceImage: {
      assetId: asset.id,
      width: asset.width as number,
      height: asset.height as number,
      orientation: asset.normalizedOrientation,
      contentSha256: asset.contentSha256,
      storageVersionId: asset.storageVersionId,
    },
    viewLabel: binding.viewLabel,
    target: {
      globalIntent: effectiveTarget.globalIntent,
      zones: effectiveTarget.zones,
      relationships: effectiveTarget.relationships,
    },
    spatial: spatialPayload,
    mapPreserveConstraints: effectiveTarget.preserveConstraints,
    contraindications,
  });
}

interface CreateOrResolveExistingInput {
  ownerUserId: string;
  clientId: string;
  chain: ResolvedAuthorityChain;
  provider: string;
  model: string;
  variationIndex: number;
  sealedRequest: SealedPhotoPreviewRequest;
  requestFingerprint: string;
}

// Pre-check-then-insert, NOT try-insert-then-recover: Postgres aborts an
// entire transaction as soon as ANY statement inside it fails (a unique-
// violation included) -- once that happens, EVERY further statement on
// that same connection/transaction fails with 25P02 ("current transaction
// is aborted"), no matter how the JS-level exception is caught. A prior
// version of this function caught the P2002 from create() and then tried
// to `findFirst` the existing row on the SAME `tx` to resolve it -- that
// findFirst always failed with 25P02 in practice (caught live by this
// module's own concurrency tests), because the transaction was already
// poisoned. The fix: check first (resolves the common case -- an
// already-committed idempotent repeat -- with a read-only query that can
// never poison anything), and only attempt the insert if nothing was
// found. A genuine, truly concurrent race (two transactions both pass the
// pre-check before either commits) still throws a real P2002 here -- that
// error is deliberately let to propagate all the way out of this
// transaction (never caught here), because runSerializableTransaction's
// own retry wrapper treats a requestFingerprint collision as retryable
// (mirrors technical-visual-map-spatial-binding-repository.ts's own
// hitsSpatialBindingUniqueIndex precedent exactly): a FRESH transaction on
// retry re-runs the pre-check, which by then finds the now-committed row.
async function createOrResolveExisting(
  tx: PhotoPreviewGenerationTransaction,
  input: CreateOrResolveExistingInput,
): Promise<CreatePhotoPreviewGenerationOutcome> {
  const { chain } = input;

  const existing = await tx.photoPreviewGeneration.findFirst({ where: { requestFingerprint: input.requestFingerprint } });
  if (existing) {
    return { record: toPhotoPreviewGenerationRecord(existing), created: false };
  }

  const row = await tx.photoPreviewGeneration.create({
    data: {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      clientId: input.clientId,
      analysisProposalId: chain.proposal.id,
      analysisProposalConfirmedAt: chain.proposal.confirmedAt as Date,
      technicalVisualMapId: chain.map.id,
      mapVersion: chain.map.mapVersion,
      spatialBindingId: chain.binding.id,
      spatialVersion: chain.binding.spatialVersion,
      sourceImageAssetId: chain.asset.id,
      sourceImageAnalysisId: chain.binding.sourceImageAnalysisId,
      viewLabel: chain.binding.viewLabel,
      frozenSourceWidth: chain.asset.width as number,
      frozenSourceHeight: chain.asset.height as number,
      frozenSourceOrientation: chain.asset.normalizedOrientation,
      frozenSourceContentSha256: chain.asset.contentSha256,
      frozenSourceStorageVersionId: chain.asset.storageVersionId,
      provider: input.provider,
      model: input.model,
      generationSchemaVersion: PHOTO_PREVIEW_GENERATION_SCHEMA_VERSION,
      sealedRequest: input.sealedRequest as unknown as Prisma.InputJsonValue,
      requestFingerprint: input.requestFingerprint,
      variationIndex: input.variationIndex,
      status: "REQUESTED",
    },
  });
  return { record: toPhotoPreviewGenerationRecord(row), created: true };
}

function hitsFingerprintUniqueIndex(error: Prisma.PrismaClientKnownRequestError): boolean {
  const meta = (error.meta ?? {}) as Record<string, unknown>;
  const target = meta.target;
  const targetText =
    typeof target === "string" ? target : Array.isArray(target) ? target.filter((entry): entry is string => typeof entry === "string").join(",") : "";
  return targetText.toLowerCase().includes("requestfingerprint");
}

async function runPhotoPreviewGenerationQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new PhotoPreviewGenerationPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof PhotoPreviewGenerationPersistenceError ||
      error instanceof PhotoPreviewGenerationDependencyError ||
      error instanceof PhotoPreviewGenerationValidationError ||
      error instanceof PhotoPreviewGenerationInvariantError ||
      error instanceof PhotoPreviewGenerationConcurrencyError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new PhotoPreviewGenerationDependencyError(
        "PHOTO_PREVIEW_GENERATION_DEPENDENCY_CHANGED",
        409,
        "Photo Preview generation dependencies changed.",
      );
    }
    throw new PhotoPreviewGenerationPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: PhotoPreviewGenerationTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new PhotoPreviewGenerationConcurrencyError();
    }
  }

  throw new PhotoPreviewGenerationConcurrencyError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof PhotoPreviewGenerationDependencyError ||
    error instanceof PhotoPreviewGenerationValidationError ||
    error instanceof PhotoPreviewGenerationInvariantError ||
    error instanceof PhotoPreviewGenerationPersistenceError ||
    error instanceof PhotoPreviewGenerationConcurrencyError
  ) {
    return false;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: transaction write conflict / deadlock (Postgres 40001 / 40P01)
    // -- e.g. two concurrent createPhotoPreviewGenerationVariation calls
    // racing on the same MAX(variationIndex) read. Retrying re-reads fresh
    // data and allocates a genuinely different index on the next attempt.
    if (error.code === "P2034") return true;
    // P2002 on requestFingerprint: a truly concurrent transaction committed
    // the identical row between our own pre-check and insert
    // (createOrResolveExisting). Retrying re-runs the pre-check in a FRESH
    // transaction, which now finds the just-committed row -- exactly the
    // technical-visual-map-spatial-binding-repository.ts precedent
    // (hitsSpatialBindingUniqueIndex) for its own sibling unique indexes.
    if (error.code === "P2002" && hitsFingerprintUniqueIndex(error)) return true;
    return false;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function parseSealedRequest(value: Prisma.JsonValue): SealedPhotoPreviewRequest {
  if (!isSealedPhotoPreviewRequest(value)) throw new PhotoPreviewGenerationPersistenceError();
  return value;
}

function toPhotoPreviewGenerationRecord(row: PrismaPhotoPreviewGenerationRow): PhotoPreviewGenerationRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    analysisProposalId: row.analysisProposalId,
    analysisProposalConfirmedAt: row.analysisProposalConfirmedAt.toISOString(),
    technicalVisualMapId: row.technicalVisualMapId,
    mapVersion: row.mapVersion,
    spatialBindingId: row.spatialBindingId,
    spatialVersion: row.spatialVersion,
    sourceImageAssetId: row.sourceImageAssetId,
    sourceImageAnalysisId: row.sourceImageAnalysisId,
    viewLabel: row.viewLabel as ViewLabel,
    frozenSourceWidth: row.frozenSourceWidth,
    frozenSourceHeight: row.frozenSourceHeight,
    frozenSourceOrientation: row.frozenSourceOrientation,
    frozenSourceContentSha256: row.frozenSourceContentSha256,
    frozenSourceStorageVersionId: row.frozenSourceStorageVersionId,
    provider: row.provider,
    model: row.model,
    generationSchemaVersion: row.generationSchemaVersion,
    sealedRequest: parseSealedRequest(row.sealedRequest),
    requestFingerprint: row.requestFingerprint,
    variationIndex: row.variationIndex,
    status: row.status as PhotoPreviewGenerationStatus,
    providerRequestId: row.providerRequestId,
    generatedImageAssetId: row.generatedImageAssetId,
    errorCode: row.errorCode,
    errorMetadata: row.errorMetadata as Record<string, unknown> | null,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
