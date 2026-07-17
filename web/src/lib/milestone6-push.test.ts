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
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const queue = getPushQueueForUser(user.id);
    expect(queue[0].status).toBe("sent");
  });
});
