import { randomUUID } from "crypto";

import { Prisma, type TechnicalExecutionGenerationRequest as PrismaRequestRow } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import {
  evaluateTechnicalExecutionGenerationReadiness,
  isQualificationEvidenceSource,
  isQualificationStatus,
  isTechnicalExecutionGenerationPurpose,
  type QualificationEvidenceSource,
  type QualificationStatus,
  type TechnicalExecutionGenerationPurpose,
  type TechnicalExecutionGenerationReadinessResult,
} from "@/lib/technical-execution-generation-validators";

// AI Hair Architect, Stage 2.5.i.22 -- TECHNICAL EXECUTION GENERATION
// AUTHORIZATION + IMAGE QUALIFICATION, the domain/repository layer.
// Deliberately mirrors capture-set-repository.ts's own conventions
// exactly: the runSerializableTransaction retry-on-conflict helper, the
// runXQuery fail-closed wrapper, the ownership-check style (owner-scoped
// findFirst inside the transaction), and the typed-error taxonomy.
//
// LOCKED (Stage 2.5.i.20/i.21a): consent is PER_GENERATION, affirmative
// only -- this file never grants, infers, or inherits it from anywhere
// (not from ImageAnalysis, not from Capture Set existence, not from a
// different request). Image-quality qualification is a purpose-specific
// snapshot living directly on one request row, never a global
// ImageAsset/CaptureSetImage property. Provider Adapter (Stage 2.5.i.21)
// never selects the image and never creates/infers consent or
// qualification -- this file's own `getTechnicalExecutionGenerationReadiness`
// is the ONLY function that proves a request is safe to hand to it.
//
// SEALED = IMMUTABLE: once `sealedAt` is set, `grantConsent` and
// `recordQualification` both refuse to write, throwing
// TechnicalExecutionGenerationSealedError. No function anywhere in this
// file can ever change the selected image/Capture Set/purpose binding
// after creation -- sealed or not -- changing the selection means
// creating an entirely new request row (Stage 2.5.i.22 §11's own
// explicit rule).
//
// NO CAMERA, NO UI, NO API ROUTE, NO PROVIDER CALL, NO AI CALL anywhere
// in this file -- Stage 2.5.i.22's own explicit non-goal list.

export const TECHNICAL_EXECUTION_GENERATION_PERSISTENCE_ERROR_CODE = "TECHNICAL_EXECUTION_GENERATION_PERSISTENCE_UNAVAILABLE";
const MAX_TRANSACTION_ATTEMPTS = 3;

export class TechnicalExecutionGenerationPersistenceError extends Error {
  readonly code = TECHNICAL_EXECUTION_GENERATION_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Technical Execution Generation data is temporarily unavailable.");
    this.name = "TechnicalExecutionGenerationPersistenceError";
  }
}

export class TechnicalExecutionGenerationDependencyError extends Error {
  constructor(
    readonly code:
      | "TECHNICAL_EXECUTION_GENERATION_CLIENT_NOT_FOUND"
      | "TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_NOT_FOUND"
      | "TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_IMAGE_NOT_FOUND"
      | "TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_IMAGE_MISMATCH",
    readonly httpStatus: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "TechnicalExecutionGenerationDependencyError";
  }
}

export class TechnicalExecutionGenerationValidationError extends Error {
  readonly httpStatus = 422;

  constructor(
    readonly code:
      | "TECHNICAL_EXECUTION_GENERATION_INVALID_PURPOSE"
      | "TECHNICAL_EXECUTION_GENERATION_INVALID_CONSENT_VERSION"
      | "TECHNICAL_EXECUTION_GENERATION_INVALID_QUALIFICATION_STATUS"
      | "TECHNICAL_EXECUTION_GENERATION_INVALID_EVIDENCE_SOURCE"
      | "TECHNICAL_EXECUTION_GENERATION_CANNOT_SEAL",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalExecutionGenerationValidationError";
  }
}

// Thrown by grantConsent/recordQualification once sealedAt is already
// set -- the request is permanently immutable from that point on.
export class TechnicalExecutionGenerationSealedError extends Error {
  readonly code = "TECHNICAL_EXECUTION_GENERATION_ALREADY_SEALED";
  readonly httpStatus = 409;

