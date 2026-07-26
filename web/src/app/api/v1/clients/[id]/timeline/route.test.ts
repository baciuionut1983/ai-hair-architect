import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPhotosForClientByUser: vi.fn(),
  getFormulasForClientByUser: vi.fn(),
  getTreatmentsForClientByUser: vi.fn(),
}));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const consultationRepositoryMock = vi.hoisted(() => ({
  listConsultationsForClient: vi.fn(),
  isConsultationPersistenceError: vi.fn(),
  consultationPersistenceUnavailableResponse: vi.fn(),
}));
const appointmentRepositoryMock = vi.hoisted(() => ({
  listAppointmentsForOwner: vi.fn(),
  isAppointmentPersistenceError: vi.fn(),
  appointmentPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  storeMock.getPhotosForClientByUser.mockReturnValue([]);
  storeMock.getFormulasForClientByUser.mockReturnValue([]);
  storeMock.getTreatmentsForClientByUser.mockReturnValue([]);
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
  consultationRepositoryMock.listConsultationsForClient.mockResolvedValue([]);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([]);
  appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
});

describe("client timeline route", () => {
  it("uses one PostgreSQL Appointment read for response and timeline", async () => {
    appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([{
      id: "appointment-1",
      startsAt: "2026-08-01T10:00:00.000Z",
      title: "Consultation",
      notes: "Prepare",
    }]);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(appointmentRepositoryMock.listAppointmentsForOwner).toHaveBeenCalledOnce();
    expect(appointmentRepositoryMock.listAppointmentsForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    expect(payload.appointments).toHaveLength(1);
    expect(payload.timeline).toEqual([{
      id: "appointment-1",
      kind: "appointment",
      createdAt: "2026-08-01T10:00:00.000Z",
      title: "Consultation",
      details: "Prepare",
    }]);
  });

  it("sorts merged entries deterministically", async () => {
    storeMock.getPhotosForClientByUser.mockReturnValue([{
      id: "photo-2",
      createdAt: "2026-08-01T10:00:00.000Z",
      caption: "Photo",
      imageUrl: "/photo.jpg",
    }]);
    consultationRepositoryMock.listConsultationsForClient.mockResolvedValue([{
      id: "consultation-1",
      createdAt: "2026-08-01T10:00:00.000Z",
      summary: "Summary",
    }]);
    appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([{
      id: "appointment-1",
      startsAt: "2026-08-01T10:00:00.000Z",
      title: "Appointment",
      notes: "",
    }]);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const payload = await response.json();

    expect(payload.timeline.map((entry: { kind: string }) => entry.kind)).toEqual([
      "appointment",
      "consultation",
      "photo",
    ]);
  });

  it("fails closed when Appointment persistence is unavailable", async () => {
    const error = new Error("unavailable");
    appointmentRepositoryMock.listAppointmentsForOwner.mockRejectedValue(error);
    appointmentRepositoryMock.isAppointmentPersistenceError.mockImplementation((value) => value === error);
    appointmentRepositoryMock.appointmentPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "APPOINTMENT_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
