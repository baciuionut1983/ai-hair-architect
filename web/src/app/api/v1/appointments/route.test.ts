import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
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

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/client-repository", () => clientRepositoryMock);
vi.mock("@/lib/appointment-repository", () => appointmentRepositoryMock);

import { GET, POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

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
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await GET(new Request("http://localhost/api/v1/appointments"));

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });

  it("lists Appointments through the owner-scoped repository", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1" });
    appointmentRepositoryMock.listAppointmentsForOwner.mockResolvedValue([{ id: "appointment-1" }]);

    const response = await GET(new Request("http://localhost/api/v1/appointments?clientId=client-1"));

    expect(response.status).toBe(200);
    expect(appointmentRepositoryMock.listAppointmentsForOwner).toHaveBeenCalledWith("owner-1", "client-1");
    await expect(response.json()).resolves.toEqual({ appointments: [{ id: "appointment-1" }] });
  });

  it("creates through the repository while preserving the existing payload", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1" });
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
    cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
    storeMock.getSession.mockReturnValue({ id: "owner-1" });
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