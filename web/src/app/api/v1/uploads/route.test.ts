import { randomUUID } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageProcessingError } from "@/lib/image-normalizer";

const prismaMock = vi.hoisted(() => ({ sessionFindUnique: vi.fn(), clientFindFirst: vi.fn() }));
const serviceMock = vi.hoisted(() => ({ uploadAndAnalyzeImages: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => true,
  prisma: {
    session: { findUnique: prismaMock.sessionFindUnique },
    client: { findFirst: prismaMock.clientFindFirst },
  },
}));

const { ObjectStorageWriteModeRequiredError } = vi.hoisted(() => {
  class ObjectStorageWriteModeRequiredError extends Error {
    constructor() {
      super("Image storage is not configured for persistent uploads.");
      this.name = "ObjectStorageWriteModeRequiredError";
    }
  }
  return { ObjectStorageWriteModeRequiredError };
});

vi.mock("@/lib/image-analysis-service", () => ({
  uploadAndAnalyzeImages: serviceMock.uploadAndAnalyzeImages,
  ObjectStorageWriteModeRequiredError,
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

type ClientFindFirstArgs = { where: { id?: string; ownerUserId?: string; deletedAt?: unknown } };

function clientRow(id: string, ownerUserId: string) {
  return {
    id,
    ownerUserId,
    fullName: "Test Client",
    email: null,
    phone: null,
    notes: null,
    deletedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

// A minimal stand-in for the "Client" table: findFirst yields a row only when
// both id and ownerUserId match, exactly like Postgres evaluating
// findClientForOwner's owner-scoped WHERE clause. This is what makes the "no
// existence leak" assertions real -- a cross-owner id and an unknown id both
// genuinely fail the same predicate, rather than a mock hand-returning null.
function useClientsTable(rows: ReadonlyArray<{ id: string; ownerUserId: string }>): void {
  prismaMock.clientFindFirst.mockImplementation(async (args: ClientFindFirstArgs) => {
    const where = args.where;
    const match = rows.find((row) => row.id === where.id && row.ownerUserId === where.ownerUserId);
    return match ? clientRow(match.id, match.ownerUserId) : null;
  });
}

describe("POST /api/v1/uploads", () => {
  beforeEach(() => {
    prismaMock.sessionFindUnique.mockReset();
    prismaMock.clientFindFirst.mockReset();
    serviceMock.uploadAndAnalyzeImages.mockReset();
    // Permissive default: the authenticated user owns whatever client they
    // name, so every pre-existing test keeps exercising the unchanged
    // success/error paths. The ownership-enforcement suite below overrides
    // this with useClientsTable() to drive the real check.
    prismaMock.clientFindFirst.mockImplementation(async (args: ClientFindFirstArgs) =>
      clientRow(String(args.where.id), String(args.where.ownerUserId)),
    );
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

  it("returns a safe, generic 422 message (never the raw sharp/libvips error) when image processing fails", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.uploadAndAnalyzeImages.mockRejectedValue(
      new ImageProcessingError("Could not process this image. Please try a different photo."),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await invoke("token", "client-1");

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ error: "Could not process this image. Please try a different photo." });
    expect(body.error).not.toMatch(/vips/i);
    consoleErrorSpy.mockRestore();
  });

  it("logs the failure server-side (safe fields only) even though the client only sees the generic message", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.uploadAndAnalyzeImages.mockRejectedValue(
      new ImageProcessingError("Could not process this image. Please try a different photo."),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await invoke("token", "client-1");

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ gate: "IMAGE_UPLOAD", status: "FAILED", errorName: "ImageProcessingError" });
    consoleErrorSpy.mockRestore();
  });

  it("still returns 400 (unchanged status) for a pre-existing validation error, e.g. an unsupported format", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.uploadAndAnalyzeImages.mockRejectedValue(new Error("Unsupported format: image/gif"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await invoke("token", "client-1");

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Unsupported format: image/gif" });
    consoleErrorSpy.mockRestore();
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

  // Regression: a stylist's uploaded photo silently vanished after a
  // routine production redeploy, because uploads silently fell back to
  // this container's own ephemeral local filesystem. image-analysis-
  // service.ts now fails closed in production instead -- this locks in
  // that the route surfaces it as a clear 503 (a server configuration
  // problem, never the caller's fault), not a misleading 400/422.
  it("returns a fail-closed 503 (never 400/422) when the service refuses to persist to ephemeral storage in production", async () => {
    const userId = randomUUID();
    prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
    serviceMock.uploadAndAnalyzeImages.mockRejectedValue(new ObjectStorageWriteModeRequiredError());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await invoke("token", "client-1");

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "Image storage is not configured for persistent uploads." });
    consoleErrorSpy.mockRestore();
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

  // Phase 2 Stage 0 hardening: POST /api/v1/uploads used to pass the
  // multipart `clientId` straight through to uploadAndAnalyzeImages, which
  // creates an ImageAsset row with that clientId + the caller's own
  // ownerUserId -- with no check that the clientId actually belongs to the
  // caller. ImageAsset is the one client-scoped model with no database-level
  // composite FK to Client, so nothing else caught it. The route now runs
  // the same owner-scoped resolveOwnedClient() check every sibling
  // client-scoped route uses, before any row is created.
  describe("client ownership enforcement", () => {
    it("never looks up a client for an unauthenticated upload, and never calls the upload service", async () => {
      const response = await invoke(undefined, "client-1");

      expect(response.status).toBe(401);
      expect(prismaMock.clientFindFirst).not.toHaveBeenCalled();
      expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
    });

    it("still uploads, unchanged, for a client the user genuinely owns", async () => {
      const userId = randomUUID();
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
      useClientsTable([{ id: "owned-client", ownerUserId: userId }]);
      serviceMock.uploadAndAnalyzeImages.mockResolvedValue([
        { asset: { id: "asset-1", fileName: "photo-0.jpg" }, analysis: { id: "analysis-1", status: "draft" } },
      ]);

      const response = await invoke("token", "owned-client");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        assets: [{ assetId: "asset-1", analysisId: "analysis-1", fileName: "photo-0.jpg", status: "draft" }],
      });
      expect(serviceMock.uploadAndAnalyzeImages).toHaveBeenCalledWith(userId, "owned-client", expect.any(Array));
    });

    it("rejects an upload whose clientId belongs to a DIFFERENT owner, without leaking that the client exists", async () => {
      const attacker = randomUUID();
      const victimOwner = randomUUID();
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: attacker, role: "professional" }));
      useClientsTable([{ id: "victims-client", ownerUserId: victimOwner }]);

      const response = await invoke("token", "victims-client");

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({ error: "Client not found." });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(victimOwner);
      expect(serialized).not.toContain("victims-client");
      expect(serialized).not.toMatch(/forbidden|another|owner|permission|exists/i);
      expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
    });

    it("rejects an upload for a clientId that exists nowhere", async () => {
      const userId = randomUUID();
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
      useClientsTable([]);

      const response = await invoke("token", "no-such-client");

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Client not found." });
      expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
    });

    it("returns an identical rejection (status + exact body bytes + content-type) for a cross-owner clientId and a nonexistent one", async () => {
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: randomUUID(), role: "professional" }));

      useClientsTable([{ id: "real-elsewhere", ownerUserId: randomUUID() }]);
      const crossOwner = await invoke("token", "real-elsewhere");
      const crossOwnerText = await crossOwner.text();

      useClientsTable([]);
      const nonexistent = await invoke("token", "ghost");
      const nonexistentText = await nonexistent.text();

      expect(crossOwner.status).toBe(404);
      expect(nonexistent.status).toBe(crossOwner.status);
      expect(crossOwnerText).toBe(nonexistentText);
      expect(crossOwner.headers.get("content-type")).toBe(nonexistent.headers.get("content-type"));
      expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
    });

    it("fails closed with 503 when client persistence is unavailable, never reaching the upload service", async () => {
      const userId = randomUUID();
      prismaMock.sessionFindUnique.mockResolvedValue(activeSession({ id: userId, role: "professional" }));
      prismaMock.clientFindFirst.mockRejectedValue(new Error("connection terminated unexpectedly"));

      const response = await invoke("token", "client-1");

      expect(response.status).toBe(503);
      expect(serviceMock.uploadAndAnalyzeImages).not.toHaveBeenCalled();
    });
  });
});
