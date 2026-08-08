import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it, vi } from "vitest";

import {
  M15_V2_MAX_ROWS_PER_SECTION,
  parseBackupM15V2Artifact,
} from "./backup-m15-v2-artifact";
import { createLegacyLocalReferenceResolver, createObjectBackedReferenceResolver } from "./backup-m15-v2-reference-resolvers";
import {
  BackupM15V2SnapshotPersistenceError,
  createBackupM15V2Snapshot,
  verifyBackupM15V2Snapshot,
  type BackupM15V2SnapshotPersistenceDatabase,
  type BackupM15V2SnapshotPersistenceTransaction,
  type CreateBackupM15V2SnapshotInput,
  type PersistedBackupM15V2SnapshotRow,
} from "./backup-m15-v2-snapshot-persistence";
import type { ObjectStorage, StoredObject } from "./object-storage";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "99999999-9999-4999-8999-999999999999";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const ASSET_1_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_2_ID = "33333333-3333-4333-8333-333333333333";
const BACKUP_ID = "backup-generated-1";
const NOW = new Date("2026-07-30T12:00:00.000Z");
const CREATED_AT = "2026-07-30T12:00:00.000Z";
const VERIFIED_AT = "2026-07-30T13:00:00.000Z";

function fixedGenerateId(): string {
  return BACKUP_ID;
}

function fixedNow(): Date {
  return new Date(NOW);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function clientRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, ownerUserId: OWNER_ID, fullName: "Client", email: null, phone: null, notes: null,
    deletedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function analysisRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, clientId: CLIENT_ID, ownerUserId: OWNER_ID, goal: "cut", hairType: "straight", density: "medium",
    porosity: "medium", phase: "final", clarificationRound: 0, confidenceScore: 0.9, uncertaintyReasons: [],
    followUpQuestions: [], recommendations: [], safetyNotes: [], faceShape: null, headShape: null, hairLength: null,
    hairTexture: null, hairCondition: null, growthPattern: null, targetShape: null, technicalCutPlan: {},
    clarificationAnswers: [], imageAssetId: null, imageAnalysisId: null, m8DraftCreatedAt: null, m8FinalizedAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function consultationRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, ownerUserId: OWNER_ID, clientId: CLIENT_ID, analysisId: `${id}-analysis`, summary: "summary",
    nextSteps: ["next"], createdAt: NOW, ...overrides,
  };
}

function legacyAssetRow(id: string, content: Uint8Array, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID,
    clientId: CLIENT_ID, storagePath: `${OWNER_ID}/${id}/photo.jpg`, storageBackend: null, storageBucketAlias: null,
    storageKey: null, storageVersionId: null, storageEtag: null, contentSha256: sha256(content), storageState: null,
    storageMigratedAt: null, objectDeletedAt: null, lastStorageErrorCode: null, exifStripped: true,
    normalizedOrientation: 1, uploadedAt: NOW, deletedAt: null, retentionDeletesAt: null, createdAt: NOW,
    updatedAt: NOW, ...overrides,
  };
}

