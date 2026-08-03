import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ sessionFindUnique: vi.fn() }));
const serviceMock = vi.hoisted(() => ({ processImageAnalysis: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findUnique: prismaMock.sessionFindUnique } },
}));

vi.mock("@/lib/image-analysis-processing-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image-analysis-processing-service")>();
  return { ...actual, processImageAnalysis: serviceMock.processImageAnalysis };
});

import { PROCESSING_RESULT_HTTP_STATUS } from "@/lib/image-analysis-processing-service";

import { POST } from "./route";

function invoke(assetId: string, token?: string, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/image-analyses/${assetId}/process`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return POST(request as never, { params: Promise.resolve({ assetId }) });
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function activeSession(user: { id: string; role: string }) {
  return { user, expiresAt: new Date(Date.now() + 60_000) };
}

function expiredSession(user: { id: string; role: string }) {
  return { user, expiresAt: new Date(Date.now() - 1000) };
}

describe("POST /api/v1/image-analyses/[assetId]/process", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    serviceMock.processImageAnalysis.mockReset();
  });

  it("returns 401 without a bearer token, never calling the service", async () => {
    const response = await invoke(randomUUID());
    expect(response.status).toBe(401);
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke(randomUUID(), "bogus-token");
    expect(response.status).toBe(401);
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired session and never reaches the processing service", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId, role: "professional" }));

    const response = await invoke(randomUUID(), "token");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it("returns 403 for a disallowed role, never calling the service", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: randomUUID(), role: "client" }));
    const response = await invoke(randomUUID(), "token");
    expect(response.status).toBe(403);
    expect(serviceMock.processImageAnalysis).not.toHaveBeenCalled();
  });

  it.each(["professional", "salon", "admin"])("allows role %s through to the service", async (role) => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role }));
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis: sanitizedFixture() });

    const response = await invoke(randomUUID(), "token");
    expect(response.status).toBe(200);
    expect(serviceMock.processImageAnalysis).toHaveBeenCalledWith(expect.any(String), userId);
  });

  it("derives owner strictly from the authenticated session, ignoring any body-supplied owner/provider/consent fields", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis: sanitizedFixture() });

    await invoke("asset-1", "token", {
      ownerUserId: "attacker-supplied-owner",
      provider: "mock-deterministic",
      model: "attacker-model",
      consent: true,
      quotaOverride: 999,
      retryCount: 0,
      storagePath: "/etc/passwd",
      bucket: "attacker-bucket",
      key: "attacker-key",
      versionId: "attacker-version",
      imageBytes: "ZmFrZQ==",
    });

    expect(serviceMock.processImageAnalysis).toHaveBeenCalledWith("asset-1", userId);
    expect(serviceMock.processImageAnalysis).toHaveBeenCalledTimes(1);
  });

  it.each(Object.entries(PROCESSING_RESULT_HTTP_STATUS))(
    "maps failure code %s to the approved HTTP status",
    async (code, status) => {
      const userId = randomUUID();
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
      serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "failed", code });

      const response = await invoke(randomUUID(), "token");
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: code });
    },
  );

  it("returns 200 with the sanitized analysis for a succeeded outcome", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    const analysis = sanitizedFixture();
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis });

    const response = await invoke(randomUUID(), "token");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, outcome: "succeeded", analysis });
  });

  it("returns 200 with the sanitized analysis for a current_state outcome (idempotent, no reprocessing)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    const analysis = sanitizedFixture();
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "current_state", analysis });

    const response = await invoke(randomUUID(), "token");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, outcome: "current_state", analysis });
  });

  it("returns a sanitized 500 if the service throws unexpectedly, never leaking internal details", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.processImageAnalysis.mockRejectedValue(new Error("unexpected internal database detail"));

    const response = await invoke(randomUUID(), "token");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("unexpected internal database detail");
  });

  it("applies the ANALYZE rate limiter as a secondary check, returning 429 once exceeded", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.processImageAnalysis.mockResolvedValue({ outcome: "succeeded", analysis: sanitizedFixture() });

    let lastResponse: Response | undefined;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await invoke(randomUUID(), "token");
    }
    expect(lastResponse?.status).toBe(429);
    // The 20 allowed calls all reached the service; only the 21st was throttled.
    expect(serviceMock.processImageAnalysis).toHaveBeenCalledTimes(20);
  });
});
