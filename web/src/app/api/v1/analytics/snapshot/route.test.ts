import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({ getSession: vi.fn(), getAnalyticsSnapshotForUser: vi.fn() }));
const appointmentRepositoryMock = vi.hoisted(() => ({
  countAppointmentsForOwner: vi.fn(),
  countSentRemindersForOwner: vi.fn(),
  isAppointmentPersistenceError: vi.fn(),
  appointmentPersistenceUnavailableResponse: vi.fn(),
}));
const clientRepositoryMock = vi.hoisted(() => ({
  listActiveClientIdsForOwner: vi.fn(),
  isClientPersistenceError: vi.fn(),
  clientPersistenceUnavailableResponse: vi.fn(),
}));
const consultationRepositoryMock = vi.hoisted(() => ({
  countConsultationsForOwner: vi.fn(),
  isConsultationPersistenceError: vi.fn(),
  consultationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  clientRepositoryMock.listActiveClientIdsForOwner.mockResolvedValue([]);
  consultationRepositoryMock.countConsultationsForOwner.mockResolvedValue(2);
  appointmentRepositoryMock.countAppointmentsForOwner.mockResolvedValue(3);
  appointmentRepositoryMock.countSentRemindersForOwner.mockResolvedValue(1);
  clientRepositoryMock.isClientPersistenceError.mockReturnValue(false);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
  storeMock.getAnalyticsSnapshotForUser.mockReturnValue({ appointmentsCount: 3, remindersSentCount: 1 });
});

describe("analytics snapshot route", () => {
  it("builds the existing snapshot from owner-scoped PostgreSQL counts", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(appointmentRepositoryMock.countAppointmentsForOwner).toHaveBeenCalledWith("owner-1");
    expect(appointmentRepositoryMock.countSentRemindersForOwner).toHaveBeenCalledWith("owner-1");
    expect(storeMock.getAnalyticsSnapshotForUser).toHaveBeenCalledWith("owner-1", 2, 3, 1);
    await expect(response.json()).resolves.toEqual({ snapshot: { appointmentsCount: 3, remindersSentCount: 1 } });
  });

  it("fails closed when Appointment counts are unavailable", async () => {
    const error = new Error("unavailable");
    appointmentRepositoryMock.countAppointmentsForOwner.mockRejectedValue(error);
    appointmentRepositoryMock.isAppointmentPersistenceError.mockImplementation((value) => value === error);
    appointmentRepositoryMock.appointmentPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "APPOINTMENT_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
