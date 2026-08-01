import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ObjectIdentity, ObjectMetadata, ObjectReference, PutObjectInput, StoredObject } from "./object-storage";
import { ObjectStorageError } from "./object-storage-errors";
import {
  evaluateStorageReadiness,
  resetStorageReadinessCanaryStateForTests,
  type StorageReadinessCanaryDependencies,
} from "./storage-readiness-canary";

const NOW = new Date("2026-08-01T12:00:00.000Z");

function fixedNow(instant: Date = NOW): () => Date {
  return () => instant;
}

const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  STORAGE_READINESS_CANARY_ENABLED: "true",
  OBJECT_STORAGE_BACKEND: "s3",
  OBJECT_STORAGE_BUCKET_ALIAS: "test-alias",
  OBJECT_STORAGE_BUCKET: "test-bucket",
  OBJECT_STORAGE_REGION: "us-east-1",
  OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "none",
  OBJECT_STORAGE_WRITE_MODE: "enabled",
};

interface FakeStorageOptions {
  putImpl?: (input: PutObjectInput) => Promise<ObjectReference>;
  headImpl?: (identity: ObjectIdentity) => Promise<ObjectMetadata>;
  getImpl?: (identity: ObjectIdentity) => Promise<StoredObject>;
  deleteImpl?: (identity: ObjectIdentity) => Promise<void>;
  neverResolvePut?: boolean;
}

function fakeObjectStorage(options: FakeStorageOptions = {}) {
  const objects = new Map<string, { content: Uint8Array; contentSha256: string; versionId: string; etag: string }>();
  let versionCounter = 0;

  const defaultPut = async (input: PutObjectInput): Promise<ObjectReference> => {
    versionCounter += 1;
    const versionId = `v${versionCounter}`;
    const etag = `etag-${versionCounter}`;
    objects.set(`${input.key}:${versionId}`, { content: input.body, contentSha256: input.contentSha256, versionId, etag });
    return {
      backend: "s3",
      bucketAlias: "test-alias",
      key: input.key,
      versionId,
      etag,
      contentSha256: input.contentSha256,
      sizeBytes: input.body.byteLength,
    };
  };

  const defaultHead = async (identity: ObjectIdentity): Promise<ObjectMetadata> => {
    const stored = identity.versionId ? objects.get(`${identity.key}:${identity.versionId}`) : undefined;
    if (!stored) throw new ObjectStorageError("not_found");
    return {
      bucketAlias: identity.bucketAlias,
      key: identity.key,
      versionId: stored.versionId,
      etag: stored.etag,
      contentSha256: stored.contentSha256,
      sizeBytes: stored.content.byteLength,
      contentType: "application/octet-stream",
    };
  };

  const defaultGet = async (identity: ObjectIdentity): Promise<StoredObject> => {
    const stored = identity.versionId ? objects.get(`${identity.key}:${identity.versionId}`) : undefined;
    if (!stored) throw new ObjectStorageError("not_found");
    return {
      bucketAlias: identity.bucketAlias,
      key: identity.key,
      versionId: stored.versionId,
      etag: stored.etag,
      contentSha256: stored.contentSha256,
      sizeBytes: stored.content.byteLength,
      contentType: "application/octet-stream",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(stored.content);
          controller.close();
        },
      }),
    };
  };

  const defaultDelete = async (identity: ObjectIdentity): Promise<void> => {
    if (identity.versionId) objects.delete(`${identity.key}:${identity.versionId}`);
  };

  const put = vi.fn(options.neverResolvePut ? () => new Promise<ObjectReference>(() => {}) : (options.putImpl ?? defaultPut));
  const head = vi.fn(options.headImpl ?? defaultHead);
  const get = vi.fn(options.getImpl ?? defaultGet);
  const del = vi.fn(options.deleteImpl ?? defaultDelete);

  return { put, get, head, delete: del, objects };
}

interface DepsOverrides {
  env?: Partial<NodeJS.ProcessEnv>;
  mode?: StorageReadinessCanaryDependencies["mode"];
  now?: () => Date;
  resolveObjectStorage?: StorageReadinessCanaryDependencies["resolveObjectStorage"];
  storage?: ReturnType<typeof fakeObjectStorage>;
}

