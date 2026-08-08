import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  sanitize: vi.fn(),
}));
const clientRepositoryMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const appointmentRepositoryMock = vi.hoisted(() => ({
  AppointmentDependencyError: class AppointmentDependencyError extends Error {
    constructor(readonly code: string, readonly httpStatus: number, message: string) {
      super(message);
    }
  },
  createAppointmentForOwner: vi.fn(),
  listAppointmentsForOwner: vi.fn(),
  isAppointmentPersistenceError: vi.fn(),
  appointmentPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);
vi.mock("@/lib/session-request-auth", () => authMock);

import { GET, POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;
const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

describe("appointments business persistence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointmentRepositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it.each([
    ["GET", () => GET(new Request("http://localhost/api/v1/appointments"))],
    ["POST", () => POST(new Request("http://localhost/api/v1/appointments", { method: "POST" }))],
  ])("allows %s through the persistence guard in production", async (_method, invoke) => {
    mutableEnv.NODE_ENV = "production";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/appointments"));

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/v1/appointments"));

    expect(response.status).toBe(401);
    expect(appointmentRepositoryMock.listAppointmentsForOwner).not.toHaveBeenCalled();
  });

  it("scopes the list strictly to the authenticated owner (cross-user isolation)", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue({ ...OWNER_A, id: "owner-2" });
    appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([]);

    await GET(new Request("http://localhost/api/v1/appointments?clientId=client-1"));

    expect(appointmentRepositoryMock.listAppointmentsForOwner).toHaveBeenCalledWith("owner-2", "client-1");
    expect(appointmentRepositoryMock.listAppointmentsForOwner).not.toHaveBeenCalledWith("owner-1", "client-1");
  });

  it("lists Appointments through the owner-scoped repository", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([{ id: "appointment-1" }]);

    const response = await GET(new Request("http://localhost/api/v1/appointments?clientId=client-1"));

    expect(response.status).toBe(200);
    expect(appointmentRepositoryMock.listAppointmentsForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    await expect(response.json()).resolves.toEqual({ appointments: [{ id: "appointment-1" }] });
  });

  it("creates through the repository while preserving the existing payload", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    storeMock.sanitize.mockImplementation((value) => typeof value === "string" ? value.trim() : "");
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
    appointmentRepositoryMock.createAppointmentForOwner.mockResolvedValue({ id: "appointment-1" });

    const response = await POST(new Request("http://localhost/api/v1/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "client-1",
        title: "Consultation",
        startsAt: "2026-08-01T10:00:00.000Z",
        reminderMinutesBefore: 60,
        reminderType: "follow_up",
        notes: "Prepare",
      }),
    }));

    expect(response.status).toBe(201);
    expect(appointmentRepositoryMock.createAppointmentForOwner).toHaveBeenCalledWith("owner-1", {
      clientId: "client-1",
      title: "Consultation",
      startsAt: new Date("2026-08-01T10:00:00.000Z"),
      reminderMinutesBefore: 60,
      reminderType: "follow_up",
      notes: "Prepare",
    });
    await expect(response.json()).resolves.toEqual({ appointment: { id: "appointment-1" } });
  });

  it("maps dependency conflicts and persistence failures", async () => {
    mutableEnv.NODE_ENV = "test";
    authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
    storeMock.sanitize.mockImplementation((value) => typeof value === "string" ? value.trim() : "");
    clientRepositoryMock.resolveOwnedClient.mockResolvedValue({ id: "client-1" });
    appointmentRepositoryMock.createAppointmentForOwner.mockRejectedValue(
      new appointmentRepositoryMock.AppointmentDependencyError(
        "APPOINTMENT_DEPENDENCY_CHANGED",
        409,
        "Appointment dependencies changed.",
      ),
    );

    const request = () => new Request("http://localhost/api/v1/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "client-1", title: "Consultation", startsAt: "2026-08-01T10:00:00Z" }),
    });
    const conflictResponse = await POST(request());
    expect(conflictResponse.status).toBe(409);

    const error = new Error("unavailable");
    appointmentRepositoryMock.createAppointmentForOwner.mockRejectedValue(error);
    appointmentRepositoryMock.isAppointmentPersistenceError.mockImplementation((value) => value === error);
    appointmentRepositoryMock.appointmentPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "APPOINTMENT_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );
    const unavailableResponse = await POST(request());
    expect(unavailableResponse.status).toBe(503);
    expect(unavailableResponse.headers.get("Cache-Control")).toBe("no-store");
  });
});