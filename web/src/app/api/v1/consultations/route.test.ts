import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({ cookies: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  getAnalysisOwnedByUser: vi.fn(),
  getSession: vi.fn(),
  store: { consultations: [] },
}));

vi.mock("next/headers", () => cookiesMock);
vi.mock("@/lib/milestone1-store", () => storeMock);

import { POST } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

describe("consultations business persistence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
  });

  it("blocks POST in production before session resolution", async () => {
    mutableEnv.NODE_ENV = "production";

    const response = await POST(
      new Request("http://localhost/api/v1/consultations", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(storeMock.getSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ domain: "consultations" });
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