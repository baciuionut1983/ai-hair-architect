import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { fileURLToPath } from "url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const { PRISMA_MOCK, REPOSITORY_FIND_MOCK, RESOLVE_STORAGE_MOCK } = vi.hoisted(() => ({
  PRISMA_MOCK: { videoAsset: { findFirst: vi.fn() } },
  REPOSITORY_FIND_MOCK: vi.fn(),
  RESOLVE_STORAGE_MOCK: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: () => true, prisma: PRISMA_MOCK }));

vi.mock("@/lib/image-storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-storage")>("@/lib/image-storage");
  return { ConfinedImageStorageError: actual.ConfinedImageStorageError, createConfinedImageReadStream: vi.fn() };
});

vi.mock("@/lib/video-asset-storage-repository", () => ({
  VideoAssetStorageRepository: vi.fn().mockImplementation(() => ({ findObjectReferenceByOwner: REPOSITORY_FIND_MOCK })),
}));

vi.mock("@/lib/object-storage-alias-resolver", () => ({
  createObjectStorageAliasResolver: vi.fn(() => RESOLVE_STORAGE_MOCK),
}));

import { GET } from "./route";
import { ConfinedImageStorageError, createConfinedImageReadStream } from "@/lib/image-storage";
import { ObjectStorageError } from "@/lib/object-storage-errors";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";
const OWNER = { id: OWNER_ID, email: "owner@example.com", role: "professional", locale: "en" };

function ctx(id: string = ASSET_ID) {
  return { params: Promise.resolve({ id }) };
}

function nodeReadable(content: string) {
  return Readable.from([Buffer.from(content)]);
}

const BASE_ASSET = {
  id: ASSET_ID,
  ownerUserId: OWNER_ID,
  mimeType: "video/mp4",
  sizeBytes: 5,
  durationSeconds: 6,
  storagePath: "/storage/x/video.mp4",
  storageBackend: null,
  storageBucketAlias: null,
  storageKey: null,
  storageVersionId: null,
  storageEtag: null,
  contentSha256: null,
};

