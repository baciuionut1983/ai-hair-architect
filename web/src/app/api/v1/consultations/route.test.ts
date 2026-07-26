import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

describe("consultations durable persistence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it("allows durable Consultation flow in production", async () => {
    mutableEnv.NODE_ENV = "production";
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/v1/consultations", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });

  it("bypasses the guard in test and continues the existing flow", async () => {
    mutableEnv.NODE_ENV = "test";
    cookiesMock.cookies.mockResolvedValue({ get: () => undefined });
    storeMock.getSession.mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/v1/consultations", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(storeMock.getSession).toHaveBeenCalledOnce();
  });
});