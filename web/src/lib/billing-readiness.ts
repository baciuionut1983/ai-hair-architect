import {
  checkBillingRepositoryHealth,
  type BillingRepositoryHealthCode,
} from "@/lib/billing-repository";

export type BillingReadinessStatus = "ready" | "not_ready";

export type BillingReadinessCode =
  | "BILLING_READINESS_PROCESSING_DISABLED"
  | "BILLING_READINESS_SECRET_KEY_MISSING"
  | "BILLING_READINESS_SECRET_KEY_MALFORMED"
  | "BILLING_READINESS_TEST_KEY_FORBIDDEN_IN_PRODUCTION"
  | "BILLING_READINESS_WEBHOOK_SECRET_MISSING"
  | "BILLING_READINESS_WEBHOOK_SECRET_MALFORMED"
  | "BILLING_READINESS_DATABASE_UNAVAILABLE"
  | "BILLING_READINESS_CUSTOMER_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_SUBSCRIPTION_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_PAYMENT_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_EVENT_TABLE_UNAVAILABLE"
  | "BILLING_READINESS_IDEMPOTENCY_PROBE_FAILED"
  | "BILLING_READINESS_CUSTOMER_MAPPING_PROBE_FAILED"
  | "BILLING_READINESS_INSECURE_WEBHOOK_ARCHITECTURE"
  | "BILLING_READINESS_IN_MEMORY_FALLBACK_DETECTED"
  | "BILLING_READINESS_EVENT_CONFIGURATION_INVALID"
  | "BILLING_READINESS_INTERNAL_ERROR"
  | "BILLING_READINESS_SUCCEEDED";

export interface BillingReadinessResult {
  readonly status: BillingReadinessStatus;
  readonly code: BillingReadinessCode;
  readonly message: string;
}

// Fixed per-code strings only -- never interpolates a secret, key fragment,
// database detail, table/constraint name, or raw provider error.
const SAFE_MESSAGES: Record<BillingReadinessCode, string> = {
  BILLING_READINESS_PROCESSING_DISABLED: "Billing webhook processing is not enabled.",
  BILLING_READINESS_SECRET_KEY_MISSING: "Stripe secret key is not configured.",
  BILLING_READINESS_SECRET_KEY_MALFORMED: "Stripe secret key is not structurally valid.",
  BILLING_READINESS_TEST_KEY_FORBIDDEN_IN_PRODUCTION: "A Stripe test-mode key cannot be used in production.",
  BILLING_READINESS_WEBHOOK_SECRET_MISSING: "Stripe webhook secret is not configured.",
  BILLING_READINESS_WEBHOOK_SECRET_MALFORMED: "Stripe webhook secret is not structurally valid.",
  BILLING_READINESS_DATABASE_UNAVAILABLE: "Billing database is not available.",
  BILLING_READINESS_CUSTOMER_TABLE_UNAVAILABLE: "Billing customer persistence is not available.",
  BILLING_READINESS_SUBSCRIPTION_TABLE_UNAVAILABLE: "Billing subscription persistence is not available.",
  BILLING_READINESS_PAYMENT_TABLE_UNAVAILABLE: "Billing payment persistence is not available.",
  BILLING_READINESS_EVENT_TABLE_UNAVAILABLE: "Billing webhook event persistence is not available.",
  BILLING_READINESS_IDEMPOTENCY_PROBE_FAILED: "Billing webhook idempotency could not be verified.",
  BILLING_READINESS_CUSTOMER_MAPPING_PROBE_FAILED: "Billing customer mapping persistence could not be verified.",
  BILLING_READINESS_INSECURE_WEBHOOK_ARCHITECTURE: "Billing webhook signature verification is not correctly wired.",
  BILLING_READINESS_IN_MEMORY_FALLBACK_DETECTED: "Billing webhook processing depends on non-durable state.",
  BILLING_READINESS_EVENT_CONFIGURATION_INVALID: "Billing webhook supported-event configuration is invalid.",
  BILLING_READINESS_INTERNAL_ERROR: "Billing readiness evaluation failed unexpectedly.",
  BILLING_READINESS_SUCCEEDED: "Billing webhook processing is ready.",
};

