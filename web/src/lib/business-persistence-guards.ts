import { NextResponse } from "next/server";

import { ensureRequestId } from "@/lib/hardening";

export const BUSINESS_PERSISTENCE_DOMAIN_REGISTRY = {
  clients: {
    persistenceState: "durable",
    essential: true,
    productionReady: true,
  },
  consultations: {
    persistenceState: "durable",
    essential: true,
    productionReady: true,
  },
  analyses: {
    persistenceState: "durable",
    essential: true,
    productionReady: true,
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
  persistenceState: "memory_only" | "durable" | "unknown";
  guardEnforcement: "active" | "bypassed";
  availability: "blocked" | "available";
  productionReady: boolean;
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
  persistenceState: "memory_only" | "durable";
  guardEnforcement: "active" | "bypassed";
  availability: "blocked" | "available";
  productionReady: boolean;
}

export function evaluateBusinessPersistence(
  domain: string,
  runtime: BusinessPersistenceRuntime,
): BusinessPersistenceDecision {
  const knownDomain = Object.prototype.hasOwnProperty.call(BUSINESS_PERSISTENCE_DOMAIN_REGISTRY, domain);
  const metadata = knownDomain
    ? BUSINESS_PERSISTENCE_DOMAIN_REGISTRY[domain as BusinessPersistenceDomain]
    : null;
  const blocked = runtime === "production" && (!metadata || !metadata.productionReady);

  return {
    knownDomain,
    domain,
    runtime,
    persistenceState: metadata?.persistenceState ?? "unknown",
    guardEnforcement: runtime === "production" ? "active" : "bypassed",
    availability: blocked ? "blocked" : "available",
    productionReady: metadata?.productionReady ?? false,
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
      persistenceState: BUSINESS_PERSISTENCE_DOMAIN_REGISTRY[domain].persistenceState,
      guardEnforcement: decision.guardEnforcement,
      availability: decision.availability,
      productionReady: BUSINESS_PERSISTENCE_DOMAIN_REGISTRY[domain].productionReady,
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