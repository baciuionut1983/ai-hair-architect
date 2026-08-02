import { createHash, randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  ANALYSIS_STATUS_DRAFT,
  ANALYSIS_STATUS_FAILED,
  ANALYSIS_STATUS_QUEUED,
  countMonthlyRealAnalysisAttempts,
  recordExternalAiConsent,
} from "./image-analysis-job-repository";
import {
  PROCESSING_RESULT_HTTP_STATUS,
  processImageAnalysis,
  type ProcessImageAnalysisDependencies,
  type ProcessingResultCode,
} from "./image-analysis-processing-service";
import { ImageAnalysisProvider, type AnalysisOptions, type ProviderError } from "./image-analysis-provider";
import { deleteImageFile, saveImageFile } from "./image-storage";
import type { ObjectStorage, StoredObject } from "./object-storage";
import { ObjectStorageError } from "./object-storage-errors";

const hasRealDatabase = Boolean(process.env.TEST_DATABASE_URL);
const integrationSuite = hasRealDatabase ? describe : describe.skip;

const VALID_JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(200, 0x42),
]);
const NON_IMAGE_BYTES = Buffer.from("this-is-not-an-image-just-plain-text-bytes".repeat(4));

const GEMINI_ENV = { AI_ANALYSIS_PROVIDER: "gemini", AI_ANALYSIS_API_KEY: "test-key", AI_ANALYSIS_MODEL: "gemini-3.6-flash" };
const DISABLED_ENV = {};
const INVALID_ENV = { AI_ANALYSIS_PROVIDER: "openai" };

class SuccessProvider extends ImageAnalysisProvider {
  readonly name = "fake-gemini";
  readonly modelVersion = "fake-model";
  readonly calls: AnalysisOptions[] = [];

  async analyze(options: AnalysisOptions) {
    this.calls.push(options);
    return {
      result: {
        hairType: "curly" as const,
        density: "high" as const,
        porosity: "medium" as const,
        faceShape: null,
        headShape: null,
        hairLength: null,
        hairTexture: null,
        hairCondition: null,
        growthPattern: null,
        targetShape: null,
      },
      confidences: {
        hairType: 0.9, density: 0.8, porosity: 0.7,
        faceShape: 0, headShape: 0, hairLength: 0, hairTexture: 0, hairCondition: 0, growthPattern: 0, targetShape: 0,
      },
      warnings: ["Automated analysis limited to hairType, density, and porosity (Gemini provider)."],
      limitations: ["Confidence scores below 0.7 require manual verification"],
    };
  }
}

class FailingProvider extends ImageAnalysisProvider {
  readonly name = "fake-gemini";
  readonly modelVersion = "fake-model";
  readonly calls: AnalysisOptions[] = [];

  constructor(private readonly errorToThrow: ProviderError) {
    super();
  }

  async analyze(options: AnalysisOptions): Promise<never> {
    this.calls.push(options);
    throw this.errorToThrow;
  }
}

function providerError(code: ProviderError["code"], retryable: boolean): ProviderError {
  return Object.assign(new Error(`fake ${code}`), { code, retryable }) as ProviderError;
}

