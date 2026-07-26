import { randomUUID } from "crypto";

import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAppointmentForOwner,
  executeDueAppointmentRemindersForOwner,
  listAppointmentsForOwner,
} from "@/lib/appointment-repository";
import { prisma } from "@/lib/prisma";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("Appointment durable persistence", () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.appointment.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("creates, restarts, and lists only active-Client owner-scoped records", async () => {
    const first = await createOwnerAndClient();
    const second = await createOwnerAndClient();
    const startsAt = new Date("2026-08-01T10:00:00.000Z");
    const created = await createAppointmentForOwner(first.ownerUserId, {
      clientId: first.clientId,
      title: "Consultation",
      startsAt,
      reminderMinutesBefore: 60,
      reminderType: "appointment",
      notes: "Prepare references.",
    });
    await createAppointmentForOwner(second.ownerUserId, {
      clientId: second.clientId,
      title: "Foreign",
      startsAt,
      reminderMinutesBefore: 60,
      reminderType: "appointment",
      notes: "",
    });

    const freshClient = new PrismaClient();
    try {
      await expect(freshClient.appointment.findFirst({
        where: { id: created.id, ownerUserId: first.ownerUserId },
      })).resolves.toMatchObject({ clientId: first.clientId, title: "Consultation" });
    } finally {
      await freshClient.$disconnect();
    }

    await expect(listAppointmentsForOwner(first.ownerUserId)).resolves.toMatchObject([
      { id: created.id, ownerUserId: first.ownerUserId, clientId: first.clientId },
    ]);
    await expect(listAppointmentsForOwner(second.ownerUserId, first.clientId)).resolves.toEqual([]);

    await prisma.client.update({ where: { id: first.clientId }, data: { deletedAt: new Date() } });
    await expect(listAppointmentsForOwner(first.ownerUserId)).resolves.toEqual([]);
    await expect(prisma.appointment.count({ where: { id: created.id } })).resolves.toBe(1);
  });

  it("rejects missing, cross-owner, and soft-deleted Clients", async () => {
    const first = await createOwnerAndClient();
    const second = await createOwnerAndClient();
    const input = {
      clientId: second.clientId,
      title: "Cross owner",
      startsAt: new Date("2026-08-01T10:00:00.000Z"),
      reminderMinutesBefore: 60,
      reminderType: "appointment" as const,
      notes: "",
    };

    await expect(createAppointmentForOwner(first.ownerUserId, input)).rejects.toMatchObject({
      code: "APPOINTMENT_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    await prisma.client.update({ where: { id: first.clientId }, data: { deletedAt: new Date() } });
    await expect(createAppointmentForOwner(first.ownerUserId, {
      ...input,
      clientId: first.clientId,
    })).rejects.toMatchObject({ code: "APPOINTMENT_CLIENT_NOT_FOUND", httpStatus: 404 });
  });

  it("atomically claims one due reminder and persists one internal Notification", async () => {
    const dependency = await createOwnerAndClient();
    const now = new Date("2026-08-01T09:00:00.000Z");
    const appointment = await createAppointmentForOwner(dependency.ownerUserId, {
      clientId: dependency.clientId,
      title: "Due",
      startsAt: new Date("2026-08-01T10:00:00.000Z"),
      reminderMinutesBefore: 60,
      reminderType: "appointment",
      notes: "",
    });

    const results = await Promise.all([
      executeDueAppointmentRemindersForOwner(dependency.ownerUserId, now),
      executeDueAppointmentRemindersForOwner(dependency.ownerUserId, now),
    ]);

    expect(results.reduce((sum, result) => sum + result.remindersCreated, 0)).toBe(1);
    await expect(prisma.notification.count({
      where: { relatedAppointmentId: appointment.id, ownerUserId: dependency.ownerUserId },
    })).resolves.toBe(1);
    await expect(prisma.appointment.findUnique({ where: { id: appointment.id } })).resolves.toMatchObject({
      reminderSentAt: now,
    });
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@appointment.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Client" } });
  return { ownerUserId, clientId };
}
