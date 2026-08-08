import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({ getOpsHealthSnapshot: vi.fn() }));
const appointmentRepositoryMock = vi.hoisted(() => ({
  countAllAppointments: vi.fn(),
  isAppointmentPersistenceError: vi.fn(),
  appointmentPersistenceUnavailableResponse: vi.fn(),
}));
const notificationRepositoryMock = vi.hoisted(() => ({
  countAllNotifications: vi.fn(),
  isNotificationPersistenceError: vi.fn(),
  notificationPersistenceUnavailableResponse: vi.fn(),
}));
const clientRepositoryMock = vi.hoisted(() => ({
  countActiveClients: vi.fn(),
  isClientPersistenceError: vi.fn(),
  clientPersistenceUnavailableResponse: vi.fn(),
}));
const consultationRepositoryMock = vi.hoisted(() => ({
  countAllConsultations: vi.fn(),
  isConsultationPersistenceError: vi.fn(),
  consultationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);
vi.mock("@/lib/notification-repository", () => notificationRepositoryMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);

import { GET } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  clientRepositoryMock.countActiveClients.mockResolvedValue(2);
  consultationRepositoryMock.countAllConsultations.mockResolvedValue(3);
  appointmentRepositoryMock.countAllAppointments.mockResolvedValue(4);
  notificationRepositoryMock.countAllNotifications.mockResolvedValue(5);
  clientRepositoryMock.isClientPersistenceError.mockReturnValue(false);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
  notificationRepositoryMock.isNotificationPersistenceError.mockReturnValue(false);
  storeMock.getOpsHealthSnapshot.mockReturnValue({ appointmentsCount: 4, notificationsCount: 5 });
});

describe("ops health route", () => {
  it("returns 401 without a cookie, never reading any repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.countActiveClients).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("builds the existing health payload from global PostgreSQL counts", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(appointmentRepositoryMock.countAllAppointments).toHaveBeenCalledOnce();
    expect(notificationRepositoryMock.countAllNotifications).toHaveBeenCalledOnce();
    expect(storeMock.getOpsHealthSnapshot).toHaveBeenCalledWith(2, 3, 4, 5);
    await expect(response.json()).resolves.toEqual({ health: { appointmentsCount: 4, notificationsCount: 5 } });
  });

  it("fails closed when Notification counts are unavailable", async () => {
    const error = new Error("unavailable");
    notificationRepositoryMock.countAllNotifications.mockRejectedValue(error);
    notificationRepositoryMock.isNotificationPersistenceError.mockImplementation((value) => value === error);
    notificationRepositoryMock.notificationPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "NOTIFICATION_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
