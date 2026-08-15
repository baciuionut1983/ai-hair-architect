import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
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
const imageAssetRepositoryMock = vi.hoisted(() => ({
  listImageAssetPhotosForClient: vi.fn(),
  isImageAssetPersistenceError: vi.fn(),
  imageAssetPersistenceUnavailableResponse: vi.fn(),
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

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/consultation-repository", () => consultationRepositoryMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);
vi.mock("@/lib/client-photo-repository", () => clientPhotoRepositoryMock);
vi.mock("@/lib/image-asset-repository", () => imageAssetRepositoryMock);
vi.mock("@/lib/client-formula-repository", () => clientFormulaRepositoryMock);
vi.mock("@/lib/client-treatment-repository", () => clientTreatmentRepositoryMock);

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue({ id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" });
  clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
  consultationRepositoryMock.listConsultationsForClient.mockResolvedValue([]);
  consultationRepositoryMock.isConsultationPersistenceError.mockReturnValue(false);
  appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([]);
  appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
  clientPhotoRepositoryMock.listClientPhotosForOwner.mockResolvedValue([]);
  clientPhotoRepositoryMock.isClientPhotoPersistenceError.mockReturnValue(false);
  imageAssetRepositoryMock.listImageAssetPhotosForClient.mockResolvedValue([]);
  imageAssetRepositoryMock.isImageAssetPersistenceError.mockReturnValue(false);
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
    appointmentRepositoryMock.isAppointmentPersistenceError.mockImplementation((value: unknown) => value === error);
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
    clientPhotoRepositoryMock.isClientPhotoPersistenceError.mockImplementation((value: unknown) => value === error);
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

  // Regression: a client's real, correctly-uploaded photo (written to
  // ImageAsset by the actual analysis-upload pipeline) never appeared in
  // the History tab, because this endpoint only ever queried the separate,
  // practically unreachable ClientPhoto table (see image-asset-repository.ts
  // for the full root-cause writeup). These lock in that ImageAsset rows
  // are now included too.
  it("fails closed when ImageAsset photo persistence is unavailable, never returning a partial/empty history", async () => {
    const error = new Error("unavailable");
    imageAssetRepositoryMock.listImageAssetPhotosForClient.mockRejectedValue(error);
    imageAssetRepositoryMock.isImageAssetPersistenceError.mockImplementation((value: unknown) => value === error);
    imageAssetRepositoryMock.imageAssetPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "IMAGE_ASSET_PERSISTENCE_UNAVAILABLE" }, {
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

  it("queries ImageAsset photos scoped to the authenticated owner and this exact client", async () => {
    await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "client-1" }) });

    expect(imageAssetRepositoryMock.listImageAssetPhotosForClient).toHaveBeenCalledWith("owner-1", "client-1");
  });

  it("includes ImageAsset-backed photos in the response, not only ClientPhoto rows", async () => {
    clientPhotoRepositoryMock.listClientPhotosForOwner.mockResolvedValue([]);
    imageAssetRepositoryMock.listImageAssetPhotosForClient.mockResolvedValue([{
      id: "asset-1", clientId: "client-1", imageUrl: "/api/v1/image-assets/asset-1/content", caption: "", createdAt: "2026-08-10T10:00:00.000Z",
    }]);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "client-1" }) });
    const payload = await response.json();

    expect(payload.photos).toEqual([
      { id: "asset-1", clientId: "client-1", imageUrl: "/api/v1/image-assets/asset-1/content", caption: "", createdAt: "2026-08-10T10:00:00.000Z" },
    ]);
  });

  it("merges ClientPhoto and ImageAsset photos into one newest-first list, without duplicating either", async () => {
    const older = { id: "photo-1", clientId: "client-1", imageUrl: "https://example.com/a.jpg", caption: "Before", createdAt: "2026-08-01T10:00:00.000Z" };
    const newer = { id: "asset-1", clientId: "client-1", imageUrl: "/api/v1/image-assets/asset-1/content", caption: "", createdAt: "2026-08-10T10:00:00.000Z" };
    clientPhotoRepositoryMock.listClientPhotosForOwner.mockResolvedValue([older]);
    imageAssetRepositoryMock.listImageAssetPhotosForClient.mockResolvedValue([newer]);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "client-1" }) });
    const payload = await response.json();

    expect(payload.photos).toEqual([newer, older]);
    expect(payload.photos).toHaveLength(2);
  });

  it("includes merged photos in the unified `timeline` array too, as kind: 'photo'", async () => {
    imageAssetRepositoryMock.listImageAssetPhotosForClient.mockResolvedValue([{
      id: "asset-1", clientId: "client-1", imageUrl: "/api/v1/image-assets/asset-1/content", caption: "", createdAt: "2026-08-10T10:00:00.000Z",
    }]);

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "client-1" }) });
    const payload = await response.json();

    const entry = payload.timeline.find((item: { kind: string }) => item.kind === "photo");
    expect(entry).toMatchObject({ id: "asset-1", kind: "photo", details: "/api/v1/image-assets/asset-1/content" });
  });

  it("returns 401 without a cookie, never reading any repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });

    expect(response.status).toBe(401);
    expect(clientRepositoryMock.resolveOwnedClient).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "client-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 for a nonexistent or another owner's client without reading any list repository", async () => {
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "someone-elses-client" }),
    });

    expect(response.status).toBe(404);
    expect(clientPhotoRepositoryMock.listClientPhotosForOwner).not.toHaveBeenCalled();
    expect(imageAssetRepositoryMock.listImageAssetPhotosForClient).not.toHaveBeenCalled();
    expect(clientFormulaRepositoryMock.listClientFormulasForOwner).not.toHaveBeenCalled();
    expect(clientTreatmentRepositoryMock.listClientTreatmentsForOwner).not.toHaveBeenCalled();
  });
});
