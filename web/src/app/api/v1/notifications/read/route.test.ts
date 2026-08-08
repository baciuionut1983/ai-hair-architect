import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  markNotificationsReadForOwner: vi.fn(),
  isNotificationPersistenceError: vi.fn(),
  notificationPersistenceUnavailableResponse: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/notification-repository", () => repositoryMock);

import { POST } from "./route";

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

describe("notifications read route", () => {
  it("returns 401 without a cookie, never marking notifications read", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
    expect(repositoryMock.markNotificationsReadForOwner).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
  });

  it("scopes the mark-read operation strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });
    repositoryMock.markNotificationsReadForOwner.mockResolvedValue(0);

    await POST(jsonRequest({}));

    expect(repositoryMock.markNotificationsReadForOwner).toHaveBeenCalledWith("owner-2", undefined);
    expect(repositoryMock.markNotificationsReadForOwner).not.toHaveBeenCalledWith("owner-1", undefined);
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
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
    expect(repositoryMock.markNotificationsReadForOwner).not.toHaveBeenCalled();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(401);
    expect(authMock.authenticateSessionRequest).toHaveBeenCalledOnce();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
