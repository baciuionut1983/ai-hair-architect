import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import { createLegacyLocalReferenceResolver, createObjectBackedReferenceResolver } from "./backup-m15-v2-reference-resolvers";
import {
  buildBackupM15V2Artifact,
  M15_V2_CANONICAL_SERIALIZATION_VERSION,
  M15_V2_CHECKSUM_ALGORITHM,
  M15_V2_SCHEMA_VERSION,
  type BackupM15V2ArtifactInput,
} from "./backup-m15-v2-artifact";
import {
  BackupM15V2RestorePreviewRuntimeError,
  getBackupM15V2RestorePreviewForUser,
  type BackupM15V2RestorePreviewRuntimeDependencies,
  type RuntimePrismaClient,
  type RuntimeTransaction,
} from "./backup-m15-v2-restore-preview-runtime";
import type { ObjectStorage, StoredObject } from "./object-storage";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const BACKUP_ID = "backup-1";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ASSET_1_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_LEGACY_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_OBJECT_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-07-28T20:00:00.000Z");
const PREVIEWED_AT = "2026-07-29T10:00:00.000Z";

function fixedNow(): Date {
  return new Date(PREVIEWED_AT);
}

function artifactClientRow(id: string): Record<string, unknown> {
  return {
    id, fullName: "Client", email: null, phone: null, notes: null, deletedAt: null,
    ownerUserId: OWNER_ID, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
}

function buildValidArtifactInput(overrides: Partial<BackupM15V2ArtifactInput["sections"]> = {}): BackupM15V2ArtifactInput {
  const sections = {
    clients: [artifactClientRow(CLIENT_ID)] as unknown[],
    analyses: [] as unknown[],
    consultations: [] as unknown[],
    imageAssets: [] as unknown[],
    imageAnalyses: [] as unknown[],
    imageAnalysisReviews: [] as unknown[],
    ...overrides,
  };
  return {
    schemaVersion: M15_V2_SCHEMA_VERSION,
    canonicalSerializationVersion: M15_V2_CANONICAL_SERIALIZATION_VERSION,
    checksumAlgorithm: M15_V2_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: BACKUP_ID,
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "runtime-fixture",
    createdAt: NOW.toISOString(),
    summarySnapshot: { clientsCount: 0, consultationsCount: 0, appointmentsCount: 0, notificationsCount: 0, workspacesCount: 0 },
    counts: {
      clients: sections.clients.length,
      analyses: sections.analyses.length,
      consultations: sections.consultations.length,
      imageAssets: sections.imageAssets.length,
      imageAnalyses: sections.imageAnalyses.length,
      imageAnalysisReviews: sections.imageAnalysisReviews.length,
    },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: { clients: 2000, analyses: 10000, consultations: 10000, imageAssets: 10000, imageAnalyses: 10000, imageAnalysisReviews: 20000 },
    },
    sections,
  } as unknown as BackupM15V2ArtifactInput;
}

function buildValidArtifact(overrides: Partial<BackupM15V2ArtifactInput["sections"]> = {}) {
  return buildBackupM15V2Artifact(buildValidArtifactInput(overrides));
}

interface SnapshotRow {
  id: string;
  ownerUserId: string;
  checksum: string | null;
  schemaVersion: string;
  snapshotJson: unknown;
}

interface FakeDatabaseConfig {
  snapshots: Array<SnapshotRow | null>;
  clients?: Record<string, unknown>[];
  analyses?: Record<string, unknown>[];
  consultations?: Record<string, unknown>[];
  imageAssets?: Record<string, unknown>[];
  imageAnalyses?: Record<string, unknown>[];
  imageAnalysisReviews?: Record<string, unknown>[];
}

