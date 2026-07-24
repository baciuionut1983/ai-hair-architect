import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => ({
  cookies: vi.fn(),
}));

vi.mock("next/headers", () => cookiesMock);

vi.mock("@/lib/milestone1-store", () => ({
  revokeSessionToken: vi.fn(),
}));

vi.mock("@/lib/auth-persistence", () => ({
  revokePersistenceSessionToken: vi.fn(),
}));

import { POST } from "./route";
import { revokePersistenceSessionToken } from "@/lib/auth-persistence";
import { revokeSessionToken } from "@/lib/milestone1-store";

describe("auth logout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session cookie is missing", async () => {
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const response = await POST();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(vi.mocked(revokeSessionToken)).not.toHaveBeenCalled();
    expect(vi.mocked(revokePersistenceSessionToken)).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("aha_session=");
  });

  it("revokes current token and clears cookie", async () => {
    vi.mocked(cookiesMock.cookies).mockResolvedValue({
      get: () => ({ value: "token-123" }),
    } as never);

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(vi.mocked(revokeSessionToken)).toHaveBeenCalledWith("token-123");
    expect(vi.mocked(revokePersistenceSessionToken)).toHaveBeenCalledWith("token-123");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});