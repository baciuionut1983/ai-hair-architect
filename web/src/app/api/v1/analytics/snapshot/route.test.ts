import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({ getAnalyticsSnapshotForUser: vi.fn() }));
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
const videoLessonRepositoryMock = vi.hoisted(() => ({
  countVideoLessonsForOwner: vi.fn(),
  isVideoLessonPersistenceError: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);
vi.mock("@/lib/video-lesson-repository", () => videoLessonRepositoryMock);

import { GET } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  clientRepositoryMock.listActiveClientIdsForOwner.mockResolvedValue([]);
  consultationRepositoryMock.countConsultationsForOwner.mockResolvedValue(2);
  appointmentRepositoryMock.countAppointmentsForOwner.mockResolvedValue(3);
  appointmentRepositoryMock.countSentRemindersForOwner.mockResolvedValue(1);
  clientRepositoryMock.isClientPersistenceError.mockReturnValue(false);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
  videoLessonRepositoryMock.countVideoLessonsForOwner.mockResolvedValue(4);
  videoLessonRepositoryMock.isVideoLessonPersistenceError.mockReturnValue(false);
  storeMock.getAnalyticsSnapshotForUser.mockReturnValue({ appointmentsCount: 3, remindersSentCount: 1, generatedVideoLessonsCount: 4 });
});

describe("analytics snapshot route", () => {
  it("returns 401 without a cookie, never touching any repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(appointmentRepositoryMock.countAppointmentsForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("scopes counts strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await GET();

    expect(appointmentRepositoryMock.countAppointmentsForOwner).toHaveBeenCalledWith("owner-2");
    expect(appointmentRepositoryMock.countAppointmentsForOwner).not.toHaveBeenCalledWith("owner-1");
  });

  it("builds the existing snapshot from owner-scoped PostgreSQL counts", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(appointmentRepositoryMock.countAppointmentsForOwner).toHaveBeenCalledWith("owner-1");
    expect(appointmentRepositoryMock.countSentRemindersForOwner).toHaveBeenCalledWith("owner-1");
    expect(videoLessonRepositoryMock.countVideoLessonsForOwner).toHaveBeenCalledWith("owner-1");
    expect(storeMock.getAnalyticsSnapshotForUser).toHaveBeenCalledWith("owner-1", 2, 3, 1, 4);
    await expect(response.json()).resolves.toEqual({
      snapshot: { appointmentsCount: 3, remindersSentCount: 1, generatedVideoLessonsCount: 4 },
    });
  });

  it("fails closed when the video lesson count is unavailable", async () => {
    const error = new Error("unavailable");
    videoLessonRepositoryMock.countVideoLessonsForOwner.mockRejectedValue(error);
    videoLessonRepositoryMock.isVideoLessonPersistenceError.mockImplementation((value) => value === error);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "VIDEO_LESSON_PERSISTENCE_UNAVAILABLE" });
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
