import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({ getSession: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  AppointmentConcurrencyError: class AppointmentConcurrencyError extends Error {
    readonly code = "APPOINTMENT_CONCURRENCY_CONFLICT";
    readonly httpStatus = 409;
  },
  executeDueAppointmentRemindersForOwner: vi.fn(),
  isAppointmentPersistenceError: vi.fn(),
  appointmentPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/appointment-repository", () => repositoryMock);

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  mutableEnv.NODE_ENV = "test";
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  repositoryMock.isAppointmentPersistenceError.mockReturnValue(false);
});

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("reminder run route", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(repositoryMock.executeDueAppointmentRemindersForOwner).not.toHaveBeenCalled();
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
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(cookiesMock.cookies).toHaveBeenCalledOnce();
    expect(storeMock.getSession).toHaveBeenCalledOnce();
    expect(repositoryMock.executeDueAppointmentRemindersForOwner).not.toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });
});

function request(): Request {
  return new Request("http://localhost/api/v1/notifications/reminders/run", { method: "POST" });
}
