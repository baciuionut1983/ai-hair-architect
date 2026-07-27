import { describe, expect, it } from "vitest";

import {
  classifyEnvVariables,
  formatValidationIssues,
  validateBuildTimeEnvironment,
  validateRuntimeProductionEnvironment
} from "@/lib/env-core-gate";

describe("env core gate", () => {
  it("exposes a stable environment classification matrix", () => {
    const matrix = classifyEnvVariables();

    expect(matrix.requiredInProduction).toEqual([
      "NODE_ENV",
      "DATABASE_URL",
      "WEBHOOK_SECRET_ENCRYPTION_KEY",
      "OBJECT_STORAGE_BACKEND",
      "OBJECT_STORAGE_BUCKET_ALIAS",
      "OBJECT_STORAGE_BUCKET",
      "OBJECT_STORAGE_REGION",
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION"
    ]);
    expect(matrix.optionalInProduction).toContain("AUTH_BCRYPT_COST");
    expect(matrix.developmentTestOnly).toEqual(["TEST_DATABASE_URL"]);
  });

  it("allows build-time validation without production runtime secrets", () => {
    const result = validateBuildTimeEnvironment({ NODE_ENV: "production" });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("allows build-time validation when NODE_ENV is omitted", () => {
    const result = validateBuildTimeEnvironment({} as unknown as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("fails build-time validation on invalid NODE_ENV", () => {
    const result = validateBuildTimeEnvironment(
      { NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("ENV_NODE_ENV_INVALID");
  });

  it("fails runtime production validation when required values are missing", () => {
    const result = validateRuntimeProductionEnvironment({ NODE_ENV: "production" });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("ENV_DATABASE_URL_REQUIRED");
    expect(result.issues.map((issue) => issue.code)).toContain("ENV_WEBHOOK_KEY_REQUIRED");
  });

  it("skips strict runtime checks outside production", () => {
    const result = validateRuntimeProductionEnvironment({ NODE_ENV: "development" });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("does not require S3 configuration outside production when the backend is inactive", () => {
    for (const NODE_ENV of ["development", "test"] as const) {
      const result = validateRuntimeProductionEnvironment({ NODE_ENV });
      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    }
  });

  it("fails closed for partial production object storage configuration", () => {
    const result = validateRuntimeProductionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      OBJECT_STORAGE_BACKEND: "s3",
      OBJECT_STORAGE_BUCKET_ALIAS: "images"
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.variable)).toContain("OBJECT_STORAGE_BUCKET");
    expect(result.issues.map((issue) => issue.variable)).toContain("OBJECT_STORAGE_REGION");
  });

  it("accepts complete production S3 configuration and rejects an insecure endpoint", () => {
    const validEnv = {
      NODE_ENV: "production" as const,
      DATABASE_URL: "postgresql://db",
      WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      OBJECT_STORAGE_BACKEND: "s3",
      OBJECT_STORAGE_BUCKET_ALIAS: "images",
      OBJECT_STORAGE_BUCKET: "physical-bucket",
      OBJECT_STORAGE_REGION: "eu-central-1",
      OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "AES256"
    };

    expect(validateRuntimeProductionEnvironment(validEnv).ok).toBe(true);
    const invalid = validateRuntimeProductionEnvironment({
      ...validEnv,
      OBJECT_STORAGE_ENDPOINT: "http://storage.internal"
    });
    expect(invalid.issues.map((issue) => issue.code)).toContain("OBJECT_STORAGE_ENDPOINT_INVALID");
  });

  it("fails closed when production SSE is absent or none", () => {
    const baseEnv = {
      NODE_ENV: "production" as const,
      DATABASE_URL: "postgresql://db",
      WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      OBJECT_STORAGE_BACKEND: "s3",
      OBJECT_STORAGE_BUCKET_ALIAS: "images",
      OBJECT_STORAGE_BUCKET: "physical-bucket",
      OBJECT_STORAGE_REGION: "eu-central-1"
    };

    expect(validateRuntimeProductionEnvironment(baseEnv).issues.map((issue) => issue.code)).toContain(
      "OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_REQUIRED"
    );
    expect(validateRuntimeProductionEnvironment({
      ...baseEnv,
      OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION: "none"
    }).issues.map((issue) => issue.code)).toContain("OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION_INVALID");
  });

  it("rejects invalid webhook secret structure in production runtime validation", () => {
    const result = validateRuntimeProductionEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      WEBHOOK_SECRET_ENCRYPTION_KEY: "not-valid-base64"
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("ENV_WEBHOOK_KEY_INVALID");
  });

  it("formats validation issues without exposing secret values", () => {
    const result = validateRuntimeProductionEnvironment({ NODE_ENV: "production" });
    const formatted = formatValidationIssues(result.issues);

    expect(formatted).toContain("ENV_DATABASE_URL_REQUIRED");
    expect(formatted).not.toContain("postgresql://");
  });
});
