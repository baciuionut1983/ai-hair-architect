import { describe, expect, it, vi } from "vitest";

import {
  createAuditEvent,
  createBackupSnapshot,
  createClient,
  createWorkspace,
  createUser,
  enqueuePushNotification,
  getBackupSnapshotsForUser,
  beginRetentionExecutionScope,
  endRetentionExecutionScope,
  isRetentionExecutionScopeActive,
  runRetentionJobForUser,
  store
} from "./milestone1-store";

describe("milestone7 backup and retention", () => {
  it("creates deterministic owner-scoped backup snapshots and runs retention in dry-run and execution mode", () => {
    const user = createUser({
      email: `m7-retention-${Date.now()}@example.com`,
      password: "password123",
      role: "salon",
      locale: "en"
    });

    const otherUser = createUser({
      email: `m7-retention-other-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    createWorkspace(user.id, "User workspace");
    createClient({ ownerUserId: user.id, fullName: "Owned Client" });
    createWorkspace(otherUser.id, "Other workspace");
    createClient({ ownerUserId: otherUser.id, fullName: "Other Client" });

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
      // Test-only aging for retention eligibility. This does not represent a public
      // API that edits existing audit records.
      audit.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    }

    const auditBeforeAppend = store.auditEvents
      .filter((entry) => entry.ownerUserId === user.id)
      .map((entry) => ({ ...entry }));

    createAuditEvent({
      ownerUserId: user.id,
      requestId: "req-new",
      module: "billing",
      action: "new-event",
      metadata: {}
    });

    const auditAfterAppend = store.auditEvents.filter((entry) => entry.ownerUserId === user.id);
    expect(auditAfterAppend).toHaveLength(auditBeforeAppend.length + 1);
    expect(auditAfterAppend.slice(0, auditBeforeAppend.length).map((entry) => ({ ...entry }))).toEqual(
      auditBeforeAppend
    );

    const auditBeforeBackup = store.auditEvents.map((entry) => ({ ...entry }));

    const backup = createBackupSnapshot(user.id, "before-retention");
    expect(backup.ownerUserId).toBe(user.id);
    expect(backup.snapshot).toEqual({
      clientsCount: 1,
      consultationsCount: 0,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: 1
    });

    const backup2 = createBackupSnapshot(user.id, "before-retention-2");
    expect(backup2.snapshot).toEqual(backup.snapshot);
    expect(backup2.label).toBe("before-retention-2");
    expect(backup2.snapshot).toEqual(backup.snapshot);

    const otherUserBackup = createBackupSnapshot(otherUser.id, "other-user-backup");
    expect(otherUserBackup.ownerUserId).toBe(otherUser.id);
    expect(otherUserBackup.snapshot).toEqual({
      clientsCount: 1,
      consultationsCount: 0,
      appointmentsCount: 0,
      notificationsCount: 0,
      workspacesCount: 1
    });

    const list = getBackupSnapshotsForUser(user.id);
    expect(list.every((entry) => entry.ownerUserId === user.id)).toBe(true);
    expect(list).toHaveLength(2);
    expect(list.map((entry) => entry.label)).toEqual(["before-retention-2", "before-retention"]);
    expect(list.every((entry) => entry.snapshot.clientsCount === 1)).toBe(true);
    expect(store.auditEvents).toEqual(auditBeforeBackup);

    const dryRun = runRetentionJobForUser({ userId: user.id, olderThanDays: 30, dryRun: true });
    expect(dryRun.pushQueueAffected).toBeGreaterThanOrEqual(1);
    expect(dryRun.auditEventsAffected).toBeGreaterThanOrEqual(1);

    const execute = runRetentionJobForUser({ userId: user.id, olderThanDays: 30, dryRun: false });
    expect(execute.pushQueueAffected).toBeGreaterThanOrEqual(1);
    expect(execute.auditEventsAffected).toBeGreaterThanOrEqual(1);

    const otherUserBackups = getBackupSnapshotsForUser(otherUser.id);
    expect(otherUserBackups).toHaveLength(1);
    expect(otherUserBackups[0].ownerUserId).toBe(otherUser.id);
  });

  it("guards retention execution with an explicit concurrency lock", () => {
    const scope = `retention-scope-${Date.now()}`;

    expect(beginRetentionExecutionScope(scope)).toBe(true);
    expect(isRetentionExecutionScopeActive(scope)).toBe(true);
    expect(beginRetentionExecutionScope(scope)).toBe(false);

    endRetentionExecutionScope(scope);
    expect(isRetentionExecutionScopeActive(scope)).toBe(false);
  });

  it("orders backups by createdAt descending and keeps equal timestamps stable", () => {
    const user = createUser({
      email: `m7-backup-order-${Date.now()}@example.com`,
      password: "password123",
      role: "salon",
      locale: "en"
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T20:00:00.000Z"));

    try {
      const first = createBackupSnapshot(user.id, "first");
      const second = createBackupSnapshot(user.id, "second");

      const backups = getBackupSnapshotsForUser(user.id);
      expect(backups).toHaveLength(2);
      expect(backups.map((entry) => entry.label)).toEqual([first.label, second.label]);
      expect(backups[0].createdAt).toBe(backups[1].createdAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
