import {
  canonicalizeM15V2,
  parseBackupM15V2Artifact,
  type BackupM15V2ArtifactInput,
} from "./backup-m15-v2-artifact";
import { verifyBackupM15V2ExternalReferences } from "./backup-m15-v2-external-reference-verifier";
import type {
  BackupM15V2LegacyLocalReferenceResolver,
  BackupM15V2ObjectBackedReferenceResolver,
} from "./backup-m15-v2-external-reference-verifier";
import { getStoragePath } from "./image-storage";
import { buildBackupM15V2RestorePreview } from "./backup-m15-v2-restore-preview";

const MAX_RESTORE_ATTEMPTS = 3;

const SECTION_NAMES = [
  "clients",
  "analyses",
  "consultations",
  "imageAssets",
  "imageAnalyses",
  "imageAnalysisReviews",
] as const;

type SectionName = (typeof SECTION_NAMES)[number];

// Derived structurally from the WP2H1 parser's return type so this module never imports
// from ./contracts and never re-declares the m15.v2 schema.
type BackupM15V2ArtifactShape = ReturnType<typeof parseBackupM15V2Artifact>;
type BackupM15V2SectionsShape = BackupM15V2ArtifactShape["sections"];

export type BackupM15V2RestoreExecutionErrorCode =
  | "REQUEST_INVALID"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_SCHEMA_UNSUPPORTED"
  | "SNAPSHOT_PAYLOAD_INVALID"
  | "SNAPSHOT_IDENTITY_MISMATCH"
  | "SNAPSHOT_CHECKSUM_MISMATCH"
  | "PRECHECK_FAILED"
  | "RESTORE_BLOCKED_BY_PREVIEW"
  | "PREVIEW_FINGERPRINT_STALE"
  | "SAFETY_BACKUP_REQUIRED"
  | "SAFETY_BACKUP_INVALID"
  | "SAFETY_BACKUP_STATE_MISMATCH"
  | "CURRENT_STATE_CHANGED"
  | "OWNER_COLLISION"
  | "POSTCONDITION_FAILED"
  | "CONCURRENCY_CONFLICT";

const SAFE_MESSAGES: Record<BackupM15V2RestoreExecutionErrorCode, string> = {
  REQUEST_INVALID: "The restore request is not valid.",
  SNAPSHOT_NOT_FOUND: "Backup snapshot not found.",
  SNAPSHOT_SCHEMA_UNSUPPORTED: "The stored snapshot is not an m15.v2 snapshot.",
  SNAPSHOT_PAYLOAD_INVALID: "The stored snapshot payload is not a valid m15.v2 artifact.",
  SNAPSHOT_IDENTITY_MISMATCH: "The stored artifact identity does not match the snapshot row.",
  SNAPSHOT_CHECKSUM_MISMATCH: "The stored checksum does not match the persisted artifact.",
  PRECHECK_FAILED: "Restore preview validation did not succeed.",
  RESTORE_BLOCKED_BY_PREVIEW: "Backup restore is blocked by preview validation.",
  PREVIEW_FINGERPRINT_STALE: "Preview fingerprint no longer matches current restore conditions.",
  SAFETY_BACKUP_REQUIRED: "A valid m15.v2 safety backup is required before this restore may proceed.",
  SAFETY_BACKUP_INVALID: "The supplied safety backup is not a valid, eligible m15.v2 snapshot.",
  SAFETY_BACKUP_STATE_MISMATCH: "The safety backup does not match the state about to be restored over.",
  CURRENT_STATE_CHANGED: "Current state changed since the restore was previewed.",
  OWNER_COLLISION: "Restore encountered a cross-owner identity collision.",
  POSTCONDITION_FAILED: "Backup restore postcondition failed.",
  CONCURRENCY_CONFLICT: "Backup restore could not complete due to concurrent changes.",
};

export class BackupM15V2RestoreExecutionError extends Error {
  readonly code: BackupM15V2RestoreExecutionErrorCode;

