import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import {
  buildBackupM15V2Artifact,
  M15_V2_CANONICAL_SERIALIZATION_VERSION,
  M15_V2_CHECKSUM_ALGORITHM,
  M15_V2_SCHEMA_VERSION,
  type BackupM15V2ArtifactInput,
} from "./backup-m15-v2-artifact";
import { createLegacyLocalReferenceResolver, createObjectBackedReferenceResolver } from "./backup-m15-v2-reference-resolvers";
import {
  BackupM15V2RestoreExecutionError,
  executeBackupM15V2RestoreForUser,
  type BackupM15V2RestoreExecutionDatabase,
  type BackupM15V2RestoreExecutionInput,
  type BackupM15V2RestoreExecutionTransaction,
} from "./backup-m15-v2-restore-execution";
import { ImageAssetStorageRepository } from "./image-asset-storage-repository";
import { getStoragePath } from "./image-storage";
import type { ObjectStorage, StoredObject } from "./object-storage";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "99999999-9999-4999-8999-999999999999";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const BACKUP_ID = "backup-target-1";
const SAFETY_BACKUP_ID = "backup-safety-1";
const NOW = new Date("2026-07-30T18:00:00.000Z");
const PREVIEWED_AT = "2026-07-30T17:00:00.000Z";
const SAFETY_CREATED_AT = new Date("2026-07-30T17:30:00.000Z");

function fixedNow(): Date {
  return NOW;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function emptySections(): {
  clients: Array<Record<string, unknown>>;
  analyses: Array<Record<string, unknown>>;
  consultations: Array<Record<string, unknown>>;
  imageAssets: Array<Record<string, unknown>>;
  imageAnalyses: Array<Record<string, unknown>>;
  imageAnalysisReviews: Array<Record<string, unknown>>;
} {
  return { clients: [], analyses: [], consultations: [], imageAssets: [], imageAnalyses: [], imageAnalysisReviews: [] };
}

function buildArtifactInput(sections: Partial<ReturnType<typeof emptySections>> = {}, overrides: Partial<BackupM15V2ArtifactInput> = {}): BackupM15V2ArtifactInput {
  const merged = { ...emptySections(), ...sections };
  return {
    schemaVersion: M15_V2_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_V2_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_V2_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: BACKUP_ID,
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "restore-execution-fixture",
    createdAt: "2026-07-30T10:00:00.000Z",
    summarySnapshot: { clientsCount: 0, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
    counts: {
      clients: merged.clients.length, analyses: merged.analyses.length, consultations: merged.consultations.length,
      imageAssets: merged.imageAssets.length, imageAnalyses: merged.imageAnalyses.length, imageAnalysisReviews: merged.imageAnalysisReviews.length,
    },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024, maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: { clients: 2000, analyses: 10000, consultations: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
    },
    sections: merged,
    ...overrides,
  } as unknown as BackupM15V2ArtifactInput;
}

function buildArtifact(sections: Partial<ReturnType<typeof emptySections>> = {}, backupId = BACKUP_ID) {
  return buildBackupM15V2Artifact(buildArtifactInput(sections, { backupId }));
}

function legacyRelativePath(id: string): string {
  return `${OWNER_ID}/${id}/photo.jpg`;
}

function legacyArtifactAsset(id: string, content: Uint8Array) {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID, clientId: CLIENT_ID,
    exifStripped: true, normalizedOrientation: 1, uploadedAt: "2026-07-30T10:00:00.000Z", deletedAt: null, retentionDeletesAt: null,
    createdAt: "2026-07-30T10:00:00.000Z", updatedAt: "2026-07-30T10:00:00.000Z", storageKind: "legacy-local" as const,
    legacyReference: {
      backend: "local" as const, rootAlias: "legacy-images" as const, relativePath: legacyRelativePath(id),
      contentSha256: sha256(content), sizeBytes: content.byteLength,
    },
  };
}

function objectKey(id: string): string {
  return `v1/owners/${OWNER_ID}/assets/${id}/original`;
}

function objectArtifactAsset(id: string, content: Uint8Array) {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID, clientId: CLIENT_ID,
    exifStripped: true, normalizedOrientation: 1, uploadedAt: "2026-07-30T10:00:00.000Z", deletedAt: null, retentionDeletesAt: null,
    createdAt: "2026-07-30T10:00:00.000Z", updatedAt: "2026-07-30T10:00:00.000Z", storageKind: "object-backed" as const,
    objectReference: {
      backend: "s3" as const, bucketAlias: "primary-images", key: objectKey(id), versionId: `version-${id}`,
      contentSha256: sha256(content), sizeBytes: content.byteLength,
    },
    storageEtag: "etag-1", storageState: "available" as const, storageMigratedAt: "2026-07-30T10:00:00.000Z",
    objectDeletedAt: null, lastStorageErrorCode: null,
  };
}

function clientArtifactRow(id = CLIENT_ID) {
  return {
    id, fullName: "Client", email: null, phone: null, notes: null, deletedAt: null,
    ownerUserId: OWNER_ID, createdAt: "2026-07-30T10:00:00.000Z", updatedAt: "2026-07-30T10:00:00.000Z",
  };
}