function deps(overrides: DepsOverrides = {}): StorageReadinessCanaryDependencies {
  const storage = overrides.storage ?? fakeObjectStorage();
  return {
    env: { ...BASE_ENV, ...(overrides.env ?? {}) },
    mode: overrides.mode ?? "test",
    now: overrides.now ?? fixedNow(),
    resolveObjectStorage: overrides.resolveObjectStorage ?? (async () => storage as never),
  };
}

describe("evaluateStorageReadiness", () => {
  beforeEach(() => {
    resetStorageReadinessCanaryStateForTests();
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("1. disabled canary -> NOT_READY, zero storage calls", async () => {
    const resolveObjectStorage = vi.fn();
    const result = await evaluateStorageReadiness(
      deps({ env: { STORAGE_READINESS_CANARY_ENABLED: undefined }, resolveObjectStorage }),
    );

    expect(result).toEqual({
      status: "NOT_READY",
      code: "STORAGE_READINESS_CANARY_DISABLED",
      message: expect.any(String),
    });
    expect(resolveObjectStorage).not.toHaveBeenCalled();
  });

  it("1b. a malformed enable value is treated as disabled", async () => {
    const resolveObjectStorage = vi.fn();
    const result = await evaluateStorageReadiness(
      deps({ env: { STORAGE_READINESS_CANARY_ENABLED: "1" }, resolveObjectStorage }),
    );
    expect(result.code).toBe("STORAGE_READINESS_CANARY_DISABLED");
    expect(resolveObjectStorage).not.toHaveBeenCalled();
  });

  it("2. invalid production configuration -> NOT_READY, zero storage calls", async () => {
    const resolveObjectStorage = vi.fn();
    // Production mode rejects OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION=none.
    const result = await evaluateStorageReadiness(deps({ mode: "production", resolveObjectStorage }));

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_CONFIGURATION_INVALID");
    expect(resolveObjectStorage).not.toHaveBeenCalled();
  });

  it("3. write mode disabled -> NOT_READY, zero storage calls", async () => {
    const resolveObjectStorage = vi.fn();
    const result = await evaluateStorageReadiness(
      deps({ env: { OBJECT_STORAGE_WRITE_MODE: "disabled" }, resolveObjectStorage }),
    );

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_WRITE_MODE_DISABLED");
    expect(resolveObjectStorage).not.toHaveBeenCalled();
  });

  it("4. successful complete canary -> READY, exact-version put/head/get/delete", async () => {
    const storage = fakeObjectStorage();
    const result = await evaluateStorageReadiness(deps({ storage }));

    expect(result).toEqual({ status: "READY", code: "STORAGE_CANARY_SUCCEEDED", message: expect.any(String) });
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.head).toHaveBeenCalledTimes(2); // integrity head + post-delete confirmation head
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledTimes(1);

    const putKey = storage.put.mock.calls[0][0].key as string;
    const headArgs = storage.head.mock.calls[0][0] as ObjectIdentity;
    const getArgs = storage.get.mock.calls[0][0] as ObjectIdentity;
    const deleteArgs = storage.delete.mock.calls[0][0] as ObjectIdentity;

    expect(headArgs.versionId).toBeTruthy();
    expect(getArgs.versionId).toBeTruthy();
    expect(deleteArgs.versionId).toBeTruthy();
    expect(headArgs.key).toBe(putKey);
    expect(getArgs.key).toBe(putKey);
    expect(deleteArgs.key).toBe(putKey);
  });

  it("5. canary namespace is reserved and never resembles a customer image-asset key", async () => {
    const storage = fakeObjectStorage();
    await evaluateStorageReadiness(deps({ storage }));

    const key = storage.put.mock.calls[0][0].key as string;
    expect(key.startsWith("internal/readiness-canary/")).toBe(true);
    expect(key.startsWith("owners/")).toBe(false);
  });

  it("6. size mismatch on head -> INTEGRITY_FAILED, cleanup still attempted", async () => {
    const storage = fakeObjectStorage({
      headImpl: async (identity) => ({
        bucketAlias: identity.bucketAlias,
        key: identity.key,
        versionId: identity.versionId ?? null,
        etag: "etag-1",
        contentSha256: "a".repeat(64),
        sizeBytes: 999999,
        contentType: "application/octet-stream",
      }),
    });

    const result = await evaluateStorageReadiness(deps({ storage }));

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_CANARY_INTEGRITY_FAILED");
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it("7. hash mismatch on head -> INTEGRITY_FAILED", async () => {
    const storage = fakeObjectStorage({
      headImpl: async (identity) => ({
        bucketAlias: identity.bucketAlias,
        key: identity.key,
        versionId: identity.versionId ?? null,
        etag: "etag-1",
        contentSha256: "0".repeat(64),
        sizeBytes: 50,
        contentType: "application/octet-stream",
      }),
    });

    const result = await evaluateStorageReadiness(deps({ storage }));
    expect(result.code).toBe("STORAGE_CANARY_INTEGRITY_FAILED");
  });

  it("8. write failure -> WRITE_FAILED, no cleanup attempted (nothing was written)", async () => {
    const storage = fakeObjectStorage({ putImpl: async () => { throw new Error("boom"); } });
    const result = await evaluateStorageReadiness(deps({ storage }));

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_CANARY_WRITE_FAILED");
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("9. read failure (head) -> READ_FAILED, cleanup still attempted", async () => {
    const storage = fakeObjectStorage({ headImpl: async () => { throw new Error("boom"); } });
    const result = await evaluateStorageReadiness(deps({ storage }));

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_CANARY_READ_FAILED");
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it("10. read failure (get) -> READ_FAILED", async () => {
    const storage = fakeObjectStorage({ getImpl: async () => { throw new Error("boom"); } });
    const result = await evaluateStorageReadiness(deps({ storage }));
    expect(result.code).toBe("STORAGE_CANARY_READ_FAILED");
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it("11. delete failure -> DELETE_FAILED even though the core lifecycle succeeded", async () => {
    const storage = fakeObjectStorage({ deleteImpl: async () => { throw new Error("boom"); } });
    const result = await evaluateStorageReadiness(deps({ storage }));

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_CANARY_DELETE_FAILED");
  });

  it("12. deletion-confirmation failure -> DELETE_UNCONFIRMED (delete() resolves but object is still visible)", async () => {
    const storage = fakeObjectStorage({
      deleteImpl: async () => undefined, // reports success but never actually removes the object
    });
    const result = await evaluateStorageReadiness(deps({ storage }));

    expect(result.status).toBe("NOT_READY");
    expect(result.code).toBe("STORAGE_CANARY_DELETE_UNCONFIRMED");
  });

  it("13. cleanup is attempted after a partial (mid-sequence) failure", async () => {
    const storage = fakeObjectStorage({ getImpl: async () => { throw new Error("boom"); } });
    await evaluateStorageReadiness(deps({ storage }));
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it("14. timeout -> NOT_READY with a sanitized TIMEOUT code", async () => {
    vi.useFakeTimers();
    try {
      const storage = fakeObjectStorage({ neverResolvePut: true });
      const promise = evaluateStorageReadiness(deps({ storage }));
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(result.status).toBe("NOT_READY");
      expect(result.code).toBe("STORAGE_CANARY_TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("15. concurrent readiness calls single-flight into one canary execution", async () => {
    const storage = fakeObjectStorage();
    const [first, second] = await Promise.all([
      evaluateStorageReadiness(deps({ storage })),
      evaluateStorageReadiness(deps({ storage })),
    ]);

    expect(first).toEqual(second);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it("16. a successful result is served from cache on a subsequent call (no new storage calls)", async () => {
    const storage = fakeObjectStorage();
    const clock = fixedNow();
    await evaluateStorageReadiness(deps({ storage, now: clock }));
    const second = await evaluateStorageReadiness(deps({ storage, now: clock }));

    expect(second.status).toBe("READY");
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it("17. a cached success expires after 5 minutes and triggers a fresh canary", async () => {
    const storage = fakeObjectStorage();
    let current = NOW;
    const clock = () => current;

    await evaluateStorageReadiness(deps({ storage, now: clock }));
    current = new Date(NOW.getTime() + 5 * 60 * 1000 + 1);
    await evaluateStorageReadiness(deps({ storage, now: clock }));

    expect(storage.put).toHaveBeenCalledTimes(2);
  });

  it("17b. a cached success just under 5 minutes is still served from cache", async () => {
    const storage = fakeObjectStorage();
    let current = NOW;
    const clock = () => current;

    await evaluateStorageReadiness(deps({ storage, now: clock }));
    current = new Date(NOW.getTime() + 5 * 60 * 1000 - 1);
    await evaluateStorageReadiness(deps({ storage, now: clock }));

    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it("18. a cached failure expires after 30 seconds and triggers a fresh canary", async () => {
    const storage = fakeObjectStorage({ putImpl: async () => { throw new Error("boom"); } });
    let current = NOW;
    const clock = () => current;

    const first = await evaluateStorageReadiness(deps({ storage, now: clock }));
    expect(first.status).toBe("NOT_READY");
    current = new Date(NOW.getTime() + 30_000 + 1);
    await evaluateStorageReadiness(deps({ storage, now: clock }));

    expect(storage.put).toHaveBeenCalledTimes(2);
  });

  it("18b. a cached failure under 30 seconds is still served from cache", async () => {
    const storage = fakeObjectStorage({ putImpl: async () => { throw new Error("boom"); } });
    let current = NOW;
    const clock = () => current;

    await evaluateStorageReadiness(deps({ storage, now: clock }));
    current = new Date(NOW.getTime() + 29_000);
    await evaluateStorageReadiness(deps({ storage, now: clock }));

    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it("19. a configuration identity change invalidates the cache even within the success TTL", async () => {
    const storage = fakeObjectStorage();
    const clock = fixedNow();
    await evaluateStorageReadiness(deps({ storage, now: clock, env: { OBJECT_STORAGE_BUCKET_ALIAS: "alias-a" } }));
    await evaluateStorageReadiness(deps({ storage, now: clock, env: { OBJECT_STORAGE_BUCKET_ALIAS: "alias-b" } }));

    expect(storage.put).toHaveBeenCalledTimes(2);
  });

  it("20. the process-local reset seam clears the cache for a subsequent call", async () => {
    const storage = fakeObjectStorage();
    const clock = fixedNow();
    await evaluateStorageReadiness(deps({ storage, now: clock }));

    resetStorageReadinessCanaryStateForTests();
    await evaluateStorageReadiness(deps({ storage, now: clock }));

    expect(storage.put).toHaveBeenCalledTimes(2);
  });

  it("21. no sensitive infrastructure detail ever appears in the returned result", async () => {
    const storage = fakeObjectStorage({ putImpl: async () => { throw new Error("s3://secret-bucket/leaked endpoint AKIAFAKEKEY"); } });
    const result = await evaluateStorageReadiness(deps({ storage, env: { OBJECT_STORAGE_BUCKET: "super-secret-physical-bucket" } }));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-physical-bucket");
    expect(serialized).not.toContain("AKIAFAKEKEY");
    expect(serialized).not.toContain("s3://");
  });

  it("22. a timed-out attempt does not poison a later refresh once it settles", async () => {
    vi.useFakeTimers();
    try {
      const hangingStorage = fakeObjectStorage({ neverResolvePut: true });
      const timedOut = evaluateStorageReadiness(deps({ storage: hangingStorage, now: fixedNow() }));
      await vi.advanceTimersByTimeAsync(15_000);
      const firstResult = await timedOut;
      expect(firstResult.code).toBe("STORAGE_CANARY_TIMEOUT");

      vi.useRealTimers();
      const healthyStorage = fakeObjectStorage();
      const later = new Date(NOW.getTime() + 60_000);
      const secondResult = await evaluateStorageReadiness(deps({ storage: healthyStorage, now: fixedNow(later) }));
      expect(secondResult.status).toBe("READY");
    } finally {
      vi.useRealTimers();
    }
  });

  it("23. the canary payload never exceeds 256 bytes and carries no infrastructure detail", async () => {
    const storage = fakeObjectStorage();
    await evaluateStorageReadiness(deps({ storage }));

    const body = storage.put.mock.calls[0][0].body as Uint8Array;
    expect(body.byteLength).toBeLessThanOrEqual(256);
    const text = new TextDecoder().decode(body);
    expect(text).not.toMatch(/test-bucket|test-alias|us-east-1/);
  });
});
