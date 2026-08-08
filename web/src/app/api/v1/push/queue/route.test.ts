import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const milestone1StoreMock = vi.hoisted(() => ({
  getPushQueueForUser: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
const opsPersistenceMock = vi.hoisted(() => ({ enqueuePersistentPushNotification: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => milestone1StoreMock);
vi.mock("@/lib/ops-persistence", () => opsPersistenceMock);

import { GET, POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  milestone1StoreMock.getPushQueueForUser.mockReturnValue([]);
  milestone1StoreMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
});

describe("GET /api/v1/push/queue", () => {
  it("returns 401 without a cookie, never reading the queue", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(milestone1StoreMock.getPushQueueForUser).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns the owner-scoped push queue for a valid session", async () => {
    milestone1StoreMock.getPushQueueForUser.mockReturnValue([
      { id: "queue-1", userId: "owner-1", channel: "in_app", title: "Reminder", body: "Come back soon", status: "queued", createdAt: "2026-08-08T10:00:00.000Z" },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ queue: [{ id: "queue-1" }] });
    expect(milestone1StoreMock.getPushQueueForUser).toHaveBeenCalledWith("owner-1");
  });

  it("scopes the queue strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await GET();

    expect(milestone1StoreMock.getPushQueueForUser).toHaveBeenCalledWith("owner-2");
    expect(milestone1StoreMock.getPushQueueForUser).not.toHaveBeenCalledWith("owner-1");
  });
});

describe("POST /api/v1/push/queue", () => {
  function invoke(body: unknown): Promise<Response> {
    return POST({ json: async () => body } as never);
  }

  it("returns 401 without a cookie, never enqueuing", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ title: "Reminder", body: "Come back soon" });

    expect(response.status).toBe(401);
    expect(opsPersistenceMock.enqueuePersistentPushNotification).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ title: "Reminder", body: "Come back soon" });

    expect(response.status).toBe(401);
  });

  it("rejects a missing title or body", async () => {
    milestone1StoreMock.sanitize.mockReturnValue("");

    const response = await invoke({ title: "", body: "" });

    expect(response.status).toBe(400);
    expect(opsPersistenceMock.enqueuePersistentPushNotification).not.toHaveBeenCalled();
  });

  it("enqueues a notification for the authenticated owner on a valid session", async () => {
    opsPersistenceMock.enqueuePersistentPushNotification.mockResolvedValue({
      id: "queue-1",
      userId: "owner-1",
      channel: "in_app",
      title: "Reminder",
      body: "Come back soon",
      status: "queued",
      createdAt: "2026-08-08T10:00:00.000Z",
    });

    const response = await invoke({ title: "Reminder", body: "Come back soon" });

    expect(response.status).toBe(201);
    expect(opsPersistenceMock.enqueuePersistentPushNotification).toHaveBeenCalledWith({
      userId: "owner-1",
      channel: "in_app",
      title: "Reminder",
      body: "Come back soon",
    });
  });
});