function webStreamOf(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

function createFakeObjectStorage(entries: Map<string, Buffer>): ObjectStorage {
  return {
    async get({ bucketAlias, key, versionId }): Promise<StoredObject> {
      const data = entries.get(`${key}::${versionId}`);
      if (!data) {
        throw new ObjectStorageError("not_found");
      }
      return {
        bucketAlias,
        key,
        versionId: versionId ?? null,
        etag: null,
        contentSha256: createHash("sha256").update(data).digest("hex"),
        sizeBytes: data.length,
        contentType: "image/jpeg",
        body: webStreamOf(data),
      };
    },
    async put() {
      throw new Error("not implemented in test fake");
    },
    async head() {
      throw new Error("not implemented in test fake");
    },
    async delete() {
      throw new Error("not implemented in test fake");
    },
  };
}

integrationSuite("image-analysis-processing-service (real Postgres)", () => {
  const owners = new Set<string>();
  const localPaths = new Set<string>();

  afterEach(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.imageAnalysisProviderAttempt.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.imageAnalysis.deleteMany({ where: { asset: { ownerUserId: { in: [...owners] } } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
    for (const filePath of localPaths) {
      await deleteImageFile(filePath).catch(() => {});
    }
    localPaths.clear();
  });

  it("provider disabled returns PROCESSING_DISABLED and touches no database row", async () => {
    const result = await processImageAnalysis(randomUUID(), randomUUID(), { env: DISABLED_ENV });
    expect(result).toEqual({ outcome: "failed", code: "PROCESSING_DISABLED" });
    expect(PROCESSING_RESULT_HTTP_STATUS.PROCESSING_DISABLED).toBe(503);
  });

  it("invalid provider configuration returns PROVIDER_CONFIGURATION_INVALID", async () => {
    const result = await processImageAnalysis(randomUUID(), randomUUID(), { env: INVALID_ENV });
    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_CONFIGURATION_INVALID" });
  });

  it("missing asset returns ANALYSIS_NOT_FOUND", async () => {
    const ownerUserId = await createOwner(owners);
    const result = await processImageAnalysis(randomUUID(), ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "ANALYSIS_NOT_FOUND" });
  });

  it("another owner's asset is indistinguishable from missing", async () => {
    const ownerA = await createOwner(owners);
    const ownerB = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerA, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const result = await processImageAnalysis(assetId, ownerB, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "ANALYSIS_NOT_FOUND" });
  });

  it("asset with no ImageAnalysis rows at all returns ANALYSIS_NOT_FOUND", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "ANALYSIS_NOT_FOUND" });
  });

  it("consent missing is caught by the preliminary check before any storage read, no attempt row created", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: false });

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "CONSENT_REQUIRED" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("unsupported persisted MIME type is rejected before any storage read, no attempt row created", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths, { mimeType: "application/pdf" });
    await createQueuedAnalysis(assetId, { consent: true });

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "UNSUPPORTED_MIME_TYPE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("oversized persisted metadata is rejected before any storage read, no attempt row created", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths, { sizeBytes: 50 * 1024 * 1024 });
    await createQueuedAnalysis(assetId, { consent: true });

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "IMAGE_TOO_LARGE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("local storage read failure (missing file) creates no attempt row [required test 1]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });
    localPaths.forEach((p) => deleteImageFile(p));
    localPaths.clear();

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "STORAGE_READ_FAILURE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("actual oversized stream (real file exceeds the bound) creates no attempt row [required test 3]", async () => {
    const ownerUserId = await createOwner(owners);
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(9 * 1024 * 1024, 0x41)]);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, oversized, localPaths, { sizeBytes: oversized.length });

    await createQueuedAnalysis(assetId, { consent: true });

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "IMAGE_TOO_LARGE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("magic-byte mismatch on real bytes creates no attempt row [required test 4]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, NON_IMAGE_BYTES, localPaths, { sizeBytes: NON_IMAGE_BYTES.length });
    await createQueuedAnalysis(assetId, { consent: true });

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "UNSUPPORTED_IMAGE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("object storage returning a mismatched identity (wrong version) is rejected before claim, no attempt row", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId, key } = await createObjectBackedFixture(ownerUserId, VALID_JPEG_BYTES);
    await createQueuedAnalysis(assetId, { consent: true });

    const misidentifyingStorage: ObjectStorage = {
      async get({ key: requestedKey }) {
        return {
          bucketAlias: "test-bucket-alias",
          key: requestedKey,
          versionId: "a-completely-different-version-than-requested",
          etag: null,
          contentSha256: createHash("sha256").update(VALID_JPEG_BYTES).digest("hex"),
          sizeBytes: VALID_JPEG_BYTES.length,
          contentType: "image/jpeg",
          body: webStreamOf(VALID_JPEG_BYTES),
        };
      },
      async put() { throw new Error("not implemented in test fake"); },
      async head() { throw new Error("not implemented in test fake"); },
      async delete() { throw new Error("not implemented in test fake"); },
    };

    const result = await processImageAnalysis(assetId, ownerUserId, {
      env: GEMINI_ENV,
      resolveObjectStorage: async () => misidentifyingStorage,
    });
    expect(result).toEqual({ outcome: "failed", code: "OBJECT_STORAGE_READ_FAILURE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
    expect(key).toBeTruthy();
  });

  it("object storage failure (not found) creates no attempt row [required test 2]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createObjectBackedFixture(ownerUserId, VALID_JPEG_BYTES);
    await createQueuedAnalysis(assetId, { consent: true });

    const emptyStorage = createFakeObjectStorage(new Map());
    const result = await processImageAnalysis(assetId, ownerUserId, {
      env: GEMINI_ENV,
      resolveObjectStorage: async () => emptyStorage,
    });
    expect(result).toEqual({ outcome: "failed", code: "OBJECT_STORAGE_READ_FAILURE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("no backend classification (unknown storageBackend value) returns IMAGE_UNAVAILABLE, no attempt row", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const { prisma } = await import("@/lib/prisma");
    await prisma.imageAsset.update({ where: { id: assetId }, data: { storageBackend: "bogus" } });
    await createQueuedAnalysis(assetId, { consent: true });

    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV });
    expect(result).toEqual({ outcome: "failed", code: "IMAGE_UNAVAILABLE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("full successful flow (legacy-local): claims, invokes Gemini once, persists sanitized result, quota becomes 1", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, {
      env: GEMINI_ENV,
      createProvider: () => provider,
    });

    expect(result.outcome).toBe("succeeded");
    expect(provider.calls).toHaveLength(1);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);

    if (result.outcome === "succeeded") {
      expect(result.analysis.status).toBe(ANALYSIS_STATUS_DRAFT);
      expect(result.analysis.providerName).toBe("gemini");
      expect(result.analysis.modelVersion).toBe("gemini-3.6-flash");
      expect(result.analysis.analysisPayload).toMatchObject({ hairType: "curly", density: "high", porosity: "medium" });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(VALID_JPEG_BYTES.toString("base64").slice(0, 30));
      expect(serialized.toLowerCase()).not.toContain("base64");
    }

    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.imageAnalysis.findUniqueOrThrow({ where: { id: result.outcome === "succeeded" ? (result as { analysis: { id: string } }).analysis.id : "" } });
    expect(JSON.stringify(row.analysisPayload)).not.toMatch(/[A-Za-z0-9+/]{100,}={0,2}/);
  });

  it("full successful flow (object-backed, exact version): claims and persists correctly", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId, key, versionId } = await createObjectBackedFixture(ownerUserId, VALID_JPEG_BYTES);
    await createQueuedAnalysis(assetId, { consent: true });

    const storage = createFakeObjectStorage(new Map([[`${key}::${versionId}`, VALID_JPEG_BYTES]]));
    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, {
      env: GEMINI_ENV,
      createProvider: () => provider,
      resolveObjectStorage: async () => storage,
    });

    expect(result.outcome).toBe("succeeded");
    expect(provider.calls).toHaveLength(1);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("quota exceeded (5 attempts already this month) rejects the 6th before invoking Gemini", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date();
    for (let i = 1; i <= 5; i += 1) {
      const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
      const analysisId = await createQueuedAnalysis(assetId, { consent: true });
      const { claimQueuedAnalysisForProcessing } = await import("./image-analysis-job-repository");
      await claimQueuedAnalysisForProcessing({ analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now });
    }

    const { assetId: sixthAssetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(sixthAssetId, { consent: true });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(sixthAssetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "QUOTA_EXCEEDED" });
    expect(provider.calls).toHaveLength(0);
  });

  it("already-processing (non-stale) resolved analysis returns CLAIM_CONFLICT without invoking Gemini", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const analysisId = await createQueuedAnalysis(assetId, { consent: true });
    const { claimQueuedAnalysisForProcessing } = await import("./image-analysis-job-repository");
    await claimQueuedAnalysisForProcessing({ analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: new Date() });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "CLAIM_CONFLICT" });
    expect(provider.calls).toHaveLength(0);
  });

  it("stale (>15min) processing is recovered atomically as attempt 2", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const analysisId = await createQueuedAnalysis(assetId, { consent: true });
    const staleTime = new Date(Date.now() - 16 * 60 * 1000);
    const { claimQueuedAnalysisForProcessing } = await import("./image-analysis-job-repository");
    await claimQueuedAnalysisForProcessing({ analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: staleTime });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result.outcome).toBe("succeeded");
    expect(provider.calls).toHaveLength(1);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(2);
  });

  it("already-completed (draft) returns current sanitized state with no reprocessing", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const analysisId = await createQueuedAnalysis(assetId, { consent: true });
    const { claimQueuedAnalysisForProcessing, markAnalysisSucceeded } = await import("./image-analysis-job-repository");
    await claimQueuedAnalysisForProcessing({ analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: new Date() });
    await markAnalysisSucceeded(analysisId, ownerUserId, {
      result: { hairType: "wavy" }, confidences: { hairType: 0.5 }, providerName: "gemini", modelVersion: "gemini-3.6-flash", warnings: [],
    });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result.outcome).toBe("current_state");
    expect(provider.calls).toHaveLength(0);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("already-confirmed returns current sanitized state with no reprocessing", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true, status: "confirmed" });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result.outcome).toBe("current_state");
    expect(provider.calls).toHaveLength(0);
  });

  it("permanently-failed analysis rejects further processing with RETRY_NOT_ALLOWED", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true, status: ANALYSIS_STATUS_FAILED });

    const provider = new SuccessProvider();
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "RETRY_NOT_ALLOWED" });
    expect(provider.calls).toHaveLength(0);
  });

  it("provider timeout after claim consumes quota and leaves the row retriable [required test 11]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const provider = new FailingProvider(providerError("TIMEOUT", true));
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_TIMEOUT" });
    expect(provider.calls).toHaveLength(1);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("provider rate-limited maps to PROVIDER_UNAVAILABLE and consumes quota", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const provider = new FailingProvider(providerError("RATE_LIMITED", true));
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_UNAVAILABLE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("provider authentication failure (NOT_CONFIGURED at invocation time) is permanent and consumes quota", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const provider = new FailingProvider(providerError("NOT_CONFIGURED", false));
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_AUTHENTICATION_FAILURE" });

    const nextAttempt = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(nextAttempt).toEqual({ outcome: "failed", code: "RETRY_NOT_ALLOWED" });
  });

  it("malformed provider response maps to MALFORMED_PROVIDER_RESPONSE, permanent, consumes quota", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const provider = new FailingProvider(providerError("INVALID_FORMAT", false));
    const result = await processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => provider });
    expect(result).toEqual({ outcome: "failed", code: "MALFORMED_PROVIDER_RESPONSE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("consent revoked between the preliminary check and the atomic claim fails at claim [required test 9]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const analysisId = await createQueuedAnalysis(assetId, { consent: true });
    const { prisma } = await import("@/lib/prisma");

    const provider = new SuccessProvider();
    const dependencies: ProcessImageAnalysisDependencies = {
      env: GEMINI_ENV,
      createProvider: () => provider,
      beforeClaim: async () => {
        await prisma.imageAnalysis.update({ where: { id: analysisId }, data: { externalAiConsentGrantedAt: null } });
      },
    };

    const result = await processImageAnalysis(assetId, ownerUserId, dependencies);
    expect(result).toEqual({ outcome: "failed", code: "CONSENT_REQUIRED" });
    expect(provider.calls).toHaveLength(0);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("persistence failure after a successful provider call consumes quota and reports PERSISTENCE_FAILURE [required test 12]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    const analysisId = await createQueuedAnalysis(assetId, { consent: true });
    const { prisma } = await import("@/lib/prisma");

    const provider = new SuccessProvider();
    const dependencies: ProcessImageAnalysisDependencies = {
      env: GEMINI_ENV,
      createProvider: () => provider,
      beforePersist: async () => {
        // Simulate external interference that invalidates the guarded update
        // markAnalysisSucceeded performs, without touching the ledger row.
        await prisma.imageAnalysis.update({ where: { id: analysisId }, data: { status: ANALYSIS_STATUS_DRAFT } });
      },
    };

    const result = await processImageAnalysis(assetId, ownerUserId, dependencies);
    expect(result).toEqual({ outcome: "failed", code: "PERSISTENCE_FAILURE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("two concurrent requests on the same analysis: exactly one claims and invokes Gemini, the other gets CLAIM_CONFLICT [required tests 5-8]", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const providerA = new SuccessProvider();
    const providerB = new SuccessProvider();

    // Both requests independently perform their own pre-claim work (resolve
    // analysis, read storage, validate bytes) -- proving requirement 5, that
    // concurrent duplicate triggers may both read storage. This barrier only
    // forces them to arrive at the atomic GO-1 claim together, so the test
    // deterministically exercises the actual contended step rather than
    // depending on incidental event-loop timing.
    let arrivals = 0;
    let releaseBoth: () => void = () => {};
    const bothArrived = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const rendezvous = async () => {
      arrivals += 1;
      if (arrivals >= 2) {
        releaseBoth();
      }
      await bothArrived;
    };

    const [resultA, resultB] = await Promise.all([
      processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => providerA, beforeClaim: rendezvous }),
      processImageAnalysis(assetId, ownerUserId, { env: GEMINI_ENV, createProvider: () => providerB, beforeClaim: rendezvous }),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(["failed", "succeeded"]);

    const failedResult = (resultA.outcome === "failed" ? resultA : resultB) as { outcome: "failed"; code: ProcessingResultCode };
    expect(failedResult.code).toBe("CLAIM_CONFLICT");

    const totalCalls = providerA.calls.length + providerB.calls.length;
    expect(totalCalls).toBe(1);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(1);
  });

  it("sanitized errors never leak provider details, and non-succeeded results carry no analysis payload", async () => {
    const ownerUserId = await createOwner(owners);
    const { assetId } = await createLegacyLocalFixture(ownerUserId, VALID_JPEG_BYTES, localPaths);
    await createQueuedAnalysis(assetId, { consent: true });

    const provider = new FailingProvider(providerError("PROVIDER_ERROR", true));
    const result = await processImageAnalysis(assetId, ownerUserId, {
      env: { ...GEMINI_ENV, AI_ANALYSIS_API_KEY: "super-secret-value-must-not-leak" },
      createProvider: () => provider,
    });

    expect(result).toEqual({ outcome: "failed", code: "PROVIDER_UNAVAILABLE" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-value-must-not-leak");
    expect(serialized).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace-shaped content
  });
});

async function createOwner(owners: Set<string>): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@image-analysis-processing.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  return ownerUserId;
}

async function createLegacyLocalFixture(
  ownerUserId: string,
  bytes: Buffer,
  localPaths: Set<string>,
  overrides: Record<string, unknown> = {},
): Promise<{ assetId: string; storagePath: string }> {
  const { prisma } = await import("@/lib/prisma");
  const assetIdForPath = randomUUID();
  const storagePath = await saveImageFile(ownerUserId, assetIdForPath, "photo.jpg", bytes);
  localPaths.add(storagePath);

  const asset = await prisma.imageAsset.create({
    data: {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      ownerUserId,
      clientId: randomUUID(),
      storagePath,
      storageBackend: null,
      ...overrides,
    },
  });
  return { assetId: asset.id, storagePath };
}

async function createObjectBackedFixture(
  ownerUserId: string,
  bytes: Buffer,
): Promise<{ assetId: string; key: string; versionId: string }> {
  const { prisma } = await import("@/lib/prisma");
  const key = `owners/${ownerUserId}/assets/${randomUUID()}/original`;
  const versionId = randomUUID();
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");

  const asset = await prisma.imageAsset.create({
    data: {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      ownerUserId,
      clientId: randomUUID(),
      storagePath: "pending",
      storageBackend: "s3",
      storageState: "available",
      storageBucketAlias: "test-bucket-alias",
      storageKey: key,
      storageVersionId: versionId,
      storageEtag: "\"etag\"",
      contentSha256,
    },
  });
  return { assetId: asset.id, key, versionId };
}

async function createQueuedAnalysis(
  assetId: string,
  options: { consent: boolean; status?: string },
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const analysis = await prisma.imageAnalysis.create({
    data: { assetId, status: options.status ?? ANALYSIS_STATUS_QUEUED },
  });
  if (options.consent) {
    await recordExternalAiConsent(analysis.id, (await prisma.imageAsset.findUniqueOrThrow({ where: { id: assetId } })).ownerUserId, "v1", new Date());
  }
  return analysis.id;
}
