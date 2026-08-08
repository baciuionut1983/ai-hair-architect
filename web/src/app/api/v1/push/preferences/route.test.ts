import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getPushPreference: vi.fn(),
  upsertPushPreference: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { GET, POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  storeMock.getPushPreference.mockReturnValue({
    userId: "owner-1",
    enabled: true,
    channels: ["in_app"],
    updatedAt: "2026-08-08T10:00:00.000Z",
  });
  storeMock.upsertPushPreference.mockReturnValue({
    userId: "owner-1",
    enabled: true,
    channels: ["in_app", "email"],
    updatedAt: "2026-08-08T10:00:00.000Z",
  });
});

describe("GET /api/v1/push/preferences", () => {
  it("returns 401 without a cookie, never reading the preference", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(storeMock.getPushPreference).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns the owner-scoped preference for a valid session", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(storeMock.getPushPreference).toHaveBeenCalledWith("owner-1");
    await expect(response.json()).resolves.toMatchObject({ preference: { userId: "owner-1" } });
  });

  it("scopes the preference lookup strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await GET();

    expect(storeMock.getPushPreference).toHaveBeenCalledWith("owner-2");
    expect(storeMock.getPushPreference).not.toHaveBeenCalledWith("owner-1");
  });
});

describe("POST /api/v1/push/preferences", () => {
  function invoke(body: unknown): Promise<Response> {
    return POST({ json: async () => body } as never);
  }

  it("returns 401 without a cookie, never updating the preference", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ enabled: true, channels: ["email"] });

    expect(response.status).toBe(401);
    expect(storeMock.upsertPushPreference).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ enabled: true, channels: ["email"] });

    expect(response.status).toBe(401);
  });

  it("updates the owner-scoped preference for a valid session", async () => {
    const response = await invoke({ enabled: true, channels: ["in_app", "email"] });

    expect(response.status).toBe(200);
    expect(storeMock.upsertPushPreference).toHaveBeenCalledWith({
      userId: "owner-1",
      enabled: true,
      channels: ["in_app", "email"],
    });
  });

  it("defaults to in_app when channels is missing or empty", async () => {
    await invoke({});

    expect(storeMock.upsertPushPreference).toHaveBeenCalledWith({
      userId: "owner-1",
      enabled: true,
      channels: ["in_app"],
    });
  });

  it("scopes the preference update strictly to the authenticated owner (cross-user isolation)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue({
      id: "owner-2",
      email: "owner-b@example.com",
      role: "professional",
      locale: "en",
    });

    await invoke({ enabled: true, channels: ["email"] });

    expect(storeMock.upsertPushPreference).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-2" }),
    );
  });
});
