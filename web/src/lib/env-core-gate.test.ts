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
      "WEBHOOK_SECRET_ENCRYPTION_KEY"
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
