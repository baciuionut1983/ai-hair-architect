import { describe, expect, it } from "vitest";

import {
  createPaymentRecord,
  createUser,
  getSubscriptionForUser,
  updateSubscriptionForUser
} from "./milestone1-store";

describe("milestone5 billing module", () => {
  it("updates subscription lifecycle and deduplicates payment events", () => {
    const user = createUser({
      email: `m5-billing-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const initial = getSubscriptionForUser(user.id);
    expect(initial.plan).toBe("free");

    const trial = updateSubscriptionForUser({ userId: user.id, plan: "pro", status: "trialing" });
    expect(trial.plan).toBe("pro");
    expect(trial.status).toBe("trialing");

    const active = updateSubscriptionForUser({ userId: user.id, plan: "pro", status: "active" });
    expect(active.status).toBe("active");

    const payment1 = createPaymentRecord({
      ownerUserId: user.id,
      providerEventId: "evt-001",
      amountCents: 4900,
      currency: "USD",
      status: "succeeded"
    });

    const payment2 = createPaymentRecord({
      ownerUserId: user.id,
      providerEventId: "evt-001",
      amountCents: 4900,
      currency: "USD",
      status: "succeeded"
    });

    expect(payment1.id).toBe(payment2.id);
  });
});