  constructor(requestId: string) {
    super(`Technical Execution Generation request ${requestId} is already sealed and cannot be modified.`);
    this.name = "TechnicalExecutionGenerationSealedError";
  }
}

// ---------------------------------------------------------------------------
// Record shape returned to callers
// ---------------------------------------------------------------------------

export interface TechnicalExecutionGenerationRequestRecord {
  id: string;
  ownerUserId: string;
  clientId: string;
  purpose: string;
  captureSetId: string;
  captureSetImageId: string;
  imageAssetId: string;
  consentGrantedAt: string | null;
  consentVersion: string | null;
  qualificationStatus: string;
  qualificationEvidenceSource: string | null;
  qualificationReason: string | null;
  qualifiedAt: string | null;
  sealedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type TechnicalExecutionGenerationTransaction = Pick<
  Prisma.TransactionClient,
  "technicalExecutionGenerationRequest" | "client" | "captureSet" | "captureSetImage"
>;

// ---------------------------------------------------------------------------
// createTechnicalExecutionGenerationRequest
// ---------------------------------------------------------------------------

// Creates a new request row, bound at creation time to exactly one
// explicitly-selected CaptureSetImage. Every dependency is verified
// fresh, INSIDE the transaction: the client is owned, the Capture Set
// belongs to that exact (ownerUserId, clientId), and the selected
// CaptureSetImage belongs to that exact Capture Set AND the same
// (ownerUserId, clientId). The ImageAsset reference is frozen (copied
// from the CaptureSetImage's own imageAssetId) at this moment, never
// re-read live afterward. Consent starts ungranted; qualification starts
// NOT_EVALUATED; the request starts unsealed -- nothing here grants
// authority the caller did not already have.
export async function createTechnicalExecutionGenerationRequest(
  ownerUserId: string,
  clientId: string,
  purpose: string,
  captureSetId: string,
  captureSetImageId: string,
): Promise<TechnicalExecutionGenerationRequestRecord> {
  if (!isTechnicalExecutionGenerationPurpose(purpose)) {
    throw new TechnicalExecutionGenerationValidationError("TECHNICAL_EXECUTION_GENERATION_INVALID_PURPOSE", `"${purpose}" is not a recognized purpose.`);
  }

  return runTechnicalExecutionGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: clientId, ownerUserId, deletedAt: null }, select: { id: true } });
      if (!client) {
        throw new TechnicalExecutionGenerationDependencyError("TECHNICAL_EXECUTION_GENERATION_CLIENT_NOT_FOUND", 404, "Client not found.");
      }

      const captureSet = await tx.captureSet.findFirst({ where: { id: captureSetId, ownerUserId, clientId }, select: { id: true } });
      if (!captureSet) {
        throw new TechnicalExecutionGenerationDependencyError("TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_NOT_FOUND", 404, "Capture Set not found for this client.");
      }

      const captureSetImage = await tx.captureSetImage.findFirst({
        where: { id: captureSetImageId, ownerUserId, clientId },
        select: { id: true, captureSetId: true, imageAssetId: true },
      });
      if (!captureSetImage) {
        throw new TechnicalExecutionGenerationDependencyError("TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_IMAGE_NOT_FOUND", 404, "Capture Set image not found for this client.");
      }
      if (captureSetImage.captureSetId !== captureSetId) {
        throw new TechnicalExecutionGenerationDependencyError(
          "TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_IMAGE_MISMATCH",
          409,
          "Selected image does not belong to the selected Capture Set.",
        );
      }

      const row = await tx.technicalExecutionGenerationRequest.create({
        data: {
          id: randomUUID(),
          ownerUserId,
          clientId,
          purpose,
          captureSetId,
          captureSetImageId,
          imageAssetId: captureSetImage.imageAssetId,
          qualificationStatus: "NOT_EVALUATED",
        },
      });
      return toRecord(row);
    }),
  );
}

// ---------------------------------------------------------------------------
// grantTechnicalExecutionGenerationConsent
// ---------------------------------------------------------------------------

