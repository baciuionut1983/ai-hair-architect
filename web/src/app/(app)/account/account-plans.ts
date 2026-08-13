export type AccountPlanKey = "pro" | "salon";

export interface AccountPlanDefinition {
  key: AccountPlanKey;
  displayName: string;
  priceLabel: string;
  description: string;
}

// Deliberately only the two plans with a real, configured Stripe price
// today. Business is a valid backend plan key (see contracts.ts
// SubscriptionPlan) but has no Stripe product yet, so it must never appear
// as purchasable here -- see resolveAccountPlanCardStatus/planDisplayName
// below for how an existing Business subscription (if one somehow exists)
// is still displayed honestly, just never offered for new checkout.
export const ACCOUNT_PLANS: readonly AccountPlanDefinition[] = [
  {
    key: "pro",
    displayName: "Individual",
    priceLabel: "€19.99/month",
    description: "Full AI hair analysis, color and treatment plans, and client history for one stylist.",
  },
  {
    key: "salon",
    displayName: "Salon",
    priceLabel: "€49.99/month",
    description: "Everything in Individual, sized for a full salon team.",
  },
];

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  free: "Free",
  pro: "Individual",
  salon: "Salon",
  business: "Business",
};

export function planDisplayName(planKey: string): string {
  return PLAN_DISPLAY_NAMES[planKey] ?? planKey;
}

export type AccountPlanCardStatus = "current" | "subscribe" | "blocked-other-active";

export interface AccountSubscriptionSnapshot {
  plan: string;
  entitlementActive: boolean;
}

/**
 * Pure, testable derivation of what a plan card should show. Never invents
 * a "switch plan" affordance -- no such flow exists in the backend, so a
 * caller with an already-active different paid plan is shown a neutral
 * "blocked-other-active" state instead of a Subscribe button that would
 * silently create a second, unrelated Stripe subscription.
 */
export function resolveAccountPlanCardStatus(
  planKey: AccountPlanKey,
  subscription: AccountSubscriptionSnapshot,
): AccountPlanCardStatus {
  if (subscription.entitlementActive && subscription.plan === planKey) {
    return "current";
  }
  if (subscription.entitlementActive) {
    return "blocked-other-active";
  }
  return "subscribe";
}

const CHECKOUT_ERROR_MESSAGES: Record<string, string> = {
  BILLING_CHECKOUT_PLAN_UNAVAILABLE: "This plan is not available for checkout yet. Please try again later.",
  BILLING_CHECKOUT_DISABLED: "Checkout is temporarily unavailable. Please try again later.",
  BILLING_CHECKOUT_MISCONFIGURED: "Checkout is temporarily unavailable. Please try again later.",
  BILLING_CHECKOUT_CUSTOMER_FAILED: "Could not start checkout. Please try again.",
  BILLING_CHECKOUT_SESSION_FAILED: "Could not start checkout. Please try again.",
  // Neutral by design -- never surfaces Stripe/internal subscription detail.
  BILLING_CHECKOUT_ALREADY_ACTIVE: "You already have an active subscription.",
};

export function checkoutErrorMessage(errorCode: string | undefined): string {
  if (!errorCode) return "Could not start checkout. Please try again.";
  return CHECKOUT_ERROR_MESSAGES[errorCode] ?? "Could not start checkout. Please try again.";
}

const PORTAL_ERROR_MESSAGES: Record<string, string> = {
  BILLING_CUSTOMER_NOT_FOUND: "You don't have a billing account yet. Subscribe to a plan first.",
  BILLING_PORTAL_DISABLED: "Subscription management is temporarily unavailable. Please try again later.",
  BILLING_PORTAL_MISCONFIGURED: "Subscription management is temporarily unavailable. Please try again later.",
  BILLING_PORTAL_SESSION_FAILED: "Could not open subscription management. Please try again.",
};

export function portalErrorMessage(errorCode: string | undefined): string {
  if (!errorCode) return "Could not open subscription management. Please try again.";
  return PORTAL_ERROR_MESSAGES[errorCode] ?? "Could not open subscription management. Please try again.";
}
