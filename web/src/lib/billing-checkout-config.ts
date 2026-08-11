import { resolveBillingProcessingMode } from "./billing-webhook-processor";

export type PaidSubscriptionPlan = "pro" | "salon" | "business";

const PAID_PLANS: readonly PaidSubscriptionPlan[] = ["pro", "salon", "business"];

const PRICE_ENV_VAR: Record<PaidSubscriptionPlan, string> = {
  pro: "STRIPE_PRICE_PRO",
  salon: "STRIPE_PRICE_SALON",
  business: "STRIPE_PRICE_BUSINESS",
};

export type BillingCheckoutConfigIssueCode =
  | "STRIPE_SECRET_KEY_REQUIRED"
  | "APP_BASE_URL_REQUIRED";

export interface BillingCheckoutConfigIssue {
  code: BillingCheckoutConfigIssueCode;
  variable: string;
  message: string;
}

export interface BillingCheckoutEnabledConfig {
  status: "enabled";
  secretKey: string;
  // Per-plan, not all-or-nothing: a plan with no configured price id is
  // simply absent here, never a config-wide failure. Business having no
  // Stripe price yet must never block Pro/Salon from working.
  priceIds: Partial<Record<PaidSubscriptionPlan, string>>;
  appBaseUrl: string;
}

export type BillingCheckoutConfigResult =
  | { status: "disabled" }
  | { status: "invalid"; issues: BillingCheckoutConfigIssue[] }
  | BillingCheckoutEnabledConfig;

/**
 * Fail-closed checkout configuration. Checkout is only ever "enabled" when
 * BILLING_PROCESSING_MODE is explicitly "enabled" -- not merely
 * "webhook_only", which allows webhook processing but deliberately not new
 * checkout creation, matching that mode's existing three-value contract in
 * billing-webhook-processor.ts. STRIPE_SECRET_KEY and APP_BASE_URL are
 * always required when enabled (checkout cannot function at all without
 * them, regardless of which plan is requested). Individual plan price ids
 * are deliberately independent: a caller must check config.priceIds[plan]
 * for the specific plan it needs and fail closed itself if absent -- see
 * the checkout route. The free plan never resolves through this module at
 * all -- callers must not invoke it for a "free" selection.
 */
export function resolveBillingCheckoutConfig(env: NodeJS.ProcessEnv = process.env): BillingCheckoutConfigResult {
  const mode = resolveBillingProcessingMode(env);
  if (mode !== "enabled") {
    return { status: "disabled" };
  }

  const issues: BillingCheckoutConfigIssue[] = [];

  const secretKey = value(env.STRIPE_SECRET_KEY);
  if (!secretKey) {
    issues.push(
      issue("STRIPE_SECRET_KEY_REQUIRED", "STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY is required when BILLING_PROCESSING_MODE is enabled."),
    );
  }

  const appBaseUrl = value(env.APP_BASE_URL);
  if (!appBaseUrl) {
    issues.push(
      issue("APP_BASE_URL_REQUIRED", "APP_BASE_URL", "APP_BASE_URL is required when BILLING_PROCESSING_MODE is enabled."),
    );
  }

  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  const priceIds: Partial<Record<PaidSubscriptionPlan, string>> = {};
  for (const plan of PAID_PLANS) {
    const priceId = value(env[PRICE_ENV_VAR[plan]]);
    if (priceId) {
      priceIds[plan] = priceId;
    }
  }

  return { status: "enabled", secretKey, priceIds, appBaseUrl };
}

export function isPaidSubscriptionPlan(value: string): value is PaidSubscriptionPlan {
  return (PAID_PLANS as readonly string[]).includes(value);
}

function value(raw: string | undefined): string {
  return String(raw ?? "").trim();
}

function issue(code: BillingCheckoutConfigIssueCode, variable: string, message: string): BillingCheckoutConfigIssue {
  return { code, variable, message };
}