function objectAssetRow(id: string, content: Uint8Array, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: content.byteLength, ownerUserId: OWNER_ID,
    clientId: CLIENT_ID, storagePath: "pending", storageBackend: "s3", storageBucketAlias: "primary-images",
    storageKey: `v1/owners/${OWNER_ID}/assets/${id}/original`, storageVersionId: `version-${id}`, storageEtag: "etag-1",
    contentSha256: sha256(content), storageState: "available", storageMigratedAt: NOW, objectDeletedAt: null,
    lastStorageErrorCode: null, exifStripped: true, normalizedOrientation: 1, uploadedAt: NOW, deletedAt: null,
    retentionDeletesAt: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

interface FakeDbConfig {
  clients?: Array<Record<string, unknown>>;
  analyses?: Array<Record<string, unknown>>;
  consultations?: Array<Record<string, unknown>>;
  imageAssets?: Array<Record<string, unknown>>;
  imageAnalyses?: Array<Record<string, unknown>>;
  imageAnalysisReviews?: Array<Record<string, unknown>>;
  countOverrides?: Partial<Record<"clients" | "analyses" | "consultations" | "imageAssets" | "imageAnalyses" | "imageAnalysisReviews" | "appointments" | "notifications", number>>;
  createImpl?: (args: { data: Record<string, unknown> }) => Promise<PersistedBackupM15V2SnapshotRow>;
  snapshotRow?: PersistedBackupM15V2SnapshotRow | null;
}

function fakeDatabase(config: FakeDbConfig = {}): BackupM15V2SnapshotPersistenceDatabase & {
  transactionOptions: unknown[];
  createCalls: Array<{ data: Record<string, unknown> }>;
} {
  const transactionOptions: unknown[] = [];
  const createCalls: Array<{ data: Record<string, unknown> }> = [];
  const defaultCreate = async (args: { data: Record<string, unknown> }): Promise<PersistedBackupM15V2SnapshotRow> => {
    createCalls.push(args);
    return {
      id: args.data.id as string,
      ownerUserId: args.data.ownerUserId as string,
      createdByUserId: args.data.createdByUserId as string,
      label: args.data.label as string,
      snapshotJson: args.data.snapshotJson,
      checksum: args.data.checksum as string,
      checksumAlgorithm: args.data.checksumAlgorithm as string,
      schemaVersion: args.data.schemaVersion as string,
      createdAt: NOW,
    };
  };

  const counts = {
    clients: config.countOverrides?.clients ?? (config.clients ?? []).length,
    analyses: config.countOverrides?.analyses ?? (config.analyses ?? []).length,
    consultations: config.countOverrides?.consultations ?? (config.consultations ?? []).length,
    imageAssets: config.countOverrides?.imageAssets ?? (config.imageAssets ?? []).length,
    imageAnalyses: config.countOverrides?.imageAnalyses ?? (config.imageAnalyses ?? []).length,
    imageAnalysisReviews: config.countOverrides?.imageAnalysisReviews ?? (config.imageAnalysisReviews ?? []).length,
    appointments: config.countOverrides?.appointments ?? 0,
    notifications: config.countOverrides?.notifications ?? 0,
  };

  const view: BackupM15V2SnapshotPersistenceTransaction = {
    opsBackupSnapshot: {
      findFirst: vi.fn(async () => config.snapshotRow ?? null),
      create: vi.fn(config.createImpl ?? defaultCreate),
    },
    client: { count: vi.fn(async () => counts.clients), findMany: vi.fn(async () => config.clients ?? []) },
    analysis: { count: vi.fn(async () => counts.analyses), findMany: vi.fn(async () => config.analyses ?? []) },
    consultation: { count: vi.fn(async () => counts.consultations), findMany: vi.fn(async () => config.consultations ?? []) },
    imageAsset: { count: vi.fn(async () => counts.imageAssets), findMany: vi.fn(async () => config.imageAssets ?? []) },
    imageAnalysis: { count: vi.fn(async () => counts.imageAnalyses), findMany: vi.fn(async () => config.imageAnalyses ?? []) },
    imageAnalysisReview: {
      count: vi.fn(async () => counts.imageAnalysisReviews),
      findMany: vi.fn(async () => config.imageAnalysisReviews ?? []),
    },
    appointment: { count: vi.fn(async () => counts.appointments) },
    notification: { count: vi.fn(async () => counts.notifications) },
  };

  return {
    ...view,
    transactionOptions,
    createCalls,
    $transaction: vi.fn(async (callback: (tx: BackupM15V2SnapshotPersistenceTransaction) => Promise<unknown>, options?: unknown) => {
      transactionOptions.push(options);
      return callback(view);
    }),
  } as unknown as BackupM15V2SnapshotPersistenceDatabase & { transactionOptions: unknown[]; createCalls: Array<{ data: Record<string, unknown> }> };
}

function baseCreateInput(overrides: Partial<CreateBackupM15V2SnapshotInput> = {}): CreateBackupM15V2SnapshotInput {
  return {
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "snapshot-fixture",
    database: fakeDatabase(),
    generateId: fixedGenerateId,
    now: fixedNow,
    ...overrides,
  };
}

describe("createBackupM15V2Snapshot", () => {
  it("1. creates a valid snapshot with no images", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result).toMatchObject({ id: BACKUP_ID, ownerUserId: OWNER_ID, schemaVersion: "m15.v2" });
  });

  it("1a. reports real appointments and notifications counts, not hardcoded zeros (M33 GO-2)", async () => {
    const database = fakeDatabase({
      clients: [clientRow(CLIENT_ID)],
      countOverrides: { appointments: 3, notifications: 5 },
    });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.snapshot).toMatchObject({ appointmentsCount: 3, notificationsCount: 5 });
    expect(database.appointment.count).toHaveBeenCalledWith({ where: { ownerUserId: OWNER_ID } });
    expect(database.notification.count).toHaveBeenCalledWith({ where: { ownerUserId: OWNER_ID } });
  });

  it("1b. reports workspacesCount as 0, matching the existing m13.v3 production contract exactly (no in-memory dependency introduced)", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.snapshot.workspacesCount).toBe(0);
  });

  it("1c. includes clientsCount and consultationsCount in the returned snapshot summary", async () => {
    const database = fakeDatabase({
      clients: [clientRow(CLIENT_ID), clientRow("client-2")],
      consultations: [consultationRow("consultation-1")],
    });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.snapshot).toMatchObject({ clientsCount: 2, consultationsCount: 1 });
  });

  it("2. creates a valid snapshot with a legacy-local image asset", async () => {
    const content = new TextEncoder().encode("legacy-body");
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [legacyAssetRow(ASSET_1_ID, content)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.schemaVersion).toBe("m15.v2");
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.sections.imageAssets[0]).toMatchObject({ storageKind: "legacy-local" });
  });

  it("3. creates a valid snapshot with an object-backed image asset", async () => {
    const content = new TextEncoder().encode("object-body");
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [objectAssetRow(ASSET_1_ID, content)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.schemaVersion).toBe("m15.v2");
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.sections.imageAssets[0]).toMatchObject({ storageKind: "object-backed" });
  });

  it("4. creates a valid mixed snapshot", async () => {
    const legacyContent = new TextEncoder().encode("legacy-mixed");
    const objectContent = new TextEncoder().encode("object-mixed");
    const analysis = analysisRow("analysis-1");
    const database = fakeDatabase({
      clients: [clientRow(CLIENT_ID)],
      analyses: [analysis],
      consultations: [consultationRow("consultation-1", { analysisId: "analysis-1" })],
      imageAssets: [legacyAssetRow(ASSET_1_ID, legacyContent), objectAssetRow(ASSET_2_ID, objectContent)],
    });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.schemaVersion).toBe("m15.v2");
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.sections.imageAssets).toHaveLength(2);
    expect(artifact.sections.analyses).toHaveLength(1);
    expect(artifact.sections.consultations).toHaveLength(1);
  });

  it("5. reads all six domains", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    for (const delegate of [database.client, database.analysis, database.consultation, database.imageAsset, database.imageAnalysis, database.imageAnalysisReview]) {
      expect(delegate.count).toHaveBeenCalledTimes(1);
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
    }
  });

  it("6. performs the read and the insert inside the same transaction", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.createCalls).toHaveLength(1);
  });

  it("7. uses RepeatableRead isolation", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(database.transactionOptions).toEqual([{ isolationLevel: "RepeatableRead" }]);
  });

  it("8. scopes every query to the owner", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database, ownerUserId: OWNER_ID }));
    for (const delegate of [database.client, database.analysis, database.consultation, database.imageAsset]) {
      const [args] = vi.mocked(delegate.count).mock.calls[0];
      expect((args as { where: { ownerUserId: string } }).where.ownerUserId).toBe(OWNER_ID);
    }
  });

  it("9. orders every domain query explicitly by id ascending", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    for (const delegate of [database.client, database.analysis, database.consultation, database.imageAsset, database.imageAnalysis, database.imageAnalysisReview]) {
      const [args] = vi.mocked(delegate.findMany).mock.calls[0];
      expect((args as { orderBy: unknown }).orderBy).toEqual({ id: "asc" });
    }
  });

  it("10. re-sorts rows lexically regardless of database return order", async () => {
    const clientA = clientRow("client-a");
    const clientB = clientRow("client-b");
    const database = fakeDatabase({ clients: [clientB, clientA] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.sections.clients.map((c) => c.id)).toEqual(["client-a", "client-b"]);
  });

  it("11. uses a stable id tie-breaker for identical timestamps", async () => {
    const clientA = clientRow("client-a", { createdAt: NOW, updatedAt: NOW });
    const clientB = clientRow("client-b", { createdAt: NOW, updatedAt: NOW });
    const database = fakeDatabase({ clients: [clientB, clientA] });
    const first = await createBackupM15V2Snapshot(baseCreateInput({ database: fakeDatabase({ clients: [clientB, clientA] }) }));
    const second = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(first.checksum).toBe(second.checksum);
  });

  it("12. relies on the WP2H1 builder as the sole construction authority", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = database.createCalls[0].data.snapshotJson as Record<string, unknown>;
    expect(() => parseBackupM15V2Artifact(artifact)).not.toThrow();
  });

  it("13. persists a checksum matching the constructed artifact exactly", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(result.checksum).toBe(artifact.checksum);
  });

  it("14. persists a checksumAlgorithm matching the constructed artifact exactly", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(result.checksumAlgorithm).toBe(artifact.checksumAlgorithm);
  });

  it("15. persists schemaVersion exactly as m15.v2", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(result.schemaVersion).toBe("m15.v2");
    expect(database.createCalls[0].data.schemaVersion).toBe("m15.v2");
  });

  it("16. persists an artifact backupId matching the DB row id", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.backupId).toBe(result.id);
  });

  it("17. persists an artifact ownerUserId matching the requested owner", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.ownerUserId).toBe(result.ownerUserId);
  });

  it("18. uses the injected clock for createdAt", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    const artifact = parseBackupM15V2Artifact(database.createCalls[0].data.snapshotJson);
    expect(artifact.createdAt).toBe(CREATED_AT);
  });

  it("19. uses the injected id generator for backupId", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    const customId = () => "custom-generated-id";
    const result = await createBackupM15V2Snapshot(baseCreateInput({ database, generateId: customId }));
    expect(result.id).toBe("custom-generated-id");
  });

  it("20. never calls Date.now, new Date, or randomUUID implicitly", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const randomUUIDSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(randomUUIDSpy).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
    randomUUIDSpy.mockRestore();
  });

  it("21. rejects when the client row count exceeds the approved limit", async () => {
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], countOverrides: { clients: M15_V2_MAX_ROWS_PER_SECTION.clients + 1 } });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "ROW_LIMIT_EXCEEDED" });
    expect(database.createCalls).toHaveLength(0);
  });

  it("22. rejects when constructed section bytes would exceed the approved limit", async () => {
    const hugeNotes = "x".repeat(3 * 1024 * 1024);
    const clients = Array.from({ length: 50 }, (_, index) => clientRow(`client-${index}`, { notes: hugeNotes }));
    const database = fakeDatabase({ clients });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "ARTIFACT_CONSTRUCTION_FAILED" });
    expect(database.createCalls).toHaveLength(0);
  });

  it("23. rejects when the constructed artifact would exceed the total byte limit", async () => {
    const hugeNotes = "x".repeat(1024 * 1024);
    const clients = Array.from({ length: 10 }, (_, index) => clientRow(`client-${index}`, { notes: hugeNotes }));
    const database = fakeDatabase({ clients, countOverrides: { clients: 10 } });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toBeInstanceOf(BackupM15V2SnapshotPersistenceError);
  });

  it("24. accepts a valid legacy-local image asset", async () => {
    const content = new TextEncoder().encode("legacy-ok");
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [legacyAssetRow(ASSET_1_ID, content)] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).resolves.toBeDefined();
  });

  it("25. accepts a valid object-backed image asset", async () => {
    const content = new TextEncoder().encode("object-ok");
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [objectAssetRow(ASSET_1_ID, content)] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).resolves.toBeDefined();
  });

  it("26. rejects an unknown storage backend", async () => {
    const content = new TextEncoder().encode("legacy-ok");
    const asset = { ...legacyAssetRow(ASSET_1_ID, content), storageBackend: "gcs" };
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "IMAGE_ASSET_INVALID" });
  });

  it("27. rejects mixed legacy and object fields", async () => {
    const content = new TextEncoder().encode("legacy-ok");
    const asset = { ...legacyAssetRow(ASSET_1_ID, content), storageBucketAlias: "images" };
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "IMAGE_ASSET_INVALID" });
  });

  it("28. rejects a missing required field", async () => {
    const content = new TextEncoder().encode("object-ok");
    const asset = { ...objectAssetRow(ASSET_1_ID, content), storageVersionId: null };
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "IMAGE_ASSET_INVALID" });
  });

  it("29. rejects a contradictory lifecycle state", async () => {
    const content = new TextEncoder().encode("object-ok");
    const asset = { ...objectAssetRow(ASSET_1_ID, content), storageState: "available", deletedAt: NOW, retentionDeletesAt: NOW };
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "IMAGE_ASSET_INVALID" });
  });

  it("30. rejects a duplicate row identity (caught by the WP2H1 builder)", async () => {
    const client = clientRow(CLIENT_ID);
    const database = fakeDatabase({ clients: [client, { ...client }], countOverrides: { clients: 2 } });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "ARTIFACT_CONSTRUCTION_FAILED" });
  });

  it("31. does not insert when the builder fails", async () => {
    const database = fakeDatabase({ clients: [{ ...clientRow(CLIENT_ID), fullName: undefined }] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toThrow();
    expect(database.createCalls).toHaveLength(0);
  });

  it("32. does not insert when image asset mapping fails", async () => {
    const content = new TextEncoder().encode("legacy-ok");
    const asset = { ...legacyAssetRow(ASSET_1_ID, content), storageBackend: "unknown" };
    const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets: [asset] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toThrow();
    expect(database.createCalls).toHaveLength(0);
  });

  it("33. propagates an insert failure sanitized", async () => {
    const database = fakeDatabase({
      clients: [clientRow(CLIENT_ID)],
      createImpl: async () => { throw new Error("relation ops_backup_snapshot violates constraint xyz at 10.0.0.5"); },
    });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    try {
      await createBackupM15V2Snapshot(baseCreateInput({ database }));
    } catch (error) {
      expect((error as Error).message).not.toContain("10.0.0.5");
      expect((error as Error).message).not.toContain("constraint xyz");
    }
  });

  it("34. does not produce a partial insert when the transaction fails midway", async () => {
    const database = fakeDatabase({ clients: [{ ...clientRow(CLIENT_ID), fullName: undefined }] });
    await expect(createBackupM15V2Snapshot(baseCreateInput({ database }))).rejects.toThrow();
    expect(database.createCalls).toHaveLength(0);
  });

  it("35. does not mutate the input rows", async () => {
    const client = clientRow(CLIENT_ID);
    const before = structuredClone(client);
    const database = fakeDatabase({ clients: [client] });
    await createBackupM15V2Snapshot(baseCreateInput({ database }));
    expect(client).toEqual(before);
  });

  it("36. returns identical results for an identical fixture", async () => {
    const first = await createBackupM15V2Snapshot(baseCreateInput({ database: fakeDatabase({ clients: [clientRow(CLIENT_ID)] }) }));
    const second = await createBackupM15V2Snapshot(baseCreateInput({ database: fakeDatabase({ clients: [clientRow(CLIENT_ID)] }) }));
    expect(first).toEqual(second);
  });
});