  constructor(code: BackupM15V2RestoreExecutionErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "BackupM15V2RestoreExecutionError";
    this.code = code;
  }
}

function fail(code: BackupM15V2RestoreExecutionErrorCode): never {
  throw new BackupM15V2RestoreExecutionError(code);
}

interface PersistedSnapshotRow {
  id: string;
  ownerUserId: string;
  checksum: string | null;
  checksumAlgorithm: string | null;
  schemaVersion: string;
  snapshotJson: unknown;
  createdAt: Date | string;
}

interface RestoreDelegate {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  create(args: unknown): Promise<unknown>;
}

interface SnapshotDelegate {
  findFirst(args: unknown): Promise<PersistedSnapshotRow | null>;
}

export interface BackupM15V2RestoreExecutionTransaction {
  opsBackupSnapshot: SnapshotDelegate;
  client: RestoreDelegate;
  analysis: RestoreDelegate;
  consultation: RestoreDelegate;
  imageAsset: RestoreDelegate;
  imageAnalysis: RestoreDelegate;
  imageAnalysisReview: RestoreDelegate;
}

export interface BackupM15V2RestoreExecutionDatabase extends BackupM15V2RestoreExecutionTransaction {
  $transaction<T>(
    callback: (transaction: BackupM15V2RestoreExecutionTransaction) => Promise<T>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<T>;
}

export interface RestoreBackupM15V2Request {
  readonly previewFingerprint: string;
  readonly previewedAt: string;
  readonly strategy: "replace_all";
  readonly acknowledgeDataLoss: true;
  readonly safetyBackupId: string;
}

export interface BackupM15V2RestoreExecutionInput {
  readonly ownerUserId: string;
  readonly backupId: string;
  readonly request: unknown;
  readonly database: BackupM15V2RestoreExecutionDatabase;
  readonly legacyLocalResolver: BackupM15V2LegacyLocalReferenceResolver;
  readonly objectBackedResolver: BackupM15V2ObjectBackedReferenceResolver;
  // Required, not defaulted: every temporal value this module needs (the precheck's
  // verifiedAt/previewedAt and the result's startedAt/finishedAt) comes from this one
  // injected clock seam.
  readonly now: () => Date;
  readonly maxStreamBytes?: number;
}

export interface BackupM15V2RestoreExecutionResult {
  readonly backupId: string;
  readonly ownerUserId: string;
  readonly status: "completed";
  readonly strategy: "replace_all";
  readonly deletedCounts: Readonly<Record<SectionName, number>>;
  readonly restoredCounts: Readonly<Record<SectionName, number>>;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly attemptsUsed: number;
}

export async function executeBackupM15V2RestoreForUser(
  input: BackupM15V2RestoreExecutionInput,
): Promise<BackupM15V2RestoreExecutionResult> {
  const startedAt = input.now().toISOString();
  const request = validateRequest(input.request);

  // --- Phase 1 (outside any transaction; the only phase that performs real I/O) ---
  // Read the snapshot, parse it, fetch current state once, and run the full WP2H2/WP2H3
  // verification exactly once. Real filesystem/object-storage reads happen here, never
  // inside the Serializable transaction below (see WP2H7 plan §5).
  const initialSnapshot = await findSnapshot(input.database, input.ownerUserId, input.backupId);
  const artifact = assertM15V2Snapshot(initialSnapshot);
  const preCheckState = await fetchCurrentState(input.database, input.ownerUserId);

  const preview = await buildBackupM15V2RestorePreview({
    artifact,
    backupId: input.backupId,
    ownerUserId: input.ownerUserId,
    currentState: preCheckState,
    previewedAt: startedAt,
    legacyLocalResolver: input.legacyLocalResolver,
    objectBackedResolver: input.objectBackedResolver,
    verifyExternalReferences: verifyBackupM15V2ExternalReferences,
    ...(input.maxStreamBytes === undefined ? {} : { maxStreamBytes: input.maxStreamBytes }),
  });
  if (!preview.ok) fail("PRECHECK_FAILED");
  if (!preview.canRestore) fail("RESTORE_BLOCKED_BY_PREVIEW");
  if (preview.fingerprint !== request.previewFingerprint) fail("PREVIEW_FINGERPRINT_STALE");

  // --- Phase 2: the Serializable, I/O-free, retryable mutation ---
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RESTORE_ATTEMPTS; attempt += 1) {
    try {
      const outcome = await input.database.$transaction(
        async (tx) => runRestoreAttempt(tx, input.ownerUserId, input.backupId, request, artifact, preCheckState),
        { isolationLevel: "Serializable" },
      );
      const finishedAt = input.now().toISOString();
      return {
        backupId: input.backupId,
        ownerUserId: input.ownerUserId,
        status: "completed",
        strategy: "replace_all",
        deletedCounts: outcome.deletedCounts,
        restoredCounts: outcome.restoredCounts,
        startedAt,
        finishedAt,
        attemptsUsed: attempt,
      };
    } catch (error) {
      if (error instanceof BackupM15V2RestoreExecutionError) throw error;
      if (isRetryableConcurrencyError(error) && attempt < MAX_RESTORE_ATTEMPTS) {
        lastError = error;
        continue;
      }
      fail("CONCURRENCY_CONFLICT");
    }
  }
  void lastError;
  fail("CONCURRENCY_CONFLICT");
}

