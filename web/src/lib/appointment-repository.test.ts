import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  clientFindFirst: vi.fn(),
  appointmentCreate: vi.fn(),
  appointmentFindMany: vi.fn(),
  appointmentCount: vi.fn(),
  appointmentUpdateMany: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: {
    $transaction: prismaMocks.transaction,
    $queryRaw: prismaMocks.queryRaw,
    appointment: {
      findMany: prismaMocks.appointmentFindMany,
      count: prismaMocks.appointmentCount,
    },
  },
}));

const emailMocks = vi.hoisted(() => ({
  findRecipientEmailForOwner: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));
vi.mock("@/lib/email-repository", () => ({
  findRecipientEmailForOwner: emailMocks.findRecipientEmailForOwner,
}));
vi.mock("@/lib/email-service", () => ({
  sendTransactionalEmail: emailMocks.sendTransactionalEmail,
}));

import {
  AppointmentDependencyError,
  AppointmentPersistenceError,
  type AppointmentDb,
  appointmentPersistenceUnavailableResponse,
  countAllAppointments,
  countAppointmentsForOwner,
  countSentRemindersForOwner,
  createAppointmentForOwner,
  executeDueAppointmentRemindersForOwner,
  listAppointmentsForOwner,
} from "./appointment-repository";

const tx = {
  client: { findFirst: prismaMocks.clientFindFirst },
  appointment: {
    create: prismaMocks.appointmentCreate,
    updateMany: prismaMocks.appointmentUpdateMany,
  },
  notification: { create: prismaMocks.notificationCreate },
};

beforeEach(() => {
  prismaMocks.configured = true;
  prismaMocks.transaction.mockReset();
  prismaMocks.queryRaw.mockReset();
  prismaMocks.clientFindFirst.mockReset();
  prismaMocks.appointmentCreate.mockReset();
  prismaMocks.appointmentFindMany.mockReset();
  prismaMocks.appointmentCount.mockReset();
  prismaMocks.appointmentUpdateMany.mockReset();
  prismaMocks.notificationCreate.mockReset();
  prismaMocks.transaction.mockImplementation(async (operation) => operation(tx));
  emailMocks.findRecipientEmailForOwner.mockReset().mockResolvedValue("owner@example.com");
  emailMocks.sendTransactionalEmail.mockReset().mockResolvedValue({ status: "sent", notificationId: "email-1", providerMessageId: "re_1" });
});

describe("appointment-repository", () => {
  it("creates for an active owner-scoped Client inside the creation transaction", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.appointmentCreate.mockResolvedValue(appointmentRow());

    await expect(createAppointmentForOwner("owner-1", createInput())).resolves.toMatchObject({
      id: "appointment-1",
      ownerUserId: "owner-1",
      clientId: "client-1",
      reminderType: "appointment",
    });
    expect(prismaMocks.clientFindFirst).toHaveBeenCalledWith({
      where: { id: "client-1", ownerUserId: "owner-1", deletedAt: null },
      select: { id: true },
    });
    expect(prismaMocks.appointmentCreate.mock.calls[0][0].data).toMatchObject({
      ownerUserId: "owner-1",
      clientId: "client-1",
    });
  });

  it("rejects missing, cross-owner, or soft-deleted Clients without creating", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue(null);

    await expect(createAppointmentForOwner("owner-1", createInput())).rejects.toBeInstanceOf(
      AppointmentDependencyError,
    );
    await expect(createAppointmentForOwner("owner-1", createInput())).rejects.toMatchObject({
      code: "APPOINTMENT_CLIENT_NOT_FOUND",
      httpStatus: 404,
    });
    expect(prismaMocks.appointmentCreate).not.toHaveBeenCalled();
  });

  it("lists only active-Client rows for the owner and optional Client in deterministic order", async () => {
    prismaMocks.appointmentFindMany.mockResolvedValue([appointmentRow()]);

    await expect(listAppointmentsForOwner("owner-1", "client-1")).resolves.toHaveLength(1);
    expect(prismaMocks.appointmentFindMany).toHaveBeenCalledWith({
      where: { ownerUserId: "owner-1", clientId: "client-1", client: { deletedAt: null } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
  });

  it("uses owner-scoped and transaction-aware count contracts", async () => {
    prismaMocks.appointmentCount.mockResolvedValueOnce(2).mockResolvedValueOnce(7).mockResolvedValueOnce(1);
    const transactionDb = { appointment: { count: vi.fn().mockResolvedValue(3) } };

    await expect(countAppointmentsForOwner("owner-1")).resolves.toBe(2);
    await expect(countAllAppointments()).resolves.toBe(7);
    await expect(countSentRemindersForOwner("owner-1")).resolves.toBe(1);
    await expect(countAppointmentsForOwner(
      "owner-1",
      transactionDb as unknown as AppointmentDb,
    )).resolves.toBe(3);
    expect(transactionDb.appointment.count).toHaveBeenCalledWith({ where: { ownerUserId: "owner-1" } });
    expect(prismaMocks.appointmentCount).toHaveBeenLastCalledWith({
      where: { ownerUserId: "owner-1", reminderSentAt: { not: null } },
    });
  });

  it("fails closed for malformed persisted values", async () => {
    prismaMocks.appointmentFindMany.mockResolvedValue([
      appointmentRow({ reminderMinutesBefore: 0 }),
    ]);

    await expect(listAppointmentsForOwner("owner-1")).rejects.toBeInstanceOf(
      AppointmentPersistenceError,
    );
  });

  it("selects one capped batch and uses one Serializable transaction per reminder", async () => {
    const now = new Date("2026-08-01T09:00:00.000Z");
    prismaMocks.queryRaw.mockResolvedValue([
      dueCandidate({ id: "appointment-1" }),
      dueCandidate({ id: "appointment-2", title: "Follow up", reminderType: "follow_up" }),
    ]);
    prismaMocks.appointmentUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.notificationCreate.mockResolvedValue({});

    await expect(executeDueAppointmentRemindersForOwner("owner-1", now)).resolves.toEqual({
      remindersCreated: 2,
    });
    expect(prismaMocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(2);
    expect(prismaMocks.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prismaMocks.transaction.mock.calls[1][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prismaMocks.notificationCreate).toHaveBeenCalledTimes(2);
    expect(prismaMocks.notificationCreate.mock.calls[0][0].data).toMatchObject({
      ownerUserId: "owner-1",
      relatedAppointmentId: "appointment-1",
      createdAt: now,
    });
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(emailMocks.sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        category: "transactional",
        eventType: "appointment.reminder_due",
        recipientEmail: "owner@example.com",
        idempotencyKey: "transactional.appointment_reminder:appointment-1",
        relatedEntityType: "Appointment",
        relatedEntityId: "appointment-1",
      }),
    );
  });

  it("creates no Notification and sends no email when the conditional claim loses a race", async () => {
    prismaMocks.queryRaw.mockResolvedValue([dueCandidate()]);
    prismaMocks.appointmentUpdateMany.mockResolvedValue({ count: 0 });

    await expect(executeDueAppointmentRemindersForOwner("owner-1")).resolves.toEqual({
      remindersCreated: 0,
    });
    expect(prismaMocks.notificationCreate).not.toHaveBeenCalled();
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("still reports the reminder as created when resolving the recipient email throws", async () => {
    prismaMocks.queryRaw.mockResolvedValue([dueCandidate()]);
    prismaMocks.appointmentUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.notificationCreate.mockResolvedValue({});
    emailMocks.findRecipientEmailForOwner.mockRejectedValue(new Error("email db down"));

    await expect(executeDueAppointmentRemindersForOwner("owner-1")).resolves.toEqual({
      remindersCreated: 1,
    });
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("still reports the reminder as created when sendTransactionalEmail itself rejects unexpectedly", async () => {
    prismaMocks.queryRaw.mockResolvedValue([dueCandidate()]);
    prismaMocks.appointmentUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.notificationCreate.mockResolvedValue({});
    emailMocks.sendTransactionalEmail.mockRejectedValue(new Error("unexpected"));

    await expect(executeDueAppointmentRemindersForOwner("owner-1")).resolves.toEqual({
      remindersCreated: 1,
    });
  });

  it("sends no email when the owner has no resolvable recipient address", async () => {
    prismaMocks.queryRaw.mockResolvedValue([dueCandidate()]);
    prismaMocks.appointmentUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.notificationCreate.mockResolvedValue({});
    emailMocks.findRecipientEmailForOwner.mockResolvedValue(null);

    await expect(executeDueAppointmentRemindersForOwner("owner-1")).resolves.toEqual({
      remindersCreated: 1,
    });
    expect(emailMocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("retries one candidate transaction on serialization conflicts", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", {
      code: "P2034",
      clientVersion: "test",
    });
    prismaMocks.queryRaw.mockResolvedValue([dueCandidate()]);
    prismaMocks.appointmentUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.notificationCreate.mockResolvedValue({});
    prismaMocks.transaction
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (operation) => operation(tx));

    await expect(executeDueAppointmentRemindersForOwner("owner-1")).resolves.toEqual({
      remindersCreated: 1,
    });
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
  });

  it("returns a controlled conflict after exhausting per-candidate retries", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("deadlock", {
      code: "P2034",
      clientVersion: "test",
    });
    prismaMocks.queryRaw.mockResolvedValue([dueCandidate()]);
    prismaMocks.transaction.mockRejectedValue(conflict);

    await expect(executeDueAppointmentRemindersForOwner("owner-1")).rejects.toMatchObject({
      code: "APPOINTMENT_CONCURRENCY_CONFLICT",
      httpStatus: 409,
    });
    expect(prismaMocks.transaction).toHaveBeenCalledTimes(3);
  });

  it("maps dependency races and unexpected database failures to controlled errors", async () => {
    prismaMocks.clientFindFirst.mockResolvedValue({ id: "client-1" });
    prismaMocks.appointmentCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "test",
    }));
    await expect(createAppointmentForOwner("owner-1", createInput())).rejects.toMatchObject({
      code: "APPOINTMENT_DEPENDENCY_CHANGED",
      httpStatus: 409,
    });

    prismaMocks.appointmentFindMany.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(listAppointmentsForOwner("owner-1")).rejects.toBeInstanceOf(
      AppointmentPersistenceError,
    );
  });

  it("fails closed without database configuration and exposes a no-store 503 response", async () => {
    prismaMocks.configured = false;
    await expect(listAppointmentsForOwner("owner-1")).rejects.toBeInstanceOf(
      AppointmentPersistenceError,
    );

    const response = appointmentPersistenceUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "APPOINTMENT_PERSISTENCE_UNAVAILABLE",
      message: "Appointment data is temporarily unavailable.",
    });
  });
});

function createInput() {
  return {
    clientId: "client-1",
    title: "Consultation",
    startsAt: new Date("2026-08-01T10:00:00.000Z"),
    reminderMinutesBefore: 1440,
    reminderType: "appointment" as const,
    notes: "Prepare references.",
  };
}

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "appointment-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    title: "Consultation",
    startsAt: new Date("2026-08-01T10:00:00.000Z"),
    reminderMinutesBefore: 1440,
    reminderType: "appointment",
    reminderSentAt: null,
    notes: "Prepare references.",
    createdAt: new Date("2026-07-27T10:00:00.000Z"),
    updatedAt: new Date("2026-07-27T10:00:00.000Z"),
    ...overrides,
  };
}

function dueCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "appointment-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    title: "Consultation",
    startsAt: new Date("2026-08-01T10:00:00.000Z"),
    reminderType: "appointment",
    ...overrides,
  };
}