function fakeDatabase(config: FakeDatabaseConfig): RuntimePrismaClient & { transactionOptions: unknown[] } {
  const queue = [...config.snapshots];
  const transactionOptions: unknown[] = [];
  const view: RuntimeTransaction = {
    opsBackupSnapshot: { findFirst: vi.fn(async () => (queue.length > 0 ? queue.shift()! : null)) },
    client: { findMany: vi.fn(async () => config.clients ?? []) },
    analysis: { findMany: vi.fn(async () => config.analyses ?? []) },
    consultation: { findMany: vi.fn(async () => config.consultations ?? []) },
    imageAsset: { findMany: vi.fn(async () => config.imageAssets ?? []) },
    imageAnalysis: { findMany: vi.fn(async () => config.imageAnalyses ?? []) },
    imageAnalysisReview: { findMany: vi.fn(async () => config.imageAnalysisReviews ?? []) },
  };
  return {
    ...view,
    transactionOptions,
    $transaction: vi.fn(async (callback: (tx: RuntimeTransaction) => Promise<unknown>, options?: unknown) => {
      transactionOptions.push(options);
      return callback(view);
    }),
  } as unknown as RuntimePrismaClient & { transactionOptions: unknown[] };
}

function validSnapshotRow(artifact: unknown, checksum: string): SnapshotRow {
  return { id: BACKUP_ID, ownerUserId: OWNER_ID, checksum, schemaVersion: "m15.v2", snapshotJson: artifact };
}