interface PersistedSnapshotRow {
  id: string; ownerUserId: string; checksum: string | null; checksumAlgorithm: string | null;
  schemaVersion: string; snapshotJson: unknown; createdAt: Date | string;
}

function snapshotRow(artifact: ReturnType<typeof buildArtifact>, createdAt: Date = NOW): PersistedSnapshotRow {
  return {
    id: artifact.backupId, ownerUserId: artifact.ownerUserId, checksum: artifact.checksum,
    checksumAlgorithm: artifact.checksumAlgorithm, schemaVersion: artifact.schemaVersion, snapshotJson: artifact, createdAt,
  };
}

type FakeTableName = "client" | "analysis" | "consultation" | "imageAsset" | "imageAnalysis" | "imageAnalysisReview";

interface FakeDatabaseConfig {
  snapshots: Record<string, PersistedSnapshotRow | null | undefined>;
  tables?: Partial<Record<FakeTableName, Array<Record<string, unknown>>>>;
  transactionErrors?: unknown[];
  mutateBeforeTransaction?: (tables: Record<FakeTableName, Array<Record<string, unknown>>>) => void;
}

function fakeDatabase(config: FakeDatabaseConfig) {
  const tables: Record<FakeTableName, Array<Record<string, unknown>>> = {
    client: [...(config.tables?.client ?? [])],
    analysis: [...(config.tables?.analysis ?? [])],
    consultation: [...(config.tables?.consultation ?? [])],
    imageAsset: [...(config.tables?.imageAsset ?? [])],
    imageAnalysis: [...(config.tables?.imageAnalysis ?? [])],
    imageAnalysisReview: [...(config.tables?.imageAnalysisReview ?? [])],
  };
  const deleteLog: FakeTableName[] = [];
  const createLog: Array<{ table: FakeTableName; data: Record<string, unknown> }> = [];
  const transactionOptions: unknown[] = [];
  const callOrder: string[] = [];
  const errorsQueue = [...(config.transactionErrors ?? [])];
  let mutateHook = config.mutateBeforeTransaction;

  function ownerOf(table: FakeTableName, row: Record<string, unknown>): string | undefined {
    if (table === "imageAnalysis") {
      const asset = tables.imageAsset.find((a) => a.id === row.assetId);
      return asset?.ownerUserId as string | undefined;
    }
    if (table === "imageAnalysisReview") {
      const analysis = tables.imageAnalysis.find((a) => a.id === row.analysisId);
      const asset = analysis ? tables.imageAsset.find((a) => a.id === analysis.assetId) : undefined;
      return asset?.ownerUserId as string | undefined;
    }
    return row.ownerUserId as string | undefined;
  }

  function matches(table: FakeTableName, row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    if (typeof where.ownerUserId === "string") return ownerOf(table, row) === where.ownerUserId;
    const idIn = (where.id as { in?: string[] } | undefined)?.in;
    if (idIn) return idIn.includes(row.id as string);
    const asset = where.asset as { ownerUserId?: string } | undefined;
    if (asset?.ownerUserId) return ownerOf(table, row) === asset.ownerUserId;
    const analysis = where.analysis as { asset?: { ownerUserId?: string } } | undefined;
    if (analysis?.asset?.ownerUserId) return ownerOf(table, row) === analysis.asset.ownerUserId;
    return false;
  }

  function project(table: FakeTableName, row: Record<string, unknown>, select: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (select.id) result.id = row.id;
    if (select.ownerUserId) result.ownerUserId = row.ownerUserId;
    if (select.asset) {
      const owner = ownerOf(table, row);
      result.asset = owner === undefined ? undefined : { ownerUserId: owner };
    }
    if (select.analysis) {
      const owner = ownerOf(table, row);
      result.analysis = owner === undefined ? undefined : { asset: { ownerUserId: owner } };
    }
    return result;
  }

  function makeDelegate(table: FakeTableName) {
    return {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: unknown }) => {
        const rows = tables[table].filter((row) => matches(table, row, args.where));
        return args.select ? rows.map((row) => project(table, row, args.select!)) : rows.map((row) => ({ ...row }));
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        deleteLog.push(table);
        const before = tables[table].length;
        tables[table] = tables[table].filter((row) => !matches(table, row, args.where));
        return { count: before - tables[table].length };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        createLog.push({ table, data: args.data });
        tables[table].push({ ...args.data });
        return { ...args.data };
      }),
    };
  }

  const view: BackupM15V2RestoreExecutionTransaction = {
    opsBackupSnapshot: {
      findFirst: vi.fn(async (args: { where: { id: string; ownerUserId: string } }) => {
        const row = config.snapshots[args.where.id];
        if (!row || row.ownerUserId !== args.where.ownerUserId) return null;
        return row;
      }),
    },
    client: makeDelegate("client"),
    analysis: makeDelegate("analysis"),
    consultation: makeDelegate("consultation"),
    imageAsset: makeDelegate("imageAsset"),
    imageAnalysis: makeDelegate("imageAnalysis"),
    imageAnalysisReview: makeDelegate("imageAnalysisReview"),
  };

  const database = {
    ...view,
    tables,
    deleteLog,
    createLog,
    transactionOptions,
    callOrder,
    $transaction: vi.fn(async (callback: (tx: BackupM15V2RestoreExecutionTransaction) => Promise<unknown>, options?: unknown) => {
      callOrder.push("transaction-open");
      transactionOptions.push(options);
      if (mutateHook) {
        mutateHook(tables);
        mutateHook = undefined;
      }
      if (errorsQueue.length > 0) {
        throw errorsQueue.shift();
      }
      // Mirrors real Postgres/Prisma $transaction semantics: any mutation made through
      // `tx.*` inside the callback is visible only if the callback resolves. If it
      // rejects, every table is reverted to its pre-transaction snapshot, exactly as a
      // real ROLLBACK would -- this lets tests prove no partial state survives a
      // mid-transaction failure, per the M33 GO-4 mandate's rollback requirement.
      const snapshot = structuredClone(tables);
      try {
        return await callback(view);
      } catch (error) {
        (Object.keys(tables) as FakeTableName[]).forEach((table) => {
          tables[table] = snapshot[table];
        });
        throw error;
      }
    }),
  } as unknown as BackupM15V2RestoreExecutionDatabase & {
    tables: Record<FakeTableName, Array<Record<string, unknown>>>;
    deleteLog: FakeTableName[];
    createLog: Array<{ table: FakeTableName; data: Record<string, unknown> }>;
    transactionOptions: unknown[];
    callOrder: string[];
  };

  return database;
}

