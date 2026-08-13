import { describe, expect, it } from "vitest";

import { DASHBOARD_LINKS } from "./page";

describe("DASHBOARD_LINKS", () => {
  it("marks Account & Subscription as available -- it is a fully working, Stripe-backed page (plan display, Checkout, Manage Subscription via the Customer Portal), not an unbuilt section", () => {
    const accountLink = DASHBOARD_LINKS.find((link) => link.href === "/account");
    expect(accountLink).toBeDefined();
    expect(accountLink?.status).toBe("available");
  });

  it("marks Clients as available (M34 precedent) -- guards against the same mislabeling class regressing", () => {
    const clientsLink = DASHBOARD_LINKS.find((link) => link.href === "/clients");
    expect(clientsLink?.status).toBe("available");
  });

  it("still marks genuinely unbuilt sections as coming-soon", () => {
    for (const href of ["/appointments", "/academy", "/marketplace"]) {
      const link = DASHBOARD_LINKS.find((entry) => entry.href === href);
      expect(link?.status).toBe("coming-soon");
    }
  });
});
