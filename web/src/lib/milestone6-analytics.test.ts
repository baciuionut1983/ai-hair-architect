import { describe, expect, it } from "vitest";

import {
  createUser,
  getAnalyticsSnapshotForUser,
  updateSubscriptionForUser
} from "./milestone1-store";

describe("milestone6 analytics snapshot", () => {
  it("aggregates operational and commercial indicators", () => {
    const user = createUser({
      email: `m6-analytics-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    updateSubscriptionForUser({ userId: user.id, plan: "pro", status: "active" });

    const snapshot = getAnalyticsSnapshotForUser(user.id, 1, 1, 1, 2);
    expect(snapshot.consultationsCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.appointmentsCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.remindersSentCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.activeSubscriptionCount).toBe(1);
    expect(snapshot.generatedVideoLessonsCount).toBe(2);
  });
});
