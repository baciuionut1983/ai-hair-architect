import { evaluateCheckoutReadiness } from "@/lib/billing-checkout-readiness";
import { evaluateBillingReadiness, validateStripeWebhookSecret } from "@/lib/billing-readiness";
import {
  validateRuntimeProductionEnvironment,
  type EnvValidationIssue,
} from "@/lib/env-core-gate";
import {
  BUSINESS_PERSISTENCE_DOMAIN_REGISTRY,
  getBusinessPersistenceReadinessDomains,
  type BusinessPersistenceReadinessDomain,
  type BusinessPersistenceRuntime,
} from "@/lib/business-persistence-guards";
import { evaluateStorageReadiness } from "@/lib/storage-readiness-canary";

export type ReadinessStatus = "READY" | "NOT_READY";
export type ReadinessCheckStatus = "PASS" | "FAIL";

export type ReadinessCheckCode =
  | "ENV_RUNTIME_VALID"
  | "BUSINESS_PERSISTENCE_PRODUCTION_READY"
  | "BILLING_WEBHOOK_AUTHENTICITY_READY"
  | "BILLING_CHECKOUT_READY"
  | "STORAGE_PRODUCTION_POLICY_READY";

export interface ReadinessCheck {
  code: ReadinessCheckCode;
  status: ReadinessCheckStatus;
  critical: true;
  message: string;
}

export interface ReadinessPayload {
  status: ReadinessStatus;
  checks: ReadinessCheck[];
  businessPersistenceDomains: BusinessPersistenceReadinessDomain[];
  requestId: string;
  timestamp: string;
  // Diagnostic-only (2026-08-18 production investigation): Railway
  // auto-injects these for every deployment, no configuration needed --
  // never fabricated, explicitly null when absent (e.g. local dev, or a
  // platform other than Railway). Exists so "which commit is actually
  // live right now" can be answered from a real HTTP response instead of
  // an ambiguous dashboard identifier -- a Railway "deployment ID" is its
  // OWN internal id, not necessarily a git SHA, and the two are easy to
  // conflate when reading the dashboard.
  deployment: {
    gitCommitSha: string | null;
    railwayDeploymentId: string | null;
  };
}

export interface ReadinessEvaluation {
  httpStatus: 200 | 503;
  payload: ReadinessPayload;
}

export interface ProductionPolicyError {
  code: string;
  message: string;
  httpStatus: 503;
}

export const PRODUCTION_POLICY_ERROR_CODES = {
  BILLING_WEBHOOK_DISABLED: "PRODUCTION_POLICY_BILLING_WEBHOOK_DISABLED",
  STORAGE_LOCAL_BLOCKED: "PRODUCTION_POLICY_LOCAL_STORAGE_BLOCKED",
  PERSISTENCE_NOT_READY: "PRODUCTION_POLICY_BUSINESS_PERSISTENCE_NOT_READY"
} as const;

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NODE_ENV ?? "").trim() === "production";
}

// Provider authenticity verification (Stripe signature check via
// stripe.webhooks.constructEvent, in billing-webhook-processor.ts) is
// implemented and tested -- this guard no longer blocks unconditionally.
// It now fails closed on exactly one precondition: a present,
// correctly-formatted STRIPE_WEBHOOK_SECRET, reusing the same validation
// billing-readiness.ts's readiness report already applies, so the two can
// never drift apart. When that precondition holds, the request proceeds to
// the real cryptographic signature verification unchanged -- this guard
// grants no bypass of it. Deliberately does NOT also require a live-mode
// STRIPE_SECRET_KEY: that is a separate, already-existing readiness signal
// (BILLING_WEBHOOK_AUTHENTICITY_READY can still report it), not a
// hard block here, so a deliberate Stripe Sandbox/TEST-mode production
// trial (as opposed to no verification at all) is not itself prevented.
export function getBillingWebhookProductionError(
  env: NodeJS.ProcessEnv = process.env
): ProductionPolicyError | null {
  if (!isProductionRuntime(env)) {
    return null;
  }

  if (validateStripeWebhookSecret(env)) {
    return {
      code: PRODUCTION_POLICY_ERROR_CODES.BILLING_WEBHOOK_DISABLED,
      message: "Billing webhook is disabled in production: STRIPE_WEBHOOK_SECRET is not configured or not valid.",
      httpStatus: 503
    };
  }

  return null;
}

