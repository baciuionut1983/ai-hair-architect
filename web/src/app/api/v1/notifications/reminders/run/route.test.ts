import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  AppointmentConcurrencyError: class AppointmentConcurrencyError extends Error {
    readonly code = "APPOINTMENT_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
  },
  executeDueAppointmentRemindersForOwner: vi.fn(),
  isAppointmentPersistenceError: vi.fn(),
  appointmentPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/appointment-repository", () => repositoryMock);

import { POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };
const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  mutableEnv.NODE_ENV = "test";
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  repositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
});

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("reminder run route", () => {
  it("returns 401 without a cookie, never executing reminders", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(repositoryMock.executeDueAppointmentRemindersForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
  });

  it("scopes reminder execution strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });
    repositoryMock.executeDueAppointmentRemindersForOwner.mockResolvedValue({ remindersCreated: 0 });

    await POST(request());

    expect(repositoryMock.executeDueAppointmentRemindersForOwner).toHaveBeenCalledWith("owner-2");
    expect(repositoryMock.executeDueAppointmentRemindersForOwner).not.toHaveBeenCalledWith("owner-1");
  });

  it("preserves the reminder result from the owner-scoped repository", async () => {
    repositoryMock.executeDueAppointmentRemindersForOwner.mockResolvedValue({ remindersCreated: 2 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(repositoryMock.executeDueAppointmentRemindersForOwner).toHaveBeenCalledWith("owner-1");
    await expect(response.json()).resolves.toEqual({ remindersCreated: 2 });
  });

  it("maps exhausted concurrency retries to 409", async () => {
    repositoryMock.executeDueAppointmentRemindersForOwner.mockRejectedValue(
      new repositoryMock.AppointmentConcurrencyError("Concurrent change."),
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "APPOINTMENT_CONCURRENCY_CONFLICT" });
  });

  it("returns the controlled no-store persistence response", async () => {
    const error = new Error("unavailable");
    repositoryMock.executeDueAppointmentRemindersForOwner.mockRejectedValue(error);
    repositoryMock.isAppointmentPersistenceError.mockImplementation((value) => value === error);
    repositoryMock.appointmentPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "APPOINTMENT_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("allows production through the persistence guard", async () => {
    mutableEnv.NODE_ENV = "production";
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
    expect(repositoryMock.executeDueAppointmentRemindersForOwner).not.toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });
});

function request(): Request {
  return new Request("http://localhost/api/v1/notifications/reminders/run", { method: "POST" });
}
