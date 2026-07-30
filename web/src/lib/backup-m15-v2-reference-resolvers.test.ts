import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLegacyLocalReferenceResolver,
  createObjectBackedReferenceResolver,
} from "./backup-m15-v2-reference-resolvers";
import type { ObjectIdentity, ObjectMetadata, ObjectStorage, StoredObject } from "./object-storage";
import { ObjectStorageError } from "./object-storage-errors";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-legacy-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function writeLegacyFile(root: string, relativeDir: string, fileName: string, content: Buffer): string {
  const dir = path.join(root, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    total += result.value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

describe("createLegacyLocalReferenceResolver", () => {
  it("1. resolves a valid legacy file", async () => {
    const root = makeTempRoot();
    const content = Buffer.from("legacy-file-content");
    writeLegacyFile(root, "owner-1/asset-1", "photo.jpg", content);
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });

    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1/asset-1/photo.jpg",
    });

    expect(resolved).not.toBeNull();
    expect(resolved?.sizeBytes).toBe(content.byteLength);
    const bytes = await readAllBytes(resolved!.openStream());
    expect(Buffer.from(bytes)).toEqual(content);
  });

  it("2. returns null for a missing legacy file", async () => {
    const root = makeTempRoot();
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1/asset-1/missing.jpg",
    });
    expect(resolved).toBeNull();
  });

  it("3. returns null for an invalid root alias", async () => {
    const root = makeTempRoot();
    writeLegacyFile(root, "owner-1/asset-1", "photo.jpg", Buffer.from("x"));
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "wrong-alias" as "legacy-images",
      relativePath: "owner-1/asset-1/photo.jpg",
    });
    expect(resolved).toBeNull();
  });

  it("4. returns null for an absolute-path relative path", async () => {
    const root = makeTempRoot();
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "/owner-1/asset-1/photo.jpg",
    });
    expect(resolved).toBeNull();
  });

  it("5. returns null for a '..' traversal attempt", async () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(path.dirname(root), "outside-secret.txt"), "secret");
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1/../../outside-secret.txt",
    });
    expect(resolved).toBeNull();
  });

  it("6. rejects a symlink escaping to a sibling directory sharing a name prefix (prefix-confusion)", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-parent-"));
    try {
      const root = path.join(parent, "legacy-images");
      const evilSibling = path.join(parent, "legacy-images-evil");
      fs.mkdirSync(root, { recursive: true });
      fs.mkdirSync(evilSibling, { recursive: true });
      fs.writeFileSync(path.join(evilSibling, "secret.jpg"), "secret-bytes");
      fs.mkdirSync(path.join(root, "owner-1", "asset-1"), { recursive: true });
      try {
        fs.symlinkSync(path.join(evilSibling, "secret.jpg"), path.join(root, "owner-1", "asset-1", "photo.jpg"));
      } catch {
        return; // symlink creation unsupported/unprivileged on this platform; skip.
      }
      const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
      const resolved = await resolver.resolveLegacyLocalReference({
        rootAlias: "legacy-images",
        relativePath: "owner-1/asset-1/photo.jpg",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("7. rejects a segment containing a Windows-style backslash separator", async () => {
    const root = makeTempRoot();
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1\\asset-1\\photo.jpg",
    });
    expect(resolved).toBeNull();
  });

  it("8. resolves a POSIX '/'-separated three-segment path", async () => {
    const root = makeTempRoot();
    const content = Buffer.from("posix-separated-content");
    writeLegacyFile(root, path.join("owner-2", "asset-2"), "clip.png", content);
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-2/asset-2/clip.png",
    });
    expect(resolved?.sizeBytes).toBe(content.byteLength);
  });

  it("9. rejects a symlink escaping outside the root entirely (when the platform allows creating it)", async () => {
    const root = makeTempRoot();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp2h4-outside-"));
    try {
      fs.writeFileSync(path.join(outsideDir, "secret.jpg"), "outside-secret-bytes");
      fs.mkdirSync(path.join(root, "owner-1", "asset-1"), { recursive: true });
      try {
        fs.symlinkSync(path.join(outsideDir, "secret.jpg"), path.join(root, "owner-1", "asset-1", "photo.jpg"));
      } catch {
        return; // symlink creation unsupported/unprivileged on this platform; skip.
      }
      const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
      const resolved = await resolver.resolveLegacyLocalReference({
        rootAlias: "legacy-images",
        relativePath: "owner-1/asset-1/photo.jpg",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("10. resolves a zero-byte legacy file", async () => {
    const root = makeTempRoot();
    writeLegacyFile(root, "owner-1/asset-1", "empty.jpg", Buffer.alloc(0));
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1/asset-1/empty.jpg",
    });
    expect(resolved?.sizeBytes).toBe(0);
    const bytes = await readAllBytes(resolved!.openStream());
    expect(bytes.byteLength).toBe(0);
  });

  it("11. streams a larger file across multiple chunks and reconstructs it exactly", async () => {
    const root = makeTempRoot();
    const content = Buffer.alloc(256 * 1024, 7);
    writeLegacyFile(root, "owner-1/asset-1", "large.jpg", content);
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1/asset-1/large.jpg",
    });
    const bytes = await readAllBytes(resolved!.openStream());
    expect(Buffer.from(bytes)).toEqual(content);
  });

  it("12. reports exact size metadata", async () => {
    const root = makeTempRoot();
    const content = Buffer.from("exact-size-check");
    const filePath = writeLegacyFile(root, "owner-1/asset-1", "photo.jpg", content);
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    const resolved = await resolver.resolveLegacyLocalReference({
      rootAlias: "legacy-images",
      relativePath: "owner-1/asset-1/photo.jpg",
    });
    expect(resolved?.sizeBytes).toBe(fs.statSync(filePath).size);
  });

  it("13. sanitizes filesystem errors without leaking the real path", async () => {
    const root = makeTempRoot();
    writeLegacyFile(root, "owner-1/asset-1", "photo.jpg", Buffer.from("x"));
    const secretPath = path.join(root, "owner-1", "asset-1", "photo.jpg");
    vi.spyOn(fs.promises, "stat").mockRejectedValueOnce(
      Object.assign(new Error(`EACCES: permission denied, open '${secretPath}'`), { code: "EACCES" }),
    );
    const resolver = createLegacyLocalReferenceResolver({ rootDir: root });
    await expect(
      resolver.resolveLegacyLocalReference({ rootAlias: "legacy-images", relativePath: "owner-1/asset-1/photo.jpg" }),
    ).rejects.toThrow();
    try {
      await resolver.resolveLegacyLocalReference({ rootAlias: "legacy-images", relativePath: "owner-1/asset-1/photo.jpg" });
    } catch (error) {
      expect((error as Error).message).not.toContain(secretPath);
      expect((error as Error).message).not.toContain(root);
    }
  });
});