function persistedRow(overrides: Partial<PersistedBackupM15V2SnapshotRow> & { snapshotJson: unknown }): PersistedBackupM15V2SnapshotRow {
  return {
    id: BACKUP_ID,
    ownerUserId: OWNER_ID,
    createdByUserId: OWNER_ID,
    label: "snapshot-fixture",
    checksum: "",
    checksumAlgorithm: "sha256",
    schemaVersion: "m15.v2",
    createdAt: NOW,
    ...overrides,
  };
}

async function buildValidStoredArtifact(imageAssets: Array<Record<string, unknown>> = []) {
  const database = fakeDatabase({ clients: [clientRow(CLIENT_ID)], imageAssets });
  await createBackupM15V2Snapshot(baseCreateInput({ database }));
  return database.createCalls[0].data.snapshotJson as Record<string, unknown> & { checksum: string; checksumAlgorithm: string };
}

function noResolvers() {
  return {
    legacyLocalResolver: createLegacyLocalReferenceResolver({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "wp2h5-empty-")) }),
    objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => null }),
  };
}

describe("verifyBackupM15V2Snapshot", () => {
  it("1. verifies a valid snapshot with zero references", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers(),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 0 });
  });

  it("2. throws SNAPSHOT_NOT_FOUND when the snapshot does not exist", async () => {
    const database = fakeDatabase({ snapshotRow: null });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_NOT_FOUND" });
  });

  it("3. treats another owner's snapshot as not found", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum, ownerUserId: OTHER_OWNER_ID });
    // Owner-scoped fake: simulate the query finding nothing for a mismatched owner.
    const database = fakeDatabase({ snapshotRow: null });
    void row;
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_NOT_FOUND" });
  });

  it("4. rejects a stored snapshot with the wrong schemaVersion", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum, schemaVersion: "m15.v1" });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_SCHEMA_UNSUPPORTED" });
  });

  it("5. rejects an absent payload", async () => {
    const row = persistedRow({ snapshotJson: null, checksum: "a".repeat(64) });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_PAYLOAD_INVALID" });
  });

  it("6. rejects an invalid payload", async () => {
    const row = persistedRow({ snapshotJson: { not: "valid" }, checksum: "a".repeat(64) });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_PAYLOAD_INVALID" });
  });

  it("7. rejects a missing stored checksum", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: "" });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_CHECKSUM_MISMATCH" });
  });

  it("8. rejects a stored checksum that differs from the artifact", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: "0".repeat(64) });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_CHECKSUM_MISMATCH" });
  });

  it("9. rejects a missing stored checksumAlgorithm", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum, checksumAlgorithm: "" });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_CHECKSUM_MISMATCH" });
  });

  it("10. rejects a stored checksumAlgorithm that differs from the artifact", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum, checksumAlgorithm: "sha512" });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_CHECKSUM_MISMATCH" });
  });

  it("11. rejects an artifact backupId mismatch against the DB row", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum, id: "different-row-id" });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: "different-row-id", database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_IDENTITY_MISMATCH" });
  });

  it("12. rejects an artifact ownerUserId mismatch against the requested owner", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OTHER_OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_IDENTITY_MISMATCH" });
  });

  it("13. relies on the WP2H1 parser (tampering is caught)", async () => {
    const artifact = await buildValidStoredArtifact();
    const tampered = { ...structuredClone(artifact), label: "tampered-without-recomputing-checksum" };
    const row = persistedRow({ snapshotJson: tampered, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    await expect(
      verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_PAYLOAD_INVALID" });
  });

  it("14. relies on the WP2H2 verifier (a broken reference fails verification)", async () => {
    const content = new TextEncoder().encode("legacy-body");
    const artifact = await buildValidStoredArtifact([legacyArtifactAssetFixture(ASSET_1_ID, content)]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers(),
    });
    expect(result).toMatchObject({ ok: false, code: "reference_missing" });
  });

  it("15. uses the real filesystem-backed legacy resolver", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h5-legacy-"));
    const content = Buffer.from("legacy-body-real");
    fs.mkdirSync(path.join(root, OWNER_ID, ASSET_1_ID), { recursive: true });
    fs.writeFileSync(path.join(root, OWNER_ID, ASSET_1_ID, "photo.jpg"), content);
    const artifact = await buildValidStoredArtifact([legacyArtifactAssetFixture(ASSET_1_ID, content)]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT,
      legacyLocalResolver: createLegacyLocalReferenceResolver({ rootDir: root }),
      objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => null }),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 1 });
  });

  it("16. uses the real ObjectStorage-backed object resolver", async () => {
    const content = new TextEncoder().encode("object-body-real");
    const artifact = await buildValidStoredArtifact([objectArtifactAssetFixture(ASSET_1_ID, content)]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const storage: ObjectStorage = {
      put: vi.fn(async () => { throw new Error("not used"); }),
      delete: vi.fn(async () => undefined),
      head: vi.fn(async () => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`,
        versionId: `version-${ASSET_1_ID}`, etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength,
        contentType: "image/jpeg",
      })),
      get: vi.fn(async (): Promise<StoredObject> => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`,
        versionId: `version-${ASSET_1_ID}`, etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength,
        contentType: "image/jpeg",
        body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }),
      })),
    };
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT,
      legacyLocalResolver: createLegacyLocalReferenceResolver({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "wp2h5-unused-")) }),
      objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage }),
    });
    expect(result).toMatchObject({ ok: true, verifiedReferenceCount: 1 });
  });

  it("17. verifies against the exact requested object version", async () => {
    const content = new TextEncoder().encode("object-body-versioned");
    const artifact = await buildValidStoredArtifact([objectArtifactAssetFixture(ASSET_1_ID, content, "exact-version-9")]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const storage: ObjectStorage = {
      put: vi.fn(async () => { throw new Error("not used"); }),
      delete: vi.fn(async () => undefined),
      head: vi.fn(async () => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`,
        versionId: "exact-version-9", etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength,
        contentType: "image/jpeg",
      })),
      get: vi.fn(async (): Promise<StoredObject> => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`,
        versionId: "exact-version-9", etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength,
        contentType: "image/jpeg",
        body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }),
      })),
    };
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT,
      legacyLocalResolver: createLegacyLocalReferenceResolver({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "wp2h5-unused-")) }),
      objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage }),
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("18. does not fall back to a latest version", async () => {
    const content = new TextEncoder().encode("object-body-versioned");
    const artifact = await buildValidStoredArtifact([objectArtifactAssetFixture(ASSET_1_ID, content, "exact-version-9")]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const storage: ObjectStorage = {
      put: vi.fn(async () => { throw new Error("not used"); }),
      delete: vi.fn(async () => undefined),
      head: vi.fn(async () => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`,
        versionId: "latest-not-requested", etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength,
        contentType: "image/jpeg",
      })),
      get: vi.fn(async (): Promise<StoredObject> => ({
        bucketAlias: "primary-images", key: `v1/owners/${OWNER_ID}/assets/${ASSET_1_ID}/original`,
        versionId: "latest-not-requested", etag: null, contentSha256: sha256(content), sizeBytes: content.byteLength,
        contentType: "image/jpeg",
        body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }),
      })),
    };
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT,
      legacyLocalResolver: createLegacyLocalReferenceResolver({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "wp2h5-unused-")) }),
      objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage }),
    });
    expect(result).toMatchObject({ ok: false, code: "version_mismatch" });
  });

  it("19. sanitizes a verifier failure", async () => {
    const content = new TextEncoder().encode("legacy-body");
    const artifact = await buildValidStoredArtifact([legacyArtifactAssetFixture(ASSET_1_ID, content)]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers(),
    });
    expect(JSON.stringify(result)).not.toContain(ASSET_1_ID);
  });

  it("20. sanitizes a provider failure", async () => {
    const content = new TextEncoder().encode("legacy-body");
    const artifact = await buildValidStoredArtifact([legacyArtifactAssetFixture(ASSET_1_ID, content)]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const throwingResolver = { resolveLegacyLocalReference: vi.fn(async () => { throw new Error("secret-provider-detail"); }) };
    const result = await verifyBackupM15V2Snapshot({
      ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT,
      legacyLocalResolver: throwingResolver, objectBackedResolver: createObjectBackedReferenceResolver({ resolveObjectStorage: () => null }),
    });
    expect(JSON.stringify(result)).not.toContain("secret-provider-detail");
  });

  it("21. never issues a database write", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    await verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() });
    expect(database.opsBackupSnapshot.create).not.toHaveBeenCalled();
  });

  it("22. returns a deterministic result for repeated calls", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const first = await verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database: fakeDatabase({ snapshotRow: row }), verifiedAt: VERIFIED_AT, ...noResolvers() });
    const second = await verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database: fakeDatabase({ snapshotRow: row }), verifiedAt: VERIFIED_AT, ...noResolvers() });
    expect(first).toEqual(second);
  });

  it("23. does not expose sensitive data in the output", async () => {
    const content = new TextEncoder().encode("legacy-body");
    const artifact = await buildValidStoredArtifact([legacyArtifactAssetFixture(ASSET_1_ID, content)]);
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const database = fakeDatabase({ snapshotRow: row });
    const result = await verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(OWNER_ID);
    expect(serialized).not.toContain(sha256(content));
  });

  it("24. does not mutate the input", async () => {
    const artifact = await buildValidStoredArtifact();
    const row = persistedRow({ snapshotJson: artifact, checksum: artifact.checksum });
    const before = structuredClone(row);
    const database = fakeDatabase({ snapshotRow: row });
    await verifyBackupM15V2Snapshot({ ownerUserId: OWNER_ID, backupId: BACKUP_ID, database, verifiedAt: VERIFIED_AT, ...noResolvers() });
    expect(row).toEqual(before);
  });

  it("25. leaves M13/M15v1/WP2H1-4 modules untouched (source-level check)", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/from ["']\.\/ops-persistence["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-restore-preview["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-restore-preview-runtime["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-m15-artifact["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-m15-restore-preview["']/);
    expect(source).not.toMatch(/from ["']\.\/backup-v13-/);
    expect(source).not.toMatch(/from ["']\.\/contracts["']/);
    expect(source).not.toMatch(/next\/server/);
    expect(source).not.toMatch(/process\.env/);
  });
});

function legacyArtifactAssetFixture(id: string, content: Uint8Array) {
  return legacyAssetRow(id, content);
}

function objectArtifactAssetFixture(id: string, content: Uint8Array, versionId?: string) {
  return objectAssetRow(id, content, versionId ? { storageVersionId: versionId } : {});
}

function readSourceFile(): string {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-m15-v2-snapshot-persistence.ts");
  return fs.readFileSync(sourcePath, "utf8");
}