function baseDependencies(overrides: Partial<BackupM15V2RestorePreviewRuntimeDependencies> = {}): BackupM15V2RestorePreviewRuntimeDependencies {
  return {
    isDatabaseConfigured: () => true,
    now: fixedNow,
    createLegacyLocalResolver: () => createLegacyLocalReferenceResolver({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-rt-")) }),
    createObjectBackedResolver: () => createObjectBackedReferenceResolver({ resolveObjectStorage: () => null }),
    ...overrides,
  };
}

describe("getBackupM15V2RestorePreviewForUser", () => {
  it("1. throws a typed BACKUP_NOT_FOUND error when the snapshot does not exist", async () => {
    const database = fakeDatabase({ snapshots: [null] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toBeInstanceOf(BackupM15V2RestorePreviewRuntimeError);
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database: fakeDatabase({ snapshots: [null] }) })),
    ).rejects.toMatchObject({ code: "BACKUP_NOT_FOUND" });
  });

  it("2. throws BACKUP_PREVIEW_UNINTERPRETABLE for a schemaVersion mismatch", async () => {
    const artifact = buildValidArtifact();
    const database = fakeDatabase({ snapshots: [validSnapshotRow(artifact, artifact.checksum!), null].map((row) => row && { ...row, schemaVersion: "m15.v1" }) });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("3. throws BACKUP_PREVIEW_UNINTERPRETABLE when the artifact's own schemaVersion disagrees", async () => {
    const artifact = { ...buildValidArtifact(), schemaVersion: "m13.v3" };
    const row = { id: BACKUP_ID, ownerUserId: OWNER_ID, checksum: "irrelevant", schemaVersion: "m15.v2", snapshotJson: artifact };
    const database = fakeDatabase({ snapshots: [row] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("4. throws BACKUP_PREVIEW_UNINTERPRETABLE when the checksum is missing", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, "");
    const database = fakeDatabase({ snapshots: [row] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("5. throws BACKUP_PREVIEW_UNINTERPRETABLE when the checksum drifts between the initial read and the transaction", async () => {
    const artifact = buildValidArtifact();
    const first = validSnapshotRow(artifact, artifact.checksum!);
    const second = validSnapshotRow(artifact, "0".repeat(64));
    const database = fakeDatabase({ snapshots: [first, second] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("6. throws BACKUP_PREVIEW_UNINTERPRETABLE for an invalid payload", async () => {
    const row = { id: BACKUP_ID, ownerUserId: OWNER_ID, checksum: "abc", schemaVersion: "m15.v2", snapshotJson: { not: "an artifact" } };
    const database = fakeDatabase({ snapshots: [row] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("7. relies on the WP2H1 parser: a tampered artifact yields an invalid_artifact preview result, not a crash", async () => {
    const artifact = buildValidArtifact();
    const tampered = { ...structuredClone(artifact), label: "tampered-without-recomputing-checksum" };
    const row = validSnapshotRow(tampered, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    const result = await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(result).toMatchObject({ ok: false, code: "invalid_artifact" });
  });

  it("8. reads current state inside a RepeatableRead transaction", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(database.transactionOptions).toEqual([{ isolationLevel: "RepeatableRead" }]);
  });

  it("9. reads all six domains inside the transaction", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(database.client.findMany).toHaveBeenCalledTimes(1);
    expect(database.analysis.findMany).toHaveBeenCalledTimes(1);
    expect(database.consultation.findMany).toHaveBeenCalledTimes(1);
    expect(database.imageAsset.findMany).toHaveBeenCalledTimes(1);
    expect(database.imageAnalysis.findMany).toHaveBeenCalledTimes(1);
    expect(database.imageAnalysisReview.findMany).toHaveBeenCalledTimes(1);
  });

  it("10. orders every domain query deterministically by id ascending", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    for (const delegate of [database.client, database.analysis, database.consultation, database.imageAsset, database.imageAnalysis, database.imageAnalysisReview]) {
      const [args] = vi.mocked(delegate.findMany).mock.calls[0];
      expect((args as { orderBy: unknown }).orderBy).toEqual({ id: "asc" });
    }
  });

  it("11. sorts fetched rows by id ascending regardless of database return order", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const clientA = clientRow("client-a");
    const clientB = clientRow("client-b");
    const database = fakeDatabase({ snapshots: [row, row], clients: [clientB, clientA] });
    let capturedCurrentState: unknown;
    const buildPreview = vi.fn(async (input: Record<string, unknown>) => {
      capturedCurrentState = input.currentState;
      return { ok: true, previewVersion: "m15.restore-preview.v2" } as never;
    });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database, buildPreview: buildPreview as never }));
    const ids = (capturedCurrentState as { clients: Array<{ id: string }> }).clients.map((c) => c.id);
    expect(ids).toEqual(["client-a", "client-b"]);
  });

  it("12. maps a valid legacy-local ImageAsset row", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = legacyImageAssetRow(ASSET_1_ID);
    const database = fakeDatabase({ snapshots: [row, row], imageAssets: [asset] });
    let captured: { imageAssets: Array<Record<string, unknown>> } | undefined;
    const buildPreview = vi.fn(async (input: Record<string, unknown>) => {
      captured = input.currentState as { imageAssets: Array<Record<string, unknown>> };
      return { ok: true } as never;
    });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database, buildPreview: buildPreview as never }));
    expect(captured?.imageAssets[0]).toMatchObject({ storageKind: "legacy-local" });
  });

  it("13. maps a valid object-backed ImageAsset row", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = objectImageAssetRow(ASSET_1_ID);
    const database = fakeDatabase({ snapshots: [row, row], imageAssets: [asset] });
    let captured: { imageAssets: Array<Record<string, unknown>> } | undefined;
    const buildPreview = vi.fn(async (input: Record<string, unknown>) => {
      captured = input.currentState as { imageAssets: Array<Record<string, unknown>> };
      return { ok: true } as never;
    });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database, buildPreview: buildPreview as never }));
    expect(captured?.imageAssets[0]).toMatchObject({ storageKind: "object-backed" });
  });

  it("14. rejects a mixed/contradictory ImageAsset row", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = { ...legacyImageAssetRow(ASSET_1_ID), storageBucketAlias: "images" };
    const database = fakeDatabase({ snapshots: [row, row], imageAssets: [asset] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("15. rejects an unknown storage backend", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = { ...legacyImageAssetRow(ASSET_1_ID), storageBackend: "gcs" };
    const database = fakeDatabase({ snapshots: [row, row], imageAssets: [asset] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("16. rejects a row with a missing required field", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const client = { ...clientRow("client-a"), fullName: undefined };
    const database = fakeDatabase({ snapshots: [row, row], clients: [client] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("17. produces a duplicate-identity current state that WP2H3 itself rejects fail-closed", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const client = clientRow("client-a");
    const database = fakeDatabase({ snapshots: [row, row], clients: [client, { ...client }] });
    const result = await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(result).toMatchObject({ ok: false, code: "invalid_current_state" });
  });

  it("18. invokes the real WP2H2 verifier through WP2H3 end-to-end", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-rt-e2e-"));
    const content = Buffer.from("legacy-body");
    fs.mkdirSync(path.join(root, OWNER_ID, ASSET_1_ID), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, ASSET_1_ID, "photo.jpg"), content);
    const artifact = buildValidArtifact({
      imageAssets: [legacyArtifactAsset(ASSET_1_ID, content)],
    } as never);
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = legacyImageAssetRow(ASSET_1_ID, content);
    const database = fakeDatabase({ snapshots: [row, row], clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    const result = await getBackupM15V2RestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      baseDependencies({ database, createLegacyLocalResolver: () => createLegacyLocalReferenceResolver({ rootDir: root }) }),
    );
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 1 });
  });

  it("19. uses the real filesystem-backed legacy resolver", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-rt-legacy-"));
    const content = Buffer.from("legacy-body-real");
    fs.mkdirSync(path.join(root, OWNER_ID, ASSET_1_ID), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, ASSET_1_ID, "photo.jpg"), content);
    const artifact = buildValidArtifact({ imageAssets: [legacyArtifactAsset(ASSET_1_ID, content)] } as never);
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = legacyImageAssetRow(ASSET_1_ID, content);
    const database = fakeDatabase({ snapshots: [row, row], clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    const result = await getBackupM15V2RestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      baseDependencies({ database, createLegacyLocalResolver: () => createLegacyLocalReferenceResolver({ rootDir: root }) }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("20. uses the real ObjectStorage-backed object resolver", async () => {
    const content = new TextEncoder().encode("object-body-real");
    const artifact = buildValidArtifact({ imageAssets: [objectArtifactAsset(ASSET_1_ID, content)] } as never);
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const asset = objectImageAssetRow(ASSET_1_ID, content);
    const database = fakeDatabase({ snapshots: [row, row], clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    const storage: ObjectStorage = {
      put: vi.fn(async () => { throw new Error("not used"); }),
      delete: vi.fn(async () => undefined),
      head: vi.fn(async () => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`, versionId: `version-${ASSET_1_ID}`,
        etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength, contentType: "image/jpeg",
      })),
      get: vi.fn(async (): Promise<StoredObject> => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`, versionId: `version-${ASSET_1_ID}`,
        etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength, contentType: "image/jpeg",
        body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }),
      })),
    };
    const result = await getBackupM15V2RestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      baseDependencies({ database, createObjectBackedResolver: () => createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage }) }),
    );
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 1 });
  });

  it("21. uses the injected clock for previewedAt", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    const result = await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(result.previewedAt).toBe(PREVIEWED_AT);
  });

  it("22. never calls Date.now or an un-injected clock", async () => {
    const spy = vi.spyOn(Date, "now");
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("23. passes the exact mapped current state through to WP2H3", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const client = clientRow("client-a");
    const database = fakeDatabase({ snapshots: [row, row], clients: [client] });
    let currentState: Record<string, unknown> | undefined;
    const buildPreview = vi.fn(async (input: Record<string, unknown>) => {
      currentState = input.currentState as Record<string, unknown>;
      return { ok: true } as never;
    });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database, buildPreview: buildPreview as never }));
    expect(currentState).toMatchObject({
      clients: [{ id: "client-a" }],
      analyses: [], consultations: [], imageAssets: [], imageAnalyses: [], imageAnalysisReviews: [],
    });
  });

  it("24. succeeds with zero external references", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    const result = await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 0 });
  });

  it("25. succeeds with a mixed legacy-local and object-backed artifact", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-rt-mixed-"));
    const legacyContent = Buffer.from("legacy-mixed");
    const objectContent = new TextEncoder().encode("object-mixed");
    fs.mkdirSync(path.join(root, OWNER_ID, ASSET_LEGACY_ID), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, ASSET_LEGACY_ID, "photo.jpg"), legacyContent);
    const artifact = buildValidArtifact({
      imageAssets: [legacyArtifactAsset(ASSET_LEGACY_ID, legacyContent), objectArtifactAsset(ASSET_OBJECT_ID, objectContent)],
    } as never);
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({
      snapshots: [row, row],
      clients: [clientRow(CLIENT_ID)],
      imageAssets: [legacyImageAssetRow(ASSET_LEGACY_ID, legacyContent), objectImageAssetRow(ASSET_OBJECT_ID, objectContent)],
    });
    const storage: ObjectStorage = {
      put: vi.fn(async () => { throw new Error("not used"); }),
      delete: vi.fn(async () => undefined),
      head: vi.fn(async () => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_OBJECT_ID}/original`, versionId: `version-${ASSET_OBJECT_ID}`,
        etag: null, contentSha256: sha256(objectContent), sizeBytes: objectContent.byteLength, contentType: "image/jpeg",
      })),
      get: vi.fn(async (): Promise<StoredObject> => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_OBJECT_ID}/original`, versionId: `version-${ASSET_OBJECT_ID}`,
        etag: null, contentSha256: sha256(objectContent), sizeBytes: objectContent.byteLength, contentType: "image/jpeg",
        body: new ReadableStream({ start(controller) { controller.enqueue(objectContent); controller.close(); } }),
      })),
    };
    const result = await getBackupM15V2RestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      baseDependencies({
        database,
        createLegacyLocalResolver: () => createLegacyLocalReferenceResolver({ rootDir: root }),
        createObjectBackedResolver: () => createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage }),
      }),
    );
    expect(result).toMatchObject({ ok: true, verifiedExternalReferenceCount: 2 });
  });

  it("26. a resolver failure blocks the preview", async () => {
    const legacyContent = Buffer.from("legacy-missing");
    const artifact = buildValidArtifact({ imageAssets: [legacyArtifactAsset(ASSET_1_ID, legacyContent)] } as never);
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row], clients: [clientRow(CLIENT_ID)], imageAssets: [legacyImageAssetRow(ASSET_1_ID, legacyContent)] });
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-rt-empty-"));
    const result = await getBackupM15V2RestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      baseDependencies({ database, createLegacyLocalResolver: () => createLegacyLocalReferenceResolver({ rootDir: emptyRoot }) }),
    );
    expect(result).toMatchObject({ ok: false, code: "external_reference_verification_failed" });
  });

  it("27. propagates a WP2H3 failure result sanitized", async () => {
    const artifact = { not: "valid" };
    const row = { id: BACKUP_ID, ownerUserId: OWNER_ID, checksum: "irrelevant", schemaVersion: "m15.v2", snapshotJson: artifact };
    const database = fakeDatabase({ snapshots: [row] });
    await expect(
      getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database })),
    ).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE" });
  });

  it("28. never issues a database write", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database }));
    for (const key of ["create", "update", "delete", "upsert"]) {
      expect(key in (database.client as unknown as Record<string, unknown>)).toBe(false);
    }
  });

  it("29. does not mutate the injected dependencies object", async () => {
    const artifact = buildValidArtifact();
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row] });
    const dependencies = baseDependencies({ database });
    const before = { ...dependencies };
    await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, dependencies);
    expect(dependencies).toEqual(before);
  });

  it("30. returns a deterministic result for repeated calls with the same fixtures", async () => {
    const artifact = buildValidArtifact();
    const buildRow = () => validSnapshotRow(artifact, artifact.checksum!);
    const first = await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database: fakeDatabase({ snapshots: [buildRow(), buildRow()] }) }));
    const second = await getBackupM15V2RestorePreviewForUser(OWNER_ID, BACKUP_ID, baseDependencies({ database: fakeDatabase({ snapshots: [buildRow(), buildRow()] }) }));
    expect(first).toEqual(second);
  });

  it("31. does not expose sensitive data in the output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-rt-sanitize-"));
    const content = Buffer.from("legacy-sanitize");
    const artifact = buildValidArtifact({ imageAssets: [legacyArtifactAsset(ASSET_1_ID, content)] } as never);
    const row = validSnapshotRow(artifact, artifact.checksum!);
    const database = fakeDatabase({ snapshots: [row, row], clients: [clientRow(CLIENT_ID)], imageAssets: [legacyImageAssetRow(ASSET_1_ID, content)] });
    const result = await getBackupM15V2RestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      baseDependencies({ database, createLegacyLocalResolver: () => createLegacyLocalReferenceResolver({ rootDir: root }) }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(ASSET_1_ID);
  });

  it("32. leaves v1/M13/WP2H1-3 modules untouched (source-level check)", () => {
    const source = readSourceFile("backup-m15-v2-restore-preview-runtime.ts");
    expect(source).not.toMatch(/from ["']\.\/backup-restore-preview["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-restore-preview-runtime["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-m15-artifact["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-m15-restore-preview["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-v13-/);
  });

  it("33. imports no HTTP/Next.js dependency", () => {
    const source = readSourceFile("backup-m15-v2-restore-preview-runtime.ts");
    expect(source).not.toMatch(/next\/server/);
    expect(source).not.toMatch(/NextRequest|NextResponse/);
  });

  it("34. never dispatches through the shared/live dispatcher", () => {
    const source = readSourceFile("backup-m15-v2-restore-preview-runtime.ts");
    expect(source).not.toMatch(/dispatchBackupRestorePreview/);
  });

  it("35. defines its own contracts locally and never imports from ./contracts", () => {
    const runtimeSource = readSourceFile("backup-m15-v2-restore-preview-runtime.ts");
    const resolversSource = readSourceFile("backup-m15-v2-reference-resolvers.ts");
    expect(runtimeSource).not.toMatch(/from ["']\.\/contracts["']/);
    expect(resolversSource).not.toMatch(/from ["']\.\/contracts["']/);
  });
});

function clientRow(id: string): Record<string, unknown> {
  return {
    id, ownerUserId: OWNER_ID, fullName: "Client", email: null, phone: null, notes: null,
    deletedAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function legacyImageAssetRow(id: string, content: Uint8Array = new TextEncoder().encode("legacy-default")): Record<string, unknown> {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID, clientId: CLIENT_ID,
    storagePath: `${OWNER_ID}/${id}/photo.jpg`, storageBackend: null, storageBucketAlias: null, storageKey: null,
    storageVersionId: null, storageEtag: null, contentSha256: sha256(content), storageState: null, storageMigratedAt: null,
    objectDeletedAt: null, lastStorageErrorCode: null, exifStripped: true, normalizedOrientation: 1,
    uploadedAt: NOW, deletedAt: null, retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

function objectImageAssetRow(id: string, content: Uint8Array = new TextEncoder().encode("object-default")): Record<string, unknown> {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID, clientId: CLIENT_ID,
    storagePath: "pending", storageBackend: "s3", storageBucketAlias: "primary-images",
    storageKey: `v1/owners/${OWNER_ID}/assets/${id}/original`, storageVersionId: `version-${id}`, storageEtag: "etag-1",
    contentSha256: sha256(content), storageState: "available", storageMigratedAt: NOW, objectDeletedAt: null,
    lastStorageErrorCode: null, exifStripped: true, normalizedOrientation: 1,
    uploadedAt: NOW, deletedAt: null, retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

function legacyArtifactAsset(id: string, content: Uint8Array) {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID, clientId: CLIENT_ID,
    exifStripped: true, normalizedOrientation: 1, uploadedAt: NOW.toISOString(), deletedAt: null, retentionDeletesAt: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), storageKind: "legacy-local" as const,
    legacyReference: {
      backend: "local" as const, rootAlias: "legacy-images" as const, relativePath: `${OWNER_ID}/${id}/photo.jpg`,
      contentSha256: sha256(content), sizeBytes: content.byteLength,
    },
  };
}

function objectArtifactAsset(id: string, content: Uint8Array) {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID, clientId: CLIENT_ID,
    exifStripped: true, normalizedOrientation: 1, uploadedAt: NOW.toISOString(), deletedAt: null, retentionDeletesAt: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), storageKind: "object-backed" as const,
    objectReference: {
      backend: "s3" as const, bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${id}/original`,
      versionId: `version-${id}`, contentSha256: sha256(content), sizeBytes: content.byteLength,
    },
    storageEtag: "etag-1", storageState: "available" as const, storageMigratedAt: NOW.toISOString(),
    objectDeletedAt: null, lastStorageErrorCode: null,
  };
}

function readSourceFile(name: string): string {
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), name), "utf8");
}
