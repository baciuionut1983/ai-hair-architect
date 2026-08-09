import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  BACKUP_CHECKSUM_ALGORITHM,
  BACKUP_V13_CANONICAL_VERSION,
  BACKUP_V13_SCHEMA_VERSION,
  BackupArtifactError,
  assertSectionRowLimits,
  canonicalizeSortedJsonV1,
  computeArtifactChecksumHex,
  computeCanonicalSectionBytes,
  isBackupV13V1Artifact,
  isBackupV13V2Artifact,
  isRecognizedLegacyM12Summary,
  resolveSafeStoragePath,
  utf8ByteLength,
  verifyExternalReferences,
} from "@/lib/backup-v13-artifact";
import type { BackupV13Artifact } from "@/lib/contracts";

function createArtifact(): BackupV13Artifact {
  return {
    schemaVersion: BACKUP_V13_SCHEMA_VERSION,
    canonicalSerializationVersion: BACKUP_V13_CANONICAL_VERSION,
    checksumAlgorithm: BACKUP_CHECKSUM_ALGORITHM,
    checksum: null,
    backupId: "c_testbackupid",
    ownerUserId: "owner-1",
    createdByUserId: "owner-1",
    label: "checkpoint",
    createdAt: "2026-07-22T00:00:00.000Z",
    summarySnapshot: {
      clientsCount: 1,
      consultationsCount: 0,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: 0,
    },
    counts: {
      clients: 1,
      analyses: 1,
      imageAssets: 1,
      imageAnalyses: 1,
      imageAnalysisReviews: 1,
    },
    limits: {
      maxArtifactBytes: 8 * 1024 * 1024,
      maxSectionBytes: 2 * 1024 * 1024,
      maxRowsPerSection: {
        clients: 2000,
        analyses: 10000,
        imageAssets: 10000,
        imageAnalyses: 10000,
        imageAnalysisReviews: 20000,
      },
    },
    sections: {
      clients: [
        {
          id: "client-1",
          name: "Client",
          ownerUserId: "owner-1",
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      analyses: [
        {
          id: "analysis-1",
          clientId: "client-1",
          ownerUserId: "owner-1",
          goal: "refresh",
          hairType: "medium",
          density: "medium",
          porosity: "medium",
          phase: "ready",
          clarificationRound: 0,
          confidenceScore: 0.9,
          uncertaintyReasons: [],
          followUpQuestions: [],
          recommendations: ["rec"],
          safetyNotes: ["safe"],
          faceShape: null,
          headShape: null,
          hairLength: null,
          hairTexture: null,
          hairCondition: null,
          growthPattern: null,
          targetShape: null,
          technicalCutPlan: null,
          clarificationAnswers: [],
          imageAssetId: "asset-1",
          imageAnalysisId: "img-analysis-1",
          m8DraftCreatedAt: null,
          m8FinalizedAt: null,
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      imageAssets: [
        {
          id: "asset-1",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 100,
          ownerUserId: "owner-1",
          clientId: "client-1",
          storagePath: path.join(process.cwd(), ".storage", "images", "owner-1", "asset-1", "photo.jpg"),
          exifStripped: true,
          normalizedOrientation: 1,
          uploadedAt: "2026-07-20T00:00:00.000Z",
          deletedAt: null,
          retentionDeletesAt: null,
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      imageAnalyses: [
        {
          id: "img-analysis-1",
          assetId: "asset-1",
          status: "draft",
          providerName: "mock",
          modelVersion: "1",
          analysisPayload: {},
          confidences: {},
          unknownFields: [],
          warnings: [],
          limitations: [],
          consentTimestamp: "2026-07-20T00:00:00.000Z",
          deletedAt: null,
          retentionDeletesAt: null,
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      imageAnalysisReviews: [
        {
          id: "review-1",
          analysisId: "img-analysis-1",
          reviewedByUserId: "owner-1",
          manualCorrections: {},
          confirmationTimestamp: null,
          notes: null,
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    },
  };
}

function baselineV1Acceptance(value: unknown): boolean {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (obj.schemaVersion !== BACKUP_V13_SCHEMA_VERSION) return false;
  if (obj.canonicalSerializationVersion !== BACKUP_V13_CANONICAL_VERSION) return false;
  if (obj.checksumAlgorithm !== BACKUP_CHECKSUM_ALGORITHM) return false;
  if (typeof obj.backupId !== "string" || typeof obj.ownerUserId !== "string" || typeof obj.createdByUserId !== "string") {
    return false;
  }
  if (!obj.sections || typeof obj.sections !== "object") return false;

  const sections = obj.sections as Record<string, unknown>;
  return Array.isArray(sections.clients) &&
    Array.isArray(sections.analyses) &&
    Array.isArray(sections.imageAssets) &&
    Array.isArray(sections.imageAnalyses) &&
    Array.isArray(sections.imageAnalysisReviews);
}

describe("backup-v13-artifact", () => {
  it("matches baseline m13.v1 acceptance semantics", () => {
    const withClients = (clients: unknown[]) => {
      const artifact = structuredClone(createArtifact()) as unknown as Record<string, unknown>;
      (artifact.sections as Record<string, unknown>).clients = clients;
      return artifact;
    };
    const wrongCanonical = structuredClone(createArtifact()) as unknown as Record<string, unknown>;
    wrongCanonical.canonicalSerializationVersion = "sorted-json-v2";
    const missingBackupId = structuredClone(createArtifact()) as unknown as Record<string, unknown>;
    delete missingBackupId.backupId;
    const missingSection = structuredClone(createArtifact()) as unknown as Record<string, unknown>;
    delete (missingSection.sections as Record<string, unknown>).analyses;

    const cases: unknown[] = [
      createArtifact(),
      withClients([]),
      withClients([{}]),
      withClients([{ fullName: "Not v1" }]),
      withClients([null, 1, "client"]),
      { ...createArtifact(), schemaVersion: "m13.v2" },
      wrongCanonical,
      missingBackupId,
      missingSection,
      null,
    ];

    for (const value of cases) {
      expect(isBackupV13V1Artifact(value)).toBe(baselineV1Acceptance(value));
    }
  });

  it("keeps Client row validation exclusive to m13.v2", () => {
    const artifact = createArtifact() as unknown as Record<string, unknown>;
    artifact.schemaVersion = "m13.v2";

    expect(isBackupV13V2Artifact(artifact)).toBe(false);
  });

  it("produces deterministic checksum for same canonical content", () => {
    const first = createArtifact();
    const second = createArtifact();

    expect(computeArtifactChecksumHex(first)).toBe(computeArtifactChecksumHex(second));
  });

  it("changes checksum when a single field changes", () => {
    const first = createArtifact();
    const second = createArtifact();
    second.label = "checkpoint-updated";

    expect(computeArtifactChecksumHex(first)).not.toBe(computeArtifactChecksumHex(second));
  });

  it("checksum input ignores checksum value by forcing checksum:null", () => {
    const artifact = createArtifact();
    artifact.checksum = "abc";

    const withChecksumA = computeArtifactChecksumHex(artifact);
    artifact.checksum = "def";
    const withChecksumB = computeArtifactChecksumHex(artifact);

    expect(withChecksumA).toBe(withChecksumB);
  });

  it("computes utf8 byte length (not JS char length)", () => {
    const value = "ro-ș";
    expect(value.length).toBeLessThan(utf8ByteLength(value));
  });

  it("computes section bytes using canonical UTF-8 json", () => {
    const bytes = computeCanonicalSectionBytes([{ b: 1, a: "x" }]);
    expect(bytes).toBe(utf8ByteLength(canonicalizeSortedJsonV1([{ b: 1, a: "x" }])));
  });

  it("detects recognized legacy m12 summary shape", () => {
    expect(
      isRecognizedLegacyM12Summary({
        clientsCount: 1,
        consultationsCount: 0,
        appointmentsCount: 0,
        notificationsCount: 0,
        workspacesCount: 0,
      }),
    ).toBe(true);
  });

  it("rejects path traversal and absolute external paths", () => {
    expect(() => resolveSafeStoragePath("../outside/file.jpg")).toThrow(BackupArtifactError);
    expect(() => resolveSafeStoragePath(path.resolve("C:/tmp/external.jpg"))).toThrow(BackupArtifactError);
  });

  it("enforces row limits per section", () => {
    expect(() =>
      assertSectionRowLimits({
        clients: 2001,
        analyses: 0,
        imageAssets: 0,
        imageAnalyses: 0,
        imageAnalysisReviews: 0,
      }),
    ).toThrow(BackupArtifactError);
  });

  it("accepts safe in-root absolute path", async () => {
    const storageRoot = path.join(process.cwd(), ".storage", "images", "owner-1", "asset-1");
    await fs.promises.mkdir(storageRoot, { recursive: true });
    const filePath = path.join(storageRoot, "photo.jpg");
    await fs.promises.writeFile(filePath, "x");

    expect(resolveSafeStoragePath(filePath)).toBe(path.resolve(filePath));
  });

  describe("verifyExternalReferences (M33 GO-3: legacy S3 storage metadata diagnostic)", () => {
    function withImageAssets(imageAssets: Array<Record<string, unknown>>): BackupV13Artifact {
      const artifact = structuredClone(createArtifact()) as unknown as Record<string, unknown>;
      (artifact.sections as Record<string, unknown>).imageAssets = imageAssets;
      return artifact as unknown as BackupV13Artifact;
    }

    it("returns not_applicable for an empty imageAssets section, without touching the filesystem", async () => {
      const result = await verifyExternalReferences(withImageAssets([]));
      expect(result).toEqual({ status: "not_applicable", reason: null });
    });

    it("verifies successfully for a genuine, existing local storagePath", async () => {
      const storageRoot = path.join(process.cwd(), ".storage", "images", "owner-1", "asset-local");
      await fs.promises.mkdir(storageRoot, { recursive: true });
      const filePath = path.join(storageRoot, "photo.jpg");
      await fs.promises.writeFile(filePath, "x");

      const result = await verifyExternalReferences(
        withImageAssets([{ ...createArtifact().sections.imageAssets[0], id: "asset-local", storagePath: filePath }]),
      );

      expect(result).toEqual({ status: "all_exist_integrity_unverified", reason: "external_binary_integrity_unavailable" });
    });

    it("throws a dedicated BACKUP_EXTERNAL_STORAGE_METADATA_MISSING diagnostic for storagePath \"pending\" (S3-backed, never captured), not the generic unsafe-path code", async () => {
      const artifact = withImageAssets([
        { ...createArtifact().sections.imageAssets[0], id: "asset-s3", storagePath: "pending" },
      ]);

      await expect(verifyExternalReferences(artifact)).rejects.toMatchObject({
        code: "BACKUP_EXTERNAL_STORAGE_METADATA_MISSING",
        httpStatus: 422,
      });
    });

    it("includes the offending image asset id in the pending-sentinel error details", async () => {
      const artifact = withImageAssets([
        { ...createArtifact().sections.imageAssets[0], id: "asset-s3-specific", storagePath: "pending" },
      ]);

      try {
        await verifyExternalReferences(artifact);
        expect.unreachable("expected verifyExternalReferences to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(BackupArtifactError);
        expect((error as BackupArtifactError).details).toMatchObject({ imageAssetId: "asset-s3-specific" });
      }
    });

    it("still throws BACKUP_EXTERNAL_REFERENCE_UNSAFE, not the pending diagnostic, for a genuinely unsafe non-\"pending\" path", async () => {
      const artifact = withImageAssets([
        { ...createArtifact().sections.imageAssets[0], id: "asset-traversal", storagePath: "../outside/file.jpg" },
      ]);

      await expect(verifyExternalReferences(artifact)).rejects.toMatchObject({
        code: "BACKUP_EXTERNAL_REFERENCE_UNSAFE",
      });
    });

    it("throws BACKUP_EXTERNAL_OBJECT_MISSING for a real absolute path whose file does not exist", async () => {
      const missingPath = path.join(process.cwd(), ".storage", "images", "owner-1", "asset-missing", "photo.jpg");
      const artifact = withImageAssets([
        { ...createArtifact().sections.imageAssets[0], id: "asset-missing", storagePath: missingPath },
      ]);

      await expect(verifyExternalReferences(artifact)).rejects.toMatchObject({
        code: "BACKUP_EXTERNAL_OBJECT_MISSING",
      });
    });

    it("fails closed on the first pending asset in a mixed backup, even when a valid local asset precedes it", async () => {
      const storageRoot = path.join(process.cwd(), ".storage", "images", "owner-1", "asset-mixed-local");
      await fs.promises.mkdir(storageRoot, { recursive: true });
      const filePath = path.join(storageRoot, "photo.jpg");
      await fs.promises.writeFile(filePath, "x");

      const artifact = withImageAssets([
        { ...createArtifact().sections.imageAssets[0], id: "asset-mixed-local", storagePath: filePath },
        { ...createArtifact().sections.imageAssets[0], id: "asset-mixed-s3", storagePath: "pending" },
      ]);

      await expect(verifyExternalReferences(artifact)).rejects.toMatchObject({
        code: "BACKUP_EXTERNAL_STORAGE_METADATA_MISSING",
        details: { imageAssetId: "asset-mixed-s3" },
      });
    });
  });
});
