import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PLANS,
  checkoutErrorMessage,
  planDisplayName,
  portalErrorMessage,
  resolveAccountPlanCardStatus,
} from "./account-plans";

describe("ACCOUNT_PLANS", () => {
  it("offers exactly Individual (pro) and Salon -- Business is never purchasable here", () => {
    expect(ACCOUNT_PLANS.map((plan) => plan.key)).toEqual(["pro", "salon"]);
  });

  it("prices Individual at €19.99/month and Salon at €49.99/month", () => {
    expect(ACCOUNT_PLANS.find((plan) => plan.key === "pro")?.priceLabel).toBe("€19.99/month");
    expect(ACCOUNT_PLANS.find((plan) => plan.key === "salon")?.priceLabel).toBe("€49.99/month");
  });

  it("every plan has a non-empty description", () => {
    for (const plan of ACCOUNT_PLANS) {
      expect(plan.description.length).toBeGreaterThan(0);
    }
  });
});

describe("planDisplayName", () => {
  it("maps every known SubscriptionPlan value to a human label", () => {
    expect(planDisplayName("free")).toBe("Free");
    expect(planDisplayName("pro")).toBe("Individual");
    expect(planDisplayName("salon")).toBe("Salon");
    expect(planDisplayName("business")).toBe("Business");
  });

  it("falls back to the raw key for an unrecognized value, never throwing", () => {
    expect(planDisplayName("mystery-plan")).toBe("mystery-plan");
  });
});

describe("resolveAccountPlanCardStatus", () => {
  it("is 'current' when the plan matches the active, entitled subscription", () => {
    expect(resolveAccountPlanCardStatus("pro", { plan: "pro", entitlementActive: true })).toBe("current");
  });

  it("is 'blocked-other-active' when a different plan is already active -- never offers a silent second subscription", () => {
    expect(resolveAccountPlanCardStatus("salon", { plan: "pro", entitlementActive: true })).toBe("blocked-other-active");
  });

  it("is 'subscribe' when there is no active entitlement at all (free/inactive)", () => {
    expect(resolveAccountPlanCardStatus("pro", { plan: "free", entitlementActive: false })).toBe("subscribe");
  });

  it("is 'subscribe' even if the stored plan name matches, when entitlementActive is false -- plan alone is never trusted", () => {
    expect(resolveAccountPlanCardStatus("pro", { plan: "pro", entitlementActive: false })).toBe("subscribe");
  });
});

describe("checkoutErrorMessage", () => {
  it("maps BILLING_CHECKOUT_PLAN_UNAVAILABLE to an honest, plan-specific message", () => {
    expect(checkoutErrorMessage("BILLING_CHECKOUT_PLAN_UNAVAILABLE")).toBe(
      "This plan is not available for checkout yet. Please try again later.",
    );
  });

  it("falls back to a generic retry message for an unknown or missing error code", () => {
    expect(checkoutErrorMessage("SOMETHING_NEW")).toBe("Could not start checkout. Please try again.");
    expect(checkoutErrorMessage(undefined)).toBe("Could not start checkout. Please try again.");
  });
});

describe("portalErrorMessage", () => {
  it("maps BILLING_CUSTOMER_NOT_FOUND to a message pointing the user to subscribe first", () => {
    expect(portalErrorMessage("BILLING_CUSTOMER_NOT_FOUND")).toBe(
      "You don't have a billing account yet. Subscribe to a plan first.",
    );
  });

  it("maps BILLING_PORTAL_DISABLED and BILLING_PORTAL_MISCONFIGURED to the same honest unavailability message", () => {
    expect(portalErrorMessage("BILLING_PORTAL_DISABLED")).toBe(
      "Subscription management is temporarily unavailable. Please try again later.",
    );
    expect(portalErrorMessage("BILLING_PORTAL_MISCONFIGURED")).toBe(
      "Subscription management is temporarily unavailable. Please try again later.",
    );
  });

  it("maps BILLING_PORTAL_SESSION_FAILED to a retry message", () => {
    expect(portalErrorMessage("BILLING_PORTAL_SESSION_FAILED")).toBe(
      "Could not open subscription management. Please try again.",
    );
  });

  it("falls back to a generic retry message for an unknown or missing error code", () => {
    expect(portalErrorMessage("SOMETHING_NEW")).toBe("Could not open subscription management. Please try again.");
    expect(portalErrorMessage(undefined)).toBe("Could not open subscription management. Please try again.");
  });
});
