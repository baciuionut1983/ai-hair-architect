import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const prismaMocks = vi.hoisted(() => ({ configured: true, update: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: () => prismaMocks.configured,
  prisma: { user: { update: prismaMocks.update } },
}));

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };

function invoke(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/account/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  prismaMocks.configured = true;
  prismaMocks.update.mockResolvedValue({ id: "owner-1", locale: "ro" });
});

describe("POST /api/v1/account/locale", () => {
  it("returns 401 without a cookie, never touching persistence", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ locale: "ro" });

    expect(response.status).toBe(401);
    expect(prismaMocks.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or unsupported locale value, never touching persistence", async () => {
    const missing = await invoke({});
    expect(missing.status).toBe(400);

    const garbage = await invoke({ locale: "fr" });
    expect(garbage.status).toBe(400);

    const autoValue = await invoke({ locale: "auto" });
    expect(autoValue.status).toBe(400);

    expect(prismaMocks.update).not.toHaveBeenCalled();
  });

  it("persists the caller's own locale via a single-field update, scoped to their own id", async () => {
    const response = await invoke({ locale: "ro" });

    expect(response.status).toBe(200);
    expect(prismaMocks.update).toHaveBeenCalledWith({ where: { id: "owner-1" }, data: { locale: "ro" } });
    const body = await response.json();
    expect(body).toEqual({ locale: "ro" });
  });

  it("accepts English too", async () => {
    const response = await invoke({ locale: "en" });

    expect(response.status).toBe(200);
    expect(prismaMocks.update).toHaveBeenCalledWith({ where: { id: "owner-1" }, data: { locale: "en" } });
  });

  it("fails closed with 503 when the database is not configured", async () => {
    prismaMocks.configured = false;

    const response = await invoke({ locale: "ro" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("ACCOUNT_PERSISTENCE_UNAVAILABLE");
  });

  it("fails closed with 503 when the update itself throws", async () => {
    prismaMocks.update.mockRejectedValue(new Error("db down"));

    const response = await invoke({ locale: "ro" });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("ACCOUNT_PERSISTENCE_UNAVAILABLE");
  });
});