interface RestoreAttemptOutcome {
  deletedCounts: Readonly<Record<SectionName, number>>;
  restoredCounts: Readonly<Record<SectionName, number>>;
}

async function runRestoreAttempt(
  tx: BackupM15V2RestoreExecutionTransaction,
  ownerUserId: string,
  backupId: string,
  request: RestoreBackupM15V2Request,
  artifact: BackupM15V2ArtifactShape,
  preCheckState: BackupM15V2SectionsShape,
): Promise<RestoreAttemptOutcome> {
  const currentSnapshot = await findSnapshot(tx, ownerUserId, backupId);
  const reReadArtifact = assertM15V2Snapshot(currentSnapshot);
  if (reReadArtifact.checksum !== artifact.checksum) fail("CURRENT_STATE_CHANGED");

  const currentState = await fetchCurrentState(tx, ownerUserId);
  if (!sectionsMatchExactly(currentState, preCheckState)) fail("CURRENT_STATE_CHANGED");

  await assertSafetyBackup(tx, ownerUserId, backupId, request, currentState);
  await assertNoCrossOwnerCollisions(tx, ownerUserId, artifact.sections);

  const deletedCounts = countSections(currentState);
  await deleteOwnerScopedRows(tx, ownerUserId);
  await insertBackupRows(tx, artifact.sections);

  const restoredState = await fetchCurrentState(tx, ownerUserId);
  if (!sectionsMatchExactly(restoredState, artifact.sections)) fail("POSTCONDITION_FAILED");

  return { deletedCounts, restoredCounts: countSections(restoredState) };
}

function validateRequest(value: unknown): RestoreBackupM15V2Request {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("REQUEST_INVALID");
  const record = value as Record<string, unknown>;
  if (typeof record.previewFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(record.previewFingerprint)) {
    fail("REQUEST_INVALID");
  }
  if (typeof record.previewedAt !== "string" || !isValidTimestamp(record.previewedAt)) fail("REQUEST_INVALID");
  if (record.strategy !== "replace_all") fail("REQUEST_INVALID");
  if (record.acknowledgeDataLoss !== true) fail("REQUEST_INVALID");
  if (typeof record.safetyBackupId !== "string" || record.safetyBackupId.length === 0) fail("REQUEST_INVALID");
  return {
    previewFingerprint: record.previewFingerprint,
    previewedAt: record.previewedAt,
    strategy: "replace_all",
    acknowledgeDataLoss: true,
    safetyBackupId: record.safetyBackupId,
  };
}

