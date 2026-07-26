import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { __testUtils, createPersistentBackupSnapshot, runPersistentRetention } from "@/lib/ops-persistence";
import { createAuditEvent, createUser, store } from "@/lib/milestone1-store";

const ownerUserId = "11111111-1111-4111-8111-111111111111";
const secondOwnerUserId = "22222222-2222-4222-8222-222222222222";

async function seedOldAuditEvent(userId: string, action = "legacy-audit-event") {
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action,
      resourceType: "ops",
      resourceId: null,
      status: "success",
      metadata: {},
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    },
  });
}

async function seedOldPushQueue(userId: string, title = "legacy-push") {
  await prisma.opsPushQueueEntry.create({
    data: {
      ownerUserId: userId,
      channel: "in_app",
      title,
      body: "legacy-body",
      status: "queued",
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      processedAt: null,
    },
  });
}

describe("M12 ops persistence integration", () => {
  beforeEach(async () => {
    __testUtils.resetHooks();
    await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: secondOwnerUserId } });
    await prisma.opsPushQueueEntry.deleteMany({ where: { ownerUserId: ownerUserId } });
    await prisma.opsPushQueueEntry.deleteMany({ where: { ownerUserId: secondOwnerUserId } });
    await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId: secondOwnerUserId } });
    await prisma.opsRetentionRun.deleteMany({ where: { ownerUserId } });
    await prisma.opsRetentionRun.deleteMany({ where: { ownerUserId: secondOwnerUserId } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [ownerUserId, secondOwnerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, secondOwnerUserId] } } });

    store.users = store.users.filter((entry) => entry.id !== ownerUserId);
    store.users = store.users.filter((entry) => entry.id !== secondOwnerUserId);
    store.appointments = store.appointments.filter((entry) => entry.ownerUserId !== ownerUserId);
    store.appointments = store.appointments.filter((entry) => entry.ownerUserId !== secondOwnerUserId);
    store.notifications = store.notifications.filter((entry) => entry.ownerUserId !== ownerUserId);
    store.notifications = store.notifications.filter((entry) => entry.ownerUserId !== secondOwnerUserId);
    store.auditEvents = store.auditEvents.filter((entry) => entry.ownerUserId !== ownerUserId);
    store.auditEvents = store.auditEvents.filter((entry) => entry.ownerUserId !== secondOwnerUserId);

    createUser({
      email: `m12-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en",
    }).id = ownerUserId;

    createUser({
      email: `m12-other-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en",
    }).id = secondOwnerUserId;

    await prisma.user.createMany({
      data: [ownerUserId, secondOwnerUserId].map((id) => ({
        id,
        email: `${id}@m12.test`,
        passwordHash: "test",
        role: "professional",
        locale: "en",
      })),
    });
    await prisma.client.createMany({
      data: [
        { ownerUserId, fullName: "M12 Client" },
        { ownerUserId: secondOwnerUserId, fullName: "M12 Other Client" },
      ],
    });
  });

  afterEach(async () => {
    __testUtils.resetHooks();
    await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: secondOwnerUserId } });
    await prisma.opsPushQueueEntry.deleteMany({ where: { ownerUserId: ownerUserId } });
    await prisma.opsPushQueueEntry.deleteMany({ where: { ownerUserId: secondOwnerUserId } });
    await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId } });
    await prisma.opsBackupSnapshot.deleteMany({ where: { ownerUserId: secondOwnerUserId } });
    await prisma.opsRetentionRun.deleteMany({ where: { ownerUserId } });
    await prisma.opsRetentionRun.deleteMany({ where: { ownerUserId: secondOwnerUserId } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [ownerUserId, secondOwnerUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, secondOwnerUserId] } } });
  });

  it("persists backup snapshots with deterministic checksum metadata", async () => {
    const backup = await createPersistentBackupSnapshot({
      ownerUserId,
      createdByUserId: ownerUserId,
      label: "release-checkpoint",
    });

    expect(backup.ownerUserId).toBe(ownerUserId);
    expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(backup.checksumAlgorithm).toBe("sha256");

    const rows = await prisma.opsBackupSnapshot.findMany({ where: { ownerUserId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].checksum).toBe(backup.checksum);
  });

  it("persists dry-run and completed execution ledgers with DB-backed push queue retention", async () => {
    createAuditEvent({
      ownerUserId,
      requestId: "req-old",
      module: "security",
      action: "legacy-audit-event",
      metadata: {},
    });

    await seedOldAuditEvent(ownerUserId);
    await seedOldPushQueue(ownerUserId);

    const dryRun = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: true,
      correlationRequestId: "dry-run-request",
    });

    expect(dryRun.httpStatus).toBe(200);
    expect(dryRun.body.result?.status).toBe("dry_run_completed");
    expect(dryRun.body.result?.pushQueueAffected).toBeGreaterThanOrEqual(1);
    expect(dryRun.body.result?.auditEventsAffected).toBeGreaterThanOrEqual(1);

    const execution = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `key-${Date.now()}`,
      correlationRequestId: "execution-request",
    });

    expect(execution.httpStatus).toBe(200);
    expect(execution.body.result?.status).toBe("execution_completed");
    expect(execution.body.result?.pushQueueAffected).toBeGreaterThanOrEqual(0);
    expect(execution.body.result?.auditEventsAffected).toBeGreaterThanOrEqual(0);

    const remainingPush = await prisma.opsPushQueueEntry.count({ where: { ownerUserId } });
    const remainingAudit = await prisma.auditLog.count({ where: { actorUserId: ownerUserId, action: "legacy-audit-event" } });
    expect(remainingPush).toBe(0);
    expect(remainingAudit).toBe(0);

    const ledger = await prisma.opsRetentionRun.findMany({ where: { ownerUserId }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((entry) => entry.status)).toContain("execution_completed");
  });

  it("returns conflict when advisory lock is already held by another transaction", async () => {
    const advisoryLockKey = __testUtils.deriveAdvisoryLockKey(ownerUserId);
    const executionIdempotencyKey = `lock-conflict-${Date.now()}`;
    let releaseLock: (() => void) | null = null;
    let lockTx: Promise<void> | null = null;

    const lockAcquired = new Promise<void>((resolve) => {
      const hold = new Promise<void>((release) => {
        releaseLock = release;
      });

      lockTx = prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(CAST(${advisoryLockKey} AS bigint)) AS acquired
        `;

        expect(rows[0]?.acquired).toBe(true);
        resolve();
        await hold;
      });
    });

    await lockAcquired;

    const conflict = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey,
      correlationRequestId: "lock-conflict-request",
    });

    expect(conflict.httpStatus).toBe(409);
    expect(conflict.body.error).toBe("RETENTION_CONFLICT");

    const runCount = await prisma.opsRetentionRun.count({
      where: { ownerUserId, executionIdempotencyKey },
    });
    expect(runCount).toBe(0);

    if (releaseLock) {
      releaseLock();
    }

    if (lockTx) {
      await lockTx;
    }
  });

  it("rolls back destructive deletes and persists failure trace on execution errors", async () => {
    await seedOldPushQueue(ownerUserId, "rollback-push");
    await seedOldAuditEvent(ownerUserId, "rollback-audit");

    __testUtils.setBeforeRetentionDeleteHook(() => {
      throw new Error("forced-delete-failure");
    });

    const response = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `rollback-${Date.now()}`,
      correlationRequestId: "rollback-request",
    });

    __testUtils.resetHooks();

    expect(response.httpStatus).toBe(500);
    expect(response.body.error).toBe("INTERNAL_ERROR");

    const remainingPush = await prisma.opsPushQueueEntry.count({ where: { ownerUserId, title: "rollback-push" } });
    const remainingAudit = await prisma.auditLog.count({ where: { actorUserId: ownerUserId, action: "rollback-audit" } });
    expect(remainingPush).toBe(1);
    expect(remainingAudit).toBe(1);

    const failedTrace = await prisma.opsRetentionRun.findFirst({
      where: { ownerUserId, status: "execution_failed" },
      orderBy: { createdAt: "desc" },
    });
    expect(failedTrace).not.toBeNull();
    expect(failedTrace?.errorCode).toBeTruthy();
  });

  it("supports DB idempotency for completed replay, failed replay, and payload conflict", async () => {
    const keyBase = `idempotency-${Date.now()}`;
    await seedOldPushQueue(ownerUserId, "idempotency-push");
    await seedOldAuditEvent(ownerUserId, "idempotency-audit");

    const first = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `${keyBase}-completed`,
      reason: "cleanup",
      correlationRequestId: "idempotency-completed-first",
    });
    expect(first.httpStatus).toBe(200);
    expect(first.body.result?.status).toBe("execution_completed");

    const replay = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `${keyBase}-completed`,
      reason: "cleanup",
      correlationRequestId: "idempotency-completed-replay",
    });
    expect(replay.httpStatus).toBe(200);
    expect(replay.body.result?.replayed).toBe(true);
    expect(replay.body.result?.runId).toBe(first.body.result?.runId);

    const conflict = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `${keyBase}-completed`,
      reason: "different-reason",
      correlationRequestId: "idempotency-conflict",
    });
    expect(conflict.httpStatus).toBe(409);
    expect(conflict.body.error).toBe("IDEMPOTENCY_CONFLICT");

    await seedOldPushQueue(ownerUserId, "idempotency-failed-push");
    await seedOldAuditEvent(ownerUserId, "idempotency-failed-audit");

    __testUtils.setBeforeRetentionDeleteHook(() => {
      throw new Error("forced-failure-once");
    });
    const failed = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `${keyBase}-failed`,
      reason: "failure-case",
      correlationRequestId: "idempotency-failed-first",
    });
    __testUtils.resetHooks();
    expect(failed.httpStatus).toBe(500);

    const failedReplay = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `${keyBase}-failed`,
      reason: "failure-case",
      correlationRequestId: "idempotency-failed-replay",
    });
    expect(failedReplay.httpStatus).toBe(409);
    expect(failedReplay.body.error).toBe("EXECUTION_FAILED");
    expect(failedReplay.body.result?.replayed).toBe(true);
  });

  it("enforces cross-owner isolation for retention deletes", async () => {
    await seedOldPushQueue(ownerUserId, "owner-a");
    await seedOldAuditEvent(ownerUserId, "owner-a");
    await seedOldPushQueue(secondOwnerUserId, "owner-b");
    await seedOldAuditEvent(secondOwnerUserId, "owner-b");

    const result = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `owner-isolation-${Date.now()}`,
      correlationRequestId: "owner-isolation-request",
    });

    expect(result.httpStatus).toBe(200);

    const ownerARemainingPush = await prisma.opsPushQueueEntry.count({ where: { ownerUserId, title: "owner-a" } });
    const ownerBRemainingPush = await prisma.opsPushQueueEntry.count({ where: { ownerUserId: secondOwnerUserId, title: "owner-b" } });
    const ownerARemainingAudit = await prisma.auditLog.count({ where: { actorUserId: ownerUserId, action: "owner-a" } });
    const ownerBRemainingAudit = await prisma.auditLog.count({ where: { actorUserId: secondOwnerUserId, action: "owner-b" } });

    expect(ownerARemainingPush).toBe(0);
    expect(ownerBRemainingPush).toBe(1);
    expect(ownerARemainingAudit).toBe(0);
    expect(ownerBRemainingAudit).toBe(1);
  });

  it("deletes old retention audit for same owner while preserving current execution audit and other-owner audit", async () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

    await prisma.auditLog.create({
      data: {
        actorUserId: ownerUserId,
        action: "ops.retention.execution.completed",
        resourceType: "ops",
        resourceId: "old-run-owner",
        status: "success",
        metadata: { correlationRequestId: "old-owner-correlation" },
        createdAt: oldDate,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: secondOwnerUserId,
        action: "ops.retention.execution.completed",
        resourceType: "ops",
        resourceId: "old-run-other-owner",
        status: "success",
        metadata: { correlationRequestId: "old-other-correlation" },
        createdAt: oldDate,
      },
    });

    const response = await runPersistentRetention({
      userId: ownerUserId,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `retention-audit-delete-${Date.now()}`,
      correlationRequestId: "retention-audit-delete",
    });

    expect(response.httpStatus).toBe(200);

    const ownerOldAudit = await prisma.auditLog.findFirst({
      where: {
        actorUserId: ownerUserId,
        resourceId: "old-run-owner",
      },
    });
    const ownerCurrentStartedAudit = await prisma.auditLog.findFirst({
      where: {
        actorUserId: ownerUserId,
        action: "ops.retention.execution.started",
        metadata: {
          path: ["correlationRequestId"],
          equals: "retention-audit-delete",
        },
      },
    });
    const ownerCurrentCompletedAudit = await prisma.auditLog.findFirst({
      where: {
        actorUserId: ownerUserId,
        action: "ops.retention.execution.completed",
        metadata: {
          path: ["correlationRequestId"],
          equals: "retention-audit-delete",
        },
      },
    });
    const otherOwnerOldAudit = await prisma.auditLog.findFirst({
      where: {
        actorUserId: secondOwnerUserId,
        resourceId: "old-run-other-owner",
      },
    });

    expect(ownerOldAudit).toBeNull();
    expect(ownerCurrentStartedAudit).not.toBeNull();
    expect(ownerCurrentCompletedAudit).not.toBeNull();
    expect(otherOwnerOldAudit).not.toBeNull();
  });
});