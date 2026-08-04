import { beforeEach, describe, expect, it, vi } from "vitest";

const securityMocks = vi.hoisted(() => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/auth-security", () => securityMocks);

const tokenMocks = vi.hoisted(() => ({
  claimAuthToken: vi.fn(),
  findValidAuthToken: vi.fn(),
}));
vi.mock("@/lib/auth-token-repository", () => tokenMocks);

const storeMocks = vi.hoisted(() => ({
  revokeAllSessionsForUser: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
  updateUserPasswordHash: vi.fn(),
}));
vi.mock("@/lib/milestone1-store", () => storeMocks);

const prismaMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userUpdate: vi.fn(),
  authTokenDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: prismaMocks.transaction,
  },
}));

import { POST } from "./route";

const tx = {
  user: { update: prismaMocks.userUpdate },
  authToken: { deleteMany: prismaMocks.authTokenDeleteMany },
  session: { deleteMany: prismaMocks.sessionDeleteMany },
};

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const VALID_TOKEN_ROW = { id: "token-1", userId: "user-1", purpose: "password_reset" as const };
const VALID_BODY = { token: "good-token", newPassword: "newpassword123" };

beforeEach(() => {
  vi.clearAllMocks();
  storeMocks.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  prismaMocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(tx));
  tokenMocks.findValidAuthToken.mockResolvedValue(VALID_TOKEN_ROW);
  tokenMocks.claimAuthToken.mockResolvedValue(true);
  securityMocks.hashPassword.mockResolvedValue("$2b$10$newhash");
  prismaMocks.userUpdate.mockResolvedValue(undefined);
  prismaMocks.authTokenDeleteMany.mockResolvedValue({ count: 0 });
  prismaMocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
});

describe("POST /api/v1/auth/reset-password", () => {
  it("returns 400 when the token is missing", async () => {
    const response = await invoke({ newPassword: "newpassword123" });

    expect(response.status).toBe(400);
    expect(tokenMocks.findValidAuthToken).not.toHaveBeenCalled();
  });

  it("returns 400 when the new password is too short", async () => {
    const response = await invoke({ token: "good-token", newPassword: "short" });

    expect(response.status).toBe(400);
    expect(tokenMocks.findValidAuthToken).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid or expired token", async () => {
    tokenMocks.findValidAuthToken.mockResolvedValue(null);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(400);
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it("claims the token, changes the password, and revokes every session -- all atomically, then never auto-authenticates", async () => {
    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token).toBeUndefined();
    expect(response.headers.get("set-cookie")).toBeNull();

    expect(tokenMocks.claimAuthToken).toHaveBeenCalledWith("token-1", "password_reset", expect.any(Date), tx);
    expect(prismaMocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "$2b$10$newhash" },
    });
    expect(prismaMocks.authTokenDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", purpose: "password_reset", usedAt: null },
    });
    expect(prismaMocks.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });

    // In-memory hybrid store kept consistent only after the Postgres
    // transaction has actually committed.
    expect(storeMocks.updateUserPasswordHash).toHaveBeenCalledWith("user-1", "$2b$10$newhash");
    expect(storeMocks.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
  });

  it("returns 400 and changes nothing when the claim loses a race (token already used)", async () => {
    tokenMocks.claimAuthToken.mockResolvedValue(false);

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(400);
    expect(prismaMocks.userUpdate).not.toHaveBeenCalled();
    expect(storeMocks.updateUserPasswordHash).not.toHaveBeenCalled();
    expect(storeMocks.revokeAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("returns 503 and never touches the in-memory store when the transaction fails for an unrelated reason", async () => {
    prismaMocks.transaction.mockRejectedValue(new Error("db down"));

    const response = await invoke(VALID_BODY);

    expect(response.status).toBe(503);
    expect(storeMocks.updateUserPasswordHash).not.toHaveBeenCalled();
    expect(storeMocks.revokeAllSessionsForUser).not.toHaveBeenCalled();
  });
});