async function findSnapshot(
  database: { opsBackupSnapshot: SnapshotDelegate },
  ownerUserId: string,
  backupId: string,
): Promise<PersistedSnapshotRow | null> {
  return database.opsBackupSnapshot.findFirst({
    where: { id: backupId, ownerUserId },
    select: { id: true, ownerUserId: true, checksum: true, checksumAlgorithm: true, schemaVersion: true, snapshotJson: true, createdAt: true },
  });
}

function assertM15V2Snapshot(row: PersistedSnapshotRow | null): BackupM15V2ArtifactShape {
  if (!row) fail("SNAPSHOT_NOT_FOUND");
  if (row.schemaVersion !== "m15.v2") fail("SNAPSHOT_SCHEMA_UNSUPPORTED");
  let artifact: BackupM15V2ArtifactShape;
  try {
    artifact = parseBackupM15V2Artifact(row.snapshotJson);
  } catch {
    fail("SNAPSHOT_PAYLOAD_INVALID");
  }
  if (artifact.backupId !== row.id || artifact.ownerUserId !== row.ownerUserId) fail("SNAPSHOT_IDENTITY_MISMATCH");
  if (row.checksum !== artifact.checksum || row.checksumAlgorithm !== artifact.checksumAlgorithm) {
    fail("SNAPSHOT_CHECKSUM_MISMATCH");
  }
  return artifact;
}

async function assertSafetyBackup(
  tx: BackupM15V2RestoreExecutionTransaction,
  ownerUserId: string,
  backupId: string,
  request: RestoreBackupM15V2Request,
  currentState: BackupM15V2SectionsShape,
): Promise<void> {
  if (request.safetyBackupId === backupId) fail("SAFETY_BACKUP_INVALID");

  const safetyRow = await findSnapshot(tx, ownerUserId, request.safetyBackupId);
  if (!safetyRow) fail("SAFETY_BACKUP_REQUIRED");
  if (safetyRow.schemaVersion !== "m15.v2") fail("SAFETY_BACKUP_INVALID");

  let safetyArtifact: BackupM15V2ArtifactShape;
  try {
    safetyArtifact = parseBackupM15V2Artifact(safetyRow.snapshotJson);
  } catch {
    fail("SAFETY_BACKUP_INVALID");
  }
  if (safetyArtifact.backupId !== safetyRow.id || safetyArtifact.ownerUserId !== ownerUserId) {
    fail("SAFETY_BACKUP_INVALID");
  }
  if (safetyRow.checksum !== safetyArtifact.checksum || safetyRow.checksumAlgorithm !== safetyArtifact.checksumAlgorithm) {
    fail("SAFETY_BACKUP_INVALID");
  }

  const safetyCreatedAt = normalizeTimestamp(safetyRow.createdAt);
  if (compareLexical(safetyCreatedAt, request.previewedAt) <= 0) fail("SAFETY_BACKUP_INVALID");

  if (!sectionsMatchExactly(safetyArtifact.sections, currentState)) fail("SAFETY_BACKUP_STATE_MISMATCH");
}

async function assertNoCrossOwnerCollisions(
  tx: BackupM15V2RestoreExecutionTransaction,
  ownerUserId: string,
  sections: BackupM15V2SectionsShape,
): Promise<void> {
  const checks: Array<Promise<boolean>> = [
    hasCrossOwnerRow(tx.client, sections.clients.map((row) => row.id), ownerUserId),
    hasCrossOwnerRow(tx.analysis, sections.analyses.map((row) => row.id), ownerUserId),
    hasCrossOwnerRow(tx.consultation, sections.consultations.map((row) => row.id), ownerUserId),
    hasCrossOwnerRow(tx.imageAsset, sections.imageAssets.map((row) => row.id), ownerUserId),
    hasCrossOwnerImageAnalysisRow(tx.imageAnalysis, sections.imageAnalyses.map((row) => row.id), ownerUserId),
    hasCrossOwnerImageAnalysisReviewRow(tx.imageAnalysisReview, sections.imageAnalysisReviews.map((row) => row.id), ownerUserId),
  ];
  const results = await Promise.all(checks);
  if (results.some(Boolean)) fail("OWNER_COLLISION");
}

