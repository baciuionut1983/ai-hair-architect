import {
  createLegacyLocalReferenceResolver,
  createObjectBackedReferenceResolver,
} from "./backup-m15-v2-reference-resolvers";
import {
  verifyBackupM15V2ExternalReferences,
  type BackupM15V2LegacyLocalReferenceResolver,
  type BackupM15V2ObjectBackedReferenceResolver,
} from "./backup-m15-v2-external-reference-verifier";
import {
  buildBackupM15V2RestorePreview,
  type BackupM15V2RestorePreviewCurrentState,
  type BackupM15V2RestorePreviewResult,
} from "./backup-m15-v2-restore-preview";
import { createObjectStorageAliasResolver } from "./object-storage-alias-resolver";
import { isDatabaseConfigured, prisma } from "./prisma";

export type BackupM15V2RestorePreviewRuntimeErrorCode =
  | "BACKUP_PREVIEW_UNAVAILABLE"
  | "BACKUP_NOT_FOUND"
  | "BACKUP_PREVIEW_UNINTERPRETABLE";

export class BackupM15V2RestorePreviewRuntimeError extends Error {
  readonly code: BackupM15V2RestorePreviewRuntimeErrorCode;
  readonly httpStatus: number;

  constructor(code: BackupM15V2RestorePreviewRuntimeErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "BackupM15V2RestorePreviewRuntimeError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface SnapshotRow {
  id: string;
  ownerUserId: string;
  checksum: string | null;
  schemaVersion: string;
  snapshotJson: unknown;
}

interface RuntimeDelegate<T> {
  findMany(args: unknown): Promise<T[]>;
}

export interface RuntimeTransaction {
  opsBackupSnapshot: {
    findFirst(args: unknown): Promise<SnapshotRow | null>;
  };
  client: RuntimeDelegate<Record<string, unknown>>;
  analysis: RuntimeDelegate<Record<string, unknown>>;
  consultation: RuntimeDelegate<Record<string, unknown>>;
  imageAsset: RuntimeDelegate<Record<string, unknown>>;
  imageAnalysis: RuntimeDelegate<Record<string, unknown>>;
  imageAnalysisReview: RuntimeDelegate<Record<string, unknown>>;
}

export interface RuntimePrismaClient extends RuntimeTransaction {
  $transaction<T>(
    callback: (transaction: RuntimeTransaction) => Promise<T>,
    options?: { isolationLevel?: "RepeatableRead" },
  ): Promise<T>;
}

export interface BackupM15V2RestorePreviewRuntimeDependencies {
  database?: RuntimePrismaClient;
  isDatabaseConfigured?: () => boolean;
  buildPreview?: typeof buildBackupM15V2RestorePreview;
  verifyExternalReferences?: typeof verifyBackupM15V2ExternalReferences;
  createLegacyLocalResolver?: () => BackupM15V2LegacyLocalReferenceResolver;
  createObjectBackedResolver?: () => BackupM15V2ObjectBackedReferenceResolver;
  // Required, not defaulted: every temporal value in this module (previewedAt, and any
  // downstream staleness comparison) must come from this single injected clock seam.
  now: () => Date;
  maxStreamBytes?: number;
}

export async function getBackupM15V2RestorePreviewForUser(
  ownerUserId: string,
  backupId: string,
  dependencies: BackupM15V2RestorePreviewRuntimeDependencies,
): Promise<BackupM15V2RestorePreviewResult> {
  const databaseConfigured = dependencies.isDatabaseConfigured ?? isDatabaseConfigured;
  if (!databaseConfigured()) {
    throw runtimeError("BACKUP_PREVIEW_UNAVAILABLE", 500, "Backup restore preview requires a configured database.");
  }

  const database = dependencies.database ?? (prisma as unknown as RuntimePrismaClient);
  const initialSnapshot = await findSnapshot(database, ownerUserId, backupId);
  if (!initialSnapshot) {
    throw runtimeError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found.");
  }
  assertM15V2Snapshot(initialSnapshot);

  const previewedAt = dependencies.now().toISOString();

  const currentState = await loadCurrentState(database, ownerUserId, backupId, initialSnapshot);

  const legacyLocalResolver = (dependencies.createLegacyLocalResolver ?? createLegacyLocalReferenceResolver)();
  const objectBackedResolver =
    (dependencies.createObjectBackedResolver ?? defaultCreateObjectBackedResolver)();

  const buildPreview = dependencies.buildPreview ?? buildBackupM15V2RestorePreview;
  return buildPreview({
    artifact: initialSnapshot.snapshotJson,
    backupId,
    ownerUserId,
    currentState,
    previewedAt,
    legacyLocalResolver,
    objectBackedResolver,
    verifyExternalReferences: dependencies.verifyExternalReferences ?? verifyBackupM15V2ExternalReferences,
    ...(dependencies.maxStreamBytes === undefined ? {} : { maxStreamBytes: dependencies.maxStreamBytes }),
  });
}

function defaultCreateObjectBackedResolver(): BackupM15V2ObjectBackedReferenceResolver {
  return createObjectBackedReferenceResolver({ resolveObjectStorage: createObjectStorageAliasResolver() });
}

async function findSnapshot(
  database: RuntimeTransaction,
  ownerUserId: string,
  backupId: string,
): Promise<SnapshotRow | null> {
  return database.opsBackupSnapshot.findFirst({
    where: { id: backupId, ownerUserId },
    select: { id: true, ownerUserId: true, checksum: true, schemaVersion: true, snapshotJson: true },
  });
}

function assertM15V2Snapshot(snapshot: SnapshotRow): void {
  if (
    snapshot.schemaVersion !== "m15.v2" ||
    readSchemaVersion(snapshot.snapshotJson) !== "m15.v2" ||
    typeof snapshot.checksum !== "string" ||
    !snapshot.checksum
  ) {
    throw runtimeError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
  }
}

async function loadCurrentState(
  database: RuntimePrismaClient,
  ownerUserId: string,
  backupId: string,
  initialSnapshot: SnapshotRow,
): Promise<BackupM15V2RestorePreviewCurrentState> {
  return database.$transaction(
    async (transaction) => {
      const snapshot = await findSnapshot(transaction, ownerUserId, backupId);
      if (!snapshot) {
        throw runtimeError("BACKUP_NOT_FOUND", 404, "Backup snapshot not found.");
      }
      assertM15V2Snapshot(snapshot);
      if (snapshot.checksum !== initialSnapshot.checksum) {
        throw runtimeError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
      }

      const [clients, analyses, consultations, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
        transaction.client.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        transaction.analysis.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        transaction.consultation.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        transaction.imageAsset.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
        transaction.imageAnalysis.findMany({ where: { asset: { ownerUserId } }, orderBy: { id: "asc" } }),
        transaction.imageAnalysisReview.findMany({
          where: { analysis: { asset: { ownerUserId } } },
          orderBy: { id: "asc" },
        }),
      ]);

      return {
        clients: sortAndMap(clients, mapClient),
        analyses: sortAndMap(analyses, mapAnalysis),
        consultations: sortAndMap(consultations, mapConsultation),
        imageAssets: sortAndMap(imageAssets, mapImageAssetRow),
        imageAnalyses: sortAndMap(imageAnalyses, mapImageAnalysis),
        imageAnalysisReviews: sortAndMap(imageAnalysisReviews, mapImageAnalysisReview),
      } as BackupM15V2RestorePreviewCurrentState;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

function sortAndMap<T>(rows: Record<string, unknown>[], mapper: (row: Record<string, unknown>) => T): T[] {
  return [...rows].sort((left, right) => compareLexical(requireString(left.id), requireString(right.id))).map(mapper);
}

function compareLexical(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function mapClient(row: Record<string, unknown>) {
  return {
    id: requireString(row.id),
    fullName: requireString(row.fullName),
    email: nullableString(row.email),
    phone: nullableString(row.phone),
    notes: nullableString(row.notes),
    deletedAt: nullableTimestamp(row.deletedAt),
    ownerUserId: requireString(row.ownerUserId),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  };
}

function mapAnalysis(row: Record<string, unknown>) {
  return {
    id: requireString(row.id),
    clientId: requireString(row.clientId),
    ownerUserId: requireString(row.ownerUserId),
    goal: requireString(row.goal),
    hairType: requireString(row.hairType),
    density: requireString(row.density),
    porosity: requireString(row.porosity),
    phase: requireString(row.phase),
    clarificationRound: requireNumber(row.clarificationRound),
    confidenceScore: requireNumber(row.confidenceScore),
    uncertaintyReasons: requireJson(row.uncertaintyReasons),
    followUpQuestions: requireJson(row.followUpQuestions),
    recommendations: requireJson(row.recommendations),
    safetyNotes: requireJson(row.safetyNotes),
    faceShape: nullableString(row.faceShape),
    headShape: nullableString(row.headShape),
    hairLength: nullableString(row.hairLength),
    hairTexture: nullableString(row.hairTexture),
    hairCondition: nullableString(row.hairCondition),
    growthPattern: nullableString(row.growthPattern),
    targetShape: nullableString(row.targetShape),
    technicalCutPlan: requireJson(row.technicalCutPlan ?? {}),
    clarificationAnswers: requireJson(row.clarificationAnswers),
    imageAssetId: nullableString(row.imageAssetId),
    imageAnalysisId: nullableString(row.imageAnalysisId),
    m8DraftCreatedAt: nullableTimestamp(row.m8DraftCreatedAt),
    m8FinalizedAt: nullableTimestamp(row.m8FinalizedAt),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  };
}

function mapConsultation(row: Record<string, unknown>) {
  return {
    id: requireString(row.id),
    ownerUserId: requireString(row.ownerUserId),
    clientId: requireString(row.clientId),
    analysisId: requireString(row.analysisId),
    summary: requireString(row.summary),
    nextSteps: requireStringArray(row.nextSteps),
    createdAt: timestamp(row.createdAt),
  };
}

const VALID_OBJECT_STORAGE_STATES = new Set(["available", "delete_pending"]);

function mapImageAssetRow(row: Record<string, unknown>) {
  const common = {
    id: requireString(row.id),
    fileName: requireString(row.fileName),
    mimeType: requireString(row.mimeType),
    sizeBytes: requireNumber(row.sizeBytes),
    ownerUserId: requireString(row.ownerUserId),
    clientId: requireString(row.clientId),
    exifStripped: requireBoolean(row.exifStripped),
    normalizedOrientation: requireNumber(row.normalizedOrientation),
    uploadedAt: timestamp(row.uploadedAt),
    deletedAt: nullableTimestamp(row.deletedAt),
    retentionDeletesAt: nullableTimestamp(row.retentionDeletesAt),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  };

  const backend = row.storageBackend;
  const objectFieldsPresent = [
    row.storageBucketAlias,
    row.storageKey,
    row.storageVersionId,
    row.storageEtag,
    row.storageState,
    row.storageMigratedAt,
    row.objectDeletedAt,
    row.lastStorageErrorCode,
  ].some((value) => value !== null && value !== undefined);

  if (backend === null || backend === undefined) {
    if (objectFieldsPresent) throw invalidImageAssetState();
    if (typeof row.contentSha256 !== "string" || !row.contentSha256) throw invalidImageAssetState();
    return {
      ...common,
      storageKind: "legacy-local" as const,
      legacyReference: {
        backend: "local" as const,
        rootAlias: "legacy-images" as const,
        relativePath: `${common.ownerUserId}/${common.id}/${common.fileName}`,
        contentSha256: row.contentSha256,
        sizeBytes: common.sizeBytes,
      },
    };
  }

  if (backend === "s3") {
    if (
      typeof row.storageBucketAlias !== "string" || !row.storageBucketAlias ||
      typeof row.storageKey !== "string" || !row.storageKey ||
      typeof row.storageVersionId !== "string" || !row.storageVersionId ||
      typeof row.contentSha256 !== "string" || !row.contentSha256 ||
      typeof row.storageState !== "string" || !VALID_OBJECT_STORAGE_STATES.has(row.storageState) ||
      row.objectDeletedAt !== null && row.objectDeletedAt !== undefined
    ) {
      throw invalidImageAssetState();
    }
    if (row.storageState === "available" && (common.deletedAt !== null || common.retentionDeletesAt !== null)) {
      throw invalidImageAssetState();
    }
    if (row.storageState === "delete_pending" && (common.deletedAt === null || common.retentionDeletesAt === null)) {
      throw invalidImageAssetState();
    }
    return {
      ...common,
      storageKind: "object-backed" as const,
      objectReference: {
        backend: "s3" as const,
        bucketAlias: row.storageBucketAlias,
        key: row.storageKey,
        versionId: row.storageVersionId,
        contentSha256: row.contentSha256,
        sizeBytes: common.sizeBytes,
      },
      storageEtag: nullableString(row.storageEtag),
      storageState: row.storageState as "available" | "delete_pending",
      storageMigratedAt: nullableTimestamp(row.storageMigratedAt),
      objectDeletedAt: null,
      lastStorageErrorCode: nullableString(row.lastStorageErrorCode),
    };
  }

  throw invalidImageAssetState();
}

function mapImageAnalysis(row: Record<string, unknown>) {
  return {
    id: requireString(row.id),
    assetId: requireString(row.assetId),
    status: requireString(row.status),
    providerName: requireString(row.providerName),
    modelVersion: requireString(row.modelVersion),
    analysisPayload: requireJson(row.analysisPayload),
    confidences: requireJson(row.confidences),
    unknownFields: requireJson(row.unknownFields),
    warnings: requireJson(row.warnings),
    limitations: requireJson(row.limitations),
    consentTimestamp: timestamp(row.consentTimestamp),
    deletedAt: nullableTimestamp(row.deletedAt),
    retentionDeletesAt: nullableTimestamp(row.retentionDeletesAt),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  };
}

function mapImageAnalysisReview(row: Record<string, unknown>) {
  return {
    id: requireString(row.id),
    analysisId: requireString(row.analysisId),
    reviewedByUserId: requireString(row.reviewedByUserId),
    manualCorrections: requireJson(row.manualCorrections),
    confirmationTimestamp: nullableTimestamp(row.confirmationTimestamp),
    notes: nullableString(row.notes),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  };
}

function readSchemaVersion(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion : null;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw invalidRowState();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidRowState();
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidRowState();
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw invalidRowState();
  return [...value];
}

function requireJson(value: unknown): unknown {
  if (value === undefined) throw invalidRowState();
  return value;
}

function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw invalidRowState();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function invalidRowState(): BackupM15V2RestorePreviewRuntimeError {
  return runtimeError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
}

function invalidImageAssetState(): BackupM15V2RestorePreviewRuntimeError {
  return runtimeError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Backup snapshot cannot be interpreted for restore planning.");
}

function runtimeError(
  code: BackupM15V2RestorePreviewRuntimeErrorCode,
  httpStatus: number,
  message: string,
): BackupM15V2RestorePreviewRuntimeError {
  return new BackupM15V2RestorePreviewRuntimeError(code, httpStatus, message);
}