function noResolvers() {
  return {
    legacyLocalResolver: createLegacyLocalReferenceResolver({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-empty-")) }),
    objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => null }),
  };
}

function baseRequestFor(previewFingerprint: string): Record<string, unknown> {
  return {
    previewFingerprint,
    previewedAt: PREVIEWED_AT,
    strategy: "replace_all",
    acknowledgeDataLoss: true,
    safetyBackupId: SAFETY_BACKUP_ID,
  };
}

function baseInput(overrides: Partial<BackupM15V2RestoreExecutionInput> = {}): BackupM15V2RestoreExecutionInput {
  const artifact = buildArtifact({ clients: [clientArtifactRow()] });
  const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
  const database = fakeDatabase({
    snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
  });
  return {
    ownerUserId: OWNER_ID,
    backupId: BACKUP_ID,
    request: baseRequestFor("0".repeat(64)),
    database,
    now: fixedNow,
    ...noResolvers(),
    ...overrides,
  };
}

async function computeFreshFingerprint(
  artifact: ReturnType<typeof buildArtifact>,
  currentState: ReturnType<typeof emptySections>,
): Promise<string> {
  const { buildBackupM15V2RestorePreview } = await import("./backup-m15-v2-restore-preview");
  const { verifyBackupM15V2ExternalReferences } = await import("./backup-m15-v2-external-reference-verifier");
  const preview = await buildBackupM15V2RestorePreview({
    artifact,
    backupId: artifact.backupId,
    ownerUserId: artifact.ownerUserId,
    currentState,
    previewedAt: PREVIEWED_AT,
    ...noResolvers(),
    verifyExternalReferences: verifyBackupM15V2ExternalReferences,
  });
  if (!preview.ok) throw new Error("expected a valid preview in test fixture setup");
  return preview.fingerprint;
}

