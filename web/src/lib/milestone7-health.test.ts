import { describe, expect, it } from "vitest";

import { createUser, getOpsHealthSnapshot } from "./milestone1-store";

describe("milestone7 ops health", () => {
  it("returns stable health counters", () => {
    createUser({
      email: `m7-health-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const health = getOpsHealthSnapshot();
    expect(health.usersCount).toBeGreaterThan(0);
    expect(health.clientsCount).toBeGreaterThanOrEqual(0);
    expect(health.auditEventsCount).toBeGreaterThanOrEqual(0);
  });
});
