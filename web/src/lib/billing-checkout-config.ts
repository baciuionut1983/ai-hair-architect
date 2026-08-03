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
  | "STRIPE_PRICE_ID_REQUIRED";

export interface BillingCheckoutConfigIssue {
  code: BillingCheckoutConfigIssueCode;
  variable: string;
  message: string;
}

export interface BillingCheckoutEnabledConfig {
  status: "enabled";
  secretKey: string;
  priceIds: Record<PaidSubscriptionPlan, string>;
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
 * billing-webhook-processor.ts. Any other mode, and any missing Stripe
 * value while "enabled", fails closed rather than defaulting or partially
 * proceeding. The free plan never resolves through this module at all --
 * callers must not invoke it for a "free" selection.
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

  const priceIds = {} as Record<PaidSubscriptionPlan, string>;
  for (const plan of PAID_PLANS) {
    const variable = PRICE_ENV_VAR[plan];
    const priceId = value(env[variable]);
    if (!priceId) {
      issues.push(
        issue("STRIPE_PRICE_ID_REQUIRED", variable, `${variable} is required when BILLING_PROCESSING_MODE is enabled.`),
      );
    } else {
      priceIds[plan] = priceId;
    }
  }

  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  return { status: "enabled", secretKey, priceIds };
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