async function hasCrossOwnerRow(delegate: RestoreDelegate, ids: string[], ownerUserId: string): Promise<boolean> {
  if (ids.length === 0) return false;
  const rows = await delegate.findMany({ where: { id: { in: ids } }, select: { id: true, ownerUserId: true } });
  return rows.some((row) => row.ownerUserId !== ownerUserId);
}

// ImageAnalysis has no direct ownerUserId column; ownership is reached via its ImageAsset.
async function hasCrossOwnerImageAnalysisRow(delegate: RestoreDelegate, ids: string[], ownerUserId: string): Promise<boolean> {
  if (ids.length === 0) return false;
  const rows = await delegate.findMany({
    where: { id: { in: ids } },
    select: { id: true, asset: { select: { ownerUserId: true } } },
  });
  return rows.some((row) => (row.asset as Record<string, unknown> | undefined)?.ownerUserId !== ownerUserId);
}

// ImageAnalysisReview has no direct ownerUserId column either; ownership is reached via
// its ImageAnalysis, then that analysis's ImageAsset.
async function hasCrossOwnerImageAnalysisReviewRow(delegate: RestoreDelegate, ids: string[], ownerUserId: string): Promise<boolean> {
  if (ids.length === 0) return false;
  const rows = await delegate.findMany({
    where: { id: { in: ids } },
    select: { id: true, analysis: { select: { asset: { select: { ownerUserId: true } } } } },
  });
  return rows.some((row) => {
    const analysis = row.analysis as Record<string, unknown> | undefined;
    const asset = analysis?.asset as Record<string, unknown> | undefined;
    return asset?.ownerUserId !== ownerUserId;
  });
}

async function deleteOwnerScopedRows(tx: BackupM15V2RestoreExecutionTransaction, ownerUserId: string): Promise<void> {
  await tx.imageAnalysisReview.deleteMany({ where: { analysis: { asset: { ownerUserId } } } });
  await tx.consultation.deleteMany({ where: { ownerUserId } });
  await tx.analysis.deleteMany({ where: { ownerUserId } });
  await tx.imageAnalysis.deleteMany({ where: { asset: { ownerUserId } } });
  await tx.imageAsset.deleteMany({ where: { ownerUserId } });
  await tx.client.deleteMany({ where: { ownerUserId } });
}

async function insertBackupRows(tx: BackupM15V2RestoreExecutionTransaction, sections: BackupM15V2SectionsShape): Promise<void> {
  for (const row of sections.clients) {
    await tx.client.create({ data: reverseMapClient(row) });
  }
  for (const row of sections.imageAssets) {
    await tx.imageAsset.create({ data: reverseMapImageAsset(row) });
  }
  for (const row of sections.imageAnalyses) {
    await tx.imageAnalysis.create({ data: reverseMapImageAnalysis(row) });
  }
  for (const row of sections.analyses) {
    await tx.analysis.create({ data: reverseMapAnalysis(row) });
  }
  for (const row of sections.consultations) {
    await tx.consultation.create({ data: reverseMapConsultation(row) });
  }
  for (const row of sections.imageAnalysisReviews) {
    await tx.imageAnalysisReview.create({ data: reverseMapImageAnalysisReview(row) });
  }
}