// Explicit, affirmative consent only -- never a default, never inherited.
// Refuses once the request is sealed.
export async function grantTechnicalExecutionGenerationConsent(
  ownerUserId: string,
  requestId: string,
  consentVersion: string,
): Promise<TechnicalExecutionGenerationRequestRecord | null> {
  if (typeof consentVersion !== "string" || consentVersion.length === 0) {
    throw new TechnicalExecutionGenerationValidationError("TECHNICAL_EXECUTION_GENERATION_INVALID_CONSENT_VERSION", "consentVersion must be a non-empty string.");
  }

  return runTechnicalExecutionGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.technicalExecutionGenerationRequest.findFirst({ where: { id: requestId, ownerUserId } });
      if (!row) return null;
      if (row.sealedAt !== null) throw new TechnicalExecutionGenerationSealedError(requestId);

      const updated = await tx.technicalExecutionGenerationRequest.update({
        where: { id: row.id },
        data: { consentGrantedAt: new Date(), consentVersion },
      });
      return toRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// recordTechnicalExecutionGenerationQualification
// ---------------------------------------------------------------------------

// Records a QUALIFIED or REJECTED evaluation (never NOT_EVALUATED --
// that is only ever the implicit initial state, never something to
// "record"). `reason` is audit/presentation text ONLY -- never read back
// as technical authority by any validator in this domain. Refuses once
// the request is sealed.
export async function recordTechnicalExecutionGenerationQualification(
  ownerUserId: string,
  requestId: string,
  status: QualificationStatus,
  evidenceSource: QualificationEvidenceSource,
  reason?: string,
): Promise<TechnicalExecutionGenerationRequestRecord | null> {
  if (!isQualificationStatus(status) || status === "NOT_EVALUATED") {
    throw new TechnicalExecutionGenerationValidationError(
      "TECHNICAL_EXECUTION_GENERATION_INVALID_QUALIFICATION_STATUS",
      "status must be QUALIFIED or REJECTED.",
    );
  }
  if (!isQualificationEvidenceSource(evidenceSource)) {
    throw new TechnicalExecutionGenerationValidationError("TECHNICAL_EXECUTION_GENERATION_INVALID_EVIDENCE_SOURCE", `"${evidenceSource}" is not a recognized evidence source.`);
  }

  return runTechnicalExecutionGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.technicalExecutionGenerationRequest.findFirst({ where: { id: requestId, ownerUserId } });
      if (!row) return null;
      if (row.sealedAt !== null) throw new TechnicalExecutionGenerationSealedError(requestId);

      const updated = await tx.technicalExecutionGenerationRequest.update({
        where: { id: row.id },
        data: {
          qualificationStatus: status,
          qualificationEvidenceSource: evidenceSource,
          qualificationReason: reason ?? null,
          qualifiedAt: new Date(),
        },
      });
      return toRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// sealTechnicalExecutionGenerationRequest
// ---------------------------------------------------------------------------

// A request may only be sealed once it already carries affirmative
// consent AND a QUALIFIED image -- sealing an incomplete request would
// be meaningless (there would be nothing honest to hand the Provider
// Adapter). Idempotent: sealing an already-sealed request simply returns
// its current, unchanged state rather than erroring.
export async function sealTechnicalExecutionGenerationRequest(ownerUserId: string, requestId: string): Promise<TechnicalExecutionGenerationRequestRecord | null> {
  return runTechnicalExecutionGenerationQuery(() =>
    runSerializableTransaction(async (tx) => {
      const row = await tx.technicalExecutionGenerationRequest.findFirst({ where: { id: requestId, ownerUserId } });
      if (!row) return null;
      if (row.sealedAt !== null) return toRecord(row);

      if (row.consentGrantedAt === null) {
        throw new TechnicalExecutionGenerationValidationError("TECHNICAL_EXECUTION_GENERATION_CANNOT_SEAL", "Cannot seal a request without affirmative consent.");
      }
      if (row.qualificationStatus !== "QUALIFIED") {
        throw new TechnicalExecutionGenerationValidationError("TECHNICAL_EXECUTION_GENERATION_CANNOT_SEAL", "Cannot seal a request whose image is not QUALIFIED.");
      }

      const updated = await tx.technicalExecutionGenerationRequest.update({
        where: { id: row.id },
        data: { sealedAt: new Date() },
      });
      return toRecord(updated);
    }),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Owner-scoped lookup. Returns null when the request does not exist or
// is not owned by this user -- a not-found read is never an error.
export async function findTechnicalExecutionGenerationRequestForOwner(
  ownerUserId: string,
  requestId: string,
): Promise<TechnicalExecutionGenerationRequestRecord | null> {
  return runTechnicalExecutionGenerationQuery(async () => {
    const row = await prisma.technicalExecutionGenerationRequest.findFirst({ where: { id: requestId, ownerUserId } });
    return row ? toRecord(row) : null;
  });
}

// The one function the future Provider Adapter invocation path relies
// on: fetches the request plus its bound Capture Set/Capture Set Image
// FRESH (never cached, never assumed), by their frozen ids, regardless
// of whether the Capture Set has since been superseded -- a sealed
// request remains a valid historical READY/BLOCKED determination even
// after the client's own current Capture Set has moved on. Never calls a
// provider; never mutates anything.
export async function getTechnicalExecutionGenerationReadiness(ownerUserId: string, requestId: string): Promise<TechnicalExecutionGenerationReadinessResult> {
  return runTechnicalExecutionGenerationQuery(async () => {
    const row = await prisma.technicalExecutionGenerationRequest.findFirst({ where: { id: requestId, ownerUserId } });
    if (!row) return { status: "BLOCKED", reason: "request not found" };

    const captureSet = await prisma.captureSet.findFirst({
      where: { id: row.captureSetId, ownerUserId: row.ownerUserId, clientId: row.clientId },
      select: { id: true, ownerUserId: true, clientId: true },
    });
    const captureSetImage = await prisma.captureSetImage.findFirst({
      where: { id: row.captureSetImageId, ownerUserId: row.ownerUserId, clientId: row.clientId },
      select: { id: true, captureSetId: true, ownerUserId: true, clientId: true, imageAssetId: true, viewLabel: true },
    });

    return evaluateTechnicalExecutionGenerationReadiness(
      {
        ownerUserId: row.ownerUserId,
        clientId: row.clientId,
        purpose: row.purpose,
        captureSetId: row.captureSetId,
        captureSetImageId: row.captureSetImageId,
        imageAssetId: row.imageAssetId,
        consentGrantedAt: row.consentGrantedAt ? row.consentGrantedAt.toISOString() : null,
        qualificationStatus: row.qualificationStatus,
        sealedAt: row.sealedAt ? row.sealedAt.toISOString() : null,
      },
      captureSet,
      captureSetImage,
    );
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function runTechnicalExecutionGenerationQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new TechnicalExecutionGenerationPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof TechnicalExecutionGenerationPersistenceError ||
      error instanceof TechnicalExecutionGenerationDependencyError ||
      error instanceof TechnicalExecutionGenerationValidationError ||
      error instanceof TechnicalExecutionGenerationSealedError
    ) {
      throw error;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new TechnicalExecutionGenerationDependencyError("TECHNICAL_EXECUTION_GENERATION_CAPTURE_SET_IMAGE_NOT_FOUND", 404, "Technical Execution Generation dependencies changed.");
    }
    throw new TechnicalExecutionGenerationPersistenceError();
  }
}

async function runSerializableTransaction<T>(operation: (tx: TechnicalExecutionGenerationTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableConcurrencyError(error)) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
    }
  }

  throw new TechnicalExecutionGenerationPersistenceError();
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (
    error instanceof TechnicalExecutionGenerationPersistenceError ||
    error instanceof TechnicalExecutionGenerationDependencyError ||
    error instanceof TechnicalExecutionGenerationValidationError ||
    error instanceof TechnicalExecutionGenerationSealedError
  ) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("deadlock") || message.includes("serialization");
}

function toRecord(row: PrismaRequestRow): TechnicalExecutionGenerationRequestRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    purpose: row.purpose,
    captureSetId: row.captureSetId,
    captureSetImageId: row.captureSetImageId,
    imageAssetId: row.imageAssetId,
    consentGrantedAt: row.consentGrantedAt ? row.consentGrantedAt.toISOString() : null,
    consentVersion: row.consentVersion,
    qualificationStatus: row.qualificationStatus,
    qualificationEvidenceSource: row.qualificationEvidenceSource,
    qualificationReason: row.qualificationReason,
    qualifiedAt: row.qualifiedAt ? row.qualifiedAt.toISOString() : null,
    sealedAt: row.sealedAt ? row.sealedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type { TechnicalExecutionGenerationPurpose };
