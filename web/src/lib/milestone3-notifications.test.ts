import { describe, expect, it } from "vitest";

import {
  createAppointment,
  createUser,
  executeReminderJobsForUser,
  getNotificationsForUser
} from "./milestone1-store";

describe("milestone3 notification reminders", () => {
  it("creates reminders once and stays idempotent on retries", () => {
    const user = createUser({
      email: `reminder-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const clientId = `client-${Date.now()}`;

    const startsAt = new Date(Date.now() + 5 * 60_000).toISOString();
    createAppointment({
      ownerUserId: user.id,
      clientId,
      title: "Root touch-up",
      startsAt,
      reminderMinutesBefore: 15,
      reminderType: "follow_up",
      notes: "Use formula from last visit"
    });

    const firstRun = executeReminderJobsForUser(user.id, new Date().toISOString());
    expect(firstRun.remindersCreated).toBe(1);

    const secondRun = executeReminderJobsForUser(user.id, new Date(Date.now() + 60_000).toISOString());
    expect(secondRun.remindersCreated).toBe(0);

    const notifications = getNotificationsForUser(user.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("follow_up");
  });
});
