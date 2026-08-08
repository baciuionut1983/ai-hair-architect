import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

import { POST as enqueuePushRoute } from "@/app/api/v1/push/queue/route";
import { POST as processPushRoute } from "@/app/api/v1/push/queue/process/route";
import { GET as getPushQueueRoute } from "@/app/api/v1/push/queue/route";
import { createPersistenceSession } from "@/lib/auth-persistence";
import { __testUtils, runPersistentRetention } from "@/lib/ops-persistence";
import { prisma } from "@/lib/prisma";
import { store } from "@/lib/milestone1-store";

// authenticateSessionRequest() (M32 GO-4B) is Postgres-only: both the User
// and the Session row must be real Postgres rows, unlike the legacy
// resolveOpsSessionUser() this test previously exercised via an in-memory-only
// createUser()/createSession() pair.
async function createPersistedOwner(emailPrefix: string): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: "hash",
      role: "professional",
      locale: "en",
    },
  });
  const token = `m12-push-token-${user.id}`;
  await createPersistenceSession(token, user.id);
  return { id: user.id, token };
}

describe("M12 push runtime persistence", () => {
  const createdUserIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    __testUtils.resetHooks();
    await prisma.opsPushQueueEntry.deleteMany({});
    await prisma.opsRetentionRun.deleteMany({});

    store.sessions.clear();
    store.pushQueue = [];
    createdUserIds.length = 0;
  });

  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return;
    }
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it("persists enqueue and process through real push routes, and retention removes only old owner-scoped entries", async () => {
    const owner = await createPersistedOwner("m12-push-owner");
    const otherOwner = await createPersistedOwner("m12-push-other");
    createdUserIds.push(owner.id, otherOwner.id);

    const ownerToken = owner.token;
    const otherToken = otherOwner.token;

    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: ownerToken }),
    } as never);

    const enqueueResponse = await enqueuePushRoute({
      json: async () => ({ channel: "in_app", title: "Owner push", body: "Owner body" }),
    } as never);
    expect(enqueueResponse.status).toBe(201);

    const enqueuePayload = (await enqueueResponse.json()) as { item: { id: string } };
    const ownerQueueId = enqueuePayload.item.id;

    const persistedQueued = await prisma.opsPushQueueEntry.findUnique({ where: { id: ownerQueueId } });
    expect(persistedQueued?.ownerUserId).toBe(owner.id);
    expect(persistedQueued?.status).toBe("queued");

    const processResponse = await processPushRoute();
    expect(processResponse.status).toBe(200);

    const persistedProcessed = await prisma.opsPushQueueEntry.findUnique({ where: { id: ownerQueueId } });
    expect(persistedProcessed?.status).toBe("sent");
    expect(persistedProcessed?.processedAt).not.toBeNull();

    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: otherToken }),
    } as never);

    const otherEnqueueResponse = await enqueuePushRoute({
      json: async () => ({ channel: "in_app", title: "Other push", body: "Other body" }),
    } as never);
    expect(otherEnqueueResponse.status).toBe(201);

    const otherPayload = (await otherEnqueueResponse.json()) as { item: { id: string } };
    const otherQueueId = otherPayload.item.id;

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    await prisma.opsPushQueueEntry.update({
      where: { id: ownerQueueId },
      data: { createdAt: oldDate },
    });
    await prisma.opsPushQueueEntry.update({
      where: { id: otherQueueId },
      data: { createdAt: oldDate },
    });

    const retention = await runPersistentRetention({
      userId: owner.id,
      olderThanDays: 90,
      dryRun: false,
      confirmationToken: "CONFIRM_RETENTION_EXECUTION",
      executionIdempotencyKey: `m12-push-retention-${Date.now()}`,
      correlationRequestId: "m12-push-retention",
    });

    expect(retention.httpStatus).toBe(200);

    const ownerAfterRetention = await prisma.opsPushQueueEntry.findUnique({ where: { id: ownerQueueId } });
    const otherAfterRetention = await prisma.opsPushQueueEntry.findUnique({ where: { id: otherQueueId } });
    const ownerInStoreAfterRetention = store.pushQueue.find((entry) => entry.id === ownerQueueId);
    const otherInStoreAfterRetention = store.pushQueue.find((entry) => entry.id === otherQueueId);

    expect(ownerAfterRetention).toBeNull();
    expect(otherAfterRetention).not.toBeNull();
    expect(otherAfterRetention?.ownerUserId).toBe(otherOwner.id);
    expect(ownerInStoreAfterRetention).toBeUndefined();
    expect(otherInStoreAfterRetention).toBeDefined();

    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: ownerToken }),
    } as never);

    const ownerQueueResponse = await getPushQueueRoute();
    expect(ownerQueueResponse.status).toBe(200);
    const ownerQueuePayload = (await ownerQueueResponse.json()) as { queue: Array<{ id: string }> };
    expect(ownerQueuePayload.queue.some((entry) => entry.id === ownerQueueId)).toBe(false);

    const postRetentionProcessResponse = await processPushRoute();
    expect(postRetentionProcessResponse.status).toBe(200);
    const postRetentionProcessPayload = (await postRetentionProcessResponse.json()) as { sent: number };
    expect(postRetentionProcessPayload.sent).toBe(0);

    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: otherToken }),
    } as never);

    const otherQueueResponse = await getPushQueueRoute();
    expect(otherQueueResponse.status).toBe(200);
    const otherQueuePayload = (await otherQueueResponse.json()) as { queue: Array<{ id: string }> };
    expect(otherQueuePayload.queue.some((entry) => entry.id === otherQueueId)).toBe(true);
  });

  it("keeps store and DB queued when process DB update fails before commit", async () => {
    const owner = await createPersistedOwner("m12-push-error");
    createdUserIds.push(owner.id);

    const ownerToken = owner.token;

    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: ownerToken }),
    } as never);

    const enqueueResponse = await enqueuePushRoute({
      json: async () => ({ channel: "in_app", title: "Owner queued", body: "Owner queued body" }),
    } as never);
    expect(enqueueResponse.status).toBe(201);

    const enqueuePayload = (await enqueueResponse.json()) as { item: { id: string } };
    const queueId = enqueuePayload.item.id;

    __testUtils.setBeforePushProcessCommitHook(() => {
      throw new Error("forced-process-db-failure");
    });

    await expect(processPushRoute()).rejects.toThrow("forced-process-db-failure");
    __testUtils.resetHooks();

    const queueInStore = store.pushQueue.find((entry) => entry.id === queueId);
    expect(queueInStore?.status).toBe("queued");
    expect(queueInStore?.processedAt).toBeNull();

    const queueInDb = await prisma.opsPushQueueEntry.findUnique({ where: { id: queueId } });
    expect(queueInDb?.status).toBe("queued");
    expect(queueInDb?.processedAt).toBeNull();
  });
});