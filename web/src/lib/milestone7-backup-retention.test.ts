import { describe, expect, it } from "vitest";

import {
  createAuditEvent,
  createBackupSnapshot,
  createUser,
  enqueuePushNotification,
  getBackupSnapshotsForUser,
  runRetentionJobForUser,
  store
} from "./milestone1-store";

describe("milestone7 backup and retention", () => {
  it("creates backup snapshots and runs retention in dry-run and execution mode", () => {
    const user = createUser({
      email: `m7-retention-${Date.now()}@example.com`,
      password: "password123",
      role: "salon",
      locale: "en"
    });

    enqueuePushNotification({
      userId: user.id,
      channel: "in_app",
      title: "old-item",
      body: "old-body"
    });

    const queueItem = store.pushQueue.find((entry) => entry.userId === user.id);
    if (queueItem) {
      queueItem.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    }

    createAuditEvent({
      ownerUserId: user.id,
      requestId: "req-old",
      module: "security",
      action: "old-event",
      metadata: {}
    });

    const audit = store.auditEvents.find((entry) => entry.ownerUserId === user.id);
    if (audit) {
      audit.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    }

    const backup = createBackupSnapshot(user.id, "before-retention");
    expect(backup.ownerUserId).toBe(user.id);

    const list = getBackupSnapshotsForUser(user.id);
    expect(list.length).toBeGreaterThan(0);

    const dryRun = runRetentionJobForUser({ userId: user.id, olderThanDays: 30, dryRun: true });
    expect(dryRun.pushQueueAffected).toBeGreaterThanOrEqual(1);
    expect(dryRun.auditEventsAffected).toBeGreaterThanOrEqual(1);

    const execute = runRetentionJobForUser({ userId: user.id, olderThanDays: 30, dryRun: false });
    expect(execute.pushQueueAffected).toBeGreaterThanOrEqual(1);
    expect(execute.auditEventsAffected).toBeGreaterThanOrEqual(1);
  });
});