function reverseMapClient(row: BackupM15V2SectionsShape["clients"][number]) {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    deletedAt: toNullableDate(row.deletedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function reverseMapAnalysis(row: BackupM15V2SectionsShape["analyses"][number]) {
  return {
    id: row.id,
    clientId: row.clientId,
    ownerUserId: row.ownerUserId,
    goal: row.goal,
    hairType: row.hairType,
    density: row.density,
    porosity: row.porosity,
    phase: row.phase,
    clarificationRound: row.clarificationRound,
    confidenceScore: row.confidenceScore,
    uncertaintyReasons: row.uncertaintyReasons,
    followUpQuestions: row.followUpQuestions,
    recommendations: row.recommendations,
    safetyNotes: row.safetyNotes,
    faceShape: row.faceShape,
    headShape: row.headShape,
    hairLength: row.hairLength,
    hairTexture: row.hairTexture,
    hairCondition: row.hairCondition,
    growthPattern: row.growthPattern,
    targetShape: row.targetShape,
    // Passed through as-is: the real Prisma wiring (a later, separately authorized
    // package) is responsible for any provider-specific explicit-JSON-null handling.
    technicalCutPlan: row.technicalCutPlan,
    clarificationAnswers: row.clarificationAnswers,
    imageAssetId: row.imageAssetId,
    imageAnalysisId: row.imageAnalysisId,
    m8DraftCreatedAt: toNullableDate(row.m8DraftCreatedAt),
    m8FinalizedAt: toNullableDate(row.m8FinalizedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function reverseMapConsultation(row: BackupM15V2SectionsShape["consultations"][number]) {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    analysisId: row.analysisId,
    summary: row.summary,
    nextSteps: row.nextSteps,
    createdAt: toDate(row.createdAt),
  };
}

function reverseMapImageAsset(row: BackupM15V2SectionsShape["imageAssets"][number]) {
  const common = {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    ownerUserId: row.ownerUserId,
    clientId: row.clientId,
    exifStripped: row.exifStripped,
    normalizedOrientation: row.normalizedOrientation,
    uploadedAt: toDate(row.uploadedAt),
    deletedAt: toNullableDate(row.deletedAt),
    retentionDeletesAt: toNullableDate(row.retentionDeletesAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };

  if (row.storageKind === "legacy-local") {
    return {
      ...common,
      // M33 GO-4: the artifact's own legacyReference.relativePath (used internally by the
      // resolver abstraction for verify/preview) is relative to the storage root and is
      // NOT what image-assets/[id]/content/route.ts expects in the storagePath column --
      // that route reads it directly via createConfinedImageReadStream, which resolves it
      // as an absolute, upload-time-style path (image-storage.ts's getStoragePath output).
      // Writing the bare relative form here left every restored legacy-local asset
      // permanently unreadable (confirmed live: 200 before restore, 409 after).
      storagePath: getStoragePath(row.ownerUserId, row.id, row.fileName),
      storageBackend: null,
      storageBucketAlias: null,
      storageKey: null,
      storageVersionId: null,
      storageEtag: null,
      contentSha256: row.legacyReference.contentSha256,
      storageState: null,
      storageMigratedAt: null,
      objectDeletedAt: null,
      lastStorageErrorCode: null,
    };
  }

  return {
    ...common,
    storagePath: "pending",
    storageBackend: "s3",
    storageBucketAlias: row.objectReference.bucketAlias,
    storageKey: row.objectReference.key,
    storageVersionId: row.objectReference.versionId,
    storageEtag: row.storageEtag,
    contentSha256: row.objectReference.contentSha256,
    storageState: row.storageState,
    storageMigratedAt: toNullableDate(row.storageMigratedAt),
    objectDeletedAt: null,
    lastStorageErrorCode: row.lastStorageErrorCode,
  };
}

function reverseMapImageAnalysis(row: BackupM15V2SectionsShape["imageAnalyses"][number]) {
  return {
    id: row.id,
    assetId: row.assetId,
    status: row.status,
    providerName: row.providerName,
    modelVersion: row.modelVersion,
    analysisPayload: row.analysisPayload,
    confidences: row.confidences,
    unknownFields: row.unknownFields,
    warnings: row.warnings,
    limitations: row.limitations,
    consentTimestamp: toDate(row.consentTimestamp),
    deletedAt: toNullableDate(row.deletedAt),
    retentionDeletesAt: toNullableDate(row.retentionDeletesAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function reverseMapImageAnalysisReview(row: BackupM15V2SectionsShape["imageAnalysisReviews"][number]) {
  return {
    id: row.id,
    analysisId: row.analysisId,
    reviewedByUserId: row.reviewedByUserId,
    manualCorrections: row.manualCorrections,
    confirmationTimestamp: toNullableDate(row.confirmationTimestamp),
    notes: row.notes,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function toDate(value: string): Date {
  return new Date(value);
}

function toNullableDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

async function fetchCurrentState(
  database: BackupM15V2RestoreExecutionTransaction,
  ownerUserId: string,
): Promise<BackupM15V2SectionsShape> {
  const [clients, analyses, consultations, imageAssets, imageAnalyses, imageAnalysisReviews] = await Promise.all([
    database.client.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    database.analysis.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    database.consultation.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    database.imageAsset.findMany({ where: { ownerUserId }, orderBy: { id: "asc" } }),
    database.imageAnalysis.findMany({ where: { asset: { ownerUserId } }, orderBy: { id: "asc" } }),
    database.imageAnalysisReview.findMany({ where: { analysis: { asset: { ownerUserId } } }, orderBy: { id: "asc" } }),
  ]);

  return {
    clients: sortAndMap(clients, mapClient),
    analyses: sortAndMap(analyses, mapAnalysis),
    consultations: sortAndMap(consultations, mapConsultation),
    imageAssets: sortAndMap(imageAssets, mapImageAssetRow),
    imageAnalyses: sortAndMap(imageAnalyses, mapImageAnalysis),
    imageAnalysisReviews: sortAndMap(imageAnalysisReviews, mapImageAnalysisReview),
  } as unknown as BackupM15V2SectionsShape;
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
    technicalCutPlan: row.technicalCutPlan === null || row.technicalCutPlan === undefined ? null : requireJson(row.technicalCutPlan),
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
    if (objectFieldsPresent) fail("SNAPSHOT_PAYLOAD_INVALID");
    if (typeof row.contentSha256 !== "string" || !row.contentSha256) fail("SNAPSHOT_PAYLOAD_INVALID");
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
      fail("SNAPSHOT_PAYLOAD_INVALID");
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

  fail("SNAPSHOT_PAYLOAD_INVALID");
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
  if (typeof value !== "string") fail("SNAPSHOT_PAYLOAD_INVALID");
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("SNAPSHOT_PAYLOAD_INVALID");
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail("SNAPSHOT_PAYLOAD_INVALID");
  return value;
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail("SNAPSHOT_PAYLOAD_INVALID");
  return [...(value as string[])];
}

function requireJson(value: unknown): unknown {
  if (value === undefined) fail("SNAPSHOT_PAYLOAD_INVALID");
  return value;
}

function timestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && isValidTimestamp(value)) return value;
  fail("SNAPSHOT_PAYLOAD_INVALID");
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function isValidTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function countSections(sections: BackupM15V2SectionsShape): Readonly<Record<SectionName, number>> {
  return {
    clients: sections.clients.length,
    analyses: sections.analyses.length,
    consultations: sections.consultations.length,
    imageAssets: sections.imageAssets.length,
    imageAnalyses: sections.imageAnalyses.length,
    imageAnalysisReviews: sections.imageAnalysisReviews.length,
  };
}

function sectionsMatchExactly(left: BackupM15V2SectionsShape, right: BackupM15V2SectionsShape): boolean {
  for (const section of SECTION_NAMES) {
    if (!rowsMatchExactly(left[section], right[section])) return false;
  }
  return true;
}

function rowsMatchExactly(left: readonly { id: string }[], right: readonly { id: string }[]): boolean {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((row) => [row.id, row]));
  for (const row of left) {
    const other = rightById.get(row.id);
    if (!other) return false;
    if (canonicalizeM15V2(row) !== canonicalizeM15V2(other)) return false;
  }
  return true;
}

function isRetryableConcurrencyError(error: unknown): boolean {
  if (isKnownRequestErrorCode(error, "P2034")) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("deadlock") || message.includes("serialization");
  }
  return false;
}

function isKnownRequestErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as Record<string, unknown>).code === code;
}

// Referenced only for its type shape, never constructed directly by this module.
export type { BackupM15V2ArtifactInput };
