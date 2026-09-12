import { describe, expect, it } from "vitest";

import {
  loadObjectStorageConfig,
  resolveObjectStorageConnectSrcOrigin,
  validateObjectStorageConfig,
  validateObjectStorageWriteMode
} from "./object-storage-config";

describe("object storage configuration", () => {
  it("allows an inactive backend in development and test", () => {
    expect(validateObjectStorageConfig({}, "development")).toEqual({ ok: true, config: null, issues: [] });
    expect(validateObjectStorageConfig({}, "test")).toEqual({ ok: true, config: null, issues: [] });
  });

  it("requires an explicit encryption mode when s3 is active outside production", () => {
    for (const mode of ["development", "test"] as const) {
      const result = validateObjectStorageConfig(s3Env(), mode);
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_REQUIRED"
      );
    }
  });

  it("requires a complete s3 configuration in production", () => {
    const result = validateObjectStorageConfig({ OBJECT_STORAGE_BACKEND: "s3" }, "production");
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.variable)).toEqual([
      "OBJECT_STORAGE_BUCKET_ALIAS",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_REGION",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION"
    ]);
  });

  it("rejects unknown encryption and production without an explicit mode", () => {
    expect(validateObjectStorageConfig(s3Env({
      OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "provider-default"
    }), "test").issues.map((issue) => issue.code)).toContain(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_INVALID"
    );
    expect(validateObjectStorageConfig(s3Env(), "production").issues.map((issue) => issue.code)).toContain(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_REQUIRED"
    );
  });

  it("accepts explicit AES256 in production and rejects none", () => {
    expect(validateObjectStorageConfig(s3Env({
      OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "AES256"
    }), "production").ok).toBe(true);
    expect(validateObjectStorageConfig(s3Env({
      OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "none"
    }), "production").issues.map((issue) => issue.code)).toContain(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_INVALID"
    );
  });

  it("rejects local storage and insecure endpoints in production", () => {
    expect(validateObjectStorageConfig({ OBJECT_STORAGE_BACKEND: "local" }, "production").ok).toBe(false);
    const result = validateObjectStorageConfig(s3Env({ OBJECT_STORAGE_ENDPOINT: "http://storage.internal" }), "production");
    expect(result.issues.map((issue) => issue.code)).toContain("OBJECT_STORAGE_ENDPOINT_INVALID");
  });

  it("accepts an explicit isolated S3-compatible test configuration", () => {
    const validation = validateObjectStorageConfig(s3Env({
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
      OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "none",
      OBJECT_STORAGE_REQUEST_TIMEOUT_MS: "1500"
    }), "test");
    expect(validation.ok).toBe(true);
    expect(validation.config).toMatchObject({
      backend: "s3",
      forcePathStyle: true,
      serverSideEncryption: "none",
      requestTimeoutMs: 1500
    });
  });

  it("throws only a safe typed error when loading invalid configuration", () => {
    expect(() => loadObjectStorageConfig({ OBJECT_STORAGE_BUCKET: "physical-secret-name" }, "production"))
      .toThrow("Object storage is not configured correctly.");
  });

  it("keeps object writes disabled by default and for invalid values", () => {
    expect(validateObjectStorageWriteMode({})).toEqual({ mode: "disabled", issues: [] });
    expect(validateObjectStorageWriteMode({ OBJECT_STORAGE_WRITE_MODE: "disabled" })).toEqual({
      mode: "disabled",
      issues: []
    });
    expect(validateObjectStorageWriteMode({ OBJECT_STORAGE_WRITE_MODE: "enabled" })).toEqual({
      mode: "enabled",
      issues: []
    });

    const invalid = validateObjectStorageWriteMode({ OBJECT_STORAGE_WRITE_MODE: "on" });
    expect(invalid.mode).toBe("disabled");
    expect(invalid.issues.map((issue) => issue.code)).toEqual(["OBJECT_STORAGE_WRITE_MODE_INVALID"]);
  });
});

// Stage 8.5L3.3 -- real live-browser test found next.config.ts's CSP
// connect-src silently blocking the browser-to-S3 presigned PUT before
// the network call was ever attempted. This is the regression test for
// the fix.
describe("resolveObjectStorageConnectSrcOrigin (Stage 8.5L3.3 CSP fix)", () => {
  it("returns null when the backend is not s3 -- connect-src 'self' stays exactly as it always was", () => {
    expect(resolveObjectStorageConnectSrcOrigin({})).toBeNull();
    expect(resolveObjectStorageConnectSrcOrigin({ OBJECT_STORAGE_BACKEND: "local" })).toBeNull();
  });

  it("returns the real virtual-hosted-style S3 origin AWS SDK's default (forcePathStyle=false) client actually uses", () => {
    expect(
      resolveObjectStorageConnectSrcOrigin({ OBJECT_STORAGE_BACKEND: "s3", OBJECT_STORAGE_BUCKET: "my-bucket", OBJECT_STORAGE_REGION: "eu-north-1" }),
    ).toBe("https://my-bucket.s3.eu-north-1.amazonaws.com");
  });

  it("prefers OBJECT_STORAGE_ENDPOINT's own origin when a non-AWS S3-compatible endpoint is configured", () => {
    expect(
      resolveObjectStorageConnectSrcOrigin({ OBJECT_STORAGE_BACKEND: "s3", OBJECT_STORAGE_ENDPOINT: "https://isolated.example.test:9000", OBJECT_STORAGE_BUCKET: "b", OBJECT_STORAGE_REGION: "r" }),
    ).toBe("https://isolated.example.test:9000");
  });

  it("returns null (fail-closed, never a broken/partial CSP directive) when bucket or region is missing despite backend=s3", () => {
    expect(resolveObjectStorageConnectSrcOrigin({ OBJECT_STORAGE_BACKEND: "s3", OBJECT_STORAGE_REGION: "eu-north-1" })).toBeNull();
    expect(resolveObjectStorageConnectSrcOrigin({ OBJECT_STORAGE_BACKEND: "s3", OBJECT_STORAGE_BUCKET: "my-bucket" })).toBeNull();
  });

  it("returns null for a malformed OBJECT_STORAGE_ENDPOINT rather than throwing", () => {
    expect(resolveObjectStorageConnectSrcOrigin({ OBJECT_STORAGE_BACKEND: "s3", OBJECT_STORAGE_ENDPOINT: "not a url" })).toBeNull();
  });
});

function s3Env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    OBJECT_STORAGE_BACKEND: "s3",
    OBJECT_STORAGE_BUCKET_ALIAS: "images",
    OBJECT_STORAGE_BUCKET: "test-physical-bucket",
    OBJECT_STORAGE_REGION: "test-1",
    ...overrides
  };
}