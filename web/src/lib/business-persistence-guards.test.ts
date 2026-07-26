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

  it("registers durable and production-ready Appointments and Notifications together", () => {
    expect(Object.keys(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY)).toEqual([
      "clients",
      "consultations",
      "analyses",
      "appointments",
      "notifications",
    ]);

    expect(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY.clients).toEqual({
      persistenceState: "durable",
      essential: true,
      productionReady: true,
    });
    expect(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY.consultations).toEqual({
      persistenceState: "durable",
      essential: true,
      productionReady: true,
    });
    expect(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY.analyses).toEqual({
      persistenceState: "durable",
      essential: true,
      productionReady: true,
    });
    expect(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY.appointments).toEqual({
      persistenceState: "durable",
      essential: true,
      productionReady: true,
    });
    expect(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY.notifications).toEqual({
      persistenceState: "durable",
      essential: true,
      productionReady: true,
    });
  });

  it.each(["appointments", "notifications"])(
    "allows %s in production",
    (domain) => {
      expect(evaluateBusinessPersistence(domain, "production")).toMatchObject({
        knownDomain: true,
        blocked: false,
        guardEnforcement: "active",
        availability: "available",
        productionReady: true,
      });
    },
  );

  it("allows durable Clients in production", () => {
    expect(evaluateBusinessPersistence("clients", "production")).toMatchObject({
      knownDomain: true,
      persistenceState: "durable",
      blocked: false,
      guardEnforcement: "active",
      availability: "available",
      productionReady: true,
    });
  });

  it("allows durable Consultations in production", () => {
    expect(evaluateBusinessPersistence("consultations", "production")).toMatchObject({
      knownDomain: true,
      persistenceState: "durable",
      blocked: false,
      availability: "available",
      productionReady: true,
    });
  });

  it("allows durable Analyses in production", () => {
    expect(evaluateBusinessPersistence("analyses", "production")).toMatchObject({
      knownDomain: true,
      persistenceState: "durable",
      blocked: false,
      guardEnforcement: "active",
      availability: "available",
      productionReady: true,
    });
  });

  it.each(["development", "test"] as const)("bypasses in %s", (runtime) => {
    expect(evaluateBusinessPersistence("clients", runtime)).toMatchObject({
      knownDomain: true,
      blocked: false,
      guardEnforcement: "bypassed",
      availability: "available",
      productionReady: true,
    });
  });

  it.each(["appointments", "notifications"])(
    "bypasses durable and production-ready %s outside production",
    (domain) => {
      expect(evaluateBusinessPersistence(domain, "test")).toMatchObject({
        knownDomain: true,
        persistenceState: "durable",
        blocked: false,
        guardEnforcement: "bypassed",
        availability: "available",
        productionReady: true,
      });
    },
  );

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

  it.each(["appointments", "notifications"] as const)("returns null for %s in production", (domain) => {
    mutableEnv.NODE_ENV = "production";
    expect(guardBusinessPersistence(domain, new Request(`http://localhost/api/v1/${domain}`))).toBeNull();
  });

  it.each(["development", "test"] as const)("returns null in %s", (runtime) => {
    mutableEnv.NODE_ENV = runtime;
    expect(
      guardBusinessPersistence("clients", new Request("http://localhost/api/v1/clients")),
    ).toBeNull();
  });

  it("returns null for durable Clients in production", () => {
    mutableEnv.NODE_ENV = "production";
    expect(guardBusinessPersistence("clients", new Request("http://localhost/api/v1/clients"))).toBeNull();
  });
});