import { describe, expect, it } from "vitest";

import {
  createUser,
  enqueuePushNotification,
  getPushPreference,
  getPushQueueForUser,
  processPushQueueForUser,
  upsertPushPreference
} from "./milestone1-store";

describe("milestone6 push baseline", () => {
  it("updates preference and processes queue", () => {
    const user = createUser({
      email: `m6-push-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const initial = getPushPreference(user.id);
    expect(initial.enabled).toBe(true);

    const updated = upsertPushPreference({
      userId: user.id,
      enabled: true,
      channels: ["in_app", "email"]
    });
    expect(updated.channels).toContain("email");

    enqueuePushNotification({
      userId: user.id,
      channel: "in_app",
      title: "Reminder",
      body: "Come back soon"
    });

    const result = processPushQueueForUser(user.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const queue = getPushQueueForUser(user.id);
    expect(queue[0].status).toBe("skipped");
  });

  it("never marks an entry sent -- no delivery provider is configured for any channel", () => {
    const user = createUser({
      email: `m6-push-honesty-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    enqueuePushNotification({ userId: user.id, channel: "push", title: "Push", body: "Push body" });
    enqueuePushNotification({ userId: user.id, channel: "email", title: "Email", body: "Email body" });
    enqueuePushNotification({ userId: user.id, channel: "in_app", title: "In-app", body: "In-app body" });

    const result = processPushQueueForUser(user.id);
    expect(result).toEqual({ sent: 0, skipped: 3 });

    const queue = getPushQueueForUser(user.id);
    expect(queue.every((entry) => entry.status === "skipped")).toBe(true);
    expect(queue.some((entry) => entry.status === "sent")).toBe(false);
  });
});
