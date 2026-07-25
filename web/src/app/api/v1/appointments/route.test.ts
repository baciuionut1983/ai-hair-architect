import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  createAppointment: vi.fn(),
  getAppointmentsForUser: vi.fn(),
  getSession: vi.fn(),
  sanitize: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { GET, POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

describe("appointments business persistence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it.each([
    ["GET", () => GET(new Request("http://localhost/api/v1/appointments"))],
    ["POST", () => POST(new Request("http://localhost/api/v1/appointments", { method: "POST" }))],
  ])("blocks %s in production before session resolution", async (_method, invoke) => {
    mutableEnv.NODE_ENV = "production";

    const response = await invoke();

    expect(response.status).toBe(503);
    expect(storeMock.getSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ domain: "appointments" });
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await GET(new Request("http://localhost/api/v1/appointments"));

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });
});