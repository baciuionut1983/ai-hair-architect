import { NextResponse } from "next/server";

import { ensureRequestId } from "@/lib/hardening";

export const BUSINESS_PERSISTENCE_DOMAIN_REGISTRY = {
  clients: {
    persistenceState: "memory_only",
    essential: true,
    productionReady: false,
  },
  consultations: {
    persistenceState: "memory_only",
    essential: true,
    productionReady: false,
  },
  appointments: {
    persistenceState: "memory_only",
    essential: true,
    productionReady: false,
  },
} as const;

export type BusinessPersistenceDomain = keyof typeof BUSINESS_PERSISTENCE_DOMAIN_REGISTRY;
export type BusinessPersistenceRuntime = "production" | "development" | "test";

export type BusinessPersistenceErrorCode =
  | "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY"
  | "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_UNKNOWN_DOMAIN";

export interface BusinessPersistenceDecision {
  knownDomain: boolean;
  domain: string;
  runtime: BusinessPersistenceRuntime;
  persistenceState: "memory_only" | "unknown";
  guardEnforcement: "active" | "bypassed";
  availability: "blocked" | "available";
  productionReady: false;
  blocked: boolean;
  errorCode?: BusinessPersistenceErrorCode;
}

export interface BusinessPersistenceUnavailablePayload {
  error: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY";
  message: "Business persistence is unavailable in production for this domain.";
  domain: BusinessPersistenceDomain;
  requestId: string;
}

export interface BusinessPersistenceReadinessDomain {
  domain: BusinessPersistenceDomain;
  persistenceState: "memory_only";
  guardEnforcement: "active" | "bypassed";
  availability: "blocked" | "available";
  productionReady: false;
}

export function evaluateBusinessPersistence(
  domain: string,
  runtime: BusinessPersistenceRuntime,
): BusinessPersistenceDecision {
  const knownDomain = Object.prototype.hasOwnProperty.call(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY, domain);
  const blocked = runtime === "production";

  return {
    knownDomain,
    domain,
    runtime,
    persistenceState: knownDomain ? "memory_only" : "unknown",
    guardEnforcement: blocked ? "active" : "bypassed",
    availability: blocked ? "blocked" : "available",
    productionReady: false,
    blocked,
    ...(blocked
      ? {
          errorCode: knownDomain
            ? "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY"
            : "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_UNKNOWN_DOMAIN",
        }
      : {}),
  };
}

export function guardBusinessPersistence(
  domain: BusinessPersistenceDomain,
  request: Request,
): NextResponse<BusinessPersistenceUnavailablePayload> | null {
  const decision = evaluateBusinessPersistence(domain, getRuntime());
  if (!decision.blocked) {
    return null;
  }

  const requestId = ensureRequestId(request.headers.get("x-request-id"));
  const payload: BusinessPersistenceUnavailablePayload = {
    error: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY",
    message: "Business persistence is unavailable in production for this domain.",
    domain,
    requestId,
  };

  return NextResponse.json(payload, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

export function getBusinessPersistenceReadinessDomains(
  runtime: BusinessPersistenceRuntime,
): BusinessPersistenceReadinessDomain[] {
  return (Object.keys(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY) as BusinessPersistenceDomain[]).map((domain) => {
    const decision = evaluateBusinessPersistence(domain, runtime);
    return {
      domain,
      persistenceState: "memory_only",
      guardEnforcement: decision.guardEnforcement,
      availability: decision.availability,
      productionReady: false,
    };
  });
}

function getRuntime(): BusinessPersistenceRuntime {
  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  if (process.env.NODE_ENV === "test") {
    return "test";
  }

  return "development";
}