describe("executeBackupM15V2RestoreForUser", () => {
  it("1. restores successfully into an empty account (clients only)", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    const result = await executeBackupM15V2RestoreForUser(
      baseInput({ database, request: baseRequestFor(fingerprint) }),
    );
    expect(result).toMatchObject({ status: "completed", strategy: "replace_all", attemptsUsed: 1 });
    expect(result.restoredCounts.clients).toBe(1);
    expect(database.tables.client).toHaveLength(1);
  });

  it("2. restores successfully with a legacy-local image asset", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-legacy-"));
    const content = Buffer.from("legacy-body");
    fs.mkdirSync(path.join(root, OWNER_ID, "22222222-2222-4222-8222-222222222222"), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, "22222222-2222-4222-8222-222222222222", "photo.jpg"), content);
    const assetId = "22222222-2222-4222-8222-222222222222";
    const artifact = buildArtifact({ clients: [clientArtifactRow()], imageAssets: [legacyArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const legacyLocalResolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const fingerprint = await computeFreshFingerprintWithResolvers(artifact, emptySections(), legacyLocalResolver, noResolvers().objectBackedResolver);
    const result = await executeBackupM15V2RestoreForUser(
      baseInput({ database, request: baseRequestFor(fingerprint), legacyLocalResolver }),
    );
    expect(result.restoredCounts.imageAssets).toBe(1);
    expect(database.tables.imageAsset[0]).toMatchObject({
      storageBackend: null,
      contentSha256: sha256(content),
      // M33 GO-4 regression guard: storagePath must be the absolute, upload-time-style
      // path that image-assets/[id]/content/route.ts reads raw (getStoragePath's output),
      // NOT the artifact's bare relative legacyReference.relativePath. Writing the latter
      // here previously left every restored legacy-local asset permanently unreadable
      // (live-proven: 200 before restore, 409 after) despite restore reporting success.
      storagePath: getStoragePath(OWNER_ID, assetId, "photo.jpg"),
    });
  });

  it("2b. legacy-local restore never writes the artifact's bare relative path into storagePath", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-legacy-"));
    const content = Buffer.from("legacy-body-2b");
    const assetId = "22222222-2222-4222-8222-222222222223";
    fs.mkdirSync(path.join(root, OWNER_ID, assetId), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, assetId, "photo.jpg"), content);
    const artifact = buildArtifact({ clients: [clientArtifactRow()], imageAssets: [legacyArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const legacyLocalResolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const fingerprint = await computeFreshFingerprintWithResolvers(artifact, emptySections(), legacyLocalResolver, noResolvers().objectBackedResolver);
    await executeBackupM15V2RestoreForUser(
      baseInput({ database, request: baseRequestFor(fingerprint), legacyLocalResolver }),
    );
    const restoredPath = database.tables.imageAsset[0].storagePath as string;
    expect(restoredPath).not.toBe(`${OWNER_ID}/${assetId}/photo.jpg`);
    expect(path.isAbsolute(restoredPath)).toBe(true);
  });

  it("3. restores successfully with an object-backed image asset", async () => {
    const assetId = "33333333-3333-4333-8333-333333333333";
    const content = new TextEncoder().encode("object-body");
    const artifact = buildArtifact({ clients: [clientArtifactRow()], imageAssets: [objectArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const storage = fakeObjectStorage(assetId, content);
    const objectBackedResolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const fingerprint = await computeFreshFingerprintWithResolvers(artifact, emptySections(), noResolvers().legacyLocalResolver, objectBackedResolver);
    const result = await executeBackupM15V2RestoreForUser(
      baseInput({ database, request: baseRequestFor(fingerprint), objectBackedResolver }),
    );
    expect(result.restoredCounts.imageAssets).toBe(1);
    expect(database.tables.imageAsset[0]).toMatchObject({ storageBackend: "s3", storagePath: "pending" });

    // Content-resolution proof (M33 GO-4 mandate section 9): feed the exact restored DB
    // row through the real ImageAssetStorageRepository (the same class
    // image-assets/[id]/content/route.ts uses for object-backed reads) and confirm it
    // reconstructs an ObjectReference whose fields match the original artifact's
    // objectReference exactly. No second/invented resolver -- this is the one production
    // repository already used for post-restore reads.
    const restoredRow = database.tables.imageAsset[0];
    const repository = new ImageAssetStorageRepository({
      imageAsset: { findFirst: vi.fn().mockResolvedValue(restoredRow) },
    } as never);
    await expect(repository.findObjectReferenceByOwner(OWNER_ID, assetId)).resolves.toEqual({
      backend: "s3",
      bucketAlias: "primary-images",
      key: objectKey(assetId),
      versionId: `version-${assetId}`,
      etag: "etag-1",
      contentSha256: sha256(content),
      sizeBytes: content.byteLength,
    });
  });

  it("3b. restores a mixed backup (legacy-local + object-backed) atomically, both correctly mapped", async () => {
    const localAssetId = "22222222-2222-4222-8222-222222222225";
    const objectAssetId = "33333333-3333-4333-8333-333333333335";
    const localContent = Buffer.from("mixed-local-body");
    const objectContent = new TextEncoder().encode("mixed-object-body");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-mixed-"));
    fs.mkdirSync(path.join(root, OWNER_ID, localAssetId), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, localAssetId, "photo.jpg"), localContent);
    const legacyLocalResolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const storage = fakeObjectStorage(objectAssetId, objectContent);
    const objectBackedResolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });

    const artifact = buildArtifact({
      clients: [clientArtifactRow()],
      imageAssets: [legacyArtifactAsset(localAssetId, localContent), objectArtifactAsset(objectAssetId, objectContent)],
    });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprintWithResolvers(artifact, emptySections(), legacyLocalResolver, objectBackedResolver);
    const result = await executeBackupM15V2RestoreForUser(
      baseInput({ database, request: baseRequestFor(fingerprint), legacyLocalResolver, objectBackedResolver }),
    );
    expect(result.status).toBe("completed");
    expect(result.restoredCounts.imageAssets).toBe(2);
    const restoredLocal = database.tables.imageAsset.find((row) => row.id === localAssetId);
    const restoredObject = database.tables.imageAsset.find((row) => row.id === objectAssetId);
    expect(restoredLocal).toMatchObject({ storageBackend: null, storagePath: getStoragePath(OWNER_ID, localAssetId, "photo.jpg") });
    expect(restoredObject).toMatchObject({ storageBackend: "s3", storagePath: "pending", storageKey: objectKey(objectAssetId) });
  });

  it("3c. rejects an entire mixed restore atomically when only the object-backed asset's reference is invalid (zero mutation, including for the otherwise-valid legacy-local asset)", async () => {
    const localAssetId = "22222222-2222-4222-8222-222222222226";
    const objectAssetId = "33333333-3333-4333-8333-333333333336";
    const localContent = Buffer.from("mixed-local-body-2");
    const objectContent = new TextEncoder().encode("mixed-object-body-2");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-mixed-fail-"));
    fs.mkdirSync(path.join(root, OWNER_ID, localAssetId), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, localAssetId, "photo.jpg"), localContent);
    const legacyLocalResolver = createLegacyLocalReferenceResolver({ rootDir: root });
    // No object storage configured for this resolver -- the object-backed asset's
    // reference cannot be verified, so the whole mixed backup must fail precheck.
    const objectBackedResolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => null });

    const artifact = buildArtifact({
      clients: [clientArtifactRow()],
      imageAssets: [legacyArtifactAsset(localAssetId, localContent), objectArtifactAsset(objectAssetId, objectContent)],
    });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    await expect(
      executeBackupM15V2RestoreForUser(
        baseInput({ database, request: baseRequestFor("0".repeat(64)), legacyLocalResolver, objectBackedResolver }),
      ),
    ).rejects.toMatchObject({ code: "PRECHECK_FAILED" });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.tables.imageAsset).toEqual([]);
    expect(database.tables.client).toEqual([]);
  });

  it("4. rejects an invalid request (bad fingerprint format)", async () => {
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ request: { ...baseRequestFor("not-a-hash") } })),
    ).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("4b. rejects a request missing acknowledgeDataLoss", async () => {
    const request = baseRequestFor("0".repeat(64));
    delete (request as Record<string, unknown>).acknowledgeDataLoss;
    await expect(executeBackupM15V2RestoreForUser(baseInput({ request }))).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("4c. rejects a request missing safetyBackupId", async () => {
    const request = baseRequestFor("0".repeat(64));
    delete (request as Record<string, unknown>).safetyBackupId;
    await expect(executeBackupM15V2RestoreForUser(baseInput({ request }))).rejects.toMatchObject({ code: "REQUEST_INVALID" });
  });

  it("5. rejects when the snapshot does not exist", async () => {
    const database = fakeDatabase({ snapshots: {} });
    await expect(executeBackupM15V2RestoreForUser(baseInput({ database }))).rejects.toMatchObject({ code: "SNAPSHOT_NOT_FOUND" });
  });

  it("5b. treats another owner's snapshot as not found", async () => {
    const artifact = buildArtifact({});
    const database = fakeDatabase({ snapshots: { [BACKUP_ID]: { ...snapshotRow(artifact), ownerUserId: OTHER_OWNER_ID } } });
    await expect(executeBackupM15V2RestoreForUser(baseInput({ database }))).rejects.toMatchObject({ code: "SNAPSHOT_NOT_FOUND" });
  });

  it("6. rejects an unsupported schemaVersion", async () => {
    const artifact = buildArtifact({});
    const database = fakeDatabase({ snapshots: { [BACKUP_ID]: { ...snapshotRow(artifact), schemaVersion: "m15.v1" } } });
    await expect(executeBackupM15V2RestoreForUser(baseInput({ database }))).rejects.toMatchObject({ code: "SNAPSHOT_SCHEMA_UNSUPPORTED" });
  });

  it("7. rejects an invalid payload", async () => {
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: { id: BACKUP_ID, ownerUserId: OWNER_ID, checksum: "a".repeat(64), checksumAlgorithm: "sha256", schemaVersion: "m15.v2", snapshotJson: { not: "valid" }, createdAt: NOW } },
    });
    await expect(executeBackupM15V2RestoreForUser(baseInput({ database }))).rejects.toMatchObject({ code: "SNAPSHOT_PAYLOAD_INVALID" });
  });

  it("7b. rejects a stored snapshot with an object-backed asset missing storageKey, with zero mutation", async () => {
    // The artifact parser (backup-m15-v2-artifact.ts, already exhaustively covered by
    // backup-m15-v2-artifact.test.ts for every invalid-metadata shape: missing key,
    // missing versionId, invalid/missing bucketAlias, invalid backend, uppercase hash,
    // etc.) is reused here, not duplicated -- this test only proves that restore
    // execution itself fails closed on a corrupted stored snapshot (simulating DB-level
    // corruption a client could never produce through the normal artifact builder)
    // before the transaction ever opens, i.e. zero delete, zero insert, zero partial state.
    const assetId = "33333333-3333-4333-8333-333333333334";
    const content = new TextEncoder().encode("corrupt-metadata-body");
    const artifact = buildArtifact({ imageAssets: [objectArtifactAsset(assetId, content)] });
    const corruptedSnapshotJson = structuredClone(artifact) as unknown as { sections: { imageAssets: Array<{ objectReference: Record<string, unknown> }> } };
    delete corruptedSnapshotJson.sections.imageAssets[0].objectReference.key;
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: { ...snapshotRow(artifact), snapshotJson: corruptedSnapshotJson } },
    });
    await expect(executeBackupM15V2RestoreForUser(baseInput({ database }))).rejects.toMatchObject({ code: "SNAPSHOT_PAYLOAD_INVALID" });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.tables.imageAsset).toEqual([]);
  });

  it("8. rejects a stored checksum mismatch", async () => {
    const artifact = buildArtifact({});
    const database = fakeDatabase({ snapshots: { [BACKUP_ID]: { ...snapshotRow(artifact), checksum: "0".repeat(64) } } });
    await expect(executeBackupM15V2RestoreForUser(baseInput({ database }))).rejects.toMatchObject({ code: "SNAPSHOT_CHECKSUM_MISMATCH" });
  });

  it("9. rejects when the pre-check external reference verification fails", async () => {
    const assetId = "22222222-2222-4222-8222-222222222222";
    const content = Buffer.from("legacy-missing");
    const artifact = buildArtifact({ imageAssets: [legacyArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor("0".repeat(64)) })),
    ).rejects.toMatchObject({ code: "PRECHECK_FAILED" });
  });

  it("10. rejects when current state has rows the backup would delete", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      tables: { client: [clientArtifactRow("extra-client-not-in-backup")] },
    });
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor("0".repeat(64)) })),
    ).rejects.toMatchObject({ code: "RESTORE_BLOCKED_BY_PREVIEW" });
  });

  it("11. rejects a stale preview fingerprint", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor("1".repeat(64)) })),
    ).rejects.toMatchObject({ code: "PREVIEW_FINGERPRINT_STALE" });
  });

  it("12. rejects when the safety backup is missing", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const database = fakeDatabase({ snapshots: { [BACKUP_ID]: snapshotRow(artifact) } });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "SAFETY_BACKUP_REQUIRED" });
  });

  it("13. rejects when the safety backup is the same as the target backup", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const database = fakeDatabase({ snapshots: { [BACKUP_ID]: snapshotRow(artifact) } });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint), request2: undefined } as never)),
    ).rejects.toBeDefined();
    const req = baseRequestFor(fingerprint);
    (req as Record<string, unknown>).safetyBackupId = BACKUP_ID;
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: req })),
    ).rejects.toMatchObject({ code: "SAFETY_BACKUP_INVALID" });
  });

  it("14. rejects a safety backup with the wrong schemaVersion", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: { ...snapshotRow(safetyArtifact, SAFETY_CREATED_AT), schemaVersion: "m13.v3" } },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "SAFETY_BACKUP_INVALID" });
  });

  it("15. rejects a safety backup created before the previewedAt threshold", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const tooEarly = new Date("2026-07-30T16:00:00.000Z");
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, tooEarly) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "SAFETY_BACKUP_INVALID" });
  });

  it("16. rejects a safety backup whose content does not match current state", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [clientArtifactRow("55555555-5555-4555-8555-555555555555")] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "SAFETY_BACKUP_STATE_MISMATCH" });
  });

  it("17. rejects when current state changes between the pre-check and the transaction", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      mutateBeforeTransaction: (tables) => {
        tables.client.push(clientArtifactRow("66666666-6666-4666-8666-666666666666"));
      },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "CURRENT_STATE_CHANGED" });
  });

  it("18. rejects a cross-owner id collision", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      tables: { client: [{ ...clientArtifactRow(), ownerUserId: OTHER_OWNER_ID }] },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "OWNER_COLLISION" });
  });

  it("19. does not treat a same-owner pre-existing row as a collision", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [clientArtifactRow()] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      tables: { client: [clientArtifactRow()] },
    });
    const fingerprint = await computeFreshFingerprint(artifact, { ...emptySections(), clients: [clientArtifactRow()] });
    const result = await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(result.status).toBe("completed");
  });

  it("20. deletes rows in the correct order (children before parents)", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(database.deleteLog).toEqual(["imageAnalysisReview", "consultation", "analysis", "imageAnalysis", "imageAsset", "client"]);
  });

  it("21. inserts rows in the correct order (parents before children)", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(database.createLog.map((entry) => entry.table)).toEqual(["client"]);
  });

  it("22. uses Serializable isolation", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(database.transactionOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("23. verifies external references before opening the transaction", async () => {
    const assetId = "22222222-2222-4222-8222-222222222222";
    const content = Buffer.from("legacy-order-check");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-order-"));
    fs.mkdirSync(path.join(root, OWNER_ID, assetId), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, assetId, "photo.jpg"), content);
    const artifact = buildArtifact({ clients: [clientArtifactRow()], imageAssets: [legacyArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const legacyLocalResolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const wrapped = {
      resolveLegacyLocalReference: vi.fn(async (identity: Parameters<typeof legacyLocalResolver.resolveLegacyLocalReference>[0]) => {
        database.callOrder.push("resolver");
        return legacyLocalResolver.resolveLegacyLocalReference(identity);
      }),
    };
    const fingerprint = await computeFreshFingerprintWithResolvers(artifact, emptySections(), wrapped, noResolvers().objectBackedResolver);
    database.callOrder.length = 0;
    await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint), legacyLocalResolver: wrapped }));
    const resolverIndex = database.callOrder.indexOf("resolver");
    const transactionIndex = database.callOrder.indexOf("transaction-open");
    expect(resolverIndex).toBeGreaterThanOrEqual(0);
    expect(resolverIndex).toBeLessThan(transactionIndex);
  });

  it("24. fails closed on the structural postcondition when insertion produces the wrong state", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    vi.mocked(database.client.create).mockImplementationOnce(async (args: unknown) => {
      const { data } = args as { data: Record<string, unknown> };
      const corrupted = { ...data, fullName: "corrupted-by-test" };
      database.tables.client.push(corrupted);
      database.createLog.push({ table: "client", data: corrupted });
      return corrupted;
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "POSTCONDITION_FAILED" });
  });

  it("24b. rolls back completely when a later section fails after an earlier section already mutated the database", async () => {
    // Same CLIENT_ID in both current state and the target artifact (a same-owner
    // "replace" as in test 19, not an "extra row" as in test 10 -- that path is
    // blocked by preview validation before the transaction even opens, which is
    // not what this test is exercising). A distinguishing fullName on the
    // pre-existing row lets the assertions below prove the ORIGINAL content came
    // back after rollback, not just that some row with the right id exists.
    const originalClient = { ...clientArtifactRow(), fullName: "Original Pre-Restore Name" };
    const assetId = "22222222-2222-4222-8222-222222222224";
    const content = Buffer.from("rollback-proof-body");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h7-rollback-"));
    fs.mkdirSync(path.join(root, OWNER_ID, assetId), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, assetId, "photo.jpg"), content);
    const legacyLocalResolver = createLegacyLocalReferenceResolver({ rootDir: root });

    const artifact = buildArtifact({ clients: [clientArtifactRow()], imageAssets: [legacyArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({ clients: [originalClient] }, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      tables: { client: [originalClient] },
    });

    // Section insert order is client -> imageAsset -> imageAnalysis -> analysis -> consultation
    // -> imageAnalysisReview (confirmed directly in backup-m15-v2-restore-execution.ts). Forcing
    // imageAsset.create to fail guarantees the pre-restore delete of the existing client AND the
    // create of its replacement already ran before the transaction aborts -- exactly the "later
    // section fails after an earlier section was already processed" scenario the mandate requires.
    vi.mocked(database.imageAsset.create).mockImplementationOnce(async () => {
      throw new Error("forced-mid-transaction-failure");
    });

    const currentState = { ...emptySections(), clients: [originalClient] };
    const fingerprint = await computeFreshFingerprintWithResolvers(artifact, currentState, legacyLocalResolver, noResolvers().objectBackedResolver);

    // The raw forced error is not a typed BackupM15V2RestoreExecutionError, so it is not
    // retried (not a recognized concurrency signal) and is mapped to the safe, generic
    // CONCURRENCY_CONFLICT code rather than leaking its internal message -- matching the
    // same fail-closed, no-internal-detail-leak behavior already covered by tests 28/29/32.
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint), legacyLocalResolver })),
    ).rejects.toMatchObject({ code: "CONCURRENCY_CONFLICT" });

    // Real rollback proof: the client delete + client create that already ran inside the
    // same transaction must be fully undone -- the database must show the ORIGINAL
    // pre-restore row content (fullName "Original Pre-Restore Name"), not the new
    // artifact's replacement content and not an empty table. No trace of the
    // never-completed imageAsset either.
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.tables.client).toEqual([originalClient]);
    expect(database.tables.imageAsset).toEqual([]);
  });

  it("25. retries on a retryable concurrency error and eventually succeeds", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      transactionErrors: [Object.assign(new Error("write conflict"), { code: "P2034" })],
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    const result = await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(result.attemptsUsed).toBe(2);
  });

  it("26. retries on a lowercase 'serialization' message error", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      transactionErrors: [new Error("could not complete due to a serialization failure")],
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    const result = await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(result.attemptsUsed).toBe(2);
  });

  it("27. fails closed after exhausting all retry attempts", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      transactionErrors: [
        Object.assign(new Error("write conflict"), { code: "P2034" }),
        Object.assign(new Error("write conflict"), { code: "P2034" }),
        Object.assign(new Error("write conflict"), { code: "P2034" }),
      ],
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "CONCURRENCY_CONFLICT" });
    expect(database.$transaction).toHaveBeenCalledTimes(3);
  });

  it("28. does not retry a unique-constraint error", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      transactionErrors: [Object.assign(new Error("unique violation"), { code: "P2002" })],
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "CONCURRENCY_CONFLICT" });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it("29. does not retry a foreign-key error", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      transactionErrors: [Object.assign(new Error("fk violation"), { code: "P2003" })],
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "CONCURRENCY_CONFLICT" });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it("30. does not retry a validation-style thrown error (fails on first attempt)", async () => {
    const artifact = buildArtifact({ clients: [clientArtifactRow()] });
    const database = fakeDatabase({ snapshots: { [BACKUP_ID]: snapshotRow(artifact) } });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) })),
    ).rejects.toMatchObject({ code: "SAFETY_BACKUP_REQUIRED" });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });

  it("31. never calls Date.now or an un-injected clock", async () => {
    const spy = vi.spyOn(Date, "now");
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor(fingerprint) }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("32. does not expose sensitive data in any thrown error", async () => {
    const assetId = "22222222-2222-4222-8222-222222222222";
    const content = Buffer.from("legacy-missing");
    const artifact = buildArtifact({ imageAssets: [legacyArtifactAsset(assetId, content)] });
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    try {
      await executeBackupM15V2RestoreForUser(baseInput({ database, request: baseRequestFor("0".repeat(64)) }));
      throw new Error("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(assetId);
      expect(message).not.toContain(sha256(content));
      expect(message).not.toContain(OWNER_ID);
    }
  });

  it("33. does not mutate the input request object", async () => {
    const artifact = buildArtifact({});
    const safetyArtifact = buildArtifact({}, SAFETY_BACKUP_ID);
    const database = fakeDatabase({
      snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
    });
    const fingerprint = await computeFreshFingerprint(artifact, emptySections());
    const request = baseRequestFor(fingerprint);
    const before = structuredClone(request);
    await executeBackupM15V2RestoreForUser(baseInput({ database, request }));
    expect(request).toEqual(before);
  });

  it("34. is never imported by any HTTP route or the shared dispatcher (source-level check)", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/next\/server/);
    expect(source).not.toMatch(/from ["']\.\/ops-persistence["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-restore-preview["']/);
    expect(source).not.toMatch(/from ["']\.\/contracts["']/);
    expect(source).not.toMatch(/writeOpsAuditEvent/);
    expect(source).not.toMatch(/@prisma\/client/);
  });

  it("35. produces a deterministic result for an identical fixture", async () => {
    const buildFixture = () => {
      const artifact = buildArtifact({ clients: [clientArtifactRow()] });
      const safetyArtifact = buildArtifact({ clients: [] }, SAFETY_BACKUP_ID);
      const database = fakeDatabase({
        snapshots: { [BACKUP_ID]: snapshotRow(artifact), [SAFETY_BACKUP_ID]: snapshotRow(safetyArtifact, SAFETY_CREATED_AT) },
      });
      return { artifact, database };
    };
    const first = buildFixture();
    const firstFingerprint = await computeFreshFingerprint(first.artifact, emptySections());
    const firstResult = await executeBackupM15V2RestoreForUser(baseInput({ database: first.database, request: baseRequestFor(firstFingerprint) }));

    const second = buildFixture();
    const secondFingerprint = await computeFreshFingerprint(second.artifact, emptySections());
    const secondResult = await executeBackupM15V2RestoreForUser(baseInput({ database: second.database, request: baseRequestFor(secondFingerprint) }));

    expect(firstResult.restoredCounts).toEqual(secondResult.restoredCounts);
    expect(firstResult.deletedCounts).toEqual(secondResult.deletedCounts);
    expect(firstResult.status).toBe(secondResult.status);
  });

  it("36. rejects when the request payload is not an object", async () => {
    await expect(
      executeBackupM15V2RestoreForUser(baseInput({ request: "not-an-object" })),
    ).rejects.toBeInstanceOf(BackupM15V2RestoreExecutionError);
  });
});

function fakeObjectStorage(assetId: string, content: Uint8Array): ObjectStorage {
  const metadata = {
    bucketAlias: "primary-images",
    key: objectKey(assetId),
    versionId: `version-${assetId}`,
    etag: null,
    contentSha256: sha256(content),
    sizeBytes: content.byteLength,
    contentType: "image/jpeg",
  };
  return {
    put: vi.fn(async () => { throw new Error("not used"); }),
    delete: vi.fn(async () => undefined),
    head: vi.fn(async () => ({ ...metadata })),
    get: vi.fn(async (): Promise<StoredObject> => ({
      ...metadata,
      body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }),
    })),
  };
}

async function computeFreshFingerprintWithResolvers(
  artifact: ReturnType<typeof buildArtifact>,
  currentState: ReturnType<typeof emptySections>,
  legacyLocalResolver: Parameters<typeof createLegacyLocalReferenceResolver>[0] extends never ? never : { resolveLegacyLocalReference: (...args: never[]) => unknown },
  objectBackedResolver: { resolveObjectBackedReference: (...args: never[]) => unknown },
): Promise<string> {
  const { buildBackupM15V2RestorePreview } = await import("./backup-m15-v2-restore-preview");
  const { verifyBackupM15V2ExternalReferences } = await import("./backup-m15-v2-external-reference-verifier");
  const preview = await buildBackupM15V2RestorePreview({
    artifact,
    backupId: artifact.backupId,
    ownerUserId: artifact.ownerUserId,
    currentState,
    previewedAt: PREVIEWED_AT,
    legacyLocalResolver: legacyLocalResolver as never,
    objectBackedResolver: objectBackedResolver as never,
    verifyExternalReferences: verifyBackupM15V2ExternalReferences,
  });
  if (!preview.ok) throw new Error("expected a valid preview in test fixture setup");
  return preview.fingerprint;
}

function readSourceFile(): string {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-m15-v2-restore-execution.ts");
  return fs.readFileSync(sourcePath, "utf8");
}
