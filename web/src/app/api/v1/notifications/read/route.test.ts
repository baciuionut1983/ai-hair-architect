import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({ getSession: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  markNotificationsReadForOwner: vi.fn(),
  isNotificationPersistenceError: vi.fn(),
  notificationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/notification-repository", () => repositoryMock);

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  mutableEnv.NODE_ENV = "test";
  cookiesMock.cookies.mockResolvedValue({ get: () => ({ value: "session-token" }) });
  storeMock.getSession.mockReturnValue({ id: "owner-1" });
  repositoryMock.isNotificationPersistenceError.mockReturnValue(false);
});

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("notifications read route", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
    expect(repositoryMock.markNotificationsReadForOwner).not.toHaveBeenCalled();
  });

  it("preserves the updated payload and owner-scoped IDs", async () => {
    repositoryMock.markNotificationsReadForOwner.mockResolvedValue(1);

    const response = await POST(jsonRequest({ notificationIds: ["notification-1", "unknown"] }));

    expect(response.status).toBe(200);
    expect(repositoryMock.markNotificationsReadForOwner).toHaveBeenCalledWith(
      "owner-1",
      ["notification-1", "unknown"],
    );
    await expect(response.json()).resolves.toEqual({ updated: 1 });
  });

  it("preserves omitted IDs for mark-all behavior", async () => {
    repositoryMock.markNotificationsReadForOwner.mockResolvedValue(2);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(200);
    expect(repositoryMock.markNotificationsReadForOwner).toHaveBeenCalledWith("owner-1", undefined);
  });

  it("returns the controlled no-store persistence response", async () => {
    const error = new Error("unavailable");
    repositoryMock.markNotificationsReadForOwner.mockRejectedValue(error);
    repositoryMock.isNotificationPersistenceError.mockImplementation((value) => value === error);
    repositoryMock.notificationPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "NOTIFICATION_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("allows production through the persistence guard before body parsing", async () => {
    mutableEnv.NODE_ENV = "production";
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
    expect(cookiesMock.cookies).toHaveBeenCalledOnce();
    expect(storeMock.getSession).toHaveBeenCalledOnce();
    expect(repositoryMock.markNotificationsReadForOwner).not.toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
