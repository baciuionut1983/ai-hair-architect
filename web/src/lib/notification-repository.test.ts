import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  notificationFindMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  notificationCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    notification: {
      findMany: prismaMocks.notificationFindMany,
      updateMany: prismaMocks.notificationUpdateMany,
      count: prismaMocks.notificationCount,
    },
  },
}));

import {
  NotificationPersistenceError,
  type NotificationDb,
  countAllNotifications,
  countNotificationsForOwner,
  listNotificationsForOwner,
  markNotificationsReadForOwner,
  notificationPersistenceUnavailableResponse,
} from "./notification-repository";

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.notificationFindMany.mockReset();
  prismaMocks.notificationUpdateMany.mockReset();
  prismaMocks.notificationCount.mockReset();
});

describe("notification-repository", () => {
  it("lists Notifications only for the owner in deterministic descending order", async () => {
    prismaMocks.notificationFindMany.mockResolvedValue([notificationRow()]);

    await expect(listNotificationsForOwner("owner-1")).resolves.toMatchObject([
      { id: "notification-1", ownerUserId: "owner-1", type: "appointment" },
    ]);
    expect(prismaMocks.notificationFindMany).toHaveBeenCalledWith({
      where: { ownerUserId: "owner-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("marks selected unread owned Notifications without disclosing other IDs", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    prismaMocks.notificationUpdateMany.mockResolvedValue({ count: 1 });

    await expect(markNotificationsReadForOwner(
      "owner-1",
      ["notification-1", "unknown", "cross-owner"],
      now,
    )).resolves.toBe(1);
    expect(prismaMocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: {
        ownerUserId: "owner-1",
        readAt: null,
        id: { in: ["notification-1", "unknown", "cross-owner"] },
      },
      data: { readAt: now },
    });
  });

  it("marks all unread owned Notifications when IDs are omitted", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    prismaMocks.notificationUpdateMany.mockResolvedValue({ count: 2 });

    await expect(markNotificationsReadForOwner("owner-1", undefined, now)).resolves.toBe(2);
    expect(prismaMocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: { ownerUserId: "owner-1", readAt: null },
      data: { readAt: now },
    });
  });

  it("uses owner-scoped and transaction-aware count contracts", async () => {
    prismaMocks.notificationCount.mockResolvedValueOnce(2).mockResolvedValueOnce(8);
    const transactionDb = { notification: { count: vi.fn().mockResolvedValue(3) } };

    await expect(countNotificationsForOwner("owner-1")).resolves.toBe(2);
    await expect(countAllNotifications()).resolves.toBe(8);
    await expect(countNotificationsForOwner(
      "owner-1",
      transactionDb as unknown as NotificationDb,
    )).resolves.toBe(3);
    expect(transactionDb.notification.count).toHaveBeenCalledWith({ where: { ownerUserId: "owner-1" } });
  });

  it("fails closed for malformed persisted enum and timestamp values", async () => {
    prismaMocks.notificationFindMany.mockResolvedValue([notificationRow({ type: "email" })]);
    await expect(listNotificationsForOwner("owner-1")).rejects.toBeInstanceOf(
      NotificationPersistenceError,
    );

    prismaMocks.notificationFindMany.mockResolvedValue([
      notificationRow({ createdAt: new Date("invalid") }),
    ]);
    await expect(listNotificationsForOwner("owner-1")).rejects.toBeInstanceOf(
      NotificationPersistenceError,
    );
  });

  it("maps database failures to a controlled persistence error", async () => {
    prismaMocks.notificationUpdateMany.mockRejectedValue(new Error("database unavailable"));
    await expect(markNotificationsReadForOwner("owner-1")).rejects.toBeInstanceOf(
      NotificationPersistenceError,
    );
  });

  it("fails closed without database configuration and exposes a no-store 503 response", async () => {
    prismaMocks.configured = false;
    await expect(listNotificationsForOwner("owner-1")).rejects.toBeInstanceOf(
      NotificationPersistenceError,
    );

    const response = notificationPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "NOTIFICATION_PERSISTENCE_UNAVAILABLE",
      message: "Notification data is temporarily unavailable.",
    });
  });
});

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "notification-1",
    ownerUserId: "owner-1",
    type: "appointment",
    title: "Reminder: Consultation",
    message: "Upcoming appointment at 2026-08-01T10:00:00.000Z",
    relatedClientId: "client-1",
    relatedAppointmentId: "appointment-1",
    createdAt: new Date("2026-07-27T10:00:00.000Z"),
    readAt: null,
    ...overrides,
  };
}
