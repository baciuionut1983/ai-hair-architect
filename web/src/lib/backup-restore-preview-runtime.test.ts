import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { BackupArtifactError } from "./backup-v13-artifact";
import {
  getRuntimeBackupRestorePreviewForUser,
  type BackupRestorePreviewRuntimeDependencies,
} from "./backup-restore-preview-runtime";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const BACKUP_ID = "backup-runtime";
const NOW = new Date("2026-07-28T10:00:00.000Z");

function snapshot(schemaVersion = "m15.v1", artifact: unknown = { schemaVersion }) {
  return {
    id: BACKUP_ID,
    ownerUserId: OWNER_ID,
    checksum: "a".repeat(64),
    schemaVersion,
    snapshotJson: artifact,
  };
}

function rowFixtures() {
  const base = { createdAt: NOW, updatedAt: NOW };
  return {
    clients: [
      { id: "client-b", fullName: "B", email: null, phone: null, notes: null, deletedAt: null, ownerUserId: OWNER_ID, ...base },
      { id: "client-a", fullName: "A", email: null, phone: null, notes: null, deletedAt: null, ownerUserId: OWNER_ID, ...base },
    ],
    analyses: [{
      id: "analysis-a", clientId: "client-a", ownerUserId: OWNER_ID, goal: "refresh", hairType: "medium",
      density: "medium", porosity: "medium", phase: "ready", clarificationRound: 0, confidenceScore: 0.9,
      uncertaintyReasons: [], followUpQuestions: [], recommendations: [], safetyNotes: [], faceShape: null,
      headShape: null, hairLength: null, hairTexture: null, hairCondition: null, growthPattern: null,
      targetShape: null, technicalCutPlan: null, clarificationAnswers: [], imageAssetId: "asset-a",
      imageAnalysisId: "image-analysis-a", m8DraftCreatedAt: null, m8FinalizedAt: null, ...base,
    }],
    consultations: [{
      id: "consultation-a", ownerUserId: OWNER_ID, clientId: "client-a", analysisId: "analysis-a",
      summary: "Summary", nextSteps: ["Next"], createdAt: NOW,
    }],
    imageAssets: [{
      id: "asset-a", fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 3, ownerUserId: OWNER_ID,
      clientId: "client-a", storageBackend: "s3", storageBucketAlias: "images",
      storageKey: `v1/owners/${OWNER_ID}/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original`,
      storageVersionId: "version-1", storageEtag: "etag", contentSha256: "b".repeat(64),
      storageState: "available", storageMigratedAt: NOW, objectDeletedAt: null, lastStorageErrorCode: null,
      exifStripped: true, normalizedOrientation: 1, uploadedAt: NOW, deletedAt: null, retentionDeletesAt: null, ...base,
    }],
    imageAnalyses: [{
      id: "image-analysis-a", assetId: "asset-a", status: "completed", providerName: "provider",
      modelVersion: "1", analysisPayload: {}, confidences: {}, unknownFields: [], warnings: [], limitations: [],
      consentTimestamp: NOW, deletedAt: null, retentionDeletesAt: null, ...base,
    }],
    imageAnalysisReviews: [{
      id: "review-a", analysisId: "image-analysis-a", reviewedByUserId: OWNER_ID, manualCorrections: {},
      confirmationTimestamp: null, notes: null, ...base,
    }],
  };
}

