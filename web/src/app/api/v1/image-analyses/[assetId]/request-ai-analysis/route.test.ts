import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ sessionFindUnique: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  queueAnalysisForExternalProvider: vi.fn(),
  recordExternalAiConsent: vi.fn(),
}));
const serviceMock = vi.hoisted(() => ({ processImageAnalysis: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => true,
  prisma: { session: { findUnique: prismaMock.sessionFindUnique } },
}));

vi.mock("@/lib/image-analysis-job-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image-analysis-job-repository")>();
  return {
    ...actual,
    queueAnalysisForExternalProvider: repositoryMock.queueAnalysisForExternalProvider,
    recordExternalAiConsent: repositoryMock.recordExternalAiConsent,
  };
});

vi.mock("@/lib/image-analysis-processing-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image-analysis-processing-service")>();
  return { ...actual, processImageAnalysis: serviceMock.processImageAnalysis };
});

import { ImageAnalysisJobStateError } from "@/lib/image-analysis-job-repository";
import { PROCESSING_RESULT_HTTP_STATUS } from "@/lib/image-analysis-processing-service";

import { POST } from "./route";

function invoke(assetId: string, token?: string, body?: unknown, cookie?: string): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/image-analyses/${assetId}/request-ai-analysis`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  attachCookies(request, cookie);
  return POST(request as never, { params: Promise.resolve({ assetId }) });
}

function attachCookies(request: Request, cookie: string | undefined): void {
  Object.defineProperty(request, "cookies", {
    value: { get: (name: string) => (cookie && name === "aha_session" ? { name, value: cookie } : undefined) },
  });
}

function fullUser(id: string, role: string) {
  return {
    id,
    email: `${id}@example.com`,
    role,
    locale: "en",
    passwordHash: "hashed",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function sanitizedFixture() {
  return {
    id: "analysis-1",
    status: "draft",
    providerName: "gemini",
    modelVersion: "gemini-3.6-flash",
    analysisPayload: { hairType: "curly", density: "high", porosity: "medium" },
    confidences: { hairType: 0.9, density: 0.8, porosity: 0.7 },
    warnings: [],
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

function activeSession(user: { id: string; role: string }) {
  return { user, expiresAt: new Date(Date.now() + 60_000) };
}

function expiredSession(user: { id: string; role: string }) {
  return { user, expiresAt: new Date(Date.now() - 1000) };
}

function mockHappyPathThrough(userId: string) {
  prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
  repositoryMock.queueAnalysisForExternalProvider.mockResolvedValue({ analysisId: "analysis-1", created: true });
  repositoryMock.recordExternalAiConsent.mockResolvedValue(undefined);
  serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis: sanitizedFixture() });
}

describe("POST /api/v1/image-analyses/[assetId]/request-ai-analysis", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    repositoryMock.queueAnalysisForExternalProvider.mockReset();
    repositoryMock.recordExternalAiConsent.mockReset();
    serviceMock.processImageAnalysis.mockReset();
  });

  it("returns 401 without a bearer token, never touching the repository or service", async () => {
    const response = await invoke(randomUUID(), undefined, { consent: true });
    expect(response.status).toBe(401);
    expect(repositoryMock.queueAnalysisForExternalProvider).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke(randomUUID(), "bogus-token", { consent: true });
    expect(response.status).toBe(401);
  });

  it("returns 401 for an expired session and never reaches business logic (no queue/consent/analysis calls)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId, role: "professional" }));

    const response = await invoke(randomUUID(), "token", { consent: true });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(repositoryMock.queueAnalysisForExternalProvider).not.toHaveBeenCalled();
    expect(repositoryMock.recordExternalAiConsent).not.toHaveBeenCalled();
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it("returns 403 for a disallowed role, never touching the repository or service", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: randomUUID(), role: "client" }));
    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(403);
    expect(repositoryMock.queueAnalysisForExternalProvider).not.toHaveBeenCalled();
  });

  it.each(["professional", "salon", "admin"])("allows role %s through when consent is given", async (role) => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role }));
    repositoryMock.queueAnalysisForExternalProvider.mockResolvedValue({ analysisId: "analysis-1", created: true });
    repositoryMock.recordExternalAiConsent.mockResolvedValue(undefined);
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis: sanitizedFixture() });

    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(200);
    expect(repositoryMock.queueAnalysisForExternalProvider).toHaveBeenCalledWith(expect.any(String), userId);
  });

  it("rejects with CONSENT_REQUIRED when consent is not explicitly true, without creating any row", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));

    const withoutBody = await invoke(randomUUID(), "token");
    expect(withoutBody.status).toBe(403);
    await expect(withoutBody.json()).resolves.toEqual({ error: "CONSENT_REQUIRED" });

    const consentFalse = await invoke(randomUUID(), "token", { consent: false });
    expect(consentFalse.status).toBe(403);

    const malformedBody = await invoke(randomUUID(), "token", "not-an-object");
    expect(malformedBody.status).toBe(403);

    expect(repositoryMock.queueAnalysisForExternalProvider).not.toHaveBeenCalled();
    expect(repositoryMock.recordExternalAiConsent).not.toHaveBeenCalled();
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it("ignores any body-supplied owner/provider/model/quota/retry/storage fields, deriving owner only from the session", async () => {
    const userId = randomUUID();
    mockHappyPathThrough(userId);

    await invoke("asset-1", "token", {
      consent: true,
      ownerUserId: "attacker-supplied-owner",
      provider: "mock-deterministic",
      model: "attacker-model",
      quotaOverride: 999,
      retryCount: 0,
      storagePath: "/etc/passwd",
      bucket: "attacker-bucket",
      key: "attacker-key",
      versionId: "attacker-version",
    });

    expect(repositoryMock.queueAnalysisForExternalProvider).toHaveBeenCalledWith("asset-1", userId);
    expect(serviceMock.processImageAnalysis).toHaveBeenCalledWith("asset-1", userId);
  });

  it("records consent using a fixed server-side version string, never a client-supplied one", async () => {
    const userId = randomUUID();
    mockHappyPathThrough(userId);

    await invoke("asset-1", "token", { consent: true, consentVersion: "attacker-version-string" });

    expect(repositoryMock.recordExternalAiConsent).toHaveBeenCalledWith("analysis-1", userId, "v1");
  });

  it("returns 404 ANALYSIS_NOT_FOUND when the asset cannot be queued, without recording consent or invoking the service", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    repositoryMock.queueAnalysisForExternalProvider.mockRejectedValue(new ImageAnalysisJobStateError());

    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "ANALYSIS_NOT_FOUND" });
    expect(repositoryMock.recordExternalAiConsent).not.toHaveBeenCalled();
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it("returns a sanitized 500 when queueing fails unexpectedly", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    repositoryMock.queueAnalysisForExternalProvider.mockRejectedValue(new Error("unexpected database detail"));

    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("unexpected database detail");
  });

  it("returns a sanitized 500 when consent recording fails, without invoking the service", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    repositoryMock.queueAnalysisForExternalProvider.mockResolvedValue({ analysisId: "analysis-1", created: true });
    repositoryMock.recordExternalAiConsent.mockRejectedValue(new Error("unexpected internal detail"));

    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(500);
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it.each(Object.entries(PROCESSING_RESULT_HTTP_STATUS))(
    "maps a processing failure code %s to the approved HTTP status",
    async (code, status) => {
      const userId = randomUUID();
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
      repositoryMock.queueAnalysisForExternalProvider.mockResolvedValue({ analysisId: "analysis-1", created: true });
      repositoryMock.recordExternalAiConsent.mockResolvedValue(undefined);
      serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "failed", code });

      const response = await invoke(randomUUID(), "token", { consent: true });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: code });
    },
  );

  it("returns 200 with the sanitized analysis on success", async () => {
    const userId = randomUUID();
    mockHappyPathThrough(userId);

    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      outcome: "succeeded",
      analysis: sanitizedFixture(),
    });
  });

  it("returns a sanitized 500 if the service throws unexpectedly, never leaking internal details", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    repositoryMock.queueAnalysisForExternalProvider.mockResolvedValue({ analysisId: "analysis-1", created: true });
    repositoryMock.recordExternalAiConsent.mockResolvedValue(undefined);
    serviceMock.processImageAnalysis.mockRejectedValue(new Error("raw provider detail leak attempt"));

    const response = await invoke(randomUUID(), "token", { consent: true });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("raw provider detail leak attempt");
  });

  it("applies the ANALYZE rate limiter as a secondary check, returning 429 once exceeded", async () => {
    const userId = randomUUID();
    mockHappyPathThrough(userId);

    let lastResponse: Response | undefined;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await invoke(randomUUID(), "token", { consent: true });
    }
    expect(lastResponse?.status).toBe(429);
    expect(serviceMock.processImageAnalysis).toHaveBeenCalledTimes(20);
  });

  it("accepts a valid Postgres-backed cookie session (M31 GO-4 dual resolver)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000), user: fullUser(userId, "professional") });
    repositoryMock.queueAnalysisForExternalProvider.mockResolvedValue({ analysisId: "analysis-1", created: true });
    repositoryMock.recordExternalAiConsent.mockResolvedValue(undefined);
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis: sanitizedFixture() });

    const response = await invoke(randomUUID(), undefined, { consent: true }, "cookie-token");

    expect(response.status).toBe(200);
  });

  it("rejects an expired cookie session with no fallback to the in-memory session store", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1000), user: fullUser(randomUUID(), "professional") });

    const response = await invoke(randomUUID(), undefined, { consent: true }, "expired-cookie-token");

    expect(response.status).toBe(401);
    expect(repositoryMock.queueAnalysisForExternalProvider).not.toHaveBeenCalled();
  });
});
