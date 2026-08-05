import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
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
const clientPhotoRepositoryMock = vi.hoisted(() => ({
  listClientPhotosForOwner: vi.fn(),
  isClientPhotoPersistenceError: vi.fn(),
  clientPhotoPersistenceUnavailableResponse: vi.fn(),
}));
const clientFormulaRepositoryMock = vi.hoisted(() => ({
  listClientFormulasForOwner: vi.fn(),
  isClientFormulaPersistenceError: vi.fn(),
  clientFormulaPersistenceUnavailableResponse: vi.fn(),
}));
const clientTreatmentRepositoryMock = vi.hoisted(() => ({
  listClientTreatmentsForOwner: vi.fn(),
  isClientTreatmentPersistenceError: vi.fn(),
  clientTreatmentPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);
vi.mock("@/lib/client-photo-repository", () => clientPhotoRepositoryMock);
vi.mock("@/lib/client-formula-repository", () => clientFormulaRepositoryMock);
vi.mock("@/lib/client-treatment-repository", () => clientTreatmentRepositoryMock);

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
  consultationRepositoryMock.listConsultationsForClient.mockResolvedValue([]);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([]);
  appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
  clientPhotoRepositoryMock.listClientPhotosForOwner.mockResolvedValue([]);
  clientPhotoRepositoryMock.isClientPhotoPersistenceError.mockReturnValue(false);
  clientFormulaRepositoryMock.listClientFormulasForOwner.mockResolvedValue([]);
  clientFormulaRepositoryMock.isClientFormulaPersistenceError.mockReturnValue(false);
  clientTreatmentRepositoryMock.listClientTreatmentsForOwner.mockResolvedValue([]);
  clientTreatmentRepositoryMock.isClientTreatmentPersistenceError.mockReturnValue(false);
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

  it("reads photos, formulas, and treatments from their persistent repositories, owner-scoped", async () => {
    clientPhotoRepositoryMock.listClientPhotosForOwner.mockResolvedValue([{
      id: "photo-1", clientId: "client-1", imageUrl: "/photo.jpg", caption: "Before", createdAt: "2026-08-01T10:00:00.000Z",
    }]);
    clientFormulaRepositoryMock.listClientFormulasForOwner.mockResolvedValue([{
      id: "formula-1", clientId: "client-1", formulaName: "6N", formulaDetails: "20vol", createdAt: "2026-08-01T09:00:00.000Z",
    }]);
    clientTreatmentRepositoryMock.listClientTreatmentsForOwner.mockResolvedValue([{
      id: "treatment-1", clientId: "client-1", treatmentName: "Hydration", treatmentDetails: "Mask", createdAt: "2026-08-01T08:00:00.000Z",
    }]);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const payload = await response.json();

    expect(clientPhotoRepositoryMock.listClientPhotosForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    expect(clientFormulaRepositoryMock.listClientFormulasForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    expect(clientTreatmentRepositoryMock.listClientTreatmentsForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    expect(payload.photos).toHaveLength(1);
    expect(payload.formulas).toHaveLength(1);
    expect(payload.treatments).toHaveLength(1);
    expect(payload.timeline.map((entry: { kind: string }) => entry.kind)).toEqual([
      "photo",
      "formula",
      "treatment",
    ]);
  });

  it("returns an empty timeline (all fields empty arrays) when the client has no records at all", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      photos: [],
      formulas: [],
      treatments: [],
      consultations: [],
      appointments: [],
      timeline: [],
    });
  });

  it("sorts merged entries deterministically", async () => {
    clientPhotoRepositoryMock.listClientPhotosForOwner.mockResolvedValue([{
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

  it("fails closed when ClientPhoto persistence is unavailable", async () => {
    const error = new Error("unavailable");
    clientPhotoRepositoryMock.listClientPhotosForOwner.mockRejectedValue(error);
    clientPhotoRepositoryMock.isClientPhotoPersistenceError.mockImplementation((value) => value === error);
    clientPhotoRepositoryMock.clientPhotoPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "CLIENT_PHOTO_PERSISTENCE_UNAVAILABLE" }, {
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

  it("returns 404 for a nonexistent or another owner's client without reading any list repository", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "someone-elses-client" }),
    });

    expect(response.status).toBe(404);
    expect(clientPhotoRepositoryMock.listClientPhotosForOwner).not.toHaveBeenCalled();
    expect(clientFormulaRepositoryMock.listClientFormulasForOwner).not.toHaveBeenCalled();
    expect(clientTreatmentRepositoryMock.listClientTreatmentsForOwner).not.toHaveBeenCalled();
  });
});