const SECRET_KEY_PATTERN = /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/;
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]{16,}$/;
// Explicit allowlist: only these two prefixes are accepted as production-live
// Stripe secret keys. Any other structurally valid prefix (sk_test_/rk_test_)
// is rejected in production runtime, even though it passes the format regex.
const PRODUCTION_LIVE_KEY_PREFIXES = ["sk_live_", "rk_live_"] as const;

const HEALTH_CODE_PASSTHROUGH = new Set<BillingRepositoryHealthCode>([
  "BILLING_READINESS_DATABASE_UNAVAILABLE",
  "BILLING_READINESS_CUSTOMER_TABLE_UNAVAILABLE",
  "BILLING_READINESS_SUBSCRIPTION_TABLE_UNAVAILABLE",
  "BILLING_READINESS_PAYMENT_TABLE_UNAVAILABLE",
  "BILLING_READINESS_EVENT_TABLE_UNAVAILABLE",
  "BILLING_READINESS_IDEMPOTENCY_PROBE_FAILED",
  "BILLING_READINESS_CUSTOMER_MAPPING_PROBE_FAILED",
]);

export interface BillingReadinessDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly checkRepositoryHealth?: () => Promise<{ ok: boolean; code: BillingRepositoryHealthCode }>;
}

export async function evaluateBillingReadiness(
  deps: BillingReadinessDependencies,
): Promise<BillingReadinessResult> {
  const mode = resolveBillingProcessingModeForReadiness(deps.env);
  if (mode === "disabled") {
    return fail("BILLING_READINESS_PROCESSING_DISABLED");
  }

  const secretKeyResult = validateStripeSecretKey(deps.env);
  if (secretKeyResult) return secretKeyResult;

  const webhookSecretResult = validateStripeWebhookSecret(deps.env);
  if (webhookSecretResult) return webhookSecretResult;

  const checkHealth = deps.checkRepositoryHealth ?? checkBillingRepositoryHealth;

  try {
    const health = await checkHealth();
    if (!health.ok) {
      const code = HEALTH_CODE_PASSTHROUGH.has(health.code)
        ? health.code as BillingReadinessCode
        : "BILLING_READINESS_INTERNAL_ERROR";
      return fail(code);
    }
    return succeed();
  } catch {
    return fail("BILLING_READINESS_INTERNAL_ERROR");
  }
}

function resolveBillingProcessingModeForReadiness(env: NodeJS.ProcessEnv): "disabled" | "webhook_only" | "enabled" {
  const raw = String(env.BILLING_PROCESSING_MODE ?? "").trim();
  if (raw === "webhook_only" || raw === "enabled") return raw;
  return "disabled";
}

function validateStripeSecretKey(env: NodeJS.ProcessEnv): BillingReadinessResult | null {
  const value = String(env.STRIPE_SECRET_KEY ?? "").trim();
  if (!value) return fail("BILLING_READINESS_SECRET_KEY_MISSING");
  if (!SECRET_KEY_PATTERN.test(value)) return fail("BILLING_READINESS_SECRET_KEY_MALFORMED");

  const isProductionRuntime = String(env.NODE_ENV ?? "").trim() === "production";
  const isAcceptedProductionLiveKey = PRODUCTION_LIVE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix));
  if (isProductionRuntime && !isAcceptedProductionLiveKey) {
    return fail("BILLING_READINESS_TEST_KEY_FORBIDDEN_IN_PRODUCTION");
  }

  return null;
}

function validateStripeWebhookSecret(env: NodeJS.ProcessEnv): BillingReadinessResult | null {
  const value = String(env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!value) return fail("BILLING_READINESS_WEBHOOK_SECRET_MISSING");
  if (!WEBHOOK_SECRET_PATTERN.test(value)) return fail("BILLING_READINESS_WEBHOOK_SECRET_MALFORMED");
  return null;
}

function fail(code: BillingReadinessCode): BillingReadinessResult {
  return { status: "not_ready", code, message: SAFE_MESSAGES[code] };
}

function succeed(): BillingReadinessResult {
  return { status: "ready", code: "BILLING_READINESS_SUCCEEDED", message: SAFE_MESSAGES.BILLING_READINESS_SUCCEEDED };
}