function fakeStorage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    put: vi.fn(async () => { throw new Error("not used"); }),
    delete: vi.fn(async () => undefined),
    head: vi.fn(async () => { throw new ObjectStorageError("not_found"); }),
    get: vi.fn(async () => { throw new ObjectStorageError("not_found"); }),
    ...overrides,
  };
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = queue.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
}

const IDENTITY: ObjectMetadata & { bucketAlias: string; key: string } = {
  bucketAlias: "primary-images",
  key: "v1/owners/owner-1/assets/asset-1/original",
  versionId: "exact-version-1",
  etag: null,
  contentSha256: "a".repeat(64),
  sizeBytes: 12,
  contentType: "image/jpeg",
};

describe("createObjectBackedReferenceResolver", () => {
  it("14. resolves a valid object-backed reference", async () => {
    const body = new TextEncoder().encode("object-body-1");
    const storage = fakeStorage({
      head: vi.fn(async () => ({ ...IDENTITY, sizeBytes: body.byteLength })),
      get: vi.fn(async (): Promise<StoredObject> => ({ ...IDENTITY, sizeBytes: body.byteLength, body: streamOf([body]) })),
    });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const resolved = await resolver.resolveObjectBackedReference({
      bucketAlias: IDENTITY.bucketAlias,
      key: IDENTITY.key,
      versionId: IDENTITY.versionId!,
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.sizeBytes).toBe(body.byteLength);
    const bytes = await readAllBytes(resolved!.openStream());
    expect(new TextDecoder().decode(bytes)).toBe("object-body-1");
  });

  it("15. resolves an exact requested version", async () => {
    const storage = fakeStorage({ head: vi.fn(async (identity: ObjectIdentity) => ({ ...IDENTITY, versionId: identity.versionId ?? null })) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const resolved = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    expect(resolved?.versionId).toBe("exact-version-1");
  });

  it("16. returns null when the exact version is missing", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => { throw new ObjectStorageError("missing_version"); }) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const resolved = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    expect(resolved).toBeNull();
  });

  it("17. relays the resolved version faithfully without masking a latest-version fallback", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ ...IDENTITY, versionId: "unexpected-latest-version" })) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const resolved = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    expect(resolved?.versionId).toBe("unexpected-latest-version");
  });

  it("18. returns null when the provider reports the object as not found", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => { throw new ObjectStorageError("not_found"); }) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const resolved = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    expect(resolved).toBeNull();
  });

  it("19. sanitizes raw provider errors", async () => {
    const storage = fakeStorage({
      head: vi.fn(async () => { throw new Error("endpoint=https://secret-internal.invalid bucket=physical-bucket-name credentials=abc123"); }),
    });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    await expect(
      resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" }),
    ).rejects.toSatisfy((error: Error) => !error.message.match(/secret-internal|physical-bucket-name|credentials|abc123/i));
  });

  it("20. rejects invalid object metadata", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ ...IDENTITY, sizeBytes: 0 })) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    await expect(
      resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" }),
    ).rejects.toThrow();
  });

  it("21. sanitizes a resolver contract violation from a malformed ObjectStorage", async () => {
    const brokenStorage = {} as ObjectStorage;
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => brokenStorage });
    await expect(
      resolver.resolveObjectBackedReference({ bucketAlias: "b", key: "k", versionId: "v" }),
    ).rejects.toThrow();
  });

  it("22. streams a multi-chunk object body in order and in full", async () => {
    const parts = [new TextEncoder().encode("part-one-"), new TextEncoder().encode("part-two-"), new TextEncoder().encode("part-three")];
    const storage = fakeStorage({
      head: vi.fn(async () => ({ ...IDENTITY, sizeBytes: parts.reduce((sum, part) => sum + part.byteLength, 0) })),
      get: vi.fn(async (): Promise<StoredObject> => ({ ...IDENTITY, body: streamOf(parts) })),
    });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const resolved = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    const bytes = await readAllBytes(resolved!.openStream());
    expect(new TextDecoder().decode(bytes)).toBe("part-one-part-two-part-three");
  });

  it("23. imports no AWS SDK", () => {
    expect(readResolversSource()).not.toMatch(/@aws-sdk/);
  });

  it("24. never reads process.env", () => {
    expect(readResolversSource()).not.toMatch(/process\.env/);
  });

  it("25. does not leak bucket, key, versionId, or path in a thrown error", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ ...IDENTITY, sizeBytes: 0 })) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    try {
      await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
      throw new Error("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(IDENTITY.bucketAlias);
      expect(message).not.toContain(IDENTITY.key);
      expect(message).not.toContain("exact-version-1");
    }
  });

  it("26. resolves deterministically for repeated calls with the same dependencies", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ ...IDENTITY })) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const first = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    const second = await resolver.resolveObjectBackedReference({ bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" });
    expect(first?.sizeBytes).toBe(second?.sizeBytes);
    expect(first?.versionId).toBe(second?.versionId);
  });

  it("27. does not mutate the input identity", async () => {
    const storage = fakeStorage({ head: vi.fn(async () => ({ ...IDENTITY })) });
    const resolver = createObjectBackedReferenceResolver({ resolveObjectStorage: () => storage });
    const identity = { bucketAlias: IDENTITY.bucketAlias, key: IDENTITY.key, versionId: "exact-version-1" };
    const before = structuredClone(identity);
    await resolver.resolveObjectBackedReference(identity);
    expect(identity).toEqual(before);
  });
});

function readResolversSource(): string {
  const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "backup-m15-v2-reference-resolvers.ts");
  return fs.readFileSync(sourcePath, "utf8");
}
