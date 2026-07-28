import { describe, expect, it, vi } from "vitest";

import type { ObjectStorage } from "./object-storage";
import type { S3ObjectStorageConfig } from "./object-storage-config";
import {
  OBJECT_STORAGE_ALIAS_RESOLVER_UNAVAILABLE,
  ObjectStorageAliasResolverError,
  createObjectStorageAliasResolver,
} from "./object-storage-alias-resolver";

function s3Config(): S3ObjectStorageConfig {
  return {
    backend: "s3",
    bucketAlias: "images",
    bucket: "physical-secret-bucket",
    region: "test-1",
    endpoint: "https://secret-storage.example.test",
    forcePathStyle: false,
    serverSideEncryption: "AES256",
    prefix: "v1",
    requestTimeoutMs: 1000,
  };
}

function fakeProvider(): ObjectStorage {
  return {
    put: vi.fn(),
    get: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
  };
}

function expectSafeResolverError(error: unknown): void {
  expect(error).toBeInstanceOf(ObjectStorageAliasResolverError);
  expect(error).toMatchObject({
    code: OBJECT_STORAGE_ALIAS_RESOLVER_UNAVAILABLE,
    message: "Object storage alias resolution is unavailable.",
  });
  expect(String((error as Error).message)).not.toMatch(
    /endpoint|bucket|access.?key|secret.?key|credential|physical-secret|secret-storage/i,
  );
}

describe("object storage alias resolver", () => {
  it("resolves a configured S3 alias to the injected provider", async () => {
    const provider = fakeProvider();
    const resolver = createObjectStorageAliasResolver({
      environment: {},
      mode: "test",
      loadConfig: vi.fn(() => s3Config()),
      createProvider: vi.fn(() => provider),
    });

    await expect(resolver("images")).resolves.toBe(provider);
  });

  it("returns null for an unknown alias", async () => {
    const createProvider = vi.fn(() => fakeProvider());
    const resolver = createObjectStorageAliasResolver({
      environment: {},
      mode: "test",
      loadConfig: vi.fn(() => s3Config()),
      createProvider,
    });

    await expect(resolver("unknown")).resolves.toBeNull();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", {}],
    ["local", { OBJECT_STORAGE_BACKEND: "local" }],
    ["invalid", { OBJECT_STORAGE_BACKEND: "invalid", OBJECT_STORAGE_BUCKET: "physical-secret-bucket" }],
    ["incomplete", { OBJECT_STORAGE_BACKEND: "s3", OBJECT_STORAGE_BUCKET_ALIAS: "images" }],
  ])("fails closed for %s configuration", async (_label, environment) => {
    const resolver = createObjectStorageAliasResolver({ environment, mode: "test" });

    try {
      await resolver("images");
      throw new Error("Expected resolver failure.");
    } catch (error) {
      expectSafeResolverError(error);
    }
  });

  it("allows read-only resolution when write mode is disabled", async () => {
    const provider = fakeProvider();
    const resolver = createObjectStorageAliasResolver({
      environment: {
        OBJECT_STORAGE_BACKEND: "s3",
        OBJECT_STORAGE_BUCKET_ALIAS: "images",
        OBJECT_STORAGE_BUCKET: "physical-secret-bucket",
        OBJECT_STORAGE_REGION: "test-1",
        OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "none",
        OBJECT_STORAGE_WRITE_MODE: "disabled",
      },
      mode: "test",
      createProvider: vi.fn(() => provider),
    });

    await expect(resolver("images")).resolves.toBe(provider);
  });

  it("does not evaluate configuration or construct a provider when created", () => {
    const loadConfig = vi.fn(() => s3Config());
    const createProvider = vi.fn(() => fakeProvider());

    createObjectStorageAliasResolver({ environment: {}, mode: "test", loadConfig, createProvider });

    expect(loadConfig).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("evaluates configuration once and does not construct a provider for unknown aliases", async () => {
    const loadConfig = vi.fn(() => s3Config());
    const createProvider = vi.fn(() => fakeProvider());
    const resolver = createObjectStorageAliasResolver({ environment: {}, mode: "test", loadConfig, createProvider });

    await expect(resolver("unknown-a")).resolves.toBeNull();
    await expect(resolver("unknown-b")).resolves.toBeNull();

    expect(loadConfig).toHaveBeenCalledOnce();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("constructs the provider exactly once at the first configured alias", async () => {
    const provider = fakeProvider();
    const loadConfig = vi.fn(() => s3Config());
    const createProvider = vi.fn(() => provider);
    const resolver = createObjectStorageAliasResolver({ environment: {}, mode: "test", loadConfig, createProvider });

    await expect(resolver("images")).resolves.toBe(provider);
    await expect(resolver("images")).resolves.toBe(provider);
    await expect(resolver("unknown")).resolves.toBeNull();

    expect(loadConfig).toHaveBeenCalledOnce();
    expect(createProvider).toHaveBeenCalledOnce();
    expect(createProvider).toHaveBeenCalledWith(s3Config());
  });

  it("does not share provider instances across resolver closures", async () => {
    const firstProvider = fakeProvider();
    const secondProvider = fakeProvider();
    const createProvider = vi.fn()
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(secondProvider);
    const dependencies = {
      environment: {},
      mode: "test" as const,
      loadConfig: vi.fn(() => s3Config()),
      createProvider,
    };

    const firstResolver = createObjectStorageAliasResolver(dependencies);
    const secondResolver = createObjectStorageAliasResolver(dependencies);

    await expect(firstResolver("images")).resolves.toBe(firstProvider);
    await expect(secondResolver("images")).resolves.toBe(secondProvider);
    expect(createProvider).toHaveBeenCalledTimes(2);
  });

  it("memoizes configuration failure without retrying the loader", async () => {
    const loadConfig = vi.fn(() => {
      throw new Error("endpoint=https://secret-storage.example.test bucket=physical-secret-bucket credentials=raw");
    });
    const createProvider = vi.fn(() => fakeProvider());
    const resolver = createObjectStorageAliasResolver({ environment: {}, mode: "test", loadConfig, createProvider });

    for (const alias of ["images", "other"]) {
      try {
        await resolver(alias);
        throw new Error("Expected resolver failure.");
      } catch (error) {
        expectSafeResolverError(error);
      }
    }
    expect(loadConfig).toHaveBeenCalledOnce();
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("reduces provider factory failure to a safe memoized error", async () => {
    const createProvider = vi.fn(() => {
      throw new Error("endpoint=https://secret-storage.example.test bucket=physical-secret-bucket accessKey=raw");
    });
    const resolver = createObjectStorageAliasResolver({
      environment: {},
      mode: "test",
      loadConfig: vi.fn(() => s3Config()),
      createProvider,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await resolver("images");
        throw new Error("Expected resolver failure.");
      } catch (error) {
        expectSafeResolverError(error);
      }
    }
    expect(createProvider).toHaveBeenCalledOnce();
  });

  it("does not invoke any provider operation or network-facing method", async () => {
    const provider = fakeProvider();
    const resolver = createObjectStorageAliasResolver({
      environment: {},
      mode: "test",
      loadConfig: vi.fn(() => s3Config()),
      createProvider: vi.fn(() => provider),
    });

    await resolver("images");

    expect(provider.put).not.toHaveBeenCalled();
    expect(provider.get).not.toHaveBeenCalled();
    expect(provider.head).not.toHaveBeenCalled();
    expect(provider.delete).not.toHaveBeenCalled();
  });
});
