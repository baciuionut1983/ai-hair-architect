import { randomUUID } from "crypto";

import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasRealDatabase = Boolean(process.env.TEST_DATABASE_URL);

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  imageAnalysisUpdateMany: vi.fn(),
  attemptCount: vi.fn(),
  txImageAnalysisFindFirst: vi.fn(),
  txImageAnalysisUpdateMany: vi.fn(),
  txAttemptFindFirst: vi.fn(),
  txAttemptCount: vi.fn(),
  txAttemptCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", async (importOriginal) => {
  if (process.env.TEST_DATABASE_URL) {
    return importOriginal();
  }
  return {
    isDatabaseConfigured: () => prismaMocks.configured,
    prisma: {
      $transaction: prismaMocks.transaction,
      imageAnalysis: {
        updateMany: prismaMocks.imageAnalysisUpdateMany,
      },
      imageAnalysisProviderAttempt: {
        count: prismaMocks.attemptCount,
      },
    },
  };
});

import {
  ANALYSIS_STATUS_DRAFT,
  ANALYSIS_STATUS_FAILED,
  ANALYSIS_STATUS_PROCESSING,
  ANALYSIS_STATUS_QUEUED,
  ImageAnalysisJobPersistenceError,
  ImageAnalysisJobStateError,
  MAX_ATTEMPTS_PER_ANALYSIS,
  PERMANENT_FAILURE_CODES,
  RETRYABLE_FAILURE_CODES,
  claimQueuedAnalysisForProcessing,
  countMonthlyRealAnalysisAttempts,
  markAnalysisFailed,
  markAnalysisSucceeded,
  recordExternalAiConsent,
} from "./image-analysis-job-repository";

const tx = {
  imageAnalysis: {
    findFirst: prismaMocks.txImageAnalysisFindFirst,
    updateMany: prismaMocks.txImageAnalysisUpdateMany,
  },
  imageAnalysisProviderAttempt: {
    findFirst: prismaMocks.txAttemptFindFirst,
    count: prismaMocks.txAttemptCount,
    create: prismaMocks.txAttemptCreate,
  },
};

const unitSuite = hasRealDatabase ? describe.skip : describe;
const integrationSuite = hasRealDatabase ? describe : describe.skip;

