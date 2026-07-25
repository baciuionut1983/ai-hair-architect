import { afterEach, describe, expect, it } from "vitest";

import {
  BUSINESS_PERSISTENCE_DOMAIN_REGISTRY,
  evaluateBusinessPersistence,
  guardBusinessPersistence,
} from "@/lib/business-persistence-guards";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

describe("business persistence guards", () => {
  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it("registers exactly the three memory-only pilot domains", () => {
    expect(Object.keys(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY)).toEqual([
      "clients",
      "consultations",
      "appointments",
    ]);

    for (const metadata of Object.values(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY)) {
      expect(metadata).toEqual({
        persistenceState: "memory_only",
        essential: true,
        productionReady: false,
      });
    }
  });

  it.each(["clients", "consultations", "appointments"])(
    "blocks %s in production",
    (domain) => {
      expect(evaluateBusinessPersistence(domain, "production")).toMatchObject({
        knownDomain: true,
        blocked: true,
        guardEnforcement: "active",
        availability: "blocked",
        productionReady: false,
        errorCode: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY",
      });
    },
  );

  it.each(["development", "test"] as const)("bypasses in %s", (runtime) => {
    expect(evaluateBusinessPersistence("clients", runtime)).toMatchObject({
      knownDomain: true,
      blocked: false,
      guardEnforcement: "bypassed",
      availability: "available",
      productionReady: false,
    });
  });

  it("fails closed for an unknown production domain and bypasses it outside production", () => {
    expect(evaluateBusinessPersistence("unknown-domain", "production")).toMatchObject({
      knownDomain: false,
      blocked: true,
      persistenceState: "unknown",
      errorCode: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_UNKNOWN_DOMAIN",
    });
    expect(evaluateBusinessPersistence("unknown-domain", "development").blocked).toBe(false);
    expect(evaluateBusinessPersistence("unknown-domain", "test").blocked).toBe(false);
  });

  it("returns the standardized production response and propagates request ID", async () => {
    mutableEnv.NODE_ENV = "production";

    const response = guardBusinessPersistence(
      "clients",
      new Request("http://localhost/api/v1/clients", {
        headers: { "x-request-id": "req-phase-2a" },
      }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-request-id")).toBe("req-phase-2a");
    expect(response?.headers.has("retry-after")).toBe(false);
    await expect(response?.json()).resolves.toEqual({
      error: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY",
      message: "Business persistence is unavailable in production for this domain.",
      domain: "clients",
      requestId: "req-phase-2a",
    });
  });

  it("generates a request ID when the request does not provide one", async () => {
    mutableEnv.NODE_ENV = "production";

    const response = guardBusinessPersistence(
      "clients",
      new Request("http://localhost/api/v1/clients"),
    );
    const payload = await response?.json();

    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response?.headers.get("x-request-id")).toBe(payload.requestId);
  });

  it.each(["development", "test"] as const)("returns null in %s", (runtime) => {
    mutableEnv.NODE_ENV = runtime;
    expect(
      guardBusinessPersistence("clients", new Request("http://localhost/api/v1/clients")),
    ).toBeNull();
  });
});