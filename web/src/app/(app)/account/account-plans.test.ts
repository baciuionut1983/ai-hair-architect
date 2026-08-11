import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PLANS,
  checkoutErrorMessage,
  planDisplayName,
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