unitSuite("image-analysis-job-repository (mocked)", () => {
  beforeEach(() => {
    prismaMocks.configured = true;
    prismaMocks.transaction.mockReset();
    prismaMocks.imageAnalysisUpdateMany.mockReset();
    prismaMocks.attemptCount.mockReset();
    prismaMocks.txImageAnalysisFindFirst.mockReset();
    prismaMocks.txImageAnalysisUpdateMany.mockReset();
    prismaMocks.txAttemptFindFirst.mockReset();
    prismaMocks.txAttemptCount.mockReset();
    prismaMocks.txAttemptCreate.mockReset();
    prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
  });

  it("keeps the permanent and retryable failure taxonomies exactly as frozen and disjoint", () => {
    expect(PERMANENT_FAILURE_CODES).toEqual([
      "CONSENT_MISSING",
      "QUOTA_EXCEEDED",
      "UNSUPPORTED_IMAGE",
      "MALFORMED_PROVIDER_RESPONSE",
      "POLICY_VIOLATION",
      "INVALID_ANALYSIS_STATE",
      "PROVIDER_CONFIGURATION_INVALID",
    ]);
    expect(RETRYABLE_FAILURE_CODES).toEqual([
      "PROVIDER_TIMEOUT",
      "PROVIDER_UNAVAILABLE",
      "STORAGE_READ_FAILURE",
      "DATABASE_CONFLICT",
      "NETWORK_FAILURE",
    ]);
    const overlap = PERMANENT_FAILURE_CODES.filter((code) =>
      (RETRYABLE_FAILURE_CODES as readonly string[]).includes(code));
    expect(overlap).toEqual([]);
  });

  describe("claimQueuedAnalysisForProcessing", () => {
    it("claims a queued, consented analysis inside one Serializable transaction", async () => {
      prismaMocks.txImageAnalysisFindFirst.mockResolvedValue({
        id: "analysis-1",
        status: ANALYSIS_STATUS_QUEUED,
        externalAiConsentGrantedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
      prismaMocks.txAttemptFindFirst.mockResolvedValue(null);
      prismaMocks.txAttemptCount.mockResolvedValue(0);
      prismaMocks.txImageAnalysisUpdateMany.mockResolvedValue({ count: 1 });
      prismaMocks.txAttemptCreate.mockResolvedValue({});

      const now = new Date("2026-08-01T12:00:00.000Z");
      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "analysis-1",
        ownerUserId: "owner-1",
        providerName: "gemini",
        modelVersion: "gemini-3.6-flash",
        now,
      })).resolves.toEqual({ outcome: "claimed", attemptNumber: 1 });

      expect(prismaMocks.transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(prismaMocks.txImageAnalysisUpdateMany).toHaveBeenCalledWith({
        where: { id: "analysis-1", asset: { ownerUserId: "owner-1" }, status: ANALYSIS_STATUS_QUEUED },
        data: { status: ANALYSIS_STATUS_PROCESSING, lastFailureCode: null },
      });
      expect(prismaMocks.txAttemptCreate).toHaveBeenCalledWith({
        data: {
          imageAnalysisId: "analysis-1",
          ownerUserId: "owner-1",
          providerName: "gemini",
          modelVersion: "gemini-3.6-flash",
          attemptNumber: 1,
          createdAt: now,
        },
      });
    });

    it("rejects with INVALID_ANALYSIS_STATE when no owner-scoped row is found", async () => {
      prismaMocks.txImageAnalysisFindFirst.mockResolvedValue(null);

      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "missing", ownerUserId: "owner-1", providerName: "gemini", modelVersion: "v1",
      })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
      expect(prismaMocks.txImageAnalysisUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects with CONSENT_MISSING when consent evidence was never persisted", async () => {
      prismaMocks.txImageAnalysisFindFirst.mockResolvedValue({
        id: "analysis-1", status: ANALYSIS_STATUS_QUEUED, externalAiConsentGrantedAt: null,
      });

      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "analysis-1", ownerUserId: "owner-1", providerName: "gemini", modelVersion: "v1",
      })).resolves.toEqual({ outcome: "rejected", code: "CONSENT_MISSING" });
      expect(prismaMocks.txImageAnalysisUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects with QUOTA_EXCEEDED when the owner already has 5 attempts this month, without claiming", async () => {
      prismaMocks.txImageAnalysisFindFirst.mockResolvedValue({
        id: "analysis-1",
        status: ANALYSIS_STATUS_QUEUED,
        externalAiConsentGrantedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
      prismaMocks.txAttemptFindFirst.mockResolvedValue(null);
      prismaMocks.txAttemptCount.mockResolvedValue(5);

      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "analysis-1", ownerUserId: "owner-1", providerName: "gemini", modelVersion: "v1",
      })).resolves.toEqual({ outcome: "rejected", code: "QUOTA_EXCEEDED" });
      expect(prismaMocks.txImageAnalysisUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects with INVALID_ANALYSIS_STATE when the conditional claim loses a race", async () => {
      prismaMocks.txImageAnalysisFindFirst.mockResolvedValue({
        id: "analysis-1",
        status: ANALYSIS_STATUS_QUEUED,
        externalAiConsentGrantedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
      prismaMocks.txAttemptFindFirst.mockResolvedValue(null);
      prismaMocks.txAttemptCount.mockResolvedValue(0);
      prismaMocks.txImageAnalysisUpdateMany.mockResolvedValue({ count: 0 });

      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "analysis-1", ownerUserId: "owner-1", providerName: "gemini", modelVersion: "v1",
      })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
      expect(prismaMocks.txAttemptCreate).not.toHaveBeenCalled();
    });

    it("retries on serialization conflicts and fails closed as a persistence error after exhausting attempts", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", {
        code: "P2034",
        clientVersion: "test",
      });
      prismaMocks.transaction.mockRejectedValue(conflict);

      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "analysis-1", ownerUserId: "owner-1", providerName: "gemini", modelVersion: "v1",
      })).rejects.toBeInstanceOf(ImageAnalysisJobPersistenceError);
      expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
    });

    it("fails closed without database configuration", async () => {
      prismaMocks.configured = false;
      await expect(claimQueuedAnalysisForProcessing({
        analysisId: "analysis-1", ownerUserId: "owner-1", providerName: "gemini", modelVersion: "v1",
      })).rejects.toBeInstanceOf(ImageAnalysisJobPersistenceError);
      expect(prismaMocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe("markAnalysisSucceeded", () => {
    it("transitions a processing row to draft and persists the validated payload atomically", async () => {
      prismaMocks.imageAnalysisUpdateMany.mockResolvedValue({ count: 1 });
      await expect(markAnalysisSucceeded("analysis-1", "owner-1", successPayload())).resolves.toBeUndefined();
      expect(prismaMocks.imageAnalysisUpdateMany).toHaveBeenCalledWith({
        where: { id: "analysis-1", asset: { ownerUserId: "owner-1" }, status: ANALYSIS_STATUS_PROCESSING },
        data: {
          status: ANALYSIS_STATUS_DRAFT,
          lastFailureCode: null,
          analysisPayload: successPayload().result,
          confidences: successPayload().confidences,
          providerName: "gemini",
          modelVersion: "gemini-3.6-flash",
          warnings: successPayload().warnings,
        },
      });
    });

    it("rejects the transition when the row is not in processing state", async () => {
      prismaMocks.imageAnalysisUpdateMany.mockResolvedValue({ count: 0 });
      await expect(markAnalysisSucceeded("analysis-1", "owner-1", successPayload())).rejects.toBeInstanceOf(ImageAnalysisJobStateError);
    });

    it("maps unexpected database failures to a controlled persistence error", async () => {
      prismaMocks.imageAnalysisUpdateMany.mockRejectedValueOnce(new Error("database unavailable"));
      await expect(markAnalysisSucceeded("analysis-1", "owner-1", successPayload())).rejects.toBeInstanceOf(ImageAnalysisJobPersistenceError);
    });

    it("fails closed without database configuration", async () => {
      prismaMocks.configured = false;
      await expect(markAnalysisSucceeded("analysis-1", "owner-1", successPayload())).rejects.toBeInstanceOf(ImageAnalysisJobPersistenceError);
    });
  });

  describe("markAnalysisFailed", () => {
    it("returns a retryable failure to queued when under the attempt cap", async () => {
      prismaMocks.txAttemptCount.mockResolvedValue(1);
      prismaMocks.txImageAnalysisUpdateMany.mockResolvedValue({ count: 1 });

      await expect(markAnalysisFailed("analysis-1", "owner-1", "PROVIDER_TIMEOUT")).resolves.toEqual({
        status: ANALYSIS_STATUS_QUEUED,
      });
      expect(prismaMocks.txImageAnalysisUpdateMany).toHaveBeenCalledWith({
        where: { id: "analysis-1", asset: { ownerUserId: "owner-1" }, status: ANALYSIS_STATUS_PROCESSING },
        data: { status: ANALYSIS_STATUS_QUEUED, lastFailureCode: "PROVIDER_TIMEOUT" },
      });
    });

    it("terminates a retryable failure once the attempt cap is reached", async () => {
      prismaMocks.txAttemptCount.mockResolvedValue(MAX_ATTEMPTS_PER_ANALYSIS);
      prismaMocks.txImageAnalysisUpdateMany.mockResolvedValue({ count: 1 });

      await expect(markAnalysisFailed("analysis-1", "owner-1", "NETWORK_FAILURE")).resolves.toEqual({
        status: ANALYSIS_STATUS_FAILED,
      });
    });

    it("terminates a permanent failure on the first attempt with no retry", async () => {
      prismaMocks.txAttemptCount.mockResolvedValue(1);
      prismaMocks.txImageAnalysisUpdateMany.mockResolvedValue({ count: 1 });

      await expect(markAnalysisFailed("analysis-1", "owner-1", "POLICY_VIOLATION")).resolves.toEqual({
        status: ANALYSIS_STATUS_FAILED,
      });
      expect(prismaMocks.txImageAnalysisUpdateMany).toHaveBeenCalledWith({
        where: { id: "analysis-1", asset: { ownerUserId: "owner-1" }, status: ANALYSIS_STATUS_PROCESSING },
        data: { status: ANALYSIS_STATUS_FAILED, lastFailureCode: "POLICY_VIOLATION" },
      });
    });

    it("rejects the transition when the row is not in processing state", async () => {
      prismaMocks.txAttemptCount.mockResolvedValue(1);
      prismaMocks.txImageAnalysisUpdateMany.mockResolvedValue({ count: 0 });

      await expect(markAnalysisFailed("analysis-1", "owner-1", "PROVIDER_TIMEOUT")).rejects.toBeInstanceOf(
        ImageAnalysisJobStateError,
      );
    });

    it("fails closed without database configuration", async () => {
      prismaMocks.configured = false;
      await expect(markAnalysisFailed("analysis-1", "owner-1", "PROVIDER_TIMEOUT")).rejects.toBeInstanceOf(
        ImageAnalysisJobPersistenceError,
      );
    });
  });

  describe("recordExternalAiConsent", () => {
    it("persists the consent timestamp and version for the owner-scoped row", async () => {
      prismaMocks.imageAnalysisUpdateMany.mockResolvedValue({ count: 1 });
      const grantedAt = new Date("2026-08-01T00:00:00.000Z");

      await expect(recordExternalAiConsent("analysis-1", "owner-1", "v1", grantedAt)).resolves.toBeUndefined();
      expect(prismaMocks.imageAnalysisUpdateMany).toHaveBeenCalledWith({
        where: { id: "analysis-1", asset: { ownerUserId: "owner-1" } },
        data: { externalAiConsentGrantedAt: grantedAt, externalAiConsentVersion: "v1" },
      });
    });

    it("rejects an empty consent version without writing", async () => {
      await expect(recordExternalAiConsent("analysis-1", "owner-1", "  ")).rejects.toBeInstanceOf(
        ImageAnalysisJobStateError,
      );
      expect(prismaMocks.imageAnalysisUpdateMany).not.toHaveBeenCalled();
    });

    it("rejects when no owner-scoped row matches", async () => {
      prismaMocks.imageAnalysisUpdateMany.mockResolvedValue({ count: 0 });
      await expect(recordExternalAiConsent("analysis-1", "owner-1", "v1")).rejects.toBeInstanceOf(
        ImageAnalysisJobStateError,
      );
    });

    it("fails closed without database configuration", async () => {
      prismaMocks.configured = false;
      await expect(recordExternalAiConsent("analysis-1", "owner-1", "v1")).rejects.toBeInstanceOf(
        ImageAnalysisJobPersistenceError,
      );
    });
  });

  describe("countMonthlyRealAnalysisAttempts", () => {
    it("counts ledger rows within the UTC calendar month of the given instant", async () => {
      prismaMocks.attemptCount.mockResolvedValue(3);
      await expect(countMonthlyRealAnalysisAttempts("owner-1", new Date("2026-08-15T12:00:00.000Z"))).resolves.toBe(3);
      expect(prismaMocks.attemptCount).toHaveBeenCalledWith({
        where: {
          ownerUserId: "owner-1",
          createdAt: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lt: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
      });
    });

    it("fails closed without database configuration", async () => {
      prismaMocks.configured = false;
      await expect(countMonthlyRealAnalysisAttempts("owner-1")).rejects.toBeInstanceOf(ImageAnalysisJobPersistenceError);
    });
  });
});

integrationSuite("image-analysis-job-repository (real Postgres)", () => {
  const owners = new Set<string>();

  afterEach(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.imageAnalysisProviderAttempt.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.imageAnalysis.deleteMany({ where: { asset: { ownerUserId: { in: [...owners] } } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("leaves consent fields null by default and blocks a claim until consent is recorded", async () => {
    const ownerUserId = await createOwner(owners);
    const analysisId = await createAnalysis(ownerUserId);

    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(row.externalAiConsentGrantedAt).toBeNull();
    expect(row.externalAiConsentVersion).toBeNull();

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash",
    })).resolves.toEqual({ outcome: "rejected", code: "CONSENT_MISSING" });
  });

  it("persists an exact consent timestamp and version, then unblocks a claim", async () => {
    const ownerUserId = await createOwner(owners);
    const analysisId = await createAnalysis(ownerUserId);
    const grantedAt = new Date("2026-08-01T09:00:00.000Z");

    await recordExternalAiConsent(analysisId, ownerUserId, "v1", grantedAt);

    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(row.externalAiConsentGrantedAt).toEqual(grantedAt);
    expect(row.externalAiConsentVersion).toBe("v1");

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash",
      now: new Date("2026-08-01T10:00:00.000Z"),
    })).resolves.toEqual({ outcome: "claimed", attemptNumber: 1 });
  });

  it("never counts a mock/manual-style draft analysis toward the real-provider quota", async () => {
    const ownerUserId = await createOwner(owners);
    await createAnalysis(ownerUserId, { status: ANALYSIS_STATUS_DRAFT });

    await expect(countMonthlyRealAnalysisAttempts(ownerUserId)).resolves.toBe(0);
  });

  it("allows exactly 5 real attempts per owner per calendar month and rejects the 6th", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");

    for (let i = 1; i <= 5; i += 1) {
      const analysisId = await createAnalysis(ownerUserId);
      await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);
      await expect(claimQueuedAnalysisForProcessing({
        analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
      })).resolves.toEqual({ outcome: "claimed", attemptNumber: 1 });
    }

    const sixthAnalysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(sixthAnalysisId, ownerUserId, "v1", now);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId: sixthAnalysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "QUOTA_EXCEEDED" });

    await expect(countMonthlyRealAnalysisAttempts(ownerUserId, now)).resolves.toBe(5);
  });

  it("resets the quota across a calendar month boundary", async () => {
    const ownerUserId = await createOwner(owners);
    const julyLate = new Date("2026-07-31T23:00:00.000Z");
    const augustEarly = new Date("2026-08-01T01:00:00.000Z");

    for (let i = 1; i <= 5; i += 1) {
      const analysisId = await createAnalysis(ownerUserId);
      await recordExternalAiConsent(analysisId, ownerUserId, "v1", julyLate);
      await expect(claimQueuedAnalysisForProcessing({
        analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: julyLate,
      })).resolves.toEqual({ outcome: "claimed", attemptNumber: 1 });
    }

    const augustAnalysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(augustAnalysisId, ownerUserId, "v1", augustEarly);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId: augustAnalysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: augustEarly,
    })).resolves.toEqual({ outcome: "claimed", attemptNumber: 1 });
  });

  it("under a concurrent race for the final quota slot, claims exactly one and leaves no partial state on the loser", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");

    for (let i = 1; i <= 4; i += 1) {
      const analysisId = await createAnalysis(ownerUserId);
      await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);
      await claimQueuedAnalysisForProcessing({
        analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
      });
    }

    const analysisA = await createAnalysis(ownerUserId);
    const analysisB = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisA, ownerUserId, "v1", now);
    await recordExternalAiConsent(analysisB, ownerUserId, "v1", now);

    const [resultA, resultB] = await Promise.all([
      claimQueuedAnalysisForProcessing({ analysisId: analysisA, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now }),
      claimQueuedAnalysisForProcessing({ analysisId: analysisB, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now }),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(["claimed", "rejected"]);
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId, now)).resolves.toBe(5);

    const { prisma } = await import("@/lib/prisma");
    const [rowA, rowB] = await Promise.all([
      prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisA } }),
      prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisB } }),
    ]);
    const claimedRow = resultA.outcome === "claimed" ? rowA : rowB;
    const rejectedRow = resultA.outcome === "claimed" ? rowB : rowA;
    expect(claimedRow.status).toBe(ANALYSIS_STATUS_PROCESSING);
    expect(rejectedRow.status).toBe(ANALYSIS_STATUS_QUEUED);
  });

  it("under a true concurrent race on the same analysisId, exactly one worker claims it and the other is rejected", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);

    const [resultA, resultB] = await Promise.all([
      claimQueuedAnalysisForProcessing({ analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now }),
      claimQueuedAnalysisForProcessing({ analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now }),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(["claimed", "rejected"]);

    const { prisma } = await import("@/lib/prisma");
    const [row, attempts] = await Promise.all([
      prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisId } }),
      prisma.imageAnalysisProviderAttempt.findMany({ where: { imageAnalysisId: analysisId } }),
    ]);
    expect(row.status).toBe(ANALYSIS_STATUS_PROCESSING);
    expect(attempts).toHaveLength(1);
  });

  it("rejects reclaiming a confirmed (reviewed) analysis, not just a draft one", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId, { status: "confirmed" });
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
  });

  it("rejects a duplicate trigger on an already-processing, non-stale claim and consumes no additional quota", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "claimed", attemptNumber: 1 });

    const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: fiveMinutesLater,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });

    await expect(countMonthlyRealAnalysisAttempts(ownerUserId, now)).resolves.toBe(1);
  });

  it("claims a queued analysis atomically: one ledger row and the status transition happen together", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);

    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    });

    const { prisma } = await import("@/lib/prisma");
    const [row, attempts] = await Promise.all([
      prisma.imageAnalysis.findUniqueOrThrow({ where: { id: analysisId } }),
      prisma.imageAnalysisProviderAttempt.findMany({ where: { imageAnalysisId: analysisId } }),
    ]);
    expect(row.status).toBe(ANALYSIS_STATUS_PROCESSING);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attemptNumber: 1, providerName: "gemini", modelVersion: "gemini-3.6-flash" });
  });

  it("rejects a claim before the 15-minute stale timeout, then recovers it as attemptNumber 2 after", async () => {
    const ownerUserId = await createOwner(owners);
    const t0 = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", t0);
    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: t0,
    });

    const notYetStale = new Date(t0.getTime() + 14 * 60 * 1000);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: notYetStale,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });

    const nowStale = new Date(t0.getTime() + 16 * 60 * 1000);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now: nowStale,
    })).resolves.toEqual({ outcome: "claimed", attemptNumber: 2 });
  });

  it("cannot reclaim a completed (draft) analysis", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);
    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    });
    await markAnalysisSucceeded(analysisId, ownerUserId, successPayload());

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
  });

  it("allows exactly one retry after a retryable failure, consuming new quota only on the new invocation, then fails permanently and blocks a third attempt", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);

    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    });
    await expect(markAnalysisFailed(analysisId, ownerUserId, "PROVIDER_TIMEOUT")).resolves.toEqual({
      status: ANALYSIS_STATUS_QUEUED,
    });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId, now)).resolves.toBe(1);

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "claimed", attemptNumber: 2 });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId, now)).resolves.toBe(2);

    await expect(markAnalysisFailed(analysisId, ownerUserId, "PROVIDER_TIMEOUT")).resolves.toEqual({
      status: ANALYSIS_STATUS_FAILED,
    });

    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
    await expect(countMonthlyRealAnalysisAttempts(ownerUserId, now)).resolves.toBe(2);
  });

  it("marks a permanent failure as terminally failed on the first attempt, with no retry", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerUserId);
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);
    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    });

    await expect(markAnalysisFailed(analysisId, ownerUserId, "POLICY_VIOLATION")).resolves.toEqual({
      status: ANALYSIS_STATUS_FAILED,
    });
    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
  });

  it("rejects invalid state transitions: succeeding a never-claimed row and failing an already-succeeded row", async () => {
    const ownerUserId = await createOwner(owners);
    const analysisId = await createAnalysis(ownerUserId);

    await expect(markAnalysisSucceeded(analysisId, ownerUserId, successPayload())).rejects.toBeInstanceOf(ImageAnalysisJobStateError);

    const now = new Date("2026-08-15T12:00:00.000Z");
    await recordExternalAiConsent(analysisId, ownerUserId, "v1", now);
    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    });
    await markAnalysisSucceeded(analysisId, ownerUserId, successPayload());

    await expect(markAnalysisFailed(analysisId, ownerUserId, "PROVIDER_TIMEOUT")).rejects.toBeInstanceOf(
      ImageAnalysisJobStateError,
    );
  });

  it("fails closed for restored/default-null rows: missing consent and a pre-M18 status both block a claim", async () => {
    const ownerUserId = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");

    const noConsentId = await createAnalysis(ownerUserId);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId: noConsentId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "CONSENT_MISSING" });

    const legacyStatusId = await createAnalysis(ownerUserId, { status: ANALYSIS_STATUS_DRAFT });
    await recordExternalAiConsent(legacyStatusId, ownerUserId, "v1", now);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId: legacyStatusId, ownerUserId, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });
  });

  it("enforces owner isolation across every mutation without leaking existence to a different owner", async () => {
    const ownerA = await createOwner(owners);
    const ownerB = await createOwner(owners);
    const now = new Date("2026-08-15T12:00:00.000Z");
    const analysisId = await createAnalysis(ownerA);
    await recordExternalAiConsent(analysisId, ownerA, "v1", now);

    await expect(recordExternalAiConsent(analysisId, ownerB, "v1", now)).rejects.toBeInstanceOf(ImageAnalysisJobStateError);
    await expect(claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId: ownerB, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    })).resolves.toEqual({ outcome: "rejected", code: "INVALID_ANALYSIS_STATE" });

    await claimQueuedAnalysisForProcessing({
      analysisId, ownerUserId: ownerA, providerName: "gemini", modelVersion: "gemini-3.6-flash", now,
    });
    await expect(markAnalysisSucceeded(analysisId, ownerB, successPayload())).rejects.toBeInstanceOf(ImageAnalysisJobStateError);
    await expect(markAnalysisFailed(analysisId, ownerB, "PROVIDER_TIMEOUT")).rejects.toBeInstanceOf(
      ImageAnalysisJobStateError,
    );
  });
});

function successPayload(): {
  result: Prisma.InputJsonValue;
  confidences: Prisma.InputJsonValue;
  providerName: string;
  modelVersion: string;
  warnings: string[];
} {
  return {
    result: { hairType: "curly", density: "high", porosity: "medium" },
    confidences: { hairType: 0.9, density: 0.8, porosity: 0.7 },
    providerName: "gemini",
    modelVersion: "gemini-3.6-flash",
    warnings: ["Automated analysis limited to hairType, density, and porosity (Gemini provider)."],
  };
}

async function createOwner(owners: Set<string>): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@image-analysis.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  return ownerUserId;
}

async function createAnalysis(ownerUserId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const asset = await prisma.imageAsset.create({
    data: {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      ownerUserId,
      clientId: randomUUID(),
      storagePath: "pending",
    },
  });
  const analysis = await prisma.imageAnalysis.create({
    data: {
      assetId: asset.id,
      status: ANALYSIS_STATUS_QUEUED,
      ...overrides,
    },
  });
  return analysis.id;
}
