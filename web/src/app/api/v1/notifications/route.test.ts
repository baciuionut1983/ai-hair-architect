import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({ getSession: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  listNotificationsForOwner: vi.fn(),
  isNotificationPersistenceError: vi.fn(),
  notificationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/notification-repository", () => repositoryMock);

import { GET } from "./route";

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

describe("notifications route", () => {
  it("returns 401 without a session", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(repositoryMock.listNotificationsForOwner).not.toHaveBeenCalled();
  });

  it("returns the existing payload from the owner-scoped repository", async () => {
    repositoryMock.listNotificationsForOwner.mockResolvedValue([{ id: "notification-1" }]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(repositoryMock.listNotificationsForOwner).toHaveBeenCalledWith("owner-1");
    await expect(response.json()).resolves.toEqual({ notifications: [{ id: "notification-1" }] });
  });

  it("returns the controlled no-store persistence response", async () => {
    const error = new Error("unavailable");
    repositoryMock.listNotificationsForOwner.mockRejectedValue(error);
    repositoryMock.isNotificationPersistenceError.mockImplementation((value) => value === error);
    repositoryMock.notificationPersistenceUnavailableResponse.mockReturnValue(
      Response.json({ error: "NOTIFICATION_PERSISTENCE_UNAVAILABLE" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("allows production through the persistence guard", async () => {
    mutableEnv.NODE_ENV = "production";
    storeMock.getSession.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(cookiesMock.cookies).toHaveBeenCalledOnce();
    expect(storeMock.getSession).toHaveBeenCalledOnce();
    expect(repositoryMock.listNotificationsForOwner).not.toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    storeMock.getSession.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });
});

function request(): Request {
  return new Request("http://localhost/api/v1/notifications");
}
