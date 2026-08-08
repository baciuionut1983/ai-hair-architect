import {
  buildBackupM15V2Artifact,
  M15_V2_MAX_ARTIFACT_BYTES,
  M15_V2_MAX_ROWS_PER_SECTION,
  M15_V2_MAX_SECTION_BYTES,
  parseBackupM15V2Artifact,
  type BackupM15V2ArtifactInput,
} from "./backup-m15-v2-artifact";
import {
  verifyBackupM15V2ExternalReferences,
  type BackupM15V2ExternalReferenceVerificationResult,
  type BackupM15V2LegacyLocalReferenceResolver,
  type BackupM15V2ObjectBackedReferenceResolver,
} from "./backup-m15-v2-external-reference-verifier";

const SECTION_NAMES = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
] as const;

type SectionName = (typeof SECTION_NAMES)[number];

export type BackupM15V2SnapshotPersistenceErrorCode =
  | "ROW_LIMIT_EXCEEDED"
  | "IMAGE_ASSET_INVALID"
  | "ARTIFACT_CONSTRUCTION_FAILED"
  | "PERSISTENCE_FAILED"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_SCHEMA_UNSUPPORTED"
  | "SNAPSHOT_PAYLOAD_INVALID"
  | "SNAPSHOT_IDENTITY_MISMATCH"
  | "SNAPSHOT_CHECKSUM_MISMATCH";

const SAFE_MESSAGES: Record<BackupM15V2SnapshotPersistenceErrorCode, string> = {
  ROW_LIMIT_EXCEEDED: "The current state exceeds an approved row limit for m15.v2 snapshot creation.",
  IMAGE_ASSET_INVALID: "An image asset row is not a valid m15.v2 legacy-local or object-backed state.",
  ARTIFACT_CONSTRUCTION_FAILED: "The m15.v2 artifact could not be constructed from the current state.",
  PERSISTENCE_FAILED: "The m15.v2 snapshot could not be persisted.",
  SNAPSHOT_NOT_FOUND: "Backup snapshot not found.",
  SNAPSHOT_SCHEMA_UNSUPPORTED: "The stored snapshot is not an m15.v2 snapshot.",
  SNAPSHOT_PAYLOAD_INVALID: "The stored snapshot payload is not a valid m15.v2 artifact.",
  SNAPSHOT_IDENTITY_MISMATCH: "The stored artifact identity does not match the snapshot row.",
  SNAPSHOT_CHECKSUM_MISMATCH: "The stored checksum does not match the persisted artifact.",
};

export class BackupM15V2SnapshotPersistenceError extends Error {
  readonly code: BackupM15V2SnapshotPersistenceErrorCode;

  constructor(code: BackupM15V2SnapshotPersistenceErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "BackupM15V2SnapshotPersistenceError";
    this.code = code;
  }
}

function persistenceError(code: BackupM15V2SnapshotPersistenceErrorCode): BackupM15V2SnapshotPersistenceError {
  return new BackupM15V2SnapshotPersistenceError(code);
}

export interface PersistedBackupM15V2SnapshotRow {
  readonly id: string;
  readonly ownerUserId: string;
  readonly createdByUserId: string;
  readonly label: string;
  readonly snapshotJson: unknown;
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly schemaVersion: string;
  readonly createdAt: Date | string;
}

interface CountableDelegate {
  count(args: unknown): Promise<number>;
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
}

interface CountOnlyDelegate {
  count(args: unknown): Promise<number>;
}

interface SnapshotDelegate {
  findFirst(args: unknown): Promise<PersistedBackupM15V2SnapshotRow | null>;
  create(args: unknown): Promise<PersistedBackupM15V2SnapshotRow>;
}

export interface BackupM15V2SnapshotPersistenceTransaction {
  opsBackupSnapshot: SnapshotDelegate;
  client: CountableDelegate;
  analysis: CountableDelegate;
  consultation: CountableDelegate;
  imageAsset: CountableDelegate;
  imageAnalysis: CountableDelegate;
  imageAnalysisReview: CountableDelegate;
  // Summary-only counts, mirroring the m13.v3 creator: appointments and
  // notifications are reported in summarySnapshot but are not (and have
  // never been) backed up as restorable sections.
  appointment: CountOnlyDelegate;
  notification: CountOnlyDelegate;
}

export interface BackupM15V2SnapshotPersistenceDatabase extends BackupM15V2SnapshotPersistenceTransaction {
  $transaction<T>(
    callback: (transaction: BackupM15V2SnapshotPersistenceTransaction) => Promise<T>,
    options?: { isolationLevel?: "RepeatableRead" },
  ): Promise<T>;
}

