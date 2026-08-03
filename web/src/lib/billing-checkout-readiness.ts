import { resolveBillingCheckoutConfig, type BillingCheckoutConfigIssue } from "@/lib/billing-checkout-config";

export type CheckoutReadinessStatus = "disabled" | "invalid" | "ready";

export interface CheckoutReadinessResult {
  readonly status: CheckoutReadinessStatus;
  readonly message: string;
  readonly issues?: readonly BillingCheckoutConfigIssue[];
}

const DISABLED_MESSAGE = 'Stripe Checkout is not enabled (BILLING_PROCESSING_MODE is not "enabled").';
const READY_MESSAGE = "Stripe Checkout is ready.";

/**
 * Canonical, fail-closed readiness signal for real Stripe Checkout, built
 * strictly on top of resolveBillingCheckoutConfig -- the same resolver the
 * checkout route itself uses -- so this can never drift from what the route
 * actually requires. Covers BILLING_PROCESSING_MODE, STRIPE_SECRET_KEY,
 * STRIPE_PRICE_PRO/SALON/BUSINESS, and APP_BASE_URL. issues carries only
 * variable names and fixed messages (never a secret value), safe to expose
 * in a readiness response or log. Leaves the existing webhook readiness
 * (billing-readiness.ts / BILLING_WEBHOOK_AUTHENTICITY_READY) untouched.
 */
export function evaluateCheckoutReadiness(env: NodeJS.ProcessEnv = process.env): CheckoutReadinessResult {
  const config = resolveBillingCheckoutConfig(env);

  if (config.status === "disabled") {
    return { status: "disabled", message: DISABLED_MESSAGE };
  }

  if (config.status === "invalid") {
    return {
      status: "invalid",
      message: `Stripe Checkout configuration is invalid: ${config.issues.length} issue(s).`,
      issues: config.issues,
    };
  }

  return { status: "ready", message: READY_MESSAGE };
}
