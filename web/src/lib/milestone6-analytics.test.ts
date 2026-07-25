import { describe, expect, it } from "vitest";

import {
  createAppointment,
  createUser,
  executeReminderJobsForUser,
  getAnalyticsSnapshotForUser,
  store,
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

    const clientId = `client-${Date.now()}`;

    store.consultations.push({
      id: `c-${Date.now()}`,
      clientId,
      analysisId: "analysis",
      summary: "M6 consultation",
      nextSteps: [],
      createdAt: new Date().toISOString()
    });

    createAppointment({
      ownerUserId: user.id,
      clientId,
      title: "M6 appointment",
      startsAt: new Date(Date.now() + 3 * 60_000).toISOString(),
      reminderMinutesBefore: 5,
      reminderType: "appointment",
      notes: ""
    });

    executeReminderJobsForUser(user.id, new Date().toISOString());
    updateSubscriptionForUser({ userId: user.id, plan: "pro", status: "active" });

    const snapshot = getAnalyticsSnapshotForUser(user.id, [clientId]);
    expect(snapshot.consultationsCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.appointmentsCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.remindersSentCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.activeSubscriptionCount).toBe(1);
  });
});
