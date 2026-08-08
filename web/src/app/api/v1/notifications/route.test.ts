import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  listNotificationsForOwner: vi.fn(),
  isNotificationPersistenceError: vi.fn(),
  notificationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/notification-repository", () => repositoryMock);

import { GET } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };
const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  mutableEnv.NODE_ENV = "test";
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  repositoryMock.isNotificationPersistenceError.mockReturnValue(false);
});

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("notifications route", () => {
  it("returns 401 without a cookie, never reading notifications", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(repositoryMock.listNotificationsForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
  });

  it("scopes the notification list strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });
    repositoryMock.listNotificationsForOwner.mockResolvedValue([]);

    await GET(request());

    expect(repositoryMock.listNotificationsForOwner).toHaveBeenCalledWith("owner-2");
    expect(repositoryMock.listNotificationsForOwner).not.toHaveBeenCalledWith("owner-1");
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
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
    expect(repositoryMock.listNotificationsForOwner).not.toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });
});

function request(): Request {
  return new Request("http://localhost/api/v1/notifications");
}
