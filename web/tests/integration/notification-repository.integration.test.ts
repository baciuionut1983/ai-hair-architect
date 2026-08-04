import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { createAppointmentForOwner, executeDueAppointmentRemindersForOwner } from "@/lib/appointment-repository";
import {
  countAllNotifications,
  countNotificationsForOwner,
  listNotificationsForOwner,
  markNotificationsReadForOwner,
} from "@/lib/notification-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("Notification durable persistence", () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    // M25: a due reminder now also creates an EmailNotification row (status
    // "skipped" in this test environment).
    await prisma.emailNotification.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.appointment.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("persists and lists Notifications only for the owner in deterministic order", async () => {
    const first = await createReminderFixture();
    const second = await createReminderFixture();

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.notification.count({
        where: { ownerUserId: first.ownerUserId },
      })).resolves.toBe(1);
    } finally {
      await freshClient.$disconnect();
    }

    await expect(listNotificationsForOwner(first.ownerUserId)).resolves.toMatchObject([
      { ownerUserId: first.ownerUserId, relatedAppointmentId: first.appointmentId },
    ]);
    await expect(listNotificationsForOwner(second.ownerUserId)).resolves.toHaveLength(1);
  });

  it("marks selected and all unread owned Notifications without cross-owner mutation", async () => {
    const first = await createReminderFixture();
    const second = await createReminderFixture();
    const firstNotification = await prisma.notification.findFirstOrThrow({
      where: { ownerUserId: first.ownerUserId },
    });
    const secondNotification = await prisma.notification.findFirstOrThrow({
      where: { ownerUserId: second.ownerUserId },
    });
    const selectedAt = new Date("2026-08-01T09:05:00.000Z");

    await expect(markNotificationsReadForOwner(first.ownerUserId, [
      firstNotification.id,
      secondNotification.id,
      randomUUID(),
    ], selectedAt)).resolves.toBe(1);
    await expect(prisma.notification.findUnique({ where: { id: firstNotification.id } })).resolves.toMatchObject({
      readAt: selectedAt,
    });
    await expect(prisma.notification.findUnique({ where: { id: secondNotification.id } })).resolves.toMatchObject({
      readAt: null,
    });

    await expect(markNotificationsReadForOwner(first.ownerUserId, undefined, new Date())).resolves.toBe(0);
  });

  it("returns accurate owner, global, and transaction-aware counts", async () => {
    const first = await createReminderFixture();
    const second = await createReminderFixture();

    await expect(countNotificationsForOwner(first.ownerUserId)).resolves.toBe(1);
    await expect(countAllNotifications()).resolves.toBeGreaterThanOrEqual(2);
    await expect(prisma.$transaction((tx) => countNotificationsForOwner(first.ownerUserId, tx)))
      .resolves.toBe(1);
    await expect(countNotificationsForOwner(second.ownerUserId)).resolves.toBe(1);
  });
});

async function createReminderFixture() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@notification.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Client" } });
  const appointment = await createAppointmentForOwner(ownerUserId, {
    clientId,
    title: "Due",
    startsAt: new Date("2026-08-01T10:00:00.000Z"),
    reminderMinutesBefore: 60,
    reminderType: "appointment",
    notes: "",
  });
  await executeDueAppointmentRemindersForOwner(ownerUserId, new Date("2026-08-01T09:00:00.000Z"));
  return { ownerUserId, appointmentId: appointment.id };
}