// Video UI, Result Visualization -- mirrors image-assets/[id]/content's own
// exact route-test conventions (this app's own established, proven
// pattern for a durable authenticated content-serving route), adapted for
// VideoAsset's genuinely simpler schema (no deletedAt, no storageState, no
// fileName column).
describe("GET /api/v1/video-assets/[id]/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  });

  it("returns 401 when unauthenticated, never reaching the asset lookup", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(401);
    expect(PRISMA_MOCK.videoAsset.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 for an absent asset", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(404);
  });

  it("treats another owner's asset identically to absent -- owner-scoped query, never fetched", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue(null);
    await GET(new Request("http://localhost/api"), ctx());
    expect(PRISMA_MOCK.videoAsset.findFirst).toHaveBeenCalledWith({ where: { id: ASSET_ID, ownerUserId: OWNER_ID } });
  });

  it("legacy-local: streams bytes with safe headers", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue(BASE_ASSET);
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({ stream: nodeReadable("hello") as never, sizeBytes: 5 });

    const response = await GET(new Request("http://localhost/api"), ctx());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Content-Disposition")).toBe(`inline; filename="video-demonstration-${ASSET_ID}.mp4"`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Length")).toBe("5");
  });

  it("legacy-local: a 'pending' (never-written) row is 409, never streamed", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storagePath: "pending" });
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(409);
    expect(createConfinedImageReadStream).not.toHaveBeenCalled();
  });

  it("legacy-local: unsafe path / symlink escape maps to sanitized 409, no path leak", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue(BASE_ASSET);
    vi.mocked(createConfinedImageReadStream).mockRejectedValue(new ConfinedImageStorageError());

    const response = await GET(new Request("http://localhost/api"), ctx());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("/storage/x/video.mp4");
  });

  it("object-backed: streams bytes using the exact persisted key and version, never 'latest'", async () => {
    const storedGet = vi.fn().mockResolvedValue({
      bucketAlias: "primary-videos",
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: "version-1",
      etag: "etag-1",
      contentSha256: "a".repeat(64),
      sizeBytes: 5,
      contentType: "video/mp4",
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("hello")); controller.close(); } }),
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({ get: storedGet });
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: "s3" });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: "s3",
      bucketAlias: "primary-videos",
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: "version-1",
      etag: "etag-1",
      contentSha256: "a".repeat(64),
      sizeBytes: 5,
    });

    const response = await GET(new Request("http://localhost/api"), ctx());

    expect(response.status).toBe(200);
    expect(storedGet).toHaveBeenCalledWith({
      bucketAlias: "primary-videos",
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: "version-1",
    });
  });

  it("object-backed: repository reports no reference -> 404", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: "s3" });
    REPOSITORY_FIND_MOCK.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(404);
  });

  it("object-backed: an incomplete/missing-version reference fails closed at 409, never requests 'latest'", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: "s3" });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: "s3",
      bucketAlias: "primary-videos",
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: null,
      etag: null,
      contentSha256: "a".repeat(64),
      sizeBytes: 5,
    });

    const response = await GET(new Request("http://localhost/api"), ctx());

    expect(response.status).toBe(409);
    expect(RESOLVE_STORAGE_MOCK).not.toHaveBeenCalled();
  });

  it("object-backed: provider access-denied failure is sanitized (no bucket/key/credential detail)", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: "s3" });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: "s3", bucketAlias: "super-secret-video-bucket",
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: "version-1", etag: "etag-1", contentSha256: "a".repeat(64), sizeBytes: 5,
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({ get: vi.fn().mockRejectedValue(new ObjectStorageError("access_denied")) });

    const response = await GET(new Request("http://localhost/api"), ctx());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("super-secret-video-bucket");
  });

  it("an unrecognized storageBackend value fails closed at 409 (never crashes, never streams)", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: "unexpected-value" });
    const response = await GET(new Request("http://localhost/api"), ctx());
    expect(response.status).toBe(409);
  });

  it("does not implement range/partial-content support (source-level check, documented as a known V1 limitation)", () => {
    const source = readSourceFile();
    expect(source).not.toMatch(/Content-Range|status: 206/);
  });

  it("never exposes a provider bucket/key/version header", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue(BASE_ASSET);
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({ stream: nodeReadable("hello") as never, sizeBytes: 5 });

    const response = await GET(new Request("http://localhost/api"), ctx());

    expect(response.headers.get("X-Storage-Backend")).toBeNull();
    expect(response.headers.get("X-Bucket")).toBeNull();
    expect(response.headers.get("X-Object-Key")).toBeNull();
  });

  it("no fallback between backends: legacy-local branch never calls the object storage resolver", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue(BASE_ASSET);
    vi.mocked(createConfinedImageReadStream).mockResolvedValue({ stream: nodeReadable("hello") as never, sizeBytes: 5 });

    await GET(new Request("http://localhost/api"), ctx());

    expect(RESOLVE_STORAGE_MOCK).not.toHaveBeenCalled();
  });

  it("no fallback between backends: object-backed branch never calls the local confined reader", async () => {
    PRISMA_MOCK.videoAsset.findFirst.mockResolvedValue({ ...BASE_ASSET, storageBackend: "s3" });
    REPOSITORY_FIND_MOCK.mockResolvedValue({
      backend: "s3", bucketAlias: "primary-videos",
      key: `v1/owners/${OWNER_ID}/assets/${ASSET_ID}/original`,
      versionId: "version-1", etag: "etag-1", contentSha256: "a".repeat(64), sizeBytes: 5,
    });
    RESOLVE_STORAGE_MOCK.mockResolvedValue({
      get: vi.fn().mockResolvedValue({
        bucketAlias: "primary-videos", key: "k", versionId: "version-1", etag: "etag-1",
        contentSha256: "a".repeat(64), sizeBytes: 5, contentType: "video/mp4",
        body: new ReadableStream({ start(c) { c.close(); } }),
      }),
    });

    await GET(new Request("http://localhost/api"), ctx());

    expect(createConfinedImageReadStream).not.toHaveBeenCalled();
  });
});

function readSourceFile(): string {
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
}