function fakeDatabase(selectedSnapshot = snapshot(), rows = rowFixtures()) {
  const transaction = {
    opsBackupSnapshot: { findFirst: vi.fn(async () => selectedSnapshot) },
    client: { findMany: vi.fn(async () => rows.clients) },
    analysis: { findMany: vi.fn(async () => rows.analyses) },
    consultation: { findMany: vi.fn(async () => rows.consultations) },
    imageAsset: { findMany: vi.fn(async () => rows.imageAssets) },
    imageAnalysis: { findMany: vi.fn(async () => rows.imageAnalyses) },
    imageAnalysisReview: { findMany: vi.fn(async () => rows.imageAnalysisReviews) },
  };
  const database = {
    ...transaction,
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { database, transaction };
}

function dependencies(database: ReturnType<typeof fakeDatabase>["database"], overrides = {}) {
  return {
    database,
    isDatabaseConfigured: () => true,
    ...overrides,
  } as unknown as BackupRestorePreviewRuntimeDependencies;
}

describe("backup restore preview runtime", () => {
  it.each(["m13.v1", "m13.v2", "m13.v3"])(
    "delegates %s exclusively to the existing M13 runtime",
    async (schemaVersion) => {
      const fixture = fakeDatabase(snapshot(schemaVersion));
      const buildM13Preview = vi.fn(async () => ({ branch: "m13" }));
      const createAliasResolver = vi.fn();
      const buildM15Preview = vi.fn();

      await expect(getRuntimeBackupRestorePreviewForUser(
        OWNER_ID,
        BACKUP_ID,
        dependencies(fixture.database, { buildM13Preview, createAliasResolver, buildM15Preview }),
      )).resolves.toEqual({ branch: "m13" });

      expect(buildM13Preview).toHaveBeenCalledWith(OWNER_ID, BACKUP_ID);
      expect(createAliasResolver).not.toHaveBeenCalled();
      expect(buildM15Preview).not.toHaveBeenCalled();
      expect(fixture.database.$transaction).not.toHaveBeenCalled();
    },
  );

  it("dispatches m15.v1 with one per-call resolver and injected verifier", async () => {
    const fixture = fakeDatabase();
    const resolver = vi.fn();
    const createAliasResolver = vi.fn(() => resolver);
    const verifyExternalReferences = vi.fn();
    const buildM15Preview = vi.fn(async (_source, deps) => {
      expect(deps.resolveStorage).toBe(resolver);
      expect(deps.verifyExternalReferences).toBe(verifyExternalReferences);
      return { branch: "m15" };
    });

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, { createAliasResolver, verifyExternalReferences, buildM15Preview }),
    )).resolves.toEqual({ branch: "m15" });

    expect(createAliasResolver).toHaveBeenCalledOnce();
    expect(buildM15Preview).toHaveBeenCalledOnce();
  });

  it("creates isolated resolvers for distinct M15 runtime calls", async () => {
    const fixture = fakeDatabase();
    const resolvers = [vi.fn(), vi.fn()];
    const createAliasResolver = vi.fn()
      .mockReturnValueOnce(resolvers[0])
      .mockReturnValueOnce(resolvers[1]);
    const receivedResolvers: unknown[] = [];
    const buildM15Preview = vi.fn(async (_source, deps) => {
      receivedResolvers.push(deps.resolveStorage);
      return { branch: "m15" };
    });
    const deps = dependencies(fixture.database, { createAliasResolver, buildM15Preview });

    await getRuntimeBackupRestorePreviewForUser(OWNER_ID, BACKUP_ID, deps);
    await getRuntimeBackupRestorePreviewForUser(OWNER_ID, BACKUP_ID, deps);

    expect(createAliasResolver).toHaveBeenCalledTimes(2);
    expect(receivedResolvers).toEqual(resolvers);
  });

  it("performs the initial lookup by backup and owner", async () => {
    const fixture = fakeDatabase(snapshot("m13.v1"));

    await getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, { buildM13Preview: vi.fn(async () => ({ branch: "m13" })) }),
    );

    expect(fixture.database.opsBackupSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: BACKUP_ID, ownerUserId: OWNER_ID },
    }));
  });

  it("returns BACKUP_NOT_FOUND without dispatch when the owner-scoped snapshot is absent", async () => {
    const fixture = fakeDatabase(null as never);
    const createAliasResolver = vi.fn();

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, { createAliasResolver }),
    )).rejects.toMatchObject({ code: "BACKUP_NOT_FOUND", httpStatus: 404 });
    expect(createAliasResolver).not.toHaveBeenCalled();
  });

  it("fails closed for malformed artifacts", async () => {
    const fixture = fakeDatabase(snapshot("m15.v1", null));

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database),
    )).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE", httpStatus: 422 });
  });

  it("fails closed for unsupported schemas", async () => {
    const fixture = fakeDatabase(snapshot("m16.v1"));

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database),
    )).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNSUPPORTED_SCHEMA", httpStatus: 422 });
  });

  it("fails closed when the row schema and artifact schema drift", async () => {
    const fixture = fakeDatabase(snapshot("m15.v1", { schemaVersion: "m13.v3" }));

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database),
    )).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE", httpStatus: 422 });
  });

  it("fails closed for incomplete current object references before resolver construction", async () => {
    const rows = rowFixtures();
    rows.imageAssets[0].storageVersionId = null as never;
    const fixture = fakeDatabase(snapshot(), rows);
    const createAliasResolver = vi.fn();

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, { createAliasResolver }),
    )).rejects.toMatchObject({ code: "BACKUP_PREVIEW_UNINTERPRETABLE", httpStatus: 422 });
    expect(createAliasResolver).not.toHaveBeenCalled();
  });

  it("maps all six domains deterministically and normalizes timestamps", async () => {
    const fixture = fakeDatabase();
    const buildM15Preview = vi.fn(async (source) => source);

    const result = await getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, { createAliasResolver: vi.fn(() => vi.fn()), buildM15Preview }),
    ) as unknown as { currentState: Record<string, Array<Record<string, unknown>>> };

    expect(Object.keys(result.currentState)).toEqual([
      "clients", "analyses", "consultations", "imageAssets", "imageAnalyses", "imageAnalysisReviews",
    ]);
    expect(result.currentState.clients.map((row) => row.id)).toEqual(["client-a", "client-b"]);
    for (const rows of Object.values(result.currentState)) {
      expect(rows.length).toBeGreaterThan(0);
    }
    expect(result.currentState.imageAssets[0]).toMatchObject({
      storageState: "available",
      objectReference: { backend: "s3", bucketAlias: "images", versionId: "version-1" },
      createdAt: NOW.toISOString(),
    });
  });

  it("uses RepeatableRead and only owner-scoped read delegates", async () => {
    const fixture = fakeDatabase();

    await getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, {
        createAliasResolver: vi.fn(() => vi.fn()),
        buildM15Preview: vi.fn(async () => ({ branch: "m15" })),
      }),
    );

    expect(fixture.database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    expect(fixture.transaction.client.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: OWNER_ID } }));
    expect(fixture.transaction.analysis.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: OWNER_ID } }));
    expect(fixture.transaction.consultation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: OWNER_ID } }));
    expect(fixture.transaction.imageAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: OWNER_ID } }));
    expect(fixture.transaction.imageAnalysis.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { asset: { ownerUserId: OWNER_ID } } }));
    expect(fixture.transaction.imageAnalysisReview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { analysis: { asset: { ownerUserId: OWNER_ID } } },
    }));
    expect(Object.keys(fixture.transaction)).toEqual([
      "opsBackupSnapshot", "client", "analysis", "consultation", "imageAsset", "imageAnalysis", "imageAnalysisReview",
    ]);
    for (const delegate of Object.values(fixture.transaction)) {
      expect(delegate).not.toHaveProperty("create");
      expect(delegate).not.toHaveProperty("update");
      expect(delegate).not.toHaveProperty("delete");
      expect(delegate).not.toHaveProperty("upsert");
    }
  });

  it("preserves safe backup artifact errors from injected builders", async () => {
    const fixture = fakeDatabase(snapshot("m13.v1"));
    const expected = new BackupArtifactError("BACKUP_PREVIEW_UNINTERPRETABLE", 422, "Safe message.");

    await expect(getRuntimeBackupRestorePreviewForUser(
      OWNER_ID,
      BACKUP_ID,
      dependencies(fixture.database, { buildM13Preview: vi.fn(async () => { throw expected; }) }),
    )).rejects.toBe(expected);
  });
});