export async function evaluateReadiness(input: {
  requestId: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<ReadinessEvaluation> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const nowFn = () => now;
  const envValidation = validateRuntimeProductionEnvironment(env);
  const runtime = resolveReadinessRuntime(env);
  const businessPersistenceDomains = getBusinessPersistenceReadinessDomains(runtime);
  const storageReadiness = await evaluateStorageReadiness({ env, mode: runtime, now: nowFn });
  const billingReadiness = await evaluateBillingReadiness({ env });
  const checkoutReadiness = evaluateCheckoutReadiness(env);

  const checks: ReadinessCheck[] = [
    buildEnvCheck(envValidation.issues),
    buildBusinessPersistenceCheck(businessPersistenceDomains),
    {
      code: "BILLING_WEBHOOK_AUTHENTICITY_READY",
      status: billingReadiness.status === "ready" ? "PASS" : "FAIL",
      critical: true,
      message: billingReadiness.message
    },
    {
      code: "BILLING_CHECKOUT_READY",
      status: checkoutReadiness.status === "ready" ? "PASS" : "FAIL",
      critical: true,
      message: checkoutReadiness.message
    },
    {
      code: "STORAGE_PRODUCTION_POLICY_READY",
      status: storageReadiness.status === "READY" ? "PASS" : "FAIL",
      critical: true,
      message: storageReadiness.message
    }
  ];

  const hasFailure = checks.some((check) => check.status === "FAIL");

  return {
    httpStatus: hasFailure ? 503 : 200,
    payload: {
      status: hasFailure ? "NOT_READY" : "READY",
      checks,
      businessPersistenceDomains,
      requestId: input.requestId,
      timestamp: now.toISOString(),
      deployment: {
        gitCommitSha: normalizeDeploymentField(env.RAILWAY_GIT_COMMIT_SHA),
        railwayDeploymentId: normalizeDeploymentField(env.RAILWAY_DEPLOYMENT_ID)
      }
    }
  };
}

function normalizeDeploymentField(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildBusinessPersistenceCheck(
  domains: BusinessPersistenceReadinessDomain[],
): ReadinessCheck {
  const blockingDomains = domains.filter((domain) => {
    const metadata = BUSINESS_PERSISTENCE_DOMAIN_REGISTRY[domain.domain];
    return metadata.essential && (
      domain.persistenceState !== "durable" ||
      !domain.productionReady
    );
  });

  if (blockingDomains.length === 0) {
    return {
      code: "BUSINESS_PERSISTENCE_PRODUCTION_READY",
      status: "PASS",
      critical: true,
      message: "All essential business persistence domains are durable and production-ready."
    };
  }

  const domainSummary = blockingDomains
    .map((domain) => `${domain.domain} (${domain.persistenceState}, productionReady=${domain.productionReady})`)
    .join(", ");
  return {
    code: "BUSINESS_PERSISTENCE_PRODUCTION_READY",
    status: "FAIL",
    critical: true,
    message: `Essential business persistence domains are not production-ready: ${domainSummary}.`
  };
}

function resolveReadinessRuntime(env: NodeJS.ProcessEnv): BusinessPersistenceRuntime {
  if (env.NODE_ENV === "production") {
    return "production";
  }

  if (env.NODE_ENV === "test") {
    return "test";
  }

  return "development";
}

function buildEnvCheck(issues: EnvValidationIssue[]): ReadinessCheck {
  if (issues.length === 0) {
    return {
      code: "ENV_RUNTIME_VALID",
      status: "PASS",
      critical: true,
      message: "Runtime environment policy checks passed for current mode."
    };
  }

  return {
    code: "ENV_RUNTIME_VALID",
    status: "FAIL",
    critical: true,
    message: `Runtime environment validation failed with ${issues.length} issue(s).`
  };
}
