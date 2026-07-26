import { afterEach, describe, expect, it } from "vitest";

import { createUser, enqueuePushNotification, getOpsHealthSnapshot, store } from "./milestone1-store";

let originalPushQueue: typeof store.pushQueue | null = null;

afterEach(() => {
  if (originalPushQueue) {
    store.pushQueue = originalPushQueue;
    originalPushQueue = null;
  }
});

describe("milestone7 ops health", () => {
  it("returns stable health counters", () => {
    createUser({
      email: `m7-health-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const health = getOpsHealthSnapshot(0, 0);
    expect(health.state).toBe("healthy");
    expect(health.usersCount).toBeGreaterThan(0);
    expect(health.clientsCount).toBeGreaterThanOrEqual(0);
    expect(health.auditEventsCount).toBeGreaterThanOrEqual(0);
  });

  it("promotes backlog pressure into warning and degraded states", () => {
    const user = createUser({
      email: `m7-health-backlog-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    originalPushQueue = [...store.pushQueue];
    store.pushQueue = [];

    for (let index = 0; index < 10; index += 1) {
      enqueuePushNotification({
        userId: user.id,
        channel: "in_app",
        title: `warning-${index}`,
        body: "backlog"
      });
    }

    const warningHealth = getOpsHealthSnapshot(0, 0);
    expect(warningHealth.state).toBe("warning");

    for (let index = 0; index < 15; index += 1) {
      store.pushQueue.push({
        id: `degraded-${index}`,
        userId: user.id,
        channel: "in_app",
        title: `degraded-${index}`,
        body: "backlog",
        status: "queued",
        createdAt: new Date().toISOString(),
        processedAt: null
      });
    }

    const degradedHealth = getOpsHealthSnapshot(0, 0);
    expect(degradedHealth.state).toBe("degraded");
  });
});
