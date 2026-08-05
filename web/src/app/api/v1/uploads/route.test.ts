import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ sessionFindUnique: vi.fn() }));
const serviceMock = vi.hoisted(() => ({ uploadAndAnalyzeImages: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => true,
  prisma: { session: { findUnique: prismaMock.sessionFindUnique } },
}));

vi.mock("@/lib/image-analysis-service", () => ({
  uploadAndAnalyzeImages: serviceMock.uploadAndAnalyzeImages,
}));

import { POST } from "./route";

function buildFormData(clientId?: string, fileCount = 1): FormData {
  const formData = new FormData();
  if (clientId !== undefined) formData.set("clientId", clientId);
  for (let i = 0; i < fileCount; i += 1) {
    formData.append("files", new File([new Uint8Array([1, 2, 3])], `photo-${i}.jpg`, { type: "image/jpeg" }));
  }
  return formData;
}

function invoke(
  token: string | undefined,
  clientId?: string,
  fileCount = 1,
  cookie?: string,
): Promise<Response> {
  const request = new Request("http://localhost/api/v1/uploads", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: buildFormData(clientId, fileCount),
  });
  attachCookies(request, cookie);
  return POST(request as never);
}

function attachCookies(request: Request, cookie: string | undefined): void {
  Object.defineProperty(request, "cookies", {
    value: { get: (name: string) => (cookie && name === "aha_session" ? { name, value: cookie } : undefined) },
  });
}

function activeSession(user: { id: string; role: string }) {
  return { user, expiresAt: new Date(Date.now() + 60_000) };
}

function expiredSession(user: { id: string; role: string }) {
  return { user, expiresAt: new Date(Date.now() - 1000) };
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

describe("POST /api/v1/uploads", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    serviceMock.uploadAndAnalyzeImages.mockReset();
  });

  it("returns 401 without a bearer token, never touching the upload service", async () => {
    const response = await invoke(undefined, "client-1");
    expect(response.status).toBe(401);
    expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown session token", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(null);
    const response = await invoke("bogus-token", "client-1");
    expect(response.status).toBe(401);
    expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired session and never reaches the upload service", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(expiredSession({ id: userId, role: "professional" }));

    const response = await invoke("token", "client-1");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
  });

  it("returns 403 for a disallowed role, never touching the upload service", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: randomUUID(), role: "client" }));
    const response = await invoke("token", "client-1");
    expect(response.status).toBe(403);
    expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
  });

  it("preserves existing behavior for a valid session: uploads and returns the response shape with a real analysisId (M21 fix)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.uploadAndAnalyzeImages.mockResolvedValue([
      { asset: { id: "asset-1", fileName: "photo-0.jpg" }, analysis: { id: "analysis-1", status: "draft" } },
    ]);

    const response = await invoke("token", "client-1");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      assets: [{ assetId: "asset-1", analysisId: "analysis-1", fileName: "photo-0.jpg", status: "draft" }],
    });
    expect(serviceMock.uploadAndAnalyzeImages).toHaveBeenCalledWith(userId, "client-1", expect.any(Array));
  });

  it("returns the analysis's real id, not its status string, as analysisId (pre-M21 this field held the status)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.uploadAndAnalyzeImages.mockResolvedValue([
      { asset: { id: "asset-1", fileName: "photo-0.jpg" }, analysis: { id: "distinct-analysis-id", status: "draft" } },
    ]);

    const response = await invoke("token", "client-1");
    const body = await response.json();

    expect(body.assets[0].analysisId).toBe("distinct-analysis-id");
    expect(body.assets[0].analysisId).not.toBe(body.assets[0].status);
  });

  it("returns 400 when clientId or files are missing, never reaching the upload service", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));

    const response = await invoke("token", undefined, 0);
    expect(response.status).toBe(400);
    expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
  });

  it("accepts a valid Postgres-backed cookie session (M31 GO-4 dual resolver)", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: fullUser(userId, "professional"),
    });
    serviceMock.uploadAndAnalyzeImages.mockResolvedValue([
      { asset: { id: "asset-1", fileName: "photo-0.jpg" }, analysis: { id: "analysis-1", status: "draft" } },
    ]);

    const response = await invoke(undefined, "client-1", 1, "cookie-token");

    expect(response.status).toBe(200);
    expect(serviceMock.uploadAndAnalyzeImages).toHaveBeenCalledWith(userId, "client-1", expect.any(Array));
  });

  it("rejects an expired cookie session with no fallback to the in-memory session store", async () => {
    prismaMock.sessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      user: fullUser(randomUUID(), "professional"),
    });

    const response = await invoke(undefined, "client-1", 1, "expired-cookie-token");

    expect(response.status).toBe(401);
    expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
  });
});