export interface BackupM15V2SnapshotSummary {
  readonly clientsCount: number;
  readonly consultationsCount: number;
  readonly appointmentsCount: number;
  readonly notificationsCount: number;
  readonly workspacesCount: number;
}

export interface BackupM15V2SnapshotRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly createdByUserId: string;
  readonly label: string;
  readonly schemaVersion: "m15.v2";
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly createdAt: string;
  readonly snapshot: BackupM15V2SnapshotSummary;
}

export interface CreateBackupM15V2SnapshotInput {
  readonly ownerUserId: string;
  readonly createdByUserId: string;
  readonly label: string;
  readonly database: BackupM15V2SnapshotPersistenceDatabase;
  // Required, not defaulted: the snapshot identity and creation instant are the only
  // non-deterministic values this module needs, and both are injected explicitly.
  readonly generateId: () => string;
  readonly now: () => Date;
}

export async function createBackupM15V2Snapshot(
  input: CreateBackupM15V2SnapshotInput,
): Promise<BackupM15V2SnapshotRecord> {
  const backupId = input.generateId();
  const createdAt = input.now().toISOString();

  return input.database.$transaction(
    async (transaction) => {
      const counts = await countSections(transaction, input.ownerUserId);
      assertRowLimits(counts);

      const [appointmentsCount, notificationsCount] = await Promise.all([
        transaction.appointment.count({ where: { ownerUserId: input.ownerUserId } }),
        transaction.notification.count({ where: { ownerUserId: input.ownerUserId } }),
      ]);

      const sections = await fetchSections(transaction, input.ownerUserId);

      const summarySnapshot: BackupM15V2SnapshotSummary = {
        clientsCount: counts.clients,
        consultationsCount: counts.consultations,
        appointmentsCount,
        notificationsCount,
        // Workspaces have no Postgres persistence (in-memory only, see M32/M33
        // audits): this matches the m13.v3 creator's own established behavior
        // exactly, not a gap introduced here. Computing a real count would
        // require reaching into the in-memory store from this otherwise pure,
        // Postgres-transaction-scoped module.
        workspacesCount: 0,
      };

      const artifactInput: BackupM15V2ArtifactInput = {
        schemaVersion: "m15.v2",
        canonicalSerializationVersion: "sorted-json-v2",
        checksumAlgorithm: "sha256",
        checksum: null,
        backupId,
        ownerUserId: input.ownerUserId,
        createdByUserId: input.createdByUserId,
        label: input.label,
        createdAt,
        summarySnapshot,
        counts,
        limits: {
          maxArtifactBytes: M15_V2_MAX_ARTIFACT_BYTES,
          maxSectionBytes: M15_V2_MAX_SECTION_BYTES,
          maxRowsPerSection: { ...M15_V2_MAX_ROWS_PER_SECTION },
        },
        sections,
      } as unknown as BackupM15V2ArtifactInput;

      let artifact;
      try {
        artifact = buildBackupM15V2Artifact(artifactInput);
      } catch {
        throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
      }

      let row: PersistedBackupM15V2SnapshotRow;
      try {
        row = await transaction.opsBackupSnapshot.create({
          data: {
            id: artifact.backupId,
            ownerUserId: artifact.ownerUserId,
            createdByUserId: artifact.createdByUserId,
            label: artifact.label,
            snapshotJson: artifact,
            checksum: artifact.checksum,
            checksumAlgorithm: artifact.checksumAlgorithm,
            schemaVersion: artifact.schemaVersion,
          },
        });
      } catch (error) {
        if (error instanceof BackupM15V2SnapshotPersistenceError) throw error;
        throw persistenceError("PERSISTENCE_FAILED");
      }

      return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        createdByUserId: row.createdByUserId,
        label: row.label,
        schemaVersion: "m15.v2",
        checksum: row.checksum,
        checksumAlgorithm: row.checksumAlgorithm,
        createdAt: normalizeTimestamp(row.createdAt),
        snapshot: summarySnapshot,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export interface VerifyBackupM15V2SnapshotInput {
  readonly ownerUserId: string;
  readonly backupId: string;
  readonly database: BackupM15V2SnapshotPersistenceDatabase;
  readonly verifiedAt: string;
  readonly legacyLocalResolver: BackupM15V2LegacyLocalReferenceResolver;
  readonly objectBackedResolver: BackupM15V2ObjectBackedReferenceResolver;
  readonly maxStreamBytes?: number;
}

export async function verifyBackupM15V2Snapshot(
  input: VerifyBackupM15V2SnapshotInput,
): Promise<BackupM15V2ExternalReferenceVerificationResult> {
  // Owner-scoped by construction: a row belonging to another owner never matches this
  // query, so it is indistinguishable from a genuinely absent snapshot.
  const row = await input.database.opsBackupSnapshot.findFirst({
    where: { id: input.backupId, ownerUserId: input.ownerUserId },
  });
  if (!row) throw persistenceError("SNAPSHOT_NOT_FOUND");
  if (row.schemaVersion !== "m15.v2") throw persistenceError("SNAPSHOT_SCHEMA_UNSUPPORTED");

  let artifact;
  try {
    artifact = parseBackupM15V2Artifact(row.snapshotJson);
  } catch {
    throw persistenceError("SNAPSHOT_PAYLOAD_INVALID");
  }

  if (artifact.backupId !== row.id || artifact.ownerUserId !== input.ownerUserId) {
    throw persistenceError("SNAPSHOT_IDENTITY_MISMATCH");
  }
  if (
    typeof row.checksum !== "string" ||
    row.checksum !== artifact.checksum ||
    typeof row.checksumAlgorithm !== "string" ||
    row.checksumAlgorithm !== artifact.checksumAlgorithm
  ) {
    throw persistenceError("SNAPSHOT_CHECKSUM_MISMATCH");
  }

  return verifyBackupM15V2ExternalReferences({
    artifact,
    verifiedAt: input.verifiedAt,
    legacyLocalResolver: input.legacyLocalResolver,
    objectBackedResolver: input.objectBackedResolver,
    ...(input.maxStreamBytes === undefined ? {} : { maxStreamBytes: input.maxStreamBytes }),
  });
}

async function countSections(
  transaction: BackupM15V2SnapshotPersistenceTransaction,
  ownerUserId: string,
): Promise<Record<SectionName, number>> {
  const [clients, analyses, consultations, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
    transaction.client.count({ where: { ownerUserId } }),
    transaction.analysis.count({ where: { ownerUserId } }),
    transaction.consultation.count({ where: { ownerUserId } }),
    transaction.imageAsset.count({ where: { ownerUserId } }),
    transaction.imageAnalysis.count({ where: { asset: { ownerUserId } } }),
    transaction.imageAnalysisReview.count({ where: { analysis: { asset: { ownerUserId } } } }),
  ]);
  return { clients, analyses, consultations, imageAssets, imageAnalyses, imageAnalysisReviews };
}

function assertRowLimits(counts: Record<SectionName, number>): void {
  for (const section of SECTION_NAMES) {
    if (counts[section] > M15_V2_MAX_ROWS_PER_SECTION[section]) throw persistenceError("ROW_LIMIT_EXCEEDED");
  }
}

async function fetchSections(
  transaction: BackupM15V2SnapshotPersistenceTransaction,
  ownerUserId: string,
): Promise<BackupM15V2ArtifactInput["sections"]> {
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
  } as unknown as BackupM15V2ArtifactInput["sections"];
}

function sortAndMap<T>(rows: Array<Record<string, unknown>>, mapper: (row: Record<string, unknown>) => T): T[] {
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
    if (objectFieldsPresent) throw persistenceError("IMAGE_ASSET_INVALID");
    if (typeof row.contentSha256 !== "string" || !row.contentSha256) throw persistenceError("IMAGE_ASSET_INVALID");
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
      (row.objectDeletedAt !== null && row.objectDeletedAt !== undefined)
    ) {
      throw persistenceError("IMAGE_ASSET_INVALID");
    }
    if (row.storageState === "available" && (common.deletedAt !== null || common.retentionDeletesAt !== null)) {
      throw persistenceError("IMAGE_ASSET_INVALID");
    }
    if (row.storageState === "delete_pending" && (common.deletedAt === null || common.retentionDeletesAt === null)) {
      throw persistenceError("IMAGE_ASSET_INVALID");
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

  throw persistenceError("IMAGE_ASSET_INVALID");
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

function requireString(value: unknown): string {
  if (typeof value !== "string") throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
  }
  return [...value];
}

function requireJson(value: unknown): unknown {
  if (value === undefined) throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
  return value;
}

function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw persistenceError("ARTIFACT_CONSTRUCTION_FAILED");
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}
